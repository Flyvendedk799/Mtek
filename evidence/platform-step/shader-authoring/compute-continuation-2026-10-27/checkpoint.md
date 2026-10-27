# Compute shadows and capability alignment: continuation

2026-10-27. Rechecks the current code after the character/PBR work and extends
the [public acceptance](../compute-release-2026-10-27/checkpoint.md). The full
platform roadmap remains incomplete.

The shadow probe now verifies that completing a pending dispatch restores the
caster and its shadow without replacing the existing lease. It then reuses the
recovered compute handle for a different translation, supplies its new explicit
final sphere, and compares against a fresh ordinary CPU entity-transform
reference. The second result must differ visibly from the first result and from
an unshadowed control. This catches stale borrowed output after recovery or
dispatch completion. Original numeric, culling, pending, recovery, detach and
resource-release gates remain unchanged.

All nine checks pass on each backend, with no failures or NOT-RUN. The twelve
shadow cases cover low/medium/high quality and off-camera/final-bounds culling.
Both original and changed output match independent CPU geometry exactly in the
recorded runs. Pending completion and recovery are pixel-exact; all seven
registry ownership counters return to zero after each application is disposed.
Raw pixels, PNGs, environment and compiler-package provenance are retained in
`hardware/` and `software/`. The software high-quality final-bounds preview was
also visually inspected. Radeon RX 7900 XTX and SwiftShader are two backends on
one PC, not two physical-device tiers or performance measurements.

The capability test now connects the advertised `compute-programs` feature to
an ordinary public build containing a packaged shader, then checks the negative
boundary: material-local compute emits E4901 and produces no package. Standalone
bounded compute remains host API 1; unrestricted compute is not advertised.

Validation passes: 63 compiler integration tests (35 context, 16 compute frontend,
12 lowering), 124 LSP tests and 127 release-documentation tests. The live release
audit agrees across 263 features, 251 diagnostics, language 0.1 and ABI 1.
TypeScript, focused type-aware lint, Rust formatting and warning-denying Clippy
for the changed context target pass. These are focused checks; no new full
workspace or performance run is claimed. Runtime/compiler behavior did not need
changing in this continuation. See [validation.json](validation.json) for source,
command and evidence hashes. Prior checkpoints are preserved unchanged.
