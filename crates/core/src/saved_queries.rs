use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::Error;

const VERSION: u64 = 1;

#[derive(Serialize, Deserialize)]
struct File {
    version: u64,
    queries: BTreeMap<String, String>,
}

/// What was written in the editor for each server and database, kept in a file so it is still there when the app is opened again.
/// Each is found by a key the caller makes up, and only the text last saved for it is kept.
pub struct SavedQueries {
    path: PathBuf,
    /// Saving reads the file, changes one entry and writes it back, so two saves at once must not interleave.
    writing: Mutex<()>,
}

impl SavedQueries {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            writing: Mutex::new(()),
        }
    }

    fn read(&self) -> Result<BTreeMap<String, String>, Error> {
        let text = match std::fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new());
            }
            Err(error) => return Err(Error::Queries(error.to_string())),
        };
        match serde_json::from_str::<File>(&text) {
            Ok(file) if file.version == VERSION => Ok(file.queries),
            Ok(file) => Err(Error::Queries(format!(
                "version {} is not supported",
                file.version
            ))),
            Err(error) => Err(Error::Queries(error.to_string())),
        }
    }

    /// Everything that was saved. A file that cannot be read gives nothing, and is left as it is until something is saved.
    pub fn load(&self) -> BTreeMap<String, String> {
        self.read().unwrap_or_default()
    }

    /// Keeps `text` for `key`, or forgets the key if there is nothing but space in it. A file that cannot be read is set aside
    /// as `.corrupt` first, so saving never throws away what a person may still want to rescue from it.
    pub fn save(&self, key: &str, text: &str) -> Result<(), Error> {
        let _writing = self.writing.lock().unwrap();
        let mut queries = match self.read() {
            Ok(queries) => queries,
            Err(_) => {
                let mut aside = self.path.clone().into_os_string();
                aside.push(".corrupt");
                let _ = std::fs::rename(&self.path, aside);
                BTreeMap::new()
            }
        };
        if text.trim().is_empty() {
            queries.remove(key);
        } else {
            queries.insert(key.to_string(), text.to_string());
        }
        let file = File {
            version: VERSION,
            queries,
        };
        let written = serde_json::to_string_pretty(&file)
            .map_err(|error| Error::Queries(error.to_string()))?;
        if let Some(folder) = self.path.parent() {
            std::fs::create_dir_all(folder).map_err(|error| Error::Queries(error.to_string()))?;
        }
        // Written beside the file and moved over it, so a crash half way leaves the old one whole.
        let mut staged = self.path.clone().into_os_string();
        staged.push(".tmp");
        std::fs::write(&staged, format!("{written}\n"))
            .map_err(|error| Error::Queries(error.to_string()))?;
        std::fs::rename(&staged, &self.path).map_err(|error| Error::Queries(error.to_string()))
    }
}
