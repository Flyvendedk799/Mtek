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
| `suggestedEdits` | yes (may be empty) | validated edits only (§6) |
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
| <a id="mtek-w0030"></a>W0030 | naming convention | (lint) |

### 5.1 Syntax (`1xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e1001"></a>E1001 | unexpected token | generic; message lists expected tokens |
| <a id="mtek-e1002"></a>E1002 | unclosed delimiter | missing `}`/`)`/`]`; related span at the opener |
| <a id="mtek-e1003"></a>E1003 | missing semicolon | statement/field/member requires `;` (edit offered) |
| <a id="mtek-e1004"></a>E1004 | unexpected end of file | |
| <a id="mtek-e1010"></a>E1010 | chained comparison | `a < b < c`, `a == b == c` |
| <a id="mtek-e1011"></a>E1011 | descriptor literal in condition | parenthesise (edit offered) |
| <a id="mtek-e1020"></a>E1020 | unused expression | non-call expression statement |
| <a id="mtek-e1030"></a>E1030 | `break`/`continue` outside loop | |
| <a id="mtek-e1040"></a>E1040 | member not allowed here | e.g. `fn` inside a scene |
| <a id="mtek-e1050"></a>E1050 | nesting too deep | > 256 levels (decision 0022: also a chain of operators that makes an expression tree taller than that) |
| <a id="mtek-e1901"></a>E1901 | bitwise operators not supported | v0.1 |

### 5.2 Names and modules (`2xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e2001"></a>E2001 | shadowed name | declaration hides a visible name |
| <a id="mtek-e2002"></a>E2002 | duplicate name | |
| <a id="mtek-e2003"></a>E2003 | unknown name | related "did you mean" span when unambiguous |
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
| <a id="mtek-e3002"></a>E3002 | wrong number of arguments | |
| <a id="mtek-e3003"></a>E3003 | unknown type | |
| <a id="mtek-e3010"></a>E3010 | arithmetic on color | use `.rgb` |
| <a id="mtek-e3011"></a>E3011 | negation of unsigned value | |
| <a id="mtek-e3012"></a>E3012 | vector equality not supported | |
| <a id="mtek-e3013"></a>E3013 | invalid component or swizzle | |
| <a id="mtek-e3014"></a>E3014 | operator not defined for operands | e.g. `string + string` |
| <a id="mtek-e3020"></a>E3020 | recursive struct | |
| <a id="mtek-e3021"></a>E3021 | missing struct field | |
| <a id="mtek-e3022"></a>E3022 | duplicate struct field | |
| <a id="mtek-e3023"></a>E3023 | unknown struct field | |
| <a id="mtek-e3030"></a>E3030 | constant index out of range | |
| <a id="mtek-e3031"></a>E3031 | invalid array length | |
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

### 5.4 Functions, effects, stages (`4xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e4001"></a>E4001 | recursion not supported | call cycle in related spans |
| <a id="mtek-e4002"></a>E4002 | impure call from pure function | full call chain |
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
| <a id="mtek-e4040"></a>E4040 | capture in GPU stage | scene state, `frame`, entity, `cpu fn` (help: add a param and `bind`) |
| <a id="mtek-e4041"></a>E4041 | invalid use of texture or sampler | only as `sample` arguments |
| <a id="mtek-e4901"></a>E4901 | stage not supported | `vertex`/`compute` |

