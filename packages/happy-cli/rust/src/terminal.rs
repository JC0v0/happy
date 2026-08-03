use crate::config::Config;
use crate::doctor;
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{Mutex, broadcast};

const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const REQUEST_SPAWN: u8 = 0x01;
const REQUEST_WRITE: u8 = 0x02;
const REQUEST_EXECUTE: u8 = 0x03;
const REQUEST_RESIZE: u8 = 0x04;
const REQUEST_SNAPSHOT: u8 = 0x05;
const REQUEST_KILL: u8 = 0x06;
const EVENT_READY: u8 = 0x81;
const EVENT_OUTPUT: u8 = 0x82;
const EVENT_METADATA: u8 = 0x83;
const EVENT_EXECUTE_RESULT: u8 = 0x84;
const EVENT_SNAPSHOT_END: u8 = 0x85;
const EVENT_EXIT: u8 = 0x86;
const EVENT_ERROR: u8 = 0x87;

#[derive(Debug, Clone)]
pub enum HostAgentEvent {
    Ready(Value),
    Output {
        request_id: u32,
        seq: u64,
        data: Vec<u8>,
    },
    Metadata {
        request_id: Option<u32>,
        event: Value,
    },
    ExecuteResult {
        request_id: u32,
        tracked: bool,
        command_id: Option<String>,
    },
    SnapshotEnd {
        request_id: u32,
        state: Value,
    },
    Exit {
        exit_code: i32,
    },
    Error {
        message: String,
        fatal: bool,
    },
}

pub struct HostAgentClient {
    binary: PathBuf,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    events: broadcast::Sender<HostAgentEvent>,
    ready: Arc<Mutex<Option<Value>>>,
    next_request_id: AtomicU32,
}

