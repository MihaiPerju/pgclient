use std::collections::HashSet;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::{self, sleep};
use std::time::{Duration, Instant};

const MARK: &str = "__PGCLIENT_PATH__";
const CHECK_EVERY: Duration = Duration::from_millis(20);
/// Time for the last of a finished shell's output to reach us.
const SETTLE: Duration = Duration::from_millis(40);
const LOGIN_SHELL_TIMEOUT: Duration = Duration::from_secs(3);
const USUAL_PLACES: [&str; 4] = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
];

/// The entries of `preferred` first and then those of `existing`, each once. An empty entry is dropped, since it would mean the current folder.
pub fn merge_paths(preferred: &str, existing: &str) -> String {
    let mut seen = HashSet::new();
    preferred
        .split(':')
        .chain(existing.split(':'))
        .filter(|entry| !entry.is_empty() && seen.insert(*entry))
        .collect::<Vec<_>>()
        .join(":")
}

/// What a shell printed between our two markers, whatever else it said before and after, as a shell with a banner does.
pub fn parse_marked(output: &str) -> Option<String> {
    let after = &output[output.find(MARK)? + MARK.len()..];
    let value = &after[..after.find(MARK)?];
    (!value.is_empty()).then(|| value.to_string())
}

/// Asks the person's own shell, as a login shell, for the PATH it sets up. An app opened from the Dock is not given the
/// one a terminal has, and that is where tools such as kubectl live. Gives up after `timeout` so a stuck shell never holds it up.
pub fn read_login_path(shell: &str, timeout: Duration) -> Option<String> {
    let script = format!("printf '%s' '{MARK}'; printf '%s' \"$PATH\"; printf '%s' '{MARK}'");
    let mut child = Command::new(shell)
        .args(["-ilc", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let output = Arc::new(Mutex::new(Vec::new()));
    let collected = output.clone();
    // Read as it comes, not until the end: a shell can leave a background program holding its output open for good.
    thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        while let Ok(read) = stdout.read(&mut chunk) {
            if read == 0 {
                break;
            }
            collected.lock().unwrap().extend_from_slice(&chunk[..read]);
        }
    });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => sleep(CHECK_EVERY),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    sleep(SETTLE);
    let text = String::from_utf8_lossy(&output.lock().unwrap()).into_owned();
    parse_marked(&text)
}

/// The PATH for programs the app starts: the login shell's, then the app's own, then the usual places for the tools people
/// install, in case the shell could not say.
pub fn resolve(shell: &str, current: &str, home: &str) -> String {
    let usual = [
        USUAL_PLACES.map(String::from).to_vec(),
        vec![
            format!("{home}/.local/bin"),
            "/usr/local/google-cloud-sdk/bin".into(),
            format!("{home}/google-cloud-sdk/bin"),
        ],
    ]
    .concat()
    .join(":");
    let from_shell = read_login_path(shell, LOGIN_SHELL_TIMEOUT).unwrap_or_default();
    merge_paths(&merge_paths(&from_shell, current), &usual)
}
