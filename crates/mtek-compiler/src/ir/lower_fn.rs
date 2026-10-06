//! Lowering functions to the typed IR (decision 0038): parameters and
//! locals into one table, statements and expressions with their types,
//! every constant expression as its folded value. Like the rest of the
//! lowering it only reshapes what the checker computed; a node it cannot
//! represent is a compiler defect.

use std::collections::BTreeMap;

use super::lower::{Defect, Lowering};
use super::model::{
    Behavior, BehaviorKind, Binding, BindingDep, BindingTarget, Block, Branch, Expr, ExprKind,
    Function, LocalItem, LocalKind, MaterialItem, MaterialParamItem, NamedExpr, Owner, Place,
    PlaceRoot, PlaceStep, StageItem, State, Stmt, Symbol, Value,
};
use crate::layout::{
    LayoutType, compute, material_layout_id, material_params_struct, qualified_name,
};
use crate::resolve::{DefId, DefKind, Res};
use crate::stdlib::{EventForm, registry};
use crate::syntax::ast::{self, ElseBranch, ExprKind as AstExpr, FieldValue, ForIter, HandlerArg};
use crate::types::{CallKind, EffectLevel, FieldKind, FnRef, Ty, TyId};

/// What the lowering of a scene body needs to name entities and cameras: the static index of
/// every entity declaration and the name of every camera.
#[derive(Default)]
pub(super) struct SceneCtx {
    pub(super) entities: BTreeMap<DefId, u32>,
    pub(super) cameras: BTreeMap<DefId, String>,
}

/// The state of one function's lowering: its locals so far.
struct FnLowering<'l, 'a> {
    lowering: &'l Lowering<'a>,
    /// The function's name, for defect messages.
    name: String,
    locals: Vec<LocalItem>,
    index: BTreeMap<DefId, u32>,
    /// In a material's stage: the material's params, by their declaration,
    /// with their position (decision 0039).
    params: BTreeMap<DefId, u32>,
    /// In a scene body: the entities and cameras it can name.
    scene: Option<&'l SceneCtx>,
}

