import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeFeedSnapshotHeader } from "../src/internal/nativeMonoRefreshCore.js";
import { verifyFeedSnapshotAccount } from "../src/account.js";
import { decodeFeedSnapshotHeader as decodeCodecSnapshotHeader, verifySnapshotHeader } from "../src/codec.js";
import * as api from "../src/internal/sampledTemporalCore.js";
import { runSampledTemporalVectorParity } from "./sampledTemporalVectors.mjs";

const checks = runSampledTemporalVectorParity(api, new URL("./fixtures/sampled-temporal", import.meta.url).pathname);
assert.equal(checks, 182);
console.log(`sampled temporal vectors: ${checks} checks`);
{
  const P = 1n << 70n, at = (i: number, priceX64: bigint) => ({ slot: 100n + BigInt(i), unixTs: 1000n + 10n * BigInt(i), priceX64, observationHash: new Uint8Array(32) });
  const wide = Array.from({ length: 16 }, (_, i) => at(i, i < 2 ? P : P / 100n));
  assert.equal(api.projectMimirSampledHistory(wide, at(16, P / 100n)).observedBandBps, 65536n);
  const s = api.summarizeMimirSampledState({ records: wide, close: at(16, P / 100n), sequence: 16n, nextIndex: 0, depthFloor: 1n, bandLimitBps: 100, closeLimitBps: 100 } as any);
  assert.equal(s.observedBandBps, 65536n); assert.equal(s.ready, false);
}
{
  const H = 68056473384187692692674921486353643n, r = (slot: bigint, unixTs: bigint, priceX64: bigint) => ({ slot, unixTs, priceX64, observationHash: new Uint8Array(32) });
  const p = api.projectMimirSampledHistory([r(1000n, 1000n, 2n), r(1010n, 1010n, H)], r(1011n, 1010n, 1n));
  assert.deepEqual([p.meanX64, p.lowerX64, p.upperX64, p.observedBandBps, p.confidenceBps, p.closeDeviationBps],
    [2n, 1n, H + 1n, 65536n, 340282366920938463463374607431768210000n, 5000n]);
}

import { PublicKey } from "@solana/web3.js";
import { address } from "@solana/kit";
import { findOracleRegistryPda, findSourceTemporalPda } from "../src/pda.js";

const pk = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const programId = pk(171), [registry] = findOracleRegistryPda(0, programId), system = new PublicKey(new Uint8Array(32));
const refresh = { feedId: new Uint8Array(32).fill(1), sourceIndex: 2, ringVersion: 1, minSlotGap: 1, expectedSourceConfigRevision: 1n,
  expectedSourceSetRevision: 1n, expectedPrevNewestSlot: 0n, expectedPlanHash: new Uint8Array(32).fill(2) };
const membershipProof = { sourceSetSiblings: [3, 4, 5].map(b => new Uint8Array(32).fill(b)), accountsSiblings: [6, 7, 8].map(b => new Uint8Array(32).fill(b)) };
const [module] = findSourceTemporalPda(refresh.feedId, 2, 4, programId);
const hash = new Uint8Array(32).fill(7), base = { sourceConfig: new Uint8Array(32).fill(2), planHash: new Uint8Array(32).fill(3) };
let state: api.MimirSampledState | null = null;
for (let i = 0; i < 5; i++) state = api.applyMimirSampledObservation(state, { record: { slot: 100n + BigInt(i), unixTs: 1000n + 10n * BigInt(i),
  priceX64: 1n << 64n, observationHash: hash }, observedDepthNative: 10n }, hash, base).state;
assert.deepEqual(api.projectMimirSampledReadiness(state!, 1042n), { status: "warming", acceptedCount: 5, requiredCount: 13, spanSeconds: 40n,
  requiredSpanSeconds: 120n, nextEligibleUnixTs: 1050n, secondsUntilNextEligible: 8n, observationsRemaining: 8, spanSecondsRemaining: 80n,
  depthFloorQuoteNative: 1n });
assert.equal(api.projectMimirSampledReadiness(state!, 1056n).status, "history-reset-required");
const record = api.decodeMimirSampledRecord(api.encodeMimirSampledRecord(state!.close));
assert.deepEqual(record, state!.close);
console.log("sampled temporal builders/readiness ok");

