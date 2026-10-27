// Test support (not shipped): the measurements published for decision 0221 (evidence/animation/humanoid-retarget.json and
// the table in spec/animation.md section 2). Used by the unit tests, which assert the bounds, and by
// scripts/measure-humanoid-retarget.ts, which writes and checks the published files.
import type { MtekSkin } from "../abi/manifest-types.js";
import { OPTIONAL_HUMANOID_BONES, REQUIRED_HUMANOID_BONES, mapHumanoid, type HumanoidBone, type HumanoidMap } from "../scene/humanoid.js";
import { retargetHumanoid } from "../scene/humanoid-retarget.js";
import {
  CONVENTION_IDS, buildHumanoid, expectedBones, loadRealSkins, withClips,
  type Frame, type HumanoidSpec, type ProceduralClip, type Rest,
} from "./humanoid-fixtures.js";
import { measureRetarget, type RetargetMetrics } from "./humanoid-metrics.js";

const EXTRAS = { props: true, twists: true, tail: true, fingers: true, face: true } as const;

/** Bounds the unit tests assert, per measurement. Each is the measured worst case over the rows plus a margin of at least 25 %. */
export const BOUNDS = {
  /** Worst limb-segment direction error (degrees) after rest correction. */
  limbErrorDeg: 0.02,
  /** The uncorrected transfer must be at least this bad where the rest poses differ (shows the corrected rows measure something). */
  naiveLimbErrorMinDeg: 25,
  /** |hip-joint height ratio / leg-length ratio - 1|. */
  hipsRatioError: 0.02,
  /** Stance ankle height above the bind ankle plane against the source scaled by the leg ratio, in leg lengths. */
  footHeightError: 0.01,
  /** Foot slide in stance (leg lengths per second) when thigh:shin proportions match, and across different rigs. */
  slideSynthetic: 0.02,
  slideReal: 0.05,
} as const;

export interface MappingRow {
  readonly skeleton: string;
  readonly required: string;
  readonly optionalFound: readonly string[];
  readonly unmapped: readonly string[];
  readonly nameEvidence: number;
  readonly structureEvidence: number;
  readonly confidence: number;
}
export interface RetargetRow extends RetargetMetrics {
  readonly scenario: string;
  readonly clip: string;
  readonly naiveMaxLimbErrorDeg: number;
  readonly hipsRatioError: number;
  readonly real: boolean;
}

export const round = (x: number, places: number): number => Math.round(x * 10 ** places) / 10 ** places;

/** Variant matrix: every convention under every rest pose, mesh frame and bone-axis convention, with all extras. */
export function* variantMatrix(): Generator<{ id: string; spec: HumanoidSpec }> {
  for (const convention of CONVENTION_IDS)
    for (const rest of ["T", "A", "Abent"] as Rest[])
      for (const frame of ["yup", "zup", "back"] as Frame[])
        for (const axes of ["world", "bone"] as const)
          yield { id: `${convention}/${rest}/${frame}/${axes}`, spec: { convention, rest, frame, axes, extras: EXTRAS } };
}

/** Proportion and unit variants of every convention (leg, arm and spine lengths, centimetres and decimetres). */
export function* proportionMatrix(): Generator<{ id: string; spec: HumanoidSpec }> {
  const variants = [
    { id: "long legs", legs: 1.4 }, { id: "short legs", legs: 0.7 }, { id: "short arms", arms: 0.6 }, { id: "long arms", arms: 1.5 },
    { id: "tall spine", spine: 1.6 }, { id: "short spine", spine: 0.6 }, { id: "centimetres", scale: 100 }, { id: "tiny", scale: 0.01 },
  ];
  for (const convention of CONVENTION_IDS)
    for (const { id, ...rest } of variants) yield { id: `${convention}/${id}`, spec: { convention, rest: "A", extras: EXTRAS, ...rest } };
}

export function mappingRow(skeleton: string, skin: MtekSkin, expected?: Record<string, string>): MappingRow {
  const map = mapHumanoid(skin);
  if ("error" in map) return { skeleton, required: `rejected: ${map.error}`, optionalFound: [], unmapped: [], nameEvidence: 0, structureEvidence: 0, confidence: 0 };
  const correct = REQUIRED_HUMANOID_BONES.filter((b) => map.bones[b] !== undefined && (expected === undefined || map.bones[b] === expected[b])).length;
  const evidence = Object.values(map.evidence);
  return {
    skeleton, required: `${correct}/${REQUIRED_HUMANOID_BONES.length}`,
    optionalFound: OPTIONAL_HUMANOID_BONES.filter((b) => map.bones[b] !== undefined), unmapped: map.unmapped,
    nameEvidence: evidence.filter((e) => e === "name").length, structureEvidence: evidence.filter((e) => e === "structure").length, confidence: map.confidence,
  };
}

/** Whether a map of a fixture names exactly the bones the fixture was built with. */
export function mapsExactly(map: HumanoidMap | { error: string }, expected: Record<string, string>): boolean {
  if ("error" in map) return false;
  const bones = map.bones as Record<string, string>;
  return Object.keys(expected).every((b) => bones[b] === expected[b]) && Object.keys(bones).every((b) => expected[b] !== undefined);
}

