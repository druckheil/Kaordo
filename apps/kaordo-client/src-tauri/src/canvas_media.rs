use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use std::str::FromStr;
use uuid::Uuid;

const MAX_CHUNK_BYTES: u64 = 8 * 1024 * 1024;

#[tauri::command]
pub(crate) async fn canvas_media_size(
    app: tauri::AppHandle,
    auth: tauri::State<'_, crate::auth::AuthClient>,
    workspace_id: String,
    media_id: String,
) -> Result<Option<u64>, String> {
    auth.require_authenticated()?;
    let workspace_id = crate::parse_workspace_id(&workspace_id)?;
    let media_id = parse_media_id(&media_id)?;
    let library = crate::workspace_library(&app)?;
    tauri::async_runtime::spawn_blocking(move || library.canvas_media_size(workspace_id, media_id))
        .await
        .map_err(|error| format!("The canvas media size task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn canvas_read_media_chunk(
    app: tauri::AppHandle,
    auth: tauri::State<'_, crate::auth::AuthClient>,
    workspace_id: String,
    media_id: String,
    offset: u64,
    length: u64,
) -> Result<Vec<u8>, String> {
    auth.require_authenticated()?;
    if length == 0 || length > MAX_CHUNK_BYTES {
        return Err("The canvas media chunk size is invalid.".to_owned());
    }
    let workspace_id = crate::parse_workspace_id(&workspace_id)?;
    let media_id = parse_media_id(&media_id)?;
    let library = crate::workspace_library(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        library.read_canvas_media_chunk(workspace_id, media_id, offset, length)
    })
    .await
    .map_err(|error| format!("The canvas media read task failed: {error}"))?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn canvas_write_media_chunk(
    app: tauri::AppHandle,
    auth: tauri::State<'_, crate::auth::AuthClient>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    auth.require_authenticated()?;
    let workspace_id =
        crate::parse_workspace_id(&decoded_header(&request, "x-kaordo-workspace-id")?)?;
    let media_id = parse_media_id(&decoded_header(&request, "x-kaordo-media-id")?)?;
    let offset = plain_header(&request, "x-kaordo-offset")?
        .parse::<u64>()
        .map_err(|_| "The canvas media offset is invalid.".to_owned())?;
    let total = plain_header(&request, "x-kaordo-total")?
        .parse::<u64>()
        .map_err(|_| "The canvas media size is invalid.".to_owned())?;
    let bytes = raw_request_bytes(&request)?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_CHUNK_BYTES {
        return Err("The canvas media chunk is invalid.".to_owned());
    }
    let library = crate::workspace_library(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        library.write_canvas_media_chunk(workspace_id, media_id, offset, total, &bytes)
    })
    .await
    .map_err(|error| format!("The canvas media write task failed: {error}"))?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn canvas_delete_media(
    app: tauri::AppHandle,
    auth: tauri::State<'_, crate::auth::AuthClient>,
    workspace_id: String,
    media_id: String,
) -> Result<(), String> {
    auth.require_authenticated()?;
    let workspace_id = crate::parse_workspace_id(&workspace_id)?;
    let media_id = parse_media_id(&media_id)?;
    let library = crate::workspace_library(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        library.delete_canvas_media(workspace_id, media_id)
    })
    .await
    .map_err(|error| format!("The canvas media deletion task failed: {error}"))?
    .map_err(|error| error.to_string())
}

fn parse_media_id(value: &str) -> Result<Uuid, String> {
    Uuid::from_str(value).map_err(|_| "The canvas media identifier is invalid.".to_owned())
}

fn raw_request_bytes(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(serde_json::Value::Array(bytes)) => bytes
            .iter()
            .map(serde_json::Value::as_u64)
            .map(|byte| byte.and_then(|value| u8::try_from(value).ok()))
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| "The canvas media data is invalid.".to_owned()),
        tauri::ipc::InvokeBody::Json(_) => Err("The canvas media data is invalid.".to_owned()),
    }
}

fn decoded_header(request: &tauri::ipc::Request<'_>, name: &str) -> Result<String, String> {
    let encoded = plain_header(request, name)?;
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "The canvas media metadata is invalid.".to_owned())?;
    String::from_utf8(bytes).map_err(|_| "The canvas media metadata is invalid.".to_owned())
}

fn plain_header<'a>(request: &'a tauri::ipc::Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .ok_or_else(|| "The canvas media metadata is incomplete.".to_owned())?
        .to_str()
        .map_err(|_| "The canvas media metadata is invalid.".to_owned())
}
