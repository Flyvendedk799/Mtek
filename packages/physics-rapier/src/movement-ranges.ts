/**
 * The measured operating ranges of character movement (decision 0215): every sweep of the corpus, aggregated into the
 * document `evidence/movement/operating-ranges.json` and the table of `spec/physics.md` section 7.2.
 *
 * `measureRanges` is deterministic (no clocks, no randomness; Rapier is single-threaded here), so the committed document
 * is compared with a fresh run by `npm run ranges:check` and by `movement-corpus.test.ts`. Timing is never part of it:
 * `moveCost` measures the cost of a call separately and is reported, not published as a range.
 */
import { BACKEND_NAME } from "./backend.ts";
import {
  CHARACTERS,
  CONTRACT_OPTIONS,
  SHAPES,
  STEPS_DT,
  createRig,
  dispose,
  r3,
  r4,
  slopeClimb,
  slopeDescent,
  slopeSlide,
  solid,
  standY,
  stairsDown,
  stairsUp,
  v3,
  wall,
} from "./movement-harness.ts";
import type { PhysicsBackend, ShapeName } from "./movement-harness.ts";
import { STEP_COURSES, bump, ceiling, corner, courseEnd, gap, platformRun, thinWall } from "./movement-scenarios.ts";

type Json = number | string | boolean | null | Json[] | { [key: string]: Json };
export type RangesDoc = { [key: string]: Json };

export const STAIR_STEP_HEIGHTS: readonly number[] = [0.2, 0.3, 0.4];
export const STAIR_TREADS: readonly number[] = [0.15, 0.3, 0.6];
export const STAIR_RISERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => k * 0.05);
export const SLOPE_LIMITS: readonly number[] = [30, 45, 60];
export const SLOPE_ANGLES: readonly number[] = Array.from({ length: 17 }, (_, i) => 5 + 5 * i);
export const WALL_INCIDENCES: readonly number[] = [0, 15, 45, 75];
export const CORNER_WEDGES: readonly number[] = [90, 45, 30];
export const THIN_WALL_STEPS: readonly number[] = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100];
export const BUMP_HEIGHTS: readonly number[] = [1, 2, 3, 4, 5, 6, 7].map((k) => k * 0.05);
export const PLATFORM_HORIZONTAL: readonly number[] = [0.5, 1, 2, 5, 10];
export const PLATFORM_VERTICAL: readonly number[] = [0.5, 1, 2, 5, -0.5, -1, -2, -5];
export const PLATFORM_YAW: readonly number[] = [0.1, 0.5, 1, 2, 3];
export const PLATFORM_RADII: readonly number[] = [0, 1, 2, 4];
export const MIN_WIDTHS: readonly number[] = [0.1, 0.3, 0.6];

/** Characters of the corpus, as published. */
function describeCharacters(): Json {
  const out: { [key: string]: Json } = {};
  for (const shape of SHAPES) {
    const c = CHARACTERS[shape];
    out[shape] = { collider: JSON.parse(JSON.stringify(c.collider.shape)) as Json, height: c.height, width: c.width };
  }
  return out;
}

const fixed = (x: number): string => x.toFixed(2);

/** `C` clean climb (within 1.3x the unobstructed time), `S` slow climb, `-` not climbed. */
const climbCode = (r: { climbed: boolean; timeRatio: number }): string => (r.climbed ? (r.timeRatio < 1.3 ? "C" : "S") : "-");

/** Length of the leading run of `C` in a climb string, as a riser height. */
export function cleanRiser(codes: string): number {
  let n = 0;
  while (n < codes.length && codes[n] === "C") n++;
  return r3(n * 0.05);
}

/** The highest riser that climbed at all (`C` or `S`), 0 when none. */
export function topRiser(codes: string): number {
  let top = 0;
  for (let i = 0; i < codes.length; i++) if (codes[i] !== "-") top = i + 1;
  return r3(top * 0.05);
}

