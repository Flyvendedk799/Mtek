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

struct MtekParams_e2cab98b_Semantics {
    u_a: i32,
    u_b: i32,
    u_u: u32,
    u_v: u32,
    u_tint: vec4<f32>,
}

struct MtekObject {
    model: mat4x4<f32>,
    normal_matrix: mat4x4<f32>,
}

struct MtekVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
}

@group(0) @binding(0) var<uniform> mtek_frame: MtekFrame;
@group(1) @binding(0) var<uniform> mtek_params: MtekParams_e2cab98b_Semantics;
@group(2) @binding(0) var<uniform> mtek_object: MtekObject;

fn u_fn_e2cab98b_ints(u_p_a: i32, u_p_b: i32, u_p_u: u32, u_p_v: u32) -> f32 {
    let u_l_q = u_p_a / u_p_b;
    let u_l_r = u_p_a % u_p_b;
    let u_l_uq = u_p_u / u_p_v;
    let u_l_ur = u_p_u % u_p_v;
    let u_l_neg = -u_p_a;
    let u_l_m = i32(-2147483647 - 1);
    let u_l_mixed = ((max(u_p_a, u_l_m) + min(u_l_q, u_l_r)) + clamp(u_l_neg, -4i, 4i)) + abs(u_p_a);
    let u_l_cu = clamp(u_l_uq + u_l_ur, 0u, 10u);
    let u_l_back = bitcast<i32>(u_p_u) + i32(f32(u_p_a) * 0.5);
    let u_l_flt = f32(bitcast<u32>(u_l_back));
    return ((f32(u_l_mixed) + f32(u_l_cu)) + u_l_flt) + (f32(u_p_a) % 2.5);
}

fn mtek_fragment() -> vec4<f32> {
    let u_l_x = u_fn_e2cab98b_ints(mtek_params.u_a, mtek_params.u_b, mtek_params.u_u, mtek_params.u_v);
    let u_l_s = (smoothstep(0.0, 1.0, fract(u_l_x)) + step(0.5, u_l_x)) + mix(0.0, 1.0, saturate(u_l_x));
    let u_l_g = vec3<f32>(pow(2.0, u_l_x), exp2(u_l_x), log2(abs(u_l_x) + 1.0));
    let u_l_d = dot(normalize(u_l_g + vec3<f32>(1.0, 1.0, 1.0)), vec3<f32>(0.0, 1.0, 0.0));
    let u_l_mt = mat4x4<f32>(vec4<f32>(1.0, 2.0, 3.0, 4.0), vec4<f32>(1.0, 2.0, 3.0, 4.0), vec4<f32>(1.0, 2.0, 3.0, 4.0), vec4<f32>(1.0, 2.0, 3.0, 4.0));
    let u_l_col = u_l_mt[clamp(mtek_params.u_b, 0i, 3i)];
    let u_l_ok = (u_l_x > 0.0) && ((mtek_params.u_a != mtek_params.u_b) || (!(mtek_params.u_u == mtek_params.u_v)));
    var u_l_out = mtek_params.u_tint.xyz * u_l_s;
    if u_l_ok {
        u_l_out.y = u_l_d + u_l_col.x;
    } else if u_l_x < (-1.0) {
        u_l_out = -u_l_out;
    } else {
        u_l_out = vec3<f32>(round(u_l_x), inverseSqrt(4.0 + (u_l_x * u_l_x)), atan2(u_l_x, 1.0));
    }
    return vec4<f32>(u_l_out, mtek_params.u_tint.w);
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
