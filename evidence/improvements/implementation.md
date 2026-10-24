# Mtek improvements implementation

Implemented against `origin/main` at `f0a9ab68`, following the supplied
`mtek-improvements.md` handoff. Task changes are separate local commits on the
`codex/improvements-validation` branch; no deployment or merge was performed.

## Changes

| Task | Result |
| --- | --- |
| A1 | Template/small-game and sprite-pop draw their HUD in `ui`; the template and small-game remain identical. |
| A2 | CLI tests read the runtime selected by build.rs, including the checked-in prebuilt fallback. Missing extension bundles report `run npm run build first`. |
| A3 | Ordinary release builds use runtime.min.js; debug/test builds retain their appropriate runtime. |
| A4 | Context snippets teach HUD, pause, scene transitions, saved best score, tagged sprites and both timers. The 30,000-byte ceiling is unchanged. |
| A5 | Sprite-pop has a reproducible eight-frame star sheet; hud-score saves best; small-game spawns repeated gems and loses after three misses. Test-only probes are documented; an obsolete stage-show rotation probe was removed. |
| A6 | The historical AI archive is marked frozen and excluded from normal ripgrep, agent guidance, editor search and GitHub language statistics. Existing evidence was preserved. |
| B1 | Decision 0180 chooses queued string messages and owner-controlled state. Spawned lane-runner rocks send hits to the player; no parallel rock arrays remain. |
| B2 | Sphere and oriented-box overlap builtins work without physics. Randomized box tests compare with Rapier; lane-runner uses the sphere builtin. |
| B3 | Camera-aware screen/world conversions fix arcade-audio speaker clicks. Projection tests cover perspective/orthographic cameras, camera orientation and 16:9, 4:3 and portrait. |
| B4, init | Scenes/entities/prefabs accept a one-time init hook. Spawn initialization follows registration with runtime listeners; hot restoration does not repeat spawned init. |
| B4, helpers | Scene CPU helpers capture their scene; hud-score has one reset helper. State initializers cannot call scene helpers. |
| B4, material | Arcade Audio uses one Speaker and replaces its material value. Reads snapshot values; replacement validates parameters and respects bindings, copy-on-write and alpha tracking. |
| B5, particles | Global particle draw limit raised from 256 to 4096, with a cap/warning regression test. |
| B5, gamepad | `gamepad.connected`, `.axis` and `.button` expose a browser snapshot polled once per frame; blocked/disconnected input is neutral. |

Grammar, editor highlighting/completion, registry schema, context goldens,
prebuilt runtime bundles and generated documentation were updated for the new
language features. Decisions 0180–0187 document the chosen semantics.

Material replacement deliberately preserves the nominal shader type and supports
value-only material instances. Replacing texture/sampler resources or switching
shader types requires a further design; individual value parameter writes remain
available for materials that have resources.

## Measurements and pilot

- Small-game release folder: 672,803 bytes versus 1,063,120 bytes with the equivalent
  unminified runtime, a **36.7% reduction**. All 11 example package size budgets pass.
- `mtek context --entry examples/small-game/src/main.mtek --symbol Play`: **15,703
  UTF-8 bytes**, containing `hud.`, `ui(`, `go_to`, pause, tagged, `every(`,
  `after(`, saved and Sprite. Context budget tests retain the 30,000-byte limit.
- The final paired pilot uses Claude Haiku 4.5, temperature 0, three tasks
  (`interaction-01`, `scene-rendering-01`, `maintenance-01`), two trials on each
  side. **6/6 Mtek and 6/6 baseline attempts pass** after allowed repairs.
- Final paired run cost: **$0.0803**; the shared ledger, including earlier runs,
  totals **$0.1514**, below the authorized $5 cap. The temporary credential file
  was removed. No credential was added to the repository.
- This pilot is too small for a regression or token-efficiency conclusion. The
  point estimate uses more Mtek tokens; no token-saving claim is made. See
  [the generated report](ai-pilot.md) and the preserved raw trial records in
  `benchmarks/results/ai/improvements-final-paired-pilot-2026-10-24/`.

The first pilot could not judge browser execution with the system Node runtime;
its NOT-RUN records remain preserved. Browser validation and the successful
pilots use the bundled Node 24 runtime and a real AMD Radeon RX 7900 XTX adapter.

## Validation

- `npm run build`: passed.
- `npm run test:unit` with `VITEST_MAX_WORKERS=2`: **4,896 passed, 2 skipped**.
  Limiting workers avoids contention in tests that invoke TypeScript compilers.
- `cargo fmt --check`: passed.
- `npm run check`: passed (format, Clippy, TypeScript, ESLint, naming, benchmark
  task validation, assets and checked-in prebuilt provenance).
- With `packages/runtime-web/dist` temporarily absent,
  `cargo test -p mtek-cli --test cli --locked`: **41 passed**, using the checked-in
  runtime fallback. The generated directory was restored afterward.
- Template/small-game byte comparison and the normal `rg --files` archive
  exclusion check: passed. A scan of all 13 example/template update blocks found
  zero `hud.` calls.
- All 11 examples pass `mtek check`, `mtek build` and their declarative browser
  fixtures: **19 fixtures passed** on hardware. See [examples.json](examples.json).
- All six new feature browser fixtures pass on hardware; see
  [feature-fixtures.json](feature-fixtures.json).
- Hardware Playwright pause-menu test: **1 passed, 0 not-run**; the paused HUD
  remains visible and its Resume button resumes the game.
- All 11 package size budgets pass; see [size-budgets.json](size-budgets.json).
- Coverage generation and release-document consistency checks pass:
  **377 features, 197 positive fixture programs, 245 diagnostic codes**,
  with zero diagnostic codes missing negative coverage.

Initial validation with this machine's optional pinned llama.cpp validator found
54 mismatches in 43,154 inputs, concerning match patterns and malformed string
interpolation. All 54 exact failing inputs were rerun against the original
`f0a9ab68` compiler and grammar in an isolated checkout; **all 54 mismatches recur**.
This verifies that they predate this implementation. See
[grammar-conformance.json](grammar-conformance.json). The baseline harness was
only filtered to these 54 names; its compiler, grammar and fixtures were unchanged.
The temporary baseline checkout was archived after verification.

The follow-up in decision 0188 fixes these mismatches. **The full Rust suite now
passes** (`cargo test --workspace --locked`), including 43,181 validator inputs with zero
unexpected mismatches, the installed constrained-generation smoke, grammar
coverage (82 productions, 123 alternatives and 18 rules), coverage-use tests
and doc tests. No validator exceptions were added, and the final sweep is
unfiltered. See [the follow-up report](grammar-fix.md) and
[validation record](grammar-fixed-validation.json).

The extension clean-clone simulation temporarily removed only its generated
bundle: the three affected tests report the explicit build instruction, with
four other package tests passing. The bundle was restored afterward.

Hardware fixtures cover queued messages, overlaps, screen projection, scene and
spawned init, scene helpers, material replacement/snapshot restoration, lane-runner
and the starter loss condition. Clip composition remains covered by the existing
runtime composition tests; stage-show's declarative fixture now correctly asserts
that the entity's own base rotation is unchanged by clip playback (decision 0174).
