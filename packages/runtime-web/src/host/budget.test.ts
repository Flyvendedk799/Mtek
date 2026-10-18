// The loop budget of untrusted previews (spec/ai-and-benchmarks.md section 5, decision 0075): the world's `ctx.budget`
// counter, its reset at the start of every frame and before `init`, and `E8080` when a loop of the program spends the
// last iteration. The programs here are hand-written in the shape the compiler emits for a preview build
// (`const budget = ctx.budget; ... if (--budget.n < 0) { rt.budgetExceeded(<span>); }`), run on the fake host; the
// compiler's own output runs in tests/codegen/exec.test.ts and in the browser specs of tests/browser/specs/preview.
import { describe, expect, it } from "vitest";
import type { MtekManifest } from "../abi/manifest-types.js";
import { checkManifest } from "../abi/validate.js";
import type { MtekProgramScene } from "../abi/program.js";
import { MtekMountError, type MtekDiagnostic } from "../diagnostics/types.js";
import { budgetExceeded, ExecutionBudgetExceeded } from "../scene/budget.js";
import { FakeHost, asDom, fakeProgram, minimalManifestJson, minimalSceneInit } from "../test-support/fake-host.js";
import { installProgram } from "../test-support/mount-fixture.js";
import type { TestProgram } from "../test-support/program.js";
import { resolveSpan } from "./failures.js";
import { mountMtekWith } from "./mount.js";
import type { MtekApp, MtekMountOptions } from "./types.js";

/** The span id the loops of these programs report: an entry of the minimal manifest's span table. */
const LOOP_SPAN = 2;
/** `manifest.runtimeConfig.fixedStep`: a frame of exactly this length is exactly one fixed tick (decision 0066 item 12). */
const FIXED_STEP = 0.016666668;

interface BudgetContext {
  readonly budget: { n: number };
}

/** `for (;;) { check }` as generated code is shaped: the counter read once, a check per iteration. */
function spin(ctx: unknown, iterations: number): void {
  const budget = (ctx as BudgetContext).budget;
  for (let i = 0; i < iterations; i += 1) {
    if (--budget.n < 0) budgetExceeded(LOOP_SPAN);
  }
}

function manifestWith(budget: number | undefined): MtekManifest {
  const json = minimalManifestJson();
  if (budget !== undefined) json["preview"] = { loopBudget: budget };
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  return parsed.manifest;
}

interface Scenes {
  init?: (ctx: object) => void;
  update?: (ctx: unknown, dt: number) => void;
  fixedUpdate?: (ctx: unknown, dt: number) => void;
  events?: MtekProgramScene["events"];
}

/** A scene handler for `key_down(Key.Space)`. */
function onSpace(fn: (ctx: unknown) => void): MtekProgramScene["events"] {
  return { key_down: [{ key: "Space", owner: -1, fn }] };
}

function programOf(manifest: MtekManifest, scene: Scenes): TestProgram {
  const base = fakeProgram(scene.init ?? minimalSceneInit, manifest);
  const entry = (base.scenes as Record<string, MtekProgramScene>)[manifest.entryScene];
  if (entry === undefined) throw new Error("no entry scene");
  const replaced = {
    ...entry,
    update: scene.update ?? null,
    fixedUpdate: scene.fixedUpdate ?? null,
    events: scene.events ?? {},
  } as unknown as MtekProgramScene;
  return { ...base, scenes: { [manifest.entryScene]: replaced } };
}

interface Run {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly seen: MtekDiagnostic[];
}

async function mount(manifest: MtekManifest, scene: Scenes, options: MtekMountOptions = {}): Promise<Run> {
  const host = new FakeHost();
  installProgram(host, (json) => {
    Object.assign(json, JSON.parse(JSON.stringify(manifest)));
  });
  const seen: MtekDiagnostic[] = [];
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), programOf(manifest, scene), {
    test: { manualClock: true, renderTarget: { width: 8, height: 8 } },
    seed: 1,
    onDiagnostic: (d) => seen.push(d),
    ...options,
  });
  return { host, app, seen };
}

