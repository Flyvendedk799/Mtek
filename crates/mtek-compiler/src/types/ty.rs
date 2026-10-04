//! Types (`spec/language.md` section 5) and their interner
//! (`spec/compiler-architecture.md` section 4.7).
//!
//! A type is a [`Ty`]; the checker refers to types by [`TyId`], an index into
//! a [`TyInterner`] that stores every distinct type once. The primitive types
//! have fixed ids ([`TyId::ERROR`], [`TyId::F32`], ...), so code can name them
//! without an interner at hand.
//!
//! [`Ty::Error`] is the type of an expression that could not be typed. It is
//! compatible with every type and never causes another diagnostic: whoever
//! produced it has already reported the problem (`spec/compiler-architecture.md`
//! section 3).

use std::collections::BTreeMap;

use crate::resolve::DefId;
use crate::source::FileId;
use crate::stdlib::{SchemaCategory, TypeKind, TypeRef, registry};

/// A type, by its index in a [`TyInterner`].
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct TyId(u32);

impl TyId {
    pub const ERROR: TyId = TyId(0);
    pub const UNIT: TyId = TyId(1);
    pub const BOOL: TyId = TyId(2);
    pub const I32: TyId = TyId(3);
    pub const U32: TyId = TyId(4);
    pub const F32: TyId = TyId(5);
    pub const STRING: TyId = TyId(6);
    pub const VEC2: TyId = TyId(7);
    pub const VEC3: TyId = TyId(8);
    pub const VEC4: TyId = TyId(9);
    pub const MAT4: TyId = TyId(10);
    pub const QUAT: TyId = TyId(11);
    pub const COLOR: TyId = TyId(12);
    pub const MESH: TyId = TyId(13);
    pub const MATERIAL: TyId = TyId(14);
    pub const TEXTURE: TyId = TyId(15);
    pub const SAMPLER: TyId = TyId(16);
    pub const ENTITY_REF: TyId = TyId(17);
    pub const GLB_ASSET: TyId = TyId(18);

    /// The id as an index into the interner.
    #[must_use]
    pub fn index(self) -> usize {
        self.0 as usize
    }

    /// The `f32` vector with `dim` components (2, 3 or 4).
    #[must_use]
    pub fn vector(dim: usize) -> Option<TyId> {
        match dim {
            2 => Some(TyId::VEC2),
            3 => Some(TyId::VEC3),
            4 => Some(TyId::VEC4),
            _ => None,
        }
    }
}

