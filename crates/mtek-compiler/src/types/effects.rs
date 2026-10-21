//! Effects, recursion and GPU reachability over the whole program
//! (`spec/language.md` sections 8.2–8.4, `spec/compiler-architecture.md`
//! section 4.7, decision 0038).
//!
//! The checker records [`BodyFacts`] for every function body of every
//! module. [`check_program`] joins them into one call graph — imported
//! functions are the declarations in their own modules — and reports:
//!
//! * `E4001` for every cycle of calls (one per strongly connected component,
//!   at its first function, with every call of the cycle as a related span);
//! * `E4002` for every call in a `fn` that needs the CPU: a call of a
//!   `cpu fn`, of a CPU-only built-in function, or of a `fn` that needs the
//!   CPU itself — at the call, with the complete call chain down to the
//!   CPU-only operation as related spans;
//! * `W4003` for a `cpu fn` that needs no CPU effect;
//! * `E5080` for a call of a handler-only built-in function (`spawn`,
//!   `destroy`) in any function and in an initialiser of state or of a field
//!   (decision 0064);
//! * for the bodies reachable from the GPU roots through `fn`s: `E4010` for a
//!   range loop without constant bounds, `E4011` for a declaration of a
//!   CPU-only type, `E4012` for a call of a CPU-only built-in function (in
//!   place of `E4002`, which would report the same call);
//! * for the bodies reachable from CPU code (every `cpu fn`, and the CPU root
//!   bodies): `E4013` for a call of a GPU-only built-in function.
//!
//! The GPU roots are the material stage functions; M2-04 supplies them as
//! [`RootBody`]s ([`Roots::gpu_bodies`]). Until then [`Roots::gpu_functions`]
//! names functions to treat as called from a stage, which is how the rules
//! are tested in this build. Every traversal uses explicit worklists, so a
//! chain of fifty thousand calls needs no deeper stack than one call.
//!
//! A chain in related spans is cut after [`MAX_CHAIN_STEPS`] steps (with a
//! note saying how many follow), and at most
//! [`MAX_DIAGNOSTICS_PER_FILE`] of these diagnostics are built per file —
//! exactly those the sink would keep — so that pathological programs stay
//! linear.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use super::Typeck;
use super::facts::{AmbientRead, BodyFacts, Callee};
use crate::diagnostics::{Code, Diagnostic, Diagnostics, MAX_DIAGNOSTICS_PER_FILE};
use crate::project::ModuleId;
use crate::resolve::{DefId, DefKind, Resolution};
use crate::source::{FileId, Span};
use crate::stdlib::Domain;

/// The most steps of a call chain listed as related spans.
pub const MAX_CHAIN_STEPS: usize = 256;

/// The most names of a chain written into a message.
const MAX_PATH_NAMES: usize = 32;

/// A user function of the program: its module and its declaration there.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FnRef {
    pub module: ModuleId,
    pub def: DefId,
}

/// The effect level of a function (section 8.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EffectLevel {
    /// `fn`: computes on its parameters, locals and constants only.
    Pure,
    /// `cpu fn`: may also call `cpu fn`s and CPU-only built-in functions.
    Cpu,
}

impl EffectLevel {
    /// `pure` or `cpu`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            EffectLevel::Pure => "pure",
            EffectLevel::Cpu => "cpu",
        }
    }
}

/// What the program-wide pass found out about one function.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FnEffect {
    /// The declared level; in a program without errors the body agrees.
    pub level: EffectLevel,
    /// A GPU root reaches it through `fn`s: it is compiled to WGSL.
    pub gpu_reachable: bool,
    /// CPU code (a `cpu fn`, a CPU root) reaches it: it is compiled for the
    /// CPU.
    pub cpu_reachable: bool,
}

/// The effects of every function of a program.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProgramEffects {
    functions: BTreeMap<FnRef, FnEffect>,
}

impl ProgramEffects {
    /// The effects of `function`.
    #[must_use]
    pub fn get(&self, function: FnRef) -> Option<FnEffect> {
        self.functions.get(&function).copied()
    }

    /// Every function with its effects, in module and declaration order.
    pub fn iter(&self) -> impl Iterator<Item = (FnRef, FnEffect)> + '_ {
        self.functions.iter().map(|(f, e)| (*f, *e))
    }
}

/// A body that is not a user function but roots a domain: a material stage
/// function (GPU, M2-04) or a lifecycle function or handler (CPU, M3).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RootBody {
    /// The module the body is written in.
    pub module: ModuleId,
    /// How diagnostics name it: "the fragment stage of material 'Pulse'".
    pub label: String,
    /// The span diagnostics point at for it (the stage's name).
    pub span: Span,
    pub facts: BodyFacts,
    /// An initialiser (of a `state`, or of a field of a prefab): it runs when its owner is
    /// created, so the handler-only built-ins `spawn` and `destroy` are `E5080` in it (decision 0064).
    pub initialiser: bool,
}

/// Where the domains start.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Roots {
    /// Bodies compiled to WGSL (material stage functions, M2-04).
    pub gpu_bodies: Vec<RootBody>,
    /// Functions to treat as called from a stage function. M2-04's stages
    /// replace this; until then it is the test hook of decision 0038.
    pub gpu_functions: Vec<FnRef>,
    /// Bodies run on the CPU besides `cpu fn`s (lifecycle functions and
    /// handlers, M3).
    pub cpu_bodies: Vec<RootBody>,
}

/// One checked module, as the program-wide pass sees it.
#[derive(Clone, Copy)]
pub struct ProgramUnit<'a> {
    pub id: ModuleId,
    pub resolution: &'a Resolution,
    pub types: &'a Typeck,
}

/// What a node of the graph is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Function { cpu: bool },
    GpuRoot,
    CpuRoot,
}

