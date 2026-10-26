// M4-10, the other two sentences of the M4 exit gate, on variants of examples/material-configurator:
//
//  - "An unsupported required asset feature fails explicitly": the example with a GLB whose "Fabric" material has a normal texture
//    (and one whose file requires an extension) is built with the CLI. `mtek check` and `mtek build` must fail at compile time,
//    with the documented code, a message that names the feature, and the span of the `asset.glb(..)` path literal; `mtek build`
//    must write nothing. These need no GPU.
//  - "A repeated-object scene demonstrates the claimed instancing path through counters and equivalent output": 80 copies of the
//    chair's meshes, each with its own rotation and a non-uniform scale, drawn with instancing and with `test.disableInstancing`
//    on the hardware adapter. The counters show the draw calls dropping from the 80 entities to the 5 groups; the pictures
//    agree with each other within one 8-bit step and with the CPU model (support/configurator-scene.ts) within the 3/255 of the
//    PBR spec. The copies have a tapered crest and legs on purpose: a renderer that took the world normal from the model matrix
//    instead of its inverse transpose (the instanced vertex stage builds it from the instance normal matrix) is detectably wrong
//    there, and the last test shows the GPU picture disagrees with that wrong model.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../../support/fixtures.ts";
import { compareImage, expectedImage, repeatedInstances, repeatedScene, type ExpectedImage } from "../../support/configurator-scene.ts";
import { cliPath, runCli } from "../../support/m1-fixtures.ts";
import { CONFIGURATOR_SRC, REPEATED_URL, buildBrokenVariant } from "../../support/m4-configurator.ts";
import { TOLERANCE, changedPixels, expectMatches, runPlan, writeRecord, type Shot } from "./configurator-support.ts";

