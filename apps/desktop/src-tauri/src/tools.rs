// Tool IO primitives exposed to the renderer.
// The renderer runs @deepcode/core's `runAgent` directly; its tools call
// these Tauri commands for actual fs / subprocess work (the webview can't
// do node:fs / node:child_process itself).

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

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
pub async fn tool_write(file_path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&file_path).parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
        }
    }
    tokio::fs::write(&file_path, content)
        .await
        .map_err(|e| format!("write {}: {}", file_path, e))
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
pub async fn tool_edit(input: EditInput) -> Result<EditOk, String> {
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

