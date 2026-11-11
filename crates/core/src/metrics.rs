use serde::Serialize;
use tokio_postgres::Client;

use crate::Error;

/// How a database is doing at one moment. The counters only ever go up, so a rate is the difference between two snapshots
/// divided by the time between them, which is why the time is the server's own and not ours.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MetricsSnapshot {
    pub database: String,
    pub connections: i64,
    pub active: i64,
    pub idle: i64,
    pub idle_in_transaction: i64,
    pub max_connections: i64,
    pub longest_active_seconds: Option<f64>,
    /// How long the oldest open transaction has been open, whether it is running something or idle.
    pub longest_transaction_seconds: Option<f64>,
    pub blocked: i64,
    /// Commits and rollbacks, across the whole server.
    pub transactions: i64,
    pub rollbacks: i64,
    pub deadlocks: i64,
    pub blocks_hit: i64,
    pub blocks_read: i64,
    /// What happened in this database alone, as counters that only go up, from which the charts take their rates.
    pub commits: i64,
    pub database_rollbacks: i64,
    pub tuples_inserted: i64,
    pub tuples_updated: i64,
    pub tuples_deleted: i64,
    pub tuples_fetched: i64,
    pub tuples_returned: i64,
    /// Records written to the write-ahead log, across the whole server, or nothing before Postgres 14, which does not count them.
    pub wal_records: Option<i64>,
    /// Seconds since 1970 by the server's clock.
    pub sampled_at: f64,
    /// False when the user can only see their own sessions, so the counts of connections and queries leave others out.
    pub full_view: bool,
}

/// Everything in one statement, so a sample is one round trip, which matters over a port-forward.
const SNAPSHOT: &str = "
select
  current_database()::text as database,
  (select count(*) from pg_stat_activity where backend_type = 'client backend')::int8 as connections,
  (select count(*) from pg_stat_activity where backend_type = 'client backend' and state = 'active' and pid <> pg_backend_pid())::int8 as active,
  (select count(*) from pg_stat_activity where backend_type = 'client backend' and state = 'idle')::int8 as idle,
  (select count(*) from pg_stat_activity where backend_type = 'client backend' and state like 'idle in transaction%')::int8 as idle_in_transaction,
  current_setting('max_connections')::int8 as max_connections,
  (select extract(epoch from max(now() - query_start))::float8 from pg_stat_activity
     where backend_type = 'client backend' and state = 'active' and pid <> pg_backend_pid()) as longest_active_seconds,
  (select extract(epoch from max(now() - xact_start))::float8 from pg_stat_activity
     where backend_type = 'client backend' and xact_start is not null and pid <> pg_backend_pid()) as longest_transaction_seconds,
  (select count(*) from pg_stat_activity where backend_type = 'client backend' and wait_event_type = 'Lock')::int8 as blocked,
  (select coalesce(sum(xact_commit + xact_rollback), 0)::int8 from pg_stat_database) as transactions,
  (select coalesce(sum(xact_rollback), 0)::int8 from pg_stat_database) as rollbacks,
  (select coalesce(sum(deadlocks), 0)::int8 from pg_stat_database) as deadlocks,
  coalesce(d.blks_hit, 0)::int8 as blocks_hit,
  coalesce(d.blks_read, 0)::int8 as blocks_read,
  coalesce(d.xact_commit, 0)::int8 as commits,
  coalesce(d.xact_rollback, 0)::int8 as database_rollbacks,
  coalesce(d.tup_inserted, 0)::int8 as tuples_inserted,
  coalesce(d.tup_updated, 0)::int8 as tuples_updated,
  coalesce(d.tup_deleted, 0)::int8 as tuples_deleted,
  coalesce(d.tup_fetched, 0)::int8 as tuples_fetched,
  coalesce(d.tup_returned, 0)::int8 as tuples_returned,
  extract(epoch from clock_timestamp())::float8 as sampled_at,
  (coalesce((select rolsuper from pg_roles where rolname = current_user), false)
     or pg_has_role(current_user, 'pg_read_all_stats', 'member')) as full_view
from (select 1) as one
left join pg_stat_database d on d.datname = current_database()";

const WAL_RECORDS: &str = "select wal_records::int8 from pg_stat_wal";

pub(crate) async fn sample(client: &Client) -> Result<MetricsSnapshot, Error> {
    // Sent together so the extra read costs no round trip. It fails before Postgres 14, which is no reason to fail the sample.
    let (snapshot, wal) = tokio::join!(
        client.query_typed(SNAPSHOT, &[]),
        client.query_typed(WAL_RECORDS, &[])
    );
    let wal_records = wal
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .map(|row| row.get::<_, i64>("wal_records"));
    let row = snapshot?
        .into_iter()
        .next()
        .ok_or_else(|| Error::Database("The metrics query returned no row".into()))?;
    Ok(MetricsSnapshot {
        database: row.get("database"),
        connections: row.get("connections"),
        active: row.get("active"),
        idle: row.get("idle"),
        idle_in_transaction: row.get("idle_in_transaction"),
        max_connections: row.get("max_connections"),
        longest_active_seconds: row.get("longest_active_seconds"),
        longest_transaction_seconds: row.get("longest_transaction_seconds"),
        blocked: row.get("blocked"),
        transactions: row.get("transactions"),
        rollbacks: row.get("rollbacks"),
        deadlocks: row.get("deadlocks"),
        blocks_hit: row.get("blocks_hit"),
        blocks_read: row.get("blocks_read"),
        commits: row.get("commits"),
        database_rollbacks: row.get("database_rollbacks"),
        tuples_inserted: row.get("tuples_inserted"),
        tuples_updated: row.get("tuples_updated"),
        tuples_deleted: row.get("tuples_deleted"),
        tuples_fetched: row.get("tuples_fetched"),
        tuples_returned: row.get("tuples_returned"),
        wal_records,
        sampled_at: row.get("sampled_at"),
        full_view: row.get("full_view"),
    })
}