impl Lowering<'_> {
    /// The function `decl` with its typed body.
    pub(super) fn function(&self, decl: &ast::FnDecl, symbol: Symbol) -> Result<Function, Defect> {
        let name = decl.name.name.clone();
        let def = self
            .resolution
            .def_of(decl.id)
            .ok_or_else(|| format!("function '{name}' has no declaration"))?;
        let info = self
            .types
            .function(def)
            .ok_or_else(|| format!("function '{name}' was not checked"))?;
        let effect = self
            .effects
            .get(FnRef {
                module: self.module,
                def,
            })
            .ok_or_else(|| format!("function '{name}' has no effects"))?;
        let mut lowering = FnLowering {
            lowering: self,
            name: name.clone(),
            locals: Vec::new(),
            index: BTreeMap::new(),
            params: BTreeMap::new(),
            scene: None,
        };
        if info.sig.params.len() != decl.params.len() {
            return Err(format!("function '{name}' has parameters with errors"));
        }
        for (param, (_, ty)) in decl.params.iter().zip(&info.sig.params) {
            let param_def = self
                .resolution
                .def_of(param.id)
                .ok_or_else(|| format!("a parameter of '{name}' has no declaration"))?;
            lowering.declare(param_def, &param.name, *ty, LocalKind::Param)?;
        }
        let body = lowering.block(&decl.body)?;
        Ok(Function {
            name,
            symbol,
            effect: match effect.level {
                EffectLevel::Pure => "pure",
                EffectLevel::Cpu => "cpu",
            },
            gpu_reachable: effect.gpu_reachable,
            cpu_reachable: effect.cpu_reachable,
            result: (info.sig.ret != TyId::UNIT).then(|| self.type_name(info.sig.ret)),
            locals: lowering.locals,
            body,
            span: decl.span,
        })
    }

    /// The material `decl` (decision 0039): its params with their defaults,
    /// its parameter block, and its fragment stage with the typed body.
    pub(super) fn material(
        &self,
        decl: &ast::MaterialDecl,
        symbol: Symbol,
    ) -> Result<MaterialItem, Defect> {
        let name = decl.name.name.clone();
        let info = self
            .resolution
            .def_of(decl.id)
            .and_then(|def| self.types.material(def))
            .ok_or_else(|| format!("material '{name}' was not checked"))?;
        let mut params = Vec::with_capacity(info.params.len());
        let mut members = Vec::with_capacity(info.params.len());
        let mut positions = BTreeMap::new();
        for (index, param) in info.params.iter().enumerate() {
            if param.has_default != param.default.is_some() {
                return Err(format!(
                    "the param '{}' of material '{name}' has a default with errors",
                    param.name
                ));
            }
            members.push((param.name.clone(), self.layout_type(param.ty)?));
            if let Some(def) = param.def {
                positions.insert(
                    def,
                    u32::try_from(index).map_err(|_| "too many params".to_owned())?,
                );
            }
            params.push(MaterialParamItem {
                name: param.name.clone(),
                ty: self.type_name(param.ty),
                default: param.default.as_ref().map(Value::from),
                span: param.span,
            });
        }
        let layout = if members.is_empty() {
            None
        } else {
            let block = LayoutType::new_struct(qualified_name(self.path, &name), members);
            let record = compute(
                &block,
                &material_layout_id(self.path, &name),
                &material_params_struct(self.path, &name),
            )
            .map_err(|e| format!("the parameter block of material '{name}' has no layout: {e}"))?;
            Some(record)
        };
        let stage_info = info
            .fragment
            .as_ref()
            .ok_or_else(|| format!("material '{name}' has no fragment stage"))?;
        let stage = decl
            .members
            .iter()
            .find_map(|member| match member {
                ast::MaterialMember::Stage(stage) => Some(stage),
                _ => None,
            })
            .ok_or_else(|| format!("material '{name}' has no stage function"))?;
        let mut lowering = FnLowering {
            lowering: self,
            name: format!("{name}.fragment"),
            locals: Vec::new(),
            index: BTreeMap::new(),
            params: positions,
            scene: None,
        };
        for param in &stage.params {
            lowering.declare_node(param.id, &param.name, LocalKind::Param)?;
        }
        let body = lowering.block(&stage.body)?;
        Ok(MaterialItem {
            name,
            symbol: symbol.clone(),
            params,
            layout,
            fragment: StageItem {
                symbol: symbol.child(&stage.name.name),
                surface_inputs: stage_info.surface_inputs.clone(),
                result: self.types.display(TyId::COLOR),
                locals: lowering.locals,
                body,
                span: stage.span,
            },
            span: decl.span,
        })
    }

    /// The layout type of a param of type `ty`: user structs are named by
    /// their symbol in the module that declares them (decision 0036 item 11).
    /// Types nest at most 256 levels (`E3032`), so the recursion is bounded.
    fn layout_type(&self, ty: TyId) -> Result<LayoutType, Defect> {
        let interner = self.types.interner();
        Ok(match interner.get(ty) {
            Ty::Bool => LayoutType::Bool,
            Ty::I32 => LayoutType::I32,
            Ty::U32 => LayoutType::U32,
            Ty::F32 => LayoutType::F32,
            Ty::Vec2 => LayoutType::Vec2,
            Ty::Vec3 => LayoutType::Vec3,
            Ty::Vec4 => LayoutType::Vec4,
            Ty::Mat4 => LayoutType::Mat4,
            Ty::Quat => LayoutType::Quat,
            Ty::Color => LayoutType::Color,
            Ty::Array { element, len } => LayoutType::new_array(self.layout_type(element)?, len),
            Ty::Struct(key) => {
                let def = interner
                    .struct_def(ty)
                    .ok_or("a param of a struct type without a definition")?;
                let path = self
                    .file_paths
                    .get(&key.file)
                    .ok_or("a struct of a module without a path")?;
                let mut members = Vec::with_capacity(def.fields.len());
                for (field, field_ty) in &def.fields {
                    members.push((field.clone(), self.layout_type(*field_ty)?));
                }
                LayoutType::new_struct(qualified_name(path, &def.name), members)
            }
            _ => {
                return Err(format!(
                    "a material param of type {}, which has no layout",
                    self.types.display(ty)
                ));
            }
        })
    }
}

