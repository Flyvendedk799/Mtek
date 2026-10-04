//! The lookup API later stages use: name resolution of prelude symbols and field, argument
//! and overload checking all go through these functions.

use super::model::{
    BodyCommandDef, BodyPropertyDef, EnumDef, EnumMember, EventDef, FieldDef, IntrinsicDef,
    NamespaceDef, NamespaceMember, Registry, SceneObjectKind, SchemaDef, TypeDef,
};
use super::overload::ArgType;
use super::overload::{OverloadError, Resolution};

/// What a prelude name denotes. One name can denote several things: `color` is both a type
/// and a namespace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum PreludeNameKind {
    Type,
    Schema,
    Enum,
    Namespace,
    Function,
}

/// Why a call could not be resolved against the registry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveError {
    /// No intrinsic, namespace or function member of that name exists.
    Unknown,
    /// The function exists but no overload accepts the argument types.
    Overload(OverloadError),
}

impl Registry {
    /// The prelude type named `name`.
    pub fn type_def(&self, name: &str) -> Option<&TypeDef> {
        self.types.iter().find(|t| t.name == name)
    }

    /// The schema named `name`.
    pub fn schema(&self, name: &str) -> Option<&SchemaDef> {
        self.schemas.iter().find(|s| s.name == name)
    }

    /// The field `field` of the schema `schema`.
    pub fn schema_field(&self, schema: &str, field: &str) -> Option<&FieldDef> {
        self.schema(schema)?.field(field)
    }

    /// The scene-object kind introduced by `keyword` (`camera`).
    pub fn scene_object(&self, keyword: &str) -> Option<&SceneObjectKind> {
        self.scene_objects.iter().find(|k| k.keyword == keyword)
    }

    /// The schema of scene fields.
    pub fn scene_schema(&self) -> Option<&SchemaDef> {
        self.schema(self.declaration_schemas.scene)
    }

    /// The schema of entity and prefab fields.
    pub fn entity_schema(&self) -> Option<&SchemaDef> {
        self.schema(self.declaration_schemas.entity)
    }

    /// The event named `name`.
    pub fn event(&self, name: &str) -> Option<&EventDef> {
        self.events.iter().find(|e| e.name == name)
    }

    /// The enum named `name`.
    pub fn enum_def(&self, name: &str) -> Option<&EnumDef> {
        self.enums.iter().find(|e| e.name == name)
    }

    /// The member `member` of the enum `enum_name` (`Key.Space`).
    pub fn enum_member(&self, enum_name: &str, member: &str) -> Option<&EnumMember> {
        self.enum_def(enum_name)?
            .members
            .iter()
            .find(|m| m.name == member)
    }

    /// The member of the enum `enum_name` that maps from the DOM `KeyboardEvent.code` `code`.
    pub fn enum_member_by_code(&self, enum_name: &str, code: &str) -> Option<&EnumMember> {
        self.enum_def(enum_name)?
            .members
            .iter()
            .find(|m| m.code == code)
    }

    /// The global intrinsic function named `name`.
    pub fn intrinsic(&self, name: &str) -> Option<&IntrinsicDef> {
        self.intrinsics.iter().find(|i| i.name == name)
    }

    /// The namespace named `name`.
    pub fn namespace(&self, name: &str) -> Option<&NamespaceDef> {
        self.namespaces.iter().find(|n| n.name == name)
    }

    /// The member `member` of the namespace `namespace` (`quat.identity`, `frame.time`).
    pub fn namespace_member(&self, namespace: &str, member: &str) -> Option<&NamespaceMember> {
        self.namespace(namespace)?.member(member)
    }

    /// The accessor `method` of the handle type `type_name` (`glb_asset.mesh`).
    pub fn type_method(&self, type_name: &str, method: &str) -> Option<&IntrinsicDef> {
        self.type_def(type_name)?
            .methods
            .iter()
            .find(|m| m.name == method)
    }

    /// The body command named `name`.
    pub fn body_command(&self, name: &str) -> Option<&BodyCommandDef> {
        self.body_commands.iter().find(|c| c.name == name)
    }

    /// The readable body property named `name`.
    pub fn body_property(&self, name: &str) -> Option<&BodyPropertyDef> {
        self.body_properties.iter().find(|p| p.name == name)
    }

