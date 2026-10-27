import {defineConfig} from "@playwright/test";
import base from "./playwright.config.ts";
export default defineConfig({...base,testMatch:"inspection/*.spec.ts",globalSetup:"./support/inspection-setup.ts",workers:1,fullyParallel:false,retries:0,
  projects:(base.projects ?? []).filter(p => p.name === "hardware" || p.name === "software")});
