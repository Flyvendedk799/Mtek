// Game flow (decisions 0140 to 0144): `pause()`/`resume()` hold the game clock but not input, timers run on the game
// clock, `reset()` restarts the scene, `go_to(Scene)` switches to another scene of the build with its shared state,
// a failed scene change is `E5401` and the current scene keeps running, and a `while` past its cap is `E8080`.
// The programs are hand-written in the shape the compiler emits (`ctx.after(seconds, fn, owner, spanId)`, ...), run on
// the fake host; the compiler's own output runs in tests/codegen and the browser specs.
import { describe, expect, it, vi } from "vitest";
import type { MtekManifest } from "../abi/manifest-types.js";
import type { MtekProgramScene } from "../abi/program.js";
import { checkManifest } from "../abi/validate.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { whileLimit } from "../scene/budget.js";
import { MemorySaveStorage, saveKey, type SaveStorage } from "../scene/saves.js";
import { BASE_URL, FakeHost, MANIFEST_URL, asDom, minimalSceneInit } from "../test-support/fake-host.js";
import { installProgram, validManifest } from "../test-support/mount-fixture.js";
import { syntheticProgram, type TestProgram } from "../test-support/program.js";
import { createHash } from "node:crypto";
import type { AudioBackend, AudioContextLike, BufferSourceLike, GainNodeLike, PannerLike } from "../audio/audio.js";
import { FakePhysicsBackend } from "../test-support/fake-physics.js";
import type { MountedApp } from "./app.js";
import { mountMtekWith } from "./mount.js";
import type { MtekApp } from "./types.js";

const FRAME = 1 / 60;
const LEVEL2_MANIFEST_URL = `${BASE_URL}program.Level2.manifest.json`;

interface GameCtx {
  readonly s: Record<string, unknown>;
  goTo(scene: string, spanId: number): void;
  reset(): void;
  pause(): void;
  resume(): void;
  paused(): boolean;
  after(seconds: number, fn: () => void, owner: unknown, spanId: number): void;
  every(seconds: number, fn: () => void, owner: unknown, spanId: number): void;
  save(): void;
  load(): boolean;
  clearSaved(): void;
  random(): number;
  readonly hud: { text(...args: unknown[]): void; button(...args: unknown[]): boolean };
  readonly audio: { playAt(...args: unknown[]): void; playMusic(...args: unknown[]): void };
  setCamera(field: string, value: unknown): void;
}

interface Scenes {
  init?: (ctx: GameCtx) => void;
  update?: (ctx: GameCtx, dt: number) => void;
  ui?: (ctx: GameCtx, dt: number) => void;
  fixedUpdate?: (ctx: GameCtx, dt: number) => void;
  onSpace?: (ctx: GameCtx) => void;
  onEnter?: (ctx: GameCtx) => void;
}

/** The minimal manifest as scene `name`, with a shared `score` and an ordinary `lives`, and `game.scenes`. */
function sceneManifestJson(name: string, scenes: readonly string[] = ["Demo", "Level2"]): Record<string, unknown> {
  let text = JSON.stringify(validManifest());
  if (name !== "Demo") text = text.replaceAll('"Demo"', `"${name}"`).replaceAll("::Demo", `::${name}`);
  const json = JSON.parse(text) as Record<string, unknown>;
  const scene = json["scene"] as Record<string, unknown>;
  scene["state"] = [
    { name: "score", type: "i32", symbol: `src/main.mtek::${name}.score`, shared: true },
    { name: "lives", type: "i32", symbol: `src/main.mtek::${name}.lives` },
  ];
  (json["symbols"] as unknown[]).push(
    { id: `src/main.mtek::${name}.score`, kind: "state", span: 0 },
    { id: `src/main.mtek::${name}.lives`, kind: "state", span: 0 },
  );
  json["game"] = {
    scenes: scenes.map((scene) =>
      scene === "Demo"
        ? { name: scene, module: "app.js", manifest: "program.manifest.json" }
        : { name: scene, module: `app.${scene}.js`, manifest: `program.${scene}.manifest.json` },
    ),
  };
  return json;
}

function parse(json: Record<string, unknown>): MtekManifest {
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  return parsed.manifest;
}

function programOf(manifest: MtekManifest, scene: Scenes, manifestFile = "program.manifest.json"): TestProgram {
  const init = (ctx: object): void => {
    minimalSceneInit(ctx);
    const game = ctx as GameCtx;
    game.s["score"] = 0;
    game.s["lives"] = 3;
    scene.init?.(game);
  };
  const base = syntheticProgram(manifest, init, BASE_URL);
  const entry = (base.scenes as Record<string, MtekProgramScene>)[manifest.entryScene];
  if (entry === undefined) throw new Error("no entry scene");
  const events: Record<string, unknown> = {};
  if (scene.onSpace !== undefined) events["key_down"] = [{ key: "Space", owner: -1, fn: scene.onSpace }];
  if (scene.onEnter !== undefined) {
    events["key_down"] = [...((events["key_down"] as unknown[] | undefined) ?? []), { key: "Enter", owner: -1, fn: scene.onEnter }];
  }
  const replaced = {
    ...entry,
    update: scene.update ?? null,
    fixedUpdate: scene.fixedUpdate ?? null,
    ...(scene.ui === undefined ? {} : { ui: scene.ui }),
    events,
  } as unknown as MtekProgramScene;
  return { ...base, manifestUrl: new URL(manifestFile, BASE_URL), scenes: { [manifest.entryScene]: replaced } };
}