### 5.5 Scenes, schemas, ownership, bindings (`5xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e5001"></a>E5001 | unknown field | schema field not defined (message lists valid fields) |
| <a id="mtek-e5002"></a>E5002 | duplicate field | |
| <a id="mtek-e5003"></a>E5003 | missing required field | |
| <a id="mtek-e5004"></a>E5004 | `bind` not allowed here | field is not bindable or `bind` outside a field value |
| <a id="mtek-e5005"></a>E5005 | impure binding | `bind` expression calls `cpu` functions/intrinsics |
| <a id="mtek-e5006"></a>E5006 | field value out of range | e.g. `Sphere { segments: 2 }` |
| <a id="mtek-e5010"></a>E5010 | camera has both target and rotation | |
| <a id="mtek-e5011"></a>E5011 | invalid camera projection | |
| <a id="mtek-e5012"></a>E5012 | scene has no camera | |
| <a id="mtek-e5013"></a>E5013 | ambiguous active camera | |
| <a id="mtek-e5014"></a>E5014 | unknown scene object kind | `lamp Main { … }`; v0.1 kinds: `camera` |
| <a id="mtek-e5020"></a>E5020 | material without mesh | |
| <a id="mtek-e5030"></a>E5030 | named entity cannot be destroyed | |
| <a id="mtek-e5040"></a>E5040 | prefab cannot contain entities | |
| <a id="mtek-e5041"></a>E5041 | missing prefab parameter | |
| <a id="mtek-e5042"></a>E5042 | prefab instance sets non-parameter | |
| <a id="mtek-e5050"></a>E5050 | invalid lifecycle signature | |
| <a id="mtek-e5051"></a>E5051 | duplicate lifecycle function | |
| <a id="mtek-e5052"></a>E5052 | unknown lifecycle function | |
| <a id="mtek-e5060"></a>E5060 | unknown event | |
| <a id="mtek-e5061"></a>E5061 | invalid event arguments | |
| <a id="mtek-e5062"></a>E5062 | collision event without collider | |
| <a id="mtek-e5070"></a>E5070 | write to bound field | related span at `bind` |
| <a id="mtek-e5071"></a>E5071 | write to physics-owned field | names the allowed operation |
| <a id="mtek-e5072"></a>E5072 | binding on physics-owned field | |
| <a id="mtek-e5073"></a>E5073 | write to construction-only field | |
| <a id="mtek-e5074"></a>E5074 | field access through entity_ref | not in v0.1 |
| <a id="mtek-e5075"></a>E5075 | binding cycle | full path |
| <a id="mtek-e5080"></a>E5080 | lifecycle operation during initialisation | `spawn` in initialisers |
| <a id="mtek-e5081"></a>E5081 | entity field read during initialisation | |
| <a id="mtek-e5090"></a>E5090 | invalid scale | non-positive or non-finite constant |
| <a id="mtek-e5091"></a>E5091 | body on non-root entity | |
| <a id="mtek-e5092"></a>E5092 | too many static entities | |
| <a id="mtek-e5100"></a>E5100 | non-opaque color in material parameter | |
| <a id="mtek-w5101"></a>W5101 | fragment alpha ignored | constant alpha ≠ 1 |
| <a id="mtek-e5110"></a>E5110 | light in prefab | |
| <a id="mtek-e5111"></a>E5111 | too many lights | > 4 |
| <a id="mtek-e5901"></a>E5901 | scene switching not supported | switching the active scene at run time |
| <a id="mtek-e5902"></a>E5902 | transparency not supported | |

### 5.6 GPU and target (`6xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e6001"></a>E6001 | parameter block too large | > 65 536 bytes |
| <a id="mtek-e6002"></a>E6002 | too many material resources | > 8 textures+samplers |
| <a id="mtek-e6003"></a>E6003 | too many interpolated inputs | > 16 inter-stage variables |
| <a id="mtek-e6100"></a>E6100 | generated WGSL failed validation | compiler bug; Naga message in notes |

### 5.7 Assets (`7xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e7010"></a>E7010 | mesh lacks required attribute | material reads `uv`/`world_normal` the mesh lacks |
| (E7001–E7099) | further asset codes | defined in `spec/assets.md` §8 and added to this table in M4 |

