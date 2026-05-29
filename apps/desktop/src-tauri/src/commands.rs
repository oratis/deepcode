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

/// Create a new session JSONL with a metadata header line. Returns the
/// generated session id. The id format matches what @deepcode/core's
/// SessionManager produces: `YYYY-MM-DD-<random>`.
#[tauri::command]
pub fn session_create(cwd: String) -> Result<String, String> {
    let Some(home) = dirs::home_dir() else {
        return Err("no home directory".into());
    };
    let now = std::time::SystemTime::now();
    let secs = now
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let date = format_date(secs);
    // Lightweight unique suffix from time-nanos — no extra crate dep
    let nanos = now
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .subsec_nanos();
    let rand_id = format!("{:08x}", nanos);
    let id = format!("{}-{}", date, rand_id);
    let dir = home.join(".deepcode").join("sessions");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;
    let path = dir.join(format!("{}.jsonl", id));
    let header = serde_json::json!({
        "type": "session_meta",
        "id": id,
        "cwd": cwd,
        "created_at": secs,
        "client": "desktop"
    });
    let line = format!("{}\n", header);
    std::fs::write(&path, line).map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(id)
}

/// Append a single JSON line to a session's JSONL file.
#[tauri::command]
pub fn session_append(id: String, message: serde_json::Value) -> Result<(), String> {
    let Some(home) = dirs::home_dir() else {
        return Err("no home directory".into());
    };
    let path = home
        .join(".deepcode")
        .join("sessions")
        .join(format!("{}.jsonl", id));
    let line = format!("{}\n", message);
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open {}: {}", path.display(), e))?;
    f.write_all(line.as_bytes())
        .map_err(|e| format!("write {}: {}", path.display(), e))
}

fn format_date(secs: u64) -> String {
    // Simple YYYY-MM-DD; days since epoch math is enough for filename use.
    let days = secs / 86_400;
    // Reference: 1970-01-01 was a Thursday; we compute YMD via the
    // standard "civil_from_days" algorithm by Howard Hinnant.
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y, m, d)
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

// ── Serde contract ─────────────────────────────────────────────────────
// AppInfo + SessionMeta are read by tauri-api.ts using snake_case keys
// (home_dir, size_bytes, updated_at_secs). They intentionally do NOT use
// rename_all="camelCase" (unlike the tool output structs in tools.rs). Lock
// that so a stray rename_all can't silently break the renderer. See HANDOFF §8a.
#[cfg(test)]
mod contract_tests {
    use super::*;

    fn keys(v: &serde_json::Value) -> Vec<String> {
        v.as_object().unwrap().keys().cloned().collect()
    }

    #[test]
    fn app_info_serializes_snake_case() {
        let v = serde_json::to_value(AppInfo {
            version: "1.0.0".into(),
            platform: "darwin".into(),
            home_dir: Some(std::path::PathBuf::from("/Users/x")),
        })
        .unwrap();
        let k = keys(&v);
        assert!(k.contains(&"home_dir".to_string()), "got {k:?}");
        assert!(!k.contains(&"homeDir".to_string()), "camelCase leaked: {k:?}");
    }

    #[test]
    fn session_meta_serializes_snake_case() {
        let v = serde_json::to_value(SessionMeta {
            id: "s1".into(),
            path: std::path::PathBuf::from("/tmp/s1.jsonl"),
            size_bytes: 42,
            updated_at_secs: 1700,
        })
        .unwrap();
        let k = keys(&v);
        assert!(k.contains(&"size_bytes".to_string()), "got {k:?}");
        assert!(k.contains(&"updated_at_secs".to_string()), "got {k:?}");
        assert!(!k.contains(&"sizeBytes".to_string()), "camelCase leaked: {k:?}");
    }
}
