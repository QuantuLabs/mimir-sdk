import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";
import { deriveMimirBetaPda } from "../src/beta/abi.js";
import { sampledModuleSpecs } from "../src/beta/sampledModuleReview.js";
import type { MimirBetaAccount } from "../src/beta/types.js";
import { createMimirBetaReconciliationSemanticHash } from "../src/beta/reconciliation.js";
import { applyMimirSampledObservation, encodeMimirSampledTemporalModule } from "../src/internal/sampledTemporalCore.js";

const key = (byte: number) => getAddressDecoder().decode(new Uint8Array(32).fill(byte));
const programId = key(171), other = key(0), payer = key(90), ringAddress = key(91);
const feedId = new Uint8Array(32).fill(1);
const rent = 9_799_680n;
const rentData = new Uint8Array(17); new DataView(rentData.buffer).setBigUint64(0, 6_960n, true); new DataView(rentData.buffer).setFloat64(8, 1, true);
const rpc = { getAccountInfo: (address: Address) => ({ send: async () => (assert.equal(address, "SysvarRent111111111111111111111111111111111"),
  { context: { slot: 1n }, value: { data: [Buffer.from(rentData).toString("base64"), "base64"] } }) }) } as never;
const [moduleAddress] = await deriveMimirBetaPda({ programId, seed: "source_temporal", values: [feedId, Uint8Array.of(2), Uint8Array.of(4, 0)] });

const record = (slot: bigint, unixTs: bigint) => ({ slot, unixTs, priceX64: 1n << 64n, observationHash: new Uint8Array(32).fill(7) });
const options = { sourceConfig: new Uint8Array(32).fill(3), planHash: new Uint8Array(32).fill(4) };
const first = applyMimirSampledObservation(null, { record: record(100n, 1_000n), observedDepthNative: 10n }, new Uint8Array(32).fill(5), options).state;
const second = applyMimirSampledObservation(first, { record: record(200n, 1_012n), observedDepthNative: 10n }, new Uint8Array(32).fill(5), options).state;
const ring = (slot: bigint) => {
  const data = new Uint8Array(544); data.set(new TextEncoder().encode("MIMIRRNG")); data.set(feedId, 16); data[48] = 2;
  new DataView(data.buffer).setBigUint64(64, slot, true); data.set(new Uint8Array(16).fill(0), 88);
  new DataView(data.buffer).setBigUint64(88, 0n, true); new DataView(data.buffer).setBigUint64(96, 1n, true);
  new DataView(data.buffer).setBigUint64(112, 10n, true); data.set(new Uint8Array(32).fill(7), 184); data.set(new Uint8Array(32).fill(8), 280);
  return { address: ringAddress, owner: programId, executable: false, lamports: 1n, data } satisfies MimirBetaAccount;
};
const [feedAddress] = await deriveMimirBetaPda({ programId, seed: "feed_config", values: [feedId] });
const planAddress = key(95);
const feedAccount = (maxConfidenceBps = 10_000) => {
  const data = new Uint8Array(357), view = new DataView(data.buffer);
  view.setUint16(126, maxConfidenceBps, true); view.setUint16(128, 10_000, true); data.set(getAddressEncoder().encode(planAddress), 168);
  return { address: feedAddress, owner: programId, executable: false, lamports: 1n, data } satisfies MimirBetaAccount;
};
const planAccount = (() => {
  const data = new Uint8Array(320); new DataView(data.buffer).setUint16(58, 10_000, true); data.set(new Uint8Array(32).fill(8), 196);
  return { address: planAddress, owner: programId, executable: false, lamports: 1n, data } satisfies MimirBetaAccount;
})();
const module = (data: Uint8Array, lamports = rent, owner = programId, at = moduleAddress) =>
  ({ address: at, owner, executable: false, lamports, data }) satisfies MimirBetaAccount;
const payerAccount = (lamports: bigint) => ({ address: payer, owner: other, executable: false, lamports, data: new Uint8Array() });

