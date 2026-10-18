import { clamp, color, mix, uniform } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, srgb, startTask } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // The host input `lift` is stored here.
  const state = { lift: 0 };
  host.onInput("lift", (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("lift must be a finite number");
    state.lift = value;
  });

  // "Heat": a node material that blends two colours by the uniform `warmth`, limited to 0..1.
  const warmth = uniform(0);
  const heat = new MeshBasicNodeMaterial();
  heat.name = "Heat";
  heat.colorNode = mix(color(srgb("#1e3a8a")), color(srgb("#f97316")), clamp(warmth, 0, 1));

  const cube = boxMesh([1, 1, 1], heat);
  cube.name = "Cube";
  scene.add(cube);

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
    // The height first, then the colour from the height the cube has now: the colour never lags a frame.
    update() {
      cube.position.y = state.lift;
      warmth.value = cube.position.y / 2;
    },
  };
});
