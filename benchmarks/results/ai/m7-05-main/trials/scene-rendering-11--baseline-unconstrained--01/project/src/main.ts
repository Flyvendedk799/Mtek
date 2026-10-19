import { Scene, MeshBasicNodeMaterial } from "three/webgpu";
import { Mesh, PlaneGeometry } from "three/webgpu";
import { lookAtCamera, startTask, loadTexture, srgb } from "@mtek/benchmarks/baseline-support";
import { uv, texture, vec2, fract, floor, clamp, mix } from "three/tsl";

void startTask(async () => {
  const scene = new Scene();
  scene.background = srgb("#1b2430");

  // Load the swatch image
  const swatchTexture = await loadTexture("assets/swatch.png", {
    colorSpace: "srgb",
    filter: "nearest",
    wrap: "clamp",
  });

  // Create the three squares
  const size = 3.6;
  const geometry = new PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2); // Rotate to lie flat in XZ plane facing +Y
  
  // Adjust UV coordinates: flip V so that v=0 is at top (smaller z)
  const uvAttribute = geometry.getAttribute("uv");
  for (let i = 0; i < uvAttribute.count; i++) {
    const u = uvAttribute.getX(i);
    const v = uvAttribute.getY(i);
    uvAttribute.setXY(i, u, 1 - v);
  }
  uvAttribute.needsUpdate = true;

  // Plain square: hard-edged, one copy, centered at (-2, 0, -2)
  const plainMaterial = new MeshBasicNodeMaterial();
  plainMaterial.name = "Plain";
  plainMaterial.colorNode = texture(swatchTexture, uv().xy);
  const plainMesh = new Mesh(geometry, plainMaterial);
  plainMesh.name = "Plain";
  plainMesh.position.set(-2, 0, -2);
  scene.add(plainMesh);

  // Tiled square: hard-edged, 2x2 tiled, centered at (0, 0, 2)
  const tiledMaterial = new MeshBasicNodeMaterial();
  tiledMaterial.name = "Tiled";
  tiledMaterial.colorNode = texture(swatchTexture, fract(uv().xy.mul(2)));
  const tiledMesh = new Mesh(geometry, tiledMaterial);
  tiledMesh.name = "Tiled";
  tiledMesh.position.set(0, 0, 2);
  scene.add(tiledMesh);

  // Smooth square: bilinear filtering with clamping
  const smoothMaterial = new MeshBasicNodeMaterial();
  smoothMaterial.name = "Smooth";
  
  // Manual bilinear filtering in linear light
  // For a 4x4 texture, pixel centers are at 0.125, 0.375, 0.625, 0.875 in normalized coords
  const smoothUV = uv().xy;
  const texCoord = smoothUV.mul(4.0); // Scale to pixel coordinates (0 to 4)
  
  // Clamp to valid range [0.5, 3.5] to stay within pixel centers
  const clamped = clamp(texCoord, 0.5, 3.5);
  
  // Get integer and fractional parts
  const intPart = floor(clamped);
  const fracPart = fract(clamped);
  
  // Sample four surrounding pixels at pixel centers
  const p00 = texture(swatchTexture, intPart.div(4.0));
  const p10 = texture(swatchTexture, intPart.add(vec2(1, 0)).div(4.0));
  const p01 = texture(swatchTexture, intPart.add(vec2(0, 1)).div(4.0));
  const p11 = texture(swatchTexture, intPart.add(vec2(1, 1)).div(4.0));
  
  // Bilinear interpolation in linear light
  const x = fracPart.x;
  const y = fracPart.y;
  const p0 = mix(p00, p10, x);
  const p1 = mix(p01, p11, x);
  const result = mix(p0, p1, y);
  
  smoothMaterial.colorNode = result.xyz;
  const smoothMesh = new Mesh(geometry, smoothMaterial);
  smoothMesh.name = "Smooth";
  smoothMesh.position.set(2, 0, -2);
  scene.add(smoothMesh);

  const camera = lookAtCamera({
    position: [0, 11, 3],
    target: [0, 0, 0],
    fovY: 0.72,
    near: 0.1,
    far: 1000,
  });

  return {
    scene,
    camera,
    clearColor: "#1b2430",
  };
});
