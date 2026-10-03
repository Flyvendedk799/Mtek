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
| `source` | yes except for project-level diagnostics without a file (then `null`) | primary location. Bytes are offsets into the file **as stored on disk**, half-open. Lines/columns are 1-based; columns count Unicode scalar values. |
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
Same shape; `phase` is `runtime:mount`, `runtime:input`, `runtime:tick`, `runtime:update`, `runtime:bindings`, `runtime:render`, `runtime:reload` or `runtime:device`; `source` resolved through the manifest `spans` table (`spec/runtime-abi.md` §12). Delivered through `onDiagnostic` as JavaScript objects of exactly this shape (TypeScript type `MtekDiagnostic` in the runtime).

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
Colour only when stdout is a TTY and `NO_COLOR` is unset. Tabs render as 4 spaces for caret alignment. Lines longer than 160 columns are elided around the span.

## 5. Catalogue (v0.1)

Severity letter is part of the code. "Fixture" means at least one negative fixture must exist before the related feature is reported as supported.

### 5.0 Source and lexical (`0xxx`)
| Code | Title | Trigger |
|---|---|---|
| E0001 | invalid UTF-8 | file is not valid UTF-8 |
| E0002 | misplaced byte-order mark | BOM not at file start |
| E0003 | lone carriage return | `\r` not followed by `\n` |
| E0004 | file too large | > 4 MiB |
| E0005 | invalid character | disallowed whitespace/control character outside strings and comments |
| E0006 | unterminated block comment | |
| W0007 | dangling doc comment | `///` not followed by a documentable declaration |
| E0010 | non-ASCII identifier | Unicode identifiers not in v0.1 |
| E0011 | reserved identifier prefix | identifier starts with `__` |
| E0012 | reserved identifier `_` | |
| E0013 | reserved word | identifier is a word reserved for future use |
| E0020 | leading zero in integer literal | |
| E0021 | unsupported numeric literal form | hexadecimal, binary, octal, suffix, separators |
| E0022 | malformed float literal | `1.`, `.5`, `1e3` (edit offered) |
| E0023 | invalid escape sequence | |
| E0024 | unterminated string | |
| E0025 | malformed color literal | not 6 or 8 hex digits |
| W0030 | naming convention | (lint) |

### 5.1 Syntax (`1xxx`)
| Code | Title | Trigger |
|---|---|---|
| E1001 | unexpected token | generic; message lists expected tokens |
| E1002 | unclosed delimiter | missing `}`/`)`/`]`; related span at the opener |
| E1003 | missing semicolon | statement/field/member requires `;` (edit offered) |
| E1004 | unexpected end of file | |
| E1010 | chained comparison | `a < b < c`, `a == b == c` |
| E1011 | descriptor literal in condition | parenthesise (edit offered) |
| E1020 | unused expression | non-call expression statement |
| E1030 | `break`/`continue` outside loop | |
| E1040 | member not allowed here | e.g. `fn` inside a scene |
| E1050 | nesting too deep | > 256 |
| E1901 | bitwise operators not supported | v0.1 |

### 5.2 Names and modules (`2xxx`)
| Code | Title | Trigger |
|---|---|---|
| E2001 | shadowed name | declaration hides a visible name |
| E2002 | duplicate name | |
| E2003 | unknown name | related "did you mean" span when unambiguous |
| E2004 | built-in hidden by local | calling a prelude function hidden by a local |
| E2005 | parameter name used as namespace | e.g. param `color` used as `color.linear` |
| W2010 | variable never reassigned | `var` could be `let` |
| E2020 | constant cycle | full path |
| E2030 | invalid import specifier | not `./`/`../`, missing `.mtek`, backslashes |
| E2031 | import outside project root | |
| E2032 | import path case mismatch | |
| E2033 | name not exported | |
| E2034 | package imports not supported | bare specifier |
| E2035 | import cycle | full path |
| E2036 | imported file not found | |

### 5.3 Types and values (`3xxx`)
| Code | Title | Trigger |
|---|---|---|
| E3001 | type mismatch (general) | expected/actual set |
| E3002 | wrong number of arguments | |
| E3003 | unknown type | |
| E3010 | arithmetic on color | use `.rgb` |
| E3011 | negation of unsigned value | |
| E3012 | vector equality not supported | |
| E3013 | invalid component or swizzle | |
| E3014 | operator not defined for operands | e.g. `string + string` |
| E3020 | recursive struct | |
| E3021 | missing struct field | |
| E3022 | duplicate struct field | |
| E3023 | unknown struct field | |
| E3030 | constant index out of range | |
| E3031 | invalid array length | |
| E3040 | constant evaluation overflow or division by zero | |
| E3041 | literal not representable | |
| W3050 | redundant conversion | |
| E3060 | swizzle assignment not supported | |
| E3061 | assignment to immutable place | |
| E3070 | condition is not bool | |
| E3080 | missing return | |
| W3081 | unreachable code | |
| E3090 | not a constant expression | |
| E3102 | field or parameter type mismatch | schema/material field |

