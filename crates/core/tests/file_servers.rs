//! Servers kept in a file the app reads by itself, like kubectl reads its kubeconfig.

mod common;

use std::sync::Arc;

use common::MemorySecrets;
use pgclient_core::{Environment, Error, ServerBook, ServerDraft, Source, TunnelCommand};
use serde_json::json;

struct Setup {
    book: ServerBook,
    file: std::path::PathBuf,
    passfile: std::path::PathBuf,
    _dir: tempfile::TempDir,
}

fn setup() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("servers.json");
    let passfile = dir.path().join(".pgpass");
    let book = ServerBook::new(
        dir.path().join("saved.json"),
        Arc::new(MemorySecrets::default()),
    )
    .with_file(file.clone())
    .with_passfile(passfile.clone());
    Setup {
        book,
        file,
        passfile,
        _dir: dir,
    }
}

fn write(path: &std::path::Path, value: serde_json::Value) {
    std::fs::write(path, value.to_string()).unwrap();
}

fn staging() -> serde_json::Value {
    json!({ "version": 1, "servers": [{ "name": "Staging", "host": "localhost", "port": 15432, "user": "app", "database": "appdb", "group": "staging" }] })
}

#[test]
fn servers_in_the_file_are_listed_and_marked_as_coming_from_it() {
    let s = setup();
    write(&s.file, staging());

    let listing = s.book.list().unwrap();

    assert!(listing.problems.is_empty(), "{:?}", listing.problems);
    let server = &listing.servers[0];
    assert_eq!(
        (
            server.name.as_str(),
            server.port,
            server.database.as_deref(),
            server.group.as_deref()
        ),
        ("Staging", 15432, Some("appdb"), Some("staging"))
    );
    assert_eq!(server.source, Source::File);
}

#[test]
fn they_sit_beside_the_servers_saved_in_the_app() {
    let s = setup();
    write(&s.file, staging());
    s.book
        .save(ServerDraft {
            id: None,
            name: "Mine".into(),
            host: "h".into(),
            port: 1,
            user: "u".into(),
            database: None,
            group: None,
            environment: None,
            password: None,
        })
        .unwrap();

    let listing = s.book.list().unwrap();

    let sources: Vec<(&str, Source)> = listing
        .servers
        .iter()
        .map(|server| (server.name.as_str(), server.source))
        .collect();
    assert_eq!(
        sources,
        vec![("Staging", Source::File), ("Mine", Source::App)]
    );
}

#[test]
fn a_change_to_the_file_shows_up_without_restarting() {
    let s = setup();
    write(&s.file, staging());
    assert_eq!(s.book.list().unwrap().servers.len(), 1);

    write(&s.file, json!({ "version": 1, "servers": [] }));

    assert!(s.book.list().unwrap().servers.is_empty());
}

#[test]
fn a_file_server_keeps_the_same_id_from_one_read_to_the_next() {
    let s = setup();
    write(&s.file, staging());
    let first = s.book.list().unwrap().servers[0].id.clone();

    write(&s.file, staging());

    assert_eq!(s.book.list().unwrap().servers[0].id, first);
}

#[test]
fn no_file_is_not_a_problem() {
    let s = setup();

    let listing = s.book.list().unwrap();

    assert!(listing.servers.is_empty() && listing.problems.is_empty());
}

#[test]
fn a_file_that_is_broken_is_reported_and_the_saved_servers_still_list() {
    let s = setup();
    s.book
        .save(ServerDraft {
            id: None,
            name: "Mine".into(),
            host: "h".into(),
            port: 1,
            user: "u".into(),
            database: None,
            group: None,
            environment: None,
            password: None,
        })
        .unwrap();
    std::fs::write(&s.file, "{ not json").unwrap();

    let listing = s.book.list().unwrap();

    assert_eq!(listing.servers.len(), 1);
    assert_eq!(listing.problems.len(), 1);
    assert!(
        listing.problems[0].contains("servers.json"),
        "{:?}",
        listing.problems
    );
}

#[test]
fn an_entry_that_cannot_be_read_is_skipped_with_a_reason_and_the_others_still_list() {
    let s = setup();
    write(
        &s.file,
        json!({ "version": 1, "servers": [{ "name": "no-host", "user": "u" }, { "name": "fine", "host": "h", "user": "u" }] }),
    );

    let listing = s.book.list().unwrap();

    assert_eq!(
        listing
            .servers
            .iter()
            .map(|server| server.name.as_str())
            .collect::<Vec<_>>(),
        vec!["fine"]
    );
    assert!(
        listing.problems[0].contains("no-host"),
        "{:?}",
        listing.problems
    );
}

