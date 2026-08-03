use crate::api::ApiClient;
use crate::auth;
use crate::cli::{AuthCommand, Cli, Command, DaemonCommand, DoctorCommand};
use crate::config::Config;
use crate::daemon;
use crate::doctor;
use crate::persistence;
use crate::server;
use crate::session::SessionClient;
use crate::terminal::{HostAgentClient, HostAgentEvent};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::io::IsTerminal;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::oneshot;
use tokio::time::Duration;

// This is the terminal stream/capabilities contract version exposed to the
// app. It is intentionally independent from the host-agent IPC protocol,
// which is currently version 2.
const TERMINAL_WIRE_PROTOCOL_VERSION: u64 = 4;

pub async fn run(cli: Cli) -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "happy_cli=info".to_owned()))
        .with_target(false)
        .with_ansi(std::io::stderr().is_terminal())
        .try_init()
        .ok();

    let config = Config::load()?;
    match cli.command.unwrap_or(Command::Terminal(Default::default())) {
        Command::Terminal(args) => run_terminal(&config, args.started_by).await,
        Command::Auth(args) => match args.command.unwrap_or(AuthCommand::Login) {
            AuthCommand::Login => {
                let _credentials = auth::authenticate(&config).await?;
                let machine_id = auth::ensure_machine_id(&config)?;
                println!("Machine ID: {machine_id}");
                Ok(())
            }
            AuthCommand::Logout => {
                persistence::clear_credentials(&config)?;
                persistence::clear_sessions(&config)?;
                let _ = persistence::update_settings(&config, |settings| {
                    settings.machine_id = None;
                    settings.onboarding_completed = false;
                });
                println!("Logged out");
                Ok(())
            }
            AuthCommand::Status => {
                print_auth_status(&config)?;
                Ok(())
            }
        },
        Command::Doctor(args) => match args.command {
            Some(DoctorCommand::Clean) => daemon::clean(&config).await,
            None => doctor::run(&config),
        },
        Command::Daemon(args) => match args.command {
            Some(DaemonCommand::Status) | None => doctor::daemon_status(&config),
            Some(DaemonCommand::Logs) => print_latest_log(&config),
            Some(DaemonCommand::List) => daemon::list(&config).await,
            Some(DaemonCommand::Start) => daemon::start_background(&config).await,
            Some(DaemonCommand::StartSync) => daemon::start_foreground(config.clone()).await,
            Some(DaemonCommand::Stop) => daemon::stop(&config).await,
            Some(DaemonCommand::Install) => daemon::install(&config).await,
            Some(DaemonCommand::Uninstall) => daemon::uninstall(&config).await,
            Some(DaemonCommand::StopSession { session_id }) => {
                daemon::stop_session(&config, &session_id).await
            }
        },
        Command::Notify(args) => {
            let message = args
                .message
                .ok_or_else(|| anyhow::anyhow!("message is required; use -p <message>"))?;
            let title = args.title.unwrap_or_else(|| "Happy".to_owned());
            let credentials = auth::ensure_credentials(&config).await?;
            let api = ApiClient::new(config.clone(), credentials)?;
            api.send_push_notification(&title, &message).await?;
            println!("Push notification sent successfully");
            Ok(())
        }
        Command::Server(args) => server::run(&config, args).await,
        Command::Bye => {
            println!("Bye!");
            Ok(())
        }
        Command::Logout => {
            persistence::clear_credentials(&config)?;
            persistence::clear_sessions(&config)?;
            println!("Logged out");
            Ok(())
        }
    }
}

