// A prefab param is a run-time index even when a static instance substitutes its value.
// Compare both generated paths against independent, hand-computed results, with the real rt.
import { describe, expect, it } from "vitest";
import { createFakeContext } from "./support/fake-ctx.js";
import { type ProgramVariant, loadProgram, record, spanText } from "./support/programs.js";

type Update = (ctx: unknown, self: unknown, dt: number) => void;
const PARAMS = { low: -1, high: 4294967295, inside: 1 };
const EXPECTED = {
  read_low: 10,
  read_high: 20,
  read_inside: 20,
  matrix_low: 1,
  matrix_high: 1,
  plain_write: 7,
  compound_write: 11,
  nested_write: 12,
  counted_write: 7.5,
};
const WARNING_SOURCES = [
  "values[low]",
  "values[high]",
  "matrix[low]",
  "matrix[high]",
  "writes[low]",
  "writes[high]",
  "nested_values[low]",
  "nested_values[low][high]",
  "writes[low + i32(random())]",
];

for (const variant of ["release", "preview"] as const satisfies readonly ProgramVariant[]) {
  describe(`specialized parameter indices (${variant})`, () => {
    for (const form of ["static", "dynamic"] as const) {
      it(`${form}: clamps reads, writes and matrix columns, with each index evaluated once`, async () => {
        const program = await loadProgram("assignable_places", variant);
        const made = createFakeContext(1, [PARAMS]);
        let randomCalls = 0;
        const ctx = {
          ...made.ctx,
          random: (): number => (++randomCalls % 2 === 1 ? 0.25 : 0.5),
        };
        const self = ctx.e[0];
        if (self === undefined) throw new Error("missing indexed entity");
        const scene = record(record(program.module["scenes"], "scenes")["Places"], "Places");
        const prefab = record(record(program.module["prefabs"], "prefabs")["src/main.mtek::IndexedPlaces"], "IndexedPlaces");
        const update = (form === "static"
          ? (scene["entityUpdate"] as unknown[])[0]
          : prefab["update"]) as Update;
        update(ctx, self, 0.016);
        expect(self.state).toEqual(EXPECTED);
        // One random() in the compound-assignment index, then one in its right operand.
        expect(randomCalls).toBe(2);
        expect(made.warnings.map((w) => w.code)).toEqual(WARNING_SOURCES.map(() => "W8030"));
        expect(made.warnings.map((w) => spanText(program, w.spanId))).toEqual(WARNING_SOURCES);
        expect(new Set(made.warnings.map((w) => w.spanId)).size).toBe(WARNING_SOURCES.length);
        update(ctx, self, 0.016);
        expect(self.state).toEqual(EXPECTED);
        expect(randomCalls).toBe(4);
        // W8030 remains once per source call site and context, across repeated updates.
        expect(made.warnings).toHaveLength(WARNING_SOURCES.length);
      });
    }
  });
}