impl Lowering<'_> {
    /// The `state` `decl` of `owner` with its initialiser lowered as an expression without
    /// locals.
    pub(super) fn state(
        &self,
        decl: &ast::StateDecl,
        owner: Owner,
        scope: &Symbol,
        ctx: &SceneCtx,
    ) -> Result<State, Defect> {
        let name = decl.name.name.clone();
        let info = self
            .resolution
            .def_of(decl.id)
            .and_then(|def| self.types.state(def))
            .ok_or_else(|| format!("state '{name}' was not checked"))?;
        let lowering = FnLowering {
            lowering: self,
            name: format!("state '{name}'"),
            locals: Vec::new(),
            index: BTreeMap::new(),
            params: BTreeMap::new(),
            scene: Some(ctx),
        };
        Ok(State {
            name: name.clone(),
            symbol: scope.child(&name),
            ty: self.type_name(info.ty),
            owner,
            init: lowering.expr(&decl.value)?,
            span: decl.span,
        })
    }

    /// A lifecycle function of `owner` with its typed body.
    pub(super) fn lifecycle(
        &self,
        decl: &ast::LifecycleFn,
        owner: Owner,
        scope: &Symbol,
        ctx: &SceneCtx,
    ) -> Result<Behavior, Defect> {
        let kind = match decl.name.name.as_str() {
            "update" => BehaviorKind::Update,
            "fixed_update" => BehaviorKind::FixedUpdate,
            other => return Err(format!("a lifecycle function named '{other}'")),
        };
        let mut lowering = FnLowering {
            lowering: self,
            name: format!("{} of {scope}", decl.name.name),
            locals: Vec::new(),
            index: BTreeMap::new(),
            params: BTreeMap::new(),
            scene: Some(ctx),
        };
        for param in &decl.params {
            lowering.declare_node(param.id, &param.name, LocalKind::Param)?;
        }
        let body = lowering.block(&decl.body)?;
        Ok(Behavior {
            kind,
            owner,
            symbol: scope.child(&decl.name.name),
            locals: lowering.locals,
            body,
            span: decl.span,
        })
    }

    /// An event handler of `owner` with its typed body; `ordinal` numbers handlers of the same
    /// name within one body.
    pub(super) fn handler(
        &self,
        decl: &ast::Handler,
        owner: Owner,
        scope: &Symbol,
        ctx: &SceneCtx,
        ordinal: usize,
    ) -> Result<Behavior, Defect> {
        let event = decl.event.name.clone();
        let mut filter = None;
        let mut lowering = FnLowering {
            lowering: self,
            name: format!("on {event} of {scope}"),
            locals: Vec::new(),
            index: BTreeMap::new(),
            params: BTreeMap::new(),
            scene: Some(ctx),
        };
        let mut member_name = None;
        let definition = registry()
            .event(&event)
            .ok_or_else(|| format!("an unknown event '{event}'"))?;
        for arg in &decl.args {
            match (arg, definition.form) {
                (HandlerArg::Param(param), EventForm::Parameter(_)) => {
                    lowering.declare_node(param.id, &param.name, LocalKind::Param)?;
                }
                (HandlerArg::Filter(expr), EventForm::Filter(_)) => {
                    let (_, member, code) = lowering.enum_member(expr).ok_or_else(|| {
                        lowering.defect("an event filter that is not an enum member")
                    })?;
                    filter = Some(code);
                    member_name = Some(member);
                }
                _ => return Err(lowering.defect("an event argument of the wrong form")),
            }
        }
        let body = lowering.block(&decl.body)?;
        let mut name = format!("on_{event}");
        if let Some(member) = member_name {
            name.push('_');
            name.push_str(&member);
        }
        if ordinal > 0 {
            name.push_str(&format!("_{}", ordinal + 1));
        }
        Ok(Behavior {
            kind: BehaviorKind::Event { event, filter },
            owner,
            symbol: scope.child(&name),
            locals: lowering.locals,
            body,
            span: decl.span,
        })
    }
}

impl FnLowering<'_, '_> {
    /// `Key.Space`: the enum, the member and the DOM code it maps from.
    fn enum_member(&self, expr: &ast::Expr) -> Option<(String, String, String)> {
        let mut inner = expr;
        while let AstExpr::Paren(next) = &inner.kind {
            inner = next;
        }
        let AstExpr::Field { name, .. } = &inner.kind else {
            return None;
        };
        let Some(Res::Prelude(crate::resolve::PreludeItem::EnumMember { enum_name, member })) =
            self.lowering.resolution.res(name.id)
        else {
            return None;
        };
        let code = registry().enum_member(enum_name, member)?.code;
        Some((enum_name.to_owned(), member.to_owned(), code.to_owned()))
    }

    /// The owner of the `state` declaration `def`.
    fn state_owner(&self, def: DefId) -> Result<Owner, Defect> {
        let parent = self
            .lowering
            .resolution
            .def(def)
            .and_then(|d| d.parent)
            .ok_or_else(|| self.defect("a state without an owner"))?;
        match self.lowering.resolution.def(parent).map(|d| d.kind) {
            Some(DefKind::Scene) => Ok(Owner::Scene),
            Some(DefKind::Entity) => self.entity_owner(parent),
            _ => Err(self.defect("a state of a construct this build does not lower")),
        }
    }

    fn entity_owner(&self, entity: DefId) -> Result<Owner, Defect> {
        let index = self
            .scene
            .and_then(|ctx| ctx.entities.get(&entity))
            .copied()
            .ok_or_else(|| self.defect("an entity that is not in the scene"))?;
        Ok(Owner::Entity { index })
    }

    fn entity_index(&self, entity: DefId) -> Result<u32, Defect> {
        match self.entity_owner(entity)? {
            Owner::Entity { index } => Ok(index),
            Owner::Scene => Err(self.defect("a scene used as an entity")),
        }
    }

    /// What a field read or write of a named entity or camera, entity state or a material
    /// param is, as an expression kind.
    fn object_read(&self, kind: &FieldKind) -> Result<ExprKind, Defect> {
        Ok(match kind {
            FieldKind::EntityState { entity, name, .. } => ExprKind::State {
                owner: self.entity_owner(*entity)?,
                name: name.clone(),
            },
            FieldKind::ObjectField {
                noun,
                object,
                object_def,
                field,
            } => {
                let def = object_def.ok_or_else(|| self.defect("a field of an unknown object"))?;
                if *noun == "entity" {
                    ExprKind::EntityField {
                        entity: self.entity_index(def)?,
                        field: field.clone(),
                    }
                } else {
                    let camera = self
                        .scene
                        .and_then(|ctx| ctx.cameras.get(&def))
                        .cloned()
                        .unwrap_or_else(|| object.clone());
                    ExprKind::CameraField {
                        camera,
                        field: field.clone(),
                    }
                }
            }
            FieldKind::MaterialParam { entity, param } => ExprKind::InstanceParam {
                entity: self.entity_index(*entity)?,
                param: param.clone(),
            },
            _ => return Err(self.defect("a field read this build does not lower")),
        })
    }

