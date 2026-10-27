import eslint from "@eslint/js";
export default [
  {ignores:[".out/**"]},
  eslint.configs.recommended,
  {languageOptions:{ecmaVersion:"latest",sourceType:"module",globals:{structuredClone:"readonly",Buffer:"readonly",console:"readonly",process:"readonly",URL:"readonly",setTimeout:"readonly",clearTimeout:"readonly",AbortSignal:"readonly",performance:"readonly",navigator:"readonly",document:"readonly",window:"readonly",location:"readonly",requestAnimationFrame:"readonly",GPUAdapter:"readonly",GPUCommandEncoder:"readonly",GPURenderPassEncoder:"readonly",crossOriginIsolated:"readonly",btoa:"readonly",fetch:"readonly",crypto:"readonly"}}},
];
