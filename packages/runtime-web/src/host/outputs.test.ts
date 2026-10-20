import { describe, expect, it, vi } from "vitest";
import type { MtekHostInputType, MtekManifest } from "../abi/manifest-types.js";
import { checkManifest } from "../abi/validate.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import { HostOutputs } from "./outputs.js";

function manifest(types: Record<string, MtekHostInputType> = { value: "f32" }): MtekManifest {
  const json = minimalManifestJson();
  const scene = json["scene"] as Record<string, unknown>;
  scene["state"] = Object.entries(types).map(([name, type]) => ({ name, type, symbol: `src/main.mtek::Demo.${name}` }));
  scene["hostOutputs"] = Object.entries(types).map(([name, type]) => ({ name, type, source: { kind: "state", name } }));
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  return parsed.manifest;
}

describe("production host outputs", () => {
  it("defers the initial snapshot and coalesces changes by value, not writes or identity", () => {
    const outputs = new HostOutputs(manifest());
    const listener = vi.fn();
    outputs.subscribe("value", listener);
    expect(listener).not.toHaveBeenCalled();
    outputs.publish({ value: 1 });
    outputs.publish({ value: 1 });
    outputs.publish({ value: 2 });
    outputs.publish({ value: 1 });
    expect(listener.mock.calls).toEqual([[1], [2], [1]]);
  });

  it("copies and freezes vectors and linear RGBA without quantization or shared mutable state", () => {
    const outputs = new HostOutputs(manifest({ v2: "vec2", v3: "vec3", v4: "vec4", tint: "color" }));
    const state = { v2: { x: 1, y: 2 }, v3: { x: 1, y: 2, z: 3 }, v4: { x: 1, y: 2, z: 3, w: 4 }, tint: { r: 0.123456, g: 0.5, b: 0, a: 0.4 } };
    const snapshots: Record<string, unknown> = {};
    for (const name of Object.keys(state)) outputs.subscribe(name, (value) => { snapshots[name] = value; });
    outputs.publish(state);
    expect(snapshots).toEqual({ v2: [1, 2], v3: [1, 2, 3], v4: [1, 2, 3, 4], tint: [0.123456, 0.5, 0, 0.4] });
    expect(Object.values(snapshots).every(Object.isFrozen)).toBe(true);
    const original = snapshots["v2"];
    state.v2.x = 8;
    expect(original).toEqual([1, 2]);
    outputs.publish(state);
    expect(snapshots["v2"]).toEqual([8, 2]);
    expect(original).toEqual([1, 2]);
  });

  it("delivers independent initial snapshots to late subscribers and compares vector components", () => {
    const outputs = new HostOutputs(manifest({ value: "vec2" }));
    const first = vi.fn(); const late = vi.fn();
    outputs.subscribe("value", first);
    outputs.publish({ value: { x: 1, y: 2 } });
    outputs.subscribe("value", late);
    outputs.publish({ value: { x: 1, y: 2 } });
    expect(first).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledExactlyOnceWith([1, 2]);
  });

  it("preserves all scalar types and uses Object.is numeric equality", () => {
    const outputs = new HostOutputs(manifest({ i: "i32", u: "u32", f: "f32", b: "bool", s: "string" }));
    const calls: unknown[] = [];
    for (const name of ["i", "u", "f", "b", "s"]) outputs.subscribe(name, (value) => calls.push([name, value]));
    outputs.publish({ i: -7, u: 4294967295, f: NaN, b: false, s: "chair" });
    outputs.publish({ i: -7, u: 4294967295, f: NaN, b: false, s: "chair" });
    expect(calls).toEqual([["i", -7], ["u", 4294967295], ["f", NaN], ["b", false], ["s", "chair"]]);
    outputs.publish({ i: -7, u: 4294967295, f: -0, b: false, s: "chair" });
    outputs.publish({ i: -7, u: 4294967295, f: 0, b: false, s: "chair" });
    expect(calls.slice(-2)).toEqual([["f", -0], ["f", 0]]);
  });

  it("supports duplicate listeners, idempotent unsubscription and disposal during publication", () => {
    const outputs = new HostOutputs(manifest());
    const listener = vi.fn();
    const stop = outputs.subscribe("value", listener);
    outputs.subscribe("value", listener);
    stop(); stop();
    outputs.publish({ value: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    outputs.subscribe("value", () => { outputs.dispose(); });
    const never = vi.fn(); outputs.subscribe("value", never);
    outputs.publish({ value: 2 });
    outputs.publish({ value: 3 });
    expect(never).not.toHaveBeenCalled();
    outputs.dispose(); stop();
    expect(() => outputs.subscribe("value", listener)).toThrow(/failed or been disposed/);
  });

  it("isolates errors and defers reentrant registrations across all outputs", () => {
    const errors = vi.fn();
    const outputs = new HostOutputs(manifest({ first: "f32", second: "f32" }), errors);
    const late = vi.fn(); const second = vi.fn();
    const failure = new Error("host callback");
    outputs.subscribe("first", () => { outputs.subscribe("second", late); throw failure; });
    outputs.subscribe("second", second);
    outputs.publish({ first: 1, second: 2 });
    expect(errors).toHaveBeenCalledExactlyOnceWith(failure);
    expect(second).toHaveBeenCalledExactlyOnceWith(2);
    expect(late).not.toHaveBeenCalled();
    outputs.publish({ first: 1, second: 2 });
    expect(late).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("honors removing another listener before its turn and captures all values before callbacks", () => {
    const outputs = new HostOutputs(manifest({ first: "f32", second: "f32" }));
    const state = { first: 1, second: 2 };
    const removed = vi.fn(); const second = vi.fn();
    let stop = (): void => undefined;
    outputs.subscribe("first", () => { state.second = 9; stop(); });
    stop = outputs.subscribe("second", removed);
    outputs.subscribe("second", second);
    outputs.publish(state);
    expect(removed).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("rejects unknown names and non-functions and accepts old manifests with no outputs", () => {
    const old = checkManifest(minimalManifestJson());
    if (!old.ok) throw new Error("old manifest");
    expect(() => new HostOutputs(old.manifest).subscribe("value", vi.fn())).toThrow(/Unknown host output/);
    const outputs = new HostOutputs(manifest());
    expect(() => outputs.subscribe("missing", vi.fn())).toThrow(RangeError);
    expect(() => outputs.subscribe("value", 1 as unknown as (value: unknown) => void)).toThrow(TypeError);
  });

  it("preserves matching output subscribers over reload, resets snapshots, and drops removed or retyped ones", () => {
    const outputs = new HostOutputs(manifest({ value: "f32", removed: "bool", changed: "f32" }));
    const value = vi.fn(); const removed = vi.fn(); const changed = vi.fn();
    outputs.subscribe("value", value); outputs.subscribe("removed", removed); outputs.subscribe("changed", changed);
    outputs.publish({ value: 1, removed: false, changed: 3 });
    outputs.replace(manifest({ value: "f32", changed: "string" }));
    outputs.publish({ value: 1, changed: "new" });
    expect(value.mock.calls).toEqual([[1], [1]]);
    expect(removed).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledTimes(1);
    outputs.replace(manifest({ value: "f32", removed: "bool", changed: "f32" }));
    outputs.publish({ value: 2, removed: true, changed: 4 });
    expect(removed).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledTimes(1);
  });
});
