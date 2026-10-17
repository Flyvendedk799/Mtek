import { defineConfig } from "vitest/config";

// Unit tests run the development flavour of the runtime (see src/flavour.d.ts); the release flavour is
// built and inspected by src/release-bundle.test.ts.
export default defineConfig({
  define: { __MTEK_DEV__: "true" },
});
