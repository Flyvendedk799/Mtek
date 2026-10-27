/**
 * Continuous collision coverage (decision 0216, acceptance item 7 of decision 0214): the lane matrix of `ccd-lanes.ts`
 * on the real engine. Speeds {3 .. 240} m/s x 16 start phases x three shot shapes x five obstacles x three
 * thicknesses, with continuous collision off and on. What this file asserts is exactly what `spec/physics.md`
 * section 7.1 publishes:
 *
 *  - inside the envelope (static walls, kinematic walls moving at 1 m/s toward or away from the shot, dynamic plates at
 *    rest, 1 kg or 10 000 kg) nothing tunnels with continuous collision on, and the fine scan finds only the box-shaped
 *    residual of one prediction-distance boundary;
 *  - with continuous collision off the documented discrete findings still hold (the window model, static walls never
 *    passed by balls and capsules);
 *  - the envelope ends where the table says (obstacles that move faster on their own still tunnel);
 *  - lanes D00 .. D16 of the browser fixture `physics_tunnel`, with the flag on EVERY dynamic body as the mounted host
 *    sets it, are all stopped (D06 and D08 were not);
 *  - teleports are not swept;
 *  - the committed evidence file and the table in the specification equal a fresh measurement.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { BodyDesc, ColliderDesc, PhysicsBackend, PhysicsWorld, Quat, Vec3 } from "../../runtime-web/src/physics/types.js";
import {
  DT,
  FAST_OBSTACLES,
  OBSTACLES,
  PHASES,
  PREDICTION,
  SPEEDS,
  THICKNESSES,
  buildEvidence,
  formatEvidence,
  renderTable,
  type Evidence,
  type MatrixRow,
} from "./ccd-lanes.js";
import loadPhysics from "./index.js";

let backend: PhysicsBackend;
let evidence: Evidence;

beforeAll(async () => {
  backend = await loadPhysics();
  evidence = buildEvidence(backend);
}, 120_000);

function rows(ccd: "off" | "on", obstacle: string): MatrixRow[] {
  return evidence.matrix.filter((row) => row.ccd === ccd && row.obstacle === obstacle);
}

describe("the published envelope: continuous collision on", () => {
  for (const obstacle of OBSTACLES) {
    it(`${obstacle}: no lane tunnels (3 shapes x 3 thicknesses x 9 speeds x ${String(PHASES)} phases)`, () => {
      const selected = rows("on", obstacle);
      expect(selected).toHaveLength(9);
      for (const row of selected) {
        row.tunnelled.forEach((n, i) => {
          expect(n, `${row.shape}, ${String(row.thickness)} m, ${String(SPEEDS[i])} m/s`).toBe(0);
        });
      }
    });
  }

  it("covers the lanes it claims: nine speeds, sixteen phases, three shapes, three thicknesses, five obstacles", () => {
    expect(SPEEDS).toEqual([3, 6, 9, 12, 20, 40, 60, 120, 240]);
    expect(PHASES).toBe(16);
    expect(THICKNESSES).toEqual([0.01, 0.05, 0.1]);
    expect(OBSTACLES).toEqual(["static", "kinematic-toward", "kinematic-away", "dynamic-heavy", "dynamic-light"]);
    expect(evidence.shapes).toEqual(["sphere", "box", "capsule"]);
    // Every lane of the envelope exists (the kinematic walls move at 1 m/s, so every speed reaches them).
    for (const obstacle of OBSTACLES) for (const row of rows("on", obstacle)) expect(row.tunnelled.every((n) => n >= 0)).toBe(true);
  });

  it("the fine scan (500 phases per cell) finds no sphere or capsule lane and under 0.1 % box lanes", () => {
    const cells = evidence.fineScan.cells;
    expect(cells).toHaveLength(2 * 3 * 3 * 4);
    const hits = cells.filter((cell) => cell.tunnelled > 0);
    expect(hits.filter((cell) => cell.shape !== "box")).toEqual([]);
    const total = cells.length * evidence.fineScan.phases;
    expect(hits.reduce((sum, cell) => sum + cell.tunnelled, 0)).toBeLessThan(total / 1000);
    // Every one is a box against a plate that is not already crossed, and no cell loses more than two phases.
    for (const cell of hits) expect(cell.tunnelled).toBeLessThanOrEqual(2);
  });
});

describe("the envelope ends where the table says", () => {
  const lanes = (obstacle: string): number => rows("on", obstacle).reduce((sum, row) => sum + row.tunnelled.reduce((n, t) => n + Math.max(t, 0), 0), 0);

  it("obstacles moving toward the shot at 0.5 and 1 m/s are inside the envelope", () => {
    for (const obstacle of ["dynamic-heavy-toward-0.5", "dynamic-heavy-toward-1"]) expect(lanes(obstacle), obstacle).toBe(0);
  });

  it("kinematic walls moving away are inside the envelope up to 6 m/s", () => {
    for (const obstacle of ["kinematic-away-3", "kinematic-away-6"]) expect(lanes(obstacle), obstacle).toBe(0);
  });

  it("obstacles that move faster toward the shot still tunnel with continuous collision on (an honest negative result)", () => {
    for (const obstacle of FAST_OBSTACLES.filter((id) => /toward-(2|3|6|12)$/.test(id))) expect(lanes(obstacle), obstacle).toBeGreaterThan(0);
  });

  it("a dynamic plate that moves fast is itself flagged and the pair is left to the discrete test: no gain at all from 6 m/s", () => {
    // Speeds from index 1 (6 m/s): at 3 m/s the slow shot is unflagged and the fast plate sweeps itself, a partial gain.
    const sum = (ccd: "off" | "on", obstacle: string): number => rows(ccd, obstacle).reduce((s, row) => s + row.tunnelled.slice(1).reduce((n, t) => n + t, 0), 0);
    for (const obstacle of ["dynamic-heavy-toward-6", "dynamic-heavy-toward-12"]) {
      expect(sum("on", obstacle), obstacle).toBe(sum("off", obstacle));
      expect(sum("on", obstacle), obstacle).toBeGreaterThan(0);
    }
  });
});

describe("continuous collision off: the documented discrete findings are unchanged", () => {
  it("balls and capsules are never passed by a static wall, at any speed or thickness", () => {
    for (const row of rows("off", "static")) {
      if (row.shape === "box") continue;
      expect(row.tunnelled.every((n) => n === 0), `${row.shape} ${String(row.thickness)} m`).toBe(true);
    }
  });

  it("a ball against a dynamic plate follows the window model: none at or below the window, 1 - window / step above it", () => {
    const radius = 0.05;
    for (const obstacle of ["dynamic-heavy", "dynamic-light"]) {
      for (const row of rows("off", obstacle).filter((r) => r.shape === "sphere")) {
        row.tunnelled.forEach((n, i) => {
          const speed = SPEEDS[i] ?? 0;
          const window = row.thickness / 2 + radius + PREDICTION;
          const step = speed * DT;
          const expected = step <= window ? 0 : PHASES * (1 - window / step);
          expect(Math.abs(n - expected), `${obstacle}, ${String(row.thickness)} m, ${String(speed)} m/s: ${String(n)} of ${String(PHASES)}, model ${expected.toFixed(1)}`).toBeLessThanOrEqual(1.6);
        });
      }
    }
  });

  it("a kinematic wall that moves toward the shot is no safer than a dynamic plate", () => {
    const total = (obstacle: string): number => rows("off", obstacle).reduce((s, row) => s + row.tunnelled.reduce((n, t) => n + t, 0), 0);
    expect(total("kinematic-toward")).toBeGreaterThanOrEqual(total("dynamic-heavy"));
    expect(total("dynamic-heavy")).toBeGreaterThan(0);
  });
});

// ---- lanes D00 .. D16 of the browser fixture (tests/browser/fixtures/m5/physics_tunnel) -------------------------------

/** The lane table of the fixture: x0 and speed of D00 .. D16. */
const FIXTURE_LANES: readonly (readonly [number, number])[] = [
  [3.0, 3.0],
  [3.0, 6.0],
  [3.05, 6.0],
  [3.0, 7.0],
  [3.04, 7.0],
  [3.0, 9.0],
  [3.065, 9.0],
  [3.3, 12.0],
  [3.24, 12.0],
  [3.95, 30.0],
  [3.84, 30.0],
  [3.9, 60.0],
  [3.84, 60.0],
  [2.9, 120.0],
  [2.84, 120.0],
  [0.9, 240.0],
  [0.84, 240.0],
];
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const v3 = (x: number, y = 0, z = 0): Vec3 => ({ x, y, z });

