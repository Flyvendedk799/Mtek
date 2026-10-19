# 0117. Every Mtek code block of the documentation is compiled by a test, and a block that is wrong on purpose must produce its code

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: M7 (blueprint §11), follow-up task K-03; decisions 0091 (the getting-started page is executed), 0100 (the guide copies programs from files of the repository), 0116.
- Supersedes: nothing.

## Context

The guide of decision 0100 was safe because it copied whole files and excerpts of files that the compiler's own suites check. A concept page needs examples that no file of the repository contains: a prefab with a parameter, a material with a sampler, the mistake that raises `MTEK-E5074`. Such examples drift. A page that teaches a program that no longer compiles, or a mistake that no longer raises the stated code, is worse than no page.

## Decision

1. **Every fenced block of the pages under test has a language, and a block with the language `mtek` (or `toml` or `diff` in a project) is checked.** The pages under test are the concept pages, the tutorial, the index and the compact guide. `npm run check:release` runs `mtek check --format json` on each block (`tools/release-docs/src/doccode.ts`); the same check runs in the unit tests of the package. The forms, written in the info string of the fence:

   | Fence | What the test does |
   |---|---|
   | `mtek` | The block is a whole program. `mtek check` reports no error and no warning, and `mtek fmt --check` finds it canonical (a block marked `nofmt` is excused from the layout). A block without a `scene` is compiled with an empty scene that has a camera added, so that items can be shown alone. |
   | `mtek wrong=MTEK-E5070` | `mtek check` reports exactly the listed error codes (comma separated) and no other error. `warn=MTEK-W5101` says the block compiles and reports that warning. The page's prose must name the code (`docs/wrong-cited`). |
   | `mtek wrap=scene` , `wrap=entity`, `wrap=update` | A fragment: its lines are put inside a scene that has a camera, inside an entity of such a scene, or inside `update(dt: f32) { ... }`. The same `wrong=` rules apply. Fragments are not held to the layout. |
   | `mtek from=PATH` | A part of a file of the repository, written by `{{example}}` and `{{excerpt}}`. The text must occur in that file. |
   | `mtek project=ID file=PATH` and `diff project=ID [file=PATH]` | A file of a project built up through the page, and an edit of such a file: the lines with a space and a minus must occur once together, as in the getting-started walkthrough. The project is compiled after each block that writes `src/main.mtek`, in page order. `wrong=` on such a block says the state after it must fail. |
   | `toml manifest` | An `mtek.toml`, accepted by `mtek check` with a scene `Demo` that has the states `tint: color`, `speed: f32` and `levels: array<f32, 2>`; `wrong=MTEK-E9001` (or another code) says it must not be. |
   | any other language (`text`, `console`, `sh`) | Not checked. A fence with no language, an unknown attribute or a diff without a project is an error (`docs/code-form`). |
2. **The assets.** The files of `tests/assets/pass/assets_supported` (`models/chair.glb`, `textures/wood.png`, `textures/mask.png`) are copied into every project as `models/` and `textures/`, so that examples can declare assets with the paths a real project has (`"../textures/wood.png"` from `src/main.mtek`).
3. **The compiler is the ground truth.** A rule is written into a page only after a snippet that shows it was compiled. When the compiler and `spec/` disagree, the page follows the compiler and the disagreement is reported in the completion report (see Consequences).
4. **A wrong block names codes, not messages.** The wording of a diagnostic may change (task K-02 improves it); its code is stable.
5. **Cost.** The blocks compile in parallel, six at a time; the whole documentation takes about ten seconds.

## Consequences

- A page cannot keep a program that stopped compiling, nor a mistake that stopped being one.
- A change to the formatter that moves a line breaks every block it moves. The test message prints what `mtek fmt` would write, so that the page can be fixed by pasting.
- The checks found, while the pages were written, rules that `spec/` states differently from the compiler or does not state; they are listed in the completion report of K-03. The pages describe the compiler.

## Verification

`tools/release-docs/test/doccode.test.ts`: the parser and the forms with synthetic pages and a fake compiler; the real compiler on a passing block, a wrong block with the right and with a wrong code, a layout mismatch, a failing diff, a project, a manifest and a `from=` block. `npm run check:release` compiles all blocks of the repository. Recorded in the completion report of K-03.
