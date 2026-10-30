import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import {
  MIMIR_REFRESH_COMPUTE_BUDGET_PROGRAM_ID,
  MIMIR_REFRESH_MAX_COMPUTE_UNITS,
  mimirComputeUnitLimitInstruction,
  planMimirRefresh,
  type MimirConsumer,
  type MimirPrefetchedAccount,
  type MimirRefreshGroup,
  type MimirRefreshPlan,
  type MimirRefreshUnit,
} from "../src/beta/refreshPlanner.js";
import { compileMimirBetaTransactionV1 } from "../src/beta/transactionV1.js";
import type { MimirBetaInstruction } from "../src/beta/types.js";

const key = (): Address => address(PublicKey.unique().toBase58());
const program = key();
const consumerProgram = key();
const payer = key();
const meta = (a: Address, isSigner = false) => ({ address: a, isSigner, isWritable: true });
const ix = (tag: number, accounts: readonly Address[], dataBytes = 64, programAddress = program): MimirBetaInstruction => {
  const data = new Uint8Array(dataBytes); data[0] = tag;
  return { programAddress, data, accounts: [meta(payer, true), ...accounts.map((a) => meta(a))] };
};
const keys = (n: number) => Array.from({ length: n }, key);
const check = { account: key(), kind: "classic-snapshot", slotOffset: 116, revisionOffset: 96, statusOffset: 104, expectedStatus: 0,
  validUntilSlotOffset: 124, snapshotSourceOffset: 107, expectedSnapshotSource: 5, config: key() } as const;
const unit = (instructions: MimirBetaInstruction[], computeUnitBound = 100_000): MimirRefreshUnit => ({ instructions, computeUnitBound });
const consumer = (accounts: readonly Address[], dataBytes = 600, computeUnits = 300_000, extra: MimirBetaInstruction[] = []): MimirConsumer =>
  ({ instructions: [ix(1, accounts, dataBytes, consumerProgram), ...extra], computeUnits });
const plan = (group: MimirRefreshGroup, c: MimirConsumer, more: { priorityFee?: boolean } = {}) => planMimirRefresh({ programId: program, payer,
  target: { kind: "classic", feedConfig: key() }, consumer: c, buildRefreshGroup: async () => group, ...more });
const tags = (list: readonly MimirBetaInstruction[]) => list.filter((i) => i.programAddress !== MIMIR_REFRESH_COMPUTE_BUDGET_PROGRAM_ID).map((i) => i.data[0]);
const bytes = async (instructions: readonly MimirBetaInstruction[], priorityFeeLamports?: bigint) =>
  (await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n, instructions,
    ...(priorityFeeLamports !== undefined ? { priorityFeeLamports } : {}) })).serializedTransaction.length;
const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: Error) => e.message.startsWith(code + ":"));
const kc = (c: MimirConsumer, k = 4): MimirConsumer => ({ ...c, maxPublicationAgeSlots: k });
const ages = { maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 6 };
/** Every tx of a split plan compiles under the caps; prep txs confirm in order before the consumer. */
async function assertBundle(p: MimirRefreshPlan, c: MimirConsumer) {
  if (p.mode === "inline") { assert.equal(await bytes(p.instructions), p.estimate.bytes); return; }
  assert.equal(p.execution.ordering, "confirmed-prep"); assert.equal(p.execution.prepSequence, "in-order-each-confirmed"); assert.equal(p.execution.onMiss, "replan");
  for (const t of p.refreshTransactions) assert.equal(await bytes(t.instructions), t.estimate.bytes);
  assert.equal(await bytes(c.instructions), p.estimate.bytes);
  assert.equal(p.publish.maxAgeSlots, p.execution.maxPublicationAgeSlots);
}

// (b) NativeTwap mono [77,60] with a small consumer: inline, consumer last, exact bytes.
{
  const c = consumer(keys(8));
  const p = await plan({ updates: [], publish: unit([ix(77, keys(10)), ix(60, keys(4))]), check }, c);
  assert.equal(p.mode, "inline");
  if (p.mode !== "inline") throw new Error("unreachable");
  assert.deepEqual(tags(p.instructions), [77, 60, 1]);
  assert.equal(p.estimate.computeUnits, 400_000);
  await assertBundle(p, c);
}

// Exact bytes: 4096 is inline, 4097 is not (the 4-byte header / per-occurrence index case).
{
  const group = { updates: [], publish: unit([ix(77, keys(10), 1500), ix(60, keys(4))]), check, ageLimits: ages };
  const shared = keys(6);
  const probe = await plan(group, consumer(shared, 600));
  const base = probe.mode === "inline" ? probe.estimate.bytes : 0;
  const atLimit = consumer(shared, 600 + 4096 - base);
  const p = await plan(group, atLimit);
  assert.equal(p.mode, "inline"); assert.equal(p.mode === "inline" && p.estimate.bytes, 4096);
  const over = kc(consumer(shared, 601 + 4096 - base));
  const q = await plan(group, over);
  assert.equal(q.mode, "split"); await assertBundle(q, over);
}

// Classic: the publish unit is atomic. Over limits it moves whole into prep (split, K ≥ 1); never split across txs. K = 0 refuses.
{
  const publish = [...keys(5).map(() => ix(77, keys(9))), ix(83, keys(14))];
  const c = kc(consumer(keys(28), 1400));
  await rejects(plan({ updates: [], publish: unit(publish, 500_000), check, ageLimits: ages }, consumer(keys(28), 1400)), "PUBLICATION_AGE_UNSUPPORTED");
  const p = await plan({ updates: [], publish: unit(publish, 500_000), check, ageLimits: ages }, c);
  assert.equal(p.mode, "split");
  if (p.mode !== "split") throw new Error("unreachable");
  assert.equal(p.refreshTransactions.length, 1);
  assert.deepEqual(p.refreshTransactions[0]!.instructions.filter((i) => i.programAddress === program), publish);
  await assertBundle(p, c);
}

// (a) Lending consumer: classic 5 sources + SOL conversion [77,60], consumer 28 accounts / 1,400 B / 300k CU.
{
  const feed = keys(6); const sol = keys(4);
  const publish = [...keys(5).map(() => ix(77, [...feed, ...keys(5)], 120)), ix(77, [...sol, ...keys(5)], 120), ix(60, sol), ix(83, [...feed, ...keys(5)], 160)];
  const c = kc(consumer(keys(28), 1400));
  const distinct = new Set([payer, program, ...publish.flatMap((i) => i.accounts.map((a) => a.address))]).size + 1;
  const unitBytes = await bytes(publish).catch(() => null);
  const p = plan({ updates: [], publish: unit(publish, 1_000_000), check, ageLimits: ages }, c);
  if (unitBytes !== null) {
    const r = await p; assert.equal(r.mode, "split"); await assertBundle(r, c);
  } else await rejects(p, "TRANSACTION_TOO_LARGE");
  console.log(`consumer (a) atomic unit: ${distinct} accounts, ${unitBytes ?? "uncompilable"} B`);
}

