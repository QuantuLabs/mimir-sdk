// The removed third-party pool index is gone from the SDK: source, built output, docs and the packed files.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const paths = ['src', 'README.md', 'docs', 'AGENTS.md', 'llms.txt', 'CHANGELOG.md', 'examples', 'tests/create', ...['dist/src', 'dist/cjs', 'dist/browser'].filter((d) => existsSync(d))];
let hits = '';
try { hits = execFileSync('grep', ['-rli', ['dex', 'screener'].join(''), ...paths], { encoding: 'utf8' }); } catch (e) { if ((e as { status?: number }).status !== 1) throw e; }
assert.equal(hits.trim(), '', `found in:\n${hits}`);
console.log('mimir no third-party pool index: ok');
