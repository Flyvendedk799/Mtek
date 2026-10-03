//! Golden renderings of the human renderer (`spec/diagnostics.md` section 4).

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mtek_compiler::diagnostics::{
    Code, Diagnostic, Diagnostics, MAX_LINE_COLUMNS, RenderOptions, render, render_report,
};
use mtek_compiler::source::{FileId, ProjectPath, SourceMap, Span};

fn map_of(files: &[(&str, &str)]) -> SourceMap {
    let mut map = SourceMap::new();
    for (path, text) in files {
        map.add(ProjectPath::new(path).unwrap(), text.as_bytes())
            .unwrap();
    }
    map
}

/// The span of the `n`-th (0-based) occurrence of `needle` in file `file`.
fn find(map: &SourceMap, file: u32, needle: &str, n: usize) -> Span {
    let text = map.get(FileId(file)).unwrap().text();
    let start = text.match_indices(needle).nth(n).unwrap().0;
    Span::new(
        FileId(file),
        u32::try_from(start).unwrap(),
        u32::try_from(start + needle.len()).unwrap(),
    )
}

fn plain(d: &Diagnostic, map: &SourceMap) -> String {
    render(d, map, RenderOptions { color: false })
}

#[test]
fn the_example_of_the_specification() {
    let mut text = String::new();
    for line in 1..=20 {
        match line {
            5 => text.push_str("    param phase: f32 = 0.0;\n"),
            18 => text.push_str("        phase: vec3(1.0, 0.0, 0.0);\n"),
            _ => text.push('\n'),
        }
    }
    let map = map_of(&[("src/main.mtek", &text)]);
    let d = Diagnostic::new(
        Code::E3102,
        "Material parameter 'phase' expects f32, but received vec3.",
    )
    .at(find(&map, 0, "vec3(1.0, 0.0, 0.0)", 0))
    .expected("f32")
    .actual("vec3")
    .related(
        find(&map, 0, "param phase: f32 = 0.0;", 0),
        "parameter 'phase' is declared here",
    )
    .help("material parameters are typed; pass an f32 such as `0.0`");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E3102]: Material parameter 'phase' expects f32, but received vec3.
  --> src/main.mtek:18:16
   |
18 |         phase: vec3(1.0, 0.0, 0.0);
   |                ^^^^^^^^^^^^^^^^^^^ expected f32, found vec3
   |
 ::: src/main.mtek:5:5
   |
 5 |     param phase: f32 = 0.0;
   |     ----------------------- parameter 'phase' is declared here
   = help: material parameters are typed; pass an f32 such as `0.0`
"
    );
}

#[test]
fn two_labels_on_one_line_stack_their_messages() {
    let map = map_of(&[("a.mtek", "let value = add(left, right);\n")]);
    let d = Diagnostic::new(
        Code::E3002,
        "Function 'add' takes 3 arguments, but 2 were given.",
    )
    .label(find(&map, 0, "right", 0), "last argument given here")
    .related(find(&map, 0, "left", 0), "first argument");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E3002]: Function 'add' takes 3 arguments, but 2 were given.
 --> a.mtek:1:23
  |
1 | let value = add(left, right);
  |                 ----  ^^^^^ last argument given here
  |                 |
  |                 first argument
"
    );
}

#[test]
fn nearby_related_labels_share_one_snippet() {
    let text = "param a: f32 = 1.0;\nparam b: f32 = 2.0;\nparam a: f32 = 3.0;\n";
    let map = map_of(&[("a.mtek", text)]);
    // Every line is 20 bytes; the parameter name is the 7th byte of a line.
    let first = Span::new(FileId(0), 6, 7);
    let second = Span::new(FileId(0), 46, 47);
    assert_eq!(&text[6..7], "a");
    assert_eq!(&text[46..47], "a");
    let d = Diagnostic::new(Code::E2002, "The name 'a' is declared twice.")
        .label(second, "second declaration")
        .related(first, "first declaration");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E2002]: The name 'a' is declared twice.
 --> a.mtek:3:7
  |
1 | param a: f32 = 1.0;
  |       - first declaration
2 | param b: f32 = 2.0;
3 | param a: f32 = 3.0;
  |       ^ second declaration
"
    );
}

