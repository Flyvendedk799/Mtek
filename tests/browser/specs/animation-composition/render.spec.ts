// Decision 0224: GPU output of `examples/animation-composition` against a CPU reference, on both local backends.
//
// The reference is built without the GPU: the committed model's bind-pose vertices are skinned on the CPU with the joint palette the
// CPU animation system computed for that frame, placed in the world by the entity's pose, projected through the camera the program
// sets (position and target are expressions of the Hero's position, the field of view a literal of the source) and rasterised at pixel
// centres into a coverage mask. The image the GPU draws is read back and the pixels of the figure's colour (the Hero is orange,
// the Guest blue, and no other surface of the scene is either) form the other mask. Two rasterisations of one outline differ only
// along it, so the number of pixels in exactly one mask is bounded by the length of the reference's boundary in pixels (times 1.5 for
// the edge pixels the GPU blends with the background); their centroids agree within a pixel. As a control, the mask of the same
// mesh in its bind pose (a T-pose, no palette) is far from the image: the comparison can tell a pose from another.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../../support/fixtures.ts";
import { animationConstant } from "../../support/animation-example.ts";
import { add, bindPose, compareMasks, classify, guestRig, heroRig, isGuestBlue, isHeroOrange, rasterMask, rotateByQuat, rotateY, skinVertices, type Camera, type V3 } from "../../support/animation-reference.ts";
import { collectProblems, run, writeProbe } from "../../support/animation-harness.ts";
import { encodePng } from "../../support/m5-playground.ts";
import { hold, tap, wait, type Step } from "../../support/movement-drive.ts";
import type { DriveResult, Sample } from "../../support/animation-drive.ts";

const FIGURE_BASE = animationConstant("FIGURE_BASE");
const FOV_Y = 0.8;
const SIZE = { width: 320, height: 200 } as const;
const GUEST_POSITION: V3 = [-2.4, 0, 1.6];
const GUEST_YAW = 1.2;

/** The camera the program sets in its update for a Hero at `hero` (heading zero). */
function programCamera(hero: Sample["hero"]): Camera {
  const p: V3 = [hero.position.x, hero.position.y, hero.position.z];
  return { eye: add(p, [0, 1.6, -4]), target: add(p, [0, 0.3, 0]), fovY: FOV_Y, ...SIZE };
}

function heroWorld(sample: Sample, palette: Float32Array): Float64Array {
  const mesh = heroRig().mesh;
  const local = skinVertices(mesh, palette);
  const out = new Float64Array(local.length);
  for (let v = 0; v < local.length / 3; v += 1) {
    const p = add([sample.hero.position.x, sample.hero.position.y, sample.hero.position.z], rotateByQuat(sample.hero.rotation, add([0, -FIGURE_BASE, 0], [local[v * 3]!, local[v * 3 + 1]!, local[v * 3 + 2]!])));
    out.set(p, v * 3);
  }
  return out;
}

function guestWorld(palette: Float32Array): Float64Array {
  const local = skinVertices(guestRig().mesh, palette);
  const out = new Float64Array(local.length);
  for (let v = 0; v < local.length / 3; v += 1) out.set(add(GUEST_POSITION, rotateY([local[v * 3]!, local[v * 3 + 1]!, local[v * 3 + 2]!], GUEST_YAW)), v * 3);
  return out;
}

