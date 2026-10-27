/** Public position attachment metadata. No GPU resource crosses this boundary. */
export interface MtekComputeBounds {
  readonly center: readonly [number, number, number];
  readonly radius: number;
}
export interface MtekComputePositionAttachment {
  readonly state: "attached" | "disposed";
  inspect(): { readonly entity: string; readonly bounds: MtekComputeBounds; readonly state: "attached" | "disposed" };
  dispose(): void;
}

export function checkedPositionBounds(bounds: MtekComputeBounds): MtekComputeBounds {
  if (bounds === null || typeof bounds !== "object" || !Array.isArray(bounds.center) || bounds.center.length !== 3 ||
    ![...bounds.center, bounds.radius].every((value) => typeof value === "number" && Number.isFinite(value) && Number.isFinite(Math.fround(value))) || bounds.radius <= 0) {
    throw new RangeError("compute positions require a finite mesh-local sphere with positive radius");
  }
  // Do not round inward: these are conservative CPU culling bounds, not uniforms.
  return { center: [bounds.center[0], bounds.center[1], bounds.center[2]], radius: bounds.radius };
}
