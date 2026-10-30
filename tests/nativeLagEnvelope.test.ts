import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { decodeFeedConfigHeader, decodeSourceConfigHeader } from "../src/codec.js";
import { buildTestFeedConfigHeader, buildTestMeteoraDlmmSourceConfigHeader, buildTestRaydiumClmmSourceConfigHeader,
  toTestFeedConfigV1 } from "../src/fixtures.js";
import { SourceDirection } from "../src/sourceDirection.js";
import { projectMimirMixedBoundedV1 } from "../src/internal/mixedBoundedCore.js";
import { computeMeteoraDlmmNativeTwapPriceX64, computeMeteoraDlmmNativeTwapQuality, computeRaydiumClmmNativeTwapObservationFingerprint,
  computeRaydiumClmmNativeTwapPriceX64, computeRaydiumClmmNativeTwapQuality, deriveMimirMixedClmmSample, dlmmMonoFingerprint,
  mimirNativeLagEnvelope, mimirNativeLagEnvelopeFingerprint } from "../src/internal/nativeMonoRefreshCore.js";

const Q64 = 1n << 64n, M = 1_000_000n;
const env = (S: bigint, r0: number, C: number, mean = M) => mimirNativeLagEnvelope(mean, S, r0, C);

// Rule: unchanged at d <= 50 or S inside [L0,U0]; otherwise the exact ceil enclosure, refused above C.
assert.equal(env(1_005_000n, 5, 100), null); // d = 50
assert.deepEqual(env(1_005_100n, 5, 100), { spotX64: 1_005_100n, confidenceBps: 51, lowerX64: 999_500n, upperX64: 1_005_100n }); // d = 51
assert.deepEqual(env(994_900n, 5, 100), { spotX64: 994_900n, confidenceBps: 51, lowerX64: 994_900n, upperX64: 1_000_500n }); // S < M
assert.throws(() => env(1_005_100n, 5, 50), /DispersionTooWide/); // c = C + 1
assert.equal(env(1_005_101n, 5, 52)?.confidenceBps, 52); // c = C, w = 5101 rounds up
assert.equal(env(1_008_000n, 100, 100), null); // wide bin: d = 80 but S inside [L0,U0]
assert.throws(() => env(1_030_000n, 5, 100), /DispersionTooWide/); // 300 bps, C = 100
assert.throws(() => env(1_100_000n, 5, 100), /DispersionTooWide/); // 1000 bps, C = 100
assert.throws(() => mimirNativeLagEnvelope(0n, M, 5, 100), /InvalidTwapState/);
// Rounding: c is ceil(10000*w/M) from the exact enclosure, never the floored deviation.
assert.equal(env(1_007_001n, 5, 100)?.confidenceBps, 71); // floor d = 70, w = 7001
assert.equal(env(1_007_000n, 5, 100)?.confidenceBps, 70);

// CONTRACT.md vectors (Rust native_lag_envelope_rule_vectors): [name, M, S, r0, C, d, null | "refused" | [c, L, U]].
for (const [name, mean, spot, r0, C, d, expected] of [
  ["clmm d=50", 11258999068426240000n, 11315294063768371200n, 5, 100, 50n, null],
  ["clmm d=51", 11258999068426240000n, 11316419963675213824n, 5, 100, 51n, [51, 11253369568892026880n, 11316419963675213824n]],
  ["clmm 70 S>M C=100", 11258999068426240000n, 11337812061905223680n, 5, 100, 70n, [70, 11253369568892026880n, 11337812061905223680n]],
  ["clmm 70 S<M C=100", 11258999068426240000n, 11180186074947256320n, 5, 100, 70n, [70, 11180186074947256320n, 11264628567960453120n]],
  ["clmm 71 c=C", 11258999068426240000n, 11338937961812066304n, 5, 71, 71n, [71, 11253369568892026880n, 11338937961812066304n]],
  ["clmm 71 c=C+1", 11258999068426240000n, 11338937961812066304n, 5, 70, 71n, "refused"],
  ["clmm 70 C=50", 11258999068426240000n, 11337812061905223680n, 5, 50, 70n, "refused"],
  ["clmm 300 C=100", 11258999068426240000n, 11596769040479027200n, 5, 100, 300n, "refused"],
  ["clmm 1000 C=100", 11258999068426240000n, 10133099161583616000n, 5, 100, 1000n, "refused"],
  ["clmm 26/09 tick0->tick100 C=100", 18446744073709551616n, 18632127618364106059n, 5, 100, 100n, "refused"],
  ["clmm 26/09 tick0->tick100 C=101", 18446744073709551616n, 18632127618364106059n, 5, 101, 100n, [101, 18437520701672696840n, 18632127618364106059n]],
  ["dlmm wide bin 100 S in [L0,U0]", 11258999068426240000n, 11349071060973649920n, 100, 100, 80n, null],
  ["dlmm wide bin 100 S beyond U0", 11258999068426240000n, 11427884054452633600n, 100, 200, 150n, [150, 11146409077741977600n, 11427884054452633600n]],
  ["dlmm bin1 263 C=100", 11258999068426240000n, 10962887392926629888n, 1, 100, 263n, "refused"],
  ["dlmm bin1 263 C=300", 11258999068426240000n, 10962887392926629888n, 1, 300, 263n, [263, 10962887392926629888n, 11260124968333082624n]],
  ["dlmm bin1 d=50", 11258999068426240000n, 11202704073084108800n, 1, 300, 50n, null],
] as const) {
  assert.equal((spot > mean ? spot - mean : mean - spot) * 10_000n / mean, d, name);
  if (expected === "refused") { assert.throws(() => mimirNativeLagEnvelope(mean, spot, r0, C), /DispersionTooWide/, name); continue; }
  const got = mimirNativeLagEnvelope(mean, spot, r0, C);
  assert.deepEqual(got && [got.confidenceBps, got.lowerX64, got.upperX64], expected, name);
}

