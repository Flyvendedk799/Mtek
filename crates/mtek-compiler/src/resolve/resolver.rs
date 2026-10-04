//! The resolver proper: one walk over the module that declares, looks up,
//! gates and reports.

use std::collections::BTreeMap;

use super::defs::{Def, DefId, DefKind, PreludeItem, Res, Resolution};
use super::gate::{
    Construct, binary_construct, construct_gate, gate_message, gate_note, is_implemented,
    unary_construct,
};
use super::imports::ImportBindings;
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::project::edit_distance;
use crate::source::Span;
use crate::stdlib::{Domain, Milestone, NamespaceMember, PreludeNameKind, Registry, registry};
use crate::syntax::ast::{
    ArrayLength, ArrayLengthKind, Block, ConstDecl, DescField, ElseBranch, EntityDecl,
    EntityMember, Expr, ExprKind, FieldInit, FieldValue, FnDecl, ForIter, Handler, HandlerArg,
    Ident, IfStmt, Item, ItemKind, LifecycleFn, MaterialDecl, MaterialMember, Module, NodeId,
    Param, ParamDecl, PrefabDecl, SceneDecl, SceneMember, SceneObject, Stmt, StructDecl, Type,
    TypeKind,
};

/// The reserved identifier (`spec/language.md` 2.1, `E0012`).
const UNDERSCORE: &str = "_";

/// What a scope belongs to; used for wording only.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ScopeKind {
    Module,
    Scene,
    Entity,
    Prefab,
    Material,
    Params,
    Block,
}

impl ScopeKind {
    fn noun(self) -> &'static str {
        match self {
            ScopeKind::Module => "module",
            ScopeKind::Scene => "scene",
            ScopeKind::Entity => "entity",
            ScopeKind::Prefab => "prefab",
            ScopeKind::Material => "material",
            ScopeKind::Params => "parameter list",
            ScopeKind::Block => "block",
        }
    }
}

struct Scope {
    kind: ScopeKind,
    names: BTreeMap<String, DefId>,
}

/// Which prelude item a name means when it denotes several (`color` is a
/// type and a namespace).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Want {
    /// An ordinary expression: the first of type, schema, enum, namespace,
    /// function.
    Value,
    /// The base of `name.member`: a namespace or enum first.
    Path,
}

pub(super) struct Resolver<'a> {
    registry: &'static Registry,
    sink: &'a mut Diagnostics,
    /// What the module's imported names denote ([`super::bind_imports`]).
    bindings: &'a ImportBindings,
    out: Resolution,
    scopes: Vec<Scope>,
    /// How many gated constructs enclose the current position. Inside one,
    /// nested constructs are not gated again: the outermost construct the
    /// build does not implement is reported, once.
    gated: u32,
    /// What `self` means here: the entity or prefab whose body this is.
    self_def: Option<DefId>,
    /// The length of the scope stack at the scene or prefab scope, the parent
    /// scope of every entity body in it (children do not see the scope of
    /// their parent entity: nesting is parenting, not inheritance,
    /// `spec/scenes.md` 4.3).
    body_base: usize,
    /// The material whose stage function is being resolved: names that
    /// stage code can never read there are captures (`E4040`).
    stage_material: Option<String>,
    /// The names of the scene state, scene objects and entities of every
    /// scene of the module, with a noun for messages: a stage that names
    /// one captures it (`E4040`, `spec/materials.md` section 3).
    scene_names: BTreeMap<String, &'static str>,
}

impl<'a> Resolver<'a> {
    pub(super) fn new(
        node_count: u32,
        bindings: &'a ImportBindings,
        sink: &'a mut Diagnostics,
    ) -> Self {
        let slots = node_count as usize;
        Self {
            registry: registry(),
            sink,
            bindings,
            out: Resolution {
                defs: Vec::new(),
                res: vec![None; slots],
                decls: vec![None; slots],
                entry_scene: None,
                imports: BTreeMap::new(),
            },
            scopes: Vec::new(),
            gated: 0,
            self_def: None,
            body_base: 0,
            stage_material: None,
            scene_names: BTreeMap::new(),
        }
    }

    pub(super) fn finish(self) -> Resolution {
        self.out
    }

    // ----- tables ----------------------------------------------------------

    fn set_res(&mut self, node: NodeId, res: Res) {
        if let Some(slot) = self.out.res.get_mut(node.index()) {
            *slot = Some(res);
        }
    }

    fn def(&self, id: DefId) -> Option<&Def> {
        self.out.defs.get(id.index())
    }

    /// What `id` declares; for an imported name, what its target declares.
    fn def_kind(&self, id: DefId) -> Option<DefKind> {
        let def = self.def(id)?;
        match def.kind {
            DefKind::Import => self.out.imports.get(&id).map(|target| target.kind),
            kind => Some(kind),
        }
    }

    /// What a name that denotes the declaration `id` resolves to: the
    /// declaration, or [`Res::Error`] for an imported name whose import was
    /// reported (it denotes nothing, and its uses must not be reported
    /// again).
    fn def_res(&self, id: DefId) -> Res {
        match self.def(id) {
            Some(def) if def.kind == DefKind::Import && !self.out.imports.contains_key(&id) => {
                Res::Error
            }
            _ => Res::Def(id),
        }
    }

    // ----- scopes ----------------------------------------------------------

    fn push(&mut self, kind: ScopeKind) {
        self.scopes.push(Scope {
            kind,
            names: BTreeMap::new(),
        });
    }

    fn pop(&mut self) {
        self.scopes.pop();
    }

    fn lookup(&self, name: &str) -> Option<DefId> {
        self.scopes
            .iter()
            .rev()
            .find_map(|scope| scope.names.get(name).copied())
    }

