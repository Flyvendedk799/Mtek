//! Types and constant evaluation (`spec/compiler-architecture.md` section
//! 4.7, `spec/language.md` sections 5, 6 and 8.1).
//!
//! - [`ty`]: the type catalogue ([`Ty`]) and the [`TyInterner`];
//! - [`value`]: constant values ([`ConstValue`]) and the exact operations on
//!   them.

pub mod ty;
pub mod value;

pub use ty::{Ty, TyId, TyInterner};
pub use value::{ArithOp, ConstValue, EvalError, EvalResult, Scalar};
