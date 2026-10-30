import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { discoverExactExistingPool } from "../src/existingFeedRows.js";
import { freshDynamicAccounts } from "../src/beta/live.js";
import { decodeMimirBetaCaptureRpcAccount } from "../src/beta/rpc.js";
import { deriveMimirBetaCaptureReadPlan, mimirBetaAllCaptureScanDescriptors } from "../src/beta/capture.js";
import { SourceAdapterType } from "../src/constants.js";
import type { Address } from "@solana/kit";
import { decodeV1ClassicFeed } from "../src/v1/index.js";
import { decodeSourceConfigHeader } from "../src/internal/nativeMonoRefreshCore.js";
import { staticConnection } from "./helpers/staticConnection.js";

// Public mainnet CMG/SOL Raydium CLMM closure whose upper tick array is naturally absent.
const fx = JSON.parse(readFileSync(new URL("./fixtures/cmgSolSparseClmm.json", import.meta.url), "utf8"));
const CLOCK = "SysvarC1ock11111111111111111111111111111111", CAMM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
const clock = (unix: number) => { const d = Buffer.alloc(40); d.writeBigUInt64LE(BigInt(fx.slot), 0); d.writeBigInt64LE(BigInt(unix), 32);
  return { lamports: 1169280, owner: "Sysvar1111111111111111111111111111111111111", executable: false, data: [d.toString("base64"), "base64"] }; };
const program = { lamports: 1141440, owner: "BPFLoaderUpgradeab1e11111111111111111111111", executable: true, data: [Buffer.alloc(36).toString("base64"), "base64"] };
const discover = (drop?: string) => {
  const connection = new Connection("http://127.0.0.1:1", "confirmed");
  (connection as unknown as { _rpcRequest: unknown })._rpcRequest = async (method: string, params: [string | string[]]) => {
    const rows = [params[0]].flat().map((key) => key === CLOCK ? clock(fx.unixTimestamp) : key === CAMM ? program : key === drop ? null :
      fx.accounts[key] ? { ...fx.accounts[key], data: [fx.accounts[key].data, "base64"] } : null).map((row) => row && { ...row, rentEpoch: 0 });
    return { jsonrpc: "2.0", id: "1", result: { context: { slot: fx.slot }, value: method === "getAccountInfo" ? rows[0] : rows } };
  };
  const pool = Buffer.from(fx.accounts[fx.pool].data, "base64");
  return discoverExactExistingPool(connection, { cluster: "mainnet", programId: PublicKey.default } as never, { adapterType: SourceAdapterType.RaydiumClmm,
    poolOrMarket: new PublicKey(fx.pool).toBytes(), programId: new PublicKey(CAMM).toBytes(), baseMint: pool.subarray(73, 105), quoteMint: pool.subarray(105, 137) } as never, "confirmed");
};

// O01: the null upper array is kept as an empty system row; discovery succeeds on the 11-address closure.
const { pool } = await discover();
assert.ok(pool.readPlan.allAddresses.includes(fx.absent));
// A null on a mandatory, non-sparse role (observation) is still refused.
await assert.rejects(discover("4Q6b4Nna385s8yhy4yfZeXzvUXsWxCfAU5kRtKf3gVnp"));

// O02: frozen plan from an older Clock; resume decodes under the current cohort Clock.
const rows = new Map<Address, null | ReturnType<typeof decodeMimirBetaCaptureRpcAccount>>(pool.readPlan.allAddresses.map((key) =>
  [key, key === fx.absent ? null : decodeMimirBetaCaptureRpcAccount(key, { ...fx.accounts[key], data: [fx.accounts[key].data, "base64"] })]));
const at = (unix: number) => ({ observedSlot: BigInt(fx.slot), observedUnixTimestamp: BigInt(unix) });
const descriptor = mimirBetaAllCaptureScanDescriptors().find((entry) => entry.descriptorId === pool.descriptorId && entry.descriptorHash === pool.descriptorHash)!;
const frozen = { ...pool, readPlan: deriveMimirBetaCaptureReadPlan({ descriptor, primary: rows.get(fx.pool)!,
  pair: { baseMint: pool.baseMint, quoteMint: pool.quoteMint }, context: at(fx.unixTimestamp - 3_600) }) };
