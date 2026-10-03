# AI Workflow, Untrusted Previews and Benchmarks (v0.1)

- Repository path: `spec/ai-and-benchmarks.md`
- Status: Normative design for blueprint §9 and §12.2–§12.3. Initial benchmark tasks are an M0 deliverable; the harness, context export, grammar adapter and preview mode are M6; release measurements are M7.
- Non-negotiable: the language, compiler and runtime have **no dependency** on any inference provider or library (decision 0003). Everything here lives in `tools/` or behind CLI commands that work offline.

---

## 1. Outcome taxonomy (blueprint §9.1)

Every AI attempt is recorded with each layer's outcome **separately**; no layer implies another.

| Layer | Recorded values |
|---|---|
| generation | `completed` · `truncated` (hit max tokens) · `refused` · `cancelled` · `backend-error` · `budget-exceeded` |
| parse | `pass` · `fail` (diagnostics) |
| check | `pass` · `fail` |
| shader/target validation | `pass` · `fail` · `not-run` |
| application start | `pass` · `fail` (mount error kind) · `not-run` (no GPU) |
| task tests | `pass` · `fail` (which) · `not-run` |

"Generated successfully" means `generation = completed`; it never implies parse, check, start or task success. A truncated generation is a failure state even if the partial output parses.

## 2. Context export (`mtek context`, M6)

```
mtek context --entry src/main.mtek [--symbol Demo.Cube …] [--max-bytes 24000] --format json
```

Output (JSON, deterministic):
```json
{
  "languageVersion": "0.1", "compilerVersion": "0.1.0", "contextFormat": 1,
  "supported": { "features": ["scenes", "entities", "materials", "bind", "…"], "notSupported": ["while", "transparency", "…"] },
  "syntax": { "keywords": ["…"], "precedence": ["…"], "rules": ["Statements and fields end with ';'", "…"] },
  "project": { "entry": "src/main.mtek", "scene": "Demo", "modules": ["src/main.mtek"] },
  "symbols": [ { "name": "Demo.speed", "kind": "state", "type": "f32", "doc": "…", "file": "src/main.mtek", "line": 14 } ],
  "schemas": [ { "name": "Box", "fields": [ { "name": "size", "type": "vec3", "default": "vec3(1.0, 1.0, 1.0)", "flags": "C" } ] } ],
  "examples": [ { "title": "Bind a material parameter to scene state", "source": "material: Unlit { color: bind(tint) };" } ],
  "diagnosticsGuide": "Diagnostics are JSON objects with code, message, source span, expected/actual, suggestedEdits."
}
```

Rules:
- Built only from the registry and the resolved project. The `supported` list is derived from what **this compiler build implements** (registry `since` ≤ current milestone and not `E9010`); planned features appear only under `notSupported` with their planned version. Never advertise planned features as supported (blueprint §10).
- **Neighbourhood, not the whole library** (blueprint §9.2): with `--symbol`, include those symbols, their types, the schemas of fields they use, symbols one reference away, and examples tagged with those features. Without `--symbol`, include the entry scene's symbols and the schemas it uses.
- Examples are compiled by a test on every build (they must check without errors).
- `--max-bytes` truncates the lowest-priority sections first (examples, then neighbour symbols) and records what was dropped in a `truncated` field.

## 3. Grammar export and the first constrained-decoding adapter (M6)

- `mtek grammar export --format ebnf` prints `spec/grammar.ebnf` from the compiler's **grammar model** (`syntax/grammar_model.rs`, a data description of the productions); a test asserts the printed text equals the checked-in file. `--format gbnf` prints a GBNF translation of the same model ([S9]) with: `ExprNoDesc` expanded as a duplicated rule set; nested comments expressed recursively; a `root` that accepts one module; and a documented maximum output length enforced by the caller.
- **Exactly one backend/model/version combination** is supported first. Choosing it is an M6 decision task (decision record required), constrained by: runs locally without an account; documents GBNF; a validator is available. Default proposal to evaluate: llama.cpp (pinned release) with its `gbnf-validator` tool and one pinned open-weights model.
- **Adapter conformance** (`tools/grammar-adapters/test/`): every positive syntax fixture is accepted by the backend's grammar validator; every syntax-level negative fixture (lexical/syntax codes only) is rejected; strings with every escape, comments of each kind, numeric literal edge cases, and truncated inputs behave as the compiler does. Known differences are listed explicitly (e.g. if nested comments cannot be supported) — evidence of consistency, not a proof of equivalence (blueprint §4.6).
- **Capability check:** before constrained generation the harness asks the backend for grammar support; if absent it fails with "grammar-constrained mode unavailable" and **never** silently runs unconstrained. Runs are labelled `constrained` or `unconstrained` and reported separately.
- A narrow structured-edit JSON schema (§4.3) may be used as transport for backends that offer JSON mode but not grammars; its output still goes through the normal compiler.