/// The kinds of type of v0.1 (`spec/language.md` section 5.1), the built-in
/// types of the registry that have no syntax of their own (records, enums,
/// schema descriptors), and [`Ty::Error`].
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Ty {
    /// An expression that could not be typed; compatible with everything.
    Error,
    /// The result of a function without `->`; not usable as a value.
    Unit,
    Bool,
    I32,
    U32,
    F32,
    /// CPU only.
    String,
    Vec2,
    Vec3,
    Vec4,
    /// Column-major 4x4 `f32`.
    Mat4,
    /// Unit quaternion `(x, y, z, w)`; distinct from `vec4`.
    Quat,
    /// Linear-light RGBA; distinct from `vec4`.
    Color,
    /// `array<T, N>`, structural: one type everywhere (section 5.2).
    Array {
        element: TyId,
        len: u32,
    },
    /// A user `struct`: nominal, identified by its declaration (in any
    /// module, decision 0035 item 5).
    Struct(StructKey),
    Mesh,
    Material,
    Texture,
    Sampler,
    EntityRef,
    /// The compile-time handle of `asset.glb(..)` (`spec/assets.md` section 2).
    GlbAsset,
    /// A built-in record type of the registry (`SurfaceInput`, `PointerEvent`).
    Record(&'static str),
    /// A registry enum (`Key`).
    Enum(&'static str),
    /// The value of a descriptor literal of a registry schema (`Box { .. }`):
    /// nominal, one type per schema. It is accepted wherever the registry
    /// expects a value of the schema's category ([`TyInterner::assignable`]).
    Schema(&'static str),
    /// What the registry calls a descriptor of a category without a handle
    /// type (`TypeRef::Descriptor`): the type of the fields `projection`,
    /// `light`, `body`, `collider`.
    Descriptor(SchemaCategory),
    /// The argument of `spawn`: a prefab descriptor.
    PrefabDescriptor,
}

/// The types with fixed ids, in id order.
const PRIMITIVES: [Ty; 19] = [
    Ty::Error,
    Ty::Unit,
    Ty::Bool,
    Ty::I32,
    Ty::U32,
    Ty::F32,
    Ty::String,
    Ty::Vec2,
    Ty::Vec3,
    Ty::Vec4,
    Ty::Mat4,
    Ty::Quat,
    Ty::Color,
    Ty::Mesh,
    Ty::Material,
    Ty::Texture,
    Ty::Sampler,
    Ty::EntityRef,
    Ty::GlbAsset,
];

/// The registry types without parameters, by which the registry's type names
/// are mapped to [`Ty`] (through [`TypeRef::spelling`], so the registry stays
/// the only place that spells them).
const NAMED_TYPE_REFS: [TypeRef; 17] = [
    TypeRef::Bool,
    TypeRef::I32,
    TypeRef::U32,
    TypeRef::F32,
    TypeRef::String,
    TypeRef::Vec2,
    TypeRef::Vec3,
    TypeRef::Vec4,
    TypeRef::Mat4,
    TypeRef::Quat,
    TypeRef::Color,
    TypeRef::Mesh,
    TypeRef::Material,
    TypeRef::Texture,
    TypeRef::Sampler,
    TypeRef::EntityRef,
    TypeRef::GlbAsset,
];

/// The identity of a user struct type: its declaration, by the file that
/// declares it and its `DefId` there. It is the same in every module, so a
/// struct type keeps its identity when it crosses an import (decision 0035
/// item 5).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct StructKey {
    /// The file of the declaring module.
    pub file: FileId,
    /// The declaration in that module's resolution.
    pub def: DefId,
}

/// The fields of a user struct type, in declaration order, with their types
/// in the interner that holds the definition.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StructDef {
    /// The struct's name, as diagnostics print it.
    pub name: String,
    /// `(name, type)` of each field; empty until the declaration is checked
    /// (and for a struct whose declaration has an error).
    pub fields: Vec<(String, TyId)>,
}

impl StructDef {
    /// The type of the field `name`.
    #[must_use]
    pub fn field(&self, name: &str) -> Option<TyId> {
        self.fields.iter().find(|(n, _)| n == name).map(|(_, t)| *t)
    }
}

/// Every type of one compilation, stored once.
#[derive(Clone, Debug)]
pub struct TyInterner {
    types: Vec<Ty>,
    ids: BTreeMap<Ty, TyId>,
    /// The names and fields of struct types.
    structs: BTreeMap<StructKey, StructDef>,
}

impl Default for TyInterner {
    fn default() -> Self {
        Self::new()
    }
}

impl TyInterner {
    /// An interner holding the primitive types at their fixed ids.
    #[must_use]
    pub fn new() -> Self {
        let mut interner = Self {
            types: Vec::new(),
            ids: BTreeMap::new(),
            structs: BTreeMap::new(),
        };
        for ty in PRIMITIVES {
            interner.intern(ty);
        }
        interner
    }

    /// The id of `ty`, adding it if it is new.
    pub fn intern(&mut self, ty: Ty) -> TyId {
        if let Some(&id) = self.ids.get(&ty) {
            return id;
        }
        // More than u32::MAX distinct types cannot be built from a source file
        // of at most 4 MiB; should it happen, the type degrades to `Error`.
        let Ok(index) = u32::try_from(self.types.len()) else {
            return TyId::ERROR;
        };
        let id = TyId(index);
        self.types.push(ty);
        self.ids.insert(ty, id);
        id
    }

    /// The struct type declared as `key`, named `name` in diagnostics (its
    /// fields are given by [`Self::define_struct`]).
    pub fn intern_struct(&mut self, key: StructKey, name: &str) -> TyId {
        self.structs.entry(key).or_insert_with(|| StructDef {
            name: name.to_owned(),
            fields: Vec::new(),
        });
        self.intern(Ty::Struct(key))
    }

    /// Record the fields of the struct type `key`.
    pub fn define_struct(&mut self, key: StructKey, fields: Vec<(String, TyId)>) {
        if let Some(def) = self.structs.get_mut(&key) {
            def.fields = fields;
        }
    }

    /// The definition of a struct type.
    #[must_use]
    pub fn struct_def(&self, id: TyId) -> Option<&StructDef> {
        match self.get(id) {
            Ty::Struct(key) => self.structs.get(&key),
            _ => None,
        }
    }

    /// The type `id` of the interner `other` (another module's), as a type of
    /// this interner (decision 0036). Built-in types carry over unchanged,
    /// arrays element by element, and a user struct keeps its identity
    /// (its [`StructKey`]) and brings its definition, with every struct its
    /// fields name. The structs are copied with a worklist, so a long chain
    /// of structs nesting each other needs no deep recursion.
    pub fn import_from(&mut self, other: &TyInterner, id: TyId) -> TyId {
        let mut pending = Vec::new();
        let imported = self.import_shallow(other, id, &mut pending);
        while let Some(key) = pending.pop() {
            let Some(def) = other.structs.get(&key) else {
                continue;
            };
            let fields = def
                .fields
                .iter()
                .map(|(name, ty)| (name.clone(), self.import_shallow(other, *ty, &mut pending)))
                .collect();
            self.define_struct(key, fields);
        }
        imported
    }

    /// One type of `other` in this interner; a struct this interner does not
    /// know yet is registered by name and queued in `pending` for its fields.
    fn import_shallow(
        &mut self,
        other: &TyInterner,
        id: TyId,
        pending: &mut Vec<StructKey>,
    ) -> TyId {
        // Arrays nest at most as deep as the parser lets types nest, so the
        // recursion is bounded by the parser's depth limit.
        match other.get(id) {
            Ty::Struct(key) => {
                if !self.structs.contains_key(&key) {
                    let name = other
                        .structs
                        .get(&key)
                        .map_or_else(|| "struct".to_owned(), |d| d.name.clone());
                    pending.push(key);
                    return self.intern_struct(key, &name);
                }
                self.intern(Ty::Struct(key))
            }
            Ty::Array { element, len } => {
                let element = self.import_shallow(other, element, pending);
                if self.is_error(element) {
                    TyId::ERROR
                } else {
                    self.intern(Ty::Array { element, len })
                }
            }
            ty => self.intern(ty),
        }
    }

    /// The type behind `id` (`Error` for an id of another interner).
    #[must_use]
    pub fn get(&self, id: TyId) -> Ty {
        self.types.get(id.index()).copied().unwrap_or(Ty::Error)
    }

    /// The number of distinct types.
    #[must_use]
    pub fn len(&self) -> usize {
        self.types.len()
    }

    /// Whether the interner is empty (never: the primitives are always there).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.types.is_empty()
    }

    /// The type a registry [`TypeRef`] denotes.
    pub fn from_type_ref(&mut self, ty: TypeRef) -> TyId {
        let ty = match ty {
            TypeRef::Bool => Ty::Bool,
            TypeRef::I32 => Ty::I32,
            TypeRef::U32 => Ty::U32,
            TypeRef::F32 => Ty::F32,
            TypeRef::String => Ty::String,
            TypeRef::Vec2 => Ty::Vec2,
            TypeRef::Vec3 => Ty::Vec3,
            TypeRef::Vec4 => Ty::Vec4,
            TypeRef::Mat4 => Ty::Mat4,
            TypeRef::Quat => Ty::Quat,
            TypeRef::Color => Ty::Color,
            TypeRef::Mesh => Ty::Mesh,
            TypeRef::Material => Ty::Material,
            TypeRef::Texture => Ty::Texture,
            TypeRef::Sampler => Ty::Sampler,
            TypeRef::EntityRef => Ty::EntityRef,
            TypeRef::GlbAsset => Ty::GlbAsset,
            TypeRef::Unit => Ty::Unit,
            TypeRef::Record(name) => Ty::Record(name),
            TypeRef::Enum(name) => Ty::Enum(name),
            TypeRef::Descriptor(category) => Ty::Descriptor(category),
            TypeRef::PrefabDescriptor => Ty::PrefabDescriptor,
        };
        self.intern(ty)
    }

    /// The registry [`TypeRef`] of a type, where the registry has one (for
    /// overload resolution against registry signatures).
    #[must_use]
    pub fn to_type_ref(&self, id: TyId) -> Option<TypeRef> {
        Some(match self.get(id) {
            Ty::Bool => TypeRef::Bool,
            Ty::I32 => TypeRef::I32,
            Ty::U32 => TypeRef::U32,
            Ty::F32 => TypeRef::F32,
            Ty::String => TypeRef::String,
            Ty::Vec2 => TypeRef::Vec2,
            Ty::Vec3 => TypeRef::Vec3,
            Ty::Vec4 => TypeRef::Vec4,
            Ty::Mat4 => TypeRef::Mat4,
            Ty::Quat => TypeRef::Quat,
            Ty::Color => TypeRef::Color,
            Ty::Mesh => TypeRef::Mesh,
            Ty::Material => TypeRef::Material,
            Ty::Texture => TypeRef::Texture,
            Ty::Sampler => TypeRef::Sampler,
            Ty::EntityRef => TypeRef::EntityRef,
            Ty::GlbAsset => TypeRef::GlbAsset,
            Ty::Unit => TypeRef::Unit,
            Ty::Record(name) => TypeRef::Record(name),
            Ty::Enum(name) => TypeRef::Enum(name),
            Ty::Descriptor(category) => TypeRef::Descriptor(category),
            Ty::PrefabDescriptor => TypeRef::PrefabDescriptor,
            Ty::Error | Ty::Array { .. } | Ty::Struct(_) | Ty::Schema(_) => return None,
        })
    }

    /// The type named `name` by the registry, if it is a type without
    /// parameters (`array` needs its element type and length: `None`).
    pub fn prelude_type(&mut self, name: &str) -> Option<TyId> {
        let def = registry().type_def(name)?;
        match def.kind {
            TypeKind::Record => Some(self.intern(Ty::Record(def.name))),
            TypeKind::Array => None,
            _ => {
                let type_ref = NAMED_TYPE_REFS
                    .iter()
                    .copied()
                    .find(|t| t.spelling() == def.name)?;
                Some(self.from_type_ref(type_ref))
            }
        }
    }

    /// Whether `id` is the error type.
    #[must_use]
    pub fn is_error(&self, id: TyId) -> bool {
        self.get(id) == Ty::Error
    }

    /// `i32`, `u32` or `f32`: the types an integer literal can adopt and the
    /// operands and results of the numeric conversions (section 6.5).
    #[must_use]
    pub fn is_numeric_scalar(&self, id: TyId) -> bool {
        matches!(self.get(id), Ty::I32 | Ty::U32 | Ty::F32)
    }

    /// The number of components of a vector type.
    #[must_use]
    pub fn vector_dim(&self, id: TyId) -> Option<usize> {
        match self.get(id) {
            Ty::Vec2 => Some(2),
            Ty::Vec3 => Some(3),
            Ty::Vec4 => Some(4),
            _ => None,
        }
    }

    /// Whether a value of type `actual` may stand where `expected` is
    /// required. Types are equal, or one of them is [`Ty::Error`], or `actual`
    /// is a registry schema descriptor and `expected` the registry type of its
    /// category (`Box { .. }` where a `mesh` is expected, `Perspective { .. }`
    /// where a `projection` descriptor is expected).
    #[must_use]
    pub fn assignable(&self, actual: TyId, expected: TyId) -> bool {
        if actual == expected || self.is_error(actual) || self.is_error(expected) {
            return true;
        }
        let Ty::Schema(schema) = self.get(actual) else {
            return false;
        };
        let Some(category) = registry().schema(schema).map(|s| s.category) else {
            return false;
        };
        match self.get(expected) {
            Ty::Mesh => category == SchemaCategory::Mesh,
            Ty::Material => category == SchemaCategory::Material,
            Ty::Descriptor(expected_category) => category == expected_category,
            _ => false,
        }
    }

    /// The Mtek spelling of a type, as diagnostics print it (`vec3`,
    /// `array<f32, 4>`, `Box`).
    #[must_use]
    pub fn display(&self, id: TyId) -> String {
        match self.get(id) {
            Ty::Error => "{error}".to_owned(),
            Ty::Array { element, len } => format!("array<{}, {len}>", self.display(element)),
            Ty::Struct(key) => self
                .structs
                .get(&key)
                .map_or_else(|| "struct".to_owned(), |def| def.name.clone()),
            Ty::Schema(name) => name.to_owned(),
            _ => self
                .to_type_ref(id)
                .map_or_else(|| "{error}".to_owned(), |t| t.spelling().to_owned()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primitives_have_their_fixed_ids() {
        let interner = TyInterner::new();
        assert_eq!(interner.len(), PRIMITIVES.len());
        for (index, ty) in PRIMITIVES.iter().enumerate() {
            assert_eq!(interner.get(TyId(index as u32)), *ty);
        }
        assert_eq!(interner.get(TyId::ERROR), Ty::Error);
        assert_eq!(interner.get(TyId::F32), Ty::F32);
        assert_eq!(interner.get(TyId::VEC3), Ty::Vec3);
        assert_eq!(interner.get(TyId::COLOR), Ty::Color);
        assert_eq!(interner.get(TyId::GLB_ASSET), Ty::GlbAsset);
        assert_eq!(interner.get(TyId(9999)), Ty::Error);
    }

    #[test]
    fn interning_is_idempotent_and_structural() {
        let mut interner = TyInterner::new();
        let a = interner.intern(Ty::Array {
            element: TyId::F32,
            len: 3,
        });
        let b = interner.intern(Ty::Array {
            element: TyId::F32,
            len: 3,
        });
        let c = interner.intern(Ty::Array {
            element: TyId::F32,
            len: 4,
        });
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(interner.intern(Ty::F32), TyId::F32);
        assert_eq!(interner.display(c), "array<f32, 4>");
        let nested = interner.intern(Ty::Array { element: c, len: 2 });
        assert_eq!(interner.display(nested), "array<array<f32, 4>, 2>");
    }

    #[test]
    fn structs_are_nominal() {
        let mut interner = TyInterner::new();
        let key = |file, def| StructKey {
            file: FileId(file),
            def: DefId(def),
        };
        let a = interner.intern_struct(key(0, 1), "Light");
        let b = interner.intern_struct(key(0, 2), "Light");
        // The same `DefId` in another module is another struct.
        let c = interner.intern_struct(key(1, 1), "Light");
        assert_ne!(a, b);
        assert_ne!(a, c);
        assert_eq!(interner.display(a), "Light");
        assert!(!interner.assignable(a, b));
    }

    #[test]
    fn struct_types_cross_modules_with_their_fields() {
        // Module 1 declares `Inner { v: vec3 }` and `Outer { a: array<Inner,
        // 2>, s: f32 }`; importing `Outer` brings both definitions along.
        let inner_key = StructKey {
            file: FileId(1),
            def: DefId(4),
        };
        let outer_key = StructKey {
            file: FileId(1),
            def: DefId(5),
        };
        let mut exporter = TyInterner::new();
        let inner = exporter.intern_struct(inner_key, "Inner");
        exporter.define_struct(inner_key, vec![("v".into(), TyId::VEC3)]);
        let array = exporter.intern(Ty::Array {
            element: inner,
            len: 2,
        });
        let outer = exporter.intern_struct(outer_key, "Outer");
        exporter.define_struct(
            outer_key,
            vec![("a".into(), array), ("s".into(), TyId::F32)],
        );

        let mut importer = TyInterner::new();
        // Shift the importer's ids so that equal ids would be a coincidence.
        importer.intern(Ty::Array {
            element: TyId::BOOL,
            len: 7,
        });
        let imported = importer.import_from(&exporter, outer);
        assert_eq!(importer.get(imported), Ty::Struct(outer_key));
        assert_eq!(importer.display(imported), "Outer");
        let def = importer.struct_def(imported).unwrap().clone();
        assert_eq!(def.field("s"), Some(TyId::F32));
        let a = def.field("a").unwrap();
        let Ty::Array { element, len: 2 } = importer.get(a) else {
            panic!("{:?}", importer.get(a))
        };
        assert_eq!(importer.display(element), "Inner");
        assert_eq!(
            importer.struct_def(element).unwrap().field("v"),
            Some(TyId::VEC3)
        );
        // Importing again changes nothing.
        assert_eq!(importer.import_from(&exporter, outer), imported);
    }

    #[test]
    fn every_registry_type_maps_to_a_ty() {
        let mut interner = TyInterner::new();
        for def in &registry().types {
            let ty = interner.prelude_type(def.name);
            if def.kind == TypeKind::Array {
                assert_eq!(ty, None, "{}", def.name);
                continue;
            }
            let Some(ty) = ty else {
                panic!("registry type {} has no Ty", def.name)
            };
            assert_eq!(interner.display(ty), def.name);
        }
        assert_eq!(interner.prelude_type("vec5"), None);
        assert_eq!(interner.prelude_type("Box"), None);
    }

    #[test]
    fn type_refs_round_trip() {
        let mut interner = TyInterner::new();
        let refs = NAMED_TYPE_REFS.iter().copied().chain([
            TypeRef::Unit,
            TypeRef::Record("PointerEvent"),
            TypeRef::Enum("Key"),
            TypeRef::Descriptor(SchemaCategory::Projection),
            TypeRef::PrefabDescriptor,
        ]);
        for type_ref in refs {
            let id = interner.from_type_ref(type_ref);
            assert_eq!(interner.to_type_ref(id), Some(type_ref));
            assert_eq!(interner.display(id), type_ref.spelling());
        }
        let schema = interner.intern(Ty::Schema("Box"));
        assert_eq!(interner.to_type_ref(schema), None);
        assert_eq!(interner.display(schema), "Box");
    }

    #[test]
    fn schema_descriptors_are_assignable_to_their_category() {
        let mut interner = TyInterner::new();
        let boxed = interner.intern(Ty::Schema("Box"));
        let unlit = interner.intern(Ty::Schema("Unlit"));
        let perspective = interner.intern(Ty::Schema("Perspective"));
        let projection = interner.from_type_ref(TypeRef::Descriptor(SchemaCategory::Projection));
        let light = interner.from_type_ref(TypeRef::Descriptor(SchemaCategory::Light));
        assert!(interner.assignable(boxed, TyId::MESH));
        assert!(!interner.assignable(boxed, TyId::MATERIAL));
        assert!(interner.assignable(unlit, TyId::MATERIAL));
        assert!(interner.assignable(perspective, projection));
        assert!(!interner.assignable(perspective, light));
        assert!(!interner.assignable(TyId::MESH, boxed));
        assert!(!interner.assignable(TyId::VEC3, TyId::VEC4));
        assert!(!interner.assignable(TyId::VEC4, TyId::QUAT));
        assert!(!interner.assignable(TyId::VEC4, TyId::COLOR));
    }

    #[test]
    fn error_is_compatible_with_everything() {
        let interner = TyInterner::new();
        for ty in [TyId::F32, TyId::VEC3, TyId::QUAT, TyId::MESH] {
            assert!(interner.assignable(TyId::ERROR, ty));
            assert!(interner.assignable(ty, TyId::ERROR));
        }
        assert!(interner.is_error(TyId::ERROR));
    }

    #[test]
    fn classification() {
        let interner = TyInterner::new();
        assert!(interner.is_numeric_scalar(TyId::I32));
        assert!(interner.is_numeric_scalar(TyId::F32));
        assert!(!interner.is_numeric_scalar(TyId::BOOL));
        assert_eq!(interner.vector_dim(TyId::VEC2), Some(2));
        assert_eq!(interner.vector_dim(TyId::QUAT), None);
        assert_eq!(TyId::vector(4), Some(TyId::VEC4));
        assert_eq!(TyId::vector(5), None);
    }
}
