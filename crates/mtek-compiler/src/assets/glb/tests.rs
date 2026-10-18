//! Tests of the GLB reader on files built in memory. The generated files of `tests/assets`
//! cover every row of the profile through the whole compiler; these pin the details of the
//! reader itself: order, caps, limits and values.

use serde_json::{Value, json};

use super::*;

fn le(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// The container around `json` and `bin`.
fn container(json: &Value, bin: Option<&[u8]>) -> Vec<u8> {
    let mut text = serde_json::to_vec(json).unwrap();
    while !text.len().is_multiple_of(4) {
        text.push(b' ');
    }
    let mut bin_chunk = bin.map(<[u8]>::to_vec);
    if let Some(bin) = &mut bin_chunk {
        while !bin.len().is_multiple_of(4) {
            bin.push(0);
        }
    }
    let total = 12 + 8 + text.len() + bin_chunk.as_ref().map_or(0, |b| 8 + b.len());
    let mut out = Vec::new();
    out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
    out.extend_from_slice(&2_u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&(text.len() as u32).to_le_bytes());
    out.extend_from_slice(&CHUNK_JSON.to_le_bytes());
    out.extend_from_slice(&text);
    if let Some(bin) = bin_chunk {
        out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
        out.extend_from_slice(&CHUNK_BIN.to_le_bytes());
        out.extend_from_slice(&bin);
    }
    out
}

/// One triangle `Tri` at (0,0,0), (1,0,0), (0,1,0) with `u16` indices.
fn base() -> (Value, Vec<u8>) {
    let mut bin = le(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
    for index in [0_u16, 1, 2] {
        bin.extend_from_slice(&index.to_le_bytes());
    }
    let json = json!({
        "asset": { "version": "2.0" },
        "scene": 0,
        "scenes": [{ "nodes": [0] }],
        "nodes": [{ "name": "Tri", "mesh": 0 }],
        "meshes": [{ "name": "Tri", "primitives": [
            { "attributes": { "POSITION": 0 }, "indices": 1, "material": 0 }
        ] }],
        "materials": [{ "name": "Plain" }],
        "accessors": [
            { "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3",
              "min": [0, 0, 0], "max": [1, 1, 0] },
            { "bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR" }
        ],
        "bufferViews": [
            { "buffer": 0, "byteOffset": 0, "byteLength": 36 },
            { "buffer": 0, "byteOffset": 36, "byteLength": 6 }
        ],
        "buffers": [{ "byteLength": 42 }]
    });
    (json, bin)
}

fn read(json: &Value, bin: &[u8]) -> Result<GlbFile, Vec<Issue>> {
    read_with(json, bin, &AssetLimits::default())
}

fn read_with(json: &Value, bin: &[u8], limits: &AssetLimits) -> Result<GlbFile, Vec<Issue>> {
    read_glb("models/m.glb", &container(json, Some(bin)), limits)
}

fn codes(result: &Result<GlbFile, Vec<Issue>>) -> Vec<&'static str> {
    match result {
        Ok(_) => Vec::new(),
        Err(issues) => issues.iter().map(|i| i.code.short()).collect(),
    }
}

#[test]
fn a_valid_triangle_reads_with_its_values() {
    let (json, bin) = base();
    let file = read(&json, &bin).unwrap();
    assert_eq!(file.path, "models/m.glb");
    assert_eq!(file.meshes.len(), 1);
    let primitive = &file.meshes[0].primitives[0];
    assert_eq!(primitive.vertex_count, 3);
    assert_eq!(primitive.index_count, 3);
    assert_eq!(
        primitive.position,
        Strided {
            offset: 0,
            stride: 12
        }
    );
    assert_eq!(
        primitive.indices,
        Some(IndexSource {
            offset: 36,
            kind: IndexKind::U16
        })
    );
    assert!(primitive.normal.is_none() && primitive.uv.is_none());
    assert_eq!(file.materials[0].base_color, [1.0, 1.0, 1.0, 1.0]);
    assert_eq!(file.materials[0].metallic, 1.0);
    assert_eq!(file.materials[0].roughness, 1.0);
    assert_eq!(file.default_scene, Some(0));
    assert_eq!(file.scenes, [vec![0]]);
    assert_eq!(file.sha256.len(), 64);
}

#[test]
fn the_bounding_sphere_encloses_every_vertex_and_is_centred_on_the_box() {
    let (json, bin) = base();
    let primitive = read(&json, &bin).unwrap().meshes[0].primitives[0].clone();
    assert_eq!(primitive.bounds_center, [0.5, 0.5, 0.0]);
    let half_diagonal = (0.5_f64 * 0.5 + 0.5 * 0.5).sqrt();
    let radius = f64::from(primitive.bounds_radius);
    assert!(
        radius >= half_diagonal && radius - half_diagonal < 1e-6,
        "{radius}"
    );
}

#[test]
fn rows_are_reported_in_the_order_of_the_profile_table() {
    let (mut json, bin) = base();
    // Written in the reverse order of the table: animations, material, mode.
    json["animations"] = json!([{ "channels": [{ "sampler": 0, "target": { "node": 0, "path": "translation" } }],
        "samplers": [{ "input": 1, "output": 0 }] }]);
    json["materials"][0]["alphaMode"] = json!("BLEND");
    json["meshes"][0]["primitives"][0]["mode"] = json!(1);
    assert_eq!(codes(&read(&json, &bin)), ["E7006", "E7015", "E7019"]);
}

#[test]
fn a_file_with_extensions_is_not_looked_at_any_further() {
    let (mut json, bin) = base();
    json["extensionsUsed"] = json!(["KHR_draco_mesh_compression"]);
    json["extensionsRequired"] = json!(["KHR_draco_mesh_compression"]);
    json["meshes"][0]["primitives"][0]["mode"] = json!(1);
    assert_eq!(codes(&read(&json, &bin)), ["E7004"]);
}

#[test]
fn the_container_and_extension_rows_report_together() {
    let (mut json, bin) = base();
    json["buffers"][0]["uri"] = json!("model.bin");
    json["extensionsUsed"] = json!(["KHR_materials_unlit"]);
    assert_eq!(codes(&read(&json, &bin)), ["E7003", "E7005"]);
}

#[test]
fn an_extension_is_listed_once_whether_declared_or_found() {
    let (mut json, bin) = base();
    json["extensionsUsed"] = json!(["KHR_materials_unlit"]);
    json["materials"][0]["extensions"] =
        json!({ "KHR_materials_unlit": {}, "KHR_materials_ior": {} });
    let issues = read(&json, &bin).unwrap_err();
    assert_eq!(issues.len(), 1);
    assert_eq!(
        issues[0].message,
        "The file uses the glTF extensions KHR_materials_ior, KHR_materials_unlit; the v0.1 profile supports none."
    );
}

#[test]
fn many_problems_are_capped_with_a_count_of_the_rest() {
    let (mut json, bin) = base();
    let materials: Vec<Value> = (0..40)
        .map(|i| json!({ "name": format!("m{i}"), "alphaMode": "BLEND" }))
        .collect();
    json["materials"] = Value::Array(materials);
    let issues = read(&json, &bin).unwrap_err();
    assert_eq!(issues.len(), 24);
    assert!(issues.iter().all(|i| i.code == Code::E7015));
    assert_eq!(
        issues[23].notes,
        ["16 more problems in this file are not shown"]
    );
    assert!(issues[..23].iter().all(|i| i.notes.is_empty()));
}

#[test]
fn a_file_at_the_limit_reads_and_one_byte_over_is_e7002() {
    let (json, bin) = base();
    let bytes = container(&json, Some(&bin));
    let exact = AssetLimits {
        max_file_bytes: bytes.len() as u64,
        ..AssetLimits::default()
    };
    assert!(read_glb("m.glb", &bytes, &exact).is_ok());
    let under = AssetLimits {
        max_file_bytes: bytes.len() as u64 - 1,
        ..AssetLimits::default()
    };
    let issues = read_glb("m.glb", &bytes, &under).unwrap_err();
    assert_eq!(issues[0].code, Code::E7002);
}

#[test]
fn the_json_chunk_limit_is_checked_before_the_chunk_is_read() {
    // A header and a chunk header that claim 17 MiB of JSON; the file ends after them.
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&GLB_MAGIC.to_le_bytes());
    bytes.extend_from_slice(&2_u32.to_le_bytes());
    bytes.extend_from_slice(&20_u32.to_le_bytes());
    bytes.extend_from_slice(&(17_u32 * 1024 * 1024).to_le_bytes());
    bytes.extend_from_slice(&CHUNK_JSON.to_le_bytes());
    let issues = read_glb("m.glb", &bytes, &AssetLimits::default()).unwrap_err();
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, Code::E7002);
}

