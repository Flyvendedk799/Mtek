// Produces a standalone dist/ whose entry page includes pointer lock.
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const project = fileURLToPath(new URL('../', import.meta.url));
execFileSync('cargo', ['run', '--quiet', '--locked', '-p', 'mtek-cli', '--', 'build', '--release', project], { cwd: root, stdio: 'inherit' });
for (const file of ['index.html', 'style.css']) copyFileSync(new URL(`../host/${file}`, import.meta.url), new URL(`../dist/${file}`, import.meta.url));
writeFileSync(new URL('../dist/game.js', import.meta.url), readFileSync(new URL('../host/game.js', import.meta.url), 'utf8').replaceAll('../dist/', './'));
console.log('Standalone game ready: GameExamples/Night_Shift/dist/index.html (serve over HTTP).');
