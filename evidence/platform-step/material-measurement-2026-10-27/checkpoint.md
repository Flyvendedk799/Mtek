# Material measurement checkpoint

2026-10-27. Paused at the user's request before committing and pushing the
accumulated roadmap work. **The roadmap is incomplete. No qualified material
performance result or new performance baseline is claimed.**

Implemented protocol-3 tooling separates CPU submission, all-pass GPU timestamps,
resource counts and native presented cadence. It retains interference attempts,
uses immutable source/package identities and verifies raw reports independently.
Budgets can be established only from complete qualified reports on a matching
physical/browser environment. See decision 0213 and the suite README.

The shared texture counter now includes RG16Float, every mip, fixed array layers
and shrinking volume depth. Frozen animation definitions/evidence remain unchanged.
The material suite has 17 passing unit checks; the counter has 11 passing focused
tests. Material lint and runtime-benchmark TypeScript checks pass.

Preflights exposed a native/readback mismatch. Plain Three `setRenderTarget`
bypassed its native output conversion. Public `setOutputRenderTarget` now retains
the native linear buffer/conversion path and uses a plain UNORM output attachment
to avoid a second sRGB encoding. Both engines use the same explicit sRGB browser
profile; no OS display/security settings or fitted image transforms are used.

The final short correctness probe has zero RGB pixel difference between native
and offscreen product/low images in each engine. It also passes a real Windows
PresentMon RAF-only negative control: 120 callbacks without rendering cannot
supply displayed-frame evidence. Its device validation/disposal checks pass.
This probe deliberately does not qualify host load and is performance-ineligible.

The preceding instrument preflights and their failures are retained. One earlier
run accepted seven of eight short passes, with Three's output mismatch still
open. The latest strict preflight accepted zero of eight because CPU activity
stayed above the existing 10% pre-pass limit. These observations do not cancel
other roadmap work or justify weakening the limits. The final output correction
was made afterward and verified by the short correctness probe.

Remaining here: run the complete fresh protocol-3 hardware visual matrix against
the corrected output path, retain the software matrix's actual outcome, complete
all 240 qualified measurements and verify the independent report. No second
physical-device tier or second maintained reference beyond Three was added.

The archive contains sanitized diagnostic exports and exact source snapshots.
Path-bearing report exports have their own stored hashes; embedded original
artifact hashes describe the original local files. These exports are not
resumable run directories. The original local runs remain under ignored `.out/`.
The PresentMon executable is not redistributed; its official pin/provenance and
signature observation are retained. Earlier frozen checkpoints are untouched.