#[test]
fn the_vertex_limit_is_checked_before_vertex_data_is_read() {
    let (json, bin) = base();
    let limits = AssetLimits {
        max_vertices_per_primitive: 2,
        ..AssetLimits::default()
    };
    let issues = read_with(&json, &bin, &limits).unwrap_err();
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, Code::E7026);
}

/// A PNG header of `width` by `height` (no pixel data: only the header is read).
fn png_header(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    bytes.extend_from_slice(&13_u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
    bytes.extend_from_slice(&[0, 0, 0, 0]);
    bytes
}

fn with_image(bytes: &[u8], mime: &str) -> (Value, Vec<u8>) {
    let (mut json, mut bin) = base();
    while !bin.len().is_multiple_of(4) {
        bin.push(0);
    }
    let start = bin.len();
    bin.extend_from_slice(bytes);
    json["bufferViews"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "buffer": 0, "byteOffset": start, "byteLength": bytes.len() }));
    json["buffers"][0]["byteLength"] = json!(bin.len());
    json["images"] = json!([{ "bufferView": 2, "mimeType": mime }]);
    json["textures"] = json!([{ "source": 0 }]);
    json["materials"][0]["pbrMetallicRoughness"] = json!({ "baseColorTexture": { "index": 0 } });
    (json, bin)
}