// Point refresh bound + 1M-CU consumer: never inline; the unit goes to prep.
{
  const c = kc(consumer(keys(4), 200, 1_000_000));
  const p = await plan({ updates: [], publish: unit([ix(77, keys(8)), ix(83, keys(10))], 880_000), check, ageLimits: ages }, c);
  assert.equal(p.mode, "split");
  if (p.mode !== "split") throw new Error("unreachable");
  assert.equal(p.refreshTransactions[0]!.estimate.computeUnits, 880_000);
}

// No simulation and no bound: refuse.
await rejects(plan({ updates: [], publish: { instructions: [ix(77, keys(3)), ix(60, keys(3))] }, check }, consumer(keys(2))), "SIMULATION_FAILED");

// The consumer alone must fit: 65 accounts, 13 signers, 65 instructions, CU.
await rejects(plan({ updates: [], publish: unit([ix(60, [])]), check }, consumer(keys(65), 10)), "TRANSACTION_TOO_LARGE");
await rejects(plan({ updates: [], publish: unit([ix(60, [])]), check },
  { instructions: [{ ...ix(1, [], 8, consumerProgram), accounts: keys(12).map((a) => meta(a, true)) }], computeUnits: 1 }), "TRANSACTION_TOO_LARGE");
await rejects(plan({ updates: [], publish: unit([ix(60, [])]), check },
  { instructions: Array.from({ length: 65 }, () => ix(1, [], 8, consumerProgram)), computeUnits: 1 }), "TRANSACTION_TOO_LARGE");
await rejects(plan({ updates: [], publish: unit([ix(60, [])]), check }, consumer(keys(2), 8, 1_400_001)), "TRANSACTION_TOO_LARGE");

// (c) Composite: one indivisible tag-87 producer before the consumer; over limits it moves whole into prep (K ≥ 1), never split.
{
  const fused = unit([ix(87, keys(26), 146)], 130_000);
  const c = consumer(keys(28), 600);
  const p = await plan({ updates: [], publish: fused, check, ageLimits: ages }, c);
  assert.equal(p.mode, "inline");
  if (p.mode !== "inline") throw new Error("unreachable");
  assert.deepEqual(tags(p.instructions), [87, 1]); assert.equal(p.estimate.computeUnits, 430_000);
  await assertBundle(p, c);
  assert.ok(!p.instructions.some((i) => i.programAddress === MIMIR_REFRESH_COMPUTE_BUDGET_PROGRAM_ID));
  const wide = unit([ix(87, keys(40), 146)], 130_000);
  await rejects(plan({ updates: [], publish: wide, check, ageLimits: ages }, consumer(keys(30), 600)), "PUBLICATION_AGE_UNSUPPORTED");
  const q = await plan({ updates: [], publish: wide, check, ageLimits: ages }, kc(consumer(keys(30), 600)));
  assert.equal(q.mode, "split");
  if (q.mode !== "split") throw new Error("unreachable");
  assert.deepEqual(q.refreshTransactions.map((t) => tags(t.instructions)), [[87]]);
  await assertBundle(q, kc(consumer(keys(30), 600)));
}

// Foreign program instructions are refused.
await rejects(plan({ updates: [], publish: unit([{ ...ix(60, []), programAddress: key() }]), check }, consumer([])), "PROGRAM_ABI_MISMATCH");

console.log("refreshPlanner tests passed");

// Confirmed-prep with K: classic split bounded by max_snapshot_age_slots; composite bounded by the component age limit.
{
  const publish = [...keys(5).map(() => ix(77, keys(9))), ix(83, keys(14))];
  const kcl = (k: number): MimirConsumer => kc(consumer(keys(28), 1400), k);
  const classic: MimirRefreshGroup = { updates: [], publish: unit(publish, 500_000), check, ageLimits: { maxSnapshotAgeSlots: 8 } };
  const p = await plan(classic, kcl(4));
  assert.equal(p.mode, "split");
  assert.deepEqual(p.execution, { ordering: "confirmed-prep", prepCommitment: "confirmed", prepSequence: "in-order-each-confirmed", maxPublicationAgeSlots: 4, onMiss: "replan" });
  assert.equal(p.publish.maxAgeSlots, 4);
  assert.equal((await plan(classic, kcl(8))).mode, "split");
  await rejects(plan(classic, kcl(9)), "PUBLICATION_AGE_UNSUPPORTED");
  await rejects(plan({ ...classic, ageLimits: undefined }, kcl(1)), "PUBLICATION_AGE_UNSUPPORTED");
  await rejects(plan(classic, kcl(-1)), "INVALID_ARGUMENT");

  const ccheck = { ...check, kind: "composite-csp" } as const;
  const composite: MimirRefreshGroup = { updates: [], publish: unit([ix(87, keys(50), 146)], 130_000), check: ccheck,
    ageLimits: { maxSnapshotAgeSlots: 2, maxComponentSnapshotAgeSlots: 6 } };
  await rejects(plan(composite, { ...consumer(keys(20), 1200), maxPublicationAgeSlots: 0 }), "PUBLICATION_AGE_UNSUPPORTED");
  const q = await plan(composite, { ...consumer(keys(20), 1200), maxPublicationAgeSlots: 2 });
  assert.equal(q.mode, "split"); assert.equal(q.publish.maxAgeSlots, 2);
}

