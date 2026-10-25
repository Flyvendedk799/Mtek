import type { MtekSkin } from "../abi/manifest-types.js";
import { identity } from "../math/mat4.js";

/** A two-segment chain, plus an independently movable mesh node. */
export function animatedSkin(): MtekSkin {
  const node = (name: string, parent: number, x: number) => ({
    name,
    parent,
    translation: [x, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  return {
    meshNode: 0,
    nodes: [
      node("mesh", -1, 0),
      node("root", -1, 0),
      node("elbow", 1, 1),
      node("hand", 2, 1),
    ],
    joints: [1, 2, 3],
    inverseBind: [
      Array.from(identity()),
      Array.from(identity()),
      Array.from(identity()),
    ],
    indices: [
      [0, 1, 2, 0],
      [1, 2, 0, 0],
      [2, 0, 0, 0],
    ],
    weights: [
      [0.25, 0.5, 0.25, 0],
      [0.5, 0.5, 0, 0],
      [1, 0, 0, 0],
    ],
    clips: [
      {
        name: "walk",
        duration: 1,
        channels: [
          {
            node: 1,
            path: "translation",
            interpolation: "linear",
            times: [0, 1],
            values: [0, 0, 0, 2, 0, 0],
          },
        ],
      },
      {
        name: "action",
        duration: 1,
        channels: [
          {
            node: 2,
            path: "rotation",
            interpolation: "linear",
            times: [0, 1],
            values: [0, 0, 0, 1, 0, 0, 1, 0],
          },
        ],
      },
      {
        name: "breathe",
        duration: 1,
        channels: [
          {
            node: 2,
            path: "translation",
            interpolation: "linear",
            times: [0, 1],
            values: [1, 0, 0, 1, 1, 0],
          },
        ],
      },
    ],
  };
}
