import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Generated goldens: writers/ (M0-05) and every codegen fixture's expected/ dist tree.
  { ignores: [".out/**", "writers/**", "*/expected/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
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
