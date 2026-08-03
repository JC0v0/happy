use crate::api::ApiClient;
use crate::auth;
use crate::config::Config;
use crate::doctor;
use crate::machine::MachineClient;
use crate::persistence::{self, DaemonState};
use anyhow::{Context, Result, bail};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::{Mutex, Notify};

#[derive(Clone)]
struct ControlState {
    config: Config,
    children: Arc<Mutex<HashMap<u32, ChildRecord>>>,
    shutdown: Arc<Notify>,
}

#[derive(Debug, Clone)]
struct ChildRecord {
    started_by: String,
    session_id: Option<String>,
    pid: u32,
}

#[derive(Debug, Serialize)]
struct ChildResponse {
    #[serde(rename = "startedBy")]
    started_by: String,
    #[serde(rename = "happySessionId")]
    happy_session_id: String,
    pid: u32,
}

#[derive(Debug, Deserialize)]
struct SessionStartedRequest {
    #[serde(rename = "sessionId")]
    session_id: String,
    metadata: Value,
}

#[derive(Debug, Deserialize)]
struct StopSessionRequest {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(Debug, Deserialize)]
struct SpawnSessionRequest {
    directory: String,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

#[derive(Debug, Serialize)]
struct SpawnSuccess {
    success: bool,
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(
        rename = "approvedNewDirectoryCreation",
        skip_serializing_if = "Option::is_none"
    )]
    approved_new_directory_creation: Option<bool>,
}

