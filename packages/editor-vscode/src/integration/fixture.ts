// The project the integration test opens in VS Code. It is written to a temporary directory by
// `scripts/run-vscode-tests.ts` (never committed as `.mtek` files: the main module is broken on
// purpose) and the expectations below are the ones the suite asserts.

export const PROJECT_FILES: Readonly<Record<string, string>> = {
  "mtek.toml": '[project]\nname = "demo"\nlanguage = "0.1"\n',
  "src/lib.mtek": [
    "/// A point light.",
    "export struct Light {",
    "    intensity: f32;",
    "}",
    "",
    "/// Doubles a number.",
    "export fn double(x: f32) -> f32 {",
    "    return x * 2.0;",
    "}",
    "",
  ].join("\n"),
  // Two errors, with multi-byte text before both on the first error's line (UTF-16: the accented
  // letter is one code unit, the emoji two): `1.` (E0022, with a validated quick fix) and
  // `Unknown` (E2003, no fix).
  "src/main.mtek": [
    'import { double } from "./lib.mtek";',
    "/* é\u{1f600} */ const A: f32 = 1.;",
    "const B: f32 = Unknown;",
    "scene Demo {",
    "    camera Main {}",
    "    entity Cube { mesh: Box {}; }",
    "}",
    "",
  ].join("\n"),
};

/** Zero-based positions in `src/main.mtek`, in UTF-16 code units (the protocol's default). */
export const EXPECTED = {
  floatError: { code: "MTEK-E0022", start: [1, 25], end: [1, 27] },
  unknownName: { code: "MTEK-E2003", start: [2, 15], end: [2, 22] },
  /** `double` in the import list: hover and go to definition (into `src/lib.mtek`). */
  importedName: [0, 10],
  /** `Box` in `mesh: Box {}`: a name of the standard library, defined in an `mtek-prelude:` document. */
  registryName: [5, 25],
  libDefinition: { start: [6, 10], end: [6, 16] },
} as const;
