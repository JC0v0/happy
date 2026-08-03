use crate::config::Config;
use anyhow::{Context, Result, bail};
use futures_util::FutureExt;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use tf_rust_socketio::Payload;
use tf_rust_socketio::TransportType;
use tf_rust_socketio::asynchronous::{Client, ClientBuilder};
use tokio::sync::{Mutex, broadcast, oneshot};

#[derive(Debug, Clone)]
pub struct InboundEvent {
    pub name: String,
    pub data: Value,
    pub ack_id: Option<i32>,
}

#[derive(Clone)]
pub struct HappySocket {
    client: Client,
    events: broadcast::Sender<InboundEvent>,
}

impl HappySocket {
    pub async fn connect(config: &Config, token: &str, auth: Value) -> Result<Self> {
        // Socket.IO's configured path is mounted with a trailing slash by
        // the current Happy server. Keep it here because tf-rust-engineio
        // preserves custom paths verbatim instead of adding the slash that
        // socket.io-client adds automatically.
        let address = format!("{}/v1/updates/", config.server_url.trim_end_matches('/'));
        let (events, _) = broadcast::channel(256);

        let update_events = events.clone();
        let rpc_events = events.clone();
        let connect_events = events.clone();
        let error_events = events.clone();
        let builder = ClientBuilder::new(address)
            .namespace("/")
            .auth(auth)
            .opening_header("Authorization", format!("Bearer {token}"))
            .opening_header("X-Happy-Client", format!("cli/{}", config.cli_version))
            // Start with the Engine.IO polling handshake and upgrade when
            // possible. If the WebSocket upgrade is not available (or fails
            // on a local Windows setup), tf-rust-socketio falls back to the
            // already-established polling transport.
            .transport_type(TransportType::Any)
            .reconnect(true)
            .reconnect_on_disconnect(true)
            .on("update", move |payload, _| {
                let events = update_events.clone();
                async move {
                    publish_event(&events, "update", payload);
                }
                .boxed()
            })
            .on("rpc-request", move |payload, _| {
                let events = rpc_events.clone();
                async move {
                    publish_event(&events, "rpc-request", payload);
                }
                .boxed()
            })
            .on("connect", move |payload, _| {
                let events = connect_events.clone();
                async move {
                    publish_event(&events, "connect", payload);
                }
                .boxed()
            })
            .on("error", move |payload, _| {
                let events = error_events.clone();
                async move {
                    publish_event(&events, "error", payload);
                }
                .boxed()
            });

        let client = builder
            .connect()
            .await
            .context("failed to connect to Happy Socket.IO server")?;
        Ok(Self { client, events })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<InboundEvent> {
        self.events.subscribe()
    }

    pub async fn emit(&self, event: &str, data: Value) -> Result<()> {
        self.client
            .emit(event, data)
            .await
            .with_context(|| format!("failed to emit Socket.IO event {event}"))
    }

    pub async fn emit_volatile(&self, event: &str, data: Value) -> Result<()> {
        // The current Rust Socket.IO client does not expose a volatile flag.
        // Keep this behind the adapter so the public CLI behavior can be upgraded
        // without leaking the third-party API into session code.
        self.emit(event, data).await
    }

    pub async fn emit_with_ack(
        &self,
        event: &str,
        data: Value,
        timeout: Duration,
    ) -> Result<Value> {
        let (sender, receiver) = oneshot::channel();
        let sender = Arc::new(Mutex::new(Some(sender)));
        let callback_sender = sender.clone();
        self.client
            .emit_with_ack(event, data, timeout, move |payload, _| {
                let sender = callback_sender.clone();
                async move {
                    if let Some(sender) = sender.lock().await.take() {
                        let _ = sender.send(payload_to_value(payload));
                    }
                }
                .boxed()
            })
            .await
            .with_context(|| format!("failed to send Socket.IO ACK event {event}"))?;

        tokio::time::timeout(timeout, receiver)
            .await
            .context("Socket.IO ACK timed out")?
            .context("Socket.IO ACK channel closed")
    }

    pub async fn ack_server_event(&self, ack_id: i32, data: Value) -> Result<()> {
        self.client
            .ack_with_id(ack_id, data)
            .await
            .context("failed to acknowledge server Socket.IO event")
    }

    pub async fn close(&self) -> Result<()> {
        self.client
            .disconnect()
            .await
            .context("failed to close Socket.IO connection")
    }
}

fn publish_event(events: &broadcast::Sender<InboundEvent>, name: &str, payload: Payload) {
    let ack_id = payload.ack_id();
    let data = payload_to_value(payload);
    let _ = events.send(InboundEvent {
        name: name.to_owned(),
        data,
        ack_id,
    });
}

fn payload_to_value(payload: Payload) -> Value {
    match payload {
        Payload::Text(values, _) => {
            if values.len() == 1 {
                values.into_iter().next().unwrap_or(Value::Null)
            } else {
                Value::Array(values)
            }
        }
        Payload::Binary(bytes, _) => json!(bytes.to_vec()),
        #[allow(deprecated)]
        Payload::String(value, _) => serde_json::from_str(&value).unwrap_or(Value::String(value)),
    }
}

pub fn first_object(value: &Value) -> Result<&serde_json::Map<String, Value>> {
    value
        .as_object()
        .context("Socket.IO payload is not an object")
}

pub fn ack_value(value: Value, key: &str) -> Result<Value> {
    if value.is_null() {
        bail!("Socket.IO ACK response is empty for {key}");
    }
    Ok(value)
}
