// M5-06: the resources of a physics program return to zero on dispose and stay bounded under churn
// (spec/testing.md section 6.6, spec/runtime-abi.md section 9.3, spec/physics.md section 7, decisions 0064 and 0068).
// `fixtures/m5/physics_waves` spawns waves of dynamic crates that destroy themselves 90 ticks later, over a static floor.
//
//  - Twenty mount/dispose cycles, each with a wave alive when it is disposed: after every `dispose()` the bodies and the
//    colliders of the physics world and every live GPU counter (buffers, textures, samplers, shader modules, pipelines,
//    bind groups) and the runtime's own listeners are 0, and a spy on `addEventListener` / `removeEventListener` sees
//    every listener the mount added removed again.
//  - 1 000 crates in twenty waves of fifty, then three waves of a hundred and three of fifty: after every wave, with
//    the crates alive (the peak) and after they were all destroyed (the end), the live resources are read. What is
//    asserted is derived from the program: the physics world and the entity counts follow the wave exactly; the
//    renderer's live resources stay at the plateau the first wave of that size reached (arenas and the instance buffer
//    keep the capacity they grew to and never shrink, decision 0064 items 13 and 14), a wave of a hundred raises the
//    plateau once and the later waves, of fifty or a hundred, do not move it again.
import { expect, test } from "../../support/fixtures.ts";
import { TARGET, openFixture, runScript, type Action, type AppLike, type DiagnosticLike, type Snapshot } from "./physics-support.ts";

const FIXTURE = "physics_waves";
const STEP = 0.016666668;

/** Every live-object counter of the renderer and the physics world: all 0 after `dispose()` (runtime-abi 9.3). */
const LIVE_AFTER_DISPOSE = ["liveBuffers", "liveTextures", "liveSamplers", "liveShaderModules", "livePipelines", "liveBindGroups", "liveListeners", "physicsBodies", "physicsColliders"] as const;
/** The resources of the renderer that follow the largest wave so far, not the current one. */
const GPU_LIVE = ["liveBuffers", "liveBindGroups", "liveTextures", "liveSamplers", "livePipelines"] as const;
const PLATEAU = [...GPU_LIVE, "ownedParamBlocks", "entitySlots"] as const;
/** What is created over time: it must stop growing once the plateau is reached (bind groups of shared blocks are the exception, see below). */
const CUMULATIVE = ["buffersAllocated", "texturesAllocated", "pipelinesCreated", "shaderModulesCreated"] as const;

const pick = (counters: Record<string, number>, names: readonly string[]): Record<string, number> => Object.fromEntries(names.map((name) => [name, counters[name] ?? Number.NaN]));

