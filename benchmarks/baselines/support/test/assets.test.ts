// The image of a task is an asset shared by both sides: the Mtek project and the three.js project of the starter and of the reference
// each hold a copy of `assets/<name>`, and the copies must be the same bytes (decision 0089), or the two sides would be solving
// different tasks. This test finds every `assets/` directory of the tasks and compares the copies, and checks the properties the
// textured task relies on: a plain 8-bit RGBA PNG without colour-space chunks, 4 x 4 texels, all different.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const TASKS = resolve(import.meta.dirname, "..", "..", "..", "tasks");
/** The four projects of a task that hold its files. */
const PROJECTS = ["mtek", "baseline", "reference/mtek", "reference/baseline"];

/** `[task id, file name]` of every asset file of every task, from whichever project holds it. */
function assetFiles(): Array<[string, string]> {
  const found = new Set<string>();
  for (const task of readdirSync(TASKS, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const project of PROJECTS) {
      const directory = join(TASKS, task.name, ...project.split("/"), "assets");
      if (!existsSync(directory)) continue;
      for (const name of readdirSync(directory)) found.add(`${task.name}\u0000${name}`);
    }
  }
  return [...found].sort().map((key) => key.split("\u0000") as [string, string]);
}

function chunks(png: Buffer): Array<{ type: string; data: Buffer }> {
  const out: Array<{ type: string; data: Buffer }> = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    out.push({ type: png.toString("ascii", offset + 4, offset + 8), data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return out;
}

describe("task assets", () => {
  it("there is at least one (the textured task)", () => {
    expect(assetFiles().map(([task]) => task)).toContain("scene-rendering-11");
  });

  it.each(assetFiles())("%s: %s is the same bytes in all four projects that hold it", (task, name) => {
    const copies = PROJECTS.map((project) => join(TASKS, task, ...project.split("/"), "assets", name));
    for (const copy of copies) expect(existsSync(copy), `${copy.slice(TASKS.length + 1)} exists`).toBe(true);
    const [first, ...rest] = copies.map((copy) => readFileSync(copy));
    for (const other of rest) expect(other.equals(first as Buffer)).toBe(true);
  });

  it("scene-rendering-11 swatch.png: an 8-bit RGBA PNG, 4 x 4, no colour-space chunk, 16 different opaque texels", () => {
    const png = readFileSync(join(TASKS, "scene-rendering-11", "mtek", "assets", "swatch.png"));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const all = chunks(png);
    // gAMA, sRGB, iCCP, cHRM would let a decoder convert the colours; the task's expectations assume it does not.
    expect(all.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    const header = all[0]?.data as Buffer;
    expect([header.readUInt32BE(0), header.readUInt32BE(4), header[8], header[9], header[12]]).toEqual([4, 4, 8, 6, 0]);
    const raw = inflateSync(Buffer.concat(all.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)));
    expect(raw.length).toBe(4 * (1 + 4 * 4));
    const texels = new Set<string>();
    for (let row = 0; row < 4; row += 1) {
      expect(raw[row * 17], `row ${String(row)} uses filter type 0`).toBe(0);
      for (let col = 0; col < 4; col += 1) {
        const at = row * 17 + 1 + col * 4;
        expect(raw[at + 3]).toBe(255);
        texels.add([...raw.subarray(at, at + 3)].join(","));
      }
    }
    expect(texels.size).toBe(16);
  });
});