// Readiness (§7 a–f).
{
  const { assessMimirRefresh, mimirSampledRefreshReadiness, mimirReadinessFromBuildError,
    mimirPublicationHeadroomSlots, assertMimirPublicationSupportsK, verifyMimirPublicationForConsumer } = await import("../src/beta/refreshPlanner.js");
  const { buildTestSnapshotHeader, buildTestFeedConfigHeader } = await import("../src/fixtures.js");
  const { initialMimirSampledReadiness } = await import("../src/internal/sampledTemporalCore.js");
  const rpc = (err: unknown, accounts: readonly (Uint8Array | null)[] = [null, null, null]) => ({
    getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1n } }) }),
    simulateTransaction: () => ({ send: async () => ({ value: { err, unitsConsumed: 1000n, logs: [] } }) }),
    getMultipleAccounts: () => ({ send: async () => ({ value: accounts.map((a, i) => a ? { owner: i === 0 ? snapOwner : program,
      data: [Buffer.from(a).toString("base64"), "base64"] } : null) }) }),
  }) as never;
  let snapOwner: Address = program;
  const [cfgPda, cfgBump] = await getProgramDerivedAddress({ programAddress: program, seeds: [Buffer.from("composite_feed_config"), new Uint8Array(32).fill(9)] });
  const ccheck = { ...check, kind: "composite-csp", slotOffset: 112, validUntilSlotOffset: 120, expectedSnapshotSource: 4, config: cfgPda } as const;
  const composite: MimirRefreshGroup = { updates: [], publish: unit([ix(87, keys(20), 146)], 130_000), check: ccheck,
    ageLimits: { maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150 } };
  let builds = 0;
  const builder = (group: MimirRefreshGroup) => Object.assign(async () => { builds++; return group; },
    { publication: async () => ({ check: group.check, ...(group.ageLimits ? { ageLimits: group.ageLimits } : {}),
      expected: { feedId: new Uint8Array(32).fill(9), configRevision: 2n } }) });
  const assess = (group: MimirRefreshGroup, r?: unknown, k = 0) => assessMimirRefresh({ programId: program, payer, target: { kind: "composite", compositeConfig: key() },
    consumer: { ...consumer(keys(8)), maxPublicationAgeSlots: k }, buildRefreshGroup: builder(group), ...(r ? { rpc: r as never } : {}) });

  // (a) cold fused composite: one tag 87, no classic 60/83, full refresh.
  const a = await assess(composite, rpc(null), 10);
  assert.equal(a.state, "needs-full-refresh");
  assert.ok([...composite.updates, composite.publish].flatMap((u) => u.instructions).every((i) => i.data[0] !== 60 && i.data[0] !== 83));

  // (b) simulation verdicts: Custom 15 is typed activity; revision races replan; CU overflow and oversize groups give no verdict.
  const b = await assess(composite, rpc({ InstructionError: [0, { Custom: 15 }] }));
  assert.equal(b.state, "not-ready");
  if (b.state !== "not-ready") throw new Error("unreachable");
  assert.equal(b.evidence.instructionIndex, 0); assert.equal(b.evidence.tag, 87); assert.equal(b.reason, "stale-source-activity"); assert.equal(b.dependency, "dex-activity");
  const race = await assess(composite, rpc({ InstructionError: [0, { Custom: 58 }] }));
  assert.equal(race.state === "not-ready" && race.dependency, "replan");
  assert.equal((await assess(composite, rpc({ InstructionError: [2, "ComputationalBudgetExceeded"] }))).state, "needs-full-refresh");
  // An indivisible tag 87 that cannot fit any transaction is refused, never split.
  await rejects(assess({ ...composite, publish: unit([ix(87, keys(63), 146)], 130_000) }, rpc(null), 3), "TRANSACTION_TOO_LARGE");

  // (d) kind 9: accepted-record count, chain-second spacing/bucket/max gap and span.
  const d = mimirSampledRefreshReadiness(initialMimirSampledReadiness(), [ix(77, keys(4))]);
  assert.equal(d?.state, "needs-spaced-refreshes");
  if (d?.state !== "needs-spaced-refreshes") throw new Error("unreachable");
  assert.deepEqual([d.count, d.countIsLowerBound, d.minSpacingSeconds, d.bucketSeconds, d.maxSpacingSeconds, d.minSupportSeconds], [13, true, 10, 10, 15, 120]);
  assert.equal(mimirSampledRefreshReadiness({ ...initialMimirSampledReadiness(), status: "quality-hold" }, [])?.state, "not-ready");
  assert.equal(mimirSampledRefreshReadiness({ ...initialMimirSampledReadiness(), status: "ready" }, []), null);

  // (e) quiet anchor without a committed anchor and DAMM sticky invalidation stay explicit.
  const e1 = mimirReadinessFromBuildError(new Error("w"), { refreshOnlyInstructions: [ix(77, [])], remainingWarmupSeconds: null });
  assert.equal(e1?.state, "needs-spaced-refreshes"); assert.equal(e1?.state === "needs-spaced-refreshes" && e1.countIsLowerBound, true);
  const e2 = mimirReadinessFromBuildError(Object.assign(new Error("d"), { code: "MimirDammOnlyBIntervalUnavailable", reason: "invalid-witness" }), null);
  assert.equal(e2?.state === "not-ready" && e2.reason, "damm-invalid-witness"); assert.equal(e2?.state === "not-ready" && e2.dependency, "external-state");
  assert.equal(mimirReadinessFromBuildError(new Error("other"), null), null);
  await assert.rejects(assessMimirRefresh({ programId: program, payer, target: { kind: "classic", feedConfig: key() }, consumer: consumer(keys(2)),
    buildRefreshGroup: async () => { throw new Error("boom"); } }), /boom/);

  // (f) residual budget and the consumer verifier against the actual publication and its config.
  const feedId = new Uint8Array(32).fill(9);
  const feedConfig = (lifecycle = 3, revision = 3n) => {
    const data = new Uint8Array(357); const dv = new DataView(data.buffer);
    data.set(buildTestFeedConfigHeader()); dv.setUint16(8, 1, true); dv.setUint16(10, 357, true); data.set(feedId, 16); data.fill(1, 48, 80); data.fill(2, 80, 112);
    dv.setInt32(112, -8, true); data[117] = lifecycle; dv.setUint16(130, 150, true); dv.setUint16(132, 150, true);
    dv.setBigUint64(296, revision, true); dv.setBigUint64(304, 5n, true); data.fill(3, 325, 357);
    return data;
  };
  const snap = (src: number, p: bigint, v: bigint, a = p, status = 0, quote = 0) => {
    const data = new Uint8Array(buildTestSnapshotHeader()); const dv = new DataView(data.buffer);
    data.set(feedId, 16); dv.setBigUint64(80, 5n, true); dv.setBigUint64(88, 3n, true); dv.setInt32(196, -8, true); dv.setUint16(420, 2, true);
    dv.setBigUint64(96, 7n, true); data[104] = status; data[107] = src; dv.setBigUint64(116, p, true); dv.setBigUint64(124, v, true); dv.setBigUint64(156, a, true);
    data[257] = quote;
    const price = dv.getBigUint64(200, true);
    dv.setBigUint64(216, price * 9985n / 10000n, true); dv.setBigUint64(232, (price * 10015n + 9999n) / 10000n, true);
    return data;
  };
  const c2 = { ...check, expectedSnapshotSource: 2, capModelVersionOffset: 420, expectedCapModelVersion: 2 } as const;
  assert.equal(mimirPublicationHeadroomSlots(snap(2, 1000n, 1150n, 1000n), c2, { maxSnapshotAgeSlots: 150, maxSourceActivityAgeSlots: 150 }), 150n);
  assert.equal(mimirPublicationHeadroomSlots(snap(2, 1000n, 1150n, 900n), c2, { maxSnapshotAgeSlots: 150, maxSourceActivityAgeSlots: 150 }), 50n);
  assert.equal(mimirPublicationHeadroomSlots(snap(2, 1000n, 1150n, 900n), c2, { maxSourceActivityAgeSlots: 150, consumerMaxSourceActivityAgeSlots: 120 }), 20n);
  assert.equal(mimirPublicationHeadroomSlots(snap(2, 1000n, 1150n, 1000n), c2, { maxSnapshotAgeSlots: 150, consumerMaxSnapshotAgeSlots: 20 }), 20n);
  assert.equal(mimirPublicationHeadroomSlots(snap(5, 1000n, 1030n, 1n), check, { maxSnapshotAgeSlots: 150, maxSourceActivityAgeSlots: 1 }), 30n);
  const csp = (p = 1000n, v = 1005n, quote = 0, source = 4) => {
    const data = new Uint8Array(720); const dv = new DataView(data.buffer);
    data.set(Buffer.from("MIMIRCSP")); dv.setUint16(10, 720, true); data.set(getAddressEncoder().encode(cfgPda), 48);
    for (const o of [136, 152, 168, 184, 200]) dv.setBigUint64(o, 1n, true);
    data[105] = 4; data[109] = 1; data.set(ccfg.subarray(128, 160), 248); data[313] = 1;
    data.fill(4, 320, 352); for (const o of [352, 360, 368, 384]) dv.setBigUint64(o, 1n, true);
    data.set(feedId, 16); dv.setBigUint64(80, 5n, true); dv.setBigUint64(88, 2n, true); dv.setBigUint64(96, 7n, true); data[107] = source; data[110] = quote;
    dv.setBigUint64(112, p, true); dv.setBigUint64(120, v, true); dv.setBigUint64(136, p, true); dv.setBigUint64(144, p, true); dv.setInt32(160, -6, true);
    data.set(createHash("sha256").update("MIMIR_COMPOSITE_SNAPSHOT_COMPONENTS_V1").update(data.subarray(320, 400)).digest(), 280);
    return data;
  };
  const ccfg = await (async () => {
    const out = new Uint8Array(629), dv = new DataView(out.buffer);
    out.set(Buffer.from("MIMIRCFC")); dv.setUint16(10, 629, true); out.set(feedId, 16); out.fill(3, 48, 80); out.fill(4, 80, 112);
    dv.setInt32(112, -6, true); out[116] = 1; out[117] = 4; out[119] = 1; dv.setUint16(120, 150, true); dv.setUint16(122, 150, true);
    dv.setBigUint64(160, 5n, true); dv.setBigUint64(168, 2n, true); dv.setBigUint64(176, 1n, true); out[184] = cfgBump;
    out.fill(4, 229, 261); out.fill(5, 261, 293); dv.setBigUint64(301, 1n, true);
    out.set(createHash("sha256").update("MIMIR_COMPOSITE_COMPONENTS_V1").update(out.subarray(80, 112)).update(Uint8Array.of(1)).update(out.subarray(197, 309)).digest(), 128);
    const { encodeMimirCompositeV1 } = await import("../src/beta/codecs.js");
    return encodeMimirCompositeV1(out, key(), "INDEX");
  })();
  assert.equal(mimirPublicationHeadroomSlots(csp(), ccheck), 5n);
  assert.throws(() => assertMimirPublicationSupportsK(csp(), ccheck, 6), /PUBLICATION_AGE_UNSUPPORTED/);
  assert.equal(assertMimirPublicationSupportsK(snap(2, 1000n, 1150n, 900n), c2, 50, { maxSourceActivityAgeSlots: 150 }), 50n);
  assert.throws(() => assertMimirPublicationSupportsK(snap(2, 1000n, 1150n, 900n), c2, 51, { maxSourceActivityAgeSlots: 150 }), /PUBLICATION_AGE_UNSUPPORTED/);
  const v = (data: Uint8Array, clockSlot: bigint, k: number, expected?: object, config = feedConfig(), more: object = {}) =>
    verifyMimirPublicationForConsumer({ data, config, check: c2, clockSlot, maxPublicationAgeSlots: k, ...(expected ? { expected } : {}), ...more });
  assert.deepEqual(v(snap(2, 1000n, 1150n), 1010n, 10), { ok: true, publicationSlot: 1000n, validUntilSlot: 1150n, ageSlots: 10n, lastUsableSlot: 1010n });
  assert.equal(v(snap(2, 1000n, 1150n), 1011n, 10).ok, false);
  assert.deepEqual(v(snap(2, 1000n, 1005n), 1006n, 10), { ok: false, reason: "EXPIRED" });
  assert.deepEqual(v(snap(2, 1000n, 1150n, 1000n, 2), 1000n, 10), { ok: false, reason: "NOT_FRESH" });
  assert.deepEqual(v(snap(0, 1000n, 1150n), 1000n, 10), { ok: false, reason: "WRONG_SOURCE" });
  assert.deepEqual(v(snap(2, 1000n, 1150n), 1000n, 10, { revision: 8n }), { ok: false, reason: "WRONG_REVISION" });
  assert.deepEqual(v(snap(2, 1000n, 1150n, 0n), 1000n, 10), { ok: false, reason: "STALE_ACTIVITY" });
  assert.deepEqual(v(snap(2, 1000n, 1150n, 900n), 1010n, 10, undefined, feedConfig(), { consumerMaxSourceActivityAgeSlots: 100 }), { ok: false, reason: "STALE_ACTIVITY" });
  assert.deepEqual(v(snap(2, 1000n, 1150n, 1000n, 0, 1), 1000n, 10), { ok: false, reason: "QUOTE_NOT_OK" });
  assert.deepEqual(v(snap(2, 1000n, 1150n), 1000n, 10, undefined, feedConfig(2)), { ok: false, reason: "CONFIG_MISMATCH" });
  assert.deepEqual(v(snap(2, 1000n, 1150n), 1000n, 10, undefined, feedConfig(3, 4n)), { ok: false, reason: "CONFIG_MISMATCH" });
  assert.deepEqual(v(snap(2, 1000n, 1150n), 1000n, 10, { priceExponent: -9 }), { ok: false, reason: "WRONG_BINDING" });
  assert.deepEqual(v(snap(2, 1000n, 1150n), 1000n, 10, { planHash: new Uint8Array(32).fill(1) }), { ok: false, reason: "WRONG_BINDING" });
  const capped = snap(2, 1000n, 1150n); capped[421] = 1;
  assert.equal(v(capped, 1000n, 10).ok, false);
  assert.deepEqual(v(new Uint8Array(100), 1000n, 10), { ok: false, reason: "MALFORMED" });
  const zeroMagic = snap(2, 1000n, 1150n); zeroMagic.fill(0, 0, 8);
  assert.deepEqual(v(zeroMagic, 1000n, 10), { ok: false, reason: "MALFORMED" });
  const badVersion = snap(2, 1000n, 1150n); badVersion[8] = 1;
  assert.deepEqual(v(badVersion, 1000n, 10), { ok: false, reason: "MALFORMED" });
  assert.deepEqual(v(snap(2, 1000n, 1150n, 900n), 1051n, 150), { ok: false, reason: "STALE_ACTIVITY" });
  assert.deepEqual(v(snap(2, 1000n, 1150n), 1000n, 10, { configRevision: 4n }), { ok: false, reason: "WRONG_BINDING" });
  assert.equal(v(snap(2, 1000n, 1150n), 1000n, 10, { planHash: [new Uint8Array(32).fill(1), snap(2, 1n, 1n).slice(262, 294)] }).ok, true);
  assert.deepEqual(v(snap(2, 1000n, 1150n), 1000n, 10, undefined, new Uint8Array(40)), { ok: false, reason: "MALFORMED" });
  const vc = (data: Uint8Array, config = ccfg) => verifyMimirPublicationForConsumer({ data, config, check: ccheck, clockSlot: 1002n, maxPublicationAgeSlots: 3, programId: program });
  assert.deepEqual(verifyMimirPublicationForConsumer({ data: csp(), config: ccfg, check: ccheck, clockSlot: 1002n, maxPublicationAgeSlots: 3 }),
    { ok: false, reason: "FEED_POLICY", error: "MissingProgramId" });
  assert.equal(vc(csp()).ok, true);
  assert.deepEqual(vc(csp(1000n, 1005n, 1)), { ok: false, reason: "QUOTE_NOT_OK" });
  assert.equal(vc(csp(1000n, 1005n, 0, 2)).ok, false);
  assert.deepEqual(vc(csp(), new Uint8Array(100)), { ok: false, reason: "MALFORMED" });

  const dvSet = (d: Uint8Array, o: number, x: bigint) => new DataView(d.buffer).setBigUint64(o, x, true);
  // Ready from the stored publication before any build; insufficient headroom falls through to a full refresh.
  const clock = new Uint8Array(40); new DataView(clock.buffer).setBigUint64(0, 1002n, true);
  builds = 0;
  const ready = await assess(composite, rpc(null, [csp(), ccfg, clock]), 3);
  assert.equal(ready.state, "ready"); assert.equal(ready.state === "ready" && ready.lastUsableSlot, 1003n); assert.equal(builds, 0);
  assert.equal((await assess(composite, rpc(null, [csp(), ccfg, clock]), 6)).state, "needs-full-refresh");
  const zeroCsp = csp(); zeroCsp.fill(0, 0, 8); dvSet(zeroCsp, 96, 0n);
  assert.equal((await assess(composite, rpc(null, [zeroCsp, ccfg, clock]), 3)).state, "needs-full-refresh");
  snapOwner = key();
  assert.equal((await assess(composite, rpc(null, [csp(), ccfg, clock]), 3)).state, "needs-full-refresh");
  snapOwner = program;
  const otherFeed = csp(); otherFeed.fill(8, 16, 48);
  assert.equal((await assess(composite, rpc(null, [otherFeed, ccfg, clock]), 3)).state, "needs-full-refresh");
  // Kit RPC upcasts the instruction index and Custom code to bigint.
  const big = await assess(composite, rpc({ InstructionError: [0n, { Custom: 15n }] }));
  if (big.state !== "not-ready") throw new Error(`unexpected ${big.state}`);
  assert.deepEqual([big.reason, big.evidence.instructionIndex, big.evidence.tag, big.evidence.customCode], ["stale-source-activity", 0, 87, 15]);
  assert.equal((await assess(composite, rpc({ InstructionError: [2n, "ComputationalBudgetExceeded"] }))).state, "needs-full-refresh");

  // A zero-activity CSP is not stale when the consumer bounds activity.
  const zeroAct = csp(); dvSet(zeroAct, 144, 0n);
  assert.equal(verifyMimirPublicationForConsumer({ data: zeroAct, config: ccfg, check: ccheck, clockSlot: 1002n, maxPublicationAgeSlots: 3,
    consumerMaxSourceActivityAgeSlots: 10, programId: program }).ok, true);
  console.log("refreshPlanner readiness tests passed");
}