    fn defect(&self, what: &str) -> Defect {
        format!("function '{}': {what}", self.name)
    }

    fn display(&self, ty: TyId) -> String {
        self.lowering.type_name(ty)
    }

    /// Add a local to the table.
    fn declare(
        &mut self,
        def: DefId,
        name: &ast::Ident,
        ty: TyId,
        kind: LocalKind,
    ) -> Result<u32, Defect> {
        if self.lowering.types.interner().is_error(ty) {
            return Err(self.defect(&format!("the local '{}' has no type", name.name)));
        }
        let index = u32::try_from(self.locals.len()).map_err(|_| self.defect("too many locals"))?;
        self.locals.push(LocalItem {
            index,
            name: name.name.clone(),
            ty: self.display(ty),
            kind,
            span: name.span,
        });
        self.index.insert(def, index);
        Ok(index)
    }

    /// Declare the local of the declaration node `node`.
    fn declare_node(
        &mut self,
        node: ast::NodeId,
        name: &ast::Ident,
        kind: LocalKind,
    ) -> Result<u32, Defect> {
        let def =
            self.lowering.resolution.def_of(node).ok_or_else(|| {
                self.defect(&format!("the local '{}' has no declaration", name.name))
            })?;
        let ty =
            self.lowering.types.local_ty(def).ok_or_else(|| {
                self.defect(&format!("the local '{}' was not checked", name.name))
            })?;
        self.declare(def, name, ty, kind)
    }

    fn block(&mut self, block: &ast::Block) -> Result<Block, Defect> {
        let mut stmts = Vec::with_capacity(block.stmts.len());
        for stmt in &block.stmts {
            stmts.push(self.stmt(stmt)?);
        }
        Ok(Block {
            stmts,
            span: block.span,
        })
    }

    fn stmt(&mut self, stmt: &ast::Stmt) -> Result<Stmt, Defect> {
        Ok(match stmt {
            ast::Stmt::Let(decl) | ast::Stmt::Var(decl) => {
                let value = self.expr(&decl.value)?;
                let mutable = matches!(stmt, ast::Stmt::Var(_));
                let kind = if mutable {
                    LocalKind::Var
                } else {
                    LocalKind::Let
                };
                let local = self.declare_node(decl.id, &decl.name, kind)?;
                if mutable {
                    Stmt::Var {
                        local,
                        value,
                        span: decl.span,
                    }
                } else {
                    Stmt::Let {
                        local,
                        value,
                        span: decl.span,
                    }
                }
            }
            ast::Stmt::Const(decl) => {
                let constant = self
                    .lowering
                    .constant(decl, Symbol::item("", &decl.name.name))?;
                Stmt::Const {
                    name: constant.name,
                    ty: constant.ty,
                    value: constant.value,
                    span: decl.span,
                }
            }
            ast::Stmt::If(stmt) => {
                // An `else if` chain is a loop here, not recursion.
                let mut branches = Vec::new();
                let mut otherwise = None;
                let mut current = stmt;
                loop {
                    branches.push(Branch {
                        cond: self.expr(&current.cond)?,
                        body: self.block(&current.then_block)?,
                    });
                    match &current.else_branch {
                        None => break,
                        Some(ElseBranch::Block(block)) => {
                            otherwise = Some(self.block(block)?);
                            break;
                        }
                        Some(ElseBranch::If(next)) => current = next,
                    }
                }
                Stmt::If {
                    branches,
                    otherwise,
                    span: stmt.span,
                }
            }
            ast::Stmt::For(stmt) => match &stmt.iter {
                ForIter::Range { start, end } => {
                    let start = self.expr(start)?;
                    let end = self.expr(end)?;
                    let local = self.declare_node(stmt.id, &stmt.var, LocalKind::Loop)?;
                    Stmt::ForRange {
                        local,
                        start,
                        end,
                        body: self.block(&stmt.body)?,
                        span: stmt.span,
                    }
                }
                ForIter::Each(array) => {
                    let array = self.expr(array)?;
                    let local = self.declare_node(stmt.id, &stmt.var, LocalKind::Loop)?;
                    Stmt::ForEach {
                        local,
                        array,
                        body: self.block(&stmt.body)?,
                        span: stmt.span,
                    }
                }
            },
            ast::Stmt::Return(ret) => Stmt::Return {
                value: ret.value.as_ref().map(|v| self.expr(v)).transpose()?,
                span: ret.span,
            },
            ast::Stmt::Break(jump) => Stmt::Break { span: jump.span },
            ast::Stmt::Continue(jump) => Stmt::Continue { span: jump.span },
            ast::Stmt::Block(block) => Stmt::Block {
                body: self.block(block)?,
            },
            ast::Stmt::Assign(assign) => Stmt::Assign {
                target: self.place(&assign.target)?,
                op: assign.op.symbol(),
                value: self.expr(&assign.value)?,
                span: assign.span,
            },
            ast::Stmt::Expr(stmt) => Stmt::Expr {
                expr: self.expr(&stmt.expr)?,
                span: stmt.span,
            },
            ast::Stmt::Error(_) => return Err(self.defect("a statement with a syntax error")),
        })
    }

