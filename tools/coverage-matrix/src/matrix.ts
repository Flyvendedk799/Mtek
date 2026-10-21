// The coverage matrix and the assertions of M7-02 (decision 0093). Pure: it takes the compiled programs'
// facts, the compiler's list of features, the diagnostic fixtures and the exceptions, and answers a
// model that `render.ts` prints and `cli.ts` judges.
import { AREAS, areasOf, type Area } from "./guards.ts";
import { FORMS } from "./forms.ts";
import { DEMONSTRATIONS, OTHER_EXAMPLES, allFacts, type Analysed } from "./projects.ts";
import type { SupportedFeatures } from "./registry.ts";
import type { CodeAudit, DiagnosticFixture } from "./diagnostics.ts";

/**
 * What decision 0002 says each demonstration is for ("primary pressure"), as facts that the program
 * must exercise and the other two demonstrations must not.
 */
export const PRESSURES: Readonly<Record<string, readonly string[]>> = {
  "examples/material-configurator": ["project/host-inputs", "function:asset.glb", "project/asset:mesh-data", "fn/gpu-reachable"],
  "examples/physics-playground": [
    "entity/body",
    "entity/collider",
    "entity/sensor-collider",
    "body-command:apply_impulse",
    "event:collision_enter",
    "function:destroy",
    "project/physics-subsystem",
  ],
  // `module/cross-file-material` is not here: the configurator keeps its materials in a module of their own too.
  "examples/modular-scene": ["module/cross-file-call", "module/cross-file-prefab", "module/cross-file-spawn"],
};

export interface FeatureRow {
  id: string;
  layer: "registry" | "form";
  group: string;
  /** Wording of a form; empty for a registry feature. */
  title: string;
  ref: string;
  /** One flag per demonstration, in the order of `DEMONSTRATIONS`. */
  demos: boolean[];
  example: boolean;
  /** Fixture projects that use it, in the order of discovery. */
  fixtures: string[];
  areas: string[];
  /**
   * How many negative fixtures name the feature in the message of an expected diagnostic (the quoted
   * name of the function, schema, event, type or command); null for constructs and forms, which have no
   * name a message would quote.
   */
  named: number | null;
  /** True when no program shows it in the typed IR or the manifest, only in what the resolver recorded. */
  resolverOnly: boolean;
}

export interface Distinctness {
  demonstration: string;
  /** Facts only this demonstration exercises, sorted. */
  unique: string[];
  pressures: { id: string; own: boolean; others: string[] }[];
}

export interface NotSupportedRow {
  entry: string;
  kind: "reserved-word" | "hard-gate" | "unsupported-feature";
  code: string;
  /** What shows the neighbour is rejected: a fixture, or the registry's reservation. */
  evidence: string;
}

export interface AreaRow {
  area: Area;
  features: number;
  codes: { code: string; evidence: string }[];
}

export interface Matrix {
  languageVersion: string;
  features: FeatureRow[];
  distinct: Distinctness[];
  notSupported: NotSupportedRow[];
  areas: AreaRow[];
  /** Fixture projects that were read and passed; the ones that did not check are in `excluded`. */
  positive: number;
  excluded: { id: string; note: string }[];
  codes: CodeAudit;
  problems: string[];
}

export interface MatrixInput {
  supported: SupportedFeatures;
  projects: readonly Analysed[];
  codes: CodeAudit;
  fixtureCodes: ReadonlyMap<string, readonly DiagnosticFixture[]>;
}

