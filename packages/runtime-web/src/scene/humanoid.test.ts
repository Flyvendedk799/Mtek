import { describe, expect, it } from "vitest";
import path from "node:path";
import { OPTIONAL_HUMANOID_BONES, REQUIRED_HUMANOID_BONES, mapHumanoid, type HumanoidBone, type HumanoidMap } from "./humanoid.js";
import { NAME_TABLE_SPEC, NOISE_WORDS, parseName } from "./humanoid-rig.js";
import { animatedSkin } from "../test-support/animated-skin.js";
import { CONVENTION_IDS, buildHumanoid, expectedBones, loadRealSkins, type HumanoidSpec } from "../test-support/humanoid-fixtures.js";
import { mapsExactly, proportionMatrix, variantMatrix } from "../test-support/humanoid-evidence.js";
import type { MtekSkin } from "../abi/manifest-types.js";

const root = path.resolve(import.meta.dirname, "../../../..");
const mapped = (skin: MtekSkin): HumanoidMap => {
  const map = mapHumanoid(skin);
  if ("error" in map) throw new Error(map.error);
  return map;
};
const EXTRAS = { props: true, twists: true, tail: true, fingers: true, face: true } as const;

describe("joint name parsing", () => {
  const cases: [string, string, string, string | undefined, string | undefined][] = [
    ["mixamorig:LeftUpLeg", "leg", "l", "upper", undefined],
    ["mixamorig:RightToe_End", "", "r", undefined, undefined],
    ["pelvis", "hips", "", undefined, undefined],
    ["thigh_l", "leg", "l", "upper", undefined],
    ["calf_r", "leg", "r", "lower", undefined],
    ["upperarm_twist_01_l", "", "l", undefined, undefined],
    ["clavicle_l", "arm", "l", "shoulder", undefined],
    ["J_Bip_C_Hips", "hips", "", undefined, undefined],
    ["J_Bip_R_LowerLeg", "leg", "r", "lower", undefined],
    ["DEF-thigh.L.001", "leg", "l", "upper", undefined],
    ["DEF-forearm.R", "arm", "r", "lower", undefined],
    ["DEF-spine.003", "torso", "", undefined, undefined],
    ["Skeleton_arm_joint_L__4_", "arm", "l", undefined, undefined],
    ["Skeleton_torso_joint_1", "torso", "", undefined, undefined],
    ["Bip01_L_Thigh", "leg", "l", "upper", undefined],
    ["L_Thigh", "leg", "l", "upper", undefined],
    ["left_leg", "leg", "l", undefined, undefined],
    ["LeftUpLeg", "leg", "l", "upper", undefined],
    ["b_LeftForeArm_010", "arm", "l", "lower", undefined],
    ["HeadTop_End", "", "", undefined, undefined],
    ["LeftHandIndex1", "", "l", undefined, undefined],
  ];
  for (const [name, family, side, role] of cases)
    it(`parses ${name}`, () => {
      const p = parseName(name);
      expect([p.family ?? "", p.side, p.role]).toEqual([family, side, role]);
    });
  it("treats a plain hip as the pelvis and a sided hip as the upper leg; a limb word without a side is no bone", () => {
    expect(parseName("Hip")).toEqual({ family: "hips", side: "" });
    expect(parseName("left_hip")).toEqual({ family: "leg", role: "upper", side: "l" });
    expect(parseName("Leg")).toEqual({ side: "" });
    expect(parseName("LeftHips")).toEqual({ side: "l" });
  });
  it("keeps the name tables compact", () => {
    // Every alias of every bone, plus the rig-prefix words that are ignored: the UTF-8 bytes of the two literals.
    const bytes = new TextEncoder().encode(NAME_TABLE_SPEC + NOISE_WORDS).length;
    expect(bytes).toBeLessThan(900);
  });
});

