// The frame as generated code sees it (spec/scenes.md section 10, spec/runtime-abi.md section 7):
// input handlers, fixed ticks, updates, in stable instance order, driven by the manual clock. Two
// kinds of program run here: a synthetic scene whose functions log their calls (order, arguments),
// and the compiler's own `state_and_handlers` output (the fixture of decision 0049), run end to end.
import { describe, expect, it } from "vitest";
import type { MtekManifest } from "../abi/manifest-types.js";
import { checkManifest } from "../abi/validate.js";
import type { MtekProgramScene } from "../abi/program.js";
import { FakeHost, asDom, fakeProgram, minimalManifestJson, minimalSceneInit } from "../test-support/fake-host.js";
import { installProgram } from "../test-support/mount-fixture.js";
import { loadGoldenProgram, type TestProgram } from "../test-support/program.js";
import { mountMtekWith } from "./mount.js";
import type { MtekApp, MtekDebug, MtekMountOptions } from "./types.js";

type Json = Record<string, unknown>;
type Log = string[];
const fr = Math.fround;
const FIXED_STEP = fr(1 / 60);
const TARGET = { width: 8, height: 8 } as const;

/** Entity names that would break any code iterating an object's keys or reading its prototype. */
const NAMES = ["__proto__", "constructor", "toString"] as const;

function adversarialManifest(): MtekManifest {
  const json = minimalManifestJson() as Json;
  const scene = json["scene"] as { entities: Json[]; materialInstances: Json[]; state: Json[] };
  const template = scene.entities[0] ?? {};
  const instance = (scene.materialInstances[0] ?? {});
  scene.entities = NAMES.map((name, index) => ({
    ...template,
    index,
    name,
    symbol: `src/main.mtek::Demo.${name}`,
    material: { id: "std/materials.mtek::Unlit", instance: index },
    state: [{ name: "constructor", type: "i32", symbol: `src/main.mtek::Demo.${name}.constructor` }],
    update: true,
    fixedUpdate: true,
  }));
  scene.materialInstances = NAMES.map((_, index) => ({ ...instance, index, entity: index }));
  scene.state = [
    { name: "__proto__", type: "i32", symbol: "src/main.mtek::Demo.__proto__" },
    { name: "toString", type: "f32", symbol: "src/main.mtek::Demo.toString" },
  ];
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  return parsed.manifest;
}

interface Ctx {
  readonly s: Record<string, unknown>;
  readonly e: readonly { readonly state: Record<string, unknown> }[];
  readonly frame: { readonly time: number; readonly delta: number; readonly index: number };
  isKeyDown(code: string): boolean;
  random(): number;
  print(message: string, spanId: number): void;
}

interface Mounted {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly debug: MtekDebug;
}

async function mountProgram(program: TestProgram, manifest?: MtekManifest, options: MtekMountOptions = {}): Promise<Mounted> {
  const host = new FakeHost();
  installProgram(host, (json) => {
    if (manifest !== undefined) Object.assign(json, JSON.parse(JSON.stringify(manifest)));
  });
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), program, {
    test: { manualClock: true, renderTarget: TARGET },
    seed: 1,
    ...options,
  });
  if (app.debug === undefined) throw new Error("no debug API");
  return { host, app, debug: app.debug };
}

/** The adversarial-name program with every function logging its call into `log`. */
function loggingProgram(log: Log, extra: Partial<MtekProgramScene> = {}): { program: TestProgram; manifest: MtekManifest } {
  const manifest = adversarialManifest();
  const base = fakeProgram(minimalSceneInit, manifest);
  const entry = (base.scenes as Record<string, MtekProgramScene>)[manifest.entryScene];
  if (entry === undefined) throw new Error("no entry scene");
  const entityFns = (label: string): ((ctx: Ctx, self: unknown, dt: number) => void)[] =>
    NAMES.map((name, index) => (ctx, self, dt) => {
      const record = ctx.e[index];
      expect(self).toBe(record);
      log.push(`${label}:${name}:${String(dt)}`);
    });
  const scene = {
    ...entry,
    update: (_ctx: Ctx, dt: number) => log.push(`update:scene:${String(dt)}`),
    fixedUpdate: (_ctx: Ctx, dt: number) => log.push(`fixed:scene:${String(dt)}`),
    entityUpdate: entityFns("update"),
    entityFixedUpdate: entityFns("fixed"),
    events: {},
    ...extra,
  } as unknown as MtekProgramScene;
  return { program: { ...base, scenes: { [manifest.entryScene]: scene } }, manifest };
}

