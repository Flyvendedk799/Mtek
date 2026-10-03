# 0006. Deliberate exclusions

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §2.3.

## Decision

Not in v0.1: package registry, multiplayer, full game editor, native desktop engine, proprietary AI service, arbitrary JavaScript (or raw WGSL) embedded in Mtek, an untested WebGL fallback. Missing features stay **visible limitations** with diagnostics, never undocumented escape hatches; the host API exposes only declared `host.inputs`. Development tooling (formatter, `mtek dev`, overlay) is in scope; a visual editor product is not.
