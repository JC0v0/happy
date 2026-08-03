use crate::api::Machine;
use crate::config::Config;
use crate::crypto;
use crate::rpc::RpcHandlerRegistry;
use crate::socket::HappySocket;
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct MachineClient {
    machine: Arc<Mutex<Machine>>,
    socket: HappySocket,
    pub rpc: RpcHandlerRegistry,
}

impl MachineClient {
    pub async fn connect(config: Config, token: &str, machine: Machine) -> Result<Self> {
        let machine_id = machine.id.clone();
        let socket = HappySocket::connect(
            &config,
            token,
            json!({
                "token": token,
                "clientType": "machine-scoped",
                "machineId": machine_id,
                "happyClient": format!("cli-daemon/{}", config.cli_version),
            }),
        )
        .await?;
        let rpc = RpcHandlerRegistry::new(machine.id.clone(), machine.encryption_key);
        spawn_rpc_loop(socket.clone(), rpc.clone());
        rpc.set_socket(socket.clone()).await?;
        Ok(Self {
            machine: Arc::new(Mutex::new(machine)),
            socket,
            rpc,
        })
    }

    pub async fn machine_id(&self) -> String {
        self.machine.lock().await.id.clone()
    }

    pub async fn keep_alive(&self) -> Result<()> {
        self.socket
            .emit_volatile(
                "machine-alive",
                json!({ "machineId": self.machine_id().await, "time": now_ms() }),
            )
            .await
    }

    pub async fn update_metadata(&self, metadata: Value) -> Result<()> {
        let (id, key, version) = {
            let machine = self.machine.lock().await;
            (
                machine.id.clone(),
                machine.encryption_key,
                machine.metadata_version,
            )
        };
        let encoded = crypto::encode_base64(&crypto::encrypt_json(&metadata, &key)?);
        let answer = self
            .socket
            .emit_with_ack(
                "machine-update-metadata",
                json!({ "machineId": id, "metadata": encoded, "expectedVersion": version }),
                Duration::from_secs(10),
            )
            .await?;
        self.apply_metadata_answer(answer).await
    }

    pub async fn update_daemon_state(&self, state: Value) -> Result<()> {
        let (id, key, version) = {
            let machine = self.machine.lock().await;
            (
                machine.id.clone(),
                machine.encryption_key,
                machine.daemon_state_version,
            )
        };
        let encoded = crypto::encode_base64(&crypto::encrypt_json(&state, &key)?);
        let answer = self
            .socket
            .emit_with_ack(
                "machine-update-state",
                json!({ "machineId": id, "daemonState": encoded, "expectedVersion": version }),
                Duration::from_secs(10),
            )
            .await?;
        self.apply_state_answer(answer).await
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
        let version = answer
            .get("version")
            .and_then(Value::as_u64)
            .context("machine metadata ACK has no version")?;
        let encoded = answer
            .get("metadata")
            .and_then(Value::as_str)
            .context("machine metadata ACK has no value")?;
        let key = self.machine.lock().await.encryption_key;
        let metadata = crypto::decrypt_json(&crypto::decode_base64(encoded)?, &key)?;
        let mut machine = self.machine.lock().await;
        machine.metadata = metadata;
        machine.metadata_version = version;
        if result == "version-mismatch" {
            bail!("machine metadata version mismatch");
        }
        if result != "success" {
            bail!("server rejected machine metadata update");
        }
        Ok(())
    }

    async fn apply_state_answer(&self, answer: Value) -> Result<()> {
        let result = answer
            .get("result")
            .and_then(Value::as_str)
            .unwrap_or("error");
        let version = answer
            .get("version")
            .and_then(Value::as_u64)
            .context("machine state ACK has no version")?;
        let encoded = answer
            .get("daemonState")
            .and_then(Value::as_str)
            .context("machine state ACK has no value")?;
        let key = self.machine.lock().await.encryption_key;
        let state = crypto::decrypt_json(&crypto::decode_base64(encoded)?, &key)?;
        let mut machine = self.machine.lock().await;
        machine.daemon_state = Some(state);
        machine.daemon_state_version = version;
        if result == "version-mismatch" {
            bail!("machine state version mismatch");
        }
        if result != "success" {
            bail!("server rejected machine state update");
        }
        Ok(())
    }
}

fn spawn_rpc_loop(socket: HappySocket, rpc: RpcHandlerRegistry) {
    tokio::spawn(async move {
        let mut receiver = socket.subscribe();
        while let Ok(event) = receiver.recv().await {
            if event.name == "connect" {
                if let Err(error) = rpc.set_socket(socket.clone()).await {
                    tracing::warn!("machine RPC registration after reconnect failed: {error:#}");
                }
            } else if event.name == "rpc-request"
                && let Err(error) = rpc.handle_event(&socket, &event).await
            {
                tracing::warn!("machine RPC handling failed: {error:#}");
            }
        }
    });
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
