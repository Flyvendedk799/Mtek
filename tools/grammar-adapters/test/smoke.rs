//! End-to-end smoke of the pinned combination (decision 0073): the
//! capability check passes, and a grammar-constrained generation with the
//! pinned model produces text the compiler's lexer and parser accept.
//!
//! The model has never seen Mtek; the prompt shows one example. Greedy
//! decoding (temperature 0, seed 0, CPU only) makes the run repeatable on one
//! machine. A generation that reaches the token limit is `truncated`, a
//! failure state (`spec/ai-and-benchmarks.md` section 1), and fails the smoke
//! even if its text parses.
//!
//! Without the pinned backend and model it prints NOT-RUN with the reason
//! and exits 0; with `MTEK_REQUIRE_GBNF_BACKEND=1` it fails instead.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::process::ExitCode;

use mtek_grammar_adapters::{
    Expectation, check_capability, compiler_verdict, default_install_dir, generate,
};

const PROMPT: &str = "\
// Mtek is a language for 3D scenes in the browser. This file is a complete Mtek module.
// Example:
//
// scene Demo {
//     camera Main { position: vec3(0.0, 2.0, 6.0); }
//     entity Cube {
//         mesh: Box { size: vec3(1.0, 1.0, 1.0) };
//         material: Unlit { color: #6b5cff };
//     }
// }
//
// The module below declares one scene with a camera and one entity, and nothing else.
";

const MAX_TOKENS: u32 = 400;

fn main() -> ExitCode {
    let required = std::env::var("MTEK_REQUIRE_GBNF_BACKEND").is_ok_and(|v| v == "1");
    let dir = default_install_dir();
    let capability = match check_capability(&dir) {
        Ok(capability) => capability,
        Err(unavailable) => {
            println!("grammar adapter smoke: NOT-RUN: {unavailable}");
            return if required {
                println!("MTEK_REQUIRE_GBNF_BACKEND=1: failing because the smoke did not run");
                ExitCode::FAILURE
            } else {
                ExitCode::SUCCESS
            };
        }
    };
    println!(
        "grammar adapter smoke: capability available: {}",
        capability.to_json()
    );
    let grammar = mtek_compiler::syntax::gbnf().unwrap();
    let generation = match generate(&capability, &grammar, PROMPT, MAX_TOKENS) {
        Ok(g) => g,
        Err(e) => {
            println!("grammar adapter smoke: FAIL: generation failed: {e}");
            return ExitCode::FAILURE;
        }
    };
    let verdict = compiler_verdict(&generation.text);
    println!(
        "grammar adapter smoke: generation {} after {} decode runs (limit {MAX_TOKENS}); compiler lex+parse errors: {:?}",
        if generation.truncated { "truncated" } else { "completed" },
        generation.tokens,
        verdict.errors
    );
    println!("----- generated text -----\n{}\n--------------------------", generation.text);
    let parses = verdict.expectation() == Expectation::Accept;
    if !generation.truncated && parses {
        println!("grammar adapter smoke: PASS");
        ExitCode::SUCCESS
    } else {
        println!(
            "grammar adapter smoke: FAIL ({})",
            if generation.truncated {
                "the generation was truncated"
            } else {
                "the generated text does not parse"
            }
        );
        ExitCode::FAILURE
    }
}
