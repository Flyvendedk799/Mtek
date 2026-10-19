// Every check of decisions 0101 and 0104, in one place, over the real repository.
//
// `buildInputs` reads the repository into one plain object per comparison; `runChecks` applies the
// comparisons. The unit tests corrupt one side of one input and expect the comparison to name both sides.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  checkAbiConstants,
  checkFeatures,
  checkGeneratedDocs,
  checkNamingLint,
  checkReadmeClaims,
  checkRuntimeCapabilities,
  checkStdlibDoc,
  type AbiInputs,
  type DocInputs,
  type FeatureInputs,
  type NamingLintInputs,
  type ReadmeInputs,
  type RuntimeInputs,
  type StdlibDocInputs,
} from "./compare.ts";
import type { Ctx } from "./ctx.ts";
import { committedDoc, generateDocs, staleDocs } from "./docs.ts";
import { manifestCodecIds } from "./guide.ts";
import { LIMITATIONS_DOC, splitNotSupported, validateLimitationsData } from "./limitations.ts";
import type { Mismatch } from "./model.ts";
import { REFERENCE_DOC } from "./reference.ts";
import { checkKnownIssues, checkReleaseNotes, RELEASE_NOTES, type NotesIo } from "./releasenotes.ts";
import { readRuntimeFacts, type RuntimeFacts } from "./runtimefacts.ts";
import { languageWordLists, readText } from "./spectext.ts";

export interface RunOptions {
  /** The generated documents were just written: judge those instead of the files on disk. */
  written?: boolean;
}

export async function loadRuntime(ctx: Ctx): Promise<RuntimeFacts> {
  return readRuntimeFacts(ctx.root, manifestCodecIds(ctx.text("spec/manifest.schema.json")));
}

/** The examples: every directory of examples/ that has an mtek.toml. */
export function listExamples(root: string): string[] {
  return readdirSync(join(root, "examples"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "examples", entry.name, "mtek.toml")))
    .map((entry) => entry.name)
    .sort();
}

export interface Inputs {
  features: FeatureInputs;
  docs: DocInputs;
  naming: NamingLintInputs;
  abi: AbiInputs;
  runtime: RuntimeInputs;
  stdlib: StdlibDocInputs;
  readme: ReadmeInputs;
  notes: { text: string | null; io: NotesIo; m6Report: string };
}

export function buildInputs(ctx: Ctx, runtime: RuntimeFacts, options: RunOptions = {}): Inputs {
  const root = ctx.root;
  const generated = generateDocs(ctx);
  const doc = (path: string): string | null => (options.written === true ? (generated.get(path) ?? null) : committedDoc(root, path));
  const languageMd = ctx.text("spec/language.md");
  const reservedWords = languageWordLists(languageMd).reserved;
  const split = splitNotSupported(ctx.compiler.notSupported, reservedWords);
  const pkg = JSON.parse(ctx.text("package.json")) as { scripts: Record<string, string> };
  const limitations = doc(LIMITATIONS_DOC);
  return {
    features: { compiler: ctx.compiler, registry: ctx.registry, milestone: ctx.milestone, languageMd, catalogue: ctx.catalogue },
    docs: {
      compiler: ctx.compiler,
      catalogue: ctx.catalogue,
      exceptions: ctx.exceptions,
      reservedWords,
      hardGateNames: split.gates,
      reference: doc(REFERENCE_DOC),
      limitations,
    },
    naming: { catalogue: ctx.catalogue, exceptions: ctx.exceptions, languageMd, limitations },
    abi: {
      compiler: ctx.compiler,
      runtime,
      runtimeAbiMd: ctx.text("spec/runtime-abi.md"),
      toolingMd: ctx.text("spec/tooling.md"),
      manifestSchemaJson: ctx.text("spec/manifest.schema.json"),
      manifestTypesTs: ctx.text("packages/runtime-web/src/abi/manifest-types.ts"),
      registry: ctx.registry,
      readme: ctx.text("README.md"),
    },
    runtime: {
      compiler: ctx.compiler,
      runtime,
      registry: ctx.registry,
      stdlibMd: ctx.text("spec/stdlib.md"),
      runtimeAbiMd: ctx.text("spec/runtime-abi.md"),
      manifestSchemaJson: ctx.text("spec/manifest.schema.json"),
    },
    stdlib: { registry: ctx.registry, stdlibMd: ctx.text("spec/stdlib.md") },
    readme: {
      readme: ctx.text("README.md"),
      specReadme: ctx.text("spec/README.md"),
      gettingStarted: ctx.text("docs/getting-started.md"),
      compiler: ctx.compiler,
      rootScripts: pkg.scripts,
      exampleDirs: listExamples(root),
      rustToolchain: ctx.text("rust-toolchain.toml"),
      nvmrc: ctx.text(".nvmrc"),
      decisionFiles: ctx.decisionFiles,
    },
    notes: {
      text: committedDoc(root, RELEASE_NOTES),
      io: {
        exists: (path) => existsSync(join(root, path)),
        read: (path) => {
          try {
            return readText(root, path);
          } catch {
            return null;
          }
        },
      },
      m6Report: ctx.text("evidence/M6/report.md"),
    },
  };
}

/** All comparisons except the staleness of the generated documents and the check of the hand-written data. */
export function checkInputs(i: Inputs): Mismatch[] {
  const found: Mismatch[] = [];
  found.push(...checkFeatures(i.features));
  found.push(...checkGeneratedDocs(i.docs));
  found.push(...checkNamingLint(i.naming));
  found.push(...checkAbiConstants(i.abi));
  found.push(...checkRuntimeCapabilities(i.runtime));
  found.push(...checkStdlibDoc(i.stdlib));
  found.push(...checkReadmeClaims(i.readme));
  if (i.notes.text === null) {
    found.push(...checkReleaseNotes("", { exists: () => false, read: () => null }));
  } else {
    found.push(...checkReleaseNotes(i.notes.text, i.notes.io));
    found.push(...checkKnownIssues(i.notes.text, i.notes.m6Report));
  }
  return found;
}

export function runChecks(ctx: Ctx, runtime: RuntimeFacts, options: RunOptions = {}): Mismatch[] {
  const found: Mismatch[] = [];
  if (options.written !== true) found.push(...staleDocs(ctx.root, generateDocs(ctx)));
  found.push(...validateLimitationsData(ctx));
  found.push(...checkInputs(buildInputs(ctx, runtime, options)));
  return found;
}
