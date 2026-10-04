//! `index.html`: the minimal page with a canvas and the bootstrap module
//! (`spec/runtime-abi.md` section 6.5, `spec/tooling.md` sections 2 and 4).
//!
//! - `release`: imports `app.js` and mounts the program on `#mtek`; failures are shown by the
//!   runtime's overlay.
//! - `test`: does not mount; defines `window.__mtekMount(options)`, which mounts `program` on
//!   `#mtek` with the given options (Playwright passes `test` options).
//! - `dev`: mounts like `release` and adds the development reload client: it subscribes to
//!   `/__mtek/events` and reloads the page on `build-succeeded` (the M1 behaviour; candidate
//!   hot reload is M3). The compiler emits it; the CLI never patches HTML.
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

const TEST_MOUNT: &str = "  window.__mtekMount = (options) => mountMtek(document.getElementById(\"mtek\"), program, options);\n";

const RELOAD_CLIENT: &str = "  // Development reload client (spec/tooling.md section 4): reload after every successful build.\n  new EventSource(\"/__mtek/events\").onmessage = (event) => {\n    const message = JSON.parse(event.data);\n    if (message.type === \"build-succeeded\") location.reload();\n    if (message.type === \"build-failed\") console.error(\"mtek: build failed\", message.diagnostics);\n  };\n";

/// The text of `index.html` for `mode` with the page title `title`. `None` for a mode whose
/// bootstrap this build does not implement (`preview`, M6).
#[must_use]
pub fn index_html(title: &str, mode: BuildMode) -> Option<String> {
    let script = match mode {
        BuildMode::Release => MOUNT.to_owned(),
        BuildMode::Test => TEST_MOUNT.to_owned(),
        BuildMode::Dev => format!("{MOUNT}{RELOAD_CLIENT}"),
        BuildMode::Preview => return None,
    };
    Some(format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{}</title>\n\
         <style>html,body{{margin:0;height:100%}}canvas{{display:block;width:100%;height:100%}}</style>\n\
         <canvas id=\"mtek\"></canvas>\n\
         <script type=\"module\">\n\
         \x20 import program, {{ mountMtek }} from \"./app.js\";\n\
         {script}\
         </script>\n",
        escape_html(title)
    ))
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
        assert!(
            page.contains("\"build-succeeded\") location.reload();"),
            "{page}"
        );
        assert!(!page.contains("__mtekMount"), "{page}");
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