function overlayText(host: FakeHost): string | undefined {
  return host.document.body.find("data-mtek-overlay")?.textContent;
}

describe("E8080: a loop past the budget stops the scene", () => {
  it("fails a runaway update at its loop: reported with the span, the scene stopped, the overlay shown", async () => {
    let calls = 0;
    const { host, app, seen } = await mount(manifestWith(1_000), {
      update: (ctx) => {
        calls += 1;
        spin(ctx, Number.MAX_SAFE_INTEGER);
      },
    });
    expect(app.state).toBe("running");
    app.debug?.step(1, 0.02);

    expect(app.state).toBe("failed");
    expect(calls).toBe(1);
    const e8080 = seen.filter((d) => d.code === "MTEK-E8080");
    expect(e8080).toHaveLength(1);
    const [diagnostic] = e8080;
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.title).toBe("execution budget exceeded");
    expect(diagnostic?.phase).toBe("runtime:update");
    expect(diagnostic?.message).toContain("1000 iterations per frame");
    // The loop of the program, from the manifest's span table.
    expect(diagnostic?.source).not.toBeNull();
    expect(diagnostic?.source).toEqual(resolveSpan(manifestWith(1_000), LOOP_SPAN));
    expect(diagnostic?.notes.join("\n")).toContain("--loop-budget");
    // The overlay names the code and the message; the scene does not run again.
    expect(overlayText(host)).toContain("MTEK-E8080");
    expect(overlayText(host)).toContain("execution budget exceeded");
    app.debug?.step(10, 0.02);
    expect(calls).toBe(1);
    app.dispose();
  });

  it("fails the same way on the animation-frame loop, without throwing out of the frame", async () => {
    let calls = 0;
    const { host, app, seen } = await mount(
      manifestWith(500),
      {
        update: (ctx) => {
          calls += 1;
          spin(ctx, 1_000_000_000);
        },
      },
      { test: { renderTarget: { width: 8, height: 8 } } },
    );
    host.tickFrames(1000);
    expect(app.state).toBe("failed");
    expect(calls).toBe(1);
    expect(seen.map((d) => d.code)).toEqual(["MTEK-E8080"]);
    // No frame is requested any more: the loop is over, the page is not blocked.
    expect(host.pendingFrames).toBe(0);
    app.dispose();
  });

  it("counts iterations of every handler, fixed step and update of one frame against one budget", async () => {
    // Each of the three functions uses 40 of 100; the first two fit, the third crosses the line in the same frame.
    const order: string[] = [];
    const { app, seen } = await mount(manifestWith(100), {
      events: onSpace((ctx) => {
        order.push("key");
        spin(ctx, 40);
      }),
      fixedUpdate: (ctx) => {
        order.push("fixed");
        spin(ctx, 40);
      },
      update: (ctx) => {
        order.push("update");
        spin(ctx, 40);
      },
    });
    app.debug?.pressKey("Space");
    app.debug?.step(1, FIXED_STEP);
    expect(order).toEqual(["key", "fixed", "update"]);
    expect(app.state).toBe("failed");
    expect(seen.map((d) => d.code)).toEqual(["MTEK-E8080"]);
    expect(seen[0]?.phase).toBe("runtime:update");
    app.dispose();
  });

  it("names the phase that was running: input handlers and fixed ticks", async () => {
    const input = await mount(manifestWith(10), {
      events: onSpace((ctx) => spin(ctx, 11)),
    });
    input.app.debug?.pressKey("Space");
    input.app.debug?.step(1, 0.001);
    expect(input.seen.map((d) => `${d.code} ${d.phase}`)).toEqual(["MTEK-E8080 runtime:input"]);
    input.app.dispose();

    const tick = await mount(manifestWith(10), { fixedUpdate: (ctx) => spin(ctx, 11) });
    tick.app.debug?.step(1, FIXED_STEP);
    expect(tick.seen.map((d) => `${d.code} ${d.phase}`)).toEqual(["MTEK-E8080 runtime:tick"]);
    tick.app.dispose();
  });

  it("refills the budget at the start of every frame: a program that fits in each frame runs for ever", async () => {
    let calls = 0;
    const { app, seen } = await mount(manifestWith(100), {
      update: (ctx) => {
        calls += 1;
        spin(ctx, 100);
      },
    });
    app.debug?.step(50, 0.02);
    expect(calls).toBe(50);
    expect(app.state).toBe("running");
    expect(seen).toEqual([]);
    // One iteration more than the budget is the end.
    const over = await mount(manifestWith(100), { update: (ctx) => spin(ctx, 101) });
    over.app.debug?.step(1, 0.02);
    expect(over.app.state).toBe("failed");
    app.dispose();
    over.app.dispose();
  });

  it("allows exactly the budget: the last iteration passes", async () => {
    const { app } = await mount(manifestWith(7), { update: (ctx) => spin(ctx, 7) });
    app.debug?.step(1, 0.02);
    expect(app.state).toBe("running");
    app.dispose();
  });

  it("is the manifest's budget, whatever the program asks: a preview of 1 allows one iteration", async () => {
    const { app } = await mount(manifestWith(1), { update: (ctx) => spin(ctx, 2) });
    app.debug?.step(1, 0.02);
    expect(app.state).toBe("failed");
    app.dispose();
  });

  it("without a `preview` object in the manifest the counter is empty: instrumented code cannot run unbounded", async () => {
    const { app, seen } = await mount(manifestWith(undefined), { update: (ctx) => spin(ctx, 1) });
    app.debug?.step(1, 0.02);
    expect(app.state).toBe("failed");
    expect(seen.map((d) => d.code)).toEqual(["MTEK-E8080"]);
    expect(seen[0]?.message).toContain("this preview");
    app.dispose();
  });

  it("does not turn other errors into E8080: they stay frame errors (E8050) or propagate on the manual clock", async () => {
    const { app } = await mount(manifestWith(10), {
      update: () => {
        throw new Error("a runtime defect");
      },
    });
    expect(() => app.debug?.step(1, 0.02)).toThrow("a runtime defect");
    app.dispose();
  });
});

