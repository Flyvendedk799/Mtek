# Core compiler correctness audit — 2026-10-19

## Scope and evidence

The audit started from commit `0f45f290703b78d110d3ed11e650cb68c169bfa0` on PR #3. It examined existing language contracts, rather than proposing syntax or performance changes. Independent passes covered constant evaluation/numeric operations, generated CPU value and control-flow semantics, transitive effects/phase restrictions, and shader type lowering. Findings below were reproduced before edits with minimized projects and the real compiler/runtime.

To reproduce a source example below, place it in `src/main.mtek` beside an `mtek.toml` containing `[project]`, `name = "audit"` and `language = "0.1"`; run `target/debug/mtek check <project> --format json` and `target/debug/mtek build <project> --format json`. The committed regression tests also execute the generated behavior, rather than checking diagnostics or emitted text alone.

The priorities were wrong results or broken isolation first, accepted programs that later fail emission second, and inconsistent build modes. Four bounded fix groups were selected. Three additional defects are explicitly deferred; this is not a claim that the compiler has no other defects.

## 1. Ambient reads bypass pure-function and initialization rules

### Reproduction

```mtek
fn read_time() -> f32 { return frame.time; }
fn wrapped_time() -> f32 { return read_time(); }
material Clock {
    fragment(input: SurfaceInput) -> color {
        return color.linear(vec3(wrapped_time()), 1.0);
    }
}
scene Demo {
    camera Main {}
    entity A { mesh: Box {}; material: Clock {}; }
}
```

Before the fix, `mtek check` succeeds, but `mtek build` reports internal compiler error `E9999`: the function contains a scene value in GPU code. Calling the same helper from a binding produces an empty dependency list despite reading time.

A related phase violation:

```mtek
cpu fn velocity(r: entity_ref) -> vec3 { return r.body.linear_velocity; }
cpu fn wrapped(r: entity_ref) -> vec3 { return velocity(r); }
scene Demo {
    state start: vec3 = wrapped(Ball);
    camera Main {}
    entity Ball {
        body: Dynamic {};
        collider: SphereCollider { radius: 0.5; };
    }
}
```

Before the fix, checking/building succeeds and initialization reads a physics body before bodies exist. A pure helper can also hide a velocity read from the binding restriction.

**Contract:** `spec/language.md` §8.3 restricts pure functions to parameters, locals and constants. `spec/scenes.md` §8.4 makes binding dependencies explicit. `spec/physics.md` §3 forbids body-property reads in initializers and bindings. Legitimate CPU helper reads must remain supported where these phase rules permit them.

**Affected boundary:** type checking must record ambient read effects, and whole-program analysis must carry body-read restrictions through calls. A source-level rejection must replace the late backend error; a source-order-only fix is insufficient.

## 2. Specialized indices bypass the runtime clamping path

```mtek
prefab Reader {
    param index: i32 = 4;
    state result: f32 = 0.0;
    update(dt: f32) {
        let values = [10.0, 20.0];
        self.result = values[index];
    }
}
scene Demo {
    camera Main {}
    entity First: Reader {}
}
```

Before the fix, checking succeeds, but static instantiation causes build-time `E9999`. The unspecialized prefab produces `20.0`; changing the static expression to `values[index + 0]` also produces `20.0`. Signed negative indices, `u32` maximum, compound array writes and matrix-column reads exhibit the same fault.

**Contract:** `spec/language.md` §5.6 requires dynamic indices to clamp. A parameter substituted during specialization was not a source constant when checked. Truly constant source expressions such as `values[4]` or `values[-1]` must still fail with `E3030`.

**Affected boundary:** `ir/instantiate.rs` substitutes parameters after source validation; `emit_js/cpu.rs` incorrectly assumes every resulting constant index has already passed source bounds checking. Out-of-range specialized values need the existing clamping path, including original signed values and warning spans. In-range constant access can remain direct.

## 3. Release helpers retain development-only print calls

```mtek
cpu fn indirect_print() { print("helper log"); }
scene Demo {
    camera Main {}
    update(dt: f32) {
        print("direct log");
        indirect_print();
    }
}
```