import { RING_OFFSETS } from "../src/constants.js";
import { buildTestSnapshotHeader, buildTestSourceObservationRingHeader, defaultTestSnapshotPolicy } from "../src/fixtures.js";
import { projectMimirMixedBoundedV1 } from "../src/internal/mixedBoundedCore.js";
import { computeRaydiumClmmNativeTwapObservationFingerprint, decodeMimirBrowserSourceRingV1,
  deriveMimirMixedClmmSample } from "../src/internal/nativeMonoRefreshCore.js";


const Q64 = 1n << 64n;
const pointOnlyRing = (adapterType: number, flag = 1) => {
  const data = new Uint8Array(544); data.set(buildTestSourceObservationRingHeader());
  const view = new DataView(data.buffer); view.setUint16(10, 544, true); view.setUint32(12, flag, true);
  view.setUint16(RING_OFFSETS.ringVersion, 1, true); data[RING_OFFSETS.adapterType] = adapterType; data[RING_OFFSETS.observationKind] = 0;
  view.setUint16(RING_OFFSETS.sampleCount, 1, true); view.setUint16(RING_OFFSETS.capacity, 300, true);
  view.setUint16(RING_OFFSETS.head, 0, true); view.setUint16(RING_OFFSETS.minSlotGap, 1, true);
  view.setBigUint64(RING_OFFSETS.oldestSlot, 100n, true); view.setBigUint64(RING_OFFSETS.newestSlot, 100n, true);
  view.setBigUint64(RING_OFFSETS.lastActivitySlot, 100n, true); view.setBigUint64(RING_OFFSETS.cumulativeSlotDelta, 0n, true);
  data.fill(0, RING_OFFSETS.cumulativePriceX64, RING_OFFSETS.cumulativePriceX64 + 16);
  data.fill(0, RING_OFFSETS.lastEconLossFloorNative, RING_OFFSETS.lastFeeRatePpm + 8);
  view.setUint16(RING_OFFSETS.econLossBandBps, 0, true);
  data[RING_OFFSETS.windowFlags] = 1; view.setBigUint64(448, 100n, true);
  view.setBigUint64(RING_OFFSETS.lastActivitySlot, 0n, true); view.setUint16(RING_OFFSETS.lastConfidenceBps, 1, true);
  view.setUint16(RING_OFFSETS.lastSpreadBps, 0, true); data.fill(0, RING_OFFSETS.capModelFlags, 448);
  data[RING_OFFSETS.feeSource] = 2; data[RING_OFFSETS.windowFlags] = 1; view.setUint16(RING_OFFSETS.completedMaxConfidenceBps, 1, true);
  data.fill(0, 456, 544); data.copyWithin(464, RING_OFFSETS.lastPriceX64, RING_OFFSETS.lastPriceX64 + 16);
  data.copyWithin(480, RING_OFFSETS.lastDepthTo50BpsNative, RING_OFFSETS.lastDepthTo50BpsNative + 32);
  return data;
};
assert.equal(decodeMimirBrowserSourceRingV1(pointOnlyRing(4)).pointOnly, true);
assert.equal(decodeMimirBrowserSourceRingV1(pointOnlyRing(6)).pointOnly, true);
for (const [adapterType, flag] of [[2, 1], [4, 0], [4, 2]]) {
  assert.throws(() => decodeMimirBrowserSourceRingV1(pointOnlyRing(adapterType!, flag)), /InvalidSourceRing/, `${adapterType}/${flag}`);
}
const positiveFee = pointOnlyRing(4); new DataView(positiveFee.buffer).setBigUint64(RING_OFFSETS.lastFeeRatePpm, 2500n, true);
assert.equal(decodeMimirBrowserSourceRingV1(positiveFee).lastFeeRatePpm, 2500n);
const band50 = pointOnlyRing(4); new DataView(band50.buffer).setUint16(RING_OFFSETS.econLossBandBps, 50, true);
assert.throws(() => decodeMimirBrowserSourceRingV1(band50), /InvalidSourceRing/);
const economicPointOnly = pointOnlyRing(4); new DataView(economicPointOnly.buffer).setBigUint64(RING_OFFSETS.lastEconLossFloorNative, 1n, true);
assert.throws(() => decodeMimirBrowserSourceRingV1(economicPointOnly), /InvalidSourceRing/);
for (const fixture of JSON.parse(readFileSync(new URL("./fixtures/sampled-temporal/captured_abi.json", import.meta.url), "utf8"))) {
  const ring = Uint8Array.from(Buffer.from(fixture.ring_point_only_hex, "hex"));
  assert.equal(decodeMimirBrowserSourceRingV1(ring).pointOnly, true, fixture.id);
  const ordinary = ring.slice(); ordinary[12] = 0;
  assert.throws(() => decodeMimirBrowserSourceRingV1(ordinary), /InvalidSourceRing/, fixture.id);
  const activity = ring.slice(); new DataView(activity.buffer).setBigUint64(80, 1n, true);
  assert.throws(() => decodeMimirBrowserSourceRingV1(activity), /InvalidSourceRing/, fixture.id);
  const confidence = ring.slice(); new DataView(confidence.buffer).setUint16(104, 2, true);
  assert.throws(() => decodeMimirBrowserSourceRingV1(confidence), /InvalidSourceRing/, fixture.id);
  const completedConfidence = ring.slice(); new DataView(completedConfidence.buffer).setUint16(RING_OFFSETS.completedMaxConfidenceBps, 2, true);
  assert.throws(() => decodeMimirBrowserSourceRingV1(completedConfidence), /InvalidSourceRing/, fixture.id);
}
const authenticated = pointOnlyRing(6); authenticated[RING_OFFSETS.windowFlags] = 3;
assert.throws(() => decodeMimirBrowserSourceRingV1(authenticated), /InvalidSourceRing/);

