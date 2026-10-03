//! The standard library registry (`spec/stdlib.md`, blueprint section 3.4).
//!
//! Every prelude name is defined once, here, in Rust. From the registry the toolchain
//! generates name resolution of prelude symbols, field and argument checking,
//! `spec/stdlib-schema.json`, editor completion and hover, and the AI context export.
//!
//! - [`model`]: the data model ([`Registry`], [`SchemaDef`], [`FieldDef`], ...),
//! - [`value`]: constant values, their canonical text and value ranges,
//! - `data`: the v0.1 tables, complete from M1 with a `since` milestone per item,
//! - [`lookup`] and [`overload`]: the lookup API later stages use,
//! - [`validate`]: internal consistency of the tables,
//! - [`export`]: [`export_schema_json`], the generator of `spec/stdlib-schema.json`.

mod data;
pub mod export;
pub mod lookup;
pub mod model;
pub mod overload;
pub mod validate;
pub mod value;

use std::sync::OnceLock;

pub use export::{REGISTRY_VERSION, export_schema_json};
pub use lookup::{PreludeNameKind, ResolveError};
pub use model::{
    BodyCommandDef, BodyKind, BodyPropertyDef, CURRENT_MILESTONE, Domain, EnumDef, EnumMember,
    EventDef, EventForm, EventHost, FieldDef, FieldFlags, IntrinsicDef, Milestone, NamespaceDef,
    NamespaceMember, ParamDef, RecordField, Registry, SceneObjectKind, SchemaCategory, SchemaDef,
    SigType, Signature, TypeClass, TypeDef, TypeKind, TypeRef, ValueDef,
};
pub use overload::{ArgType, ConcreteSignature, OverloadError, Resolution};
pub use value::{
    BuiltinSampler, BuiltinTexture, ColorValue, ConstValue, Limit, ValueRange, format_f32,
    srgb_channel_to_linear_f32, srgb_to_linear,
};

impl Registry {
    /// Builds the complete v0.1 registry from the tables. Prefer [`registry()`], which builds
    /// it once.
    pub fn v0_1() -> Registry {
        data::build_registry()
    }
}

/// The v0.1 registry, built on first use and shared afterwards.
pub fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::v0_1)
}
