# Developer Tooling: CLI, Project File, Dev Server, Formatter, LSP (v0.1)

- Repository path: `spec/tooling.md`
- Status: Normative for v0.1 (blueprint §10). Commands are deliverables of the milestones noted; none exists before its milestone.

---

## 1. CLI overview (`mtek`, crate `mtek-cli`)

| Command | Milestone | Purpose |
|---|---|---|
| `mtek check [--format human\|json] [PATH]` | M1 | parse + type-check; **no GPU needed**; exit 1 on errors |
| `mtek build [--target web] [--mode release\|dev\|test\|preview] [--out DIR] [--format human\|json] [PATH]` | M1 (`preview`: M6) | produce `dist/` (`spec/runtime-abi.md` §2). `--target` accepts only `web` in v0.1 (the default; any other value is a usage error) |
| `mtek dev [--port N] [--open] [PATH]` | M1 (reload: M3) | build, serve, watch, rebuild; candidate-based hot reload from M3 |
| `mtek inspect --ir\|--bindings\|--shaders [--format human\|json] [PATH]` | M1 (`--ir`), M2 (`--shaders`, `--bindings`) | inspection (`spec/gpu-layout.md` §10) |
| `mtek new NAME` | M3 | scaffold a project from the built-in template (`mtek.toml`, `src/main.mtek` with the Demo scene, `.gitignore`) |
| `mtek fmt [--check] [PATHS…]` | M6 | canonical formatter |
| `mtek test [PATH]` | M6 | run a project's declarative test fixtures (§6) |
| `mtek context --entry FILE [--symbol NAME…] --format json` | M6 | AI context export (`spec/ai-and-benchmarks.md` §2) |
| `mtek grammar export --format ebnf\|gbnf` | M6 | grammar export (`spec/ai-and-benchmarks.md` §3) |
| `mtek lsp` | M6 | language server over stdio |
| `mtek --version` | M0 | prints `mtek 0.1.0-dev (language 0.1, runtime ABI 1)` |

`PATH` defaults to the current directory; the project root is the nearest ancestor containing `mtek.toml` (`E9004` if none).

**Exit codes:** `0` success (warnings allowed) · `1` the program has errors · `2` usage error (bad arguments) · `3` internal error (`E9999`) or I/O failure. **Output:** human diagnostics on stderr; `--format json` prints exactly one JSON document (the report of `spec/diagnostics.md` §2.2) on stdout and nothing else on stdout. `mtek check` never touches the GPU; target-device validation is a separate operation (`mtek build` + runtime, blueprint §10).

`mtek build` embeds the runtime bundle compiled into the CLI binary (`mtek-cli/build.rs` reads `packages/runtime-web/dist/runtime.js` if present). A CLI built without it still checks and inspects, but `build` fails with `E9030` explaining how to build the runtime first (`npm run build`).

## 2. Build modes

| Mode | Differences |
|---|---|
| `release` (default for `build`) | no dev overlay, no hot-reload client, `print` compiled out, warnings like `W8030` disabled |
| `dev` (used by `mtek dev`) | overlay, hot-reload client, `print`, dev-only warnings, `timestamp-query` requested if available |
| `test` | like `dev` without the overlay and reload client; `index.html` does not auto-mount and exposes `window.__mtekMount(options)` (signature in `spec/runtime-abi.md` §6.5) for Playwright; probe shaders emitted when requested by fixtures |
| `preview` (M6) | like `release` plus CPU loop budgets, network restriction, external `bootstrap.js` and a restrictive Content-Security-Policy (`spec/ai-and-benchmarks.md` §5) |

## 3. `mtek.toml`

```toml
[project]
name = "pulse-cube"          # required; [a-z0-9-]+
language = "0.1"             # required; must equal the compiler's language version (E9001)
entry = "src/main.mtek"        # default "src/main.mtek"
scene = "Demo"               # required if the entry module declares more than one scene

[build]
target = "web"               # only "web" in v0.1
out_dir = "dist"             # default "dist"
title = "Pulse Cube"         # <title> of index.html; default = project name

[host.inputs]                # optional; name = "Scene.state_name"
tint = "Demo.tint"

[runtime]                    # optional; defaults shown
fixed_step = 0.016666668
max_catch_up_steps = 4
max_frame_delta = 0.1
max_entities = 16384
pause_when_hidden = true

[dev]
port = 5173                  # default 5173; falls back to the next free port and says so

[assets]                     # M4; see spec/assets.md §6
max_file_bytes = 67108864
```

Unknown tables or keys, wrong types and out-of-range values are `E9001` with the exact key path. `host.inputs` targets must name scene state of an exposable type (`E9020`/`E9021`, `spec/runtime-abi.md` §6.3). There is no dependency table in v0.1 (no packages, blueprint §2.3).

