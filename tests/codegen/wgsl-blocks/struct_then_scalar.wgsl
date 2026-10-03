struct S_Inner {
    k: f32,
}

struct MtekFixture_struct_then_scalar {
    @align(16) @size(16) inner: S_Inner,
    after: f32,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_struct_then_scalar;
