//! `grammar-adapter`: the capability check of the pinned grammar-constrained
//! backend (decision 0073), for the harness (M6-07) and for people.
//!
//! ```text
//! grammar-adapter check [--install-dir DIR] [--format human|json]
//! ```
//!
//! Exit status 0: available (the JSON report has `"status": "available"`).
//! Exit status 1: unavailable; the message starts with "grammar-constrained
//! mode unavailable" and names the reason. Exit status 2: bad arguments.

use std::path::PathBuf;
use std::process::ExitCode;

use mtek_grammar_adapters::{check_capability, default_install_dir};

const USAGE: &str = "usage: grammar-adapter check [--install-dir DIR] [--format human|json]\n";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut dir: Option<PathBuf> = None;
    let mut json = false;
    let mut iter = args.iter();
    match iter.next().map(String::as_str) {
        Some("check") => {}
        Some("--help" | "-h") => {
            print!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        _ => {
            eprint!("{USAGE}");
            return ExitCode::from(2);
        }
    }
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--install-dir" => match iter.next() {
                Some(value) => dir = Some(PathBuf::from(value)),
                None => {
                    eprint!("error: --install-dir needs a directory\n{USAGE}");
                    return ExitCode::from(2);
                }
            },
            "--format" => match iter.next().map(String::as_str) {
                Some("json") => json = true,
                Some("human") => json = false,
                _ => {
                    eprint!("error: --format is human or json\n{USAGE}");
                    return ExitCode::from(2);
                }
            },
            other => {
                eprint!("error: unexpected argument {other:?}\n{USAGE}");
                return ExitCode::from(2);
            }
        }
    }
    let dir = dir.unwrap_or_else(default_install_dir);
    match check_capability(&dir) {
        Ok(capability) => {
            if json {
                println!("{}", capability.to_json());
            } else {
                println!(
                    "grammar-constrained mode available: {} {} (commit {}), model {} (revision {}), validator {}",
                    capability.backend,
                    capability.release,
                    &capability.commit[..capability.commit.len().min(8)],
                    capability.model_id,
                    &capability.model_revision[..capability.model_revision.len().min(8)],
                    capability.validator.display()
                );
            }
            ExitCode::SUCCESS
        }
        Err(unavailable) => {
            if json {
                println!("{}", unavailable.to_json());
            } else {
                eprintln!("{unavailable}");
            }
            ExitCode::from(1)
        }
    }
}
