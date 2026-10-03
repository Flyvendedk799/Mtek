import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeHoldoutHash,
  formatHashFile,
  listHoldoutFiles,
  readRecordedHash,
} from "./hash-holdout.mjs";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mtek-holdout-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function put(path: string, content: string | Uint8Array): void {
  const file = join(dir, ...path.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function sha(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("computeHoldoutHash", () => {
  it("matches a fixed test vector (guards the algorithm across platforms)", () => {
    put("t-01/task.toml", 'id = "t-01"\n');
    put("t-01/mtek/src/main.mtek", "scene Demo {}\n");
    put("t-01/blob.bin", new Uint8Array([0, 13, 10, 255]));
    // sha256sum-style lines in path byte order, hashed once more.
    const lines =
      `${sha(new Uint8Array([0, 13, 10, 255]))}  t-01/blob.bin\n` +
      `${sha("scene Demo {}\n")}  t-01/mtek/src/main.mtek\n` +
      `${sha('id = "t-01"\n')}  t-01/task.toml\n`;
    expect(computeHoldoutHash(dir)).toBe(sha(lines));
    expect(computeHoldoutHash(dir)).toBe(
      "d75af08b34ccaea0ab8477217f2fbaea5e031632bac25f2d9678330486f3be3e",
    );
  });

  it("sorts by UTF-8 bytes, not by locale or directory enumeration order", () => {
    for (const path of ["b.txt", "a/x.txt", "a-b.txt", "Q.txt", "é.txt", "z.txt"]) put(path, path);
    expect(listHoldoutFiles(dir).map((file) => file.path)).toEqual([
      // '-' (0x2d) < '/' (0x2f) < upper case < lower case < non-ASCII
      "Q.txt",
      "a-b.txt",
      "a/x.txt",
      "b.txt",
      "z.txt",
      "é.txt",
    ]);
  });

  it("changes when a byte, a name or a file changes, and not otherwise", () => {
    put("t/a.txt", "one\n");
    const base = computeHoldoutHash(dir);
    expect(computeHoldoutHash(dir)).toBe(base);
    put("t/a.txt", "two\n");
    const edited = computeHoldoutHash(dir);
    expect(edited).not.toBe(base);
    put("t/b.txt", "");
    expect(computeHoldoutHash(dir)).not.toBe(edited);
  });

  it("ignores operating-system litter files", () => {
    put("t/a.txt", "one\n");
    const base = computeHoldoutHash(dir);
    put("t/.DS_Store", "x");
    put("Thumbs.db", "x");
    expect(computeHoldoutHash(dir)).toBe(base);
  });

  it("rejects a carriage return in a text file but not in a binary one", () => {
    put("t/a.bin", new Uint8Array([13]));
    expect(() => computeHoldoutHash(dir)).not.toThrow();
    put("t/a.toml", 'a = 1\r\n');
    expect(() => computeHoldoutHash(dir)).toThrow(/t\/a\.toml: contains a carriage return/);
  });

  it("rejects symbolic links", (context) => {
    put("t/a.txt", "x");
    try {
      symlinkSync(join(dir, "t", "a.txt"), join(dir, "t", "link.txt"));
    } catch {
      context.skip(); // symbolic links need a privilege on some Windows setups
    }
    expect(() => computeHoldoutHash(dir)).toThrow(/not a regular file/);
  });
});

describe("recorded hash file", () => {
  it("is one lowercase 64-digit hash and a newline", () => {
    const hash = sha("x");
    put("holdout.sha256", formatHashFile(hash));
    expect(readRecordedHash(join(dir, "holdout.sha256"))).toBe(hash);
    put("bad.sha256", `${hash.toUpperCase()}\n`);
    expect(() => readRecordedHash(join(dir, "bad.sha256"))).toThrow(/64 lowercase hex digits/);
    put("short.sha256", `${hash}`);
    expect(() => readRecordedHash(join(dir, "short.sha256"))).toThrow(/newline/);
    expect(readRecordedHash(join(dir, "missing.sha256"))).toBeNull();
  });
});
