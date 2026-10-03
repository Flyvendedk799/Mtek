//! The dump of items, members, types and statements, on trees built by hand:
//! the parser for them arrives with M1-05, which adds golden fixtures for the
//! same forms. These tests also walk the tree to check that the AST can carry
//! an id and a span on every node.

use super::*;
use crate::source::{FileId, Span};
use crate::syntax::ast::{
    AssignOp, AssignStmt, BinaryOp, ErrorNode, ExprStmt, Ident, JumpStmt, Node, NodeId, ReturnStmt,
    StrLit,
};
use crate::syntax::walk_module;

/// Builds nodes with consecutive ids and a one-byte span each.
struct Build(u32);

impl Build {
    fn id(&mut self) -> NodeId {
        self.0 += 1;
        NodeId(self.0 - 1)
    }

    fn span(&self) -> Span {
        Span::new(FileId(0), self.0, self.0 + 1)
    }

    fn ident(&mut self, name: &str) -> Ident {
        Ident {
            id: self.id(),
            span: self.span(),
            name: name.to_owned(),
        }
    }

    fn expr(&mut self, kind: ExprKind) -> Expr {
        Expr {
            id: self.id(),
            span: self.span(),
            kind,
        }
    }

    fn name(&mut self, name: &str) -> Expr {
        self.expr(ExprKind::Name(name.to_owned()))
    }

    fn int(&mut self, value: u64) -> Expr {
        self.expr(ExprKind::Int { value: Some(value) })
    }

    fn float(&mut self, value: f64) -> Expr {
        self.expr(ExprKind::Float { value })
    }

    fn ty(&mut self, name: &str) -> Type {
        let ident = self.ident(name);
        Type {
            id: self.id(),
            span: self.span(),
            kind: TypeKind::Named(ident),
        }
    }

    fn array_ty(&mut self, element: &str, length: ArrayLengthKind) -> Type {
        let name = self.ident("array");
        let element = self.ty(element);
        let length = ArrayLength {
            id: self.id(),
            span: self.span(),
            kind: length,
        };
        Type {
            id: self.id(),
            span: self.span(),
            kind: TypeKind::Generic {
                name,
                element: Box::new(element),
                length,
            },
        }
    }

    fn param(&mut self, name: &str, ty: &str) -> Param {
        let name = self.ident(name);
        let ty = self.ty(ty);
        Param {
            id: self.id(),
            span: self.span(),
            name,
            ty,
        }
    }

    fn block(&mut self, stmts: Vec<Stmt>) -> Block {
        Block {
            id: self.id(),
            span: self.span(),
            stmts,
        }
    }

    fn local(&mut self, name: &str, ty: Option<&str>, value: Expr) -> LocalDecl {
        let name = self.ident(name);
        let ty = ty.map(|ty| self.ty(ty));
        LocalDecl {
            id: self.id(),
            span: self.span(),
            name,
            ty,
            value,
        }
    }

    fn const_decl(&mut self, name: &str, ty: Option<&str>, value: Expr) -> ConstDecl {
        let name = self.ident(name);
        let ty = ty.map(|ty| self.ty(ty));
        ConstDecl {
            id: self.id(),
            span: self.span(),
            name,
            ty,
            value,
        }
    }

    fn init(&mut self, name: &str, value: FieldValue) -> FieldInit {
        let name = self.ident(name);
        FieldInit {
            id: self.id(),
            span: self.span(),
            name,
            value,
        }
    }

    fn item(&mut self, export: bool, kind: ItemKind) -> Item {
        Item {
            id: self.id(),
            span: self.span(),
            export,
            kind,
        }
    }

    fn error(&mut self) -> ErrorNode {
        ErrorNode {
            id: self.id(),
            span: self.span(),
        }
    }

    fn jump(&mut self) -> JumpStmt {
        JumpStmt {
            id: self.id(),
            span: self.span(),
        }
    }

    fn param_decl(&mut self, name: &str, ty: &str, default: Option<Expr>) -> ParamDecl {
        let name = self.ident(name);
        let ty = self.ty(ty);
        ParamDecl {
            id: self.id(),
            span: self.span(),
            name,
            ty,
            default,
        }
    }

    fn struct_field(&mut self, name: &str, ty: Type) -> StructField {
        let name = self.ident(name);
        StructField {
            id: self.id(),
            span: self.span(),
            name,
            ty,
        }
    }
}