/// A body of the call graph: a user function or a root body.
struct Node<'a> {
    kind: Kind,
    /// The module the body is written in.
    module: ModuleId,
    /// The function, for function nodes.
    function: Option<FnRef>,
    /// The function's name or the root's label.
    name: String,
    /// The function's name or the root's span.
    span: Span,
    facts: &'a BodyFacts,
    /// A root body that is an initialiser ([`RootBody::initialiser`]).
    initialiser: bool,
    /// For each call of `facts.calls`, the function node it calls (if it
    /// calls a user function the program has).
    targets: Vec<Option<usize>>,
}

impl Node<'_> {
    fn is_pure_fn(&self) -> bool {
        self.kind == Kind::Function { cpu: false }
    }

    fn is_cpu_fn(&self) -> bool {
        self.kind == Kind::Function { cpu: true }
    }

    /// How messages name the body.
    fn subject(&self) -> String {
        match self.kind {
            Kind::Function { .. } => format!("the function '{}'", self.name),
            Kind::GpuRoot | Kind::CpuRoot => self.name.clone(),
        }
    }
}

/// What a call reaches, for effects.
enum Reached<'n> {
    /// A `cpu fn`.
    CpuFn(usize),
    /// A `fn` (that may need the CPU itself).
    PureFn(usize),
    /// A built-in function.
    Builtin {
        name: &'n str,
        domain: Domain,
        handlers_only: bool,
    },
    /// A read of ambient CPU state, rather than a function call.
    Read(&'n AmbientRead),
    /// A function the program does not have (reported elsewhere).
    Nothing,
}

/// A diagnostic to build, once it is known to be one the sink keeps.
enum Pending {
    Recursion { start: usize, steps: Vec<Step> },
    Impure { node: usize, call: usize },
    HandlerOnly { node: usize, call: usize },
    CouldBePure { node: usize },
    UnboundedLoop { node: usize, index: usize },
    WhileLoop { node: usize, index: usize },
    CpuOnlyType { node: usize, index: usize },
    CpuOnlyBuiltin { node: usize, call: usize },
    GpuOnlyBuiltin { node: usize, call: usize },
    CpuOnlyRead { node: usize, call: usize },
    InitialiserRead { node: usize, call: usize },
}

/// One call of a chain: `from` calls `to` at `span`.
#[derive(Clone, Copy, Debug)]
struct Step {
    from: usize,
    to: usize,
    span: Span,
}

/// The note of `E5080` for the handler-only built-in `name`.
fn handler_only_note(name: &str) -> &'static str {
    match name {
        "spawn" | "destroy" => {
            "spawning and destroying entities are lifecycle operations of the scene"
        }
        "after" | "every" => {
            "a timer belongs to the scene or entity whose handler starts it (decision 0142)"
        }
        "go_to" | "reset" => {
            "changing or restarting the scene is a lifecycle operation of the scene"
        }
        "pause" | "resume" => "pausing the game is a lifecycle operation of the scene",
        "save" | "load" | "clear_saved" => {
            "saved data is read and written by the scene's handlers (decision 0145)"
        }
        _ => "this operation is a lifecycle operation of the scene",
    }
}

/// Check effects, recursion and reachability over every function of the
/// program (the modules in load order), reporting to `sink`. Never panics.
#[must_use]
pub fn check_program(
    units: &[ProgramUnit<'_>],
    roots: &Roots,
    sink: &mut Diagnostics,
) -> ProgramEffects {
    let graph = Graph::new(units, roots);
    let mut pending: Vec<(Span, Code, Pending)> = Vec::new();
    graph.recursion(&mut pending);
    let dist = graph.cpu_distances();
    let gpu = graph.reach(&graph.gpu_roots(roots), false);
    let cpu = graph.reach(&graph.cpu_roots(), true);
    let initialisers = graph.reach(&graph.initialiser_roots(), true);
    graph.effects(&dist, &gpu, &mut pending);
    graph.gpu_rules(&gpu, &mut pending);
    graph.cpu_rules(&cpu, &mut pending);
    graph.initialiser_rules(&initialisers, &mut pending);
    graph.report(pending, &dist, &gpu, &cpu, &initialisers, sink);

    let mut functions = BTreeMap::new();
    for (index, node) in graph.nodes.iter().enumerate() {
        if let (Some(function), Kind::Function { cpu: is_cpu }) = (node.function, node.kind) {
            functions.insert(
                function,
                FnEffect {
                    level: if is_cpu {
                        EffectLevel::Cpu
                    } else {
                        EffectLevel::Pure
                    },
                    gpu_reachable: gpu.get(index).is_some_and(Option::is_some),
                    cpu_reachable: cpu.get(index).is_some_and(Option::is_some),
                },
            );
        }
    }
    ProgramEffects { functions }
}

struct Graph<'a> {
    nodes: Vec<Node<'a>>,
    /// The node of each function.
    index: BTreeMap<FnRef, usize>,
}

impl<'a> Graph<'a> {
    fn new(units: &[ProgramUnit<'a>], roots: &'a Roots) -> Self {
        let mut nodes = Vec::new();
        let mut index = BTreeMap::new();
        for unit in units {
            for (def, info) in unit.types.functions() {
                let function = FnRef {
                    module: unit.id,
                    def,
                };
                index.insert(function, nodes.len());
                nodes.push(Node {
                    kind: Kind::Function { cpu: info.sig.cpu },
                    module: unit.id,
                    function: Some(function),
                    name: info.name.clone(),
                    span: info.name_span,
                    facts: &info.facts,
                    initialiser: false,
                    targets: Vec::new(),
                });
            }
        }
        let root_nodes = roots
            .gpu_bodies
            .iter()
            .map(|r| (Kind::GpuRoot, r))
            .chain(roots.cpu_bodies.iter().map(|r| (Kind::CpuRoot, r)));
        for (kind, root) in root_nodes {
            nodes.push(Node {
                kind,
                module: root.module,
                function: None,
                name: root.label.clone(),
                span: root.span,
                facts: &root.facts,
                initialiser: root.initialiser,
                targets: Vec::new(),
            });
        }
        let units_by_id: BTreeMap<ModuleId, &ProgramUnit<'a>> =
            units.iter().map(|u| (u.id, u)).collect();
        for node in &mut nodes {
            let unit = units_by_id.get(&node.module).copied();
            node.targets = node
                .facts
                .calls
                .iter()
                .map(|call| match (&call.callee, unit) {
                    (Callee::Function(def), Some(unit)) => {
                        resolve_function(unit, &units_by_id, *def)
                            .and_then(|f| index.get(&f).copied())
                    }
                    _ => None,
                })
                .collect();
        }
        Graph { nodes, index }
    }

    fn node(&self, index: usize) -> Option<&Node<'a>> {
        self.nodes.get(index)
    }