// Fingerprint extension: sha256(fp || domain || S u128 LE || c u16 LE); null is the identity.
const fp = new Uint8Array(32).fill(7), S = (1n << 100n) + 3n;
const tail = Buffer.alloc(18); tail.writeBigUInt64LE(S & ((1n << 64n) - 1n), 0); tail.writeBigUInt64LE(S >> 64n, 8); tail.writeUInt16LE(71, 16);
assert.deepEqual(Buffer.from(mimirNativeLagEnvelopeFingerprint(fp, { spotX64: S, confidenceBps: 71 })),
  createHash("sha256").update(fp).update("MIMIR_NATIVE_LAG_ENVELOPE_V1").update(tail).digest());
assert.equal(mimirNativeLagEnvelopeFingerprint(fp, null), fp);
assert.notDeepEqual(mimirNativeLagEnvelopeFingerprint(fp, { spotX64: S + 1n, confidenceBps: 71 }),
  mimirNativeLagEnvelopeFingerprint(fp, { spotX64: S, confidenceBps: 71 })); // changed S, same c

// Applied before the Token-2022 wrap, in both families.
const addr = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const dlmmArgs = [addr(1).toBase58() as any, addr(2).toBase58() as any, addr(3).toBase58() as any, new Uint8Array(32).fill(4), 10n, 300n, 5n, 9n] as const;
const binding = { mintAddress: new Uint8Array(32).fill(5), selectedBase: true, selectedMultiplierQ64: Q64 };
const lag = { spotX64: S, confidenceBps: 71 };
const plainDlmm = dlmmMonoFingerprint(...dlmmArgs);
const t22Dlmm = (inner: Uint8Array) => {
  const multiplier = Buffer.alloc(16); multiplier.writeBigUInt64LE(Q64 & ((1n << 64n) - 1n), 0); multiplier.writeBigUInt64LE(Q64 >> 64n, 8);
  return createHash("sha256").update("MIMIR_METEORA_DLMM_NATIVE_TOKEN2022_ECONOMIC_V1").update(inner).update(binding.mintAddress)
    .update(Uint8Array.of(1)).update(multiplier).digest();
};
assert.deepEqual(Buffer.from(dlmmMonoFingerprint(...dlmmArgs, binding, lag)),
  t22Dlmm(mimirNativeLagEnvelopeFingerprint(plainDlmm, lag)));
assert.deepEqual(dlmmMonoFingerprint(...dlmmArgs, undefined, null), plainDlmm);

// CLMM end to end: tick-0 mean (= Q64 raw) against a ~70 bps sqrt spot.
const feed = (C: number) => ({ ...decodeFeedConfigHeader(toTestFeedConfigV1(buildTestFeedConfigHeader())), maxConfidenceBps: C });
const clmmSource = (direction: number = SourceDirection.QuotePerBase) =>
  ({ ...decodeSourceConfigHeader(buildTestRaydiumClmmSourceConfigHeader()), direction });
