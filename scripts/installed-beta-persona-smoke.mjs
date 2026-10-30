import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const personaModules = join(packageRoot, "node_modules");
const smokeRoot = mkdtempSync(join(tmpdir(), "mimir-beta-txv1-persona-"));

function filesBelow(root) {
  const files = []; const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path); else if (entry.isFile()) files.push(path);
    }
  }
  return files;
}

try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", smokeRoot], {
    cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  }));
  const packedFiles = new Set((packed[0].files ?? []).map((entry) => entry.path));
  assert.ok(packedFiles.has("dist/browser/beta.js"));
  assert.ok(![...packedFiles].some((path) => path.endsWith(".map")), "no source or declaration maps ship");
  const packedDocs = [...packedFiles].filter((path) => path === "docs" || path.startsWith("docs/"));
  assert.deepEqual(packedDocs.sort(), ["docs/ADVANCED.md", "docs/QUICKSTART.md"]);
  const tarball = join(smokeRoot, packed[0].filename);
  execFileSync("npm", ["install", "--prefix", smokeRoot, tarball, "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund"], { stdio: "inherit" });
  const installedSdk = join(smokeRoot, "node_modules/@quantulabs/mimir-sdk");
  if (lstatSync(installedSdk).isSymbolicLink() || !realpathSync(installedSdk).startsWith(realpathSync(smokeRoot))) {
    throw new Error("Persona must consume a copied packed SDK");
  }
  const readme = readFileSync(join(installedSdk, "README.md"), "utf8");
  const quickstart = readme.match(/\[[^\]]*\]\((\.\/docs\/QUICKSTART\.md)\)/)?.[1];
  if (!quickstart || resolve(installedSdk, quickstart) !== join(installedSdk, "docs/QUICKSTART.md")) {
    throw new Error("Packed README quickstart link is invalid");
  }

  const app = join(smokeRoot, "app"); mkdirSync(join(app, "src/lib"), { recursive: true }); mkdirSync(join(app, "src/routes"), { recursive: true });
  const appModules = join(app, "node_modules"); mkdirSync(appModules);
  for (const entry of readdirSync(personaModules, { withFileTypes: true })) {
    if (entry.name === "@quantulabs" || entry.name === ".vite-temp") continue;
    symlinkSync(join(personaModules, entry.name), join(appModules, entry.name), entry.isDirectory() ? "dir" : "file");
  }
  mkdirSync(join(appModules, "@quantulabs"));
  symlinkSync(installedSdk, join(appModules, "@quantulabs/mimir-sdk"), "dir");
  assert.equal(JSON.parse(readFileSync(join(appModules, "@solana/kit/package.json"), "utf8")).version, "5.5.1");
  writeFileSync(join(app, "package.json"), JSON.stringify({ private: true, type: "module" }));
  writeFileSync(join(app, "svelte.config.js"), `import adapter from "@sveltejs/adapter-static"; export default { kit: { adapter: adapter({ fallback: "200.html" }) } };`);
  const browserArtifact = join(installedSdk, "dist/browser/beta.js");
  writeFileSync(join(app, "vite.config.ts"), `import { sveltekit } from "@sveltejs/kit/vite"; import { defineConfig } from "vite";
    export default defineConfig({ build: { sourcemap: true }, plugins: [sveltekit()] });`);
  writeFileSync(join(app, "tsconfig.json"), JSON.stringify({ extends: "./.svelte-kit/tsconfig.json", compilerOptions: {
    allowJs: true, checkJs: true, esModuleInterop: true, skipLibCheck: false, strict: true, moduleResolution: "bundler",
  } }));
  writeFileSync(join(app, "src/app.html"), `<!doctype html><html><head>%sveltekit.head%</head><body><div style="display: contents">%sveltekit.body%</div></body></html>`);
  writeFileSync(join(app, "src/lib/persona.ts"), `
    import type { Address } from "@solana/kit";
    import {
      MIMIR_BETA_AGENT_URI_MAX_UTF8_BYTES,
      MIMIR_BETA_MPL_CORE_PROGRAM_ID,
      MIMIR_BETA_SYSTEM_PROGRAM_ID,
      compileMimirBetaTransactionV1,
      createMimir8004IdentityAdapter,
      createMimirBetaClient,
      partiallySignMimirBetaTransactionV1,
      verifyMimirBetaWalletSignedTransactionV1,
      admitMimirBetaWalletSignedTransactionV1,
      admitMimirBetaWalletSignedBatchV1,
      type MimirBetaPlanningRpc,
      type MimirBetaPoolDiscovery,
    } from "@quantulabs/mimir-sdk/beta";
    const a = (value: string) => value as Address;
    const deployment = { cluster: "localnet" as const, mimirProgramId: a("11111111111111111111111111111112"),
      agentRegistryProgramId: a("11111111111111111111111111111113"), mplCoreProgramId: MIMIR_BETA_MPL_CORE_PROGRAM_ID,
      systemProgramId: MIMIR_BETA_SYSTEM_PROGRAM_ID, tokenProgramId: a("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      physicalCollection: a("11111111111111111111111111111114"), collectionPointer: "c1:bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
    const pending = <T>(value: T) => ({ send: async () => value });
    const rpc = { getAccountInfo: () => pending(null), getMultipleAccounts: () => pending(null), getLatestBlockhash: () => pending(null),
      simulateTransaction: () => pending(null) } as unknown as MimirBetaPlanningRpc;
    const discovery = { listPoolSources: async () => [], searchSpotPools: async () => { throw new Error("inert"); },
      revalidateSelectedPools: async () => { throw new Error("inert"); } } as unknown as MimirBetaPoolDiscovery;
    export const client = createMimirBetaClient({ deployment, rpc, discovery, identity: createMimir8004IdentityAdapter(deployment) });
    export const rawHelpers = [compileMimirBetaTransactionV1, partiallySignMimirBetaTransactionV1, verifyMimirBetaWalletSignedTransactionV1,
      admitMimirBetaWalletSignedTransactionV1, admitMimirBetaWalletSignedBatchV1];
    const transaction = await compileMimirBetaTransactionV1({ feePayer: a("11111111111111111111111111111111"),
      recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1n,
      instructions: [{ programAddress: a("11111111111111111111111111111112"), accounts: [], data: Uint8Array.of(7) }] });
    export const receipt = \`txv1:\${transaction.messageVersion}:\${transaction.serializedMessage[0]}:\${transaction.serializedTransaction[0]}\`;
    if (receipt !== "txv1:1:129:129") throw new Error("TxV1 browser receipt mismatch: " + receipt);
    if (MIMIR_BETA_AGENT_URI_MAX_UTF8_BYTES !== 54) throw new Error("agent URI cap mismatch");
  `);
  writeFileSync(join(app, "src/routes/+page.ts"), `import { client } from "$lib/persona"; export const prerender = true; export function load() { return { methods: Object.keys(client).length }; }`);
  writeFileSync(join(app, "src/routes/+page.svelte"), `<script lang="ts">import { rawHelpers, receipt } from "$lib/persona"; let { data } = $props();</script><h1>{receipt}:{data.methods}:{rawHelpers.length}</h1>`);
  execFileSync(join(personaModules, ".bin/svelte-kit"), ["sync"], { cwd: app, stdio: "inherit" });
  execFileSync(join(personaModules, ".bin/tsc"), ["--noEmit", "--project", "tsconfig.json"], { cwd: app, stdio: "inherit" });
  execFileSync(join(personaModules, ".bin/vite"), ["build"], { cwd: app, stdio: "inherit" });
  assert.match(readFileSync(join(app, "build/index.html"), "utf8"), /txv1:1:129:129/);
  const clientMaps = filesBelow(join(app, "build/_app/immutable")).filter((path) => path.endsWith(".map"));
  const mappedSources = clientMaps.flatMap((path) => {
    const map = JSON.parse(readFileSync(path, "utf8"));
    return (map.sources ?? []).map((source, index) => ({ source, content: map.sourcesContent?.[index] ?? "" }));
  });
  const betaBrowserSources = mappedSources.filter(({ source }) => source.endsWith("node_modules/@quantulabs/mimir-sdk/dist/browser/beta.js"));
  assert.ok(betaBrowserSources.length > 0, "Client source maps must select the packed beta browser artifact");
  assert.ok(mappedSources.every(({ source }) => !/@solana\/(?:transaction-messages|transactions)\//.test(source)));
  const browserSdk = await import(pathToFileURL(browserArtifact).href);
  const browserTransaction = await browserSdk.compileMimirBetaTransactionV1({
    feePayer: "11111111111111111111111111111111", recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1n,
    instructions: [{ programAddress: "11111111111111111111111111111112", accounts: [], data: Uint8Array.of(7) }],
  });
  assert.equal(`txv1:${browserTransaction.messageVersion}:${browserTransaction.serializedMessage[0]}:${browserTransaction.serializedTransaction[0]}`, "txv1:1:129:129");

  const betaDeclarations = join(installedSdk, "dist/src/beta");
  const declarationText = filesBelow(betaDeclarations).filter((path) => path.endsWith(".d.ts")).map((path) => readFileSync(path, "utf8")).join("\n");
  for (const required of ["compileMimirBetaTransactionV1", "partiallySignMimirBetaTransactionV1", "verifyMimirBetaWalletSignedTransactionV1",
    "admitMimirBetaWalletSignedTransactionV1", "prepareMimirBetaCompositeFeedJourney", "prepareCompositeFeedJourney"]) {
    if (!declarationText.includes(required)) throw new Error(`Packed declaration missing ${required}`);
  }
  for (const forbidden of ["legacyV0Adapter", "SuppliedLookupTableAccount", "lookupTableProgramId"]) {
    if (declarationText.includes(forbidden)) throw new Error(`Packed beta declaration leaks ${forbidden}`);
  }
  execFileSync(process.execPath, ["--input-type=module", "--eval", `
    const esm = await import("@quantulabs/mimir-sdk/beta");
    const { createRequire } = await import("node:module");
    const cjs = createRequire(import.meta.url)("@quantulabs/mimir-sdk/beta");
    for (const sdk of [esm, cjs]) for (const name of ["createMimirBetaClient", "compileMimirBetaTransactionV1", "partiallySignMimirBetaTransactionV1", "verifyMimirBetaWalletSignedTransactionV1", "admitMimirBetaWalletSignedTransactionV1", "admitMimirBetaWalletSignedBatchV1", "prepareMimirBetaCompositeFeedJourney"]) {
      if (typeof sdk[name] !== "function") throw new Error("packed beta export missing: " + name);
    }
  `], { cwd: app, stdio: "inherit" });
  console.log(JSON.stringify({ installedBetaPersona: "txv1:1:129:129", rootKit: "5.5.1", browserArtifact, clientSourceMaps: clientMaps.length }));
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
