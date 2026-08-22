use crate::auth;
use crate::config::Config;
use crate::storage::{
    self, Envelope, NodeStorage, Post, RondoMessage, Space, StorageError, TUS_VERSION,
};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_HEADER_BYTES: usize = 32 * 1024;
const MAX_FLUO_REQUEST_BYTES: u64 = 64 * 1024;
const MAX_LIGO_REQUEST_BYTES: u64 = 80 * 1024;
const MAX_RONDO_REQUEST_BYTES: u64 = 16 * 1024;
const MAX_VOICE_REQUEST_BYTES: u64 = 40 * 1024;
const ONLINE_TICKET_LENGTH: usize = 43;
const MAX_NODE_CONNECTIONS: usize = 256;
const MAX_TICKET_CACHE_ENTRIES: usize = 1_024;
const MAX_VOICE_SIGNALS: usize = 512;
const MAX_VOICE_ROOMS: usize = 256;
const CHUNK_LENGTH_HEADERS: [&str; 2] = ["x-kaordo-chunk-length", "x-veridimensio-chunk-length"];

#[derive(Debug, Clone)]
pub struct NodeRuntime {
    pub benchmark: Arc<RwLock<Option<DiskBenchmark>>>,
    pub config: Arc<RwLock<Config>>,
    pub coordinator_latency_ms: Arc<RwLock<Option<u64>>>,
    pub storage: Arc<RwLock<NodeStorage>>,
    connections: Arc<AtomicUsize>,
    verifier: TicketVerifier,
    voice: Arc<Mutex<VoiceHub>>,
}

impl NodeRuntime {
    pub fn new(config: Config, storage: NodeStorage) -> Self {
        let api_origin = config.api_origin.clone();
        Self {
            benchmark: Arc::new(RwLock::new(None)),
            config: Arc::new(RwLock::new(config)),
            coordinator_latency_ms: Arc::new(RwLock::new(None)),
            storage: Arc::new(RwLock::new(storage)),
            connections: Arc::new(AtomicUsize::new(0)),
            verifier: TicketVerifier::new(api_origin),
            voice: Arc::new(Mutex::new(VoiceHub::default())),
        }
    }

    pub fn server(&self, listeners: Vec<TcpListener>) -> io::Result<()> {
        if listeners.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::AddrNotAvailable,
                "Nodo could not bind a network listener.",
            ));
        }
        let runtime = Arc::new(self.clone());
        let mut acceptors = Vec::with_capacity(listeners.len());
        for listener in listeners {
            let runtime = Arc::clone(&runtime);
            acceptors.push(
                thread::Builder::new()
                    .name("kaordo-nodo-listener".to_owned())
                    .spawn(move || accept_connections(listener, runtime))
                    .map_err(|error| io::Error::other(error.to_string()))?,
            );
        }
        for acceptor in acceptors {
            match acceptor.join() {
                Ok(result) => result?,
                Err(_) => return Err(io::Error::other("Nodo listener thread panicked.")),
            }
        }
        Ok(())
    }
}

fn accept_connections(listener: TcpListener, runtime: Arc<NodeRuntime>) -> io::Result<()> {
    listener.set_nonblocking(false)?;
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                if runtime.connections.fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                    (count < MAX_NODE_CONNECTIONS).then_some(count + 1)
                }).is_err() {
                    let mut stream = stream;
                    let _ = response_json_with_status(
                        &mut stream,
                        503,
                        json!({ "error": "Nodo is busy; retry shortly." }),
                    );
                    continue;
                }
                let runtime = Arc::clone(&runtime);
                thread::Builder::new()
                    .name("kaordo-nodo-client".to_owned())
                    .spawn(move || {
                        let _permit = ConnectionPermit(Arc::clone(&runtime.connections));
                        if let Err(error) = handle_connection(stream, &runtime) {
                            crate::ui::warning(&format!("request failed: {error}"));
                        }
                    })
                    .map_err(|error| io::Error::other(error.to_string()))?;
            }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

struct ConnectionPermit(Arc<AtomicUsize>);

impl Drop for ConnectionPermit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Debug, Clone)]
struct TicketVerifier {
    api_origin: String,
    client: Client,
    cache: Arc<Mutex<HashMap<String, CachedGrant>>>,
}

#[derive(Debug, Clone)]
struct CachedGrant {
    expires_at: i64,
    grant: AccessGrant,
}

#[derive(Debug, Clone, Deserialize)]
struct VerifyResponse {
    authorized: bool,
    #[serde(rename = "expiresAt")]
    expires_at: Option<i64>,
    #[serde(rename = "isOwner", default)]
    is_owner: bool,
    username: Option<String>,
    #[serde(rename = "publicReservation")]
    public_reservation: Option<PublicReservation>,
    rondo: Option<RondoGrant>,
}