const isqrt = (n: bigint) => { let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; };
const clmmPool = (ratioBps: bigint) => {
  const source = clmmSource(), data = new Uint8Array(1_544), view = new DataView(data.buffer);
  data.set([247, 237, 227, 245, 215, 195, 222, 70]);
  data.set(source.baseMint, 73); data.set(source.quoteMint, 105); data.set(source.baseVault, 137); data.set(source.quoteVault, 169);
  data[233] = 9; data[234] = 6;
  const sqrt = isqrt((1n << 128n) * ratioBps / 10_000n);
  view.setBigUint64(253, sqrt & ((1n << 64n) - 1n), true); view.setBigUint64(261, sqrt >> 64n, true);
  return data;
};
const clmmSample = { oldTimestamp: 1_000n, oldCumulativeTick: 0n, latestIndex: 1, latestTimestamp: 1_120n, latestCumulativeTick: 0n,
  currentTick: 0, nowTimestamp: 1_120n, derivedBranch: 0 as const, endTimestamp: 1_120n, endCumulativeTick: 0n, delta: 0n, span: 120n };
const clmm = (ratioBps: bigint, C: number, direction: number = SourceDirection.QuotePerBase) => computeRaydiumClmmNativeTwapQuality({
  poolStateData: clmmPool(ratioBps), sourceConfig: clmmSource(direction), feedConfig: feed(C), sample: clmmSample });
const healthy = clmm(10_040n, 100);
assert.deepEqual([healthy.envelope, healthy.confidenceBps], [null, 5]);
const lagged = clmm(10_070n, 100);
assert.ok(lagged.envelope && lagged.priceX64 === healthy.priceX64 && lagged.confidenceBps >= 69 && lagged.confidenceBps <= 72 &&
  lagged.envelope.lowerX64 <= lagged.priceX64 && lagged.envelope.upperX64 === lagged.spotX64);
assert.equal(computeRaydiumClmmNativeTwapPriceX64({ poolStateData: clmmPool(10_070n), sourceConfig: clmmSource(), feedConfig: feed(100),
  sample: clmmSample }), lagged.priceX64);
assert.throws(() => clmm(10_070n, 50), /RaydiumClmmNativeSpotDeviationTooWide/);
assert.throws(() => clmm(10_300n, 100), /RaydiumClmmNativeSpotDeviationTooWide/);
assert.throws(() => clmm(11_000n, 100), /RaydiumClmmNativeSpotDeviationTooWide/);
const inverse = clmm(10_070n, 100, SourceDirection.BasePerQuote);
assert.ok(inverse.envelope && inverse.envelope.lowerX64 === inverse.spotX64 && inverse.spotX64 < inverse.priceX64);

// DLMM end to end: bin-step-1 mean at bin 0 against active bin 263 (~263 bps): refused at C=100, enveloped at C=300.
const dlmmSource = decodeSourceConfigHeader(buildTestMeteoraDlmmSourceConfigHeader());
const dlmmPool = (active: number, step: number) => {
  const data = new Uint8Array(904), view = new DataView(data.buffer);
  data.set([33, 11, 49, 98, 181, 101, 177, 13]); view.setInt32(76, active, true); view.setUint16(80, step, true);
  data.set(dlmmSource.baseMint, 88); data.set(dlmmSource.quoteMint, 120); data.set(dlmmSource.baseVault, 152); data.set(dlmmSource.quoteVault, 184);
  return data;
};
const dlmmSample = { oldTimestamp: 1_000n, newTimestamp: 1_240n, oldCumulativeBin: 0n, newCumulativeBin: 0n };
const dlmm = (active: number, step: number, C: number) => computeMeteoraDlmmNativeTwapQuality({ poolStateData: dlmmPool(active, step),
  sourceConfig: dlmmSource, feedConfig: feed(C), sample: dlmmSample });
assert.throws(() => dlmm(263, 1, 100), /DispersionTooWide/);
const dlmmLag = dlmm(263, 1, 300);
assert.ok(dlmmLag.envelope && dlmmLag.confidenceBps > 263 && dlmmLag.confidenceBps <= 300 && dlmmLag.envelope.upperX64 === dlmmLag.spotX64);
assert.deepEqual([dlmm(0, 1, 100).envelope, dlmm(0, 1, 100).confidenceBps], [null, 1]);
assert.deepEqual([dlmm(1, 100, 100).envelope, dlmm(1, 100, 100).confidenceBps], [null, 100]); // wide bin: 100 bps, S on U0
assert.equal(computeMeteoraDlmmNativeTwapPriceX64({ poolStateData: dlmmPool(263, 1), sourceConfig: dlmmSource, feedConfig: feed(300),
  sample: dlmmSample }), dlmmLag.priceX64);

