use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, OnceCell};
use tokio::time::{Instant, sleep, timeout};

use crate::Error;

const DEFAULT_TIMEOUT_SECONDS: u64 = 20;
const CHECK_EVERY: Duration = Duration::from_millis(100);
const PROBE_FOR: Duration = Duration::from_millis(300);
const LOG_LINES: usize = 5;
const STOP_WITHIN: Duration = Duration::from_secs(3);

/// What to run, either as one line for the shell or as a program and its arguments, which needs no quoting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TunnelCommand {
    Shell(String),
    Args(Vec<String>),
}

/// A port-forward a server needs before it can be reached, such as `kubectl port-forward`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tunnel {
    pub command: TunnelCommand,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
}

type PathResolver = Arc<dyn Fn() -> String + Send + Sync>;

/// A tunnel this app started, and when, so a failure from before it started is not blamed on it.
struct Started {
    child: Child,
    at: Instant,
}

/// The tunnels this app started, one to a local port, so they can be reused while they live and stopped when it quits.
#[derive(Default)]
pub struct Tunnels {
    running: Mutex<HashMap<u16, Started>>,
    resolver: Option<PathResolver>,
    path: OnceCell<String>,
}

async fn answers(host: &str, port: u16) -> bool {
    matches!(
        timeout(PROBE_FOR, TcpStream::connect((host, port))).await,
        Ok(Ok(_))
    )
}

fn log_path(port: u16) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("pgclient-tunnel-{port}.log"))
}

/// What the command said, for when it did not work. It writes to a file and not a pipe, because kubectl chatters on every
/// connection and a pipe nobody reads would fill up and freeze it.
fn said(path: &std::path::Path) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let tail = lines[lines.len().saturating_sub(LOG_LINES)..].join(" | ");
    if tail.is_empty() {
        "it said nothing".to_string()
    } else {
        tail
    }
}

/// The command as `ps` shows it, words single-spaced.
fn command_line(tunnel: &Tunnel) -> String {
    let text = match &tunnel.command {
        TunnelCommand::Shell(text) => text.clone(),
        TunnelCommand::Args(args) => args.join(" "),
    };
    single_spaced(&text)
}

