import assert from "node:assert/strict";
import * as api from "../src/internal/currentPointCore.js";
import { runCurrentPointVectorParity } from "./currentPointVectors.mjs";

const checks = runCurrentPointVectorParity(api, new URL("./fixtures/currentPointAbiVectors.json", import.meta.url).pathname);
assert.equal(checks, 26);
const ctx = new Uint8Array(32).fill(1), cfg = new Uint8Array(32).fill(2), plan = new Uint8Array(32).fill(3);
const rec = (slot: bigint, price: bigint) => ({ slot, unixTs: 1000n + slot, priceX64: price, fingerprint: new Uint8Array(32).fill(4) });
const opts = { sourceConfig: cfg, planHash: plan, sourceDepthFloor: 5n, sourceMinLiquidity: 1n };
const a = api.applyMimirCurrentPointObservation(null, { record: rec(10n, 7n), observedDepthNative: 10n, observedLiquidityNative: 1n }, ctx, opts);
assert.equal(a.action, "INITIALIZE"); assert.equal(a.state.sequence, 1n);
assert.equal(api.applyMimirCurrentPointObservation(a.state, { record: rec(10n, 7n), observedDepthNative: 10n, observedLiquidityNative: 1n }, ctx, opts).action, "NOOP");
const b = api.applyMimirCurrentPointObservation(a.state, { record: rec(10n, 8n), observedDepthNative: 10n, observedLiquidityNative: 1n }, ctx, opts);
assert.equal(b.action, "ADVANCE"); assert.equal(b.state.sequence, 2n);
const c = api.applyMimirCurrentPointObservation(b.state, { record: rec(11n, 8n), observedDepthNative: 10n, observedLiquidityNative: 1n }, new Uint8Array(32).fill(9), opts);
assert.equal(c.action, "CONTEXT_RESET"); assert.equal(c.state.sequence, 1n);
assert.throws(() => api.applyMimirCurrentPointObservation(null, { record: rec(10n, 7n), observedDepthNative: 4n, observedLiquidityNative: 1n }, ctx, opts));
assert.throws(() => api.mimirTemporalModeFromSourceFlags(1, 2, 0));
assert.throws(() => api.mimirTemporalModeFromSourceFlags(2, 4, 0));
assert.equal(api.mimirTemporalModeFromSourceFlags(1, 6, 1), "current-point");
for (const [f, pos, shared, min] of [[0n, 0n, 0n, null], [9n, 0n, 2n, null], [10n, 1n, 2n, 1n], [10_000_000n, 1_000_000n, 2_500_000n, 1_000_000n],
  [4_000_000_000n, 250_000_000n, 1_000_000_000n, 1_000_000n]] as const) {
  const caps = api.mimirCurrentPointCaps({ floorNative: f, quoteDecimals: 6 });
  assert.deepEqual([caps.positionUsdc6, caps.sharedUsdc6, caps.newMarketMinimumUsdc6], [pos, shared, min]);
}
assert.equal(api.mimirCurrentPointCaps({ floorNative: 1_000_000_000n, quoteDecimals: 9, quoteToUsdcLowerX64: 150n << 64n }).floorUsdc6, 150_000_000n);
assert.throws(() => api.mimirCurrentPointCaps({ floorNative: 1n, quoteDecimals: 9 }));
assert.equal(api.mimirCurrentPointFloorBudget([9n, 3n, 7n]), 3n);
console.log(`current point: ${checks} vector checks`);

