use crate::config::{Config, ConfigStore};
use crate::heartbeat;
use crate::server::NodeRuntime;
use crate::storage::NodeStorage;
use serde::Serialize;
use std::fs::{self, File};
use std::io;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub struct ServiceOptions {
    pub foreground: bool,
    pub requested_port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatus {
    pub online: bool,
    pub used_bytes: u64,
    pub private_used_bytes: u64,
    pub public_used_bytes: u64,
    pub message: Option<String>,
}

pub struct NodeService {
    config: Config,
    store: ConfigStore,
}

impl NodeService {
    pub fn new(config: Config, store: ConfigStore) -> io::Result<Self> {
        Ok(Self { config, store })
    }

    pub fn run(mut self, options: ServiceOptions) -> Result<(), Box<dyn std::error::Error>> {
        self.config.port = options.requested_port;
        self.config.ensure_identity();
        self.config.validate_ready()?;
        fs::create_dir_all(&self.config.data_dir)?;
        let storage = NodeStorage::open(
            &self.config.data_dir,
            self.config.public_quota_bytes,
            self.config.private_quota_bytes,
        )?;
        let runtime = Arc::new(NodeRuntime::new(self.config.clone(), storage));
        let listeners = bind_listeners(self.config.port)?;
        let endpoints = listeners
            .iter()
            .filter_map(|listener| listener.local_addr().ok())
            .map(|address| address.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        crate::ui::success(&format!(
            "Listening on {} · {}",
            endpoints,
            self.config.data_dir.display()
        ));
        if !options.foreground {
            crate::ui::warning("The node is running without a service manager.");
        }
        let _heartbeat = heartbeat::spawn(
            runtime.config.clone(),
            self.store.clone(),
            Arc::clone(&runtime),
        );
        let _cleanup = heartbeat::spawn_cleanup(runtime.config.clone(), Arc::clone(&runtime));
        runtime.server(listeners)?;
        Ok(())
    }
}

/// Bind both address families when the host exposes IPv4 and IPv6.
///
/// A VPS may report only an IPv6 observed address to the coordinator. The
/// previous IPv4-only listener made that node look online in D1 while every
/// direct client request timed out. On Linux an IPv6 listener is often dual
/// stack, so an `AddrInUse` error for the second bind is expected and safe.
fn bind_listeners(port: u16) -> io::Result<Vec<TcpListener>> {
    let mut listeners = Vec::with_capacity(2);
    match TcpListener::bind(("::", port)) {
        Ok(listener) => listeners.push(listener),
        Err(ipv6_error) => {
            let listener = TcpListener::bind(("0.0.0.0", port)).map_err(|ipv4_error| {
                io::Error::new(
                    ipv4_error.kind(),
                    format!("could not bind IPv6 ({ipv6_error}) or IPv4 ({ipv4_error})"),
                )
            })?;
            listeners.push(listener);
            return Ok(listeners);
        }
    }

    match TcpListener::bind(("0.0.0.0", port)) {
        Ok(listener) => listeners.push(listener),
        Err(error) if error.kind() == io::ErrorKind::AddrInUse => {
            // The IPv6 socket is dual-stack on the common Linux default.
        }
        Err(error) => return Err(error),
    }
    Ok(listeners)
}

pub fn install_user_service() -> Result<(), Box<dyn std::error::Error>> {
    let store = ConfigStore::new()?;
    let unit_path = unit_path()?;
    let executable = std::env::current_exe()?;
    let config_environment = std::env::var_os("KAORDO_NODO_CONFIG")
        .map(|value| {
            format!(
                "Environment=\"KAORDO_NODO_CONFIG={}\"\n",
                systemd_escape(&value.to_string_lossy())
            )
        })
        .unwrap_or_default();
    let contents = format!(
        "[Unit]\nDescription=Kaordo Nodo (headless Linux host)\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\n{}ExecStart={} run\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=default.target\n",
        config_environment,
        shell_escape(executable.to_string_lossy().as_ref()),
    );
    if let Some(parent) = unit_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&unit_path, contents)?;
    let _ = systemctl(&["--user", "daemon-reload"]);
    crate::ui::success(&format!("Installed {}", unit_path.display()));
    let _ = store.path();
    Ok(())
}

pub fn uninstall_user_service() -> Result<(), Box<dyn std::error::Error>> {
    let unit_path = unit_path()?;
    let _ = systemctl(&["--user", "disable", "--now", "kaordo-nodo.service"]);
    if unit_path.exists() {
        fs::remove_file(&unit_path)?;
    }
    let _ = systemctl(&["--user", "daemon-reload"]);
    crate::ui::success("Removed the Kaordo Nodo user service.");
    Ok(())
}

pub fn start_background() -> Result<(), Box<dyn std::error::Error>> {
    let store = ConfigStore::new()?;
    let config = store.load()?.ok_or("Nodo is not configured yet.")?;
    config.validate_ready()?;
    if systemctl_available() {
        install_user_service()?;
        let result = systemctl(&["--user", "enable", "--now", "kaordo-nodo.service"])?;
        if !result.status.success() {
            return Err(String::from_utf8_lossy(&result.stderr)
                .trim()
                .to_owned()
                .into());
        }
    } else {
        if read_status(&config).online {
            return Err("Nodo is already running.".into());
        }
        let pid_path = pid_path()?;
        let log_path = runtime_log_path()?;
        if let Some(parent) = log_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let stdout = File::create(log_path)?;
        let stderr = stdout.try_clone()?;
        let child = Command::new(std::env::current_exe()?)
            .arg("run")
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr)
            .spawn()?;
        fs::write(pid_path, child.id().to_string())?;
    }
    crate::ui::success("Nodo started in the background.");
    Ok(())
}

