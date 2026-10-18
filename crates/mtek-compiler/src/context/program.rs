//! The resolved project as the context export reads it: the declarations (symbols) of every
//! module, the references between them and the standard-library names each one uses
//! (decision 0072 item 5).
//!
//! Everything is read from what the front end produced: the syntax trees, the name resolution of
//! every module and the checked types. A project with errors still has a program: declarations
//! that did not parse are not in the tree, and a name that did not resolve is not a reference.
//!
//! A **reference** is a name that resolves to a declaration of the project (through an import
//! too), attributed to the innermost declaration that contains it: a use of `speed` inside the
//! entity `Demo.Cube` is a reference from `Demo.Cube` to `Demo.speed`.

use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;

use super::capabilities::{feature_name, prelude_feature};
use crate::resolve::{Construct, DefId, DefKind, PreludeItem, Res, Resolution};
use crate::source::{SourceFile, Span};
use crate::syntax::ast::{
    ConstDecl, EntityDecl, EntityMember, FnDecl, Ident, Item, ItemKind, MaterialDecl,
    MaterialMember, Module, NodeId, ParamDecl, SceneDecl, SceneMember, SceneObject, StateDecl,
    StructDecl, Type,
};
use crate::syntax::{Lexed, NodeInfo, lex, walk_module};
use crate::types::Typeck;

/// A module of the project with everything the export reads from it.
pub struct ModuleCtx<'a> {
    /// The path relative to the project root.
    pub path: String,
    pub source: &'a SourceFile,
    pub module: &'a Module,
    pub resolution: &'a Resolution,
    pub types: Option<&'a Typeck>,
    lexed: Lexed,
    /// The span of every node, by node id.
    spans: Vec<Option<Span>>,
    /// The nodes whose kind names a language feature: `(feature, span)`.
    feature_nodes: Vec<(&'static str, Span)>,
}

/// The walk labels that name a language feature (the others are covered by the declarations).
fn label_feature(label: &str) -> Option<Construct> {
    match label {
        "import" => Some(Construct::Import),
        "on" => Some(Construct::Handler),
        "lifecycle" => Some(Construct::LifecycleFn),
        "bind" => Some(Construct::Bind),
        "self" => Some(Construct::SelfValue),
        "desc" => Some(Construct::Descriptor),
        "str" => Some(Construct::StringLiteral),
        "array" => Some(Construct::ArrayLiteral),
        "index" => Some(Construct::Index),
        _ => None,
    }
}

impl<'a> ModuleCtx<'a> {
    pub fn new(
        path: String,
        source: &'a SourceFile,
        module: &'a Module,
        resolution: &'a Resolution,
        types: Option<&'a Typeck>,
    ) -> Self {
        let mut spans: Vec<Option<Span>> = vec![None; module.node_count as usize];
        let mut feature_nodes = Vec::new();
        walk_module(module, &mut |info: NodeInfo, _| {
            if let Some(slot) = spans.get_mut(info.id.index()) {
                *slot = Some(info.span);
            }
            if let Some(construct) = label_feature(info.kind) {
                feature_nodes.push((feature_name(construct), info.span));
            }
        });
        ModuleCtx {
            path,
            source,
            module,
            resolution,
            types,
            lexed: lex(source),
            spans,
            feature_nodes,
        }
    }

    /// The source text of `span`, whitespace runs collapsed to one space.
    fn text(&self, span: Span) -> String {
        let raw = self.source.slice(span.start, span.end).unwrap_or("");
        raw.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    fn type_text(&self, ty: &Type) -> String {
        self.text(ty.span)
    }

    /// The documentation comment of the declaration whose first token starts at `start`: the
    /// `///` lines directly before it (`spec/language.md` 1.5), joined by a line feed.
    fn doc(&self, start: u32) -> String {
        self.lexed.doc_comment_before(self.source.text(), start)
    }

    fn line(&self, offset: u32) -> u32 {
        self.source.line_col(offset).line
    }
}

/// One declaration.
#[derive(Clone, Debug)]
pub struct Decl {
    pub module: usize,
    pub def: Option<DefId>,
    /// The declaration names from the module item down, joined by `.`.
    pub name: String,
    pub kind: String,
    pub ty: String,
    pub doc: String,
    pub line: u32,
    /// Everything the declaration covers, including its members.
    pub extent: Span,
    pub parent: Option<usize>,
    /// The language features the declaration itself is an instance of.
    pub features: Vec<&'static str>,
}

/// What `Collector::push` needs to know about a declaration.
struct Spec<'s> {
    parent: Option<usize>,
    name: &'s Ident,
    node: NodeId,
    kind: &'s str,
    ty: String,
    /// Where the declaration's first token is, for the documentation comment.
    start: u32,
    extent: Span,
    features: Vec<&'static str>,
}

