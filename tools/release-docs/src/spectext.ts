// Reading facts out of the prose of the specification, for the comparisons of decision 0101.
//
// Each reader is a small, strict parser of one place in one document and throws (naming the place) when
// the place is not there, so a restructured document fails loudly instead of comparing nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readText(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
}

/** The lines of `text` from the heading line that starts with `heading` to the next heading of the same or a higher level. */
export function section(text: string, heading: string, what = heading): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start < 0) throw new Error(`${what}: no heading starting with ${JSON.stringify(heading)}`);
  const level = /^#+/.exec(heading)?.[0].length ?? 2;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+) /.exec(lines[i] ?? "");
    if (m !== null && (m[1]?.length ?? 99) <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The cells of the rows of the first pipe table in `text` (header and separator rows dropped). */
export function tableRows(text: string): string[][] {
  const rows: string[][] = [];
  let seen = 0;
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) {
      if (seen > 0) break;
      continue;
    }
    seen++;
    if (seen <= 2) continue;
    const inner = line.replace(/^\|/, "").replace(/\|\s*$/, "");
    // Split on pipes that are not escaped (`\|`) and not inside backticks.
    const cells: string[] = [];
    let current = "";
    let inCode = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i] ?? "";
      if (ch === "`") inCode = !inCode;
      if (ch === "\\" && inner[i + 1] === "|") {
        current += "|";
        i++;
        continue;
      }
      if (ch === "|" && !inCode) {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    cells.push(current.trim());
    rows.push(cells);
  }
  return rows;
}

/** The contents of the first fenced code block in `text`. */
export function firstFence(text: string, what: string): string {
  const m = /```[^\n]*\n([\s\S]*?)\n```/.exec(text);
  if (m === null) throw new Error(`${what}: no fenced code block`);
  return m[1] ?? "";
}

function words(block: string): string[] {
  return block.split(/\s+/).filter((w) => w !== "");
}

/** `spec/language.md` 2.2: the keywords, and 2.3: the words reserved for future use. */
export function languageWordLists(languageMd: string): { keywords: string[]; reserved: string[] } {
  const keywordsBlock = firstFence(section(languageMd, "## 2. Tokens").split("2.2 ")[1] ?? "", "language.md 2.2");
  const reservedBlock = firstFence(section(languageMd, "## 2. Tokens").split("2.3 ")[1] ?? "", "language.md 2.3");
  return { keywords: words(keywordsBlock), reserved: words(reservedBlock) };
}

/** `spec/stdlib.md` 5.1: the event names. */
export function stdlibEvents(stdlibMd: string): string[] {
  const names: string[] = [];
  for (const row of tableRows(section(stdlibMd, "### 5.1 Events"))) {
    for (const m of (row[0] ?? "").matchAll(/`([a-z_]+)`/g)) names.push(m[1] ?? "");
  }
  return names;
}

function expandRange(first: string, last: string): string[] {
  const a = /^(\D+)(\d+|[A-Z])$/.exec(first);
  const b = /^(\D+)(\d+|[A-Z])$/.exec(last);
  if (a === null || b === null) throw new Error(`cannot expand the range ${first} ... ${last}`);
  const prefix = a[1] ?? "";
  const from = a[2] ?? "";
  const to = b[2] ?? "";
  const out: string[] = [];
  if (/^\d+$/.test(from)) {
    for (let i = Number(from); i <= Number(to); i++) out.push(`${prefix}${String(i)}`);
  } else {
    for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(`${prefix}${String.fromCharCode(c)}`);
  }
  return out;
}

/** `spec/stdlib.md` 5.2: the DOM key codes of the `Key` table. */
export function stdlibKeyCodes(stdlibMd: string): string[] {
  const codes: string[] = [];
  for (const row of tableRows(section(stdlibMd, "### 5.2 `Key`"))) {
    const codeCell = row[1] ?? "";
    const quoted = [...codeCell.matchAll(/"([A-Za-z0-9]+)"/g)].map((m) => m[1] ?? "");
    if (quoted.length > 0) {
      if (/…/.test(codeCell) && quoted.length === 2) codes.push(...expandRange(quoted[0] ?? "", quoted[1] ?? ""));
      else codes.push(...quoted);
    } else {
      // "same names": the code of `Key.ShiftLeft` is `ShiftLeft`.
      for (const m of (row[0] ?? "").matchAll(/Key\.([A-Za-z0-9]+)/g)) codes.push(m[1] ?? "");
    }
  }
  return codes;
}

