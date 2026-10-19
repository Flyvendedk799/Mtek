// The model behind the modular scene spec (support/m7-modular-scene.ts) is checked against the program it models and against
// numbers worked out by hand, so the browser spec's expectations do not rest on code nobody tested. It also states, from the
// sources alone, what makes the example a multi-file one: the modules, who imports what, and how often a prefab is instantiated.
import { describe, expect, it } from "vitest";
import { expectPixel, projectedCentre } from "./m1-reference.ts";
import {
  MODULAR_MODULES,
  MODULAR_SOURCE_LITERALS,
  REST,
  beacon,
  gaugeLength,
  modularSource,
  pillar,
  placedPillar,
  shade,
  showroom,
  themeColour,
  themeNumber,
} from "./m7-modular-scene.ts";

interface Import {
  names: string[];
  from: string;
}

/** The `import { A, B } from "./x.mtek";` items of a module, with the specifier as written. */
function importsOf(file: string): Import[] {
  const out: Import[] = [];
  for (const match of modularSource(file).matchAll(/^import \{([^}]*)\} from "([^"]+)";$/gm)) {
    out.push({ names: (match[1] ?? "").split(",").map((name) => name.trim()).filter((name) => name !== ""), from: match[2] ?? "" });
  }
  return out;
}

/** The path of the module an import names, relative to the project (`src/props/../theme.mtek` is `src/theme.mtek`). */
function resolveImport(file: string, specifier: string): string {
  const parts = file.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

describe("the modular scene model (M7-01)", () => {
  it("transcribes lines that occur in the example's sources", () => {
    for (const { file, text } of MODULAR_SOURCE_LITERALS) expect(modularSource(file), `${file}: ${text}`).toContain(text);
  });

  it("reads the theme constants", () => {
    expect([themeNumber("PILLAR_WIDTH"), themeNumber("MAX_PLACED"), themeNumber("PLACE_X0"), themeNumber("PLACE_STEP"), themeNumber("PLACE_Z")]).toEqual([0.8, 4, -2.4, 2.4, -3]);
    expect([themeColour("CLEAR"), themeColour("SLATE"), themeColour("STONE"), themeColour("GOLD"), themeColour("TEAL"), themeColour("ROSE")]).toEqual([
      "#14181f",
      "#3a4150",
      "#9aa3b5",
      "#e0a526",
      "#2f9e8f",
      "#e0527a",
    ]);
    expect(() => themeNumber("NO_SUCH_CONSTANT")).toThrow(/no `export const NO_SUCH_CONSTANT/);
  });

  it("is made of five modules that import each other as the documented graph says", () => {
    expect(MODULAR_MODULES).toHaveLength(5);
    const graph = new Map<string, Array<{ to: string; names: string[] }>>();
    for (const file of MODULAR_MODULES) {
      graph.set(file, importsOf(file).map((item) => ({ to: resolveImport(file, item.from), names: item.names })));
    }
    const edges = (from: string): string[] => (graph.get(from) ?? []).map((edge) => edge.to).sort();
    expect(edges("src/main.mtek")).toEqual(["src/materials.mtek", "src/props/beacon.mtek", "src/props/pillar.mtek", "src/theme.mtek"]);
    expect(edges("src/props/pillar.mtek")).toEqual(["src/materials.mtek", "src/theme.mtek"]);
    expect(edges("src/props/beacon.mtek")).toEqual(["src/materials.mtek", "src/theme.mtek"]);
    expect(edges("src/materials.mtek")).toEqual(["src/theme.mtek"]);
    expect(edges("src/theme.mtek")).toEqual([]);
    // Every module the graph names is one of the five; every one of them is reached from the entry.
    for (const to of [...graph.values()].flatMap((list) => list.map((edge) => edge.to))) expect(MODULAR_MODULES as readonly string[]).toContain(to);
    // The one material is imported by three modules: both prefabs and the scene.
    const importers = MODULAR_MODULES.filter((file) => (graph.get(file) ?? []).some((edge) => edge.to === "src/materials.mtek" && edge.names.includes("Matte")));
    expect(importers).toEqual(["src/main.mtek", "src/props/pillar.mtek", "src/props/beacon.mtek"]);
    // And what a module imports it exports.
    for (const file of MODULAR_MODULES) {
      for (const edge of graph.get(file) ?? []) {
        const target = modularSource(edge.to);
        for (const name of edge.names) expect(target, `${file} imports ${name} from ${edge.to}`).toMatch(new RegExp(`^export (?:const|fn|material|prefab) ${name}\\b`, "m"));
      }
    }
  });

  it("instantiates one prefab three times with different params and the other twice, in the scene file", () => {
    const main = modularSource("src/main.mtek");
    expect([...main.matchAll(/^\s+entity (\w+): Pillar \{/gm)].map((match) => match[1])).toEqual(["Left", "Middle", "Right"]);
    expect([...main.matchAll(/^\s+entity (\w+): Beacon \{/gm)].map((match) => match[1])).toEqual(["Lantern", "Lamp"]);
    expect(main).toContain("spawn(");
    // Neither prefab nor the material is declared in the scene file.
    expect(main).not.toMatch(/^\s*(?:export )?(?:prefab|material) /m);
  });

  it("derives the pillars' centres from origin and height", () => {
    expect(pillar([-3.6, 0, 0], 2, 0.8)).toEqual({ position: [-3.6, 1, 0], scale: [0.8, 2, 0.8] });
    expect(pillar([-1.2, 0, 0], 3, 0.8).position).toEqual([-1.2, 1.5, 0]);
    const right = pillar([1.2, 0, 0], 1.2, 1.2);
    expect(right.position[1]).toBeCloseTo(0.6, 12);
    expect(right.scale).toEqual([1.2, 1.2, 1.2]);
    const rows = [0, 1, 2, 3].map(placedPillar);
    expect(rows.map((row) => row.origin[0].toFixed(1))).toEqual(["-2.4", "0.0", "2.4", "4.8"]);
    expect(rows.map((row) => row.height)).toEqual([1, 1.5, 2, 2.5]);
    expect(rows.map((row) => row.tint)).toEqual(["#2f9e8f", "#e0527a", "#2f9e8f", "#e0527a"]);
  });

  it("derives the beacons' bob and pulse at the times the fixtures use", () => {
    const quarter = Math.PI / 4;
    const lantern = beacon([-3.6, 3.4, 0], 1, quarter);
    expect(lantern.position[1]).toBeCloseTo(3.4 + 0.25 * Math.SQRT1_2, 6);
    expect(lantern.dim).toBeCloseTo(0.75 + 0.25 * Math.SQRT1_2, 6);
    const lamp = beacon([3.6, 3, 0], 2, quarter);
    expect(lamp.position[1]).toBeCloseTo(3.25, 6);
    expect(lamp.dim).toBeCloseTo(1, 6);
    const threeQuarters = beacon([3.6, 3, 0], 2, (3 * Math.PI) / 4);
    expect(threeQuarters.position[1]).toBeCloseTo(2.75, 6);
    expect(threeQuarters.dim).toBeCloseTo(0.5, 6);
    expect(beacon([-3.6, 3.4, 0], 1, (3 * Math.PI) / 2).dim).toBeCloseTo(0.5, 6);
    expect(beacon([3.6, 3, 0], 2, 0)).toEqual({ position: [3.6, 3, 0], dim: 0.75 });
  });

  it("encodes the colours the fixtures quote", () => {
    expect(shade("#e0a526", 1)).toBe("#e0a526");
    expect(shade("#e0a526", 0.75)).toBe("#c59120");
    expect(shade("#e0a526", 0.9267767)).toBe("#d99f24");
    expect(shade("#e0a526", 0.5)).toBe("#a47819");
    expect(shade("#e0527a", 0.75)).toBe("#c5476b");
    expect(shade("#e0527a", 0.5)).toBe("#a43a58");
  });

  it("grows the gauge by a metre per press of Space", () => {
    expect([0, 1, 2, 3].map(gaugeLength).map((length) => Number(length.toFixed(6)))).toEqual([0.2, 1.2, 2.2, 3.2]);
  });

  it("describes a scene in which the entities the fixtures sample are robustly visible", () => {
    const scene = showroom({ time: 0, presses: 0, placed: 4 }, { width: 128, height: 128 });
    expect(scene.entities.map((entity) => entity.name)).toEqual(["Floor", "Left", "Middle", "Right", "Lantern", "Lamp", "Gauge", "Placed0", "Placed1", "Placed2", "Placed3"]);
    const at = (x: number, y: number): string => {
      const found = expectPixel(scene, x, y);
      return found.kind === "entity" ? (scene.entities[found.index]?.name ?? "?") : found.kind;
    };
    expect([at(62, 72), at(30, 65), at(52, 61), at(75, 69), at(29, 43), at(98, 47), at(4, 4)]).toEqual(["Floor", "Left", "Middle", "Right", "Lantern", "Lamp", "clear"]);
    expect([at(45, 64), at(63, 63), at(82, 61), at(101, 59)]).toEqual(["Placed0", "Placed1", "Placed2", "Placed3"]);
    const centre = projectedCentre(showroom(REST, { width: 128, height: 128 }), 1);
    expect(centre.x).toBeCloseTo(30.5, 1);
    expect(centre.y).toBeCloseTo(65.8, 1);
  });
});
