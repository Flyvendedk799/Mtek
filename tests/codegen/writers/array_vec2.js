// Generated from layout fixture:array_vec2 (size 48). Do not edit.
function w_fixture_array_vec2_items(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 0] = v[0].x; m.f32[w + 1] = v[0].y;
  m.f32[w + 4] = v[1].x; m.f32[w + 5] = v[1].y;
  m.f32[w + 8] = v[2].x; m.f32[w + 9] = v[2].y;
}
function w_fixture_array_vec2(m, base, v) {
  w_fixture_array_vec2_items(m, base, v.items);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:array_vec2": { all: w_fixture_array_vec2, fields: { items: w_fixture_array_vec2_items } },
};
export {
  w_fixture_array_vec2,
  w_fixture_array_vec2_items,
  writers,
};
