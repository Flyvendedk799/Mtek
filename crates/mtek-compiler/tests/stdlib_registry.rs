//! The standard library registry against `spec/stdlib.md`: every row of the specification's
//! tables must be present with the specified type, default, flags and range, and the
//! registry must be internally consistent. The expectation tables below are transcribed from
//! the specification, independently of the registry code.

// Test-only code: helper functions outside `#[test]` functions may panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mtek_compiler::diagnostics::Code;
use mtek_compiler::stdlib::{
    BuiltinSampler, BuiltinTexture, ColorValue, ConstValue, Domain, EventForm, FieldDef, FieldRule,
    Milestone, NamespaceMember, Registry, SchemaCategory, SigType, TypeKind, TypeRef, format_f32,
    registry,
};

fn flags(field: &FieldDef) -> String {
    let mut out = String::new();
    if field.flags.is_required() {
        out.push('R');
    }
    if field.flags.is_writable() {
        out.push('W');
    }
    if field.flags.is_bindable() {
        out.push('B');
    }
    if field.flags.is_construction_only() {
        out.push('C');
    }
    out
}

/// `(schema, field, type, default text, flags, range text)`.
type Row = (
    &'static str,
    &'static str,
    &'static str,
    Option<&'static str>,
    &'static str,
    Option<&'static str>,
);

const WHITE: &str = "#ffffff";
const V3_ONE: &str = "vec3(1.0, 1.0, 1.0)";
const V3_ZERO: &str = "vec3(0.0, 0.0, 0.0)";

/// Spec section 3: every field of every schema.
fn schema_rows() -> Vec<Row> {
    vec![
        // 3.1 Scene
        ("Scene", "clear_color", "color", Some("#000000"), "C", None),
        ("Scene", "ambient_color", "color", Some(WHITE), "C", None),
        (
            "Scene",
            "ambient_intensity",
            "f32",
            Some("0.0"),
            "C",
            Some("\u{2265} 0"),
        ),
        (
            "Scene",
            "gravity",
            "vec3",
            Some("vec3(0.0, -9.81, 0.0)"),
            "C",
            None,
        ),
        // 3.2 Entity
        ("Entity", "position", "vec3", Some(V3_ZERO), "WB", None),
        (
            "Entity",
            "rotation",
            "quat",
            Some("quat.identity()"),
            "WB",
            None,
        ),
        (
            "Entity",
            "scale",
            "vec3",
            Some(V3_ONE),
            "WB",
            Some("every component > 0, finite"),
        ),
        ("Entity", "visible", "bool", Some("true"), "WB", None),
        ("Entity", "mesh", "mesh", None, "C", None),
        (
            "Entity",
            "material",
            "material",
            Some("Unlit {}"),
            "C",
            None,
        ),
        ("Entity", "light", "light", None, "C", None),
        ("Entity", "body", "body", None, "C", None),
        ("Entity", "collider", "collider", None, "C", None),
        // 3.3 Camera (spec/scenes.md section 3)
        (
            "Camera",
            "position",
            "vec3",
            Some("vec3(0.0, 0.0, 5.0)"),
            "WB",
            None,
        ),
        ("Camera", "target", "vec3", None, "WB", None),
        (
            "Camera",
            "rotation",
            "quat",
            Some("quat.identity()"),
            "WB",
            None,
        ),
        (
            "Camera",
            "projection",
            "projection",
            Some("Perspective {}"),
            "C",
            None,
        ),
        ("Camera", "active", "bool", None, "C", None),
        (
            "Perspective",
            "fov_y",
            "f32",
            Some("0.9"),
            "WB",
            Some("(0, \u{3c0})"),
        ),
        ("Perspective", "near", "f32", Some("0.1"), "WB", Some("> 0")),
        (
            "Perspective",
            "far",
            "f32",
            Some("1000.0"),
            "WB",
            Some("> near"),
        ),
        (
            "Orthographic",
            "height",
            "f32",
            Some("10.0"),
            "WB",
            Some("> 0"),
        ),
        (
            "Orthographic",
            "near",
            "f32",
            Some("0.1"),
            "WB",
            Some("> 0"),
        ),
        (
            "Orthographic",
            "far",
            "f32",
            Some("1000.0"),
            "WB",
            Some("> near"),
        ),
        // 3.4 Meshes
        (
            "Box",
            "size",
            "vec3",
            Some(V3_ONE),
            "C",
            Some("every component > 0"),
        ),
        ("Sphere", "radius", "f32", Some("0.5"), "C", Some("> 0")),
        (
            "Sphere",
            "segments",
            "u32",
            Some("32"),
            "C",
            Some("3\u{2026}256"),
        ),
        (
            "Sphere",
            "rings",
            "u32",
            Some("16"),
            "C",
            Some("2\u{2026}256"),
        ),
        (
            "Plane",
            "size",
            "vec2",
            Some("vec2(1.0, 1.0)"),
            "C",
            Some("every component > 0"),
        ),
        // 3.5 Materials (spec/materials.md section 9)
        ("Unlit", "color", "color", Some(WHITE), "WB", None),
        ("Pbr", "base_color", "color", Some(WHITE), "WB", None),
        ("Pbr", "metallic", "f32", Some("0.0"), "WB", None),
        ("Pbr", "roughness", "f32", Some("0.5"), "WB", None),
        (
            "Pbr",
            "base_color_texture",
            "texture",
            Some("texture.white()"),
            "C",
            None,
        ),
        (
            "Pbr",
            "base_color_sampler",
            "sampler",
            Some("sampler.linear_repeat()"),
            "C",
            None,
        ),
        // 3.6 Lights
        (
            "DirectionalLight",
            "color",
            "color",
            Some(WHITE),
            "WB",
            None,
        ),
        (
            "DirectionalLight",
            "intensity",
            "f32",
            Some("1.0"),
            "WB",
            None,
        ),
        ("PointLight", "color", "color", Some(WHITE), "WB", None),
        ("PointLight", "intensity", "f32", Some("1.0"), "WB", None),
        (
            "PointLight",
            "range",
            "f32",
            Some("0.0"),
            "C",
            Some("\u{2265} 0"),
        ),
        // 3.7 Bodies and colliders
        (
            "Dynamic",
            "mass",
            "f32",
            Some("1.0"),
            "C",
            Some("> 0, finite"),
        ),
        (
            "Dynamic",
            "linear_damping",
            "f32",
            Some("0.0"),
            "C",
            Some("\u{2265} 0"),
        ),
        (
            "Dynamic",
            "angular_damping",
            "f32",
            Some("0.05"),
            "C",
            Some("\u{2265} 0"),
        ),
        (
            "BoxCollider",
            "size",
            "vec3",
            None,
            "RC",
            Some("every component > 0"),
        ),
        ("BoxCollider", "sensor", "bool", Some("false"), "C", None),
        (
            "BoxCollider",
            "friction",
            "f32",
            Some("0.5"),
            "C",
            Some("\u{2265} 0"),
        ),
        (
            "BoxCollider",
            "restitution",
            "f32",
            Some("0.0"),
            "C",
            Some("0\u{2026}1"),
        ),
        ("SphereCollider", "radius", "f32", None, "RC", Some("> 0")),
        ("SphereCollider", "sensor", "bool", Some("false"), "C", None),
        (
            "SphereCollider",
            "friction",
            "f32",
            Some("0.5"),
            "C",
            Some("\u{2265} 0"),
        ),
        (
            "SphereCollider",
            "restitution",
            "f32",
            Some("0.0"),
            "C",
            Some("0\u{2026}1"),
        ),
    ]
}

