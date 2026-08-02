// Read/write ~/.deepcode/credentials.json with chmod 600.
// Matches the CLI's credentials store so config is shared.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct Credentials {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub has_key: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
}

pub fn credentials_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".deepcode").join("credentials.json"))
}

pub fn read() -> Result<Credentials, String> {
    let Some(path) = credentials_path() else {
        return Ok(Credentials::default());
    };
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Credentials::default()),
        Err(e) => Err(format!("read {}: {}", path.display(), e)),
    }
}

pub fn status() -> Result<CredentialStatus, String> {
    let credentials = read()?;
    Ok(CredentialStatus {
        has_key: credentials
            .api_key
            .as_ref()
            .is_some_and(|value| !value.is_empty())
            || credentials
                .auth_token
                .as_ref()
                .is_some_and(|value| !value.is_empty()),
        base_url: credentials.base_url,
    })
}

pub fn write(creds: &Credentials) -> Result<(), String> {
    let Some(path) = credentials_path() else {
        return Err("no home directory".into());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let raw = serde_json::to_string_pretty(creds).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| format!("write {}: {}", path.display(), e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("chmod 600: {e}"))?;
    }
    Ok(())
}

// ── Serde contract ─────────────────────────────────────────────────────
// Credentials remain backend-only. The renderer receives CredentialStatus,
// while this shape stays compatible with the CLI's credentials.json.
#[cfg(test)]
mod contract_tests {
    use super::*;

    #[test]
    fn serializes_snake_case_keys() {
        let v = serde_json::to_value(Credentials {
            api_key: Some("sk".into()),
            auth_token: Some("tok".into()),
            base_url: Some("https://h/v1".into()),
        })
        .unwrap();
        let keys: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
        assert!(keys.contains(&"api_key".to_string()), "got {keys:?}");
        assert!(keys.contains(&"auth_token".to_string()), "got {keys:?}");
        assert!(keys.contains(&"base_url".to_string()), "got {keys:?}");
        assert!(!keys.contains(&"apiKey".to_string()), "camelCase leaked: {keys:?}");
    }

    #[test]
    fn omits_none_fields() {
        let v = serde_json::to_value(Credentials::default()).unwrap();
        assert_eq!(v.as_object().unwrap().len(), 0, "None fields must be skipped: {v}");
    }

    #[test]
    fn status_never_serializes_credentials() {
        let value = serde_json::to_value(CredentialStatus {
            has_key: true,
            base_url: Some("https://host/v1".into()),
        })
        .unwrap();
        assert_eq!(value["hasKey"], true);
        assert_eq!(value["baseUrl"], "https://host/v1");
        assert!(value.get("api_key").is_none());
        assert!(value.get("auth_token").is_none());
    }
}
