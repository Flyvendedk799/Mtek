//! The `mtek` command line tool (milestone M0: `--version` only).

// The replace-on-success writer of `mtek build`; the command itself arrives with M1-19.
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "called by `mtek build` (M1-19)")
)]
mod dist;

use std::io::Write;
use std::process::ExitCode;

use mtek_compiler::{COMPILER_VERSION, LANGUAGE_VERSION, RUNTIME_ABI};

/// Exit code for a usage error (bad arguments), see `spec/tooling.md` section 1.
const EXIT_USAGE: u8 = 2;
/// Exit code for an I/O failure, see `spec/tooling.md` section 1.
const EXIT_IO: u8 = 3;

/// The single line printed by `mtek --version`.
fn version_line() -> String {
    format!("mtek {COMPILER_VERSION} (language {LANGUAGE_VERSION}, runtime ABI {RUNTIME_ABI})")
}

/// The usage text printed for any invocation other than `--version`.
fn usage() -> &'static str {
    "usage: mtek --version\n"
}

/// What the program was asked to do.
#[derive(Debug, PartialEq, Eq)]
enum Command {
    Version,
    Usage,
}

/// Interpret the arguments after the program name.
fn parse_args<I: IntoIterator<Item = String>>(args: I) -> Command {
    let mut args = args.into_iter();
    match (args.next().as_deref(), args.next()) {
        (Some("--version"), None) => Command::Version,
        _ => Command::Usage,
    }
}

fn main() -> ExitCode {
    match parse_args(std::env::args().skip(1)) {
        Command::Version => {
            if writeln!(std::io::stdout(), "{}", version_line()).is_err() {
                return ExitCode::from(EXIT_IO);
            }
            ExitCode::SUCCESS
        }
        Command::Usage => {
            // A failed write to stderr cannot be reported anywhere else; the exit code stays 2.
            let _ = std::io::stderr().write_all(usage().as_bytes());
            ExitCode::from(EXIT_USAGE)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn version_flag_is_recognised() {
        assert_eq!(parse_args(args(&["--version"])), Command::Version);
    }

    #[test]
    fn anything_else_is_usage() {
        assert_eq!(parse_args(args(&[])), Command::Usage);
        assert_eq!(parse_args(args(&["--version", "x"])), Command::Usage);
        assert_eq!(parse_args(args(&["check"])), Command::Usage);
    }

    #[test]
    fn version_line_is_exact() {
        assert_eq!(
            version_line(),
            "mtek 0.1.0-dev (language 0.1, runtime ABI 1)"
        );
    }
}
