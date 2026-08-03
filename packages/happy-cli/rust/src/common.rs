use crate::config::Config;
use crate::crypto;
use crate::rpc::RpcHandlerRegistry;
use anyhow::{Context, Result};
use futures_util::future::BoxFuture;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};
use tokio::process::Command;

/// Register the common file/shell/tool RPCs used by both session and machine
/// clients. A working directory is a security boundary for session clients;
/// None is intentionally unrestricted for the machine-scoped daemon.
pub async fn register(
    registry: &RpcHandlerRegistry,
    config: &Config,
    working_directory: Option<PathBuf>,
) -> Result<()> {
    let bash_root = working_directory.clone();
    registry
        .register("bash", move |params| {
            let root = bash_root.clone();
            async move { bash(params, root).await }
        })
        .await?;

    let read_root = working_directory.clone();
    registry
        .register("readFile", move |params| {
            let root = read_root.clone();
            async move { read_file(params, root).await }
        })
        .await?;

    let write_root = working_directory.clone();
    registry
        .register("writeFile", move |params| {
            let root = write_root.clone();
            async move { write_file(params, root).await }
        })
        .await?;

    let list_root = working_directory.clone();
    registry
        .register("listDirectory", move |params| {
            let root = list_root.clone();
            async move { list_directory(params, root).await }
        })
        .await?;

    let tree_root = working_directory.clone();
    registry
        .register("getDirectoryTree", move |params| {
            let root = tree_root.clone();
            async move { directory_tree(params, root).await }
        })
        .await?;

    let rg_root = working_directory.clone();
    let rg_config = config.clone();
    registry
        .register("ripgrep", move |params| {
            let root = rg_root.clone();
            let config = rg_config.clone();
            async move { run_tool(params, root, &config, Tool::Ripgrep).await }
        })
        .await?;

    let diff_root = working_directory;
    let diff_config = config.clone();
    registry
        .register("difftastic", move |params| {
            let root = diff_root.clone();
            let config = diff_config.clone();
            async move { run_tool(params, root, &config, Tool::Difftastic).await }
        })
        .await?;
    Ok(())
}

async fn bash(params: Value, root: Option<PathBuf>) -> Result<Value> {
    let command = params
        .get("command")
        .and_then(Value::as_str)
        .context("bash command is missing")?;
    let cwd = match params.get("cwd").and_then(Value::as_str) {
        None | Some("/") => None,
        Some(path) => match validate_path(path, root.as_deref()) {
            Ok(path) => Some(path),
            Err(error) => return Ok(json!({ "success": false, "error": error })),
        },
    };
    let timeout = params
        .get("timeout")
        .and_then(Value::as_u64)
        .unwrap_or(30_000)
        .clamp(1, 30 * 60 * 1000);
    let mut child = shell_command(command);
    if let Some(cwd) = cwd {
        child.current_dir(cwd);
    }
    match tokio::time::timeout(Duration::from_millis(timeout), child.output()).await {
        Err(_) => Ok(json!({
            "success": false,
            "stdout": "",
            "stderr": "",
            "exitCode": -1,
            "error": "Command timed out"
        })),
        Ok(Err(error)) => Ok(json!({
            "success": false,
            "stdout": "",
            "stderr": error.to_string(),
            "exitCode": 1,
            "error": error.to_string()
        })),
        Ok(Ok(output)) => Ok(json!({
            "success": output.status.success(),
            "stdout": String::from_utf8_lossy(&output.stdout),
            "stderr": String::from_utf8_lossy(&output.stderr),
            "exitCode": output.status.code().unwrap_or(-1),
            "error": if output.status.success() { Value::Null } else { Value::String("Command failed".to_owned()) },
        })),
    }
}

async fn read_file(params: Value, root: Option<PathBuf>) -> Result<Value> {
    let path = match path_param(&params, root.as_deref()) {
        Ok(path) => path,
        Err(error) => return Ok(json!({ "success": false, "error": error })),
    };
    match tokio::fs::read(&path).await {
        Ok(content) => Ok(json!({
            "success": true,
            "content": crypto::encode_base64(&content),
        })),
        Err(error) => Ok(json!({ "success": false, "error": error.to_string() })),
    }
}

