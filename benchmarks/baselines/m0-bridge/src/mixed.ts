// The `mixed` block of the M0 bridge scenario (tests/gpu-layout/mixed.layout.json) as three.js
// TSL uniforms: a float, a vec3, an unsigned value, a vec2, a boolean flag and a colour.
import { float, select, uniform, vec3, vec4 } from "three/tsl";
import { Color, MeshBasicNodeMaterial, Vector2, Vector3 } from "three/webgpu";

/** Plain-data parameters of one material instance (JSON-serialisable, so a test page can drive it). */
export interface MixedParams {
  readonly a: number;
  readonly b: readonly [number, number, number];
  readonly c: number;
  readonly d: readonly [number, number];
  readonly e: boolean;
  /** Linear RGB. three.js `Color` has no alpha channel; see RESULTS.md. */
  readonly f: readonly [number, number, number];
}

/** Uniform nodes of one material; `.value` is the CPU-side value that three.js uploads. */
export interface MixedUniforms {
  readonly a: ReturnType<typeof uniform<"float", number>>;
  readonly b: ReturnType<typeof uniform<"vec3", Vector3>>;
  readonly c: ReturnType<typeof uniform<"uint", number>>;
  readonly d: ReturnType<typeof uniform<"vec2", Vector2>>;
  readonly e: ReturnType<typeof uniform<"bool", boolean>>;
  readonly f: ReturnType<typeof uniform<"color", Color>>;
}

export interface MixedMaterial {
  readonly material: MeshBasicNodeMaterial;
  readonly uniforms: MixedUniforms;
}

/**
 * Output colour as a function of the six uniforms (the CPU reference in the browser spec
 * implements the same formula):
 * `rgb = (e ? f * a : f) + b * (c / 100) + (d.x, d.y, 0)`, alpha 1.
 */
export function createMixedMaterial(initial: MixedParams): MixedMaterial {
  const uniforms: MixedUniforms = {
    a: uniform(initial.a, "float"),
    b: uniform(new Vector3(...initial.b), "vec3"),
    c: uniform(initial.c, "uint"),
    d: uniform(new Vector2(...initial.d), "vec2"),
    e: uniform(initial.e, "bool"),
    f: uniform(new Color(...initial.f), "color"),
  };
  const color = uniforms.f.rgb;
  const scaled = select(uniforms.e, color.mul(uniforms.a), color);
  const rgb = scaled.add(uniforms.b.mul(float(uniforms.c).div(100))).add(vec3(uniforms.d, 0));

  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec4(rgb, 1);
  return { material, uniforms };
}

/** Writes the given parameters into the uniforms' `.value` fields. */
export function applyParams(uniforms: MixedUniforms, params: Partial<MixedParams>): void {
  if (params.a !== undefined) uniforms.a.value = params.a;
  if (params.b !== undefined) uniforms.b.value.set(...params.b);
  if (params.c !== undefined) uniforms.c.value = params.c;
  if (params.d !== undefined) uniforms.d.value.set(...params.d);
  if (params.e !== undefined) uniforms.e.value = params.e;
  if (params.f !== undefined) uniforms.f.value.setRGB(...params.f);
}
