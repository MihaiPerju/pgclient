//! Getting servers in and out of the app: a JSON file, or just a list of postgres:// addresses.

mod common;

use common::fixture;
use pgclient_core::{Error, SecretStore, ServerBook};
use serde_json::{Value, json};

fn names(book: &ServerBook) -> Vec<String> {
    let mut names: Vec<String> = book
        .list()
        .unwrap()
        .servers
        .into_iter()
        .map(|server| server.name)
        .collect();
    names.sort();
    names
}

#[test]
fn an_export_is_a_versioned_list_of_servers() {
    let f = fixture();
    f.book
        .import("postgres://app:pw@localhost:5433/appdb#staging")
        .unwrap();

    let exported: Value = serde_json::from_str(&f.book.export(false).unwrap()).unwrap();

    assert_eq!(exported["version"], 1);
    assert_eq!(
        exported["servers"],
        json!([{ "name": "staging", "host": "localhost", "port": 5433, "user": "app", "database": "appdb" }])
    );
}

#[test]
fn an_export_leaves_passwords_out_unless_asked() {
    let f = fixture();
    f.book
        .import("postgres://app:s3cret@localhost/appdb")
        .unwrap();

    assert!(!f.book.export(false).unwrap().contains("s3cret"));
    let with: Value = serde_json::from_str(&f.book.export(true).unwrap()).unwrap();
    assert_eq!(with["servers"][0]["password"], "s3cret");
}

#[test]
fn what_is_exported_can_be_imported_again_somewhere_else() {
    let f = fixture();
    f.book
        .import("postgres://app:s3cret@db.internal:6543/appdb#prod")
        .unwrap();
    let elsewhere = fixture();

    let report = elsewhere
        .book
        .import(&f.book.export(true).unwrap())
        .unwrap();

    assert_eq!((report.added, report.updated), (1, 0));
    let saved = elsewhere.book.list().unwrap().servers.remove(0);
    let config = elsewhere.book.config_of(&saved.id).unwrap();
    assert_eq!(
        (saved.name.as_str(), saved.database.as_deref()),
        ("prod", Some("appdb"))
    );
    assert_eq!(
        (
            config.host.as_str(),
            config.port,
            config.user.as_str(),
            config.password.as_str()
        ),
        ("db.internal", 6543, "app", "s3cret")
    );
}

#[test]
fn a_server_can_be_given_as_one_address_or_as_separate_fields() {
    let f = fixture();
    let file = json!({ "version": 1, "servers": [
        { "name": "by-uri", "uri": "postgresql://ann:pw@host-a:6000/one" },
        { "name": "by-parts", "host": "host-b", "port": 6001, "user": "ben", "password": "pw2", "database": "two", "group": "staging" },
    ]});

    f.book.import(&file.to_string()).unwrap();

    let servers = f.book.list().unwrap().servers;
    let by_uri = servers.iter().find(|s| s.name == "by-uri").unwrap();
    let by_parts = servers.iter().find(|s| s.name == "by-parts").unwrap();
    assert_eq!(
        (
            by_uri.host.as_str(),
            by_uri.port,
            by_uri.user.as_str(),
            by_uri.database.as_deref()
        ),
        ("host-a", 6000, "ann", Some("one"))
    );
    assert_eq!(
        (
            by_parts.host.as_str(),
            by_parts.port,
            by_parts.group.as_deref()
        ),
        ("host-b", 6001, Some("staging"))
    );
    assert_eq!(f.book.config_of(&by_uri.id).unwrap().password, "pw");
}

#[test]
fn a_password_with_special_characters_is_read_as_typed() {
    let f = fixture();

    f.book
        .import("postgres://app:p%40ss%2Fw%3Ard@localhost/appdb")
        .unwrap();

    let id = f.book.list().unwrap().servers.remove(0).id;
    assert_eq!(f.book.config_of(&id).unwrap().password, "p@ss/w:rd");
}

#[test]
fn a_list_of_addresses_makes_a_server_each_and_skips_blanks_and_comments() {
    let f = fixture();
    let text = "# my databases\n\npostgres://a:1@one:5432/x#first\n  postgres://b:2@two/y  \n";

    let report = f.book.import(text).unwrap();

    assert_eq!(report.added, 2);
    assert_eq!(
        names(&f.book),
        vec!["first".to_string(), "two:5432/y".to_string()]
    );
}

#[test]
fn a_missing_port_is_the_usual_one() {
    let f = fixture();

    f.book.import("postgres://a:1@localhost/x").unwrap();

    assert_eq!(f.book.list().unwrap().servers[0].port, 5432);
}

