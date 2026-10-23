# Diagnostics (v0.1)

- Repository path: `spec/diagnostics.md`
- Status: Normative. Diagnostic envelope schema version **1**.
- Single source of truth for codes: `crates/mtek-compiler/src/diagnostics/codes.rs`. A test asserts that the catalogue table in §5 of this file lists exactly the codes defined there, with the same severity and title.

---

## 1. Goals

Diagnostics are the main interface between Mtek and anyone repairing a program — human or agent (blueprint §9.4). They must be **stable** (codes never change meaning), **precise** (exact byte spans), **actionable** (say what was expected and what was found), and **honest** (never suggest an arbitrary fix when intent is unknown).

## 2. The envelope

### 2.1 One diagnostic

```json
{
  "schemaVersion": 1,
  "code": "MTEK-E3102",
  "severity": "error",
  "title": "field or parameter type mismatch",
  "message": "Material parameter 'phase' expects f32, but received vec3.",
  "source": {
    "file": "src/main.mtek",
    "startByte": 420, "endByte": 439,
    "startLine": 18, "startColumn": 16, "endLine": 18, "endColumn": 35
  },
  "expected": "f32",
  "actual": "vec3",
  "related": [
    { "message": "parameter 'phase' is declared here", "source": { "file": "src/main.mtek", "startByte": 96, "endByte": 113, "startLine": 5, "startColumn": 5, "endLine": 5, "endColumn": 22 } }
  ],
  "notes": [],
  "suggestedEdits": [],
  "phase": "check",
  "docs": "spec/diagnostics.md#mtek-e3102"
}
```

| Field | Required | Meaning |
|---|---|---|
| `schemaVersion` | yes | `1` |
| `code` | yes | `MTEK-` + severity letter + 4 digits; stable forever |
| `severity` | yes | `error` \| `warning` \| `note` |
| `title` | yes | the catalogue title of the code (short, constant) |
| `message` | yes | specific, complete sentence naming the construct; no trailing jargon |
| `source` | yes, except `null` for project-level diagnostics and for files the source manager rejected before they got a file id (E0001, E0002, E0004, E9002 — their path and byte offset are stated in the message) | primary location. Bytes are offsets into the file **as stored on disk**, half-open. Lines/columns are 1-based; columns count Unicode scalar values. |
| `expected`, `actual` | when relevant | rendered Mtek types or forms |
| `related` | yes (may be empty) | secondary locations with their own message (e.g. the earlier declaration, the `bind`, each step of a cycle) |
| `notes` | yes (may be empty) | extra explanation, "help:" hints, unsupported-feature context |
| `suggestedEdits` | yes (may be empty) | validated edits only, at most one per diagnostic (§6) |
| `phase` | yes | `parse` \| `check` \| `emit` \| `validate` (Naga) \| `runtime:<scheduler phase or mount>` |
| `docs` | yes | anchor into this file |

### 2.2 A report (`mtek check --format json`, `mtek build --format json`)

```json
{
  "schemaVersion": 1,
  "tool": "mtek", "compilerVersion": "0.1.0-dev", "languageVersion": "0.1",
  "project": "pulse-cube",
  "diagnostics": [ … ],
  "summary": { "errors": 1, "warnings": 0, "notes": 0, "suppressed": 0 }
}
```
Diagnostics are ordered by `(file load order, startByte, endByte, code)`. A machine-readable JSON Schema for both shapes is checked in as `spec/diagnostic.schema.json`; every golden diagnostic fixture is validated against it.

### 2.3 Runtime diagnostics
Same shape; `phase` is `runtime:mount`, `runtime:input`, `runtime:tick`, `runtime:update`, `runtime:bindings`, `runtime:render`, `runtime:reload` or `runtime:device`; `source` resolved through the manifest `spans` table, which carries both the byte range and the line/column range, so the runtime needs no source text (`spec/runtime-abi.md` §12, decision 0019). Delivered through `onDiagnostic` as JavaScript objects of exactly this shape (TypeScript type `MtekDiagnostic` in the runtime).

## 3. Code ranges

| Range | Area |
|---|---|
| `0xxx` | source text and lexical structure |
| `1xxx` | syntax |
| `2xxx` | names, scopes, modules |
| `3xxx` | types, values, constant evaluation |
| `4xxx` | functions, effects, execution domains, material stages |
| `5xxx` | scenes, entities, schemas, ownership, bindings, physics rules |
| `6xxx` | GPU layout, target profile, generated-shader validation |
| `7xxx` | assets |
| `8xxx` | runtime (mount, device, host inputs, lifecycle, budgets) |
| `9xxx` | project, configuration, tooling, internal |

Within each range, **`x9xx` codes mean "specified as not supported in v0.1"**; their message names the feature and, when known, the version planned. (`E9999`, the internal-error code, is the one exception to this pattern.) They are deliberately different from `E9010` ("specified for v0.1 but not implemented by this compiler build yet") so that nobody confuses a missing implementation with a language limit.

## 4. Human rendering

```
error[MTEK-E3102]: field or parameter type mismatch
  --> src/main.mtek:18:16
   |
18 |         phase: vec3(1.0, 0.0, 0.0);
   |                ^^^^^^^^^^^^^^^^^^^ expected f32, found vec3
   |
 ::: src/main.mtek:5:5
   |
 5 |     param phase: f32 = 0.0;
   |     ----------------------- parameter 'phase' is declared here
   = help: material parameters are typed; pass an f32 such as `0.0`
```
The header line shows the code and the **message** (the specific sentence); the generic catalogue `title` appears only in JSON. The example above shows the title for brevity — implementations print the message there. Colour only when stdout is a TTY and `NO_COLOR` is unset. Tabs render as 4 spaces for caret alignment. Lines longer than 160 columns are elided around the span.

## 5. Catalogue (v0.1)

Severity letter is part of the code. "Fixture" means at least one negative fixture must exist before the related feature is reported as supported.

