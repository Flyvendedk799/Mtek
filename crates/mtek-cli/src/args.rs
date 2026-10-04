//! Command line arguments (`spec/tooling.md` section 1), parsed with `clap`.
//!
//! [`parse`] turns the arguments into a [`Request`] or a [`UsageError`] (exit code 2). Commands
//! and options that the specification names but this build does not implement yet (`mtek new`,
//! `--mode preview`, `mtek fmt`, …) are usage errors that say so, rather than clap's
//! generic "unrecognized subcommand".

use std::ffi::OsString;
use std::path::PathBuf;

use clap::error::ErrorKind;
use clap::{Args, CommandFactory, Parser, Subcommand, ValueEnum};
use mtek_compiler::BuildMode;

/// The output format of `--format`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum Format {
    /// Human-readable diagnostics on stderr.
    #[default]
    Human,
    /// Exactly one JSON document on stdout.
    Json,
}

/// `--target`: only `web` in v0.1.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
enum Target {
    /// A WebGPU page and its program (`spec/runtime-abi.md` section 2).
    #[default]
    Web,
}

/// `--mode` (`spec/tooling.md` section 2).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
enum Mode {
    /// No overlay, no reload client.
    #[default]
    Release,
    /// The reload client and development diagnostics.
    Dev,
    /// For browser tests: `index.html` exposes `window.__mtekMount(options)`.
    Test,
    /// Untrusted previews (milestone M6).
    Preview,
}

/// The arguments after a command that this build does not implement yet; accepted so that
/// the error names the command instead of complaining about its arguments.
#[derive(Args, Debug)]
struct Unimplemented {
    #[arg(
        trailing_var_arg = true,
        allow_hyphen_values = true,
        num_args = 0..,
        hide = true
    )]
    rest: Vec<OsString>,
}

/// What `mtek inspect` shows: exactly one of the flags.
#[derive(Args, Debug)]
#[group(required = true, multiple = false)]
struct InspectWhat {
    /// The typed intermediate representation
    #[arg(long)]
    ir: bool,
    /// The GPU binding layout: blocks, slots and material instances
    #[arg(long)]
    bindings: bool,
    /// The generated WGSL of every material, with its span map
    #[arg(long)]
    shaders: bool,
}

#[derive(Parser, Debug)]
#[command(
    name = "mtek",
    bin_name = "mtek",
    about = "The Mtek compiler and tools.",
    override_usage = "mtek <COMMAND> [OPTIONS] [PATH]\n       mtek --version",
    disable_version_flag = true,
    disable_help_subcommand = true,
    args_conflicts_with_subcommands = true
)]
struct Cli {
    /// Print the version
    #[arg(long)]
    version: bool,

    #[command(subcommand)]
    command: Option<CliCommand>,
}

#[derive(Subcommand, Debug)]
enum CliCommand {
    /// Parse and type-check a project (no GPU needed)
    Check {
        /// Output format
        #[arg(long, value_enum, default_value_t)]
        format: Format,
        /// The project directory or a directory inside it [default: the current directory]
        path: Option<PathBuf>,
    },
    /// Build a project into its output directory
    Build {
        /// The build target
        #[arg(long, value_enum, default_value_t)]
        target: Target,
        /// The build mode
        #[arg(long, value_enum, default_value_t)]
        mode: Mode,
        /// The output directory [default: `build.out_dir` of mtek.toml]
        #[arg(long, value_name = "DIR")]
        out: Option<PathBuf>,
        /// Output format
        #[arg(long, value_enum, default_value_t)]
        format: Format,
        /// The project directory or a directory inside it [default: the current directory]
        path: Option<PathBuf>,
    },
    /// Show what the compiler made of a project
    Inspect {
        #[command(flatten)]
        what: InspectWhat,
        /// Output format
        #[arg(long, value_enum, default_value_t)]
        format: Format,
        /// The project directory or a directory inside it [default: the current directory]
        path: Option<PathBuf>,
    },
    /// Build, serve and rebuild a project on every change (development server)
    Dev {
        /// The port on 127.0.0.1 [default: `dev.port` of mtek.toml]; if it is taken, the next free port is used
        #[arg(long, value_name = "N", value_parser = clap::value_parser!(u16).range(1..))]
        port: Option<u16>,
        /// Open the page in the default browser after the first build
        #[arg(long)]
        open: bool,
        /// The project directory or a directory inside it [default: the current directory]
        path: Option<PathBuf>,
    },
    #[command(hide = true)]
    New(Unimplemented),
    #[command(hide = true)]
    Fmt(Unimplemented),
    #[command(hide = true)]
    Test(Unimplemented),
    #[command(hide = true)]
    Context(Unimplemented),
    #[command(hide = true)]
    Grammar(Unimplemented),
    #[command(hide = true)]
    Lsp(Unimplemented),
}

