//! Unit tests of dynamic entities in the typed IR (decision 0064): prefab literals, `entity_ref` values and the
//! handler-only built-ins.

use super::*;
use crate::project::ProjectRoot;
use crate::source::{MemFs, ProjectPath};

fn lowered(source: &str) -> Program {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n",
    )
    .insert(ProjectPath::new("src/main.mtek").unwrap(), source);
    let analysis = crate::analyze(&ProjectRoot::at_base(), &fs);
    assert!(!analysis.has_errors(), "{:#?}", analysis.report);
    lower_to_ir(&analysis).expect("lowered")
}

const SOURCE: &str = r#"
prefab Crate {
    param origin: vec3;
    param tint: color = #ff0000;
    param life: f32 = 2.0;
    position: origin;
    mesh: Box {};
    material: Unlit { color: tint };
    state kid: entity_ref = self;
    on key_down(Key.Enter) {
        kid = spawn(Crate { origin: self.position + vec3(0.0, 1.0, 0.0); life: life / 2.0; });
        destroy(self);
    }
}

scene Demo {
    camera Main {}
    state last: entity_ref = Floor;
    entity Floor { mesh: Box {}; }
    on key_down(Key.Space) {
        last = spawn(Crate { origin: vec3(1.0, 2.0, 3.0); });
        if last == Floor { destroy(last); }
    }
}
"#;

fn behaviour<'a>(program: &'a Program, name: &str) -> &'a Behavior {
    let scene = program.entry().expect("scene");
    scene
        .behaviors
        .iter()
        .find(|b| b.symbol.as_str().ends_with(name))
        .unwrap_or_else(|| panic!("no behaviour {name}"))
}