interface Run {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly seen: MtekDiagnostic[];
  readonly debug: NonNullable<MtekApp["debug"]>;
}

/** Makes `score` a shared saved state and adds a setting state `volume: f32` (decisions 0145, 0146). */
function withSaves(json: Record<string, unknown>): Record<string, unknown> {
  const scene = json["scene"] as Record<string, unknown>;
  const name = (scene["name"] as string | undefined) ?? "Demo";
  const state = scene["state"] as Record<string, unknown>[];
  state[0] = { ...state[0], persist: "saved", storedType: "i32" };
  state.push({ name: "volume", type: "f32", symbol: `src/main.mtek::${name}.volume`, persist: "setting", storedType: "f32" });
  (json["symbols"] as unknown[]).push({ id: `src/main.mtek::${name}.volume`, kind: "state", span: 0 });
  json["game"] = { ...(json["game"] as Record<string, unknown>), storage: "demo" };
  return json;
}

interface MountOptions {
  /** Persistent state in both scenes, and this storage (decisions 0145, 0146). */
  readonly saves?: SaveStorage | null;
  /** Edits the manifest JSON of a scene before it is installed (a sound, a physics module, ...). */
  readonly edit?: (json: Record<string, unknown>, scene: string) => void;
  /** Adds files and modules to the fake host. */
  readonly setup?: (host: FakeHost) => void;
  /** The Web Audio stand-in (`environment.audio`). */
  readonly audio?: AudioBackend;
}

async function mount(scene: Scenes, level2?: Scenes, options: MountOptions = {}): Promise<Run> {
  const host = new FakeHost();
  const persistent = options.saves !== undefined;
  const json = persistent ? withSaves(sceneManifestJson("Demo")) : sceneManifestJson("Demo");
  options.edit?.(json, "Demo");
  options.setup?.(host);
  installProgram(host, (manifest) => {
    Object.assign(manifest, json);
  });
  const manifest = parse(json);
  if (level2 !== undefined) {
    const levelJson = persistent ? withSaves(sceneManifestJson("Level2")) : sceneManifestJson("Level2");
    options.edit?.(levelJson, "Level2");
    host.files.set(LEVEL2_MANIFEST_URL, JSON.stringify(levelJson));
    const module = { default: programOf(parse(levelJson), level2, "program.Level2.manifest.json") };
    host.modules.set(`${BASE_URL}app.Level2.js?build=${manifest.buildId}`, module);
  }
  const seen: MtekDiagnostic[] = [];
  const environment = options.audio === undefined ? host.environment : { ...host.environment, audio: options.audio };
  const app = await mountMtekWith(environment, asDom<HTMLCanvasElement>(host.canvas), programOf(manifest, scene), {
    test: { manualClock: true, renderTarget: { width: 8, height: 8 } },
    seed: 1,
    onDiagnostic: (d) => seen.push(d),
    ...(persistent ? { storage: options.saves } : {}),
  });
  if (app.debug === undefined) throw new Error("missing debug");
  expect(host.files.has(MANIFEST_URL)).toBe(true);
  return { host, app, seen, debug: app.debug };
}

describe("pause() and resume(): the game clock stops, input and rendering go on", () => {
  it("skips update and fixed_update while paused, still delivers key handlers, and resumes", async () => {
    let updates = 0;
    let ticks = 0;
    let toggles = 0;
    const { app, debug, seen } = await mount({
      update: () => {
        updates += 1;
      },
      fixedUpdate: () => {
        ticks += 1;
      },
      onSpace: (ctx) => {
        toggles += 1;
        if (ctx.paused()) ctx.resume();
        else ctx.pause();
      },
    });
    debug.step(3, FRAME);
    expect(updates).toBe(3);
    const ticksBefore = ticks;
    expect(ticksBefore).toBeGreaterThan(0);

    debug.pressKey("Space");
    debug.step(5, FRAME);
    // The pause was issued in phase 1 of the first of these frames: none of them updated or ticked.
    expect(toggles).toBe(1);
    expect(updates).toBe(3);
    expect(ticks).toBe(ticksBefore);
    expect(app.state).toBe("running");

    debug.releaseKey("Space");
    debug.pressKey("Space");
    debug.step(2, FRAME);
    expect(toggles).toBeGreaterThanOrEqual(2);
    expect(updates).toBe(5);
    // The held interval is never simulated: no burst of ticks after resume.
    expect(ticks - ticksBefore).toBeLessThanOrEqual(3);
    expect(seen).toEqual([]);
    app.dispose();
  });
});

