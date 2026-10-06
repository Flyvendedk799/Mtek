# 0047. CPU/GPU numeric agreement: WGSL's conversion clamp everywhere and CPU-order helpers (owner decision)

- Status: Accepted
- Date: 2026-10-05
- Blueprint origin: §4.1 (numeric semantics), §12.1 (CPU/GPU tests), §14 (do not weaken tests casually); `spec/testing.md` §5; `spec/language.md` §6.4–§6.5; WGSL §15.7.2–§15.7.6 and §17.5.
- Supersedes: decision 0037 item 6 for `f2i`/`f2u` (the clamp targets) and for `normalize` (non-portable on the GPU); decision 0043 items 8 and 9 (both were open questions); the `knownDeviations` row of 0043 item 7.

## Context

Decision 0043 measured two places where the GPU and the CPU disagree although no transcendental function is involved, and asked the owner (items 8 and 9). The owner answered on 2026-10-05 with the most ambitious option for both: **A.** the CPU takes WGSL's saturation for out-of-range `f32 → i32/u32`; **B.** the shader lowering uses helpers in the CPU's operation order wherever that makes the GPU agree bit for bit. Item 1 and the aim of B are the owner's decisions (external constraints); the evidence rule, the helper shapes and the row classes are **proposals** (design choices).

## Decision

1. **A: one conversion rule.** `i32(x)` and `u32(x)` of an `f32` truncate toward zero and, out of range, give the value of the integer type closest to the truncated value that an `f32` also represents exactly (WGSL §15.7.6): `[-2147483648, 2147483520]` and `[0, 4294967040]`. Infinities saturate the same way; NaN gives `0` on the CPU and stays non-portable on the GPU. `rt.f2i`/`f2u`, the constant folder (`types/value.rs`, `f32_to_i32`/`f32_to_u32`) and the Rust oracle implement it; `tests/semantics/numeric/cpu.json` (6 rows: `i32_from_f32#9`, `#11`, `#13`, `u32_from_f32#8`, `#9`, `#10`), `tests/codegen/numeric_cpu_table/exec.json` and the hand-written `tests/codegen/cpu_functions/exec.json` were re-blessed and reviewed: exactly those rows changed. The four rows that were `spec-disagreement` are bit-exact on hardware and on SwiftShader; the status and the `cpuDiffersFromWgsl` list stay in the harness and are now empty. `spec/language.md` §6.5 says so.

2. **B: two helpers, chosen by evidence.** A helper is emitted only where it brings the GPU closer to the CPU on the measured adapters (AMD Radeon RX 7900 XTX through D3D12, and SwiftShader), because WGSL lets an implementation fuse, reassociate and flush, and a driver may rewrite a helper into the same instruction as the built-in. Only the helpers a material uses are emitted (`lowering/shader/helpers.rs`):
   - **`mtek_mix_f32`, `mtek_mix_vec2/3/4` and the `_f32` forms** (a vector with an `f32` weight): `a * (1.0 - t) + b * t`, the order of decision 0037 item 7. The backends evaluate the built-in as `x + t * (y - x)`, which overflows near the largest floats (`mix_f32#7` was `-Infinity`). Now all 14 rows are bit-identical on both adapters and `mix` is an `exact` entry; its known deviation is gone.
   - **`mtek_normalize_vec2/3/4`**: `v / sqrt(v.x*v.x + v.y*v.y + ...)` (squares summed left to right) and the zero vector when that length is `0`, as the CPU does. The built-in is `v * inverseSqrt(...)` and undefined for the zero vector. A zero vector, a vector whose squared length underflows and one whose squared length overflows give the zero vector on the CPU and on both adapters, so those nine rows are no longer non-portable: `cpu.json` marks them portable and `tolerances.json` lists them in `exactRows` (compared bit for bit although `normalize` is a tolerance entry and the rows are outside the WGSL domain). `spec/stdlib.md`, `spec/language.md` §6.4 and `spec/testing.md` say so; NaN and infinite components stay non-portable.
   - A helper family has no single `helper` name, so `tolerances.json` gives it `helperFamily` and the conformance spec checks that every compiled `mtek_mix_*` and `mtek_normalize_*` body is the expression above; `helpers.rs` has the matching unit test and Naga validates every helper.

