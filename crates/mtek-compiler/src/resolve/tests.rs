//! Unit tests of name resolution: what names resolve to, the scope rules
//! that the semantic fixtures do not pin one by one, and stack use at the
//! nesting limit (corpus-wide tests are in `tests/resolve_corpus.rs`).

use super::*;
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::source::FileId;
use crate::syntax::ast::{Module, NodeId};
use crate::syntax::{NodeInfo, lex_str, parse_module, walk_module};

struct Resolved {
    text: String,
    module: Module,
    resolution: Resolution,
    diagnostics: Vec<Diagnostic>,
    syntax_errors: usize,
}

fn resolve_text(text: &str) -> Resolved {
    resolve_text_with(text, |_| ImportBindings::new())
}

/// Resolve `text` with the import bindings `bind` computes from the parsed
/// module.
fn resolve_text_with(text: &str, bind: impl Fn(&Module) -> ImportBindings) -> Resolved {
    let mut lexed = lex_str(FileId(0), text);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    let syntax_errors = sink.len();
    let bindings = bind(&parsed.module);
    let resolution = resolve_module_with_imports(&parsed.module, &bindings, &mut sink);
    Resolved {
        text: text.to_owned(),
        module: parsed.module,
        resolution,
        diagnostics: sink.finish().diagnostics,
        syntax_errors,
    }
}

impl Resolved {
    fn codes(&self) -> Vec<&'static str> {
        self.diagnostics.iter().map(|d| d.code.short()).collect()
    }

    /// The nodes the walk labels `kind` whose source text is `text`, in
    /// source order.
    fn nodes(&self, kind: &str, text: &str) -> Vec<NodeInfo> {
        let mut found = Vec::new();
        walk_module(&self.module, &mut |info, _| {
            if info.kind == kind && self.text.get(info.span.range()) == Some(text) {
                found.push(info);
            }
        });
        found.sort_by_key(|info| info.span.start);
        found
    }

    /// What the `n`th node labelled `kind` with text `text` resolves to.
    fn res(&self, kind: &str, text: &str, n: usize) -> Option<Res> {
        let node = self.nodes(kind, text).get(n).map(|info| info.id)?;
        self.resolution.res(node)
    }

    /// The declaration named `name` (the first, if several).
    fn def_named(&self, name: &str) -> &Def {
        self.resolution
            .defs()
            .iter()
            .find(|def| def.name == name)
            .unwrap_or_else(|| panic!("no declaration '{name}'"))
    }
}

#[test]
fn names_resolve_to_declarations_prelude_items_and_fields() {
    let r = resolve_text(
        "const BASE = 1.5;\n\
         scene Demo {\n\
             camera Main { position: vec3(0.0, 0.0, BASE); rotation: quat.identity(); }\n\
             entity Table {\n\
                 mesh: Box { size: vec3(1.0, 1.0, 1.0) };\n\
                 entity Lamp { position: vec3(0.0, BASE, 0.0); }\n\
             }\n\
         }\n",
    );
    assert!(r.diagnostics.is_empty(), "{:?}", r.diagnostics);

    let base = r.def_named("BASE");
    assert_eq!(base.kind, DefKind::Const);
    assert_eq!(r.res("name", "BASE", 0), Some(Res::Def(base.id)));
    assert_eq!(r.res("name", "BASE", 1), Some(Res::Def(base.id)));
    assert_eq!(
        r.res("name", "vec3", 0),
        Some(Res::Prelude(PreludeItem::Type("vec3")))
    );
    assert_eq!(
        r.res("name", "quat", 0),
        Some(Res::Prelude(PreludeItem::Namespace("quat")))
    );
    assert_eq!(
        r.res("ident", "identity", 0),
        Some(Res::Prelude(PreludeItem::NamespaceMember {
            namespace: "quat",
            member: "identity"
        }))
    );
    assert_eq!(
        r.res("ident", "Box", 0),
        Some(Res::Prelude(PreludeItem::Schema("Box")))
    );
    assert_eq!(r.res("ident", "size", 0), Some(Res::Field));
    assert_eq!(r.res("ident", "position", 0), Some(Res::Field));
    assert_eq!(
        r.res("ident", "camera", 0),
        Some(Res::Prelude(PreludeItem::SceneObject("camera")))
    );

    // Declarations, their kinds and parents.
    let demo = r.def_named("Demo");
    let main = r.def_named("Main");
    let table = r.def_named("Table");
    let lamp = r.def_named("Lamp");
    assert_eq!(demo.kind, DefKind::Scene);
    assert_eq!(
        main.kind,
        DefKind::SceneObject {
            kind: Some("camera")
        }
    );
    assert_eq!(main.parent, Some(demo.id));
    assert_eq!(table.parent, Some(demo.id));
    assert_eq!(lamp.kind, DefKind::Entity);
    assert_eq!(lamp.parent, Some(table.id), "nesting is recorded as parent");
    assert_eq!(r.resolution.def_of(lamp.node), Some(lamp.id));
    // DefIds are dense and index the table.
    for (index, def) in r.resolution.defs().iter().enumerate() {
        assert_eq!(def.id.index(), index);
        assert_eq!(r.resolution.def(def.id), Some(def));
    }
}

