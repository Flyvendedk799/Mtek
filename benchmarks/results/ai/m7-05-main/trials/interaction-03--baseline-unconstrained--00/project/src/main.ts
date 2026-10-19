import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit, srgb } from "@mtek/benchmarks/baseline-support";

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

  const offColor = srgb("#3a3a3a");
  const onColor = srgb("#ffd24a");

  let lampAOn = false;
  let lampBOn = false;

  const getMaterialA = () => lampA.material as any;
  const getMaterialB = () => lampB.material as any;

  const toggleLampA = () => {
    lampAOn = !lampAOn;
    getMaterialA().color.copy(lampAOn ? onColor : offColor);
  };

  const toggleLampB = () => {
    lampBOn = !lampBOn;
    getMaterialB().color.copy(lampBOn ? onColor : offColor);
  };

  const flipBoth = () => {
    toggleLampA();
    toggleLampB();
  };

  const switchBothOff = () => {
    lampAOn = false;
    lampBOn = false;
    getMaterialA().color.copy(offColor);
    getMaterialB().color.copy(offColor);
  };

  host.onKeyDown("KeyA", toggleLampA);
  host.onKeyDown("KeyB", toggleLampB);
  host.onKeyDown("Space", flipBoth);
  host.onKeyDown("Enter", switchBothOff);

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