// Mixed opener: an envelope ring reopens the extended hash with the re-read S and widens to (L,U); substitutions fail.
{
  const now = 2_000_000n, slot = 1_000n, planHash = new Uint8Array(32).fill(9), feedId = new Uint8Array(32).fill(1);
  const proof = { kind: 1 as const, oraclePubkey: addr(21).toBytes(), latestIndex: 2, oldTimestamp: now - 300n, oldCumulative: 0n,
    latestTimestamp: now - 5n, latestCumulative: 0n, currentTick: 0 };
  const config = { sourceIndex: 0, adapterType: 1, adapterVersion: 0, feedId, maxSourceWeightBps: 10000, routeCorrelationGroup: 0,
    venueGroup: 0, sourceConfigRevision: 1n, sourceSetRevision: 1n, poolOrMarket: addr(50).toBytes() } as any;
  const spot = Q64 * 10_070n / 10_000n, envelope = mimirNativeLagEnvelope(Q64, spot, 5, 100)!;
  const hash = (lagEnvelope: typeof envelope | null) => computeRaydiumClmmNativeTwapObservationFingerprint({ observationState: proof.oraclePubkey,
    sourceConfig: addr(11).toBytes(), pool: config.poolOrMarket, selectedPlanHash: planHash, sourceConfigRevision: 1n, sourceSetRevision: 1n,
    adapterVersion: 0, sample: deriveMimirMixedClmmSample(proof, now), lagEnvelope });
  const ring = (lastObservationHash: Uint8Array) => ({ sourceIndex: 0, newestSlot: slot, completedEndSlot: slot, completedActivitySlot: 0n,
    windowFlags: 3, lastPriceX64: Q64, completedPriceX64: Q64, sourceWeightBps: 10000, routeCorrelationGroup: 0, sourceConfigRevision: 1n,
    sourceSetRevision: 1n, selectedPlanHash: planHash, lastObservationHash, completedMaxConfidenceBps: 0,
    completedMinEconLossFloorNative: 1n, completedMinCapitalRequiredFloorNative: 2n }) as any;
  const project = (C: number, h: Uint8Array, opening: object) => projectMimirMixedBoundedV1({
    feed: { maxConfidenceBps: C, maxDispersionBps: 10000, maxSourceActivityAgeSlots: 150, maxSnapshotAgeSlots: 150, minSourceCount: 1,
      minVenueCount: 1, minCorrelationGroupCount: 1 } as any,
    plan: { planHash, maxSourceActivityAgeSlots: 150, maxDispersionBps: 10000, minSources: 1, minVenues: 1, minCorrelationGroups: 1 } as any,
    programId: addr(99), clock: { slot, unixTs: now }, maxObservationAgeSlots: 150,
    sources: [{ sourceConfig: addr(11), config, ring: ring(h), proof: { ...proof, ...opening } as any }] });
  const opened = project(100, hash(envelope), { lagEnvelope: { spotX64: spot, baseConfidenceBps: 5 } });
  assert.deepEqual([opened.priceX64, opened.lowerX64, opened.upperX64, opened.confidenceBps],
    [Q64, envelope.lowerX64, envelope.upperX64, envelope.confidenceBps]);
  assert.ok(opened.lowerX64 <= spot && spot <= opened.upperX64);
  const healthyOpen = project(100, hash(null), {});
  assert.deepEqual([healthyOpen.lowerX64, healthyOpen.upperX64], [Q64, Q64]);
  assert.throws(() => project(100, hash(envelope), {}), /InvalidMixedNativeOpening/);
  assert.throws(() => project(100, hash(envelope), { lagEnvelope: { spotX64: spot + 1n, baseConfidenceBps: 5 } }), /InvalidMixedNativeOpening/);
  assert.throws(() => project(100, hash({ ...envelope, confidenceBps: envelope.confidenceBps + 1 }),
    { lagEnvelope: { spotX64: spot, baseConfidenceBps: 5 } }), /InvalidMixedNativeOpening/);
  assert.throws(() => project(50, hash(envelope), { lagEnvelope: { spotX64: spot, baseConfidenceBps: 5 } }), /DispersionTooWide/);
}
console.log("native lag envelope ok");
