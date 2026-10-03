// Helpers that correspond to Mtek's standard library, so that the three.js baseline is not charged
// for conveniences Mtek provides (spec/ai-and-benchmarks.md section 6.3): primitive meshes with
// Mtek's default tessellation, look-at cameras with Mtek's defaults, sRGB colour literals and unlit
// materials. Each helper is a thin wrapper of the plain three.js API; nothing here changes what
// three.js does.
import {
  BoxGeometry,
  Color,
  type Material,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  SphereGeometry,
  SRGBColorSpace,
} from "three/webgpu";

export type Vec3 = readonly [number, number, number];

/** Mtek colour literal `#rrggbb`: an sRGB hex colour converted to three.js's linear working space. */
export function srgb(hex: string): Color {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`expected a colour like "#6b5cff", got ${JSON.stringify(hex)}`);
  return new Color().setStyle(hex, SRGBColorSpace);
}

/** Mtek `Unlit { color: ... }`: a flat colour, no lighting. */
export function unlit(hex: string): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: srgb(hex) });
}

/** Mtek `Box { size: ... }`: full extents along x, y and z. */
export function boxMesh(size: Vec3, material: Material): Mesh {
  return new Mesh(new BoxGeometry(...size), material);
}

/** Mtek `Sphere { radius: ... }` with Mtek's defaults of 32 segments and 16 rings. */
export function sphereMesh(radius: number, material: Material, segments = 32, rings = 16): Mesh {
  return new Mesh(new SphereGeometry(radius, segments, rings), material);
}

export interface PerspectiveOptions {
  readonly position: Vec3;
  readonly target: Vec3;
  /** Full vertical field of view in radians (Mtek `fov_y`). */
  readonly fovY?: number;
  readonly near?: number;
  readonly far?: number;
}

/** Mtek `camera { position; target; projection: Perspective {...} }`; the render target is square. */
export function lookAtCamera(options: PerspectiveOptions): PerspectiveCamera {
  const { position, target, fovY = 0.9, near = 0.1, far = 1000 } = options;
  const camera = new PerspectiveCamera((fovY * 180) / Math.PI, 1, near, far);
  camera.position.set(...position);
  camera.lookAt(...target);
  return camera;
}

export interface OrthographicOptions {
  readonly position: Vec3;
  readonly target: Vec3;
  /** Visible world height (Mtek `Orthographic { height }`); the width equals it (square target). */
  readonly height?: number;
  readonly near?: number;
  readonly far?: number;
}

/** Mtek `camera { ...; projection: Orthographic {...} }`. */
export function orthographicCamera(options: OrthographicOptions): OrthographicCamera {
  const { position, target, height = 10, near = 0.1, far = 1000 } = options;
  const half = height / 2;
  const camera = new OrthographicCamera(-half, half, half, -half, near, far);
  camera.position.set(...position);
  camera.lookAt(...target);
  return camera;
}
