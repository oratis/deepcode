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

/// Read a session's JSONL and return its message lines (skipping the
/// `session_meta` header and any unparseable lines). Each returned value is the
/// stored message object as written by session_append: `{ type, role, content,
/// timestamp }`. Returns an empty vec if the file doesn't exist.
#[tauri::command]
pub fn session_read(id: String) -> Result<Vec<serde_json::Value>, String> {
    let Some(home) = dirs::home_dir() else {
        return Err("no home directory".into());
    };
    let path = home
        .join(".deepcode")
        .join("sessions")
        .join(format!("{}.jsonl", id));
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("read {}: {}", path.display(), e)),
    };
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue; // tolerate a partial trailing line
        };
        // Desktop sessions tag messages with type:"message"; CLI/headless sessions
        // write bare {role, content} lines with no type. Accept both, skip meta.
        let t = v.get("type").and_then(|t| t.as_str());
        let is_role_msg = matches!(
            v.get("role").and_then(|r| r.as_str()),
            Some("user") | Some("assistant")
        );
        if t == Some("message") || (t.is_none() && is_role_msg) {
            out.push(v);
        }
    }
    Ok(out)
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
    /// Human-readable title derived from the first user message (falls back to
    /// the id when the session has no user message yet). Single word → no
    /// rename_all needed; the renderer reads `title`.
    pub title: String,
}

