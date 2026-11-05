//! Starting a port-forward when a server needs one, and leaving it alone when it is already there.

use std::net::TcpListener;
use std::time::Duration;

use pgclient_core::{Error, Tunnel, TunnelCommand, Tunnels};

const PORTS_FROM: u16 = 20_000;
const PORTS: u16 = 28_000;

/// A port nothing answers on, and no other test here was given. It is below the ports the system picks for outgoing
/// connections, as a connection to one of those with nothing on it can come from that same port and reach itself. It is
/// tried by connecting rather than listening, since a listener could be handed down to a command another test starts at
/// that moment and outlive the try. Where the run starts is left to chance, so a run right after another does not take the
/// ports it just let go of.
fn free_port() -> u16 {
    static NEXT: std::sync::OnceLock<std::sync::atomic::AtomicU32> = std::sync::OnceLock::new();
    let next = NEXT.get_or_init(|| {
        let micros = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_micros() as u32;
        std::sync::atomic::AtomicU32::new(micros ^ std::process::id().wrapping_mul(7919))
    });
    loop {
        let port = PORTS_FROM
            + (next.fetch_add(1, std::sync::atomic::Ordering::SeqCst) % PORTS as u32) as u16;
        let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        if std::net::TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_err() {
            return port;
        }
    }
}

/// A port with something already on it, which the system picked.
fn taken_port() -> (u16, TcpListener) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    (listener.local_addr().unwrap().port(), listener)
}

async fn answers(port: u16) -> bool {
    tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .is_ok()
}

/// A command that takes a moment to start listening, as a real port-forward does, and notes each time it was started.
fn listener(port: u16, marker: &std::path::Path, lives_for: u32) -> Tunnel {
    let script = format!(
        // One line, so `ps` shows it as it was given.
        "import socket,time; open({marker:?},'a').write('started\\n'); time.sleep(0.3); s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(('127.0.0.1',{port})); s.listen(); time.sleep({lives_for})"
    );
    Tunnel {
        command: TunnelCommand::Args(vec!["python3".into(), "-c".into(), script]),
        timeout_seconds: Some(10),
    }
}

fn starts(marker: &std::path::Path) -> usize {
    std::fs::read_to_string(marker)
        .map(|text| text.lines().count())
        .unwrap_or(0)
}

#[tokio::test]
async fn the_command_is_started_when_the_port_is_closed_and_it_waits_until_the_port_answers() {
    let (port, dir) = (free_port(), tempfile::tempdir().unwrap());
    let marker = dir.path().join("marker");
    let tunnels = Tunnels::new();

    tunnels
        .ensure("127.0.0.1", port, &listener(port, &marker, 30))
        .await
        .unwrap();

    assert!(answers(port).await);
    assert_eq!(starts(&marker), 1);
    tunnels.stop_all().await;
}

#[tokio::test]
async fn nothing_is_started_when_something_already_answers() {
    let ((port, _already), dir) = (taken_port(), tempfile::tempdir().unwrap());
    let marker = dir.path().join("marker");

    Tunnels::new()
        .ensure("127.0.0.1", port, &listener(port, &marker, 30))
        .await
        .unwrap();

    assert_eq!(starts(&marker), 0);
}

#[tokio::test]
async fn asking_again_while_it_is_up_does_not_start_a_second_one() {
    let (port, dir) = (free_port(), tempfile::tempdir().unwrap());
    let marker = dir.path().join("marker");
    let tunnels = Tunnels::new();
    let tunnel = listener(port, &marker, 30);

    tunnels.ensure("127.0.0.1", port, &tunnel).await.unwrap();
    tunnels.ensure("127.0.0.1", port, &tunnel).await.unwrap();

    assert_eq!(starts(&marker), 1);
    tunnels.stop_all().await;
}

