# 0225 — Lazily loaded animation module

Status: accepted and implemented. Date: 2026-10-27.
Extends 0063 (the physics bundle), 0191 (skeletal animation) and 0219 (composable animation, the area this
decision pays for).

## Why

Decisions 0219 to 0223 (blend spaces, humanoid mapping and retargeting, limb solving, `animation.*` in programs)
added about 53 KB to the minified runtime that every game ships: `runtime.min.js` was 689,466 bytes at commit
179ddff6 and 742,916 bytes at 134a8f13. Nine of the twelve game budgets of `budgets/small-games.json` (decision
0137) were over their limits, none of those games has a skinned character, and the owner chose not to raise a
budget but to load the animation code only for the programs that need it, the way the physics engine is loaded
(decision 0063). The budgets are unchanged by this decision.

## Decision

1. **A second file, `animation/<h16>.js`.** The skeletal player (`SkeletonPlayer`), pose layers, blend spaces and
   locomotion, IK and limb solving, humanoid mapping and retargeting (`clips_from`) and the `animation.*` commands
   of programs are an ES module built from `src/animation-module/entry.ts` into `dist/animation.js` (readable) and
   `dist/animation.min.js` (minified). `mtek build` writes it content-addressed, like `physics/<h16>.js`, and the
   manifest names it. Its default export is a `LoadAnimation`: a function returning the animation backend
   (`name`, `createPlayers`, `createCommands`, `retargetHumanoid`, `src/animation-module/backend.ts`).
2. **The rule.** `subsystems.animation` is true, and the module is part of the build, exactly when the scene's
   manifest has a mesh with a `skin` (a skinned glTF mesh) or a non-empty `clipSources` (some entity or prefab uses
   `clips_from`). The compiler decides it from the manifest it has just built, so it agrees with the runtime's scene
   structure by construction (`needsAnimation` in `src/animation-module/load.ts` applies the same rule to the
   resolved structure). Rigid node clips (decision 0190), static glTF meshes and everything else do not need it.
3. **Manifest and ABI.** `subsystems` gains two additive optional keys, `animation` (boolean) and `animationModule`
   (`animation/<h16>.js`, present exactly when `animation` is true); both are absent from a manifest without
   skeletal animation, whose text does not change. The runtime ABI stays 1 and the manifest schema version stays 1
   (`spec/manifest.schema.json`, the generated validator, `MtekManifest`, `spec/runtime-abi.md` sections 2 and 5.2).
4. **Loading.** At mount, in parallel with the shaders, the assets and the physics module, the runtime imports
   `animation/<h16>.js` with `environment.importModule` (an injected `import()` in tests) when the manifest says
   `subsystems.animation`, and gives the backend to the world before `init` runs. A program without the key never
   requests the file. A hot reload or a scene change (`go_to`) imports the candidate's module when it names another
   file than the one loaded, reuses the loaded one otherwise, and drops it when the candidate has none; a candidate
   whose module does not load is refused and nothing is swapped, as for physics (decision 0066).
5. **Failure: `E8114`, kind `animation-failed`.** The code is new in `crates/mtek-compiler/src/diagnostics/codes.rs`
   (`E8114 animation module failed to load`), in the runtime catalogue and in `spec/diagnostics.md` section 5.8. It
   covers a file that is missing or does not parse, a module without a default export that is a function, an
   initialisation that throws, a backend of the wrong shape, and a manifest whose scene has a skinned mesh or
   `clips_from` but not `animation: true`. A mount that hits it rejects with `MtekMountError.kind ===
   "animation-failed"` (added to the kind union of `runtime.d.ts`, `spec/runtime-abi.md` section 6.1); in a
   `--mode preview` build the `import()` is refused outside `baseUrl` like every other request.
6. **The seam in the core.** The core keeps `AnimationPlayers` (`scene/animation-players.ts`), the rigid-clip control
   API that is also the base class of the skeletal one. The world takes its players and its command object from the
   backend when there is one (`WorldOptions.animation`); the module's `SkeletalPlayers` extends the base. Without
   the module a skeletal query answers "no skeleton" and every `animation.*` command is dropped and returns `false`,
   as it already does for an entity without a skeleton. The renderer, the mesh store and the extension API see a
   skeletal player only through `import type`, which costs nothing. `skinProblem` (the validation of a skin) stays
   in the core (`scene/skin-problem.ts`, 1.8 KB) because the mount validates skins before it needs the module.
   The GPU and CPU skinning of the renderer stay in the core (about 8 KB): they are render code, not animation.
7. **Two entries, one npm API.** `@mtek/runtime-web` exports `./dist/runtime.js`, and its host code
   (`createAnimationController`, `mapHumanoid`, `retargetHumanoid`, `retargetSkin`, `deformSkin`, and their types) is
   exported synchronously from there. Before this decision that file, the embedded `runtime.js`/`runtime.dev.js` and
   the release `runtime.min.js` were all built from `src/index.ts`, so the game bundle and the npm entry were the
   same code. Now `src/core.ts` is the core runtime, `src/index.ts` is `core` plus `animation.ts`, and the build
   writes `dist/core.js`, `dist/core.dev.js` and `dist/core.min.js` (which `mtek` embeds and writes as
   `runtime.<h16>.js` in `preview`, `dev`/`test` and `release` builds) and `dist/runtime.js` (the npm entry, not
   embedded). The npm entry's `mountMtek` loads the module of a program exactly as a game's runtime does; its
   bundled copy of the skeletal code serves host code. `dist/runtime.dev.js` and `dist/runtime.min.js` no longer
   exist: nothing outside the CLI used them.
