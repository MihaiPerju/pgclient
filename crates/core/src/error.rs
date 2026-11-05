#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Database(String),
    #[error("There is no such server")]
    UnknownServer,
    #[error("Could not read or write the saved servers: {0}")]
    Storage(String),
    #[error("Could not read or write the saved queries: {0}")]
    Queries(String),
    #[error("{0}")]
    Import(String),
    #[error("{0}")]
    Tunnel(String),
    #[error("This server comes from the servers file, so it is changed there")]
    ReadOnly,
}

/// What the database said, without the driver's wrapping, the way psql would say it: the message, and under it the detail and the hint
/// when there are any. For a constraint that was broken the detail is what says which value, such as `Key (email)=(a@b.c) already exists.`
pub(crate) fn describe(error: &tokio_postgres::Error) -> String {
    let Some(db) = error.as_db_error() else {
        return error.to_string();
    };
    let mut said = format!("{}: {}", db.severity(), db.message());
    if let Some(detail) = db.detail() {
        said.push_str(&format!("\nDETAIL: {detail}"));
    }
    if let Some(hint) = db.hint() {
        said.push_str(&format!("\nHINT: {hint}"));
    }
    said
}

impl From<tokio_postgres::Error> for Error {
    fn from(error: tokio_postgres::Error) -> Self {
        Error::Database(describe(&error))
    }
}
