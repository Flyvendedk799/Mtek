// Generated from layout fixture:array_bool (size 48). Do not edit.
function w_fixture_array_bool_flags(m, base, v) {
  const w = base >>> 2;
  m.u32[w + 0] = v[0] ? 1 : 0;
  m.u32[w + 4] = v[1] ? 1 : 0;
}
function w_fixture_array_bool_after(m, base, v) {
  m.u32[(base >>> 2) + 8] = v;
}
function w_fixture_array_bool(m, base, v) {
  w_fixture_array_bool_flags(m, base, v.flags);
  w_fixture_array_bool_after(m, base, v.after);
}

// Test artifact only: this wrapper is never part of app.js.
const writers = {
  "fixture:array_bool": { all: w_fixture_array_bool, fields: { flags: w_fixture_array_bool_flags, after: w_fixture_array_bool_after } },
};
export {
  w_fixture_array_bool,
  w_fixture_array_bool_flags,
  w_fixture_array_bool_after,
  writers,
};
