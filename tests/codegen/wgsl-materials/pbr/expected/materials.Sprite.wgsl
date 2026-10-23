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
    exposure: f32,
    @align(16) lights: array<MtekLight, 4>,
}

struct MtekParams_2b212d15_Sprite {
    u_tint: vec4<f32>,
    u_cell: f32,
    u_columns: f32,
    u_rows: f32,
}

struct MtekObject {
    model: mat4x4<f32>,
    normal_matrix: mat4x4<f32>,
}

struct MtekVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(3) uv: vec2<f32>,
}

struct MtekSurfaceInput {
    uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> mtek_frame: MtekFrame;
@group(1) @binding(0) var<uniform> mtek_params: MtekParams_2b212d15_Sprite;
@group(1) @binding(1) var mtek_texture_sheet: texture_2d<f32>;
@group(1) @binding(2) var mtek_sampler_sheet_sampler: sampler;
@group(2) @binding(0) var<uniform> mtek_object: MtekObject;

fn mtek_fragment(u_p_surface: MtekSurfaceInput) -> vec4<f32> {
    let u_l_cols = clamp(floor(mtek_params.u_columns), 1.0, 64.0);
    let u_l_rws = clamp(floor(mtek_params.u_rows), 1.0, 64.0);
    let u_l_count = u_l_cols * u_l_rws;
    let u_l_index = clamp(floor(mtek_params.u_cell - (u_l_count * floor(mtek_params.u_cell / u_l_count))), 0.0, u_l_count - 1.0);
    let u_l_row = floor(u_l_index / u_l_cols);
    let u_l_column = u_l_index - (u_l_row * u_l_cols);
    let u_l_uv = (u_p_surface.uv + vec2<f32>(u_l_column, u_l_row)) / vec2<f32>(u_l_cols, u_l_rws);
    let u_l_texel = textureSampleLevel(mtek_texture_sheet, mtek_sampler_sheet_sampler, u_l_uv, 0.0);
    return vec4<f32>(mtek_params.u_tint.xyz * u_l_texel.xyz, mtek_params.u_tint.w * u_l_texel.w);
}

@vertex
fn mtek_vs(@location(0) mtek_position: vec3<f32>, @location(2) mtek_uv: vec2<f32>) -> MtekVertexOutput {
    let mtek_world = mtek_object.model * vec4<f32>(mtek_position, 1.0);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_uv);
}

@vertex
fn mtek_vs_instanced(@location(0) mtek_position: vec3<f32>, @location(2) mtek_uv: vec2<f32>, @location(3) mtek_model_c0: vec4<f32>, @location(4) mtek_model_c1: vec4<f32>, @location(5) mtek_model_c2: vec4<f32>, @location(6) mtek_model_c3: vec4<f32>, @location(7) mtek_normal_c0: vec4<f32>, @location(8) mtek_normal_c1: vec4<f32>, @location(9) mtek_normal_c2: vec4<f32>, @location(10) mtek_normal_c3: vec4<f32>) -> MtekVertexOutput {
    let mtek_world = mat4x4<f32>(mtek_model_c0, mtek_model_c1, mtek_model_c2, mtek_model_c3) * vec4<f32>(mtek_position, 1.0);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_uv);
}

@fragment
fn mtek_fs(mtek_in: MtekVertexOutput) -> @location(0) vec4<f32> {
    let mtek_surface = MtekSurfaceInput(mtek_in.uv);
    let mtek_color = mtek_fragment(mtek_surface);
    return mtek_color;
}