async fn run_terminal(config: &Config, started_by: Option<crate::cli::StartedBy>) -> Result<()> {
    let credentials = auth::ensure_credentials(config).await?;
    let machine_id = auth::ensure_machine_id(config)?;
    let cwd = std::env::current_dir()?;
    let cwd_string = cwd.to_string_lossy().into_owned();
    let session_tag = uuid::Uuid::new_v4().to_string();
    let metadata = terminal_metadata(config, &machine_id, &cwd_string, started_by);
    let initial_state = json!({ "controlledByUser": false });
    let api = ApiClient::new(config.clone(), credentials.clone())?;
    let _machine = api
        .get_or_create_machine(
            &machine_id,
            &json!({
                "host": hostname(),
                "platform": std::env::consts::OS,
                "happyCliVersion": config.cli_version,
                "homeDir": home_dir(),
                "happyHomeDir": config.home_dir,
                "happyLibDir": config.home_dir,
            }),
            None,
        )
        .await?;
    let session = api
        .get_or_create_session(&session_tag, &metadata, Some(&initial_state))
        .await?;
    println!("Happy Session ID: {}", session.id);
    persistence::write_session(
        config,
        &persistence::PersistedSession {
            schema_version: persistence::STATE_SCHEMA_VERSION,
            runtime: "happy-rust-cli".to_owned(),
            session_id: session.id.clone(),
            encryption_key: crate::crypto::encode_base64(&session.encryption_key),
            seq: session.seq,
            metadata: session.metadata.clone(),
            metadata_version: session.metadata_version,
            agent_state: session.agent_state.clone(),
            agent_state_version: session.agent_state_version,
            updated_at: persistence::now_timestamp(),
        },
    )?;
    notify_daemon_session_started(config, &session, &metadata).await;

    let session_id = session.id.clone();
    let network = SessionClient::connect(config.clone(), &credentials.token, session).await?;
    crate::common::register(&network.rpc, config, Some(cwd.clone())).await?;
    let terminal = Arc::new(
        HostAgentClient::start(config, &cwd_string, 80, 24)
            .await
            .context("failed to start native host-agent")?,
    );

    register_terminal_handlers(&network, terminal.clone()).await?;
    let local_tty = started_by != Some(crate::cli::StartedBy::Daemon)
        && std::io::stdin().is_terminal()
        && std::io::stdout().is_terminal();
    if local_tty {
        crossterm::terminal::enable_raw_mode().context("failed to enable terminal raw mode")?;
    }

    let (exit_sender, mut exit_receiver) = oneshot::channel::<String>();
    spawn_terminal_event_forwarder(
        network.clone(),
        terminal.clone(),
        api.clone(),
        session_id,
        metadata.clone(),
        local_tty,
        exit_sender,
    );
    let input_task = if local_tty {
        Some(spawn_local_input(terminal.clone()))
    } else {
        None
    };
    let mut keep_alive = tokio::time::interval(Duration::from_secs(2));
    let mut session_events = network.subscribe();
    let shutdown_reason = loop {
        tokio::select! {
            _ = keep_alive.tick() => {
                network.keep_alive(false, if local_tty { "local" } else { "remote" }).await?;
            }
            result = &mut exit_receiver => {
                break result.unwrap_or_else(|_| "host-agent stopped".to_owned());
            }
            event = session_events.recv() => {
                match event {
                    Ok(crate::session::SessionEvent::Archived) => break "session archived".to_owned(),
                    Ok(crate::session::SessionEvent::SocketError(error)) => {
                        tracing::warn!("{error}");
                    }
                    Ok(crate::session::SessionEvent::Update(_)) => {}
                    Err(_) => break "session event stream closed".to_owned(),
                }
            }
            result = tokio::signal::ctrl_c() => {
                result.context("failed to install Ctrl-C handler")?;
                break "SIGINT".to_owned();
            }
        }
    };

    if let Some(task) = input_task {
        task.abort();
    }
    if local_tty {
        let _ = crossterm::terminal::disable_raw_mode();
    }
    terminal.dispose().await;
    let mut archived_metadata = metadata.clone();
    if let Some(object) = archived_metadata.as_object_mut() {
        object.insert("lifecycleState".to_owned(), json!("archived"));
        object.insert("lifecycleStateSince".to_owned(), json!(now_ms()));
        object.insert("archivedBy".to_owned(), json!("cli"));
        object.insert("archiveReason".to_owned(), json!(shutdown_reason));
    }
    let _ = network.update_metadata(archived_metadata).await;
    let _ = network.send_session_death().await;
    let _ = network.flush().await;
    let _ = network.close().await;
    let _ = api.deactivate_session(&network.session_id().await).await;
    Ok(())
}