    /// Declare `name` in the innermost scope. Every declaration gets a
    /// [`DefId`], even one that is reported; a duplicate is not entered into
    /// the scope (its uses mean the first declaration).
    fn declare(
        &mut self,
        kind: DefKind,
        name: &Ident,
        node: NodeId,
        parent: Option<DefId>,
    ) -> Option<DefId> {
        if name.name.is_empty() {
            return None;
        }
        let id = DefId(u32::try_from(self.out.defs.len()).ok()?);
        self.out.defs.push(Def {
            id,
            kind,
            name: name.name.clone(),
            span: name.span,
            node,
            parent,
        });
        if let Some(slot) = self.out.decls.get_mut(node.index()) {
            *slot = Some(id);
        }
        self.set_res(name.id, Res::Def(id));

        if name.name == UNDERSCORE {
            self.report_underscore(name.span);
            return Some(id);
        }
        let Some(scope) = self.scopes.last() else {
            return Some(id);
        };
        if let Some(&first) = scope.names.get(&name.name) {
            let scope_kind = scope.kind;
            self.report_duplicate(kind, name, first, scope_kind);
            return Some(id);
        }
        if kind == DefKind::State
            && parent
                .and_then(|p| self.def_kind(p))
                .is_some_and(|p| matches!(p, DefKind::Entity | DefKind::Prefab))
            && self
                .registry
                .schema_field(self.registry.declaration_schemas.entity, &name.name)
                .is_some()
        {
            self.sink.push(
                Diagnostic::new(
                    Code::E2002,
                    format!(
                        "The state '{0}' has the name of the entity field '{0}'.",
                        name.name
                    ),
                )
                .at(name.span)
                .note(format!(
                    "every entity has the field '{0}' (schema {1}), so `self.{0}` would be ambiguous",
                    name.name, self.registry.declaration_schemas.entity
                ))
                .help("choose another name for the state"),
            );
        } else if let Some(earlier) = self.lookup(&name.name) {
            self.report_shadowing(kind, name, earlier);
        } else if let Some(kinds) = self.prelude_conflict(kind, &name.name) {
            self.report_prelude_shadowing(kind, name, &kinds);
        }
        if let Some(scope) = self.scopes.last_mut() {
            scope.names.insert(name.name.clone(), id);
        }
        Some(id)
    }

    /// The prelude meanings of `name` that a declaration of `kind` may not
    /// reuse (`spec/language.md` 4.2), or `None` if the declaration is fine.
    fn prelude_conflict(&self, kind: DefKind, name: &str) -> Option<Vec<PreludeNameKind>> {
        let kinds = self.registry.prelude_name_kinds(name);
        if kinds.is_empty() {
            return None;
        }
        // A local, parameter, `state` or `param` may reuse a prelude function.
        if kinds.iter().all(|k| *k == PreludeNameKind::Function) && kind.may_hide_prelude_function()
        {
            return None;
        }
        // A material or prefab `param` may share its name with a prelude type
        // (which may also be a namespace, as `color` is).
        if kind == DefKind::Param
            && kinds.contains(&PreludeNameKind::Type)
            && kinds
                .iter()
                .all(|k| matches!(k, PreludeNameKind::Type | PreludeNameKind::Namespace))
        {
            return None;
        }
        Some(kinds)
    }

    // ----- diagnostics -----------------------------------------------------

    fn report_underscore(&mut self, span: Span) {
        self.sink.push(
            Diagnostic::new(Code::E0012, "`_` is reserved and cannot be used as a name.")
                .at(span)
                .help("choose a descriptive name"),
        );
    }

    fn report_duplicate(&mut self, kind: DefKind, name: &Ident, first: DefId, scope: ScopeKind) {
        let (first_kind, first_span) = match self.def(first) {
            Some(def) => (def.kind, def.span),
            None => return,
        };
        let first_noun = first_kind.noun();
        if kind == DefKind::Import && first_kind == DefKind::Import {
            self.sink.push(
                Diagnostic::new(
                    Code::E2002,
                    format!(
                        "Duplicate import of '{}': the name is already imported in this module.",
                        name.name
                    ),
                )
                .at(name.span)
                .related(
                    first_span,
                    format!("'{}' is first imported here", name.name),
                )
                .help("import each name once"),
            );
            return;
        }
        let mut diagnostic = Diagnostic::new(
            Code::E2002,
            format!(
                "Duplicate declaration of '{}': {} of that name is already declared in this {}.",
                name.name,
                with_article(first_noun),
                scope.noun()
            ),
        )
        .at(name.span)
        .related(
            first_span,
            format!("the {first_noun} '{}' is first declared here", name.name),
        );
        if scope == ScopeKind::Scene && (kind == DefKind::Entity || first_kind == DefKind::Entity) {
            diagnostic = diagnostic.note(
                "entity names are unique within the scene, including nested entities, and share the scene scope with state and cameras",
            );
        }
        self.sink.push(diagnostic);
    }

    fn report_shadowing(&mut self, kind: DefKind, name: &Ident, earlier: DefId) {
        let Some(def) = self.def(earlier) else {
            return;
        };
        let (earlier_noun, earlier_span) = (def.kind.noun(), def.span);
        self.sink.push(
            Diagnostic::new(
                Code::E2001,
                format!(
                    "The {} '{}' shadows the {earlier_noun} '{}' of an enclosing scope.",
                    kind.noun(),
                    name.name,
                    name.name
                ),
            )
            .at(name.span)
            .related(
                earlier_span,
                format!("the {earlier_noun} '{}' is declared here", name.name),
            )
            .help("names cannot be shadowed in v0.1; choose another name"),
        );
    }

    fn report_prelude_shadowing(&mut self, kind: DefKind, name: &Ident, kinds: &[PreludeNameKind]) {
        let what = prelude_kinds_noun(kinds);
        let mut diagnostic = Diagnostic::new(
            Code::E2001,
            format!(
                "The {} '{}' would hide the built-in {what} '{}'.",
                kind.noun(),
                name.name,
                name.name
            ),
        )
        .at(name.span)
        .note(format!(
            "'{}' is a built-in {what} of the standard library, visible in every module",
            name.name
        ));
        if kinds.iter().all(|k| *k == PreludeNameKind::Function) {
            diagnostic = diagnostic.note(
                "only locals, parameters, `state` and `param` declarations may reuse the name of a built-in function",
            );
        }
        self.sink
            .push(diagnostic.help("names cannot be shadowed in v0.1; choose another name"));
    }

    /// Report an unknown name: `message` with a "did you mean" when exactly
    /// one candidate is within edit distance 2. A declared candidate gets a
    /// related span; a built-in one, which has no span, a note.
    fn report_unknown(
        &mut self,
        code: Code,
        message: String,
        span: Span,
        name: &str,
        candidates: &BTreeMap<String, Option<Span>>,
    ) {
        let mut diagnostic = Diagnostic::new(code, message).at(span);
        if let Some((candidate, at)) = single_candidate(name, candidates) {
            diagnostic = match at {
                Some(at) => diagnostic.related(at, format!("did you mean '{candidate}'?")),
                None => diagnostic.help(format!("did you mean the built-in '{candidate}'?")),
            };
        }
        self.sink.push(diagnostic);
    }

    // ----- gating ----------------------------------------------------------

    /// Report `E9010` for something planned for `since` unless the build
    /// implements it or an enclosing construct was already reported. Returns
    /// whether it was reported.
    fn report_gate(&mut self, subject: &str, plural: bool, since: Milestone, span: Span) -> bool {
        if self.gated > 0 || is_implemented(since) {
            return false;
        }
        self.sink.push(
            Diagnostic::new(Code::E9010, gate_message(subject, plural, since))
                .at(span)
                .note(gate_note()),
        );
        true
    }

