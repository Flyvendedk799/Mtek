//! Integration tests of `mtek dev` (`spec/tooling.md` section 4, `spec/runtime-abi.md` section
//! 11.1; decision 0033): the real binary serves a project in a temporary directory, and the
//! tests speak HTTP and Server-Sent Events over `std::net::TcpStream` (no HTTP client crate).
//!
//! Every wait has a deadline, and the server process is killed when a test ends, passes or
//! fails ([`DevServer`]'s `Drop`). Tests that need a successful build are
//! `#[cfg(mtek_runtime_embedded)]`; the others run in both configurations.

// Test-only code: helper functions outside `#[test]` functions may unwrap and panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;

const TOML: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";
const VALID: &str = "scene Demo {\n    camera Main {}\n    entity Cube { mesh: Box {}; }\n}\n";
/// One error: `E2003` at 3:25.
const INVALID: &str = "scene Demo {\n    camera Main {}\n    entity Cube { mesh: Boks {}; }\n}\n";

/// How long a build (or the server's start) may take before a test fails.
const PATIENCE: Duration = Duration::from_secs(60);

/// A fresh directory for one test, removed again on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("mtek-dev-it-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }

    fn write(&self, rel: &str, content: &[u8]) {
        let path = self.0.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn project(&self, main: &str) {
        self.write("mtek.toml", TOML.as_bytes());
        self.write("src/main.mtek", main.as_bytes());
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        // The server may still hold files for a moment after being killed (Windows).
        for _ in 0..20 {
            if fs::remove_dir_all(&self.0).is_ok() || !self.0.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

/// A port that was free a moment ago (the server moves to the next one if it was taken
/// meanwhile, and the tests read the port it announces).
fn free_port() -> u16 {
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// A running `mtek dev`, killed on drop.
struct DevServer {
    child: Child,
    port: u16,
    lines: Receiver<String>,
    /// Everything the server printed on stderr so far (for failure messages).
    stderr: Arc<Mutex<String>>,
}

impl DevServer {
    fn start(project: &Path) -> DevServer {
        let mut child = Command::new(env!("CARGO_BIN_EXE_mtek"))
            .args(["dev", "--port", &free_port().to_string()])
            .arg(project)
            .env_remove("NO_COLOR")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let lines = forward_lines(child.stdout.take().unwrap());
        let stderr = Arc::new(Mutex::new(String::new()));
        let sink = Arc::clone(&stderr);
        let mut pipe = child.stderr.take().unwrap();
        std::thread::spawn(move || {
            let mut buffer = [0_u8; 4096];
            while let Ok(n @ 1..) = pipe.read(&mut buffer) {
                sink.lock()
                    .unwrap()
                    .push_str(&String::from_utf8_lossy(&buffer[..n]));
            }
        });
        let mut server = DevServer {
            child,
            port: 0,
            lines,
            stderr,
        };
        let line = server.wait_line(|line| line.starts_with("mtek dev: serving "));
        let url = line
            .strip_prefix("mtek dev: serving http://127.0.0.1:")
            .unwrap_or_else(|| panic!("not a loopback URL: {line}"));
        server.port = url.split('/').next().unwrap().parse().unwrap();
        assert_eq!(
            line,
            format!(
                "mtek dev: serving http://127.0.0.1:{}/ (Ctrl+C to stop)",
                server.port
            )
        );
        server
    }

    /// The next stdout line that satisfies `wanted` (earlier ones are skipped).
    fn wait_line(&mut self, wanted: impl Fn(&str) -> bool) -> String {
        let deadline = Instant::now() + PATIENCE;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.lines.recv_timeout(left) {
                Ok(line) if wanted(&line) => return line,
                Ok(_) => {}
                Err(error) => panic!(
                    "no expected line from mtek dev ({error:?}); stderr:\n{}",
                    self.stderr.lock().unwrap()
                ),
            }
        }
    }

    /// The first build's line, after which nothing more is printed for a while.
    fn wait_first_build(&mut self) -> String {
        let line =
            self.wait_line(|line| line.starts_with("built ") || line.starts_with("build failed"));
        match self.lines.recv_timeout(Duration::from_millis(500)) {
            Err(RecvTimeoutError::Timeout) => line,
            other => panic!("unexpected output after the first build: {other:?}"),
        }
    }

    fn get(&self, path: &str) -> Response {
        request(self.port, "GET", path)
    }

    fn events(&self) -> EventStream {
        EventStream::open(self.port)
    }
}

impl Drop for DevServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn forward_lines(stdout: ChildStdout) -> Receiver<String> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { return };
            if sender.send(line).is_err() {
                return;
            }
        }
    });
    receiver
}

