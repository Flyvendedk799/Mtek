import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import { fakeProgram, minimalManifestJson } from "../test-support/fake-host.js";
import { checkProgram } from "./program.js";

const parsed = checkManifest(minimalManifestJson());
if (!parsed.ok) throw new Error("the minimal manifest is not valid");
const manifest = parsed.manifest;
const entry = manifest.entryScene;

function withScene(patch: Record<string, unknown>): { writers: unknown; scenes: unknown } {
  const program = fakeProgram();
  const scene = (program.scenes as Record<string, Record<string, unknown>>)[entry] ?? {};
  return { writers: program.writers, scenes: { [entry]: { ...scene, ...patch } } };
}

function problem(patch: Record<string, unknown>): string {
  const result = checkProgram(withScene(patch), manifest);
  if (result.ok) return "";
  return result.diagnostics.map((d) => `${d.code}: ${d.message} ${d.notes.join(" ")}`).join("\n");
}

const handler = { key: "Space", owner: -1, fn: () => undefined };

describe("checkProgram: the scene object beyond init", () => {
  it("accepts a scene with lifecycle functions, per-entity functions and well-formed handlers", () => {
    const entities = manifest.scene.entities.map(() => () => undefined);
    const result = checkProgram(
      withScene({
        update: () => undefined,
        fixedUpdate: () => undefined,
        entityUpdate: entities,
        entityFixedUpdate: entities,
        events: {
          key_down: [handler, { key: "Enter", owner: 0, fn: () => undefined }],
          pointer_down: [{ owner: -1, fn: () => undefined }],
        },
      }),
      manifest,
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ["update", { update: 3 }, "scenes.Demo.update"],
    ["fixedUpdate", { fixedUpdate: "x" }, "scenes.Demo.fixedUpdate"],
    ["entityUpdate of the wrong length", { entityUpdate: [] }, "scenes.Demo.entityUpdate"],
    ["entityFixedUpdate with a non-function", { entityFixedUpdate: [42] }, "scenes.Demo.entityFixedUpdate"],
    ["events missing", { events: undefined }, "scenes.Demo.events"],
    ["a handler list that is not an array", { events: { key_down: handler } }, "scenes.Demo.events.key_down"],
    ["a key handler without a key", { events: { key_down: [{ owner: -1, fn: () => undefined }] } }, "scenes.Demo.events.key_down"],
    ["a pointer handler with a key", { events: { pointer_down: [handler] } }, "scenes.Demo.events.pointer_down"],
    ["an owner out of range", { events: { key_up: [{ ...handler, owner: 99 }] } }, "scenes.Demo.events.key_up"],
    ["an owner below -1", { events: { key_up: [{ ...handler, owner: -2 }] } }, "scenes.Demo.events.key_up"],
    ["a handler without a function", { events: { pointer_up: [{ owner: -1 }] } }, "scenes.Demo.events.pointer_up"],
  ])("rejects %s as E8003", (_name, patch, field) => {
    const text = problem(patch);
    expect(text).toContain("MTEK-E8003");
    expect(text).toContain(`field: ${field}`);
  });
});
