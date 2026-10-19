// The documentation pages generated from templates (decision 0116): `templates/pages/<path>` is written to
// `docs/<path>`. The index, the tutorial and the concept pages are such pages; the compact guide is the one
// template outside this directory (`templates/language-guide.md`, decision 0118).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./ctx.ts";
import { renderTemplate, type PageInfo } from "./guide.ts";

export const PAGES_TEMPLATE_DIR = "tools/release-docs/templates/pages";
export const DOCS_DIR = "docs";
export const DOCS_INDEX = "docs/README.md";
export const TUTORIAL_DOC = "docs/tutorial.md";
export const CONCEPTS_DIR = "docs/concepts";

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(root, path, out);
    else if (entry.name.endsWith(".md")) out.push(path);
  }
}

/** The page templates below `templates/pages`, as `{ doc, template }`, sorted by the page they write. */
export function pageTemplates(root: string): PageInfo[] {
  const files: string[] = [];
  walk(root, PAGES_TEMPLATE_DIR, files);
  return files
    .map((template) => ({ template, doc: `${DOCS_DIR}/${template.slice(PAGES_TEMPLATE_DIR.length + 1)}` }))
    .sort((a, b) => a.doc.localeCompare(b.doc));
}

/** Every page written from a template, by the path it is written to. */
export function renderPages(ctx: Ctx): Map<string, string> {
  const pages = new Map<string, string>();
  for (const page of pageTemplates(ctx.root)) {
    const source = readFileSync(join(ctx.root, page.template), "utf8").replace(/\r\n/g, "\n");
    pages.set(page.doc, renderTemplate(ctx, source, page));
  }
  return pages;
}
