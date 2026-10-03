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

@group(1) @binding(0) var<uniform> mtek_params: MtekFrame;
