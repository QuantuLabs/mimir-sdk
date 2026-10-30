import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock } from "node:test";
import { watchPrices } from "../../src/easy/index.js";

// watchPrices: a poll at once, then one per interval (fake timers); unsubscribe stops it.
const fx = JSON.parse(readFileSync(new URL("../fixtures/hbyr/accounts.json", import.meta.url), "utf8")) as {
  slot: number; accounts: Record<string, { owner: string; executable: boolean; data: string }> };
const SOL = "F5fXuWuVFwBF3eBVtFkxXS5PMY651uVQ1bL4W4mse5Qj";
globalThis.fetch = (async (_: unknown, init: { body: string }) => {
  const { params } = JSON.parse(init.body);
  return new Response(JSON.stringify({ result: { context: { slot: fx.slot }, value: params[0].map((k: string) => ({ ...fx.accounts[k], data: [fx.accounts[k]!.data, "base64"] })) } }));
}) as typeof fetch;
mock.timers.enable({ apis: ["setTimeout"] });
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const seen: string[] = [];
const stop = watchPrices([SOL], (p) => seen.push(p.ticker), { rpc: "http://rpc", live: false, intervalMs: 1000 });
await flush();
mock.timers.tick(1000); await flush();
assert.deepEqual(seen, ["SOL", "SOL"]);
stop();
mock.timers.tick(5000); await flush();
assert.equal(seen.length, 2);
// live requested but the simulation fails: stored prices carry liveError, onError fires once per failure burst.
const errors: unknown[] = [], lived: (string | undefined)[] = [];
mock.timers.reset();
const stop2 = watchPrices([SOL], (p) => lived.push(p.liveError), { rpc: "http://rpc", intervalMs: 20, onError: (e) => errors.push(e) });
for (let i = 0; i < 200 && lived.length < 3; i++) await new Promise((r) => setTimeout(r, 20));
stop2();
assert.ok(lived.length >= 2 && lived.every((c) => typeof c === "string"));
assert.equal(errors.length, 1);
// A "never" error (the browser 403) reaches onError once and stops the polling.
let calls = 0;
globalThis.fetch = (async () => { calls++; return new Response("", { status: 403 }); }) as typeof fetch;
const refused: { code: unknown; retry: string }[] = [];
const stop3 = watchPrices([SOL], () => {}, { rpc: "http://rpc", live: false, intervalMs: 10, onError: (e) => refused.push({ code: e.code, retry: e.retry }) });
await new Promise((r) => setTimeout(r, 200));
stop3();
assert.deepEqual(refused, [{ code: "RPC", retry: "never" }]);
assert.equal(calls, 1);
console.log("easy watch: ok");