async fn register_terminal_handlers(
    network: &SessionClient,
    terminal: Arc<HostAgentClient>,
) -> Result<()> {
    let input_terminal = terminal.clone();
    network
        .rpc
        .register("terminal-input", move |params| {
            let terminal = input_terminal.clone();
            async move {
                if params.get("t").and_then(Value::as_str) != Some("input") {
                    return Ok(json!({}));
                }
                let terminal_id = terminal_id(params.get("terminalId"));
                let data = params
                    .get("data")
                    .and_then(Value::as_str)
                    .context("terminal input data is missing")?;
                let data = crate::crypto::decode_base64(data)?;
                terminal.write(&terminal_id, &data).await?;
                Ok(json!({}))
            }
        })
        .await?;

    let execute_terminal = terminal.clone();
    network
        .rpc
        .register("terminal-execute", move |params| {
            let terminal = execute_terminal.clone();
            async move {
                if params.get("t").and_then(Value::as_str) != Some("execute") {
                    return Ok(json!({ "tracked": false }));
                }
                let command = params
                    .get("command")
                    .and_then(Value::as_str)
                    .context("terminal command is missing")?;
                if command.trim().is_empty() {
                    return Ok(json!({ "tracked": false }));
                }
                let (tracked, command_id) = terminal
                    .execute(&terminal_id(params.get("terminalId")), command)
                    .await?;
                Ok(json!({ "tracked": tracked, "commandId": command_id }))
            }
        })
        .await?;

    let resize_terminal = terminal.clone();
    network
        .rpc
        .register("terminal-resize", move |params| {
            let terminal = resize_terminal.clone();
            async move {
                if params.get("t").and_then(Value::as_str) != Some("resize") {
                    return Ok(json!({}));
                }
                let cols = params
                    .get("cols")
                    .and_then(Value::as_u64)
                    .context("terminal cols is missing")?;
                let rows = params
                    .get("rows")
                    .and_then(Value::as_u64)
                    .context("terminal rows is missing")?;
                if cols == 0 || rows == 0 || cols > u16::MAX as u64 || rows > u16::MAX as u64 {
                    bail!("terminal dimensions are invalid");
                }
                terminal
                    .resize(
                        &terminal_id(params.get("terminalId")),
                        cols as u16,
                        rows as u16,
                    )
                    .await?;
                Ok(json!({}))
            }
        })
        .await?;

    let attach_terminal = terminal.clone();
    let attach_network = network.clone();
    network
        .rpc
        .register("terminal-attach", move |params| {
            let terminal = attach_terminal.clone();
            let network = attach_network.clone();
            async move {
                if params.get("t").and_then(Value::as_str) != Some("attach") {
                    return Ok(json!({}));
                }
                let (events, state) = terminal.snapshot().await?;
                for event in events {
                    network.send_terminal_output(&event, true).await?;
                }
                let ready = terminal.ready().await.unwrap_or_else(|| json!({}));
                Ok(json!({
                    "capabilities": {
                        "protocolVersion": TERMINAL_WIRE_PROTOCOL_VERSION,
                        "structuredCommands": ready.get("structuredCommands").and_then(Value::as_bool).unwrap_or(false),
                        "shell": ready.get("shell").and_then(Value::as_str).unwrap_or("unknown"),
                        "perDevicePty": false,
                        "adaptiveGrid": true,
                        "ptyBackend": "rust-host-agent",
                    },
                    "state": state,
                }))
            }
        })
        .await?;
    Ok(())
}