    /// Like [`Self::report_gate`], and if reported, everything until the
    /// matching [`Self::leave`] is inside a gated construct.
    fn enter_gate(&mut self, subject: &str, plural: bool, since: Milestone, span: Span) -> bool {
        let entered = self.report_gate(subject, plural, since, span);
        if entered {
            self.gated += 1;
        }
        entered
    }

    fn enter(&mut self, construct: Construct, span: Span) -> bool {
        let gate = construct_gate(construct);
        self.enter_gate(gate.subject, gate.plural, gate.since, span)
    }

    fn leave(&mut self, entered: bool) {
        if entered {
            self.gated = self.gated.saturating_sub(1);
        }
    }

    /// Gate a field of a registry schema by the field's `since`. Fields the
    /// schema does not have are left to the schema checks (`E5001`).
    fn enter_field(&mut self, schema: &str, field: &Ident, span: Span) -> bool {
        let Some(def) = self.registry.schema_field(schema, &field.name) else {
            return false;
        };
        let subject = format!("The `{schema}` field `{}`", def.name);
        self.enter_gate(&subject, false, def.since, span)
    }

    fn prelude_since(&self, item: PreludeItem) -> Option<Milestone> {
        item.since()
    }

    /// Gate the use of a prelude item by its registry `since`.
    fn enter_prelude(&mut self, item: PreludeItem, span: Span) -> bool {
        let Some(since) = self.prelude_since(item) else {
            return false;
        };
        let subject = match item {
            PreludeItem::Type(name) => format!("The built-in type `{name}`"),
            PreludeItem::Schema(name) => format!("The built-in schema `{name}`"),
            PreludeItem::Enum(name) => format!("The built-in enum `{name}`"),
            PreludeItem::Namespace(name) => format!("The built-in namespace `{name}`"),
            PreludeItem::Function(name) => format!("The built-in function `{name}`"),
            PreludeItem::NamespaceMember { namespace, member } => {
                format!("The built-in `{namespace}.{member}`")
            }
            PreludeItem::EnumMember { enum_name, member } => {
                format!("The built-in `{enum_name}.{member}`")
            }
            PreludeItem::SceneObject(keyword) => format!("The scene object kind `{keyword}`"),
            PreludeItem::Event(name) => format!("The event `{name}`"),
        };
        self.enter_gate(&subject, false, since, span)
    }

    fn gate_prelude(&mut self, item: PreludeItem, span: Span) {
        let entered = self.enter_prelude(item, span);
        self.leave(entered);
    }

    // ----- prelude names ---------------------------------------------------

    /// The registry item of kind `kind` named `name`, with the registry's own
    /// `'static` spelling.
    fn prelude_item(&self, name: &str, kind: PreludeNameKind) -> Option<PreludeItem> {
        let registry = self.registry;
        Some(match kind {
            PreludeNameKind::Type => PreludeItem::Type(registry.type_def(name)?.name),
            PreludeNameKind::Schema => PreludeItem::Schema(registry.schema(name)?.name),
            PreludeNameKind::Enum => PreludeItem::Enum(registry.enum_def(name)?.name),
            PreludeNameKind::Namespace => PreludeItem::Namespace(registry.namespace(name)?.name),
            PreludeNameKind::Function => PreludeItem::Function(registry.intrinsic(name)?.name),
        })
    }

    fn prelude_lookup(&self, name: &str, want: Want) -> Option<PreludeItem> {
        let kinds = self.registry.prelude_name_kinds(name);
        let preferred = match want {
            Want::Path => kinds
                .iter()
                .copied()
                .find(|k| matches!(k, PreludeNameKind::Namespace | PreludeNameKind::Enum)),
            Want::Value => None,
        };
        let kind = preferred.or_else(|| kinds.first().copied())?;
        self.prelude_item(name, kind)
    }

    /// Every name visible here, innermost first, then the prelude: the
    /// candidates for "did you mean".
    fn visible_names(
        &self,
        keep: impl Fn(Option<DefKind>) -> bool,
    ) -> BTreeMap<String, Option<Span>> {
        let mut names = BTreeMap::new();
        for scope in self.scopes.iter().rev() {
            for (name, &id) in &scope.names {
                if keep(self.def_kind(id)) {
                    let span = self.def(id).map(|def| def.span);
                    names.entry(name.clone()).or_insert(span);
                }
            }
        }
        names
    }

    // ----- module ----------------------------------------------------------

    pub(super) fn module(&mut self, module: &Module) {
        self.collect_scene_names(module);
        self.push(ScopeKind::Module);
        for item in &module.items {
            self.declare_item(item);
        }
        for item in &module.items {
            self.item(item);
        }
        self.pop();
    }

    /// The names scene bodies declare, for `E4040` in stage functions (an
    /// explicit worklist over nested entities).
    fn collect_scene_names(&mut self, module: &Module) {
        let mut entities: Vec<&EntityDecl> = Vec::new();
        for item in &module.items {
            let ItemKind::Scene(scene) = &item.kind else {
                continue;
            };
            for member in &scene.members {
                match member {
                    SceneMember::State(state) => {
                        self.scene_names
                            .entry(state.name.name.clone())
                            .or_insert("scene state");
                    }
                    SceneMember::Object(object) => {
                        let noun = self
                            .registry
                            .scene_object(&object.kind.name)
                            .map_or("scene object", |kind| kind.keyword);
                        self.scene_names
                            .entry(object.name.name.clone())
                            .or_insert(noun);
                    }
                    SceneMember::Entity(entity) => entities.push(entity),
                    _ => {}
                }
            }
        }
        while let Some(entity) = entities.pop() {
            self.scene_names
                .entry(entity.name.name.clone())
                .or_insert("entity");
            for member in &entity.members {
                match member {
                    EntityMember::State(state) => {
                        self.scene_names
                            .entry(state.name.name.clone())
                            .or_insert("entity state");
                    }
                    EntityMember::Entity(child) => entities.push(child),
                    _ => {}
                }
            }
        }
    }

    /// `E4040` for a name stage code can never read (`spec/materials.md`
    /// section 3): `what` is "the entity 'Cube'", "`frame.time`".
    fn report_capture(&mut self, what: &str, span: Span) {
        let material = self.stage_material.clone().unwrap_or_default();
        self.sink.push(
            Diagnostic::new(
                Code::E4040,
                format!("The fragment stage of material '{material}' cannot read {what}."),
            )
            .at(span)
            .note("stage code may read only its input, the material's params, and constants and `fn`s that exist on the GPU")
            .note(super::STAGE_CAPTURE_NOTE),
        );
    }