describe("the frame order", () => {
  it("runs input handlers, then fixed ticks, then updates; the scene first, entities by index", async () => {
    const log: Log = [];
    const handler = (label: string, owner: number) => ({
      key: "Space",
      owner,
      fn: (_ctx: unknown, self: unknown) => log.push(`key_down:${label}:${self === null ? "null" : "entity"}`),
    });
    const { program, manifest } = loggingProgram(log, {
      events: {
        // Deliberately out of order: the runtime orders by owner (scene, then entities by index),
        // keeping declaration order within one owner.
        key_down: [handler("e2", 2), handler("e0", 0), handler("scene-a", -1), handler("e1", 1), handler("scene-b", -1)],
      },
    });
    const { debug } = await mountProgram(program, manifest);
    debug.pressKey("Space");
    debug.step(1, 0.02); // one fixed step of 1/60 s fits in 0.02 s
    expect(log).toEqual([
      "key_down:scene-a:null",
      "key_down:scene-b:null",
      "key_down:e0:entity",
      "key_down:e1:entity",
      "key_down:e2:entity",
      `fixed:scene:${String(FIXED_STEP)}`,
      `fixed:__proto__:${String(FIXED_STEP)}`,
      `fixed:constructor:${String(FIXED_STEP)}`,
      `fixed:toString:${String(FIXED_STEP)}`,
      `update:scene:${String(fr(0.02))}`,
      `update:__proto__:${String(fr(0.02))}`,
      `update:constructor:${String(fr(0.02))}`,
      `update:toString:${String(fr(0.02))}`,
    ]);
  });

  it("passes dt as binary32 and the fixed step as 1/60", async () => {
    const seen: number[] = [];
    const { program, manifest } = loggingProgram([], {
      update: (_ctx: unknown, dt: number) => seen.push(dt),
      fixedUpdate: (_ctx: unknown, dt: number) => seen.push(dt),
    });
    const { debug } = await mountProgram(program, manifest);
    debug.step(1, 0.0333333333);
    expect(seen).toEqual([FIXED_STEP, fr(0.0333333333)]);
    expect(seen.every((v) => fr(v) === v)).toBe(true);
  });

  it("runs at most maxCatchUpSteps fixed ticks per frame and counts the rest as discarded", async () => {
    let ticks = 0;
    const { program, manifest } = loggingProgram([], {
      fixedUpdate: () => {
        ticks += 1;
      },
    });
    const { debug } = await mountProgram(program, manifest);
    const config = manifest.runtimeConfig;
    debug.step(1, config.maxFrameDelta); // 0.1 s = 6 steps; the default allows 4
    expect(ticks).toBe(config.maxCatchUpSteps);
    expect(debug.counters()["discardedSteps"]).toBe(Math.floor(config.maxFrameDelta / config.fixedStep) - config.maxCatchUpSteps);
  });

  it("frame values reach generated code as f32 and advance by the clamped delta", async () => {
    const frames: { time: number; delta: number; index: number }[] = [];
    const { program, manifest } = loggingProgram([], {
      update: (ctx: Ctx) => frames.push({ ...ctx.frame }),
    } as unknown as Partial<MtekProgramScene>);
    const { debug } = await mountProgram(program, manifest);
    debug.step(1, 1000); // clamped to maxFrameDelta
    debug.step(1, 0.05);
    expect(frames[0]).toEqual({ time: fr(manifest.runtimeConfig.maxFrameDelta), delta: fr(manifest.runtimeConfig.maxFrameDelta), index: 0 });
    expect(frames[1]).toEqual({ time: fr(manifest.runtimeConfig.maxFrameDelta + 0.05), delta: fr(0.05), index: 1 });
  });
});

