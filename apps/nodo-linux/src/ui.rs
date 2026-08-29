use crate::config::Config;
use crate::service::NodeStatus;
use std::io::{self, IsTerminal, Read, Write};

const RESET: &str = "\x1b[0m";
const DIM: &str = "\x1b[2m";
const GREEN: &str = "\x1b[38;5;78m";
const AMBER: &str = "\x1b[38;5;221m";
const RED: &str = "\x1b[38;5;203m";
const TEAL: &str = "\x1b[38;5;116m";

fn color(code: &str, value: &str) -> String {
    if io::stdout().is_terminal() {
        format!("{code}{value}{RESET}")
    } else {
        value.to_owned()
    }
}

pub fn banner(version: &str) {
    println!();
    println!(
        "{}",
        color(TEAL, "  ╭────────────────────────────────────────────╮")
    );
    println!(
        "{}",
        color(TEAL, &format!("  │  Kaordo Nodo · Linux · {version:<15} │"))
    );
    println!(
        "{}",
        color(TEAL, "  │  local-first storage host                 │")
    );
    println!(
        "{}",
        color(TEAL, "  ╰────────────────────────────────────────────╯")
    );
    println!();
}

pub fn help(version: &str) {
    banner(version);
    println!("{}", color(TEAL, "USAGE"));
    println!("  kaordo-nodo <command> [options]\n");
    println!("{}", color(TEAL, "SETUP"));
    println!("  login                  Sign in and save a protected local session");
    println!("  logout                 Remove the local session and keep stored payloads");
    println!("  setup                  Allocate total storage; client manages the split");
    println!();
    println!("{}", color(TEAL, "RUNNING"));
    println!("  run                    Run directly in this terminal");
    println!(
        "  start                  Run in the background (systemd user service when available)"
    );
    println!("  stop | restart         Stop or restart the background node");
    println!("  status [--json]         Show local status and storage usage");
    println!("  install-service         Install the user-level systemd unit");
    println!("  uninstall-service      Remove the user-level systemd unit");
    println!();
    println!("{}", color(TEAL, "MAINTENANCE"));
    println!("  update                  Check for a SHA-256 verified release");
    println!("  update --apply          Download, verify and atomically install an update");
    println!();
    println!("{}", color(TEAL, "INFO"));
    println!("  version                Print the node version");
    println!();
    println!("{}", color(DIM, "Examples:"));
    println!("  kaordo-nodo login");
    println!("  kaordo-nodo setup --quota 30GiB");
    println!("  kaordo-nodo start");
}

pub fn success(message: &str) {
    println!("{} {}", color(GREEN, "✓"), message);
}

pub fn error(message: &str) {
    eprintln!("{} {}", color(RED, "✗"), message);
}

pub fn warning(message: &str) {
    eprintln!("{} {}", color(AMBER, "!"), message);
}

pub fn prompt(label: &str) -> io::Result<String> {
    print!("{label}");
    io::stdout().flush()?;
    let mut value = String::new();
    io::stdin().read_line(&mut value)?;
    Ok(value.trim().to_owned())
}

pub fn prompt_password(label: &str) -> io::Result<String> {
    if !io::stdin().is_terminal() {
        return prompt(label);
    }
    print!("{label}");
    io::stdout().flush()?;
    let _ = std::process::Command::new("stty").arg("-echo").status();
    let mut value = String::new();
    let result = io::stdin().read_line(&mut value);
    let _ = std::process::Command::new("stty").arg("echo").status();
    println!();
    result.map(|_| value.trim_end_matches(['\r', '\n']).to_owned())
}

pub fn allocation(config: &Config) {
    println!("\n{}", color(TEAL, "Storage allocation"));
    println!("  Node       {}", config.device_name);
    println!("  Port       {}", config.port);
    println!("  Data       {}", config.data_dir.display());
    println!("  Total      {}", format_bytes(config.quota_bytes));
    println!("  Split      Managed by Kaordo client after heartbeat");
}

pub fn status(config: &Config, status: &NodeStatus) {
    let state = if status.online {
        color(GREEN, "online")
    } else {
        color(AMBER, "offline")
    };
    println!("{}  {}", color(TEAL, "Kaordo Nodo"), state);
    println!("  Name       {}", config.device_name);
    println!(
        "  Node ID    {}",
        config.node_id.as_deref().unwrap_or("pending heartbeat")
    );
    println!("  Endpoint   0.0.0.0:{}", config.port);
    println!("  Data       {}", config.data_dir.display());
    println!(
        "  Used       {} / {}",
        format_bytes(status.used_bytes),
        format_bytes(config.quota_bytes)
    );
    println!(
        "  Private    {} / {}",
        format_bytes(status.private_used_bytes),
        format_bytes(config.private_quota_bytes)
    );
    println!(
        "  Public     {} / {}",
        format_bytes(status.public_used_bytes),
        format_bytes(config.public_quota_bytes)
    );
    if let Some(message) = &status.message {
        println!("  Note       {}", message);
    }
}

pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[allow(dead_code)]
pub fn read_all_stdin() -> io::Result<String> {
    let mut value = String::new();
    io::stdin().read_to_string(&mut value)?;
    Ok(value)
}
