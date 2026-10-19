// Where things are. `RUNTIME_ROOT` is `benchmarks/runtime`; the generated site (programs, assets, page bundles) lives
// under `.out/site/` (git-ignored); published results under `benchmarks/results/runtime/`.
import { join, resolve } from "node:path";

export const RUNTIME_ROOT = resolve(import.meta.dirname, "..");
export const REPO_ROOT = resolve(RUNTIME_ROOT, "..", "..");
export const OUT_DIR = join(RUNTIME_ROOT, ".out");
export const SITE_DIR = join(OUT_DIR, "site");
export const WORK_DIR = join(OUT_DIR, "work");
export const RESULTS_DIR = join(REPO_ROOT, "benchmarks", "results", "runtime");
export const RAW_DIR = join(RESULTS_DIR, "raw");

export const WORKLOADS = [
  "constant-scene",
  "changing-transforms",
  "changing-material-params",
  "repeated-meshes",
  "asset-heavy-startup",
  "physics-bodies",
  "mount-reload-dispose",
] as const;
export type WorkloadName = (typeof WORKLOADS)[number];

export const IMPLEMENTATIONS = ["mtek", "direct", "three"] as const;
export type ImplementationName = (typeof IMPLEMENTATIONS)[number];

export function isWorkload(name: string): name is WorkloadName {
  return (WORKLOADS as readonly string[]).includes(name);
}

export function isImplementation(name: string): name is ImplementationName {
  return (IMPLEMENTATIONS as readonly string[]).includes(name);
}
