//! Unit tests of the shader lowering.

use super::*;
use crate::diagnostics::Code;
use crate::emit_wgsl::{emit_shader, print_module, validate_wgsl};
use crate::ir::lower_to_ir;
use crate::lowering::shader_ir::ExprKind;
use crate::project::ProjectRoot;
use crate::source::{MemFs, ProjectPath, SourceMap};

/// The typed IR and sources of a project made of `files` (`src/main.mtek` first).
fn program(files: &[(&str, &str)]) -> (Program, SourceMap) {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").expect("path"),
        b"[project]\nname = \"fixture\"\nlanguage = \"0.1\"\n".to_vec(),
    );
    for (path, text) in files {
        fs.insert(
            ProjectPath::new(path).expect("path"),
            text.as_bytes().to_vec(),
        );
    }
    let analysis = crate::analyze(&ProjectRoot::at_base(), &fs);
    assert!(!analysis.has_errors(), "{:#?}", analysis.report);
    let program = lower_to_ir(&analysis).expect("lowers");
    let sources = analysis.project.as_ref().expect("project").sources.clone();
    (program, sources)
}

const SCENE: &str = "scene Demo {\n    camera Main {}\n}\n";

/// The WGSL of the only material of a one-module project.
fn wgsl_of(source: &str) -> String {
    let text = format!("{source}\n{SCENE}");
    let (program, _) = program(&[("src/main.mtek", &text)]);
    let material = program.materials().next().expect("a material");
    let shader = lower_material(&program, material).expect("lowered");
    emit_shader(&shader).expect("valid").wgsl
}

#[test]
fn authored_vertex_stage_tracks_inputs_helpers_params_and_source_spans() {
    let source = format!(
        r#"
fn shift(input: VertexInput, amount: f32) -> vec3 {{
    return input.position + vec3(input.uv.x * amount, 0.0, 0.0);
}}
material Deformed {{
    param amount: f32 = 0.5;
    vertex(input: VertexInput) -> vec3 {{ return shift(input, amount); }}
    fragment(input: SurfaceInput) -> color {{ return color.linear(vec3(1.0), 1.0); }}
}}
{SCENE}
"#
    );
    let (program, sources) = program(&[("src/main.mtek", &source)]);
    let material = program.materials().next().expect("material");
    let shader = lower_material(&program, material).expect("lowered");
    let artifact = emit_shader(&shader).expect("Naga validates authored entry points");
    assert!(artifact.vertex_deformation);
    // Passing the whole input to a helper retains all three attributes.
    assert_eq!(
        artifact
            .vertex_attributes
            .iter()
            .map(|a| a.name())
            .collect::<Vec<_>>(),
        vec!["position", "normal", "uv"]
    );
    assert!(artifact.surface_inputs.is_empty());
    assert!(artifact.wgsl.contains("fn mtek_vertex("));
    assert_eq!(
        artifact
            .wgsl
            .matches("let mtek_deformed_position = mtek_vertex(")
            .count(),
        2
    );
    assert!(artifact.wgsl.contains("mtek_params.u_amount"));
    assert!(artifact.span_map.entries.iter().any(|entry| {
        entry.symbol.ends_with("Deformed.vertex")
            && sources
                .slice(entry.span)
                .is_some_and(|s| s.contains("shift(input, amount)"))
    }));
}

#[test]
fn authored_vertex_attributes_are_independent_from_fragment_varyings() {
    let source = r#"
material Deformed {
    fragment(input: SurfaceInput) -> color { return color.linear(input.local_position, 1.0); }
    vertex(input: VertexInput) -> vec3 { return input.position + vec3(input.uv, 0.0); }
}

"#;
    let (program, _) = program(&[("src/main.mtek", &format!("{source}\n{SCENE}"))]);
    let material = program.materials().next().expect("material");
    let artifact =
        emit_shader(&lower_material(&program, material).expect("lowered")).expect("valid");
    assert_eq!(
        artifact
            .vertex_attributes
            .iter()
            .map(|a| a.name())
            .collect::<Vec<_>>(),
        vec!["position", "uv"]
    );
    assert_eq!(artifact.surface_inputs, vec![SurfaceField::LocalPosition]);
    assert!(artifact.wgsl.contains("mtek_deformed_position"));
    assert!(!artifact.wgsl.contains("@location(1) mtek_normal"));
}