### 5.0 Source and lexical (`0xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e0001"></a>E0001 | invalid UTF-8 | file is not valid UTF-8 |
| <a id="mtek-e0002"></a>E0002 | misplaced byte-order mark | BOM not at file start |
| <a id="mtek-e0003"></a>E0003 | lone carriage return | `\r` not followed by `\n` |
| <a id="mtek-e0004"></a>E0004 | file too large | > 4 MiB |
| <a id="mtek-e0005"></a>E0005 | invalid character | disallowed whitespace/control character outside strings and comments |
| <a id="mtek-e0006"></a>E0006 | unterminated block comment | |
| <a id="mtek-w0007"></a>W0007 | dangling doc comment | `///` not followed by a documentable declaration |
| <a id="mtek-e0010"></a>E0010 | non-ASCII identifier | Unicode identifiers not in v0.1 |
| <a id="mtek-e0011"></a>E0011 | reserved identifier prefix | identifier starts with `__` |
| <a id="mtek-e0012"></a>E0012 | reserved identifier `_` | |
| <a id="mtek-e0013"></a>E0013 | reserved word | identifier is a word reserved for future use |
| <a id="mtek-e0020"></a>E0020 | leading zero in integer literal | |
| <a id="mtek-e0021"></a>E0021 | unsupported numeric literal form | hexadecimal, binary, octal, suffix, separators |
| <a id="mtek-e0022"></a>E0022 | malformed float literal | `1.`, `.5`, `1e3` (edit offered) |
| <a id="mtek-e0023"></a>E0023 | invalid escape sequence | |
| <a id="mtek-e0024"></a>E0024 | unterminated string | |
| <a id="mtek-e0025"></a>E0025 | malformed color literal | not 6 or 8 hex digits |
| <a id="mtek-w0030"></a>W0030 | naming convention | **Not implemented:** the naming lint is not part of v0.1 (`spec/language.md` §3.3, decisions 0070 item 11 and 0102); the code is kept so that the number is not reused, and no program produces it |

### 5.1 Syntax (`1xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e1001"></a>E1001 | unexpected token | generic; message lists expected tokens; a note says what to write instead where a construct of another language is the likely cause (an `if` used as a value; decision 0115) |
| <a id="mtek-e1002"></a>E1002 | unclosed delimiter | missing `}`/`)`/`]`; related span at the opener |
| <a id="mtek-e1003"></a>E1003 | missing semicolon | statement/field/member requires `;` (edit offered) |
| <a id="mtek-e1004"></a>E1004 | unexpected end of file | |
| <a id="mtek-e1010"></a>E1010 | chained comparison | `a < b < c`, `a == b == c` |
| <a id="mtek-e1011"></a>E1011 | descriptor literal in condition | parenthesise (edit offered) |
| <a id="mtek-e1020"></a>E1020 | unused expression | non-call expression statement |
| <a id="mtek-e1030"></a>E1030 | `break`/`continue` outside loop | |
| <a id="mtek-e1040"></a>E1040 | member not allowed here | e.g. `fn` or `prefab` inside a scene; a `help:` names where the declaration belongs (decision 0115) |
| <a id="mtek-e1050"></a>E1050 | nesting too deep | > 256 levels (decision 0022: also a chain of operators that makes an expression tree taller than that) |
| <a id="mtek-e1901"></a>E1901 | bitwise operators not supported | v0.1 |

### 5.2 Names and modules (`2xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e2001"></a>E2001 | shadowed name | declaration hides a visible name |
| <a id="mtek-e2002"></a>E2002 | duplicate name | |
| <a id="mtek-e2003"></a>E2003 | unknown name | related "did you mean" span when unambiguous; a rename edit when the renamed program checks (§6). For a member of a built-in enum or namespace (`Key.Up`, `sampler.trilinear`) a help names the nearest members and a note lists every member, and a name from another language (`null`, `Math`, `time`) gets a help with the Mtek form (decisions 0113 and 0115) |
| <a id="mtek-e2004"></a>E2004 | built-in hidden by local | calling a prelude function hidden by a local |
| <a id="mtek-e2005"></a>E2005 | parameter name used as namespace | e.g. param `color` used as `color.linear` |
| <a id="mtek-w2010"></a>W2010 | variable never reassigned | `var` could be `let` |
| <a id="mtek-e2020"></a>E2020 | constant cycle | full path |
| <a id="mtek-e2030"></a>E2030 | invalid import specifier | not `./`/`../`, missing `.mtek`, backslashes |
| <a id="mtek-e2031"></a>E2031 | import outside project root | |
| <a id="mtek-e2032"></a>E2032 | import path case mismatch | |
| <a id="mtek-e2033"></a>E2033 | name not exported | |
| <a id="mtek-e2034"></a>E2034 | package imports not supported | bare specifier |
| <a id="mtek-e2035"></a>E2035 | import cycle | full path |
| <a id="mtek-e2036"></a>E2036 | imported file not found | |

