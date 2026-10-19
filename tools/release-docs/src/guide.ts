// docs/language-guide.md (decision 0100): a template with prose, whose programs and facts are
// expanded by the generator.
//
//   {{generated}}                       the "generated" comment
//   {{language-version}}                `languageVersion` of `mtek context`
//   {{compiler-version-line}}           the line `mtek --version` prints
//   {{feature-count}}                   the number of `supported.features`
//   {{reserved-count}}                  the number of reserved words (spec/language.md 2.3)
//   {{example PATH}}                    a whole file of the repository, in a fenced block
//   {{excerpt PATH :: FROM :: TO}}      the lines from the first that matches the regular expression FROM to
//                                       the next that matches TO (inclusive); a pattern that matches nothing is an error
//   {{features PREFIX}}                 the features that start with PREFIX (`event:`), prefix removed, as code
//   {{schemas CATEGORY}}                the registry schemas of a category, as code
//   {{codecs}}                          the host input codec ids of spec/manifest.schema.json
//   {{commands}}                        the commands `mtek --help` lists
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./ctx.ts";
import { GENERATED_NOTE, code } from "./md.ts";
import { languageWordLists } from "./spectext.ts";

export const GUIDE_DOC = "docs/language-guide.md";
export const GUIDE_TEMPLATE = "tools/release-docs/templates/language-guide.md";

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

function block(path: string, body: string): string {
  return `\`\`\`${fenceFor(path)}\n${body.replace(/\n+$/, "")}\n\`\`\``;
}

export function expandDirective(ctx: Ctx, directive: string): string {
  const name = directive.trim().split(/\s+/)[0] ?? "";
  const rest = directive.trim().slice(name.length).trim();
  switch (name) {
    case "generated":
      return GENERATED_NOTE(GUIDE_DOC);
    case "language-version":
      return ctx.compiler.contextLanguage;
    case "compiler-version-line":
      return ctx.compiler.versionLine;
    case "feature-count":
      return String(ctx.compiler.features.length);
    case "reserved-count":
      return String(languageWordLists(ctx.text("spec/language.md")).reserved.length);
    case "example":
      return block(rest, ctx.text(rest));
    case "excerpt": {
      const [path = "", from = "", to = ""] = rest.split(" :: ").map((s) => s.trim());
      return block(path, excerpt(ctx.text(path), from, to, `${GUIDE_TEMPLATE}: excerpt of ${path}`));
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
    default:
      throw new Error(`${GUIDE_TEMPLATE}: unknown directive {{${directive}}}`);
  }
}

export function renderGuide(ctx: Ctx, template?: string): string {
  const source = template ?? readFileSync(join(ctx.root, GUIDE_TEMPLATE), "utf8").replace(/\r\n/g, "\n");
  return source.replace(/\{\{([^}]*(?:\}[^}][^}]*)*)\}\}/g, (_all, directive: string) => expandDirective(ctx, directive));
}