describe("state objects with adversarial names", () => {
  it("are plain entries: no prototype member shadows or is shadowed by a state", async () => {
    let seen: Ctx | undefined;
    const { program, manifest } = loggingProgram([], {
      update: (ctx: Ctx) => {
        seen = ctx;
      },
    } as unknown as Partial<MtekProgramScene>);
    const { debug } = await mountProgram(program, manifest);
    debug.step(1, 0.016);
    if (seen === undefined) throw new Error("update did not run");
    expect(Object.entries(seen.s)).toEqual([
      ["__proto__", 0],
      ["toString", 0],
    ]);
    expect(Reflect.getPrototypeOf(seen.s)).toBeNull();
    for (const record of seen.e) {
      expect(Object.keys(record.state)).toEqual(["constructor"]);
      expect(record.state["constructor"]).toBe(0);
    }
    seen.s["__proto__"] = 5;
    expect(Reflect.getPrototypeOf(seen.s)).toBeNull();
    expect(Object.entries(debug.scene().state)).toEqual([
      ["__proto__", 5],
      ["toString", 0],
    ]);
  });
});

describe("CPU intrinsics", () => {
  it("random() is deterministic under a seed and differs between seeds", async () => {
    const draw = async (seed: number): Promise<number[]> => {
      const values: number[] = [];
      const { program, manifest } = loggingProgram([], {
        update: (ctx: Ctx) => values.push(ctx.random(), ctx.random()),
      } as unknown as Partial<MtekProgramScene>);
      const { debug, app } = await mountProgram(program, manifest, { seed });
      debug.step(3, 0.016);
      app.dispose();
      return values;
    };
    const a = await draw(99);
    expect(a).toHaveLength(6);
    expect(await draw(99)).toEqual(a);
    expect(await draw(100)).not.toEqual(a);
    expect(a.every((v) => v >= 0 && v < 1 && fr(v) === v)).toBe(true);
  });

  it("is_key_down reports the delivered state as of the end of phase 1, and print reaches the console hook", async () => {
    const polled: boolean[] = [];
    const { program, manifest } = loggingProgram([], {
      update: (ctx: Ctx) => {
        polled.push(ctx.isKeyDown("KeyW"));
        ctx.print("w is down", 0);
      },
    } as unknown as Partial<MtekProgramScene>);
    const { debug, host } = await mountProgram(program, manifest);
    debug.step(1, 0.016);
    debug.pressKey("KeyW");
    debug.step(1, 0.016);
    debug.releaseKey("KeyW");
    debug.step(1, 0.016);
    expect(polled).toEqual([false, true, false]);
    expect(host.logged).toEqual(["w is down", "w is down", "w is down"]);
  });

  it("a key pressed and released between two frames is delivered as both transitions", async () => {
    const log: Log = [];
    const key = (name: string) => ({ key: "Space", owner: -1, fn: () => log.push(name) });
    const { program, manifest } = loggingProgram([], {
      events: { key_down: [key("down")], key_up: [key("up")] },
    });
    const { debug } = await mountProgram(program, manifest);
    debug.pressKey("Space");
    debug.releaseKey("Space");
    debug.step(1, 0.016);
    expect(log).toEqual(["down", "up"]);
  });
});

