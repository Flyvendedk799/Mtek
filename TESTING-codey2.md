# Testing the codey2 small-game work (branch `feat/sgs-codey2`)

Written for Abe. Heavy suites, browser runs and GPU runs were **not** run on this branch; only cheap
checks were (`cargo check`/`clippy`/`fmt`, `tsc`, `eslint`, a few targeted `cargo test` binaries and the
runtime's vitest unit tests). Everything below says what to run, what to look for, and what passing
and failing look like.

Toolchain: Rust 1.99.0 (rustup, `rust-toolchain.toml`), Node 24 (`.nvmrc`; 22.18+ should work too).

## 0. Whole-branch gate

| Run | Pass | Fail means |
|---|---|---|
| `npm ci && npm run build` | exit 0 | toolchain or dependency problem |
| `npm run check` | exit 0 (includes the new `check:prebuilt`) | formatting, clippy, tsc, lint, naming, or a stale prebuilt runtime (run `npm run build && npm run prebuilt:write`) |
| `cargo test --workspace --locked` | all green | a regression; the new tests are listed per feature below |
| `npm run test:unit` | all green | runtime/tool unit regression |
| `npm run check:coverage` and `npm run check:release` | "every assertion holds" / no mismatch | a doc table or count out of date (`npm run generate -w @mtek/coverage-matrix`, `npm run generate -w @mtek/release-docs`) |
| `npm run test:browser` (software project at least) | no new failures vs `main` | see the browser checks per feature |

## 1. Phase 3: Audio (`spec/audio.md`, decision 0130)

Automated (cheap, already green here):
- `cargo test -p mtek-compiler --lib assets::audio` (header sniffing), `--test assets` (`the_audio_project_packages_its_sounds_byte_for_byte`), `--test fixtures` (fixtures `tests/assets/{pass,fail}/*audio*`, `tests/assets/fail/e7102_truncated_wav`, `tests/semantics/fail/e5501_audio_argument_out_of_range`), `--test stdlib_registry`, `--test stdlib_schema`.
- `npx vitest run src/audio` in `packages/runtime-web` (6 tests: unlock, remembered music, clamping W8201, decode failure W8202, mute/volume, positional).
- `node scripts/gen-sounds.mjs --check` (the generated WAVs are deterministic).

Manual, in a browser with WebGPU (Chrome; then Firefox and Safari 26 if you can):
1. `cargo run -p mtek-cli -- dev examples/arcade-audio --open`.
2. Before clicking or pressing anything: silence (autoplay is blocked). Expected, not a bug.
3. Press **Space**: a short hit sound, panned to the side the orange ball is on (use headphones; left when the ball is left). The ball grows briefly.
4. Press **S** several times: a rising "score" blip, a semitone higher each time; the yellow bar grows.
5. Press **M**: looping music starts; **M** again stops it. Press M *before* any other input on a fresh load: the music starts at once (M is the unlocking gesture).
6. Press **N** or click the green box in the top-left corner: everything mutes and the box turns red; again to unmute.
7. **ArrowDown/ArrowUp**: global volume down/up; the green box's height follows.
8. Dev console / overlay: no `MTEK-W8201`/`W8202` warnings during normal use.
- Fail: no sound after a key press; sound before any gesture with an autoplay console error; music not looping; mute not muting music.
- `mtek test examples/arcade-audio` (hardware project, needs a GPU): the fixture `keys-drive-audio-state` passes (state only; it does not hear anything).

Negative checks: `mtek check tests/assets/fail/e7101_unsupported_audio` → `E7101` twice (a `.flac`, and an `.mp3` that is really a WAV); `tests/assets/fail/e7102_truncated_wav` → `E7102`; `tests/semantics/fail/e5501_audio_argument_out_of_range` → three `E5501`.

Known limits: after a hot reload the positional listener stays the first world's camera; no streaming.

## 2. Phase 8.1: Prebuilt runtime, Node floor (decision 0131)

1. Fresh clone, **no Node on PATH**: `cargo build -p mtek-cli --locked`, then `./target/debug/mtek build examples/physics-playground`. Pass: "built ... 0 errors" and `dist/physics/` exists. Fail: `MTEK-E9030`.
2. In a checkout with `npm run build` done: `cargo test -p mtek-cli --bin mtek runtime::` passes (embeds `dist/`), and `cargo test -p mtek-cli --test prebuilt` passes.
3. Edit any file under `packages/runtime-web/src`, then `npm run check:prebuilt` → fails with "sources changed"; `npm run build && npm run prebuilt:write` → passes again.
4. Node 22.18+: `nvm use 22.18 && npm ci && npm run build && node scripts/prebuilt-runtime.mjs --check --against-dist` → passes (here: bundles were byte-identical to Node 24's). Node 22.17 or older: `npm ci` refuses (engine-strict). Full suite on Node 22 was **not** run.
5. CI: the Rust job now embeds the prebuilt runtime (no npm build before cargo), so the `#[cfg(mtek_runtime_embedded)]` tests run there too; check the job is still green.

## 3. Phase 8.2: Browser support (decision 0132, `spec/browser-support.md`)

Automated: `npx vitest run src/host/browser-support.test.ts src/host/overlay.test.ts src/host/app.test.ts` (packages/runtime-web); browser: `npm run test:browser -- --project=software specs/m1/failures.spec.ts` (the E8004 case now also checks the panel).

Manual:
1. Chrome with WebGPU off (`--disable-features=WebGPU`, or chrome://flags) on any example: the page shows **"This browser cannot show this game"** with steps, then the usual "Mtek could not run this program" and `MTEK-E8004` below.
2. Serve over plain http from another machine's IP (not localhost): the first step says to use https.
3. **Firefox** (Windows 141+ / Apple-silicon Mac 147+): examples render. On Linux without the pref: the panel names `dom.webgpu.enabled`. With `MTEK_EXPERIMENTAL_BROWSER=firefox npm run test:browser -- --project=firefox`: compare with `evidence/M7/environments/windows11-rx7900xtx-firefox-155` — `m4/resilience-resize.spec.ts` "a zero-sized canvas …" should now **pass** (was "Dimension X is zero"). The CDP-only and baseline failures remain (test-side).
4. **Safari 26** (macOS 26 / iOS 26): open `examples/pulse-cube` and `examples/arcade-audio` via `mtek dev` (localhost) or https. Pass: renders, sound works after a tap. Safari < 26: the panel asks to update. No automated Safari evidence exists.
5. `MTEK_EXPERIMENTAL_BROWSER=webkit npm run test:browser -- --project=webkit`: records whatever Playwright WebKit offers; expected NOT-RUN/no adapter on Linux and Windows. Not evidence for Safari.
6. Regression risk to watch on Chrome: resizing a canvas to 0×0 and back (the context is now unconfigured and reconfigured): `m4/resilience-resize.spec.ts` must stay green on `hardware` and `software`.

## 4. Phase 1.1: String interpolation (decision 0133, `spec/language.md` §5.8)

Automated (cheap, already green here):
- `cargo test -p mtek-compiler --test fixtures --test lexer_fixtures --test grammar_model --test diagnostics_catalogue`. The new fixtures are `tests/syntax/lex/{interpolation,fail_interpolation}`, `tests/syntax/ast/interpolation`, `tests/syntax/pass/StringInterpolation.mtek`, `tests/syntax/fail/{e1001_empty_interpolation,e0024_unclosed_interpolation}`, `tests/semantics/pass/string_interpolation` and `tests/semantics/fail/{e3501_value_not_interpolatable,e3502_invalid_format_spec,e3502_precision_on_integer}`.
- `cargo test -p mtek-cli --test grammar` (the GBNF still derives from the model with the new `\$` escape).
- `npx vitest run src/math/format.test.ts src/math/operations.test.ts` in `packages/runtime-web`.

By hand (no GPU needed):
1. `mtek build tests/semantics/pass/string_interpolation --mode dev --out /tmp/si`. Then look at `/tmp/si/app.js`. Pass: the strings are joined with `+`, each value goes through `rt.fmt(value, "<type>", <precision>)`, and `\${literal}` became the text `${literal}`.
2. `mtek check` on each fail fixture above. Pass: exactly the code in its `expected.diag.json`, with the caret under the expression (`E3501`) or the spec (`E3502`).
3. `const S: string = "a${1}";` gives `E3090` ("an interpolated string, which is formatted at run time").
4. `mtek fmt` on `tests/syntax/pass/StringInterpolation.mtek` leaves the file unchanged.

In a browser (dev mode, any WebGPU browser): add `print("t=${frame.time:.2} at ${vec3(1.0, 2.0, 3.0)}");` to an `update`. Pass: the console shows `t=0.02 at (1.0, 2.0, 3.0)` and similar lines. Fail: `[object Object]`, `undefined`, or `NaN` for a finite value. `print` is removed in release builds, as before.

Not done: the formatting is not covered by a browser test.

## 5. Phase 1.2: HUD (decision 0134, `spec/hud.md`)

Automated (cheap, already green here):
- `cargo test -p mtek-compiler --test fixtures` covers `tests/semantics/pass/hud_text_rect_button`, `tests/semantics/fail/e5601_hud_size_out_of_range` (three `E5601`) and `tests/syntax/pass/HudCalls.mtek`.
- `--test stdlib_registry` includes `the_hud_namespace_has_its_overloads`.
- `--test stdlib_schema` checks that `spec/stdlib-schema.json` has the `hud` namespace.
- `npx vitest run src/hud` in `packages/runtime-web` (7 tests: element reuse, removal, click reported once, unclaimed click dropped, 512-item cap with one `W8203`, size clamping, linear to sRGB, dispose).
- The host and scene vitest suites (`src/host`, `src/scene`) were **not** run here; they took over 5 minutes and were stopped. Run them: `npx vitest run src/host src/scene` in `packages/runtime-web`. Pass: all green. The wiring touched `scene/world.ts` (`ctx.hud`, CONTEXT_MEMBERS), `host/app.ts` (phase 1 `beginFrame`, phase 7 `present`, dispose) and `host/mount.ts` (creates the `HudSystem` when there is a document).

Manual, in a WebGPU browser:
1. `cargo run -p mtek-cli -- dev examples/hud-score --open`.
2. Expected at first:
   - top left: "Score: 0" in white;
   - top right: "Best: 0" in yellow;
   - under the score: a green bar on a dark track that shrinks over 30 s, with "29.9 s" style text under it;
   - bottom centre: a "Reset" button;
   - a rotating blue cube.
3. **Space**: the score goes up by one and the cube pulses. "Best" follows.
4. Click **Reset**: the score and the timer restart (exactly one reset per click). Clicking the button must not count as a canvas click. After clicking, Space must still score; it should not "press" the button again.
5. Wait 30 s. The bar is empty, and a translucent dark panel appears with:
   - "GAME OVER" in red;
   - "N points";
   - a **Play again** button.
   The bottom "Reset" button is gone, and Space no longer scores. Clicking **Play again** (once) or pressing **R** starts a new round, and the panel disappears.
6. Resize the window: the HUD stays in the same corners of the canvas. Text size stays in CSS pixels.
7. DevTools → Elements: one `div[data-mtek-hud]` after the canvas. It has `div[data-mtek-hud-text]`, `div[data-mtek-hud-rect]` and `button[data-mtek-hud-button]` children, and they are **not** re-created every frame (no flashing in the Elements panel except changed text).
8. `mtek test examples/hud-score` (hardware project, needs a GPU): the fixture `space-scores-r-resets` passes. It checks state only, not the HUD.

What fails looks like:
- no HUD at all;
- the HUD at the page's top-left instead of the canvas's;
- Reset needing two clicks, or firing twice;
- Space activating the button;
- console errors about `ctx.hud`.

Negative: `mtek check tests/semantics/fail/e5601_hud_size_out_of_range` gives `E5601` three times. A `hud.text` call in a `fn` or `cpu fn` gives `E5080`.

Known limits are in `spec/hud.md` §6. The release-docs limitation row is `hud-scope`.

## 6. Phase 6.2: Tweens / easing (decision 0135, `spec/tweens.md`)

Automated (cheap, already green here):
- `cargo test -p mtek-compiler --test fixtures` covers `tests/semantics/pass/ease_tweens` (all ten curves in `bind`, `update` and a `cpu fn`) and `tests/syntax/pass/EaseTween.mtek` (the spec example).
- `--test stdlib_registry`: `the_easing_namespace_is_ten_cpu_curves`, namespace count 10. `--test stdlib_schema`: the schema has `easing`.
- `--test codegen_cpu_table --test numeric_cpu_table --test fold_cpu_table`: unchanged and green. The easing curves are deliberately **not** in `tests/semantics/numeric/cpu.json`, because its generated `fn` rows and constant folds cannot call CPU-only, non-constant functions. `conformance.test.ts` excludes `easing.*` explicitly, with a comment.
- `npx vitest run src/math` in `packages/runtime-web` (111 tests, including `ease.test.ts`: endpoints 0 and 1, clamping, NaN to 0, known values, binary32 results).

Manual, in a WebGPU browser:
1. `cargo run -p mtek-cli -- dev examples/hud-score --open`.
2. Press **Space**. The cube should jump to about 1.4x size and ease back to 1x over 0.3 s, ending in a small undershoot (`easing.out_back`). It should not grow linearly or stay large.
3. Fail: the cube never changes size, it snaps without easing, or the console shows `rt.easeOutBack is not a function` (a stale prebuilt runtime; run `npm run check:prebuilt`).

Negative checks (no new codes):
- Calling `easing.in_quad(t)` in a plain `fn` gives `E4002`.
- Using `const K: f32 = easing.in_quad(0.5);` gives `E3090`.
- Calling a `cpu fn` in `bind` still gives `E5005`.

The namespace is `easing`, not `ease`: built-in namespaces cannot be shadowed (`E2001`), and an existing fixture imports a user function `ease`.

## 7. Phase 8.4: Game packages, `mtek build --release [--itch]` (decision 0136, `spec/tooling.md` §2.1)

Automated (cheap, already green here):
- `cargo test -p mtek-cli --bin mtek game_package`: CRC-32 check value, zip records and reproducibility, the itch limits (`E7104`), favicon content checks (`E7103`), packaging.
- `cargo test -p mtek-compiler --lib package::html`: the game page (loading screen, favicon link, escaped title, no dev client).
- `npx vitest run src/release-bundle.test.ts` in `packages/runtime-web`: the flavour file names, including `runtime.min.js`.
- `npm run check:prebuilt`: the prebuilt copy includes `runtime.min.js`.
- Done here by hand: `mtek build --release --itch --out /tmp/gp-out <copy of examples/hud-score>` printed `built 'hud-score' (release): 10 files in /tmp/gp-out and /tmp/gp-out-itch.zip`. Python `zipfile.testzip()` reported no bad entry. The names are at the root (`index.html`, `favicon.svg`, `runtime.<h16>.js` at 513 848 bytes against 843 265 unminified, `shaders/...`).

Manual, in a WebGPU browser (not run here):
1. `cargo run -p mtek-cli -- build --release --itch examples/hud-score`. Then serve the folder, for example with `npx http-server examples/hud-score/dist`, and open it.
2. Expected:
   - a dark loading screen with "HUD Score", a spinner and "Loading…";
   - it fades out when the scene appears;
   - the tab shows the blue "M" favicon and the title "HUD Score";
   - the game plays exactly as in `mtek dev`;
   - no console errors.
3. In a browser without WebGPU (or with WebGPU disabled), the loading screen must go away and the unsupported-browser screen (decision 0132) must show. It must not spin forever.
4. itch.io: create a draft HTML5 project, upload `dist-itch.zip` and choose "This file will be played in the browser". The game loads in the itch iframe. Only Abe can do this (account needed).
5. Favicon: put a real PNG at `examples/hud-score/assets/favicon.png` and rebuild. The tab shows it, and `favicon.png` is in the folder and the zip. Rename a text file to `favicon.png`: the build fails with `E7103` and no folder is written.
6. Usage errors (exit 2): `mtek build --release --mode dev`, `mtek build --itch` (needs `--release`).

Fail looks like:
- a white page during load;
- a loading screen that never goes away;
- a 404 for `favicon.svg`;
- a zip whose files sit inside a sub-folder (itch shows "index.html not found");
- runtime errors only with the minified bundle (compare with `mtek build` without `--release`).

## 8. Phases 8.3 and 8.5: CI, budgets, hardware evidence (decision 0137)

Done here:
- `cargo build -p mtek-cli && node scripts/game-budgets.mjs size`: all seven examples within budget. The budgets are this run's sizes plus 10 %. For example hud-score is 637 576 B (folder) and 638 702 B (zip); physics-playground is about 5.07 MB because of the Rapier wasm.
- `node scripts/game-budgets.mjs frames /tmp/fe.json`, where the file has a SwiftShader fallback adapter and p95 30 ms: exit 1, "not hardware evidence" and "over budget".
- `node scripts/game-budgets.mjs frames` with no file: exit 1, "needs a run on real GPU hardware".

Not run here:
- CI itself. The jobs are in `ci/small-games-ci.patch`, not applied, because GitHub refused a push touching `.github/workflows/` without the `workflow` token scope. Apply it (`ci/README.md`), push, and look at the Actions tab. The `game-budgets (ubuntu-latest)` job must be green. The YAML was edited by hand and not parsed on the box, so a syntax error would show as a workflow error on GitHub.
- `scripts/record-frame-evidence.mjs` was never executed. The box has no GPU and no Chromium; `node --check` passes.

Abe, on each GPU machine (NVIDIA, Intel, Apple silicon):
1. `npm ci && npx playwright install chromium && cargo build -p mtek-cli`.
2. `node scripts/record-frame-evidence.mjs evidence/small-games/2026-MM-DD-<os>-<gpu>.json`.
   - Expected: one line per example with p50, p95 and max. At 60 Hz, p50 should be about 16.7 ms.
   - The final `wrote ...` line shows the adapter. `isFallbackAdapter` must be false, and the vendor or description must name the real GPU.
3. `node scripts/game-budgets.mjs frames evidence/small-games/<file>.json`.
   - Pass: "every budget holds".
   - Fail: an example's p95 over 20 ms, or the adapter refused. A refused adapter usually means Chromium fell back to SwiftShader; check `chrome://gpu`.
4. Commit the JSON and update the status table in `evidence/small-games/README.md`.
5. Optional: register the machine as a self-hosted runner with labels `mtek-gpu` plus `nvidia`, `intel` or `apple`. Then start the CI workflow by hand with `frame_evidence: true`.

On a 120 Hz or 144 Hz display the intervals are about 8.3 or 6.9 ms. The budget still applies, and the refresh rate shows in p50. A headless run on Linux may not be vsync-capped; set `MTEK_HEADLESS=0` to measure a real window.

## 9. Not done on this branch (deferred), stated honestly

Nothing below has code here. There is nothing to test until it is built.

- **Phase 1, fonts.** There is no font selection and there are no local font assets: the HUD uses the system UI font only (`spec/hud.md` §6, limitation `hud-scope`). A proper design needs either a font resource type (`asset.font(path)`, validated by content like audio) or a packaging convention. It must also carry the font to the HUD's DOM layer in every build mode. Both cross the type checker, the asset compiler and the runtime, and were not started.
- **Phase 1, panels and buttons.** These are covered by the existing `hud.rect` and `hud.button` (decision 0134). There is no layout or nine-slice panel component.
- **Phase 6, still open:**
  - alpha and fades (`E5902` is still "not supported");
  - animated GLBs (`E7019` still rejects animations);
  - 2D sprites and a 2D camera preset;
  - texture swapping at run time (`E5073` still rejects writes to texture params);
  - normal maps;
  - GLB node hierarchies (`E7902`);
  - particles;
  - multiple cameras and switching.
  Each one changes the renderer, the manifest or WGSL generation, and each needs GPU verification that cannot happen on this box. Only 6.2 (tweens via `easing`) is done.
- **Phase 8.2.** This is decision 0132 and the unsupported-browser screen, committed earlier (ff5fd55d). It is WebGPU-only, with no WebGL2 fallback, by decision. Nothing new was added in this round.
- **Phase 8.3 CI.** The workflow change is a patch (`ci/small-games-ci.patch`), not applied: the push token lacks the `workflow` scope.
- **Hardware frame-time evidence.** There is none for NVIDIA, Intel or Apple. It needs Abe's machines (§8).

## Pre-existing failures seen while running targeted tests (not caused by this branch)

- `cargo test -p mtek-compiler --lib syntax::lexer_tests::longest_match_wins_for_operators` expects `=>` to lex as `Eq Gt`. The base branch's `match` work made it `FatArrow`.
- `cargo test -p mtek-grammar-coverage`: `every_production_alternative_and_rule_is_covered` and `the_command_prints_the_report_and_succeeds` still expect 73 productions, but the grammar now has 80 after the base branch's `enum`/`match` productions. The interpolation work adds no production.
- `npm run check:coverage`: "no demonstration and no positive fixture exercises the feature match" (base branch).

These were not re-run on the bare base commit; my evidence is only that the code they test was not changed here.
