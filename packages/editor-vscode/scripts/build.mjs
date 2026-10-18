// Bundles the extension to dist/extension.cjs (everything but `vscode`, which VS Code provides, is
// inlined, so the .vsix needs no node_modules) and the integration suite to dist/test/suite.cjs.
// `.cjs` because the package is `"type": "module"` and VS Code loads `main` with `require`.
//
// The TextMate grammar is committed; `npm run check:grammar` (and the unit tests) say when it is stale.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "warning",
};

await build({ ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.cjs" });
await build({ ...common, entryPoints: ["src/integration/suite.ts"], outfile: "dist/test/suite.cjs" });