#[test]
fn every_schema_field_row_is_present_with_type_default_flags_and_range() {
    let registry = registry();
    for (schema, field, ty, default, expected_flags, range) in schema_rows() {
        let found = registry
            .schema_field(schema, field)
            .unwrap_or_else(|| panic!("missing field {schema}.{field}"));
        assert_eq!(found.ty.spelling(), ty, "{schema}.{field} type");
        assert_eq!(
            found.default_text().as_deref(),
            default,
            "{schema}.{field} default"
        );
        assert_eq!(flags(found), expected_flags, "{schema}.{field} flags");
        assert_eq!(
            found.range_text().as_deref(),
            range,
            "{schema}.{field} range"
        );
    }
}

#[test]
fn schemas_have_exactly_the_specified_fields() {
    let registry = registry();
    let rows = schema_rows();
    // Every schema of section 3, including the field-less bodies.
    let expected_schemas = [
        "Scene",
        "Entity",
        "Camera",
        "Perspective",
        "Orthographic",
        "Box",
        "Sphere",
        "Plane",
        "Unlit",
        "Pbr",
        "DirectionalLight",
        "PointLight",
        "Static",
        "Dynamic",
        "Kinematic",
        "BoxCollider",
        "SphereCollider",
    ];
    let mut registered: Vec<&str> = registry.schemas.iter().map(|s| s.name).collect();
    registered.sort_unstable();
    let mut expected: Vec<&str> = expected_schemas.to_vec();
    expected.sort_unstable();
    assert_eq!(registered, expected);
    for schema in &registry.schemas {
        let mut have: Vec<&str> = schema.fields.iter().map(|f| f.name).collect();
        have.sort_unstable();
        let mut want: Vec<&str> = rows
            .iter()
            .filter(|row| row.0 == schema.name)
            .map(|row| row.1)
            .collect();
        want.sort_unstable();
        assert_eq!(have, want, "fields of {}", schema.name);
    }
    for name in ["Static", "Kinematic"] {
        assert!(registry.schema(name).is_some_and(|s| s.fields.is_empty()));
    }
}

#[test]
fn schema_categories_match_the_specification() {
    let registry = registry();
    let expected = [
        ("Scene", SchemaCategory::Object),
        ("Entity", SchemaCategory::Object),
        ("Camera", SchemaCategory::Object),
        ("Perspective", SchemaCategory::Projection),
        ("Orthographic", SchemaCategory::Projection),
        ("Box", SchemaCategory::Mesh),
        ("Sphere", SchemaCategory::Mesh),
        ("Plane", SchemaCategory::Mesh),
        ("Unlit", SchemaCategory::Material),
        ("Pbr", SchemaCategory::Material),
        ("DirectionalLight", SchemaCategory::Light),
        ("PointLight", SchemaCategory::Light),
        ("Static", SchemaCategory::Body),
        ("Dynamic", SchemaCategory::Body),
        ("Kinematic", SchemaCategory::Body),
        ("BoxCollider", SchemaCategory::Collider),
        ("SphereCollider", SchemaCategory::Collider),
    ];
    for (name, category) in expected {
        assert_eq!(
            registry.schema(name).map(|s| s.category),
            Some(category),
            "{name}"
        );
    }
}

