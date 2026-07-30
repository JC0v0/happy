use std::collections::{HashMap, VecDeque};
use std::io::{BufWriter, Read, Write};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use uuid::Uuid;

use crate::protocol::{
    EVENT_ERROR, EVENT_EXECUTE_RESULT, EVENT_EXIT, EVENT_METADATA, EVENT_OUTPUT, EVENT_READY,
    EVENT_SNAPSHOT_END, PROTOCOL_VERSION, Request, SnapshotRequest, SpawnRequest,
    encode_output_payload, write_frame, write_json,
};
use crate::shell::{
    AttentionDetector, ShellIntegrationParser, ShellLaunch, ShellMarker, ShellToken,
    resolve_shell_launch,
};
use crate::theme::{TerminalTheme, read_local_terminal_theme};

const OUTPUT_BATCH_DELAY: Duration = Duration::from_millis(16);
const ATTENTION_SETTLE_DELAY: Duration = Duration::from_millis(700);
const MAX_OUTPUT_EVENT_BYTES: usize = 256 * 1024;
const RING_BUFFER_BYTES: usize = 1024 * 1024;

#[derive(Debug)]
pub enum RuntimeMessage {
    Request(Request),
    PtyOutput(Vec<u8>),
    PtyReaderClosed,
    PtyExited(u32),
    InputClosed,
    ProtocolError(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum TerminalStatus {
    Idle,
    Running,
    NeedsInput,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveCommand {
    command_id: String,
    command: String,
    started_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionState {
    status: TerminalStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_command: Option<ActiveCommand>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", rename_all = "kebab-case", rename_all_fields = "camelCase")]
enum MetadataEvent {
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
        state: TerminalStatus,
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

impl MetadataEvent {
    fn with_snapshot(&self) -> Self {
        let mut event = self.clone();
        match &mut event {
            Self::CommandStart { snapshot, .. }
            | Self::CommandEnd { snapshot, .. }
            | Self::Cwd { snapshot, .. }
            | Self::State { snapshot, .. }
            | Self::Grid { snapshot, .. } => *snapshot = Some(true),
        }
        event
    }
}

#[derive(Debug, Clone)]
enum StreamRecord {
    Output { seq: u64, data: Vec<u8> },
    Metadata(MetadataEvent),
}

impl StreamRecord {
    fn byte_size(&self) -> usize {
        match self {
            Self::Output { data, .. } => data.len(),
            Self::Metadata(event) => serde_json::to_vec(event)
                .map(|bytes| bytes.len())
                .unwrap_or(128),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyEvent {
    protocol_version: u32,
    shell: String,
    structured_commands: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    theme: Option<TerminalTheme>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetadataEnvelope {
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<u32>,
    event: MetadataEvent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteResult {
    request_id: u32,
    tracked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    command_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotEnd {
    request_id: u32,
    state: SessionState,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    exit_code: u32,
}

#[derive(Serialize)]
struct ErrorEvent<'a> {
    message: &'a str,
    fatal: bool,
}

struct RunningPty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

pub struct TerminalRuntime {
    stdout: BufWriter<std::io::Stdout>,
    sender: SyncSender<RuntimeMessage>,
    pty: Option<RunningPty>,
    shell_launch: Option<ShellLaunch>,
    shell_parser: Option<ShellIntegrationParser>,
    attention_detector: AttentionDetector,
    attention_deadline: Option<Instant>,
    state: SessionState,
    next_seq: u64,
    ring: VecDeque<(StreamRecord, usize)>,
    ring_bytes: usize,
    pending_output: Vec<u8>,
    output_deadline: Option<Instant>,
    viewports: HashMap<String, (u16, u16)>,
    controller_terminal_id: Option<String>,
    grid_cols: u16,
    grid_rows: u16,
    child_exit_code: Option<u32>,
    reader_closed: bool,
    spawned: bool,
}

impl TerminalRuntime {
    pub fn new(sender: SyncSender<RuntimeMessage>) -> Self {
        Self {
            stdout: BufWriter::new(std::io::stdout()),
            sender,
            pty: None,
            shell_launch: None,
            shell_parser: None,
            attention_detector: AttentionDetector::new(),
            attention_deadline: None,
            state: SessionState {
                status: TerminalStatus::Idle,
                cwd: None,
                active_command: None,
            },
            next_seq: 0,
            ring: VecDeque::new(),
            ring_bytes: 0,
            pending_output: Vec::new(),
            output_deadline: None,
            viewports: HashMap::new(),
            controller_terminal_id: None,
            grid_cols: 80,
            grid_rows: 24,
            child_exit_code: None,
            reader_closed: false,
            spawned: false,
        }
    }

    pub fn run(mut self, receiver: Receiver<RuntimeMessage>) -> Result<()> {
        loop {
            self.handle_due_events()?;
            if self.should_finish() {
                let exit_code = self.child_exit_code.unwrap_or(1);
                write_json(&mut self.stdout, EVENT_EXIT, &ExitEvent { exit_code })?;
                return Ok(());
            }

            let message = match self.next_deadline() {
                Some(deadline) => {
                    let timeout = deadline.saturating_duration_since(Instant::now());
                    match receiver.recv_timeout(timeout) {
                        Ok(message) => Some(message),
                        Err(RecvTimeoutError::Timeout) => None,
                        Err(RecvTimeoutError::Disconnected) => {
                            self.kill_pty();
                            return Ok(());
                        }
                    }
                }
                None => match receiver.recv() {
                    Ok(message) => Some(message),
                    Err(_) => {
                        self.kill_pty();
                        return Ok(());
                    }
                },
            };

            if let Some(message) = message
                && !self.handle_message(message)?
            {
                return Ok(());
            }
        }
    }

    fn handle_message(&mut self, message: RuntimeMessage) -> Result<bool> {
        match message {
            RuntimeMessage::Request(request) => self.handle_request(request),
            RuntimeMessage::PtyOutput(data) => {
                self.handle_pty_output(&data)?;
                Ok(true)
            }
            RuntimeMessage::PtyReaderClosed => {
                if let Some(parser) = self.shell_parser.as_mut() {
                    let tokens = parser.flush();
                    self.handle_shell_tokens(tokens)?;
                }
                self.flush_pending_output()?;
                self.reader_closed = true;
                Ok(true)
            }
            RuntimeMessage::PtyExited(exit_code) => {
                self.child_exit_code = Some(exit_code);
                Ok(true)
            }
            RuntimeMessage::InputClosed => {
                self.kill_pty();
                Ok(false)
            }
            RuntimeMessage::ProtocolError(message) => {
                self.emit_error(&message, true)?;
                self.kill_pty();
                Ok(false)
            }
        }
    }

    fn handle_request(&mut self, request: Request) -> Result<bool> {
        if !self.spawned && !matches!(request, Request::Spawn(_)) {
            self.emit_error("host agent must receive spawn first", true)?;
            return Ok(false);
        }
        match request {
            Request::Spawn(request) => {
                if self.spawned {
                    self.emit_error("terminal is already spawned", false)?;
                } else if let Err(error) = self.spawn_pty(request) {
                    self.emit_error(&format!("{error:#}"), true)?;
                    return Ok(false);
                }
            }
            Request::Write(request) => {
                self.activate_controller(&request.terminal_id)?;
                self.mark_input_received()?;
                self.write_pty(&request.data)?;
            }
            Request::Execute(request) => {
                self.activate_controller(&request.terminal_id)?;
                self.mark_input_received()?;
                let command_id = if self
                    .shell_launch
                    .as_ref()
                    .is_some_and(|launch| launch.structured_commands)
                {
                    self.begin_tracked_command(&request.command)?
                } else {
                    None
                };
                let mut data = request.command.as_bytes().to_vec();
                data.push(b'\r');
                self.write_pty(&data)?;
                write_json(
                    &mut self.stdout,
                    EVENT_EXECUTE_RESULT,
                    &ExecuteResult {
                        request_id: request.request_id,
                        tracked: command_id.is_some(),
                        command_id,
                    },
                )?;
            }
            Request::Resize(request) => {
                self.report_viewport(&request.terminal_id, request.cols, request.rows)?;
            }
            Request::Snapshot(request) => self.send_snapshot(request)?,
            Request::Kill => self.kill_pty(),
        }
        Ok(true)
    }

    fn spawn_pty(&mut self, request: SpawnRequest) -> Result<()> {
        let shell_launch = resolve_shell_launch(&request.env);
        let theme = read_local_terminal_theme(&request.env);
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: request.rows,
                cols: request.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("opening native PTY")?;

        let mut command = CommandBuilder::new(&shell_launch.file);
        command.args(shell_launch.args.clone());
        command.cwd(&request.cwd);
        let mut env = request.env;
        env.insert("COLORTERM".to_owned(), "truecolor".to_owned());
        env.entry("TERM".to_owned())
            .or_insert_with(|| "xterm-256color".to_owned());
        for (key, value) in env {
            command.env(key, value);
        }
        for (key, value) in &shell_launch.env {
            command.env(key, value);
        }

        let mut child = pair
            .slave
            .spawn_command(command)
            .context("spawning PTY child")?;
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .context("cloning PTY reader")?;
        let writer = pair.master.take_writer().context("opening PTY writer")?;
        let killer = child.clone_killer();

        let output_sender = self.sender.clone();
        thread::spawn(move || {
            let mut buffer = [0_u8; 16 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(length) => {
                        if output_sender
                            .send(RuntimeMessage::PtyOutput(buffer[..length].to_vec()))
                            .is_err()
                        {
                            return;
                        }
                    }
                    Err(error) => {
                        let _ = output_sender.send(RuntimeMessage::ProtocolError(format!(
                            "reading PTY output: {error}"
                        )));
                        return;
                    }
                }
            }
            let _ = output_sender.send(RuntimeMessage::PtyReaderClosed);
        });

        let exit_sender = self.sender.clone();
        thread::spawn(move || {
            let exit_code = child.wait().map(|status| status.exit_code()).unwrap_or(1);
            let _ = exit_sender.send(RuntimeMessage::PtyExited(exit_code));
        });

        self.grid_cols = request.cols;
        self.grid_rows = request.rows;
        self.state.cwd = Some(request.cwd);
        self.shell_parser = shell_launch
            .structured_commands
            .then(ShellIntegrationParser::new);
        self.pty = Some(RunningPty {
            master: pair.master,
            writer,
            killer,
        });
        self.spawned = true;
        self.shell_launch = Some(shell_launch.clone());

        write_json(
            &mut self.stdout,
            EVENT_READY,
            &ReadyEvent {
                protocol_version: PROTOCOL_VERSION,
                shell: shell_launch.shell,
                structured_commands: shell_launch.structured_commands,
                theme,
            },
        )?;
        self.apply_grid(request.cols, request.rows, None, true)?;
        Ok(())
    }

    fn handle_pty_output(&mut self, data: &[u8]) -> Result<()> {
        let tokens = if let Some(parser) = self.shell_parser.as_mut() {
            parser.push(data)
        } else {
            vec![ShellToken::Data(data.to_vec())]
        };
        self.handle_shell_tokens(tokens)
    }

    fn handle_shell_tokens(&mut self, tokens: Vec<ShellToken>) -> Result<()> {
        for token in tokens {
            match token {
                ShellToken::Data(data) => self.schedule_output(&data)?,
                ShellToken::Marker(marker) => {
                    self.flush_pending_output()?;
                    self.handle_shell_marker(marker)?;
                }
            }
        }
        Ok(())
    }

    fn handle_shell_marker(&mut self, marker: ShellMarker) -> Result<()> {
        match marker {
            ShellMarker::CommandStarted(command) => {
                self.begin_tracked_command(&command)?;
            }
            ShellMarker::CommandFinished(exit_code) => {
                self.finish_tracked_command(exit_code)?;
            }
            ShellMarker::Cwd(path) => {
                if self.state.cwd.as_deref() != Some(path.as_str()) {
                    self.state.cwd = Some(path.clone());
                    let seq = self.take_sequence();
                    self.record_and_emit(StreamRecord::Metadata(MetadataEvent::Cwd {
                        seq,
                        snapshot: None,
                        path,
                    }))?;
                }
            }
            ShellMarker::Prompt => {}
        }
        Ok(())
    }

    fn schedule_output(&mut self, data: &[u8]) -> Result<()> {
        if data.is_empty() {
            return Ok(());
        }
        self.attention_deadline = None;
        if self.state.active_command.is_some() && self.attention_detector.push(data) {
            self.attention_deadline = Some(Instant::now() + ATTENTION_SETTLE_DELAY);
        }

        let mut remaining = data;
        while !remaining.is_empty() {
            let available = MAX_OUTPUT_EVENT_BYTES.saturating_sub(self.pending_output.len());
            let take = available.min(remaining.len());
            self.pending_output.extend_from_slice(&remaining[..take]);
            remaining = &remaining[take..];
            if self.pending_output.len() == MAX_OUTPUT_EVENT_BYTES {
                self.flush_pending_output()?;
            }
        }
        if !self.pending_output.is_empty() && self.output_deadline.is_none() {
            self.output_deadline = Some(Instant::now() + OUTPUT_BATCH_DELAY);
        }
        Ok(())
    }

    fn flush_pending_output(&mut self) -> Result<()> {
        self.output_deadline = None;
        if self.pending_output.is_empty() {
            return Ok(());
        }
        let data = std::mem::take(&mut self.pending_output);
        let seq = self.take_sequence();
        self.record_and_emit(StreamRecord::Output { seq, data })
    }

    fn begin_tracked_command(&mut self, command: &str) -> Result<Option<String>> {
        if self.state.active_command.is_some() || command.trim().is_empty() {
            return Ok(None);
        }
        self.flush_pending_output()?;
        let command_id = Uuid::new_v4().to_string();
        let active = ActiveCommand {
            command_id: command_id.clone(),
            command: command.to_owned(),
            started_at: now_millis(),
            cwd: self.state.cwd.clone(),
        };
        self.state.active_command = Some(active.clone());
        let seq = self.take_sequence();
        self.record_and_emit(StreamRecord::Metadata(MetadataEvent::CommandStart {
            seq,
            snapshot: None,
            command_id: active.command_id.clone(),
            command: active.command,
            started_at: active.started_at,
            cwd: active.cwd,
        }))?;
        self.emit_state(TerminalStatus::Running, Some(command_id.clone()))?;
        Ok(Some(command_id))
    }

    fn finish_tracked_command(&mut self, exit_code: i32) -> Result<()> {
        let Some(command) = self.state.active_command.take() else {
            return Ok(());
        };
        self.flush_pending_output()?;
        self.attention_deadline = None;
        self.attention_detector.reset();
        let ended_at = now_millis();
        let duration_ms = ended_at.saturating_sub(command.started_at);
        let seq = self.take_sequence();
        self.record_and_emit(StreamRecord::Metadata(MetadataEvent::CommandEnd {
            seq,
            snapshot: None,
            command_id: command.command_id,
            ended_at,
            duration_ms,
            exit_code,
            cwd: self.state.cwd.clone(),
        }))?;
        self.emit_state(TerminalStatus::Idle, None)
    }

    fn mark_input_received(&mut self) -> Result<()> {
        self.attention_deadline = None;
        self.attention_detector.reset();
        if self.state.active_command.is_some() && self.state.status == TerminalStatus::NeedsInput {
            let command_id = self
                .state
                .active_command
                .as_ref()
                .map(|command| command.command_id.clone());
            self.emit_state(TerminalStatus::Running, command_id)?;
        }
        Ok(())
    }

    fn emit_state(&mut self, status: TerminalStatus, command_id: Option<String>) -> Result<()> {
        if self.state.status == status {
            return Ok(());
        }
        self.state.status = status;
        let seq = self.take_sequence();
        self.record_and_emit(StreamRecord::Metadata(MetadataEvent::State {
            seq,
            snapshot: None,
            state: status,
            command_id,
        }))
    }

    fn report_viewport(&mut self, terminal_id: &str, cols: u16, rows: u16) -> Result<()> {
        self.viewports.insert(terminal_id.to_owned(), (cols, rows));
        if self.controller_terminal_id.is_none()
            || self.controller_terminal_id.as_deref() == Some(terminal_id)
        {
            self.apply_grid(cols, rows, Some(terminal_id.to_owned()), false)?;
        }
        Ok(())
    }

    fn activate_controller(&mut self, terminal_id: &str) -> Result<()> {
        if let Some((cols, rows)) = self.viewports.get(terminal_id).copied() {
            self.apply_grid(cols, rows, Some(terminal_id.to_owned()), false)?;
        } else {
            self.apply_grid(
                self.grid_cols,
                self.grid_rows,
                Some(terminal_id.to_owned()),
                false,
            )?;
        }
        Ok(())
    }

    fn apply_grid(
        &mut self,
        cols: u16,
        rows: u16,
        controller_terminal_id: Option<String>,
        force: bool,
    ) -> Result<()> {
        let dimensions_changed = cols != self.grid_cols || rows != self.grid_rows;
        let controller_changed = controller_terminal_id != self.controller_terminal_id;
        if !force && !dimensions_changed && !controller_changed {
            return Ok(());
        }
        if dimensions_changed {
            let pty = self
                .pty
                .as_mut()
                .ok_or_else(|| anyhow!("PTY is not running"))?;
            pty.master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .context("resizing PTY")?;
        }
        self.grid_cols = cols;
        self.grid_rows = rows;
        self.controller_terminal_id = controller_terminal_id.clone();
        let seq = self.take_sequence();
        self.record_and_emit(StreamRecord::Metadata(MetadataEvent::Grid {
            seq,
            snapshot: None,
            cols,
            rows,
            controller_terminal_id,
        }))
    }

    fn send_snapshot(&mut self, request: SnapshotRequest) -> Result<()> {
        self.flush_pending_output()?;
        let records = self
            .ring
            .iter()
            .map(|(record, _)| record.clone())
            .collect::<Vec<_>>();
        for record in records {
            self.emit_record(&record, request.request_id, true)?;
        }
        write_json(
            &mut self.stdout,
            EVENT_SNAPSHOT_END,
            &SnapshotEnd {
                request_id: request.request_id,
                state: self.state.clone(),
            },
        )
    }

    fn record_and_emit(&mut self, record: StreamRecord) -> Result<()> {
        let bytes = record.byte_size();
        self.ring.push_back((record.clone(), bytes));
        self.ring_bytes += bytes;
        while self.ring_bytes > RING_BUFFER_BYTES && self.ring.len() > 1 {
            if let Some((_, dropped_bytes)) = self.ring.pop_front() {
                self.ring_bytes = self.ring_bytes.saturating_sub(dropped_bytes);
            }
        }
        self.emit_record(&record, 0, false)
    }

    fn emit_record(
        &mut self,
        record: &StreamRecord,
        request_id: u32,
        snapshot: bool,
    ) -> Result<()> {
        match record {
            StreamRecord::Output { seq, data } => {
                let payload = encode_output_payload(request_id, *seq, data)?;
                write_frame(&mut self.stdout, EVENT_OUTPUT, &payload)
            }
            StreamRecord::Metadata(event) => write_json(
                &mut self.stdout,
                EVENT_METADATA,
                &MetadataEnvelope {
                    request_id: (request_id != 0).then_some(request_id),
                    event: if snapshot {
                        event.with_snapshot()
                    } else {
                        event.clone()
                    },
                },
            ),
        }
    }

    fn take_sequence(&mut self) -> u64 {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        seq
    }

    fn write_pty(&mut self, data: &[u8]) -> Result<()> {
        if data.is_empty() {
            return Ok(());
        }
        let pty = self
            .pty
            .as_mut()
            .ok_or_else(|| anyhow!("PTY is not running"))?;
        pty.writer.write_all(data).context("writing PTY input")?;
        pty.writer.flush().context("flushing PTY input")
    }

    fn kill_pty(&mut self) {
        if let Some(pty) = self.pty.as_mut() {
            let _ = pty.killer.kill();
        }
    }

    fn emit_error(&mut self, message: &str, fatal: bool) -> Result<()> {
        write_json(
            &mut self.stdout,
            EVENT_ERROR,
            &ErrorEvent { message, fatal },
        )
    }

    fn handle_due_events(&mut self) -> Result<()> {
        let now = Instant::now();
        if self.output_deadline.is_some_and(|deadline| deadline <= now) {
            self.flush_pending_output()?;
        }
        if self
            .attention_deadline
            .is_some_and(|deadline| deadline <= now)
        {
            self.attention_deadline = None;
            if let Some(command) = self.state.active_command.as_ref() {
                let command_id = command.command_id.clone();
                self.emit_state(TerminalStatus::NeedsInput, Some(command_id))?;
            }
        }
        Ok(())
    }

    fn next_deadline(&self) -> Option<Instant> {
        match (self.output_deadline, self.attention_deadline) {
            (Some(output), Some(attention)) => Some(output.min(attention)),
            (Some(output), None) => Some(output),
            (None, Some(attention)) => Some(attention),
            (None, None) => None,
        }
    }

    fn should_finish(&self) -> bool {
        self.spawned
            && self.child_exit_code.is_some()
            && self.reader_closed
            && self.pending_output.is_empty()
    }
}

impl Drop for TerminalRuntime {
    fn drop(&mut self) {
        self.kill_pty();
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

pub fn read_requests(sender: SyncSender<RuntimeMessage>) {
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    loop {
        match crate::protocol::read_frame(&mut reader) {
            Ok(Some(frame)) => match crate::protocol::decode_request(frame) {
                Ok(request) => {
                    if sender.send(RuntimeMessage::Request(request)).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = sender.send(RuntimeMessage::ProtocolError(format!("{error:#}")));
                    return;
                }
            },
            Ok(None) => {
                let _ = sender.send(RuntimeMessage::InputClosed);
                return;
            }
            Err(error) => {
                let _ = sender.send(RuntimeMessage::ProtocolError(format!("{error:#}")));
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_snapshot_sets_snapshot_flag() {
        let event = MetadataEvent::State {
            seq: 4,
            snapshot: None,
            state: TerminalStatus::Running,
            command_id: Some("command".to_owned()),
        };
        let serialized = serde_json::to_value(event.with_snapshot()).unwrap();
        assert_eq!(serialized["snapshot"], true);
        assert_eq!(serialized["commandId"], "command");
    }

    #[test]
    fn session_state_uses_wire_compatible_names() {
        let state = SessionState {
            status: TerminalStatus::NeedsInput,
            cwd: Some("/tmp".to_owned()),
            active_command: None,
        };
        let serialized = serde_json::to_value(state).unwrap();
        assert_eq!(serialized["status"], "needs-input");
        assert_eq!(serialized["cwd"], "/tmp");
    }
}
