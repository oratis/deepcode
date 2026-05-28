// DeepCode Tauri main process.
// Spec: docs/DEVELOPMENT_PLAN.md §4 — Mac client
//
// Architecture: most of DeepCode's logic lives in @deepcode/core (TypeScript).
// The Tauri backend's job is to host the webview and expose a few native
// commands that the frontend can't do (file dialogs, credentials read/write,
// settings file IO, child-process spawn for CLI integration).
//
// The agent loop itself runs in the renderer via @deepcode/core — no Node
// runtime in main process means smaller binary + faster startup.

mod commands;
mod credentials;
mod settings;
mod tools;

use commands::{
    cli_path, get_app_info, get_settings_path, list_sessions, load_settings_file, open_url,
    read_credentials, save_credentials, save_settings_file,
};
use tools::{tool_bash, tool_edit, tool_glob, tool_grep, tool_read, tool_write};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            read_credentials,
            save_credentials,
            load_settings_file,
            save_settings_file,
            get_settings_path,
            list_sessions,
            cli_path,
            open_url,
            tool_read,
            tool_write,
            tool_edit,
            tool_bash,
            tool_glob,
            tool_grep,
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
