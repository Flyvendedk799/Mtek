//! The asset API on files built in memory: the accessors of a `glb_asset`, the host that
//! declares assets, and the packer (`spec/assets.md` sections 2.1 and 4, decision 0058). The
//! generated projects of `tests/assets` cover the same ground through the whole compiler.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mtek_compiler::assets::access::{Accessed, evaluate, evaluate_checked};
use mtek_compiler::assets::pack::{ImageRef, ImageSource, MeshRef, pack};
use mtek_compiler::assets::{
    AssetHandle, AssetHost, AssetKind, AssetLimits, AssetLoader, AssetStore, ImageSpace, read_glb,
};
use mtek_compiler::diagnostics::{Code, Diagnostics};
use mtek_compiler::source::{FileId, MemFs, ProjectPath, Span};
use serde_json::{Value, json};

const GLB_MAGIC: u32 = 0x4654_6C67;

fn container(json: &Value, bin: &[u8]) -> Vec<u8> {
    let mut text = serde_json::to_vec(json).unwrap();
    while text.len() % 4 != 0 {
        text.push(b' ');
    }
    let mut padded = bin.to_vec();
    while padded.len() % 4 != 0 {
        padded.push(0);
    }
    let total = 12 + 8 + text.len() + 8 + padded.len();
    let mut out = Vec::new();
    out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
    out.extend_from_slice(&2_u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&(text.len() as u32).to_le_bytes());
    out.extend_from_slice(&0x4E4F_534A_u32.to_le_bytes());
    out.extend_from_slice(&text);
    out.extend_from_slice(&(padded.len() as u32).to_le_bytes());
    out.extend_from_slice(&0x004E_4942_u32.to_le_bytes());
    out.extend_from_slice(&padded);
    out
}