/// `cpu fn tick(dt: f32) -> f32 { ... }` with every statement.
fn function(b: &mut Build) -> Item {
    let name = b.ident("tick");
    let params = vec![b.param("dt", "f32")];
    let ret = Some(b.ty("f32"));
    let dt = b.name("dt");
    let let_x = Stmt::Let(b.local("x", Some("f32"), dt));
    let x = b.name("x");
    let var_y = Stmt::Var(b.local("y", None, x));
    let target = b.name("y");
    let one = b.float(1.0);
    let assign = Stmt::Assign(AssignStmt {
        id: b.id(),
        span: b.span(),
        target,
        op: AssignOp::Add,
        op_span: b.span(),
        value: one,
    });
    let callee = b.name("print");
    let arg = b.expr(ExprKind::Str {
        value: "hi".to_owned(),
    });
    let call = b.expr(ExprKind::Call {
        callee: Box::new(callee),
        args: vec![arg],
    });
    let call = Stmt::Expr(ExprStmt {
        id: b.id(),
        span: b.span(),
        expr: call,
    });
    // if y < 2.0 { break; } else if true { continue; } else { }
    let lhs = b.name("y");
    let rhs = b.float(2.0);
    let cond = b.expr(ExprKind::Binary {
        op: BinaryOp::Lt,
        op_span: b.span(),
        lhs: Box::new(lhs),
        rhs: Box::new(rhs),
    });
    let brk = Stmt::Break(b.jump());
    let then_block = b.block(vec![brk]);
    let inner_cond = b.expr(ExprKind::Bool(true));
    let cont = Stmt::Continue(b.jump());
    let inner_then = b.block(vec![cont]);
    let inner_else = b.block(vec![]);
    let inner = IfStmt {
        id: b.id(),
        span: b.span(),
        cond: inner_cond,
        then_block: inner_then,
        else_branch: Some(ElseBranch::Block(inner_else)),
    };
    let if_stmt = Stmt::If(IfStmt {
        id: b.id(),
        span: b.span(),
        cond,
        then_block,
        else_branch: Some(ElseBranch::If(Box::new(inner))),
    });
    // for i in 0..4 { }   for v in values { }
    let var = b.ident("i");
    let (start, end) = (b.int(0), b.int(4));
    let body = b.block(vec![]);
    let for_range = Stmt::For(ForStmt {
        id: b.id(),
        span: b.span(),
        var,
        iter: ForIter::Range { start, end },
        body,
    });
    let var = b.ident("v");
    let values = b.name("values");
    let body = b.block(vec![]);
    let for_each = Stmt::For(ForStmt {
        id: b.id(),
        span: b.span(),
        var,
        iter: ForIter::Each(values),
        body,
    });
    let one = b.int(1);
    let local_const = Stmt::Const(b.const_decl("K", None, one));
    let error = Stmt::Error(b.error());
    let nested = Stmt::Block(b.block(vec![error]));
    let y = b.name("y");
    let ret_value = Stmt::Return(ReturnStmt {
        id: b.id(),
        span: b.span(),
        value: Some(y),
    });
    let ret_unit = Stmt::Return(ReturnStmt {
        id: b.id(),
        span: b.span(),
        value: None,
    });
    let body = b.block(vec![
        let_x,
        var_y,
        assign,
        call,
        if_stmt,
        for_range,
        for_each,
        local_const,
        nested,
        ret_value,
        ret_unit,
    ]);
    let function = FnDecl {
        id: b.id(),
        span: b.span(),
        cpu: true,
        name,
        params,
        ret,
        body,
    };
    b.item(false, ItemKind::Fn(function))
}

/// `struct Light { ... }` with array types of both length forms.
fn light(b: &mut Build) -> Item {
    let name = b.ident("Light");
    let power = b.ty("f32");
    let samples = b.array_ty("vec3", ArrayLengthKind::Int { value: Some(4) });
    let extra = b.array_ty("f32", ArrayLengthKind::Name("COUNT".to_owned()));
    let fields = vec![
        b.struct_field("power", power),
        b.struct_field("samples", samples),
        b.struct_field("extra", extra),
    ];
    let decl = StructDecl {
        id: b.id(),
        span: b.span(),
        name,
        fields,
    };
    b.item(false, ItemKind::Struct(decl))
}

