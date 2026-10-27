/**
 * The continuous-collision lane matrix of decision 0216: one shot flies along +x at a thin plate whose midplane is at
 * x = 5, in a world without gravity, on the Rapier adapter, with continuous collision off and on. Shared by the
 * regression test (`ccd-matrix.test.ts`) and the evidence script (`scripts/measure-ccd-lanes.ts`), so the table the
 * specification publishes and the envelope the test asserts come from the same code.
 *
 * Only types are imported: the script runs this file under Node's type stripping.
 */
import type { BodyDesc, ColliderDesc, PhysicsBackend, PhysicsWorld, Quat, Vec3 } from "../../runtime-web/src/physics/types.js";

/** The manifest's fixed step (a binary32 value, decision 0066 item 12). */
export const DT = 0.016666668;
/** x of the obstacle's midplane. */
export const WALL = 5;
/** Rapier's prediction distance in metres (decision 0063 item 5): the discrete contact test sees a pair closer than this. */
export const PREDICTION = 0.02;

export const SPEEDS = [3, 6, 9, 12, 20, 40, 60, 120, 240] as const;
export const THICKNESSES = [0.01, 0.05, 0.1] as const;
/** Phases of the first sample against the step: the shot starts `(i + 0.5) / PHASES` of a step off the grid. */
export const PHASES = 16;
export const SHAPES = ["sphere", "box", "capsule"] as const;
export type ShotShape = (typeof SHAPES)[number];

/** Mass of the heavy plate (the D06 setup) and of the light plate and the shot, in kg. */
export const HEAVY_MASS = 10_000;
export const LIGHT_MASS = 1;

/**
 * How an obstacle is built and how it moves. `velocity` is along x in m/s: a kinematic obstacle is driven at it with
 * `setKinematicTarget` every tick; a dynamic one starts with it and coasts (there is no gravity and no damping).
 */
export interface ObstacleSpec {
  readonly body: "static" | "kinematic" | "dynamic";
  readonly mass: number;
  readonly velocity: number;
}

export const OBSTACLE_SPECS = {
  static: { body: "static", mass: 0, velocity: 0 },
  "kinematic-toward": { body: "kinematic", mass: 0, velocity: -1 },
  "kinematic-away": { body: "kinematic", mass: 0, velocity: 1 },
  "dynamic-heavy": { body: "dynamic", mass: HEAVY_MASS, velocity: 0 },
  "dynamic-light": { body: "dynamic", mass: LIGHT_MASS, velocity: 0 },
  // Obstacles that move fast on their own: where the envelope ends (probes, not part of the published envelope).
  "kinematic-toward-3": { body: "kinematic", mass: 0, velocity: -3 },
  "kinematic-toward-6": { body: "kinematic", mass: 0, velocity: -6 },
  "kinematic-toward-12": { body: "kinematic", mass: 0, velocity: -12 },
  "kinematic-away-3": { body: "kinematic", mass: 0, velocity: 3 },
  "kinematic-away-6": { body: "kinematic", mass: 0, velocity: 6 },
  "dynamic-heavy-toward-0.5": { body: "dynamic", mass: HEAVY_MASS, velocity: -0.5 },
  "dynamic-heavy-toward-1": { body: "dynamic", mass: HEAVY_MASS, velocity: -1 },
  "dynamic-heavy-toward-2": { body: "dynamic", mass: HEAVY_MASS, velocity: -2 },
  "dynamic-heavy-toward-3": { body: "dynamic", mass: HEAVY_MASS, velocity: -3 },
  "dynamic-heavy-toward-6": { body: "dynamic", mass: HEAVY_MASS, velocity: -6 },
  "dynamic-heavy-toward-12": { body: "dynamic", mass: HEAVY_MASS, velocity: -12 },
  "dynamic-light-toward-3": { body: "dynamic", mass: LIGHT_MASS, velocity: -3 },
  "dynamic-light-toward-12": { body: "dynamic", mass: LIGHT_MASS, velocity: -12 },
} as const satisfies Record<string, ObstacleSpec>;
export type Obstacle = keyof typeof OBSTACLE_SPECS;