fn floats(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// A model with named meshes, materials and nodes. The positions of every mesh are the same
/// triangle; `Twin` has two primitives.
fn model() -> Vec<u8> {
    let mut bin = floats(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
    for index in [0_u16, 1, 2, 0] {
        bin.extend_from_slice(&index.to_le_bytes());
    }
    let primitive = |material: usize| {
        json!({ "attributes": { "POSITION": 0 }, "indices": 1, "material": material })
    };
    let json = json!({
        "asset": { "version": "2.0" },
        "scene": 0,
        "scenes": [{ "nodes": [0, 4] }],
        "nodes": [
            { "name": "Root", "translation": [1, 2, 3], "scale": [2, 2, 2], "children": [1, 2] },
            { "name": "Seat", "translation": [0, 1, 0], "mesh": 0 },
            { "name": "Squashed", "scale": [1, 2, 1], "children": [3] },
            { "name": "Skewed", "rotation": [0, 0, 0.3826834, 0.9238795] },
            { "name": "Twin" },
            { "name": "Orphan" }
        ],
        "meshes": [
            { "name": "Seat", "primitives": [primitive(0)] },
            { "name": "Twin", "primitives": [primitive(0), primitive(1)] },
            { "name": "Twin", "primitives": [primitive(0)] },
            { "name": "Empty", "primitives": [primitive(0)] },
            { "primitives": [primitive(0)] }
        ],
        "materials": [
            { "name": "Fabric", "pbrMetallicRoughness":
                { "baseColorFactor": [0.5, 0.25, 0.125, 1], "metallicFactor": 0.25, "roughnessFactor": 0.75 } },
            { "name": "Oak" }
        ],
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
    container(&json, &bin)
}

fn file() -> mtek_compiler::assets::GlbFile {
    read_glb("models/m.glb", &model(), &AssetLimits::default()).unwrap()
}

#[test]
fn a_named_mesh_with_one_primitive_is_a_mesh() {
    assert_eq!(
        evaluate(&file(), "mesh", "Seat", None),
        Ok(Accessed::Mesh {
            mesh: "Seat".into(),
            primitive: 0
        })
    );
    assert_eq!(
        evaluate(&file(), "primitive", "Seat", Some(0)),
        Ok(Accessed::Mesh {
            mesh: "Seat".into(),
            primitive: 0
        })
    );
}

#[test]
fn a_name_used_twice_is_ambiguous() {
    let failure = evaluate(&file(), "mesh", "Twin", None).unwrap_err();
    assert_eq!(failure.code, Code::E7024);
    assert!(failure.message.contains("has 2 meshes named 'Twin'"), "{}", failure.message);
    assert!(!failure.unknown_name);
}

#[test]
fn a_primitive_index_out_of_range_is_e7024_and_has_no_rename() {
    let failure = evaluate_checked(&file(), "primitive", "Seat", Some(1)).unwrap_err();
    assert_eq!(failure.code, Code::E7024);
    assert!(failure.rename.is_none() && failure.help.is_none());
    assert!(failure.message.contains("primitive 1 was requested"));
}

#[test]
fn an_unknown_name_lists_the_names_and_offers_a_validated_rename() {
    let failure = evaluate_checked(&file(), "mesh", "Seatt", None).unwrap_err();
    assert_eq!(failure.code, Code::E7024);
    assert_eq!(failure.rename.as_deref(), Some("Seat"));
    assert_eq!(failure.help.as_deref(), Some("did you mean 'Seat'?"));
    assert!(
        failure.notes[0].contains("'Empty', 'Seat', 'Twin'"),
        "{:?}",
        failure.notes
    );
    assert!(failure.notes[1].contains("1 mesh in the file has no name"), "{:?}", failure.notes);
}

#[test]
fn a_rename_that_would_not_work_is_not_offered_as_an_edit() {
    // "Twi" is one edit from "Twin", which is ambiguous: naming it would still fail.
    let failure = evaluate_checked(&file(), "mesh", "Twi", None).unwrap_err();
    assert_eq!(failure.help.as_deref(), Some("did you mean 'Twin'?"));
    assert!(failure.rename.is_none());
}

#[test]
fn no_rename_when_two_names_are_close() {
    // "Seaf" is within 2 of "Seat" only; "Emptx" of "Empty" only; "Es" of nothing close.
    assert!(evaluate_checked(&file(), "mesh", "Es", None).unwrap_err().rename.is_none());
    let materials = evaluate_checked(&file(), "material_roughness", "Oa", None).unwrap_err();
    assert_eq!(materials.rename.as_deref(), Some("Oak"));
}

#[test]
fn at_most_twenty_names_are_listed() {
    let mut bin = floats(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
    bin.extend_from_slice(&[0; 4]);
    let meshes: Vec<Value> = (0..25)
        .map(|i| json!({ "name": format!("m{i:02}"), "primitives": [{ "attributes": { "POSITION": 0 } }] }))
        .collect();
    let json = json!({
        "asset": { "version": "2.0" },
        "meshes": meshes,
        "accessors": [{ "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3",
                        "min": [0, 0, 0], "max": [1, 1, 0] }],
        "bufferViews": [{ "buffer": 0, "byteOffset": 0, "byteLength": 36 }],
        "buffers": [{ "byteLength": 36 }]
    });
    let file = read_glb("m.glb", &container(&json, &bin), &AssetLimits::default()).unwrap();
    let failure = evaluate(&file, "mesh", "nope", None).unwrap_err();
    let note = &failure.notes[0];
    assert!(note.starts_with("available meshes: 'm00', 'm01'"), "{note}");
    assert!(note.contains("'m19'") && !note.contains("'m20'"), "{note}");
    assert!(note.ends_with("(and 5 more)"), "{note}");
}

#[test]
fn materials_give_their_factors() {
    let f = file();
    assert_eq!(
        evaluate(&f, "material_base_color", "Fabric", None),
        Ok(Accessed::Color([0.5, 0.25, 0.125, 1.0]))
    );
    assert_eq!(
        evaluate(&f, "material_metallic", "Fabric", None),
        Ok(Accessed::Scalar(0.25))
    );
    assert_eq!(
        evaluate(&f, "material_roughness", "Fabric", None),
        Ok(Accessed::Scalar(0.75))
    );
    // glTF's defaults for a material that says nothing: white, metallic 1, roughness 1.
    assert_eq!(
        evaluate(&f, "material_base_color", "Oak", None),
        Ok(Accessed::Color([1.0; 4]))
    );
    assert_eq!(evaluate(&f, "material_texture", "Oak", None), Ok(Accessed::Texture(None)));
    let Ok(Accessed::Material { metallic, roughness, texture, .. }) =
        evaluate(&f, "material", "Fabric", None)
    else {
        panic!("not a material");
    };
    assert_eq!((metallic, roughness, texture), (0.25, 0.75, None));
}

#[test]
fn nodes_give_their_world_transform_in_the_default_scene() {
    let f = file();
    assert_eq!(
        evaluate(&f, "node_position", "Seat", None),
        Ok(Accessed::Vec3([1.0, 4.0, 3.0]))
    );
    assert_eq!(evaluate(&f, "node_scale", "Seat", None), Ok(Accessed::Vec3([2.0; 3])));
    assert_eq!(
        evaluate(&f, "node_rotation", "Seat", None),
        Ok(Accessed::Quat([0.0, 0.0, 0.0, 1.0]))
    );
}

#[test]
fn a_node_outside_the_default_scene_is_unknown_with_a_reason() {
    let failure = evaluate(&file(), "node_position", "Orphan", None).unwrap_err();
    assert_eq!(failure.code, Code::E7024);
    assert!(failure.notes.iter().any(|n| n.contains("not part of the default scene")));
    assert!(failure.message.ends_with("in the default scene."));
}

#[test]
fn a_node_that_cannot_be_an_entity_transform_is_e7013() {
    let failure = evaluate(&file(), "node_rotation", "Skewed", None).unwrap_err();
    assert_eq!(failure.code, Code::E7013);
    assert!(failure.message.contains("has shear"), "{}", failure.message);
}

// ---------------------------------------------------------------------------
// The host and the packer
// ---------------------------------------------------------------------------

fn fs_with(files: &[(&str, Vec<u8>)]) -> MemFs {
    let mut fs = MemFs::new();
    for (path, bytes) in files {
        fs.insert(ProjectPath::new(path).unwrap(), bytes.clone());
    }
    fs
}

fn span(start: u32) -> Span {
    Span::new(FileId(0), start, start + 5)
}

fn declare_glb(fs: &MemFs, limits: AssetLimits) -> (AssetStore, Diagnostics) {
    let mut loader = AssetLoader::new(fs, limits);
    let mut sink = Diagnostics::new();
    let from = ProjectPath::new("src/main.mtek").unwrap();
    let handle = loader.declare(&from, AssetKind::Glb, "../models/m.glb", span(10), &mut sink);
    assert_eq!(
        handle,
        Some(AssetHandle::Glb {
            path: "models/m.glb".into()
        })
    );
    (loader.into_store(), sink)
}

#[test]
fn a_file_is_loaded_once_and_a_failure_is_reported_at_every_declaration() {
    let fs = fs_with(&[("models/bad.glb", b"not a glb".to_vec())]);
    let mut loader = AssetLoader::new(&fs, AssetLimits::default());
    let mut sink = Diagnostics::new();
    let from = ProjectPath::new("src/main.mtek").unwrap();
    for start in [10, 40] {
        assert_eq!(
            loader.declare(&from, AssetKind::Glb, "../models/bad.glb", span(start), &mut sink),
            None
        );
    }
    let report = sink.finish();
    let spans: Vec<u32> = report
        .diagnostics
        .iter()
        .filter_map(|d| d.primary.as_ref().map(|l| l.span.start))
        .collect();
    assert_eq!(spans, [10, 40]);
    assert!(report.diagnostics.iter().all(|d| d.code == Code::E7001));
}

fn pack_all(store: &AssetStore, meshes: &[(&str, usize)]) -> mtek_compiler::assets::pack::Packed {
    let refs: Vec<MeshRef> = meshes
        .iter()
        .map(|(mesh, primitive)| MeshRef {
            file: "models/m.glb".into(),
            mesh: (*mesh).into(),
            primitive: *primitive,
        })
        .collect();
    pack(store, &refs, &[], &mut |_| Some(0)).unwrap()
}

#[test]
fn the_same_primitive_asked_for_twice_is_packaged_once_and_order_does_not_matter() {
    let fs = fs_with(&[("models/m.glb", model())]);
    let (store, sink) = declare_glb(&fs, AssetLimits::default());
    assert!(sink.finish().diagnostics.is_empty());
    let a = pack_all(&store, &[("Seat", 0), ("Empty", 0), ("Seat", 0)]);
    let b = pack_all(&store, &[("Empty", 0), ("Seat", 0)]);
    assert_eq!(a.files, b.files);
    assert_eq!(a.assets, b.assets);
    assert_eq!(a.files.len(), 1);
    let (url, bytes) = a.files.iter().next().unwrap();
    // Two primitives, each 36 bytes of positions plus 3 u16 indices padded to 8.
    assert_eq!(bytes.len(), 2 * 44);
    assert!(url.starts_with("assets/") && url.ends_with(".bin"));
    // glTF mesh order: Seat (index 0), then Empty (index 3).
    let seat = a.meshes[&MeshRef {
        file: "models/m.glb".into(),
        mesh: "Seat".into(),
        primitive: 0,
    }]
        .clone();
    assert_eq!((seat.primitive, seat.asset.as_str()), (0, url.as_str()));
}

#[test]
fn indices_are_u32_above_65535_vertices() {
    let count: u32 = 65_536;
    let mut bin = Vec::new();
    for i in 0..count {
        bin.extend_from_slice(&floats(&[i as f32, 0.0, 0.0]));
    }
    let positions = bin.len();
    for i in [0_u32, 65_534, 65_535] {
        bin.extend_from_slice(&i.to_le_bytes());
    }
    let json = json!({
        "asset": { "version": "2.0" },
        "meshes": [{ "name": "Big", "primitives": [{ "attributes": { "POSITION": 0 }, "indices": 1 }] }],
        "accessors": [
            { "bufferView": 0, "componentType": 5126, "count": count, "type": "VEC3",
              "min": [0, 0, 0], "max": [65535, 0, 0] },
            { "bufferView": 1, "componentType": 5125, "count": 3, "type": "SCALAR" }
        ],
        "bufferViews": [
            { "buffer": 0, "byteOffset": 0, "byteLength": positions },
            { "buffer": 0, "byteOffset": positions, "byteLength": 12 }
        ],
        "buffers": [{ "byteLength": bin.len() }]
    });
    let fs = fs_with(&[("models/m.glb", container(&json, &bin))]);
    let (store, _) = declare_glb(&fs, AssetLimits::default());
    let packed = pack_all(&store, &[("Big", 0)]);
    let entry = serde_json::to_value(&packed.assets[0]).unwrap();
    let primitive = &entry["primitives"][0];
    assert_eq!(primitive["indexFormat"], "uint32");
    assert_eq!(primitive["vertexCount"], 65_536);
    assert_eq!(primitive["offsets"]["indices"], 65_536 * 12);
    assert_eq!(entry["preprocessing"], json!([]));
    let bytes = packed.files.values().next().unwrap();
    let at = 65_536 * 12;
    assert_eq!(&bytes[at + 4..at + 8], &65_534_u32.to_le_bytes());
}

#[test]
fn the_total_size_is_checked_before_the_bytes_are_copied() {
    let fs = fs_with(&[("models/m.glb", model())]);
    let limits = AssetLimits {
        max_total_bytes: 87,
        ..AssetLimits::default()
    };
    let (store, _) = declare_glb(&fs, limits);
    let refs = [
        MeshRef {
            file: "models/m.glb".into(),
            mesh: "Seat".into(),
            primitive: 0,
        },
        MeshRef {
            file: "models/m.glb".into(),
            mesh: "Empty".into(),
            primitive: 0,
        },
    ];
    let diagnostics = pack(&store, &refs, &[], &mut |_| Some(0)).unwrap_err();
    assert_eq!(diagnostics[0].code, Code::E7026);
    assert!(diagnostics[0].message.contains("would be 88 bytes"));
    assert_eq!(diagnostics[0].primary.as_ref().unwrap().span.start, 10);
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    bytes.extend_from_slice(&13_u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    bytes
}

#[test]
fn images_are_merged_by_bytes_and_colour_space() {
    let fs = fs_with(&[
        ("a/one.png", png(2, 2)),
        ("a/two.png", png(2, 2)),
        ("a/three.png", png(4, 4)),
    ]);
    let mut loader = AssetLoader::new(&fs, AssetLimits::default());
    let mut sink = Diagnostics::new();
    let from = ProjectPath::new("src/main.mtek").unwrap();
    for (start, path, kind) in [
        (0, "../a/one.png", AssetKind::Texture),
        (10, "../a/two.png", AssetKind::Texture),
        (20, "../a/two.png", AssetKind::LinearTexture),
        (30, "../a/three.png", AssetKind::Texture),
    ] {
        assert!(loader.declare(&from, kind, path, span(start), &mut sink).is_some());
    }
    let store = loader.into_store();
    let image = |path: &str, space| ImageRef {
        source: ImageSource::File(path.into()),
        space,
        mipmapped: false,
    };
    let refs = [
        image("a/one.png", ImageSpace::Srgb),
        image("a/two.png", ImageSpace::Srgb),
        image("a/two.png", ImageSpace::Linear),
        image("a/three.png", ImageSpace::Srgb),
    ];
    let packed = pack(&store, &[], &refs, &mut |_| Some(0)).unwrap();
    // one.png and two.png are the same bytes in the same space: one file. The linear use of the
    // same bytes is another file, because the colour space is part of what the runtime uploads.
    assert_eq!(packed.assets.len(), 3);
    assert_eq!(
        packed.images[&(ImageSource::File("a/one.png".into()), ImageSpace::Srgb)],
        packed.images[&(ImageSource::File("a/two.png".into()), ImageSpace::Srgb)]
    );
    assert_ne!(
        packed.images[&(ImageSource::File("a/two.png".into()), ImageSpace::Srgb)],
        packed.images[&(ImageSource::File("a/two.png".into()), ImageSpace::Linear)]
    );
    // The sha-256 of both 2x2 files is the hash of the bytes, whatever the space.
    use sha2::{Digest, Sha256};
    let small: String = Sha256::digest(png(2, 2))
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let with_small_hash = packed
        .assets
        .iter()
        .filter(|a| serde_json::to_value(a).unwrap()["sha256"] == small.as_str())
        .count();
    assert_eq!(with_small_hash, 2);
}

#[test]
fn a_path_is_resolved_against_the_declaring_module() {
    let fs = fs_with(&[("models/m.glb", model())]);
    let mut loader = AssetLoader::new(&fs, AssetLimits::default());
    let mut sink = Diagnostics::new();
    let nested = ProjectPath::new("src/scenes/main.mtek").unwrap();
    assert!(
        loader
            .declare(&nested, AssetKind::Glb, "../../models/m.glb", span(0), &mut sink)
            .is_some()
    );
    let root = ProjectPath::new("main.mtek").unwrap();
    assert!(
        loader
            .declare(&root, AssetKind::Glb, "models/m.glb", span(0), &mut sink)
            .is_some()
    );
    assert!(sink.finish().diagnostics.is_empty());
}
