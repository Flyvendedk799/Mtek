//! Unit tests of the formatter.

use super::*;

fn fmt(text: &str) -> String {
    format_text(FileId(0), text).unwrap_or_else(|d| panic!("{d:?}"))
}

#[test]
fn smoke() {
    assert_eq!(fmt("fn f( ) { }"), "fn f() {}
");
}

/// Prints what the printer makes of the file named by `MTEK_FMT_DEBUG`,
/// before the check (a debugging aid: `cargo test debug_print -- --ignored --nocapture`).
#[test]
#[ignore = "a debugging aid"]
fn debug_print() {
    let Ok(path) = std::env::var("MTEK_FMT_DEBUG") else {
        return;
    };
    let text = std::fs::read_to_string(path).unwrap();
    match print(FileId(0), &text) {
        Ok((formatted, _)) => println!("{formatted}"),
        Err(d) => println!("{d:?}"),
    }
}