/// The declarations of one module, collected in source order (parents before their members).
struct Collector<'c, 'a> {
    ctx: &'c ModuleCtx<'a>,
    module: usize,
    decls: &'c mut Vec<Decl>,
}

impl Collector<'_, '_> {
    fn push(&mut self, spec: Spec<'_>) -> usize {
        let name = match spec.parent {
            Some(parent) => format!("{}.{}", self.decls[parent].name, spec.name.name),
            None => spec.name.name.clone(),
        };
        self.decls.push(Decl {
            module: self.module,
            def: self.ctx.resolution.def_of(spec.node),
            name,
            kind: spec.kind.to_owned(),
            ty: spec.ty,
            doc: self.ctx.doc(spec.start),
            line: self.ctx.line(spec.start),
            extent: spec.extent,
            parent: spec.parent,
            features: spec.features,
        });
        self.decls.len() - 1
    }

    fn item(&mut self, item: &Item) {
        match &item.kind {
            ItemKind::Const(decl) => {
                self.constant(None, decl, item.span.start, item.span, Construct::ConstItem);
            }
            ItemKind::Fn(decl) => self.function(item, decl),
            ItemKind::Struct(decl) => self.structure(item, decl),
            ItemKind::Material(decl) => self.material(item, decl),
            ItemKind::Prefab(decl) => {
                let index = self.push(Spec {
                    parent: None,
                    name: &decl.name,
                    node: decl.id,
                    kind: "prefab",
                    ty: "prefab".to_owned(),
                    start: item.span.start,
                    extent: item.span,
                    features: vec![feature_name(Construct::Prefab)],
                });
                self.entity_members(index, &decl.members);
            }
            ItemKind::Scene(decl) => self.scene(item, decl),
            ItemKind::Import(_) | ItemKind::Error => {}
        }
    }

    fn constant(
        &mut self,
        parent: Option<usize>,
        decl: &ConstDecl,
        start: u32,
        extent: Span,
        construct: Construct,
    ) {
        let ty = match &decl.ty {
            Some(ty) => self.ctx.type_text(ty),
            None => self.inferred(decl),
        };
        self.push(Spec {
            parent,
            name: &decl.name,
            node: decl.id,
            kind: "const",
            ty,
            start,
            extent,
            features: vec![feature_name(construct)],
        });
    }

    /// The type of a constant without an annotation, as the checker inferred it.
    fn inferred(&self, decl: &ConstDecl) -> String {
        let info = self
            .ctx
            .types
            .zip(self.ctx.resolution.def_of(decl.id))
            .and_then(|(types, def)| Some((types, types.const_info(def)?)));
        match info {
            Some((types, info)) if !types.interner().is_error(info.ty) => types.display(info.ty),
            _ => "unknown".to_owned(),
        }
    }

    fn signature(&self, params: &[crate::syntax::ast::Param], ret: Option<&Type>) -> String {
        let params: Vec<String> = params
            .iter()
            .map(|p| format!("{}: {}", p.name.name, self.ctx.type_text(&p.ty)))
            .collect();
        match ret {
            Some(ret) => format!("({}) -> {}", params.join(", "), self.ctx.type_text(ret)),
            None => format!("({})", params.join(", ")),
        }
    }

    fn function(&mut self, item: &Item, decl: &FnDecl) {
        let (kind, construct) = if decl.cpu {
            ("cpu_fn", Construct::CpuFn)
        } else {
            ("fn", Construct::Fn)
        };
        let ty = self.signature(&decl.params, decl.ret.as_ref());
        self.push(Spec {
            parent: None,
            name: &decl.name,
            node: decl.id,
            kind,
            ty,
            start: item.span.start,
            extent: item.span,
            features: vec![feature_name(construct)],
        });
    }

