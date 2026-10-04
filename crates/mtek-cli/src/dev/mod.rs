//! `mtek dev` (`spec/tooling.md` section 4): build, serve, watch, rebuild.
//!
//! The development server serves the output directory on `127.0.0.1` (port `--port`, else
//! `dev.port` of `mtek.toml`, else 5173; a taken port moves to the next free one, and the
//! terminal says so), publishes build events on `/__mtek/events` ([`hub`], [`server`]), watches
//! the project ([`watch`]) and rebuilds in `BuildMode::Dev` with debounce and serialisation
//! ([`schedule`]). Every build is the one of `mtek build` (`commands::compile_and_write`,
//! replace-on-success) on the guarded compiler thread (`guard::run_guarded`), so a compiler
//! panic becomes an `E9999` build failure and the server keeps running. Ctrl+C stops it
//! gracefully: the running build finishes, the event streams end, the server closes; a second
//! Ctrl+C exits at once. The decisions behind the details are in decision 0033.

pub mod hub;
pub mod schedule;
pub mod server;
pub mod watch;

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, PoisonError};
use std::time::{Duration, Instant};

use mtek_compiler::BuildMode;
use mtek_compiler::diagnostics::{Diagnostics, RenderOptions, render_report, to_report};
use mtek_compiler::project::{DEFAULT_DEV_PORT, DEFAULT_OUT_DIR, PROJECT_FILE, parse_config};
use serde_json::Value;
use tokio::sync::{mpsc, watch as channel};

use crate::args::Format;
use crate::commands::{
    self, Context, EXIT_INTERNAL, EXIT_OK, Located, Written, built_line, counts, with_diagnostic,
    write_failed,
};
use crate::guard;
use crate::real_fs::RealFs;
use hub::{BuildEvent, Hub};
use server::App;
use watch::Scope;

/// How long the server may take to close its connections after Ctrl+C.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

/// Print a line on stdout. A closed stdout is not a reason to stop serving.
fn say(line: &str) {
    let _ = writeln!(std::io::stdout().lock(), "{line}");
}

/// Print text on stderr.
fn say_err(text: &str) {
    let _ = std::io::stderr().lock().write_all(text.as_bytes());
}

/// What `mtek.toml` says about the development server, as far as it can be read; the first
/// build reports any problem with it.
#[derive(Debug, PartialEq, Eq)]
struct Settings {
    port: u16,
    /// `build.out_dir`, relative to the project directory.
    out_dir: PathBuf,
    /// The project name, for the waiting page and the terminal.
    name: String,
}

impl Settings {
    fn read(dir: &Path) -> Settings {
        let config = std::fs::read_to_string(dir.join(PROJECT_FILE))
            .ok()
            .and_then(|text| parse_config(&text, &mut Diagnostics::new()));
        match config {
            Some(config) => Settings {
                port: config.dev.port,
                out_dir: config.build.out_dir.segments().collect(),
                name: config.project.name,
            },
            None => Settings {
                port: DEFAULT_DEV_PORT,
                out_dir: PathBuf::from(DEFAULT_OUT_DIR),
                name: String::new(),
            },
        }
    }
}

/// Run `mtek dev` until Ctrl+C; returns the exit code.
pub fn run(port: Option<u16>, open: bool, path: Option<&Path>, context: Context) -> u8 {
    let dir = match commands::locate_project(&context.cwd, path) {
        Ok(dir) => dir,
        Err(diagnostic) => {
            let outcome = commands::single("dev", Format::Human, context.color, *diagnostic);
            say_err(&outcome.stderr);
            return outcome.code;
        }
    };
    let settings = Settings::read(&dir);
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            say_err(&format!(
                "error: could not start the server runtime: {error}\n"
            ));
            return EXIT_INTERNAL;
        }
    };
    let port = port.unwrap_or(settings.port);
    runtime.block_on(serve(dir, settings, port, open, context))
}