function stairs(backend: PhysicsBackend): Json {
  const climb: { [key: string]: Json } = {};
  const minWidth: { [key: string]: Json } = {};
  const disabled: { [key: string]: Json } = {};
  const descend: { [key: string]: Json } = {};
  for (const shape of SHAPES) {
    const byHeight: { [key: string]: Json } = {};
    for (const stepHeight of STAIR_STEP_HEIGHTS) {
      const byTread: { [key: string]: Json } = {};
      for (const tread of STAIR_TREADS) {
        const codes = STAIR_RISERS.map((riser) => climbCode(stairsUp(backend, shape, { riser, tread, stepHeight }))).join("");
        byTread[`tread ${fixed(tread)}`] = codes;
      }
      byHeight[`stepHeight ${fixed(stepHeight)}`] = byTread;
    }
    climb[shape] = byHeight;

    const byTread: { [key: string]: Json } = {};
    for (const tread of STAIR_TREADS) {
      const byMin: { [key: string]: Json } = {};
      for (const minw of MIN_WIDTHS) {
        byMin[`stepMinWidth ${fixed(minw)}`] = STAIR_RISERS.slice(0, 8)
          .map((riser) => climbCode(stairsUp(backend, shape, { riser, tread, stepHeight: 0.3, stepMinWidth: minw })))
          .join("");
      }
      byTread[`tread ${fixed(tread)}`] = byMin;
    }
    minWidth[shape] = byTread;

    disabled[shape] = STAIR_RISERS.map((riser) => climbCode(stairsUp(backend, shape, { riser, tread: 0.6, stepHeight: 0 }))).join("");

    const bySnap: { [key: string]: Json } = {};
    for (const snap of [0.2, 0]) {
      bySnap[`snap ${fixed(snap)}`] = STAIR_RISERS.map((riser) => (stairsDown(backend, shape, { riser, tread: 0.4, stepHeight: 0.25, snapToGround: snap }).groundedAll ? "G" : "a")).join("");
    }
    descend[shape] = bySnap;
  }
  return { riserSteps: "0.05 .. 0.50 by 0.05", climb, minWidth, stepHeightZero: disabled, descend };
}

/** Largest angle (degrees, 0.25 grid) at which `predicate` holds for every angle from `from` up to it; and the first that fails. */
function limits(from: number, to: number, predicate: (angle: number) => boolean): { holdsTo: number; failsFrom: number | null } {
  let holdsTo = from - 0.25;
  for (let a = from; a <= to + 1e-9; a += 0.25) {
    if (!predicate(a)) return { holdsTo, failsFrom: a };
    holdsTo = a;
  }
  return { holdsTo, failsFrom: null };
}

function slopes(backend: PhysicsBackend): Json {
  const out: { [key: string]: Json } = {};
  for (const shape of SHAPES) {
    const byLimit: { [key: string]: Json } = {};
    for (const limit of SLOPE_LIMITS) {
      const climbs = SLOPE_ANGLES.map((a) => (slopeClimb(backend, shape, a, limit).climbed ? "C" : "-")).join("");
      const slides = SLOPE_ANGLES.map((a) => (slopeSlide(backend, shape, a, limit).slides ? "S" : ".")).join("");
      const climbLimit = limits(limit - 3, limit + 3, (a) => slopeClimb(backend, shape, a, limit).climbed);
      const slideStart = limits(limit - 3, limit + 3, (a) => !slopeSlide(backend, shape, a, limit).slides);
      // The ratio of the height gained to the height the projected walk predicts, on a walkable slope (10 degrees below the limit).
      const ratio = slopeClimb(backend, shape, limit - 10, limit).ratio;
      byLimit[`maxSlope ${limit}`] = {
        angles: "5 .. 85 by 5",
        climbs,
        slides,
        climbsUpToDeg: climbLimit.holdsTo,
        firstBlockedDeg: climbLimit.failsFrom,
        slidesFromDeg: slideStart.failsFrom,
        heightRatioTenDegBelow: ratio,
      };
    }
    out[shape] = byLimit;
  }
  const descent: { [key: string]: Json } = {};
  for (const shape of SHAPES) {
    const rows: { [key: string]: Json } = {};
    for (const snap of [0.2, 0]) {
      const results = [5, 15, 25, 35, 45].map((a) => slopeDescent(backend, shape, a, snap));
      rows[`snap ${fixed(snap)}`] = {
        angles: "5 15 25 35 45",
        grounded: results.map((r) => (r.groundedAll ? "G" : "a")).join(""),
        maxNormalErrorRad: r4(Math.max(...results.map((r) => r.normalError))),
      };
    }
    descent[shape] = rows;
  }
  return { byShape: out, descent };
}

