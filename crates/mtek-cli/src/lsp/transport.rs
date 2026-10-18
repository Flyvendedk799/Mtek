//! The stdio transport: `Content-Length` framed JSON-RPC (decision 0076 item 1).
//!
//! The message types and the serialisation of outgoing messages are `lsp-server`'s
//! ([`Message`], [`Request`], [`Notification`], [`Response`]). The reading side is this module's
//! own, for three reasons the garbage-input tests rest on:
//!
//! * a payload that is not a valid message is answered with a JSON-RPC error (`-32700` parse
//!   error, `-32600` invalid request, with the request's id when it has one and `null`
//!   otherwise) and the session goes on; `lsp-server`'s reader ends the session;
//! * the announced `Content-Length` is bounded ([`MAX_BODY_BYTES`]); `lsp-server` allocates it;
//! * the replies of the client to the requests of the server are recognised and set aside
//!   instead of being parsed as requests (a `null` result is a valid response).
//!
//! A damaged frame header (no `Content-Length`, an unreadable length, a truncated body) cannot
//! be resynchronised: the session ends ([`Inbound::Closed`]) with the reason on stderr.

use std::io::{self, BufRead, Write};
use std::sync::mpsc::Sender;

use lsp_server::{ErrorCode, Message, Notification, Request, RequestId, Response};
use serde_json::{Value, json};

/// The largest message body accepted: 64 MiB. A 4 MiB source file, the largest the compiler
/// accepts, is at most 24 MiB as escaped JSON; anything larger is not a message of a client.
pub const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;

/// The longest header line accepted.
const MAX_HEADER_LINE: usize = 8 * 1024;

/// The most header lines in one frame.
const MAX_HEADER_LINES: usize = 32;

/// What the reading side produced.
#[derive(Debug)]
pub enum Inbound {
    Request(Request),
    Notification(Notification),
    /// A reply to a request of the server. The server asks only for things it does not need an
    /// answer to (the registration of file watchers), so it is set aside.
    Response,
    /// A readable frame that is not a valid message; the server sends this error and goes on.
    Rejected {
        id: Option<RequestId>,
        code: ErrorCode,
        message: String,
    },
    /// The stream ended or its framing is damaged beyond repair; `reason` is `None` for a clean
    /// end of input.
    Closed {
        reason: Option<String>,
    },
}

/// Why a frame could not be read.
#[derive(Debug, PartialEq, Eq)]
pub enum FrameError {
    /// A header line is not `Name: value` or is too long, or there are too many of them.
    BadHeader(String),
    /// The frame has no `Content-Length`.
    NoLength,
    /// The `Content-Length` is not a number.
    BadLength(String),
    /// The `Content-Length` is more than [`MAX_BODY_BYTES`].
    TooLarge(usize),
    /// The input ended inside a frame.
    Truncated,
    /// Reading failed.
    Io(String),
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FrameError::BadHeader(line) => write!(f, "malformed header line {line:?}"),
            FrameError::NoLength => f.write_str("a frame without a Content-Length header"),
            FrameError::BadLength(value) => {
                write!(f, "the Content-Length {value:?} is not a number")
            }
            FrameError::TooLarge(size) => write!(
                f,
                "a frame of {size} bytes is larger than the limit of {MAX_BODY_BYTES} bytes"
            ),
            FrameError::Truncated => f.write_str("the input ended inside a frame"),
            FrameError::Io(error) => write!(f, "reading failed: {error}"),
        }
    }
}

/// Read one frame and return its body; `Ok(None)` at a clean end of input (before the first byte
/// of a frame).
///
/// # Errors
/// [`FrameError`]: the framing is damaged and the stream cannot be read on.
pub fn read_frame(input: &mut impl BufRead) -> Result<Option<Vec<u8>>, FrameError> {
    let mut length: Option<usize> = None;
    let mut first = true;
    for _ in 0..=MAX_HEADER_LINES {
        let line = match read_header_line(input)? {
            Some(line) => line,
            None if first => return Ok(None),
            None => return Err(FrameError::Truncated),
        };
        first = false;
        if line.is_empty() {
            let length = length.ok_or(FrameError::NoLength)?;
            let mut body = vec![0u8; length];
            input.read_exact(&mut body).map_err(|error| {
                if error.kind() == io::ErrorKind::UnexpectedEof {
                    FrameError::Truncated
                } else {
                    FrameError::Io(error.to_string())
                }
            })?;
            return Ok(Some(body));
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err(FrameError::BadHeader(line));
        };
        if name.trim().eq_ignore_ascii_case("Content-Length") {
            let value = value.trim();
            let parsed: usize = value
                .parse()
                .map_err(|_| FrameError::BadLength(value.to_owned()))?;
            if parsed > MAX_BODY_BYTES {
                return Err(FrameError::TooLarge(parsed));
            }
            length = Some(parsed);
        }
    }
    Err(FrameError::BadHeader(
        "more header lines than allowed".to_owned(),
    ))
}

