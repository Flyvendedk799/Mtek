// Generated from layout fixture:mixed (size 64). Do not edit.
function w_fixture_mixed_a(m, base, v) {
  m.f32[(base >>> 2) + 0] = v;
}
function w_fixture_mixed_b(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 4] = v.x; m.f32[w + 5] = v.y; m.f32[w + 6] = v.z;
}
function w_fixture_mixed_c(m, base, v) {
  m.u32[(base >>> 2) + 7] = v;
}
function w_fixture_mixed_d(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 8] = v.x; m.f32[w + 9] = v.y;
}
function w_fixture_mixed_e(m, base, v) {
  m.u32[(base >>> 2) + 10] = v ? 1 : 0;
}
function w_fixture_mixed_f(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 12] = v.r; m.f32[w + 13] = v.g; m.f32[w + 14] = v.b; m.f32[w + 15] = v.a;
}
function w_fixture_mixed(m, base, v) {
  w_fixture_mixed_a(m, base, v.a);
  w_fixture_mixed_b(m, base, v.b);
  w_fixture_mixed_c(m, base, v.c);
  w_fixture_mixed_d(m, base, v.d);
  w_fixture_mixed_e(m, base, v.e);
  w_fixture_mixed_f(m, base, v.f);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:mixed": { all: w_fixture_mixed, fields: { a: w_fixture_mixed_a, b: w_fixture_mixed_b, c: w_fixture_mixed_c, d: w_fixture_mixed_d, e: w_fixture_mixed_e, f: w_fixture_mixed_f } },
};
export {
  w_fixture_mixed,
  w_fixture_mixed_a,
  w_fixture_mixed_b,
  w_fixture_mixed_c,
  w_fixture_mixed_d,
  w_fixture_mixed_e,
  w_fixture_mixed_f,
  writers,
};
