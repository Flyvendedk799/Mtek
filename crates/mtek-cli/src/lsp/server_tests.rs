//! Tests of the server state machine: the protocol lifecycle, text synchronisation, the
//! debounce on a manual clock, diagnostics (with multi-byte text, in both position encodings),
//! hover, definition, completion and code actions as a client sees them, and what happens to
//! garbage. The server is driven in-process; `tests/lsp.rs` drives the real binary.

use std::sync::Arc;

use lsp_server::{ErrorCode, Message, Notification, Request, RequestId};
use mtek_compiler::source::LineIndex;
use serde_json::{Value, json};

use super::clock::ManualClock;
use super::position::PositionEncoding;
use super::server::{DEBOUNCE_MS, Server};
use super::testkit::{TempProject, cursor};
use super::transport::{Inbound, Outbound};

const MAIN: &str = "\
import { Light, double } from \"./lib.mtek\";

/// Pulse speed in radians per second.
const SPEED: f32 = 0.7;

scene Demo {
    state speed: f32 = SPEED;
    camera Main { position: vec3(0.0, 2.0, 5.0); }
    entity Cube {
        mesh: Box { size: vec3(1.0, 1.0, 1.0) };
        update(dt: f32) {
            let angle = double(speed) * dt;
            self.rotation *= quat.axis_angle(vec3(0.0, 1.0, 0.0), angle);
        }
    }
    on key_down(Key.Space) {
        speed = -speed;
    }
}
";

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

struct Harness {
    server: Server,
    clock: ManualClock,
    next_id: i32,
    /// Messages the server sent that no one has looked at yet.
    inbox: Vec<Message>,
    rejections: Vec<(Option<RequestId>, i32)>,
    project: TempProject,
}

type Failure = (i32, String);

impl Harness {
    fn new(files: &[(&str, &str)]) -> Self {
        let clock = ManualClock::new();
        Harness {
            server: Server::new(Box::new(clock.clone())),
            clock,
            next_id: 1,
            inbox: Vec::new(),
            rejections: Vec::new(),
            project: TempProject::new(files),
        }
    }

    /// A harness whose project is the standard two-module one, initialised with `capabilities`.
    fn standard(capabilities: Value) -> Self {
        let mut h = Self::new(&[("src/lib.mtek", LIB), ("src/main.mtek", MAIN)]);
        h.initialize(json!({ "capabilities": capabilities })).unwrap();
        h
    }

    fn uri(&self, relative: &str) -> String {
        self.project.uri(relative)
    }

    fn collect(&mut self) {
        for outbound in self.server.take_outgoing() {
            match outbound {
                Outbound::Message(message) => self.inbox.push(message),
                Outbound::Rejection { id, code, .. } => self.rejections.push((id, code as i32)),
            }
        }
    }

    fn send(&mut self, inbound: Inbound) {
        self.server.handle(inbound);
        self.collect();
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, Failure> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(Inbound::Request(Request {
            id: RequestId::from(id),
            method: method.to_owned(),
            params,
        }));
        let index = self
            .inbox
            .iter()
            .position(|m| matches!(m, Message::Response(r) if r.id == RequestId::from(id)))
            .unwrap_or_else(|| panic!("no response to {method}"));
        let Message::Response(response) = self.inbox.remove(index) else {
            unreachable!()
        };
        match response.response_result {
            Ok(value) => Ok(value),
            Err(error) => Err((error.code, error.message)),
        }
    }

    fn notify(&mut self, method: &str, params: Value) {
        self.send(Inbound::Notification(Notification {
            method: method.to_owned(),
            params,
        }));
    }

    fn initialize(&mut self, params: Value) -> Result<Value, Failure> {
        let result = self.request("initialize", params)?;
        self.notify("initialized", json!({}));
        Ok(result)
    }

    fn poll(&mut self) {
        self.server.poll();
        self.collect();
    }

    fn advance(&mut self, ms: u64) {
        self.clock.advance(ms);
        self.poll();
    }

    fn open(&mut self, relative: &str, text: &str) {
        let uri = self.uri(relative);
        self.open_uri(&uri, text, 1);
    }

    fn open_uri(&mut self, uri: &str, text: &str, version: i32) {
        self.notify(
            "textDocument/didOpen",
            json!({"textDocument": {"uri": uri, "languageId": "mtek", "version": version, "text": text}}),
        );
    }

    fn change(&mut self, uri: &str, version: i32, text: &str) {
        self.notify(
            "textDocument/didChange",
            json!({"textDocument": {"uri": uri, "version": version}, "contentChanges": [{"text": text}]}),
        );
    }

    /// The `publishDiagnostics` notifications since the last call: `(uri, version, diagnostics)`.
    fn published(&mut self) -> Vec<(String, Option<i64>, Vec<Value>)> {
        let mut out = Vec::new();
        let mut rest = Vec::new();
        for message in self.inbox.drain(..) {
            match message {
                Message::Notification(n) if n.method == "textDocument/publishDiagnostics" => {
                    let uri = n.params["uri"].as_str().unwrap().to_owned();
                    let version = n.params["version"].as_i64();
                    let diagnostics = n.params["diagnostics"].as_array().unwrap().clone();
                    out.push((uri, version, diagnostics));
                }
                other => rest.push(other),
            }
        }
        self.inbox = rest;
        out
    }

    fn published_for(&mut self, uri: &str) -> Vec<Vec<Value>> {
        self.published()
            .into_iter()
            .filter(|(u, _, _)| u == uri)
            .map(|(_, _, d)| d)
            .collect()
    }
}

fn pos(line: u32, character: u32) -> Value {
    json!({"line": line, "character": character})
}

fn at(uri: &str, line: u32, character: u32) -> Value {
    json!({"textDocument": {"uri": uri}, "position": pos(line, character)})
}

/// The `(line, character)` of the byte offset `offset` of `text` in UTF-16 units.
fn utf16_position(text: &str, offset: u32) -> (u32, u32) {
    let lines = LineIndex::new(Arc::from(text));
    let p = PositionEncoding::Utf16.position(&lines, offset);
    (p.line, p.character)
}

