//! The two forms of `mtek inspect --ir` (decision 0028): pretty JSON
//! (`--format json`) and an indented tree (`--format human`). Both are
//! deterministic: they depend only on the program and the source text.

use super::model::{
    Behavior, BehaviorKind, Binding, BindingDep, BindingTarget, Block, Camera, Const, Entity, Expr,
    ExprKind, Field, Function, Item, LocalItem, LocalKind, MaterialInstanceDesc, MaterialItem,
    Mesh, MeshDesc, NamedExpr, Origin, Owner, Place, PlaceRoot, PlaceStep, Program, Projection,
    ProjectionDesc, Scene, Source, State, Stmt, StructItem,
};
use crate::source::{SourceMap, Span};

/// The program as pretty JSON: two-space indentation, keys in declaration
/// order, arrays of numbers and objects of numbers (spans) on one line
/// (`[0.0, 0.5, 0.0]`, `{"file": 0, "start": 84, "end": 384}`), a final line
/// break.
#[must_use]
pub fn to_json(program: &Program) -> String {
    // Serialising these types cannot fail: every map key is a string and
    // every value is finite or an integer.
    let pretty = serde_json::to_string_pretty(program).unwrap_or_default();
    let mut text = inline_flat_containers(&pretty);
    text.push('\n');
    text
}

/// A JSON number on its own (no trailing comma).
fn is_number(text: &str) -> bool {
    text.starts_with(|c: char| c == '-' || c.is_ascii_digit()) && text.parse::<f64>().is_ok()
}

/// One element of a pretty-printed container that may share a line: a
/// number in an array (`0.5`), or a member with a plain key and a number
/// value in an object (`"start": 84`). Without the trailing comma.
fn flat_element(line: &str, object: bool) -> Option<&str> {
    let item = line.trim();
    let item = item.strip_suffix(',').unwrap_or(item);
    let value = if object {
        let (key, value) = item.split_once("\": ")?;
        let key = key.strip_prefix('"')?;
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return None;
        }
        value
    } else {
        item
    };
    is_number(value).then_some(item)
}

/// Put every array of numbers and every object of number members on one
/// line. Only whitespace changes: the JSON value is the same.
fn inline_flat_containers(pretty: &str) -> String {
    let lines: Vec<&str> = pretty.lines().collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut index = 0;
    while let Some(line) = lines.get(index) {
        let container = if line.ends_with('[') {
            Some((false, "]"))
        } else if line.ends_with('{') {
            Some((true, "}"))
        } else {
            None
        };
        if let Some((object, close)) = container {
            let mut items = Vec::new();
            let mut next = index + 1;
            while let Some(item) = lines.get(next).and_then(|l| flat_element(l, object)) {
                items.push(item);
                next += 1;
            }
            let end = lines.get(next).map(|l| l.trim());
            if let Some(end) = end
                && !items.is_empty()
                && end.strip_suffix(',').unwrap_or(end) == close
            {
                out.push(format!("{line}{}{end}", items.join(", ")));
                index = next + 1;
                continue;
            }
        }
        out.push((*line).to_owned());
        index += 1;
    }
    out.join("\n")
}

/// The program as an indented tree, for people: one line per node with its
/// symbol and source location (`line:column-line:column`, columns counted in
/// Unicode scalar values), one line per field with its value and origin.
#[must_use]
pub fn to_human(program: &Program, sources: &SourceMap) -> String {
    let mut out = Tree {
        text: String::new(),
        sources,
    };
    out.line(0, format!("program (entry scene {})", program.entry_scene));
    for module in &program.modules {
        out.line(
            1,
            format!("module {} {}", module.path, out.location(module.span)),
        );
        for item in &module.items {
            match item {
                Item::Const(constant) => out.constant(2, constant),
                Item::Scene(scene) => out.scene(2, scene),
                Item::Struct(item) => out.structure(2, item),
                Item::Function(function) => out.function(2, function),
                Item::Material(material) => out.material_item(2, material),
            }
        }
    }
    out.text
}

struct Tree<'s> {
    text: String,
    sources: &'s SourceMap,
}