import { decodeMimirBetaLiveSource } from "../src/beta/liveAbi.js";
import { encodeMimirBetaCompactSource } from "../src/beta/abi.js";
import { decodeSourceConfigHeader } from "../src/internal/nativeMonoRefreshCore.js";
const sourceAccount = (adapterType: number, adapterVersion: number, flags: number) => {
  const d = new Uint8Array(384), v = new DataView(d.buffer);
  d.set(new TextEncoder().encode("MIMIRSRC")); v.setUint16(10, 384, true); v.setUint32(12, flags, true);
  d.fill(1, 16, 48); d[49] = adapterType; d[51] = 1; v.setUint16(52, adapterVersion, true); v.setUint16(70, 10_000, true);
  d[72] = 1; d[88] = 1; d.fill(2, 104, 168); d.fill(3, 232, 264); d.fill(4, 264, 296);
  return d;
};
assert.equal(decodeMimirBetaLiveSource(sourceAccount(4, 0, 1)).temporalMode, "current-point");
assert.equal(decodeMimirBetaLiveSource(sourceAccount(6, 1, 1)).temporalMode, "current-point");
assert.equal(decodeMimirBetaLiveSource(sourceAccount(4, 0, 0)).temporalMode, "sampled-interval");
assert.equal(decodeSourceConfigHeader(sourceAccount(6, 0, 1)).temporalMode, "current-point");
for (const [t, ver, f] of [[2, 0, 1], [4, 0, 2], [6, 0, 0x80]] as const) {
  assert.throws(() => decodeMimirBetaLiveSource(sourceAccount(t, ver, f)));
  assert.throws(() => decodeSourceConfigHeader(sourceAccount(t, ver, f)));
}
const key = "11111111111111111111111111111112" as never;
const compact = (adapterType: 2 | 4, temporalMode?: api.MimirTemporalMode) => encodeMimirBetaCompactSource({ feedId: key, sourceIndex: 0,
  adapterType, direction: 1, adapterVersion: 0, venueGroup: 0, operatorGroup: 0, liquidityOwnerGroup: 0, routeCorrelationGroup: 0,
  quoteAssetGroup: 0, bridgeOrWrapperGroup: 0, oracleSourceClass: 0, upgradeAuthorityGroup: 0, maxSourceWeightBps: 10_000,
  minLiquidityNative: 1n, minDepthTo50BpsNative: 1n, programId: key, poolOrMarket: key, baseVault: key, quoteVault: key,
  tokenProgram: key, vaultAuthority: key, sourceConfigRevision: 1n, sourceSetRevision: 1n, temporalMode });
assert.equal(compact(4, "current-point")[34], 0x81);
assert.equal(compact(4)[34], 1);
assert.equal(compact(4, "current-point").length, 295);
assert.throws(() => compact(2, "current-point"));

import { buildMimirBetaComputeUnitLimitInstruction, mimirCurrentPointComputeUnitLimit } from "../src/beta/liveAbi.js";
assert.equal(mimirCurrentPointComputeUnitLimit(1), 880_000);
assert.equal(mimirCurrentPointComputeUnitLimit(5), 1_400_000);
assert.deepEqual([...buildMimirBetaComputeUnitLimitInstruction(880_000).data], [2, 0x80, 0x6d, 0x0d, 0]);
console.log("current point: compute budget ok");

import { assessMimirBetaCurrentPointProfile } from "../src/beta/discovery.js";
const pool = (adapterType: number, d50: bigint) => ({ minDepthTo50BpsNative: d50, creation: { adapterType, adapterVersion: 0 } }) as never;
const dust = assessMimirBetaCurrentPointProfile([pool(4, 15n)], { quoteDecimals: 6 });
assert.equal(dust.dust, true); assert.equal(dust.recommended, false); assert.match(dust.disclosure!, /dust feed/);
assert.equal(dust.readiness, "ready-after-first-publication");
const pools = [pool(4, 20_000_000n), pool(6, 40_000_000n)];
const ok = assessMimirBetaCurrentPointProfile(pools, { quoteDecimals: 6 });
assert.deepEqual(ok.sourceFloorsNative, [1_800_000n, 3_600_000n]);
assert.equal(ok.floorBudgetNative, 1_800_000n); assert.equal(ok.caps!.positionUsdc6, 180_000n); assert.equal(ok.recommended, false);
for (const [depthFloorBps, floor, position] of [[5000, 10_000_000n, 1_000_000n], [9000, 18_000_000n, 1_800_000n]] as const) {
  const selected = assessMimirBetaCurrentPointProfile(pools, { quoteDecimals: 6, depthFloorBps });
  assert.deepEqual(selected.sourceFloorsNative, [floor, floor * 2n]);
  assert.equal(selected.floorBudgetNative, floor); assert.equal(selected.caps!.positionUsdc6, position); assert.equal(selected.recommended, true);
}
for (const depthFloorBps of [0, -1, NaN, 1.5, 10_001])
  assert.throws(() => assessMimirBetaCurrentPointProfile(pools, { quoteDecimals: 6, depthFloorBps }), { name: "RangeError", message: "depthFloorBps out of range" });