### 5.3 Types and values (`3xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e3001"></a>E3001 | type mismatch (general) | expected/actual set |
| <a id="mtek-e3002"></a>E3002 | wrong number of arguments | one signature of plain types: its parameters are in the message and a help names the missing or the extra arguments; several signatures: a note lists them (decision 0113) |
| <a id="mtek-e3003"></a>E3003 | unknown type | a note lists the built-in types; a type name of another language (`float`, `Vector3`) gets the Mtek spelling (decision 0115) |
| <a id="mtek-e3010"></a>E3010 | arithmetic on color | use `.rgb` |
| <a id="mtek-e3011"></a>E3011 | negation of unsigned value | |
| <a id="mtek-e3012"></a>E3012 | vector equality not supported | |
| <a id="mtek-e3013"></a>E3013 | invalid component or swizzle | a method-style call (`v.length()`) gets a help with the function and its signature (decision 0115) |
| <a id="mtek-e3014"></a>E3014 | operator not defined for operands | e.g. `string + string` |
| <a id="mtek-e3020"></a>E3020 | recursive struct | |
| <a id="mtek-e3021"></a>E3021 | missing struct field | |
| <a id="mtek-e3022"></a>E3022 | duplicate struct field | |
| <a id="mtek-e3023"></a>E3023 | unknown struct field | |
| <a id="mtek-e3030"></a>E3030 | constant index out of range | |
| <a id="mtek-e3031"></a>E3031 | invalid array length | |
| <a id="mtek-e3032"></a>E3032 | type nesting too deep | an array or struct type nested more than 256 levels (decision 0035) |
| <a id="mtek-e3040"></a>E3040 | constant evaluation overflow or division by zero | |
| <a id="mtek-e3041"></a>E3041 | literal not representable | |
| <a id="mtek-w3050"></a>W3050 | redundant conversion | |
| <a id="mtek-e3060"></a>E3060 | swizzle assignment not supported | |
| <a id="mtek-e3061"></a>E3061 | assignment to immutable place | |
| <a id="mtek-e3070"></a>E3070 | condition is not bool | |
| <a id="mtek-e3080"></a>E3080 | missing return | |
| <a id="mtek-w3081"></a>W3081 | unreachable code | |
| <a id="mtek-e3090"></a>E3090 | not a constant expression | |
| <a id="mtek-e3102"></a>E3102 | field or parameter type mismatch | schema/material field |
| <a id="mtek-e3201"></a>E3201 | non-exhaustive match | a `match` without `_` misses variants of its enum; the message lists them (decision 0129) |
| <a id="mtek-e3202"></a>E3202 | unreachable match arm | a variant matched twice, a pattern after `_`, or a `_` after every variant; a related span at the earlier pattern |
| <a id="mtek-e3203"></a>E3203 | match on a value that is not an enum | the scrutinee of `match` has another type; for a registry enum such as `Key` the message says a user enum is needed (decision 0177) |
| <a id="mtek-e3204"></a>E3204 | invalid match pattern | a pattern that is not `Enum.Variant` of the scrutinee's enum, or `_` |
| <a id="mtek-e3205"></a>E3205 | unknown enum variant | `Enum.Name` where the enum declares no `Name`; the nearest variant (help) and every variant (note) |
| <a id="mtek-e3206"></a>E3206 | match arms of different types | the arm values of a `match` expression; a related span at the first arm |
| <a id="mtek-e3210"></a>E3210 | timer block uses an enclosing variable | an `after`/`every` block reads or writes a `var` local of the body around it; the block runs later, when the `var` no longer exists (decision 0142). `let` locals, parameters and loop variables are captured with their value; state, `self` and constants are fine |
| <a id="mtek-e3211"></a>E3211 | invalid timer time | a constant delay of `after` that is negative or not finite, or a constant period of `every` that is not greater than 0 (decision 0142) |
| <a id="mtek-e3501"></a>E3501 | value cannot be interpolated | an interpolation `${expr}` in a string literal whose value is not a string, bool, i32, u32, f32, vec2, vec3 or vec4 (decision 0133) |
| <a id="mtek-e3502"></a>E3502 | invalid format spec | the format spec of `${expr:spec}` is not `.N` with one digit, or `.N` is given for a value that is not f32 or a vector (decision 0133) |

### 5.4 Functions, effects, stages (`4xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e4001"></a>E4001 | recursion not supported | call cycle in related spans |
| <a id="mtek-e4002"></a>E4002 | impure call from pure function | CPU calls or ambient frame/body reads, with the full call chain |
| <a id="mtek-w4003"></a>W4003 | `cpu fn` could be `fn` | |
| <a id="mtek-e4010"></a>E4010 | unbounded loop in GPU code | non-constant range bounds |
| <a id="mtek-e4011"></a>E4011 | CPU-only type in GPU code | `string`, handles |
| <a id="mtek-e4012"></a>E4012 | CPU-only intrinsic in GPU code | |
| <a id="mtek-e4013"></a>E4013 | GPU-only intrinsic in CPU code | `sample`, `lighting.pbr` called from CPU code |
| <a id="mtek-e4020"></a>E4020 | material without fragment stage | |
| <a id="mtek-e4021"></a>E4021 | invalid stage signature | |
| <a id="mtek-e4030"></a>E4030 | parameter type not GPU-representable | |
| <a id="mtek-e4031"></a>E4031 | invalid parameter default | |
| <a id="mtek-e4032"></a>E4032 | too many material parameters | > 64 |
| <a id="mtek-e4040"></a>E4040 | capture in GPU stage | scene state, `frame`, entity, `cpu fn` (help: add a param and `bind`); ambient CPU reads through helper calls; a texture or sampler constant (help: a param with the constant as its default) |
| <a id="mtek-e4041"></a>E4041 | invalid use of texture or sampler | only as `sample` arguments (decision 0054) |
| <a id="mtek-e4901"></a>E4901 | stage not supported | `vertex`/`compute` |