impl Tree<'_> {
    fn line(&mut self, depth: usize, line: String) {
        for _ in 0..depth {
            self.text.push_str("  ");
        }
        self.text.push_str(&line);
        self.text.push('\n');
    }

    /// `@4:5-4:24`; a span outside the source map as `@file 0 bytes 3..9`.
    fn location(&self, span: Span) -> String {
        let start = self.sources.line_col(span.file, span.start);
        let end = self.sources.line_col(span.file, span.end);
        match (start, end) {
            (Some(start), Some(end)) => format!(
                "@{}:{}-{}:{}",
                start.line, start.column, end.line, end.column
            ),
            _ => format!("@file {} bytes {}..{}", span.file.0, span.start, span.end),
        }
    }

    fn constant(&mut self, depth: usize, constant: &Const) {
        let location = self.location(constant.span);
        self.line(
            depth,
            format!(
                "const {}: {} = {} [{}] {location}",
                constant.name, constant.ty, constant.value, constant.symbol
            ),
        );
    }

    fn structure(&mut self, depth: usize, item: &StructItem) {
        let location = self.location(item.span);
        let fields: Vec<String> = item
            .fields
            .iter()
            .map(|f| format!("{}: {}", f.name, f.ty))
            .collect();
        self.line(
            depth,
            format!(
                "struct {} {{ {} }} [{}] {location}",
                item.name,
                fields.join("; "),
                item.symbol
            ),
        );
    }

    fn function(&mut self, depth: usize, function: &Function) {
        let location = self.location(function.span);
        let keyword = if function.effect == "cpu" {
            "cpu fn"
        } else {
            "fn"
        };
        let params: Vec<String> = function
            .params()
            .map(|p| format!("{}: {}", p.name, p.ty))
            .collect();
        let result = function
            .result
            .as_ref()
            .map_or_else(String::new, |r| format!(" -> {r}"));
        let mut domains = Vec::new();
        if function.gpu_reachable {
            domains.push("gpu");
        }
        if function.cpu_reachable {
            domains.push("cpu");
        }
        let reached = if domains.is_empty() {
            "unreached".to_owned()
        } else {
            format!("reached by {}", domains.join(" and "))
        };
        self.line(
            depth,
            format!(
                "{keyword} {}({}){result} [{}] {}, {reached} {location}",
                function.name,
                params.join(", "),
                function.symbol,
                function.effect
            ),
        );
        self.locals(depth + 1, &function.locals);
        self.block(depth + 1, &function.body, &function.locals);
    }

    fn locals(&mut self, depth: usize, locals: &[LocalItem]) {
        for local in locals {
            let location = self.location(local.span);
            let kind = match local.kind {
                LocalKind::Param => "param",
                LocalKind::Let => "let",
                LocalKind::Var => "var",
                LocalKind::Loop => "loop",
            };
            self.line(
                depth,
                format!(
                    "local #{} {}: {} ({kind}) {location}",
                    local.index, local.name, local.ty
                ),
            );
        }
    }

    fn material_item(&mut self, depth: usize, material: &MaterialItem) {
        let location = self.location(material.span);
        self.line(
            depth,
            format!(
                "material {} [{}] {location}",
                material.name, material.symbol
            ),
        );
        for (index, param) in material.params.iter().enumerate() {
            let location = self.location(param.span);
            let default = param
                .default
                .as_ref()
                .map_or_else(String::new, |value| format!(" = {value}"));
            self.line(
                depth + 1,
                format!(
                    "param #{index} {}: {}{default} {location}",
                    param.name, param.ty
                ),
            );
        }
        if let Some(layout) = &material.layout {
            self.line(
                depth + 1,
                format!(
                    "block {} {} (size {}, align {})",
                    layout.id, layout.wgsl_struct, layout.size, layout.align
                ),
            );
        }
        let stage = &material.fragment;
        let location = self.location(stage.span);
        let inputs = if stage.surface_inputs.is_empty() {
            "none".to_owned()
        } else {
            stage.surface_inputs.join(", ")
        };
        self.line(
            depth + 1,
            format!(
                "fragment -> {} [{}] reads {inputs} {location}",
                stage.result, stage.symbol
            ),
        );
        self.locals(depth + 2, &stage.locals);
        self.block(depth + 2, &stage.body, &stage.locals);
    }

    fn block(&mut self, depth: usize, block: &Block, locals: &[LocalItem]) {
        for stmt in &block.stmts {
            self.stmt(depth, stmt, locals);
        }
    }

    fn stmt(&mut self, depth: usize, stmt: &Stmt, locals: &[LocalItem]) {
        let local_name = |index: u32| {
            locals
                .get(index as usize)
                .map_or_else(|| format!("#{index}"), |l| format!("{}#{index}", l.name))
        };
        match stmt {
            Stmt::Let { local, value, span } | Stmt::Var { local, value, span } => {
                let keyword = if matches!(stmt, Stmt::Var { .. }) {
                    "var"
                } else {
                    "let"
                };
                let location = self.location(*span);
                self.line(
                    depth,
                    format!(
                        "{keyword} {} = {} {location}",
                        local_name(*local),
                        expr_text(value)
                    ),
                );
            }
            Stmt::Const {
                name,
                ty,
                value,
                span,
            } => {
                let location = self.location(*span);
                self.line(depth, format!("const {name}: {ty} = {value} {location}"));
            }
            Stmt::Assign {
                target,
                op,
                value,
                span,
            } => {
                let location = self.location(*span);
                self.line(
                    depth,
                    format!(
                        "{} {op} {} {location}",
                        place_text(target, &local_name),
                        expr_text(value)
                    ),
                );
            }
            Stmt::If {
                branches,
                otherwise,
                span,
            } => {
                let location = self.location(*span);
                for (index, branch) in branches.iter().enumerate() {
                    let keyword = if index == 0 { "if" } else { "else if" };
                    let suffix = if index == 0 {
                        format!(" {location}")
                    } else {
                        String::new()
                    };
                    self.line(
                        depth,
                        format!("{keyword} {}{suffix}", expr_text(&branch.cond)),
                    );
                    self.block(depth + 1, &branch.body, locals);
                }
                if let Some(block) = otherwise {
                    self.line(depth, "else".to_owned());
                    self.block(depth + 1, block, locals);
                }
            }
            Stmt::ForRange {
                local,
                start,
                end,
                body,
                span,
            } => {
                let location = self.location(*span);
                self.line(
                    depth,
                    format!(
                        "for {} in {}..{} {location}",
                        local_name(*local),
                        expr_text(start),
                        expr_text(end)
                    ),
                );
                self.block(depth + 1, body, locals);
            }
            Stmt::ForEach {
                local,
                array,
                body,
                span,
            } => {
                let location = self.location(*span);
                self.line(
                    depth,
                    format!(
                        "for {} in {} {location}",
                        local_name(*local),
                        expr_text(array)
                    ),
                );
                self.block(depth + 1, body, locals);
            }
            Stmt::Return { value, span } => {
                let location = self.location(*span);
                let value = value
                    .as_ref()
                    .map_or_else(String::new, |v| format!(" {}", expr_text(v)));
                self.line(depth, format!("return{value} {location}"));
            }
            Stmt::Break { span } => {
                let location = self.location(*span);
                self.line(depth, format!("break {location}"));
            }
            Stmt::Continue { span } => {
                let location = self.location(*span);
                self.line(depth, format!("continue {location}"));
            }
            Stmt::Block { body } => {
                let location = self.location(body.span);
                self.line(depth, format!("block {location}"));
                self.block(depth + 1, body, locals);
            }
            Stmt::Expr { expr, span } => {
                let location = self.location(*span);
                self.line(depth, format!("{} {location}", expr_text(expr)));
            }
        }
    }

    fn scene(&mut self, depth: usize, scene: &Scene) {
        let location = self.location(scene.span);
        self.line(
            depth,
            format!("scene {} [{}] {location}", scene.name, scene.symbol),
        );
        self.line(depth + 1, "fields".to_owned());
        self.field(depth + 2, "clear_color", &scene.fields.clear_color);
        if !scene.constants.is_empty() {
            self.line(depth + 1, "constants".to_owned());
            for constant in &scene.constants {
                self.constant(depth + 2, constant);
            }
        }
        for camera in &scene.cameras {
            self.camera(depth + 1, camera);
        }
        for entity in &scene.entities {
            self.entity(depth + 1, entity);
        }
        for state in &scene.state {
            self.state(depth + 1, state);
        }
        for behavior in &scene.behaviors {
            self.behavior(depth + 1, behavior);
        }
        for binding in &scene.bindings {
            self.binding(depth + 1, binding);
        }
    }

    fn binding(&mut self, depth: usize, binding: &Binding) {
        let location = self.location(binding.span);
        let target = match &binding.target {
            BindingTarget::Transform { entity, field } => format!("entity#{entity}.{field}"),
            BindingTarget::Visible { entity } => format!("entity#{entity}.visible"),
            BindingTarget::Param { entity, name } => format!("entity#{entity}.material.{name}"),
            BindingTarget::Camera { field } => format!("camera.{field}"),
        };
        let deps: Vec<String> = binding
            .deps
            .iter()
            .map(|dep| match dep {
                BindingDep::State { name } => format!("state {name}"),
                BindingDep::Frame { name } => format!("frame.{name}"),
                BindingDep::EntityField { entity, field } => format!("entity#{entity}.{field}"),
                BindingDep::EntityState { entity, name } => format!("entity#{entity}.state {name}"),
                BindingDep::Param { entity, name } => format!("entity#{entity}.material.{name}"),
            })
            .collect();
        self.line(
            depth,
            format!(
                "bind#{} {target} = {} [order {}; reads {}] {location}",
                binding.id,
                expr_text(&binding.expr),
                binding.order,
                if deps.is_empty() {
                    "nothing".to_owned()
                } else {
                    deps.join(", ")
                }
            ),
        );
    }

    fn state(&mut self, depth: usize, state: &State) {
        let location = self.location(state.span);
        self.line(
            depth,
            format!(
                "state {}: {} = {} [{}] {location}",
                state.name,
                state.ty,
                expr_text(&state.init),
                state.symbol
            ),
        );
    }

    fn behavior(&mut self, depth: usize, behavior: &Behavior) {
        let location = self.location(behavior.span);
        let what = match &behavior.kind {
            BehaviorKind::Update => "update".to_owned(),
            BehaviorKind::FixedUpdate => "fixed_update".to_owned(),
            BehaviorKind::Event { event, filter } => match filter {
                Some(code) => format!("on {event}({code})"),
                None => format!("on {event}"),
            },
        };
        let owner = match behavior.owner {
            Owner::Scene => "scene".to_owned(),
            Owner::Entity { index } => format!("entity#{index}"),
        };
        self.line(
            depth,
            format!("{what} of {owner} [{}] {location}", behavior.symbol),
        );
        self.locals(depth + 1, &behavior.locals);
        self.block(depth + 1, &behavior.body, &behavior.locals);
    }

    fn field(&mut self, depth: usize, name: &str, field: &Field) {
        let location = self.location(field.span);
        let value = source_text(&field.source);
        self.line(
            depth,
            format!("{name} = {value} ({} {location})", origin(field.origin)),
        );
    }

    fn camera(&mut self, depth: usize, camera: &Camera) {
        let location = self.location(camera.span);
        let active = if camera.active { " active" } else { "" };
        self.line(
            depth,
            format!(
                "camera {} [{}]{active} {location}",
                camera.name, camera.symbol
            ),
        );
        self.field(depth + 1, "position", &camera.position);
        if let Some(target) = &camera.target {
            self.field(depth + 1, "target", target);
        }
        self.field(depth + 1, "rotation", &camera.rotation);
        self.projection(depth + 1, &camera.projection);
    }

    fn projection(&mut self, depth: usize, projection: &Projection) {
        let location = self.location(projection.span);
        let desc = match projection.desc {
            ProjectionDesc::Perspective { fov_y, near, far } => {
                format!("Perspective {{ fov_y: {fov_y:?}, near: {near:?}, far: {far:?} }}")
            }
            ProjectionDesc::Orthographic { height, near, far } => {
                format!("Orthographic {{ height: {height:?}, near: {near:?}, far: {far:?} }}")
            }
        };
        self.line(
            depth,
            format!(
                "projection = {desc} ({} {location})",
                origin(projection.origin)
            ),
        );
    }

    fn entity(&mut self, depth: usize, entity: &Entity) {
        let location = self.location(entity.span);
        let parent = match entity.parent {
            Some(parent) => format!("parent #{parent}"),
            None => "root".to_owned(),
        };
        self.line(
            depth,
            format!(
                "entity #{} {} [{}] {parent} {location}",
                entity.index, entity.name, entity.symbol
            ),
        );
        self.field(depth + 1, "position", &entity.position);
        self.field(depth + 1, "rotation", &entity.rotation);
        self.field(depth + 1, "scale", &entity.scale);
        self.field(depth + 1, "visible", &entity.visible);
        if let Some(mesh) = &entity.mesh {
            self.mesh(depth + 1, mesh);
        }
        if let Some(material) = &entity.material {
            self.material(depth + 1, material);
        }
    }

    fn mesh(&mut self, depth: usize, mesh: &Mesh) {
        let location = self.location(mesh.span);
        let desc = match mesh.desc {
            MeshDesc::Box { size: [x, y, z] } => {
                format!("Box {{ size: vec3({x:?}, {y:?}, {z:?}) }}")
            }
            MeshDesc::Sphere {
                radius,
                segments,
                rings,
            } => format!("Sphere {{ radius: {radius:?}, segments: {segments}, rings: {rings} }}"),
            MeshDesc::Plane { size: [x, z] } => format!("Plane {{ size: vec2({x:?}, {z:?}) }}"),
        };
        self.line(
            depth,
            format!("mesh = {desc} ({} {location})", origin(mesh.origin)),
        );
    }

    fn material(&mut self, depth: usize, material: &MaterialInstanceDesc) {
        let location = self.location(material.span);
        self.line(
            depth,
            format!(
                "material = {} ({} {location})",
                material.material,
                origin(material.origin)
            ),
        );
        for param in &material.params {
            let value = source_text(&param.source);
            self.line(depth + 1, format!("{}: {} = {value}", param.name, param.ty));
        }
    }
}