interface Scenario { readonly id: string; readonly source: MtekSkin; readonly target: MtekSkin; readonly clips: readonly string[]; readonly real: boolean }

export function scenarios(root: string): Scenario[] {
  const walkWave: ProceduralClip[] = ["walk", "wave"];
  const synthetic = (id: string, a: HumanoidSpec, b: HumanoidSpec): Scenario => ({ id, source: withClips(buildHumanoid(a), walkWave).skin, target: buildHumanoid(b).skin, clips: walkWave, real: false });
  const real = loadRealSkins(root), clip = real.cesiumMan.clips[0]!.name;
  return [
    synthetic("Mixamo T-pose to Unreal A-pose", { convention: "mixamo", rest: "T" }, { convention: "unreal", rest: "A" }),
    synthetic("Unreal A-pose to Mixamo T-pose", { convention: "unreal", rest: "A" }, { convention: "mixamo", rest: "T" }),
    synthetic("VRM T-pose legs x1.2 to Rigify bent-knee A-pose arms x0.8", { convention: "vrm", rest: "T", legs: 1.2, extras: EXTRAS }, { convention: "rigify", rest: "Abent", arms: 0.8, extras: EXTRAS }),
    synthetic("Unity T-pose Z-up to plain A-pose, spine x1.2, centimetres, bone axes", { convention: "unity", rest: "T", frame: "zup", axes: "bone" }, { convention: "plain", rest: "A", spine: 1.2, scale: 100, axes: "bone" }),
    synthetic("Scrambled names A-pose facing back to VRM T-pose legs x0.85", { convention: "scrambled", rest: "A", frame: "back", extras: EXTRAS }, { convention: "vrm", rest: "T", legs: 0.85 }),
    { id: "CesiumMan to CesiumMan with legs x1.2, arms x0.9", source: real.cesiumMan, target: real.cesiumLongLegs, clips: [clip], real: true },
    { id: "CesiumMan to Mixamo T-pose (Z-up)", source: real.cesiumMan, target: buildHumanoid({ convention: "mixamo", rest: "T", frame: "zup", extras: EXTRAS }).skin, clips: [clip], real: true },
    { id: "Mixamo A-pose walk to CesiumMan", source: withClips(buildHumanoid({ convention: "mixamo", rest: "A" }), ["walk"]).skin, target: real.cesiumMan, clips: ["walk"], real: true },
  ];
}

export function retargetRows(root: string): RetargetRow[] {
  const rows: RetargetRow[] = [];
  for (const sc of scenarios(root)) {
    const sourceMap = mapHumanoid(sc.source), targetMap = mapHumanoid(sc.target);
    if ("error" in sourceMap || "error" in targetMap) throw new Error(`scenario ${sc.id} does not map`);
    const corrected = retargetHumanoid(sc.source, sc.target, { sourceMap, targetMap }), naive = retargetHumanoid(sc.source, sc.target, { sourceMap, targetMap, restCorrection: false });
    for (const clip of sc.clips) {
      const m = measureRetarget(sc.source, sourceMap, corrected, targetMap, clip), n = measureRetarget(sc.source, sourceMap, naive, targetMap, clip);
      rows.push({ ...m, scenario: sc.id, clip, naiveMaxLimbErrorDeg: n.maxLimbErrorDeg, hipsRatioError: Math.abs(m.hipsHeightRatio / m.legRatio - 1), real: sc.real });
    }
  }
  return rows;
}

export interface Evidence {
  readonly format: "mtek-humanoid-retarget/1";
  readonly decision: "0221";
  readonly bounds: typeof BOUNDS;
  readonly mapping: {
    readonly matrixSkeletons: number;
    readonly matrixRequiredCorrect: number;
    readonly matrixOptionalCorrect: number;
    readonly proportionSkeletons: number;
    readonly proportionRequiredCorrect: number;
    readonly rows: readonly MappingRow[];
  };
  readonly retarget: readonly RetargetRow[];
}

export function buildEvidence(root: string): Evidence {
  let total = 0, requiredOk = 0, optionalOk = 0, pTotal = 0, pOk = 0;
  for (const { spec } of variantMatrix()) {
    const rig = buildHumanoid(spec), map = mapHumanoid(rig.skin), want = expectedBones(rig);
    total++;
    if (!("error" in map)) {
      if (REQUIRED_HUMANOID_BONES.every((b) => map.bones[b] === want[b])) requiredOk++;
      if (mapsExactly(map, want)) optionalOk++;
    }
  }
  for (const { spec } of proportionMatrix()) {
    const rig = buildHumanoid(spec), map = mapHumanoid(rig.skin), want = expectedBones(rig);
    pTotal++;
    if (!("error" in map) && REQUIRED_HUMANOID_BONES.every((b) => map.bones[b] === want[b])) pOk++;
  }
  const rows: MappingRow[] = [];
  for (const convention of CONVENTION_IDS) {
    const rig = buildHumanoid({ convention, rest: "T", extras: EXTRAS });
    rows.push(mappingRow(`${convention} (synthetic)`, rig.skin, expectedBones(rig)));
  }
  const real = loadRealSkins(root);
  rows.push(mappingRow("CesiumMan", real.cesiumMan), mappingRow("CesiumMan, legs x1.2 arms x0.9", real.cesiumLongLegs), mappingRow("Fox", real.fox));
  return {
    format: "mtek-humanoid-retarget/1", decision: "0221", bounds: BOUNDS,
    mapping: { matrixSkeletons: total, matrixRequiredCorrect: requiredOk, matrixOptionalCorrect: optionalOk, proportionSkeletons: pTotal, proportionRequiredCorrect: pOk, rows },
    retarget: retargetRows(root),
  };
}