/// An HTTP response.
#[derive(Debug)]
struct Response {
    status: u16,
    /// Header names in lower case.
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

impl Response {
    fn header(&self, name: &str) -> &str {
        self.headers.get(name).map_or("", String::as_str)
    }

    fn text(&self) -> String {
        String::from_utf8(self.body.clone()).unwrap()
    }
}

fn connect(port: u16) -> TcpStream {
    let stream = TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        Duration::from_secs(10),
    )
    .unwrap();
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .unwrap();
    stream
}

/// The position just after the first `\r\n\r\n` of `bytes`.
fn header_end(bytes: &[u8]) -> Option<usize> {
    bytes
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|at| at + 4)
}

/// Status line and headers of a response head.
fn parse_head(head: &[u8]) -> (u16, BTreeMap<String, String>) {
    let head = String::from_utf8(head.to_vec()).unwrap();
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap();
    assert!(status_line.starts_with("HTTP/1.1 "), "{status_line}");
    let status = status_line[9..12].parse().unwrap();
    let headers = lines
        .filter(|line| !line.is_empty())
        .map(|line| {
            let (name, value) = line.split_once(':').unwrap();
            (name.trim().to_ascii_lowercase(), value.trim().to_owned())
        })
        .collect();
    (status, headers)
}

/// Read from `stream` into `buffer` until `done(buffer)` or the deadline.
fn read_until(
    stream: &mut TcpStream,
    buffer: &mut Vec<u8>,
    deadline: Instant,
    done: impl Fn(&[u8]) -> bool,
) -> bool {
    let mut chunk = [0_u8; 8192];
    while !done(buffer) {
        if Instant::now() > deadline {
            return false;
        }
        match stream.read(&mut chunk) {
            Ok(0) => return done(buffer),
            Ok(n) => buffer.extend_from_slice(&chunk[..n]),
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => panic!("reading the response: {error}"),
        }
    }
    true
}

/// One request with `Connection: close`; the body is read to the end of the connection.
fn request(port: u16, method: &str, path: &str) -> Response {
    let mut stream = connect(port);
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    )
    .unwrap();
    let mut bytes = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(20);
    let complete = |bytes: &[u8]| {
        let Some(end) = header_end(bytes) else {
            return false;
        };
        let (_, headers) = parse_head(&bytes[..end]);
        // A response to HEAD announces the length of a body it does not have.
        let length: usize = match headers.get("content-length") {
            Some(length) if method != "HEAD" => length.parse().unwrap(),
            _ => 0,
        };
        bytes.len() >= end + length
    };
    assert!(
        read_until(&mut stream, &mut bytes, deadline, complete),
        "incomplete response to {path}"
    );
    let end = header_end(&bytes).unwrap();
    let (status, headers) = parse_head(&bytes[..end]);
    assert_ne!(
        headers.get("transfer-encoding").map(String::as_str),
        Some("chunked")
    );
    Response {
        status,
        headers,
        body: bytes[end..].to_vec(),
    }
}

/// A connection to `/__mtek/events`.
struct EventStream {
    stream: TcpStream,
    headers: BTreeMap<String, String>,
    /// Raw bytes after the response head (chunked transfer encoding).
    raw: Vec<u8>,
    /// The decoded body not yet split into events.
    body: Vec<u8>,
}

impl EventStream {
    fn open(port: u16) -> EventStream {
        let mut stream = connect(port);
        write!(
            stream,
            "GET /__mtek/events HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: text/event-stream\r\n\r\n"
        )
        .unwrap();
        let mut bytes = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(20);
        assert!(read_until(&mut stream, &mut bytes, deadline, |b| {
            header_end(b).is_some()
        }));
        let end = header_end(&bytes).unwrap();
        let (status, headers) = parse_head(&bytes[..end]);
        assert_eq!(status, 200);
        assert_eq!(
            headers.get("transfer-encoding").map(String::as_str),
            Some("chunked")
        );
        EventStream {
            stream,
            headers,
            raw: bytes[end..].to_vec(),
            body: Vec::new(),
        }
    }

    /// Move complete chunks from `raw` to `body`; `false` once the final chunk arrived.
    fn decode(&mut self) -> bool {
        loop {
            let Some(line_end) = self.raw.windows(2).position(|w| w == b"\r\n") else {
                return true;
            };
            let size_text = String::from_utf8(self.raw[..line_end].to_vec()).unwrap();
            let size =
                usize::from_str_radix(size_text.split(';').next().unwrap().trim(), 16).unwrap();
            if size == 0 {
                return false;
            }
            let start = line_end + 2;
            if self.raw.len() < start + size + 2 {
                return true;
            }
            self.body.extend_from_slice(&self.raw[start..start + size]);
            assert_eq!(&self.raw[start + size..start + size + 2], b"\r\n");
            self.raw.drain(..start + size + 2);
        }
    }

