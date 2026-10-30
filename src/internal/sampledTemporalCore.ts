import { sha256 } from "@noble/hashes/sha256";
import { validateFrontier } from "../frontier.js";
import { validateDegradedSnapshot, type MimirDegradedSnapshot } from "../liveness.js";
import { address, getAddressEncoder } from "@solana/kit";

export const MIMIR_SAMPLED_TEMPORAL_MODULE_V4 = Object.freeze({
  magic: "MTP4", moduleVersion: 4, length: 1280, kind: 9, capacity: 16, policy: 1, recordLen: 64, recordsOffset: 256,
  flagPresent: 1, flagReady: 3, minimumSpanSeconds: 120n, bucketSeconds: 10n, minGapSeconds: 8n, maxGapSeconds: 15n,
  minimumRecords: 13, maxBandBps: 100, maxCloseDeviationBps: 50,
} as const);
export const MIMIR_SAMPLED_MIXED_PROOF_KIND = 9;
export const MIMIR_SAMPLED_SNAPSHOT_SOURCE_KIND = 6;
export const MIMIR_SAMPLED_INTERVAL_MODEL_HASH = sha256(utf8("MIMIR_SAMPLED_INTERVAL_UNCERTIFIED_V1"));
export const MIMIR_SAMPLED_SOURCE_ADAPTERS = Object.freeze({
  4: Object.freeze({ program: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", programData: "A7ZG7ByDi8DpzT9Ab7CiXhvgYTJQmaDPJkMDoPitaCQV",
    deploymentSlot: 445763204n, adapterAccounts: 6, tag77Accounts: 16 }),
  6: Object.freeze({ program: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", programData: "6naEzKeUuFh1Jeeu51NXQgr5qkXgXtc9WKNct4xynVJc",
    deploymentSlot: 454596406n, adapterAccounts: 7, tag77Accounts: 17 }),
} as const);
export const MIMIR_DEVNET_SAMPLED_SOURCE_ADAPTERS = Object.freeze({
  4: Object.freeze({ program: "DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav", programData: "CBzefV6o4R3jkFThNxzFsDNSJrnoUwgf6CBfUBiqh6VE",
    deploymentSlot: 494463161n, adapterAccounts: 6, tag77Accounts: 16 }),
  6: Object.freeze({ program: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", programData: "6naEzKeUuFh1Jeeu51NXQgr5qkXgXtc9WKNct4xynVJc",
    deploymentSlot: 508659436n, adapterAccounts: 7, tag77Accounts: 17 }),
} as const);
/** AMM-v4/PumpSwap generation pins the frozen program admits on this cluster. */
export function mimirSampledSourceAdapters(cluster: "mainnet" | "localnet" | "devnet" = "mainnet"): Readonly<Record<4 | 6, Readonly<{
  program: string; programData: string; deploymentSlot: bigint; adapterAccounts: number; tag77Accounts: number }>>> {
  return cluster === "devnet" ? MIMIR_DEVNET_SAMPLED_SOURCE_ADAPTERS : MIMIR_SAMPLED_SOURCE_ADAPTERS;
}

export type MimirSampledTemporalErrorCode =
  | "INVALID_POINT" | "INVALID_IDENTITY" | "INVALID_SLOT" | "CLOCK_REGRESSION" | "INVALID_CONTEXT" | "CONTEXT_FLOOR_MISMATCH" | "SOURCE_DEPTH_FLOOR"
  | "RING_MODULE_HEAD_MISMATCH" | "STALE_CAS" | "SAME_SLOT_CHANGED" | "MIN_SLOT_GAP" | "ARITHMETIC_OVERFLOW" | "INVALID_BOUNDS"
  | "INVALID_SUPPORT" | "EMPTY_HISTORY" | "ZERO_PRICE" | "INVALID_MODULE_HEADER" | "INVALID_MODULE_HEAD" | "NONZERO_UNUSED_RECORD"
  | "INVALID_CHRONOLOGY" | "INVALID_CLOSURE" | "INVALID_SEQUENCE" | "INVALID_READY_HINT" | "MODULE_SUMMARY_OR_DIGEST_MISMATCH";
