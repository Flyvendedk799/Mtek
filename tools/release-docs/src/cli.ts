// `release-docs [--write]`: generate the release documentation (decision 0100) and run the capability
// consistency check (decision 0101) and the release notes check (decision 0104).
//
//   (no flag)  fail (exit 1) when a generated document is stale or any comparison finds a mismatch
//   --write    write the generated documents first, then run every comparison
//
// Exit codes: 0 every comparison holds; 1 a mismatch; 3 the compiler cannot be found.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findMtek, repoRoot } from "../../coverage-matrix/src/tools.ts";
import { loadCtx } from "./ctx.ts";
import { generateDocs, writeDocs } from "./docs.ts";
import { loadRuntime, runChecks, runDocCode } from "./run.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export async function runCli(argv: readonly string[], io: Io, root: string = repoRoot(), env: Readonly<Record<string, string | undefined>> = process.env): Promise<number> {
  const flags = new Set(argv);
  for (const flag of flags) {
    if (flag !== "--write") {
      io.err(`error: unknown argument ${flag}\nusage: release-docs [--write]\n`);
      return 3;
    }
  }
  const mtek = findMtek(env);
  if (mtek === null) {
    io.err("error: no mtek executable: build one (npm run build), or name it with MTEK_BIN\n");
    return 3;
  }
  const ctx = await loadCtx(root, mtek);
  if (flags.has("--write")) {
    const docs = generateDocs(ctx);
    writeDocs(root, docs);
    for (const path of docs.keys()) io.out(`wrote ${path}\n`);
  }
  const runtime = await loadRuntime(ctx);
  const found = runChecks(ctx, runtime, { written: flags.has("--write") });
  found.push(...(await runDocCode(ctx, { written: flags.has("--write") })));
  io.out(
    `release-docs: ${String(ctx.compiler.features.length)} features, ${String(ctx.catalogue.length)} diagnostic codes, ` +
      `ABI ${ctx.compiler.versionAbi ?? "?"}, language ${ctx.compiler.contextLanguage}\n`,
  );
  if (found.length > 0) {
    io.err(`release-docs: ${String(found.length)} mismatch${found.length === 1 ? "" : "es"}:\n`);
    for (const m of found) io.err(`  - ${m.message}\n`);
    return 1;
  }
  io.out("release-docs: every comparison holds\n");
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
