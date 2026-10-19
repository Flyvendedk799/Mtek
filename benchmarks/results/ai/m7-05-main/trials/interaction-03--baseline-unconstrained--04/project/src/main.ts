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

  const materialA = lampA.material as any;
  const materialB = lampB.material as any;

  let isLampAOn = false;
  let isLampBOn = false;

  const updateLampA = () => {
    isLampAOn = !isLampAOn;
    materialA.color.setStyle(isLampAOn ? "#ffd24a" : "#3a3a3a");
  };

  const updateLampB = () => {
    isLampBOn = !isLampBOn;
    materialB.color.setStyle(isLampBOn ? "#ffd24a" : "#3a3a3a");
  };

  const flipBothLamps = () => {
    isLampAOn = !isLampAOn;
    isLampBOn = !isLampBOn;
    materialA.color.setStyle(isLampAOn ? "#ffd24a" : "#3a3a3a");
    materialB.color.setStyle(isLampBOn ? "#ffd24a" : "#3a3a3a");
  };

  const turnBothOff = () => {
    isLampAOn = false;
    isLampBOn = false;
    materialA.color.setStyle("#3a3a3a");
    materialB.color.setStyle("#3a3a3a");
  };

  host.onKeyDown("KeyA", updateLampA);
  host.onKeyDown("KeyB", updateLampB);
  host.onKeyDown("Space", flipBothLamps);
  host.onKeyDown("Enter", turnBothOff);

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
