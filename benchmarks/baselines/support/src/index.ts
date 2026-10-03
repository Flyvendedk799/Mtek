// Baseline support module for the benchmark tasks (decision 0021, section 6): the test hooks of
// `startTask` and the helpers that correspond to Mtek's standard library.
export {
  boxMesh,
  lookAtCamera,
  orthographicCamera,
  sphereMesh,
  srgb,
  unlit,
  type OrthographicOptions,
  type PerspectiveOptions,
  type Vec3,
} from "./helpers.ts";
export type { InputResult, Pixels, TaskHooks } from "./hooks.ts";
export { startTask, TARGET_SIZE, type TaskApp, type TaskHost } from "./task.ts";
