//! The `mtek` command line tool (`spec/tooling.md` section 1).
//!
//! `main` parses the arguments (usage errors exit with 2), runs the command on the compiler
//! thread inside the panic guard ([`guard`]), and writes the outcome: stdout first, then
//! stderr, then the exit code.

mod args;
mod commands;
mod dev;
mod dist;
mod guard;
mod real_fs;
mod runtime;

use std::io::{IsTerminal, Write};
use std::process::ExitCode;

use mtek_compiler::{COMPILER_VERSION, LANGUAGE_VERSION, RUNTIME_ABI};

use args::{Request, UsageError};
use commands::{Context, EXIT_INTERNAL, EXIT_USAGE, Outcome};

/// The single line printed by `mtek --version`.
fn version_line() -> String {
    format!("mtek {COMPILER_VERSION} (language {LANGUAGE_VERSION}, runtime ABI {RUNTIME_ABI})")
}

/// Run a parsed request.
fn run(request: Request) -> Outcome {
    match request {
        Request::Version => Outcome::stdout(format!("{}\n", version_line())),
        Request::Help(text) => Outcome::stdout(text),
        request => {
            guard::install_panic_hook();
            let color = commands::color_enabled(
                std::io::stderr().is_terminal(),
                std::env::var_os("NO_COLOR").as_deref(),
            );
            let context = Context {
                // Without a working directory, relative paths are tried as they are.
                cwd: std::env::current_dir().unwrap_or_default(),
                color,
                runtime: runtime::embedded(),
            };
            if let Request::Dev { port, open, path } = request {
                // Long-running: it prints as it goes and guards each build on its own.
                return Outcome {
                    code: dev::run(port, open, path.as_deref(), context),
                    ..Outcome::default()
                };
            }
            let (format, verb) = (request.format(), request.verb());
            match guard::run_guarded(move || commands::execute(&request, &context)) {
                Ok(outcome) => outcome,
                Err(panic) => commands::internal_error(verb, format, color, &panic),
            }
        }
    }
}

fn main() -> ExitCode {
    let outcome = match args::parse(std::env::args_os()) {
        Ok(request) => run(request),
        Err(UsageError(text)) => Outcome {
            stdout: String::new(),
            stderr: text,
            code: EXIT_USAGE,
        },
    };
    let mut stdout = std::io::stdout().lock();
    if stdout
        .write_all(outcome.stdout.as_bytes())
        .and_then(|()| stdout.flush())
        .is_err()
    {
        return ExitCode::from(EXIT_INTERNAL);
    }
    // A failed write to stderr cannot be reported anywhere else; the exit code stands.
    let _ = std::io::stderr().write_all(outcome.stderr.as_bytes());
    ExitCode::from(outcome.code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_line_is_exact() {
        assert_eq!(
            version_line(),
            "mtek 0.1.0-dev (language 0.1, runtime ABI 1)"
        );
    }
}
