// M5-05: the physics subsystem on the real engine and the real GPU (spec/physics.md sections 1, 4 and 7, decision 0066).
//
//  - A program without bodies never requests anything under `physics/` (the M5 exit gate): every network request of
//    two non-physics fixtures is recorded, and the same recorder sees the request for the physics fixture, so the
//    recorder is known to work.
//  - A program with bodies imports exactly one physics module, the file its manifest names; a dynamic crate falls
//    on a static floor, comes to rest at the derived height, and the handlers of Mtek source see the contact and
//    the velocity the engine computed. Every expected number is derived by hand from the program
//    (`fixtures/m5/physics_drop/src/main.mtek`), not read from the runtime:
//      rest height   floor top y = 0, crate half-extent 0.5, so the centre rests at y = 0.5 (within 10 mm, section 7)
//      impulse       8 N*s on 2 kg is 4 m/s; the step that applies it also integrates one step of gravity, so the
//                    velocity the next fixed_update reads is 4 - 9.81 / 60 = 3.8365 m/s (the engine's velocities
//                    are exactly g * n * dt, decision 0063), within 1 %
//  - Mounting and disposing twenty times leaves no body or collider behind (the counters of the runtime).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { M5_OUT_DIR, PHYSICS_DROP, PREFAB_INSTANCES, SPAWN_RING } from "../../support/m5-fixtures.ts";

interface DiagnosticLike {
  code: string;
  severity: string;
  message: string;
}

interface AppLike {
  state: string;
  debug: {
    pressKey(code: string): void;
    releaseKey(code: string): void;
    step(frames: number, dtSeconds: number): void;
    counters(): Record<string, number>;
    scene(): { state: Record<string, number>; entities: Array<{ name: string; position: { x: number; y: number; z: number } }> };
  };
  dispose(): void;
}

/** `manifest.runtimeConfig.fixedStep`: a frame of exactly this length is exactly one fixed tick. */
const STEP = 0.016666668;
const TARGET = { width: 160, height: 80 } as const;
const GRAVITY = 9.81;

/** Records every request the page makes, with the response status. */
function recordRequests(page: Page): { urls: string[]; statuses: Map<string, number> } {
  const urls: string[] = [];
  const statuses = new Map<string, number>();
  page.on("request", (request) => {
    urls.push(request.url());
  });
  page.on("response", (response) => {
    statuses.set(response.url(), response.status());
  });
  return { urls, statuses };
}

const isPhysicsRequest = (url: string): boolean => new URL(url).pathname.split("/").includes("physics");

async function mount(page: Page, fixture: string): Promise<void> {
  await page.goto(`/m5/${fixture}/index.html`);
}

test.describe("the physics module is loaded for programs with bodies only (M5-05)", () => {
  test.beforeEach(({ gpu }) => {
    void gpu;
  });

  for (const fixture of [PREFAB_INSTANCES, SPAWN_RING]) {
    test(`${fixture}: a program without bodies makes no request for physics/`, async ({ page }) => {
      expect(existsSync(join(M5_OUT_DIR, fixture, "physics")), "the build has no physics directory").toBe(false);
      const manifest = JSON.parse(readFileSync(join(M5_OUT_DIR, fixture, "program.manifest.json"), "utf8")) as { subsystems: Record<string, unknown> };
      expect(manifest.subsystems).toEqual({ physics: false });

      const requests = recordRequests(page);
      await mount(page, fixture);
      const result = await page.evaluate(async (target) => {
        const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
        const reported: DiagnosticLike[] = [];
        const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
        app.debug.step(10, 1 / 60);
        const counters = { ...app.debug.counters() };
        app.dispose();
        return { counters, reported };
      }, TARGET);

      expect(result.reported).toEqual([]);
      expect(result.counters["physicsBodies"]).toBe(0);
      expect(result.counters["physicsSteps"]).toBe(0);
      // The page, the program, the runtime, the manifest and the shaders were requested; nothing under physics/.
      expect(requests.urls.length).toBeGreaterThan(3);
      expect(requests.urls.filter(isPhysicsRequest), "requests for physics/").toEqual([]);
    });
  }

  test("a program with bodies requests the one module its manifest names, once, and it loads", async ({ page }) => {
    const manifest = JSON.parse(readFileSync(join(M5_OUT_DIR, PHYSICS_DROP, "program.manifest.json"), "utf8")) as { subsystems: { physics: boolean; physicsModule: string } };
    expect(manifest.subsystems.physics).toBe(true);
    expect(manifest.subsystems.physicsModule).toMatch(/^physics\/[0-9a-f]{16}\.js$/);
    expect(existsSync(join(M5_OUT_DIR, PHYSICS_DROP, manifest.subsystems.physicsModule))).toBe(true);

    const requests = recordRequests(page);
    await mount(page, PHYSICS_DROP);
    expect(requests.urls.filter(isPhysicsRequest), "nothing is requested before the program is mounted").toEqual([]);
    const result = await page.evaluate(async (target) => {
      const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
      const reported: DiagnosticLike[] = [];
      const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
      const counters = { ...app.debug.counters() };
      app.dispose();
      return { counters, reported };
    }, TARGET);

    expect(result.reported).toEqual([]);
    const physics = requests.urls.filter(isPhysicsRequest);
    expect(physics.map((url) => new URL(url).pathname)).toEqual([`/m5/${PHYSICS_DROP}/${manifest.subsystems.physicsModule}`]);
    expect(requests.statuses.get(physics[0] ?? "")).toBe(200);
    // The two bodies of the scene exist in the engine after mount, before any frame.
    expect(result.counters).toMatchObject({ physicsBodies: 2, physicsColliders: 2, physicsSteps: 0 });
  });
});

