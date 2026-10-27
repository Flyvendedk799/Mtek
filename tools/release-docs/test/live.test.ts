// The consistency check over the real repository (decisions 0100, 0101, 0104).
//
// The first block says that the repository is consistent *now*: no mismatch of any comparison and no
// stale generated document. The second block proves that each comparison can fail: it corrupts one
// side of the comparison in memory and expects a finding whose message names both sides. A comparison
// that cannot fail is not a comparison.
//
// These tests need the built compiler (`npm run build`); without one they are skipped here and the CI
// job `node` runs them after its build (and runs `npm run check:release`, which exits 3 without one).
import { describe, expect, it, beforeAll } from "vitest";
import { findMtek, repoRoot } from "../../coverage-matrix/src/tools.ts";
import { loadCtx, type Ctx } from "../src/ctx.ts";
import { generateDocs, staleDocs } from "../src/docs.ts";
import { validateLimitationsData } from "../src/limitations.ts";
import type { Mismatch } from "../src/model.ts";
import { checkDocCode } from "../src/doccode.ts";
import { GUIDE_MAX_BYTES } from "../src/docpages.ts";
import { buildInputs, checkInputs, codePages, loadRuntime, runDocCode, type Inputs } from "../src/run.ts";
import type { RuntimeFacts } from "../src/runtimefacts.ts";

const root = repoRoot();
const mtek = findMtek();
const live = mtek === null ? describe.skip : describe;

let ctx: Ctx;
let runtime: RuntimeFacts;
let base: Inputs;

beforeAll(async () => {
  if (mtek === null) return;
  ctx = await loadCtx(root, mtek);
  runtime = await loadRuntime(ctx);
  base = buildInputs(ctx, runtime);
}, 180_000);

function find(found: readonly Mismatch[], check: string): Mismatch[] {
  return found.filter((m) => m.check === check);
}

/** The finding of `check` exists and its message names both places. */
function expectNamesBoth(found: readonly Mismatch[], check: string, left: string, right: string): void {
  const hits = find(found, check);
  expect(hits.length, `${check} must report a mismatch; got ${JSON.stringify(found.map((m) => m.message))}`).toBeGreaterThan(0);
  const named = hits.find((m) => m.message.includes(left) && m.message.includes(right));
  expect(named, `no ${check} finding names both ${JSON.stringify(left)} and ${JSON.stringify(right)}: ${JSON.stringify(hits.map((m) => m.message))}`).toBeDefined();
}

function without(items: readonly string[], drop: string): string[] {
  expect(items).toContain(drop);
  return items.filter((i) => i !== drop);
}

function replaceOnce(text: string, from: string | RegExp, to: string): string {
  const changed = text.replace(from, to);
  expect(changed, `the mutation ${String(from)} did not change the text`).not.toBe(text);
  return changed;
}

live("the repository is consistent", () => {
  it("every comparison holds", () => {
    expect(checkInputs(base).map((m) => m.message)).toEqual([]);
  });

  it("the hand-written limitations data is anchored", () => {
    expect(validateLimitationsData(ctx).map((m) => m.message)).toEqual([]);
  });

  it("the generated documents are what the generator writes", () => {
    expect(staleDocs(root, generateDocs(ctx)).map((m) => m.message)).toEqual([]);
  });

  it("states the facts it compares: the compiler lists features, six x9xx codes and the ABI", () => {
    expect(ctx.compiler.features.length).toBeGreaterThan(100);
    expect(ctx.compiler.versionAbi).toBe("1");
    expect(runtime.implementedCodecs.length).toBe(10);
    expect(runtime.keyCodes).toContain("Space");
  });
});