/** The fixture: a 2 m x 2 m x 0.1 m plate of 10 000 kg at x = 5 and a ball of 1 kg and radius 0.05 m, 120 ticks, no gravity. */
function fixtureLane(x0: number, speed: number, continuous: boolean): { shotX: number; plateX: number } {
  const world: PhysicsWorld = backend.createWorld(v3(0), DT);
  try {
    const plateBody: BodyDesc = { kind: "dynamic", mass: 10_000, linearDamping: 0, angularDamping: 0, continuousCollision: continuous };
    const plateCollider: ColliderDesc = { shape: { kind: "box", size: v3(0.1, 2, 2) }, sensor: false, friction: 0.5, restitution: 0 };
    const plate = world.addBody(plateBody, plateCollider, { position: v3(5), rotation: IDENTITY }, 1);
    const shotBody: BodyDesc = { kind: "dynamic", mass: 1, linearDamping: 0, angularDamping: 0, continuousCollision: continuous };
    const shotCollider: ColliderDesc = { shape: { kind: "sphere", radius: 0.05 }, sensor: false, friction: 0.5, restitution: 0 };
    const shot = world.addBody(shotBody, shotCollider, { position: v3(x0), rotation: IDENTITY }, 2);
    world.setLinearVelocity(shot, v3(speed));
    for (let tick = 0; tick < 120; tick += 1) world.step();
    return { shotX: world.readPose(shot).position.x, plateX: world.readPose(plate).position.x };
  } finally {
    world.dispose();
  }
}

