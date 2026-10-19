// The relative links of the release pages must resolve (decision 0100): a generated page that links
// to a file that was renamed, or a note that cites a file that does not exist, fails the check.
import { mismatch, type Mismatch } from "./model.ts";

export interface LinkInputs {
  /** Repository path and text of the pages whose relative links must resolve. */
  pages: readonly { path: string; text: string }[];
  exists: (path: string) => boolean;
}

function join(dir: string, target: string): string {
  const parts = (dir === "" ? [] : dir.split("/")).concat(target.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** One finding per relative link of a page that points at nothing. */
export function checkDocLinks(i: LinkInputs): Mismatch[] {
  const found: Mismatch[] = [];
  for (const page of i.pages) {
    const dir = page.path.includes("/") ? page.path.slice(0, page.path.lastIndexOf("/")) : "";
    let fenced = false;
    for (const [n, line] of page.text.split("\n").entries()) {
      if (/^```/.test(line)) fenced = !fenced;
      if (fenced) continue;
      for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = m[1] ?? "";
        if (/^[a-z]+:/.test(target) || target.startsWith("#")) continue;
        const resolved = join(dir, target.split("#")[0] ?? "");
        if (!i.exists(resolved)) {
          found.push(mismatch("docs/links", { where: `${page.path} line ${String(n + 1)}`, value: `links to ${target}` }, { where: resolved, value: "no such file" }));
        }
      }
    }
  }
  return found;
}