#[tokio::test]
async fn a_forward_that_has_died_is_started_again_next_time() {
    let (port, dir) = (free_port(), tempfile::tempdir().unwrap());
    let marker = dir.path().join("marker");
    let tunnels = Tunnels::new();
    let tunnel = listener(port, &marker, 1);

    tunnels.ensure("127.0.0.1", port, &tunnel).await.unwrap();
    tokio::time::sleep(Duration::from_millis(1600)).await;
    assert!(!answers(port).await);
    tunnels.ensure("127.0.0.1", port, &tunnel).await.unwrap();

    assert_eq!(starts(&marker), 2);
    assert!(answers(port).await);
    tunnels.stop_all().await;
}

#[tokio::test]
async fn a_command_that_fails_is_reported_with_what_it_said() {
    let tunnel = Tunnel {
        command: TunnelCommand::Shell(
            "echo 'error: context \"nope\" does not exist' >&2; exit 1".into(),
        ),
        timeout_seconds: Some(10),
    };

    let error = Tunnels::new()
        .ensure("127.0.0.1", free_port(), &tunnel)
        .await
        .unwrap_err();

    assert!(matches!(error, Error::Tunnel(_)));
    assert!(
        error
            .to_string()
            .contains("context \"nope\" does not exist"),
        "{error}"
    );
}