#[derive(Debug, Clone, Deserialize)]
struct PublicReservation {
    id: String,
    bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RondoGrant {
    limit_bytes: u64,
    owner: bool,
    room_id: String,
    space_id: String,
    storage: String,
}

#[derive(Debug, Clone)]
struct AccessGrant {
    expires_at: i64,
    is_owner: bool,
    username: String,
    public_reservation: Option<PublicReservation>,
    rondo: Option<RondoGrant>,
}

impl TicketVerifier {
    fn new(api_origin: String) -> Self {
        Self {
            api_origin,
            client: auth::client(15).unwrap_or_else(|_| Client::new()),
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn verify(
        &self,
        token: &str,
        config: &Config,
        reservation: Option<&str>,
        rondo: Option<(&str, &str)>,
    ) -> Option<AccessGrant> {
        if token.len() != ONLINE_TICKET_LENGTH ||
            !token.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-') ||
            config.node_id.is_none() {
            return None;
        }
        let node_id = config.node_id.as_deref()?;
        let cache_key = format!(
            "{node_id}:{token}:{}:{}",
            reservation.unwrap_or_default(),
            rondo
                .map(|pair| format!("{}:{}", pair.0, pair.1))
                .unwrap_or_default()
        );
        let now = unix_seconds();
        if reservation.is_none() && rondo.is_none() {
            if let Some(cached) = self
                .cache
                .lock()
                .ok()?
                .get(&cache_key)
                .filter(|cached| cached.expires_at > now)
            {
                return Some(cached.grant.clone());
            }
        }
        let mut body = json!({ "nodeId": node_id, "ticket": token });
        if let Some(value) = reservation {
            body["reservationId"] = Value::String(value.to_owned());
        }
        if let Some((space_id, room_id)) = rondo {
            body["rondoSpaceId"] = Value::String(space_id.to_owned());
            body["rondoRoomId"] = Value::String(room_id.to_owned());
        }
        let response = self
            .client
            .post(format!(
                "{}/api/nodes/tickets/verify",
                self.api_origin.trim_end_matches('/')
            ))
            .json(&body)
            .send()
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let value: VerifyResponse = response.json().ok()?;
        if !value.authorized
            || value.expires_at? <= now
            || value.username.as_deref().unwrap_or_default().is_empty()
        {
            return None;
        }
        let grant = AccessGrant {
            expires_at: value.expires_at?,
            is_owner: value.is_owner,
            username: value.username?,
            public_reservation: value.public_reservation,
            rondo: value.rondo,
        };
        if reservation.is_none() && rondo.is_none() {
            if let Ok(mut cache) = self.cache.lock() {
                cache.retain(|_, cached| cached.expires_at > now);
                if cache.len() >= MAX_TICKET_CACHE_ENTRIES {
                    if let Some(key) = cache.keys().next().cloned() {
                        cache.remove(&key);
                    }
                }
                cache.insert(
                    cache_key,
                    CachedGrant {
                        expires_at: grant.expires_at,
                        grant: grant.clone(),
                    },
                );
            }
        }
        Some(grant)
    }
}

#[derive(Debug)]
struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    content_length: u64,
}

fn handle_connection(stream: TcpStream, runtime: &Arc<NodeRuntime>) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    let mut reader = BufReader::new(stream);
    let request = match read_request(&mut reader)? {
        Some(request) => request,
        None => return Ok(()),
    };
    let mut output = reader.get_mut().try_clone()?;
    if request.method == "OPTIONS" {
        return response(&mut output, 204, "No Content", tus_headers(), None);
    }
    if request.method == "GET" && request.path == "/v1/health" {
        return response_json(
            &mut output,
            200,
            json!({ "status": "ok", "protocol": "tus/1.0.0" }),
        );
    }
    let grant = authorize(&request, runtime);
    if grant.is_none() {
        return response_json_with_headers(
            &mut output,
            401,
            json!({ "error": "Authentication required." }),
            [("WWW-Authenticate", "Bearer")],
        );
    }
    let grant = grant.expect("checked above");
    if request.method == "GET" && request.path == "/v1/status" {
        let config = runtime.config.read().map_err(lock_error)?;
        let storage = runtime.storage.read().map_err(lock_error)?;
        return response_json(&mut output, 200, status_json(&config, &storage));
    }
    if request.method == "DELETE" && request.path == "/v1/storage" {
        if !grant.is_owner {
            return forbidden(&mut output);
        }
        let storage = runtime.storage.write().map_err(lock_error)?;
        let result = storage.clear().map_err(internal_error)?;
        return response_json(
            &mut output,
            200,
            json!({ "deletedBytes": result.private.deleted_bytes + result.public.deleted_bytes, "deletedUploads": result.private.deleted_uploads + result.public.deleted_uploads, "deletedPosts": result.private.deleted_posts + result.public.deleted_posts }),
        );
    }
    if request.method == "DELETE" && request.path == "/v1/spaces/private/storage" {
        if !grant.is_owner {
            return forbidden(&mut output);
        }
        let mut storage = runtime.storage.write().map_err(lock_error)?;
        let result = storage
            .space_mut(Space::Private)
            .clear()
            .map_err(internal_error)?;
        return response_json(
            &mut output,
            200,
            json!({ "deletedBytes": result.deleted_bytes, "deletedUploads": result.deleted_uploads, "deletedPosts": result.deleted_posts }),
        );
    }
    let policy = runtime.config.read().map_err(lock_error)?.clone();
    if request.method == "POST" && request.path == "/v1/diagnostics/quick-test" {
        if !grant.is_owner {
            return forbidden(&mut output);
        }
        let result = quick_disk_test(&policy.data_dir).map_err(internal_error)?;
        *runtime.benchmark.write().map_err(lock_error)? = Some(result.clone());
        return response_json(
            &mut output,
            200,
            json!({ "completedAt": result.completed_at, "diskReadBps": result.read_bps, "diskWriteBps": result.write_bps }),
        );
    }
    if request.method == "POST" && request.path.starts_with("/v1/diagnostics/") {
        if !grant.is_owner {
            return forbidden(&mut output);
        }
        let completed_at = unix_seconds();
        return match request.path.as_str() {
            "/v1/diagnostics/battery" => {
                let (battery_percent, charging) = crate::heartbeat::battery_snapshot();
                response_fresh_json(
                    &mut output,
                    200,
                    json!({
                        "completedAt": completed_at,
                        "batteryPercent": battery_percent,
                        "charging": charging,
                    }),
                )
            }
            "/v1/diagnostics/memory" => {
                let (memory_total_bytes, memory_available_bytes) =
                    crate::heartbeat::memory_snapshot();
                response_fresh_json(
                    &mut output,
                    200,
                    json!({
                        "completedAt": completed_at,
                        "memoryAvailableBytes": memory_available_bytes,
                        "memoryTotalBytes": memory_total_bytes,
                        "storageAvailableBytes": crate::config::available_bytes(&policy.data_dir),
                    }),
                )
            }
            "/v1/diagnostics/network" => {
                let (network_type, network_down_bps, network_up_bps) =
                    crate::heartbeat::network_snapshot();
                response_fresh_json(
                    &mut output,
                    200,
                    json!({
                        "completedAt": completed_at,
                        "networkDownBps": network_down_bps,
                        "networkMetered": null,
                        "networkType": network_type,
                        "networkUpBps": network_up_bps,
                    }),
                )
            }
            "/v1/diagnostics/latency" => {
                let latency = crate::heartbeat::measure_coordinator_latency(&policy.api_origin)
                    .map_err(internal_error)?;
                *runtime.coordinator_latency_ms.write().map_err(lock_error)? = Some(latency);
                response_fresh_json(
                    &mut output,
                    200,
                    json!({
                        "completedAt": completed_at,
                        "coordinatorLatencyMs": latency,
                    }),
                )
            }
            "/v1/diagnostics/disk" => {
                let result = quick_disk_test(&policy.data_dir).map_err(internal_error)?;
                *runtime.benchmark.write().map_err(lock_error)? = Some(result.clone());
                response_fresh_json(
                    &mut output,
                    200,
                    json!({
                        "completedAt": result.completed_at,
                        "diskReadBps": result.read_bps,
                        "diskWriteBps": result.write_bps,
                    }),
                )
            }
            _ => not_found(&mut output, "Diagnostic not found."),
        };
    }
    if !transfer_conditions_available(&policy) {
        return response_json_with_status(
            &mut output,
            503,
            json!({ "error": "Nodo policy has paused transfers." }),
        );
    }
    if request.method == "GET" && request.path == "/v1/fluo/state" {
        if !policy.allow_downloads {
            return transfer_denied(&mut output);
        }
        let storage = runtime.storage.read().map_err(lock_error)?;
        let private = storage
            .space(Space::Private)
            .state()
            .map_err(internal_error)?;
        let public = storage
            .space(Space::Public)
            .state()
            .map_err(internal_error)?;
        return response_json(
            &mut output,
            200,
            json!({ "spaces": { "private": private, "public": public } }),
        );
    }
    if let Some((space, kind, id)) = storage_items_route(&request.path) {
        let storage = runtime.storage.write().map_err(lock_error)?;
        if request.method == "GET" && kind.is_none() {
            if !policy.allow_downloads {
                return transfer_denied(&mut output);
            }
            let items = storage
                .storage_items(space, &grant.username, grant.is_owner)
                .map_err(internal_error)?;
            return response_json(&mut output, 200, json!({ "items": items }));
        }
        if request.method == "DELETE" && kind.is_some() && id.is_some() {
            if !policy.allow_uploads {
                return transfer_denied(&mut output);
            }
            delete_storage_item(
                &mut output,
                &storage,
                space,
                kind.as_deref().unwrap_or_default(),
                id.as_deref().unwrap_or_default(),
                &grant,
            )?;
            return Ok(());
        }
        return method_not_allowed(&mut output);
    }
    if let Some((space, suffix)) = space_route(&request.path, "/fluo/posts") {
        if suffix.is_empty() && request.method == "GET" {
            if !policy.allow_downloads {
                return transfer_denied(&mut output);
            }
            let limit = query_usize(&request, "limit", 20, 1..=50)?;
            let cursor = query_usize_opt(&request, "cursor")?;
            let storage = runtime.storage.read().map_err(lock_error)?;
            let (posts, next) = storage
                .space(space)
                .page_posts(limit, cursor)
                .map_err(internal_error)?;
            return response_json(
                &mut output,
                200,
                json!({ "posts": posts, "nextCursor": next.map(|value| value.to_string()) }),
            );
        }
        if suffix.is_empty() && request.method == "POST" {
            if !policy.allow_uploads || !can_write(space, &grant) {
                return forbidden(&mut output);
            }
            let body = read_body(&mut reader, request.content_length, MAX_FLUO_REQUEST_BYTES)?;
            let mut post: Post = serde_json::from_slice(&body)
                .map_err(|_| bad_request("Post payload is invalid."))?;
            post.author = grant.username.clone();
            if post.id.is_empty() {
                post.id = uuid::Uuid::new_v4().to_string();
            }
            if post.created_at == 0 {
                post.created_at = now_millis();
            }
            post.public_reservation_id = grant
                .public_reservation
                .as_ref()
                .map(|value| value.id.clone());
            let reservation = grant.public_reservation.as_ref().map(|value| value.bytes);
            let mut storage = runtime.storage.write().map_err(lock_error)?;
            if let Err(error) =
                storage
                    .space_mut(space)
                    .create_post(&post, &grant.username, reservation)
            {
                return storage_json_error(&mut output, error);
            }
            return response_json_with_status(&mut output, 201, json!({ "post": post }));
        }
        let id = suffix.strip_prefix('/').unwrap_or_default();
        if request.method == "DELETE" && valid_id(id) {
            if !policy.allow_uploads {
                return transfer_denied(&mut output);
            }
            let mut storage = runtime.storage.write().map_err(lock_error)?;
            let deleted =
                match storage
                    .space_mut(space)
                    .delete_post(id, &grant.username, grant.is_owner)
                {
                    Ok(value) => value,
                    Err(error) => return storage_json_error(&mut output, error),
                };
            if deleted.is_none() {
                return not_found(&mut output, "Post not found.");
            }
            return response_json(&mut output, 200, json!({ "ok": true }));
        }
    }
    if let Some((space, suffix)) = space_route(&request.path, "/ligo/envelopes") {
        if suffix.is_empty() && request.method == "POST" {
            if !policy.allow_uploads || !can_write(space, &grant) {
                return forbidden(&mut output);
            }
            let body = read_body(&mut reader, request.content_length, MAX_LIGO_REQUEST_BYTES)?;
            let mut envelope: Envelope = serde_json::from_slice(&body)
                .map_err(|_| bad_request("Message envelope is invalid."))?;
            envelope.sender = grant.username.clone();
            if envelope.created_at == 0 {
                envelope.created_at = now_millis();
            }
            let reservation = grant
                .public_reservation
                .as_ref()
                .map(|value| value.id.as_str());
            let mut storage = runtime.storage.write().map_err(lock_error)?;
            if let Err(error) =
                storage
                    .space_mut(space)
                    .create_envelope(&envelope, &grant.username, reservation)
            {
                return storage_json_error(&mut output, error);
            }
            return response_json_with_status(&mut output, 201, json!({ "envelope": envelope }));
        }
        let id = suffix.strip_prefix('/').unwrap_or_default();
        if valid_id(id) && request.method == "GET" {
            if !policy.allow_downloads {
                return transfer_denied(&mut output);
            }
            let storage = runtime.storage.read().map_err(lock_error)?;
            let envelope = storage
                .space(space)
                .read_envelope(id, &grant.username)
                .map_err(internal_error)?;
            if let Some(value) = envelope {
                return response_json(&mut output, 200, json!({ "envelope": value }));
            }
            return not_found(&mut output, "Message not found.");
        }
        if valid_id(id) && request.method == "DELETE" {
            let mut storage = runtime.storage.write().map_err(lock_error)?;
            let deleted = match storage
                .space_mut(space)
                .delete_envelope(id, &grant.username)
            {
                Ok(value) => value,
                Err(error) => return storage_json_error(&mut output, error),
            };
            if !deleted {
                return not_found(&mut output, "Message not found.");
            }
            return response_json(&mut output, 200, json!({ "ok": true }));
        }
    }
    if let Some((space, suffix)) = upload_route(&request.path) {
        let id = suffix.strip_prefix('/').unwrap_or_default();
        if suffix.is_empty() && request.method == "POST" {
            if !policy.allow_uploads || !can_write(space, &grant) {
                return forbidden(&mut output);
            }
            if request.headers.get("tus-resumable").map(String::as_str) != Some(TUS_VERSION) {
                return tus_error(&mut output, 412, "Unsupported tus version.", []);
            }
            let length = request
                .headers
                .get("upload-length")
                .and_then(|value| value.parse::<u64>().ok())
                .ok_or_else(|| bad_request("Upload-Length is required."))?;
            let reservation = grant
                .public_reservation
                .as_ref()
                .filter(|_| space == Space::Public);
            let mut storage = runtime.storage.write().map_err(lock_error)?;
            let record = match storage.space_mut(space).create_upload(
                length,
                request
                    .headers
                    .get("upload-metadata")
                    .cloned()
                    .unwrap_or_default(),
                &grant.username,
                reservation.map(|value| value.id.as_str()),
                reservation.map(|value| value.bytes),
            ) {
                Ok(record) => record,
                Err(error) => return storage_tus_error(&mut output, error),
            };
            return response(
                &mut output,
                201,
                "Created",
                tus_headers_with([
                    ("Location", format!("{}/{}", request.path, record.id)),
                    ("Upload-Offset", "0".to_owned()),
                ]),
                None,
            );
        }
        if valid_id(id) && request.method == "HEAD" {
            let storage = runtime.storage.read().map_err(lock_error)?;
            let Some(record) = storage.space(space).record(id).map_err(internal_error)? else {
                return tus_error(&mut output, 404, "Upload not found.", []);
            };
            let mut headers = tus_headers();
            headers.push(("Upload-Length".to_owned(), record.length.to_string()));
            headers.push(("Upload-Offset".to_owned(), record.offset.to_string()));
            if !record.metadata.is_empty() {
                headers.push(("Upload-Metadata".to_owned(), record.metadata));
            }
            return response(&mut output, 200, "OK", headers, None);
        }
        if valid_id(id) && request.method == "PATCH" {
            if !policy.allow_uploads || !can_write(space, &grant) {
                return forbidden(&mut output);
            }
            if request.headers.get("tus-resumable").map(String::as_str) != Some(TUS_VERSION) {
                return tus_error(&mut output, 412, "Unsupported tus version.", []);
            }
            if request
                .headers
                .get("content-type")
                .map(|value| value.split(';').next().unwrap_or_default())
                != Some("application/offset+octet-stream")
            {
                return tus_error(
                    &mut output,
                    415,
                    "PATCH requires application/offset+octet-stream.",
                    [],
                );
            }
            let offset = request
                .headers
                .get("upload-offset")
                .and_then(|value| value.parse::<u64>().ok())
                .ok_or_else(|| bad_request("Upload-Offset is required."))?;
            let mut storage = runtime.storage.write().map_err(lock_error)?;
            let record = match storage.space_mut(space).append_upload(
                id,
                offset,
                request.content_length,
                &mut reader,
                &grant.username,
                grant.is_owner,
            ) {
                Ok(record) => record,
                Err(error) => return storage_tus_error(&mut output, error),
            };
            return response(
                &mut output,
                204,
                "No Content",
                tus_headers_with([("Upload-Offset", record.offset.to_string())]),
                None,
            );
        }
        if valid_id(id) && request.method == "DELETE" {
            if !policy.allow_uploads || !can_write(space, &grant) {
                return forbidden(&mut output);
            }
            let mut storage = runtime.storage.write().map_err(lock_error)?;
            if let Err(error) =
                storage
                    .space_mut(space)
                    .delete_upload(id, &grant.username, grant.is_owner)
            {
                return storage_tus_error(&mut output, error);
            }
            return response(&mut output, 204, "No Content", tus_headers(), None);
        }
    }
    if let Some((space, id)) = content_route(&request.path) {
        if !policy.allow_downloads || !valid_id(id) {
            return not_found(&mut output, "File not found.");
        }
        let storage = runtime.storage.read().map_err(lock_error)?;
        return download(&mut output, storage.space(space), id, &request);
    }
    if let Some((space_id, room_id, suffix)) = rondo_message_route(&request.path) {
        let Some(scope) = grant
            .rondo
            .clone()
            .filter(|scope| scope.space_id == space_id && scope.room_id == room_id)
        else {
            return forbidden(&mut output);
        };
        let space = if scope.storage == "public" {
            Space::Public
        } else {
            Space::Private
        };
        if suffix.is_empty() && request.method == "GET" {
            let limit = query_usize(&request, "limit", 40, 1..=50)?;
            let cursor = query_usize_opt(&request, "cursor")?;
            let storage = runtime.storage.read().map_err(lock_error)?;
            let (messages, next) = storage
                .space(space)
                .page_rondo(&space_id, &room_id, limit, cursor)
                .map_err(internal_error)?;
            return response_json(
                &mut output,
                200,
                json!({ "messages": messages, "nextCursor": next.map(|value| value.to_string()) }),
            );
        }
        if suffix.is_empty() && request.method == "POST" {
            let body = read_body(&mut reader, request.content_length, MAX_RONDO_REQUEST_BYTES)?;
            let mut message: RondoMessage = serde_json::from_slice(&body)
                .map_err(|_| bad_request("Message payload is invalid."))?;
            message.author = grant.username.clone();
            message.id = uuid::Uuid::new_v4().to_string();
            message.created_at = now_millis();
            let mut storage = runtime.storage.write().map_err(lock_error)?;
            if let Err(error) = storage.space_mut(space).create_rondo(
                &space_id,
                &room_id,
                &message,
                scope.limit_bytes,
            ) {
                return storage_json_error(&mut output, error);
            }
            return response_json_with_status(&mut output, 201, json!({ "message": message }));
        }
        let id = suffix.strip_prefix('/').unwrap_or_default();
        if request.method == "DELETE" && valid_id(id) {
            let mut storage = runtime.storage.write().map_err(lock_error)?;
            let deleted = match storage.space_mut(space).delete_rondo(
                &space_id,
                &room_id,
                id,
                &grant.username,
                scope.owner,
            ) {
                Ok(value) => value,
                Err(error) => return storage_json_error(&mut output, error),
            };
            if !deleted {
                return not_found(&mut output, "Message not found.");
            }
            return response_json(&mut output, 200, json!({ "ok": true }));
        }
    }
    if let Some((space_id, room_id, action)) = rondo_voice_route(&request.path) {
        let Some(scope) = grant
            .rondo
            .clone()
            .filter(|scope| scope.space_id == space_id && scope.room_id == room_id)
        else {
            return forbidden(&mut output);
        };
        return voice_route(
            &mut output,
            &mut reader,
            &request,
            runtime,
            &scope,
            &grant.username,
            action,
        );
    }
    not_found(&mut output, "Not found.")
}

fn authorize(request: &Request, runtime: &NodeRuntime) -> Option<AccessGrant> {
    let token = request
        .headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
        .or_else(|| request.query.get("access_token").map(String::as_str))?;
    let reservation = request
        .headers
        .get("x-kaordo-public-reservation")
        .map(String::as_str)
        .or_else(|| {
            request
                .headers
                .get("x-veridimensio-public-reservation")
                .map(String::as_str)
        });
    let space = request
        .headers
        .get("x-kaordo-rondo-space")
        .map(String::as_str)
        .or_else(|| {
            request
                .headers
                .get("x-veridimensio-rondo-space")
                .map(String::as_str)
        });
    let room = request
        .headers
        .get("x-kaordo-rondo-room")
        .map(String::as_str)
        .or_else(|| {
            request
                .headers
                .get("x-veridimensio-rondo-room")
                .map(String::as_str)
        });
    let config = runtime.config.read().ok()?.clone();
    runtime
        .verifier
        .verify(token, &config, reservation, space.zip(room))
}

fn can_write(space: Space, grant: &AccessGrant) -> bool {
    match space {
        Space::Private => grant.is_owner,
        Space::Public => grant.public_reservation.is_some(),
    }
}

fn status_json(config: &Config, storage: &NodeStorage) -> Value {
    let private_used = storage
        .space(Space::Private)
        .used_bytes()
        .unwrap_or_default();
    let public_used = storage
        .space(Space::Public)
        .used_bytes()
        .unwrap_or_default();
    json!({ "status": "online", "port": config.port, "usedBytes": private_used + public_used, "uploadCount": storage.space(Space::Private).upload_count().unwrap_or_default() + storage.space(Space::Public).upload_count().unwrap_or_default(), "spaces": { "private": { "quotaBytes": config.private_quota_bytes, "usedBytes": private_used }, "public": { "quotaBytes": config.public_quota_bytes, "usedBytes": public_used } } })
}

fn storage_items_route(path: &str) -> Option<(Space, Option<String>, Option<String>)> {
    let parts = path
        .strip_prefix("/v1/storage/items/")?
        .split('/')
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return None;
    }
    let space = match parts[0] {
        "private" => Space::Private,
        "public" => Space::Public,
        _ => return None,
    };
    Some((
        space,
        parts
            .get(1)
            .filter(|value| !value.is_empty())
            .map(|value| (*value).to_owned()),
        parts
            .get(2)
            .filter(|value| !value.is_empty())
            .map(|value| (*value).to_owned()),
    ))
}

