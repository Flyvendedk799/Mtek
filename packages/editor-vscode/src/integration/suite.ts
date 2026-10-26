// The integration suite: runs inside a real VS Code (the extension host), against the real
// `mtek lsp`, through the real `vscode-languageclient`. Started by `scripts/run-vscode-tests.ts`,
// which opens a temporary project (src/integration/fixture.ts) as the workspace folder, points
// the user setting `mtek.server.path` at the binary and bundles this file to
// `dist/test/suite.cjs`. VS Code calls `run()`.
//
// Every test stands on the one before it (one server, one project), so they run in order; the
// first failure does not stop the others, and the list of results is written to the file named
// by MTEK_TEST_RESULTS for the runner to check.
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { MtekExtensionApi } from "../extension.ts";
import { EXPECTED, PROJECT_FILES } from "./fixture.ts";

const EXTENSION_ID = "mtek.mtek-vscode";
const TIMEOUT_MS = 60_000;

interface Outcome {
  readonly name: string;
  readonly ok: boolean;
  readonly error?: string;
}

const tests: { name: string; body: () => Promise<void> }[] = [];
const test = (name: string, body: () => Promise<void>): void => {
  tests.push({ name, body });
};

async function waitFor<T>(
  description: string,
  probe: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function projectRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "the test project is not open as the workspace folder");
  return folder.uri.fsPath;
}

const fileUri = (relative: string): vscode.Uri => vscode.Uri.file(path.join(projectRoot(), relative));
const pos = ([line, character]: readonly [number, number]): vscode.Position =>
  new vscode.Position(line, character);

function codeOf(diagnostic: vscode.Diagnostic): string {
  const code = diagnostic.code;
  return typeof code === "object" ? String(code.value) : String(code);
}

function hoverText(hovers: vscode.Hover[]): string {
  return hovers
    .flatMap((hover) => hover.contents)
    .map((content) => (typeof content === "string" ? content : content.value))
    .join("\n");
}

let api: MtekExtensionApi;
let main: vscode.TextDocument;

/** Replace the whole text of a document through the editor (an unsaved change, as typing is). */
async function setText(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const whole = new vscode.Range(0, 0, document.lineCount, 0);
  edit.replace(document.uri, whole, text);
  assert.ok(await vscode.workspace.applyEdit(edit), "the edit was refused");
}

async function runningClient() {
  return waitFor("the language client to be running", () => {
    const client = api.client();
    return client?.isRunning() === true ? client : undefined;
  });
}

test("activates on a .mtek file and starts `mtek lsp` with the capabilities of decision 0076", async () => {
  main = await vscode.workspace.openTextDocument(fileUri("src/main.mtek"));
  // A document nobody shows is released by VS Code (and closed on the server) soon after it was
  // opened; a user has it in an editor, so the test has it in one too.
  await vscode.window.showTextDocument(main);
  assert.equal(main.languageId, "mtek");
  const extension = vscode.extensions.getExtension<MtekExtensionApi>(EXTENSION_ID);
  assert.ok(extension, `the extension ${EXTENSION_ID} is not installed in the test host`);
  api = await extension.activate();
  await api.settled();
  assert.equal(api.lastError(), undefined);
  const client = await runningClient();
  const capabilities = client.initializeResult?.capabilities;
  assert.ok(capabilities, "no initialize result");
  assert.equal(capabilities.positionEncoding, "utf-16");
  assert.ok(capabilities.hoverProvider);
  assert.ok(capabilities.definitionProvider);
  assert.ok(capabilities.codeActionProvider);
  assert.ok(capabilities.completionProvider?.triggerCharacters?.includes("."));
  const workspaceCapabilities = capabilities.workspace as { textDocumentContent?: { schemes?: string[] } };
  assert.deepEqual(workspaceCapabilities.textDocumentContent?.schemes, ["mtek-prelude"]);
});

test("publishes the diagnostics of the open file with exact ranges (UTF-16, after an emoji)", async () => {
  const diagnostics = await waitFor("diagnostics for src/main.mtek", () => {
    const list = vscode.languages.getDiagnostics(main.uri);
    return list.length > 0 ? list : undefined;
  });
  assert.equal(
    diagnostics.length,
    2,
    `expected 2 diagnostics, got ${JSON.stringify(diagnostics.map((d) => [codeOf(d), d.message]))}`,
  );
  const range = (d: vscode.Diagnostic): number[] => [
    d.range.start.line,
    d.range.start.character,
    d.range.end.line,
    d.range.end.character,
  ];
  const float = diagnostics.find((d) => codeOf(d) === EXPECTED.floatError.code);
  const unknown = diagnostics.find((d) => codeOf(d) === EXPECTED.unknownName.code);
  assert.ok(float, `no ${EXPECTED.floatError.code} in ${JSON.stringify(diagnostics.map(codeOf))}`);
  assert.ok(unknown, `no ${EXPECTED.unknownName.code}`);
  assert.deepEqual(range(float), [...EXPECTED.floatError.start, ...EXPECTED.floatError.end]);
  assert.deepEqual(range(unknown), [...EXPECTED.unknownName.start, ...EXPECTED.unknownName.end]);
  assert.equal(float.severity, vscode.DiagnosticSeverity.Error);
  assert.equal(float.source, "mtek");
});

