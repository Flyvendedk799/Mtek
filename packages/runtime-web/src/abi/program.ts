// The program module: the shape of the default export of `app.js` (spec/runtime-abi.md section 3, ABI 1).

/**
 * The generated-code context (`ctx`, spec/runtime-abi.md section 4.2). The runtime passes it to every
 * generated function; its members are defined by the runtime (mounting, M1-14), not by the program format.
 */
export type MtekContext = object;

/** An entity record (the `self` / `e` parameter of generated handlers, spec/runtime-abi.md section 4.2). */
export type MtekEntityRecord = object;

/** The three typed views over one `ArrayBuffer` that generated writers write through (spec/gpu-layout.md section 7). */
export interface MtekWriterMemory {
  readonly f32: Float32Array;
  readonly u32: Uint32Array;
  readonly i32: Int32Array;
}

/** `(m, base, value)`: `base` is a byte offset, a multiple of 4. */
export type MtekWriterFunction = (m: MtekWriterMemory, base: number, value: never) => void;

export interface MtekWriterEntry {
  /** Writes the whole block. */
  readonly all: MtekWriterFunction;
  /** One writer per top-level field of the block. */
  readonly fields: Readonly<Record<string, MtekWriterFunction>>;
}

/** Keyed by layout id (`builtin:frame`, `material:<module>::<Name>`, ...). */
export type MtekProgramWriters = Readonly<Record<string, MtekWriterEntry>>;

/** Every user function (pure and cpu) takes `ctx` first. Keyed by symbol. */
export type MtekProgramFunctions = Readonly<Record<string, (ctx: MtekContext, ...args: never[]) => unknown>>;

export type MtekEventName =
  | "key_down"
  | "key_up"
  | "pointer_down"
  | "pointer_up"
  | "pointer_move"
  | "collision_enter"
  | "collision_exit";

/** One declared event handler, in declaration order. */
export interface MtekEventHandler {
  /** DOM `KeyboardEvent.code` (`"Space"`, `"KeyA"`); present for `key_down` and `key_up` only. */
  readonly key?: string;
  /** `-1` for a scene handler, otherwise the static entity index (prefab handlers: always the instance itself). */
  readonly owner: number;
  /** `self` is the entity record, or null for scene handlers; `arg` is a PointerEvent, an `entity_ref` or undefined. */
  readonly fn: (ctx: MtekContext, self: MtekEntityRecord | null, arg: unknown) => void;
}

export type MtekProgramEvents = Readonly<Partial<Record<MtekEventName, readonly MtekEventHandler[]>>>;

export type MtekSceneUpdate = ((ctx: MtekContext, dt: number) => void) | null;
export type MtekEntityUpdate = ((ctx: MtekContext, self: MtekEntityRecord, dt: number) => void) | null;

export interface MtekProgramScene {
  /** Runs once: state, entity state/fields and material instance values. */
  readonly init: (ctx: MtekContext) => void;
  readonly update: MtekSceneUpdate;
  readonly fixedUpdate: MtekSceneUpdate;
  /** Indexed by static entity index. */
  readonly entityUpdate: readonly MtekEntityUpdate[];
  readonly entityFixedUpdate: readonly MtekEntityUpdate[];
  readonly events: MtekProgramEvents;
  /** Indexed by binding id. */
  readonly bindings: readonly ((ctx: MtekContext) => unknown)[];
}

export interface MtekProgramPrefab {
  /** `params`: object of evaluated prefab params by name. */
  readonly init: (ctx: MtekContext, self: MtekEntityRecord, params: Readonly<Record<string, unknown>>) => void;
  readonly update: MtekEntityUpdate;
  readonly fixedUpdate: MtekEntityUpdate;
  readonly events: MtekProgramEvents;
  readonly bindings: readonly ((ctx: MtekContext, self: MtekEntityRecord) => unknown)[];
}

/**
 * The type of the default export of `app.js`. The type parameter only carries the `Inputs` interface for
 * typing `setInput`; at run time inputs are always validated by the generated codecs.
 */
export interface MtekProgram<I = Record<string, unknown>> {
  readonly abi: 1;
  readonly baseUrl: URL;
  readonly manifestUrl: URL;
  readonly writers: MtekProgramWriters;
  readonly functions: MtekProgramFunctions;
  readonly scenes: Readonly<Record<string, MtekProgramScene>>;
  readonly prefabs: Readonly<Record<string, MtekProgramPrefab>>;
  /** Phantom, never present at run time. */
  readonly __inputs?: I;
}