    fn declare_item(&mut self, item: &Item) {
        match &item.kind {
            ItemKind::Import(decl) => {
                for name in &decl.names {
                    let id = self.declare(DefKind::Import, name, name.id, None);
                    if let (Some(id), Some(target)) = (id, self.bindings.get(&name.id)) {
                        self.out.imports.insert(id, *target);
                    }
                }
            }
            ItemKind::Const(decl) => {
                self.declare(DefKind::Const, &decl.name, decl.id, None);
            }
            ItemKind::Fn(decl) => {
                self.declare(DefKind::Fn, &decl.name, decl.id, None);
            }
            ItemKind::Struct(decl) => {
                self.declare(DefKind::Struct, &decl.name, decl.id, None);
            }
            ItemKind::Material(decl) => {
                self.declare(DefKind::Material, &decl.name, decl.id, None);
            }
            ItemKind::Prefab(decl) => {
                self.declare(DefKind::Prefab, &decl.name, decl.id, None);
            }
            ItemKind::Scene(decl) => {
                self.declare(DefKind::Scene, &decl.name, decl.id, None);
            }
            ItemKind::Error => {}
        }
    }

    fn item(&mut self, item: &Item) {
        let construct = match &item.kind {
            ItemKind::Import(_) => Construct::Import,
            ItemKind::Const(_) => Construct::ConstItem,
            ItemKind::Fn(decl) if decl.cpu => Construct::CpuFn,
            ItemKind::Fn(_) => Construct::Fn,
            ItemKind::Struct(_) => Construct::Struct,
            ItemKind::Material(_) => Construct::Material,
            ItemKind::Prefab(_) => Construct::Prefab,
            ItemKind::Scene(_) => Construct::Scene,
            ItemKind::Error => return,
        };
        if item.export && is_implemented(construct_gate(construct).since) {
            // The keyword is the first six bytes of the item.
            let start = item.span.start;
            let end = start.saturating_add(6).min(item.span.end);
            let keyword = Span::new(item.span.file, start, end);
            let gate = construct_gate(Construct::Export);
            self.report_gate(gate.subject, gate.plural, gate.since, keyword);
        }
        let entered = self.enter(construct, item.span);
        match &item.kind {
            ItemKind::Import(_) | ItemKind::Error => {}
            ItemKind::Const(decl) => self.const_body(decl),
            ItemKind::Fn(decl) => self.function(decl),
            ItemKind::Struct(decl) => self.structure(decl),
            ItemKind::Material(decl) => self.material(decl),
            ItemKind::Prefab(decl) => self.prefab(decl),
            ItemKind::Scene(decl) => self.scene(decl),
        }
        self.leave(entered);
    }

    fn const_body(&mut self, decl: &ConstDecl) {
        if let Some(ty) = &decl.ty {
            self.ty(ty);
        }
        self.expr(&decl.value);
    }

    fn function(&mut self, decl: &FnDecl) {
        let owner = self.out.def_of(decl.id);
        let saved_self = self.self_def.take();
        self.push(ScopeKind::Params);
        self.params(&decl.params, owner);
        if let Some(ret) = &decl.ret {
            self.ty(ret);
        }
        self.block(&decl.body);
        self.pop();
        self.self_def = saved_self;
    }

    /// Parameters: their types (which do not see the parameters), then the
    /// names, into the innermost scope.
    fn params(&mut self, params: &[Param], owner: Option<DefId>) {
        for param in params {
            self.ty(&param.ty);
            self.declare(DefKind::FnParam, &param.name, param.id, owner);
        }
    }

    fn structure(&mut self, decl: &StructDecl) {
        for field in &decl.fields {
            self.set_res(field.name.id, Res::Field);
            self.ty(&field.ty);
        }
    }

    fn material(&mut self, decl: &MaterialDecl) {
        let owner = self.out.def_of(decl.id);
        let saved_self = self.self_def.take();
        self.push(ScopeKind::Material);
        for member in &decl.members {
            if let MaterialMember::Param(param) = member {
                self.declare(DefKind::Param, &param.name, param.id, owner);
            }
        }
        for member in &decl.members {
            match member {
                MaterialMember::Param(param) => self.param_body(param),
                MaterialMember::Stage(stage) => {
                    self.push(ScopeKind::Params);
                    self.params(&stage.params, owner);
                    if let Some(ret) = &stage.ret {
                        self.ty(ret);
                    }
                    let saved = self.stage_material.replace(decl.name.name.clone());
                    self.block(&stage.body);
                    self.stage_material = saved;
                    self.pop();
                }
                MaterialMember::Error(_) => {}
            }
        }
        self.pop();
        self.self_def = saved_self;
    }

    fn param_body(&mut self, param: &ParamDecl) {
        self.ty(&param.ty);
        if let Some(default) = &param.default {
            self.expr(default);
        }
    }

    // ----- scenes, entities, prefabs ----------------------------------------

    fn scene(&mut self, decl: &SceneDecl) {
        let owner = self.out.def_of(decl.id);
        let saved_self = self.self_def.take();
        self.push(ScopeKind::Scene);
        let saved_base = std::mem::replace(&mut self.body_base, self.scopes.len());
        // State, entities (flat, at every depth), cameras and constants share
        // the scene scope, and their order does not matter.
        for member in &decl.members {
            match member {
                SceneMember::Const(c) => {
                    self.declare(DefKind::Const, &c.name, c.id, owner);
                }
                SceneMember::State(s) => {
                    self.declare(DefKind::State, &s.name, s.id, owner);
                }
                SceneMember::Object(object) => {
                    let kind = self
                        .registry
                        .scene_object(&object.kind.name)
                        .map(|k| k.keyword);
                    self.declare(
                        DefKind::SceneObject { kind },
                        &object.name,
                        object.id,
                        owner,
                    );
                }
                SceneMember::Entity(entity) => self.declare_entity_tree(entity, owner),
                SceneMember::Field(_)
                | SceneMember::Lifecycle(_)
                | SceneMember::Handler(_)
                | SceneMember::Error(_) => {}
            }
        }
        for member in &decl.members {
            match member {
                SceneMember::Field(field) => {
                    self.field_init(
                        field,
                        Some(self.registry.declaration_schemas.scene),
                        Some(Construct::SceneField),
                    );
                }
                SceneMember::Const(c) => self.body_const(c),
                SceneMember::State(s) => self.state(s.span, &s.ty, &s.value),
                SceneMember::Object(object) => self.scene_object(object),
                SceneMember::Entity(entity) => self.entity(entity),
                SceneMember::Lifecycle(lifecycle) => self.lifecycle(lifecycle, owner),
                SceneMember::Handler(handler) => self.handler(handler, owner),
                SceneMember::Error(_) => {}
            }
        }
        self.body_base = saved_base;
        self.pop();
        self.self_def = saved_self;
    }

