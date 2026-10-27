// The capability consistency check (decision 0101): the compiler, the registry, the runtime's ABI and
// the documents must say the same thing about what v0.1 supports. Every function here is pure: it takes
// the facts that were read and returns one `Mismatch` per disagreement, naming both sides.
import type { CatalogueEntry, Exceptions } from "../../coverage-matrix/src/diagnostics.ts";
import type { CompilerFacts } from "./compilerfacts.ts";
import { codesIn, limitationsSection, splitNotSupported, x9xxCodes } from "./limitations.ts";
import { compareSets, compareValue, mismatch, type Mismatch } from "./model.ts";
import { featureCountInReference, featuresInReference } from "./reference.ts";
import { plannedRows, registryFeatures, type StdlibSchema } from "./registry.ts";
import type { RuntimeFacts } from "./runtimefacts.ts";
import { snakeCase } from "./runtimefacts.ts";
import { abiBodyHandleMethods, abiCodecIds, abiSpecConstants, languageWordLists, section, stdlibEvents, stdlibIntrinsicNames, stdlibKeyCodes, stdlibNamespaceMembers } from "./spectext.ts";

/** Compare each of `others` with the first entry (the anchor), one finding per difference. */
export function compareAll(check: string, entries: readonly { where: string; value: string | undefined }[], detail = ""): Mismatch[] {
  const [anchor, ...others] = entries;
  if (anchor === undefined) return [];
  const found: Mismatch[] = [];
  const side = (e: { where: string; value: string | undefined }): { where: string; value: string } => ({ where: e.where, value: e.value ?? "nothing (not found)" });
  for (const other of others) {
    if (other.value !== anchor.value) found.push(mismatch(check, side(anchor), side(other), detail));
  }
  return found;
}

// ---- features: the compiler against the registry and the specification --------------------------------

export interface FeatureInputs {
  compiler: CompilerFacts;
  registry: StdlibSchema;
  milestone: string | null;
  languageMd: string;
  catalogue: readonly CatalogueEntry[];
}

export function checkFeatures(i: FeatureInputs): Mismatch[] {
  const found: Mismatch[] = [];
  const context = "mtek context (supported.features)";
  if (i.milestone === null) {
    found.push(
      mismatch("features/milestone", { where: "crates/mtek-compiler/src/stdlib/model.rs", value: "no CURRENT_MILESTONE constant" }, { where: "tools/release-docs", value: "a milestone to compare the registry rows with" }),
    );
    return found;
  }
  const fromCompiler = i.compiler.features.filter((f) => f.includes(":"));
  const fromRegistry = registryFeatures(i.registry, i.milestone);
  found.push(
    ...compareSets(
      "features/registry-rows",
      "feature",
      { where: context, items: fromCompiler },
      { where: `spec/stdlib-schema.json (every row reached by ${i.milestone})`, items: fromRegistry },
    ),
  );
  const planned = i.compiler.notSupported.filter((n) => /\(planned for M\d+\)$/.test(n) && n.includes(":")).map((n) => n.replace(/ \(planned for M\d+\)$/, ""));
  found.push(
    ...compareSets(
      "features/planned-rows",
      "planned feature",
      { where: "mtek context (supported.notSupported)", items: planned },
      { where: `spec/stdlib-schema.json (every row after ${i.milestone})`, items: plannedRows(i.registry, i.milestone) },
    ),
  );
  found.push(
    ...compareValue(
      "features/language-version",
      { where: "mtek context (languageVersion)", value: i.compiler.contextLanguage },
      { where: "spec/stdlib-schema.json (languageVersion)", value: i.registry.languageVersion },
    ),
  );
  const words = languageWordLists(i.languageMd).reserved;
  const contextWords = i.compiler.notSupported.filter((n) => /^[a-z]+$/.test(n));
  found.push(
    ...compareSets(
      "features/reserved-words",
      "reserved word",
      { where: "mtek context (supported.notSupported)", items: contextWords },
      { where: "spec/language.md 2.3 (reserved for future use)", items: words },
    ),
  );
  // A retired x9xx code (E5901 by decision 0141, E5902 by decision 0138) names a feature that is now supported.
  const unsupported = x9xxCodes(i.catalogue).unsupported.filter((entry) => !/retired by decision/.test(entry.trigger));
  const phrases = splitNotSupported(i.compiler.notSupported, words).phrases;
  if (phrases.length !== unsupported.length) {
    found.push(
      mismatch(
        "features/unsupported-codes",
        { where: "mtek context (supported.notSupported, one phrase per unsupported feature)", value: `${String(phrases.length)} phrases` },
        { where: "spec/diagnostics.md catalogue (x9xx codes other than E9999)", value: `${String(unsupported.length)} codes` },
        `the codes are ${unsupported.map((u) => u.code).join(" ")}`,
      ),
    );
  }
  const seen = new Set<string>();
  for (const f of i.compiler.features) {
    if (seen.has(f)) found.push(mismatch("features/duplicate", { where: context, value: `${f} listed twice` }, { where: context, value: "each feature once" }));
    seen.add(f);
  }
  return found;
}