/// A session's display title. Prefers a manual title set on the `session_meta`
/// header line (via session_set_title); otherwise derives one from the first
/// user message (first non-empty line, truncated). Returns None if neither.
fn derive_session_title(path: &std::path::Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut from_user: Option<String> = None;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let line_type = v.get("type").and_then(|t| t.as_str());
        // Manual title on the session_meta header wins — return immediately.
        if line_type == Some("session_meta") {
            if let Some(t) = v.get("title").and_then(|t| t.as_str()) {
                let t = t.trim();
                if !t.is_empty() {
                    return Some(clean_title(t));
                }
            }
            continue;
        }
        // First user message → title. Desktop tags type:"message"; CLI/headless
        // sessions write bare {role,content} with no type — accept both.
        let is_msg = line_type == Some("message") || line_type.is_none();
        if is_msg
            && v.get("role").and_then(|r| r.as_str()) == Some("user")
            && from_user.is_none()
        {
            if let Some(content) = v.get("content").and_then(|c| c.as_array()) {
                for block in content {
                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(txt) = block.get("text").and_then(|t| t.as_str()) {
                            let title = clean_title(txt);
                            if !title.is_empty() {
                                from_user = Some(title);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    from_user
}

/// Set (or clear, with "") a session's manual title on its session_meta header.
#[tauri::command]
pub fn session_set_title(id: String, title: String) -> Result<(), String> {
    let Some(home) = dirs::home_dir() else {
        return Err("no home directory".into());
    };
    let path = home
        .join(".deepcode")
        .join("sessions")
        .join(format!("{id}.jsonl"));
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read {}: {}", path.display(), e))?;
    let trimmed = title.trim();
    let mut lines: Vec<String> = text.lines().map(|l| l.to_string()).collect();
    let mut updated = false;
    for line in lines.iter_mut() {
        let Ok(mut v) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) == Some("session_meta") {
            v["title"] = serde_json::Value::String(trimmed.to_string());
            *line = v.to_string();
            updated = true;
            break;
        }
    }
    if !updated {
        // No meta header (older session) — prepend one carrying the title.
        let meta = serde_json::json!({ "type": "session_meta", "id": id, "title": trimmed });
        lines.insert(0, meta.to_string());
    }
    std::fs::write(&path, lines.join("\n") + "\n")
        .map_err(|e| format!("write {}: {}", path.display(), e))
}

/// Strip a leading <system-reminder>…</system-reminder> block (CLI-created
/// sessions prepend one), take the first non-empty line, truncate to 48 chars
/// (char-safe for CJK).
fn clean_title(raw: &str) -> String {
    let mut s = raw.trim_start();
    if s.starts_with("<system-reminder>") {
        if let Some(end) = s.find("</system-reminder>") {
            s = s[end + "</system-reminder>".len()..].trim_start();
        }
    }
    let first_line = s.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    const MAX: usize = 48;
    let chars: Vec<char> = first_line.chars().collect();
    if chars.len() > MAX {
        let head: String = chars[..MAX].iter().collect();
        format!("{head}…")
    } else {
        first_line.to_string()
    }
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
        let title = derive_session_title(&path).unwrap_or_else(|| id.clone());
        out.push(SessionMeta {
            id,
            path: path.clone(),
            size_bytes: meta.len(),
            updated_at_secs,
            title,
        });
    }
    out.sort_by(|a, b| b.updated_at_secs.cmp(&a.updated_at_secs));
    Ok(out)
}

/// Reject session ids that could escape the sessions directory.
fn safe_session_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(format!("invalid session id: {id}"));
    }
    Ok(())
}

/// Permanently delete a session's JSONL file.
#[tauri::command]
pub fn session_delete(id: String) -> Result<(), String> {
    safe_session_id(&id)?;
    let Some(home) = dirs::home_dir() else {
        return Err("no home directory".into());
    };
    let path = home
        .join(".deepcode")
        .join("sessions")
        .join(format!("{id}.jsonl"));
    std::fs::remove_file(&path).map_err(|e| format!("delete {}: {}", path.display(), e))
}

/// Archive a session by moving its JSONL into sessions/archived/ — excluded from
/// list_sessions but recoverable from disk.
#[tauri::command]
pub fn session_archive(id: String) -> Result<(), String> {
    safe_session_id(&id)?;
    let Some(home) = dirs::home_dir() else {
        return Err("no home directory".into());
    };
    let dir = home.join(".deepcode").join("sessions");
    let archived = dir.join("archived");
    std::fs::create_dir_all(&archived)
        .map_err(|e| format!("mkdir {}: {}", archived.display(), e))?;
    let from = dir.join(format!("{id}.jsonl"));
    let to = archived.join(format!("{id}.jsonl"));
    std::fs::rename(&from, &to).map_err(|e| format!("archive {}: {}", from.display(), e))
}

/// Path to the `deepcode` CLI so the GUI can drop users into it for advanced
/// workflows. Resolves a globally-installed `deepcode` on PATH (npm i -g
/// deepcode-cli). Bundling the CLI inside the .app is separate future work.
#[tauri::command]
pub fn cli_path() -> Option<PathBuf> {
    find_on_path("deepcode")
}

fn find_on_path(exe: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(exe);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

// ── Skills listing ─────────────────────────────────────────────────────
// The Skills screen lists built-in (bundled .app resource) + user + project
// skills. Built-in skills resolve via the Tauri resource dir; user/project from
// fixed ~/.deepcode/skills + <cwd>/.deepcode/skills. Each skill is a directory
// with a SKILL.md (`---` frontmatter + body). Mirrors core's skills/loader.ts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub source: String,
    pub path: String,
    pub body: String,
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches(|c| c == '"' || c == '\'').to_string()
}

/// Extract `name` + `description` from a SKILL.md `---`-fenced frontmatter block.
pub fn parse_skill_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let trimmed = content.trim_start();
    let Some(rest) = trimmed.strip_prefix("---") else {
        return (None, None);
    };
    let Some(end) = rest.find("\n---") else {
        return (None, None);
    };
    let mut name = None;
    let mut description = None;
    for line in rest[..end].lines() {
        if let Some(v) = line.strip_prefix("name:") {
            name = Some(unquote(v));
        } else if let Some(v) = line.strip_prefix("description:") {
            description = Some(unquote(v));
        }
    }
    (name, description)
}

fn collect_skills_from(dir: &std::path::Path, source: &str, out: &mut Vec<SkillInfo>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let skill_md = p.join("SKILL.md");
        let Ok(content) = std::fs::read_to_string(&skill_md) else {
            continue;
        };
        let (name, description) = parse_skill_frontmatter(&content);
        out.push(SkillInfo {
            name: name.unwrap_or_else(|| entry.file_name().to_string_lossy().to_string()),
            description: description.unwrap_or_default(),
            source: source.to_string(),
            path: skill_md.to_string_lossy().to_string(),
            body: content,
        });
    }
}