describe("mapHumanoid on synthetic skeletons", () => {
  it("returns the 22-bone vocabulary of decision 0219", () => {
    expect(REQUIRED_HUMANOID_BONES).toHaveLength(15);
    expect(OPTIONAL_HUMANOID_BONES).toEqual(["chest", "upperChest", "neck", "leftShoulder", "rightShoulder", "leftToes", "rightToes"]);
  });

  it("maps every convention under every rest pose, mesh frame and bone-axis convention with extra bones, 100 % correctly", () => {
    let count = 0;
    const failures: string[] = [];
    for (const { id, spec } of variantMatrix()) {
      const rig = buildHumanoid(spec), map = mapHumanoid(rig.skin);
      count++;
      if (!mapsExactly(map, expectedBones(rig))) failures.push(`${id}: ${"error" in map ? map.error : JSON.stringify(map.bones)}`);
    }
    expect(failures).toEqual([]);
    expect(count).toBe(CONVENTION_IDS.length * 3 * 3 * 2);
  });

  it("is independent of proportions and units", () => {
    const failures: string[] = [];
    for (const { id, spec } of proportionMatrix()) {
      const rig = buildHumanoid(spec);
      if (!mapsExactly(mapHumanoid(rig.skin), expectedBones(rig))) failures.push(id);
    }
    expect(failures).toEqual([]);
  });

  it("reports which optional bones a rig does not have", () => {
    const plain = mapped(buildHumanoid({ convention: "plain" }).skin);
    expect(plain.unmapped).toEqual(["upperChest", "leftShoulder", "rightShoulder", "leftToes", "rightToes"]);
    expect(Object.keys(plain.bones).sort()).toEqual([...REQUIRED_HUMANOID_BONES, "chest", "neck"].sort());
    expect(mapped(buildHumanoid({ convention: "mixamo" }).skin).unmapped).toEqual([]);
  });

  it("names the evidence per bone: names where the names identify the bone, structure otherwise", () => {
    const mixamo = mapped(buildHumanoid({ convention: "mixamo", extras: EXTRAS }).skin);
    expect(Object.values(mixamo.evidence).every((e) => e === "name")).toBe(true);
    expect(Object.keys(mixamo.evidence).sort()).toEqual(Object.keys(mixamo.bones).sort());
    const scrambled = mapped(buildHumanoid({ convention: "scrambled", extras: EXTRAS }).skin);
    expect(Object.values(scrambled.evidence).every((e) => e === "structure")).toBe(true);
    // Rigify's head is "DEF-spine.006": no head word, found from the structure; the rest by name.
    const rigify = mapped(buildHumanoid({ convention: "rigify", extras: EXTRAS }).skin);
    expect(rigify.evidence.head).toBe("structure");
    expect(rigify.evidence.leftLowerLeg).toBe("name");
    expect(rigify.bones.leftLowerLeg).toBe("DEF-shin.L");
    expect(rigify.bones.head).toBe("DEF-spine.006");
  });

  it("grades confidence: names and consistent geometry highest, structure only lower", () => {
    const named = mapped(buildHumanoid({ convention: "unity" }).skin).confidence;
    const structural = mapped(buildHumanoid({ convention: "scrambled" }).skin).confidence;
    expect(named).toBeGreaterThanOrEqual(0.95);
    expect(structural).toBeGreaterThanOrEqual(0.7);
    expect(structural).toBeLessThan(named);
    expect(named).toBeLessThanOrEqual(1);
  });

  it("returns mesh-local up (hips to head) and forward (facing) as unit vectors", () => {
    for (const frame of ["yup", "zup", "back"] as const) {
      const rig = buildHumanoid({ convention: "vrm", frame }), map = mapped(rig.skin);
      const canonicalUp = frame === "zup" ? [0, 0, 1] : [0, 1, 0];
      const canonicalForward = frame === "zup" ? [0, -1, 0] : frame === "back" ? [0, 0, -1] : [0, 0, 1];
      map.up.forEach((v, i) => expect(v).toBeCloseTo(canonicalUp[i]!, 6));
      map.forward.forEach((v, i) => expect(v).toBeCloseTo(canonicalForward[i]!, 6));
    }
  });

  it("decides left and right from the facing found in the geometry when names cannot (toes)", () => {
    for (const frame of ["yup", "zup", "back"] as const) {
      const rig = buildHumanoid({ convention: "scrambled", frame, rest: "A" }), map = mapped(rig.skin);
      expect(map.bones.leftUpperLeg).toBe(rig.bones.get("upperLeg.L")!.name);
      expect(map.bones.rightHand).toBe(rig.bones.get("hand.R")!.name);
    }
  });

  it("maps the skeleton layout of every convention from its structure alone (names replaced), except where geometry cannot decide", () => {
    const swapped = (b: HumanoidBone): HumanoidBone => (b.startsWith("left") ? "right" + b.slice(4) : b.startsWith("right") ? "left" + b.slice(5) : b) as HumanoidBone;
    const outcomes = { exact: 0, mirrored: 0, excluded: 0 };
    for (const convention of CONVENTION_IDS)
      for (const rest of ["T", "A", "Abent"] as const)
        for (const frame of ["yup", "zup", "back"] as const)
          for (const extras of [EXTRAS, { fingers: false, face: false }]) {
            const rig = buildHumanoid({ convention, rest, frame, extras, scramble: true }), map = mapHumanoid(rig.skin), want = expectedBones(rig);
            const label = `${convention}/${rest}/${frame}`;
            if (convention === "rigify") {
              // Exclusion: on-chain twist bones (thigh.001, forearm.001) cannot be told from elbows and knees without names.
              outcomes.excluded++;
              continue;
            }
            expect("error" in map, label).toBe(false);
            const bones = (map as HumanoidMap).bones as Record<string, string>;
            if (mapsExactly(map, want)) { outcomes.exact++; continue; }
            // Exclusion: no toes, straight knees and a mesh that does not face +Z leave nothing to find the facing:
            // the pairs are found, with left and right exchanged.
            expect(["plain"].includes(convention) && frame === "back" && rest !== "Abent", label).toBe(true);
            expect(Object.keys(want).every((b) => bones[swapped(b as HumanoidBone)] === want[b]), label).toBe(true);
            outcomes.mirrored++;
          }
    expect(outcomes.excluded).toBeGreaterThan(0);
    expect(outcomes.mirrored).toBeGreaterThan(0);
    expect(outcomes.exact).toBeGreaterThan(100);
  });

  it("falls back to the knees, then to the glTF convention (+Z of the scene), without toes", () => {
    const spec: HumanoidSpec = { convention: "scrambled", rest: "Abent" };
    const rig = buildHumanoid({ ...spec, frame: "back" });
    // Bent knees point forward: the facing is found even though the mesh faces away from +Z.
    const withoutToes = dropBones(rig.skin, (name) => [rig.bones.get("toes.L")!.name, rig.bones.get("toes.R")!.name, rig.bones.get("toeEnd.L")?.name, rig.bones.get("toeEnd.R")?.name].includes(name));
    const knees = mapped(withoutToes);
    expect(knees.bones.leftUpperLeg).toBe(rig.bones.get("upperLeg.L")!.name);
    expect(knees.unmapped).toContain("leftToes");
    // Straight legs, no toes, facing +Z of the scene: only the convention remains.
    const straight = buildHumanoid({ convention: "scrambled", rest: "A" });
    const bare = dropBones(straight.skin, (name) => [straight.bones.get("toes.L")!.name, straight.bones.get("toes.R")!.name].includes(name));
    const convention = mapped(bare);
    expect(convention.bones.leftUpperLeg).toBe(straight.bones.get("upperLeg.L")!.name);
    expect(convention.confidence).toBeLessThan(mapped(straight.skin).confidence);
  });

  it("follows the names when they say left and right, and lowers the confidence when the geometry disagrees", () => {
    const rig = buildHumanoid({ convention: "mixamo" });
    const swapped = swapSides(rig.skin);
    const map = mapped(swapped);
    // The node called LeftUpLeg is now on the character's right; the names win, the toes object.
    expect(map.bones.leftUpperLeg).toBe("mixamorig:LeftUpLeg");
    expect(map.confidence).toBeLessThan(0.6);
    expect(map.confidence).toBeLessThan(mapped(rig.skin).confidence);
  });

  it("rejects skeletons that are not humanoid, with a reason", () => {
    const tiny = mapHumanoid(animatedSkin());
    expect("error" in tiny && tiny.error).toMatch(/at least 15 joints/);
    const rig = buildHumanoid({ convention: "mixamo" });
    const noArms = mapHumanoid(dropBones(rig.skin, (name) => /Arm|Hand|Shoulder/.test(name)));
    expect("error" in noArms).toBe(true);
    const noLegs = mapHumanoid(dropBones(rig.skin, (name) => /Leg|Foot|Toe/.test(name)));
    expect("error" in noLegs).toBe(true);
    const chain = chainSkin(30);
    expect("error" in mapHumanoid(chain)).toBe(true);
  });

  it("rejects duplicate bone names instead of guessing", () => {
    const rig = buildHumanoid({ convention: "unity" });
    const nodes = rig.skin.nodes.map((n) => (n.name === "LeftHand" ? { ...n, name: "RightHand" } : n));
    const result = mapHumanoid({ ...rig.skin, nodes });
    expect("error" in result && /not unique/.test(result.error)).toBe(true);
  });

  it("is pure and deterministic", () => {
    const rig = buildHumanoid({ convention: "vrm", extras: EXTRAS }), before = structuredClone(rig.skin);
    const a = mapHumanoid(rig.skin), b = mapHumanoid(rig.skin);
    expect(a).toEqual(b);
    expect(rig.skin).toEqual(before);
  });
});

