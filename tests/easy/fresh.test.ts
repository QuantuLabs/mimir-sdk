import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock } from "node:test";
import { TransactionInstruction } from "@solana/web3.js";
import type { MimirBetaInstruction } from "../../src/beta/types.js";

// withFreshPrice: refresh planning mocked at the module, reads and the simulation mocked at the RPC.
const fx = JSON.parse(readFileSync(new URL("../fixtures/hbyr/accounts.json", import.meta.url), "utf8")) as {
  slot: number; accounts: Record<string, { owner: string; executable: boolean; data: string }> };
const HBYR = "hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR", SOL = "F5fXuWuVFwBF3eBVtFkxXS5PMY651uVQ1bL4W4mse5Qj";
const PAYER = "11111111111111111111111111111112", MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const refreshUrl = new URL("../../src/v1/refresh.ts", import.meta.url), refresh = await import(refreshUrl.href);
const prepared = async () => ({ instruction: { programAddress: HBYR, accounts: [], data: Uint8Array.of(89) }, computeUnitLimit: 300_000, contextSlot: 1n });
mock.module(refreshUrl.href, { namedExports: { ...refresh, prepareMimirV1ClassicRefresh: prepared, prepareMimirV1CompositeRefresh: prepared } });
const { toWeb3Instruction, withFreshPrice } = await import("../../src/easy/index.js");
const { buildMimirBetaComputeUnitLimitInstruction } = await import("../../src/beta/liveAbi.js");

const sims: unknown[] = [];
globalThis.fetch = (async (_: unknown, init: { body: string }) => {
  const { method, params } = JSON.parse(init.body);
  if (method === "simulateTransaction") { sims.push(params[1]); return new Response(JSON.stringify({ result: { context: { slot: fx.slot }, value: { err: null, logs: [], accounts: null, unitsConsumed: 100_000 } } })); }
  return new Response(JSON.stringify({ result: { context: { slot: fx.slot }, value: params[0].map((k: string) => ({ ...fx.accounts[k], data: [fx.accounts[k]!.data, "base64"] })) } }));
}) as typeof fetch;
const memo: MimirBetaInstruction = { programAddress: MEMO as MimirBetaInstruction["programAddress"], accounts: [], data: Uint8Array.of(1) };
const base = { feeds: SOL, payer: PAYER, rpc: "http://rpc", instructions: [memo] };

// simulate: limit = unitsConsumed + the planned refresh units, in the leading compute budget instruction.
const plain = await withFreshPrice(base);
assert.equal(plain.computeUnitLimit, 500_000);
assert.equal(sims.length, 0);
const simulated = await withFreshPrice({ ...base, simulate: true });
assert.equal(sims.length, 1);
assert.equal(simulated.computeUnitLimit, 400_000);
assert.deepEqual(simulated.instructions[0], buildMimirBetaComputeUnitLimitInstruction(400_000));
assert.deepEqual(simulated.instructions.slice(1), plain.instructions.slice(1));

// web3.js TransactionInstruction in, the same type out, same instructions as the SDK path.
const web3 = await withFreshPrice({ ...base, instructions: [toWeb3Instruction(memo)] });
assert.ok(web3.instructions.every((ix) => ix instanceof TransactionInstruction));
assert.deepEqual(web3.instructions, plain.instructions.map(toWeb3Instruction));
console.log("easy fresh: ok");