export class MimirSampledTemporalError extends Error {
  constructor(readonly code: MimirSampledTemporalErrorCode) { super(code); this.name = "MimirSampledTemporalError"; }
}
const check = (ok: boolean, code: MimirSampledTemporalErrorCode): void => { if (!ok) throw new MimirSampledTemporalError(code); };
const uint = (value: bigint, bits = 128) => { check(value >= 0n && value < 1n << BigInt(bits), "ARITHMETIC_OVERFLOW"); return value; };
const ceilDiv = (n: bigint, d: bigint) => n / d + (n % d === 0n ? 0n : 1n);

export interface MimirSampledRecord {
  readonly slot: bigint; readonly unixTs: bigint; readonly priceX64: bigint; readonly observationHash: Uint8Array;
}
export interface MimirSampledProjection {
  readonly startUnixTs: bigint; readonly endUnixTs: bigint; readonly supportSeconds: bigint; readonly actualRecords: number;
  readonly integralX64Seconds: bigint; readonly meanX64: bigint; readonly lowerX64: bigint; readonly upperX64: bigint;
  readonly observedBandBps: bigint; readonly confidenceBps: bigint; readonly closeDeviationBps: bigint;
  readonly depthFloorQuoteNative: bigint;
}
export interface MimirSampledSummary extends MimirSampledProjection {
  readonly acceptedCount: number; readonly sequence: bigint; readonly nextIndex: number; readonly temporalReady: boolean;
  readonly ready: boolean; readonly flags: 1 | 3; readonly lastAcceptedBucket: bigint; readonly nextEligibleUnixTs: bigint;
}
export interface MimirSampledState {
  readonly context: Uint8Array; readonly sourceConfig: Uint8Array; readonly planHash: Uint8Array;
  readonly records: readonly MimirSampledRecord[]; readonly physical: readonly (MimirSampledRecord | null)[];
  readonly nextIndex: number; readonly sequence: bigint; readonly close: MimirSampledRecord;
  readonly depthFloor: bigint; readonly bandLimitBps: number; readonly closeLimitBps: number;
}
export type MimirSampledTransitionAction = "INITIALIZE" | "ACCEPT" | "CLOSURE" | "GAP_RESET" | "CONTEXT_RESET" | "NOOP";

export function encodeMimirSampledRecord(record: MimirSampledRecord, observedDepthNative?: bigint): Uint8Array {
  check(record.slot > 0n, "INVALID_SLOT"); check(record.unixTs >= 0n, "CLOCK_REGRESSION"); uint(record.unixTs, 63); uint(record.slot, 64);
  check(record.priceX64 > 0n && record.observationHash.length === 32, "INVALID_POINT"); uint(record.priceX64);
  if (observedDepthNative !== undefined) check(uint(observedDepthNative) > 0n, "INVALID_POINT");
  const out = new Uint8Array(64);
  putUint(out, 0, record.slot, 8); putUint(out, 8, record.unixTs, 8); putUint(out, 16, record.priceX64, 16); out.set(record.observationHash, 32);
  return out;
}

export function decodeMimirSampledRecord(data: Uint8Array): MimirSampledRecord {
  check(data.length === 64, "INVALID_POINT");
  const record = { slot: readUint(data, 0, 8), unixTs: BigInt.asIntN(64, readUint(data, 8, 8)), priceX64: readUint(data, 16, 16),
    observationHash: data.slice(32, 64) };
  encodeMimirSampledRecord(record);
  return record;
}