// Planning reuse: one blockhash per plan, the caller's blockhash is used.
{
  const calls = { blockhash: 0, simulate: 0 };
  const rpc = {
    getLatestBlockhash: () => ({ send: async () => { calls.blockhash++; return { value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1n } }; } }),
    simulateTransaction: () => ({ send: async () => { calls.simulate++; return { value: { err: null, unitsConsumed: 1000n, logs: [] } }; } }),
  } as never;
  const composite: MimirRefreshGroup = { updates: [], publish: unit([ix(87, keys(50), 146)], 130_000),
    check: { ...check, kind: "composite-csp" }, ageLimits: { maxSnapshotAgeSlots: 2, maxComponentSnapshotAgeSlots: 6 } };
  const seen: unknown[] = [];
  const builder = async (_: unknown, reuse?: unknown) => { seen.push(reuse); return composite; };
  const args = { programId: program, payer, target: { kind: "composite", compositeConfig: key() }, consumer: kc(consumer(keys(20), 1200), 2), buildRefreshGroup: builder } as const;
  const withRpc = await planMimirRefresh({ ...args, rpc });
  assert.equal(calls.blockhash, 1);
  const bounded = await planMimirRefresh(args);
  if (withRpc.mode !== "split" || bounded.mode !== "split") throw new Error("unexpected mode");
  assert.deepEqual(withRpc.refreshTransactions.map((t) => t.instructions), bounded.refreshTransactions.map((t) => t.instructions));
  const recentBlockhash = { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9n };
  await planMimirRefresh({ ...args, rpc, recentBlockhash });
  assert.equal(calls.blockhash, 1);
  assert.deepEqual(seen, [undefined, undefined, { recentBlockhash }]);
  console.log("planning reuse tests passed");
}