#[test]
fn authored_vertex_input_can_be_copied_through_aggregate_locals() {
    let wgsl = wgsl_of(
        r#"
material Deformed {
    vertex(input: VertexInput) -> vec3 {
        let vertices = [input];
        return vertices[0].position;
    }
    fragment(input: SurfaceInput) -> color { return #ffffff; }
}
"#,
    );
    assert!(wgsl.contains("MtekVertexInput"));
    assert!(wgsl.contains("array<"));
}

#[test]
fn authored_vertex_rejects_bad_signatures_duplicates_cpu_calls_and_derivatives() {
    let cases = [
        (
            "vertex(v: SurfaceInput) -> vec3 { return vec3(0.0); }",
            "",
            Code::E4021,
        ),
        (
            "vertex(v: VertexInput) -> color { return color.linear(vec3(1.0), 1.0); }",
            "",
            Code::E4021,
        ),
        (
            "vertex(v: VertexInput) -> vec3 { return v.position; } vertex(w: VertexInput) -> vec3 { return w.position; }",
            "",
            Code::E2002,
        ),
        (
            "vertex(v: VertexInput) -> vec3 { return vec3(sample_mip(image, filter, v.uv).x); }",
            "param image: texture = texture.white(); param filter: sampler = sampler.linear_repeat();",
            Code::E4042,
        ),
        (
            "vertex(v: VertexInput) -> vec3 { return vec3(random()); }",
            "",
            Code::E4012,
        ),
    ];
    for (stage, params, expected) in cases {
        let text = format!(
            "material M {{ {params} {stage} fragment(s: SurfaceInput) -> color {{ return color.linear(vec3(1.0), 1.0); }} }} {SCENE}"
        );
        let mut fs = MemFs::new();
        fs.insert(
            ProjectPath::new("mtek.toml").unwrap(),
            b"[project]\nname = \"fixture\"\nlanguage = \"0.1\"\n".to_vec(),
        );
        fs.insert(
            ProjectPath::new("src/main.mtek").unwrap(),
            text.into_bytes(),
        );
        let analysis = crate::analyze(&ProjectRoot::at_base(), &fs);
        assert!(
            analysis
                .report
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == expected),
            "{stage}: {:#?}",
            analysis.report
        );
    }
}

#[test]
fn function_names_are_module_qualified() {
    assert_eq!(
        function_name("src/main.mtek::pulse").map(|n| crate::emit_wgsl::printer::mangle(&n)),
        Ok(format!("u_fn_{}_pulse", hash8("src/main.mtek")))
    );
    assert!(function_name("pulse").is_err());
}

#[test]
fn same_named_functions_of_two_modules_coexist_in_one_shader() {
    let main = format!(
        "import {{ glow }} from \"./b.mtek\";\nfn shade(x: f32) -> f32 {{ return x * 2.0; }}\n\
         material M {{\n    fragment(s: SurfaceInput) -> color {{\n        \
         return color.linear(vec3(shade(0.5), glow(0.5), 0.0), 1.0);\n    }}\n}}\n{SCENE}"
    );
    let b = "fn shade(x: f32) -> f32 { return x * 3.0; }\nexport fn glow(x: f32) -> f32 { return shade(x); }\n";
    let (program, _) = program(&[("src/main.mtek", &main), ("src/b.mtek", b)]);
    let material = program.materials().next().expect("material");
    let wgsl = emit_shader(&lower_material(&program, material).expect("lowered"))
        .expect("valid")
        .wgsl;
    let (ha, hb) = (hash8("src/main.mtek"), hash8("src/b.mtek"));
    for name in [
        format!("fn u_fn_{ha}_shade("),
        format!("fn u_fn_{hb}_shade("),
        format!("fn u_fn_{hb}_glow("),
    ] {
        assert_eq!(wgsl.matches(&name).count(), 1, "{name}\n{wgsl}");
    }
    // Callees before callers.
    let at = |name: &str| wgsl.find(name).expect(name);
    assert!(at(&format!("fn u_fn_{hb}_shade(")) < at(&format!("fn u_fn_{hb}_glow(")));
}

