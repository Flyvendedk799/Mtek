import { Mesh, MeshBasicMaterial, PlaneGeometry, Scene, type Texture } from "three/webgpu";
import { loadTexture, lookAtCamera, startTask } from "@mtek/benchmarks/baseline-support";

const SIDE = 3.6;

/** A flat unlit square in the plane y = 0, facing up, centred at (x, 0, z), showing `map`. */
function square(name: string, x: number, z: number, map: Texture): Mesh {
  // A PlaneGeometry lies in the XY plane facing +Z with the picture's top at +Y; turning it by -90 degrees about X lays it flat
  // facing +Y with the picture's top at -Z (the far edge) and its left at -X.
  const mesh = new Mesh(new PlaneGeometry(SIDE, SIDE), new MeshBasicMaterial({ map }));
  mesh.name = name;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0, z);
  return mesh;
}

void startTask(async () => {
  // The picture is an sRGB colour image; one texture per sampler configuration.
  const plain = await loadTexture("assets/swatch.png", { filter: "nearest", wrap: "clamp" });
  const tiled = await loadTexture("assets/swatch.png", { filter: "nearest", wrap: "repeat" });
  tiled.repeat.set(2, 2);
  const smooth = await loadTexture("assets/swatch.png", { filter: "linear", wrap: "clamp" });

  const scene = new Scene();
  scene.add(square("Plain", -2, -2, plain), square("Tiled", 0, 2, tiled), square("Smooth", 2, -2, smooth));
  return {
    scene,
    camera: lookAtCamera({ position: [0, 11, 3], target: [0, 0, 0], fovY: 0.72 }),
    clearColor: "#1b2430",
  };
});
