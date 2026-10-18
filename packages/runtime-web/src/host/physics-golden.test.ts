/**
 * The compiler's own `physics` program (`tests/codegen/physics`, the golden `app.js` and manifest) running on the
 * real runtime with a recording fake in place of the engine (decision 0066): `ctx.body(target, spanId)` as generated,
 * the commands, the readable velocities and the collision handlers of Mtek source, end to end. The real engine runs
 * the same program in `tests/browser/specs/m5/physics.spec.ts`.
 */
import { describe, expect, it } from "vitest";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { FakePhysicsBackend, vec } from "../test-support/fake-physics.js";
import { FakeHost, asDom } from "../test-support/fake-host.js";
import { loadGoldenProgram } from "../test-support/program.js";
import { mountMtekWith } from "./mount.js";
import type { MtekApp, MtekDebug } from "./types.js";

const STEP = 0.016666668;
// The entities of `tests/codegen/physics/src/main.mtek`, by slot.
const BALL = 1;
const MOVER = 2;
const A = 3;
const B = 4;

interface Mounted {
  readonly app: MtekApp;
  readonly debug: MtekDebug;
  readonly backend: FakePhysicsBackend;
  readonly reported: MtekDiagnostic[];
  readonly host: FakeHost;
}

async function mount(): Promise<Mounted> {
  const golden = await loadGoldenProgram("physics");
  const host = new FakeHost();
  for (const [url, text] of golden.files) host.files.set(url, text);
  const backend = new FakePhysicsBackend();
  const physicsModule = golden.manifest.subsystems.physicsModule;
  if (physicsModule === undefined) throw new Error("the golden physics program names no physics module");
  host.modules.set(new URL(physicsModule, golden.program.baseUrl).href, backend.module);
  const reported: MtekDiagnostic[] = [];
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), golden.program, {
    test: { manualClock: true, renderTarget: { width: 16, height: 8 } },
    onDiagnostic: (d) => reported.push(d),
  });
  if (app.debug === undefined) throw new Error("no debug API");
  return { app, debug: app.debug, backend, reported, host };
}

function tick(m: Mounted, key?: string): string[] {
  m.backend.log.length = 0;
  if (key !== undefined) m.debug.pressKey(key);
  m.debug.step(1, STEP);
  if (key !== undefined) m.debug.releaseKey(key);
  return [...m.backend.log];
}

describe("the golden physics program on the runtime", () => {
  it("creates the world with the scene's gravity and one body per entity, in entity order", async () => {
    const m = await mount();
    expect(m.host.imported).toHaveLength(1);
    expect(m.backend.log).toEqual([
      "createWorld:0,-4.5,0:0.016666668",
      "addBody:0:static:0,-0.5,0",
      "addBody:1:dynamic:-3,4,0",
      "addBody:2:kinematic:3,0.5,0",
      // The crates' `origin` params; B's is (0.2, 3.0, 0.1) as binary32 values.
      "addBody:3:dynamic:0,1.5,0",
      `addBody:4:dynamic:${String(Math.fround(0.2))},3,${String(Math.fround(0.1))}`,
    ]);
    expect(m.reported).toEqual([]);
    m.app.dispose();
  });

  it("a key handler's commands apply in the category order of the next tick: teleports first, whatever the issue order", async () => {
    const m = await mount();
    const run = tick(m, "KeyR");
    expect(run.filter((line) => /^(teleport|impulse|linvel|force|kinematic)/.test(line))).toEqual([
      "teleport:1:-3,4,0:reset",
      "teleport:3:0,1.5,0:keep",
    ]);
    const space = tick(m, "Space");
    // Both entities that handle Space push themselves, in instance order; the Mover's target (queued by the last
    // tick) comes first: kinematic targets are applied before impulses.
    expect(space.filter((line) => /^(impulse|kinematic)/.test(line)).map((line) => (line.startsWith("kinematic:2:") ? "kinematic:2" : line))).toEqual([
      "kinematic:2",
      "impulse:3:0,5,0",
      "impulse:4:0,5,0",
    ]);
    expect(m.reported).toEqual([]);
    m.app.dispose();
  });

  it("a kinematic mover's target follows the clock, computed in fixed_update and applied in the next tick", async () => {
    const m = await mount();
    const first = tick(m);
    expect(first.some((line) => line.startsWith("kinematic"))).toBe(false);
    const second = tick(m);
    const target = second.find((line) => line.startsWith("kinematic:2:"));
    expect(target).toBeDefined();
    const x = Number(target?.split(":")[2]?.split(",")[0]);
    expect(x).toBeCloseTo(3 + Math.sin(STEP), 5);
    m.app.dispose();
  });

  it("reads the velocity of the body in fixed_update: the fastest speed is kept in the scene state", async () => {
    const m = await mount();
    m.backend.world.onStep = (world) => {
      world.body(BALL).linear = vec(3, 4, 0);
    };
    tick(m); // the solver says 3, 4, 0 after this tick...
    tick(m); // ...which the next fixed_update reads: speed 5
    expect(m.debug.scene().state["fastest"]).toBe(5);
    m.backend.world.onStep = (world) => {
      world.body(BALL).linear = vec(1, 0, 0);
    };
    tick(m);
    tick(m);
    expect(m.debug.scene().state["fastest"]).toBe(5);
    m.app.dispose();
  });

  it("delivers collisions to the handlers of Mtek source in slot order, and their commands apply in the next tick", async () => {
    const m = await mount();
    m.backend.world.collisions.push([A, BALL, true]);
    const during = tick(m);
    // Nothing the handlers asked for has reached the engine yet.
    expect(during.filter((line) => /^(impulse|force)/.test(line))).toEqual([]);
    const next = tick(m);
    // Ball (slot 1) is first in the pair: `who.body.apply_force` on the crate; then the crate (slot 3): the impulse on
    // the other body, the Ball. Impulses are applied before forces.
    expect(next.filter((line) => /^(impulse|force)/.test(line))).toEqual(["impulse:1:0,0.5,0", "force:3:0,0,-1"]);
    m.backend.world.collisions.push([BALL, A, false]);
    tick(m);
    // The exit handler of the Ball stops it: `self.body.set_linear_velocity`.
    expect(tick(m).filter((line) => line.startsWith("linvel"))).toEqual(["linvel:1:0,0,0"]);
    expect(m.reported).toEqual([]);
    m.app.dispose();
  });

  it("two crates touching tell each other, each pushing the other (a handler that targets an entity_ref)", async () => {
    const m = await mount();
    m.backend.world.collisions.push([B, A, true]);
    tick(m);
    expect(tick(m).filter((line) => /^(impulse|force)/.test(line))).toEqual(["impulse:4:0,0.5,0", "impulse:3:0,0.5,0"]);
    m.app.dispose();
  });

  it("the mover's sensor collider is one body among the others and reaches the world as a sensor", async () => {
    const m = await mount();
    expect(m.backend.world.body(MOVER).collider.sensor).toBe(true);
    expect(m.backend.world.body(MOVER).desc).toEqual({ kind: "kinematic" });
    expect(m.backend.world.body(B).desc).toEqual({ kind: "dynamic", mass: 1.5, linearDamping: 0.05, angularDamping: 0.05 });
    m.app.dispose();
  });
});
