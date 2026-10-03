# 0005. Architecture decisions

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §2.2.

## Decision

Adopted: a real language with its own types; handwritten Rust parser (recursive descent + Pratt); versioned EBNF reference with tested adapters; Tree-sitter as a secondary integration (its own `grammar.js` DSL [S2], not fed EBNF directly); JavaScript ESM output with TypeScript declarations at the host boundary; a TypeScript runtime using WebGPU directly; typed shader IR → WGSL → Naga validation; optional Rapier adapter; `wgpu` deferred as a production backend (`wgpu` is a graphics API with native and WebAssembly backends; Naga is the shader translator/validator — distinct roles [S3][S4]); provider-independent AI validation loop. **The compiler is authoritative**: when an adapter (EBNF tooling, GBNF, Tree-sitter, TextMate) disagrees with it, the adapter is repaired. The compiler is a library usable without the CLI.