/// A command to run.
#[derive(Debug, PartialEq, Eq)]
pub enum Request {
    /// `mtek --version`.
    Version,
    /// `--help` of the tool or of a command: the text for stdout.
    Help(String),
    /// `mtek check`.
    Check {
        format: Format,
        path: Option<PathBuf>,
    },
    /// `mtek build --target web`.
    Build {
        mode: BuildMode,
        out: Option<PathBuf>,
        format: Format,
        path: Option<PathBuf>,
    },
    /// `mtek inspect --ir`, `--shaders` or `--bindings`.
    Inspect {
        view: mtek_compiler::Inspect,
        format: Format,
        path: Option<PathBuf>,
    },
    /// `mtek dev`: `port` overrides `dev.port` of `mtek.toml`.
    Dev {
        port: Option<u16>,
        open: bool,
        path: Option<PathBuf>,
    },
}

impl Request {
    /// The `--format` of the request (human for `--version` and `--help`).
    pub fn format(&self) -> Format {
        match self {
            Request::Version | Request::Help(_) | Request::Dev { .. } => Format::Human,
            Request::Check { format, .. }
            | Request::Build { format, .. }
            | Request::Inspect { format, .. } => *format,
        }
    }

    /// The command name, for the human failure line ("check failed: …").
    pub fn verb(&self) -> &'static str {
        match self {
            Request::Version | Request::Help(_) => "mtek",
            Request::Check { .. } => "check",
            Request::Build { .. } => "build",
            Request::Inspect { .. } => "inspect",
            Request::Dev { .. } => "dev",
        }
    }
}

/// Bad arguments: the text for stderr; the exit code is 2.
#[derive(Debug, PartialEq, Eq)]
pub struct UsageError(pub String);

/// The error for a command or option that a later milestone implements.
fn not_yet(what: &str, milestone: &str) -> UsageError {
    UsageError(format!(
        "error: '{what}' is specified (milestone {milestone}) but not implemented by this build yet\n"
    ))
}

