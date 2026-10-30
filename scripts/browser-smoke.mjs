#!/usr/bin/env node
// The package root bundled for a browser (no Node built-in) and run in headless Chromium against mainnet, read-only.
import { builtinModules } from "node:module";
import { dirname, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = `
import { Mimir } from "@quantulabs/mimir-sdk";
globalThis.run = async (rpc) => {
  const viaApi = await new Mimir().price("SOL");
  const mimir = new Mimir(rpc ? { rpc } : { rpc: "https://api.mainnet-beta.solana.com" });
  const price = await mimir.price("COLA");
  const memo = { programAddress: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", accounts: [], data: new TextEncoder().encode("mimir") };
  const ixs = await mimir.withFreshPrice("COLA", [memo], { payer: "11111111111111111111111111111111" });
  return { api: [viaApi.ticker, viaApi.price, viaApi.quote.symbol, String(viaApi.slot)], ticker: price.ticker, price: price.price, quote: price.quote.symbol, reason: price.reason ?? null, ixs: ixs.length };
};`;
const API_SOL = { items: [{ input: "SOL", feed: { ticker: "SOL", kind: "token", address: "9vNf1NDAbcvmEDtFJB7sCLdPUTXc9GYRzyVgF8yXDL7Y",
  token: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Wrapped SOL" }, quote: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC" },
  sources: [], price: 182.41, confidenceBps: 1, dispersionBps: 1, slot: "1", updatedAt: 1 } }] };
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const bundle = await build({
  absWorkingDir: packageRoot,
  bundle: true,
  format: "iife",
  metafile: true,
  platform: "browser",
  stdin: { contents: entry, resolveDir: packageRoot, loader: "js" },
  target: "es2022",
  write: false,
});
const priceOnly = await build({
  absWorkingDir: packageRoot, bundle: true, format: "esm", splitting: true, outdir: "price-only", minify: true, metafile: true, platform: "browser",
  stdin: { contents: `import { Mimir } from "@quantulabs/mimir-sdk"; globalThis.price = (x) => new Mimir().price(x);`, resolveDir: packageRoot, loader: "js" },
  target: "es2022", write: false,
});
const loaded = new Set(["price-only/stdin.js"]);
for (const path of loaded) for (const i of priceOnly.metafile.outputs[path].imports) if (i.kind === "import-statement") loaded.add(i.path);
const kb = (paths) => Math.round([...paths].reduce((n, p) => n + priceOnly.metafile.outputs[p].bytes, 0) / 1024);
const outputs = new Map(priceOnly.outputFiles.map((f) => [relative(packageRoot, f.path), f.contents]));
const gzipKb = Math.round([...loaded].reduce((n, p) => n + gzipSync(outputs.get(p)).length, 0) / 1024);
console.log(`price()-only bundle (minified): ${kb(loaded)} KB at load (${gzipKb} KB gzip), ${kb(Object.keys(priceOnly.metafile.outputs))} KB with lazy chunks`);
if (gzipKb >= 60) throw new Error(`price() loads ${gzipKb} KB gzip, above 60 KB`);
const builtins = Object.keys(bundle.metafile.inputs).filter((path) => nodeBuiltins.has(path));
if (builtins.length > 0) throw new Error(`Browser bundle reached Node built-ins: ${JSON.stringify(builtins)}`);
const code = bundle.outputFiles[0].text;
if (!Object.keys(bundle.metafile.inputs).some((p) => p.includes("dist/src/easy/"))) throw new Error("bundle did not resolve the built package root");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e));
  // A dApp page is a secure context (crypto.subtle). The public mainnet RPC answers 403 to any web Origin, so a dApp passes its
  // own `rpc` (MIMIR_RPC); without one, the page's calls to the public RPC are forwarded without their Origin.
  await page.route("https://sdk.test/", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>mimir</title>" }));
  if (!process.env.MIMIR_RPC) {
    await page.route("https://api.mainnet-beta.solana.com/", async (route) => {
      const { origin: _origin, ...headers } = route.request().headers();
      await route.fulfill({ response: await route.fetch({ headers }), headers: { "access-control-allow-origin": "*" } });
    });
  }
  await page.route("https://api.mimirfeeds.io/**", (route) => route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(API_SOL) }));
  await page.goto("https://sdk.test/");
  if (await page.evaluate(() => typeof globalThis.Buffer !== "undefined")) throw new Error("the page has a global Buffer");
  await page.addScriptTag({ content: code });
  if (errors.length) throw errors[0];
  const result = await page.evaluate((rpc) => globalThis.run(rpc), process.env.MIMIR_RPC ?? null);
  console.log(`browser ${await page.evaluate(() => location.origin)}: api ${result.api.join(" ")}; rpc ${result.ticker} ${result.price} ${result.quote} reason=${result.reason} withFreshPrice=${result.ixs} ixs`);
  if (result.api.join() !== "SOL,182.41,USDC,1") throw new Error("expected the API price of SOL");
  if (result.price === null || result.ixs < 3) throw new Error("expected a priced feed and refresh + memo instructions");
} finally {
  await browser.close();
}
