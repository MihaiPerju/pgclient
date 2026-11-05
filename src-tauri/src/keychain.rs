use keyring::Entry;
use pgclient_core::{Error, SecretStore};

const SERVICE: &str = "pgclient";

/// Passwords live in the macOS Keychain, so they are never in a file that could be copied or committed.
pub struct Keychain;

fn entry(id: &str) -> Result<Entry, Error> {
    Entry::new(SERVICE, id).map_err(|error| Error::Storage(error.to_string()))
}

impl SecretStore for Keychain {
    fn get(&self, id: &str) -> Result<Option<String>, Error> {
        match entry(id)?.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(Error::Storage(error.to_string())),
        }
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), Error> {
        entry(id)?
            .set_password(secret)
            .map_err(|error| Error::Storage(error.to_string()))
    }

    fn delete(&self, id: &str) -> Result<(), Error> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(Error::Storage(error.to_string())),
        }
    }
}