## 4. `mtek dev`

- Serves `dist/` on `127.0.0.1:<port>` (loopback only; never `0.0.0.0` unless `--host` is given explicitly) with `Cache-Control: no-store`, correct MIME types (`.js` → `text/javascript`, `.wasm` → `application/wasm`, `.wgsl` → `text/plain`), and the SSE endpoint `/__mtek/events`.
- Watches the project root (excluding `out_dir`, `.git`, `node_modules`) with debounce 50 ms; rebuilds on change (serialised: a change during a build schedules exactly one follow-up build); publishes `build-started`, `build-failed` (diagnostics) and `build-succeeded` (`buildId` and `program: "/app.js?build=<buildId>"`) events as `data: <JSON>` frames (`spec/runtime-abi.md` §11.1). The dev reload client is part of the `index.html` the **compiler** emits in `BuildMode::Dev`; the CLI never patches HTML.
- M1 behaviour: on `build-succeeded` the page reloads fully. From M3: candidate-based hot reload keeps the last valid program running; on `build-failed` the overlay shows the diagnostics over the still-running last valid scene ("last valid preview", blueprint §10).
- Terminal output: one line per build with duration and counts; diagnostics in human format.

## 5. Formatter (`mtek fmt`, M6)

Canonical (no options), idempotent, comment-preserving, AST-based printer with comments attached by span.

- Indentation 4 spaces; maximum width 100; LF line endings; one trailing newline; no trailing whitespace.
- One blank line between items; members in their source order (the formatter never reorders); at most one consecutive blank line preserved inside bodies.
- `{` on the same line; `}` on its own line; `} else {`.
- Declaration fields, statements and members one per line, ending in `;`.
- **Descriptor literals:** printed on one line `Box { size: vec3(1.0, 1.0, 1.0) }` when the whole line fits in 100 columns, without a trailing `;` inside the braces; otherwise one field per line, each followed by `;`.
- Spaces around binary operators and `=`, after `,` and `:`; none inside parentheses; `-x` and `!x` without space.
- Colour literals lowercased; numeric literals printed as written (they are already canonical by the lexical rules).
- Doc comments stay attached to the following declaration; other comments stay at their relative position.
- Properties tested on the whole corpus: `fmt(fmt(x)) == fmt(x)`; `parse(fmt(x))` has the same AST as `parse(x)` (modulo spans); comments preserved (multiset of comment texts equal).

## 6. `mtek test` (M6)

Runs declarative fixtures in `tests/*.test.toml` of a project — no new test syntax in the language (blueprint §12.1):

```toml
name = "space toggles direction"
steps = [
  { step = 60, dt = 0.016666668 },
  { press = "Space" }, { step = 1, dt = 0.016666668 }, { release = "Space" },
  { expect_state = { speed = -0.7 } },
  { expect_pixel = { x = 64, y = 64, color = "#6b5cff", tolerance = 2 } },
]
```
`mtek test` builds the project in `test` mode, launches the browser harness of `spec/testing.md` §6 (Playwright must be installed; otherwise it reports NOT-RUN and exits 1 unless `--allow-not-run`) and reports per fixture.

## 7. Language server (`mtek lsp`, M6)

- Transport: stdio JSON-RPC via `lsp-server`/`lsp-types`. Position encoding negotiated: UTF-16 by default (LSP requirement), UTF-8 if the client offers it.
- Features (basic LSP, blueprint §10): publish diagnostics (from `check`, debounced 150 ms, using unsaved buffers through the in-memory `Fs`); hover (type and doc comment; registry docs for prelude names); go-to-definition (including imports and prelude docs as virtual read-only documents); completion (scope names, schema fields after `Name {`, enum members after `Key.`, intrinsics; all from the registry and resolver).
- The LSP calls the same compiler service as the CLI; there is no second semantic implementation.

## 8. VS Code extension (`packages/editor-vscode`, M6)

LSP client launching `mtek lsp` (path configurable, default `mtek` on `PATH`), TextMate grammar for highlighting (generated from the keyword and token lists of `spec/grammar.ebnf` by a script and checked against the corpus for no crashes), language configuration (comments, brackets, auto-closing). Packaged with `@vscode/vsce` as a `.vsix` in CI artefacts; publishing to a marketplace is out of scope for v0.1.

## 9. Development overlay (dev builds, M4)

Fixed panel in a corner of the canvas: active scene, selected entity (cycled with a key combination documented in the panel), its source declaration (`file:line`), frame time (ms, p50/p95 over the last 120 frames), draw calls, culled objects, upload bytes, pipelines created, live resource counts, discarded fixed steps, and the latest validation errors. Toggled with `` ` ``. Not present in release builds.