fn code_of(diagnostic: &Value) -> &str {
    diagnostic["code"].as_str().unwrap()
}

// ----- protocol lifecycle ----------------------------------------------------------------------

#[test]
fn initialize_answers_with_the_capabilities_of_the_features() {
    let mut h = Harness::new(&[]);
    let result = h.initialize(json!({"capabilities": {}})).unwrap();
    let c = &result["capabilities"];
    assert_eq!(c["positionEncoding"], "utf-16");
    assert_eq!(c["textDocumentSync"]["openClose"], true);
    assert_eq!(c["textDocumentSync"]["change"], 1, "full text sync");
    assert_eq!(c["hoverProvider"], true);
    assert_eq!(c["definitionProvider"], true);
    assert_eq!(c["completionProvider"]["triggerCharacters"], json!(["."]));
    assert_eq!(c["codeActionProvider"]["codeActionKinds"], json!(["quickfix"]));
    assert_eq!(c["workspace"]["textDocumentContent"]["schemes"], json!(["mtek-prelude"]));
    assert_eq!(result["serverInfo"]["name"], "mtek");
}

#[test]
fn the_position_encoding_is_utf8_when_offered_and_utf16_otherwise() {
    for (offered, expected) in [
        (json!(["utf-16"]), "utf-16"),
        (json!(["utf-8", "utf-16"]), "utf-8"),
        (json!(["utf-16", "utf-8", "utf-32"]), "utf-8"),
        (json!(["utf-32"]), "utf-16"),
        (json!([]), "utf-16"),
        (json!("utf-8"), "utf-16"),
        (Value::Null, "utf-16"),
    ] {
        let mut h = Harness::new(&[]);
        let result = h
            .initialize(json!({"capabilities": {"general": {"positionEncodings": offered}}}))
            .unwrap();
        assert_eq!(result["capabilities"]["positionEncoding"], expected, "{offered}");
    }
}

#[test]
fn initialize_accepts_clients_that_send_nothing_useful() {
    for params in [Value::Null, json!([]), json!({}), json!({"capabilities": 5}), json!({"capabilities": {"general": 3}})] {
        let mut h = Harness::new(&[]);
        let result = h.request("initialize", params.clone()).unwrap();
        assert_eq!(result["capabilities"]["positionEncoding"], "utf-16", "{params}");
    }
}

#[test]
fn requests_before_initialize_are_refused_and_a_second_initialize_too() {
    let mut h = Harness::new(&[]);
    let (code, _) = h.request("textDocument/hover", at("file:///x.mtek", 0, 0)).unwrap_err();
    assert_eq!(code, ErrorCode::ServerNotInitialized as i32);
    let (code, _) = h.request("shutdown", Value::Null).unwrap_err();
    assert_eq!(code, ErrorCode::ServerNotInitialized as i32);
    // Notifications before `initialize` are dropped.
    h.open_uri("file:///x.mtek", "const A: f32 = 1.;", 1);
    h.advance(1000);
    assert!(h.published().is_empty());
    h.initialize(json!({})).unwrap();
    let (code, _) = h.request("initialize", json!({})).unwrap_err();
    assert_eq!(code, ErrorCode::InvalidRequest as i32);
}

#[test]
fn shutdown_then_exit_is_code_zero_and_exit_alone_is_code_one() {
    let mut h = Harness::standard(json!({}));
    assert_eq!(h.request("shutdown", Value::Null), Ok(Value::Null));
    assert_eq!(h.server.exit_code(), None, "the server runs until `exit`");
    let (code, _) = h.request("textDocument/hover", at("file:///x.mtek", 0, 0)).unwrap_err();
    assert_eq!(code, ErrorCode::InvalidRequest as i32, "after shutdown");
    h.notify("textDocument/didOpen", json!({}));
    h.notify("exit", Value::Null);
    assert_eq!(h.server.exit_code(), Some(0));

    let mut h = Harness::standard(json!({}));
    h.notify("exit", Value::Null);
    assert_eq!(h.server.exit_code(), Some(1));

    let mut h = Harness::new(&[]);
    h.notify("exit", Value::Null);
    assert_eq!(h.server.exit_code(), Some(1), "exit before initialize");
}

#[test]
fn the_input_ending_is_code_one_unless_the_client_shut_down() {
    let mut h = Harness::standard(json!({}));
    h.send(Inbound::Closed { reason: None });
    assert_eq!(h.server.exit_code(), Some(1));

    let mut h = Harness::standard(json!({}));
    h.request("shutdown", Value::Null).unwrap();
    h.send(Inbound::Closed { reason: None });
    assert_eq!(h.server.exit_code(), Some(0));

    let mut h = Harness::standard(json!({}));
    h.send(Inbound::Closed { reason: Some("damaged".to_owned()) });
    assert_eq!(h.server.exit_code(), Some(1));
}

#[test]
fn unknown_methods_and_bad_parameters_are_errors_that_leave_the_session_running() {
    let mut h = Harness::standard(json!({}));
    let (code, message) = h.request("textDocument/rename", json!({})).unwrap_err();
    assert_eq!(code, ErrorCode::MethodNotFound as i32);
    assert!(message.contains("textDocument/rename"), "{message}");
    for method in ["textDocument/hover", "textDocument/definition", "textDocument/completion", "textDocument/codeAction"] {
        for params in [json!(null), json!([]), json!({}), json!({"textDocument": 5}), json!({"textDocument": {"uri": 5}, "position": 1}), json!("x")] {
            let (code, _) = h.request(method, params.clone()).unwrap_err();
            assert_eq!(code, ErrorCode::InvalidParams as i32, "{method} {params}");
        }
    }
    // Malformed notifications are ignored.
    for method in ["textDocument/didOpen", "textDocument/didChange", "textDocument/didClose", "textDocument/didSave", "workspace/didChangeWatchedFiles", "nonsense/method"] {
        for params in [json!(null), json!([]), json!({}), json!({"textDocument": 5}), json!("x")] {
            h.notify(method, params);
        }
    }
    h.advance(1000);
    assert!(h.published().is_empty());
    // Still alive.
    assert!(h.request("textDocument/hover", at("file:///nothing.mtek", 0, 0)).is_ok());
    assert_eq!(h.server.exit_code(), None);
}

