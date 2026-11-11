//! What a person watching a database wants to see at a glance, read from real sessions in the throwaway Postgres.

mod common;

use std::time::Duration;

use common::{TEST_DB, run_sql, test_server};
use pgclient_core::Core;
use tokio_postgres::{Client, NoTls};

/// A session of our own to hold a state open, since the tests need to control exactly what the database is doing.
async fn session(user: &str, password: &str) -> Client {
    let (client, connection) = tokio_postgres::connect(
        &format!("host=localhost port=5435 user={user} password={password} dbname={TEST_DB}"),
        NoTls,
    )
    .await
    .expect("connects");
    tokio::spawn(async move {
        let _ = connection.await;
    });
    client
}

async fn admin() -> Client {
    session("pgclient", "pgclient").await
}

async fn sample() -> pgclient_core::MetricsSnapshot {
    Core::new()
        .metrics(&test_server(), TEST_DB)
        .await
        .expect("samples")
}

#[tokio::test]
async fn it_says_how_many_connections_there_are_against_how_many_are_allowed() {
    let _held = admin().await;

    let snapshot = sample().await;

    assert!(snapshot.connections >= 2, "{snapshot:?}");
    assert!(
        snapshot.max_connections >= snapshot.connections,
        "{snapshot:?}"
    );
    assert!(snapshot.max_connections > 0);
}

#[tokio::test]
async fn it_names_the_database_it_looked_at() {
    assert_eq!(sample().await.database, TEST_DB);
}

#[tokio::test]
async fn a_session_that_is_busy_counts_as_active_and_one_that_is_waiting_around_counts_as_idle() {
    let busy = admin().await;
    let _idle = admin().await;
    let running = tokio::spawn(async move { busy.simple_query("select pg_sleep(2)").await });
    tokio::time::sleep(Duration::from_millis(500)).await;

    let snapshot = sample().await;

    assert!(snapshot.active >= 1, "{snapshot:?}");
    assert!(snapshot.idle >= 1, "{snapshot:?}");
    running.abort();
}

#[tokio::test]
async fn the_session_that_is_asking_is_not_counted_as_active() {
    // A user who can see only their own sessions sees nothing else here, however busy the rest of the server is, so if the
    // session that asks counted itself as work this would be 1.
    run_sql("drop role if exists metrics_solo; create role metrics_solo login password 'solo'")
        .await;
    let mut solo = test_server();
    solo.user = "metrics_solo".into();
    solo.password = "solo".into();

    let snapshot = Core::new().metrics(&solo, TEST_DB).await.expect("samples");

    assert_eq!(
        snapshot.active, 0,
        "the metrics session must not count itself as work: {snapshot:?}"
    );
    assert!(snapshot.connections >= 1);
    run_sql("drop role if exists metrics_solo").await;
}

#[tokio::test]
async fn a_transaction_left_open_is_counted_since_it_holds_locks_while_doing_nothing() {
    let client = admin().await;
    client.batch_execute("begin; select 1").await.unwrap();

    let snapshot = sample().await;

    assert!(snapshot.idle_in_transaction >= 1, "{snapshot:?}");
}

#[tokio::test]
async fn the_longest_running_query_is_timed() {
    let busy = admin().await;
    let running = tokio::spawn(async move { busy.simple_query("select pg_sleep(4)").await });
    tokio::time::sleep(Duration::from_millis(1300)).await;

    let snapshot = sample().await;

    let longest = snapshot
        .longest_active_seconds
        .expect("something is running");
    assert!(longest >= 1.0, "{longest}");
    running.abort();
}

#[tokio::test]
async fn the_longest_open_transaction_is_timed_however_quick_its_queries_are() {
    let open = admin().await;
    open.batch_execute("begin; select 1").await.unwrap();
    tokio::time::sleep(Duration::from_millis(1300)).await;

    let snapshot = sample().await;

    let longest = snapshot
        .longest_transaction_seconds
        .expect("a transaction is open");
    assert!(longest >= 1.0, "{longest}");
    open.batch_execute("rollback").await.unwrap();
}

#[tokio::test]
async fn a_session_waiting_on_a_lock_is_counted_as_blocked() {
    run_sql("drop table if exists metrics_locked; create table metrics_locked (id int)").await;
    let holder = admin().await;
    holder
        .batch_execute("begin; lock table metrics_locked in access exclusive mode")
        .await
        .unwrap();
    let waiter = admin().await;
    let waiting =
        tokio::spawn(async move { waiter.simple_query("select * from metrics_locked").await });
    tokio::time::sleep(Duration::from_millis(700)).await;

    let snapshot = sample().await;

    assert!(snapshot.blocked >= 1, "{snapshot:?}");
    holder.batch_execute("rollback").await.unwrap();
    let _ = waiting.await;
    run_sql("drop table if exists metrics_locked").await;
}

