import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

/** The character movement acceptance alone (decision 0218): builds only its example. `npx playwright test -c movement.config.ts`. */
export default defineConfig({ ...base, testMatch: "movement/*.spec.ts", globalSetup: "./support/movement-setup.ts",
  projects: (base.projects ?? []).filter((project) => project.name === "hardware" || project.name === "software"), workers: 1, fullyParallel: false, retries: 0 });