#[test]
fn rejected_payloads_are_answered_by_the_server_loop() {
    let mut h = Harness::standard(json!({}));
    h.send(Inbound::Rejected {
        id: None,
        code: ErrorCode::ParseError,
        message: "bad".to_owned(),
    });
    assert_eq!(h.rejections, [(None, -32700)]);
    assert_eq!(h.server.exit_code(), None);
}

// ----- diagnostics -----------------------------------------------------------------------------

/// A program with an unknown name after multi-byte text on its line.
const BROKEN: &str = "/* \u{e9}\u{1f600} */ const A: f32 = Unknown;\nscene Demo { camera Main {} }\n";

#[test]
fn diagnostics_have_exact_ranges_after_multibyte_text_in_utf16() {
    let mut h = Harness::new(&[("src/main.mtek", BROKEN)]);
    h.initialize(json!({})).unwrap();
    h.open("src/main.mtek", BROKEN);
    h.poll();
    let published = h.published();
    assert_eq!(published.len(), 1, "{published:?}");
    let (uri, version, diagnostics) = &published[0];
    assert_eq!(uri, &h.uri("src/main.mtek"));
    assert_eq!(*version, Some(1));
    assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    let d = &diagnostics[0];
    assert_eq!(code_of(d), "MTEK-E2003");
    assert_eq!(d["severity"], 1);
    assert_eq!(d["source"], "mtek");
    // `/* é😀 */ const A: f32 = ` is 25 UTF-16 units: 3 + 1 + 2 + 4 + 15; `Unknown` is 7.
    assert_eq!(d["range"], json!({"start": pos(0, 25), "end": pos(0, 32)}));
}

#[test]
fn the_same_diagnostic_in_utf8_counts_bytes() {
    let mut h = Harness::new(&[("src/main.mtek", BROKEN)]);
    h.initialize(json!({"capabilities": {"general": {"positionEncodings": ["utf-8", "utf-16"]}}})).unwrap();
    h.open("src/main.mtek", BROKEN);
    h.poll();
    let published = h.published();
    let d = &published[0].2[0];
    // The two characters before are 2 + 4 bytes, not 1 + 2 units: three more.
    assert_eq!(d["range"], json!({"start": pos(0, 28), "end": pos(0, 35)}));
}

#[test]
fn a_clean_program_publishes_an_empty_list_once_and_not_again() {
    let mut h = Harness::standard(json!({}));
    h.open("src/main.mtek", MAIN);
    h.open("src/lib.mtek", LIB);
    h.poll();
    let published = h.published();
    assert_eq!(published.len(), 2, "{published:?}");
    assert!(published.iter().all(|(_, _, d)| d.is_empty()));
    // An unchanged analysis publishes nothing more.
    h.notify("textDocument/didSave", json!({"textDocument": {"uri": h.uri("src/main.mtek")}}));
    h.poll();
    assert!(h.published().is_empty());
}

#[test]
fn diagnostics_are_debounced_and_changes_restart_the_timer() {
    let mut h = Harness::standard(json!({}));
    let uri = h.uri("src/main.mtek");
    h.open("src/main.mtek", MAIN);
    h.open("src/lib.mtek", LIB);
    h.poll();
    h.published();
    assert_eq!(h.server.millis_until_due(), None);

    // One change: nothing until the debounce has passed.
    h.change(&uri, 2, BROKEN);
    assert_eq!(h.server.millis_until_due(), Some(DEBOUNCE_MS));
    h.advance(DEBOUNCE_MS - 1);
    assert!(h.published().is_empty());
    assert_eq!(h.server.millis_until_due(), Some(1));
    h.advance(1);
    let published = h.published_for(&uri);
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].len(), 1, "the error of the new text");

    // Typing: every change restarts the timer; one publication, with the last text.
    h.change(&uri, 3, "const A: f32 = 1.;\nscene Demo { camera Main {} }\n");
    h.advance(100);
    h.change(&uri, 4, "const A: f32 = 1.0;\nscene Demo { camera Main {} }\n");
    h.advance(100);
    assert!(h.published().is_empty(), "200 ms after the first change, 100 after the last");
    h.advance(49);
    assert!(h.published().is_empty());
    h.advance(1);
    let published = h.published();
    assert_eq!(published.len(), 1, "one publication for two changes: {published:?}");
    assert_eq!(published[0].1, Some(4), "the version of the last change");
    assert!(published[0].2.is_empty(), "the last text is clean");
}

#[test]
fn opening_publishes_without_waiting_and_a_burst_of_opens_is_one_analysis() {
    let mut h = Harness::standard(json!({}));
    h.open("src/main.mtek", MAIN);
    h.open("src/lib.mtek", LIB);
    assert_eq!(h.server.millis_until_due(), Some(0));
    h.poll();
    assert_eq!(h.published().len(), 2);
    // A change right after an open does not delay the open's publication.
    let uri = h.uri("src/main.mtek");
    h.advance(1000);
    h.published();
    h.close_all();
    h.open("src/main.mtek", MAIN);
    h.change(&uri, 2, BROKEN);
    h.poll();
    let published = h.published_for(&uri);
    assert_eq!(published.len(), 1, "published at once, with the changed text");
    assert_eq!(published[0].len(), 1);
}

impl Harness {
    fn close_all(&mut self) {
        for relative in ["src/main.mtek", "src/lib.mtek"] {
            let uri = self.uri(relative);
            self.notify("textDocument/didClose", json!({"textDocument": {"uri": uri}}));
        }
        self.poll();
        self.published();
    }
}

