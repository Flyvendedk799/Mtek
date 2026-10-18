//! The language server's state and message handling (decision 0076).
//!
//! [`Server`] is a state machine without threads or I/O: it is given messages
//! ([`Server::handle`]) and the passage of time ([`Server::poll`], with the [`Clock`] it was made
//! with) and it leaves what it wants to send in a queue ([`Server::take_outgoing`]). The loop
//! that reads the pipe and writes the answers is in `mod.rs`; tests drive the state machine
//! directly with a manual clock, and the integration tests drive the real binary.
//!
//! # State that must survive anything
//!
//! The server holds the text of every open document and nothing the user cannot get back: it
//! never writes a file. Every message is handled inside a panic guard; a defect in the compiler
//! or in a feature answers that one request with an error, drops the cached analyses (they are
//! recomputed from the buffers) and goes on, with every buffer intact.
//!
//! # Debounce
//!
//! A change to a document starts a timer of [`DEBOUNCE_MS`]; another change restarts it, so
//! diagnostics are published once typing has paused for that long. Opening, closing and saving
//! a document and a change of files on disk publish at the next turn of the loop (after the
//! messages already waiting have been handled, so a client that opens twenty files at once
//! costs one analysis, not twenty). Requests (hover, definition, completion, code actions) are
//! never delayed: they analyse the current buffers if no analysis of them exists yet.

use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::str::FromStr;
use std::sync::Arc;

use lsp_server::{ErrorCode, Message, Notification, Request, RequestId, Response};
use lsp_types::{
    CodeActionContext, CodeActionKind, CodeActionOptions, CodeActionParams,
    CodeActionProviderCapability, CodeActionResponse, CompletionItem, CompletionList,
    CompletionOptions, CompletionParams, CompletionResponse, CompletionTextEdit, Diagnostic,
    DidChangeTextDocumentParams, DidChangeWatchedFilesParams, DidCloseTextDocumentParams,
    DidOpenTextDocumentParams, DidSaveTextDocumentParams, Documentation, GotoDefinitionParams,
    GotoDefinitionResponse, Hover, HoverContents, HoverParams, HoverProviderCapability,
    InitializeResult, Location, MarkupContent, MarkupKind, OneOf, PublishDiagnosticsParams, Range,
    SaveOptions, ServerCapabilities, ServerInfo, TextDocumentContentChangeEvent,
    TextDocumentSyncCapability, TextDocumentSyncKind, TextDocumentSyncOptions,
    TextDocumentSyncSaveOptions, TextEdit, Uri,
};
use mtek_compiler::source::{LineIndex, ProjectPath};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use super::analysis::Snapshot;
use super::clock::Clock;
use super::completion::{self, Candidate};
use super::convert::{self, Located, Uris};
use super::definition::{Target, definition_at};
use super::hover::hover_at;
use super::overlay::Buffers;
use super::position::PositionEncoding;
use super::prelude_doc;
use super::transport::{Inbound, Outbound};
use super::uri::{self, UriKind};

/// How long diagnostics wait after the last change to a document (`spec/tooling.md` section 7).
pub const DEBOUNCE_MS: u64 = 150;

/// The file name of the project file.
const PROJECT_FILE: &str = "mtek.toml";

/// The scheme-less method of the standard-library documents (LSP 3.18).
const CONTENT_REQUEST: &str = "workspace/textDocumentContent";

/// Where in its life the session is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Lifecycle {
    /// Before `initialize`.
    Waiting,
    Running,
    /// After `shutdown`: only `exit` is honoured.
    ShuttingDown,
}

/// What the client told us it can do (from `initialize`).
#[derive(Clone, Debug)]
struct ClientCaps {
    markdown_hover: bool,
    document_changes: bool,
    dynamic_watchers: bool,
    related_information: bool,
}

impl Default for ClientCaps {
    fn default() -> Self {
        Self {
            markdown_hover: true,
            document_changes: false,
            dynamic_watchers: false,
            related_information: true,
        }
    }
}

impl ClientCaps {
    fn from_value(capabilities: &Value) -> Self {
        let flag = |path: &[&str], default: bool| {
            path.iter()
                .try_fold(capabilities, |value, key| value.get(*key))
                .and_then(Value::as_bool)
                .unwrap_or(default)
        };
        let hover_formats = capabilities
            .pointer("/textDocument/hover/contentFormat")
            .and_then(Value::as_array);
        Self {
            // A client that lists the formats it reads and leaves out Markdown gets plain text.
            markdown_hover: hover_formats
                .is_none_or(|list| list.iter().any(|kind| kind.as_str() == Some("markdown"))),
            document_changes: flag(&["workspace", "workspaceEdit", "documentChanges"], false),
            dynamic_watchers: flag(
                &["workspace", "didChangeWatchedFiles", "dynamicRegistration"],
                false,
            ),
            related_information: flag(
                &["textDocument", "publishDiagnostics", "relatedInformation"],
                true,
            ),
        }
    }
}

/// Where an open document lives.
#[derive(Clone, PartialEq, Eq, Debug)]
enum Home {
    /// The file `path` of the project in `dir`.
    Project { dir: PathBuf, path: ProjectPath },
    /// A text with no project: a file outside any (no `mtek.toml` above it), or not a file.
    Loose,
    /// A virtual document of the standard library (`mtek-prelude:`), read-only.
    Virtual,
}

