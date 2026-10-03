// Generated from layout fixture:all_types (size 160). Do not edit.
function w_fixture_all_types_b(m, base, v) {
  m.u32[(base >>> 2) + 0] = v ? 1 : 0;
}
function w_fixture_all_types_i(m, base, v) {
  m.i32[(base >>> 2) + 1] = v;
}
function w_fixture_all_types_u(m, base, v) {
  m.u32[(base >>> 2) + 2] = v;
}
function w_fixture_all_types_f(m, base, v) {
  m.f32[(base >>> 2) + 3] = v;
}
function w_fixture_all_types_v2(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 4] = v.x; m.f32[w + 5] = v.y;
}
function w_fixture_all_types_v3(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 8] = v.x; m.f32[w + 9] = v.y; m.f32[w + 10] = v.z;
}
function w_fixture_all_types_v4(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 12] = v.x; m.f32[w + 13] = v.y; m.f32[w + 14] = v.z; m.f32[w + 15] = v.w;
}
function w_fixture_all_types_c(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 16] = v.r; m.f32[w + 17] = v.g; m.f32[w + 18] = v.b; m.f32[w + 19] = v.a;
}
function w_fixture_all_types_q(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 20] = v.x; m.f32[w + 21] = v.y; m.f32[w + 22] = v.z; m.f32[w + 23] = v.w;
}
function w_fixture_all_types_m(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 24] = v[0]; m.f32[w + 25] = v[1]; m.f32[w + 26] = v[2]; m.f32[w + 27] = v[3];
  m.f32[w + 28] = v[4]; m.f32[w + 29] = v[5]; m.f32[w + 30] = v[6]; m.f32[w + 31] = v[7];
  m.f32[w + 32] = v[8]; m.f32[w + 33] = v[9]; m.f32[w + 34] = v[10]; m.f32[w + 35] = v[11];
  m.f32[w + 36] = v[12]; m.f32[w + 37] = v[13]; m.f32[w + 38] = v[14]; m.f32[w + 39] = v[15];
}
function w_fixture_all_types(m, base, v) {
  w_fixture_all_types_b(m, base, v.b);
  w_fixture_all_types_i(m, base, v.i);
  w_fixture_all_types_u(m, base, v.u);
  w_fixture_all_types_f(m, base, v.f);
  w_fixture_all_types_v2(m, base, v.v2);
  w_fixture_all_types_v3(m, base, v.v3);
  w_fixture_all_types_v4(m, base, v.v4);
  w_fixture_all_types_c(m, base, v.c);
  w_fixture_all_types_q(m, base, v.q);
  w_fixture_all_types_m(m, base, v.m);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:all_types": { all: w_fixture_all_types, fields: { b: w_fixture_all_types_b, i: w_fixture_all_types_i, u: w_fixture_all_types_u, f: w_fixture_all_types_f, v2: w_fixture_all_types_v2, v3: w_fixture_all_types_v3, v4: w_fixture_all_types_v4, c: w_fixture_all_types_c, q: w_fixture_all_types_q, m: w_fixture_all_types_m } },
};
export {
  w_fixture_all_types,
  w_fixture_all_types_b,
  w_fixture_all_types_i,
  w_fixture_all_types_u,
  w_fixture_all_types_f,
  w_fixture_all_types_v2,
  w_fixture_all_types_v3,
  w_fixture_all_types_v4,
  w_fixture_all_types_c,
  w_fixture_all_types_q,
  w_fixture_all_types_m,
  writers,
};
