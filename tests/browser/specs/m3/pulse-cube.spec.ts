/**
 * M3-08 / M3 exit gate: behaviour of `examples/pulse-cube` with the manual clock
 * (`spec/testing.md` §6.5).
 *
 * Requires:
 * - a WebGPU adapter (`gpu` fixture); without one → NOT-RUN
 * - a successful `mtek build --mode test` of examples/pulse-cube and its reload variants (global setup)
 *
 * Hardware evidence: `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware -- specs/m3/pulse-cube.spec.ts`
 */
import { expect, test } from "../../support/fixtures.ts";
import {
  readPulseCubeStatus,
  type PulseCubeBuildStatus,
} from "../../support/m3-fixtures.ts";
import { NOT_RUN_PREFIX } from "../../support/run-summary.ts";

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface SceneSnap {
  state: Record<string, unknown>;
  entities: Array<{
    name: string;
    position: unknown;
    rotation: Quat;
    mat?: { p: Record<string, unknown> };
  }>;
}

interface DiagnosticLike {
  code: string;
  severity: string;
  message: string;
  notes: string[];
}

interface AppLike {
  state: string;
  setInput(name: string, value: unknown): { ok: true } | { ok: false; error: { code: string; message: string } };
  pause(): void;
  resume(): void;
  replaceProgram?(candidate: unknown): Promise<{ ok: true } | { ok: false; diagnostics: DiagnosticLike[] }>;
  debug: {
    step(frames: number, dtSeconds: number): void;
    counters(): Record<string, number>;
    pressKey(code: string): void;
    releaseKey(code: string): void;
    scene(): SceneSnap;
  };
  dispose(): void;
}

interface MountWindow {
  __mtekMount: (
    options?: Record<string, unknown>,
  ) => Promise<AppLike>;
  __app?: AppLike;
  __reported?: DiagnosticLike[];
  /** Loads another build of the program (a reload candidate) from the same static server. */
  __loadProgram: (url: string) => Promise<{ default: unknown }>;
}

const DT = 1 / 60;
const SPEED = 0.7;
const ANGLE_TOL = 1e-5;

function requirePulseCubeBuilt(): PulseCubeBuildStatus {
  const status = readPulseCubeStatus();
  if (status === null) {
    test.skip(true, `${NOT_RUN_PREFIX} pulse-cube build status missing (global setup did not run buildPulseCube)`);
    throw new Error("unreachable");
  }
  if (!status.ok) {
    test.skip(true, status.reason ?? `${NOT_RUN_PREFIX} pulse-cube build failed`);
  }
  return status;
}

/** Angle of a pure +Y rotation quaternion (radians), signed by the y component of the axis. */
function yRotationAngle(q: Quat): number {
  // q = (sin(θ/2)·axis, cos(θ/2)); for axis +Y: x=0, z=0, y=sin(θ/2), w=cos(θ/2)
  return 2 * Math.atan2(q.y, q.w);
}

