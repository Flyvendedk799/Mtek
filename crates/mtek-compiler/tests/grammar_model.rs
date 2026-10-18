//! The grammar model prints the checked-in reference grammar byte for byte
//! (`spec/ai-and-benchmarks.md` section 3, decision 0073).

use std::path::Path;

#[test]
fn the_model_prints_spec_grammar_ebnf_exactly() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/grammar.ebnf");
    let file = std::fs::read_to_string(&path).expect("spec/grammar.ebnf is readable");
    let printed = mtek_compiler::syntax::grammar_model::ebnf();
    if printed != file {
        let first = printed
            .lines()
            .zip(file.lines())
            .position(|(a, b)| a != b)
            .unwrap_or_else(|| printed.lines().count().min(file.lines().count()));
        let line = |text: &str| text.lines().nth(first).unwrap_or("<end>").to_owned();
        panic!(
            "the grammar model and spec/grammar.ebnf differ first at line {}:\n model: {:?}\n file:  {:?}",
            first + 1,
            line(&printed),
            line(&file)
        );
    }
}
