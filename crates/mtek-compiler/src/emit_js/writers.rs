//! Generated JavaScript writers (`spec/gpu-layout.md` section 7).
//!
//! For one [`LayoutRecord`] this module emits
//!
//! - one **module-private** `function w_<qual>_<field>(m, base, v)` per top-level member,
//! - one `function w_<qual>(m, base, v)` that calls them all,
//! - the entry of the exported `writers` table, keyed by the layout id
//!   (`spec/runtime-abi.md` section 3).
//!
//! `m` is `{ f32: Float32Array, u32: Uint32Array, i32: Int32Array }` over one `ArrayBuffer`
//! and `base` the byte offset of the block (a multiple of 4). `v` has the CPU shape of
//! `spec/runtime-abi.md` section 4.1: vectors `{x, y, z, w}`, colours `{r, g, b, a}`,
//! quaternions `{x, y, z, w}`, `mat4` a 16-element column-major `Float32Array`, structs
//! plain objects, arrays JS arrays.
//!
//! Every offset comes from the record; nothing here computes a layout. Writers only ever
//! write leaf bytes, so padding bytes are never touched. Output is straight-line code except
//! for arrays longer than [`MAX_UNROLLED_LENGTH`], which use a counted loop.

use crate::layout::{LayoutNode, LayoutRecord, ScalarKind};

use super::printer::{
    Printer, identifier_part, line_comment, member_access, property_key, string_literal,
};

/// Arrays up to this length are written as straight-line code; longer ones use a loop.
pub const MAX_UNROLLED_LENGTH: u32 = 16;

/// The emitted pieces of the writers of one block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmittedWriters {
    /// The function texts: a header comment, the per-field writers in member order, then
    /// the whole-block writer. No `export` anywhere: the functions are module-private.
    pub functions: String,
    /// One entry of the exported `writers` table, ending in a comma, for example
    /// `"fixture:mixed": { all: w_fixture_mixed, fields: { a: w_fixture_mixed_a } },`.
    pub table_entry: String,
    /// Names of the emitted functions: the whole-block writer first, then the per-field
    /// writers in member order.
    pub function_names: Vec<String>,
}

/// The `<qual>` part of the writer names of `record` (`spec/gpu-layout.md` section 7):
/// `fixture_<name>` for layout fixtures, `builtin_<MtekStruct>` for built-in blocks and
/// `<hash8>_<Name>` for material blocks. Anything else falls back to the WGSL struct name.
/// The result only contains ASCII letters, digits and `_`.
pub fn writer_qualifier(record: &LayoutRecord) -> String {
    let id = record.id.as_str();
    if let Some(name) = id.strip_prefix("fixture:") {
        format!("fixture_{}", identifier_part(name))
    } else if id.starts_with("builtin:") {
        format!("builtin_{}", identifier_part(&record.wgsl_struct))
    } else if id.starts_with("material:") {
        let name = record
            .wgsl_struct
            .strip_prefix("MtekParams_")
            .unwrap_or(&record.wgsl_struct);
        identifier_part(name)
    } else {
        identifier_part(&record.wgsl_struct)
    }
}

/// The writer function texts of `record`, named with `block_name` as the `<qual>` part
/// (normally [`writer_qualifier`]`(record)`; it is sanitised to identifier characters).
///
/// This is the text that goes into `app.js`; the table entry is available from
/// [`emit_writer_parts`].
pub fn emit_writers(record: &LayoutRecord, block_name: &str) -> String {
    emit_writer_parts(record, block_name).functions
}

