// The Mtek extension: a client of `mtek lsp` and nothing else. Every language feature (diagnostics,
// hover, go to definition, completion, quick fixes, the `mtek-prelude:` documents) is the server's
// (decision 0076); this file starts the process, keeps it running and says clearly when it cannot.
//
// The `mtek-prelude:` documents need no code here: the server advertises
// `workspace.textDocumentContent` (schemes `["mtek-prelude"]`, LSP 3.18) and `vscode-languageclient`
// registers a read-only `TextDocumentContentProvider` for each scheme it lists, which sends the
// `workspace/textDocumentContent` request. The integration test opens one to prove it.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { LanguageClient, State } from "vscode-languageclient/node";
import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { DEFAULT_SERVER_PATH, SERVER_ARGS, resolveServer } from "./server.ts";

const CLIENT_ID = "mtek";
const CLIENT_NAME = "Mtek Language Server";

/** What the extension returns from `activate`; the integration tests (and only they) use it. */
export interface MtekExtensionApi {
  /** The running client, or undefined when the server could not be started. */
  client(): LanguageClient | undefined;
  /** Resolves when the start that is in progress has finished (the client is running, or it failed). */
  settled(): Promise<void>;
  /** The message shown when the server could not be started, until the next successful start. */
  lastError(): string | undefined;
  /** How the most recent server process that has ended ended (exit status 0 after `shutdown` and `exit`). */
  lastExit(): ServerExit | undefined;
}

export interface ServerExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** How long a server gets to end after `shutdown` and `exit` before it is killed. */
const EXIT_GRACE_MS = 5000;

class MtekExtension implements MtekExtensionApi {
  private current: LanguageClient | undefined;
  private failure: string | undefined;
  private exit: ServerExit | undefined;
  /** The process of the current client and the promise of its end. */
  private process: { readonly child: ChildProcess; readonly ended: Promise<void> } | undefined;
  /** Starts and stops run one after the other. */
  private queue: Promise<void> = Promise.resolve();
  private readonly output: vscode.LogOutputChannel;

  constructor() {
    this.output = vscode.window.createOutputChannel(CLIENT_NAME, { log: true });
  }

  client(): LanguageClient | undefined {
    return this.current;
  }

  settled(): Promise<void> {
    return this.queue;
  }

  lastError(): string | undefined {
    return this.failure;
  }

  lastExit(): ServerExit | undefined {
    return this.exit;
  }

  showLog(): void {
    this.output.show(true);
  }

  dispose(): Promise<void> {
    return this.enqueue(async () => {
      await this.stopNow();
      this.output.dispose();
    });
  }

  restart(): Promise<void> {
    return this.enqueue(async () => {
      await this.stopNow();
      await this.startNow();
    });
  }

  start(): Promise<void> {
    return this.enqueue(() => this.startNow());
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async stopNow(): Promise<void> {
    const client = this.current;
    this.current = undefined;
    if (client === undefined) return;
    try {
      // A client that never got going has nothing to stop; one that did is shut down with
      // `shutdown` and `exit`, which is how the server ends with status 0.
      if (client.state !== State.Stopped) await client.stop();
    } catch (error) {
      this.output.warn(`Stopping the language server failed: ${describe(error)}`);
    }
    await client.dispose().catch(() => undefined);
    // The client does not own a process it did not spawn: wait for the end, then end it if need be.
    const running = this.process;
    this.process = undefined;
    if (running !== undefined && running.child.exitCode === null && running.child.signalCode === null) {
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), EXIT_GRACE_MS);
      });
      const result = await Promise.race([running.ended.then(() => "ended" as const), timedOut]);
      clearTimeout(timer);
      if (result === "timeout") {
        this.output.warn("The language server did not end after `exit`; killing it.");
        running.child.kill();
        await running.ended;
      }
    }
  }

  /** Starts the server process and tells the log how it ended. */
  private async spawnServer(command: string): Promise<ChildProcess> {
    const child = spawn(command, [...SERVER_ARGS], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const ended = new Promise<void>((resolve) => {
      child.once("close", (code, signal) => {
        this.exit = { code, signal };
        this.output.info(`The language server ended (exit code ${String(code)}, signal ${String(signal)}).`);
        resolve();
      });
      // a process that could not be spawned never closes normally
      child.once("error", () => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    this.process = { child, ended };
    return child;
  }

  private async startNow(): Promise<void> {
    const configured = vscode.workspace
      .getConfiguration("mtek")
      .get<string>("server.path", DEFAULT_SERVER_PATH);
    const resolution = resolveServer(configured, {
      platform: process.platform,
      pathVariable: process.env["PATH"],
      isFile: (file) => existsSync(file) && statSync(file).isFile(),
      join: (...parts) => path.join(...parts),
      delimiter: path.delimiter,
      isAbsolute: (file) => path.isAbsolute(file),
    });
    if (resolution.kind === "missing") {
      this.failure = resolution.message;
      this.output.error(resolution.message);
      void this.offerHelp(resolution.message);
      return;
    }

    const command = resolution.command;
    // The extension spawns the process itself (the client is given the running process), so that
    // it knows how the server ended: `mtek lsp` exits with 0 after `shutdown` and `exit`.
    const serverOptions: ServerOptions = () => this.spawnServer(command);
    const clientOptions: LanguageClientOptions = {
      // Decision 0076 item 12: `{ language: "mtek" }` over `file` URIs. Documents of the
      // `mtek-prelude` scheme are read-only content the server serves; they are never opened
      // on the server.
      documentSelector: [{ scheme: "file", language: "mtek" }],
      outputChannel: this.output,
    };
    const client = new LanguageClient(CLIENT_ID, CLIENT_NAME, serverOptions, clientOptions);
    this.output.info(`Starting ${resolution.command} ${SERVER_ARGS.join(" ")}`);
    try {
      await client.start();
    } catch (error) {
      const message = `The Mtek language server (${resolution.command}) did not start: ${describe(error)}`;
      this.failure = message;
      this.output.error(message);
      void this.offerHelp(message);
      await client.dispose().catch(() => undefined);
      this.process?.child.kill();
      this.process = undefined;
      return;
    }
    this.failure = undefined;
    this.current = client;
  }

  private async offerHelp(message: string): Promise<void> {
    const openSettings = "Open Settings";
    const showLog = "Show Log";
    const choice = await vscode.window.showErrorMessage(message, openSettings, showLog);
    if (choice === openSettings) {
      await vscode.commands.executeCommand("workbench.action.openSettings", "mtek.server.path");
    } else if (choice === showLog) {
      this.showLog();
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let extension: MtekExtension | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<MtekExtensionApi> {
  const instance = new MtekExtension();
  extension = instance;
  context.subscriptions.push(
    vscode.commands.registerCommand("mtek.restartServer", () => instance.restart()),
    vscode.commands.registerCommand("mtek.showServerLog", () => {
      instance.showLog();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("mtek.server.path")) void instance.restart();
    }),
  );
  await instance.start();
  return instance;
}

export async function deactivate(): Promise<void> {
  const instance = extension;
  extension = undefined;
  await instance?.dispose();
}
