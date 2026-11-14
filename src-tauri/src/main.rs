// Без консольного окна в релизной сборке Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod ai;
mod backup;
mod config;
mod git;
mod lsp;
mod media;
mod ollama;
mod search;
mod terminal;
mod transfer;
mod update;
mod workspace;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WorkspaceState::default())
        .manage(config::ConfigState::default())
        .manage(lsp::LspState::default())
        .manage(terminal::TerminalState::default())
        .manage(transfer::DroppedPaths::default())
        .manage(ai::chat::ChatState::default())
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
            workspace::create_file,
            workspace::create_dir,
            workspace::rename_path,
            workspace::delete_path,
            search::search_project,
            search::replace_in_file,
            transfer::transfer_paths,
            git::git_status,
            git::git_show_head,
            git::git_stage,
            git::git_unstage,
            git::git_discard,
            git::git_commit,
            git::git_init,
            git::git_branches,
            git::git_checkout,
            git::git_sync,
            git::git_diff_for_message,
            git::git_blame_line,
            git::git_log,
            git::git_show_commit,
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
            media::background_import,
            media::image_read,
            ai::ai_complete,
            ai::ai_fill,
            ai::ai_models,
            ai::chat::ai_chat,
            ai::chat::ai_chat_cancel,
            ai::agent::ai_agent_step,
            ai::agent::agent_write,
            ai::agent::agent_run,
            update::update_check,
            update::update_install,
            update::update_open_page,
            update::open_url,
            backup::backup_put,
            backup::backup_delete,
            backup::backup_list,
            ollama::system_memory,
            ollama::ollama_status,
            ollama::ollama_pull,
            ollama::ollama_delete,
        ])
        .on_window_event(|window, event| {
            // Запоминаем, что пользователь сам бросил в окно: только эти пути
            // извне проекта разрешено копировать и перемещать
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                if let Ok(mut dropped) = window.state::<transfer::DroppedPaths>().0.lock() {
                    *dropped = paths.clone();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("не удалось запустить Tulpar")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<lsp::LspState>().kill_all();
                app.state::<terminal::TerminalState>().kill_all();
            }
        });
}
