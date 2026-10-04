//! `grammar-coverage [REPOSITORY]`: print the grammar coverage report of the
//! repository (default: the one this tool was built in). Exit status 0 when
//! nothing is uncovered, 1 when there are problems, 2 when the corpus cannot
//! be read.

use std::path::PathBuf;
use std::process::ExitCode;

use mtek_grammar_coverage::{corpus, gates, measure};

fn main() -> ExitCode {
    let root = std::env::args_os()
        .nth(1)
        .map_or_else(corpus::repository_root, PathBuf::from);
    let coverage = corpus::load(&root).and_then(|c| measure(&c, &gates()));
    match coverage {
        Ok(coverage) => {
            print!("{}", coverage.render());
            if coverage.problems.is_empty() {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        Err(e) => {
            eprintln!("grammar-coverage: {e}");
            ExitCode::from(2)
        }
    }
}