/// Interpret the arguments, including the program name.
pub fn parse<I, T>(args: I) -> Result<Request, UsageError>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(error) => {
            let text = error.render().to_string();
            return match error.kind() {
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion => Ok(Request::Help(text)),
                _ => Err(UsageError(text)),
            };
        }
    };
    let command = match (cli.version, cli.command) {
        (true, None) => return Ok(Request::Version),
        // `args_conflicts_with_subcommands` already rejects `--version` with a command.
        (_, Some(command)) => command,
        (false, None) => {
            let usage = Cli::command().render_usage();
            return Err(UsageError(format!(
                "error: no command given\n\n{usage}\n\nFor more information, try '--help'.\n"
            )));
        }
    };
    match command {
        CliCommand::Check { format, path } => Ok(Request::Check { format, path }),
        CliCommand::Build {
            target: Target::Web,
            mode,
            out,
            format,
            path,
        } => {
            let mode = match mode {
                Mode::Release => BuildMode::Release,
                Mode::Dev => BuildMode::Dev,
                Mode::Test => BuildMode::Test,
                Mode::Preview => return Err(not_yet("mtek build --mode preview", "M6")),
            };
            if let Some(dir) = &out
                && dir.file_name().is_none()
            {
                return Err(UsageError(format!(
                    "error: '--out {}' must name a directory that the build can replace, not '.', '..' or a root\n",
                    dir.display()
                )));
            }
            Ok(Request::Build {
                mode,
                out,
                format,
                path,
            })
        }
        CliCommand::Inspect { what, format, path } => {
            let view = if what.bindings {
                mtek_compiler::Inspect::Bindings
            } else if what.shaders {
                mtek_compiler::Inspect::Shaders
            } else {
                mtek_compiler::Inspect::Ir
            };
            Ok(Request::Inspect { view, format, path })
        }
        CliCommand::Dev { port, open, path } => Ok(Request::Dev { port, open, path }),
        CliCommand::New(_) => Err(not_yet("mtek new", "M3")),
        CliCommand::Fmt(_) => Err(not_yet("mtek fmt", "M6")),
        CliCommand::Test(_) => Err(not_yet("mtek test", "M6")),
        CliCommand::Context(_) => Err(not_yet("mtek context", "M6")),
        CliCommand::Grammar(_) => Err(not_yet("mtek grammar", "M6")),
        CliCommand::Lsp(_) => Err(not_yet("mtek lsp", "M6")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_args(items: &[&str]) -> Result<Request, UsageError> {
        parse(std::iter::once("mtek").chain(items.iter().copied()))
    }

    fn usage(items: &[&str]) -> String {
        match parse_args(items) {
            Err(UsageError(text)) => text,
            Ok(request) => panic!("{items:?} parsed as {request:?}"),
        }
    }

    #[test]
    fn version() {
        assert_eq!(parse_args(&["--version"]), Ok(Request::Version));
        usage(&["--version", "extra"]);
        usage(&["--version", "check"]);
        usage(&["check", "--version"]);
    }

    #[test]
    fn check_defaults_and_options() {
        assert_eq!(
            parse_args(&["check"]),
            Ok(Request::Check {
                format: Format::Human,
                path: None
            })
        );
        assert_eq!(
            parse_args(&["check", "--format", "json", "some/dir"]),
            Ok(Request::Check {
                format: Format::Json,
                path: Some(PathBuf::from("some/dir"))
            })
        );
        assert!(usage(&["check", "--format", "yaml"]).contains("yaml"));
        usage(&["check", "a", "b"]);
    }

    #[test]
    fn build_defaults_and_options() {
        assert_eq!(
            parse_args(&["build"]),
            Ok(Request::Build {
                mode: BuildMode::Release,
                out: None,
                format: Format::Human,
                path: None
            })
        );
        assert_eq!(
            parse_args(&[
                "build", "--target", "web", "--mode", "test", "--out", "out/x", "--format", "json",
                "proj"
            ]),
            Ok(Request::Build {
                mode: BuildMode::Test,
                out: Some(PathBuf::from("out/x")),
                format: Format::Json,
                path: Some(PathBuf::from("proj"))
            })
        );
        assert_eq!(
            parse_args(&["build", "--mode", "dev"]).map(|r| r.format()),
            Ok(Format::Human)
        );
        assert!(usage(&["build", "--target", "native"]).contains("native"));
        assert!(usage(&["build", "--mode", "preview"]).contains("M6"));
        assert!(usage(&["build", "--out", "."]).contains("--out ."));
        usage(&["build", "--out", ".."]);
        usage(&["build", "--out", ""]);
    }

    #[test]
    fn inspect_needs_exactly_one_view() {
        assert_eq!(
            parse_args(&["inspect", "--ir", "--format", "json"]),
            Ok(Request::Inspect {
                view: mtek_compiler::Inspect::Ir,
                format: Format::Json,
                path: None
            })
        );
        assert_eq!(
            parse_args(&["inspect", "--shaders"]),
            Ok(Request::Inspect {
                view: mtek_compiler::Inspect::Shaders,
                format: Format::Human,
                path: None
            })
        );
        assert_eq!(
            parse_args(&["inspect", "--bindings", "--format", "json", "game"]),
            Ok(Request::Inspect {
                view: mtek_compiler::Inspect::Bindings,
                format: Format::Json,
                path: Some(PathBuf::from("game"))
            })
        );
        usage(&["inspect"]);
        usage(&["inspect", "--ir", "--shaders"]);
        usage(&["inspect", "--bindings", "--shaders"]);
    }

    #[test]
    fn dev_defaults_and_options() {
        assert_eq!(
            parse_args(&["dev"]),
            Ok(Request::Dev {
                port: None,
                open: false,
                path: None
            })
        );
        let request = parse_args(&["dev", "--port", "8080", "--open", "proj"]);
        assert_eq!(
            request,
            Ok(Request::Dev {
                port: Some(8080),
                open: true,
                path: Some(PathBuf::from("proj"))
            })
        );
        assert_eq!(
            request.map(|r| (r.format(), r.verb())),
            Ok((Format::Human, "dev"))
        );
        assert!(usage(&["dev", "--port", "0"]).contains("--port"));
        assert!(usage(&["dev", "--port", "65536"]).contains("--port"));
        assert!(usage(&["dev", "--port", "x"]).contains("--port"));
        usage(&["dev", "--format", "json"]);
        usage(&["dev", "--host", "0.0.0.0"]);
        usage(&["dev", "a", "b"]);
    }

    #[test]
    fn later_commands_are_named_in_the_error() {
        for (command, milestone) in [
            ("new", "M3"),
            ("fmt", "M6"),
            ("test", "M6"),
            ("context", "M6"),
            ("grammar", "M6"),
            ("lsp", "M6"),
        ] {
            let text = usage(&[command, "--port", "1", "x"]);
            assert!(
                text.contains(&format!("'mtek {command}'")) && text.contains(milestone),
                "{text}"
            );
        }
    }

    #[test]
    fn nothing_or_nonsense_is_a_usage_error() {
        assert!(usage(&[]).starts_with("error: no command given"));
        assert!(usage(&["chek"]).contains("check"), "suggests the command");
        usage(&["--nope"]);
    }

    #[test]
    fn help_goes_to_stdout() {
        for args in [&["--help"][..], &["check", "--help"], &["build", "-h"]] {
            match parse_args(args) {
                Ok(Request::Help(text)) => assert!(text.contains("Usage: mtek"), "{text}"),
                other => panic!("{args:?}: {other:?}"),
            }
        }
        match parse_args(&["--help"]) {
            Ok(Request::Help(text)) => {
                assert!(text.contains("check") && text.contains("inspect"));
                assert!(text.contains("dev"), "{text}");
                assert!(!text.contains("lsp"), "unimplemented commands are hidden");
            }
            other => panic!("{other:?}"),
        }
    }
}
