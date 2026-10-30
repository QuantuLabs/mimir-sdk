import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listFeeds } from "../../src/easy/index.js";

// listFeeds over mocked gPA rows (captured hBYr accounts, unsliced: the decoders read only the owner record) and getMultipleAccounts.
const fx = JSON.parse(readFileSync(new URL("../fixtures/hbyr/accounts.json", import.meta.url), "utf8")) as {
  slot: number; accounts: Record<string, { magic: string; owner: string; executable: boolean; data: string }> };
const row = (k: string, slice: { offset: number; length: number }) =>
  ({ pubkey: k, account: { data: [Buffer.from(fx.accounts[k]!.data, "base64").subarray(slice.offset, slice.offset + slice.length).toString("base64"), "base64"] } });
const gpa: unknown[] = [];
globalThis.fetch = (async (_: unknown, init: { body: string }) => {
  const { method, params } = JSON.parse(init.body);
  if (method === "getProgramAccounts") {
    gpa.push(params[1]);
    const composite = params[1].filters.length === 1;
    assert.equal(typeof params[1].filters[0].memcmp.offset, "number");
    assert.equal(params[1].filters[0].memcmp.encoding, undefined);
    assert.equal(params[1].filters[0].memcmp.bytes, composite ? "DvmuduF1nab" : "DvmuduF79uR");
    const keys = Object.keys(fx.accounts).filter((k) => fx.accounts[k]!.magic === (composite ? "MIMIRCSP" : "MIMIRSNP"));
    return new Response(JSON.stringify({ result: keys.map((k) => row(k, params[1].dataSlice)) }));
  }
  return new Response(JSON.stringify({ result: { context: { slot: fx.slot }, value: params[0].map((k: string) => ({ ...fx.accounts[k], data: [fx.accounts[k]!.data, "base64"] })) } }));
}) as typeof fetch;
const feeds = await listFeeds({ rpc: "http://rpc" });
assert.equal(gpa.length, 2);
assert.equal(feeds.length, 16);
assert.ok(feeds.some((f) => f.ticker === "SOL" && f.kind === "token" && f.feed === "F5fXuWuVFwBF3eBVtFkxXS5PMY651uVQ1bL4W4mse5Qj"));
assert.ok(feeds.some((f) => f.kind === "index"));
assert.ok(feeds.every((f) => /^[A-Z0-9]{1,12}$/.test(f.ticker)));
console.log("easy feeds: ok");
