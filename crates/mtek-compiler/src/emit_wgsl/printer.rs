//! The WGSL printer (`spec/compiler-architecture.md` section 7.2): shader IR in, WGSL text
//! and its span map out.
//!
//! The printer walks IR nodes only; it never splices pre-written WGSL. Formatting is
//! fixed so that output is byte-identical across runs and the line/column span map stays
//! meaningful:
//!
//! - 4-space indentation, one struct member, global or statement per line, `\n` line ends
//!   and a final line break; `if`, `for` and blocks put their header (`if c {`,
//!   `} else if c {`, `} else {`, `for (..) {`, `{`) and their closing `}` on lines of
//!   their own;
//! - declarations in module order: structs (a blank line between two), the globals as one
//!   group, then functions (a blank line before each); an entry point's stage attribute
//!   sits on its own line above `fn`;
//! - an operand of a binary or unary operator, and the base of a field access, swizzle or
//!   index, is parenthesised when it is itself an operator expression or a negative
//!   literal (WGSL forbids mixing some operators without parentheses; this rule never
//!   needs to know which);
//! - generated names get the reserved `mtek_` prefix and user names become
//!   `u_<kind>_<name>`;
//! - literals: `f32` as the shortest text that reads back as the same binary32 value
//!   (also through a binary64 reading, as WGSL's abstract floats are read), `i32` with
//!   the suffix `i` (the minimum as `i32(-2147483647 - 1)`, `spec/language.md` 6.6),
//!   `u32` with `u`.
//!
//! Every declaration line, member, parameter, statement and expression adds a span-map
//! entry with the node's span. Generated WGSL is ASCII, so columns are bytes.

use std::cmp::Reverse;

use crate::lowering::shader_ir::{
    BuiltinValue, Expr, ExprKind, Function, FunctionParam, GlobalDecl, GlobalKind, IoBinding,
    Literal, Name, Scalar, ShaderModule, ShaderStage, ShaderType, Statement, StructDecl,
    StructMember,
};
use crate::source::Span;

use super::span_map::{SpanMap, SpanMapEntry, WgslRange};

/// The reserved prefix of generated identifiers.
pub const GENERATED_PREFIX: &str = "mtek_";

const INDENT: &str = "    ";

/// A printed module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrintedModule {
    pub text: String,
    pub span_map: SpanMap,
}

/// Prints `module` as WGSL and builds its span map.
pub fn print_module(module: &ShaderModule) -> PrintedModule {
    let mut printer = Printer {
        out: String::new(),
        line: String::new(),
        line_number: 1,
        entries: Vec::new(),
    };
    let mut first = true;
    for decl in &module.structs {
        if !first {
            printer.end_line();
        }
        first = false;
        printer.struct_decl(decl, &module.symbol);
    }
    if !module.globals.is_empty() {
        if !first {
            printer.end_line();
        }
        first = false;
        for global in &module.globals {
            printer.global(global, &module.symbol);
        }
    }
    for function in &module.functions {
        if !first {
            printer.end_line();
        }
        first = false;
        printer.function(function);
    }
    let mut entries = printer.entries;
    entries.sort_by_key(|e| (e.wgsl.line, e.wgsl.col_start, Reverse(e.wgsl.col_end)));
    PrintedModule {
        text: printer.out,
        span_map: SpanMap {
            symbol: module.symbol.clone(),
            declaration: module.span,
            entries,
        },
    }
}

/// The printed form of a name.
pub fn mangle(name: &Name) -> String {
    match name {
        Name::Generated(suffix) => format!("{GENERATED_PREFIX}{suffix}"),
        Name::User { kind, name } => format!("u_{}_{name}", kind.tag()),
    }
}

/// The WGSL spelling of a type.
pub fn type_text(ty: &ShaderType) -> String {
    match ty {
        ShaderType::Scalar(scalar) => scalar_text(*scalar).to_owned(),
        ShaderType::Vector { size, scalar } => {
            format!("vec{}<{}>", size.count(), scalar_text(*scalar))
        }
        ShaderType::Mat4 => "mat4x4<f32>".to_owned(),
        ShaderType::Struct(name) => name.clone(),
        ShaderType::Array { element, length } => {
            format!("array<{}, {length}>", type_text(element))
        }
    }
}

