//! `index.html`: the minimal page with a canvas and the bootstrap module
//! (`spec/runtime-abi.md` section 6.5, `spec/tooling.md` sections 2 and 4).
//!
//! - `release`: imports `app.js` and mounts the program on `#mtek`; failures are shown by the
//!   runtime's overlay.
//! - `test`: does not mount; defines `window.__mtekMount(options)`, which mounts `program` on
//!   `#mtek` with the given options (Playwright passes `test` options).
//! - `dev`: mounts like `release`, with `{ devOverlay: true }` for the development runtime's
//!   overlay (decision 0055), and adds the development reload client: it subscribes to
//!   `/__mtek/events` and, on `build-succeeded`, `import()`s the candidate and calls
//!   `app.replaceProgram` (candidate-based hot reload, `spec/runtime-abi.md` section 11); on
//!   `build-failed` it shows the diagnostics in an overlay over the still-running scene. The
//!   compiler emits it; the CLI never patches HTML. [`dev_waiting_page`] is the page `mtek dev`
//!   serves before the first successful build: the same client without a program (first success
//!   still reloads into the real page).
//!
//! - `preview`: like `release`, but the page has no script of its own (decision 0075): it
//!   carries the Content-Security-Policy of `spec/ai-and-benchmarks.md` section 5 as a `<meta>`
//!   and loads the external module [`BOOTSTRAP_JS`] (`bootstrap.js`, [`preview_bootstrap`]),
//!   which does what the inline script of `release` does. A policy without `'unsafe-inline'`
//!   for scripts cannot allow an inline module.
//!
//! The `<title>` is `[build] title` (default: the project name), HTML-escaped.

use crate::BuildMode;

/// `text` with the HTML special characters escaped.
#[must_use]
pub fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

const MOUNT: &str = "  mountMtek(document.getElementById(\"mtek\"), program).catch(() => {}); // failures are shown by the overlay\n";

/// Dev mount: asks the development runtime for its overlay (`devOverlay`, decision 0055) and
/// assigns the live `MtekApp` into the `app` binding declared by [`RELOAD_CLIENT`].
const DEV_MOUNT: &str = "  mountMtek(document.getElementById(\"mtek\"), program, { devOverlay: true }).then((mounted) => { app = mounted; }).catch(() => {});\n";

const TEST_MOUNT: &str = "  window.__mtekMount = (options) => mountMtek(document.getElementById(\"mtek\"), program, options);\n";

/// The id of the element in which the reload client shows the diagnostics of a failed build.
pub const DEV_OVERLAY_ID: &str = "mtek-dev-overlay";

/// The development reload client (`spec/tooling.md` section 4, `spec/runtime-abi.md` section
/// 11.1): one `data: <JSON>` message per event on `/__mtek/events`. `build-succeeded` imports
/// the candidate and calls `app.replaceProgram` when a mount exists; otherwise reloads (waiting
/// page). `build-failed` shows diagnostics as plain text in a fixed `<pre id="mtek-dev-overlay">`
/// over the still-running scene.
const RELOAD_CLIENT: &str = concat!(
    "  // Development reload client (spec/tooling.md section 4, spec/runtime-abi.md section 11):\n",
    "  // candidate-based hot reload on success; diagnostics overlay on failure.\n",
    "  let app = null;\n",
    "  function mtekShowBuildDiagnostics(diagnostics) {\n",
    "    let overlay = document.getElementById(\"mtek-dev-overlay\");\n",
    "    if (!overlay) {\n",
    "      overlay = document.createElement(\"pre\");\n",
    "      overlay.id = \"mtek-dev-overlay\";\n",
    "      overlay.style.cssText = \"position:fixed;inset:0;margin:0;padding:16px;overflow:auto;z-index:2147483647;background:rgba(24,24,24,0.94);color:#f4f4f4;font:13px/1.45 monospace;white-space:pre-wrap\";\n",
    "      document.body.append(overlay);\n",
    "    }\n",
    "    overlay.textContent = \"mtek: build failed\\n\\n\" + diagnostics.map((d) =>\n",
    "      (d.source ? d.source.file + \":\" + d.source.startLine + \":\" + d.source.startColumn + \": \" : \"\") +\n",
    "      d.severity + \"[\" + d.code + \"]: \" + d.message + (d.notes || []).map((note) => \"\\n  = \" + note).join(\"\")\n",
    "    ).join(\"\\n\\n\");\n",
    "  }\n",
    "  function mtekClearBuildDiagnostics() {\n",
    "    const overlay = document.getElementById(\"mtek-dev-overlay\");\n",
    "    if (overlay) overlay.remove();\n",
    "  }\n",
    "  new EventSource(\"/__mtek/events\").onmessage = async (event) => {\n",
    "    const message = JSON.parse(event.data);\n",
    "    if (message.type === \"build-succeeded\") {\n",
    "      mtekClearBuildDiagnostics();\n",
    "      if (!app || typeof app.replaceProgram !== \"function\") { location.reload(); return; }\n",
    "      try {\n",
    "        const mod = await import(message.program);\n",
    "        const result = await app.replaceProgram(mod.default);\n",
    "        if (!result.ok) {\n",
    "          console.error(\"mtek: hot reload rejected\", result.diagnostics);\n",
    "          mtekShowBuildDiagnostics(result.diagnostics);\n",
    "        }\n",
    "      } catch (error) {\n",
    "        console.error(\"mtek: hot reload failed\", error);\n",
    "        mtekShowBuildDiagnostics([{ severity: \"error\", code: \"MTEK-E8050\", message: String(error && error.message || error), notes: [], source: null }]);\n",
    "      }\n",
    "      return;\n",
    "    }\n",
    "    if (message.type !== \"build-failed\") return;\n",
    "    console.error(\"mtek: build failed\", message.diagnostics);\n",
    "    mtekShowBuildDiagnostics(message.diagnostics);\n",
    "  };\n",
);

