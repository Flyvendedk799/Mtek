import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

/** Focused arithmetic validation of every deformation variant; no broad example preparation. */
export default defineConfig({ ...base, testMatch: ["animation/gpu-skinning.spec.ts", "animation/tangent-skinning.spec.ts"],
  globalSetup: "./support/deformation-setup.ts", projects: (base.projects ?? []).filter(p => p.name === "hardware" || p.name === "software"),
  workers: 1, fullyParallel: false, retries: 0 });
