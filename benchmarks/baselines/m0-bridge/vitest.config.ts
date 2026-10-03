import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tools/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