/// Collect skills from the built-in (optional), user, and project (optional)
/// directories. Pure (takes dirs) so it's unit-testable.
pub fn collect_skills(
    builtin: Option<&std::path::Path>,
    user: &std::path::Path,
    project: Option<&std::path::Path>,
) -> Vec<SkillInfo> {
    let mut out: Vec<SkillInfo> = Vec::new();
    if let Some(b) = builtin {
        collect_skills_from(b, "builtin", &mut out);
    }
    collect_skills_from(user, "user", &mut out);
    if let Some(pr) = project {
        collect_skills_from(pr, "project", &mut out);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
pub fn list_skills(app: tauri::AppHandle, cwd: Option<String>) -> Vec<SkillInfo> {
    use tauri::Manager;
    let builtin = app.path().resource_dir().ok().map(|r| r.join("skills"));
    let user = dirs::home_dir()
        .map(|h| h.join(".deepcode").join("skills"))
        .unwrap_or_default();
    let project = cwd.map(|c| std::path::PathBuf::from(c).join(".deepcode").join("skills"));
    collect_skills(builtin.as_deref(), &user, project.as_deref())
}

/// Open a URL in the user's default browser via the plugin-opener bridge.
/// (Wrapped here so the renderer has a single typed surface.)
#[tauri::command]
pub fn open_url(_url: String) -> Result<(), String> {
    // The actual opening is done through @tauri-apps/plugin-opener from the
    // renderer; this is a stub kept for future server-side validation.
    Ok(())
}

// ── Plugins listing ────────────────────────────────────────────────────
// The renderer can't run @deepcode/core's discoverPlugins (it needs node:fs),
// so the Plugins screen reads ~/.deepcode/plugins/*/plugin.json here. Mirrors
// the CLI `plugins list`: a plugin is only `enabled` (loaded by the agent) when
// it's in the trust manifest AND not in settings.disabledPlugins.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
    pub enabled: bool,
    /// Hook event names the plugin contributes (manifest.contributes.hooks keys).
    pub contributed_hook_events: Vec<String>,
    /// Recorded source hash from the trust manifest ('' if untrusted).
    pub source_hash: String,
    /// 'user' | 'marketplace' | 'official' — always valid so the UI badge map
    /// resolves; defaults to 'user' for an untrusted plugin.
    pub trusted_by: String,
    /// Set when the plugin is installed but won't load (e.g. untrusted).
    pub warning: Option<String>,
}

fn read_json(path: &std::path::Path) -> serde_json::Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null)
}

