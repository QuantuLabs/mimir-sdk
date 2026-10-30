import assert from "node:assert/strict";
import { mock } from "node:test";
import { rpcCall } from "../../src/easy/price.js";
import { readFileSync } from "node:fs";
import { MimirError, refreshInstructions } from "../../src/easy/index.js";
import { betaError } from "../../src/beta/errors.js";
import { COHORT_NOT_CONVERGED } from "../../src/chunkedAccounts.js";

// Retry-After honoured on 429 under mocked timers: seconds, HTTP-date, absent, and longer than the 20 s budget.
mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_800_000_000_000 });
const run = async (after: (now: number) => string | null) => {
  const at: number[] = [];
  globalThis.fetch = (async () => {
    at.push(Date.now());
    if (at.length === 3) return new Response(JSON.stringify({ result: 7 }));
    const h = after(Date.now());
    return new Response("", { status: 429, headers: h === null ? {} : { "retry-after": h } });
  }) as typeof fetch;
  const p = rpcCall<number>("http://rpc", "getSlot", []).then((v) => v, (e) => e);
  for (let i = 0; i < 50; i++) { await new Promise((r) => setImmediate(r)); mock.timers.tick(500); }
  return { gaps: at.slice(1).map((t, i) => t - at[i]!), result: await p };
};
const long = await run(() => "30");
assert.deepEqual(long.gaps, []);
assert.ok(long.result instanceof MimirError && long.result.code === "RPC" && long.result.retry === "later" && /30 s/.test(long.result.hint));
assert.deepEqual(await run(() => "5"), { gaps: [5000, 5000], result: 7 });
const dated = await run((now) => new Date(now + 3000).toUTCString());
assert.ok(dated.result === 7 && dated.gaps.every((g) => g >= 2000 && g <= 3500), String(dated.gaps));
assert.deepEqual(await run(() => null), { gaps: [1000, 2000], result: 7 });
mock.timers.reset();

// Never an RPC URL (keys) in an error: host only.
globalThis.fetch = (async () => new Response("", { status: 403 })) as typeof fetch;
await assert.rejects(rpcCall("https://x.test/v2/SECRET?key=SECRET", "getSlot", []),
  (e: unknown) => e instanceof MimirError && !e.message.includes("SECRET") && e.message.includes("x.test"));

// Cohort not converged (load-balanced RPC): one retry of the refresh planning, then MimirError RPC "now".
const fx = JSON.parse(readFileSync(new URL("../fixtures/hbyr/accounts.json", import.meta.url), "utf8")) as {
  slot: number; accounts: Record<string, { owner: string; executable: boolean; data: string }> };
const SOL = "F5fXuWuVFwBF3eBVtFkxXS5PMY651uVQ1bL4W4mse5Qj", PAYER = "11111111111111111111111111111112";
const refreshUrl = new URL("../../src/v1/refresh.ts", import.meta.url), refresh = await import(refreshUrl.href);
let failures = 0;
const prepared = async () => {
  if (failures-- > 0) betaError("RPC_CONTEXT_MISMATCH", COHORT_NOT_CONVERGED);
  return { instruction: { programAddress: fx.accounts[SOL]!.owner, accounts: [], data: Uint8Array.of(89) }, computeUnitLimit: 300_000, contextSlot: 1n };
};
mock.module(refreshUrl.href, { namedExports: { ...refresh, prepareMimirV1ClassicRefresh: prepared, prepareMimirV1CompositeRefresh: prepared } });
globalThis.fetch = (async (_: unknown, init: { body: string }) => {
  const { params } = JSON.parse(init.body);
  return new Response(JSON.stringify({ result: { context: { slot: fx.slot }, value: params[0].map((k: string) => ({ ...fx.accounts[k], data: [fx.accounts[k]!.data, "base64"] })) } }));
}) as typeof fetch;
failures = 1;
assert.equal((await refreshInstructions(SOL, { rpc: "http://rpc", payer: PAYER })).instructions.length, 1);
failures = 99;
await assert.rejects(refreshInstructions(SOL, { rpc: "http://rpc", payer: PAYER }), (e: unknown) => e instanceof MimirError && e.code === "RPC" && e.retry === "now");
console.log("easy retry: ok");
