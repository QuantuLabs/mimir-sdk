import assert from "node:assert/strict";
import { evaluateMimirBetaConverterLegs, mimirClassicNativeTail, rankMimirBetaConverterEligibility } from "../src/beta/live.js";
import { addressBytes, bytesAddress } from "../src/beta/bytes.js";

const key = (n: number) => bytesAddress(new Uint8Array(32).fill(n));
const DEX = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", MIMIR = key(8), P = key(13), OTHER = key(14), NOW = 1800000000n, SLOT = 900n;
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
const tx = (t: Tx) => ({ slot: t.slot ?? 895n, version: 1, meta: { err: t.err ?? null, logMessages: t.logs, loadedAddresses: { writable: [], readonly: [] },
  innerInstructions: t.inner ? [{ index: 0, instructions: t.inner.map(([p, accounts]) => ({ programIdIndex: p, accounts, data: "" })) }] : [] },
  transaction: { message: { accountKeys: [key(1), P, OTHER, MIMIR, DEX], header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 2 },
    instructions: t.outer.map(([p, accounts]) => ({ programIdIndex: p, accounts, data: "" })) } } });
const swap: Tx = { outer: [[4, [1, 0]]], logs: [`Program ${DEX} invoke [1]`, `Program log: success`, `Program ${DEX} success`] };
const refresh: Tx = { outer: [[3, [1, 0]]], logs: [`Program ${MIMIR} invoke [1]`, `Program ${MIMIR} success`] };
// A ready native observation proves readiness only; the trade slot always comes from a verified DEX transaction.
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
assert.equal((await run([swap])).leg.lastActivitySlot, 895n);
const caught: Tx = { outer: [[3, [1]]], inner: [[4, [1]]],
  logs: [`Program ${MIMIR} invoke [1]`, `Program ${DEX} invoke [2]`, `Program ${DEX} failed: custom program error: 0x1`, `Program ${MIMIR} success`] };
const unbound: Tx = { outer: [[4, [2, 0]], [3, [1]]], logs: [`Program ${DEX} invoke [1]`, `Program ${DEX} success`, `Program ${MIMIR} invoke [1]`, `Program ${MIMIR} success`] };
const readonlyPool: Tx = { outer: [[4, [3]]], logs: [`Program ${DEX} invoke [1]`, `Program ${DEX} success`] };
const truncated: Tx = { ...swap, logs: ["Log truncated"] };
for (const bad of [caught, unbound, readonlyPool, truncated, { ...swap, err: { InstructionError: [0, "Custom"] } }]) assert.equal((await run([bad])).leg.reason, "activity-unproven");
const late = await run([refresh, refresh, refresh, refresh, refresh, swap]);
assert.deepEqual([late.leg.eligible, late.leg.lastActivitySlot, late.reads], [true, 895n, 6]);
const budget = await run([caught, caught, caught, swap]);
assert.deepEqual([budget.leg.reason, budget.reads], ["activity-unproven", 3]);
const window = await run([...Array(25).fill(refresh), swap]);
assert.deepEqual([window.leg.reason, window.reads], ["activity-unproven", 25]);
const fresh = await run([], 50, at(0n));
assert.deepEqual([fresh.leg.eligible, fresh.leg.reason, fresh.leg.nativeAgeSecs, fresh.leg.lastActivitySlot, fresh.calls],
  [false, "activity-unproven", 0n, null, ["cohort", "gsfa"]], "a fresh native observation alone never proves the trade slot");
const fallback = await run([swap]);
assert.deepEqual([fallback.leg.eligible, fallback.leg.lastActivitySlot, fallback.leg.activityAgeSlots, fallback.reads, fallback.calls],
  [true, 895n, 5n, 1, ["cohort", "gsfa"]], "a ready native observation is judged on the transaction proof after the cohort");
const notReady = await run([swap], 50, oracleAt([[400n, 300n], [250n, 150n], [130n, 121n]]));
assert.deepEqual([notReady.leg.reason, notReady.reads, notReady.calls], ["native-not-ready", 0, ["cohort"]], "native-not-ready needs no transaction history");
const unproven = await run([]);
assert.deepEqual([unproven.leg.reason, unproven.calls], ["activity-unproven", ["cohort", "gsfa"]], "no proof stays unproven");
const tieA = await run([{ ...swap, slot: 892n }], 20, at(2n), key(21)), tieB = await run([{ ...swap, slot: 892n }], 20, at(10n), key(20)), low = await run([{ ...swap, slot: 887n }], 20, at(4n), key(19));
assert.deepEqual([tieA.r.headroomSlots, tieB.r.headroomSlots, low.r.headroomSlots], [12n, 12n, 7n]);
assert.deepEqual(rankMimirBetaConverterEligibility([low.r, tieA.r, tieB.r, unproven.r]).map(({ feedId }) => feedId), [key(20), key(21), key(19), key(9)],
  "transaction evidence ranks by headroom, then feed identity");
