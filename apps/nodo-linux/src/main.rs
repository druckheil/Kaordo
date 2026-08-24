#![forbid(unsafe_code)]

mod auth;
mod config;
mod heartbeat;
mod server;
mod service;
mod session_watch;
mod storage;
mod ui;
mod update;

use config::ConfigStore;
use service::{NodeService, ServiceOptions};
use std::env;
use std::path::PathBuf;

pub const VERSION: &str = "0.1.6-1a";

fn main() {
    if let Err(error) = dispatch(env::args().skip(1).collect()) {
        ui::error(&error.to_string());
        std::process::exit(1);
    }
}

fn dispatch(args: Vec<String>) -> Result<(), Box<dyn std::error::Error>> {
    match args.first().map(String::as_str) {
        None | Some("help") | Some("--help") | Some("-h") => {
            ui::help(VERSION);
            Ok(())
        }
        Some("version") | Some("--version") | Some("-V") => {
            println!("kaordo-nodo {VERSION}");
            Ok(())
        }
        Some("login") => login_command(&args[1..]),
        Some("logout") => logout_command(),
        Some("setup") => setup_command(&args[1..]),
        Some("run") => run_command(&args[1..]),
        Some("start") => service::start_background(),
        Some("stop") => service::stop_background(),
        Some("restart") => service::restart_background(),
        Some("status") => status_command(&args[1..]),
        Some("install-service") => service::install_user_service(),
        Some("uninstall-service") => service::uninstall_user_service(),
        Some("update") => update_command(&args[1..]),
        Some(command) => {
            Err(format!("Unknown command '{command}'. Run 'kaordo-nodo help'.").into())
        }
    }
}

fn logout_command() -> Result<(), Box<dyn std::error::Error>> {
    let store = ConfigStore::new()?;
    let Some(mut config) = store.load()? else {
        ui::success("No local Nodo session was found.");
        return Ok(());
    };
    config.token = None;
    config.user = None;
    config.node_id = None;
    store.save(&config)?;
    ui::success("Local Nodo session removed. Stored payloads were kept.");
    Ok(())
}

fn login_command(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mut username = option_value(args, "--username");
    let mut password = option_value(args, "--password");
    if username.is_none() {
        username = Some(ui::prompt("Username: ")?);
    }
    if password.is_none() {
        password = Some(ui::prompt_password("Password: ")?);
    }
    let store = ConfigStore::new()?;
    let mut config = store.load()?.unwrap_or_default();
    let result = auth::login(
        &config.api_origin,
        username.as_deref().unwrap_or_default(),
        password.as_deref().unwrap_or_default(),
    )?;
    config.user = Some(result.user);
    config.token = Some(result.session_token);
    config.ensure_identity();
    store.save(&config)?;
    ui::success("Signed in. The session was stored with owner-only permissions.");
    Ok(())
}

fn setup_command(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let store = ConfigStore::new()?;
    let mut config = store.load()?.unwrap_or_default();
    if config.token.is_none() {
        return Err("Run 'kaordo-nodo login' before setup.".into());
    }
    config.ensure_identity();
    if let Some(path) = option_value(args, "--data-dir") {
        config.data_dir = PathBuf::from(path);
    }
    if option_value(args, "--public").is_some() || option_value(args, "--private").is_some() {
        return Err(
            "Public/private allocation is managed by the Kaordo client. Use only --quota on Nodo."
                .into(),
        );
    }
    let interactive = option_value(args, "--quota").is_none();
    let quota = option_value(args, "--quota")
        .map(|value| parse_bytes(&value))
        .transpose()?
        .or_else(|| (!interactive && config.quota_bytes > 0).then_some(config.quota_bytes))
        .map_or_else(|| prompt_quota(&config), |value| Ok(value))?;
    let available = config.available_bytes();
    if quota == 0 || quota > available {
        return Err(format!(
            "Requested quota is larger than available disk space ({available} bytes)."
        )
        .into());
    }
    if let Some(name) = option_value(args, "--name") {
        config.device_name = name.trim().chars().take(80).collect();
    }
    if let Some(port) = option_value(args, "--port") {
        config.port = port
            .parse::<u16>()
            .map_err(|_| "--port must be between 1 and 65535.")?;
    }
    config.quota_bytes = quota;
    // The Kaordo client assigns public/private space through the coordinator
    // after the first heartbeat. Keep a valid private-only local layout until
    // that allocation arrives.
    config.public_quota_bytes = 0;
    config.private_quota_bytes = quota;
    store.save(&config)?;
    ui::allocation(&config);
    ui::success("Nodo configuration saved. Use 'kaordo-nodo run' or 'kaordo-nodo start'.");
    Ok(())
}

