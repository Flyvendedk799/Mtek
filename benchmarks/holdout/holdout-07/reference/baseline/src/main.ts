import { Scene } from "three/webgpu";
import { lookAtCamera, sphereMesh, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  const sun = sphereMesh(0.8, unlit("#fbbf24"));
  sun.name = "Sun";

  const planet = sphereMesh(0.5, unlit("#38bdf8"));
  planet.name = "Planet";
  planet.position.set(3, 0, 0);

  const moon = sphereMesh(0.3, unlit("#e2e8f0"));
  moon.name = "Moon";
  moon.position.set(1, 0, 0);
  planet.add(moon);

  scene.add(sun, planet);

  let planetAngle = 0;
  let moonAngle = 0;
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 10], target: [0, 0, 0] }),
    clearColor: "#0a0a14",
    update(dt) {
      planetAngle += 0.8 * dt;
      moonAngle += 2.5 * dt;
      planet.position.set(3 * Math.cos(planetAngle), 3 * Math.sin(planetAngle), 0);
      moon.position.set(Math.cos(moonAngle), Math.sin(moonAngle), 0);
    },
  };
});
