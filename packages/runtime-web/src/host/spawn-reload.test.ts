/**
 * What a hot reload does to spawned entities (`spec/runtime-abi.md` section 11, decision 0064). A reload that does
 * not restart the scene keeps every spawned entity that exists: same slot, same generation, so references the
 * program holds stay valid; the new program's `init` runs again with the params the entity was spawned with, and
 * what the program kept (transform, visibility, state, imperative material params) moves over by identity. A
 * reload that restarts the scene (`W8070`) discards them with the rest of the old world.
 */
import { describe, expect, it } from "vitest";
import type { EntityRef } from "../scene/slots.js";
import { MANIFEST_URL } from "../test-support/fake-host.js";
import { validManifest } from "../test-support/mount-fixture.js";
import { SPARK, manifestEdit, mountSpawn, programFor, script, type Mounted, type Script } from "../test-support/spawn-fixture.js";

/** A candidate manifest as the dev server would serve it after an edit. */
function candidate(m: Mounted, s: Script, edit?: (manifest: Record<string, unknown>) => void) {
  const json = validManifest();
  manifestEdit(edit)(json);
  m.host.files.set(MANIFEST_URL, JSON.stringify(json));
  return programFor(s, json);
}

function spawnThree(s: Script): Script["keys"] {
  return {
    Space: (ctx) => {
      for (const n of [1, 2, 3]) s.refs.push(ctx.spawn(SPARK, { n }, 1));
    },
    Enter: (ctx) => {
      ctx.destroy(s.refs[1] as EntityRef, 2);
    },
  };
}

describe("a reload that does not restart the scene", () => {
  it("keeps the spawned entities in their slots and generations, runs the new init with the old params and carries state", async () => {
    const old = script();
    Object.assign(old.keys, spawnThree(old));
    const m = await mountSpawn(old);
    m.debug.pressKey("Space");
    m.debug.step(1, 0.02);
    m.debug.releaseKey("Space");
    // Destroy n=2 (slot 2) so a slot is free and its generation is 1; refs[1] is stale from now on.
    m.debug.pressKey("Enter");
    m.debug.step(1, 0.02);
    const before = m.debug.scene().spawned;
    expect(before.map((entity) => [entity.slot, entity.gen])).toEqual([
      [1, 0],
      [3, 0],
    ]);
    // Two updates have run for n=1 and n=3 (0.02 s each, as binary32): their `age` state is the sum.
    const age = Math.fround(Math.fround(0.02) + Math.fround(0.02));
    expect(before.map((entity) => entity.state["age"])).toEqual([age, age]);

    // The new program: same manifest, a different clear colour, new functions that log into their own array.
    const next = script();
    next.keys["KeyA"] = (ctx) => {
      next.log.push(`alive:${old.refs.map((ref) => String(ctx.alive(ref))).join(",")}`);
    };
    const program = candidate(m, next, (manifest) => {
      ((manifest["scene"] as Record<string, unknown>)["fields"] as Record<string, unknown>)["clearColor"] = [0.1, 0.2, 0.3, 1];
    });
    expect(await m.app.replaceProgram?.(program)).toEqual({ ok: true });

    // The swap happens at the start of the next frame; that frame has no tick (0.00333 + 0.01 < 1/60).
    m.debug.pressKey("KeyA");
    m.debug.step(1, 0.01);
    // The new init ran for each, in spawn order, with the params the entities were spawned with.
    expect(next.log).toEqual(["init:1", "init:3", "key:KeyA", "alive:true,false,true", "update:scene", "update:1", "update:3"]);
    const after = m.debug.scene().spawned;
    expect(after.map((entity) => [entity.prefab, entity.slot, entity.gen, entity.alive])).toEqual([
      ["Spark", 1, 0, true],
      ["Spark", 3, 0, true],
    ]);
    // The state moved over, then the new program's update added its own step (0.01 s).
    const aged = Math.fround(age + Math.fround(0.01));
    expect(after.map((entity) => entity.state["age"])).toEqual([aged, aged]);
    // And the pose: init put n=1 at x = 1/4, and the old program never moved it.
    expect(after.map((entity) => (entity.position as { x: number }).x)).toEqual([0.25, 0.75]);
    expect(m.reported.map((d) => d.code)).toEqual([]);
  });

  it("lets the new program keep using the held references and spawn into the slot the old generation freed", async () => {
    const old = script();
    Object.assign(old.keys, spawnThree(old));
    const m = await mountSpawn(old);
    m.debug.pressKey("Space");
    m.debug.step(1, 0.02);
    m.debug.releaseKey("Space");
    m.debug.pressKey("Enter");
    m.debug.step(1, 0.02);

    const next = script();
    next.keys["KeyS"] = (ctx) => {
      next.refs.push(ctx.spawn(SPARK, { n: 9 }, 1));
    };
    next.keys["KeyD"] = (ctx) => {
      // n=1 (slot 1) is destroyed through the reference of the old program's world.
      ctx.destroy(old.refs[0] as EntityRef, 3);
    };
    await m.app.replaceProgram?.(candidate(m, next));
    m.debug.pressKey("KeyS");
    m.debug.pressKey("KeyD");
    m.debug.step(2, 0.02);
    // The freed slot 2 (generation 1) is reused under generation 1; n=1 is gone.
    expect(next.refs).toEqual([{ slot: 2, gen: 1 }]);
    expect(m.debug.scene().spawned.map((entity) => [entity.slot, entity.gen])).toEqual([
      [3, 0],
      [2, 1],
    ]);
  });
});

