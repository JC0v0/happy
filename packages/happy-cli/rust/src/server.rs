use crate::cli::ServerArgs;
use crate::config::Config;
use crate::crypto;
use crate::persistence;
use anyhow::{Context, Result, bail};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use tokio::process::{Child, Command};

struct ServerArtifact {
    command: PathBuf,
    prefix_args: Vec<String>,
    cwd: PathBuf,
    source_mode: bool,
}

pub async fn run(config: &Config, args: ServerArgs) -> Result<()> {
    let server_url = format!(
        "http://{}:{}",
        if args.host == "0.0.0.0" {
            "127.0.0.1"
        } else {
            &args.host
        },
        args.port
    );
    let data_dir = config.home_dir.join("server-data");
    let pglite_dir = data_dir.join("pglite");
    let secret_file = data_dir.join("master-secret");
    if args.reset && data_dir.exists() {
        fs::remove_dir_all(&data_dir)
            .with_context(|| format!("failed to reset {}", data_dir.display()))?;
    }
    fs::create_dir_all(&data_dir)?;
    let master_secret = match &args.master_secret {
        Some(secret) => secret.clone(),
        None if secret_file.exists() => fs::read_to_string(&secret_file)?.trim().to_owned(),
        None => {
            let secret = crypto::encode_base64(&crypto::random_bytes::<32>());
            write_secret(&secret_file, &secret)?;
            secret
        }
    };
    if master_secret.is_empty() {
        bail!("server master secret cannot be empty");
    }

    let artifact = resolve_artifact(config)?;
    println!("happy server");
    println!("  data dir:   {}", data_dir.display());
    println!("  server url: {server_url}");
    println!(
        "  mode:       {}",
        if artifact.source_mode {
            "source (dev)"
        } else {
            "native standalone"
        }
    );

    let env = server_environment(
        config,
        &data_dir,
        &pglite_dir,
        &master_secret,
        &server_url,
        &args,
    );
    run_child(&artifact, &env, "migrate").await?;
    if !args.no_persist {
        persistence::update_settings(config, |settings| {
            settings.server_url = Some(server_url.clone());
            settings.webapp_url = Some(server_url.clone());
        })?;
    }

    println!("Starting server...");
    let mut child = spawn_child(&artifact, &env, "serve")?;
    let exit_code = wait_for_server(&mut child).await?;
    if exit_code != 0 {
        bail!("happy-server exited with code {exit_code}");
    }
    Ok(())
}

fn resolve_artifact(config: &Config) -> Result<ServerArtifact> {
    let executable = if cfg!(windows) {
        "happy-server.exe"
    } else {
        "happy-server"
    };
    if let Some(path) = std::env::var_os("HAPPY_SERVER_BIN")
        .map(PathBuf::from)
        .map(absolute_path)
        .transpose()?
        && path.exists()
    {
        return Ok(ServerArtifact {
            cwd: path.parent().unwrap_or(Path::new(".")).to_owned(),
            command: path,
            prefix_args: Vec::new(),
            source_mode: false,
        });
    }
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    };
    let platform_dir = format!("{platform}-{arch}");
    let bundle_dir = format!("{arch}-{platform}");
    let package_root = config
        .package_root()
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    let repo_root = package_root.parent().unwrap_or(Path::new(".")).to_owned();
    let candidates = [
        config
            .home_dir
            .join("tools")
            .join("server")
            .join(&bundle_dir)
            .join(executable),
        package_root
            .join("tools")
            .join("server")
            .join(&bundle_dir)
            .join(executable),
        config
            .home_dir
            .join("tools")
            .join("server")
            .join(&platform_dir)
            .join(executable),
        package_root
            .join("tools")
            .join("server")
            .join(&platform_dir)
            .join(executable),
        PathBuf::from("packages/happy-cli/tools/server")
            .join(platform)
            .join(executable),
        repo_root.join("happy-server").join("dist").join(executable),
        PathBuf::from("packages/happy-server/dist").join(executable),
    ];
    if let Some(path) = candidates
        .into_iter()
        .map(absolute_path)
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .find(|path| path.exists())
    {
        return Ok(ServerArtifact {
            cwd: path.parent().unwrap_or(Path::new(".")).to_owned(),
            command: path,
            prefix_args: Vec::new(),
            source_mode: false,
        });
    }

    let runtime_candidates = [
        absolute_path(PathBuf::from("packages/happy-server/dist/standalone.mjs"))?,
        repo_root.join("happy-server").join("dist/standalone.mjs"),
    ];
    if let Some(runtime) = runtime_candidates.into_iter().find(|path| path.exists()) {
        return Ok(ServerArtifact {
            command: node_command(),
            prefix_args: vec![runtime.to_string_lossy().into_owned()],
            cwd: runtime.parent().unwrap_or(Path::new(".")).to_owned(),
            source_mode: true,
        });
    }

    // Keep the monorepo/self-host package workflow usable: installing
    // `happy-server-self-host` exposes a `happy-server` launcher on PATH.
    // Release packages prefer the native artifact candidates above.
    if let Some(command) = executable_on_path("happy-server") {
        return Ok(ServerArtifact {
            cwd: std::env::current_dir()?,
            command,
            prefix_args: Vec::new(),
            source_mode: true,
        });
    }

    let source_candidates = [
        absolute_path(PathBuf::from("packages/happy-server/sources/standalone.ts"))?,
        repo_root.join("happy-server").join("sources/standalone.ts"),
    ];
    if let Some(source) = source_candidates.into_iter().find(|path| path.exists()) {
        let pnpm = if cfg!(windows) { "pnpm.cmd" } else { "pnpm" };
        return Ok(ServerArtifact {
            command: PathBuf::from(pnpm),
            prefix_args: vec![
                "exec".to_owned(),
                "tsx".to_owned(),
                source.to_string_lossy().into_owned(),
            ],
            cwd: source
                .parent()
                .and_then(Path::parent)
                .unwrap_or(Path::new("."))
                .to_owned(),
            source_mode: true,
        });
    }
    bail!(
        "could not locate happy-server; set HAPPY_SERVER_BIN or build packages/happy-server standalone"
    )
}

