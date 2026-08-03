use crate::config::Config;
use crate::crypto;
use crate::persistence::Credentials;
use anyhow::{Context, Result, bail};
use reqwest::Client;
use serde_json::{Value, json};

#[derive(Debug, Clone)]
pub struct Session {
    pub id: String,
    pub seq: u64,
    pub encryption_key: [u8; 32],
    pub metadata: Value,
    pub metadata_version: u64,
    pub agent_state: Option<Value>,
    pub agent_state_version: u64,
}

#[derive(Debug, Clone)]
pub struct Machine {
    pub id: String,
    pub encryption_key: [u8; 32],
    pub metadata: Value,
    pub metadata_version: u64,
    pub daemon_state: Option<Value>,
    pub daemon_state_version: u64,
}

#[derive(Clone)]
pub struct ApiClient {
    config: Config,
    credentials: Credentials,
    http: Client,
}

impl ApiClient {
    pub fn new(config: Config, credentials: Credentials) -> Result<Self> {
        let http = Client::builder()
            .user_agent(format!("happy-cli/{}", config.cli_version))
            .build()
            .context("failed to construct HTTP client")?;
        Ok(Self {
            config,
            credentials,
            http,
        })
    }

    pub fn credentials(&self) -> &Credentials {
        &self.credentials
    }

    pub async fn get_or_create_session(
        &self,
        tag: &str,
        metadata: &Value,
        agent_state: Option<&Value>,
    ) -> Result<Session> {
        let encryption_key = crypto::random_bytes::<32>();
        let data_encryption_key =
            encrypted_data_key(&encryption_key, &self.credentials.public_key)?;
        let agent_state_wire = match agent_state {
            Some(value) => Some(crypto::encode_base64(&crypto::encrypt_json(
                value,
                &encryption_key,
            )?)),
            None => None,
        };
        let body = json!({
            "tag": tag,
            "metadata": crypto::encode_base64(&crypto::encrypt_json(metadata, &encryption_key)?),
            "agentState": agent_state_wire,
            "dataEncryptionKey": crypto::encode_base64(&data_encryption_key),
        });

        let raw = self
            .request(reqwest::Method::POST, "/v1/sessions")
            .json(&body)
            .send()
            .await
            .context("failed to create session")?
            .error_for_status()
            .context("server rejected session creation")?
            .json::<Value>()
            .await
            .context("invalid session response")?;

        let session = raw
            .get("session")
            .context("session response has no session")?;
        Ok(Session {
            id: required_string(session, "id")?,
            seq: required_u64(session, "seq")?,
            encryption_key,
            metadata: decrypt_field(session, "metadata", &encryption_key)?,
            metadata_version: required_u64(session, "metadataVersion")?,
            agent_state: optional_encrypted_field(session, "agentState", &encryption_key)?,
            agent_state_version: required_u64(session, "agentStateVersion")?,
        })
    }

    pub async fn get_or_create_machine(
        &self,
        machine_id: &str,
        metadata: &Value,
        daemon_state: Option<&Value>,
    ) -> Result<Machine> {
        let encryption_key = self.credentials.machine_key;
        let data_encryption_key =
            encrypted_data_key(&encryption_key, &self.credentials.public_key)?;
        let daemon_state_wire = match daemon_state {
            Some(value) => Some(crypto::encode_base64(&crypto::encrypt_json(
                value,
                &encryption_key,
            )?)),
            None => None,
        };
        let mut body = json!({
            "id": machine_id,
            "metadata": crypto::encode_base64(&crypto::encrypt_json(metadata, &encryption_key)?),
            "dataEncryptionKey": crypto::encode_base64(&data_encryption_key),
        });
        // The server schema treats daemonState as optional, but does not
        // accept an explicit JSON null. Omit it when no daemon state exists.
        if let Some(daemon_state) = daemon_state_wire {
            body.as_object_mut()
                .expect("machine request body is an object")
                .insert("daemonState".to_owned(), Value::String(daemon_state));
        }

        let raw = self
            .request(reqwest::Method::POST, "/v1/machines")
            .json(&body)
            .send()
            .await
            .context("failed to register machine")?
            .error_for_status()
            .context("server rejected machine registration")?
            .json::<Value>()
            .await
            .context("invalid machine response")?;

        let machine = raw
            .get("machine")
            .context("machine response has no machine")?;
        Ok(Machine {
            id: required_string(machine, "id")?,
            encryption_key,
            metadata: decrypt_field(machine, "metadata", &encryption_key)?,
            metadata_version: machine
                .get("metadataVersion")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            daemon_state: optional_encrypted_field(machine, "daemonState", &encryption_key)?,
            daemon_state_version: machine
                .get("daemonStateVersion")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        })
    }