test.describe("physics resources return to zero and stay bounded (M5-06)", () => {
  test.beforeEach(({ gpu }) => {
    void gpu;
  });

  test("twenty mounts and disposals with live crates: every counter and listener back to zero", async ({ page }, testInfo) => {
    await openFixture(page, FIXTURE);
    const cycles = await page.evaluate(
      async ({ target, dt }) => {
        const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
        // A spy on listeners: every add during a cycle must be matched by a remove before the cycle's dispose returns.
        const live = new Set<string>();
        const ids = new WeakMap<object, number>();
        const listenerIds = new WeakMap<object, number>();
        let nextId = 1;
        const idOf = (map: WeakMap<object, number>, object: object): number => {
          let id = map.get(object);
          if (id === undefined) {
            id = nextId;
            nextId += 1;
            map.set(object, id);
          }
          return id;
        };
        const capture = (options: unknown): boolean => (typeof options === "boolean" ? options : typeof options === "object" && options !== null && (options as { capture?: boolean }).capture === true);
        const key = (target: EventTarget, type: string, listener: unknown, options: unknown): string | undefined => {
          if (listener === null || (typeof listener !== "object" && typeof listener !== "function")) return undefined;
          return `${String(idOf(ids, target))}:${type}:${String(idOf(listenerIds, listener as object))}:${String(capture(options))}`;
        };
        const originalAdd = EventTarget.prototype.addEventListener;
        const originalRemove = EventTarget.prototype.removeEventListener;
        let tracking = false;
        EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
          if (tracking) {
            const id = key(this, type, listener, options);
            if (id !== undefined) live.add(id);
          }
          originalAdd.call(this, type, listener, options);
        };
        EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
          const id = key(this, type, listener, options);
          if (id !== undefined) live.delete(id);
          originalRemove.call(this, type, listener, options);
        };
        const rows: Array<{ before: Record<string, number>; after: Record<string, number>; added: number; leftOver: number; reported: DiagnosticLike[] }> = [];
        try {
          for (let cycle = 0; cycle < 20; cycle += 1) {
            const reported: DiagnosticLike[] = [];
            live.clear();
            tracking = true;
            const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
            const added = live.size;
            // A wave of 50 crates is alive (and some are in contact) when the application is disposed.
            app.debug.pressKey("Space");
            app.debug.step(1, dt);
            app.debug.releaseKey("Space");
            app.debug.step(39, dt);
            const before = { ...app.debug.counters() };
            app.dispose();
            tracking = false;
            rows.push({ before, after: { ...app.debug.counters() }, added, leftOver: live.size, reported });
          }
        } finally {
          EventTarget.prototype.addEventListener = originalAdd;
          EventTarget.prototype.removeEventListener = originalRemove;
        }
        return rows;
      },
      { target: TARGET, dt: STEP },
    );

    expect(cycles).toHaveLength(20);
    for (const [index, row] of cycles.entries()) {
      expect(row.reported, `cycle ${String(index)}: no diagnostics`).toEqual([]);
      // The wave was alive: the floor and 50 crates in the physics world, and GPU resources in use.
      expect(row.before, `cycle ${String(index)} before dispose`).toMatchObject({ physicsBodies: 51, physicsColliders: 51, physicsSteps: 40, liveEntities: 51, entitiesSpawned: 50, entitiesDestroyed: 0 });
      expect(row.before["liveBuffers"]).toBeGreaterThan(0);
      expect(row.before["liveBindGroups"]).toBeGreaterThan(0);
      for (const name of LIVE_AFTER_DISPOSE) expect(row.after[name], `cycle ${String(index)}: ${name} after dispose`).toBe(0);
      expect(row.added, `cycle ${String(index)}: the mount added listeners`).toBeGreaterThan(0);
      expect(row.leftOver, `cycle ${String(index)}: listeners still registered after dispose`).toBe(0);
    }
    // Every cycle is the same run: the counters before dispose are identical (nothing accumulates between cycles).
    const reference = JSON.stringify(pick(cycles[0]?.before ?? {}, [...GPU_LIVE, ...CUMULATIVE, "ownedParamBlocks", "sharedParamBlocks", "bindGroupsCreated", "uploads", "uploadBytes", "drawCalls"]));
    for (const [index, row] of cycles.entries()) {
      expect(JSON.stringify(pick(row.before, [...GPU_LIVE, ...CUMULATIVE, "ownedParamBlocks", "sharedParamBlocks", "bindGroupsCreated", "uploads", "uploadBytes", "drawCalls"])), `cycle ${String(index)} against cycle 0`).toBe(reference);
    }
    testInfo.annotations.push({ type: "m5-cycles", description: `20 cycles, each identical before dispose: ${reference}; after dispose ${JSON.stringify(pick(cycles[0]?.after ?? {}, [...LIVE_AFTER_DISPOSE, "liveEntities", "entitySlots"]))}; listeners added per mount ${String(cycles[0]?.added)}` });
  });

  test("1 000 crates in waves: bounded plateau of live resources, capacity kept, nothing leaks", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    interface Wave {
      kind: "w50" | "w100";
      size: number;
      /** Snapshot labels. */
      peak: string;
      end: string;
    }
    const waves: Wave[] = [];
    const script: Action[] = [{ op: "step", frames: 1 }, { op: "snap", label: "empty" }];
    const plan: Array<{ key: string; size: number; kind: "w50" | "w100" }> = [
      ...Array.from({ length: 20 }, () => ({ key: "Space", size: 50, kind: "w50" as const })),
      ...Array.from({ length: 3 }, () => ({ key: "KeyD", size: 100, kind: "w100" as const })),
      ...Array.from({ length: 3 }, () => ({ key: "Space", size: 50, kind: "w50" as const })),
    ];
    plan.forEach((wave, index) => {
      const peak = `peak ${String(index + 1)}`;
      const end = `end ${String(index + 1)}`;
      waves.push({ kind: wave.kind, size: wave.size, peak, end });
      // The wave is spawned by the key (created at the first tick's flush), lives for 90 ticks and has destroyed itself at
      // the end of the 90th: 30 frames in it is alive, 100 frames in everything is gone.
      script.push({ op: "press", key: wave.key }, { op: "step", frames: 1 }, { op: "release", key: wave.key }, { op: "step", frames: 29 }, { op: "snap", label: peak }, { op: "step", frames: 70 }, { op: "snap", label: end });
    });
    const run = await runScript(page, FIXTURE, script);
    expect(run.reported, "no runtime diagnostics").toEqual([]);
    expect(run.finalState).toBe("running");
    const at = (label: string): Snapshot => {
      const found = run.snaps.find((snapshot) => snapshot.label === label);
      if (found === undefined) throw new Error(`no snapshot '${label}'`);
      return found;
    };
    const empty = at("empty");
    expect(empty.counters).toMatchObject({ physicsBodies: 1, physicsColliders: 1, liveEntities: 1, entitySlots: 1, entitiesSpawned: 0 });

    let spawned = 0;
    let slotsSoFar = 1;
    for (const wave of waves) {
      spawned += wave.size;
      slotsSoFar = Math.max(slotsSoFar, 1 + wave.size);
      const peak = at(wave.peak);
      const end = at(wave.end);
      // The physics world and the entity table follow the wave exactly: the floor and the crates of the wave while it lives
      // (every crate has a body and a collider), the floor alone after it; the slots of the table keep the largest wave's size.
      expect(peak.counters, wave.peak).toMatchObject({ physicsBodies: 1 + wave.size, physicsColliders: 1 + wave.size, liveEntities: 1 + wave.size, entitySlots: slotsSoFar, pendingSpawns: 0, pendingRemovals: 0, entitiesSpawned: spawned, drawCalls: 4, instancedDraws: 3, sharedParamBlocks: 3 });
      expect(end.counters, wave.end).toMatchObject({ physicsBodies: 1, physicsColliders: 1, liveEntities: 1, entitySlots: slotsSoFar, pendingSpawns: 0, pendingRemovals: 0, entitiesSpawned: spawned, entitiesDestroyed: spawned, drawCalls: 1, instancedDraws: 0, sharedParamBlocks: 0, ownedParamBlocks: 1 });
    }
    expect(spawned).toBe(20 * 50 + 3 * 100 + 3 * 50);
    expect(at(waves[19]?.end ?? "").counters["entitiesSpawned"], "1 000 crates spawned and destroyed after twenty waves of fifty").toBe(1000);
    expect(at(waves[19]?.end ?? "").counters["entitiesDestroyed"]).toBe(1000);

    // The plateau of the renderer. The first wave of fifty grows every arena and the instance buffer to the capacity it
    // needs; the nineteen after it, peak and end, find everything in place.
    const firstPeak = pick(at("peak 1").counters, PLATEAU);
    const firstEnd = pick(at("end 1").counters, PLATEAU);
    for (let index = 2; index <= 20; index += 1) {
      expect(pick(at(`peak ${String(index)}`).counters, PLATEAU), `peak of wave ${String(index)} against wave 1`).toEqual(firstPeak);
      expect(pick(at(`end ${String(index)}`).counters, PLATEAU), `end of wave ${String(index)} against wave 1`).toEqual(firstEnd);
    }
    // Nothing is created after the first wave except the bind groups of the three shared parameter blocks, which exist
    // while a wave has members (3 at the peak) and are released with the last one: three created per wave, none alive after it.
    const afterFirst = at("end 1").counters;
    const after20 = at("end 20").counters;
    for (const name of CUMULATIVE) expect(after20[name], `${name} after 20 waves against after 1`).toBe(afterFirst[name]);
    expect((after20["bindGroupsCreated"] ?? 0) - (afterFirst["bindGroupsCreated"] ?? 0), "bind groups created by waves 2 to 20").toBe(19 * 3);
    expect(afterFirst["liveBindGroups"]).toBe(empty.counters["liveBindGroups"]);

    // A wave of a hundred raises the capacity once (the object arena, the parameter arenas and the instance buffer double
    // or grow to fit it), and it stays: the second and third wave of a hundred and the three waves of fifty after them
    // run on the same plateau. Live resources never exceed the first hundred-wave's, and the number of live buffers,
    // textures, samplers, pipelines and bind groups is the same as with fifty (arenas replace their buffer in place).
    const bigPeak = pick(at("peak 21").counters, PLATEAU);
    const bigEnd = pick(at("end 21").counters, PLATEAU);
    expect(bigPeak["entitySlots"]).toBe(101);
    for (const name of GPU_LIVE) expect(bigPeak[name], `${name} with a wave of 100`).toBe(firstPeak[name]);
    expect(bigPeak["ownedParamBlocks"]).toBe(firstPeak["ownedParamBlocks"]);
    for (let index = 22; index <= 26; index += 1) {
      expect(pick(at(`peak ${String(index)}`).counters, PLATEAU), `peak of wave ${String(index)} against wave 21`).toEqual(bigPeak);
      expect(pick(at(`end ${String(index)}`).counters, PLATEAU), `end of wave ${String(index)} against wave 21`).toEqual(bigEnd);
    }
    const afterBig = at("end 21").counters;
    const afterLast = at("end 26").counters;
    for (const name of CUMULATIVE) expect(afterLast[name], `${name} after wave 26 against after wave 21`).toBe(afterBig[name]);
    expect(afterBig["buffersAllocated"], "the first wave of a hundred allocated buffers (growth)").toBeGreaterThan(afterFirst["buffersAllocated"] ?? 0);

    testInfo.annotations.push({
      type: "m5-waves",
      description: [
        `empty ${JSON.stringify(pick(empty.counters, [...PLATEAU, ...CUMULATIVE, "bindGroupsCreated"]))}`,
        `wave 1 (50) peak ${JSON.stringify(pick(at("peak 1").counters, [...PLATEAU, ...CUMULATIVE, "bindGroupsCreated"]))}`,
        `wave 1 end ${JSON.stringify(pick(at("end 1").counters, [...PLATEAU, ...CUMULATIVE, "bindGroupsCreated"]))}`,
        `wave 20 (1000 crates) end ${JSON.stringify(pick(at("end 20").counters, [...PLATEAU, ...CUMULATIVE, "bindGroupsCreated", "entitiesSpawned", "entitiesDestroyed"]))}`,
        `wave 21 (100) peak ${JSON.stringify(pick(at("peak 21").counters, [...PLATEAU, ...CUMULATIVE, "bindGroupsCreated"]))}`,
        `wave 26 end ${JSON.stringify(pick(at("end 26").counters, [...PLATEAU, ...CUMULATIVE, "bindGroupsCreated", "entitiesSpawned", "entitiesDestroyed"]))}`,
      ].join("; "),
    });
  });
});
