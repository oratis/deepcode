use std::sync::Mutex;

use serde::Serialize;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

struct ManagedChild {
    pid: u32,
    child: CommandChild,
}

#[derive(Default)]
pub struct AppServerState {
    child: Mutex<Option<ManagedChild>>,
}

impl Drop for AppServerState {
    fn drop(&mut self) {
        if let Ok(slot) = self.child.get_mut() {
            if let Some(managed) = slot.take() {
                let _ = managed.child.kill();
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerStatus {
    running: bool,
    pid: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppServerOutput {
    stream: &'static str,
    line: String,
    code: Option<i32>,
    signal: Option<i32>,
}

#[tauri::command]
pub fn app_server_start(
    app: AppHandle,
    state: State<'_, AppServerState>,
) -> Result<AppServerStatus, String> {
    let mut slot = state.child.lock().map_err(|_| "app-server lock poisoned")?;
    if let Some(managed) = slot.as_ref() {
        return Ok(AppServerStatus {
            running: true,
            pid: Some(managed.pid),
        });
    }

    let script = app
        .path()
        .resolve("app-server.cjs", BaseDirectory::Resource)
        .map_err(|error| format!("resolve app-server resource: {error}"))?;
    let (mut receiver, child) = app
        .shell()
        .sidecar("deepcode-runtime")
        .map_err(|error| format!("resolve bundled runtime: {error}"))?
        .arg(script)
        .spawn()
        .map_err(|error| format!("start app-server: {error}"))?;
    let pid = child.pid();
    *slot = Some(ManagedChild { pid, child });
    drop(slot);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = receiver.recv().await {
            let (stream, line, code, signal, terminated) = match event {
                CommandEvent::Stdout(bytes) => (
                    "stdout",
                    String::from_utf8_lossy(&bytes).into_owned(),
                    None,
                    None,
                    false,
                ),
                CommandEvent::Stderr(bytes) => (
                    "stderr",
                    String::from_utf8_lossy(&bytes).into_owned(),
                    None,
                    None,
                    false,
                ),
                CommandEvent::Error(error) => ("error", error, None, None, false),
                CommandEvent::Terminated(payload) => (
                    "terminated",
                    String::new(),
                    payload.code,
                    payload.signal,
                    true,
                ),
                _ => continue,
            };
            let _ = handle.emit(
                "app-server-output",
                AppServerOutput {
                    stream,
                    line,
                    code,
                    signal,
                },
            );
            if terminated {
                if let Ok(mut current) = handle.state::<AppServerState>().child.lock() {
                    if current.as_ref().is_some_and(|managed| managed.pid == pid) {
                        current.take();
                    }
                }
            }
        }
    });

    Ok(AppServerStatus {
        running: true,
        pid: Some(pid),
    })
}

#[tauri::command]
pub fn app_server_send(state: State<'_, AppServerState>, message: String) -> Result<(), String> {
    validate_request_line(&message)?;
    let mut slot = state.child.lock().map_err(|_| "app-server lock poisoned")?;
    let managed = slot
        .as_mut()
        .ok_or_else(|| "app-server is not running".to_string())?;
    managed
        .child
        .write(format!("{message}\n").as_bytes())
        .map_err(|error| format!("write app-server request: {error}"))
}

#[tauri::command]
pub fn app_server_stop(state: State<'_, AppServerState>) -> Result<(), String> {
    let mut slot = state.child.lock().map_err(|_| "app-server lock poisoned")?;
    if let Some(managed) = slot.take() {
        managed
            .child
            .kill()
            .map_err(|error| format!("stop app-server: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn app_server_status(state: State<'_, AppServerState>) -> Result<AppServerStatus, String> {
    let slot = state.child.lock().map_err(|_| "app-server lock poisoned")?;
    Ok(AppServerStatus {
        running: slot.is_some(),
        pid: slot.as_ref().map(|managed| managed.pid),
    })
}

fn validate_request_line(message: &str) -> Result<(), String> {
    if message.contains(['\n', '\r']) {
        return Err("app-server request must be one line".to_string());
    }
    let value: serde_json::Value = serde_json::from_str(message)
        .map_err(|error| format!("invalid app-server JSON: {error}"))?;
    if !value.is_object() {
        return Err("app-server request must be a JSON object".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_request_line;

    #[test]
    fn request_line_must_be_one_json_object() {
        assert!(validate_request_line(r#"{"id":1,"method":"initialize","params":{}}"#).is_ok());
        assert!(validate_request_line("{}\n{}").is_err());
        assert!(validate_request_line("not-json").is_err());
        assert!(validate_request_line("[]").is_err());
    }
}
