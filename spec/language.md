# Mtek Language Reference — Core (v0.1)

- Repository path: `spec/language.md`
- Status: Normative for v0.1. Supersedes the illustrative syntax in blueprint §3 where they differ; every difference is listed in decision record 0008.
- Companion documents: `spec/grammar.ebnf` (syntax, authoritative production list), `spec/scenes.md` (scenes, entities, prefabs, state, bind, events), `spec/materials.md` (materials and GPU stages), `spec/stdlib.md` (registry contents), `spec/diagnostics.md` (codes cited here as `E….`).

Conventions in this document: **must** / **must not** are requirements on the compiler and runtime. "Error" means a compile-time diagnostic with severity `error` unless stated otherwise. Every rule here needs a positive or negative fixture before the feature that depends on it is reported as supported (blueprint §15).

---

## 1. Source text

1.1 **Encoding.** Source files are UTF-8. Invalid UTF-8 is error `E0001`. A leading UTF-8 byte-order mark (EF BB BF) is permitted and ignored; a BOM anywhere else is error `E0002`.

1.2 **Line endings.** `\n` and `\r\n` are line terminators. A carriage return not followed by `\n` is error `E0003`. The compiler never rewrites source text: byte offsets in diagnostics refer to the file exactly as stored on disk. The formatter writes `\n` only.

1.3 **File extension and size.** Source files use the extension `.mtek`. A file larger than 4 MiB is error `E0004` (protects tooling; the limit is a compiler constant listed in `spec/compiler-architecture.md`).

1.4 **Whitespace.** Space (U+0020), tab (U+0009) and line terminators separate tokens and are otherwise insignificant. Any other Unicode whitespace or control character outside strings and comments is error `E0005`.

1.5 **Comments.**
- `// …` to end of line.
- `/* … */` block comments. Block comments **nest** (`/* a /* b */ c */` is one comment), matching WGSL. An unterminated block comment is error `E0006`, reported at the opening `/*`.
- `/// …` is a **documentation comment**. It attaches to the declaration or member that immediately follows it (blank lines allowed, other comments not). Doc comments feed hover text and the context export. A doc comment followed by nothing documentable is warning `W0007`. A doc comment is `///` not followed by a fourth `/`: `////` and any longer run of slashes (separator banners such as `//////////`) start an ordinary line comment.

## 2. Tokens

2.1 **Identifiers.** `[A-Za-z_][A-Za-z0-9_]*`. ASCII only in v0.1 (non-ASCII letters are error `E0010` with the note "Unicode identifiers are not supported in v0.1"). Identifiers beginning with two underscores (`__x`) are reserved for generated code and are error `E0011`. The single identifier `_` is reserved and is error `E0012` wherever a name is declared.

2.2 **Keywords (reserved).** These may never be used as identifiers:

```
bind  break  continue  cpu  else  entity  export  false  fn  for  if
import  in  let  material  on  param  prefab  return  scene  self
state  struct  true  var  const
```

The blueprint's list (§3.4) plus `struct`, `true`, `false`, `self`, `bind`, `break`, `continue` (decision 0008).

2.3 **Reserved for future use.** Using these as identifiers is error `E0013` ("`while` is reserved for a future version"):

```
as  async  await  enum  extern  impl  loop  match  mod  move  mut
priv  pub  static  super  trait  type  unsafe  use  where  while  yield
compute  vertex  storage  uniform  workgroup  system  query  component
```

2.4 **Contextual names.** These are ordinary identifiers that gain meaning only in a specific position. They are not reserved:
- `camera` — a scene-object kind when it begins a scene member of the form `camera Name { … }` (`spec/scenes.md` §3).
- `update`, `fixed_update` — lifecycle function names inside a scene, entity or prefab body (`spec/scenes.md` §6).
- `fragment` — the stage function name inside a material body (`spec/materials.md` §3).
- `from` — in an import clause (`import { A } from "…";`).
- Event names after `on` (`key_down`, `collision_enter`, …), resolved against the registry.

2.5 **Literals.**