    /// An assignment target (decision 0045): a `var` local followed by struct fields,
    /// array elements and at most one final vector component (the checker accepted
    /// nothing else). The chain is walked from the outside in with a loop.
    fn place(&self, target: &ast::Expr) -> Result<Place, Defect> {
        let types = self.lowering.types;
        let not_assignable = || self.defect("an assignment to a place that is not assignable");
        let type_of = |expr: &ast::Expr| {
            types
                .ty(expr.id)
                .filter(|t| !types.interner().is_error(*t))
                .map(|t| self.display(t))
                .ok_or_else(|| self.defect("a place without a type"))
        };
        let mut steps = Vec::new();
        let mut current = target;
        let root = loop {
            match &current.kind {
                AstExpr::Paren(inner) => current = inner,
                AstExpr::Name(_)
                    if matches!(
                        self.lowering.resolution.res(current.id),
                        Some(Res::Def(def))
                            if self.lowering.resolution.def(def).map(|d| d.kind) == Some(DefKind::State)
                    ) =>
                {
                    let Some(Res::Def(def)) = self.lowering.resolution.res(current.id) else {
                        return Err(not_assignable());
                    };
                    break PlaceRoot::State {
                        owner: self.state_owner(def)?,
                        name: self.lowering.text_name(current),
                        ty: type_of(current)?,
                        span: current.span,
                    };
                }
                AstExpr::Name(_) => {
                    let local = self.local_of(current)?;
                    let item = self
                        .locals
                        .get(local as usize)
                        .ok_or_else(|| self.defect("a place of an undeclared local"))?;
                    if item.kind != LocalKind::Var {
                        return Err(not_assignable());
                    }
                    break PlaceRoot::Local {
                        local,
                        name: item.name.clone(),
                        ty: item.ty.clone(),
                        span: current.span,
                    };
                }
                AstExpr::Field { base, name } => {
                    let ty = type_of(current)?;
                    if let Some(
                        kind @ (FieldKind::EntityState { .. }
                        | FieldKind::ObjectField { .. }
                        | FieldKind::MaterialParam { .. }),
                    ) = types.field_kind(current.id)
                    {
                        break match self.object_read(kind)? {
                            ExprKind::State { owner, name } => PlaceRoot::State {
                                owner,
                                name,
                                ty,
                                span: current.span,
                            },
                            ExprKind::EntityField { entity, field } => PlaceRoot::EntityField {
                                entity,
                                field,
                                ty,
                                span: current.span,
                            },
                            ExprKind::CameraField { camera, field } => PlaceRoot::CameraField {
                                camera,
                                field,
                                ty,
                                span: current.span,
                            },
                            ExprKind::InstanceParam { entity, param } => PlaceRoot::InstanceParam {
                                entity,
                                param,
                                ty,
                                span: current.span,
                            },
                            _ => return Err(not_assignable()),
                        };
                    }
                    match types.field_kind(current.id) {
                        Some(FieldKind::Components(indices))
                            if indices.len() == 1 && steps.is_empty() =>
                        {
                            let index = indices.first().copied().unwrap_or(0);
                            steps.push(PlaceStep::Component {
                                component: u32::try_from(index)
                                    .map_err(|_| self.defect("a component out of range"))?,
                                ty,
                                span: current.span,
                            });
                        }
                        Some(FieldKind::StructField(field)) => {
                            let base_ty = types.ty(base.id).unwrap_or(TyId::ERROR);
                            let index = types
                                .interner()
                                .struct_def(base_ty)
                                .and_then(|def| def.fields.iter().position(|(f, _)| f == field))
                                .and_then(|i| u32::try_from(i).ok())
                                .ok_or_else(|| {
                                    self.defect(&format!("an unknown field '{}'", name.name))
                                })?;
                            steps.push(PlaceStep::Field {
                                field: field.clone(),
                                index,
                                ty,
                                span: current.span,
                            });
                        }
                        _ => return Err(not_assignable()),
                    }
                    current = base;
                }
                AstExpr::Index { base, index } => {
                    let base_ty = types.ty(base.id).unwrap_or(TyId::ERROR);
                    if !matches!(types.interner().get(base_ty), Ty::Array { .. }) {
                        return Err(not_assignable());
                    }
                    steps.push(PlaceStep::Index {
                        index: self.expr(index)?,
                        ty: type_of(current)?,
                        span: current.span,
                    });
                    current = base;
                }
                _ => return Err(not_assignable()),
            }
        };
        steps.reverse();
        let ty = steps
            .last()
            .map_or_else(|| root.ty().to_owned(), |step| step.ty().to_owned());
        Ok(Place {
            root,
            steps,
            ty,
            span: target.span,
        })
    }

