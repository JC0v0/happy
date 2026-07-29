use std::io::{Read, Write};

use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 2;
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_TERMINAL_ID_BYTES: usize = 128;

pub const REQUEST_SPAWN: u8 = 0x01;
pub const REQUEST_WRITE: u8 = 0x02;
pub const REQUEST_EXECUTE: u8 = 0x03;
pub const REQUEST_RESIZE: u8 = 0x04;
pub const REQUEST_SNAPSHOT: u8 = 0x05;
pub const REQUEST_KILL: u8 = 0x06;

pub const EVENT_READY: u8 = 0x81;
pub const EVENT_OUTPUT: u8 = 0x82;
pub const EVENT_METADATA: u8 = 0x83;
pub const EVENT_EXECUTE_RESULT: u8 = 0x84;
pub const EVENT_SNAPSHOT_END: u8 = 0x85;
pub const EVENT_EXIT: u8 = 0x86;
pub const EVENT_ERROR: u8 = 0x87;

#[derive(Debug)]
pub struct Frame {
    pub kind: u8,
    pub payload: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnRequest {
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

#[derive(Debug)]
pub struct WriteRequest {
    pub terminal_id: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteRequest {
    pub request_id: u32,
    pub terminal_id: String,
    pub command: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeRequest {
    pub terminal_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRequest {
    pub request_id: u32,
}

#[derive(Debug)]
pub enum Request {
    Spawn(SpawnRequest),
    Write(WriteRequest),
    Execute(ExecuteRequest),
    Resize(ResizeRequest),
    Snapshot(SnapshotRequest),
    Kill,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResponse {
    pub r#type: &'static str,
    pub protocol_version: u32,
    pub pty: bool,
    pub framing: &'static str,
    pub authoritative_state: bool,
}

pub fn read_frame(reader: &mut impl Read) -> Result<Option<Frame>> {
    let mut length_bytes = [0_u8; 4];
    match reader.read(&mut length_bytes[..1]) {
        Ok(0) => return Ok(None),
        Ok(1) => {}
        Ok(_) => unreachable!("single-byte read returned more than one byte"),
        Err(error) => return Err(error).context("reading frame length"),
    }
    reader
        .read_exact(&mut length_bytes[1..])
        .context("reading frame length")?;

    let length = u32::from_be_bytes(length_bytes) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        bail!("invalid frame length {length}");
    }

    let mut frame = vec![0_u8; length];
    reader
        .read_exact(&mut frame)
        .context("reading frame payload")?;
    Ok(Some(Frame {
        kind: frame[0],
        payload: frame[1..].to_vec(),
    }))
}

pub fn write_frame(writer: &mut impl Write, kind: u8, payload: &[u8]) -> Result<()> {
    let length = payload
        .len()
        .checked_add(1)
        .ok_or_else(|| anyhow!("frame length overflow"))?;
    if length > MAX_FRAME_BYTES {
        bail!("frame too large: {length} bytes");
    }
    writer
        .write_all(&(length as u32).to_be_bytes())
        .context("writing frame length")?;
    writer.write_all(&[kind]).context("writing frame kind")?;
    writer.write_all(payload).context("writing frame payload")?;
    writer.flush().context("flushing frame")?;
    Ok(())
}

pub fn write_json<T: Serialize>(writer: &mut impl Write, kind: u8, value: &T) -> Result<()> {
    let payload = serde_json::to_vec(value).context("encoding JSON frame")?;
    write_frame(writer, kind, &payload)
}

pub fn decode_request(frame: Frame) -> Result<Request> {
    match frame.kind {
        REQUEST_SPAWN => {
            let request: SpawnRequest =
                serde_json::from_slice(&frame.payload).context("decoding spawn request")?;
            if request.cwd.trim().is_empty() {
                bail!("spawn cwd must not be empty");
            }
            validate_dimensions(request.cols, request.rows)?;
            Ok(Request::Spawn(request))
        }
        REQUEST_WRITE => Ok(Request::Write(decode_write_request(&frame.payload)?)),
        REQUEST_EXECUTE => {
            let request: ExecuteRequest =
                serde_json::from_slice(&frame.payload).context("decoding execute request")?;
            validate_request_id(request.request_id)?;
            validate_terminal_id(&request.terminal_id)?;
            Ok(Request::Execute(request))
        }
        REQUEST_RESIZE => {
            let request: ResizeRequest =
                serde_json::from_slice(&frame.payload).context("decoding resize request")?;
            validate_terminal_id(&request.terminal_id)?;
            validate_dimensions(request.cols, request.rows)?;
            Ok(Request::Resize(request))
        }
        REQUEST_SNAPSHOT => {
            let request: SnapshotRequest =
                serde_json::from_slice(&frame.payload).context("decoding snapshot request")?;
            validate_request_id(request.request_id)?;
            Ok(Request::Snapshot(request))
        }
        REQUEST_KILL if frame.payload.is_empty() => Ok(Request::Kill),
        REQUEST_KILL => bail!("kill request must not contain a payload"),
        kind => bail!("unsupported request kind 0x{kind:02x}"),
    }
}

fn decode_write_request(payload: &[u8]) -> Result<WriteRequest> {
    if payload.len() < 2 {
        bail!("write request is missing terminal id length");
    }
    let terminal_id_length = u16::from_be_bytes([payload[0], payload[1]]) as usize;
    if terminal_id_length == 0 || terminal_id_length > MAX_TERMINAL_ID_BYTES {
        bail!("invalid terminal id length {terminal_id_length}");
    }
    if payload.len() < 2 + terminal_id_length {
        bail!("write request terminal id is truncated");
    }
    let terminal_id = std::str::from_utf8(&payload[2..2 + terminal_id_length])
        .context("decoding write request terminal id")?
        .to_owned();
    validate_terminal_id(&terminal_id)?;
    Ok(WriteRequest {
        terminal_id,
        data: payload[2 + terminal_id_length..].to_vec(),
    })
}

fn validate_terminal_id(terminal_id: &str) -> Result<()> {
    if terminal_id.is_empty() || terminal_id.len() > MAX_TERMINAL_ID_BYTES {
        bail!("terminal id must contain 1-{MAX_TERMINAL_ID_BYTES} bytes");
    }
    Ok(())
}

fn validate_request_id(request_id: u32) -> Result<()> {
    if request_id == 0 {
        bail!("request id must be greater than zero");
    }
    Ok(())
}

fn validate_dimensions(cols: u16, rows: u16) -> Result<()> {
    if cols == 0 || rows == 0 {
        bail!("terminal dimensions must be greater than zero");
    }
    Ok(())
}

pub fn encode_output_payload(request_id: u32, seq: u64, data: &[u8]) -> Result<Vec<u8>> {
    let capacity = 12_usize
        .checked_add(data.len())
        .ok_or_else(|| anyhow!("output payload length overflow"))?;
    if capacity + 1 > MAX_FRAME_BYTES {
        bail!("output payload is too large");
    }
    let mut payload = Vec::with_capacity(capacity);
    payload.extend_from_slice(&request_id.to_be_bytes());
    payload.extend_from_slice(&seq.to_be_bytes());
    payload.extend_from_slice(data);
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_frame_round_trip_preserves_zero_bytes() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, REQUEST_WRITE, &[0, 1, 2, 0xff]).unwrap();
        let frame = read_frame(&mut bytes.as_slice()).unwrap().unwrap();
        assert_eq!(frame.kind, REQUEST_WRITE);
        assert_eq!(frame.payload, [0, 1, 2, 0xff]);
    }

    #[test]
    fn decodes_raw_write_without_base64() {
        let terminal_id = b"phone";
        let mut payload = Vec::new();
        payload.extend_from_slice(&(terminal_id.len() as u16).to_be_bytes());
        payload.extend_from_slice(terminal_id);
        payload.extend_from_slice(&[0, 0x1b, 0xff]);

        let request = decode_request(Frame {
            kind: REQUEST_WRITE,
            payload,
        })
        .unwrap();
        let Request::Write(request) = request else {
            panic!("unexpected request");
        };
        assert_eq!(request.terminal_id, "phone");
        assert_eq!(request.data, [0, 0x1b, 0xff]);
    }

    #[test]
    fn rejects_oversized_frames_before_allocating_payload() {
        let mut bytes = ((MAX_FRAME_BYTES as u32) + 1).to_be_bytes().to_vec();
        bytes.push(0);
        let error = read_frame(&mut bytes.as_slice()).unwrap_err();
        assert!(error.to_string().contains("invalid frame length"));
    }

    #[test]
    fn clean_eof_is_distinct_from_truncated_frame() {
        assert!(read_frame(&mut [].as_slice()).unwrap().is_none());

        let error = read_frame(&mut [0_u8, 0].as_slice()).unwrap_err();
        assert!(error.to_string().contains("reading frame length"));

        let error = read_frame(&mut [0_u8, 0, 0, 3, REQUEST_WRITE].as_slice()).unwrap_err();
        assert!(error.to_string().contains("reading frame payload"));
    }

    #[test]
    fn rejects_invalid_control_values() {
        let spawn = decode_request(Frame {
            kind: REQUEST_SPAWN,
            payload: br#"{"cwd":"/tmp","cols":0,"rows":24}"#.to_vec(),
        })
        .unwrap_err();
        assert!(spawn.to_string().contains("dimensions"));

        let snapshot = decode_request(Frame {
            kind: REQUEST_SNAPSHOT,
            payload: br#"{"requestId":0}"#.to_vec(),
        })
        .unwrap_err();
        assert!(snapshot.to_string().contains("request id"));
    }
}
