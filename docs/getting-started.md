# Getting started with Mtek

This page takes you from an empty machine to a running Mtek program, then breaks it on purpose,
reads the error and repairs it. It is the M6 exit gate of the project: *a new user can install the
toolchain, run a documented example, break it, understand the error and repair it.*

Mtek is **pre-alpha**. There is no installer and no package registry release: you build the
toolchain from a checkout of the repository (section 2), and that is the only install path this page
describes.

The page is executable. `crates/mtek-cli/tests/getting_started.rs` reads this file, creates an empty
temporary directory, runs every command in the `console` blocks against the real `mtek` binary,
applies every `diff` block, and fails if the text printed here is not what the tool prints. How that
works, and what it normalises, is in the maintenance note at the end.

## 1. Prerequisites

| You need | Version | What for |
|---|---|---|
| Rust, installed with [rustup](https://rustup.rs) | **1.99.0** (rustup installs it by itself from `rust-toolchain.toml`) | building the `mtek` command line tool |
| Node.js with npm | **24** (`.nvmrc`) | building the runtime bundle that is embedded into `mtek`; not needed to use `mtek` afterwards, except for `mtek test` |
| A browser with WebGPU | Chromium (the one the project's tests use) | seeing the program run |

`mtek check`, `mtek build`, `mtek fmt` and the editor-facing commands never touch the GPU. Only
*looking* at the result needs a browser with WebGPU. Without one the page still opens, but it shows
**Mtek could not run this program** and a runtime diagnostic: `MTEK-E8004` (`WebGPU unavailable`, the
browser has no `navigator.gpu`) or `MTEK-E8005` (`no suitable adapter`, it has WebGPU but found no
GPU). Everything in sections 3 to 5 and 8 to 11 works the same on such a machine, and the build
errors of section 9 are shown in the page either way. Only Chromium is tested; another browser may
work and is not covered by this page. WebGPU needs a secure context, which `http://127.0.0.1` is.

This page was written on Windows 11. The command line parts are run on Windows and Ubuntu by the
project's CI. macOS is not tested.

## 2. Install (from source)

From the root of the checkout:

```sh install
npm ci
npm run build
cargo install --path crates/mtek-cli --locked
```

* `npm ci` installs the exact locked npm dependencies.
* `npm run build` bundles the runtime (`packages/runtime-web/dist/`) and then builds the tool with
  `cargo build -p mtek-cli --locked`. The runtime bundle is compiled **into** the `mtek` binary
  when it is built, which is why it has to exist first.
* `cargo install` builds the same crate in release mode (it embeds the same bundle) and copies
  `mtek` into Cargo's bin directory (`~/.cargo/bin`, which rustup puts on your `PATH`).

If you only want to try it, the second step is enough: the tool is then `target/debug/mtek`
(`target\debug\mtek.exe` on Windows) in the checkout; call it by that path or add `target/debug` to
your `PATH`. If you build the tool **without** the runtime bundle (for example `cargo build` in a
fresh checkout, before `npm run build`), `mtek check` still works but `mtek build` and `mtek dev`
fail with `MTEK-E9030` and tell you to run `npm run build` first.

Check that the tool runs:

```console
$ mtek --version
mtek 0.1.0-dev (language 0.1, runtime ABI 1)
```

The rest of this page writes plain `mtek`.

## 3. Create a project

```console
$ mtek new hello-mtek
created 'hello-mtek' with the Demo scene (mtek.toml, src/main.mtek, .gitignore)
```

```console
$ cd hello-mtek
```

A project is a directory with a `mtek.toml`. The tool finds it by looking in the current directory
and then upwards, so you can run every command below from any directory inside the project.

```toml file=mtek.toml
[project]
name = "hello-mtek"
language = "0.1"
entry = "src/main.mtek"
scene = "Demo"

[build]
target = "web"
title = "Hello Mtek"

[host.inputs]
tint = "Demo.tint"
```

`[host.inputs]` makes the scene's `tint` state settable from the web page that embeds the program.
`src/main.mtek` is the program:

```mtek file=src/main.mtek
fn pulse(t: f32) -> f32 {
    return 0.65 + 0.35 * sin(t);
}

material Pulse {
    param tint: color = #6b5cff;
    param phase: f32 = 0.0;

    fragment(input: SurfaceInput) -> color {
        return color.linear(tint.rgb * pulse(phase), tint.a);
    }
}

scene Demo {
    state speed: f32 = 0.7;
    state tint: color = #6b5cff;

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.5, 0.0);
    }

    entity Cube {
        mesh: Box { size: vec3(1.0, 1.0, 1.0) };
        material: Pulse { tint: bind(tint); phase: bind(frame.time) };
        position: vec3(0.0, 0.5, 0.0);
        rotation: quat.identity();

        update(dt: f32) {
            self.rotation *= quat.axis_angle(vec3(0.0, 1.0, 0.0), speed * dt);
        }
    }

    on key_down(Key.Space) {
        speed = -speed;
    }
}
```

Read it top to bottom:

* `pulse` is an ordinary function. The material calls it, so it runs on the GPU.
* `material Pulse` has two parameters and a `fragment` stage that returns the colour of a pixel.
* `scene Demo` is the thing that runs. `state` is data the scene owns and that survives edits while
  the program runs. The `Cube` entity has a box mesh, the material (`bind(...)` re-reads a value every
  frame) and an `update` function that turns it by `speed * dt` radians each frame.
* `on key_down(Key.Space)` reverses the rotation.

## 4. Check it

`mtek check` parses and type-checks the project. It needs no GPU and no runtime bundle.

```console
$ mtek check
checked 'hello-mtek': 0 errors, 0 warnings
```

## 5. Build it

```console runtime
$ mtek build
built 'hello-mtek' (release): 9 files in dist, build <build id>; 0 errors, 0 warnings
```

The build id (16 hex digits) identifies the content of the build: the same sources and the same
compiler give the same id. The files are in `dist/`:

```text files=dist
app.d.ts
app.js
app.js.map
index.html
program.manifest.json
runtime.<hash>.js
runtime.d.ts
shaders/<hash>.mtek-map.json
shaders/<hash>.wgsl
```

`index.html` is a page with a canvas, `app.js` is your program as a JavaScript module,
`runtime.<hash>.js` is the runtime that drives the GPU, `shaders/` holds the WGSL generated for the
material, and `program.manifest.json` tells the runtime what the program needs. `<hash>` stands for
16 hex digits derived from the file's content.

`dist/` is plain static files, but there is no `mtek serve` command, and a browser will not load
the page's module scripts from a `file:` address. To look at a release build, serve `dist/` with
any static file server. The next section uses the server that comes with `mtek`.

## 6. Run it with the development server

```console runtime background
$ mtek dev
mtek dev: serving http://127.0.0.1:5173/ (Ctrl+C to stop)
built 'hello-mtek' (dev): 9 files in dist, build <build id>; 0 errors, 0 warnings (<n> ms)
```

`mtek dev` builds the project in development mode, serves `dist/` on `http://127.0.0.1:5173/` (the
next free port, up to 5192, if 5173 is taken, and it says so), and watches the project. Note that it
overwrites `dist/` with the development build, which contains an overlay and a reload client; run
`mtek build` again before you deploy anything.

Open <http://127.0.0.1:5173/> in a browser with WebGPU. You see a cube, rotating about the vertical
axis and pulsing in colour, with a statistics panel in the corner (the backtick key hides and shows
it; Space reverses the rotation). The browser console may log one `404` for `/favicon.ico`; a build
does not contain one.

## 7. Edit it

Make the cube twice as wide. Change one line of `src/main.mtek`, with your editor or any other way:

```diff path=src/main.mtek role=edit
-        mesh: Box { size: vec3(1.0, 1.0, 1.0) };
+        mesh: Box { size: vec3(2.0, 1.0, 1.0) };
```

Within a moment the terminal running `mtek dev` prints a new line:

```console watch
built 'hello-mtek' (dev): 9 files in dist, build <build id>; 0 errors, 0 warnings (<n> ms)
```

The cube in the browser is now wide, and the **page was not reloaded**: the program was rebuilt, the
new version was checked by the browser, and then swapped in while the old one ran. Values the running
program owns, the `state` of the scene and the pose of the cube, are carried over instead of being
reset. The consequence to know about: changing the initial value of a `state` does not change the
running scene. Set `state speed: f32 = 0.0;` and the cube keeps turning until you reload the page.
(The rules for what is carried over, and for the changes that restart the scene instead, are
`spec/runtime-abi.md` section 11.3.) Put the line back to `0.7` and reload the page before you go on.

## 8. Break it

Delete the semicolon at the end of the `return` statement in `pulse`:

```diff path=src/main.mtek role=break
 fn pulse(t: f32) -> f32 {
-    return 0.65 + 0.35 * sin(t);
+    return 0.65 + 0.35 * sin(t)
 }
```

## 9. Read the error

The terminal running `mtek dev` prints the diagnostic and a summary line. The summary goes to
standard output and the diagnostic to standard error; a terminal shows them together, in this order:

```console watch
error[MTEK-E1003]: Missing `;` at the end of the `return` statement, found `}`.
 --> src/main.mtek:2:32
  |
2 |     return 0.65 + 0.35 * sin(t)
  |                                ^ expected `;`, found `}`
  = help: end every statement, field and declaration with `;`

build failed: 1 error, 0 warnings (<n> ms)
```

