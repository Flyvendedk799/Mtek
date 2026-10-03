//! Overload resolution of intrinsic calls by argument types.
//!
//! A [`Signature`] is written with type classes (`T`, `I`, `V`); resolution expands it into
//! its concrete instantiations (`f32`, `vec2`, ... for `T`) and picks the instantiation whose
//! parameters accept the arguments.
//!
//! Literal arguments have no type of their own yet (`spec/language.md` section 6.6): an
//! integer literal adopts `i32`, `u32` or `f32` and a float literal adopts `f32`, so the
//! checker passes them as [`ArgType::IntLiteral`] / [`ArgType::FloatLiteral`]. A literal is
//! charged one point when it must adopt a type other than its default (`i32`, `f32`), and the
//! overload with the fewest points wins: `max(1, 2)` is the `i32` overload, `max(x, 1)` with
//! `x: f32` is the `f32` one. Two different results at the best score are an ambiguity, never
//! a silent pick. (Decision 0024 item 8.)

use super::model::{IntrinsicDef, SigType, Signature, TypeClass, TypeRef};

/// The type of one call argument as the checker knows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArgType {
    /// An expression of this type.
    Concrete(TypeRef),
    /// An integer literal that has not adopted a type yet.
    IntLiteral,
    /// A float literal that has not adopted a type yet.
    FloatLiteral,
}

/// One signature with every type class replaced by a concrete type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConcreteSignature {
    pub params: Vec<TypeRef>,
    pub ret: TypeRef,
}

/// The overload a call resolved to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolution {
    /// Index into [`IntrinsicDef::signatures`] of the (first) signature that produced it.
    pub signature: usize,
    /// The parameter types of the chosen instantiation, in order. A literal argument adopts
    /// the type at its position.
    pub params: Vec<TypeRef>,
    /// The result type of the call.
    pub ret: TypeRef,
}

/// Why no overload was chosen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OverloadError {
    /// No overload accepts these arguments (wrong count or wrong types).
    NoMatch,
    /// Several overloads with different results fit equally well.
    Ambiguous(Vec<ConcreteSignature>),
}

impl Signature {
    /// Every concrete instantiation of the signature: one per member of each class it uses
    /// (the product when it uses several classes).
    pub fn instantiations(&self) -> Vec<ConcreteSignature> {
        let mut used: Vec<TypeClass> = Vec::new();
        for ty in self.params.iter().map(|p| p.ty).chain([self.ret]) {
            if let SigType::Class(class) = ty
                && !used.contains(&class)
            {
                used.push(class);
            }
        }
        let mut bindings: Vec<Vec<(TypeClass, TypeRef)>> = vec![Vec::new()];
        for class in used {
            bindings = bindings
                .into_iter()
                .flat_map(|binding| {
                    class.members().iter().map(move |member| {
                        let mut extended = binding.clone();
                        extended.push((class, *member));
                        extended
                    })
                })
                .collect();
        }
        let instantiate = |ty: SigType, binding: &[(TypeClass, TypeRef)]| match ty {
            SigType::Exact(exact) => exact,
            SigType::Class(class) => binding
                .iter()
                .find(|(c, _)| *c == class)
                .map_or(TypeRef::Unit, |(_, member)| *member),
        };
        bindings
            .iter()
            .map(|binding| ConcreteSignature {
                params: self
                    .params
                    .iter()
                    .map(|p| instantiate(p.ty, binding))
                    .collect(),
                ret: instantiate(self.ret, binding),
            })
            .collect()
    }
}

/// The cost of passing `arg` for a parameter of type `param`, or `None` if it does not fit.
fn argument_cost(param: TypeRef, arg: ArgType) -> Option<u32> {
    match arg {
        ArgType::Concrete(ty) => (ty == param).then_some(0),
        ArgType::IntLiteral => match param {
            TypeRef::I32 => Some(0),
            TypeRef::U32 | TypeRef::F32 => Some(1),
            _ => None,
        },
        ArgType::FloatLiteral => (param == TypeRef::F32).then_some(0),
    }
}

