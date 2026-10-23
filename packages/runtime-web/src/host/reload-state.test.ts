/**
 * Hot reload carries scene state by identity and type (`spec/runtime-abi.md` section 11). A user enum is a `u32` index, so
 * its type name alone cannot tell an enum whose variants changed from the old one; the manifest's `storedType` spells the
 * variants out and the carry compares that (decision 0177).
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import { resolveStructure } from "../scene/structure.js";
import { World } from "../scene/world.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import { migrateWorld, stateIdentity } from "./reload.js";

/** The minimal manifest with one scene state `level`, an enum with the given stored description (or none). */
function manifestWithLevel(storedType: string | undefined): MtekManifest {
  const json = minimalManifestJson();
  const scene = json["scene"] as { state: Record<string, unknown>[] };
  scene.state = [{ name: "level", type: "u32", symbol: "src/main.mtek::Demo.level", ...(storedType === undefined ? {} : { storedType }) }];
  const result = checkManifest(json);
  if (!result.ok) throw new Error(JSON.stringify(result.failures));
  return result.manifest;
}

function worldHolding(manifest: MtekManifest, level: number): World {
  const structure = resolveStructure(manifest);
  if (!structure.ok) throw new Error(JSON.stringify(structure.diagnostics));
  const world = new World({ manifest, structure: structure.structure, params: { writeParam: () => undefined }, report: () => undefined });
  world.sceneState["level"] = level;
  return world;
}

/** The running world held `held`; the new program's `init` left `fresh`. Returns the value after the swap. */
function migrate(before: MtekManifest, after: MtekManifest, held: number, fresh: number): unknown {
  const previous = worldHolding(before, held);
  const next = worldHolding(after, fresh);
  migrateWorld(previous, before, next, after);
  return next.sceneState["level"];
}

describe("migrateWorld and enum-typed scene state (decision 0177)", () => {
  it("names an enum by its variants, not by its u32 index type", () => {
    expect(stateIdentity({ type: "u32", storedType: "enum(A|B)" })).toBe("enum(A|B)");
    expect(stateIdentity({ type: "u32" })).toBe("u32");
  });

  it("carries the value when the variant list is unchanged", () => {
    expect(migrate(manifestWithLevel("enum(Easy|Hard)"), manifestWithLevel("enum(Easy|Hard)"), 1, 0)).toBe(1);
  });

  it("drops the value (the new init's value stays) when the variants changed", () => {
    expect(migrate(manifestWithLevel("enum(Easy|Hard)"), manifestWithLevel("enum(Hard|Easy)"), 1, 0)).toBe(0);
    expect(migrate(manifestWithLevel("enum(Easy|Hard)"), manifestWithLevel("enum(Easy)"), 1, 0)).toBe(0);
  });
});
