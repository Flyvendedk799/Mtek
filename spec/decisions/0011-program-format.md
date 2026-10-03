# 0011. Program format and CPU value representation

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §2.2, §5.3.

## Decision

The manifest carries **data** only (structure, layouts, shaders, assets, capabilities, symbols, spans); generated JavaScript carries **logic** only (initialisers, handlers, binding evaluators, writers, functions) and receives a narrow `ctx` (`spec/runtime-abi.md` §4.2). Generated code never touches WebGPU, the DOM, timers or the network. CPU values are immutable plain objects (`{x,y,z}`, `{r,g,b,a}`, …) and `Float32Array(16)` for `mat4`; sharing a reference is semantically a copy. Allocation cost is accepted for v0.1 and measured before optimisation. Strict versioning: manifest schema 1, runtime ABI 1; mismatches are rejected, never guessed.