// ---- the generated documents against the compiler ---------------------------------------------------

export interface DocInputs {
  compiler: CompilerFacts;
  catalogue: readonly CatalogueEntry[];
  exceptions: Exceptions;
  reservedWords: readonly string[];
  hardGateNames: readonly string[];
  /** Committed docs/language-reference.md and docs/limitations.md; null when missing. */
  reference: string | null;
  limitations: string | null;
}

export function checkGeneratedDocs(i: DocInputs): Mismatch[] {
  const found: Mismatch[] = [];
  const refWhere = "docs/language-reference.md (Part C)";
  if (i.reference === null) {
    found.push(mismatch("docs/reference", { where: "tools/release-docs", value: "docs/language-reference.md exists" }, { where: "docs/", value: "no such file" }));
  } else {
    found.push(
      ...compareSets(
        "docs/reference-features",
        "feature",
        { where: "mtek context (supported.features)", items: i.compiler.features },
        { where: refWhere, items: featuresInReference(i.reference) },
      ),
    );
    found.push(
      ...compareValue(
        "docs/reference-feature-count",
        { where: "mtek context (supported.features)", value: `${String(i.compiler.features.length)} features` },
        { where: "docs/language-reference.md (heading of Part C)", value: `${String(featureCountInReference(i.reference))} features` },
      ),
    );
  }
  const limWhere = "docs/limitations.md";
  if (i.limitations === null) {
    found.push(mismatch("docs/limitations", { where: "tools/release-docs", value: "docs/limitations.md exists" }, { where: "docs/", value: "no such file" }));
    return found;
  }
  const lim = i.limitations;
  const { unsupported } = x9xxCodes(i.catalogue);
  const tableCodes = (sectionText: string): string[] => [...sectionText.matchAll(/^\| `([EW]\d{4})` \|/gm)].map((m) => m[1] ?? "");
  found.push(
    ...compareSets(
      "limitations/x9xx",
      "x9xx code",
      { where: "spec/diagnostics.md catalogue (codes of the form x9xx)", items: unsupported.map((u) => u.code) },
      { where: `${limWhere} section 2`, items: tableCodes(limitationsSection(lim, "## 2.")) },
    ),
  );
  const known = new Set(i.catalogue.map((c) => c.code));
  for (const c of codesIn(lim)) {
    if (!known.has(c)) found.push(mismatch("limitations/unknown-code", { where: limWhere, value: `mentions ${c}` }, { where: "spec/diagnostics.md catalogue", value: `no code ${c}` }));
  }
  const bullets = (sectionText: string): string[] => [...sectionText.matchAll(/^- (`+) ?(.*?) ?\1$/gm)].map((m) => m[2] ?? "");
  found.push(
    ...compareSets(
      "limitations/not-supported-list",
      "item",
      { where: "mtek context (supported.notSupported)", items: i.compiler.notSupported },
      { where: `${limWhere} section 7`, items: bullets(limitationsSection(lim, "## 7.")) },
    ),
  );
  const gates = [...limitationsSection(lim, "## 3.").matchAll(/^### `([^`]+)`$/gm)].map((m) => m[1] ?? "");
  found.push(
    ...compareSets(
      "limitations/gates",
      "gate",
      { where: "mtek context (supported.notSupported, the gates)", items: i.hardGateNames },
      { where: `${limWhere} section 3`, items: gates },
    ),
  );
  const words = [...(limitationsSection(lim, "## 4.").split("\n").find((l) => l.startsWith("`")) ?? "").matchAll(/`([a-z_]+)`/g)].map((m) => m[1] ?? "");
  found.push(
    ...compareSets(
      "limitations/reserved-words",
      "reserved word",
      { where: "spec/language.md 2.3 (reserved for future use)", items: i.reservedWords },
      { where: `${limWhere} section 4`, items: words },
    ),
  );
  found.push(
    ...compareSets(
      "limitations/specified-not-produced",
      "code",
      { where: "tests/semantics/code-coverage-exceptions.json (reserved)", items: i.exceptions.reserved.map((e) => e.code) },
      { where: `${limWhere} section 5`, items: tableCodes(limitationsSection(lim, "## 5.")) },
    ),
  );
  const marked = i.catalogue.filter((c) => c.mark !== null).map((c) => c.code);
  found.push(
    ...compareSets(
      "limitations/catalogue-marks",
      "code",
      { where: "spec/diagnostics.md catalogue (rows marked Reserved or Not implemented)", items: marked },
      { where: "tests/semantics/code-coverage-exceptions.json (reserved)", items: i.exceptions.reserved.map((e) => e.code) },
    ),
  );
  return found;
}

// ---- W0030: the lint the specification promised and the build does not have -----------------------------

export interface NamingLintInputs {
  catalogue: readonly CatalogueEntry[];
  exceptions: Exceptions;
  languageMd: string;
  limitations: string | null;
}

export function checkNamingLint(i: NamingLintInputs): Mismatch[] {
  const found: Mismatch[] = [];
  const row = i.catalogue.find((c) => c.code === "W0030");
  const says = (where: string, notImplemented: boolean | undefined): { where: string; value: string } => ({
    where,
    value: notImplemented === undefined ? "nothing about W0030" : notImplemented ? "W0030 is not implemented" : "W0030 is enforced",
  });
  const reference = says("spec/diagnostics.md (catalogue row W0030)", row === undefined ? undefined : row.mark === "not-implemented");
  const sources: { where: string; value: boolean | undefined }[] = [
    { where: "tests/semantics/code-coverage-exceptions.json (reserved)", value: i.exceptions.reserved.some((e) => e.code === "W0030") ? true : undefined },
  ];
  const s33 = (() => {
    try {
      return section(i.languageMd, "## 3. Program structure").split("3.3 ")[1]?.split("\n\n")[0] ?? "";
    } catch {
      return "";
    }
  })();
  const stillPromises = /formatter's lint \(`W0030`\) warns/.test(s33);
  const admits = /not part of v0\.1/.test(s33) && s33.includes("W0030");
  sources.push({ where: "spec/language.md 3.3 (naming conventions)", value: stillPromises ? false : admits ? true : undefined });
  sources.push({ where: "docs/limitations.md (section 5)", value: i.limitations === null ? undefined : limitationsSection(i.limitations, "## 5.").includes("`W0030`") ? true : undefined });
  for (const s of sources) {
    const side = says(s.where, s.value);
    if (side.value !== reference.value) found.push(mismatch("naming-lint/w0030", reference, side));
  }
  return found;
}

// ---- the ABI: the constants and the capabilities --------------------------------------------------------

export interface AbiInputs {
  compiler: CompilerFacts;
  runtime: RuntimeFacts;
  runtimeAbiMd: string;
  toolingMd: string;
  manifestSchemaJson: string;
  manifestTypesTs: string;
  registry: StdlibSchema;
  readme: string;
}

export function checkAbiConstants(i: AbiInputs): Mismatch[] {
  const spec = abiSpecConstants(i.runtimeAbiMd);
  const schema = JSON.parse(i.manifestSchemaJson) as { $id?: string; title?: string; properties: { targetProfile: { enum: string[] } }; $defs: { requiredCapabilities: unknown } };
  const m = i.compiler.manifest;
  const text = (v: unknown): string | undefined => (v === undefined ? undefined : typeof v === "string" ? v : JSON.stringify(v));
  const found: Mismatch[] = [];
  const schemaTitleAbi = /runtime ABI (\d+)/.exec(schema.title ?? "")?.[1];
  const schemaTitleSchema = /schema version (\d+)/.exec(schema.title ?? "")?.[1];
  const schemaIdVersion = /:(\d+)$/.exec(schema.$id ?? "")?.[1];
  const toolingLine = /prints `(mtek [^`]+)`/.exec(i.toolingMd)?.[1];
  const readmeVersion = /prints `(mtek [^`]+)`/.exec(i.readme)?.[1];
  found.push(
    ...compareAll("abi/runtime-abi", [
      { where: "mtek --version (runtime ABI)", value: i.compiler.versionAbi },
      { where: `program.manifest.json of ${m.project} (runtimeAbi)`, value: text(m.runtimeAbi) },
      { where: `app.js of ${m.project} (export const abi)`, value: m.appAbi },
      { where: "packages/runtime-web/src/abi/constants.ts (SUPPORTED_RUNTIME_ABI)", value: String(i.runtime.runtimeAbi) },
      { where: "packages/runtime-web/src/core.ts (RUNTIME_ABI)", value: i.runtime.indexRuntimeAbi === null ? undefined : String(i.runtime.indexRuntimeAbi) },
      { where: "packages/runtime-web/src/runtime.d.ts (readonly abi)", value: i.runtime.declaredAbi },
      { where: "spec/runtime-abi.md (status line)", value: spec.headerAbi },
      { where: "spec/runtime-abi.md section 5 (example manifest, runtimeAbi)", value: spec.exampleAbi },
      { where: "spec/runtime-abi.md section 5.1 (runtimes implement exactly)", value: spec.exactAbi },
      { where: "spec/manifest.schema.json (title)", value: schemaTitleAbi },
    ]),
  );
  found.push(
    ...compareAll("abi/manifest-schema", [
      { where: `program.manifest.json of ${m.project} (manifestSchema)`, value: text(m.manifestSchema) },
      { where: "packages/runtime-web/src/abi/constants.ts (SUPPORTED_MANIFEST_SCHEMA)", value: String(i.runtime.manifestSchema) },
      { where: "spec/runtime-abi.md (status line)", value: spec.headerSchema },
      { where: "spec/runtime-abi.md section 5 (example manifest, manifestSchema)", value: spec.exampleSchema },
      { where: "spec/runtime-abi.md section 5.1 (runtimes implement exactly)", value: spec.exactSchema },
      { where: "spec/manifest.schema.json (title)", value: schemaTitleSchema },
      { where: "spec/manifest.schema.json ($id)", value: schemaIdVersion },
    ]),
  );
  found.push(
    ...compareAll("abi/language-version", [
      { where: "mtek context (languageVersion)", value: i.compiler.contextLanguage },
      { where: "mtek --version (language)", value: i.compiler.versionLanguage },
      { where: `program.manifest.json of ${m.project} (languageVersion)`, value: text(m.languageVersion) },
      { where: "spec/stdlib-schema.json (languageVersion)", value: i.registry.languageVersion },
      { where: "packages/runtime-web/src/abi/constants.ts (SUPPORTED_LANGUAGE_VERSION)", value: i.runtime.languageVersion },
      { where: "spec/runtime-abi.md section 5 (example manifest, languageVersion)", value: spec.exampleLanguage },
      { where: "spec/runtime-abi.md section 5.1 (runtimes implement exactly)", value: spec.exactLanguage },
    ]),
  );
  found.push(
    ...compareAll("abi/version-line", [
      { where: "mtek --version", value: i.compiler.versionLine },
      { where: "README.md (the line `mtek --version` prints)", value: readmeVersion },
      { where: "spec/tooling.md (the line `mtek --version` prints)", value: toolingLine },
    ]),
  );
  const profileInTypes = /targetProfile:\s*"([^"]+)"/.exec(i.manifestTypesTs)?.[1];
  found.push(
    ...compareAll("abi/target-profile", [
      { where: `program.manifest.json of ${m.project} (targetProfile)`, value: text(m.targetProfile) },
      { where: "spec/manifest.schema.json (targetProfile enum)", value: schema.properties.targetProfile.enum.join(", ") },
      { where: "spec/runtime-abi.md section 5 (example manifest, targetProfile)", value: spec.exampleProfile },
      { where: "packages/runtime-web/src/abi/manifest-types.ts (targetProfile)", value: profileInTypes },
    ]),
  );
  const normalise = (jsonText: string | undefined): string | undefined => {
    if (jsonText === undefined) return undefined;
    try {
      return JSON.stringify(JSON.parse(jsonText));
    } catch {
      return jsonText;
    }
  };
  found.push(
    ...compareAll("abi/required-capabilities", [
      { where: `program.manifest.json of ${m.project} (requiredCapabilities)`, value: normalise(m.requiredCapabilities) },
      { where: "spec/runtime-abi.md section 5 (example manifest, requiredCapabilities)", value: normalise(spec.exampleCapabilities) },
    ]),
  );
  return found;
}

export interface RuntimeInputs {
  compiler: CompilerFacts;
  runtime: RuntimeFacts;
  registry: StdlibSchema;
  stdlibMd: string;
  runtimeAbiMd: string;
  manifestSchemaJson: string;
}

export function checkRuntimeCapabilities(i: RuntimeInputs): Mismatch[] {
  const found: Mismatch[] = [];
  const keyEnum = i.registry.enums.find((e) => e.name === "Key");
  found.push(
    ...compareSets(
      "runtime/key-codes",
      "key code",
      { where: "spec/stdlib-schema.json (enum Key)", items: (keyEnum?.members ?? []).map((k) => k.code) },
      { where: "packages/runtime-web/src/input/keys.ts (MAPPED_KEY_CODES)", items: i.runtime.keyCodes },
    ),
  );
  found.push(
    ...compareSets(
      "runtime/key-codes-spec",
      "key code",
      { where: "spec/stdlib.md 5.2 (the Key table)", items: stdlibKeyCodes(i.stdlibMd) },
      { where: "packages/runtime-web/src/input/keys.ts (MAPPED_KEY_CODES)", items: i.runtime.keyCodes },
    ),
  );
  const registryEvents = i.registry.events.map((e) => e.name);
  found.push(
    ...compareSets(
      "runtime/events",
      "event",
      { where: "spec/stdlib-schema.json (events)", items: registryEvents },
      { where: "packages/runtime-web/src/scene/dynamic.ts (INPUT_EVENTS, COLLISION_EVENTS, ENTITY_EVENTS)", items: [...i.runtime.inputEvents, ...i.runtime.collisionEvents, ...i.runtime.entityEvents] },
    ),
  );
  found.push(
    ...compareSets(
      "runtime/events-spec",
      "event",
      { where: "spec/stdlib.md 5.1 (the events table)", items: stdlibEvents(i.stdlibMd) },
      { where: "spec/stdlib-schema.json (events)", items: registryEvents },
    ),
  );
  const schemaCodecs = (JSON.parse(i.manifestSchemaJson) as { $defs: { hostInput: { properties: { codec: { enum: string[] } } } } }).$defs.hostInput.properties.codec.enum;
  found.push(
    ...compareSets(
      "runtime/host-codecs",
      "host input codec",
      { where: "spec/manifest.schema.json (hostInput.codec enum)", items: schemaCodecs },
      { where: "packages/runtime-web/src/host/codecs.ts (decodeHostInput answers for it)", items: i.runtime.implementedCodecs },
    ),
  );
  found.push(
    ...compareSets(
      "runtime/host-codecs-spec",
      "host input codec",
      { where: "spec/runtime-abi.md 6.3 (the codec table)", items: abiCodecIds(i.runtimeAbiMd) },
      { where: "spec/manifest.schema.json (hostInput.codec enum)", items: schemaCodecs },
    ),
  );
  found.push(
    ...compareSets(
      "runtime/host-codecs-emitted",
      "host input codec",
      { where: "the manifests the compiler wrote for the examples", items: i.compiler.manifest.codecs },
      { where: "packages/runtime-web/src/host/codecs.ts (decodeHostInput answers for it)", items: i.runtime.implementedCodecs },
    ).filter((m) => m.right.value.startsWith("no such")),
  );
  const registryBody = [...i.registry.bodyCommands.map((c) => c.name), ...i.registry.bodyProperties.map((p) => p.name)];
  found.push(
    ...compareSets(
      "runtime/body-handle",
      "body command or property",
      { where: "spec/stdlib-schema.json (bodyCommands, bodyProperties)", items: registryBody },
      { where: "packages/runtime-web/src/physics/system.ts (BodyHandleImpl)", items: i.runtime.bodyHandleMembers },
    ),
  );
  found.push(
    ...compareSets(
      "runtime/body-handle-spec",
      "body command or property",
      { where: "spec/runtime-abi.md 4.2 (ctx.body row)", items: abiBodyHandleMethods(i.runtimeAbiMd).map(snakeCase) },
      { where: "packages/runtime-web/src/physics/system.ts (BodyHandleImpl)", items: i.runtime.bodyHandleMembers },
    ),
  );
  return found;
}

export interface StdlibDocInputs {
  registry: StdlibSchema;
  stdlibMd: string;
}

/** spec/stdlib.md against the registry it describes (intrinsics and namespace members). */
export function checkStdlibDoc(i: StdlibDocInputs): Mismatch[] {
  const found: Mismatch[] = [];
  found.push(
    ...compareSets(
      "stdlib/intrinsics",
      "intrinsic",
      { where: "spec/stdlib-schema.json (intrinsics)", items: i.registry.intrinsics.map((f) => f.name) },
      { where: "spec/stdlib.md 6 (the intrinsic table)", items: stdlibIntrinsicNames(i.stdlibMd) },
    ),
  );
  const members = i.registry.namespaces.filter((n) => n.name !== "Key").flatMap((n) => n.members.map((m) => `${n.name}.${m.name}`));
  found.push(
    ...compareSets(
      "stdlib/namespace-members",
      "namespace member",
      { where: "spec/stdlib-schema.json (namespaces)", items: members },
      { where: "spec/stdlib.md 2 (the namespace table)", items: stdlibNamespaceMembers(i.stdlibMd) },
    ),
  );
  return found;
}

// ---- the claims of the hand-written documents ---------------------------------------------------------

export interface ReadmeInputs {
  readme: string;
  specReadme: string;
  gettingStarted: string;
  compiler: CompilerFacts;
  /** The `scripts` of the root package.json. */
  rootScripts: Readonly<Record<string, string>>;
  exampleDirs: readonly string[];
  rustToolchain: string;
  nvmrc: string;
  /** The file names in spec/decisions. */
  decisionFiles: readonly string[];
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11 };

export function checkReadmeClaims(i: ReadmeInputs): Mismatch[] {
  const found: Mismatch[] = [];
  const readmeCommands = [...(i.readme.split("## The `mtek` command")[1] ?? "").matchAll(/^\| `mtek ([a-z]+)/gm)].map((m) => m[1] ?? "");
  found.push(
    ...compareSets(
      "readme/commands",
      "command",
      { where: "mtek --help", items: i.compiler.subcommands },
      { where: "README.md (table of The `mtek` command)", items: readmeCommands },
    ),
  );
  const exampleRows = [...(i.readme.split("### Examples")[1]?.split("\n### ")[0] ?? "").matchAll(/^\| \[`examples\/([a-z-]+)`\]/gm)].map((m) => m[1] ?? "");
  found.push(
    ...compareSets(
      "readme/examples",
      "example",
      { where: "the examples/ directory (every directory with an mtek.toml)", items: i.exampleDirs },
      { where: "README.md (table of Examples)", items: exampleRows },
    ),
  );
  const claimed = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s+examples\b/.exec(i.readme);
  if (claimed !== null) {
    found.push(
      ...compareValue(
        "readme/example-count",
        { where: "the examples/ directory", value: `${String(i.exampleDirs.length)} examples` },
        { where: "README.md (Status)", value: `${String(NUMBER_WORDS[claimed[1] ?? ""] ?? "?")} examples` },
      ),
    );
  }
  const claimedFixtures = /the (one|two|three|four|five|six|seven|eight|nine|ten|eleven) examples have theirs/.exec(i.readme);
  if (claimedFixtures !== null) {
    found.push(
      ...compareValue(
        "readme/example-count-mtek-test",
        { where: "the examples/ directory", value: `${String(i.exampleDirs.length)} examples` },
        { where: "README.md (mtek test)", value: `${String(NUMBER_WORDS[claimedFixtures[1] ?? ""] ?? "?")} examples` },
      ),
    );
  }
  // `npm run NAME -w WORKSPACE` names a script of a workspace, not of the root.
  const mentioned = new Set([...i.readme.matchAll(/npm run ([a-z:-]+)( -w \S+)?/g)].filter((m) => m[2] === undefined).map((m) => m[1] ?? ""));
  const scripts = new Set(Object.keys(i.rootScripts));
  for (const name of [...mentioned].sort()) {
    if (!scripts.has(name)) found.push(mismatch("readme/npm-scripts", { where: "README.md", value: `npm run ${name}` }, { where: "package.json (scripts)", value: "no such script" }));
  }
  for (const name of [...scripts].sort()) {
    if (name === "test") continue;
    if (!mentioned.has(name)) found.push(mismatch("readme/npm-scripts", { where: "package.json (scripts)", value: `npm run ${name}` }, { where: "README.md", value: "does not mention it" }));
  }
  for (const [script, rowStart] of [["check", "| `npm run check` |"], ["test", "| `npm test` |"]] as const) {
    const row = i.readme.split("\n").find((line) => line.startsWith(rowStart)) ?? "";
    for (const step of (i.rootScripts[script] ?? "").split(" && ")) {
      const token = step.replace(/^npm run /, "").trim();
      if (!row.includes(token)) {
        found.push(mismatch(`readme/${script}-steps`, { where: "package.json (scripts." + script + ")", value: `runs ${JSON.stringify(token)}` }, { where: "README.md (the row of " + rowStart.slice(2, -2) + ")", value: "does not name it" }));
      }
    }
  }
  const rust = /channel\s*=\s*"([^"]+)"/.exec(i.rustToolchain)?.[1];
  const node = /^v?(\d+)/.exec(i.nvmrc.trim())?.[1];
  found.push(
    ...compareAll("readme/toolchain", [
      { where: "rust-toolchain.toml (channel)", value: rust },
      { where: "README.md (Requirements, Rust)", value: /Rust \*\*([\d.]+)\*\*/.exec(i.readme)?.[1] },
      { where: "docs/getting-started.md (Prerequisites, Rust)", value: /\*\*(\d+\.\d+\.\d+)\*\* \(rustup/.exec(i.gettingStarted)?.[1] },
    ]),
  );
  found.push(
    ...compareAll("readme/node-version", [
      { where: ".nvmrc", value: node },
      { where: "README.md (Requirements, Node.js)", value: /Node\.js \*\*(\d+)\*\*/.exec(i.readme)?.[1] },
      { where: "docs/getting-started.md (Prerequisites, Node.js)", value: /Node\.js with npm \| \*\*(\d+)\*\*/.exec(i.gettingStarted)?.[1] },
    ]),
  );
  const claimedRange = /Decision records (\d{4})[–-](\d{4})/.exec(i.specReadme);
  if (claimedRange !== null) {
    const numbers = i.decisionFiles.map((f) => f.slice(0, 4)).sort();
    found.push(
      ...compareValue(
        "readme/decision-range",
        { where: "spec/decisions (the files)", value: `${numbers[0] ?? "?"}-${numbers[numbers.length - 1] ?? "?"}` },
        { where: "spec/README.md (the decisions/ row)", value: `${claimedRange[1] ?? "?"}-${claimedRange[2] ?? "?"}` },
      ),
    );
  }
  if (/Nothing described here is implemented yet/.test(i.specReadme)) {
    found.push(
      mismatch(
        "readme/spec-status",
        { where: "spec/README.md", value: "\"Nothing described here is implemented yet\"" },
        { where: "mtek --version and docs/limitations.md", value: `${i.compiler.versionLine}; ${String(i.compiler.features.length)} supported features` },
      ),
    );
  }
  return found;
}