describe("mapHumanoid on real skins", () => {
  const real = loadRealSkins(root);
  const cesium: Record<string, string> = {
    hips: "Skeleton_torso_joint_1", spine: "Skeleton_torso_joint_2", chest: "torso_joint_3", neck: "Skeleton_neck_joint_1", head: "Skeleton_neck_joint_2",
    leftUpperLeg: "leg_joint_L_1", leftLowerLeg: "leg_joint_L_2", leftFoot: "leg_joint_L_3", leftToes: "leg_joint_L_5",
    rightUpperLeg: "leg_joint_R_1", rightLowerLeg: "leg_joint_R_2", rightFoot: "leg_joint_R_3", rightToes: "leg_joint_R_5",
    leftUpperArm: "Skeleton_arm_joint_L__4_", leftLowerArm: "Skeleton_arm_joint_L__3_", leftHand: "Skeleton_arm_joint_L__2_",
    rightUpperArm: "Skeleton_arm_joint_R", rightLowerArm: "Skeleton_arm_joint_R__2_", rightHand: "Skeleton_arm_joint_R__3_",
  };

  it("maps CesiumMan: all 15 required bones, chest, neck and toes; no upper chest or shoulders", () => {
    const map = mapped(real.cesiumMan);
    expect(map.bones).toEqual(cesium);
    expect(map.unmapped).toEqual(["upperChest", "leftShoulder", "rightShoulder"]);
    expect(Object.values(map.evidence).every((e) => e === "name")).toBe(true);
    expect(map.confidence).toBeGreaterThan(0.85);
    // CesiumMan stands on Z and faces +X of its mesh frame.
    expect(map.up[2]).toBeGreaterThan(0.99);
    expect(map.forward[0]).toBeGreaterThan(0.99);
  });

  it("maps the proportion variant of the character-composition example the same way", () => {
    expect(mapped(real.cesiumLongLegs).bones).toEqual(cesium);
    if (real.composition !== undefined) {
      expect(mapped(real.composition.source).bones).toEqual(cesium);
      expect(mapped(real.composition.longLegs).bones).toEqual(cesium);
    }
  });

  it("maps CesiumMan from its structure alone when every name is replaced", () => {
    const named = mapped(real.cesiumMan), renamed = real.cesiumMan.nodes.map((n, i) => ({ ...n, name: `node_${String(i).padStart(2, "0")}` }));
    const map = mapped({ ...real.cesiumMan, nodes: renamed });
    const back = new Map(renamed.map((n, i) => [n.name, real.cesiumMan.nodes[i]!.name]));
    for (const bone of Object.keys(named.bones) as HumanoidBone[]) expect(back.get(map.bones[bone]!)).toBe(named.bones[bone]);
    expect(Object.values(map.evidence).every((e) => e === "structure")).toBe(true);
    expect(map.unmapped).toEqual(named.unmapped);
    expect(map.confidence).toBeLessThan(named.confidence);
  });

  it("rejects the Fox: a quadruped whose bones carry humanoid names", () => {
    const names = real.fox.nodes.map((n) => parseName(n.name));
    // The names alone would be complete: head, two arms and two legs.
    expect(names.some((n) => n.family === "head")).toBe(true);
    expect(names.filter((n) => n.family === "leg" && n.side === "l").length).toBeGreaterThan(0);
    const result = mapHumanoid(real.fox);
    expect("error" in result && result.error).toMatch(/not an upright biped/);
    // And with the names removed as well.
    const renamed = { ...real.fox, nodes: real.fox.nodes.map((n, i) => ({ ...n, name: `node_${i}` })) };
    expect("error" in mapHumanoid(renamed)).toBe(true);
  });
});

