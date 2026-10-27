import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

/** Compiled GLB/material acceptance plus the existing derivative-frame controls. */
export default defineConfig({ ...base, testMatch: ["m4/pbr-tangents.spec.ts", "m4/pbr-maps.spec.ts", "m4/tangent-shadows.spec.ts"], globalSetup: "./support/tangent-setup.ts",
  projects: (base.projects ?? []).filter(p => p.name === "hardware" || p.name === "software"), workers: 1, fullyParallel: false, retries: 0 });
