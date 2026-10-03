// Generated from layout fixture:array_f32 (size 64). Do not edit.
function w_fixture_array_f32_weights(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 0] = v[0];
  m.f32[w + 4] = v[1];
  m.f32[w + 8] = v[2];
}
function w_fixture_array_f32_bias(m, base, v) {
  m.f32[(base >>> 2) + 12] = v;
}
function w_fixture_array_f32(m, base, v) {
  w_fixture_array_f32_weights(m, base, v.weights);
  w_fixture_array_f32_bias(m, base, v.bias);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:array_f32": { all: w_fixture_array_f32, fields: { weights: w_fixture_array_f32_weights, bias: w_fixture_array_f32_bias } },
};
export {
  w_fixture_array_f32,
  w_fixture_array_f32_weights,
  w_fixture_array_f32_bias,
  writers,
};
