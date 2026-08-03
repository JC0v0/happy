use crate::config::Config;
use anyhow::{Context, Result, bail};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const STATE_SCHEMA_VERSION: u32 = 1;
const RUNTIME_MARKER: &str = "happy-rust-cli";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub schema_version: u32,
    pub runtime: String,
    pub onboarding_completed: bool,
    pub machine_id: Option<String>,
    pub server_url: Option<String>,
    pub webapp_url: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: STATE_SCHEMA_VERSION,
            runtime: RUNTIME_MARKER.to_owned(),
            onboarding_completed: false,
            machine_id: None,
            server_url: None,
            webapp_url: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Credentials {
    pub token: String,
    pub public_key: [u8; 32],
    pub machine_key: [u8; 32],
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialsFile {
    schema_version: u32,
    runtime: String,
    token: String,
    encryption: EncryptionFile,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptionFile {
    public_key: String,
    machine_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonState {
    pub schema_version: u32,
    pub runtime: String,
    pub pid: u32,
    pub http_port: u16,
    pub start_time: String,
    pub cli_version: String,
    pub daemon_log_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSession {
    pub schema_version: u32,
    pub runtime: String,
    pub session_id: String,
    pub encryption_key: String,
    pub seq: u64,
    pub metadata: Value,
    pub metadata_version: u64,
    pub agent_state: Option<Value>,
    pub agent_state_version: u64,
    pub updated_at: String,
}

pub fn read_settings(config: &Config) -> Result<Settings> {
    if !config.settings_file.exists() {
        return Ok(Settings::default());
    }

    let raw = fs::read_to_string(&config.settings_file)
        .with_context(|| format!("failed to read {}", config.settings_file.display()))?;
    let settings: Settings = serde_json::from_str(&raw).with_context(|| {
        format!(
            "settings file is not a Rust CLI state file: {}",
            config.settings_file.display()
        )
    })?;
    validate_state(settings.schema_version, &settings.runtime, "settings")?;
    Ok(settings)
}

pub fn write_settings(config: &Config, settings: &Settings) -> Result<()> {
    validate_state(settings.schema_version, &settings.runtime, "settings")?;
    write_json_atomic(&config.settings_file, settings)
}

pub fn update_settings<F>(config: &Config, update: F) -> Result<Settings>
where
    F: FnOnce(&mut Settings),
{
    let lock_path = config.settings_file.with_extension("json.lock");
    let _lock = ExclusiveFile::create(&lock_path)
        .with_context(|| format!("failed to lock {}", lock_path.display()))?;
    let mut settings = read_settings(config)?;
    update(&mut settings);
    write_settings(config, &settings)?;
    Ok(settings)
}

pub fn read_credentials(config: &Config) -> Result<Option<Credentials>> {
    if !config.credentials_file.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&config.credentials_file)
        .with_context(|| format!("failed to read {}", config.credentials_file.display()))?;
    let value: Value = serde_json::from_str(&raw).with_context(|| {
        format!(
            "credentials file is not valid JSON: {}",
            config.credentials_file.display()
        )
    })?;
    if value.get("schemaVersion").is_none() || value.get("runtime").is_none() {
        return Err(legacy_state_error("credentials", &config.credentials_file));
    }
    let file: CredentialsFile = serde_json::from_value(value).with_context(|| {
        format!(
            "credentials file is not a Rust CLI state file: {}",
            config.credentials_file.display()
        )
    })?;
    validate_state(file.schema_version, &file.runtime, "credentials")?;

    let public_key = decode_fixed::<32>(&file.encryption.public_key, "publicKey")?;
    let machine_key = decode_fixed::<32>(&file.encryption.machine_key, "machineKey")?;
    Ok(Some(Credentials {
        token: file.token,
        public_key,
        machine_key,
    }))
}

pub fn write_credentials(config: &Config, credentials: &Credentials) -> Result<()> {
    let file = CredentialsFile {
        schema_version: STATE_SCHEMA_VERSION,
        runtime: RUNTIME_MARKER.to_owned(),
        token: credentials.token.clone(),
        encryption: EncryptionFile {
            public_key: base64::engine::general_purpose::STANDARD.encode(credentials.public_key),
            machine_key: base64::engine::general_purpose::STANDARD.encode(credentials.machine_key),
        },
    };
    write_json_atomic(&config.credentials_file, &file)
}

pub fn clear_credentials(config: &Config) -> Result<()> {
    if config.credentials_file.exists() {
        fs::remove_file(&config.credentials_file)
            .with_context(|| format!("failed to remove {}", config.credentials_file.display()))?;
    }
    Ok(())
}

pub fn read_daemon_state(config: &Config) -> Result<Option<DaemonState>> {
    if !config.daemon_state_file.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&config.daemon_state_file)
        .with_context(|| format!("failed to read {}", config.daemon_state_file.display()))?;
    let state: DaemonState = serde_json::from_str(&raw).with_context(|| {
        format!(
            "daemon state is invalid: {}",
            config.daemon_state_file.display()
        )
    })?;
    validate_state(state.schema_version, &state.runtime, "daemon state")?;
    Ok(Some(state))
}

pub fn write_daemon_state(config: &Config, state: &DaemonState) -> Result<()> {
    validate_state(state.schema_version, &state.runtime, "daemon state")?;
    write_json_atomic(&config.daemon_state_file, state)
}

pub fn clear_daemon_state(config: &Config) -> Result<()> {
    for path in [&config.daemon_state_file, &config.daemon_lock_file] {
        if path.exists() {
            fs::remove_file(path)
                .with_context(|| format!("failed to remove {}", path.display()))?;
        }
    }
    Ok(())
}

pub fn read_sessions(config: &Config) -> Result<BTreeMap<String, PersistedSession>> {
    if !config.sessions_file.exists() {
        return Ok(BTreeMap::new());
    }
    let raw = fs::read_to_string(&config.sessions_file)
        .with_context(|| format!("failed to read {}", config.sessions_file.display()))?;
    let sessions: BTreeMap<String, PersistedSession> =
        serde_json::from_str(&raw).with_context(|| {
            format!(
                "sessions file is invalid: {}",
                config.sessions_file.display()
            )
        })?;
    for session in sessions.values() {
        validate_state(session.schema_version, &session.runtime, "session")?;
    }
    Ok(sessions)
}

pub fn write_session(config: &Config, session: &PersistedSession) -> Result<()> {
    validate_state(session.schema_version, &session.runtime, "session")?;
    let lock_path = config.sessions_file.with_extension("json.lock");
    let _lock = ExclusiveFile::create(&lock_path)
        .with_context(|| format!("failed to lock {}", lock_path.display()))?;
    let mut sessions = read_sessions(config)?;
    sessions.insert(session.session_id.clone(), session.clone());
    write_json_atomic(&config.sessions_file, &sessions)
}

pub fn remove_session(config: &Config, session_id: &str) -> Result<()> {
    if !config.sessions_file.exists() {
        return Ok(());
    }
    let lock_path = config.sessions_file.with_extension("json.lock");
    let _lock = ExclusiveFile::create(&lock_path)
        .with_context(|| format!("failed to lock {}", lock_path.display()))?;
    let mut sessions = read_sessions(config)?;
    sessions.remove(session_id);
    write_json_atomic(&config.sessions_file, &sessions)
}

pub fn clear_sessions(config: &Config) -> Result<()> {
    if config.sessions_file.exists() {
        fs::remove_file(&config.sessions_file)
            .with_context(|| format!("failed to remove {}", config.sessions_file.display()))?;
    }
    Ok(())
}

pub fn acquire_daemon_lock(config: &Config) -> Result<ExclusiveFile> {
    ExclusiveFile::create(&config.daemon_lock_file).with_context(|| {
        format!(
            "daemon is already running or lock is held: {}",
            config.daemon_lock_file.display()
        )
    })
}

pub fn now_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    seconds.to_string()
}

pub struct ExclusiveFile {
    path: PathBuf,
    file: File,
}

impl ExclusiveFile {
    fn create(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
        file.write_all(std::process::id().to_string().as_bytes())?;
        file.sync_all()?;
        Ok(Self {
            path: path.to_owned(),
            file,
        })
    }
}

impl Drop for ExclusiveFile {
    fn drop(&mut self) {
        let _ = self.file.sync_all();
        let _ = fs::remove_file(&self.path);
    }
}

fn validate_state(version: u32, runtime: &str, label: &str) -> Result<()> {
    if version != STATE_SCHEMA_VERSION || runtime != RUNTIME_MARKER {
        bail!(
            "{label} uses an incompatible state format; remove the Rust CLI state under HAPPY_HOME_DIR and authenticate again"
        );
    }
    Ok(())
}

fn legacy_state_error(label: &str, path: &Path) -> anyhow::Error {
    anyhow::anyhow!(
        "{label} file is from the legacy TypeScript CLI and is not migrated: {}. Set HAPPY_HOME_DIR to a new directory or run `happy auth logout`, then run `happy auth login`.",
        path.display()
    )
}

fn decode_fixed<const N: usize>(value: &str, field: &str) -> Result<[u8; N]> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value)
        .with_context(|| format!("{field} is not valid base64"))?;
    bytes.try_into().map_err(|bytes: Vec<u8>| {
        anyhow::anyhow!(
            "{field} must contain exactly {N} bytes, got {}",
            bytes.len()
        )
    })
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!("tmp.{}", std::process::id()));
    let bytes = serde_json::to_vec_pretty(value)?;
    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);

    if cfg!(windows) && path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(&temp, path).with_context(|| format!("failed to replace {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    fn test_config(root: &Path) -> Config {
        Config {
            home_dir: root.to_owned(),
            settings_file: root.join("settings.json"),
            credentials_file: root.join("access.key"),
            daemon_state_file: root.join("daemon.state.json"),
            daemon_lock_file: root.join("daemon.state.json.lock"),
            sessions_file: root.join("sessions.json"),
            logs_dir: root.join("logs"),
            server_url: "https://example.invalid".to_owned(),
            webapp_url: "https://example.invalid".to_owned(),
            cli_version: "test".to_owned(),
        }
    }

    #[test]
    fn state_round_trips_and_rejects_other_schema() {
        let root = std::env::temp_dir().join(format!("happy-persistence-{}", uuid::Uuid::new_v4()));
        let config = test_config(&root);
        let settings = Settings {
            server_url: Some("https://server.example".to_owned()),
            ..Settings::default()
        };
        write_settings(&config, &settings).unwrap();
        assert_eq!(
            read_settings(&config).unwrap().server_url,
            settings.server_url
        );

        let credentials = Credentials {
            token: "token".to_owned(),
            public_key: [1_u8; 32],
            machine_key: [2_u8; 32],
        };
        write_credentials(&config, &credentials).unwrap();
        let loaded = read_credentials(&config).unwrap().unwrap();
        assert_eq!(loaded.token, credentials.token);
        assert_eq!(loaded.public_key, credentials.public_key);
        assert_eq!(loaded.machine_key, credentials.machine_key);

        fs::write(
            &config.settings_file,
            serde_json::json!({
                "schemaVersion": 999,
                "runtime": RUNTIME_MARKER
            })
            .to_string(),
        )
        .unwrap();
        assert!(read_settings(&config).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn daemon_lock_is_exclusive_and_released() {
        let root = std::env::temp_dir().join(format!("happy-lock-{}", uuid::Uuid::new_v4()));
        let config = test_config(&root);
        let lock = acquire_daemon_lock(&config).unwrap();
        assert!(acquire_daemon_lock(&config).is_err());
        drop(lock);
        assert!(acquire_daemon_lock(&config).is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_credentials_explain_the_new_state_directory() {
        let root = std::env::temp_dir().join(format!("happy-legacy-{}", uuid::Uuid::new_v4()));
        let config = test_config(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            &config.credentials_file,
            serde_json::json!({
                "token": "legacy-token",
                "encryption": {}
            })
            .to_string(),
        )
        .unwrap();

        let error = read_credentials(&config).unwrap_err().to_string();
        assert!(error.contains("legacy TypeScript CLI"));
        assert!(error.contains("HAPPY_HOME_DIR"));
        let _ = fs::remove_dir_all(root);
    }
}
