//! Watching the project for changes (`spec/tooling.md` section 4).
//!
//! The whole project directory is watched recursively; a change counts unless it lies inside
//! the output directory, inside one of its replace-on-success siblings
//! (`<out_dir>.tmp-<buildId>`, `<out_dir>.old-<buildId>`, `spec/runtime-abi.md` section 2 —
//! the build's own writes, which would otherwise trigger the next build forever), or inside a
//! directory named `.git` or `node_modules`. Pure accesses (opening or reading a file, as the
//! compiler does) are not changes.

use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, PoisonError, RwLock};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use tokio::sync::mpsc;

/// Directory names whose contents never trigger a build, wherever they are.
const IGNORED_DIRS: [&str; 2] = [".git", "node_modules"];

/// Whether a change of `relative` (a path relative to the project directory) is ignored when
/// the output directory is `out_dir` (also relative to the project directory).
pub fn ignored(relative: &Path, out_dir: &Path) -> bool {
    let named = |component: Component<'_>| matches!(component, Component::Normal(name) if IGNORED_DIRS.iter().any(|dir| name == *dir));
    if relative.components().any(named) || relative.starts_with(out_dir) {
        return true;
    }
    let (Some(parent), Some(name)) = (out_dir.parent(), out_dir.file_name()) else {
        return false;
    };
    let Ok(below) = relative.strip_prefix(parent) else {
        return false;
    };
    let Some(Component::Normal(first)) = below.components().next() else {
        return false;
    };
    let (Some(first), Some(name)) = (first.to_str(), name.to_str()) else {
        return false;
    };
    first
        .strip_prefix(name)
        .is_some_and(|rest| rest.starts_with(".tmp-") || rest.starts_with(".old-"))
}

/// The project directory and the output directory relative to it, which follows
/// `build.out_dir` from build to build.
#[derive(Debug)]
pub struct Scope {
    /// The project directory as watched.
    root: PathBuf,
    /// The same directory with links resolved (macOS reports `/private/var/…` for `/var/…`).
    canonical: Option<PathBuf>,
    /// The output directory, relative to the project directory.
    pub out_dir: RwLock<PathBuf>,
}

impl Scope {
    /// The scope of the project at `root` with the output directory `out_dir` (relative).
    pub fn new(root: &Path, out_dir: PathBuf) -> Scope {
        Scope {
            root: root.to_path_buf(),
            canonical: std::fs::canonicalize(root).ok(),
            out_dir: RwLock::new(out_dir),
        }
    }

    /// Whether a change of the absolute `path` should trigger a build.
    pub fn counts(&self, path: &Path) -> bool {
        let relative = path
            .strip_prefix(&self.root)
            .ok()
            .or_else(|| path.strip_prefix(self.canonical.as_ref()?).ok());
        // Outside the project, or the project directory itself (its own metadata): no build
        // reads either.
        let Some(relative) = relative.filter(|relative| !relative.as_os_str().is_empty()) else {
            return false;
        };
        let out_dir = self.out_dir.read().unwrap_or_else(PoisonError::into_inner);
        !ignored(relative, &out_dir)
    }
}

/// Whether an event of `kind` can change what a build reads.
fn is_change(kind: &EventKind) -> bool {
    !matches!(kind, EventKind::Access(_))
}

/// Whether `kind` is a modification other than a rename. On a directory such an event says
/// only that something inside changed (Windows reports one when a build merely lists a fresh
/// directory, as its access time is updated); the change itself arrives as its own event, so
/// these are ignored for directories. A renamed directory still counts.
fn is_content_change(kind: &EventKind) -> bool {
    matches!(kind, EventKind::Modify(modify) if !matches!(modify, notify::event::ModifyKind::Name(_)))
}