    fn name(&self, index: usize) -> &str {
        self.node(index).map_or("", |n| n.name.as_str())
    }

    /// What call `call` of node `node` reaches.
    fn reached(&self, node: usize, call: usize) -> Reached<'_> {
        let Some(n) = self.node(node) else {
            return Reached::Nothing;
        };
        let Some(fact) = n.facts.calls.get(call) else {
            return Reached::Nothing;
        };
        match &fact.callee {
            Callee::Read(read) => Reached::Read(read),
            Callee::Builtin(builtin) => Reached::Builtin {
                name: &builtin.name,
                domain: builtin.domain,
                handlers_only: builtin.handlers_only,
            },
            Callee::Function(_) => match n.targets.get(call).copied().flatten() {
                Some(target) if self.node(target).is_some_and(Node::is_cpu_fn) => {
                    Reached::CpuFn(target)
                }
                Some(target) => Reached::PureFn(target),
                None => Reached::Nothing,
            },
        }
    }

    /// The calls of node `node` to function nodes, in source order:
    /// `(call index, target)`.
    fn edges(&self, node: usize) -> impl Iterator<Item = (usize, usize)> + '_ {
        self.node(node)
            .into_iter()
            .flat_map(|n| n.targets.iter().enumerate())
            .filter_map(|(call, target)| target.map(|t| (call, t)))
    }

    fn call_span(&self, node: usize, call: usize) -> Option<Span> {
        self.node(node)
            .and_then(|n| n.facts.calls.get(call))
            .map(|c| c.span)
    }

    // ----- recursion -------------------------------------------------------

    /// `E4001` for every strongly connected component of functions with a
    /// cycle (Tarjan's algorithm with an explicit stack).
    fn recursion(&self, pending: &mut Vec<(Span, Code, Pending)>) {
        let count = self.nodes.len();
        let mut order: Vec<Option<usize>> = vec![None; count];
        let mut low: Vec<usize> = vec![0; count];
        let mut on_stack = vec![false; count];
        let mut stack: Vec<usize> = Vec::new();
        let mut next_order = 0;
        let mut components: Vec<Vec<usize>> = Vec::new();
        for start in 0..count {
            if order.get(start).copied().flatten().is_some() {
                continue;
            }
            // (node, its edges, the next edge to follow)
            let mut work: Vec<(usize, Vec<usize>, usize)> = Vec::new();
            let visit = |v: usize,
                         order: &mut Vec<Option<usize>>,
                         low: &mut Vec<usize>,
                         on_stack: &mut Vec<bool>,
                         stack: &mut Vec<usize>,
                         next_order: &mut usize,
                         work: &mut Vec<(usize, Vec<usize>, usize)>| {
                if let Some(slot) = order.get_mut(v) {
                    *slot = Some(*next_order);
                }
                if let Some(slot) = low.get_mut(v) {
                    *slot = *next_order;
                }
                *next_order += 1;
                stack.push(v);
                if let Some(slot) = on_stack.get_mut(v) {
                    *slot = true;
                }
                let targets: Vec<usize> = self.edges(v).map(|(_, t)| t).collect();
                work.push((v, targets, 0));
            };
            visit(
                start,
                &mut order,
                &mut low,
                &mut on_stack,
                &mut stack,
                &mut next_order,
                &mut work,
            );
            while let Some((v, targets, next)) = work.last_mut() {
                let v = *v;
                if let Some(&w) = targets.get(*next) {
                    *next += 1;
                    match order.get(w).copied().flatten() {
                        None => visit(
                            w,
                            &mut order,
                            &mut low,
                            &mut on_stack,
                            &mut stack,
                            &mut next_order,
                            &mut work,
                        ),
                        Some(w_order) if on_stack.get(w).copied().unwrap_or(false) => {
                            if let Some(slot) = low.get_mut(v) {
                                *slot = (*slot).min(w_order);
                            }
                        }
                        Some(_) => {}
                    }
                    continue;
                }
                work.pop();
                let v_low = low.get(v).copied().unwrap_or(0);
                if let Some((parent, _, _)) = work.last()
                    && let Some(slot) = low.get_mut(*parent)
                {
                    *slot = (*slot).min(v_low);
                }
                if Some(v_low) == order.get(v).copied().flatten() {
                    let mut component = Vec::new();
                    while let Some(w) = stack.pop() {
                        if let Some(slot) = on_stack.get_mut(w) {
                            *slot = false;
                        }
                        component.push(w);
                        if w == v {
                            break;
                        }
                    }
                    components.push(component);
                }
            }
        }
        for component in components {
            let members: BTreeSet<usize> = component.iter().copied().collect();
            let Some(&start) = members.iter().next() else {
                continue;
            };
            let cyclic = members.len() > 1 || self.edges(start).any(|(_, t)| t == start);
            if !cyclic {
                continue;
            }
            if let Some(steps) = self.shortest_cycle(start, &members) {
                let span = self.node(start).map_or(Span::at(FileId(0), 0), |n| n.span);
                pending.push((span, Code::E4001, Pending::Recursion { start, steps }));
            }
        }
    }

    /// The shortest cycle from `start` back to it inside `members` (a
    /// breadth-first search; ties in source order).
    fn shortest_cycle(&self, start: usize, members: &BTreeSet<usize>) -> Option<Vec<Step>> {
        let mut parent: BTreeMap<usize, Step> = BTreeMap::new();
        let mut queue = VecDeque::from([start]);
        let mut seen = BTreeSet::from([start]);
        while let Some(v) = queue.pop_front() {
            for (call, w) in self.edges(v) {
                if !members.contains(&w) {
                    continue;
                }
                let span = self.call_span(v, call)?;
                let step = Step {
                    from: v,
                    to: w,
                    span,
                };
                if w == start {
                    let mut steps = vec![step];
                    let mut current = v;
                    while current != start {
                        let back = *parent.get(&current)?;
                        steps.push(back);
                        current = back.from;
                    }
                    steps.reverse();
                    return Some(steps);
                }
                if seen.insert(w) {
                    parent.insert(w, step);
                    queue.push_back(w);
                }
            }
        }
        None
    }

    // ----- effects ---------------------------------------------------------

    /// For every `fn` that needs the CPU, the length of its shortest chain to
    /// a CPU-only operation and the call that starts it (a breadth-first
    /// search backwards from the `fn`s that call one directly).
    fn cpu_distances(&self) -> Vec<Option<(usize, usize)>> {
        let count = self.nodes.len();
        let mut dist: Vec<Option<(usize, usize)>> = vec![None; count];
        let mut callers: Vec<Vec<(usize, usize)>> = vec![Vec::new(); count];
        let mut queue = VecDeque::new();
        for (index, node) in self.nodes.iter().enumerate() {
            if !node.is_pure_fn() {
                continue;
            }
            let mut direct = None;
            for call in 0..node.facts.calls.len() {
                match self.reached(index, call) {
                    Reached::CpuFn(_)
                    | Reached::Read(_)
                    | Reached::Builtin {
                        domain: Domain::Cpu,
                        ..
                    } => {
                        direct = direct.or(Some(call));
                    }
                    Reached::PureFn(target) => {
                        if let Some(list) = callers.get_mut(target) {
                            list.push((index, call));
                        }
                    }
                    _ => {}
                }
            }
            if let (Some(call), Some(slot)) = (direct, dist.get_mut(index)) {
                *slot = Some((1, call));
                queue.push_back(index);
            }
        }
        while let Some(n) = queue.pop_front() {
            let Some((d, _)) = dist.get(n).copied().flatten() else {
                continue;
            };
            let list = callers.get(n).cloned().unwrap_or_default();
            for (caller, call) in list {
                if let Some(slot) = dist.get_mut(caller)
                    && slot.is_none()
                {
                    *slot = Some((d + 1, call));
                    queue.push_back(caller);
                }
            }
        }
        dist
    }

    /// `E4002` at every call in a `fn` that needs the CPU, `E5080` at every
    /// call of a handler-only built-in function, `W4003` for every `cpu fn`
    /// that needs no CPU effect.
    fn effects(
        &self,
        dist: &[Option<(usize, usize)>],
        gpu: &[Reach],
        pending: &mut Vec<(Span, Code, Pending)>,
    ) {
        for (index, node) in self.nodes.iter().enumerate() {
            let is_function = matches!(node.kind, Kind::Function { .. });
            let mut needs_cpu = false;
            for (call, fact) in node.facts.calls.iter().enumerate() {
                let reached = self.reached(index, call);
                let (offends, builtin_cpu) = match reached {
                    Reached::Builtin {
                        handlers_only: true,
                        ..
                    } => {
                        needs_cpu = true;
                        if is_function || node.initialiser {
                            pending.push((
                                fact.span,
                                Code::E5080,
                                Pending::HandlerOnly { node: index, call },
                            ));
                        }
                        continue;
                    }
                    Reached::Builtin {
                        domain: Domain::Cpu,
                        ..
                    } => (true, true),
                    Reached::Read(_) => (true, true),
                    Reached::CpuFn(_) => (true, false),
                    Reached::PureFn(target) => {
                        (dist.get(target).copied().flatten().is_some(), false)
                    }
                    _ => (false, false),
                };
                needs_cpu |= offends;
                if !offends || !node.is_pure_fn() {
                    continue;
                }
                // In GPU code the CPU-only built-in is `E4012` instead.
                let in_gpu_code = gpu.get(index).is_some_and(Option::is_some);
                if builtin_cpu && in_gpu_code {
                    continue;
                }
                pending.push((
                    fact.span,
                    Code::E4002,
                    Pending::Impure { node: index, call },
                ));
            }
            if node.is_cpu_fn() && !needs_cpu {
                pending.push((node.span, Code::W4003, Pending::CouldBePure { node: index }));
            }
        }
    }

    // ----- reachability ----------------------------------------------------

    fn gpu_roots(&self, roots: &Roots) -> Vec<usize> {
        let mut out: Vec<usize> = self
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.kind == Kind::GpuRoot)
            .map(|(i, _)| i)
            .collect();
        out.extend(
            roots
                .gpu_functions
                .iter()
                .filter_map(|f| self.index.get(f).copied())
                .filter(|i| self.node(*i).is_some_and(Node::is_pure_fn)),
        );
        out
    }

    fn cpu_roots(&self) -> Vec<usize> {
        self.nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.is_cpu_fn() || n.kind == Kind::CpuRoot)
            .map(|(i, _)| i)
            .collect()
    }

    fn initialiser_roots(&self) -> Vec<usize> {
        self.nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| node.initialiser)
            .map(|(index, _)| index)
            .collect()
    }

    /// A breadth-first search from `roots`: for each node reached, how. GPU
    /// code reaches only `fn`s (a call of a `cpu fn` is already `E4002` or,
    /// from a stage, `E4040`); CPU code reaches every function.
    fn reach(&self, roots: &[usize], into_cpu_fns: bool) -> Vec<Reach> {
        let mut reached: Vec<Reach> = vec![None; self.nodes.len()];
        let mut queue = VecDeque::new();
        for &root in roots {
            if let Some(slot) = reached.get_mut(root)
                && slot.is_none()
            {
                *slot = Some(None);
                queue.push_back(root);
            }
        }
        while let Some(v) = queue.pop_front() {
            for (call, w) in self.edges(v) {
                let Some(node) = self.node(w) else { continue };
                if !into_cpu_fns && !node.is_pure_fn() {
                    continue;
                }
                let Some(span) = self.call_span(v, call) else {
                    continue;
                };
                if let Some(slot) = reached.get_mut(w)
                    && slot.is_none()
                {
                    *slot = Some(Some(Step {
                        from: v,
                        to: w,
                        span,
                    }));
                    queue.push_back(w);
                }
            }
        }
        reached
    }

    /// `E4010`, `E4011` and `E4012` in every body GPU roots reach.
    fn gpu_rules(&self, gpu: &[Reach], pending: &mut Vec<(Span, Code, Pending)>) {
        for (index, node) in self.nodes.iter().enumerate() {
            if gpu.get(index).is_none_or(Option::is_none) {
                continue;
            }
            for (i, span) in node.facts.unbounded_loops.iter().enumerate() {
                pending.push((
                    *span,
                    Code::E4010,
                    Pending::UnboundedLoop {
                        node: index,
                        index: i,
                    },
                ));
            }
            for (i, span) in node.facts.while_loops.iter().enumerate() {
                pending.push((
                    *span,
                    Code::E4010,
                    Pending::WhileLoop {
                        node: index,
                        index: i,
                    },
                ));
            }
            for (i, site) in node.facts.cpu_only.iter().enumerate() {
                // `let t = texture.white();`: the call is `E4012` and the local only repeats it.
                let from_cpu_call = site.value.is_some_and(|value| {
                    node.facts.calls.iter().enumerate().any(|(call, fact)| {
                        fact.span == value
                            && matches!(
                                self.reached(index, call),
                                Reached::Builtin {
                                    domain: Domain::Cpu,
                                    handlers_only: false,
                                    ..
                                }
                            )
                    })
                });
                if from_cpu_call {
                    continue;
                }
                pending.push((
                    site.span,
                    Code::E4011,
                    Pending::CpuOnlyType {
                        node: index,
                        index: i,
                    },
                ));
            }
            for (call, fact) in node.facts.calls.iter().enumerate() {
                if matches!(self.reached(index, call), Reached::Read(_)) {
                    pending.push((
                        fact.span,
                        Code::E4040,
                        Pending::CpuOnlyRead { node: index, call },
                    ));
                }
                if let Reached::Builtin {
                    domain: Domain::Cpu,
                    handlers_only: false,
                    ..
                } = self.reached(index, call)
                {
                    pending.push((
                        fact.span,
                        Code::E4012,
                        Pending::CpuOnlyBuiltin { node: index, call },
                    ));
                }
            }
        }
    }

    /// `E4013` in every body CPU code reaches.
    fn cpu_rules(&self, cpu: &[Reach], pending: &mut Vec<(Span, Code, Pending)>) {
        for (index, node) in self.nodes.iter().enumerate() {
            if cpu.get(index).is_none_or(Option::is_none) {
                continue;
            }
            for (call, fact) in node.facts.calls.iter().enumerate() {
                if let Reached::Builtin {
                    domain: Domain::Gpu,
                    ..
                } = self.reached(index, call)
                {
                    pending.push((
                        fact.span,
                        Code::E4013,
                        Pending::GpuOnlyBuiltin { node: index, call },
                    ));
                }
            }
        }
    }

    /// Body properties remain unavailable during initialisation even when
    /// one or more CPU helpers hide the read from the local scene checker.
    fn initialiser_rules(&self, initialisers: &[Reach], pending: &mut Vec<(Span, Code, Pending)>) {
        for (index, node) in self.nodes.iter().enumerate() {
            if initialisers.get(index).is_none_or(Option::is_none) {
                continue;
            }
            for (call, fact) in node.facts.calls.iter().enumerate() {
                if matches!(self.reached(index, call), Reached::Read(read) if read.forbidden_in_initialiser)
                {
                    pending.push((
                        fact.span,
                        Code::E5081,
                        Pending::InitialiserRead { node: index, call },
                    ));
                }
            }
        }
    }

    /// The chain of calls by which a traversal reached `node`, from its root
    /// down (at most [`MAX_CHAIN_STEPS`] steps, the ones nearest the root
    /// first), the root, and how many steps were left out.
    fn chain_to(&self, reached: &[Reach], node: usize) -> (Vec<Step>, usize, usize) {
        let mut steps = Vec::new();
        let mut current = node;
        // Parents form a tree (each node is reached once), so this ends.
        while let Some(Some(Some(step))) = reached.get(current).copied() {
            steps.push(step);
            current = step.from;
            if steps.len() > self.nodes.len() {
                break;
            }
        }
        steps.reverse();
        let omitted = steps.len().saturating_sub(MAX_CHAIN_STEPS);
        steps.truncate(MAX_CHAIN_STEPS);
        (steps, current, omitted)
    }

    // ----- building the diagnostics ----------------------------------------

    /// Build the pending diagnostics the sink would keep (the first
    /// [`MAX_DIAGNOSTICS_PER_FILE`] per file in report order) and account
    /// for the others as suppressed.
    fn report(
        &self,
        mut pending: Vec<(Span, Code, Pending)>,
        dist: &[Option<(usize, usize)>],
        gpu: &[Reach],
        cpu: &[Reach],
        initialisers: &[Reach],
        sink: &mut Diagnostics,
    ) {
        pending.sort_by_key(|(span, code, _)| (span.file, span.start, span.end, *code));
        let mut per_file: BTreeMap<FileId, (usize, usize, usize)> = BTreeMap::new();
        for (span, code, item) in pending {
            let entry = per_file.entry(span.file).or_insert((0, 0, 0));
            if entry.0 >= MAX_DIAGNOSTICS_PER_FILE {
                entry.1 += 1;
                if code.severity() == crate::diagnostics::Severity::Error {
                    entry.2 += 1;
                }
                continue;
            }
            entry.0 += 1;
            if let Some(diagnostic) = self.build(item, dist, gpu, cpu, initialisers) {
                sink.push(diagnostic);
            }
        }
        for (file, (_, dropped, errors)) in per_file {
            sink.record_suppressed(file, dropped, errors);
        }
    }

    fn build(
        &self,
        item: Pending,
        dist: &[Option<(usize, usize)>],
        gpu: &[Reach],
        cpu: &[Reach],
        initialisers: &[Reach],
    ) -> Option<Diagnostic> {
        Some(match item {
            Pending::CpuOnlyRead { node, call } => {
                let n = self.node(node)?;
                let Reached::Read(read) = self.reached(node, call) else {
                    return None;
                };
                let diagnostic = Diagnostic::new(
                    Code::E4040,
                    format!("{} cannot read `{}` because it runs on the GPU.", capitalise(&n.subject()), read.name),
                )
                .at(self.call_span(node, call)?)
                .help("read the value on the CPU and pass it explicitly; a material receives it through a param set with `bind(...)`");
                self.with_gpu_chain(diagnostic, gpu, node)
            }
            Pending::InitialiserRead { node, call } => {
                let Reached::Read(read) = self.reached(node, call) else {
                    return None;
                };
                let diagnostic = Diagnostic::new(
                    Code::E5081,
                    format!("`{}` cannot be read during initialisation, including through a function call.", read.name),
                )
                .at(self.call_span(node, call)?)
                .note("physics bodies are created after state and field initialisation and the first binding evaluation")
                .help("read the body property in `update`, `fixed_update` or an event handler instead");
                let (steps, root, omitted) = self.chain_to(initialisers, node);
                let root_text = format!("{} runs during initialisation", self.name(root));
                self.with_chain(diagnostic, root, root_text, &steps, omitted)
            }
            Pending::Recursion { start, steps } => self.recursion_diagnostic(start, &steps)?,
            Pending::Impure { node, call } => self.impure_diagnostic(node, call, dist)?,
            Pending::HandlerOnly { node, call } => {
                let n = self.node(node)?;
                let fact = n.facts.calls.get(call)?;
                let Callee::Builtin(builtin) = &fact.callee else {
                    return None;
                };
                Diagnostic::new(
                    Code::E5080,
                    format!(
                        "`{}` may be called only in lifecycle functions and event handlers, not in {}.",
                        builtin.name,
                        n.subject()
                    ),
                )
                .at(fact.span)
                .note(handler_only_note(&builtin.name))
            }
            Pending::CouldBePure { node } => {
                let n = self.node(node)?;
                Diagnostic::new(
                    Code::W4003,
                    format!(
                        "The `cpu fn` '{}' uses no CPU-only operation; it could be a `fn`.",
                        n.name
                    ),
                )
                .at(n.span)
                .help("declare it with `fn`, so that pure functions and GPU code can call it")
            }
            Pending::WhileLoop { node, index } => {
                let n = self.node(node)?;
                let span = *n.facts.while_loops.get(index)?;
                let diagnostic = Diagnostic::new(
                    Code::E4010,
                    format!(
                        "A `while` loop has no constant bound, but {} runs on the GPU.",
                        n.subject()
                    ),
                )
                .at(span)
                .note("`while` is a CPU loop (decision 0144); loops in GPU code need bounds that are constant expressions")
                .help("use `for i in 0..N { ... }` with a constant `N` and leave it early with `break`");
                self.with_gpu_chain(diagnostic, gpu, node)
            }
            Pending::UnboundedLoop { node, index } => {
                let n = self.node(node)?;
                let span = *n.facts.unbounded_loops.get(index)?;
                let diagnostic = Diagnostic::new(
                    Code::E4010,
                    format!(
                        "The bounds of this `for` loop are not constant expressions, but {} runs on the GPU.",
                        n.subject()
                    ),
                )
                .at(span)
                .note("loops in GPU code need bounds that are constant expressions");
                self.with_gpu_chain(diagnostic, gpu, node)
            }
            Pending::CpuOnlyType { node, index } => {
                let n = self.node(node)?;
                let site = n.facts.cpu_only.get(index)?;
                let diagnostic = Diagnostic::new(
                    Code::E4011,
                    format!(
                        "{} has type {}, which does not exist on the GPU, but {} runs on the GPU.",
                        capitalise(&site.what),
                        site.ty,
                        n.subject()
                    ),
                )
                .at(site.span)
                .actual(site.ty.clone())
                .note("GPU code uses only bool, i32, u32, f32, vectors, mat4, quat, color, and structs and arrays of them");
                let diagnostic = match cpu_type_help(&site.ty) {
                    Some(help) => diagnostic.help(help),
                    None => diagnostic,
                };
                self.with_gpu_chain(diagnostic, gpu, node)
            }
            Pending::CpuOnlyBuiltin { node, call } => {
                let n = self.node(node)?;
                let fact = n.facts.calls.get(call)?;
                let Callee::Builtin(builtin) = &fact.callee else {
                    return None;
                };
                let diagnostic = Diagnostic::new(
                    Code::E4012,
                    format!(
                        "`{}` is a CPU-only built-in function, but {} runs on the GPU.",
                        builtin.name,
                        n.subject()
                    ),
                )
                .at(fact.span)
                .help(cpu_builtin_help(&builtin.name));
                self.with_gpu_chain(diagnostic, gpu, node)
            }
            Pending::GpuOnlyBuiltin { node, call } => {
                let n = self.node(node)?;
                let fact = n.facts.calls.get(call)?;
                let Callee::Builtin(builtin) = &fact.callee else {
                    return None;
                };
                let tail = if n.is_cpu_fn() || n.kind == Kind::CpuRoot {
                    format!("{} runs on the CPU", n.subject())
                } else {
                    format!("{} is called from CPU code", n.subject())
                };
                let diagnostic = Diagnostic::new(
                    Code::E4013,
                    format!(
                        "`{}` is a GPU-only built-in function, but {tail}.",
                        builtin.name
                    ),
                )
                .at(fact.span)
                .note("GPU-only built-in functions may be used only in material stage functions and the `fn`s they call");
                self.with_cpu_chain(diagnostic, cpu, node)
            }
        })
    }

    fn recursion_diagnostic(&self, start: usize, steps: &[Step]) -> Option<Diagnostic> {
        let first = self.node(start)?;
        let mut names: Vec<&str> = steps.iter().map(|s| self.name(s.from)).collect();
        names.push(first.name.as_str());
        let mut diagnostic = Diagnostic::new(
            Code::E4001,
            format!(
                "The function '{}' calls itself: {}.",
                first.name,
                path_text(&names)
            ),
        )
        .at(first.span);
        for step in steps {
            diagnostic = diagnostic.related(
                step.span,
                format!(
                    "'{}' calls '{}' here",
                    self.name(step.from),
                    self.name(step.to)
                ),
            );
        }
        Some(diagnostic.help(
            "recursion is not supported in v0.1, in either domain; rewrite it with a `for` loop",
        ))
    }

    /// `E4002` at call `call` of the `fn` `node`, with the chain from the
    /// callee down to the CPU-only operation.
    fn impure_diagnostic(
        &self,
        node: usize,
        call: usize,
        dist: &[Option<(usize, usize)>],
    ) -> Option<Diagnostic> {
        let n = self.node(node)?;
        let span = self.call_span(node, call)?;
        let help = format!(
            "a `fn` may call only `fn`s and pure built-in functions; declare '{}' as `cpu fn` if it needs the CPU",
            n.name
        );
        let message;
        let mut ambient_read = false;
        let mut related: Vec<(Span, String)> = Vec::new();
        let mut notes: Vec<String> = Vec::new();
        match self.reached(node, call) {
            Reached::Read(read) => {
                return Some(Diagnostic::new(
                    Code::E4002,
                    format!("The pure function '{}' reads `{}`, which is ambient CPU state.", n.name, read.name),
                )
                .at(span)
                .note("a pure function computes only on its parameters, locals and constants")
                .help("pass the value as a parameter; use `cpu fn` only when the helper needs to read CPU state"));
            }
            Reached::CpuFn(target) => {
                let t = self.node(target)?;
                message = format!(
                    "The pure function '{}' calls the `cpu fn` '{}'.",
                    n.name, t.name
                );
                related.push((t.span, format!("'{}' is declared `cpu fn` here", t.name)));
            }
            Reached::Builtin { name, .. } => {
                message = format!(
                    "The pure function '{}' calls `{name}`, which is CPU-only.",
                    n.name
                );
                notes.push(format!("`{name}` is a CPU-only built-in function"));
            }
            Reached::PureFn(target) => {
                let mut names: Vec<String> = vec![n.name.clone(), self.name(target).to_owned()];
                let mut current = target;
                let mut steps = 0;
                let mut omitted = 0;
                // Each step goes to a function strictly nearer a CPU-only
                // operation, so this ends.
                while let Some((_, next_call)) = dist.get(current).copied().flatten() {
                    let from = self.name(current).to_owned();
                    let next_span = self.call_span(current, next_call)?;
                    let mut push = |related: &mut Vec<(Span, String)>, span: Span, text: String| {
                        if steps < MAX_CHAIN_STEPS {
                            related.push((span, text));
                        } else {
                            omitted += 1;
                        }
                        steps += 1;
                    };
                    match self.reached(current, next_call) {
                        Reached::PureFn(next) => {
                            let to = self.name(next).to_owned();
                            push(
                                &mut related,
                                next_span,
                                format!("'{from}' calls '{to}' here"),
                            );
                            names.push(to);
                            current = next;
                        }
                        Reached::CpuFn(next) => {
                            let t = self.node(next)?;
                            push(
                                &mut related,
                                next_span,
                                format!("'{from}' calls the `cpu fn` '{}' here", t.name),
                            );
                            push(
                                &mut related,
                                t.span,
                                format!("'{}' is declared `cpu fn` here", t.name),
                            );
                            names.push(t.name.clone());
                            break;
                        }
                        Reached::Builtin { name, .. } => {
                            push(
                                &mut related,
                                next_span,
                                format!("'{from}' calls `{name}` here"),
                            );
                            names.push(format!("`{name}`"));
                            notes.push(format!("`{name}` is a CPU-only built-in function"));
                            break;
                        }
                        Reached::Read(read) => {
                            ambient_read = true;
                            push(
                                &mut related,
                                next_span,
                                format!("'{from}' reads `{}` here", read.name),
                            );
                            names.push(format!("`{}`", read.name));
                            notes.push(format!("`{}` is ambient CPU state", read.name));
                            break;
                        }
                        Reached::Nothing => break,
                    }
                    if steps > self.nodes.len() + 1 {
                        break;
                    }
                }
                if omitted > 0 {
                    notes.push(format!(
                        "the chain continues through {omitted} more step{} not listed",
                        if omitted == 1 { "" } else { "s" }
                    ));
                }
                let names: Vec<&str> = names.iter().map(String::as_str).collect();
                message = format!(
                    "The pure function '{}' calls '{}', which needs the CPU: {}.",
                    n.name,
                    self.name(target),
                    path_text(&names)
                );
            }
            Reached::Nothing => return None,
        }
        let mut diagnostic = Diagnostic::new(Code::E4002, message).at(span);
        for (span, text) in related {
            diagnostic = diagnostic.related(span, text);
        }
        for note in notes {
            diagnostic = diagnostic.note(note);
        }
        Some(diagnostic.help(if ambient_read {
            "read the CPU value at the caller and pass it explicitly through the pure helpers; a material receives it through a param set with `bind(...)`".to_owned()
        } else {
            help
        }))
    }

    /// Add the chain from a GPU root to `node` as related spans.
    fn with_gpu_chain(&self, diagnostic: Diagnostic, gpu: &[Reach], node: usize) -> Diagnostic {
        let (steps, root, omitted) = self.chain_to(gpu, node);
        let root_text = match self.node(root) {
            Some(r) if r.kind == Kind::GpuRoot => format!("{} runs on the GPU", r.name),
            Some(r) => format!(
                "'{}' runs on the GPU (called from a stage function)",
                r.name
            ),
            None => String::new(),
        };
        self.with_chain(diagnostic, root, root_text, &steps, omitted)
    }

    /// Add the chain from CPU code to `node` as related spans.
    fn with_cpu_chain(&self, diagnostic: Diagnostic, cpu: &[Reach], node: usize) -> Diagnostic {
        let (steps, root, omitted) = self.chain_to(cpu, node);
        let root_text = match self.node(root) {
            Some(r) if r.kind == Kind::CpuRoot => format!("{} runs on the CPU", r.name),
            Some(r) => format!("'{}' is a `cpu fn`, which runs on the CPU", r.name),
            None => String::new(),
        };
        self.with_chain(diagnostic, root, root_text, &steps, omitted)
    }

    fn with_chain(
        &self,
        mut diagnostic: Diagnostic,
        root: usize,
        root_text: String,
        steps: &[Step],
        omitted: usize,
    ) -> Diagnostic {
        if let Some(r) = self.node(root) {
            diagnostic = diagnostic.related(r.span, root_text);
        }
        for step in steps {
            diagnostic = diagnostic.related(
                step.span,
                format!(
                    "'{}' calls '{}' here",
                    self.name(step.from),
                    self.name(step.to)
                ),
            );
        }
        if omitted > 0 {
            diagnostic = diagnostic.note(format!(
                "the chain continues through {omitted} more call{} not listed",
                if omitted == 1 { "" } else { "s" }
            ));
        }
        diagnostic
    }
}

