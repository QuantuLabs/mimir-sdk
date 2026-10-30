import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const cjsRoot = new URL('../dist/cjs/', import.meta.url);
await mkdir(cjsRoot, { recursive: true });
await writeFile(
  join(cjsRoot.pathname, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
);
