// Where the language server is: the `mtek` executable named by the `mtek.server.path` setting.
// No `vscode` import here, so the lookup is unit-tested with a fake file system.

/** The setting's default: `mtek` on `PATH`. */
export const DEFAULT_SERVER_PATH = "mtek";

/** The command line of the server: `mtek lsp` (decision 0076 item 1; stdio is the only transport). */
export const SERVER_ARGS: readonly string[] = ["lsp"];

export type Resolution =
  | { readonly kind: "found"; readonly command: string }
  | { readonly kind: "missing"; readonly message: string };

/** What the lookup needs of the machine. */
export interface Environment {
  readonly platform: NodeJS.Platform;
  /** The `PATH` of the VS Code process (`Path` on Windows is folded into it by Node). */
  readonly pathVariable: string | undefined;
  /** True if `file` exists and is a file (not a directory). */
  readonly isFile: (file: string) => boolean;
  /** `path.join` / `path.delimiter` / `path.isAbsolute` of the platform. */
  readonly join: (...parts: string[]) => string;
  readonly delimiter: string;
  readonly isAbsolute: (file: string) => boolean;
}

/**
 * Windows runs a name without an extension by trying the `PATHEXT` ones. The server is started
 * without a shell (the client spawns it directly), so only the extensions of real executables are
 * tried: a `mtek.cmd` or `mtek.bat` wrapper cannot be started that way.
 */
const WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".com"];

function candidates(name: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [name];
  const lower = name.toLowerCase();
  if (WINDOWS_EXECUTABLE_EXTENSIONS.some((extension) => lower.endsWith(extension))) return [name];
  return [name, ...WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${name}${extension}`)];
}

/**
 * The file to start for the configured value: an absolute path as it is, a bare name through
 * `PATH`. Anything else (a relative path with directories) is refused, because relative to what
 * it would be is not something a setting can say. A value that cannot be started is a message
 * that tells the user what was looked for and where to change it.
 */
export function resolveServer(configured: string, env: Environment): Resolution {
  const value = configured.trim() === "" ? DEFAULT_SERVER_PATH : configured.trim();

  if (env.isAbsolute(value)) {
    const found = candidates(value, env.platform).find((file) => env.isFile(file));
    if (found !== undefined) return { kind: "found", command: found };
    return {
      kind: "missing",
      message: `The Mtek language server executable was not found at \`${value}\` (setting \`mtek.server.path\`).`,
    };
  }

  if (/[\\/]/.test(value)) {
    return {
      kind: "missing",
      message: `\`mtek.server.path\` is \`${value}\`: use an absolute path, or a bare name that is on PATH.`,
    };
  }

  const directories = (env.pathVariable ?? "").split(env.delimiter).filter((d) => d !== "");
  for (const directory of directories) {
    for (const candidate of candidates(value, env.platform)) {
      const file = env.join(directory, candidate);
      if (env.isFile(file)) return { kind: "found", command: file };
    }
  }
  return {
    kind: "missing",
    message:
      `The Mtek language server executable \`${value}\` was not found on PATH` +
      (directories.length === 0 ? " (PATH is empty)" : "") +
      ". Install `mtek`, or set `mtek.server.path` to its absolute path. " +
      "If it was installed after VS Code started, restart VS Code so that it sees the new PATH.",
  };
}
