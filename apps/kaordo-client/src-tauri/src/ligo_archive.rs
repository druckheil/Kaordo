use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Command,
};
use tauri::Manager;

const MANAGED_FILE_MARKER: &str = "__kaordo_";
const PLAYBACK_FILE_PREFIX: &str = "kaordo_media_";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LigoArchiveEntry {
    date_label: String,
    key: String,
    name: String,
    ready: bool,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LigoArchiveTarget {
    file_name: String,
    key: String,
    needs_write: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LigoPlaybackTarget {
    file_name: String,
    needs_write: bool,
    path: String,
}

#[tauri::command]
pub(crate) async fn ligo_prepare_chat_files(
    app: tauri::AppHandle,
    auth: tauri::State<'_, crate::auth::AuthClient>,
    owner_id: String,
    conversation_id: String,
    peer_username: String,
    entries: Vec<LigoArchiveEntry>,
) -> Result<Vec<LigoArchiveTarget>, String> {
    auth.require_authenticated()?;
    let directory = archive_directory(&app, &owner_id, &conversation_id, &peer_username)?;
    tauri::async_runtime::spawn_blocking(move || prepare_archive(&directory, entries))
        .await
        .map_err(|error| format!("The local chat folder task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn ligo_write_chat_file_chunk(
    app: tauri::AppHandle,
    auth: tauri::State<'_, crate::auth::AuthClient>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    auth.require_authenticated()?;
    let owner_id = decoded_header(&request, "x-kaordo-owner-id")?;
    let conversation_id = decoded_header(&request, "x-kaordo-conversation-id")?;
    let peer_username = decoded_header(&request, "x-kaordo-peer-username")?;
    let file_name = decoded_header(&request, "x-kaordo-file-name")?;
    let offset = plain_header(&request, "x-kaordo-offset")?
        .parse::<u64>()
        .map_err(|_| "The local chat file offset is invalid.".to_owned())?;
    let total = plain_header(&request, "x-kaordo-total")?
        .parse::<u64>()
        .map_err(|_| "The local chat file size is invalid.".to_owned())?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(serde_json::Value::Array(bytes)) => bytes
            .iter()
            .map(serde_json::Value::as_u64)
            .map(|byte| byte.and_then(|value| u8::try_from(value).ok()))
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| "The local chat file data is invalid.".to_owned())?,
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("The local chat file data is invalid.".to_owned());
        }
    };
    let directory = archive_directory(&app, &owner_id, &conversation_id, &peer_username)?;
    let file_name = safe_managed_file_name(&file_name)?;
    tauri::async_runtime::spawn_blocking(move || {
        write_chunk(&directory, &file_name, offset, total, &bytes)
    })
    .await
    .map_err(|error| format!("The local chat file task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn ligo_open_chat_files(
    app: tauri::AppHandle,
    auth: tauri::State<'_, crate::auth::AuthClient>,
    owner_id: String,
    conversation_id: String,
    peer_username: String,
) -> Result<(), String> {
    auth.require_authenticated()?;
    let directory = archive_directory(&app, &owner_id, &conversation_id, &peer_username)?;
    tauri::async_runtime::spawn_blocking(move || open_directory(&directory))
        .await
        .map_err(|error| format!("The local chat folder task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn ligo_prepare_playback_file(
    app: tauri::AppHandle,
    auth: tauri::State<'_, crate::auth::AuthClient>,
    attachment_id: String,
    name: String,
    mime_type: String,
    size: u64,
) -> Result<LigoPlaybackTarget, String> {
    auth.require_authenticated()?;
    let directory = playback_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&directory)
            .map_err(|error| format!("The video cache could not be created: {error}"))?;
        let file_name = playback_file_name(&attachment_id, &name, &mime_type);
        let path = directory.join(&file_name);
        let needs_write = fs::metadata(&path).map_or(true, |metadata| {
            !metadata.is_file() || metadata.len() != size
        });
        if needs_write && path.exists() {
            fs::remove_file(&path).map_err(|error| {
                format!("The obsolete video cache could not be removed: {error}")
            })?;
        }
        Ok(LigoPlaybackTarget {
            file_name,
            needs_write,
            path: path.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|error| format!("The video cache task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn ligo_write_playback_file_chunk(
    app: tauri::AppHandle,
    auth: tauri::State<'_, crate::auth::AuthClient>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    auth.require_authenticated()?;
    let file_name = decoded_header(&request, "x-kaordo-file-name")?;
    let offset = plain_header(&request, "x-kaordo-offset")?
        .parse::<u64>()
        .map_err(|_| "The video cache offset is invalid.".to_owned())?;
    let total = plain_header(&request, "x-kaordo-total")?
        .parse::<u64>()
        .map_err(|_| "The video cache size is invalid.".to_owned())?;
    let bytes = raw_request_bytes(&request)?;
    let file_name = safe_playback_file_name(&file_name)?;
    let directory = playback_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        write_playback_chunk(&directory, &file_name, offset, total, &bytes)
    })
    .await
    .map_err(|error| format!("The video cache task failed: {error}"))?
}

fn prepare_archive(
    directory: &Path,
    entries: Vec<LigoArchiveEntry>,
) -> Result<Vec<LigoArchiveTarget>, String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("The local chat folder could not be created: {error}"))?;
    let targets = entries
        .into_iter()
        .map(|entry| {
            let file_name = archive_file_name(&entry);
            let needs_write = entry.ready
                && fs::metadata(directory.join(&file_name)).map_or(true, |metadata| {
                    !metadata.is_file() || metadata.len() != entry.size
                });
            LigoArchiveTarget {
                file_name,
                key: entry.key,
                needs_write,
            }
        })
        .collect::<Vec<_>>();
    let expected = targets
        .iter()
        .map(|target| target.file_name.as_str())
        .collect::<HashSet<_>>();
    for item in fs::read_dir(directory)
        .map_err(|error| format!("The local chat folder could not be read: {error}"))?
    {
        let item = item.map_err(|error| format!("A local chat file could not be read: {error}"))?;
        let name = item.file_name().to_string_lossy().into_owned();
        if item.path().is_file()
            && name.contains(MANAGED_FILE_MARKER)
            && !expected.contains(name.as_str())
        {
            fs::remove_file(item.path()).map_err(|error| {
                format!("An obsolete local chat file could not be removed: {error}")
            })?;
        }
    }
    Ok(targets)
}

fn archive_file_name(entry: &LigoArchiveEntry) -> String {
    let clean_name = sanitize_component(&entry.name, 120);
    let path = Path::new(&clean_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let date = sanitize_component(&entry.date_label, 28);
    let marker = sanitize_component(&entry.key, 72);
    if extension.is_empty() {
        format!("{date}_{stem}{MANAGED_FILE_MARKER}{marker}")
    } else {
        format!("{date}_{stem}{MANAGED_FILE_MARKER}{marker}.{extension}")
    }
}

fn write_chunk(
    directory: &Path,
    file_name: &str,
    offset: u64,
    total: u64,
    bytes: &[u8],
) -> Result<(), String> {
    if offset > total || bytes.len() as u64 > total.saturating_sub(offset) {
        return Err("The local chat file chunk is outside the expected size.".to_owned());
    }
    fs::create_dir_all(directory)
        .map_err(|error| format!("The local chat folder could not be created: {error}"))?;
    let final_path = directory.join(file_name);
    let partial_path = directory.join(format!(".{file_name}.part"));
    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(offset == 0);
    let mut file = options
        .open(&partial_path)
        .map_err(|error| format!("The local chat file could not be opened: {error}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("The local chat file could not be positioned: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("The local chat file could not be written: {error}"))?;
    if offset + bytes.len() as u64 != total {
        return Ok(());
    }
    file.sync_all()
        .map_err(|error| format!("The local chat file could not be flushed: {error}"))?;
    drop(file);
    let actual = fs::metadata(&partial_path)
        .map_err(|error| format!("The local chat file could not be verified: {error}"))?
        .len();
    if actual != total {
        return Err("The completed local chat file has an unexpected size.".to_owned());
    }
    if final_path.exists() {
        fs::remove_file(&final_path).map_err(|error| {
            format!("The previous local chat file could not be replaced: {error}")
        })?;
    }
    fs::rename(partial_path, final_path)
        .map_err(|error| format!("The local chat file could not be finalized: {error}"))
}

fn write_playback_chunk(
    directory: &Path,
    file_name: &str,
    offset: u64,
    total: u64,
    bytes: &[u8],
) -> Result<(), String> {
    if offset > total || bytes.len() as u64 > total.saturating_sub(offset) {
        return Err("The video cache chunk is outside the expected file size.".to_owned());
    }
    fs::create_dir_all(directory)
        .map_err(|error| format!("The video cache could not be created: {error}"))?;
    let final_path = directory.join(file_name);
    let partial_path = directory.join(format!(".{file_name}.part"));
    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(offset == 0);
    let mut file = options
        .open(&partial_path)
        .map_err(|error| format!("The video cache could not be opened: {error}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("The video cache could not be positioned: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("The video cache could not be written: {error}"))?;
    let completed = offset + bytes.len() as u64;
    if completed != total {
        return Ok(());
    }
    file.sync_all()
        .map_err(|error| format!("The video cache could not be flushed: {error}"))?;
    drop(file);
    let actual = fs::metadata(&partial_path)
        .map_err(|error| format!("The video cache could not be verified: {error}"))?
        .len();
    if actual != total {
        return Err("The completed video cache has an unexpected size.".to_owned());
    }
    if final_path.exists() {
        fs::remove_file(&final_path)
            .map_err(|error| format!("The previous video cache could not be replaced: {error}"))?;
    }
    fs::rename(partial_path, final_path)
        .map_err(|error| format!("The video cache could not be finalized: {error}"))
}

fn archive_directory(
    app: &tauri::AppHandle,
    owner_id: &str,
    conversation_id: &str,
    peer_username: &str,
) -> Result<PathBuf, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|error| format!("The Documents directory is unavailable: {error}"))?;
    Ok(documents
        .join("Kaordo")
        .join("Ligo")
        .join(sanitize_component(owner_id, 80))
        .join(format!(
            "{}__{}",
            sanitize_component(peer_username, 80),
            sanitize_component(conversation_id, 80),
        )))
}

fn playback_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|directory| directory.join("ligo-media"))
        .map_err(|error| format!("The application cache directory is unavailable: {error}"))
}

fn playback_file_name(attachment_id: &str, name: &str, mime_type: &str) -> String {
    let id = sanitize_component(attachment_id, 96);
    let original_extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let extension = if is_quick_time_video(name, mime_type) {
        "mp4"
    } else if original_extension.is_empty() {
        "video"
    } else {
        original_extension.as_str()
    };
    format!("{PLAYBACK_FILE_PREFIX}{id}.{extension}")
}

fn is_quick_time_video(name: &str, mime_type: &str) -> bool {
    mime_type.eq_ignore_ascii_case("video/quicktime") || name.to_ascii_lowercase().ends_with(".mov")
}

fn safe_playback_file_name(file_name: &str) -> Result<String, String> {
    let safe = sanitize_component(file_name, 180);
    if safe != file_name || !safe.starts_with(PLAYBACK_FILE_PREFIX) {
        return Err("The video cache file name is invalid.".to_owned());
    }
    Ok(safe)
}

fn raw_request_bytes(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(serde_json::Value::Array(bytes)) => Ok(bytes
            .iter()
            .map(serde_json::Value::as_u64)
            .map(|byte| byte.and_then(|value| u8::try_from(value).ok()))
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| "The local media data is invalid.".to_owned())?),
        tauri::ipc::InvokeBody::Json(_) => Err("The local media data is invalid.".to_owned()),
    }
}

