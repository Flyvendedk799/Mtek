//! The walkthrough test of `docs/getting-started.md` (task M6-11, decision 0091): a new user's path
//! (install, create, run, edit, break, read the error, repair) executed from the document itself.
//!
//! The test reads the document, creates an empty temporary directory and follows the document's
//! fenced blocks in order: every `console` block is a command run with the real `mtek` binary and
//! the output it prints, `diff` blocks are edits applied to the files, `file=` blocks must equal the
//! files, and the diagnostic printed in the document must be the one the tool prints. The notation
//! is described in the maintenance note at the end of the document; the parts the test does not
//! normalise are the whole point of it.
//!
//! Steps that need the runtime bundle embedded in the binary (`mtek build`, `mtek dev`) are
//! `NOT-RUN` when the binary was built without it (the `rust` CI job; the `node` job has it): the
//! test says so on stderr for every such step and checks that the real tool fails with `E9030`
//! there, so that a missing bundle can never read as a pass.

// Test-only code: helper functions outside `#[test]` functions may unwrap and panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

/// The document under test, read when the test is compiled (a change rebuilds the test).
const DOC: &str = include_str!("../../../docs/getting-started.md");

/// How long one command, one expected line of a server or one request may take.
const PATIENCE: Duration = Duration::from_secs(90);

/// How long a mutant of the document waits for lines that will never come (a genuine line of
/// the development server appears within a second or two).
const MUTANT_PATIENCE: Duration = Duration::from_secs(20);

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

/// The info string of a fence: ```` ```console exit=1 watch ````.
#[derive(Debug)]
struct Info {
    lang: String,
    flags: BTreeSet<String>,
    attrs: BTreeMap<String, String>,
}

impl Info {
    fn parse(text: &str) -> Info {
        let mut words = text.split_whitespace();
        let lang = words.next().unwrap_or("").to_owned();
        let mut flags = BTreeSet::new();
        let mut attrs = BTreeMap::new();
        for word in words {
            if let Some((key, value)) = word.split_once('=') {
                attrs.insert(key.to_owned(), value.to_owned());
            } else {
                flags.insert(word.to_owned());
            }
        }
        Info { lang, flags, attrs }
    }

    fn flag(&self, name: &str) -> bool {
        self.flags.contains(name)
    }

    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.get(name).map(String::as_str)
    }
}

#[derive(Debug)]
struct Fence {
    info: Info,
    body: Vec<String>,
    /// The 1-based line of the opening fence.
    line: usize,
}

#[derive(Debug)]
enum Item {
    Fence(Fence),
    /// `<!-- walkthrough:stop -->`: the development server is stopped here.
    Stop {
        line: usize,
    },
}

/// The fences (three backticks at the start of a line, possibly indented) and the directive
/// comments of a Markdown document, in order. Inline code that merely contains backticks does not
/// start a fence.
fn parse_document(text: &str) -> Vec<Item> {
    let mut items = Vec::new();
    let mut open: Option<(Fence, usize)> = None;
    for (index, raw) in text.lines().enumerate() {
        let line = index + 1;
        let trimmed = raw.trim_start();
        let indent = raw.len() - trimmed.len();
        if let Some((fence, fence_indent)) = open.as_mut() {
            if trimmed.trim_end() == "```" {
                let (fence, _) = open.take().unwrap();
                items.push(Item::Fence(fence));
            } else {
                let strip = raw.len().min(*fence_indent);
                let (lead, rest) = raw.split_at(strip);
                assert!(
                    lead.trim().is_empty(),
                    "line {line}: a fenced block must not be indented less than its fence"
                );
                fence.body.push(rest.to_owned());
            }
        } else if trimmed.starts_with("```") && !trimmed.starts_with("````") {
            let info = Info::parse(&trimmed[3..]);
            open = Some((
                Fence {
                    info,
                    body: Vec::new(),
                    line,
                },
                indent,
            ));
        } else if trimmed.trim_end() == "<!-- walkthrough:stop -->" {
            items.push(Item::Stop { line });
        }
    }
    assert!(open.is_none(), "the document ends inside a fenced block");
    items
}

// ---------------------------------------------------------------------------------------------
// Normalisation: exactly what the document says it normalises, nothing else
// ---------------------------------------------------------------------------------------------

/// Removes ANSI colour escape sequences (`ESC [ ... letter`).
fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Replaces `prefix` followed by a variable part with `prefix` and `replacement`, where `take`
/// returns the length of the variable part at the start of its argument (0: no match).
fn replace_after(
    text: &str,
    prefix: &str,
    take: impl Fn(&str) -> usize,
    replacement: &str,
) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(prefix) {
        let (head, tail) = rest.split_at(at + prefix.len());
        out.push_str(head);
        let n = take(tail);
        if n > 0 {
            out.push_str(replacement);
            rest = &tail[n..];
        } else {
            rest = tail;
        }
    }
    out.push_str(rest);
    out
}

fn is_hex(b: u8) -> bool {
    b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
}

/// 16 lowercase hex digits not followed by another letter or digit: 16, else 0.
fn hex16(text: &str) -> usize {
    let bytes = text.as_bytes();
    let hex = bytes.iter().take_while(|b| is_hex(**b)).count();
    let exact = hex >= 16 && !bytes.get(16).is_some_and(u8::is_ascii_alphanumeric);
    if exact { 16 } else { 0 }
}

fn digits(text: &str) -> usize {
    text.bytes().take_while(u8::is_ascii_digit).count()
}

/// The normalisation of output (and of nothing else): `\r\n`, colour escapes, the build id
/// (`build` and 16 hex digits), a duration (`(35 ms)`) and the port of the development server.
fn normalise(text: &str) -> String {
    let text = strip_ansi(&text.replace("\r\n", "\n"));
    let text = replace_after(&text, "build ", hex16, "<build id>");
    let text = replace_after(
        &text,
        "(",
        |rest| {
            let n = digits(rest);
            if n > 0 && rest[n..].starts_with(" ms)") {
                n
            } else {
                0
            }
        },
        "<n>",
    );
    replace_after(&text, "127.0.0.1:", digits, "5173")
}