    /// Declare an entity and, recursively, the entities nested in it, in the
    /// current (scene or prefab) scope, depth-first in declaration order.
    fn declare_entity_tree(&mut self, entity: &EntityDecl, parent: Option<DefId>) {
        let id = self.declare(DefKind::Entity, &entity.name, entity.id, parent);
        for member in &entity.members {
            if let EntityMember::Entity(child) = member {
                self.declare_entity_tree(child, id.or(parent));
            }
        }
    }

    fn body_const(&mut self, decl: &ConstDecl) {
        let entered = self.enter(Construct::BodyConst, decl.span);
        self.const_body(decl);
        self.leave(entered);
    }

    fn state(&mut self, span: Span, ty: &Type, value: &Expr) {
        let entered = self.enter(Construct::State, span);
        self.ty(ty);
        self.expr(value);
        self.leave(entered);
    }

    fn field_init(
        &mut self,
        field: &FieldInit,
        schema: Option<&str>,
        construct: Option<Construct>,
    ) {
        self.set_res(field.name.id, Res::Field);
        let construct_entered = match construct {
            Some(construct) => self.enter(construct, field.span),
            None => false,
        };
        let field_entered = match schema {
            Some(schema) => self.enter_field(schema, &field.name, field.span),
            None => false,
        };
        self.field_value(&field.value);
        self.leave(field_entered);
        self.leave(construct_entered);
    }

    fn field_value(&mut self, value: &FieldValue) {
        match value {
            FieldValue::Expr(expr) => self.expr(expr),
            FieldValue::Bind(bind) => {
                let entered = self.enter(Construct::Bind, bind.span);
                self.expr(&bind.source);
                self.leave(entered);
            }
        }
    }

    fn scene_object(&mut self, object: &SceneObject) {
        let entered = self.enter(Construct::SceneObject, object.span);
        let kind = self.registry.scene_object(&object.kind.name);
        let (schema, kind_entered) = match kind {
            Some(kind) => {
                let item = PreludeItem::SceneObject(kind.keyword);
                self.set_res(object.kind.id, Res::Prelude(item));
                (Some(kind.schema), self.enter_prelude(item, object.span))
            }
            None => {
                self.set_res(object.kind.id, Res::Error);
                let kinds: Vec<&str> = self
                    .registry
                    .scene_objects
                    .iter()
                    .map(|k| k.keyword)
                    .collect();
                self.sink.push(
                    Diagnostic::new(
                        Code::E5014,
                        format!("Unknown scene object kind '{}'.", object.kind.name),
                    )
                    .at(object.kind.span)
                    .help(format!("v0.1 scene object kinds: {}", kinds.join(", "))),
                );
                (None, false)
            }
        };
        for field in &object.fields {
            self.field_init(field, schema, None);
        }
        self.leave(kind_entered);
        self.leave(entered);
    }

    fn entity(&mut self, entity: &EntityDecl) {
        let owner = self.out.def_of(entity.id);
        let base = self.body_base.min(self.scopes.len());
        let outer = self.scopes.split_off(base);
        let saved_self = std::mem::replace(&mut self.self_def, owner);

        let entered = self.enter(Construct::Entity, entity.span);
        let instance = match &entity.prefab {
            Some(prefab) => {
                self.prefab_ref(prefab);
                self.enter(Construct::PrefabInstance, entity.span)
            }
            None => false,
        };
        self.push(ScopeKind::Entity);
        self.declare_body_members(&entity.members, owner);
        // The fields of a prefab instance are the prefab's params.
        let (schema, construct) = if entity.prefab.is_some() {
            (None, None)
        } else {
            (
                Some(self.registry.declaration_schemas.entity),
                Some(Construct::EntityField),
            )
        };
        for member in &entity.members {
            self.entity_member(member, owner, schema, construct);
        }
        self.pop();
        self.leave(instance);
        self.leave(entered);

        self.self_def = saved_self;
        self.scopes.extend(outer);
    }

    /// Declare the `state`, `const` and `param` members of an entity or
    /// prefab body in the innermost scope (nested entities live in the scene
    /// or prefab scope).
    fn declare_body_members(&mut self, members: &[EntityMember], owner: Option<DefId>) {
        for member in members {
            match member {
                EntityMember::State(s) => {
                    self.declare(DefKind::State, &s.name, s.id, owner);
                }
                EntityMember::Const(c) => {
                    self.declare(DefKind::Const, &c.name, c.id, owner);
                }
                EntityMember::Param(p) => {
                    self.declare(DefKind::Param, &p.name, p.id, owner);
                }
                EntityMember::Field(_)
                | EntityMember::Entity(_)
                | EntityMember::Lifecycle(_)
                | EntityMember::Handler(_)
                | EntityMember::Error(_) => {}
            }
        }
    }

    fn entity_member(
        &mut self,
        member: &EntityMember,
        owner: Option<DefId>,
        schema: Option<&str>,
        construct: Option<Construct>,
    ) {
        match member {
            EntityMember::Field(field) => self.field_init(field, schema, construct),
            EntityMember::Const(c) => self.body_const(c),
            EntityMember::State(s) => self.state(s.span, &s.ty, &s.value),
            EntityMember::Param(p) => self.param_body(p),
            EntityMember::Entity(child) => self.entity(child),
            EntityMember::Lifecycle(lifecycle) => self.lifecycle(lifecycle, owner),
            EntityMember::Handler(handler) => self.handler(handler, owner),
            EntityMember::Error(_) => {}
        }
    }

    fn prefab(&mut self, decl: &PrefabDecl) {
        let owner = self.out.def_of(decl.id);
        let saved_self = std::mem::replace(&mut self.self_def, owner);
        self.push(ScopeKind::Prefab);
        let saved_base = std::mem::replace(&mut self.body_base, self.scopes.len());
        self.declare_body_members(&decl.members, owner);
        for member in &decl.members {
            if let EntityMember::Entity(child) = member {
                // `E5040` (a prefab describes one entity) is the checker's.
                self.declare_entity_tree(child, owner);
            }
        }
        for member in &decl.members {
            self.entity_member(
                member,
                owner,
                Some(self.registry.declaration_schemas.entity),
                Some(Construct::EntityField),
            );
        }
        self.body_base = saved_base;
        self.pop();
        self.self_def = saved_self;
    }

