//! What a database holds: its tables and views, and the columns of each.

mod common;

use common::{TEST_DB, run_sql, test_server};
use pgclient_core::{
    CatalogColumn, CatalogTable, ColumnInfo, Core, ForeignKey, TableInfo, TableKind,
};

async fn scene(schema: &str, ddl: &str) {
    run_sql(&format!(
        "drop schema if exists {schema} cascade; create schema {schema}; set search_path to {schema}; {ddl}"
    ))
    .await;
}

async fn tables_in(schema: &str) -> Vec<(String, TableKind)> {
    let tables: Vec<TableInfo> = Core::new()
        .list_tables(&test_server(), TEST_DB)
        .await
        .unwrap();
    tables
        .into_iter()
        .filter(|table| table.schema == schema)
        .map(|table| (table.name, table.kind))
        .collect()
}

#[tokio::test]
async fn tables_views_and_materialized_views_are_listed_by_name_with_their_kind() {
    scene(
        "sch_kinds",
        "create table people (id int primary key, name text); create view adults as select * from people; create materialized view stats as select 1 as n;",
    )
    .await;

    assert_eq!(
        tables_in("sch_kinds").await,
        vec![
            ("adults".to_string(), TableKind::View),
            ("people".to_string(), TableKind::Table),
            ("stats".to_string(), TableKind::MaterializedView),
        ]
    );
}

#[tokio::test]
async fn partitioned_tables_count_as_tables_and_their_partitions_are_listed_too() {
    scene(
        "sch_parts",
        "create table events (at int) partition by range (at); create table events_1 partition of events for values from (0) to (10);",
    )
    .await;

    let found = tables_in("sch_parts").await;

    assert!(found.contains(&("events".to_string(), TableKind::Table)));
    assert!(found.contains(&("events_1".to_string(), TableKind::Table)));
}

#[tokio::test]
async fn the_systems_own_tables_are_left_out() {
    let tables = Core::new()
        .list_tables(&test_server(), TEST_DB)
        .await
        .unwrap();

    assert!(tables.iter().all(|table| {
        !["pg_catalog", "information_schema"].contains(&table.schema.as_str())
            && !table.schema.starts_with("pg_toast")
    }));
}

#[tokio::test]
async fn tables_come_ordered_by_schema_and_then_name() {
    scene(
        "sch_order_b",
        "create table z (a int); create table a (a int);",
    )
    .await;
    scene("sch_order_a", "create table m (a int);").await;

    let tables = Core::new()
        .list_tables(&test_server(), TEST_DB)
        .await
        .unwrap();
    let ours: Vec<(String, String)> = tables
        .into_iter()
        .filter(|table| table.schema.starts_with("sch_order_"))
        .map(|table| (table.schema, table.name))
        .collect();

    assert_eq!(
        ours,
        vec![
            ("sch_order_a".to_string(), "m".to_string()),
            ("sch_order_b".to_string(), "a".to_string()),
            ("sch_order_b".to_string(), "z".to_string()),
        ]
    );
}

#[tokio::test]
async fn columns_come_in_order_with_their_types_as_postgres_writes_them_and_whether_they_may_be_null()
 {
    scene(
        "sch_cols",
        "create table items (id serial primary key, label varchar(20) not null, price numeric(10,2), note text, gone int); alter table items drop column gone;",
    )
    .await;

    let columns = Core::new()
        .list_columns(&test_server(), TEST_DB, "sch_cols", "items")
        .await
        .unwrap();

    assert_eq!(
        columns,
        vec![
            ColumnInfo {
                name: "id".into(),
                data_type: "integer".into(),
                nullable: false,
                primary_key: true
            },
            ColumnInfo {
                name: "label".into(),
                data_type: "character varying(20)".into(),
                nullable: false,
                primary_key: false
            },
            ColumnInfo {
                name: "price".into(),
                data_type: "numeric(10,2)".into(),
                nullable: true,
                primary_key: false
            },
            ColumnInfo {
                name: "note".into(),
                data_type: "text".into(),
                nullable: true,
                primary_key: false
            },
        ]
    );
}

