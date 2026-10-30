import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Public declarations name Uint8Array, not Node's generic Buffer, so they compile without @types/node.
const root = new URL('../dist/src/', import.meta.url).pathname;
for (const file of await readdir(root, { recursive: true })) {
  if (!file.endsWith('.d.ts')) continue;
  const path = join(root, file), text = await readFile(path, 'utf8');
  const out = text.replace(/\bBuffer<ArrayBuffer(?:Like)?>/g, 'Uint8Array');
  if (out !== text) await writeFile(path, out);
}
