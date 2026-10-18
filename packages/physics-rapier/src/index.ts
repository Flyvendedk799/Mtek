/**
 * Entry point of the bundle `physics/<h16>.js` (`spec/physics.md` section 5): the default export is a
 * `LoadPhysics`. The runtime calls it after a dynamic `import()` during mount, only when the manifest
 * says `subsystems.physics`. Loading initialises Rapier's WebAssembly (embedded in the bundle by the
 * `-compat` package) exactly once; later calls reuse the same backend.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import type { LoadPhysics, PhysicsBackend } from "../../runtime-web/src/physics/types.js";
import { rapierBackend } from "./backend.js";

export { BACKEND_NAME } from "./backend.js";

let loading: Promise<PhysicsBackend> | undefined;

const loadPhysics: LoadPhysics = () => {
  loading ??= RAPIER.init().then(
    () => rapierBackend,
    (error: unknown) => {
      // A failed initialisation can be retried by the next mount.
      loading = undefined;
      throw error;
    },
  );
  return loading;
};

export default loadPhysics;