    /// The next event's JSON, or `None` if none arrives within `wait` (or the stream ended).
    fn next_within(&mut self, wait: Duration) -> Option<Value> {
        let deadline = Instant::now() + wait;
        let mut chunk = [0_u8; 8192];
        loop {
            let open = self.decode();
            if let Some(at) = self.body.windows(2).position(|w| w == b"\n\n") {
                let frame = String::from_utf8(self.body[..at].to_vec()).unwrap();
                self.body.drain(..at + 2);
                let data: Vec<&str> = frame
                    .lines()
                    .filter(|line| !line.starts_with(':'))
                    .collect();
                if data.is_empty() {
                    continue; // a comment
                }
                assert_eq!(
                    data.len(),
                    1,
                    "one data line per event, no event: line: {frame:?}"
                );
                let json = data[0]
                    .strip_prefix("data: ")
                    .unwrap_or_else(|| panic!("not a data line: {frame:?}"));
                return Some(serde_json::from_str(json).unwrap());
            }
            if !open || Instant::now() > deadline {
                return None;
            }
            match self.stream.read(&mut chunk) {
                Ok(0) => return None,
                Ok(n) => self.raw.extend_from_slice(&chunk[..n]),
                Err(error)
                    if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                Err(_) => return None,
            }
        }
    }

    fn next(&mut self) -> Value {
        self.next_within(PATIENCE)
            .unwrap_or_else(|| panic!("no event within {PATIENCE:?}"))
    }

    /// The next event, which must be of type `kind`.
    fn expect(&mut self, kind: &str) -> Value {
        let event = self.next();
        assert_eq!(event["type"], kind, "{event:#}");
        event
    }

    fn assert_quiet(&mut self, wait: Duration) {
        if let Some(event) = self.next_within(wait) {
            panic!("unexpected event: {event:#}");
        }
    }
}