#[test]
fn only_reached_functions_and_used_helpers_are_emitted() {
    let wgsl = wgsl_of(
        "fn unused(x: f32) -> f32 { return x; }\n\
         fn used(q: quat) -> quat { return q * q; }\n\
         material M {\n    param q: quat = quat.identity();\n    \
         fragment(s: SurfaceInput) -> color { return color.linear(vec3(used(q).w), 1.0); }\n}\n",
    );
    assert!(!wgsl.contains("unused"), "{wgsl}");
    assert!(wgsl.contains("fn mtek_quat_mul("), "{wgsl}");
    for helper in [
        "quat_rotate",
        "quat_euler",
        "quat_axis_angle",
        "color_srgb",
        "mat4_",
    ] {
        assert!(
            !wgsl.contains(&format!("fn mtek_{helper}")),
            "{helper}\n{wgsl}"
        );
    }
}

#[test]
fn dynamic_indices_are_clamped_and_constant_ones_are_not() {
    let wgsl = wgsl_of(
        "material M {\n    param w: array<f32, 3> = [1.0, 2.0, 3.0];\n    param i: i32 = 1;\n    \
         param u: u32 = 1;\n    param m: mat4 = mat4.identity();\n    \
         fragment(s: SurfaceInput) -> color {\n        \
         return color.linear(vec3(w[i] + w[u] + w[2], m[i].x, m[u].y), 1.0);\n    }\n}\n",
    );
    for expected in [
        "mtek_params.u_w[clamp(mtek_params.u_i, 0i, 2i)].value",
        "mtek_params.u_w[min(mtek_params.u_u, 2u)].value",
        "mtek_params.u_w[2i].value",
        "mtek_params.u_m[clamp(mtek_params.u_i, 0i, 3i)].x",
        "mtek_params.u_m[min(mtek_params.u_u, 3u)].y",
    ] {
        assert!(wgsl.contains(expected), "{expected}\n{wgsl}");
    }
}

#[test]
fn bools_are_stored_as_u32_and_decoded_on_read() {
    let wgsl = wgsl_of(
        "struct F { on_top: bool; level: f32; }\n\
         material M {\n    param flag: bool = true;\n    param f: F = F { on_top: false; level: 1.0 };\n    \
         fragment(s: SurfaceInput) -> color {\n        \
         let made = F { on_top: flag; level: 0.5 };\n        \
         let flags = [flag, f.on_top];\n        \
         if made.on_top && flags[1] { return color.linear(vec3(1.0), 1.0); }\n        \
         return color.linear(vec3(f.level), 1.0);\n    }\n}\n",
    );
    for expected in [
        "S_e2cab98b_F(select(0u, 1u, (mtek_params.u_flag != 0u)), 0.5)",
        "array<MtekPad16_u32, 2>(MtekPad16_u32(select(0u, 1u, (mtek_params.u_flag != 0u))), \
         MtekPad16_u32(select(0u, 1u, (mtek_params.u_f.u_on_top != 0u))))",
        "if (u_l_made.u_on_top != 0u) && (u_l_flags[1i].value != 0u) {",
        "u_on_top: u32,",
    ] {
        assert!(wgsl.contains(expected), "{expected}\n{wgsl}");
    }
}