    /// The material param a name refers to, in a stage.
    fn param_of(&self, name: &ast::Expr) -> Option<u32> {
        match self.lowering.resolution.res(name.id) {
            Some(Res::Def(def)) => self.params.get(&def).copied(),
            _ => None,
        }
    }

    /// The local a name refers to.
    fn local_of(&self, name: &ast::Expr) -> Result<u32, Defect> {
        match self.lowering.resolution.res(name.id) {
            Some(Res::Def(def)) => self
                .index
                .get(&def)
                .copied()
                .ok_or_else(|| self.defect("a name that is neither a local nor folded")),
            _ => Err(self.defect("an unresolved name")),
        }
    }

    fn expr(&self, expr: &ast::Expr) -> Result<Expr, Defect> {
        let types = self.lowering.types;
        let ty = types
            .ty(expr.id)
            .filter(|t| !types.interner().is_error(*t))
            .ok_or_else(|| self.defect("an expression without a type"))?;
        let make = |kind: ExprKind| Expr {
            kind,
            ty: self.display(ty),
            span: expr.span,
        };
        if let Some(value) = types.value(expr.id) {
            return Ok(make(ExprKind::Const {
                value: value.into(),
            }));
        }
        let boxed = |e: &ast::Expr| self.expr(e).map(Box::new);
        let list = |items: &[ast::Expr]| -> Result<Vec<Expr>, Defect> {
            items.iter().map(|item| self.expr(item)).collect()
        };
        Ok(match &expr.kind {
            AstExpr::Paren(inner) => return self.expr(inner),
            AstExpr::Name(_) => match self.param_of(expr) {
                Some(param) => make(ExprKind::Param {
                    param,
                    name: self.lowering.text_name(expr),
                }),
                None => match self.lowering.resolution.res(expr.id) {
                    Some(Res::Def(def))
                        if self.lowering.resolution.def(def).map(|d| d.kind)
                            == Some(DefKind::State) =>
                    {
                        make(ExprKind::State {
                            owner: self.state_owner(def)?,
                            name: self.lowering.text_name(expr),
                        })
                    }
                    _ => make(ExprKind::Local {
                        local: self.local_of(expr)?,
                        name: self.lowering.text_name(expr),
                    }),
                },
            },
            AstExpr::Unary { op, operand } => make(ExprKind::Unary {
                op: op.symbol(),
                operand: boxed(operand)?,
            }),
            AstExpr::Binary { op, lhs, rhs, .. } => make(ExprKind::Binary {
                op: op.symbol(),
                lhs: boxed(lhs)?,
                rhs: boxed(rhs)?,
            }),
            AstExpr::Call { args, .. } => match types.call_kind(expr.id) {
                Some(CallKind::UserFunction { def, .. }) => make(ExprKind::Call {
                    function: self.lowering.function_symbol(*def)?,
                    args: list(args)?,
                }),
                Some(CallKind::Intrinsic { name, .. }) => make(ExprKind::Builtin {
                    function: (*name).to_owned(),
                    args: list(args)?,
                }),
                Some(CallKind::Namespace {
                    namespace, member, ..
                }) => make(ExprKind::Builtin {
                    function: format!("{namespace}.{member}"),
                    args: list(args)?,
                }),
                Some(CallKind::Vector(_)) => make(ExprKind::Construct { args: list(args)? }),
                Some(CallKind::Conversion(_)) => match args.as_slice() {
                    [arg] => make(ExprKind::Convert { arg: boxed(arg)? }),
                    _ => return Err(self.defect("a conversion without one argument")),
                },
                None => return Err(self.defect("a call that was not resolved")),
            },
            AstExpr::Field { .. } if self.enum_member(expr).is_some() => {
                let (enumeration, member, code) = self
                    .enum_member(expr)
                    .ok_or_else(|| self.defect("an enum member that vanished"))?;
                make(ExprKind::EnumMember {
                    enumeration,
                    member,
                    code,
                })
            }
            AstExpr::Field { base, name } => match types.field_kind(expr.id) {
                Some(
                    kind @ (FieldKind::EntityState { .. }
                    | FieldKind::ObjectField { .. }
                    | FieldKind::MaterialParam { .. }),
                ) => make(self.object_read(kind)?),
                Some(FieldKind::NamespaceValue(full)) => match full.strip_prefix("frame.") {
                    Some(member) => make(ExprKind::Frame {
                        member: member.to_owned(),
                    }),
                    None => return Err(self.defect("a namespace value this build does not lower")),
                },
                Some(FieldKind::Components(indices)) => make(ExprKind::Components {
                    base: boxed(base)?,
                    components: indices
                        .iter()
                        .map(|i| u32::try_from(*i).unwrap_or(0))
                        .collect(),
                }),
                Some(FieldKind::StructField(field)) => {
                    let base_ty = types.ty(base.id).unwrap_or(TyId::ERROR);
                    let index = types
                        .interner()
                        .struct_def(base_ty)
                        .and_then(|def| def.fields.iter().position(|(f, _)| f == field))
                        .and_then(|i| u32::try_from(i).ok())
                        .ok_or_else(|| self.defect(&format!("an unknown field '{}'", name.name)))?;
                    make(ExprKind::Field {
                        base: boxed(base)?,
                        field: field.clone(),
                        index,
                    })
                }
                Some(FieldKind::RecordField { field, index }) => make(ExprKind::Field {
                    base: boxed(base)?,
                    field: (*field).to_owned(),
                    index: u32::try_from(*index).unwrap_or(0),
                }),
                _ => return Err(self.defect("a field read this build does not lower")),
            },
            AstExpr::Index { base, index } => make(ExprKind::Index {
                base: boxed(base)?,
                index: boxed(index)?,
            }),
            AstExpr::Array(items) => make(ExprKind::Array {
                elements: list(items)?,
            }),
            AstExpr::Descriptor { name, fields } => {
                let written: Vec<(&str, &ast::Expr)> = fields
                    .iter()
                    .filter_map(|field| match &field.value {
                        FieldValue::Expr(value) => Some((field.name.name.as_str(), &**value)),
                        FieldValue::Bind(_) => None,
                    })
                    .collect();
                match types.interner().get(ty) {
                    Ty::Struct(_) => {
                        let declared = types
                            .interner()
                            .struct_def(ty)
                            .ok_or_else(|| self.defect("a struct literal of an unknown struct"))?;
                        let mut out = Vec::with_capacity(declared.fields.len());
                        for (field, _) in &declared.fields {
                            let value = written
                                .iter()
                                .find(|(n, _)| n == field)
                                .map(|(_, v)| *v)
                                .ok_or_else(|| {
                                self.defect("a struct literal with a missing field")
                            })?;
                            out.push(NamedExpr {
                                name: field.clone(),
                                value: self.expr(value)?,
                            });
                        }
                        make(ExprKind::Struct { fields: out })
                    }
                    Ty::Schema(schema) => {
                        let mut out = Vec::with_capacity(written.len());
                        for (field, value) in written {
                            out.push(NamedExpr {
                                name: field.to_owned(),
                                value: self.expr(value)?,
                            });
                        }
                        make(ExprKind::Descriptor {
                            schema: schema.to_owned(),
                            fields: out,
                        })
                    }
                    Ty::MaterialInstance(key) => {
                        let summary = self.lowering.materials.get(&key).ok_or_else(|| {
                            self.defect("a material literal of an unknown material")
                        })?;
                        let mut out = Vec::with_capacity(summary.params.len());
                        for param in &summary.params {
                            let value = match written.iter().find(|(n, _)| *n == param.name) {
                                Some((_, value)) => self.expr(value)?,
                                None => Expr {
                                    kind: ExprKind::Const {
                                        value: param.default.clone().ok_or_else(|| {
                                            self.defect("a material literal without a param")
                                        })?,
                                    },
                                    ty: param.ty.clone(),
                                    span: expr.span,
                                },
                            };
                            out.push(NamedExpr {
                                name: param.name.clone(),
                                value,
                            });
                        }
                        make(ExprKind::Material {
                            material: summary.symbol.clone(),
                            params: out,
                        })
                    }
                    _ => {
                        return Err(self.defect(&format!(
                            "a descriptor literal '{}' of a type this build does not lower",
                            name.name
                        )));
                    }
                }
            }
            AstExpr::Int { .. }
            | AstExpr::Float { .. }
            | AstExpr::Str { .. }
            | AstExpr::Color { .. }
            | AstExpr::Bool(_) => return Err(self.defect("a literal that was not folded")),
            AstExpr::SelfValue | AstExpr::Error => {
                return Err(self.defect("an expression this build does not lower"));
            }
        })
    }
}