/// The server, the watcher and the build loop.
async fn serve(dir: PathBuf, settings: Settings, port: u16, open: bool, context: Context) -> u8 {
    let listener = match server::bind(port).await {
        Ok(listener) => listener,
        Err(error) => {
            say_err(&format!(
                "error: could not listen on 127.0.0.1, ports {port} to {}: {error}\n",
                port.saturating_add(server::PORT_ATTEMPTS - 1)
            ));
            return EXIT_INTERNAL;
        }
    };
    let actual = match listener.local_addr() {
        Ok(address) => address.port(),
        Err(error) => {
            say_err(&format!(
                "error: the server socket has no address: {error}\n"
            ));
            return EXIT_INTERNAL;
        }
    };
    if actual != port {
        say(&format!(
            "mtek dev: port {port} is in use; using port {actual}"
        ));
    }
    let url = format!("http://127.0.0.1:{actual}/");

    let (stop, shutdown) = channel::channel(false);
    let title = if settings.name.is_empty() {
        "mtek dev".to_owned()
    } else {
        settings.name.clone()
    };
    let app = Arc::new(App {
        hub: Hub::default(),
        out_dir: std::sync::RwLock::new(dir.join(&settings.out_dir)),
        title,
        shutdown: shutdown.clone(),
    });
    let scope = Arc::new(Scope::new(&dir, settings.out_dir.clone()));
    let (changes, changed) = mpsc::unbounded_channel();
    let watcher = match watch::watch(Arc::clone(&scope), changes, |line| {
        say_err(&format!("{line}\n"));
    }) {
        Ok(watcher) => watcher,
        Err(error) => {
            say_err(&format!(
                "error: could not watch '{}': {error}\n",
                dir.display()
            ));
            return EXIT_INTERNAL;
        }
    };

    let server = axum::serve(listener, server::router(Arc::clone(&app)))
        .with_graceful_shutdown(schedule::stopped(shutdown.clone()));
    let server = tokio::spawn(async move { server.await });
    say(&format!("mtek dev: serving {url} (Ctrl+C to stop)"));
    tokio::spawn(stop_on_ctrl_c(stop));

    let mut open_after_build = open.then(|| url.clone());
    schedule::run(changed, shutdown, schedule::DEBOUNCE, || {
        let (app, scope, dir, context) = (
            Arc::clone(&app),
            Arc::clone(&scope),
            dir.clone(),
            context.clone(),
        );
        let open = open_after_build.take();
        async move {
            rebuild(&app, &scope, dir, context).await;
            if let Some(url) = open {
                open_browser(&url);
            }
        }
    })
    .await;

    drop(watcher);
    match tokio::time::timeout(SHUTDOWN_GRACE, server).await {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(error))) => say_err(&format!("warning: the server stopped with: {error}\n")),
        Ok(Err(error)) => say_err(&format!("warning: the server task failed: {error}\n")),
        Err(_) => say_err("warning: connections still open after 5 s were closed\n"),
    }
    say("mtek dev: stopped");
    EXIT_OK
}

/// The exit code after a second Ctrl+C (128 + SIGINT, as shells report an interrupted process).
const EXIT_INTERRUPTED: i32 = 130;

/// Signal shutdown on the first Ctrl+C; exit at once on the second.
async fn stop_on_ctrl_c(stop: channel::Sender<bool>) {
    if let Err(error) = tokio::signal::ctrl_c().await {
        say_err(&format!(
            "warning: Ctrl+C cannot be handled ({error}); stop the process another way\n"
        ));
        // Keep `stop` alive: dropping it would read as a shutdown.
        std::future::pending::<()>().await;
    }
    say("mtek dev: stopping");
    let _ = stop.send(true);
    if tokio::signal::ctrl_c().await.is_ok() {
        std::process::exit(EXIT_INTERRUPTED);
    }
}

/// One build: `build-started`, the guarded build, the terminal line, then `build-succeeded` or
/// `build-failed`.
async fn rebuild(app: &App, scope: &Scope, dir: PathBuf, context: Context) {
    app.hub.publish(&BuildEvent::Started);
    let started = Instant::now();
    let color = context.color;
    let project_dir = dir.clone();
    let job = tokio::task::spawn_blocking(move || {
        guard::run_guarded(move || {
            let fs = RealFs::new(&project_dir);
            let project = Located {
                dir: &project_dir,
                fs: &fs,
            };
            commands::compile_and_write(&context, &project, BuildMode::Dev, None)
        })
    })
    .await;
    let millis = started.elapsed().as_millis();
    let written = match job {
        Ok(Ok(written)) => written,
        Ok(Err(panic)) => failure_of_panic(&panic),
        Err(error) => failure_of_panic(&format!("the build task failed: {error}")),
    };
    if let Some(target) = &written.target {
        follow_out_dir(app, scope, &dir, target);
    }
    let (line, event) = conclude(written, color, millis);
    say(&line);
    app.hub.publish(&event);
}

/// The build result of a compiler panic (`E9999`).
fn failure_of_panic(note: &str) -> Written {
    let mut sink = Diagnostics::new();
    sink.push(commands::internal_diagnostic(note));
    Written {
        name: None,
        sources: mtek_compiler::source::SourceMap::new(),
        report: sink.finish(),
        written: None,
        shown: None,
        target: None,
        refused: None,
    }
}

