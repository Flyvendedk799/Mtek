struct MtekFixture_mixed {
    @size(16) u_a: f32,
    u_b: vec3<f32>,
    u_c: u32,
    u_d: vec2<f32>,
    @size(8) u_e: u32,
    u_f: vec4<f32>,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_mixed;