/** Left-hold projection over the retained history, optionally clipped to a common interval. */
export function projectMimirSampledHistory(records: readonly MimirSampledRecord[], close: MimirSampledRecord,
  options: Readonly<{ startUnixTs?: bigint; endUnixTs?: bigint; depthFloor?: bigint }> = {}): MimirSampledProjection {
  check(records.length > 0, "EMPTY_HISTORY");
  const start = options.startUnixTs ?? records[0]!.unixTs, end = options.endUnixTs ?? close.unixTs;
  check(records[0]!.unixTs <= start && start <= end && end <= close.unixTs, "INVALID_SUPPORT");
  const actualRecords = records.filter(row => start <= row.unixTs && row.unixTs <= end).length;
  const support = end - start;
  let integral = 0n, mean: bigint, lower: bigint, upper: bigint;
  if (support === 0n) mean = lower = upper = close.priceX64;
  else {
    const active: bigint[] = [];
    records.forEach((row, index) => {
      const next = records[index + 1]?.unixTs ?? close.unixTs;
      const left = row.unixTs > start ? row.unixTs : start, right = next < end ? next : end;
      const dt = right > left ? right - left : 0n;
      integral = uint(integral + uint(row.priceX64 * dt, 256), 256);
      if (dt > 0n || (start <= row.unixTs && row.unixTs <= end)) active.push(row.priceX64);
    });
    active.push(close.priceX64);
    mean = uint(integral / support);
    lower = active.reduce((a, b) => a < b ? a : b); upper = uint(active.reduce((a, b) => a > b ? a : b) + 1n);
  }
  check(mean > 0n, "ZERO_PRICE");
  check(0n < lower && lower <= mean && mean <= upper, "INVALID_BOUNDS");
  const band = ceilDiv(uint((upper - lower) * 10000n, 256), mean), observedBandBps = band > 65535n ? 65536n : band;
  const spread = mean - lower > upper - mean ? mean - lower : upper - mean;
  const confidence = uint(ceilDiv(uint(spread * 10000n, 256), mean));
  const closeDistance = close.priceX64 > mean ? close.priceX64 - mean : mean - close.priceX64;
  return { startUnixTs: start, endUnixTs: end, supportSeconds: support, actualRecords, integralX64Seconds: integral,
    meanX64: mean, lowerX64: lower, upperX64: upper, observedBandBps, confidenceBps: confidence > 1n ? confidence : 1n,
    closeDeviationBps: uint(ceilDiv(uint(closeDistance * 10000n, 256), mean)), depthFloorQuoteNative: uint(options.depthFloor ?? 1n) };
}

export function summarizeMimirSampledState(state: MimirSampledState): MimirSampledSummary {
  const o = MIMIR_SAMPLED_TEMPORAL_MODULE_V4;
  const projection = projectMimirSampledHistory(state.records, state.close, { depthFloor: state.depthFloor });
  const temporalReady = state.records.length >= o.minimumRecords && projection.supportSeconds >= o.minimumSpanSeconds;
  const ready = temporalReady && projection.observedBandBps <= BigInt(state.bandLimitBps) &&
    projection.closeDeviationBps <= BigInt(state.closeLimitBps);
  const last = state.records.at(-1)!.unixTs, bucket = last / o.bucketSeconds;
  const byGap = last + o.minGapSeconds, byBucket = (bucket + 1n) * o.bucketSeconds;
  return { ...projection, acceptedCount: state.records.length, sequence: state.sequence, nextIndex: state.nextIndex, temporalReady,
    ready, flags: ready ? 3 : 1, lastAcceptedBucket: bucket, nextEligibleUnixTs: byGap > byBucket ? byGap : byBucket };
}

export function computeMimirSampledHistoryDigest(state: Pick<MimirSampledState, "context" | "sequence" | "records" | "close">): Uint8Array {
  return sha256(concat([utf8("MIMIR_SAMPLED_HISTORY_V1"), state.context, u(state.sequence, 8), Uint8Array.of(state.records.length),
    ...state.records.map(row => encodeMimirSampledRecord(row)), encodeMimirSampledRecord(state.close)]));
}

