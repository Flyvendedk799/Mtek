# Developer Tooling: CLI, Project File, Dev Server, Formatter, LSP (v0.1)

- Repository path: `spec/tooling.md`
- Status: Normative for v0.1 (blueprint §10). Commands are deliverables of the milestones noted; none exists before its milestone.

---

## 1. CLI overview (`mtek`, crate `mtek-cli`)

| Command | Milestone | Purpose |
|---|---|---|
| `mtek check [--format human\|json] [PATH]` | M1 | parse + type-check; **no GPU needed**; exit 1 on errors |
| `mtek build [--target web] [--mode release\|dev\|test\|preview] [--loop-budget N] [--out DIR] [--format human\|json] [PATH]` | M1 (`preview`: M6) | produce `dist/` (`spec/runtime-abi.md` §2). `--target` accepts only `web` in v0.1 (the default; any other value is a usage error) |
| `mtek dev [--port N] [--open] [PATH]` | M1 (reload: M3) | build, serve, watch, rebuild; candidate-based hot reload from M3 |
| `mtek inspect --ir\|--bindings\|--shaders\|--assets [--format human\|json] [PATH]` | M1 (`--ir`), M2 (`--shaders`, `--bindings`), M4 (`--assets`) | inspection (`spec/gpu-layout.md` §10; the views are decision 0044; `--assets` is the packaged assets of `spec/assets.md` §4, decision 0058) |
| `mtek new NAME` | M3 | scaffold a project from the built-in template (`mtek.toml`, `src/main.mtek` with the Demo scene, `.gitignore`) |
| `mtek fmt [--check] [PATHS…]` | M6 | canonical formatter |
| `mtek test [--allow-not-run] [--format human\|json] [PATH]` | M6 | run a project's declarative test fixtures (§6; decision 0074) |
| `mtek context --entry FILE [--symbol NAME…] --format json` | M6 | AI context export (`spec/ai-and-benchmarks.md` §2; `--max-bytes N` defaults to 24000; format `spec/context.schema.json`; exit codes, `--entry` and the failure modes are decision 0072) |
| `mtek grammar export --format ebnf\|gbnf` | M6 (implemented, decision 0073) | grammar export (`spec/ai-and-benchmarks.md` §3); stdout, no project needed |
| `mtek lsp [--stdio]` | M6 | language server over stdio (§7; decision 0076) |
| `mtek --version` | M0 | prints `mtek 0.1.0-dev (language 0.1, runtime ABI 1)` |

`PATH` defaults to the current directory; the project root is the nearest ancestor containing `mtek.toml` (`E9004` if none).

**Exit codes:** `0` success (warnings allowed) · `1` the program has errors · `2` usage error (bad arguments) · `3` internal error (`E9999`) or I/O failure. **Output:** human diagnostics on stderr; `--format json` prints exactly one JSON document (the report of `spec/diagnostics.md` §2.2) on stdout and nothing else on stdout. `mtek check` never touches the GPU; target-device validation is a separate operation (`mtek build` + runtime, blueprint §10).

`mtek build` embeds the runtime bundle compiled into the CLI binary (`mtek-cli/build.rs` reads `packages/runtime-web/dist/runtime.js` and `runtime.dev.js` if present; `release` builds embed the former, which has no development code, and `dev` and `test` builds the latter, decision 0055). A CLI built without it still checks and inspects, but `build` fails with `E9030` explaining how to build the runtime first (`npm run build`). The physics bundle `packages/physics-rapier/dist/physics.js` is embedded the same way but on its own: without it only a program that uses physics fails to build with `E9030` (decision 0063).

What the commands print besides diagnostics, the colour rule for stderr, `--out` resolution, the project search on disk, `E9031` for an output directory that cannot be written, and the embedding mechanics are decision 0032.

## 2. Build modes

| Mode | Differences |
|---|---|
| `release` (default for `build`) | no dev overlay, no hot-reload client, `print` compiled out, warnings like `W8030` disabled |
| `dev` (used by `mtek dev`) | overlay, hot-reload client, `print`, dev-only warnings, `timestamp-query` requested if available |
| `test` | like `dev` without the overlay and reload client; `index.html` does not auto-mount and exposes `window.__mtekMount(options)` (signature in `spec/runtime-abi.md` §6.5) for Playwright; probe shaders emitted when requested by fixtures |
| `preview` (M6) | like `release` plus CPU loop budgets (`--loop-budget N`, default 10 million iterations per frame, valid with this mode only), a manifest that restricts the runtime's network access to `baseUrl`, external `bootstrap.js` and a restrictive Content-Security-Policy (`spec/ai-and-benchmarks.md` §5, decision 0075); the build runs against a 10 s clock (`E9032`) |

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

