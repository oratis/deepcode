// DeepCode Tauri main process.
// Spec: docs/DEVELOPMENT_PLAN.md §4 — Mac client
//
// Architecture: most of DeepCode's logic lives in @deepcode/core (TypeScript).
// The Tauri backend's job is to host the webview and expose a few native
// commands that the frontend can't do (file dialogs, credential save/status,
// settings/session index IO, and read-only file previews). Rust supervises the
// bundled app-server sidecar; runtime/tool execution never runs in the webview.

mod app_server;
mod commands;
mod credentials;
mod settings;
#[allow(dead_code)] // mutation-only snapshot helpers remain for compatibility tests
mod snapshots;
#[allow(dead_code)] // legacy native mutation helpers are no longer renderer commands
mod tools;
mod voice;

use app_server::{
    app_server_send, app_server_start, app_server_status, app_server_stop, AppServerState,
};
use commands::{
    append_allow_matcher, cli_path, get_app_info, get_settings_path, list_plugins, list_sessions,
    credential_status, list_skills, load_keybindings, load_settings_file, open_url,
    save_credentials, save_keybindings, save_settings_file, session_archive, session_delete,
    session_read, session_set_title,
};
use snapshots::session_snapshots;
use tauri::Manager;
use tools::tool_read;
use voice::{voice_cancel, voice_start, voice_status, voice_stop, VoiceState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(VoiceState::default())
        .manage(AppServerState::default())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            app_server_start,
            app_server_send,
            app_server_stop,
            app_server_status,
            credential_status,
            save_credentials,
            load_settings_file,
            save_settings_file,
            get_settings_path,
            append_allow_matcher,
            load_keybindings,
            save_keybindings,
            session_read,
            session_set_title,
            session_delete,
            session_archive,
            list_sessions,
            list_plugins,
            list_skills,
            cli_path,
            open_url,
            tool_read,
            session_snapshots,
            voice_status,
            voice_start,
            voice_stop,
            voice_cancel,
        ])
        .setup(|app| {
            // macOS: hide window menu items we don't use.
            #[cfg(target_os = "macos")]
            {
                let _ = app.get_webview_window("main");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DeepCode");
}
