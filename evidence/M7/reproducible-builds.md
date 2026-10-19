# M7-07 Reproducible builds and clean-install verification

- Work item: M7-07 (blueprint §11, M7). Decision: [0106](../../spec/decisions/0106-reproducible-build-verification.md).
- Run: 2026-10-19, Windows 11 (10.0.26200, x64), Node v24.18.1, npm 11.16.0, `rustc 1.99.0` (host `x86_64-pc-windows-msvc`), one machine.
- Source: the commit `7cf7ce9029e0d0b13e4c1e3e483c3dd26b3a466e`, cloned with `git clone` from the local repository into two directories (`a` and `b-longer-path`, different names and different lengths) and checked out detached. The working tree of the source had no uncommitted change (`workingTreeClean: true` in [`comparison.json`](reproducible-builds/comparison.json)).
- Tool: [`scripts/verify-reproducible-build.mjs`](../../scripts/verify-reproducible-build.mjs). The run below is its second complete run (`--suite`); the first run (without `--suite`) gave the same 331 file hashes, file for file (checked by comparing the two reports; the first report is not stored because the second contains everything it contained).

## Result

**The output trees of two fresh clones are byte-identical: 331 files, 90 229 660 bytes, 0 differing, 0 only in one clone, and no output file contains the path of either clone, of their shared root or of the home directory.** The same was true of the first run. This proves reproducibility for two clones of one commit on this machine and operating system, with this toolchain. **It does not prove it across machines or operating systems**: no other machine and no Linux or macOS build was compared (the CI jobs build on Linux but do not compare outputs).

What was compared, by tree (every file by path, size and SHA-256; the full list is `files` in [`comparison.json`](reproducible-builds/comparison.json)):

| Tree | Files | Bytes |
|---|---|---|
| `packages/runtime-web/dist` (`runtime.js`, `runtime.dev.js`, maps, `runtime.d.ts`) | 5 | 4 595 133 |
| `packages/physics-rapier/dist` | 1 | 4 410 320 |
| `packages/editor-vscode/dist` | 4 | 2 748 508 |
| `examples/pulse-cube/dist` (release build, `mtek build examples/pulse-cube`) | 9 | 823 588 |
| `examples/material-configurator/dist` | 12 | 1 032 918 |
| `examples/physics-playground/dist` | 12 | 5 331 983 |
| `examples/modular-scene/dist` | 9 | 841 968 |
| `.repro-out/<example>-<mode>` (the four examples in `dev`, `test` and `preview` mode) | 130 | 24 197 879 |
| `benchmarks/runtime/.out/site/mtek` (the seven benchmark programs built by `benchmarks/runtime/tools/prepare.ts`; `mount-reload-dispose` in `dev` mode and its edited variant) | 82 | 23 396 842 |
| `benchmarks/runtime/.out/site/pages` (measurement pages bundled per workload and implementation) | 44 | 14 864 337 |
| `benchmarks/runtime/.out/site/assets` (the generated GLB and PNG files of `asset-heavy-startup`) | 10 | 3 982 901 |
| `benchmarks/runtime/.out/site` (`env-probe.js`, `env.html`, `sizes.json`, `prepared.json`) | 4 | 21 063 |
| `benchmarks/runtime/asset-heavy-startup/mtek/{models,textures}` (generated inputs of that program) | 9 | 3 982 220 |
| **Total** | **331** | **90 229 660** |

One value is removed before hashing: `builtAt`, the build timestamp that `prepare.ts` writes into `benchmarks/runtime/.out/site/prepared.json` on purpose (`normalised` in `comparison.json`). Every other byte of every file is compared as written.

### The comparison output

```
compared 331 files of clone a and 331 of clone b: IDENTICAL (0 differing, 0 only in a, 0 only in b); no path leaks
```

### The comparison can fail (negative control)

A comparison that has never been seen to fail proves little. After the first run, one byte sequence was appended to `app.js` of clone `a` (`/* x */`) and a comment containing the path of clone `b` to `index.html` of clone `b`, and the script was run again with `--reuse` (same clones, nothing rebuilt). It reported both differences and the leak, and exited 1 ([`negative-control.txt`](reproducible-builds/negative-control.txt)); the two files were then restored.

### The compiled executable is not byte-identical, and why

`target/debug/mtek.exe` (the Rust debug build that `npm run build` makes) has the same size in both clones (29 852 160 bytes) and **different hashes**. It is reported as information and does not decide the result, because it is not an output of the compiler (`dist/`) and its reproducibility is a property of the Rust toolchain on Windows, not of Mtek. The difference was located: exactly 24 bytes differ, in four places and nowhere else: the PE header's `TimeDateStamp` (offset 0xF0), the three timestamps of the debug directory, and the 16-byte GUID of the CodeView record that names `mtek.pdb`. They are the link time and the PDB signature that the MSVC linker writes unless it is told to build deterministically (`/Brepro`); the executable contains the name `mtek.pdb` and no path of the clone. (The home directory does occur in it, as the path of the cargo registry in panic locations of dependencies; that is the same in both clones and is why `pathsFound` lists `home`.) No code, data or string differs. Not changed: the link flag would be a build-configuration decision outside this task, and building with it was not tried, so that `/Brepro` makes the executable identical is a hypothesis, not a result.

The `mtek` executable that matters for the outputs above is the same compiler in both clones; the identical `dist/` trees are the evidence that its output does not depend on the clone.

## Clean-install run of the full suite

From clone `a`, after `npm ci` and `npm run build` (nothing else was installed or edited by hand; the stages are in [`suite-stages.tsv`](reproducible-builds/suite-stages.tsv), the steps of both clones in [`steps.tsv`](reproducible-builds/steps.tsv)):