describe("input from the DOM", () => {
  async function mountWithEvents(log: Log): Promise<Mounted> {
    const down = (name: string) => ({ key: "Space", owner: -1, fn: () => log.push(name) });
    const { program, manifest } = loggingProgram([], {
      events: {
        key_down: [down("down")],
        key_up: [down("up")],
        pointer_down: [{ owner: -1, fn: (_c: unknown, _s: unknown, event: unknown) => log.push(`pointer_down:${JSON.stringify(event)}`) }],
        pointer_move: [{ owner: 1, fn: (_c: unknown, self: unknown, event: unknown) => log.push(`pointer_move:${self === null ? "null" : "entity"}:${JSON.stringify(event)}`) }],
      },
    });
    return mountProgram(program, manifest);
  }

  it("keyboard events reach handlers; auto-repeat does not; handled keys are not left to the browser", async () => {
    const log: Log = [];
    const { host, debug } = await mountWithEvents(log);
    expect(host.document.dispatch("keydown", { code: "Space", repeat: false }).defaultPrevented).toBe(true);
    host.document.dispatch("keydown", { code: "Space", repeat: true });
    host.document.dispatch("keyup", { code: "Space" });
    expect(host.document.dispatch("keydown", { code: "KeyZ", repeat: false }).defaultPrevented).toBe(false);
    debug.step(1, 0.016);
    expect(log).toEqual(["down", "up"]);
  });

  it("pointer events arrive as PointerEvent values in NDC, moves coalesced", async () => {
    const log: Log = [];
    const { host, debug } = await mountWithEvents(log);
    const pointer = { isPrimary: true, pointerId: 1, button: 0 };
    host.canvas.dispatch("pointerdown", { ...pointer, clientX: 150, clientY: 25 });
    host.canvas.dispatch("pointermove", { ...pointer, clientX: 0, clientY: 0 });
    host.canvas.dispatch("pointermove", { ...pointer, clientX: 200, clientY: 100 });
    debug.step(1, 0.016);
    expect(log).toEqual([
      'pointer_down:{"position":{"x":0.5,"y":0.5},"button":0}',
      'pointer_move:entity:{"position":{"x":1,"y":-1},"button":0}',
    ]);
  });

  it("window blur releases held keys on the next frame", async () => {
    const log: Log = [];
    const { host, debug } = await mountWithEvents(log);
    host.document.dispatch("keydown", { code: "Space", repeat: false });
    debug.step(1, 0.016);
    host.window.dispatch("blur");
    debug.step(1, 0.016);
    expect(log).toEqual(["down", "up"]);
  });

  it("hiding the document releases held keys even when the app does not pause", async () => {
    const log: Log = [];
    const down = { key: "Space", owner: -1, fn: () => log.push("down") };
    const up = { key: "Space", owner: -1, fn: () => log.push("up") };
    const { program, manifest } = loggingProgram([], { events: { key_down: [down], key_up: [up] } });
    const { host, app, debug } = await mountProgram(program, manifest, { pauseWhenHidden: false });
    host.document.dispatch("keydown", { code: "Space", repeat: false });
    debug.step(1, 0.016);
    host.document.setVisibility("hidden");
    expect(app.state).toBe("running");
    debug.step(1, 0.016);
    expect(log).toEqual(["down", "up"]);
  });
});

describe("pause and resume", () => {
  it("discards input that happens while paused and releases what was held, never simulating the gap", async () => {
    const log: Log = [];
    const key = (name: string) => ({ key: "Space", owner: -1, fn: () => log.push(name) });
    const frames: number[] = [];
    const { program, manifest } = loggingProgram([], {
      events: { key_down: [key("down")], key_up: [key("up")] },
      update: (ctx: Ctx) => frames.push(ctx.frame.delta),
    } as unknown as Partial<MtekProgramScene>);
    const { app, debug } = await mountProgram(program, manifest);
    debug.pressKey("Space");
    debug.step(1, 0.016);
    expect(log).toEqual(["down"]);

    app.pause();
    debug.pressKey("KeyA");
    debug.releaseKey("Space"); // discarded: the pause owns the key state
    debug.step(5, 0.016); // nothing runs while paused
    expect(frames).toHaveLength(1);

    app.resume();
    debug.step(1, 0.016);
    // The held Space is released on resume exactly as on focus loss; the discarded KeyA never happened.
    expect(log).toEqual(["down", "up"]);
    expect(frames).toHaveLength(2);
  });
});