live("the documentation (decisions 0116 to 0118)", () => {
  it("writes the index, the tutorial, the concept pages and a guide of at most 16 384 bytes", () => {
    const docs = generateDocs(ctx);
    const paths = [...docs.keys()];
    expect(paths).toContain("docs/README.md");
    expect(paths).toContain("docs/tutorial.md");
    expect(paths.filter((p) => p.startsWith("docs/concepts/")).length).toBeGreaterThanOrEqual(11);
    expect(Buffer.byteLength(docs.get("docs/language-guide.md") ?? "", "utf8")).toBeLessThanOrEqual(GUIDE_MAX_BYTES);
  });

  it("compiles every code block of every page with the built compiler", async () => {
    const found = await runDocCode(ctx);
    expect(found.map((m) => m.message)).toEqual([]);
    const blocks = codePages(ctx).flatMap((p) => p.text.split("\n").filter((l) => /^```mtek/.test(l)));
    expect(blocks.length).toBeGreaterThan(100);
    expect(blocks.filter((l) => l.includes("wrong=")).length).toBeGreaterThan(40);
  }, 600_000);

  it("fails a page whose wrong block raises another code than it says, naming both", async () => {
    const page = codePages(ctx).find((p) => p.path === "docs/concepts/state-and-bindings.md");
    expect(page).toBeDefined();
    const text = (page?.text ?? "").replace("```mtek wrong=MTEK-E5070", "```mtek wrong=MTEK-E5075");
    const found = await checkDocCode({ root, mtek: mtek ?? "", language: ctx.compiler.contextLanguage }, [{ path: "docs/concepts/state-and-bindings.md", text }]);
    expectNamesBoth(found, "docs/code", "errors exactly MTEK-E5075", "MTEK-E5070");
  }, 120_000);

  it("fails a program that stopped compiling", async () => {
    const text = "```mtek\nscene A {\n    camera Main {\n        position: vec3(0.0, 2.0, 5.0);\n    }\n    entity E {\n        mesh: Box {};\n        position: 1.0;\n    }\n}\n```\n";
    const found = await checkDocCode({ root, mtek: mtek ?? "", language: ctx.compiler.contextLanguage }, [{ path: "docs/p.md", text }]);
    expectNamesBoth(found, "docs/code", "a program that compiles", "MTEK-");
  }, 120_000);

  it("fails a link to a page that does not exist, an anchor that no heading has, and a page left out of the index", () => {
    const pages = base.docPages.pages.map((p) => (p.path === "docs/concepts/physics.md" ? { ...p, text: `${p.text}\n[x](#no-such-heading)\n` } : p));
    const index = pages.map((p) => (p.path === "docs/README.md" ? { ...p, text: p.text.replace("concepts/physics.md", "concepts/physics-gone.md") } : p));
    const found = checkInputs({ ...base, docPages: { ...base.docPages, pages: index } });
    expectNamesBoth(found, "docs/anchors", "docs/concepts/physics.md line", "#no-such-heading");
    expectNamesBoth(found, "docs/index", "docs/README.md", "docs/concepts/physics.md");
  });
});

live("compiler against registry and specification (decision 0101, features/*)", () => {
  it("a feature the compiler lacks fails features/registry-rows", () => {
    const features = without(base.features.compiler.features, "event:key_up");
    const found = checkInputs({ ...base, features: { ...base.features, compiler: { ...base.features.compiler, features } } });
    expectNamesBoth(found, "features/registry-rows", "mtek context (supported.features)", "spec/stdlib-schema.json");
  });

  it("a registry row the compiler does not list fails features/registry-rows the other way", () => {
    const registry = { ...base.features.registry, events: base.features.registry.events.filter((e) => e.name !== "pointer_move") };
    const found = checkInputs({ ...base, features: { ...base.features, registry } });
    expectNamesBoth(found, "features/registry-rows", "mtek context (supported.features)", "spec/stdlib-schema.json");
  });

  it("a changed language version fails features/language-version", () => {
    const registry = { ...base.features.registry, languageVersion: "0.2" };
    const found = checkInputs({ ...base, features: { ...base.features, registry } });
    expectNamesBoth(found, "features/language-version", "mtek context (languageVersion)", "spec/stdlib-schema.json");
  });

  it("a reserved word missing from the specification fails features/reserved-words", () => {
    const languageMd = replaceOnce(base.features.languageMd, /yield\s+/, "");
    const found = checkInputs({ ...base, features: { ...base.features, languageMd } });
    expectNamesBoth(found, "features/reserved-words", "mtek context (supported.notSupported)", "spec/language.md 2.3");
  });

  it("an x9xx code the compiler has no phrase for fails features/unsupported-codes", () => {
    const catalogue = [...base.features.catalogue, { code: "E6901", title: "invented not supported", trigger: "", mark: null }];
    const found = checkInputs({ ...base, features: { ...base.features, catalogue } });
    expectNamesBoth(found, "features/unsupported-codes", "mtek context", "spec/diagnostics.md catalogue");
  });
});

live("the generated documents against the compiler (docs/*, limitations/*)", () => {
  it("a feature missing from the language reference fails docs/reference-features", () => {
    const reference = replaceOnce(base.docs.reference ?? "", "`event:key_up` ", "");
    const found = checkInputs({ ...base, docs: { ...base.docs, reference } });
    expectNamesBoth(found, "docs/reference-features", "mtek context (supported.features)", "docs/language-reference.md");
  });

  it("a wrong feature count in the heading fails docs/reference-feature-count", () => {
    const reference = replaceOnce(base.docs.reference ?? "", /Features of this build \(\d+\)/, "Features of this build (7)");
    const found = checkInputs({ ...base, docs: { ...base.docs, reference } });
    expectNamesBoth(found, "docs/reference-feature-count", "mtek context", "docs/language-reference.md");
  });

  it("an x9xx row missing from the limitations page fails limitations/x9xx", () => {
    const limitations = replaceOnce(base.docs.limitations ?? "", /^\| `E7901` \|.*\n/m, "");
    const found = checkInputs({ ...base, docs: { ...base.docs, limitations }, naming: { ...base.naming, limitations } });
    expectNamesBoth(found, "limitations/x9xx", "spec/diagnostics.md catalogue", "docs/limitations.md section 2");
  });

  it("a code the catalogue does not have fails limitations/unknown-code", () => {
    const limitations = `${base.docs.limitations ?? ""}\nSee also E4242.\n`;
    const found = checkInputs({ ...base, docs: { ...base.docs, limitations } });
    expectNamesBoth(found, "limitations/unknown-code", "docs/limitations.md", "spec/diagnostics.md catalogue");
  });

  it("the gate missing from the limitations page fails limitations/gates", () => {
    const limitations = replaceOnce(base.docs.limitations ?? "", "### `non-constant-initial-values`", "### `something-else`");
    const found = checkInputs({ ...base, docs: { ...base.docs, limitations } });
    expectNamesBoth(found, "limitations/gates", "mtek context", "docs/limitations.md section 3");
  });

  it("a notSupported item missing from the page fails limitations/not-supported-list", () => {
    const limitations = replaceOnce(base.docs.limitations ?? "", "- `loop`\n", "");
    const found = checkInputs({ ...base, docs: { ...base.docs, limitations } });
    expectNamesBoth(found, "limitations/not-supported-list", "mtek context (supported.notSupported)", "docs/limitations.md section 7");
  });

  it("a reserved code missing from section 5 fails limitations/specified-not-produced", () => {
    const limitations = replaceOnce(base.docs.limitations ?? "", /^\| `E5100` \|.*\n/m, "");
    const found = checkInputs({ ...base, docs: { ...base.docs, limitations } });
    expectNamesBoth(found, "limitations/specified-not-produced", "code-coverage-exceptions.json", "docs/limitations.md section 5");
  });

  it("a catalogue mark with no entry in the exceptions fails limitations/catalogue-marks", () => {
    const exceptions = { ...base.docs.exceptions, reserved: base.docs.exceptions.reserved.filter((e) => e.code !== "E5100") };
    const found = checkInputs({ ...base, docs: { ...base.docs, exceptions } });
    expectNamesBoth(found, "limitations/catalogue-marks", "spec/diagnostics.md catalogue", "code-coverage-exceptions.json");
  });

  it("a link of a release page that points at nothing fails docs/links", () => {
    const pages = base.links.pages.map((p) => (p.path === "docs/language-guide.md" ? { ...p, text: `${p.text}\nSee [x](no-such-page.md).\n` } : p));
    const found = checkInputs({ ...base, links: { ...base.links, pages } });
    expectNamesBoth(found, "docs/links", "docs/language-guide.md line", "docs/no-such-page.md");
  });

  it("a stale generated page fails docs/stale", () => {
    const docs = generateDocs(ctx);
    // A copy of the repository's docs directory with one word changed, judged against the generator.
    const stale = new Map(docs);
    const guide = stale.get("docs/language-guide.md") ?? "";
    stale.set("docs/language-guide.md", guide.replace("Mtek language guide", "Mtek language gide"));
    const found = staleDocs(root, stale);
    expectNamesBoth(found, "docs/stale", "tools/release-docs (the generator)", "docs/language-guide.md");
  });
});

live("the naming lint W0030 (decision 0102)", () => {
  it("the specification promising the lint again fails naming-lint/w0030", () => {
    const languageMd = replaceOnce(
      base.naming.languageMd,
      /3\.3 \*\*Naming conventions\.\*\*[^\n]*/,
      "3.3 **Naming conventions.** Not enforced by the compiler in v0.1, but the formatter's lint (`W0030`) warns when: types are not `PascalCase`.",
    );
    const found = checkInputs({ ...base, naming: { ...base.naming, languageMd } });
    expectNamesBoth(found, "naming-lint/w0030", "spec/diagnostics.md (catalogue row W0030)", "spec/language.md 3.3");
  });

  it("the page not listing W0030 fails naming-lint/w0030", () => {
    const limitations = (base.naming.limitations ?? "").replaceAll("W0030", "W0031");
    const found = checkInputs({ ...base, naming: { ...base.naming, limitations } });
    expectNamesBoth(found, "naming-lint/w0030", "spec/diagnostics.md (catalogue row W0030)", "docs/limitations.md (section 5)");
  });

  it("the catalogue losing its mark fails naming-lint/w0030", () => {
    const catalogue = base.naming.catalogue.map((c) => (c.code === "W0030" ? { ...c, mark: null } : c));
    const found = checkInputs({ ...base, naming: { ...base.naming, catalogue } });
    expectNamesBoth(found, "naming-lint/w0030", "spec/diagnostics.md (catalogue row W0030)", "code-coverage-exceptions.json");
  });
});

live("the ABI: constants and capabilities (abi/*, runtime/*)", () => {
  it("a runtime that implements another ABI fails abi/runtime-abi", () => {
    const rt = { ...base.abi.runtime, runtimeAbi: 2 };
    const found = checkInputs({ ...base, abi: { ...base.abi, runtime: rt } });
    expectNamesBoth(found, "abi/runtime-abi", "mtek --version (runtime ABI)", "packages/runtime-web/src/abi/constants.ts (SUPPORTED_RUNTIME_ABI)");
  });

  it("a specification that states another ABI fails abi/runtime-abi", () => {
    const runtimeAbiMd = replaceOnce(base.abi.runtimeAbiMd, "Runtime ABI version **1**", "Runtime ABI version **2**");
    const found = checkInputs({ ...base, abi: { ...base.abi, runtimeAbiMd } });
    expectNamesBoth(found, "abi/runtime-abi", "mtek --version (runtime ABI)", "spec/runtime-abi.md (status line)");
  });

  it("a manifest that carries another schema version fails abi/manifest-schema", () => {
    const compiler = { ...base.abi.compiler, manifest: { ...base.abi.compiler.manifest, manifestSchema: 2 } };
    const found = checkInputs({ ...base, abi: { ...base.abi, compiler } });
    expectNamesBoth(found, "abi/manifest-schema", "program.manifest.json", "spec/runtime-abi.md");
  });

  it("a runtime that supports another language version fails abi/language-version", () => {
    const rt = { ...base.abi.runtime, languageVersion: "0.2" };
    const found = checkInputs({ ...base, abi: { ...base.abi, runtime: rt } });
    expectNamesBoth(found, "abi/language-version", "mtek context (languageVersion)", "SUPPORTED_LANGUAGE_VERSION");
  });

  it("a README that prints another version line fails abi/version-line", () => {
    const readme = replaceOnce(base.abi.readme, "runtime ABI 1)", "runtime ABI 9)");
    const found = checkInputs({ ...base, abi: { ...base.abi, readme } });
    expectNamesBoth(found, "abi/version-line", "mtek --version", "README.md");
  });

  it("a schema that allows another target profile fails abi/target-profile", () => {
    const manifestSchemaJson = replaceOnce(base.abi.manifestSchemaJson, '"enum": ["webgpu-core-2026"]', '"enum": ["webgpu-core-2027"]');
    const found = checkInputs({ ...base, abi: { ...base.abi, manifestSchemaJson } });
    expectNamesBoth(found, "abi/target-profile", "program.manifest.json", "spec/manifest.schema.json (targetProfile enum)");
  });

  it("a specification that requires a capability the manifest does not fails abi/required-capabilities", () => {
    const runtimeAbiMd = replaceOnce(base.abi.runtimeAbiMd, '"features": [], "limits": {}', '"features": ["timestamp-query"], "limits": {}');
    const found = checkInputs({ ...base, abi: { ...base.abi, runtimeAbiMd } });
    expectNamesBoth(found, "abi/required-capabilities", "program.manifest.json", "spec/runtime-abi.md section 5");
  });

  it("a key the runtime does not map fails runtime/key-codes", () => {
    const rt = { ...base.runtime.runtime, keyCodes: without(base.runtime.runtime.keyCodes, "Space") };
    const found = checkInputs({ ...base, runtime: { ...base.runtime, runtime: rt } });
    expectNamesBoth(found, "runtime/key-codes", "spec/stdlib-schema.json (enum Key)", "packages/runtime-web/src/input/keys.ts");
  });

  it("a key row missing from stdlib.md fails runtime/key-codes-spec", () => {
    const stdlibMd = replaceOnce(base.runtime.stdlibMd, "`Key.ArrowUp`, ", "");
    const found = checkInputs({ ...base, runtime: { ...base.runtime, stdlibMd } });
    expectNamesBoth(found, "runtime/key-codes-spec", "spec/stdlib.md 5.2", "keys.ts");
  });

  it("an event the runtime does not deliver fails runtime/events", () => {
    const rt = { ...base.runtime.runtime, collisionEvents: ["collision_enter"] };
    const found = checkInputs({ ...base, runtime: { ...base.runtime, runtime: rt } });
    expectNamesBoth(found, "runtime/events", "spec/stdlib-schema.json (events)", "packages/runtime-web/src/scene/dynamic.ts");
  });

  it("an event row missing from stdlib.md fails runtime/events-spec", () => {
    const stdlibMd = replaceOnce(base.runtime.stdlibMd, "`collision_enter`, `collision_exit`", "`collision_enter`");
    const found = checkInputs({ ...base, runtime: { ...base.runtime, stdlibMd } });
    expectNamesBoth(found, "runtime/events-spec", "spec/stdlib.md 5.1", "spec/stdlib-schema.json (events)");
  });

  it("a codec the runtime cannot decode fails runtime/host-codecs", () => {
    const rt = { ...base.runtime.runtime, implementedCodecs: without(base.runtime.runtime.implementedCodecs, "color-hex-opaque") };
    const found = checkInputs({ ...base, runtime: { ...base.runtime, runtime: rt } });
    expectNamesBoth(found, "runtime/host-codecs", "spec/manifest.schema.json (hostInput.codec enum)", "packages/runtime-web/src/host/codecs.ts");
  });

  it("a codec the compiler emits and the runtime cannot decode fails runtime/host-codecs-emitted", () => {
    const rt = { ...base.runtime.runtime, implementedCodecs: without(base.runtime.runtime.implementedCodecs, "f32") };
    const found = checkInputs({ ...base, runtime: { ...base.runtime, runtime: rt } });
    expectNamesBoth(found, "runtime/host-codecs-emitted", "the manifests the compiler wrote", "codecs.ts");
  });

  it("a codec row missing from runtime-abi.md fails runtime/host-codecs-spec", () => {
    const runtimeAbiMd = replaceOnce(base.runtime.runtimeAbiMd, "| `string` | `string` | `string`, ≤ 64 KiB |\n", "");
    const found = checkInputs({ ...base, runtime: { ...base.runtime, runtimeAbiMd } });
    expectNamesBoth(found, "runtime/host-codecs-spec", "spec/runtime-abi.md 6.3", "spec/manifest.schema.json");
  });

  it("a body command the runtime lacks fails runtime/body-handle", () => {
    const rt = { ...base.runtime.runtime, bodyHandleMembers: without(base.runtime.runtime.bodyHandleMembers, "teleport") };
    const found = checkInputs({ ...base, runtime: { ...base.runtime, runtime: rt } });
    expectNamesBoth(found, "runtime/body-handle", "spec/stdlib-schema.json (bodyCommands, bodyProperties)", "BodyHandleImpl");
  });

  it("a body command missing from runtime-abi.md fails runtime/body-handle-spec", () => {
    const runtimeAbiMd = replaceOnce(base.runtime.runtimeAbiMd, "`h.applyForce(v)`, ", "");
    const found = checkInputs({ ...base, runtime: { ...base.runtime, runtimeAbiMd } });
    expectNamesBoth(found, "runtime/body-handle-spec", "spec/runtime-abi.md 4.2", "BodyHandleImpl");
  });

  it("an intrinsic missing from stdlib.md fails stdlib/intrinsics", () => {
    const stdlibMd = replaceOnce(base.stdlib.stdlibMd, /^\| `transpose` \|.*\n/m, "");
    const found = checkInputs({ ...base, stdlib: { ...base.stdlib, stdlibMd } });
    expectNamesBoth(found, "stdlib/intrinsics", "spec/stdlib-schema.json (intrinsics)", "spec/stdlib.md 6");
  });

  it("a namespace member missing from stdlib.md fails stdlib/namespace-members", () => {
    const stdlibMd = replaceOnce(base.stdlib.stdlibMd, "`srgb(rgb: vec3, a: f32)`", "");
    const found = checkInputs({ ...base, stdlib: { ...base.stdlib, stdlibMd } });
    expectNamesBoth(found, "stdlib/namespace-members", "spec/stdlib-schema.json (namespaces)", "spec/stdlib.md 2");
  });
});

live("the claims of the README and the other hand-written pages (readme/*)", () => {
  it("a README that miscounts the examples fails readme/example-count", () => {
    const readme = replaceOnce(base.readme.readme, /the web runtime, \w+\s+examples/, "the web runtime, three\nexamples");
    const found = checkInputs({ ...base, readme: { ...base.readme, readme } });
    expectNamesBoth(found, "readme/example-count", "the examples/ directory", "README.md (Status)");
  });

  it("a command missing from the README table fails readme/commands", () => {
    const readme = replaceOnce(base.readme.readme, /^\| `mtek lsp` \|.*\n/m, "");
    const found = checkInputs({ ...base, readme: { ...base.readme, readme } });
    expectNamesBoth(found, "readme/commands", "mtek --help", "README.md (table of The `mtek` command)");
  });

  it("an example missing from the README table fails readme/examples", () => {
    const readme = replaceOnce(base.readme.readme, /^\| \[`examples\/modular-scene`\].*\n/m, "");
    const found = checkInputs({ ...base, readme: { ...base.readme, readme } });
    expectNamesBoth(found, "readme/examples", "the examples/ directory", "README.md (table of Examples)");
  });

  it("a script the README names and the package lacks fails readme/npm-scripts", () => {
    const readme = `${base.readme.readme}\nRun \`npm run frobnicate\`.\n`;
    const found = checkInputs({ ...base, readme: { ...base.readme, readme } });
    expectNamesBoth(found, "readme/npm-scripts", "README.md", "package.json (scripts)");
  });

  it("a step of npm run check the README row omits fails readme/check-steps", () => {
    const readme = replaceOnce(base.readme.readme, ", `npm run check:assets`", "");
    const found = checkInputs({ ...base, readme: { ...base.readme, readme } });
    expectNamesBoth(found, "readme/check-steps", "package.json (scripts.check)", "README.md");
  });

  it("another Rust version in the getting-started page fails readme/toolchain", () => {
    const gettingStarted = replaceOnce(base.readme.gettingStarted, /\*\*(\d+\.\d+\.\d+)\*\* \(rustup/, "**1.0.0** (rustup");
    const found = checkInputs({ ...base, readme: { ...base.readme, gettingStarted } });
    expectNamesBoth(found, "readme/toolchain", "rust-toolchain.toml", "docs/getting-started.md");
  });

  it("another Node version in the README fails readme/node-version", () => {
    const readme = replaceOnce(base.readme.readme, /Node\.js \*\*(\d+)\*\*/, "Node.js **18**");
    const found = checkInputs({ ...base, readme: { ...base.readme, readme } });
    expectNamesBoth(found, "readme/node-version", ".nvmrc", "README.md");
  });

  it("a specification README that denies the implementation fails readme/spec-status", () => {
    const specReadme = `${base.readme.specReadme}\nNothing described here is implemented yet.\n`;
    const found = checkInputs({ ...base, readme: { ...base.readme, specReadme } });
    expectNamesBoth(found, "readme/spec-status", "spec/README.md", "mtek --version");
  });

  it("a decision range that is not the directory's fails readme/decision-range", () => {
    const specReadme = replaceOnce(base.readme.specReadme, /Decision records (\d{4})–(\d{4})/, "Decision records 0001–0021");
    const found = checkInputs({ ...base, readme: { ...base.readme, specReadme } });
    expectNamesBoth(found, "readme/decision-range", "spec/decisions (the files)", "spec/README.md");
  });
});
