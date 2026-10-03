// Minimal static file server for browser tests: Node `http` only, bound to 127.0.0.1, no caching.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".wgsl": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
};

export function mimeTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export interface StaticServer {
  /** Base URL without a trailing slash, for example `http://127.0.0.1:41234`. */
  url: string;
  close(): Promise<void>;
}

/** Maps a request path to a file below `root`, or null when it would leave `root`. */
export function resolveRequestPath(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, "." + (decoded.startsWith("/") ? decoded : "/" + decoded));
  if (target !== absoluteRoot && !target.startsWith(absoluteRoot + sep)) return null;
  return target;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) resolveClose();
      else rejectClose(error);
    });
    server.closeAllConnections();
  });
}

/** Serves `root` on 127.0.0.1. `port` 0 picks a free port. */
export async function startStaticServer(root: string, port = 0): Promise<StaticServer> {
  const server = createServer((request, response) => {
    void (async () => {
      const send = (status: number, message: string): void => {
        response.writeHead(status, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(message);
      };
      if (request.method !== "GET" && request.method !== "HEAD") {
        send(405, "method not allowed");
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      let file = resolveRequestPath(root, url.pathname);
      if (file === null) {
        send(400, "bad request path");
        return;
      }
      try {
        let info = await stat(file);
        if (info.isDirectory()) {
          file = resolve(file, "index.html");
          info = await stat(file);
        }
        response.writeHead(200, {
          "Content-Type": mimeTypeFor(file),
          "Content-Length": info.size,
          "Cache-Control": "no-store",
        });
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        createReadStream(file).on("error", () => response.destroy()).pipe(response);
      } catch {
        send(404, `not found: ${url.pathname}`);
      }
    })();
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, close: () => closeServer(server) };
}