await assert.rejects(freshDynamicAccounts(frozen, rows, true), /InvalidRaydiumClmmObservationState/);
assert.equal((await freshDynamicAccounts(frozen, rows, true, at(fx.unixTimestamp))).length, 3);
// A real future observation stays refused under the current Clock.
await assert.rejects(freshDynamicAccounts(frozen, rows, true, at(fx.unixTimestamp - 3_600)), /InvalidRaydiumClmmObservationState/);
// Closure drift is still refused.
const drifted = new Map(rows); const primary = rows.get(fx.pool)!; const data = Uint8Array.from(primary.data);
new DataView(data.buffer).setInt32(269, new DataView(data.buffer).getInt32(269, true) + 7_200, true);
drifted.set(fx.pool, { ...primary, data });
await assert.rejects(freshDynamicAccounts(frozen, drifted, true, at(fx.unixTimestamp)));
// Orca: a null (uninitialized) lower/active/upper array is kept as an empty system row in discovery and resume.
{
  const of = JSON.parse(readFileSync(new URL("./fixtures/v1Refresh/sol_quoted_orca.json", import.meta.url), "utf8"));
  const header = decodeV1ClassicFeed(Buffer.from(of.accounts[of.request.feed].data, "base64")).rows.map((r) => decodeSourceConfigHeader(r.source))
    .find((h) => h.adapterType === SourceAdapterType.OrcaWhirlpool)!;
  const discoverOrca = (accounts: typeof of.accounts) => discoverExactExistingPool(staticConnection(of.slot, accounts), { cluster: "mainnet" } as never, header, "confirmed");
  const { pool: orca } = await discoverOrca(of.accounts);
  const ticks = ["tick-array-lower", "tick-array-active", "tick-array-upper"].map((role) => orca.readPlan.auxiliary.find((n) => n.role === role)!.address);
  const rowsOf = (accounts: typeof of.accounts) => new Map<Address, null | ReturnType<typeof decodeMimirBetaCaptureRpcAccount>>(orca.readPlan.allAddresses.map((key) =>
    [key, accounts[key] ? decodeMimirBetaCaptureRpcAccount(key, { ...accounts[key], data: [accounts[key].data, "base64"] }) : null]));
  const now = orca.readPlan.context;
  for (const tick of ticks) {
    const sparse = { ...of.accounts, [tick]: null };
    const { pool: rediscovered } = await discoverOrca(sparse);
    assert.ok(rediscovered.readPlan.allAddresses.includes(tick));
    const rows = rowsOf(sparse);
    for (const revalidated of [false, true]) {
      assert.deepEqual(await freshDynamicAccounts(orca, rows, revalidated), ticks);
      assert.deepEqual(await freshDynamicAccounts(orca, rows, revalidated, now), ticks);
      const primary = rows.get(orca.pool)!; const data = Uint8Array.from(primary.data); const view = new DataView(data.buffer);
      view.setInt32(81, view.getInt32(81, true) + 88 * view.getUint16(41, true) * 2, true);
      const drifted = new Map(rows); drifted.set(orca.pool, { ...primary, data });
      await assert.rejects(freshDynamicAccounts(orca, drifted, revalidated, now), /capture closure changed/);
      await assert.rejects(freshDynamicAccounts(orca, drifted, revalidated, { ...now, observedSlot: now.observedSlot + 1n }), (e: { reason?: string }) => e.reason === "source-drift");
      const missing = new Map(rows); missing.delete(tick);
      await assert.rejects(freshDynamicAccounts(orca, missing, revalidated), /PLAN_STALE/);
    }
  }
  const config = orca.readPlan.auxiliary.find((n) => n.role === "whirlpools-config")!.address;
  await assert.rejects(discoverOrca({ ...of.accounts, [config]: null }));
  await assert.rejects(freshDynamicAccounts(orca, rowsOf({ ...of.accounts, [config]: null }), true), /PLAN_STALE/);
}
console.log("sparse CLMM resume ok");
