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
