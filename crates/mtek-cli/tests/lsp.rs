//! `mtek lsp` end to end: the real binary over standard input and output, driven with scripted
//! JSON-RPC sessions (`spec/tooling.md` section 7, decision 0076).
//!
//! Every session is a project in a temporary directory and a child process. The client side
//! frames messages itself (`Content-Length`), reads the server's output on a thread so that a
//! stalled server fails a test instead of hanging it, and treats anything on stdout that is not a
//! well-formed frame as a failure: stdout belongs to the protocol.

// Test-only code: helper functions outside `#[test]` functions may unwrap and panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

const TOML: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";

/// How long the client waits for anything from the server.
const WAIT: Duration = Duration::from_secs(60);

/// A fresh project directory, removed on drop.
struct Project(PathBuf);

impl Project {
    fn new(name: &str, files: &[(&str, &str)]) -> Self {
        let dir = std::env::temp_dir().join(format!("mtek-lsp-it-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let project = Project(dir);
        project.write("mtek.toml", TOML);
        for (path, text) in files {
            project.write(path, text);
        }
        project
    }

    fn write(&self, relative: &str, text: &str) {
        let path = self.0.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    /// The `file:` URI of a project file, as VS Code writes it.
    fn uri(&self, relative: &str) -> String {
        file_uri(&self.0.join(relative))
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn file_uri(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let text = if text.starts_with('/') {
        text
    } else {
        // `C:/dir` is `/c%3A/dir`.
        let mut chars = text.chars();
        let drive = chars.next().unwrap().to_ascii_lowercase();
        let rest: String = chars.collect();
        format!("/{drive}%3A{}", rest.strip_prefix(':').unwrap_or(&rest))
    };
    let mut out = String::from("file://");
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let byte = bytes[i];
        let escaped = byte == b'%'
            && bytes.get(i + 1).is_some_and(u8::is_ascii_hexdigit)
            && bytes.get(i + 2).is_some_and(u8::is_ascii_hexdigit);
        if escaped || byte == b'/' || byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
        i += 1;
    }
    out
}

/// What the reader thread found on the server's stdout.
enum Frame {
    Message(Value),
    /// Something that is not a frame of the protocol: a failure of the server.
    Garbage(String),
    End,
}

fn read_frames(stdout: impl Read, sender: &mpsc::Sender<Frame>) {
    let mut reader = BufReader::new(stdout);
    loop {
        let mut length = None;
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    if length.is_some() {
                        let _ = sender.send(Frame::Garbage("end inside a header".to_owned()));
                    }
                    let _ = sender.send(Frame::End);
                    return;
                }
                Ok(_) => {}
                Err(error) => {
                    let _ = sender.send(Frame::Garbage(format!("read error {error}")));
                    return;
                }
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                break;
            }
            match line.strip_prefix("Content-Length: ") {
                Some(value) => length = value.parse::<usize>().ok(),
                None => {
                    let _ = sender.send(Frame::Garbage(format!("not a header: {line:?}")));
                    return;
                }
            }
        }
        let Some(length) = length else {
            let _ = sender.send(Frame::Garbage("a frame without a length".to_owned()));
            return;
        };
        let mut body = vec![0u8; length];
        if reader.read_exact(&mut body).is_err() {
            let _ = sender.send(Frame::Garbage("a truncated frame".to_owned()));
            return;
        }
        match serde_json::from_slice(&body) {
            Ok(value) => {
                if sender.send(Frame::Message(value)).is_err() {
                    return;
                }
            }
            Err(error) => {
                let _ = sender.send(Frame::Garbage(format!("a body that is not JSON: {error}")));
                return;
            }
        }
    }
}

struct Client {
    child: Child,
    stdin: Option<ChildStdin>,
    frames: Receiver<Frame>,
    /// Messages read while waiting for something else.
    queue: Vec<Value>,
    next_id: i64,
    ended: bool,
}

impl Client {
    fn spawn(args: &[&str]) -> Client {
        let mut child = Command::new(env!("CARGO_BIN_EXE_mtek"))
            .arg("lsp")
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let (sender, frames) = mpsc::channel();
        thread::spawn(move || read_frames(stdout, &sender));
        Client {
            child,
            stdin,
            frames,
            queue: Vec::new(),
            next_id: 1,
            ended: false,
        }
    }

