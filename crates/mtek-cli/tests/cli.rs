//! Integration tests that run the real `mtek` binary.

use std::process::{Command, Output};

fn run(args: &[&str]) -> Result<Output, std::io::Error> {
    Command::new(env!("CARGO_BIN_EXE_mtek")).args(args).output()
}

#[test]
fn version_prints_exact_line_and_exits_zero() -> Result<(), std::io::Error> {
    let out = run(&["--version"])?;
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "mtek 0.1.0-dev (language 0.1, runtime ABI 1)\n"
    );
    assert!(out.stderr.is_empty());
    Ok(())
}

#[test]
fn no_arguments_prints_usage_and_exits_two() -> Result<(), std::io::Error> {
    let out = run(&[])?;
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).starts_with("usage:"));
    Ok(())
}

#[test]
fn unknown_arguments_exit_two() -> Result<(), std::io::Error> {
    for args in [&["check"][..], &["--help"], &["--version", "extra"]] {
        let out = run(args)?;
        assert_eq!(out.status.code(), Some(2), "arguments: {args:?}");
        assert!(out.stdout.is_empty(), "arguments: {args:?}");
    }
    Ok(())
}