const unscheduled = await run([swap], 50, at(10n), key(9), clock, null);
assert.deepEqual([unscheduled.leg.lastActivitySlot, unscheduled.calls], [895n, ["cohort", "gsfa"]], "EpochSchedule plays no part");
// Mixed CLMM + DLMM converter. CLMM leg: pool PC, observation OC (newest write 11 s ago); DLMM leg: pool P (oracle 20 s ago).
// A transaction proof newer than the first cohort raises the floor: the second cohort is 5 slots and 2 Clock seconds later.
const CLMM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", PC = key(15), OC = key(16);
const clmmPool = { pool: PC, programId: CLMM, family: "raydium-clmm", creation: { adapterType: 1, adapterVersion: 0 },
  readPlan: { auxiliary: [{ role: "clmm-observation", address: OC }] } } as never;
const clmmState = new Uint8Array(1544); clmmState.set([247, 237, 227, 245, 215, 195, 222, 70]);
const clmmObs = new Uint8Array(4483), cov = new DataView(clmmObs.buffer); clmmObs.set([122, 174, 197, 53, 129, 9, 165, 132]); clmmObs[8] = 1;
cov.setUint16(17, 2, true); clmmObs.set(addressBytes(PC), 19); [300n, 200n, 11n].forEach((age, i) => cov.setUint32(51 + 44 * i, Number(NOW - age), true));
const pairTx = (slot: bigint, program: string, index: number) => ({ slot, version: 1, meta: { err: null, logMessages: [`Program ${program} invoke [1]`, `Program ${program} success`],
  loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [] }, transaction: { message: { accountKeys: [key(1), PC, P, CLMM, DEX],
    header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 2 }, instructions: [{ programIdIndex: index + 2, accounts: [index, 0], data: "" }] } } });
async function runPair(limit: number) {
  const calls: string[] = [], later = clockAt(362n, SLOT + 5n, NOW + 2n);
  const rpc = { getSignaturesForAddress: (address: string) => ({ send: async () => { calls.push(`gsfa:${address === PC ? "clmm" : "dlmm"}`);
      return [{ signature: address === PC ? "c" : "d", err: null }]; } }),
    getTransaction: (sig: string) => ({ send: async () => sig === "c" ? pairTx(SLOT + 1n, CLMM, 1) : pairTx(SLOT + 2n, DEX, 2) }),
    getMultipleAccounts: (keys: string[], c: { minContextSlot?: bigint }) => ({ send: async () => {
      const second = (c.minContextSlot ?? 0n) > SLOT; calls.push(`cohort@${c.minContextSlot}`);
      return { context: { slot: second ? SLOT + 5n : SLOT }, value: keys.map((k) => k === "SysvarC1ock11111111111111111111111111111111" ? account(SYSVAR, second ? later : clock)
        : k === EPOCH_SCHEDULE ? account(SYSVAR, schedule) : k === PC ? account(CLMM, clmmState) : k === OC ? account(CLMM, clmmObs) : k === P ? account(DEX, lb) : account(DEX, at(20n))) }; } }) };
  const r = await evaluateMimirBetaConverterLegs({ rpc: rpc as never, cluster: "mainnet", feedId: key(9), sourceConfig: key(10), pools: [clmmPool, pool], maxActivityAgeSlots: limit, minContextSlot: SLOT });
  return { r, calls };
}
const mixed = await runPair(150);
assert.deepEqual([mixed.r.eligible, mixed.r.legs.map((l) => l.activityAgeSlots), mixed.r.headroomSlots], [true, [4n, 3n], 146n],
  "a mixed CLMM + DLMM converter: each leg on its transaction proof; headroom is the weakest leg");
const pair = await runPair(30);
assert.deepEqual([pair.r.eligible, pair.r.slot, pair.r.legs.map((l) => [l.reason, l.lastActivitySlot, l.activityAgeSlots]), pair.r.headroomSlots],
  [true, 905n, [[null, 901n, 4n], [null, 902n, 3n]], 26n],
  "each leg is judged on its transaction proof against the re-read cohort");
assert.deepEqual(pair.calls.filter((c) => c.startsWith("cohort")), ["cohort@900", "cohort@902"], "the floor rises to the newest proof and the cohort is re-read once");
console.log("converterActivityProof ok");
