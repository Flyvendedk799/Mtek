// Generated from layout fixture:nested_struct_in_array (size 64). Do not edit.
function w_fixture_nested_struct_in_array_items(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 0] = v[0].a;
  m.f32[w + 4] = v[1].a;
  m.f32[w + 8] = v[2].a;
}
function w_fixture_nested_struct_in_array_tail(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 12] = v.x; m.f32[w + 13] = v.y;
}
function w_fixture_nested_struct_in_array(m, base, v) {
  w_fixture_nested_struct_in_array_items(m, base, v.items);
  w_fixture_nested_struct_in_array_tail(m, base, v.tail);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:nested_struct_in_array": { all: w_fixture_nested_struct_in_array, fields: { items: w_fixture_nested_struct_in_array_items, tail: w_fixture_nested_struct_in_array_tail } },
};
export {
  w_fixture_nested_struct_in_array,
  w_fixture_nested_struct_in_array_items,
  w_fixture_nested_struct_in_array_tail,
  writers,
};
