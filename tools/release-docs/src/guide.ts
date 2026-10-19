// The documentation templates (decisions 0100 and 0116): a template is a page with prose, whose programs and
// facts are expanded by the generator. `docs/language-guide.md` is one (`templates/language-guide.md`); every
// other page under `docs/` that this package writes is one (`templates/pages/<path>`).
//
//   {{generated}}                       the "generated" comment
//   {{language-version}}                `languageVersion` of `mtek context`
//   {{compiler-version-line}}           the line `mtek --version` prints
//   {{feature-count}}                   the number of `supported.features`
//   {{reserved-count}}                  the number of reserved words (spec/language.md 2.3)
//   {{reserved-words}}                  the reserved words, as code
//   {{example PATH}}                    a whole file of the repository, in a fenced block marked `from=PATH`
//   {{excerpt PATH :: FROM :: TO}}      the lines from the first that matches the regular expression FROM to
//                                       the next that matches TO (inclusive); a pattern that matches nothing is an error
//   {{features PREFIX}}                 the features that start with PREFIX (`event:`), prefix removed, as code
//   {{schemas CATEGORY}}                the registry schemas of a category, as code
//   {{codecs}}                          the host input codec ids of spec/manifest.schema.json
//   {{commands}}                        the commands `mtek --help` lists
//   {{fields SCHEMA}}                   the fields of a registry schema, as a table
//   {{default SCHEMA.FIELD}}            the default of a field, as code
//   {{range SCHEMA.FIELD}}              the allowed range of a field
//   {{enum NAME}} / {{enum NAME full}}  the members of a registry enum (runs folded unless `full`)
//   {{signature NAME}}                  the signatures of an intrinsic, a namespace function or `body.COMMAND`
//   {{events}}                          the events of the registry, as a table
//   {{intrinsics DOMAIN}}               the functions that run in a domain: both, cpu or gpu
//   {{exposure-for LUX}}                the camera exposure (EV100) at which LUX lux gives a white diffuse surface full brightness
//   {{project-default NAME}}            `DEFAULT_NAME` of the compiler's project configuration
//   {{decision NUMBER}}                 a link to a decision record
//   {{cited-codes}}                     a table of the diagnostic codes (`MTEK-E5074`) the page mentions
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./ctx.ts";
import { catalogueEntry, citedCodes, citedCodesTable, enumMembers, eventsTable, exposureForLux, fieldDefault, intrinsicsOf, fieldRange, fieldsTable, projectDefault, signatures } from "./facts.ts";
import { GENERATED_NOTE, code, decisionLink } from "./md.ts";
import { languageWordLists } from "./spectext.ts";

export const GUIDE_DOC = "docs/language-guide.md";
export const GUIDE_TEMPLATE = "tools/release-docs/templates/language-guide.md";

/** The page a template renders to: where it is written and where its source is. */
export interface PageInfo {
  doc: string;
  template: string;
}

const GUIDE_PAGE: PageInfo = { doc: GUIDE_DOC, template: GUIDE_TEMPLATE };

function fenceFor(path: string): string {
  if (path.endsWith(".mtek")) return "mtek";
  if (path.endsWith(".toml")) return "toml";
  return "";
}

function list(items: readonly string[]): string {
  if (items.length === 0) return "(none)";
  return items.map((i) => code(i)).join(", ");
}

export function manifestCodecIds(manifestSchema: string): string[] {
  const schema = JSON.parse(manifestSchema) as { $defs: { hostInput: { properties: { codec: { enum: string[] } } } } };
  return schema.$defs.hostInput.properties.codec.enum;
}

export function excerpt(text: string, from: string, to: string, what: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => new RegExp(from).test(line));
  if (start < 0) throw new Error(`${what}: no line matches ${from}`);
  const end = lines.findIndex((line, i) => i > start && new RegExp(to).test(line));
  if (end < 0) throw new Error(`${what}: no line after line ${String(start + 1)} matches ${to}`);
  return lines.slice(start, end + 1).join("\n");
}

