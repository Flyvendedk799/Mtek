# Compiler and Repository Architecture (v0.1)

- Repository path: `spec/compiler-architecture.md`
- Status: Normative engineering contract. Changes require a decision record.
- Depends on: decision records 0005, 0007; every language spec.

---

## 1. Repository layout

The repository root **is** the `mtek/` root of blueprint §13 (decision 0007). Directories are created when the milestone that needs them starts — never prefilled with placeholders (blueprint §13).

```
Cargo.toml                 # [workspace] members = ["crates/*"], resolver = "3"
Cargo.lock                 # committed
rust-toolchain.toml        # pinned stable toolchain + rustfmt, clippy
package.json               # private root, npm workspaces, scripts orchestrating builds/tests
package-lock.json          # committed
.nvmrc                     # pinned Node LTS
crates/
  mtek-compiler/           # library: everything from source text to build output (no I/O except via the Fs trait, §4.1)
  mtek-cli/                # binary `mtek`: argument parsing, file system, dev server, LSP transport (M6)
packages/
  runtime-web/             # @mtek/runtime-web — TypeScript runtime (M0+)
  physics-rapier/          # @mtek/physics-rapier — optional physics adapter (M5)
  editor-vscode/           # VS Code extension (M6)
spec/                      # this specification set, decisions, evidence policy
examples/                  # pulse-cube (M3), material-configurator (M4), physics-playground (M5), modular-scene (M7)
tests/
  syntax/ semantics/ codegen/ gpu-layout/ assets/   # compiler fixtures (§10)
  browser/                 # @mtek/browser-tests — Playwright (M0+)
benchmarks/  tasks/ baselines/ results/
tools/       ai-eval/ grammar-adapters/            # M6
evidence/    M0/ M1/ …     # milestone gate evidence (spec/testing.md §8)
```

## 2. Toolchain and dependency policy

| Item | Pin (2026-10-03) | Where |
|---|---|---|
| Rust | stable `1.99.0`, edition 2024 | `rust-toolchain.toml` (`channel = "1.99.0"`, components `rustfmt`, `clippy`); `edition = "2024"` and `rust-version = "1.99"` in every crate |
| Node.js | `24` LTS (active LTS today; v26 becomes LTS on 2026-10-28 — upgrading is a recorded decision, not a drive-by change) | `.nvmrc`, `"engines": { "node": ">=24 <25" }` |
| npm | the version bundled with the pinned Node | `"packageManager"` field; `.npmrc` with `save-exact=true` |
| TypeScript | latest 5.x/6.x at bootstrap, exact | `devDependencies` |
| esbuild, vitest, @playwright/test | exact versions chosen at bootstrap (`@playwright/test` 1.63.x current) | `devDependencies` |

Rules (blueprint §13): versions are chosen by testing the combination, recorded in `spec/decisions/0007-…` (amended by later records), never selected because a URL says "latest". Lockfiles are committed and CI uses `cargo build --locked` and `npm ci`.

