import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_PATH, SERVER_ARGS, resolveServer } from "./server.ts";
import type { Environment } from "./server.ts";

/** A machine with these files (any other path does not exist). */
function machine(
  platform: "linux" | "win32",
  files: string[],
  pathVariable: string | undefined,
): Environment {
  const flavour = platform === "win32" ? path.win32 : path.posix;
  // Windows paths are case-insensitive
  const normal = (file: string): string => (platform === "win32" ? file.toLowerCase() : file);
  const lookup = new Set(files.map(normal));
  return {
    platform,
    pathVariable,
    isFile: (file) => lookup.has(normal(file)),
    join: (...parts) => flavour.join(...parts),
    delimiter: flavour.delimiter,
    isAbsolute: (file) => flavour.isAbsolute(file),
  };
}

describe("the server command", () => {
  it("is `mtek lsp` and nothing else, the default executable `mtek` on PATH", () => {
    expect(DEFAULT_SERVER_PATH).toBe("mtek");
    expect(SERVER_ARGS).toEqual(["lsp"]);
  });
});

describe("resolveServer", () => {
  it("finds a bare name on PATH, the first directory that has it", () => {
    const env = machine("linux", ["/usr/local/bin/mtek", "/opt/mtek/bin/mtek"], "/usr/bin:/usr/local/bin:/opt/mtek/bin");
    expect(resolveServer("mtek", env)).toEqual({ kind: "found", command: "/usr/local/bin/mtek" });
  });

  it("treats an empty or blank setting as the default", () => {
    const env = machine("linux", ["/usr/bin/mtek"], "/usr/bin");
    expect(resolveServer("", env)).toEqual({ kind: "found", command: "/usr/bin/mtek" });
    expect(resolveServer("   ", env)).toEqual({ kind: "found", command: "/usr/bin/mtek" });
  });

  it("uses an absolute path as it is", () => {
    const env = machine("linux", ["/home/me/mtek/target/debug/mtek"], "/usr/bin");
    expect(resolveServer("/home/me/mtek/target/debug/mtek", env)).toEqual({
      kind: "found",
      command: "/home/me/mtek/target/debug/mtek",
    });
  });

  it("says where it looked when the name is not on PATH, and what to do", () => {
    const result = resolveServer("mtek", machine("linux", [], "/usr/bin:/bin"));
    expect(result.kind).toBe("missing");
    if (result.kind === "missing") {
      expect(result.message).toContain("`mtek`");
      expect(result.message).toContain("PATH");
      expect(result.message).toContain("mtek.server.path");
      expect(result.message).toContain("restart VS Code");
    }
  });

  it("says that PATH is empty when it is", () => {
    for (const pathVariable of [undefined, ""]) {
      const result = resolveServer("mtek", machine("linux", [], pathVariable));
      expect(result.kind === "missing" && result.message.includes("PATH is empty")).toBe(true);
    }
  });

  it("names the configured path when an absolute path does not exist", () => {
    const result = resolveServer("/nowhere/mtek", machine("linux", ["/usr/bin/mtek"], "/usr/bin"));
    expect(result.kind).toBe("missing");
    if (result.kind === "missing") {
      expect(result.message).toContain("/nowhere/mtek");
      expect(result.message).toContain("mtek.server.path");
    }
  });

  it("refuses a relative path with directories: relative to what", () => {
    const result = resolveServer("target/debug/mtek", machine("linux", ["/usr/bin/mtek"], "/usr/bin"));
    expect(result.kind).toBe("missing");
    if (result.kind === "missing") expect(result.message).toContain("absolute path");
  });

  it("goes on to the next PATH directory when the first has no such file", () => {
    const env = machine("linux", ["/b/mtek"], "/a:/b");
    expect(resolveServer("mtek", env)).toEqual({ kind: "found", command: "/b/mtek" });
  });

  describe("on Windows", () => {
    it("adds .exe to a bare name and looks in every PATH directory", () => {
      const env = machine("win32", ["C:\\Tools\\mtek\\mtek.exe"], "C:\\Windows;C:\\Tools\\mtek");
      expect(resolveServer("mtek", env)).toEqual({ kind: "found", command: "C:\\Tools\\mtek\\mtek.exe" });
    });

    it("accepts the name with its extension, in any case", () => {
      const env = machine("win32", ["c:\\tools\\mtek.exe"], "C:\\Tools");
      expect(resolveServer("MTEK.EXE", env)).toEqual({ kind: "found", command: "C:\\Tools\\MTEK.EXE" });
    });

    it("accepts an absolute path without the extension", () => {
      const env = machine("win32", ["C:\\work\\mtek\\target\\debug\\mtek.exe"], "C:\\Windows");
      expect(resolveServer("C:\\work\\mtek\\target\\debug\\mtek", env)).toEqual({
        kind: "found",
        command: "C:\\work\\mtek\\target\\debug\\mtek.exe",
      });
    });

    it("does not start a .cmd wrapper (the client starts the server without a shell)", () => {
      const env = machine("win32", ["C:\\Tools\\mtek.cmd"], "C:\\Tools");
      expect(resolveServer("mtek", env).kind).toBe("missing");
    });
  });
});