#[tokio::test]
async fn the_counters_that_rates_are_made_from_go_up_as_work_is_done() {
    let before = sample().await;
    for _ in 0..20 {
        run_sql("select 1").await;
    }

    let after = sample().await;

    assert!(
        after.transactions >= before.transactions + 20,
        "{} -> {}",
        before.transactions,
        after.transactions
    );
    assert!(
        after.sampled_at > before.sampled_at,
        "time moves on by the server's clock"
    );
    assert!(after.blocks_hit >= before.blocks_hit);
    assert!(after.rollbacks >= before.rollbacks && after.deadlocks >= before.deadlocks);
}

#[tokio::test]
async fn a_user_who_can_see_everything_is_told_so() {
    assert!(sample().await.full_view);
}

#[tokio::test]
async fn a_user_who_can_only_see_their_own_sessions_is_told_the_view_is_limited() {
    run_sql(
        "drop role if exists metrics_limited; create role metrics_limited login password 'limited'",
    )
    .await;
    let mut limited = test_server();
    limited.user = "metrics_limited".into();
    limited.password = "limited".into();

    let snapshot = Core::new()
        .metrics(&limited, TEST_DB)
        .await
        .expect("samples");

    assert!(!snapshot.full_view, "{snapshot:?}");
    run_sql("drop role if exists metrics_limited").await;
}

/// A user of its own, so a test looking at sessions or ending them touches only its own and not a neighbour's.
async fn own_user(name: &str) -> pgclient_core::ServerConfig {
    run_sql(&format!(
        "drop role if exists {name}; create role {name} login password '{name}'"
    ))
    .await;
    let mut server = test_server();
    server.user = name.into();
    server.password = name.into();
    server
}

#[tokio::test]
async fn it_goes_on_working_after_the_connection_it_keeps_is_killed() {
    let server = own_user("metrics_victim").await;
    let core = Core::new();
    core.metrics(&server, TEST_DB).await.expect("first sample");
    let killer = admin().await;
    killer.simple_query("select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'pgclient-metrics' and usename = 'metrics_victim'").await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;

    let again = core.metrics(&server, TEST_DB).await;

    assert!(again.is_ok(), "{again:?}");
    run_sql("drop role if exists metrics_victim").await;
}

#[tokio::test]
async fn one_connection_is_kept_and_reused_so_watching_does_not_fill_the_servers_log() {
    let server = own_user("metrics_reuse").await;
    let core = Core::new();
    let watcher = admin().await;

    for _ in 0..5 {
        core.metrics(&server, TEST_DB).await.unwrap();
    }

    let kept: i64 = watcher
        .query_one("select count(*)::int8 from pg_stat_activity where application_name = 'pgclient-metrics' and usename = 'metrics_reuse'", &[])
        .await
        .unwrap()
        .get(0);
    assert_eq!(kept, 1, "five samples must share one connection");
    run_sql("drop role if exists metrics_reuse").await;
}

#[tokio::test]
async fn a_server_that_cannot_be_reached_is_an_error() {
    let mut unreachable = test_server();
    unreachable.port = 1;

    assert!(Core::new().metrics(&unreachable, TEST_DB).await.is_err());
}

#[tokio::test]
async fn the_counters_of_this_database_only_go_up_as_work_is_done_in_it() {
    run_sql("drop table if exists metrics_counted; create table metrics_counted (n int)").await;
    let before = sample().await;

    run_sql("insert into metrics_counted select generate_series(1, 50); update metrics_counted set n = n + 1; delete from metrics_counted where n > 40; select * from metrics_counted").await;
    // The statistics of a database are handed over a moment after the work, not at the instant of it.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let after = sample().await;

    assert!(
        after.tuples_inserted >= before.tuples_inserted + 50,
        "{before:?} {after:?}"
    );
    assert!(
        after.tuples_updated >= before.tuples_updated + 50,
        "{before:?} {after:?}"
    );
    assert!(
        after.tuples_deleted > before.tuples_deleted,
        "{before:?} {after:?}"
    );
    assert!(
        after.tuples_fetched + after.tuples_returned
            > before.tuples_fetched + before.tuples_returned
    );
    assert!(after.commits > before.commits, "{before:?} {after:?}");
}

#[tokio::test]
async fn a_rolled_back_transaction_is_counted_apart_from_the_commits() {
    let before = sample().await;
    let client = admin().await;
    client
        .simple_query("begin; select 1; rollback")
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(1500)).await;

    let after = sample().await;

    assert!(
        after.database_rollbacks > before.database_rollbacks,
        "{before:?} {after:?}"
    );
}

#[tokio::test]
async fn it_counts_the_wal_records_written_so_a_rate_can_be_taken_from_two_samples() {
    let before = sample().await.wal_records.expect("pg_stat_wal exists");
    run_sql("drop table if exists metrics_wal; create table metrics_wal (id int); insert into metrics_wal select generate_series(1, 100)").await;

    let after = sample().await.wal_records.expect("pg_stat_wal exists");

    assert!(after > before, "{before} then {after}");
    run_sql("drop table if exists metrics_wal").await;
}