async fn write_file(params: Value, root: Option<PathBuf>) -> Result<Value> {
    let path = match path_param(&params, root.as_deref()) {
        Ok(path) => path,
        Err(error) => return Ok(json!({ "success": false, "error": error })),
    };
    let encoded = params
        .get("content")
        .and_then(Value::as_str)
        .context("file content is missing")?;
    let content = match crypto::decode_base64(encoded) {
        Ok(content) => content,
        Err(error) => return Ok(json!({ "success": false, "error": error.to_string() })),
    };
    let expected = params.get("expectedHash");
    if expected.is_none() || expected == Some(&Value::Null) {
        if path.exists() {
            return Ok(json!({
                "success": false,
                "error": "File already exists but was expected to be new"
            }));
        }
    } else if let Some(expected) = expected.and_then(Value::as_str) {
        match tokio::fs::read(&path).await {
            Ok(existing) => {
                let actual = sha256_hex(&existing);
                if actual != expected {
                    return Ok(json!({
                        "success": false,
                        "error": format!("File hash mismatch. Expected: {expected}, Actual: {actual}")
                    }));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(json!({
                    "success": false,
                    "error": "File does not exist but hash was provided"
                }));
            }
            Err(error) => return Ok(json!({ "success": false, "error": error.to_string() })),
        }
    }
    match tokio::fs::write(&path, &content).await {
        Ok(()) => Ok(json!({ "success": true, "hash": sha256_hex(&content) })),
        Err(error) => Ok(json!({ "success": false, "error": error.to_string() })),
    }
}

async fn list_directory(params: Value, root: Option<PathBuf>) -> Result<Value> {
    let path = match path_param(&params, root.as_deref()) {
        Ok(path) => path,
        Err(error) => return Ok(json!({ "success": false, "error": error })),
    };
    let mut entries = Vec::new();
    let mut directory = match tokio::fs::read_dir(&path).await {
        Ok(directory) => directory,
        Err(error) => return Ok(json!({ "success": false, "error": error.to_string() })),
    };
    while let Some(entry) = directory.next_entry().await? {
        let metadata = match entry.metadata().await {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let kind = if metadata.is_dir() {
            "directory"
        } else if metadata.is_file() {
            "file"
        } else {
            "other"
        };
        entries.push(json!({
            "name": entry.file_name().to_string_lossy(),
            "type": kind,
            "size": metadata.len(),
            "modified": modified_ms(&metadata),
        }));
    }
    entries.sort_by(|left, right| {
        let left_dir = left.get("type").and_then(Value::as_str) == Some("directory");
        let right_dir = right.get("type").and_then(Value::as_str) == Some("directory");
        right_dir.cmp(&left_dir).then_with(|| {
            left.get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .cmp(right.get("name").and_then(Value::as_str).unwrap_or(""))
        })
    });
    Ok(json!({ "success": true, "entries": entries }))
}

async fn directory_tree(params: Value, root: Option<PathBuf>) -> Result<Value> {
    let path = match path_param(&params, root.as_deref()) {
        Ok(path) => path,
        Err(error) => return Ok(json!({ "success": false, "error": error })),
    };
    let max_depth = params
        .get("maxDepth")
        .and_then(Value::as_i64)
        .context("maxDepth is missing")?;
    if max_depth < 0 {
        return Ok(json!({ "success": false, "error": "maxDepth must be non-negative" }));
    }
    match build_tree(&path, 0, max_depth as u64).await {
        Ok(Some(tree)) => Ok(json!({ "success": true, "tree": tree })),
        Ok(None) => Ok(json!({
            "success": false,
            "error": "Failed to access the specified path"
        })),
        Err(error) => Ok(json!({ "success": false, "error": error.to_string() })),
    }
}

fn build_tree<'a>(
    path: &'a Path,
    depth: u64,
    max_depth: u64,
) -> BoxFuture<'a, Result<Option<Value>>> {
    Box::pin(async move {
        let metadata = match tokio::fs::symlink_metadata(path).await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        if metadata.file_type().is_symlink() {
            return Ok(None);
        }
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        let mut node = json!({
            "name": name,
            "path": path,
            "type": if metadata.is_dir() { "directory" } else { "file" },
            "size": metadata.len(),
            "modified": modified_ms(&metadata),
        });
        if metadata.is_dir() && depth < max_depth {
            let mut children = Vec::new();
            let mut directory = tokio::fs::read_dir(path).await?;
            while let Some(entry) = directory.next_entry().await? {
                if let Some(child) = build_tree(&entry.path(), depth + 1, max_depth).await? {
                    children.push(child);
                }
            }
            children.sort_by(|left, right| {
                let left_dir = left.get("type").and_then(Value::as_str) == Some("directory");
                let right_dir = right.get("type").and_then(Value::as_str) == Some("directory");
                right_dir.cmp(&left_dir).then_with(|| {
                    left.get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .cmp(right.get("name").and_then(Value::as_str).unwrap_or(""))
                })
            });
            node["children"] = Value::Array(children);
        }
        Ok(Some(node))
    })
}

