mod keychain;

use std::sync::Arc;

use pgclient_core::{
    Applied, CatalogTable, Change, ColumnInfo, Core, ImportReport, Listing, MetricsSnapshot,
    QueryEvent, ResultSource, SavedQueries, SavedServer, ServerBook, ServerDraft, Session, Stop,
    TableInfo, login_path,
};
use tauri::ipc::Channel;
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

struct App {
    core: Core,
    servers: ServerBook,
    queries: SavedQueries,
}

type Reply<T> = Result<T, String>;

/// Like kubectl's KUBECONFIG: a variable can point somewhere else, and otherwise the usual place under the home folder is used.
fn env_path(name: &str) -> Option<std::path::PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(Into::into)
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
fn list_servers(app: State<App>) -> Reply<Listing> {
    app.servers.list().map_err(text)
}

#[tauri::command]
fn save_server(app: State<App>, draft: ServerDraft) -> Reply<SavedServer> {
    app.servers.save(draft).map_err(text)
}

#[tauri::command]
fn remove_server(app: State<App>, id: String) -> Reply<()> {
    app.servers.remove(&id).map_err(text)
}

#[tauri::command]
fn export_servers(app: State<App>, include_passwords: bool) -> Reply<String> {
    app.servers.export(include_passwords).map_err(text)
}

#[tauri::command]
fn import_servers(app: State<App>, text: String) -> Reply<ImportReport> {
    app.servers.import(&text).map_err(self::text)
}

/// Asks where to save, then writes `contents` there. Returns the chosen path, or nothing if the dialog was dismissed.
#[tauri::command]
async fn save_file(
    window: tauri::WebviewWindow,
    file_name: String,
    contents: String,
) -> Reply<Option<String>> {
    let (chosen, answer) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .set_file_name(file_name)
        .save_file(move |path| {
            let _ = chosen.send(path);
        });
    let Some(path) = answer.await.map_err(text)? else {
        return Ok(None);
    };
    let path = path.into_path().map_err(text)?;
    std::fs::write(&path, contents).map_err(text)?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
fn load_queries(app: State<App>) -> std::collections::BTreeMap<String, String> {
    app.queries.load()
}

#[tauri::command]
fn save_query(app: State<App>, key: String, text: String) -> Reply<()> {
    app.queries
        .save(&key, &text)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_databases(app: State<'_, App>, server_id: String) -> Reply<Vec<String>> {
    let server = app.servers.config_of(&server_id).map_err(text)?;
    app.core.list_databases(&server).await.map_err(text)
}

#[tauri::command]
async fn list_tables(
    app: State<'_, App>,
    server_id: String,
    database: String,
) -> Reply<Vec<TableInfo>> {
    let server = app.servers.config_of(&server_id).map_err(text)?;
    app.core.list_tables(&server, &database).await.map_err(text)
}

#[tauri::command]
async fn catalog(
    app: State<'_, App>,
    server_id: String,
    database: String,
) -> Reply<Vec<CatalogTable>> {
    let server = app.servers.config_of(&server_id).map_err(text)?;
    app.core.catalog(&server, &database).await.map_err(text)
}

#[tauri::command]
async fn list_columns(
    app: State<'_, App>,
    server_id: String,
    database: String,
    schema: String,
    table: String,
) -> Reply<Vec<ColumnInfo>> {
    let server = app.servers.config_of(&server_id).map_err(text)?;
    app.core
        .list_columns(&server, &database, &schema, &table)
        .await
        .map_err(text)
}

#[tauri::command]
async fn metrics(
    app: State<'_, App>,
    server_id: String,
    database: String,
) -> Reply<MetricsSnapshot> {
    let server = app.servers.config_of(&server_id).map_err(text)?;
    app.core.metrics(&server, &database).await.map_err(text)
}

#[tauri::command]
async fn sessions(app: State<'_, App>, server_id: String, database: String) -> Reply<Vec<Session>> {
    let server = app.servers.config_of(&server_id).map_err(text)?;
    app.core.sessions(&server, &database).await.map_err(text)
}

#[tauri::command]
async fn stop_session(
    app: State<'_, App>,
    server_id: String,
    database: String,
    pid: i32,
    how: Stop,
) -> Reply<bool> {
    let server = app.servers.config_of(&server_id).map_err(text)?;
    app.core
        .stop_session(&server, &database, pid, how)
        .await
        .map_err(text)
}

/// Returns the id of the run at once, and sends what the query produces down `on_event` as it arrives.
#[tauri::command]
async fn run_query(
    app: State<'_, App>,
    server_id: String,
    database: String,
    sql: String,
    on_event: Channel<QueryEvent>,
) -> Reply<u64> {
    let server = app.servers.config_of(&server_id).map_err(text)?;
    let mut run = app
        .core
        .run_query(&server, &database, &sql)
        .await
        .map_err(text)?;
    let id = run.id;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = run.events.recv().await {
            if on_event.send(event).is_err() {
                break;
            }
        }
    });
    Ok(id)
}

