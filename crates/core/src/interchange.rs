use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::server_book::{
    Environment, FileServer, SavedServer, ServerBook, ServerDraft, Source, file_id,
};
use crate::{Error, Tunnel};

const FORMAT_VERSION: u32 = 1;
const DEFAULT_PORT: u16 = 5432;

#[derive(Debug, Default, Serialize)]
pub struct ImportReport {
    pub added: usize,
    pub updated: usize,
    /// Why each entry that could not be read was left out, so nothing disappears without a word.
    pub skipped: Vec<String>,
}

#[derive(Serialize)]
struct ExportFile {
    version: u32,
    servers: Vec<ExportServer>,
}

#[derive(Serialize)]
struct ExportServer {
    name: String,
    host: String,
    port: u16,
    user: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    environment: Option<Environment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    password: Option<String>,
}

/// Anything this version does not know about is ignored, so a file from a newer app still opens in an older one.
#[derive(Deserialize)]
struct ImportFile {
    version: Option<u32>,
    servers: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    name: Option<String>,
    uri: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    password: Option<String>,
    database: Option<String>,
    group: Option<String>,
    /// Read as text, so one unknown environment skips its entry and not the whole file.
    environment: Option<String>,
    tunnel: Option<Tunnel>,
}

#[derive(Default)]
struct Parts {
    name: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    password: Option<String>,
    database: Option<String>,
}

fn decoded(text: &str) -> String {
    percent_decode_str(text).decode_utf8_lossy().into_owned()
}

fn non_empty(text: String) -> Option<String> {
    (!text.is_empty()).then_some(text)
}

fn parse_address(address: &str) -> Result<Parts, String> {
    let url = Url::parse(address).map_err(|_| "not an address".to_string())?;
    if url.scheme() != "postgres" && url.scheme() != "postgresql" {
        return Err(format!("{}:// is not a postgres address", url.scheme()));
    }
    Ok(Parts {
        name: url.fragment().map(decoded).and_then(non_empty),
        host: url.host_str().map(str::to_owned).and_then(non_empty),
        port: url.port(),
        user: non_empty(decoded(url.username())),
        password: url.password().map(decoded),
        database: non_empty(decoded(url.path().trim_start_matches('/'))),
    })
}

fn draft(
    parts: Parts,
    name: Option<String>,
    group: Option<String>,
    environment: Option<Environment>,
) -> Result<ServerDraft, String> {
    let host = parts.host.ok_or("no host")?;
    let user = parts.user.ok_or("no user")?;
    let port = parts.port.unwrap_or(DEFAULT_PORT);
    let name = name
        .or(parts.name)
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| match &parts.database {
            Some(database) => format!("{host}:{port}/{database}"),
            None => format!("{host}:{port}"),
        });
    Ok(ServerDraft {
        id: None,
        name,
        host,
        port,
        user,
        database: parts.database,
        group,
        environment,
        password: parts.password,
    })
}

/// A server, and the tunnel it asked for. Whether that tunnel is honoured is for the caller to decide.
type Read = (ServerDraft, Option<Tunnel>);

fn from_entry(entry: Entry) -> Result<Read, String> {
    let name = entry
        .name
        .filter(|name| !name.trim().is_empty())
        .ok_or("no name")?;
    let mut parts = match &entry.uri {
        Some(address) => parse_address(address)?,
        None => Parts::default(),
    };
    // A field written out beside the address wins over what the address says.
    parts.host = entry.host.or(parts.host);
    parts.port = entry.port.or(parts.port);
    parts.user = entry.user.or(parts.user);
    parts.password = entry.password.or(parts.password);
    parts.database = entry.database.or(parts.database);
    let environment = entry
        .environment
        .map(|text| text.parse::<Environment>())
        .transpose()?;
    Ok((
        draft(parts, Some(name), entry.group, environment)?,
        entry.tunnel,
    ))
}

