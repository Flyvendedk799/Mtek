# Testing the `feat/small-game-support` features

One section per feature: what it does, how to exercise it, and what you should see. Commands run from the repository root. They assume a built CLI (`cargo build -p mtek-cli --locked`, binary `target/debug/mtek`) and, for the npm steps, `npm ci`.

## 1. Enums and `match` (decision 0129)

### What it does

- `enum Name { A, B, C }` declares a closed set of named variants. It is a module item, can be exported and imported, and its name is a type. A value is written `Name.A`.
- `==`/`!=` compare two values of one enum. There is no ordering, no arithmetic and no number conversion. Enums are CPU-only.
- `match` has two forms:
  - a statement, `match v { P => { … } … }`, whose arms are blocks;
  - an expression, `match v { P => e, … }`.
- A pattern is `Enum.Variant` or `_`, and patterns can be joined with `|`. A match must be exhaustive, its arms must be reachable, and the arms of an expression must share one type.
- `enum` and `match` are now keywords; they are no longer reserved words.
- New diagnostics:
  - `E3201` non-exhaustive match
  - `E3202` unreachable arm
  - `E3203` match on a non-enum
  - `E3204` invalid pattern
  - `E3205` unknown variant
  - `E3206` arms of different types
- Other diagnostics:
  - A duplicate variant is `E2002`.
  - An empty enum or an empty match is `E1001`.
  - An enum in GPU code is `E4011`; as a material param it is `E4030`.
- Spec: `spec/language.md` §2.2–2.3, §3.1, §4.4, §5.1–5.2, §5.7, §6.1–6.2, §6.11, §7.9 and §11; `spec/grammar.ebnf`; `spec/diagnostics.md` (E3201–E3206); `spec/decisions/0129-enums-and-match.md`.

### Fixtures

| Kind | Path | Expected |
|---|---|---|
| syntax pass | `tests/syntax/pass/EnumDecl.mtek`, `MatchStmt.mtek`, `MatchExpr.mtek`, `Pattern.mtek` | parse with zero diagnostics |
| syntax fail | `tests/syntax/fail/e1001_empty_enum` | one `E1001` "An enum needs at least one variant." at `{}` |
| syntax fail | `tests/syntax/fail/e1001_empty_match` | one `E1001` "A `match` needs at least one arm." at `{}` |
| syntax fail | `tests/syntax/fail/e1001_match_arm_without_arrow` | one `E1001` "Expected `=>` after the pattern, found `{`."; the arm body is still read |
| syntax fail (updated) | `recovery_every_reserved_word`, `e0013_reserved_in_parameter_and_local` | `enum`/`match` are no longer listed; the second now uses `trait` |
| lexer (updated) | `tests/syntax/lex/keywords.mtek/.tokens` | `enum` → `KwEnum`, `match` → `KwMatch` |
| semantics pass | `tests/semantics/pass/enums_and_match` | 0 diagnostics: a game-state machine (state of enum type, `==`, both match forms, a `const` folded through `match`, a function ending in an exhaustive `match` of returns) |
| semantics pass | `tests/semantics/pass/enums_imported` | 0 diagnostics: an exported enum and function used from another module, and an enum struct field |
| semantics fail | `tests/semantics/fail/enums/e2002_duplicate_enum_variant` | `E2002` on the second `Menu`, related at the first |
| semantics fail | `…/enums/e3201_non_exhaustive_match` | two `E3201`s (expression and statement) at the `match` keyword, naming the missing variants |
| semantics fail | `…/enums/e3202_unreachable_match_arm` | two `E3202`s: an arm after `_`, and a variant already matched (related spans) |
| semantics fail | `…/enums/e3203_match_on_non_enum` | `E3203` on the `i32` scrutinee |
| semantics fail | `…/enums/e3204_invalid_match_pattern` | `E3204` on the literal `1` and on `Direction.North` (wrong enum) |
| semantics fail | `…/enums/e3205_unknown_enum_variant` | `E3205` for `Phase.Playng`, help "did you mean `Phase.Playing`?", variant list, related at the enum |
| semantics fail | `…/enums/e3206_match_arm_types` | `E3206` at `true`, related "the first arm gives f32" |
| semantics fail | `…/enums/e4011_enum_in_material` | two `E4011`s: the enum parameter, and the matched value in a function the fragment stage calls |
| semantics fail (updated) | `e0013_reserved_word_as_entity_name` | now `entity impl` |
| context goldens (updated) | `tests/context/golden/*.json` | features gain `enums` and `match`, keywords gain `enum`/`match`, and `notSupported` loses them |