#[test]
fn a_password_in_the_file_is_used() {
    let s = setup();
    write(
        &s.file,
        json!({ "version": 1, "servers": [{ "name": "local", "host": "localhost", "port": 5561, "user": "pg", "password": "1234" }] }),
    );
    let id = s.book.list().unwrap().servers[0].id.clone();

    assert_eq!(s.book.config_of(&id).unwrap().password, "1234");
}

#[test]
fn without_one_the_password_comes_from_pgpass_the_way_psql_finds_it() {
    let s = setup();
    write(&s.file, staging());
    std::fs::write(&s.passfile, "localhost:15432:appdb:app:from-pgpass\n").unwrap();
    let id = s.book.list().unwrap().servers[0].id.clone();

    let config = s.book.config_of(&id).unwrap();

    assert_eq!(config.password, "");
    assert_eq!(config.password_for("appdb"), "from-pgpass");
}

#[test]
fn pgpass_is_looked_up_again_for_whichever_database_is_chosen() {
    let s = setup();
    write(&s.file, staging());
    std::fs::write(
        &s.passfile,
        "localhost:15432:appdb:app:for-appdb\nlocalhost:15432:other:app:for-other\n",
    )
    .unwrap();
    let id = s.book.list().unwrap().servers[0].id.clone();

    let config = s.book.config_of(&id).unwrap();

    assert_eq!(config.password_for("appdb"), "for-appdb");
    assert_eq!(config.password_for("other"), "for-other");
}

#[test]
fn no_password_anywhere_means_an_empty_one() {
    let s = setup();
    write(&s.file, staging());
    let id = s.book.list().unwrap().servers[0].id.clone();

    assert_eq!(s.book.config_of(&id).unwrap().password_for("appdb"), "");
}

#[test]
fn the_database_of_a_file_server_is_where_a_connection_starts() {
    let s = setup();
    write(&s.file, staging());
    let id = s.book.list().unwrap().servers[0].id.clone();

    assert_eq!(
        s.book.config_of(&id).unwrap().database.as_deref(),
        Some("appdb")
    );
}

#[test]
fn a_server_from_the_file_cannot_be_edited_or_removed_in_the_app() {
    let s = setup();
    write(&s.file, staging());
    let id = s.book.list().unwrap().servers[0].id.clone();

    let edit = s.book.save(ServerDraft {
        id: Some(id.clone()),
        name: "x".into(),
        host: "h".into(),
        port: 1,
        user: "u".into(),
        database: None,
        group: None,
        environment: None,
        password: None,
    });

    assert!(matches!(edit, Err(Error::ReadOnly)));
    assert!(matches!(s.book.remove(&id), Err(Error::ReadOnly)));
}

#[test]
fn a_tunnel_in_the_file_reaches_the_connection_as_a_command_or_a_list_of_arguments() {
    let s = setup();
    write(
        &s.file,
        json!({ "version": 1, "servers": [
            { "name": "by-list", "host": "localhost", "port": 15432, "user": "u",
              "tunnel": { "command": ["kubectl", "--context", "staging", "port-forward", "svc/db", "15432:5432"] } },
            { "name": "by-text", "host": "localhost", "port": 15433, "user": "u",
              "tunnel": { "command": "kubectl port-forward svc/db 15433:5432", "timeout_seconds": 5 } },
        ]}),
    );
    let listing = s.book.list().unwrap();
    assert!(listing.problems.is_empty(), "{:?}", listing.problems);
    let config = |name: &str| {
        s.book
            .config_of(
                &listing
                    .servers
                    .iter()
                    .find(|server| server.name == name)
                    .unwrap()
                    .id,
            )
            .unwrap()
    };

    assert_eq!(
        config("by-list").tunnel.unwrap().command,
        TunnelCommand::Args(
            [
                "kubectl",
                "--context",
                "staging",
                "port-forward",
                "svc/db",
                "15432:5432"
            ]
            .map(String::from)
            .to_vec()
        )
    );
    let by_text = config("by-text").tunnel.unwrap();
    assert_eq!(
        (by_text.command, by_text.timeout_seconds),
        (
            TunnelCommand::Shell("kubectl port-forward svc/db 15433:5432".into()),
            Some(5)
        )
    );
}