/** The skin without the bones whose names satisfy `drop`, and their descendants (nodes are renumbered). */
function dropBones(skin: MtekSkin, drop: (name: string) => boolean): MtekSkin {
  const gone = new Set<number>();
  skin.nodes.forEach((n, i) => { if (drop(n.name) || (n.parent >= 0 && gone.has(n.parent))) gone.add(i); });
  const keep = skin.nodes.map((_, i) => i).filter((i) => !gone.has(i)), renumber = new Map(keep.map((old, i) => [old, i]));
  const joints = skin.joints.filter((j) => !gone.has(j));
  return {
    ...skin, meshNode: renumber.get(skin.meshNode)!, joints: joints.map((j) => renumber.get(j)!),
    nodes: keep.map((i) => ({ ...skin.nodes[i]!, parent: skin.nodes[i]!.parent < 0 ? -1 : renumber.get(skin.nodes[i]!.parent)! })),
    inverseBind: skin.joints.flatMap((j, k) => (gone.has(j) ? [] : [skin.inverseBind[k]!])),
  };
}

/** The skin with Left and Right exchanged in every node name, geometry unchanged. */
function swapSides(skin: MtekSkin): MtekSkin {
  const swap = (s: string): string => s.replace(/Left/g, "@").replace(/Right/g, "Left").replace(/@/g, "Right");
  // The node that carried the Left geometry now has the Right name (names stay unique).
  return { ...skin, nodes: skin.nodes.map((n) => ({ ...n, name: swap(n.name) })) };
}

/** A single chain of joints: no branches, so nothing like legs and arms. */
function chainSkin(n: number): MtekSkin {
  const nodes = Array.from({ length: n + 1 }, (_, i) => ({ name: i === 0 ? "mesh" : `link_${i}`, parent: i <= 1 ? -1 : i - 1, translation: [0, i === 0 ? 0 : 0.1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }));
  const joints = nodes.map((_, i) => i).slice(1);
  return { meshNode: 0, nodes, joints, inverseBind: joints.map(() => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: [], weights: [], clips: [] };
}
