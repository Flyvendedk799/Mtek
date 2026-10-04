//! Types and constant evaluation (`spec/compiler-architecture.md` section
//! 4.7, `spec/language.md` sections 5, 6 and 8.1).
//!
//! - [`ty`]: the type catalogue ([`Ty`]) and the [`TyInterner`].

pub mod ty;

pub use ty::{Ty, TyId, TyInterner};