export function encodeMimirSampledTemporalModule(state: MimirSampledState): Uint8Array {
  const o = MIMIR_SAMPLED_TEMPORAL_MODULE_V4, summary = summarizeMimirSampledState(state), out = new Uint8Array(o.length);
  out.set(utf8(o.magic)); putUint(out, 4, 4n, 2); putUint(out, 6, 1280n, 2); putUint(out, 8, state.close.slot, 8);
  putUint(out, 16, 9n, 2); putUint(out, 18, BigInt(summary.flags), 2); out.set([16, state.records.length, state.nextIndex, 1], 20);
  out.set(state.context, 24); putUint(out, 56, BigInt.asUintN(64, state.close.unixTs), 8); out.set(state.sourceConfig, 64); out.set(state.planHash, 96);
  putUint(out, 128, uint(state.sequence, 64), 8); putUint(out, 136, state.records[0]!.slot, 8); putUint(out, 144, state.records[0]!.unixTs, 8);
  putUint(out, 152, state.close.slot, 8); putUint(out, 160, state.close.unixTs, 8);
  putUint(out, 168, summary.meanX64, 16); putUint(out, 184, summary.lowerX64, 16); putUint(out, 200, summary.upperX64, 16);
  putUint(out, 216, summary.lastAcceptedBucket, 8); out.set(computeMimirSampledHistoryDigest(state), 224);
  state.physical.forEach((row, index) => { if (row) out.set(encodeMimirSampledRecord(row), o.recordsOffset + 64 * index); });
  return out;
}

/** Intrinsic MTP4 validation; the closure comes from the authenticated ring (slot/unix from module, price/fingerprint from ring). */
export function decodeMimirSampledTemporalModule(raw: Uint8Array, close: MimirSampledRecord, options: Readonly<{
  bandLimitBps?: number; closeLimitBps?: number; depthFloor?: bigint;
  /** Only after the caller authenticated a genuinely changed context: the stale ready bit is ignored, never credited. */
  changedContext?: boolean;
}> = {}): MimirSampledState {
  const o = MIMIR_SAMPLED_TEMPORAL_MODULE_V4;
  check(raw.length === o.length && equal(raw.subarray(0, 4), utf8(o.magic)), "INVALID_MODULE_HEADER");
  check(readUint(raw, 4, 2) === 4n && readUint(raw, 6, 2) === 1280n && readUint(raw, 16, 2) === 9n, "INVALID_MODULE_HEADER");
  const flags = Number(readUint(raw, 18, 2));
  check(raw[20] === 16 && raw[23] === 1 && (flags === 1 || flags === 3), "INVALID_MODULE_HEADER");
  const count = raw[21]!, next = raw[22]!;
  check(count >= 1 && count <= 16 && next < 16 && (count === 16 || next === count), "INVALID_MODULE_HEAD");
  const physical: (MimirSampledRecord | null)[] = [];
  for (let index = 0; index < 16; index++) {
    const bytes = raw.subarray(o.recordsOffset + 64 * index, o.recordsOffset + 64 * (index + 1));
    if (count < 16 && index >= count) { check(bytes.every(x => x === 0), "NONZERO_UNUSED_RECORD"); physical.push(null); continue; }
    physical.push(decodeMimirSampledRecord(bytes));
  }
  const records = Array.from({ length: count }, (_, i) => physical[(next - count + i + 16) % 16]!);
  for (let i = 1; i < count; i++) {
    const a = records[i - 1]!, b = records[i]!, gap = b.unixTs - a.unixTs;
    check(b.slot > a.slot && gap >= o.minGapSeconds && gap <= o.maxGapSeconds && b.unixTs / 10n > a.unixTs / 10n, "INVALID_CHRONOLOGY");
  }
  const last = records.at(-1)!;
  encodeMimirSampledRecord(close);
  check(close.slot >= last.slot && close.unixTs - last.unixTs >= 0n && close.unixTs - last.unixTs <= o.maxGapSeconds, "INVALID_CLOSURE");
  check(close.slot !== last.slot || equal(encodeMimirSampledRecord(close), encodeMimirSampledRecord(last)), "INVALID_CLOSURE");
  const state: MimirSampledState = { context: raw.slice(24, 56), sourceConfig: raw.slice(64, 96), planHash: raw.slice(96, 128),
    records, physical, nextIndex: next, sequence: readUint(raw, 128, 8), close, depthFloor: options.depthFloor ?? 1n,
    bandLimitBps: options.bandLimitBps ?? o.maxBandBps, closeLimitBps: options.closeLimitBps ?? o.maxCloseDeviationBps };
  check(state.sequence > 0n, "INVALID_SEQUENCE");
  const rebuilt = encodeMimirSampledTemporalModule(state);
  if (options.changedContext) {
    if (flags & 2) {
      const summary = summarizeMimirSampledState(state);
      check(summary.temporalReady && summary.observedBandBps <= BigInt(o.maxBandBps) &&
        summary.closeDeviationBps <= BigInt(o.maxCloseDeviationBps), "INVALID_READY_HINT");
    }
    rebuilt.set(raw.subarray(18, 20), 18);
  }
  check(equal(rebuilt, raw), "MODULE_SUMMARY_OR_DIGEST_MISMATCH");
  return state;
}