#[test]
fn distant_lines_in_one_snippet_are_elided() {
    let mut text = String::from("start\n");
    for _ in 0..8 {
        text.push_str("filler\n");
    }
    text.push_str("end\n");
    let map = map_of(&[("a.mtek", &text)]);
    // Lines 1 and 3 share a snippet (line 2 between them is shown); line 10
    // is too far away and gets a snippet of its own.
    let d = Diagnostic::new(Code::E2003, "x")
        .label(find(&map, 0, "start", 0), "here")
        .related(find(&map, 0, "filler", 1), "near")
        .related(find(&map, 0, "end", 0), "far");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E2003]: x
  --> a.mtek:1:1
   |
 1 | start
   | ^^^^^ here
 2 | filler
 3 | filler
   | ------ near
   |
 ::: a.mtek:10:1
   |
10 | end
   | --- far
"
    );
}

#[test]
fn three_line_span_is_underlined_on_every_line() {
    let text = "fn main() {\n    let x = 1;\n}\n";
    let map = map_of(&[("a.mtek", text)]);
    let whole = Span::new(
        FileId(0),
        0,
        u32::try_from("fn main() {\n    let x = 1;\n}".len()).unwrap(),
    );
    let d = Diagnostic::new(Code::E3080, "Function 'main' never returns a value.")
        .label(whole, "body without return");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E3080]: Function 'main' never returns a value.
 --> a.mtek:1:1
  |
1 | fn main() {
  | ^^^^^^^^^^^
2 |     let x = 1;
  |     ^^^^^^^^^^
3 | }
  | ^ body without return
"
    );
}

#[test]
fn long_multi_line_span_elides_its_interior() {
    let mut text = String::from("scene Main {\n");
    for i in 0..8 {
        text.push_str(&format!("    entity e{i};\n"));
    }
    text.push_str("}\n");
    let map = map_of(&[("a.mtek", &text)]);
    let whole = Span::new(FileId(0), 0, u32::try_from(text.trim_end().len()).unwrap());
    let d = Diagnostic::new(Code::E5012, "Scene 'Main' has no camera.").label(whole, "no camera");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E5012]: Scene 'Main' has no camera.
  --> a.mtek:1:1
   |
 1 | scene Main {
   | ^^^^^^^^^^^^
 2 |     entity e0;
   |     ^^^^^^^^^^
...
10 | }
   | ^ no camera
"
    );
}

#[test]
fn span_ending_after_a_line_break_ends_on_that_line() {
    let text = "let a = 1\nlet b = 2;\n";
    let map = map_of(&[("a.mtek", text)]);
    // `let a = 1\n` including the terminator.
    let d = Diagnostic::new(Code::E1003, "Missing ';' after the declaration of 'a'.")
        .label(Span::new(FileId(0), 0, 10), "needs ';'");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E1003]: Missing ';' after the declaration of 'a'.
 --> a.mtek:1:1
  |
1 | let a = 1
  | ^^^^^^^^^ needs ';'
"
    );
}

#[test]
fn crlf_files_render_without_carriage_returns() {
    let text = "let a = 1;\r\nlet b = oops;\r\nlet c = 3;\r\n";
    let map = map_of(&[("crlf.mtek", text)]);
    let d = Diagnostic::new(Code::E2003, "Unknown name 'oops'.")
        .label(find(&map, 0, "oops", 0), "not found in this scope")
        .related(find(&map, 0, "let a", 0), "'a' is declared here");
    let out = plain(&d, &map);
    assert!(!out.contains('\r'), "{out:?}");
    assert_eq!(
        out,
        "\
error[MTEK-E2003]: Unknown name 'oops'.
 --> crlf.mtek:2:9
  |
1 | let a = 1;
  | ----- 'a' is declared here
2 | let b = oops;
  |         ^^^^ not found in this scope
"
    );
}

#[test]
fn span_covering_a_crlf_ends_on_the_previous_line() {
    let text = "ab\r\ncd\r\n";
    let map = map_of(&[("crlf.mtek", text)]);
    let d = Diagnostic::new(Code::E1003, "x").label(Span::new(FileId(0), 0, 4), "m");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E1003]: x
 --> crlf.mtek:1:1
  |
1 | ab
  | ^^ m
"
    );
}

#[test]
fn multi_byte_characters_keep_the_carets_aligned() {
    // 'é' (2 bytes), U+1F600 (4 bytes) and a tab before the offending word.
    let text = "let caf\u{e9} = \"\u{1F600}\";\n\tlet bad = caf\u{e9} + 1;\n";
    let map = map_of(&[("utf8.mtek", text)]);
    let d = Diagnostic::new(
        Code::E3014,
        "Operator '+' is not defined for string and i32.",
    )
    .label(find(&map, 0, "caf\u{e9} + 1", 0), "string + i32")
    .related(find(&map, 0, "\"\u{1F600}\"", 0), "this is a string");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E3014]: Operator '+' is not defined for string and i32.
 --> utf8.mtek:2:12
  |
