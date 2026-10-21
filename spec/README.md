# Mtek specification (v0.1)

The documents in this directory are the authoritative design for Mtek v0.1. They supersede the
original blueprint where the two differ (the blueprint remains the historical design baseline; its placeholder
name is explained in decision 0017), and every such difference is recorded in
`spec/decisions/`. The documents describe v0.1 as specified, which is not always what this build
implements: [`docs/limitations.md`](../docs/limitations.md) lists everything that is specified but
not built, everything that is refused on purpose and why, and each document names the milestone in
which its subject was delivered.

| File | Title | First needed |
|---|---|---|
| `language.md` | Mtek Language Reference — Core | M1 |
| `grammar.ebnf` | Mtek Grammar v0.1 (EBNF reference) | M1 |
| `grammar-notes.md` | Notes for implementers of the grammar | M1 |
| `scenes.md` | Scenes, Entities and Behaviour | M1 |
| `materials.md` | Materials, GPU Stages and Lighting | M1 (temporary Unlit path, removed in M2: decision 0044), M2 |
| `stdlib.md` | Standard Library Registry | M1 |
| `gpu-layout.md` | GPU Data Layout and Transport | M0 |
| `runtime-abi.md` | Program Format and Browser Runtime Contract | M0 (bridge spike), M1 |
| `compiler-architecture.md` | Compiler and Repository Architecture | M0 |
| `diagnostics.md` | Diagnostics | M1 |
| `testing.md` | Testing, Verification and Evidence | M0 |
| `assets.md` | Assets: Declarations, the Static GLB Profile, Packaging and Loading | M4 |
| `physics.md` | Physics: Semantics, Adapter Contract and Rapier Mapping | M5 |
| `audio.md` | Audio: Sound Assets, Playback, Volume and Browser Autoplay | small-game extension (decision 0130) |
| `hud.md` | HUD: Text, Rectangles and Buttons over the Canvas | small-game extension (decision 0134) |
| `tweens.md` | Tweens: Easing Curves in Bindings | small-game extension (decision 0135) |
| `browser-support.md` | Browser Support: WebGPU Only, the Browsers It Covers, and the Unsupported-Browser Screen | small-game extension (decision 0132) |
| `tooling.md` | Developer Tooling: CLI, Project File, Dev Server, Formatter, LSP | M0 (`--version`), M1 onward |
| `ai-and-benchmarks.md` | AI Workflow, Untrusted Previews and Benchmarks | M0 (initial benchmark tasks), M6 |
| `decisions/` | Decision records 0001–0170 (indexed in `README.md`), the sources list `sources.md` | M0 |

The "First needed" column is a planning aid taken from the milestone markers inside the documents;
the documents themselves are authoritative.

Changes go through decision records. A change that alters or extends any document here is first
recorded as a new numbered record in `spec/decisions/` (see `spec/decisions/README.md`); records are
never rewritten to hide history, and a changed decision is superseded by a later record.