fn space_route(path: &str, suffix: &str) -> Option<(Space, String)> {
    for space in [Space::Private, Space::Public] {
        let base = format!("/v1/spaces/{}{}", space.segment(), suffix);
        if let Some(value) = path.strip_prefix(&base) {
            return Some((space, value.to_owned()));
        }
    }
    if suffix == "/fluo/posts" && (path == "/v1/fluo/posts" || path.starts_with("/v1/fluo/posts/"))
    {
        return Some((
            Space::Private,
            path.strip_prefix("/v1/fluo/posts")
                .unwrap_or_default()
                .to_owned(),
        ));
    }
    if suffix == "/ligo/envelopes"
        && (path == "/v1/ligo/envelopes" || path.starts_with("/v1/ligo/envelopes/"))
    {
        return Some((
            Space::Private,
            path.strip_prefix("/v1/ligo/envelopes")
                .unwrap_or_default()
                .to_owned(),
        ));
    }
    None
}

fn upload_route(path: &str) -> Option<(Space, String)> {
    if path == "/files" || path.starts_with("/files/") {
        return Some((
            Space::Private,
            path.strip_prefix("/files").unwrap_or_default().to_owned(),
        ));
    }
    for space in [Space::Private, Space::Public] {
        let base = format!("/v1/spaces/{}/files", space.segment());
        if path == base || path.starts_with(&format!("{base}/")) {
            return Some((
                space,
                path.strip_prefix(&base).unwrap_or_default().to_owned(),
            ));
        }
    }
    None
}

