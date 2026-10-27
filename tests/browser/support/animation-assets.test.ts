// Decision 0224: the two models of `examples/animation-composition` are not downloads: they are written from explicit data by
// tests/assets/tools/animation-demo-assets.mjs (through make-glb.mjs), byte for byte the same every time. This test regenerates them
// into two scratch directories and compares them with the committed files (`npm run check:assets` does the same in place), then
// checks the properties the example and its browser acceptance rely on: the clips are what the example names, they loop, the planted
// feet do not slide against the root's travel, the feet never go below the ground, the knees bend forward, both rigs map as humanoids, and the
// Guest is another rig (names, proportions, rest pose, hierarchy).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mapHumanoid, retargetHumanoid } from "../../../packages/runtime-web/src/animation.js";
import { EXAMPLE_MODELS, angleBetween, bendSide, cpuPose, dist, guestRig, heroRig, readSkinnedMesh, sub, type V3 } from "./animation-reference.ts";
import { REPO_ROOT } from "./environment.ts";

const GENERATOR = join(REPO_ROOT, "tests", "assets", "tools", "make-glb.mjs");
const FILES = ["examples/animation-composition/models/Hero.glb", "examples/animation-composition/models/Guest.glb"] as const;
const scratch: string[] = [];

function regenerate(): string {
  const dir = mkdtempSync(join(tmpdir(), "mtek-anim-glb-"));
  scratch.push(dir);
  execFileSync(process.execPath, [GENERATOR, "--out", dir], { cwd: REPO_ROOT, stdio: "pipe" });
  return dir;
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("the example's models are reproducible from the generator", () => {
  const first = regenerate();
  const second = regenerate();
  for (const file of FILES) {
    it(`${file}: a fresh run writes the committed bytes, and two runs write the same bytes`, () => {
      const committed = readFileSync(join(REPO_ROOT, file));
      expect(readFileSync(join(first, file)).equals(committed), "the regenerated file equals the committed file").toBe(true);
      expect(readFileSync(join(first, file)).equals(readFileSync(join(second, file))), "two runs agree").toBe(true);
      expect(committed.length, "small enough to commit").toBeLessThan(250_000);
    });
  }
  it("names its generator and is binary glTF 2.0", () => {
    for (const file of ["Hero.glb", "Guest.glb"]) {
      const bytes = readFileSync(join(EXAMPLE_MODELS, file));
      expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
      expect(bytes.readUInt32LE(4)).toBe(2);
      const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8")) as { asset: { version: string; generator: string } };
      expect(json.asset).toEqual({ version: "2.0", generator: "mtek tests/assets/tools/animation-demo-assets.mjs" });
    }
  });
});

describe("the Hero", () => {
  const hero = heroRig().skin;
  const clipDurations = Object.fromEntries(hero.clips.map((c) => [c.name, c.duration]));

  it("has the clips the example names, with their durations", () => {
    const expected: Record<string, number> = { Idle: 2, Walk: 1, Run: 0.7, StrafeLeft: 0.8, StrafeRight: 0.8, Wave: 1.6, Dance: 2 };
    expect(Object.keys(clipDurations).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, duration] of Object.entries(expected)) expect(clipDurations[name], name).toBeCloseTo(duration, 6);
  });

  it("is a humanoid by its names, with a motion root above the hips and a four joint tail", () => {
    const map = mapHumanoid(hero);
    expect("error" in map ? map.error : "").toBe("");
    if ("error" in map) return;
    expect(Object.values(map.evidence).every((e) => e === "name")).toBe(true);
    expect(map.confidence).toBeGreaterThan(0.9);
    expect(map.bones.hips).toBe("Hips");
    expect(map.bones.leftUpperArm).toBe("LeftArm");
    expect(map.bones.rightLowerLeg).toBe("RightLeg");
    const names = hero.nodes.map((n) => n.name);
    for (const joint of ["Root", "Tail1", "Tail2", "Tail3", "Tail4", "Spine1"]) expect(names).toContain(joint);
    expect(hero.nodes[names.indexOf("Hips")]!.parent, "hips are under the root").toBe(names.indexOf("Root"));
  });

  it("loops: every channel ends where it starts, but for the travel of the root", () => {
    for (const clip of hero.clips) {
      for (const channel of clip.channels) {
        const width = channel.path === "rotation" ? 4 : 3;
        const n = channel.times.length;
        const a = channel.values.slice(0, width), b = channel.values.slice((n - 1) * width);
        const same = channel.path === "rotation" ? Math.abs(a.reduce((s, v, i) => s + v * b[i]!, 0)) : 1;
        if (channel.path === "rotation") expect(same, `${clip.name} node ${String(channel.node)}`).toBeGreaterThan(1 - 1e-6);
        else if (hero.nodes[channel.node]!.name !== "Root") expect(dist(a as unknown as V3, b as unknown as V3), `${clip.name} ${hero.nodes[channel.node]!.name}`).toBeLessThan(1e-5);
      }
    }
  });

  it("travels with the root: forward in Walk and Run, sideways in the strafes, in place in Idle, Wave and Dance", () => {
    const travel = (clip: string): V3 => {
      const node = hero.nodes.findIndex((n) => n.name === "Root");
      const c = hero.clips.find((x) => x.name === clip)!.channels.find((ch) => ch.node === node && ch.path === "translation")!;
      const n = c.times.length;
      return [c.values[(n - 1) * 3]! - c.values[0]!, c.values[(n - 1) * 3 + 1]! - c.values[1]!, c.values[(n - 1) * 3 + 2]! - c.values[2]!];
    };
    expect(travel("Walk")[2]).toBeCloseTo(1.1667, 3);
    expect(travel("Run")[2] / 0.7).toBeCloseTo(2.857, 2);
    expect(travel("StrafeLeft")[0]).toBeGreaterThan(0.6);
    expect(travel("StrafeRight")[0]).toBeCloseTo(-travel("StrafeLeft")[0], 6);
    for (const clip of ["Idle", "Wave", "Dance"]) expect(Math.hypot(...travel(clip)), clip).toBeLessThan(1e-6);
  });

  it("plants its feet: during stance the foot stands still in the world while the root travels, and never goes below its ankle height", () => {
    const ankleY = 0.08;
    for (const clip of ["Idle", "Walk", "Run", "StrafeLeft", "StrafeRight", "Wave", "Dance"]) {
      const duration = hero.clips.find((c) => c.name === clip)!.duration;
      const steps = Math.round(duration * 60);
      let slide = 0, lowest = Infinity, stanceFrames = 0;
      for (const side of ["LeftFoot", "RightFoot"]) {
        let previous: V3 | undefined;
        for (let k = 0; k <= steps; k += 1) {
          const nodes = cpuPose(hero, clip, (k / steps) * duration * 0.999999).nodes;
          const foot = nodes.get(side)!;
          lowest = Math.min(lowest, foot[1]);
          if (foot[1] < ankleY + 1e-4) {
            if (previous !== undefined) {
              slide = Math.max(slide, Math.hypot(foot[0] - previous[0], foot[2] - previous[2]));
              stanceFrames += 1;
            }
            previous = foot;
          } else previous = undefined;
        }
      }
      // The world position of a stance foot changes by less than 3 mm between samples a sixtieth of a second apart.
      // (between two keys, 1/30 s apart, the rotations are interpolated and a planted ankle dips by up to 2.3 mm in Run and 1.1 mm in Walk: the leg solve of the generator is exact at the keys)
      expect(lowest, `${clip}: lowest ankle`).toBeGreaterThan(ankleY - 3e-3);
      expect(stanceFrames, `${clip}: planted samples`).toBeGreaterThan(20);
      expect(slide, `${clip}: foot slide per sample (m)`).toBeLessThan(0.003);
    }
  });

  it("bends its knees forward in every clip", () => {
    for (const clip of hero.clips) {
      for (let k = 0; k < 30; k += 1) {
        const nodes = cpuPose(hero, clip.name, (k / 30) * clip.duration).nodes;
        for (const side of ["Left", "Right"]) {
          const side1 = bendSide(nodes.get(`${side}UpLeg`)!, nodes.get(`${side}Leg`)!, nodes.get(`${side}Foot`)!, [0, 0, 1]);
          expect(side1, `${clip.name} ${side} knee at ${String(k)}`).toBeGreaterThanOrEqual(-1e-6);
        }
      }
    }
  });

  it("has a skinned mesh of rigidly bound parts that stands 1.84 m tall on the floor in its T-pose", () => {
    const mesh = heroRig().mesh;
    expect(mesh.joints.length).toBeLessThan(65535);
    expect(Math.max(...mesh.joints)).toBeLessThan(hero.joints.length);
    expect(Math.max(...mesh.indices)).toBe(mesh.joints.length - 1);
    const ys = Array.from({ length: mesh.joints.length }, (_, i) => mesh.positions[i * 3 + 1]!);
    expect(Math.min(...ys)).toBeGreaterThan(-0.05);
    expect(Math.min(...ys)).toBeLessThan(0.05);
    expect(Math.max(...ys)).toBeGreaterThan(1.8);
    expect(Math.max(...ys)).toBeLessThan(2.1);
    expect(readSkinnedMesh(heroRig().bytes).indices.length % 3).toBe(0);
  });
});

