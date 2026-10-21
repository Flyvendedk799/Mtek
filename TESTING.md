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