fn content_route(path: &str) -> Option<(Space, &str)> {
    if let Some(id) = path.strip_prefix("/v1/files/") {
        return Some((Space::Private, id));
    }
    for space in [Space::Private, Space::Public] {
        let base = format!("/v1/spaces/{}/content/", space.segment());
        if let Some(id) = path.strip_prefix(&base) {
            return Some((space, id));
        }
    }
    None
}

fn rondo_message_route(path: &str) -> Option<(String, String, String)> {
    let parts = path
        .strip_prefix("/v1/rondo/spaces/")?
        .split('/')
        .collect::<Vec<_>>();
    if parts.len() < 4 || parts[1] != "rooms" || parts[3] != "messages" {
        return None;
    }
    Some((
        parts[0].to_owned(),
        parts[2].to_owned(),
        if parts.len() > 4 {
            format!("/{}", parts[4])
        } else {
            String::new()
        },
    ))
}

fn rondo_voice_route(path: &str) -> Option<(String, String, String)> {
    let parts = path
        .strip_prefix("/v1/rondo/spaces/")?
        .split('/')
        .collect::<Vec<_>>();
    if parts.len() != 5 || parts[1] != "rooms" || parts[3] != "voice" {
        return None;
    }
    Some((
        parts[0].to_owned(),
        parts[2].to_owned(),
        parts[4].to_owned(),
    ))
}

