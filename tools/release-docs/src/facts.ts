// Facts for the directives of the documentation templates (decision 0116): field tables, enum members,
// signatures, events, diagnostic titles and project defaults, each read from the registry, the catalogue
// or the compiler source and never typed into a page.
import type { CatalogueEntry } from "../../coverage-matrix/src/diagnostics.ts";
import { code, table } from "./md.ts";
import type { FieldDef, SchemaDef, StdlibSchema } from "./registry.ts";

function schemaOf(registry: StdlibSchema, name: string, what: string): SchemaDef {
  const schema = registry.schemas.find((s) => s.name === name);
  if (schema === undefined) throw new Error(`${what}: the registry has no schema ${JSON.stringify(name)}`);
  return schema;
}

function fieldOf(registry: StdlibSchema, path: string, what: string): FieldDef {
  const [schemaName = "", fieldName = ""] = path.split(".");
  const field = schemaOf(registry, schemaName, what).fields.find((f) => f.name === fieldName);
  if (field === undefined) throw new Error(`${what}: the schema ${schemaName} has no field ${JSON.stringify(fieldName)}`);
  return field;
}

/** How a field may change at run time, in words. */
export function updateWords(field: FieldDef): string {
  if (field.constructionOnly) return "fixed at construction";
  const parts = [field.writable ? "assignable" : "read-only", field.bindable ? "bindable" : ""];
  return parts.filter((p) => p !== "").join(", ");
}

/** `{{fields Schema}}`: the fields of one registry schema as a table. */
export function fieldsTable(registry: StdlibSchema, schemaName: string): string {
  const schema = schemaOf(registry, schemaName, `{{fields ${schemaName}}}`);
  if (schema.fields.length === 0) return `${code(schema.name)} has no fields.`;
  return table(
    ["Field", "Type", "Default", "After construction", "Range", "Meaning"],
    schema.fields.map((f) => [
      code(f.name),
      code(f.type),
      f.required ? "required" : f.default === null ? "none" : code(f.default),
      updateWords(f),
      f.range ?? "",
      f.doc,
    ]),
  );
}

/** `{{default Schema.field}}`: the default of a field, as code. */
export function fieldDefault(registry: StdlibSchema, path: string): string {
  const field = fieldOf(registry, path, `{{default ${path}}}`);
  return field.default === null ? "none" : code(field.default);
}

/** `{{range Schema.field}}`: the allowed range of a field, in words. */
export function fieldRange(registry: StdlibSchema, path: string): string {
  const field = fieldOf(registry, path, `{{range ${path}}}`);
  return field.range ?? "any value of its type";
}

/** The members of an enum with runs such as `A` to `Z` and `Digit0` to `Digit9` folded into one entry. */
export function enumMembers(registry: StdlibSchema, name: string, full: boolean): string {
  const def = registry.enums.find((e) => e.name === name);
  if (def === undefined) throw new Error(`{{enum ${name}}}: the registry has no enum ${JSON.stringify(name)}`);
  const names = def.members.map((m) => m.name);
  if (full) return names.map((n) => code(`${name}.${n}`)).join(", ");
  const out: string[] = [];
  const letters = names.filter((n) => /^[A-Z]$/.test(n));
  const digits = names.filter((n) => /^Digit\d$/.test(n));
  let lettersDone = false;
  let digitsDone = false;
  for (const n of names) {
    if (/^[A-Z]$/.test(n)) {
      if (!lettersDone && letters.length > 1) out.push(`${code(`${name}.${letters[0] ?? ""}`)} to ${code(`${name}.${letters[letters.length - 1] ?? ""}`)}`);
      lettersDone = true;
    } else if (/^Digit\d$/.test(n)) {
      if (!digitsDone && digits.length > 1) out.push(`${code(`${name}.${digits[0] ?? ""}`)} to ${code(`${name}.${digits[digits.length - 1] ?? ""}`)}`);
      digitsDone = true;
    } else {
      out.push(code(`${name}.${n}`));
    }
  }
  return out.join(", ");
}

/**
 * `{{signature name}}`: the signatures of an intrinsic (`mix`), a namespace function (`lighting.pbr`) or a body
 * command (`body.apply_impulse`), as code, separated by `<br>` so that a table cell can hold several.
 */
