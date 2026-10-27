import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

/** The composable-animation acceptance alone (decision 0224): builds only its example. `npx playwright test -c animation-composition.config.ts`. */
export default defineConfig({ ...base, testMatch: "animation-composition/*.spec.ts", globalSetup: "./support/animation-setup.ts", timeout: 120_000,
  projects: (base.projects ?? []).filter((project) => project.name === "hardware" || project.name === "software"), workers: 1, fullyParallel: false, retries: 0 });