function obstacles(backend: PhysicsBackend): Json {
  const walls: { [key: string]: Json } = {};
  const corners: { [key: string]: Json } = {};
  const ceilings: { [key: string]: Json } = {};
  const gaps: { [key: string]: Json } = {};
  const thin: { [key: string]: Json } = {};
  const bumps: { [key: string]: Json } = {};
  for (const shape of SHAPES) {
    const spec = CHARACTERS[shape];
    const w: { [key: string]: Json } = {};
    for (const incidence of WALL_INCIDENCES) {
      const r = wall(backend, shape, incidence);
      w[`incidence ${incidence}`] = { penetration: r.penetration, gap: r.gap, slideRatio: r.slideRatio };
    }
    walls[shape] = w;

    const c: { [key: string]: Json } = {};
    for (const wedge of CORNER_WEDGES) {
      const runs = [0, 20, -20].map((off) => corner(backend, shape, wedge, off));
      c[`wedge ${wedge}`] = { penetration: Math.max(...runs.map((r) => r.penetration)), jitter: Math.max(...runs.map((r) => r.jitter)), depth: runs[0]!.depth };
    }
    corners[shape] = c;

    // Smallest clearance (over the character's height) and gap (over its width) that is passable, on a 5 mm grid.
    let clearance: number | null = null;
    for (let d = -0.05; d <= 0.1001; d += 0.005) if (ceiling(backend, shape, spec.height + d).passed) { clearance = r3(d); break; }
    ceilings[shape] = { minClearanceOverHeight: clearance, blockedBelow: clearance === null ? null : r3(clearance - 0.005) };
    let opening: number | null = null;
    for (let d = -0.05; d <= 0.1001; d += 0.005) if (gap(backend, shape, spec.width + d).passed) { opening = r3(d); break; }
    gaps[shape] = { minGapOverWidth: opening, blockedBelow: opening === null ? null : r3(opening - 0.005) };

    const passes: { [key: string]: Json } = {};
    let safe = 0;
    let stillSafe = true;
    for (const step of THIN_WALL_STEPS) {
      const r = thinWall(backend, shape, step);
      passes[`${step} m/tick`] = `${r.passes}/${r.runs}`;
      if (r.passes > 0) stillSafe = false;
      if (stillSafe) safe = step;
    }
    thin[shape] = { passes, noPassUpToMetresPerTick: safe };

    bumps[shape] = BUMP_HEIGHTS.map((h) => (bump(backend, shape, h).passed ? "P" : "-")).join("");
  }
  return { walls, corners, ceilings, gaps, thinWalls: thin, bumps: { heights: "0.05 .. 0.35 by 0.05 (stepHeight 0.25)", byShape: bumps } };
}

function platforms(backend: PhysicsBackend): Json {
  const out: { [key: string]: Json } = {};
  for (const shape of SHAPES) {
    const group = (runs: ReturnType<typeof platformRun>[]): Json => ({
      maxDrift: Math.max(...runs.map((r) => r.drift)),
      maxYawDrift: Math.max(...runs.map((r) => r.yawDrift)),
      airborneTicks: Math.max(...runs.map((r) => r.airborneTicks)),
    });
    const horizontal = PLATFORM_HORIZONTAL.map((speed) => platformRun(backend, shape, { motion: "horizontal", speed }));
    const vertical = PLATFORM_VERTICAL.map((speed) => platformRun(backend, shape, { motion: "vertical", speed }));
    const yaw: ReturnType<typeof platformRun>[] = [];
    for (const speed of PLATFORM_YAW) for (const radius of PLATFORM_RADII) yaw.push(platformRun(backend, shape, { motion: "yaw", speed, radius }));
    const walking = [
      platformRun(backend, shape, { motion: "horizontal", speed: 3, walk: 1.5 }),
      platformRun(backend, shape, { motion: "yaw", speed: 1, radius: 1, walk: 1 }),
      platformRun(backend, shape, { motion: "vertical", speed: -4, gravity: true }),
    ];
    const noCarry = platformRun(backend, shape, { motion: "horizontal", speed: 2, carry: false });
    out[shape] = {
      horizontal: { speeds: [...PLATFORM_HORIZONTAL], ...(group(horizontal) as { [key: string]: Json }) },
      vertical: { speeds: [...PLATFORM_VERTICAL], ...(group(vertical) as { [key: string]: Json }) },
      yaw: { speeds: [...PLATFORM_YAW], radii: [...PLATFORM_RADII], ...(group(yaw) as { [key: string]: Json }) },
      walking: group(walking),
      carryFalse: { platformMetresMoved: 3, characterMetresMoved: noCarry.worldMove.x },
    };
  }
  return out;
}

