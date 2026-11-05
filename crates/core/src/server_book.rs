use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::interchange::read_servers_file;
use crate::{Error, ServerConfig, Tunnel};

const FILE_ID_PREFIX: &str = "file:";

/// Where passwords are kept. The details of a server live in a file, but a password never does.
pub trait SecretStore: Send + Sync {
    fn get(&self, id: &str) -> Result<Option<String>, Error>;
    fn set(&self, id: &str, secret: &str) -> Result<(), Error>;
    fn delete(&self, id: &str) -> Result<(), Error>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// Added in the app, with its password in the secret store.
    #[default]
    App,
    /// Read from the servers file, and changed only there.
    File,
}

/// Where a server sits on the way to production. The app shows it beside the name and tints the editor by it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Local,
    Dev,
    Staging,
    Prod,
}

impl Environment {
    pub const ALL: [Environment; 4] = [Self::Local, Self::Dev, Self::Staging, Self::Prod];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Dev => "dev",
            Self::Staging => "staging",
            Self::Prod => "prod",
        }
    }
}

impl std::str::FromStr for Environment {
    type Err = String;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|environment| environment.as_str().eq_ignore_ascii_case(text.trim()))
            .ok_or_else(|| {
                format!("environment \"{text}\" is not one of local, dev, staging or prod")
            })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedServer {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// The database to open first, when the address said which.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<Environment>,
    #[serde(default)]
    pub source: Source,
}

/// What the person typed into the form. Without an id it is a new server, and without a password an edit keeps the old one.
#[derive(Debug, Clone, Deserialize)]
pub struct ServerDraft {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub environment: Option<Environment>,
    pub password: Option<String>,
}

/// Every server to choose from, and whatever went wrong reading them, so a typo in the file never makes servers vanish silently.
#[derive(Debug, Clone, Serialize)]
pub struct Listing {
    pub servers: Vec<SavedServer>,
    pub problems: Vec<String>,
    /// The servers file being read, so the app can say where to put servers.
    pub file: Option<String>,
}

pub(crate) struct FileServer {
    pub saved: SavedServer,
    pub password: Option<String>,
    pub tunnel: Option<Tunnel>,
}

pub struct ServerBook {
    path: PathBuf,
    secrets: Arc<dyn SecretStore>,
    file: Option<PathBuf>,
    passfile: Option<PathBuf>,
}

fn storage(error: impl std::fmt::Display) -> Error {
    Error::Storage(error.to_string())
}

/// The same name may be in several environments, so the environment is part of what tells them apart.
pub(crate) fn file_id(name: &str, environment: Option<Environment>) -> String {
    let name = name.trim().to_lowercase();
    match environment {
        Some(environment) => format!("{FILE_ID_PREFIX}{name}@{}", environment.as_str()),
        None => format!("{FILE_ID_PREFIX}{name}"),
    }
}

fn is_from_file(id: &str) -> bool {
    id.starts_with(FILE_ID_PREFIX)
}

impl ServerBook {
    pub fn new(path: PathBuf, secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            path,
            secrets,
            file: None,
            passfile: None,
        }
    }

    /// A servers file to read by itself, whenever the list is asked for.
    pub fn with_file(mut self, file: PathBuf) -> Self {
        self.file = Some(file);
        self
    }

    /// Where to look for a password the server was not given, as psql does.
    pub fn with_passfile(mut self, passfile: PathBuf) -> Self {
        self.passfile = Some(passfile);
        self
    }

    pub fn list(&self) -> Result<Listing, Error> {
        let (from_file, problems) = self.read_file();
        let mut servers: Vec<SavedServer> =
            from_file.into_iter().map(|server| server.saved).collect();
        servers.extend(self.saved()?);
        let file = self.file.as_ref().map(|path| path.display().to_string());
        Ok(Listing {
            servers,
            problems,
            file,
        })
    }

    /// Only the servers added in the app.
    pub(crate) fn saved(&self) -> Result<Vec<SavedServer>, Error> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => serde_json::from_str(&text).map_err(storage),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(storage(error)),
        }
    }

    fn read_file(&self) -> (Vec<FileServer>, Vec<String>) {
        match &self.file {
            Some(path) => read_servers_file(path),
            None => (Vec::new(), Vec::new()),
        }
    }

    pub fn save(&self, draft: ServerDraft) -> Result<SavedServer, Error> {
        if draft.id.as_deref().is_some_and(is_from_file) {
            return Err(Error::ReadOnly);
        }
        let mut servers = self.saved()?;
        let id = draft
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let saved = SavedServer {
            id: id.clone(),
            name: draft.name,
            host: draft.host,
            port: draft.port,
            user: draft.user,
            database: draft.database,
            group: draft.group,
            environment: draft.environment,
            source: Source::App,
        };
        match servers.iter_mut().find(|server| server.id == id) {
            Some(existing) => *existing = saved.clone(),
            None if draft.id.is_some() => return Err(Error::UnknownServer),
            None => servers.push(saved.clone()),
        }
        if let Some(password) = draft.password {
            self.secrets.set(&id, &password)?;
        }
        self.write(&servers)?;
        Ok(saved)
    }

    pub fn remove(&self, id: &str) -> Result<(), Error> {
        if is_from_file(id) {
            return Err(Error::ReadOnly);
        }
        let mut servers = self.saved()?;
        servers.retain(|server| server.id != id);
        self.secrets.delete(id)?;
        self.write(&servers)
    }

    pub fn config_of(&self, id: &str) -> Result<ServerConfig, Error> {
        let (server, password, tunnel) = if is_from_file(id) {
            let found = self
                .read_file()
                .0
                .into_iter()
                .find(|server| server.saved.id == id)
                .ok_or(Error::UnknownServer)?;
            (
                found.saved,
                found.password.unwrap_or_default(),
                found.tunnel,
            )
        } else {
            let server = self
                .saved()?
                .into_iter()
                .find(|server| server.id == id)
                .ok_or(Error::UnknownServer)?;
            let password = self.secrets.get(id)?.unwrap_or_default();
            (server, password, None)
        };
        Ok(ServerConfig {
            host: server.host,
            port: server.port,
            user: server.user,
            password,
            database: server.database,
            passfile: self.passfile.clone(),
            tunnel,
        })
    }

    fn write(&self, servers: &[SavedServer]) -> Result<(), Error> {
        if let Some(folder) = self.path.parent() {
            std::fs::create_dir_all(folder).map_err(storage)?;
        }
        let text = serde_json::to_string_pretty(servers).map_err(storage)?;
        std::fs::write(&self.path, text).map_err(storage)
    }
}