#[test]
fn a_child_entity_does_not_see_its_parent_body() {
    let r = resolve_text(
        "scene Demo {\n\
             entity Parent {\n\
                 const OFFSET = 1.0;\n\
                 entity Child { position: vec3(OFFSET, 0.0, 0.0); }\n\
             }\n\
         }\n",
    );
    assert_eq!(r.codes(), ["E2003"]);
    assert_eq!(r.diagnostics[0].message, "Unknown name 'OFFSET'.");
}

#[test]
fn entities_are_visible_everywhere_in_their_scene() {
    // An entity's name is in the scene scope, whatever its nesting depth and
    // wherever it is declared.
    let r = resolve_text(
        "scene Demo {\n\
             camera Main { position: Lamp.position; }\n\
             entity Table { entity Lamp { } }\n\
         }\n",
    );
    assert!(r.diagnostics.is_empty(), "{:?}", r.diagnostics);
    let lamp = r.def_named("Lamp");
    assert_eq!(r.res("name", "Lamp", 0), Some(Res::Def(lamp.id)));
    assert_eq!(r.res("ident", "position", 1), Some(Res::Field));
}

#[test]
fn locals_are_visible_from_the_end_of_their_declaration() {
    let r = resolve_text("fn f() { let a = b; let b = 1.0; let c = c; }\n");
    let unknown: Vec<&str> = r
        .diagnostics
        .iter()
        .filter(|d| d.code == Code::E2003)
        .map(|d| d.message.as_str())
        .collect();
    assert_eq!(unknown, ["Unknown name 'b'.", "Unknown name 'c'."]);
}

#[test]
fn sibling_blocks_may_reuse_a_name_but_nested_ones_may_not() {
    let r = resolve_text("fn f() { { let a = 1.0; } { let a = 2.0; } }\n");
    assert!(r.codes().is_empty(), "{:?}", r.diagnostics);
    let r = resolve_text("fn f(i: i32) { for i in 0..3 { } }\n");
    assert_eq!(r.codes(), ["E2001"]);
    let r = resolve_text("fn f() { for i in 0..3 { let i = 1; } }\n");
    assert_eq!(r.codes(), ["E2001"]);
}

#[test]
fn a_local_or_parameter_may_reuse_a_prelude_function_but_calling_it_is_e2004() {
    let r = resolve_text("fn f(length: f32) -> f32 { let step = length; return step; }\n");
    assert!(r.codes().is_empty(), "{:?}", r.diagnostics);
    let length = r.def_named("length");
    assert_eq!(r.res("name", "length", 0), Some(Res::Def(length.id)));

    let r = resolve_text("fn f(length: f32) -> f32 { return length(vec3(1.0)); }\n");
    assert_eq!(r.codes(), ["E2004"]);
    assert_eq!(r.res("name", "length", 0), Some(Res::Error));
}

