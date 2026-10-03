// Generated from layout fixture:scalar_f32 (size 4). Do not edit.
function w_fixture_scalar_f32_value(m, base, v) {
  m.f32[(base >>> 2) + 0] = v;
}
function w_fixture_scalar_f32(m, base, v) {
  w_fixture_scalar_f32_value(m, base, v.value);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:scalar_f32": { all: w_fixture_scalar_f32, fields: { value: w_fixture_scalar_f32_value } },
};
export {
  w_fixture_scalar_f32,
  w_fixture_scalar_f32_value,
  writers,
};
