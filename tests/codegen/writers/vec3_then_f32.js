// Generated from layout fixture:vec3_then_f32 (size 16). Do not edit.
function w_fixture_vec3_then_f32_position(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 0] = v.x; m.f32[w + 1] = v.y; m.f32[w + 2] = v.z;
}
function w_fixture_vec3_then_f32_intensity(m, base, v) {
  m.f32[(base >>> 2) + 3] = v;
}
function w_fixture_vec3_then_f32(m, base, v) {
  w_fixture_vec3_then_f32_position(m, base, v.position);
  w_fixture_vec3_then_f32_intensity(m, base, v.intensity);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:vec3_then_f32": { all: w_fixture_vec3_then_f32, fields: { position: w_fixture_vec3_then_f32_position, intensity: w_fixture_vec3_then_f32_intensity } },
};
export {
  w_fixture_vec3_then_f32,
  w_fixture_vec3_then_f32_position,
  w_fixture_vec3_then_f32_intensity,
  writers,
};