// Plan session: learned program-owned accounts are served from one coherent read; sysvars and foreign accounts stay live.
{
  const { mimirPlanSession } = await import("../src/planSession.js");
  const owner = new PublicKey(program), foreign = PublicKey.unique(), cfg = PublicKey.unique(), pool = PublicKey.unique();
  const clock = new PublicKey("SysvarC1ock11111111111111111111111111111111");
  const reads: string[] = [];
  const info = (k: PublicKey) => ({ data: Buffer.from([k.toBytes()[0]!]), owner: k.equals(pool) ? foreign : owner, executable: false, lamports: 1 });
  const connection = {
    getAccountInfoAndContext: async (k: PublicKey) => { reads.push("one:" + k.toBase58()); return { context: { slot: 5 }, value: info(k) }; },
    getAccountInfo: async function (this: { getAccountInfoAndContext(k: PublicKey): Promise<{ value: unknown }> }, k: PublicKey) { return (await this.getAccountInfoAndContext(k)).value; },
    getMultipleAccountsInfoAndContext: async (ks: PublicKey[]) => { reads.push("many:" + ks.length); return { context: { slot: 6 }, value: ks.map(info) }; },
    getLatestBlockhash: async () => { reads.push("blockhash"); return { blockhash: "h", lastValidBlockHeight: 1 }; },
  } as never;
  const run = async () => {
    const s = mimirPlanSession(connection, { programId: owner, commitment: "confirmed", key: "t" });
    assert.equal(mimirPlanSession(s, { programId: owner, commitment: "confirmed", key: "other" }), s);
    for (const k of [cfg, pool, clock, cfg]) assert.deepEqual((await s.getAccountInfo(k, "confirmed"))!.data, info(k).data);
    await s.getLatestBlockhash("confirmed"); await s.getLatestBlockhash("confirmed");
  };
  await run();
  assert.deepEqual(reads.splice(0), ["one:" + cfg.toBase58(), "one:" + pool.toBase58(), "one:" + clock.toBase58(), "one:" + cfg.toBase58(), "blockhash"]);
  await run();
  assert.deepEqual(reads.splice(0), ["many:1", "one:" + pool.toBase58(), "one:" + clock.toBase58(), "blockhash"]);
  const s = mimirPlanSession(connection, { programId: owner, commitment: "confirmed", key: "u", recentBlockhash: { blockhash: "x", lastValidBlockHeight: 2n },
    prefetchedAccounts: new Map([[cfg.toBase58(), { data: Uint8Array.of(7), slot: 9n, owner: program }], [pool.toBase58(), { data: Uint8Array.of(8), slot: 8n, owner: program }]]) });
  assert.deepEqual((await s.getAccountInfo(cfg, "confirmed"))!.data, Buffer.from([7]));
  await assert.rejects(s.getAccountInfoAndContext(cfg, { commitment: "confirmed", minContextSlot: 10 }), /BelowFloor/);
  await assert.rejects(s.getAccountInfo(pool, "confirmed"), /BelowFloor/);
  assert.equal((await s.getLatestBlockhash("confirmed")).blockhash, "x");
  assert.deepEqual(reads.splice(0), ["one:" + cfg.toBase58(), "one:" + pool.toBase58()]);
  console.log("plan session tests passed");
}