describe("the compiler's state_and_handlers program, end to end", () => {
  async function mountGolden(options: MtekMountOptions = {}): Promise<Mounted> {
    const golden = await loadGoldenProgram("state_and_handlers");
    const host = new FakeHost();
    for (const [url, text] of golden.files) host.files.set(url, text);
    const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), golden.program, {
      test: { manualClock: true, renderTarget: TARGET },
      seed: 1,
      ...options,
    });
    if (app.debug === undefined) throw new Error("no debug API");
    return { host, app, debug: app.debug };
  }

  it("starts with the declared state and runs update every frame", async () => {
    const { debug } = await mountGolden();
    expect(debug.scene().state).toEqual({ speed: 0.5, angle: 0, ticks: 0 });
    debug.step(3, 0.005);
    // update: angle += speed * dt (f32), ticks = bump(ticks); 0.015 s is less than one fixed step.
    let angle = 0;
    for (let i = 0; i < 3; i += 1) angle = fr(angle + fr(0.5 * fr(0.005)));
    expect(debug.scene().state).toEqual({ speed: 0.5, angle, ticks: 3 });
  });

  it("the Space handler negates speed in phase 1, before the same frame's update reads it", async () => {
    const { host, debug } = await mountGolden();
    host.document.dispatch("keydown", { code: "Space", repeat: false });
    debug.step(1, 0.016);
    expect(debug.scene().state).toEqual({ speed: -0.5, angle: fr(fr(-0.5) * fr(0.016)), ticks: 1 });
  });

  it("fixed_update runs after phase 1 and before update", async () => {
    const { debug } = await mountGolden();
    debug.pressKey("Space");
    debug.step(1, 0.02);
    const speed = fr(-0.5 - FIXED_STEP);
    expect(debug.scene().state).toEqual({ speed, angle: fr(fr(speed * fr(0.02))), ticks: 1 });
  });

  it("a pointer press sets the angle from the event's NDC x, then update adds to it", async () => {
    const { host, debug } = await mountGolden();
    host.canvas.dispatch("pointerdown", { isPrimary: true, pointerId: 1, button: 0, clientX: 150, clientY: 50 });
    debug.step(1, 0.016);
    expect(debug.scene().state["angle"]).toBe(fr(0.5 + fr(0.5 * fr(0.016))));
  });

  it("update's writes reach the world: the entity moves to y = 0.5 through the setter", async () => {
    const { debug } = await mountGolden();
    debug.step(1, 0.016);
    const cube = debug.scene().entities[0];
    expect(cube?.position).toMatchObject({ y: 0.5 });
  });
});

