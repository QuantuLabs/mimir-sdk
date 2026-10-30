#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { builtinModules } from "node:module";
import { build } from "esbuild";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
const betaExport = manifest.exports?.["./beta"];
if (typeof betaExport?.browser !== "string" || typeof betaExport?.import !== "string" || typeof betaExport?.require !== "string") {
  throw new Error("Package ./beta export must define concrete browser, import, and require targets");
}
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

const forbidden = [
  { name: "@solana/web3.js", matches: (path) => path.includes(`${sep}node_modules${sep}@solana${sep}web3.js${sep}`) },
  { name: "src/codec", matches: (path) => /(?:^|\/)src\/codec\.js$/.test(path.replaceAll(sep, "/")) },
  { name: "src/instructions", matches: (path) => /(?:^|\/)src\/instructions\.js$/.test(path.replaceAll(sep, "/")) },
  { name: "src/v0Alt", matches: (path) => /(?:^|\/)src\/v0Alt\.js$/.test(path.replaceAll(sep, "/")) },
  { name: "src/constants", matches: (path) => /(?:^|\/)src\/constants\.js$/.test(path.replaceAll(sep, "/")) },
  { name: "Node builtin", matches: (path) => nodeBuiltins.has(path) },
];

const results = [];
for (const [format, target] of [["esm", betaExport.import], ["cjs", betaExport.require]]) {
  const entry = resolve(packageRoot, target);
  const result = await build({
    absWorkingDir: packageRoot,
    bundle: true,
    entryPoints: [entry],
    format,
    logLevel: "silent",
    metafile: true,
    platform: "browser",
    write: false,
  });
  const inputs = Object.keys(result.metafile.inputs).map((path) => nodeBuiltins.has(path) ? path : resolve(packageRoot, path));
  const violations = forbidden.flatMap(({ name, matches }) => inputs.filter(matches).map((path) => ({ name, path })));
  if (violations.length > 0) {
    throw new Error(`${format.toUpperCase()} ./beta runtime graph reached forbidden inputs: ${JSON.stringify(violations)}`);
  }
  results.push({ format, target, inputCount: inputs.length, violationCount: violations.length });
}

const browserArtifact = resolve(packageRoot, betaExport.browser);
const browserSource = await readFile(browserArtifact, "utf8");
assert.doesNotMatch(browserSource, /(?:from|import)\s*["'](?:@solana\/|node:)/);
assert.doesNotMatch(browserSource, /@solana\/web3\.js/);
for (const name of ["transaction-messages", "transactions"]) {
  const dependency = JSON.parse(await readFile(resolve(packageRoot, `node_modules/@solana/${name}/package.json`), "utf8"));
  assert.equal(dependency.version, "7.0.0");
}
const browserSdk = await import(pathToFileURL(browserArtifact).href);
const transaction = await browserSdk.compileMimirBetaTransactionV1({
  feePayer: "11111111111111111111111111111111",
  recentBlockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 1n,
  instructions: [{
    programAddress: "11111111111111111111111111111112",
    accounts: [],
    data: Uint8Array.of(7),
  }],
});
assert.equal(transaction.messageVersion, 1);
assert.equal(transaction.serializedMessage[0], 0x81);
assert.equal(transaction.serializedTransaction[0], 0x81);
assert.deepEqual(transaction.config, { computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 64 * 1024 * 1024, priorityFeeLamports: 14_000n });
assert.deepEqual(transaction.packet, {
  packetLimitBytes: 4096,
  serializedMessageBytes: transaction.serializedMessage.length,
  serializedTransactionBytes: transaction.serializedTransaction.length,
  accountCount: 2,
  instructionCount: 1,
  signatureCount: 1,
  config: transaction.config,
  fitsPacketLimit: true,
});

console.log(JSON.stringify({
  betaRuntimeGraph: results,
  browser: { target: betaExport.browser, receipt: "txv1:1:129:129" },
  violationCount: 0,
}));