1 | let caf\u{e9} = \"\u{1F600}\";
  |            --- this is a string
2 |     let bad = caf\u{e9} + 1;
  |               ^^^^^^^^ string + i32
"
    );
}

#[test]
fn related_spans_in_another_file() {
    let map = map_of(&[
        (
            "src/main.mtek",
            "import { shade } from \"./lib.mtek\";\nshade(1);\n",
        ),
        (
            "src/lib.mtek",
            "// helpers\nexport fn shade(a: f32, b: f32) -> f32 { return a; }\n",
        ),
    ]);
    let d = Diagnostic::new(
        Code::E3002,
        "Function 'shade' takes 2 arguments, but 1 was given.",
    )
    .label(find(&map, 0, "shade(1)", 0), "expected 2 arguments")
    .related(
        find(&map, 1, "fn shade(a: f32, b: f32)", 0),
        "'shade' is declared here",
    )
    .help("add the missing argument");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E3002]: Function 'shade' takes 2 arguments, but 1 was given.
 --> src/main.mtek:2:1
  |
2 | shade(1);
  | ^^^^^^^^ expected 2 arguments
  |
::: src/lib.mtek:2:8
  |
2 | export fn shade(a: f32, b: f32) -> f32 { return a; }
  |        ------------------------ 'shade' is declared here
  = help: add the missing argument
"
    );
}

#[test]
fn project_level_diagnostic_has_no_snippet() {
    let map = SourceMap::new();
    let d = Diagnostic::new(
        Code::E9004,
        "No 'mtek.toml' was found in '.' or any parent folder.",
    )
    .note("run `mtek new` to create a project")
    .help("pass --project <dir> to name the project folder\nthe folder must contain mtek.toml");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E9004]: No 'mtek.toml' was found in '.' or any parent folder.
  = note: run `mtek new` to create a project
  = help: pass --project <dir> to name the project folder
          the folder must contain mtek.toml
"
    );
}

#[test]
fn expected_and_actual_without_a_location_become_a_note() {
    let map = SourceMap::new();
    let d = Diagnostic::new(Code::E9001, "Key 'width' must be an integer.")
        .expected("integer")
        .actual("string");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E9001]: Key 'width' must be an integer.
  = note: expected integer, found string
"
    );
}

#[test]
fn warning_and_empty_span_at_end_of_file() {
    let map = map_of(&[("a.mtek", "let a = 1;")]);
    let d = Diagnostic::new(Code::E1004, "The file ends inside the block.")
        .label(Span::at(FileId(0), 10), "unexpected end of file");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E1004]: The file ends inside the block.
 --> a.mtek:1:11
  |
1 | let a = 1;
  |           ^ unexpected end of file
"
    );
    let w =
        Diagnostic::new(Code::W3081, "This code is never reached.").at(Span::new(FileId(0), 0, 3));
    assert_eq!(
        plain(&w, &map),
        "\
warning[MTEK-W3081]: This code is never reached.
 --> a.mtek:1:1
  |
1 | let a = 1;
  | ^^^
"
    );
}

#[test]
fn empty_file_and_blank_lines() {
    let map = map_of(&[("empty.mtek", ""), ("blank.mtek", "a\n\nb\n")]);
    let d = Diagnostic::new(Code::E9005, "The entry file is empty.").at(Span::at(FileId(0), 0));
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E9005]: The entry file is empty.
 --> empty.mtek:1:1
  |
1 |
  | ^
"
    );
    let d = Diagnostic::new(Code::E1001, "x")
        .label(Span::new(FileId(1), 0, 1), "a")
        .related(Span::new(FileId(1), 3, 4), "b");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E1001]: x
 --> blank.mtek:1:1
  |
1 | a
  | ^ a
2 |
3 | b
  | - b
"
    );
}

#[test]
fn a_lone_carriage_return_cannot_move_the_cursor() {
    let map = map_of(&[("cr.mtek", "let a\r= 1;\n")]);
    let d = Diagnostic::new(Code::E0003, "Lone carriage return.")
        .label(find(&map, 0, "\r", 0), "not followed by a line feed");
    let out = plain(&d, &map);
    assert!(!out.contains('\r'));
    assert_eq!(
        out,
        "\
error[MTEK-E0003]: Lone carriage return.
 --> cr.mtek:1:6
  |
1 | let a\u{240D}= 1;
  |      ^ not followed by a line feed
"
    );
}