struct Document {
    /// The URI the client uses, as it wrote it.
    uri: Uri,
    version: i32,
    text: String,
    home: Home,
}

/// What diagnostics are published for: a project (all its files) or one loose document.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Publish {
    Project(PathBuf),
    Loose(String),
}

#[derive(Clone, Copy, Debug)]
struct Pending {
    due: u64,
    debounced: bool,
}

/// The analyses of one project, valid for one `generation` of its buffers.
struct ProjectState {
    /// The URI of the project directory as the client spells it.
    uri_prefix: String,
    /// Bumped by everything that can change an analysis: an edit, a save, a file on disk.
    generation: u64,
    quick: Option<(u64, Rc<Snapshot>)>,
    full: Option<(u64, Rc<Snapshot>)>,
    /// What the client currently shows, by URI.
    published: BTreeMap<String, Vec<Diagnostic>>,
}

/// An error answer to a request.
struct Failure {
    code: ErrorCode,
    message: String,
}

impl Failure {
    fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidParams, message)
    }
}

type Answer = Result<Value, Failure>;

/// The language server.
pub struct Server {
    clock: Box<dyn Clock>,
    lifecycle: Lifecycle,
    encoding: PositionEncoding,
    caps: ClientCaps,
    docs: BTreeMap<String, Document>,
    projects: BTreeMap<PathBuf, ProjectState>,
    loose_published: BTreeMap<String, Vec<Diagnostic>>,
    pending: BTreeMap<Publish, Pending>,
    out: Vec<Outbound>,
    next_request_id: i32,
    exit: Option<u8>,
    /// Run at the start of every request and every publication: tests make it panic to show that
    /// a defect in a handler loses nothing.
    #[cfg(test)]
    pub(super) fault: Option<fn()>,
}

impl Server {
    pub fn new(clock: Box<dyn Clock>) -> Self {
        Self {
            clock,
            lifecycle: Lifecycle::Waiting,
            encoding: PositionEncoding::Utf16,
            caps: ClientCaps::default(),
            docs: BTreeMap::new(),
            projects: BTreeMap::new(),
            loose_published: BTreeMap::new(),
            pending: BTreeMap::new(),
            out: Vec::new(),
            next_request_id: 1,
            exit: None,
            #[cfg(test)]
            fault: None,
        }
    }

    /// The process exit code once the session is over: 0 for `exit` after `shutdown` (or the
    /// input ending after it), 1 otherwise (`spec/tooling.md`, the protocol's rule).
    pub fn exit_code(&self) -> Option<u8> {
        self.exit
    }

    /// Everything the server wants to send, oldest first; empties the queue.
    pub fn take_outgoing(&mut self) -> Vec<Outbound> {
        std::mem::take(&mut self.out)
    }

    /// Milliseconds until something is due (`Some(0)` if it already is), `None` if nothing
    /// is waiting for the clock.
    pub fn millis_until_due(&self) -> Option<u64> {
        let now = self.clock.now_ms();
        self.pending
            .values()
            .map(|pending| pending.due.saturating_sub(now))
            .min()
    }

    /// The input ended or its framing broke: the session is over.
    pub fn closed(&mut self, reason: Option<&str>) {
        if let Some(reason) = reason {
            eprintln!("mtek lsp: the input is unusable ({reason}); ending the session");
        }
        if self.exit.is_none() {
            self.exit = Some(if self.lifecycle == Lifecycle::ShuttingDown {
                0
            } else {
                1
            });
        }
    }

    /// Handle one thing the reading side produced.
    pub fn handle(&mut self, inbound: Inbound) {
        match inbound {
            Inbound::Request(request) => self.on_request(request),
            Inbound::Notification(notification) => self.on_notification(notification),
            Inbound::Response => {}
            Inbound::Rejected { id, code, message } => {
                self.out.push(Outbound::Rejection { id, code, message });
            }
            Inbound::Closed { reason } => self.closed(reason.as_deref()),
        }
    }

    // -----------------------------------------------------------------------
    // Requests
    // -----------------------------------------------------------------------

    fn on_request(&mut self, request: Request) {
        let Request { id, method, params } = request;
        let answer = match self.lifecycle {
            Lifecycle::Waiting if method != "initialize" => Err(Failure::new(
                ErrorCode::ServerNotInitialized,
                "the server is not initialized: send `initialize` first",
            )),
            Lifecycle::ShuttingDown => Err(Failure::new(
                ErrorCode::InvalidRequest,
                "the server is shutting down: only `exit` is accepted",
            )),
            _ => match catch_unwind(AssertUnwindSafe(|| self.request(&method, params))) {
                Ok(answer) => answer,
                Err(payload) => {
                    let message = self.recover(payload.as_ref());
                    Err(Failure::new(
                        ErrorCode::InternalError,
                        format!("an internal error handling '{method}': {message}"),
                    ))
                }
            },
        };
        let response = match answer {
            Ok(value) => Response {
                id,
                response_result: Ok(value),
            },
            Err(failure) => Response::new_err(id, failure.code as i32, failure.message),
        };
        self.out
            .push(Outbound::Message(Message::Response(response)));
    }