fn node_command() -> PathBuf {
    std::env::var_os("HAPPY_NODE_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" }))
}

fn executable_on_path(name: &str) -> Option<PathBuf> {
    let locator = if cfg!(windows) { "where.exe" } else { "which" };
    let output = StdCommand::new(locator).arg(name).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(PathBuf::from)
}

fn absolute_path(path: PathBuf) -> Result<PathBuf> {
    if path.is_absolute() {
        return Ok(path);
    }
    Ok(std::env::current_dir()?.join(path))
}

fn server_environment(
    config: &Config,
    data_dir: &Path,
    pglite_dir: &Path,
    master_secret: &str,
    server_url: &str,
    args: &ServerArgs,
) -> std::collections::HashMap<String, String> {
    let mut env = std::env::vars().collect::<std::collections::HashMap<_, _>>();
    env.insert("DB_PROVIDER".to_owned(), "pglite".to_owned());
    env.insert(
        "DATA_DIR".to_owned(),
        data_dir.to_string_lossy().into_owned(),
    );
    env.insert(
        "PGLITE_DIR".to_owned(),
        pglite_dir.to_string_lossy().into_owned(),
    );
    env.insert("HANDY_MASTER_SECRET".to_owned(), master_secret.to_owned());
    env.insert("PORT".to_owned(), args.port.to_string());
    env.insert("HOST".to_owned(), args.host.clone());
    env.insert(
        "HAPPY_INJECT_HTML_CONFIG".to_owned(),
        serde_json::json!({
            "serverUrl": server_url,
            "disableAnalytics": true,
        })
        .to_string(),
    );
    if let Some(static_dir) = find_static_dir(config) {
        env.insert(
            "HAPPY_STATIC_DIR".to_owned(),
            static_dir.to_string_lossy().into_owned(),
        );
    }
    env
}

fn find_static_dir(config: &Config) -> Option<PathBuf> {
    let package_root = config
        .package_root()
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    let repo_root = package_root.parent().unwrap_or(Path::new(".")).to_owned();
    [
        config.home_dir.join("tools").join("webapp"),
        package_root.join("tools/webapp"),
        repo_root.join("happy-app/dist"),
        PathBuf::from("packages/happy-app/dist"),
        PathBuf::from("packages/happy-cli/tools/webapp"),
    ]
    .into_iter()
    .filter_map(|path| absolute_path(path).ok())
    .find(|path| path.join("index.html").exists())
}

async fn run_child(
    artifact: &ServerArtifact,
    env: &std::collections::HashMap<String, String>,
    command: &str,
) -> Result<()> {
    let mut child = spawn_child(artifact, env, command)?;
    let status = child
        .wait()
        .await
        .context("failed waiting for happy-server")?;
    if !status.success() {
        bail!("happy-server {command} failed with status {status}");
    }
    Ok(())
}

fn spawn_child(
    artifact: &ServerArtifact,
    env: &std::collections::HashMap<String, String>,
    command: &str,
) -> Result<Child> {
    let mut child = Command::new(&artifact.command);
    child
        .args(&artifact.prefix_args)
        .arg(command)
        .current_dir(&artifact.cwd)
        .envs(env)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .kill_on_drop(false);
    child
        .spawn()
        .with_context(|| format!("failed to start {} {}", artifact.command.display(), command))
}

async fn wait_for_server(child: &mut Child) -> Result<i32> {
    tokio::select! {
        status = child.wait() => {
            Ok(status.context("failed waiting for happy-server")?.code().unwrap_or(1))
        }
        signal = tokio::signal::ctrl_c() => {
            signal.context("failed to install Ctrl-C handler")?;
            let _ = child.kill().await;
            Ok(child.wait().await?.code().unwrap_or(130))
        }
    }
}

fn write_secret(path: &Path, secret: &str) -> Result<()> {
    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    let mut file = options.open(path)?;
    file.write_all(secret.as_bytes())?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    Ok(())
}
