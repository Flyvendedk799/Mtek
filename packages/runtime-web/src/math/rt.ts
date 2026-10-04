/**
 * The runtime math library `rt`: every helper generated code calls (`spec/runtime-abi.md` 4.1).
 *
 * Generated `app.js` imports the runtime bundle as `import * as rt from "./runtime.<h16>.js"`, so
 * these names are re-exported at the top level of the runtime's entry module (`../index.ts`).
 * Which helper implements which Mtek operation is the table `RT_OPERATIONS` in
 * `./operations.ts`; the naming scheme and the numeric definitions are decision 0037.
 */
export * from "./scalar.js";
export * from "./integer.js";
export * from "./vector.js";
export * from "./quat.js";
export * from "./color.js";
export * from "./matrix.js";
