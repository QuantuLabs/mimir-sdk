import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeMimirBrowserSourceRingV1, decodeFeedSnapshotHeader } from '../src/internal/nativeMonoRefreshCore.js';
import { decodeMimirSampledSource6Snapshot } from '../src/internal/sampledTemporalCore.js';
import { applyMimirSampledObservation, encodeMimirSampledTemporalModule, projectMimirSampledHistory,
  summarizeMimirSampledState, MIMIR_SAMPLED_SOURCE_ADAPTERS, type MimirSampledState } from '../src/internal/sampledTemporalCore.js';
import { projectMimirMixedBoundedV1 } from '../src/internal/mixedBoundedCore.js';
import { PublicKey } from '@solana/web3.js';

const pk = (v: number) => new PublicKey(new Uint8Array(32).fill(v));
const P = 1n << 64n, programId = pk(99), planHash = new Uint8Array(32).fill(9), feedId = new Uint8Array(32).fill(1);
const adapter = MIMIR_SAMPLED_SOURCE_ADAPTERS[4], loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const feed = { maxConfidenceBps: 10000, maxDispersionBps: 10000, maxSourceActivityAgeSlots: 150,
  maxSnapshotAgeSlots: 150, minSourceCount: 2, minVenueCount: 1, minCorrelationGroupCount: 1 } as any;
const plan = { planHash, maxSourceActivityAgeSlots: 150, maxDispersionBps: 10000, minSources: 2,
  minVenues: 1, minCorrelationGroups: 1 } as any;
const data = new Uint8Array(45); data[0] = 3; new DataView(data.buffer).setBigUint64(4, adapter.deploymentSlot, true);
const stateFor = (index: number, times: bigint[], prices: bigint[], floor = 7n) => {
  let state: MimirSampledState | null = null;
  times.forEach((unixTs, k) => { state = applyMimirSampledObservation(state, { record: { slot: 100n + (unixTs - 1000n) / 10n,
    unixTs, priceX64: prices[k]!, observationHash: new Uint8Array(32).fill(7) }, observedDepthNative: 1000n },
    new Uint8Array(32).fill(4), { sourceConfig: pk(10 + index).toBytes(), planHash, sourceDepthFloor: floor }).state; });
  return state!;
};
const sourceFor = (index: number, state: MimirSampledState, group = index, economics = 0n) => {
  const modulePda = PublicKey.findProgramAddressSync([Buffer.from('source_temporal'), feedId, Buffer.from([index]), Buffer.from([4, 0])], programId)[0];
  return { sourceConfig: pk(10 + index), proof: { kind: 9 as const },
    config: { sourceIndex: index, adapterType: 4, adapterVersion: 0, feedId, maxSourceWeightBps: 10000,
      routeCorrelationGroup: group, venueGroup: index, sourceConfigRevision: 1n, sourceSetRevision: 1n,
      programId: new PublicKey(adapter.program).toBytes(), minDepthTo50BpsNative: state.depthFloor } as any,
    ring: { sourceIndex: index, newestSlot: state.close.slot, completedEndSlot: state.close.slot, completedActivitySlot: 0n,
      windowFlags: 1, pointOnly: economics === 0n, lastPriceX64: state.close.priceX64, completedPriceX64: state.close.priceX64,
      sourceWeightBps: 10000, routeCorrelationGroup: group, sourceConfigRevision: 1n, sourceSetRevision: 1n,
      selectedPlanHash: planHash, lastObservationHash: state.close.observationHash, completedMaxConfidenceBps: 1,
      completedMinDepthTo50BpsNative: 1000n, completedMinEconLossFloorNative: economics,
      completedMinCapitalRequiredFloorNative: economics } as any,
    quiet: { module: { address: modulePda, owner: programId, executable: false, data: encodeMimirSampledTemporalModule(state) },
      sourceProgram: { address: new PublicKey(adapter.program), owner: loader, executable: true,
        data: Uint8Array.from([2, 0, 0, 0, ...new PublicKey(adapter.programData).toBytes()]) },
      sourceProgramData: { address: new PublicKey(adapter.programData), owner: loader, executable: false, data } } };
};
const project = (sources: ReturnType<typeof sourceFor>[], now: bigint) => projectMimirMixedBoundedV1({
  sources, feed, plan, programId, clock: { slot: 100n + (now - 1000n) / 10n, unixTs: now }, maxObservationAgeSlots: 150 });