#[test]
fn constants_are_literals_with_stored_bools() {
    let wgsl = wgsl_of(
        "struct F { on_top: bool; level: f32; }\nconst C = F { on_top: true; level: 0.25 };\n\
         const FLAGS = [true, false];\nconst LOW: i32 = -2147483648;\n\
         fn pick(f: F, g: array<bool, 2>, n: i32) -> f32 { if f.on_top && g[0] { return f32(n); } return f.level; }\n\
         material M {\n    fragment(s: SurfaceInput) -> color {\n        \
         return color.linear(vec3(pick(C, FLAGS, LOW)), 1.0);\n    }\n}\n",
    );
    assert!(
        wgsl.contains(&format!(
            "u_fn_{}_pick(S_e2cab98b_F(1u, 0.25), array<MtekPad16_u32, 2>(MtekPad16_u32(1u), \
             MtekPad16_u32(0u)), i32(-2147483647 - 1))",
            hash8("src/main.mtek")
        )),
        "{wgsl}"
    );
}

#[test]
fn a_call_statement_of_a_function_with_a_result_discards_it() {
    let wgsl = wgsl_of(
        "fn twice(x: f32) -> f32 { return x * 2.0; }\nfn nothing(x: f32) { twice(x); }\n\
         material M {\n    fragment(s: SurfaceInput) -> color {\n        nothing(1.0);\n        \
         sin(1.0);\n        return color.linear(vec3(0.0), 1.0);\n    }\n}\n",
    );
    let h = hash8("src/main.mtek");
    assert!(
        wgsl.contains(&format!("    _ = u_fn_{h}_twice(u_p_x);\n")),
        "{wgsl}"
    );
    assert!(
        wgsl.contains(&format!("    u_fn_{h}_nothing(1.0);\n")),
        "{wgsl}"
    );
    assert!(
        wgsl.contains("    _ = sin(1.0);\n") || wgsl.contains("    _ = 0.84147096;\n"),
        "{wgsl}"
    );
}

/// Replaces the expression with span `at` in `statements` by a call of the undefined
/// function `mtek_broken` with the same span: the test-only broken emission.
fn break_expression(statements: &mut [Statement], at: Span) -> bool {
    fn in_expr(expr: &mut Expr, at: Span) -> bool {
        if expr.span == at {
            *expr = Expr::call(Name::generated("broken"), Vec::new(), expr.ty.clone(), at);
            return true;
        }
        match &mut expr.kind {
            ExprKind::Field { base, .. }
            | ExprKind::Swizzle { base, .. }
            | ExprKind::Unary { operand: base, .. }
            | ExprKind::Bitcast { arg: base }
            | ExprKind::Bool32Encode { value: base }
            | ExprKind::Bool32Decode { value: base } => in_expr(base, at),
            ExprKind::Index { base, index } => in_expr(base, at) || in_expr(index, at),
            ExprKind::Binary { left, right, .. } => in_expr(left, at) || in_expr(right, at),
            ExprKind::Construct { args }
            | ExprKind::Intrinsic { args, .. }
            | ExprKind::Call { args, .. } => args.iter_mut().any(|a| in_expr(a, at)),
            ExprKind::Literal(_) | ExprKind::Local(_) | ExprKind::Global(_) => false,
        }
    }
    statements.iter_mut().any(|statement| match statement {
        Statement::Let { value, .. }
        | Statement::Var { value, .. }
        | Statement::Discard { value, .. } => in_expr(value, at),
        Statement::Call { args, .. } => args.iter_mut().any(|a| in_expr(a, at)),
        Statement::Assign { target, value, .. } => in_expr(target, at) || in_expr(value, at),
        Statement::Return { value, .. } => value.as_mut().is_some_and(|v| in_expr(v, at)),
        Statement::If {
            branches,
            otherwise,
            ..
        } => {
            branches
                .iter_mut()
                .any(|(c, b)| in_expr(c, at) || break_expression(b, at))
                || otherwise.as_mut().is_some_and(|b| break_expression(b, at))
        }
        Statement::For {
            start, end, body, ..
        } => in_expr(start, at) || in_expr(end, at) || break_expression(body, at),
        Statement::Block { body, .. } => break_expression(body, at),
        Statement::Break { .. } | Statement::Continue { .. } => false,
    })
}

