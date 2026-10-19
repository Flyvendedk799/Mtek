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
import { checkDocCode } from "./doccode.ts";
import { committedDoc, generateDocs, staleDocs } from "./docs.ts";
import { GUIDE_DOC, manifestCodecIds } from "./guide.ts";
import type { PageText } from "./docpages.ts";
import { checkDocLinks, type LinkInputs } from "./links.ts";
import { checkDocPages, type DocPageInputs } from "./docpages.ts";
import { CONCEPTS_DIR, DOCS_INDEX, pageTemplates, TUTORIAL_DOC } from "./pages.ts";
import { LIMITATIONS_DOC, splitNotSupported, validateLimitationsData } from "./limitations.ts";
import type { Mismatch } from "./model.ts";
import { REFERENCE_DOC } from "./reference.ts";
import { checkSupportedEnvironments, ENVIRONMENTS_DIR, ENVIRONMENTS_DOC, type EnvironmentsIo } from "./environments.ts";
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
  environments: { text: string | null; io: EnvironmentsIo };
  links: LinkInputs;
  docPages: DocPageInputs;
}

/** Every `environment-*.json` below `evidence/M7/environments/`, as repository paths. */
function storedEnvironmentRecords(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(join(root, dir))) return;
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/^environment-.+\.json$/.test(entry.name)) out.push(path);
    }
  };
  walk(ENVIRONMENTS_DIR.replace(/\/$/, ""));
  return out.sort();
}

export function buildInputs(ctx: Ctx, runtime: RuntimeFacts, options: RunOptions = {}): Inputs {
  const root = ctx.root;
  const generated = generateDocs(ctx);
  const doc = (path: string): string | null => (options.written === true ? (generated.get(path) ?? committedDoc(root, path)) : committedDoc(root, path));
  const languageMd = ctx.text("spec/language.md");
  const reservedWords = languageWordLists(languageMd).reserved;
  const split = splitNotSupported(ctx.compiler.notSupported, reservedWords);
  const pkg = JSON.parse(ctx.text("package.json")) as { scripts: Record<string, string> };
  const limitations = doc(LIMITATIONS_DOC);
  const newPages = pageTemplates(root).map((p) => p.doc);
  const textOf = (path: string): PageText[] => {
    const text = doc(path);
    return text === null ? [] : [{ path, text }];
  };
  const withDocs = [GUIDE_DOC, ...newPages];
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
    environments: {
      text: committedDoc(root, ENVIRONMENTS_DOC),
      io: {
        exists: (path) => existsSync(join(root, path)),
        read: (path) => {
          try {
            return readText(root, path);
          } catch {
            return null;
          }
        },
        records: () => storedEnvironmentRecords(root),
      },
    },
    links: {
      pages: [LIMITATIONS_DOC, REFERENCE_DOC, RELEASE_NOTES, ENVIRONMENTS_DOC, ...withDocs].flatMap(textOf),
      exists: (path) => existsSync(join(root, path)),
    },
    docPages: {
      pages: withDocs.flatMap(textOf),
      linkable: [LIMITATIONS_DOC, REFERENCE_DOC, RELEASE_NOTES, ENVIRONMENTS_DOC, "docs/getting-started.md", "docs/coverage-matrix.md", "docs/preview-hosting.md"].flatMap(textOf),
      catalogue: ctx.catalogue,
      indexPath: DOCS_INDEX,
      indexedPages: [GUIDE_DOC, TUTORIAL_DOC, "docs/getting-started.md", REFERENCE_DOC, LIMITATIONS_DOC, ...newPages.filter((p) => p.startsWith(`${CONCEPTS_DIR}/`))],
      guidePath: GUIDE_DOC,
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
  found.push(...checkDocLinks(i.links));
  found.push(...checkDocPages(i.docPages));
  if (i.notes.text === null) {
    found.push(...checkReleaseNotes("", { exists: () => false, read: () => null }));
  } else {
    found.push(...checkReleaseNotes(i.notes.text, i.notes.io));
    found.push(...checkKnownIssues(i.notes.text, i.notes.m6Report));
  }
  found.push(...checkSupportedEnvironments(i.environments.text, i.environments.io));
  return found;
}

export function runChecks(ctx: Ctx, runtime: RuntimeFacts, options: RunOptions = {}): Mismatch[] {
  const found: Mismatch[] = [];
  if (options.written !== true) found.push(...staleDocs(ctx.root, generateDocs(ctx)));
  found.push(...validateLimitationsData(ctx));
  found.push(...checkInputs(buildInputs(ctx, runtime, options)));
  return found;
}

/** The pages whose Mtek code blocks are compiled: the compact guide and every page written from a template. */
export function codePages(ctx: Ctx, options: RunOptions = {}): PageText[] {
  const generated = options.written === true ? generateDocs(ctx) : null;
  return [GUIDE_DOC, ...pageTemplates(ctx.root).map((p) => p.doc)].flatMap((path) => {
    const text = generated?.get(path) ?? committedDoc(ctx.root, path);
    return text === null ? [] : [{ path, text }];
  });
}

/** Compile every code block of the documentation with the built compiler (decision 0117). */
export async function runDocCode(ctx: Ctx, options: RunOptions = {}): Promise<Mismatch[]> {
  return checkDocCode({ root: ctx.root, mtek: ctx.mtek, language: ctx.compiler.contextLanguage }, codePages(ctx, options));
}