| Form | Syntax | Notes |
|---|---|---|
| Integer | `0` or `[1-9][0-9]*` | No sign (unary minus is an operator), no leading zeros (`007` is `E0020`), no separators, no suffixes, no hexadecimal in v0.1 (`0x1F` is `E0021`). |
| Float | `[0-9]+ '.' [0-9]+ ( [eE] [+-]? [0-9]+ )?` | Digits are required on both sides of the point: `1.0`, `0.5`, `2.5e-3`. `1.`, `.5`, `1e3` are `E0022` with a suggested edit (`1.0`, `0.5`, `1.0e3`). |
| Boolean | `true`, `false` | |
| String | `"…"` | Escapes: `\"`, `\\`, `\n`, `\t`, `\r`, `\0`, `\u{H…}` (1–6 hex digits, a Unicode scalar value). Any other escape is `E0023`. A raw line terminator inside a string is `E0024` (unterminated). Strings are CPU-only (§5.1). |
| Color | `#RRGGBB` or `#RRGGBBAA` | Hex digits, case-insensitive (formatter lowercases). Any other length (`#fff`) is `E0025`. Meaning: §5.4. |

2.6 **Punctuation and operators.**

```
{ } ( ) [ ] < > , ; : . ..
+ - * / % ! = == != < <= > >= && ||
+= -= *= /= ->
```

`<` and `>` double as generic brackets only inside type syntax (`array<f32, 4>`), which appears exclusively after `:` or `->`, so no expression ambiguity exists. `..` appears only in `for` headers (§7.5). Bitwise operators (`& | ^ ~ << >>`) are not part of v0.1; each is lexed so that it can be rejected with `E1901` ("bitwise operators are not supported in v0.1") rather than producing a confusing parse error.

## 3. Program structure

3.1 Each `.mtek` file is a **module** (§9). A module is a sequence of **items**:

| Item | Form | Section |
|---|---|---|
| Import | `import { A, B } from "./path.mtek";` | §9 |
| Constant | `const NAME: Type = expr;` (type annotation optional) | §8.1 |
| Function | `fn name(params) -> T { … }` / `cpu fn name(…) { … }` | §8.2 |
| Struct | `struct Name { field: Type; … }` | §5.5 |
| Material | `material Name { … }` | `spec/materials.md` |
| Prefab | `prefab Name { … }` | `spec/scenes.md` |
| Scene | `scene Name { … }` | `spec/scenes.md` |

Any item except `import` may be preceded by `export`. Items may appear in any order; references between items do not depend on order (except constant initialisers, §8.1).

3.2 **Terminators.** Statements and declaration fields end in `;`. Block-bodied forms (`fn`, `if`, `for`, `scene`, `entity`, …) do not take a trailing `;`. Within descriptor literals (§6.6) fields are separated by `;` and the final separator before `}` is optional. A descriptor literal used as a field value is itself followed by the field's `;`: `mesh: Box { size: vec3(1.0, 1.0, 1.0) };`.

3.3 **Naming conventions.** Not enforced by the compiler in v0.1, but the formatter's lint (`W0030`) warns when: types, materials, prefabs, scenes and entities are not `PascalCase`; functions, fields, params, state and locals are not `snake_case`; constants are not `SCREAMING_SNAKE_CASE`. Generated code never depends on case.

## 4. Names and scopes

4.1 **Scopes**, from outermost: prelude (standard library, `spec/stdlib.md`) → module (items and imports) → scene (state, entities, cameras) → entity/prefab (params; `self`) → function or handler (parameters) → blocks (locals).

4.2 **No shadowing in v0.1.** Declaring a name that is already visible from an enclosing scope is error `E2001`, with a related span at the earlier declaration. Two declarations of the same name in one scope is error `E2002`. Rationale: one name, one meaning, in every context an agent might read (decision 0003). Field names of schemas and records are not in scope and never conflict.