/** `spec/stdlib.md` 6: the names in the first column of the intrinsic table. */
export function stdlibIntrinsicNames(stdlibMd: string): string[] {
  const names: string[] = [];
  for (const row of tableRows(section(stdlibMd, "## 6. Intrinsic functions"))) {
    for (const m of (row[0] ?? "").matchAll(/`([a-z_0-9]+)`/g)) names.push(m[1] ?? "");
  }
  return names;
}

/** `spec/stdlib.md` 2: the namespaces of the table and their members (`quat.identity`, `frame.time`). */
export function stdlibNamespaceMembers(stdlibMd: string): string[] {
  const names: string[] = [];
  for (const row of tableRows(section(stdlibMd, "## 2. Types and namespaces"))) {
    const ns = /`([a-z_A-Z0-9]+)`/.exec(row[0] ?? "")?.[1];
    if (ns === undefined || ns === "Key") continue;
    for (const m of (row[1] ?? "").matchAll(/`([a-z_0-9]+)(?:\(|:)/g)) names.push(`${ns}.${m[1] ?? ""}`);
    // Members written as `glb(path: string) -> glb_asset` inside one code span.
    for (const m of (row[1] ?? "").matchAll(/`([a-z_0-9]+)\(/g)) names.push(`${ns}.${m[1] ?? ""}`);
  }
  return [...new Set(names)];
}

/** `spec/runtime-abi.md` 6.3: the codec ids of the host input table. */
export function abiCodecIds(runtimeAbiMd: string): string[] {
  const ids: string[] = [];
  for (const row of tableRows(section(runtimeAbiMd, "### 6.3 Host input codecs"))) {
    const cell = row[1] ?? "";
    const id = /`([A-Za-z0-9-]+)`/.exec(cell)?.[1];
    if (id === undefined) continue;
    if (id === "vecN") ids.push("vec2", "vec3", "vec4");
    else ids.push(id);
  }
  return ids;
}

/** `spec/runtime-abi.md` 4.2: the methods of the body handle (`h.applyImpulse(v)`). */
export function abiBodyHandleMethods(runtimeAbiMd: string): string[] {
  const row = runtimeAbiMd.split("\n").find((line) => line.startsWith("| `ctx.body(refOrEntity, spanId)`"));
  if (row === undefined) throw new Error("runtime-abi.md 4.2: no ctx.body row");
  const methods = new Set<string>();
  for (const m of row.matchAll(/`h\.([a-zA-Z]+)/g)) methods.add(m[1] ?? "");
  return [...methods];
}

export interface AbiSpecConstants {
  /** The header line: "Runtime ABI version **1**, manifest schema version **1**". */
  headerAbi: string | undefined;
  headerSchema: string | undefined;
  /** The example manifest of section 5. */
  exampleSchema: string | undefined;
  exampleAbi: string | undefined;
  exampleLanguage: string | undefined;
  exampleProfile: string | undefined;
  exampleCapabilities: string | undefined;
  /** The sentence of 5.1: "v0.1 runtimes implement exactly `manifestSchema 1`, ...". */
  exactSchema: string | undefined;
  exactAbi: string | undefined;
  exactLanguage: string | undefined;
}

/** The ABI constants `spec/runtime-abi.md` states. */
export function abiSpecConstants(runtimeAbiMd: string): AbiSpecConstants {
  const header = runtimeAbiMd.split("\n").find((line) => line.startsWith("- Status:")) ?? "";
  const five = section(runtimeAbiMd, "## 5. The manifest");
  const fiveOne = section(runtimeAbiMd, "### 5.1 Compatibility");
  const caps = /"requiredCapabilities":\s*(\{[^\n]*\})/.exec(five)?.[1];
  return {
    headerAbi: /Runtime ABI version \*\*(\d+)\*\*/.exec(header)?.[1],
    headerSchema: /manifest schema version \*\*(\d+)\*\*/.exec(header)?.[1],
    exampleSchema: /"manifestSchema":\s*(\d+)/.exec(five)?.[1],
    exampleAbi: /"runtimeAbi":\s*(\d+)/.exec(five)?.[1],
    exampleLanguage: /"languageVersion":\s*"([^"]+)"/.exec(five)?.[1],
    exampleProfile: /"targetProfile":\s*"([^"]+)"/.exec(five)?.[1],
    exampleCapabilities: caps === undefined ? undefined : caps.replace(/\s+/g, " "),
    exactSchema: /`manifestSchema (\d+)`/.exec(fiveOne)?.[1],
    exactAbi: /`runtimeAbi (\d+)`/.exec(fiveOne)?.[1],
    exactLanguage: /`languageVersion "([^"]+)"`/.exec(fiveOne)?.[1],
  };
}