fn delete_storage_item(
    output: &mut TcpStream,
    storage: &NodeStorage,
    space: Space,
    kind: &str,
    id: &str,
    grant: &AccessGrant,
) -> io::Result<()> {
    let result = match kind {
        "file" => storage
            .space(space)
            .delete_upload(id, &grant.username, grant.is_owner)
            .map(|_| true),
        "fluo-post" => storage
            .space(space)
            .delete_post(id, &grant.username, grant.is_owner)
            .map(|value| value.is_some()),
        "ligo-envelope" => storage
            .space(space)
            .delete_envelope(id, &grant.username)
            .map_err(|error| error),
        _ => Ok(false),
    };
    match result {
        Ok(true) => response_json(output, 200, json!({ "ok": true })),
        Ok(false) => not_found(output, "Storage item not found."),
        Err(error) => match storage_response(error).kind() {
            io::ErrorKind::PermissionDenied => forbidden(output),
            io::ErrorKind::NotFound => not_found(output, "Storage item not found."),
            _ => response_json_with_status(
                output,
                400,
                json!({ "error": "Storage item could not be deleted." }),
            ),
        },
    }
}

fn voice_route(
    output: &mut TcpStream,
    reader: &mut BufReader<TcpStream>,
    request: &Request,
    runtime: &NodeRuntime,
    scope: &RondoGrant,
    username: &str,
    action: String,
) -> io::Result<()> {
    match action.as_str() {
        "join" => {
            let body = read_body(reader, request.content_length, MAX_VOICE_REQUEST_BYTES)?;
            let value: Value = serde_json::from_slice(&body)
                .map_err(|_| bad_request("Voice join payload is invalid."))?;
            let peer = value
                .get("peerId")
                .and_then(Value::as_str)
                .ok_or_else(|| bad_request("Voice join payload is invalid."))?
                .to_owned();
            let snapshot = runtime.voice.lock().map_err(lock_error)?.join(
                &scope.space_id,
                &scope.room_id,
                peer,
                username,
            );
            response_json(output, 200, snapshot)
        }
        "sync" => {
            let peer = request.query.get("peerId").cloned().unwrap_or_default();
            let after = query_usize(request, "after", 0, 0..=usize::MAX)?;
            let snapshot = runtime.voice.lock().map_err(lock_error)?.sync(
                &scope.space_id,
                &scope.room_id,
                &peer,
                after,
            );
            response_json(output, 200, snapshot)
        }
        "peek" => {
            let snapshot = runtime
                .voice
                .lock()
                .map_err(lock_error)?
                .peek(&scope.space_id, &scope.room_id);
            response_json(output, 200, snapshot)
        }
        "signals" => {
            let body = read_body(reader, request.content_length, MAX_VOICE_REQUEST_BYTES)?;
            let value: Value = serde_json::from_slice(&body)
                .map_err(|_| bad_request("Voice signal is invalid."))?;
            let sequence = runtime.voice.lock().map_err(lock_error)?.signal(
                &scope.space_id,
                &scope.room_id,
                value
                    .get("peerId")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                value
                    .get("toPeerId")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                value
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                value
                    .get("payload")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            );
            response_json_with_status(output, 202, json!({ "sequence": sequence }))
        }
        "leave" => {
            let peer = request.query.get("peerId").cloned().unwrap_or_default();
            runtime
                .voice
                .lock()
                .map_err(lock_error)?
                .leave(&scope.space_id, &scope.room_id, &peer);
            response_json(output, 200, json!({ "ok": true }))
        }
        _ => method_not_allowed(output),
    }
}