    fn request(&mut self, method: &str, params: Value) -> Answer {
        #[cfg(test)]
        if let Some(fault) = self.fault {
            fault();
        }
        match method {
            "initialize" => self.initialize(params),
            "shutdown" => {
                self.lifecycle = Lifecycle::ShuttingDown;
                Ok(Value::Null)
            }
            "textDocument/hover" => self.hover(parse(params)?),
            "textDocument/definition" => self.definition(parse(params)?),
            "textDocument/completion" => self.completion(parse(params)?),
            "textDocument/codeAction" => self.code_action(parse(params)?),
            CONTENT_REQUEST => self.content(&params),
            other => Err(Failure::new(
                ErrorCode::MethodNotFound,
                format!("the method '{other}' is not supported"),
            )),
        }
    }

    fn initialize(&mut self, params: Value) -> Answer {
        if self.lifecycle != Lifecycle::Waiting {
            return Err(Failure::new(
                ErrorCode::InvalidRequest,
                "the server is already initialized",
            ));
        }
        let capabilities = params.get("capabilities").cloned().unwrap_or(Value::Null);
        let offered: Option<Vec<String>> = capabilities
            .pointer("/general/positionEncodings")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|name| name.as_str().map(str::to_owned))
                    .collect()
            });
        self.encoding = PositionEncoding::negotiate(offered.as_deref());
        self.caps = ClientCaps::from_value(&capabilities);
        self.lifecycle = Lifecycle::Running;
        let result = InitializeResult {
            capabilities: self.server_capabilities(),
            server_info: Some(ServerInfo {
                name: "mtek".to_owned(),
                version: Some(mtek_compiler::COMPILER_VERSION.to_owned()),
            }),
        };
        let mut value = serde_json::to_value(result).map_err(|error| {
            Failure::new(
                ErrorCode::InternalError,
                format!("cannot describe the server: {error}"),
            )
        })?;
        // The standard-library documents (LSP 3.18 `workspace/textDocumentContent`), which
        // `lsp-types` does not describe.
        if let Some(capabilities) = value.get_mut("capabilities").and_then(Value::as_object_mut) {
            capabilities.insert(
                "workspace".to_owned(),
                json!({ "textDocumentContent": { "schemes": [uri::PRELUDE_SCHEME] } }),
            );
        }
        Ok(value)
    }

    fn server_capabilities(&self) -> ServerCapabilities {
        ServerCapabilities {
            position_encoding: Some(self.encoding.kind()),
            text_document_sync: Some(TextDocumentSyncCapability::Options(
                TextDocumentSyncOptions {
                    open_close: Some(true),
                    change: Some(TextDocumentSyncKind::FULL),
                    save: Some(TextDocumentSyncSaveOptions::SaveOptions(SaveOptions {
                        include_text: Some(false),
                    })),
                    ..TextDocumentSyncOptions::default()
                },
            )),
            hover_provider: Some(HoverProviderCapability::Simple(true)),
            definition_provider: Some(OneOf::Left(true)),
            completion_provider: Some(CompletionOptions {
                resolve_provider: Some(false),
                trigger_characters: Some(vec![".".to_owned()]),
                ..CompletionOptions::default()
            }),
            code_action_provider: Some(CodeActionProviderCapability::Options(CodeActionOptions {
                code_action_kinds: Some(vec![CodeActionKind::QUICKFIX]),
                resolve_provider: Some(false),
                ..CodeActionOptions::default()
            })),
            ..ServerCapabilities::default()
        }
    }

    /// `workspace/textDocumentContent`: the text of a virtual document.
    fn content(&self, params: &Value) -> Answer {
        let uri = params
            .get("uri")
            .and_then(Value::as_str)
            .ok_or_else(|| Failure::invalid("the request needs a `uri`"))?;
        match uri::classify(uri) {
            UriKind::Prelude(path) => match prelude_doc::document(&path) {
                Some(document) => Ok(json!({ "text": &*document.text })),
                None => Err(Failure::new(
                    ErrorCode::RequestFailed,
                    format!("there is no standard-library document '{path}'"),
                )),
            },
            _ => Err(Failure::invalid(format!(
                "'{uri}' is not a document of the '{}' scheme",
                uri::PRELUDE_SCHEME
            ))),
        }
    }

    fn hover(&mut self, params: HoverParams) -> Answer {
        let position = params.text_document_position_params;
        let Some((snapshot, path, _)) = self.module_for(position.text_document.uri.as_str(), false)
        else {
            return Ok(Value::Null);
        };
        let Some(view) = snapshot.module_at(&path) else {
            return Ok(Value::Null);
        };
        let offset = self.encoding.offset(view.source.lines(), position.position);
        let Some(hover) = hover_at(&snapshot, &view, offset) else {
            return Ok(Value::Null);
        };
        let value = if self.caps.markdown_hover {
            hover.markdown
        } else {
            plain_text(&hover.markdown)
        };
        let result = Hover {
            contents: HoverContents::Markup(MarkupContent {
                kind: if self.caps.markdown_hover {
                    MarkupKind::Markdown
                } else {
                    MarkupKind::PlainText
                },
                value,
            }),
            range: Some(
                self.encoding
                    .range(view.source.lines(), hover.span.start, hover.span.end),
            ),
        };
        to_value(&result)
    }

    fn definition(&mut self, params: GotoDefinitionParams) -> Answer {
        let position = params.text_document_position_params;
        let Some((snapshot, path, dir)) =
            self.module_for(position.text_document.uri.as_str(), false)
        else {
            return Ok(Value::Null);
        };
        let Some(view) = snapshot.module_at(&path) else {
            return Ok(Value::Null);
        };
        let offset = self.encoding.offset(view.source.lines(), position.position);
        let Some(target) = definition_at(&snapshot, &view, offset) else {
            return Ok(Value::Null);
        };
        let uris = self.project_uris(&dir);
        let location = match target {
            Target::Source { module, span } => snapshot.module(module).and_then(|m| {
                Some(Location {
                    uri: uris.uri(m.path)?,
                    range: self.encoding.range(m.source.lines(), span.start, span.end),
                })
            }),
            Target::Module(module) => snapshot.module(module).and_then(|m| {
                Some(Location {
                    uri: uris.uri(m.path)?,
                    range: Range::default(),
                })
            }),
            Target::Prelude(location) => {
                prelude_doc::document(location.path).and_then(|document| {
                    Some(Location {
                        uri: Uri::from_str(&uri::prelude_uri(location.path)).ok()?,
                        range: self
                            .encoding
                            .range(&document.lines, location.start, location.end),
                    })
                })
            }
        };
        match location {
            Some(location) => to_value(&GotoDefinitionResponse::Scalar(location)),
            None => Ok(Value::Null),
        }
    }

    fn completion(&mut self, params: CompletionParams) -> Answer {
        let position = params.text_document_position;
        let key = position.text_document.uri.as_str().to_owned();
        let Some(doc) = self.docs.get(&key) else {
            return Ok(Value::Null);
        };
        let Home::Project { dir, path } = doc.home.clone() else {
            return Ok(Value::Null);
        };
        let text = doc.text.clone();
        let lines = LineIndex::new(Arc::from(text.as_str()));
        let offset = self.encoding.offset(&lines, position.position);
        let Some(prepared) = completion::prepare(&text, offset) else {
            return Ok(Value::Null);
        };
        let current = if prepared.patched.is_none() {
            self.snapshot(&dir, false)
        } else {
            None
        };
        let buffers = self.buffers(&dir);
        let Some(found) = completion::complete_prepared(
            &prepared,
            &dir,
            &buffers,
            &path,
            &text,
            current.as_deref(),
        ) else {
            return Ok(Value::Null);
        };
        let replace = self
            .encoding
            .range(&lines, found.replace.0, found.replace.1);
        let items: Vec<CompletionItem> = found
            .candidates
            .into_iter()
            .map(|candidate| completion_item(candidate, replace))
            .collect();
        to_value(&CompletionResponse::List(CompletionList {
            is_incomplete: false,
            items,
        }))
    }

    fn code_action(&mut self, params: CodeActionParams) -> Answer {
        let CodeActionParams {
            text_document,
            range,
            context,
            ..
        } = params;
        if !wants_quickfix(&context) {
            return to_value(&CodeActionResponse::new());
        }
        let Some(doc) = self.docs.get(text_document.uri.as_str()) else {
            return Ok(Value::Null);
        };
        let Home::Project { dir, path } = doc.home.clone() else {
            return to_value(&CodeActionResponse::new());
        };
        let Some(snapshot) = self.snapshot(&dir, true) else {
            return to_value(&CodeActionResponse::new());
        };
        let uris = self.project_uris(&dir);
        let converted = self.convert_project(&snapshot, &dir);
        let Some(view) = snapshot.module_at(&path) else {
            return to_value(&CodeActionResponse::new());
        };
        let (start, end) = self.encoding.byte_range(view.source.lines(), range);
        let actions: CodeActionResponse = converted
            .get(&path)
            .into_iter()
            .flatten()
            .filter(|located| !located.fixes.is_empty())
            .filter(|located| located.bytes.0 <= end && start <= located.bytes.1)
            .flat_map(|located| convert::code_actions(located, &uris, self.caps.document_changes))
            .map(lsp_types::CodeActionOrCommand::CodeAction)
            .collect();
        to_value(&actions)
    }

    // -----------------------------------------------------------------------
    // Notifications
    // -----------------------------------------------------------------------

    fn on_notification(&mut self, notification: Notification) {
        let Notification { method, params } = notification;
        if method == "exit" {
            self.exit = Some(if self.lifecycle == Lifecycle::ShuttingDown {
                0
            } else {
                1
            });
            return;
        }
        if self.lifecycle != Lifecycle::Running {
            return;
        }
        let result = catch_unwind(AssertUnwindSafe(|| self.notification(&method, params)));
        match result {
            Ok(Ok(())) => {}
            Ok(Err(reason)) => {
                eprintln!("mtek lsp: ignoring a malformed '{method}' notification: {reason}");
            }
            Err(payload) => {
                let message = self.recover(payload.as_ref());
                eprintln!("mtek lsp: an internal error handling '{method}': {message}");
            }
        }
    }

    fn notification(&mut self, method: &str, params: Value) -> Result<(), String> {
        match method {
            "initialized" => {
                self.register_watchers();
                Ok(())
            }
            "textDocument/didOpen" => {
                let params: DidOpenTextDocumentParams = parse_notification(params)?;
                let item = params.text_document;
                self.open(item.uri, item.version, item.text);
                Ok(())
            }
            "textDocument/didChange" => {
                let params: DidChangeTextDocumentParams = parse_notification(params)?;
                self.change(
                    params.text_document.uri.as_str(),
                    params.text_document.version,
                    params.content_changes,
                );
                Ok(())
            }
            "textDocument/didClose" => {
                let params: DidCloseTextDocumentParams = parse_notification(params)?;
                self.close(params.text_document.uri.as_str());
                Ok(())
            }
            "textDocument/didSave" => {
                let params: DidSaveTextDocumentParams = parse_notification(params)?;
                self.saved(params.text_document.uri.as_str());
                Ok(())
            }
            "workspace/didChangeWatchedFiles" => {
                let _: DidChangeWatchedFilesParams = parse_notification(params)?;
                self.files_changed();
                Ok(())
            }
            // Cancellation: requests are answered in order, one at a time, so by the time a
            // cancellation is read the request is answered or running.
            "$/cancelRequest" | "$/setTrace" | "workspace/didChangeConfiguration" => Ok(()),
            _ => Ok(()),
        }
    }

    /// Ask the client to tell us about changes to the files the compiler reads, if it can.
    fn register_watchers(&mut self) {
        if !self.caps.dynamic_watchers {
            return;
        }
        let id = self.next_request_id;
        self.next_request_id += 1;
        let watchers: Vec<Value> = [
            "**/*.mtek",
            "**/mtek.toml",
            "**/*.glb",
            "**/*.png",
            "**/*.jpg",
            "**/*.jpeg",
        ]
        .iter()
        .map(|glob| json!({ "globPattern": glob }))
        .collect();
        self.out.push(Outbound::Message(Message::Request(Request {
            id: RequestId::from(id),
            method: "client/registerCapability".to_owned(),
            params: json!({
                "registrations": [{
                    "id": "mtek-watched-files",
                    "method": "workspace/didChangeWatchedFiles",
                    "registerOptions": { "watchers": watchers },
                }],
            }),
        })));
    }

    fn open(&mut self, uri: Uri, version: i32, text: String) {
        let key = uri.as_str().to_owned();
        let home = self.home_of(&key);
        if let Some(previous) = self.docs.insert(
            key.clone(),
            Document {
                uri,
                version,
                text,
                home: home.clone(),
            },
        ) {
            self.dirty_home(&previous.home, false);
        }
        self.dirty_home(&home, false);
        self.ensure_project(&key);
    }

    fn change(&mut self, key: &str, version: i32, changes: Vec<TextDocumentContentChangeEvent>) {
        let encoding = self.encoding;
        let Some(doc) = self.docs.get_mut(key) else {
            eprintln!("mtek lsp: a change to a document that is not open: {key}");
            return;
        };
        for change in &changes {
            apply_change(&mut doc.text, encoding, change);
        }
        doc.version = version;
        let home = doc.home.clone();
        self.dirty_home(&home, true);
    }

    fn close(&mut self, key: &str) {
        let Some(doc) = self.docs.remove(key) else {
            return;
        };
        match &doc.home {
            Home::Loose => {
                self.pending.remove(&Publish::Loose(key.to_owned()));
                if self.loose_published.remove(key).is_some() {
                    self.publish(key, Vec::new(), None);
                }
            }
            Home::Virtual => {}
            Home::Project { dir, .. } => {
                let still_open = self
                    .docs
                    .values()
                    .any(|d| matches!(&d.home, Home::Project { dir: other, .. } if other == dir));
                if still_open {
                    self.dirty_home(&doc.home, false);
                } else if let Some(state) = self.projects.remove(dir) {
                    self.pending.remove(&Publish::Project(dir.clone()));
                    for (uri, _) in state.published {
                        self.publish(&uri, Vec::new(), None);
                    }
                }
            }
        }
    }

    fn saved(&mut self, key: &str) {
        // What is on disk changed, and the buffer now equals it: everything is looked at again.
        let _ = key;
        self.files_changed();
    }

    /// Files changed on disk (or were saved): the project of every document is analysed again,
    /// and a document may have found or lost its project file.
    fn files_changed(&mut self) {
        let keys: Vec<String> = self.docs.keys().cloned().collect();
        for key in keys {
            let home = self.home_of(&key);
            let Some(doc) = self.docs.get_mut(&key) else {
                continue;
            };
            let old = std::mem::replace(&mut doc.home, home.clone());
            if old != home {
                self.dirty_home(&old, false);
            }
            self.dirty_home(&home, false);
            self.ensure_project(&key);
        }
        for state in self.projects.values_mut() {
            state.generation += 1;
        }
        let dirs: Vec<PathBuf> = self.projects.keys().cloned().collect();
        let now = self.clock.now_ms();
        for dir in dirs {
            self.pending.insert(
                Publish::Project(dir),
                Pending {
                    due: now,
                    debounced: false,
                },
            );
        }
    }

    /// The projects and documents `home` belongs to must be published again.
    fn dirty_home(&mut self, home: &Home, debounced: bool) {
        let target = match home {
            Home::Project { dir, .. } => {
                if let Some(state) = self.projects.get_mut(dir) {
                    state.generation += 1;
                }
                Publish::Project(dir.clone())
            }
            Home::Loose => return self.dirty_loose(debounced),
            Home::Virtual => return,
        };
        self.schedule(target, debounced);
    }

    /// Every loose document is published again (they are independent, but cheap).
    fn dirty_loose(&mut self, debounced: bool) {
        let keys: Vec<String> = self
            .docs
            .iter()
            .filter(|(_, doc)| doc.home == Home::Loose)
            .map(|(key, _)| key.clone())
            .collect();
        for key in keys {
            self.schedule(Publish::Loose(key), debounced);
        }
    }

    fn schedule(&mut self, target: Publish, debounced: bool) {
        let now = self.clock.now_ms();
        match self.pending.get_mut(&target) {
            None => {
                let due = if debounced {
                    now.saturating_add(DEBOUNCE_MS)
                } else {
                    now
                };
                self.pending.insert(target, Pending { due, debounced });
            }
            // A change restarts the timer of a waiting change; it never delays what is already
            // due to be published now.
            Some(entry) if debounced => {
                if entry.debounced {
                    entry.due = now.saturating_add(DEBOUNCE_MS);
                }
            }
            Some(entry) => {
                *entry = Pending {
                    due: now,
                    debounced: false,
                };
            }
        }
    }

    // -----------------------------------------------------------------------
    // Homes, projects, snapshots
    // -----------------------------------------------------------------------

    fn home_of(&self, key: &str) -> Home {
        match uri::classify(key) {
            UriKind::File(file) => home_of_file(&file),
            UriKind::Prelude(_) => Home::Virtual,
            UriKind::Other => Home::Loose,
        }
    }

    /// Make sure the project of the document `key` has a state.
    fn ensure_project(&mut self, key: &str) {
        let Some(doc) = self.docs.get(key) else {
            return;
        };
        let Home::Project { dir, path } = &doc.home else {
            return;
        };
        if self.projects.contains_key(dir) {
            return;
        }
        let prefix =
            uri::project_dir_uri(doc.uri.as_str(), path).unwrap_or_else(|| uri::file_uri(dir));
        self.projects.insert(
            dir.clone(),
            ProjectState {
                uri_prefix: prefix,
                generation: 0,
                quick: None,
                full: None,
                published: BTreeMap::new(),
            },
        );
    }

    /// The open buffers of the project in `dir`.
    fn buffers(&self, dir: &Path) -> Buffers {
        self.docs
            .values()
            .filter_map(|doc| match &doc.home {
                Home::Project { dir: other, path } if other == dir => {
                    Some((path.clone(), Arc::<str>::from(doc.text.as_str())))
                }
                _ => None,
            })
            .collect()
    }

    /// The snapshot of the current buffers of the project in `dir`; `full` asks for the one whose
    /// report carries the validated suggested edits.
    fn snapshot(&mut self, dir: &Path, full: bool) -> Option<Rc<Snapshot>> {
        let generation = self.projects.get(dir)?.generation;
        {
            let state = self.projects.get(dir)?;
            if let Some((made, snapshot)) = &state.full
                && *made == generation
            {
                return Some(Rc::clone(snapshot));
            }
            if !full
                && let Some((made, snapshot)) = &state.quick
                && *made == generation
            {
                return Some(Rc::clone(snapshot));
            }
        }
        let buffers = self.buffers(dir);
        let snapshot = Rc::new(Snapshot::run(dir, &buffers, full));
        let state = self.projects.get_mut(dir)?;
        if full {
            state.full = Some((generation, Rc::clone(&snapshot)));
        } else {
            state.quick = Some((generation, Rc::clone(&snapshot)));
        }
        Some(snapshot)
    }

    /// The snapshot of the project of the document `key`, with its path in the project and the
    /// project's directory, if the document is a file of a project.
    fn module_for(
        &mut self,
        key: &str,
        full: bool,
    ) -> Option<(Rc<Snapshot>, ProjectPath, PathBuf)> {
        let doc = self.docs.get(key)?;
        let Home::Project { dir, path } = doc.home.clone() else {
            return None;
        };
        let snapshot = self.snapshot(&dir, full)?;
        Some((snapshot, path, dir))
    }

    fn project_uris(&self, dir: &Path) -> ProjectUris {
        ProjectUris {
            prefix: self
                .projects
                .get(dir)
                .map_or_else(|| uri::file_uri(dir), |state| state.uri_prefix.clone()),
            open: self
                .docs
                .values()
                .filter_map(|doc| match &doc.home {
                    Home::Project { dir: other, path } if other == dir => {
                        Some((path.clone(), (doc.uri.clone(), doc.version)))
                    }
                    _ => None,
                })
                .collect(),
        }
    }

    // -----------------------------------------------------------------------
    // Diagnostics
    // -----------------------------------------------------------------------

    /// Publish what is due. Call after handling messages and whenever the clock may have moved.
    pub fn poll(&mut self) {
        let now = self.clock.now_ms();
        let due: Vec<Publish> = self
            .pending
            .iter()
            .filter(|(_, pending)| pending.due <= now)
            .map(|(target, _)| target.clone())
            .collect();
        for target in due {
            self.pending.remove(&target);
            let result = catch_unwind(AssertUnwindSafe(|| match &target {
                Publish::Project(dir) => self.publish_project(dir),
                Publish::Loose(key) => self.publish_loose(key),
            }));
            if let Err(payload) = result {
                let message = self.recover(payload.as_ref());
                eprintln!("mtek lsp: an internal error publishing diagnostics: {message}");
            }
        }
    }

    /// The diagnostics of every file of the project, by project path, with those of the open
    /// documents that the project's modules do not include (syntax only).
    fn convert_project(
        &self,
        snapshot: &Snapshot,
        dir: &Path,
    ) -> BTreeMap<ProjectPath, Vec<Located>> {
        let uris = self.project_uris(dir);
        let fallback = ProjectPath::new(PROJECT_FILE).unwrap_or_else(|_| ProjectPath::root());
        let (report, sources) = match &snapshot.analysis.project {
            Some(project) => (&snapshot.analysis.report, &project.sources),
            None => {
                // The project did not load: its report has no sources to refer to. The
                // diagnostics have no location and go to the project file.
                let empty = mtek_compiler::source::SourceMap::new();
                return convert::convert(
                    &snapshot.analysis.report,
                    &empty,
                    self.encoding,
                    &uris,
                    &fallback,
                )
                .into_iter()
                .chain(self.unreached(snapshot, dir))
                .fold(BTreeMap::new(), merge);
            }
        };
        let mut files = convert::convert(report, sources, self.encoding, &uris, &fallback);
        for (path, located) in self.unreached(snapshot, dir) {
            files.entry(path).or_default().extend(located);
        }
        files
    }

    /// The syntax diagnostics of the open documents of `dir` that no module of the snapshot is.
    fn unreached(&self, snapshot: &Snapshot, dir: &Path) -> Vec<(ProjectPath, Vec<Located>)> {
        let uris = self.project_uris(dir);
        self.docs
            .values()
            .filter_map(|doc| match &doc.home {
                Home::Project { dir: other, path }
                    if other == dir
                        && path.file_name().is_some_and(|name| name.ends_with(".mtek"))
                        && snapshot.module_at(path).is_none() =>
                {
                    let (sources, report) = convert::syntax_report(&doc.text);
                    let loose = ProjectPath::new(convert::LOOSE_PATH).ok()?;
                    let by_file = convert::convert(&report, &sources, self.encoding, &uris, &loose);
                    Some((path.clone(), by_file.into_values().flatten().collect()))
                }
                _ => None,
            })
            .collect()
    }

    fn publish_project(&mut self, dir: &Path) {
        #[cfg(test)]
        if let Some(fault) = self.fault {
            fault();
        }
        let Some(snapshot) = self.snapshot(dir, true) else {
            return;
        };
        let converted = self.convert_project(&snapshot, dir);
        let uris = self.project_uris(dir);
        let related = self.caps.related_information;
        let mut now: BTreeMap<String, (Vec<Diagnostic>, Option<i32>)> = BTreeMap::new();
        for (path, located) in converted {
            let Some(uri) = uris.uri(&path) else {
                continue;
            };
            let diagnostics = located
                .into_iter()
                .map(|located| strip_related(located.lsp, related))
                .collect();
            now.insert(uri.as_str().to_owned(), (diagnostics, uris.version(&path)));
        }
        // A document that is open and has no diagnostics is published as clean, once.
        for (uri, version) in uris.open.values() {
            now.entry(uri.as_str().to_owned())
                .or_insert_with(|| (Vec::new(), Some(*version)));
        }
        let Some(state) = self.projects.get_mut(dir) else {
            return;
        };
        let old = std::mem::take(&mut state.published);
        let mut sends: Vec<(String, Vec<Diagnostic>, Option<i32>)> = Vec::new();
        for (uri, (diagnostics, version)) in &now {
            if old.get(uri) != Some(diagnostics) {
                sends.push((uri.clone(), diagnostics.clone(), *version));
            }
        }
        for uri in old.keys() {
            if !now.contains_key(uri) {
                sends.push((uri.clone(), Vec::new(), None));
            }
        }
        state.published = now
            .into_iter()
            .map(|(uri, (diagnostics, _))| (uri, diagnostics))
            .collect();
        for (uri, diagnostics, version) in sends {
            self.publish(&uri, diagnostics, version);
        }
    }

    fn publish_loose(&mut self, key: &str) {
        let Some(doc) = self.docs.get(key) else {
            return;
        };
        let (sources, report) = convert::syntax_report(&doc.text);
        let uris = convert::OneDocument {
            uri: doc.uri.clone(),
            version: Some(doc.version),
        };
        let loose = ProjectPath::new(convert::LOOSE_PATH).unwrap_or_else(|_| ProjectPath::root());
        let related = self.caps.related_information;
        let diagnostics: Vec<Diagnostic> =
            convert::convert(&report, &sources, self.encoding, &uris, &loose)
                .into_values()
                .flatten()
                .map(|located| strip_related(located.lsp, related))
                .collect();
        let version = Some(doc.version);
        if self.loose_published.get(key) != Some(&diagnostics) {
            self.loose_published
                .insert(key.to_owned(), diagnostics.clone());
            self.publish(key, diagnostics, version);
        }
    }

    fn publish(&mut self, uri: &str, diagnostics: Vec<Diagnostic>, version: Option<i32>) {
        let Ok(uri) = Uri::from_str(uri) else {
            return;
        };
        let params = PublishDiagnosticsParams {
            uri,
            diagnostics,
            version,
        };
        self.out
            .push(Outbound::Message(Message::Notification(Notification::new(
                "textDocument/publishDiagnostics".to_owned(),
                params,
            ))));
    }

    /// A handler panicked: drop everything computed (it is recomputed from the buffers, which
    /// are untouched) and describe the panic.
    fn recover(&mut self, payload: &(dyn std::any::Any + Send)) -> String {
        for state in self.projects.values_mut() {
            state.generation += 1;
            state.quick = None;
            state.full = None;
        }
        crate::guard::take_last_panic().unwrap_or_else(|| {
            if let Some(text) = payload.downcast_ref::<&str>() {
                (*text).to_owned()
            } else if let Some(text) = payload.downcast_ref::<String>() {
                text.clone()
            } else {
                "a panic without a message".to_owned()
            }
        })
    }
}