fn spawn_terminal_event_forwarder(
    network: SessionClient,
    terminal: Arc<HostAgentClient>,
    api: ApiClient,
    session_id: String,
    session_metadata: Value,
    local_tty: bool,
    exit_sender: oneshot::Sender<String>,
) {
    tokio::spawn(async move {
        let mut receiver = terminal.subscribe();
        let mut stdout = tokio::io::stdout();
        let mut exit_sender = Some(exit_sender);
        let mut active_commands = std::collections::HashSet::new();
        let mut attention_notified = std::collections::HashSet::new();
        while let Ok(event) = receiver.recv().await {
            match event {
                HostAgentEvent::Output {
                    request_id,
                    seq,
                    data,
                } => {
                    if request_id != 0 {
                        continue;
                    }
                    if local_tty && request_id == 0 {
                        if stdout.write_all(&data).await.is_err() {
                            if let Some(sender) = exit_sender.take() {
                                let _ = sender.send("local terminal output failed".to_owned());
                            }
                            return;
                        }
                        let _ = stdout.flush().await;
                    }
                    let payload = json!({
                        "t": "output",
                        "seq": seq,
                        "data": crate::crypto::encode_base64(&data),
                    });
                    if let Err(error) = network
                        .send_terminal_output(&payload, request_id != 0)
                        .await
                    {
                        if let Some(sender) = exit_sender.take() {
                            let _ = sender.send(format!("terminal output relay failed: {error:#}"));
                        }
                        return;
                    }
                }
                HostAgentEvent::Metadata { request_id, event } => {
                    if request_id.is_none() {
                        if let Err(error) = network.send_terminal_output(&event, false).await {
                            if let Some(sender) = exit_sender.take() {
                                let _ = sender
                                    .send(format!("terminal metadata relay failed: {error:#}"));
                            }
                            return;
                        }
                        handle_terminal_notification(
                            &api,
                            &session_id,
                            &session_metadata,
                            &event,
                            &mut active_commands,
                            &mut attention_notified,
                        );
                    }
                }
                HostAgentEvent::Exit { exit_code } => {
                    if let Some(sender) = exit_sender.take() {
                        let _ = sender.send(format!("host-agent exited with code {exit_code}"));
                    }
                    return;
                }
                HostAgentEvent::Error { message, fatal } if fatal => {
                    if let Some(sender) = exit_sender.take() {
                        let _ = sender.send(format!("host-agent error: {message}"));
                    }
                    return;
                }
                _ => {}
            }
        }
        if let Some(sender) = exit_sender.take() {
            let _ = sender.send("host-agent event stream closed".to_owned());
        }
    });
}

fn handle_terminal_notification(
    api: &ApiClient,
    session_id: &str,
    session_metadata: &Value,
    event: &Value,
    active_commands: &mut std::collections::HashSet<String>,
    attention_notified: &mut std::collections::HashSet<String>,
) {
    match event.get("t").and_then(Value::as_str) {
        Some("command-start") => {
            if let Some(command_id) = event.get("commandId").and_then(Value::as_str) {
                active_commands.insert(command_id.to_owned());
            }
        }
        Some("state") if event.get("state").and_then(Value::as_str) == Some("needs-input") => {
            let Some(command_id) = event.get("commandId").and_then(Value::as_str) else {
                return;
            };
            if !active_commands.contains(command_id)
                || !attention_notified.insert(command_id.to_owned())
            {
                return;
            }
            let api = api.clone();
            let session_id = session_id.to_owned();
            let body = terminal_session_title(session_metadata);
            let data = json!({ "sessionId": session_id.clone(), "commandId": command_id });
            tokio::spawn(async move {
                if let Err(error) = api
                    .send_session_notification(
                        &session_id,
                        "terminal-needs-input",
                        "Terminal needs input",
                        &body,
                        &data,
                    )
                    .await
                {
                    tracing::debug!("terminal input notification failed: {error:#}");
                }
            });
        }
        Some("command-end") => {
            let Some(command_id) = event.get("commandId").and_then(Value::as_str) else {
                return;
            };
            active_commands.remove(command_id);
            attention_notified.remove(command_id);
            let duration_ms = event.get("durationMs").and_then(Value::as_u64).unwrap_or(0);
            let exit_code = event.get("exitCode").and_then(Value::as_i64).unwrap_or(-1);
            let failed = exit_code != 0;
            let threshold = if failed { 3_000 } else { 10_000 };
            if duration_ms < threshold {
                return;
            }
            let duration = format_notification_duration(duration_ms);
            let (kind, title, body) = if failed {
                (
                    "terminal-failed",
                    "Command failed",
                    format!("Exited with code {exit_code} after {duration}."),
                )
            } else {
                (
                    "terminal-done",
                    "Command finished",
                    format!("Completed in {duration}."),
                )
            };
            let api = api.clone();
            let session_id = session_id.to_owned();
            let data = json!({
                "sessionId": session_id.clone(),
                "commandId": command_id,
                "exitCode": exit_code,
                "durationMs": duration_ms,
            });
            tokio::spawn(async move {
                if let Err(error) = api
                    .send_session_notification(&session_id, kind, title, &body, &data)
                    .await
                {
                    tracing::debug!("terminal completion notification failed: {error:#}");
                }
            });
        }
        _ => {}
    }
}

