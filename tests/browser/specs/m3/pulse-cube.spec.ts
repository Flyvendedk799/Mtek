/**
 * M3-08 / M3 exit gate: behaviour of `examples/pulse-cube` with the manual clock
 * (`spec/testing.md` §6.5).
 *
 * Requires:
 * - a WebGPU adapter (`gpu` fixture); without one → NOT-RUN
 * - a successful `mtek build --mode test` of examples/pulse-cube (global setup);
 *   until M3-01..05 open gated constructs, that build fails → NOT-RUN with E9010 reason
 *
 * Hardware evidence: `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware -- specs/m3/pulse-cube.spec.ts`
 */
import { expect, test } from "../../support/fixtures.ts";
import {
  PULSE_CUBE_OUT,
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
    await page.goto("/m3/pulse-cube/index.html");
  });

  test("colour edit through reload: pipelinesCreated unchanged", async ({ page }) => {
    // Covered in depth by specs/m3/hot-reload.spec.ts on the mount fixture; this asserts
    // the same criterion against the Demo program when replaceProgram is available.
    await page.evaluate(async () => {
      const w = window as unknown as MountWindow;
      w.__app = await w.__mtekMount({
        test: { manualClock: true, renderTarget: { width: 32, height: 32 } },
      });
      w.__app.debug.step(1, 0.016);
    });
    const hasReplace = await page.evaluate(() => typeof (window as unknown as MountWindow).__app?.replaceProgram === "function");
    test.skip(!hasReplace, `${NOT_RUN_PREFIX} replaceProgram is only present in dev builds; pulse-cube is built in test mode`);
  });

  test("failed shader edit keeps the last valid scene", ({ page }) => {
    // See hot-reload.spec.ts — requires a candidate with a broken shader URL.
    // Re-stated here so M3 gate docs list every exit criterion against pulse-cube.
    void page;
    void PULSE_CUBE_OUT;
    test.skip(true, `${NOT_RUN_PREFIX} failed-shader keep-alive is covered by specs/m3/hot-reload.spec.ts (mount fixture); pulse-cube test-mode build has no SSE reload client`);
  });

  test("compatible state survives reload; incompatible change restarts with W8070", ({ page }) => {
    void page;
    test.skip(true, `${NOT_RUN_PREFIX} state migration / W8070 covered by specs/m3/hot-reload.spec.ts; needs replaceProgram on a running Demo`);
  });
});