    fn send_raw(&mut self, bytes: &[u8]) {
        let stdin = self.stdin.as_mut().expect("stdin is open");
        // A server that already ended is not an error of the client.
        let _ = stdin.write_all(bytes).and_then(|()| stdin.flush());
    }

    fn send(&mut self, message: &Value) {
        let body = message.to_string();
        let framed = format!("Content-Length: {}\r\n\r\n{body}", body.len());
        self.send_raw(framed.as_bytes());
    }

    fn notify(&mut self, method: &str, params: Value) {
        self.send(&json!({"jsonrpc": "2.0", "method": method, "params": params}));
    }

    /// The next message from the server, from the queue first.
    fn next_message(&mut self) -> Value {
        if !self.queue.is_empty() {
            return self.queue.remove(0);
        }
        self.read()
    }

    fn read(&mut self) -> Value {
        match self.frames.recv_timeout(WAIT) {
            Ok(Frame::Message(value)) => value,
            Ok(Frame::Garbage(what)) => {
                panic!("the server wrote something that is not a frame: {what}")
            }
            Ok(Frame::End) => {
                self.ended = true;
                panic!(
                    "the server's output ended while a message was expected; queued: {:?}",
                    self.queue
                )
            }
            Err(RecvTimeoutError::Timeout) => panic!(
                "no message from the server in {WAIT:?}; queued: {:?}",
                self.queue
            ),
            Err(RecvTimeoutError::Disconnected) => panic!("the reader is gone"),
        }
    }

    /// Send a request and wait for its response (the whole message: `result` or `error`).
    fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        self.send(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        self.response(&json!(id))
    }

    fn response(&mut self, id: &Value) -> Value {
        loop {
            let message = self.read();
            if message.get("method").is_none() && message["id"] == *id {
                return message;
            }
            self.queue.push(message);
        }
    }

    /// `initialize` and `initialized`; the `result` of the initialize response.
    fn initialize(&mut self, capabilities: Value) -> Value {
        let response = self.request(
            "initialize",
            json!({"processId": null, "rootUri": null, "capabilities": capabilities}),
        );
        assert!(response["error"].is_null(), "{response}");
        self.notify("initialized", json!({}));
        response["result"].clone()
    }

    fn open(&mut self, uri: &str, text: &str) {
        self.notify(
            "textDocument/didOpen",
            json!({"textDocument": {"uri": uri, "languageId": "mtek", "version": 1, "text": text}}),
        );
    }

    fn change(&mut self, uri: &str, version: i64, text: &str) {
        self.notify(
            "textDocument/didChange",
            json!({"textDocument": {"uri": uri, "version": version}, "contentChanges": [{"text": text}]}),
        );
    }

    /// The next `publishDiagnostics` for `uri`.
    fn diagnostics(&mut self, uri: &str) -> Vec<Value> {
        loop {
            let message = self.next_message();
            if message["method"] == "textDocument/publishDiagnostics"
                && message["params"]["uri"] == *uri
            {
                return message["params"]["diagnostics"].as_array().unwrap().clone();
            }
        }
    }

    /// The next message that is a notification or request with this method.
    fn wait_for(&mut self, method: &str) -> Value {
        loop {
            let message = self.next_message();
            if message["method"] == method {
                return message;
            }
        }
    }

    /// Close standard input and wait for the exit code.
    fn finish(mut self) -> i32 {
        self.stdin = None;
        self.wait()
    }

    fn wait(&mut self) -> i32 {
        let start = Instant::now();
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status
                    .code()
                    .expect("the server ended without an exit code (a signal)");
            }
            assert!(start.elapsed() < WAIT, "the server did not end");
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn shutdown_and_exit(&mut self) -> i32 {
        let response = self.request("shutdown", Value::Null);
        assert!(response["error"].is_null(), "{response}");
        assert_eq!(response["result"], Value::Null);
        self.notify("exit", Value::Null);
        self.wait()
    }

