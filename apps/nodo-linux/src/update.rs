use crate::auth;
use crate::config::Config;
use crate::ui;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::PathBuf;
use uuid::Uuid;

const DEFAULT_UPDATE_MANIFEST_URL: &str = "https://kaordo.pages.dev/downloads/nodo-linux.json";
const UPDATE_MANIFEST_TIMEOUT_SECONDS: u64 = 8;

#[derive(Debug, Clone, Deserialize)]
struct Manifest {
    version: String,
    #[serde(alias = "linuxX86_64Url", alias = "linux_x86_64_url")]
    linux_url: String,
    #[serde(alias = "linuxX86_64Sha256", alias = "linux_x86_64_sha256")]
    sha256: String,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Debug, Clone)]
struct UpdateCheck {
    available: bool,
    notes: Option<String>,
    target_version: Option<String>,
    manifest: Option<Manifest>,
}

fn check(config: &Config) -> Result<UpdateCheck, Box<dyn std::error::Error>> {
    let url = config
        .update_manifest_url
        .as_deref()
        .filter(|url| !is_legacy_default_manifest(url))
        .unwrap_or(DEFAULT_UPDATE_MANIFEST_URL);
    if !url.starts_with("https://") {
        return Err("Update manifest must use HTTPS.".into());
    }
    let manifest: Manifest = auth::client(UPDATE_MANIFEST_TIMEOUT_SECONDS)?
        .get(url)
        .send()?
        .error_for_status()?
        .json()?;
    let current = version_key(crate::VERSION);
    let available = version_key(&manifest.version);
    Ok(UpdateCheck {
        available: available > current,
        notes: manifest.notes.clone(),
        target_version: (available > current).then_some(manifest.version.clone()),
        manifest: Some(manifest),
    })
}

pub fn run(config: &Config, apply: bool) -> Result<(), Box<dyn std::error::Error>> {
    let check = check(config)?;
    if !check.available {
        ui::success(&format!("Nodo is up to date ({})", crate::VERSION));
        return Ok(());
    }
    let target_version = check.target_version.clone().unwrap_or_default();
    println!("Update available: {} → {}", crate::VERSION, target_version);
    if let Some(ref notes) = check.notes {
        println!("  {notes}");
    }
    if !apply {
        println!("Run 'kaordo-nodo update --apply' to install it.");
        return Ok(());
    }
    let manifest = check
        .manifest
        .as_ref()
        .ok_or("The update manifest was not retained.")?;
    apply_update(&target_version, manifest)?;
    ui::success("Update installed. Restart the background service to activate it.");
    Ok(())
}

/// Older Linux builds persisted their release-specific manifest URL. Treat
/// those built-in URLs as aliases so a node can bootstrap directly to the
/// current release instead of walking through every historical scope.
fn is_legacy_default_manifest(url: &str) -> bool {
    url.starts_with("https://kaordo.pages.dev/downloads/nodo-linux-")
        && url
            .get(url.len().saturating_sub(5)..)
            .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".json"))
}

fn apply_update(
    target_version: &str,
    manifest: &Manifest,
) -> Result<(), Box<dyn std::error::Error>> {
    if manifest.version != target_version {
        return Err("The update manifest changed while the update was starting.".into());
    }
    if !manifest.linux_url.starts_with("https://") {
        return Err("Update artifact must use HTTPS.".into());
    }
    let response = auth::client(120)?
        .get(&manifest.linux_url)
        .send()?
        .error_for_status()?;
    let mut temporary = TemporaryUpdate::create()?;
    let mut file = temporary
        .file
        .take()
        .ok_or("Update temporary file is unavailable.")?;
    let mut reader = response;
    let mut hash = Sha256::new();
    let mut buffer = vec![0_u8; 128 * 1024];
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
        return Err("Downloaded update failed SHA-256 verification.".into());
    }
    drop(file);
    let target = std::env::current_exe()?;
    let permissions = fs::metadata(&target)?.permissions();
    fs::set_permissions(&temporary.path, permissions)?;
    // The temporary file is created beside the executable, so rename is an
    // atomic replacement on Linux. There is never a moment where the command
    // path is missing, even if the service keeps the previous inode open.
    fs::rename(&temporary.path, &target)?;
    temporary.installed = true;
    if let Some(parent) = target.parent() {
        let _ = File::open(parent).and_then(|directory| directory.sync_all());
    }
    Ok(())
}

struct TemporaryUpdate {
    file: Option<File>,
    installed: bool,
    path: PathBuf,
}

impl TemporaryUpdate {
    fn create() -> io::Result<Self> {
        let target = std::env::current_exe()?;
        let path = target.with_extension(format!("download.{}.tmp", Uuid::new_v4()));
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)?;
        Ok(Self {
            file: Some(file),
            installed: false,
            path,
        })
    }
}

impl Drop for TemporaryUpdate {
    fn drop(&mut self) {
        if !self.installed {
            let _ = fs::remove_file(&self.path);
        }
    }
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
