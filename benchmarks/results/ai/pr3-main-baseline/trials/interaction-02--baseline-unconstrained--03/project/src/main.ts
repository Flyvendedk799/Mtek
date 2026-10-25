import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const track = boxMesh([10, 0.2, 0.2], unlit("#404040"));
  track.name = "Track";
  track.position.set(0, -1, 0);
  scene.add(track);

  const handleMaterial = unlit("#ffd24a");
  const handle = boxMesh([0.8, 0.8, 0.5], handleMaterial);
  handle.name = "Handle";
  scene.add(handle);

  let handleX = 0;

  const updateHandleColor = () => {
    if (handleX === -4 || handleX === 4) {
      handleMaterial.color.setStyle("#ef4444");
    } else {
      handleMaterial.color.setStyle("#ffd24a");
    }
  };

  host.onKeyDown("ArrowRight", () => {
    if (handleX < 4) {
      handleX += 1;
      handle.position.x = handleX;
      updateHandleColor();
    }
  });

  host.onKeyDown("ArrowLeft", () => {
    if (handleX > -4) {
      handleX -= 1;
      handle.position.x = handleX;
      updateHandleColor();
    }
  });

  host.onKeyDown("Enter", () => {
    handleX = 0;
    handle.position.x = handleX;
    updateHandleColor();
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