    fn structure(&mut self, item: &Item, decl: &StructDecl) {
        let fields: Vec<String> = decl
            .fields
            .iter()
            .map(|f| format!("{}: {}", f.name.name, self.ctx.type_text(&f.ty)))
            .collect();
        self.push(Spec {
            parent: None,
            name: &decl.name,
            node: decl.id,
            kind: "struct",
            ty: format!("struct {{ {} }}", fields.join("; ")),
            start: item.span.start,
            extent: item.span,
            features: vec![feature_name(Construct::Struct)],
        });
    }

    fn material(&mut self, item: &Item, decl: &MaterialDecl) {
        let index = self.push(Spec {
            parent: None,
            name: &decl.name,
            node: decl.id,
            kind: "material",
            ty: "material".to_owned(),
            start: item.span.start,
            extent: item.span,
            features: vec![feature_name(Construct::Material)],
        });
        for member in &decl.members {
            if let MaterialMember::Param(param) = member {
                self.param(index, param);
            }
        }
    }

    fn param(&mut self, parent: usize, param: &ParamDecl) {
        self.push(Spec {
            parent: Some(parent),
            name: &param.name,
            node: param.id,
            kind: "param",
            ty: self.ctx.type_text(&param.ty),
            start: param.span.start,
            extent: param.span,
            features: Vec::new(),
        });
    }

    fn state(&mut self, parent: usize, state: &StateDecl) {
        self.push(Spec {
            parent: Some(parent),
            name: &state.name,
            node: state.id,
            kind: "state",
            ty: self.ctx.type_text(&state.ty),
            start: state.span.start,
            extent: state.span,
            features: vec![feature_name(Construct::State)],
        });
    }

    fn scene(&mut self, item: &Item, decl: &SceneDecl) {
        let index = self.push(Spec {
            parent: None,
            name: &decl.name,
            node: decl.id,
            kind: "scene",
            ty: "scene".to_owned(),
            start: item.span.start,
            extent: item.span,
            features: vec![feature_name(Construct::Scene)],
        });
        for member in &decl.members {
            match member {
                SceneMember::Const(constant) => self.constant(
                    Some(index),
                    constant,
                    constant.span.start,
                    constant.span,
                    Construct::BodyConst,
                ),
                SceneMember::State(state) => self.state(index, state),
                SceneMember::Object(object) => self.object(index, object),
                SceneMember::Entity(entity) => self.entity(index, entity),
                SceneMember::Field(_)
                | SceneMember::Lifecycle(_)
                | SceneMember::Handler(_)
                | SceneMember::Error(_) => {}
            }
        }
    }

    fn object(&mut self, parent: usize, object: &SceneObject) {
        let ty = crate::stdlib::registry()
            .scene_object(&object.kind.name)
            .map_or_else(|| "scene object".to_owned(), |kind| kind.schema.to_owned());
        self.push(Spec {
            parent: Some(parent),
            name: &object.name,
            node: object.id,
            kind: &object.kind.name,
            ty,
            start: object.span.start,
            extent: object.span,
            features: vec![feature_name(Construct::SceneObject)],
        });
    }

    fn entity(&mut self, parent: usize, entity: &EntityDecl) {
        let (ty, features) = match &entity.prefab {
            Some(prefab) => (
                format!("entity: {}", prefab.name),
                vec![
                    feature_name(Construct::Entity),
                    feature_name(Construct::PrefabInstance),
                ],
            ),
            None => ("entity".to_owned(), vec![feature_name(Construct::Entity)]),
        };
        let index = self.push(Spec {
            parent: Some(parent),
            name: &entity.name,
            node: entity.id,
            kind: "entity",
            ty,
            start: entity.span.start,
            extent: entity.span,
            features,
        });
        self.entity_members(index, &entity.members);
    }

    fn entity_members(&mut self, parent: usize, members: &[EntityMember]) {
        for member in members {
            match member {
                EntityMember::Const(constant) => self.constant(
                    Some(parent),
                    constant,
                    constant.span.start,
                    constant.span,
                    Construct::BodyConst,
                ),
                EntityMember::State(state) => self.state(parent, state),
                EntityMember::Param(param) => self.param(parent, param),
                EntityMember::Entity(entity) => self.entity(parent, entity),
                EntityMember::Field(_)
                | EntityMember::Lifecycle(_)
                | EntityMember::Handler(_)
                | EntityMember::Error(_) => {}
            }
        }
    }
}

