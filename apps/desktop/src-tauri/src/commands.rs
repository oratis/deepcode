// Tauri command handlers — these are invoked from the renderer via
// `import { invoke } from '@tauri-apps/api/core'; await invoke('cmd_name', args)`.

use crate::credentials::{self, Credentials};
use crate::settings;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub home_dir: Option<PathBuf>,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        home_dir: dirs::home_dir(),
    }
}

#[tauri::command]
pub fn read_credentials() -> Result<Credentials, String> {
    credentials::read()
}

#[tauri::command]
pub fn save_credentials(creds: Credentials) -> Result<(), String> {
    credentials::write(&creds)
}

#[tauri::command]
pub fn load_settings_file() -> Result<serde_json::Value, String> {
    settings::read_user()
}

#[tauri::command]
pub fn save_settings_file(value: serde_json::Value) -> Result<(), String> {
    settings::write_user(&value)
}

#[tauri::command]
pub fn get_settings_path() -> Option<PathBuf> {
    settings::user_settings_path()
}

/// Read ~/.deepcode/keybindings.json — returns {} if absent.
#[tauri::command]
pub fn load_keybindings() -> Result<serde_json::Value, String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(serde_json::json!({}));
    };
    let path = home.join(".deepcode").join("keybindings.json");
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("read {}: {}", path.display(), e)),
    }
}

/// Write ~/.deepcode/keybindings.json (creates ~/.deepcode/ if needed).
#[tauri::command]
pub fn save_keybindings(value: serde_json::Value) -> Result<(), String> {
    let Some(home) = dirs::home_dir() else {
        return Err("no home directory".into());
    };
    let dir = home.join(".deepcode");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;
    let path = dir.join("keybindings.json");
    let raw = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| format!("write {}: {}", path.display(), e))
}

/// Append a matcher string to permissions.allow[] in ~/.deepcode/settings.json,
/// creating the file (and the permissions object) if needed. Idempotent.
///
/// Called from the renderer when the user clicks "Always allow" on an
/// inline permission prompt. We deliberately target USER-level settings
/// (not project-local) because the renderer doesn't have a stable cwd
/// concept — the user can later tighten the rule by editing the file.
#[tauri::command]
pub fn append_allow_matcher(matcher: String) -> Result<(), String> {
    let trimmed = matcher.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let mut value = settings::read_user()?;
    // Ensure `permissions.allow` is an array.
    if !value.is_object() {
        value = serde_json::json!({});
    }
    let obj = value.as_object_mut().unwrap();
    let perms = obj
        .entry("permissions".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !perms.is_object() {
        *perms = serde_json::json!({});
    }
    let perms_obj = perms.as_object_mut().unwrap();
    let allow = perms_obj
        .entry("allow".to_string())
        .or_insert_with(|| serde_json::json!([]));
    if !allow.is_array() {
        *allow = serde_json::json!([]);
    }
    let arr = allow.as_array_mut().unwrap();
    let exists = arr.iter().any(|v| v.as_str() == Some(trimmed));
    if !exists {
        arr.push(serde_json::Value::String(trimmed.to_string()));
    }
    settings::write_user(&value)
}

/// List session files under ~/.deepcode/sessions/. Returns just metadata.
#[derive(Serialize)]
pub struct SessionMeta {
    pub id: String,
    pub path: PathBuf,
    pub size_bytes: u64,
    pub updated_at_secs: u64,
}

#[tauri::command]
pub fn list_sessions() -> Result<Vec<SessionMeta>, String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(vec![]);
    };
    let dir = home.join(".deepcode").join("sessions");
    let read = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("read_dir {}: {}", dir.display(), e)),
    };
    let mut out = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !name.ends_with(".jsonl") {
            continue;
        }
        let id = name.trim_end_matches(".jsonl").to_string();
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let updated_at_secs = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(SessionMeta {
            id,
            path: path.clone(),
            size_bytes: meta.len(),
            updated_at_secs,
        });
    }
    out.sort_by(|a, b| b.updated_at_secs.cmp(&a.updated_at_secs));
    Ok(out)
}

/// Path to the bundled deepcode CLI (alongside the .app) so the GUI can
/// drop users into the CLI for advanced workflows.
#[tauri::command]
pub fn cli_path() -> Option<PathBuf> {
    // Bundled at `<App>/Contents/Resources/deepcode` (we copy it in the
    // electron-builder ... I mean tauri.conf.json bundle step in v1.1).
    None
}

/// Open a URL in the user's default browser via the plugin-opener bridge.
/// (Wrapped here so the renderer has a single typed surface.)
#[tauri::command]
pub fn open_url(_url: String) -> Result<(), String> {
    // The actual opening is done through @tauri-apps/plugin-opener from the
    // renderer; this is a stub kept for future server-side validation.
    Ok(())
}