{
  const now = 2_000_000n, slot = 1000n, ammv4 = api.MIMIR_SAMPLED_SOURCE_ADAPTERS[4];
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const planHash = new Uint8Array(32).fill(9), context = new Uint8Array(32).fill(4), observationHash = new Uint8Array(32).fill(7);
  const mixedProgram = pk(99), feedId = new Uint8Array(32).fill(1);
  let history: api.MimirSampledState | null = null;
  for (let i = 0; i < 14; i++) history = api.applyMimirSampledObservation(history, { record: { slot: 900n + BigInt(i),
    unixTs: now - 150n + 10n * BigInt(i), priceX64: Q64, observationHash }, observedDepthNative: 10n }, context,
    { sourceConfig: pk(10).toBytes(), planHash, sourceDepthFloor: 7n }).state;
  const close = history!.close;
  const feed = { maxConfidenceBps: 10000, maxDispersionBps: 10000, maxSourceActivityAgeSlots: 150, maxSnapshotAgeSlots: 150,
    minSourceCount: 2, minVenueCount: 2, minCorrelationGroupCount: 2 } as any;
  const plan = { planHash, maxSourceActivityAgeSlots: 150, maxDispersionBps: 10000, minSources: 2, minVenues: 2, minCorrelationGroups: 2 } as any;
  const clmmProof = { kind: 1 as const, oraclePubkey: pk(21).toBytes(), latestIndex: 2, oldTimestamp: now - 300n, oldCumulative: 0n,
    latestTimestamp: now - 5n, latestCumulative: 0n, currentTick: 0 };
  const config = (sourceIndex: number, adapterType: number, extra: object = {}) => ({ sourceIndex, adapterType, adapterVersion: 0, feedId,
    maxSourceWeightBps: 10000, routeCorrelationGroup: sourceIndex, venueGroup: sourceIndex, sourceConfigRevision: 1n, sourceSetRevision: 1n,
    poolOrMarket: pk(50 + sourceIndex).toBytes(), ...extra }) as any;
  const clmmConfig = config(1, 1);
  const clmmHash = computeRaydiumClmmNativeTwapObservationFingerprint({ observationState: clmmProof.oraclePubkey, sourceConfig: pk(11).toBytes(),
    pool: clmmConfig.poolOrMarket, selectedPlanHash: planHash, sourceConfigRevision: 1n, sourceSetRevision: 1n, adapterVersion: 0,
    sample: deriveMimirMixedClmmSample(clmmProof, now) });
  const ring = (sourceIndex: number, newestSlot: bigint, windowFlags: number, hash: Uint8Array, extra: object = {}) => ({ sourceIndex,
    newestSlot, completedEndSlot: newestSlot, completedActivitySlot: 0n, windowFlags, lastPriceX64: Q64, completedPriceX64: Q64,
    sourceWeightBps: 10000, routeCorrelationGroup: sourceIndex, sourceConfigRevision: 1n, sourceSetRevision: 1n, selectedPlanHash: planHash,
    lastObservationHash: hash, completedMaxConfidenceBps: 0, completedMinDepthTo50BpsNative: 50n, ...extra }) as any;
  const [modulePda] = findSourceTemporalPda(feedId, 0, 4, mixedProgram);
  const programData = new Uint8Array(45); programData[0] = 3; new DataView(programData.buffer).setBigUint64(4, ammv4.deploymentSlot, true);
  const quiet = { module: { address: modulePda, owner: mixedProgram, executable: false, data: api.encodeMimirSampledTemporalModule(history!) },
    sourceProgram: { address: new PublicKey(ammv4.program), owner: loader, executable: true,
      data: Uint8Array.from([2, 0, 0, 0, ...new PublicKey(ammv4.programData).toBytes()]) },
    sourceProgramData: { address: new PublicKey(ammv4.programData), owner: loader, executable: false, data: programData } };
  const ammRing = ring(0, close.slot, 1, observationHash, { pointOnly: true, completedMinEconLossFloorNative: 0n, completedMinCapitalRequiredFloorNative: 0n });
  const sources = (ammProof: any = { kind: 9 }) => [
    { sourceConfig: pk(10), proof: ammProof, quiet, config: config(0, 4, { programId: new PublicKey(ammv4.program).toBytes(), minDepthTo50BpsNative: 7n }), ring: ammRing },
    { sourceConfig: pk(11), proof: clmmProof, config: clmmConfig,
      ring: ring(1, slot, 3, clmmHash, { completedMinEconLossFloorNative: 1n, completedMinCapitalRequiredFloorNative: 2n }) }];
  const input = { feed, plan, programId: mixedProgram, clock: { slot, unixTs: now }, maxObservationAgeSlots: 150, sources: sources() };
  const projected = projectMimirMixedBoundedV1(input);
  assert.equal(projected.qualifiedMask, 3n);
  assert.deepEqual(projected.supports.map(row => row.kind), [9, 1]);
  assert.deepEqual([projected.priceX64, projected.sampledDepthFloorNative], [Q64, 7n]);
  assert.deepEqual([projected.econLossFloorNative, projected.capitalRequiredFloorNative, projected.attackerWeightBps], [0n, 0n, 0]);
  assert.throws(() => projectMimirMixedBoundedV1({ ...input, sources: sources(clmmProof) }), "point-only ring rejects native proofs");
  assert.equal(api.projectMimirSampledReadiness(history!, now - 20n).status, "ready");
}
console.log("sampled mixed CLMM+AMMv4 / zero-fee readiness ok");

