// Generated from layout fixture:struct_then_scalar (size 32). Do not edit.
function w_fixture_struct_then_scalar_inner(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 0] = v.k;
}
function w_fixture_struct_then_scalar_after(m, base, v) {
  m.f32[(base >>> 2) + 4] = v;
}
function w_fixture_struct_then_scalar(m, base, v) {
  w_fixture_struct_then_scalar_inner(m, base, v.inner);
  w_fixture_struct_then_scalar_after(m, base, v.after);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:struct_then_scalar": { all: w_fixture_struct_then_scalar, fields: { inner: w_fixture_struct_then_scalar_inner, after: w_fixture_struct_then_scalar_after } },
};
export {
  w_fixture_struct_then_scalar,
  w_fixture_struct_then_scalar_inner,
  w_fixture_struct_then_scalar_after,
  writers,
};
