import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { test, expect } from "../../support/fixtures.ts";
import type { runSkinningProbe } from "../../support/skinning-probe.ts";

for (const [actors, withNormals] of [...[1, 10, 50].flatMap(actors => [[actors, true], [actors, false]] as const), [4, "mixed"]] as const)
  for (const vertices of [63, 1025]) {
    test(`GPU skinning agrees with CPU: ${String(actors)} actors, ${String(vertices)} vertices, ${withNormals === "mixed" ? "mixed pipelines" : withNormals ? "with normals" : "positions only"}`, async ({
      page,
      gpu,
    }) => {
      expect(gpu.available).toBe(true);
      const bundle = await build({
        entryPoints: [
          fileURLToPath(
            new URL("../../support/skinning-probe.ts", import.meta.url),
          ),
        ],
        bundle: true,
        write: false,
        format: "iife",
        globalName: "skinProbe",
        target: "es2022",
      });
      await page.goto("/env.html");
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      const result = await page.evaluate(
        async ({ actors, vertices, withNormals }) =>
          (
            window as unknown as {
              skinProbe: { runSkinningProbe: typeof runSkinningProbe };
            }
          ).skinProbe.runSkinningProbe(actors, vertices, withNormals),
        { actors, vertices, withNormals },
      );
      expect(result.validation).toBeNull();
      expect(result.error).toBeLessThan(0.00003);
      expect(result.uploaded).toBe(result.expectedUpload);
      expect(result.live).toBe(0);
      expect(result.outputBytes).toBe(actors * vertices * 12 * (withNormals === "mixed" ? 1.5 : withNormals ? 2 : 1));
    });
  }