fn scalar_text(scalar: Scalar) -> &'static str {
    match scalar {
        Scalar::Bool => "bool",
        Scalar::I32 => "i32",
        Scalar::U32 => "u32",
        Scalar::F32 => "f32",
    }
}

fn binding_text(binding: IoBinding) -> String {
    match binding {
        IoBinding::Builtin(BuiltinValue::Position) => "@builtin(position)".to_owned(),
        IoBinding::Location(location) => format!("@location({location})"),
    }
}

/// The text of an `f32` literal: the shortest text that reads back as `value`, both
/// directly as binary32 and as binary64 rounded to binary32 (how WGSL reads an abstract
/// float literal); where the two readings could differ (a shortest text close to the
/// midpoint of two binary32 values), the binary64 text of the value, which reads back
/// exactly either way.
fn f32_text(value: f32) -> String {
    // `Debug` always has a `.` or an exponent (`1.0`, `0.1`, `1e-7`), which WGSL reads as
    // a float literal.
    let shortest = format!("{value:?}");
    let through_f64 = shortest
        .parse::<f64>()
        .ok()
        .map(|wide| (wide as f32).to_bits());
    if through_f64 == Some(value.to_bits()) {
        shortest
    } else {
        format!("{:?}", f64::from(value))
    }
}

fn literal_text(literal: Literal) -> String {
    match literal {
        Literal::Bool(value) => value.to_string(),
        // WGSL has no literal for the minimum (`-2147483648i` would negate an
        // out-of-range `2147483648i`); `spec/language.md` section 6.6 fixes this form.
        Literal::I32(i32::MIN) => "i32(-2147483647 - 1)".to_owned(),
        Literal::I32(value) => format!("{value}i"),
        Literal::U32(value) => format!("{value}u"),
        Literal::F32(value) => f32_text(value.get()),
    }
}

/// Whether `expr` needs parentheses as an operand or as the base of an access.
fn needs_parentheses(expr: &Expr) -> bool {
    match &expr.kind {
        ExprKind::Binary { .. } | ExprKind::Unary { .. } => true,
        ExprKind::Literal(literal) => literal_text(*literal).starts_with('-'),
        _ => false,
    }
}

struct Printer {
    out: String,
    /// The line being built (without its line break).
    line: String,
    /// 1-based number of `line`.
    line_number: u32,
    entries: Vec<SpanMapEntry>,
}

impl Printer {
    /// The 1-based column of the next character (generated WGSL is ASCII: bytes are
    /// characters).
    fn column(&self) -> u32 {
        u32::try_from(self.line.len())
            .unwrap_or(u32::MAX)
            .saturating_add(1)
    }

    fn push(&mut self, text: &str) {
        self.line.push_str(text);
    }

    fn indent(&mut self, depth: usize) {
        for _ in 0..depth {
            self.line.push_str(INDENT);
        }
    }

    fn end_line(&mut self) {
        self.out.push_str(&self.line);
        self.out.push('\n');
        self.line.clear();
        self.line_number = self.line_number.saturating_add(1);
    }

    /// Records the text printed on this line since `start` as originating from `span`.
    fn record(&mut self, start: u32, span: Span, symbol: &str) {
        let end = self.column();
        if end > start {
            self.entries.push(SpanMapEntry {
                wgsl: WgslRange {
                    line: self.line_number,
                    col_start: start,
                    col_end: end,
                },
                span,
                symbol: symbol.to_owned(),
            });
        }
    }

    fn struct_decl(&mut self, decl: &StructDecl, symbol: &str) {
        let start = self.column();
        self.push("struct ");
        self.push(&decl.name);
        self.push(" {");
        self.record(start, decl.span, symbol);
        self.end_line();
        for member in &decl.members {
            self.struct_member(member, symbol);
        }
        self.push("}");
        self.end_line();
    }

    fn struct_member(&mut self, member: &StructMember, symbol: &str) {
        self.push(INDENT);
        let start = self.column();
        if let Some(binding) = member.binding {
            self.push(&binding_text(binding));
            self.push(" ");
        }
        if let Some(align) = member.align {
            self.push(&format!("@align({align}) "));
        }
        if let Some(size) = member.size {
            self.push(&format!("@size({size}) "));
        }
        self.push(&member.name);
        self.push(": ");
        self.push(&type_text(&member.ty));
        self.push(",");
        self.record(start, member.span, symbol);
        self.end_line();
    }

