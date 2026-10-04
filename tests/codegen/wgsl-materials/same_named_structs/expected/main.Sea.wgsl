struct MtekLight {
    color: vec3<f32>,
    kind: u32,
    position: vec3<f32>,
    range: f32,
    direction: vec3<f32>,
    reserved: f32,
}

struct MtekFrame {
    view_proj: mat4x4<f32>,
    camera_position: vec3<f32>,
    light_count: u32,
    ambient: vec3<f32>,
    reserved0: f32,
    @align(16) lights: array<MtekLight, 4>,
}

struct MtekParams_e2cab98b_Sea {
    u_level: f32,
}

struct S_e2cab98b_Wave {
    u_height: f32,
}

struct S_374eeed3_Wave {
    u_height: f32,
    u_width: f32,
}

struct MtekObject {
    model: mat4x4<f32>,
    normal_matrix: mat4x4<f32>,
}

struct MtekVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
}

@group(0) @binding(0) var<uniform> mtek_frame: MtekFrame;
@group(1) @binding(0) var<uniform> mtek_params: MtekParams_e2cab98b_Sea;
@group(2) @binding(0) var<uniform> mtek_object: MtekObject;

fn u_fn_374eeed3_make_wave(u_p_h: f32) -> S_374eeed3_Wave {
    return S_374eeed3_Wave(u_p_h * 2.0, u_p_h);
}

fn mtek_fragment() -> vec4<f32> {
    let u_l_mine = S_e2cab98b_Wave(mtek_params.u_level);
    let u_l_theirs = u_fn_374eeed3_make_wave(mtek_params.u_level);
    return vec4<f32>(vec3<f32>(u_l_mine.u_height, u_l_theirs.u_height, u_l_theirs.u_width), 1.0);
}

@vertex
fn mtek_vs(@location(0) mtek_position: vec3<f32>) -> MtekVertexOutput {
    let mtek_world = mtek_object.model * vec4<f32>(mtek_position, 1.0);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world);
}

@fragment
fn mtek_fs() -> @location(0) vec4<f32> {
    let mtek_color = mtek_fragment();
    return vec4<f32>(mtek_color.xyz, 1.0);
}
