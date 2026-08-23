use crate::auth;
use crate::config::Config;
use crate::ui;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    #[serde(alias = "linuxX86_64Url", alias = "linux_x86_64_url")]
    linux_url: String,
    #[serde(alias = "linuxX86_64Sha256", alias = "linux_x86_64_sha256")]
    sha256: String,
    #[serde(default)]
    notes: Option<String>,
}

pub fn run(config: &Config, apply: bool) -> Result<(), Box<dyn std::error::Error>> {
    let url = config
        .update_manifest_url
        .clone()
        .unwrap_or_else(|| "https://kaordo.pages.dev/downloads/nodo-linux-0.1.5.json".to_owned());
    if !url.starts_with("https://") {
        return Err("Update manifest must use HTTPS.".into());
    }
    let manifest: Manifest = auth::client(20)?
        .get(&url)
        .send()?
        .error_for_status()?
        .json()?;
    let current = version_key(crate::VERSION);
    let available = version_key(&manifest.version);
    if available <= current {
        ui::success(&format!("Nodo is up to date ({})", crate::VERSION));
        return Ok(());
    }
    println!(
        "Update available: {} → {}",
        crate::VERSION,
        manifest.version
    );
    if let Some(ref notes) = manifest.notes {
        println!("  {notes}");
    }
    if !apply {
        println!("Run 'kaordo-nodo update --apply' to install it.");
        return Ok(());
    }
    apply_update(&manifest)
}

fn apply_update(manifest: &Manifest) -> Result<(), Box<dyn std::error::Error>> {
    if !manifest.linux_url.starts_with("https://") {
        return Err("Update artifact must use HTTPS.".into());
    }
    let response = auth::client(120)?
        .get(&manifest.linux_url)
        .send()?
        .error_for_status()?;
    let temporary = temporary_path()?;
    let mut file = File::create(&temporary)?;
    let mut reader = response;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        file.write_all(&buffer[..count])?;
        hash.update(&buffer[..count]);
    }
    file.sync_all()?;
    let actual = hex(&hash.finalize());
    let expected = manifest.sha256.trim().to_ascii_lowercase();
    if expected.len() != 64 || !constant_time_eq(&actual, &expected) {
        let _ = fs::remove_file(&temporary);
        return Err("Downloaded update failed SHA-256 verification.".into());
    }
    let target = std::env::current_exe()?;
    let backup = target.with_extension("old");
    if backup.exists() {
        fs::remove_file(&backup)?;
    }
    fs::rename(&target, &backup)?;
    if let Err(error) = fs::rename(&temporary, &target) {
        let _ = fs::rename(&backup, &target);
        return Err(error.into());
    }
    let permissions = fs::metadata(&backup)?.permissions();
    fs::set_permissions(&target, permissions)?;
    let _ = fs::remove_file(backup);
    ui::success("Update installed. Restart the background service to activate it.");
    Ok(())
}

fn temporary_path() -> io::Result<PathBuf> {
    let target = std::env::current_exe()?;
    Ok(target.with_extension("download.tmp"))
}

fn version_key(value: &str) -> (u64, u64, u64, u8, u64) {
    let (release, prerelease) = value.split_once('-').unwrap_or((value, ""));
    let mut numbers = release
        .split('.')
        .filter_map(|part| part.parse::<u64>().ok());
    let prerelease_number = prerelease
        .chars()
        .skip_while(|character| !character.is_ascii_digit())
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>()
        .parse::<u64>()
        .unwrap_or(0);
    (
        numbers.next().unwrap_or(0),
        numbers.next().unwrap_or(0),
        numbers.next().unwrap_or(0),
        u8::from(prerelease.is_empty()),
        if prerelease.is_empty() {
            0
        } else {
            prerelease_number
        },
    )
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn constant_time_eq(left: &str, right: &str) -> bool {
    left.len() == right.len()
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0_u8, |value, (a, b)| value | (a ^ b))
            == 0
}

#[cfg(test)]
mod tests {
    use super::version_key;

    #[test]
    fn release_is_newer_than_development_build() {
        assert!(version_key("0.1.4") > version_key("0.1.4-3a"));
        assert!(version_key("0.1.5-1a") > version_key("0.1.4"));
    }
}
