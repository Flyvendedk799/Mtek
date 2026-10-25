import { type Mesh, Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

/** One Pip: a small sky-blue block at (x, 0, 0). */
export function createPip(x: number): Mesh {
  const pip = boxMesh([0.8, 0.8, 0.5], unlit("#38bdf8"));
  pip.name = "Pip";
  pip.position.set(x, 0, 0);
  return pip;
}

void startTask((host) => {
  const scene = new Scene();

  const rail = boxMesh([12, 0.2, 0.2], unlit("#404040"));
  rail.name = "Rail";
  rail.position.set(0, -1.5, 0);
  scene.add(rail);

  // Track pips: store them in order of creation
  const pips: Mesh[] = [];
  // Positions for pips: x = -4, -2, 0, 2, 4 (which is -6 + 2n for n = 1, 2, 3, 4, 5)
  const positions = [-4, -2, 0, 2, 4];

  host.onKeyDown("Space", () => {
    if (pips.length < 5) {
      const pos = positions[pips.length];
      if (pos !== undefined) {
        const newPip = createPip(pos);
        pips.push(newPip);
        scene.add(newPip);
      }
    }
  });

  host.onKeyDown("Backspace", () => {
    if (pips.length > 0) {
      const removedPip = pips.pop();
      if (removedPip) {
        scene.remove(removedPip);
      }
    }
  });

  host.onKeyDown("Enter", () => {
    // Remove all pips
    for (const pip of pips) {
      scene.remove(pip);
    }
    pips.length = 0;
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
