// Download only CC0 data, pinned and integrity checked. No upstream code is used.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = JSON.parse(await readFile(new URL('./character-sources.json', import.meta.url), 'utf8'));
const folder = new URL('./source-assets/', import.meta.url);
await mkdir(folder, { recursive: true });
for (const [name, digest] of Object.entries(source.files)) {
  const response = await fetch(`https://raw.githubusercontent.com/kblood/CharacterCreator/${source.commit}/output/${name}`);
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error(`${name}: integrity mismatch`);
  await writeFile(new URL(name, folder), bytes);
}
console.log('Verified CC0 character source assets.');