fn material(b: &mut Build) -> Item {
    let name = b.ident("Pulse");
    let zero = b.float(0.0);
    let phase = b.param_decl("phase", "f32", Some(zero));
    let tint = b.param_decl("tint", "color", None);
    let stage_name = b.ident("fragment");
    let params = vec![b.param("input", "SurfaceInput")];
    let ret = Some(b.ty("color"));
    let body = b.block(vec![]);
    let stage = StageFn {
        id: b.id(),
        span: b.span(),
        name: stage_name,
        params,
        ret,
        body,
    };
    let error = b.error();
    let decl = MaterialDecl {
        id: b.id(),
        span: b.span(),
        name,
        members: vec![
            MaterialMember::Param(phase),
            MaterialMember::Param(tint),
            MaterialMember::Stage(stage),
            MaterialMember::Error(error),
        ],
    };
    b.item(true, ItemKind::Material(decl))
}

fn prefab(b: &mut Build) -> Item {
    let name = b.ident("Bullet");
    let one = b.float(1.0);
    let speed = b.param_decl("speed", "f32", Some(one));
    let callee = b.name("vec3");
    let arg = b.float(0.0);
    let value = b.expr(ExprKind::Call {
        callee: Box::new(callee),
        args: vec![arg],
    });
    let position = b.init("position", FieldValue::Expr(Box::new(value)));
    let decl = PrefabDecl {
        id: b.id(),
        span: b.span(),
        name,
        members: vec![EntityMember::Param(speed), EntityMember::Field(position)],
    };
    b.item(false, ItemKind::Prefab(decl))
}

fn scene(b: &mut Build) -> Item {
    let name = b.ident("Demo");
    let color = b.expr(ExprKind::Color {
        rgba: [0x10, 0x14, 0x18, 255],
    });
    let clear = b.init("clear_color", FieldValue::Expr(Box::new(color)));
    let nine = b.int(9);
    let scene_const = b.const_decl("LIMIT", None, nine);
    let state_name = b.ident("speed");
    let state_ty = b.ty("f32");
    let state_value = b.float(0.7);
    let state = StateDecl {
        id: b.id(),
        span: b.span(),
        name: state_name,
        ty: state_ty,
        value: state_value,
    };
    let kind = b.ident("camera");
    let camera_name = b.ident("Main");
    let fov = b.float(1.5);
    let fields = vec![b.init("fov", FieldValue::Expr(Box::new(fov)))];
    let camera = SceneObject {
        id: b.id(),
        span: b.span(),
        kind,
        name: camera_name,
        fields,
    };
    let entity_name = b.ident("Shot");
    let prefab = Some(b.ident("Bullet"));
    let source = b.name("speed");
    let bind = FieldValue::Bind(Bind {
        id: b.id(),
        span: b.span(),
        source: Box::new(source),
    });
    let members = vec![EntityMember::Field(b.init("speed", bind))];
    let entity = EntityDecl {
        id: b.id(),
        span: b.span(),
        name: entity_name,
        prefab,
        members,
    };
    let update_name = b.ident("update");
    let params = vec![b.param("dt", "f32")];
    let body = b.block(vec![]);
    let update = LifecycleFn {
        id: b.id(),
        span: b.span(),
        name: update_name,
        params,
        body,
    };
    let event = b.ident("collision_enter");
    let base = b.name("Key");
    let space = b.ident("Space");
    let filter = b.expr(ExprKind::Field {
        base: Box::new(base),
        name: space,
    });
    let args = vec![
        HandlerArg::Filter(filter),
        HandlerArg::Param(b.param("other", "entity_ref")),
    ];
    let body = b.block(vec![]);
    let handler = Handler {
        id: b.id(),
        span: b.span(),
        event,
        args,
        body,
    };
    let error = b.error();
    let decl = SceneDecl {
        id: b.id(),
        span: b.span(),
        name,
        members: vec![
            SceneMember::Field(clear),
            SceneMember::Const(scene_const),
            SceneMember::State(state),
            SceneMember::Object(camera),
            SceneMember::Entity(entity),
            SceneMember::Lifecycle(update),
            SceneMember::Handler(handler),
            SceneMember::Error(error),
        ],
    };
    b.item(false, ItemKind::Scene(decl))
}

