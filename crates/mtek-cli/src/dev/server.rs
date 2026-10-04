//! The HTTP side of `mtek dev` (`spec/tooling.md` section 4): the output directory as static
//! files and the `/__mtek/events` Server-Sent Events stream, on `127.0.0.1` only.
//!
//! Every response carries `Cache-Control: no-store` (a reload must never see an old build) and
//! `X-Content-Type-Options: nosniff`. A request names a file by plain segments — ASCII letters,
//! digits, `.`, `_`, `-`, not starting with `.`, no Windows device name — which covers every
//! name a build writes; anything else is `404`, so no request reaches outside the output
//! directory. `/` is `index.html`; while there is none (before the first successful build) it
//! is the compiler's waiting page ([`dev_waiting_page`]).

use std::convert::Infallible;
use std::io;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, PoisonError, RwLock};

use axum::Router;
use axum::extract::State;
use axum::http::header::{ALLOW, CACHE_CONTROL, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS};
use axum::http::{Method, StatusCode, Uri};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use mtek_compiler::package::html::dev_waiting_page;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio_stream::StreamExt as _;
use tokio_stream::wrappers::{BroadcastStream, WatchStream};

use super::hub::Hub;

/// The path of the event stream (`spec/runtime-abi.md` section 11.1).
pub const EVENTS_PATH: &str = "/__mtek/events";

/// How many ports from the requested one are tried before giving up.
pub const PORT_ATTEMPTS: u16 = 20;

/// What the handlers share.
#[derive(Debug)]
pub struct App {
    /// The build events.
    pub hub: Hub,
    /// The output directory being served (absolute); it follows `build.out_dir`.
    pub out_dir: RwLock<PathBuf>,
    /// The `<title>` of the waiting page.
    pub title: String,
    /// Becomes `true` when the server shuts down; open event streams end then.
    pub shutdown: watch::Receiver<bool>,
}

impl App {
    fn out_dir(&self) -> PathBuf {
        self.out_dir
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

/// The routes of the development server.
pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route(EVENTS_PATH, get(events))
        .fallback(serve_file)
        .with_state(app)
}

/// Bind `127.0.0.1:<port>`, or the first free one of the next [`PORT_ATTEMPTS`] − 1 ports.
///
/// # Errors
/// The error of the last attempt when no port could be bound.
pub async fn bind(port: u16) -> io::Result<TcpListener> {
    let mut last = io::Error::new(io::ErrorKind::AddrInUse, "no port to try");
    for candidate in (port..=u16::MAX).take(usize::from(PORT_ATTEMPTS)) {
        match TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, candidate))).await {
            Ok(listener) => return Ok(listener),
            Err(error) => last = error,
        }
    }
    Err(last)
}

/// The MIME type of a served file, by extension (`spec/tooling.md` section 4 names `.js`,
/// `.wasm` and `.wgsl`).
pub fn content_type(name: &str) -> &'static str {
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "json" | "map" => "application/json",
        "wgsl" | "ts" | "txt" => "text/plain",
        "wasm" => "application/wasm",
        "css" => "text/css",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "ktx2" => "image/ktx2",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        _ => "application/octet-stream",
    }
}

/// The file a request path names, relative to the output directory, or `None` if the path
/// is not one a build can produce (see the module documentation).
pub fn requested_file(path: &str) -> Option<String> {
    let rest = path.strip_prefix('/')?;
    if rest.is_empty() {
        return Some("index.html".to_owned());
    }
    rest.split('/').all(plain_segment).then(|| rest.to_owned())
}

/// Whether `segment` is a plain file or directory name.
fn plain_segment(segment: &str) -> bool {
    const DEVICES: [&str; 4] = ["con", "prn", "aux", "nul"];
    let allowed = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-');
    let stem = segment
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let device = DEVICES.contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.ends_with(|c: char| c.is_ascii_digit()));
    !segment.is_empty() && !segment.starts_with('.') && segment.chars().all(allowed) && !device
}

