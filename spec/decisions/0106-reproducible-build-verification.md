# 0106. Reproducible-build verification: what is compared, what is not, and what the result may be taken to prove

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: M7 (blueprint §11), task M7-07 ("reproducible builds and clean-install verification": two fresh clones in different directories, `npm ci && npm run build`, all examples, `dist/` trees compared byte for byte, the full suite from a clean install, no undocumented prerequisite); decision 0104 (the notes name "whether two builds of the same source are byte-identical across machines and operating systems" as unmeasured).
- Supersedes: nothing.

## Context

"Builds are reproducible" is a claim about outputs, and a claim that two builds agree is worth only as much as the differences the comparison could have found. Mtek's outputs carry content hashes in their names (`runtime.<hash>.js`, shader and asset files), embed source maps and are produced by a Rust binary that embeds a JavaScript bundle; any of these could carry a clone's absolute path, a timestamp or an unstable ordering. The release notes had a placeholder for the result (decision 0104), and the README did not say what a clean checkout needs.

## Decision

1. **The check is a committed script, `scripts/verify-reproducible-build.mjs`** (Node, cross-platform, no shell features). It makes two `git clone`s of the repository at its HEAD commit into two different directories whose names and lengths differ (`<root>/a`, `<root>/b-longer-path`), so that a path embedded in an output shows up as a difference. Uncommitted changes are not in the clones, and the report says whether the working tree was clean.
2. **Each clone is built from nothing**: `npm ci`, `npm run build`, every project of `examples/` with the freshly built `mtek` (the release build into the project's own `dist/`, and `dev`, `test` and `preview` into `.repro-out/<example>-<mode>`), and `benchmarks/runtime/tools/prepare.ts`, which builds the seven generated benchmark programs, the generated GLB and PNG assets and the measurement pages. The benchmark workloads are included because they are the one set of Mtek programs, other than the examples, that the repository builds normally, and because their generated assets and bundled pages are outputs that depend on tools other than the compiler.
3. **What is compared is every file of the output trees, by path, size and SHA-256**: `packages/*/dist`, `examples/*/dist`, `.repro-out`, `benchmarks/runtime/.out/site` and the generated inputs of the asset workload. A missing tree in either clone is a failure, not a skip. The only value removed before hashing is the build timestamp `builtAt` that `prepare.ts` writes into `prepared.json` on purpose; the removal is listed in the report (`normalised`). Differing files are reported with the first differing byte and its context, with the clone paths replaced by `<clone-a>` and `<clone-b>`, which makes a path leak read as one.
4. **Path leaks are checked on their own.** Every output file is searched (case-insensitively, in the slash, backslash, escaped-backslash, `file://` and MSYS spellings) for each clone's directory, the shared root and the home directory. A file that contains one fails the check even if both clones happened to agree.
5. **The compiled executable is compared and reported, but does not decide the result** (`target/debug/mtek[.exe]`). It is not an output of the compiler, and its reproducibility is a property of the Rust toolchain and the linker. On Windows with the MSVC linker the first run found the executables to differ in 24 bytes, all of them the link timestamp and the PDB GUID (the executable contains no clone path). That is recorded as a finding; making the build deterministic with a linker flag is a build-configuration change that this task did not make or test.
6. **The check is shown to fail.** A negative control (one byte appended to an output of one clone, one clone path written into an output of the other, run with `--reuse`) was run once and its output is stored; it reported both differences and the leak and exited 1.
7. **The full suite is run from the same clean install** (`--suite`): `npm run check`, `cargo test --workspace --locked` without the grammar backend, `fetch-backend.mjs --all`, the capability check, `cargo test` with the backend required, `test:unit`, `check:coverage`, `check:release`, `MTEK_REQUIRE_GPU=1 npm run test:browser` under the GPU lock, and the VS Code integration suite. The stages, commands and exit codes are in the report.
8. **What the result may be taken to prove** is stated in the evidence and in the release notes: two clones of one commit on one machine and one operating system, with one toolchain, produce byte-identical outputs and no clone path appears in them. It is not evidence about other machines or operating systems, and nothing in the repository claims it; the CI jobs build on Linux and Windows but compare nothing.
9. **Prerequisites are what the run needed.** The README's "Requirements" lists exactly the tools that the run used and the steps (the browser download, the grammar backend, the VS Code download) that only some commands need; a step not listed there was not needed on that machine.

## Consequences

- The release notes can cite a measured result instead of a placeholder (their wording says "one machine and one operating system").
- A future change that makes an output depend on the clone path, the clock or the iteration order of an unordered collection fails the script; it is not run by CI (it needs two full builds), it is run by hand before a release.
- The Windows executable is not reproducible as built; anything that must be (a distributed binary) needs the linker flag and a new comparison.

## Verification

The stored run: [`evidence/M7/reproducible-builds.md`](../../evidence/M7/reproducible-builds.md) (331 files identical, 0 path leaks, the negative control, the suite stages).
