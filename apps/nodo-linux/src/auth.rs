use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use pbkdf2::pbkdf2_hmac;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::Duration;
use zeroize::Zeroizing;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResult {
    pub session_token: String,
    pub user: crate::config::User,
}

#[derive(Debug, Deserialize)]
struct LoginResponse {
    #[serde(rename = "sessionToken")]
    session_token: String,
    user: crate::config::User,
}

#[derive(Debug, Deserialize)]
struct LiveTicketResponse {
    url: String,
}

pub fn login(
    api_origin: &str,
    username: &str,
    password: &str,
) -> Result<AuthResult, Box<dyn std::error::Error>> {
    let username = username.trim();
    if username.is_empty() {
        return Err("Username is required.".into());
    }
    let password = Zeroizing::new(password.to_owned());
    if !(6..=128).contains(&password.chars().count()) {
        return Err("Password must be 6–128 characters.".into());
    }
    let proof = password_proof(username, password.as_bytes());
    let body = serde_json::json!({
        "username": username,
        "passwordProof": proof,
        "deviceName": format!("Nodo on Linux ({})", hostname()),
    });
    let client = client(30)?;
    let response = client
        .post(format!(
            "{}/api/auth/desktop/login",
            api_origin.trim_end_matches('/')
        ))
        .json(&body)
        .send()?;
    let status = response.status();
    let value: serde_json::Value = response.json()?;
    if !status.is_success() {
        let message = value
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Login failed.");
        return Err(message.to_owned().into());
    }
    let result: LoginResponse = serde_json::from_value(value)?;
    Ok(AuthResult {
        session_token: result.session_token,
        user: result.user,
    })
}

pub fn password_proof(username: &str, password: &[u8]) -> String {
    let salt = format!(
        "veri{}dimensio:password:v1:{}",
        "",
        username.trim().to_ascii_lowercase()
    );
    let mut output = [0_u8; 32];
    pbkdf2_hmac::<Sha256>(password, salt.as_bytes(), 600_000, &mut output);
    URL_SAFE_NO_PAD.encode(output)
}

pub fn session_watch_url(
    api_origin: &str,
    token: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let response = client(30)?
        .post(format!(
            "{}/api/auth/live-ticket",
            api_origin.trim_end_matches('/')
        ))
        .bearer_auth(token)
        .json(&serde_json::json!({}))
        .send()?;
    let status = response.status();
    let value: serde_json::Value = response.json()?;
    if !status.is_success() {
        let message = value
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Session watch could not be started.");
        return Err(message.to_owned().into());
    }
    Ok(serde_json::from_value::<LiveTicketResponse>(value)?.url)
}

pub fn client(timeout_seconds: u64) -> Result<Client, reqwest::Error> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(timeout_seconds))
        .user_agent(format!("Kaordo-Nodo-Linux/{}", crate::VERSION))
        .build()
}

fn hostname() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Linux".to_owned())
}

#[cfg(test)]
mod tests {
    use super::password_proof;

    #[test]
    fn password_proof_matches_the_worker_namespace() {
        assert_eq!(
            password_proof("Alice", b"correct horse battery staple"),
            "YhdwkdJq2-hX8rIeQE4VxiO7AeT8SS2iv3edUuDUh5w"
        );
    }
}