impl HostAgentClient {
    pub async fn start(config: &Config, cwd: &str, cols: u16, rows: u16) -> Result<Self> {
        if cols == 0 || rows == 0 {
            bail!("terminal dimensions must be greater than zero");
        }
        let binary = doctor::resolve_host_agent(config).context(
            "Rust host-agent was not found; build it with pnpm --filter happy host-agent:build",
        )?;
        let mut command = Command::new(&binary);
        command
            .arg("terminal")
            .current_dir(cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .with_context(|| format!("failed to start {}", binary.display()))?;
        let stdin = child
            .stdin
            .take()
            .context("host-agent stdin was not piped")?;
        let stdout = child
            .stdout
            .take()
            .context("host-agent stdout was not piped")?;
        let stderr = child
            .stderr
            .take()
            .context("host-agent stderr was not piped")?;
        let child = Arc::new(Mutex::new(child));
        let stdin = Arc::new(Mutex::new(stdin));
        let (events, _) = broadcast::channel(512);

        spawn_stdout_reader(stdout, events.clone());
        spawn_stderr_reader(stderr);

        let client = Self {
            binary,
            child,
            stdin,
            events,
            ready: Arc::new(Mutex::new(None)),
            next_request_id: AtomicU32::new(1),
        };
        let mut receiver = client.events.subscribe();
        client
            .send_json(
                REQUEST_SPAWN,
                &json!({
                    "cwd": cwd,
                    "cols": cols,
                    "rows": rows,
                    "env": std::env::vars().collect::<std::collections::HashMap<_, _>>(),
                }),
            )
            .await?;
        match tokio::time::timeout(Duration::from_secs(10), wait_for_ready(&mut receiver)).await {
            Ok(Ok(ready)) => {
                *client.ready.lock().await = Some(ready);
                Ok(client)
            }
            Ok(Err(error)) => {
                client.dispose().await;
                Err(error)
            }
            Err(_) => {
                client.dispose().await;
                bail!("Rust host-agent did not become ready in time")
            }
        }
    }

    pub fn binary(&self) -> &PathBuf {
        &self.binary
    }

    pub fn subscribe(&self) -> broadcast::Receiver<HostAgentEvent> {
        self.events.subscribe()
    }

    pub async fn ready(&self) -> Option<Value> {
        self.ready.lock().await.clone()
    }

    pub async fn write(&self, terminal_id: &str, data: &[u8]) -> Result<()> {
        if terminal_id.is_empty() || terminal_id.len() > 128 {
            bail!("terminal id must contain 1-128 bytes");
        }
        if data.is_empty() {
            return Ok(());
        }
        let terminal_id = terminal_id.as_bytes();
        let mut payload = Vec::with_capacity(2 + terminal_id.len() + data.len());
        payload.extend_from_slice(&(terminal_id.len() as u16).to_be_bytes());
        payload.extend_from_slice(terminal_id);
        payload.extend_from_slice(data);
        self.send_frame(REQUEST_WRITE, &payload).await
    }

    pub async fn execute(
        &self,
        terminal_id: &str,
        command: &str,
    ) -> Result<(bool, Option<String>)> {
        let request_id = self.allocate_request_id();
        let mut receiver = self.events.subscribe();
        self.send_json(
            REQUEST_EXECUTE,
            &json!({ "requestId": request_id, "terminalId": terminal_id, "command": command }),
        )
        .await?;
        loop {
            match receiver
                .recv()
                .await
                .context("host-agent event stream closed")?
            {
                HostAgentEvent::ExecuteResult {
                    request_id: id,
                    tracked,
                    command_id,
                } if id == request_id => {
                    return Ok((tracked, command_id));
                }
                HostAgentEvent::Error {
                    message,
                    fatal: true,
                } => bail!("Rust host-agent: {message}"),
                HostAgentEvent::Exit { exit_code } => {
                    bail!("Rust host-agent exited with code {exit_code}")
                }
                _ => {}
            }
        }
    }

    pub async fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<()> {
        self.send_json(
            REQUEST_RESIZE,
            &json!({ "terminalId": terminal_id, "cols": cols, "rows": rows }),
        )
        .await
    }

    pub async fn snapshot(&self) -> Result<(Vec<Value>, Value)> {
        let request_id = self.allocate_request_id();
        let mut receiver = self.events.subscribe();
        self.send_json(REQUEST_SNAPSHOT, &json!({ "requestId": request_id }))
            .await?;
        let mut events = Vec::new();
        loop {
            match receiver
                .recv()
                .await
                .context("host-agent event stream closed")?
            {
                HostAgentEvent::Output {
                    request_id: id,
                    seq,
                    data,
                } if id == request_id => {
                    events.push(json!({
                        "t": "output",
                        "seq": seq,
                        "data": crate::crypto::encode_base64(&data),
                        "snapshot": true,
                    }));
                }
                HostAgentEvent::Metadata {
                    request_id: Some(id),
                    event,
                } if id == request_id => {
                    events.push(event);
                }
                HostAgentEvent::SnapshotEnd {
                    request_id: id,
                    state,
                } if id == request_id => {
                    return Ok((events, state));
                }
                HostAgentEvent::Error {
                    message,
                    fatal: true,
                } => bail!("Rust host-agent: {message}"),
                HostAgentEvent::Exit { exit_code } => {
                    bail!("Rust host-agent exited with code {exit_code}")
                }
                _ => {}
            }
        }
    }

    pub async fn dispose(&self) {
        let _ = self.send_frame(REQUEST_KILL, &[]).await;
        let child = self.child.clone();
        let _ = tokio::time::timeout(Duration::from_secs(1), async move {
            let mut child = child.lock().await;
            let _ = child.wait().await;
        })
        .await;
        let mut child = self.child.lock().await;
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.kill().await;
        }
    }

    fn allocate_request_id(&self) -> u32 {
        loop {
            let current = self.next_request_id.fetch_add(1, Ordering::Relaxed);
            if current != 0 {
                return current;
            }
        }
    }

    async fn send_json<T: serde::Serialize>(&self, kind: u8, value: &T) -> Result<()> {
        self.send_frame(kind, &serde_json::to_vec(value)?).await
    }

    async fn send_frame(&self, kind: u8, payload: &[u8]) -> Result<()> {
        let length = payload
            .len()
            .checked_add(1)
            .context("host-agent frame length overflow")?;
        if length == 0 || length > MAX_FRAME_BYTES {
            bail!("host-agent frame is too large: {length} bytes");
        }
        let mut frame = Vec::with_capacity(4 + length);
        frame.extend_from_slice(&(length as u32).to_be_bytes());
        frame.push(kind);
        frame.extend_from_slice(payload);
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(&frame)
            .await
            .context("failed to write host-agent frame")?;
        stdin
            .flush()
            .await
            .context("failed to flush host-agent frame")?;
        Ok(())
    }
}

async fn wait_for_ready(receiver: &mut broadcast::Receiver<HostAgentEvent>) -> Result<Value> {
    loop {
        match receiver
            .recv()
            .await
            .context("host-agent event stream closed")?
        {
            HostAgentEvent::Ready(value) => return Ok(value),
            HostAgentEvent::Error { message, .. } => bail!("Rust host-agent: {message}"),
            HostAgentEvent::Exit { exit_code } => {
                bail!("Rust host-agent exited with code {exit_code}")
            }
            _ => {}
        }
    }
}