export function mimirSampledQualityLimits(feed: Readonly<{ maxConfidenceBps: number; maxDispersionBps: number }>,
  plan: Readonly<{ maxDispersionBps: number }>): Readonly<{ bandLimitBps: number; closeLimitBps: number }> {
  const limit = (cap: number) => Math.min(cap, feed.maxConfidenceBps, feed.maxDispersionBps, plan.maxDispersionBps);
  return { bandLimitBps: limit(MIMIR_SAMPLED_TEMPORAL_MODULE_V4.maxBandBps), closeLimitBps: limit(MIMIR_SAMPLED_TEMPORAL_MODULE_V4.maxCloseDeviationBps) };
}

/** Closure record: slot/unix from module 152/160, price/fingerprint from ring 88/184; ring newest slot must equal module 8. */
export function mimirSampledClosureFromRing(module: Uint8Array, ring: Uint8Array): MimirSampledRecord {
  check(module.length === 1280 && ring.length === 544 && readUint(ring, 64, 8) === readUint(module, 8, 8), "INVALID_CLOSURE");
  return { slot: readUint(module, 152, 8), unixTs: BigInt.asIntN(64, readUint(module, 160, 8)), priceX64: readUint(ring, 88, 16),
    observationHash: ring.slice(184, 216) };
}