### 5.4 Functions, effects, stages (`4xxx`)
| Code | Title | Trigger |
|---|---|---|
| E4001 | recursion not supported | call cycle in related spans |
| E4002 | impure call from pure function | full call chain |
| W4003 | `cpu fn` could be `fn` | |
| E4010 | unbounded loop in GPU code | non-constant range bounds |
| E4011 | CPU-only type in GPU code | `string`, handles |
| E4012 | CPU-only intrinsic in GPU code | |
| E4013 | GPU-only intrinsic in CPU code | `sample`, `lighting.pbr` called from CPU code |
| E4020 | material without fragment stage | |
| E4021 | invalid stage signature | |
| E4030 | parameter type not GPU-representable | |
| E4031 | invalid parameter default | |
| E4032 | too many material parameters | > 64 |
| E4040 | capture in GPU stage | scene state, `frame`, entity, `cpu fn` (help: add a param and `bind`) |
| E4041 | invalid use of texture or sampler | only as `sample` arguments |
| E4901 | stage not supported | `vertex`/`compute` |

### 5.5 Scenes, schemas, ownership, bindings (`5xxx`)
| Code | Title | Trigger |
|---|---|---|
| E5001 | unknown field | schema field not defined (message lists valid fields) |
| E5002 | duplicate field | |
| E5003 | missing required field | |
| E5004 | `bind` not allowed here | field is not bindable or `bind` outside a field value |
| E5005 | impure binding | `bind` expression calls `cpu` functions/intrinsics |
| E5006 | field value out of range | e.g. `Sphere { segments: 2 }` |
| E5010 | camera has both target and rotation | |
| E5011 | invalid camera projection | |
| E5012 | scene has no camera | |
| E5013 | ambiguous active camera | |
| E5014 | unknown scene object kind | `lamp Main { … }`; v0.1 kinds: `camera` |
| E5020 | material without mesh | |
| E5030 | named entity cannot be destroyed | |
| E5040 | prefab cannot contain entities | |
| E5041 | missing prefab parameter | |
| E5042 | prefab instance sets non-parameter | |
| E5050 | invalid lifecycle signature | |
| E5051 | duplicate lifecycle function | |
| E5052 | unknown lifecycle function | |
| E5060 | unknown event | |
| E5061 | invalid event arguments | |
| E5062 | collision event without collider | |
| E5070 | write to bound field | related span at `bind` |
| E5071 | write to physics-owned field | names the allowed operation |
| E5072 | binding on physics-owned field | |
| E5073 | write to construction-only field | |
| E5074 | field access through entity_ref | not in v0.1 |
| E5075 | binding cycle | full path |
| E5080 | lifecycle operation during initialisation | `spawn` in initialisers |
| E5081 | entity field read during initialisation | |
| E5090 | invalid scale | non-positive or non-finite constant |
| E5091 | body on non-root entity | |
| E5092 | too many static entities | |
| E5100 | non-opaque color in material parameter | |
| W5101 | fragment alpha ignored | constant alpha ≠ 1 |
| E5110 | light in prefab | |
| E5111 | too many lights | > 4 |
| E5901 | scene switching not supported | switching the active scene at run time |
| E5902 | transparency not supported | |

### 5.6 GPU and target (`6xxx`)
| Code | Title | Trigger |
|---|---|---|
| E6001 | parameter block too large | > 65 536 bytes |
| E6002 | too many material resources | > 8 textures+samplers |
| E6003 | too many interpolated inputs | > 16 inter-stage variables |
| E6100 | generated WGSL failed validation | compiler bug; Naga message in notes |

### 5.7 Assets (`7xxx`)
| Code | Title | Trigger |
|---|---|---|
| E7010 | mesh lacks required attribute | material reads `uv`/`world_normal` the mesh lacks |
| (E7001–E7099) | further asset codes | defined in `spec/assets.md` §8 and added to this table in M4 |

### 5.8 Runtime (`8xxx`)
| Code | Title | Trigger |
|---|---|---|
| E8001 | unsupported platform endianness | |
| E8002 | device below target profile | |
| E8003 | incompatible program | manifest/ABI/language version mismatch |
| E8004 | WebGPU unavailable | no `navigator.gpu` |
| E8005 | no suitable adapter | `requestAdapter()` returned null |
| E8006 | manifest invalid | schema validation failed |
| E8011 | invalid camera value | run-time write |
| W8030 | index clamped | dev builds |
| E8030 | named entity cannot be destroyed | via `entity_ref` |
| W8031 | command for pending entity dropped | |
| W8032 | entity already destroyed | |
| E8033 | entity limit reached | |
| E8040 | unknown host input | |
| E8041 | host input has wrong type | |
| E8050 | uncaptured GPU validation error | |
| E8051 | shader or pipeline creation failed | mapped through span map |
| W8060 | GPU device lost | recovery started |
| W8061 | GPU device recovered | |
| E8062 | GPU device recovery failed | |
| E8063 | GPU allocation failed | |
| W8070 | scene restarted on reload | names the forcing declaration |
| E8080 | execution budget exceeded | untrusted preview (M6) |
| E8090 | invalid scale value | run-time write ignored |
| E8100 | non-opaque color value | run-time value rejected |
| (E8101–E8199) | physics runtime codes | defined in `spec/physics.md` §8 |

### 5.9 Project and internal (`9xxx`)
| Code | Title | Trigger |
|---|---|---|
| E9001 | invalid project configuration | unknown key, wrong type in `mtek.toml` |
| E9002 | too many modules | |
| W9003 | further diagnostics suppressed | |
| E9004 | project file not found | no `mtek.toml` |
| E9005 | entry file not found | |
| E9006 | entry scene not found or ambiguous | |
| E9010 | not implemented by this compiler build | specified, not yet built |
| E9020 | host input target not exposable | not scene state, or unsupported type |
| E9021 | unknown host input target | |
| E9030 | runtime bundle not embedded | CLI built without `packages/runtime-web/dist` |
| E9999 | internal compiler error | panic converted; asks for a report |

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