| Stage | Command | Result |
|---|---|---|
| Install | `npm ci` (clone a: 17.8 s; clone b: 17.6 s) | exit 0 |
| Build | `npm run build` (41.5 s; 41.6 s) | exit 0 |
| Check | `npm run check` | exit 0 |
| Rust without the grammar backend | `cargo test --workspace --locked` | exit 0: **1594 passed, 0 failed, 1 ignored** ([`cargo-test-clean-install-without-backend.txt`](reproducible-builds/cargo-test-clean-install-without-backend.txt)); the backend-dependent suites print NOT-RUN and succeed (decision 0073) |
| Backend | `node tools/grammar-adapters/fetch-backend.mjs --all` | exit 0 (122.9 s): llama.cpp b11719 source archive verified, its GBNF validator built with CMake and the Visual Studio C++ tools, the release archive verified, the 1.1 GB model verified |
| Capability | `target/debug/grammar-adapter check --format json` | exit 0, `"status": "available"` ([`grammar-capability-clean-install.json`](reproducible-builds/grammar-capability-clean-install.json)) |
| Rust with the backend required | `MTEK_REQUIRE_GBNF_VALIDATOR=1 MTEK_REQUIRE_GBNF_BACKEND=1 cargo test --workspace --locked` | exit 0: **1594 passed, 0 failed, 1 ignored** ([`cargo-test-clean-install.txt`](reproducible-builds/cargo-test-clean-install.txt)); the conformance suite and the smoke ran for real |
| TypeScript unit | `npm run test:unit` | exit 0: 1245 + 78 + 78 + 296 + 1932 + 169 (+1 skipped) + 8 + 112 + 207 + 50 + 85 passed, 0 failed ([`unit-tests-clean-install.txt`](reproducible-builds/unit-tests-clean-install.txt)) |
| Coverage matrix | `npm run check:coverage` | exit 0 |
| Release documentation | `npm run check:release` | exit 0 (before this task changed the release notes) |
| Browser, all projects | `MTEK_REQUIRE_GPU=1 npm run test:browser` | exit 0: **591 passed, 0 failed, 0 not-run, 15 skipped** (hardware 251, software 236 with the 15 skipped, benchmarks 104); stored as [`environments/windows11-rx7900xtx-chromium-153`](environments/windows11-rx7900xtx-chromium-153/summary.md) |
| VS Code | `npm run test:integration -w mtek-vscode` | exit 0: **10 passed, 0 failed** in a real VS Code ([`vscode-integration-clean-install.txt`](reproducible-builds/vscode-integration-clean-install.txt)) |

The 15 skipped tests of the software project are the pixel-exact specs of `specs/m6/mtek-test.spec.ts`, which are hardware-only by design (the skip reason is in the summary).

Not run in this task: `MTEK_REQUIRE_GPU=1 npm run test:benchmarks` separately (its project is part of `test:browser` above, 104 tests); the Mtek references through the repair harness (`tools/ai-eval validate`, M6 gate); a clone on Linux or macOS.

## Prerequisites actually needed

Discovered by doing the run above on the development machine, and written into [`README.md`](../../README.md) (Requirements):

- **Nothing had to be edited or installed by hand for `npm ci`, `npm run build`, the build of every example, `npm run check`, `cargo test`, `npm run test:unit`, `npm run check:coverage` and `npm run check:release`**, beyond the tools on `PATH`: Git, Rust 1.99.0 (rustup installs it from `rust-toolchain.toml`; the MSVC target uses the Visual Studio Build Tools' linker), Node 24 with its npm 11.16.0 (`.npmrc` has `engine-strict=true`), and network access (npm registry, crates.io).
- **The browser** that Playwright drives. On this machine Playwright's Chromium 153 was already in the user's browser cache from earlier work, so this run did not exercise the download; the documented command is `npx playwright install chromium`. Its effect from an empty cache is recorded under "Playwright's browser from an empty cache" below.
- **A real GPU with WebGPU** for the `hardware` and `benchmarks` projects (`MTEK_REQUIRE_GPU=1` fails the run without one). The GPU lock named in the script's `--gpu-lock` option is only a way to take turns on a shared machine, not a prerequisite.
- **For the grammar backend**: CMake and a C++ toolchain (found through the Visual Studio installation on this machine) and network access; ~1.1 GB of downloads. `cargo test` passes without it.
- **For the VS Code integration test**: network access to download the pinned VS Code and a display.

## Playwright's browser from an empty cache

Because the cache already held the browser during the suite run, the documented install was tried separately: `PLAYWRIGHT_BROWSERS_PATH=<an empty directory> npx playwright install chromium` exited 0 and downloaded Chromium 153.0.8010.12, its headless shell, FFmpeg and `winldd` (707 MB on disk in total), and with only that directory as the browser location `MTEK_REQUIRE_GPU=1 npm run test:browser -- --project=hardware specs/m1` ran the 9 tests of `specs/m1` on the hardware adapter: 9 passed, 0 failed, 0 not-run ([`playwright-empty-cache.txt`](reproducible-builds/playwright-empty-cache.txt)). That run was made from the working copy of the task branch after the clean-install run (same machine), not from one of the two clones. The Edge and Chrome runs of the environment matrix use the browsers installed on the machine (no download) with `MTEK_BROWSER_CHANNEL=chrome` or `msedge`.

## Reproduce

```
node scripts/verify-reproducible-build.mjs --root <dir> --out <report.json> [--suite --gpu-lock <dir>]
```

The report has no absolute path; the log files of every step are written to `<dir>/logs/` (not stored: they contain the paths of the machine).
