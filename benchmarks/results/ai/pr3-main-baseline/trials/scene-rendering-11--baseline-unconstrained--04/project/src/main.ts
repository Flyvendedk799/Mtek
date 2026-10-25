import { Scene, MeshBasicNodeMaterial } from "three/webgpu";
import { Mesh, PlaneGeometry, DoubleSide } from "three/webgpu";
import { lookAtCamera, startTask, loadTexture } from "@mtek/benchmarks/baseline-support";
import { uv, texture, vec2 } from "three/tsl";

void startTask(async (host) => {
  const scene = new Scene();
  
  // Load the texture with appropriate filters
  const textureNearest = await loadTexture("assets/swatch.png", { 
    filter: "nearest", 
    wrap: "clamp",
    colorSpace: "srgb"
  });
  
  const textureLinear = await loadTexture("assets/swatch.png", { 
    filter: "linear", 
    wrap: "clamp",
    colorSpace: "srgb"
  });
  
  // Create plane geometry (3.6 x 3.6)
  // PlaneGeometry creates a plane in XY facing +Z by default
  // We need it in XZ facing +Y
  const geometry = new PlaneGeometry(3.6, 3.6);
  geometry.rotateX(Math.PI / 2);
  
  // Adjust UV coordinates: flip V so top of image is at small z
  const uvAttr = geometry.attributes.uv;
  if (uvAttr) {
    for (let i = 0; i < uvAttr.count; i++) {
      uvAttr.setXY(i, uvAttr.getX(i), 1 - uvAttr.getY(i));
    }
    uvAttr.needsUpdate = true;
  }
  
  // Plain square: hard edges, image once
  const materialPlain = new MeshBasicNodeMaterial();
  materialPlain.name = "Plain";
  materialPlain.side = DoubleSide;
  materialPlain.colorNode = texture(textureNearest, uv());
  
  const plainMesh = new Mesh(geometry, materialPlain);
  plainMesh.name = "Plain";
  plainMesh.position.set(-2, 0, -2);
  scene.add(plainMesh);
  
  // Tiled square: hard edges, image 2x2
  const materialTiled = new MeshBasicNodeMaterial();
  materialTiled.name = "Tiled";
  materialTiled.side = DoubleSide;
  materialTiled.colorNode = texture(textureNearest, uv().mul(2));
  
  const tiledMesh = new Mesh(geometry, materialTiled);
  tiledMesh.name = "Tiled";
  tiledMesh.position.set(0, 0, 2);
  scene.add(tiledMesh);
  
  // Smooth square: linear filtering, image once
  const materialSmooth = new MeshBasicNodeMaterial();
  materialSmooth.name = "Smooth";
  materialSmooth.side = DoubleSide;
  materialSmooth.colorNode = texture(textureLinear, uv());
  
  const smoothMesh = new Mesh(geometry, materialSmooth);
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
      far: 1000
    }),
    clearColor: "#1b2430",
  };
});