fn format_notification_duration(duration_ms: u64) -> String {
    if duration_ms < 60_000 {
        format!(
            "{}s",
            std::cmp::max(1, (duration_ms as f64 / 1000.0).round() as u64)
        )
    } else {
        format!(
            "{}m {}s",
            duration_ms / 60_000,
            (duration_ms % 60_000) / 1000
        )
    }
}

fn terminal_session_title(metadata: &Value) -> String {
    metadata
        .get("path")
        .and_then(Value::as_str)
        .and_then(|path| path.split(['/', '\\']).rfind(|part| !part.is_empty()))
        .filter(|part| !part.is_empty())
        .unwrap_or("Session")
        .to_owned()
}

fn spawn_local_input(terminal: Arc<HostAgentClient>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut stdin = tokio::io::stdin();
        let mut buffer = [0_u8; 4096];
        loop {
            match stdin.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    if terminal.write("local-cli", &buffer[..size]).await.is_err() {
                        break;
                    }
                }
            }
        }
    })
}

fn terminal_id(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .unwrap_or("legacy-shared-client")
        .to_owned()
}

fn terminal_metadata(
    config: &Config,
    machine_id: &str,
    cwd: &str,
    started_by: Option<crate::cli::StartedBy>,
) -> Value {
    let hostname = hostname();
    let home = home_dir();
    json!({
        "path": cwd,
        "host": hostname,
        "version": config.cli_version,
        "os": std::env::consts::OS,
        "machineId": machine_id,
        "homeDir": home,
        "happyHomeDir": config.home_dir,
        "happyLibDir": config.home_dir,
        "happyToolsDir": config.home_dir.join("tools"),
        "startedFromDaemon": started_by == Some(crate::cli::StartedBy::Daemon),
        "hostPid": std::process::id(),
        "startedBy": match started_by {
            Some(crate::cli::StartedBy::Daemon) => "daemon",
            _ => "terminal",
        },
        "lifecycleState": "running",
        "lifecycleStateSince": now_ms(),
        "flavor": "terminal",
    })
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-host".to_owned())
}

fn home_dir() -> String {
    if cfg!(windows) {
        std::env::var("USERPROFILE").unwrap_or_default()
    } else {
        std::env::var("HOME").unwrap_or_default()
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

async fn notify_daemon_session_started(
    config: &Config,
    session: &crate::api::Session,
    metadata: &Value,
) {
    let Ok(Some(state)) = persistence::read_daemon_state(config) else {
        return;
    };
    if !doctor::process_alive(state.pid) || state.http_port == 0 {
        return;
    }
    let body = json!({
        "sessionId": session.id,
        "metadata": metadata,
        "encryption": {
            "encryptionKey": crate::crypto::encode_base64(&session.encryption_key),
            "encryptionVariant": "dataKey",
            "seq": session.seq,
            "metadataVersion": session.metadata_version,
            "agentStateVersion": session.agent_state_version,
        },
    });
    let url = format!("http://127.0.0.1:{}/session-started", state.http_port);
    let _ = reqwest::Client::new()
        .post(url)
        .json(&body)
        .timeout(Duration::from_secs(3))
        .send()
        .await;
}

fn print_latest_log(config: &Config) -> Result<()> {
    let latest = std::fs::read_dir(&config.logs_dir)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path);
    match latest {
        Some(path) => println!("{}", path.display()),
        None => println!("No daemon logs found"),
    }
    Ok(())
}

fn print_auth_status(config: &Config) -> Result<()> {
    match persistence::read_credentials(config)? {
        None => {
            println!("Not authenticated");
            println!("Run happy auth login to authenticate");
        }
        Some(credentials) => {
            let preview = credentials.token.chars().take(12).collect::<String>();
            let settings = persistence::read_settings(config)?;
            println!("Authenticated");
            println!("  Token: {preview}...");
            match settings.machine_id {
                Some(machine_id) => {
                    println!("  Machine ID: {machine_id}");
                    println!("  Host: {}", hostname());
                }
                None => println!("  Machine: not registered"),
            }
            println!("  Data directory: {}", config.home_dir.display());
        }
    }
    Ok(())
}
