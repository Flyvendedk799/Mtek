export interface PostEffect {
  readonly id: string;
  /** WGSL function: fn effect(color:vec4f,uv:vec2f)->vec4f. sampleScene(uv) is available. */
  readonly wgsl: string;
}
export interface MtekRenderingOptions {
  /** One directional light's opaque shadow map; omitted means no shadow pass. */
  readonly shadows?: DirectionalShadowOptions;
  /** Linear HDR panorama, snapshotted at mount and retained for device recovery. */
  readonly environment?: EnvironmentLightingOptions;
  /** Material IDs (from the manifest). Additive color: source.rgb * source.a + destination.rgb. */
  readonly additiveMaterials?: readonly string[];
  /** Ordered LDR effects in linear color. Empty/absent allocates no intermediate targets. */
  readonly postProcessing?: readonly PostEffect[];
}

export type LightingQuality = "low" | "medium" | "high";
export interface LinearEnvironment {
  readonly width: number;
  readonly height: number;
  /** Linear RGBA floats, top row at +Y, longitude zero along +X, increasing toward +Z. */
  readonly data: Float32Array;
}
export interface EnvironmentLightingOptions extends LinearEnvironment {
  readonly intensity?: number;
  /** Panorama yaw in radians. */
  readonly rotation?: number;
  readonly quality?: LightingQuality;
}
export interface DirectionalShadowOptions {
  /** Entity name or fully qualified symbol of a directional light. */
  readonly light: string;
  readonly quality?: LightingQuality;
  /** World-space centre of the fixed shadow volume. Default [0, 0, 0]. */
  readonly center?: readonly [number, number, number];
  /** Square orthographic volume width/height in world units. Default 20. */
  readonly size?: number;
  /** Distance from the centre toward the light. Default 20. */
  readonly distance?: number;
  readonly near?: number;
  readonly far?: number;
  /** Depth comparison offset in [0,1] depth units. Default 0.001. */
  readonly bias?: number;
  /** Receiver offset along the geometric world normal, in world units. Default 0.01. */
  readonly normalBias?: number;
}
