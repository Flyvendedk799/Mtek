// Generated from layout builtin:frame (size 288). Do not edit.
function w_builtin_MtekFrame_view_proj(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 0] = v[0]; m.f32[w + 1] = v[1]; m.f32[w + 2] = v[2]; m.f32[w + 3] = v[3];
  m.f32[w + 4] = v[4]; m.f32[w + 5] = v[5]; m.f32[w + 6] = v[6]; m.f32[w + 7] = v[7];
  m.f32[w + 8] = v[8]; m.f32[w + 9] = v[9]; m.f32[w + 10] = v[10]; m.f32[w + 11] = v[11];
  m.f32[w + 12] = v[12]; m.f32[w + 13] = v[13]; m.f32[w + 14] = v[14]; m.f32[w + 15] = v[15];
}
function w_builtin_MtekFrame_camera_position(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 16] = v.x; m.f32[w + 17] = v.y; m.f32[w + 18] = v.z;
}
function w_builtin_MtekFrame_light_count(m, base, v) {
  m.u32[(base >>> 2) + 19] = v;
}
function w_builtin_MtekFrame_ambient(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 20] = v.x; m.f32[w + 21] = v.y; m.f32[w + 22] = v.z;
}
function w_builtin_MtekFrame_reserved0(m, base, v) {
  m.f32[(base >>> 2) + 23] = v;
}
function w_builtin_MtekFrame_lights(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 24] = v[0].color.x; m.f32[w + 25] = v[0].color.y; m.f32[w + 26] = v[0].color.z;
  m.u32[w + 27] = v[0].kind;
  m.f32[w + 28] = v[0].position.x; m.f32[w + 29] = v[0].position.y; m.f32[w + 30] = v[0].position.z;
  m.f32[w + 31] = v[0].range;
  m.f32[w + 32] = v[0].direction.x; m.f32[w + 33] = v[0].direction.y; m.f32[w + 34] = v[0].direction.z;
  m.f32[w + 35] = v[0].reserved;
  m.f32[w + 36] = v[1].color.x; m.f32[w + 37] = v[1].color.y; m.f32[w + 38] = v[1].color.z;
  m.u32[w + 39] = v[1].kind;
  m.f32[w + 40] = v[1].position.x; m.f32[w + 41] = v[1].position.y; m.f32[w + 42] = v[1].position.z;
  m.f32[w + 43] = v[1].range;
  m.f32[w + 44] = v[1].direction.x; m.f32[w + 45] = v[1].direction.y; m.f32[w + 46] = v[1].direction.z;
  m.f32[w + 47] = v[1].reserved;
  m.f32[w + 48] = v[2].color.x; m.f32[w + 49] = v[2].color.y; m.f32[w + 50] = v[2].color.z;
  m.u32[w + 51] = v[2].kind;
  m.f32[w + 52] = v[2].position.x; m.f32[w + 53] = v[2].position.y; m.f32[w + 54] = v[2].position.z;
  m.f32[w + 55] = v[2].range;
  m.f32[w + 56] = v[2].direction.x; m.f32[w + 57] = v[2].direction.y; m.f32[w + 58] = v[2].direction.z;
  m.f32[w + 59] = v[2].reserved;
  m.f32[w + 60] = v[3].color.x; m.f32[w + 61] = v[3].color.y; m.f32[w + 62] = v[3].color.z;
  m.u32[w + 63] = v[3].kind;
  m.f32[w + 64] = v[3].position.x; m.f32[w + 65] = v[3].position.y; m.f32[w + 66] = v[3].position.z;
  m.f32[w + 67] = v[3].range;
  m.f32[w + 68] = v[3].direction.x; m.f32[w + 69] = v[3].direction.y; m.f32[w + 70] = v[3].direction.z;
  m.f32[w + 71] = v[3].reserved;
}
function w_builtin_MtekFrame(m, base, v) {
  w_builtin_MtekFrame_view_proj(m, base, v.view_proj);
  w_builtin_MtekFrame_camera_position(m, base, v.camera_position);
  w_builtin_MtekFrame_light_count(m, base, v.light_count);
  w_builtin_MtekFrame_ambient(m, base, v.ambient);
  w_builtin_MtekFrame_reserved0(m, base, v.reserved0);
  w_builtin_MtekFrame_lights(m, base, v.lights);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "builtin:frame": { all: w_builtin_MtekFrame, fields: { view_proj: w_builtin_MtekFrame_view_proj, camera_position: w_builtin_MtekFrame_camera_position, light_count: w_builtin_MtekFrame_light_count, ambient: w_builtin_MtekFrame_ambient, reserved0: w_builtin_MtekFrame_reserved0, lights: w_builtin_MtekFrame_lights } },
};
export {
  w_builtin_MtekFrame,
  w_builtin_MtekFrame_view_proj,
  w_builtin_MtekFrame_camera_position,
  w_builtin_MtekFrame_light_count,
  w_builtin_MtekFrame_ambient,
  w_builtin_MtekFrame_reserved0,
  w_builtin_MtekFrame_lights,
  writers,
};