/** Deterministic text of the evidence file: values rounded so the file does not depend on the last floating-point digit. */
export function formatEvidence(e: Evidence): string {
  const rounded = {
    ...e,
    retarget: e.retarget.map((r) => ({
      scenario: r.scenario, clip: r.clip, real: r.real,
      maxLimbErrorDeg: round(r.maxLimbErrorDeg, 3), meanLimbErrorDeg: round(r.meanLimbErrorDeg, 3), naiveMaxLimbErrorDeg: round(r.naiveMaxLimbErrorDeg, 1),
      hipsHeightRatio: round(r.hipsHeightRatio, 3), legRatio: round(r.legRatio, 3), hipsRatioError: round(r.hipsRatioError, 3),
      stanceFrames: r.stanceFrames, maxStanceHeightError: round(r.maxStanceHeightError, 3), maxStanceSlide: round(r.maxStanceSlide, 3), meanStanceSlide: round(r.meanStanceSlide, 3),
    })),
    mapping: { ...e.mapping, rows: e.mapping.rows.map((r) => ({ ...r, confidence: round(r.confidence, 3) })) },
  };
  return `${JSON.stringify(rounded, null, 2)}\n`;
}

export function renderTables(e: Evidence): string {
  const lines: string[] = [];
  lines.push(
    "Mapping (generated; `npm run humanoid:check` verifies it). Required bones correct (of 15), optional bones found, evidence counts and confidence:", "",
    "| Skeleton | Required | Optional found | Not found | Name / structure | Confidence |", "| --- | --- | --- | --- | --- | --- |",
  );
  for (const r of e.mapping.rows) {
    const rejected = r.required.startsWith("rejected");
    lines.push(rejected ? `| ${r.skeleton} | ${r.required} | | | | |` : `| ${r.skeleton} | ${r.required} | ${r.optionalFound.join(", ") || "none"} | ${r.unmapped.join(", ") || "none"} | ${r.nameEvidence} / ${r.structureEvidence} | ${r.confidence.toFixed(3)} |`);
  }
  lines.push(
    "", `Variant matrix: ${e.mapping.matrixRequiredCorrect} of ${e.mapping.matrixSkeletons} synthetic skeletons (10 naming conventions x 3 rest poses x 3 mesh frames x 2 bone-axis conventions, with props, twist bones, a tail, fingers and face bones) map all 15 required bones correctly, ${e.mapping.matrixOptionalCorrect} of ${e.mapping.matrixSkeletons} map every bone of the fixture and nothing else. Proportion and unit variants: ${e.mapping.proportionRequiredCorrect} of ${e.mapping.proportionSkeletons}.`, "",
    "Retargeting (generated). Limb error: the largest angle between corresponding limb segments (both upper and lower arm and leg), over all frames, in degrees; uncorrected: the same with `restCorrection: false`. Hips ratio: mean height of the hip joints above the lower ankle, target over source, against the leg-length ratio. Foot height error: in stance, the target ankle height above its bind ankle plane against the source's scaled by the leg ratio, in leg lengths. Slide: target foot speed beyond the source's scaled by the leg ratio while the source foot is planted, in leg lengths per second.", "",
    "| Scenario | Clip | Limb error | Uncorrected | Hips ratio / leg ratio | Stance frames | Foot height error | Max slide | Mean slide |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const r of e.retarget)
    lines.push(`| ${r.scenario} | ${r.clip} | ${round(r.maxLimbErrorDeg, 3)} | ${round(r.naiveMaxLimbErrorDeg, 1)} | ${round(r.hipsHeightRatio, 3)} / ${round(r.legRatio, 3)} | ${r.stanceFrames} | ${round(r.maxStanceHeightError, 3)} | ${round(r.maxStanceSlide, 3)} | ${round(r.meanStanceSlide, 3)} |`);
  lines.push("", `Asserted bounds: limb error at most ${BOUNDS.limbErrorDeg} degrees; uncorrected at least ${BOUNDS.naiveLimbErrorMinDeg} degrees where rest poses differ; hip-joint height ratio within ${BOUNDS.hipsRatioError * 100} % of the leg ratio; stance foot height error at most ${BOUNDS.footHeightError} leg lengths; slide at most ${BOUNDS.slideSynthetic} (synthetic) or ${BOUNDS.slideReal} (real rigs) leg lengths per second.`);
  return lines.join("\n");
}

export type { HumanoidBone };
