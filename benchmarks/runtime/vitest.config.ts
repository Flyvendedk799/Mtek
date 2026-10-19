import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tools/**/*.test.ts", "harness/**/*.test.ts", "common/**/*.test.ts"],
    exclude: [".out/**", "node_modules/**"],
    testTimeout: 60_000,
  },
});