#[test]
fn only_locals_parameters_state_and_param_may_reuse_a_prelude_function() {
    for (source, codes) in [
        ("const sin = 1.0;", vec!["E2001"]),
        ("fn sin() {}", vec!["E2001"]),
        ("scene Demo { entity sin {} }", vec!["E2001"]),
        ("scene Demo { camera sin {} }", vec!["E2001"]),
        ("scene Demo { state sin: f32 = 0.0; }", vec!["E9010"]),
        ("prefab P { param sin: f32 = 0.0; }", vec!["E9010"]),
        (
            "fn f() { let sin = 1.0; var cos = 2.0; for tan in 0..2 { } }",
            vec![],
        ),
    ] {
        assert_eq!(resolve_text(source).codes(), codes, "{source}");
    }
}

#[test]
fn prelude_types_schemas_enums_and_namespaces_can_never_be_reused() {
    for source in [
        "const vec3 = 1.0;",
        "fn f(Box: f32) {}",
        "fn f() { let Key = 1; }",
        "fn f() { let frame = 1; }",
        "scene Demo { state quat: f32 = 0.0; }",
        "struct color { a: f32; }",
    ] {
        let codes = resolve_text(source).codes();
        assert!(codes.contains(&"E2001"), "{source}: {codes:?}");
    }
}

#[test]
fn a_material_or_prefab_param_may_share_its_name_with_a_prelude_type() {
    // `param color: color` (the prelude `Unlit` does this); the name means
    // the type in type position.
    let r = resolve_text(
        "material M { param color: color = #ffffff; fragment(s: SurfaceInput) -> color { return color; } }\n",
    );
    assert!(r.codes().is_empty(), "{:?}", r.diagnostics);
    let param = r.def_named("color");
    assert_eq!(param.kind, DefKind::Param);
    assert_eq!(
        r.res("ident", "color", 1),
        Some(Res::Prelude(PreludeItem::Type("color"))),
        "the type of the param"
    );
    assert_eq!(r.res("name", "color", 0), Some(Res::Def(param.id)));

    let r = resolve_text("prefab P { param vec3: f32 = 1.0; }\n");
    assert_eq!(r.codes(), ["E9010"]);
    // ... but not with a schema or an enum.
    let r = resolve_text("material M { param Box: f32 = 1.0; }\n");
    assert_eq!(r.codes(), ["E2001"]);
    let r = resolve_text("material M { param Key: f32 = 1.0; }\n");
    assert_eq!(r.codes(), ["E2001"]);
    // A local may not share a prelude type name.
    let r = resolve_text("fn f() { let color = 1.0; }\n");
    assert_eq!(r.codes(), ["E2001"]);
}

#[test]
fn a_component_of_a_param_named_like_a_namespace_is_not_e2005() {
    // `color.r` is a field of the param; only a member of the namespace
    // `color` is the hidden namespace.
    let r = resolve_text(
        "material M { param color: color = #ffffff; fragment(s: SurfaceInput) -> color { let r = color.r; return color; } }\n",
    );
    assert!(r.codes().is_empty(), "{:?}", r.diagnostics);
}

#[test]
fn self_means_the_enclosing_entity_or_prefab() {
    let r = resolve_text("scene Demo { entity Cube { scale: self.scale; } }\n");
    assert_eq!(r.codes(), ["E9010"]);
    let cube = r.def_named("Cube");
    assert_eq!(r.res("self", "self", 0), Some(Res::Def(cube.id)));

    let r = resolve_text("prefab Crate { scale: self.scale; }\n");
    let crate_def = r.def_named("Crate");
    assert_eq!(r.res("self", "self", 0), Some(Res::Def(crate_def.id)));

    let r = resolve_text("fn f() -> f32 { return self; }\n");
    assert_eq!(r.codes(), ["E2003"], "{:?}", r.diagnostics);
}