describe("after and every: timers on the game clock", () => {
  it("runs an after block once at its time and an every block once per period", async () => {
    const log: string[] = [];
    let frame = 0;
    const { app, debug } = await mount({
      init: () => undefined,
      update: (ctx) => {
        frame += 1;
        if (frame === 1) {
          ctx.after(0.1, () => log.push(`after@${String(frame)}`), null, 0);
          ctx.every(0.05, () => log.push(`every@${String(frame)}`), null, 0);
        }
      },
    });
    // Frame 1 starts the timers (they wait for the next frame); 0.05 s is 3 frames of 1/60 s.
    debug.step(12, FRAME);
    const afters = log.filter((entry) => entry.startsWith("after"));
    const everys = log.filter((entry) => entry.startsWith("every"));
    expect(afters).toHaveLength(1);
    expect(everys.length).toBeGreaterThanOrEqual(3);
    expect(everys.length).toBeLessThanOrEqual(4);
    app.dispose();
  });

  it("does not count paused time", async () => {
    let fired = 0;
    let started = false;
    const { app, debug } = await mount({
      update: (ctx) => {
        if (!started) {
          started = true;
          ctx.after(0.1, () => (fired += 1), null, 0);
        }
      },
      onSpace: (ctx) => {
        ctx.pause();
      },
      onEnter: (ctx) => {
        ctx.resume();
      },
    });
    debug.step(1, FRAME);
    debug.pressKey("Space");
    debug.step(30, FRAME);
    expect(fired).toBe(0);
    debug.pressKey("Enter");
    debug.step(3, FRAME);
    expect(fired).toBe(0);
    debug.step(6, FRAME);
    expect(fired).toBe(1);
    app.dispose();
  });
});

describe("reset() and go_to(Scene)", () => {
  it("reset restarts the scene from its initial values at the start of a later frame", async () => {
    let inits = 0;
    const { app, debug, seen } = await mount({
      init: () => {
        inits += 1;
      },
      update: (ctx) => {
        ctx.s["lives"] = 1;
        ctx.s["score"] = 7;
      },
      onSpace: (ctx) => {
        ctx.reset();
      },
    });
    debug.step(1, FRAME);
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      expect(inits).toBe(2);
    });
    expect(seen).toEqual([]);
    app.dispose();
  });

  it("go_to switches to the scene's module and carries the shared state only", async () => {
    let levelInits = 0;
    const levelValues: unknown[] = [];
    const { app, debug, seen } = await mount(
      {
        update: (ctx) => {
          ctx.s["score"] = 42;
          ctx.s["lives"] = 1;
        },
        onSpace: (ctx) => {
          ctx.goTo("Level2", 0);
        },
      },
      {
        init: () => {
          levelInits += 1;
        },
        update: (ctx) => {
          levelValues.push([ctx.s["score"], ctx.s["lives"]]);
        },
      },
    );
    debug.step(1, FRAME);
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      expect(levelInits).toBe(1);
    });
    debug.step(1, FRAME);
    expect(levelValues[0]).toEqual([42, 3]);
    expect(seen).toEqual([]);
    app.dispose();
  });

  it("E5401: a scene the build does not have is reported and the current scene keeps running", async () => {
    let updates = 0;
    const { app, debug, seen } = await mount({
      update: () => {
        updates += 1;
      },
      onSpace: (ctx) => {
        ctx.goTo("Level2", 0);
      },
    });
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      expect(seen.map((d) => d.code)).toEqual(["MTEK-E5401"]);
    });
    expect(seen[0]?.severity).toBe("error");
    expect(seen[0]?.title).toBe("scene change failed");
    expect(seen[0]?.message).toContain("go_to(Level2)");
    debug.step(2, FRAME);
    expect(updates).toBe(3);
    expect(app.state).toBe("running");
    app.dispose();
  });
});

describe("while: the iteration cap", () => {
  it("fails the frame with E8080 naming the while", async () => {
    const { app, debug, seen } = await mount({
      update: () => {
        whileLimit(2);
      },
    });
    debug.step(1, FRAME);
    expect(app.state).toBe("failed");
    expect(seen.map((d) => d.code)).toEqual(["MTEK-E8080"]);
    expect(seen[0]?.message).toContain("`while`");
    app.dispose();
  });
});

