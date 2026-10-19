import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";

export const PRODUCT_SRC = join(REPO_ROOT, "examples", "product-configurator");
export const PRODUCT_SITE = join(BROWSER_ROOT, ".out", "product-configurator");
export const PRODUCT_RELEASE_SITE = join(BROWSER_ROOT, ".out", "product-configurator-release");
export const PRODUCT_RELEASE_URL = "/product-configurator-release/host/index.html";
export const PRODUCT_HOST_URL = "/product-configurator/host/index.html";

/** Builds the actual example and checks the host against the generated Inputs/Outputs declarations. */
export function buildProductConfigurator(cli: string): void {
  for (const [mode, site] of [["test", PRODUCT_SITE], ["release", PRODUCT_RELEASE_SITE]] as const) {
    rmSync(site, { recursive: true, force: true });
    mkdirSync(site, { recursive: true });
    const out = join(site, "dist");
    const result = runCli(cli, ["build", "--mode", mode, "--out", out, PRODUCT_SRC]);
    if (result.status !== 0 || !existsSync(join(out, "app.js"))) {
      throw new Error(`product configurator build failed (${mode}):\n${result.stdout}${result.stderr}`);
    }
    cpSync(join(PRODUCT_SRC, "host"), join(site, "host"), { recursive: true });
    execFileSync(process.execPath, [join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", join(site, "host")], {
      cwd: REPO_ROOT, stdio: "inherit",
    });
  }
}
