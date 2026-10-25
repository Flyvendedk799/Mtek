import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const lampA = boxMesh([2, 2, 0.5], unlit("#3a3a3a"));
  lampA.name = "LampA";
  lampA.position.set(-3, 0, 0);
  scene.add(lampA);

  const lampB = boxMesh([2, 2, 0.5], unlit("#3a3a3a"));
  lampB.name = "LampB";
  lampB.position.set(3, 0, 0);
  scene.add(lampB);

  let lampAOn = false;
  let lampBOn = false;

  const updateColors = () => {
    const matA = lampA.material as any;
    const matB = lampB.material as any;
    if (matA && "color" in matA) {
      matA.color.setStyle(lampAOn ? "#ffd24a" : "#3a3a3a");
    }
    if (matB && "color" in matB) {
      matB.color.setStyle(lampBOn ? "#ffd24a" : "#3a3a3a");
    }
  };

  host.onKeyDown("KeyA", () => {
    lampAOn = !lampAOn;
    updateColors();
  });

  host.onKeyDown("KeyB", () => {
    lampBOn = !lampBOn;
    updateColors();
  });

  host.onKeyDown("Space", () => {
    lampAOn = !lampAOn;
    lampBOn = !lampBOn;
    updateColors();
  });

  host.onKeyDown("Enter", () => {
    lampAOn = false;
    lampBOn = false;
    updateColors();
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
