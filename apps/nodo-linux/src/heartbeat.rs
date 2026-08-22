use crate::auth;
use crate::config::{Config, ConfigStore};
use crate::server::{DiskBenchmark, NodeRuntime};
use crate::storage::{NodeStorage, Space};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io;
use std::net::{IpAddr, UdpSocket};
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reconciliation {
    pub deleted_ligo_message_ids: Vec<String>,
    pub deleted_public_post_ids: Vec<String>,
    pub released_public_reservation_ids: Vec<String>,
}

impl Reconciliation {
    pub fn load(root: &Path) -> Self {
        fs::read(root.join(".reconciliation.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }
    pub fn save(&self, root: &Path) -> io::Result<()> {
        let path = root.join(".reconciliation.json");
        let temporary = root.join(".reconciliation.json.tmp");
        fs::write(
            &temporary,
            serde_json::to_vec(self)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?,
        )?;
        fs::rename(temporary, path)
    }
    pub fn add_ligo(&mut self, id: &str) {
        push_unique(&mut self.deleted_ligo_message_ids, id);
    }
    pub fn add_post(&mut self, id: &str) {
        push_unique(&mut self.deleted_public_post_ids, id);
    }
    pub fn add_reservation(&mut self, id: &str) {
        push_unique(&mut self.released_public_reservation_ids, id);
    }
}

fn push_unique(values: &mut Vec<String>, id: &str) {
    if values.len() < 64 && !values.iter().any(|value| value == id) {
        values.push(id.to_owned());
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatResponse {
    #[serde(default = "default_heartbeat_seconds")]
    heartbeat_after_seconds: u64,
    node_id: String,
    device_name: Option<String>,
    policy: Policy,
    spaces: Spaces,
    #[serde(default)]
    ligo_delete_messages: Vec<Deletion>,
    #[serde(default)]
    public_delete_post_ids: Vec<String>,
    #[serde(default)]
    run_quick_test: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct Deletion {
    id: String,
    storage: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub allow_downloads: bool,
    pub allow_uploads: bool,
    pub charging_only: bool,
    pub wifi_only: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct Spaces {
    private: Quota,
    public: Quota,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Quota {
    quota_bytes: u64,
    #[serde(rename = "usedBytes")]
    _used_bytes: u64,
}

pub fn spawn(
    config: Arc<RwLock<Config>>,
    store: ConfigStore,
    runtime: Arc<NodeRuntime>,
) -> thread::JoinHandle<()> {
    thread::Builder::new()
        .name("kaordo-nodo-heartbeat".to_owned())
        .spawn(move || {
            let mut wait_seconds = 10_u64;
            let mut reconciliation = {
                let config = config.read().ok().map(|value| value.data_dir.clone());
                config
                    .map(|root| Reconciliation::load(&root))
                    .unwrap_or_default()
            };
            loop {
                let snapshot = config.read().ok().map(|value| value.clone());
                let Some(snapshot) = snapshot else {
                    break;
                };
                let Some(token) = snapshot.token.clone() else {
                    break;
                };
                let storage = runtime.storage.read().ok();
                let Some(storage) = storage else {
                    break;
                };
                let benchmark = runtime
                    .benchmark
                    .read()
                    .ok()
                    .and_then(|value| value.clone());
                let coordinator_latency_ms = runtime
                    .coordinator_latency_ms
                    .read()
                    .ok()
                    .and_then(|value| *value);
                let metrics = metrics(
                    &snapshot.data_dir,
                    benchmark.as_ref(),
                    coordinator_latency_ms,
                );
                let started = std::time::Instant::now();
                let result = send_heartbeat(
                    &snapshot,
                    &token,
                    &storage,
                    &metrics,
                    benchmark.as_ref().map(|value| value.completed_at),
                    &reconciliation,
                );
                drop(storage);
                match result {
                    Ok(response) => {
                        let had_latency = coordinator_latency_ms.is_some();
                        if let Ok(mut latency) = runtime.coordinator_latency_ms.write() {
                            *latency =
                                Some(started.elapsed().as_millis().try_into().unwrap_or(u64::MAX));
                        }
                        if let Ok(mut current) = config.write() {
                            current.node_id = Some(response.node_id.clone());
                            if let Some(name) = response.device_name.clone() {
                                current.device_name = name;
                            }
                            current.allow_downloads = response.policy.allow_downloads;
                            current.allow_uploads = response.policy.allow_uploads;
                            current.charging_only = response.policy.charging_only;
                            current.wifi_only = response.policy.wifi_only;
                            current.public_quota_bytes = response.spaces.public.quota_bytes;
                            current.private_quota_bytes = response.spaces.private.quota_bytes;
                            current.quota_bytes = response
                                .spaces
                                .public
                                .quota_bytes
                                .saturating_add(response.spaces.private.quota_bytes);
                            let _ = store.save(&current);
                        }
                        if let Ok(mut storage) = runtime.storage.write() {
                            let _ = storage.set_quotas(
                                response.spaces.public.quota_bytes,
                                response.spaces.private.quota_bytes,
                            );
                        }
                        let heartbeat_after = response.heartbeat_after_seconds.clamp(30, 300);
                        let run_quick_test = response.run_quick_test;
                        reconciliation = apply_deletions(&runtime, response, reconciliation);
                        if let Ok(current) = config.read() {
                            let _ = reconciliation.save(&current.data_dir);
                        }
                        if run_quick_test {
                            let completed = match crate::server::quick_disk_test(&snapshot.data_dir)
                            {
                                Ok(result) => {
                                    if let Ok(mut benchmark) = runtime.benchmark.write() {
                                        *benchmark = Some(result);
                                    }
                                    true
                                }
                                Err(error) => {
                                    crate::ui::warning(&format!(
                                        "Coordinator disk test failed: {error}"
                                    ));
                                    false
                                }
                            };
                            wait_seconds = if completed { 1 } else { heartbeat_after };
                        } else {
                            // Send one immediate follow-up heartbeat after a
                            // fresh session so the first visible telemetry
                            // also contains the measured coordinator RTT.
                            wait_seconds = if had_latency { heartbeat_after } else { 1 };
                        }
                    }
                    Err(error) => {
                        crate::ui::warning(&format!("Coordinator heartbeat failed: {error}"));
                        wait_seconds = (wait_seconds.saturating_mul(2)).min(300);
                    }
                }
                thread::sleep(Duration::from_secs(wait_seconds));
            }
        })
        .expect("heartbeat thread could not start")
}

pub fn spawn_cleanup(
    config: Arc<RwLock<Config>>,
    runtime: Arc<NodeRuntime>,
) -> thread::JoinHandle<()> {
    thread::Builder::new()
        .name("kaordo-nodo-cleanup".to_owned())
        .spawn(move || {
            loop {
                thread::sleep(Duration::from_secs(6 * 60 * 60));
                let Some(snapshot) = config.read().ok().map(|value| value.clone()) else {
                    break;
                };
                let mut reconciliation = Reconciliation::load(&snapshot.data_dir);
                if let Ok(storage) = runtime.storage.write() {
                    let private = storage
                        .space(Space::Private)
                        .cleanup_stale(24 * 60 * 60 * 1_000)
                        .ok();
                    let public = storage
                        .space(Space::Public)
                        .cleanup_stale(24 * 60 * 60 * 1_000)
                        .ok();
                    let results = private.into_iter().chain(public).collect::<Vec<_>>();
                    let mut deleted_bytes = 0_u64;
                    let mut deleted_uploads = 0_usize;
                    for result in results {
                        deleted_bytes = deleted_bytes.saturating_add(result.deleted_bytes);
                        deleted_uploads = deleted_uploads.saturating_add(result.deleted_uploads);
                        for id in result.public_reservation_ids {
                            reconciliation.add_reservation(&id);
                        }
                    }
                    if deleted_uploads > 0 {
                        crate::ui::success(&format!(
                            "Cleanup removed {deleted_uploads} stale upload(s) ({deleted_bytes} bytes)."
                        ));
                    }
                }
                let _ = reconciliation.save(&snapshot.data_dir);
            }
        })
        .expect("cleanup thread could not start")
}

fn send_heartbeat(
    config: &Config,
    token: &str,
    storage: &NodeStorage,
    metrics: &Metrics,
    test_completed_at: Option<i64>,
    reconciliation: &Reconciliation,
) -> Result<HeartbeatResponse, Box<dyn std::error::Error>> {
    let private_used = storage.space(Space::Private).used_bytes()?;
    let public_used = storage.space(Space::Public).used_bytes()?;
    let body = json!({
        "nodeId": config.node_id,
        "deviceKey": config.device_key,
        "slotKey": config.slot_key,
        "deviceName": config.device_name.chars().take(80).collect::<String>(),
        "localAddresses": local_addresses(),
        "port": config.port,
        "protocol": "tus/1.0.0",
        "quotaBytes": config.quota_bytes,
        "usedBytes": private_used.saturating_add(public_used),
        "spaces": { "privateUsedBytes": private_used, "publicUsedBytes": public_used },
        "metrics": metrics,
        "testCompletedAt": test_completed_at,
        "deletedLigoMessageIds": reconciliation.deleted_ligo_message_ids,
        "deletedPublicPostIds": reconciliation.deleted_public_post_ids,
        "releasedPublicReservationIds": reconciliation.released_public_reservation_ids,
    });
    let response = auth::client(30)?
        .post(format!(
            "{}/api/nodes/heartbeat",
            config.api_origin.trim_end_matches('/')
        ))
        .bearer_auth(token)
        .json(&body)
        .send()?;
    if !response.status().is_success() {
        return Err(format!("Coordinator returned {}.", response.status()).into());
    }
    Ok(response.json()?)
}

fn apply_deletions(
    runtime: &Arc<NodeRuntime>,
    response: HeartbeatResponse,
    mut reconciliation: Reconciliation,
) -> Reconciliation {
    if let Ok(mut storage) = runtime.storage.write() {
        for deletion in response.ligo_delete_messages {
            let space = if deletion.storage == "public" {
                Space::Public
            } else {
                Space::Private
            };
            if storage
                .space(space)
                .delete_envelope_for_cleanup(&deletion.id)
                .unwrap_or(false)
            {
                reconciliation.add_ligo(&deletion.id);
            }
        }
        for post_id in response.public_delete_post_ids {
            if storage
                .space_mut(Space::Public)
                .delete_post(&post_id, "", true)
                .unwrap_or(None)
                .is_some()
            {
                reconciliation.add_post(&post_id);
            }
        }
    }
    reconciliation
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Metrics {
    android_sdk: Option<u32>,
    app_version: String,
    battery_percent: Option<u8>,
    charging: Option<bool>,
    coordinator_latency_ms: Option<u64>,
    disk_read_bps: Option<u64>,
    disk_write_bps: Option<u64>,
    memory_available_bytes: Option<u64>,
    memory_total_bytes: Option<u64>,
    network_metered: Option<bool>,
    network_down_bps: Option<u64>,
    network_type: String,
    network_up_bps: Option<u64>,
    storage_available_bytes: u64,
}

fn metrics(
    data_dir: &Path,
    benchmark: Option<&DiskBenchmark>,
    coordinator_latency_ms: Option<u64>,
) -> Metrics {
    let (memory_total, memory_available) = memory_snapshot();
    let network = network_info();
    let battery = battery_info();
    Metrics {
        android_sdk: None,
        app_version: crate::VERSION.to_owned(),
        battery_percent: battery.percent,
        charging: battery.charging,
        coordinator_latency_ms,
        disk_read_bps: benchmark.map(|value| value.read_bps),
        disk_write_bps: benchmark.map(|value| value.write_bps),
        memory_available_bytes: Some(memory_available),
        memory_total_bytes: Some(memory_total),
        network_metered: None,
        network_down_bps: network.speed_bps,
        network_type: network.kind,
        network_up_bps: network.speed_bps,
        storage_available_bytes: crate::config::available_bytes(data_dir),
    }
}

pub(crate) fn memory_snapshot() -> (u64, u64) {
    let mut total = 0;
    let mut available = 0;
    if let Ok(value) = fs::read_to_string("/proc/meminfo") {
        for line in value.lines() {
            let mut pieces = line.split_whitespace();
            match pieces.next() {
                Some("MemTotal:") => {
                    total = pieces
                        .next()
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or_default()
                        * 1024
                }
                Some("MemAvailable:") => {
                    available = pieces
                        .next()
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or_default()
                        * 1024
                }
                _ => {}
            }
        }
    }
    (total, available)
}

pub(crate) fn battery_snapshot() -> (Option<u8>, Option<bool>) {
    let battery = battery_info();
    (battery.percent, battery.charging)
}

pub(crate) fn network_snapshot() -> (String, Option<u64>, Option<u64>) {
    let network = network_info();
    (network.kind, network.speed_bps, network.speed_bps)
}

pub(crate) fn measure_coordinator_latency(api_origin: &str) -> io::Result<u64> {
    let fresh = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let started = Instant::now();
    let response = auth::client(3)
        .map_err(io::Error::other)?
        .get(format!(
            "{}/api/health?fresh={fresh}",
            api_origin.trim_end_matches('/')
        ))
        .header("Cache-Control", "no-cache, no-store")
        .send()
        .map_err(io::Error::other)?;
    if !response.status().is_success() {
        return Err(io::Error::other("Coordinator latency test failed."));
    }
    Ok(started.elapsed().as_millis().try_into().unwrap_or(u64::MAX))
}

#[derive(Debug, Clone, Default)]
struct BatteryInfo {
    percent: Option<u8>,
    charging: Option<bool>,
}

fn battery_info() -> BatteryInfo {
    let Some(entry) = fs::read_dir("/sys/class/power_supply")
        .ok()
        .and_then(|entries| {
            entries
                .filter_map(Result::ok)
                .find(|entry| entry.file_name().to_string_lossy().starts_with("BAT"))
        })
    else {
        return BatteryInfo::default();
    };
    let percent = fs::read_to_string(entry.path().join("capacity"))
        .ok()
        .and_then(|value| value.trim().parse::<u8>().ok())
        .filter(|value| *value <= 100);
    let charging = fs::read_to_string(entry.path().join("status"))
        .ok()
        .and_then(|value| match value.trim() {
            "Charging" | "Full" => Some(true),
            "Discharging" | "Not charging" => Some(false),
            _ => None,
        });
    BatteryInfo { percent, charging }
}

#[derive(Debug, Clone)]
struct NetworkInfo {
    kind: String,
    speed_bps: Option<u64>,
}

fn network_info() -> NetworkInfo {
    let Some(interface) = default_interface() else {
        return NetworkInfo {
            kind: "offline".to_owned(),
            speed_bps: None,
        };
    };
    let kind = if interface == "lo" {
        "offline"
    } else if Path::new("/sys/class/net")
        .join(&interface)
        .join("wireless")
        .exists()
    {
        "wifi"
    } else {
        "ethernet"
    };
    let speed_bps = interface_speed_bps(&interface);
    NetworkInfo {
        kind: kind.to_owned(),
        speed_bps,
    }
}

fn interface_speed_bps(interface: &str) -> Option<u64> {
    let sysfs_speed = fs::read_to_string(Path::new("/sys/class/net").join(interface).join("speed"))
        .ok()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .filter(|value| *value > 0)
        .and_then(|value| u64::try_from(value).ok())
        .and_then(|megabits| megabits.checked_mul(1_000_000));
    if sysfs_speed.is_some() {
        return sysfs_speed;
    }

    let output = std::process::Command::new("ethtool")
        .arg(interface)
        .output()
        .ok()?;
    output.stdout.split(|byte| *byte == b'\n').find_map(|line| {
        let text = std::str::from_utf8(line).ok()?;
        let (label, value) = text.split_once(':')?;
        if !label.trim().eq_ignore_ascii_case("speed") {
            return None;
        }
        let number = value
            .trim()
            .split(|character: char| !character.is_ascii_digit())
            .find(|part| !part.is_empty())?
            .parse::<u64>()
            .ok()?;
        let multiplier = if value.contains("Gb/s") || value.contains("Gbit") {
            1_000_000_000
        } else if value.contains("Mb/s") || value.contains("Mbit") {
            1_000_000
        } else if value.contains("Kb/s") || value.contains("Kbit") {
            1_000
        } else {
            1
        };
        number.checked_mul(multiplier)
    })
}

fn default_interface() -> Option<String> {
    if let Ok(routes) = fs::read_to_string("/proc/net/route") {
        let routed = routes.lines().skip(1).find_map(|line| {
            let mut fields = line.split_whitespace();
            let interface = fields.next()?;
            let destination = fields.next()?;
            let flags = u16::from_str_radix(fields.nth(1)?, 16).ok()?;
            (destination == "00000000" && flags & 0x2 != 0).then(|| interface.to_owned())
        });
        if routed.is_some() {
            return routed;
        }

        // Some VPS images omit gateway flags in /proc/net/route. The
        // destination is still authoritative, so accept a default route
        // without requiring the optional flag bit.
        if let Some(interface) = routes.lines().skip(1).find_map(|line| {
            let mut fields = line.split_whitespace();
            let interface = fields.next()?;
            let destination = fields.next()?;
            (destination == "00000000").then(|| interface.to_owned())
        }) {
            return Some(interface);
        }
    }

    // Fall back to the route command and finally to an operational sysfs
    // interface. This covers containers where /proc/net/route is unavailable
    // or does not expose a usable gateway row.
    if let Ok(output) = std::process::Command::new("ip")
        .args(["-o", "route", "show", "default"])
        .output()
    {
        let output_text = String::from_utf8_lossy(&output.stdout);
        let mut fields = output_text.split_whitespace();
        if fields.position(|field| field == "dev").is_some() {
            if let Some(interface) = fields.next() {
                return Some(interface.to_owned());
            }
        }
    }

    fs::read_dir("/sys/class/net")
        .ok()?
        .filter_map(Result::ok)
        .find_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == "lo" {
                return None;
            }
            let state = fs::read_to_string(entry.path().join("operstate")).ok();
            let carrier = fs::read_to_string(entry.path().join("carrier")).ok();
            (state.as_deref().map(str::trim) == Some("up")
                || carrier.as_deref().map(str::trim) == Some("1"))
            .then_some(name)
        })
}

fn local_addresses() -> Vec<String> {
    let mut values = std::process::Command::new("hostname")
        .args(["-I"])
        .output()
        .ok()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .split_whitespace()
                .filter_map(|value| value.parse::<IpAddr>().ok())
                .filter(|address| !address.is_loopback() && !address.is_unspecified())
                .map(|address| address.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if values.is_empty() {
        for (bind, target) in [
            ("0.0.0.0:0", "8.8.8.8:80"),
            ("[::]:0", "[2001:4860:4860::8888]:80"),
        ] {
            let Ok(socket) = UdpSocket::bind(bind) else {
                continue;
            };
            if socket.connect(target).is_ok() {
                if let Ok(address) = socket.local_addr() {
                    let ip = address.ip();
                    if !ip.is_loopback() && !ip.is_unspecified() {
                        values.push(ip.to_string());
                    }
                }
            }
            if !values.is_empty() {
                break;
            }
        }
    }
    values.sort_unstable();
    values.dedup();
    values.truncate(16);
    values
}

fn default_heartbeat_seconds() -> u64 {
    120
}
