//! Small constructors that keep the registry tables readable.

use crate::diagnostics::Code;
use crate::stdlib::model::{
    Domain, FieldDef, FieldFlags, FieldRule, IntrinsicDef, Milestone, ParamDef, SchemaCategory,
    SchemaDef, SigType, Signature, TypeClass, TypeRef,
};
use crate::stdlib::value::{ConstValue, ValueRange};

/// Writable and bindable: the flags of every field a program may change while it runs.
pub(super) fn writable_bindable() -> FieldFlags {
    FieldFlags::WRITABLE | FieldFlags::BINDABLE
}

/// A field with the given flags, no default, no range, available from M1.
pub(super) fn field(
    name: &'static str,
    ty: TypeRef,
    flags: FieldFlags,
    doc: &'static str,
) -> FieldDef {
    FieldDef {
        name,
        ty,
        default: None,
        default_when_set: None,
        flags,
        range: None,
        range_code: Code::E5006,
        since: Milestone::M1,
        doc,
    }
}

impl FieldDef {
    pub(super) fn default(mut self, value: ConstValue) -> Self {
        self.default = Some(value);
        self
    }

    pub(super) fn default_when_set(mut self, sibling: &'static str) -> Self {
        self.default_when_set = Some(sibling);
        self
    }

    pub(super) fn range(mut self, range: ValueRange) -> Self {
        self.range = Some(range);
        self
    }

    /// The code of a constant outside the range, when it is not `E5006`.
    pub(super) fn range_code(mut self, code: Code) -> Self {
        self.range_code = code;
        self
    }

    pub(super) fn since(mut self, since: Milestone) -> Self {
        self.since = since;
        self
    }
}

/// A schema whose fields are available from the schema's own milestone unless a field says
/// otherwise.
pub(super) fn schema(
    name: &'static str,
    category: SchemaCategory,
    since: Milestone,
    doc: &'static str,
    fields: Vec<FieldDef>,
) -> SchemaDef {
    SchemaDef {
        name,
        category,
        fields,
        rules: Vec::new(),
        since,
        doc,
    }
}

impl SchemaDef {
    /// Adds a rule between two of the schema's fields.
    pub(super) fn rule(mut self, rule: FieldRule) -> Self {
        self.rules.push(rule);
        self
    }
}

/// Shorthand for a concrete signature position.
pub(super) const fn exact(ty: TypeRef) -> SigType {
    SigType::Exact(ty)
}

/// The class `T` (`f32`, `vec2`, `vec3`, `vec4`).
pub(super) const T: SigType = SigType::Class(TypeClass::Float);
/// The class `I` (`i32`, `u32`).
pub(super) const I: SigType = SigType::Class(TypeClass::Int);
/// The class `V` (`vec2`, `vec3`, `vec4`).
pub(super) const V: SigType = SigType::Class(TypeClass::Vector);
/// The concrete type `f32`.
pub(super) const F32: SigType = SigType::Exact(TypeRef::F32);

/// A parameter of a signature.
pub(super) const fn p(name: &'static str, ty: SigType) -> ParamDef {
    ParamDef { name, ty }
}

/// One overload.
pub(super) fn sig(params: &[ParamDef], ret: SigType) -> Signature {
    Signature {
        params: params.to_vec(),
        ret,
    }
}

/// A function with the documented defaults: not handlers-only, no CPU semantics note.
pub(super) fn function(
    name: &'static str,
    domain: Domain,
    const_eligible: bool,
    since: Milestone,
    doc: &'static str,
    signatures: Vec<Signature>,
) -> IntrinsicDef {
    IntrinsicDef {
        name,
        signatures,
        domain,
        const_eligible,
        handlers_only: false,
        cpu_semantics: "",
        since,
        doc,
    }
}

impl IntrinsicDef {
    pub(super) fn cpu_semantics(mut self, note: &'static str) -> Self {
        self.cpu_semantics = note;
        self
    }

    pub(super) fn handlers_only(mut self) -> Self {
        self.handlers_only = true;
        self
    }
}
