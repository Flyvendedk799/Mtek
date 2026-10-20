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
  /** `-1` for a scene handler, otherwise the static entity index. */
  readonly owner: number;
  /** `self` is the entity record, or null for scene handlers; `arg` is a PointerEvent, an `entity_ref` or undefined. */
  readonly fn: (ctx: MtekContext, self: MtekEntityRecord | null, arg: unknown) => void;
}

export type MtekProgramEvents = Readonly<Partial<Record<MtekEventName, readonly MtekEventHandler[]>>>;

/** One handler of a prefab: its owner is always the instance itself, `"self"` (decision 0062). */
export interface MtekPrefabEventHandler {
  /** DOM `KeyboardEvent.code`; present for `key_down` and `key_up` only. */
  readonly key?: string;
  readonly owner: "self";
  /** `self` is the instance's entity record; `arg` is a PointerEvent, an `entity_ref` or undefined. */
  readonly fn: (ctx: MtekContext, self: MtekEntityRecord, arg: unknown) => void;
}

export type MtekPrefabEvents = Readonly<Partial<Record<MtekEventName, readonly MtekPrefabEventHandler[]>>>;

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

/**
 * A prefab (`prefabs` is keyed by its symbol). `init` sets the state, then the fields of one instance; the
 * runtime creates the instance's record with `self.params` set to the same `params` object (handlers and
 * bindings read it there). A field or material param that a binding supplies is left to the runtime's
 * evaluation of `bindings`, which are indexed by the prefab's binding id.
 */
export interface MtekProgramPrefab {
  /** `params`: object of evaluated prefab params by name. */
  readonly init: (ctx: MtekContext, self: MtekEntityRecord, params: Readonly<Record<string, unknown>>) => void;
  readonly update: MtekEntityUpdate;
  readonly fixedUpdate: MtekEntityUpdate;
  readonly events: MtekPrefabEvents;
  readonly bindings: readonly ((ctx: MtekContext, self: MtekEntityRecord) => unknown)[];
}

/**
 * The type of the default export of `app.js`. The type parameters carry `Inputs` for `setInput` and
 * `Outputs` for `onOutput`; at run time inputs are always validated by the generated codecs.
 */
export interface MtekProgram<I = Record<string, unknown>, O = Record<string, unknown>> {
  readonly abi: 1;
  readonly baseUrl: URL;
  readonly manifestUrl: URL;
  readonly writers: MtekProgramWriters;
  readonly functions: MtekProgramFunctions;
  readonly scenes: Readonly<Record<string, MtekProgramScene>>;
  readonly prefabs: Readonly<Record<string, MtekProgramPrefab>>;
  /** Phantom, never present at run time. */
  readonly __inputs?: I;
  /** Phantom, never present at run time. Map interface keys so single-generic hosts accept generated Outputs. */
  readonly __outputs?: { readonly [K in keyof O]: O[K] };
}