impl Lowering<'_> {
    /// The symbol of the function a call resolved to: a `fn` of this module
    /// or an imported one (named after the module that declares it).
    pub(super) fn function_symbol(&self, def: DefId) -> Result<Symbol, Defect> {
        let decl = self
            .resolution
            .def(def)
            .ok_or("a call of an unknown declaration")?;
        match decl.kind {
            DefKind::Fn => Ok(Symbol::item(self.path, &decl.name)),
            DefKind::Import => {
                let target = self
                    .resolution
                    .import_target(def)
                    .ok_or("a call of an unbound import")?;
                let path = self
                    .paths
                    .get(&target.module)
                    .ok_or("a call into a module without a path")?;
                Ok(Symbol::item(path, &decl.name))
            }
            _ => Err("a call of something that is not a function".to_owned()),
        }
    }

    /// The name a name expression refers to, as declared.
    fn text_name(&self, expr: &ast::Expr) -> String {
        match &expr.kind {
            AstExpr::Name(name) => name.clone(),
            _ => String::new(),
        }
    }
}

impl Lowering<'_> {
    /// The `bind(..)` of `decl`, in id order, each with its expression lowered (no locals), its
    /// target and dependencies named by static entity index.
    pub(super) fn bindings(
        &self,
        decl: &ast::SceneDecl,
        checked: &crate::types::CheckedScene,
        scene: &Symbol,
        ctx: &SceneCtx,
    ) -> Result<Vec<Binding>, Defect> {
        let infos: Vec<&crate::types::BindInfo> = self
            .types
            .bindings()
            .iter()
            .filter(|b| b.scene == checked.def)
            .collect();
        if infos.is_empty() {
            return Ok(Vec::new());
        }
        let mut sources: BTreeMap<ast::NodeId, &ast::Bind> = BTreeMap::new();
        collect_binds(decl, &mut sources);
        let entity = |def: DefId| -> Result<u32, Defect> {
            ctx.entities
                .get(&def)
                .copied()
                .ok_or_else(|| "a binding names an entity the scene does not have".to_owned())
        };
        let mut out = Vec::with_capacity(infos.len());
        for info in infos {
            let bind = sources
                .get(&info.node)
                .ok_or_else(|| format!("the binding {} has no source", info.id))?;
            let target = match &info.target {
                crate::types::BindTarget::Field { object, field } => {
                    if ctx.cameras.contains_key(object) {
                        BindingTarget::Camera {
                            field: field.clone(),
                        }
                    } else if field == "visible" {
                        BindingTarget::Visible {
                            entity: entity(*object)?,
                        }
                    } else {
                        BindingTarget::Transform {
                            entity: entity(*object)?,
                            field: field.clone(),
                        }
                    }
                }
                crate::types::BindTarget::MaterialParam { entity: e, param } => {
                    BindingTarget::Param {
                        entity: entity(*e)?,
                        name: param.clone(),
                    }
                }
            };
            let mut deps = Vec::with_capacity(info.deps.len());
            for dep in &info.deps {
                deps.push(match dep {
                    crate::types::BindDep::State(def) => BindingDep::State {
                        name: self
                            .types
                            .state(*def)
                            .map(|s| s.name.clone())
                            .ok_or("a binding reads a state that was not checked")?,
                    },
                    crate::types::BindDep::Frame(name) => BindingDep::Frame { name: name.clone() },
                    crate::types::BindDep::Field { object, field } => BindingDep::EntityField {
                        entity: entity(*object)?,
                        field: field.clone(),
                    },
                    crate::types::BindDep::EntityState { entity: e, state } => {
                        BindingDep::EntityState {
                            entity: entity(*e)?,
                            name: self
                                .types
                                .state(*state)
                                .map(|s| s.name.clone())
                                .ok_or("a binding reads a state that was not checked")?,
                        }
                    }
                    crate::types::BindDep::MaterialParam { entity: e, param } => {
                        BindingDep::Param {
                            entity: entity(*e)?,
                            name: param.clone(),
                        }
                    }
                });
            }
            let lowering = FnLowering {
                lowering: self,
                name: format!("binding {}", info.id),
                locals: Vec::new(),
                index: BTreeMap::new(),
                params: BTreeMap::new(),
                scene: Some(ctx),
            };
            out.push(Binding {
                id: info.id,
                symbol: scene.child(&format!("bind_{}", info.id)),
                target,
                deps,
                order: info.order,
                ty: self.type_name(info.ty),
                expr: lowering.expr(&bind.source)?,
                span: info.span,
            });
        }
        Ok(out)
    }
}

