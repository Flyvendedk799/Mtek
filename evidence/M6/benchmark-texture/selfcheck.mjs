// Checks the independent model of the benchmark task scene-rendering-11 (derive.mjs, decision 0089) against values worked out by hand,
// and counts how many pixels of the written fixture a wrong picture would change (the model-level mutation check; the mutants run
// against both real stacks are in evidence/M6/benchmark-texture/mutants/).
//
//   node evidence/M6/benchmark-texture/selfcheck.mjs
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseToml } from "../../../benchmarks/tools/toml-subset.mjs";
import { encodePixel, sampleReference } from "../../../tests/browser/support/texture-reference.ts";
import { SCENE, cast, colourOf, project } from "./derive.mjs";
import { TEXELS, bytesOf } from "./make-swatch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let failures = 0;
const check = (ok, what) => {
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${what}\n`);
  if (!ok) failures += 1;
};
const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
const TEXTURE = { width: 4, height: 4, texels: TEXELS.flat().map((h) => [...bytesOf(h), 255]), colorSpace: "srgb" };

// 1. The texels are pairwise far apart (so every flip, mirror or transposition changes every texel by a lot).
{
  const flat = TEXELS.flat().map(bytesOf);
  let smallest = 255;
  for (let i = 0; i < flat.length; i += 1) {
    for (let j = i + 1; j < flat.length; j += 1) smallest = Math.min(smallest, Math.max(...flat[i].map((c, k) => Math.abs(c - flat[j][k]))));
  }
  check(smallest >= 0x20, `the 16 texels differ pairwise by at least 0x20 in some channel (smallest ${smallest})`);
}

// 2. Decoding and encoding an sRGB texel is the identity at an exact texel centre.
{
  let bad = 0;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const shown = hex(encodePixel(sampleReference(TEXTURE, "nearest", "clamp", (col + 0.5) / 4, (row + 0.5) / 4)));
      if (shown !== TEXELS[row][col]) bad += 1;
    }
  }
  check(bad === 0, "nearest sampling at the 16 texel centres returns the stored bytes");
}

// 3. Linear filtering is done in linear light: the midpoint of two texels, evaluated by hand.
//    lin(188) = 0.502886, lin(224) = 0.745404 -> mean 0.624145 -> sRGB 0.81205 -> 207.1 -> 207
//    lin(64)  = 0.051269, lin(160) = 0.351533 -> mean 0.201401 -> sRGB 0.48625 -> 124.0 -> 124
//    lin(32)  = 0.014444, lin(16)  = 0.005182 -> mean 0.009813 -> sRGB 0.09864 -> 25.2  -> 25
{
  const midpoint = hex(encodePixel(sampleReference(TEXTURE, "linear", "clamp", 0.25, 0.125)));
  check(midpoint === "#cf7c19", `the midpoint of #bc4020 and #e0a010 in linear light is #cf7c19 (got ${midpoint}); the mean of the bytes would be #ce7018`);
}

// 4. Clamping holds the edge texel in the outer half texel, wrapping would blend it with the opposite edge.
{
  const clamp = hex(encodePixel(sampleReference(TEXTURE, "linear", "clamp", 1 / 16, 0.125)));
  const repeat = hex(encodePixel(sampleReference(TEXTURE, "linear", "repeat", 1 / 16, 0.125)));
  check(clamp === "#bc4020" && repeat !== clamp, `at u = 1/16 clamp gives the edge texel #bc4020 (got ${clamp}) and repeat gives ${repeat}`);
}

// 5. The ray model and the matrices of the runtime ABI agree: casting the ray through the projection of a point returns the point's coordinates.
{
  const origin = project([0, 0, 0]);
  check(Math.abs(origin.x - 64) < 1e-9 && Math.abs(origin.y - 64) < 1e-9, `the camera target projects to the centre of the target (${origin.x}, ${origin.y})`);
  let worst = 0;
  for (const panel of SCENE.panels) {
    for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.75], [0.3, 0.95]]) {
      const at = project([panel.cx + (u - 0.5) * SCENE.side, 0, panel.cz + (v - 0.5) * SCENE.side]);
      const hit = cast(at.x, at.y);
      worst = Math.max(worst, hit === null || hit.panel !== panel ? 1 : Math.abs(hit.u - u) + Math.abs(hit.v - v));
    }
  }
  check(worst < 1e-9, `ray casts through projected panel points return their picture coordinates (worst error ${worst.toExponential(1)})`);
}

