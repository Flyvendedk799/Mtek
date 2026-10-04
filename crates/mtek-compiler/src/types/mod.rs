//! Types and constant evaluation (`spec/compiler-architecture.md` section
//! 4.7, `spec/language.md` sections 5, 6 and 8.1, decision 0026).
//!
//! [`check_module`] types every expression of the constructs this build
//! implements and folds every constant expression. It reports to the
//! [`Diagnostics`] sink:
//!
//! * `E3001` a type mismatch: a constant's value against its declared type, a
//!   constructor or function argument against its parameter, a name that is
//!   not a value, a call of something that is not a function;
//! * `E3002` the wrong number of arguments; `E3003` type arguments on a type
//!   that takes none (unknown type names are the resolver's `E3003`);
//! * `E3010` arithmetic on `color`, `E3011` negation of `u32`, `E3014` an
//!   operator without a row for its operand types;
//! * `E3013` an invalid component or swizzle; `E5001` a field a named entity
//!   or camera does not have;
//! * `E3041` a literal not representable in the type its context requires;
//! * `W3050` a conversion to the type the value already has;
//! * `E3040` overflow, division by zero or a non-finite `f32` while folding;
//! * `E2020` a constant that depends on itself; `E3090` a constant whose
//!   value is not a constant expression.
//!
//! Modules:
//!
//! - [`ty`]: the type catalogue ([`Ty`]) and the [`TyInterner`];
//! - [`value`]: constant values ([`ConstValue`]) and the exact operations on
//!   them;
//! - `ops`: the operator typing table;
//! - `check`: the checker; `consteval`: folding and constant declarations.

mod check;
mod consteval;
mod ops;
#[cfg(test)]
mod tests;
pub mod ty;
pub mod value;

use std::collections::BTreeMap;

pub use ty::{Ty, TyId, TyInterner};
pub use value::{ArithOp, ConstValue, EvalError, EvalResult, Scalar};

use crate::diagnostics::Diagnostics;
use crate::resolve::{DefId, Resolution};
use crate::source::Span;
use crate::syntax::ast::{Module, NodeId};

/// The type and value of one constant declaration.
#[derive(Clone, Debug, PartialEq)]
pub struct ConstInfo {
    /// The declared type, or the type of the value when none is declared;
    /// `Error` if it could not be typed.
    pub ty: TyId,
    /// The value, unless the constant has an error.
    pub value: Option<ConstValue>,
}

/// Why an expression is not a constant expression: the first non-constant
/// form in it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NonConstant {
    /// The non-constant form (a call, a field read, a name).
    pub span: Span,
    /// A clause for a diagnostic: "it calls the function 'f', …".
    pub reason: String,
}

/// What type checking and constant evaluation produced for one module.
#[derive(Clone, Debug)]
pub struct Typeck {
    interner: TyInterner,
    types: Vec<Option<TyId>>,
    values: Vec<Option<ConstValue>>,
    non_constant: BTreeMap<NodeId, NonConstant>,
    consts: BTreeMap<DefId, ConstInfo>,
}

impl Typeck {
    fn new(node_count: u32) -> Self {
        let slots = node_count as usize;
        Self {
            interner: TyInterner::new(),
            types: vec![None; slots],
            values: vec![None; slots],
            non_constant: BTreeMap::new(),
            consts: BTreeMap::new(),
        }
    }

    /// The types of this module.
    #[must_use]
    pub fn interner(&self) -> &TyInterner {
        &self.interner
    }

    /// The type of the expression `node`, if the checker typed it.
    #[must_use]
    pub fn ty(&self, node: NodeId) -> Option<TyId> {
        self.types.get(node.index()).copied().flatten()
    }

    /// The folded value of the expression `node`, if it is a constant
    /// expression without errors.
    #[must_use]
    pub fn value(&self, node: NodeId) -> Option<&ConstValue> {
        self.values.get(node.index()).and_then(Option::as_ref)
    }

    /// Why the field value `node` (the root of a scene, entity or camera field
    /// value) is not a constant expression, if it is not.
    #[must_use]
    pub fn non_constant(&self, node: NodeId) -> Option<&NonConstant> {
        self.non_constant.get(&node)
    }

    /// The type and value of the constant declared as `def`.
    #[must_use]
    pub fn const_info(&self, def: DefId) -> Option<&ConstInfo> {
        self.consts.get(&def)
    }

    /// The Mtek spelling of `ty`.
    #[must_use]
    pub fn display(&self, ty: TyId) -> String {
        self.interner.display(ty)
    }
}

/// Type-check `module` (whose source text is `text`) and fold its constant
/// expressions, reporting to `sink`. Names were resolved into `resolution`;
/// names the resolver could not resolve (`Res::Error`) are not reported
/// again. Never panics.
#[must_use]
pub fn check_module(
    module: &Module,
    text: &str,
    resolution: &Resolution,
    sink: &mut Diagnostics,
) -> Typeck {
    let mut checker = check::Checker::new(module, text, resolution, sink);
    checker.module(module);
    checker.finish()
}