for (const fixture of JSON.parse(readFileSync(new URL("./fixtures/sampled-temporal/captured_abi.json", import.meta.url), "utf8"))) {
  const snapshot = Uint8Array.from(Buffer.from(fixture.source6_snapshot_hex, "hex"));
  assert.equal(decodeFeedSnapshotHeader(snapshot).snapshotSource, 6, fixture.id);
  const economic = snapshot.slice(); economic[440] = 1;
  assert.throws(() => decodeFeedSnapshotHeader(economic), /InvalidSampledSource6Snapshot/, fixture.id);
  const flagged = snapshot.slice(); flagged[12] = 1;
  assert.throws(() => decodeFeedSnapshotHeader(flagged), /InvalidSampledSource6Snapshot/, fixture.id);
  const anchored = snapshot.slice(); anchored[334] = 1;
  assert.throws(() => decodeFeedSnapshotHeader(anchored), /InvalidSampledSource6Snapshot/, fixture.id);
  assert.throws(() => verifyFeedSnapshotAccount({ snapshot: pk(171), owner: pk(171), programId: pk(171), data: snapshot,
    policy: {} as any }), /InvalidSnapshotSource/, fixture.id);
  assert.throws(() => verifySnapshotHeader(decodeFeedSnapshotHeader(snapshot) as any, {} as any), /InvalidSnapshotSource/, fixture.id);
}
{
  const data = buildTestSnapshotHeader((bytes) => {
    bytes[107] = 5; bytes.fill(0, 156, 188); bytes.writeUInt16LE(10000, 255);
    bytes.writeBigUInt64LE(bytes.readBigUInt64LE(116), 140); bytes.writeBigUInt64LE(bytes.readBigUInt64LE(116), 148);
  });
  const policy = { ...defaultTestSnapshotPolicy(), maxSourceActivityAgeSlots: 65535 };
  assert.equal(decodeCodecSnapshotHeader(data).snapshotSource, 5);
  assert.throws(() => verifySnapshotHeader(decodeCodecSnapshotHeader(data), policy), /InvalidSnapshotSource/);
}
console.log("source6 snapshot decodes as predecessor; plain verify rejects it");
