//! The PATH a terminal has and an app opened from the Dock does not, which is where kubectl is found.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::{Duration, Instant};

use pgclient_core::login_path::{merge_paths, parse_marked, read_login_path, resolve};

/// A stand-in for the person's shell: it announces itself the way a shell with a banner does, then runs what it is asked to.
fn shell_script(dir: &Path, body: &str) -> String {
    let path = dir.join("fake-shell");
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path.display().to_string()
}

#[test]
fn what_the_shell_has_comes_first_and_nothing_is_listed_twice() {
    assert_eq!(
        merge_paths("/opt/homebrew/bin:/usr/bin", "/usr/bin:/bin"),
        "/opt/homebrew/bin:/usr/bin:/bin"
    );
}

#[test]
fn empty_entries_are_dropped_since_they_would_mean_the_current_folder() {
    assert_eq!(merge_paths("/a::/b:", ":/c"), "/a:/b:/c");
}

#[test]
fn the_value_is_found_between_its_markers_whatever_the_shell_printed_around_it() {
    let output = "Last login: Thu Oct 15 on ttys001\nwelcome to zsh\n__PGCLIENT_PATH__/opt/homebrew/bin:/usr/bin__PGCLIENT_PATH__\ngoodbye\n";

    assert_eq!(
        parse_marked(output).as_deref(),
        Some("/opt/homebrew/bin:/usr/bin")
    );
}

#[test]
fn without_the_markers_there_is_nothing_to_find() {
    assert_eq!(parse_marked("just a banner"), None);
    assert_eq!(parse_marked("__PGCLIENT_PATH__only one"), None);
    assert_eq!(parse_marked("__PGCLIENT_PATH____PGCLIENT_PATH__"), None);
}

#[test]
fn a_real_shell_tells_its_path() {
    let path = read_login_path("/bin/sh", Duration::from_secs(5)).expect("sh answers");

    assert!(path.contains("/usr/bin"), "{path}");
}

#[test]
fn a_banner_and_a_noisy_startup_do_not_get_in_the_way() {
    let dir = tempfile::tempdir().unwrap();
    let shell = shell_script(
        dir.path(),
        "echo 'Last login: today'; echo 'nvm: loading'; exec /bin/sh -c \"$2\"",
    );

    let path = read_login_path(&shell, Duration::from_secs(5)).expect("answers through the noise");

    assert!(path.contains("/usr/bin"), "{path}");
    assert!(!path.contains("Last login"), "{path}");
}

#[test]
fn a_shell_that_does_not_exist_gives_nothing() {
    assert_eq!(
        read_login_path("/nonexistent/shell", Duration::from_secs(1)),
        None
    );
}

#[test]
fn a_shell_that_hangs_is_given_up_on_so_the_app_never_waits_for_it() {
    let dir = tempfile::tempdir().unwrap();
    let shell = shell_script(dir.path(), "sleep 30");
    let started = Instant::now();

    let path = read_login_path(&shell, Duration::from_millis(400));

    assert_eq!(path, None);
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "waited {:?}",
        started.elapsed()
    );
}

#[test]
fn a_shell_that_fails_gives_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let shell = shell_script(dir.path(), "exit 3");

    assert_eq!(read_login_path(&shell, Duration::from_secs(2)), None);
}

#[test]
fn the_shells_path_wins_over_the_apps_own() {
    let dir = tempfile::tempdir().unwrap();
    let shell = shell_script(
        dir.path(),
        "printf '__PGCLIENT_PATH__/custom/bin:/usr/bin__PGCLIENT_PATH__'",
    );

    let path = resolve(&shell, "/usr/bin:/bin", "/Users/someone");

    assert!(path.starts_with("/custom/bin:/usr/bin"), "{path}");
    assert!(path.contains("/bin"), "{path}");
}

#[test]
fn when_the_shell_cannot_say_the_usual_places_are_tried_anyway() {
    let path = resolve("/nonexistent/shell", "/usr/bin:/bin", "/Users/someone");

    for place in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/Users/someone/.local/bin",
        "/usr/local/google-cloud-sdk/bin",
        "/usr/bin",
        "/bin",
    ] {
        assert!(
            path.split(':').any(|entry| entry == place),
            "{place} missing from {path}"
        );
    }
    assert_eq!(
        path.split(':').count(),
        path.split(':')
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        "duplicates in {path}"
    );
}
