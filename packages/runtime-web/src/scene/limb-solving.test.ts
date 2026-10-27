/**
 * Measured behaviour of the anatomical limb solver (decision 0222). What this file asserts is what `spec/animation.md`
 * section 3 publishes: the bounds of `BOUNDS` hold on every rig and limb of the sweeps, and the committed evidence file and
 * the table in the specification equal a fresh measurement.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BOUNDS, buildEvidence, formatEvidence, renderTable, type LimbEvidence } from "./limb-evidence.js";

const root = path.resolve(__dirname, "../../../..");
const read = (file: string): string => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
let evidence: LimbEvidence;
beforeAll(() => { evidence = buildEvidence(); }, 120_000);

describe("published limb-solving bounds", () => {
  it("covers four rigs with all four limbs, and the sweeps are large", () => {
    expect(new Set(evidence.reach.map(r => r.rig)).size).toBe(4);
    expect(evidence.reach).toHaveLength(16);
    expect(evidence.reach.reduce((n, r) => n + r.targets, 0)).toBeGreaterThanOrEqual(30_000);
    expect(evidence.range.reduce((n, r) => n + r.targets, 0)).toBeGreaterThanOrEqual(150_000);
    expect(evidence.beyond.reduce((n, r) => n + r.samples, 0)).toBeGreaterThanOrEqual(70_000);
    expect(evidence.placement.reduce((n, r) => n + r.cases, 0)).toBeGreaterThanOrEqual(80);
  });
  it("meets every reachable target", () => {
    for (const r of evidence.reach) expect(r.maxRelativeError, `${r.rig} ${r.limb}`).toBeLessThanOrEqual(BOUNDS.reachRelativeError);
  });
  it("behaves beyond reach: soft clamp toward the target, monotone, never past full extension", () => {
    for (const r of evidence.beyond) {
      expect(r.maxReachFraction, `${r.rig} ${r.limb}`).toBeLessThanOrEqual(BOUNDS.maxReachFraction);
      expect(r.monotoneViolations).toBe(0);
      expect(r.maxDirectionError).toBeLessThanOrEqual(BOUNDS.directionError);
      const ends = r.profile.map(p => p.end);
      expect(ends).toEqual([...ends].sort((a, b) => a - b));
      expect(ends[0]).toBeCloseTo(0.95, 3); // inside the exact shell
      expect(ends[1]!).toBeLessThan(0.995); // full reach itself is already eased
    }
  });
  it("keeps the middle joint in its anatomical range and never bends backwards", () => {
    for (const r of evidence.range) {
      expect(r.rangeViolations, `${r.rig} ${r.limb}`).toBe(BOUNDS.rangeViolations);
      expect(r.reverseBends).toBe(BOUNDS.reverseBends);
      expect(r.kneeBackViolations).toBe(BOUNDS.kneeBackViolations);
      expect(r.nonFinite).toBe(BOUNDS.nonFinite);
      expect(r.minFlexionDegrees).toBeGreaterThanOrEqual(0);
      expect(r.maxFlexionDegrees).toBeLessThanOrEqual(r.limb.endsWith("Leg") ? 150 : 145);
    }
    for (const r of evidence.degenerate) expect(r.nonFinite, `${r.rig} ${r.limb}`).toBe(0);
  });
  it("is continuous along continuous target paths, and the softness is what makes it so", () => {
    let soft = 0, hard = 0;
    for (const row of evidence.continuity) for (const p of row.paths) {
      if (row.softness > 0) { expect(p.maxStepRatio, `${row.rig} ${row.limb} ${p.path}`).toBeLessThanOrEqual(BOUNDS.maxStepRatio); soft = Math.max(soft, p.maxStepRatio); }
      else hard = Math.max(hard, p.maxStepRatio);
    }
    // Away from the singular direction (up for a leg) the joints turn at the rate of the target: 1 / 0.8 per unit of travel on a great circle at 0.8 reach.
    for (const row of evidence.continuity.filter(r => r.softness > 0 && r.rig === "upright" && r.limb.endsWith("Leg"))) {
      for (const p of row.paths.filter(p => p.path.startsWith("circle") || p.path.startsWith("great circle through"))) expect(p.maxStepRatio).toBeLessThan(1.3);
    }
    expect(hard).toBeGreaterThan(5 * soft);
  });
  it("places the feet: hips lowered by the independent minimum, never raised, feet and normals met", () => {
    for (const r of evidence.placement) {
      expect(r.maxDropError, r.rig).toBeLessThanOrEqual(BOUNDS.dropError);
      expect(r.maxFootError).toBeLessThanOrEqual(BOUNDS.footError);
      expect(r.raised).toBe(0);
      expect(r.maxNormalErrorRad).toBeLessThanOrEqual(BOUNDS.normalError);
      expect(r.maxDrop).toBeGreaterThan(0.05);
    }
    for (const r of evidence.identity) { expect(r.maxPoseDifference).toBeLessThanOrEqual(BOUNDS.identityDifference); expect(r.drop).toBe(0); }
    expect(evidence.smoothing.maxDeviation).toBeLessThanOrEqual(BOUNDS.smoothingDeviation);
    expect(evidence.smoothing.monotone).toBe(true);
  });
  it("publishes exactly what it measured: the evidence file and the table in the specification", () => {
    expect(read("evidence/animation/limb-solving.json")).toBe(formatEvidence(evidence));
    const spec = read("spec/animation.md"), begin = "<!-- limb-solving:begin -->", end = "<!-- limb-solving:end -->";
    expect(spec.slice(spec.indexOf(begin) + begin.length, spec.indexOf(end)).trim()).toBe(renderTable(evidence).trim());
  });
});