test.describe("a crate falls onto a floor on the real engine (M5-05)", () => {
  test.beforeEach(({ gpu }) => {
    void gpu;
  });

  test("it comes to rest at the derived height, the handlers see the landing, and an impulse changes the velocity by impulse / mass", async ({ page }) => {
    await mount(page, PHYSICS_DROP);
    const run = await page.evaluate(
      async ({ target, dt, g }) => {
        const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
        const reported: DiagnosticLike[] = [];
        const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
        const crateY = (): number => app.debug.scene().entities.find((entity) => entity.name === "Crate")?.position.y ?? Number.NaN;
        const heights: number[] = [crateY()];

        // Free fall: after n ticks the engine (4 substeps per step) is at y0 - g dt^2 (n^2 / 2 + n / 8), decision 0063.
        app.debug.step(10, dt);
        const fallen = crateY();
        const expectedFall = 3 - g * dt * dt * (100 / 2 + 10 / 8);

        // Three simulated seconds in all: well past the 0.71 s of the fall.
        for (let i = 0; i < 17; i += 1) {
          app.debug.step(10, dt);
          heights.push(crateY());
        }
        app.debug.step(10, dt);
        const rest = crateY();
        const afterRest = { ...app.debug.scene().state };

        // The impulse: pressed in phase 1, applied at the start of the next tick, read by the tick after.
        app.debug.pressKey("Space");
        app.debug.step(1, dt);
        app.debug.releaseKey("Space");
        app.debug.step(1, dt);
        const afterImpulse = { ...app.debug.scene().state };
        const climbing = crateY();
        const counters = { ...app.debug.counters() };
        const state = app.state;
        app.dispose();
        return { reported, rest, afterRest, fallen, expectedFall, afterImpulse, climbing, counters, state, heights };
      },
      { target: TARGET, dt: STEP, g: GRAVITY },
    );

    expect(run.reported, "no runtime diagnostics").toEqual([]);
    expect(run.state).toBe("running");

    // Free fall matches the engine's substepped integration (half a millimetre at most).
    expect(run.fallen).toBeCloseTo(run.expectedFall, 3);

    // Resting contact: the centre of a unit cube on a floor whose top is y = 0 is at 0.5, within 10 mm.
    expect(Math.abs(run.rest - 0.5)).toBeLessThan(0.01);
    // It really came down and stayed: no later sample is below the floor, and the last samples agree.
    expect(Math.min(...run.heights)).toBeGreaterThan(0.45);
    expect(Math.abs((run.heights.at(-1) ?? Number.NaN) - run.rest)).toBeLessThan(0.005);

    // The handlers of Mtek source ran against the engine: one landing, and the velocity it computed is at rest.
    expect(run.afterRest["landings"], "one collision_enter: the crate lands once and does not bounce (restitution 0)").toBe(1);
    expect(Math.abs(run.afterRest["rise"] ?? Number.NaN)).toBeLessThan(0.05);

    // Impulse response: Δv = J / m = 4 m/s, less the one step of gravity the applying step integrated, within 1 %.
    const expectedRise = 8 / 2 - GRAVITY * STEP;
    expect(Math.abs((run.afterImpulse["rise"] ?? Number.NaN) - expectedRise) / expectedRise).toBeLessThan(0.01);
    expect(run.climbing).toBeGreaterThan(run.rest + 0.03);

    expect(run.counters).toMatchObject({ physicsBodies: 2, physicsColliders: 2, physicsFrozenBodies: 0 });
    expect(run.counters["physicsSteps"]).toBe(10 + 170 + 10 + 2);
  });

  test("twenty mounts and disposals leave no body or collider behind", async ({ page }) => {
    await mount(page, PHYSICS_DROP);
    const cycles = await page.evaluate(
      async ({ target, dt }) => {
        const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
        const reported: DiagnosticLike[] = [];
        const rows: Array<{ before: Record<string, number>; after: Record<string, number>; rest: number }> = [];
        for (let i = 0; i < 20; i += 1) {
          const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
          app.debug.step(180, dt);
          const before = { ...app.debug.counters() };
          const rest = app.debug.scene().entities.find((entity) => entity.name === "Crate")?.position.y ?? Number.NaN;
          app.dispose();
          rows.push({ before, after: { ...app.debug.counters() }, rest });
        }
        return { rows, reported };
      },
      { target: TARGET, dt: STEP },
    );
    expect(cycles.reported).toEqual([]);
    expect(cycles.rows).toHaveLength(20);
    for (const row of cycles.rows) {
      expect(row.before).toMatchObject({ physicsBodies: 2, physicsColliders: 2, physicsSteps: 180 });
      expect(row.after).toMatchObject({ physicsBodies: 0, physicsColliders: 0 });
      // Every cycle is a fresh simulation: the same rest height each time, from a new world.
      expect(Math.abs(row.rest - 0.5)).toBeLessThan(0.01);
    }
    expect(new Set(cycles.rows.map((row) => row.rest)).size, "the runs are identical").toBe(1);
  });
});
