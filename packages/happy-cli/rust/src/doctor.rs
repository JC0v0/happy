use crate::config::Config;
use crate::persistence::{self, DaemonState};
use anyhow::Result;
use std::path::Path;
use std::process::Command;

pub fn run(config: &Config) -> Result<()> {
    println!("Happy CLI doctor");
    println!("  version:     {}", config.cli_version);
    println!("  home:        {}", config.home_dir.display());
    println!("  server:      {}", config.server_url);
    println!("  webapp:      {}", config.webapp_url);
    println!(
        "  credentials: {}",
        match persistence::read_credentials(config)? {
            Some(_) => "configured",
            None => "missing",
        }
    );

    match persistence::read_daemon_state(config)? {
        Some(state) if process_alive(state.pid) => print_daemon_state(&state, true),
        Some(state) => print_daemon_state(&state, false),
        None => println!("  daemon:      stopped"),
    }

    match resolve_host_agent(config) {
        Some(path) => println!("  host-agent:  {}", path.display()),
        None => println!("  host-agent:  not found (terminal requires a staged Rust host-agent)"),
    }
    match resolve_native_cli(config) {
        Some(path) => println!("  native-cli:  {}", path.display()),
        None => println!("  native-cli:  not found"),
    }
    Ok(())
}

pub fn daemon_status(config: &Config) -> Result<()> {
    match persistence::read_daemon_state(config)? {
        Some(state) if process_alive(state.pid) => {
            print_daemon_state(&state, true);
            Ok(())
        }
        Some(state) => {
            print_daemon_state(&state, false);
            Ok(())
        }
        None => {
            println!("Daemon is not running");
            Ok(())
        }
    }
}

pub fn daemon_is_running(config: &Config) -> Result<bool> {
    Ok(persistence::read_daemon_state(config)?
        .map(|state| state.http_port != 0 && process_alive(state.pid))
        .unwrap_or(false))
}

pub fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    if cfg!(windows) {
        let filter = format!("PID eq {pid}");
        return Command::new("tasklist")
            .args(["/FI", &filter, "/NH"])
            .output()
            .map(|output| {
                let pid = pid.to_string();
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .any(|line| line.split_whitespace().any(|field| field == pid))
            })
            .unwrap_or(false);
    }

    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn resolve_host_agent(config: &Config) -> Option<std::path::PathBuf> {
    if let Some(path) = config.host_agent_override() {
        return path.exists().then_some(path);
    }

    let executable = if cfg!(windows) {
        "happy-host-agent.exe"
    } else {
        "happy-host-agent"
    };
    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let package_root = config
        .package_root()
        .unwrap_or_else(|| std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    let candidates = [
        config
            .home_dir
            .join("tools")
            .join("host-agent")
            .join(&platform)
            .join(executable),
        package_root
            .join("tools")
            .join("host-agent")
            .join(&platform)
            .join(executable),
        Path::new("packages/happy-cli/tools/host-agent")
            .join(&platform)
            .join(executable),
        package_root
            .join("..")
            .join("happy-host-agent")
            .join("target/release")
            .join(executable),
        Path::new("packages/happy-host-agent/target/release").join(executable),
    ];
    candidates.into_iter().find(|path| path.exists())
}

pub fn resolve_native_cli(config: &Config) -> Option<std::path::PathBuf> {
    if let Some(path) = config.native_cli_override() {
        return path.exists().then_some(path);
    }
    let executable = if cfg!(windows) { "happy.exe" } else { "happy" };
    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let package_root = config
        .package_root()
        .unwrap_or_else(|| std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    let candidates = [
        config
            .home_dir
            .join("tools")
            .join("cli")
            .join(&platform)
            .join(executable),
        package_root
            .join("tools")
            .join("cli")
            .join(&platform)
            .join(executable),
        Path::new("packages/happy-cli/tools/cli")
            .join(&platform)
            .join(executable),
        std::env::current_exe().ok()?,
    ];
    candidates.into_iter().find(|path| path.exists())
}

fn print_daemon_state(state: &DaemonState, alive: bool) {
    println!("  daemon:      {}", if alive { "running" } else { "stale" });
    println!("  pid:         {}", state.pid);
    println!("  control:     127.0.0.1:{}", state.http_port);
    println!("  started:     {}", state.start_time);
    if let Some(path) = &state.daemon_log_path {
        println!("  log:         {path}");
    }
}
