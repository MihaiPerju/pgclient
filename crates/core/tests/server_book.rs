//! Saved servers: the details in a file, the password only in the secret store.

mod common;

use common::fixture;
use pgclient_core::{Error, SecretStore, ServerBook, ServerDraft};

fn local(password: Option<&str>) -> ServerDraft {
    ServerDraft {
        id: None,
        name: "Local".into(),
        host: "localhost".into(),
        port: 5432,
        user: "postgres".into(),
        database: None,
        group: None,
        environment: None,
        password: password.map(Into::into),
    }
}

#[test]
fn a_new_book_has_no_servers() {
    assert!(fixture().book.list().unwrap().servers.is_empty());
}

#[test]
fn a_saved_server_is_listed_with_everything_but_its_password() {
    let f = fixture();

    let saved = f.book.save(local(Some("s3cret"))).unwrap();

    assert_eq!(f.book.list().unwrap().servers, vec![saved.clone()]);
    assert_eq!(
        (
            saved.name.as_str(),
            saved.host.as_str(),
            saved.port,
            saved.user.as_str()
        ),
        ("Local", "localhost", 5432, "postgres")
    );
}

#[test]
fn the_password_never_reaches_the_file() {
    let f = fixture();

    f.book.save(local(Some("s3cret"))).unwrap();

    let file = std::fs::read_to_string(f.dir.path().join("servers.json")).unwrap();
    assert!(!file.contains("s3cret"));
}

#[test]
fn a_saved_server_can_be_turned_into_a_connection_with_its_password() {
    let f = fixture();
    let saved = f.book.save(local(Some("s3cret"))).unwrap();

    let config = f.book.config_of(&saved.id).unwrap();

    assert_eq!(
        (
            config.host.as_str(),
            config.port,
            config.user.as_str(),
            config.password.as_str()
        ),
        ("localhost", 5432, "postgres", "s3cret")
    );
}

#[test]
fn a_server_saved_without_a_password_connects_with_an_empty_one() {
    let f = fixture();
    let saved = f.book.save(local(None)).unwrap();

    assert_eq!(f.book.config_of(&saved.id).unwrap().password, "");
}

#[test]
fn every_server_gets_an_id_of_its_own() {
    let f = fixture();

    let first = f.book.save(local(None)).unwrap();
    let second = f.book.save(local(None)).unwrap();

    assert_ne!(first.id, second.id);
    assert_eq!(f.book.list().unwrap().servers.len(), 2);
}

#[test]
fn editing_a_server_changes_it_in_place_and_keeps_its_password_unless_given_a_new_one() {
    let f = fixture();
    let saved = f.book.save(local(Some("s3cret"))).unwrap();

    let edited = f
        .book
        .save(ServerDraft {
            id: Some(saved.id.clone()),
            name: "Renamed".into(),
            port: 5433,
            ..local(None)
        })
        .unwrap();

    assert_eq!(f.book.list().unwrap().servers, vec![edited]);
    let config = f.book.config_of(&saved.id).unwrap();
    assert_eq!((config.port, config.password.as_str()), (5433, "s3cret"));

    f.book
        .save(ServerDraft {
            id: Some(saved.id.clone()),
            ..local(Some("new"))
        })
        .unwrap();
    assert_eq!(f.book.config_of(&saved.id).unwrap().password, "new");
}

#[test]
fn removing_a_server_forgets_its_password_too() {
    let f = fixture();
    let saved = f.book.save(local(Some("s3cret"))).unwrap();

    f.book.remove(&saved.id).unwrap();

    assert!(f.book.list().unwrap().servers.is_empty());
    assert_eq!(f.secrets.get(&saved.id).unwrap(), None);
}

#[test]
fn an_unknown_server_is_reported_as_unknown() {
    let f = fixture();

    assert!(matches!(
        f.book.config_of("nope"),
        Err(Error::UnknownServer)
    ));
    assert!(matches!(
        f.book.save(ServerDraft {
            id: Some("nope".into()),
            ..local(None)
        }),
        Err(Error::UnknownServer)
    ));
}

#[test]
fn the_servers_are_still_there_for_the_next_run() {
    let f = fixture();
    let saved = f.book.save(local(Some("s3cret"))).unwrap();

    let again = ServerBook::new(f.dir.path().join("servers.json"), f.secrets.clone());

    assert_eq!(again.list().unwrap().servers, vec![saved]);
}