/// How a traversal reached a node: not at all (`None`), as a root
/// (`Some(None)`), or by a call (`Some(Some(step))`).
type Reach = Option<Option<Step>>;

/// The function an imported or local name `def` of `unit` denotes.
fn resolve_function(
    unit: &ProgramUnit<'_>,
    units: &BTreeMap<ModuleId, &ProgramUnit<'_>>,
    def: DefId,
) -> Option<FnRef> {
    match unit.resolution.def(def)?.kind {
        DefKind::Fn => Some(FnRef {
            module: unit.id,
            def,
        }),
        DefKind::Import => {
            let target = unit.resolution.import_target(def)?;
            if target.kind != DefKind::Fn {
                return None;
            }
            let exporter = units.get(&target.module)?;
            let def = exporter.resolution.def_of(target.node)?;
            Some(FnRef {
                module: target.module,
                def,
            })
        }
        _ => None,
    }
}

/// `a → b → c`, with the middle elided beyond [`MAX_PATH_NAMES`] names.
fn path_text(names: &[&str]) -> String {
    if names.len() <= MAX_PATH_NAMES {
        return names.join(" → ");
    }
    let head = MAX_PATH_NAMES / 2;
    let tail = MAX_PATH_NAMES - head;
    let omitted = names.len() - head - tail;
    let first = names.get(..head).unwrap_or(&[]).join(" → ");
    let last = names.get(names.len() - tail..).unwrap_or(&[]).join(" → ");
    format!("{first} → … ({omitted} more) … → {last}")
}

