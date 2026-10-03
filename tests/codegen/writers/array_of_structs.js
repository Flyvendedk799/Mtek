// Generated from layout fixture:array_of_structs (size 48). Do not edit.
function w_fixture_array_of_structs_lights(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 0] = v[0].color.x; m.f32[w + 1] = v[0].color.y; m.f32[w + 2] = v[0].color.z;
  m.f32[w + 3] = v[0].intensity;
  m.f32[w + 4] = v[1].color.x; m.f32[w + 5] = v[1].color.y; m.f32[w + 6] = v[1].color.z;
  m.f32[w + 7] = v[1].intensity;
}
function w_fixture_array_of_structs_count(m, base, v) {
  m.u32[(base >>> 2) + 8] = v;
}
function w_fixture_array_of_structs(m, base, v) {
  w_fixture_array_of_structs_lights(m, base, v.lights);
  w_fixture_array_of_structs_count(m, base, v.count);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:array_of_structs": { all: w_fixture_array_of_structs, fields: { lights: w_fixture_array_of_structs_lights, count: w_fixture_array_of_structs_count } },
};
export {
  w_fixture_array_of_structs,
  w_fixture_array_of_structs_lights,
  w_fixture_array_of_structs_count,
  writers,
};
