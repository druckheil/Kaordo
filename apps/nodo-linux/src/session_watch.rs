use crate::auth;
use crate::config::{Config, ConfigStore};
use crate::server::NodeRuntime;
use serde_json::Value;
use std::sync::{Arc, RwLock};
use std::thread;
use tungstenite::{Message, connect};

/// Keeps one authenticated WebSocket open while the Nodo is running. The
/// coordinator pushes revocation events over this channel; heartbeat remains
/// the durable fallback when a proxy or network drops the socket.
pub fn spawn(
    config: Arc<RwLock<Config>>,
    store: ConfigStore,
    runtime: Arc<NodeRuntime>,
) -> thread::JoinHandle<()> {
    thread::Builder::new()
        .name("kaordo-nodo-session-watch".to_owned())
        .spawn(move || {
            let snapshot = config.read().ok().map(|value| value.clone());
            let Some(snapshot) = snapshot else { return };
            let Some(token) = snapshot.token.clone() else {
                return;
            };
            let url = match auth::session_watch_url(&snapshot.api_origin, &token) {
                Ok(url) => url,
                Err(error) => {
                    crate::ui::warning(&format!(
                        "Live session watch unavailable; heartbeat fallback active: {error}"
                    ));
                    return;
                }
            };
            let (mut socket, _) = match connect(url.as_str()) {
                Ok(connection) => connection,
                Err(error) => {
                    crate::ui::warning(&format!(
                        "Live session watch unavailable; heartbeat fallback active: {error}"
                    ));
                    return;
                }
            };
            loop {
                match socket.read() {
                    Ok(Message::Text(text)) if is_session_revoked(text.as_ref()) => {
                        crate::heartbeat::expire_session(&config, &store, &runtime);
                        break;
                    }
                    Ok(Message::Close(_)) => break,
                    Ok(_) => {}
                    Err(error) => {
                        crate::ui::warning(&format!(
                            "Live session watch ended; heartbeat fallback active: {error}"
                        ));
                        break;
                    }
                }
            }
        })
        .expect("session watcher thread could not start")
}

fn is_session_revoked(text: &str) -> bool {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|value| value.get("type").and_then(Value::as_str).map(str::to_owned))
        .as_deref()
        == Some("session-revoked")
}