/** The names a message would quote for a registry feature: `sin`, `quat.axis_angle` and `axis_angle`, `Box`. */
function namesOf(id: string): string[] {
  const colon = id.indexOf(":");
  if (colon < 0) return [];
  const name = id.slice(colon + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? [name] : [name, name.slice(dot + 1)];
}

/** Which fixtures quote a name in an expected message: name to fixture files. */
function quotedNames(fixtures: ReadonlyMap<string, readonly DiagnosticFixture[]>): Map<string, Set<string>> {
  const quoted = new Map<string, Set<string>>();
  for (const list of fixtures.values()) {
    for (const fixture of list) {
      for (const message of fixture.messages) {
        for (const match of message.matchAll(/[`'"]([A-Za-z_][A-Za-z0-9_.]*)[`'"]/g)) {
          const name = match[1] ?? "";
          const files = quoted.get(name) ?? new Set<string>();
          files.add(fixture.file);
          quoted.set(name, files);
        }
      }
    }
  }
  return quoted;
}

function groupOf(id: string): string {
  const colon = id.indexOf(":");
  if (colon > 0) return id.slice(0, colon);
  return id.includes("/") ? "" : "construct";
}

/** The fixture to cite: one named after the code (`e2033_...`) if there is one, else the first. */
function firstEvidence(fixtures: readonly DiagnosticFixture[] | undefined, code = ""): string {
  const named = code === "" ? undefined : fixtures?.find((fixture) => fixture.fixture.toLowerCase().includes(code.toLowerCase()));
  const chosen = named ?? fixtures?.[0];
  return chosen === undefined ? "" : chosen.fixture;
}

/** The reserved words, hard gates and unsupported-feature phrases of `supported.notSupported`, told apart. */
function classifyNotSupported(entry: string): NotSupportedRow["kind"] {
  if (/^[a-z_]+$/.test(entry)) return "reserved-word";
  if (/^[a-z]+(-[a-z]+)+$/.test(entry)) return "hard-gate";
  return "unsupported-feature";
}

const UNSUPPORTED_CODES: Readonly<Record<string, string>> = {
  "bitwise operators (& | ^ ~ << >>)": "E1901",
  "stage functions other than `fragment` (vertex, compute)": "E4901",
  "remote assets (URLs as asset paths)": "E7901",
  "instancing a whole node hierarchy of a glTF asset": "E7902",
};

export function buildMatrix(input: MatrixInput): Matrix {
  const problems: string[] = [];
  const demos = DEMONSTRATIONS.map((id) => input.projects.find((project) => project.id === id));
  for (const [index, demo] of demos.entries()) {
    const id = DEMONSTRATIONS[index] ?? "";
    if (demo === undefined) problems.push(`the demonstration ${id} was not read`);
    else if (!demo.ok) problems.push(`the demonstration ${id} does not compile: ${demo.note ?? ""}`);
    else if (demo.note !== null) problems.push(`the demonstration ${id} has no manifest: ${demo.note}`);
  }
  for (const id of OTHER_EXAMPLES) {
    const example = input.projects.find((project) => project.id === id);
    if (example === undefined || !example.ok) problems.push(`the example ${id} does not compile or was not read`);
  }
  const usable = input.projects.filter((project) => project.ok);
  const facts = new Map(usable.map((project) => [project.id, allFacts(project)]));

  const universe: { id: string; layer: FeatureRow["layer"]; group: string; title: string; ref: string }[] = [
    ...input.supported.features.map((id) => ({ id, layer: "registry" as const, group: groupOf(id), title: "", ref: "" })),
    ...FORMS.map((form) => ({ id: form.id, layer: "form" as const, group: form.group, title: form.title, ref: form.ref })),
  ];

  const quoted = quotedNames(input.fixtureCodes);
  const features: FeatureRow[] = universe.map((feature) => {
    const using = usable.filter((project) => facts.get(project.id)?.has(feature.id) === true);
    const viaIr = using.some((project) => project.ir.has(feature.id) || project.manifest.has(feature.id));
    return {
      ...feature,
      demos: DEMONSTRATIONS.map((id) => using.some((project) => project.id === id)),
      example: using.some((project) => project.kind === "example"),
      // The most focused program first: the one that uses the fewest facts, then by name.
      fixtures: using
        .filter((project) => project.kind === "fixture")
        .sort((a, b) => (facts.get(a.id)?.size ?? 0) - (facts.get(b.id)?.size ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((project) => project.id),
      areas: areasOf(feature.id).map((area) => area.id),
      named:
        feature.layer === "registry" && feature.id.includes(":")
          ? new Set(namesOf(feature.id).flatMap((name) => [...(quoted.get(name) ?? [])])).size
          : null,
      resolverOnly: using.length > 0 && !viaIr,
    };
  });

  // (1) Distinctness.
  const distinct: Distinctness[] = DEMONSTRATIONS.map((id) => {
    const own = facts.get(id) ?? new Set<string>();
    const others = DEMONSTRATIONS.filter((other) => other !== id).map((other) => facts.get(other) ?? new Set<string>());
    const unique = [...own].filter((fact) => others.every((set) => !set.has(fact))).sort();
    const pressures = (PRESSURES[id] ?? []).map((fact) => ({
      id: fact,
      own: own.has(fact),
      others: DEMONSTRATIONS.filter((other) => other !== id && facts.get(other)?.has(fact) === true),
    }));
    return { demonstration: id, unique, pressures };
  });
  for (const row of distinct) {
    // Only registry and form ids count: a unique fact outside both vocabularies is not a v0.1 feature.
    const known = new Set(features.map((feature) => feature.id));
    if (!row.unique.some((fact) => known.has(fact))) problems.push(`${row.demonstration} exercises no feature that the other two demonstrations do not`);
    for (const pressure of row.pressures) {
      if (!pressure.own) problems.push(`${row.demonstration} does not exercise ${pressure.id}, which decision 0002 names as its pressure`);
      if (pressure.others.length > 0) problems.push(`${pressure.id} is a pressure of ${row.demonstration} but ${pressure.others.join(", ")} also exercises it`);
    }
  }

  // (2) Every feature is covered by a demonstration or a named positive project.
  for (const feature of features) {
    const covered = feature.demos.some(Boolean) || feature.example || feature.fixtures.length > 0;
    if (!covered) problems.push(`no demonstration and no positive fixture exercises the feature ${feature.id}`);
    if (feature.areas.length === 0) problems.push(`the feature ${feature.id} belongs to no negative-test area (tools/coverage-matrix/src/guards.ts)`);
  }

  // (2b) The negative side: every area's codes are tested.
  const known = new Set(input.codes.catalogue.map((entry) => entry.code));
  const areas: AreaRow[] = AREAS.map((area) => ({
    area,
    features: features.filter((feature) => feature.areas.includes(area.id)).length,
    codes: area.codes.map((code) => {
      if (!known.has(code)) {
        problems.push(`area ${area.id} names ${code}, which is not a catalogue code`);
        return { code, evidence: "unknown code" };
      }
      const coverage = input.codes.coverage.get(code);
      if (coverage === undefined || coverage.kind === "uncovered") {
        problems.push(`area ${area.id}: ${code} has no negative test`);
        return { code, evidence: "none" };
      }
      if (coverage.kind === "fixture") return { code, evidence: firstEvidence(coverage.fixtures, code) };
      return { code, evidence: coverage.kind === "covered-elsewhere" || coverage.kind === "unreachable" ? (coverage.test ?? "") : `reserved: ${coverage.reason}` };
    }),
  }));

  // (2c) Each nearest unsupported neighbour is rejected: a reserved word by `E0013` naming it, a hard gate
  // by `E9010`, a feature of the 9xx codes by that code's fixture or reservation.
  const notSupported: NotSupportedRow[] = input.supported.notSupported.map((entry) => {
    const kind = classifyNotSupported(entry);
    if (kind === "reserved-word") {
      const fixtures = input.fixtureCodes.get("MTEK-E0013") ?? [];
      const hit = fixtures.find((fixture) => fixture.messages.some((message) => message.includes(`\`${entry}\``)));
      if (hit === undefined) problems.push(`the reserved word ${entry} has no E0013 fixture that names it`);
      return { entry, kind, code: "E0013", evidence: hit?.fixture ?? "none" };
    }
    if (kind === "hard-gate") {
      const fixtures = input.fixtureCodes.get("MTEK-E9010") ?? [];
      if (fixtures.length === 0) problems.push(`the gate ${entry} has no E9010 fixture`);
      return { entry, kind, code: "E9010", evidence: firstEvidence(fixtures, "E9010") || "none" };
    }
    const code = UNSUPPORTED_CODES[entry] ?? "";
    const coverage = code === "" ? undefined : input.codes.coverage.get(code);
    if (coverage === undefined || coverage.kind === "uncovered") {
      problems.push(`the unsupported feature "${entry}" has no code with a fixture (${code === "" ? "no code known" : code})`);
      return { entry, kind, code, evidence: "none" };
    }
    return {
      entry,
      kind,
      code,
      evidence: coverage.kind === "fixture" ? firstEvidence(coverage.fixtures, code) : coverage.kind === "reserved" ? `reserved: ${coverage.reason}` : (coverage.test ?? ""),
    };
  });

  // (3) Diagnostic codes.
  for (const code of input.codes.uncovered) problems.push(`the diagnostic code ${code} has no fail fixture, no named negative test and no registry mark`);
  problems.push(...input.codes.problems);

  const excluded = input.projects.filter((project) => !project.ok && project.kind === "fixture").map((project) => ({ id: project.id, note: project.note ?? "" }));
  return {
    languageVersion: input.supported.languageVersion,
    features,
    distinct,
    notSupported,
    areas,
    positive: usable.filter((project) => project.kind === "fixture").length,
    excluded,
    codes: input.codes,
    problems,
  };
}
