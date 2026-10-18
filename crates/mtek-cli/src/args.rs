//! Command line arguments (`spec/tooling.md` section 1), parsed with `clap`.
//!
//! [`parse`] turns the arguments into a [`Request`] or a [`UsageError`] (exit code 2). Commands
//! and options that the specification names but this build does not implement yet (`mtek grammar`,
//! `mtek lsp`, …) are usage errors that say so, rather than clap's
//! generic "unrecognized subcommand".

use std::ffi::OsString;
use std::path::PathBuf;

use clap::error::ErrorKind;
use clap::{Args, CommandFactory, Parser, Subcommand, ValueEnum};
use mtek_compiler::BuildMode;
use mtek_compiler::context::DEFAULT_MAX_BYTES;

use crate::test_cmd::TestArgs;

/// The output format of `--format`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum Format {
    /// Human-readable diagnostics on stderr.
    #[default]
    Human,
    /// Exactly one JSON document on stdout.
    Json,
}

/// The output format of `mtek context`: JSON only.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
enum ContextFormat {
    /// One JSON document on stdout (`spec/ai-and-benchmarks.md` section 2).
    #[default]
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
    /// Untrusted previews: loop budgets, no network outside `baseUrl`, external bootstrap, CSP.
    Preview,
}

/// What `mtek lsp` accepts: only the conventional `--stdio`.
#[derive(Args, Debug)]
struct LspArgs {
    /// Speak the protocol over standard input and output (the only transport; accepted for
    /// clients that always pass it)
    #[arg(long)]
    stdio: bool,
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
    /// The packaged assets: files, hashes, preprocessing and the meshes that use them
    #[arg(long)]
    assets: bool,
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
        /// `--mode preview` only: iterations of CPU loops allowed per frame [default: 10000000]
        #[arg(long, value_name = "N", value_parser = clap::value_parser!(u32).range(1..))]
        loop_budget: Option<u32>,
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
    /// Scaffold a project from the built-in Demo template
    New {
        /// Project name (`[a-z0-9-]+`); also the directory created in the working directory
        name: String,
    },
    /// Format Mtek files canonically (in place, or only check them)
    Fmt {
        /// Do not write: list the files that are not formatted and exit with 1 if there are any
        #[arg(long)]
        check: bool,
        /// Files, or directories searched for `.mtek` files [default: the current directory]
        paths: Vec<PathBuf>,
    },
    /// Run the declarative test fixtures (`tests/*.test.toml`) of a project in a browser
    Test(TestArgs),
    /// Export a versioned language and project context for AI agents (JSON)
    Context {
        /// The entry module of the project; the project is the nearest directory above it with
        /// an mtek.toml, and the file must be its `project.entry`
        #[arg(long, value_name = "FILE")]
        entry: PathBuf,
        /// A declaration to focus on, such as Demo.Cube (repeatable); without one, the entry scene
        #[arg(long = "symbol", value_name = "NAME", num_args = 1..)]
        symbols: Vec<String>,
        /// The most bytes the output may have; the lowest-priority parts are left out to fit
        #[arg(long, value_name = "N", default_value_t = DEFAULT_MAX_BYTES, value_parser = clap::value_parser!(usize))]
        max_bytes: usize,
        /// Output format
        #[arg(long, value_enum, default_value_t)]
        format: ContextFormat,
    },
    /// Print the grammar of the language (EBNF or GBNF)
    Grammar(crate::grammar::GrammarArgs),
    /// Run the language server: the Language Server Protocol over standard input and output
    Lsp(LspArgs),
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
        /// `--loop-budget`: only with `BuildMode::Preview`.
        loop_budget: Option<u32>,
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
    /// `mtek new NAME`.
    New { name: String },
    /// `mtek fmt [--check] [PATHS…]`.
    Fmt { check: bool, paths: Vec<PathBuf> },
    /// `mtek context --entry FILE`.
    Context {
        entry: PathBuf,
        symbols: Vec<String>,
        max_bytes: usize,
    },
    /// `mtek test`.
    Test(TestArgs),
    /// `mtek grammar …` (`crate::grammar`).
    Grammar(crate::grammar::GrammarArgs),
    /// `mtek lsp`.
    Lsp,
}

impl Request {
    /// The `--format` of the request (human for `--version` and `--help`).
    pub fn format(&self) -> Format {
        match self {
            Request::Version
            | Request::Help(_)
            | Request::Dev { .. }
            | Request::New { .. }
            | Request::Fmt { .. }
            | Request::Grammar(_)
            | Request::Lsp => Format::Human,
            Request::Context { .. } => Format::Json,
            Request::Check { format, .. }
            | Request::Build { format, .. }
            | Request::Inspect { format, .. } => *format,
            Request::Test(args) => args.format,
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
            Request::New { .. } => "new",
            Request::Context { .. } => "context",
            Request::Test(_) => "test",
            Request::Fmt { .. } => "fmt",
            Request::Grammar(_) => "grammar",
            Request::Lsp => "lsp",
        }
    }
}