test.describe("GPU output against a CPU skinning reference (decision 0224)", () => {
  let problems: ReturnType<typeof collectProblems>;
  test.beforeEach(({ page, gpu }) => {
    void gpu;
    problems = collectProblems(page);
  });
  test.afterEach(() => problems.check());

  function save(name: string, result: DriveResult): void {
    if (result.pixels === undefined) return;
    const dir = join(process.env["MTEK_RESULTS_DIR"] ?? ".", "animation-composition");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}-${test.info().project.name}.png`), encodePng(result.pixels.width, result.pixels.height, Uint8Array.from(result.pixels.data)));
  }

  const POSES: ReadonlyArray<{ name: string; steps: Step[]; why: string }> = [
    { name: "running, waving and reaching", steps: [wait(20), hold(["KeyW", "ShiftLeft", "KeyF", "KeyG"], 45)], why: "blend of idle, walk and run, a layer at partial weight, a limb goal and a tail goal" },
    { name: "on the stairs", steps: [tap("Digit3"), wait(20), hold(["KeyW"], 65)], why: "foot placement with tilted feet and lowered hips" },
    { name: "strafing", steps: [wait(20), hold(["KeyE", "KeyW"], 50)], why: "the hull-clamped parameter: strafe right, walk and run weights" },
  ];

  for (const pose of POSES) {
    test(`the Hero, ${pose.name} (${pose.why}): the GPU image is the CPU-skinned silhouette`, async ({ page }) => {
      const result = await run(page, pose.steps, { sample: "boundary", model: [], animated: [], guest: [], target: SIZE, final: { pixels: true, palettes: ["model"] } });
      save(`render-hero-${pose.name.replace(/[^a-z]+/g, "-")}`, result);
      const sample = result.samples.at(-1)!;
      const image = result.pixels!;
      expect([image.width, image.height]).toEqual([SIZE.width, SIZE.height]);
      const camera = programCamera(sample.hero);
      const palette = Float32Array.from(result.palettes!["model"]!);
      const reference = rasterMask(camera, heroWorld(sample, palette), heroRig().mesh.indices);
      const gpu = classify(image.data, image.width, image.height, isHeroOrange);
      const compared = compareMasks(reference, gpu, image.width, image.height);
      // The control: the same figure unposed.
      const bind = bindPose(heroRig().skin);
      const control = compareMasks(rasterMask(camera, heroWorld(sample, bind.palette), heroRig().mesh.indices), gpu, image.width, image.height);
      writeProbe(`render-hero-${pose.name.replace(/[^a-z]+/g, "-")}`, { compared, control, bound: 1.5 * compared.boundary });
      expect(compared.referencePixels, "the figure covers a good part of the image").toBeGreaterThan(1500);
      expect(compared.difference, "pixels in exactly one of the two masks").toBeLessThanOrEqual(1.5 * compared.boundary);
      expect(compared.centroidShift, "centroid shift (pixels)").toBeLessThan(1.5);
      expect(compared.iou, "overlap").toBeGreaterThan(0.85);
      expect(control.iou, "an unposed figure does not match the image").toBeLessThan(compared.iou - 0.1);
    });
  }

  test("the Guest, dancing with the Hero's retargeted clip: the GPU image is the CPU-skinned silhouette", async ({ page }) => {
    // At the curb the camera (4 m behind the Hero, looking at his waist) has the Guest at the right of the picture.
    const result = await run(page, [tap("Digit2"), wait(75)], { sample: "boundary", model: [], animated: [], guest: [], target: SIZE, final: { pixels: true, palettes: ["guest"] } });
    save("render-guest", result);
    const sample = result.samples.at(-1)!;
    const image = result.pixels!;
    const camera = programCamera(sample.hero);
    const palette = Float32Array.from(result.palettes!["guest"]!);
    const reference = rasterMask(camera, guestWorld(palette), guestRig().mesh.indices);
    const gpu = classify(image.data, image.width, image.height, isGuestBlue);
    const compared = compareMasks(reference, gpu, image.width, image.height);
    const control = compareMasks(rasterMask(camera, guestWorld(bindPose(guestRig().skin).palette), guestRig().mesh.indices), gpu, image.width, image.height);
    writeProbe("render-guest", { compared, control, bound: 1.5 * compared.boundary });
    expect(compared.referencePixels, "the Guest covers a part of the image").toBeGreaterThan(300);
    expect(compared.difference, "pixels in exactly one of the two masks").toBeLessThanOrEqual(1.5 * compared.boundary);
    expect(compared.centroidShift, "centroid shift (pixels)").toBeLessThan(1);
    expect(control.iou, "the Guest in its rest pose does not match the image").toBeLessThan(compared.iou - 0.05);
  });
});