### 5.5 Scenes, schemas, ownership, bindings (`5xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e5001"></a>E5001 | unknown field | schema field not defined (message lists valid fields) |
| <a id="mtek-e5002"></a>E5002 | duplicate field | |
| <a id="mtek-e5003"></a>E5003 | missing required field | |
| <a id="mtek-e5004"></a>E5004 | `bind` not allowed here | field is not bindable or `bind` outside a field value |
| <a id="mtek-e5005"></a>E5005 | impure binding | `bind` expression calls `cpu` functions/intrinsics, or reads what no dependency kind covers (a camera field, a body property) |
| <a id="mtek-e5006"></a>E5006 | field value out of range | e.g. `Sphere { segments: 2 }` |
| <a id="mtek-e5010"></a>E5010 | camera has both target and rotation | |
| <a id="mtek-e5011"></a>E5011 | invalid camera projection | |
| <a id="mtek-e5012"></a>E5012 | scene has no camera | |
| <a id="mtek-e5013"></a>E5013 | ambiguous active camera | |
| <a id="mtek-e5014"></a>E5014 | unknown scene object kind | `lamp Main { … }`; v0.1 kinds: `camera` |
| <a id="mtek-e5015"></a>E5015 | set_camera target is not a camera | `set_camera` argument is not the name of a camera of this scene (decision 0154) |
| <a id="mtek-e5016"></a>E5016 | clip cannot play | `clip` names no playable channel of the entity's GLB mesh, the entity also writes a channel the clip writes, or a scale keyframe is not positive (decision 0156) |
| <a id="mtek-e5020"></a>E5020 | material without mesh | |
| <a id="mtek-e5030"></a>E5030 | named entity cannot be destroyed | `destroy(Cube)`, or `self` of a named entity (decision 0064) |
| <a id="mtek-e5040"></a>E5040 | unsupported prefab assembly operation | spawning a prefab with children, or a prefab instance nested inside another prefab (decision 0128) |
| <a id="mtek-e5041"></a>E5041 | missing prefab parameter | an instance leaves out a param without a default; one diagnostic per param, with the param's declaration as related span |
| <a id="mtek-e5042"></a>E5042 | prefab instance sets non-parameter | a name that is no param, or a member other than `name: value;`; a note lists the params |
| <a id="mtek-e5050"></a>E5050 | invalid lifecycle signature | |
| <a id="mtek-e5051"></a>E5051 | duplicate lifecycle function | |
| <a id="mtek-e5052"></a>E5052 | unknown lifecycle function | |
| <a id="mtek-e5060"></a>E5060 | unknown event | |
| <a id="mtek-e5061"></a>E5061 | invalid event arguments | not reported again for a filter that is already an error (`Key.Up` is only `E2003`; decision 0114) |
| <a id="mtek-e5062"></a>E5062 | collision event without collider | `on collision_enter` or `on collision_exit` in an entity or prefab that declares no `collider` (decision 0065) |
| <a id="mtek-e5070"></a>E5070 | write to bound field | related span at `bind` |
| <a id="mtek-e5071"></a>E5071 | write to physics-owned field | an assignment to the `position` or `rotation` of an entity with any body, or to a body velocity; names the allowed operation (decision 0065) |
| <a id="mtek-e5072"></a>E5072 | binding on physics-owned field | `bind` on the `position` or `rotation` of an entity or prefab with any body (decision 0065) |
| <a id="mtek-e5073"></a>E5073 | write to construction-only field | |
| <a id="mtek-e5074"></a>E5074 | field access through entity_ref | a write, or a read of anything but `position`, `rotation`, `scale` and `visible`, through a reference (decisions 0064 and 0151) |
| <a id="mtek-e5075"></a>E5075 | binding cycle | full path |
| <a id="mtek-e5080"></a>E5080 | lifecycle operation during initialisation | `spawn` or `destroy` in initialisers (decision 0064); a handler-only built-in function (`spawn`, `destroy`, a body command) called in a function (decision 0065) |
| <a id="mtek-e5081"></a>E5081 | entity field read during initialisation | includes body-property reads reached through helper calls |
| <a id="mtek-e5090"></a>E5090 | invalid scale | non-positive or non-finite constant |
| <a id="mtek-e5091"></a>E5091 | body on non-root entity | a body on a nested entity, or a static instance of a prefab with a body nested in an entity (decision 0065) |
| <a id="mtek-e5092"></a>E5092 | too many static entities | |
| <a id="mtek-e5100"></a>E5100 | non-opaque color in material parameter | **Reserved:** retired by decision 0138: material colours take any alpha, an alpha below 1 makes the draw translucent; the code is kept so that the number is not reused |
| <a id="mtek-w5101"></a>W5101 | fragment alpha ignored | constant alpha ≠ 1 |
| <a id="mtek-e5110"></a>E5110 | light in prefab | at the `light` member; the light is not part of the prefab's entity (decisions 0053, 0062) |
| <a id="mtek-e5111"></a>E5111 | too many lights | > 4 |
| <a id="mtek-e5120"></a>E5120 | collider without body | a `collider` on an entity or prefab that declares no `body`; help: `body: Static {}` for fixed geometry (decision 0065) |
| <a id="mtek-e5121"></a>E5121 | body without collider | a `body` without a `collider`; the body would have no shape |
| <a id="mtek-e5122"></a>E5122 | scaled dynamic or kinematic body | `scale` of a `Dynamic` or `Kinematic` body that is not the constant `vec3(1.0)` |
| <a id="mtek-e5123"></a>E5123 | command not valid for this body kind | `Name.body.<command>(..)` or `Name.body.<velocity>` that the entity's body kind does not support, or on an entity without a body |
| <a id="mtek-e5201"></a>E5201 | go_to target is not a scene | the argument of `go_to` is not the name of a scene of the program; a note lists the scenes (decision 0141) |
| <a id="mtek-e5202"></a>E5202 | shared state outside a scene | `shared state` in an entity or a prefab; only a scene's state carries over to another scene (decision 0141) |
| <a id="mtek-e5203"></a>E5203 | shared state of a type that cannot carry over | a `shared state` whose type holds an `entity_ref`, a resource or a descriptor, which belong to one scene (decision 0141) |
| <a id="mtek-e5204"></a>E5204 | shared state with different types | two scenes declare a `shared state` of the same name with different types; a related span at the other one (decision 0141) |
| <a id="mtek-e5210"></a>E5210 | persistent state outside a scene | `saved state` or `setting state` in an entity or a prefab; only a scene's state is kept in storage (decision 0145) |
| <a id="mtek-e5211"></a>E5211 | persistent state of a type that cannot be stored | a `saved state` or `setting state` whose type holds an `entity_ref`, a resource or a descriptor, which have no meaning in a later run (decision 0145) |
| <a id="mtek-e5212"></a>E5212 | persistent state with different types or kinds | two scenes declare a persistent state of the same name with different types, or one `saved` and the other `setting`; a related span at the other one (decisions 0145 and 0146) |
| <a id="mtek-e5220"></a>E5220 | invalid tag | the `tag` of an entity or prefab is not 1 to 32 lowercase letters, digits and `_` starting with a letter (decision 0150) |
| <a id="mtek-e5221"></a>E5221 | tag argument is not a string literal | the tag argument of `count_tagged`, `first_tagged`, `nearest_tagged`, `has_tag`, `tagged` or `destroy_tagged` is not a string constant (decision 0150) |
| <a id="mtek-e5222"></a>E5222 | unknown tag | no entity or prefab of the program declares the tag a tag built-in names; the help suggests the closest declared tag (decision 0150) |
| <a id="mtek-e5223"></a>E5223 | destroying a tag of a named entity | `destroy_tagged` names a tag that a named entity has, its own or its prefab's; a related span at the entity (decision 0150) |
| <a id="mtek-e5224"></a>E5224 | tagged entities outside a for loop | `tagged(tag)` is used other than as the iterable of a `for` loop (decision 0150) |
| <a id="mtek-e5230"></a>E5230 | scene outside the entry module | a `scene` declared in a module other than the entry module; the scenes of a program are checked and packaged as one set (decision 0178) |
| <a id="mtek-w5301"></a>W5301 | timer started every frame | an `after` or `every` that stands directly in an `update` or `fixed_update` body, not under an `if`, `match` or loop, so it starts one more timer each time the function runs; guard it with a state flag or start it in a handler (decision 0177) |
| <a id="mtek-e5401"></a>E5401 | scene change failed | run time: the scene of `go_to` or `reset()` could not be loaded or started (its module or manifest is missing or invalid); the current scene keeps running, the notes carry the underlying diagnostics (decision 0141) |
| <a id="mtek-w5402"></a>W5402 | saved data ignored | run time: a stored value is unreadable, of another type than the state now has, or of another shape; the state keeps its value, reported once per state (decision 0145) |
| <a id="mtek-w5403"></a>W5403 | saving failed | run time: the browser's storage refused the write (full or disabled), or the page has no usable `localStorage` and the values last only until it closes (decision 0145) |
| <a id="mtek-e5501"></a>E5501 | audio argument out of range | a constant volume of `play`, `play_at`, `play_music` or `set_volume` outside `0.0..=4.0`, or a constant pitch outside `0.0625..=16.0` (`spec/audio.md` §3) |
| <a id="mtek-e5601"></a>E5601 | HUD size out of range | a constant `size` argument of `hud.text` or `hud.button` outside 1.0 to 512.0 CSS pixels, or a constant `hud.rect` size component outside 0.0 to 8192.0 (decision 0134) |
| <a id="mtek-e5701"></a>E5701 | sprite sheet layout out of range | a constant `columns` or `rows` of a `Sprite` is outside 1..64 (decision 0170) |
| <a id="mtek-e5901"></a>E5901 | scene switching not supported | **Reserved:** retired by decision 0141: `go_to(Scene)` switches the active scene, so no program produces it; the code is kept so that the number is not reused |
| <a id="mtek-e5902"></a>E5902 | transparency not supported | **Reserved:** retired by decision 0138: materials are translucent when a colour param has an alpha below 1, so no program produces it; the code is kept so that the number is not reused |

