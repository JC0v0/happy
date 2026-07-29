mod protocol;
mod runtime;
mod shell;
mod theme;

use std::sync::mpsc::sync_channel;
use std::thread;

use anyhow::{Result, anyhow};
use protocol::{PROTOCOL_VERSION, ProbeResponse};
use runtime::{TerminalRuntime, read_requests};

const EVENT_QUEUE_CAPACITY: usize = 256;

fn run_terminal() -> Result<()> {
    // A bounded channel is the local backpressure boundary. If TypeScript stops
    // reading, stdout blocks, the event loop stops draining this queue, and the
    // PTY reader eventually blocks instead of growing memory without limit.
    let (sender, receiver) = sync_channel(EVENT_QUEUE_CAPACITY);
    let input_sender = sender.clone();
    thread::spawn(move || read_requests(input_sender));
    TerminalRuntime::new(sender).run(receiver)
}

fn main() {
    let result = match std::env::args().nth(1).as_deref() {
        Some("--probe") => {
            let probe = ProbeResponse {
                r#type: "probe",
                protocol_version: PROTOCOL_VERSION,
                pty: true,
                framing: "length-prefixed-binary",
                authoritative_state: true,
            };
            serde_json::to_writer(std::io::stdout(), &probe).map_err(Into::into)
        }
        Some("terminal") => run_terminal(),
        _ => Err(anyhow!("usage: happy-host-agent --probe | terminal")),
    };

    if let Err(error) = result {
        eprintln!("happy-host-agent: {error:#}");
        std::process::exit(1);
    }
}