const run = (pre: MimirBetaAccount | null, post: MimirBetaAccount | null, slot: bigint, at: Address = moduleAddress,
  payerPost = 1_000_000_000n - rent - 5_000n, feed = feedAccount(), preSlot = slot) => sampledModuleSpecs({ specified: [ringAddress],
  addresses: [payer, ringAddress, at, feedAddress, planAddress], writableAddresses: [payer, ringAddress, at],
  before: [payerAccount(1_000_000_000n), ring(preSlot), pre, feed, planAccount],
  after: [payerAccount(payerPost), ring(slot), post, feed, planAccount], payer, programId, rpc });

const created = encodeMimirSampledTemporalModule(first);
assert.deepEqual((await run(null, module(created), 100n)).map((spec) => [spec.transition, spec.dataLengthAfter]), [["create", 1280]]);
await assert.rejects(run(null, module(new Uint8Array(1279)), 100n), /ABI/);
await assert.rejects(run(null, module(created, rent, other), 100n), /ABI/);
await assert.rejects(run(null, module(created, rent - 1n), 100n), /rent/);
await assert.rejects(run(null, module(created), 100n, moduleAddress, 1_000_000_000n - 5_000n), /payer/);
assert.deepEqual(await run(null, module(created, rent, programId, key(92)), 100n, key(92)), []);
const advanced = encodeMimirSampledTemporalModule(second);
assert.deepEqual((await run(module(created), module(advanced), 200n)).map((spec) => spec.transition), ["write"]);
await assert.rejects(run(module(created), module(advanced, rent + 1n), 200n), /data-only/);
const corrupt = Uint8Array.from(advanced); corrupt[0] = 0;
await assert.rejects(run(module(created), module(corrupt), 200n), /codec/);
assert.deepEqual(await sampledModuleSpecs({ specified: [], addresses: [payer], writableAddresses: [payer],
  before: [payerAccount(1n)], after: [payerAccount(1n)], payer, programId, rpc }), []);
const evidence = (pre: Uint8Array | null, preSlot: bigint | null, bandLimitBps = 100, closeLimitBps = 50) => ({ ring: ringAddress,
  preModuleHex: pre === null ? null : Buffer.from(pre).toString("hex"), preRingHex: preSlot === null ? null : Buffer.from(ring(preSlot).data).toString("hex"),
  bandLimitBps, closeLimitBps });
const [advancedSpec] = await run(module(created), module(advanced), 200n, moduleAddress, undefined, feedAccount(), 100n);
assert.deepEqual(advancedSpec!.sampledTransition, evidence(created, 100n));
const hash = (data: Uint8Array, transactionSlot: bigint, blockTime: bigint | null, accountContextSlot = transactionSlot,
  sampledTransition = evidence(created, 100n), ringSlot = transactionSlot) =>
  createMimirBetaReconciliationSemanticHash({ codec: "sampled-temporal-v4", address: moduleAddress, account: module(data), transactionSlot,
    accountContextSlot, blockTime, sampledTransition, sampledRing: ring(ringSlot) });
const landed = applyMimirSampledObservation(first, { record: record(230n, 1_013n), observedDepthNative: 10n }, new Uint8Array(32).fill(5), options).state;
const simulatedHash = await hash(advanced, 200n, null);
assert.equal(await hash(encodeMimirSampledTemporalModule(landed), 230n, 1_013n, 240n), simulatedHash);
await assert.rejects(hash(encodeMimirSampledTemporalModule(landed), 230n, 1_014n), /finalized transaction/);
await assert.rejects(hash(encodeMimirSampledTemporalModule(landed), 231n, 1_013n), /finalized transaction/);
await assert.rejects(createMimirBetaReconciliationSemanticHash({ codec: "sampled-temporal-v4", address: moduleAddress,
  account: module(advanced), transactionSlot: 200n, blockTime: null }), /evidence/);