/// Like [`emit_writers`], but also returns the `writers` table entry and the function names.
pub fn emit_writer_parts(record: &LayoutRecord, block_name: &str) -> EmittedWriters {
    let qual = identifier_part(block_name);
    let whole = format!("w_{qual}");
    let members: &[crate::layout::LayoutMember] = match &record.root {
        LayoutNode::Struct { members, .. } => members,
        _ => &[],
    };
    let field_names: Vec<String> = members
        .iter()
        .map(|member| format!("{whole}_{}", identifier_part(&member.name)))
        .collect();

    let mut p = Printer::new();
    p.line(&line_comment(&format!(
        "Generated from layout {} (size {}). Do not edit.",
        record.id, record.size
    )));
    for (member, name) in members.iter().zip(&field_names) {
        p.block(&format!("function {name}(m, base, v)"), |p| {
            emit_member_body(p, &member.node, &member.mtek_type);
        });
    }
    p.block(&format!("function {whole}(m, base, v)"), |p| {
        if members.is_empty() && has_leaf(&record.root) {
            // A record whose root is not a struct: write the root directly.
            emit_member_body(p, &record.root, "");
        }
        for (member, name) in members.iter().zip(&field_names) {
            p.line(&format!(
                "{name}(m, base, {});",
                member_access("v", &member.name)
            ));
        }
    });

    let fields: Vec<String> = members
        .iter()
        .zip(&field_names)
        .map(|(member, name)| format!("{}: {name}", property_key(&member.name)))
        .collect();
    let fields_text = if fields.is_empty() {
        "{}".to_owned()
    } else {
        format!("{{ {} }}", fields.join(", "))
    };
    let table_entry = format!(
        "{}: {{ all: {whole}, fields: {fields_text} }},",
        string_literal(&record.id)
    );

    let mut function_names = vec![whole];
    function_names.extend(field_names);
    EmittedWriters {
        functions: p.finish(),
        table_entry,
        function_names,
    }
}

/// The standalone **test artifact** for `record`: the private writer functions of
/// [`emit_writers`], a `writers` table holding this block's entry, and one `export`
/// statement exposing every function and the table so tests can import them.
///
/// The export wrapper exists only here; `app.js` never exports a writer
/// (`spec/gpu-layout.md` section 7).
pub fn emit_test_module(record: &LayoutRecord, block_name: &str) -> String {
    let parts = emit_writer_parts(record, block_name);
    let mut p = Printer::new();
    let mut text = parts.functions;
    p.blank();
    p.line(&line_comment(
        "Test artifact only: this wrapper is never part of app.js.",
    ));
    p.line("const writers = {");
    p.indent();
    p.line(&parts.table_entry);
    p.dedent();
    p.line("};");
    p.line("export {");
    p.indent();
    for name in &parts.function_names {
        p.line(&format!("{name},"));
    }
    p.line("writers,");
    p.dedent();
    p.line("};");
    text.push_str(&p.finish());
    text
}

/// True if writing `node` emits at least one store.
fn has_leaf(node: &LayoutNode) -> bool {
    match node {
        LayoutNode::Scalar { .. } | LayoutNode::Vector { .. } | LayoutNode::Matrix { .. } => true,
        LayoutNode::Struct { members, .. } => members.iter().any(|m| has_leaf(&m.node)),
        LayoutNode::Array {
            length, element, ..
        } => *length > 0 && has_leaf(element),
    }
}

/// The body of a per-field writer: a single inline store for a scalar member, otherwise a
/// `const w = base >>> 2;` word base followed by the stores.
fn emit_member_body(p: &mut Printer, node: &LayoutNode, mtek_type: &str) {
    let origin = WordIndex::default();
    match node {
        LayoutNode::Scalar { .. } => emit_node(p, node, "v", &origin, mtek_type, 0, Base::Inline),
        _ if has_leaf(node) => {
            p.line("const w = base >>> 2;");
            emit_node(p, node, "v", &origin, mtek_type, 0, Base::Local);
        }
        _ => {}
    }
}

/// How the block's word base is spelled in an index expression.
#[derive(Debug, Clone, Copy)]
enum Base {
    /// `w`, declared by `const w = base >>> 2;`.
    Local,
    /// `(base >>> 2)`, used when a function performs a single store.
    Inline,
}

