//! What name resolution produces: a [`DefId`] for every declaration and a
//! side table `NodeId -> Res` for every name (`spec/compiler-architecture.md`
//! section 4.6).

use crate::source::Span;
use crate::syntax::ast::NodeId;

/// Identity of one declaration of the module, dense from 0 in the order the
/// resolver meets the declarations (items first, in source order, then the
/// members of each item; see [`super::resolve_module`]).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct DefId(pub u32);

impl DefId {
    /// The id as an index into [`Resolution::defs`].
    #[must_use]
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

/// What a declaration declares.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum DefKind {
    /// `const` at module level, in a scene, entity or prefab body, or in a
    /// block.
    Const,
    /// `fn` or `cpu fn`.
    Fn,
    Struct,
    Material,
    Prefab,
    Scene,
    /// A name brought in by `import { … }`.
    Import,
    /// `state` of a scene, entity or prefab.
    State,
    /// A scene object (`camera Main { … }`); `kind` is the registered kind
    /// word, `None` for a kind the registry does not know (`E5014`).
    SceneObject {
        kind: Option<&'static str>,
    },
    /// `entity`, at any nesting depth.
    Entity,
    /// `param` of a material or prefab.
    Param,
    /// A parameter of a function, a material stage function, a lifecycle
    /// function or an event handler.
    FnParam,
    /// `let` (`mutable: false`) or `var` (`mutable: true`).
    Local {
        mutable: bool,
    },
    /// The variable of a `for` loop.
    LoopVar,
}

impl DefKind {
    /// The Mtek word for the declaration, as diagnostics use it.
    #[must_use]
    pub fn noun(self) -> &'static str {
        match self {
            DefKind::Const => "constant",
            DefKind::Fn => "function",
            DefKind::Struct => "struct",
            DefKind::Material => "material",
            DefKind::Prefab => "prefab",
            DefKind::Scene => "scene",
            DefKind::Import => "imported name",
            DefKind::State => "state",
            DefKind::SceneObject { kind: Some(kind) } => kind,
            DefKind::SceneObject { kind: None } => "scene object",
            DefKind::Entity => "entity",
            DefKind::Param => "param",
            DefKind::FnParam => "parameter",
            DefKind::Local { mutable: false } => "local",
            DefKind::Local { mutable: true } => "local variable",
            DefKind::LoopVar => "loop variable",
        }
    }

    /// The declarations that may reuse the name of a prelude function: a
    /// local, a parameter, `state` or `param` (`spec/language.md` section
    /// 4.2). Calling the name inside their scope is `E2004`.
    #[must_use]
    pub fn may_hide_prelude_function(self) -> bool {
        matches!(
            self,
            DefKind::State
                | DefKind::Param
                | DefKind::FnParam
                | DefKind::Local { .. }
                | DefKind::LoopVar
        )
    }
}

/// One declaration.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Def {
    pub id: DefId,
    pub kind: DefKind,
    pub name: String,
    /// The span of the declared name.
    pub span: Span,
    /// The declaring node (`ConstDecl`, `EntityDecl`, `Param`, `LocalDecl`,
    /// the `ForStmt` of a loop variable, the import's name `Ident`, …).
    pub node: NodeId,
    /// The declaration this one belongs to: the scene of a top-level entity,
    /// the parent entity of a nested one, the function of a parameter, the
    /// scene, entity or prefab of a `state`, … `None` for module items and
    /// for locals (a local's place is its block).
    pub parent: Option<DefId>,
}

/// A prelude (standard library) item a name denotes. The names are the
/// registry's (`spec/stdlib.md`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum PreludeItem {
    Type(&'static str),
    Schema(&'static str),
    Enum(&'static str),
    Namespace(&'static str),
    Function(&'static str),
    /// `quat.identity`, `frame.time`.
    NamespaceMember {
        namespace: &'static str,
        member: &'static str,
    },
    /// `Key.Space`.
    EnumMember {
        enum_name: &'static str,
        member: &'static str,
    },
    /// The kind word of a scene object (`camera`).
    SceneObject(&'static str),
    /// The event after `on`.
    Event(&'static str),
}

/// What a name resolves to.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Res {
    /// A declaration of the module.
    Def(DefId),
    /// A standard-library item.
    Prelude(PreludeItem),
    /// A field name (`name: value` in a body or descriptor, `.name` after an
    /// expression, a struct field): field names are not in scope and are
    /// resolved against a type by later stages.
    Field,
    /// A name that could not be resolved. A diagnostic has been reported, so
    /// later stages must not report another one for it.
    Error,
}

/// The result of resolving one module.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Resolution {
    pub(super) defs: Vec<Def>,
    pub(super) res: Vec<Option<Res>>,
    pub(super) decls: Vec<Option<DefId>>,
    pub(super) entry_scene: Option<DefId>,
}

impl Resolution {
    /// Every declaration, indexed by [`DefId::index`].
    #[must_use]
    pub fn defs(&self) -> &[Def] {
        &self.defs
    }

    /// The declaration `id`.
    #[must_use]
    pub fn def(&self, id: DefId) -> Option<&Def> {
        self.defs.get(id.index())
    }

    /// What the name at `node` resolves to: the node of a name expression,
    /// of a declared, field or type name ([`Ident`](crate::syntax::ast::Ident)),
    /// of `self`, or of an array length naming a constant. `None` for nodes
    /// that are not names, and for contextual words (lifecycle and stage
    /// function names, event names the registry does not know).
    #[must_use]
    pub fn res(&self, node: NodeId) -> Option<Res> {
        self.res.get(node.index()).copied().flatten()
    }

    /// The declaration introduced by the declaring node `node` (see
    /// [`Def::node`]).
    #[must_use]
    pub fn def_of(&self, node: NodeId) -> Option<DefId> {
        self.decls.get(node.index()).copied().flatten()
    }

    /// The entry scene, once [`crate::check`] has selected it.
    #[must_use]
    pub fn entry_scene(&self) -> Option<DefId> {
        self.entry_scene
    }

    /// Record the selected entry scene.
    pub fn set_entry_scene(&mut self, scene: Option<DefId>) {
        self.entry_scene = scene;
    }

    /// Every `(node, res)` entry of the side table in node order.
    pub fn entries(&self) -> impl Iterator<Item = (NodeId, Res)> + '_ {
        self.res.iter().enumerate().filter_map(|(index, res)| {
            let node = NodeId(u32::try_from(index).ok()?);
            res.map(|res| (node, res))
        })
    }
}