#[test]
fn closing_the_last_document_of_a_project_clears_its_diagnostics() {
    let mut h = Harness::new(&[("src/main.mtek", BROKEN)]);
    h.initialize(json!({})).unwrap();
    h.open("src/main.mtek", BROKEN);
    h.poll();
    assert_eq!(h.published()[0].2.len(), 1);
    let uri = h.uri("src/main.mtek");
    h.notify("textDocument/didClose", json!({"textDocument": {"uri": uri}}));
    h.poll();
    let published = h.published();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, uri);
    assert!(published[0].2.is_empty());
    // Closing it again, or a document that was never open, is nothing.
    h.notify("textDocument/didClose", json!({"textDocument": {"uri": uri}}));
    h.notify("textDocument/didClose", json!({"textDocument": {"uri": "file:///never.mtek"}}));
    h.advance(1000);
    assert!(h.published().is_empty());
}

#[test]
fn diagnostics_of_an_imported_file_are_published_to_that_file() {
    let broken_lib = "export const X: f32 = Nope;\n";
    let mut h = Harness::new(&[
        ("src/lib.mtek", broken_lib),
        ("src/main.mtek", "import { X } from \"./lib.mtek\";\nscene Demo { camera Main {} }\n"),
    ]);
    h.initialize(json!({})).unwrap();
    let main = h.project.path("src/main.mtek");
    h.open("src/main.mtek", &std::fs::read_to_string(main).unwrap());
    h.poll();
    let lib_uri = h.uri("src/lib.mtek");
    let main_uri = h.uri("src/main.mtek");
    let published = h.published();
    let lib = published.iter().find(|(u, _, _)| *u == lib_uri).expect("lib is published");
    assert_eq!(lib.1, None, "not an open document: no version");
    assert_eq!(code_of(&lib.2[0]), "MTEK-E2003");
    assert_eq!(lib.2[0]["range"], json!({"start": pos(0, 22), "end": pos(0, 26)}));
    let main = published.iter().find(|(u, _, _)| *u == main_uri).unwrap();
    assert!(main.2.is_empty(), "{:?}", main.2);

    // Fixed on disk by something else; the client says the file changed.
    h.project.write("src/lib.mtek", "export const X: f32 = 1.0;\n");
    h.notify(
        "workspace/didChangeWatchedFiles",
        json!({"changes": [{"uri": lib_uri, "type": 2}]}),
    );
    h.poll();
    let published = h.published();
    let lib = published.iter().find(|(u, _, _)| *u == lib_uri).expect("lib is published again");
    assert!(lib.2.is_empty());
}

#[test]
fn an_unsaved_buffer_is_what_the_compiler_reads() {
    let mut h = Harness::standard(json!({}));
    h.open("src/main.mtek", MAIN);
    h.poll();
    assert!(h.published().iter().all(|(_, _, d)| d.is_empty()));
    // The buffer of lib.mtek (the disk has a good one) stops exporting `double`.
    let lib_uri = h.uri("src/lib.mtek");
    h.open_uri(&lib_uri, "export struct Light { intensity: f32; }\n", 1);
    h.poll();
    let published = h.published();
    let main = published.iter().find(|(u, _, _)| *u == h.uri("src/main.mtek")).unwrap();
    assert!(main.2.iter().any(|d| code_of(d) == "MTEK-E2033"), "{:?}", main.2);
    // Closing the buffer goes back to the disk.
    h.notify("textDocument/didClose", json!({"textDocument": {"uri": lib_uri}}));
    h.poll();
    let published = h.published();
    let main = published.iter().find(|(u, _, _)| *u == h.uri("src/main.mtek")).unwrap();
    assert!(main.2.is_empty(), "{:?}", main.2);
}

#[test]
fn a_new_file_that_exists_only_as_a_buffer_can_be_imported() {
    let mut h = Harness::new(&[("src/main.mtek", "scene Demo { camera Main {} }\n")]);
    h.initialize(json!({})).unwrap();
    let main = "import { Extra } from \"./extra.mtek\";\nconst A: f32 = Extra;\nscene Demo { camera Main {} }\n";
    h.open("src/main.mtek", main);
    h.poll();
    let main_uri = h.uri("src/main.mtek");
    let first = h.published_for(&main_uri);
    assert!(first[0].iter().any(|d| code_of(d).starts_with("MTEK-E203")), "{:?}", first[0]);
    // The new file is opened (never saved): the import resolves.
    let extra_uri = h.uri("src/extra.mtek");
    h.open_uri(&extra_uri, "export const Extra: f32 = 2.0;\n", 1);
    h.poll();
    let published = h.published();
    let main = published.iter().find(|(u, _, _)| *u == main_uri).unwrap();
    assert!(main.2.is_empty(), "{:?}", main.2);
}

#[test]
fn a_file_without_a_project_gets_its_syntax_diagnostics_and_loses_them_on_close() {
    let mut h = Harness::new(&[]);
    h.initialize(json!({})).unwrap();
    let uri = "untitled:Untitled-1";
    h.open_uri(uri, "const A: f32 = 1.;\nfn (\n", 1);
    h.poll();
    let published = h.published();
    assert_eq!(published.len(), 1);
    let codes: Vec<&str> = published[0].2.iter().map(code_of).collect();
    assert!(codes.contains(&"MTEK-E0022"), "{codes:?}");
    assert!(
        published[0].2.iter().all(|d| d["code"] != "MTEK-E2003"),
        "no names without a project"
    );
    h.change(uri, 2, "const A: f32 = 1.0;\n");
    h.advance(DEBOUNCE_MS);
    let published = h.published();
    assert!(published[0].2.is_empty());
    h.notify("textDocument/didClose", json!({"textDocument": {"uri": uri}}));
    h.poll();
    let published = h.published();
    assert_eq!(published.len(), 1, "closing publishes an empty list");
    assert!(published[0].2.is_empty());
}

