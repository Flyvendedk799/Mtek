//! Unit tests of prefabs in the typed IR (decision 0062): the prefab item, and the instantiation
//! of its static instances as entities of their scene.

use super::*;
use crate::project::ProjectRoot;
use crate::source::{MemFs, ProjectPath};

fn project(source: &str) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n",
    )
    .insert(ProjectPath::new("src/main.mtek").unwrap(), source);
    fs
}

fn lowered(source: &str) -> Result<Program, LowerError> {
    lower_to_ir(&crate::analyze(&ProjectRoot::at_base(), &project(source)))
}

const PREFABS: &str = r#"
const LIFT = 0.5;

prefab Lamp {
    param origin: vec3;
    param spin: f32 = 2.0;
    state hits: i32 = 0;
    position: bind(origin + vec3(0.0, LIFT, 0.0));
    scale: vec3(spin, spin, spin);
    visible: spin > 1.0;
    mesh: Box {};
    update(dt: f32) { self.rotation = quat.axis_angle(vec3(0.0, 1.0, 0.0), spin); }
    on key_down(Key.Space) { self.hits += 1; }
}

scene Demo {
    camera Main {}
    entity Plain { mesh: Box {}; position: bind(vec3(f32(Near.hits), 0.0, 0.0)); }
    entity Near: Lamp { origin: vec3(1.0, 0.0, 0.0); }
    entity Far: Lamp { origin: vec3(2.0, 0.0, 0.0); spin: 0.5; }
}
"#;

fn prefab_program() -> Program {
    lowered(PREFABS).expect("lowered")
}

fn demo(program: &Program) -> &Scene {
    program.entry().expect("entry scene")
}

#[test]
fn a_prefab_is_an_item_whose_entity_is_self_and_whose_param_reads_are_params() {
    let program = prefab_program();
    let prefab = program.prefabs().next().expect("a prefab");
    assert_eq!(prefab.symbol.as_str(), "src/main.mtek::Lamp");
    assert_eq!(
        prefab
            .params
            .iter()
            .map(|p| (p.name.as_str(), p.ty.as_str(), p.default.is_some()))
            .collect::<Vec<_>>(),
        [("origin", "vec3", false), ("spin", "f32", true)]
    );
    assert_eq!((prefab.entity.index, prefab.entity.parent), (0, None));
    assert_eq!(prefab.entity.symbol, prefab.symbol);
    // A value over the params is an expression for `init`, a binding is a binding.
    assert!(matches!(&prefab.entity.scale.source, Source::Expr(_)));
    assert!(matches!(&prefab.entity.visible.source, Source::Expr(_)));
    assert!(matches!(&prefab.entity.position.source, Source::Bound(0)));
    assert!(matches!(
        &prefab.entity.rotation.source,
        Source::Const(Value::Quat(_))
    ));
    // Every body is the body of entity 0.
    assert!(
        prefab
            .behaviors
            .iter()
            .all(|b| b.owner == (Owner::Entity { index: 0 }))
    );
    assert_eq!(prefab.state.len(), 1);
    assert_eq!(prefab.state[0].owner, Owner::Entity { index: 0 });
}

#[test]
fn an_instance_is_an_entity_with_the_prefabs_fields_over_its_params() {
    let program = prefab_program();
    let scene = demo(&program);
    let (near, far) = (&scene.entities[1], &scene.entities[2]);
    assert_eq!(near.symbol.as_str(), "src/main.mtek::Demo.Near");
    let instance = near.prefab.as_ref().expect("an instance");
    assert_eq!(instance.prefab.as_str(), "src/main.mtek::Lamp");
    assert_eq!(
        instance
            .params
            .iter()
            .map(|p| (p.name.as_str(), &p.value))
            .collect::<Vec<_>>(),
        [
            ("origin", &Value::Vec3([1.0, 0.0, 0.0])),
            ("spin", &Value::F32(2.0))
        ]
    );
    // The substituted `vec3(spin, spin, spin)` is a constant like any entity's scale.
    assert_eq!(near.scale.source, Source::Const(Value::Vec3([2.0; 3])));
    assert_eq!(far.scale.source, Source::Const(Value::Vec3([0.5; 3])));
    // A comparison over a param stays an expression, with the param replaced by the constant.
    let Source::Expr(visible) = &near.visible.source else {
        panic!("{:?}", near.visible.source);
    };
    let ExprKind::Binary { lhs, .. } = &visible.kind else {
        panic!("{visible:?}");
    };
    assert_eq!(
        lhs.kind,
        ExprKind::Const {
            value: Value::F32(2.0)
        }
    );
    assert!(near.mesh.is_some() && near.material.is_some());
    assert!(scene.entities[0].prefab.is_none());
}

