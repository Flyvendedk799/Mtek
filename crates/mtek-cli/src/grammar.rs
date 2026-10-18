//! `mtek grammar` (`spec/tooling.md` section 1, `spec/ai-and-benchmarks.md`
//! section 3, decision 0073): print the reference grammar from the grammar
//! model, as EBNF (`spec/grammar.ebnf`, byte for byte) or as GBNF for
//! llama.cpp's grammar-constrained sampling. Offline; no project needed.

use clap::{Args, Subcommand, ValueEnum};

use crate::commands::{EXIT_INTERNAL, Outcome};

/// The arguments of `mtek grammar`.
#[derive(Args, Debug, PartialEq, Eq)]
pub struct GrammarArgs {
    #[command(subcommand)]
    command: GrammarCommand,
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
enum GrammarCommand {
    /// Print the grammar of the language
    Export {
        /// The notation
        #[arg(long, value_enum)]
        format: GrammarFormat,
    },
}

/// `--format` of `mtek grammar export`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
enum GrammarFormat {
    /// The reference grammar, spec/grammar.ebnf
    Ebnf,
    /// GBNF for llama.cpp (start rule `root`)
    Gbnf,
}

/// Run `mtek grammar …`.
pub fn run(args: &GrammarArgs) -> Outcome {
    match args.command {
        GrammarCommand::Export {
            format: GrammarFormat::Ebnf,
        } => Outcome::stdout(mtek_compiler::syntax::grammar_model::ebnf()),
        GrammarCommand::Export {
            format: GrammarFormat::Gbnf,
        } => match mtek_compiler::syntax::gbnf() {
            Ok(text) => Outcome::stdout(text),
            Err(problem) => Outcome {
                stdout: String::new(),
                stderr: format!(
                    "error: internal error: the grammar model cannot be translated to GBNF: {problem}\n"
                ),
                code: EXIT_INTERNAL,
            },
        },
    }
}