#[test]
fn a_file_outside_every_project_is_loose_too() {
    let dir = std::env::temp_dir().join(format!("mtek-lsp-loose-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("alone.mtek");
    std::fs::write(&file, "const A: f32 = 1.;\n").unwrap();
    let mut h = Harness::new(&[]);
    h.initialize(json!({})).unwrap();
    let uri = super::uri::file_uri(&file);
    h.open_uri(&uri, "const A: f32 = 1.;\n", 1);
    h.poll();
    let published = h.published();
    assert_eq!(published.len(), 1);
    assert_eq!(code_of(&published[0].2[0]), "MTEK-E0022");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_project_that_does_not_load_reports_on_the_project_file() {
    let mut h = Harness::new(&[("src/main.mtek", "const A: f32 = 1.0;\n")]);
    h.project.write("mtek.toml", "[project]\nname = 5\n");
    h.initialize(json!({})).unwrap();
    h.open("src/main.mtek", "const A: f32 = 1.0;\n");
    h.poll();
    let published = h.published();
    let toml = published
        .iter()
        .find(|(u, _, _)| *u == h.uri("mtek.toml"))
        .unwrap_or_else(|| panic!("{published:?}"));
    assert_eq!(code_of(&toml.2[0]), "MTEK-E9001");
    assert_eq!(toml.2[0]["range"], json!({"start": pos(0, 0), "end": pos(0, 0)}));
}

#[test]
fn a_deleted_file_is_an_import_error_not_a_crash() {
    let mut h = Harness::standard(json!({}));
    h.open("src/main.mtek", MAIN);
    h.poll();
    h.published();
    h.project.remove("src/lib.mtek");
    h.notify("workspace/didChangeWatchedFiles", json!({"changes": [{"uri": h.uri("src/lib.mtek"), "type": 3}]}));
    h.poll();
    let published = h.published();
    let main = published.iter().find(|(u, _, _)| *u == h.uri("src/main.mtek")).unwrap();
    assert!(main.2.iter().any(|d| code_of(d).starts_with("MTEK-E203")), "{:?}", main.2);
    // The open document of a file that is deleted on disk keeps being served.
    let hover = h.request("textDocument/hover", at(&h.uri("src/main.mtek"), 3, 8)).unwrap();
    assert!(hover["contents"]["value"].as_str().unwrap().contains("const SPEED"), "{hover}");
}

// ----- text synchronisation --------------------------------------------------------------------

#[test]
fn changes_to_unknown_documents_are_ignored_and_incremental_changes_are_applied() {
    let mut h = Harness::standard(json!({}));
    let uri = h.uri("src/main.mtek");
    h.change("file:///never-opened.mtek", 2, "x");
    h.open("src/main.mtek", MAIN);
    h.poll();
    h.published();
    // A client that ignores `change: 1` and sends a range: `0.7` becomes `0.5`.
    h.notify(
        "textDocument/didChange",
        json!({"textDocument": {"uri": uri, "version": 2}, "contentChanges": [
            {"range": {"start": pos(3, 19), "end": pos(3, 22)}, "text": "0.5"}
        ]}),
    );
    let hover = h.request("textDocument/hover", at(&uri, 3, 7)).unwrap();
    assert!(hover["contents"]["value"].as_str().unwrap().contains("= 0.5"), "{hover}");
    // A range past the end of the text clamps; a reversed one is an insertion.
    h.notify(
        "textDocument/didChange",
        json!({"textDocument": {"uri": uri, "version": 3}, "contentChanges": [
            {"range": {"start": pos(999, 0), "end": pos(999, 5)}, "text": "// end\n"},
            {"range": {"start": pos(0, 5), "end": pos(0, 1)}, "text": ""}
        ]}),
    );
    h.advance(DEBOUNCE_MS);
    assert!(h.published().iter().all(|(_, v, _)| *v == Some(3) || v.is_none()));
}

// ----- hover, definition, completion -----------------------------------------------------------

/// The position (UTF-16) of the `n`th `needle` in `text`.
fn position_of(text: &str, needle: &str, n: usize) -> (u32, u32) {
    let (offset, _) = text.match_indices(needle).nth(n).unwrap();
    utf16_position(text, u32::try_from(offset).unwrap())
}

#[test]
fn hover_positions_are_utf16_with_multibyte_text_earlier_on_the_line() {
    let text = "// \u{1f600}\u{e9}\n/// Speed.\nconst SPEED: f32 = 0.7; /* \u{1f600}\u{1f600} */ const B: f32 = SPEED;\nscene Demo { camera Main {} }\n";
    let mut h = Harness::new(&[("src/main.mtek", text)]);
    h.initialize(json!({})).unwrap();
    h.open("src/main.mtek", text);
    let uri = h.uri("src/main.mtek");
    // The use of SPEED after the emoji comment: its column counts each emoji as two units.
    let (use_line, use_character) = position_of(text, "SPEED;", 0);
    assert_eq!((use_line, use_character), (2, 50));
    let hover = h.request("textDocument/hover", at(&uri, use_line, use_character + 2)).unwrap();
    let markdown = hover["contents"]["value"].as_str().unwrap();
    assert!(markdown.contains("const SPEED: f32 = 0.7") && markdown.contains("Speed."), "{markdown}");
    assert_eq!(hover["contents"]["kind"], "markdown");
    assert_eq!(
        hover["range"],
        json!({"start": pos(use_line, use_character), "end": pos(use_line, use_character + 5)})
    );
    // One unit to the left (inside the comment, on the space before `const B`) is nothing to hover.
    let before = h.request("textDocument/hover", at(&uri, use_line, use_character - 20)).unwrap();
    assert_eq!(before, Value::Null);
    // The same position counted in bytes lands somewhere else: with UTF-8 negotiated it is right.
    let mut h8 = Harness::new(&[("src/main.mtek", text)]);
    h8.initialize(json!({"capabilities": {"general": {"positionEncodings": ["utf-8"]}}})).unwrap();
    h8.open("src/main.mtek", text);
    let (byte_offset, _) = text.match_indices("SPEED;").next().unwrap();
    let line_start = text.lines().take(2).map(|l| l.len() + 1).sum::<usize>();
    let column = byte_offset - line_start;
    let uri8 = h8.uri("src/main.mtek");
    let hover = h8.request("textDocument/hover", at(&uri8, 2, u32::try_from(column).unwrap() + 2)).unwrap();
    assert!(hover["contents"]["value"].as_str().unwrap().contains("const SPEED"), "{hover}");
    assert_eq!(hover["range"]["start"], pos(2, u32::try_from(column).unwrap()));
}

#[test]
fn hover_is_plain_text_for_a_client_that_does_not_read_markdown() {
    let mut h = Harness::new(&[("src/lib.mtek", LIB), ("src/main.mtek", MAIN)]);
    h.initialize(json!({"capabilities": {"textDocument": {"hover": {"contentFormat": ["plaintext"]}}}})).unwrap();
    h.open("src/main.mtek", MAIN);
    let (line, character) = position_of(MAIN, "double(speed)", 0);
    let hover = h.request("textDocument/hover", at(&h.uri("src/main.mtek"), line, character)).unwrap();
    assert_eq!(hover["contents"]["kind"], "plaintext");
    let text = hover["contents"]["value"].as_str().unwrap();
    assert!(!text.contains("```") && text.starts_with("fn double(x: f32) -> f32"), "{text}");
}

#[test]
fn definition_goes_across_modules_and_into_the_standard_library() {
    let mut h = Harness::standard(json!({}));
    h.open("src/main.mtek", MAIN);
    let uri = h.uri("src/main.mtek");
    let lib_uri = h.uri("src/lib.mtek");
    // The use of `double`: the declaration in lib.mtek.
    let (line, character) = position_of(MAIN, "double(speed)", 0);
    let location = h.request("textDocument/definition", at(&uri, line, character)).unwrap();
    assert_eq!(location["uri"], lib_uri);
    let (lib_line, lib_character) = position_of(LIB, "double(x", 0);
    assert_eq!(
        location["range"],
        json!({"start": pos(lib_line, lib_character), "end": pos(lib_line, lib_character + 6)})
    );
    // The import specifier: the module.
    let (line, character) = position_of(MAIN, "./lib.mtek", 0);
    let location = h.request("textDocument/definition", at(&uri, line, character + 3)).unwrap();
    assert_eq!(location["uri"], lib_uri);
    assert_eq!(location["range"], json!({"start": pos(0, 0), "end": pos(0, 0)}));
    // A standard-library name: a virtual document whose text has the name at the range.
    let (line, character) = position_of(MAIN, "Box {", 0);
    let location = h.request("textDocument/definition", at(&uri, line, character)).unwrap();
    assert_eq!(location["uri"], "mtek-prelude:/std/prelude.mtek");
    let content = h.request("workspace/textDocumentContent", json!({"uri": location["uri"]})).unwrap();
    let text = content["text"].as_str().unwrap();
    let start = &location["range"]["start"];
    let line_text = text.lines().nth(usize::try_from(start["line"].as_u64().unwrap()).unwrap()).unwrap();
    assert!(line_text.contains("schema Box"), "{line_text}");
    // Nothing to define.
    let (line, character) = position_of(MAIN, "0.7", 0);
    assert_eq!(h.request("textDocument/definition", at(&uri, line, character)).unwrap(), Value::Null);
}

#[test]
fn the_standard_library_documents_are_served_and_unknown_ones_refused() {
    let mut h = Harness::standard(json!({}));
    for path in ["std/prelude.mtek", "std/materials.mtek"] {
        let content = h
            .request("workspace/textDocumentContent", json!({"uri": format!("mtek-prelude:/{path}")}))
            .unwrap();
        assert!(!content["text"].as_str().unwrap().is_empty());
    }
    let materials = h.request("workspace/textDocumentContent", json!({"uri": "mtek-prelude:/std/materials.mtek"})).unwrap();
    assert!(materials["text"].as_str().unwrap().contains("export material Pbr"));
    let (code, _) = h.request("workspace/textDocumentContent", json!({"uri": "mtek-prelude:/std/nope.mtek"})).unwrap_err();
    assert_eq!(code, ErrorCode::RequestFailed as i32);
    for params in [json!({"uri": "file:///x.mtek"}), json!({}), json!({"uri": 3}), Value::Null] {
        let (code, _) = h.request("workspace/textDocumentContent", params).unwrap_err();
        assert_eq!(code, ErrorCode::InvalidParams as i32);
    }
}

#[test]
fn completion_replaces_the_typed_part_in_utf16_units() {
    let template = "const A: f32 = 1.0; /* \u{1f600}\u{e9} */ const B: f32 = sm\u{a7};\nscene Demo { camera Main {} }\n";
    let (text, offset) = cursor(template);
    let mut h = Harness::new(&[("src/main.mtek", &text)]);
    h.initialize(json!({})).unwrap();
    h.open("src/main.mtek", &text);
    let (line, character) = utf16_position(&text, offset);
    let result = h.request("textDocument/completion", at(&h.uri("src/main.mtek"), line, character)).unwrap();
    assert_eq!(result["isIncomplete"], false);
    let items = result["items"].as_array().unwrap();
    let item = items.iter().find(|i| i["label"] == "smoothstep").expect("smoothstep");
    assert_eq!(item["kind"], 3, "a function");
    assert_eq!(item["textEdit"]["newText"], "smoothstep");
    // The two typed letters: [cursor - 2, cursor] in UTF-16 units, after the emoji comment.
    assert_eq!(
        item["textEdit"]["range"],
        json!({"start": pos(line, character - 2), "end": pos(line, character)})
    );
    assert!(item["detail"].as_str().unwrap().starts_with("smoothstep("));
    assert!(item["documentation"]["value"].as_str().is_some());
    // The program's own names come first.
    assert!(items.iter().any(|i| i["label"] == "A"));
}

#[test]
fn completion_after_a_dot_lists_the_members() {
    let template = "scene Demo {\n    camera Main {}\n    on key_down(Key.\u{a7}) {}\n}\n";
    let (text, offset) = cursor(template);
    let mut h = Harness::new(&[("src/main.mtek", &text)]);
    h.initialize(json!({})).unwrap();
    h.open("src/main.mtek", &text);
    let (line, character) = utf16_position(&text, offset);
    let result = h.request("textDocument/completion", at(&h.uri("src/main.mtek"), line, character)).unwrap();
    let labels: Vec<&str> = result["items"].as_array().unwrap().iter().map(|i| i["label"].as_str().unwrap()).collect();
    assert!(labels.contains(&"Space") && labels.contains(&"ArrowUp"), "{labels:?}");
    assert!(!labels.contains(&"sin"));
}

#[test]
fn completion_in_a_comment_or_for_an_unknown_document_is_null() {
    let template = "// nothing here \u{a7}\nscene Demo { camera Main {} }\n";
    let (text, offset) = cursor(template);
    let mut h = Harness::new(&[("src/main.mtek", &text)]);
    h.initialize(json!({})).unwrap();
    h.open("src/main.mtek", &text);
    let (line, character) = utf16_position(&text, offset);
    assert_eq!(
        h.request("textDocument/completion", at(&h.uri("src/main.mtek"), line, character)).unwrap(),
        Value::Null
    );
    assert_eq!(
        h.request("textDocument/completion", at("file:///not-open.mtek", 0, 0)).unwrap(),
        Value::Null
    );
}

// ----- code actions ----------------------------------------------------------------------------

/// Apply LSP text edits (UTF-16) to `text`.
fn apply(text: &str, edits: &[Value]) -> String {
    let lines = LineIndex::new(Arc::from(text));
    let to_offset = |p: &Value| {
        PositionEncoding::Utf16.offset(
            &lines,
            lsp_types::Position {
                line: u32::try_from(p["line"].as_u64().unwrap()).unwrap(),
                character: u32::try_from(p["character"].as_u64().unwrap()).unwrap(),
            },
        ) as usize
    };
    let mut ranges: Vec<(usize, usize, String)> = edits
        .iter()
        .map(|e| {
            (
                to_offset(&e["range"]["start"]),
                to_offset(&e["range"]["end"]),
                e["newText"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    ranges.sort_by_key(|(start, end, _)| (*start, *end));
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

#[test]
fn a_validated_edit_is_a_quick_fix_that_leaves_a_clean_program() {
    // `1.` is E0022 with a validated edit; the emoji before it make the UTF-16 range matter.
    let text = "/* \u{1f600} */ const A: f32 = 1.;\nscene Demo { camera Main {} }\n";
    let mut h = Harness::new(&[("src/main.mtek", text)]);
    h.initialize(json!({})).unwrap();
    h.open("src/main.mtek", text);
    h.poll();
    let uri = h.uri("src/main.mtek");
    let published = h.published();
    let diagnostic = published[0].2[0].clone();
    assert_eq!(code_of(&diagnostic), "MTEK-E0022");
    let actions = h
        .request(
            "textDocument/codeAction",
            json!({"textDocument": {"uri": uri}, "range": diagnostic["range"], "context": {"diagnostics": [diagnostic]}}),
        )
        .unwrap();
    let actions = actions.as_array().unwrap();
    assert_eq!(actions.len(), 1, "{actions:?}");
    let action = &actions[0];
    assert_eq!(action["kind"], "quickfix");
    assert_eq!(action["title"], "write the float literal as `1.0`");
    assert_eq!(action["isPreferred"], true);
    assert_eq!(action["diagnostics"][0]["code"], "MTEK-E0022");
    let edits = action["edit"]["changes"][&uri].as_array().unwrap();
    assert_eq!(edits.len(), 1);
    // The edit is in UTF-16 columns (after `/* 😀 */ const A: f32 = `: 4 + 3 + 15 = 22... the emoji is 2 units).
    assert_eq!(edits[0]["range"]["start"], diagnostic["range"]["start"]);
    let fixed = apply(text, edits);
    assert_eq!(fixed, "/* \u{1f600} */ const A: f32 = 1.0;\nscene Demo { camera Main {} }\n");
    // Applying it, the client sends the new text and the diagnostics go away.
    h.change(&uri, 2, &fixed);
    h.advance(DEBOUNCE_MS);
    let published = h.published();
    assert_eq!(published.len(), 1);
    assert!(published[0].2.is_empty(), "{:?}", published[0].2);
}

#[test]
fn quick_fixes_use_document_changes_with_the_version_when_the_client_takes_them() {
    let text = "const A: f32 = 1.;\nscene Demo { camera Main {} }\n";
    let mut h = Harness::new(&[("src/main.mtek", text)]);
    h.initialize(json!({"capabilities": {"workspace": {"workspaceEdit": {"documentChanges": true}}}})).unwrap();
    let uri = h.uri("src/main.mtek");
    h.open_uri(&uri, text, 7);
    let actions = h
        .request(
            "textDocument/codeAction",
            json!({"textDocument": {"uri": uri}, "range": {"start": pos(0, 15), "end": pos(0, 15)}, "context": {"diagnostics": []}}),
        )
        .unwrap();
    let changes = &actions[0]["edit"]["documentChanges"];
    assert_eq!(changes[0]["textDocument"]["uri"], uri);
    assert_eq!(changes[0]["textDocument"]["version"], 7);
    assert_eq!(changes[0]["edits"][0]["newText"], "1.0");
    assert!(actions[0]["edit"]["changes"].is_null());
}

#[test]
fn quick_fixes_are_only_where_the_range_is_and_only_when_asked_for() {
    let text = "const A: f32 = 1.;\n\nconst B: f32 = 2.;\nscene Demo { camera Main {} }\n";
    let mut h = Harness::new(&[("src/main.mtek", text)]);
    h.initialize(json!({})).unwrap();
    let uri = h.uri("src/main.mtek");
    h.open_uri(&uri, text, 1);
    let ask = |h: &mut Harness, range: Value, only: Value| {
        h.request(
            "textDocument/codeAction",
            json!({"textDocument": {"uri": uri}, "range": range, "context": {"diagnostics": [], "only": only}}),
        )
        .unwrap()
    };
    // The first literal only; the second only; neither (the empty line); both (everything).
    let first = ask(&mut h, json!({"start": pos(0, 16), "end": pos(0, 16)}), Value::Null);
    assert_eq!(first.as_array().unwrap().len(), 1);
    assert_eq!(first[0]["edit"]["changes"][&uri][0]["range"]["start"], pos(0, 15));
    let second = ask(&mut h, json!({"start": pos(2, 17), "end": pos(2, 17)}), json!(["quickfix"]));
    assert_eq!(second.as_array().unwrap().len(), 1);
    assert_eq!(second[0]["edit"]["changes"][&uri][0]["range"]["start"], pos(2, 15));
    let none = ask(&mut h, json!({"start": pos(1, 0), "end": pos(1, 0)}), Value::Null);
    assert!(none.as_array().unwrap().is_empty());
    let both = ask(&mut h, json!({"start": pos(0, 0), "end": pos(3, 0)}), Value::Null);
    assert_eq!(both.as_array().unwrap().len(), 2);
    // Only refactorings were asked for.
    let refactor = ask(&mut h, json!({"start": pos(0, 16), "end": pos(0, 16)}), json!(["refactor"]));
    assert!(refactor.as_array().unwrap().is_empty());
}

#[test]
fn an_edit_in_another_file_is_one_workspace_edit() {
    // `Unkown` is a one-letter mistake of a name in lib.mtek: E2003 offers the rename.
    let lib = "export const Known: f32 = 1.0;\nexport const Other: f32 = Unkown;\n";
    let main = "import { Other } from \"./lib.mtek\";\nscene Demo { camera Main {} }\n";
    let mut h = Harness::new(&[("src/lib.mtek", lib), ("src/main.mtek", main)]);
    h.initialize(json!({})).unwrap();
    h.open("src/main.mtek", main);
    h.poll();
    let published = h.published();
    let lib_uri = h.uri("src/lib.mtek");
    let in_lib = published.iter().find(|(u, _, _)| *u == lib_uri).unwrap();
    assert_eq!(code_of(&in_lib.2[0]), "MTEK-E2003", "{:?}", in_lib.2);
    // Asked from the file the diagnostic is in (it is not open: the server knows it anyway).
    h.open_uri(&lib_uri, lib, 1);
    let actions = h
        .request(
            "textDocument/codeAction",
            json!({"textDocument": {"uri": lib_uri}, "range": in_lib.2[0]["range"], "context": {"diagnostics": []}}),
        )
        .unwrap();
    assert_eq!(actions.as_array().unwrap().len(), 1, "{actions}");
    let edits = actions[0]["edit"]["changes"][&lib_uri].as_array().unwrap();
    assert_eq!(apply(lib, edits), "export const Known: f32 = 1.0;\nexport const Other: f32 = Known;\n");
}

// ----- survival --------------------------------------------------------------------------------

fn explode() {
    panic!("a defect in a handler");
}

#[test]
fn a_panic_in_a_handler_answers_with_an_error_and_loses_no_buffer() {
    let mut h = Harness::standard(json!({}));
    let uri = h.uri("src/main.mtek");
    let unsaved = format!("{MAIN}// unsaved edit \u{1f600}\n");
    h.open_uri(&uri, &unsaved, 1);
    h.poll();
    h.published();
    h.server.fault = Some(explode);
    let (code, message) = h.request("textDocument/hover", at(&uri, 3, 8)).unwrap_err();
    assert_eq!(code, ErrorCode::InternalError as i32);
    assert!(message.contains("textDocument/hover"), "{message}");
    // A panic while publishing is survived too.
    h.change(&uri, 2, &unsaved);
    h.advance(DEBOUNCE_MS);
    assert_eq!(h.server.exit_code(), None);
    // The defect is gone: the same buffer is still there and answers.
    h.server.fault = None;
    let hover = h.request("textDocument/hover", at(&uri, 3, 8)).unwrap();
    assert!(hover["contents"]["value"].as_str().unwrap().contains("const SPEED"), "{hover}");
    // The unsaved text is the buffer the compiler reads: a position in it still resolves.
    let (line, _) = position_of(&unsaved, "// unsaved edit", 0);
    let hover = h.request("textDocument/hover", at(&uri, line, 3)).unwrap();
    assert_eq!(hover, Value::Null);
    h.advance(DEBOUNCE_MS);
    let published = h.published();
    assert!(published.iter().all(|(_, _, d)| d.is_empty()), "{published:?}");
}

#[test]
fn huge_and_odd_texts_are_diagnosed_not_fatal() {
    let mut h = Harness::new(&[("src/main.mtek", "scene Demo { camera Main {} }\n")]);
    h.initialize(json!({})).unwrap();
    // More than the 4 MiB the compiler accepts.
    let huge = format!("{}\n", "// padding padding padding padding\n".repeat(140_000));
    assert!(huge.len() > 4 * 1024 * 1024);
    let uri = h.uri("src/main.mtek");
    h.open_uri(&uri, &huge, 1);
    h.poll();
    let published = h.published();
    assert!(published.iter().flat_map(|(_, _, d)| d).any(|d| code_of(d) == "MTEK-E0004"), "{published:?}");
    assert_eq!(h.request("textDocument/hover", at(&uri, 5, 5)).unwrap(), Value::Null);
    assert_eq!(h.request("textDocument/completion", at(&uri, 5, 5)).unwrap(), Value::Null);
    // Odd text: NUL bytes, lone surrogates cannot exist in a Rust string, a misplaced BOM, CRLF.
    for text in ["\u{0}\u{0}", "const\u{feff}A", "a\r\nb\r\n", "\u{feff}scene", "\r", "{\"jsonrpc\"", "\u{1f600}".repeat(1000).as_str()] {
        h.change(&uri, 2, text);
        h.advance(DEBOUNCE_MS);
        h.published();
        for (line, character) in [(0, 0), (0, 1), (0, 3), (1, 1), (99, 99)] {
            let _ = h.request("textDocument/hover", at(&uri, line, character)).unwrap();
            let _ = h.request("textDocument/definition", at(&uri, line, character)).unwrap();
            let _ = h.request("textDocument/completion", at(&uri, line, character)).unwrap();
        }
    }
    assert_eq!(h.server.exit_code(), None);
}
