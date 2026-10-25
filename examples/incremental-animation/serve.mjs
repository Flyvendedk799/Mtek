import { context } from "esbuild";
import {fileURLToPath} from "node:url";
const ctx = await context({
    entryPoints: [
        fileURLToPath(new URL("main.ts",import.meta.url)),
    ],
    outfile:fileURLToPath(new URL("dist/main.js",import.meta.url)),
    bundle: true,
    format: "esm",
    sourcemap: true,
    target: "es2022",
});
const server = await ctx.serve({
    servedir:fileURLToPath(new URL(".",import.meta.url)),
    host: "127.0.0.1",
    port: 5183,
});
console.log(`Animation example: http://127.0.0.1:${server.port}`);
process.on("SIGINT", () => {
    void ctx.dispose().then(() => process.exit(0));
});