/// A 4-byte word index relative to the block base: a constant plus loop-variable terms.
#[derive(Debug, Clone, Default)]
struct WordIndex {
    words: u32,
    terms: Vec<(String, u32)>,
}

impl WordIndex {
    fn plus_bytes(&self, bytes: u32) -> Self {
        self.plus_words(bytes / 4)
    }

    fn plus_words(&self, words: u32) -> Self {
        Self {
            words: self.words.saturating_add(words),
            terms: self.terms.clone(),
        }
    }

    fn plus_term(&self, variable: &str, stride_bytes: u32) -> Self {
        let mut terms = self.terms.clone();
        terms.push((variable.to_owned(), stride_bytes / 4));
        Self {
            words: self.words,
            terms,
        }
    }

    /// The index expression for the word `extra_words` past this index.
    fn render(&self, base: Base, extra_words: u32) -> String {
        let mut text = match base {
            Base::Local => "w".to_owned(),
            Base::Inline => "(base >>> 2)".to_owned(),
        };
        text.push_str(&format!(" + {}", self.words.saturating_add(extra_words)));
        for (variable, stride) in &self.terms {
            if *stride == 1 {
                text.push_str(&format!(" + {variable}"));
            } else {
                text.push_str(&format!(" + {variable} * {stride}"));
            }
        }
        text
    }
}

/// The typed-array view a scalar is stored through.
fn view(scalar: ScalarKind) -> &'static str {
    match scalar {
        ScalarKind::F32 => "f32",
        ScalarKind::I32 => "i32",
        ScalarKind::U32 | ScalarKind::Bool32 => "u32",
    }
}

/// The store of one scalar value expression.
fn store(scalar: ScalarKind, index: &str, value: &str) -> String {
    match scalar {
        ScalarKind::Bool32 => format!("m.u32[{index}] = {value} ? 1 : 0;"),
        other => format!("m.{}[{index}] = {value};", view(other)),
    }
}

/// The component accessor of vector value `value` of Mtek type `mtek_type`.
fn component(value: &str, mtek_type: &str, index: u32) -> String {
    let names: [&str; 4] = if mtek_type == "color" {
        ["r", "g", "b", "a"]
    } else {
        ["x", "y", "z", "w"]
    };
    match usize::try_from(index).ok().and_then(|i| names.get(i)) {
        Some(name) => member_access(value, name),
        None => format!("{value}[{index}]"),
    }
}

/// The element type of an `array<T, N>` spelling (`array<array<f32, 2>, 3>` gives
/// `array<f32, 2>`), or the empty string for anything else.
fn element_type(mtek_type: &str) -> &str {
    mtek_type
        .strip_prefix("array<")
        .and_then(|rest| rest.strip_suffix('>'))
        .and_then(|inner| inner.rfind(", ").map(|at| &inner[..at]))
        .unwrap_or("")
}