### 5.6 GPU and target (`6xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e6001"></a>E6001 | parameter block too large | > 65 536 bytes |
| <a id="mtek-e6002"></a>E6002 | too many material resources | > 8 textures+samplers; reported by `check` at the ninth (decision 0054) |
| <a id="mtek-e6003"></a>E6003 | too many interpolated inputs | **Reserved:** > 16 inter-stage variables; v0.1 has no custom vertex stage and at most 4 (`spec/materials.md` §3.3), so the limit cannot be reached |
| <a id="mtek-e6100"></a>E6100 | generated WGSL failed validation | compiler bug; Naga message in notes |

### 5.7 Assets (`7xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e7001"></a>E7001 | unsupported container | not a binary glTF 2.0 container: `.gltf`, wrong magic or version, bad chunk layout, malformed JSON or structure (the message says which) |
| <a id="mtek-e7002"></a>E7002 | asset too large | file over `[assets] max_file_bytes` or JSON chunk over 16 MiB; checked before the data is read |
| <a id="mtek-e7003"></a>E7003 | external or data URI | a buffer or image has a `uri` (file or `data:`) |
| <a id="mtek-e7004"></a>E7004 | required extension | `extensionsRequired` is not empty; the message lists them |
| <a id="mtek-e7005"></a>E7005 | used extension | `extensionsUsed` or an `extensions` object is not empty; the message lists them |
| <a id="mtek-e7006"></a>E7006 | unsupported primitive mode | primitive `mode` is not 4 (TRIANGLES) |
| <a id="mtek-e7007"></a>E7007 | unsupported attribute format | attribute or index accessor is not in the supported format (normalised or non-float attributes) |
| <a id="mtek-e7008"></a>E7008 | skinning or morph targets | `JOINTS_n`, `WEIGHTS_n`, morph targets or morph weights |
| <a id="mtek-e7009"></a>E7009 | unsupported vertex attribute | `COLOR_0`, `TANGENT`, `TEXCOORD_1` and up, another unlisted attribute, or a texture reading `texCoord` 1 and up |
| <a id="mtek-e7010"></a>E7010 | mesh lacks required attribute | material reads `uv`/`world_normal` the mesh lacks; also a primitive without `POSITION` |
| <a id="mtek-e7011"></a>E7011 | sparse accessor | sparse accessor, or an accessor without a buffer view |
| <a id="mtek-e7012"></a>E7012 | mesh has several primitives | `.mesh(name)` on a mesh with several primitives; suggests `.primitive` |
| <a id="mtek-e7013"></a>E7013 | node transform not representable | world transform of a node has shear, a mirror, a zero scale or is not affine |
| <a id="mtek-e7014"></a>E7014 | index out of range | index at or beyond the vertex count, or an index count that is not a multiple of 3 |
| <a id="mtek-e7015"></a>E7015 | transparency in material | `alphaMode` is not OPAQUE, or the base colour alpha is not 1 |
| <a id="mtek-e7016"></a>E7016 | unsupported material feature | normal, occlusion, emissive or metallic-roughness texture, non-zero emissive factor, `doubleSided` |
| <a id="mtek-e7017"></a>E7017 | unsupported or oversized image | image is not PNG/JPEG, has no embedded bytes, is unreadable, exceeds `max_texture_dimension`, or is a JPEG with an EXIF orientation other than 1 (decision 0082) |
| <a id="mtek-e7018"></a>E7018 | unsupported sampler mode | MIRRORED_REPEAT, or wrap or filter modes that no sampler preset can express |
| <a id="mtek-e7019"></a>E7019 | animation present | a skin, a morph-weight channel, cubic-spline or any other interpolation, a path other than translation, rotation or scale, a duplicate animation name, or a channel with no keyframes or more than 4096 (decision 0156). LINEAR and STEP translation, rotation and scale are clips |
| <a id="mtek-e7020"></a>E7020 | asset file not found | the file named by an `asset.*` call does not exist or cannot be read (decision 0058) |
| <a id="mtek-e7021"></a>E7021 | asset path outside project | the path escapes the project root, is absolute or malformed |
| <a id="mtek-e7022"></a>E7022 | invalid use of asset value | a `glb_asset` outside a `const` and its accessors, or a path that is not a string literal |
| <a id="mtek-e7023"></a>E7023 | asset path case mismatch | the path differs from the file system entry in case |
| <a id="mtek-e7024"></a>E7024 | unknown name in asset | no mesh, material or node of that name, or the name is ambiguous; lists the names; a rename edit when one name is within edit distance 2 and the renamed program checks (§6) |
| <a id="mtek-e7025"></a>E7025 | accessor out of bounds | buffer view or accessor outside its buffer, bad stride or alignment, non-finite values |
| <a id="mtek-e7026"></a>E7026 | asset limit exceeded | more vertices than `max_vertices_per_primitive`, or packaged assets over `max_total_bytes` |
| <a id="mtek-e7030"></a>E7030 | asset fetch or integrity failure | runtime: fetch failed, length or SHA-256 mismatch (M4-06, decision 0060) |
| <a id="mtek-e7031"></a>E7031 | image decode failure | runtime: the browser could not decode the image (M4-06, decision 0060) |
| <a id="mtek-e7101"></a>E7101 | unsupported audio file | `asset.sound(path)` names a file that is not WAV (PCM or IEEE float), Ogg (Vorbis or Opus) or MP3, by extension or by content (`spec/audio.md` §2, decision 0130) |
| <a id="mtek-e7102"></a>E7102 | malformed audio file | the header of a WAV, Ogg or MP3 file is truncated or inconsistent (no `fmt `/`data` chunk, zero channels or sample rate, no Ogg page, no MPEG frame) (`spec/audio.md` §2) |
| <a id="mtek-e7103"></a>E7103 | invalid favicon | `mtek build --release` found `assets/favicon.svg`, `.png` or `.ico` whose content is not that format (PNG signature, ICO header, an `<svg` root) or that is larger than 1 MiB (`spec/tooling.md` §2.1, decision 0136) |
| <a id="mtek-e7104"></a>E7104 | game package exceeds itch.io limits | `mtek build --release --itch` would write a zip with more than 1000 files, more than 500 MB uncompressed, or a path longer than 240 characters, the HTML5 upload limits of itch.io (`spec/tooling.md` §2.1, decision 0136) |
| <a id="mtek-e7105"></a>E7105 | unsupported font file | `asset.font` names a file that is not `.ttf`, `.otf`, `.woff` or `.woff2` (decision 0139) |
| <a id="mtek-e7106"></a>E7106 | malformed font file | the bytes of an `asset.font` file do not match its extension, or its header is inconsistent (decision 0139) |
| <a id="mtek-e7901"></a>E7901 | remote assets not supported | an `http:`, `https:` or other URL as an asset path |
| <a id="mtek-e7902"></a>E7902 | node hierarchy instancing not supported | `model: asset` instancing a whole node hierarchy |
| (E7032–E7099) | further asset codes | reserved; added with the feature that needs them |

