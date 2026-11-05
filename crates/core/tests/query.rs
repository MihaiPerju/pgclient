//! What running SQL looks like from the outside. Needs the throwaway Postgres in compose.test.yaml.

use std::time::{Duration, Instant};

use pgclient_core::{Core, QueryEvent, ServerConfig};

fn server() -> ServerConfig {
    ServerConfig {
        host: "localhost".into(),
        port: 5435,
        user: "pgclient".into(),
        password: "pgclient".into(),
        database: None,
        passfile: None,
        tunnel: None,
    }
}

const DB: &str = "pgclient_test";

async fn run(sql: &str) -> Vec<QueryEvent> {
    let core = Core::new();
    let mut run = core.run_query(&server(), DB, sql).await.expect("connects");
    let mut events = Vec::new();
    while let Some(event) = run.events.recv().await {
        events.push(event);
    }
    events
}

fn rows(events: &[QueryEvent]) -> Vec<Vec<Option<String>>> {
    events
        .iter()
        .filter_map(|event| match event {
            QueryEvent::Rows { rows } => Some(rows.clone()),
            _ => None,
        })
        .flatten()
        .collect()
}

fn cell(text: &str) -> Option<String> {
    Some(text.to_string())
}

#[tokio::test]
async fn the_databases_of_a_server_are_listed_without_templates() {
    let databases = Core::new().list_databases(&server()).await.expect("lists");

    assert!(databases.contains(&DB.to_string()));
    assert!(!databases.contains(&"template0".to_string()));
    assert!(!databases.contains(&"template1".to_string()));
}

#[tokio::test]
async fn a_select_gives_its_columns_then_its_rows_as_text() {
    let events = run("select 1 as id, 'ada' as name").await;

    assert_eq!(
        events[0],
        QueryEvent::ResultStarted {
            columns: vec!["id".into(), "name".into()]
        }
    );
    assert_eq!(rows(&events), vec![vec![cell("1"), cell("ada")]]);
    assert!(matches!(events.last(), Some(QueryEvent::Finished { .. })));
}

#[tokio::test]
async fn null_is_not_the_same_as_the_text_null() {
    let events = run("select null::text as nothing, 'null' as word").await;

    assert_eq!(rows(&events), vec![vec![None, cell("null")]]);
}

#[tokio::test]
async fn every_type_reads_the_way_psql_shows_it() {
    let events = run(
        "select 1.50::numeric, timestamptz '2026-10-14 12:00:00+00', array[1,2,3], '{\"a\": 1}'::jsonb, true, date '2026-10-14'",
    )
    .await;

    assert_eq!(
        rows(&events),
        vec![vec![
            cell("1.50"),
            cell("2026-10-14 12:00:00+00"),
            cell("{1,2,3}"),
            cell("{\"a\": 1}"),
            cell("t"),
            cell("2026-10-14"),
        ]]
    );
}

#[tokio::test]
async fn a_query_with_no_rows_still_gives_its_columns() {
    let events = run("select 1 as id where false").await;

    assert_eq!(
        events[0],
        QueryEvent::ResultStarted {
            columns: vec!["id".into()]
        }
    );
    assert!(rows(&events).is_empty());
}

#[tokio::test]
async fn several_statements_give_a_result_each_in_order() {
    let events = run(
        "create temp table people (name text); insert into people values ('ada'), ('grace'); select name from people order by name",
    )
    .await;

    let finished: Vec<u64> = events
        .iter()
        .filter_map(|event| match event {
            QueryEvent::ResultFinished { rows_affected } => Some(*rows_affected),
            _ => None,
        })
        .collect();
    assert_eq!(finished, vec![0, 2, 2]);
    assert_eq!(rows(&events), vec![vec![cell("ada")], vec![cell("grace")]]);
}

#[tokio::test]
async fn a_big_result_arrives_in_chunks_not_all_at_once() {
    let events = run("select g from generate_series(1, 25000) g").await;

    let chunks = events
        .iter()
        .filter(|event| matches!(event, QueryEvent::Rows { .. }))
        .count();
    assert!(chunks > 1, "expected several chunks, got {chunks}");
    assert_eq!(rows(&events).len(), 25000);
}

#[tokio::test]
async fn a_mistake_in_the_sql_says_what_and_where_and_keeps_what_ran_before_it() {
    let events = run("select 1 as ok; select nope from nowhere").await;

    assert_eq!(rows(&events), vec![vec![cell("1")]]);
    match events.last() {
        Some(QueryEvent::Failed { message }) => assert!(message.contains("nowhere"), "{message}"),
        other => panic!("expected a failure, got {other:?}"),
    }
}

#[tokio::test]
async fn a_running_query_can_be_cancelled() {
    let core = Core::new();
    let mut run = core
        .run_query(&server(), DB, "select pg_sleep(30)")
        .await
        .expect("connects");
    let started = Instant::now();

    tokio::time::sleep(Duration::from_millis(300)).await;
    core.cancel(run.id).await;

    let mut last = None;
    while let Some(event) = run.events.recv().await {
        last = Some(event);
    }
    assert!(started.elapsed() < Duration::from_secs(5));
    match last {
        Some(QueryEvent::Failed { message }) => assert!(message.contains("cancel"), "{message}"),
        other => panic!("expected a cancellation, got {other:?}"),
    }
}

#[tokio::test]
async fn a_server_that_cannot_be_reached_is_an_error_not_a_hang() {
    let mut unreachable = server();
    unreachable.port = 1;

    let result = Core::new().run_query(&unreachable, DB, "select 1").await;

    assert!(result.is_err());
}

#[tokio::test]
async fn a_wrong_password_is_refused_with_a_reason() {
    let mut wrong = server();
    wrong.password = "not-the-password".into();

    let error = Core::new().list_databases(&wrong).await.unwrap_err();

    assert!(
        error.to_string().to_lowercase().contains("password"),
        "{error}"
    );
}

/// A port-forward stand-in: listens on `port` and passes everything on to the test database.
fn forward_to_test_database(port: u16) -> pgclient_core::Tunnel {
    let script = format!(
        "import asyncio\n\
         async def pipe(r, w):\n    try:\n        while data := await r.read(65536):\n            w.write(data); await w.drain()\n    finally:\n        w.close()\n\
         async def handle(r, w):\n    ur, uw = await asyncio.open_connection('127.0.0.1', 5435)\n    await asyncio.gather(pipe(r, uw), pipe(ur, w))\n\
         async def main():\n    s = await asyncio.start_server(handle, '127.0.0.1', {port})\n    await s.serve_forever()\n\
         asyncio.run(main())"
    );
    pgclient_core::Tunnel {
        command: pgclient_core::TunnelCommand::Args(vec!["python3".into(), "-c".into(), script]),
        timeout_seconds: Some(10),
    }
}

#[tokio::test]
async fn a_server_with_a_tunnel_is_reached_through_it_without_starting_it_by_hand() {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let mut through_tunnel = server();
    through_tunnel.host = "127.0.0.1".into();
    through_tunnel.port = port;
    through_tunnel.tunnel = Some(forward_to_test_database(port));
    let core = Core::new();

    let databases = core
        .list_databases(&through_tunnel)
        .await
        .expect("lists through the tunnel");
    let mut run = core
        .run_query(&through_tunnel, DB, "select 42")
        .await
        .expect("runs through the tunnel");
    let mut events = Vec::new();
    while let Some(event) = run.events.recv().await {
        events.push(event);
    }
    core.stop_tunnels().await;

    assert!(databases.contains(&DB.to_string()));
    assert_eq!(rows(&events), vec![vec![cell("42")]]);
}
