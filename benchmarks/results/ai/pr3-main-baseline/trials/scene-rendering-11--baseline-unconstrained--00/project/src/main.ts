import { Scene, Mesh } from "three/webgpu";
import { PlaneGeometry, MeshBasicNodeMaterial, DoubleSide } from "three/webgpu";
import {
  loadTexture,
  lookAtCamera,
  startTask,
} from "@mtek/benchmarks/baseline-support";
import {
  uv,
  texture,
  vec2,
  floor,
  fract,
  mix,
  clamp,
} from "three/tsl";

void startTask(async () => {
  // Load the swatch texture
  const swatchTexture = await loadTexture("assets/swatch.png", {
    colorSpace: "srgb",
    filter: "nearest",
    wrap: "clamp",
  });

  const scene = new Scene();

  // Create the three squares
  const geometry = new PlaneGeometry(3.6, 3.6);
  geometry.rotateX(-Math.PI / 2); // Rotate to lie flat facing +Y

  // Helper function to create adjusted UV for each square
  const createAdjustedUv = (baseUv: any) => {
    // After rotation, the plane's default UV needs adjustment
    // Default UV: (0,0) bottom-left, (1,1) top-right in local space
    // After rotation and considering world orientation:
    // We want: (0,0) at top-left (small x, small z), (1,1) at bottom-right
    return vec2(baseUv.x, 1 - baseUv.y);
  };

  // Plain square: hard-edged, centered at (-2, 0, -2)
  const plainMaterial = new MeshBasicNodeMaterial();
  plainMaterial.name = "Plain";
  plainMaterial.side = DoubleSide;
  const plainUv = createAdjustedUv(uv());
  plainMaterial.colorNode = texture(swatchTexture, plainUv);
  const plainMesh = new Mesh(geometry, plainMaterial);
  plainMesh.name = "Plain";
  plainMesh.position.set(-2, 0, -2);
  scene.add(plainMesh);

  // Tiled square: 2x2 tiling with hard edges, centered at (0, 0, 2)
  const tiledMaterial = new MeshBasicNodeMaterial();
  tiledMaterial.name = "Tiled";
  tiledMaterial.side = DoubleSide;
  const tiledBaseUv = uv().mul(2);
  const tiledUv = createAdjustedUv(tiledBaseUv);
  tiledMaterial.colorNode = texture(swatchTexture, tiledUv);
  const tiledMesh = new Mesh(geometry, tiledMaterial);
  tiledMesh.name = "Tiled";
  tiledMesh.position.set(0, 0, 2);
  scene.add(tiledMesh);

  // Smooth square: bilinear filtering with clamping at edges
  const smoothMaterial = new MeshBasicNodeMaterial();
  smoothMaterial.name = "Smooth";
  smoothMaterial.side = DoubleSide;

  // Implement manual bilinear interpolation in linear light
  // First apply the UV adjustment
  const baseUv = uv();
  const uv0 = createAdjustedUv(baseUv);

  // Convert from [0, 1] to pixel coordinates [0, 4]
  const pixelCoord = uv0.mul(4.0);

  // Get integer and fractional parts
  const intPart = floor(pixelCoord);
  const fracPart = fract(pixelCoord);

  // Clamp integer coordinates to [0, 3]
  const ix = clamp(intPart.x, 0, 3);
  const iy = clamp(intPart.y, 0, 3);

  // For bilinear interpolation, get the next pixel coordinates (clamped)
  const ix1 = clamp(ix.add(1), 0, 3);
  const iy1 = clamp(iy.add(1), 0, 3);

  // Convert pixel coordinates back to normalized texture coordinates
  // Pixel centers are at 0.5, 1.5, 2.5, 3.5 in pixel space, which is 1/8, 3/8, 5/8, 7/8 in [0,1]
  const texelSize = 1.0 / 4.0;
  const halfTexel = texelSize / 2.0;

  const p00 = vec2(ix, iy).mul(texelSize).add(halfTexel);
  const p10 = vec2(ix1, iy).mul(texelSize).add(halfTexel);
  const p01 = vec2(ix, iy1).mul(texelSize).add(halfTexel);
  const p11 = vec2(ix1, iy1).mul(texelSize).add(halfTexel);

  // Sample colors
  const c00 = texture(swatchTexture, p00);
  const c10 = texture(swatchTexture, p10);
  const c01 = texture(swatchTexture, p01);
  const c11 = texture(swatchTexture, p11);

  // Bilinear interpolation using fractional part
  const t = fracPart;
  const c0 = mix(c00, c10, t.x);
  const c1 = mix(c01, c11, t.x);
  const color = mix(c0, c1, t.y);

  smoothMaterial.colorNode = color.xyz;

  const smoothMesh = new Mesh(geometry, smoothMaterial);
  smoothMesh.name = "Smooth";
  smoothMesh.position.set(2, 0, -2);
  scene.add(smoothMesh);

  return {
    scene,
    camera: lookAtCamera({
      position: [0, 11, 3],
      target: [0, 0, 0],
      fovY: 0.72,
      near: 0.1,
      far: 1000,
    }),
    clearColor: "#1b2430",
  };
});