fn safe_managed_file_name(file_name: &str) -> Result<String, String> {
    let safe = sanitize_component(file_name, 240);
    if safe != file_name || !safe.contains(MANAGED_FILE_MARKER) {
        return Err("The local chat file name is invalid.".to_owned());
    }
    Ok(safe)
}

fn sanitize_component(value: &str, max_chars: usize) -> String {
    let mut safe = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .take(max_chars)
        .collect::<String>();
    let replacement = {
        let trimmed = safe.trim_matches([' ', '.']);
        if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
            Some("unknown".to_owned())
        } else if trimmed.len() != safe.len() {
            Some(trimmed.to_owned())
        } else {
            None
        }
    };
    if let Some(replacement) = replacement {
        replacement.clone_into(&mut safe);
    }
    let stem = safe
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
    {
        safe.insert(0, '_');
    }
    safe
}

fn decoded_header(request: &tauri::ipc::Request<'_>, name: &str) -> Result<String, String> {
    let encoded = plain_header(request, name)?;
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "The local chat file metadata is invalid.".to_owned())?;
    String::from_utf8(bytes).map_err(|_| "The local chat file metadata is invalid.".to_owned())
}

fn plain_header<'a>(request: &'a tauri::ipc::Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .ok_or_else(|| "The local chat file metadata is incomplete.".to_owned())?
        .to_str()
        .map_err(|_| "The local chat file metadata is invalid.".to_owned())
}

fn open_directory(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("The local chat folder could not be created: {error}"))?;
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");
    command
        .arg(directory)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("The system file browser could not be opened: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{LigoArchiveEntry, MANAGED_FILE_MARKER, archive_file_name, sanitize_component};
    use std::path::Path;

    #[test]
    fn archive_names_sort_by_date_and_keep_extensions() {
        let entry = LigoArchiveEntry {
            date_label: "2026-08-13_12-34-56-000Z".to_owned(),
            key: "message:attachment".to_owned(),
            name: "photo.png".to_owned(),
            ready: true,
            size: 1,
        };
        let name = archive_file_name(&entry);
        assert!(name.starts_with("2026-08-13_12-34-56-000Z_photo"));
        assert!(name.contains(MANAGED_FILE_MARKER));
        assert!(
            Path::new(&name)
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
        );
    }

    #[test]
    fn path_components_cannot_escape_the_archive() {
        assert_eq!(sanitize_component("../../bad:name", 80), "_.._bad_name");
    }
}