describe("a reload that restarts the scene", () => {
  it("W8070 when the params of a spawned prefab changed: the spawned entities are gone and their references dead", async () => {
    const old = script();
    Object.assign(old.keys, spawnThree(old));
    const m = await mountSpawn(old);
    m.debug.pressKey("Space");
    m.debug.step(1, 0.02);
    expect(m.debug.scene().spawned).toHaveLength(3);

    const next = script();
    const program = candidate(m, next, (manifest) => {
      const prefab = (manifest["prefabs"] as Record<string, unknown>[])[0];
      if (prefab !== undefined) prefab["params"] = [{ name: "n", type: "i32" }, { name: "scale", type: "f32" }];
    });
    expect(await m.app.replaceProgram?.(program)).toEqual({ ok: true });
    m.debug.step(1, 0.01);
    const restart = m.reported.find((d) => d.code === "MTEK-W8070");
    expect(restart?.message).toContain("the params of prefab 'Spark' changed (n: i32 became n: i32, scale: f32)");
    expect(restart?.notes).toContain(`declaration: ${SPARK}`);
    expect(m.debug.scene().spawned).toEqual([]);
    expect(m.debug.counters()["liveEntities"]).toBe(1);
  });

  it("W8070 when the program module no longer has a prefab it had: the prefab set changed", async () => {
    const old = script();
    Object.assign(old.keys, spawnThree(old));
    const m = await mountSpawn(old);
    m.debug.pressKey("Space");
    m.debug.step(1, 0.02);

    const json = validManifest();
    m.host.files.set(MANIFEST_URL, JSON.stringify(json));
    const program = { ...programFor(script(), json), prefabs: {} };
    expect(await m.app.replaceProgram?.(program)).toEqual({ ok: true });
    m.debug.step(1, 0.01);
    expect(m.reported.find((d) => d.code === "MTEK-W8070")?.message).toContain("prefab 'src/main.mtek::Spark' was removed");
    expect(m.debug.scene().spawned).toEqual([]);
  });
});

describe("a reload after which nothing spawns the prefab any more", () => {
  it("drops its entities without a restart; the references to them stay dead", async () => {
    const old = script();
    Object.assign(old.keys, spawnThree(old));
    const m = await mountSpawn(old);
    m.debug.pressKey("Space");
    m.debug.step(1, 0.02);

    const next = script();
    next.keys["KeyA"] = (ctx) => {
      next.log.push(`alive:${old.refs.map((ref) => String(ctx.alive(ref))).join(",")}`);
    };
    // The manifest lists no prefab (nothing spawns one); the program module keeps the prefab in its table, as the compiler does.
    const json = validManifest();
    m.host.files.set(MANIFEST_URL, JSON.stringify(json));
    expect(await m.app.replaceProgram?.(programFor(next, json))).toEqual({ ok: true });
    m.debug.pressKey("KeyA");
    m.debug.step(1, 0.01);
    expect(next.log).toContain("alive:false,false,false");
    expect(m.debug.scene().spawned).toEqual([]);
    expect(m.reported.some((d) => d.code === "MTEK-W8070")).toBe(false);
    expect(m.debug.counters()).toMatchObject({ liveEntities: 1, entitySlots: 4 });
  });
});