pub(crate) fn read_json(text: &str) -> Result<Vec<Result<Read, String>>, Error> {
    let file: ImportFile = serde_json::from_str(text)
        .map_err(|error| Error::Import(format!("That is not a valid servers file: {error}")))?;
    let version = file.version.unwrap_or(FORMAT_VERSION);
    if version != FORMAT_VERSION {
        return Err(Error::Import(format!(
            "This file is version {version}, and this app reads version {FORMAT_VERSION}"
        )));
    }
    Ok(file
        .servers
        .into_iter()
        .enumerate()
        .map(|(index, entry)| {
            let label = entry
                .name
                .clone()
                .map(|name| format!(" \"{name}\""))
                .unwrap_or_default();
            from_entry(entry).map_err(|why| format!("entry {}{label}: {why}", index + 1))
        })
        .collect())
}

fn read_lines(text: &str) -> Vec<Result<Read, String>> {
    text.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty() && !line.trim_start().starts_with('#'))
        .map(|(index, line)| {
            parse_address(line.trim())
                .and_then(|parts| draft(parts, None, None, None))
                .map(|server| (server, None))
                .map_err(|why| format!("line {}: {why}", index + 1))
        })
        .collect()
}

impl ServerBook {
    /// The servers as a file that can be imported again anywhere. A password goes in only if asked for.
    pub fn export(&self, include_passwords: bool) -> Result<String, Error> {
        let servers = self
            .list()?
            .servers
            .into_iter()
            .map(
                |SavedServer {
                     id,
                     name,
                     host,
                     port,
                     user,
                     database,
                     group,
                     environment,
                     ..
                 }| {
                    let password = if include_passwords {
                        self.config_of(&id)
                            .map(|config| config.password)
                            .ok()
                            .filter(|password| !password.is_empty())
                    } else {
                        None
                    };
                    ExportServer {
                        name,
                        host,
                        port,
                        user,
                        database,
                        group,
                        environment,
                        password,
                    }
                },
            )
            .collect();
        serde_json::to_string_pretty(&ExportFile {
            version: FORMAT_VERSION,
            servers,
        })
        .map_err(|error| Error::Import(error.to_string()))
    }

    /// Reads a servers file, or a plain list of postgres:// addresses, and saves what it finds. A name that is already saved is updated.
    pub fn import(&self, text: &str) -> Result<ImportReport, Error> {
        let trimmed = text.trim_start();
        let found = if trimmed.starts_with('{') {
            read_json(text)?
        } else {
            read_lines(text)
        };
        let mut report = ImportReport::default();
        for result in found {
            match result {
                Err(why) => report.skipped.push(why),
                Ok((mut server, tunnel)) => {
                    if tunnel.is_some() {
                        report.skipped.push(format!(
                            "{}: tunnel ignored, since only the servers file may start commands",
                            server.name
                        ));
                    }
                    let existing = self.saved()?.into_iter().find(|saved| {
                        saved.name.eq_ignore_ascii_case(&server.name)
                            && saved.environment == server.environment
                    });
                    server.id = existing.as_ref().map(|saved| saved.id.clone());
                    self.save(server)?;
                    if existing.is_some() {
                        report.updated += 1
                    } else {
                        report.added += 1
                    }
                }
            }
        }
        Ok(report)
    }
}

/// Reads the servers file the app keeps an eye on. Whatever cannot be read is reported and the rest still count.
pub(crate) fn read_servers_file(path: &std::path::Path) -> (Vec<FileServer>, Vec<String>) {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (Vec::new(), Vec::new());
        }
        Err(error) => return (Vec::new(), vec![format!("{}: {error}", path.display())]),
    };
    let found = match read_json(&text) {
        Ok(found) => found,
        Err(error) => return (Vec::new(), vec![format!("{}: {error}", path.display())]),
    };
    let (mut servers, mut problems) = (Vec::new(), Vec::new());
    for result in found {
        match result {
            Err(why) => problems.push(format!("{}: {why}", path.display())),
            Ok((draft, tunnel)) => servers.push(FileServer {
                saved: SavedServer {
                    id: file_id(&draft.name, draft.environment),
                    name: draft.name,
                    host: draft.host,
                    port: draft.port,
                    user: draft.user,
                    database: draft.database,
                    group: draft.group,
                    environment: draft.environment,
                    source: Source::File,
                },
                password: draft.password,
                tunnel,
            }),
        }
    }
    (servers, problems)
}