#[test]
fn imported_names_are_declared_in_the_module() {
    // Without a binding (the import was reported where it failed), the name
    // is declared, and its uses resolve to `Error` without a diagnostic.
    let r =
        resolve_text("import { Tint } from \"./tint.mtek\";\nscene Demo { clear_color: Tint; }\n");
    assert!(r.codes().is_empty(), "{:?}", r.diagnostics);
    let tint = r.def_named("Tint");
    assert_eq!(tint.kind, DefKind::Import);
    assert_eq!(r.res("name", "Tint", 0), Some(Res::Error));
    assert!(r.resolution.import_target(tint.id).is_none());
}

/// Bindings that make every imported name of `module` a declaration of
/// module 1 of the kind `kind_of` gives it.
fn bind_all(module: &Module, kind_of: impl Fn(&str) -> DefKind) -> ImportBindings {
    let mut bindings = ImportBindings::new();
    for item in &module.items {
        if let crate::syntax::ast::ItemKind::Import(decl) = &item.kind {
            for name in &decl.names {
                bindings.insert(
                    name.id,
                    ImportTarget {
                        module: crate::project::ModuleId::from_index(1),
                        node: NodeId(0),
                        kind: kind_of(&name.name),
                        span: crate::source::Span::new(FileId(1), 0, 1),
                    },
                );
            }
        }
    }
    bindings
}

#[test]
fn bound_imported_names_resolve_to_the_import_with_the_target_kind() {
    let text = "import { TINT, Shape } from \"./lib.mtek\";\n\
                const C: Shape = TINT;\n\
                scene Demo { clear_color: TINT; }\n";
    let r = resolve_text_with(text, |module| {
        bind_all(module, |name| {
            if name == "Shape" {
                DefKind::Struct
            } else {
                DefKind::Const
            }
        })
    });
    // Only the struct item itself is gated; its imported name is a type.
    assert!(!r.codes().contains(&"E3003"), "{:?}", r.diagnostics);
    let tint = r.def_named("TINT");
    let shape = r.def_named("Shape");
    assert_eq!(r.res("name", "TINT", 0), Some(Res::Def(tint.id)));
    assert_eq!(r.res("name", "TINT", 1), Some(Res::Def(tint.id)));
    assert_eq!(r.res("ident", "Shape", 1), Some(Res::Def(shape.id)));
    let target = r.resolution.import_target(tint.id).unwrap();
    assert_eq!(target.kind, DefKind::Const);
    assert_eq!(r.resolution.imports().count(), 2);

    // A constant is not a type, wherever it is declared.
    let r = resolve_text_with(
        "import { TINT } from \"./lib.mtek\";\nconst C: TINT = 1.0;\n",
        |m| bind_all(m, |_| DefKind::Const),
    );
    assert_eq!(r.codes(), ["E3003"]);
    assert_eq!(
        r.diagnostics[0].message,
        "'TINT' is a constant, not a type."
    );
}

#[test]
fn importing_a_name_twice_is_e2002() {
    let r = resolve_text(
        "import { A } from \"./a.mtek\";\nimport { B, A } from \"./b.mtek\";\nconst B = 1;\n",
    );
    assert_eq!(r.codes(), ["E2002", "E2002"], "{:?}", r.diagnostics);
    assert_eq!(
        r.diagnostics[0].message,
        "Duplicate import of 'A': the name is already imported in this module."
    );
    assert_eq!(
        r.diagnostics[1].message,
        "Duplicate declaration of 'B': an imported name of that name is already declared in this module."
    );
}

#[test]
fn type_names_resolve_to_structs_and_prelude_types() {
    let r =
        resolve_text("struct Pair { a: f32; b: vec3; }\nfn f(p: Pair) -> f32 { return p.a; }\n");
    // Structs (decision 0035) and functions (decision 0038) are implemented.
    assert!(r.codes().is_empty(), "{:?}", r.diagnostics);
    let pair = r.def_named("Pair");
    assert_eq!(r.res("ident", "Pair", 1), Some(Res::Def(pair.id)));
    assert_eq!(
        r.res("ident", "vec3", 0),
        Some(Res::Prelude(PreludeItem::Type("vec3")))
    );
    assert_eq!(r.res("ident", "a", 0), Some(Res::Field), "struct field");

    let r = resolve_text("const N = 4;\nfn f(a: array<f32, N>) {}\n");
    let n = r.def_named("N");
    assert_eq!(r.res("len", "N", 0), Some(Res::Def(n.id)));

    let r = resolve_text("const A: Box = 1.0;\n");
    assert_eq!(r.codes(), ["E3003"]);
    assert_eq!(
        r.diagnostics[0].message,
        "'Box' is a built-in schema, not a type."
    );
}