    fn prefab_ref(&mut self, name: &Ident) {
        if name.name == UNDERSCORE {
            self.report_underscore(name.span);
            self.set_res(name.id, Res::Error);
            return;
        }
        let res = match self.lookup(&name.name) {
            Some(id) => self.def_res(id),
            None => {
                let candidates = self.visible_names(|k| k == Some(DefKind::Prefab));
                self.report_unknown(
                    Code::E2003,
                    format!("Unknown prefab '{}'.", name.name),
                    name.span,
                    &name.name,
                    &candidates,
                );
                Res::Error
            }
        };
        self.set_res(name.id, res);
    }

    fn lifecycle(&mut self, lifecycle: &LifecycleFn, owner: Option<DefId>) {
        let entered = self.enter(Construct::LifecycleFn, lifecycle.span);
        self.push(ScopeKind::Params);
        self.params(&lifecycle.params, owner);
        self.block(&lifecycle.body);
        self.pop();
        self.leave(entered);
    }

    fn handler(&mut self, handler: &Handler, owner: Option<DefId>) {
        let gate = construct_gate(Construct::Handler);
        let event = self.registry.event(&handler.event.name);
        let (subject, since) = match event {
            Some(event) => {
                self.set_res(
                    handler.event.id,
                    Res::Prelude(PreludeItem::Event(event.name)),
                );
                (
                    format!("{} (`on {}`)", gate.subject, event.name),
                    gate.since.max(event.since),
                )
            }
            // An event the registry does not know is `E5060`, the checker's.
            None => (gate.subject.to_owned(), gate.since),
        };
        let entered = self.enter_gate(&subject, gate.plural, since, handler.span);
        for arg in &handler.args {
            if let HandlerArg::Filter(filter) = arg {
                self.expr(filter);
            }
        }
        self.push(ScopeKind::Params);
        for arg in &handler.args {
            if let HandlerArg::Param(param) = arg {
                self.ty(&param.ty);
                self.declare(DefKind::FnParam, &param.name, param.id, owner);
            }
        }
        self.block(&handler.body);
        self.pop();
        self.leave(entered);
    }

    // ----- statements ------------------------------------------------------

    fn block(&mut self, block: &Block) {
        self.push(ScopeKind::Block);
        for stmt in &block.stmts {
            self.stmt(stmt);
        }
        self.pop();
    }

    fn stmt(&mut self, stmt: &Stmt) {
        match stmt {
            Stmt::Let(decl) | Stmt::Var(decl) => {
                if let Some(ty) = &decl.ty {
                    self.ty(ty);
                }
                // The local is visible from the end of its declaration.
                self.expr(&decl.value);
                let mutable = matches!(stmt, Stmt::Var(_));
                self.declare(DefKind::Local { mutable }, &decl.name, decl.id, None);
            }
            Stmt::Const(decl) => {
                self.const_body(decl);
                self.declare(DefKind::Const, &decl.name, decl.id, None);
            }
            Stmt::If(stmt) => self.if_stmt(stmt),
            Stmt::For(stmt) => {
                match &stmt.iter {
                    ForIter::Range { start, end } => {
                        self.expr(start);
                        self.expr(end);
                    }
                    ForIter::Each(array) => self.expr(array),
                }
                self.push(ScopeKind::Block);
                self.declare(DefKind::LoopVar, &stmt.var, stmt.id, None);
                self.block(&stmt.body);
                self.pop();
            }
            Stmt::Return(stmt) => {
                if let Some(value) = &stmt.value {
                    self.expr(value);
                }
            }
            Stmt::Break(_) | Stmt::Continue(_) | Stmt::Error(_) => {}
            Stmt::Block(block) => self.block(block),
            Stmt::Assign(stmt) => {
                self.expr(&stmt.target);
                self.expr(&stmt.value);
            }
            Stmt::Expr(stmt) => self.expr(&stmt.expr),
        }
    }

    fn if_stmt(&mut self, stmt: &IfStmt) {
        // An `else if` chain is a loop here, not recursion.
        let mut current = stmt;
        loop {
            self.expr(&current.cond);
            self.block(&current.then_block);
            match &current.else_branch {
                None => break,
                Some(ElseBranch::Block(block)) => {
                    self.block(block);
                    break;
                }
                Some(ElseBranch::If(next)) => current = next,
            }
        }
    }

    // ----- types -----------------------------------------------------------

    fn ty(&mut self, ty: &Type) {
        match &ty.kind {
            TypeKind::Named(name) => self.type_name(name),
            TypeKind::Generic {
                name,
                element,
                length,
            } => {
                self.type_name(name);
                self.ty(element);
                self.array_length(length);
            }
            TypeKind::Error => {}
        }
    }

    fn array_length(&mut self, length: &ArrayLength) {
        if let ArrayLengthKind::Name(name) = &length.kind {
            let res = self.value_name(name, length.span, Want::Value);
            self.set_res(length.id, res);
        }
    }

    /// A name in type position: a user struct or a prelude type. A material
    /// or prefab `param` that shares its name with a prelude type means the
    /// type here (`spec/language.md` 4.2).
    fn type_name(&mut self, name: &Ident) {
        let res = self.type_res(name);
        self.set_res(name.id, res);
    }

    fn type_res(&mut self, name: &Ident) -> Res {
        if name.name == UNDERSCORE {
            self.report_underscore(name.span);
            return Res::Error;
        }
        let prelude = self.registry.type_def(&name.name).map(|t| t.name);
        if let Some(id) = self.lookup(&name.name) {
            let (Res::Def(_), Some(def), Some(kind)) =
                (self.def_res(id), self.def(id), self.def_kind(id))
            else {
                return Res::Error;
            };
            if kind == DefKind::Struct {
                return Res::Def(id);
            }
            if let Some(type_name) = prelude {
                let item = PreludeItem::Type(type_name);
                self.gate_prelude(item, name.span);
                return Res::Prelude(item);
            }
            let (noun, span) = (kind.noun(), def.span);
            self.sink.push(
                Diagnostic::new(
                    Code::E3003,
                    format!("'{}' is a {noun}, not a type.", name.name),
                )
                .at(name.span)
                .related(span, format!("the {noun} '{}' is declared here", name.name)),
            );
            return Res::Error;
        }
        if let Some(type_name) = prelude {
            let item = PreludeItem::Type(type_name);
            self.gate_prelude(item, name.span);
            return Res::Prelude(item);
        }
        let kinds = self.registry.prelude_name_kinds(&name.name);
        if !kinds.is_empty() {
            self.sink.push(
                Diagnostic::new(
                    Code::E3003,
                    format!(
                        "'{}' is a built-in {}, not a type.",
                        name.name,
                        prelude_kinds_noun(&kinds)
                    ),
                )
                .at(name.span),
            );
            return Res::Error;
        }
        let mut candidates = self.visible_names(|k| k == Some(DefKind::Struct));
        for t in &self.registry.types {
            candidates.entry(t.name.to_owned()).or_insert(None);
        }
        self.report_unknown(
            Code::E3003,
            format!("Unknown type '{}'.", name.name),
            name.span,
            &name.name,
            &candidates,
        );
        Res::Error
    }

