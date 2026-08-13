use std::{
    fmt::Write as _,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use keyring::{Entry, Error as KeyringError};
use pbkdf2::pbkdf2_hmac;
use reqwest::{Client, Method, StatusCode, redirect::Policy};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use tauri::State;
use zeroize::Zeroize;

const API_ORIGIN: &str = concat!(
    "https://",
    "veri",
    "dimensio-api.pshenychnyi-ld.workers.dev"
);
const CLIENT_PASSWORD_ITERATIONS: u32 = 600_000;
const KEYRING_ACCOUNT: &str = "session.v1";
const KEYRING_SERVICE: &str = "io.kaordo.editor.auth";
const LEGACY_KEYRING_SERVICE: &str = concat!("io.", "veri", "dimensio.editor.auth");
const PASSWORD_PROOF_NAMESPACE: &str = concat!("veri", "dimensio:password:v1:");

pub struct AuthClient {
    authenticated: AtomicBool,
    http: Client,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    created_at: i64,
    id: String,
    role: String,
    username: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminDashboard {
    capacity: AdminCapacity,
    generated_at: i64,
    usage: AdminUsage,
    users: Vec<AdminUser>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminCapacity {
    d1: D1Capacity,
    r2: R2Capacity,
    turn: TurnCapacity,
    worker: WorkerCapacity,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct D1Capacity {
    account_storage_bytes: u64,
    database_bytes: u64,
    databases: u64,
    rows_read_daily: u64,
    rows_written_daily: u64,
    time_travel_days: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerCapacity {
    cpu_ms_per_request: u64,
    cron_triggers: u64,
    memory_bytes: u64,
    requests_daily: u64,
    scripts: u64,
    simultaneous_connections: u64,
    startup_ms: u64,
    subrequests_per_request: u64,
    worker_bytes: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_field_names)]
struct R2Capacity {
    class_a_operations_monthly: u64,
    class_b_operations_monthly: u64,
    storage_bytes_monthly: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnCapacity {
    egress_bytes_monthly: u64,
    overage_usd_per_gb: f64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminUsage {
    active_sessions: u64,
    cloudflare: Option<CloudflareUsage>,
    database_bytes: Option<u64>,
    online_users: u64,
    total_users: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareUsage {
    d1: CloudflareD1Usage,
    periods: CloudflarePeriods,
    r2: CloudflareR2Usage,
    sampled_at: i64,
    turn: CloudflareTurnUsage,
    worker: CloudflareWorkerUsage,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudflareD1Usage {
    database_count: u64,
    query_latency_p90_ms: f64,
    read_queries_today: u64,
    response_bytes_today: u64,
    rows_read_today: u64,
    rows_written_today: u64,
    storage_bytes: u64,
    write_queries_today: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudflarePeriods {
    daily_reset_at: i64,
    monthly_started_at: i64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudflareR2Usage {
    bucket_count: u64,
    class_a_operations_this_month: u64,
    class_b_operations_this_month: u64,
    object_count: u64,
    storage_bytes: u64,
    unclassified_operations_this_month: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudflareTurnUsage {
    average_concurrent_connections: f64,
    egress_bytes_this_month: u64,
    ingress_bytes_this_month: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudflareWorkerUsage {
    cpu_time_p50_ms: f64,
    cpu_time_p99_ms: f64,
    errors_today: u64,
    requests_today: u64,
    subrequests_today: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminUser {
    active_sessions: u64,
    created_at: i64,
    id: String,
    last_seen_at: i64,
    online: bool,
    role: String,
    status: String,
    username: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Credentials<'a> {
    device_name: String,
    password_proof: &'a str,
    username: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAuthResponse {
    session_token: String,
    user: AuthUser,
}

#[derive(Deserialize)]
struct UserResponse {
    user: AuthUser,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Deserialize)]
struct OkResponse {
    ok: bool,
}

#[derive(Deserialize)]
struct NodesResponse {
    nodes: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FluoNodesResponse {
    node_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicStorageReservationInput {
    bytes: u64,
    node_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicStorageCommitInput {
    post_id: String,
}

#[derive(Serialize)]
struct PublicStorageRenewInput {
    renew: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RondoCreateInput {
    description: String,
    name: String,
    node_id: Option<String>,
    storage: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RondoJoinInput<'a> {
    invite_code: &'a str,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RondoUpdateInput {
    description: String,
    name: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RondoInviteInput {
    expires_in_days: u32,
    max_uses: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RondoNodeInput {
    node_id: Option<String>,
    storage: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LigoDeliveryInput {
    id: String,
    node_id: String,
    preview: String,
    recipient_username: String,
    size_bytes: u64,
    storage: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LigoCleanupInput<'a> {
    message_ids: &'a [String],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LigoStorageInput<'a> {
    selected_node_id: &'a str,
    stack_limit_bytes: u64,
}


#[derive(Deserialize)]
struct LigoUsersResponse {
    users: Vec<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RondoRoomInput<'a> {
    name: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RondoNodeOrderInput<'a> {
    tier_ids: &'a [String],
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
pub struct NodePolicy {
    allow_downloads: bool,
    allow_uploads: bool,
    charging_only: bool,
    owner_only: bool,
    wifi_only: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
pub struct NodePolicyInput {
    allow_downloads: bool,
    allow_uploads: bool,
    charging_only: bool,
    wifi_only: bool,
}

#[derive(Deserialize)]
struct NodePolicyResponse {
    policy: NodePolicy,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSpacesInput {
    private_quota_bytes: u64,
    public_quota_bytes: u64,
}

#[derive(Deserialize)]
struct NodeSpacesResponse {
    spaces: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeTestResponse {
    requested_at: i64,
}

impl AuthClient {
    pub fn new() -> Result<Self, String> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .redirect(Policy::none())
            .https_only(true)
            .user_agent("Kaordo/0.1 desktop")
            .build()
            .map_err(|_| "The secure authentication client could not start.".to_owned())?;
        Ok(Self {
            authenticated: AtomicBool::new(false),
            http,
        })
    }

    pub(crate) fn require_authenticated(&self) -> Result<(), String> {
        self.authenticated
            .load(Ordering::Acquire)
            .then_some(())
            .ok_or_else(|| "Authentication is required.".to_owned())
    }

    fn set_authenticated(&self, authenticated: bool) {
        self.authenticated.store(authenticated, Ordering::Release);
    }

    async fn authenticate(
        &self,
        path: &str,
        username: &str,
        password_proof: &str,
    ) -> Result<DesktopAuthResponse, String> {
        let response = self
            .http
            .post(format!("{API_ORIGIN}{path}"))
            .json(&Credentials {
                device_name: format!("Kaordo on {}", std::env::consts::OS),
                password_proof,
                username,
            })
            .send()
            .await
            .map_err(|_| "The authentication service could not be reached.".to_owned())?;
        decode_response(response).await
    }

    async fn authorized(
        &self,
        method: Method,
        path: &str,
        token: &str,
    ) -> Result<reqwest::Response, String> {
        self.http
            .request(method, format!("{API_ORIGIN}{path}"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| "The authentication service could not be reached.".to_owned())
    }

    async fn authorized_json<T: Serialize + ?Sized>(
        &self,
        method: Method,
        path: &str,
        token: &str,
        body: &T,
    ) -> Result<reqwest::Response, String> {
        self.http
            .request(method, format!("{API_ORIGIN}{path}"))
            .bearer_auth(token)
            .json(body)
            .send()
            .await
            .map_err(|_| "The Nodo service could not be reached.".to_owned())
    }
}

#[tauri::command]
pub async fn auth_register(
    client: State<'_, AuthClient>,
    username: String,
    password: String,
) -> Result<AuthUser, String> {
    let mut password_proof = derive_password_proof(username.clone(), password).await?;
    let result = client
        .authenticate("/api/auth/desktop/register", &username, &password_proof)
        .await;
    password_proof.zeroize();
    let user = persist_auth_result(result).await?;
    client.set_authenticated(true);
    Ok(user)
}

#[tauri::command]
pub async fn auth_login(
    client: State<'_, AuthClient>,
    username: String,
    password: String,
) -> Result<AuthUser, String> {
    let mut password_proof = derive_password_proof(username.clone(), password).await?;
    let result = client
        .authenticate("/api/auth/desktop/login", &username, &password_proof)
        .await;
    password_proof.zeroize();
    let user = persist_auth_result(result).await?;
    client.set_authenticated(true);
    Ok(user)
}

#[tauri::command]
pub async fn auth_me(client: State<'_, AuthClient>) -> Result<Option<AuthUser>, String> {
    let Some(mut token) = load_session_token().await? else {
        client.set_authenticated(false);
        return Ok(None);
    };
    let response = client.authorized(Method::GET, "/api/auth/me", &token).await;
    token.zeroize();
    let response = response?;
    if response.status() == StatusCode::UNAUTHORIZED {
        client.set_authenticated(false);
        delete_session_token().await?;
        return Ok(None);
    }
    let body = decode_response::<UserResponse>(response).await?;
    client.set_authenticated(true);
    Ok(Some(body.user))
}

#[tauri::command]
pub async fn auth_logout(client: State<'_, AuthClient>) -> Result<(), String> {
    client.set_authenticated(false);
    let Some(mut token) = load_session_token().await? else {
        return Ok(());
    };
    let request_result = client
        .authorized(Method::POST, "/api/auth/logout", &token)
        .await;
    token.zeroize();
    delete_session_token().await?;
    // Local logout is authoritative. If the network is unavailable, the now
    // unreachable server-side token will expire normally.
    let _ = request_result;
    Ok(())
}

#[tauri::command]
pub async fn auth_presence(client: State<'_, AuthClient>) -> Result<(), String> {
    let response = authenticated_request(&client, Method::POST, "/api/auth/presence").await?;
    let body = decode_response::<OkResponse>(response).await?;
    if !body.ok {
        return Err("The presence update was rejected.".to_owned());
    }
    Ok(())
}

#[tauri::command]
pub async fn admin_dashboard(client: State<'_, AuthClient>) -> Result<AdminDashboard, String> {
    let response = authenticated_request(&client, Method::GET, "/api/admin/dashboard").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn admin_cloudflare(
    client: State<'_, AuthClient>,
) -> Result<Option<CloudflareUsage>, String> {
    let response = authenticated_request(&client, Method::GET, "/api/admin/cloudflare").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn nodo_list(client: State<'_, AuthClient>) -> Result<Vec<Value>, String> {
    let response = authenticated_request(&client, Method::GET, "/api/nodes").await?;
    Ok(decode_response::<NodesResponse>(response).await?.nodes)
}

#[tauri::command]
pub async fn fluo_node_ids(client: State<'_, AuthClient>) -> Result<Vec<String>, String> {
    let response = authenticated_request(&client, Method::GET, "/api/fluo/nodes").await?;
    Ok(decode_response::<FluoNodesResponse>(response)
        .await?
        .node_ids)
}

#[tauri::command]
pub async fn fluo_bootstrap(client: State<'_, AuthClient>) -> Result<Value, String> {
    let response = authenticated_request(&client, Method::GET, "/api/fluo/bootstrap").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn fluo_public_storage(client: State<'_, AuthClient>) -> Result<Value, String> {
    let response = authenticated_request(&client, Method::GET, "/api/fluo/public-storage").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_bootstrap(client: State<'_, AuthClient>) -> Result<Value, String> {
    let response = authenticated_request(&client, Method::GET, "/api/rondo/bootstrap").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_voice_ice(client: State<'_, AuthClient>) -> Result<Value, String> {
    let response = authenticated_request(&client, Method::GET, "/api/rondo/voice/ice").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_create_space(
    client: State<'_, AuthClient>,
    input: RondoCreateInput,
) -> Result<Value, String> {
    if input.storage != "public" && input.storage != "private" {
        return Err("Choose a storage location.".to_owned());
    }
    if let Some(node_id) = &input.node_id {
        node_id_path(node_id)?;
    }
    let response =
        authenticated_json_request(&client, Method::POST, "/api/rondo/spaces", &input).await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_join_space(
    client: State<'_, AuthClient>,
    invite_code: String,
) -> Result<Value, String> {
    let response = authenticated_json_request(
        &client,
        Method::POST,
        "/api/rondo/join",
        &RondoJoinInput {
            invite_code: &invite_code,
        },
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_space_detail(
    client: State<'_, AuthClient>,
    space_id: String,
) -> Result<Value, String> {
    let space_id = node_id_path(&space_id)?;
    let response = authenticated_request(
        &client,
        Method::GET,
        &format!("/api/rondo/spaces/{space_id}"),
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_update_space(
    client: State<'_, AuthClient>,
    space_id: String,
    input: RondoUpdateInput,
) -> Result<Value, String> {
    let space_id = node_id_path(&space_id)?;
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        &format!("/api/rondo/spaces/{space_id}"),
        &input,
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_create_invite(
    client: State<'_, AuthClient>,
    space_id: String,
    input: RondoInviteInput,
) -> Result<Value, String> {
    let space_id = node_id_path(&space_id)?;
    let response = authenticated_json_request(
        &client,
        Method::POST,
        &format!("/api/rondo/spaces/{space_id}/invites"),
        &input,
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_revoke_invite(
    client: State<'_, AuthClient>,
    space_id: String,
    invite_id: String,
) -> Result<(), String> {
    let space_id = node_id_path(&space_id)?;
    let invite_id = node_id_path(&invite_id)?;
    let response = authenticated_request(
        &client,
        Method::DELETE,
        &format!("/api/rondo/spaces/{space_id}/invites/{invite_id}"),
    )
    .await?;
    let _: Value = decode_response(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn rondo_create_room(
    client: State<'_, AuthClient>,
    space_id: String,
    name: String,
) -> Result<Value, String> {
    let space_id = node_id_path(&space_id)?;
    let response = authenticated_json_request(
        &client,
        Method::POST,
        &format!("/api/rondo/spaces/{space_id}/rooms"),
        &RondoRoomInput { name: &name },
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_delete_room(
    client: State<'_, AuthClient>,
    space_id: String,
    room_id: String,
) -> Result<(), String> {
    let space_id = node_id_path(&space_id)?;
    let room_id = node_id_path(&room_id)?;
    let response = authenticated_request(
        &client,
        Method::DELETE,
        &format!("/api/rondo/spaces/{space_id}/rooms/{room_id}"),
    )
    .await?;
    let _: Value = decode_response(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn rondo_room_route(
    client: State<'_, AuthClient>,
    space_id: String,
    room_id: String,
) -> Result<Value, String> {
    let space_id = node_id_path(&space_id)?;
    let room_id = node_id_path(&room_id)?;
    let response = authenticated_request(
        &client,
        Method::GET,
        &format!("/api/rondo/spaces/{space_id}/rooms/{room_id}/route"),
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_add_node(
    client: State<'_, AuthClient>,
    space_id: String,
    input: RondoNodeInput,
) -> Result<Value, String> {
    let space_id = node_id_path(&space_id)?;
    if input.storage != "public" && input.storage != "private" {
        return Err("Choose a Nodo storage type.".to_owned());
    }
    if let Some(node_id) = &input.node_id {
        node_id_path(node_id)?;
    }
    let response = authenticated_json_request(
        &client,
        Method::POST,
        &format!("/api/rondo/spaces/{space_id}/nodes"),
        &input,
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_reorder_nodes(
    client: State<'_, AuthClient>,
    space_id: String,
    tier_ids: Vec<String>,
) -> Result<Value, String> {
    let space_id = node_id_path(&space_id)?;
    for tier_id in &tier_ids {
        node_id_path(tier_id)?;
    }
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        &format!("/api/rondo/spaces/{space_id}/nodes"),
        &RondoNodeOrderInput {
            tier_ids: &tier_ids,
        },
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn rondo_remove_node(
    client: State<'_, AuthClient>,
    space_id: String,
    tier_id: String,
) -> Result<(), String> {
    let space_id = node_id_path(&space_id)?;
    let tier_id = node_id_path(&tier_id)?;
    let response = authenticated_request(
        &client,
        Method::DELETE,
        &format!("/api/rondo/spaces/{space_id}/nodes/{tier_id}"),
    )
    .await?;
    let _: Value = decode_response(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn ligo_bootstrap(
    client: State<'_, AuthClient>,
    cursor: Option<String>,
    limit: u32,
) -> Result<Value, String> {
    let path = paged_path("/api/ligo/bootstrap", "before", cursor.as_deref(), limit)?;
    let response = authenticated_request(&client, Method::GET, &path).await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ligo_inbox(
    client: State<'_, AuthClient>,
    cursor: Option<String>,
    limit: u32,
) -> Result<Value, String> {
    let path = paged_path("/api/ligo/inbox", "after", cursor.as_deref(), limit)?;
    let response = authenticated_request(&client, Method::GET, &path).await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ligo_history(
    client: State<'_, AuthClient>,
    username: String,
    owner: String,
    cursor: Option<String>,
    limit: u32,
) -> Result<Value, String> {
    let username = username.trim().to_lowercase();
    if username.is_empty()
        || username.len() > 32
        || !username
            .chars()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == '_')
    {
        return Err("Ligo history user is invalid.".to_owned());
    }
    if owner != "peer" && owner != "self" {
        return Err("Ligo history owner is invalid.".to_owned());
    }
    let mut path = paged_path(
        &format!("/api/ligo/history/{username}"),
        "before",
        cursor.as_deref(),
        limit,
    )?;
    write!(path, "&owner={owner}").expect("writing an owner to a String cannot fail");
    let response = authenticated_request(&client, Method::GET, &path).await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ligo_live_ticket(client: State<'_, AuthClient>) -> Result<Value, String> {
    let response = authenticated_request(&client, Method::POST, "/api/ligo/live-ticket").await?;
    decode_response(response).await
}


#[tauri::command]
pub async fn ligo_search_users(
    client: State<'_, AuthClient>,
    query: String,
) -> Result<Vec<Value>, String> {
    let normalized = query.trim().to_lowercase();
    if normalized.is_empty()
        || normalized.len() > 32
        || !normalized
            .chars()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == '_')
    {
        return Ok(Vec::new());
    }
    let response = authenticated_request(
        &client,
        Method::GET,
        &format!("/api/ligo/users?q={normalized}"),
    )
    .await?;
    Ok(decode_response::<LigoUsersResponse>(response).await?.users)
}

#[tauri::command]
pub async fn ligo_create_delivery(
    client: State<'_, AuthClient>,
    input: LigoDeliveryInput,
) -> Result<Value, String> {
    node_id_path(&input.id)?;
    node_id_path(&input.node_id)?;
    if input.storage != "public" && input.storage != "private" {
        return Err("Message storage is invalid.".to_owned());
    }
    let response =
        authenticated_json_request(&client, Method::POST, "/api/ligo/deliveries", &input).await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ligo_update_storage(
    client: State<'_, AuthClient>,
    selected_node_id: String,
    stack_limit_bytes: u64,
) -> Result<Value, String> {
    if selected_node_id != "public" {
        node_id_path(&selected_node_id)?;
    }
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        "/api/ligo/storage",
        &LigoStorageInput { selected_node_id: &selected_node_id, stack_limit_bytes },
    ).await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ligo_confirm_cleanup(
    client: State<'_, AuthClient>,
    message_ids: Vec<String>,
) -> Result<(), String> {
    if message_ids.len() > 64 || message_ids.iter().any(|id| node_id_path(id).is_err()) {
        return Err("Ligo cleanup is invalid.".to_owned());
    }
    let response = authenticated_json_request(
        &client,
        Method::POST,
        "/api/ligo/cloud-cleanup",
        &LigoCleanupInput { message_ids: &message_ids },
    ).await?;
    let _: Value = decode_response(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn ligo_acknowledge(
    client: State<'_, AuthClient>,
    delivery_id: String,
) -> Result<(), String> {
    let delivery_id = node_id_path(&delivery_id)?;
    let response = authenticated_request(
        &client,
        Method::DELETE,
        &format!("/api/ligo/deliveries/{delivery_id}"),
    )
    .await?;
    let _: Value = decode_response(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn fluo_public_reserve(
    client: State<'_, AuthClient>,
    node_id: String,
    bytes: u64,
) -> Result<Value, String> {
    let node_id = node_id_path(&node_id)?;
    let response = authenticated_json_request(
        &client,
        Method::POST,
        "/api/fluo/public-storage/reservations",
        &PublicStorageReservationInput { bytes, node_id },
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn fluo_public_commit(
    client: State<'_, AuthClient>,
    reservation_id: String,
    post_id: String,
) -> Result<(), String> {
    let reservation_id = node_id_path(&reservation_id)?;
    let post_id = node_id_path(&post_id)?;
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        &format!("/api/fluo/public-storage/reservations/{reservation_id}"),
        &PublicStorageCommitInput { post_id },
    )
    .await?;
    let _: Value = decode_response(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn fluo_public_renew(
    client: State<'_, AuthClient>,
    reservation_id: String,
) -> Result<Value, String> {
    let reservation_id = node_id_path(&reservation_id)?;
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        &format!("/api/fluo/public-storage/reservations/{reservation_id}"),
        &PublicStorageRenewInput { renew: true },
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn fluo_public_cancel(
    client: State<'_, AuthClient>,
    reservation_id: String,
) -> Result<(), String> {
    let reservation_id = node_id_path(&reservation_id)?;
    let response = authenticated_request(
        &client,
        Method::DELETE,
        &format!("/api/fluo/public-storage/reservations/{reservation_id}"),
    )
    .await?;
    let _: Value = decode_response(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn fluo_public_release(
    client: State<'_, AuthClient>,
    node_id: String,
    post_id: String,
) -> Result<(), String> {
    let node_id = node_id_path(&node_id)?;
    let post_id = node_id_path(&post_id)?;
    let response = authenticated_request(
        &client,
        Method::DELETE,
        &format!("/api/fluo/public-storage/posts/{node_id}/{post_id}"),
    )
    .await?;
    let _: Value = decode_response(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn nodo_access(client: State<'_, AuthClient>, node_id: String) -> Result<Value, String> {
    let node_id = node_id_path(&node_id)?;
    let response = authenticated_request(
        &client,
        Method::POST,
        &format!("/api/nodes/{node_id}/access"),
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn nodo_delete(client: State<'_, AuthClient>, node_id: String) -> Result<(), String> {
    let node_id = node_id_path(&node_id)?;
    let response =
        authenticated_request(&client, Method::DELETE, &format!("/api/nodes/{node_id}")).await?;
    let body = decode_response::<OkResponse>(response).await?;
    body.ok
        .then_some(())
        .ok_or_else(|| "Nodo removal was rejected.".to_owned())
}

#[tauri::command]
pub async fn nodo_quick_test(
    client: State<'_, AuthClient>,
    node_id: String,
) -> Result<i64, String> {
    let node_id = node_id_path(&node_id)?;
    let response =
        authenticated_request(&client, Method::POST, &format!("/api/nodes/{node_id}/test")).await?;
    Ok(decode_response::<NodeTestResponse>(response)
        .await?
        .requested_at)
}

#[tauri::command]
pub async fn nodo_update_policy(
    client: State<'_, AuthClient>,
    node_id: String,
    policy: NodePolicyInput,
) -> Result<NodePolicy, String> {
    let node_id = node_id_path(&node_id)?;
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        &format!("/api/nodes/{node_id}"),
        &policy,
    )
    .await?;
    Ok(decode_response::<NodePolicyResponse>(response)
        .await?
        .policy)
}

#[tauri::command]
pub async fn nodo_update_spaces(
    client: State<'_, AuthClient>,
    node_id: String,
    spaces: NodeSpacesInput,
) -> Result<Value, String> {
    let node_id = node_id_path(&node_id)?;
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        &format!("/api/nodes/{node_id}/spaces"),
        &spaces,
    )
    .await?;
    Ok(decode_response::<NodeSpacesResponse>(response)
        .await?
        .spaces)
}

async fn authenticated_request(
    client: &AuthClient,
    method: Method,
    path: &str,
) -> Result<reqwest::Response, String> {
    client.require_authenticated()?;
    let Some(mut token) = load_session_token().await? else {
        client.set_authenticated(false);
        return Err("Authentication is required.".to_owned());
    };
    let response = client.authorized(method, path, &token).await;
    token.zeroize();
    let response = response?;
    if response.status() == StatusCode::UNAUTHORIZED {
        client.set_authenticated(false);
        delete_session_token().await?;
        return Err("Authentication is required.".to_owned());
    }
    Ok(response)
}

fn paged_path(
    base: &str,
    cursor_name: &str,
    cursor: Option<&str>,
    limit: u32,
) -> Result<String, String> {
    if !(1..=50).contains(&limit) {
        return Err("Page limit is invalid.".to_owned());
    }
    let mut path = format!("{base}?limit={limit}");
    if let Some(value) = cursor {
        let Some((timestamp, id)) = value.split_once(':') else {
            return Err("Page cursor is invalid.".to_owned());
        };
        if timestamp.parse::<u64>().is_err() || uuid::Uuid::parse_str(id).is_err() {
            return Err("Page cursor is invalid.".to_owned());
        }
        write!(path, "&{cursor_name}={timestamp}:{id}")
            .expect("writing a cursor to a String cannot fail");
    }
    Ok(path)
}

async fn authenticated_json_request<T: Serialize + ?Sized>(
    client: &AuthClient,
    method: Method,
    path: &str,
    body: &T,
) -> Result<reqwest::Response, String> {
    client.require_authenticated()?;
    let Some(mut token) = load_session_token().await? else {
        client.set_authenticated(false);
        return Err("Authentication is required.".to_owned());
    };
    let response = client.authorized_json(method, path, &token, body).await;
    token.zeroize();
    let response = response?;
    if response.status() == StatusCode::UNAUTHORIZED {
        client.set_authenticated(false);
        delete_session_token().await?;
        return Err("Authentication is required.".to_owned());
    }
    Ok(response)
}

fn node_id_path(value: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| "The node identifier is invalid.".to_owned())
}

async fn persist_auth_result(
    result: Result<DesktopAuthResponse, String>,
) -> Result<AuthUser, String> {
    let DesktopAuthResponse {
        session_token,
        user,
    } = result?;
    store_session_token(session_token).await?;
    Ok(user)
}

async fn decode_response<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
) -> Result<T, String> {
    if response.status().is_success() {
        return response
            .json()
            .await
            .map_err(|_| "The authentication service returned an invalid response.".to_owned());
    }
    Err(server_error(response).await)
}

async fn server_error(response: reqwest::Response) -> String {
    if response.status().is_server_error() {
        return "The authentication service is unavailable.".to_owned();
    }
    response.json::<ErrorResponse>().await.map_or_else(
        |_| "The authentication request was rejected.".to_owned(),
        |body| body.error,
    )
}

async fn store_session_token(mut token: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = session_entry().and_then(|entry| entry.set_password(&token));
        token.zeroize();
        result.map_err(keyring_error)
    })
    .await
    .map_err(|_| "The secure session storage task failed.".to_owned())?
}

async fn load_session_token() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let current = session_entry()?;
        match current.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(KeyringError::NoEntry) => match legacy_session_entry()?.get_password() {
                Ok(token) => {
                    current.set_password(&token)?;
                    let _ = legacy_session_entry()?.delete_credential();
                    Ok(Some(token))
                }
                Err(KeyringError::NoEntry) => Ok(None),
                Err(error) => Err(error),
            },
            Err(error) => Err(error),
        }
    })
    .await
    .map_err(|_| "The secure session storage task failed.".to_owned())?
    .map_err(keyring_error)
}

async fn delete_session_token() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        for entry in [session_entry()?, legacy_session_entry()?] {
            match entry.delete_credential() {
                Ok(()) | Err(KeyringError::NoEntry) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    })
    .await
    .map_err(|_| "The secure session storage task failed.".to_owned())?
    .map_err(keyring_error)
}

fn session_entry() -> Result<Entry, KeyringError> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
}

fn legacy_session_entry() -> Result<Entry, KeyringError> {
    Entry::new(LEGACY_KEYRING_SERVICE, KEYRING_ACCOUNT)
}

fn keyring_error(_error: KeyringError) -> String {
    "The operating system's secure session storage is unavailable.".to_owned()
}

async fn derive_password_proof(username: String, mut password: String) -> Result<String, String> {
    if !(12..=128).contains(&password.chars().count()) || password.len() > 256 {
        password.zeroize();
        return Err("Password must be 12–128 characters.".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let encoded = password_proof(&username, &password);
        password.zeroize();
        encoded
    })
    .await
    .map_err(|_| "The password protection task failed.".to_owned())
}

fn password_proof(username: &str, password: &str) -> String {
    let salt = format!(
        "{PASSWORD_PROOF_NAMESPACE}{}",
        username.trim().to_ascii_lowercase()
    );
    let mut proof = [0_u8; 32];
    pbkdf2_hmac::<Sha256>(
        password.as_bytes(),
        salt.as_bytes(),
        CLIENT_PASSWORD_ITERATIONS,
        &mut proof,
    );
    let encoded = URL_SAFE_NO_PAD.encode(proof);
    proof.zeroize();
    encoded
}

#[cfg(test)]
mod tests {
    use super::{AuthClient, password_proof};

    #[test]
    fn native_commands_stay_locked_until_authentication() {
        let client = AuthClient::new().expect("auth client");
        assert_eq!(
            client.require_authenticated(),
            Err("Authentication is required.".to_owned())
        );
        client.set_authenticated(true);
        assert_eq!(client.require_authenticated(), Ok(()));
    }

    #[test]
    fn password_proof_matches_the_web_crypto_protocol() {
        assert_eq!(
            password_proof("Desktop_User", "correct horse battery staple"),
            "UPVGAoDwvj31lR6DX86rkIvuk8ow4UVe5_44yhvXSlE"
        );
    }
}