fn string_set(v: &serde_json::Value) -> std::collections::HashSet<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Collect installed plugins under `<home>/.deepcode/plugins`. Pure (takes home)
/// so it's unit-testable; `list_plugins` wraps it with the real home dir.
pub fn collect_plugins(home: &std::path::Path) -> Vec<PluginInfo> {
    let dc = home.join(".deepcode");
    let trusted = read_json(&dc.join("plugins-trust.json"));
    let trusted_names: std::collections::HashSet<String> = trusted
        .get("plugins")
        .and_then(|p| p.as_object())
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    let disabled = string_set(read_json(&dc.join("settings.json")).get("disabledPlugins").unwrap_or(&serde_json::Value::Null));

    let mut out: Vec<PluginInfo> = Vec::new();
    let Ok(entries) = std::fs::read_dir(dc.join("plugins")) else {
        return out;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        if dir_name.starts_with('.') {
            continue;
        }
        let manifest = read_json(&dir.join("plugin.json"));
        let name = manifest.get("name").and_then(|v| v.as_str());
        let version = manifest.get("version").and_then(|v| v.as_str());
        // Mirror readManifest: require name + version.
        let (Some(name), Some(version)) = (name, version) else {
            continue;
        };
        let trust_entry = trusted.get("plugins").and_then(|p| p.get(name));
        let is_trusted = trusted_names.contains(name);
        let hook_events = manifest
            .get("contributes")
            .and_then(|c| c.get("hooks"))
            .and_then(|h| h.as_object())
            .map(|o| o.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        out.push(PluginInfo {
            name: name.to_string(),
            version: version.to_string(),
            enabled: is_trusted && !disabled.contains(name),
            contributed_hook_events: hook_events,
            source_hash: trust_entry
                .and_then(|e| e.get("sourceHash"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            trusted_by: trust_entry
                .and_then(|e| e.get("trustedBy"))
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .to_string(),
            warning: if is_trusted {
                None
            } else {
                Some("Installed but not trusted — load it once via the CLI to trust it.".into())
            },
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
pub fn list_plugins() -> Vec<PluginInfo> {
    match dirs::home_dir() {
        Some(home) => collect_plugins(&home),
        None => Vec::new(),
    }
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
    fn plugin_info_serializes_camel_case() {
        // PluginInfo IS a tool-style output struct → camelCase (unlike AppInfo).
        let v = serde_json::to_value(PluginInfo {
            name: "p".into(),
            version: "1.0.0".into(),
            enabled: false,
            contributed_hook_events: vec!["PreToolUse".into()],
            source_hash: "abc".into(),
            trusted_by: "user".into(),
            warning: None,
        })
        .unwrap();
        let k = keys(&v);
        assert!(k.contains(&"contributedHookEvents".to_string()), "got {k:?}");
        assert!(k.contains(&"sourceHash".to_string()), "got {k:?}");
        assert!(k.contains(&"trustedBy".to_string()), "got {k:?}");
        assert!(!k.contains(&"source_hash".to_string()), "snake leaked: {k:?}");
    }

    #[test]
    fn collect_plugins_reads_manifests_and_trust() {
        let dir = std::env::temp_dir().join(format!("dc-plug-{}", std::process::id()));
        let plugins = dir.join(".deepcode").join("plugins");
        std::fs::create_dir_all(plugins.join("alpha")).unwrap();
        std::fs::create_dir_all(plugins.join("beta")).unwrap();
        std::fs::write(
            plugins.join("alpha").join("plugin.json"),
            r#"{"name":"alpha","version":"1.0.0","description":"A"}"#,
        )
        .unwrap();
        std::fs::write(
            plugins.join("beta").join("plugin.json"),
            r#"{"name":"beta","version":"2.0.0"}"#,
        )
        .unwrap();
        // Only alpha is trusted; beta is disabled-by-settings would be moot (untrusted).
        std::fs::write(
            dir.join(".deepcode").join("plugins-trust.json"),
            r#"{"plugins":{"alpha":{"sourceHash":"x"}}}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join(".deepcode").join("settings.json"),
            r#"{"disabledPlugins":[]}"#,
        )
        .unwrap();

        let rows = collect_plugins(&dir);
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(rows.len(), 2);
        // sorted by name → alpha, beta
        assert_eq!(rows[0].name, "alpha");
        assert!(rows[0].enabled, "alpha trusted → enabled");
        assert!(rows[0].warning.is_none(), "alpha trusted → no warning");
        assert_eq!(rows[1].name, "beta");
        assert!(!rows[1].enabled, "beta untrusted → not enabled");
        assert!(rows[1].warning.is_some(), "beta untrusted → warning");
    }

    #[test]
    fn collect_plugins_empty_without_dir() {
        let dir = std::env::temp_dir().join(format!("dc-plug-none-{}", std::process::id()));
        assert!(collect_plugins(&dir).is_empty());
    }

    #[test]
    fn parse_skill_frontmatter_extracts_name_and_description() {
        let md = "---\nname: greet\ndescription: \"Say hello\"\n---\nBody here\n";
        let (name, desc) = parse_skill_frontmatter(md);
        assert_eq!(name.as_deref(), Some("greet"));
        assert_eq!(desc.as_deref(), Some("Say hello"));
    }

    #[test]
    fn parse_skill_frontmatter_none_without_fence() {
        let (name, desc) = parse_skill_frontmatter("no frontmatter here");
        assert!(name.is_none() && desc.is_none());
    }

    #[test]
    fn skill_info_serializes_camel_case() {
        let v = serde_json::to_value(SkillInfo {
            name: "s".into(),
            description: "d".into(),
            source: "builtin".into(),
            path: "/x/SKILL.md".into(),
            body: "b".into(),
        })
        .unwrap();
        let k = keys(&v);
        assert!(k.contains(&"name".to_string()) && k.contains(&"source".to_string()), "got {k:?}");
    }

    #[test]
    fn collect_skills_reads_builtin_user_project_and_sorts() {
        let root = std::env::temp_dir().join(format!("dc-skills-{}", std::process::id()));
        let mk = |dir: &std::path::Path, name: &str, desc: &str| {
            let sd = dir.join(name);
            std::fs::create_dir_all(&sd).unwrap();
            std::fs::write(
                sd.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: {desc}\n---\nbody-{name}\n"),
            )
            .unwrap();
        };
        let builtin = root.join("builtin");
        let user = root.join("user");
        let project = root.join("project");
        mk(&builtin, "zeta", "builtin one");
        mk(&user, "alpha", "user one");
        mk(&project, "mid", "project one");

        let rows = collect_skills(Some(&builtin), &user, Some(&project));
        std::fs::remove_dir_all(&root).ok();

        // sorted by name → alpha(user), mid(project), zeta(builtin)
        assert_eq!(rows.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), vec!["alpha", "mid", "zeta"]);
        assert_eq!(rows[0].source, "user");
        assert_eq!(rows[2].source, "builtin");
        assert!(rows[2].body.contains("body-zeta"));
    }

    #[test]
    fn session_meta_serializes_snake_case() {
        let v = serde_json::to_value(SessionMeta {
            id: "s1".into(),
            path: std::path::PathBuf::from("/tmp/s1.jsonl"),
            size_bytes: 42,
            updated_at_secs: 1700,
            title: "s1".into(),
        })
        .unwrap();
        let k = keys(&v);
        assert!(k.contains(&"size_bytes".to_string()), "got {k:?}");
        assert!(k.contains(&"updated_at_secs".to_string()), "got {k:?}");
        assert!(k.contains(&"title".to_string()), "got {k:?}");
        assert!(!k.contains(&"sizeBytes".to_string()), "camelCase leaked: {k:?}");
    }

    #[test]
    fn clean_title_truncates_and_strips_reminder() {
        assert_eq!(clean_title("制作一个打飞机小游戏"), "制作一个打飞机小游戏");
        assert_eq!(clean_title("  first line\nsecond"), "first line");
        assert_eq!(
            clean_title("<system-reminder>ctx</system-reminder>\nreal prompt"),
            "real prompt"
        );
        // 60 ASCII chars → truncated to 48 + ellipsis
        let long = "a".repeat(60);
        let t = clean_title(&long);
        assert_eq!(t.chars().count(), 49); // 48 + '…'
        assert!(t.ends_with('…'));
    }

    #[test]
    fn derive_title_prefers_meta_then_first_user() {
        use std::io::Write;
        let dir = std::env::temp_dir();
        let pid = std::process::id();

        // A manual title on the meta header wins over the first user message.
        let p1 = dir.join(format!("dc-title-{pid}-a.jsonl"));
        let mut f = std::fs::File::create(&p1).unwrap();
        writeln!(f, r#"{{"type":"session_meta","id":"x","title":"My Custom Name"}}"#).unwrap();
        writeln!(
            f,
            r#"{{"type":"message","role":"user","content":[{{"type":"text","text":"the prompt"}}]}}"#
        )
        .unwrap();
        assert_eq!(derive_session_title(&p1).as_deref(), Some("My Custom Name"));

        // No meta title → derive from the first user message (CJK).
        let p2 = dir.join(format!("dc-title-{pid}-b.jsonl"));
        let mut f2 = std::fs::File::create(&p2).unwrap();
        writeln!(f2, r#"{{"type":"session_meta","id":"y"}}"#).unwrap();
        writeln!(
            f2,
            r#"{{"type":"message","role":"user","content":[{{"type":"text","text":"做一个游戏"}}]}}"#
        )
        .unwrap();
        assert_eq!(derive_session_title(&p2).as_deref(), Some("做一个游戏"));

        std::fs::remove_file(&p1).ok();
        std::fs::remove_file(&p2).ok();
    }
}
