//! Game flow checks (decisions 0141, 0142, 0145 and 0146): the scene argument of `go_to`, `shared state`
//! and persistent (`saved` and `setting`) state.
//!
//! * `go_to(Scene)` names a scene of the program (`E5201` for anything else). Only that argument
//!   is a scene name with a type of its own ([`Ty::SceneName`]); a scene is not a value anywhere
//!   else.
//! * `shared state name: T = v;` is a scene member (`E5202` in an entity or a prefab), of a type
//!   whose values can be copied from one scene to the next: plain data, no `entity_ref` and no
//!   GPU resource (`E5203`). Two scenes that declare a shared state of the same name declare it
//!   with one type (`E5204`), so the value always fits where it carries over to.
//! * `saved state` and `setting state` are scene members too (`E5210`), of a type that can be
//!   stored (`E5211`, the same plain data). All scenes share one store keyed by the state's name,
//!   so one name has one type and one kind in every scene (`E5212`).

use std::collections::{BTreeMap, BTreeSet};

use super::check::Checker;
use super::prefab::strip_parens;
use super::ty::{Ty, TyId};
use crate::diagnostics::{Code, Diagnostic};
use crate::resolve::{DefKind, Res};
use crate::source::Span;
use crate::syntax::ast::{
    EntityDecl, EntityMember, Expr, ExprKind, ItemKind, Module, Persist, SceneMember, StateDecl,
};