/// The file name of the external bootstrap module of a `preview` build, next to `index.html`.
pub const BOOTSTRAP_JS: &str = "bootstrap.js";

/// The Content-Security-Policy of a `preview` page (`spec/ai-and-benchmarks.md` section 5).
/// `'wasm-unsafe-eval'` is what lets the physics module instantiate its WebAssembly; it allows
/// no JavaScript `eval`. Only directives a `<meta>` element honours are used: `frame-ancestors`,
/// `sandbox` and `report-uri` are ignored there and belong in the response headers of the host
/// (`docs/preview-hosting.md`).
pub const PREVIEW_CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'";

/// The text of `bootstrap.js` of a `preview` build: the script of the `release` page, as a file.
#[must_use]
pub fn preview_bootstrap() -> String {
    format!(
        "import program, {{ mountMtek }} from \"./app.js\";\n{}",
        MOUNT.trim_start()
    )
}

const STYLE: &str =
    "<style>html,body{margin:0;height:100%}canvas{display:block;width:100%;height:100%}</style>\n";

/// The text of `index.html` for `mode` with the page title `title`.
#[must_use]
pub fn index_html(title: &str, mode: BuildMode) -> String {
    let script = match mode {
        BuildMode::Release => MOUNT.to_owned(),
        BuildMode::Test => TEST_MOUNT.to_owned(),
        // `app` is declared by RELOAD_CLIENT; DEV_MOUNT assigns the mounted handle into it.
        BuildMode::Dev => format!("{RELOAD_CLIENT}{DEV_MOUNT}"),
        // No inline script: the policy forbids it (decision 0075).
        BuildMode::Preview => {
            return format!(
                "<!doctype html><meta charset=\"utf-8\">\n\
                 <meta http-equiv=\"Content-Security-Policy\" content=\"{PREVIEW_CSP}\">\n\
                 <title>{}</title>\n\
                 {STYLE}\
                 <canvas id=\"mtek\"></canvas>\n\
                 <script type=\"module\" src=\"./{BOOTSTRAP_JS}\"></script>\n",
                escape_html(title)
            );
        }
    };
    format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{}</title>\n\
         {STYLE}\
         <canvas id=\"mtek\"></canvas>\n\
         <script type=\"module\">\n\
         \x20 import program, {{ mountMtek }} from \"./app.js\";\n\
         {script}\
         </script>\n",
        escape_html(title)
    )
}

/// The default favicon of a game package (decision 0136): a rounded square with an "M", as SVG.
pub const DEFAULT_FAVICON_SVG: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect width=\"64\" height=\"64\" rx=\"14\" fill=\"#2f6fdf\"/><path d=\"M14 48V16h8l10 14 10-14h8v32h-8V29l-10 13-10-13v19z\" fill=\"#fff\"/></svg>\n";

