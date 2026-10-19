// The whole audit: compile the programs, read the compiler's list of features and the diagnostic
// fixtures, build the matrix and print the document.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  auditCodes,
  fileReader,
  readCatalogue,
  readExceptions,
  readFixtureCodes,
  type CatalogueEntry,
  type DiagnosticFixture,
  type Exceptions,
} from "./diagnostics.ts";
import { buildMatrix, type Matrix } from "./matrix.ts";
import { analyse, discover, type Analysed, type Tools } from "./projects.ts";
import { readSupported, type SupportedFeatures } from "./registry.ts";
import { render } from "./render.ts";

/** The generated document, relative to the repository root. */
export const DOCUMENT = "docs/coverage-matrix.md";

/** Everything the matrix is made from, as read from the compiler and the repository. */
export interface Inputs {
  supported: SupportedFeatures;
  projects: Analysed[];
  catalogue: CatalogueEntry[];
  fixtureCodes: Map<string, DiagnosticFixture[]>;
  exceptions: Exceptions;
}

export interface Audit {
  matrix: Matrix;
  text: string;
}

export async function collect(root: string, tools: Tools): Promise<Inputs> {
  return {
    supported: await readSupported(root, tools.mtek, tools.run),
    projects: await analyse(root, discover(root), tools),
    catalogue: readCatalogue(root),
    fixtureCodes: readFixtureCodes(root),
    exceptions: readExceptions(root),
  };
}

export function assemble(root: string, inputs: Inputs): Audit {
  const codes = auditCodes(inputs.catalogue, inputs.fixtureCodes, inputs.exceptions, fileReader(root));
  const matrix = buildMatrix({ supported: inputs.supported, projects: inputs.projects, codes, fixtureCodes: inputs.fixtureCodes });
  return { matrix, text: render(matrix) };
}

export async function audit(root: string, tools: Tools): Promise<Audit> {
  return assemble(root, await collect(root, tools));
}

/** The committed document with line endings normalised, or null when there is none. */
export function committed(root: string): string | null {
  const path = join(root, DOCUMENT);
  return existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : null;
}
