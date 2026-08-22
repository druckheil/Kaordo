use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const DEFAULT_API_ORIGIN: &str = "https://veridimensio-api.pshenychnyi-ld.workers.dev";
const DEFAULT_PORT: u16 = 49_321;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub api_origin: String,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub user: Option<User>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub device_key: String,
    #[serde(default = "default_slot")]
    pub slot_key: String,
    #[serde(default)]
    pub device_name: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub quota_bytes: u64,
    #[serde(default)]
    pub public_quota_bytes: u64,
    #[serde(default)]
    pub private_quota_bytes: u64,
    #[serde(default)]
    pub data_dir: PathBuf,
    #[serde(default = "default_true")]
    pub allow_downloads: bool,
    #[serde(default = "default_true")]
    pub allow_uploads: bool,
    #[serde(default)]
    pub charging_only: bool,
    #[serde(default)]
    pub wifi_only: bool,
    #[serde(default)]
    pub update_manifest_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub created_at: i64,
    pub id: String,
    pub role: String,
    pub username: String,
}

impl Default for Config {
    fn default() -> Self {
        let data_dir = default_data_dir();
        let host = hostname();
        Self {
            api_origin: DEFAULT_API_ORIGIN.to_owned(),
            token: None,
            user: None,
            node_id: None,
            device_key: String::new(),
            slot_key: "primary".to_owned(),
            device_name: format!("Kaordo Nodo on {host}"),
            port: DEFAULT_PORT,
            quota_bytes: 0,
            public_quota_bytes: 0,
            private_quota_bytes: 0,
            data_dir,
            allow_downloads: true,
            allow_uploads: true,
            charging_only: false,
            wifi_only: false,
            update_manifest_url: None,
        }
    }
}

impl Config {
    pub fn ensure_identity(&mut self) {
        if self.device_key.len() != 64
            || !self.device_key.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            let seed = format!("kaordo-linux:{}:{}", hostname(), Uuid::new_v4());
            self.device_key = hex(&Sha256::digest(seed.as_bytes()));
        }
        if self.slot_key.is_empty() {
            self.slot_key = "primary".to_owned();
        }
        if self.device_name.trim().is_empty() {
            self.device_name = format!("Kaordo Nodo on {}", hostname());
        }
    }

    pub fn available_bytes(&self) -> u64 {
        available_bytes(&self.data_dir)
    }

    pub fn disk_space(&self) -> DiskSpace {
        disk_space(&self.data_dir)
    }

    pub fn validate_ready(&self) -> Result<(), Box<dyn std::error::Error>> {
        if self.token.as_deref().unwrap_or_default().is_empty() || self.user.is_none() {
            return Err("Nodo session is missing. Run 'kaordo-nodo login'.".into());
        }
        if self.quota_bytes == 0
            || self
                .public_quota_bytes
                .saturating_add(self.private_quota_bytes)
                != self.quota_bytes
        {
            return Err("Nodo storage is not configured. Run 'kaordo-nodo setup --quota 10GiB --private 10GiB'.".into());
        }
        if self.port == 0 {
            return Err("Nodo port is invalid.".into());
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct ConfigStore {
    path: PathBuf,
}

impl ConfigStore {
    pub fn new() -> io::Result<Self> {
        let path = env::var_os("KAORDO_NODO_CONFIG")
            .map(PathBuf::from)
            .unwrap_or_else(default_config_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> io::Result<Option<Config>> {
        if !self.path.is_file() {
            return Ok(None);
        }
        let bytes = fs::read(&self.path)?;
        let mut config: Config = serde_json::from_slice(&bytes)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if config.api_origin.trim().is_empty() {
            config.api_origin = DEFAULT_API_ORIGIN.to_owned();
        }
        if config.data_dir.as_os_str().is_empty() {
            config.data_dir = default_data_dir();
        }
        config.ensure_identity();
        Ok(Some(config))
    }

    pub fn save(&self, config: &Config) -> io::Result<()> {
        let temporary = self.path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(config)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        std::io::Write::write_all(&mut file, &bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, &self.path)?;
        #[cfg(unix)]
        fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))?;
        Ok(())
    }
}

pub fn default_config_path() -> PathBuf {
    env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".config"))
        .join("kaordo")
        .join("nodo.json")
}

pub fn default_data_dir() -> PathBuf {
    env::var_os("KAORDO_NODO_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home_dir().join(".local").join("share"))
                .join("kaordo")
                .join("nodo")
        })
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DiskSpace {
    pub total_bytes: u64,
    pub available_bytes: u64,
}

pub fn disk_space(path: &Path) -> DiskSpace {
    let _ = fs::create_dir_all(path);
    let target = path.to_string_lossy();
    let output = std::process::Command::new("df")
        .args(["-Pk", target.as_ref()])
        .output();
    output
        .ok()
        .and_then(|output| {
            let text = String::from_utf8_lossy(&output.stdout);
            let fields = text.lines().nth(1)?.split_whitespace().collect::<Vec<_>>();
            Some(DiskSpace {
                total_bytes: fields.get(1)?.parse::<u64>().ok()?.saturating_mul(1_024),
                available_bytes: fields.get(3)?.parse::<u64>().ok()?.saturating_mul(1_024),
            })
        })
        .unwrap_or_default()
}

pub fn available_bytes(path: &Path) -> u64 {
    disk_space(path).available_bytes
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn hostname() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|value| !value.is_empty())
        .or_else(|| env::var("HOSTNAME").ok())
        .unwrap_or_else(|| "Linux".to_owned())
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

fn default_slot() -> String {
    "primary".to_owned()
}

fn default_true() -> bool {
    true
}

fn hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from_digit((byte >> 4) as u32, 16).unwrap_or('0'));
        output.push(char::from_digit((byte & 0xf) as u32, 16).unwrap_or('0'));
    }
    output
}

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
