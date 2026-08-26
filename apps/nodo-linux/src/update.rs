use crate::auth;
use crate::config::Config;
use crate::ui;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const DEFAULT_UPDATE_MANIFEST_URL: &str = "https://kaordo.pages.dev/downloads/nodo-linux-0.2.json";
const STATUS_FILENAME: &str = ".update-status.json";

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub available: bool,
    pub current_version: String,
    pub notes: Option<String>,
    pub target_version: Option<String>,
    #[serde(skip)]
    manifest: Option<Manifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_version: String,
    pub job_id: String,
    pub message: Option<String>,
    pub status: String,
    pub target_version: Option<String>,
    pub updated_at: i64,
}

pub fn check(config: &Config) -> Result<UpdateCheck, Box<dyn std::error::Error>> {
    let url = config
        .update_manifest_url
        .as_deref()
        .filter(|url| !is_legacy_default_manifest(url))
        .unwrap_or(DEFAULT_UPDATE_MANIFEST_URL);
    if !url.starts_with("https://") {
        return Err("Update manifest must use HTTPS.".into());
    }
    let manifest: Manifest = auth::client(20)?
        .get(url)
        .send()?
        .error_for_status()?
        .json()?;
    let current = version_key(crate::VERSION);
    let available = version_key(&manifest.version);
    Ok(UpdateCheck {
        available: available > current,
        current_version: crate::VERSION.to_owned(),
        notes: manifest.notes.clone(),
        target_version: (available > current).then_some(manifest.version.clone()),
        manifest: Some(manifest),
    })
}

pub fn run(
    config: &Config,
    apply: bool,
    restart: bool,
    job_id: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let check = check(config);
    let check = match check {
        Ok(check) => check,
        Err(error) => {
            if let Some(job_id) = job_id {
                write_status_at_path(
                    config,
                    &status_for(
                        job_id,
                        "failed",
                        crate::VERSION,
                        None,
                        Some(error.to_string()),
                    ),
                )?;
            }
            return Err(error);
        }
    };
    if !check.available {
        if let Some(job_id) = job_id {
            write_status_at_path(
                config,
                &status_for(
                    job_id,
                    "up-to-date",
                    crate::VERSION,
                    None,
                    Some(format!("Nodo is already up to date ({}).", crate::VERSION)),
                ),
            )?;
        }
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
    if let Some(job_id) = job_id {
        write_status_at_path(
            config,
            &status_for(
                job_id,
                "installing",
                crate::VERSION,
                Some(target_version.clone()),
                Some("Downloading and verifying the update.".to_owned()),
            ),
        )?;
    }
    let manifest = check
        .manifest
        .as_ref()
        .ok_or("The update manifest was not retained.")?;
    let result = apply_update(&target_version, manifest);
    if let Err(error) = result {
        if let Some(job_id) = job_id {
            write_status_at_path(
                config,
                &status_for(
                    job_id,
                    "failed",
                    crate::VERSION,
                    Some(target_version.clone()),
                    Some(error.to_string()),
                ),
            )?;
        }
        return Err(error);
    }
    if let Some(job_id) = job_id {
        write_status_at_path(
            config,
            &status_for(
                job_id,
                "installed",
                target_version.as_str(),
                Some(target_version.clone()),
                Some("Update installed. Restarting the Nodo service.".to_owned()),
            ),
        )?;
    }
    if restart {
        if let Err(error) = crate::service::restart_background() {
            if let Some(job_id) = job_id {
                write_status_at_path(
                    config,
                    &status_for(
                        job_id,
                        "failed",
                        target_version.as_str(),
                        Some(target_version.clone()),
                        Some(format!(
                            "Update installed, but the Nodo could not restart: {error}"
                        )),
                    ),
                )?;
            }
            return Err(error);
        }
    } else {
        ui::success("Update installed. Restart the background service to activate it.");
    }
    Ok(())
}

pub fn start_background(
    config: &Config,
    check: &UpdateCheck,
) -> Result<UpdateStatus, Box<dyn std::error::Error>> {
    if let Some(existing) = read_status(config, None)?
        && matches!(existing.status.as_str(), "started" | "installing")
    {
        return Ok(existing);
    }
    let target_version = check
        .target_version
        .clone()
        .ok_or("Nodo is already up to date.")?;
    let job_id = Uuid::new_v4().to_string();
    let status = status_for(
        &job_id,
        "started",
        &check.current_version,
        Some(target_version),
        Some("Update accepted. The Linux Nodo will reconnect with the new version.".to_owned()),
    );
    write_status_at_path(config, &status)?;
    let executable = std::env::current_exe()?;
    let result = Command::new(executable)
        .args(["update", "--apply", "--restart", "--job-id", &job_id])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    if let Err(error) = result {
        let failed = status_for(
            &job_id,
            "failed",
            &check.current_version,
            check.target_version.clone(),
            Some(format!("Could not start the update process: {error}")),
        );
        write_status_at_path(config, &failed)?;
        return Err(error.into());
    }
    Ok(status)
}

pub fn read_status(config: &Config, job_id: Option<&str>) -> io::Result<Option<UpdateStatus>> {
    let path = status_path(config);
    if !path.is_file() {
        return Ok(None);
    }
    let status: UpdateStatus = serde_json::from_slice(&fs::read(path)?)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(job_id
        .is_none_or(|value| value == status.job_id)
        .then_some(status))
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
    let temporary = temporary_path()?;
    let mut file = File::create(&temporary)?;
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
    Ok(())
}

fn status_for(
    job_id: &str,
    status: &str,
    current_version: &str,
    target_version: Option<String>,
    message: Option<String>,
) -> UpdateStatus {
    UpdateStatus {
        current_version: current_version.to_owned(),
        job_id: job_id.to_owned(),
        message,
        status: status.to_owned(),
        target_version,
        updated_at: unix_seconds(),
    }
}

fn status_path(config: &Config) -> PathBuf {
    config.data_dir.join(STATUS_FILENAME)
}

pub fn write_status_at_path(config: &Config, status: &UpdateStatus) -> io::Result<()> {
    write_status_at(&status_path(config), status)
}

fn write_status_at(path: &std::path::Path, status: &UpdateStatus) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(status)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    fs::write(&temporary, bytes)?;
    fs::rename(temporary, path)
}

fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs() as i64)
}

fn temporary_path() -> io::Result<PathBuf> {
    let target = std::env::current_exe()?;
    Ok(target.with_extension(format!("download.{}.tmp", std::process::id())))
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