// Plan session floor: every fallback carries max(caller, supplied floor); below-floor contextual and learned-batch reads are rejected.
{
  const { mimirPlanSession } = await import("../src/planSession.js");
  const owner = new PublicKey(program), a = PublicKey.unique(), b = PublicKey.unique(), c = PublicKey.unique();
  let slot = 8, batchSlot = 8, batches = 0;
  const configs: unknown[] = [];
  const info = (k: PublicKey) => ({ data: Buffer.from([k.toBytes()[0]!]), owner, executable: false, lamports: 1 });
  const connection = {
    getAccountInfoAndContext: async (k: PublicKey, config: unknown) => { configs.push(config); return { context: { slot }, value: info(k) }; },
    getAccountInfo: async (k: PublicKey, config: unknown) => { configs.push(config); return info(k); },
    getMultipleAccountsInfoAndContext: async (ks: PublicKey[], config: unknown) => { batches++; configs.push(config); return { context: { slot: batchSlot }, value: ks.map(info) }; },
  } as never;
  const prefetchedAccounts = new Map([[a.toBase58(), { data: Uint8Array.of(7), slot: 9n, owner: program }]]);
  const make = (key: string) => mimirPlanSession(connection, { programId: owner, commitment: "confirmed", key, prefetchedAccounts });
  let s = make("floor");
  await s.getAccountInfo(b, "confirmed");
  await assert.rejects(s.getAccountInfoAndContext(c, "confirmed"), /BelowFloor/);
  await assert.rejects(s.getAccountInfoAndContext(c, { commitment: "confirmed", minContextSlot: 3 }), /BelowFloor/);
  assert.deepEqual(configs.splice(0), [{ commitment: "confirmed", minContextSlot: 9 }, { commitment: "confirmed", minContextSlot: 9 },
    { commitment: "confirmed", minContextSlot: 9 }]);
  slot = 9;
  assert.equal((await s.getAccountInfoAndContext(c, "confirmed")).context.slot, 9);
  configs.splice(0);
  s = make("floor");
  assert.equal((await s.getAccountInfoAndContext(c, "confirmed")).context.slot, 9);
  assert.equal(batches, 1);
  assert.deepEqual(configs.splice(0), [{ commitment: "confirmed", minContextSlot: 9 }, { commitment: "confirmed", minContextSlot: 9 }]);
  batchSlot = 9; slot = 10;
  s = make("floor");
  assert.equal((await s.getAccountInfoAndContext(c, "confirmed")).context.slot, 9);
  assert.equal(batches, 2);
  assert.equal(configs.splice(0).length, 1);
  const { getMultipleAccountsInfoAndContextChunked } = await import("../src/chunkedAccounts.js");
  batchSlot = 9; configs.splice(0);
  s = make("multi");
  assert.equal((await getMultipleAccountsInfoAndContextChunked(s, [b, c], { commitment: "confirmed" })).context.slot, 9);
  assert.deepEqual(configs.at(-1), { commitment: "confirmed", minContextSlot: 9 });
  assert.equal((await s.getMultipleAccountsInfo([b], { commitment: "confirmed", minContextSlot: 4 })).length, 1);
  assert.deepEqual(configs.at(-1), { commitment: "confirmed", minContextSlot: 9 });
  batchSlot = 8;
  await assert.rejects(getMultipleAccountsInfoAndContextChunked(s, [b, c], { commitment: "confirmed" }), /BelowFloor/);
  await assert.rejects(s.getMultipleAccountsInfo([b], "confirmed"), /BelowFloor/);
  configs.splice(0);
  const plain = mimirPlanSession(connection, { programId: owner, commitment: "confirmed", key: "nofloor" });
  assert.equal((await getMultipleAccountsInfoAndContextChunked(plain, [b], { commitment: "confirmed" })).context.slot, 8);
  assert.deepEqual(configs.at(-1), { commitment: "confirmed" });
  console.log("plan session floor tests passed");
}

// Plan session multi reads: the RPC answers every read that reaches it at `slot` (0xee bytes, an authentic Clock) and records its config.
const sysvarClock = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const sysvarOwner = address("Sysvar1111111111111111111111111111111111111");
const clockData = (slot: number, unixTimestamp = 20n) => {
  const data = Buffer.alloc(40); data.writeBigUInt64LE(BigInt(slot)); data.writeBigInt64LE(unixTimestamp, 32); return data;
};
const clockEntry = { data: clockData(9), owner: sysvarOwner };
async function multiReadSession(name: string, prefetched: readonly (readonly [PublicKey, Partial<MimirPrefetchedAccount>?])[], slot = 9) {
  const { mimirPlanSession } = await import("../src/planSession.js");
  const owner = new PublicKey(program), live: unknown[] = [];
  const answer = (k: PublicKey) => k.equals(sysvarClock) ? { data: clockData(slot), owner: new PublicKey(sysvarOwner), executable: false, lamports: 1 }
    : { data: Buffer.of(0xee), owner, executable: false, lamports: 1 };
  const connection = {
    getAccountInfo: async (k: PublicKey) => answer(k),
    getMultipleAccountsInfoAndContext: async (ks: PublicKey[], config: unknown) => { live.push(config); return { context: { slot }, value: ks.map(answer) }; },
  } as never;
  const prefetchedAccounts = new Map(prefetched.map(([k, entry]): [string, MimirPrefetchedAccount] =>
    [k.toBase58(), { data: Uint8Array.of(7), slot: 9n, owner: program, ...entry }]));
  return { live, session: mimirPlanSession(connection, { programId: owner, commitment: "confirmed", key: name, prefetchedAccounts }) };
}