**Allowed Rust dependencies** (adding another needs a one-paragraph justification in the PR and in decision 0007's dependency table):

| Crate | Purpose | Introduced |
|---|---|---|
| `naga` = 30.0.1, features `["wgsl-in"]` | WGSL parse + validation oracle | M0 |
| `serde`, `serde_json` | manifest, diagnostics, IR dumps | M0 |
| `indexmap` | deterministic maps | M1 |
| `sha2` | content hashes | M1 |
| `libm` | deterministic pure-Rust transcendental functions for constant evaluation and colour-literal conversion (bit-identical on every OS) | M1 |
| `toml` | `mtek.toml` | M1 |
| `clap` (derive) | CLI | M1 |
| `axum`, `tokio` (features `rt-multi-thread`, `macros`, `fs`, `net`, `signal`, `sync`, `time`), `tokio-stream` (feature `sync`), `notify` | `mtek dev` server, SSE stream, watcher, Ctrl+C (in `mtek-cli` only; tests speak HTTP/SSE over `std::net::TcpStream`, no HTTP-client crate) | M1 |
| `lsp-server`, `lsp-types` | LSP (in `mtek-cli` only) | M6 |
| `gltf` 1.4.x, `imagesize` | asset validation | M4 |
| `jsonschema` (dev-dependency only, optional) | validating emitted JSON against `spec/*.schema.json` in Rust tests | M1 |

The compiler library must not depend on `tokio`, `axum`, `clap` or anything performing network or terminal I/O.

**Lints and hygiene** (enforced in CI): `#![forbid(unsafe_code)]` in both crates; `cargo clippy --workspace --all-targets --locked -- -D warnings`; `clippy::unwrap_used`, `clippy::expect_used`, `clippy::panic`, `clippy::todo`, `clippy::unimplemented` denied outside `#[cfg(test)]`; `cargo fmt --check`; TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, ESLint with `@typescript-eslint/recommended-type-checked`; no `any` in runtime source (`@typescript-eslint/no-explicit-any: error`).

## 3. Pipeline

```
Project (mtek.toml, entry)                     project/
  └─ load modules (follow imports)             project/, source/
      └─ lex + parse each file → AST           syntax/
          └─ resolve names and modules         resolve/
              └─ type check, const-eval,       types/
                 effects, domains, scene &
                 ownership rules
                  └─ build typed IR            ir/
                      ├─ CPU lowering → JS AST ─────────────┐ lowering/cpu, emit_js/
                      ├─ shader lowering → Shader IR → WGSL ─┤ lowering/shader, emit_wgsl/
                      └─ resource planning (layouts, slots)  ┘ plan/, layout/
                          └─ package: manifest, dist files, hashes   package/
```

**Error accumulation.** Every stage records diagnostics in a `Diagnostics` sink and continues as far as it safely can. Erroneous expressions get the type `Ty::Error`, which is compatible with everything and never produces further diagnostics (no cascades). Stages after type checking (IR, lowering, emission) run **only if there are no errors**; `mtek check` stops after type checking. Compilation runs on a dedicated thread with a **16 MiB stack** (the Windows main thread has only 1 MiB, too little for the parser's depth limit of 256 in debug builds); a test parses nesting depth 256 on a 1 MiB thread in a debug build to bound stack use. A compiler **never panics** on any input: the CLI wraps the library call in `catch_unwind` and converts a panic into `E9999 internal compiler error` with a bug-report note, and fuzz tests (`spec/testing.md` §3) assert the library returns without panicking.

## 4. Module map (`crates/mtek-compiler/src/`)

### 4.1 `source/`
- `FileId(u32)`, `Span { file: FileId, start: u32, end: u32 }` (byte offsets, half-open).
- `SourceFile { id, path: ProjectPath, text: Arc<str>, sha256: [u8; 32], line_starts: Vec<u32> }` — text exactly as on disk (`spec/language.md` §1.2); line starts recognise `\n` and `\r\n`.
- `ProjectPath`: normalised, `/`-separated, relative to the project root; constructed only through a validating constructor (no `..` escaping the root, exact-case check through the `Fs` trait).
- Conversions: byte offset → `(line, column)` where column is 1-based and counted in Unicode scalar values (diagnostics), and → LSP `Position` in UTF-16 code units (LSP layer). Both are tested with multi-byte and astral-plane characters.
- `trait Fs { fn read(&self, p: &ProjectPath) -> Result<Vec<u8>, FsError>; fn exact_case_exists(&self, p: &ProjectPath) -> bool; }` — real implementation in `mtek-cli`, in-memory implementation for tests and the LSP's unsaved buffers.

### 4.2 `diagnostics/`
`Diagnostic { code: Code, severity, message: String, primary: Label, related: Vec<Label>, expected: Option<String>, actual: Option<String>, notes: Vec<String>, edits: Vec<SuggestedEdit> }`. `Code` is an enum generated from the catalogue table in `diagnostics/codes.rs`, which is the single source for `spec/diagnostics.md` §5 (a test checks the spec table matches). Renderers: JSON envelope (`spec/diagnostics.md` §2) and human (rustc-style snippet with caret underline, line numbers, notes).

### 4.3 `syntax/`
- `lexer.rs`: `Token { kind: TokenKind, span }`; comments and doc comments kept in a side table `Trivia` keyed by token index (formatter and doc extraction need them; the parser ignores them).
- `parser/`: recursive descent for items, members and statements; Pratt parser for expressions with exactly the binding powers of `spec/language.md` §6.1. Recursion depth limit 256 (`E1050`); the height of an expression tree is bounded as well (decision 0022).
- `ast.rs`: owned tree; every node has `NodeId(u32)` (dense, assigned in parse order) and `Span`. The AST contains no resolved information, no GPU handles, no browser objects (blueprint §5.1).
- **Recovery.** On an unexpected token the parser reports one error and skips to a synchronisation point: for statements `;` or `}` at the current depth; for members/fields `;` or the start of a member keyword (`state`, `param`, `entity`, `on`, `const`, `fn`, contextual `camera`/lifecycle names followed by the right punctuation); for items the next item keyword at depth 0. It inserts `Error` nodes so later stages can continue. At most one error per 3 tokens is reported (avoid avalanches).
- The parser implements **the full v0.1 grammar from M1 onward** (decision 0013): parsing is mechanical given `spec/grammar.ebnf`, and implementing it whole avoids rework. Semantic support arrives per milestone; a syntactically valid construct whose semantics the current build does not implement yet yields `E9010` ("`material` declarations are specified for v0.1 but not implemented by this compiler build yet") — distinct from `x9xx` "not in v0.1" codes.

### 4.4 `project/`
`mtek.toml` model (`spec/tooling.md` §3) with unknown-key rejection (`E9001`); module graph construction from the entry, in import order; cycle detection with the complete path (`E2035`); per-project limits (§9).

### 4.5 `stdlib/`
The **registry** — one Rust data table of every prelude type, schema, field (type, default, flags `writable`/`bindable`/`construction_only`/`required`), scene-object kind, component, event, enum (`Key`), intrinsic (signature, domain, const-eligibility, CPU semantics reference) — and the embedded prelude Mtek source (`std/materials.mtek`, …). From the registry are generated: `spec/stdlib-schema.json` (checked in; a test fails if it is stale), completion items (LSP), schema reference docs and the AI context export (blueprint §3.4: one registry).

### 4.6 `resolve/`
Scopes per `spec/language.md` §4; `DefId(u32)` for every declaration; side table `NodeId → Res`. Enforces no-shadowing, import/export rules, path resolution. Produces related spans for every conflict. Milestone gating (`E9010`) is table-driven here; the choices the specification leaves open (gating table, outermost-construct reporting, scope details) are decision 0025.

### 4.7 `types/`
- `Ty` interned (`TyId(u32)` into a `TyInterner`); kinds per `spec/language.md` §5 plus `Ty::Error`.
- Checker: expressions, literal resolution (bidirectional: expected type flows into literals and constructor arguments), conversions, operators table, statements, returns.
- `consteval.rs`: exact `f32`/`i32`/`u32` evaluation in Rust for constant expressions — every constant expression wherever it appears (`spec/language.md` §6.3). `+ - * /` and `sqrt` use Rust `f32` (IEEE binary32, correctly rounded); transcendental functions and the sRGB conversion of colour literals use the `libm` crate (Rust's `std` transcendental functions are platform-dependent and would make goldens differ between Windows and Linux). Overflow or division by zero → `E3040`.
- The choices the specification leaves open (which operators M1 implements, how literals meet operators, non-finite folds, the operation order of the folded quaternion functions, the type of a descriptor literal, the evaluation order of constants) are decision 0026.
- `effects.rs`: call graph, recursion detection (`E4001`), transitive effect levels, GPU reachability checks (§8.4 of the language reference).
- `scene.rs`: schema field checks, scene-object kinds, nesting/body rules, lifecycle/event signatures, single-writer analysis (every assignment and `bind` site is collected first, then conflicts reported with both spans), binding dependency graph with cycle detection (`E5075`, full cycle path). The schema and scene checks of M1 (field validation, constant expressions, the camera and entity rules, the checked-scene result for the typed IR) and the registry data they read are decision 0027.

### 4.8 `ir/`
The **typed high-level IR**: the semantic contract between language and code generation (blueprint §5.1). Self-contained (no AST references), every node carries a `Span`, every expression its `TyId`, every name a resolved `DefId`/symbol. Contents: modules; functions (params, result, effect, body); materials (params with types/defaults, fragment function, used `SurfaceInput` fields); prefabs; the entry scene (fields, state, cameras, entity tree, components with descriptor values, handlers, lifecycle functions, bindings with explicit dependency edges, host inputs). `serde::Serialize` with stable field order → `mtek inspect --ir --format json`.

### 4.9 `lowering/`
- `cpu.rs`: IR → JS AST (§6).
- `shader.rs`: IR (fragment + GPU-reachable pure functions) → Shader IR (§7).

### 4.10 `layout/` and `plan/`
`layout/`: the algorithm of `spec/gpu-layout.md` §4 and the built-in blocks. `plan/`: material instances, update classes, sharing eligibility, bind group plan, host-input codecs, binding evaluation order.

### 4.11 `emit_js/`, `emit_wgsl/`, `package/`
`emit_js`: JS AST printer (2-space indent, deterministic), writer emitter, Source Map v3 encoder (small in-house VLQ writer with unit tests against known vectors), `app.d.ts` emitter. `emit_wgsl`: Shader IR printer, span map, Naga validation and error mapping (§8). `package`: manifest builder (schema-valid by construction; a test validates every golden manifest against `spec/manifest.schema.json`), hashing, `index.html`, file set assembly as `BTreeMap<String, Vec<u8>>`.

### 4.12 Public API (`lib.rs`)

```rust
pub struct CompileOptions { pub profile: TargetProfile, pub mode: BuildMode /* Dev | Release | Test | Preview */, pub runtime_bundle: Option<Arc<[u8]>>, pub runtime_declarations: Option<Arc<[u8]>> /* runtime.d.ts */ }
pub fn check(project: &ProjectRoot, fs: &dyn Fs) -> CheckResult;            // diagnostics only; no GPU, no emission
pub fn build(project: &ProjectRoot, fs: &dyn Fs, opts: &CompileOptions) -> BuildResult; // files + diagnostics
pub fn inspect(project: &ProjectRoot, fs: &dyn Fs, what: Inspect) -> InspectResult;     // ir | bindings | shaders
pub fn context(project: &ProjectRoot, fs: &dyn Fs, req: &ContextRequest) -> ContextResult; // M6
```
The CLI, the tests and the LSP all call these; none re-implements compiler logic (blueprint §13).

**Runtime bundle in tests.** Compiler fixture tests and codegen goldens pass a fixed **stub bundle** — the bytes `// mtek test runtime stub\n` — as `runtime_bundle`, so the hashed runtime file name inside golden `app.js` files never changes when the runtime is edited, and `cargo test` never needs a Node build. Execution tests (Node) and browser tests build with the real bundle. `build` without any bundle fails with `E9030`.

## 5. Determinism

- No `HashMap`/`HashSet` iteration on any path that influences output or diagnostic order: use `IndexMap`, `BTreeMap`, or `Vec` sorted by a total key. A CI grep test forbids `std::collections::HashMap` in `emit_*`, `package`, `plan`, `layout`.
- Diagnostics are sorted by `(file id, start, end, code)` before output; file ids follow module load order (§9.4 of the language reference).
- Generated names come from declaration identity, never from counters that depend on traversal of unordered structures.
- Tests: build every golden fixture twice and with shuffled file-system enumeration (the in-memory `Fs` returns directory listings in random order) and assert byte-identical output.

## 6. CPU lowering and JavaScript emission

- Output is ES2022 modules. The JS AST covers exactly what is needed (module, import/export, `function`, `const`/`let`, `if`, `for` (counted), `break`/`continue`, `return`, expressions, object/array literals, calls, member access). Strings are escaped by the printer; user strings are never concatenated into code.
- **`f32` discipline:** every `f32`-typed arithmetic result is wrapped in `Math.fround(...)` (emitted as a local alias `const fr = Math.fround;`); `f32` literals are emitted as the shortest decimal that round-trips the binary32 value **when read as a JavaScript (f64) number** (e.g. the f32 nearest 0.1 is printed `0.10000000149011612`, not `0.1`), so the JavaScript constant is exactly the binary32 value the compiler computed; conversions go through `rt.f2i`/`rt.f2u`/`Math.fround`. Integer operations use `| 0`, `>>> 0`, `Math.imul`, `rt.idiv`, `rt.irem`, `rt.udiv`, `rt.urem`.
- Vector, quaternion, matrix and colour operations call `rt` helpers (`spec/runtime-abi.md` §4.1). Swizzles construct new values.
- Dynamic array indexing emits `a[rt.clampIndex(i, N, spanId, ctx)]` (clamps and reports `W8030` once per span in dev builds).
- Handlers and lifecycle functions become functions taking `(ctx, …)`; entity handlers take `self` = the entity record. Scene state is `ctx.s.<name>`; writes to entity fields go through `ctx` setters.
- Untrusted-preview builds (M6) insert a loop-budget check at each loop back-edge: `if (--ctx.budget < 0) rt.budgetExceeded(spanId)`.
- Every emitted statement and expression with a source origin adds a Source Map v3 mapping to its Mtek span.

## 7. Shader IR and WGSL emission

7.1 **Shader IR** (`lowering/shader.rs` output): a typed SSA-free tree IR with:
- types exactly as in `spec/gpu-layout.md` §3 (including `bool32` storage form and padded array element types);
- module-level declarations: structs (with explicit member offsets from the layout engine), uniform globals (group/binding), texture/sampler globals, helper functions, user pure functions, the fragment body function, the two entry points;
- statements: `let`, `var`, assign, `if`, counted `for` with constant bounds (lowered to WGSL `for (var i = a; i < b; i++)`), `break`, `continue`, `return`;
- expressions: literals (typed), locals, params, global reads, field/swizzle/index (index always clamped: `min(i, N-1u)` for `u32`, `clamp(i, 0, N-1)` for `i32`), unary/binary ops with WGSL-compatible typing, constructor calls, intrinsic calls, user function calls, `bool32` encode/decode.
Every node carries its Mtek `Span`.

7.2 **WGSL printing.** Deterministic formatting (4-space indent, one statement per line — the span map is line/column based). Mangling: `mtek_` prefix is reserved for generated identifiers; user names become `u_<kind>_<name>` (e.g. `u_fn_pulse`, `u_l_texel`), avoiding every WGSL keyword and reserved word by construction; struct and parameter-block **member** names become `u_<name>` (`spec/gpu-layout.md` §3). Struct names `S_<hash8>_<Name>`; param blocks `MtekParams_<hash8>_<Name>` — **always** module-qualified, with `<hash8>` defined in `spec/gpu-layout.md` §5, so equal names in different modules never collide.

7.3 **Helper library.** WGSL implementations of quaternion operations, `color.srgb`, integer division/remainder with Mtek semantics where WGSL already matches (WGSL `/` and `%` already implement `spec/language.md` §6.3 — no helper needed; this is asserted by the GPU conformance tests), `f2i`/`f2u` (WGSL conversion already clamps; NaN is non-portable), `round` (WGSL `round` is ties-to-even — no helper), `saturate`, and `lighting.pbr` (M4). Only helpers actually used are emitted.

## 8. Naga integration

- `emit_wgsl::validate(module_text) -> Result<(), Vec<Diagnostic>>` uses `naga::front::wgsl::parse_str` and `naga::valid::Validator::new(ValidationFlags::all(), Capabilities::default())`.
- Because Mtek type-checks first, **any** Naga parse or validation error on emitted code is a compiler defect: it is reported as `E6100` ("generated WGSL failed validation — this is a compiler bug") with the Naga message as a note, the WGSL location translated through the span map to the originating Mtek span (falling back to the material declaration), and a request to report it. User-caused GPU limits are caught before emission by Mtek's own checks (`E6001`–`E6003`).
- Naga's IR is never exposed or serialised as part of Mtek's specification (blueprint §5.2).
- A Naga pass is not proof of browser compatibility: the runtime still creates real pipelines inside error scopes and maps `GPUCompilationInfo` messages back through the same span map (`E8051`, `spec/runtime-abi.md` §5.4).

## 9. Limits (compiler constants, all diagnosed, never panics)

| Limit | Value | Code |
|---|---|---|
| Source file size | 4 MiB | `E0004` |
| Modules per project | 1 024 | `E9002` |
| Parser nesting depth (recursion levels; also the height of an expression tree, decision 0022) | 256 | `E1050` |
| Diagnostics reported per file | 200 (then one `W9003` "further diagnostics suppressed") | `W9003` |
| Array length | 1 … 65 536 | `E3031` |
| Static entities per scene | 16 384 | `E5092` |
| Material params per material | 64 | `E4032` |

## 10. Compiler test fixtures

Directory-driven, discovered in sorted order by `crates/mtek-compiler/tests/fixtures.rs` (format in `spec/testing.md` §3). Expected outputs are updated only with `MTEK_BLESS=1 cargo test`, and blessed changes are reviewed in the diff like code. No snapshot library is used: fixtures are plain files so that humans and agents can read them.
