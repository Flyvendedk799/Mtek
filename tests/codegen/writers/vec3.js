// Generated from layout fixture:vec3 (size 16). Do not edit.
function w_fixture_vec3_value(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 0] = v.x; m.f32[w + 1] = v.y; m.f32[w + 2] = v.z;
}
function w_fixture_vec3(m, base, v) {
  w_fixture_vec3_value(m, base, v.value);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:vec3": { all: w_fixture_vec3, fields: { value: w_fixture_vec3_value } },
};
export {
  w_fixture_vec3,
  w_fixture_vec3_value,
  writers,
};
