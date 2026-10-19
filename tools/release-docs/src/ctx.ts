// Everything the renderers and the checks read, gathered once.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readCatalogue,
  readExceptions,
  readFixtureCodes,
  type CatalogueEntry,
  type DiagnosticFixture,
  type Exceptions,
} from "../../coverage-matrix/src/diagnostics.ts";
import { readCompilerFacts, type CompilerFacts } from "./compilerfacts.ts";
import { readCurrentMilestone, readRegistry, type StdlibSchema } from "./registry.ts";
import { readText } from "./spectext.ts";

export interface RestrictionSource {
  file: string;
  quote: string;
}

export interface Restriction {
  id: string;
  area: string;
  restriction: string;
  reason: string;
  codes: string[];
  decisions: string[];
  source: RestrictionSource;
}

export interface LimitationsData {
  unsupportedCodes: Record<string, { reason: string; source: RestrictionSource }>;
  internalErrorCodes: Record<string, string>;
  hardGates: Record<string, { code: string; restriction: string; reason: string; decisions: string[]; source: RestrictionSource }>;
  reservedWords: { code: string; reason: string; source: RestrictionSource };
  restrictions: Restriction[];
}

export const LIMITATIONS_DATA = "tools/release-docs/data/limitations.json";

export function readLimitationsData(root: string): LimitationsData {
  return JSON.parse(readFileSync(join(root, LIMITATIONS_DATA), "utf8")) as LimitationsData;
}

export interface Ctx {
  root: string;
  compiler: CompilerFacts;
  registry: StdlibSchema;
  milestone: string | null;
  catalogue: CatalogueEntry[];
  exceptions: Exceptions;
  fixtures: Map<string, DiagnosticFixture[]>;
  limits: LimitationsData;
  /** The file names in spec/decisions. */
  decisionFiles: string[];
  /** A repository file as text, LF line endings. */
  text: (path: string) => string;
}

export async function loadCtx(root: string, mtek: string): Promise<Ctx> {
  return {
    root,
    compiler: await readCompilerFacts(root, mtek),
    registry: readRegistry(root),
    milestone: readCurrentMilestone(root),
    catalogue: readCatalogue(root),
    exceptions: readExceptions(root),
    fixtures: readFixtureCodes(root),
    limits: readLimitationsData(root),
    decisionFiles: readdirSync(join(root, "spec", "decisions")).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort(),
    text: (path) => readText(root, path),
  };
}
