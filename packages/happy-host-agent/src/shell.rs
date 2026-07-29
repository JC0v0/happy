use std::sync::OnceLock;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use regex::{Regex, RegexSet};
use url::Url;

const OSC_PREFIX: &[u8] = b"\x1b]";
const OSC_BEL: u8 = 0x07;
const OSC_ST: &[u8] = b"\x1b\\";
const MAX_PENDING_OSC_BYTES: usize = 8 * 1024;
const MAX_ATTENTION_TAIL_CHARS: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellLaunch {
    pub file: String,
    pub args: Vec<String>,
    pub shell: String,
    pub structured_commands: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellMarker {
    Cwd(String),
    CommandStarted(String),
    CommandFinished(i32),
    Prompt,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellToken {
    Data(Vec<u8>),
    Marker(ShellMarker),
}

pub fn resolve_shell_launch(env: &std::collections::HashMap<String, String>) -> ShellLaunch {
    if cfg!(windows) {
        return ShellLaunch {
            file: "powershell.exe".to_owned(),
            args: vec![
                "-NoLogo".to_owned(),
                "-NoExit".to_owned(),
                "-Command".to_owned(),
                powershell_shell_integration_script(),
            ],
            shell: "powershell".to_owned(),
            structured_commands: true,
        };
    }

    let file = env
        .get("SHELL")
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| "/bin/bash".to_owned());
    let shell = std::path::Path::new(&file)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("shell")
        .to_owned();
    ShellLaunch {
        file,
        args: Vec::new(),
        shell,
        // PowerShell supplies OSC 133 command boundaries today. Raw Bash/zsh
        // remains fully functional until their integration scripts land.
        structured_commands: false,
    }
}

pub fn powershell_shell_integration_script() -> String {
    [
        "if ($global:__HappyShellIntegrationVersion -ne 2) {",
        "$global:__HappyOriginalPrompt = ${function:prompt}",
        "if ($null -eq ${function:PSConsoleHostReadLine}) { Import-Module PSReadLine -ErrorAction SilentlyContinue }",
        "$global:__HappyOriginalPSConsoleHostReadLine = ${function:PSConsoleHostReadLine}",
        "if ($null -ne $global:__HappyOriginalPSConsoleHostReadLine) {",
        "function global:PSConsoleHostReadLine {",
        "$happyLine = & $global:__HappyOriginalPSConsoleHostReadLine",
        "$happyLineBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$happyLine)",
        "$happyLineBase64 = [Convert]::ToBase64String($happyLineBytes)",
        "[Console]::Write(\"$([char]27)]133;C;$happyLineBase64$([char]7)\")",
        "return $happyLine",
        "}",
        "}",
        "function global:prompt {",
        "$happySucceeded = $?",
        "$happyNativeExit = $global:LASTEXITCODE",
        "$happyExitCode = if ($happySucceeded) { 0 } elseif ($happyNativeExit -is [int] -and $happyNativeExit -ne 0) { $happyNativeExit } else { 1 }",
        "try { $happyCwdUri = [System.Uri]::new((Get-Location).Path).AbsoluteUri } catch { $happyCwdUri = '' }",
        "if ($happyCwdUri) { [Console]::Write(\"$([char]27)]7;$happyCwdUri$([char]7)\") }",
        "[Console]::Write(\"$([char]27)]133;D;$happyExitCode$([char]7)\")",
        "[Console]::Write(\"$([char]27)]133;A$([char]7)\")",
        "if ($null -ne $global:__HappyOriginalPrompt) { & $global:__HappyOriginalPrompt } else { \"PS $($executionContext.SessionState.Path.CurrentLocation)> \" }",
        "}",
        "$global:__HappyShellIntegrationVersion = 2",
        "}",
    ]
    .join("; ")
}

pub struct ShellIntegrationParser {
    pending: Vec<u8>,
}

impl ShellIntegrationParser {
    pub fn new() -> Self {
        Self {
            pending: Vec::new(),
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Vec<ShellToken> {
        let mut bytes = std::mem::take(&mut self.pending);
        bytes.extend_from_slice(chunk);
        let mut tokens = Vec::new();
        let mut cursor = 0;

        while cursor < bytes.len() {
            let Some(relative_start) = find_subslice(&bytes[cursor..], OSC_PREFIX) else {
                let hold_escape = bytes.last() == Some(&0x1b);
                let end = if hold_escape {
                    bytes.len().saturating_sub(1)
                } else {
                    bytes.len()
                };
                append_data(&mut tokens, &bytes[cursor..end]);
                if hold_escape {
                    self.pending.push(0x1b);
                }
                break;
            };
            let start = cursor + relative_start;
            append_data(&mut tokens, &bytes[cursor..start]);

            let content_start = start + OSC_PREFIX.len();
            let Some((content_end, terminator_length)) = find_osc_end(&bytes, content_start) else {
                self.pending.extend_from_slice(&bytes[start..]);
                if self.pending.len() > MAX_PENDING_OSC_BYTES {
                    let pending = std::mem::take(&mut self.pending);
                    append_data(&mut tokens, &pending);
                }
                break;
            };
            let raw_end = content_end + terminator_length;
            if let Some(marker) = parse_marker(&bytes[content_start..content_end]) {
                tokens.push(ShellToken::Marker(marker));
            } else {
                append_data(&mut tokens, &bytes[start..raw_end]);
            }
            cursor = raw_end;
        }

        tokens
    }

    pub fn flush(&mut self) -> Vec<ShellToken> {
        if self.pending.is_empty() {
            return Vec::new();
        }
        vec![ShellToken::Data(std::mem::take(&mut self.pending))]
    }
}

fn append_data(tokens: &mut Vec<ShellToken>, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    if let Some(ShellToken::Data(previous)) = tokens.last_mut() {
        previous.extend_from_slice(data);
    } else {
        tokens.push(ShellToken::Data(data.to_vec()));
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn find_osc_end(bytes: &[u8], start: usize) -> Option<(usize, usize)> {
    let bel = bytes[start..]
        .iter()
        .position(|byte| *byte == OSC_BEL)
        .map(|index| start + index);
    let st = find_subslice(&bytes[start..], OSC_ST).map(|index| start + index);
    match (bel, st) {
        (Some(bel), Some(st)) if bel < st => Some((bel, 1)),
        (Some(_), Some(st)) => Some((st, OSC_ST.len())),
        (Some(bel), None) => Some((bel, 1)),
        (None, Some(st)) => Some((st, OSC_ST.len())),
        (None, None) => None,
    }
}

fn parse_marker(content: &[u8]) -> Option<ShellMarker> {
    let content = std::str::from_utf8(content).ok()?;
    if content == "133;A" {
        return Some(ShellMarker::Prompt);
    }
    if let Some(encoded) = content.strip_prefix("133;C;") {
        let bytes = BASE64.decode(encoded).ok()?;
        let command = String::from_utf8(bytes).ok()?;
        return Some(ShellMarker::CommandStarted(command));
    }
    if let Some(value) = content.strip_prefix("133;D") {
        let exit_code = value
            .strip_prefix(';')
            .unwrap_or("0")
            .parse::<i32>()
            .unwrap_or(1);
        return Some(ShellMarker::CommandFinished(exit_code));
    }
    if let Some(value) = content.strip_prefix("7;") {
        let url = Url::parse(value).ok()?;
        if url.scheme() != "file" {
            return None;
        }
        let path = url.to_file_path().ok()?;
        return Some(ShellMarker::Cwd(path.to_string_lossy().into_owned()));
    }
    None
}

fn attention_control_patterns() -> &'static (Regex, Regex) {
    static PATTERNS: OnceLock<(Regex, Regex)> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        (
            Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").expect("valid CSI regex"),
            Regex::new(r"\x1b\][^\x07]*(?:\x07|\x1b\\)").expect("valid OSC regex"),
        )
    })
}

fn attention_patterns() -> &'static RegexSet {
    static PATTERNS: OnceLock<RegexSet> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        RegexSet::new([
            r"(?i)(?:password|passphrase|pin|verification code|one[- ]time code|otp)\s*:\s*$",
            r"(?i)(?:are you sure|continue|proceed)\??\s*(?:\[[yY]/[nN]\]|\([yY]es/[nN]o\))?\s*$",
            r"(?i)(?:\[[yY]/[nN]\]|\[[nN]/[yY]\]|\([yY]es/[nN]o\))\s*[:?]?\s*$",
            r"(?i)press (?:enter|return|any key)(?: to [^\r\n]+)?\s*\.?\s*$",
        ])
        .expect("valid attention regexes")
    })
}

