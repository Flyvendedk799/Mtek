// Generated from layout fixture:mat4_and_quat (size 96). Do not edit.
function w_fixture_mat4_and_quat_m(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 0] = v[0]; m.f32[w + 1] = v[1]; m.f32[w + 2] = v[2]; m.f32[w + 3] = v[3];
  m.f32[w + 4] = v[4]; m.f32[w + 5] = v[5]; m.f32[w + 6] = v[6]; m.f32[w + 7] = v[7];
  m.f32[w + 8] = v[8]; m.f32[w + 9] = v[9]; m.f32[w + 10] = v[10]; m.f32[w + 11] = v[11];
  m.f32[w + 12] = v[12]; m.f32[w + 13] = v[13]; m.f32[w + 14] = v[14]; m.f32[w + 15] = v[15];
}
function w_fixture_mat4_and_quat_q(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 16] = v.x; m.f32[w + 17] = v.y; m.f32[w + 18] = v.z; m.f32[w + 19] = v.w;
}
function w_fixture_mat4_and_quat_s(m, base, v) {
  m.f32[(base >>> 2) + 20] = v;
}
function w_fixture_mat4_and_quat(m, base, v) {
  w_fixture_mat4_and_quat_m(m, base, v.m);
  w_fixture_mat4_and_quat_q(m, base, v.q);
  w_fixture_mat4_and_quat_s(m, base, v.s);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:mat4_and_quat": { all: w_fixture_mat4_and_quat, fields: { m: w_fixture_mat4_and_quat_m, q: w_fixture_mat4_and_quat_q, s: w_fixture_mat4_and_quat_s } },
};
export {
  w_fixture_mat4_and_quat,
  w_fixture_mat4_and_quat_m,
  w_fixture_mat4_and_quat_q,
  w_fixture_mat4_and_quat_s,
  writers,
};