#[test]
fn a_broken_emission_is_e6100_at_the_mtek_span_of_the_broken_node() {
    let text = format!(
        "fn pulse(t: f32) -> f32 {{\n    return 0.65 + 0.35 * sin(t);\n}}\n\
         material Pulse {{\n    param phase: f32 = 0.0;\n    \
         fragment(input: SurfaceInput) -> color {{\n        \
         return color.linear(vec3(pulse(phase)), 1.0);\n    }}\n}}\n{SCENE}"
    );
    let (program, sources) = program(&[("src/main.mtek", &text)]);
    let material = program.materials().next().expect("material");
    for (target, symbol) in [
        ("sin(t)", "src/main.mtek::pulse"),
        ("pulse(phase)", "src/main.mtek::Pulse.fragment"),
    ] {
        let start = u32::try_from(text.find(target).expect("in the text")).expect("small");
        let end = start + u32::try_from(target.len()).expect("small");
        let at = Span::new(material.span.file, start, end);
        let mut shader = lower_material(&program, material).expect("lowered");
        let broken = shader
            .module
            .functions
            .iter_mut()
            .any(|f| break_expression(&mut f.body, at));
        assert!(broken, "{target} is an expression of the shader");
        let diagnostics = emit_shader(&shader).expect_err("Naga rejects the module");
        assert_eq!(diagnostics.len(), 1);
        let diagnostic = &diagnostics[0];
        assert_eq!(diagnostic.code, Code::E6100);
        let primary = diagnostic.primary.as_ref().expect("a primary label").span;
        assert_eq!(sources.slice(primary), Some(target), "{diagnostic:#?}");
        assert!(diagnostic.notes[0].starts_with("Naga: "), "{diagnostic:#?}");
        assert!(
            diagnostic.notes[0].contains("mtek_broken"),
            "{diagnostic:#?}"
        );
        assert!(
            diagnostic.notes[1].ends_with(&format!("in code generated for '{symbol}'")),
            "{diagnostic:#?}"
        );
    }
}

#[test]
fn a_long_call_chain_lowers_without_a_deep_stack() {
    // 2 000 functions, each calling the next: the worklist and the explicit depth-first
    // stack need no native recursion along the chain, and callees come first, so Naga's
    // own dependency search stays shallow too.
    let count = 2_000;
    let mut text = String::new();
    for i in 0..count {
        text.push_str(&format!(
            "fn g{i}(x: f32) -> f32 {{ return g{}(x) + 1.0; }}\n",
            i + 1
        ));
    }
    text.push_str(&format!(
        "fn g{count}(x: f32) -> f32 {{ return x; }}\n\
         material M {{\n    fragment(s: SurfaceInput) -> color {{ return color.linear(vec3(g0(0.0)), 1.0); }}\n}}\n{SCENE}"
    ));
    let handle = std::thread::Builder::new()
        .stack_size(16 << 20)
        .spawn(move || {
            let (program, _) = program(&[("src/main.mtek", &text)]);
            let material = program.materials().next().expect("material");
            let shader = lower_material(&program, material).expect("lowered");
            let printed = print_module(&shader.module);
            validate_wgsl(&printed.text)
                .map(|_| ())
                .map_err(|e| e.to_string())?;
            let names: Vec<usize> = (0..=count)
                .map(|i| {
                    printed
                        .text
                        .find(&format!("_g{i}(u_p_x: f32)"))
                        .unwrap_or(usize::MAX)
                })
                .collect();
            // g2000 first, g0 last.
            if names.windows(2).all(|w| w[0] > w[1]) {
                Ok(())
            } else {
                Err("functions are not in callee-first order".to_owned())
            }
        })
        .expect("spawned");
    assert_eq!(handle.join().expect("no panic"), Ok(()));
}

