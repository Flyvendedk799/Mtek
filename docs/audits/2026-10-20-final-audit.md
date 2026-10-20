# Final compiler and runtime audit, 2026-10-20

Baseline: PR #3 head `5f591c214053406710373e1b9e33053e98dbb57b`. This pass preserves the previous correctness and measured performance changes. It selects seven distinct defects from compiler, shader and reload/recovery review; it makes no comparative performance claim.

Local verification uses Windows, the pinned Rust 1.99.0 toolchain, Node 24.18.1 and npm 11.16.0 with locked dependencies. The verified checkout is separate from the preserved interrupted clone. No repository-specific `AGENTS.md` or `.agents` skill instructions were present.

## Reproduced findings and changes

| Point | Baseline evidence | Required behavior and regression |
| --- | --- | --- |
| Unit-valued array inference | `fn nothing() {}` followed by `[nothing()]` passed checking; in a fragment it reached `E9999` for `array<(), 1>` without a GPU representation. Nested arrays also passed. | Unit is not a usable value (language section 5.1). Diagnose invalid elements during checking, including nested arrays and mixed positions, while retaining valid unit-returning statement calls. |
| Block constants in lifecycle/handler bodies | Scene/entity update, scene key handler and prefab update accepted a block constant, then build reached `E9999`: constant `INDEX` was not checked. A prefab block constant `1 / 0` also escaped checking. | Collect constants from the documented block contexts before evaluation, including nested control flow; valid constants lower and invalid initializers receive ordinary source diagnostics. |
| Nested GPU stage inputs | A fragment array `[input, input]` followed by reading `values[0].world_normal` checked but build reached `E9999`: `SurfaceInput` has no GPU representation. | Reuse a canonical aggregate representation across stage wrappers, arrays, user structs and helper functions, with Naga validation of generated WGSL. |
| Qualified shader type names beginning with `Mtek` | A legal user struct parameter in entry file `Mtek.mtek` checked but build produced Naga `E6100`, expected `{`, found `.`. | Distinguish module-qualified user symbols from generated builtin names and consistently escape their member names. |
| Rejected-reload ownership | A failed physics import left a decoded image open even after app disposal. Three candidates whose initializers threw grew live buffers/textures from `7/2` to `8/3`, `9/4`, `10/5`. | Close decoded images on every post-load exit and dispose partially constructed scene stores when initialization fails. Refused candidates must leave the running scene and its live-resource counts intact. |
| Reload invalidation during asynchronous work | Deferred manifest and shader completion after disposal each ran the stale candidate initializer once (expected zero). Deferred pipeline completion after disposal created two live buffers after the count had reached zero. The baseline checked lifecycle state at entry and only after scene preparation; asynchronous pipeline creation could register into a recycled registry. | Check lifecycle ownership before side effects and discard stale asynchronous results without registering old-device resources or disturbing the recovered scene. |
| Reloaded shaders in offline recovery | Initial mount and device rebuild used the remembering shader fetcher, while successful reload used a direct environment fetch, leaving changed shader bodies outside the recovery cache. A moved build reusing an existing hash also skipped fetching and lacked the new URL in the cache. | Fetch changed candidate shaders through the cache and retain reused WGSL at moved URLs by hash. Span maps remain specific to their build; they are never aliased from the old build merely because WGSL hashes match. |

## Reproducibility and verification

The focused tests retain the source programs and fake-host resource/lifecycle cases. Compiler regressions validate diagnostics or build through the compiler's WGSL validation path. Runtime tests exercise actual mount/reload/recovery code with deterministic deferred operations and tracked resources; they are correctness evidence, not GPU hardware performance measurements.

Focused compiler reproduction commands:

```text
cargo test -p mtek-compiler --lib arrays_ --locked
cargo test -p mtek-compiler --lib types::tests:: --locked
cargo test -p mtek-compiler --test lifecycle_constants --locked
cargo test -p mtek-compiler --test gpu_surface_aggregates --test shader_lowering --locked
cargo test -p mtek-compiler --test gpu_module_names --locked
npm run test:unit -w @mtek/runtime-web -- src/host/assets.test.ts src/host/recovery.test.ts src/host/reload-lifecycle.test.ts src/gpu/registry.test.ts --maxWorkers=2
```

The lifecycle regression exercises 15 owner/body combinations (scene, entity, nested entity, prefab and nested prefab entity, each with `update`, `fixed_update` and a key handler), building each in four modes: 60 builds. It also checks 60 invalid-source cases for division by zero, non-constant initializers, type mismatches and lexical visibility. There is no source `init` lifecycle in this language version; initialization is generated. The four SurfaceInput regressions independently validate WGSL and assert one canonical input declaration, offsets `0/16/32/48`, 64-byte size and 64-byte array stride. Existing shader goldens remain unchanged.