pub async fn start_background(config: &Config) -> Result<()> {
    if doctor::daemon_is_running(config)? {
        println!("Daemon already running");
        return Ok(());
    }
    let exe = resolve_cli_executable(config)?;
    let log_path = config
        .logs_dir
        .join(format!("daemon-{}.log", persistence::now_timestamp()));
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("failed to open daemon log {}", log_path.display()))?;
    let stderr = log.try_clone()?;
    let mut command = Command::new(exe);
    command
        .args(["daemon", "start-sync"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::from(log))
        .stderr(std::process::Stdio::from(stderr))
        .env("HAPPY_CLI_BIN", resolve_cli_executable(config)?)
        .kill_on_drop(false);
    configure_hidden_process(&mut command);
    let mut child = command
        .spawn()
        .context("failed to spawn native Happy daemon")?;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while tokio::time::Instant::now() < deadline {
        if let Some(state) = persistence::read_daemon_state(config)?
            && doctor::process_alive(state.pid)
            && state.http_port != 0
        {
            println!(
                "Daemon started (pid {}, port {})",
                state.pid, state.http_port
            );
            return Ok(());
        }
        if let Some(status) = child
            .try_wait()
            .context("failed to inspect native daemon")?
        {
            bail!(
                "native daemon exited with status {status}; inspect {}",
                log_path.display()
            );
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    bail!(
        "native daemon did not become ready; inspect {}",
        log_path.display()
    )
}

pub async fn start_foreground(config: Config) -> Result<()> {
    let lock = match persistence::acquire_daemon_lock(&config) {
        Ok(lock) => lock,
        Err(error) => {
            let lock_pid = fs::read_to_string(&config.daemon_lock_file)
                .ok()
                .and_then(|value| value.trim().parse::<u32>().ok());
            if lock_pid.map(doctor::process_alive).unwrap_or(false) {
                return Err(error);
            }
            if config.daemon_lock_file.exists() {
                fs::remove_file(&config.daemon_lock_file).with_context(|| {
                    format!(
                        "failed to remove stale daemon lock {}",
                        config.daemon_lock_file.display()
                    )
                })?;
            }
            persistence::acquire_daemon_lock(&config)?
        }
    };
    if let Some(state) = persistence::read_daemon_state(&config)? {
        if doctor::process_alive(state.pid) {
            drop(lock);
            bail!("daemon is already running with pid {}", state.pid);
        }
        persistence::clear_daemon_state(&config)?;
    }

    let control = bind_control_server(config.clone()).await?;
    let state = DaemonState {
        schema_version: persistence::STATE_SCHEMA_VERSION,
        runtime: "happy-rust-cli".to_owned(),
        pid: std::process::id(),
        http_port: control.port,
        start_time: persistence::now_timestamp(),
        cli_version: config.cli_version.clone(),
        daemon_log_path: None,
    };
    persistence::write_daemon_state(&config, &state)?;

    let credentials = match persistence::read_credentials(&config) {
        Ok(Some(credentials)) => credentials,
        Ok(None) => {
            control.stop().await;
            persistence::clear_daemon_state(&config)?;
            drop(lock);
            bail!("daemon requires authentication; run `happy auth login` first")
        }
        Err(error) => {
            control.stop().await;
            persistence::clear_daemon_state(&config)?;
            drop(lock);
            return Err(error);
        }
    };
    let machine_id = auth::ensure_machine_id(&config)?;
    let api = ApiClient::new(config.clone(), credentials.clone())?;
    let metadata = machine_metadata(&config);
    let machine = api
        .get_or_create_machine(
            &machine_id,
            &metadata,
            Some(&json!({
                "status": "running",
                "pid": state.pid,
                "httpPort": state.http_port,
                "startedAt": now_ms(),
            })),
        )
        .await?;
    let machine_client =
        MachineClient::connect(config.clone(), &credentials.token, machine).await?;
    crate::common::register(&machine_client.rpc, &config, None).await?;
    let _ = machine_client
        .update_daemon_state(json!({
            "status": "running",
            "pid": state.pid,
            "httpPort": state.http_port,
            "startedAt": now_ms(),
        }))
        .await;

    let shutdown = control.shutdown.clone();
    let stop_shutdown = shutdown.clone();
    machine_client
        .rpc
        .register("stop-daemon", move |_| {
            let shutdown = stop_shutdown.clone();
            async move {
                shutdown.notify_one();
                Ok(json!({ "message": "daemon stopping" }))
            }
        })
        .await?;
    let machine_control = control.state.clone();
    let spawn_control = machine_control.clone();
    machine_client
        .rpc
        .register("spawn-happy-session", move |params| {
            let control = spawn_control.clone();
            async move {
                let directory = params
                    .get("directory")
                    .and_then(Value::as_str)
                    .context("directory is required")?
                    .to_owned();
                let session_id = params
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let id = spawn_session(
                    &control,
                    SpawnSessionRequest {
                        directory,
                        session_id,
                        extra: params
                            .as_object()
                            .map(|object| {
                                object
                                    .iter()
                                    .map(|(key, value)| (key.clone(), value.clone()))
                                    .collect()
                            })
                            .unwrap_or_default(),
                    },
                )
                .await?;
                Ok(json!({ "type": "success", "sessionId": id }))
            }
        })
        .await?;
    let resume_control = machine_control.clone();
    machine_client
        .rpc
        .register("resume-happy-session", move |params| {
            let control = resume_control.clone();
            async move {
                let directory = params
                    .get("directory")
                    .and_then(Value::as_str)
                    .unwrap_or(".")
                    .to_owned();
                let session_id = params
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let id = spawn_session(
                    &control,
                    SpawnSessionRequest {
                        directory,
                        session_id,
                        extra: params
                            .as_object()
                            .map(|object| {
                                object
                                    .iter()
                                    .map(|(key, value)| (key.clone(), value.clone()))
                                    .collect()
                            })
                            .unwrap_or_default(),
                    },
                )
                .await?;
                Ok(json!({ "type": "success", "sessionId": id }))
            }
        })
        .await?;
    let stop_control = machine_control.clone();
    machine_client
        .rpc
        .register("stop-session", move |params| {
            let control = stop_control.clone();
            async move {
                let session_id = params
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .context("sessionId is required")?;
                if stop_session_by_id(&control, session_id).await? {
                    Ok(json!({ "message": "Session stopped" }))
                } else {
                    bail!("session not found")
                }
            }
        })
        .await?;

    let mut keep_alive = tokio::time::interval(Duration::from_secs(20));
    let result = loop {
        tokio::select! {
            _ = keep_alive.tick() => {
                let _ = machine_client.keep_alive().await;
            }
            _ = shutdown.notified() => break Ok(()),
            signal = tokio::signal::ctrl_c() => {
                signal.context("failed to install Ctrl-C handler")?;
                break Ok(());
            }
        }
    };

    let _ = machine_client
        .update_daemon_state(json!({
            "status": "shutting-down",
            "pid": state.pid,
            "httpPort": state.http_port,
            "shutdownRequestedAt": now_ms(),
            "shutdownSource": "os-signal",
        }))
        .await;
    let _ = machine_client.close().await;
    stop_children(&control.children).await;
    control.stop().await;
    persistence::clear_daemon_state(&config)?;
    drop(lock);
    result
}

pub async fn stop(config: &Config) -> Result<()> {
    let Some(state) = persistence::read_daemon_state(config)? else {
        println!("Daemon is not running");
        return Ok(());
    };
    let url = format!("http://127.0.0.1:{}/stop", state.http_port);
    let client = reqwest::Client::new();
    if client.post(&url).json(&json!({})).send().await.is_ok() {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        while tokio::time::Instant::now() < deadline {
            if !doctor::process_alive(state.pid) {
                println!("Daemon stopped");
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    if doctor::process_alive(state.pid) {
        terminate_pid(state.pid).await?;
    }
    persistence::clear_daemon_state(config)?;
    println!("Daemon stopped");
    Ok(())
}

pub async fn list(config: &Config) -> Result<()> {
    if !doctor::daemon_is_running(config)? {
        println!("No daemon sessions");
        return Ok(());
    }
    let response = post_control(config, "/list", json!({})).await?;
    let children = response
        .get("children")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if children.is_empty() {
        println!("No daemon sessions");
    } else {
        for child in children {
            println!(
                "{}\t{}\t{}",
                child
                    .get("happySessionId")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                child.get("pid").and_then(Value::as_u64).unwrap_or_default(),
                child
                    .get("startedBy")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
            );
        }
    }
    Ok(())
}

pub async fn install(config: &Config) -> Result<()> {
    #[cfg(any(target_os = "macos", target_os = "linux", windows))]
    let exe = resolve_cli_executable(config)?;
    #[cfg(target_os = "macos")]
    {
        let service_id = "com.happy.cli";
        let launch_agents = std::env::var_os("HOME")
            .map(PathBuf::from)
            .context("HOME is not set")?
            .join("Library")
            .join("LaunchAgents");
        fs::create_dir_all(&launch_agents)?;
        let plist = launch_agents.join(format!("{service_id}.plist"));
        let content = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \
\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\
<plist version=\"1.0\"><dict>\
<key>Label</key><string>{service_id}</string>\
<key>ProgramArguments</key><array><string>{}</string><string>daemon</string><string>start-sync</string></array>\
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>\
</dict></plist>",
            xml_escape(&exe.to_string_lossy())
        );
        fs::write(&plist, content)?;
        run_service_command("launchctl", &["load", &plist.to_string_lossy()]).await?;
        println!("Daemon service installed: {}", plist.display());
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let dir = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .context("could not determine user config directory")?
            .join("systemd")
            .join("user");
        fs::create_dir_all(&dir)?;
        let unit = dir.join("happy.service");
        fs::write(
            &unit,
            format!(
                "[Unit]\nDescription=Happy native daemon\nAfter=network-online.target\n\n[Service]\nExecStart=\"{}\" daemon start-sync\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n",
                exe.display()
            ),
        )?;
        run_service_command("systemctl", &["--user", "daemon-reload"]).await?;
        run_service_command("systemctl", &["--user", "enable", "--now", "happy.service"]).await?;
        println!("Daemon service installed: {}", unit.display());
        Ok(())
    }
    #[cfg(windows)]
    {
        let task = format!("\\\"{}\\\" daemon start-sync", exe.display());
        run_service_command(
            "schtasks",
            &[
                "/Create", "/TN", "Happy", "/SC", "ONLOGON", "/TR", &task, "/F",
            ],
        )
        .await?;
        println!("Daemon task installed");
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        bail!("daemon installation is unsupported on this platform")
    }
}

pub async fn uninstall(config: &Config) -> Result<()> {
    let _ = stop(config).await;
    #[cfg(target_os = "macos")]
    {
        let path = std::env::var_os("HOME")
            .map(PathBuf::from)
            .context("HOME is not set")?
            .join("Library")
            .join("LaunchAgents")
            .join("com.happy.cli.plist");
        if path.exists() {
            let _ = run_service_command("launchctl", &["unload", &path.to_string_lossy()]).await;
            fs::remove_file(&path)?;
        }
        println!("Daemon service uninstalled");
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let dir = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .context("could not determine user config directory")?
            .join("systemd")
            .join("user");
        let unit = dir.join("happy.service");
        let _ = run_service_command(
            "systemctl",
            &["--user", "disable", "--now", "happy.service"],
        )
        .await;
        if unit.exists() {
            fs::remove_file(unit)?;
        }
        println!("Daemon service uninstalled");
        Ok(())
    }
    #[cfg(windows)]
    {
        let _ = run_service_command("schtasks", &["/Delete", "/TN", "Happy", "/F"]).await;
        println!("Daemon task uninstalled");
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    bail!("daemon uninstallation is unsupported on this platform")
}

async fn run_service_command(program: &str, args: &[&str]) -> Result<()> {
    let status = Command::new(program)
        .args(args)
        .status()
        .await
        .with_context(|| format!("failed to run {program}"))?;
    if !status.success() {
        bail!("{program} exited with status {status}");
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\"', "&quot;")
}

pub async fn stop_session(config: &Config, session_id: &str) -> Result<()> {
    let response =
        post_control(config, "/stop-session", json!({ "sessionId": session_id })).await?;
    if response
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        println!("Session stopped");
        Ok(())
    } else {
        bail!("session was not found")
    }
}

pub async fn clean(config: &Config) -> Result<()> {
    let _ = stop(config).await;
    persistence::clear_sessions(config)?;
    if config.daemon_state_file.exists() {
        persistence::clear_daemon_state(config)?;
    }
    println!("Daemon state cleaned");
    Ok(())
}

struct ControlServer {
    port: u16,
    shutdown: Arc<Notify>,
    state: ControlState,
    children: Arc<Mutex<HashMap<u32, ChildRecord>>>,
    task: tokio::task::JoinHandle<()>,
}

impl ControlServer {
    async fn stop(self) {
        // Store a permit when the server task has not started waiting yet.
        // `notify_waiters` can lose the shutdown signal during startup and
        // leave error cleanup blocked forever.
        self.shutdown.notify_one();
        let _ = self.task.await;
    }
}

async fn bind_control_server(config: Config) -> Result<ControlServer> {
    let shutdown = Arc::new(Notify::new());
    let state = ControlState {
        config,
        children: Arc::new(Mutex::new(HashMap::new())),
        shutdown: shutdown.clone(),
    };
    let children = state.children.clone();
    let router = Router::new()
        .route("/session-started", post(session_started))
        .route("/list", post(list_sessions))
        .route("/stop-session", post(stop_session_route))
        .route("/spawn-session", post(spawn_session_route))
        .route("/stop", post(stop_route))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .context("failed to bind daemon control server")?;
    let port = listener.local_addr()?.port();
    let shutdown_signal = shutdown.clone();
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move { shutdown_signal.notified().await })
            .await;
    });
    Ok(ControlServer {
        port,
        shutdown,
        state: state.clone(),
        children,
        task,
    })
}

async fn session_started(
    State(state): State<ControlState>,
    Json(payload): Json<SessionStartedRequest>,
) -> Json<Value> {
    let host_pid = payload
        .metadata
        .get("hostPid")
        .and_then(Value::as_u64)
        .map(|pid| pid as u32);
    let mut children = state.children.lock().await;
    if let Some(pid) = host_pid
        && let Some(child) = children.get_mut(&pid)
    {
        child.session_id = Some(payload.session_id);
    }
    Json(json!({ "status": "ok" }))
}

async fn list_sessions(State(state): State<ControlState>) -> Json<Value> {
    let children = state.children.lock().await;
    let response = children
        .values()
        .filter_map(|child| {
            Some(ChildResponse {
                started_by: child.started_by.clone(),
                happy_session_id: child.session_id.clone()?,
                pid: child.pid,
            })
        })
        .collect::<Vec<_>>();
    Json(json!({ "children": response }))
}

async fn stop_session_route(
    State(state): State<ControlState>,
    Json(payload): Json<StopSessionRequest>,
) -> Json<Value> {
    let success = stop_session_by_id(&state, &payload.session_id)
        .await
        .unwrap_or(false);
    Json(json!({ "success": success }))
}

async fn stop_session_by_id(state: &ControlState, session_id: &str) -> Result<bool> {
    let pid = {
        let children = state.children.lock().await;
        children
            .values()
            .find(|child| child.session_id.as_deref() == Some(session_id))
            .map(|child| child.pid)
    };
    match pid {
        Some(pid) => Ok(terminate_pid(pid).await.is_ok()),
        None => Ok(false),
    }
}

async fn spawn_session_route(
    State(state): State<ControlState>,
    Json(payload): Json<SpawnSessionRequest>,
) -> impl IntoResponse {
    match spawn_session(&state, payload).await {
        Ok(session_id) => (
            StatusCode::OK,
            Json(
                serde_json::to_value(SpawnSuccess {
                    success: true,
                    session_id: Some(session_id),
                    approved_new_directory_creation: Some(true),
                })
                .unwrap_or_else(|_| json!({ "success": true })),
            ),
        ),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": format!("{error:#}") })),
        ),
    }
}

async fn stop_route(State(state): State<ControlState>) -> Json<Value> {
    state.shutdown.notify_one();
    Json(json!({ "status": "stopping" }))
}

async fn spawn_session(state: &ControlState, payload: SpawnSessionRequest) -> Result<String> {
    let directory = PathBuf::from(&payload.directory);
    if !directory.is_dir() {
        bail!("directory does not exist: {}", directory.display());
    }
    let exe = resolve_cli_executable(&state.config)?;
    let mut command = Command::new(exe);
    command
        .args(["terminal", "--started-by", "daemon"])
        .current_dir(&directory)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(false);
    for (key, value) in payload.extra {
        if key == "environmentVariables"
            && let Some(values) = value.as_object()
        {
            for (name, value) in values {
                if let Some(value) = value.as_str() {
                    command.env(name, value);
                }
            }
        }
    }
    let mut child = command.spawn().context("failed to spawn daemon terminal")?;
    let pid = child.id().context("daemon terminal has no process id")?;
    state.children.lock().await.insert(
        pid,
        ChildRecord {
            started_by: "daemon".to_owned(),
            session_id: payload.session_id.clone(),
            pid,
        },
    );
    let children = state.children.clone();
    tokio::spawn(async move {
        let _ = child.wait().await;
        children.lock().await.remove(&pid);
    });
    if let Some(session_id) = payload.session_id {
        return Ok(session_id);
    }
    for _ in 0..100 {
        if let Some(session_id) = state
            .children
            .lock()
            .await
            .get(&pid)
            .and_then(|child| child.session_id.clone())
        {
            return Ok(session_id);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Ok(format!("pending-{pid}"))
}

async fn post_control(config: &Config, path: &str, body: Value) -> Result<Value> {
    let state = persistence::read_daemon_state(config)?.context("daemon is not running")?;
    if !doctor::process_alive(state.pid) {
        bail!("daemon process is not running");
    }
    reqwest::Client::new()
        .post(format!("http://127.0.0.1:{}{path}", state.http_port))
        .json(&body)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .context("failed to contact daemon control server")?
        .error_for_status()
        .context("daemon control request failed")?
        .json()
        .await
        .context("daemon control response was not JSON")
}

async fn stop_children(children: &Arc<Mutex<HashMap<u32, ChildRecord>>>) {
    let pids = children
        .lock()
        .await
        .values()
        .map(|child| child.pid)
        .collect::<Vec<_>>();
    for pid in pids {
        let _ = terminate_pid(pid).await;
    }
}

async fn terminate_pid(pid: u32) -> Result<()> {
    if !doctor::process_alive(pid) {
        return Ok(());
    }
    #[cfg(windows)]
    {
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .await
            .context("failed to invoke taskkill")?;
    }
    #[cfg(not(windows))]
    {
        Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .await
            .context("failed to invoke kill")?;
    }
    Ok(())
}

fn resolve_cli_executable(config: &Config) -> Result<PathBuf> {
    if let Some(path) = config.native_cli_override() {
        return Ok(path);
    }
    std::env::current_exe().context("failed to resolve native happy executable")
}

fn configure_hidden_process(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
}

fn machine_metadata(config: &Config) -> Value {
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-host".to_owned());
    json!({
        "host": hostname,
        "platform": std::env::consts::OS,
        "happyCliVersion": config.cli_version,
        "homeDir": std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default(),
        "happyHomeDir": config.home_dir,
        "happyLibDir": config.home_dir,
    })
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

    fn test_config() -> Config {
        Config {
            home_dir: PathBuf::from("target/test-home"),
            settings_file: PathBuf::from("target/test-home/settings.json"),
            credentials_file: PathBuf::from("target/test-home/access.key"),
            daemon_state_file: PathBuf::from("target/test-home/daemon.state.json"),
            daemon_lock_file: PathBuf::from("target/test-home/daemon.state.json.lock"),
            sessions_file: PathBuf::from("target/test-home/sessions.json"),
            logs_dir: PathBuf::from("target/test-home/logs"),
            server_url: "http://127.0.0.1:3005".to_owned(),
            webapp_url: "http://127.0.0.1:3005".to_owned(),
            cli_version: "test".to_owned(),
        }
    }

    #[tokio::test]
    async fn control_server_lists_and_stops_cleanly() {
        let control = bind_control_server(test_config()).await.unwrap();
        let client = reqwest::Client::new();
        let list: Value = client
            .post(format!("http://127.0.0.1:{}/list", control.port))
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(list, json!({ "children": [] }));
        let stop: Value = client
            .post(format!("http://127.0.0.1:{}/stop", control.port))
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(stop, json!({ "status": "stopping" }));
        control.stop().await;
    }
}
