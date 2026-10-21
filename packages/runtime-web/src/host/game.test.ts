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
import { BASE_URL, FakeHost, MANIFEST_URL, asDom, minimalSceneInit } from "../test-support/fake-host.js";
import { installProgram, validManifest } from "../test-support/mount-fixture.js";
import { syntheticProgram, type TestProgram } from "../test-support/program.js";
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
}

interface Scenes {
  init?: (ctx: GameCtx) => void;
  update?: (ctx: GameCtx, dt: number) => void;
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

async function mount(scene: Scenes, level2?: Scenes): Promise<Run> {
  const host = new FakeHost();
  const json = sceneManifestJson("Demo");
  installProgram(host, (manifest) => {
    Object.assign(manifest, json);
  });
  const manifest = parse(json);
  if (level2 !== undefined) {
    const levelJson = sceneManifestJson("Level2");
    host.files.set(LEVEL2_MANIFEST_URL, JSON.stringify(levelJson));
    const module = { default: programOf(parse(levelJson), level2, "program.Level2.manifest.json") };
    host.modules.set(`${BASE_URL}app.Level2.js?build=${manifest.buildId}`, module);
  }
  const seen: MtekDiagnostic[] = [];
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), programOf(manifest, scene), {
    test: { manualClock: true, renderTarget: { width: 8, height: 8 } },
    seed: 1,
    onDiagnostic: (d) => seen.push(d),
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