// 6. Model-level mutants: how many pixels of the fixture does each wrong picture change by more than the pixel's tolerance?
{
  const fixture = parseToml(readFileSync(join(root, "benchmarks", "tasks", "scene-rendering-11", "mtek-tests", "scene.test.toml"), "utf8"));
  const pixels = fixture["steps"].filter((step) => "expect_pixel" in step).map((step) => step["expect_pixel"]);
  check(pixels.every((p) => hex(colourOf(cast(p.x + 0.5, p.y + 0.5))) === p.color), `the fixture's ${pixels.length} pixels are exactly what derive.mjs computes now`);
  const variants = {
    "colour space linear instead of sRGB": (hit) => encodePixel(sampleReference({ ...TEXTURE, colorSpace: "linear" }, hit.panel.filter, hit.panel.address, hit.u * hit.panel.tile, hit.v * hit.panel.tile)),
    "picture flipped (v)": (hit) => encodePixel(sampleReference(TEXTURE, hit.panel.filter, hit.panel.address, hit.u * hit.panel.tile, 1 - hit.v * hit.panel.tile)),
    "picture mirrored (u)": (hit) => encodePixel(sampleReference(TEXTURE, hit.panel.filter, hit.panel.address, 1 - hit.u * hit.panel.tile, hit.v * hit.panel.tile)),
    "picture transposed (u and v swapped)": (hit) => encodePixel(sampleReference(TEXTURE, hit.panel.filter, hit.panel.address, hit.v * hit.panel.tile, hit.u * hit.panel.tile)),
    "picture rotated by 180 degrees": (hit) => encodePixel(sampleReference(TEXTURE, hit.panel.filter, hit.panel.address, 1 - hit.u * hit.panel.tile, 1 - hit.v * hit.panel.tile)),
    "wrong filter (nearest on Smooth, linear on Plain and Tiled)": (hit) =>
      encodePixel(sampleReference(TEXTURE, hit.panel.filter === "linear" ? "nearest" : "linear", hit.panel.address, hit.u * hit.panel.tile, hit.v * hit.panel.tile)),
    "wrong wrapping (repeat on Smooth, clamp on Tiled)": (hit) =>
      encodePixel(sampleReference(TEXTURE, hit.panel.filter, hit.panel.address === "repeat" ? "clamp" : "repeat", hit.u * hit.panel.tile, hit.v * hit.panel.tile)),
    "Tiled shown once (no tiling)": (hit) => encodePixel(sampleReference(TEXTURE, hit.panel.filter, hit.panel.address, hit.u, hit.v)),
    "the Smooth panel alone not tagged sRGB": (hit) =>
      encodePixel(sampleReference({ ...TEXTURE, colorSpace: hit.panel.filter === "linear" ? "linear" : "srgb" }, hit.panel.filter, hit.panel.address, hit.u * hit.panel.tile, hit.v * hit.panel.tile)),
  };
  for (const [name, variant] of Object.entries(variants)) {
    let changed = 0;
    for (const p of pixels) {
      const hit = cast(p.x + 0.5, p.y + 0.5);
      if (hit === null) continue;
      const shown = variant(hit);
      const expected = bytesOf(p.color);
      if (Math.max(...shown.map((c, k) => Math.abs(c - expected[k]))) > p.tolerance) changed += 1;
    }
    check(changed > 0, `mutant "${name}": ${changed} of ${pixels.length} fixture pixels fail`);
  }
}

process.stdout.write(failures === 0 ? "selfcheck: OK\n" : `selfcheck: ${failures} failure(s)\n`);
process.exitCode = failures === 0 ? 0 : 1;