    /// The source text of the embedded prelude file `path`.
    pub fn prelude_source(&self, path: &str) -> Option<&'static str> {
        self.prelude_sources
            .iter()
            .find(|(p, _)| *p == path)
            .map(|(_, text)| *text)
    }

    /// Everything the prelude name `name` denotes, in a fixed order. Empty for a name that is
    /// not in the prelude. No declaration may reuse a prelude type, schema, enum or namespace
    /// name (`spec/language.md` section 4.2).
    pub fn prelude_name_kinds(&self, name: &str) -> Vec<PreludeNameKind> {
        let mut kinds = Vec::new();
        if self.type_def(name).is_some() {
            kinds.push(PreludeNameKind::Type);
        }
        if self.schema(name).is_some() {
            kinds.push(PreludeNameKind::Schema);
        }
        if self.enum_def(name).is_some() {
            kinds.push(PreludeNameKind::Enum);
        }
        if self.namespace(name).is_some() {
            kinds.push(PreludeNameKind::Namespace);
        }
        if self.intrinsic(name).is_some() {
            kinds.push(PreludeNameKind::Function);
        }
        kinds
    }

    /// Every top-level prelude name with what it denotes, sorted by name.
    pub fn prelude_names(&self) -> Vec<(&'static str, PreludeNameKind)> {
        let mut names: Vec<(&'static str, PreludeNameKind)> = Vec::new();
        names.extend(self.types.iter().map(|t| (t.name, PreludeNameKind::Type)));
        names.extend(
            self.schemas
                .iter()
                .map(|s| (s.name, PreludeNameKind::Schema)),
        );
        names.extend(self.enums.iter().map(|e| (e.name, PreludeNameKind::Enum)));
        names.extend(
            self.namespaces
                .iter()
                .map(|n| (n.name, PreludeNameKind::Namespace)),
        );
        names.extend(
            self.intrinsics
                .iter()
                .map(|i| (i.name, PreludeNameKind::Function)),
        );
        names.sort();
        names
    }

    /// Resolves a call of the global intrinsic `name` against the argument types.
    pub fn resolve_call(&self, name: &str, args: &[ArgType]) -> Result<Resolution, ResolveError> {
        let intrinsic = self.intrinsic(name).ok_or(ResolveError::Unknown)?;
        intrinsic.resolve(args).map_err(ResolveError::Overload)
    }

    /// Resolves a call of the namespace function `namespace.member`.
    pub fn resolve_namespace_call(
        &self,
        namespace: &str,
        member: &str,
        args: &[ArgType],
    ) -> Result<Resolution, ResolveError> {
        match self.namespace_member(namespace, member) {
            Some(NamespaceMember::Function(function)) => {
                function.resolve(args).map_err(ResolveError::Overload)
            }
            _ => Err(ResolveError::Unknown),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stdlib::registry;

    #[test]
    fn lookups_find_registered_items_and_reject_unknown_ones() {
        let registry = registry();
        assert!(registry.type_def("vec3").is_some());
        assert!(registry.type_def("vec5").is_none());
        assert!(registry.schema("Box").is_some());
        assert!(registry.schema("Cube").is_none());
        assert!(registry.schema_field("Box", "size").is_some());
        assert!(registry.schema_field("Box", "radius").is_none());
        assert!(registry.schema_field("Cube", "size").is_none());
        assert_eq!(
            registry.scene_object("camera").map(|k| k.schema),
            Some("Camera")
        );
        assert!(registry.scene_object("light").is_none());
        assert!(registry.event("key_down").is_some());
        assert!(registry.event("key_press").is_none());
        assert!(registry.enum_def("Key").is_some());
        assert!(registry.intrinsic("smoothstep").is_some());
        assert!(registry.intrinsic("quat").is_none());
        assert!(registry.namespace("frame").is_some());
        assert!(registry.body_command("teleport").is_some());
        assert!(registry.body_property("linear_velocity").is_some());
        assert!(registry.type_method("glb_asset", "node_scale").is_some());
        assert!(registry.type_method("mesh", "node_scale").is_none());
    }

    #[test]
    fn enum_members_map_to_and_from_dom_codes() {
        let registry = registry();
        let space = registry.enum_member("Key", "Space");
        assert_eq!(space.map(|m| m.code), Some("Space"));
        assert_eq!(
            registry.enum_member("Key", "A").map(|m| m.code),
            Some("KeyA")
        );
        assert_eq!(
            registry.enum_member_by_code("Key", "KeyA").map(|m| m.name),
            Some("A")
        );
        assert_eq!(
            registry
                .enum_member_by_code("Key", "Digit7")
                .map(|m| m.name),
            Some("Digit7")
        );
        assert!(registry.enum_member("Key", "Space2").is_none());
        assert!(registry.enum_member_by_code("Key", "F13").is_none());
        assert!(registry.enum_member("Nope", "A").is_none());
    }

    #[test]
    fn namespace_members_are_found_by_kind() {
        let registry = registry();
        assert!(matches!(
            registry.namespace_member("quat", "identity"),
            Some(NamespaceMember::Function(_))
        ));
        assert!(matches!(
            registry.namespace_member("frame", "time"),
            Some(NamespaceMember::Value(_))
        ));
        assert!(registry.namespace_member("frame", "fps").is_none());
        assert!(registry.namespace_member("Key", "Space").is_none());
    }

    #[test]
    fn prelude_names_can_denote_a_type_and_a_namespace() {
        let registry = registry();
        assert_eq!(
            registry.prelude_name_kinds("color"),
            vec![PreludeNameKind::Type, PreludeNameKind::Namespace]
        );
        assert_eq!(
            registry.prelude_name_kinds("Key"),
            vec![PreludeNameKind::Enum]
        );
        assert_eq!(
            registry.prelude_name_kinds("length"),
            vec![PreludeNameKind::Function]
        );
        assert_eq!(
            registry.prelude_name_kinds("Box"),
            vec![PreludeNameKind::Schema]
        );
        assert!(registry.prelude_name_kinds("camera").is_empty());
        let names = registry.prelude_names();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted);
        assert!(names.contains(&("Pbr", PreludeNameKind::Schema)));
    }

    #[test]
    fn prelude_sources_are_found_by_path() {
        let registry = registry();
        assert!(
            registry
                .prelude_source("std/materials.mtek")
                .is_some_and(|text| text.contains("export material Unlit"))
        );
        assert!(registry.prelude_source("std/other.mtek").is_none());
    }
}
