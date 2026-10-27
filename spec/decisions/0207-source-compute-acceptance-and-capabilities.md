# 0207 — Executable bounded source compute and capability alignment

Status: Accepted. Date: 2026-10-27.

The compiler's standalone-compute build gate is removed after numerical storage,
independent geometry/shadow references, pending-output suppression, recovery,
replacement and disposal checks pass on Radeon and SwiftShader. This supersedes
the temporary E4901 boundary in decisions 0201–0205. E4901 still rejects compute
as a material member and directs authors to a standalone declaration.

The resolver records an implemented Compute construct. Context advertises
`compute-programs`, exposes params/input/output/kernel symbols and keeps host
compute entry points among default roots. The example library, grammar, editor,
coverage facts, diagnostic triggers and generated release docs use the same
boundary. The existing cold-start budget and 1,000-byte project reserve remain.

Compute member parsing accepts the same stage-name syntax as the reference
grammar, including `_`, then rejects a non-`kernel` entry with E4050. This keeps
the syntax adapter and compiler aligned without admitting an executable invalid
entry. The conformance table also classifies the older mixed-placement fixture
after authored vertex support removed its former stage rejection.

The [API 1 contract](../compute.md) is deliberately bounded: input storage arrays,
one returned output stream, generated parameter writers, explicit host dispatch
and completed scalar-xyz attachments to static declared meshes. It does not add
workgroup memory, barriers, atomics, compute textures or indirect dispatch.

Acceptance uses compiler-produced packages through ordinary public analysis;
test code no longer strips diagnostics. GPU arithmetic is checked independently
of compiler layouts. Shadow references translate the source primitive's entity
on the CPU instead of reading compute output. The same shared sibling remains in
both paths. Low/medium/high shadows, off-camera casters, original-outside/final-
inside bounds, pending output, completed-snapshot recovery, detach and zero live
registry ownership are checked. Original failed harness attempts remain evidence.

One discrete desktop and same-host SwiftShader do not establish integrated/mobile
support, broad animation composition or the rest of the platform roadmap. The
manifest/runtime ABI remains development version 1; stable release and wider
physical-device validation remain separate work.