/// The `index.html` of a `mtek build --release` game package (decision 0136, `spec/tooling.md`
/// section 2.1): the `release` page plus a viewport meta, the favicon link (`favicon` is a file
/// name next to `index.html`) and a loading screen with the title that fades out when the mount
/// settles. On a failure the loading screen goes too, so the runtime's overlay (including the
/// unsupported-browser screen of decision 0132) is what remains.
#[must_use]
pub fn game_html(title: &str, favicon: &str) -> String {
    let title = escape_html(title);
    let favicon = escape_html(favicon);
    format!(
        "<!doctype html><meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n\
         <title>{title}</title>\n\
         <link rel=\"icon\" href=\"./{favicon}\">\n\
         <style>html,body{{margin:0;height:100%;background:#0b0f17}}canvas{{display:block;width:100%;height:100%}}\
         #mtek-loading{{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;\
         background:#0b0f17;color:#e8edf5;font:600 22px/1.3 system-ui,sans-serif;z-index:2147483000;transition:opacity .3s}}\
         #mtek-loading.done{{opacity:0;pointer-events:none}}#mtek-loading small{{font-weight:400;font-size:14px;opacity:.7}}\
         #mtek-loading i{{width:36px;height:36px;border:4px solid #3a4558;border-top-color:#e8edf5;border-radius:50%;animation:mtek-spin 1s linear infinite}}\
         @keyframes mtek-spin{{to{{transform:rotate(360deg)}}}}</style>\n\
         <canvas id=\"mtek\"></canvas>\n\
         <div id=\"mtek-loading\" role=\"status\" aria-live=\"polite\"><i></i><span>{title}</span><small>Loading…</small></div>\n\
         <script type=\"module\">\n\
         \x20 import program, {{ mountMtek }} from \"./app.js\";\n\
         \x20 const loading = document.getElementById(\"mtek-loading\");\n\
         \x20 const hide = () => {{ loading.classList.add(\"done\"); setTimeout(() => loading.remove(), 400); }};\n\
         \x20 mountMtek(document.getElementById(\"mtek\"), program).then(hide, hide); // failures are shown by the overlay\n\
         </script>\n"
    )
}

