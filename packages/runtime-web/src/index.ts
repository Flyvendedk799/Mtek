/**
 * The npm entry of `@mtek/runtime-web` (`dist/runtime.js`, `src/runtime.d.ts`): the whole runtime for host code that
 * bundles what it imports. It is the core runtime of `core.ts` plus the host animation API of `animation.ts`
 * (`createAnimationController`, `mapHumanoid`, `retargetHumanoid`, `retargetSkin`, `deformSkin`, ...), all exported
 * synchronously.
 *
 * Game packages do not use this file. `mtek build` embeds the core bundles (`dist/core.js`, `core.dev.js`,
 * `core.min.js`), which contain no skeletal code; a program with a skinned mesh or `clips_from` gets the animation
 * module (`dist/animation.js`) as `animation/<h16>.js` and the runtime imports it at mount (decision 0225).
 */
export * from "./core.js";
export * from "./animation.js";