// Plan session multi reads: keys all served at one slot, the caller's authentic Clock included, are served as copies through every reader shape.
{
  const { getMultipleAccountsInfoAndContextChunked } = await import("../src/chunkedAccounts.js");
  const { createConnectionPlanningRpc } = await import("../src/existingFeedRows.js");
  const { readMimirBetaAccountCohort } = await import("../src/beta/rpc.js");
  const a = PublicKey.unique(), b = PublicKey.unique();
  const { live, session } = await multiReadSession("multi-served", [[a, { data: Uint8Array.of(1) }], [b, { data: Uint8Array.of(2) }], [sysvarClock, clockEntry]]);
  const read = await session.getMultipleAccountsInfoAndContext([a, b, sysvarClock], "confirmed");
  assert.equal(read.context.slot, 9);
  assert.deepEqual(read.value.map((x) => x!.data), [Buffer.of(1), Buffer.of(2), clockData(9)]);
  assert.ok(read.value[0]!.owner.equals(new PublicKey(program)) && read.value[2]!.owner.equals(new PublicKey(sysvarOwner)));
  read.value[0]!.data[0] = 99;
  assert.deepEqual((await session.getMultipleAccountsInfo([a, b], "confirmed")).map((x) => x!.data), [Buffer.of(1), Buffer.of(2)]);
  assert.equal((await getMultipleAccountsInfoAndContextChunked(session, [b, sysvarClock], { commitment: "confirmed", minContextSlot: 9 })).context.slot, 9);
  const cohort = await readMimirBetaAccountCohort(createConnectionPlanningRpc(session), [address(a.toBase58()), address(sysvarClock.toBase58())], "confirmed");
  assert.equal(cohort.slot, 9n); assert.deepEqual(cohort.value.map((x) => Buffer.from(x!.data)), [Buffer.of(1), clockData(9)]);
  assert.deepEqual(live, []);
  console.log("plan session served multi-read tests passed");
}

// Plan session multi reads: keys served at two slots (the caller's set at 9, the learned batch at 10) or a missing key read live.
{
  const a = PublicKey.unique(), c = PublicKey.unique(), missing = PublicKey.unique();
  await (await multiReadSession("multi-mixed", [])).session.getAccountInfo(c, "confirmed");
  const { live, session } = await multiReadSession("multi-mixed", [[a]], 10);
  assert.equal((await session.getMultipleAccountsInfoAndContext([c], "confirmed")).context.slot, 10);
  assert.equal((await session.getMultipleAccountsInfoAndContext([a], "confirmed")).context.slot, 9);
  assert.equal(live.length, 1);
  for (const keys of [[a, c], [c, a], [a, missing], [missing, a]]) {
    const response = await session.getMultipleAccountsInfoAndContext(keys, "confirmed");
    assert.equal(response.context.slot, 10); assert.ok(response.value.every((x) => x!.data[0] === 0xee));
  }
  assert.deepEqual(live, Array(5).fill({ commitment: "confirmed", minContextSlot: 9 }));
  console.log("plan session mixed-slot multi-read tests passed");
}

// Plan session multi reads: a dataSlice read goes live; the planning RPC's sliced ProgramData partition, ahead of the served one, converges in one atomic live read.
{
  const { createConnectionPlanningRpc } = await import("../src/existingFeedRows.js");
  const { readMimirBetaAccountCohort, MIMIR_BETA_HEADER_ONLY_PROGRAM_DATA } = await import("../src/beta/rpc.js");
  const a = PublicKey.unique(), header = [...MIMIR_BETA_HEADER_ONLY_PROGRAM_DATA][0]!;
  const { live, session } = await multiReadSession("multi-slice", [[a], [new PublicKey(header)]], 10);
  assert.equal((await session.getMultipleAccountsInfoAndContext([a], { commitment: "confirmed", dataSlice: undefined })).context.slot, 9);
  const sliced = await session.getMultipleAccountsInfoAndContext([a], { commitment: "confirmed", dataSlice: { offset: 0, length: 1 } });
  assert.equal(sliced.context.slot, 10); assert.equal(sliced.value[0]!.data[0], 0xee);
  const cohort = await readMimirBetaAccountCohort(createConnectionPlanningRpc(session), [address(a.toBase58()), header], "confirmed");
  assert.equal(cohort.slot, 10n); assert.ok(cohort.value.every((x) => x!.data[0] === 0xee));
  const slice45 = { offset: 0, length: 45 };
  assert.deepEqual(live, [{ commitment: "confirmed", dataSlice: { offset: 0, length: 1 }, minContextSlot: 9 }, { commitment: "confirmed", minContextSlot: 9, dataSlice: slice45 },
    { commitment: "confirmed", minContextSlot: 10, dataSlice: slice45 }]);
  console.log("plan session dataSlice multi-read tests passed");
}

// Plan session multi reads: a minContextSlot above the served slot reads live at that floor.
{
  const { getMultipleAccountsInfoAndContextChunked } = await import("../src/chunkedAccounts.js");
  const a = PublicKey.unique(), b = PublicKey.unique();
  const { live, session } = await multiReadSession("multi-min", [[a], [b], [sysvarClock, clockEntry]], 10);
  assert.equal((await session.getMultipleAccountsInfoAndContext([a, b], { commitment: "confirmed", minContextSlot: 9 })).context.slot, 9);
  const above = await session.getMultipleAccountsInfoAndContext([a, b], { commitment: "confirmed", minContextSlot: 10 });
  assert.equal(above.context.slot, 10); assert.ok(above.value.every((x) => x!.data[0] === 0xee));
  const cohort = await getMultipleAccountsInfoAndContextChunked(session, [a, sysvarClock], { commitment: "confirmed", minContextSlot: 10 });
  assert.equal(cohort.context.slot, 10); assert.deepEqual(cohort.value[1]!.data, clockData(10));
  assert.deepEqual(live, Array(2).fill({ commitment: "confirmed", minContextSlot: 10 }));
  console.log("plan session minContextSlot multi-read tests passed");
}

// Plan session multi reads: a sysvar is served only from the caller's set at its slot; one not supplied there reads live.
{
  const { getMultipleAccountsInfoAndContextChunked } = await import("../src/chunkedAccounts.js");
  const a = PublicKey.unique(), rent = new PublicKey("SysvarRent111111111111111111111111111111111");
  const supplied = await multiReadSession("multi-sysvar", [[a], [sysvarClock, clockEntry]], 10);
  assert.equal((await supplied.session.getMultipleAccountsInfoAndContext([a, sysvarClock], "confirmed")).context.slot, 9);
  assert.deepEqual(supplied.live, []);
  const unsupplied: (readonly [PublicKey, Partial<MimirPrefetchedAccount>?])[][] = [[[a]], [[a], [sysvarClock, { ...clockEntry, data: clockData(8), slot: 8n }]]];
  for (const prefetched of unsupplied) {
    const { live, session } = await multiReadSession("multi-sysvar", prefetched, 10);
    const cohort = await getMultipleAccountsInfoAndContextChunked(session, [a, sysvarClock], { commitment: "confirmed" });
    assert.equal(cohort.context.slot, 10); assert.deepEqual(cohort.value[1]!.data, clockData(10));
    assert.equal((await session.getMultipleAccountsInfoAndContext([sysvarClock], "confirmed")).context.slot, 10);
    assert.equal((await session.getMultipleAccountsInfoAndContext([a, rent], "confirmed")).context.slot, 10);
    assert.equal(live.length, 3);
  }
  console.log("plan session sysvar multi-read tests passed");
}

