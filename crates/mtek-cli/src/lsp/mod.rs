//! `mtek lsp`: the language server (`spec/tooling.md` section 7, decision 0076).
//!
//! Launch: `mtek lsp` speaks the Language Server Protocol over standard input and output
//! (`Content-Length` framed JSON-RPC 2.0); `--stdio` is accepted and means the same. It reads
//! nothing but the protocol from stdin, writes nothing but the protocol to stdout and logs to
//! stderr. Exit code 0 after `shutdown` and `exit`, 1 if the client ends without them.
//!
//! The pieces:
//!
//! * [`transport`]: framing, bounded and tolerant of garbage;
//! * [`server`]: the state machine (documents, projects, debounce, request handlers);
//! * [`analysis`], [`semantic`], [`hover`], [`definition`], [`completion`], [`convert`]: the
//!   features, all read from what the compiler's front end produced;
//! * [`prelude_doc`]: the standard library as hover text and virtual documents;
//! * [`position`], [`uri`], [`overlay`], [`clock`]: positions, URIs, unsaved buffers over the
//!   files on disk, and the clock the debounce uses.

mod analysis;
mod clock;
mod completion;
mod convert;
mod definition;
mod hover;
mod overlay;
mod position;
mod prelude_doc;
mod semantic;
mod server;
mod transport;
mod uri;

#[cfg(test)]
mod completion_tests;
#[cfg(test)]
mod feature_tests;
#[cfg(test)]
mod testkit;

use std::io::{BufRead, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use clock::{Clock, SystemClock};
use server::Server;
use transport::{Inbound, write_outbound};

/// Run the server on standard input and output until the session ends; the process exit code.
pub fn run() -> u8 {
    let served = thread::Builder::new()
        .name("mtek-lsp".to_owned())
        .stack_size(crate::guard::COMPILER_STACK_BYTES)
        .spawn(|| {
            serve(
                std::io::BufReader::new(std::io::stdin()),
                std::io::stdout().lock(),
                Box::new(SystemClock::new()),
            )
        });
    match served.map(thread::JoinHandle::join) {
        Ok(Ok(code)) => code,
        Ok(Err(_)) | Err(_) => {
            eprintln!("mtek lsp: the server stopped because of an internal error");
            crate::commands::EXIT_INTERNAL
        }
    }
}

/// The session loop: read what arrives, handle everything that is waiting, publish what is due,
/// write the answers, until the server has an exit code.
pub fn serve(
    input: impl BufRead + Send + 'static,
    mut output: impl Write,
    clock: Box<dyn Clock>,
) -> u8 {
    let (sender, receiver) = mpsc::channel();
    // The reading thread ends with the input, at `exit` or when the receiver is gone; if the
    // process ends first the operating system takes it down with the process.
    let reader = thread::Builder::new()
        .name("mtek-lsp-reader".to_owned())
        .spawn(move || transport::pump(input, &sender));
    if reader.is_err() {
        eprintln!("mtek lsp: could not start the reading thread");
        return 1;
    }
    let mut server = Server::new(clock);
    loop {
        let received = match server.millis_until_due() {
            Some(ms) => receiver.recv_timeout(Duration::from_millis(ms)),
            None => receiver.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match received {
            Ok(inbound) => {
                server.handle(inbound);
                // Everything that is already waiting is handled before anything is analysed, so
                // a burst of opens or changes costs one analysis.
                while server.exit_code().is_none() {
                    match receiver.try_recv() {
                        Ok(more) => server.handle(more),
                        Err(_) => break,
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => server.handle(Inbound::Closed { reason: None }),
        }
        if server.exit_code().is_none() {
            server.poll();
        }
        for outbound in server.take_outgoing() {
            if write_outbound(&mut output, &outbound).is_err() {
                // The client is gone; nobody is left to tell.
                return server.exit_code().unwrap_or(1);
            }
        }
        if let Some(code) = server.exit_code() {
            return code;
        }
    }
}