test("hover shows the declaration and its documentation, from the other module", async () => {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    main.uri,
    pos(EXPECTED.importedName),
  );
  const text = hoverText(hovers);
  assert.match(text, /fn double\(x: f32\) -> f32/);
  assert.match(text, /Doubles a number\./);
});

test("go to definition leaves the file for the module that declares the name", async () => {
  const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
    "vscode.executeDefinitionProvider",
    main.uri,
    pos(EXPECTED.importedName),
  );
  assert.equal(definitions.length, 1);
  const [definition] = definitions;
  const uri = definition && "targetUri" in definition ? definition.targetUri : definition?.uri;
  const range = definition && "targetUri" in definition ? definition.targetSelectionRange : definition?.range;
  assert.equal(uri?.fsPath, fileUri("src/lib.mtek").fsPath);
  assert.deepEqual(
    [range?.start.line, range?.start.character, range?.end.line, range?.end.character],
    [...EXPECTED.libDefinition.start, ...EXPECTED.libDefinition.end],
  );
});

test("a name of the standard library goes to an mtek-prelude: document the server serves", async () => {
  const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
    "vscode.executeDefinitionProvider",
    main.uri,
    pos(EXPECTED.registryName),
  );
  const [definition] = definitions;
  const uri = definition && "targetUri" in definition ? definition.targetUri : definition?.uri;
  assert.ok(uri, "no definition for `Box`");
  assert.equal(uri.scheme, "mtek-prelude");
  assert.equal(uri.path, "/std/prelude.mtek");

  // Opening it asks the server (`workspace/textDocumentContent`); the text is the generated reference.
  const document = await vscode.workspace.openTextDocument(uri);
  assert.match(document.getText(), /schema Box/);
  assert.equal(document.languageId, "mtek");
  assert.equal(document.isUntitled, false);
  assert.equal(document.isDirty, false);

  // Read-only: typing into the editor of a document a content provider owns changes nothing.
  // (`applyEdit` is not the test: the extension API can edit the model, only the editor is read-only.)
  // The control: the same typing does change an ordinary document, so the check below can fail.
  const scratch = await vscode.workspace.openTextDocument({ language: "mtek", content: "" });
  await vscode.window.showTextDocument(scratch);
  await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  await new Promise((resolve) => setTimeout(resolve, 500));
  await vscode.commands.executeCommand("type", { text: "x" });
  await waitFor("typing to change an ordinary document", () => scratch.getText() === "x" || undefined, 10_000);
  const before = document.getText();
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  await new Promise((resolve) => setTimeout(resolve, 500));
  await vscode.commands.executeCommand("type", { text: "x" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(document.getText(), before, "typing changed an mtek-prelude: document");
  assert.equal(document.isDirty, false);

  // The materials the compiler compiles, byte for byte, are the other document.
  const materials = await vscode.workspace.openTextDocument(vscode.Uri.parse("mtek-prelude:/std/materials.mtek"));
  assert.match(materials.getText(), /material Unlit/);
});

test("completion works on unsaved text and diagnostics follow the typing", async () => {
  const original = main.getText();
  const typing = original.replace("const B: f32 = Unknown;", "const B: bool = Key.;");
  assert.notEqual(typing, original);
  await setText(main, typing);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    main.uri,
    new vscode.Position(2, 20),
  );
  const labels = completions.items.map((item) => (typeof item.label === "string" ? item.label : item.label.label));
  assert.ok(labels.includes("Space"), `no \`Space\` among ${labels.length} items: ${labels.slice(0, 10).join(", ")}`);

  // `Unknown` is gone from the text: its diagnostic is gone from the file, with no save.
  await waitFor("the E2003 diagnostic to go", () =>
    vscode.languages.getDiagnostics(main.uri).every((d) => codeOf(d) !== EXPECTED.unknownName.code) || undefined,
  );
  await setText(main, original);
  await waitFor("the E2003 diagnostic to come back", () =>
    vscode.languages.getDiagnostics(main.uri).some((d) => codeOf(d) === EXPECTED.unknownName.code) || undefined,
  );
});

test("the quick fix of a diagnostic, applied, fixes the program", async () => {
  const diagnostics = vscode.languages.getDiagnostics(main.uri);
  const float = diagnostics.find((d) => codeOf(d) === EXPECTED.floatError.code);
  assert.ok(float);
  const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
    "vscode.executeCodeActionProvider",
    main.uri,
    float.range,
    vscode.CodeActionKind.QuickFix.value,
  );
  const fix = actions.find((action) => action.title === "write the float literal as `1.0`");
  assert.ok(fix, `no fix among ${JSON.stringify(actions.map((a) => a.title))}`);
  assert.ok(fix.edit);
  assert.ok(await vscode.workspace.applyEdit(fix.edit));
  assert.match(main.getText(), /const A: f32 = 1\.0;/);
  await waitFor("only the unknown-name diagnostic to remain", () => {
    const codes = vscode.languages.getDiagnostics(main.uri).map(codeOf);
    return codes.length === 1 && codes[0] === EXPECTED.unknownName.code ? true : undefined;
  });
  await setText(main, PROJECT_FILES["src/main.mtek"] ?? "");
  await waitFor("both diagnostics to return", () => vscode.languages.getDiagnostics(main.uri).length === 2 || undefined);
});

