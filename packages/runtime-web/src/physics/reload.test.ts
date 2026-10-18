/**
 * What a hot reload does to the physics subsystem (`spec/runtime-abi.md` section 11, decision 0066). The reload swaps the
 * whole scene at the start of a frame; physics follows it: the old world is disposed, a new one is made for the new
 * world's entities at the poses the migration carried over, and spawned bodies are made again for the spawned entities
 * the migration re-created. Velocities and queued commands do not survive (the new world starts at rest). A candidate
 * whose physics module cannot be loaded is refused before anything is swapped.
 */
import { describe, expect, it } from "vitest";
import { BASE_URL, MANIFEST_URL } from "../test-support/fake-host.js";
import { FakePhysicsBackend, IDENTITY, vec } from "../test-support/fake-physics.js";
import {
  BALL,
  CRATE,
  PHYSICS_MODULE,
  PHYSICS_URL,
  STEP,
  mountPhysics,
  physicsManifestJson,
  physicsProgram,
  type Hooks,
  type MountedPhysics,
} from "../test-support/physics-fixture.js";

/** A candidate as the dev server would serve it: the same scene, built again. */
function candidate(m: MountedPhysics, hooks: Hooks, edit?: (manifest: Record<string, unknown>) => void): ReturnType<typeof physicsProgram> {
  const json = physicsManifestJson({ ...hooks, ...(edit === undefined ? {} : { manifest: edit }) });
  m.host.files.set(MANIFEST_URL, JSON.stringify(json));
  return physicsProgram(hooks, json);
}

describe("a reload that does not restart the scene", () => {
  it("disposes the old world and makes a new one at the carried poses, without importing the module again", async () => {
    const m = await mountPhysics({ positions: { [BALL]: vec(0, 4, 0) } });
    m.world.onStep = (world) => {
      world.body(BALL).pose = { position: vec(0, 2.5, 0), rotation: IDENTITY };
      world.body(BALL).linear = vec(0, -5, 0);
    };
    m.debug.step(3, STEP);
    const before = m.world;
    expect(m.debug.scene().entities.find((e) => e.name === "Ball")?.position).toEqual(vec(0, 2.5, 0));

    const swapped = candidate(m, { positions: { [BALL]: vec(0, 4, 0) } });
    expect(await m.app.replaceProgram?.(swapped)).toEqual({ ok: true });
    m.log.length = 0;
    m.debug.step(1, STEP / 4); // the swap is at the start of the next frame; no tick in a frame this short

    expect(before.disposed).toBe(true);
    expect(m.backend.worlds).toHaveLength(2);
    expect(m.world.disposed).toBe(false);
    // The body is made from the carried pose (0, 2.5, 0), not the program's initial (0, 4, 0).
    expect(m.log).toContain("addBody:1:dynamic:0,2.5,0");
    expect(m.host.imported).toEqual([PHYSICS_URL]);
    expect(m.debug.counters()).toMatchObject({ physicsBodies: 4, physicsColliders: 4 });
    expect(m.reported).toEqual([]);
    m.app.dispose();
    expect(m.world.disposed).toBe(true);
  });

  it("the new world starts at rest: velocities read zero and queued commands are gone", async () => {
    const reads: number[] = [];
    const hooks: Hooks = {
      keys: { KeyQ: (ctx) => ctx.body(ctx.e[BALL] ?? {}, 0).applyImpulse(vec(0, 1, 0)) },
      fixedUpdate: (ctx) => reads.push(ctx.body(ctx.e[BALL] ?? {}, 0).linearVelocity.y),
    };
    const m = await mountPhysics(hooks);
    m.world.onStep = (world) => {
      world.body(BALL).linear = vec(0, -7, 0);
    };
    m.debug.step(2, STEP);
    m.debug.pressKey("KeyQ"); // queued, never applied: the swap comes first
    m.debug.step(1, STEP / 4);
    m.debug.releaseKey("KeyQ");
    expect(await m.app.replaceProgram?.(candidate(m, hooks))).toEqual({ ok: true });
    m.log.length = 0;
    reads.length = 0;
    m.debug.step(1, STEP);
    expect(reads).toEqual([0]);
    expect(m.log.some((line) => line.startsWith("impulse"))).toBe(false);
    m.app.dispose();
  });

  it("makes the bodies of the spawned entities again, in their slots, at their carried poses", async () => {
    const hooks: Hooks = { keys: { KeyQ: (ctx) => void ctx.spawn(CRATE, { n: 1 }, 0) }, cratePosition: () => vec(1, 5, 0) };
    const m = await mountPhysics(hooks);
    m.debug.pressKey("KeyQ");
    m.debug.step(1, STEP);
    m.debug.releaseKey("KeyQ");
    m.world.onStep = (world) => {
      world.body(5).pose = { position: vec(1, 3.5, 0), rotation: IDENTITY };
    };
    m.debug.step(2, STEP);
    m.world.onStep = undefined;

    expect(await m.app.replaceProgram?.(candidate(m, hooks))).toEqual({ ok: true });
    m.log.length = 0;
    m.debug.step(1, STEP / 4);
    // The new `init` ran again with the old params, then the carried pose replaced what it computed.
    expect(m.log).toContain("addBody:5:dynamic:1,3.5,0");
    expect(m.debug.counters()).toMatchObject({ physicsBodies: 5, liveEntities: 6 });
    // The recreated body is the crate's again: destroying it removes it.
    m.app.dispose();
  });

  it("imports a different module when the candidate names another file", async () => {
    const m = await mountPhysics();
    const other = new FakePhysicsBackend(m.log);
    const url = new URL("physics/fedcba9876543210.js", BASE_URL).href;
    m.host.modules.set(url, other.module);
    const swapped = candidate(m, {}, (manifest) => {
      (manifest["subsystems"] as Record<string, unknown>)["physicsModule"] = "physics/fedcba9876543210.js";
    });
    expect(await m.app.replaceProgram?.(swapped)).toEqual({ ok: true });
    m.debug.step(1, STEP / 4);
    expect(m.host.imported).toEqual([PHYSICS_URL, url]);
    expect(other.worlds).toHaveLength(1);
    expect(m.backend.worlds[0]?.disposed).toBe(true);
    m.app.dispose();
  });
});