Reload invalidation tests defer manifest, shader and pipeline completion, each across disposal and complete recovery, then verify no later allocations or live-resource changes, no stale initialization before scene preparation, and a still-rendering recovered scene. Two registry tests independently retire the generation during pipeline creation and verify the late result cannot affect newly created resources. Resource release remains strict; these fixes do not suppress ownership errors globally.

Recovery tests load changed shader hashes at both the original and an alternate base URL, swap the program, remove all server files, lose the device and verify a healthy draw with no further fetches. A separate moved-build case retains a reused shader without another WGSL fetch or module creation, caches that build's own optional map, then repeats offline recovery. If an optional current-build map cannot be loaded, shader recovery remains possible and diagnostics fall back to the material declaration; unavailable maps can still be requested again during recovery.

The moved-build review also reproduced A-to-B-to-A reload history: both reloads succeeded, but after removing server files recovery returned to `running` with `failedMaterials = 1` and zero draws, fetching the uncached historical A shader at its new URL. The fix retains full-hash WGSL source provenance beyond the immediately previous manifest, matching the runtime's retained module history. The new regression verifies no duplicate module or moved-URL WGSL fetch and a healthy offline draw after both swaps.

Focused results: array filter 7 passed; checker filter 45 passed; lifecycle integration 2 passed; GPU aggregate plus existing shader integration 13 passed; naming integration 1 passed (three module-path cases), plus the naming unit regression. Six focused runtime suites passed all 111 tests natively; after the history follow-up all 32 recovery tests passed. Targeted Clippy, TypeScript and changed-file ESLint passed. The initial combined runtime run under the sandbox encountered five existing temporary Vite-module `ENOENT` loading failures; native reruns passed without changing assertions, timeouts or skips. One sandbox process-creation transport failure occurred before execution. Aggregate gates use the native context.

The first frozen aggregate at `53cd3678261a7ccd2f0bb0d2dc54fe56ab5ca7cf` passed all nine gates: build, full repository checks, workspace Rust tests, all workspace JavaScript tests, coverage, release consistency, M7 baseline, frozen workload definitions and diff checks. It reports 1,650 Rust tests passed / 0 failed / 1 existing ignored, and 4,693 JavaScript tests passed / 0 failed / 2 existing skipped. [Commands and exit statuses](final-2026-10-20/checks-attempt-1.json), [eleven-workspace counts](final-2026-10-20/test-counts-attempt-1.json).

The subsequent history fix changes only `host/app.ts` and `host/recovery.test.ts`, frozen at `0af8f5b27cf350ab8410831bfb8d5ac4f702cf8a`. Rust sources are identical. The affected-gate rerun rebuilds everything and reruns repository checks, embedded CLI tests with the rebuilt runtime, every JavaScript workspace and the remaining consistency gates. [Results, exact revision and commands](final-2026-10-20/checks.json) explicitly reference the earlier full Rust result rather than representing it as a new run. Final exact-head CI reruns the full Rust suite and browser/extension integrations; the PR verification section records its run links and software-browser execution summary.

All nine affected gates passed: 312 embedded CLI tests / 0 failed; 4,694 JavaScript tests / 0 failed / 2 existing skipped. [Counts by workspace and tested revision](final-2026-10-20/test-counts.json). Coverage remains 304 features, 157 positive fixture programs and 201 diagnostic codes, with every assertion holding. Release consistency reports 168 features, 201 diagnostic codes, ABI 1 and language 0.1; every comparison holds. No assertions, timeouts, corpus thresholds or skips were loosened to obtain these results.

## Commits

| Commit | Change |
| --- | --- |
| `3d3470fb` | Reject inferred arrays of unit values. |
| `6a876415` | Evaluate lifecycle and handler block constants. |
| `7730b713` | Lower nested GPU surface input aggregates. |
| `af696b6a` | Mangle user types from Mtek-prefixed modules. |
| `c811dee7` | Release rejected reload resources. |
| `dc190612` | Abandon stale asynchronous reload work. |
| `813b994b`, `53cd3678`, `0af8f5b2` | Retain reload shaders for offline recovery, including moved builds and historical hash reuse. |

## Scope and limitations

The earlier [performance audit](2026-10-20-performance.md) contains the retained compiler latency comparisons and unchanged generated-binding profiles. This pass addresses demonstrated correctness and resource lifetime failures; it does not claim new renderer throughput, hardware GPU results, or best-in-class language/compiler performance. Fake-host tests cannot substitute for browser integration checks. Remaining candidates, including hostile/sparse host vector decoding and cycle-diagnostic scaling, are outside these seven fixes and should receive separate evidence and review.
