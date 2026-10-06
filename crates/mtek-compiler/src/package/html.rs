//! `index.html`: the minimal page with a canvas and the bootstrap module
//! (`spec/runtime-abi.md` section 6.5, `spec/tooling.md` sections 2 and 4).
//!
//! - `release`: imports `app.js` and mounts the program on `#mtek`; failures are shown by the
//!   runtime's overlay.
//! - `test`: does not mount; defines `window.__mtekMount(options)`, which mounts `program` on
//!   `#mtek` with the given options (Playwright passes `test` options).
//! - `dev`: mounts like `release` and adds the development reload client: it subscribes to
//!   `/__mtek/events` and, on `build-succeeded`, `import()`s the candidate and calls
//!   `app.replaceProgram` (candidate-based hot reload, `spec/runtime-abi.md` section 11); on
//!   `build-failed` it shows the diagnostics in an overlay over the still-running scene. The
//!   compiler emits it; the CLI never patches HTML. [`dev_waiting_page`] is the page `mtek dev`
//!   serves before the first successful build: the same client without a program (first success
//!   still reloads into the real page).
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

/// Dev mount: assigns the live `MtekApp` into the `app` binding declared by [`RELOAD_CLIENT`].
const DEV_MOUNT: &str = "  mountMtek(document.getElementById(\"mtek\"), program).then((mounted) => { app = mounted; }).catch(() => {});\n";

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

const STYLE: &str =
    "<style>html,body{margin:0;height:100%}canvas{display:block;width:100%;height:100%}</style>\n";

/// The text of `index.html` for `mode` with the page title `title`. `None` for a mode whose
/// bootstrap this build does not implement (`preview`, M6).
#[must_use]
pub fn index_html(title: &str, mode: BuildMode) -> Option<String> {
    let script = match mode {
        BuildMode::Release => MOUNT.to_owned(),
        BuildMode::Test => TEST_MOUNT.to_owned(),
        // `app` is declared by RELOAD_CLIENT; DEV_MOUNT assigns the mounted handle into it.
        BuildMode::Dev => format!("{RELOAD_CLIENT}{DEV_MOUNT}"),
        BuildMode::Preview => return None,
    };
    Some(format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{}</title>\n\
         {STYLE}\
         <canvas id=\"mtek\"></canvas>\n\
         <script type=\"module\">\n\
         \x20 import program, {{ mountMtek }} from \"./app.js\";\n\
         {script}\
         </script>\n",
        escape_html(title)
    ))
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
        let page = index_html("Pulse Cube", BuildMode::Release).expect("page");
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
    fn test_mode_defines_the_mount_hook_instead_of_mounting() {
        let page = index_html("t", BuildMode::Test).expect("page");
        assert!(page.contains("window.__mtekMount = (options) => mountMtek(document.getElementById(\"mtek\"), program, options);"));
        assert!(!page.contains(".catch("), "{page}");
        assert!(!page.contains("EventSource"), "{page}");
    }

    #[test]
    fn dev_mode_adds_the_reload_client() {
        let page = index_html("t", BuildMode::Dev).expect("page");
        assert!(page.contains(".catch(() => {});"), "{page}");
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
        let page = index_html("t", BuildMode::Dev).expect("page");
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
        let dev = index_html("<demo>", BuildMode::Dev).expect("page");
        assert!(dev.contains(RELOAD_CLIENT));
        assert!(page.is_ascii());
    }

    #[test]
    fn the_title_is_escaped_and_preview_is_not_built() {
        let page = index_html(
            "</title><script>alert(1)</script> & 'x'",
            BuildMode::Release,
        )
        .expect("page");
        assert!(page.contains(
            "<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#39;x&#39;</title>"
        ));
        assert_eq!(page.matches("<script").count(), 1);
        assert_eq!(index_html("t", BuildMode::Preview), None);
    }
}