/// A response with the headers every response carries.
fn respond(status: StatusCode, content_type: &'static str, body: Vec<u8>) -> Response {
    (
        status,
        [
            (CONTENT_TYPE, content_type),
            (CACHE_CONTROL, "no-store"),
            (X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        body,
    )
        .into_response()
}

/// `GET`/`HEAD` of a file of the output directory.
async fn serve_file(State(app): State<Arc<App>>, method: Method, uri: Uri) -> Response {
    if method != Method::GET && method != Method::HEAD {
        let mut response = respond(
            StatusCode::METHOD_NOT_ALLOWED,
            "text/plain",
            b"method not allowed\n".to_vec(),
        );
        response
            .headers_mut()
            .insert(ALLOW, axum::http::HeaderValue::from_static("GET, HEAD"));
        return response;
    }
    let not_found = || {
        respond(
            StatusCode::NOT_FOUND,
            "text/plain",
            format!("not found: {}\n", uri.path()).into_bytes(),
        )
    };
    let Some(name) = requested_file(uri.path()) else {
        return not_found();
    };
    let path = name
        .split('/')
        .fold(app.out_dir(), |path, segment| path.join(segment));
    match tokio::fs::read(&path).await {
        Ok(bytes) => respond(StatusCode::OK, content_type(&name), bytes),
        Err(_) if name == "index.html" => respond(
            StatusCode::OK,
            content_type(&name),
            dev_waiting_page(&app.title).into_bytes(),
        ),
        Err(_) => not_found(),
    }
}

/// `/__mtek/events`: the replayed failure (if any), then every build event as one
/// `data: <JSON>` frame, until the server shuts down.
async fn events(State(app): State<Arc<App>>) -> Response {
    let mut shutdown = app.shutdown.clone();
    if *shutdown.borrow_and_update() {
        return respond(
            StatusCode::SERVICE_UNAVAILABLE,
            "text/plain",
            b"shutting down\n".to_vec(),
        );
    }
    let (replay, receiver) = app.hub.subscribe();
    let first = tokio_stream::iter(replay.into_iter().map(Some));
    // A client that fell behind skips what it missed (`Lagged`); the next event still comes.
    let live = BroadcastStream::new(receiver).filter_map(|item| item.ok().map(Some));
    let stop = WatchStream::from_changes(shutdown).map(|_| None);
    let stream = first
        .chain(live)
        .merge(stop)
        .take_while(Option::is_some)
        .filter_map(|item| item)
        .map(|data| Ok::<Event, Infallible>(Event::default().data(&*data)));
    (
        [
            (CACHE_CONTROL, "no-store"),
            (X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Sse::new(stream),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_types_follow_the_specification() {
        assert_eq!(content_type("app.js"), "text/javascript");
        assert_eq!(
            content_type("runtime.0123456789abcdef.js"),
            "text/javascript"
        );
        assert_eq!(content_type("x.wasm"), "application/wasm");
        assert_eq!(content_type("shaders/ab.wgsl"), "text/plain");
        assert_eq!(content_type("index.html"), "text/html; charset=utf-8");
        assert_eq!(content_type("INDEX.HTML"), "text/html; charset=utf-8");
        assert_eq!(content_type("program.manifest.json"), "application/json");
        assert_eq!(content_type("app.js.map"), "application/json");
        assert_eq!(content_type("shaders/ab.mtek-map.json"), "application/json");
        assert_eq!(content_type("app.d.ts"), "text/plain");
        assert_eq!(content_type("model.glb"), "model/gltf-binary");
        assert_eq!(content_type("noextension"), "application/octet-stream");
    }

    #[test]
    fn requests_name_plain_files_inside_the_output_directory() {
        assert_eq!(requested_file("/").as_deref(), Some("index.html"));
        assert_eq!(requested_file("/app.js").as_deref(), Some("app.js"));
        assert_eq!(
            requested_file("/shaders/0123456789abcdef.wgsl").as_deref(),
            Some("shaders/0123456789abcdef.wgsl")
        );
        for bad in [
            "",
            "app.js",
            "/../secret",
            "/..",
            "/shaders/../../x",
            "/./app.js",
            "/.git/config",
            "/a//b",
            "/shaders/",
            "/a\\..\\b",
            "/C:/Windows/win.ini",
            "/%2e%2e/x",
            "/con",
            "/NUL.txt",
            "/shaders/com1.wgsl",
            "/lpt9",
            "/a b",
            "/caf\u{e9}.js",
        ] {
            assert_eq!(requested_file(bad), None, "{bad:?}");
        }
        assert!(
            requested_file("/console.js").is_some(),
            "only exact device stems"
        );
        assert!(requested_file("/com.js").is_some());
    }

    #[test]
    fn binding_skips_a_taken_port_and_stays_on_loopback() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let taken = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
            let port = taken.local_addr().unwrap().port();
            let Ok(listener) = bind(port).await else {
                // Every one of the next ports is taken by someone else: nothing to check.
                return;
            };
            let address = listener.local_addr().unwrap();
            assert_ne!(address.port(), port);
            assert!(address.port() > port && address.port() < port.saturating_add(PORT_ATTEMPTS));
            assert_eq!(address.ip(), Ipv4Addr::LOCALHOST);
        });
    }
}
