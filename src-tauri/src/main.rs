// Без консольного окна в релизной сборке Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod config;
mod lsp;
mod terminal;
mod workspace;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WorkspaceState::default())
        .manage(config::ConfigState::default())
        .manage(lsp::LspState::default())
        .manage(terminal::TerminalState::default())
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
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            terminal::terminal_reset,
        ])
        .build(tauri::generate_context!())
        .expect("не удалось запустить Tulpar")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<lsp::LspState>().kill_all();
                app.state::<terminal::TerminalState>().kill_all();
            }
        });
}