impl IntrinsicDef {
    /// Chooses the overload for a call with the given argument types.
    pub fn resolve(&self, args: &[ArgType]) -> Result<Resolution, OverloadError> {
        struct Candidate {
            cost: u32,
            signature: usize,
            concrete: ConcreteSignature,
        }
        let mut candidates: Vec<Candidate> = Vec::new();
        for (index, signature) in self.signatures.iter().enumerate() {
            if signature.params.len() != args.len() {
                continue;
            }
            for concrete in signature.instantiations() {
                let costs: Option<Vec<u32>> = concrete
                    .params
                    .iter()
                    .zip(args)
                    .map(|(param, arg)| argument_cost(*param, *arg))
                    .collect();
                if let Some(costs) = costs {
                    candidates.push(Candidate {
                        cost: costs.iter().sum(),
                        signature: index,
                        concrete,
                    });
                }
            }
        }
        let Some(best) = candidates.iter().map(|c| c.cost).min() else {
            return Err(OverloadError::NoMatch);
        };
        let mut chosen: Vec<&Candidate> = Vec::new();
        for candidate in candidates.iter().filter(|c| c.cost == best) {
            // Overlapping signatures can yield the same instantiation twice; that is not an
            // ambiguity.
            if !chosen.iter().any(|c| c.concrete == candidate.concrete) {
                chosen.push(candidate);
            }
        }
        match chosen.as_slice() {
            [only] => Ok(Resolution {
                signature: only.signature,
                params: only.concrete.params.clone(),
                ret: only.concrete.ret,
            }),
            [] => Err(OverloadError::NoMatch),
            several => Err(OverloadError::Ambiguous(
                several.iter().map(|c| c.concrete.clone()).collect(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stdlib::registry;

    fn resolve(name: &str, args: &[ArgType]) -> Result<Resolution, OverloadError> {
        let intrinsic = registry().intrinsic(name);
        assert!(intrinsic.is_some(), "no intrinsic `{name}`");
        intrinsic.map_or(Err(OverloadError::NoMatch), |i| i.resolve(args))
    }

    fn concrete(ty: TypeRef) -> ArgType {
        ArgType::Concrete(ty)
    }

    #[test]
    fn class_signatures_instantiate_per_member() {
        let sin = registry().intrinsic("sin");
        let Some(sin) = sin else {
            panic!("sin is registered")
        };
        let all = sin.signatures[0].instantiations();
        assert_eq!(all.len(), 4);
        assert!(all.iter().all(|s| s.params == vec![s.ret]));
        let abs = registry().intrinsic("abs");
        let Some(abs) = abs else {
            panic!("abs is registered")
        };
        let count: usize = abs
            .signatures
            .iter()
            .map(|s| s.instantiations().len())
            .sum();
        assert_eq!(count, 6);
    }

    #[test]
    fn exact_signatures_have_one_instantiation() {
        let Some(cross) = registry().intrinsic("cross") else {
            panic!("cross is registered")
        };
        let all = cross.signatures[0].instantiations();
        assert_eq!(
            all,
            vec![ConcreteSignature {
                params: vec![TypeRef::Vec3, TypeRef::Vec3],
                ret: TypeRef::Vec3
            }]
        );
    }

    #[test]
    fn component_wise_functions_return_their_argument_type() {
        for ty in [TypeRef::F32, TypeRef::Vec2, TypeRef::Vec3, TypeRef::Vec4] {
            let r = resolve("sin", &[concrete(ty)]);
            assert_eq!(r.map(|r| r.ret), Ok(ty));
        }
        assert_eq!(
            resolve("sin", &[concrete(TypeRef::I32)]),
            Err(OverloadError::NoMatch)
        );
    }

    #[test]
    fn reductions_return_f32() {
        let r = resolve("dot", &[concrete(TypeRef::Vec3), concrete(TypeRef::Vec3)]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::F32));
        let r = resolve("length", &[concrete(TypeRef::Vec2)]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::F32));
        // `dot` is defined on vectors, not on scalars.
        assert_eq!(
            resolve("dot", &[concrete(TypeRef::F32), concrete(TypeRef::F32)]),
            Err(OverloadError::NoMatch)
        );
    }

    #[test]
    fn mismatched_class_members_do_not_match() {
        assert_eq!(
            resolve("min", &[concrete(TypeRef::Vec3), concrete(TypeRef::F32)]),
            Err(OverloadError::NoMatch)
        );
        assert_eq!(
            resolve("min", &[concrete(TypeRef::I32), concrete(TypeRef::U32)]),
            Err(OverloadError::NoMatch)
        );
    }

    #[test]
    fn integer_overloads_are_chosen_for_integer_arguments() {
        let r = resolve("abs", &[concrete(TypeRef::I32)]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::I32));
        let r = resolve("max", &[concrete(TypeRef::U32), concrete(TypeRef::U32)]);
        assert_eq!(r.map(|r| (r.signature, r.ret)), Ok((1, TypeRef::U32)));
    }

    #[test]
    fn mix_accepts_a_scalar_or_component_wise_weight() {
        let v = concrete(TypeRef::Vec3);
        let by_scalar = resolve("mix", &[v, v, concrete(TypeRef::F32)]);
        assert_eq!(by_scalar.as_ref().map(|r| r.signature), Ok(0));
        let by_vector = resolve("mix", &[v, v, v]);
        assert_eq!(by_vector.as_ref().map(|r| r.signature), Ok(1));
        // For scalars both overloads instantiate identically; that is one overload, not an
        // ambiguity.
        let f = concrete(TypeRef::F32);
        let scalars = resolve("mix", &[f, f, f]);
        assert_eq!(scalars.map(|r| r.ret), Ok(TypeRef::F32));
    }

    #[test]
    fn literals_prefer_their_default_type() {
        let int = ArgType::IntLiteral;
        let float = ArgType::FloatLiteral;
        let r = resolve("max", &[int, int]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::I32));
        let r = resolve("max", &[float, float]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::F32));
        // A float literal never adopts an integer type.
        let r = resolve("abs", &[float]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::F32));
    }

    #[test]
    fn literals_adopt_the_type_of_the_other_arguments() {
        let x = concrete(TypeRef::F32);
        let r = resolve("max", &[x, ArgType::IntLiteral]);
        assert_eq!(
            r.map(|r| (r.params, r.ret)),
            Ok((vec![TypeRef::F32; 2], TypeRef::F32))
        );
        let u = concrete(TypeRef::U32);
        let r = resolve("min", &[ArgType::IntLiteral, u]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::U32));
        // A scalar literal cannot stand for a vector component-wise.
        let v = concrete(TypeRef::Vec3);
        assert_eq!(
            resolve("max", &[v, ArgType::FloatLiteral]),
            Err(OverloadError::NoMatch)
        );
        // `mix(a, b, 0.5)` takes a scalar weight.
        let r = resolve("mix", &[v, v, ArgType::FloatLiteral]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::Vec3));
    }

    #[test]
    fn an_integer_literal_for_an_f32_parameter_is_accepted() {
        let f = concrete(TypeRef::F32);
        let r = resolve("mix", &[f, f, ArgType::IntLiteral]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::F32));
        let r = registry().resolve_namespace_call(
            "quat",
            "axis_angle",
            &[concrete(TypeRef::Vec3), ArgType::IntLiteral],
        );
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::Quat));
    }

    #[test]
    fn arity_and_unknown_names_are_rejected() {
        assert_eq!(resolve("sin", &[]), Err(OverloadError::NoMatch));
        assert_eq!(
            resolve("sin", &[concrete(TypeRef::F32), concrete(TypeRef::F32)]),
            Err(OverloadError::NoMatch)
        );
        assert_eq!(
            registry().resolve_call("sine", &[concrete(TypeRef::F32)]),
            Err(crate::stdlib::ResolveError::Unknown)
        );
        assert_eq!(
            registry().resolve_call("sin", &[concrete(TypeRef::Bool)]),
            Err(crate::stdlib::ResolveError::Overload(
                OverloadError::NoMatch
            ))
        );
    }

    #[test]
    fn zero_argument_functions_resolve() {
        let r = registry().resolve_call("random", &[]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::F32));
        let r = registry().resolve_namespace_call("quat", "identity", &[]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::Quat));
        let r = registry().resolve_namespace_call("frame", "time", &[]);
        assert_eq!(r, Err(crate::stdlib::ResolveError::Unknown));
    }

    #[test]
    fn enum_and_handle_arguments_resolve_exactly() {
        let r = registry().resolve_call("is_key_down", &[concrete(TypeRef::Enum("Key"))]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::Bool));
        let r = registry().resolve_call("alive", &[concrete(TypeRef::EntityRef)]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::Bool));
        let r = registry().resolve_call("destroy", &[concrete(TypeRef::EntityRef)]);
        assert_eq!(r.map(|r| r.ret), Ok(TypeRef::Unit));
    }

    #[test]
    fn a_genuine_ambiguity_is_reported() {
        // Two overloads that accept an integer literal equally well but return different
        // types must not be resolved silently.
        use crate::stdlib::model::{Domain, Milestone, ParamDef};
        let def = IntrinsicDef {
            name: "probe",
            signatures: vec![
                Signature {
                    params: vec![ParamDef {
                        name: "x",
                        ty: SigType::Exact(TypeRef::U32),
                    }],
                    ret: SigType::Exact(TypeRef::U32),
                },
                Signature {
                    params: vec![ParamDef {
                        name: "x",
                        ty: SigType::Exact(TypeRef::F32),
                    }],
                    ret: SigType::Exact(TypeRef::F32),
                },
            ],
            domain: Domain::Both,
            const_eligible: true,
            handlers_only: false,
            cpu_semantics: "",
            since: Milestone::M1,
            doc: "",
        };
        assert!(matches!(
            def.resolve(&[ArgType::IntLiteral]),
            Err(OverloadError::Ambiguous(found)) if found.len() == 2
        ));
    }
}