/** Offline mirror of the private sampled row transition. Returns a fresh state; inputs are never mutated. */
export function applyMimirSampledObservation(previous: MimirSampledState | null, point: Readonly<{
  record: MimirSampledRecord; observedDepthNative: bigint }>, context: Uint8Array, options: Readonly<{
  sourceConfig: Uint8Array; planHash: Uint8Array; sourceDepthFloor?: bigint; expectedPrevSlot?: bigint;
  existingRingSlot?: bigint; minSlotGap?: bigint; bandLimitBps?: number; closeLimitBps?: number;
}>): Readonly<{ state: MimirSampledState; action: MimirSampledTransitionAction }> {
  const o = MIMIR_SAMPLED_TEMPORAL_MODULE_V4, input = point.record;
  encodeMimirSampledRecord(input, point.observedDepthNative);
  check(context.length === 32, "INVALID_CONTEXT");
  const previousFloor = previous?.depthFloor ?? 1n, floor = uint(options.sourceDepthFloor ?? previousFloor);
  check(!previous || floor === previousFloor || !equal(context, previous.context), "CONTEXT_FLOOR_MISMATCH");
  check(point.observedDepthNative >= floor, "SOURCE_DEPTH_FLOOR");
  let ringHead = previous?.close.slot ?? 0n;
  if (options.existingRingSlot !== undefined) {
    uint(options.existingRingSlot, 64);
    check(!previous || options.existingRingSlot === previous.close.slot, "RING_MODULE_HEAD_MISMATCH");
    ringHead = options.existingRingSlot;
  }
  check(input.slot >= ringHead, "CLOCK_REGRESSION");
  if (previous) check(input.unixTs >= previous.close.unixTs, "CLOCK_REGRESSION");
  const expected = options.expectedPrevSlot ?? 0n;
  check(expected === 0n || expected === ringHead, "STALE_CAS");
  if (previous && input.slot === previous.close.slot) {
    check(equal(context, previous.context) &&
      equal(encodeMimirSampledRecord(input), encodeMimirSampledRecord(previous.close)), "SAME_SLOT_CHANGED");
    return { state: previous, action: "NOOP" };
  }
  if (ringHead > 0n) check(input.slot > ringHead && input.slot - ringHead >= (options.minSlotGap ?? 1n), "MIN_SLOT_GAP");
  const last = previous?.records.at(-1);
  const reset = !previous || !equal(context, previous.context) || input.unixTs - last!.unixTs > o.maxGapSeconds;
  let action: MimirSampledTransitionAction = !previous ? "INITIALIZE" : !equal(context, previous.context) ? "CONTEXT_RESET" :
    reset ? "GAP_RESET" : "CLOSURE";
  const sequence = uint((previous?.sequence ?? 0n) + 1n, 64);
  let records = reset ? [] : [...previous!.records], physical = reset ? Array<MimirSampledRecord | null>(16).fill(null) : [...previous!.physical];
  let nextIndex = reset ? 0 : previous!.nextIndex;
  const accepted = reset || (input.unixTs > last!.unixTs && input.slot > last!.slot &&
    input.unixTs / o.bucketSeconds > last!.unixTs / o.bucketSeconds && input.unixTs - last!.unixTs >= o.minGapSeconds);
  if (accepted) {
    physical[nextIndex] = input; nextIndex = (nextIndex + 1) % 16; records = [...records, input].slice(-16);
    if (!reset) action = "ACCEPT";
  }
  const state: MimirSampledState = { context: Uint8Array.from(context), sourceConfig: options.sourceConfig, planHash: options.planHash,
    records, physical, nextIndex, sequence, close: input, depthFloor: floor,
    bandLimitBps: options.bandLimitBps ?? previous?.bandLimitBps ?? o.maxBandBps,
    closeLimitBps: options.closeLimitBps ?? previous?.closeLimitBps ?? o.maxCloseDeviationBps };
  summarizeMimirSampledState(state);
  return { state, action };
}

type ExecutableShell = Readonly<{ address: string; executable: boolean; data: Uint8Array }>;
/** Loader-v3 generation: Program(tag2)->ProgramData(tag3), any deployment slot. */
export function verifyMimirSampledExecutableGeneration(adapter: Readonly<{ program: string; programData: string }>,
  program: ExecutableShell, programData: ExecutableShell): boolean {
  return program.address === adapter.program && program.executable && program.data.length === 36 && readUint(program.data, 0, 4) === 2n &&
    programData.address === adapter.programData && !programData.executable && programData.data.length >= 45 &&
    readUint(programData.data, 0, 4) === 3n &&
    equal(program.data.subarray(4, 36), getAddressEncoder().encode(address(adapter.programData)) as Uint8Array);
}

export type MimirSampledReadinessStatus = "ready" | "warming" | "quality-hold" | "history-reset-required";
export interface MimirSampledReadiness {
  readonly status: MimirSampledReadinessStatus;
  readonly acceptedCount: number; readonly requiredCount: number;
  readonly spanSeconds: bigint; readonly requiredSpanSeconds: bigint;
  readonly nextEligibleUnixTs: bigint; readonly secondsUntilNextEligible: bigint;
  readonly observationsRemaining: number; readonly spanSecondsRemaining: bigint;
  readonly depthFloorQuoteNative: bigint;
}