/// A field or param's source: its constant, or the binding that supplies it.
fn source_text(source: &Source) -> String {
    match source {
        Source::Const(value) => value.to_string(),
        Source::Bound(id) => format!("bind#{id}"),
    }
}

/// An assignment target in Mtek-like notation.
fn place_text(place: &Place, local_name: &dyn Fn(u32) -> String) -> String {
    let mut text = match &place.root {
        PlaceRoot::Local { local, .. } => local_name(*local),
        PlaceRoot::State { owner, name, .. } => format!("{}{name}", owner_prefix(*owner)),
        PlaceRoot::EntityField { entity, field, .. } => format!("entity#{entity}.{field}"),
        PlaceRoot::CameraField { camera, field, .. } => format!("{camera}.{field}"),
        PlaceRoot::InstanceParam { entity, param, .. } => {
            format!("entity#{entity}.material.{param}")
        }
    };
    for step in &place.steps {
        match step {
            PlaceStep::Field { field, .. } => {
                text.push('.');
                text.push_str(field);
            }
            PlaceStep::Index { index, .. } => {
                text.push('[');
                text.push_str(&expr_text(index));
                text.push(']');
            }
            PlaceStep::Component { component, .. } => {
                let letter = ["x", "y", "z", "w"]
                    .get(*component as usize)
                    .unwrap_or(&"?");
                text.push('.');
                text.push_str(letter);
            }
        }
    }
    text
}

