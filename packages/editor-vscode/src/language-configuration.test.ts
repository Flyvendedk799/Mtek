// The language configuration (comments, brackets, auto-closing, indentation, word pattern).
//
// The indentation rules are checked against what `mtek fmt` (decision 0070) writes: the sources
// below are copied to a temporary directory, formatted by the real binary, and the indentation of
// every line must be what the bracket and Enter rules give from the preceding lines, including
// the text after a split and the adjustment when a closing bracket is typed.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACKAGE_ROOT, REPO_ROOT, mtekBinary } from "./grammar/testing.ts";

interface LanguageConfiguration {
  comments: { lineComment: string; blockComment: [string, string] };
  brackets: [string, string][];
  autoClosingPairs: { open: string; close: string; notIn?: string[] }[];
  surroundingPairs: [string, string][];
  indentationRules: {
    increaseIndentPattern: string;
    decreaseIndentPattern: string;
    unIndentedLinePattern?: string;
  };
  onEnterRules: {
    beforeText: string;
    afterText?: string;
    previousLineText?: string;
    action: { indent: string; appendText?: string };
  }[];
  wordPattern: string;
}

const configuration = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "language-configuration.json"), "utf8"),
) as LanguageConfiguration;
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
  contributes: { configurationDefaults: Record<string, Record<string, unknown>> };
};

function enterDelta(before: string, after: string, previous: string): number | undefined {
  const rule = configuration.onEnterRules.find(
    (candidate) =>
      new RegExp(candidate.beforeText).test(before) &&
      (candidate.afterText === undefined || new RegExp(candidate.afterText).test(after)) &&
      (candidate.previousLineText === undefined ||
        new RegExp(candidate.previousLineText).test(previous)),
  );
  if (rule === undefined) return undefined;
  return rule.action.indent === "indent" ? 1 : rule.action.indent === "outdent" ? -1 : 0;
}

describe("language-configuration.json", () => {
  it("has the comment forms of spec/language.md 1.5", () => {
    expect(configuration.comments.lineComment).toBe("//");
    expect(configuration.comments.blockComment).toEqual(["/*", "*/"]);
  });

  it("pairs the three bracket kinds and quotes, and surrounds with them", () => {
    expect(configuration.brackets).toEqual([
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ]);
    const closing = new Map(configuration.autoClosingPairs.map((p) => [p.open, p.close]));
    expect(closing.get("{")).toBe("}");
    expect(closing.get("[")).toBe("]");
    expect(closing.get("(")).toBe(")");
    expect(closing.get('"')).toBe('"');
    // `<` and `>` are comparison operators: never paired
    expect([...closing.keys()]).not.toContain("<");
    expect(configuration.surroundingPairs).toContainEqual(['"', '"']);
  });

  it("does not auto-close a quote inside a string or a comment", () => {
    const quote = configuration.autoClosingPairs.find((p) => p.open === '"');
    expect(quote?.notIn).toEqual(["string", "comment"]);
  });

  it("compiles every pattern", () => {
    const { increaseIndentPattern, decreaseIndentPattern } = configuration.indentationRules;
    for (const pattern of [
      increaseIndentPattern,
      decreaseIndentPattern,
      configuration.wordPattern,
      ...configuration.onEnterRules.map((rule) => rule.beforeText),
      ...configuration.onEnterRules.flatMap((rule) => rule.previousLineText ?? []),
      ...configuration.onEnterRules.flatMap((rule) => rule.afterText ?? []),
    ]) {
      expect(() => new RegExp(pattern), pattern).not.toThrow();
    }
  });

  it("matches words the way the lexer reads names, numbers and colours", () => {
    const words = (text: string): string[] =>
      text.match(new RegExp(configuration.wordPattern, "g")) ?? [];
    expect(words("let angle_2 = speed * 0.7;")).toEqual(["let", "angle_2", "speed", "0.7"]);
    expect(words("color: #6b5cff80;")).toEqual(["color", "#6b5cff80"]);
    expect(words("a.b(c)")).toEqual(["a", "b", "c"]);
    expect(words("2.5e-3")).toEqual(["2.5e-3"]);
  });

  it("continues a documentation comment on the next line, and not a banner", () => {
    const rule = configuration.onEnterRules[0];
    expect(rule).toBeDefined();
    const before = new RegExp(rule?.beforeText ?? "");
    expect(before.test("    /// the speed")).toBe(true);
    expect(before.test("    //// banner")).toBe(false);
    expect(before.test("    // plain")).toBe(false);
    expect(rule?.action.appendText).toBe("/// ");
  });

  it("indents binary continuations once, including call arguments, and restores their enclosing level", () => {
    expect(enterDelta("    return input.index", "", "fn index() {")).toBe(1);
    expect(enterDelta("        sample(image, filter, uv).xyz", "* gain,", "    return color.linear(")).toBe(1);
    expect(enterDelta("        + input.global_x", "", "    return input.index")).toBeUndefined();
    expect(enterDelta("        + input.global_y;", "", "        + input.global_x")).toBe(-1);
    expect(enterDelta("            * gain,", "1.0,", "        sample(image, filter, uv).xyz")).toBe(-1);
    // A right delimiter already causes the editor's bracket rules to outdent.
    expect(enterDelta("        color.linear(rgb, alpha)", ");", "    return mix(")).toBeUndefined();
    expect(enterDelta("    let value = 1.0;", "", "")).toBeUndefined();
    expect(enterDelta("    // expression", "", "")).toBeUndefined();
    expect(enterDelta("    /* expression */", "", "")).toBeUndefined();
    expect(enterDelta("    + value;", "", "    // comment")).toBeUndefined();
  });

  it("sets what `mtek fmt` writes as the defaults for .mtek files: 4 spaces, LF, final newline, no trailing space", () => {
    expect(manifest.contributes.configurationDefaults["[mtek]"]).toMatchObject({
      "editor.insertSpaces": true,
      "editor.tabSize": 4,
      "editor.detectIndentation": false,
      "files.eol": "\n",
      "files.insertFinalNewline": true,
      "files.trimTrailingWhitespace": true,
    });
  });
});