fn run_command(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let store = ConfigStore::new()?;
    let config = store
        .load()?
        .ok_or("Nodo is not configured. Run login and setup first.")?;
    config.validate_ready()?;
    let options = ServiceOptions {
        foreground: true,
        requested_port: option_value(args, "--port")
            .map(|value| value.parse())
            .transpose()?
            .unwrap_or(config.port),
    };
    ui::banner(VERSION);
    NodeService::new(config, store)?.run(options)
}

fn status_command(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let store = ConfigStore::new()?;
    let config = store.load()?.ok_or("Nodo is not configured yet.")?;
    let json = args.iter().any(|arg| arg == "--json");
    let status = service::read_status(&config);
    if json {
        println!("{}", serde_json::to_string_pretty(&status)?);
    } else {
        ui::status(&config, &status);
    }
    Ok(())
}

fn update_command(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let store = ConfigStore::new()?;
    let config = store.load()?.ok_or("Nodo is not configured yet.")?;
    let apply = args.iter().any(|arg| arg == "--apply");
    update::run(&config, apply)
}

fn option_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find_map(|pair| (pair[0] == name).then(|| pair[1].clone()))
}

fn parse_bytes(value: &str) -> Result<u64, Box<dyn std::error::Error>> {
    let normalized = value.trim().to_ascii_uppercase();
    let (number, multiplier) = if let Some(value) = normalized.strip_suffix("GIB") {
        (value, 1_u64 << 30)
    } else if let Some(value) = normalized.strip_suffix("GB") {
        (value, 1_000_000_000)
    } else if let Some(value) = normalized.strip_suffix('G') {
        (value, 1_u64 << 30)
    } else if let Some(value) = normalized.strip_suffix("MIB") {
        (value, 1_u64 << 20)
    } else if let Some(value) = normalized.strip_suffix("MB") {
        (value, 1_000_000)
    } else if let Some(value) = normalized.strip_suffix('M') {
        (value, 1_u64 << 20)
    } else if let Some(value) = normalized.strip_suffix("KIB") {
        (value, 1_u64 << 10)
    } else if let Some(value) = normalized.strip_suffix("KB") {
        (value, 1_000)
    } else {
        (normalized.as_str(), 1)
    };
    let number = number
        .trim()
        .parse::<f64>()
        .map_err(|_| "Storage value is invalid.")?;
    if !number.is_finite() || number < 0.0 {
        return Err("Storage value must be a non-negative number.".into());
    }
    let bytes = number * multiplier as f64;
    if bytes > u64::MAX as f64 {
        return Err("Storage value is too large.".into());
    }
    Ok(bytes.round() as u64)
}

fn prompt_bytes(label: &str) -> Result<u64, Box<dyn std::error::Error>> {
    let value = ui::prompt(label)?;
    let trimmed = value.trim();
    let is_plain_number = !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|character| character.is_ascii_digit() || character == '.');
    if is_plain_number {
        parse_bytes(&format!("{trimmed}g"))
    } else {
        parse_bytes(trimmed)
    }
}

fn prompt_quota(config: &config::Config) -> Result<u64, Box<dyn std::error::Error>> {
    let disk = config.disk_space();
    println!();
    println!(
        "Storage available: {} free of {} total.",
        ui::format_bytes(disk.available_bytes),
        ui::format_bytes(disk.total_bytes)
    );
    loop {
        let quota = prompt_bytes(&format!(
            "How much should this Nodo allocate? (available {} of {}; e.g. 10g): ",
            ui::format_bytes(disk.available_bytes),
            ui::format_bytes(disk.total_bytes)
        ))?;
        if quota == 0 {
            ui::warning("Allocated storage must be greater than zero.");
            continue;
        }
        if quota > disk.available_bytes {
            ui::warning(&format!(
                "That is more than the available {}. Choose a smaller amount.",
                ui::format_bytes(disk.available_bytes)
            ));
            continue;
        }
        return Ok(quota);
    }
}