/// The statements of a behaviour's body, flattened one level (`if` bodies included).
fn expressions(behavior: &Behavior) -> Vec<&Expr> {
    fn block<'b>(b: &'b Block, out: &mut Vec<&'b Expr>) {
        for stmt in &b.stmts {
            match stmt {
                Stmt::Assign { value, .. } => out.push(value),
                Stmt::Expr { expr, .. } => out.push(expr),
                Stmt::If {
                    branches,
                    otherwise,
                    ..
                } => {
                    for branch in branches {
                        out.push(&branch.cond);
                        block(&branch.body, out);
                    }
                    if let Some(body) = otherwise {
                        block(body, out);
                    }
                }
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    block(&behavior.body, &mut out);
    out
}

#[test]
fn a_prefab_literal_is_a_spawn_of_every_param_in_declaration_order_with_defaults_filled_in() {
    let program = lowered(SOURCE);
    let handler = behaviour(&program, "on_key_down_Space");
    let spawn = expressions(handler)
        .into_iter()
        .find(|e| matches!(&e.kind, ExprKind::Builtin { function, .. } if function == "spawn"))
        .expect("a spawn");
    assert_eq!(spawn.ty, "entity_ref");
    let ExprKind::Builtin { args, .. } = &spawn.kind else {
        unreachable!()
    };
    let [literal] = args.as_slice() else {
        panic!("one argument")
    };
    assert_eq!(literal.ty, "prefab descriptor");
    let ExprKind::PrefabLiteral { prefab, params } = &literal.kind else {
        panic!("a prefab literal, got {:?}", literal.kind)
    };
    assert_eq!(prefab.as_str(), "src/main.mtek::Crate");
    assert_eq!(
        params
            .iter()
            .map(|p| (p.name.as_str(), p.value.ty.as_str()))
            .collect::<Vec<_>>(),
        [("origin", "vec3"), ("tint", "color"), ("life", "f32")]
    );
    // The written value is folded to a constant; the defaults are the prefab's.
    assert_eq!(
        params[0].value.kind,
        ExprKind::Const {
            value: Value::Vec3([1.0, 2.0, 3.0])
        }
    );
    assert_eq!(
        params[1].value.kind,
        ExprKind::Const {
            value: Value::Color([1.0, 0.0, 0.0, 1.0])
        }
    );
    assert_eq!(
        params[2].value.kind,
        ExprKind::Const {
            value: Value::F32(2.0)
        }
    );
}

#[test]
fn a_value_computed_at_run_time_stays_an_expression() {
    let program = lowered(SOURCE);
    let prefab = program.prefabs().next().expect("prefab");
    let handler = prefab
        .behaviors
        .iter()
        .find(|b| matches!(b.kind, BehaviorKind::Event { .. }))
        .expect("the handler");
    let spawn = expressions(handler)
        .into_iter()
        .find(|e| matches!(&e.kind, ExprKind::Builtin { function, .. } if function == "spawn"))
        .expect("a spawn");
    let ExprKind::Builtin { args, .. } = &spawn.kind else {
        unreachable!()
    };
    let ExprKind::PrefabLiteral { params, .. } = &args[0].kind else {
        panic!("a literal")
    };
    // origin reads the entity's position; life divides the param.
    assert!(matches!(
        &params[0].value.kind,
        ExprKind::Binary { op: "+", .. }
    ));
    assert!(matches!(
        &params[2].value.kind,
        ExprKind::Binary { op: "/", .. }
    ));
    assert!(matches!(
        &params[1].value.kind,
        ExprKind::Const {
            value: Value::Color(_)
        }
    ));
}

#[test]
fn a_named_entity_and_self_used_as_values_are_entity_refs_by_index() {
    let program = lowered(SOURCE);
    let scene = program.entry().expect("scene");
    // `state last: entity_ref = Floor;` initialises with the reference to entity 0.
    let last = scene.state.iter().find(|s| s.name == "last").expect("last");
    assert_eq!(last.ty, "entity_ref");
    assert_eq!(last.init.kind, ExprKind::EntityRef { entity: 0 });
    // In the prefab `self` is entity 0.
    let prefab = program.prefabs().next().expect("prefab");
    let kid = prefab.state.iter().find(|s| s.name == "kid").expect("kid");
    assert_eq!(kid.init.kind, ExprKind::EntityRef { entity: 0 });
    // `last == Floor` compares two references.
    let handler = behaviour(&program, "on_key_down_Space");
    let comparison = expressions(handler)
        .into_iter()
        .find(|e| matches!(&e.kind, ExprKind::Binary { op: "==", .. }))
        .expect("a comparison");
    let ExprKind::Binary { lhs, rhs, .. } = &comparison.kind else {
        unreachable!()
    };
    assert_eq!(
        (lhs.ty.as_str(), rhs.ty.as_str()),
        ("entity_ref", "entity_ref")
    );
    assert_eq!(rhs.kind, ExprKind::EntityRef { entity: 0 });
}

#[test]
fn destroy_and_alive_are_builtins_of_one_reference() {
    let program = lowered(SOURCE);
    let handler = behaviour(&program, "on_key_down_Space");
    let destroy = expressions(handler)
        .into_iter()
        .find(|e| matches!(&e.kind, ExprKind::Builtin { function, .. } if function == "destroy"))
        .expect("a destroy");
    let ExprKind::Builtin { args, .. } = &destroy.kind else {
        unreachable!()
    };
    assert_eq!(args.len(), 1);
    assert_eq!(args[0].ty, "entity_ref");
}

#[test]
fn a_static_instances_copy_of_a_handler_refers_to_the_instance_by_its_index() {
    let source = r#"
prefab Crate {
    mesh: Box {};
    on key_down(Key.Enter) { destroy(self); }
}
scene Demo {
    camera Main {}
    entity Other { mesh: Box {}; }
    entity Mine: Crate {}
}
"#;
    let program = lowered(source);
    let handler = program
        .entry()
        .expect("scene")
        .behaviors
        .iter()
        .find(|b| b.symbol.as_str().ends_with("Mine.on_key_down_Enter"))
        .expect("the instance's handler");
    let destroy = expressions(handler)
        .into_iter()
        .find(|e| matches!(&e.kind, ExprKind::Builtin { function, .. } if function == "destroy"))
        .expect("a destroy");
    let ExprKind::Builtin { args, .. } = &destroy.kind else {
        unreachable!()
    };
    // `self` of the prefab (entity 0) became entity 1, the instance: destroying it is `E8030` at run time.
    assert_eq!(args[0].kind, ExprKind::EntityRef { entity: 1 });
}