#[tokio::test]
async fn a_view_has_columns_too() {
    scene(
        "sch_viewcols",
        "create table t (a int, b text); create view v as select a from t;",
    )
    .await;

    let columns = Core::new()
        .list_columns(&test_server(), TEST_DB, "sch_viewcols", "v")
        .await
        .unwrap();

    assert_eq!(
        columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["a"]
    );
}

#[tokio::test]
async fn a_table_that_is_not_there_has_no_columns() {
    let columns = Core::new()
        .list_columns(&test_server(), TEST_DB, "public", "no_such_table_here")
        .await
        .unwrap();

    assert!(columns.is_empty());
}

#[tokio::test]
async fn names_with_capitals_spaces_and_quotes_are_found_exactly() {
    scene(
        "sch_odd",
        "create table \"Odd Name\" (\"Mixed Col\" int); create table \"it's\" (a int);",
    )
    .await;

    let found = tables_in("sch_odd").await;
    let columns = Core::new()
        .list_columns(&test_server(), TEST_DB, "sch_odd", "Odd Name")
        .await
        .unwrap();

    assert!(
        found.iter().any(|(name, _)| name == "Odd Name")
            && found.iter().any(|(name, _)| name == "it's")
    );
    assert_eq!(columns[0].name, "Mixed Col");
}

#[tokio::test]
async fn the_catalog_gives_every_table_with_its_columns_in_order_in_one_go() {
    scene(
        "sch_catalog",
        "create table people (id int primary key, name varchar(20)); create view adults as select id from people; create table empty_one (); alter table people drop column name; alter table people add column email text;",
    )
    .await;

    let catalog: Vec<CatalogTable> = Core::new()
        .catalog(&test_server(), TEST_DB)
        .await
        .unwrap()
        .into_iter()
        .filter(|table| table.schema == "sch_catalog")
        .collect();

    let column = |name: &str, data_type: &str| CatalogColumn {
        name: name.into(),
        data_type: data_type.into(),
    };
    let table = |name: &str, kind, columns| CatalogTable {
        schema: "sch_catalog".into(),
        name: name.into(),
        kind,
        columns,
        foreign_keys: vec![],
    };
    assert_eq!(
        catalog,
        [
            table("adults", TableKind::View, vec![column("id", "integer")]),
            table("empty_one", TableKind::Table, vec![]),
            table(
                "people",
                TableKind::Table,
                vec![column("id", "integer"), column("email", "text")]
            ),
        ]
    );
}

#[tokio::test]
async fn the_catalog_knows_what_each_foreign_key_points_at_column_by_column() {
    scene(
        "sch_keys",
        "create table customers (id int primary key, region text, unique (id, region));
         create table orders (id int primary key, customer_id int references customers, region text,
             foreign key (customer_id, region) references customers (id, region));
         create table notes (body text);",
    )
    .await;

    let keys: Vec<(String, Vec<ForeignKey>)> = Core::new()
        .catalog(&test_server(), TEST_DB)
        .await
        .unwrap()
        .into_iter()
        .filter(|table| table.schema == "sch_keys")
        .map(|table| (table.name, table.foreign_keys))
        .collect();

    let key = |columns: &[&str], references: &[&str]| ForeignKey {
        columns: columns.iter().map(|&column| column.into()).collect(),
        references_schema: "sch_keys".into(),
        references_table: "customers".into(),
        references_columns: references.iter().map(|&column| column.into()).collect(),
    };
    let orders = &keys.iter().find(|(name, _)| name == "orders").unwrap().1;
    assert_eq!(orders.len(), 2);
    assert!(orders.contains(&key(&["customer_id"], &["id"])));
    assert!(orders.contains(&key(&["customer_id", "region"], &["id", "region"])));
    assert!(
        keys.iter()
            .filter(|(name, _)| name != "orders")
            .all(|(_, keys)| keys.is_empty())
    );
}