describe("transform writes from update reach the GPU object blocks (spec/scenes.md section 12)", () => {
  /** E0 > E1 > E2 and an unrelated root E3: the hierarchy of `nestedManifest` in the world tests. */
  function hierarchy(): MtekManifest {
    const json = minimalManifestJson() as Json;
    const scene = json["scene"] as { entities: Json[]; materialInstances: Json[] };
    const template = scene.entities[0] ?? {};
    const instance = (scene.materialInstances[0] ?? {});
    const parents = [null, 0, 1, null];
    scene.entities = parents.map((parent, index) => ({
      ...template,
      index,
      name: `E${String(index)}`,
      symbol: `src/main.mtek::Demo.E${String(index)}`,
      parent,
      material: { id: "std/materials.mtek::Unlit", instance: index },
      update: false,
      fixedUpdate: false,
    }));
    scene.materialInstances = parents.map((_, index) => ({ ...instance, index, entity: index }));
    const checked = checkManifest(json);
    if (!checked.ok) throw new Error(JSON.stringify(checked.failures));
    return checked.manifest;
  }

  interface MoveCtx {
    readonly e: readonly object[];
    setTransform(entity: object | undefined, field: string, value: unknown): void;
  }

  async function mountMoving(moves: (frame: number, ctx: MoveCtx) => void): Promise<Mounted> {
    const manifest = hierarchy();
    const base = fakeProgram(minimalSceneInit, manifest);
    const entry = (base.scenes as Record<string, MtekProgramScene>)[manifest.entryScene];
    if (entry === undefined) throw new Error("no entry scene");
    let frame = 0;
    const scene = {
      ...entry,
      update: (ctx: MoveCtx) => {
        moves(frame, ctx);
        frame += 1;
      },
    } as unknown as MtekProgramScene;
    return mountProgram({ ...base, scenes: { [manifest.entryScene]: scene } }, manifest);
  }

  const uploads = (debug: MtekDebug): number => debug.counters()["uploads"] ?? Number.NaN;

  it("a static scene uploads once; moving a child uploads that child and its descendants only; a repeated value uploads nothing", async () => {
    const { debug, app } = await mountMoving((frame, ctx) => {
      // Frame 1 moves E1 (and so E2); frame 2 writes the same value again; frame 3 moves E3.
      if (frame === 1) ctx.setTransform(ctx.e[1], "position", { x: 0, y: 2, z: 0 });
      if (frame === 2) ctx.setTransform(ctx.e[1], "position", { x: 0, y: 2, z: 0 });
      if (frame === 3) ctx.setTransform(ctx.e[3], "position", { x: 1, y: 0, z: 0 });
    });
    debug.step(1, 0.016); // frame 0: everything uploads once
    const afterFirst = uploads(debug);
    debug.step(1, 0.016); // E1 and E2
    expect(uploads(debug) - afterFirst).toBe(2);
    const afterMove = uploads(debug);
    debug.step(1, 0.016); // same value: the world matrix is recomputed but byte-identical
    expect(uploads(debug) - afterMove).toBe(0);
    const afterRepeat = uploads(debug);
    debug.step(1, 0.016); // E3 alone
    expect(uploads(debug) - afterRepeat).toBe(1);
    debug.step(5, 0.016);
    expect(uploads(debug) - afterRepeat).toBe(1);
    app.dispose();
  });

  it("a rejected scale (E8090) writes nothing and uploads nothing", async () => {
    const { debug, app } = await mountMoving((frame, ctx) => {
      if (frame === 1) ctx.setTransform(ctx.e[0], "scale", { x: 0, y: 1, z: 1 });
    });
    debug.step(1, 0.016);
    const before = uploads(debug);
    debug.step(1, 0.016);
    expect(uploads(debug) - before).toBe(0);
    app.dispose();
  });
});

describe("the compiler's bindings program, end to end (decision 0051)", () => {
  async function mountBindings(): Promise<Mounted> {
    const golden = await loadGoldenProgram("bindings");
    const host = new FakeHost();
    for (const [url, text] of golden.files) host.files.set(url, text);
    const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), golden.program, {
      test: { manualClock: true, renderTarget: TARGET },
      seed: 1,
    });
    if (app.debug === undefined) throw new Error("no debug API");
    return { host, app, debug: app.debug };
  }

  it("evaluates every binding once after init, before the first frame", async () => {
    const { debug } = await mountBindings();
    const [mover, still] = debug.scene().entities;
    // frame.time is 0 at init: the mover starts at x = 0; the still entity has its bound y.
    expect(mover?.position).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(still?.position).toMatchObject({ x: 0, y: 2, z: 0 });
  });

  it("re-evaluates every frame: the mover follows frame.time * speed", async () => {
    const { debug } = await mountBindings();
    debug.step(1, 0.05);
    expect(debug.scene().entities[0]?.position).toMatchObject({ x: fr(fr(0.05) * 2) });
    debug.step(1, 0.05);
    expect(debug.scene().entities[0]?.position).toMatchObject({ x: fr(fr(0.1) * 2) });
  });

  it("bound values that did not change cause no uploads, while the moving one uploads each frame", async () => {
    const { debug } = await mountBindings();
    debug.step(2, 0.016);
    const before = debug.counters()["uploads"] ?? Number.NaN;
    debug.step(1, 0.016);
    const moving = (debug.counters()["uploads"] ?? Number.NaN) - before;
    // Exactly one object block (the mover) and the camera's frame block (it targets the mover).
    expect(moving).toBe(2);
    // Nothing the still entity's bindings write changed: its color param uploaded once, at init.
    expect(debug.counters()["ownedParamBlocks"]).toBe(2);
  });
});
