struct MtekObject {
    model: mat4x4<f32>,
    normal_matrix: mat4x4<f32>,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekObject;