## 4. The repair harness (`tools/ai-eval`, M6)

TypeScript (Node, pinned like the rest of the workspace). Provider-independent.

### 4.1 Components
- `ModelClient` interface: `generate({ system, messages, maxOutputTokens, temperature, stop, grammar? }) → { text, usage: { inputTokens, outputTokens, cachedInputTokens? }, finish: "stop" | "length" | "refusal" | "cancelled" | "error" }`. Adapters (each optional, each in its own file, none imported by the language packages): `anthropic`, `openai-compatible` (covers local servers), `llama-cpp`, and `replay` (deterministic recorded transcripts for the harness's own tests).
- `ContextBuilder`: runs `mtek context` for the task's project and symbols.
- `Editor`: applies the model's edit (§4.3) to a scratch copy of the project.
- `Validator`: runs `mtek check --format json`, `mtek build --mode test`, the browser start smoke test and the task's tests, recording each layer (§1).
- `RepairLoop`: on failure, sends **localized** diagnostics (the JSON envelope entries plus the surrounding source lines) and asks for a new edit; stops after `maxRepairs` (default 3) or when budgets are exhausted (tokens, wall-clock). On stop, the failing project, all diagnostics and the transcript are preserved.
- `Recorder`: one JSONL record per model call (prompt hash, full prompt text, response, usage, finish reason, timing) and one per validation; written to `benchmarks/results/<run-id>/`.

### 4.2 Integrity rules
- A repair must satisfy the **original task tests**, not merely compile. The harness also checks a task-declared list of required symbols and behaviours still exists — a "repair" that deletes the feature under test fails (blueprint §9.2).
- Prompts, model ids, provider, temperature, max tokens, stop sequences and seeds are recorded exactly; changing any of them creates a new condition.

### 4.3 Edit format
The model replies with one or more blocks:
```
<<<FILE src/main.mtek
<<<SEARCH
        speed = -speed;
===
        speed = -speed * 1.5;
>>>REPLACE
```
Each SEARCH text must match exactly once in the current file; otherwise the edit fails with a structured error returned to the model (counted as a repair round). A `<<<FILE path` block with `<<<WHOLE` replaces or creates a file (allowed for cold authoring). The equivalent JSON structured-edit schema (`{ "edits": [ { "file", "search", "replace" } ] }`) is the optional transport of §3.

## 5. Untrusted previews (blueprint §9.5)

Compiler correctness is not a sandbox. v0.1 delivers these pieces and documents the rest for hosts:

- **`mtek build --mode preview`** (M6): CPU loop back-edges are instrumented with a budget (`ctx.budget`, default 10 million iterations per frame, configurable) and exceeding it stops the scene with `E8080` and the overlay; the runtime refuses `fetch` to anything outside `baseUrl`; `index.html` loads an external `bootstrap.js` (no inline script) and carries a restrictive Content-Security-Policy meta (`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'` — `'wasm-unsafe-eval'` is required for the physics module's WebAssembly); compile limits (file size, module count, a 10 s compile timeout in the CLI) and asset limits apply.
- **Host guidance** (`docs/preview-hosting.md`, M6): serve previews from an isolated origin (separate registrable domain), inside a sandboxed iframe (`sandbox="allow-scripts"` without `allow-same-origin` on the embedding page), with no credentials or cookies on that origin; kill a preview whose frame loop stops responding (watchdog via `postMessage` heartbeat); never run package lifecycle hooks during untrusted compilation (Mtek has none — keep it that way).
- **Automated tests** (`tools/ai-eval`) run every candidate in a fresh Playwright browser context with a per-test timeout and kill on expiry.

## 6. AI/token benchmark (blueprint §12.2)

### 6.1 Task format (`benchmarks/tasks/<id>/`)
```
task.toml          # id, category, title, mode (cold | edit), prompt text, required_symbols, budgets
mtek/              # starter Mtek project (empty skeleton for cold tasks)
mtek-tests/        # mtek test fixtures (*.test.toml) that define success
baseline/          # starter TypeScript + three/webgpu (+ TSL) project, same task
baseline-tests/    # Playwright tests asserting the same observable behaviour
reference/         # a reference solution for each side, written by a human or a reviewed agent;
                   # proves the task is solvable and that both test sets pass on a correct answer
```
The exact `task.toml` keys, where `mtek test` fixtures run from, the holdout tree-hash algorithm and the baseline test hooks are fixed by decision 0021 (`spec/decisions/0021-benchmark-task-format.md`).

`task.toml` example:
```toml
id = "interaction-03"
category = "interaction"          # scene-rendering | interaction | shader-bridge | maintenance
mode = "edit"
title = "Toggle rotation direction with Space"
prompt = """Make the cube reverse its rotation direction each time Space is pressed."""
required_symbols = ["Demo.Cube"]
[budgets]
max_repairs = 3
max_output_tokens = 4000
max_wall_seconds = 300
```

### 6.2 Set composition
30 tasks: 10 scene/rendering, 8 interaction, 6 shader/bridge, 6 maintenance/repair; plus a **holdout** set of 8 in `benchmarks/holdout/` that is never used while designing syntax, docs or context (a CI check fails if any file under `tools/` or `spec/` references a holdout id). The holdout's tree hash is recorded in `benchmarks/holdout.sha256` when created so later edits are detectable. **M0 delivers the format and 5 seed tasks** (one per category plus one holdout); M6 completes the set.

### 6.3 Baseline fairness
The baseline is competent TypeScript with three.js r186 (`three/webgpu`, `three/tsl`) or equivalent typed helpers. Where Mtek's standard library provides help (primitive meshes, look-at cameras, sRGB colour literals, typed material parameters), the baseline gets an equivalent helper module. Both sides receive version-correct documentation, whose tokens are counted (blueprint §12.2).

### 6.4 Protocol and metrics
- Conditions: `{mtek, baseline} × {unconstrained, constrained (mtek only, M6+)} × {cold, edit}`; ≥ 5 trials per task per condition per model; models, settings and dates recorded.
- Per attempt: first-attempt parse, check, start and task-test success; repair rounds; wall-clock time; input and output tokens **separately**, cached and uncached separately when the provider reports them; tokens for instructions, examples, tool results, diagnostics, generated code and repair turns attributed separately.
- Aggregates: completion rate; `tokens per completed task = all tokens consumed by all attempts / completed tasks` (undefined when no task completes — reported as undefined, never as 0 or ∞); medians and interquartile ranges; per-category breakdowns. All attempts including failures are published (`benchmarks/results/<run-id>/` raw JSONL + `report.md`).
- **Initial research target** (proposed, not a result): at matched task success, ≥ 30 % fewer total tokens per completed task than the baseline. If missed, investigate documentation overhead, grammar unfamiliarity, missing abstractions and repair causes before making syntax more cryptic. The original "~80 % fewer tokens" stays an unverified hypothesis and must not appear in release copy (blueprint §12.2).

## 7. Runtime benchmark (blueprint §12.3, M7)

- Workloads (`benchmarks/runtime/<workload>/`): constant scene; 1 000 changing transforms; 500 changing material params; 2 000 repeated meshes (instancing path); asset-heavy startup; 300 physics bodies; 50 mount/reload/dispose cycles. Each exists as an Mtek program, a **direct-WebGPU** reference (hand-written TypeScript, same visible result and workload size) and the three.js baseline.
- Metrics: CPU update time, render-preparation time, GPU time only with `timestamp-query` (otherwise labelled unavailable), frame-time distribution (p50/p95/p99 over ≥ 600 frames after 120 warm-up frames), upload bytes, draw calls, pipelines created, allocations, bundle size (gzip and raw), startup latency.
- **Investigation threshold** (proposed): p95 frame time of the controlled core-rendering workload within 20 % of the direct-WebGPU reference on the same machine. Not a speed guarantee.
- Runs on recorded hardware only (`isFallbackAdapter === false`), with the environment record attached. Benchmark definitions are frozen (tree hash recorded) before a release comparison; changing them requires a recorded rationale, and a failing workload is never removed retroactively.
