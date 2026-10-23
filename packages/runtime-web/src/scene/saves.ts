/**
 * Saved state and settings (decisions 0145 and 0146, `spec/scenes.md` section 16).
 *
 * A scene state declared `saved state` or `setting state` is persistent. Its value is kept in the browser's
 * `localStorage`, under one key per program (`mtek.save.<storage>`, where `<storage>` is the manifest's
 * `game.storage`). The key holds one JSON document for every scene of the program:
 *
 * ```json
 * { "format": 1, "values": { "best": { "type": "i32", "value": 12 }, "volume": { "type": "f32", "value": 0.5 } } }
 * ```
 *
 * - When a scene starts (mount, `go_to`, `reset()`), each persistent state that has a stored value of the same type
 *   takes it. This happens after `init` and before shared state is carried over.
 * - `save()` writes every persistent state of the running scene. Values of other scenes stay as they are.
 * - `load()` reads them back into the running scene and says whether anything was there.
 * - `clear_saved()` removes the program's key: saved state and settings alike.
 * - A `setting state` is also written at the end of every frame in which its value changed (autosave).
 *
 * Every stored value carries the structural description of its state's type (`storedType` of the manifest: struct
 * fields and enum variants spelled out), so a program that changed a struct or an enum ignores the old value.
 * A stored value that is unreadable, of another type, or of another shape is ignored and reported once as `W5402`.
 * The scene keeps the value it has. A storage that cannot be written (full, or disabled: then the values are kept in
 * memory for the life of the page) is reported as `W5403`.
 * Nothing throws into the program.
 */

/** The part of the Web Storage API the saves use; `localStorage`, or an in-memory stand-in for tests. */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A persistent state of a scene manifest. */
export interface PersistentEntry {
  readonly name: string;
  /**
   * The manifest's `storedType` (the structural description: struct fields and enum variants spelled out), or its
   * `type` when absent. A stored value recorded under another description is ignored.
   */
  readonly type: string;
  readonly persist: "saved" | "setting";
}

export type SaveProblem = { readonly code: "W5402" | "W5403"; readonly message: string };

interface StoredValue {
  readonly type: string;
  readonly value: unknown;
}

const FORMAT = 1;

/** The `localStorage` key of a program's saves. */
export function saveKey(storage: string): string {
  return `mtek.save.${storage}`;
}

/** A JSON-ready copy of a state value: vectors, colours and structs become objects, typed arrays arrays. */
export function encodeValue(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (Array.isArray(value)) return value.map(encodeValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]));
  }
  return value;
}

/**
 * The stored `value` rebuilt in the shape of `template` (the state's current value), or `undefined` when it does
 * not have that shape. Numbers must be finite; arrays keep their length; objects their keys; frozen values
 * (vectors, colours) come back frozen.
 */
export function decodeValue(stored: unknown, template: unknown): unknown {
  if (typeof template === "number") return typeof stored === "number" && Number.isFinite(stored) ? stored : undefined;
  if (typeof template === "boolean" || typeof template === "string") return typeof stored === typeof template ? stored : undefined;
  if (ArrayBuffer.isView(template)) {
    const view = template as unknown as { readonly length: number; readonly constructor: new (items: readonly number[]) => unknown };
    if (!Array.isArray(stored) || stored.length !== view.length) return undefined;
    if (!stored.every((item) => typeof item === "number" && Number.isFinite(item))) return undefined;
    return new view.constructor(stored as number[]);
  }
  if (Array.isArray(template)) {
    if (!Array.isArray(stored) || stored.length !== template.length) return undefined;
    const items: unknown[] = [];
    for (let i = 0; i < template.length; i += 1) {
      const item = decodeValue(stored[i], template[i]);
      if (item === undefined) return undefined;
      items.push(item);
    }
    return items;
  }
  if (typeof template === "object" && template !== null) {
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return undefined;
    const keys = Object.keys(template);
    const record = stored as Readonly<Record<string, unknown>>;
    if (Object.keys(record).length !== keys.length) return undefined;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (!(key in record)) return undefined;
      const item = decodeValue(record[key], (template as Readonly<Record<string, unknown>>)[key]);
      if (item === undefined) return undefined;
      out[key] = item;
    }
    return Object.isFrozen(template) ? Object.freeze(out) : out;
  }
  return undefined;
}

/** The persistent entries of a manifest's scene state. */
export function persistentEntries(
  state: readonly { readonly name: string; readonly type: string; readonly persist?: "saved" | "setting"; readonly storedType?: string }[],
): PersistentEntry[] {
  const out: PersistentEntry[] = [];
  for (const entry of state) {
    if (entry.persist !== undefined) out.push({ name: entry.name, type: entry.storedType ?? entry.type, persist: entry.persist });
  }
  return out;
}

/** Whether a decoded top-level value fits the integer types the template cannot tell from `f32`. */
function fitsScalar(type: string, value: unknown): boolean {
  if (typeof value !== "number") return true;
  if (type === "i32") return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
  if (type === "u32") return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
  const variants = /^enum\((.*)\)$/.exec(type);
  if (variants !== null) return Number.isInteger(value) && value >= 0 && value < variants[1]!.split("|").length;
  return true;
}

/** An in-memory storage: the default under test options, and what `storage: null` amounts to. */
export class MemorySaveStorage implements SaveStorage {
  private readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** The page's `localStorage` when it can be reached, else `null`. */
export function defaultSaveStorage(): SaveStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: SaveStorage }).localStorage;
    return candidate ?? null;
  } catch {
    // A sandboxed frame or disabled storage throws on access.
    return null;
  }
}

