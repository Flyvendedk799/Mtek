/**
 * M3-07: candidate-based hot reload on real WebGPU (`spec/runtime-abi.md` section 11).
 *
 * Requires a WebGPU adapter (`gpu` fixture). On hardware CI run with `MTEK_REQUIRE_GPU=1`
 * (`npm run test:browser:hardware`). Without a GPU these specs are NOT-RUN, not green.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";

interface DiagnosticLike {
  code: string;
  severity: string;
  message: string;
  notes: string[];
}

interface AppLike {
  state: string;
  replaceProgram?(candidate: unknown): Promise<{ ok: true } | { ok: false; diagnostics: DiagnosticLike[] }>;
  debug: {
    step(frames: number, dtSeconds: number): void;
    counters(): Record<string, number>;
    scene(): { state: Record<string, unknown>; entities: Array<{ name: string; position: unknown }> };
  };
  dispose(): void;
}

interface MountWindow {
  __mtek: {
    mountMtek(canvas: HTMLCanvasElement, program: unknown, options: unknown): Promise<AppLike>;
    drawingProgram: {
      abi: 1;
      baseUrl: URL;
      manifestUrl: URL;
      writers: unknown;
      functions: unknown;
      scenes: Record<string, { init: (ctx: unknown) => void } & Record<string, unknown>>;
      prefabs: unknown;
    };
  };
  __app?: AppLike;
  __reported?: DiagnosticLike[];
}

const MANIFEST_URL = "**/mount/fixture/program.manifest.json";

