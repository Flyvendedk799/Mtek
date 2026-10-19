// What the pages of the documentation have to look like (decisions 0116 and 0118), checked without compiling
// anything: the sections of a concept page, the diagnostic codes it cites, the index, the anchors, the size of the
// compact guide and the words no page may use.
import type { CatalogueEntry } from "../../coverage-matrix/src/diagnostics.ts";
import { extractFences, fullCode, proseOf } from "./doccode.ts";
import { citedCodes } from "./facts.ts";
import { mismatch, type Mismatch } from "./model.ts";

export const CONCEPT_PREFIX = "docs/concepts/";
export const CONCEPT_SECTIONS = ["Rules", "Why", "Examples", "Common mistakes", "See also"] as const;
/** The compact guide is read by language models and is held to this many bytes (decision 0118). */
export const GUIDE_MAX_BYTES = 16384;

export interface PageText {
  path: string;
  text: string;
}

export interface DocPageInputs {
  /** The pages written from templates, and the guide. */
  pages: readonly PageText[];
  /** Pages the links may point into although this check does not judge their prose (getting started, reference, ...). */
  linkable: readonly PageText[];
  catalogue: readonly CatalogueEntry[];
  /** `docs/README.md`, `docs/tutorial.md` and the guide: the pages the index has to list besides the concept pages. */
  indexPath: string;
  indexedPages: readonly string[];
  guidePath: string;
  /** The registry's default `Camera.exposure` as text and `-log2(1.2 pi)` rounded to binary32: the formula of `{{exposure-for}}`. */
  exposure: { text: string; expected: number };
}

/** The anchor GitHub gives a heading. */
export function slug(heading: string): string {
  return heading
    .replace(/`/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** The headings of a page (outside fences) as `[level, text]`. */
export function headingsOf(text: string): [number, string][] {
  const out: [number, string][] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const open = /^(`{3,})/.exec(line);
    if (fence === null && open !== null) {
      fence = open[1] ?? "```";
      continue;
    }
    if (fence !== null) {
      if (new RegExp(`^${fence}\\s*$`).test(line)) fence = null;
      continue;
    }
    const m = /^(#{1,6}) (.*?)\s*$/.exec(line);
    if (m !== null) out.push([m[1]?.length ?? 1, m[2] ?? ""]);
  }
  return out;
}

/** The text of the section that starts at the `## heading` and ends at the next `##`. */
function sectionOf(text: string, heading: string): string | null {
  const lines = text.split("\n");
  let fence: string | null = null;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const open = /^(`{3,})/.exec(line);
    if (fence === null && open !== null) {
      fence = open[1] ?? "```";
      continue;
    }
    if (fence !== null) {
      if (new RegExp(`^${fence}\\s*$`).test(line)) fence = null;
      continue;
    }
    if (start < 0) {
      if (line === `## ${heading}`) start = i;
    } else if (/^## /.test(line)) {
      return lines.slice(start, i).join("\n");
    }
  }
  return start < 0 ? null : lines.slice(start).join("\n");
}

const FORBIDDEN =
  /\b(benchmark\w*|performance|performant|faster|fastest|slower|speed-?ups?|efficien\w+|token budget|token count|tokens? (?:cost|usage|saving)\w*|holdout)\b|benchmarks\/(?:tasks|holdout|results)/i;