#[test]
fn entity_material_defaults_only_when_a_mesh_is_set() {
    let material = registry().schema_field("Entity", "material").unwrap();
    assert_eq!(material.default_when_set, Some("mesh"));
    for (schema, field) in [("Entity", "position"), ("Camera", "projection")] {
        let found = registry().schema_field(schema, field).unwrap();
        assert_eq!(found.default_when_set, None);
    }
}

#[test]
fn the_camera_is_the_one_scene_object_kind() {
    let registry = registry();
    assert_eq!(registry.scene_objects.len(), 1);
    let camera = registry.scene_object("camera").unwrap();
    assert_eq!(camera.schema, "Camera");
    assert_eq!(camera.since, Milestone::M1);
    // `spec/scenes.md` section 3: exactly one active camera (`E5012`, `E5013`).
    let active = camera.active.unwrap();
    assert_eq!(
        (active.field, active.missing, active.ambiguous),
        ("active", Code::E5012, Code::E5013)
    );
}

#[test]
fn scene_and_entity_bodies_have_their_schemas() {
    let registry = registry();
    assert_eq!(registry.scene_schema().map(|s| s.name), Some("Scene"));
    assert_eq!(registry.entity_schema().map(|s| s.name), Some("Entity"));
}

#[test]
fn field_rules_and_range_codes_follow_the_scene_specification() {
    // Decision 0027: the rules of `spec/scenes.md` sections 3, 4.1 and 12 are registry
    // data, so the checker names no schema or field.
    let registry = registry();
    assert_eq!(
        registry.schema("Entity").unwrap().rules,
        vec![FieldRule::Requires {
            field: "material",
            requires: "mesh",
            code: Code::E5020,
        }]
    );
    assert_eq!(
        registry.schema("Camera").unwrap().rules,
        vec![FieldRule::ExcludedBy {
            field: "rotation",
            excluded_by: "target",
            code: Code::E5010,
        }]
    );
    let mut dedicated = Vec::new();
    for schema in &registry.schemas {
        if schema.name != "Entity" && schema.name != "Camera" {
            assert!(schema.rules.is_empty(), "{}", schema.name);
        }
        for field in &schema.fields {
            if field.range_code != Code::E5006 {
                dedicated.push((schema.name, field.name, field.range_code.short()));
            }
        }
    }
    assert_eq!(
        dedicated,
        [
            ("Entity", "scale", "E5090"),
            ("Perspective", "fov_y", "E5011"),
            ("Perspective", "near", "E5011"),
            ("Perspective", "far", "E5011"),
            ("Orthographic", "height", "E5011"),
            ("Orthographic", "near", "E5011"),
            ("Orthographic", "far", "E5011"),
        ]
    );
}

#[test]
fn types_cover_section_2() {
    let registry = registry();
    for name in [
        "bool",
        "i32",
        "u32",
        "f32",
        "string",
        "vec2",
        "vec3",
        "vec4",
        "mat4",
        "quat",
        "color",
        "mesh",
        "material",
        "texture",
        "sampler",
        "entity_ref",
        "array",
        "SurfaceInput",
        "PointerEvent",
    ] {
        assert!(registry.type_def(name).is_some(), "missing type {name}");
    }
    let surface = registry.type_def("SurfaceInput").unwrap();
    let fields: Vec<(&str, &str)> = surface
        .fields
        .iter()
        .map(|f| (f.name, f.ty.spelling()))
        .collect();
    assert_eq!(
        fields,
        [
            ("local_position", "vec3"),
            ("world_position", "vec3"),
            ("world_normal", "vec3"),
            ("uv", "vec2")
        ]
    );
    let pointer = registry.type_def("PointerEvent").unwrap();
    let fields: Vec<(&str, &str)> = pointer
        .fields
        .iter()
        .map(|f| (f.name, f.ty.spelling()))
        .collect();
    assert_eq!(fields, [("position", "vec2"), ("button", "i32")]);
    assert_eq!(pointer.kind, TypeKind::Record);
    // CPU-only types have no GPU representation; `string` and handles never reach the GPU.
    assert!(!registry.type_def("string").unwrap().gpu);
    assert!(registry.type_def("vec3").unwrap().gpu);
}

/// `(namespace, member, signature shape or value type)`.
const NAMESPACE_ROWS: [(&str, &str, &str); 23] = [
    ("quat", "identity", "() -> quat"),
    ("quat", "axis_angle", "(vec3, f32) -> quat"),
    ("quat", "euler", "(f32, f32, f32) -> quat"),
    ("mat4", "identity", "() -> mat4"),
    ("mat4", "translation", "(vec3) -> mat4"),
    ("mat4", "rotation", "(quat) -> mat4"),
    ("mat4", "scale", "(vec3) -> mat4"),
    ("mat4", "columns", "(vec4, vec4, vec4, vec4) -> mat4"),
    ("color", "linear", "(vec3, f32) -> color"),
    ("color", "srgb", "(vec3, f32) -> color"),
    ("texture", "white", "() -> texture"),
    ("texture", "black", "() -> texture"),
    ("sampler", "linear_repeat", "() -> sampler"),
    ("sampler", "linear_clamp", "() -> sampler"),
    ("sampler", "nearest_repeat", "() -> sampler"),
    ("sampler", "nearest_clamp", "() -> sampler"),
    ("frame", "time", "f32"),
    ("frame", "delta", "f32"),
    ("frame", "index", "u32"),
    ("asset", "glb", "(string) -> glb_asset"),
    ("asset", "texture", "(string) -> texture"),
    ("asset", "linear_texture", "(string) -> texture"),
    (
        "lighting",
        "pbr",
        "(SurfaceInput, color, f32, f32) -> color",
    ),
    // `Key` members are enum constants; checked in `the_key_enum_maps_to_dom_codes`.
];