/// A file name of a build: every run of 16 hex digits between non-alphanumerics is `<hash>`.
fn hash_names(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let boundary_before = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
        if boundary_before && hex16(&path[i..]) == 16 {
            out.push_str("<hash>");
            i += 16;
        } else {
            let c = path[i..].chars().next().unwrap();
            out.push(c);
            i += c.len_utf8();
        }
    }
    out
}

fn trim_blank_edges(lines: &mut Vec<String>) {
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
}

fn lines_of(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    trim_blank_edges(&mut lines);
    lines
}

// ---------------------------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------------------------

/// Applies a `diff` block: its context and `-` lines must occur exactly once in `text` as whole
/// lines, and are replaced by its context and `+` lines.
fn apply_diff(text: &str, body: &[String]) -> Result<String, String> {
    let (mut old, mut new) = (Vec::new(), Vec::new());
    for line in body {
        match line.chars().next() {
            Some('-') => old.push(&line[1..]),
            Some('+') => new.push(&line[1..]),
            Some(' ') => {
                old.push(&line[1..]);
                new.push(&line[1..]);
            }
            None => {
                old.push("");
                new.push("");
            }
            Some(other) => {
                return Err(format!(
                    "a diff line starts with '{other}', not ' ', '-' or '+': {line}"
                ));
            }
        }
    }
    let old = format!("{}\n", old.join("\n"));
    let new = format!("{}\n", new.join("\n"));
    match text.matches(&old).count() {
        1 => Ok(text.replacen(&old, &new, 1)),
        n => Err(format!(
            "the lines the diff removes must occur exactly once in the file, found {n} times:\n{old}"
        )),
    }
}

/// One edit of a suggested edit of a report: half-open byte range and its replacement.
#[derive(Debug, Clone)]
struct TextEdit {
    start: usize,
    end: usize,
    replacement: String,
}

/// The edits of the first suggested edit of the first diagnostic of `mtek check --format json`.
fn suggested_edits(report: &str, file: &str) -> Result<Vec<TextEdit>, String> {
    let report: Value = serde_json::from_str(report).map_err(|e| format!("not JSON: {e}"))?;
    let suggestions = report["diagnostics"][0]["suggestedEdits"]
        .as_array()
        .ok_or("the first diagnostic has no suggestedEdits")?;
    let [suggestion] = suggestions.as_slice() else {
        return Err(format!(
            "expected exactly one suggested edit, found {}",
            suggestions.len()
        ));
    };
    let mut edits = Vec::new();
    for edit in suggestion["edits"].as_array().ok_or("no edits")? {
        if edit["file"] != file {
            return Err(format!("the edit is in {}, not in {file}", edit["file"]));
        }
        edits.push(TextEdit {
            start: edit["startByte"].as_u64().ok_or("startByte")? as usize,
            end: edit["endByte"].as_u64().ok_or("endByte")? as usize,
            replacement: edit["replacement"]
                .as_str()
                .ok_or("replacement")?
                .to_owned(),
        });
    }
    Ok(edits)
}

/// A plain string splice of the edits (original offsets, applied back to front).
fn apply_edits(text: &str, edits: &[TextEdit]) -> String {
    let mut bytes = text.as_bytes().to_vec();
    let mut sorted = edits.to_vec();
    sorted.sort_by_key(|e| std::cmp::Reverse(e.start));
    for edit in sorted {
        bytes.splice(edit.start..edit.end, edit.replacement.bytes());
    }
    String::from_utf8(bytes).unwrap()
}

// ---------------------------------------------------------------------------------------------
// Running the tool
// ---------------------------------------------------------------------------------------------