describe("E8080 during init: the mount fails", () => {
  it("rejects with the kind budget-exceeded, the loop's span, and the overlay", async () => {
    const manifest = manifestWith(100);
    const host = new FakeHost();
    installProgram(host, (json) => {
      Object.assign(json, JSON.parse(JSON.stringify(manifest)));
    });
    const program = programOf(manifest, {
      init: (ctx) => {
        minimalSceneInit(ctx);
        spin(ctx, 1_000_000_000);
      },
    });
    let error: unknown;
    try {
      await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), program, {
        test: { manualClock: true, renderTarget: { width: 8, height: 8 } },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MtekMountError);
    const failure = error as MtekMountError;
    expect(failure.kind).toBe("budget-exceeded");
    expect(failure.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8080"]);
    expect(failure.diagnostics[0]?.phase).toBe("runtime:mount");
    expect(failure.diagnostics[0]?.source).toEqual(resolveSpan(manifest, LOOP_SPAN));
    expect(overlayText(host)).toContain("MTEK-E8080");
  });
});

describe("the budget helper", () => {
  it("throws an ExecutionBudgetExceeded that carries the span and is not swallowed by `never` returns", () => {
    let caught: unknown;
    try {
      budgetExceeded(42);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ExecutionBudgetExceeded);
    expect((caught as ExecutionBudgetExceeded).spanId).toBe(42);
    expect((caught as ExecutionBudgetExceeded).name).toBe("ExecutionBudgetExceeded");
  });
});