### Commands

```sh
# Lexer, parser, checker fixtures (syntax/semantics/lex), parser unit tests
cargo test -p mtek-compiler --locked --test fixtures --test lexer_fixtures
cargo test -p mtek-compiler --locked --lib syntax::parser
# Grammar model / EBNF in sync, diagnostics catalogue, context goldens
cargo test -p mtek-compiler --locked --test grammar --test diagnostics_audit --test context --test context_cold_start
mtek grammar export --format ebnf | diff - spec/grammar.ebnf     # no output
# Everything Rust
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
# Grammar coverage (every new production is built by a pass fixture)
cargo run -p mtek-grammar-coverage --locked
# Every new code has a negative fixture; feature areas (coverage matrix area "enums")
npm run check:coverage
# TextMate grammar regenerated from spec/grammar.ebnf (adds enum/match/=>)
npm run check:grammar -w mtek-vscode   # needs Node 24
# Generated release docs (see "Not done" below: regenerate first)
npm run generate -w @mtek/release-docs && npm run check:release
```

The test names above are the usual ones in `crates/mtek-compiler/tests/`. If one differs, `cargo test --workspace --locked` covers all of them.

### Try it by hand

`src/main.mtek` in a fresh project (`mtek new demo`):

```mtek
enum Phase { Menu, Playing, Paused, GameOver }

fn speed(phase: Phase) -> f32 {
    return match phase {
        Phase.Playing => 1.0,
        Phase.Menu | Phase.Paused => 0.0,
        _ => 0.25,
    };
}

scene Demo {
    state phase: Phase = Phase.Menu;
    state time: f32 = 0.0;
    camera Main { position: vec3(0.0, 2.0, 8.0); }
    entity Cube {
        mesh: Box {};
        update(dt: f32) { self.rotation = quat.euler(0.0, time, 0.0); }
    }
    update(dt: f32) { time += dt * speed(phase); }
    on key_down(Key.Space) {
        match phase {
            Phase.Menu | Phase.Paused => { phase = Phase.Playing; }
            Phase.Playing => { phase = Phase.Paused; }
            Phase.GameOver => { phase = Phase.Menu; }
        }
    }
}
```

- `mtek check`: expect 0 errors.
- `mtek dev` (browser): the cube is still in the menu; Space starts it rotating, Space again pauses, and Space resumes.
- `mtek inspect --ir`:
  - `speed` shows `match phase#0 { 1 => 1.0, 0 | 2 => 0.0, _ => 0.25 }`.
  - The handler shows `let match#… = state.phase` followed by an `if … else if … else` chain.
  - State `phase` has type `u32`.
- In the emitted JavaScript, the `match` expression is `(($match) => $match === 1 ? … : …)(…)`.

Variations and what to expect:

| Edit | Expect |
|---|---|
| Delete the `_ => 0.25,` arm | `E3201` naming `Phase.GameOver` |
| Add `Phase.Menu => 2.0,` after the `_` arm | `E3202` |
| Write `Phase.Pausd` | `E3205` with "did you mean `Phase.Paused`?" |
| `phase < Phase.Playing` | `E3014` |
| `i32(phase)` | `E3001` |
| `match time { _ => 0.0 }` | `E3203` |
| Arms `1.0` and `true` | `E3206` |
| `param p: Phase = Phase.Menu;` in a material | `E4030` |
| Call `speed(...)` from a material's `fragment` | `E4011` |
| `mtek fmt` on the file | the canonical layout: one arm per line, a trailing comma after expression arms |
| `enum Phase {}` | `E1001` |
| `enum Phase { Menu, Menu }` | `E2002` |

Editor: in VS Code, `enum` and `match` are highlighted as keywords, `=>` as an operator, and the name after `enum` as a type. LSP hover on an enum shows `enum Phase { Menu, Playing, Paused, GameOver }`, and completion offers `enum` at module level and `match` in a block.

### Not done or not verified (enums/match)

- The test suites, browser tests and GPU checks were not run (by request).
- The goldens of the new and updated fixtures came from the built compiler, as the fixture runner would bless them.
  - Semantics goldens came from `mtek check --format json`. Every one of the 376 existing semantics fail fixtures still reproduced its golden this way.
  - Syntax and lexer goldens came from a scratch harness that mirrors the runner.
