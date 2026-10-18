import { type Mesh, Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const MAX_PIPS = 5;

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

  // The Pips in the order they were added; the n-th one (1-based) stands at x = -6 + 2n.
  const pips: Mesh[] = [];
  const removeLast = (): void => {
    const pip = pips.pop();
    if (pip === undefined) return;
    scene.remove(pip);
    pip.geometry.dispose();
    (pip.material as { dispose(): void }).dispose();
  };

  host.onKeyDown("Space", () => {
    if (pips.length >= MAX_PIPS) return;
    const pip = createPip(-6 + 2 * (pips.length + 1));
    pips.push(pip);
    scene.add(pip);
  });
  host.onKeyDown("Backspace", removeLast);
  host.onKeyDown("Enter", () => {
    while (pips.length > 0) removeLast();
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
