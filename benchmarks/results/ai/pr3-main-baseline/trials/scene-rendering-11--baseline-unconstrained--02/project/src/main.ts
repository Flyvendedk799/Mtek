import { Scene, Mesh } from "three/webgpu";
import { PlaneGeometry, MeshBasicMaterial, NearestFilter, LinearFilter, RepeatWrapping, ClampToEdgeWrapping } from "three/webgpu";
import { lookAtCamera, startTask, loadTexture, configureTexture } from "@mtek/benchmarks/baseline-support";

void startTask(async () => {
  const scene = new Scene();

  // Load the base texture with nearest filter (we'll reconfigure copies)
  const baseTexture = await loadTexture("assets/swatch.png", {
    colorSpace: "srgb",
    filter: "nearest",
    wrap: "clamp"
  });

  // Create textures with appropriate settings for each square
  const plainTexture = configureTexture(baseTexture.clone(), {
    colorSpace: "srgb",
    filter: "nearest",
    wrap: "clamp"
  });

  const tiledTexture = configureTexture(baseTexture.clone(), {
    colorSpace: "srgb",
    filter: "nearest",
    wrap: "repeat"
  });

  const smoothTexture = configureTexture(baseTexture.clone(), {
    colorSpace: "srgb",
    filter: "linear",
    wrap: "clamp"
  });

  // Create the camera
  const camera = lookAtCamera({
    position: [0, 11, 3],
    target: [0, 0, 0],
    fovY: 0.72,
    near: 0.1,
    far: 1000
  });

  // Create base plane geometry (3.6 x 3.6)
  const planeGeo = new PlaneGeometry(3.6, 3.6);
  planeGeo.rotateX(-Math.PI / 2); // Rotate to lie flat in XZ plane, facing +Y

  // --- PLAIN: Hard-edged, single copy, centered at (-2, 0, -2) ---
  const plainMaterial = new MeshBasicMaterial({
    map: plainTexture
  });
  plainMaterial.name = "Plain";

  const plainMesh = new Mesh(planeGeo, plainMaterial);
  plainMesh.name = "Plain";
  plainMesh.position.set(-2, 0, -2);
  scene.add(plainMesh);

  // --- TILED: Hard-edged, 2x2 tiled, centered at (0, 0, 2) ---
  const tiledMaterial = new MeshBasicMaterial({
    map: tiledTexture
  });
  tiledMaterial.name = "Tiled";
  tiledTexture.repeat.set(2, 2);

  const tiledMesh = new Mesh(planeGeo, tiledMaterial);
  tiledMesh.name = "Tiled";
  tiledMesh.position.set(0, 0, 2);
  scene.add(tiledMesh);

  // --- SMOOTH: Bilinear filtered, single copy, centered at (2, 0, -2) ---
  const smoothMaterial = new MeshBasicMaterial({
    map: smoothTexture
  });
  smoothMaterial.name = "Smooth";

  const smoothMesh = new Mesh(planeGeo, smoothMaterial);
  smoothMesh.name = "Smooth";
  smoothMesh.position.set(2, 0, -2);
  scene.add(smoothMesh);

  return {
    scene,
    camera,
    clearColor: "#1b2430"
  };
});