describe("saved state and settings (decisions 0145, 0146)", () => {
  /** A store whose `demo` key already holds `values`. */
  function storeWith(values: Record<string, { type: string; value: unknown }>): MemorySaveStorage {
    const storage = new MemorySaveStorage();
    storage.setItem(saveKey("demo"), JSON.stringify({ format: 1, values }));
    return storage;
  }

  function stored(storage: SaveStorage): Record<string, { type: string; value: unknown }> {
    const text = storage.getItem(saveKey("demo"));
    if (text === null) return {};
    return (JSON.parse(text) as { values: Record<string, { type: string; value: unknown }> }).values;
  }

  it("restores the stored values when the scene starts, after init", async () => {
    const storage = storeWith({ score: { type: "i32", value: 12 }, volume: { type: "f32", value: 0.25 } });
    const seenInInit: unknown[] = [];
    const seenInUpdate: unknown[] = [];
    const { app, debug, seen } = await mount(
      {
        init: (ctx) => {
          ctx.s["volume"] = 0.8;
          seenInInit.push(ctx.s["score"]);
        },
        update: (ctx) => {
          seenInUpdate.push([ctx.s["score"], ctx.s["volume"]]);
        },
      },
      undefined,
      { saves: storage },
    );
    debug.step(1, FRAME);
    expect(seenInInit).toEqual([0]);
    expect(seenInUpdate).toEqual([[12, 0.25]]);
    expect(seen).toEqual([]);
    app.dispose();
  });

  it("save() writes, load() reads back and says whether there was anything, clear_saved() deletes", async () => {
    const storage = new MemorySaveStorage();
    const loads: boolean[] = [];
    const { app, debug, seen } = await mount(
      {
        init: (ctx) => {
          ctx.s["volume"] = 0.8;
        },
        onSpace: (ctx) => {
          ctx.s["score"] = 5;
          ctx.save();
          ctx.s["score"] = 9;
          loads.push(ctx.load());
        },
        onEnter: (ctx) => {
          ctx.clearSaved();
          loads.push(ctx.load());
        },
      },
      undefined,
      { saves: storage },
    );
    debug.step(1, FRAME);
    expect(storage.getItem(saveKey("demo"))).toBeNull();
    debug.pressKey("Space");
    debug.step(1, FRAME);
    expect(loads).toEqual([true]);
    expect(debug.scene().state["score"]).toBe(5);
    expect(stored(storage)).toEqual({ score: { type: "i32", value: 5 }, volume: { type: "f32", value: 0.8 } });
    debug.pressKey("Enter");
    debug.step(1, FRAME);
    expect(loads).toEqual([true, false]);
    expect(storage.getItem(saveKey("demo"))).toBeNull();
    // The running scene keeps its values.
    expect(debug.scene().state["score"]).toBe(5);
    expect(seen).toEqual([]);
    app.dispose();
  });

  it("writes a setting at the end of the frame it changed in, and a saved state only on save()", async () => {
    const storage = new MemorySaveStorage();
    const { app, debug } = await mount(
      {
        init: (ctx) => {
          ctx.s["volume"] = 0.8;
        },
        onSpace: (ctx) => {
          ctx.s["volume"] = 0.3;
          ctx.s["score"] = 4;
        },
      },
      undefined,
      { saves: storage },
    );
    debug.step(2, FRAME);
    // Nothing changed since the scene started: nothing written.
    expect(storage.getItem(saveKey("demo"))).toBeNull();
    debug.pressKey("Space");
    debug.step(1, FRAME);
    expect(stored(storage)).toEqual({ volume: { type: "f32", value: 0.3 } });
    app.dispose();
  });

  it("go_to restores the saved values in the new scene, and a carried shared value wins", async () => {
    const storage = storeWith({ score: { type: "i32", value: 1 }, volume: { type: "f32", value: 0.5 } });
    let levelInits = 0;
    const levelValues: unknown[] = [];
    const { app, debug } = await mount(
      {
        init: (ctx) => {
          ctx.s["volume"] = 0.8;
        },
        onSpace: (ctx) => {
          ctx.s["score"] = 30;
          ctx.goTo("Level2", 0);
        },
      },
      {
        init: (ctx) => {
          levelInits += 1;
          ctx.s["volume"] = 0.8;
        },
        update: (ctx) => {
          levelValues.push([ctx.s["score"], ctx.s["volume"]]);
        },
      },
      { saves: storage },
    );
    debug.step(1, FRAME);
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      expect(levelInits).toBe(1);
    });
    debug.step(1, FRAME);
    expect(levelValues[0]).toEqual([30, 0.5]);
    app.dispose();
  });

  it("W5402: a stored value of another type or shape is ignored, once per state", async () => {
    const storage = storeWith({ score: { type: "f32", value: 1.5 }, volume: { type: "f32", value: "loud" } });
    const { app, debug, seen } = await mount(
      {
        init: (ctx) => {
          ctx.s["volume"] = 0.8;
        },
        onSpace: (ctx) => {
          ctx.load();
        },
      },
      undefined,
      { saves: storage },
    );
    debug.pressKey("Space");
    debug.step(1, FRAME);
    expect(seen.map((d) => d.code)).toEqual(["MTEK-W5402", "MTEK-W5402"]);
    expect(seen.every((d) => d.severity === "warning")).toBe(true);
    expect(seen[0]?.message).toContain("'score'");
    expect(debug.scene().state["score"]).toBe(0);
    expect(debug.scene().state["volume"]).toBe(0.8);
    expect(app.state).toBe("running");
    app.dispose();
  });

  it("W5403: a storage that refuses writes is reported and the game goes on", async () => {
    const storage: SaveStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    const { app, debug, seen } = await mount(
      {
        onSpace: (ctx) => {
          ctx.save();
        },
      },
      undefined,
      { saves: storage },
    );
    debug.pressKey("Space");
    debug.step(1, FRAME);
    expect(seen.map((d) => d.code)).toEqual(["MTEK-W5403"]);
    expect(seen[0]?.message).toContain("QuotaExceededError");
    expect(app.state).toBe("running");
    app.dispose();
  });
});

/** The HUD elements the layer shows, by attribute (`data-mtek-hud-text`, `data-mtek-hud-button`). */
function hudTexts(host: FakeHost, kind: "text" | "button"): string[] {
  const layer = host.document.body.find("data-mtek-hud");
  return (layer?.children ?? []).filter((child) => child.attributes.has(`data-mtek-hud-${kind}`)).map((child) => child.textContent);
}