### 5.8 Runtime (`8xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e8001"></a>E8001 | unsupported platform endianness | |
| <a id="mtek-e8002"></a>E8002 | device below target profile | also: an asset image larger than the device's `maxTextureDimension2D` (decision 0060) |
| <a id="mtek-e8003"></a>E8003 | incompatible program | manifest/ABI/language version mismatch |
| <a id="mtek-e8004"></a>E8004 | WebGPU unavailable | no `navigator.gpu` |
| <a id="mtek-e8005"></a>E8005 | no suitable adapter | `requestAdapter()` returned null |
| <a id="mtek-e8006"></a>E8006 | manifest invalid | schema validation failed |
| <a id="mtek-e8011"></a>E8011 | invalid camera value | run-time write |
| <a id="mtek-w8030"></a>W8030 | index clamped | dev builds |
| <a id="mtek-e8030"></a>E8030 | named entity cannot be destroyed | via `entity_ref`; the call does nothing (decision 0064) |
| <a id="mtek-w8031"></a>W8031 | command for pending entity dropped | a body command for an entity that is pending removal, a pending spawn or a dead reference |
| <a id="mtek-w8032"></a>W8032 | entity already destroyed | `destroy` of a reference that is pending removal, stale or dead: no-op |
| <a id="mtek-e8033"></a>E8033 | entity limit reached | `spawn` returns a dead reference and creates nothing; the limit counts named, alive, pending-spawn and pending-removal entities |
| <a id="mtek-e8040"></a>E8040 | unknown host input | |
| <a id="mtek-e8041"></a>E8041 | host input has wrong type | |
| <a id="mtek-e8050"></a>E8050 | uncaptured GPU validation error | |
| <a id="mtek-e8051"></a>E8051 | shader or pipeline creation failed | mapped through span map |
| <a id="mtek-w8060"></a>W8060 | GPU device lost | recovery started |
| <a id="mtek-w8061"></a>W8061 | GPU device recovered | |
| <a id="mtek-e8062"></a>E8062 | GPU device recovery failed | |
| <a id="mtek-e8063"></a>E8063 | GPU allocation failed | |
| <a id="mtek-w8070"></a>W8070 | scene restarted on reload | names the forcing declaration |
| <a id="mtek-e8080"></a>E8080 | execution budget exceeded | a loop of a `--mode preview` build ran past the frame's loop budget (`manifest.preview.loopBudget`, default 10 million iterations): reported at the loop, the scene stops and the overlay shows it; during `init` the mount fails with the kind `budget-exceeded` (decision 0075) |
| <a id="mtek-e8090"></a>E8090 | invalid scale value | run-time write ignored |
| <a id="mtek-e8100"></a>E8100 | non-opaque color value | a host input with the `color-hex-opaque` codec rejected a colour with alpha (material param writes take any alpha since decision 0138) |
| <a id="mtek-e8101"></a>E8101 | command not valid for the target's body kind | a body command through an `entity_ref` (or a velocity read) whose body kind, or lack of a body, it does not support; the command is dropped and a read gives zero (decision 0066) |
| <a id="mtek-e8102"></a>E8102 | physics module failed to load | mount fails with the kind `physics-failed`; a reload whose physics module cannot load is refused (decision 0066) |
| <a id="mtek-e8103"></a>E8103 | non-finite pose produced by the solver | the body is frozen (taken out of the simulation, the entity keeps its last finite pose) and the code is reported once per body (decision 0066) |
| <a id="mtek-e8104"></a>E8104 | non-finite value given to a body | a body command with an argument that is not finite (a rotation of zero length counts), or a body whose initial pose is not finite; the command is dropped, the body is not created (decision 0066) |
| <a id="mtek-w8201"></a>W8201 | audio value clamped | runtime: a volume or pitch outside its range, or not finite, was given to an audio call; the nearest valid value is used (`spec/audio.md` §3) |
| <a id="mtek-w8202"></a>W8202 | sound could not be decoded | runtime: the browser could not decode a sound file; playing it does nothing and the program keeps running (`spec/audio.md` §5) |
| <a id="mtek-w8203"></a>W8203 | too many HUD items | runtime: a frame drew more than 512 `hud` items; the rest of that frame is not shown (reported once per call site, decision 0134) |
| <a id="mtek-w8204"></a>W8204 | font could not be loaded | the browser rejected an `asset.font` file when the HUD first used it; the text uses the default family (decision 0139) |
| <a id="mtek-w8205"></a>W8205 | too many timers | runtime: a scene already has 4096 live timers, and the timer a call site tried to start is not started; reported once per call site (decision 0177) |
| (E8105–E8199) | further physics runtime codes | reserved; added with the feature that needs them |