#[test]
fn an_instances_state_behaviours_and_bindings_are_copies_owned_by_the_instance() {
    let program = prefab_program();
    let scene = demo(&program);
    let state: Vec<_> = scene
        .state
        .iter()
        .map(|s| (s.symbol.as_str(), s.owner))
        .collect();
    assert_eq!(
        state,
        [
            ("src/main.mtek::Demo.Near.hits", Owner::Entity { index: 1 }),
            ("src/main.mtek::Demo.Far.hits", Owner::Entity { index: 2 }),
        ]
    );
    let behaviors: Vec<_> = scene
        .behaviors
        .iter()
        .map(|b| (b.symbol.as_str(), b.owner))
        .collect();
    assert_eq!(
        behaviors,
        [
            (
                "src/main.mtek::Demo.Near.update",
                Owner::Entity { index: 1 }
            ),
            (
                "src/main.mtek::Demo.Near.on_key_down_Space",
                Owner::Entity { index: 1 }
            ),
            ("src/main.mtek::Demo.Far.update", Owner::Entity { index: 2 }),
            (
                "src/main.mtek::Demo.Far.on_key_down_Space",
                Owner::Entity { index: 2 }
            ),
        ]
    );
    // `spin` is the instance's constant in the copy of `update`.
    let Stmt::Assign { value, .. } = &scene.behaviors[2].body.stmts[0] else {
        panic!("{:?}", scene.behaviors[2].body);
    };
    let ExprKind::Builtin { args, .. } = &value.kind else {
        panic!("{value:?}");
    };
    assert_eq!(
        args[1].kind,
        ExprKind::Const {
            value: Value::F32(0.5)
        }
    );
}

#[test]
fn an_instances_bindings_follow_the_scenes_in_id_and_precede_them_in_order() {
    let program = prefab_program();
    let scene = demo(&program);
    let bindings: Vec<_> = scene
        .bindings
        .iter()
        .map(|b| (b.id, b.order, b.target.clone()))
        .collect();
    // The scene's own binding (Plain.position) keeps id 0 but is evaluated last: it reads the
    // state of an instance, and the instances' bindings read nothing of the scene's.
    let position = |entity| BindingTarget::Transform {
        entity,
        field: "position".to_owned(),
    };
    assert_eq!(
        bindings,
        [
            (0, 2, position(0)),
            (1, 0, position(1)),
            (2, 1, position(2))
        ]
    );
    assert!(matches!(
        &scene.entities[1].position.source,
        Source::Bound(1)
    ));
    assert!(matches!(
        &scene.entities[2].position.source,
        Source::Bound(2)
    ));
    assert_eq!(
        scene.bindings[1].symbol.as_str(),
        "src/main.mtek::Demo.bind_1"
    );
}

#[test]
fn the_order_of_the_prefab_and_the_scene_in_the_source_does_not_matter() {
    let reversed = PREFABS.replace("const LIFT = 0.5;", "");
    let (prefab, scene) = reversed.split_once("scene Demo").expect("both parts");
    let moved = format!("const LIFT = 0.5;\nscene Demo{scene}\n{prefab}");
    let a = prefab_program();
    let b = lowered(&moved).expect("lowered");
    let entity_names = |program: &Program| {
        demo(program)
            .entities
            .iter()
            .map(|e| (e.name.clone(), e.prefab.is_some()))
            .collect::<Vec<_>>()
    };
    assert_eq!(entity_names(&a), entity_names(&b));
    assert_eq!(demo(&a).bindings.len(), demo(&b).bindings.len());
}

#[test]
fn a_program_without_prefabs_has_no_prefab_items_and_no_instances() {
    let program =
        lowered("scene Demo { camera Main {} entity A { mesh: Box {}; } }").expect("lowered");
    assert_eq!(program.prefabs().count(), 0);
    assert!(demo(&program).entities.iter().all(|e| e.prefab.is_none()));
    let json = serde_json::to_string(&program).unwrap();
    assert!(!json.contains("\"prefab\""), "{json}");
}