#[test]
fn enum_members_and_unknown_members_are_resolved() {
    let r = resolve_text("scene Demo { on key_down(Key.Space) { } on key_up(Key.Spcae) { } }\n");
    assert_eq!(r.codes(), ["E9010", "E9010", "E2003"]);
    assert_eq!(
        r.res("ident", "Space", 0),
        Some(Res::Prelude(PreludeItem::EnumMember {
            enum_name: "Key",
            member: "Space"
        }))
    );
    assert_eq!(
        r.res("ident", "key_down", 0),
        Some(Res::Prelude(PreludeItem::Event("key_down")))
    );
    assert_eq!(
        r.diagnostics[2].notes,
        ["help: did you mean the built-in 'Key.Space'?"]
    );
}

#[test]
fn a_did_you_mean_needs_exactly_one_candidate() {
    let r = resolve_text("const ALPHA = 1.0;\nconst ALPHB = 2.0;\nconst X = ALPHC;\n");
    assert_eq!(r.codes(), ["E2003"]);
    assert!(r.diagnostics[0].related.is_empty());
    assert!(r.diagnostics[0].notes.is_empty());
}

#[test]
fn side_table_entries_are_in_node_order() {
    let r = resolve_text("const A = 1;\nconst B = A;\n");
    let nodes: Vec<NodeId> = r.resolution.entries().map(|(node, _)| node).collect();
    let mut sorted = nodes.clone();
    sorted.sort();
    assert_eq!(nodes, sorted);
    assert!(nodes.len() >= 3);
}

#[test]
fn resolution_at_the_nesting_limit_fits_in_a_small_stack() {
    // The parser bounds the tree at 256 levels (decision 0022); resolving the
    // worst shapes needs far less than the 16 MiB of the compilation thread.
    let depth = 250;
    let parens = format!("const A = {}1.0{};\n", "(".repeat(depth), ")".repeat(depth));
    let blocks = format!("fn f() {{ {} {} }}\n", "{".repeat(depth), "}".repeat(depth));
    let mut entities = String::from("scene Demo { ");
    for i in 0..depth {
        entities.push_str(&format!("entity E{i} {{ "));
    }
    entities.push_str(&"} ".repeat(depth));
    entities.push_str("}\n");
    let calls = format!(
        "const B = {}1.0{};\n",
        "vec3(".repeat(depth),
        ")".repeat(depth)
    );
    for source in [parens, blocks, entities, calls] {
        let handle = std::thread::Builder::new()
            .stack_size(4 * 1024 * 1024)
            .spawn(move || resolve_text(&source).syntax_errors)
            .unwrap();
        assert_eq!(handle.join().unwrap(), 0);
    }
}

#[test]
fn only_the_prelude_mode_declares_the_names_of_builtin_materials() {
    let text = "export material Unlit {\n    param color: color = #ffffff;\n    fragment(surface: SurfaceInput) -> color { return color; }\n}\nmaterial Box { fragment(s: SurfaceInput) -> color { return #ffffff; } }\n";
    // In a user module both declarations hide a prelude name (decision 0044).
    let user = resolve_text(text);
    let codes: Vec<Code> = user.diagnostics.iter().map(|d| d.code).collect();
    assert_eq!(codes, [Code::E2001, Code::E2001], "{:#?}", user.diagnostics);
    // The prelude may declare the built-in material `Unlit`, and nothing else.
    let mut lexed = lex_str(FileId(0), text);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    let _ = resolve_prelude_module(&parsed.module, &mut sink);
    let diagnostics = sink.finish().diagnostics;
    assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
    assert_eq!(diagnostics[0].code, Code::E2001);
    assert!(diagnostics[0].message.contains("Box"), "{diagnostics:#?}");
}
