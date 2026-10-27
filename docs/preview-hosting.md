# Hosting untrusted Mtek previews

Mtek programs written by someone you do not trust (typically a model) can be built with
`mtek build --mode preview` and shown in a browser. This page says what that mode does, what it does
**not** do, and what the host that embeds the result has to do. The design record is
`spec/decisions/0075-untrusted-preview-mode.md`; the spec is `spec/ai-and-benchmarks.md` section 5.

**The short version.** A correct compiler is not a sandbox. Preview mode stops a program from
*spinning* (a loop that never ends cannot hang the page) and from *fetching* (the runtime asks for
nothing outside the build's own directory, and the page's policy refuses the rest of what a script
could try). It does not stop a program from using memory, GPU time or the page's authority. Isolation
is the host's job: put the preview on its own origin, in a sandboxed iframe, with a watchdog.

## What `--mode preview` gives you

```text
mtek build --mode preview [--loop-budget N] [--out DIR] [PATH]
```

* **A loop budget.** Every iteration of every CPU loop of the program (`for a..b`, `for x in array`;
  Mtek has no `while`, no recursion and nothing a program can use to catch a failure) first decrements
  a per-frame counter. The counter is refilled at the start of every frame and before `init` with the
  budget, **10 million iterations by default**, summed over every handler, fixed step, `update` and
  binding of that frame. When it goes below zero the runtime stops the program where it stands:
  it reports `E8080` ("execution budget exceeded") **at the loop** (file, line, column), **stops the
  scene** (no further frame is requested) and shows the failure overlay. A loop in `init` makes
  `mountMtek` reject with kind `budget-exceeded`. Measured: a nested loop of 2 billion iterations
  stops after about 0.65 s of main-thread time at the default budget, 15 ms at `--loop-budget 12345`;
  a loop that really does work (200 000 iterations of floating-point maths per frame) runs at 1.02
  times the speed of a release build.
  The budget is set by whoever runs the compiler (`--loop-budget N`, N at least 1); a project file
  cannot raise it. It is recorded in the build (`program.manifest.json`: `"preview": { "loopBudget": N }`).
