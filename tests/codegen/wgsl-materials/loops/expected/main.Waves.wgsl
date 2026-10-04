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

struct MtekPad16_f32 {
    @size(16) value: f32,
}

struct MtekParams_e2cab98b_Waves {
    @size(16) u_scale: f32,
    @align(16) u_samples: array<MtekPad16_f32, 4>,
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
@group(1) @binding(0) var<uniform> mtek_params: MtekParams_e2cab98b_Waves;
@group(2) @binding(0) var<uniform> mtek_object: MtekObject;

fn u_fn_e2cab98b_ripple(u_p_x: f32) -> f32 {
    var u_l_sum = 0.0;
    for (var u_l_i = 0i; u_l_i < 4i; u_l_i++) {
        if u_l_i == 2i {
            continue;
        }
        u_l_sum = u_l_sum + sin(u_p_x * f32(u_l_i + 1i));
    }
    for (var u_l_k = 0u; u_l_k < 3u; u_l_k++) {
        if u_l_sum > 2.0 {
            break;
        }
        u_l_sum = u_l_sum + (f32(u_l_k) * 0.125);
    }
    return u_l_sum;
}

fn u_fn_e2cab98b_total(u_p_values: array<MtekPad16_f32, 4>) -> f32 {
    var u_l_acc = 0.0;
    {
        let mtek_each_v = u_p_values;
        for (var mtek_at_v = 0u; mtek_at_v < 4u; mtek_at_v++) {
            let u_l_v = mtek_each_v[mtek_at_v].value;
            if u_l_v < 0.0 {
                break;
            }
            u_l_acc = u_l_acc + u_l_v;
        }
    }
    return u_l_acc;
}

fn mtek_fragment(u_p_surface: MtekSurfaceInput) -> vec4<f32> {
    let u_l_r = u_fn_e2cab98b_ripple(u_p_surface.uv.x * mtek_params.u_scale);
    let u_l_t = u_fn_e2cab98b_total(mtek_params.u_samples);
    var u_l_g = 0.0;
    for (var u_l_j = 0i; u_l_j < 2i; u_l_j++) {
        u_l_g = u_l_g + mtek_params.u_samples[clamp(u_l_j, 0i, 3i)].value;
    }
    {
        let u_l_inner = u_l_g * 0.5;
        u_l_g = u_l_inner + u_l_t;
    }
    return vec4<f32>(vec3<f32>(u_l_r, u_l_g, u_l_t), 1.0);
}

@vertex
fn mtek_vs(@location(0) mtek_position: vec3<f32>, @location(2) mtek_uv: vec2<f32>) -> MtekVertexOutput {
    let mtek_world = mtek_object.model * vec4<f32>(mtek_position, 1.0);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_uv);
}

@fragment
fn mtek_fs(mtek_in: MtekVertexOutput) -> @location(0) vec4<f32> {
    let mtek_surface = MtekSurfaceInput(mtek_in.uv);
    let mtek_color = mtek_fragment(mtek_surface);
    return vec4<f32>(mtek_color.xyz, 1.0);
}
