//! ~/.pgpass the way psql reads it: host:port:database:user:password, with * for anything.

use pgclient_core::PassFile;

#[test]
fn the_matching_line_gives_its_password() {
    let file = PassFile::parse("db.internal:5432:appdb:app:s3cret\n");

    assert_eq!(
        file.lookup("db.internal", 5432, "appdb", "app").as_deref(),
        Some("s3cret")
    );
}

#[test]
fn every_field_has_to_match() {
    let file = PassFile::parse("db.internal:5432:appdb:app:s3cret\n");

    assert_eq!(file.lookup("other", 5432, "appdb", "app"), None);
    assert_eq!(file.lookup("db.internal", 5433, "appdb", "app"), None);
    assert_eq!(file.lookup("db.internal", 5432, "other", "app"), None);
    assert_eq!(file.lookup("db.internal", 5432, "appdb", "other"), None);
}

#[test]
fn a_star_matches_anything() {
    let file = PassFile::parse("localhost:*:*:pg:1234\n");

    assert_eq!(
        file.lookup("localhost", 5561, "whatever", "pg").as_deref(),
        Some("1234")
    );
}

#[test]
fn the_first_matching_line_wins() {
    let file = PassFile::parse("localhost:*:*:pg:first\nlocalhost:5432:db:pg:second\n");

    assert_eq!(
        file.lookup("localhost", 5432, "db", "pg").as_deref(),
        Some("first")
    );
}

#[test]
fn comments_and_blank_lines_are_ignored() {
    let file = PassFile::parse("# staging\n\n   \nlocalhost:*:*:pg:1234\n");

    assert_eq!(
        file.lookup("localhost", 1, "x", "pg").as_deref(),
        Some("1234")
    );
}

#[test]
fn a_colon_or_backslash_can_be_escaped_in_any_field() {
    let file = PassFile::parse("localhost:5432:*:pg:pa\\:ss\\\\word\n");

    assert_eq!(
        file.lookup("localhost", 5432, "x", "pg").as_deref(),
        Some("pa:ss\\word")
    );
}

#[test]
fn a_password_may_be_followed_by_nothing_else_and_may_be_empty() {
    let file = PassFile::parse("localhost:5432:*:pg:\n");

    assert_eq!(
        file.lookup("localhost", 5432, "x", "pg").as_deref(),
        Some("")
    );
}

#[test]
fn a_line_that_is_not_five_fields_is_skipped() {
    let file = PassFile::parse("broken:line\nlocalhost:5432:*:pg:ok\n");

    assert_eq!(
        file.lookup("localhost", 5432, "x", "pg").as_deref(),
        Some("ok")
    );
}

#[test]
fn a_missing_file_is_simply_empty() {
    let file = PassFile::read(std::path::Path::new("/nonexistent/.pgpass"));

    assert_eq!(file.lookup("localhost", 5432, "x", "pg"), None);
}

#[test]
fn a_password_can_be_found_for_a_user_whatever_the_database() {
    let file =
        PassFile::parse("localhost:15432:appdb:app:s3cret\nlocalhost:15433:other:app:elsewhere\n");

    assert_eq!(
        file.lookup_for_server("localhost", 15432, "app").as_deref(),
        Some("s3cret")
    );
    assert_eq!(
        file.lookup_for_server("localhost", 15433, "app").as_deref(),
        Some("elsewhere")
    );
}

#[test]
fn a_user_with_no_line_for_that_server_gets_nothing() {
    let file = PassFile::parse("localhost:15432:appdb:app:s3cret\n");

    assert_eq!(
        file.lookup_for_server("localhost", 15432, "someone-else"),
        None
    );
    assert_eq!(file.lookup_for_server("localhost", 9999, "app"), None);
}
