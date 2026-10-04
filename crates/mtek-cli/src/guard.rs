//! Running the compiler safely (`spec/compiler-architecture.md` section 3): on a dedicated
//! thread with a 16 MiB stack (the Windows main thread has 1 MiB), inside `catch_unwind`, so a
//! compiler defect becomes `E9999` and exit code 3 instead of a crash.

use std::any::Any;
use std::panic::{self, AssertUnwindSafe};
use std::sync::Mutex;
use std::thread;

/// The stack size of the compiler thread.
pub const COMPILER_STACK_BYTES: usize = 16 * 1024 * 1024;

/// The text of the last panic, recorded by the hook of [`install_panic_hook`].
static LAST_PANIC: Mutex<Option<String>> = Mutex::new(None);

/// Replace the default panic hook, which would print to stderr (and break `--format json`'s
/// promise of nothing but the report), by one that records the message and location for the
/// `E9999` note.
pub fn install_panic_hook() {
    panic::set_hook(Box::new(|info| {
        if let Ok(mut slot) = LAST_PANIC.lock() {
            *slot = Some(info.to_string());
        }
    }));
}

/// The message of a panic payload.
fn payload_text(payload: &(dyn Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        (*text).to_owned()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "a panic without a message".to_owned()
    }
}

/// Run `job` on the compiler thread. `Err` carries a description of the panic (or of the
/// failure to start the thread).
pub fn run_guarded<T, F>(job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let handle = thread::Builder::new()
        .name("mtek-compiler".to_owned())
        .stack_size(COMPILER_STACK_BYTES)
        .spawn(move || panic::catch_unwind(AssertUnwindSafe(job)));
    let handle = match handle {
        Ok(handle) => handle,
        Err(error) => return Err(format!("could not start the compiler thread: {error}")),
    };
    let payload = match handle.join() {
        Ok(Ok(value)) => return Ok(value),
        Ok(Err(payload)) | Err(payload) => payload,
    };
    let recorded = LAST_PANIC.lock().ok().and_then(|mut slot| slot.take());
    Err(recorded.unwrap_or_else(|| payload_text(payload.as_ref())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_value_is_returned() {
        assert_eq!(run_guarded(|| 6 * 7), Ok(42));
    }

    #[test]
    fn a_panic_is_caught_with_its_message() {
        let error = run_guarded(|| -> u32 { panic!("boom {}", 7) }).unwrap_err();
        assert!(error.contains("boom 7"), "{error}");
        let error = run_guarded(|| -> u32 { std::panic::panic_any(5_u8) }).unwrap_err();
        assert!(!error.is_empty());
    }

    #[test]
    fn the_thread_has_the_large_stack() {
        // About 4 MiB of frames: more than the 1 MiB of a Windows main thread or the 2 MiB
        // default of spawned threads, well inside 16 MiB.
        fn deep(n: u32) -> u64 {
            let buffer = [u8::try_from(n % 251).unwrap(); 1024];
            if n == 0 {
                return 0;
            }
            std::hint::black_box(&buffer);
            u64::from(buffer[0]) + deep(n - 1)
        }
        assert!(run_guarded(|| deep(4096)).is_ok());
    }
}