/** Caller-facing warming projection. A gap above 15 s from the last accepted record forces a one-record restart. */
export function projectMimirSampledReadiness(state: MimirSampledState, clockUnixTs: bigint): MimirSampledReadiness {
  const o = MIMIR_SAMPLED_TEMPORAL_MODULE_V4, summary = summarizeMimirSampledState(state);
  const lapsed = clockUnixTs - state.records.at(-1)!.unixTs > o.maxGapSeconds;
  const status: MimirSampledReadinessStatus = lapsed ? "history-reset-required" : summary.ready ? "ready" :
    summary.temporalReady ? "quality-hold" : "warming";
  const wait = summary.nextEligibleUnixTs - clockUnixTs;
  return { status, acceptedCount: summary.acceptedCount, requiredCount: o.minimumRecords, spanSeconds: summary.supportSeconds,
    requiredSpanSeconds: o.minimumSpanSeconds, nextEligibleUnixTs: summary.nextEligibleUnixTs,
    secondsUntilNextEligible: wait > 0n ? wait : 0n,
    observationsRemaining: lapsed ? o.minimumRecords : Math.max(0, o.minimumRecords - summary.acceptedCount),
    spanSecondsRemaining: lapsed ? o.minimumSpanSeconds :
      summary.supportSeconds >= o.minimumSpanSeconds ? 0n : o.minimumSpanSeconds - summary.supportSeconds,
    depthFloorQuoteNative: state.depthFloor };
}

/** Projection before the first accepted record: a kind-9 feed activates warming and publishes once ready. */
export function initialMimirSampledReadiness(): MimirSampledReadiness {
  const o = MIMIR_SAMPLED_TEMPORAL_MODULE_V4;
  return { status: "warming", acceptedCount: 0, requiredCount: o.minimumRecords, spanSeconds: 0n,
    requiredSpanSeconds: o.minimumSpanSeconds, nextEligibleUnixTs: 0n, secondsUntilNextEligible: 0n,
    observationsRemaining: o.minimumRecords, spanSecondsRemaining: o.minimumSpanSeconds, depthFloorQuoteNative: 0n };
}

export interface MimirSampledDexRole { readonly ordinal: number; readonly key: Uint8Array }
export function computeMimirSampledContextHash(input: Readonly<{
  mimirProgram: Uint8Array; sourceConfig: Uint8Array; sourceConfigData: Uint8Array; feedConfig: Uint8Array; feedConfigData: Uint8Array;
  plan: Uint8Array; planData: Uint8Array; registry: Uint8Array; registryData: Uint8Array; ring: Uint8Array; module: Uint8Array;
  dexProgram: Uint8Array; programData: Uint8Array; deploymentSlot: bigint; poolBaseIsSourceBase: boolean;
  dexRoles: readonly MimirSampledDexRole[];
}>): Readonly<{ preimage: Uint8Array; hash: Uint8Array }> {
  const preimage = concat([utf8("MIMIR_SAMPLED_CONTEXT_V1"), input.mimirProgram, input.sourceConfig, blob(input.sourceConfigData),
    input.feedConfig, blob(input.feedConfigData), input.plan, blob(input.planData), input.registry, blob(input.registryData),
    input.ring, input.module, input.dexProgram, input.programData, u(input.deploymentSlot, 8),
    Uint8Array.of(input.poolBaseIsSourceBase ? 1 : 0, 1), roleCount(input.dexRoles),
    ...orderedRoles(input.dexRoles).flatMap(role => [Uint8Array.of(role.ordinal), key32(role.key)])]);
  return { preimage, hash: sha256(preimage) };
}

