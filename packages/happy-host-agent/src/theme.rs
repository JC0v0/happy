use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTheme {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreground: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub black: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub red: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub green: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yellow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub magenta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cyan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub white: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_black: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_red: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_green: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_yellow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_blue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_magenta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_cyan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_white: Option<String>,
}

pub fn read_local_terminal_theme(env: &HashMap<String, String>) -> Option<TerminalTheme> {
    if !cfg!(windows) {
        return None;
    }
    let local_app_data = env.get("LOCALAPPDATA")?;
    let settings_path = PathBuf::from(local_app_data)
        .join("Packages")
        .join("Microsoft.WindowsTerminal_8wekyb3d8bbwe")
        .join("LocalState")
        .join("settings.json");
    let raw = fs::read_to_string(settings_path).ok()?;
    let settings: Value = serde_json::from_str(&strip_json_comments(&raw)).ok()?;
    let default_profile = settings.get("defaultProfile").and_then(Value::as_str);
    let profile_scheme = settings
        .pointer("/profiles/list")
        .and_then(Value::as_array)
        .and_then(|profiles| {
            profiles
                .iter()
                .find(|profile| profile.get("guid").and_then(Value::as_str) == default_profile)
        })
        .and_then(|profile| profile.get("colorScheme"))
        .and_then(Value::as_str);
    let default_scheme = settings
        .pointer("/profiles/defaults/colorScheme")
        .and_then(Value::as_str);
    let scheme_name = profile_scheme.or(default_scheme).unwrap_or("Campbell");
    let scheme = settings
        .get("schemes")
        .and_then(Value::as_array)?
        .iter()
        .find(|scheme| scheme.get("name").and_then(Value::as_str) == Some(scheme_name))?;

    let value = |key: &str| scheme.get(key).and_then(Value::as_str).map(str::to_owned);
    Some(TerminalTheme {
        background: value("background"),
        foreground: value("foreground"),
        cursor: value("cursorColor"),
        selection_background: value("selectionBackground"),
        black: value("black"),
        red: value("red"),
        green: value("green"),
        yellow: value("yellow"),
        blue: value("blue"),
        magenta: value("purple"),
        cyan: value("cyan"),
        white: value("white"),
        bright_black: value("brightBlack"),
        bright_red: value("brightRed"),
        bright_green: value("brightGreen"),
        bright_yellow: value("brightYellow"),
        bright_blue: value("brightBlue"),
        bright_magenta: value("brightPurple"),
        bright_cyan: value("brightCyan"),
        bright_white: value("brightWhite"),
    })
}

fn strip_json_comments(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut result = Vec::with_capacity(text.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;

    while index < bytes.len() {
        let byte = bytes[index];
        if escaped {
            result.push(byte);
            escaped = false;
            index += 1;
            continue;
        }
        if in_string && byte == b'\\' {
            result.push(b'\\');
            escaped = true;
            index += 1;
            continue;
        }
        if byte == b'"' {
            in_string = !in_string;
            result.push(b'"');
            index += 1;
            continue;
        }
        if !in_string && byte == b'/' && bytes.get(index + 1) == Some(&b'/') {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if !in_string && byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
            index += 2;
            while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                index += 1;
            }
            index = (index + 2).min(bytes.len());
            continue;
        }
        result.push(byte);
        index += 1;
    }

    String::from_utf8(result).unwrap_or_else(|_| text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_comments_without_corrupting_urls() {
        let cleaned = strip_json_comments(
            r#"{
              // comment
              "url": "https://example.com/a/*b*/",
              /* block */
              "name": "Campbell"
            }"#,
        );
        let parsed: Value = serde_json::from_str(&cleaned).unwrap();
        assert_eq!(parsed["url"], "https://example.com/a/*b*/");
        assert_eq!(parsed["name"], "Campbell");
    }
}