/// Serve and ignore the output directory the latest build used (`build.out_dir` may change).
fn follow_out_dir(app: &App, scope: &Scope, dir: &Path, target: &Path) {
    *app.out_dir.write().unwrap_or_else(PoisonError::into_inner) = target.to_path_buf();
    if let Ok(relative) = target.strip_prefix(dir) {
        *scope
            .out_dir
            .write()
            .unwrap_or_else(PoisonError::into_inner) = relative.to_path_buf();
    }
}

/// The terminal line and the event of a finished build; the diagnostics (warnings included)
/// go to stderr in human form.
fn conclude(mut written: Written, color: bool, millis: u128) -> (String, BuildEvent) {
    if let Some(problem) = written.refused.take() {
        let shown = written.shown.clone().unwrap_or_default();
        written.report = with_diagnostic(
            &written.report,
            write_failed(&shown, &std::io::Error::other(format!("it {problem}"))),
        );
    }
    say_err(&render_report(
        &written.report,
        &written.sources,
        RenderOptions { color },
    ));
    match &written.written {
        Some((build_id, _)) => (
            format!("{} ({millis} ms)", built_line(&written, BuildMode::Dev)),
            BuildEvent::Succeeded {
                build_id: build_id.clone(),
            },
        ),
        None => {
            let report = to_report(&written.report, written.name.as_deref(), &written.sources);
            let diagnostics = report
                .get("diagnostics")
                .cloned()
                .unwrap_or(Value::Array(Vec::new()));
            (
                format!(
                    "build failed: {} ({millis} ms)",
                    counts(&written.report.summary)
                ),
                BuildEvent::Failed { diagnostics },
            )
        }
    }
}

/// The command that opens `url` in the default browser.
fn open_command(url: &str) -> Command {
    if cfg!(windows) {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(url);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    }
}

/// `--open`: open `url` in the default browser; a failure is a warning.
fn open_browser(url: &str) {
    let spawned = open_command(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    match spawned {
        // Reap the opener when it exits.
        Ok(mut child) => drop(std::thread::spawn(move || child.wait())),
        Err(error) => say_err(&format!("warning: could not open {url} ({error})\n")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mtek_compiler::diagnostics::Code;

    #[test]
    fn settings_come_from_the_project_file_or_the_defaults() {
        let dir = std::env::temp_dir().join(format!("mtek-dev-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(
            Settings::read(&dir),
            Settings {
                port: 5173,
                out_dir: PathBuf::from("dist"),
                name: String::new()
            }
        );
        std::fs::write(
            dir.join("mtek.toml"),
            "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n[build]\nout_dir = \"out/web\"\n[dev]\nport = 6001\n",
        )
        .unwrap();
        assert_eq!(
            Settings::read(&dir),
            Settings {
                port: 6001,
                out_dir: PathBuf::from("out").join("web"),
                name: "demo".to_owned()
            }
        );
        std::fs::write(dir.join("mtek.toml"), "[dev]\nport = \"x\"\n").unwrap();
        assert_eq!(Settings::read(&dir).port, 5173, "an invalid file: defaults");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_panic_is_a_failed_build_with_e9999() {
        let (line, event) = conclude(failure_of_panic("boom"), false, 7);
        assert_eq!(line, "build failed: 1 error, 0 warnings (7 ms)");
        let BuildEvent::Failed { diagnostics } = event else {
            panic!("{event:?}");
        };
        assert_eq!(diagnostics[0]["code"], "MTEK-E9999");
        assert_eq!(diagnostics[0]["notes"][0], "boom");
    }

    #[test]
    fn a_refused_output_directory_is_a_failed_build_with_e9031() {
        let mut written = failure_of_panic("x");
        written.report = Diagnostics::new().finish();
        written.shown = Some("..".to_owned());
        written.refused = Some("is the project directory or contains it".to_owned());
        let (line, event) = conclude(written, false, 1);
        assert_eq!(line, "build failed: 1 error, 0 warnings (1 ms)");
        let BuildEvent::Failed { diagnostics } = event else {
            panic!("{event:?}");
        };
        assert_eq!(diagnostics[0]["code"], format!("MTEK-{:?}", Code::E9031));
        assert!(
            diagnostics[0]["message"]
                .as_str()
                .unwrap()
                .contains("(it is the project directory or contains it)")
        );
    }

    #[test]
    fn the_browser_opener_fits_the_platform() {
        let command = open_command("http://127.0.0.1:5173/");
        let program = command.get_program().to_string_lossy().into_owned();
        let args: Vec<String> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        if cfg!(windows) {
            assert_eq!(program, "cmd");
            assert_eq!(args, ["/C", "start", "", "http://127.0.0.1:5173/"]);
        } else {
            assert!(program == "open" || program == "xdg-open", "{program}");
            assert_eq!(args, ["http://127.0.0.1:5173/"]);
        }
    }
}
