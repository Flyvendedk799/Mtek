// Startup shader of the mount fixture: valid WGSL that creates no pipeline yet (M1-18 wires pipelines).
@vertex
fn mtek_vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  return vec4f(0.0, 0.0, 0.0, 1.0);
}

@fragment
fn mtek_fs() -> @location(0) vec4f {
  return vec4f(1.0, 1.0, 1.0, 1.0);
}