/// The URIs of one project's files: the client's own for open documents, the project
/// directory's URI plus the path for the others.
struct ProjectUris {
    prefix: String,
    open: BTreeMap<ProjectPath, (Uri, i32)>,
}

impl Uris for ProjectUris {
    fn uri(&self, path: &ProjectPath) -> Option<Uri> {
        match self.open.get(path) {
            Some((uri, _)) => Some(uri.clone()),
            None => Uri::from_str(&uri::join_uri(&self.prefix, path)).ok(),
        }
    }

    fn version(&self, path: &ProjectPath) -> Option<i32> {
        self.open.get(path).map(|(_, version)| *version)
    }
}

fn merge(
    mut all: BTreeMap<ProjectPath, Vec<Located>>,
    (path, located): (ProjectPath, Vec<Located>),
) -> BTreeMap<ProjectPath, Vec<Located>> {
    all.entry(path).or_default().extend(located);
    all
}

fn strip_related(mut diagnostic: Diagnostic, keep: bool) -> Diagnostic {
    if !keep {
        diagnostic.related_information = None;
    }
    diagnostic
}

/// The home of the file `path`: the project of the nearest `mtek.toml` above it.
fn home_of_file(path: &Path) -> Home {
    for dir in path.ancestors().skip(1) {
        if dir.join(PROJECT_FILE).is_file() {
            let Ok(relative) = path.strip_prefix(dir) else {
                return Home::Loose;
            };
            let parts: Option<Vec<&str>> = relative
                .components()
                .map(|c| c.as_os_str().to_str())
                .collect();
            let Some(parts) = parts else {
                return Home::Loose;
            };
            return match ProjectPath::new(&parts.join("/")) {
                Ok(project_path) => Home::Project {
                    dir: dir.to_path_buf(),
                    path: project_path,
                },
                Err(_) => Home::Loose,
            };
        }
    }
    Home::Loose
}