function variableStep(backend: PhysicsBackend): Json {
  const out: { [key: string]: Json } = {};
  for (const shape of SHAPES) {
    const byCourse: { [key: string]: Json } = {};
    for (const course of STEP_COURSES) {
      const ends = STEPS_DT.map((dt) => courseEnd(backend, shape, course, dt));
      const spread = (f: (p: { x: number; y: number; z: number }) => number): number => Math.max(...ends.map(f)) - Math.min(...ends.map(f));
      byCourse[course] = {
        endX: ends.map((e) => r3(e.x)),
        endY: ends.map((e) => r3(e.y)),
        spreadX: r3(spread((p) => p.x)),
        spreadY: r3(spread((p) => p.y)),
        spreadZ: r3(spread((p) => p.z)),
      };
    }
    out[shape] = byCourse;
  }
  return { steps: ["1/30", "1/60", "1/120", "1/144"], duration: "3 s", byShape: out };
}

/** The whole document. Deterministic: `JSON.stringify(measureRanges(b), null, 2)` is what is committed. */
export function measureRanges(backend: PhysicsBackend): RangesDoc {
  return {
    schema: 1,
    adapter: BACKEND_NAME,
    decision: "0215",
    tick: "1/60 s unless stated",
    options: { ...CONTRACT_OPTIONS } as Json,
    characters: describeCharacters(),
    stairs: stairs(backend),
    slopes: slopes(backend),
    obstacles: obstacles(backend),
    platforms: platforms(backend),
    variableStep: variableStep(backend),
  };
}

export interface MoveCost {
  readonly characters: number;
  readonly calls: number;
  /** Mean wall-clock microseconds per `moveCharacter` call on this machine. */
  readonly microsecondsPerCall: number;
  /** Mean wall-clock microseconds of a whole tick (moves, targets and `world.step`) per character. */
  readonly microsecondsPerCharacterTick: number;
}

/** Wall-clock cost of `moveCharacter` with `characters` characters walking on a floor of one world (informative; not in the document). */
export function moveCost(backend: PhysicsBackend, shape: ShapeName, characters = 100, ticks = 120): MoveCost {
  const spec = CHARACTERS[shape];
  const first = createRig(backend, shape, v3(0, standY(spec, 0), 0));
  try {
    solid(first, v3(-200, -1, -200), v3(200, 0, 200));
    const bodies = [first.body];
    for (let i = 1; i < characters; i++) {
      const col = i % 10, row = Math.floor(i / 10);
      bodies.push(first.world.addBody({ kind: "kinematic" }, spec.collider, { position: v3(col * 3 - 15, standY(spec, 0), row * 3 - 15), rotation: { x: 0, y: 0, z: 0, w: 1 } }, 1000 + i));
    }
    first.world.step();
    const run = (n: number): { moves: number; moveMs: number; totalMs: number } => {
      let moveMs = 0;
      const t0 = performance.now();
      for (let t = 0; t < n; t++) {
        for (const body of bodies) {
          const pose = first.world.readPose(body);
          const m0 = performance.now();
          const move = first.world.moveCharacter!(body, v3(0.03, 0, 0.01), { ...first.options, rotation: pose.rotation });
          moveMs += performance.now() - m0;
          first.world.setKinematicTarget(body, { position: { x: pose.position.x + move.displacement.x, y: pose.position.y + move.displacement.y, z: pose.position.z + move.displacement.z }, rotation: move.rotation });
        }
        first.world.step();
      }
      return { moves: n * bodies.length, moveMs, totalMs: performance.now() - t0 };
    };
    run(10); // warm-up
    const r = run(ticks);
    return { characters, calls: r.moves, microsecondsPerCall: Math.round((r.moveMs / r.moves) * 1000), microsecondsPerCharacterTick: Math.round((r.totalMs / r.moves) * 1000) };
  } finally {
    dispose(first);
  }
}