One deliberate exception keeps common words usable: a **local, parameter, `state` or `param`** may reuse the name of a prelude **function** (`length`, `step`, `distance`, `log`, …). Inside that scope the name means the local; calling it is error `E2004` ("`length` is a local `f32` here; the built-in `length` is hidden by it"). Prelude **types, schemas, enums and namespaces** (`vec3`, `color`, `quat`, `Box`, `Key`, `frame`, …) can never be reused by any declaration, and no **item** may reuse any prelude name — with one further exception: a material or prefab **`param`** may share its name with a prelude type (this is what lets `Unlit` have a param called `color`, as the blueprint's `Unlit { color: #6b5cff }` requires). Inside that material or prefab the name means the param in expression position and the type in type position; using it as a namespace (`color.linear(…)`) there is `E2005`.

4.3 **Static resolution.** Every name is resolved at compile time. An unknown name is error `E2003`; when an in-scope name is within edit distance 2 the diagnostic includes a related "did you mean" span but no automatic edit (blueprint §9.4: do not suggest an arbitrary fix when intent is unknown — a rename suggestion is offered only as a *validated edit* if exactly one candidate exists and it type-checks; see `spec/diagnostics.md` §6).

4.4 **Qualified access.** `TypeName.member` names an associated function or constant of a built-in type (`quat.identity()`, `color.linear(…)`, `Key.Space`). `frame.time` reads a built-in frame value (`spec/scenes.md` §7). `EntityName.field` reads an entity field (`spec/scenes.md` §4).

## 5. Types

5.1 **Type catalogue (v0.1).**

| Category | Types | Available in | Notes |
|---|---|---|---|
| Scalars | `bool`, `i32`, `u32`, `f32` | CPU and GPU | |
| Text | `string` | CPU only | Immutable. No GPU representation. |
| Vectors | `vec2`, `vec3`, `vec4` | CPU and GPU | Components are `f32`. Integer and boolean vectors are not in v0.1. |
| Matrix | `mat4` | CPU and GPU | 4×4 `f32`, column-major (§5.3). `mat3` and others are not in v0.1. |
| Rotation | `quat` | CPU and GPU | Unit quaternion `(x, y, z, w)`. Distinct from `vec4`. |
| Color | `color` | CPU and GPU | Linear-light RGBA `f32`. Distinct from `vec4`. |
| Records | user `struct` types | CPU; GPU if every field is GPU-representable | §5.5 |
| Arrays | `array<T, N>` | CPU; GPU if `T` is | Fixed length `N`: an integer literal or the name of an integer constant, with value 1 … 65 536 (`E3031`). |
| Handles | `mesh`, `material`, `texture`, `sampler`, `entity_ref` | CPU only (opaque) | Never convertible to numbers. `texture`/`sampler` may appear as material params (`spec/materials.md` §2). |
| Unit | (no name) | both | The result of a function without `->`. Not usable as a value. |

There is no implicit `null`, no `any`, no implicit optional. Fallibility exists only at host boundaries (`spec/runtime-abi.md` §6) and in a small number of built-in operations whose fallible result is a `bool` plus a documented default (e.g. `alive(r)`).

5.2 **Type equivalence.** Nominal for `struct` types; structural for everything else (`array<f32, 3>` is one type everywhere). `vec4`, `quat` and `color` are three different types even though all are four `f32`s.

5.3 **Matrices.** `mat4` is column-major and multiplies column vectors on the right: `m * v` where `v: vec4`. `m[i]` is column `i` (`vec4`). Composition `a * b` applies `b` first.

5.4 **Colors.**
- Values of type `color` are always **linear** RGBA with straight (non-premultiplied) alpha.
- A literal `#RRGGBB` denotes sRGB-encoded RGB channels with alpha 1.0; `#RRGGBBAA` gives alpha linearly (`AA/255`). The compiler converts each RGB channel `c8` with the exact sRGB EOTF:
  `c = c8/255; linear = c <= 0.04045 ? c/12.92 : ((c + 0.055)/1.055)^2.4`, computed in `f64` and rounded once to `f32`. The resulting constant is folded at compile time, so CPU and GPU see identical bits.
- `color.linear(rgb: vec3, a: f32) -> color` constructs from linear components. `color.srgb(rgb: vec3, a: f32) -> color` applies the same EOTF at run time (CPU: `f32` arithmetic per §6.4; GPU: equivalent WGSL; results agree within the tolerance in `spec/testing.md` §5).
- Component access: `.r .g .b .a` (`f32`) and `.rgb` (`vec3`). No other swizzles on `color`. Arithmetic operators are not defined on `color` (`E3010`, with a note pointing at `.rgb`). Colours feeding opaque material slots are constrained further by `spec/materials.md` §6.

5.5 **Structs.** `struct Name { a: f32; b: vec3; }`. Fields are ordered, named, at least one field, no defaults, no methods. Recursive structs are impossible (no references); a struct containing itself via arrays is error `E3020`. Literal syntax uses the descriptor form: `Name { a: 1.0; b: vec3(0.0) }` with every field given exactly once (missing `E3021`, duplicate `E3022`, unknown `E3023`).

5.6 **Arrays.** Type `array<T, N>`. Literal `[e0, e1, …]` (commas; element types must be identical after literal resolution; the length is the element count). Indexing `a[i]` with `i: i32` or `u32`:
- A constant index out of range is error `E3030`.
- A run-time index is **clamped** to `[0, N-1]` in both execution domains (decision 0009): the WGSL emitter inserts the clamp explicitly, because WGSL itself guarantees only an indeterminate value (or, through a reference, an implementation-chosen outcome) for an out-of-bounds run-time index [S5]. In development builds the CPU additionally reports warning `W8030` once per call site when clamping occurs. This gives identical results on CPU and GPU.

## 6. Expressions

6.1 **Precedence and associativity** (highest first). The Pratt parser must implement exactly this table; `spec/grammar.ebnf` encodes the same.

| Level | Operators | Associativity |
|---|---|---|
| 8 | call `f(…)`, field `.x`, index `[i]` | left (postfix) |
| 7 | unary `-`, `!` | right (prefix) |
| 6 | `*` `/` `%` | left |
| 5 | `+` `-` | left |
| 4 | `<` `<=` `>` `>=` | **non-associative** (`a < b < c` is `E1010`) |
| 3 | `==` `!=` | **non-associative** |
| 2 | `&&` | left |
| 1 | `\|\|` | left |

Parentheses group. There is no ternary operator, no assignment expression, no comma operator, no `if` expression in v0.1.

6.2 **Operator typing.** No implicit conversions between established types (§6.5). Let S = scalar float `f32`, V = any of `vec2/vec3/vec4`.

| Operator | Operand types | Result |
|---|---|---|
| `+ - * / %` | `f32 ∘ f32`, `i32 ∘ i32`, `u32 ∘ u32` | same |
| `+ - * /` | `V ∘ V` (same dimension; component-wise) | V |
| `* /` | `V ∘ f32`, and `f32 * V` | V |
| `*` | `mat4 * mat4` | `mat4` |
| `*` | `mat4 * vec4` | `vec4` |
| `*` | `quat * quat` (Hamilton product; `(a*b)*v == a*(b*v)`) | `quat` |
| `*` | `quat * vec3` (rotate vector) | `vec3` |
| unary `-` | `f32`, `i32`, V | same (`-` on `u32` is `E3011`) |
| `!` | `bool` | `bool` |
| `&& \|\|` | `bool` | `bool`, short-circuit on CPU; on GPU both operands are evaluated only if both are side-effect-free, which v0.1 GPU code always is |
| `< <= > >=` | `f32`, `i32`, `u32` (same type) | `bool` |
| `== !=` | same-typed `bool`, `f32`, `i32`, `u32`, `entity_ref` | `bool` |

Vector `==` is not defined in v0.1 (`E3012`). `%` on `f32` is the truncated remainder `x - y * trunc(x / y)`.

6.3 **Integer semantics** (both domains, decision 0009 — chosen to equal WGSL so the two domains agree):
- `i32` and `u32` arithmetic wraps modulo 2³² (two's complement for `i32`).
- `x / 0` yields `x`. `i32::MIN / -1` yields `i32::MIN`. Division truncates toward zero.
- `x % 0` yields `0`. `i32::MIN % -1` yields `0`. The remainder has the sign of the dividend.
- **Constant folding is mandatory.** Any expression whose operands are all literals and/or constants is a *constant expression* wherever it appears (not only in `const` declarations). The compiler folds it with exact semantics and emits only the folded value in both domains. Overflow or division by zero during folding is error `E3040` — matching WGSL, where literal-only expressions are const-expressions and such overflow is a shader-creation error. (Without this rule `2147483647 + 1` would wrap on the CPU and fail shader creation on the GPU.)

6.4 **Floating-point semantics.**
- `f32` is IEEE-754 binary32. On the CPU, the emitter rounds the result of **every** `f32` operation to binary32 (`Math.fround`); for `+ - * /` and `sqrt` this reproduces correctly-rounded binary32 exactly. On the GPU, WGSL accuracy rules apply ([S5]): division and transcendental functions may differ by documented ULP bounds, implementations may contract `a*b+c`, and infinities/NaN handling may be non-IEEE.
- **Mtek promises:** identical results for constant-folded values; correctly rounded `+ - * /` and `sqrt` on the CPU; agreement between CPU and GPU within the per-function tolerances listed in `spec/testing.md` §5 for finite inputs in the documented domains. Mtek does **not** promise bit-identical CPU/GPU results, nor GPU behaviour for NaN, infinity, or division by zero. Code whose meaning depends on those is non-portable; the CPU result is the specified one. On the GPU, subnormal inputs and results may be flushed to zero and the sign of a zero may differ (WGSL rules). The cases of the conformance table that are non-portable or outside the input ranges WGSL states its accuracy for are listed in `tests/semantics/numeric/gpu-not-compared.json` (decision 0043).
- `f32` division by zero on the CPU follows IEEE (±inf, NaN).

6.5 **Conversions.** Explicit, by calling the target type: `f32(x)`, `i32(x)`, `u32(x)`, `bool` has no conversions.

| From → To | Rule (identical on CPU and GPU) |
|---|---|
| `i32 → f32`, `u32 → f32` | Round to nearest representable (CPU: ties-to-even. GPU may choose either neighbour — inside tolerance). |
| `f32 → i32` / `f32 → u32` | **Clamp** to the target range, then truncate toward zero (WGSL rule, [S5]). NaN → `0` on the CPU; on the GPU NaN yields an indeterminate value (non-portable). Out of range, the result is the integer closest to the truncated value that an `f32` also represents exactly — `[-2147483648, 2147483520]` and `[0, 4294967040]` — on the CPU, in folded constants and on the GPU (decision 0047). |
| `i32 ↔ u32` | Bit reinterpretation (two's complement). |
| same → same | Identity (allowed; lint `W3050` "redundant conversion"). |

6.6 **Literal resolution.** An integer literal adopts the type required by its context if the value is representable: `i32`, `u32` or `f32` (`let x: f32 = 1;` is valid, `vec3(0, 1, 0)` is valid). A float literal adopts `f32` only. With no context an integer literal is `i32` and a float literal is `f32`. A literal not representable in its target is error `E3041` (e.g. `let a: u32 = 4294967296;`, `let b: i32 = 3.5;`). A float literal is representable as `f32` iff it is finite after rounding to binary32 (`1.0e39` is `E3041`). A unary minus applied **directly** to an integer literal forms a single negative literal, so `-2147483648` is a valid `i32`; the WGSL emitter writes that value as `i32(-2147483647 - 1)` because WGSL itself has no such literal.

6.7 **Constructors.**

| Call | Result |
|---|---|
| `vec2(x, y)`, `vec3(x, y, z)`, `vec4(x, y, z, w)` | from `f32` components |
| `vec3(s)`, `vec2(s)`, `vec4(s)` | splat |
| `vec3(xy: vec2, z)`, `vec4(xyz: vec3, w)`, `vec4(xy: vec2, z, w)` | composition |
| `quat.identity()`, `quat.axis_angle(axis: vec3, angle: f32)`, `quat.euler(x: f32, y: f32, z: f32)` | `quat.euler(x, y, z)` = `axis_angle(+Y, y) * axis_angle(+X, x) * axis_angle(+Z, z)`: it rotates a vector first about Z, then about X, then about Y (fixed world axes). `axis_angle` normalises `axis`; a zero axis yields identity on CPU and is unspecified on GPU (non-portable, documented). |
| `mat4.identity()`, `mat4.translation(v: vec3)`, `mat4.rotation(q: quat)`, `mat4.scale(v: vec3)`, `mat4.columns(c0, c1, c2, c3: vec4)` | |
| `color.linear(rgb, a)`, `color.srgb(rgb, a)` | §5.4 |
| `Name { … }` | struct literal or schema descriptor (§6.8) |

6.8 **Descriptor literals.** `TypeName { field: value; … }` constructs a value of a user `struct`, a registry schema (`Box`, `Unlit`, `Dynamic`, …), a user `material` (an instance, `spec/materials.md` §4) or a `prefab` (in `spec/scenes.md` §5 contexts only). Field rules for schemas: unknown field `E5001`, duplicate `E5002`, missing required `E5003`, wrong type `E3102`. To avoid the classic ambiguity, a descriptor literal may not appear directly as the condition of `if` or the iterable of `for`; parenthesise it (`E1011` with a suggested edit).

6.9 **Field access and swizzles.** On vectors: single components `.x .y .z .w` (within dimension) and multi-component swizzles of length 2–4 from `xyzw` with repetition allowed (`v.xy`, `v.zyx`, `v.xxxx`). On `color`: §5.4. On structs: declared fields. On `quat`: `.x .y .z .w` read-only components. Out-of-dimension component is `E3013`.

6.10 **Calls.** `f(a, b)` calls a function; arguments are positional, all required, no named or default arguments in v0.1. Built-in functions (§10) follow the same rule. A call to a `cpu fn` from a pure context is an effect error (§8.3).

## 7. Statements

7.1 `let name[: T] = expr;` — immutable local. `var name[: T] = expr;` — mutable local. An initialiser is mandatory (no uninitialised locals). A `var` never assigned after declaration is lint `W2010`.

7.2 **Assignment.** `place = expr;` and compound `place op= expr;` for `op ∈ {+ - * /}` meaning `place = place op expr` with `place` evaluated once. Assignable places (lvalues): `var` locals; scene state; `self.state_name`; writable entity fields (`self.position`, `Cube.rotation`, …) subject to the ownership rules in `spec/scenes.md` §8; a struct field of an assignable struct place (`p.offset = …;`); an element of an assignable array place (`arr[i] = …;`); a single vector component of an assignable vector place (`self.position.y = 0.0;`). These compose to any depth (`arr[i].x += 1.0;`, `s.items[j] = 0.0;`). A run-time index of a place is clamped exactly like a read (§5.6, including `W8030`); a constant index out of range is `E3030`. Writing into a place never changes any other variable, parameter or constant: values have value semantics (decision 0045). Multi-component swizzle assignment is `E3060`. Assigning to `let`, a param, a constant, or a function parameter, or to a part of one, is `E3061`; so is assigning to a `mat4` column or to a component of a `quat` or `color`.

7.3 **Expression statements.** Only calls may stand as statements (`f(x);`). Any other expression statement is `E1020` ("expression result unused").

7.4 **`if`.** `if cond { … } else if cond { … } else { … }`. `cond` must be `bool` (`E3070`; no truthiness).

7.5 **`for`.** Two forms:
- Range: `for i in a..b { … }` — `a` and `b` are both `i32` or both `u32` (after literal resolution); `i` takes `a, a+1, …, b-1`; empty when `a >= b`. `a..b` exists only in this position.
- Array: `for x in arr { … }` where `arr: array<T, N>`; `x: T` by value.
The loop variable is immutable. In GPU-reachable code (§8.4) the range bounds must be constant expressions (`E4010` otherwise) and `N` is constant by construction.

7.6 **`break`, `continue`** apply to the innermost `for`. Outside a loop: `E1030`.

7.7 **`return`.** `return expr;` in functions with a result type; `return;` in unit functions and handlers. Every path of a function with a result type must return (`E3080`). Unreachable statements after `return`/`break`/`continue` are warning `W3081`.

7.8 **Blocks.** `{ … }` introduces a scope. Locals are visible from their declaration to the end of the block.

## 8. Constants, functions, effects

8.1 **Constants.** `const NAME[: T] = expr;` at module level or in any block. The initialiser must be a **constant expression**: literals; other constants (no cycles: `E2020` with the full cycle path); unary/binary operators; conversions; vector/`quat`/`mat4`/`color` constructors; struct and array literals; and the pure intrinsics marked *const* in `spec/stdlib.md` §6. Calls to user functions are not constant in v0.1 (`E3090`). Constants are evaluated once by the compiler in exact `f32`/`i32`/`u32` semantics and folded into both CPU and GPU output, so a constant has identical bits in both domains. Module constants are side-effect-free by construction.

8.2 **Functions.**
- `fn name(p: T, …) -> R { … }` — a **pure** function. Parameter types are mandatory; `-> R` omitted means unit.
- `cpu fn name(…) -> R { … }` — a CPU-only function.
- Parameters are immutable values. Arguments are passed by value (copy semantics for all value types).
- Recursion, direct or mutual, is error `E4001` (with the call cycle) in v0.1, in both domains.
- Functions are module items only; no nested functions, closures or function values.

8.3 **Effects.** Every function body and handler has an **effect level**, computed transitively over the call graph:

| Level | May do | Who has it |
|---|---|---|
| `pure` | compute on parameters, locals, constants; call pure functions and *pure* intrinsics | `fn`; material stage functions (plus stage inputs and params) |
| `cpu` | everything `pure` may, plus call `cpu fn`s and *cpu* intrinsics (`random`, `print`, `is_key_down`, `alive`) | `cpu fn`; lifecycle and event handlers (which additionally read/write scene and entity state, issue body commands, and call the **handler-only** intrinsics `spawn` and `destroy` — calling those anywhere else, including inside a `cpu fn`, is `E5080`) |

A `fn` whose body (transitively) requires `cpu` is error `E4002`, reported at the offending call with the full call chain as related spans. A `cpu fn` that is in fact pure gets lint `W4003` ("could be `fn`"). `cpu fn`s have no access to scene state (there is no ambient scene); they receive what they need as parameters.

8.4 **GPU reachability.** A pure function is *GPU-reachable* if a material stage function calls it, directly or transitively. GPU-reachable functions must additionally satisfy: no `string` or handle types anywhere (`E4011`); loops have constant bounds (`E4010`); no intrinsic marked CPU-only (`E4012`). Conversely, a GPU-only intrinsic (`sample`, `lighting.pbr`) reached from CPU code is `E4013`. The same function may also be called from CPU code; it is then compiled into both domains from the same typed IR. The compiler never moves code to the GPU because it "looks mathematical": only stage functions and their pure callees are compiled to WGSL (blueprint §4.4).

## 9. Modules

9.1 **Imports.** `import { A, B } from "./relative/path.mtek";`. The specifier is a string literal that must start with `./` or `../`, use `/` separators, and end in `.mtek` (`E2030`). It is resolved relative to the importing file, normalised (`.` and `..` segments removed), and must remain inside the project root (`E2031`, path traversal). Case must match the file system entry exactly, even on case-insensitive file systems (`E2032`) — this keeps projects portable. Importing a name that the target does not `export` is `E2033`; importing the same name twice is `E2002`. There are no wildcard imports, no aliases (`as` is reserved), and no package imports in v0.1 (bare specifiers like `"physics"` are `E2034`).

9.2 **Exports.** `export` makes an item importable. Only items can be exported. The project entry module may declare its entry scene without `export` (blueprint §4.5).

9.3 **Cycles.** An import cycle is error `E2035`, reported once, at the import that closes the cycle, with every module of the cycle listed in order as related spans.

9.4 **Order independence.** Module loading starts at the entry file and follows imports in source order; the resulting module set and every output derived from it are independent of directory enumeration order. Within a module, item order matters only for diagnostics ordering, never for meaning.

9.5 **Prelude.** All standard-library names (`spec/stdlib.md`) are in scope in every module without import. Reuse rules are in §4.2.

## 10. Built-in functions (summary)

The authoritative list with signatures, domains, const-eligibility and CPU semantics lives in the registry (`spec/stdlib.md` §6). v0.1 math intrinsics: `abs min max clamp mix step smoothstep sqrt inverse_sqrt pow exp exp2 log log2 sin cos tan asin acos atan atan2 floor ceil round trunc fract sign length distance dot cross normalize reflect saturate radians degrees transpose`. Constant evaluation of transcendental functions (and of colour literals, §5.4) uses the pure-Rust `libm` crate, so folded constants are bit-identical on every host OS. Notable CPU semantics that must match WGSL rather than JavaScript:
- `round` rounds half to **even** (JavaScript's `Math.round` rounds half up — the runtime math library must implement ties-to-even).
- `fract(x) = x - floor(x)`.
- `clamp(x, lo, hi) = min(max(x, lo), hi)`; `lo > hi` is non-portable.
- `normalize(v)` of a zero vector, or of a vector whose squared length underflows or overflows, is the zero vector on the CPU and on the GPU (a generated helper, decision 0047); NaN and infinite components stay non-portable.
- `sign(0.0) = 0.0`.
- Integer `abs(i32::MIN) = i32::MIN`.

CPU-only intrinsics in v0.1: `random() -> f32` in `[0, 1)` (seeded per application from the mount option `seed`, default derived from time; tests always pass a seed), `print(message: string)` (development console; a no-op in release builds), `spawn`, `destroy`, `alive` (`spec/scenes.md` §9), `is_key_down(key: Key) -> bool` (`spec/scenes.md` §7.3).

## 11. What is not in v0.1 (each has a dedicated "unsupported" diagnostic)

`while`/`loop`; bitwise operators; integer/boolean vectors; `mat2`/`mat3`; `f16`/`f64`; numeric suffixes and hexadecimal literals; Unicode identifiers; closures and function values; generics; methods and `impl`; enums (only the built-in `Key`-style registry enums exist); optional/result types in the language; string formatting/concatenation (`+` on `string` is `E3014`); recursion; compute and vertex stages; storage buffers; pattern matching. The unsupported-feature codes are the `x9xx` codes of each range (`spec/diagnostics.md` §3).
