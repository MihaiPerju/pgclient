use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::Mutex as AsyncMutex;
use tokio::sync::mpsc::{self, Receiver};
use tokio::time::Instant;
use tokio_postgres::{CancelToken, Client, NoTls};

use crate::edit::{self, Applied, Change, ResultSource};
use crate::error::describe;
use crate::metrics::{self, MetricsSnapshot};
use crate::query::{QueryEvent, stream};
use crate::schema::{self, CatalogTable, ColumnInfo, TableInfo};
use crate::sessions::{self, Session, Stop};
use crate::{Error, ServerConfig, Tunnels};

const EVENT_BACKLOG: usize = 16;
const FALLBACK_DATABASE: &str = "postgres";
const APPLICATION_NAME: &str = "pgclient";

/// Whether the connection never got through, as opposed to a database that answered and said no.
fn unreached(error: &tokio_postgres::Error) -> bool {
    error.as_db_error().is_none()
        && (error.is_closed()
            || std::error::Error::source(error).is_some_and(|source| source.is::<std::io::Error>()))
}

pub struct QueryRun {
    pub id: u64,
    pub events: Receiver<QueryEvent>,
}

#[derive(Default)]
struct Inner {
    next_id: AtomicU64,
    running: Mutex<HashMap<u64, CancelToken>>,
    tunnels: Tunnels,
    /// The one connection kept for watching a database, and which it is for. Only the latest is kept, so watching never
    /// holds more than a single connection open.
    watcher: AsyncMutex<Option<(String, Arc<tokio_postgres::Client>)>>,
}

/// Everything the app can do with a database. Knows nothing of windows or HTTP, so any shell can drive it.
#[derive(Clone, Default)]
pub struct Core {
    inner: Arc<Inner>,
}

impl Core {
    pub fn new() -> Self {
        Self::default()
    }