### 5.9 Project and internal (`9xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e9001"></a>E9001 | invalid project configuration | unknown key, wrong type in `mtek.toml` |
| <a id="mtek-e9002"></a>E9002 | too many modules | |
| <a id="mtek-w9003"></a>W9003 | further diagnostics suppressed | |
| <a id="mtek-e9004"></a>E9004 | project file not found | no `mtek.toml` |
| <a id="mtek-e9005"></a>E9005 | entry file not found | |
| <a id="mtek-e9006"></a>E9006 | entry scene not found or ambiguous | |
| <a id="mtek-e9010"></a>E9010 | not implemented by this compiler build | specified, not yet built |
| <a id="mtek-e9020"></a>E9020 | host input target not exposable | input target or output source: not scene state, or unsupported type |
| <a id="mtek-e9021"></a>E9021 | unknown host input target | also an unknown host output source |
| <a id="mtek-e9030"></a>E9030 | runtime bundle not embedded | CLI built with neither `packages/runtime-web/dist` nor the prebuilt runtime of `crates/mtek-cli/prebuilt` (decision 0131); also a program that uses physics built without `packages/physics-rapier/dist/physics.js` (decision 0063) |
| <a id="mtek-e9031"></a>E9031 | build output not written | `mtek build` could not write the output directory (I/O failure; exit code 3, the previous output stays in place; decision 0032) |
| <a id="mtek-e9032"></a>E9032 | compilation timed out | `mtek build --mode preview` did not finish within the compile time limit (10 s, a constant of the command line tool); no files are written (decision 0075) |
| <a id="mtek-e9999"></a>E9999 | internal compiler error | panic converted; asks for a report |

## 6. Suggested edits

A diagnostic may carry one **suggested edit**: a mechanical change, with a title, that repairs the program without anyone having to decide anything. It is the main way an agent or a language server repairs code locally, so the rules are strict: an edit that has not been proven is never attached.

### 6.1 The data model

```json
{
  "description": "write the float literal as `1.0`",
  "edits": [ { "file": "src/main.mtek", "startByte": 120, "endByte": 122, "replacement": "1.0" } ]
}
```

