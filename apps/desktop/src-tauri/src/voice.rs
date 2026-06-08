// Voice input — record the mic with ffmpeg and transcribe locally with
// whisper.cpp, entirely on-device (no audio leaves the machine). The renderer
// drives a start → stop flow; the in-flight recording Child lives in
// Tauri-managed state between the two calls. Mirrors the CLI voice subsystem
// (packages/core/src/voice/*). Spec: docs/VOICE_INPUT.md.
//
// Desktop uses ffmpeg specifically because we stop it gracefully by writing
// `q` to its stdin, which flushes a valid WAV trailer — sox/rec have no such
// stdin command, so the CLI (which can send SIGINT) supports them but the
// desktop sticks to ffmpeg.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};

const WHISPER_BINS: [&str; 2] = ["whisper-cli", "whisper"];
const MODEL_RELPATH: [&str; 3] = [".deepcode", "models", "whisper-base.en.bin"];
const MAX_SECONDS: u32 = 60;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    /// True iff whisper binary, model, and ffmpeg were all resolved.
    pub ready: bool,
    pub bin_path: Option<String>,
    pub model_path: Option<String>,
    pub recorder_path: Option<String>,
    /// Human-readable reasons it is not ready (empty when ready).
    pub problems: Vec<String>,
}

/// In-flight recording, parked in Tauri state between voice_start and voice_stop.
struct Recording {
    child: Child,
    wav: PathBuf,
    bin_path: String,
    model_path: String,
}

#[derive(Default)]
pub struct VoiceState(Mutex<Option<Recording>>);

// ── detection ───────────────────────────────────────────────────────────────

/// First dir in $PATH holding a file named `name` (no exec-bit check — good
/// enough for reporting; the spawn would surface a real perms error).
fn which_on_path(name: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let cand = dir.join(name);
        if cand.is_file() {
            return Some(cand.to_string_lossy().into_owned());
        }
    }
    None
}

/// Expand a leading `~` / `~/` against `home`; other paths pass through.
fn expand_home(p: &str, home: &Path) -> PathBuf {
    if p == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = p.strip_prefix("~/") {
        return home.join(rest);
    }
    PathBuf::from(p)
}

/// (binPath, modelPath, inputDevice) from ~/.deepcode/settings.json `voice` block.
fn read_voice_settings(home: &Path) -> (Option<String>, Option<String>, Option<String>) {
    let path = home.join(".deepcode").join("settings.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return (None, None, None);
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return (None, None, None);
    };
    let voice = v.get("voice");
    let get = |k: &str| {
        voice
            .and_then(|o| o.get(k))
            .and_then(|x| x.as_str())
            .map(String::from)
    };
    (get("binPath"), get("modelPath"), get("inputDevice"))
}

/// Resolve whisper + model + ffmpeg under `home`, collecting problems. Never panics.
fn compute_status(home: &Path) -> VoiceStatus {
    let (bin_cfg, model_cfg, _device) = read_voice_settings(home);
    let mut problems = Vec::new();

    let bin_path = match bin_cfg {
        Some(b) => {
            let p = expand_home(&b, home);
            if p.is_file() {
                Some(p.to_string_lossy().into_owned())
            } else {
                problems.push(format!("Configured voice.binPath not found: {b}"));
                None
            }
        }
        None => {
            let found = WHISPER_BINS.iter().find_map(|n| which_on_path(n));
            if found.is_none() {
                problems.push(format!(
                    "whisper.cpp not found on PATH (looked for {}).",
                    WHISPER_BINS.join(", ")
                ));
            }
            found
        }
    };

    let model_path = match model_cfg {
        Some(m) => {
            let p = expand_home(&m, home);
            if p.is_file() {
                Some(p.to_string_lossy().into_owned())
            } else {
                problems.push(format!("Configured voice.modelPath not found: {m}"));
                None
            }
        }
        None => {
            let def = MODEL_RELPATH.iter().fold(home.to_path_buf(), |a, c| a.join(c));
            if def.is_file() {
                Some(def.to_string_lossy().into_owned())
            } else {
                problems.push(format!(
                    "No voice.modelPath set, and no model at ~/{}.",
                    MODEL_RELPATH.join("/")
                ));
                None
            }
        }
    };

    let recorder_path = which_on_path("ffmpeg");
    if recorder_path.is_none() {
        problems.push("ffmpeg not found on PATH (brew install ffmpeg).".to_string());
    }

    let ready = bin_path.is_some() && model_path.is_some() && recorder_path.is_some();
    VoiceStatus {
        ready,
        bin_path,
        model_path,
        recorder_path,
        problems,
    }
}