/// A module with every kind of item, member, type and statement.
fn module() -> Module {
    let mut b = Build(0);
    let source = StrLit {
        id: b.id(),
        span: b.span(),
        value: Some("./shapes.mtek".to_owned()),
    };
    let names = vec![b.ident("Ring"), b.ident("Disc")];
    let import = ImportDecl {
        id: b.id(),
        span: b.span(),
        names,
        source,
    };
    let import = b.item(false, ItemKind::Import(import));
    let three = b.int(3);
    let konst = b.const_decl("COUNT", Some("i32"), three);
    let konst = b.item(true, ItemKind::Const(konst));
    let items = vec![
        import,
        konst,
        function(&mut b),
        light(&mut b),
        material(&mut b),
        prefab(&mut b),
        scene(&mut b),
        b.item(false, ItemKind::Error),
    ];
    Module {
        id: b.id(),
        span: b.span(),
        items,
        node_count: b.0,
    }
}

#[test]
fn every_item_member_type_and_statement_dumps() {
    let expected = "\
(module
  (import \"./shapes.mtek\" Ring Disc)
  (export (const COUNT (type i32) (lit int 3)))
  (cpu-fn tick
    (params (param dt (type f32)))
    (ret (type f32))
    (block
      (let x (type f32) (name dt))
      (var y (name x))
      (assign += (name y) (lit float 1.0))
      (expr (call (name print) (lit string \"hi\")))
      (if
        (binary < (name y) (lit float 2.0))
        (block (break))
        (if (lit bool true) (block (continue)) (block)))
      (for i (range (lit int 0) (lit int 4)) (block))
      (for v (each (name values)) (block))
      (const K (lit int 1))
      (block (error))
      (return (name y))
      (return)))
  (struct Light
    (field power (type f32))
    (field samples (type array (type vec3) (len 4)))
    (field extra (type array (type f32) (len COUNT))))
  (export
    (material Pulse
      (param phase (type f32) (lit float 0.0))
      (param tint (type color))
      (stage fragment
        (params (param input (type SurfaceInput)))
        (ret (type color))
        (block))
      (error)))
  (prefab Bullet
    (param speed (type f32) (lit float 1.0))
    (init position (call (name vec3) (lit float 0.0))))
  (scene Demo
    (init clear_color (lit color #101418))
    (const LIMIT (lit int 9))
    (state speed (type f32) (lit float 0.7))
    (object camera Main (init fov (lit float 1.5)))
    (entity Shot (prefab Bullet) (init speed (bind (name speed))))
    (lifecycle update (params (param dt (type f32))) (block))
    (on collision_enter
      (filter (field (name Key) Space))
      (param other (type entity_ref))
      (block))
    (error))
  (error))
";
    assert_eq!(dump_module(&module()), expected);
}

#[test]
fn the_hand_built_tree_has_unique_ids_below_node_count() {
    let module = module();
    let mut ids = Vec::new();
    walk_module(&module, &mut |info, parent| {
        ids.push(info.id.0);
        if let Some(parent) = parent {
            assert!(parent.id > info.id, "{} {}", parent.kind, info.kind);
        }
    });
    ids.sort_unstable();
    let expected: Vec<u32> = (0..module.node_count).collect();
    assert_eq!(ids, expected, "the walk reaches every node that was built");
    assert_eq!(module.id().0, module.node_count - 1);
}

#[test]
fn dump_covers_overflowing_literals_and_error_types() {
    let mut b = Build(0);
    let ty = Type {
        id: b.id(),
        span: b.span(),
        kind: TypeKind::Error,
    };
    assert_eq!(render(&type_sexp(&ty)), "(type (error))\n");
    let length = ArrayLength {
        id: b.id(),
        span: b.span(),
        kind: ArrayLengthKind::Int { value: None },
    };
    assert_eq!(render(&length_sexp(&length)), "(len overflow)\n");
    let length = ArrayLength {
        id: b.id(),
        span: b.span(),
        kind: ArrayLengthKind::Error,
    };
    assert_eq!(render(&length_sexp(&length)), "(len (error))\n");
    let source = StrLit {
        id: b.id(),
        span: b.span(),
        value: None,
    };
    let decl = ImportDecl {
        id: b.id(),
        span: b.span(),
        names: Vec::new(),
        source,
    };
    assert_eq!(render(&import_sexp(&decl)), "(import malformed)\n");
}

#[test]
fn the_node_trait_reaches_id_and_span_of_every_enum() {
    let mut b = Build(10);
    let stmt = Stmt::Break(b.jump());
    assert_eq!(stmt.id(), NodeId(10));
    assert_eq!(stmt.span(), Span::new(FileId(0), 11, 12));
    let arg = HandlerArg::Filter(b.name("x"));
    assert_eq!(arg.id(), NodeId(11));
    let value = FieldValue::Expr(Box::new(b.name("y")));
    assert_eq!(value.id(), NodeId(12));
}