pub fn stop_background() -> Result<(), Box<dyn std::error::Error>> {
    if systemctl_available() {
        let _ = systemctl(&["--user", "disable", "--now", "kaordo-nodo.service"]);
    } else {
        stop_pid()?;
    }
    crate::ui::success("Nodo stopped.");
    Ok(())
}

pub fn restart_background() -> Result<(), Box<dyn std::error::Error>> {
    if systemctl_available() {
        let result = systemctl(&["--user", "restart", "kaordo-nodo.service"])?;
        if !result.status.success() {
            return Err(String::from_utf8_lossy(&result.stderr)
                .trim()
                .to_owned()
                .into());
        }
    } else {
        stop_pid()?;
        start_background()?;
    }
    crate::ui::success("Nodo restarted.");
    Ok(())
}

pub fn read_status(config: &Config) -> NodeStatus {
    let storage = NodeStorage::open(
        &config.data_dir,
        config.public_quota_bytes,
        config.private_quota_bytes,
    );
    let (used, private_used, public_used) = storage
        .ok()
        .map(|storage| {
            (
                storage.used_bytes().unwrap_or_default(),
                storage
                    .space(crate::storage::Space::Private)
                    .used_bytes()
                    .unwrap_or_default(),
                storage
                    .space(crate::storage::Space::Public)
                    .used_bytes()
                    .unwrap_or_default(),
            )
        })
        .unwrap_or_default();
    let online = TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", config.port)
            .parse()
            .unwrap_or_else(|_| "127.0.0.1:49321".parse().expect("valid fallback")),
        Duration::from_millis(200),
    )
    .is_ok();
    NodeStatus {
        online,
        used_bytes: used,
        private_used_bytes: private_used,
        public_used_bytes: public_used,
        message: (!online).then(|| "The local listener is not reachable.".to_owned()),
    }
}

fn systemctl_available() -> bool {
    Command::new("systemctl")
        .arg("--user")
        .arg("--version")
        .output()
        .is_ok_and(|result| result.status.success())
}
fn systemctl(args: &[&str]) -> io::Result<std::process::Output> {
    Command::new("systemctl").args(args).output()
}

fn unit_path() -> io::Result<PathBuf> {
    Ok(std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".config")
        })
        .join("systemd/user/kaordo-nodo.service"))
}
fn pid_path() -> io::Result<PathBuf> {
    Ok(std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir())
        .join("kaordo-nodo.pid"))
}
fn runtime_log_path() -> io::Result<PathBuf> {
    Ok(std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".local/state")
        })
        .join("kaordo/nodo.log"))
}
fn stop_pid() -> io::Result<()> {
    let path = pid_path()?;
    let value = fs::read_to_string(&path).unwrap_or_default();
    if let Ok(pid) = value.trim().parse::<i32>() {
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
    let _ = fs::remove_file(path);
    Ok(())
}
fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn systemd_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
