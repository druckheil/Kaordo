#![forbid(unsafe_code)]

mod auth;
mod ligo_archive;

use kaordo_workspace::{ObjectSummary, Workspace, WorkspaceDetail, WorkspaceLibrary};
use serde::Serialize;
use std::{fs, path::Path};
use tauri::Manager;
use uuid::Uuid;

const WORKSPACE_LIBRARY_DIRECTORY: &str = "Kaordo";
const LEGACY_WORKSPACE_LIBRARY_DIRECTORY: &str = concat!("Veri", "dimensio");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceInfo {
    id: String,
    name: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceLibraryInfo {
    files: Vec<WorkspaceInfo>,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ObjectInfo {
    document_json: String,
    id: String,
    title: String,
    #[serde(rename = "type")]
    object_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDetailInfo {
    id: String,
    name: String,
    objects: Vec<ObjectInfo>,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
    warnings: Vec<String>,
}

#[tauri::command]
async fn create_workspace(
    app: tauri::AppHandle,
    auth: tauri::State<'_, auth::AuthClient>,
    name: String,
) -> Result<WorkspaceInfo, String> {
    auth.require_authenticated()?;
    let library = workspace_library(&app)?;
    let workspace = tauri::async_runtime::spawn_blocking(move || library.create_named(&name))
        .await
        .map_err(|error| format!("The workspace creation task failed: {error}"))?
        .map_err(|error| error.to_string())?;

    Ok(workspace_info(&workspace))
}

#[tauri::command]
async fn delete_workspace(
    app: tauri::AppHandle,
    auth: tauri::State<'_, auth::AuthClient>,
    workspace_id: String,
) -> Result<(), String> {
    auth.require_authenticated()?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let library = workspace_library(&app)?;
    tauri::async_runtime::spawn_blocking(move || library.delete_workspace(workspace_id))
        .await
        .map_err(|error| format!("The workspace deletion task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_workspaces(
    app: tauri::AppHandle,
    auth: tauri::State<'_, auth::AuthClient>,
) -> Result<WorkspaceLibraryInfo, String> {
    auth.require_authenticated()?;
    let library = workspace_library(&app)?;
    let scan = tauri::async_runtime::spawn_blocking(move || library.list())
        .await
        .map_err(|error| format!("The workspace library scan failed: {error}"))?
        .map_err(|error| error.to_string())?;
    let warnings = scan
        .issues()
        .iter()
        .map(|issue| {
            let entry_name = issue
                .path()
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Unknown workspace");
            format!("{entry_name}: {}", issue.message())
        })
        .collect();
    let files = scan.into_workspaces().iter().map(workspace_info).collect();

    Ok(WorkspaceLibraryInfo { files, warnings })
}

#[tauri::command]
async fn open_workspace(
    app: tauri::AppHandle,
    auth: tauri::State<'_, auth::AuthClient>,
    workspace_id: String,
) -> Result<WorkspaceDetailInfo, String> {
    auth.require_authenticated()?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let library = workspace_library(&app)?;
    let detail = tauri::async_runtime::spawn_blocking(move || library.open_workspace(workspace_id))
        .await
        .map_err(|error| format!("The workspace loading task failed: {error}"))?
        .map_err(|error| error.to_string())?;

    Ok(workspace_detail_info(&detail))
}

#[tauri::command]
async fn create_object(
    app: tauri::AppHandle,
    auth: tauri::State<'_, auth::AuthClient>,
    workspace_id: String,
    title: String,
) -> Result<ObjectInfo, String> {
    auth.require_authenticated()?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let library = workspace_library(&app)?;
    let object =
        tauri::async_runtime::spawn_blocking(move || library.create_object(workspace_id, &title))
            .await
            .map_err(|error| format!("The object creation task failed: {error}"))?
            .map_err(|error| error.to_string())?;

    Ok(object_info(&object))
}

#[tauri::command]
async fn delete_object(
    app: tauri::AppHandle,
    auth: tauri::State<'_, auth::AuthClient>,
    workspace_id: String,
    object_id: String,
) -> Result<(), String> {
    auth.require_authenticated()?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let object_id =
        Uuid::parse_str(&object_id).map_err(|_| "The object identifier is invalid.".to_owned())?;
    let library = workspace_library(&app)?;
    tauri::async_runtime::spawn_blocking(move || library.delete_object(workspace_id, object_id))
        .await
        .map_err(|error| format!("The object deletion task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn update_object_document(
    app: tauri::AppHandle,
    auth: tauri::State<'_, auth::AuthClient>,
    workspace_id: String,
    object_id: String,
    document_json: String,
) -> Result<ObjectInfo, String> {
    auth.require_authenticated()?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let object_id =
        Uuid::parse_str(&object_id).map_err(|_| "The object identifier is invalid.".to_owned())?;
    let library = workspace_library(&app)?;
    let object = tauri::async_runtime::spawn_blocking(move || {
        library.update_object_document(workspace_id, object_id, &document_json)
    })
    .await
    .map_err(|error| format!("The object update task failed: {error}"))?
    .map_err(|error| error.to_string())?;

    Ok(object_info(&object))
}

#[tauri::command]
async fn load_canvas_document(
    app: tauri::AppHandle,
    auth: tauri::State<'_, auth::AuthClient>,
    workspace_id: String,
) -> Result<Option<String>, String> {
    auth.require_authenticated()?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let library = workspace_library(&app)?;
    tauri::async_runtime::spawn_blocking(move || library.load_canvas_document(workspace_id))
        .await
        .map_err(|error| format!("The canvas loading task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_canvas_document(
    app: tauri::AppHandle,
    auth: tauri::State<'_, auth::AuthClient>,
    workspace_id: String,
    document_json: String,
) -> Result<(), String> {
    auth.require_authenticated()?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let library = workspace_library(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        library.save_canvas_document(workspace_id, &document_json)
    })
    .await
    .map_err(|error| format!("The canvas saving task failed: {error}"))?
    .map_err(|error| error.to_string())
}

fn parse_workspace_id(workspace_id: &str) -> Result<Uuid, String> {
    Uuid::parse_str(workspace_id).map_err(|_| "The workspace identifier is invalid.".to_owned())
}

fn workspace_info(workspace: &Workspace) -> WorkspaceInfo {
    WorkspaceInfo {
        id: workspace.id().to_string(),
        name: workspace.name().to_owned(),
        path: workspace.path().to_string_lossy().into_owned(),
        warning: workspace.durability_warning().map(str::to_owned),
    }
}

fn workspace_detail_info(detail: &WorkspaceDetail) -> WorkspaceDetailInfo {
    let workspace = detail.workspace();
    WorkspaceDetailInfo {
        id: workspace.id().to_string(),
        name: workspace.name().to_owned(),
        objects: detail.objects().iter().map(object_info).collect(),
        path: workspace.path().to_string_lossy().into_owned(),
        warning: workspace.durability_warning().map(str::to_owned),
        warnings: detail
            .issues()
            .iter()
            .map(|issue| issue.message().to_owned())
            .collect(),
    }
}

fn object_info(object: &ObjectSummary) -> ObjectInfo {
    ObjectInfo {
        document_json: object.document_json().to_owned(),
        id: object.id().to_string(),
        title: object.title().to_owned(),
        object_type: "Knowledge object",
        warning: object.durability_warning().map(str::to_owned),
    }
}

fn workspace_library(app: &tauri::AppHandle) -> Result<WorkspaceLibrary, String> {
    let documents_directory = app
        .path()
        .document_dir()
        .map_err(|error| format!("The Documents directory is unavailable: {error}"))?;
    migrate_legacy_workspace_library(&documents_directory)?;
    Ok(WorkspaceLibrary::new(
        documents_directory.join(WORKSPACE_LIBRARY_DIRECTORY),
    ))
}

fn migrate_legacy_workspace_library(documents_directory: &Path) -> Result<(), String> {
    let legacy = documents_directory.join(LEGACY_WORKSPACE_LIBRARY_DIRECTORY);
    let current = documents_directory.join(WORKSPACE_LIBRARY_DIRECTORY);
    if !legacy.exists() {
        return Ok(());
    }
    if !current.exists() {
        return fs::rename(&legacy, &current).map_err(|error| {
            format!("The Kaordo workspace library could not be migrated: {error}")
        });
    }

    for entry in fs::read_dir(&legacy)
        .map_err(|error| format!("The previous workspace library could not be read: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("A previous workspace entry could not be read: {error}"))?;
        let destination = current.join(entry.file_name());
        if !destination.exists() {
            fs::rename(entry.path(), destination)
                .map_err(|error| format!("A workspace could not be migrated to Kaordo: {error}"))?;
        }
    }
    if fs::read_dir(&legacy)
        .map_err(|error| format!("The previous workspace library could not be checked: {error}"))?
        .next()
        .is_none()
    {
        fs::remove_dir(&legacy).map_err(|error| {
            format!("The previous empty workspace library could not be removed: {error}")
        })?;
    }
    Ok(())
}

/// Starts the native Kaordo client.
///
/// # Panics
///
/// Panics when Tauri cannot initialize or the application event loop fails.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let auth_client = auth::AuthClient::new().expect("failed to initialize secure authentication");
    tauri::Builder::default()
        .manage(auth_client)
        .invoke_handler(tauri::generate_handler![
            auth::auth_login,
            auth::auth_logout,
            auth::auth_me,
            auth::auth_presence,
            auth::auth_register,
            auth::admin_cloudflare,
            auth::admin_dashboard,
            auth::fluo_bootstrap,
            auth::fluo_node_ids,
            auth::fluo_public_cancel,
            auth::fluo_public_commit,
            auth::fluo_public_release,
            auth::fluo_public_renew,
            auth::fluo_public_reserve,
            auth::fluo_public_storage,
            auth::ligo_acknowledge,
            auth::ligo_acknowledge_conversation_deletions,
            auth::ligo_acknowledge_deletions,
            auth::ligo_bootstrap,
            auth::ligo_confirm_cleanup,
            auth::ligo_create_delivery,
            auth::ligo_delete_conversation,
            auth::ligo_delete_message,
            auth::ligo_history,
            auth::ligo_inbox,
            auth::ligo_live_ticket,
            auth::ligo_mark_read,
            auth::ligo_search_users,
            auth::ligo_update_storage,
            ligo_archive::ligo_open_chat_files,
            ligo_archive::ligo_prepare_chat_files,
            ligo_archive::ligo_write_chat_file_chunk,
            auth::nodo_delete,
            auth::nodo_access,
            auth::nodo_list,
            auth::nodo_quick_test,
            auth::nodo_update_policy,
            auth::nodo_update_spaces,
            auth::rondo_bootstrap,
            auth::rondo_add_node,
            auth::rondo_create_invite,
            auth::rondo_create_room,
            auth::rondo_create_space,
            auth::rondo_delete_room,
            auth::rondo_join_space,
            auth::rondo_remove_node,
            auth::rondo_reorder_nodes,
            auth::rondo_revoke_invite,
            auth::rondo_room_route,
            auth::rondo_space_detail,
            auth::rondo_update_space,
            auth::rondo_voice_ice,
            create_object,
            create_workspace,
            delete_object,
            delete_workspace,
            load_canvas_document,
            list_workspaces,
            open_workspace,
            save_canvas_document,
            update_object_document
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the Kaordo client");
}