describe("lanes D00 .. D16 of the browser fixture, with the flag on every dynamic body (the mounted host)", () => {
  it("D06 and D08 are stopped, and so is every other lane", () => {
    expect(FIXTURE_LANES).toHaveLength(17);
    FIXTURE_LANES.forEach(([x0, speed], index) => {
      const name = `D${String(index).padStart(2, "0")}`;
      const { shotX, plateX } = fixtureLane(x0, speed, true);
      // Stopped on the near side of the plate: the ball's centre is 0.05 m before the plate's near face (x = 4.95).
      expect(shotX, `${name} (${String(speed)} m/s from ${String(x0)}): ball x = ${String(shotX)}`).toBeGreaterThan(4.85);
      expect(shotX, name).toBeLessThan(plateX - 0.05);
    });
  });

  it("with the flag off the lanes the window model predicts to pass still pass (D06, D08, D10, D12, D14, D16), unchanged", () => {
    const passing = new Set([6, 8, 10, 12, 14, 16]);
    FIXTURE_LANES.forEach(([x0, speed], index) => {
      const { shotX } = fixtureLane(x0, speed, false);
      if (passing.has(index)) expect(shotX, `D${String(index)}`).toBeCloseTo(x0 + speed * 120 * DT, 1);
      else expect(shotX, `D${String(index)}`).toBeLessThan(5);
    });
  });
});

// ---- teleports and resting contacts -----------------------------------------------------------------------------------

