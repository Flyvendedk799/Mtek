import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
// Tests exercise the public distribution, including on a checkout without dist/.
const npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error("Run tests through npm run test:unit -w @mtek/inspector");
execFileSync(process.execPath,[npmCli,"run","build","-w","@mtek/runtime-web"],{cwd:resolve(import.meta.dirname,"../../.."),stdio:"pipe",windowsHide:true});
