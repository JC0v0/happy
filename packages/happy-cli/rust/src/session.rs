use crate::api::Session;
use crate::config::Config;
use crate::crypto;
use crate::rpc::RpcHandlerRegistry;
use crate::socket::HappySocket;
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, broadcast};

#[derive(Debug, Clone)]
pub enum SessionEvent {
    Archived,
    Update(Value),
    SocketError(String),
}

/// Encrypted session-scoped network client.
#[derive(Clone)]
pub struct SessionClient {
    session: Arc<Mutex<Session>>,
    socket: HappySocket,
    pub rpc: RpcHandlerRegistry,
    events: broadcast::Sender<SessionEvent>,
}

impl SessionClient {
    pub async fn connect(config: Config, token: &str, session: Session) -> Result<Self> {
        let session_id = session.id.clone();
        let encryption_key = session.encryption_key;
        let socket = HappySocket::connect(
            &config,
            token,
            json!({
                "token": token,
                "clientType": "session-scoped",
                "sessionId": session_id,
                "happyClient": format!("cli-coding-session/{}", config.cli_version),
            }),
        )
        .await?;
        let rpc = RpcHandlerRegistry::new(session.id.clone(), encryption_key);
        let (events, _) = broadcast::channel(64);
        let session = Arc::new(Mutex::new(session));
        spawn_event_loop(socket.clone(), rpc.clone(), events.clone(), session.clone());
        rpc.set_socket(socket.clone()).await?;
        Ok(Self {
            session,
            socket,
            rpc,
            events,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SessionEvent> {
        self.events.subscribe()
    }

    pub async fn session_id(&self) -> String {
        self.session.lock().await.id.clone()
    }

    pub async fn keep_alive(&self, thinking: bool, mode: &str) -> Result<()> {
        let sid = self.session_id().await;
        self.socket
            .emit_volatile(
                "session-alive",
                json!({ "sid": sid, "time": now_ms(), "thinking": thinking, "mode": mode }),
            )
            .await
    }

    pub async fn send_session_death(&self) -> Result<()> {
        let sid = self.session_id().await;
        self.socket
            .emit("session-end", json!({ "sid": sid, "time": now_ms() }))
            .await
    }

    pub async fn send_terminal_output(&self, payload: &Value, reliable: bool) -> Result<()> {
        let session = self.session.lock().await;
        let ciphertext =
            crypto::encode_base64(&crypto::encrypt_json(payload, &session.encryption_key)?);
        let envelope = json!({ "sid": session.id, "c": ciphertext });
        if reliable {
            self.socket.emit("terminal-output", envelope).await
        } else {
            self.socket.emit_volatile("terminal-output", envelope).await
        }
    }

    pub async fn update_metadata(&self, metadata: Value) -> Result<()> {
        let (sid, key, expected_version) = {
            let session = self.session.lock().await;
            (
                session.id.clone(),
                session.encryption_key,
                session.metadata_version,
            )
        };
        let encoded = crypto::encode_base64(&crypto::encrypt_json(&metadata, &key)?);
        let answer = self
            .socket
            .emit_with_ack(
                "update-metadata",
                json!({ "sid": sid, "expectedVersion": expected_version, "metadata": encoded }),
                Duration::from_secs(10),
            )
            .await?;
        self.apply_metadata_answer(answer).await
    }

    pub async fn update_agent_state(&self, state: Option<Value>) -> Result<()> {
        let (sid, key, expected_version) = {
            let session = self.session.lock().await;
            (
                session.id.clone(),
                session.encryption_key,
                session.agent_state_version,
            )
        };
        let encoded = match state {
            Some(value) => Some(crypto::encode_base64(&crypto::encrypt_json(&value, &key)?)),
            None => None,
        };
        let answer = self
            .socket
            .emit_with_ack(
                "update-state",
                json!({ "sid": sid, "expectedVersion": expected_version, "agentState": encoded }),
                Duration::from_secs(10),
            )
            .await?;
        self.apply_state_answer(answer).await
    }

    pub async fn flush(&self) -> Result<()> {
        // The current server's ping handler expects the ACK callback as its
        // first argument, while tf-rust-socketio's generic ACK API always
        // serializes one data argument. Avoid sending a malformed ping packet;
        // reliable terminal snapshots already use non-volatile emits.
        Ok(())
    }

    pub async fn close(&self) -> Result<()> {
        self.rpc.clear_socket().await;
        self.socket.close().await
    }

    async fn apply_metadata_answer(&self, answer: Value) -> Result<()> {
        let result = answer
            .get("result")
            .and_then(Value::as_str)
            .unwrap_or("error");
        match result {
            "success" | "version-mismatch" => {
                let version = answer
                    .get("version")
                    .and_then(Value::as_u64)
                    .context("metadata ACK has no version")?;
                if let Some(encoded) = answer.get("metadata").and_then(Value::as_str) {
                    let key = self.session.lock().await.encryption_key;
                    let bundle = crypto::decode_base64(encoded)?;
                    let metadata = crypto::decrypt_json(&bundle, &key)?;
                    let mut session = self.session.lock().await;
                    session.metadata = metadata;
                    session.metadata_version = version;
                }
                if result == "version-mismatch" {
                    bail!("session metadata version mismatch")
                }
                Ok(())
            }
            _ => bail!("server rejected session metadata update"),
        }
    }

    async fn apply_state_answer(&self, answer: Value) -> Result<()> {
        let result = answer
            .get("result")
            .and_then(Value::as_str)
            .unwrap_or("error");
        match result {
            "success" | "version-mismatch" => {
                let version = answer
                    .get("version")
                    .and_then(Value::as_u64)
                    .context("state ACK has no version")?;
                let state = match answer.get("agentState") {
                    None | Some(Value::Null) => None,
                    Some(Value::String(encoded)) => {
                        let key = self.session.lock().await.encryption_key;
                        let bundle = crypto::decode_base64(encoded)?;
                        Some(crypto::decrypt_json(&bundle, &key)?)
                    }
                    Some(_) => bail!("state ACK contains invalid agentState"),
                };
                let mut session = self.session.lock().await;
                session.agent_state = state;
                session.agent_state_version = version;
                if result == "version-mismatch" {
                    bail!("session state version mismatch")
                }
                Ok(())
            }
            _ => bail!("server rejected session state update"),
        }
    }
}

fn spawn_event_loop(
    socket: HappySocket,
    rpc: RpcHandlerRegistry,
    events: broadcast::Sender<SessionEvent>,
    session: Arc<Mutex<Session>>,
) {
    tokio::spawn(async move {
        let mut receiver = socket.subscribe();
        while let Ok(event) = receiver.recv().await {
            match event.name.as_str() {
                "connect" => {
                    if let Err(error) = rpc.set_socket(socket.clone()).await {
                        let _ = events.send(SessionEvent::SocketError(format!(
                            "RPC registration after reconnect failed: {error:#}"
                        )));
                    }
                }
                "rpc-request" => {
                    if let Err(error) = rpc.handle_event(&socket, &event).await {
                        let _ = events.send(SessionEvent::SocketError(format!(
                            "RPC handling failed: {error:#}"
                        )));
                    }
                }
                "update" => {
                    let archived = match apply_update(&session, &event.data).await {
                        Ok(archived) => archived,
                        Err(error) => {
                            let _ = events.send(SessionEvent::SocketError(format!(
                                "session update could not be decrypted: {error:#}"
                            )));
                            false
                        }
                    };
                    let _ = events.send(SessionEvent::Update(event.data.clone()));
                    if archived {
                        let _ = events.send(SessionEvent::Archived);
                    }
                }
                "error" => {
                    let _ = events.send(SessionEvent::SocketError(event.data.to_string()));
                }
                _ => {}
            }
        }
    });
}

async fn apply_update(session: &Arc<Mutex<Session>>, data: &Value) -> Result<bool> {
    let Some(body) = data.get("body") else {
        return Ok(false);
    };
    if body.get("t").and_then(Value::as_str) != Some("update-session") {
        return Ok(false);
    }

    let key = session.lock().await.encryption_key;
    let mut archived = false;

    if let Some(metadata) = body.get("metadata").and_then(Value::as_object) {
        let version = metadata
            .get("version")
            .and_then(Value::as_u64)
            .context("session metadata update has no version")?;
        if version > session.lock().await.metadata_version
            && let Some(encoded) = metadata.get("value").and_then(Value::as_str)
        {
            let value: Value = crypto::decrypt_json(&crypto::decode_base64(encoded)?, &key)?;
            archived = value
                .get("lifecycleState")
                .and_then(Value::as_str)
                .map(|state| state == "archiveRequested" || state == "archived")
                .unwrap_or(false);
            let mut current = session.lock().await;
            if version > current.metadata_version {
                current.metadata = value;
                current.metadata_version = version;
            }
        }
    }

    if let Some(agent_state) = body.get("agentState").and_then(Value::as_object) {
        let version = agent_state
            .get("version")
            .and_then(Value::as_u64)
            .context("session state update has no version")?;
        if version > session.lock().await.agent_state_version {
            let state = match agent_state.get("value") {
                None | Some(Value::Null) => None,
                Some(Value::String(encoded)) => Some(crypto::decrypt_json(
                    &crypto::decode_base64(encoded)?,
                    &key,
                )?),
                Some(_) => bail!("session state update has an invalid value"),
            };
            let mut current = session.lock().await;
            if version > current.agent_state_version {
                current.agent_state = state;
                current.agent_state_version = version;
            }
        }
    }

    Ok(archived)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn applies_encrypted_session_updates_and_detects_archive() {
        let key = [7_u8; 32];
        let session = Arc::new(Mutex::new(Session {
            id: "session-1".to_owned(),
            seq: 0,
            encryption_key: key,
            metadata: json!({ "lifecycleState": "running" }),
            metadata_version: 1,
            agent_state: None,
            agent_state_version: 0,
        }));
        let metadata = crypto::encode_base64(
            &crypto::encrypt_json(&json!({ "lifecycleState": "archived" }), &key).unwrap(),
        );
        let state = crypto::encode_base64(
            &crypto::encrypt_json(&json!({ "status": "done" }), &key).unwrap(),
        );
        let update = json!({
            "body": {
                "t": "update-session",
                "metadata": { "version": 2, "value": metadata },
                "agentState": { "version": 1, "value": state }
            }
        });

        assert!(apply_update(&session, &update).await.unwrap());
        let session = session.lock().await;
        assert_eq!(session.metadata["lifecycleState"], "archived");
        assert_eq!(session.agent_state.as_ref().unwrap()["status"], "done");
        assert_eq!(session.metadata_version, 2);
        assert_eq!(session.agent_state_version, 1);
    }
}