* **A runtime that stays at home.** Because of that manifest key the runtime refuses every request
  (`fetch`, asset bytes, the physics and animation modules' `import()`s) whose URL is not below the program's
  `baseUrl`: same scheme, host and port, a path under it after `.` and `..` are resolved, no
  credentials, no encoded dots or slashes. The refusal happens before the request is made and is
  reported by the code of the thing that failed to load. The compiler never produces such a URL; the
  guard exists so that nothing else can.
* **A policy page and an external script.** `index.html` has no script of its own, only
  `<script type="module" src="./bootstrap.js">`, and carries this policy in a `<meta>`:

  ```text
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self';
  img-src 'self' blob:; style-src 'self' 'unsafe-inline'
  ```

  The browser then refuses requests to other origins, `eval` and `new Function`, inline scripts, and
  images from other origins. `'wasm-unsafe-eval'` is there because the physics module is WebAssembly;
  it does not allow JavaScript `eval`. Without it a program with physics bodies cannot start (tested).
* **Compile limits.** A source file over 4 MiB (`E0004`), more than 1 024 modules (`E9002`), nesting
  deeper than 256 levels (`E1050`) and more than 16 384 static entities (`E5092`) are diagnosed, never
  a crash; these apply in every mode. A preview build also has a **10 second clock**: a build that is
  not finished by then ends with `E9032` and writes nothing.

## What it does **not** give you

Read this part twice.

* **It is not a sandbox.** The page, the program's scripts and the runtime share one origin, one event
  loop and one GPU. If the preview is served from your application's origin, the program's JavaScript
  (the compiler's output is trusted code, but a bug in it or in the runtime is not covered by this
  page) has the origin's cookies, storage and network position. Nothing in `--mode preview` changes
  that.
* **The budget counts loop iterations, not time and not memory.** 10 million iterations of a heavy
  body take long; a loop of a few thousand iterations that allocates arrays can use a lot of memory;
  a program can create entities up to the scene's limit; none of that is bounded by the budget.
  There is no wall-clock watchdog inside the page, because code that is stuck cannot run one.
* **GPU work is not bounded.** A very heavy shader, a huge draw count or a tiny frame time on a slow
  device is the browser's and the driver's problem. A lost device is recovered or reported as usual.
* **The policy is a `<meta>`.** A meta policy cannot express `frame-ancestors`, `sandbox` or
  `report-uri`/`report-to`, and a policy that arrives with the page cannot protect the page against
  the page that was served without it. Send the same policy, and more, as a **response header**.
* **The compile time limit is the command line tool's.** If you link the compiler as a library you
  must run it on a thread you can abandon, with a deadline of your own.
* **The build output is not signed.** Whoever can write to the output directory can write anything
  there; serve previews from storage only the build can write to.

## What the host must do

1. **Serve previews from an isolated origin**, a separate registrable domain (not a subdomain of
   your application), with no cookies, no credentials and nothing in storage on it. A preview that
   can reach your application's origin can use your users' sessions.
2. **Embed them in a sandboxed iframe**: `sandbox="allow-scripts"` and **without
   `allow-same-origin`**, so the frame gets an opaque origin of its own. Do not add
   `allow-top-navigation`, `allow-popups` or `allow-forms`. Allow WebGPU explicitly where the
   browser needs it (`allow="..."` for features the frame uses).
3. **Send response headers** for the preview origin, in addition to the `<meta>`:

   ```text
   Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self';
                            img-src 'self' blob:; style-src 'self' 'unsafe-inline';
                            frame-ancestors https://your-app.example; base-uri 'none'; form-action 'none'
   X-Content-Type-Options: nosniff
   Referrer-Policy: no-referrer
   Cross-Origin-Resource-Policy: same-origin
   ```

   Serve `.js` as `text/javascript` and `.wasm` as `application/wasm`. Keep `'self'`-only
   `connect-src`: a preview needs no other network.
4. **Run a watchdog.** The budget ends a runaway loop, but a heavy frame, an allocation spiral or a
   driver stall can still freeze a frame loop. Have the page (or a small script you serve next to it)
   send a `postMessage` heartbeat from a `requestAnimationFrame` loop and kill the iframe (remove it,
   or navigate it to `about:blank`) when the heartbeat stops for a few seconds. A frame that is
   really stuck is removed by the browser's own "page unresponsive" handling only after a long time;
   your timer is faster. Count restarts and stop serving a preview that keeps being killed.
5. **Limit what a preview can cost.** One preview per user at a time, a cap on page weight and on the
   size of the build, a time limit on the whole session, and a cap on how many builds a user may start
   (each build is a compile of untrusted source: the 4 MiB, 1 024-module, nesting and 10 s limits above
   bound one build, not the number of them).
6. **Never run package lifecycle hooks while building untrusted source.** Mtek has none and a project
   cannot execute code at compile time; keep it that way in whatever wraps the compiler (no
   `npm install` of the project's dependencies, no scripts from the project directory). Run the
   compiler with no network and no access to anything but the project and an output directory.
7. **Treat the diagnostics as untrusted text.** `E8080` and every other diagnostic carry names and
   messages that come from the program. Show them as text, never as HTML (the runtime's overlay does
   this with `textContent`).

## Checking your setup

A quick way to see the browser's half working is the `csp.spec.ts` spec of this repository
(`tests/browser/specs/preview/`): it opens a preview, tries a request to another origin, `eval`, an
inline script and a foreign image from the page, and requires each to be refused and the other origin
to see no request. The same spec removes `'wasm-unsafe-eval'` to show that a physics program then
fails to start. Run the same probes against your own deployment, including your response headers and
the sandbox attribute, with `securitypolicyviolation` listeners and your browser's console.

## What happens when a preview fails

| What | How it shows |
|---|---|
| A loop past the budget during a frame | `E8080` at the loop in the overlay and in `onDiagnostic`; `app.state` is `"failed"`; no more frames |
| A loop past the budget during `init` | `mountMtek` rejects, `error.kind === "budget-exceeded"`, `E8080`, the overlay |
| A request outside `baseUrl` | the load that asked fails with its own code (`E8051`, `E7030`, `E8102`, `E8114`, `E8006`) and a message that starts `refused <url>` |
| A build that takes more than 10 s | `E9032`, exit code 1, nothing written |
| The browser refuses something under the policy | a `securitypolicyviolation` event on the document and a console error; Mtek does not see it |
