# 0127. Typed production scene-to-host state outputs

- Status: Accepted
- Date: 2026-10-19
- Scope: embedded product configurators; extends the explicit host interface of decisions 0006 and 0018 without relaxing CPU/GPU or binding rules.

## Context

An embedding page can set declared inputs but previously needed test-only scene reads to display scene-owned selections, quantities and prices. Those reads expose much more state than the page needs and give no typed notification contract.

## Decision

1. `[host.outputs] name = "Scene.state"` declares a read-only state export, independently of inputs. The compiler validates entry-scene ownership and the same value-type set as inputs. Arrays, structs, references, entity state and GPU values remain excluded. Existing `E9020`/`E9021` codes cover output source errors with output-specific messages.
2. The manifest adds optional `scene.hostOutputs` entries `{ name, source: { kind: "state", name }, type }`. Absent means empty, preserving older programs. The compiler omits empty outputs. The runtime validates names, sources and types before mounting.
3. Generated declarations export `Outputs` alongside `Inputs`. `MtekProgram<I, O>`, `MtekApp<I, O>` and `mountMtek<I, O>` propagate it; both generics retain defaults so old single-generic host code remains valid. `onOutput(name, listener)` infers the listener value type and returns an idempotent unsubscribe.
4. A subscription receives its initial snapshot after the next complete frame, then value changes only, coalesced after all seven phases and render submission. No snapshots of partially updated state and no synchronous callback during registration. All listeners and values are captured before delivery; registrations during delivery start next frame, while unsubscribe/dispose take effect immediately.
5. Scalars preserve CPU values. Vectors and colors become copied, frozen tuples, with linear RGBA for colors. There is no lossy conversion back to hexadecimal or mutable reference into scene state. Change detection uses `Object.is`, component-wise for tuples.
6. Host callback exceptions use `reportError`/`console.error`, as diagnostic callbacks do, and cannot stop the scene or other callbacks. Unknown names, invalid listeners and subscriptions after terminal failure/disposal throw synchronously.
7. Pause/recovery defer publication. Device recovery preserves subscriptions and snapshots. Successful hot replacement preserves matching name/type subscriptions and resets their first-snapshot state; removed/retyped outputs detach. Failed candidates preserve everything. Disposal and terminal failure release subscriptions.
8. The bridge observes only declared CPU scene state; it introduces no arbitrary JavaScript in Mtek, debug dependency, shader work, GPU readback, or new binding semantics.

## Verification

`crates/mtek-compiler/tests/host_outputs.rs` covers every output type, manifest validation, TypeScript declarations, quoted keys, and invalid ownership/type/target diagnostics. Runtime `host/outputs.test.ts` tests snapshots, equality, immutable copy semantics, reentrancy, exception isolation and lifecycle. `host/output-app.test.ts` exercises production mounting without debug, input and key-handler changes, next-frame feedback, real compiled bindings, rejected/successful replacement, failure, disposal and device recovery. `runtime-dts.test.ts` proves inferred listener types and compile-time rejections and compares both public declaration forms with implementation signatures.