    pub async fn register_vendor_token(&self, vendor: &str, token: &Value) -> Result<()> {
        let body = json!({ "token": serde_json::to_string(token)? });
        self.request(
            reqwest::Method::POST,
            &format!("/v1/connect/{vendor}/register"),
        )
        .json(&body)
        .send()
        .await
        .context("failed to register vendor token")?
        .error_for_status()
        .context("server rejected vendor token")?;
        Ok(())
    }

    pub async fn get_vendor_token(&self, vendor: &str) -> Result<Option<Value>> {
        let response = self
            .request(reqwest::Method::GET, &format!("/v1/connect/{vendor}/token"))
            .send()
            .await
            .context("failed to retrieve vendor token")?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let value = response.error_for_status()?.json::<Value>().await?;
        let token = value.get("token").cloned().unwrap_or(value);
        if token.is_null() {
            return Ok(None);
        }
        if let Some(string) = token.as_str() {
            return Ok(Some(
                serde_json::from_str(string).unwrap_or_else(|_| Value::String(string.to_owned())),
            ));
        }
        Ok(Some(token))
    }

    pub async fn deactivate_session(&self, session_id: &str) -> bool {
        self.request(
            reqwest::Method::POST,
            &format!("/v1/sessions/{session_id}/archive"),
        )
        .json(&json!({}))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
    }

    pub async fn send_push_notification(&self, title: &str, message: &str) -> Result<()> {
        let tokens = self
            .request(reqwest::Method::GET, "/v1/push-tokens")
            .send()
            .await
            .context("failed to retrieve push tokens")?
            .error_for_status()?
            .json::<Value>()
            .await?;
        let tokens = tokens
            .get("tokens")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let messages: Vec<Value> = tokens
            .into_iter()
            .filter_map(|token| {
                token.get("token").and_then(Value::as_str).map(|token| {
                    json!({
                        "to": token,
                        "title": title,
                        "body": message,
                        "data": { "source": "cli" },
                        "sound": "default",
                        "priority": "high",
                    })
                })
            })
            .collect();
        if messages.is_empty() {
            return Ok(());
        }
        self.http
            .post("https://exp.host/--/api/v2/push/send")
            .json(&messages)
            .send()
            .await
            .context("failed to send Expo push notification")?
            .error_for_status()
            .context("Expo rejected push notification")?;
        Ok(())
    }

    pub async fn send_session_notification(
        &self,
        session_id: &str,
        kind: &str,
        title: &str,
        body: &str,
        data: &Value,
    ) -> Result<()> {
        self.request(
            reqwest::Method::POST,
            &format!("/v1/sessions/{session_id}/push-event"),
        )
        .json(&json!({
            "kind": kind,
            "title": title,
            "body": body,
            "data": data,
        }))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .context("failed to send session notification")?
        .error_for_status()
        .context("server rejected session notification")?;
        Ok(())
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(
                method,
                format!("{}{}", self.config.server_url.trim_end_matches('/'), path),
            )
            .bearer_auth(&self.credentials.token)
            .header(
                "X-Happy-Client",
                format!("cli-coding-session/{}", self.config.cli_version),
            )
            .header("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(60))
    }
}

fn encrypted_data_key(data_key: &[u8; 32], recipient_public_key: &[u8; 32]) -> Result<Vec<u8>> {
    let encrypted = crypto::encrypt_for_public_key(data_key, recipient_public_key)?;
    let mut result = Vec::with_capacity(1 + encrypted.len());
    result.push(0);
    result.extend_from_slice(&encrypted);
    Ok(result)
}

fn required_string(value: &Value, key: &str) -> Result<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .with_context(|| format!("response field {key} is missing"))
}

fn required_u64(value: &Value, key: &str) -> Result<u64> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .with_context(|| format!("response field {key} is missing"))
}

fn decrypt_field(value: &Value, key: &str, encryption_key: &[u8; 32]) -> Result<Value> {
    let encoded = value
        .get(key)
        .and_then(Value::as_str)
        .with_context(|| format!("response field {key} is missing"))?;
    let bundle = crypto::decode_base64(encoded)?;
    crypto::decrypt_json(&bundle, encryption_key)
}

fn optional_encrypted_field(
    value: &Value,
    key: &str,
    encryption_key: &[u8; 32],
) -> Result<Option<Value>> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(encoded)) => {
            let bundle = crypto::decode_base64(encoded)?;
            Ok(Some(crypto::decrypt_json(&bundle, encryption_key)?))
        }
        Some(_) => bail!("response field {key} is not an encrypted string"),
    }
}