/// One header line without its `\r\n` (or `\n`); `None` at the end of input.
fn read_header_line(input: &mut impl BufRead) -> Result<Option<String>, FrameError> {
    let mut line = Vec::new();
    loop {
        let (consumed, done) = {
            let buffer = input
                .fill_buf()
                .map_err(|error| FrameError::Io(error.to_string()))?;
            if buffer.is_empty() {
                return if line.is_empty() {
                    Ok(None)
                } else {
                    Err(FrameError::Truncated)
                };
            }
            match buffer.iter().position(|&byte| byte == b'\n') {
                Some(newline) => {
                    line.extend_from_slice(buffer.get(..newline).unwrap_or_default());
                    (newline + 1, true)
                }
                None => {
                    line.extend_from_slice(buffer);
                    (buffer.len(), false)
                }
            }
        };
        input.consume(consumed);
        if line.len() > MAX_HEADER_LINE {
            return Err(FrameError::BadHeader(format!(
                "a header line longer than {MAX_HEADER_LINE} bytes"
            )));
        }
        if done {
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            return String::from_utf8(line)
                .map(Some)
                .map_err(|_| FrameError::BadHeader("a header line that is not UTF-8".to_owned()));
        }
    }
}

/// Classify the body of one frame.
#[must_use]
pub fn parse_body(body: &[u8]) -> Inbound {
    let value: Value = match serde_json::from_slice(body) {
        Ok(value) => value,
        Err(error) => {
            return Inbound::Rejected {
                id: None,
                code: ErrorCode::ParseError,
                message: format!("the message is not valid JSON: {error}"),
            };
        }
    };
    let Some(object) = value.as_object() else {
        return Inbound::Rejected {
            id: None,
            code: ErrorCode::InvalidRequest,
            message: "a message must be a JSON object".to_owned(),
        };
    };
    let id = object
        .get("id")
        .and_then(|id| serde_json::from_value::<RequestId>(id.clone()).ok());
    if object.contains_key("method") {
        let rejected = |message: String| Inbound::Rejected {
            id: id.clone(),
            code: ErrorCode::InvalidRequest,
            message,
        };
        if object.contains_key("id") {
            return match serde_json::from_value::<Request>(value) {
                Ok(request) => Inbound::Request(request),
                Err(error) => rejected(format!("not a valid request: {error}")),
            };
        }
        return match serde_json::from_value::<Notification>(value) {
            Ok(notification) => Inbound::Notification(notification),
            Err(error) => rejected(format!("not a valid notification: {error}")),
        };
    }
    if object.contains_key("result") || object.contains_key("error") {
        return Inbound::Response;
    }
    Inbound::Rejected {
        id,
        code: ErrorCode::InvalidRequest,
        message: "a message needs a `method`, a `result` or an `error`".to_owned(),
    }
}

/// Read frames from `input` until it ends and send what they hold to `sender`. Stops after an
/// `exit` notification (nothing follows it), at the end of the input, at damaged framing, and
/// when `sender` is gone.
pub fn pump(mut input: impl BufRead, sender: &Sender<Inbound>) {
    loop {
        let inbound = match read_frame(&mut input) {
            Ok(Some(body)) => parse_body(&body),
            Ok(None) => Inbound::Closed { reason: None },
            Err(error) => Inbound::Closed {
                reason: Some(error.to_string()),
            },
        };
        let last = matches!(&inbound, Inbound::Closed { .. })
            || matches!(&inbound, Inbound::Notification(n) if n.method == "exit");
        if sender.send(inbound).is_err() || last {
            return;
        }
    }
}

/// What the server sends: a message, or the error reply to a payload that was not one.
#[derive(Debug)]
pub enum Outbound {
    Message(Message),
    Rejection {
        id: Option<RequestId>,
        code: ErrorCode,
        message: String,
    },
}