/// The code of every diagnostic of a `build-failed` event.
fn codes(event: &Value) -> Vec<String> {
    event["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["code"].as_str().unwrap().to_owned())
        .collect()
}

/// A local IPv4 address that is not loopback, if the machine has one.
fn outside_address() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    // Connecting a UDP socket sends nothing; it only picks the interface for the route.
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

#[test]
fn files_are_served_with_their_types_and_never_cached() {
    let scratch = Scratch::new("serve");
    // The build fails (in both configurations), so replace-on-success keeps this `dist/`.
    scratch.project(INVALID);
    scratch.write("dist/index.html", b"<!doctype html><title>kept</title>");
    scratch.write("dist/app.js", b"export default {};\n");
    scratch.write("dist/program.manifest.json", b"{}");
    scratch.write("dist/shaders/0123456789abcdef.wgsl", b"// wgsl\n");
    scratch.write("dist/module.wasm", b"\0asm");
    let mut server = DevServer::start(&scratch.0);
    assert!(server.wait_first_build().starts_with("build failed: "));

    let expected = [
        ("/", 200, "text/html; charset=utf-8"),
        ("/index.html", 200, "text/html; charset=utf-8"),
        ("/app.js?build=0123", 200, "text/javascript"),
        ("/program.manifest.json", 200, "application/json"),
        ("/shaders/0123456789abcdef.wgsl", 200, "text/plain"),
        ("/module.wasm", 200, "application/wasm"),
        ("/missing.js", 404, "text/plain"),
        ("/../mtek.toml", 404, "text/plain"),
        ("/%2e%2e/mtek.toml", 404, "text/plain"),
        ("/shaders/../../mtek.toml", 404, "text/plain"),
    ];
    for (path, status, content_type) in expected {
        let response = server.get(path);
        assert_eq!(response.status, status, "{path}");
        assert_eq!(response.header("content-type"), content_type, "{path}");
        assert_eq!(response.header("cache-control"), "no-store", "{path}");
    }
    assert_eq!(server.get("/").text(), "<!doctype html><title>kept</title>");
    assert_eq!(server.get("/module.wasm").body, b"\0asm");
    let head = request(server.port, "HEAD", "/app.js");
    assert_eq!(
        (head.status, head.header("content-type")),
        (200, "text/javascript")
    );
    let post = request(server.port, "POST", "/app.js");
    assert_eq!((post.status, post.header("allow")), (405, "GET, HEAD"));

    // The event stream: no caching either, and a client that connects after a failed build
    // receives that failure first.
    let mut events = server.events();
    assert_eq!(events.headers["content-type"], "text/event-stream");
    assert_eq!(events.headers["cache-control"], "no-store");
    let failed = events.expect("build-failed");
    assert!(
        codes(&failed).contains(&"MTEK-E2003".to_owned()),
        "{failed:#}"
    );

    // Loopback only: the same port on the machine's own network address is closed.
    if let Some(ip) = outside_address() {
        let outside = TcpStream::connect_timeout(
            &SocketAddr::from((ip, server.port)),
            Duration::from_secs(2),
        );
        assert!(outside.is_err(), "reachable on {ip}:{}", server.port);
        eprintln!("not reachable on {ip}:{} (only on 127.0.0.1)", server.port);
    }
}

#[test]
fn before_any_successful_build_the_page_waits_with_the_reload_client() {
    let scratch = Scratch::new("waiting");
    scratch.project(INVALID);
    let mut server = DevServer::start(&scratch.0);
    assert!(server.wait_first_build().starts_with("build failed: "));
    let page = server.get("/");
    assert_eq!(page.status, 200);
    assert_eq!(page.header("content-type"), "text/html; charset=utf-8");
    let text = page.text();
    assert!(text.contains("<title>demo</title>"), "{text}");
    assert!(
        text.contains("new EventSource(\"/__mtek/events\")"),
        "{text}"
    );
    assert!(text.contains("mtek-dev-overlay"), "{text}");
    assert!(!text.contains("app.js"), "{text}");
    assert!(!scratch.0.join("dist").exists());
}

#[cfg(not(mtek_runtime_embedded))]
#[test]
fn without_the_runtime_every_build_fails_with_e9030() {
    let scratch = Scratch::new("no-runtime");
    scratch.project(VALID);
    let mut server = DevServer::start(&scratch.0);
    assert!(
        server
            .wait_first_build()
            .starts_with("build failed: 1 error")
    );
    let mut events = server.events();
    assert_eq!(codes(&events.expect("build-failed")), ["MTEK-E9030"]);
    scratch.write("src/main.mtek", INVALID.as_bytes());
    events.expect("build-started");
    let failed = events.expect("build-failed");
    assert!(
        codes(&failed).contains(&"MTEK-E9030".to_owned()),
        "{failed:#}"
    );
    assert!(
        codes(&failed).contains(&"MTEK-E2003".to_owned()),
        "{failed:#}"
    );
    server.wait_line(|line| line.starts_with("build failed: 2 errors"));
    events.assert_quiet(Duration::from_millis(800));
}

/// The `buildId` of the manifest being served.
#[cfg(mtek_runtime_embedded)]
fn served_build_id(server: &DevServer) -> String {
    let manifest: Value =
        serde_json::from_slice(&server.get("/program.manifest.json").body).unwrap();
    manifest["buildId"].as_str().unwrap().to_owned()
}

#[cfg(mtek_runtime_embedded)]
#[test]
fn edits_rebuild_and_publish_success_and_failure() {
    let scratch = Scratch::new("cycle");
    scratch.project(VALID);
    let mut server = DevServer::start(&scratch.0);
    let first = server.wait_first_build();
    assert!(
        first.starts_with("built 'demo' (dev): 9 files in dist, build "),
        "{first}"
    );
    assert!(first.ends_with(" ms)"), "{first}");
    let initial = served_build_id(&server);

    // The page is the compiler's dev page: it mounts the program and carries the client.
    let page = server.get("/");
    assert_eq!(page.header("content-type"), "text/html; charset=utf-8");
    assert!(
        page.text()
            .contains("import program, { mountMtek } from \"./app.js\";")
    );
    assert!(page.text().contains("new EventSource(\"/__mtek/events\")"));

    let mut events = server.events();
    events.assert_quiet(Duration::from_millis(300));

    // A successful edit.
    scratch.write("src/main.mtek", VALID.replace("Box", "Sphere").as_bytes());
    events.expect("build-started");
    let succeeded = events.expect("build-succeeded");
    let build_id = succeeded["buildId"].as_str().unwrap().to_owned();
    assert_eq!(build_id.len(), 64);
    assert!(build_id.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
    assert_ne!(build_id, initial);
    assert_eq!(succeeded["program"], format!("/app.js?build={build_id}"));
    assert_eq!(succeeded.as_object().unwrap().len(), 3, "{succeeded:#}");
    let line = server.wait_line(|line| line.starts_with("built "));
    assert!(
        line.contains(&format!("build {}", &build_id[..16])),
        "{line}"
    );
    // The new build is what is served now, at the URL of the event.
    assert_eq!(served_build_id(&server), build_id);
    let program = server.get(succeeded["program"].as_str().unwrap());
    assert_eq!(
        (program.status, program.header("content-type")),
        (200, "text/javascript")
    );
    assert_eq!(program.header("cache-control"), "no-store");

    // An edit with an error: the diagnostics arrive, the last good build stays served.
    scratch.write("src/main.mtek", INVALID.as_bytes());
    events.expect("build-started");
    let failed = events.expect("build-failed");
    assert_eq!(codes(&failed), ["MTEK-E2003"]);
    let diagnostic = &failed["diagnostics"][0];
    assert_eq!(diagnostic["source"]["file"], "src/main.mtek");
    assert_eq!(
        (
            diagnostic["source"]["startLine"].as_u64(),
            diagnostic["source"]["startColumn"].as_u64()
        ),
        (Some(3), Some(25))
    );
    assert_eq!(diagnostic["severity"], "error");
    server.wait_line(|line| line.starts_with("build failed: 1 error, 0 warnings ("));
    assert_eq!(served_build_id(&server), build_id);
    // A page opened now learns about the failure at once.
    assert_eq!(
        codes(&server.events().expect("build-failed")),
        ["MTEK-E2003"]
    );

    // Fixed again.
    scratch.write("src/main.mtek", VALID.as_bytes());
    events.expect("build-started");
    assert_eq!(
        events.expect("build-succeeded")["buildId"],
        initial.as_str()
    );
    // The build's own writes to dist/ never trigger another build.
    events.assert_quiet(Duration::from_secs(1));
}

#[cfg(mtek_runtime_embedded)]
#[test]
fn a_burst_of_edits_settles_on_the_last_one_without_overlapping_builds() {
    let scratch = Scratch::new("burst");
    scratch.project(VALID);
    let mut server = DevServer::start(&scratch.0);
    server.wait_first_build();
    let mut events = server.events();
    for mesh in ["Sphere", "Boks", "Plane", "Sphere"] {
        scratch.write("src/main.mtek", VALID.replace("Box", mesh).as_bytes());
    }
    // Builds strictly alternate started → finished; the last one builds the last edit.
    let mut next = events.next();
    let last = loop {
        assert_eq!(next["type"], "build-started", "{next:#}");
        let finished = events.next();
        assert!(
            matches!(
                finished["type"].as_str(),
                Some("build-succeeded" | "build-failed")
            ),
            "{finished:#}"
        );
        match events.next_within(Duration::from_millis(800)) {
            Some(event) => next = event,
            None => break finished,
        }
    };
    assert_eq!(last["type"], "build-succeeded", "{last:#}");
    assert_eq!(served_build_id(&server), last["buildId"].as_str().unwrap());
    // It is the build of the final text: `mtek build` of the same sources has the same id.
    let check =
        std::env::temp_dir().join(format!("mtek-dev-it-{}-burst-check", std::process::id()));
    let status = Command::new(env!("CARGO_BIN_EXE_mtek"))
        .args(["build", "--mode", "dev", "--out"])
        .arg(&check)
        .arg(&scratch.0)
        .output()
        .unwrap();
    assert!(status.status.success(), "{status:?}");
    let manifest: Value =
        serde_json::from_slice(&fs::read(check.join("program.manifest.json")).unwrap()).unwrap();
    let _ = fs::remove_dir_all(&check);
    assert_eq!(manifest["buildId"], last["buildId"]);
}

/// Ctrl+C (SIGINT) stops the server gracefully: open event streams end, the process says so
/// and exits with 0. (Windows has no way to send a console Ctrl+C to a child from safe Rust.)
#[cfg(unix)]
#[test]
fn ctrl_c_stops_the_server_gracefully() {
    let scratch = Scratch::new("ctrl-c");
    scratch.project(INVALID);
    let mut server = DevServer::start(&scratch.0);
    server.wait_first_build();
    let mut events = server.events();
    events.expect("build-failed");
    let status = Command::new("kill")
        .args(["-INT", &server.child.id().to_string()])
        .status()
        .unwrap();
    assert!(status.success());
    server.wait_line(|line| line == "mtek dev: stopping");
    server.wait_line(|line| line == "mtek dev: stopped");
    assert_eq!(
        events.next_within(Duration::from_secs(10)),
        None,
        "the stream ended"
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    let exit = loop {
        if let Some(exit) = server.child.try_wait().unwrap() {
            break exit;
        }
        assert!(Instant::now() < deadline, "still running");
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(exit.code(), Some(0));
    assert!(
        TcpStream::connect((Ipv4Addr::LOCALHOST, server.port)).is_err(),
        "the port is closed"
    );
}