#[test]
fn a_leading_byte_order_mark_is_invisible() {
    let map = map_of(&[("bom.mtek", "\u{FEFF}let x = bad;\n")]);
    let d = Diagnostic::new(Code::E2003, "Unknown name 'bad'.")
        .label(find(&map, 0, "bad", 0), "unknown");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E2003]: Unknown name 'bad'.
 --> bom.mtek:1:9
  |
1 | let x = bad;
  |         ^^^ unknown
"
    );
}

#[test]
fn long_lines_are_elided_around_the_span() {
    let prefix = "x".repeat(300);
    let suffix = "y".repeat(300);
    let text = format!("{prefix}BAD{suffix}\n");
    let map = map_of(&[("long.mtek", &text)]);
    let d =
        Diagnostic::new(Code::E1001, "Unexpected token.").label(find(&map, 0, "BAD", 0), "here");
    let out = plain(&d, &map);
    let source_line = out.lines().find(|l| l.starts_with("1 | ")).unwrap();
    let shown = source_line.strip_prefix("1 | ").unwrap();
    assert_eq!(shown.chars().count(), MAX_LINE_COLUMNS);
    assert!(shown.starts_with("..."));
    assert!(shown.ends_with("..."));
    let caret_line = out.lines().find(|l| l.contains('^')).unwrap();
    let caret_col = caret_line.find('^').unwrap();
    let bad_col = source_line.find("BAD").unwrap();
    assert_eq!(caret_col, bad_col, "carets must sit under BAD:\n{out}");
    assert!(caret_line.contains("^^^ here"));
    // The header and location still show the real column.
    assert!(out.contains(" --> long.mtek:1:301"));
}

#[test]
fn a_span_near_the_start_of_a_long_line_cuts_only_the_end() {
    let text = format!("BAD{}\n", "z".repeat(400));
    let map = map_of(&[("long.mtek", &text)]);
    let d = Diagnostic::new(Code::E1001, "Unexpected token.").at(find(&map, 0, "BAD", 0));
    let out = plain(&d, &map);
    let shown = out
        .lines()
        .find(|l| l.starts_with("1 | "))
        .and_then(|l| l.strip_prefix("1 | "))
        .unwrap();
    assert_eq!(shown.chars().count(), MAX_LINE_COLUMNS);
    assert!(shown.starts_with("BAD"));
    assert!(shown.ends_with("..."));
    assert!(out.contains("\n  | ^^^\n"));
}

#[test]
fn a_line_of_exactly_the_limit_is_not_elided() {
    let text = format!("{}\n", "a".repeat(MAX_LINE_COLUMNS));
    let map = map_of(&[("a.mtek", &text)]);
    let d = Diagnostic::new(Code::E1001, "x").at(Span::new(FileId(0), 0, 1));
    let out = plain(&d, &map);
    assert!(out.contains(&format!("1 | {}\n", "a".repeat(MAX_LINE_COLUMNS))));
    assert!(!out.contains("..."));
}

#[test]
fn tabs_expand_to_four_spaces() {
    let map = map_of(&[("t.mtek", "\t\tlet x = bad;\n")]);
    let d = Diagnostic::new(Code::E2003, "x").label(find(&map, 0, "bad", 0), "m");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E2003]: x
 --> t.mtek:1:11
  |
1 |         let x = bad;
  |                 ^^^ m
"
    );
}

#[test]
fn colour_is_only_used_when_requested() {
    let map = map_of(&[("a.mtek", "let x = bad;\n")]);
    let d = Diagnostic::new(Code::E2003, "Unknown name 'bad'.")
        .label(find(&map, 0, "bad", 0), "unknown")
        .related(find(&map, 0, "let", 0), "binding")
        .help("declare it first")
        .note("names are case sensitive");
    let off = render(&d, &map, RenderOptions::default());
    assert!(!off.contains('\x1b'));
    assert!(!RenderOptions::default().color);

    let on = render(&d, &map, RenderOptions { color: true });
    assert!(on.contains("\x1b[1;31merror[MTEK-E2003]\x1b[0m"));
    assert!(on.contains("\x1b[1;31m^^^\x1b[0m \x1b[1;31munknown\x1b[0m"));
    assert!(on.contains("\x1b[1;34m---\x1b[0m"));
    assert!(on.contains("\x1b[1;36mhelp:\x1b[0m"));
    assert!(on.contains("\x1b[1;32mnote:\x1b[0m"));
    assert!(on.contains("\x1b[1;34m-->\x1b[0m"));
    // Stripping the escape sequences gives the plain rendering.
    assert_eq!(strip_ansi(&on), off);

    let warning = Diagnostic::new(Code::W3081, "never reached");
    assert!(render(&warning, &map, RenderOptions { color: true }).contains("\x1b[1;33mwarning["));
}

