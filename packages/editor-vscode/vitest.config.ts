import { defineConfig } from "vitest/config";

export default defineConfig({
  // `vsce ls` (src/package.test.ts) takes about 10 s on a loaded machine; the default 5 s timed out in the M6 gate.
  test: { include: ["src/**/*.test.ts"], testTimeout: 60_000 },
});