    fn global(&mut self, global: &GlobalDecl, symbol: &str) {
        let start = self.column();
        match &global.kind {
            GlobalKind::Uniform { group, binding, ty } => {
                self.push(&format!(
                    "@group({group}) @binding({binding}) var<uniform> "
                ));
                self.push(&mangle(&global.name));
                self.push(": ");
                self.push(&type_text(ty));
                self.push(";");
            }
        }
        self.record(start, global.span, symbol);
        self.end_line();
    }

    fn function(&mut self, function: &Function) {
        let symbol = function.symbol.as_str();
        if let Some(stage) = function.stage {
            let start = self.column();
            self.push(match stage {
                ShaderStage::Vertex => "@vertex",
                ShaderStage::Fragment => "@fragment",
            });
            self.record(start, function.span, symbol);
            self.end_line();
        }
        let start = self.column();
        self.push("fn ");
        self.push(&mangle(&function.name));
        self.push("(");
        for (index, param) in function.params.iter().enumerate() {
            if index > 0 {
                self.push(", ");
            }
            self.param(param, symbol);
        }
        self.push(")");
        if let Some(result) = &function.result {
            self.push(" -> ");
            if let Some(binding) = result.binding {
                self.push(&binding_text(binding));
                self.push(" ");
            }
            self.push(&type_text(&result.ty));
        }
        self.push(" {");
        self.record(start, function.span, symbol);
        self.end_line();
        self.statements(&function.body, 1, symbol);
        self.push("}");
        self.end_line();
    }

    fn param(&mut self, param: &FunctionParam, symbol: &str) {
        let start = self.column();
        if let Some(binding) = param.binding {
            self.push(&binding_text(binding));
            self.push(" ");
        }
        self.push(&mangle(&param.name));
        self.push(": ");
        self.push(&type_text(&param.ty));
        self.record(start, param.span, symbol);
    }

    fn statements(&mut self, statements: &[Statement], depth: usize, symbol: &str) {
        for statement in statements {
            self.statement(statement, depth, symbol);
        }
    }

    /// Prints `statement` on its own line(s) at indentation `depth`.
    fn statement(&mut self, statement: &Statement, depth: usize, symbol: &str) {
        self.indent(depth);
        let start = self.column();
        let span = statement.span();
        match statement {
            Statement::Let { name, value, .. } | Statement::Var { name, value, .. } => {
                self.push(if matches!(statement, Statement::Let { .. }) {
                    "let "
                } else {
                    "var "
                });
                self.push(&mangle(name));
                self.push(" = ");
                self.expr(value, symbol);
                self.push(";");
            }
            Statement::Assign { target, value, .. } => {
                self.expr(target, symbol);
                self.push(" = ");
                self.expr(value, symbol);
                self.push(";");
            }
            Statement::If {
                branches,
                otherwise,
                ..
            } => {
                for (index, (condition, body)) in branches.iter().enumerate() {
                    if index > 0 {
                        self.indent(depth);
                    }
                    let header = self.column();
                    self.push(if index == 0 { "if " } else { "} else if " });
                    self.expr(condition, symbol);
                    self.push(" {");
                    self.record(header, span, symbol);
                    self.end_line();
                    self.statements(body, depth + 1, symbol);
                }
                if let Some(body) = otherwise {
                    self.indent(depth);
                    let header = self.column();
                    self.push("} else {");
                    self.record(header, span, symbol);
                    self.end_line();
                    self.statements(body, depth + 1, symbol);
                }
                self.indent(depth);
                self.push("}");
                self.end_line();
                return;
            }
            Statement::For {
                name,
                start: from,
                end,
                body,
                ..
            } => {
                let counter = mangle(name);
                self.push("for (var ");
                self.push(&counter);
                self.push(" = ");
                self.expr(from, symbol);
                self.push("; ");
                self.push(&counter);
                self.push(" < ");
                self.expr(end, symbol);
                self.push("; ");
                self.push(&counter);
                self.push("++) {");
                self.record(start, span, symbol);
                self.end_line();
                self.statements(body, depth + 1, symbol);
                self.indent(depth);
                self.push("}");
                self.end_line();
                return;
            }
            Statement::Block { body, .. } => {
                self.push("{");
                self.record(start, span, symbol);
                self.end_line();
                self.statements(body, depth + 1, symbol);
                self.indent(depth);
                self.push("}");
                self.end_line();
                return;
            }
            Statement::Break { .. } => self.push("break;"),
            Statement::Continue { .. } => self.push("continue;"),
            Statement::Call { function, args, .. } => {
                self.push(&mangle(function));
                self.arguments(args, symbol);
                self.push(";");
            }
            Statement::Discard { value, .. } => {
                self.push("_ = ");
                self.expr(value, symbol);
                self.push(";");
            }
            Statement::Return { value, .. } => {
                self.push("return");
                if let Some(value) = value {
                    self.push(" ");
                    self.expr(value, symbol);
                }
                self.push(";");
            }
        }
        self.record(start, span, symbol);
        self.end_line();
    }