describe("teleports are not swept", () => {
  it("a continuous body moved across a wall by a teleport is not stopped by it, and one that flew is", () => {
    const run = (teleport: boolean): number => {
      const world = backend.createWorld(v3(0), DT);
      try {
        world.addBody({ kind: "static" }, { shape: { kind: "box", size: v3(0.1, 4, 4) }, sensor: false, friction: 0.5, restitution: 0 }, { position: v3(5), rotation: IDENTITY }, 1);
        const shot = world.addBody(
          { kind: "dynamic", mass: 1, linearDamping: 0, angularDamping: 0, continuousCollision: true },
          { shape: { kind: "sphere", radius: 0.05 }, sensor: false, friction: 0.5, restitution: 0 },
          { position: v3(3), rotation: IDENTITY },
          2,
        );
        world.setLinearVelocity(shot, v3(60));
        world.step();
        if (teleport) world.teleport(shot, { position: v3(6), rotation: IDENTITY }, true);
        for (let tick = 0; tick < 30; tick += 1) world.step();
        return world.readPose(shot).position.x;
      } finally {
        world.dispose();
      }
    };
    expect(run(false), "flew into the wall").toBeLessThan(5);
    expect(run(true), "teleported across the wall").toBeGreaterThan(6);
  });
});

describe("continuous collision does not disturb resting contacts", () => {
  it("a stack of four crates and a ball come to the same rest poses with the flag on and off", () => {
    const settle = (continuous: boolean): number[] => {
      const world = backend.createWorld(v3(0, -9.81, 0), DT);
      try {
        world.addBody({ kind: "static" }, { shape: { kind: "box", size: v3(40, 1, 40) }, sensor: false, friction: 0.5, restitution: 0 }, { position: v3(0, -0.5, 0), rotation: IDENTITY }, 1);
        const handles = [0, 1, 2, 3].map((i) =>
          world.addBody(
            { kind: "dynamic", mass: 1, linearDamping: 0, angularDamping: 0, continuousCollision: continuous },
            { shape: { kind: "box", size: v3(1, 1, 1) }, sensor: false, friction: 0.5, restitution: 0 },
            { position: v3(0, 0.5 + i * 1.05, 0), rotation: IDENTITY },
            10 + i,
          ),
        );
        const ball = world.addBody(
          { kind: "dynamic", mass: 1, linearDamping: 0, angularDamping: 0, continuousCollision: continuous },
          { shape: { kind: "sphere", radius: 0.5 }, sensor: false, friction: 0.5, restitution: 0 },
          { position: v3(5, 0.5, 0), rotation: IDENTITY },
          20,
        );
        for (let tick = 0; tick < 600; tick += 1) world.step();
        return [...handles, ball].map((h) => world.readPose(h).position.y);
      } finally {
        world.dispose();
      }
    };
    const off = settle(false);
    const on = settle(true);
    off.forEach((y, i) => expect(Math.abs(on[i]! - y), `body ${String(i)}`).toBeLessThan(1e-3));
    expect(off[3]).toBeGreaterThan(3.4);
    expect(off[3]).toBeLessThan(3.8);
  });
});

// ---- the evidence ---------------------------------------------------------------------------------------------------

describe("the committed evidence", () => {
  const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it("evidence/movement/ccd-lanes.json equals a fresh measurement (run `npm run ccd:write` after an intended change)", () => {
    expect(formatEvidence(evidence)).toBe(read("../../../evidence/movement/ccd-lanes.json"));
  });

  it("the table in spec/physics.md section 7.1 equals the fresh measurement", () => {
    const spec = read("../../../spec/physics.md");
    const begin = spec.indexOf("<!-- ccd-lanes:begin -->");
    const end = spec.indexOf("<!-- ccd-lanes:end -->");
    expect(begin).toBeGreaterThan(0);
    expect(spec.slice(begin + "<!-- ccd-lanes:begin -->".length, end).trim()).toBe(renderTable(evidence).trim());
  });
});