interface JsonDiagnostic {
  code: string;
  severity: string;
  message: string;
  source: { file: string; startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
}
interface JsonReport {
  diagnostics: JsonDiagnostic[];
  summary: { errors: number; warnings: number };
}

const record: Record<string, unknown> = {};

test.afterAll(() => {
  writeRecord("m4-configurator-variants.json", record);
});

/** The 1-based line and column of the first occurrence of `literal` in `src/model.mtek` of the example. */
function locationInModel(literal: string): { line: number; column: number } {
  const text = readFileSync(join(CONFIGURATOR_SRC, "src", "model.mtek"), "utf8");
  const offset = text.indexOf(literal);
  if (offset < 0) throw new Error(`${literal} is not in src/model.mtek`);
  const before = text.slice(0, offset).split("\n");
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}

test.describe("an unsupported required asset feature fails explicitly, at compile time (M4-10)", () => {
  const variants = [
    { glb: "chair_normal_texture.glb", code: "MTEK-E7009", names: ["normal", "TEXCOORD_1", "'Fabric'"], feature: "a normal texture on UV set 1" },
    { glb: "chair_required_extension.glb", code: "MTEK-E7004", names: ["KHR_draco_mesh_compression"], feature: "a required extension" },
  ] as const;

  test("the unmodified example passes check with 0 errors and 0 warnings", () => {
    const run = runCli(cliPath(), ["check", "--format", "json", CONFIGURATOR_SRC]);
    expect(run.status).toBe(0);
    const report = JSON.parse(run.stdout) as JsonReport;
    expect(report.summary).toMatchObject({ errors: 0, warnings: 0 });
    expect(report.diagnostics).toEqual([]);
  });

  for (const variant of variants) {
    test(`the example with ${variant.feature} in its GLB: check and build fail with ${variant.code}, the message names the feature, nothing is built`, () => {
      const runs = buildBrokenVariant(cliPath(), variant.glb);
      const literal = locationInModel('"../models/chair.glb"');
      for (const [tool, run] of [["check", runs.check], ["build", runs.build]] as const) {
        expect(run.status, `mtek ${tool} exits non-zero`).not.toBe(0);
        const report = JSON.parse(run.stdout) as JsonReport;
        expect(report.summary.errors, `mtek ${tool}: errors`).toBeGreaterThanOrEqual(1);
        expect(report.diagnostics.map((d) => d.code), `mtek ${tool}: only the documented code`).toEqual(report.diagnostics.map(() => variant.code));
        const diagnostic = report.diagnostics[0];
        expect(diagnostic?.severity).toBe("error");
        for (const name of variant.names) expect(diagnostic?.message, `mtek ${tool}: the message names ${name}`).toContain(name);
        // The span is the path literal of the declaration, in the module that declares the asset.
        expect(diagnostic?.source).toMatchObject({ file: "src/model.mtek", startLine: literal.line, startColumn: literal.column });
      }
      expect(runs.wroteOutput, "mtek build wrote no output at all").toBe(false);
      record[variant.glb] = { checkStatus: runs.check.status, buildStatus: runs.build.status, diagnostics: (JSON.parse(runs.check.stdout) as JsonReport).diagnostics };
    });

    test(`the human-readable report of ${variant.code} also names the feature`, () => {
      const runs = buildBrokenVariant(cliPath(), variant.glb);
      const text = runCli(cliPath(), ["check", runs.projectDir]);
      expect(text.status).not.toBe(0);
      const output = `${text.stdout}${text.stderr}`;
      expect(output).toContain(variant.code);
      for (const name of variant.names) expect(output).toContain(name);
    });
  }
});

/** Pixels in `shot` whose bytes differ from `other`, and the largest channel difference. */
function difference(shot: Shot, other: Shot): { differing: number; maxDiff: number } {
  const differing = changedPixels(shot.data, other.data).length;
  let maxDiff = 0;
  for (let i = 0; i < shot.data.length; i += 4) for (let c = 0; c < 3; c += 1) maxDiff = Math.max(maxDiff, Math.abs((shot.data[i + c] ?? 0) - (other.data[i + c] ?? 0)));
  return { differing, maxDiff };
}

test.describe("a repeated-object scene shows the instancing path in counters and in equal output (M4-10)", () => {
  const TARGET = { width: 480, height: 360 } as const;
  const instances = repeatedInstances();
  const count = (kind: string): number => instances.filter((i) => i.kind === kind).length;

  test("80 copies need 5 draw calls instead of 80 and look the same, and both pictures are the oracle's", async ({ page, gpu }, testInfo) => {
    void gpu;
    test.setTimeout(180_000);
    const [instanced] = (await runPlan(page, REPEATED_URL, { renderTarget: TARGET }, [{ label: "instanced" }])).shots;
    const individualRun = await runPlan(page, REPEATED_URL, { renderTarget: TARGET, disableInstancing: true }, [{ label: "individual" }]);
    const [individual] = individualRun.shots;
    if (instanced === undefined || individual === undefined) throw new Error("missing shots");
    expect(individualRun.reported).toEqual([]);

    // The groups: the legs and the crests (two meshes, one Oak block), the seats, the rails, and the one seat whose roughness
    // differs, which has a block of its own and is drawn alone. 82 entities are alive, the two lights among them.
    const entities = instances.length;
    expect(entities).toBe(80);
    expect(count("Odd")).toBe(1);
    for (const kind of ["Leg", "Crest", "Seat", "Rail"]) expect(count(kind), kind).toBeGreaterThanOrEqual(2);
    expect(instanced.counters).toMatchObject({
      liveEntities: entities + 2,
      drawCalls: 5,
      instancedDraws: 4,
      culledObjects: 0,
      // Blocks used by two or more entities: Oak (legs and crests), Steel (rails), the seat parameters. Owned: the odd seat's.
      sharedParamBlocks: 3,
      ownedParamBlocks: 1,
    });
    expect(individual.counters).toMatchObject({ liveEntities: entities + 2, drawCalls: entities, instancedDraws: 0, culledObjects: 0, sharedParamBlocks: 3, ownedParamBlocks: 1 });
    // Instancing costs one more pipeline (the instanced variant of Pbr) and one more buffer (the instance buffer).
    expect((instanced.counters["pipelinesCreated"] ?? 0) - (individual.counters["pipelinesCreated"] ?? 0)).toBe(1);
    expect((instanced.counters["buffersAllocated"] ?? 0) - (individual.counters["buffersAllocated"] ?? 0)).toBe(1);
    expect(instanced.counters["drawCalls"] ?? NaN, "far fewer draw calls than entities").toBeLessThan(entities / 10);

    // Equivalent output: the two pictures agree (the instance data are binary32 either way), and both are the CPU model's.
    const expected: ExpectedImage = expectedImage(repeatedScene(), TARGET.width, TARGET.height);
    const onOracle = expectMatches(instanced, expected);
    const offOracle = expectMatches(individual, expected);
    const same = difference(instanced, individual);
    const drawn = Object.keys(onOracle.perEntity).filter((name) => name !== "clear").length;
    expect(drawn, "entities with stable pixels in the compared image").toBeGreaterThanOrEqual(60);
    expect(onOracle.compared).toBeGreaterThan(100000);
    expect(same.maxDiff, `${String(same.differing)} pixels differ between the instanced and the individual picture`).toBeLessThanOrEqual(1);
    testInfo.annotations.push({
      type: "m4-configurator-instancing",
      description: `80 copies: drawCalls ${String(individual.counters["drawCalls"])} -> ${String(instanced.counters["drawCalls"])}, instancedDraws ${String(instanced.counters["instancedDraws"])}; instanced vs individual: max channel difference ${String(same.maxDiff)}/255, ${String(same.differing)} of ${String(TARGET.width * TARGET.height)} pixels differ; against the oracle (${String(onOracle.compared)} pixels, ${String(drawn)} entities): instanced max ${String(onOracle.maxError)}/255, individual max ${String(offOracle.maxError)}/255`,
    });
    record["instancing"] = {
      entities,
      instancedCounters: instanced.counters,
      individualCounters: individual.counters,
      instancedVsIndividual: same,
      instancedVsOracle: { compared: onOracle.compared, maxError: onOracle.maxError, entities: drawn },
      individualVsOracle: { compared: offOracle.compared, maxError: offOracle.maxError },
    };

    // Sensitivity: the oracle with normals taken from the model matrix (the mistake the instance normal matrix exists to avoid)
    // disagrees with the GPU picture on hundreds of pixels, so agreement with the right model is not a coincidence.
    const wrong = expectedImage(repeatedScene(), TARGET.width, TARGET.height, { wrongNormals: true });
    const against = compareImage(wrong, instanced.data, TOLERANCE);
    expect(against.outside, "pixels where the GPU disagrees with the model-matrix-normal oracle by more than 3/255").toBeGreaterThan(500);
  });
});