- `docs/limitations.md`, `docs/language-reference.md` and `docs/language-guide.md` (generated by `tools/release-docs` from `spec/language.md` and `tools/release-docs/data/limitations.json`) were **not** regenerated: the box had Node 20 and the tool needs Node 24 plus a built runtime. Run `npm run generate -w @mtek/release-docs` before `npm run check:release`.
- The GBNF export uses a no-descriptor expansion: in a no-descriptor context, a `match` expression's arm values cannot be bare descriptor literals. This is stricter than the parser.
- Host IO describes an enum `state` by its enum name, while the IR and manifest say `u32`. Enum host inputs and outputs are unspecified.
- Some messages built from a kind noun read "a enum" (for example "'Phase' is a enum; …"). This is the same article quirk as the existing "a entity".

## 2. Game flow: scenes and `go_to`, `reset()`, timers, `pause()`, `while` (decisions 0140–0144)

### What it does

- **Several scenes** (0141). The entry module may declare any number of scenes, and `mtek.toml` `project.scene` picks the first one.
  - `mtek build` packages every scene. The entry scene keeps `app.js` and `program.manifest.json`; every other scene `S` gets `app.S.js` (plus its `.map`) and `program.S.manifest.json`. Shaders, assets and the runtime are shared.
  - Every manifest of a multi-scene program has `game.scenes`. A single-scene build has no `game` object and is unchanged.
- **`go_to(Scene)`** (0141) is handler-only. The new scene is prepared in the background and swapped in at the start of a later frame.
  - `shared state x: T = v;` (scene state only) is copied into the next scene by name.
  - Only the first request counts.
  - A failure is runtime `E5401`, and the old scene keeps running.
- **`reset()`** (0140) restarts the running scene from its initial values, shared state included.
- **Timers** (0142): `after(t) { … }` and `every(t) { … }` run on the game clock (paused time excluded) at the start of phase 3, before `update`. A timer belongs to its entity in entity and prefab bodies.
- **`pause()`/`resume()`/`paused()`** (0143) stop ticks, physics, timers and `update`. Input handlers, bindings and rendering keep running.
- **`while cond { … }`** (0144) is CPU only and capped at 1 000 000 iterations per execution (`E8080`).
- Keywords: `while` is a keyword now. `after`, `every` and `shared` are contextual. New intrinsics: `go_to`, `reset`, `pause`, `resume`, `paused`.
- New codes:
  - `E3210`: a `var` used in a timer block.
  - `E3211`: a constant timer time out of range.
  - `E5201`: `go_to` needs a scene name.
  - `E5202`: `shared` outside scene state.
  - `E5203`: shared state of a type that cannot be carried.
  - `E5204`: shared state with one name and different types.
  - `E5401` (runtime): the scene change failed.
  - `E5901` is retired (kept as reserved).
- Spec:
  - `spec/language.md` §2.2–2.4, §7.6, §7.10, §7.11 and §10;
  - `spec/scenes.md` §1, §10, §14 and §15;
  - `spec/runtime-abi.md` §2, §4.2, §5, §7 and §11.4;
  - `spec/stdlib.md` §6, `spec/diagnostics.md`, `spec/manifest.schema.json` (`game`, `sceneStateEntry.shared`);
  - `spec/decisions/0140`–`0144`.

### Fixtures

| Kind | Path | Expected |
|---|---|---|
| syntax pass | `tests/syntax/pass/WhileStmt.mtek`, `TimerStmt.mtek`, `SharedState.mtek` | 0 diagnostics; `after`, `every` and `shared` still work as names |
| syntax fail | `tests/syntax/fail/e1001_timer_two_arguments`, `e1001_while_without_block`, `e1030_break_in_timer` | as in their `.diag.json` |
| syntax (updated) | `keywords.mtek` (`while` → `KwWhile`), `recovery_every_reserved_word`, `e0013_reserved_function_name` (`fn loop`), `fail_syntax.mtek` | goldens re-blessed |
| semantics pass | `tests/semantics/pass/game_flow` | 0 diagnostics; builds 12 files including `app.Level.js` and `program.Level.manifest.json` |
| semantics fail | `tests/semantics/fail/game/e3210_timer_uses_var` | 2× `E3210` |
| semantics fail | `…/game/e3211_invalid_timer_time` | 3× `E3211` (negative `after`, zero and negative `every`) |
| semantics fail | `…/game/e3001_timer_time_not_f32`, `e5080_timer_in_function`, `e3070_while_condition_not_bool`, `e4010_while_in_material` | the named code |
| semantics fail | `…/game/e5201_go_to_not_a_scene` | 2× `E5201` (a camera, an expression) |
| semantics fail | `…/game/e5202_shared_state_outside_a_scene`, `e5203_shared_state_cannot_carry_over`, `e5204_shared_state_types` | the named code (`E5204` with a related span at the other scene) |
| semantics fail (renamed) | `tests/semantics/fail/e0013_loop_loop` (was `e0013_while_loop`) | `loop` is still reserved |
| runtime unit | `packages/runtime-web/src/host/game.test.ts` | pause/resume, timer order and paused time, owner death, `reset`, `go_to` with shared carry, `E5401`, the `while` cap → `E8080` |
| runtime unit | `packages/runtime-web/src/diagnostics/types.test.ts` | `E5401` is a runtime game code |
| ABI | `tests/abi/manifests/valid/full.json` | `game.scenes` and `"shared": true` validate and round-trip |
| example | `examples/lane-runner` | checks and builds 15 files; `tests/title-blink.test.toml` |