3. **The audit.** Before any helper, the report of the hardware and the software run was read per tolerance entry (rows compared, rows bit-identical to the CPU on each adapter), and the same after.

   | Built-in | Bit-identical rows (hardware / SwiftShader) | Decision |
   |---|---|---|
   | `smoothstep` | 10/10, 10/10 | built-in kept; already identical |
   | `dot`, `length`, `distance`, `cross`, `reflect` (scalar and vector forms) | all rows, both adapters | built-in kept |
   | `sqrt`, `inverse_sqrt`, `radians` | all rows, both adapters | built-in kept |
   | `step`, `clamp`, `abs`, `min`, `max`, `saturate`, `sign` | exact entries; differences only the permitted ones (zero sign: 9 hardware rows of `min`, `max`, `saturate`; flush to zero: 6 rows of `sign` and others) | built-in kept: a compare-and-select helper would be rewritten into the same hardware instruction, and §15.7.2 permits the zero sign |
   | `mix` | 13/14 → 14/14 both | **helper** (overflow) |
   | `normalize` | 0/3 hardware, 1/3 SwiftShader → 0/3, 3/3; zero, underflow and overflow rows match on both | **helper** (CPU zero rule; SwiftShader exact) |
   | `fract` | 10/11 both; row 7 (`-1e-10`: CPU `1.0`, GPU `0.99999994`) | built-in kept: a helper `x - floor(x)` fixed SwiftShader but not the hardware, whose compiler recognises the idiom and applies its own `frac` (a result below 1); measured, then removed |
   | `/`, `%` | `/`: 2/11 hardware, 10/11 SwiftShader; `%`: 4/7 hardware | built-in kept: no helper can make a hardware divider correctly rounded; WGSL allows 2.5 ULP (decision 0043 item 10) |

4. **What still differs, with the rule that permits it** (nothing hidden, no tolerance widened, every row inside the WGSL interval): division and everything built on it (`normalize` apart from the nine rows above is 1 binary32 step away on the hardware, WGSL §15.7.4.1: division within 2.5 ULP); `%` (`x - y * trunc(x / y)`); `fract(-1e-10)` (one step, correctly rounded either way); subnormal flush and zero sign (§15.7.2, §15.7.4); and the transcendental functions and everything that calls them (`sin`, `cos`, `pow`, `exp`, `quat.axis_angle`, `quat.euler`, `color.srgb`, ...) within their own accuracy bounds.

5. **Counts, hardware run (`MTEK_REQUIRE_GPU=1`), before → after:**

   | | Before (decision 0043) | After |
   |---|---|---|
   | Bit-exact rows | 307 (288 identical, 15 permitted, 4 spec-disagreement) | 330 (315 identical, 15 permitted, 0 spec-disagreement) |
   | Tolerance rows | 234 (233 within, 1 known deviation) | 220 (220 within, 0 known deviation) |
   | Not compared | 132 non-portable, 33 outside the domain | 123 non-portable, 33 outside the domain |
   | Failures | 0 | 0 |

   SwiftShader: 330 exact (313 identical, 17 permitted), 220 within, 0 failures. The 23 rows that moved to exact are the 4 conversion rows, the 14 `mix` rows and the 9 `normalize` rows (one `mix` row counted before as a known deviation, nine `normalize` rows as non-portable).

## Consequences

- No new diagnostic code and no new dependency. `rt` changes behaviour only for `f32` values at or above 2147483520 (`i32`) or 4294967040 (`u32`), which is what the GPU already did.
- A program that relied on `i32(3.0e9) == i32::MAX` now gets `2147483520` on the CPU, in folded constants and on the GPU alike.
- `mix` and `normalize` cost a few more instructions than the built-ins in shaders (a division instead of a reciprocal multiply for `normalize`); the runtime benchmark (M7-04) measures it before anyone optimises.
- Decision 0043 items 8 and 9 and 0037 item 6 point here. A new operation in `cpu.json` still needs a `tolerances.json` entry; a new helper family needs a `helperFamily` and a body check.

## Verification

`cargo test --workspace --locked` (the conversion rows of `consteval_goldens`, `numeric_cpu_table`, `value::tests::conversions_follow_section_6_5`, `codegen_cpu_table`, the helper unit test, the `scalar_semantics` WGSL golden); `npm run test:unit` (`rt.test.ts` conversions, `numeric-tables.test.ts` for `exactRows`, the codegen `exec.json` rows); `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware` and `npm run test:browser`: `tests/browser/specs/numeric/conformance.spec.ts` on the hardware and software projects (the helper-family check and every portable row), 101 and 101 passed.