const forgedClosure = encodeMimirSampledTemporalModule({ ...first, sequence: 2n, close: record(230n, 1_013n) });
const forgedSequence = encodeMimirSampledTemporalModule({ ...landed, sequence: 42n });
const badDigest = encodeMimirSampledTemporalModule(landed); badDigest[224] ^= 1;
for (const forged of [forgedClosure, forgedSequence, badDigest]) await assert.rejects(hash(forged, 230n, 1_013n), /replay/);
await assert.rejects(hash(encodeMimirSampledTemporalModule(landed), 230n, 1_013n, 230n, evidence(advanced, 200n)), /replay|CLOCK|MIN_SLOT/);
const createdHash = await hash(created, 100n, null, 100n, evidence(null, null));
assert.equal(await hash(encodeMimirSampledTemporalModule(applyMimirSampledObservation(null,
  { record: record(130n, 1_007n), observedDepthNative: 10n }, new Uint8Array(32).fill(5), options).state), 130n, 1_007n, 130n, evidence(null, null)), createdHash);
let full: ReturnType<typeof applyMimirSampledObservation>["state"] | null = null;
for (let i = 0; i < 16; i++) full = applyMimirSampledObservation(full, { record: record(100n + BigInt(i * 10), 1_002n + BigInt(i * 10)), observedDepthNative: 10n },
  new Uint8Array(32).fill(5), options).state;
const fullBytes = encodeMimirSampledTemporalModule(full!);
const step = (slot: bigint, unixTs: bigint) => applyMimirSampledObservation(full, { record: record(slot, unixTs), observedDepthNative: 10n }, new Uint8Array(32).fill(5), options);
const closure = step(300n, 1_159n), eviction = step(330n, 1_160n);
assert.equal(closure.action, "CLOSURE"); assert.equal(eviction.action, "ACCEPT");
assert.equal(await hash(encodeMimirSampledTemporalModule(eviction.state), 330n, 1_160n, 330n, evidence(fullBytes, 250n)),
  await hash(encodeMimirSampledTemporalModule(closure.state), 300n, null, 300n, evidence(fullBytes, 250n)));
let tight: ReturnType<typeof applyMimirSampledObservation>["state"] | null = null;
for (let i = 0; i < 16; i++) {
  const point = record(100n + BigInt(i * 10), 1_000n + BigInt(i * 10)); if (i === 0) point.priceX64 += point.priceX64 * 90n / 10_000n;
  tight = applyMimirSampledObservation(tight, { record: point, observedDepthNative: 10n }, new Uint8Array(32).fill(5),
    { ...options, bandLimitBps: 80, closeLimitBps: 50 }).state;
}
const tightBytes = encodeMimirSampledTemporalModule(tight!); assert.equal(tightBytes[18], 1);
const tightRun = (feed: MimirBetaAccount) => sampledModuleSpecs({ specified: [ringAddress], addresses: [payer, ringAddress, moduleAddress, feedAddress, planAddress],
  writableAddresses: [payer, ringAddress, moduleAddress], before: [payerAccount(1n), ring(250n), module(tightBytes), feed, planAccount],
  after: [payerAccount(1n), ring(250n),
    module(tightBytes), feed, planAccount], payer, programId, rpc });
assert.equal((await tightRun(feedAccount(80)))[0]!.sampledTransition.bandLimitBps, 80);
await assert.rejects(tightRun(feedAccount()), /codec/);
for (const fixture of JSON.parse(readFileSync(new URL("./fixtures/sampled-temporal/captured_abi.json", import.meta.url), "utf8"))) {
  const pointOnly = Uint8Array.from(Buffer.from(fixture.ring_point_only_hex, "hex"));
  await createMimirBetaReconciliationSemanticHash({ codec: "source-ring-v1", address: ringAddress, account: { ...ring(0n), data: pointOnly },
    transactionSlot: new DataView(pointOnly.buffer).getBigUint64(64, true), blockTime: null });
}
console.log("sampled module review: ok");