test("a change on disk to a module that is not open reaches the diagnostics (file watching)", async () => {
  const lib = fileUri("src/lib.mtek");
  assert.equal(vscode.languages.getDiagnostics(lib).length, 0);
  const original = PROJECT_FILES["src/lib.mtek"] ?? "";
  // not an open document: only the file system tells VS Code, and VS Code tells the server
  fs.writeFileSync(lib.fsPath, `${original}const Broken: f32 = ;\n`);
  try {
    await waitFor("a diagnostic for src/lib.mtek", () => vscode.languages.getDiagnostics(lib).length > 0 || undefined);
  } finally {
    fs.writeFileSync(lib.fsPath, original);
  }
  await waitFor("the diagnostics of src/lib.mtek to clear", () => vscode.languages.getDiagnostics(lib).length === 0 || undefined);
});

test("`Mtek: Restart Language Server` ends the server with exit code 0 and starts a new one", async () => {
  const before = await runningClient();
  assert.equal(api.lastExit(), undefined, "a server ended before the restart");
  await vscode.commands.executeCommand("mtek.restartServer");
  await api.settled();
  const after = await runningClient();
  assert.notStrictEqual(after, before);
  // `shutdown` then `exit`: the status of a server that was asked to end (spec/tooling.md section 7)
  assert.deepEqual(api.lastExit(), { code: 0, signal: null });
  // the open document was sent to the new server: its diagnostics are back
  await waitFor("the diagnostics of the new server", () => vscode.languages.getDiagnostics(main.uri).length === 2 || undefined);
});

test("Enter indents expression continuations and restores statement and argument indentation", async () => {
  const cases = [
    ["fn demo() {\n    return input.index", "", 8],
    ["fn demo() {\n    return input.index\n        + input.global_x", "", 8],
    ["fn demo() {\n    return input.index\n        + input.global_x;", "", 4],
    ["fn demo() {\n    return color.linear(\n        sample(image, filter, uv).xyz", "", 12],
    ["fn demo() {\n    return color.linear(\n        sample(image, filter, uv).xyz\n            * gain,", "", 8],
    ["fn demo() {\n    // expression", "", 4],
    ["fn demo() {\n    let value = 1.0;", "", 4],
  ] as const;
  for (const [before, after, spaces] of cases) {
    const document = await vscode.workspace.openTextDocument({ language: "mtek", content: before + after });
    const editor = await vscode.window.showTextDocument(document);
    editor.options = { insertSpaces: true, tabSize: 4 };
    const cursor = document.positionAt(before.length);
    editor.selection = new vscode.Selection(cursor, cursor);
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    await vscode.commands.executeCommand("type", { text: "\n" });
    assert.equal(document.getText(), `${before}\n${" ".repeat(spaces)}${after}`, before);
  }
});

test("a missing executable is an error message, not a silent failure, and fixing the setting recovers", async () => {
  const configuration = vscode.workspace.getConfiguration("mtek");
  const inspected = configuration.inspect<string>("server.path");
  const good = inspected?.globalValue;
  assert.ok(good, "the runner did not set mtek.server.path");
  const missing = path.join(projectRoot(), "no-such-directory", "mtek");
  await configuration.update("server.path", missing, vscode.ConfigurationTarget.Global);
  try {
    const message = await waitFor("the missing-executable error", () => api.lastError());
    assert.ok(message.includes(missing), message);
    assert.ok(message.includes("mtek.server.path"), message);
    assert.equal(api.client(), undefined);
  } finally {
    await configuration.update("server.path", good, vscode.ConfigurationTarget.Global);
  }
  await waitFor("the server to run again", () => (api.lastError() === undefined && api.client()?.isRunning() === true) || undefined);
  await waitFor("the diagnostics again", () => vscode.languages.getDiagnostics(main.uri).length === 2 || undefined);
});

export async function run(): Promise<void> {
  const outcomes: Outcome[] = [];
  for (const { name, body } of tests) {
    try {
      await body();
      outcomes.push({ name, ok: true });
    } catch (error) {
      const text = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
      outcomes.push({ name, ok: false, error: text });
    }
  }
  const resultsFile = process.env["MTEK_TEST_RESULTS"];
  if (resultsFile !== undefined) fs.writeFileSync(resultsFile, JSON.stringify(outcomes, null, 2));
  const failed = outcomes.filter((outcome) => !outcome.ok);
  for (const outcome of outcomes) {
    console.log(`${outcome.ok ? "ok  " : "FAIL"} ${outcome.name}${outcome.ok ? "" : `\n${outcome.error ?? ""}`}`);
  }
  if (failed.length > 0) throw new Error(`${failed.length} of ${outcomes.length} integration tests failed`);
}
