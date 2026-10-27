import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

/** Explicitly selected acceptance suite; importing/listing does not launch a browser. */
export default defineConfig({ ...base, testMatch: "compute/*.spec.ts", globalSetup: "./support/compute-setup.ts",
  projects: (base.projects ?? []).filter((project) => project.name === "hardware" || project.name === "software"), workers: 1, fullyParallel: false, retries: 0 });