    /// A core whose tunnels find their programs on the PATH `resolver` gives, for an app that was not started from a terminal.
    pub fn with_tunnel_path_resolver(
        resolver: impl Fn() -> String + Send + Sync + 'static,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                tunnels: Tunnels::with_path_resolver(resolver),
                ..Inner::default()
            }),
        }
    }

    /// Brings up the server's tunnel if it has one that is not up already.
    async fn reach(&self, server: &ServerConfig) -> Result<(), Error> {
        match &server.tunnel {
            Some(tunnel) => {
                self.inner
                    .tunnels
                    .ensure(&server.host, server.port, tunnel)
                    .await
            }
            None => Ok(()),
        }
    }

    /// A connection, through the server's tunnel if it has one. A tunnel that is up but lets nothing through, as one that
    /// outlived its login does, is started again once.
    async fn open(
        &self,
        server: &ServerConfig,
        database: &str,
        application_name: &str,
    ) -> Result<Client, Error> {
        self.reach(server).await?;
        let started = Instant::now();
        let error = match server.try_connect(database, application_name).await {
            Ok(client) => return Ok(client),
            Err(error) => error,
        };
        let Some(tunnel) = &server.tunnel else {
            return Err(error.into());
        };
        if !unreached(&error)
            || !self
                .inner
                .tunnels
                .restart(&server.host, server.port, tunnel, started)
                .await?
        {
            return Err(error.into());
        }
        server
            .try_connect(database, application_name)
            .await
            .map_err(|error| match unreached(&error) {
                true => Error::Database(format!(
                    "{} (the tunnel said: {})",
                    describe(&error),
                    self.inner.tunnels.last_said(server.port)
                )),
                false => error.into(),
            })
    }

    /// Stops the tunnels this app started. Called as it quits, so no port-forward is left running behind it.
    pub async fn stop_tunnels(&self) {
        self.inner.tunnels.stop_all().await;
    }

    async fn watching(
        &self,
        key: &str,
        server: &ServerConfig,
        database: &str,
    ) -> Result<Arc<tokio_postgres::Client>, Error> {
        let mut watcher = self.inner.watcher.lock().await;
        if let Some((current, client)) = watcher.as_ref()
            && current == key
            && !client.is_closed()
        {
            return Ok(client.clone());
        }
        let client = Arc::new(self.open(server, database, "pgclient-metrics").await?);
        *watcher = Some((key.to_string(), client.clone()));
        Ok(client)
    }

    /// How the database is doing now. The connection it asks through is kept between calls, and made again if it was lost.
    pub async fn metrics(
        &self,
        server: &ServerConfig,
        database: &str,
    ) -> Result<MetricsSnapshot, Error> {
        self.reach(server).await?;
        let key = format!(
            "{}@{}:{}/{}",
            server.user, server.host, server.port, database
        );
        let client = self.watching(&key, server, database).await?;
        match metrics::sample(&client).await {
            Ok(snapshot) => Ok(snapshot),
            Err(_) => {
                self.inner.watcher.lock().await.take();
                let client = self.watching(&key, server, database).await?;
                metrics::sample(&client).await
            }
        }
    }

    /// Who is connected to the database and what each is doing, asked through the connection that watches it.
    pub async fn sessions(
        &self,
        server: &ServerConfig,
        database: &str,
    ) -> Result<Vec<Session>, Error> {
        self.reach(server).await?;
        let key = format!(
            "{}@{}:{}/{}",
            server.user, server.host, server.port, database
        );
        let client = self.watching(&key, server, database).await?;
        match sessions::list(&client).await {
            Ok(found) => Ok(found),
            Err(_) => {
                self.inner.watcher.lock().await.take();
                let client = self.watching(&key, server, database).await?;
                sessions::list(&client).await
            }
        }
    }

    /// Cancels a session's query, or ends the session. False when it was not there any more.
    pub async fn stop_session(
        &self,
        server: &ServerConfig,
        database: &str,
        pid: i32,
        how: Stop,
    ) -> Result<bool, Error> {
        sessions::stop(
            &self.open(server, database, APPLICATION_NAME).await?,
            pid,
            how,
        )
        .await
    }

    pub async fn list_tables(
        &self,
        server: &ServerConfig,
        database: &str,
    ) -> Result<Vec<TableInfo>, Error> {
        schema::tables(&self.open(server, database, APPLICATION_NAME).await?).await
    }

    /// Every table and its columns, for suggestions while typing.
    pub async fn catalog(
        &self,
        server: &ServerConfig,
        database: &str,
    ) -> Result<Vec<CatalogTable>, Error> {
        schema::catalog(&self.open(server, database, APPLICATION_NAME).await?).await
    }

    pub async fn list_columns(
        &self,
        server: &ServerConfig,
        database: &str,
        schema_name: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, Error> {
        schema::columns(
            &self.open(server, database, APPLICATION_NAME).await?,
            schema_name,
            table,
        )
        .await
    }

    pub async fn list_databases(&self, server: &ServerConfig) -> Result<Vec<String>, Error> {
        // The server's own database first: on a port-forwarded app database `postgres` may not exist or be allowed.
        let database = server.database.as_deref().unwrap_or(FALLBACK_DATABASE);
        let client = self.open(server, database, APPLICATION_NAME).await?;
        let rows = client
            .query_typed(
                "select datname from pg_database where not datistemplate and datallowconn order by datname",
                &[],
            )
            .await?;
        Ok(rows.iter().map(|row| row.get(0)).collect())
    }

    pub async fn run_query(
        &self,
        server: &ServerConfig,
        database: &str,
        sql: &str,
    ) -> Result<QueryRun, Error> {
        let client = self.open(server, database, APPLICATION_NAME).await?;
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        self.inner
            .running
            .lock()
            .unwrap()
            .insert(id, client.cancel_token());
        let (events, receiver) = mpsc::channel(EVENT_BACKLOG);
        let inner = self.inner.clone();
        let sql = sql.to_string();
        tokio::spawn(async move {
            stream(client, sql, events).await;
            inner.running.lock().unwrap().remove(&id);
        });
        Ok(QueryRun {
            id,
            events: receiver,
        })
    }

    /// Whether the rows `sql` gives can be changed where they came from, and what they would be found by.
    pub async fn source_of(
        &self,
        server: &ServerConfig,
        database: &str,
        sql: &str,
    ) -> Result<ResultSource, Error> {
        let client = self.open(server, database, APPLICATION_NAME).await?;
        Ok(edit::source_of(&client, sql).await)
    }

    /// Deletes and changes rows of a table all together, or not at all.
    pub async fn apply_changes(
        &self,
        server: &ServerConfig,
        database: &str,
        schema_name: &str,
        table: &str,
        changes: &[Change],
    ) -> Result<Applied, Error> {
        let mut client = self.open(server, database, APPLICATION_NAME).await?;
        edit::apply(&mut client, schema_name, table, changes).await
    }

    pub async fn cancel(&self, id: u64) {
        let token = self.inner.running.lock().unwrap().get(&id).cloned();
        if let Some(token) = token {
            let _ = token.cancel_query(NoTls).await;
        }
    }
}
