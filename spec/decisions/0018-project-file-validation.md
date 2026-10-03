# 0018. `mtek.toml` validation rules the specification leaves open

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §10 (tooling), `spec/tooling.md` §3.

## Context

`spec/tooling.md` §3 says that unknown tables or keys, wrong types and out-of-range values in `mtek.toml` are `E9001` "with the exact key path", but lists no ranges, no rule for the shape of paths and scene names, and does not say where the diagnostics point. Task M1-07 (project loading) has to decide, because the manifest schema (`spec/manifest.schema.json`) and the runtime depend on the values.

## Decision

All of the following are **proposals** (design choices, not external facts), implemented in `crates/mtek-compiler/src/project/`.

1. **Ranges.** Every runtime constant must satisfy the manifest schema's lower bound and gets a generous upper bound so that a typo cannot produce an unusable program:

   | Key | Accepted values | Reason |
   |---|---|---|
   | `runtime.fixed_step` | finite number, `0 < x <= 1` (seconds) | manifest: `exclusiveMinimum: 0` |
   | `runtime.max_frame_delta` | finite number, `0 < x <= 1` (seconds) | manifest: `exclusiveMinimum: 0` |
   | `runtime.max_catch_up_steps` | integer `1 ..= 1000` | manifest: `minimum: 1` |
   | `runtime.max_entities` | integer `1 ..= 1 048 576` | manifest: `minimum: 1`; the upper bound is 2^20 |
   | `dev.port` | integer `1 ..= 65535` | port 0 contradicts "default 5173, falls back to the next free port" |
   | `assets.max_file_bytes` | integer `1 ..= 4 294 967 295` | a binary glTF file stores its lengths as 32-bit values, so no valid asset is larger |

   Integers are accepted where a number is expected (`max_frame_delta = 1`); a float is never accepted where an integer is expected. `inf` and `nan` are out of range.

2. **Shapes.**
   - `project.name` matches `[a-z0-9-]+` exactly (non-empty).
   - `project.language` must equal the compiler's language version as a string (`"0.1"`); no prefix or numeric forms.
   - `project.entry` is a project-relative path with `/` separators that stays inside the project root (the rules of `ProjectPath`) and whose file name ends in `.mtek` and has a non-empty stem. It is stored normalised (`./a/../b.mtek` becomes `b.mtek`).
   - `project.scene` is an ASCII identifier (`[A-Za-z_][A-Za-z0-9_]*`); whether such a scene exists is decided against the parsed entry module (`E9006`, M1-09, `project::select_scene`).
   - `build.out_dir` is a project-relative path inside the root and must not contain the entry file, because a build would overwrite (or `mtek build` clean) the sources. `build.target` must be `"web"`. `build.title` is any string.
   - `[host.inputs]` values must be strings; the `Scene.state_name` form is validated against the program in M3 (`E9020`, `E9021`). Until then a non-empty table is parsed and kept but reported as `E9010`.

3. **All problems at once, in file order.** One run reports every `E9001` of the file, ordered by byte position (the TOML parser's tables are sorted, so the order is explicit, not a map-iteration accident). A file with any `E9001` yields no configuration, so unknown keys are errors even if the rest is valid. An invalid TOML document yields a single `E9001`.

4. **Location.** `mtek.toml` is not a source module: it is not in the `SourceMap` and has no `FileId`. Its diagnostics therefore have `source: null`, as `spec/diagnostics.md` §2.1 allows for project-level diagnostics, and carry the exact key path in the message (`'runtime.max_catch_up_steps'`, keys that are not TOML bare keys quoted: `host.inputs."a b"`) plus a note `at mtek.toml:LINE:COLUMN` (1-based, columns in Unicode scalar values, byte-order mark not counted). Giving `mtek.toml` a `FileId` so that these diagnostics carry real spans is possible later (it would be the first file of the `SourceMap`); it is not done now because file ids follow module load order (`spec/language.md` §9.4) and consumers such as the build identifier treat `mtek.toml` separately (`spec/runtime-abi.md` §5.3).

5. **Help.** An unknown key gets a `help:` listing the valid keys of its table and, when exactly one valid name is within edit distance 2, a "did you mean" naming its full path; a key that belongs to another table is pointed there. These are notes, never suggested edits (`spec/diagnostics.md` §6: an edit needs a re-checked, meaning-preserving change).

6. **Project root.** `ProjectRoot::discover` walks from a start directory up to the base of the `Fs` and takes the nearest directory containing a *file* named `mtek.toml` (case-exact; a directory of that name does not count). `Project::load` reads everything through a `ProjectFs` view rooted at that directory, so every `ProjectPath` in the compiler is project-relative as `spec/compiler-architecture.md` §4.1 requires.

## Consequences

Programs that wrote an out-of-range value the specification did not forbid (for example `max_catch_up_steps = 5000`) are rejected; the ranges can be widened by a later record without breaking existing projects. A future task that adds `mtek.toml` to the `SourceMap` replaces point 4 and supersedes this record.

## Verification

`crates/mtek-compiler/src/project/parse/tests.rs` (every default, every `E9001` path with message, key path and location, every range bound), `crates/mtek-compiler/src/project/load/tests.rs` and `crates/mtek-compiler/tests/project_loading.rs` (loading, `E9004`, `E9005`, `E9010`, JSON envelopes validated against `spec/diagnostic.schema.json`).
