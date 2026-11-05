//! A tunnel that is up but lets nothing through is started again, and the database reached through the new one.

mod common;

use std::time::Duration;

use common::{TEST_DB, test_server};
use pgclient_core::{Core, ServerConfig, Tunnel, TunnelCommand};

/// A port nothing answers on, below the ones outgoing connections come from, a different one for each `nth`.
fn free_port(nth: u16) -> u16 {
    let mut port = 20_000 + (std::process::id() % 14_000) as u16 * 2 + nth;
    loop {
        let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        if std::net::TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_err() {
            return port;
        }
        port += 2;
    }
}

/// A forward to the test database that, the first time it is started, takes every connection and drops it, as one whose
/// login has run out does.
fn forward(port: u16, marker: &std::path::Path) -> Tunnel {
    let target = test_server().port;
    let script = format!(
        r#"
import os, socket, threading
first = not os.path.exists({marker:?})
open({marker:?}, "a").write("started\n")
server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", {port}))
server.listen()
def pipe(a, b):
    try:
        while data := a.recv(65536):
            b.sendall(data)
    except OSError:
        pass
    finally:
        try:
            b.shutdown(socket.SHUT_WR)
        except OSError:
            pass
while True:
    client, _ = server.accept()
    if first:
        client.close()
        continue
    upstream = socket.create_connection(("127.0.0.1", {target}))
    threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
    threading.Thread(target=pipe, args=(upstream, client), daemon=True).start()
"#
    );
    Tunnel {
        command: TunnelCommand::Args(vec!["python3".into(), "-c".into(), script]),
        timeout_seconds: Some(10),
    }
}

fn through(port: u16, tunnel: Tunnel) -> ServerConfig {
    ServerConfig {
        host: "127.0.0.1".into(),
        port,
        database: Some(TEST_DB.into()),
        tunnel: Some(tunnel),
        ..test_server()
    }
}

fn starts(marker: &std::path::Path) -> usize {
    std::fs::read_to_string(marker)
        .map(|text| text.lines().count())
        .unwrap_or(0)
}

#[tokio::test]
async fn a_tunnel_that_lets_nothing_through_is_started_again_and_the_database_reached() {
    let (port, dir) = (free_port(0), tempfile::tempdir().unwrap());
    let marker = dir.path().join("marker");
    let core = Core::new();

    let databases = core
        .list_databases(&through(port, forward(port, &marker)))
        .await
        .unwrap();

    assert!(databases.contains(&TEST_DB.to_string()), "{databases:?}");
    assert_eq!(starts(&marker), 2);
    core.stop_tunnels().await;
}

#[tokio::test]
async fn a_database_that_answers_no_leaves_the_tunnel_alone() {
    let (port, dir) = (free_port(1), tempfile::tempdir().unwrap());
    let marker = dir.path().join("marker");
    std::fs::write(&marker, "started\n").unwrap();
    let core = Core::new();

    let error = core
        .list_tables(&through(port, forward(port, &marker)), "no_such_database")
        .await
        .unwrap_err();

    assert!(error.to_string().contains("does not exist"), "{error}");
    assert_eq!(starts(&marker), 2, "started once, never again");
    core.stop_tunnels().await;
}