function hudButton(host: FakeHost, label: string): { dispatch(type: string): unknown } {
  const layer = host.document.body.find("data-mtek-hud");
  const found = (layer?.children ?? []).find((child) => child.attributes.has("data-mtek-hud-button") && child.textContent === label);
  if (found === undefined) throw new Error(`no HUD button '${label}'`);
  return found;
}

describe("ui(dt): the lifecycle function that runs while the game is paused (decision 0175)", () => {
  it("keeps the HUD of a pause menu on screen and hears the click on Resume", async () => {
    let updates = 0;
    const { app, debug, host, seen } = await mount({
      update: () => {
        updates += 1;
      },
      ui: (ctx) => {
        if (!ctx.paused()) return;
        ctx.hud.text(0, "Paused", { x: 0, y: 0.3 });
        if (ctx.hud.button(0, "Resume", { x: 0, y: 0 })) ctx.resume();
      },
      onSpace: (ctx) => {
        ctx.pause();
      },
    });
    debug.step(3, FRAME);
    expect(updates).toBe(3);
    expect(hudTexts(host, "button")).toEqual([]);
    debug.pressKey("Space");
    debug.step(3, FRAME);
    // `update` is held; the menu is drawn by `ui` in every one of these frames.
    expect(updates).toBe(3);
    expect(hudTexts(host, "text")).toEqual(["Paused"]);
    expect(hudTexts(host, "button")).toEqual(["Resume"]);
    hudButton(host, "Resume").dispatch("click");
    // The frame that hears the click resumes the game; the frames after it update and no longer draw the menu.
    debug.step(3, FRAME);
    expect(hudTexts(host, "button")).toEqual([]);
    expect(updates).toBeGreaterThan(3);
    expect(seen).toEqual([]);
    app.dispose();
  });

  it("runs after update in a running frame, with the frame delta", async () => {
    const order: string[] = [];
    const { app, debug } = await mount({
      update: () => {
        order.push("update");
      },
      ui: (_ctx, dt) => {
        order.push(`ui:${dt.toFixed(4)}`);
      },
    });
    debug.step(2, FRAME);
    expect(order).toEqual(["update", "ui:0.0167", "update", "ui:0.0167"]);
    app.dispose();
  });

  it("serves a Restart button: reset() from ui while paused starts the scene again with the game running", async () => {
    let inits = 0;
    const { app, debug, host } = await mount({
      init: () => {
        inits += 1;
      },
      ui: (ctx) => {
        if (ctx.paused() && ctx.hud.button(0, "Restart", { x: 0, y: -0.2 })) ctx.reset();
      },
      onSpace: (ctx) => {
        ctx.pause();
      },
    });
    debug.pressKey("Space");
    debug.step(2, FRAME);
    hudButton(host, "Restart").dispatch("click");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      expect(inits).toBe(2);
    });
    debug.step(2, FRAME);
    expect(hudTexts(host, "button")).toEqual([]);
    app.dispose();
  });

  it("does not run while the application itself is paused (app.pause stops everything)", async () => {
    let uis = 0;
    const { app, debug } = await mount({
      ui: () => {
        uis += 1;
      },
    });
    debug.step(2, FRAME);
    app.pause();
    debug.step(3, FRAME);
    expect(uis).toBe(2);
    app.resume();
    debug.step(1, FRAME);
    expect(uis).toBe(3);
    app.dispose();
  });
});

describe("a scene change that fails while the new world is made (G3)", () => {
  const physicsEdit = (json: Record<string, unknown>, scene: string): void => {
    if (scene === "Level2") json["subsystems"] = { physics: true, physicsModule: "physics/0123456789abcdef.js" };
  };

  it("reports E5401, keeps the scene and still takes the next go_to or reset()", async () => {
    const backend = new FakePhysicsBackend();
    backend.failCreateWorld = new Error("no physics today");
    let inits = 0;
    let updates = 0;
    const { app, debug, seen } = await mount(
      {
        init: () => {
          inits += 1;
        },
        update: () => {
          updates += 1;
        },
        onSpace: (ctx) => {
          ctx.goTo("Level2", 0);
        },
        onEnter: (ctx) => {
          ctx.reset();
        },
      },
      {},
      {
        edit: physicsEdit,
        setup: (host) => {
          host.modules.set(`${BASE_URL}physics/0123456789abcdef.js`, backend.module);
        },
      },
    );
    debug.step(1, FRAME);
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      expect(backend.module).toBeDefined();
      debug.step(1, FRAME);
      expect(seen.map((d) => d.code)).toContain("MTEK-E5401");
    });
    const failure = seen.find((d) => d.code === "MTEK-E5401");
    expect(failure?.message).toContain("go_to(Level2)");
    expect(failure?.notes.join(" ")).toContain("no physics today");
    expect(app.state).toBe("running");
    const before = updates;
    debug.step(2, FRAME);
    expect(updates).toBe(before + 2);
    // The request is not stuck: a reset() of the running scene goes through.
    debug.releaseKey("Space");
    debug.pressKey("Enter");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      expect(inits).toBe(2);
    });
    debug.step(1, FRAME);
    expect(app.state).toBe("running");
    app.dispose();
  });
});

