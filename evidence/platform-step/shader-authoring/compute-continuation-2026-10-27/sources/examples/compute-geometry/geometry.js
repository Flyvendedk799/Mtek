/** Packed float3 unit cube. Each outward-facing quad matches the primitive's
 * six-index face contract; translation leaves the original normals/UVs valid. */
export function cubeVertices() {
  return new Float32Array([
    .5,-.5,.5, .5,-.5,-.5, .5,.5,-.5, .5,.5,.5,
    -.5,-.5,-.5, -.5,-.5,.5, -.5,.5,.5, -.5,.5,-.5,
    -.5,.5,.5, .5,.5,.5, .5,.5,-.5, -.5,.5,-.5,
    -.5,-.5,-.5, .5,-.5,-.5, .5,-.5,.5, -.5,-.5,.5,
    -.5,-.5,.5, .5,-.5,.5, .5,.5,.5, -.5,.5,.5,
    .5,-.5,-.5, -.5,-.5,-.5, -.5,.5,-.5, .5,.5,-.5,
  ]);
}