#[test]
fn structured_vertex_outputs_supply_normals_uv_and_typed_payloads() {
    let text = r#"
struct Payload { position: vec3; normal: vec3; uv: vec2; heat: f32; tag: u32; enabled: bool; }
fn produce(input: VertexInput) -> Payload {
    return Payload { position: input.position; normal: vec3(0.0, 1.0, 0.0); uv: vec2(0.25); heat: input.position.x; tag: u32(7); enabled: true };
}
material M {
    vertex(input: VertexInput) -> Payload { return produce(input); }
    fragment(surface: SurfaceInput, payload: Payload) -> color {
        let tint = color.linear(vec3(surface.uv.x, payload.heat, f32(payload.tag) * 0.1), 1.0);
        if payload.enabled { return lighting.pbr(surface, tint, 0.0, 0.5); }
        return #000000;
    }
}
"#;
    let wgsl = wgsl_of(text);
    assert_eq!(wgsl.matches("@interpolate(flat)").count(), 2);
    assert!(wgsl.contains("mtek_deformed_vertex.u_normal"));
    assert!(wgsl.contains("mtek_deformed_vertex.u_uv"));
    assert!(wgsl.contains("payload_5"));
}

#[test]
fn structured_geometry_outputs_remove_unneeded_mesh_attributes() {
    let text = format!(
        r#"
struct Shape {{ position: vec3; normal: vec3; uv: vec2; }}
material M {{
    vertex(input: VertexInput) -> Shape {{
        return Shape {{ position: input.position; normal: vec3(0.0, 1.0, 0.0); uv: vec2(0.5) }};
    }}
    fragment(s: SurfaceInput) -> color {{ return lighting.pbr(s, color.linear(vec3(s.uv, 0.0), 1.0), 0.0, 0.5); }}
}}
{SCENE}
"#
    );
    let (program, _) = program(&[("src/main.mtek", &text)]);
    let material = program.materials().next().unwrap();
    let shader = lower_material(&program, material).unwrap();
    assert_eq!(
        shader
            .vertex_attributes
            .iter()
            .map(|field| field.name())
            .collect::<Vec<_>>(),
        vec!["position"]
    );
    emit_shader(&shader).expect("normal and UV are supplied by the authored result");
}

fn stage_errors(types: &str, stages: &str) -> Vec<Code> {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        b"[project]\nname = \"fixture\"\nlanguage = \"0.1\"\n".to_vec(),
    );
    fs.insert(
        ProjectPath::new("src/main.mtek").unwrap(),
        format!("{types} material M {{ {stages} }} {SCENE}").into_bytes(),
    );
    let analysis = crate::analyze(&ProjectRoot::at_base(), &fs);
    analysis.report.diagnostics.iter().map(|d| d.code).collect()
}

#[test]
fn structured_vertex_payloads_link_nominal_types_and_validate_fields() {
    let cases = [
        (
            "struct Output { normal: vec3; }",
            "vertex(v: VertexInput) -> Output { return Output { normal: v.normal }; } fragment(s: SurfaceInput) -> color { return #ffffff; }",
        ),
        (
            "struct Output { position: vec2; }",
            "vertex(v: VertexInput) -> Output { return Output { position: v.uv }; } fragment(s: SurfaceInput) -> color { return #ffffff; }",
        ),
        (
            "struct Output { position: vec3; data: mat4; }",
            "vertex(v: VertexInput) -> Output { return Output { position: v.position; data: mat4.identity() }; } fragment(s: SurfaceInput) -> color { return #ffffff; }",
        ),
        (
            "struct Output { position: vec3; } struct Other { position: vec3; }",
            "vertex(v: VertexInput) -> Output { return Output { position: v.position }; } fragment(s: SurfaceInput, data: Other) -> color { return #ffffff; }",
        ),
        (
            "struct Output { position: vec3; }",
            "fragment(s: SurfaceInput, data: Output) -> color { return #ffffff; }",
        ),
    ];
    for (types, stages) in cases {
        assert!(
            stage_errors(types, stages).contains(&Code::E4021),
            "{stages}"
        );
    }
}

