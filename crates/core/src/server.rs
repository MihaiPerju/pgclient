use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio_postgres::{Client, Config, NoTls};

use crate::{PassFile, Tunnel};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    /// What was given for it, if anything. Otherwise the password comes from `passfile`.
    pub password: String,
    /// Where a connection starts, and which database lists the others.
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub passfile: Option<PathBuf>,
    /// Started before connecting if the port is not already answering.
    #[serde(default)]
    pub tunnel: Option<Tunnel>,
}

impl ServerConfig {
    /// A password that was given wins. Otherwise ~/.pgpass is asked: first for the database being opened, as psql does, and
    /// then for the server, since its other databases take the same password.
    pub fn password_for(&self, database: &str) -> String {
        if !self.password.is_empty() {
            return self.password.clone();
        }
        let Some(passfile) = self.passfile.as_deref().map(PassFile::read) else {
            return String::new();
        };
        passfile
            .lookup(&self.host, self.port, database, &self.user)
            .or_else(|| passfile.lookup_for_server(&self.host, self.port, &self.user))
            .unwrap_or_default()
    }

    /// The name shows in the server's own list of sessions, so whoever looks after it can tell what a connection is for. The
    /// driver's error is kept, so a caller can tell a database that said no from one never reached.
    pub(crate) async fn try_connect(
        &self,
        database: &str,
        application_name: &str,
    ) -> Result<Client, tokio_postgres::Error> {
        let (client, connection) = Config::new()
            .application_name(application_name)
            .host(&self.host)
            .port(self.port)
            .user(&self.user)
            .password(self.password_for(database))
            .dbname(database)
            .connect_timeout(CONNECT_TIMEOUT)
            .connect(NoTls)
            .await?;
        // The connection does its work only while it is polled, and it ends by itself once the client is dropped.
        tokio::spawn(async move {
            let _ = connection.await;
        });
        Ok(client)
    }
}
