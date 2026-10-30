import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock } from "node:test";

// getPrices live path: stored reads and the simulation mocked at the RPC; refresh planning mocked at the module.
const fx = JSON.parse(readFileSync(new URL("../fixtures/hbyr/accounts.json", import.meta.url), "utf8")) as {
  slot: number; accounts: Record<string, { magic: string; owner: string; executable: boolean; data: string }> };
const HBYR = "hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR";
const SOL = "F5fXuWuVFwBF3eBVtFkxXS5PMY651uVQ1bL4W4mse5Qj";
const OTHER = Object.keys(fx.accounts).find((k) => k !== SOL && fx.accounts[k]!.magic === "MIMIRSNP")!;
const refreshUrl = new URL("../../src/v1/refresh.ts", import.meta.url), refresh = await import(refreshUrl.href);
let inflight = 0, peak = 0;
const prepared = async () => { peak = Math.max(peak, ++inflight); await new Promise((r) => setTimeout(r, 5)); inflight--; return { instruction: { programAddress: HBYR, accounts: [], data: Uint8Array.of(89) }, computeUnitLimit: 300_000, contextSlot: 1n }; };
mock.module(refreshUrl.href, { namedExports: { ...refresh, prepareMimirV1ClassicRefresh: prepared, prepareMimirV1CompositeRefresh: prepared } });
const { getPrice, getPrices } = await import("../../src/easy/index.js");

let simulate: "ok" | "fail" = "ok";
const sims: string[][] = [];
const rpc = async (method: string, params: any[]) => {
  if (method === "getMultipleAccounts") return { context: { slot: fx.slot }, value: params[0].map((k: string) => fx.accounts[k] ? { ...fx.accounts[k], data: [fx.accounts[k]!.data, "base64"] } : null) };
  sims.push(params[1].accounts.addresses);
  return { context: { slot: 460423200 }, value: simulate === "fail" ? { err: { InstructionError: [1, { Custom: 14 }] }, logs: [], accounts: null }
    : { err: null, logs: [], accounts: params[1].accounts.addresses.map((k: string) => ({ ...fx.accounts[k], data: [fx.accounts[k]!.data, "base64"] })) } };
};
let busy = 0;
globalThis.fetch = (async (_: unknown, init: { body: string }) => {
  if (busy > 0 && busy--) return new Response("", { status: 429, headers: { "retry-after": "0" } });
  const { method, params } = JSON.parse(init.body);
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: await rpc(method, params) }));
}) as typeof fetch;

const stored = await getPrice(SOL, { live: false });
assert.deepEqual([stored.status, stored.live, sims.length], ["needs-refresh", false, 0]);

const live = await getPrice(SOL);
assert.deepEqual([live.status, live.live, live.priceX64, sims.length], ["fresh", true, stored.priceX64, 1]);

sims.length = 0;
const both = await getPrices([SOL, OTHER, SOL]);
assert.deepEqual(sims, [[SOL, OTHER]], "one batched simulation, deduplicated");
assert.ok(both.every((p) => p.live));

sims.length = 0;
simulate = "fail";
const fallback = await getPrices([SOL, OTHER]);
assert.deepEqual(fallback.map((p) => [p.status, p.live]), [["needs-refresh", false], ["needs-refresh", false]]);
assert.ok(fallback.every((p) => typeof p.liveError === "string"), "a failed live read says so");
assert.equal(live.liveError, undefined);
assert.deepEqual(sims, [[SOL, OTHER], [SOL], [OTHER]], "a failed batch is split before falling back");

// A fresh stored price that was never read live carries no liveError, even next to a failed one.
const { mergeLivePrices } = await import("../../src/easy/refresh.js");
const fresh = { ...stored, feed: "FRESH", status: "fresh" as const }, stale = { ...stored, feed: "STALE" };
const merged = mergeLivePrices([fresh, stale], new Set(["STALE"]), new Map(), new Map([["STALE", "RPC" as const]]));
assert.deepEqual(merged.map((p) => p.liveError), [undefined, "RPC"]);

sims.length = 0;
simulate = "ok";
busy = 2;
assert.equal((await getPrice(SOL)).live, true, "HTTP 429 is retried");
busy = 3;
await assert.rejects(getPrice(SOL, { live: false }), (e: any) => e.code === "RPC" && e.retry === "later", "at most 2 retries");
const tokens = Object.keys(fx.accounts).filter((k) => fx.accounts[k]!.magic === "MIMIRSNP");
peak = 0;
assert.ok(tokens.length > 4);
await getPrices(tokens);
assert.equal(peak, 4, "at most 4 refreshes planned at once");
console.log("easy live: ok");