#[test]
fn a_server_with_no_tunnel_has_none() {
    let s = setup();
    write(&s.file, staging());
    let id = s.book.list().unwrap().servers[0].id.clone();

    assert!(s.book.config_of(&id).unwrap().tunnel.is_none());
}

#[test]
fn a_tunnel_arriving_through_import_is_ignored_and_said_so_since_only_the_file_may_run_commands() {
    let s = setup();
    let pasted = json!({ "version": 1, "servers": [{ "name": "sneaky", "host": "h", "user": "u", "tunnel": { "command": "touch /tmp/pwned" } }] });

    let report = s.book.import(&pasted.to_string()).unwrap();

    assert_eq!(report.added, 1);
    assert!(
        report
            .skipped
            .iter()
            .any(|note| note.contains("sneaky") && note.contains("tunnel")),
        "{:?}",
        report.skipped
    );
    let id = s
        .book
        .list()
        .unwrap()
        .servers
        .iter()
        .find(|server| server.name == "sneaky")
        .unwrap()
        .id
        .clone();
    assert!(s.book.config_of(&id).unwrap().tunnel.is_none());
}

#[test]
fn another_database_on_the_same_server_uses_the_servers_password_when_pgpass_only_names_one() {
    let s = setup();
    write(&s.file, staging());
    std::fs::write(&s.passfile, "localhost:15432:appdb:app:the-password\n").unwrap();
    let id = s.book.list().unwrap().servers[0].id.clone();

    let config = s.book.config_of(&id).unwrap();

    assert_eq!(config.password_for("postgres"), "the-password");
    assert_eq!(config.password_for("anything_else"), "the-password");
}

#[test]
fn a_line_for_the_exact_database_still_beats_the_one_for_the_server() {
    let s = setup();
    write(&s.file, staging());
    std::fs::write(
        &s.passfile,
        "localhost:15432:appdb:app:general\nlocalhost:15432:special:app:specific\n",
    )
    .unwrap();
    let id = s.book.list().unwrap().servers[0].id.clone();

    let config = s.book.config_of(&id).unwrap();

    assert_eq!(config.password_for("special"), "specific");
    assert_eq!(config.password_for("other"), "general");
}

#[test]
fn a_different_user_never_borrows_the_password_of_another() {
    let s = setup();
    write(&s.file, staging());
    std::fs::write(
        &s.passfile,
        "localhost:15432:appdb:someone-else:not-yours\n",
    )
    .unwrap();
    let id = s.book.list().unwrap().servers[0].id.clone();

    assert_eq!(s.book.config_of(&id).unwrap().password_for("appdb"), "");
}

#[test]
fn the_same_name_in_two_environments_is_two_servers() {
    let s = setup();
    write(
        &s.file,
        json!({ "version": 1, "servers": [
            { "name": "shop", "host": "localhost", "port": 5432, "user": "u", "environment": "local" },
            { "name": "shop", "host": "localhost", "port": 15434, "user": "u", "environment": "dev" },
        ] }),
    );

    let listing = s.book.list().unwrap();

    assert!(listing.problems.is_empty(), "{:?}", listing.problems);
    let found: Vec<_> = listing
        .servers
        .iter()
        .map(|server| (server.name.as_str(), server.environment, server.port))
        .collect();
    assert_eq!(
        found,
        [
            ("shop", Some(Environment::Local), 5432),
            ("shop", Some(Environment::Dev), 15434)
        ]
    );
    assert_ne!(listing.servers[0].id, listing.servers[1].id);
    assert_eq!(
        s.book.config_of(&listing.servers[1].id).unwrap().port,
        15434
    );
}

#[test]
fn an_environment_is_read_whatever_its_case() {
    let s = setup();
    write(
        &s.file,
        json!({ "servers": [{ "name": "orders", "host": "h", "user": "u", "environment": "Prod" }] }),
    );

    assert_eq!(
        s.book.list().unwrap().servers[0].environment,
        Some(Environment::Prod)
    );
}

#[test]
fn an_unknown_environment_skips_only_its_own_entry() {
    let s = setup();
    write(
        &s.file,
        json!({ "servers": [
            { "name": "orders", "host": "h", "user": "u", "environment": "qa" },
            { "name": "billing", "host": "h", "user": "u" },
        ] }),
    );

    let listing = s.book.list().unwrap();

    assert_eq!(listing.servers.len(), 1);
    assert_eq!(listing.servers[0].name, "billing");
    assert_eq!(listing.servers[0].environment, None);
    assert!(
        listing.problems[0].contains("\"qa\""),
        "{:?}",
        listing.problems
    );
}