export function signatures(registry: StdlibSchema, name: string): string {
  const lines: string[] = [];
  const intrinsic = registry.intrinsics.find((i) => i.name === name);
  if (intrinsic !== undefined) {
    for (const s of intrinsic.signatures) lines.push(`${name}${s}`);
  }
  const dot = name.indexOf(".");
  if (dot > 0) {
    const ns = name.slice(0, dot);
    const member = name.slice(dot + 1);
    if (ns === "body") {
      const command = registry.bodyCommands.find((c) => c.name === member);
      if (command !== undefined) lines.push(`body.${member}(${command.params.map((p) => `${p.name}: ${p.type}`).join(", ")})`);
    } else {
      const found = registry.namespaces.find((n) => n.name === ns)?.members.find((m) => m.name === member);
      if (found !== undefined) {
        if (found.kind === "function") for (const s of found.signatures ?? []) lines.push(`${name}${s}`);
        else lines.push(`${name}: ${found.type ?? ""}`);
      }
    }
  }
  if (lines.length === 0) throw new Error(`{{signature ${name}}}: the registry has no function, namespace member or body command of that name`);
  return lines.map((l) => code(l)).join("<br>");
}

/** `{{events}}`: the events of the registry as a table. */
export function eventsTable(registry: StdlibSchema): string {
  return table(
    ["Event", "Form", "Allowed in", "Meaning"],
    registry.events.map((e) => [
      code(`on ${e.name}(...)`),
      e.form === "filter" ? `a constant ${code(e.argumentType ?? "")} as filter` : `one parameter of type ${code(e.argumentType ?? "")}`,
      e.allowedIn.join(", ") + (e.requiresCollider ? " (with a collider)" : ""),
      e.doc,
    ]),
  );
}

/** The catalogue entry of a code written `E5074` or `MTEK-E5074`. */
export function catalogueEntry(catalogue: readonly CatalogueEntry[], codeText: string, what: string): CatalogueEntry {
  const bare = codeText.replace(/^MTEK-/, "");
  const entry = catalogue.find((c) => c.code === bare);
  if (entry === undefined) throw new Error(`${what}: ${JSON.stringify(codeText)} is not a code of the catalogue in spec/diagnostics.md`);
  return entry;
}

/** Every diagnostic code `MTEK-Exxxx` or `MTEK-Wxxxx` mentioned in `text`, once, in order of appearance. */
export function citedCodes(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(/MTEK-([EW]\d{4})/g)) seen.add(m[1] ?? "");
  return [...seen];
}

/** `{{cited-codes}}`: a table of the codes the page mentions, with their catalogue titles. */
export function citedCodesTable(catalogue: readonly CatalogueEntry[], codes: readonly string[], prefix: string): string {
  if (codes.length === 0) return "This page cites no diagnostic code.";
  const sorted = [...codes].sort();
  return table(
    ["Code", "Title in the catalogue"],
    sorted.map((c) => {
      const entry = catalogueEntry(catalogue, c, "{{cited-codes}}");
      return [`[${code(`MTEK-${entry.code}`)}](${prefix}spec/diagnostics.md#mtek-${entry.code.toLowerCase()})`, entry.title];
    }),
  );
}

/** `{{project-default NAME}}`: `DEFAULT_NAME` of the compiler's project configuration, as a number without underscores. */
export function projectDefault(configRs: string, name: string): string {
  const m = new RegExp(`pub const DEFAULT_${name}: [A-Za-z0-9]+ = ([0-9_.]+);`).exec(configRs);
  if (m === null) throw new Error(`{{project-default ${name}}}: no "pub const DEFAULT_${name}" in crates/mtek-compiler/src/project/config.rs`);
  return (m[1] ?? "").replace(/_/g, "");
}

/** `{{intrinsics DOMAIN}}`: the intrinsics and namespace functions that run in a domain (`both`, `cpu`, `gpu`), as code. */
export function intrinsicsOf(registry: StdlibSchema, domain: string): string {
  if (domain !== "both" && domain !== "cpu" && domain !== "gpu") throw new Error(`{{intrinsics ${domain}}}: the domain is both, cpu or gpu`);
  const names = registry.intrinsics.filter((i) => i.domain === domain).map((i) => i.name);
  for (const ns of registry.namespaces) {
    for (const m of ns.members) if (m.kind === "function" && m.domain === domain) names.push(`${ns.name}.${m.name}`);
  }
  return names.sort().map((n) => code(n)).join(", ");
}

/** The camera exposure (EV100) at which an illuminance of `lux` maps a white diffuse surface to full brightness: log2(lux / (1.2 pi)). */
export function exposureForLux(lux: number): string {
  return (Math.round(Math.log2(lux / (1.2 * Math.PI)) * 10) / 10).toFixed(1);
}

/** The default `Camera.exposure` of the registry is the exposure at which 1 lux maps to 1 (`-log2(1.2 pi)`), to binary32 precision. */
export function defaultExposureHolds(registry: StdlibSchema): { text: string; expected: number } {
  const field = registry.schemas.find((s) => s.name === "Camera")?.fields.find((f) => f.name === "exposure");
  return { text: field?.default ?? "none", expected: Math.fround(-Math.log2(1.2 * Math.PI)) };
}
