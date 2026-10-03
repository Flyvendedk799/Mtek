# 0013. Implementation sequencing

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §11, §15.

## Decision

1. **M0 boundary.** Kept as production code: the layout engine (`layout/`), WGSL block emission, JS writer emission, the runtime uniform arena and device bootstrap, the browser harness and the layout fixtures. Disposable: the bridge-spike generator example and probe page glue — kept under `tests/` and `crates/mtek-compiler/examples/` only, never exported from a public API.
2. **Full parser in M1.** The whole v0.1 grammar is parsed from M1 (mechanical given the EBNF; avoids rework). Semantics arrive per milestone; specified-but-unimplemented constructs yield `E9010`, distinct from "not in v0.1" codes.
3. **Temporary M1 Unlit path.** M1 renders `Unlit` from a minimal shader IR built by the compiler (not from user source). M2 replaces it with the prelude `Unlit` written in Mtek and deletes the temporary path; the M2 gate checks that it is gone.
4. Hot reload in M1 is full-page reload; candidate-based reload arrives in M3.
