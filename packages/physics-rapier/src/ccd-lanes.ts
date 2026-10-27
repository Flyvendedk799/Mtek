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
  "dynamic-light-toward-1": { body: "dynamic", mass: LIGHT_MASS, velocity: -1 },
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
  "dynamic-light-toward-1",
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
  readonly ccd: "off" | "on";
  readonly shape: ShotShape;
  readonly obstacle: Obstacle;
  readonly thickness: number;
  readonly speed: number;
  /** Of `FINE_PHASES`. */
  readonly tunnelled: number;
  /**
   * Range, in metres rounded to 0.1 mm, of the gap between the shot's front and the plate's near face at the last
   * step before the shot is past the face, over the tunnelled lanes (null when none): where the engine does not see it.
   */
  readonly gap: readonly [number, number] | null;
}

/** `FINE_PHASES` start positions per cell instead of `PHASES`, with continuous collision off and on. */
export function runFineScan(backend: PhysicsBackend): FineCell[] {
  const cells: FineCell[] = [];
  for (const ccd of ["off", "on"] as const) {
    for (const obstacle of FINE_OBSTACLES) {
      for (const shape of SHAPES) {
        for (const thickness of THICKNESSES) {
          for (const speed of FINE_SPEEDS) {
            const lane = { continuous: ccd === "on", shape, obstacle, thickness, speed } as const;
            const stride = speed * DT;
            const face = WALL - thickness / 2;
            let tunnelled = 0;
            let low = Number.POSITIVE_INFINITY;
            let high = Number.NEGATIVE_INFINITY;
            for (let phase = 0; phase < FINE_PHASES; phase += 1) {
              const firstGap = phaseGap(lane, phase, FINE_PHASES);
              if (!runLaneAt(backend, lane, firstGap).tunnelled) continue;
              tunnelled += 1;
              // The obstacle is at rest: the shot's front (0.05 m ahead of its centre in every shape) is at
              // `WALL - firstGap + 0.05 + k * stride` at sample k; take the last one that is not past the near face.
              const front = WALL - firstGap + 0.05;
              const k = Math.floor((face - front) / stride);
              const gap = face - (front + k * stride);
              low = Math.min(low, gap);
              high = Math.max(high, gap);
            }
            const round = (value: number): number => Math.round(value * 1e4) / 1e4;
            cells.push({ ccd, shape, obstacle, thickness, speed, tunnelled, gap: tunnelled === 0 ? null : [round(low), round(high)] });
          }
        }
      }
    }
  }
  return cells;
}

// ---- the edge scan and the speed probes ----------------------------------------------------------------------------

/**
 * The edge scan: the speeds between the matrix's nine, 1.5 to 14 m/s in steps of 0.25, against the obstacles that
 * move at most 1 m/s (continuous collision on). The matrix's grid cannot show a hole between two speeds, and the
 * flag rule of the adapter has exactly such a hole one margin too wide (`CCD_FLAG_MARGIN`, a shot of 3.75 m/s).
 */
export const EDGE_SPEEDS: readonly number[] = Array.from({ length: 51 }, (_, i) => 1.5 + 0.25 * i);
export const EDGE_OBSTACLES: readonly Obstacle[] = [
  "dynamic-heavy",
  "kinematic-toward",
  "kinematic-away",
  "dynamic-heavy-toward-0.5",
  "dynamic-heavy-toward-1",
  "dynamic-light-toward-1",
];

export interface EdgeCell {
  readonly obstacle: Obstacle;
  readonly shape: ShotShape;
  readonly thickness: number;
  /** Lanes run: speeds x PHASES (kinematic walls moving away are only reached by faster shots). */
  readonly lanes: number;
  readonly tunnelled: number;
  /** The speeds with at least one tunnelled lane. */
  readonly speeds: readonly number[];
}

export function runEdgeScan(backend: PhysicsBackend): EdgeCell[] {
  const cells: EdgeCell[] = [];
  for (const obstacle of EDGE_OBSTACLES) {
    for (const shape of SHAPES) {
      for (const thickness of THICKNESSES) {
        let lanes = 0;
        let tunnelled = 0;
        const bad: number[] = [];
        for (const speed of EDGE_SPEEDS) {
          if (speed <= OBSTACLE_SPECS[obstacle].velocity + 0.5) continue;
          let n = 0;
          for (let phase = 0; phase < PHASES; phase += 1) {
            if (runLane(backend, { continuous: true, shape, obstacle, thickness, speed, phase }).tunnelled) n += 1;
          }
          lanes += PHASES;
          tunnelled += n;
          if (n > 0) bad.push(speed);
        }
        cells.push({ obstacle, shape, thickness, lanes, tunnelled, speeds: bad });
      }
    }
  }
  return cells;
}

/** Speeds above the matrix's range, continuous collision on: where the envelope ends in speed. */
export const HIGH_SPEEDS = [250, 255, 260, 300, 400, 1000, 3000] as const;
export const HIGH_OBSTACLES: readonly Obstacle[] = ["static", "dynamic-heavy", "dynamic-light", "kinematic-toward", "dynamic-heavy-toward-1"];

export interface HighRow {
  readonly obstacle: Obstacle;
  readonly shape: ShotShape;
  readonly thickness: number;
  /** Tunnelled phases of PHASES per entry of `HIGH_SPEEDS`. */
  readonly tunnelled: readonly number[];
}

