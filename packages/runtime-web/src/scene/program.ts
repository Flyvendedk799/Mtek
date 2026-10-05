/**
 * Checking the program module against its manifest before any generated code runs
 * (`spec/runtime-abi.md` section 3): the entry scene must exist with an `init` function, and `writers`
 * must hold a writer entry for every layout of the manifest, with one field writer per top-level member.
 *
 * `app.js` and `program.manifest.json` are produced together, so a mismatch means the two files come
 * from different builds: an incompatible program (`E8003`).
 */
import type { MtekLayoutRecord, MtekManifest } from "../abi/manifest-types.js";
import type { MtekProgramScene, MtekWriterMemory } from "../abi/program.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";

/** A generated writer, as the runtime calls it: the value's CPU representation is checked by the caller. */
export type BlockWriter = (memory: MtekWriterMemory, base: number, value: unknown) => void;

/** The writers of one layout. */
export interface LayoutWriters {
  readonly all: BlockWriter;
  /** One writer per top-level member of the layout record, by member name. */
  readonly fields: ReadonlyMap<string, BlockWriter>;
}

/** The parts of the program module the M1 runtime executes, checked against the manifest. */
export interface CheckedProgram {
  readonly scene: MtekProgramScene;
  /** By layout id; holds every layout of the manifest. */
  readonly writers: ReadonlyMap<string, LayoutWriters>;
}

export type ProgramResult =
  | { readonly ok: true; readonly program: CheckedProgram }
  | { readonly ok: false; readonly diagnostics: readonly MtekDiagnostic[] };

/** The members of the program module this check reads. */
export interface ProgramModuleParts {
  readonly writers: unknown;
  readonly scenes: unknown;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function incompatible(field: string, message: string): MtekDiagnostic {
  return makeRuntimeDiagnostic("E8003", {
    phase: "runtime:mount",
    message: `Incompatible program: ${message}`,
    notes: [`field: ${field}`, "help: app.js and program.manifest.json must come from the same build"],
  });
}

/**
 * The generated writer functions are typed `(m, base, value: never) => void` in the program module type
 * because their value type depends on the layout; the runtime passes values it has checked itself.
 */
function asBlockWriter(fn: (...args: never[]) => unknown): BlockWriter {
  return fn as unknown as BlockWriter;
}

function checkWriters(layout: MtekLayoutRecord, entry: unknown, diagnostics: MtekDiagnostic[]): LayoutWriters | undefined {
  const field = `writers["${layout.id}"]`;
  if (!isRecord(entry)) {
    diagnostics.push(incompatible(field, `the program module has no writers for the layout '${layout.id}'.`));
    return undefined;
  }
  const all = own(entry, "all");
  const fields = own(entry, "fields");
  if (typeof all !== "function" || !isRecord(fields)) {
    diagnostics.push(incompatible(field, `the writers of the layout '${layout.id}' lack the \`all\` function or the \`fields\` table.`));
    return undefined;
  }
  const byName = new Map<string, BlockWriter>();
  for (const member of layout.root.members) {
    const writer = own(fields, member.name);
    if (typeof writer !== "function") {
      diagnostics.push(incompatible(`${field}.fields.${member.name}`, `the layout '${layout.id}' has the member '${member.name}' but the program module has no writer for it.`));
      return undefined;
    }
    byName.set(member.name, asBlockWriter(writer as (...args: never[]) => unknown));
  }
  return { all: asBlockWriter(all as (...args: never[]) => unknown), fields: byName };
}

const EVENT_NAMES = ["key_down", "key_up", "pointer_down", "pointer_up", "pointer_move", "collision_enter", "collision_exit"] as const;

function functionOrNull(value: unknown): boolean {
  return value === null || typeof value === "function";
}

/**
 * The shape of the scene object beyond `init` (`spec/runtime-abi.md` section 3): lifecycle functions or
 * `null`, one slot per static entity, and an events table of well-formed handlers.
 */
function sceneShapeProblem(scene: Readonly<Record<string, unknown>>, entityCount: number): { field: string; problem: string } | undefined {
  for (const name of ["update", "fixedUpdate"] as const) {
    if (!functionOrNull(own(scene, name))) return { field: name, problem: `has a \`${name}\` that is neither a function nor null` };
  }
  for (const name of ["entityUpdate", "entityFixedUpdate"] as const) {
    const list = own(scene, name);
    if (!Array.isArray(list) || list.length !== entityCount || !list.every(functionOrNull)) {
      return { field: name, problem: `needs \`${name}\` to be an array of ${String(entityCount)} functions or nulls (one per static entity)` };
    }
  }
  const events = own(scene, "events");
  if (!isRecord(events)) return { field: "events", problem: "has no `events` table" };
  for (const name of EVENT_NAMES) {
    const list = own(events, name);
    if (list === undefined) continue;
    const keyed = name === "key_down" || name === "key_up";
    const valid =
      Array.isArray(list) &&
      list.every((handler: unknown) => {
        if (!isRecord(handler)) return false;
        const key = own(handler, "key");
        const owner = own(handler, "owner");
        return (
          typeof own(handler, "fn") === "function" &&
          typeof owner === "number" &&
          Number.isInteger(owner) &&
          owner >= -1 &&
          owner < entityCount &&
          (keyed ? typeof key === "string" : key === undefined)
        );
      });
    if (!valid) return { field: `events.${name}`, problem: `has a malformed \`${name}\` handler list` };
  }
  return undefined;
}

/** Checks `program` against `manifest`; reports every mismatch found. */
export function checkProgram(program: ProgramModuleParts, manifest: MtekManifest): ProgramResult {
  const diagnostics: MtekDiagnostic[] = [];
  const entry = manifest.entryScene;

  let scene: MtekProgramScene | undefined;
  const scenes = program.scenes;
  const candidate = isRecord(scenes) ? own(scenes, entry) : undefined;
  if (!isRecord(candidate) || typeof own(candidate, "init") !== "function") {
    diagnostics.push(incompatible(`scenes.${entry}`, `the program module has no scene '${entry}' with an \`init\` function.`));
  } else {
    const shape = sceneShapeProblem(candidate, manifest.scene.entities.length);
    if (shape === undefined) scene = candidate as unknown as MtekProgramScene;
    else diagnostics.push(incompatible(`scenes.${entry}.${shape.field}`, `the scene '${entry}' ${shape.problem}.`));
  }

  const writers = new Map<string, LayoutWriters>();
  const table = isRecord(program.writers) ? program.writers : undefined;
  if (table === undefined) {
    diagnostics.push(incompatible("writers", "the program module has no `writers` table."));
  } else {
    for (const layout of manifest.layouts) {
      const checked = checkWriters(layout, own(table, layout.id), diagnostics);
      if (checked !== undefined) writers.set(layout.id, checked);
    }
  }

  if (diagnostics.length > 0 || scene === undefined) return { ok: false, diagnostics };
  return { ok: true, program: { scene, writers } };
}