pub struct AttentionDetector {
    tail: String,
}

impl AttentionDetector {
    pub fn new() -> Self {
        Self {
            tail: String::new(),
        }
    }

    pub fn push(&mut self, data: &[u8]) -> bool {
        let decoded = String::from_utf8_lossy(data);
        let (csi, osc) = attention_control_patterns();
        let without_osc = osc.replace_all(&decoded, "");
        let clean = csi.replace_all(&without_osc, "").replace('\r', "\n");
        self.tail.push_str(&clean);
        if self.tail.chars().count() > MAX_ATTENTION_TAIL_CHARS {
            self.tail = self
                .tail
                .chars()
                .rev()
                .take(MAX_ATTENTION_TAIL_CHARS)
                .collect::<String>()
                .chars()
                .rev()
                .collect();
        }
        let last_line = self.tail.lines().next_back().unwrap_or("").trim_end();
        attention_patterns().is_match(last_line)
    }

    pub fn reset(&mut self) {
        self.tail.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_preserves_split_unknown_escape_sequences() {
        let mut parser = ShellIntegrationParser::new();
        assert_eq!(
            parser.push(b"hello\x1b"),
            vec![ShellToken::Data(b"hello".to_vec())]
        );
        assert_eq!(
            parser.push(b"[31mred"),
            vec![ShellToken::Data(b"\x1b[31mred".to_vec())]
        );
    }

    #[test]
    fn parser_extracts_command_and_exit_markers() {
        let command = BASE64.encode("Get-ChildItem");
        let bytes = format!("before\x1b]133;C;{command}\x07output\x1b]133;D;7\x07after");
        let mut parser = ShellIntegrationParser::new();
        assert_eq!(
            parser.push(bytes.as_bytes()),
            vec![
                ShellToken::Data(b"before".to_vec()),
                ShellToken::Marker(ShellMarker::CommandStarted("Get-ChildItem".to_owned())),
                ShellToken::Data(b"output".to_vec()),
                ShellToken::Marker(ShellMarker::CommandFinished(7)),
                ShellToken::Data(b"after".to_vec()),
            ]
        );
    }

    #[test]
    fn detector_recognizes_prompts_after_ansi_codes() {
        let mut detector = AttentionDetector::new();
        assert!(detector.push(b"\x1b[31mPassword:\x1b[0m"));
        detector.reset();
        assert!(!detector.push(b"normal output\n"));
    }
}
