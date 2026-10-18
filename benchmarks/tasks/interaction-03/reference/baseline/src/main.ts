import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, srgb, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const ON = "#ffd24a";
const OFF = "#3a3a3a";

void startTask((host) => {
  const scene = new Scene();

  const materialA = unlit(OFF);
  const lampA = boxMesh([2, 2, 0.5], materialA);
  lampA.name = "LampA";
  lampA.position.set(-3, 0, 0);
  scene.add(lampA);

  const materialB = unlit(OFF);
  const lampB = boxMesh([2, 2, 0.5], materialB);
  lampB.name = "LampB";
  lampB.position.set(3, 0, 0);
  scene.add(lampB);

  let a = false;
  let b = false;
  const show = (): void => {
    materialA.color.copy(srgb(a ? ON : OFF));
    materialB.color.copy(srgb(b ? ON : OFF));
  };

  host.onKeyDown("KeyA", () => {
    a = !a;
    show();
  });
  host.onKeyDown("KeyB", () => {
    b = !b;
    show();
  });
  host.onKeyDown("Space", () => {
    a = !a;
    b = !b;
    show();
  });
  host.onKeyDown("Enter", () => {
    a = false;
    b = false;
    show();
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
