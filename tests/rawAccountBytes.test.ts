import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { MimirBetaSourceFamily } from "../src/beta/types.js";
import { decodeMimirBetaRpcAccount, mimirBetaRpcAccountBytes } from "../src/beta/rpc.js";
import { makeBetaCaptureFixture, type BetaCaptureFixtureAccount } from "./fixtures/betaCaptureFixtures.js";

const FAMILIES: readonly MimirBetaSourceFamily[] = ["orca-whirlpool", "meteora-dlmm", "meteora-damm-v2", "raydium-clmm", "raydium-cpmm", "raydium-amm-v4", "pumpswap"];
const accounts: BetaCaptureFixtureAccount[] = [];
for (const [index, family] of FAMILIES.entries()) accounts.push(...(await makeBetaCaptureFixture(family, { seed: 10 + index * 27 })).fixtureAccounts);
assert.ok(accounts.length >= 20);

const web3 = (account: BetaCaptureFixtureAccount) => ({ data: Buffer.from(account.data), executable: account.executable, lamports: 2_039_280, owner: account.owner, rentEpoch: 0 });
const base64Value = (account: BetaCaptureFixtureAccount) => { const v = web3(account); return { ...v, data: [v.data.toString("base64"), "base64"] }; };
const rawValue = (account: BetaCaptureFixtureAccount) => { const v = web3(account); return { ...v, data: new Uint8Array(v.data.buffer, v.data.byteOffset, v.data.byteLength) }; };

for (const account of accounts) {
  const raw = decodeMimirBetaRpcAccount(account.address, rawValue(account));
  assert.deepEqual(raw, decodeMimirBetaRpcAccount(account.address, base64Value(account)));
  assert.deepEqual(raw?.data, account.data);
  assert.deepEqual(mimirBetaRpcAccountBytes(rawValue(account).data), mimirBetaRpcAccountBytes(base64Value(account).data));
}
assert.equal(mimirBetaRpcAccountBytes(["x", "base58"]), undefined);
assert.throws(() => decodeMimirBetaRpcAccount(accounts[0]!.address, { ...web3(accounts[0]!), data: "AA==" }), /base64/);

const read = Array.from({ length: 60 }, (_, index) => accounts[index % accounts.length]!);
const bench = (label: string, encode: (a: BetaCaptureFixtureAccount) => unknown) => {
  const rounds = 300; const start = performance.now();
  for (let round = 0; round < rounds; round += 1) for (const account of read) decodeMimirBetaRpcAccount(account.address, encode(account));
  const perRead = (performance.now() - start) / rounds;
  console.log(`rawAccountBytes bench ${label}: ${perRead.toFixed(3)} ms per 60-account read (${read.reduce((n, a) => n + a.data.length, 0)} bytes)`);
  return perRead;
};
bench("base64", base64Value); bench("raw", rawValue);
const before = bench("base64", base64Value); const after = bench("raw", rawValue);
assert.ok(after < before);
console.log("rawAccountBytes tests passed");
