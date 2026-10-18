import { color, positionLocal, select, uniform } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, srgb, startTask } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // "Split": a node material with two uniforms, so changing them never rebuilds the shader.
  const edge = uniform(0);
  const accent = uniform(srgb("#2563eb"));
  const split = new MeshBasicNodeMaterial();
  split.colorNode = select(positionLocal.x.lessThan(edge), color(srgb("#e11d48")), accent);

  const cube = boxMesh([1, 1, 1], split);
  cube.name = "Cube";
  scene.add(cube);

  host.onInput("edge", (value) => {
    if (typeof value !== "number") throw new TypeError("edge must be a number");
    edge.value = value;
  });
  host.onInput("accent", (value) => {
    if (typeof value !== "string") throw new TypeError("accent must be a colour string like #22c55e");
    accent.value.copy(srgb(value));
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#0f0f1a",
  };
});
