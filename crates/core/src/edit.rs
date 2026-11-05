use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use tokio_postgres::Client;
use tokio_postgres::types::ToSql;

use crate::Error;
use crate::schema::{self, ColumnInfo};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    /// Whether the database fills the column in when a row is added without a value for it, as for a serial number or `now()`. Such a column
    /// is left out of a copied row, so the copy gets its own, and does not collide with the row it was copied from.
    pub has_default: bool,
}

/// Whether the rows of a result can be changed in the table they were read from, as pgAdmin decides it: they must all come from
/// one table, and the table's whole primary key must be among them, since that is how a row is found again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ResultSource {
    Editable {
        schema: String,
        table: String,
        /// For each column of the result, the column of the table it shows, or nothing for one that is worked out.
        columns: Vec<Option<SourceColumn>>,
        key: Vec<String>,
    },
    ReadOnly {
        reason: String,
    },
}

fn read_only(reason: impl Into<String>) -> ResultSource {
    ResultSource::ReadOnly {
        reason: reason.into(),
    }
}

const TABLE: &str = "select n.nspname::text, c.relname::text, c.relkind::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = $1";

/// The columns the database fills in itself: those with a default, and those that are generated.
const DEFAULTS: &str = "select attname::text from pg_attribute
    where attrelid = $1 and attnum > 0 and not attisdropped and (atthasdef or attidentity <> '' or attgenerated <> '')";

const ATTRIBUTES: &str = "select attnum, attname::text from pg_attribute where attrelid = $1 and attnum > 0 and not attisdropped";

/// Works out where the result of `sql` comes from without running it. A statement is described by the database, which is how it
/// says what table and column each column of the result is.
pub(crate) async fn source_of(client: &Client, sql: &str) -> ResultSource {
    let Ok(statement) = client.prepare(sql).await else {
        return read_only("Only a single query can be edited");
    };
    let origins: Vec<(Option<u32>, Option<i16>)> = statement
        .columns()
        .iter()
        .map(|column| (column.table_oid(), column.column_id()))
        .collect();
    let tables: BTreeSet<u32> = origins.iter().filter_map(|(oid, _)| *oid).collect();
    let oid = match tables.len() {
        0 => return read_only("The result is not read from a table"),
        1 => *tables.first().unwrap(),
        _ => return read_only("The rows come from more than one table"),
    };
    match lookup(client, oid, &origins).await {
        Ok(source) => source,
        Err(error) => read_only(error.to_string()),
    }
}

async fn lookup(
    client: &Client,
    oid: u32,
    origins: &[(Option<u32>, Option<i16>)],
) -> Result<ResultSource, Error> {
    let table = client.query_one(TABLE, &[&oid]).await?;
    let (schema, name, kind): (String, String, String) = (table.get(0), table.get(1), table.get(2));
    if !matches!(kind.as_str(), "r" | "p") {
        return Ok(read_only(format!(
            "{name} is not a table, so its rows cannot be changed"
        )));
    }
    let described = schema::columns(client, &schema, &name).await?;
    let names: BTreeMap<i16, String> = client
        .query(ATTRIBUTES, &[&oid])
        .await?
        .iter()
        .map(|row| (row.get(0), row.get(1)))
        .collect();
    let defaulted: BTreeSet<String> = client
        .query(DEFAULTS, &[&oid])
        .await?
        .iter()
        .map(|row| row.get(0))
        .collect();
    let columns: Vec<Option<SourceColumn>> = origins
        .iter()
        .map(|(origin, id)| {
            if *origin != Some(oid) {
                return None;
            }
            let name = names.get(&(*id)?)?;
            let column = described.iter().find(|column| &column.name == name)?;
            Some(SourceColumn {
                name: column.name.clone(),
                data_type: column.data_type.clone(),
                nullable: column.nullable,
                has_default: defaulted.contains(&column.name),
            })
        })
        .collect();
    let key: Vec<String> = described
        .iter()
        .filter(|column| column.primary_key)
        .map(|column| column.name.clone())
        .collect();
    if key.is_empty() {
        return Ok(read_only(format!(
            "{name} has no primary key, so a row cannot be told from another"
        )));
    }
    let shown: Vec<&str> = columns
        .iter()
        .flatten()
        .map(|column| column.name.as_str())
        .collect();
    if shown.iter().collect::<BTreeSet<_>>().len() != shown.len() {
        return Ok(read_only("A column is selected more than once"));
    }
    let missing: Vec<&str> = key
        .iter()
        .map(String::as_str)
        .filter(|name| !shown.contains(name))
        .collect();
    if !missing.is_empty() {
        return Ok(read_only(format!(
            "The primary key ({}) is not in the result, so a row cannot be found again",
            missing.join(", ")
        )));
    }
    Ok(ResultSource::Editable {
        schema,
        table: name,
        columns,
        key,
    })
}

