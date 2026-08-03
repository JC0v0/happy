use crate::crypto;
use crate::socket::{HappySocket, InboundEvent};
use anyhow::{Context, Result, bail};
use futures_util::future::BoxFuture;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use tokio::sync::RwLock;

type Handler = Arc<dyn Fn(Value) -> BoxFuture<'static, Result<Value>> + Send + Sync>;

/// Scope-aware encrypted RPC registry shared by session and machine sockets.
///
/// The server only sees the method name and an encrypted response. Handler
/// names are registered with the same scope:method convention used by the
/// TypeScript client, so a Rust client can coexist with the current app and
/// server without changing the wire protocol.
#[derive(Clone)]
pub struct RpcHandlerRegistry {
    scope_prefix: String,
    encryption_key: [u8; 32],
    handlers: Arc<RwLock<HashMap<String, Handler>>>,
    socket: Arc<RwLock<Option<HappySocket>>>,
}

impl RpcHandlerRegistry {
    pub fn new(scope_prefix: impl Into<String>, encryption_key: [u8; 32]) -> Self {
        Self {
            scope_prefix: scope_prefix.into(),
            encryption_key,
            handlers: Arc::new(RwLock::new(HashMap::new())),
            socket: Arc::new(RwLock::new(None)),
        }
    }

    pub fn prefixed_method(&self, method: &str) -> String {
        format!("{}:{method}", self.scope_prefix)
    }

    pub async fn register<F, Fut>(&self, method: &str, handler: F) -> Result<()>
    where
        F: Fn(Value) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Value>> + Send + 'static,
    {
        let prefixed_method = self.prefixed_method(method);
        let handler: Handler = Arc::new(move |params| Box::pin(handler(params)));
        self.handlers
            .write()
            .await
            .insert(prefixed_method.clone(), handler);

        if let Some(socket) = self.socket.read().await.clone() {
            socket
                .emit("rpc-register", json!({ "method": prefixed_method }))
                .await?;
        }
        Ok(())
    }

    pub async fn unregister(&self, method: &str) -> Result<()> {
        let prefixed_method = self.prefixed_method(method);
        self.handlers.write().await.remove(&prefixed_method);
        if let Some(socket) = self.socket.read().await.clone() {
            socket
                .emit("rpc-unregister", json!({ "method": prefixed_method }))
                .await?;
        }
        Ok(())
    }

    pub async fn has_handler(&self, method: &str) -> bool {
        self.handlers
            .read()
            .await
            .contains_key(&self.prefixed_method(method))
    }

    pub async fn set_socket(&self, socket: HappySocket) -> Result<()> {
        *self.socket.write().await = Some(socket.clone());
        let methods = self
            .handlers
            .read()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for method in methods {
            socket
                .emit("rpc-register", json!({ "method": method }))
                .await?;
        }
        Ok(())
    }

    pub async fn clear_socket(&self) {
        *self.socket.write().await = None;
    }

    /// Handle one server-to-client RPC request and ACK the encrypted result.
    pub async fn handle_event(&self, socket: &HappySocket, event: &InboundEvent) -> Result<()> {
        let ack_id = event
            .ack_id
            .context("server RPC request did not include an ACK id")?;
        let object = event
            .data
            .as_object()
            .context("RPC request payload is not an object")?;
        let method = object
            .get("method")
            .and_then(Value::as_str)
            .context("RPC request method is missing")?;
        let encoded_params = object
            .get("params")
            .and_then(Value::as_str)
            .context("RPC request params are missing")?;

        let result = self.invoke(method, encoded_params).await;
        let response = match result {
            Ok(value) => value,
            Err(error) => json!({ "error": format!("{error:#}") }),
        };
        let encrypted =
            crypto::encode_base64(&crypto::encrypt_json(&response, &self.encryption_key)?);
        socket
            .ack_server_event(ack_id, Value::String(encrypted))
            .await
    }

    async fn invoke(&self, method: &str, encoded_params: &str) -> Result<Value> {
        let handler = self
            .handlers
            .read()
            .await
            .get(method)
            .cloned()
            .with_context(|| format!("RPC method not found: {method}"))?;
        let params_bundle =
            crypto::decode_base64(encoded_params).context("RPC params are not valid base64")?;
        let params = crypto::decrypt_json(&params_bundle, &self.encryption_key)
            .context("failed to decrypt RPC params")?;
        handler(params).await
    }
}

pub fn encrypted_rpc_params(key: &[u8; 32], value: &Value) -> Result<String> {
    Ok(crypto::encode_base64(&crypto::encrypt_json(value, key)?))
}

pub fn decrypt_rpc_response(key: &[u8; 32], encoded: &str) -> Result<Value> {
    let bundle = crypto::decode_base64(encoded).context("RPC response is not valid base64")?;
    crypto::decrypt_json(&bundle, key)
}

pub fn require_rpc_ok(value: Value) -> Result<Value> {
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        bail!("remote RPC failed: {error}");
    }
    Ok(value)
}
