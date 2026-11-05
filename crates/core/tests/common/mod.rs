// Each test file uses a different part of this, so any one of them leaves the rest unused.
#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use pgclient_core::{Error, SecretStore, ServerBook};

#[derive(Default)]
pub struct MemorySecrets(Mutex<HashMap<String, String>>);

impl SecretStore for MemorySecrets {
    fn get(&self, id: &str) -> Result<Option<String>, Error> {
        Ok(self.0.lock().unwrap().get(id).cloned())
    }
    fn set(&self, id: &str, secret: &str) -> Result<(), Error> {
        self.0.lock().unwrap().insert(id.into(), secret.into());
        Ok(())
    }
    fn delete(&self, id: &str) -> Result<(), Error> {
        self.0.lock().unwrap().remove(id);
        Ok(())
    }
}

pub struct Fixture {
    pub book: ServerBook,
    pub secrets: Arc<MemorySecrets>,
    pub dir: tempfile::TempDir,
}

pub fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let secrets = Arc::new(MemorySecrets::default());
    let book = ServerBook::new(dir.path().join("servers.json"), secrets.clone());
    Fixture { book, secrets, dir }
}

pub const TEST_DB: &str = "pgclient_test";

pub fn test_server() -> pgclient_core::ServerConfig {
    pgclient_core::ServerConfig {
        host: "localhost".into(),
        port: 5435,
        user: "pgclient".into(),
        password: "pgclient".into(),
        database: None,
        passfile: None,
        tunnel: None,
    }
}

/// Runs SQL against the test database and waits for it to finish, for setting a scene up.
pub async fn run_sql(sql: &str) {
    let mut run = pgclient_core::Core::new()
        .run_query(&test_server(), TEST_DB, sql)
        .await
        .expect("connects");
    while let Some(event) = run.events.recv().await {
        if let pgclient_core::QueryEvent::Failed { message } = event {
            panic!("setup failed: {message}");
        }
    }
}
