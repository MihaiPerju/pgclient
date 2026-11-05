use serde::{Deserialize, Serialize};
use tokio_postgres::Client;

use crate::Error;

/// A connection to the database and what it is doing now, as `pg_stat_activity` has it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Session {
    pub pid: i32,
    pub user: Option<String>,
    pub application: String,
    pub client: Option<String>,
    /// active, idle, idle in transaction, … or nothing when it may not be seen.
    pub state: Option<String>,
    pub wait_event_type: Option<String>,
    pub wait_event: Option<String>,
    /// What it runs, or last ran when idle.
    pub query: Option<String>,
    /// Seconds since its transaction, its query and its state began, and since it connected.
    pub transaction_seconds: Option<f64>,
    pub query_seconds: Option<f64>,
    pub state_seconds: Option<f64>,
    pub connected_seconds: Option<f64>,
    /// The sessions holding a lock it waits for.
    pub blocked_by: Vec<i32>,
}

/// How to stop a session: its query only, or the whole connection.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stop {
    Cancel,
    Terminate,
}

/// The sessions on this database, leaving out connections that only watch it, such as the one asking.
const SESSIONS: &str = "
select
  pid,
  usename::text as user_name,
  coalesce(application_name, '') as application,
  client_addr::text as client,
  state,
  wait_event_type,
  wait_event,
  query,
  extract(epoch from clock_timestamp() - xact_start)::float8 as transaction_seconds,
  extract(epoch from clock_timestamp() - query_start)::float8 as query_seconds,
  extract(epoch from clock_timestamp() - state_change)::float8 as state_seconds,
  extract(epoch from clock_timestamp() - backend_start)::float8 as connected_seconds,
  pg_blocking_pids(pid) as blocked_by
from pg_stat_activity
where backend_type = 'client backend'
  and datname = current_database()
  and pid <> pg_backend_pid()
  and application_name <> 'pgclient-metrics'
order by pid";

pub(crate) async fn list(client: &Client) -> Result<Vec<Session>, Error> {
    Ok(client
        .query_typed(SESSIONS, &[])
        .await?
        .iter()
        .map(|row| Session {
            pid: row.get("pid"),
            user: row.get("user_name"),
            application: row.get("application"),
            client: row.get("client"),
            state: row.get("state"),
            wait_event_type: row.get("wait_event_type"),
            wait_event: row.get("wait_event"),
            query: row.get("query"),
            transaction_seconds: row.get("transaction_seconds"),
            query_seconds: row.get("query_seconds"),
            state_seconds: row.get("state_seconds"),
            connected_seconds: row.get("connected_seconds"),
            blocked_by: row
                .get::<_, Option<Vec<i32>>>("blocked_by")
                .unwrap_or_default(),
        })
        .collect())
}

/// Whether the session was there to be stopped. Postgres refuses, with why, when the user may not.
pub(crate) async fn stop(client: &Client, pid: i32, how: Stop) -> Result<bool, Error> {
    let sql = match how {
        Stop::Cancel => "select pg_cancel_backend($1)",
        Stop::Terminate => "select pg_terminate_backend($1)",
    };
    Ok(client.query_one(sql, &[&pid]).await?.get(0))
}