#[test]
fn importing_a_name_that_is_already_saved_updates_it_and_keeps_its_password_if_none_is_given() {
    let f = fixture();
    f.book
        .import("postgres://app:keep@old-host/x#prod")
        .unwrap();
    let id = f.book.list().unwrap().servers[0].id.clone();

    let report = f.book.import(&json!({ "version": 1, "servers": [{ "name": "PROD", "host": "new-host", "port": 5432, "user": "app" }] }).to_string()).unwrap();

    assert_eq!((report.added, report.updated), (0, 1));
    assert_eq!(f.book.list().unwrap().servers.len(), 1);
    let config = f.book.config_of(&id).unwrap();
    assert_eq!(
        (config.host.as_str(), config.password.as_str()),
        ("new-host", "keep")
    );
}

#[test]
fn an_entry_that_cannot_be_read_is_skipped_with_a_reason_and_the_rest_still_go_in() {
    let f = fixture();
    let text = "postgres://a:1@good/x\nmysql://a:1@wrong-kind/x\nnot an address at all\n";

    let report = f.book.import(text).unwrap();

    assert_eq!(report.added, 1);
    assert_eq!(report.skipped.len(), 2);
    assert!(report.skipped[0].contains("line 2"), "{:?}", report.skipped);
    assert!(report.skipped[1].contains("line 3"), "{:?}", report.skipped);
}

#[test]
fn a_json_entry_with_no_name_or_no_host_is_skipped() {
    let f = fixture();
    let file = json!({ "version": 1, "servers": [{ "host": "h", "user": "u" }, { "name": "no-host", "user": "u" }, { "name": "fine", "host": "h", "user": "u" }] });

    let report = f.book.import(&file.to_string()).unwrap();

    assert_eq!((report.added, report.skipped.len()), (1, 2));
}

#[test]
fn a_file_of_a_newer_version_is_refused_rather_than_half_read() {
    let f = fixture();

    let error = f
        .book
        .import(&json!({ "version": 2, "servers": [] }).to_string())
        .unwrap_err();

    assert!(matches!(error, Error::Import(_)));
    assert!(error.to_string().contains("version"), "{error}");
}

#[test]
fn json_that_is_broken_is_an_error_not_a_crash() {
    let f = fixture();

    assert!(matches!(
        f.book
            .import("{ \"version\": 1, \"servers\": [")
            .unwrap_err(),
        Error::Import(_)
    ));
}

#[test]
fn fields_this_version_does_not_know_are_ignored() {
    let f = fixture();
    let file = json!({ "version": 1, "extra": true, "servers": [{ "name": "a", "host": "h", "user": "u", "colour": "red" }] });

    assert_eq!(f.book.import(&file.to_string()).unwrap().added, 1);
}

#[test]
fn importing_puts_passwords_in_the_secret_store_and_never_in_the_file() {
    let f = fixture();

    f.book.import("postgres://app:s3cret@localhost/x").unwrap();

    let id = f.book.list().unwrap().servers[0].id.clone();
    assert_eq!(f.secrets.get(&id).unwrap().as_deref(), Some("s3cret"));
    assert!(
        !std::fs::read_to_string(f.dir.path().join("servers.json"))
            .unwrap()
            .contains("s3cret")
    );
}

#[test]
fn the_environment_goes_out_in_an_export_and_comes_back_in_an_import() {
    let from = fixture();
    from.book
        .import(&json!({ "version": 1, "servers": [{ "name": "orders", "uri": "postgres://u@h/db", "environment": "staging" }] }).to_string())
        .unwrap();

    let exported: Value = serde_json::from_str(&from.book.export(false).unwrap()).unwrap();
    assert_eq!(exported["servers"][0]["environment"], "staging");

    let to = fixture();
    to.book.import(&exported.to_string()).unwrap();
    assert_eq!(
        to.book.list().unwrap().servers[0].environment,
        Some(pgclient_core::Environment::Staging)
    );
}

#[test]
fn importing_a_name_from_another_environment_adds_it_beside_the_first() {
    let f = fixture();
    let file = |environment: &str| {
        json!({ "servers": [{ "name": "orders", "uri": "postgres://u@h/db", "environment": environment }] }).to_string()
    };
    f.book.import(&file("dev")).unwrap();

    let report = f.book.import(&file("prod")).unwrap();

    assert_eq!((report.added, report.updated), (1, 0));
    assert_eq!(names(&f.book), ["orders", "orders"]);
}