/// The text with its first letter in upper case.
/// What to write instead of a value of the CPU-only type `ty` in GPU code (`E4011`).
fn cpu_type_help(ty: &str) -> Option<&'static str> {
    match ty {
        "texture" | "sampler" => Some(
            "declare the texture or sampler as a param of the material (`param tex: texture = texture.white();`, `param smp: sampler = sampler.linear_repeat();`) and write `sample(tex, smp, uv)` where it is read; a function that needs a texel takes the `vec4` that `sample` returns, never the texture or the sampler",
        ),
        "string" => {
            Some("strings exist only on the CPU; GPU code works with numbers, vectors and colors")
        }
        "sound" => Some(
            "sounds exist only on the CPU: play them from a handler with `play(..)`; a material that should react to a sound reads a `state` set by that handler through a `param` and `bind(...)`",
        ),
        "font" => Some("fonts exist only on the CPU: pass them to `hud.text(..)`"),
        "entity_ref" | "mesh" | "material" => Some(
            "handles exist only on the CPU; give the stage the number, vector or color it needs as a `param` of the material and set it from the entity, with `bind(...)` for a value that changes",
        ),
        _ => None,
    }
}

/// What to write instead of the CPU-only built-in function `name` in GPU code (`E4012`).
fn cpu_builtin_help(name: &str) -> String {
    if name.starts_with("texture.") || name.starts_with("sampler.") || name.starts_with("asset.") {
        return "textures and samplers are made outside the stage: declare them as params of the material with their default (`param tex: texture = texture.white();`, `param smp: sampler = sampler.linear_repeat();`, or `asset.texture(\"file.png\")`) and write `sample(tex, smp, uv)` in the stage".to_owned();
    }
    match name {
        "random" => "a stage cannot draw random numbers; compute the value on the CPU (`random()` in `update`), keep it in a `state` and give it to the material as a param with `bind(that_state)`, or derive a per-pixel pattern from `surface.uv` and math functions".to_owned(),
        "print" => "a stage cannot print; remove the call, or compute the value on the CPU where `print` is available".to_owned(),
        _ => format!("`{name}` can be called only from CPU code (`update`, `fixed_update`, handlers and `cpu fn`s); compute its result there and give it to the stage as a `param`"),
    }
}

fn capitalise(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}