const times = Array.from({length: 13}, (_, k) => 1000n + BigInt(k * 10));
{
  const a = stateFor(0, times, times.map(() => P));
  const b = stateFor(1, times, times.map(() => P + 1n));
  const output = project([sourceFor(0, a), sourceFor(1, b)], 1120n);
  assert.equal(output.upperX64, P + 2n);
}
{
  const a = stateFor(0, times, times.map(() => P), 7n);
  const b = stateFor(1, times, times.map(() => P), 700n);
  const output = project([sourceFor(0, a, 0, 100n), sourceFor(1, b, 0, 1n)], 1120n);
  assert.deepEqual(output.effectiveSources.map(row => row.sourceIndex), [0]);
  assert.equal(output.sampledDepthFloorNative, 7n);
}
{
  const fullTimes = Array.from({length: 16}, (_, k) => 1000n + BigInt(k * 10));
  const a = stateFor(0, fullTimes, fullTimes.map((_, k) => k === 0 ? P + P * 90n / 10000n : P));
  const b = stateFor(1, fullTimes.slice(3), fullTimes.slice(3).map(() => P));
  const c = stateFor(2, fullTimes.slice(3), fullTimes.slice(3).map(() => P));
  const full = summarizeMimirSampledState(a);
  const output = project([sourceFor(0, a), sourceFor(1, b), sourceFor(2, c)], 1150n);
  assert.equal(full.ready, true); assert.equal(full.confidenceBps, 84n);
  assert.ok(output.confidenceBps >= 84);
}
{
  const fullTimes = Array.from({ length: 16 }, (_, k) => 1000n + BigInt(k * 10));
  const a = stateFor(0, fullTimes, fullTimes.map((_, k) => k >= 3 && k < 10 ? P + P * 90n / 10000n : P));
  const b = stateFor(1, fullTimes.slice(3), fullTimes.slice(3).map(() => P));
  assert.equal(summarizeMimirSampledState(a).ready, true);
  assert.equal(projectMimirSampledHistory(a.records, a.close, { startUnixTs: 1030n, endUnixTs: 1150n }).closeDeviationBps, 53n);
  assert.throws(() => project([sourceFor(0, a), sourceFor(1, b)], 1150n), /ConfidenceTooWide/);
}
{
  const fullTimes = Array.from({ length: 16 }, (_, k) => 1000n + BigInt(k * 10)), shortTimes = fullTimes.slice(3);
  const a = stateFor(0, shortTimes, shortTimes.map(() => P));
  const b = stateFor(1, fullTimes, fullTimes.map((_, k) => k === 0 ? P + P * 90n / 10000n : P));
  const c = stateFor(2, shortTimes, shortTimes.map(() => P));
  const output = project([sourceFor(0, a, 0), sourceFor(1, b, 0), sourceFor(2, c, 1)], 1150n);
  assert.deepEqual(output.effectiveSources.map(row => row.sourceIndex), [0, 2]);
  assert.equal(output.confidenceBps, 84);
}
{
  const { encodeMimirCurrentPointModule } = await import('../src/internal/currentPointCore.js');
  const pointSource = (index: number): ReturnType<typeof sourceFor> => {
    const base = sourceFor(index, stateFor(index, times, times.map(() => P)));
    const record = { slot: 112n, unixTs: 1120n, priceX64: P, fingerprint: new Uint8Array(32).fill(5) };
    return { ...base, proof: { kind: 10 as const }, config: { ...base.config, temporalMode: 'current-point', minDepthTo50BpsNative: 7n, minLiquidityNative: 1n },
      ring: { ...base.ring, newestSlot: 112n, completedEndSlot: 112n, minSlotGap: 0, pointOnly: true, lastPriceX64: P, completedPriceX64: P,
        lastObservationHash: record.fingerprint, lastDepthTo50BpsNative: 7n, lastLiquidityNative: 1n },
      quiet: { ...base.quiet, module: { ...base.quiet.module, data: encodeMimirCurrentPointModule({ context: new Uint8Array(32).fill(4),
        sourceConfig: pk(10 + index).toBytes(), planHash, sequence: 1n, record }) } } } as any;
  };
  const output = project([pointSource(0), pointSource(1)], 1120n);
  assert.equal(output.priceX64, P);
  for (const ring of [{ minSlotGap: 1 }, { lastDepthTo50BpsNative: 6n }, { lastLiquidityNative: 0n }]) {
    const bad = pointSource(0); assert.throws(() => project([{ ...bad, ring: { ...bad.ring, ...ring } }, pointSource(1)], 1120n), /MixedBoundedPointNotCurrent/);
  }
  const foreign = pointSource(0); assert.throws(() => project([{ ...foreign, sourceConfig: pk(77) }, pointSource(1)], 1120n), /MixedBoundedPointNotCurrent/);
}
console.log("source6 mixed parity: upper ceil, kind9 ordering, full-support confidence, clipped quality ok");