describe("the Guest", () => {
  const hero = heroRig().skin, guest = guestRig().skin;

  it("is another humanoid: other names, an A-pose, clavicles and an upper chest, other proportions, no clips of its own", () => {
    expect(guest.clips).toEqual([]);
    const map = mapHumanoid(guest);
    expect("error" in map ? map.error : "").toBe("");
    if ("error" in map) return;
    expect(map.bones.hips).toBe("pelvis");
    expect(map.bones.leftUpperArm).toBe("upperarm_l");
    expect(map.bones.upperChest).toBe("spine_03");
    expect(map.bones.leftShoulder).toBe("clavicle_l");
    const names = new Set(hero.nodes.map((n) => n.name));
    expect(guest.nodes.filter((n) => names.has(n.name) && n.name !== "Body").map((n) => n.name), "no joint name in common").toEqual([]);
    const bind = (skin: typeof hero, a: string, b: string): V3 => {
      const pose = cpuPose({ ...skin, clips: [] }, "none", 0).nodes;
      return sub(pose.get(b)!, pose.get(a)!);
    };
    expect((angleBetween(bind(hero, "RightArm", "RightForeArm"), bind(guest, "upperarm_r", "lowerarm_r")) * 180) / Math.PI, "the rests differ by 45 degrees").toBeCloseTo(45, 3);
    const legs = (skin: typeof hero, hip: string, knee: string, foot: string): number => {
      const pose = cpuPose({ ...skin, clips: [] }, "none", 0).nodes;
      return dist(pose.get(hip)!, pose.get(knee)!) + dist(pose.get(knee)!, pose.get(foot)!);
    };
    expect(legs(guest, "thigh_l", "calf_l", "foot_l") / legs(hero, "LeftUpLeg", "LeftLeg", "LeftFoot"), "legs 1.12 times as long").toBeCloseTo(1.1136, 3);
  });

  it("plays the Hero's clips after the retarget, with its own names", () => {
    const retargeted = retargetHumanoid(hero, guest);
    expect(retargeted.clips.map((c) => c.name).sort()).toEqual(hero.clips.map((c) => c.name).sort());
    expect(retargeted.nodes.map((n) => n.name)).toEqual(guest.nodes.map((n) => n.name));
  });
});
