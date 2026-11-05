use serde::Serialize;
use tokio_postgres::Client;
use tokio_postgres::types::Type;

use crate::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TableKind {
    Table,
    View,
    MaterializedView,
    ForeignTable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    pub kind: TableKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    /// As Postgres writes it, such as `character varying(20)` or `numeric(10,2)`.
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

/// Postgres's own schemas are left out: they are all `pg_` something, or information_schema.
const TABLES: &str = "select n.nspname::text, c.relname::text, c.relkind::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
    order by n.nspname, c.relname";

/// Every table with its columns, in one go, for the editor to suggest names from while typing.
const CATALOG: &str = "select n.nspname::text, c.relname::text, c.relkind::text, a.attname::text, format_type(a.atttypid, a.atttypmod)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
    order by n.nspname, c.relname, a.attnum";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CatalogColumn {
    pub name: String,
    pub data_type: String,
}

/// Columns of a table that point at columns of another, in the order they pair up.
const FOREIGN_KEYS: &str =
    "select n.nspname::text, c.relname::text, fn.nspname::text, fc.relname::text,
        array(select a.attname::text from unnest(k.conkey) with ordinality as u(attnum, i)
              join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum order by u.i),
        array(select a.attname::text from unnest(k.confkey) with ordinality as u(attnum, i)
              join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.attnum order by u.i)
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_class fc on fc.oid = k.confrelid join pg_namespace fn on fn.oid = fc.relnamespace
    where k.contype = 'f' and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
    order by n.nspname, c.relname, k.conname";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ForeignKey {
    pub columns: Vec<String>,
    pub references_schema: String,
    pub references_table: String,
    pub references_columns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CatalogTable {
    pub schema: String,
    pub name: String,
    pub kind: TableKind,
    pub columns: Vec<CatalogColumn>,
    /// What this table's columns point at, from which a join's condition can be suggested.
    pub foreign_keys: Vec<ForeignKey>,
}

const COLUMNS: &str = "select a.attname::text, format_type(a.atttypid, a.atttypmod), not a.attnotnull,
        exists (select 1 from pg_index i where i.indrelid = a.attrelid and i.indisprimary and a.attnum = any(i.indkey))
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped
    order by a.attnum";

fn kind_of(relkind: &str) -> TableKind {
    match relkind {
        "v" => TableKind::View,
        "m" => TableKind::MaterializedView,
        "f" => TableKind::ForeignTable,
        _ => TableKind::Table,
    }
}

pub(crate) async fn tables(client: &Client) -> Result<Vec<TableInfo>, Error> {
    let rows = client.query_typed(TABLES, &[]).await?;
    Ok(rows
        .iter()
        .map(|row| TableInfo {
            schema: row.get(0),
            name: row.get(1),
            kind: kind_of(row.get::<_, &str>(2)),
        })
        .collect())
}

pub(crate) async fn columns(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, Error> {
    let rows = client
        .query_typed(COLUMNS, &[(&schema, Type::TEXT), (&table, Type::TEXT)])
        .await?;
    Ok(rows
        .iter()
        .map(|row| ColumnInfo {
            name: row.get(0),
            data_type: row.get(1),
            nullable: row.get(2),
            primary_key: row.get(3),
        })
        .collect())
}

pub(crate) async fn catalog(client: &Client) -> Result<Vec<CatalogTable>, Error> {
    let rows = client.query_typed(CATALOG, &[]).await?;
    let mut tables: Vec<CatalogTable> = Vec::new();
    for row in &rows {
        let (schema, name): (String, String) = (row.get(0), row.get(1));
        let same = tables
            .last()
            .is_some_and(|last| last.schema == schema && last.name == name);
        if !same {
            tables.push(CatalogTable {
                schema,
                name,
                kind: kind_of(row.get::<_, &str>(2)),
                columns: Vec::new(),
                foreign_keys: Vec::new(),
            });
        }
        // A table with no columns still comes back once, with nothing in the column's place.
        if let Some(column) = row.get::<_, Option<String>>(3) {
            tables.last_mut().unwrap().columns.push(CatalogColumn {
                name: column,
                data_type: row.get(4),
            });
        }
    }
    for row in client.query_typed(FOREIGN_KEYS, &[]).await? {
        let (schema, name): (&str, &str) = (row.get(0), row.get(1));
        if let Some(table) = tables
            .iter_mut()
            .find(|table| table.schema == schema && table.name == name)
        {
            table.foreign_keys.push(ForeignKey {
                columns: row.get(4),
                references_schema: row.get(2),
                references_table: row.get(3),
                references_columns: row.get(5),
            });
        }
    }
    Ok(tables)
}