fn spawn_stdout_reader<R>(mut stdout: R, events: broadcast::Sender<HostAgentEvent>)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        while let Ok(length) = stdout.read_u32().await {
            let length = length as usize;
            if length == 0 || length > MAX_FRAME_BYTES {
                let _ = events.send(HostAgentEvent::Error {
                    message: format!("invalid host-agent frame length {length}"),
                    fatal: true,
                });
                break;
            }
            let mut frame = vec![0_u8; length];
            if stdout.read_exact(&mut frame).await.is_err() {
                break;
            }
            if let Some(event) = decode_event(frame[0], &frame[1..]) {
                let _ = events.send(event);
            }
        }
    });
}

fn spawn_stderr_reader<R>(mut stderr: R)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut buffer = [0_u8; 4096];
        while let Ok(size) = stderr.read(&mut buffer).await {
            if size == 0 {
                break;
            }
            tracing::debug!(target: "happy_host_agent", "{}", String::from_utf8_lossy(&buffer[..size]));
        }
    });
}

fn decode_event(kind: u8, payload: &[u8]) -> Option<HostAgentEvent> {
    match kind {
        EVENT_READY => serde_json::from_slice(payload)
            .ok()
            .map(HostAgentEvent::Ready),
        EVENT_OUTPUT if payload.len() >= 12 => Some(HostAgentEvent::Output {
            request_id: u32::from_be_bytes(payload[..4].try_into().ok()?),
            seq: u64::from_be_bytes(payload[4..12].try_into().ok()?),
            data: payload[12..].to_vec(),
        }),
        EVENT_METADATA => serde_json::from_slice::<Value>(payload)
            .ok()
            .and_then(|value| {
                let request_id = value
                    .get("requestId")
                    .and_then(Value::as_u64)
                    .map(|value| value as u32);
                Some(HostAgentEvent::Metadata {
                    request_id,
                    event: value.get("event")?.clone(),
                })
            }),
        EVENT_EXECUTE_RESULT => serde_json::from_slice::<Value>(payload)
            .ok()
            .and_then(|value| {
                Some(HostAgentEvent::ExecuteResult {
                    request_id: value.get("requestId")?.as_u64()? as u32,
                    tracked: value.get("tracked")?.as_bool()?,
                    command_id: value
                        .get("commandId")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                })
            }),
        EVENT_SNAPSHOT_END => serde_json::from_slice::<Value>(payload)
            .ok()
            .and_then(|value| {
                Some(HostAgentEvent::SnapshotEnd {
                    request_id: value.get("requestId")?.as_u64()? as u32,
                    state: value.get("state")?.clone(),
                })
            }),
        EVENT_EXIT => serde_json::from_slice::<Value>(payload)
            .ok()
            .and_then(|value| {
                Some(HostAgentEvent::Exit {
                    exit_code: value.get("exitCode")?.as_i64()? as i32,
                })
            }),
        EVENT_ERROR => serde_json::from_slice::<Value>(payload)
            .ok()
            .and_then(|value| {
                Some(HostAgentEvent::Error {
                    message: value.get("message")?.as_str()?.to_owned(),
                    fatal: value.get("fatal")?.as_bool()?,
                })
            }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn native_host_agent_start_snapshot_and_dispose() {
        let binary_name = if cfg!(windows) {
            "happy-host-agent.exe"
        } else {
            "happy-host-agent"
        };
        let binary = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("happy-host-agent")
            .join("target")
            .join("release")
            .join(binary_name);
        if !binary.exists() {
            return;
        }
        unsafe {
            std::env::set_var("HAPPY_HOST_AGENT_BIN", &binary);
        }
        let config = Config::load().unwrap();
        let client = HostAgentClient::start(
            &config,
            &std::env::current_dir().unwrap().to_string_lossy(),
            80,
            24,
        )
        .await
        .unwrap();
        let ready = client.ready().await.unwrap();
        assert_eq!(
            ready.get("protocolVersion").and_then(Value::as_u64),
            Some(2)
        );
        let (_events, state) = client.snapshot().await.unwrap();
        assert_eq!(state.get("status").and_then(Value::as_str), Some("idle"));
        client.dispose().await;
        unsafe {
            std::env::remove_var("HAPPY_HOST_AGENT_BIN");
        }
    }
}