#[test]
fn image_sizes_up_to_the_limit_are_accepted() {
    let (json, bin) = with_image(&png_header(8192, 1), "image/png");
    let file = read(&json, &bin).unwrap();
    assert_eq!((file.images[0].width, file.images[0].height), (8192, 1));
    assert_eq!(file.materials[0].texture.unwrap().image, 0);
    let (json, bin) = with_image(&png_header(8193, 1), "image/png");
    assert_eq!(codes(&read(&json, &bin)), ["E7017"]);
    let (json, bin) = with_image(&png_header(0, 4), "image/png");
    assert_eq!(codes(&read(&json, &bin)), ["E7017"]);
}

#[test]
fn the_texture_dimension_limit_is_configurable() {
    let (json, bin) = with_image(&png_header(64, 64), "image/png");
    let limits = AssetLimits {
        max_texture_dimension: 32,
        ..AssetLimits::default()
    };
    let issues = read_with(&json, &bin, &limits).unwrap_err();
    assert_eq!(issues[0].code, Code::E7017);
    assert!(issues[0].message.contains("over the limit of 32 per side"));
}

fn sampler_choice(sampler: Value) -> Result<SamplerChoice, Vec<Issue>> {
    let (mut json, bin) = with_image(&png_header(2, 2), "image/png");
    json["samplers"] = json!([sampler]);
    json["textures"][0]["sampler"] = json!(0);
    read(&json, &bin).map(|file| file.materials[0].texture.unwrap().sampler)
}

#[test]
fn samplers_map_to_presets() {
    let default = with_image(&png_header(2, 2), "image/png");
    let file = read(&default.0, &default.1).unwrap();
    assert_eq!(
        file.materials[0].texture.unwrap().sampler,
        SamplerChoice::DEFAULT
    );
    assert_eq!(
        SamplerChoice::DEFAULT.builtin().name(),
        "sampler.linear_repeat"
    );
    let cases = [
        (json!({}), "sampler.linear_repeat", false),
        (
            json!({ "wrapS": 33071, "wrapT": 33071 }),
            "sampler.linear_clamp",
            false,
        ),
        (
            json!({ "magFilter": 9728, "minFilter": 9728 }),
            "sampler.nearest_repeat",
            false,
        ),
        (
            json!({ "magFilter": 9728, "minFilter": 9984, "wrapS": 33071, "wrapT": 33071 }),
            "sampler.nearest_clamp",
            true,
        ),
        (
            json!({ "magFilter": 9729, "minFilter": 9987 }),
            "sampler.linear_repeat",
            true,
        ),
        (json!({ "minFilter": 9729 }), "sampler.linear_repeat", false),
        (
            json!({ "magFilter": 9728 }),
            "sampler.nearest_repeat",
            false,
        ),
    ];
    for (sampler, preset, mipmapped) in cases {
        let choice = sampler_choice(sampler.clone()).unwrap();
        assert_eq!(choice.builtin().name(), preset, "{sampler}");
        assert_eq!(choice.mipmapped, mipmapped, "{sampler}");
    }
    let issues = sampler_choice(json!({ "wrapS": 33648 })).unwrap_err();
    assert_eq!(issues[0].code, Code::E7018);
}