The browser shows the same diagnostic over the page (the overlay lists file, line and column, the
code and the message, and each note after `=`, but not the source line):

```text overlay
mtek: build failed

src/main.mtek:2:32: error[MTEK-E1003]: Missing `;` at the end of the `return` statement, found `}`.
  = help: end every statement, field and declaration with `;`
```

The overlay is drawn over the page; it does not replace the last version that built
(`spec/tooling.md` section 4: "last valid preview"). Fixing the file removes it by itself.

Read the diagnostic from the top:

* `error[MTEK-E1003]` is the severity and the **code**. Every code has an entry in
  [`spec/diagnostics.md`](../spec/diagnostics.md) (here `#mtek-e1003`) that says what triggers it.
* The message says what is wrong in a sentence: a `;` is missing at the end of a `return`
  statement, where a `}` was found instead.
* ` --> src/main.mtek:2:32` is the place: file, line 2, column 32, which is just after `sin(t)`.
  Paths are relative to the project.
* The framed lines show that line, with `^` under the place and what the parser expected and found.
* `= help:` says how to repair it.

In a second terminal, in the project directory, `mtek check` prints the same thing and exits with
code `1`. The exit codes are `0` (no errors, warnings allowed), `1` (the program has errors), `2` (the
command line was wrong) and `3` (an internal error or a file the tool could not read or write).

