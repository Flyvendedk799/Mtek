export interface PostEffect {
  readonly id: string;
  /** WGSL function: fn effect(color:vec4f,uv:vec2f)->vec4f. sampleScene(uv) is available. */
  readonly wgsl: string;
}
export interface MtekRenderingOptions {
  /** Material IDs (from the manifest). Additive color: source.rgb * source.a + destination.rgb. */
  readonly additiveMaterials?: readonly string[];
  /** Ordered LDR effects in linear color. Empty/absent allocates no intermediate targets. */
  readonly postProcessing?: readonly PostEffect[];
}
