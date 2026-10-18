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

struct MtekParams_e2cab98b_Checker {
    u_metallic: f32,
}

struct MtekObject {
    model: mat4x4<f32>,
    normal_matrix: mat4x4<f32>,
}

struct MtekVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(1) world_position: vec3<f32>,
    @location(2) world_normal: vec3<f32>,
    @location(3) uv: vec2<f32>,
}

struct MtekSurfaceInput {
    world_position: vec3<f32>,
    world_normal: vec3<f32>,
    uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> mtek_frame: MtekFrame;
@group(1) @binding(0) var<uniform> mtek_params: MtekParams_e2cab98b_Checker;
@group(2) @binding(0) var<uniform> mtek_object: MtekObject;

fn mtek_lighting_pbr(mtek_surface: MtekSurfaceInput, mtek_base_color: vec4<f32>, mtek_metallic: f32, mtek_roughness: f32) -> vec4<f32> {
    let mtek_c = mtek_base_color.xyz;
    let mtek_r = clamp(mtek_roughness, 0.045, 1.0);
    let mtek_alpha = mtek_r * mtek_r;
    let mtek_a2 = mtek_alpha * mtek_alpha;
    let mtek_m = clamp(mtek_metallic, 0.0, 1.0);
    let mtek_f0 = (vec3<f32>(0.04) * (1.0 - mtek_m)) + (mtek_c * mtek_m);
    let mtek_n = mtek_surface.world_normal;
    let mtek_v = normalize(mtek_frame.camera_position - mtek_surface.world_position);
    let mtek_nv = max(dot(mtek_n, mtek_v), 0.0001);
    var mtek_rgb = vec3<f32>(0.0);
    for (var mtek_i = 0u; mtek_i < min(mtek_frame.light_count, 4u); mtek_i++) {
        let mtek_light = mtek_frame.lights[mtek_i];
        let mtek_range = mtek_light.range;
        let mtek_is_point = mtek_light.kind == 1u;
        let mtek_to_light = mtek_light.position - mtek_surface.world_position;
        let mtek_distance2 = dot(mtek_to_light, mtek_to_light);
        let mtek_l = normalize(select(-mtek_light.direction, mtek_to_light, mtek_is_point));
        let mtek_nl = max(dot(mtek_n, mtek_l), 0.0);
        let mtek_ratio = sqrt(mtek_distance2) / select(mtek_range, 1.0, mtek_range == 0.0);
        let mtek_ratio2 = mtek_ratio * mtek_ratio;
        let mtek_falloff = clamp(1.0 - (mtek_ratio2 * mtek_ratio2), 0.0, 1.0);
        let mtek_window = select(mtek_falloff, 1.0, mtek_range == 0.0);
        let mtek_radiance = select(mtek_light.color, mtek_light.color * (mtek_window / max(mtek_distance2, 0.0001)), mtek_is_point);
        if mtek_nl > 0.0 {
            let mtek_lv = mtek_l + mtek_v;
            if dot(mtek_lv, mtek_lv) > 0.0 {
                let mtek_h = normalize(mtek_lv);
                let mtek_nh = max(dot(mtek_n, mtek_h), 0.0);
                let mtek_vh = max(dot(mtek_v, mtek_h), 0.0);
                let mtek_nh2 = mtek_nh * mtek_nh;
                let mtek_spread = (1.0 - mtek_nh2) + (mtek_nh2 * mtek_a2);
                let mtek_d = mtek_a2 / ((3.1415927 * mtek_spread) * mtek_spread);
                let mtek_denominator = (mtek_nl * sqrt(((mtek_nv * mtek_nv) * (1.0 - mtek_a2)) + mtek_a2)) + (mtek_nv * sqrt(((mtek_nl * mtek_nl) * (1.0 - mtek_a2)) + mtek_a2));
                let mtek_vis = select(0.5 / mtek_denominator, 0.0, mtek_denominator == 0.0);
                let mtek_t = 1.0 - mtek_vh;
                let mtek_t5 = ((mtek_t * mtek_t) * (mtek_t * mtek_t)) * mtek_t;
                let mtek_fresnel = mtek_f0 + ((vec3<f32>(1.0) - mtek_f0) * mtek_t5);
                let mtek_fresnel_d = 0.04 + (0.96 * mtek_t5);
                let mtek_specular = mtek_fresnel * (mtek_d * mtek_vis);
                let mtek_diffuse = mtek_c * (((1.0 - mtek_m) * (1.0 - mtek_fresnel_d)) / 3.1415927);
                mtek_rgb = mtek_rgb + (((mtek_diffuse + mtek_specular) * mtek_radiance) * mtek_nl);
            }
        }
    }
    return vec4<f32>(mtek_rgb + ((mtek_c * (1.0 - mtek_m)) * mtek_frame.ambient), 1.0);
}

fn mtek_fragment(u_p_input: MtekSurfaceInput) -> vec4<f32> {
    if u_p_input.uv.x < 0.5 {
        return mtek_lighting_pbr(u_p_input, vec4<f32>(1.0, 1.0, 1.0, 1.0), mtek_params.u_metallic, 0.3);
    }
    return mtek_lighting_pbr(u_p_input, vec4<f32>(0.014443844, 0.014443844, 0.014443844, 1.0), 0.0, u_p_input.uv.y);
}

@vertex
fn mtek_vs(@location(0) mtek_position: vec3<f32>, @location(1) mtek_normal: vec3<f32>, @location(2) mtek_uv: vec2<f32>) -> MtekVertexOutput {
    let mtek_world = mtek_object.model * vec4<f32>(mtek_position, 1.0);
    let mtek_world_normal = normalize((mtek_object.normal_matrix * vec4<f32>(mtek_normal, 0.0)).xyz);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_world.xyz, mtek_world_normal, mtek_uv);
}

@vertex
fn mtek_vs_instanced(@location(0) mtek_position: vec3<f32>, @location(1) mtek_normal: vec3<f32>, @location(2) mtek_uv: vec2<f32>, @location(3) mtek_model_c0: vec4<f32>, @location(4) mtek_model_c1: vec4<f32>, @location(5) mtek_model_c2: vec4<f32>, @location(6) mtek_model_c3: vec4<f32>, @location(7) mtek_normal_c0: vec4<f32>, @location(8) mtek_normal_c1: vec4<f32>, @location(9) mtek_normal_c2: vec4<f32>, @location(10) mtek_normal_c3: vec4<f32>) -> MtekVertexOutput {
    let mtek_world = mat4x4<f32>(mtek_model_c0, mtek_model_c1, mtek_model_c2, mtek_model_c3) * vec4<f32>(mtek_position, 1.0);
    let mtek_world_normal = normalize((mat4x4<f32>(mtek_normal_c0, mtek_normal_c1, mtek_normal_c2, mtek_normal_c3) * vec4<f32>(mtek_normal, 0.0)).xyz);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_world.xyz, mtek_world_normal, mtek_uv);
}

@fragment
fn mtek_fs(mtek_in: MtekVertexOutput) -> @location(0) vec4<f32> {
    let mtek_surface = MtekSurfaceInput(mtek_in.world_position, normalize(mtek_in.world_normal), mtek_in.uv);
    let mtek_color = mtek_fragment(mtek_surface);
    return vec4<f32>(mtek_color.xyz, 1.0);
}
