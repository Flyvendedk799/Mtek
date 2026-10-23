// Saved state and settings (decisions 0145, 0146, `spec/scenes.md` section 16): the storage format, the shape and
// type checks of a stored value (W5402), write failures (W5403) and autosave of settings. The game-level behaviour
// (restore on scene start, save/load/clear_saved through ctx, go_to) is in host/game.test.ts.
import { describe, expect, it } from "vitest";
import {
  GameSaves,
  MemorySaveStorage,
  decodeValue,
  encodeValue,
  persistentEntries,
  saveKey,
  type PersistentEntry,
  type SaveProblem,
  type SaveStorage,
} from "./saves.js";

function saves(storage: SaveStorage = new MemorySaveStorage(), unavailable = false): { saves: GameSaves; problems: SaveProblem[]; storage: SaveStorage } {
  const problems: SaveProblem[] = [];
  return { saves: new GameSaves(storage, "demo", (problem) => problems.push(problem), unavailable), problems, storage };
}

function document(storage: SaveStorage): unknown {
  const text = storage.getItem(saveKey("demo"));
  return text === null ? null : JSON.parse(text);
}

const BEST: PersistentEntry = { name: "best", type: "i32", persist: "saved" };
const VOLUME: PersistentEntry = { name: "volume", type: "f32", persist: "setting" };
const LEVEL: PersistentEntry = { name: "level", type: "enum(Easy|Hard)", persist: "saved" };

describe("the stored document", () => {
  it("is one JSON document per program under mtek.save.<storage>", () => {
    const { saves: game, storage } = saves();
    game.save([BEST, VOLUME], { best: 7, volume: 0.5 });
    expect(saveKey("demo")).toBe("mtek.save.demo");
    expect(document(storage)).toEqual({ format: 1, values: { best: { type: "i32", value: 7 }, volume: { type: "f32", value: 0.5 } } });
  });

  it("keeps the values of states another scene declares", () => {
    const { saves: game, storage } = saves();
    game.save([BEST], { best: 7 });
    game.save([VOLUME], { volume: 0.25 });
    expect(document(storage)).toEqual({ format: 1, values: { best: { type: "i32", value: 7 }, volume: { type: "f32", value: 0.25 } } });
  });

  it("takes the manifest's storedType over its type", () => {
    expect(
      persistentEntries([
        { name: "a", type: "i32" },
        { name: "b", type: "src/main.mtek::Options", persist: "setting", storedType: "{volume: f32}" },
        { name: "c", type: "u32", persist: "saved" },
      ]),
    ).toEqual([
      { name: "b", type: "{volume: f32}", persist: "setting" },
      { name: "c", type: "u32", persist: "saved" },
    ]);
  });
});