/// A signature without parameter names: `(T, T) -> T`.
fn shape(signature: &mtek_compiler::stdlib::Signature) -> String {
    let params: Vec<&str> = signature.params.iter().map(|p| p.ty.spelling()).collect();
    format!("({}) -> {}", params.join(", "), signature.ret.spelling())
}

#[test]
fn every_namespace_member_of_section_2_is_present() {
    let registry = registry();
    for (namespace, member, expected) in NAMESPACE_ROWS {
        let found = registry
            .namespace_member(namespace, member)
            .unwrap_or_else(|| panic!("missing {namespace}.{member}"));
        match found {
            NamespaceMember::Function(function) => {
                assert_eq!(function.signatures.len(), 1, "{namespace}.{member}");
                assert_eq!(
                    shape(&function.signatures[0]),
                    expected,
                    "{namespace}.{member}"
                );
            }
            NamespaceMember::Value(value) => {
                assert_eq!(value.ty.spelling(), expected, "{namespace}.{member}");
            }
        }
    }
    let namespaces: Vec<&str> = registry.namespaces.iter().map(|n| n.name).collect();
    for name in [
        "quat", "mat4", "color", "texture", "sampler", "frame", "asset", "lighting",
    ] {
        assert!(namespaces.contains(&name), "missing namespace {name}");
    }
    assert_eq!(namespaces.len(), 8);
    // Member counts: nothing beyond the specification.
    let count = |name: &str| registry.namespace(name).map_or(0, |n| n.members.len());
    assert_eq!(
        [
            count("quat"),
            count("mat4"),
            count("color"),
            count("texture"),
            count("sampler"),
            count("frame"),
            count("asset"),
            count("lighting")
        ],
        [3, 5, 2, 2, 4, 3, 3, 1]
    );
}

#[test]
fn namespace_function_domains_and_constness() {
    let registry = registry();
    let function = |ns: &str, name: &str| match registry.namespace_member(ns, name) {
        Some(NamespaceMember::Function(f)) => f.clone(),
        _ => panic!("{ns}.{name} is not a function"),
    };
    assert_eq!(function("lighting", "pbr").domain, Domain::Gpu);
    assert!(!function("lighting", "pbr").const_eligible);
    for name in ["glb", "texture", "linear_texture"] {
        let f = function("asset", name);
        assert!(
            f.const_eligible,
            "asset.{name} is const-eligible (spec/assets.md section 2)"
        );
        assert_eq!(f.since, Milestone::M4);
    }
    // `color.srgb` is folded in binary32 (decision 0024 item 6); only GPU-only functions are
    // excluded.
    assert!(function("color", "srgb").const_eligible);
    assert_eq!(function("color", "srgb").domain, Domain::Both);
    assert!(function("color", "linear").const_eligible);
    assert!(function("quat", "euler").const_eligible);
}

#[test]
fn glb_asset_accessors_follow_the_assets_specification() {
    let registry = registry();
    let expected = [
        ("mesh", "(string) -> mesh"),
        ("primitive", "(string, u32) -> mesh"),
        ("material", "(string) -> material"),
        ("material_base_color", "(string) -> color"),
        ("material_metallic", "(string) -> f32"),
        ("material_roughness", "(string) -> f32"),
        ("material_texture", "(string) -> texture"),
        ("node_position", "(string) -> vec3"),
        ("node_rotation", "(string) -> quat"),
        ("node_scale", "(string) -> vec3"),
    ];
    let glb = registry.type_def("glb_asset").unwrap();
    assert_eq!(glb.methods.len(), expected.len());
    for (name, signature) in expected {
        let method = registry.type_method("glb_asset", name).unwrap();
        assert_eq!(shape(&method.signatures[0]), signature, "{name}");
        assert!(method.const_eligible, "{name} is const-eligible");
    }
}

#[test]
fn events_follow_section_5_1() {
    let registry = registry();
    assert_eq!(registry.events.len(), 7);
    for name in ["key_down", "key_up"] {
        let event = registry.event(name).unwrap();
        assert_eq!(event.form, EventForm::Filter(TypeRef::Enum("Key")));
        assert_eq!(event.since, Milestone::M1);
        assert!(!event.requires_collider);
        assert_eq!(event.hosts.len(), 3);
    }
    for name in ["pointer_down", "pointer_up", "pointer_move"] {
        let event = registry.event(name).unwrap();
        assert_eq!(
            event.form,
            EventForm::Parameter(TypeRef::Record("PointerEvent"))
        );
        assert_eq!(event.since, Milestone::M1);
        assert_eq!(event.hosts.len(), 3);
    }
    for name in ["collision_enter", "collision_exit"] {
        let event = registry.event(name).unwrap();
        assert_eq!(event.form, EventForm::Parameter(TypeRef::EntityRef));
        assert_eq!(event.since, Milestone::M5);
        assert!(event.requires_collider);
        let hosts: Vec<&str> = event.hosts.iter().map(|h| h.as_str()).collect();
        assert_eq!(hosts, ["entity", "prefab"]);
    }
}