#[test]
fn structured_payload_slots_use_available_locations_and_enforce_the_limit() {
    for count in [15, 16] {
        let fields = (0..count)
            .map(|i| format!("f{i}: f32;"))
            .collect::<String>();
        let values = (0..count)
            .map(|i| format!("f{i}: 0.5;"))
            .collect::<String>();
        let types = format!("struct Payload {{ position: vec3; {fields} }}");
        let stages = format!(
            "vertex(v: VertexInput) -> Payload {{ return Payload {{ position: v.position; {values} }}; }} fragment(s: SurfaceInput, p: Payload) -> color {{ return color.linear(vec3(p.f14), 1.0); }}"
        );
        if count == 16 {
            assert!(stage_errors(&types, &stages).contains(&Code::E6003));
        } else {
            let wgsl = wgsl_of(&format!("{types} material M {{ {stages} }}"));
            assert!(wgsl.contains("@location(15)"));
            assert!(!wgsl.contains("@location(16)"));
        }
    }
}

#[test]
fn quaternion_payloads_preserve_vertex_values_and_inspect_as_flat() {
    let source = format!(
        r#"
struct Payload {{ position: vec3; axis: quat; tint: color; }}
material M {{
    vertex(v: VertexInput) -> Payload {{
        return Payload {{ position: v.position; axis: quat.axis_angle(vec3(0.0, 1.0, 0.0), v.uv.x); tint: #ff0000 }};
    }}
    fragment(s: SurfaceInput, p: Payload) -> color {{ return color.linear(p.tint.rgb * p.axis.w, 1.0); }}
}}
{SCENE}
"#
    );
    let (program, _) = program(&[("src/main.mtek", &source)]);
    let artifact =
        emit_shader(&lower_material(&program, program.materials().next().unwrap()).unwrap())
            .unwrap();
    let axis = artifact
        .varyings
        .iter()
        .find(|field| field.name == "axis")
        .unwrap();
    assert_eq!(axis.source_type, "quat");
    assert_eq!(axis.wgsl_type, "vec4<f32>");
    assert_eq!(axis.interpolation, "flat");
    assert_eq!(
        artifact
            .varyings
            .iter()
            .find(|field| field.name == "tint")
            .unwrap()
            .interpolation,
        "perspective-center"
    );
    let locations: BTreeSet<_> = artifact
        .varyings
        .iter()
        .map(|field| field.location)
        .collect();
    assert_eq!(locations.len(), artifact.varyings.len());
}

#[test]
fn imported_and_late_declared_vertex_payloads_keep_nominal_linkage_and_source_maps() {
    let main = format!(
        r#"
import {{ Payload, produce }} from "./data.mtek";
material M {{
    vertex(input: VertexInput) -> Payload {{ return produce(input); }}
    fragment(s: SurfaceInput, data: Payload) -> color {{ return color.linear(vec3(s.uv, f32(data.tag) * 0.1), 1.0); }}
}}
{SCENE}
"#
    );
    let data = r#"
export fn produce(input: VertexInput) -> Payload {
    return Payload { position: input.position; normal: vec3(0.0, 1.0, 0.0); uv: vec2(0.5); tag: u32(7) };
}
export struct Payload { position: vec3; normal: vec3; uv: vec2; tag: u32; }
"#;
    let (program, _) = program(&[("src/main.mtek", &main), ("src/data.mtek", data)]);
    let artifact =
        emit_shader(&lower_material(&program, program.materials().next().unwrap()).unwrap())
            .unwrap();
    assert!(
        artifact
            .span_map
            .entries
            .iter()
            .any(|entry| entry.symbol == "src/data.mtek::produce")
    );
    assert!(
        artifact
            .span_map
            .entries
            .iter()
            .any(|entry| entry.symbol.ends_with("M.vertex"))
    );
    let field = artifact
        .varyings
        .iter()
        .find(|field| field.name == "tag")
        .unwrap();
    assert_eq!(field.source_type, "u32");
    assert_eq!(field.interpolation, "flat");
    assert_eq!(field.location, 4);
}