describe("the scene that is being prepared has its own game hooks and random stream (decision 0176)", () => {
  it("pause() and save() in the new scene's init concern the new scene, not the one that still runs", async () => {
    const storage = new MemorySaveStorage();
    let demoPausedSeen: boolean[] = [];
    const level: { run?: Run } = {};
    const levelPaused: boolean[] = [];
    const run = await mount(
      {
        update: (ctx) => {
          ctx.s["score"] = 42;
          demoPausedSeen.push(ctx.paused());
        },
        onSpace: (ctx) => {
          ctx.goTo("Level2", 0);
        },
      },
      {
        init: (ctx) => {
          ctx.s["score"] = 77;
          ctx.pause();
          ctx.save();
          // A frame of the scene that still runs, while this one is half way through starting.
          level.run?.debug.step(2, FRAME);
        },
        onEnter: (ctx) => {
          levelPaused.push(ctx.paused());
        },
        update: () => {
          levelPaused.push(false);
        },
      },
      { saves: storage },
    );
    level.run = run;
    const { app, debug } = run;
    debug.step(1, FRAME);
    debug.pressKey("Space");
    debug.step(1, FRAME);
    demoPausedSeen = [];
    await vi.waitFor(() => {
      expect(storage.getItem(saveKey("demo"))).not.toBeNull();
    });
    // The running scene was not paused by the other scene's init, and its frames ran.
    expect(demoPausedSeen).toEqual([false, false]);
    // `save()` wrote the new scene's score, not the 42 of the running one.
    const written = JSON.parse(storage.getItem(saveKey("demo")) ?? "{}") as { values: Record<string, { value: unknown }> };
    expect(written.values["score"]?.value).toBe(77);
    // The swap makes the new scene live; it asked for the pause itself, so it starts paused.
    debug.step(1, FRAME);
    debug.pressKey("Enter");
    debug.step(1, FRAME);
    expect(levelPaused).toEqual([true]);
    app.dispose();
  });

  it("a scene change does not pause the new scene unless its own init did", async () => {
    const updates: string[] = [];
    const { app, debug } = await mount(
      {
        onSpace: (ctx) => {
          ctx.pause();
          ctx.goTo("Level2", 0);
        },
      },
      {
        update: () => {
          updates.push("level");
        },
      },
    );
    debug.step(1, FRAME);
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      debug.step(1, FRAME);
      expect(updates.length).toBeGreaterThan(0);
    });
    app.dispose();
  });

  it("draws the new scene's random numbers independently of the frames that run while it starts", async () => {
    async function drawsWith(framesDuringStart: number): Promise<number[]> {
      const draws: number[] = [];
      const self: { run?: Run } = {};
      const run = await mount(
        {
          update: (ctx) => {
            ctx.random();
          },
          onSpace: (ctx) => {
            ctx.goTo("Level2", 0);
          },
        },
        {
          init: (ctx) => {
            self.run?.debug.step(framesDuringStart, FRAME);
            draws.push(ctx.random(), ctx.random(), ctx.random());
          },
        },
      );
      self.run = run;
      run.debug.step(2, FRAME);
      run.debug.pressKey("Space");
      run.debug.step(1, FRAME);
      await vi.waitFor(() => {
        expect(draws).toHaveLength(3);
      });
      run.app.dispose();
      return draws;
    }
    const quick = await drawsWith(0);
    const slow = await drawsWith(3);
    expect(slow).toEqual(quick);
    expect(new Set(quick).size).toBe(3);
  });

  it("the new scene goes on drawing from its own stream after it became live", async () => {
    const after: number[] = [];
    const { app, debug } = await mount(
      {
        onSpace: (ctx) => {
          ctx.goTo("Level2", 0);
        },
      },
      {
        update: (ctx) => {
          after.push(ctx.random());
        },
      },
    );
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      debug.step(1, FRAME);
      expect(after.length).toBeGreaterThanOrEqual(2);
    });
    expect(after[0]).not.toBe(after[1]);
    app.dispose();
  });
});

