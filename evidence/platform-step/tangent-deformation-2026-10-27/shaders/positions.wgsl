
struct Influence { joints: vec4u, weights: vec4f }
@group(0) @binding(0) var<storage, read> positions: array<f32>;

@group(0) @binding(2) var<storage, read> influences: array<Influence>;
@group(0) @binding(3) var<storage, read> palette: array<mat4x4f>;
@group(0) @binding(4) var<storage, read_write> outputPositions: array<f32>;

@compute @workgroup_size(64)
fn skin(@builtin(global_invocation_id) id: vec3u) {
  let v = id.x;
  if (v >= arrayLength(&influences)) { return; }
  let inf = influences[v];
  let m = palette[inf.joints.x] * inf.weights.x + palette[inf.joints.y] * inf.weights.y
        + palette[inf.joints.z] * inf.weights.z + palette[inf.joints.w] * inf.weights.w;
  let at = v * 3u;
  let p = m * vec4f(positions[at], positions[at+1u], positions[at+2u], 1.0);
  outputPositions[at] = p.x; outputPositions[at+1u] = p.y; outputPositions[at+2u] = p.z;

}