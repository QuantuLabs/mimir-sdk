#!/usr/bin/env node

import { builtinModules } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const result = await build({
  absWorkingDir: packageRoot,
  bundle: true,
  entryPoints: ["src/beta/index.ts"],
  format: "esm",
  legalComments: "none",
  metafile: true,
  outfile: "dist/browser/beta.js",
  platform: "browser",
  target: "es2022",
});
const inputs = Object.keys(result.metafile.inputs).map((path) =>
  nodeBuiltins.has(path) ? path : resolve(packageRoot, path)
);
const forbidden = inputs.filter((path) =>
  nodeBuiltins.has(path) || path.includes(`${sep}node_modules${sep}@solana${sep}web3.js${sep}`)
);
if (forbidden.length > 0) throw new Error(`Beta browser bundle reached forbidden inputs: ${JSON.stringify(forbidden)}`);

// The v1 entry's eager graph (the lazily imported refresh preparers excluded) must stay browser-safe too.
const v1 = await build({
  absWorkingDir: packageRoot,
  bundle: true,
  entryPoints: ["src/v1/index.ts"],
  format: "esm",
  metafile: true,
  platform: "browser",
  plugins: [{ name: "lazy-v1-refresh", setup: (b) => b.onResolve({ filter: /^\.\/refresh\.js$/ }, (a) => a.kind === "dynamic-import" ? { path: a.path, external: true } : undefined) }],
  target: "es2022",
  write: false,
});
const v1Forbidden = Object.keys(v1.metafile.inputs).filter((path) =>
  nodeBuiltins.has(path) || path.includes(`node_modules${sep}@solana${sep}web3.js${sep}`) || /src[\\/](existingFeedRows|sourceGraph)\.ts$/.test(path)
);
if (v1Forbidden.length > 0) throw new Error(`V1 entry reached Node-only inputs: ${JSON.stringify(v1Forbidden)}`);

// The ./create entry's static graph (the lazily imported facade excluded) must load no beta file.
const create = await build({
  absWorkingDir: packageRoot,
  bundle: true,
  entryPoints: ["src/create/index.ts"],
  format: "esm",
  metafile: true,
  platform: "browser",
  plugins: [{ name: "lazy-create-facade", setup: (b) => b.onResolve({ filter: /^\.\/facade\.js$/ }, (a) => a.kind === "dynamic-import" ? { path: a.path, external: true } : undefined) }],
  target: "es2022",
  write: false,
});
const createBeta = Object.keys(create.metafile.inputs).filter((path) => /src[\\/]beta[\\/]/.test(path));
if (createBeta.length > 0) throw new Error(`./create static graph reached beta inputs: ${JSON.stringify(createBeta)}`);

// The package root (the easy API) must bundle for a browser with no Node built-in, its lazy refresh path included.
const root = await build({
  absWorkingDir: packageRoot,
  bundle: true,
  entryPoints: ["src/root.ts"],
  format: "esm",
  metafile: true,
  platform: "browser",
  target: "es2022",
  write: false,
});
const rootForbidden = Object.keys(root.metafile.inputs).filter((path) => nodeBuiltins.has(path));
if (rootForbidden.length > 0) throw new Error(`Package root reached Node built-ins: ${JSON.stringify(rootForbidden)}`);
