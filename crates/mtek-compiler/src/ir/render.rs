//! The two forms of `mtek inspect --ir` (decision 0028): pretty JSON
//! (`--format json`) and an indented tree (`--format human`). Both are
//! deterministic: they depend only on the program and the source text.

use super::model::{
    Camera, Const, Entity, Field, Item, MaterialInstanceDesc, Mesh, MeshDesc, Origin, Program,
    Projection, ProjectionDesc, Scene, Source, StructItem,
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
    }

    fn field(&mut self, depth: usize, name: &str, field: &Field) {
        let location = self.location(field.span);
        let Source::Const(value) = &field.source;
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
            let Source::Const(value) = &param.source;
            self.line(depth + 1, format!("{}: {} = {value}", param.name, param.ty));
        }
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
