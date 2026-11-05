//! Changing the rows of a result in the table they came from. Needs the throwaway Postgres in compose.test.yaml.

mod common;

use std::collections::BTreeMap;

use common::{TEST_DB, run_sql, test_server};
use pgclient_core::{Change, Core, QueryEvent, ResultSource};

async fn scene(schema: &str, ddl: &str) {
    run_sql(&format!(
        "drop schema if exists {schema} cascade; create schema {schema}; set search_path to {schema}; {ddl}"
    ))
    .await;
}

async fn source(sql: &str) -> ResultSource {
    Core::new()
        .source_of(&test_server(), TEST_DB, sql)
        .await
        .unwrap()
}

fn reason(source: ResultSource) -> String {
    match source {
        ResultSource::ReadOnly { reason } => reason,
        editable => panic!("expected a read-only result, got {editable:?}"),
    }
}

fn one(name: &str, value: Option<&str>) -> BTreeMap<String, Option<String>> {
    BTreeMap::from([(name.to_string(), value.map(str::to_string))])
}

async fn rows(sql: &str) -> Vec<Vec<Option<String>>> {
    let mut run = Core::new()
        .run_query(&test_server(), TEST_DB, sql)
        .await
        .unwrap();
    let mut rows = Vec::new();
    while let Some(event) = run.events.recv().await {
        if let QueryEvent::Rows { rows: chunk } = event {
            rows.extend(chunk);
        }
    }
    rows
}

async fn apply(schema: &str, table: &str, changes: &[Change]) -> Result<(u64, u64), String> {
    done(schema, table, changes)
        .await
        .map(|(deleted, updated, _)| (deleted, updated))
}

/// Like `apply`, with the number of rows added as well.
async fn done(schema: &str, table: &str, changes: &[Change]) -> Result<(u64, u64, u64), String> {
    Core::new()
        .apply_changes(&test_server(), TEST_DB, schema, table, changes)
        .await
        .map(|applied| (applied.deleted, applied.updated, applied.inserted))
        .map_err(|error| error.to_string())
}

fn row(pairs: &[(&str, Option<&str>)]) -> Change {
    Change::Insert {
        values: pairs
            .iter()
            .map(|(name, value)| (name.to_string(), value.map(str::to_string)))
            .collect(),
    }
}

const ITEMS: &str = "create table items (id int primary key, label text, price numeric(10,2), tags jsonb);
    insert into items values (1, 'a', 1.50, '{\"x\": 1}'), (2, 'b', null, null), (3, 'c', 3, '[]');";

#[tokio::test]
async fn a_plain_select_from_a_table_with_a_key_can_be_edited_and_says_which_column_is_which() {
    scene("ed_plain", ITEMS).await;

    let ResultSource::Editable {
        schema,
        table,
        columns,
        key,
    } = source("select label as name, id from ed_plain.items;").await
    else {
        panic!("expected an editable result");
    };

    assert_eq!((schema.as_str(), table.as_str()), ("ed_plain", "items"));
    assert_eq!(key, ["id"]);
    let names: Vec<_> = columns
        .iter()
        .map(|c| c.as_ref().unwrap().name.as_str())
        .collect();
    assert_eq!(names, ["label", "id"]);
    assert_eq!(columns[1].as_ref().unwrap().data_type, "integer");
}

#[tokio::test]
async fn a_column_that_is_worked_out_is_read_only_and_the_rest_still_edit() {
    scene("ed_calc", ITEMS).await;

    let ResultSource::Editable { columns, .. } =
        source("select id, label || '!' as shout from ed_calc.items").await
    else {
        panic!("expected an editable result");
    };

    assert!(columns[0].is_some() && columns[1].is_none());
}

#[tokio::test]
async fn a_table_with_no_primary_key_cannot_be_edited() {
    scene(
        "ed_nokey",
        "create table loose (a int); insert into loose values (1);",
    )
    .await;

    assert!(reason(source("select * from ed_nokey.loose").await).contains("no primary key"));
}

#[tokio::test]
async fn a_result_without_the_whole_key_cannot_be_edited() {
    scene("ed_partial", ITEMS).await;

    assert!(
        reason(source("select label from ed_partial.items").await).contains("primary key (id)")
    );
}

#[tokio::test]
async fn rows_from_two_tables_or_from_no_table_cannot_be_edited() {
    scene(
        "ed_join",
        &format!("{ITEMS} create table other (id int primary key);"),
    )
    .await;

    assert!(
        reason(source("select * from ed_join.items i join ed_join.other o on o.id = i.id").await)
            .contains("more than one table")
    );
    assert!(reason(source("select 1 as one").await).contains("not read from a table"));
}

#[tokio::test]
async fn several_statements_or_a_view_cannot_be_edited() {
    scene(
        "ed_view",
        &format!("{ITEMS} create view seen as select * from items;"),
    )
    .await;

    assert!(reason(source("select 1; select 2").await).contains("single query"));
    assert!(reason(source("select * from ed_view.seen").await).contains("not a table"));
}