/// The declarations of a project, the references between them and the standard-library names
/// used inside them.
pub struct Program<'a> {
    pub modules: Vec<Option<ModuleCtx<'a>>>,
    /// Every declaration, module by module, each module in source order with parents before
    /// their members.
    pub decls: Vec<Decl>,
    /// The declarations of each module, as a range of `decls`.
    ranges: Vec<Range<usize>>,
    by_def: BTreeMap<(usize, DefId), usize>,
    /// `(from, to)`: a name inside `from` resolves to the declaration `to`.
    edges: BTreeSet<(usize, usize)>,
    /// A standard-library name used somewhere: `(module, span, item)`.
    prelude_uses: Vec<(usize, Span, PreludeItem)>,
}

impl<'a> Program<'a> {
    /// The program of `modules`, indexed by module id (`None` for a module that is not part of
    /// the project's own sources, such as the embedded prelude).
    pub fn new(modules: Vec<Option<ModuleCtx<'a>>>) -> Self {
        let mut decls = Vec::new();
        let mut ranges = Vec::new();
        for (index, ctx) in modules.iter().enumerate() {
            let first = decls.len();
            if let Some(ctx) = ctx {
                let mut collector = Collector {
                    ctx,
                    module: index,
                    decls: &mut decls,
                };
                for item in &ctx.module.items {
                    collector.item(item);
                }
            }
            ranges.push(first..decls.len());
        }
        let by_def = decls
            .iter()
            .enumerate()
            .filter_map(|(index, decl)| Some(((decl.module, decl.def?), index)))
            .collect();
        let mut program = Program {
            modules,
            decls,
            ranges,
            by_def,
            edges: BTreeSet::new(),
            prelude_uses: Vec::new(),
        };
        program.link();
        program
    }

    /// The declaration a name that resolved to `def` in module `module` denotes, following an
    /// import to the declaration it imports.
    fn target(&self, module: usize, def: DefId) -> Option<usize> {
        let resolution = self.modules.get(module)?.as_ref()?.resolution;
        let declared = resolution.def(def)?;
        if declared.kind == DefKind::Import {
            let target = resolution.import_target(def)?;
            let other = target.module.index();
            let def = self
                .modules
                .get(other)?
                .as_ref()?
                .resolution
                .def_of(target.node)?;
            self.by_def.get(&(other, def)).copied()
        } else {
            self.by_def.get(&(module, def)).copied()
        }
    }

    /// The innermost declaration of `module` that contains `span`.
    ///
    /// The declarations of a module are properly nested intervals in source order, so the last
    /// one that starts at or before `span` is the innermost one that contains it or lies inside
    /// it, and the innermost one that contains `span` is on its chain of parents.
    fn innermost(&self, module: usize, span: Span) -> Option<usize> {
        let range = self.ranges.get(module)?;
        let of_module = self.decls.get(range.clone())?;
        let started = of_module.partition_point(|decl| decl.extent.start <= span.start);
        let mut at = range.start + started.checked_sub(1)?;
        loop {
            let decl = self.decls.get(at)?;
            if decl.extent.contains_span(span) {
                return Some(at);
            }
            at = decl.parent?;
        }
    }

    fn link(&mut self) {
        let mut edges = BTreeSet::new();
        let mut prelude_uses = Vec::new();
        for (module, ctx) in self.modules.iter().enumerate() {
            let Some(ctx) = ctx else { continue };
            for (node, res) in ctx.resolution.entries() {
                let Some(span) = ctx.spans.get(node.index()).copied().flatten() else {
                    continue;
                };
                match res {
                    Res::Def(def) => {
                        if let (Some(from), Some(to)) =
                            (self.innermost(module, span), self.target(module, def))
                            && from != to
                        {
                            edges.insert((from, to));
                        }
                    }
                    Res::Prelude(item) => prelude_uses.push((module, span, item)),
                    Res::Field | Res::Error => {}
                }
            }
        }
        self.edges = edges;
        self.prelude_uses = prelude_uses;
    }

