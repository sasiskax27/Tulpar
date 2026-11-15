// Без консольного окна в релизной сборке Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod ai;
mod backup;
mod config;
mod ext;
mod git;
mod http;
mod lsp;
mod media;
mod ollama;
mod pkg;
mod testing;
mod sqlite;
mod db;
mod phone;
mod collab;
mod runtimes;
mod ssh;
mod services;
mod webserver;
mod search;
mod terminal;
mod transfer;
mod update;
mod workspace;

fn main() {
    // Переносной режим: данные WebView2 (история, статистика) — тоже рядом с программой
    if let Some(data) = config::portable_dir() {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", data.join("webview"));
    }
    // Языки, поставленные через Tulpar, — в PATH для терминала, агента и LSP
    runtimes::apply_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WorkspaceState::default())
        .manage(phone::PhoneState::default())
        .manage(collab::CollabState::default())
        .manage(services::ServicesState::default())
        .manage(webserver::WebServerState::default())
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
            http::http_request,
            workspace::project_create,
            workspace::user_file_write,
            workspace::user_file_read,
            workspace::user_file_save_binary,
            pkg::pkg_search,
            testing::tests_run,
            sqlite::sqlite_tables,
            phone::phone_start,
            collab::collab_start,
            config::is_portable,
            runtimes::runtimes_list,
            runtimes::runtime_install,
            runtimes::runtime_remove,
            ssh::ssh_exec,
            ssh::ssh_cache_dir,
            ssh::ssh_deploy,
            services::service_start,
            services::service_stop,
            services::service_status,
            services::service_logs,
            services::service_run_once,
            services::service_write_config,
            services::service_path,
            webserver::webserver_start,
            webserver::webserver_stop,
            webserver::webserver_status,
            collab::collab_stop,
            collab::collab_broadcast,
            phone::phone_stop,
            phone::phone_set_state,
            db::db_query,
            db::db_tables,
            db::mongo_collections,
            db::mongo_find,
            sqlite::sqlite_query,
            testing::tests_junit_reports,
            ext::ext_search,
            ext::ext_install,
            ext::ext_list,
            ext::ext_read,
            ext::ext_uninstall,
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
                app.state::<services::ServicesState>().kill_all();
            }
        });
}
