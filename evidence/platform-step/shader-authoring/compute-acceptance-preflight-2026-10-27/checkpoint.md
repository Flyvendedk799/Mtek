# Compute acceptance preflight

Date: 2026-10-27. Status: **CPU preflight checked; GPU execution NOT-RUN**.
This advances the shader-authoring plan without closing its acceptance criteria.
Ordinary source analysis/build still emits E4901.

The focused `tests/browser/compute.config.ts` discovers two probes on each of
hardware and software (four planned runs). Its setup prepares only the environment
page and compute package. It does not prepare the broad browser/benchmark corpus,
build the CLI or request a GPU. Probe actions request devices only when explicitly
run in a browser. No browser or GPU process was launched for this checkpoint.

The existing Rust packaging test exports the actual compiler fixture with a real
development runtime under its actual content hash, retaining source/runtime/file
hashes. Node preparation verifies every file and records reference/harness hashes.
The test harness bypasses only E4901 after proving it is the sole analysis error;
no production compiler bypass flag is added. The shared fixture now has eight
kernels, including an invocation probe for all fourteen input fields.

Independent CPU and handwritten WGSL references cover f32 arithmetic, typed
parameters, nonzero-offset input views, logical domains 1/71/72/3×4×6, rounded
workgroups, unused output tails and all invocation coordinates/group fields.
The reference's initial 64-byte record assumption failed the CPU export check:
the correct storage layout is fourteen u32 members at stride 56. That assumption
was corrected before any GPU run. Naga accepts all three handwritten reference
shaders and rejects the deliberately invalid fragment return.

The prepared rendering probe compares computed positions with CPU and direct-WGSL
geometry rendered through an independent projection/flat-color pipeline. It
requires an observable image change, recovery of completed output rather than a
staged edit, original-image restoration on detach, state preservation on reset,
handle/lease invalidation on replacement, and zero tracked resources on disposal.
It retains raw numerical buffers, pixels, package provenance and a preview image
when run. Pixel tolerances and actual browser/driver behavior are **not validated**
by preparation, listing, bundling, Naga or CPU fakes.

CPU checks pass: 11 compiler compute-lowering tests, four reference/preparation
tests and 170 focused runtime contract/lifecycle/ABI tests. Browser TypeScript,
focused lint, compiler Clippy and formatting pass. Playwright lists four tests
and executes zero; that is discovery evidence only. The prebuilt runtime still
matches its sources/dist. Production runtime/budget artifacts are unchanged from
the preceding render-bridge checkpoint. No sustained benchmarking or animation
optimization was performed.

Commands and boundaries are in `validation.json`. Run instructions and coverage
limits are in [COMPUTE-ACCEPTANCE.md](../../../../tests/browser/COMPUTE-ACCEPTANCE.md).
Actual numerical/render GPU acceptance, shadow references, composite arithmetic
and additional physical devices remain required work.