fn single_spaced(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Whether a `ps` line is this command. The program is judged by its arguments alone, since some, as Python on macOS, start
/// again under another path.
fn runs(line: &str, wanted: &str) -> bool {
    let line = single_spaced(line);
    line == wanted
        || wanted
            .split_once(' ')
            .is_some_and(|(_, args)| line.ends_with(&format!(" {args}")))
}

async fn output(program: &str, args: &[&str]) -> String {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
        .unwrap_or_default()
}

/// The processes listening on the port that run exactly this tunnel's command: forwards an earlier run left behind.
async fn left_behind(port: u16, tunnel: &Tunnel) -> Vec<String> {
    let wanted = command_line(tunnel);
    let port_arg = format!("-iTCP:{port}");
    let pids = output("lsof", &["-nP", "-t", &port_arg, "-sTCP:LISTEN"]).await;
    let mut found = Vec::new();
    for pid in pids.split_whitespace() {
        if runs(&output("ps", &["-o", "command=", "-p", pid]).await, &wanted) {
            found.push(pid.to_string());
        }
    }
    found
}

fn spawn(tunnel: &Tunnel, log: &std::path::Path, path: Option<&str>) -> Result<Child, Error> {
    let (mut command, name) = match &tunnel.command {
        // exec, so stopping it stops the real program and not just the shell around it.
        TunnelCommand::Shell(text) => {
            let mut command = Command::new("sh");
            command.arg("-c").arg(format!("exec {text}"));
            (
                command,
                text.split_whitespace().next().unwrap_or("sh").to_string(),
            )
        }
        TunnelCommand::Args(args) => {
            let (program, rest) = args
                .split_first()
                .ok_or_else(|| Error::Tunnel("The tunnel command is empty".into()))?;
            let mut command = Command::new(program);
            command.args(rest);
            (command, program.clone())
        }
    };
    let file = std::fs::File::create(log).map_err(|error| Error::Tunnel(error.to_string()))?;
    let more = file
        .try_clone()
        .map_err(|error| Error::Tunnel(error.to_string()))?;
    if let Some(path) = path {
        command.env("PATH", path);
    }
    command
        .stdin(Stdio::null())
        .stdout(file)
        .stderr(more)
        .kill_on_drop(true);
    command
        .spawn()
        .map_err(|error| Error::Tunnel(format!("Could not start {name}: {error}")))
}

impl Tunnels {
    pub fn new() -> Self {
        Self::default()
    }

    /// Tunnels whose commands are found on the PATH `resolver` gives. It is asked for when a tunnel is first needed, and once,
    /// since working it out can mean starting a shell, which is not worth doing for a person who never uses one.
    pub fn with_path_resolver(resolver: impl Fn() -> String + Send + Sync + 'static) -> Self {
        Self {
            resolver: Some(Arc::new(resolver)),
            ..Self::default()
        }
    }

    async fn search_path(&self) -> Option<&str> {
        let resolver = self.resolver.clone()?;
        let path = self
            .path
            .get_or_init(|| async move {
                tokio::task::spawn_blocking(move || resolver())
                    .await
                    .unwrap_or_default()
            })
            .await;
        Some(path.as_str())
    }

    /// Makes sure `host:port` answers, starting the tunnel if it does not. Something already answering is left alone, so a
    /// forward started by hand works too. One that was started here and has since died is started again.
    pub async fn ensure(&self, host: &str, port: u16, tunnel: &Tunnel) -> Result<(), Error> {
        if answers(host, port).await {
            return Ok(());
        }
        let mut running = self.running.lock().await;
        if answers(host, port).await {
            return Ok(());
        }
        if let Some(mut stale) = running.remove(&port) {
            let _ = stale.child.kill().await;
        }
        let log = log_path(port);
        let mut child = spawn(tunnel, &log, self.search_path().await)?;
        let seconds = tunnel.timeout_seconds.unwrap_or(DEFAULT_TIMEOUT_SECONDS);
        let deadline = Instant::now() + Duration::from_secs(seconds);
        loop {
            if answers(host, port).await {
                running.insert(
                    port,
                    Started {
                        child,
                        at: Instant::now(),
                    },
                );
                return Ok(());
            }
            if let Ok(Some(status)) = child.try_wait() {
                return Err(Error::Tunnel(format!(
                    "The tunnel command stopped ({status}): {}",
                    said(&log)
                )));
            }
            if Instant::now() >= deadline {
                let _ = child.kill().await;
                return Err(Error::Tunnel(format!(
                    "Port {port} did not open within {seconds} seconds: {}",
                    said(&log)
                )));
            }
            sleep(CHECK_EVERY).await;
        }
    }

    /// Starts the tunnel again when its port answers but nothing gets through, as when a forward outlives its login. Only a
    /// forward this app started is stopped, now or on an earlier run; anything else on the port is left alone. `failed_at`
    /// is when the failing attempt began: a tunnel started since then is already a new one and is kept. Says whether the
    /// tunnel is a new one, so trying again is worth it.
    pub async fn restart(
        &self,
        host: &str,
        port: u16,
        tunnel: &Tunnel,
        failed_at: Instant,
    ) -> Result<bool, Error> {
        {
            let mut running = self.running.lock().await;
            match running.remove(&port) {
                Some(started) if started.at > failed_at => {
                    running.insert(port, started);
                    return Ok(true);
                }
                Some(mut started) => {
                    let _ = started.child.kill().await;
                }
                None => {
                    let pids = left_behind(port, tunnel).await;
                    if pids.is_empty() {
                        return Ok(false);
                    }
                    let pids: Vec<&str> = pids.iter().map(String::as_str).collect();
                    output("kill", &pids).await;
                }
            }
            let deadline = Instant::now() + STOP_WITHIN;
            while answers(host, port).await && Instant::now() < deadline {
                sleep(CHECK_EVERY).await;
            }
        }
        self.ensure(host, port, tunnel).await?;
        Ok(true)
    }

    /// The last lines the tunnel on this port wrote, to explain why nothing got through it.
    pub fn last_said(&self, port: u16) -> String {
        said(&log_path(port))
    }

    pub async fn stop_all(&self) {
        let children: Vec<Child> = self
            .running
            .lock()
            .await
            .drain()
            .map(|(_, started)| started.child)
            .collect();
        for mut child in children {
            let _ = child.kill().await;
        }
    }
}
