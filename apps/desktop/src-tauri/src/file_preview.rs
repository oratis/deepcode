// Read-only file preview exposed to the desktop renderer. Runtime mutations
// belong to the bundled app-server and are intentionally absent from Tauri's
// command surface.

use serde::Serialize;
use std::path::Path;

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
    let resolved = tokio::fs::canonicalize(&file_path)
        .await
        .map_err(|e| format!("read {}: {}", file_path, e))?;
    let credentials_path = if let Some(path) = crate::credentials::credentials_path() {
        tokio::fs::canonicalize(path).await.ok()
    } else {
        None
    };
    reject_credentials_path(&resolved, credentials_path.as_deref())?;
    let raw = tokio::fs::read_to_string(&resolved)
        .await
        .map_err(|e| format!("read {}: {}", file_path, e))?;
    let lines: Vec<&str> = raw.split('\n').collect();
    let offset = offset.unwrap_or(1).max(1);
    let limit = limit.unwrap_or(2000).max(1);
    let start = (offset - 1).min(lines.len());
    let end = (start + limit).min(lines.len());
    let slice = &lines[start..end];

    let numbered: Vec<String> = slice
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let n = offset + i;
            let truncated = if line.chars().count() > 2000 {
                format!("{}... [truncated]", line.chars().take(2000).collect::<String>())
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

fn reject_credentials_path(resolved: &Path, credentials_path: Option<&Path>) -> Result<(), String> {
    if credentials_path.is_some_and(|path| resolved == path) {
        Err("credential files are backend-only".to_string())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_ok_serializes_camel_case() {
        let value = serde_json::to_value(ReadOk {
            content: String::new(),
            lines_total: 10,
            lines_shown: 5,
            offset: 1,
        })
        .unwrap();
        let object = value.as_object().unwrap();
        assert!(object.contains_key("linesTotal"));
        assert!(object.contains_key("linesShown"));
        assert!(!object.contains_key("lines_total"));
    }

    #[test]
    fn renderer_read_rejects_backend_credentials() {
        let credential = Path::new("/home/user/.deepcode/credentials.json");
        assert!(reject_credentials_path(credential, Some(credential)).is_err());
        assert!(reject_credentials_path(Path::new("/workspace/src.ts"), Some(credential)).is_ok());
    }

    #[tokio::test]
    async fn read_handles_unicode_truncation_and_offset_past_eof() {
        let path = std::env::temp_dir().join(format!(
            "deepcode-preview-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, "界".repeat(2001)).unwrap();
        let preview = tool_read(path.to_string_lossy().into_owned(), None, None)
            .await
            .unwrap();
        assert!(preview.content.ends_with("... [truncated]"));
        let empty = tool_read(path.to_string_lossy().into_owned(), Some(99), None)
            .await
            .unwrap();
        assert_eq!(empty.lines_shown, 0);
        assert!(empty.content.is_empty());
        std::fs::remove_file(path).ok();
    }
}
