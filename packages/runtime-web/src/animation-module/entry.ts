/**
 * The entry of the animation module (`dist/animation.js`, written by `mtek build` as `animation/<h16>.js`; decision
 * 0225): the default export is the {@link LoadAnimation} the runtime calls after importing the file. Everything
 * skeletal is reachable only from here, so a bundle of `core.ts` contains none of it.
 */
import { AnimationScript } from "../scene/animation-script.js";
import { retargetHumanoid } from "../scene/humanoid-retarget.js";
import { SkeletalPlayers } from "../scene/skeleton.js";
import type { AnimationBackend, LoadAnimation } from "./backend.js";

/** The backend itself, synchronously: what tests pass to a `World` without importing a file. */
export function createAnimationBackend(): AnimationBackend {
  return {
    name: "mtek-animation",
    createPlayers: () => new SkeletalPlayers(),
    createCommands: (host) => new AnimationScript(host),
    retargetHumanoid,
  };
}

const load: LoadAnimation = createAnimationBackend;
export default load;