/// Bad arguments: the text for stderr; the exit code is 2.
#[derive(Debug, PartialEq, Eq)]
pub struct UsageError(pub String);

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
            loop_budget,
            format,
            path,
        } => {
            let mode = match mode {
                Mode::Release => BuildMode::Release,
                Mode::Dev => BuildMode::Dev,
                Mode::Test => BuildMode::Test,
                Mode::Preview => BuildMode::Preview,
            };
            if loop_budget.is_some() && mode != BuildMode::Preview {
                return Err(UsageError(
                    "error: '--loop-budget' applies to '--mode preview' only\n".to_owned(),
                ));
            }
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
                loop_budget,
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
            } else if what.assets {
                mtek_compiler::Inspect::Assets
            } else {
                mtek_compiler::Inspect::Ir
            };
            Ok(Request::Inspect { view, format, path })
        }
        CliCommand::Dev { port, open, path } => Ok(Request::Dev { port, open, path }),
        CliCommand::New { name } => Ok(Request::New { name }),
        CliCommand::Fmt { check, paths } => Ok(Request::Fmt { check, paths }),
        CliCommand::Test(args) => Ok(Request::Test(args)),
        CliCommand::Context {
            entry,
            symbols,
            max_bytes,
            format: ContextFormat::Json,
        } => Ok(Request::Context {
            entry,
            symbols,
            max_bytes,
        }),
        CliCommand::Grammar(args) => Ok(Request::Grammar(args)),
        CliCommand::Lsp(LspArgs { stdio: _ }) => Ok(Request::Lsp),
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
                loop_budget: None,
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
                loop_budget: None,
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
        assert_eq!(
            parse_args(&["build", "--mode", "preview"]),
            Ok(Request::Build {
                mode: BuildMode::Preview,
                loop_budget: None,
                out: None,
                format: Format::Human,
                path: None
            })
        );
        assert_eq!(
            parse_args(&[
                "build",
                "--mode",
                "preview",
                "--loop-budget",
                "5000",
                "proj"
            ]),
            Ok(Request::Build {
                mode: BuildMode::Preview,
                loop_budget: Some(5000),
                out: None,
                format: Format::Human,
                path: Some(PathBuf::from("proj"))
            })
        );
        // The budget belongs to previews, is a positive integer and fits a u32.
        assert!(usage(&["build", "--loop-budget", "5"]).contains("--mode preview"));
        assert!(usage(&["build", "--mode", "dev", "--loop-budget", "5"]).contains("preview"));
        for bad in ["0", "-1", "many", "4294967296", ""] {
            usage(&["build", "--mode", "preview", "--loop-budget", bad]);
        }
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
        assert_eq!(
            parse_args(&["inspect", "--assets", "--format", "json"]),
            Ok(Request::Inspect {
                view: mtek_compiler::Inspect::Assets,
                format: Format::Json,
                path: None,
            })
        );
        usage(&["inspect"]);
        usage(&["inspect", "--ir", "--shaders"]);
        usage(&["inspect", "--bindings", "--shaders"]);
        usage(&["inspect", "--assets", "--ir"]);
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
    fn fmt_takes_paths_and_check() {
        assert_eq!(
            parse_args(&["fmt"]),
            Ok(Request::Fmt {
                check: false,
                paths: vec![]
            })
        );
        assert_eq!(
            parse_args(&["fmt", "--check", "a.mtek", "dir"]),
            Ok(Request::Fmt {
                check: true,
                paths: vec![PathBuf::from("a.mtek"), PathBuf::from("dir")]
            })
        );
        assert_eq!(
            parse_args(&["fmt", "a"]).map(|r| (r.format(), r.verb())),
            Ok((Format::Human, "fmt"))
        );
        usage(&["fmt", "--format", "json"]);
        usage(&["fmt", "--write"]);
    }

    #[test]
    fn new_takes_a_name() {
        assert_eq!(
            parse_args(&["new", "pulse-cube"]),
            Ok(Request::New {
                name: "pulse-cube".into()
            })
        );
        usage(&["new"]);
        usage(&["new", "a", "b"]);
    }

    #[test]
    fn test_defaults_and_options() {
        assert_eq!(
            parse_args(&["test"]),
            Ok(Request::Test(TestArgs {
                allow_not_run: false,
                format: Format::Human,
                path: None
            }))
        );
        let request = parse_args(&["test", "--allow-not-run", "--format", "json", "proj"]);
        assert_eq!(
            request,
            Ok(Request::Test(TestArgs {
                allow_not_run: true,
                format: Format::Json,
                path: Some(PathBuf::from("proj"))
            }))
        );
        assert_eq!(
            request.map(|r| (r.format(), r.verb())),
            Ok((Format::Json, "test"))
        );
        assert!(usage(&["test", "--format", "yaml"]).contains("yaml"));
        usage(&["test", "--allow-not-run=yes"]);
        usage(&["test", "a", "b"]);
    }

    #[test]
    fn grammar_export_needs_a_format() {
        for format in ["ebnf", "gbnf"] {
            let request = parse_args(&["grammar", "export", "--format", format]);
            assert!(
                matches!(&request, Ok(Request::Grammar(_))),
                "{format}: {request:?}"
            );
            assert_eq!(
                request.map(|r| (r.format(), r.verb())),
                Ok((Format::Human, "grammar"))
            );
        }
        usage(&["grammar"]);
        usage(&["grammar", "export"]);
        assert!(usage(&["grammar", "export", "--format", "yaml"]).contains("yaml"));
        usage(&["grammar", "export", "--format", "ebnf", "extra"]);
        usage(&["grammar", "check"]);
    }

    #[test]
    fn lsp_takes_no_arguments_but_the_conventional_stdio_flag() {
        assert_eq!(parse_args(&["lsp"]), Ok(Request::Lsp));
        assert_eq!(parse_args(&["lsp", "--stdio"]), Ok(Request::Lsp));
        assert_eq!(
            parse_args(&["lsp"]).map(|r| (r.format(), r.verb())),
            Ok((Format::Human, "lsp"))
        );
        usage(&["lsp", "--port", "1"]);
        usage(&["lsp", "somewhere"]);
        usage(&["lsp", "--format", "json"]);
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
                assert!(text.contains("new"), "{text}");
                assert!(text.contains("lsp"), "{text}");
                for command in ["fmt", "test", "context", "grammar"] {
                    assert!(text.contains(command), "{command} is listed: {text}");
                }
            }
            other => panic!("{other:?}"),
        }
    }
}
