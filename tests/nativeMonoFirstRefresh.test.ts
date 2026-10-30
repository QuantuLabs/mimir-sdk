import assert from "node:assert/strict";
import fs from "node:fs";
import type { Address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { addressBytes } from "../src/beta/bytes.js";
import { buildTestFeedTwapStateHeader, buildTestSnapshotHeader } from "../src/fixtures.js";
import { findFeedTwapPda } from "../src/pda.js";
import { CPMM_QUIET_TEMPORAL_MODULE_V2 } from "../src/constants.js";
import {
  decodeFeedSnapshotHeader, decodeFeedTwapStateHeader, decodeLifecycleFeedConfigHeader,
  decodeLifecycleFeedSnapshotSentinel, decodeLifecycleFeedTwapSentinel,
  decodeMimirBrowserSourceRingV1Sentinel, decodeSourceConfigHeader, decodeSourcingPlanHeader,
  readMimirMonoPreviousRevisions, decodeMimirBrowserCpmmQuietTemporalModuleV2,
} from "../src/internal/nativeMonoRefreshCore.js";

const fixture = JSON.parse(fs.readFileSync(
  new URL("./fixtures/nativeMonoFirstRefreshPreviousAccounts.json", import.meta.url),
  "utf8",
)) as { keys: Address[]; accounts: string[] };
const account = (index: number) => {
  const decoded = Buffer.from(fixture.accounts[index]!, "base64");
  const offset = new Uint8Array(decoded.length + 2);
  offset.set(decoded, 1);
  return offset.subarray(1, -1);
};
const feed = decodeLifecycleFeedConfigHeader(account(0));
const plan = decodeSourcingPlanHeader(account(3));
const source = decodeSourceConfigHeader(account(4));
const snapshot = account(1), twap = account(2), ring = account(5);

assert.deepEqual(readMimirMonoPreviousRevisions(snapshot, twap), { snapshotRevision: 0n, twapRevision: 0n });
assert.throws(() => decodeFeedSnapshotHeader(snapshot), /InvalidSnapshot/);
const snapshotExpected = { feedId: feed.feedId, feedConfig: addressBytes(fixture.keys[0]!), registryEpoch: feed.registryEpoch,
  riskTier: feed.riskTier, planProfile: plan.profile, priceExponent: feed.priceExponent, sourcingPlanId: plan.planId,
  sourcingPlanVersion: plan.planVersion, sourcingPlanHash: plan.planHash, anchorPolicyHash: feed.anchorPolicyHash,
  nativeExceptionHash: feed.nativeExceptionHash };
const twapExpected = { feedId: feed.feedId, twapVersion: 0, selectedPlanHash: plan.planHash, bump: twap[272]! };
const ringExpected = { feedId: feed.feedId, sourceIndex: source.sourceIndex, adapterType: source.adapterType,
  sourceConfigRevision: source.sourceConfigRevision, sourceSetRevision: source.sourceSetRevision,
  sourceConfig: addressBytes(fixture.keys[4]!), poolOrMarket: source.poolOrMarket, selectedPlanHash: plan.planHash,
  bump: ring[312]!, sourceWeightBps: source.maxSourceWeightBps, routeCorrelationGroup: source.routeCorrelationGroup };
assert.equal(decodeLifecycleFeedSnapshotSentinel(snapshot, snapshotExpected).snapshotRevision, 0n);
assert.equal(decodeLifecycleFeedTwapSentinel(twap, twapExpected).revision, 0n);
assert.equal(decodeMimirBrowserSourceRingV1Sentinel(ring, ringExpected).status, 2);

const wrongBinding = Uint8Array.from(snapshot); wrongBinding[48] ^= 1;
assert.throws(() => decodeLifecycleFeedSnapshotSentinel(wrongBinding, snapshotExpected), /InvalidLifecycleSnapshotSentinel/);
const mixedRevision = Uint8Array.from(twap); new DataView(mixedRevision.buffer).setBigUint64(256, 1n, true);
assert.throws(() => decodeLifecycleFeedTwapSentinel(mixedRevision, twapExpected), /InvalidLifecycleTwapSentinel/);
const malformedRing = Uint8Array.from(ring); malformedRing[382] = 1;
assert.throws(() => decodeMimirBrowserSourceRingV1Sentinel(malformedRing, ringExpected), /InvalidSourceRing/);
const economicRing = Uint8Array.from(ring); economicRing[384] = 1;
assert.throws(() => decodeMimirBrowserSourceRingV1Sentinel(economicRing, ringExpected), /InvalidSourceRing/);

decodeFeedSnapshotHeader(buildTestSnapshotHeader());
decodeFeedTwapStateHeader(buildTestFeedTwapStateHeader());
assert.throws(() => decodeFeedSnapshotHeader(buildTestSnapshotHeader((data) => { data[252] = 0; })), /InvalidSnapshot/);

const mixedCapture = JSON.parse(fs.readFileSync(
  new URL("./fixtures/nativeMonoMixedSentinelPrestate.json", import.meta.url), "utf8",
)) as { source: string; accounts: Array<{ address: Address; owner: Address; executable: boolean; data: string }> };
assert.match(mixedCapture.source, /prestate only, not runtime simulation/);
const capturedData = (index: number) => Uint8Array.from(Buffer.from(mixedCapture.accounts[index]!.data, "base64"));
const capturedFeed = decodeLifecycleFeedConfigHeader(capturedData(0));
const capturedSnapshot = decodeFeedSnapshotHeader(capturedData(1));
const capturedPlan = decodeSourcingPlanHeader(capturedData(2));
const capturedTwap = capturedData(3);
const capturedTwapVersion = new DataView(capturedTwap.buffer, capturedTwap.byteOffset).getUint16(48, true);
const [capturedTwapPda, capturedTwapBump] = findFeedTwapPda(capturedFeed.feedId, capturedTwapVersion,
  new PublicKey(mixedCapture.accounts[3]!.owner));
assert.equal(capturedSnapshot.snapshotRevision, 1n);
assert.equal(new DataView(capturedTwap.buffer, capturedTwap.byteOffset).getBigUint64(256, true), 0n);
assert.equal(capturedTwapPda.toBase58(), mixedCapture.accounts[3]!.address);
assert.equal(decodeLifecycleFeedTwapSentinel(capturedTwap, {
  feedId: capturedFeed.feedId,
  twapVersion: capturedTwapVersion,
  selectedPlanHash: capturedPlan.planHash,
  bump: capturedTwapBump,
}).revision, 0n);
assert.ok(mixedCapture.accounts.every((entry) => !entry.executable && entry.owner === mixedCapture.accounts[0]!.owner));
const capturedMalformed = Uint8Array.from(capturedTwap); capturedMalformed[384] = 1;
assert.throws(() => decodeLifecycleFeedTwapSentinel(capturedMalformed, {
  feedId: capturedFeed.feedId, twapVersion: 0, selectedPlanHash: capturedPlan.planHash, bump: capturedTwapBump,
}), /InvalidLifecycleTwapSentinel/);

const quietAnchorModule = (endUnixTs: bigint, qualified: boolean) => {
  const data = Buffer.alloc(CPMM_QUIET_TEMPORAL_MODULE_V2.headerLen);
  data.set(Buffer.from("MTP2")); data.writeUInt16LE(2, 4); data.writeUInt16LE(data.length, 6);
  data.writeBigUInt64LE(900n, 8); data.writeUInt16LE(2, 16);
  data.writeUInt16LE(qualified ? 7 : endUnixTs === 1_000n ? 1 : 3, 18);
  data.fill(1, 24, 56); data.writeBigInt64LE(endUnixTs, 56);
  const anchor = (offset: number, slot: bigint, unixTs: bigint) => {
    data.writeBigUInt64LE(slot, offset); data.writeBigInt64LE(unixTs, offset + 8);
    data.writeBigUInt64LE(999n, offset + 16);
    for (const valueOffset of [24, 32, 40]) data.writeBigUInt64LE(100n, offset + valueOffset);
  };
  anchor(64, 800n, 1_000n);
  if (endUnixTs !== 1_000n) anchor(112, 801n, endUnixTs);
  if (qualified) {
    data.writeBigUInt64LE(0n, 160); data.writeBigUInt64LE(1n, 168);
    data.writeBigUInt64LE(0n, 176); data.writeBigUInt64LE(1n, 184);
  }
  return data;
};
const quietRing = { newestSlot: 900n } as any;
const firstQuietAnchor = decodeMimirBrowserCpmmQuietTemporalModuleV2(quietAnchorModule(1_000n, false), quietRing);
assert.equal(firstQuietAnchor.anchorA.unixTs, 1_000n);
assert.equal(firstQuietAnchor.anchorB, null);
const quietAt119 = decodeMimirBrowserCpmmQuietTemporalModuleV2(quietAnchorModule(1_119n, false), quietRing);
assert.equal(120n - (1_119n - quietAt119.anchorA.unixTs), 1n);
const quietAt120 = decodeMimirBrowserCpmmQuietTemporalModuleV2(quietAnchorModule(1_120n, true), quietRing);
assert.ok(quietAt120.anchorB!.unixTs - quietAt120.anchorA.unixTs >= CPMM_QUIET_TEMPORAL_MODULE_V2.requiredSecs);
assert.equal(quietAt120.qLowerX64, 1n << 64n);