describe("what a scene change carries and clears (decision 0176)", () => {
  it("carries a shared mat4 as a matrix, not as a plain object", async () => {
    const seenInLevel: unknown[] = [];
    const matrixState = (json: Record<string, unknown>, scene: string): void => {
      const state = (json["scene"] as Record<string, unknown>)["state"] as unknown[];
      state.push({ name: "m", type: "mat4", symbol: `src/main.mtek::${scene}.m`, shared: true });
      (json["symbols"] as unknown[]).push({ id: `src/main.mtek::${scene}.m`, kind: "state", span: 0 });
    };
    const { app, debug } = await mount(
      {
        update: (ctx) => {
          const m = new Float32Array(16);
          m[0] = m[5] = m[10] = m[15] = 1;
          m[12] = 5;
          ctx.s["m"] = m;
        },
        onSpace: (ctx) => {
          ctx.goTo("Level2", 0);
        },
      },
      {
        update: (ctx) => {
          seenInLevel.push(ctx.s["m"]);
        },
      },
      { edit: matrixState },
    );
    debug.step(1, FRAME);
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      debug.step(1, FRAME);
      expect(seenInLevel.length).toBeGreaterThan(0);
    });
    const carried = seenInLevel[0];
    expect(ArrayBuffer.isView(carried)).toBe(true);
    expect((carried as Float32Array)[12]).toBe(5);
    app.dispose();
  });

  it("drops a HUD click nobody claimed, so a same-labelled button of the next scene is not pressed", async () => {
    const pressed: string[] = [];
    const { app, debug, host } = await mount(
      {
        ui: (ctx) => {
          ctx.hud.button(0, "Play", { x: 0, y: 0 });
        },
        onSpace: (ctx) => {
          ctx.goTo("Level2", 0);
        },
      },
      {
        ui: (ctx) => {
          if (ctx.hud.button(0, "Play", { x: 0, y: 0 })) pressed.push("level");
        },
      },
    );
    debug.step(2, FRAME);
    hudButton(host, "Play").dispatch("click");
    // The click is waiting for a frame; a scene change happens first.
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      debug.step(1, FRAME);
      expect(hudTexts(host, "button")).toEqual(["Play"]);
    });
    debug.step(3, FRAME);
    expect(pressed).toEqual([]);
    app.dispose();
  });
});

/** A fake Web Audio that records the contexts it makes and where the panners were placed. */
function fakeAudio(): { backend: AudioBackend; contexts: (AudioContextLike & { panners: { at: number[] }[]; suspended: number })[] } {
  const contexts: (AudioContextLike & { panners: { at: number[] }[]; suspended: number })[] = [];
  const backend: AudioBackend = {
    createContext: () => {
      const gain = (): GainNodeLike => ({ gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined });
      const context: AudioContextLike & { panners: { at: number[] }[]; suspended: number } = {
        state: "suspended",
        destination: { connect: () => undefined, disconnect: () => undefined },
        panners: [],
        suspended: 0,
        resume() {
          (this as { state: string }).state = "running";
          return Promise.resolve();
        },
        suspend() {
          (this as { state: string }).state = "suspended";
          this.suspended += 1;
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
        createGain: gain,
        createBufferSource: (): BufferSourceLike => ({
          buffer: undefined,
          loop: false,
          playbackRate: { value: 1 },
          onended: null,
          connect: () => undefined,
          disconnect: () => undefined,
          start: () => undefined,
          stop: () => undefined,
        }),
        createPanner(): PannerLike {
          const panner = {
            panningModel: "",
            distanceModel: "",
            refDistance: 0,
            at: [] as number[],
            connect: () => undefined,
            disconnect: () => undefined,
            setPosition(x: number, y: number, z: number) {
              this.at = [x, y, z];
            },
          };
          context.panners.push(panner);
          return panner;
        },
      };
      contexts.push(context);
      return context;
    },
    decode: (bytes) => Promise.resolve({ length: bytes.length }),
  };
  return { backend, contexts };
}

const SOUND_URL = "assets/00000000000000c1.wav";
const SOUND_BYTES = new Uint8Array([82, 73, 70, 70]);

/** Puts one sound into both scenes' manifests and its bytes on the fake server. */
const withSound: Pick<MountOptions, "edit" | "setup"> = {
  edit: (json) => {
    json["assets"] = [
      {
        url: SOUND_URL,
        sha256: createHash("sha256").update(SOUND_BYTES).digest("hex"),
        bytes: SOUND_BYTES.length,
        kind: "audio",
        format: "wav",
        mime: "audio/wav",
        source: "sounds/hit.wav",
        span: 0,
      },
    ];
  },
  setup: (host) => {
    host.files.set(`${BASE_URL}${SOUND_URL}`, SOUND_BYTES);
  },
};

describe("audio in a game (decision 0176)", () => {
  it("unlocks on a pointer press anywhere in the document, also on a HUD button that stops the event", async () => {
    const { backend, contexts } = fakeAudio();
    const { app, host } = await mount({}, undefined, { ...withSound, audio: backend });
    expect(contexts).toHaveLength(0);
    host.document.dispatch("pointerdown", { isPrimary: true });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.state).toBe("running");
    app.dispose();
  });

  it("still unlocks when a hot reload adds the first sound to a program that had none", async () => {
    const { backend, contexts } = fakeAudio();
    const { app, debug, host } = await mount({}, undefined, { audio: backend });
    host.document.dispatch("pointerdown", { isPrimary: true });
    expect(contexts).toHaveLength(0);
    const json = sceneManifestJson("Demo");
    withSound.edit?.(json, "Demo");
    withSound.setup?.(host);
    host.files.set(MANIFEST_URL, JSON.stringify(json));
    const result = await app.replaceProgram?.(programOf(parse(json), {}));
    expect(result?.ok).toBe(true);
    debug.step(1, FRAME);
    host.document.dispatch("pointerdown", { isPrimary: true });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.state).toBe("running");
    app.dispose();
  });

  it("places positional sound against the camera of the scene that runs after go_to", async () => {
    const { backend, contexts } = fakeAudio();
    const { app, debug, host } = await mount(
      {
        init: (ctx) => {
          ctx.setCamera("position", { x: 0, y: 0, z: 5 });
          ctx.setCamera("target", { x: 0, y: 0, z: 0 });
        },
        onSpace: (ctx) => {
          ctx.goTo("Level2", 0);
        },
      },
      {
        init: (ctx) => {
          ctx.setCamera("position", { x: 10, y: 0, z: 5 });
          ctx.setCamera("target", { x: 10, y: 0, z: 0 });
        },
        onEnter: (ctx) => {
          ctx.audio.playAt(0, "sounds/hit.wav", { x: 10, y: 0, z: 0 });
        },
      },
      { ...withSound, audio: backend },
    );
    host.document.dispatch("keydown", { code: "KeyA" });
    await vi.waitFor(() => {
      expect(contexts).toHaveLength(1);
    });
    debug.step(1, FRAME);
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      debug.step(1, FRAME);
      expect((app as MountedApp).listenerPose().position.x).toBe(10);
    });
    debug.pressKey("Enter");
    debug.step(1, FRAME);
    // From the new camera at x = 10 the sound at x = 10 is straight ahead; from the first one it would be 10 to the right.
    const at = contexts[0]?.panners[0]?.at ?? [];
    expect(at[0]).toBeCloseTo(0);
    expect(at[2]).toBeCloseTo(-5);
    app.dispose();
  });

  it("holds the sound with app.pause() and a hidden page, but not with the program's pause()", async () => {
    const { backend, contexts } = fakeAudio();
    const { app, debug, host } = await mount(
      {
        onSpace: (ctx) => {
          ctx.pause();
        },
      },
      undefined,
      { ...withSound, audio: backend },
    );
    host.document.dispatch("keydown", { code: "KeyA" });
    expect(contexts[0]?.state).toBe("running");
    debug.pressKey("Space");
    debug.step(2, FRAME);
    expect(contexts[0]?.suspended).toBe(0);
    app.pause();
    expect(contexts[0]?.state).toBe("suspended");
    app.resume();
    expect(contexts[0]?.state).toBe("running");
    host.document.setVisibility("hidden");
    expect(contexts[0]?.state).toBe("suspended");
    host.document.setVisibility("visible");
    expect(contexts[0]?.state).toBe("running");
    app.dispose();
  });
});

