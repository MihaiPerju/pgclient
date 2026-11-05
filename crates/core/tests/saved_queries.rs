//! The text of each server's and database's editor, kept between runs of the app.

use pgclient_core::SavedQueries;

fn store() -> (tempfile::TempDir, SavedQueries) {
    let dir = tempfile::tempdir().unwrap();
    let store = SavedQueries::new(dir.path().join("nested").join("queries.json"));
    (dir, store)
}

#[test]
fn nothing_is_saved_until_something_is() {
    let (_dir, store) = store();

    assert!(store.load().is_empty());
}

#[test]
fn what_is_saved_is_there_for_the_next_run_of_the_app() {
    let (dir, store) = store();
    store.save("s1/app", "select 1").unwrap();
    store.save("s1/other", "select 2\nfrom t").unwrap();

    let again = SavedQueries::new(dir.path().join("nested").join("queries.json")).load();

    assert_eq!(again["s1/app"], "select 1");
    assert_eq!(again["s1/other"], "select 2\nfrom t");
}

#[test]
fn saving_again_replaces_that_one_and_leaves_the_others() {
    let (_dir, store) = store();
    store.save("a", "one").unwrap();
    store.save("b", "two").unwrap();

    store.save("a", "uno").unwrap();

    assert_eq!(store.load()["a"], "uno");
    assert_eq!(store.load()["b"], "two");
}

#[test]
fn text_that_is_only_space_forgets_the_key() {
    let (_dir, store) = store();
    store.save("a", "one").unwrap();

    store.save("a", "  \n ").unwrap();

    assert!(!store.load().contains_key("a"));
}

#[test]
fn a_file_that_cannot_be_read_is_set_aside_not_overwritten() {
    let (dir, store) = store();
    store.save("a", "one").unwrap();
    let path = dir.path().join("nested").join("queries.json");
    std::fs::write(&path, "{ not json").unwrap();
    assert!(store.load().is_empty());

    store.save("b", "two").unwrap();

    assert_eq!(store.load().keys().collect::<Vec<_>>(), ["b"]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("nested").join("queries.json.corrupt")).unwrap(),
        "{ not json"
    );
}

#[test]
fn saves_made_at_the_same_time_do_not_lose_each_other() {
    let (_dir, store) = store();
    let store = std::sync::Arc::new(store);

    let threads: Vec<_> = (0..8)
        .map(|n| {
            let store = store.clone();
            std::thread::spawn(move || store.save(&format!("key{n}"), &format!("text{n}")).unwrap())
        })
        .collect();
    threads
        .into_iter()
        .for_each(|thread| thread.join().unwrap());

    assert_eq!(store.load().len(), 8);
}