test.describe("pulse-cube M3 behaviour (manual clock)", () => {
  test.beforeEach(async ({ page, gpu }) => {
    void gpu;
    requirePulseCubeBuilt();
    // Served from `.out/m3/pulse-cube/` (test-mode index exposes __mtekMount).
    await page.goto("/m3/pulse-cube/index.html");
  });

  async function mount(page: import("@playwright/test").Page): Promise<void> {
    await page.evaluate(async () => {
      const w = window as unknown as MountWindow;
      const reported: DiagnosticLike[] = [];
      w.__reported = reported;
      w.__app = await w.__mtekMount({
        test: { manualClock: true, renderTarget: { width: 64, height: 64 } },
        onDiagnostic: (d: DiagnosticLike) => reported.push(d),
      });
    });
  }

  test("after N fixed steps rotation equals speed·t about +Y within 1e-5 rad", async ({ page }) => {
    await mount(page);
    const n = 60;
    const result = await page.evaluate(
      ({ n, dt }) => {
        const app = (window as unknown as MountWindow).__app!;
        app.debug.step(n, dt);
        const cube = app.debug.scene().entities.find((e) => e.name === "Cube");
        return {
          rotation: cube?.rotation,
          speed: app.debug.scene().state["speed"],
          time: n * dt,
        };
      },
      { n, dt: DT },
    );
    expect(result.speed).toBeCloseTo(SPEED, 5);
    expect(result.rotation).toBeDefined();
    const angle = yRotationAngle(result.rotation as Quat);
    const expected = SPEED * (n * DT);
    expect(Math.abs(angle - expected)).toBeLessThanOrEqual(ANGLE_TOL);
  });

  test("pressing Space reverses direction", async ({ page }) => {
    await mount(page);
    const result = await page.evaluate(({ dt }) => {
      const app = (window as unknown as MountWindow).__app!;
      app.debug.step(1, dt);
      const before = app.debug.scene().state["speed"];
      app.debug.pressKey("Space");
      app.debug.step(1, dt);
      app.debug.releaseKey("Space");
      const after = app.debug.scene().state["speed"];
      return { before, after };
    }, { dt: DT });
    expect(result.before).toBeCloseTo(SPEED, 5);
    expect(result.after).toBeCloseTo(-SPEED, 5);
  });

  test("material colour follows bind(frame.time) through pulse", async ({ page }) => {
    await mount(page);
    const result = await page.evaluate(({ dt }) => {
      const app = (window as unknown as MountWindow).__app!;
      app.debug.step(30, dt);
      const cube = app.debug.scene().entities.find((e) => e.name === "Cube");
      const phase = cube?.mat?.p?.["phase"];
      const tint = cube?.mat?.p?.["tint"];
      return { phase, tint, time: app.debug.scene().state };
    }, { dt: DT });
    // phase is bound to frame.time; after 30 steps ≈ 0.5 s
    expect(typeof result.phase === "number" || result.phase !== undefined).toBe(true);
    if (typeof result.phase === "number") {
      expect(Math.abs(result.phase - 30 * DT)).toBeLessThan(1e-3);
    }
    expect(result.tint).toBeDefined();
  });

  test('setInput("tint", "#f04f72") changes the colour at the next frame', async ({ page }) => {
    await mount(page);
    const result = await page.evaluate(({ dt }) => {
      const app = (window as unknown as MountWindow).__app!;
      app.debug.step(1, dt);
      const before = app.debug.scene().entities.find((e) => e.name === "Cube")?.mat?.p?.["tint"];
      const set = app.setInput("tint", "#f04f72");
      app.debug.step(1, dt);
      const after = app.debug.scene().entities.find((e) => e.name === "Cube")?.mat?.p?.["tint"];
      const stateTint = app.debug.scene().state["tint"];
      return { set, before, after, stateTint };
    }, { dt: DT });
    expect(result.set).toEqual({ ok: true });
    expect(result.after).not.toEqual(result.before);
    // Host-applied tint on scene state (linear or sRGB object form).
    expect(result.stateTint).toBeDefined();
  });

  test("pause → wait → resume: rotation advances only by stepped time", async ({ page }) => {
    await mount(page);
    const result = await page.evaluate(({ dt }) => {
      const app = (window as unknown as MountWindow).__app!;
      app.debug.step(10, dt);
      const mid = app.debug.scene().entities.find((e) => e.name === "Cube")!.rotation;
      app.pause();
      // Wall-clock gap would be huge; manual clock must not advance while paused.
      app.debug.step(100, dt);
      const paused = app.debug.scene().entities.find((e) => e.name === "Cube")!.rotation;
      app.resume();
      app.debug.step(5, dt);
      const after = app.debug.scene().entities.find((e) => e.name === "Cube")!.rotation;
      return { mid, paused, after };
    }, { dt: DT });
    expect(result.paused).toEqual(result.mid);
    const midAngle = yRotationAngle(result.mid);
    const afterAngle = yRotationAngle(result.after);
    expect(Math.abs(afterAngle - midAngle - SPEED * 5 * DT)).toBeLessThanOrEqual(ANGLE_TOL);
  });
});