    // ----- expressions -----------------------------------------------------

    fn expr(&mut self, expr: &Expr) {
        match &expr.kind {
            ExprKind::Int { .. }
            | ExprKind::Float { .. }
            | ExprKind::Color { .. }
            | ExprKind::Bool(_)
            | ExprKind::Error => {}
            ExprKind::Str { .. } => {
                let entered = self.enter(Construct::StringLiteral, expr.span);
                self.leave(entered);
            }
            ExprKind::SelfValue => self.self_value(expr),
            ExprKind::Name(name) => {
                let res = self.value_name(name, expr.span, Want::Value);
                self.set_res(expr.id, res);
            }
            ExprKind::Paren(inner) => self.expr(inner),
            ExprKind::Array(items) => {
                let entered = self.enter(Construct::ArrayLiteral, expr.span);
                for item in items {
                    self.expr(item);
                }
                self.leave(entered);
            }
            ExprKind::Descriptor { name, fields } => self.descriptor(expr.span, name, fields),
            ExprKind::Unary { op, operand } => {
                let entered = self.enter(unary_construct(*op), expr.span);
                self.expr(operand);
                self.leave(entered);
            }
            ExprKind::Binary { op, lhs, rhs, .. } => {
                let entered = self.enter(binary_construct(*op), expr.span);
                self.expr(lhs);
                self.expr(rhs);
                self.leave(entered);
            }
            ExprKind::Call { callee, args } => {
                self.callee(callee);
                for arg in args {
                    self.expr(arg);
                }
            }
            ExprKind::Field { base, name } => self.field_access(expr.span, base, name),
            ExprKind::Index { base, index } => {
                let entered = self.enter(Construct::Index, expr.span);
                self.expr(base);
                self.expr(index);
                self.leave(entered);
            }
        }
    }

    fn self_value(&mut self, expr: &Expr) {
        let res = match self.self_def {
            Some(id) => {
                let entered = self.enter(Construct::SelfValue, expr.span);
                self.leave(entered);
                Res::Def(id)
            }
            // In a stage function `self` is a capture (`E4040`).
            None if self.stage_material.is_some() => {
                self.report_capture("`self`: a material belongs to no entity", expr.span);
                Res::Error
            }
            // Outside an entity or prefab `self` would be wrong in every
            // build: only `E2003`, not `E9010` as well.
            None => {
                self.sink.push(
                    Diagnostic::new(
                        Code::E2003,
                        "`self` can only be used inside an entity or prefab.",
                    )
                    .at(expr.span),
                );
                Res::Error
            }
        };
        self.set_res(expr.id, res);
    }

    /// A bare name in an expression: the innermost declaration, else the
    /// prelude, else `E2003`.
    fn value_name(&mut self, name: &str, span: Span, want: Want) -> Res {
        if name == UNDERSCORE {
            self.report_underscore(span);
            return Res::Error;
        }
        if let Some(id) = self.lookup(name) {
            return self.def_res(id);
        }
        if let Some(item) = self.prelude_lookup(name, want) {
            self.gate_prelude(item, span);
            return Res::Prelude(item);
        }
        if self.stage_material.is_some()
            && let Some(noun) = self.scene_names.get(name).copied()
        {
            self.report_capture(&format!("the {noun} '{name}'"), span);
            return Res::Error;
        }
        let mut candidates = self.visible_names(|_| true);
        for (prelude, _) in self.registry.prelude_names() {
            candidates.entry(prelude.to_owned()).or_insert(None);
        }
        self.report_unknown(
            Code::E2003,
            format!("Unknown name '{name}'."),
            span,
            name,
            &candidates,
        );
        Res::Error
    }

    fn callee(&mut self, callee: &Expr) {
        let ExprKind::Name(name) = &callee.kind else {
            self.expr(callee);
            return;
        };
        let res = self.value_name(name, callee.span, Want::Value);
        if let Res::Def(id) = res
            && self.registry.intrinsic(name).is_some()
            && let Some(def) = self.def(id)
            && def.kind.may_hide_prelude_function()
        {
            let (noun, span) = (def.kind.noun(), def.span);
            self.sink.push(
                Diagnostic::new(
                    Code::E2004,
                    format!(
                        "`{name}` is a {noun} here; the built-in function `{name}` is hidden by it."
                    ),
                )
                .at(callee.span)
                .related(span, format!("the {noun} '{name}' is declared here"))
                .help(format!(
                    "rename the {noun} to call the built-in function `{name}`"
                )),
            );
            self.set_res(callee.id, Res::Error);
            return;
        }
        self.set_res(callee.id, res);
    }

