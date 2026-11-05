//! Who is connected and what each is doing, read from real sessions in the throwaway Postgres.

mod common;

use std::time::Duration;

use common::{TEST_DB, test_server};
use pgclient_core::{Core, Session, Stop};
use tokio_postgres::{Client, NoTls};

async fn session(application: &str) -> Client {
    let (client, connection) = tokio_postgres::connect(
        &format!("host=localhost port=5435 user=pgclient password=pgclient dbname={TEST_DB} application_name={application}"),
        NoTls,
    )
    .await
    .expect("connects");
    tokio::spawn(async move {
        let _ = connection.await;
    });
    client
}

async fn pid_of(client: &Client) -> i32 {
    client
        .query_one("select pg_backend_pid()", &[])
        .await
        .unwrap()
        .get(0)
}

async fn sessions(core: &Core) -> Vec<Session> {
    core.sessions(&test_server(), TEST_DB)
        .await
        .expect("reads sessions")
}

#[tokio::test]
async fn a_busy_session_shows_what_it_runs_and_for_how_long() {
    let busy = session("sessions-busy").await;
    let pid = pid_of(&busy).await;
    let running = tokio::spawn(async move {
        busy.simple_query("select pg_sleep(2) as sessions_busy")
            .await
    });
    tokio::time::sleep(Duration::from_millis(600)).await;

    let found = sessions(&Core::new())
        .await
        .into_iter()
        .find(|session| session.pid == pid)
        .expect("listed");

    assert_eq!(found.state.as_deref(), Some("active"));
    assert_eq!(found.application, "sessions-busy");
    assert_eq!(found.user.as_deref(), Some("pgclient"));
    assert!(
        found
            .query
            .as_deref()
            .unwrap_or("")
            .contains("sessions_busy"),
        "{found:?}"
    );
    assert!(found.query_seconds.unwrap_or(0.0) >= 0.4, "{found:?}");
    let _ = running.await;
}

#[tokio::test]
async fn the_connection_that_looks_is_not_listed() {
    let core = Core::new();
    let listed = sessions(&core).await;

    assert!(
        listed
            .iter()
            .all(|session| session.application != "pgclient-metrics"),
        "{listed:?}"
    );
}

#[tokio::test]
async fn a_session_waiting_on_a_lock_says_who_holds_it() {
    let setup = session("sessions-setup").await;
    setup
        .batch_execute("create table if not exists sessions_locked (id int)")
        .await
        .unwrap();
    let holder = session("sessions-holder").await;
    let holder_pid = pid_of(&holder).await;
    holder
        .batch_execute("begin; lock table sessions_locked in access exclusive mode")
        .await
        .unwrap();
    let waiter = session("sessions-waiter").await;
    let waiter_pid = pid_of(&waiter).await;
    let waiting =
        tokio::spawn(async move { waiter.simple_query("select * from sessions_locked").await });
    tokio::time::sleep(Duration::from_millis(600)).await;

    let listed = sessions(&Core::new()).await;
    let blocked = listed
        .iter()
        .find(|session| session.pid == waiter_pid)
        .expect("waiter listed");
    let holding = listed
        .iter()
        .find(|session| session.pid == holder_pid)
        .expect("holder listed");

    assert_eq!(blocked.blocked_by, vec![holder_pid]);
    assert_eq!(blocked.wait_event_type.as_deref(), Some("Lock"));
    assert_eq!(holding.state.as_deref(), Some("idle in transaction"));
    assert!(holding.transaction_seconds.is_some());
    holder.batch_execute("rollback").await.unwrap();
    let _ = waiting.await;
}

#[tokio::test]
async fn cancelling_stops_the_query_and_keeps_the_session() {
    let busy = session("sessions-cancel").await;
    let pid = pid_of(&busy).await;
    let running = tokio::spawn(async move {
        let outcome = busy.simple_query("select pg_sleep(30)").await;
        (outcome, busy)
    });
    tokio::time::sleep(Duration::from_millis(400)).await;

    let stopped = Core::new()
        .stop_session(&test_server(), TEST_DB, pid, Stop::Cancel)
        .await
        .expect("asks");

    assert!(stopped);
    let (outcome, busy) = tokio::time::timeout(Duration::from_secs(5), running)
        .await
        .expect("stops soon")
        .unwrap();
    assert_eq!(
        outcome.unwrap_err().code(),
        Some(&tokio_postgres::error::SqlState::QUERY_CANCELED)
    );
    assert!(busy.simple_query("select 1").await.is_ok());
}

#[tokio::test]
async fn ending_a_session_closes_its_connection() {
    let doomed = session("sessions-end").await;
    let pid = pid_of(&doomed).await;

    let stopped = Core::new()
        .stop_session(&test_server(), TEST_DB, pid, Stop::Terminate)
        .await
        .expect("asks");

    assert!(stopped);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(doomed.simple_query("select 1").await.is_err());
}

#[tokio::test]
async fn stopping_a_session_that_is_gone_says_so() {
    let stopped = Core::new()
        .stop_session(&test_server(), TEST_DB, 999_999, Stop::Cancel)
        .await
        .expect("asks");

    assert!(!stopped);
}
