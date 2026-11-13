// Без консольного окна в релизной сборке Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod workspace;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WorkspaceState::default())
        .manage(config::ConfigState::default())
        .setup(|app| {
            // Следим за папкой настроек, чтобы применять изменения без перезапуска
            config::start_watching(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace::workspace_open,
            workspace::workspace_root,
            workspace::read_dir,
            workspace::read_file,
            workspace::write_file,
            workspace::list_files,
            config::config_read,
            config::config_dir,
            config::config_ensure,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить Tulpar");
}