### 5.8 Runtime (`8xxx`)
| Code | Title | Trigger |
|---|---|---|
| <a id="mtek-e8001"></a>E8001 | unsupported platform endianness | |
| <a id="mtek-e8002"></a>E8002 | device below target profile | |
| <a id="mtek-e8003"></a>E8003 | incompatible program | manifest/ABI/language version mismatch |
| <a id="mtek-e8004"></a>E8004 | WebGPU unavailable | no `navigator.gpu` |
| <a id="mtek-e8005"></a>E8005 | no suitable adapter | `requestAdapter()` returned null |
| <a id="mtek-e8006"></a>E8006 | manifest invalid | schema validation failed |
| <a id="mtek-e8011"></a>E8011 | invalid camera value | run-time write |
| <a id="mtek-w8030"></a>W8030 | index clamped | dev builds |
| <a id="mtek-e8030"></a>E8030 | named entity cannot be destroyed | via `entity_ref` |
| <a id="mtek-w8031"></a>W8031 | command for pending entity dropped | |
| <a id="mtek-w8032"></a>W8032 | entity already destroyed | |
| <a id="mtek-e8033"></a>E8033 | entity limit reached | |
| <a id="mtek-e8040"></a>E8040 | unknown host input | |
| <a id="mtek-e8041"></a>E8041 | host input has wrong type | |
| <a id="mtek-e8050"></a>E8050 | uncaptured GPU validation error | |
| <a id="mtek-e8051"></a>E8051 | shader or pipeline creation failed | mapped through span map |
| <a id="mtek-w8060"></a>W8060 | GPU device lost | recovery started |
| <a id="mtek-w8061"></a>W8061 | GPU device recovered | |
| <a id="mtek-e8062"></a>E8062 | GPU device recovery failed | |
| <a id="mtek-e8063"></a>E8063 | GPU allocation failed | |
| <a id="mtek-w8070"></a>W8070 | scene restarted on reload | names the forcing declaration |
| <a id="mtek-e8080"></a>E8080 | execution budget exceeded | untrusted preview (M6) |
| <a id="mtek-e8090"></a>E8090 | invalid scale value | run-time write ignored |
| <a id="mtek-e8100"></a>E8100 | non-opaque color value | run-time value rejected |
| (E8101–E8199) | physics runtime codes | defined in `spec/physics.md` §8 |

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
| <a id="mtek-e9020"></a>E9020 | host input target not exposable | not scene state, or unsupported type |
| <a id="mtek-e9021"></a>E9021 | unknown host input target | |
| <a id="mtek-e9030"></a>E9030 | runtime bundle not embedded | CLI built without `packages/runtime-web/dist` |
| <a id="mtek-e9999"></a>E9999 | internal compiler error | panic converted; asks for a report |

## 6. Suggested edits

```json
{ "description": "use a float literal", "edits": [ { "file": "src/main.mtek", "startByte": 120, "endByte": 122, "replacement": "1.0" } ] }
```

An edit may be attached **only** if all of these hold:
1. It is mechanical: the intended program is unambiguous (e.g. `1.` → `1.0`, missing `;`, parenthesising a descriptor literal in a condition, renaming to the **single** in-scope candidate within edit distance 2 whose type fits).
2. The compiler has **re-checked** the file with the edit applied and the edit removes this diagnostic without introducing a new error (validated edits, blueprint §9.4). The check runs on an in-memory copy.
3. It does not change meaning in a way the author did not write: no inserted conversions to make types fit (`f32(x)` when `x: i32` is a suggestion in `notes`, never an edit), no deleted code, no invented values.

Edits from different diagnostics never overlap; if they would, only the first (in report order) keeps its edit.

## 7. Writing messages (rules for implementers)

- Name the construct and the specific entity: "Material parameter 'phase' expects f32, but received vec3." not "type error".
- Prefer Mtek vocabulary (`entity`, `param`, `bind`) over compiler internals (`DefId`, `NodeId`, WGSL).
- For unsupported features, say "not supported in v0.1" and, if planned, "planned for v0.2".
- Never blame the user for compiler defects: `E6100`/`E9999` say "this is a compiler bug".
- Every message has a negative fixture asserting code, primary span and message text (`spec/testing.md` §3.2).