    /// What the server wrote to standard error.
    fn stderr(&mut self) -> String {
        let mut text = String::new();
        if let Some(mut stderr) = self.child.stderr.take() {
            let _ = stderr.read_to_string(&mut text);
        }
        text
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn pos(line: u32, character: u32) -> Value {
    json!({"line": line, "character": character})
}

fn at(uri: &str, line: u32, character: u32) -> Value {
    json!({"textDocument": {"uri": uri}, "position": pos(line, character)})
}

const LIB: &str = "\
/// A point light.
export struct Light {
    intensity: f32;
}

/// Doubles a number.
export fn double(x: f32) -> f32 {
    return x * 2.0;
}
";

/// Two errors, with multi-byte text before both on the first line and a validated edit for the
/// first: `1.` (E0022, edit `1.0`) and `Unknown` (E2003, no edit).
const BROKEN: &str = "\
import { double } from \"./lib.mtek\";
/* \u{e9}\u{1f600} */ const A: f32 = 1.;
const B: f32 = Unknown;
scene Demo {
    camera Main {}
    entity Cube { mesh: Box {}; }
}
";

/// Apply LSP text edits (UTF-16 columns) to `text`.
fn apply(text: &str, edits: &[Value]) -> String {
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let offset = |p: &Value| -> usize {
        let line = usize::try_from(p["line"].as_u64().unwrap()).unwrap();
        let mut units = usize::try_from(p["character"].as_u64().unwrap()).unwrap();
        let before: usize = lines.iter().take(line).map(|l| l.len()).sum();
        let mut bytes = 0;
        for c in lines.get(line).copied().unwrap_or("").chars() {
            if units == 0 {
                break;
            }
            units = units.saturating_sub(c.len_utf16());
            bytes += c.len_utf8();
        }
        before + bytes
    };
    let mut ranges: Vec<(usize, usize, String)> = edits
        .iter()
        .map(|e| {
            (
                offset(&e["range"]["start"]),
                offset(&e["range"]["end"]),
                e["newText"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    ranges.sort();
    let mut out = String::new();
    let mut cursor = 0;
    for (start, end, replacement) in ranges {
        out.push_str(&text[cursor..start]);
        out.push_str(&replacement);
        cursor = end;
    }
    out.push_str(&text[cursor..]);
    out
}

// ----- a whole session ---------------------------------------------------------------------

#[test]
fn a_whole_session_diagnostics_hover_definition_completion_and_a_quick_fix() {
    let project = Project::new(
        "session",
        &[("src/lib.mtek", LIB), ("src/main.mtek", BROKEN)],
    );
    let mut client = Client::spawn(&[]);
    let result = client.initialize(json!({}));
    assert_eq!(result["capabilities"]["positionEncoding"], "utf-16");
    assert_eq!(result["capabilities"]["textDocumentSync"]["change"], 1);
    let uri = project.uri("src/main.mtek");
    client.open(&uri, BROKEN);

    // Diagnostics: exact ranges in UTF-16 after `/* é😀 */ ` (10 units) and `const A: f32 = ` (15).
    let diagnostics = client.diagnostics(&uri);
    assert_eq!(diagnostics.len(), 2, "{diagnostics:#?}");
    let float = diagnostics
        .iter()
        .find(|d| d["code"] == "MTEK-E0022")
        .unwrap();
    assert_eq!(
        float["range"],
        json!({"start": pos(1, 25), "end": pos(1, 27)})
    );
    assert_eq!(float["severity"], 1);
    assert_eq!(float["source"], "mtek");
    let unknown = diagnostics
        .iter()
        .find(|d| d["code"] == "MTEK-E2003")
        .unwrap();
    assert_eq!(
        unknown["range"],
        json!({"start": pos(2, 15), "end": pos(2, 22)})
    );

    // Hover on `double` in the import list: the declaration and its doc comment, from lib.mtek.
    let hover = client.request("textDocument/hover", at(&uri, 0, 10));
    let markdown = hover["result"]["contents"]["value"].as_str().unwrap();
    assert!(
        markdown.contains("fn double(x: f32) -> f32") && markdown.contains("Doubles a number."),
        "{markdown}"
    );
    assert_eq!(
        hover["result"]["range"],
        json!({"start": pos(0, 9), "end": pos(0, 15)})
    );
    // Hover on `Box`: the registry's documentation.
    let hover = client.request("textDocument/hover", at(&uri, 5, 25));
    assert!(
        hover["result"]["contents"]["value"]
            .as_str()
            .unwrap()
            .contains("schema Box"),
        "{hover}"
    );

    // Definition: the import goes to lib.mtek; `Box` to the standard library's document.
    let definition = client.request("textDocument/definition", at(&uri, 0, 10));
    assert_eq!(definition["result"]["uri"], project.uri("src/lib.mtek"));
    assert_eq!(
        definition["result"]["range"],
        json!({"start": pos(6, 10), "end": pos(6, 16)})
    );
    let definition = client.request("textDocument/definition", at(&uri, 5, 25));
    assert_eq!(
        definition["result"]["uri"],
        "mtek-prelude:/std/prelude.mtek"
    );
    let content = client.request(
        "workspace/textDocumentContent",
        json!({"uri": "mtek-prelude:/std/prelude.mtek"}),
    );
    assert!(
        content["result"]["text"]
            .as_str()
            .unwrap()
            .contains("schema Box"),
        "{content}"
    );

    // Completion on the unsaved text: members of `Key`.
    let typing = BROKEN.replace("const B: f32 = Unknown;", "const B: bool = Key.;");
    client.change(&uri, 2, &typing);
    let completion = client.request("textDocument/completion", at(&uri, 2, 20));
    let items = completion["result"]["items"].as_array().unwrap();
    assert!(items.iter().any(|i| i["label"] == "Space"), "{completion}");
    client.change(&uri, 3, BROKEN);

    // The quick fix, applied, leaves the other error only; fixing that too leaves a clean file.
    let actions = client.request(
        "textDocument/codeAction",
        json!({"textDocument": {"uri": uri}, "range": float["range"], "context": {"diagnostics": [float]}}),
    );
    let actions = actions["result"].as_array().unwrap();
    assert_eq!(actions.len(), 1, "{actions:?}");
    assert_eq!(actions[0]["title"], "write the float literal as `1.0`");
    let fixed = apply(
        BROKEN,
        actions[0]["edit"]["changes"][&uri].as_array().unwrap(),
    );
    assert!(fixed.contains("const A: f32 = 1.0;"), "{fixed}");
    client.change(&uri, 4, &fixed);
    let diagnostics = client.diagnostics(&uri);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
    assert_eq!(diagnostics[0]["code"], "MTEK-E2003");
    client.change(&uri, 5, &fixed.replace("Unknown", "A"));
    assert!(client.diagnostics(&uri).is_empty());

    assert_eq!(client.shutdown_and_exit(), 0);
}

#[test]
fn utf8_columns_are_used_when_the_client_offers_them() {
    let project = Project::new("utf8", &[("src/lib.mtek", LIB), ("src/main.mtek", BROKEN)]);
    let mut client = Client::spawn(&["--stdio"]);
    let result = client.initialize(json!({"general": {"positionEncodings": ["utf-8", "utf-16"]}}));
    assert_eq!(result["capabilities"]["positionEncoding"], "utf-8");
    let uri = project.uri("src/main.mtek");
    client.open(&uri, BROKEN);
    let diagnostics = client.diagnostics(&uri);
    let float = diagnostics
        .iter()
        .find(|d| d["code"] == "MTEK-E0022")
        .unwrap();
    // The é and the emoji are 2 + 4 bytes, 3 UTF-16 units: three more columns than in UTF-16.
    assert_eq!(
        float["range"],
        json!({"start": pos(1, 28), "end": pos(1, 30)})
    );
    // A hover position counted in bytes finds the name: `A` (a constant) after the comment.
    let hover = client.request("textDocument/hover", at(&uri, 1, 22));
    assert!(hover["result"].is_object(), "{hover}");
    assert_eq!(client.shutdown_and_exit(), 0);
}

#[test]
fn files_that_change_on_disk_are_analysed_again() {
    let main = "import { double } from \"./lib.mtek\";\nscene Demo { camera Main {} }\n";
    let project = Project::new(
        "disk",
        &[
            (
                "src/lib.mtek",
                "export fn double(x: f32) -> f32 { return Nope; }\n",
            ),
            ("src/main.mtek", main),
        ],
    );
    let mut client = Client::spawn(&[]);
    client
        .initialize(json!({"workspace": {"didChangeWatchedFiles": {"dynamicRegistration": true}}}));
    let uri = project.uri("src/main.mtek");
    client.open(&uri, main);
    // The client is asked to watch files (the registration comes after `initialized`).
    let registration = client.wait_for("client/registerCapability");
    assert_eq!(
        registration["params"]["registrations"][0]["method"],
        "workspace/didChangeWatchedFiles"
    );
    let globs: Vec<&str> =
        registration["params"]["registrations"][0]["registerOptions"]["watchers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w["globPattern"].as_str().unwrap())
            .collect();
    assert!(
        globs.contains(&"**/*.mtek") && globs.contains(&"**/mtek.toml"),
        "{globs:?}"
    );
    let lib = project.uri("src/lib.mtek");
    let in_lib = client.diagnostics(&lib);
    assert_eq!(in_lib[0]["code"], "MTEK-E2003", "{in_lib:?}");
    // The file is fixed by another tool.
    project.write(
        "src/lib.mtek",
        "export fn double(x: f32) -> f32 { return x; }\n",
    );
    client.notify(
        "workspace/didChangeWatchedFiles",
        json!({"changes": [{"uri": lib, "type": 2}]}),
    );
    assert!(client.diagnostics(&lib).is_empty());
    assert_eq!(client.shutdown_and_exit(), 0);
}

// ----- the exit protocol -------------------------------------------------------------------

#[test]
fn exit_after_shutdown_is_zero_and_without_it_is_one() {
    let mut client = Client::spawn(&[]);
    client.initialize(json!({}));
    assert_eq!(client.shutdown_and_exit(), 0);

    let mut client = Client::spawn(&[]);
    client.initialize(json!({}));
    client.notify("exit", Value::Null);
    assert_eq!(client.wait(), 1);

    // The input ends: without a shutdown that is a failure, after one it is not.
    let mut client = Client::spawn(&[]);
    client.initialize(json!({}));
    assert_eq!(client.finish(), 1);

    let mut client = Client::spawn(&[]);
    client.initialize(json!({}));
    let response = client.request("shutdown", Value::Null);
    assert_eq!(response["result"], Value::Null);
    assert_eq!(client.finish(), 0);

    // Nothing at all was sent.
    let client = Client::spawn(&[]);
    assert_eq!(client.finish(), 1);
}

#[test]
fn requests_out_of_order_are_errors_and_the_server_goes_on() {
    let mut client = Client::spawn(&[]);
    let response = client.request("textDocument/hover", at("file:///x.mtek", 0, 0));
    assert_eq!(response["error"]["code"], -32002);
    client.initialize(json!({}));
    let response = client.request("initialize", json!({}));
    assert_eq!(response["error"]["code"], -32600);
    let response = client.request("no/such/method", json!({}));
    assert_eq!(response["error"]["code"], -32601);
    let response = client.request("textDocument/hover", json!({"textDocument": 3}));
    assert_eq!(response["error"]["code"], -32602);
    assert_eq!(client.shutdown_and_exit(), 0);
}

// ----- garbage -------------------------------------------------------------------------------

#[test]
fn a_payload_that_is_not_json_is_answered_with_a_null_id_and_the_session_goes_on() {
    let mut client = Client::spawn(&[]);
    for body in ["{not json", "", "[1, 2]", "3"] {
        client.send_raw(format!("Content-Length: {}\r\n\r\n{body}", body.len()).as_bytes());
        let reply = client.read();
        assert_eq!(reply["id"], Value::Null, "{body:?}: {reply}");
        let code = reply["error"]["code"].as_i64().unwrap();
        assert!(code == -32700 || code == -32600, "{body:?}: {reply}");
    }
    // A request without a method keeps its id in the error.
    client.send(&json!({"jsonrpc": "2.0", "id": 41}));
    let reply = client.read();
    assert_eq!(reply["id"], 41);
    assert_eq!(reply["error"]["code"], -32600);
    // And the session works.
    client.initialize(json!({}));
    assert_eq!(client.shutdown_and_exit(), 0);
}

#[test]
fn damaged_framing_ends_the_session_with_code_one_and_a_reason_on_stderr() {
    for (name, bytes) in [
        ("no length", b"Content-Type: x\r\n\r\n{}".to_vec()),
        ("bad length", b"Content-Length: nope\r\n\r\n".to_vec()),
        (
            "huge length",
            b"Content-Length: 99999999999999\r\n\r\n".to_vec(),
        ),
        (
            "truncated body",
            b"Content-Length: 50\r\n\r\n{\"a\":1}".to_vec(),
        ),
        ("not a header", b"GET / HTTP/1.1\r\n\r\n".to_vec()),
    ] {
        let mut client = Client::spawn(&[]);
        client.send_raw(&bytes);
        let code = client.finish_keeping_stderr();
        assert_eq!(code, 1, "{name}");
        let stderr = client.stderr();
        assert!(stderr.starts_with("mtek lsp:"), "{name}: {stderr:?}");
        assert!(!stderr.contains("panicked"), "{name}: {stderr:?}");
    }
}

impl Client {
    fn finish_keeping_stderr(&mut self) -> i32 {
        self.stdin = None;
        self.wait()
    }
}

#[test]
fn random_bytes_never_crash_the_server() {
    // A deterministic stream of bytes, in a few shapes: all noise, noise with framing around it.
    let mut state = 0x9e37_79b9_7f4a_7c15u64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    for round in 0..6 {
        let mut bytes = Vec::new();
        for _ in 0..(4096 << (round % 3)) {
            bytes.push(next().to_le_bytes()[0]);
        }
        if round % 2 == 1 {
            // Well-framed garbage: valid headers, arbitrary bodies, then more noise.
            let body: Vec<u8> = (0..300).map(|_| next().to_le_bytes()[1]).collect();
            let mut framed = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
            framed.extend(body);
            framed.extend(bytes);
            bytes = framed;
        }
        let mut client = Client::spawn(&[]);
        client.send_raw(&bytes);
        let code = client.finish_keeping_stderr();
        assert!(code == 1 || code == 0, "round {round}: exit code {code}");
        let stderr = client.stderr();
        assert!(!stderr.contains("panicked"), "round {round}: {stderr:?}");
    }
}

#[test]
fn nonsense_messages_and_parameters_never_end_the_session() {
    let project = Project::new(
        "nonsense",
        &[("src/lib.mtek", LIB), ("src/main.mtek", BROKEN)],
    );
    let mut client = Client::spawn(&[]);
    client.initialize(json!({}));
    let uri = project.uri("src/main.mtek");
    client.open(&uri, BROKEN);
    // Notifications that do not make sense, in every shape.
    for method in [
        "textDocument/didOpen",
        "textDocument/didChange",
        "textDocument/didClose",
        "textDocument/didSave",
        "workspace/didChangeWatchedFiles",
        "$/cancelRequest",
        "who/knows",
    ] {
        for params in [
            json!(null),
            json!([]),
            json!({}),
            json!({"textDocument": null}),
            json!(7),
            json!("text"),
            json!({"textDocument": {"uri": 5}}),
        ] {
            client.notify(method, params);
        }
    }
    // Positions that are not in the file, in every request.
    for (line, character) in [
        (0, 0),
        (9999, 0),
        (0, 9999),
        (2, 4_000_000_000u32),
        (4_000_000_000u32, 4_000_000_000u32),
    ] {
        for method in [
            "textDocument/hover",
            "textDocument/definition",
            "textDocument/completion",
        ] {
            let response = client.request(method, at(&uri, line, character));
            assert!(
                response["error"].is_null(),
                "{method} at {line}:{character}: {response}"
            );
        }
    }
    let response = client.request(
        "textDocument/hover",
        at("file:///does/not/exist.mtek", 0, 0),
    );
    assert_eq!(response["result"], Value::Null);
    // The buffer is still the one the client opened.
    let hover = client.request("textDocument/hover", at(&uri, 0, 10));
    assert!(
        hover["result"]["contents"]["value"]
            .as_str()
            .unwrap()
            .contains("fn double"),
        "{hover}"
    );
    assert_eq!(client.shutdown_and_exit(), 0);
}

#[test]
fn stdout_carries_only_the_protocol_and_the_help_lists_the_command() {
    let output = Command::new(env!("CARGO_BIN_EXE_mtek"))
        .arg("--help")
        .output()
        .unwrap();
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("lsp"), "{help}");
    let output = Command::new(env!("CARGO_BIN_EXE_mtek"))
        .args(["lsp", "--help"])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("--stdio")
    );
    // With no input the server says nothing on stdout.
    let output = Command::new(env!("CARGO_BIN_EXE_mtek"))
        .arg("lsp")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
}
