use serde::{Deserialize, Serialize};

/// Serde mirror of the terminal portion of happy-wire.
///
/// Keeping these types local is intentional: the server and app remain
/// TypeScript packages, while the native CLI must be able to validate the
/// stable JSON contract without introducing a Rust workspace dependency.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "t", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum TerminalStreamEvent {
    Output {
        seq: u64,
        data: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        snapshot: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        terminal_id: Option<String>,
    },
    CommandStart {
        seq: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        snapshot: Option<bool>,
        command_id: String,
        command: String,
        started_at: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
    },
    CommandEnd {
        seq: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        snapshot: Option<bool>,
        command_id: String,
        ended_at: u64,
        duration_ms: u64,
        exit_code: i32,
        #[serde(skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
    },
    Cwd {
        seq: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        snapshot: Option<bool>,
        path: String,
    },
    State {
        seq: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        snapshot: Option<bool>,
        state: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        command_id: Option<String>,
    },
    Grid {
        seq: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        snapshot: Option<bool>,
        cols: u16,
        rows: u16,
        #[serde(skip_serializing_if = "Option::is_none")]
        controller_terminal_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalOutputEnvelope {
    pub t: String,
    pub sid: String,
    pub c: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn terminal_output_fixture_matches_happy_wire_shape() {
        let value = TerminalStreamEvent::Output {
            seq: 42,
            data: "aGVsbG8=".to_owned(),
            snapshot: Some(true),
            terminal_id: Some("phone".to_owned()),
        };
        assert_eq!(
            serde_json::to_value(value).unwrap(),
            json!({
                "t": "output",
                "seq": 42,
                "data": "aGVsbG8=",
                "snapshot": true,
                "terminalId": "phone"
            })
        );
    }

    #[test]
    fn command_events_round_trip_with_camel_case_fields() {
        let raw = json!({
            "t": "command-end",
            "seq": 9,
            "commandId": "cmd-1",
            "endedAt": 1000,
            "durationMs": 25,
            "exitCode": 0,
            "cwd": "C:/work"
        });
        let event: TerminalStreamEvent = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(serde_json::to_value(event).unwrap(), raw);
    }
}
