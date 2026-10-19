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

  // Lamp state: false = off, true = on
  let lampAOn = false;
  let lampBOn = false;

  const updateLampColor = () => {
    const materialA = lampA.material as { color?: { setStyle(style: string): void } } | null;
    const materialB = lampB.material as { color?: { setStyle(style: string): void } } | null;
    if (materialA && materialA.color) {
      materialA.color.setStyle(lampAOn ? "#ffd24a" : "#3a3a3a");
    }
    if (materialB && materialB.color) {
      materialB.color.setStyle(lampBOn ? "#ffd24a" : "#3a3a3a");
    }
  };

  host.onKeyDown("KeyA", () => {
    lampAOn = !lampAOn;
    updateLampColor();
  });

  host.onKeyDown("KeyB", () => {
    lampBOn = !lampBOn;
    updateLampColor();
  });

  host.onKeyDown("Space", () => {
    lampAOn = !lampAOn;
    lampBOn = !lampBOn;
    updateLampColor();
  });

  host.onKeyDown("Enter", () => {
    lampAOn = false;
    lampBOn = false;
    updateLampColor();
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