/// A fresh directory for one test, removed again on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Scratch {
        let dir =
            std::env::temp_dir().join(format!("mtek-walkthrough-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("logs")).unwrap();
        fs::create_dir_all(dir.join("work")).unwrap();
        Scratch(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        // A server that was just killed may hold files for a moment (Windows).
        for _ in 0..40 {
            if fs::remove_dir_all(&self.0).is_ok() || !self.0.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

fn free_port() -> u16 {
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Starts `mtek args` in `cwd` with standard output and standard error going to the one file
/// `log`, so that the file holds what a terminal would show, in order.
fn spawn_mtek(args: &[String], cwd: &Path, log: &Path) -> Result<Child, String> {
    let out = File::create(log).map_err(|e| e.to_string())?;
    let err = out.try_clone().map_err(|e| e.to_string())?;
    Command::new(env!("CARGO_BIN_EXE_mtek"))
        .args(args)
        .current_dir(cwd)
        .env_remove("NO_COLOR")
        .stdin(Stdio::null())
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err))
        .spawn()
        .map_err(|e| format!("cannot start mtek: {e}"))
}

fn read_log(log: &Path) -> String {
    String::from_utf8_lossy(&fs::read(log).unwrap_or_default()).into_owned()
}

/// A running `mtek dev`, killed on drop.
struct Dev {
    child: Child,
    log: PathBuf,
    port: u16,
    /// How many complete lines of the log earlier steps have accounted for.
    consumed: usize,
    /// How long `expect_next` waits for lines that are not there.
    patience: Duration,
}

impl Dev {
    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    /// The complete lines of the log, normalised.
    fn lines(&self) -> Vec<String> {
        complete_lines(&read_log(&self.log))
    }

    /// Waits until `expected` occurs as consecutive lines among the lines not yet accounted for
    /// (skipping what comes before it, such as the second build of one edit) and accounts for
    /// everything up to its end.
    fn expect_next(&mut self, expected: &[String]) -> Result<(), String> {
        let deadline = Instant::now() + self.patience;
        loop {
            let lines = self.lines();
            let pending = &lines[self.consumed.min(lines.len())..];
            if let Some(at) = find_run(pending, expected) {
                self.consumed += at + expected.len();
                return Ok(());
            }
            if Instant::now() > deadline {
                return Err(format!(
                    "mtek dev did not print the lines of the document:\n{}\n--- what it printed after the previous step:\n{}",
                    expected.join("\n"),
                    pending.join("\n")
                ));
            }
            std::thread::sleep(Duration::from_millis(40));
        }
    }
}

impl Drop for Dev {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The lines of `log` that are complete (end in a newline), normalised.
fn complete_lines(log: &str) -> Vec<String> {
    let complete = log.rfind('\n').map_or("", |at| &log[..=at]);
    normalise(complete).lines().map(str::to_owned).collect()
}

/// The index of the first place where `needle` occurs as consecutive lines of `haystack`.
fn find_run(haystack: &[String], needle: &[String]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

// ---------------------------------------------------------------------------------------------
// A minimal HTTP client (no HTTP crate in the workspace)
// ---------------------------------------------------------------------------------------------

struct Response {
    status: u16,
    content_type: String,
    body: String,
}

fn http_get(port: u16, path: &str) -> Result<Response, String> {
    let mut stream = TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        Duration::from_secs(10),
    )
    .map_err(|e| format!("cannot connect to the development server: {e}"))?;
    stream.set_read_timeout(Some(PATIENCE)).unwrap();
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let (head, body) = text.split_once("\r\n\r\n").ok_or("no response head")?;
    let status = head
        .lines()
        .next()
        .and_then(|l| l.split(' ').nth(1))
        .and_then(|s| s.parse().ok())
        .ok_or("no status line")?;
    let content_type = head
        .lines()
        .find_map(|l| {
            let (name, value) = l.split_once(':')?;
            name.eq_ignore_ascii_case("content-type")
                .then(|| value.trim().to_owned())
        })
        .unwrap_or_default();
    Ok(Response {
        status,
        content_type,
        body: body.to_owned(),
    })
}

/// The first event of `/__mtek/events`: the server replays the latest `build-failed` to a new
/// client (decision 0033 item 7), so this is the failure the page would show.
fn first_event(port: u16) -> Result<Value, String> {
    let mut stream = TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        Duration::from_secs(10),
    )
    .map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .unwrap();
    write!(
        stream,
        "GET /__mtek/events HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: text/event-stream\r\n\r\n"
    )
    .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + PATIENCE;
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let text = String::from_utf8_lossy(&bytes).into_owned();
        if let Some(at) = text.find("data: ")
            && let Some(end) = text[at..].find('\n')
        {
            let json = text[at + 6..at + end].trim_end_matches('\r');
            return serde_json::from_str(json)
                .map_err(|e| format!("event is not JSON ({e}): {json}"));
        }
        if Instant::now() > deadline {
            return Err(format!("no event from the server; received:\n{text}"));
        }
        match stream.read(&mut chunk) {
            Ok(0) => return Err(format!("the event stream ended; received:\n{text}")),
            Ok(n) => bytes.extend_from_slice(&chunk[..n]),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// The text the reload client of the dev page puts in its overlay for a `build-failed` event
/// (decision 0033 item 10; the browser spec checks the real page against the same document).
fn overlay_text(event: &Value) -> Result<String, String> {
    if event["type"] != "build-failed" {
        return Err(format!("the first event is not build-failed: {event}"));
    }
    let diagnostics = event["diagnostics"].as_array().ok_or("no diagnostics")?;
    let mut parts = Vec::new();
    for d in diagnostics {
        let mut part = String::new();
        if let Some(source) = d["source"].as_object() {
            part.push_str(&format!(
                "{}:{}:{}: ",
                source["file"].as_str().ok_or("file")?,
                source["startLine"],
                source["startColumn"]
            ));
        }
        part.push_str(&format!(
            "{}[{}]: {}",
            d["severity"].as_str().ok_or("severity")?,
            d["code"].as_str().ok_or("code")?,
            d["message"].as_str().ok_or("message")?
        ));
        for note in d["notes"].as_array().into_iter().flatten() {
            part.push_str(&format!("\n  = {}", note.as_str().ok_or("note")?));
        }
        parts.push(part);
    }
    Ok(format!("mtek: build failed\n\n{}", parts.join("\n\n")))
}

// ---------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Default)]
struct Report {
    /// What was executed and verified, one entry per step.
    executed: Vec<String>,
    /// What was not run, with the reason; never counted as passed.
    not_run: Vec<String>,
}

struct Walk<'a> {
    scratch: &'a Scratch,
    /// Whether the binary has the runtime bundle embedded.
    runtime: bool,
    /// How long the development server may take to print what the document says.
    patience: Duration,
    cwd: PathBuf,
    dev: Option<Dev>,
    log_count: usize,
    report: Report,
    /// The text of `src/main.mtek` before the `break` diff.
    before_break: Option<String>,
    /// The edits of the last `mtek check --format json` of a project with an error.
    json_edits: Option<Vec<TextEdit>>,
    e9030_checked: bool,
}

fn fail<T>(line: usize, message: impl std::fmt::Display) -> Result<T, String> {
    Err(format!("getting-started.md line {line}: {message}"))
}

impl Walk<'_> {
    fn new_log(&mut self) -> PathBuf {
        self.log_count += 1;
        self.scratch
            .0
            .join("logs")
            .join(format!("{}.log", self.log_count))
    }

    fn not_run(&mut self, line: usize, what: &str, why: &str) {
        let entry = format!("line {line}: {what}: {why}");
        self.report.not_run.push(entry);
    }

    fn done(&mut self, line: usize, what: &str) {
        self.report.executed.push(format!("line {line}: {what}"));
    }

    /// No absolute path of this machine may appear in the output (nothing to normalise).
    fn assert_no_paths(&self, line: usize, raw: &str) -> Result<(), String> {
        let temp = std::env::temp_dir();
        let forms = [
            self.scratch.0.to_string_lossy().into_owned(),
            self.scratch.0.to_string_lossy().replace('\\', "/"),
            temp.to_string_lossy().into_owned(),
        ];
        match forms.iter().find(|f| raw.contains(f.as_str())) {
            Some(path) => fail(
                line,
                format!("the output contains the absolute path {path}"),
            ),
            None => Ok(()),
        }
    }

    fn walk(&mut self, items: &[Item]) -> Result<(), String> {
        self.cwd = self.scratch.0.join("work");
        for item in items {
            match item {
                Item::Stop { line } => self.stop(*line)?,
                Item::Fence(fence) => self.fence(fence)?,
            }
        }
        if let Some(mut dev) = self.dev.take() {
            dev.stop();
            return Err("the document starts `mtek dev` and never stops it".to_owned());
        }
        Ok(())
    }

    fn stop(&mut self, line: usize) -> Result<(), String> {
        match self.dev.take() {
            Some(mut dev) => {
                dev.stop();
                self.done(line, "the development server is stopped");
                Ok(())
            }
            None if self.runtime => fail(line, "`stop` without a running development server"),
            None => Ok(()),
        }
    }

    fn fence(&mut self, fence: &Fence) -> Result<(), String> {
        let info = &fence.info;
        if let Some(path) = info.attr("file") {
            return self.check_file(fence, path);
        }
        if let Some(dir) = info.attr("files") {
            return self.check_files(fence, dir);
        }
        match info.lang.as_str() {
            "console" => self.console(fence),
            "diff" => self.diff(fence),
            "text" if info.flag("overlay") => self.overlay(fence),
            _ => Ok(()), // prose-level blocks (`sh install`, toml and text examples) are not executed here
        }
    }

    fn check_file(&mut self, fence: &Fence, path: &str) -> Result<(), String> {
        let actual = fs::read_to_string(self.cwd.join(path))
            .map_err(|e| format!("line {}: cannot read {path}: {e}", fence.line))?
            .replace("\r\n", "\n");
        let expected = format!("{}\n", fence.body.join("\n"));
        if actual != expected {
            return fail(
                fence.line,
                format!(
                    "{path} is not the file the document shows.\n--- document:\n{expected}--- file:\n{actual}"
                ),
            );
        }
        self.done(fence.line, &format!("{path} equals the file shown"));
        Ok(())
    }

    fn check_files(&mut self, fence: &Fence, dir: &str) -> Result<(), String> {
        if !self.runtime {
            self.not_run(
                fence.line,
                &format!("the files of {dir}"),
                "no runtime bundle: nothing was built",
            );
            return Ok(());
        }
        let mut found = Vec::new();
        collect_files(&self.cwd.join(dir), "", &mut found);
        let mut actual: Vec<String> = found.iter().map(|p| hash_names(p)).collect();
        actual.sort();
        let mut expected: Vec<String> = fence
            .body
            .iter()
            .filter(|l| !l.trim().is_empty())
            .cloned()
            .collect();
        expected.sort();
        if actual != expected {
            return fail(
                fence.line,
                format!(
                    "the files of {dir} differ.\n--- document:\n{}\n--- build:\n{}",
                    expected.join("\n"),
                    actual.join("\n")
                ),
            );
        }
        self.done(
            fence.line,
            &format!("{dir} holds the files listed ({})", actual.len()),
        );
        Ok(())
    }

    fn diff(&mut self, fence: &Fence) -> Result<(), String> {
        let path = fence
            .info
            .attr("path")
            .ok_or_else(|| format!("line {}: a diff block needs path=", fence.line))?;
        let role = fence.info.attr("role").ok_or_else(|| {
            format!(
                "line {}: a diff block needs role=edit|break|fix",
                fence.line
            )
        })?;
        let file = self.cwd.join(path);
        let before = fs::read_to_string(&file)
            .map_err(|e| format!("line {}: cannot read {path}: {e}", fence.line))?;
        if before.contains('\r') {
            return fail(
                fence.line,
                format!(
                    "{path} has CR characters; the walkthrough expects the LF the template writes"
                ),
            );
        }
        let after =
            apply_diff(&before, &fence.body).map_err(|e| format!("line {}: {e}", fence.line))?;
        match role {
            "edit" => {}
            "break" => self.before_break = Some(before.clone()),
            "fix" => {
                if self.before_break.as_deref() != Some(after.as_str()) {
                    return fail(
                        fence.line,
                        "the fix does not restore the file as it was before the break",
                    );
                }
                let edits = self.json_edits.take().ok_or_else(|| {
                    format!(
                        "line {}: a fix needs the JSON report of the broken project before it",
                        fence.line
                    )
                })?;
                let by_edit = apply_edits(&before, &edits);
                if by_edit != after {
                    return fail(
                        fence.line,
                        format!(
                            "the suggested edit of the report does not produce the file of the documented fix.\n--- suggested edit:\n{by_edit}--- document:\n{after}"
                        ),
                    );
                }
            }
            other => return fail(fence.line, format!("unknown diff role {other}")),
        }
        fs::write(&file, after).map_err(|e| e.to_string())?;
        self.done(fence.line, &format!("{role}: diff applied to {path}"));
        Ok(())
    }

    fn overlay(&mut self, fence: &Fence) -> Result<(), String> {
        let Some(dev) = self.dev.as_ref() else {
            self.not_run(
                fence.line,
                "the overlay text",
                "no development server (no runtime bundle)",
            );
            return Ok(());
        };
        // The terminal line and the published event are two steps of one build: wait for the event.
        let deadline = Instant::now() + Duration::from_secs(15);
        let text = loop {
            let event = first_event(dev.port)?;
            if event["type"] == "build-failed" || Instant::now() > deadline {
                break overlay_text(&event)?;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        let expected = fence.body.join("\n");
        if text != expected {
            return fail(
                fence.line,
                format!("the overlay text differs.\n--- document:\n{expected}\n--- event:\n{text}"),
            );
        }
        self.done(fence.line, "overlay text equals the build-failed event");
        Ok(())
    }

    fn console(&mut self, fence: &Fence) -> Result<(), String> {
        let info = &fence.info;
        if info.flag("watch") {
            return self.watch(fence);
        }
        let (first, expected) = fence
            .body
            .split_first()
            .ok_or_else(|| format!("line {}: empty console block", fence.line))?;
        let command = first.strip_prefix("$ ").ok_or_else(|| {
            format!(
                "line {}: a console block starts with `$ command`",
                fence.line
            )
        })?;
        if command.contains(['"', '\'', '|', '>', '<', '&', ';']) {
            return fail(
                fence.line,
                "documented commands are plain words: the test runs them without a shell",
            );
        }
        let words: Vec<String> = command.split_whitespace().map(str::to_owned).collect();
        match words.first().map(String::as_str) {
            Some("cd") => self.cd(fence, &words, expected),
            Some("mtek") => self.mtek(fence, &words[1..], expected),
            _ => fail(
                fence.line,
                format!("unknown command `{command}` (only `cd` and `mtek` are run)"),
            ),
        }
    }

    fn cd(&mut self, fence: &Fence, words: &[String], expected: &[String]) -> Result<(), String> {
        let [_, dir] = words else {
            return fail(fence.line, "`cd` takes one directory");
        };
        if dir.starts_with('/')
            || dir.contains("..")
            || dir.contains('\\')
            || dir.contains(':')
            || !expected.is_empty()
        {
            return fail(
                fence.line,
                "`cd` takes one relative directory below the current one and prints nothing",
            );
        }
        let next = self.cwd.join(dir);
        if !next.is_dir() {
            return fail(fence.line, format!("`cd {dir}`: no such directory"));
        }
        self.cwd = next;
        self.done(fence.line, &format!("$ cd {dir}"));
        Ok(())
    }

    fn mtek(&mut self, fence: &Fence, args: &[String], expected: &[String]) -> Result<(), String> {
        let info = &fence.info;
        let shown = format!("$ mtek {}", args.join(" "));
        if info.flag("runtime") && !self.runtime {
            self.not_run(
                fence.line,
                &shown,
                "the mtek binary was built without the runtime bundle",
            );
            return self.without_runtime(fence, args);
        }
        if info.flag("background") {
            return self.start_dev(fence, args, expected);
        }
        let log = self.new_log();
        let mut child = spawn_mtek(args, &self.cwd, &log)?;
        let status = wait_for(&mut child)?;
        let raw = read_log(&log);
        self.assert_no_paths(fence.line, &raw)?;
        let want: i32 = info
            .attr("exit")
            .map_or(Ok(0), str::parse)
            .map_err(|_| format!("line {}: bad exit=", fence.line))?;
        if status != want {
            return fail(
                fence.line,
                format!("`{shown}` exited with {status}, the document says {want}.\n{raw}"),
            );
        }
        let actual = normalise(&raw);
        if info.flag("excerpt") {
            check_excerpt(fence, expected, &actual)?;
            if args.contains(&"json".to_owned()) {
                self.json_edits = Some(
                    suggested_edits(&raw, "src/main.mtek")
                        .map_err(|e| format!("line {}: {e}", fence.line))?,
                );
            }
        } else {
            check_same(fence, expected, &actual)?;
        }
        self.done(fence.line, &format!("{shown} (exit {status})"));
        Ok(())
    }

    /// A step that needs the runtime bundle, in a binary without it: run it for real and check
    /// that the tool refuses with `E9030`, once.
    fn without_runtime(&mut self, fence: &Fence, args: &[String]) -> Result<(), String> {
        if self.e9030_checked || args.first().map(String::as_str) != Some("build") {
            return Ok(());
        }
        let log = self.new_log();
        let mut child = spawn_mtek(args, &self.cwd, &log)?;
        let status = wait_for(&mut child)?;
        let raw = read_log(&log);
        if status != 1 || !raw.contains("MTEK-E9030") {
            return fail(
                fence.line,
                format!(
                    "without the runtime bundle `mtek build` should fail with MTEK-E9030 (exit 1); exit {status}:\n{raw}"
                ),
            );
        }
        self.e9030_checked = true;
        self.done(
            fence.line,
            "without the runtime bundle `mtek build` fails with MTEK-E9030",
        );
        Ok(())
    }

    fn start_dev(
        &mut self,
        fence: &Fence,
        args: &[String],
        expected: &[String],
    ) -> Result<(), String> {
        if args != ["dev"] {
            return fail(
                fence.line,
                "the background command of the document is `mtek dev`",
            );
        }
        if self.dev.is_some() {
            return fail(fence.line, "a development server is already running");
        }
        let log = self.new_log();
        let port = free_port().to_string();
        let child = spawn_mtek(
            &["dev".to_owned(), "--port".to_owned(), port],
            &self.cwd,
            &log,
        )?;
        let mut dev = Dev {
            child,
            log,
            port: 0,
            consumed: 0,
            patience: self.patience,
        };
        dev.expect_next(expected)
            .map_err(|e| format!("line {}: {e}", fence.line))?;
        // The port the server announced (the test asked for a free one; the server may have moved on).
        let raw = read_log(&dev.log);
        let announced = raw
            .lines()
            .find_map(|l| l.strip_prefix("mtek dev: serving http://127.0.0.1:"))
            .and_then(|rest| rest.split('/').next())
            .and_then(|p| p.parse().ok())
            .ok_or_else(|| format!("line {}: no `serving` line in:\n{raw}", fence.line))?;
        dev.port = announced;
        self.assert_no_paths(fence.line, &raw)?;

        let page = http_get(dev.port, "/")?;
        if page.status != 200
            || !page.content_type.starts_with("text/html")
            || !page.body.contains("<canvas id=\"mtek\">")
            || !page.body.contains("/__mtek/events")
        {
            return fail(
                fence.line,
                format!(
                    "`/` is not the dev page: status {}, {}, {} bytes",
                    page.status,
                    page.content_type,
                    page.body.len()
                ),
            );
        }
        for (path, kind) in [
            ("/app.js", "text/javascript"),
            ("/program.manifest.json", "application/json"),
        ] {
            let response = http_get(dev.port, path)?;
            if response.status != 200 || !response.content_type.starts_with(kind) {
                return fail(
                    fence.line,
                    format!(
                        "{path}: status {}, {}",
                        response.status, response.content_type
                    ),
                );
            }
        }
        self.dev = Some(dev);
        self.done(
            fence.line,
            "$ mtek dev serves the page, the program and the manifest",
        );
        Ok(())
    }

    fn watch(&mut self, fence: &Fence) -> Result<(), String> {
        let Some(dev) = self.dev.as_mut() else {
            self.not_run(
                fence.line,
                "output of the development server",
                "no development server (no runtime bundle)",
            );
            return Ok(());
        };
        dev.expect_next(&fence.body)
            .map_err(|e| format!("line {}: {e}", fence.line))?;
        let raw = read_log(&dev.log);
        self.assert_no_paths(fence.line, &raw)?;
        self.done(fence.line, "the development server printed the lines shown");
        Ok(())
    }
}

fn collect_files(root: &Path, prefix: &str, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let rel = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        if entry.path().is_dir() {
            collect_files(&entry.path(), &rel, out);
        } else {
            out.push(rel);
        }
    }
}

fn wait_for(child: &mut Child) -> Result<i32, String> {
    let deadline = Instant::now() + PATIENCE;
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => return Ok(status.code().unwrap_or(-1)),
            None if Instant::now() > deadline => {
                let _ = child.kill();
                return Err("mtek did not finish".to_owned());
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

fn check_same(fence: &Fence, expected: &[String], actual: &str) -> Result<(), String> {
    let expected = {
        let mut lines = expected.to_vec();
        trim_blank_edges(&mut lines);
        lines
    };
    let actual = lines_of(actual);
    if expected == actual {
        return Ok(());
    }
    fail(
        fence.line,
        format!(
            "the output differs from the document.\n--- document:\n{}\n--- real output (normalised):\n{}",
            expected.join("\n"),
            actual.join("\n")
        ),
    )
}

/// `excerpt`: the document's segments (separated by `...` lines) occur in order as consecutive lines.
fn check_excerpt(fence: &Fence, expected: &[String], actual: &str) -> Result<(), String> {
    let actual = lines_of(actual);
    let mut from = 0;
    let mut segments = 0;
    for segment in expected.split(|l| l.trim() == "...") {
        if segment.is_empty() {
            continue;
        }
        segments += 1;
        match find_run(&actual[from..], segment) {
            Some(at) => from += at + segment.len(),
            None => {
                return fail(
                    fence.line,
                    format!(
                        "the excerpt does not occur in the output, in order:\n{}\n--- real output:\n{}",
                        segment.join("\n"),
                        actual.join("\n")
                    ),
                );
            }
        }
    }
    if segments == 0 {
        return fail(fence.line, "an excerpt with no lines");
    }
    Ok(())
}

fn walk(doc: &str, scratch: &Scratch, runtime: bool, patience: Duration) -> Result<Report, String> {
    let mut walk = Walk {
        scratch,
        runtime,
        patience,
        cwd: scratch.0.join("work"),
        dev: None,
        log_count: 0,
        report: Report::default(),
        before_break: None,
        json_edits: None,
        e9030_checked: false,
    };
    walk.walk(&parse_document(doc))?;
    Ok(walk.report)
}

// ---------------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------------

const RUNTIME: bool = cfg!(mtek_runtime_embedded);

#[test]
fn a_new_user_can_follow_the_document_from_new_to_repair() {
    let scratch = Scratch::new("walk");
    let report = walk(DOC, &scratch, RUNTIME, PATIENCE).unwrap_or_else(|e| panic!("{e}"));
    for step in &report.executed {
        eprintln!("ran {step}");
    }
    for step in &report.not_run {
        eprintln!("NOT-RUN {step}");
    }
    // The document's own steps, so that deleting a block cannot pass: the commands, the diffs, the files.
    let ran = |what: &str| report.executed.iter().filter(|s| s.contains(what)).count();
    assert!(ran("$ mtek --version") == 1, "{report:?}");
    assert!(ran("$ mtek new hello-mtek") == 1, "{report:?}");
    assert!(ran("$ cd hello-mtek") == 1, "{report:?}");
    assert!(
        ran("mtek.toml equals") == 1 && ran("src/main.mtek equals") == 1,
        "{report:?}"
    );
    assert!(ran("$ mtek check (exit 0)") == 2, "{report:?}");
    assert!(ran("$ mtek check (exit 1)") == 1, "{report:?}");
    assert!(
        ran("$ mtek check --format json (exit 1)") == 1,
        "{report:?}"
    );
    assert!(
        ran("edit: diff") == 1 && ran("break: diff") == 1 && ran("fix: diff") == 1,
        "{report:?}"
    );
    assert!(ran("$ mtek fmt --check (exit 0)") == 1, "{report:?}");
    if RUNTIME {
        assert!(report.not_run.is_empty(), "{:?}", report.not_run);
        assert!(ran("$ mtek build (exit 0)") == 2, "{report:?}");
        assert!(ran("$ mtek dev serves") == 1, "{report:?}");
        assert!(ran("printed the lines shown") == 3, "{report:?}");
        assert!(ran("overlay text equals") == 1, "{report:?}");
        assert!(ran("holds the files listed") == 1, "{report:?}");
        assert!(ran("development server is stopped") == 1, "{report:?}");
    } else {
        eprintln!(
            "NOT-RUN: the runtime-dependent steps of the walkthrough ({} of them): this binary was built without the runtime bundle (run `npm run build` first)",
            report.not_run.len()
        );
        assert!(!report.not_run.is_empty());
        assert!(ran("fails with MTEK-E9030") == 1, "{report:?}");
    }
}

/// The test must be able to fail: each mutant of the document is rejected, at the step that the
/// mutation is about.
#[test]
fn the_walkthrough_rejects_a_document_that_is_not_true() {
    let mutants: [(&str, &str, &str, &str); 5] = [
        (
            "output",
            "checked 'hello-mtek': 0 errors, 0 warnings",
            "checked 'hello-mtek': 1 error, 0 warnings",
            "the output differs from the document",
        ),
        (
            "exit code",
            "```console exit=1\n$ mtek check\n",
            "```console\n$ mtek check\n",
            "exited with 1, the document says 0",
        ),
        (
            "file",
            "title = \"Hello Mtek\"\n\n[host.inputs]",
            "title = \"Hello Mtek!\"\n\n[host.inputs]",
            "is not the file the document shows",
        ),
        (
            "fix",
            "+    return 0.65 + 0.35 * sin(t);\n }\n```\n\nThis is exactly",
            "+    return 0.65 + 0.35 * sin(t) ;\n }\n```\n\nThis is exactly",
            "does not restore the file",
        ),
        (
            "diagnostic text",
            "  |                                ^ expected `;`, found `}`\n  = help: end every statement, field and declaration with `;`\n\ncheck failed",
            "  |                                ^ expected `;`, found `}`\n  = help: end every statement with `;`\n\ncheck failed",
            "the output differs from the document",
        ),
    ];
    for (name, from, to, message) in mutants {
        assert!(
            DOC.contains(from),
            "mutant '{name}': the text to mutate is not in the document"
        );
        let scratch = Scratch::new(&format!("mutant-{}", name.replace(' ', "-")));
        let result = walk(
            &DOC.replacen(from, to, 1),
            &scratch,
            RUNTIME,
            MUTANT_PATIENCE,
        );
        match result {
            Err(e) if e.contains(message) => {}
            Err(e) => panic!("mutant '{name}' failed for another reason than '{message}': {e}"),
            Ok(_) => panic!("mutant '{name}' passed: the walkthrough does not check it"),
        }
    }
}

/// The overlay and the lines of the development server need a development server.
#[cfg(mtek_runtime_embedded)]
#[test]
fn the_walkthrough_rejects_a_wrong_overlay_and_a_wrong_dev_line() {
    for (from, to, message) in [
        (
            "src/main.mtek:2:32: error[MTEK-E1003]: Missing",
            "src/main.mtek:2:33: error[MTEK-E1003]: Missing",
            "the overlay text differs",
        ),
        (
            "build failed: 1 error, 0 warnings (<n> ms)",
            "build failed: 2 errors, 0 warnings (<n> ms)",
            "mtek dev did not print the lines",
        ),
    ] {
        assert_eq!(
            DOC.matches(from).count(),
            1,
            "'{from}' must be in the document once"
        );
        let scratch = Scratch::new("mutant-dev");
        match walk(&DOC.replacen(from, to, 1), &scratch, true, MUTANT_PATIENCE) {
            Err(e) if e.contains(message) => {}
            Err(e) => panic!("mutant '{to}' failed for another reason than '{message}': {e}"),
            Ok(_) => panic!("mutant '{to}' passed"),
        }
    }
}

#[test]
fn the_prerequisites_and_the_install_commands_are_the_repositorys() {
    let root = repo_root();
    let row = |start: &str| -> String {
        DOC.lines()
            .find(|l| l.starts_with(start))
            .unwrap_or_else(|| panic!("no table row '{start}'"))
            .to_owned()
    };
    let bold = |row: &str| -> String {
        let at = row.find("**").expect("a bold version") + 2;
        row[at..at + row[at..].find("**").unwrap()].to_owned()
    };

    let toolchain = fs::read_to_string(root.join("rust-toolchain.toml")).unwrap();
    let channel = toolchain
        .lines()
        .find_map(|l| l.strip_prefix("channel = "))
        .unwrap()
        .trim_matches('"');
    assert_eq!(
        bold(&row("| Rust,")),
        channel,
        "the Rust version of section 1 is not rust-toolchain.toml's"
    );

    let nvmrc = fs::read_to_string(root.join(".nvmrc")).unwrap();
    assert_eq!(
        bold(&row("| Node.js")),
        nvmrc.trim(),
        "the Node.js version of section 1 is not .nvmrc's"
    );
    let package: Value =
        serde_json::from_str(&fs::read_to_string(root.join("package.json")).unwrap()).unwrap();
    // `.nvmrc` pins the version CI uses; `engines` accepts it and everything from the floor of
    // decision 0161 on.
    let engines = package["engines"]["node"].as_str().unwrap();
    assert_eq!(engines, ">=22.18.0");
    assert!(nvmrc.trim().parse::<u32>().unwrap() >= 22);

    let items = parse_document(DOC);
    let install: Vec<&Fence> = items
        .iter()
        .filter_map(|i| match i {
            Item::Fence(f) if f.info.lang == "sh" && f.info.flag("install") => Some(f),
            _ => None,
        })
        .collect();
    assert_eq!(install.len(), 1, "exactly one `sh install` block");
    let cli_manifest = fs::read_to_string(root.join("crates/mtek-cli/Cargo.toml")).unwrap();
    for command in &install[0].body {
        match command.as_str() {
            "npm ci" => assert!(root.join("package-lock.json").is_file()),
            "npm run build" => {
                let script = package["scripts"]["build"].as_str().unwrap();
                assert!(
                    script.contains("--workspaces")
                        && script.contains("cargo build -p mtek-cli --locked"),
                    "{script}"
                );
                assert!(
                    package["workspaces"]
                        .as_array()
                        .is_some_and(|w| w.iter().any(|x| x == "packages/runtime-web"))
                );
            }
            "cargo install --path crates/mtek-cli --locked" => {
                assert!(cli_manifest.contains("name = \"mtek-cli\""));
                assert!(cli_manifest.contains("[[bin]]\nname = \"mtek\""));
                assert!(root.join("Cargo.lock").is_file());
            }
            other => panic!("the install block has a command nobody verifies: {other}"),
        }
    }
}

#[test]
fn every_relative_link_of_the_document_exists() {
    let docs = repo_root().join("docs");
    let mut checked = 0;
    for part in DOC.split("](").skip(1) {
        let target = part.split(')').next().unwrap();
        if target.starts_with("http") || target.starts_with('#') {
            continue;
        }
        let path = target.split('#').next().unwrap();
        assert!(
            docs.join(path).exists(),
            "broken link in docs/getting-started.md: {target}"
        );
        checked += 1;
    }
    assert!(checked >= 5, "only {checked} relative links found");
}

#[test]
fn the_normalisation_is_what_the_document_says_and_no_more() {
    assert_eq!(normalise("\u{1b}[1;31merror\u{1b}[0m: x\r\n"), "error: x\n");
    assert_eq!(
        normalise(
            "built 'a' (dev): 9 files in dist, build 7c4846274cc3a51e; 0 errors, 0 warnings (35 ms)"
        ),
        "built 'a' (dev): 9 files in dist, build <build id>; 0 errors, 0 warnings (<n> ms)"
    );
    // Not a build id: 15 digits, 17 digits, upper case.
    assert_eq!(normalise("build 7c4846274cc3a51"), "build 7c4846274cc3a51");
    assert_eq!(
        normalise("build 7c4846274cc3a51e0"),
        "build 7c4846274cc3a51e0"
    );
    assert_eq!(
        normalise("build 7C4846274CC3A51E"),
        "build 7C4846274CC3A51E"
    );
    // Other numbers stay: line and column, counts, a duration without the unit.
    assert_eq!(
        normalise(" --> src/main.mtek:2:32 (3 errors) (12)"),
        " --> src/main.mtek:2:32 (3 errors) (12)"
    );
    assert_eq!(
        normalise("http://127.0.0.1:5199/ (Ctrl+C"),
        "http://127.0.0.1:5173/ (Ctrl+C"
    );
    assert_eq!(
        hash_names("shaders/131089bf80118bdf.wgsl"),
        "shaders/<hash>.wgsl"
    );
    assert_eq!(
        hash_names("runtime.c0a0e4631c640c28.js"),
        "runtime.<hash>.js"
    );
    assert_eq!(hash_names("app.js.map"), "app.js.map");
    assert_eq!(
        hash_names("deadbeefdeadbeefdead.js"),
        "deadbeefdeadbeefdead.js"
    );
}

#[test]
fn diffs_apply_only_where_the_document_says() {
    let text = "a\nb\nc\n";
    let diff = |lines: &[&str]| {
        apply_diff(
            text,
            &lines.iter().map(|l| (*l).to_owned()).collect::<Vec<_>>(),
        )
    };
    assert_eq!(
        diff(&[" a", "-b", "+x", "+y", " c"]).unwrap(),
        "a\nx\ny\nc\n"
    );
    assert!(diff(&["-z", "+x"]).is_err(), "text that is not there");
    assert!(
        apply_diff("a\na\n", &["-a".to_owned(), "+b".to_owned()]).is_err(),
        "text that is there twice"
    );
    assert!(diff(&["?a"]).is_err());
    let edits = [
        TextEdit {
            start: 1,
            end: 1,
            replacement: ";".to_owned(),
        },
        TextEdit {
            start: 2,
            end: 3,
            replacement: "XY".to_owned(),
        },
    ];
    assert_eq!(apply_edits("abc", &edits), "a;bXY");
}

/// The troubleshooting table of the document names what the tool really prints.
#[test]
fn the_troubleshooting_table_names_what_the_tool_prints() {
    let scratch = Scratch::new("trouble");
    let empty = scratch.0.join("work");

    // `MTEK-E9004`: no mtek.toml in the current directory or above it.
    assert!(DOC.contains(
        "| `MTEK-E9004` | there is no `mtek.toml` in the current directory or above it |"
    ));
    let log = scratch.0.join("logs").join("e9004.log");
    let mut child = spawn_mtek(&["check".to_owned()], &empty, &log).unwrap();
    assert_eq!(wait_for(&mut child).unwrap(), 1);
    assert!(
        read_log(&log).contains("error[MTEK-E9004]: No mtek.toml found in the current directory")
    );

    // The port line: the port asked for is taken, the next one is used and the terminal says so.
    assert!(DOC.contains("`mtek dev: port 5173 is in use; using port 5174`"));
    let project = empty.join("p");
    fs::create_dir_all(project.join("src")).unwrap();
    fs::write(
        project.join("mtek.toml"),
        "[project]
name = \"p\"
language = \"0.1\"
",
    )
    .unwrap();
    fs::write(
        project.join("src/main.mtek"),
        "scene Demo {
    camera Main {}
}
",
    )
    .unwrap();
    let taken = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = taken.local_addr().unwrap().port();
    let log = scratch.0.join("logs").join("port.log");
    let child = spawn_mtek(
        &["dev".to_owned(), "--port".to_owned(), port.to_string()],
        &project,
        &log,
    )
    .unwrap();
    let mut dev = Dev {
        child,
        log,
        port: 0,
        consumed: 0,
        patience: PATIENCE,
    };
    let wanted = format!("mtek dev: port {port} is in use; using port ");
    let deadline = Instant::now() + PATIENCE;
    while !read_log(&dev.log).lines().any(|l| l.starts_with(&wanted)) {
        assert!(
            Instant::now() < deadline,
            "no port line in:
{}",
            read_log(&dev.log)
        );
        std::thread::sleep(Duration::from_millis(40));
    }
    dev.stop();
}

#[test]
fn the_document_has_the_blocks_the_walkthrough_needs() {
    let items = parse_document(DOC);
    let fences: Vec<&Fence> = items
        .iter()
        .filter_map(|i| {
            if let Item::Fence(f) = i {
                Some(f)
            } else {
                None
            }
        })
        .collect();
    let console = fences.iter().filter(|f| f.info.lang == "console").count();
    assert!(console >= 12, "{console} console blocks");
    assert!(items.iter().any(|i| matches!(i, Item::Stop { .. })));
    for role in ["edit", "break", "fix"] {
        assert_eq!(
            fences
                .iter()
                .filter(|f| f.info.attr("role") == Some(role))
                .count(),
            1,
            "diff role {role}"
        );
    }
    assert!(fences.iter().any(|f| f.info.flag("overlay")));
    assert!(fences.iter().any(|f| f.info.attr("files") == Some("dist")));
    // The commands the document teaches are the ones it runs.
    for command in [
        "mtek new hello-mtek",
        "mtek check",
        "mtek build",
        "mtek dev",
        "mtek fmt --check",
        "mtek check --format json",
    ] {
        assert!(
            fences.iter().any(|f| f.info.lang == "console"
                && f.body.first().is_some_and(|l| l == &format!("$ {command}"))),
            "no console block runs `{command}`"
        );
    }
}