// Plan session multi reads: only the session commitment, explicit or by an absent config, is served; any other config or option reads live.
{
  const a = PublicKey.unique(), b = PublicKey.unique();
  const { live, session } = await multiReadSession("multi-commitment", [[a], [b]], 10);
  const served: unknown[] = [undefined, "confirmed", { commitment: "confirmed" }, { commitment: "confirmed", minContextSlot: 9, dataSlice: undefined }];
  for (const config of served) assert.equal((await session.getMultipleAccountsInfoAndContext([a, b], config as never)).context.slot, 9);
  assert.deepEqual(live, []);
  const unserved: unknown[] = [{ minContextSlot: 9 }, { commitment: undefined }, {}, "finalized", { commitment: "finalized" }, { commitment: "confirmed", encoding: "jsonParsed" }];
  for (const config of unserved) assert.equal((await session.getMultipleAccountsInfoAndContext([a, b], config as never)).context.slot, 10);
  assert.deepEqual(live, [{ minContextSlot: 9 }, { commitment: undefined, minContextSlot: 9 }, { minContextSlot: 9 }, { commitment: "finalized", minContextSlot: 9 },
    { commitment: "finalized", minContextSlot: 9 }, { commitment: "confirmed", encoding: "jsonParsed", minContextSlot: 9 }]);
  console.log("plan session multi-read commitment tests passed");
}

// Plan session multi reads: a supplied Clock that is not an authentic Clock of its slot is never served; the cohort reads it live.
{
  const { getMultipleAccountsInfoAndContextChunked } = await import("../src/chunkedAccounts.js");
  const a = PublicKey.unique(), negative = clockData(9);
  negative.writeBigInt64LE(-1n, 32);
  const authentic = await multiReadSession("multi-clock", [[a], [sysvarClock, clockEntry]]);
  assert.equal((await getMultipleAccountsInfoAndContextChunked(authentic.session, [a, sysvarClock], { commitment: "confirmed" })).context.slot, 9);
  assert.deepEqual(authentic.live, []);
  const forged: Partial<MimirPrefetchedAccount>[] = [{ data: clockData(8) }, { owner: program }, { executable: true }, { data: clockData(9).subarray(0, 39) }, { data: negative }];
  for (const clock of forged) {
    const { live, session } = await multiReadSession("multi-clock", [[a], [sysvarClock, { ...clockEntry, ...clock }]]);
    const cohort = await getMultipleAccountsInfoAndContextChunked(session, [a, sysvarClock], { commitment: "confirmed" });
    assert.equal(cohort.context.slot, 9); assert.deepEqual(cohort.value[1]!.data, clockData(9)); assert.equal(cohort.value[1]!.executable, false);
    assert.deepEqual(live, [{ commitment: "confirmed", minContextSlot: 9 }]);
  }
  console.log("plan session supplied-Clock multi-read tests passed");
}

// A proven exact-instruction vector drift discards the plan/blockhash and rebuilds once; no sends occur here.
{
  const { assessMimirRefresh } = await import("../src/beta/refreshPlanner.js");
  const { MimirBetaStalePreparationError } = await import("../src/beta/errors.js");
  const { getCompiledTransactionMessageDecoder } = await import("@solana/transaction-messages");
  const stale = () => new MimirBetaStalePreparationError({ reason: "source-drift", address: key(), observedSlot: 1n,
    currentSlot: 2n, observedUnixTimestamp: null, currentUnixTimestamp: null });
  for (const scenario of ["recover", "twice", "structural", "consumer", "other-code"] as const) {
    let builds = 0, hashes = 0, diagnoses = 0, simulations = 0;
    const old = key(), fresh = key(), seen: string[] = [];
    const mock = {
      getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: key(), lastValidBlockHeight: BigInt(++hashes) } }) }),
      simulateTransaction: (wire: string) => ({ send: async () => {
        const msg = getCompiledTransactionMessageDecoder().decode(Buffer.from(wire, "base64"));
        seen.push(msg.lifetimeToken);
        if (++simulations > 1 && scenario === "recover") return { value: { err: null, unitsConsumed: 1_000n } };
        const code = scenario === "other-code" ? 99 : 3;
        return { value: { err: { InstructionError: [scenario === "consumer" ? 1 : 0, { Custom: code }] },
          logs: [`Program ${scenario === "consumer" ? consumerProgram : program} invoke [1]`,
            `Program ${scenario === "consumer" ? consumerProgram : program} failed: custom program error: 0x${code.toString(16)}`] } };
      } }),
    };
    const run = assessMimirRefresh({ programId: program, payer, target: { kind: "classic", feedConfig: key() }, consumer: consumer([key()], 1, 100),
      rpc: mock as never, buildRefreshGroup: async (_target, reuse) => {
        builds++;
        if (builds === 2) assert.equal(reuse, undefined, "fresh preparation discards cached inputs");
        return { updates: [], publish: unit([ix(89, [builds === 1 ? old : fresh], 96)], 100_000), check,
          preparationDrift: async (err) => {
            diagnoses++;
            assert.deepEqual((err as { InstructionError: unknown }).InstructionError, [0, { Custom: scenario === "other-code" ? 99 : 3 }]);
            if (scenario === "structural" || scenario === "other-code") throw new Error("hard failure");
            throw stale();
          } };
      } });
    if (scenario === "twice") await assert.rejects(run, MimirBetaStalePreparationError);
    else {
      const result = await run;
      if (scenario === "recover") {
        assert.equal(result.state, "needs-full-refresh");
        if (result.state === "needs-full-refresh" && result.plan.mode === "inline") {
          assert.ok(result.plan.instructions.some((i) => i.accounts.some((a) => a.address === fresh)));
          assert.ok(result.plan.instructions.every((i) => i.accounts.every((a) => a.address !== old)));
        }
      } else assert.equal(result.state, "not-ready");
    }
    assert.equal(builds, scenario === "recover" || scenario === "twice" ? 2 : 1);
    assert.equal(diagnoses, scenario === "consumer" ? 0 : scenario === "twice" ? 2 : 1);
    if (builds === 2) { assert.ok(hashes >= 2); assert.notEqual(seen[0], seen[1], "new message uses fresh blockhash"); }
  }
}