```console exit=1
$ mtek check
error[MTEK-E1003]: Missing `;` at the end of the `return` statement, found `}`.
 --> src/main.mtek:2:32
  |
2 |     return 0.65 + 0.35 * sin(t)
  |                                ^ expected `;`, found `}`
  = help: end every statement, field and declaration with `;`

check failed: 1 error, 0 warnings
```

### The suggested edit

For a few kinds of error the compiler also proposes an exact repair. It proposes one only after it
has applied it to a copy of your project and checked that the error is gone and no new error
appeared. The human output above does not print it; the JSON report does:

```console exit=1 excerpt
$ mtek check --format json
...
      "code": "MTEK-E1003",
      "severity": "error",
...
      "suggestedEdits": [
        {
          "description": "insert the missing `;`",
          "edits": [
            {
              "file": "src/main.mtek",
              "startByte": 57,
              "endByte": 57,
              "replacement": ";"
            }
          ]
        }
      ],
...
```

That says: at byte 57 of `src/main.mtek` (the start of the file is byte 0), which is the same
place as line 2, column 32, insert `;`. Editors turn such edits into quick fixes
(`mtek lsp`, `spec/tooling.md` section 7); an editor integration is a separate document. There is
**no `mtek fix` command**: you apply the edit yourself.

## 10. Repair it

Put the semicolon back:

```diff path=src/main.mtek role=fix
 fn pulse(t: f32) -> f32 {
-    return 0.65 + 0.35 * sin(t)
+    return 0.65 + 0.35 * sin(t);
 }
```

This is exactly what the suggested edit says; the walkthrough test applies that edit from the JSON
report and checks that it produces the same file as this change. The development server rebuilds and
the overlay goes away:

```console watch
built 'hello-mtek' (dev): 9 files in dist, build <build id>; 0 errors, 0 warnings (<n> ms)
```

Stop the development server with Ctrl+C in its terminal.

<!-- walkthrough:stop -->

Confirm that the project checks and builds again:

```console
$ mtek check
checked 'hello-mtek': 0 errors, 0 warnings
```

```console runtime
$ mtek build
built 'hello-mtek' (release): 9 files in dist, build <build id>; 0 errors, 0 warnings
```

## 11. Where to go next