/// ffmpeg argv to record the default mic into a 16 kHz mono WAV (capped length).
fn ffmpeg_record_args(device: &str, wav: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-f".into(),
        "avfoundation".into(),
        "-i".into(),
        device.into(),
        "-t".into(),
        MAX_SECONDS.to_string(),
        "-ar".into(),
        "16000".into(),
        "-ac".into(),
        "1".into(),
        wav.to_string_lossy().into_owned(),
    ]
}

/// Strip whisper.cpp's per-line timestamps + log lines to the bare transcript.
/// Ported from packages/core/src/voice/index.ts `parseWhisperOutput`.
fn parse_whisper_output(raw: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    for line in raw.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with("whisper_") || t.starts_with("system_info:") {
            continue;
        }
        if t.starts_with('[') {
            if let Some(idx) = t.find(']') {
                let text = t[idx + 1..].trim();
                if !text.is_empty() {
                    parts.push(text.to_string());
                }
            }
        } else {
            parts.push(t.to_string());
        }
    }
    parts.join(" ").trim().to_string()
}

async fn transcribe(bin: &str, model: &str, wav: &Path) -> Result<String, String> {
    if !wav.is_file() {
        return Err("recording produced no audio (is a microphone available?)".into());
    }
    let out = Command::new(bin)
        .args(["-m", model, "-f", &wav.to_string_lossy()])
        .output()
        .await
        .map_err(|e| format!("spawn whisper: {e}"))?;
    if !out.status.success() {
        let err: String = String::from_utf8_lossy(&out.stderr).chars().take(300).collect();
        return Err(format!(
            "whisper exited {}: {}",
            out.status.code().unwrap_or(-1),
            err.trim()
        ));
    }
    Ok(parse_whisper_output(&String::from_utf8_lossy(&out.stdout)))
}

// ── commands ────────────────────────────────────────────────────────────────

/// Report whether local voice input is set up (whisper.cpp + model + ffmpeg).
#[tauri::command]
pub fn voice_status() -> VoiceStatus {
    match dirs::home_dir() {
        Some(home) => compute_status(&home),
        None => VoiceStatus {
            problems: vec!["could not resolve home directory".into()],
            ..Default::default()
        },
    }
}

/// Begin recording from the default mic. Errors if voice isn't set up.
#[tauri::command]
pub async fn voice_start(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("could not resolve home directory")?;
    let status = compute_status(&home);
    if !status.ready {
        return Err(status.problems.join("; "));
    }
    let (_, _, device) = read_voice_settings(&home);
    let device = device.unwrap_or_else(|| ":default".to_string());
    let recorder = status.recorder_path.clone().expect("ready ⇒ recorder");
    let wav = std::env::temp_dir().join(format!(
        "deepcode-voice-{}-{}.wav",
        std::process::id(),
        crate::snapshots::now_ms()
    ));

    // Replace any orphaned prior recording.
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut old) = guard.take() {
            let _ = old.child.start_kill();
        }
    }

    let child = Command::new(&recorder)
        .args(ffmpeg_record_args(&device, &wav))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn ffmpeg: {e}"))?;

    let rec = Recording {
        child,
        wav,
        bin_path: status.bin_path.expect("ready ⇒ bin"),
        model_path: status.model_path.expect("ready ⇒ model"),
    };
    state
        .0
        .lock()
        .map_err(|_| "voice state poisoned")?
        .replace(rec);
    Ok(())
}