describe("the keys whose browser default is suppressed (decision 0176)", () => {
  it("is rebuilt for the scene that runs after go_to", async () => {
    const { app, debug, host } = await mount(
      {
        onSpace: (ctx) => {
          ctx.goTo("Level2", 0);
        },
      },
      { onEnter: () => undefined },
    );
    const prevented = (code: string): boolean => host.document.dispatch("keydown", { code, repeat: false }).defaultPrevented;
    expect(prevented("Space")).toBe(true);
    host.document.dispatch("keyup", { code: "Space" });
    expect(prevented("Enter")).toBe(false);
    host.document.dispatch("keyup", { code: "Enter" });
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      debug.step(1, FRAME);
      expect(prevented("Enter")).toBe(true);
    });
    host.document.dispatch("keyup", { code: "Enter" });
    // Space is no longer named by a handler of the live scene.
    expect(prevented("Space")).toBe(false);
    app.dispose();
  });

  it("is rebuilt after a hot reload", async () => {
    const { app, debug, host } = await mount({ onSpace: () => undefined });
    const prevented = (code: string): boolean => host.document.dispatch("keydown", { code, repeat: false }).defaultPrevented;
    expect(prevented("Space")).toBe(true);
    host.document.dispatch("keyup", { code: "Space" });
    expect(prevented("Enter")).toBe(false);
    host.document.dispatch("keyup", { code: "Enter" });
    const result = await app.replaceProgram?.(programOf(parse(sceneManifestJson("Demo")), { onEnter: () => undefined }));
    expect(result?.ok).toBe(true);
    debug.step(1, FRAME);
    expect(prevented("Enter")).toBe(true);
    host.document.dispatch("keyup", { code: "Enter" });
    expect(prevented("Space")).toBe(false);
    app.dispose();
  });

  it("includes the keys the program polls, and forgets them with the scene", async () => {
    const { app, debug, host } = await mount(
      {
        update: (ctx) => {
          (ctx as unknown as { isKeyDown(code: string): boolean }).isKeyDown("ArrowLeft");
        },
        onSpace: (ctx) => {
          ctx.goTo("Level2", 0);
        },
      },
      {},
    );
    const prevented = (code: string): boolean => host.document.dispatch("keydown", { code, repeat: false }).defaultPrevented;
    expect(prevented("ArrowLeft")).toBe(false);
    host.document.dispatch("keyup", { code: "ArrowLeft" });
    debug.step(1, FRAME);
    expect(prevented("ArrowLeft")).toBe(true);
    host.document.dispatch("keyup", { code: "ArrowLeft" });
    debug.pressKey("Space");
    debug.step(1, FRAME);
    await vi.waitFor(() => {
      debug.step(1, FRAME);
      expect(prevented("ArrowLeft")).toBe(false);
    });
    app.dispose();
  });
});