/** The saves of one program. */
export class GameSaves {
  /** The JSON of the settings as last read or written, so autosave writes only on a change. */
  private settingsSnapshot = "";
  private readonly warned = new Set<string>();

  constructor(
    private readonly storage: SaveStorage,
    /** `game.storage` of the manifest; `undefined` when the program has no persistent state. */
    private readonly namespace: string | undefined,
    private readonly report: (problem: SaveProblem) => void,
    /** Set when the page's storage could not be reached and `storage` is an in-memory stand-in: the first save says so. */
    private readonly unavailable = false,
    /** `game.legacyStorage`: the pre-0179 name whose saves a program with a save id adopts once (decision 0179). */
    private readonly legacyNamespace: string | undefined = undefined,
  ) {}

  /** Whether the program has persistent state at all. */
  get enabled(): boolean {
    return this.namespace !== undefined;
  }

  /**
   * Applies the stored values to the persistent states of `entries` in `state`; returns whether any value was
   * applied. Used when a scene starts and by `load()`.
   */
  restore(entries: readonly PersistentEntry[], state: Record<string, unknown>): boolean {
    if (entries.length === 0) return false;
    const stored = this.read();
    let applied = false;
    for (const entry of entries) {
      const item = stored[entry.name];
      if (item === undefined) continue;
      if (item.type !== entry.type) {
        this.warnOnce(`type:${entry.name}`, `The saved value of '${entry.name}' has type ${item.type}, but the state is ${entry.type} now; the state keeps its value.`);
        continue;
      }
      const value = decodeValue(item.value, state[entry.name]);
      if (value === undefined || !fitsScalar(entry.type, value)) {
        this.warnOnce(`shape:${entry.name}`, `The saved value of '${entry.name}' does not fit its type ${entry.type}; the state keeps its value.`);
        continue;
      }
      state[entry.name] = value;
      applied = true;
    }
    this.settingsSnapshot = this.settingsJson(entries, state);
    return applied;
  }

  /** `save()`: writes every persistent state of `entries`. */
  save(entries: readonly PersistentEntry[], state: Readonly<Record<string, unknown>>): void {
    if (entries.length === 0) return;
    this.write(entries, state);
    this.settingsSnapshot = this.settingsJson(entries, state);
  }

  /** Autosave: writes the persistent states when a `setting state` changed since the last read or write. */
  autosave(entries: readonly PersistentEntry[], state: Readonly<Record<string, unknown>>): void {
    if (!entries.some((entry) => entry.persist === "setting")) return;
    const json = this.settingsJson(entries, state);
    if (json === this.settingsSnapshot) return;
    this.settingsSnapshot = json;
    this.write(
      entries.filter((entry) => entry.persist === "setting"),
      state,
    );
  }

  /** `clear_saved()`: removes every stored value of the program. */
  clear(): void {
    if (this.namespace === undefined) return;
    try {
      // With a legacy name the key stays, empty, so that the old saves are not adopted again (decision 0179).
      if (this.legacyNamespace === undefined) this.storage.removeItem(saveKey(this.namespace));
      else this.storage.setItem(saveKey(this.namespace), JSON.stringify({ format: FORMAT, values: {} }));
    } catch (error) {
      this.report({ code: "W5403", message: `Clearing the saved data failed: ${errorText(error)}.` });
    }
  }

  private settingsJson(entries: readonly PersistentEntry[], state: Readonly<Record<string, unknown>>): string {
    const settings: Record<string, unknown> = {};
    for (const entry of entries) {
      if (entry.persist === "setting") settings[entry.name] = encodeValue(state[entry.name]);
    }
    return JSON.stringify(settings);
  }

  private read(): Record<string, StoredValue> {
    if (this.namespace === undefined) return {};
    let text: string | null;
    try {
      text = this.storage.getItem(saveKey(this.namespace));
      if (text === null && this.legacyNamespace !== undefined) {
        // Adopt the saves of the old key once: copy them to the new key, which then wins (decision 0179).
        text = this.storage.getItem(saveKey(this.legacyNamespace));
        if (text !== null) this.storage.setItem(saveKey(this.namespace), text);
      }
    } catch {
      return {};
    }
    if (text === null) return {};
    try {
      const document = JSON.parse(text) as unknown;
      if (typeof document !== "object" || document === null) throw new Error("not an object");
      const { format, values } = document as { format?: unknown; values?: unknown };
      if (format !== FORMAT || typeof values !== "object" || values === null) throw new Error(`format ${String(format)}`);
      const out: Record<string, StoredValue> = {};
      for (const [name, item] of Object.entries(values)) {
        if (typeof item === "object" && item !== null && typeof (item as { type?: unknown }).type === "string" && "value" in item) {
          out[name] = item as StoredValue;
        }
      }
      return out;
    } catch (error) {
      this.warnOnce("document", `The saved data under '${saveKey(this.namespace)}' cannot be read (${errorText(error)}); it is ignored until the next save.`);
      return {};
    }
  }

  private write(entries: readonly PersistentEntry[], state: Readonly<Record<string, unknown>>): void {
    if (this.namespace === undefined) return;
    if (this.unavailable) {
      this.warnOnce("unavailable", "This page has no usable localStorage: saved state and settings last only until the page closes.", "W5403");
    }
    const values: Record<string, StoredValue> = { ...this.read() };
    for (const entry of entries) values[entry.name] = { type: entry.type, value: encodeValue(state[entry.name]) };
    try {
      this.storage.setItem(saveKey(this.namespace), JSON.stringify({ format: FORMAT, values }));
    } catch (error) {
      this.report({ code: "W5403", message: `Saving failed: ${errorText(error)}.` });
    }
  }

  private warnOnce(key: string, message: string, code: "W5402" | "W5403" = "W5402"): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.report({ code, message });
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