/** A fenced block of a repository file; `from=` names the file so that a test can find the text in it. */
function block(path: string, body: string): string {
  const lang = fenceFor(path);
  return `\`\`\`${lang}${lang === "" ? "text" : ""} from=${path}\n${body.replace(/\n+$/, "")}\n\`\`\``;
}

/** The `../` prefix that leads from a page to the repository root. */
export function rootPrefix(doc: string): string {
  return "../".repeat(doc.split("/").length - 1);
}

export const CITED_MARK = "\u0000cited-codes\u0000";

export function expandDirective(ctx: Ctx, directive: string, page: PageInfo = GUIDE_PAGE): string {
  const name = directive.trim().split(/\s+/)[0] ?? "";
  const rest = directive.trim().slice(name.length).trim();
  switch (name) {
    case "generated":
      return GENERATED_NOTE(page.doc);
    case "language-version":
      return ctx.compiler.contextLanguage;
    case "compiler-version-line":
      return ctx.compiler.versionLine;
    case "feature-count":
      return String(ctx.compiler.features.length);
    case "reserved-count":
      return String(languageWordLists(ctx.text("spec/language.md")).reserved.length);
    case "reserved-words":
      return list(languageWordLists(ctx.text("spec/language.md")).reserved);
    case "example":
      return block(rest, ctx.text(rest));
    case "excerpt": {
      const [path = "", from = "", to = ""] = rest.split(" :: ").map((s) => s.trim());
      return block(path, excerpt(ctx.text(path), from, to, `${page.template}: excerpt of ${path}`));
    }
    case "features": {
      const prefix = rest;
      return list(ctx.compiler.features.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length)));
    }
    case "schemas":
      return list(ctx.registry.schemas.filter((s) => s.category === rest).map((s) => s.name));
    case "codecs":
      return list(manifestCodecIds(ctx.text("spec/manifest.schema.json")));
    case "commands":
      return list(ctx.compiler.subcommands);
    case "fields":
      return fieldsTable(ctx.registry, rest);
    case "default":
      return fieldDefault(ctx.registry, rest);
    case "range":
      return fieldRange(ctx.registry, rest);
    case "enum": {
      const [enumName = "", mode = ""] = rest.split(/\s+/);
      return enumMembers(ctx.registry, enumName, mode === "full");
    }
    case "signature":
      return signatures(ctx.registry, rest);
    case "events":
      return eventsTable(ctx.registry);
    case "exposure-for":
      return exposureForLux(Number(rest));
    case "intrinsics":
      return intrinsicsOf(ctx.registry, rest);
    case "project-default":
      return projectDefault(ctx.text("crates/mtek-compiler/src/project/config.rs"), rest);
    case "decision": {
      const link = decisionLink(rest, ctx.decisionFiles);
      return link.startsWith("[") ? link.replace("](../", `](${rootPrefix(page.doc)}`) : link;
    }
    case "diagnostic": {
      const entry = catalogueEntry(ctx.catalogue, rest, `${page.template}: {{diagnostic ${rest}}}`);
      return `${code(`MTEK-${entry.code}`)} (${entry.title})`;
    }
    case "cited-codes":
      return CITED_MARK;
    default:
      throw new Error(`${page.template}: unknown directive {{${directive}}}`);
  }
}

/** Expand every directive of `source`; `{{cited-codes}}` last, from the codes the rest of the page mentions. */
export function renderTemplate(ctx: Ctx, source: string, page: PageInfo): string {
  const body = source.replace(/\{\{([^}]*(?:\}[^}][^}]*)*)\}\}/g, (_all, directive: string) => expandDirective(ctx, directive, page));
  if (!body.includes(CITED_MARK)) return body;
  const table = citedCodesTable(ctx.catalogue, citedCodes(body.split(CITED_MARK).join("")), rootPrefix(page.doc));
  return body.split(CITED_MARK).join(table);
}

export function renderGuide(ctx: Ctx, template?: string): string {
  const source = template ?? readFileSync(join(ctx.root, GUIDE_TEMPLATE), "utf8").replace(/\r\n/g, "\n");
  return renderTemplate(ctx, source, GUIDE_PAGE);
}