    /// Prints `expr`, parenthesised when [`needs_parentheses`] says so.
    fn operand(&mut self, expr: &Expr, symbol: &str) {
        if needs_parentheses(expr) {
            self.push("(");
            self.expr(expr, symbol);
            self.push(")");
        } else {
            self.expr(expr, symbol);
        }
    }

    fn arguments(&mut self, args: &[Expr], symbol: &str) {
        self.push("(");
        for (index, arg) in args.iter().enumerate() {
            if index > 0 {
                self.push(", ");
            }
            self.expr(arg, symbol);
        }
        self.push(")");
    }

    fn expr(&mut self, expr: &Expr, symbol: &str) {
        let start = self.column();
        match &expr.kind {
            ExprKind::Literal(literal) => self.push(&literal_text(*literal)),
            ExprKind::Local(name) | ExprKind::Global(name) => self.push(&mangle(name)),
            ExprKind::Field { base, member } => {
                self.operand(base, symbol);
                self.push(".");
                self.push(member);
            }
            ExprKind::Swizzle { base, components } => {
                self.operand(base, symbol);
                self.push(".");
                let letters: String = components.iter().map(|c| c.letter()).collect();
                self.push(&letters);
            }
            ExprKind::Index { base, index } => {
                self.operand(base, symbol);
                self.push("[");
                self.expr(index, symbol);
                self.push("]");
            }
            ExprKind::Construct { args } => {
                self.push(&type_text(&expr.ty));
                self.arguments(args, symbol);
            }
            ExprKind::Binary { op, left, right } => {
                self.operand(left, symbol);
                self.push(" ");
                self.push(op.text());
                self.push(" ");
                self.operand(right, symbol);
            }
            ExprKind::Unary { op, operand } => {
                self.push(op.text());
                self.operand(operand, symbol);
            }
            ExprKind::Bitcast { arg } => {
                self.push("bitcast<");
                self.push(&type_text(&expr.ty));
                self.push(">(");
                self.expr(arg, symbol);
                self.push(")");
            }
            ExprKind::Bool32Encode { value } => {
                self.push("select(0u, 1u, ");
                self.expr(value, symbol);
                self.push(")");
            }
            ExprKind::Bool32Decode { value } => {
                self.push("(");
                self.operand(value, symbol);
                self.push(" != 0u)");
            }
            ExprKind::Intrinsic { function, args } => {
                self.push(function.wgsl_name());
                self.arguments(args, symbol);
            }
            ExprKind::Call { function, args } => {
                self.push(&mangle(function));
                self.arguments(args, symbol);
            }
        }
        self.record(start, expr.span, symbol);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lowering::shader_ir::{
        BinaryOp, Component, FiniteF32, FunctionResult, UserNameKind, VectorSize,
    };
    use crate::source::FileId;

    fn at(start: u32) -> Span {
        Span::new(FileId(2), start, start + 1)
    }

    fn uniform(name: &str, group: u32, ty: ShaderType) -> GlobalDecl {
        GlobalDecl {
            name: Name::generated(name),
            kind: GlobalKind::Uniform {
                group,
                binding: 0,
                ty,
            },
            span: at(1),
        }
    }

    #[test]
    fn names_are_mangled_with_their_prefixes() {
        assert_eq!(mangle(&Name::generated("world")), "mtek_world");
        assert_eq!(
            mangle(&Name::user(UserNameKind::Function, "pulse")),
            "u_fn_pulse"
        );
        assert_eq!(
            mangle(&Name::user(UserNameKind::Local, "texel")),
            "u_l_texel"
        );
        assert_eq!(
            mangle(&Name::user(UserNameKind::Param, "surface")),
            "u_p_surface"
        );
    }

    #[test]
    fn types_print_in_wgsl_spelling() {
        assert_eq!(type_text(&ShaderType::VEC3), "vec3<f32>");
        assert_eq!(
            type_text(&ShaderType::Vector {
                size: VectorSize::Two,
                scalar: Scalar::U32
            }),
            "vec2<u32>"
        );
        assert_eq!(type_text(&ShaderType::Mat4), "mat4x4<f32>");
        assert_eq!(type_text(&ShaderType::Scalar(Scalar::Bool)), "bool");
        assert_eq!(
            type_text(&ShaderType::Array {
                element: Box::new(ShaderType::named("MtekPad16_f32")),
                length: 3
            }),
            "array<MtekPad16_f32, 3>"
        );
    }

    #[test]
    fn literals_read_back_as_the_same_value() {
        let f = |v: f32| literal_text(Literal::F32(FiniteF32::new(v).expect("finite")));
        assert_eq!(f(1.0), "1.0");
        assert_eq!(f(0.0), "0.0");
        assert_eq!(f(0.1), "0.1");
        assert_eq!(f(-0.5), "-0.5");
        assert_eq!(f(1e-7), "1e-7");
        assert_eq!(f(3.0e20), "3e20");
        assert_eq!(literal_text(Literal::U32(7)), "7u");
        assert_eq!(literal_text(Literal::I32(-3)), "-3i");
        assert_eq!(literal_text(Literal::I32(i32::MIN)), "i32(-2147483647 - 1)");
        assert_eq!(literal_text(Literal::Bool(true)), "true");
    }

    fn vertex_like_module() -> ShaderModule {
        let mut module = ShaderModule::new("src/main.mtek::M", at(0));
        let object = uniform("object", 2, ShaderType::named("MtekObject"));
        module.structs.push(StructDecl {
            name: "MtekObject".to_owned(),
            members: vec![StructMember {
                name: "model".to_owned(),
                ty: ShaderType::Mat4,
                align: None,
                size: None,
                binding: None,
                span: at(3),
            }],
            span: at(2),
        });
        module.structs.push(StructDecl {
            name: "MtekOut".to_owned(),
            members: vec![StructMember {
                name: "clip".to_owned(),
                ty: ShaderType::VEC4,
                align: None,
                size: None,
                binding: Some(IoBinding::Builtin(BuiltinValue::Position)),
                span: at(4),
            }],
            span: at(4),
        });
        let position = Expr::local(Name::generated("position"), ShaderType::VEC3, at(10));
        let one = Expr::f32(FiniteF32::ONE, at(11));
        let world = Expr::binary(
            BinaryOp::Multiply,
            Expr::global(&object, at(12)).field("model", ShaderType::Mat4, at(13)),
            Expr::construct(ShaderType::VEC4, vec![position, one], at(14)),
            ShaderType::VEC4,
            at(15),
        );
        let normalised = world
            .clone()
            .swizzle(&[Component::X, Component::Y, Component::Z], at(16))
            .normalize(at(17));
        module.globals.push(object);
        module.functions.push(Function {
            name: Name::generated("vs"),
            stage: Some(ShaderStage::Vertex),
            params: vec![FunctionParam {
                name: Name::generated("position"),
                ty: ShaderType::VEC3,
                binding: Some(IoBinding::Location(0)),
                span: at(5),
            }],
            result: Some(FunctionResult {
                ty: ShaderType::named("MtekOut"),
                binding: None,
            }),
            body: vec![
                Statement::Let {
                    name: Name::generated("n"),
                    value: normalised,
                    span: at(20),
                },
                Statement::Return {
                    value: Some(Expr::construct(
                        ShaderType::named("MtekOut"),
                        vec![world],
                        at(21),
                    )),
                    span: at(22),
                },
            ],
            symbol: "src/main.mtek::M".to_owned(),
            span: at(6),
        });
        module
    }

    const VERTEX_LIKE: &str = "struct MtekObject {\n\
        \x20   model: mat4x4<f32>,\n\
        }\n\
        \n\
        struct MtekOut {\n\
        \x20   @builtin(position) clip: vec4<f32>,\n\
        }\n\
        \n\
        @group(2) @binding(0) var<uniform> mtek_object: MtekObject;\n\
        \n\
        @vertex\n\
        fn mtek_vs(@location(0) mtek_position: vec3<f32>) -> MtekOut {\n\
        \x20   let mtek_n = normalize((mtek_object.model * vec4<f32>(mtek_position, 1.0)).xyz);\n\
        \x20   return MtekOut(mtek_object.model * vec4<f32>(mtek_position, 1.0));\n\
        }\n";

    #[test]
    fn modules_print_with_fixed_layout_and_parenthesised_binary_bases() {
        let printed = print_module(&vertex_like_module());
        assert_eq!(printed.text, VERTEX_LIKE);
        crate::emit_wgsl::validate_wgsl(&printed.text).expect("Naga accepts the module");
    }

    #[test]
    fn printing_is_deterministic() {
        assert_eq!(
            print_module(&vertex_like_module()),
            print_module(&vertex_like_module())
        );
    }

    /// The text of `entry` in `text`.
    fn covered<'t>(text: &'t str, entry: &SpanMapEntry) -> &'t str {
        let line = text
            .lines()
            .nth(entry.wgsl.line as usize - 1)
            .expect("line exists");
        &line[entry.wgsl.col_start as usize - 1..entry.wgsl.col_end as usize - 1]
    }

    #[test]
    fn every_node_has_a_span_map_entry_covering_its_text() {
        let printed = print_module(&vertex_like_module());
        let map = &printed.span_map;
        assert_eq!(map.symbol, "src/main.mtek::M");
        assert_eq!(map.declaration, at(0));
        let by_span = |start: u32| -> Vec<&str> {
            map.entries
                .iter()
                .filter(|e| e.span == at(start))
                .map(|e| covered(&printed.text, e))
                .collect()
        };
        assert_eq!(by_span(2), ["struct MtekObject {"]);
        assert_eq!(by_span(3), ["model: mat4x4<f32>,"]);
        assert_eq!(
            by_span(1),
            ["@group(2) @binding(0) var<uniform> mtek_object: MtekObject;"]
        );
        assert_eq!(
            by_span(6),
            [
                "@vertex",
                "fn mtek_vs(@location(0) mtek_position: vec3<f32>) -> MtekOut {"
            ]
        );
        assert_eq!(by_span(5), ["@location(0) mtek_position: vec3<f32>"]);
        assert_eq!(
            by_span(15),
            [
                "mtek_object.model * vec4<f32>(mtek_position, 1.0)",
                "mtek_object.model * vec4<f32>(mtek_position, 1.0)"
            ]
        );
        assert_eq!(
            by_span(16),
            ["(mtek_object.model * vec4<f32>(mtek_position, 1.0)).xyz"]
        );
        assert_eq!(by_span(11), ["1.0", "1.0"]);
        assert_eq!(
            by_span(22),
            ["return MtekOut(mtek_object.model * vec4<f32>(mtek_position, 1.0));"]
        );
        // Sorted by line and column, the widest first.
        let keys: Vec<_> = map
            .entries
            .iter()
            .map(|e| (e.wgsl.line, e.wgsl.col_start, Reverse(e.wgsl.col_end)))
            .collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
        // The literal `1.0` on the return line resolves to itself, the space before it to
        // the constructor around it.
        let literal = map
            .entries
            .iter()
            .find(|e| e.span == at(11) && e.wgsl.line == 14)
            .expect("literal entry");
        assert_eq!(
            map.find(14, literal.wgsl.col_start).map(|e| e.span),
            Some(at(11))
        );
        assert_eq!(
            map.find(14, literal.wgsl.col_start - 1).map(|e| e.span),
            Some(at(14))
        );
    }

    #[test]
    fn negative_literals_are_parenthesised_as_operands() {
        let minus = Expr::f32(FiniteF32::new(-2.0).expect("finite"), at(1));
        let x = Expr::local(Name::generated("x"), ShaderType::F32, at(2));
        let product = Expr::binary(BinaryOp::Multiply, x, minus, ShaderType::F32, at(3));
        let mut module = ShaderModule::new("m", at(0));
        module.functions.push(Function {
            name: Name::generated("f"),
            stage: None,
            params: vec![FunctionParam {
                name: Name::generated("x"),
                ty: ShaderType::F32,
                binding: None,
                span: at(4),
            }],
            result: Some(FunctionResult {
                ty: ShaderType::F32,
                binding: None,
            }),
            body: vec![Statement::Return {
                value: Some(product),
                span: at(5),
            }],
            symbol: "m".to_owned(),
            span: at(6),
        });
        let printed = print_module(&module);
        assert_eq!(
            printed.text,
            "fn mtek_f(mtek_x: f32) -> f32 {\n    return mtek_x * (-2.0);\n}\n"
        );
        crate::emit_wgsl::validate_wgsl(&printed.text).expect("Naga accepts the module");
    }

    #[test]
    fn f32_literals_read_back_exactly_through_binary64() {
        // A sweep of binary32 values: every printed text reads back as the same value
        // directly and through a binary64 reading.
        for bits in (1u32..0x7f80_0000).step_by(16_411).chain([0x7f7f_ffff]) {
            for bits in [bits, bits | 0x8000_0000] {
                let text = f32_text(f32::from_bits(bits));
                assert_eq!(text.parse::<f32>().map(f32::to_bits), Ok(bits), "{text}");
                let wide: f64 = text.parse().expect("a float");
                assert_eq!((wide as f32).to_bits(), bits, "{text}");
                assert!(text.contains('.') || text.contains('e'), "{text}");
            }
        }
        assert_eq!(f32_text(-0.0), "-0.0");
    }

    /// A unit function of one `i32` parameter with `body`.
    fn function_of(body: Vec<Statement>) -> ShaderModule {
        let mut module = ShaderModule::new("m", at(0));
        module.functions.push(Function {
            name: Name::user(UserNameKind::Function, "h_f"),
            stage: None,
            params: vec![FunctionParam {
                name: Name::user(UserNameKind::Param, "n"),
                ty: ShaderType::I32,
                binding: None,
                span: at(1),
            }],
            result: Some(FunctionResult {
                ty: ShaderType::I32,
                binding: None,
            }),
            body,
            symbol: "m::f".to_owned(),
            span: at(2),
        });
        module
    }

    #[test]
    fn statements_print_with_nested_blocks() {
        let n = || Expr::local(Name::user(UserNameKind::Param, "n"), ShaderType::I32, at(3));
        let t = || Expr::local(Name::user(UserNameKind::Local, "t"), ShaderType::I32, at(4));
        let i = || Expr::local(Name::user(UserNameKind::Local, "i"), ShaderType::I32, at(5));
        let int = |v: i32| Expr::literal(Literal::I32(v), at(6));
        let less = |a: Expr, b: Expr| Expr::binary(BinaryOp::Less, a, b, ShaderType::BOOL, at(7));
        let body = vec![
            Statement::Var {
                name: Name::user(UserNameKind::Local, "t"),
                value: int(0),
                span: at(8),
            },
            Statement::For {
                name: Name::user(UserNameKind::Local, "i"),
                start: int(0),
                end: int(4),
                body: vec![
                    Statement::Assign {
                        target: t(),
                        value: Expr::binary(BinaryOp::Add, t(), i(), ShaderType::I32, at(9)),
                        span: at(10),
                    },
                    Statement::If {
                        branches: vec![
                            (less(n(), int(0)), vec![Statement::Break { span: at(11) }]),
                            (less(n(), i()), vec![Statement::Continue { span: at(12) }]),
                        ],
                        otherwise: Some(vec![Statement::Block {
                            body: vec![Statement::Discard {
                                value: Expr::intrinsic(
                                    crate::lowering::shader_ir::Intrinsic::Abs,
                                    vec![n()],
                                    ShaderType::I32,
                                    at(13),
                                ),
                                span: at(14),
                            }],
                            span: at(15),
                        }]),
                        span: at(16),
                    },
                ],
                span: at(17),
            },
            Statement::Return {
                value: Some(
                    t().unary(crate::lowering::shader_ir::UnaryOp::Negate, at(18))
                        .unary(crate::lowering::shader_ir::UnaryOp::Negate, at(19)),
                ),
                span: at(20),
            },
        ];
        let printed = print_module(&function_of(body));
        assert_eq!(
            printed.text,
            "fn u_fn_h_f(u_p_n: i32) -> i32 {\n\
             \x20   var u_l_t = 0i;\n\
             \x20   for (var u_l_i = 0i; u_l_i < 4i; u_l_i++) {\n\
             \x20       u_l_t = u_l_t + u_l_i;\n\
             \x20       if u_p_n < 0i {\n\
             \x20           break;\n\
             \x20       } else if u_p_n < u_l_i {\n\
             \x20           continue;\n\
             \x20       } else {\n\
             \x20           {\n\
             \x20               _ = abs(u_p_n);\n\
             \x20           }\n\
             \x20       }\n\
             \x20   }\n\
             \x20   return -(-u_l_t);\n\
             }\n"
        );
        crate::emit_wgsl::validate_wgsl(&printed.text).expect("Naga accepts the module");
        let lines: Vec<&str> = printed.text.lines().collect();
        let headers: Vec<(u32, &str)> = printed
            .span_map
            .entries
            .iter()
            .filter(|e| e.span == at(16))
            .map(|e| (e.wgsl.line, covered(&printed.text, e)))
            .collect();
        assert_eq!(
            headers,
            [
                (5, "if u_p_n < 0i {"),
                (7, "} else if u_p_n < u_l_i {"),
                (9, "} else {")
            ]
        );
        assert_eq!(
            lines[2].trim(),
            "for (var u_l_i = 0i; u_l_i < 4i; u_l_i++) {"
        );
        let for_header = printed
            .span_map
            .entries
            .iter()
            .find(|e| e.span == at(17))
            .expect("the for header");
        assert_eq!(
            covered(&printed.text, for_header),
            "for (var u_l_i = 0i; u_l_i < 4i; u_l_i++) {"
        );
    }

    #[test]
    fn index_bitcast_and_bool32_nodes_print_in_wgsl_form() {
        let array = ShaderType::Array {
            element: Box::new(ShaderType::named("MtekPad16_u32")),
            length: 3,
        };
        let flags = Expr::local(
            Name::user(UserNameKind::Param, "flags"),
            array.clone(),
            at(1),
        );
        let n = Expr::local(Name::user(UserNameKind::Param, "n"), ShaderType::I32, at(2));
        let read = flags
            .index(
                n.clone().bitcast(ShaderType::U32, at(3)),
                ShaderType::named("MtekPad16_u32"),
                at(4),
            )
            .field("value", ShaderType::U32, at(5))
            .bool32_decode(at(6));
        let encoded = read.clone().bool32_encode(at(7));
        let mut module = ShaderModule::new("m", at(0));
        module.structs.push(StructDecl {
            name: "MtekPad16_u32".to_owned(),
            members: vec![StructMember {
                name: "value".to_owned(),
                ty: ShaderType::U32,
                align: None,
                size: Some(16),
                binding: None,
                span: at(0),
            }],
            span: at(0),
        });
        module.functions.push(Function {
            name: Name::generated("f"),
            stage: None,
            params: vec![
                FunctionParam {
                    name: Name::user(UserNameKind::Param, "flags"),
                    ty: array,
                    binding: None,
                    span: at(8),
                },
                FunctionParam {
                    name: Name::user(UserNameKind::Param, "n"),
                    ty: ShaderType::I32,
                    binding: None,
                    span: at(9),
                },
            ],
            result: Some(FunctionResult {
                ty: ShaderType::U32,
                binding: None,
            }),
            body: vec![
                Statement::Let {
                    name: Name::user(UserNameKind::Local, "b"),
                    value: read,
                    span: at(10),
                },
                Statement::Return {
                    value: Some(encoded),
                    span: at(11),
                },
            ],
            symbol: "m".to_owned(),
            span: at(12),
        });
        let printed = print_module(&module);
        assert!(
            printed.text.contains(
                "    let u_l_b = (u_p_flags[bitcast<u32>(u_p_n)].value != 0u);\n\
                 \x20   return select(0u, 1u, (u_p_flags[bitcast<u32>(u_p_n)].value != 0u));\n"
            ),
            "{}",
            printed.text
        );
        crate::emit_wgsl::validate_wgsl(&printed.text).expect("Naga accepts the module");
    }
}
