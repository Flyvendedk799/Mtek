// Generated from layout builtin:object (size 128). Do not edit.
function w_builtin_MtekObject_model(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 0] = v[0]; m.f32[w + 1] = v[1]; m.f32[w + 2] = v[2]; m.f32[w + 3] = v[3];
  m.f32[w + 4] = v[4]; m.f32[w + 5] = v[5]; m.f32[w + 6] = v[6]; m.f32[w + 7] = v[7];
  m.f32[w + 8] = v[8]; m.f32[w + 9] = v[9]; m.f32[w + 10] = v[10]; m.f32[w + 11] = v[11];
  m.f32[w + 12] = v[12]; m.f32[w + 13] = v[13]; m.f32[w + 14] = v[14]; m.f32[w + 15] = v[15];
}
function w_builtin_MtekObject_normal_matrix(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 16] = v[0]; m.f32[w + 17] = v[1]; m.f32[w + 18] = v[2]; m.f32[w + 19] = v[3];
  m.f32[w + 20] = v[4]; m.f32[w + 21] = v[5]; m.f32[w + 22] = v[6]; m.f32[w + 23] = v[7];
  m.f32[w + 24] = v[8]; m.f32[w + 25] = v[9]; m.f32[w + 26] = v[10]; m.f32[w + 27] = v[11];
  m.f32[w + 28] = v[12]; m.f32[w + 29] = v[13]; m.f32[w + 30] = v[14]; m.f32[w + 31] = v[15];
}
function w_builtin_MtekObject(m, base, v) {
  w_builtin_MtekObject_model(m, base, v.model);
  w_builtin_MtekObject_normal_matrix(m, base, v.normal_matrix);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "builtin:object": { all: w_builtin_MtekObject, fields: { model: w_builtin_MtekObject_model, normal_matrix: w_builtin_MtekObject_normal_matrix } },
};
export {
  w_builtin_MtekObject,
  w_builtin_MtekObject_model,
  w_builtin_MtekObject_normal_matrix,
  writers,
};