#[tauri::command]
async fn describe_result(
    app: State<'_, App>,
    server_id: String,
    database: String,
    sql: String,
) -> Reply<ResultSource> {
    let server = app.servers.config_of(&server_id).map_err(text)?;
    app.core
        .source_of(&server, &database, &sql)
        .await
        .map_err(text)
}

#[tauri::command]
async fn apply_changes(
    app: State<'_, App>,
    server_id: String,
    database: String,
    schema: String,
    table: String,
    changes: Vec<Change>,
) -> Reply<Applied> {
    let server = app.servers.config_of(&server_id).map_err(text)?;
    app.core
        .apply_changes(&server, &database, &schema, &table, &changes)
        .await
        .map_err(text)
}

#[tauri::command]
async fn cancel_query(app: State<'_, App>, id: u64) -> Reply<()> {
    app.core.cancel(id).await;
    Ok(())
}

/// The menu bar. The one a window gets without one has Close Window on Command W, which the system handles before the page ever sees
/// the key, so Command W would close the whole window and not the tab. This one leaves it off, and the page has the shortcuts.
fn menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = PredefinedMenuItem::about(app, None, None)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let hide = PredefinedMenuItem::hide(app, None)?;
    let hide_others = PredefinedMenuItem::hide_others(app, None)?;
    let show_all = PredefinedMenuItem::show_all(app, None)?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let maximize = PredefinedMenuItem::maximize(app, None)?;
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "PgClient",
                true,
                &[
                    &about,
                    &separator,
                    &hide,
                    &hide_others,
                    &show_all,
                    &separator,
                    &quit,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[&undo, &redo, &separator, &cut, &copy, &paste, &select_all],
            )?,
            &Submenu::with_items(app, "View", true, &[&fullscreen])?,
            &Submenu::with_items(app, "Window", true, &[&minimize, &maximize])?,
        ],
    )
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(menu)
        .setup(|app| {
            let saved = app.path().app_config_dir()?.join("servers.json");
            let home = app.path().home_dir()?;
            let tools_home = home.display().to_string();
            app.manage(App {
                // Opened from the Dock, the app is not given a terminal's PATH, and kubectl is on that one.
                core: Core::with_tunnel_path_resolver(move || {
                    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
                    login_path::resolve(
                        &shell,
                        &std::env::var("PATH").unwrap_or_default(),
                        &tools_home,
                    )
                }),
                servers: ServerBook::new(saved, Arc::new(keychain::Keychain))
                    .with_file(
                        env_path("PGCLIENT_CONFIG")
                            .unwrap_or_else(|| home.join(".pgclient").join("servers.json")),
                    )
                    .with_passfile(env_path("PGPASSFILE").unwrap_or_else(|| home.join(".pgpass"))),
                queries: SavedQueries::new(
                    env_path("PGCLIENT_QUERIES")
                        .unwrap_or_else(|| home.join(".pgclient").join("queries.json")),
                ),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_servers,
            save_server,
            remove_server,
            export_servers,
            import_servers,
            save_file,
            load_queries,
            save_query,
            list_databases,
            list_tables,
            list_columns,
            catalog,
            metrics,
            sessions,
            stop_session,
            run_query,
            describe_result,
            apply_changes,
            cancel_query
        ])
        .build(tauri::generate_context!())
        .expect("the app failed to start");
    app.run(|handle, event| {
        // A port-forward the app started must not outlive it.
        if let (tauri::RunEvent::Exit, Some(state)) = (&event, handle.try_state::<App>()) {
            tauri::async_runtime::block_on(state.core.stop_tunnels());
        }
    });
}
