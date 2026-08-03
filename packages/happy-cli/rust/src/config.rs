use anyhow::{Context, Result, bail};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_SERVER_URL: &str = "https://api.cluster-fluster.com";
pub const DEFAULT_WEBAPP_URL: &str = "https://app.happy.engineering";

#[derive(Debug, Clone)]
pub struct Config {
    pub home_dir: PathBuf,
    pub settings_file: PathBuf,
    pub credentials_file: PathBuf,
    pub daemon_state_file: PathBuf,
    pub daemon_lock_file: PathBuf,
    pub sessions_file: PathBuf,
    pub logs_dir: PathBuf,
    pub server_url: String,
    pub webapp_url: String,
    pub cli_version: String,
}

impl Config {
    pub fn load() -> Result<Self> {
        let home_dir = resolve_home_dir()?;
        let settings_file = home_dir.join("settings.json");
        let server_url = env::var("HAPPY_SERVER_URL")
            .ok()
            .filter(|value| !value.is_empty())
            .or_else(|| read_setting_string(&settings_file, "serverUrl"))
            .unwrap_or_else(|| DEFAULT_SERVER_URL.to_owned());
        let webapp_url = env::var("HAPPY_WEBAPP_URL")
            .ok()
            .filter(|value| !value.is_empty())
            .or_else(|| read_setting_string(&settings_file, "webappUrl"))
            .unwrap_or_else(|| DEFAULT_WEBAPP_URL.to_owned());

        fs::create_dir_all(&home_dir)
            .with_context(|| format!("failed to create Happy home {}", home_dir.display()))?;
        let logs_dir = home_dir.join("logs");
        fs::create_dir_all(&logs_dir)
            .with_context(|| format!("failed to create Happy logs {}", logs_dir.display()))?;

        Ok(Self {
            credentials_file: home_dir.join("access.key"),
            daemon_state_file: home_dir.join("daemon.state.json"),
            daemon_lock_file: home_dir.join("daemon.state.json.lock"),
            sessions_file: home_dir.join("sessions.json"),
            cli_version: env!("CARGO_PKG_VERSION").to_owned(),
            home_dir,
            settings_file,
            logs_dir,
            server_url,
            webapp_url,
        })
    }

    pub fn host_agent_override(&self) -> Option<PathBuf> {
        env::var_os("HAPPY_HOST_AGENT_BIN").map(PathBuf::from)
    }

    pub fn native_cli_override(&self) -> Option<PathBuf> {
        env::var_os("HAPPY_CLI_BIN").map(PathBuf::from)
    }

    /// Locate the installed package root for bundled tools. This must be
    /// derived from the running executable rather than from
    /// `CARGO_MANIFEST_DIR`, because release binaries can run from an npm
    /// installation or a standalone archive.
    pub fn package_root(&self) -> Option<PathBuf> {
        if let Some(path) = env::var_os("HAPPY_CLI_PACKAGE_ROOT") {
            let path = PathBuf::from(path);
            if path.is_dir() {
                return Some(path);
            }
        }

        let executable = std::env::current_exe().ok()?;
        executable.ancestors().find_map(|candidate| {
            let package_json = candidate.join("package.json");
            let launcher = candidate.join("bin").join("happy.mjs");
            let tools = candidate.join("tools");
            (package_json.is_file() && (launcher.is_file() || tools.is_dir()))
                .then(|| candidate.to_owned())
        })
    }

    pub fn is_debug(&self) -> bool {
        env::var("DEBUG")
            .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false)
    }
}

fn resolve_home_dir() -> Result<PathBuf> {
    if let Some(path) = env::var_os("HAPPY_HOME_DIR") {
        let path = PathBuf::from(path);
        if path.as_os_str().is_empty() {
            bail!("HAPPY_HOME_DIR cannot be empty");
        }
        return Ok(path);
    }

    let home = if cfg!(windows) {
        env::var_os("USERPROFILE").or_else(|| {
            let drive = env::var_os("HOMEDRIVE")?;
            let path = env::var_os("HOMEPATH")?;
            Some(PathBuf::from(drive).join(path).into_os_string())
        })
    } else {
        env::var_os("HOME")
    };

    home.map(|path| PathBuf::from(path).join(".happy"))
        .context("could not determine home directory; set HAPPY_HOME_DIR")
}

fn read_setting_string(path: &Path, key: &str) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    if value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
        || value.get("runtime").and_then(serde_json::Value::as_str) != Some("happy-rust-cli")
    {
        return None;
    }
    value
        .get(key)?
        .as_str()
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}