/// Write `outbound` as a frame and flush.
///
/// # Errors
/// The error of the underlying writer.
pub fn write_outbound(output: &mut impl Write, outbound: &Outbound) -> io::Result<()> {
    match outbound {
        Outbound::Message(message) => write_message(output, message),
        Outbound::Rejection { id, code, message } => {
            write_rejection(output, id.as_ref(), *code, message)
        }
    }
}

/// Write `message` as a frame and flush.
///
/// # Errors
/// The error of the underlying writer.
pub fn write_message(output: &mut impl Write, message: &Message) -> io::Result<()> {
    message.write(output)
}

/// Write the JSON-RPC error reply to a payload that was not a message. Without a usable id the
/// reply has `"id": null`, which `lsp-server`'s [`Response`] cannot express.
///
/// # Errors
/// The error of the underlying writer.
pub fn write_rejection(
    output: &mut impl Write,
    id: Option<&RequestId>,
    code: ErrorCode,
    message: &str,
) -> io::Result<()> {
    let code = code as i32;
    match id {
        Some(id) => write_message(
            output,
            &Message::Response(Response::new_err(id.clone(), code, message.to_owned())),
        ),
        None => {
            let body = json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": code, "message": message },
            })
            .to_string();
            write!(output, "Content-Length: {}\r\n\r\n{body}", body.len())?;
            output.flush()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    fn frame(body: &str) -> Vec<u8> {
        format!("Content-Length: {}\r\n\r\n{body}", body.len()).into_bytes()
    }

    fn read(bytes: &[u8]) -> Result<Option<Vec<u8>>, FrameError> {
        read_frame(&mut Cursor::new(bytes.to_vec()))
    }

    #[test]
    fn a_frame_is_read_exactly_and_the_next_one_follows() {
        let mut bytes = frame(r#"{"a":1}"#);
        bytes.extend(frame("{}"));
        let mut input = Cursor::new(bytes);
        assert_eq!(read_frame(&mut input), Ok(Some(br#"{"a":1}"#.to_vec())));
        assert_eq!(read_frame(&mut input), Ok(Some(b"{}".to_vec())));
        assert_eq!(read_frame(&mut input), Ok(None));
    }

    #[test]
    fn header_forms_clients_send_are_accepted() {
        // Other headers, any case, no space after the colon, a bare line feed, a charset type.
        let body = "{}";
        let text = format!(
            "content-length:{}\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{body}",
            body.len()
        );
        assert_eq!(read(text.as_bytes()), Ok(Some(b"{}".to_vec())));
    }

    #[test]
    fn a_body_with_multibyte_text_is_counted_in_bytes() {
        let body = r#"{"t":"é😀"}"#;
        assert_eq!(read(&frame(body)), Ok(Some(body.as_bytes().to_vec())));
    }

    #[test]
    fn damaged_framing_is_an_error_not_a_panic() {
        assert_eq!(read(b""), Ok(None));
        assert_eq!(read(b"\r\n{}"), Err(FrameError::NoLength));
        assert_eq!(read(b"Content-Length: 5\r\n"), Err(FrameError::Truncated));
        assert_eq!(
            read(b"Content-Length: 5\r\n\r\nab"),
            Err(FrameError::Truncated)
        );
        assert_eq!(read(b"Content-Len"), Err(FrameError::Truncated));
        assert!(matches!(
            read(b"garbage\r\n\r\n"),
            Err(FrameError::BadHeader(_))
        ));
        assert!(matches!(
            read(b"Content-Length: abc\r\n\r\n"),
            Err(FrameError::BadLength(_))
        ));
        assert!(matches!(
            read(b"Content-Length: -1\r\n\r\n"),
            Err(FrameError::BadLength(_))
        ));
        assert_eq!(
            read(b"Content-Length: 99999999999\r\n\r\n"),
            Err(FrameError::TooLarge(99_999_999_999))
        );
        assert!(matches!(
            read(&vec![b'x'; MAX_HEADER_LINE + 10]),
            Err(FrameError::BadHeader(_))
        ));
        let many = "X: 1\r\n".repeat(MAX_HEADER_LINES + 5);
        assert!(matches!(
            read(many.as_bytes()),
            Err(FrameError::BadHeader(_))
        ));
        assert!(matches!(
            read(b"\xff\xfe: 1\r\n\r\n"),
            Err(FrameError::BadHeader(_))
        ));
    }

    fn body(text: &str) -> Inbound {
        parse_body(text.as_bytes())
    }

    #[test]
    fn requests_notifications_and_responses_are_told_apart() {
        assert!(matches!(
            body(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#),
            Inbound::Request(r) if r.method == "initialize" && r.id == RequestId::from(1)
        ));
        assert!(matches!(
            body(r#"{"jsonrpc":"2.0","id":"a","method":"shutdown"}"#),
            Inbound::Request(r) if r.id == RequestId::from("a".to_owned())
        ));
        assert!(matches!(
            body(r#"{"jsonrpc":"2.0","method":"exit"}"#),
            Inbound::Notification(n) if n.method == "exit"
        ));
        // Replies to the server's own requests, including a null result.
        assert!(matches!(
            body(r#"{"jsonrpc":"2.0","id":7,"result":null}"#),
            Inbound::Response
        ));
        assert!(matches!(
            body(r#"{"jsonrpc":"2.0","id":7,"error":{"code":-1,"message":"no"}}"#),
            Inbound::Response
        ));
    }

    #[test]
    fn payloads_that_are_not_messages_are_rejected_with_the_right_error() {
        let reject = |text: &str| match body(text) {
            Inbound::Rejected { id, code, .. } => (id, code as i32),
            other => panic!("{text}: {other:?}"),
        };
        assert_eq!(reject("not json"), (None, -32700));
        assert_eq!(reject(""), (None, -32700));
        assert_eq!(reject("[]"), (None, -32600));
        assert_eq!(reject("3"), (None, -32600));
        assert_eq!(reject("{}"), (None, -32600));
        assert_eq!(reject(r#"{"id":4}"#), (Some(RequestId::from(4)), -32600));
        assert_eq!(
            reject(r#"{"id":4,"method":5}"#),
            (Some(RequestId::from(4)), -32600)
        );
        assert_eq!(reject(r#"{"method":{}}"#), (None, -32600));
        assert_eq!(
            reject(r#"{"id":1.5,"method":"x"}"#),
            (None, -32600),
            "an id that is neither an integer nor a string"
        );
        assert_eq!(
            reject(r#"{"id":null,"method":"x"}"#),
            (None, -32600),
            "a request with a null id"
        );
    }

    #[test]
    fn pump_stops_after_exit_at_the_end_and_at_damage() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let mut bytes = frame(r#"{"method":"a"}"#);
        bytes.extend(frame("oops"));
        bytes.extend(frame(r#"{"method":"exit"}"#));
        bytes.extend(frame(r#"{"method":"never"}"#));
        pump(Cursor::new(bytes), &sender);
        let all: Vec<Inbound> = receiver.try_iter().collect();
        assert_eq!(all.len(), 3);
        assert!(matches!(&all[0], Inbound::Notification(n) if n.method == "a"));
        assert!(matches!(&all[1], Inbound::Rejected { .. }));
        assert!(matches!(&all[2], Inbound::Notification(n) if n.method == "exit"));

        let (sender, receiver) = std::sync::mpsc::channel();
        pump(
            Cursor::new(b"Content-Length: 3\r\n\r\nab".to_vec()),
            &sender,
        );
        assert!(matches!(
            receiver.try_iter().last(),
            Some(Inbound::Closed { reason: Some(_) })
        ));
        let (sender, receiver) = std::sync::mpsc::channel();
        pump(Cursor::new(Vec::new()), &sender);
        assert!(matches!(
            receiver.try_iter().last(),
            Some(Inbound::Closed { reason: None })
        ));
    }

    #[test]
    fn rejections_use_the_id_when_there_is_one_and_null_otherwise() {
        let mut out = Vec::new();
        write_rejection(&mut out, None, ErrorCode::ParseError, "bad").unwrap();
        let text = String::from_utf8(out).unwrap();
        let (header, json) = text.split_once("\r\n\r\n").unwrap();
        assert_eq!(header, format!("Content-Length: {}", json.len()));
        let value: Value = serde_json::from_str(json).unwrap();
        assert_eq!(value["id"], Value::Null);
        assert_eq!(value["error"]["code"], -32700);
        assert_eq!(value["jsonrpc"], "2.0");

        let mut out = Vec::new();
        write_rejection(
            &mut out,
            Some(&RequestId::from(9)),
            ErrorCode::InvalidRequest,
            "no",
        )
        .unwrap();
        let text = String::from_utf8(out).unwrap();
        let (_, json) = text.split_once("\r\n\r\n").unwrap();
        let value: Value = serde_json::from_str(json).unwrap();
        assert_eq!(value["id"], 9);
        assert_eq!(value["error"]["code"], -32600);
    }
}
