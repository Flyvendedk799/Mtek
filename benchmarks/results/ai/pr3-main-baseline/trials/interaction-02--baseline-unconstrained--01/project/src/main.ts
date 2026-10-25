import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const track = boxMesh([10, 0.2, 0.2], unlit("#404040"));
  track.name = "Track";
  track.position.set(0, -1, 0);
  scene.add(track);

  const handle = boxMesh([0.8, 0.8, 0.5], unlit("#ffd24a"));
  handle.name = "Handle";
  scene.add(handle);

  let currentX = 0;
  const yellowMaterial = unlit("#ffd24a");
  const redMaterial = unlit("#ef4444");

  const updateHandleColor = () => {
    if (currentX === -4 || currentX === 4) {
      handle.material = redMaterial;
    } else {
      handle.material = yellowMaterial;
    }
  };

  host.onKeyDown("ArrowRight", () => {
    if (currentX < 4) {
      currentX += 1;
      handle.position.x = currentX;
      updateHandleColor();
    }
  });

  host.onKeyDown("ArrowLeft", () => {
    if (currentX > -4) {
      currentX -= 1;
      handle.position.x = currentX;
      updateHandleColor();
    }
  });

  host.onKeyDown("Enter", () => {
    currentX = 0;
    handle.position.x = currentX;
    updateHandleColor();
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