- `description` is the **title**: a short imperative phrase a user interface shows for the change (a code action title). It is never empty.
- `edits` is a non-empty list of **text edits**. `file` is the project path of the edited file (an edit may be in another file than the diagnostic's `source`: an imported module). `startByte` and `endByte` are a half-open byte range of that file as stored on disk (a byte-order mark included), the same offsets as every `source`; `replacement` is the text that takes the place of the range. An *insertion* has `startByte == endByte`. A text edit never deletes: a non-empty range has a non-empty replacement.
- All the edits of one suggestion are in **original offsets** and are applied together, in any order: the result is the original text with every range replaced. The edits of one suggestion do not overlap (two insertions at one offset count as overlapping, because their order would be ambiguous; an insertion at the start or end of a replaced range does not overlap it and comes before or after the replacement). A consumer maps the byte offsets to its own positions with the file's text (the language server uses 0-based lines and the negotiated columns, UTF-16 code units or UTF-8 bytes, and offers every attached edit as a quick fix, one `WorkspaceEdit` per suggestion: decision 0076 item 10).
- A diagnostic has **at most one** suggestion. Two or more candidate fixes mean the intent is ambiguous, and then there is none.
- The suggestions of different diagnostics of one report **never overlap**: where they would, only the first diagnostic in report order keeps its edit. Two edits that merely touch (one ends where the other starts, or an insertion sits at the start of a replaced range) do not overlap, and both are attached. Each suggestion is validated on its own (§6.3); applying several together is not re-checked.

### 6.2 What may be offered

An edit may be attached **only** if all of these hold:
1. It is mechanical: the intended program is unambiguous (e.g. `1.` → `1.0`, missing `;`, parenthesising a descriptor literal in a condition, renaming to the **single** in-scope candidate within edit distance 2 whose type fits).
2. The compiler has **re-checked** the project with the edit applied and the edit removes this diagnostic without introducing a new error (validated edits, blueprint §9.4; §6.3). The check runs on an in-memory copy.
3. It does not change meaning in a way the author did not write: no inserted conversions to make types fit (`f32(x)` when `x: i32` is a suggestion in `notes`, never an edit), no deleted code, no invented values.

Edits from different diagnostics never overlap; if they would, only the first (in report order) keeps its edit.

The codes that carry validated edits in v0.1, and what they offer:

| Code | The edit |
|---|---|
| `E0022` | write the malformed float literal with its missing digits: `1.` → `1.0`, `.5` → `0.5`, `1e3` → `1.0e3` |
| `E1003` | insert the missing `;` |
| `E1011` | parenthesise the descriptor literal that is the condition of `if` or the iterable of `for` |
| `E2003` | replace the unknown name (for a member of a built-in namespace or enum, the member) by the single visible name within edit distance 2; none if two names are that close. For a member of a built-in namespace or enum the closest tier decides: the same name in another letter case, then names within edit distance 2 that is less than half the length of the longer name (`U` is not a typo of `Up`), then the members that contain the written name (`Up` for `ArrowUp`, `Esc` for `Escape`); the edit is offered only when that tier has exactly one member (`Shift` is both `ShiftLeft` and `ShiftRight`: none) (decision 0113) |
| `E7024` | replace the string literal naming a mesh, material or node of a glTF file by the single name of the file within edit distance 2 |

No other code carries an edit. In particular `E3003`, `E5001`, `E3023`, `E5042` and the other "did you mean" hints are hints only (renaming a type or a field is as mechanical, but it is not wired yet); a conversion, a deleted declaration or a guessed value (`E3001`, `E3102`, `E3041`) is never an edit.

### 6.3 Validation

Reporting stages only *propose*. When the report is finished, every proposal is judged once, by the same procedure for every code:

1. **Well-formed**: a title, at least one edit, no deletion, edits inside the file, on character boundaries and not overlapping each other, and not overlapping the edits already attached to earlier diagnostics (§6.1).
2. **Re-check**: the front end (load, lex, parse, resolve, type-check, scenes, assets, effects: every stage that reports a code of the table above) runs again on a copy of the project in which the edited files have their new contents. Nothing on disk changes.
3. **Compare**: diagnostics are compared by severity, code, file and message (byte offsets move with the edit and are left out). The edit is attached only if the diagnostic has disappeared (one fewer of its kind) and every error of the copy is also an error of the unedited project (at most as often). An edit may remove other errors too, but must not add one.

The comparison is conservative; it rejects an edit when it cannot prove it:

- An error that the parser's recovery had hidden, because it reports at most one syntax error per three tokens, counts as new when the edit reveals it. Two missing semicolons in a row therefore get no edit until one is written by hand.
- When diagnostics were suppressed (`W9003`, more than 200 in a file), no edit is attached: a suppressed error could hide a new one.
- At most 32 proposals per report are re-checked, in report order; later ones get no edit. Each re-check is a whole front-end run.
- Errors of the emit stage (`mtek build`) are not part of the comparison: `check` does not report them either, and the stage does not run while the front end has errors.

`mtek check`, `mtek build` and `mtek inspect` attach edits the same way. `crates/mtek-compiler/src/edits.rs` is the single implementation, `crates/mtek-compiler/tests/suggested_edits.rs` re-proves every edit of every fixture with a separate re-check, and the fixtures `tests/semantics/fail/edits_*` and `tests/assets/fail/e7024_*` assert both the edits and their absence (decision 0071).

## 7. Writing messages (rules for implementers)

- Name the construct and the specific entity: "Material parameter 'phase' expects f32, but received vec3." not "type error". A diagnostic about the inside of a file (an asset) names the file, in the message or in a note.
- Prefer Mtek vocabulary (`entity`, `param`, `bind`) over compiler internals (`DefId`, `NodeId`, WGSL).
- For unsupported features, say "not supported in v0.1" and, if planned, "planned for v0.2".
- Never blame the user for compiler defects: `E6100`/`E9999` say "this is a compiler bug".
- Every message has a negative fixture asserting code, primary span and message text (`spec/testing.md` §3.2).
- A message is one complete sentence: it starts with a capital letter, a name in quotes or a code span (never a lowercase word), ends with a full stop, has no line break and no stray spaces, and is more specific than the catalogue `title`. A `help:` note continues in lowercase.
- A diagnostic says what to write instead where a finite set or a usual idiom exists (decision 0113): the message carries the parameters of a single signature; an unknown member of a built-in enum or namespace gets the nearest members (help) and every member (note); a construct that Mtek does not have gets a help with the way to express the intent. The advice names only forms that check; each class has a fixture, and a mechanical advice is an edit only when §6 proves it.
- A consequence of a reported error is not reported again (decision 0114): a filter, a local or a statement whose only fault is the error already reported on the same token or call carries no diagnostic of its own.
- A diagnostic about a name or a type that comes from a declaration of the program points at that declaration with a related span: the first of two duplicates, the opener of an unclosed delimiter, the declaration of the param, struct, function or annotation the expectation comes from. Built-in declarations have no source text and no related span.

`crates/mtek-compiler/tests/diagnostics_audit.rs` checks the mechanical part of these rules over every diagnostic of every golden file, and the wording of internal errors over the sources.
