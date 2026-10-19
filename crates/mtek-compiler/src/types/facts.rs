//! What the checker records about each function body for the program-wide
//! passes of [`super::effects`] (decision 0038): the calls it makes, the
//! loops whose bounds are not constant and the declarations whose types do
//! not exist on the GPU. The checker records them for every body, whatever
//! calls it; which of them are errors depends on the call graph of the whole
//! program, which only the program-wide pass knows.

use crate::resolve::DefId;
use crate::source::Span;
use crate::stdlib::Domain;

/// The facts of one body (a function now; a material stage function or a
/// handler when M2-04 and M3 check them with the same checker).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BodyFacts {
    /// Every call of a user function, every domain-restricted built-in call,
    /// and every ambient CPU read, in source order.
    pub calls: Vec<CallFact>,
    /// The `a..b` of every range loop whose bounds are not both constant
    /// expressions (`E4010` in GPU code).
    pub unbounded_loops: Vec<Span>,
    /// Every parameter, local, loop variable, block constant and result
    /// type whose type has no GPU representation (`E4011` in GPU code).
    pub cpu_only: Vec<CpuOnlySite>,
}

/// One call in a body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CallFact {
    /// The whole call expression.
    pub span: Span,
    pub callee: Callee,
}

/// What a call calls.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Callee {
    /// A user function: a `fn` item of this module, or an imported name
    /// that denotes one ([`crate::resolve::Resolution::import_target`]).
    Function(DefId),
    /// A built-in function of the registry.
    Builtin(BuiltinCall),
    /// A read of ambient CPU state (`frame.*` or a body property), which is
    /// an effect even though it has no call syntax.
    Read(AmbientRead),
}

/// An ambient CPU read tracked alongside calls so its effect travels over
/// the same whole-program call graph.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AmbientRead {
    pub name: String,
    /// Body properties do not exist until after initialisation. Frame values
    /// may be read in a CPU initialiser.
    pub forbidden_in_initialiser: bool,
}

/// A call of a built-in function that matters to effects or domains.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuiltinCall {
    /// As written in diagnostics: `random`, `lighting.pbr`.
    pub name: String,
    pub domain: Domain,
    /// Only lifecycle functions and handlers may call it (`spawn`,
    /// `destroy`).
    pub handlers_only: bool,
}

/// A declaration whose type has no GPU representation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CpuOnlySite {
    /// The type annotation, or the name when the type is inferred.
    pub span: Span,
    /// What is declared, for messages: "the parameter 'label'".
    pub what: String,
    /// The type, as Mtek spells it.
    pub ty: String,
    /// The initialiser of a local, when the declaration has one: a call of a CPU-only built-in
    /// function there is reported as `E4012`, and the local's type is only its consequence.
    pub value: Option<Span>,
}
