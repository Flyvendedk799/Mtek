//! The compile time limit of `mtek build --mode preview` (`spec/ai-and-benchmarks.md` section 5,
//! decision 0075).
//!
//! The compiler's other limits (4 MiB per file, 1 024 modules, nesting 256, 16 384 static
//! entities, the asset limits) are diagnosed by the compiler itself and apply in every mode.
//! What a limit on sizes cannot bound is time, so a preview build also runs against a clock: the
//! build runs on a thread of its own, and when [`PREVIEW_COMPILE_TIMEOUT`] passes without a
//! result the command reports `E9032` and ends. The thread is not stopped (Rust cannot stop a
//! thread); it is left behind and dies with the process, which `main` ends right away, so a
//! build that never finishes costs a thread until the command line tool exits.

use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use mtek_compiler::diagnostics::{Code, Diagnostic};

use crate::guard;

/// How long a preview build may take: 10 seconds (`spec/ai-and-benchmarks.md` section 5).
pub const PREVIEW_COMPILE_TIMEOUT: Duration = Duration::from_secs(10);

/// Why [`run_within`] returned no value.
#[derive(Debug, PartialEq, Eq)]
pub enum Interrupted {
    /// The job did not finish in time.
    TimedOut,
    /// The job panicked (or its thread could not start); the text says how.
    Failed(String),
}

/// Run `job` on a thread with the compiler's stack and wait at most `limit` for its result.
pub fn run_within<T, F>(limit: Duration, job: F) -> Result<T, Interrupted>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();
    let spawned = thread::Builder::new()
        .name("mtek-build".to_owned())
        .stack_size(guard::COMPILER_STACK_BYTES)
        .spawn(move || {
            // A receiver that gave up is gone; the result then has nowhere to go.
            let _ = sender.send(job());
        });
    if let Err(error) = spawned {
        return Err(Interrupted::Failed(format!(
            "could not start the build thread: {error}"
        )));
    }
    match receiver.recv_timeout(limit) {
        Ok(value) => Ok(value),
        Err(RecvTimeoutError::Timeout) => Err(Interrupted::TimedOut),
        // The sender was dropped without a value: the job panicked.
        Err(RecvTimeoutError::Disconnected) => Err(Interrupted::Failed(
            guard::take_last_panic().unwrap_or_else(|| "the build thread stopped".to_owned()),
        )),
    }
}

/// The `E9032` of a build that did not finish within `limit`.
pub fn timed_out(limit: Duration) -> Diagnostic {
    Diagnostic::new(
        Code::E9032,
        format!(
            "The build did not finish within the compile time limit of {} seconds and was stopped.",
            limit.as_secs()
        ),
    )
    .note("a preview build is limited in time as well as in size, so that untrusted source cannot keep the compiler busy")
    .help("split the program into smaller modules or remove what makes the compilation slow")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_job_that_finishes_returns_its_value() {
        assert_eq!(run_within(Duration::from_secs(30), || 6 * 7), Ok(42));
    }

    #[test]
    fn a_job_that_outlives_the_limit_times_out_without_waiting_for_it() {
        let started = std::time::Instant::now();
        let result = run_within(Duration::from_millis(50), || {
            thread::sleep(Duration::from_secs(20));
            1
        });
        assert_eq!(result, Err(Interrupted::TimedOut));
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "returned after {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn a_job_that_panics_is_a_failure_not_a_timeout() {
        // The panic hook is not installed here (it would silence the failures of other tests), so
        // the text is the fallback; `main` installs the hook and then the text is the panic's.
        let result = run_within(Duration::from_secs(30), || -> u32 { panic!("boom {}", 7) });
        assert!(matches!(result, Err(Interrupted::Failed(_))), "{result:?}");
    }

    #[test]
    fn the_job_has_the_compiler_stack() {
        // About 4 MiB of frames: more than the default 2 MiB of a spawned thread.
        fn deep(n: u32) -> u64 {
            let buffer = [u8::try_from(n % 251).unwrap(); 1024];
            if n == 0 {
                return 0;
            }
            std::hint::black_box(&buffer);
            u64::from(buffer[0]) + deep(n - 1)
        }
        assert!(run_within(Duration::from_secs(30), || deep(4096)).is_ok());
    }

    #[test]
    fn the_diagnostic_is_e9032_and_names_the_limit() {
        let diagnostic = timed_out(PREVIEW_COMPILE_TIMEOUT);
        assert_eq!(diagnostic.code, Code::E9032);
        assert!(
            diagnostic.message.contains("10 seconds"),
            "{}",
            diagnostic.message
        );
    }
}
