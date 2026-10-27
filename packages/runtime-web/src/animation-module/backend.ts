/**
 * The interface between the core runtime and the animation module (decision 0225, `spec/runtime-abi.md` section 5.2).
 *
 * Skeletal animation (skeleton players, pose layers, blend spaces, IK, limb solving, humanoid retargeting and the
 * `animation.*` commands of programs) is a separate ES module, `animation/<h16>.js`, that the runtime imports with a
 * dynamic `import()` only for a program whose manifest says `subsystems.animation` (a skinned mesh or `clips_from`).
 * The module's default export is a {@link LoadAnimation}. The core never imports skeletal code: it sees only this
 * interface, and the types below are erased at build time (type-only imports), so they cost the core nothing.
 */
import type { MtekSkin } from "../abi/manifest-types.js";
import type { AnimationPlayers } from "../scene/animation-players.js";
import type { AnimationScript, ScriptHost } from "../scene/animation-script.js";

export type { ScriptCode, ScriptHost } from "../scene/animation-script.js";

/** The `animation.*` composition commands (decision 0223) of one world. */
export type AnimationCommands = AnimationScript;

/** What the animation module provides to a world. */
export interface AnimationBackend {
  /** Identifies the implementation in diagnostics, like the physics backend's name. */
  readonly name: string;
  /** The clip players of a world: rigid-node clips plus the skeletal players of its skinned entities. */
  createPlayers(): AnimationPlayers;
  /** The composition commands of a world, resolving entities through `host`. */
  createCommands(host: ScriptHost): AnimationCommands;
  /** `clips_from` (decision 0223): the clips of `source` retargeted onto `target`; throws `RangeError` with the reason. */
  retargetHumanoid(source: MtekSkin, target: MtekSkin): MtekSkin;
}

/** The default export of `animation/<h16>.js`. */
export type LoadAnimation = () => AnimationBackend | Promise<AnimationBackend>;