#[tokio::test]
async fn rows_are_deleted_and_values_changed_all_together_whatever_their_type() {
    scene("ed_apply", ITEMS).await;

    let done = apply(
        "ed_apply",
        "items",
        &[
            Change::Delete {
                key: one("id", Some("3")),
            },
            Change::Update {
                key: one("id", Some("1")),
                set: BTreeMap::from([
                    ("price".to_string(), Some("2.25".to_string())),
                    ("tags".to_string(), Some("{\"y\": [1, 2]}".to_string())),
                    ("label".to_string(), None),
                ]),
            },
        ],
    )
    .await;

    assert_eq!(done, Ok((1, 1)));
    assert_eq!(
        rows("select id, label, price, tags from ed_apply.items order by id").await,
        [
            vec![
                Some("1".into()),
                None,
                Some("2.25".into()),
                Some("{\"y\": [1, 2]}".into())
            ],
            vec![Some("2".into()), Some("b".into()), None, None],
        ]
    );
}

#[tokio::test]
async fn one_change_that_misses_its_row_keeps_every_change_out() {
    scene("ed_atomic", ITEMS).await;

    let done = apply(
        "ed_atomic",
        "items",
        &[
            Change::Delete {
                key: one("id", Some("1")),
            },
            Change::Delete {
                key: one("id", Some("99")),
            },
        ],
    )
    .await;

    assert!(done.unwrap_err().contains("nothing was saved"));
    assert_eq!(
        rows("select count(*) from ed_atomic.items").await,
        [vec![Some("3".into())]]
    );
}

#[tokio::test]
async fn a_value_the_column_cannot_hold_is_refused_with_what_the_database_said() {
    scene("ed_bad", ITEMS).await;

    let done = apply(
        "ed_bad",
        "items",
        &[Change::Update {
            key: one("id", Some("1")),
            set: one("price", Some("not a number")),
        }],
    )
    .await;

    assert!(done.unwrap_err().contains("not a number"));
}

#[tokio::test]
async fn a_row_must_be_named_by_its_whole_key_and_only_real_columns_are_set() {
    scene("ed_names", ITEMS).await;

    let no_key = apply(
        "ed_names",
        "items",
        &[Change::Delete {
            key: BTreeMap::new(),
        }],
    )
    .await;
    let odd = apply(
        "ed_names",
        "items",
        &[Change::Update {
            key: one("id", Some("1")),
            set: one("nope\" = 1; --", Some("x")),
        }],
    )
    .await;

    assert!(no_key.unwrap_err().contains("whole of its primary key"));
    assert!(odd.unwrap_err().contains("has no column"));
    assert_eq!(
        rows("select count(*) from ed_names.items").await,
        [vec![Some("3".into())]]
    );
}

#[tokio::test]
async fn a_quote_in_a_value_is_just_text() {
    scene("ed_quote", ITEMS).await;

    apply(
        "ed_quote",
        "items",
        &[Change::Update {
            key: one("id", Some("2")),
            set: one("label", Some("it's \"fine\"; drop table items")),
        }],
    )
    .await
    .unwrap();

    assert_eq!(
        rows("select label from ed_quote.items where id = 2").await,
        [vec![Some("it's \"fine\"; drop table items".into())]]
    );
}

const PEOPLE: &str = "create table people (
        id serial primary key,
        email text not null unique,
        age int check (age >= 0),
        team int,
        created timestamptz not null default now()
    );
    create table teams (id int primary key);
    alter table people add constraint people_team_fk foreign key (team) references teams (id);
    insert into teams values (1), (2);
    insert into people (email, age, team) values ('a@x.io', 30, 1), ('b@x.io', 40, 2);";

async fn emails(schema: &str) -> Vec<String> {
    rows(&format!("select email from {schema}.people order by id"))
        .await
        .into_iter()
        .map(|row| row[0].clone().unwrap())
        .collect()
}

#[tokio::test]
async fn a_new_row_is_added_with_only_the_columns_given_and_the_database_fills_in_the_rest() {
    scene("ed_insert", PEOPLE).await;

    let done = done(
        "ed_insert",
        "people",
        &[row(&[("email", Some("c@x.io")), ("age", Some("25"))])],
    )
    .await;

    assert_eq!(done, Ok((0, 0, 1)));
    let made =
        rows("select id, team, created is not null from ed_insert.people where email = 'c@x.io'")
            .await;
    assert_eq!(made, [vec![Some("3".into()), None, Some("t".into())]]);
}

#[tokio::test]
async fn a_row_copied_without_its_key_takes_the_next_one_and_the_original_is_left_alone() {
    scene("ed_copy", PEOPLE).await;

    done(
        "ed_copy",
        "people",
        &[row(&[
            ("email", Some("a2@x.io")),
            ("age", Some("30")),
            ("team", Some("1")),
        ])],
    )
    .await
    .unwrap();

    assert_eq!(emails("ed_copy").await, ["a@x.io", "b@x.io", "a2@x.io"]);
}

