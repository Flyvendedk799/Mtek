# Mtek

Mtek is a typed language for browser applications where visual behaviour matters more than the
surrounding web application: interactive product scenes, procedural visualisations, physics
playgrounds and small 3D games. A Mtek program describes scene structure, state, shader stages and
their resource dependencies as one checked unit; the compiler produces JavaScript and WGSL for a
runtime on browser WebGPU, and the toolchain works fully offline, without any AI service.

## Status: pre-alpha — nothing is implemented yet

The specification is in [`spec/`](spec/README.md). There is no compiler, runtime, CLI or example in
this repository yet. Everything described in `spec/` is a design, not a feature; a feature counts as
supported only when a test that would fail without it passes in a recorded environment
(`spec/testing.md`).

## Planned commands (not available)

None of these commands exists yet. The milestone in which each is planned is listed in
[`spec/tooling.md`](spec/tooling.md).

| Command | Purpose | Planned |
|---|---|---|
| `mtek --version` | print the toolchain, language and runtime ABI versions | M0 |
| `mtek check` | parse and type-check a project | M1 |
| `mtek build` | produce a deployable web build | M1 |
| `mtek dev` | build, serve and watch with hot reload | M1 (candidate-based reload: M3) |
| `mtek inspect` | inspect IR, bindings and shaders | M1 / M2 |
| `mtek new` | scaffold a project | M3 |
| `mtek fmt`, `mtek test`, `mtek context`, `mtek grammar export`, `mtek lsp` | formatter, fixtures, AI context export, grammar export, language server | M6 |

## Licence

All rights reserved — licence to be decided.