for (const [depthFloorBps, floor, position, shared] of [[undefined, 180_000_000n, 18_000_000n, 45_000_000n], [5000, 1_000_000_000n, 100_000_000n, 250_000_000n]] as const) {
  const repro = assessMimirBetaCurrentPointProfile([pool(4, 2_000_000_000n)], { quoteDecimals: 6, depthFloorBps });
  assert.deepEqual(repro.sourceFloorsNative, [floor]); assert.equal(repro.floorBudgetNative, floor);
  assert.equal(repro.caps!.positionUsdc6, position); assert.equal(repro.caps!.sharedUsdc6, shared);
}
assert.equal(assessMimirBetaCurrentPointProfile([pool(2, 1n)], { quoteDecimals: 6 }).admitted, false);
console.log("current point: discovery dust disclosure ok");

import { mimirCurrentPointTransitionValid } from "../src/beta/sampledModuleReview.js";
assert.equal(mimirCurrentPointTransitionValid(a.state, a.state), true);
assert.equal(mimirCurrentPointTransitionValid(a.state, b.state), true);
assert.equal(mimirCurrentPointTransitionValid(b.state, c.state), true);
assert.equal(mimirCurrentPointTransitionValid(b.state, a.state), false);
assert.equal(mimirCurrentPointTransitionValid(a.state, { ...b.state, sequence: 3n }), false);
assert.equal(mimirCurrentPointTransitionValid(a.state, { ...a.state, record: rec(10n, 9n) }), false);
assert.throws(() => api.decodeMimirCurrentPointModule(new Uint8Array(1280)));
console.log("current point: module review transitions ok");