* `mtek fmt` rewrites `.mtek` files into the one canonical layout; with `--check` it only lists the
  files that are not canonical and exits `1` if there are any. Your edited project is canonical:

  ```console
  $ mtek fmt --check
  checked 1 file: all formatted
  ```

* `mtek test` runs the declarative fixtures in a project's `tests/*.test.toml` in a browser
  (`examples/pulse-cube` has three; this project has none, so `mtek test` here exits `1` and says
  so). It needs Playwright and a GPU. A fixture that cannot run is reported `NOT-RUN` and the
  command fails, never passes (`spec/tooling.md` section 6, [`README.md`](../README.md)).
* `mtek context --entry src/main.mtek --format json` exports the language and your project as
  JSON for an AI agent; `mtek inspect --ir` shows what the compiler made of your program.
* [`examples/`](../examples) has three larger programs: a configurator with a generated chair,
  a physics playground, and `pulse-cube`, which is this project.
* [`spec/`](../spec/README.md) is the language specification. Every diagnostic code is in
  [`spec/diagnostics.md`](../spec/diagnostics.md).

## Troubleshooting

| You see | Because | Do |
|---|---|---|
| `MTEK-E9004` | there is no `mtek.toml` in the current directory or above it | `cd` into the project |
| `MTEK-E9030` from `mtek build` or `mtek dev` | the `mtek` binary was built before the runtime bundle existed | `npm run build`, then rebuild the tool |
| `mtek dev: port 5173 is in use; using port 5174` | another program holds the port | open the URL it prints, or pass `--port N` |
| the page says **Mtek could not run this program** | no WebGPU (`MTEK-E8004`, `MTEK-E8005`) | use a Chromium with WebGPU enabled; compile errors still show |

## Maintenance note

* **What is tested.** `crates/mtek-cli/tests/getting_started.rs` (run by `cargo test --workspace
  --locked`, in the `rust` CI job on Ubuntu and Windows and again in the `node` job with the runtime
  bundle). It walks this file in order, in a fresh temporary directory:
  * ```` ```console ```` blocks: the line starting with `$ ` is the command (`mtek ...`, run with
    the binary cargo built, or `cd DIR`); the other lines are the expected output, standard output
    and standard error written to one file, as a terminal shows them. `exit=N` is the expected exit
    code (default `0`). `excerpt` means the lines must appear in the output in this order, with `...`
    standing for anything. `background` starts a server that stays up; `watch` (no command) waits for
    these lines to appear next in its output. `runtime` marks a step that needs the runtime bundle.
  * ```` ```diff ```` blocks: lines starting with `-` and ` ` (the context) must occur exactly once
    in the file, and are replaced by the lines starting with `+` and ` `.
  * Blocks with `file=PATH` must equal that file exactly; `files=DIR` lists the files below `DIR`;
    `overlay` is the text the reload client shows, checked against the server's `build-failed`
    event.
  * The `sh install` block is checked against `package.json` and `crates/mtek-cli/Cargo.toml`, and
    the versions in section 1 against `rust-toolchain.toml` and `.nvmrc`; every relative link must
    exist; the troubleshooting table's `MTEK-E9004` and port line are produced by the real tool.
    The comment `walkthrough:stop` stops the development server.
* **What is normalised, and nothing else.** Colour escape sequences and `\r\n` line ends; a build id
  (`build` and 16 hex digits) is `<build id>`; a duration in milliseconds is `<n> ms`; the port
  (the test picks a free one and passes `--port`) is `5173`; 16-hex-digit file name parts are
  `<hash>`. No absolute path appears in any output; the test fails if one does.
* **What the test cannot do.** It does not open a browser, so it cannot see the cube; the HTML,
  the build events and the overlay text come from the server and are checked against what the
  page's reload client is given. A browser spec (`tests/browser/specs/m6/getting-started.spec.ts`)
  runs the same edit, break and repair against a real page when a WebGPU adapter exists and is
  reported `NOT-RUN` otherwise. The steps marked `runtime` run only in a configuration where the
  runtime bundle is embedded; without it the test says `NOT-RUN` for each of them, and checks that
  the real tool fails with `MTEK-E9030` there.
* **Human testing.** No human tester was available when this page was written, so it has been
  exercised only by the scripted test and by its author. See
  [`spec/decisions/0091-getting-started-walkthrough.md`](../spec/decisions/0091-getting-started-walkthrough.md)
  for the checklist a person should follow.