describe("encodeValue and decodeValue", () => {
  it("round-trips vectors, matrices, arrays and structs in the shape of the current value", () => {
    const template = {
      position: Object.freeze({ x: 0, y: 0, z: 0 }),
      transform: new Float32Array(16),
      flags: [false, false],
      name: "",
      lives: 3,
    };
    const value = {
      position: Object.freeze({ x: 1, y: 2, z: 3 }),
      transform: new Float32Array(16).fill(0.5),
      flags: [true, false],
      name: "abe",
      lives: 1,
    };
    const json = JSON.parse(JSON.stringify(encodeValue(value))) as unknown;
    expect(json).toEqual({ position: { x: 1, y: 2, z: 3 }, transform: new Array<number>(16).fill(0.5), flags: [true, false], name: "abe", lives: 1 });
    const decoded = decodeValue(json, template) as typeof value;
    expect(decoded.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(Object.isFrozen(decoded.position)).toBe(true);
    expect(decoded.transform).toBeInstanceOf(Float32Array);
    expect(Array.from(decoded.transform)).toEqual(new Array<number>(16).fill(0.5));
    expect(decoded.flags).toEqual([true, false]);
    expect(decoded.name).toBe("abe");
  });

  it("refuses another shape", () => {
    expect(decodeValue([1, 2], new Float32Array(16))).toBeUndefined();
    expect(decodeValue({ x: 1, y: 2 }, Object.freeze({ x: 0, y: 0, z: 0 }))).toBeUndefined();
    expect(decodeValue([true], [false, false])).toBeUndefined();
    expect(decodeValue({ a: 1 }, { a: 1, b: 2 })).toBeUndefined();
    expect(decodeValue({ a: 1, c: 2 }, { a: 1, b: 2 })).toBeUndefined();
    expect(decodeValue("1", 1)).toBeUndefined();
    expect(decodeValue(null, 1)).toBeUndefined();
    expect(decodeValue(1, true)).toBeUndefined();
  });
});

describe("restore and load", () => {
  it("applies stored values of the same type and says whether any was applied", () => {
    const { saves: game } = saves();
    const state: Record<string, unknown> = { best: 0, volume: 0.8 };
    expect(game.restore([BEST, VOLUME], state)).toBe(false);
    game.save([BEST, VOLUME], { best: 3, volume: 0.1 });
    expect(game.restore([BEST, VOLUME], state)).toBe(true);
    expect(state).toEqual({ best: 3, volume: 0.1 });
  });

  it("W5402: another type, another shape, a non-integer i32 or an enum index out of range is ignored, once per state", () => {
    const storage = new MemorySaveStorage();
    storage.setItem(
      saveKey("demo"),
      JSON.stringify({
        format: 1,
        values: { best: { type: "i32", value: 1.5 }, volume: { type: "i32", value: 1 }, level: { type: "enum(Easy|Hard)", value: 2 } },
      }),
    );
    const { saves: game, problems } = saves(storage);
    const state: Record<string, unknown> = { best: 0, volume: 0.8, level: 0 };
    expect(game.restore([BEST, VOLUME, LEVEL], state)).toBe(false);
    expect(game.restore([BEST, VOLUME, LEVEL], state)).toBe(false);
    expect(state).toEqual({ best: 0, volume: 0.8, level: 0 });
    expect(problems.map((problem) => problem.code)).toEqual(["W5402", "W5402", "W5402"]);
    expect(problems[1]?.message).toContain("has type i32, but the state is f32");
  });

  it("W5402: an enum whose variants changed has another stored type", () => {
    const { saves: game, problems } = saves();
    game.save([{ ...LEVEL, type: "enum(Easy|Normal|Hard)" }], { level: 2 });
    const state: Record<string, unknown> = { level: 0 };
    expect(game.restore([LEVEL], state)).toBe(false);
    expect(state["level"]).toBe(0);
    expect(problems.map((problem) => problem.code)).toEqual(["W5402"]);
  });

  it("W5402: an unreadable document is ignored until the next save", () => {
    const storage = new MemorySaveStorage();
    storage.setItem(saveKey("demo"), "{not json");
    const { saves: game, problems } = saves(storage);
    const state: Record<string, unknown> = { best: 0 };
    expect(game.restore([BEST], state)).toBe(false);
    expect(problems.map((problem) => problem.code)).toEqual(["W5402"]);
    game.save([BEST], { best: 4 });
    expect(document(storage)).toEqual({ format: 1, values: { best: { type: "i32", value: 4 } } });
  });
});

describe("autosave of settings", () => {
  it("writes the settings only when one changed, and never a saved state", () => {
    const { saves: game, storage } = saves();
    const state: Record<string, unknown> = { best: 0, volume: 0.8 };
    game.restore([BEST, VOLUME], state);
    game.autosave([BEST, VOLUME], state);
    expect(document(storage)).toBeNull();
    state["best"] = 9;
    game.autosave([BEST, VOLUME], state);
    expect(document(storage)).toBeNull();
    state["volume"] = 0.4;
    game.autosave([BEST, VOLUME], state);
    expect(document(storage)).toEqual({ format: 1, values: { volume: { type: "f32", value: 0.4 } } });
  });
});

describe("clear and write failures", () => {
  it("clear_saved removes the program's key", () => {
    const { saves: game, storage } = saves();
    game.save([BEST], { best: 1 });
    game.clear();
    expect(storage.getItem(saveKey("demo"))).toBeNull();
  });

  it("W5403: a refused write is reported and nothing throws", () => {
    const storage: SaveStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const { saves: game, problems } = saves(storage);
    expect(() => {
      game.save([BEST], { best: 1 });
      game.clear();
    }).not.toThrow();
    expect(problems.map((problem) => problem.code)).toEqual(["W5403", "W5403"]);
    expect(problems[0]?.message).toContain("quota exceeded");
  });

  it("W5403: a page without storage keeps the values in memory and says so once", () => {
    const { saves: game, problems, storage } = saves(new MemorySaveStorage(), true);
    game.save([BEST], { best: 1 });
    game.save([BEST], { best: 2 });
    expect(problems.map((problem) => problem.code)).toEqual(["W5403"]);
    expect(problems[0]?.message).toContain("until the page closes");
    expect(document(storage)).toEqual({ format: 1, values: { best: { type: "i32", value: 2 } } });
  });

  it("does nothing for a program without persistent state", () => {
    const storage = new MemorySaveStorage();
    const game = new GameSaves(storage, undefined, () => {
      throw new Error("no report expected");
    });
    expect(game.enabled).toBe(false);
    game.save([BEST], { best: 1 });
    game.clear();
    expect(storage.getItem(saveKey("demo"))).toBeNull();
  });
});

describe("a save id adopts the saves of the old key once (decision 0179)", () => {
  const OLD = JSON.stringify({ format: 1, values: { best: { type: "i32", value: 9 } } });
  const adopting = (storage: SaveStorage): GameSaves => new GameSaves(storage, "demo.1a2b3c4d", () => undefined, false, "demo");

  it("reads the old key when the new one is empty, copies it, and leaves the old key alone", () => {
    const storage = new MemorySaveStorage();
    storage.setItem(saveKey("demo"), OLD);
    const state: Record<string, unknown> = { best: 0 };
    expect(adopting(storage).restore([BEST], state)).toBe(true);
    expect(state["best"]).toBe(9);
    expect(storage.getItem(saveKey("demo.1a2b3c4d"))).toBe(OLD);
    expect(storage.getItem(saveKey("demo"))).toBe(OLD);
  });

  it("prefers the new key once it exists", () => {
    const storage = new MemorySaveStorage();
    storage.setItem(saveKey("demo"), OLD);
    adopting(storage).save([BEST], { best: 12 });
    const state: Record<string, unknown> = { best: 0 };
    expect(adopting(storage).restore([BEST], state)).toBe(true);
    expect(state["best"]).toBe(12);
  });

  it("keeps two games of one name apart: a game with an id and no migration never reads the old key", () => {
    const storage = new MemorySaveStorage();
    storage.setItem(saveKey("demo"), OLD);
    const other = new GameSaves(storage, "demo.9f8e7d6c", () => undefined);
    const state: Record<string, unknown> = { best: 0 };
    expect(other.restore([BEST], state)).toBe(false);
    other.save([BEST], { best: 5 });
    expect(storage.getItem(saveKey("demo"))).toBe(OLD);
  });

  it("clear_saved keeps the saves cleared: the old key is not adopted again", () => {
    const storage = new MemorySaveStorage();
    storage.setItem(saveKey("demo"), OLD);
    const game = adopting(storage);
    game.restore([BEST], { best: 0 });
    game.clear();
    const state: Record<string, unknown> = { best: 0 };
    expect(adopting(storage).restore([BEST], state)).toBe(false);
    expect(state["best"]).toBe(0);
  });
});
