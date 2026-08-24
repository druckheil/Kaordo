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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsernameChangeRequest<'a> {
    new_password_proof: &'a str,
    password_proof: &'a str,
    username: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PasswordChangeRequest<'a> {
    current_password_proof: &'a str,
    new_password_proof: &'a str,
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
pub struct ProfileCommitInput {
    avatar_file_id: Option<String>,
    avatar_mime_type: Option<String>,
    avatar_size: u64,
    profile_file_id: String,
    profile_size: u64,
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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IloCardInput {
    article: String,
    example: String,
    german: String,
    note: String,
    plural: String,
    theme: String,
    translation: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaglibroPlanInput {
    accent: bool,
    created_date: Option<String>,
    id: String,
    text: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaglibroDiaryInput {
    mood: String,
    plan_state: Value,
    text: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaglibroDayInput {
    date: String,
    diary: TaglibroDiaryInput,
    plans: Vec<TaglibroPlanInput>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaglibroEventInput {
    description: String,
    event_at: String,
    notify_at_event_time: bool,
    remind_offset_min: Option<u32>,
    reminder_enabled: bool,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LigoCleanupInput<'a> {
    message_ids: &'a [String],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LigoConversationCleanupInput<'a> {
    peer_usernames: &'a [String],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LigoReadInput<'a> {
    message_ids: &'a [String],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LigoDeleteInput<'a> {
    peer_username: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LigoStorageInput<'a> {
    selected_node_id: &'a str,
    stack_limit_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IloGradeInput<'a> {
    action: &'a str,
    card_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IloDeleteCardsInput<'a> {
    card_ids: &'a [String],
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeRenameInput {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeNameResponse {
    device_name: String,
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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeQuickTest {
    battery_percent: Option<u8>,
    charging: Option<bool>,
    completed_at: i64,
    coordinator_latency_ms: u64,
    disk_read_bps: u64,
    disk_write_bps: u64,
    memory_available_bytes: u64,
    memory_total_bytes: u64,
    network_down_bps: Option<u64>,
    network_metered: Option<bool>,
    network_type: String,
    network_up_bps: Option<u64>,
    storage_available_bytes: u64,
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
    let mut password_proof = derive_password_proof(username.clone(), password, true).await?;
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
    let mut password_proof = derive_password_proof(username.clone(), password, false).await?;
    let result = client
        .authenticate("/api/auth/desktop/login", &username, &password_proof)
        .await;
    password_proof.zeroize();
    let user = persist_auth_result(result).await?;
    client.set_authenticated(true);
    Ok(user)
}

#[tauri::command]
pub async fn auth_change_username(
    client: State<'_, AuthClient>,
    current_username: String,
    new_username: String,
    current_password: String,
) -> Result<AuthUser, String> {
    let mut password_proof =
        derive_password_proof(current_username.clone(), current_password.clone(), false).await?;
    let mut new_password_proof =
        derive_password_proof(new_username.clone(), current_password, false).await?;
    let body = UsernameChangeRequest {
        new_password_proof: &new_password_proof,
        password_proof: &password_proof,
        username: &new_username,
    };
    let result = match authenticated_json_request(
        &client,
        Method::PATCH,
        "/api/auth/account/username",
        &body,
    )
    .await
    {
        Ok(response) => decode_response::<UserResponse>(response).await,
        Err(error) => Err(error),
    };
    password_proof.zeroize();
    new_password_proof.zeroize();
    Ok(result?.user)
}

#[tauri::command]
pub async fn auth_change_password(
    client: State<'_, AuthClient>,
    username: String,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    let mut current_password_proof =
        derive_password_proof(username.clone(), current_password, false).await?;
    let mut new_password_proof = derive_password_proof(username, new_password, true).await?;
    let body = PasswordChangeRequest {
        current_password_proof: &current_password_proof,
        new_password_proof: &new_password_proof,
    };
    let result = match authenticated_json_request(
        &client,
        Method::PATCH,
        "/api/auth/account/password",
        &body,
    )
    .await
    {
        Ok(response) => decode_response::<OkResponse>(response).await,
        Err(error) => Err(error),
    };
    current_password_proof.zeroize();
    new_password_proof.zeroize();
    if !result?.ok {
        return Err("The password change was rejected.".to_owned());
    }
    Ok(())
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
pub async fn auth_sessions(client: State<'_, AuthClient>) -> Result<Value, String> {
    let response = authenticated_request(&client, Method::GET, "/api/auth/sessions").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn auth_terminate_session(
    client: State<'_, AuthClient>,
    session_id: String,
) -> Result<(), String> {
    let path = session_id_path(&session_id)?;
    let response = authenticated_request(&client, Method::DELETE, &path).await?;
    let body = decode_response::<OkResponse>(response).await?;
    if !body.ok {
        return Err("The session could not be terminated.".to_owned());
    }
    Ok(())
}

#[tauri::command]
pub async fn admin_dashboard(
    client: State<'_, AuthClient>,
    force_refresh: Option<bool>,
) -> Result<AdminDashboard, String> {
    let path = admin_path("/api/admin/dashboard", force_refresh);
    let response = authenticated_request(&client, Method::GET, &path).await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn admin_cloudflare(
    client: State<'_, AuthClient>,
    force_refresh: Option<bool>,
) -> Result<Option<CloudflareUsage>, String> {
    let path = admin_path("/api/admin/cloudflare", force_refresh);
    let response = authenticated_request(&client, Method::GET, &path).await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn admin_ban_user(
    client: State<'_, AuthClient>,
    user_id: String,
) -> Result<Value, String> {
    admin_moderate_user(&client, &user_id, "ban").await
}

#[tauri::command]
pub async fn admin_unban_user(
    client: State<'_, AuthClient>,
    user_id: String,
) -> Result<Value, String> {
    admin_moderate_user(&client, &user_id, "unban").await
}

#[tauri::command]
pub async fn admin_erase_user(
    client: State<'_, AuthClient>,
    user_id: String,
) -> Result<Value, String> {
    admin_moderate_user(&client, &user_id, "erase").await
}

async fn admin_moderate_user(
    client: &AuthClient,
    user_id: &str,
    action: &str,
) -> Result<Value, String> {
    let user_id = user_id_path(user_id)?;
    let response = authenticated_request(
        client,
        Method::POST,
        &format!("/api/admin/users/{user_id}/{action}"),
    )
    .await?;
    decode_response(response).await
}

fn admin_path(path: &str, force_refresh: Option<bool>) -> String {
    if force_refresh.unwrap_or(false) {
        format!("{path}?fresh=1")
    } else {
        path.to_owned()
    }
}

fn user_id_path(value: &str) -> Result<String, String> {
    if value.len() != 22
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("The user identifier is invalid.".to_owned());
    }
    Ok(value.to_owned())
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
pub async fn ligo_mark_read(
    client: State<'_, AuthClient>,
    message_ids: Vec<String>,
) -> Result<(), String> {
    if message_ids.len() > 64 || message_ids.iter().any(|id| node_id_path(id).is_err()) {
        return Err("Ligo read receipts are invalid.".to_owned());
    }
    let response = authenticated_json_request(
        &client,
        Method::POST,
        "/api/ligo/read",
        &LigoReadInput {
            message_ids: &message_ids,
        },
    )
    .await?;
    let _: Value = decode_response(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn ligo_acknowledge_deletions(
    client: State<'_, AuthClient>,
    message_ids: Vec<String>,
) -> Result<(), String> {
    if message_ids.len() > 64 || message_ids.iter().any(|id| node_id_path(id).is_err()) {
        return Err("Ligo deletion receipts are invalid.".to_owned());
    }
    let response = authenticated_json_request(
        &client,
        Method::POST,
        "/api/ligo/deletions/ack",
        &LigoCleanupInput {
            message_ids: &message_ids,
        },
    )
    .await?;
    let _: Value = decode_response(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn ligo_acknowledge_conversation_deletions(
    client: State<'_, AuthClient>,
    peer_usernames: Vec<String>,
) -> Result<(), String> {
    if peer_usernames.len() > 64
        || peer_usernames.iter().any(|username| {
            username.is_empty()
                || username.len() > 32
                || !username.chars().all(|value| {
                    value.is_ascii_lowercase() || value.is_ascii_digit() || value == '_'
                })
        })
    {
        return Err("Ligo conversation deletion receipts are invalid.".to_owned());
    }
    let response = authenticated_json_request(
        &client,
        Method::POST,
        "/api/ligo/conversation-deletions/ack",
        &LigoConversationCleanupInput {
            peer_usernames: &peer_usernames,
        },
    )
    .await?;
    let _: Value = decode_response(response).await?;
    Ok(())
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
pub async fn ligo_delete_message(
    client: State<'_, AuthClient>,
    message_id: String,
    peer_username: String,
) -> Result<Value, String> {
    let message_id = node_id_path(&message_id)?;
    let peer_username = peer_username.trim().to_lowercase();
    if peer_username.is_empty()
        || peer_username.len() > 32
        || !peer_username
            .chars()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == '_')
    {
        return Err("Ligo message recipient is invalid.".to_owned());
    }
    let response = authenticated_json_request(
        &client,
        Method::DELETE,
        &format!("/api/ligo/messages/{message_id}"),
        &LigoDeleteInput {
            peer_username: &peer_username,
        },
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ligo_delete_conversation(
    client: State<'_, AuthClient>,
    peer_username: String,
) -> Result<Value, String> {
    let peer_username = peer_username.trim().to_lowercase();
    if peer_username.is_empty()
        || peer_username.len() > 32
        || !peer_username
            .chars()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == '_')
    {
        return Err("Ligo conversation user is invalid.".to_owned());
    }
    let response = authenticated_request(
        &client,
        Method::DELETE,
        &format!("/api/ligo/conversations/{peer_username}"),
    )
    .await?;
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
        &LigoStorageInput {
            selected_node_id: &selected_node_id,
            stack_limit_bytes,
        },
    )
    .await?;
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
        &LigoCleanupInput {
            message_ids: &message_ids,
        },
    )
    .await?;
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
pub async fn ilo_bootstrap(client: State<'_, AuthClient>) -> Result<Value, String> {
    let response = authenticated_request(&client, Method::GET, "/api/ilo/bootstrap").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_cards(
    client: State<'_, AuthClient>,
    q: String,
    theme: String,
    offset: u32,
    limit: u32,
) -> Result<Value, String> {
    if !(1..=100).contains(&limit) || offset > 100_000 {
        return Err("Ilo card page is invalid.".to_owned());
    }
    if q.chars().count() > 64 || theme.chars().count() > 32 {
        return Err("Ilo card search is invalid.".to_owned());
    }
    let path = format!(
        "/api/ilo/cards?limit={limit}&offset={offset}&q={}&theme={}",
        query_escape(&q),
        query_escape(&theme),
    );
    let response = authenticated_request(&client, Method::GET, &path).await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_create_card(
    client: State<'_, AuthClient>,
    input: IloCardInput,
) -> Result<Value, String> {
    validate_ilo_card(&input)?;
    let response =
        authenticated_json_request(&client, Method::POST, "/api/ilo/cards", &input).await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_update_card(
    client: State<'_, AuthClient>,
    card_id: String,
    input: IloCardInput,
) -> Result<Value, String> {
    ilo_card_id(&card_id)?;
    validate_ilo_card(&input)?;
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        &format!("/api/ilo/cards/{card_id}"),
        &input,
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_delete_card(
    client: State<'_, AuthClient>,
    card_id: String,
) -> Result<Value, String> {
    ilo_card_id(&card_id)?;
    let response = authenticated_request(
        &client,
        Method::DELETE,
        &format!("/api/ilo/cards/{card_id}"),
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_delete_cards(
    client: State<'_, AuthClient>,
    card_ids: Vec<String>,
) -> Result<Value, String> {
    if card_ids.is_empty() || card_ids.len() > 100 {
        return Err("The Ilo card selection is invalid.".to_owned());
    }
    for card_id in &card_ids {
        ilo_card_id(card_id)?;
    }
    let response = authenticated_json_request(
        &client,
        Method::DELETE,
        "/api/ilo/cards",
        &IloDeleteCardsInput {
            card_ids: &card_ids,
        },
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_train_next(client: State<'_, AuthClient>) -> Result<Value, String> {
    let response = authenticated_request(&client, Method::GET, "/api/ilo/train/next").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_grade(
    client: State<'_, AuthClient>,
    card_id: String,
    action: String,
) -> Result<Value, String> {
    ilo_card_id(&card_id)?;
    if action != "remember" && action != "forgot" {
        return Err("Ilo training grade is invalid.".to_owned());
    }
    let response = authenticated_json_request(
        &client,
        Method::POST,
        "/api/ilo/train/grade",
        &IloGradeInput {
            action: &action,
            card_id: &card_id,
        },
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_progress(client: State<'_, AuthClient>) -> Result<Value, String> {
    let response = authenticated_request(&client, Method::GET, "/api/ilo/progress").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_taglibro_bootstrap(client: State<'_, AuthClient>) -> Result<Value, String> {
    let response =
        authenticated_request(&client, Method::GET, "/api/ilo/taglibro/bootstrap").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_taglibro_day(
    client: State<'_, AuthClient>,
    date: String,
) -> Result<Value, String> {
    taglibro_date(&date)?;
    let response = authenticated_request(
        &client,
        Method::GET,
        &format!("/api/ilo/taglibro/day?date={}", query_escape(&date)),
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_taglibro_save_plans(
    client: State<'_, AuthClient>,
    date: String,
    plans: Vec<TaglibroPlanInput>,
) -> Result<Value, String> {
    taglibro_date(&date)?;
    validate_taglibro_plans(&plans)?;
    let response = authenticated_json_request(
        &client,
        Method::PUT,
        "/api/ilo/taglibro/plans",
        &serde_json::json!({ "date": date, "plans": plans }),
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_taglibro_save_diary(
    client: State<'_, AuthClient>,
    date: String,
    diary: TaglibroDiaryInput,
) -> Result<Value, String> {
    taglibro_date(&date)?;
    validate_taglibro_diary(&diary)?;
    let response = authenticated_json_request(
        &client,
        Method::PUT,
        "/api/ilo/taglibro/diary",
        &serde_json::json!({ "date": date, "diary": diary }),
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_taglibro_save_day(
    client: State<'_, AuthClient>,
    input: TaglibroDayInput,
) -> Result<Value, String> {
    taglibro_date(&input.date)?;
    validate_taglibro_plans(&input.plans)?;
    validate_taglibro_diary(&input.diary)?;
    let response =
        authenticated_json_request(&client, Method::PUT, "/api/ilo/taglibro/day", &input).await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_taglibro_events(
    client: State<'_, AuthClient>,
    include_past: bool,
) -> Result<Value, String> {
    let response = authenticated_request(
        &client,
        Method::GET,
        &format!(
            "/api/ilo/taglibro/events?includePast={}",
            i32::from(include_past)
        ),
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_taglibro_create_event(
    client: State<'_, AuthClient>,
    input: TaglibroEventInput,
) -> Result<Value, String> {
    validate_taglibro_event(&input)?;
    let response =
        authenticated_json_request(&client, Method::POST, "/api/ilo/taglibro/events", &input)
            .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_taglibro_update_event(
    client: State<'_, AuthClient>,
    event_id: String,
    input: TaglibroEventInput,
) -> Result<Value, String> {
    taglibro_id(&event_id)?;
    validate_taglibro_event(&input)?;
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        &format!("/api/ilo/taglibro/events/{event_id}"),
        &input,
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn ilo_taglibro_delete_event(
    client: State<'_, AuthClient>,
    event_id: String,
) -> Result<(), String> {
    taglibro_id(&event_id)?;
    let response = authenticated_request(
        &client,
        Method::DELETE,
        &format!("/api/ilo/taglibro/events/{event_id}"),
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
pub async fn profile_get(client: State<'_, AuthClient>) -> Result<Value, String> {
    let response = authenticated_request(&client, Method::GET, "/api/profile").await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn profile_reserve(
    client: State<'_, AuthClient>,
    node_id: String,
    bytes: u64,
) -> Result<Value, String> {
    let node_id = node_id_path(&node_id)?;
    if bytes == 0 || bytes > 4_227_072 {
        return Err("Profile storage reservation is invalid.".to_owned());
    }
    let response = authenticated_json_request(
        &client,
        Method::POST,
        "/api/profile/reservations",
        &serde_json::json!({ "bytes": bytes, "nodeId": node_id }),
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn profile_commit(
    client: State<'_, AuthClient>,
    reservation_id: String,
    input: ProfileCommitInput,
) -> Result<Value, String> {
    let reservation_id = node_id_path(&reservation_id)?;
    if input.profile_file_id.is_empty()
        || input.profile_size == 0
        || input.avatar_size > 4 * 1024 * 1024
    {
        return Err("Profile payload is invalid.".to_owned());
    }
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        &format!("/api/profile/reservations/{reservation_id}"),
        &input,
    )
    .await?;
    decode_response(response).await
}

#[tauri::command]
pub async fn profile_cancel(
    client: State<'_, AuthClient>,
    reservation_id: String,
) -> Result<(), String> {
    let reservation_id = node_id_path(&reservation_id)?;
    let response = authenticated_request(
        &client,
        Method::DELETE,
        &format!("/api/profile/reservations/{reservation_id}"),
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
pub async fn nodo_rename(
    client: State<'_, AuthClient>,
    node_id: String,
    name: String,
) -> Result<String, String> {
    let node_id = node_id_path(&node_id)?;
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        &format!("/api/nodes/{node_id}/name"),
        &NodeRenameInput { name },
    )
    .await?;
    Ok(decode_response::<NodeNameResponse>(response)
        .await?
        .device_name)
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
pub async fn nodo_complete_quick_test(
    client: State<'_, AuthClient>,
    node_id: String,
    result: NodeQuickTest,
) -> Result<NodeQuickTest, String> {
    let node_id = node_id_path(&node_id)?;
    let response = authenticated_json_request(
        &client,
        Method::PATCH,
        &format!("/api/nodes/{node_id}/test"),
        &result,
    )
    .await?;
    decode_response(response).await
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

fn validate_ilo_card(input: &IloCardInput) -> Result<(), String> {
    if input.german.trim().is_empty()
        || input.german.chars().count() > 256
        || input.translation.trim().is_empty()
        || input.translation.chars().count() > 512
        || input.article.chars().count() > 64
        || input.plural.chars().count() > 256
        || input.example.chars().count() > 512
        || input.note.chars().count() > 512
    {
        return Err("Ilo card fields are invalid.".to_owned());
    }
    Ok(())
}

fn taglibro_date(value: &str) -> Result<(), String> {
    if value.len() != 10
        || value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
        || !value
            .bytes()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
    {
        return Err("The Taglibroplanilo date is invalid.".to_owned());
    }
    Ok(())
}

fn taglibro_id(value: &str) -> Result<(), String> {
    if !(8..=32).contains(&value.len()) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The Taglibroplanilo identifier is invalid.".to_owned());
    }
    Ok(())
}

fn validate_taglibro_plans(plans: &[TaglibroPlanInput]) -> Result<(), String> {
    if plans.len() > 80 {
        return Err("Too many Taglibroplanilo plans.".to_owned());
    }
    for plan in plans {
        taglibro_id(&plan.id)?;
        if plan.text.chars().count() > 512 {
            return Err("A Taglibroplanilo plan is too long.".to_owned());
        }
    }
    Ok(())
}

fn validate_taglibro_diary(diary: &TaglibroDiaryInput) -> Result<(), String> {
    if diary.text.chars().count() > 16_000 || diary.mood.chars().count() > 8 {
        return Err("Taglibroplanilo diary content is invalid.".to_owned());
    }
    Ok(())
}

fn validate_taglibro_event(input: &TaglibroEventInput) -> Result<(), String> {
    if input.title.trim().is_empty() || input.title.chars().count() > 256 {
        return Err("Taglibroplanilo event title is invalid.".to_owned());
    }
    if input.description.chars().count() > 2_000 || input.event_at.trim().is_empty() {
        return Err("Taglibroplanilo event details are invalid.".to_owned());
    }
    if input.reminder_enabled {
        let Some(offset) = input.remind_offset_min else {
            return Err("Taglibroplanilo reminder interval is invalid.".to_owned());
        };
        if !(1..=43_200).contains(&offset) {
            return Err("Taglibroplanilo reminder interval is invalid.".to_owned());
        }
    }
    Ok(())
}

fn ilo_card_id(value: &str) -> Result<(), String> {
    if !(8..=32).contains(&value.len()) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The Ilo card identifier is invalid.".to_owned());
    }
    Ok(())
}

fn query_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            escaped.push(char::from(*byte));
        } else {
            write!(escaped, "%{byte:02X}").expect("writing query escape cannot fail");
        }
    }
    escaped
}

fn node_id_path(value: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| "The node identifier is invalid.".to_owned())
}

fn session_id_path(value: &str) -> Result<String, String> {
    if value.len() != 43
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("The session identifier is invalid.".to_owned());
    }
    Ok(format!("/api/auth/sessions/{value}"))
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

async fn derive_password_proof(
    username: String,
    mut password: String,
    registration: bool,
) -> Result<String, String> {
    let maximum = if registration { 32 } else { 128 };
    if !(6..=maximum).contains(&password.chars().count()) || password.len() > 256 {
        password.zeroize();
        return Err(format!("Password must be 6–{maximum} characters."));
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