test.describe("hot reload (replaceProgram)", () => {
  test.beforeEach(async ({ page, gpu }) => {
    void gpu;
    await page.goto("/mount.html");
  });

  async function mount(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const w = window as unknown as MountWindow;
      const canvas = document.createElement("canvas");
      canvas.setAttribute("style", "width:64px;height:64px");
      document.body.append(canvas);
      const reported: DiagnosticLike[] = [];
      w.__reported = reported;
      w.__app = await w.__mtek.mountMtek(canvas, w.__mtek.drawingProgram, {
        test: { manualClock: true, renderTarget: { width: 32, height: 32 } },
        onDiagnostic: (d: DiagnosticLike) => reported.push(d),
      });
      w.__app.debug.step(1, 0.016);
    });
  }

  test("colour edit: value changes and pipelinesCreated is unchanged", async ({ page }) => {
    await mount(page);
    const before = await page.evaluate(() => (window as unknown as MountWindow).__app!.debug.counters()["pipelinesCreated"]);

    const result = await page.evaluate(async () => {
      const w = window as unknown as MountWindow;
      const app = w.__app!;
      const base = w.__mtek.drawingProgram;
      const scene = Object.values(base.scenes)[0]!;
      const newColor = { r: 1, g: 0.1, b: 0.1, a: 1 };
      const candidate = {
        ...base,
        scenes: {
          ...base.scenes,
          [Object.keys(base.scenes)[0]!]: {
            ...scene,
            init: (ctx: { e: object[]; setParam: (e: object, n: string, v: unknown) => void }) => {
              scene.init(ctx);
              for (const entity of ctx.e) ctx.setParam(entity, "color", newColor);
            },
          },
        },
      };
      const outcome = await app.replaceProgram!(candidate);
      app.debug.step(1, 0.016);
      return {
        outcome,
        pipelinesCreated: app.debug.counters()["pipelinesCreated"],
        entityCount: app.debug.scene().entities.length,
      };
    });

    expect(result.outcome).toEqual({ ok: true });
    expect(result.pipelinesCreated).toBe(before);
    expect(result.entityCount).toBeGreaterThan(0);
  });

  test("failed candidate (broken shader) keeps the running scene", async ({ page }) => {
    await mount(page);
    const before = await page.evaluate(() => {
      const app = (window as unknown as MountWindow).__app!;
      return {
        pipelines: app.debug.counters()["pipelinesCreated"],
        names: app.debug.scene().entities.map((e) => e.name),
        state: app.state,
      };
    });

    // Route a new shader URL to broken WGSL; patch the candidate manifest to point at it.
    const brokenHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    await page.route("**/mount/fixture/shaders/bbbbbbbbbbbbbbbb.wgsl", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "// generated\n    let x = 1; @@error unexpected token\n",
      });
    });
    await page.route("**/mount/fixture/shaders/bbbbbbbbbbbbbbbb.mtek-map.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ shader: brokenHash, entries: [] }),
      });
    });
    await page.route(MANIFEST_URL, async (route) => {
      const response = await route.fetch();
      const manifest = (await response.json()) as Record<string, unknown>;
      const shaders = manifest["shaders"] as Array<Record<string, unknown>>;
      const materials = manifest["materials"] as Array<Record<string, unknown>>;
      if (shaders[0] !== undefined) {
        shaders[0] = {
          ...shaders[0],
          hash: brokenHash,
          url: "shaders/bbbbbbbbbbbbbbbb.wgsl",
          map: "shaders/bbbbbbbbbbbbbbbb.mtek-map.json",
        };
      }
      if (materials[0] !== undefined) materials[0] = { ...materials[0], shader: brokenHash };
      await route.fulfill({ response, json: manifest });
    });

    const result = await page.evaluate(async () => {
      const w = window as unknown as MountWindow;
      const app = w.__app!;
      const outcome = await app.replaceProgram!(w.__mtek.drawingProgram);
      app.debug.step(1, 0.016);
      return {
        outcome,
        pipelines: app.debug.counters()["pipelinesCreated"],
        names: app.debug.scene().entities.map((e) => e.name),
        state: app.state,
        reported: (w.__reported ?? []).map((d) => d.code),
      };
    });

    expect(result.outcome.ok).toBe(false);
    if (result.outcome.ok) throw new Error("expected failure");
    expect(result.outcome.diagnostics.some((d) => d.code === "MTEK-E8051")).toBe(true);
    expect(result.state).toBe("running");
    expect(result.pipelines).toBe(before.pipelines);
    expect(result.names).toEqual(before.names);
    expect(result.reported).toContain("MTEK-E8051");
  });

  test("adding an entity restarts with W8070", async ({ page }) => {
    await mount(page);

    await page.route(MANIFEST_URL, async (route) => {
      const response = await route.fetch();
      const manifest = (await response.json()) as Record<string, unknown>;
      const scene = manifest["scene"] as Record<string, unknown>;
      const entities = scene["entities"] as Array<Record<string, unknown>>;
      const instances = scene["materialInstances"] as Array<Record<string, unknown>>;
      const first = entities[0];
      if (first === undefined) throw new Error("no entity");
      entities.push({
        ...first,
        index: entities.length,
        name: "Extra",
        symbol: "src/main.mtek::Demo.Extra",
        parent: null,
        material: { id: first["material"] && (first["material"] as { id: string }).id, instance: instances.length },
      });
      const firstInstance = instances[0];
      if (firstInstance !== undefined) {
        instances.push({ ...firstInstance, index: instances.length, entity: entities.length - 1 });
      }
      const symbols = manifest["symbols"] as Array<Record<string, unknown>>;
      symbols.push({ id: "src/main.mtek::Demo.Extra", kind: "entity", span: 0 });
      await route.fulfill({ response, json: manifest });
    });

    const result = await page.evaluate(async () => {
      const w = window as unknown as MountWindow;
      const app = w.__app!;
      const base = w.__mtek.drawingProgram;
      const entry = Object.keys(base.scenes)[0]!;
      const scene = base.scenes[entry]!;
      // Manifest now has two entities; checkProgram requires entityUpdate length to match.
      const entitySlots = [null, null];
      const candidate = {
        ...base,
        scenes: {
          ...base.scenes,
          [entry]: {
            ...scene,
            entityUpdate: entitySlots,
            entityFixedUpdate: entitySlots,
          },
        },
      };
      const outcome = await app.replaceProgram!(candidate);
      app.debug.step(1, 0.016);
      return {
        outcome,
        names: app.debug.scene().entities.map((e) => e.name),
        reported: (w.__reported ?? []).map((d) => ({ code: d.code, message: d.message, notes: d.notes })),
      };
    });

    expect(result.outcome).toEqual({ ok: true });
    expect(result.names).toContain("Extra");
    const w8070 = result.reported.find((d) => d.code === "MTEK-W8070");
    expect(w8070).toBeDefined();
    expect(w8070?.notes.some((n) => n.includes("Demo.Extra"))).toBe(true);
  });
});
