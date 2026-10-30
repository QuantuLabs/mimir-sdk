import assert from "node:assert/strict";
import { evaluateMimirBetaConverterLegs, mimirClassicNativeTail } from "../src/beta/live.js";
import { addressBytes, bytesAddress } from "../src/beta/bytes.js";

const key = (n: number) => bytesAddress(new Uint8Array(32).fill(n));
const DEX = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", MIMIR = key(8), P = key(13), OTHER = key(14), NOW = 1800000000n, SLOT = 50020n;
const pool = { pool: P, programId: DEX, family: "meteora-dlmm", creation: { adapterType: 3, adapterVersion: 0 } } as never;
const [oracle] = await mimirClassicNativeTail(pool); const lb = new Uint8Array(904); lb.set(addressBytes(oracle!), 552);
function oracleAt(entries: bigint[][]) {
  const obs = new Uint8Array(128), ov = new DataView(obs.buffer); obs.set([139, 194, 131, 179, 140, 179, 229, 244]);
  [8, 16, 24].forEach((o, i) => ov.setBigUint64(o, i ? 3n : 2n, true));
  entries.forEach(([c, u], i) => { ov.setBigUint64(48 + 32 * i, NOW - c!, true); ov.setBigUint64(56 + 32 * i, NOW - u!, true); });
  return obs;
}
const at = (newest: bigint) => oracleAt([[400n, 300n], [250n, 150n], [100n, newest]]);
// Clock at SLOT of epoch 0, which began `span` + 1 Clock seconds ago: SLOT slots per `span` s. EpochSchedule without warmup.
const clockAt = (span: bigint, slot = SLOT, now = NOW) => { const c = new Uint8Array(40), v = new DataView(c.buffer);
  v.setBigUint64(0, slot, true); v.setBigInt64(8, NOW - span - 1n, true); v.setBigInt64(32, now, true); return c; };
const clock = clockAt(360n), schedule = new Uint8Array(33); new DataView(schedule.buffer).setBigUint64(0, 432000n, true);
const SYSVAR = "Sysvar1111111111111111111111111111111111111", EPOCH_SCHEDULE = "SysvarEpochSchedu1e111111111111111111111111";
const account = (owner: string, data: Uint8Array) => ({ owner, data, executable: false, lamports: 1n });
// keys: 0 payer, 1 P, 2 OTHER, 3 MIMIR, 4 DEX
type Tx = { outer: [number, number[]][]; inner?: [number, number[]][]; logs: string[]; slot?: bigint; err?: unknown };
const tx = (t: Tx) => ({ slot: t.slot ?? 50015n, version: 1, meta: { err: t.err ?? null, logMessages: t.logs, loadedAddresses: { writable: [], readonly: [] },
  innerInstructions: t.inner ? [{ index: 0, instructions: t.inner.map(([p, accounts]) => ({ programIdIndex: p, accounts, data: "" })) }] : [] },
  transaction: { message: { accountKeys: [key(1), P, OTHER, MIMIR, DEX], header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 2 },
    instructions: t.outer.map(([p, accounts]) => ({ programIdIndex: p, accounts, data: "" })) } } });
const swap: Tx = { outer: [[4, [1, 0]]], logs: [`Program ${DEX} invoke [1]`, `Program log: success`, `Program ${DEX} success`] };
// The default native observation is 10 s old, at most (10 + 1) s × 2.5 = 28 slots, outside the default 20-slot bound: the transaction proof decides.
async function run(seq: Tx[], limit = 20, obs = at(10n), feedId = key(9), clockData = clock, epochSchedule: Uint8Array | null = schedule) {
  let reads = 0; const calls: string[] = [];
  const rpc = { getSignaturesForAddress: () => ({ send: async () => { calls.push("gsfa"); return seq.map((_, i) => ({ signature: `s${i}`, err: null })); } }),
    getTransaction: (sig: string, c: { maxSupportedTransactionVersion: number }) => ({ send: async () => {
      reads++; assert.equal(c.maxSupportedTransactionVersion, 1); return tx(seq[Number(sig.slice(1))]!); } }),
    getMultipleAccounts: (keys: string[]) => ({ send: async () => { calls.push("cohort"); return { context: { slot: SLOT }, value: keys.map((k) =>
      k === "SysvarC1ock11111111111111111111111111111111" ? account(SYSVAR, clockData) : k === EPOCH_SCHEDULE ? epochSchedule && account(SYSVAR, epochSchedule)
        : k === P ? account(DEX, lb) : account(DEX, obs)) }; } }) };
  const r = await evaluateMimirBetaConverterLegs({ rpc: rpc as never, cluster: "mainnet", feedId, sourceConfig: key(10), pools: [pool], maxActivityAgeSlots: limit, minContextSlot: SLOT });
  return { r, leg: r.legs[0]!, reads, calls };
}
// S12 (F2): epoch 0 at slot 50020, Clock unix - epoch start = 10000 s (clockAt(9999n)), native ageSecs = 0, real last trade 20 slots ago
// (same-second plateau). Seconds never bound slots: no transaction proof → unproven; the real trade slot → stale under bound 8.
const s12 = await run([], 8, at(0n), key(9), clockAt(9999n)), s12tx = await run([{ ...swap, slot: SLOT - 20n }], 8, at(0n), key(9), clockAt(9999n));
assert.deepEqual([s12.leg.eligible, s12.leg.reason, s12.leg.nativeAgeSecs, s12.leg.activityAgeSlots, s12.r.headroomSlots, s12.calls],
  [false, "activity-unproven", 0n, null, null, ["cohort", "gsfa"]], "F2: a 0 s native age is not a slot age");
assert.deepEqual([s12tx.leg.eligible, s12tx.leg.reason, s12tx.leg.activityAgeSlots], [false, "activity-stale", 20n], "F2: the authenticated trade slot is 20 slots old");
assert.deepEqual([(await run([{ ...swap, slot: SLOT - 8n }], 8, at(0n), key(9), clockAt(9999n))).leg.eligible], [true], "a proven trade within the bound admits");
// S11 SDK part: epoch elapsed Clock seconds 1 (secs = 0) and 0 slots into epoch: estimator null, no throw, falls back to tx proof.
for (const [label, c] of [["secs0", clockAt(0n)], ["secsNeg", clockAt(-1n)]] as const) {
  const none = await run([], 8, at(0n), key(9), c), proof = await run([swap], 8, at(0n), key(9), c);
  assert.equal(none.leg.reason === "activity-unproven" || none.leg.reason === "native-not-ready", true);
  assert.equal(none.leg.eligible, false);
}
console.log("alpenglowS12 ok");