/// Every `bind(..)` of the scene's fields, cameras and entities (and their `material` params).
fn collect_binds<'a>(decl: &'a ast::SceneDecl, out: &mut BTreeMap<ast::NodeId, &'a ast::Bind>) {
    use ast::{EntityMember, SceneMember};
    fn field_binds<'a>(field: &'a ast::FieldInit, out: &mut BTreeMap<ast::NodeId, &'a ast::Bind>) {
        match &field.value {
            FieldValue::Bind(bind) => {
                out.insert(bind.id, bind);
            }
            FieldValue::Expr(value) => {
                if let AstExpr::Descriptor { fields, .. } = &value.kind {
                    for param in fields {
                        if let FieldValue::Bind(bind) = &param.value {
                            out.insert(bind.id, bind);
                        }
                    }
                }
            }
        }
    }
    fn entity_binds<'a>(decl: &'a ast::EntityDecl, out: &mut BTreeMap<ast::NodeId, &'a ast::Bind>) {
        for member in &decl.members {
            match member {
                EntityMember::Field(f) => field_binds(f, out),
                EntityMember::Entity(child) => entity_binds(child, out),
                _ => {}
            }
        }
    }
    for member in &decl.members {
        match member {
            SceneMember::Field(f) => field_binds(f, out),
            SceneMember::Object(object) => {
                for f in &object.fields {
                    field_binds(f, out);
                }
            }
            SceneMember::Entity(e) => entity_binds(e, out),
            _ => {}
        }
    }
}
