/**
 * The character-movement corpus (decision 0215) on the real Rapier engine, CPU only: stairs, slopes, obstacles, moving
 * platforms and variable fixed steps for a capsule, a sphere and a box character, driven exactly like the runtime tick
 * (platform targets, `moveCharacter`, the character's own target, `world.step()`).
 *
 * The committed document `evidence/movement/operating-ranges.json` and the table of `spec/physics.md` section 7.2 are the
 * published ranges. This file asserts (1) that a fresh measurement equals them, so any behaviour change of the adapter or
 * of Rapier fails here until the ranges are regenerated and reviewed, and (2) the rules the ranges must satisfy, read from
 * the committed document, so regenerating cannot silently publish a worse envelope.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CHARACTERS, SHAPES, loadBackend, slopeClimb, slopeSlide, stairsUp } from "./movement-harness.ts";
import type { PhysicsBackend, ShapeName } from "./movement-harness.ts";
import { STAIR_RISERS, STAIR_STEP_HEIGHTS, STAIR_TREADS, SLOPE_LIMITS, measureRanges, moveCost } from "./movement-ranges.ts";
import type { RangesDoc } from "./movement-ranges.ts";
import { TABLE_BEGIN, TABLE_END, renderTable } from "./movement-table.ts";
import { platformRun } from "./movement-scenarios.ts";

const root = resolve(import.meta.dirname, "..", "..", "..");
type Obj = { [key: string]: unknown };
const at = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((value, key) => (value as Obj)[key], o);
const num = (o: unknown, ...path: string[]): number => at(o, ...path) as number;
const str = (o: unknown, ...path: string[]): string => at(o, ...path) as string;
const f2 = (x: number): string => x.toFixed(2);

let backend: PhysicsBackend;
let committed: RangesDoc;
let fresh: RangesDoc;

beforeAll(async () => {
  backend = await loadBackend();
  committed = JSON.parse(readFileSync(resolve(root, "evidence", "movement", "operating-ranges.json"), "utf8")) as RangesDoc;
  fresh = measureRanges(backend);
}, 180_000);

describe("published operating ranges", () => {
  it("the committed document equals a fresh measurement", () => {
    expect(fresh).toEqual(committed);
    expect(`${JSON.stringify(fresh, null, 2)}\n`).toBe(readFileSync(resolve(root, "evidence", "movement", "operating-ranges.json"), "utf8"));
  });
  it("the spec table equals the one rendered from the document", () => {
    const spec = readFileSync(resolve(root, "spec", "physics.md"), "utf8");
    const begin = spec.indexOf(TABLE_BEGIN);
    const end = spec.indexOf(TABLE_END);
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    expect(spec.slice(begin + TABLE_BEGIN.length, end)).toBe(`\n${renderTable(committed)}\n`);
    expect(spec).toContain("### 7.2 Character movement operating ranges");
  });
  it("contains no absolute path and no timing", () => {
    const text = JSON.stringify(committed);
    expect(text).not.toMatch(/[A-Za-z]:[\\/]|\/Users\/|\/home\//);
    expect(text).not.toMatch(/microsecond|wall-?clock|performance/i);
  });
});

describe("stairs", () => {
  it("a box character climbs a flight cleanly iff riser <= stepHeight, for every tread", () => {
    for (const h of STAIR_STEP_HEIGHTS) {
      for (const t of STAIR_TREADS) {
        const codes = str(committed, "stairs", "climb", "box", `stepHeight ${f2(h)}`, `tread ${f2(t)}`);
        STAIR_RISERS.forEach((riser, i) => {
          expect(codes[i], `box stepHeight ${h} tread ${t} riser ${riser.toFixed(2)}`).toBe(riser <= h + 1e-9 ? "C" : "-");
        });
      }
    }
  });
  it("a round character (capsule, sphere) climbs cleanly every riser <= stepHeight whose incline is at most 40 degrees, and never one above stepHeight + 0.10 m", () => {
    for (const shape of ["capsule", "sphere"] as const) {
      for (const h of STAIR_STEP_HEIGHTS) {
        for (const t of STAIR_TREADS) {
          const codes = str(committed, "stairs", "climb", shape, `stepHeight ${f2(h)}`, `tread ${f2(t)}`);
          STAIR_RISERS.forEach((riser, i) => {
            const label = `${shape} stepHeight ${h} tread ${t} riser ${riser.toFixed(2)}`;
            if (riser <= h + 1e-9 && Math.atan(riser / t) <= (40 * Math.PI) / 180) expect(codes[i], label).toBe("C");
            if (riser > h + 0.1 + 1e-9) expect(codes[i], label).toBe("-");
          });
        }
      }
    }
  });
  it("the minimum step width counts the risers inside it: a box climbs cleanly iff (1 + floor((minWidth + skin) / tread)) * riser <= stepHeight", () => {
    for (const t of STAIR_TREADS) {
      for (const w of [0.1, 0.3, 0.6]) {
        const codes = str(committed, "stairs", "minWidth", "box", `tread ${f2(t)}`, `stepMinWidth ${f2(w)}`);
        const inside = 1 + Math.floor((w + 0.01) / t);
        for (let i = 0; i < codes.length; i++) {
          const riser = (i + 1) * 0.05;
          expect(codes[i] === "C", `box tread ${t} minWidth ${w} riser ${riser.toFixed(2)}`).toBe(inside * riser <= 0.3 + 1e-9);
        }
      }
    }
  });
  it("stepHeight 0 disables stepping: a box is blocked by every riser, a round character only rolls over risers a slope limit allows", () => {
    expect(str(committed, "stairs", "stepHeightZero", "box")).toBe("-".repeat(10));
    for (const shape of ["capsule", "sphere"] as const) {
      const radius = shape === "capsule" ? 0.3 : 0.5;
      const codes = str(committed, "stairs", "stepHeightZero", shape);
      STAIR_RISERS.forEach((riser, i) => {
        if (riser > radius * (1 - Math.cos(Math.PI / 4)) + 0.02) expect(codes[i], `${shape} riser ${riser.toFixed(2)}`).toBe("-");
      });
    }
  });
  it("descending a flight stays grounded on every tick with snap-to-ground for risers up to the snap distance, and never without it", () => {
    for (const shape of SHAPES) {
      const snapped = str(committed, "stairs", "descend", shape, "snap 0.20");
      STAIR_RISERS.forEach((riser, i) => {
        if (riser <= 0.2 + 1e-9) expect(snapped[i], `${shape} riser ${riser.toFixed(2)}`).toBe("G");
      });
      expect(str(committed, "stairs", "descend", shape, "snap 0.00")).toBe("a".repeat(10));
    }
  });
  it("a direct run agrees with the document and is not sensitive to the display (only to the fixed step)", () => {
    const direct = stairsUp(backend, "box", { riser: 0.2, tread: 0.3, stepHeight: 0.3 });
    expect(direct.climbed).toBe(true);
    expect(direct.timeRatio).toBeLessThan(1.3);
    expect(stairsUp(backend, "box", { riser: 0.35, tread: 0.3, stepHeight: 0.3 }).climbed).toBe(false);
    expect(stairsUp(backend, "box", { riser: 0.2, tread: 0.3, stepHeight: 0 }).climbed).toBe(false);
  });
});

describe("slopes", () => {
  it("climb below the limit, make no upward progress above it, and slide down under a downward push, within 0.5 degrees of the limit", () => {
    for (const shape of SHAPES) {
      for (const limit of SLOPE_LIMITS) {
        const e = at(committed, "slopes", "byShape", shape, `maxSlope ${limit}`);
        expect(Math.abs(num(e, "climbsUpToDeg") - limit), `${shape} ${limit} climbs up to`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(num(e, "slidesFromDeg") - limit), `${shape} ${limit} slides from`).toBeLessThanOrEqual(0.5);
        const climbs = str(e, "climbs");
        const slides = str(e, "slides");
        for (let a = 5, i = 0; a <= 85; a += 5, i++) {
          if (a <= limit - 1) {
            expect(climbs[i], `${shape} ${limit} climbs ${a}`).toBe("C");
            expect(slides[i], `${shape} ${limit} slides ${a}`).toBe(".");
          }
          if (a >= limit + 1) {
            expect(climbs[i], `${shape} ${limit} climbs ${a}`).toBe("-");
            expect(slides[i], `${shape} ${limit} slides ${a}`).toBe("S");
          }
        }
        expect(num(e, "heightRatioTenDegBelow")).toBeGreaterThanOrEqual(0.95);
      }
    }
  });
  it("above the limit the character gains no height at all (direct run, 8 degrees over each limit)", () => {
    for (const shape of SHAPES) for (const limit of SLOPE_LIMITS) {
      const above = slopeClimb(backend, shape, limit + 8, limit);
      expect(above.gain, `${shape} ${limit}`).toBeLessThan(0.05);
      expect(slopeSlide(backend, shape, limit + 8, limit).slides).toBe(true);
      expect(slopeSlide(backend, shape, limit - 8, limit).slides).toBe(false);
    }
  });
  it("descending a walkable slope stays grounded with snap-to-ground and reports the slope's normal", () => {
    for (const shape of SHAPES) {
      expect(str(committed, "slopes", "descent", shape, "snap 0.20", "grounded")).toBe("GGGGG");
      expect(str(committed, "slopes", "descent", shape, "snap 0.00", "grounded")).toBe("aaaaa");
      expect(num(committed, "slopes", "descent", shape, "snap 0.20", "maxNormalErrorRad")).toBeLessThanOrEqual(0.001);
    }
  });
});

describe("obstacles", () => {
  it("never penetrate a wall or a corner and slide along walls", () => {
    for (const shape of SHAPES) {
      for (const incidence of [0, 15, 45, 75]) {
        const w = at(committed, "obstacles", "walls", shape, `incidence ${incidence}`);
        expect(num(w, "penetration")).toBe(0);
        expect(num(w, "gap")).toBeGreaterThan(0.005);
        expect(num(w, "gap")).toBeLessThan(0.012);
        if (incidence > 0) expect(num(w, "slideRatio"), `${shape} ${incidence}`).toBeGreaterThanOrEqual(0.97);
        else expect(num(w, "slideRatio")).toBe(0);
      }
      for (const wedge of [90, 45, 30]) {
        const c = at(committed, "obstacles", "corners", shape, `wedge ${wedge}`);
        expect(num(c, "penetration")).toBe(0);
        expect(num(c, "jitter"), `${shape} corner ${wedge}`).toBeLessThanOrEqual(0.005);
      }
    }
  });
  it("a low ceiling and a gap need twice the skin (plus at most 5 mm) of clearance", () => {
    for (const shape of SHAPES) {
      expect(num(committed, "obstacles", "ceilings", shape, "minClearanceOverHeight")).toBeLessThanOrEqual(0.03);
      expect(num(committed, "obstacles", "ceilings", shape, "minClearanceOverHeight")).toBeGreaterThanOrEqual(0.015);
      expect(num(committed, "obstacles", "gaps", shape, "minGapOverWidth")).toBeLessThanOrEqual(0.03);
      expect(num(committed, "obstacles", "gaps", shape, "minGapOverWidth")).toBeGreaterThanOrEqual(0.015);
    }
  });
  it("a 0.01 m static wall stops every character asked for up to 1 m per tick (60 m/s at 1/60 s), head-on and at 45 degrees", () => {
    for (const shape of SHAPES) {
      expect(num(committed, "obstacles", "thinWalls", shape, "noPassUpToMetresPerTick"), shape).toBeGreaterThanOrEqual(1);
      for (const step of ["0.05", "0.1", "0.25", "0.5", "1"]) expect(str(committed, "obstacles", "thinWalls", shape, "passes", `${step} m/tick`)).toBe("0/16");
    }
  });
  it("small bumps up to stepHeight are walked over and the character returns to the floor", () => {
    for (const shape of SHAPES) {
      const codes = str(committed, "obstacles", "bumps", "byShape", shape);
      for (let i = 0; i < codes.length; i++) if ((i + 1) * 0.05 <= 0.25 + 1e-9) expect(codes[i], `${shape} bump ${((i + 1) * 0.05).toFixed(2)}`).toBe("P");
    }
    expect(str(committed, "obstacles", "bumps", "byShape", "box")).toBe("PPPPP--"); // flat feet: nothing above stepHeight
  });
});

describe("moving platforms", () => {
  it("carry a character without drift (< 1 mm), without ever leaving it behind or in the air, for translation, lift and yaw", () => {
    for (const shape of SHAPES) {
      const p = at(committed, "platforms", shape);
      for (const motion of ["horizontal", "vertical", "yaw", "walking"]) {
        expect(num(p, motion, "maxDrift"), `${shape} ${motion}`).toBeLessThan(0.001);
        expect(num(p, motion, "maxYawDrift"), `${shape} ${motion}`).toBeLessThan(0.001);
        expect(num(p, motion, "airborneTicks"), `${shape} ${motion}`).toBe(0);
      }
      expect(num(p, "horizontal", "speeds", "4")).toBe(10); // the fastest published horizontal speed
      expect(Math.min(...(at(p, "vertical", "speeds") as number[]))).toBe(-5);
      expect(Math.max(...(at(p, "yaw", "radii") as number[]))).toBe(4);
    }
  });
  it("carry false does not carry", () => {
    for (const shape of SHAPES) {
      expect(Math.abs(num(committed, "platforms", shape, "carryFalse", "characterMetresMoved"))).toBeLessThan(0.001);
      const run = platformRun(backend, shape, { motion: "yaw", speed: 1, radius: 2, carry: false });
      expect(Math.hypot(run.worldMove.x, run.worldMove.z)).toBeLessThan(0.001);
    }
  });
  it("a character on a platform that rises or falls with program gravity is neither dropped nor lifted off", () => {
    for (const shape of SHAPES) for (const speed of [-5, -2, 2, 5]) {
      const run = platformRun(backend, shape, { motion: "vertical", speed, gravity: true });
      expect(run.drift, `${shape} ${speed}`).toBeLessThan(0.001);
      expect(run.airborneTicks, `${shape} ${speed}`).toBe(0);
    }
  });
});

describe("variable fixed step", () => {
  it("final positions after 3 s agree within the published tolerances at 1/30, 1/60, 1/120 and 1/144 s", () => {
    const tolerance = { flat: 0.01, slope: 0.005, platform: 0.001, stairs: 0.4 };
    for (const shape of SHAPES) {
      for (const [course, limit] of Object.entries(tolerance)) {
        const e = at(committed, "variableStep", "byShape", shape, course);
        for (const axis of ["spreadX", "spreadY", "spreadZ"]) expect(num(e, axis), `${shape} ${course} ${axis}`).toBeLessThanOrEqual(limit);
      }
    }
  });
});

describe("cost", () => {
  it("moveCharacter with 100 characters in one world costs well under a millisecond per call (no controller churn)", () => {
    const cost = moveCost(backend, "capsule", 100, 30);
    expect(cost.calls).toBe(3000);
    expect(cost.microsecondsPerCall).toBeLessThan(1000);
  });
  it("covers the three corpus characters", () => {
    expect(SHAPES).toEqual(["capsule", "sphere", "box"]);
    const names: ShapeName[] = [...SHAPES];
    for (const name of names) expect(CHARACTERS[name].name).toBe(name);
  });
});
