// Read-only projection of app-server-owned file snapshots for the desktop
// Diff/History panel. Snapshot capture and every workspace mutation happen in
// @deepcode/core behind the versioned app-server protocol.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// `~/.deepcode/sessions/<id>/snapshots` — the per-session snapshot directory.
fn snapshots_dir(home: &Path, session_id: &str) -> PathBuf {
    home.join(".deepcode")
        .join("sessions")
        .join(session_id)
        .join("snapshots")
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
        let captured_at_ms = v
            .get("capturedAtMs")
            .and_then(|x| x.as_u64())
            .or_else(|| {
                v.get("capturedAt")
                    .and_then(|x| x.as_str())
                    .and_then(parse_iso_millis)
            })
            .unwrap_or(0);
        out.push(SnapshotEntry {
            seq: v.get("seq").and_then(|x| x.as_u64()).unwrap_or(0),
            captured_at_ms,
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

/// Parse core's fixed-width UTC ISO timestamp without adding a date-time
/// dependency to the desktop binary.
fn parse_iso_millis(value: &str) -> Option<u64> {
    if value.len() != 24
        || !value.is_ascii()
        || &value[4..5] != "-"
        || &value[7..8] != "-"
        || &value[10..11] != "T"
        || &value[13..14] != ":"
        || &value[16..17] != ":"
        || &value[19..20] != "."
        || &value[23..24] != "Z"
    {
        return None;
    }
    let year = value[0..4].parse::<i64>().ok()?;
    let month = value[5..7].parse::<i64>().ok()?;
    let day = value[8..10].parse::<i64>().ok()?;
    let hour = value[11..13].parse::<i64>().ok()?;
    let minute = value[14..16].parse::<i64>().ok()?;
    let second = value[17..19].parse::<i64>().ok()?;
    let millis = value[20..23].parse::<i64>().ok()?;
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=59).contains(&second)
    {
        return None;
    }
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let shifted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    let total = (((days * 24 + hour) * 60 + minute) * 60 + second) * 1000 + millis;
    u64::try_from(total).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(v: &serde_json::Value) -> Vec<String> {
        v.as_object().unwrap().keys().cloned().collect()
    }

    #[test]
    fn parses_core_iso_timestamp() {
        assert_eq!(parse_iso_millis("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            parse_iso_millis("2023-11-14T22:13:20.123Z"),
            Some(1_700_000_000_123)
        );
        assert_eq!(parse_iso_millis("not-a-timestamp"), None);
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
    fn list_reads_core_manifest_and_filters() {
        let root = std::env::temp_dir().join(format!("dc-snap-{}", std::process::id()));
        let file = "/tmp/example/app.ts";
        let other = "/tmp/other.ts";
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("snapshots");
        std::fs::create_dir_all(&dir).unwrap();
        let first_blob = dir.join("first.blob");
        let second_blob = dir.join("second.blob");
        std::fs::write(&first_blob, "v0\n").unwrap();
        std::fs::write(&second_blob, "v1\n").unwrap();
        let manifest = [
            serde_json::json!({"filePath": file, "capturedAt": "2023-11-14T22:13:20.123Z", "reason": "pre-Edit", "hash": "a", "seq": 2, "blobPath": first_blob}),
            serde_json::json!({"filePath": file, "capturedAtMs": 1_700_000_000_124_u64, "reason": "post-Edit", "hash": "b", "seq": 3, "blobPath": second_blob}),
            serde_json::json!({"filePath": other, "capturedAtMs": 1_u64, "reason": "pre-Write", "hash": "c", "seq": 1, "blobPath": ""}),
        ]
        .into_iter()
        .map(|row| row.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        std::fs::write(dir.join("manifest.jsonl"), manifest).unwrap();

        let rows = list_file_snapshots(&dir, file).unwrap();
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].seq, 2);
        assert_eq!(rows[0].content, "v0\n");
        assert_eq!(rows[0].reason, "pre-Edit");
        assert_eq!(rows[0].captured_at_ms, 1_700_000_000_123);
        assert_eq!(rows[1].captured_at_ms, 1_700_000_000_124);
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