export function runHighSpeeds(backend: PhysicsBackend): HighRow[] {
  const rows: HighRow[] = [];
  for (const obstacle of HIGH_OBSTACLES) {
    for (const shape of SHAPES) {
      for (const thickness of THICKNESSES) {
        const tunnelled = HIGH_SPEEDS.map((speed) => {
          let n = 0;
          for (let phase = 0; phase < PHASES; phase += 1) {
            if (runLane(backend, { continuous: true, shape, obstacle, thickness, speed, phase }).tunnelled) n += 1;
          }
          return n;
        });
        rows.push({ obstacle, shape, thickness, tunnelled });
      }
    }
  }
  return rows;
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
    readonly obstacles: readonly Obstacle[];
    readonly cells: readonly FineCell[];
  };
  readonly edgeScan: {
    readonly speeds: readonly number[];
    readonly cells: readonly EdgeCell[];
  };
  readonly highSpeeds: {
    readonly speeds: readonly number[];
    readonly rows: readonly HighRow[];
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
    fineScan: { phases: FINE_PHASES, speeds: FINE_SPEEDS, obstacles: FINE_OBSTACLES, cells: runFineScan(backend) },
    edgeScan: { speeds: EDGE_SPEEDS, cells: runEdgeScan(backend) },
    highSpeeds: { speeds: HIGH_SPEEDS, rows: runHighSpeeds(backend) },
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
  lines.push("**Obstacles that move on their own, around the edge of the envelope:** an obstacle moving 1 m/s or less toward the shot (or away from it at any speed tested) is inside; faster ones are outside, with the result shown.");
  lines.push("");
  lines.push(...matrixTable(evidence, evidence.probeObstacles));
  lines.push("");
  const edgeLanes = evidence.edgeScan.cells.reduce((n, c) => n + c.lanes, 0);
  const edgeTunnelled = evidence.edgeScan.cells.reduce((n, c) => n + c.tunnelled, 0);
  const edgeFirst = evidence.edgeScan.speeds[0] ?? 0;
  const edgeLast = evidence.edgeScan.speeds[evidence.edgeScan.speeds.length - 1] ?? 0;
  lines.push(
    `**Edge scan** (continuous collision on): the speeds between the nine of the matrix, ${String(edgeFirst)} to ${String(edgeLast)} m/s in steps of ${String((evidence.edgeScan.speeds[1] ?? 0) - edgeFirst)} m/s, against the obstacles of 1 m/s or less (a dynamic plate of 10 000 kg at rest, a kinematic wall toward or away, dynamic plates of 10 000 kg and 1 kg moving 0.5 or 1 m/s toward the shot), every shape and thickness, ${String(evidence.phases)} phases: ${String(edgeTunnelled)} tunnelled of ${String(edgeLanes)} lanes.`,
  );
  lines.push("");
  lines.push(`**Speeds above the matrix** (continuous collision on; tunnelled share of ${String(evidence.shapes.length * evidence.thicknesses.length * evidence.phases)} lanes, in percent):`);
  lines.push("");
  lines.push(`| Obstacle | ${evidence.highSpeeds.speeds.map((s) => `${String(s)} m/s`).join(" | ")} |`, `|---|${evidence.highSpeeds.speeds.map(() => "---:").join("|")}|`);
  for (const obstacle of HIGH_OBSTACLES) {
    const selected = evidence.highSpeeds.rows.filter((row) => row.obstacle === obstacle);
    const entries = evidence.highSpeeds.speeds.map((_, i) => percent(selected.reduce((n, row) => n + (row.tunnelled[i] ?? 0), 0), selected.length * evidence.phases));
    lines.push(`| ${describe(obstacle)} | ${entries.join(" | ")} |`);
  }
  const highHits = evidence.highSpeeds.rows.filter((row) => row.tunnelled.some((n) => n > 0));
  if (highHits.length > 0) {
    lines.push("");
    lines.push(
      `Shape and thickness of the rows with a tunnelled lane: ${highHits.map((row) => `${row.shape} against ${describe(row.obstacle)}, ${String(row.thickness)} m`).join("; ")}.`,
    );
  }
  lines.push("");
  const perShape = evidence.thicknesses.length * evidence.fineScan.speeds.length * evidence.fineScan.phases;
  lines.push(
    `**Fine scan:** ${String(evidence.fineScan.phases)} start phases per cell instead of ${String(evidence.phases)}, at ${evidence.fineScan.speeds.map((s) => `${String(s)} m/s`).join(", ")}, every thickness; tunnelled lanes of ${String(perShape)} per shape. The last column is the gap between the shot's front and the obstacle's near face one step before the shot was past it, over the tunnelled lanes (the discrete contact test sees a pair closer than ${String(evidence.predictionDistance * 1000)} mm).`,
  );
  lines.push("");
  lines.push("| Continuous collision | Obstacle | Sphere | Capsule | Cube | Gap of the tunnelled lanes |", "|---|---|---:|---:|---:|---|");
  for (const ccd of ["off", "on"] as const) {
    for (const obstacle of evidence.fineScan.obstacles) {
      const selected = evidence.fineScan.cells.filter((c) => c.ccd === ccd && c.obstacle === obstacle);
      const count = (shape: ShotShape): number => selected.filter((c) => c.shape === shape).reduce((n, c) => n + c.tunnelled, 0);
      const gaps = selected.flatMap((c) => (c.gap === null ? [] : [...c.gap]));
      const range = gaps.length === 0 ? "-" : `${(Math.min(...gaps) * 1000).toFixed(1)} to ${(Math.max(...gaps) * 1000).toFixed(1)} mm`;
      lines.push(`| ${ccd} | ${describe(obstacle)} | ${String(count("sphere"))} | ${String(count("capsule"))} | ${String(count("box"))} | ${range} |`);
    }
  }
  return lines.join("\n");
}