### Commands

```sh
cargo test -p mtek-compiler --locked --test fixtures --test lexer_fixtures --test stdlib_registry --test stdlib_schema --test build --test context --test context_cold_start
cargo test --workspace --locked
cargo run -p mtek-grammar-coverage --locked          # productions 82/82, alternatives 122/122, rules 17/17
cd packages/runtime-web && npx vitest run src/host/game.test.ts src/diagnostics/types.test.ts && npx tsc -p . --noEmit
npm run check:grammar -w mtek-vscode                 # TextMate: while, shared, after/every, match-arm `|`
npm run check:coverage                               # coverage matrix area "game-flow"
npm run generate -w @mtek/release-docs && npm run check:release
mtek build examples/lane-runner && mtek test examples/lane-runner
```

### Try it by hand

Run `mtek dev examples/lane-runner` and check each of these:

- **Title.** The yellow cube turns, and the white bar blinks twice a second.
- **Enter.** The run starts:
  - ArrowLeft and ArrowRight move the blue cube between three lanes.
  - Red balls fall.
  - The green bar at the top grows by one step per second.
- **Escape** freezes the balls, the bar and the lane keys, while the page keeps rendering. Escape again continues from the same point; no time jump.
- **Hit a ball.** You see the GameOver scene: a red bar for this run and a green bar for the best. After 3 s it goes back to the title, whose bar now shows the best score.
- **R during a run** restarts the run, and the best is kept. **Backspace on the title** sets the best back to 0 (`reset()`).
- **DevTools network.** `app.Run.js?build=…` and `program.Run.manifest.json` load only on the first switch.
- **Make a scene change fail.** Delete `dist/app.GameOver.js` from a build and lose a run. The console or overlay shows `E5401`, and the run keeps going.

These edits in `game_flow` or the example should report:

| Edit | Expect |
|---|---|
| `go_to(Main)` (a camera) | `E5201` |
| `shared state` in an entity | `E5202` |
| `shared state r: entity_ref = …` | `E5203` |
| `shared state score: f32` in one scene and `i32` in another | `E5204` |
| `var n = 1; after(1.0) { n += 1; }` | `E3210` |
| `every(0.0) { }` | `E3211` |
| `after(1.0) { }` in a `fn` | `E5080` |
| `while 1 { }` | `E3070` |
| `while true { }` in a handler | runs, then fails the frame with `E8080` ("A `while` loop ran more than 1000000 iterations …") |
| `fn reset() {}` | `E2001` (prelude name) |

### Not done or not verified (game flow)

- Browser tests, `mtek test` (needs WebGPU), and the npm checks other than the runtime typecheck and its unit tests were not run here.
- The generated docs were **not** regenerated:
  - `docs/limitations.md`, `docs/coverage-matrix.md`, `docs/language-*.md`;
  - the inputs they come from did change: `tools/release-docs/data/limitations.json` (E5901 reason, the scenes-scope restriction), the coverage-matrix forms and area, and the prefabs-and-scenes page template.
- Hot reload while a non-entry scene runs follows that scene by design. Only the unit test covers it, not a live `mtek dev` session.
- The cold-start context has to fit its budget. To make room:
  - `reset|pause|resume` now share one line without docs (the preset rule extended to global functions; decision 0140);
  - the docs of `go_to` and `paused` are short.
  - The empty project is 22 995 bytes, 5 bytes under the limit of the test that keeps 1 000 bytes free. **Any new intrinsic, keyword or schema field (Phases 1, 4, 5, 7) will hit this limit.** It needs a decision (0112 item 5).