/// The page `mtek dev` serves for `/` while its output directory has no `index.html`, i.e.
/// before the first successful build (decision 0033): no program to mount, only the reload
/// client of the dev `index.html`, so the diagnostics of the failed build appear in the
/// overlay and the first successful build reloads into the real page.
#[must_use]
pub fn dev_waiting_page(title: &str) -> String {
    format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{}</title>\n\
         {STYLE}\
         <canvas id=\"mtek\"></canvas>\n\
         <script type=\"module\">\n\
         {RELOAD_CLIENT}\
         </script>\n",
        escape_html(title)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_mounts_on_the_canvas() {
        let page = index_html("Pulse Cube", BuildMode::Release);
        assert_eq!(
            page,
            "<!doctype html><meta charset=\"utf-8\"><title>Pulse Cube</title>\n\
             <style>html,body{margin:0;height:100%}canvas{display:block;width:100%;height:100%}</style>\n\
             <canvas id=\"mtek\"></canvas>\n\
             <script type=\"module\">\n\
             \x20 import program, { mountMtek } from \"./app.js\";\n\
             \x20 mountMtek(document.getElementById(\"mtek\"), program).catch(() => {}); // failures are shown by the overlay\n\
             </script>\n"
        );
        assert!(!page.contains("__mtekMount") && !page.contains("EventSource"));
    }

    #[test]
    fn the_game_page_has_the_loading_screen_favicon_and_escaped_title() {
        let page = game_html("<Dodge> & run", "favicon.svg");
        assert!(page.contains("<title>&lt;Dodge&gt; &amp; run</title>"));
        assert!(page.contains("<span>&lt;Dodge&gt; &amp; run</span>"));
        assert!(page.contains("<link rel=\"icon\" href=\"./favicon.svg\">"));
        assert!(page.contains("id=\"mtek-loading\""));
        assert!(page.contains(".then(hide, hide)"));
        assert!(page.contains("import program, { mountMtek } from \"./app.js\";"));
        assert!(!page.contains("EventSource") && !page.contains("__mtekMount"));
        assert!(DEFAULT_FAVICON_SVG.starts_with("<svg"));
    }

    #[test]
    fn test_mode_defines_the_mount_hook_instead_of_mounting() {
        let page = index_html("t", BuildMode::Test);
        assert!(page.contains("window.__mtekMount = (options) => mountMtek(document.getElementById(\"mtek\"), program, options);"));
        assert!(!page.contains(".catch("), "{page}");
        assert!(!page.contains("EventSource"), "{page}");
    }

    #[test]
    fn dev_mode_adds_the_reload_client() {
        let page = index_html("t", BuildMode::Dev);
        assert!(page.contains(".catch(() => {});"), "{page}");
        // Only the dev page asks for the development overlay; the others never mention it.
        assert!(page.contains("program, { devOverlay: true })"), "{page}");
        for mode in [BuildMode::Release, BuildMode::Test] {
            let other = index_html("t", mode);
            assert!(!other.contains("devOverlay"), "{other}");
        }
        assert!(
            page.contains("new EventSource(\"/__mtek/events\")"),
            "{page}"
        );
        assert!(page.contains("app.replaceProgram"), "{page}");
        assert!(page.contains("await import(message.program)"), "{page}");
        assert!(
            page.contains("location.reload()"),
            "waiting / no-app path still reloads: {page}"
        );
        assert!(!page.contains("__mtekMount"), "{page}");
    }

    #[test]
    fn dev_mode_shows_failed_builds_in_an_overlay() {
        let page = index_html("t", BuildMode::Dev);
        assert!(
            page.contains("mtekShowBuildDiagnostics(message.diagnostics)"),
            "{page}"
        );
        assert!(
            page.contains(&format!("overlay.id = \"{DEV_OVERLAY_ID}\";")),
            "{page}"
        );
        assert!(
            page.contains(&format!("getElementById(\"{DEV_OVERLAY_ID}\")")),
            "{page}"
        );
        // Text, never markup: a message cannot inject HTML into the page.
        assert!(page.contains("overlay.textContent = "), "{page}");
        assert!(!page.contains("innerHTML"), "{page}");
        assert!(page.is_ascii(), "generated code is ASCII");
        assert_eq!(page.matches("<script").count(), 1);
    }

    #[test]
    fn the_waiting_page_has_the_reload_client_and_mounts_nothing() {
        let page = dev_waiting_page("<demo>");
        assert!(
            page.starts_with(
                "<!doctype html><meta charset=\"utf-8\"><title>&lt;demo&gt;</title>\n"
            )
        );
        assert!(page.contains(RELOAD_CLIENT), "{page}");
        assert!(
            !page.contains("app.js") && !page.contains("mountMtek"),
            "{page}"
        );
        let dev = index_html("<demo>", BuildMode::Dev);
        assert!(dev.contains(RELOAD_CLIENT));
        assert!(page.is_ascii());
    }

    #[test]
    fn the_title_is_escaped_in_every_page() {
        for mode in [BuildMode::Release, BuildMode::Preview] {
            let page = index_html("</title><script>alert(1)</script> & 'x'", mode);
            assert!(page.contains(
                "<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#39;x&#39;</title>"
            ));
            assert_eq!(page.matches("<script").count(), 1, "{page}");
        }
    }

    #[test]
    fn preview_has_the_policy_and_no_inline_script() {
        let page = index_html("Pulse Cube", BuildMode::Preview);
        assert_eq!(
            page,
            "<!doctype html><meta charset=\"utf-8\">\n\
             <meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'\">\n\
             <title>Pulse Cube</title>\n\
             <style>html,body{margin:0;height:100%}canvas{display:block;width:100%;height:100%}</style>\n\
             <canvas id=\"mtek\"></canvas>\n\
             <script type=\"module\" src=\"./bootstrap.js\"></script>\n"
        );
        // The policy comes before anything that loads or runs, and no script has a body.
        let policy = page.find("Content-Security-Policy").expect("policy");
        assert!(policy < page.find("<script").expect("script"));
        assert!(page.contains("></script>"), "{page}");
        assert!(page.is_ascii());
        // The bootstrap is the release page's script as a file, and mentions nothing development.
        assert_eq!(
            preview_bootstrap(),
            "import program, { mountMtek } from \"./app.js\";\n\
             mountMtek(document.getElementById(\"mtek\"), program).catch(() => {}); // failures are shown by the overlay\n"
        );
        assert!(!page.contains("devOverlay") && !page.contains("EventSource"));
    }

    #[test]
    fn the_policy_names_the_directives_of_the_specification() {
        let directives: Vec<&str> = PREVIEW_CSP.split("; ").collect();
        assert_eq!(
            directives,
            [
                "default-src 'self'",
                "script-src 'self' 'wasm-unsafe-eval'",
                "connect-src 'self'",
                "img-src 'self' blob:",
                "style-src 'self' 'unsafe-inline'",
            ]
        );
        // Never a JavaScript eval, never an inline script, never a remote origin.
        assert!(!PREVIEW_CSP.contains("'unsafe-eval'"));
        assert!(!PREVIEW_CSP.contains("script-src 'self' 'unsafe-inline'"));
        assert!(!PREVIEW_CSP.contains("http"));
    }
}