impl Checker<'_> {
    /// The argument of a `go_to` call: one name of a scene. Records it so that the name types as
    /// a scene name and answers `true`; otherwise reports `E5201` and answers `false`. A call with
    /// another number of arguments is left to the arity check (`E3002`).
    pub(super) fn go_to_argument(&mut self, args: &[Expr]) -> bool {
        let [arg] = args else {
            return true;
        };
        let target = strip_parens(arg);
        if let ExprKind::Name(_) = &target.kind
            && let Some(Res::Def(id)) = self.res.res(target.id)
            && self.res.def(id).is_some_and(|d| d.kind == DefKind::Scene)
        {
            self.scene_arguments.insert(target.id);
            if target.id != arg.id {
                self.scene_arguments.insert(arg.id);
            }
            return true;
        }
        let scenes: Vec<String> = self
            .res
            .defs()
            .iter()
            .filter(|d| d.kind == DefKind::Scene)
            .map(|d| format!("'{}'", d.name))
            .collect();
        let found = match &target.kind {
            ExprKind::Name(_) => match self.res.res(target.id) {
                Some(Res::Def(id)) => self.res.def(id).map_or_else(
                    || "a name".to_owned(),
                    |d| format!("the {} '{}'", d.kind.noun(), d.name),
                ),
                _ => "a name that is not a scene".to_owned(),
            },
            ExprKind::Str { .. } => "a string".to_owned(),
            _ => "an expression".to_owned(),
        };
        let mut diagnostic = Diagnostic::new(
            Code::E5201,
            format!("`go_to` takes the name of a scene, but its argument is {found}."),
        )
        .at(arg.span)
        .expected("the name of a scene")
        .actual(found)
        .note("the scene to switch to is fixed where `go_to` is written: every scene of the program is built ahead of time");
        diagnostic = if scenes.is_empty() {
            diagnostic.help("declare the scene with `scene Name { ... }` and write `go_to(Name);`")
        } else {
            diagnostic.help(format!(
                "the scenes of this module are {}",
                scenes.join(", ")
            ))
        };
        self.report(diagnostic);
        false
    }

    /// The `shared state` rules of the module: `E5202`, `E5203` and `E5204`.
    pub(super) fn shared_states(&mut self, module: &Module) {
        // name -> (type, the declaration that fixed it, the scene)
        let mut first: BTreeMap<String, (TyId, Span, String)> = BTreeMap::new();
        for item in &module.items {
            match &item.kind {
                ItemKind::Scene(scene) => {
                    for member in &scene.members {
                        match member {
                            SceneMember::State(state) if state.shared.is_some() => {
                                self.scene_shared_state(state, &scene.name.name, &mut first);
                            }
                            SceneMember::Entity(entity) => self.misplaced_shared_in(entity),
                            _ => {}
                        }
                    }
                }
                ItemKind::Prefab(prefab) => {
                    for member in &prefab.members {
                        match member {
                            EntityMember::State(state) => {
                                self.report_misplaced_shared(state, "a prefab");
                            }
                            EntityMember::Entity(child) => self.misplaced_shared_in(child),
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn misplaced_shared_in(&mut self, entity: &EntityDecl) {
        let mut pending = vec![entity];
        while let Some(entity) = pending.pop() {
            for member in &entity.members {
                match member {
                    EntityMember::State(state) => self.report_misplaced_shared(state, "an entity"),
                    EntityMember::Entity(child) => pending.push(child),
                    _ => {}
                }
            }
        }
    }

    /// `E5202` for `shared state` declared in an entity or prefab (`place`).
    fn report_misplaced_shared(&mut self, state: &StateDecl, place: &str) {
        let Some(word) = state.shared else {
            return;
        };
        self.report(
            Diagnostic::new(
                Code::E5202,
                format!(
                    "The state '{}' is declared `shared` in {place}; only scene state can be shared.",
                    state.name.name
                ),
            )
            .at(word)
            .note("shared state carries over `go_to` from one scene to the next; entities end with their scene")
            .help("move the state into the scene, or remove `shared`"),
        );
    }

    /// `E5203` and `E5204` for the shared state `state` of the scene `scene`.
    fn scene_shared_state(
        &mut self,
        state: &StateDecl,
        scene: &str,
        first: &mut BTreeMap<String, (TyId, Span, String)>,
    ) {
        let Some(def) = self.res.def_of(state.id) else {
            return;
        };
        let Some(ty) = self.out.locals.get(&def).copied() else {
            return;
        };
        if self.out.interner.is_error(ty) {
            return;
        }
        if let Some(part) = self.not_carryable(ty) {
            let name = self.display(ty);
            self.report(
                Diagnostic::new(
                    Code::E5203,
                    format!(
                        "The shared state '{}' has type {name}, whose values cannot carry over to another scene.",
                        state.name.name
                    ),
                )
                .at(state.ty.span)
                .expected("plain data: bool, numbers, vectors, quat, color, mat4, string, enums, and arrays and structs of these")
                .actual(name)
                .note(format!("{part} belongs to one scene and ends with it"))
                .help("keep plain values in shared state, for example a score, a level number or a name"),
            );
            return;
        }
        let name = state.name.name.clone();
        match first.get(&name) {
            None => {
                first.insert(name, (ty, state.ty.span, scene.to_owned()));
            }
            Some((other, span, other_scene)) if *other != ty => {
                let (span, other_scene) = (*span, other_scene.clone());
                let (this_name, other_name) = (self.display(ty), self.display(*other));
                self.report(
                    Diagnostic::new(
                        Code::E5204,
                        format!(
                            "The shared state '{name}' has type {this_name} in the scene '{scene}', but type {other_name} in the scene '{other_scene}'."
                        ),
                    )
                    .at(state.ty.span)
                    .expected(other_name.clone())
                    .actual(this_name)
                    .related(span, format!("'{name}' is declared as {other_name} here"))
                    .help("a shared state carries its value from scene to scene, so it has one type in every scene"),
                );
            }
            Some(_) => {}
        }
    }

    /// The `saved state` and `setting state` rules of the module (decisions 0145, 0146): `E5210`,
    /// `E5211` and `E5212`.
    pub(super) fn persistent_states(&mut self, module: &Module) {
        // name -> (type, kind, the declaration that fixed them, the scene)
        let mut first: BTreeMap<String, (TyId, Persist, Span, String)> = BTreeMap::new();
        for item in &module.items {
            match &item.kind {
                ItemKind::Scene(scene) => {
                    for member in &scene.members {
                        match member {
                            SceneMember::State(state) if state.persist.is_some() => {
                                self.scene_persistent_state(state, &scene.name.name, &mut first);
                            }
                            SceneMember::Entity(entity) => self.misplaced_persist_in(entity),
                            _ => {}
                        }
                    }
                }
                ItemKind::Prefab(prefab) => {
                    let mut pending: Vec<&EntityDecl> = Vec::new();
                    for member in &prefab.members {
                        match member {
                            EntityMember::State(state) => {
                                self.report_misplaced_persist(state, "a prefab");
                            }
                            EntityMember::Entity(child) => pending.push(child),
                            _ => {}
                        }
                    }
                    for child in pending {
                        self.misplaced_persist_in(child);
                    }
                }
                _ => {}
            }
        }
    }

    fn misplaced_persist_in(&mut self, entity: &EntityDecl) {
        let mut pending = vec![entity];
        while let Some(entity) = pending.pop() {
            for member in &entity.members {
                match member {
                    EntityMember::State(state) => {
                        self.report_misplaced_persist(state, "an entity");
                    }
                    EntityMember::Entity(child) => pending.push(child),
                    _ => {}
                }
            }
        }
    }

    /// `E5210` for `saved state` or `setting state` declared in an entity or prefab (`place`).
    fn report_misplaced_persist(&mut self, state: &StateDecl, place: &str) {
        let Some((persist, word)) = state.persist else {
            return;
        };
        let word_text = persist.word();
        self.report(
            Diagnostic::new(
                Code::E5210,
                format!(
                    "The state '{}' is declared `{word_text}` in {place}; only scene state can be kept in storage.",
                    state.name.name
                ),
            )
            .at(word)
            .note("an entity's state belongs to one entity, and entities come and go; saved values are stored by the name of a scene state")
            .help(format!("move the state into the scene, or remove `{word_text}`")),
        );
    }

    /// `E5211` and `E5212` for the persistent state `state` of the scene `scene`.
    fn scene_persistent_state(
        &mut self,
        state: &StateDecl,
        scene: &str,
        first: &mut BTreeMap<String, (TyId, Persist, Span, String)>,
    ) {
        let Some((persist, _)) = state.persist else {
            return;
        };
        let Some(def) = self.res.def_of(state.id) else {
            return;
        };
        let Some(ty) = self.out.locals.get(&def).copied() else {
            return;
        };
        if self.out.interner.is_error(ty) {
            return;
        }
        let word = persist.word();
        if let Some(part) = self.not_carryable(ty) {
            let name = self.display(ty);
            self.report(
                Diagnostic::new(
                    Code::E5211,
                    format!(
                        "The {word} state '{}' has type {name}, whose values cannot be stored.",
                        state.name.name
                    ),
                )
                .at(state.ty.span)
                .expected("plain data: bool, numbers, vectors, quat, color, mat4, string, enums, and arrays and structs of these")
                .actual(name)
                .note(format!("{part} exists only while the program runs"))
                .help("store plain values, for example a high score, a level number or a volume"),
            );
            return;
        }
        let name = state.name.name.clone();
        match first.get(&name) {
            None => {
                first.insert(name, (ty, persist, state.ty.span, scene.to_owned()));
            }
            Some((other, other_persist, span, other_scene))
                if *other != ty || *other_persist != persist =>
            {
                let (span, other_scene, other_word) =
                    (*span, other_scene.clone(), other_persist.word());
                let (this_name, other_name) = (self.display(ty), self.display(*other));
                let this = format!("{word} state of type {this_name}");
                let that = format!("{other_word} state of type {other_name}");
                self.report(
                    Diagnostic::new(
                        Code::E5212,
                        format!(
                            "'{name}' is a {this} in the scene '{scene}', but a {that} in the scene '{other_scene}'."
                        ),
                    )
                    .at(state.span)
                    .expected(that.clone())
                    .actual(this)
                    .related(span, format!("'{name}' is a {that} here"))
                    .note("all scenes of a program share one store, in which a value is kept by its name")
                    .help("give the state one kind and one type in every scene, or another name"),
                );
            }
            Some(_) => {}
        }
    }

    /// What in `ty` cannot be copied into another scene, if anything: an `entity_ref`, a GPU
    /// resource or a descriptor. Arrays and structs are visited with a worklist.
    pub(super) fn not_carryable(&self, ty: TyId) -> Option<String> {
        let interner = &self.out.interner;
        let mut pending = vec![ty];
        let mut seen = BTreeSet::new();
        while let Some(ty) = pending.pop() {
            if !seen.insert(ty) {
                continue;
            }
            match interner.get(ty) {
                Ty::Error
                | Ty::Unit
                | Ty::Bool
                | Ty::I32
                | Ty::U32
                | Ty::F32
                | Ty::Vec2
                | Ty::Vec3
                | Ty::Vec4
                | Ty::Mat4
                | Ty::Quat
                | Ty::Color
                | Ty::String
                | Ty::Enum(_)
                | Ty::UserEnum(_) => {}
                Ty::Array { element, .. } => pending.push(element),
                Ty::Struct(_) => {
                    if let Some(def) = interner.struct_def(ty) {
                        pending.extend(def.fields.iter().map(|(_, field)| *field));
                    }
                }
                Ty::EntityRef => return Some("an entity_ref".to_owned()),
                Ty::Mesh
                | Ty::Material
                | Ty::Texture
                | Ty::Sampler
                | Ty::GlbAsset
                | Ty::MaterialInstance(_) => {
                    return Some(format!("a {} resource", interner.display(ty)));
                }
                Ty::Record(_)
                | Ty::Schema(_)
                | Ty::Descriptor(_)
                | Ty::PrefabDescriptor
                | Ty::SceneName
                | Ty::TaggedEntities => return Some(format!("a {} value", interner.display(ty))),
            }
        }
        None
    }
}
