// Settings.json read/write — wraps the three-layer scheme.
// User settings: ~/.deepcode/settings.json. Project + local layers are
// merged in the renderer via @deepcode/core's loadSettings.

use std::path::PathBuf;

pub fn user_settings_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".deepcode").join("settings.json"))
}

pub fn read_user() -> Result<serde_json::Value, String> {
    let Some(path) = user_settings_path() else {
        return Ok(serde_json::json!({}));
    };
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("read {}: {}", path.display(), e)),
    }
}

pub fn write_user(value: &serde_json::Value) -> Result<(), String> {
    let Some(path) = user_settings_path() else {
        return Err("no home directory".into());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let raw = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| format!("write {}: {}", path.display(), e))
}
