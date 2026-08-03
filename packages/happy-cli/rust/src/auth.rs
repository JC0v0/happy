use crate::config::Config;
use crate::crypto;
use crate::persistence::{self, Credentials};
use anyhow::{Context, Result, bail};
use qrcode::QrCode;
use qrcode::render::unicode;
use reqwest::Client;
use serde_json::{Value, json};
use std::io::{self, IsTerminal, Write};
use std::time::Duration;

pub async fn ensure_credentials(config: &Config) -> Result<Credentials> {
    if let Some(credentials) = persistence::read_credentials(config)? {
        return Ok(credentials);
    }
    authenticate(config).await
}

pub fn ensure_machine_id(config: &Config) -> Result<String> {
    let settings = persistence::read_settings(config)?;
    if let Some(machine_id) = settings.machine_id {
        return Ok(machine_id);
    }
    let machine_id = uuid::Uuid::new_v4().to_string();
    persistence::update_settings(config, |settings| {
        settings.machine_id = Some(machine_id.clone());
        settings.onboarding_completed = true;
    })?;
    Ok(machine_id)
}

pub async fn authenticate(config: &Config) -> Result<Credentials> {
    let secret = crypto::random_bytes::<32>();
    let public_key = crypto::box_public_key_from_secret(&secret);
    let public_key_base64 = crypto::encode_base64(&public_key);
    let client = Client::builder()
        .user_agent(format!("happy-cli/{}", config.cli_version))
        .build()
        .context("failed to construct authentication client")?;

    let request_url = format!(
        "{}/v1/auth/request",
        config.server_url.trim_end_matches('/')
    );
    let request = || async {
        client
            .post(&request_url)
            .header("X-Happy-Client", format!("cli/{}", config.cli_version))
            .json(&json!({ "publicKey": public_key_base64, "supportsV2": true }))
            .send()
            .await
            .context("failed to create authentication request")?
            .error_for_status()
            .context("server rejected authentication request")?
            .json::<Value>()
            .await
            .context("invalid authentication response")
    };

    let initial = request().await?;
    let method = choose_method();
    let web_url = format!(
        "{}/terminal/connect#key={}",
        config.webapp_url.trim_end_matches('/'),
        crypto::encode_base64_url(&public_key)
    );
    match method.as_deref() {
        Some("mobile") => print_mobile_auth(&public_key)?,
        _ => {
            println!("Opening browser for authentication...");
            if webbrowser::open(&web_url).is_err() {
                println!("Could not open the browser automatically.");
            }
            println!("Complete authentication here: {web_url}");
        }
    }

    if initial.get("state").and_then(Value::as_str) == Some("authorized") {
        return finish_authorization(&initial, &secret, config).await;
    }

    let mut dots = 0usize;
    loop {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(1)) => {}
            signal = tokio::signal::ctrl_c() => {
                signal.context("failed to install Ctrl-C handler")?;
                bail!("authentication cancelled");
            }
        }
        let response = request().await?;
        if response.get("state").and_then(Value::as_str) == Some("authorized") {
            println!();
            return finish_authorization(&response, &secret, config).await;
        }
        print!(
            "\rWaiting for authentication{}   ",
            ".".repeat(dots % 3 + 1)
        );
        io::stdout().flush().ok();
        dots += 1;
    }
}

fn choose_method() -> Option<String> {
    if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
        return Some("web".to_owned());
    }
    print!("Authenticate with mobile QR or web browser? [m/W] ");
    io::stdout().flush().ok();
    let mut input = String::new();
    io::stdin().read_line(&mut input).ok()?;
    if input.trim().eq_ignore_ascii_case("m") {
        Some("mobile".to_owned())
    } else {
        Some("web".to_owned())
    }
}

fn print_mobile_auth(public_key: &[u8; 32]) -> Result<()> {
    let url = format!("happy://terminal?{}", crypto::encode_base64_url(public_key));
    println!("Scan this QR code with the Happy mobile app:");
    let code = QrCode::new(url.as_bytes()).context("failed to generate authentication QR code")?;
    println!(
        "{}",
        code.render::<unicode::Dense1x2>().quiet_zone(false).build()
    );
    println!("Or open this URL manually: {url}");
    Ok(())
}

async fn finish_authorization(
    response: &Value,
    secret: &[u8; 32],
    config: &Config,
) -> Result<Credentials> {
    let token = response
        .get("token")
        .and_then(Value::as_str)
        .context("authorized response has no token")?;
    let encoded = response
        .get("response")
        .and_then(Value::as_str)
        .context("authorized response has no encrypted response")?;
    let encrypted = crypto::decode_base64(encoded)?;
    let decrypted = crypto::decrypt_with_secret_key(&encrypted, secret)?;
    if decrypted.len() < 33 || decrypted[0] != 0 {
        bail!(
            "server returned an unsupported authentication payload; reset the development server and retry"
        );
    }
    let public_key: [u8; 32] = decrypted[1..33].try_into().expect("payload length checked");
    let credentials = Credentials {
        token: token.to_owned(),
        public_key,
        machine_key: crypto::random_bytes::<32>(),
    };
    persistence::write_credentials(config, &credentials)?;
    println!("Authentication successful");
    Ok(credentials)
}