#[tokio::test]
async fn a_port_that_never_opens_gives_up_after_the_timeout() {
    let tunnel = Tunnel {
        command: TunnelCommand::Shell("sleep 30".into()),
        timeout_seconds: Some(1),
    };
    let started = std::time::Instant::now();

    let error = Tunnels::new()
        .ensure("127.0.0.1", free_port(), &tunnel)
        .await
        .unwrap_err();

    assert!(error.to_string().contains("did not open"), "{error}");
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[tokio::test]
async fn what_was_started_is_stopped_when_told() {
    let (port, dir) = (free_port(), tempfile::tempdir().unwrap());
    let tunnels = Tunnels::new();
    tunnels
        .ensure(
            "127.0.0.1",
            port,
            &listener(port, &dir.path().join("marker"), 30),
        )
        .await
        .unwrap();

    tunnels.stop_all().await;
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert!(!answers(port).await);
}

#[tokio::test]
async fn a_command_that_cannot_even_start_is_reported() {
    let tunnel = Tunnel {
        command: TunnelCommand::Args(vec!["/nonexistent/kubectl".into()]),
        timeout_seconds: Some(5),
    };

    let error = Tunnels::new()
        .ensure("127.0.0.1", free_port(), &tunnel)
        .await
        .unwrap_err();

    assert!(matches!(error, Error::Tunnel(_)), "{error}");
}

fn fake_kubectl(dir: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join("fake-kubectl");
    std::fs::write(&path, "#!/bin/sh\necho 'found it' >&2\nexit 1\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn needs_fake_kubectl() -> Tunnel {
    Tunnel {
        command: TunnelCommand::Args(vec!["fake-kubectl".into()]),
        timeout_seconds: Some(5),
    }
}

#[tokio::test]
async fn a_program_is_found_on_the_path_the_app_was_given_and_not_only_the_one_it_started_with() {
    let dir = tempfile::tempdir().unwrap();
    fake_kubectl(dir.path());
    let folder = dir.path().display().to_string();
    let tunnels = Tunnels::with_path_resolver(move || format!("{folder}:/usr/bin:/bin"));

    let error = tunnels
        .ensure("127.0.0.1", free_port(), &needs_fake_kubectl())
        .await
        .unwrap_err();

    assert!(error.to_string().contains("found it"), "{error}");
}

#[tokio::test]
async fn without_that_path_the_same_program_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    fake_kubectl(dir.path());

    let error = Tunnels::new()
        .ensure("127.0.0.1", free_port(), &needs_fake_kubectl())
        .await
        .unwrap_err();

    assert!(error.to_string().contains("Could not start"), "{error}");
}

#[tokio::test]
async fn a_command_run_through_the_shell_gets_the_path_too() {
    let tunnels = Tunnels::with_path_resolver(|| "/custom/bin:/usr/bin:/bin".to_string());
    let tunnel = Tunnel {
        command: TunnelCommand::Shell("printenv PATH".into()),
        timeout_seconds: Some(5),
    };

    let error = tunnels
        .ensure("127.0.0.1", free_port(), &tunnel)
        .await
        .unwrap_err();

    assert!(
        error.to_string().contains("/custom/bin:/usr/bin:/bin"),
        "{error}"
    );
}

#[tokio::test]
async fn the_path_is_worked_out_when_first_needed_and_only_once() {
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = calls.clone();
    let tunnels = Tunnels::with_path_resolver(move || {
        counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        "/usr/bin:/bin".to_string()
    });
    assert_eq!(
        calls.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "not at start-up"
    );
    let failing = Tunnel {
        command: TunnelCommand::Shell("exit 1".into()),
        timeout_seconds: Some(5),
    };

    let _ = tunnels.ensure("127.0.0.1", free_port(), &failing).await;
    let _ = tunnels.ensure("127.0.0.1", free_port(), &failing).await;

    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_tunnel_that_is_not_needed_never_asks_for_the_path() {
    let (port, _already) = taken_port();
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = calls.clone();
    let tunnels = Tunnels::with_path_resolver(move || {
        counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        String::new()
    });

    tunnels
        .ensure("127.0.0.1", port, &needs_fake_kubectl())
        .await
        .unwrap();

    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_forward_that_answers_but_lets_nothing_through_is_started_again() {
    let (port, dir) = (free_port(), tempfile::tempdir().unwrap());
    let marker = dir.path().join("marker");
    let tunnels = Tunnels::new();
    let tunnel = listener(port, &marker, 30);
    tunnels.ensure("127.0.0.1", port, &tunnel).await.unwrap();

    let failed_at = tokio::time::Instant::now();
    assert!(
        tunnels
            .restart("127.0.0.1", port, &tunnel, failed_at)
            .await
            .unwrap()
    );

    assert_eq!(starts(&marker), 2);
    assert!(answers(port).await);
    tunnels.stop_all().await;
}

#[tokio::test]
async fn a_forward_started_since_the_failure_is_kept() {
    let (port, dir) = (free_port(), tempfile::tempdir().unwrap());
    let marker = dir.path().join("marker");
    let tunnels = Tunnels::new();
    let tunnel = listener(port, &marker, 30);
    let failed_at = tokio::time::Instant::now();
    tunnels.ensure("127.0.0.1", port, &tunnel).await.unwrap();

    assert!(
        tunnels
            .restart("127.0.0.1", port, &tunnel, failed_at)
            .await
            .unwrap()
    );

    assert_eq!(starts(&marker), 1);
    tunnels.stop_all().await;
}

#[tokio::test]
async fn a_forward_an_earlier_run_left_behind_is_replaced() {
    let (port, dir) = (free_port(), tempfile::tempdir().unwrap());
    let marker = dir.path().join("marker");
    let tunnel = listener(port, &marker, 30);
    let TunnelCommand::Args(args) = &tunnel.command else {
        unreachable!()
    };
    let mut earlier = std::process::Command::new(&args[0])
        .args(&args[1..])
        .spawn()
        .unwrap();
    while !answers(port).await {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let tunnels = Tunnels::new();

    let failed_at = tokio::time::Instant::now();
    assert!(
        tunnels
            .restart("127.0.0.1", port, &tunnel, failed_at)
            .await
            .unwrap()
    );

    assert!(
        earlier.wait().is_ok_and(|status| !status.success()),
        "the earlier one was stopped"
    );
    assert_eq!(starts(&marker), 2);
    assert!(answers(port).await);
    tunnels.stop_all().await;
}

#[tokio::test]
async fn whatever_else_holds_the_port_is_left_alone() {
    let ((port, _by_hand), dir) = (taken_port(), tempfile::tempdir().unwrap());
    let marker = dir.path().join("marker");
    let tunnels = Tunnels::new();

    let failed_at = tokio::time::Instant::now();
    let restarted = tunnels
        .restart("127.0.0.1", port, &listener(port, &marker, 30), failed_at)
        .await
        .unwrap();

    assert!(!restarted);
    assert_eq!(starts(&marker), 0);
    assert!(answers(port).await);
}