8. **The CLI.** `mtek-cli/build.rs` embeds `core.js`, `core.dev.js`, `core.min.js`, `animation.js` and
   `animation.min.js` with `runtime.d.ts` and `physics.js` from `packages/runtime-web/dist/` or the prebuilt copy
   (`crates/mtek-cli/prebuilt/`, whose files are renamed accordingly; `scripts/prebuilt-runtime.mjs` writes and
   checks the new files and deletes the old names). `CompileOptions` gains `animation_bundle`
   (`STUB_ANIMATION_BUNDLE` for compiler tests); `release` builds pass the minified module, every other mode the
   readable one. A program that needs the module without one available to the compiler is `E9030`, like physics.
9. **Declarations.** `runtime.d.ts` keeps describing the whole npm entry, which is what `src/runtime.d.ts` has always
   been (`types` of the package). The `runtime.<h16>.js` of a built game exports the core only; the five host
   animation functions are not in it (they never were a documented part of a built game's runtime: host code
   bundles the npm entry, `docs/platform-runtime.md`). The emitted `runtime.d.ts` is not split; this is recorded
   as a limit below.

## Measured

Minified, esbuild metafile (`bytesInOutput`), with the commit before this decision as the baseline:

| | bytes |
|---|---|
| `runtime.min.js` of 179ddff6 (before decision 0219) | 689,466 |
| `runtime.min.js` of 134a8f13 (before this decision) | 742,916 |
| `core.min.js` (this decision) | 668,982 |
| `animation.min.js` (a game with skins pays this on top) | 83,163 |

The module holds `limb-ik` 17,911, `skeleton` 13,209, `humanoid` 8,664, `animation-script` 7,331, `blend-space` 6,891,
`ik` 6,115, `humanoid-retarget` 4,923, `humanoid-rig` 4,047, `pose-layers` 3,824, `clips` 3,767 (a second copy: the
core keeps its own for rigid clips), `skin-problem` 1,810 (a second copy), `mat4` 1,338 (a second copy), `locomotion`
1,186, `animation-players` 942 and `pose-schedule` 852 bytes. The loader, the seam and the manifest validation cost
the core about 6 KB (the generated manifest validator alone is 3.4 KB larger for the two new keys). All 53,450 bytes
added between 179ddff6 and 134a8f13 are gone from the core, and so are 20,484 more: the skeletal player of decision
0191 and the host animation API (`animation.ts`, `retarget.ts`), which every game also carried before. `retarget.ts`
and `animation.ts` are in no game at all now; only the npm entry has them.

Game package sizes (`npm run check:budgets`, folder bytes, limits unchanged): the nine games that were over now
hold (for example `pulse-cube` 791,903 to 717,988 of 740,000 and `stage-show` 792,199 to 718,284 of 740,000); the full
table is in the report of the change. `character-movement` and `physics-playground` shrink by the same 74 KB.

## Tests

- `src/animation-module/load.test.ts`: the loader with an injected importer (success, a missing file, a module
  without a usable default export, an initialisation that fails, a backend of the wrong shape, no module in the
  manifest, the reload phase) and the rule (`needsAnimation`, `animationMismatch`).
- `src/animation-module/mount.test.ts`: a program without skeletal animation never requests `animation/`; one that
  declares it imports it once and gives the backend to the world; a module that fails rejects the mount with
  `animation-failed`; a reload loads, reuses, replaces, drops or refuses (`E8114`, phase `runtime:reload`).
- `src/release-bundle.test.ts`: no skeletal source contributes a byte to any core flavour, the module contains them
  and nothing of the renderer, the npm entry contains everything, and `core.min.js` stays within 695,466 bytes
  (689,466 + 6,000), so a regression of the budget fails a unit test.
- `crates/mtek-compiler/tests/assets.rs`: the module is written exactly for the programs of `tests/assets/pass` that
  have a skin or `clips_from`, named by the hash of its bytes, and a program that needs it without one is `E9030`.
- `crates/mtek-cli/tests/cli.rs` and `prebuilt.rs`: real builds in every mode, the minified module in `release` and
  the readable one elsewhere, no `animation/` and no manifest key for a program without skins, no skeletal code in the
  embedded core and all of it in the module.
- `tests/abi/manifests`: the valid example has the keys, and four invalid examples break them.
- The browser specs that mount skinned programs (`tests/browser/specs/animation`, the inspection, vertex-deformation
  and character-composition specs, `m5`) run unchanged against the new bundles.

## Limits

- A host that serves a game must serve `animation/` too (and `physics/` for bodies). `docs/platform-runtime.md` and
  `docs/preview-hosting.md` say so. The file is requested at start, not later: the mount waits for it, together with the shaders and the assets.
- The two entries duplicate the skeletal code once more in the npm bundle, which hosts bundle themselves.
- `runtime.d.ts` in a built `dist/` is the declaration of the npm entry; it lists the host animation functions that
  the built game's `runtime.<h16>.js` does not export.
- Decision 0137's budgets are not edited; the tests above guard the margin that makes them hold.