test.describe("pulse-cube hot-reload exit criteria", () => {
  test.beforeEach(async ({ page, gpu }) => {
    void gpu;
    requirePulseCubeBuilt();
    await page.addInitScript(() => {
      (window as unknown as MountWindow).__loadProgram = (url) => import(url) as Promise<{ default: unknown }>;
    });
    await page.goto("/m3/pulse-cube/index.html");
  });

  async function mountDemo(page: import("@playwright/test").Page): Promise<void> {
    await page.evaluate(async () => {
      const w = window as unknown as MountWindow;
      const reported: DiagnosticLike[] = [];
      w.__reported = reported;
      w.__app = await w.__mtekMount({
        test: { manualClock: true, renderTarget: { width: 32, height: 32 } },
        onDiagnostic: (d: DiagnosticLike) => reported.push(d),
      });
      w.__app.debug.step(1, 0.016);
    });
  }

  test("colour edit: the existing material is updated and pipelinesCreated is unchanged", async ({ page }) => {
    await mountDemo(page);
    const result = await page.evaluate(async () => {
      const w = window as unknown as MountWindow;
      const app = w.__app!;
      const tintOf = () => app.debug.scene().entities.find((e) => e.name === "Cube")?.mat?.p?.["tint"] as
        | { r: number; g: number; b: number }
        | undefined;
      const before = { tint: tintOf(), pipelines: app.debug.counters()["pipelinesCreated"] };
      const candidate = (await w.__loadProgram("/m3/pulse-cube-colour/app.js")).default;
      const outcome = await app.replaceProgram!(candidate);
      app.debug.step(1, 0.016);
      return { outcome, before, tint: tintOf(), pipelines: app.debug.counters()["pipelinesCreated"], state: app.state };
    });
    expect(result.outcome).toEqual({ ok: true });
    expect(result.pipelines).toBe(result.before.pipelines);
    expect(result.state).toBe("running");
    // #6b5cff is blue-dominant, #f04f72 is red-dominant.
    expect(result.before.tint!.b).toBeGreaterThan(result.before.tint!.r);
    expect(result.tint!.r).toBeGreaterThan(result.tint!.b);
  });

  test("failed shader edit keeps the last valid scene", async ({ page }) => {
    await mountDemo(page);
    const before = await page.evaluate(() => {
      const app = (window as unknown as MountWindow).__app!;
      return { pipelines: app.debug.counters()["pipelinesCreated"], scene: app.debug.scene() };
    });

    const brokenHash = "b".repeat(64);
    await page.route("**/m3/pulse-cube/shaders/bbbbbbbbbbbbbbbb.wgsl", (route) =>
      route.fulfill({ status: 200, contentType: "text/plain", body: "// generated\n    let x = 1; @@error unexpected token\n" }),
    );
    await page.route("**/m3/pulse-cube/shaders/bbbbbbbbbbbbbbbb.mtek-map.json", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ shader: brokenHash, entries: [] }) }),
    );
    await page.route("**/m3/pulse-cube/program.manifest.json", async (route) => {
      const response = await route.fetch();
      const manifest = (await response.json()) as Record<string, unknown>;
      const shaders = manifest["shaders"] as Array<Record<string, unknown>>;
      const materials = manifest["materials"] as Array<Record<string, unknown>>;
      shaders[0] = { ...shaders[0], hash: brokenHash, url: "shaders/bbbbbbbbbbbbbbbb.wgsl", map: "shaders/bbbbbbbbbbbbbbbb.mtek-map.json" };
      materials[0] = { ...materials[0], shader: brokenHash };
      await route.fulfill({ response, json: manifest });
    });

    const result = await page.evaluate(async () => {
      const w = window as unknown as MountWindow;
      const app = w.__app!;
      const candidate = (await w.__loadProgram("/m3/pulse-cube/app.js")).default;
      const outcome = await app.replaceProgram!(candidate);
      app.debug.step(1, 0.016);
      return {
        outcome,
        state: app.state,
        pipelines: app.debug.counters()["pipelinesCreated"],
        scene: app.debug.scene(),
        reported: (w.__reported ?? []).map((d) => d.code),
      };
    });

    expect(result.outcome.ok).toBe(false);
    if (result.outcome.ok) throw new Error("expected the broken shader to be rejected");
    expect(result.outcome.diagnostics.some((d) => d.code === "MTEK-E8051")).toBe(true);
    expect(result.reported).toContain("MTEK-E8051");
    // The last valid scene is still running: same pipelines, same entities, and it still steps.
    expect(result.state).toBe("running");
    expect(result.pipelines).toBe(before.pipelines);
    expect(result.scene.entities.map((e) => e.name)).toEqual(before.scene.entities.map((e) => e.name));
    expect(result.scene.state["speed"]).toBeCloseTo(SPEED, 5);
  });

  test("compatible state survives reload; incompatible change restarts with W8070", async ({ page }) => {
    await mountDemo(page);
    const compatible = await page.evaluate(async ({ dt }) => {
      const w = window as unknown as MountWindow;
      const app = w.__app!;
      app.debug.pressKey("Space");
      app.debug.step(1, dt);
      app.debug.releaseKey("Space");
      app.debug.step(20, dt);
      const cubeOf = () => app.debug.scene().entities.find((e) => e.name === "Cube")!;
      const before = { speed: app.debug.scene().state["speed"], rotation: cubeOf().rotation };
      const candidate = (await w.__loadProgram("/m3/pulse-cube-colour/app.js")).default;
      const outcome = await app.replaceProgram!(candidate);
      const after = { speed: app.debug.scene().state["speed"], rotation: cubeOf().rotation };
      return { before, after, outcome, reported: (w.__reported ?? []).map((d) => d.code) };
    }, { dt: DT });
    expect(compatible.outcome).toEqual({ ok: true });
    expect(compatible.before.speed).toBeCloseTo(-SPEED, 5);
    expect(compatible.after.speed).toBeCloseTo(-SPEED, 5);
    expect(yRotationAngle(compatible.after.rotation)).toBeCloseTo(yRotationAngle(compatible.before.rotation), 5);
    expect(compatible.reported).not.toContain("MTEK-W8070");

    const incompatible = await page.evaluate(async () => {
      const w = window as unknown as MountWindow;
      const app = w.__app!;
      const candidate = (await w.__loadProgram("/m3/pulse-cube-extra/app.js")).default;
      const outcome = await app.replaceProgram!(candidate);
      app.debug.step(1, 0.016);
      const scene = app.debug.scene();
      return {
        outcome,
        names: scene.entities.map((e) => e.name),
        speed: scene.state["speed"],
        reported: (w.__reported ?? []).map((d) => ({ code: d.code, message: d.message, notes: d.notes })),
      };
    });
    expect(incompatible.outcome).toEqual({ ok: true });
    expect(incompatible.names).toContain("Extra");
    // A restart re-runs init: the toggled speed is back at its declared value.
    expect(incompatible.speed).toBeCloseTo(SPEED, 5);
    const w8070 = incompatible.reported.find((d) => d.code === "MTEK-W8070");
    expect(w8070).toBeDefined();
    expect(w8070?.notes.some((n) => n.includes("Demo.Extra"))).toBe(true);
  });
});