#[derive(Clone, Copy)]
enum Tool {
    Ripgrep,
    Difftastic,
}

async fn run_tool(
    params: Value,
    root: Option<PathBuf>,
    config: &Config,
    tool: Tool,
) -> Result<Value> {
    let args = params
        .get("args")
        .and_then(Value::as_array)
        .context("tool args are missing")?
        .iter()
        .map(|value| value.as_str().map(str::to_owned))
        .collect::<Option<Vec<_>>>()
        .context("tool args must be strings")?;
    let cwd = match params.get("cwd").and_then(Value::as_str) {
        Some(cwd) => match validate_path(cwd, root.as_deref()) {
            Ok(path) => Some(path),
            Err(error) => return Ok(json!({ "success": false, "error": error })),
        },
        None => None,
    };
    let binary = resolve_tool(config, tool);
    let mut command = Command::new(binary);
    command.args(args);
    command.kill_on_drop(true);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    match tokio::time::timeout(Duration::from_secs(30), command.output()).await {
        Err(_) => Ok(json!({
            "success": false,
            "exitCode": -1,
            "stdout": "",
            "stderr": "",
            "error": "Command timed out",
        })),
        Ok(Err(error)) => Ok(json!({ "success": false, "error": error.to_string() })),
        Ok(Ok(output)) => Ok(json!({
            "success": true,
            "exitCode": output.status.code().unwrap_or(-1),
            "stdout": String::from_utf8_lossy(&output.stdout),
            "stderr": String::from_utf8_lossy(&output.stderr),
        })),
    }
}

fn resolve_tool(config: &Config, tool: Tool) -> PathBuf {
    let (env_name, binary) = match tool {
        Tool::Ripgrep => (
            "HAPPY_RIPGREP_BIN",
            if cfg!(windows) { "rg.exe" } else { "rg" },
        ),
        Tool::Difftastic => (
            "HAPPY_DIFFTASTIC_BIN",
            if cfg!(windows) { "difft.exe" } else { "difft" },
        ),
    };
    if let Some(path) = std::env::var_os(env_name).map(PathBuf::from) {
        return path;
    }
    let staged = config.home_dir.join("tools").join("unpacked").join(binary);
    if staged.exists() {
        return staged;
    }
    if let Some(package_root) = config.package_root() {
        let package_staged = package_root.join("tools").join("unpacked").join(binary);
        if package_staged.exists() {
            return package_staged;
        }
    }
    PathBuf::from(binary)
}

fn shell_command(command: &str) -> Command {
    let mut child = if cfg!(windows) {
        let mut child = Command::new("cmd");
        child.args(["/D", "/S", "/C", command]);
        child
    } else {
        let mut child = Command::new("sh");
        child.args(["-c", command]);
        child
    };
    child.kill_on_drop(true);
    child
}

fn path_param(params: &Value, root: Option<&Path>) -> Result<PathBuf, String> {
    let path = params
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "path is missing".to_owned())?;
    validate_path(path, root)
}

fn validate_path(path: &str, root: Option<&Path>) -> Result<PathBuf, String> {
    let raw = PathBuf::from(path);
    let target = match root {
        Some(root) => {
            if raw.is_absolute() {
                raw
            } else {
                root.join(raw)
            }
        }
        None => raw,
    };
    let target = if target.is_absolute() {
        target
    } else {
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(target)
    };
    let normalized = lexical_normalize(&target);
    if let Some(root) = root {
        let root = root
            .canonicalize()
            .unwrap_or_else(|_| lexical_normalize(root));
        let check = if normalized.exists() {
            normalized
                .canonicalize()
                .unwrap_or_else(|_| normalized.clone())
        } else {
            let parent = normalized.parent().unwrap_or(Path::new("."));
            let canonical_parent = parent
                .canonicalize()
                .unwrap_or_else(|_| lexical_normalize(parent));
            canonical_parent.join(normalized.file_name().unwrap_or_default())
        };
        if !check.starts_with(&root) {
            return Err(format!(
                "Access denied: Path '{path}' is outside the working directory"
            ));
        }
    }
    Ok(normalized)
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                result.pop();
            }
            _ => result.push(component.as_os_str()),
        }
    }
    result
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .unwrap_or_else(|| Duration::from_secs(0))
        .as_millis() as u64
}
