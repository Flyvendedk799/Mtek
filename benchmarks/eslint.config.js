import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      // Its own workspace package with its own configuration (M0-09).
      "baselines/m0-bridge/**",
      // Starter that contains compile errors on purpose (the task is to repair them).
      "tasks/maintenance-01/baseline/**",
      "**/dist/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    // Node scripts are plain ES modules that rely on the Node globals.
    files: ["**/*.mjs"],
    languageOptions: { globals: { Buffer: "readonly", process: "readonly" } },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