describe("a reload that cannot take over physics", () => {
  it("refuses a candidate whose physics module does not load, with E8102, and keeps running the old program", async () => {
    const m = await mountPhysics();
    const swapped = candidate(m, {}, (manifest) => {
      (manifest["subsystems"] as Record<string, unknown>)["physicsModule"] = "physics/aaaaaaaaaaaaaaaa.js";
    });
    const result = await m.app.replaceProgram?.(swapped);
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8102"]);
      expect(result.diagnostics[0]?.phase).toBe("runtime:reload");
    }
    expect(m.reported.map((d) => d.code)).toEqual(["MTEK-E8102"]);
    // Nothing was swapped: the old world is alive and still steps.
    expect(m.world.disposed).toBe(false);
    m.debug.step(2, STEP);
    expect(m.debug.counters()).toMatchObject({ physicsSteps: 2, physicsBodies: 4 });
    expect(m.app.state).toBe("running");
    m.app.dispose();
  });

  it("a candidate without bodies restarts the scene (W8070) and the physics world goes with the old scene", async () => {
    const m = await mountPhysics();
    const swapped = candidate(m, {}, (manifest) => {
      manifest["subsystems"] = { physics: false };
      const scene = manifest["scene"] as { entities: Record<string, unknown>[] };
      for (const entity of scene.entities) {
        entity["body"] = null;
        entity["collider"] = null;
      }
      manifest["prefabs"] = [];
    });
    expect(await m.app.replaceProgram?.(swapped)).toEqual({ ok: true });
    m.debug.step(1, STEP / 4);
    expect(m.reported.map((d) => d.code)).toContain("MTEK-W8070");
    expect(m.world.disposed).toBe(true);
    expect(m.debug.counters()).toMatchObject({ physicsBodies: 0, physicsColliders: 0 });
    m.debug.step(3, STEP);
    expect(m.debug.counters()["physicsSteps"]).toBe(0);
    m.app.dispose();
  });
});

describe("the module path", () => {
  it("is relative to the program's directory", () => {
    expect(PHYSICS_URL).toBe(new URL(PHYSICS_MODULE, BASE_URL).href);
  });
});