#[derive(Debug, Default)]
struct VoiceHub {
    rooms: HashMap<(String, String), VoiceRoom>,
}

#[derive(Debug, Default)]
struct VoiceRoom {
    cursor: usize,
    participants: HashMap<String, VoiceParticipant>,
    signals: Vec<VoiceSignal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceParticipant {
    joined_at: i64,
    peer_id: String,
    username: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceSignal {
    from_peer_id: String,
    payload: String,
    sequence: usize,
    to_peer_id: String,
    signal_type: String,
}

impl VoiceHub {
    fn room(&mut self, space: &str, room: &str) -> &mut VoiceRoom {
        if !self.rooms.contains_key(&(space.to_owned(), room.to_owned())) &&
            self.rooms.len() >= MAX_VOICE_ROOMS {
            if let Some(key) = self.rooms.iter()
                .find_map(|(key, room)| room.participants.is_empty().then(|| key.clone())) {
                self.rooms.remove(&key);
            }
        }
        self.rooms
            .entry((space.to_owned(), room.to_owned()))
            .or_default()
    }
    fn join(&mut self, space: &str, room: &str, peer_id: String, username: &str) -> Value {
        let room = self.room(space, room);
        room.cursor += 1;
        room.participants.insert(
            peer_id.clone(),
            VoiceParticipant {
                joined_at: now_millis(),
                peer_id,
                username: username.to_owned(),
            },
        );
        snapshot(room, 0)
    }
    fn sync(&mut self, space: &str, room: &str, peer_id: &str, after: usize) -> Value {
        let room = self.room(space, room);
        if !room.participants.contains_key(peer_id) {
            return json!({ "cursor": room.cursor, "participants": [], "signals": [] });
        }
        snapshot(room, after)
    }
    fn peek(&mut self, space: &str, room: &str) -> Value {
        let room = self.room(space, room);
        snapshot(room, 0)
    }
    fn signal(
        &mut self,
        space: &str,
        room: &str,
        from: &str,
        to: &str,
        signal_type: &str,
        payload: &str,
    ) -> usize {
        let room = self.room(space, room);
        room.cursor += 1;
        let sequence = room.cursor;
        room.signals.push(VoiceSignal {
            from_peer_id: from.to_owned(),
            payload: payload.to_owned(),
            sequence,
            to_peer_id: to.to_owned(),
            signal_type: signal_type.to_owned(),
        });
        if room.signals.len() > MAX_VOICE_SIGNALS {
            let excess = room.signals.len() - MAX_VOICE_SIGNALS;
            room.signals.drain(..excess);
        }
        sequence
    }
    fn leave(&mut self, space: &str, room: &str, peer: &str) {
        let key = (space.to_owned(), room.to_owned());
        let should_remove = if let Some(room) = self.rooms.get_mut(&key) {
            room.participants.remove(peer);
            room.cursor += 1;
            room.participants.is_empty()
        } else {
            false
        };
        if should_remove {
            self.rooms.remove(&key);
        }
    }
}

fn snapshot(room: &VoiceRoom, after: usize) -> Value {
    json!({ "cursor": room.cursor, "participants": room.participants.values().cloned().collect::<Vec<_>>(), "signals": room.signals.iter().filter(|signal| signal.sequence > after).cloned().collect::<Vec<_>>() })
}

fn read_request(reader: &mut BufReader<TcpStream>) -> io::Result<Option<Request>> {
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    let request_line = line.trim_end_matches(['\r', '\n']).to_owned();
    let parts = request_line.split_whitespace().collect::<Vec<_>>();
    if parts.len() != 3 || !parts[2].starts_with("HTTP/1.") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Malformed request line.",
        ));
    }
    let mut headers = HashMap::new();
    let mut total = line.len();
    loop {
        line.clear();
        reader.read_line(&mut line)?;
        total += line.len();
        if total > MAX_HEADER_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Request headers are too large.",
            ));
        }
        let clean = line.trim_end_matches(['\r', '\n']);
        if clean.is_empty() {
            break;
        }
        let Some((name, value)) = clean.split_once(':') else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Malformed header.",
            ));
        };
        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
    }
    let raw = parts[1].to_owned();
    let (path, query_string) = raw.split_once('?').unwrap_or((raw.as_str(), ""));
    if !path.starts_with('/') || path.contains("..") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Malformed path.",
        ));
    }
    let query = query_string
        .split('&')
        .filter(|part| !part.is_empty())
        .filter_map(|part| {
            let (key, value) = part.split_once('=').unwrap_or((part, ""));
            Some((percent_decode(key), percent_decode(value)))
        })
        .collect();
    let content_length = headers
        .get("content-length")
        .or_else(|| {
            CHUNK_LENGTH_HEADERS
                .iter()
                .find_map(|name| headers.get(*name))
        })
        .map_or(Ok(0), |value| {
            value.parse::<u64>().map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "Content-Length is invalid.")
            })
        })?;
    Ok(Some(Request {
        method: parts[0].to_ascii_uppercase(),
        path: path.to_owned(),
        query,
        headers,
        content_length,
    }))
}

fn read_body(reader: &mut dyn Read, length: u64, max: u64) -> io::Result<Vec<u8>> {
    if length == 0 || length > max || length > usize::MAX as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Request body is invalid.",
        ));
    }
    let mut body = vec![0_u8; length as usize];
    reader.read_exact(&mut body)?;
    Ok(body)
}