import { readFileSync } from "node:fs";
import { decodeSourceObservationRingV1Header } from "../src/codec.js";
const pointFixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/current-point/${name}`, import.meta.url)));
const nativeRing = pointFixture("point-ring.bin");
assert.equal(decodeSourceObservationRingV1Header(nativeRing).minSlotGap, 0);
const gap2Ring = nativeRing.slice(); new DataView(gap2Ring.buffer).setUint16(60, 2, true);
assert.throws(() => decodeSourceObservationRingV1Header(gap2Ring), /InvalidSourceRing/);
import { decodeFeedSnapshotHeader } from "../src/codec.js";
const nativeSnapshot = pointFixture("point-snapshot.bin");
const nativeDecoded = api.decodeMimirCurrentPointSource7Snapshot(nativeSnapshot);
assert.equal(nativeDecoded.status === "fresh" && nativeDecoded.floorBudgetNative, 400n);
assert.equal(decodeFeedSnapshotHeader(nativeSnapshot).capModelVersion, 2);
const v0Snapshot = nativeSnapshot.slice(); v0Snapshot[420] = 0;
assert.throws(() => api.decodeMimirCurrentPointSource7Snapshot(v0Snapshot), /InvalidCurrentPointSource7Snapshot/);
assert.throws(() => decodeFeedSnapshotHeader(v0Snapshot));
const nativePoint = api.decodeMimirCurrentPointModule(pointFixture("point-module.bin"));
const zeroed = new Uint8Array(32);
for (const patch of [{ context: zeroed }, { sourceConfig: zeroed }, { planHash: zeroed }, { record: { ...nativePoint.record, fingerprint: zeroed } }])
  assert.throws(() => api.encodeMimirCurrentPointModule({ ...nativePoint, ...patch }), /INVALID_IDENTITY/);
const otherCtx = new Uint8Array(32).fill(0xee), sameObs = { observedDepthNative: 1n << 100n, observedLiquidityNative: 1n << 100n };
const pointOpts = { sourceConfig: nativePoint.sourceConfig, planHash: nativePoint.planHash, sourceDepthFloor: 1n, sourceMinLiquidity: 0n };
const later = { ...nativePoint.record, slot: nativePoint.record.slot + 1n, unixTs: nativePoint.record.unixTs + 1n };
assert.throws(() => api.applyMimirCurrentPointObservation(nativePoint, { record: later, ...sameObs }, otherCtx, { ...pointOpts, expectedPrevSlot: 999n }), /STALE_CAS/);
assert.throws(() => api.applyMimirCurrentPointObservation(nativePoint, { record: { ...later, slot: nativePoint.record.slot - 1n }, ...sameObs }, otherCtx, pointOpts), /CLOCK_REGRESSION/);
assert.throws(() => api.applyMimirCurrentPointObservation(null, { record: { ...later, slot: 5n }, ...sameObs }, otherCtx, { ...pointOpts, existingRingSlot: 6n }), /CLOCK_REGRESSION/);
assert.equal(api.applyMimirCurrentPointObservation(nativePoint, { record: later, ...sameObs }, otherCtx, pointOpts).action, "CONTEXT_RESET");
const ringPrice = new DataView(nativeRing.buffer, nativeRing.byteOffset).getBigUint64(88, true) | (new DataView(nativeRing.buffer, nativeRing.byteOffset).getBigUint64(96, true) << 64n);
const ringMatch = { existingRingSlot: nativePoint.record.slot, existingRingPriceX64: ringPrice, existingRingFingerprint: nativeRing.slice(184, 216) };
for (const ctx of [nativePoint.context, otherCtx]) {
  assert.ok(api.applyMimirCurrentPointObservation(nativePoint, { record: later, ...sameObs }, ctx, { ...pointOpts, ...ringMatch }));
  assert.throws(() => api.applyMimirCurrentPointObservation(nativePoint, { record: later, ...sameObs }, ctx, { ...pointOpts, ...ringMatch, existingRingPriceX64: ringPrice + 1n }), /RING_MODULE_HEAD_MISMATCH/);
  assert.throws(() => api.applyMimirCurrentPointObservation(nativePoint, { record: later, ...sameObs }, ctx, { ...pointOpts, ...ringMatch, existingRingFingerprint: zeroed }), /RING_MODULE_HEAD_MISMATCH/);
}
assert.equal(mimirCurrentPointTransitionValid(nativePoint, { ...nativePoint, sequence: nativePoint.sequence + 1n }), false);
assert.equal(mimirCurrentPointTransitionValid(nativePoint, { ...nativePoint, context: otherCtx, sequence: 1n,
  record: { ...nativePoint.record, slot: nativePoint.record.slot - 1n } }), false);
assert.equal(mimirCurrentPointTransitionValid(nativePoint, { ...nativePoint, sequence: nativePoint.sequence + 1n,
  record: { ...nativePoint.record, priceX64: nativePoint.record.priceX64 + 1n } }), true);
import { assertPlainSnapshotSource, verifySnapshotHeader } from "../src/codec.js";
assert.throws(() => assertPlainSnapshotSource(decodeFeedSnapshotHeader(nativeSnapshot)), /InvalidSnapshotSource/);
assert.throws(() => verifySnapshotHeader(decodeFeedSnapshotHeader(nativeSnapshot), {} as any), /InvalidSnapshotSource/);

import { computeLifecycleSourceSetRoot } from "../src/codec.js";
const liveRoot = JSON.parse(readFileSync(new URL("./fixtures/currentPointSourceSetRoot.json", import.meta.url), "utf8"));
const pointSource = decodeSourceConfigHeader(Buffer.from(liveRoot.sourceConfig, "hex"));
assert.equal(pointSource.flags, 1);
assert.equal(computeLifecycleSourceSetRoot(Buffer.from(liveRoot.feedId, "hex"), [pointSource]).toString("hex"), liveRoot.sourceSetHash);
assert.notEqual(computeLifecycleSourceSetRoot(Buffer.from(liveRoot.feedId, "hex"), [{ ...pointSource, flags: 0 }]).toString("hex"), liveRoot.sourceSetHash);
assert.throws(() => computeLifecycleSourceSetRoot(Buffer.from(liveRoot.feedId, "hex"), [{ ...pointSource, flags: 2 }]));
console.log("current point: live r7 point source-set root ok");