fn wants_quickfix(context: &CodeActionContext) -> bool {
    context.only.as_ref().is_none_or(|kinds| {
        kinds
            .iter()
            .any(|kind| CodeActionKind::QUICKFIX.as_str().starts_with(kind.as_str()))
    })
}

fn completion_item(candidate: Candidate, replace: Range) -> CompletionItem {
    CompletionItem {
        sort_text: Some(format!("{}{}", candidate.group, candidate.label)),
        text_edit: Some(CompletionTextEdit::Edit(TextEdit {
            range: replace,
            new_text: candidate.label.clone(),
        })),
        label: candidate.label,
        kind: Some(candidate.kind),
        detail: candidate.detail,
        documentation: candidate.documentation.map(|value| {
            Documentation::MarkupContent(MarkupContent {
                kind: MarkupKind::Markdown,
                value,
            })
        }),
        ..CompletionItem::default()
    }
}

/// Apply one change event to the text of a document: the whole text, or a range.
fn apply_change(
    text: &mut String,
    encoding: PositionEncoding,
    change: &TextDocumentContentChangeEvent,
) {
    match change.range {
        None => text.clone_from(&change.text),
        Some(range) => {
            let lines = LineIndex::new(Arc::from(text.as_str()));
            let (start, end) = encoding.byte_range(&lines, range);
            let (start, end) = (start as usize, end as usize);
            if text.is_char_boundary(start) && text.is_char_boundary(end) && start <= end {
                text.replace_range(start..end, &change.text);
            }
        }
    }
}

/// Markdown as plain text: the code fences go, the text stays.
fn plain_text(markdown: &str) -> String {
    markdown
        .lines()
        .filter(|line| !line.starts_with("```"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse<T: DeserializeOwned>(params: Value) -> Result<T, Failure> {
    serde_json::from_value(params).map_err(|error| Failure::invalid(error.to_string()))
}

fn parse_notification<T: DeserializeOwned>(params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|error| error.to_string())
}

fn to_value<T: serde::Serialize>(value: &T) -> Answer {
    serde_json::to_value(value)
        .map_err(|error| Failure::new(ErrorCode::InternalError, error.to_string()))
}
