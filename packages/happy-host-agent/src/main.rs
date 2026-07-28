use std::collections::HashMap;
use std::io::{self, BufRead, Read, Write};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};

const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum Request {
    Spawn {
        file: String,
        #[serde(default)]
        args: Vec<String>,
        cwd: String,
        cols: u16,
        rows: u16,
        #[serde(default)]
        env: HashMap<String, String>,
    },
    Write {
        data: String,
    },
    Resize {
        cols: u16,
        rows: u16,
    },
    Kill,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum Event<'a> {
    Probe { protocol_version: u32, pty: bool },
    Ready { protocol_version: u32 },
    Output { data: String },
    Exit { exit_code: u32 },
    Error { message: &'a str },
}

type SharedStdout = Arc<Mutex<io::Stdout>>;

fn emit(stdout: &SharedStdout, event: &Event<'_>) -> Result<()> {
    let mut stdout = stdout.lock().map_err(|_| anyhow!("stdout lock poisoned"))?;
    serde_json::to_writer(&mut *stdout, event)?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    Ok(())
}

fn emit_error(stdout: &SharedStdout, error: &anyhow::Error) {
    let message = format!("{error:#}");
    let _ = emit(stdout, &Event::Error { message: &message });
}

struct RunningPty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

fn spawn_pty(
    stdout: &SharedStdout,
    file: String,
    args: Vec<String>,
    cwd: String,
    cols: u16,
    rows: u16,
    env: HashMap<String, String>,
) -> Result<RunningPty> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("opening native PTY")?;

    let mut command = CommandBuilder::new(file);
    command.args(args);
    command.cwd(cwd);
    for (key, value) in env {
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

    let output = Arc::clone(stdout);
    let (reader_done_tx, reader_done_rx) = mpsc::channel();
    thread::spawn(move || {
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    let data = BASE64.encode(&buffer[..length]);
                    if emit(&output, &Event::Output { data }).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    emit_error(&output, &anyhow!(error).context("reading PTY output"));
                    break;
                }
            }
        }
        let _ = reader_done_tx.send(());
    });

    let exit_output = Arc::clone(stdout);
    thread::spawn(move || {
        let exit_code = match child.wait() {
            Ok(status) => status.exit_code(),
            Err(error) => {
                emit_error(
                    &exit_output,
                    &anyhow!(error).context("waiting for PTY child"),
                );
                1
            }
        };
        // ConPTY may still have a final output chunk after the child handle is
        // signalled. Drain it before the sequenced exit event and helper exit.
        let _ = reader_done_rx.recv_timeout(Duration::from_millis(500));
        let _ = emit(&exit_output, &Event::Exit { exit_code });
        std::process::exit(0);
    });

    emit(
        stdout,
        &Event::Ready {
            protocol_version: PROTOCOL_VERSION,
        },
    )?;

    Ok(RunningPty {
        master: pair.master,
        writer,
        killer,
    })
}

fn run_pty() -> Result<()> {
    let stdout = Arc::new(Mutex::new(io::stdout()));
    let stdin = io::stdin();
    let mut running: Option<RunningPty> = None;

    for line in stdin.lock().lines() {
        let line = line.context("reading host-agent request")?;
        if line.trim().is_empty() {
            continue;
        }
        let request: Request = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                emit_error(
                    &stdout,
                    &anyhow!(error).context("decoding host-agent request"),
                );
                continue;
            }
        };

        let result = match request {
            Request::Spawn {
                file,
                args,
                cwd,
                cols,
                rows,
                env,
            } => {
                if running.is_some() {
                    Err(anyhow!("PTY already spawned"))
                } else {
                    spawn_pty(&stdout, file, args, cwd, cols, rows, env)
                        .map(|pty| running = Some(pty))
                }
            }
            Request::Write { data } => {
                let pty = running.as_mut().ok_or_else(|| anyhow!("PTY not spawned"));
                pty.and_then(|pty| {
                    let bytes = BASE64.decode(data).context("decoding PTY input")?;
                    pty.writer.write_all(&bytes).context("writing PTY input")?;
                    pty.writer.flush().context("flushing PTY input")
                })
            }
            Request::Resize { cols, rows } => {
                let pty = running.as_mut().ok_or_else(|| anyhow!("PTY not spawned"));
                pty.and_then(|pty| {
                    pty.master
                        .resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        })
                        .context("resizing PTY")
                })
            }
            Request::Kill => {
                let pty = running.as_mut().ok_or_else(|| anyhow!("PTY not spawned"));
                match pty {
                    Ok(pty) => pty.killer.kill().context("killing PTY child"),
                    Err(error) => Err(error),
                }
            }
        };

        if let Err(error) = result {
            emit_error(&stdout, &error);
        }
    }

    if let Some(mut pty) = running {
        let _ = pty.killer.kill();
    }
    Ok(())
}

fn main() {
    let result = match std::env::args().nth(1).as_deref() {
        Some("--probe") => {
            let stdout = Arc::new(Mutex::new(io::stdout()));
            emit(
                &stdout,
                &Event::Probe {
                    protocol_version: PROTOCOL_VERSION,
                    pty: true,
                },
            )
        }
        Some("pty") => run_pty(),
        _ => Err(anyhow!("usage: happy-host-agent --probe | pty")),
    };

    if let Err(error) = result {
        eprintln!("happy-host-agent: {error:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_spawn_request() {
        let request: Request = serde_json::from_str(
            r#"{"type":"spawn","file":"pwsh","args":["-NoLogo"],"cwd":"C:\\work","cols":80,"rows":24,"env":{"TERM":"xterm-256color"}}"#,
        )
        .expect("spawn request should decode");

        match request {
            Request::Spawn {
                file,
                args,
                cols,
                rows,
                env,
                ..
            } => {
                assert_eq!(file, "pwsh");
                assert_eq!(args, ["-NoLogo"]);
                assert_eq!((cols, rows), (80, 24));
                assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
            }
            _ => panic!("unexpected request variant"),
        }
    }

    #[test]
    fn preserves_arbitrary_pty_bytes_in_base64() {
        let bytes = [0, 0x1b, 0xff, b'\n'];
        let encoded = BASE64.encode(bytes);
        assert_eq!(BASE64.decode(encoded).expect("base64 should decode"), bytes);
    }

    #[test]
    fn probe_reports_the_supported_protocol() {
        let value = serde_json::to_value(Event::Probe {
            protocol_version: PROTOCOL_VERSION,
            pty: true,
        })
        .expect("probe should encode");

        assert_eq!(value["type"], "probe");
        assert_eq!(value["protocol_version"], PROTOCOL_VERSION);
        assert_eq!(value["pty"], true);
    }
}
