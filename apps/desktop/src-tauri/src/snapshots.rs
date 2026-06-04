// File snapshots — captured before & after each Edit/Write so the right-side
// file panel's Diff/History tabs (and the CLI's `/rewind`) share one data source.
//
// The desktop runs @deepcode/core's `runAgent` IN THE RENDERER, which (by design)
// has no node:fs and so passes no SessionManager — meaning core's own snapshot
// capture (packages/core/src/agent.ts) never fires for desktop sessions. We
// therefore mirror it here on the Rust side: tool_write / tool_edit call
// `capture_file_snapshot` for the pre- and post-mutation states.
//
// On-disk layout MATCHES core (packages/core/src/sessions/{storage,snapshots}.ts)
// so the two interoperate:
//   ~/.deepcode/sessions/<id>/snapshots/
//     manifest.jsonl                       — one JSON Snapshot per line
//     <seq:05>-<YYYYMMDDtHHMMSS>-<hash>.blob — the captured file bytes
//
// Each manifest line is the core `Snapshot` shape: { filePath, capturedAt,
// reason, hash, size, seq, blobPath, kind } plus a `capturedAtMs` convenience
// field (core ignores unknown keys) so the renderer needn't parse ISO strings.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// `~/.deepcode/sessions/<id>/snapshots` — the per-session snapshot directory.
pub fn snapshots_dir(home: &Path, session_id: &str) -> PathBuf {
    home.join(".deepcode")
        .join("sessions")
        .join(session_id)
        .join("snapshots")
}

/// Next sequence number for a session = count of existing manifest lines.
/// Snapshots are append-only and the desktop captures them one tool-call at a
/// time, so a line count is a sufficient monotonic counter (mirrors core's
/// per-session `snapshotSeq`).
pub fn next_seq(dir: &Path) -> u64 {
    let manifest = dir.join("manifest.jsonl");
    match std::fs::read_to_string(&manifest) {
        Ok(t) => t.lines().filter(|l| !l.trim().is_empty()).count() as u64,
        Err(_) => 0,
    }
}

/// Milliseconds since the Unix epoch (0 if the clock is before 1970).
pub fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Capture one file snapshot: write the blob and append a manifest line.
/// Best-effort by contract — callers ignore the error so a snapshot hiccup never
/// fails the user's edit. `content` is the exact file bytes for this revision.
pub fn capture_file_snapshot(
    home: &Path,
    session_id: &str,
    file_path: &str,
    content: &[u8],
    reason: &str,
    seq: u64,
    captured_ms: u128,
) -> std::io::Result<()> {
    let dir = snapshots_dir(home, session_id);
    std::fs::create_dir_all(&dir)?;

    let mut hasher = Sha256::new();
    hasher.update(content);
    // core: sha256 hex truncated to 16 chars == the first 8 bytes.
    let hash16: String = hasher
        .finalize()
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect();

    let blob_name = format!("{:05}-{}-{}.blob", seq, fmt_blob_ts(captured_ms), hash16);
    let blob_path = dir.join(&blob_name);
    std::fs::write(&blob_path, content)?;

    let entry = serde_json::json!({
        "filePath": file_path,
        "capturedAt": fmt_iso(captured_ms),
        "capturedAtMs": captured_ms as u64,
        "reason": reason,
        "hash": hash16,
        "size": content.len(),
        "seq": seq,
        "blobPath": blob_path.to_string_lossy(),
        "kind": "file",
    });

    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("manifest.jsonl"))?;
    writeln!(f, "{entry}")
}

// ── session_snapshots command ───────────────────────────────────────────────

/// One snapshot returned to the renderer for a single file. `content` is the
/// full blob text; the panel computes its own diff (current vs baseline) from
/// these, so we hand back everything it needs in one call.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    pub seq: u64,
    pub captured_at_ms: u64,
    pub reason: String,
    pub hash: String,
    pub content: String,
}

/// List a file's snapshots for a session (seq-ascending). Reads the session
/// manifest, keeps file-kind rows whose `filePath` matches `file_path` (exact
/// string, or same canonicalized path), and loads each blob's text. Returns an
/// empty list (not an error) when the session has no snapshots yet.
#[tauri::command]
pub fn session_snapshots(
    session_id: String,
    file_path: String,
) -> Result<Vec<SnapshotEntry>, String> {
    if session_id.is_empty() || session_id.contains('/') || session_id.contains("..") {
        return Ok(vec![]);
    }
    let Some(home) = dirs::home_dir() else {
        return Ok(vec![]);
    };
    list_file_snapshots(&snapshots_dir(&home, &session_id), &file_path)
}

/// The dir-parameterized body of `session_snapshots` (testable without the real
/// home dir). Reads `<dir>/manifest.jsonl` and returns the matching file rows.
pub fn list_file_snapshots(dir: &Path, file_path: &str) -> Result<Vec<SnapshotEntry>, String> {
    let manifest = dir.join("manifest.jsonl");
    let text = match std::fs::read_to_string(&manifest) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("read {}: {}", manifest.display(), e)),
    };

    let requested_canon = std::fs::canonicalize(file_path).ok();
    let mut out: Vec<SnapshotEntry> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue; // tolerate a partial trailing line
        };
        // git-checkpoint rows are whole-tree, not per-file — skip them here.
        if v.get("kind").and_then(|k| k.as_str()) == Some("git") {
            continue;
        }
        let stored = v.get("filePath").and_then(|x| x.as_str()).unwrap_or("");
        if !paths_match(stored, file_path, requested_canon.as_deref()) {
            continue;
        }
        let blob = v.get("blobPath").and_then(|x| x.as_str()).unwrap_or("");
        let content = std::fs::read_to_string(blob).unwrap_or_default();
        out.push(SnapshotEntry {
            seq: v.get("seq").and_then(|x| x.as_u64()).unwrap_or(0),
            captured_at_ms: v.get("capturedAtMs").and_then(|x| x.as_u64()).unwrap_or(0),
            reason: v
                .get("reason")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            hash: v
                .get("hash")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            content,
        });
    }
    out.sort_by_key(|e| e.seq);
    Ok(out)
}

