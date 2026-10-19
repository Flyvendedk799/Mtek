import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const materialA = unlit("#3a3a3a");
  const lampA = boxMesh([2, 2, 0.5], materialA);
  lampA.name = "LampA";
  lampA.position.set(-3, 0, 0);
  scene.add(lampA);

  const materialB = unlit("#3a3a3a");
  const lampB = boxMesh([2, 2, 0.5], materialB);
  lampB.name = "LampB";
  lampB.position.set(3, 0, 0);
  scene.add(lampB);

  // Track lamp states (false = off, true = on)
  let isAOn = false;
  let isBOn = false;

  const offColor = "#3a3a3a";
  const onColor = "#ffd24a";

  const updateLampA = () => {
    isAOn = !isAOn;
    materialA.color.setStyle(isAOn ? onColor : offColor);
  };

  const updateLampB = () => {
    isBOn = !isBOn;
    materialB.color.setStyle(isBOn ? onColor : offColor);
  };

  const flipBoth = () => {
    isAOn = !isAOn;
    isBOn = !isBOn;
    materialA.color.setStyle(isAOn ? onColor : offColor);
    materialB.color.setStyle(isBOn ? onColor : offColor);
  };

  const turnBothOff = () => {
    isAOn = false;
    isBOn = false;
    materialA.color.setStyle(offColor);
    materialB.color.setStyle(offColor);
  };

  host.onKeyDown("KeyA", updateLampA);
  host.onKeyDown("KeyB", updateLampB);
  host.onKeyDown("Space", flipBoth);
  host.onKeyDown("Enter", turnBothOff);

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
