// What grows in the page between two points of the mount/reload/dispose cycles (decision 0099): heap snapshots, taken after a
// forced collection at two cycles, compared by node type and name. An exploratory tool, not part of a run: it needs the site
// prepared (`prepare.ts`) and, on a shared machine, the GPU lock (`MTEK_GPU_LOCK_DIR`).
//
//   node tools/heap-diff.ts <mtek|direct|three> [first-cycle=100] [second-cycle=400] [--out=<file>]
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { hardwareLaunchArgs } from "../../../tests/browser/support/launch-args.ts";
import { startStaticServer } from "../../../tests/browser/support/serve.ts";
import { withGpuLock } from "./gpu-lock.ts";
import { SITE_DIR } from "./paths.ts";

interface Snapshot {
  readonly snapshot: { readonly meta: { readonly node_fields: string[]; readonly node_types: unknown[] } };
  readonly nodes: number[];
  readonly strings: string[];
}

type Counts = Map<string, { count: number; bytes: number }>;

function summarize(text: string): Counts {
  const snap = JSON.parse(text) as Snapshot;
  const fields = snap.snapshot.meta.node_fields;
  const stride = fields.length;
  const typeIdx = fields.indexOf("type");
  const nameIdx = fields.indexOf("name");
  const sizeIdx = fields.indexOf("self_size");
  const types = snap.snapshot.meta.node_types[0] as string[];
  const counts: Counts = new Map();
  for (let i = 0; i < snap.nodes.length; i += stride) {
    const type = types[snap.nodes[i + typeIdx] as number] ?? "?";
    const name = type === "string" || type === "concatenated string" ? "(string)" : (snap.strings[snap.nodes[i + nameIdx] as number] ?? "?").slice(0, 60);
    const key = `${type}:${name}`;
    const entry = counts.get(key) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += snap.nodes[i + sizeIdx] as number;
    counts.set(key, entry);
  }
  return counts;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const impl = args[0] ?? "mtek";
  const numeric = args.filter((a) => /^\d+$/.test(a)).map(Number);
  const first = numeric[0] ?? 100;
  const second = numeric[1] ?? 400;
  const out = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);
  const server = await startStaticServer(SITE_DIR, 0, { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
  const browser = await chromium.launch({ channel: "chromium", headless: true, args: hardwareLaunchArgs() });
  try {
    const lines = await withGpuLock(async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("HeapProfiler.enable");
      const snapshot = async (): Promise<Counts> => {
        let text = "";
        const onChunk = (e: { chunk: string }): void => {
          text += e.chunk;
        };
        cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
        await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
        cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
        return summarize(text);
      };
      let cycle = 0;
      let a: Counts | undefined;
      let b: Counts | undefined;
      await page.exposeFunction("__benchEmit", () => undefined);
      await page.exposeFunction("__benchSample", async () => {
        cycle += 1;
        await cdp.send("HeapProfiler.collectGarbage");
        if (cycle === first) a = await snapshot();
        if (cycle === second) b = await snapshot();
        return {};
      });
      await page.goto(`${server.url}/pages/mount-reload-dispose/${impl}.html`);
      await page.waitForFunction(() => (window as unknown as { __bench?: { ready: boolean } }).__bench?.ready === true);
      await page.evaluate(
        ({ cycles, impl: which }) =>
          (window as unknown as { __bench: { run(spec: unknown, context: unknown): Promise<unknown> } }).__bench.run(
            { pass: "cycles", cycles, framesPerPhase: 5, frameDeltaSeconds: 0.016666668 },
            {
              workload: "mount-reload-dispose",
              implementation: which,
              assetBase: "/assets/mount-reload-dispose/",
              programUrl: "/mtek/mount-reload-dispose/app.js",
              editedProgramUrl: "/mtek/mount-reload-dispose-edited/app.js",
            },
          ),
        { cycles: second + 5, impl },
      );
      await context.close();
      if (a === undefined || b === undefined) throw new Error("the snapshots were not taken");
      const rows: Array<[string, number, number]> = [];
      for (const [key, entry] of b) {
        const before = a.get(key) ?? { count: 0, bytes: 0 };
        const grown = entry.bytes - before.bytes;
        if (grown > 2000) rows.push([key, entry.count - before.count, grown]);
      }
      rows.sort((x, y) => y[2] - x[2]);
      const header = `${impl}: heap growth between cycle ${String(first)} and cycle ${String(second)} (${String(second - first)} cycles), after a forced collection; self size in bytes, change in object count, node type:name (nodes that grew by more than 2000 bytes)`;
      return [header, ...rows.slice(0, 25).map(([key, count, bytes]) => `${String(bytes).padStart(9)} ${String(count).padStart(7)} ${key}`)];
    });
    const text = `${lines.join("\n")}\n`;
    if (out === undefined) process.stdout.write(text);
    else writeFileSync(out, text);
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();