/// Start watching `scope`'s project directory. Every relevant change sends `()` on `changes`;
/// a watcher error is printed through `warn` and otherwise ignored. The watcher stops when the
/// returned value is dropped.
///
/// # Errors
/// The watcher could not be created or could not watch the directory.
pub fn watch(
    scope: Arc<Scope>,
    changes: mpsc::UnboundedSender<()>,
    warn: impl Fn(String) + Send + 'static,
) -> notify::Result<RecommendedWatcher> {
    let root = scope.root.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        match result {
            Ok(event) => {
                let relevant = |path: &PathBuf| {
                    scope.counts(path) && !(is_content_change(&event.kind) && path.is_dir())
                };
                if is_change(&event.kind) && event.paths.iter().any(relevant) {
                    // The receiver is gone only while shutting down.
                    let _ = changes.send(());
                }
            }
            Err(error) => warn(format!("warning: the file watcher reported: {error}")),
        }
    })?;
    watcher.watch(&root, RecursiveMode::Recursive)?;
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn is_ignored(relative: &str, out_dir: &str) -> bool {
        ignored(Path::new(relative), Path::new(out_dir))
    }

    #[test]
    fn sources_count_and_build_output_does_not() {
        assert!(!is_ignored("src/main.mtek", "dist"));
        assert!(!is_ignored("mtek.toml", "dist"));
        assert!(
            !is_ignored("distance.mtek", "dist"),
            "a prefix is not the directory"
        );
        assert!(!is_ignored("dist-notes/x", "dist"));
        assert!(
            !is_ignored("dist.tmp/x", "dist"),
            "the sibling needs the build id dash"
        );
        assert!(is_ignored("dist", "dist"));
        assert!(is_ignored("dist/app.js", "dist"));
        assert!(is_ignored("dist/shaders/a.wgsl", "dist"));
        assert!(is_ignored("dist.tmp-0123abcd/app.js", "dist"));
        assert!(is_ignored("dist.old-0123abcd", "dist"));
        assert!(is_ignored(".git/index", "dist"));
        assert!(is_ignored("node_modules/x/y.js", "dist"));
        assert!(is_ignored("src/node_modules/y.js", "dist"));
        assert!(!is_ignored("src/gitlike.mtek", "dist"));
    }

    #[test]
    fn a_nested_output_directory_and_its_siblings_are_ignored() {
        assert!(is_ignored("out/web/index.html", "out/web"));
        assert!(is_ignored("out/web.tmp-ff/index.html", "out/web"));
        assert!(is_ignored("out/web.old-ff", "out/web"));
        assert!(!is_ignored("out/other.mtek", "out/web"));
        assert!(!is_ignored("web.tmp-ff/x", "out/web"));
    }

    #[test]
    fn paths_outside_the_project_do_not_count() {
        let root = std::env::temp_dir().join("mtek-watch-scope");
        let scope = Scope::new(&root, PathBuf::from("dist"));
        assert!(scope.counts(&root.join("src").join("main.mtek")));
        assert!(!scope.counts(&root.join("dist").join("app.js")));
        assert!(!scope.counts(&std::env::temp_dir().join("elsewhere.mtek")));
        assert!(!scope.counts(&root));
        *scope.out_dir.write().unwrap() = PathBuf::from("build");
        assert!(scope.counts(&root.join("dist").join("app.js")));
        assert!(!scope.counts(&root.join("build").join("app.js")));
    }

    #[test]
    fn accesses_are_not_changes() {
        use notify::event::{AccessKind, CreateKind, ModifyKind};
        assert!(!is_change(&EventKind::Access(AccessKind::Any)));
        assert!(is_change(&EventKind::Modify(ModifyKind::Any)));
        assert!(is_change(&EventKind::Create(CreateKind::File)));
        assert!(is_change(&EventKind::Any));
        assert!(is_content_change(&EventKind::Modify(ModifyKind::Any)));
        assert!(!is_content_change(&EventKind::Modify(ModifyKind::Name(
            notify::event::RenameMode::To
        ))));
        assert!(!is_content_change(&EventKind::Create(CreateKind::Folder)));
    }

    #[test]
    fn the_watcher_reports_source_changes_but_not_output_writes() {
        let root = std::env::temp_dir().join(format!("mtek-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("dist")).unwrap();
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let scope = Arc::new(Scope::new(&root, PathBuf::from("dist")));
        let watcher = watch(scope, sender, |_| {}).unwrap();
        let settle = Duration::from_millis(300);
        std::thread::sleep(settle);
        while receiver.try_recv().is_ok() {}
        // Listing a fresh directory (as a build does) is not a change.
        let _ = std::fs::read_dir(root.join("src")).unwrap().count();
        std::fs::write(root.join("dist").join("app.js"), "x").unwrap();
        std::fs::create_dir_all(root.join("dist.tmp-1")).unwrap();
        std::fs::write(root.join("dist.tmp-1").join("app.js"), "x").unwrap();
        std::thread::sleep(settle);
        assert!(receiver.try_recv().is_err(), "output writes do not count");
        std::fs::write(root.join("src").join("main.mtek"), "scene").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while receiver.try_recv().is_err() {
            assert!(std::time::Instant::now() < deadline, "no change reported");
            std::thread::sleep(Duration::from_millis(20));
        }
        drop(watcher);
        let _ = std::fs::remove_dir_all(&root);
    }
}