#[test]
fn the_key_enum_maps_to_dom_codes() {
    let registry = registry();
    let key = registry.enum_def("Key").unwrap();
    let mut expected: Vec<(String, String)> = Vec::new();
    for letter in 'A'..='Z' {
        expected.push((letter.to_string(), format!("Key{letter}")));
    }
    for digit in 0..=9 {
        expected.push((format!("Digit{digit}"), format!("Digit{digit}")));
    }
    for name in [
        "Space",
        "Enter",
        "Escape",
        "Tab",
        "Backspace",
        "ShiftLeft",
        "ShiftRight",
        "ControlLeft",
        "ControlRight",
        "AltLeft",
        "AltRight",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
    ] {
        expected.push((name.to_owned(), name.to_owned()));
    }
    assert_eq!(key.members.len(), expected.len());
    for (name, code) in &expected {
        let member = registry
            .enum_member("Key", name)
            .unwrap_or_else(|| panic!("missing Key.{name}"));
        assert_eq!(member.code, code, "Key.{name}");
        assert_eq!(
            registry.enum_member_by_code("Key", code).map(|m| m.name),
            Some(name.as_str())
        );
    }
    assert_eq!(
        registry.enum_member("Key", "Space").map(|m| m.code),
        Some("Space")
    );
}

/// `(function, signature shapes, domain, const-eligible)` from section 6.
type IntrinsicRow = (&'static str, &'static [&'static str], Domain, bool);

fn intrinsic_rows() -> Vec<IntrinsicRow> {
    const T1: &[&str] = &["(T) -> T"];
    const T2: &[&str] = &["(T, T) -> T"];
    const T3: &[&str] = &["(T, T, T) -> T"];
    const TI1: &[&str] = &["(T) -> T", "(I) -> I"];
    const TI2: &[&str] = &["(T, T) -> T", "(I, I) -> I"];
    const TI3: &[&str] = &["(T, T, T) -> T", "(I, I, I) -> I"];
    let math = |name, shapes| (name, shapes, Domain::Both, true);
    let mut rows = vec![
        math("abs", TI1),
        math("min", TI2),
        math("max", TI2),
        math("clamp", TI3),
        math("saturate", T1),
        math("mix", &["(T, T, f32) -> T", "(T, T, T) -> T"]),
        math("step", T2),
        math("smoothstep", T3),
        math("sqrt", T1),
        math("inverse_sqrt", T1),
        math("pow", T2),
        math("exp", T1),
        math("exp2", T1),
        math("log", T1),
        math("log2", T1),
        math("sin", T1),
        math("cos", T1),
        math("tan", T1),
        math("asin", T1),
        math("acos", T1),
        math("atan", T1),
        math("atan2", T2),
        math("floor", T1),
        math("ceil", T1),
        math("trunc", T1),
        math("fract", T1),
        math("sign", T1),
        math("round", T1),
        math("radians", T1),
        math("degrees", T1),
        math("length", &["(T) -> f32"]),
        math("distance", &["(T, T) -> f32"]),
        math("dot", &["(V, V) -> f32"]),
        math("cross", &["(vec3, vec3) -> vec3"]),
        math("normalize", &["(V) -> V"]),
        math("reflect", &["(V, V) -> V"]),
        math("transpose", &["(mat4) -> mat4"]),
    ];
    rows.push((
        "sample",
        &["(texture, sampler, vec2) -> vec4"],
        Domain::Gpu,
        false,
    ));
    rows.push(("random", &["() -> f32"], Domain::Cpu, false));
    rows.push(("print", &["(string) -> ()"], Domain::Cpu, false));
    rows.push(("is_key_down", &["(Key) -> bool"], Domain::Cpu, false));
    rows.push((
        "spawn",
        &["(prefab descriptor) -> entity_ref"],
        Domain::Cpu,
        false,
    ));
    rows.push(("destroy", &["(entity_ref) -> ()"], Domain::Cpu, false));
    rows.push(("alive", &["(entity_ref) -> bool"], Domain::Cpu, false));
    rows
}

#[test]
fn every_intrinsic_row_of_section_6_is_present() {
    let registry = registry();
    let rows = intrinsic_rows();
    assert_eq!(
        rows.len(),
        registry.intrinsics.len(),
        "no intrinsic beyond the table"
    );
    for (name, shapes, domain, const_eligible) in rows {
        let intrinsic = registry
            .intrinsic(name)
            .unwrap_or_else(|| panic!("missing intrinsic {name}"));
        let found: Vec<String> = intrinsic.signatures.iter().map(shape).collect();
        assert_eq!(found, shapes, "{name} signatures");
        assert_eq!(intrinsic.domain, domain, "{name} domain");
        assert_eq!(
            intrinsic.const_eligible, const_eligible,
            "{name} const-eligibility"
        );
    }
    // The CPU semantics notes of the table.
    let note = |name: &str| registry.intrinsic(name).unwrap().cpu_semantics;
    assert!(note("round").contains("Ties to even"));
    assert!(note("abs").contains("MIN"));
    assert!(note("random").contains("xoshiro128**"));
    assert!(note("normalize").contains("zero vector"));
    // spawn and destroy are for handlers only.
    for name in ["spawn", "destroy"] {
        assert!(registry.intrinsic(name).unwrap().handlers_only, "{name}");
    }
    assert!(!registry.intrinsic("alive").unwrap().handlers_only);
}

#[test]
fn language_summary_lists_the_same_math_intrinsics() {
    // spec/language.md section 10 enumerates the v0.1 math intrinsics.
    let summary = "abs min max clamp mix step smoothstep sqrt inverse_sqrt pow exp exp2 log log2 \
                   sin cos tan asin acos atan atan2 floor ceil round trunc fract sign length \
                   distance dot cross normalize reflect saturate radians degrees transpose";
    for name in summary.split_whitespace() {
        assert!(registry().intrinsic(name).is_some(), "missing {name}");
    }
    let math_count = registry()
        .intrinsics
        .iter()
        .filter(|i| i.domain == Domain::Both)
        .count();
    assert_eq!(math_count, summary.split_whitespace().count());
}

#[test]
fn body_commands_follow_the_physics_specification() {
    let registry = registry();
    let expected: [(&str, &str, &[&str]); 5] = [
        ("apply_impulse", "(vec3)", &["Dynamic"]),
        ("apply_force", "(vec3)", &["Dynamic"]),
        ("set_kinematic_target", "(vec3, quat)", &["Kinematic"]),
        ("teleport", "(vec3, quat, bool)", &["Dynamic", "Kinematic"]),
        ("set_linear_velocity", "(vec3)", &["Dynamic"]),
    ];
    assert_eq!(registry.body_commands.len(), expected.len());
    for (name, params, bodies) in expected {
        let command = registry
            .body_command(name)
            .unwrap_or_else(|| panic!("missing body command {name}"));
        let spelled: Vec<&str> = command.params.iter().map(|p| p.ty.spelling()).collect();
        assert_eq!(format!("({})", spelled.join(", ")), params, "{name}");
        let applies: Vec<&str> = command.applies_to.iter().map(|b| b.as_str()).collect();
        assert_eq!(applies, bodies, "{name}");
        assert_eq!(command.since, Milestone::M5);
        assert!(
            command
                .params
                .iter()
                .all(|p| matches!(p.ty, SigType::Exact(_)))
        );
    }
    for name in ["linear_velocity", "angular_velocity"] {
        let property = registry.body_property(name).unwrap();
        assert_eq!(property.ty, TypeRef::Vec3);
        assert_eq!(property.applies_to.len(), 2);
    }
    assert_eq!(registry.body_properties.len(), 2);
    assert_eq!(
        registry.body_command("teleport").unwrap().params[2].name,
        "keep_velocity"
    );
}

#[test]
fn since_milestones_follow_the_work_plan() {
    let registry = registry();
    let since = |schema: &str, field: &str| registry.schema_field(schema, field).unwrap().since;
    // M1: scene/camera/entity transform fields, meshes, Unlit.
    for (schema, field) in [
        ("Scene", "clear_color"),
        ("Entity", "position"),
        ("Entity", "rotation"),
        ("Entity", "scale"),
        ("Entity", "mesh"),
        ("Entity", "material"),
        ("Camera", "position"),
        ("Camera", "projection"),
        ("Perspective", "fov_y"),
        ("Box", "size"),
        ("Sphere", "radius"),
        ("Plane", "size"),
        ("Unlit", "color"),
    ] {
        assert_eq!(since(schema, field), Milestone::M1, "{schema}.{field}");
    }
    // M4: lights, Pbr, textures, assets.
    assert_eq!(since("Entity", "light"), Milestone::M4);
    assert_eq!(since("Pbr", "roughness"), Milestone::M4);
    assert_eq!(since("DirectionalLight", "intensity"), Milestone::M4);
    // M5: physics.
    assert_eq!(since("Entity", "body"), Milestone::M5);
    assert_eq!(since("Dynamic", "mass"), Milestone::M5);
    assert_eq!(since("BoxCollider", "size"), Milestone::M5);
    let schema_since = |name: &str| registry.schema(name).unwrap().since;
    assert_eq!(schema_since("Unlit"), Milestone::M1);
    assert_eq!(schema_since("Pbr"), Milestone::M4);
    assert_eq!(schema_since("PointLight"), Milestone::M4);
    assert_eq!(schema_since("Static"), Milestone::M5);
    let intrinsic_since = |name: &str| registry.intrinsic(name).unwrap().since;
    // M2: functions and materials. The math intrinsics and `mat4` landed with task M2-01,
    // `SurfaceInput` with M2-04, before the M2 gate; they are marked as implemented by the
    // current build (decisions 0035, 0039).
    assert_eq!(intrinsic_since("smoothstep"), Milestone::M1);
    assert_eq!(registry.namespace("mat4").unwrap().since, Milestone::M1);
    assert_eq!(
        registry.type_def("SurfaceInput").unwrap().since,
        Milestone::M1
    );
    // M3: state, events, frame values, input and diagnostics output landed with tasks M3-01 and
    // M3-02, before the M3 gate; they are marked as implemented by the current build
    // (decision 0049). `bind` is still M3 (a construct row, not a registry item).
    assert_eq!(intrinsic_since("is_key_down"), Milestone::M1);
    assert_eq!(intrinsic_since("random"), Milestone::M1);
    assert_eq!(intrinsic_since("print"), Milestone::M1);
    assert_eq!(registry.namespace("frame").unwrap().since, Milestone::M1);
    assert_eq!(registry.event("key_down").unwrap().since, Milestone::M1);
    assert_eq!(registry.enum_def("Key").unwrap().since, Milestone::M1);
    // M4: textures, samplers, assets, lighting.
    assert_eq!(intrinsic_since("sample"), Milestone::M4);
    for name in ["texture", "sampler", "asset", "lighting"] {
        assert_eq!(
            registry.namespace(name).unwrap().since,
            Milestone::M4,
            "{name}"
        );
    }
    // M5: spawn, destroy, alive, collision events.
    for name in ["spawn", "destroy", "alive"] {
        assert_eq!(intrinsic_since(name), Milestone::M5, "{name}");
    }
    assert_eq!(
        registry.event("collision_enter").unwrap().since,
        Milestone::M5
    );
}

#[test]
fn the_registry_is_internally_consistent() {
    let problems = registry().validate();
    assert!(
        problems.is_empty(),
        "registry problems:\n{}",
        problems.join("\n")
    );
}

#[test]
fn validation_reports_broken_tables() {
    let mut broken = Registry::v0_1();
    let schema = broken.schemas.iter().position(|s| s.name == "Box").unwrap();
    // A duplicate field, a default of the wrong type and an unknown sibling in a range.
    let duplicate = broken.schemas[schema].fields[0].clone();
    broken.schemas[schema].fields.push(duplicate);
    broken.schemas[schema].fields[0].default = Some(ConstValue::Bool(true));
    let sphere = broken
        .schemas
        .iter()
        .position(|s| s.name == "Sphere")
        .unwrap();
    broken.schemas[sphere].fields[0].default = Some(ConstValue::F32(-1.0));
    broken.events[0].hosts = &[];
    // Rules, range codes and the active-object selection must name real fields and codes
    // of the scene range.
    broken.schemas[sphere].rules.push(FieldRule::Requires {
        field: "radius",
        requires: "colour",
        code: Code::E5020,
    });
    broken.schemas[sphere].fields[1].range_code = Code::E3001;
    broken.schemas[schema].rules.push(FieldRule::ExcludedBy {
        field: "size",
        excluded_by: "size",
        code: Code::E5010,
    });
    if let Some(active) = broken.scene_objects[0].active.as_mut() {
        active.field = "position";
    }
    broken.declaration_schemas.entity = "Box";
    let problems = broken.validate();
    let joined = problems.join("\n");
    assert!(joined.contains("duplicate field of `Box`"), "{joined}");
    assert!(
        joined.contains("Box.size: default does not have the field's type"),
        "{joined}"
    );
    assert!(
        joined.contains("Sphere.radius: default violates the field's range"),
        "{joined}"
    );
    assert!(
        joined.contains("event `key_down`: no allowed hosts"),
        "{joined}"
    );
    for expected in [
        "Sphere: rule on `radius` names unknown field `colour`",
        "Sphere.segments: range code MTEK-E3001 is not a scene error code",
        "Box: rule on `size` relates the field to itself",
        "scene object `camera`: active field `position` is not a bool",
        "entity declarations: schema `Box` is not an object schema",
    ] {
        assert!(joined.contains(expected), "{expected}: {joined}");
    }
}

// ---------------------------------------------------------------------------------------
// Canonical default text re-parses and const-evaluates to the stored ConstValue
// (spec/stdlib.md section 1.2). The parser and evaluator below are independent of the
// registry's text generation.
// ---------------------------------------------------------------------------------------

fn parse_f32(text: &str) -> f32 {
    assert!(
        text.contains('.') && !text.contains('e') && !text.contains('E'),
        "canonical float `{text}` must be positional with a fractional digit"
    );
    let value: f32 = text
        .parse()
        .unwrap_or_else(|_| panic!("`{text}` is not a float"));
    // The text is the shortest decimal that round-trips the binary32 value.
    assert_eq!(format_f32(value), text, "`{text}` is not in canonical form");
    value
}

fn parse_vector(text: &str, name: &str, dimension: usize) -> Vec<f32> {
    let inner = text
        .strip_prefix(name)
        .and_then(|rest| rest.strip_prefix('('))
        .and_then(|rest| rest.strip_suffix(')'))
        .unwrap_or_else(|| panic!("`{text}` is not a `{name}(..)` literal"));
    let components: Vec<f32> = inner.split(", ").map(parse_f32).collect();
    assert_eq!(
        components.len(),
        dimension,
        "`{text}` must spell every component (no splat shorthand)"
    );
    components
}

/// The sRGB literal `#rrggbb[aa]` evaluated exactly as `spec/language.md` section 5.4 says.
fn eval_colour(text: &str) -> ConstValue {
    let digits = text.strip_prefix('#').unwrap();
    assert!(
        digits.len() == 6 || digits.len() == 8,
        "colour literal `{text}` has the wrong length"
    );
    assert_eq!(
        digits,
        digits.to_lowercase(),
        "colour literal `{text}` must be lowercase"
    );
    let channel = |i: usize| u8::from_str_radix(&digits[i..i + 2], 16).unwrap();
    let eotf = |c8: u8| {
        let c = f64::from(c8) / 255.0;
        let linear = if c <= 0.04045 {
            c / 12.92
        } else {
            libm::pow((c + 0.055) / 1.055, 2.4)
        };
        linear as f32
    };
    let alpha = if digits.len() == 8 { channel(6) } else { 255 };
    ConstValue::Color(ColorValue {
        linear: [
            eotf(channel(0)),
            eotf(channel(2)),
            eotf(channel(4)),
            (f64::from(alpha) / 255.0) as f32,
        ],
        literal: [channel(0), channel(2), channel(4), alpha],
    })
}

/// Parses and evaluates canonical default text for a field of type `ty`.
fn eval_canonical(registry: &Registry, ty: TypeRef, text: &str) -> ConstValue {
    match ty {
        TypeRef::Bool => match text {
            "true" => ConstValue::Bool(true),
            "false" => ConstValue::Bool(false),
            other => panic!("`{other}` is not a bool"),
        },
        TypeRef::I32 => ConstValue::I32(text.parse().unwrap()),
        TypeRef::U32 => ConstValue::U32(text.parse().unwrap()),
        TypeRef::F32 => ConstValue::F32(parse_f32(text)),
        TypeRef::Vec2 => {
            let v = parse_vector(text, "vec2", 2);
            ConstValue::Vec2([v[0], v[1]])
        }
        TypeRef::Vec3 => {
            let v = parse_vector(text, "vec3", 3);
            ConstValue::Vec3([v[0], v[1], v[2]])
        }
        TypeRef::Vec4 => {
            let v = parse_vector(text, "vec4", 4);
            ConstValue::Vec4([v[0], v[1], v[2], v[3]])
        }
        TypeRef::Color => eval_colour(text),
        TypeRef::Quat => {
            assert_eq!(text, "quat.identity()");
            ConstValue::QuatIdentity
        }
        TypeRef::Texture => match text {
            "texture.white()" => ConstValue::Texture(BuiltinTexture::White),
            "texture.black()" => ConstValue::Texture(BuiltinTexture::Black),
            other => panic!("`{other}` is not a built-in texture"),
        },
        TypeRef::Sampler => match text {
            "sampler.linear_repeat()" => ConstValue::Sampler(BuiltinSampler::LinearRepeat),
            "sampler.linear_clamp()" => ConstValue::Sampler(BuiltinSampler::LinearClamp),
            "sampler.nearest_repeat()" => ConstValue::Sampler(BuiltinSampler::NearestRepeat),
            "sampler.nearest_clamp()" => ConstValue::Sampler(BuiltinSampler::NearestClamp),
            other => panic!("`{other}` is not a built-in sampler"),
        },
        TypeRef::Mesh | TypeRef::Material | TypeRef::Descriptor(_) => {
            let name = text
                .strip_suffix(" {}")
                .unwrap_or_else(|| panic!("`{text}` is not an empty descriptor"));
            let schema = registry
                .schema(name)
                .unwrap_or_else(|| panic!("descriptor of unknown schema `{name}`"));
            ConstValue::EmptyDescriptor(schema.name)
        }
        other => panic!("no constant of type {other:?}"),
    }
}

#[test]
fn every_default_text_reparses_and_evaluates_to_the_stored_value() {
    let registry = registry();
    let mut checked = 0;
    for schema in &registry.schemas {
        for field in &schema.fields {
            let (Some(value), Some(text)) = (field.default, field.default_text()) else {
                continue;
            };
            let evaluated = eval_canonical(registry, field.ty, &text);
            assert_eq!(
                evaluated, value,
                "{}.{}: `{text}` evaluates to something else than the stored default",
                schema.name, field.name
            );
            checked += 1;
        }
    }
    assert!(checked >= 40, "only {checked} defaults were checked");
}

#[test]
fn float_text_is_shortest_round_trip_for_every_registered_float() {
    for schema in &registry().schemas {
        for field in &schema.fields {
            let components: Vec<f32> = match field.default {
                Some(ConstValue::F32(v)) => vec![v],
                Some(ConstValue::Vec2(v)) => v.to_vec(),
                Some(ConstValue::Vec3(v)) => v.to_vec(),
                Some(ConstValue::Vec4(v)) => v.to_vec(),
                _ => continue,
            };
            let text = field.default_text().unwrap();
            for component in components {
                let printed = format_f32(component);
                assert!(text.contains(&printed), "{text} should contain {printed}");
                assert_eq!(
                    printed.parse::<f32>().unwrap().to_bits(),
                    component.to_bits()
                );
                assert!(printed.contains('.'), "{printed} lacks a fractional digit");
            }
        }
    }
}

// ---------------------------------------------------------------------------------------
// The embedded prelude sources (spec/materials.md section 9)
// ---------------------------------------------------------------------------------------

/// `(material, [(param, type, default text)])` read from the prelude source text.
fn material_params(source: &str, material: &str) -> Vec<(String, String, String)> {
    let header = format!("export material {material} {{");
    let start = source
        .find(&header)
        .unwrap_or_else(|| panic!("material {material} not in the prelude source"));
    let body = &source[start + header.len()..];
    let end = body.find("\n}").unwrap();
    body[..end]
        .lines()
        .filter_map(|line| line.trim().strip_prefix("param "))
        .map(|rest| {
            let rest = rest.trim_end_matches(';');
            let (name, rest) = rest.split_once(": ").unwrap();
            let (ty, default) = rest.split_once(" = ").unwrap();
            (name.to_owned(), ty.to_owned(), default.to_owned())
        })
        .collect()
}

#[test]
fn prelude_material_sources_are_embedded_and_match_the_schemas() {
    let registry = registry();
    let source = registry
        .prelude_source("std/materials.mtek")
        .expect("std/materials.mtek is embedded");
    assert!(source.contains("export material Unlit"));
    assert!(source.contains("export material Pbr"));
    assert!(source.contains("lighting.pbr(surface, albedo, metallic, roughness)"));
    for material in ["Unlit", "Pbr"] {
        let schema = registry.schema(material).unwrap();
        let params = material_params(source, material);
        assert_eq!(params.len(), schema.fields.len(), "{material} params");
        for (name, ty, default) in params {
            let field = schema
                .field(&name)
                .unwrap_or_else(|| panic!("{material}.{name} is not in the schema"));
            assert_eq!(field.ty.spelling(), ty, "{material}.{name} type");
            assert_eq!(
                field.default_text().as_deref(),
                Some(default.as_str()),
                "{material}.{name}"
            );
        }
    }
}

#[test]
fn registries_built_twice_are_identical() {
    assert_eq!(Registry::v0_1(), Registry::v0_1());
    assert_eq!(&Registry::v0_1(), registry());
}