fn strip_ansi(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            for end in chars.by_ref() {
                if end == 'm' {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[test]
fn overlapping_labels_let_the_primary_win() {
    let map = map_of(&[("a.mtek", "abcdefgh\n")]);
    let d = Diagnostic::new(Code::E1001, "x")
        .label(Span::new(FileId(0), 2, 5), "primary")
        .related_span(Span::new(FileId(0), 0, 4));
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E1001]: x
 --> a.mtek:1:3
  |
1 | abcdefgh
  | --^^^ primary
"
    );
}

#[test]
fn unknown_files_and_wild_spans_do_not_panic() {
    let map = map_of(&[("a.mtek", "abc")]);
    let ghost = Span::new(FileId(9), 0, 1);
    let d = Diagnostic::new(Code::E9999, "internal")
        .label(ghost, "?")
        .related(Span::new(FileId(0), 1, 2), "b");
    let out = plain(&d, &map);
    assert!(
        out.starts_with("error[MTEK-E9999]: internal\n --> file#9\n"),
        "{out}"
    );
    // Offsets far outside the file clamp to its end.
    let wild = Diagnostic::new(Code::E1001, "x").label(Span::new(FileId(0), 500, 900), "far");
    let out = plain(&wild, &map);
    assert!(out.contains("1 | abc\n"), "{out}");
    let backwards = Diagnostic::new(Code::E1001, "x").at(Span::new(FileId(0), 2, 1));
    assert!(plain(&backwards, &map).contains("1 | abc"));
}

#[test]
fn a_report_separates_diagnostics_with_an_empty_line() {
    let map = map_of(&[("a.mtek", "let a;\nlet b;\n")]);
    let mut sink = Diagnostics::new();
    sink.push(Diagnostic::new(Code::E1001, "second").at(Span::new(FileId(0), 7, 10)));
    sink.push(Diagnostic::new(Code::E1001, "first").at(Span::new(FileId(0), 0, 3)));
    let report = sink.finish();
    assert_eq!(
        render_report(&report, &map, RenderOptions::default()),
        "\
error[MTEK-E1001]: first
 --> a.mtek:1:1
  |
1 | let a;
  | ^^^

error[MTEK-E1001]: second
 --> a.mtek:2:1
  |
2 | let b;
  | ^^^

"
    );
}

#[test]
fn line_numbers_widen_the_gutter() {
    let mut text = String::new();
    for _ in 0..99 {
        text.push('\n');
    }
    text.push_str("here\nnext\n");
    let map = map_of(&[("a.mtek", &text)]);
    let d = Diagnostic::new(Code::E1001, "x")
        .label(find(&map, 0, "here", 0), "m")
        .related(find(&map, 0, "next", 0), "n");
    assert_eq!(
        plain(&d, &map),
        "\
error[MTEK-E1001]: x
   --> a.mtek:100:1
    |
100 | here
    | ^^^^ m
101 | next
    | ---- n
"
    );
}

#[test]
fn every_span_of_a_tricky_file_renders_without_panicking() {
    let text = "\u{FEFF}a\u{e9}\t\u{1F600}\r\n\r\n\tbc\rd\n\nlast";
    let map = map_of(&[("tricky.mtek", text)]);
    let len = u32::try_from(text.len()).unwrap();
    for start in 0..=len + 2 {
        for end in start..=len + 2 {
            let d = Diagnostic::new(Code::E1001, "x")
                .label(Span::new(FileId(0), start, end), "primary")
                .related(Span::new(FileId(0), end, end + 1), "related")
                .related_span(Span::new(FileId(0), 0, start));
            for color in [false, true] {
                let out = render(&d, &map, RenderOptions { color });
                assert!(out.starts_with(if color { "\x1b[1;31merror" } else { "error[" }));
                assert!(!out.contains('\r'), "{start}..{end}: {out:?}");
                assert!(out.ends_with('\n'));
            }
        }
    }
}