#[test]
fn non_indexed_u8_and_u32_primitives_are_described_as_they_are_stored() {
    let (mut json, mut bin) = base();
    // Two more primitives sharing the positions: u8 indices at 44, u32 indices at 48.
    bin.extend_from_slice(&[0, 0, 0, 1, 2, 0]);
    for index in [0_u32, 1, 2] {
        bin.extend_from_slice(&index.to_le_bytes());
    }
    let views = json["bufferViews"].as_array_mut().unwrap();
    views.push(json!({ "buffer": 0, "byteOffset": 44, "byteLength": 3 }));
    views.push(json!({ "buffer": 0, "byteOffset": 48, "byteLength": 12 }));
    let accessors = json["accessors"].as_array_mut().unwrap();
    accessors.push(json!({ "bufferView": 2, "componentType": 5121, "count": 3, "type": "SCALAR" }));
    accessors.push(json!({ "bufferView": 3, "componentType": 5125, "count": 3, "type": "SCALAR" }));
    json["buffers"][0]["byteLength"] = json!(bin.len());
    json["meshes"][0]["primitives"] = json!([
        { "attributes": { "POSITION": 0 } },
        { "attributes": { "POSITION": 0 }, "indices": 2 },
        { "attributes": { "POSITION": 0 }, "indices": 3 }
    ]);
    let file = read(&json, &bin).unwrap();
    let kinds: Vec<Option<IndexKind>> = file.meshes[0]
        .primitives
        .iter()
        .map(|p| p.indices.map(|i| i.kind))
        .collect();
    assert_eq!(kinds, [None, Some(IndexKind::U8), Some(IndexKind::U32)]);
}

#[test]
fn nodes_scenes_and_the_default_scene_are_read() {
    let (mut json, bin) = base();
    json["nodes"] = json!([
        { "name": "A", "children": [1], "translation": [1, 2, 3] },
        { "name": "B", "matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 4,5,6,1] },
        { "name": "C", "translation": [1, 0, 0], "matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] }
    ]);
    json["scenes"] = json!([{ "nodes": [2] }, { "nodes": [0] }]);
    json["scene"] = json!(1);
    let file = read(&json, &bin).unwrap();
    assert_eq!(file.default_scene, Some(1));
    assert_eq!(file.scenes, [vec![2], vec![0]]);
    assert_eq!(file.nodes[0].children, [1]);
    assert!(matches!(file.nodes[0].local, LocalTransform::Trs { t, .. } if t == [1.0, 2.0, 3.0]));
    assert!(matches!(file.nodes[1].local, LocalTransform::Matrix(m) if m[12] == 4.0));
    assert_eq!(file.nodes[2].local, LocalTransform::Conflict);
    // Without `scene`, the first scene is the default.
    json.as_object_mut().unwrap().remove("scene");
    assert_eq!(read(&json, &bin).unwrap().default_scene, Some(0));
}

#[test]
fn unreferenced_cameras_extras_and_unused_data_are_not_inspected() {
    let (mut json, bin) = base();
    json["cameras"] =
        json!([{ "type": "perspective", "perspective": { "yfov": 1.0, "znear": 0.1 } }]);
    json["nodes"][0]["extras"] = json!({ "anything": [1, 2, 3] });
    json["asset"]["generator"] = json!("some exporter");
    json["scenes"][0]["name"] = json!("Main");
    assert!(read(&json, &bin).is_ok());
}