[assets]                     # see spec/assets.md §6; defaults shown
max_file_bytes = 67108864            # per asset file
max_total_bytes = 268435456          # all packaged assets
max_texture_dimension = 8192         # per image side, at most 8192
max_vertices_per_primitive = 4194304
```

Unknown tables or keys, wrong types and out-of-range values are `E9001` with the exact key path. `host.inputs` targets must name scene state of an exposable type (`E9020`/`E9021`, `spec/runtime-abi.md` §6.3). There is no dependency table in v0.1 (no packages, blueprint §2.3).

## 4. `mtek dev`

- Serves `dist/` on `127.0.0.1:<port>` (loopback only; never `0.0.0.0` unless `--host` is given explicitly) with `Cache-Control: no-store`, correct MIME types (`.js` → `text/javascript`, `.wasm` → `application/wasm`, `.wgsl` → `text/plain`), and the SSE endpoint `/__mtek/events`.
- Watches the project root (excluding `out_dir`, `.git`, `node_modules`) with debounce 50 ms; rebuilds on change (serialised: a change during a build schedules exactly one follow-up build); publishes `build-started`, `build-failed` (diagnostics) and `build-succeeded` (`buildId` and `program: "/app.js?build=<buildId>"`) events as `data: <JSON>` frames (`spec/runtime-abi.md` §11.1). The dev reload client is part of the `index.html` the **compiler** emits in `BuildMode::Dev`; the CLI never patches HTML.
- M1 behaviour: on `build-succeeded` the page reloads fully. From M3: candidate-based hot reload keeps the last valid program running; on `build-failed` the overlay shows the diagnostics over the still-running last valid scene ("last valid preview", blueprint §10).
- Terminal output: one line per build with duration and counts; diagnostics in human format.

What is served before the first successful build, the replay of a failure to new clients, request-path rules and the full MIME table, which file-system events count, the reload client's overlay, the terminal lines, exit codes, shutdown and `--open` are decision 0033.

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

The details these rules leave open are decision 0070 (`spec/decisions/0070-canonical-formatter.md`): where each kind of comment goes, which blank lines are kept, how lines are wrapped at 100 columns, that literals are printed as written, and that imports stay grouped. `mtek fmt [--check] [PATHS…]` takes files and directories (every `.mtek` file below them; the current directory without arguments; no `mtek.toml` is needed). A file that does not parse is reported with its diagnostics (exit 1) and never rewritten; `--check` lists the files that are not canonical on stdout and exits 1 without writing; I/O failures and a formatter defect (`E9999`, the file is untouched) exit 3. The formatter checks its own result on every run (same tree, same comments) and refuses to produce anything else. The naming lint `W0030` of `spec/language.md` §3.3 is not part of §5 and is not implemented by `mtek fmt` in this release.

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
Fixture steps are `step`, `press`, `release`, `set_input`, `expect_state`, `expect_pixel` and `expect_counter`; the `set_input` step (a host input is set, applied at the next frame) and the rules for render-target size, pixel origin and tolerance are fixed by decision 0021 (`spec/decisions/0021-benchmark-task-format.md`).

`mtek test` builds the project in `test` mode, launches the browser harness of `spec/testing.md` §6 (Playwright must be installed; otherwise it reports NOT-RUN and exits 1 unless `--allow-not-run`) and reports per fixture.

The seventh step, `expect_counter` (`{ expect_counter = { drawCalls = 7, culledObjects = { min = 1 } } }`), the other forms of `expect_state` (entity poses and material parameters, vectors, colours, `{ value, tolerance }`), the optional top-level `seed`, the failure kinds, the exit codes (0 pass, or only NOT-RUN with `--allow-not-run`; 1 a fixture failed, the project does not build, a fixture file is invalid, there are no fixtures, or NOT-RUN without the flag; 2 usage; 3 the tool itself failed), NOT-RUN and its reasons, and the JSON report (`--format json`, `spec/test-report.schema.json`) are decision 0074 (`spec/decisions/0074-mtek-test.md`).

## 7. Language server (`mtek lsp`, M6)

- Transport: stdio JSON-RPC (`Content-Length` framing) with the message and protocol types of `lsp-server`/`lsp-types`; `mtek lsp` (or `mtek lsp --stdio`) is the whole launch command; nothing but the protocol is written to stdout. Exit code 0 after `shutdown` and `exit`, 1 without them or when the input is damaged. A payload that is not a message is answered with a JSON-RPC error and the session goes on; a damaged frame ends it.
- Position encoding negotiated at `initialize`: UTF-8 if the client offers it, UTF-16 (the protocol's default) otherwise; conversions are the compiler's own and exact for multi-byte and astral characters and CRLF.
- Features (basic LSP, blueprint §10): publish diagnostics (from the compiler's front end, debounced 150 ms after the last change, over the editor's unsaved buffers through the in-memory file system; the diagnostics of the whole project, to the file each is in); hover (type and doc comment; registry docs for prelude names); go-to-definition (including imports; the standard library as virtual read-only documents of the scheme `mtek-prelude:`, served by the LSP 3.18 request `workspace/textDocumentContent`); completion (scope names, schema fields after `Name {`, members after `Key.` and every other `Name.`, intrinsics; all from the registry and resolver); code actions (one quick fix for every validated suggested edit of `spec/diagnostics.md` §6, as one `WorkspaceEdit`).
- The LSP calls the same compiler service as the CLI; there is no second semantic implementation.
- What the server does with unsaved text, what it publishes for files that are not open or not in a project, the contexts of completion, the layout of the virtual documents, the capabilities it advertises and the ones it does not, how it survives garbage and its own defects, and the ambiguous points decided (UTF-8 whenever offered, diagnostics for every file of the project) are decision 0076 (`spec/decisions/0076-language-server.md`).

## 8. VS Code extension (`packages/editor-vscode`, M6)

LSP client launching `mtek lsp` (path configurable, default `mtek` on `PATH`; no other settings: decision 0076 item 12 lists what the client provides, including a content provider for the `mtek-prelude` scheme), TextMate grammar for highlighting (generated from the keyword and token lists of `spec/grammar.ebnf` by a script and checked against the corpus for no crashes), language configuration (comments, brackets, auto-closing). Packaged with `@vscode/vsce` as a `.vsix` in CI artefacts; publishing to a marketplace is out of scope for v0.1.

## 9. Development overlay (dev builds, M4)

Fixed panel in a corner of the canvas: active scene, selected entity (cycled with a key combination documented in the panel), its source declaration (`file:line`), frame time (ms, p50/p95 over the last 120 frames), draw calls, culled objects, upload bytes, pipelines created, live resource counts, discarded fixed steps, and the latest validation errors. Toggled with `` ` ``. Not present in release builds. The key to cycle the entity, the exact lines and how the release runtime is kept free of this code are decision 0055.