#[tokio::test]
async fn several_rows_added_together_are_all_added() {
    scene("ed_many", PEOPLE).await;

    let done = done(
        "ed_many",
        "people",
        &[
            row(&[("email", Some("x@x.io"))]),
            row(&[("email", Some("y@x.io"))]),
            row(&[("email", Some("z@x.io"))]),
        ],
    )
    .await;

    assert_eq!(done, Ok((0, 0, 3)));
    assert_eq!(emails("ed_many").await.len(), 5);
}

#[tokio::test]
async fn a_row_of_nothing_but_defaults_is_still_added() {
    scene(
        "ed_empty",
        "create table notes (id serial primary key, at timestamptz default now())",
    )
    .await;

    let done = done("ed_empty", "notes", &[row(&[])]).await;

    assert_eq!(done, Ok((0, 0, 1)));
}

#[tokio::test]
async fn a_value_that_breaks_a_unique_constraint_is_refused_with_which_value_and_nothing_is_kept() {
    scene("ed_unique", PEOPLE).await;

    let said = done(
        "ed_unique",
        "people",
        &[
            row(&[("email", Some("new@x.io"))]),
            row(&[("email", Some("a@x.io"))]),
        ],
    )
    .await
    .unwrap_err();

    assert!(
        said.contains("duplicate key value violates unique constraint"),
        "{said}"
    );
    assert!(
        said.contains("DETAIL: Key (email)=(a@x.io) already exists."),
        "{said}"
    );
    assert_eq!(emails("ed_unique").await, ["a@x.io", "b@x.io"]);
}

#[tokio::test]
async fn a_check_constraint_is_refused_and_says_which() {
    scene("ed_check", PEOPLE).await;

    let said = done(
        "ed_check",
        "people",
        &[row(&[("email", Some("n@x.io")), ("age", Some("-3"))])],
    )
    .await
    .unwrap_err();

    assert!(said.contains("people_age_check"), "{said}");
    assert_eq!(emails("ed_check").await.len(), 2);
}

#[tokio::test]
async fn a_missing_value_in_a_column_that_may_not_be_null_is_refused_and_says_which() {
    scene("ed_notnull", PEOPLE).await;

    let said = done("ed_notnull", "people", &[row(&[("email", None)])])
        .await
        .unwrap_err();

    assert!(said.contains("null value in column \"email\""), "{said}");
}

#[tokio::test]
async fn a_row_that_points_at_nothing_is_refused_and_says_what_is_missing() {
    scene("ed_fk", PEOPLE).await;

    let said = done(
        "ed_fk",
        "people",
        &[row(&[("email", Some("n@x.io")), ("team", Some("99"))])],
    )
    .await
    .unwrap_err();

    assert!(said.contains("violates foreign key constraint"), "{said}");
    assert!(
        said.contains("Key (team)=(99) is not present in table"),
        "{said}"
    );
}

#[tokio::test]
async fn a_value_of_the_wrong_kind_is_refused_with_the_databases_words() {
    scene("ed_kind", PEOPLE).await;

    let said = done(
        "ed_kind",
        "people",
        &[row(&[("email", Some("n@x.io")), ("age", Some("old"))])],
    )
    .await
    .unwrap_err();

    assert!(
        said.contains("invalid input syntax for type integer"),
        "{said}"
    );
}

#[tokio::test]
async fn adding_deleting_and_editing_are_one_save_and_a_failure_anywhere_keeps_none_of_it() {
    scene("ed_mixed", PEOPLE).await;

    let said = done(
        "ed_mixed",
        "people",
        &[
            row(&[("email", Some("fine@x.io"))]),
            Change::Delete {
                key: one("id", Some("1")),
            },
            Change::Update {
                key: one("id", Some("2")),
                set: one("age", Some("-1")),
            },
        ],
    )
    .await
    .unwrap_err();

    assert!(said.contains("people_age_check"), "{said}");
    assert_eq!(emails("ed_mixed").await, ["a@x.io", "b@x.io"]);
}

#[tokio::test]
async fn a_column_that_is_not_in_the_table_cannot_be_given_a_value() {
    scene("ed_nocol", PEOPLE).await;

    let said = done(
        "ed_nocol",
        "people",
        &[row(&[("nope\" ) values (1); --", Some("x"))])],
    )
    .await
    .unwrap_err();

    assert!(said.contains("has no column"), "{said}");
    assert_eq!(emails("ed_nocol").await.len(), 2);
}

#[tokio::test]
async fn the_database_says_which_columns_it_fills_in_itself() {
    scene("ed_defaults", "create table t (id serial primary key, name text not null, at timestamptz default now(), plain int, gen int generated always as (plain * 2) stored)").await;

    let ResultSource::Editable { columns, .. } = source("select * from ed_defaults.t").await else {
        panic!("expected an editable result");
    };

    let defaulted: Vec<(&str, bool)> = columns
        .iter()
        .map(|c| c.as_ref().unwrap())
        .map(|c| (c.name.as_str(), c.has_default))
        .collect();
    assert_eq!(
        defaulted,
        [
            ("id", true),
            ("name", false),
            ("at", true),
            ("plain", false),
            ("gen", true)
        ]
    );
}