export function checkDocPages(i: DocPageInputs): Mismatch[] {
  const found: Mismatch[] = [];
  const known = new Set(i.catalogue.map((c) => c.code));
  const headingSlugs = new Map<string, Set<string>>();
  for (const page of [...i.pages, ...i.linkable]) headingSlugs.set(page.path, new Set(headingsOf(page.text).map(([, h]) => slug(h))));

  for (const page of i.pages) {
    const prose = proseOf(page.text);
    // Codes cited by hand exist.
    for (const c of citedCodes(page.text)) {
      if (!known.has(c)) found.push(mismatch("docs/cited-codes", { where: page.path, value: `cites MTEK-${c}` }, { where: "spec/diagnostics.md", value: "no such code" }));
    }
    // Words no page may use.
    for (const [n, line] of prose.split("\n").entries()) {
      const m = FORBIDDEN.exec(line);
      if (m !== null) {
        found.push(mismatch("docs/claims", { where: `${page.path} (prose line ${String(n + 1)})`, value: `uses ${JSON.stringify(m[0])}` }, { where: "decision 0116", value: "no page speaks about benchmarks, performance or token cost" }));
      }
    }
    // A block that is intentionally wrong is explained by its code.
    for (const fence of extractFences(page.path, page.text)) {
      for (const code of [...(fence.attrs.get("wrong")?.split(",") ?? []), ...(fence.attrs.get("warn")?.split(",") ?? [])].filter((c) => c !== "").map(fullCode)) {
        if (!prose.includes(code)) {
          found.push(mismatch("docs/wrong-cited", { where: `${page.path} line ${String(fence.line)}`, value: `a block that must produce ${code}` }, { where: page.path, value: `the prose never names ${code}` }));
        }
      }
    }
    // Concept pages have the sections of decision 0116.
    if (page.path.startsWith(CONCEPT_PREFIX)) {
      const h = headingsOf(page.text);
      if (h[0]?.[0] !== 1) found.push(mismatch("docs/structure", { where: page.path, value: "starts with a # title" }, { where: page.path, value: `starts with ${JSON.stringify(h[0] ?? null)}` }));
      for (const name of CONCEPT_SECTIONS) {
        if (!h.some(([level, text]) => level === 2 && text === name)) {
          found.push(mismatch("docs/structure", { where: page.path, value: `a section "## ${name}"` }, { where: page.path, value: "no such section" }, "decision 0116"));
        }
      }
      const mistakes = sectionOf(page.text, "Common mistakes");
      if (mistakes !== null && !extractFences(page.path, mistakes).some((f) => f.attrs.has("wrong"))) {
        found.push(mismatch("docs/structure", { where: page.path, value: 'a wrong= example under "Common mistakes"' }, { where: page.path, value: "none" }, "decision 0116"));
      }
    }
  }

  // The formula behind {{exposure-for}} is the one that produces the registry's default exposure.
  if (Math.fround(Number(i.exposure.text)) !== i.exposure.expected) {
    found.push(
      mismatch(
        "docs/exposure-formula",
        { where: "spec/stdlib-schema.json (Camera.exposure default)", value: i.exposure.text },
        { where: "-log2(1.2 * pi) as binary32 (the formula of {{exposure-for}})", value: String(i.exposure.expected) },
      ),
    );
  }

  // The index lists every page.
  const index = i.pages.find((p) => p.path === i.indexPath);
  if (index === undefined) {
    found.push(mismatch("docs/index", { where: "docs/", value: `an index page ${i.indexPath}` }, { where: "tools/release-docs/templates/pages", value: "no such template" }));
  } else {
    const targets = new Set([...index.text.matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)].map((m) => resolve(i.indexPath, m[1] ?? "")));
    for (const path of i.indexedPages) {
      if (!targets.has(path)) found.push(mismatch("docs/index", { where: i.indexPath, value: `no link to ${path}` }, { where: path, value: "a page of the documentation" }, "list it in the index"));
    }
  }

  // The guide is small.
  const guide = i.pages.find((p) => p.path === i.guidePath);
  if (guide !== undefined) {
    const bytes = Buffer.byteLength(guide.text, "utf8");
    if (bytes > GUIDE_MAX_BYTES) {
      found.push(mismatch("docs/guide-size", { where: i.guidePath, value: `${String(bytes)} bytes` }, { where: "decision 0118", value: `at most ${String(GUIDE_MAX_BYTES)} bytes` }));
    }
  }

  // Anchors of links between pages resolve.
  for (const page of [...i.pages, ...i.linkable]) {
    let fence: string | null = null;
    for (const [n, line] of page.text.split("\n").entries()) {
      const open = /^(`{3,})/.exec(line);
      if (fence === null && open !== null) {
        fence = open[1] ?? "```";
        continue;
      }
      if (fence !== null) {
        if (new RegExp(`^${fence}\\s*$`).test(line)) fence = null;
        continue;
      }
      for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]*#[^)\s]+)\)/g)) {
        const target = m[1] ?? "";
        if (/^[a-z]+:/.test(target)) continue;
        const hash = target.indexOf("#");
        const file = target.slice(0, hash);
        const anchor = target.slice(hash + 1);
        const resolved = file === "" ? page.path : resolve(page.path, file);
        const anchors = headingSlugs.get(resolved);
        if (anchors !== undefined && !anchors.has(anchor)) {
          found.push(mismatch("docs/anchors", { where: `${page.path} line ${String(n + 1)}`, value: `links to ${target}` }, { where: resolved, value: `no heading with the anchor #${anchor}` }));
        }
      }
    }
  }
  return found;
}

/** A path relative to the page it is written in, as a repository path. */
export function resolve(fromPage: string, target: string): string {
  const dir = fromPage.includes("/") ? fromPage.slice(0, fromPage.lastIndexOf("/")) : "";
  const parts = (dir === "" ? [] : dir.split("/")).concat(target.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}