export function computeMimirSampledObservationHash(input: Readonly<{
  context: Uint8Array;
  dexRoles: readonly (MimirSampledDexRole & Readonly<{ owner: Uint8Array; executable: boolean; data: Uint8Array }>)[];
  baseDecimals: number; quoteDecimals: number; direction: number; poolBaseIsSourceBase: boolean;
  priceX64: bigint; depthNative: bigint; liquidityNative: bigint;
}>): Readonly<{ preimage: Uint8Array; hash: Uint8Array }> {
  const preimage = concat([utf8("MIMIR_SAMPLED_POINT_V1"), key32(input.context), roleCount(input.dexRoles),
    ...orderedRoles(input.dexRoles).flatMap(role => [Uint8Array.of(role.ordinal), key32(role.key), key32(role.owner),
      Uint8Array.of(role.executable ? 1 : 0), blob(role.executable ? new Uint8Array(0) : role.data)]),
    Uint8Array.of(input.baseDecimals, input.quoteDecimals, input.direction, input.poolBaseIsSourceBase ? 1 : 0),
    u(input.priceX64, 16), u(input.depthNative, 16), u(input.liquidityNative, 16)]);
  return { preimage, hash: sha256(preimage) };
}

/** Structural source6 snapshot check: model hash, SafetyOnly/Unrated tiers and zero certified economics. DEGRADED rows return liveness metadata only. */
export function decodeMimirSampledSource6Snapshot(data: Uint8Array): Readonly<{ status: "fresh";
  meanX64: bigint; lowerX64: bigint; upperX64: bigint; confidenceBps: number; dispersionBps: number; effectiveSourceCount: number;
}> | Readonly<{ status: "degraded" } & MimirDegradedSnapshot> {
  if (data.length === 512 && data[104] === 1 && data[107] === 6) return { status: "degraded", ...validateDegradedSnapshot(data) };
  const zero = (at: number, n: number) => data.subarray(at, at + n).every(x => x === 0);
  if (data.length !== 512 || !equal(data.subarray(0, 8), utf8("MIMIRSNP")) || data[107] !== 6 || data[104] !== 0 || data[105] !== 4 ||
      data[106] !== 0 || data[429] === 0 || !frontierOk(data) || !zero(302, 32) || !zero(420, 9) || !zero(430, 26) || !zero(504, 8) ||
      !equal(data.subarray(472, 504), MIMIR_SAMPLED_INTERVAL_MODEL_HASH)) throw new Error("InvalidSampledSource6Snapshot");
  const meanX64 = readUint(data, 200, 16), lowerX64 = readUint(data, 216, 16), upperX64 = readUint(data, 232, 16);
  if (lowerX64 <= 0n || lowerX64 > meanX64 || meanX64 > upperX64) throw new Error("InvalidSampledSource6Snapshot");
  return { status: "fresh", meanX64, lowerX64, upperX64, confidenceBps: Number(readUint(data, 248, 2)), dispersionBps: Number(readUint(data, 250, 2)),
    effectiveSourceCount: data[429]! };
}

const frontierOk = (data: Uint8Array) => { try { validateFrontier(data); return true; } catch { return false; } };

function orderedRoles<T extends MimirSampledDexRole>(roles: readonly T[]): readonly T[] {
  check(roles.every((role, index) => Number.isInteger(role.ordinal) && role.ordinal >= 6 && role.ordinal <= 255 &&
    (index === 0 || role.ordinal > roles[index - 1]!.ordinal)), "INVALID_CONTEXT");
  return roles;
}
function roleCount(roles: readonly unknown[]) { check(roles.length <= 255, "INVALID_CONTEXT"); return Uint8Array.of(roles.length); }
function key32(key: Uint8Array) { check(key.length === 32, "INVALID_CONTEXT"); return key; }
function utf8(value: string) { return new TextEncoder().encode(value); }
function blob(data: Uint8Array) { return concat([u(BigInt(data.length), 4), data]); }
function u(value: bigint, size: number) { const out = new Uint8Array(size); putUint(out, 0, value, size); return out; }
function putUint(out: Uint8Array, at: number, value: bigint, size: number) {
  let x = uint(value, size * 8);
  for (let i = 0; i < size; i++) { out[at + i] = Number(x & 0xffn); x >>= 8n; }
}
function readUint(data: Uint8Array, at: number, size: number) {
  let value = 0n;
  for (let i = size - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[at + i]!);
  return value;
}
function equal(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((x, i) => x === b[i]); }
function concat(parts: readonly Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