/// An expression in Mtek-like notation with its type: `(x * 2.0): f32`.
/// Expressions nest no deeper than the parser allows.
fn expr_text(expr: &Expr) -> String {
    let list = |items: &[Expr]| items.iter().map(expr_text).collect::<Vec<_>>().join(", ");
    let named = |fields: &[NamedExpr]| {
        fields
            .iter()
            .map(|f| format!("{}: {}", f.name, expr_text(&f.value)))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let text = match &expr.kind {
        ExprKind::Const { value } => return value.to_string(),
        ExprKind::Local { local, name } => return format!("{name}#{local}"),
        ExprKind::Unary { op, operand } => format!("{op}{}", expr_text(operand)),
        ExprKind::Binary { op, lhs, rhs } => {
            format!("{} {op} {}", expr_text(lhs), expr_text(rhs))
        }
        ExprKind::Call { function, args } => format!("{function}({})", list(args)),
        ExprKind::Builtin { function, args } => format!("{function}({})", list(args)),
        ExprKind::Construct { args } => format!("{}({})", expr.ty, list(args)),
        ExprKind::Convert { arg } => format!("{}({})", expr.ty, expr_text(arg)),
        ExprKind::Components { base, components } => {
            let letters = if base.ty == "color" { "rgba" } else { "xyzw" };
            let names: String = components
                .iter()
                .filter_map(|i| letters.chars().nth(*i as usize))
                .collect();
            format!("{}.{names}", expr_text(base))
        }
        ExprKind::Field { base, field, .. } => format!("{}.{field}", expr_text(base)),
        ExprKind::Index { base, index } => format!("{}[{}]", expr_text(base), expr_text(index)),
        ExprKind::Array { elements } => format!("[{}]", list(elements)),
        ExprKind::Struct { fields } => format!("{} {{ {} }}", expr.ty, named(fields)),
        ExprKind::Descriptor { schema, fields } => format!("{schema} {{ {} }}", named(fields)),
        ExprKind::Param { param, name } => return format!("param {name}#{param}"),
        ExprKind::State { owner, name } => return format!("{}{name}", owner_prefix(*owner)),
        ExprKind::EntityField { entity, field } => return format!("entity#{entity}.{field}"),
        ExprKind::CameraField { camera, field } => return format!("{camera}.{field}"),
        ExprKind::InstanceParam { entity, param } => {
            return format!("entity#{entity}.material.{param}");
        }
        ExprKind::Frame { member } => return format!("frame.{member}"),
        ExprKind::EnumMember {
            enumeration,
            member,
            ..
        } => return format!("{enumeration}.{member}"),
        ExprKind::Material { material, params } => {
            format!("{material} {{ {} }}", named(params))
        }
    };
    format!("({text}): {}", expr.ty)
}

/// `state.` for scene state and `entity#2.state.` for an entity's.
fn owner_prefix(owner: Owner) -> String {
    match owner {
        Owner::Scene => "state.".to_owned(),
        Owner::Entity { index } => format!("entity#{index}.state."),
    }
}

fn origin(origin: Origin) -> &'static str {
    match origin {
        Origin::Written => "written",
        Origin::Default => "default",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn same_json(a: &str, b: &str) {
        let a: serde_json::Value = serde_json::from_str(a).unwrap();
        let b: serde_json::Value = serde_json::from_str(b).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn number_arrays_are_put_on_one_line() {
        let pretty = "{\n  \"a\": [\n    0.0,\n    -1.5,\n    1e-7\n  ],\n  \"b\": [\n    [\n      1,\n      2\n    ],\n    [\n      3\n    ]\n  ],\n  \"c\": [\n    \"x\",\n    1\n  ],\n  \"d\": []\n}";
        let expected = "{\n  \"a\": [0.0, -1.5, 1e-7],\n  \"b\": [\n    [1, 2],\n    [3]\n  ],\n  \"c\": [\n    \"x\",\n    1\n  ],\n  \"d\": []\n}";
        assert_eq!(inline_flat_containers(pretty), expected);
        same_json(pretty, expected);
    }

    #[test]
    fn objects_of_numbers_are_put_on_one_line() {
        let pretty = "{\n  \"span\": {\n    \"file\": 0,\n    \"start\": 4,\n    \"end\": 9\n  },\n  \"mixed\": {\n    \"n\": 1,\n    \"s\": \"x\"\n  },\n  \"odd key\": {\n    \"a b\": 1\n  },\n  \"e\": {}\n}";
        let expected = "{\n  \"span\": {\"file\": 0, \"start\": 4, \"end\": 9},\n  \"mixed\": {\n    \"n\": 1,\n    \"s\": \"x\"\n  },\n  \"odd key\": {\n    \"a b\": 1\n  },\n  \"e\": {}\n}";
        assert_eq!(inline_flat_containers(pretty), expected);
        same_json(pretty, expected);
    }
}