/** The obstacles of the published envelope (decision 0216 item 2). */
export const OBSTACLES: readonly Obstacle[] = ["static", "kinematic-toward", "kinematic-away", "dynamic-heavy", "dynamic-light"];
/** The probes of obstacles that move fast; the table reports them as the limit of the envelope. */
export const FAST_OBSTACLES: readonly Obstacle[] = [
  "kinematic-toward-3",
  "kinematic-toward-6",
  "kinematic-toward-12",
  "kinematic-away-3",
  "kinematic-away-6",
  "dynamic-heavy-toward-0.5",
  "dynamic-heavy-toward-1",
  "dynamic-heavy-toward-2",
  "dynamic-heavy-toward-3",
  "dynamic-heavy-toward-6",
  "dynamic-heavy-toward-12",
  "dynamic-light-toward-3",
  "dynamic-light-toward-12",
];

export interface Lane {
  readonly continuous: boolean;
  readonly shape: ShotShape;
  readonly obstacle: Obstacle;
  readonly thickness: number;
  readonly speed: number;
  /** 0 .. PHASES - 1 */
  readonly phase: number;
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const v3 = (x: number, y = 0, z = 0): Vec3 => ({ x, y, z });
const at = (x: number) => ({ position: v3(x), rotation: IDENTITY });

/** The shot's collider: sphere r 0.05, cube 0.1, capsule r 0.05 and height 0.3 (its axis is Y, so it flies broadside). */
export function shotCollider(shape: ShotShape): ColliderDesc {
  const common = { sensor: false, friction: 0.5, restitution: 0 } as const;
  switch (shape) {
    case "sphere":
      return { shape: { kind: "sphere", radius: 0.05 }, ...common };
    case "box":
      return { shape: { kind: "box", size: v3(0.1, 0.1, 0.1) }, ...common };
    case "capsule":
      return { shape: { kind: "capsule", radius: 0.05, height: 0.3 }, ...common };
  }
}

function obstacleBody(spec: ObstacleSpec, continuous: boolean): BodyDesc {
  switch (spec.body) {
    case "static":
      return { kind: "static" };
    case "kinematic":
      return { kind: "kinematic" };
    case "dynamic":
      return { kind: "dynamic", mass: spec.mass, linearDamping: 0, angularDamping: 0, continuousCollision: continuous };
  }
}

export interface LaneResult {
  readonly tunnelled: boolean;
  /** x of the shot and of the obstacle at the end. */
  readonly shotX: number;
  readonly obstacleX: number;
}

/**
 * Runs one lane on a fresh world of `backend`. The shot (a dynamic body of 1 kg) starts more than a metre from the
 * obstacle, with `gapOffset` metres added to the distance in front of the plate's centre, and flies at `speed`.
 * `tunnelled` is true when its centre ends beyond the obstacle's centre.
 */
export function runLaneAt(backend: PhysicsBackend, lane: Omit<Lane, "phase">, firstGap: number): LaneResult {
  const spec: ObstacleSpec = OBSTACLE_SPECS[lane.obstacle];
  const world: PhysicsWorld = backend.createWorld(v3(0), DT);
  try {
    const slab: ColliderDesc = { shape: { kind: "box", size: v3(lane.thickness, 4, 4) }, sensor: false, friction: 0.5, restitution: 0 };
    const obstacle = world.addBody(obstacleBody(spec, lane.continuous), slab, at(WALL), 1);
    if (spec.body === "dynamic" && spec.velocity !== 0) world.setLinearVelocity(obstacle, v3(spec.velocity));
    const shot = world.addBody(
      { kind: "dynamic", mass: LIGHT_MASS, linearDamping: 0, angularDamping: 0, continuousCollision: lane.continuous },
      shotCollider(lane.shape),
      at(WALL - firstGap),
      2,
    );
    world.setLinearVelocity(shot, v3(lane.speed));
    const closing = lane.speed - spec.velocity;
    const ticks = Math.ceil(firstGap / (closing * DT)) + 40;
    for (let tick = 1; tick <= ticks; tick += 1) {
      if (spec.body === "kinematic") world.setKinematicTarget(obstacle, at(WALL + spec.velocity * DT * tick));
      world.step();
    }
    const shotX = world.readPose(shot).position.x;
    const obstacleX = world.readPose(obstacle).position.x;
    return { tunnelled: shotX > obstacleX, shotX, obstacleX };
  } finally {
    world.dispose();
  }
}

/** The start distance of phase `phase`: more than a metre, a whole number of closing steps plus the phase's fraction of one. */
export function phaseGap(lane: Omit<Lane, "phase">, phase: number, phases: number = PHASES): number {
  const closing = lane.speed - OBSTACLE_SPECS[lane.obstacle].velocity;
  const stride = closing * DT;
  return (Math.ceil(1 / stride) + (phase + 0.5) / phases) * stride;
}

/** Runs one lane of the matrix. */
export function runLane(backend: PhysicsBackend, lane: Lane): LaneResult {
  return runLaneAt(backend, lane, phaseGap(lane, lane.phase));
}

export interface Cell {
  readonly continuous: boolean;
  readonly shape: ShotShape;
  readonly obstacle: Obstacle;
  readonly thickness: number;
  readonly speed: number;
  /** Phases (of PHASES) in which the shot ended on the far side. */
  readonly tunnelled: number;
}

/** Every cell for `obstacles`, in a fixed order; each cell runs all `PHASES` phases. */
export function runMatrix(backend: PhysicsBackend, obstacles: readonly Obstacle[] = OBSTACLES): Cell[] {
  const cells: Cell[] = [];
  for (const continuous of [false, true]) {
    for (const obstacle of obstacles) {
      for (const shape of SHAPES) {
        for (const thickness of THICKNESSES) {
          for (const speed of SPEEDS) {
            // A shot that is not faster than an obstacle moving away never reaches it: no lane.
            if (speed <= OBSTACLE_SPECS[obstacle].velocity) continue;
            let tunnelled = 0;
            for (let phase = 0; phase < PHASES; phase += 1) {
              if (runLane(backend, { continuous, shape, obstacle, thickness, speed, phase }).tunnelled) tunnelled += 1;
            }
            cells.push({ continuous, shape, obstacle, thickness, speed, tunnelled });
          }
        }
      }
    }
  }
  return cells;
}

// ---- the fine scan: the residual that a coarse phase grid can miss ------------------------------------------------

/** The shapes, obstacles, thicknesses and speeds of the fine scan; each cell runs `FINE_PHASES` phases. */
export const FINE_PHASES = 500;
export const FINE_OBSTACLES: readonly Obstacle[] = ["static", "dynamic-heavy"];
export const FINE_SPEEDS = [6, 12, 60, 240] as const;

export interface FineCell {
  readonly shape: ShotShape;
  readonly obstacle: Obstacle;
  readonly thickness: number;
  readonly speed: number;
  /** Of `FINE_PHASES`, with continuous collision on. */
  readonly tunnelled: number;
}

/** Continuous collision on, `FINE_PHASES` start positions per cell instead of `PHASES`. */
export function runFineScan(backend: PhysicsBackend): FineCell[] {
  const cells: FineCell[] = [];
  for (const obstacle of FINE_OBSTACLES) {
    for (const shape of SHAPES) {
      for (const thickness of THICKNESSES) {
        for (const speed of FINE_SPEEDS) {
          const lane = { continuous: true, shape, obstacle, thickness, speed } as const;
          let tunnelled = 0;
          for (let phase = 0; phase < FINE_PHASES; phase += 1) {
            if (runLaneAt(backend, lane, phaseGap(lane, phase, FINE_PHASES)).tunnelled) tunnelled += 1;
          }
          cells.push({ shape, obstacle, thickness, speed, tunnelled });
        }
      }
    }
  }
  return cells;
}

// ---- the evidence file and the table of spec/physics.md section 7.1 ------------------------------------------------

/** One row of the matrix: the tunnelled phases per entry of `SPEEDS`, -1 where the shot cannot reach the obstacle. */
export interface MatrixRow {
  readonly ccd: "off" | "on";
  readonly obstacle: Obstacle;
  readonly shape: ShotShape;
  readonly thickness: number;
  readonly tunnelled: readonly number[];
}

export interface Evidence {
  readonly schema: 1;
  readonly decision: "0216";
  readonly backend: string;
  readonly fixedStep: number;
  readonly predictionDistance: number;
  readonly phases: number;
  readonly speeds: readonly number[];
  readonly thicknesses: readonly number[];
  readonly shapes: readonly ShotShape[];
  readonly envelopeObstacles: readonly Obstacle[];
  readonly probeObstacles: readonly Obstacle[];
  readonly obstacles: Readonly<Record<string, ObstacleSpec>>;
  readonly matrix: readonly MatrixRow[];
  readonly fineScan: {
    readonly phases: number;
    readonly speeds: readonly number[];
    readonly cells: readonly FineCell[];
  };
}

export function buildEvidence(backend: PhysicsBackend): Evidence {
  const all = [...OBSTACLES, ...FAST_OBSTACLES];
  const cells = runMatrix(backend, all);
  const matrix: MatrixRow[] = [];
  for (const ccd of ["off", "on"] as const) {
    for (const obstacle of all) {
      for (const shape of SHAPES) {
        for (const thickness of THICKNESSES) {
          const tunnelled = SPEEDS.map((speed) => {
            const cell = cells.find((c) => c.continuous === (ccd === "on") && c.obstacle === obstacle && c.shape === shape && c.thickness === thickness && c.speed === speed);
            return cell === undefined ? -1 : cell.tunnelled;
          });
          matrix.push({ ccd, obstacle, shape, thickness, tunnelled });
        }
      }
    }
  }
  const obstacles: Record<string, ObstacleSpec> = {};
  for (const id of all) obstacles[id] = OBSTACLE_SPECS[id];
  return {
    schema: 1,
    decision: "0216",
    backend: backend.name,
    fixedStep: DT,
    predictionDistance: PREDICTION,
    phases: PHASES,
    speeds: SPEEDS,
    thicknesses: THICKNESSES,
    shapes: SHAPES,
    envelopeObstacles: OBSTACLES,
    probeObstacles: FAST_OBSTACLES,
    obstacles,
    matrix,
    fineScan: { phases: FINE_PHASES, speeds: FINE_SPEEDS, cells: runFineScan(backend) },
  };
}

/** The evidence file's text: indented JSON with the short numeric arrays on one line, one trailing newline. */
export function formatEvidence(evidence: Evidence): string {
  const text = JSON.stringify(evidence, null, 2);
  return text.replace(/\[\n((?:\s+-?[\d.e+-]+,?\n)+)\s+\]/g, (_all, body: string) => `[${body.trim().replace(/\s*\n\s*/g, " ")}]`) + "\n";
}

/** Tunnelled phases of all lanes of one obstacle at one speed, summed over shapes and thicknesses, with the lane count. */
function share(evidence: Evidence, ccd: "off" | "on", obstacle: Obstacle, speedIndex: number): { tunnelled: number; lanes: number } {
  let tunnelled = 0;
  let lanes = 0;
  for (const row of evidence.matrix) {
    if (row.ccd !== ccd || row.obstacle !== obstacle) continue;
    const n = row.tunnelled[speedIndex] ?? -1;
    if (n < 0) continue;
    tunnelled += n;
    lanes += evidence.phases;
  }
  return { tunnelled, lanes };
}

function describe(id: Obstacle): string {
  const spec: ObstacleSpec = OBSTACLE_SPECS[id];
  const mass = spec.mass === HEAVY_MASS ? "10 000 kg" : "1 kg";
  const speed = Math.abs(spec.velocity);
  const way = spec.velocity < 0 ? "toward the shot" : "away from the shot";
  switch (spec.body) {
    case "static":
      return "static wall";
    case "kinematic":
      return `kinematic wall, ${String(speed)} m/s ${way}`;
    case "dynamic":
      return speed === 0 ? `dynamic plate, ${mass}, at rest` : `dynamic plate, ${mass}, ${String(speed)} m/s ${way}`;
  }
}

function percent(tunnelled: number, lanes: number): string {
  if (lanes === 0) return "-";
  if (tunnelled === 0) return "0";
  return String(Math.max(1, Math.round((100 * tunnelled) / lanes)));
}

function matrixTable(evidence: Evidence, obstacles: readonly Obstacle[]): string[] {
  const lines = [`| Obstacle | ${evidence.speeds.map((s) => `${String(s)} m/s`).join(" | ")} |`, `|---|${evidence.speeds.map(() => "---:").join("|")}|`];
  for (const obstacle of obstacles) {
    const cells = evidence.speeds.map((_, i) => {
      const off = share(evidence, "off", obstacle, i);
      const on = share(evidence, "on", obstacle, i);
      return `${percent(off.tunnelled, off.lanes)} / ${percent(on.tunnelled, on.lanes)}`;
    });
    lines.push(`| ${describe(obstacle)} | ${cells.join(" | ")} |`);
  }
  return lines;
}

/** The text between the markers of `spec/physics.md` section 7.1 (without the markers). */
export function renderTable(evidence: Evidence): string {
  const perCell = evidence.shapes.length * evidence.thicknesses.length * evidence.phases;
  let envelopeLanes = 0;
  let envelopeTunnelled = 0;
  for (const obstacle of evidence.envelopeObstacles) {
    evidence.speeds.forEach((_, i) => {
      const on = share(evidence, "on", obstacle, i);
      envelopeLanes += on.lanes;
      envelopeTunnelled += on.tunnelled;
    });
  }
  const lines: string[] = [];
  lines.push(
    `Generated by \`npm run ccd:write\` from \`evidence/movement/ccd-lanes.json\` (${evidence.backend}, fixed step ${String(evidence.fixedStep)} s, ${String(evidence.phases)} start phases). Each entry is the share of lanes, in percent, in which the shot ended beyond the obstacle's centre: **continuous collision off / on**. A lane is one shot shape (sphere r 0.05 m, cube 0.1 m, capsule r 0.05 m and 0.3 m high), one thickness (${evidence.thicknesses.map(String).join(", ")} m) and one start phase: ${String(perCell)} lanes per entry. "-" means the shot is not faster than the obstacle moving away.`,
  );
  lines.push("");
  lines.push(`**The published envelope** (continuous collision on: ${String(envelopeTunnelled)} tunnelled of ${String(envelopeLanes)} lanes):`);
  lines.push("");
  lines.push(...matrixTable(evidence, evidence.envelopeObstacles));
  lines.push("");
  lines.push("**Beyond the envelope: obstacles that move faster on their own.**");
  lines.push("");
  lines.push(...matrixTable(evidence, evidence.probeObstacles));
  lines.push("");
  const fineTotal = evidence.fineScan.cells.length * evidence.fineScan.phases;
  const fineHits = evidence.fineScan.cells.filter((c) => c.tunnelled > 0);
  const hitList = fineHits.map((c) => `${c.shape} vs ${c.obstacle === "static" ? "static wall" : "plate"} ${String(c.thickness)} m at ${String(c.speed)} m/s: ${String(c.tunnelled)}`).join("; ");
  lines.push(
    `**Fine scan** (continuous collision on, ${String(evidence.fineScan.phases)} start phases per cell, static wall and 10 000 kg plate, every shape and thickness, ${evidence.fineScan.speeds.map((s) => `${String(s)} m/s`).join(", ")}): ${String(fineHits.reduce((n, c) => n + c.tunnelled, 0))} tunnelled of ${String(fineTotal)} lanes.${fineHits.length === 0 ? "" : ` Cells with a tunnelled lane: ${hitList}.`}`,
  );
  return lines.join("\n");
}