fn download(
    output: &mut TcpStream,
    storage: &crate::storage::SpaceStorage,
    id: &str,
    request: &Request,
) -> io::Result<()> {
    let Some((record, path)) = storage.completed_file(id)? else {
        return not_found(output, "File not found.");
    };
    let length = path.metadata()?.len();
    let etag = format!("\"{}-{}\"", record.id, length);
    if request
        .headers
        .get("if-none-match")
        .is_some_and(|value| value == &etag)
    {
        return response(
            output,
            304,
            "Not Modified",
            vec![
                ("ETag".to_owned(), etag),
                (
                    "Cache-Control".to_owned(),
                    "private, max-age=31536000, immutable".to_owned(),
                ),
            ],
            None,
        );
    }
    let range = request
        .headers
        .get("range")
        .and_then(|value| parse_range(value, length));
    let (start, end, status, reason) = range
        .map_or((0, length.saturating_sub(1), 200, "OK"), |(start, end)| {
            (start, end, 206, "Partial Content")
        });
    if length == 0 {
        return not_found(output, "File not found.");
    }
    let filename = storage::metadata_filename(&record.metadata)
        .unwrap_or_else(|| format!("{}.bin", record.id));
    let mime = storage::metadata_media_type(&record.metadata)
        .unwrap_or_else(|| storage::media_type(&filename).to_owned());
    let mut headers = vec![
        ("ETag".to_owned(), etag),
        (
            "Cache-Control".to_owned(),
            "private, max-age=31536000, immutable".to_owned(),
        ),
        ("Accept-Ranges".to_owned(), "bytes".to_owned()),
        ("Content-Type".to_owned(), mime),
        ("Content-Length".to_owned(), (end - start + 1).to_string()),
        (
            "Content-Disposition".to_owned(),
            format!("inline; filename=\"{}\"", filename),
        ),
    ];
    if status == 206 {
        headers.push((
            "Content-Range".to_owned(),
            format!("bytes {start}-{end}/{length}"),
        ));
    }
    response(output, status, reason, headers, None)?;
    if request.method == "HEAD" {
        return Ok(());
    }
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut remaining = end - start + 1;
    let mut buffer = [0_u8; 64 * 1024];
    while remaining > 0 {
        let chunk_size = remaining.min(buffer.len() as u64) as usize;
        let count = file.read(&mut buffer[..chunk_size])?;
        if count == 0 {
            break;
        }
        output.write_all(&buffer[..count])?;
        remaining -= count as u64;
    }
    output.flush()
}

fn parse_range(value: &str, length: u64) -> Option<(u64, u64)> {
    let value = value.strip_prefix("bytes=")?;
    if value.contains(',') || length == 0 {
        return None;
    }
    let (start, end) = value.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?.min(length);
        return Some((length.saturating_sub(suffix), length - 1));
    }
    let start = start.parse::<u64>().ok()?.min(length - 1);
    let end = if end.is_empty() {
        length - 1
    } else {
        end.parse::<u64>().ok()?.min(length - 1)
    };
    (end >= start).then_some((start, end))
}

fn response_json(output: &mut TcpStream, status: u16, value: Value) -> io::Result<()> {
    response_json_with_status(output, status, value)
}
fn response_fresh_json(output: &mut TcpStream, status: u16, value: Value) -> io::Result<()> {
    response_json_with_headers(output, status, value, [("Cache-Control", "no-store")])
}
fn response_json_with_status(output: &mut TcpStream, status: u16, value: Value) -> io::Result<()> {
    let body = serde_json::to_vec(&value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    response(
        output,
        status,
        reason_phrase(status),
        vec![(
            "Content-Type".to_owned(),
            "application/json; charset=utf-8".to_owned(),
        )],
        Some(&body),
    )
}
fn response_json_with_headers<I, N, V>(
    output: &mut TcpStream,
    status: u16,
    value: Value,
    headers: I,
) -> io::Result<()>
where
    I: IntoIterator<Item = (N, V)>,
    N: Into<String>,
    V: Into<String>,
{
    let body = serde_json::to_vec(&value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let mut all = headers
        .into_iter()
        .map(|(name, value)| (name.into(), value.into()))
        .collect::<Vec<_>>();
    all.push((
        "Content-Type".to_owned(),
        "application/json; charset=utf-8".to_owned(),
    ));
    response(output, status, reason_phrase(status), all, Some(&body))
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        412 => "Precondition Failed",
        413 => "Content Too Large",
        415 => "Unsupported Media Type",
        416 => "Range Not Satisfiable",
        500 => "Internal Server Error",
        _ => "Kaordo Nodo Response",
    }
}
fn response(
    output: &mut TcpStream,
    status: u16,
    reason: &str,
    mut headers: Vec<(String, String)>,
    body: Option<&[u8]>,
) -> io::Result<()> {
    if let Some(body) = body {
        headers.push(("Content-Length".to_owned(), body.len().to_string()));
    } else if !headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("content-length"))
    {
        headers.push(("Content-Length".to_owned(), "0".to_owned()));
    }
    headers.extend(cors_headers());
    headers.push(("Connection".to_owned(), "close".to_owned()));
    write!(output, "HTTP/1.1 {status} {reason}\r\n")?;
    for (name, value) in headers {
        write!(output, "{name}: {value}\r\n")?;
    }
    write!(output, "\r\n")?;
    if let Some(body) = body {
        output.write_all(body)?;
    }
    output.flush()
}
fn cors_headers() -> Vec<(String, String)> {
    vec![("Access-Control-Allow-Origin".to_owned(), "*".to_owned()), ("Access-Control-Allow-Methods".to_owned(), "GET,HEAD,POST,PATCH,DELETE,OPTIONS".to_owned()), ("Access-Control-Allow-Headers".to_owned(), "Authorization,Content-Type,Tus-Resumable,Upload-Length,Upload-Offset,Upload-Metadata,X-Kaordo-Chunk-Length,X-Veridimensio-Chunk-Length,X-Kaordo-Public-Reservation,X-Veridimensio-Public-Reservation,X-Kaordo-Rondo-Space,X-Veridimensio-Rondo-Space,X-Kaordo-Rondo-Room,X-Veridimensio-Rondo-Room".to_owned()), ("Access-Control-Expose-Headers".to_owned(), "Location,Tus-Resumable,Tus-Version,Tus-Extension,Tus-Max-Size,Upload-Length,Upload-Offset,Upload-Metadata,Accept-Ranges,Content-Length,Content-Range,ETag".to_owned()), ("Access-Control-Max-Age".to_owned(), "600".to_owned()), ("Access-Control-Allow-Private-Network".to_owned(), "true".to_owned())]
}
fn tus_headers() -> Vec<(String, String)> {
    vec![
        ("Tus-Resumable".to_owned(), TUS_VERSION.to_owned()),
        ("Tus-Version".to_owned(), TUS_VERSION.to_owned()),
        (
            "Tus-Extension".to_owned(),
            "creation,termination".to_owned(),
        ),
    ]
}
fn tus_headers_with<const N: usize>(
    extra: [(impl Into<String>, impl Into<String>); N],
) -> Vec<(String, String)> {
    let mut headers = tus_headers();
    headers.extend(
        extra
            .into_iter()
            .map(|(name, value)| (name.into(), value.into())),
    );
    headers
}
fn not_found(output: &mut TcpStream, message: &str) -> io::Result<()> {
    response_json_with_status(output, 404, json!({ "error": message }))
}
fn forbidden(output: &mut TcpStream) -> io::Result<()> {
    response_json_with_status(
        output,
        403,
        json!({ "error": "This space is read-only for your account." }),
    )
}
fn transfer_denied(output: &mut TcpStream) -> io::Result<()> {
    response_json_with_status(
        output,
        403,
        json!({ "error": "This transfer direction is disabled." }),
    )
}
fn method_not_allowed(output: &mut TcpStream) -> io::Result<()> {
    response_json_with_status(output, 405, json!({ "error": "Method not allowed." }))
}
fn tus_error(
    output: &mut TcpStream,
    status: u16,
    message: &str,
    headers: impl IntoIterator<Item = (String, String)>,
) -> io::Result<()> {
    let body = json!({ "error": message });
    let mut all = tus_headers();
    all.extend(headers);
    let bytes = serde_json::to_vec(&body).unwrap_or_default();
    all.push((
        "Content-Type".to_owned(),
        "application/json; charset=utf-8".to_owned(),
    ));
    response(output, status, "Tus Error", all, Some(&bytes))
}
fn bad_request(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}
fn internal_error(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}
fn lock_error<T>(_: std::sync::PoisonError<T>) -> io::Error {
    io::Error::other("Nodo state lock is poisoned.")
}
fn storage_response(error: StorageError) -> io::Error {
    match error {
        StorageError::Forbidden => io::Error::new(
            io::ErrorKind::PermissionDenied,
            "This item belongs to another account.",
        ),
        StorageError::Missing => {
            io::Error::new(io::ErrorKind::NotFound, "File or message not found.")
        }
        StorageError::Quota => {
            io::Error::new(io::ErrorKind::StorageFull, "Allocated storage is full.")
        }
        StorageError::Conflict => {
            io::Error::new(io::ErrorKind::AlreadyExists, "Message already exists.")
        }
        StorageError::Offset(offset) => io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Upload offset does not match ({offset})."),
        ),
        StorageError::Invalid(message) => bad_request(message),
        StorageError::Io(error) => error,
    }
}