/// True when a stored snapshot path refers to the requested file: exact string
/// match, or both canonicalize to the same path (handles symlinks / `..`).
fn paths_match(stored: &str, requested: &str, requested_canon: Option<&Path>) -> bool {
    if stored == requested {
        return true;
    }
    if let Some(rc) = requested_canon {
        if let Ok(sc) = std::fs::canonicalize(stored) {
            return sc == rc;
        }
    }
    false
}

// ── time formatting (no chrono dep) ─────────────────────────────────────────

/// (year, month, day) from days-since-Unix-epoch. Howard Hinnant's
/// civil_from_days — same algorithm as commands.rs::format_date.
fn civil_from_days(days: i64) -> (i64, u64, u64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// ISO-8601 UTC with millis, e.g. "2026-06-04T12:30:45.123Z" (mirrors JS
/// `new Date(ms).toISOString()`).
fn fmt_iso(ms: u128) -> String {
    let total_secs = (ms / 1000) as i64;
    let millis = (ms % 1000) as u64;
    let days = total_secs.div_euclid(86_400);
    let tod = total_secs.rem_euclid(86_400) as u64;
    let (y, mo, d) = civil_from_days(days);
    let (h, mi, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{millis:03}Z")
}

/// Compact timestamp for blob filenames: core's
/// `toISOString().replace(/[-:.]/g,'').slice(0,15)` → "YYYYMMDDtHHMMSS".
fn fmt_blob_ts(ms: u128) -> String {
    fmt_iso(ms)
        .chars()
        .filter(|c| *c != '-' && *c != ':' && *c != '.')
        .take(15)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(v: &serde_json::Value) -> Vec<String> {
        v.as_object().unwrap().keys().cloned().collect()
    }

    #[test]
    fn fmt_iso_known_values() {
        assert_eq!(fmt_iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(fmt_iso(86_400_000), "1970-01-02T00:00:00.000Z");
        // 2023-11-14T22:13:20.123Z
        assert_eq!(fmt_iso(1_700_000_000_123), "2023-11-14T22:13:20.123Z");
    }

    #[test]
    fn fmt_blob_ts_is_15_chars_with_t_separator() {
        let ts = fmt_blob_ts(0);
        assert_eq!(ts, "19700101T000000");
        assert_eq!(ts.chars().count(), 15);
        assert_eq!(ts.as_bytes()[8], b'T');
    }

    #[test]
    fn snapshot_entry_serializes_camel_case() {
        let v = serde_json::to_value(SnapshotEntry {
            seq: 1,
            captured_at_ms: 42,
            reason: "pre-Edit".into(),
            hash: "abc".into(),
            content: "x".into(),
        })
        .unwrap();
        let k = keys(&v);
        assert!(k.contains(&"capturedAtMs".to_string()), "got {k:?}");
        assert!(
            !k.contains(&"captured_at_ms".to_string()),
            "snake leaked: {k:?}"
        );
    }

    #[test]
    fn capture_then_list_roundtrips_and_filters() {
        let home = std::env::temp_dir().join(format!("dc-snap-{}", std::process::id()));
        let sid = "2026-06-04-test01";
        let file = "/tmp/example/app.ts";
        let _ = std::fs::remove_dir_all(&home);

        // Two edits → 4 snapshots (pre/post each), distinct ms so ordering holds.
        let dir = snapshots_dir(&home, sid);
        std::fs::create_dir_all(&dir).unwrap();
        let base0 = next_seq(&dir);
        capture_file_snapshot(&home, sid, file, b"v0\n", "pre-Edit", base0, 1000).unwrap();
        capture_file_snapshot(&home, sid, file, b"v1\n", "post-Edit", base0 + 1, 1001).unwrap();
        let base1 = next_seq(&dir);
        assert_eq!(base1, 2, "seq advances with manifest lines");
        capture_file_snapshot(&home, sid, file, b"v1\n", "pre-Edit", base1, 2000).unwrap();
        capture_file_snapshot(&home, sid, file, b"v2\n", "post-Edit", base1 + 1, 2001).unwrap();

        // A snapshot for a DIFFERENT file must be filtered out.
        capture_file_snapshot(&home, sid, "/tmp/other.ts", b"z\n", "pre-Write", 99, 3000).unwrap();

        let rows = list_file_snapshots(&dir, file).unwrap();
        let _ = std::fs::remove_dir_all(&home);

        assert_eq!(rows.len(), 4, "only the 4 snapshots for `file`");
        assert_eq!(rows[0].seq, 0);
        assert_eq!(rows[0].content, "v0\n");
        assert_eq!(rows[0].reason, "pre-Edit");
        assert_eq!(rows[0].captured_at_ms, 1000);
        assert_eq!(rows[3].content, "v2\n");
        // ascending by seq
        assert!(rows.windows(2).all(|w| w[0].seq < w[1].seq));
    }

    #[test]
    fn list_missing_session_is_empty() {
        let dir = std::env::temp_dir().join("dc-snap-nope-xyz/snapshots");
        let rows = list_file_snapshots(&dir, "/tmp/x").unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn list_rejects_unsafe_session_id() {
        assert!(session_snapshots("../escape".into(), "/tmp/x".into())
            .unwrap()
            .is_empty());
    }
}
