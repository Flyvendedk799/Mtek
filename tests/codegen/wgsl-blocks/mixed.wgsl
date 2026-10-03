struct MtekFixture_mixed {
    @size(16) a: f32,
    b: vec3<f32>,
    c: u32,
    d: vec2<f32>,
    @size(8) e: u32,
    f: vec4<f32>,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_mixed;