Before the fix, release and preview remove the direct print but retain the helper print. Executing the generated update logs one message, where the documented release behavior requires none.

**Contract:** `spec/stdlib.md` specifies that print is a no-op in release; `spec/tooling.md` says it is compiled out. The established direct-call behavior removes the entire print statement, including argument evaluation. Helper lowering must use the same mode flags while retaining preview loop-budget instrumentation.

**Affected boundary:** `emit_js/cpu.rs` hardcodes `release: false` for module functions; `emit_js/program.rs` supplies only the loop-budget flag.

## 4. Dynamic state initialization aliases immutable aggregate parameters

```mtek
prefab Cell {
    param seed: array<i32, 2> = [1, 2];
    state first: array<i32, 2> = seed;
    state second: array<i32, 2> = seed;
    update(dt: f32) { self.first[0] = 9; }
}
scene Demo {
    camera Main {}
    on key_down(Key.Space) { spawn(Cell {}); }
}
```

Before the fix, initializing and updating a dynamic instance produces `first = [9, 2]`, `second = [9, 2]`, and `seed = [9, 2]`. Expected: only `first` changes. This violates both value semantics and parameter immutability.

**Contract:** `spec/language.md` §7.2 says a place write cannot change another variable, parameter or constant; §8.2 specifies copy semantics. State owns mutable aggregate storage.

**Affected boundary:** `emit_state_init` uses ordinary expression lowering instead of the existing owned-storage lowering. The fix must copy non-fresh aggregates at this boundary, including nested values, without evaluating the initializer twice or introducing unnecessary copies for fresh values.

## Deferred, reproduced findings

- **Nested GPU `SurfaceInput` values:** a fragment containing `let values = [input, input]; return color.linear(values[0].world_normal, 1.0);` passes checking but fails build with `E9999` because `lowering/shader/types.rs` has no nested layout for `SurfaceInput`. Direct helper parameters work. The checker explicitly classifies GPU records and arrays/structs of them as GPU-representable, so this is a missing backend representation, not a documented language restriction. It needs a canonical representation shared with the generated stage wrapper, with array/struct/function regressions; this pass does not invent a new restriction to hide it.
- **Inferred arrays of unit values:** `fn nothing() {}` followed by `let invalid = [nothing()];` in an update passes check/build and emits `[undefined]`, contrary to `spec/language.md` §5.1 (unit is not usable as a value). This needs an ordinary source diagnostic at array-element inference; it is outside the four selected fix groups.

- **Block constants in prefab lifecycle bodies:** `prefab Indexed { update(dt: f32) { let values = [10.0, 20.0]; const INDEX: i32 = 1; let result = values[INDEX]; } }` with a static instance passes checking but fails build with `E9999` ("constant INDEX was not checked"). Section 8.1 permits constants in any block; prefab constant collection omits lifecycle/handler block constants before IR lowering. This baseline defect was found after the four-fix selection and remains deferred.

## Checks that did not establish defects

- 9,881 finite scalar/vector/matrix comparisons between folded expressions and generated CPU execution agreed bit-for-bit, including signed zeros. Reproduce with `node scripts/audit-numeric-differential.mjs` after building the CLI/runtime. The dependency-free runner uses seed 4421, 300 input triples and 33 expressions, retains its generated source/results, and verifies the reference function actually contains only folded numeric literals. Nineteen overflowing constant divisions are excluded under the specified `E3040` rule. This is useful sampled coverage, not proof of all arithmetic or GPU equivalence.
- Literal-only overflow diagnostics, declaration-order/unspecified struct-field evaluation order, and the documented constant/runtime transcendental tolerances were excluded as false positives.
- No measured compilation or runtime performance defect was established, so no speculative optimization was made.

## Verification

Final implementation tests, source tree and CI results are recorded in PR #3. Regression coverage includes source-constant rejection versus specialized clamping, actual generated-code execution, nested aggregate independence, single evaluation, build-mode equivalence, and direct/transitive effect restrictions with positive CPU-context controls.