    fn field_access(&mut self, span: Span, base: &Expr, name: &Ident) {
        let ExprKind::Name(base_name) = &base.kind else {
            self.expr(base);
            self.set_res(name.id, Res::Field);
            return;
        };
        // A CPU value of a namespace (`frame.time`) read by stage code is a
        // capture (`E4040`), whatever milestone implements it.
        if self.stage_material.is_some()
            && self.lookup(base_name).is_none()
            && matches!(
                self.registry.namespace_member(base_name, &name.name),
                Some(NamespaceMember::Value(value)) if value.domain == Domain::Cpu
            )
        {
            self.report_capture(&format!("`{base_name}.{}`", name.name), span);
            self.set_res(base.id, Res::Error);
            self.set_res(name.id, Res::Error);
            return;
        }
        let res = self.value_name(base_name, base.span, Want::Path);
        match res {
            Res::Prelude(PreludeItem::Namespace(namespace)) => {
                self.set_res(base.id, res);
                let member = self
                    .registry
                    .namespace_member(namespace, &name.name)
                    .map(|m| m.name());
                let candidates: Vec<&'static str> = self
                    .registry
                    .namespace(namespace)
                    .map(|n| n.members.iter().map(|m| m.name()).collect())
                    .unwrap_or_default();
                let item = member.map(|member| PreludeItem::NamespaceMember { namespace, member });
                self.member(PreludeItem::Namespace(namespace), item, name, &candidates);
            }
            Res::Prelude(PreludeItem::Enum(enum_name)) => {
                self.set_res(base.id, res);
                let member = self
                    .registry
                    .enum_member(enum_name, &name.name)
                    .map(|m| m.name);
                let candidates: Vec<&'static str> = self
                    .registry
                    .enum_def(enum_name)
                    .map(|e| e.members.iter().map(|m| m.name).collect())
                    .unwrap_or_default();
                let item = member.map(|member| PreludeItem::EnumMember { enum_name, member });
                self.member(PreludeItem::Enum(enum_name), item, name, &candidates);
            }
            Res::Def(id)
                if self.def_kind(id) == Some(DefKind::Param)
                    && self
                        .registry
                        .namespace_member(base_name, &name.name)
                        .is_some() =>
            {
                let span = self.def(id).map(|def| def.span);
                let mut diagnostic = Diagnostic::new(
                    Code::E2005,
                    format!(
                        "`{base_name}` is a param here; the built-in namespace `{base_name}` is hidden by it."
                    ),
                )
                .at(base.span);
                if let Some(span) = span {
                    diagnostic = diagnostic
                        .related(span, format!("the param '{base_name}' is declared here"));
                }
                self.sink.push(diagnostic.help(format!(
                    "inside this body `{base_name}` means the param in expressions; rename the param to use `{base_name}.{}`",
                    name.name
                )));
                self.set_res(base.id, Res::Error);
                self.set_res(name.id, Res::Error);
            }
            _ => {
                self.set_res(base.id, res);
                self.set_res(name.id, Res::Field);
                // Reading a field of a named entity or scene object is gated
                // by the field's own `since`, like writing it (decision 0026).
                let schema = match res {
                    Res::Def(id) => match self.def_kind(id) {
                        Some(DefKind::Entity) => Some(self.registry.declaration_schemas.entity),
                        Some(DefKind::SceneObject { kind: Some(kind) }) => {
                            self.registry.scene_object(kind).map(|k| k.schema)
                        }
                        _ => None,
                    },
                    _ => None,
                };
                if let Some(schema) = schema {
                    let entered = self.enter_field(schema, name, span);
                    self.leave(entered);
                }
            }
        }
    }

    /// `owner.name` where `owner` is a prelude namespace or enum and `item`
    /// the member found (if any).
    fn member(
        &mut self,
        owner: PreludeItem,
        item: Option<PreludeItem>,
        name: &Ident,
        candidates: &[&'static str],
    ) {
        let (owner_noun, owner_name) = match owner {
            PreludeItem::Namespace(n) => ("namespace", n),
            PreludeItem::Enum(e) => ("enum", e),
            _ => ("item", ""),
        };
        match item {
            Some(item) => {
                // A member is gated only once its owner is implemented (the
                // owner's own `E9010` covers it otherwise).
                if self.prelude_since(owner).is_some_and(is_implemented) {
                    self.gate_prelude(item, name.span);
                }
                self.set_res(name.id, Res::Prelude(item));
            }
            None => {
                let candidates: BTreeMap<String, Option<Span>> = candidates
                    .iter()
                    .map(|c| (format!("{owner_name}.{c}"), None))
                    .collect();
                self.report_unknown(
                    Code::E2003,
                    format!(
                        "The built-in {owner_noun} `{owner_name}` has no member '{}'.",
                        name.name
                    ),
                    name.span,
                    &format!("{owner_name}.{}", name.name),
                    &candidates,
                );
                self.set_res(name.id, Res::Error);
            }
        }
    }

    fn descriptor(&mut self, span: Span, name: &Ident, fields: &[DescField]) {
        let entered = self.enter(Construct::Descriptor, span);
        let res = self.descriptor_res(name);
        self.set_res(name.id, res);
        let (schema, schema_entered) = match res {
            Res::Prelude(item @ PreludeItem::Schema(schema)) => {
                (Some(schema), self.enter_prelude(item, span))
            }
            Res::Prelude(item) => {
                self.gate_prelude(item, name.span);
                (None, false)
            }
            Res::Def(_) | Res::Field | Res::Error => (None, false),
        };
        for field in fields {
            self.set_res(field.name.id, Res::Field);
            let field_entered = match schema {
                Some(schema) => self.enter_field(schema, &field.name, field.span),
                None => false,
            };
            self.field_value(&field.value);
            self.leave(field_entered);
        }
        self.leave(schema_entered);
        self.leave(entered);
    }

    /// The type of a descriptor literal: a user struct, material or prefab, or
    /// a registry schema.
    fn descriptor_res(&mut self, name: &Ident) -> Res {
        if name.name == UNDERSCORE {
            self.report_underscore(name.span);
            return Res::Error;
        }
        if let Some(id) = self.lookup(&name.name) {
            return self.def_res(id);
        }
        let kinds = self.registry.prelude_name_kinds(&name.name);
        let kind = if kinds.contains(&PreludeNameKind::Schema) {
            Some(PreludeNameKind::Schema)
        } else {
            kinds.first().copied()
        };
        if let Some(item) = kind.and_then(|k| self.prelude_item(&name.name, k)) {
            return Res::Prelude(item);
        }
        let mut candidates = self.visible_names(|k| {
            matches!(
                k,
                Some(DefKind::Struct | DefKind::Material | DefKind::Prefab)
            )
        });
        for schema in &self.registry.schemas {
            candidates.entry(schema.name.to_owned()).or_insert(None);
        }
        self.report_unknown(
            Code::E2003,
            format!(
                "Unknown descriptor type '{}': no schema, struct, material or prefab has that name.",
                name.name
            ),
            name.span,
            &name.name,
            &candidates,
        );
        Res::Error
    }
}

/// `noun` with its indefinite article.
fn with_article(noun: &str) -> String {
    let article = if noun.starts_with(['a', 'e', 'i', 'o', 'u']) {
        "an"
    } else {
        "a"
    };
    format!("{article} {noun}")
}

/// "type", "type and namespace", … for the meanings of a prelude name.
fn prelude_kinds_noun(kinds: &[PreludeNameKind]) -> String {
    let nouns: Vec<&str> = kinds
        .iter()
        .map(|k| match k {
            PreludeNameKind::Type => "type",
            PreludeNameKind::Schema => "schema",
            PreludeNameKind::Enum => "enum",
            PreludeNameKind::Namespace => "namespace",
            PreludeNameKind::Function => "function",
        })
        .collect();
    nouns.join(" and ")
}

/// The only candidate within edit distance 2 of `name` (and different from
/// it), with its span; `None` if there is none or more than one
/// (`spec/language.md` 4.3).
fn single_candidate<'c>(
    name: &str,
    candidates: &'c BTreeMap<String, Option<Span>>,
) -> Option<(&'c str, Option<Span>)> {
    let mut found = None;
    for (candidate, span) in candidates {
        let distance = edit_distance(name, candidate);
        if distance == 0 || distance > 2 {
            continue;
        }
        if found.is_some() {
            return None;
        }
        found = Some((candidate.as_str(), *span));
    }
    found
}