/// Emits the stores that write value expression `value` (of Mtek type `mtek_type`) for
/// `node`, whose offset is relative to `origin`.
///
/// Struct members carry offsets that are absolute within their origin, so they share the
/// struct's origin. An array element starts at `origin + array offset + i * stride`, and
/// offsets inside it are relative to that start.
fn emit_node(
    p: &mut Printer,
    node: &LayoutNode,
    value: &str,
    origin: &WordIndex,
    mtek_type: &str,
    depth: usize,
    base: Base,
) {
    match node {
        LayoutNode::Scalar { offset, scalar, .. } => {
            let at = origin.plus_bytes(*offset).render(base, 0);
            p.line(&store(*scalar, &at, value));
        }
        LayoutNode::Vector {
            offset,
            scalar,
            components,
            ..
        } => {
            let at = origin.plus_bytes(*offset);
            let stores: Vec<String> = (0..*components)
                .map(|k| {
                    store(
                        *scalar,
                        &at.render(base, k),
                        &component(value, mtek_type, k),
                    )
                })
                .collect();
            p.line(&stores.join(" "));
        }
        LayoutNode::Matrix {
            offset,
            columns,
            rows,
            column_stride,
            ..
        } => {
            let at = origin.plus_bytes(*offset);
            for column in 0..*columns {
                let column_at = at.plus_bytes(column.saturating_mul(*column_stride));
                let stores: Vec<String> = (0..*rows)
                    .map(|row| {
                        store(
                            ScalarKind::F32,
                            &column_at.render(base, row),
                            &format!("{value}[{}]", column * rows + row),
                        )
                    })
                    .collect();
                p.line(&stores.join(" "));
            }
        }
        LayoutNode::Struct { members, .. } => {
            for member in members {
                emit_node(
                    p,
                    &member.node,
                    &member_access(value, &member.name),
                    origin,
                    &member.mtek_type,
                    depth,
                    base,
                );
            }
        }
        LayoutNode::Array {
            offset,
            length,
            stride,
            element,
            ..
        } => {
            let array_at = origin.plus_bytes(*offset);
            let element_ty = element_type(mtek_type);
            if *length > MAX_UNROLLED_LENGTH {
                let variable = format!("i{depth}");
                let header =
                    format!("for (let {variable} = 0; {variable} < {length}; {variable}++)");
                p.block(&header, |p| {
                    emit_node(
                        p,
                        element,
                        &format!("{value}[{variable}]"),
                        &array_at.plus_term(&variable, *stride),
                        element_ty,
                        depth + 1,
                        base,
                    );
                });
            } else {
                for i in 0..*length {
                    emit_node(
                        p,
                        element,
                        &format!("{value}[{i}]"),
                        &array_at.plus_bytes(i.saturating_mul(*stride)),
                        element_ty,
                        depth,
                        base,
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{LayoutType, compute};

    fn record_of(id: &str, wgsl: &str, ty: &LayoutType) -> LayoutRecord {
        compute(ty, id, wgsl).expect("layout")
    }

    fn structure(name: &str, members: &[(&str, LayoutType)]) -> LayoutType {
        LayoutType::new_struct(
            name,
            members
                .iter()
                .map(|(n, t)| ((*n).to_owned(), t.clone()))
                .collect(),
        )
    }

    /// The example of `spec/gpu-layout.md` section 7, without its explanatory comments.
    #[test]
    fn pulse_matches_the_specification_example() {
        let ty = structure(
            "Pulse",
            &[("tint", LayoutType::Color), ("phase", LayoutType::F32)],
        );
        let record = record_of(
            "material:src/main.mtek::Pulse",
            "MtekParams_1f3a9c2e_Pulse",
            &ty,
        );
        assert_eq!(record.size, 32);
        assert_eq!(writer_qualifier(&record), "1f3a9c2e_Pulse");
        let parts = emit_writer_parts(&record, &writer_qualifier(&record));
        let expected = "\
// Generated from layout material:src/main.mtek::Pulse (size 32). Do not edit.
function w_1f3a9c2e_Pulse_tint(m, base, v) {
  const w = base >>> 2;
  m.f32[w + 0] = v.r; m.f32[w + 1] = v.g; m.f32[w + 2] = v.b; m.f32[w + 3] = v.a;
}
function w_1f3a9c2e_Pulse_phase(m, base, v) {
  m.f32[(base >>> 2) + 4] = v;
}
function w_1f3a9c2e_Pulse(m, base, v) {
  w_1f3a9c2e_Pulse_tint(m, base, v.tint);
  w_1f3a9c2e_Pulse_phase(m, base, v.phase);
}
";
        assert_eq!(parts.functions, expected);
        assert_eq!(
            parts.table_entry,
            r#""material:src/main.mtek::Pulse": { all: w_1f3a9c2e_Pulse, fields: { tint: w_1f3a9c2e_Pulse_tint, phase: w_1f3a9c2e_Pulse_phase } },"#
        );
        assert_eq!(
            parts.function_names,
            [
                "w_1f3a9c2e_Pulse",
                "w_1f3a9c2e_Pulse_tint",
                "w_1f3a9c2e_Pulse_phase"
            ]
        );
    }

    #[test]
    fn scalar_kinds_use_their_own_views_and_bool_becomes_a_u32() {
        let ty = structure(
            "K",
            &[
                ("a", LayoutType::I32),
                ("b", LayoutType::U32),
                ("c", LayoutType::Bool),
            ],
        );
        let record = record_of("fixture:k", "MtekFixture_k", &ty);
        let text = emit_writers(&record, "fixture_k");
        assert!(text.contains("m.i32[(base >>> 2) + 0] = v;"), "{text}");
        assert!(text.contains("m.u32[(base >>> 2) + 1] = v;"), "{text}");
        assert!(
            text.contains("m.u32[(base >>> 2) + 2] = v ? 1 : 0;"),
            "{text}"
        );
    }

    #[test]
    fn vectors_colours_quaternions_and_matrices_use_their_shapes() {
        let ty = structure(
            "S",
            &[
                ("q", LayoutType::Quat),
                ("c", LayoutType::Color),
                ("m", LayoutType::Mat4),
                ("d", LayoutType::Vec2),
            ],
        );
        let record = record_of("fixture:s", "MtekFixture_s", &ty);
        let text = emit_writers(&record, "fixture_s");
        assert!(text.contains("m.f32[w + 3] = v.w;"), "{text}");
        assert!(text.contains("m.f32[w + 7] = v.a;"), "{text}");
        // Column 1 of the matrix starts at byte 16 of the matrix, which sits at byte 32.
        assert!(
            text.contains(
                "m.f32[w + 12] = v[4]; m.f32[w + 13] = v[5]; m.f32[w + 14] = v[6]; m.f32[w + 15] = v[7];"
            ),
            "{text}"
        );
        assert!(
            text.contains("m.f32[w + 0] = v.x; m.f32[w + 1] = v.y;"),
            "{text}"
        );
    }

    #[test]
    fn colour_arrays_keep_their_component_names() {
        let ty = structure("S", &[("cs", LayoutType::new_array(LayoutType::Color, 2))]);
        let record = record_of("fixture:s", "MtekFixture_s", &ty);
        let text = emit_writers(&record, "fixture_s");
        assert!(text.contains("m.f32[w + 4] = v[1].r;"), "{text}");
        let ty = structure("S", &[("vs", LayoutType::new_array(LayoutType::Vec4, 2))]);
        let record = record_of("fixture:s", "MtekFixture_s", &ty);
        assert!(emit_writers(&record, "fixture_s").contains("v[1].x;"));
    }

    #[test]
    fn arrays_of_sixteen_are_straight_line_and_seventeen_loop() {
        let array = |n: u32| structure("S", &[("a", LayoutType::new_array(LayoutType::Vec3, n))]);
        let sixteen = emit_writers(
            &record_of("fixture:a", "MtekFixture_a", &array(16)),
            "fixture_a",
        );
        assert!(!sixteen.contains("for ("), "{sixteen}");
        assert!(sixteen.contains("v[15].z"), "{sixteen}");
        let seventeen = emit_writers(
            &record_of("fixture:a", "MtekFixture_a", &array(17)),
            "fixture_a",
        );
        assert!(
            seventeen.contains("for (let i0 = 0; i0 < 17; i0++) {"),
            "{seventeen}"
        );
        assert!(
            seventeen.contains("m.f32[w + 0 + i0 * 4] = v[i0].x;"),
            "{seventeen}"
        );
    }

    #[test]
    fn nested_long_arrays_use_distinct_loop_variables() {
        let inner = LayoutType::new_array(LayoutType::F32, 20);
        let ty = structure("S", &[("m", LayoutType::new_array(inner, 18))]);
        let record = record_of("fixture:n", "MtekFixture_n", &ty);
        let text = emit_writers(&record, "fixture_n");
        assert!(text.contains("for (let i0 = 0; i0 < 18; i0++) {"), "{text}");
        assert!(text.contains("for (let i1 = 0; i1 < 20; i1++) {"), "{text}");
        assert!(text.contains("v[i0][i1]"), "{text}");
        assert!(text.contains("+ i0 * 80 + i1 * 4]"), "{text}");
    }

    #[test]
    fn output_is_private_deterministic_and_has_the_header() {
        let ty = structure("S", &[("a", LayoutType::F32)]);
        let record = record_of("fixture:s", "MtekFixture_s", &ty);
        let first = emit_writers(&record, "fixture_s");
        assert_eq!(first, emit_writers(&record, "fixture_s"));
        assert!(
            first.starts_with("// Generated from layout fixture:s (size 4). Do not edit.\n"),
            "{first}"
        );
        assert!(!first.contains("export"), "{first}");
        assert!(!first.contains("writers"), "{first}");
    }

    #[test]
    fn test_module_wraps_with_exactly_one_export_statement() {
        let ty = structure("S", &[("a", LayoutType::F32), ("b", LayoutType::U32)]);
        let record = record_of("fixture:s", "MtekFixture_s", &ty);
        let module = emit_test_module(&record, "fixture_s");
        assert!(module.starts_with(&emit_writers(&record, "fixture_s")));
        assert_eq!(module.matches("export").count(), 1, "{module}");
        assert!(
            module.ends_with(
                "export {\n  w_fixture_s,\n  w_fixture_s_a,\n  w_fixture_s_b,\n  writers,\n};\n"
            ),
            "{module}"
        );
        assert!(module.contains("const writers = {\n  \"fixture:s\": { all: w_fixture_s,"));
    }

    #[test]
    fn hostile_names_never_reach_the_output_unescaped() {
        let mut record = record_of(
            "fixture:s",
            "MtekFixture_s",
            &structure(
                "S",
                &[("a", LayoutType::F32), ("__proto__", LayoutType::F32)],
            ),
        );
        record.id = "x\"\n}; evil(); //".to_owned();
        let parts = emit_writer_parts(&record, "fixture_\n}; evil();");
        // Only the (single-line) header comment may mention the hostile id.
        for line in parts.functions.lines().skip(1) {
            assert!(!line.contains("evil();"), "{line}");
        }
        assert_eq!(parts.table_entry.lines().count(), 1);
        assert!(
            parts
                .functions
                .starts_with("// Generated from layout x\"?}; evil(); //")
        );
        assert_eq!(
            parts.functions.lines().next().map(|l| l.starts_with("//")),
            Some(true)
        );
        assert!(parts.table_entry.starts_with(r#""x\"\n}; evil(); //": "#));
        assert!(
            parts.table_entry.contains(r#"["__proto__"]: "#),
            "{}",
            parts.table_entry
        );
        // Function names stay plain identifiers.
        assert!(
            parts
                .function_names
                .iter()
                .all(|n| n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
        );
    }

    #[test]
    fn qualifiers_follow_the_naming_rules() {
        let ty = structure("S", &[("a", LayoutType::F32)]);
        let make = |id: &str, wgsl: &str| writer_qualifier(&record_of(id, wgsl, &ty));
        assert_eq!(make("fixture:mixed", "MtekFixture_mixed"), "fixture_mixed");
        assert_eq!(make("builtin:frame", "MtekFrame"), "builtin_MtekFrame");
        assert_eq!(make("builtin:object", "MtekObject"), "builtin_MtekObject");
        assert_eq!(
            make("material:src/a.mtek::Glow", "MtekParams_0123abcd_Glow"),
            "0123abcd_Glow"
        );
    }
}
