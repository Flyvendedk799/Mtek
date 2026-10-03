import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs the `layout_fixtures` example into `.out/` once before any test file.
    globalSetup: ["./global-setup.ts"],
    include: ["*.test.ts", "support/**/*.test.ts"],
  },
});