    /// The declarations named `name` (`Demo.Cube`), or by their project-relative file and name
    /// (`src/main.mtek::Demo.Cube`).
    pub fn find(&self, name: &str) -> Vec<usize> {
        let (path, name) = match name.split_once("::") {
            Some((path, name)) => (Some(path), name),
            None => (None, name),
        };
        self.decls
            .iter()
            .enumerate()
            .filter(|(_, decl)| {
                decl.name == name
                    && path.is_none_or(|path| {
                        self.modules
                            .get(decl.module)
                            .and_then(Option::as_ref)
                            .is_some_and(|ctx| ctx.path == path)
                    })
            })
            .map(|(index, _)| index)
            .collect()
    }

    /// The seeds and every declaration nested in one of them.
    pub fn closure(&self, seeds: &[usize]) -> BTreeSet<usize> {
        let seeds: BTreeSet<usize> = seeds.iter().copied().collect();
        let mut all = seeds.clone();
        for (index, decl) in self.decls.iter().enumerate() {
            let mut at = decl.parent;
            while let Some(parent) = at {
                if seeds.contains(&parent) {
                    all.insert(index);
                    break;
                }
                at = self.decls[parent].parent;
            }
        }
        all
    }

    /// The declarations one reference away from `inside`: those a name inside refers to and
    /// those with a name that refers inside.
    pub fn neighbours(&self, inside: &BTreeSet<usize>) -> BTreeSet<usize> {
        let mut found = BTreeSet::new();
        for &(from, to) in &self.edges {
            match (inside.contains(&from), inside.contains(&to)) {
                (true, false) => {
                    found.insert(to);
                }
                (false, true) => {
                    found.insert(from);
                }
                _ => {}
            }
        }
        found
    }

    /// The standard-library names used inside `inside`.
    pub fn prelude_items(&self, inside: &BTreeSet<usize>) -> Vec<PreludeItem> {
        let covered = self.outermost(inside);
        self.prelude_uses
            .iter()
            .filter(|(module, span, _)| covers(&covered, *module, *span))
            .map(|(_, _, item)| *item)
            .collect()
    }

    /// The declarations of `inside` that are not nested in another one of it: disjoint, in
    /// module and source order. A declaration of `inside` contains exactly what the outermost
    /// ones that contain it do.
    fn outermost(&self, inside: &BTreeSet<usize>) -> Vec<(usize, Span)> {
        inside
            .iter()
            .filter_map(|&index| {
                let decl = self.decls.get(index)?;
                let nested = decl.parent.is_some_and(|parent| inside.contains(&parent));
                (!nested).then_some((decl.module, decl.extent))
            })
            .collect()
    }

    /// The language and library features used inside `inside`, named as in
    /// `supported.features`.
    pub fn used_features(&self, inside: &BTreeSet<usize>) -> BTreeSet<String> {
        let mut features: BTreeSet<String> = BTreeSet::new();
        for &index in inside {
            features.extend(self.decls[index].features.iter().map(|f| (*f).to_owned()));
        }
        let covered = self.outermost(inside);
        for (module, ctx) in self.modules.iter().enumerate() {
            let Some(ctx) = ctx else { continue };
            for (feature, span) in &ctx.feature_nodes {
                if covers(&covered, module, *span) {
                    features.insert((*feature).to_owned());
                }
            }
        }
        features.extend(
            self.prelude_items(inside)
                .into_iter()
                .filter_map(prelude_feature),
        );
        features
    }

    /// Every declaration that has no parent, in source order.
    pub fn roots(&self) -> Vec<usize> {
        self.decls
            .iter()
            .enumerate()
            .filter(|(_, decl)| decl.parent.is_none())
            .map(|(index, _)| index)
            .collect()
    }

    /// The declaration the entry module's resolution selected as the entry scene.
    pub fn entry_scene(&self) -> Option<usize> {
        let def = self.modules.first()?.as_ref()?.resolution.entry_scene()?;
        self.by_def.get(&(0, def)).copied()
    }
}

/// Whether one of the disjoint `extents` (sorted by module and start) contains `span` of `module`.
fn covers(extents: &[(usize, Span)], module: usize, span: Span) -> bool {
    let started = extents.partition_point(|(m, extent)| (*m, extent.start) <= (module, span.start));
    started
        .checked_sub(1)
        .and_then(|last| extents.get(last))
        .is_some_and(|(m, extent)| *m == module && extent.contains_span(span))
}
