// Tool IO primitives exposed to the renderer.
// The renderer runs @deepcode/core's `runAgent` directly; its tools call
// these Tauri commands for actual fs / subprocess work (the webview can't
// do node:fs / node:child_process itself).

use crate::snapshots;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

// ──────────────────────────────────────────────────────────────────────────
// Snapshot capture
// ──────────────────────────────────────────────────────────────────────────
// Edit/Write record a pre- and post-mutation snapshot so the desktop file
// panel's Diff/History tabs (and `/rewind`) have data — mirroring core's
// agent.ts, which never runs for desktop sessions (no SessionManager in the
// renderer). Best-effort: capture failures are logged and ignored so a
// snapshot hiccup never fails the user's edit.

/// Capture the pre + post pair for one file mutation under the user's home dir.
fn capture_pair(session_id: &str, file_path: &str, pre: &[u8], post: &[u8], tool: &str) {
    let Some(home) = dirs::home_dir() else {
        return;
    };
    capture_pair_in(&home, session_id, file_path, pre, post, tool);
}

/// home-parameterized body of `capture_pair` (testable without the real home).
/// `pre`/`post` are the file bytes before/after the change. The post snapshot is
/// stamped 1ms after the pre so the two never collide on a millisecond timeline
/// (the renderer keys history entries by timestamp).
fn capture_pair_in(
    home: &Path,
    session_id: &str,
    file_path: &str,
    pre: &[u8],
    post: &[u8],
    tool: &str,
) {
    let dir = snapshots::snapshots_dir(home, session_id);
    let base = snapshots::next_seq(&dir);
    let t = snapshots::now_ms();
    if let Err(e) = snapshots::capture_file_snapshot(
        home,
        session_id,
        file_path,
        pre,
        &format!("pre-{tool}"),
        base,
        t,
    ) {
        eprintln!("snapshot pre-{tool} {file_path}: {e}");
    }
    if let Err(e) = snapshots::capture_file_snapshot(
        home,
        session_id,
        file_path,
        post,
        &format!("post-{tool}"),
        base + 1,
        t + 1,
    ) {
        eprintln!("snapshot post-{tool} {file_path}: {e}");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Read
// ──────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadOk {
    pub content: String,
    pub lines_total: usize,
    pub lines_shown: usize,
    pub offset: usize,
}

#[tauri::command]
pub async fn tool_read(
    file_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<ReadOk, String> {
    let raw = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("read {}: {}", file_path, e))?;
    let lines: Vec<&str> = raw.split('\n').collect();
    let offset = offset.unwrap_or(1).max(1);
    let limit = limit.unwrap_or(2000).max(1);
    let start = offset - 1;
    let end = (start + limit).min(lines.len());
    let slice = &lines[start..end];

    let numbered: Vec<String> = slice
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let n = offset + i;
            let truncated = if line.len() > 2000 {
                format!("{}... [truncated]", &line[..2000])
            } else {
                line.to_string()
            };
            format!("{:>6}\t{}", n, truncated)
        })
        .collect();
    let mut content = numbered.join("\n");
    let shown = slice.len();
    let total = lines.len();
    if shown < total.saturating_sub(start) {
        content.push_str(&format!(
            "\n\n[Showing lines {}-{} of {}. Use offset/limit to see more.]",
            offset,
            offset + shown - 1,
            total
        ));
    }
    Ok(ReadOk {
        content,
        lines_total: total,
        lines_shown: shown,
        offset,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Write
// ──────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn tool_write(
    file_path: String,
    content: String,
    session_id: Option<String>,
) -> Result<(), String> {
    // Pre-state: the existing file bytes (empty when the file is new) — read
    // before the overwrite so the post-Write diff has a baseline.
    let pre = tokio::fs::read(&file_path).await.unwrap_or_default();
    if let Some(parent) = Path::new(&file_path).parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
        }
    }
    tokio::fs::write(&file_path, &content)
        .await
        .map_err(|e| format!("write {}: {}", file_path, e))?;
    if let Some(sid) = session_id.as_deref() {
        capture_pair(sid, &file_path, &pre, content.as_bytes(), "Write");
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// Edit
// ──────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct EditInput {
    pub file_path: String,
    pub old_string: String,
    pub new_string: String,
    pub replace_all: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditOk {
    pub replaced: usize,
    pub diff_preview: String,
}

#[tauri::command]
pub async fn tool_edit(input: EditInput, session_id: Option<String>) -> Result<EditOk, String> {
    let raw = tokio::fs::read_to_string(&input.file_path)
        .await
        .map_err(|e| format!("read {}: {}", input.file_path, e))?;
    let replace_all = input.replace_all.unwrap_or(false);
    let (new_content, count) = if replace_all {
        let count = raw.matches(&input.old_string).count();
        (raw.replace(&input.old_string, &input.new_string), count)
    } else {
        // Uniqueness check (matching the CLI's Edit tool behavior)
        let count = raw.matches(&input.old_string).count();
        if count == 0 {
            return Err("old_string not found in file".into());
        }
        if count > 1 {
            return Err(format!(
                "old_string is not unique (found {count} occurrences). Use replace_all=true or provide more context."
            ));
        }
        (raw.replacen(&input.old_string, &input.new_string, 1), 1)
    };
    tokio::fs::write(&input.file_path, &new_content)
        .await
        .map_err(|e| format!("write {}: {}", input.file_path, e))?;
    if let Some(sid) = session_id.as_deref() {
        capture_pair(
            sid,
            &input.file_path,
            raw.as_bytes(),
            new_content.as_bytes(),
            "Edit",
        );
    }
    let diff_preview = format!(
        "- {}\n+ {}",
        input.old_string.lines().next().unwrap_or(""),
        input.new_string.lines().next().unwrap_or("")
    );
    Ok(EditOk {
        replaced: count,
        diff_preview,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Bash
// ──────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BashInput {
    pub command: String,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BashOk {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

#[tauri::command]
pub async fn tool_bash(input: BashInput) -> Result<BashOk, String> {
    let timeout = std::time::Duration::from_millis(input.timeout_ms.unwrap_or(120_000));
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg(&input.command);
    if let Some(cwd) = input.cwd.as_ref() {
        cmd.current_dir(cwd);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    let mut stdout_pipe = child.stdout.take().ok_or("no stdout pipe")?;
    let mut stderr_pipe = child.stderr.take().ok_or("no stderr pipe")?;

    // Read both streams concurrently
    let stdout_task = tokio::spawn(async move {
        let mut s = String::new();
        let _ = stdout_pipe.read_to_string(&mut s).await;
        s
    });
    let stderr_task = tokio::spawn(async move {
        let mut s = String::new();
        let _ = stderr_pipe.read_to_string(&mut s).await;
        s
    });

    let mut timed_out = false;
    let exit_status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(s) => s.map_err(|e| format!("wait: {e}"))?,
        Err(_) => {
            timed_out = true;
            let _ = child.start_kill();
            let _ = child.wait().await;
            return Ok(BashOk {
                stdout: String::new(),
                stderr: format!("timeout after {}ms", timeout.as_millis()),
                exit_code: 124,
                timed_out,
            });
        }
    };
    let stdout = stdout_task.await.unwrap_or_default();
    let stderr = stderr_task.await.unwrap_or_default();
    Ok(BashOk {
        stdout,
        stderr,
        exit_code: exit_status.code().unwrap_or(-1),
        timed_out,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Glob (filesystem pattern match)
// ──────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct GlobOk {
    pub files: Vec<String>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn tool_glob(pattern: String, cwd: Option<String>) -> Result<GlobOk, String> {
    // Walk + filter using the `walkdir` style approach via shell `find -path`.
    // We don't depend on the `globwalk` crate to keep deps slim; shell out instead.
    let cwd_path = cwd.unwrap_or_else(|| ".".into());
    // For safety, only run if pattern doesn't contain a quote injection
    if pattern.contains('\'') || pattern.contains('`') {
        return Err("unsafe pattern (contains quote)".into());
    }
    let script = format!(
        "find {} -type f -path '{}/{}' 2>/dev/null | head -1000",
        shell_escape(&cwd_path),
        shell_escape(&cwd_path),
        pattern
    );
    let output = Command::new("/bin/sh")
        .arg("-c")
        .arg(&script)
        .output()
        .await
        .map_err(|e| format!("spawn find: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let files: Vec<String> = stdout.lines().map(|s| s.to_string()).collect();
    let truncated = files.len() >= 1000;
    Ok(GlobOk { files, truncated })
}

fn shell_escape(s: &str) -> String {
    // Minimal escape — wrap in single quotes, escape any existing single quotes
    format!("'{}'", s.replace('\'', "'\\''"))
}

// ──────────────────────────────────────────────────────────────────────────
// Grep (ripgrep-like; uses /usr/bin/grep)
// ──────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GrepInput {
    pub pattern: String,
    pub path: Option<String>,
    pub include: Option<String>,
    pub case_insensitive: Option<bool>,
}

#[derive(Serialize)]
pub struct GrepOk {
    pub matches: Vec<GrepMatch>,
    pub truncated: bool,
}

#[derive(Serialize)]
pub struct GrepMatch {
    pub file: String,
    pub line: usize,
    pub text: String,
}

#[tauri::command]
pub async fn tool_grep(input: GrepInput) -> Result<GrepOk, String> {
    let path = input.path.unwrap_or_else(|| ".".into());
    let mut cmd = Command::new("/usr/bin/grep");
    cmd.arg("-rn");
    if input.case_insensitive.unwrap_or(false) {
        cmd.arg("-i");
    }
    if let Some(include) = input.include.as_ref() {
        cmd.arg(format!("--include={include}"));
    }
    cmd.arg("--").arg(&input.pattern).arg(&path);
    let output = cmd.output().await.map_err(|e| format!("spawn grep: {e}"))?;
    // grep returns 1 if no matches — that's not an error for us
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(format!(
            "grep failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut matches = Vec::new();
    for line in stdout.lines().take(500) {
        // format: <file>:<lineno>:<text>
        let mut parts = line.splitn(3, ':');
        let file = parts.next().unwrap_or("").to_string();
        let lineno: usize = parts.next().unwrap_or("0").parse().unwrap_or(0);
        let text = parts.next().unwrap_or("").to_string();
        matches.push(GrepMatch {
            file,
            line: lineno,
            text,
        });
    }
    let truncated = matches.len() == 500;
    Ok(GrepOk { matches, truncated })
}

// ── Serde casing contract ──────────────────────────────────────────────
// Regression guard for HANDOFF §8a: Tauri's serde does NOT auto-convert case
// between Rust and JS. Every multi-word *output* field must serialize as
// camelCase, because the renderer reads e.g. `r.exitCode` / `r.linesTotal`.
// This bug shipped twice (Read line counts, Bash exit-code "error" badge); these
// tests fail loudly if a `#[serde(rename_all = "camelCase")]` is ever dropped.
#[cfg(test)]
mod casing_tests {
    use super::*;

    fn keys(v: &serde_json::Value) -> Vec<String> {
        v.as_object().unwrap().keys().cloned().collect()
    }

    #[test]
    fn read_ok_serializes_camel_case() {
        let v = serde_json::to_value(ReadOk {
            content: String::new(),
            lines_total: 10,
            lines_shown: 5,
            offset: 0,
        })
        .unwrap();
        let k = keys(&v);
        assert!(k.contains(&"linesTotal".to_string()), "got {k:?}");
        assert!(k.contains(&"linesShown".to_string()), "got {k:?}");
        assert!(
            !k.contains(&"lines_total".to_string()),
            "snake_case leaked: {k:?}"
        );
    }

    #[test]
    fn edit_ok_serializes_camel_case() {
        let v = serde_json::to_value(EditOk {
            replaced: 1,
            diff_preview: String::new(),
        })
        .unwrap();
        let k = keys(&v);
        assert!(k.contains(&"diffPreview".to_string()), "got {k:?}");
        assert!(
            !k.contains(&"diff_preview".to_string()),
            "snake_case leaked: {k:?}"
        );
    }

    #[test]
    fn bash_ok_serializes_camel_case() {
        let v = serde_json::to_value(BashOk {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
            timed_out: false,
        })
        .unwrap();
        let k = keys(&v);
        // The exit-code badge bug: renderer compares r.exitCode !== 0.
        assert!(k.contains(&"exitCode".to_string()), "got {k:?}");
        assert!(k.contains(&"timedOut".to_string()), "got {k:?}");
        assert!(
            !k.contains(&"exit_code".to_string()),
            "snake_case leaked: {k:?}"
        );
    }
}

// ── snapshot capture path ───────────────────────────────────────────────
// End-to-end coverage of the Edit/Write → manifest path (against a real temp
// fs) via the home-injectable `capture_pair_in`.
#[cfg(test)]
mod snapshot_capture_tests {
    use super::*;

    #[test]
    fn capture_pair_writes_pre_then_post_with_distinct_ms() {
        let home = std::env::temp_dir().join(format!("dc-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let sid = "2026-06-04-cap01";
        let file = "/tmp/example/app.ts";

        capture_pair_in(&home, sid, file, b"old\n", b"new\n", "Edit");

        let dir = snapshots::snapshots_dir(&home, sid);
        let rows = snapshots::list_file_snapshots(&dir, file).unwrap();
        let _ = std::fs::remove_dir_all(&home);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].reason, "pre-Edit");
        assert_eq!(rows[0].content, "old\n");
        assert_eq!(rows[0].seq, 0);
        assert_eq!(rows[1].reason, "post-Edit");
        assert_eq!(rows[1].content, "new\n");
        assert_eq!(rows[1].seq, 1);
        // Distinct timestamps so the renderer's history keys never collide.
        assert_eq!(rows[1].captured_at_ms, rows[0].captured_at_ms + 1);
    }

    #[test]
    fn capture_pair_appends_across_calls_with_monotonic_seq() {
        let home = std::env::temp_dir().join(format!("dc-cap2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let sid = "2026-06-04-cap02";
        let file = "/tmp/x.ts";

        capture_pair_in(&home, sid, file, b"a", b"b", "Write");
        capture_pair_in(&home, sid, file, b"b", b"c", "Edit");

        let dir = snapshots::snapshots_dir(&home, sid);
        let rows = snapshots::list_file_snapshots(&dir, file).unwrap();
        let _ = std::fs::remove_dir_all(&home);

        assert_eq!(
            rows.iter().map(|r| r.seq).collect::<Vec<_>>(),
            vec![0, 1, 2, 3]
        );
        assert_eq!(rows[0].reason, "pre-Write");
        assert_eq!(rows[3].reason, "post-Edit");
        assert_eq!(rows[3].content, "c");
    }
}