/// One row of the table to change, found by its primary key.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Change {
    Delete {
        key: BTreeMap<String, Option<String>>,
    },
    Update {
        key: BTreeMap<String, Option<String>>,
        set: BTreeMap<String, Option<String>>,
    },
    /// A new row. Only the columns given are set, and the database fills in the rest.
    Insert {
        values: BTreeMap<String, Option<String>>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Applied {
    pub deleted: u64,
    pub updated: u64,
    pub inserted: u64,
}

fn quoted(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn refused(message: impl Into<String>) -> Error {
    Error::Database(message.into())
}

/// A value always travels as text and is made the column's type by the database, so any type can be written, and null is null.
struct Statement {
    sql: String,
    values: Vec<Option<String>>,
}

fn statement(
    schema: &str,
    table: &str,
    columns: &[ColumnInfo],
    change: &Change,
) -> Result<Statement, Error> {
    let typed = |name: &str| {
        columns
            .iter()
            .find(|column| column.name == name)
            .map(|column| column.data_type.as_str())
            .ok_or_else(|| refused(format!("{table} has no column {name}")))
    };
    let target = format!("{}.{}", quoted(schema), quoted(table));
    if let Change::Insert { values: given } = change {
        let mut values = Vec::new();
        let mut names = Vec::new();
        let mut places = Vec::new();
        for (name, value) in given {
            values.push(value.clone());
            names.push(quoted(name));
            places.push(format!("${}::text::{}", values.len(), typed(name)?));
        }
        // A row with nothing in it is still a row, made of nothing but defaults.
        let sql = if names.is_empty() {
            format!("insert into {target} default values")
        } else {
            format!(
                "insert into {target} ({}) values ({})",
                names.join(", "),
                places.join(", ")
            )
        };
        return Ok(Statement { sql, values });
    }
    let (key, set) = match change {
        Change::Delete { key } => (key, None),
        Change::Update { key, set } => (key, Some(set)),
        Change::Insert { .. } => unreachable!("an insert was handled above"),
    };
    let primary: BTreeSet<&str> = columns
        .iter()
        .filter(|column| column.primary_key)
        .map(|column| column.name.as_str())
        .collect();
    if key.keys().map(String::as_str).collect::<BTreeSet<_>>() != primary {
        return Err(refused("A row is found by the whole of its primary key"));
    }
    let mut values = Vec::new();
    let mut assignments = Vec::new();
    if let Some(set) = set {
        if set.is_empty() {
            return Err(refused("There is nothing to change"));
        }
        for (name, value) in set {
            values.push(value.clone());
            assignments.push(format!(
                "{} = ${}::text::{}",
                quoted(name),
                values.len(),
                typed(name)?
            ));
        }
    }
    let mut conditions = Vec::new();
    for (name, value) in key {
        values.push(value.clone());
        conditions.push(format!(
            "{} = ${}::text::{}",
            quoted(name),
            values.len(),
            typed(name)?
        ));
    }
    let sql = match set {
        None => format!("delete from {target} where {}", conditions.join(" and ")),
        Some(_) => format!(
            "update {target} set {} where {}",
            assignments.join(", "),
            conditions.join(" and ")
        ),
    };
    Ok(Statement { sql, values })
}

/// Makes all of the changes or none of them: each must change exactly the one row it names, and if one does not, as when the row
/// is gone already, nothing is kept.
pub(crate) async fn apply(
    client: &mut Client,
    schema: &str,
    table: &str,
    changes: &[Change],
) -> Result<Applied, Error> {
    let columns = schema::columns(client, schema, table).await?;
    if columns.is_empty() {
        return Err(refused(format!("There is no table {schema}.{table}")));
    }
    let statements = changes
        .iter()
        .map(|change| statement(schema, table, &columns, change))
        .collect::<Result<Vec<_>, _>>()?;
    let transaction = client.transaction().await?;
    let mut applied = Applied {
        deleted: 0,
        updated: 0,
        inserted: 0,
    };
    for (change, statement) in changes.iter().zip(&statements) {
        let params: Vec<&(dyn ToSql + Sync)> = statement
            .values
            .iter()
            .map(|value| value as &(dyn ToSql + Sync))
            .collect();
        let affected = transaction.execute(statement.sql.as_str(), &params).await?;
        if affected != 1 {
            return Err(refused(format!(
                "{affected} rows changed where one was expected, so nothing was saved. The row may have been changed or removed since it was read"
            )));
        }
        match change {
            Change::Delete { .. } => applied.deleted += 1,
            Change::Update { .. } => applied.updated += 1,
            Change::Insert { .. } => applied.inserted += 1,
        }
    }
    transaction.commit().await?;
    Ok(applied)
}
