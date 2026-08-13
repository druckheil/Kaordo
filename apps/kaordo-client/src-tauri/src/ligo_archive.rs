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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LigoArchiveEntry {
    date_label: String,
    key: String,
    name: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LigoArchiveTarget {
    file_name: String,
    key: String,
    needs_write: bool,
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
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(serde_json::Value::Array(bytes)) => bytes
            .iter()
            .filter_map(serde_json::Value::as_u64)
            .map(|byte| byte as u8)
            .collect(),
        _ => return Err("The local chat file data is invalid.".to_owned()),
    };
    let directory = archive_directory(&app, &owner_id, &conversation_id, &peer_username)?;
    let file_name = safe_managed_file_name(&file_name)?;
    tauri::async_runtime::spawn_blocking(move || {
        write_chunk(&directory, &file_name, offset, &bytes)
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
            let needs_write = fs::metadata(directory.join(&file_name)).map_or(true, |metadata| {
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

fn write_chunk(directory: &Path, file_name: &str, offset: u64, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("The local chat folder could not be created: {error}"))?;
    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(offset == 0);
    let mut file = options
        .open(directory.join(file_name))
        .map_err(|error| format!("The local chat file could not be opened: {error}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("The local chat file could not be positioned: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("The local chat file could not be written: {error}"))
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
    safe = safe.trim_matches([' ', '.']).to_owned();
    if safe.is_empty() || safe == "." || safe == ".." {
        safe = "unknown".to_owned();
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

    #[test]
    fn archive_names_sort_by_date_and_keep_extensions() {
        let entry = LigoArchiveEntry {
            date_label: "2026-08-13_12-34-56-000Z".to_owned(),
            key: "message:attachment".to_owned(),
            name: "photo.png".to_owned(),
            size: 1,
        };
        let name = archive_file_name(&entry);
        assert!(name.starts_with("2026-08-13_12-34-56-000Z_photo"));
        assert!(name.contains(MANAGED_FILE_MARKER));
        assert!(name.ends_with(".png"));
    }

    #[test]
    fn path_components_cannot_escape_the_archive() {
        assert_eq!(sanitize_component("../../bad:name", 80), "_.._bad_name");
    }
}
