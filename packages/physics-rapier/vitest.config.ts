import { defineConfig } from "vitest/config";

// Rapier's `-compat` build embeds its WebAssembly, so the adapter runs under plain Node.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
