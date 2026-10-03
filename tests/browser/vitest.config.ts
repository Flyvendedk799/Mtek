import { defineConfig } from "vitest/config";

// Unit tests of the harness itself. The Playwright specs under `specs/` are not Vitest tests.
export default defineConfig({
  test: {
    include: ["support/**/*.test.ts"],
  },
});