/// Stop recording, transcribe the clip, delete the audio, return the text.
#[tauri::command]
pub async fn voice_stop(state: tauri::State<'_, VoiceState>) -> Result<String, String> {
    let mut rec = state
        .0
        .lock()
        .map_err(|_| "voice state poisoned")?
        .take()
        .ok_or("not recording")?;

    // Graceful stop: 'q' on ffmpeg's stdin flushes a valid WAV trailer.
    if let Some(mut stdin) = rec.child.stdin.take() {
        let _ = stdin.write_all(b"q\n").await;
        let _ = stdin.flush().await;
    }
    if tokio::time::timeout(std::time::Duration::from_secs(5), rec.child.wait())
        .await
        .is_err()
    {
        let _ = rec.child.start_kill();
        let _ = rec.child.wait().await;
    }

    let result = transcribe(&rec.bin_path, &rec.model_path, &rec.wav).await;
    let _ = tokio::fs::remove_file(&rec.wav).await;
    let _ = tokio::fs::remove_file(format!("{}.txt", rec.wav.to_string_lossy())).await;
    result
}

/// Abort an in-flight recording without transcribing; deletes the audio.
#[tauri::command]
pub async fn voice_cancel(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    let rec = state.0.lock().map_err(|_| "voice state poisoned")?.take();
    if let Some(mut rec) = rec {
        let _ = rec.child.start_kill();
        let _ = rec.child.wait().await;
        let _ = tokio::fs::remove_file(&rec.wav).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_whisper_strips_timestamps_and_logs() {
        let raw = "[00:00:00.000 --> 00:00:02.500]  hello world\n\
                   [00:00:02.500 --> 00:00:05.000]  another line";
        assert_eq!(parse_whisper_output(raw), "hello world another line");

        let with_logs = "whisper_init_from_file: loading\n\
                         system_info: AVX2\n\
                         [00:00:00.000 --> 00:00:01.000]  real text";
        assert_eq!(parse_whisper_output(with_logs), "real text");

        assert_eq!(parse_whisper_output("whisper_init\nsystem_info: X"), "");
    }

    #[test]
    fn expand_home_handles_tilde() {
        let home = Path::new("/home/u");
        assert_eq!(expand_home("~", home), PathBuf::from("/home/u"));
        assert_eq!(expand_home("~/m/x.bin", home), PathBuf::from("/home/u/m/x.bin"));
        assert_eq!(expand_home("/abs", home), PathBuf::from("/abs"));
    }

    #[test]
    fn ffmpeg_args_are_16k_mono_wav() {
        let args = ffmpeg_record_args(":default", Path::new("/t/o.wav"));
        assert!(args.windows(2).any(|w| w == ["-ar", "16000"]));
        assert!(args.windows(2).any(|w| w == ["-ac", "1"]));
        assert!(args.windows(2).any(|w| w == ["-i", ":default"]));
        assert_eq!(args.last().unwrap(), "/t/o.wav");
    }

    #[test]
    fn compute_status_flags_missing_configured_paths() {
        // A temp home with a settings.json pointing at non-existent bin/model.
        let home = std::env::temp_dir().join(format!("dc-voice-{}", std::process::id()));
        let cfg_dir = home.join(".deepcode");
        std::fs::create_dir_all(&cfg_dir).unwrap();
        std::fs::write(
            cfg_dir.join("settings.json"),
            r#"{"voice":{"binPath":"/no/such/whisper","modelPath":"/no/such/m.bin"}}"#,
        )
        .unwrap();

        let s = compute_status(&home);
        let _ = std::fs::remove_dir_all(&home);

        assert!(!s.ready);
        assert!(s.bin_path.is_none());
        assert!(s.model_path.is_none());
        let joined = s.problems.join("\n");
        assert!(joined.contains("Configured voice.binPath not found"), "got {joined}");
        assert!(joined.contains("Configured voice.modelPath not found"), "got {joined}");
    }
}