fn storage_json_error(output: &mut TcpStream, error: StorageError) -> io::Result<()> {
    match error {
        StorageError::Forbidden => forbidden(output),
        StorageError::Missing => not_found(output, "File or message not found."),
        StorageError::Quota => response_json_with_status(
            output,
            413,
            json!({ "error": "Allocated storage is full." }),
        ),
        StorageError::Conflict => {
            response_json_with_status(output, 409, json!({ "error": "Message already exists." }))
        }
        StorageError::Offset(offset) => response_json_with_headers(
            output,
            409,
            json!({ "error": "Upload offset does not match." }),
            [("Upload-Offset".to_owned(), offset.to_string())],
        ),
        StorageError::Invalid(message) => {
            response_json_with_status(output, 400, json!({ "error": message }))
        }
        StorageError::Io(error) => {
            crate::ui::warning(&format!("Storage I/O error: {error}"));
            response_json_with_status(
                output,
                500,
                json!({ "error": "Nodo storage could not complete the request." }),
            )
        }
    }
}

fn storage_tus_error(output: &mut TcpStream, error: StorageError) -> io::Result<()> {
    match error {
        StorageError::Forbidden => {
            tus_error(output, 403, "This upload belongs to another account.", [])
        }
        StorageError::Missing => tus_error(output, 404, "Upload not found.", []),
        StorageError::Quota => tus_error(output, 413, "Allocated storage is full.", []),
        StorageError::Conflict => tus_error(output, 409, "Upload already exists.", []),
        StorageError::Offset(offset) => tus_error(
            output,
            409,
            "Upload offset does not match.",
            [("Upload-Offset".to_owned(), offset.to_string())],
        ),
        StorageError::Invalid(message) => tus_error(output, 400, message, []),
        StorageError::Io(error) => {
            crate::ui::warning(&format!("Storage I/O error: {error}"));
            tus_error(
                output,
                500,
                "Nodo storage could not complete the request.",
                [],
            )
        }
    }
}
fn query_usize(
    request: &Request,
    name: &str,
    default: usize,
    range: std::ops::RangeInclusive<usize>,
) -> io::Result<usize> {
    let value = request.query.get(name).map_or(Ok(default), |value| {
        value
            .parse::<usize>()
            .map_err(|_| bad_request("Query value is invalid."))
    })?;
    if range.contains(&value) {
        Ok(value)
    } else {
        Err(bad_request("Query value is invalid."))
    }
}
fn query_usize_opt(request: &Request, name: &str) -> io::Result<Option<usize>> {
    request
        .query
        .get(name)
        .map(|value| {
            value
                .parse::<usize>()
                .map_err(|_| bad_request("Cursor is invalid."))
        })
        .transpose()
}
fn valid_id(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok() && value.len() == 36
}
fn percent_decode(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(value as char);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index] as char);
        index += 1;
    }
    output
}
fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn transfer_conditions_available(policy: &Config) -> bool {
    let (_, charging) = crate::heartbeat::battery_snapshot();
    let (network, _, _) = crate::heartbeat::network_snapshot();
    (!policy.wifi_only || network == "wifi") && (!policy.charging_only || charging.unwrap_or(true))
}
fn now_millis() -> i64 {
    unix_seconds() * 1_000
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskBenchmark {
    pub completed_at: i64,
    pub read_bps: u64,
    pub write_bps: u64,
}

pub fn quick_disk_test(root: &std::path::Path) -> io::Result<DiskBenchmark> {
    std::fs::create_dir_all(root)?;
    let path = root.join(".nodo-benchmark.tmp");
    let buffer = [0x5a_u8; 256 * 1024];
    let bytes = 4 * 1024 * 1024_u64;
    let started = std::time::Instant::now();
    let mut file = std::fs::File::create(&path)?;
    let mut written = 0;
    while written < bytes {
        file.write_all(&buffer)?;
        written += buffer.len() as u64;
    }
    file.sync_all()?;
    let write_nanos = started.elapsed().as_nanos() as u64;
    let started = std::time::Instant::now();
    let mut file = std::fs::File::open(&path)?;
    let mut checksum = 0_u8;
    loop {
        let count = file.read(&mut [0_u8; 256 * 1024])?;
        if count == 0 {
            break;
        }
        checksum ^= count as u8;
    }
    let read_nanos = started.elapsed().as_nanos() as u64;
    let _ = checksum;
    let _ = std::fs::remove_file(path);
    Ok(DiskBenchmark {
        completed_at: unix_seconds(),
        read_bps: bytes
            .saturating_mul(1_000_000_000)
            .checked_div(read_nanos.max(1))
            .unwrap_or(1),
        write_bps: bytes
            .saturating_mul(1_000_000_000)
            .checked_div(write_nanos.max(1))
            .unwrap_or(1),
    })
}