describe("indentation rules against the canonical formatter", () => {
  let directory = "";
  let canonical: string[] = [];

  /** Sources whose formatted form is the sample: examples, benchmark tasks and the syntax and semantic pass fixtures. */
  const SAMPLE_ROOTS = ["examples", "benchmarks/tasks", "tests/syntax/pass", "tests/semantics/pass"];

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "mtek-indent-"));
    for (const root of SAMPLE_ROOTS) {
      cpSync(join(REPO_ROOT, root), join(directory, root), {
        recursive: true,
        filter: (source) => !source.includes("node_modules") && !source.includes("/target/"),
      });
    }
    // Rewrite every file that parses; a file that does not parse is reported on stderr and left
    // alone (several benchmark tasks are broken on purpose), and is left out of the sample.
    const formatted = spawnSync(mtekBinary(), ["fmt", directory], { encoding: "utf8" });
    expect([0, 1]).toContain(formatted.status);
    // The diagnostics name the files by path; the part below the temporary directory identifies them.
    const marker = `${basename(directory)}/`;
    const unparsable = new Set(
      [...formatted.stderr.matchAll(/-->\s+(.+?):\d+:\d+/g)].map((m) => {
        const named = (m[1] ?? "").replaceAll("\\", "/");
        return resolve(directory, named.slice(named.indexOf(marker) + marker.length));
      }),
    );
    expect(unparsable.size).toBeGreaterThan(0);
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".mtek") && !unparsable.has(resolve(path))) files.push(path);
      }
    };
    walk(directory);
    canonical = files;
    // The sample must be canonical now: `fmt --check` over the kept files exits 0.
    for (let i = 0; i < canonical.length; i += 100) {
      const checked = spawnSync(mtekBinary(), ["fmt", "--check", ...canonical.slice(i, i + 100)], {
        encoding: "utf8",
      });
      expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(0);
    }
  });

  afterAll(() => {
    if (directory !== "") rmSync(directory, { recursive: true, force: true });
  });

  it("gives every line of every formatted source the indentation the formatter wrote", () => {
    const rules = configuration.indentationRules;
    const increase = new RegExp(rules.increaseIndentPattern);
    const decrease = new RegExp(rules.decreaseIndentPattern);
    const unIndented =
      rules.unIndentedLinePattern === undefined ? undefined : new RegExp(rules.unIndentedLinePattern);

    const problems: string[] = [];
    let checked = 0;
    for (const file of canonical) {
      // A signature with a comment between every token (a fixture of the parser) is wrapped by the
      // formatter at the comments, where no indentation rule of an editor can follow it.
      if (file.endsWith("comments_between_tokens.mtek")) continue;
      let previous: { text: string; level: number; before: string } | undefined;
      let inBlockComment = false;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (line.trim() === "") return;
          if (inBlockComment) {
            if (line.includes("*/")) inBlockComment = false;
            return;
          }
          if (/^\s*\/\*/.test(line) && !line.includes("*/")) {
            inBlockComment = true;
            return;
          }
          if (unIndented?.test(line) === true) return;
          const spaces = /^ */.exec(line)?.[0].length ?? 0;
          expect(spaces % 4, `${file}:${index + 1}`).toBe(0);
          const level = spaces / 4;
          if (previous !== undefined) {
            checked += 1;
            const delta = enterDelta(previous.text, line.trimStart(), previous.before)
              ?? (increase.test(previous.text) ? 1 : 0);
            const expected = previous.level + delta - (decrease.test(line) ? 1 : 0);
            if (expected !== level) {
              problems.push(
                `${relative(directory, file)}:${index + 1}: expected ${expected}, canonical ${level}\n  ${previous.text}\n  ${line}`,
              );
            }
          }
          previous = { text: line, level, before: previous?.text ?? "" };
        });
    }
    expect(problems.slice(0, 10)).toEqual([]);
    // what was checked: some hundreds of formatted files
    expect(canonical.length).toBeGreaterThan(200);
    expect(checked).toBeGreaterThan(5_000);
  });
});
