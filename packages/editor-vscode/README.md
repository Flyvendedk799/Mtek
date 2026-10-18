# Mtek for VS Code

Language support for [Mtek](https://github.com/flyvendedk799/mtek) (`.mtek` files):

- syntax highlighting (a TextMate grammar generated from the language's reference grammar),
- comments, brackets, auto-closing pairs and indentation that match `mtek fmt`,
- the language server `mtek lsp`: diagnostics with quick fixes, hover, go to definition (also into
  the standard library, shown as read-only `mtek-prelude:` documents) and completion.

The extension contains no language logic: everything but the highlighting is the `mtek` executable.

## Requirements

The `mtek` executable on `PATH`, or the setting **`mtek.server.path`** set to the path of one. If it
cannot be found the extension says so (a message with an *Open Settings* button, and a line in the
**Mtek Language Server** output channel); it does not fail silently.

## Settings and commands

| Name | |
|---|---|
| `mtek.server.path` | The executable started as `mtek lsp` (default `mtek`, looked up on `PATH`). Changing it restarts the server. Not honoured from the settings of an untrusted workspace. |
| `mtek.trace.server` | `messages` or `verbose`: how much of the protocol traffic the output channel shows once its log level is set to *Trace*. |
| *Mtek: Restart Language Server* | Stops the server (`shutdown`, `exit`) and starts a new one. |
| *Mtek: Show Language Server Log* | Shows the output channel. |

This package is built and tested in the Mtek repository (`packages/editor-vscode`, decision 0090). It
is not published to a marketplace.
