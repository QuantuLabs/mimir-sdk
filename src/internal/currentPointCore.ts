import { sha256 } from "@noble/hashes/sha256";
import { validateDegradedSnapshot, type MimirDegradedSnapshot } from "../liveness.js";
import { computeMimirSampledContextHash, computeMimirSampledObservationHash,
  MimirSampledTemporalError } from "./sampledTemporalCore.js";

export type MimirTemporalMode = "sampled-interval" | "current-point";
export const MIMIR_SOURCE_FLAG_CURRENT_POINT = 1;
export const MIMIR_CURRENT_POINT_MODULE = Object.freeze({
  magic: "MTP4", moduleVersion: 4, length: 1280, kind: 10, capacity: 16, count: 1, nextIndex: 1, policy: 2,
  flagsReady: 5, recordsOffset: 256, recordLen: 64,
} as const);
export const MIMIR_CURRENT_POINT_PROOF_KIND = 10;
export const MIMIR_CURRENT_POINT_SNAPSHOT_SOURCE_KIND = 7;
export const MIMIR_CURRENT_POINT_MODEL_HASH = sha256(utf8("MIMIR_CURRENT_POINT_UNCERTIFIED_V1"));
export const MIMIR_CURRENT_POINT_READY = "CURRENT_POINT_READY" as const;
export const MIMIR_CURRENT_POINT_POSITION_CAP_USDC6 = 250_000_000n;
export const MIMIR_CURRENT_POINT_SHARED_CAP_USDC6 = 1_000_000_000n;
export const MIMIR_CURRENT_POINT_RECOMMENDED_POSITION_USDC6 = 1_000_000n;
const check = (ok: boolean, code: ConstructorParameters<typeof MimirSampledTemporalError>[0]): void => {
  if (!ok) throw new MimirSampledTemporalError(code);
};

/** Point mode is admitted only for AMMv4 (adapter 4, v0), PumpSwap (adapter 6, v0/v1) and Meteora DLMM (adapter 3, v0/v1). */
export function mimirCurrentPointAdmitted(adapterType: number, adapterVersion: number): boolean {
  return (adapterType === 4 && adapterVersion === 0) ||
    ((adapterType === 6 || adapterType === 3) && (adapterVersion === 0 || adapterVersion === 1));
}

export function mimirTemporalModeFromSourceFlags(flags: number, adapterType: number, adapterVersion: number): MimirTemporalMode {
  if (flags === 0) return "sampled-interval";
  if (flags === MIMIR_SOURCE_FLAG_CURRENT_POINT && mimirCurrentPointAdmitted(adapterType, adapterVersion)) return "current-point";
  throw new Error("InvalidSourceConfig");
}

export function mimirSourceFlagsFromTemporalMode(mode: MimirTemporalMode | undefined, adapterType: number, adapterVersion: number): number {
  if (mode === undefined || mode === "sampled-interval") return 0;
  if (mode === "current-point" && mimirCurrentPointAdmitted(adapterType, adapterVersion)) return MIMIR_SOURCE_FLAG_CURRENT_POINT;
  throw new Error("InvalidSourceConfig");
}

export function packMimirCompactDirection(direction: number, mode: MimirTemporalMode | undefined): number {
  if (direction !== 0 && direction !== 1) throw new Error("InvalidSourceConfig");
  return direction | (mode === "current-point" ? 0x80 : 0);
}

export function unpackMimirCompactDirection(byte: number): Readonly<{ direction: 0 | 1; temporalMode: MimirTemporalMode }> {
  if (!Number.isInteger(byte) || byte < 0 || byte > 255 || (byte & 0x7e) !== 0) throw new Error("InvalidSourceConfig");
  return { direction: (byte & 1) as 0 | 1, temporalMode: byte & 0x80 ? "current-point" : "sampled-interval" };
}

/** Point leaf over the exact legacy `source_config_leaf_v1` material (no domain prefix). */
export function computeMimirCurrentPointSourceLeaf(legacyMaterial: Uint8Array): Uint8Array {
  check(legacyMaterial.length === 362, "INVALID_CONTEXT");
  return sha256(concat([utf8("MIMIR_SOURCE_CONFIG_POINT_V1"), legacyMaterial, u(1n, 4)]));
}

export interface MimirCurrentPointRecord {
  readonly slot: bigint; readonly unixTs: bigint; readonly priceX64: bigint; readonly fingerprint: Uint8Array;
}
export interface MimirCurrentPointState {
  readonly context: Uint8Array; readonly sourceConfig: Uint8Array; readonly planHash: Uint8Array;
  readonly sequence: bigint; readonly record: MimirCurrentPointRecord;
}
export type MimirCurrentPointTransitionAction = "INITIALIZE" | "ADVANCE" | "CONTEXT_RESET" | "NOOP";

export function encodeMimirCurrentPointRecord(record: MimirCurrentPointRecord): Uint8Array {
  check(record.slot > 0n && record.slot < 1n << 64n, "INVALID_SLOT");
  check(record.unixTs >= 0n && record.unixTs < 1n << 63n, "CLOCK_REGRESSION");
  check(record.priceX64 > 0n, "ZERO_PRICE");
  check(record.priceX64 + 1n < 1n << 128n, "ARITHMETIC_OVERFLOW");
  check(record.fingerprint.length === 32, "INVALID_POINT");
  const out = new Uint8Array(64);
  putUint(out, 0, record.slot, 8); putUint(out, 8, record.unixTs, 8); putUint(out, 16, record.priceX64, 16); out.set(record.fingerprint, 32);
  return out;
}

export function computeMimirCurrentPointRecordDigest(state: Pick<MimirCurrentPointState, "context" | "sequence" | "record">): Uint8Array {
  check(state.context.length === 32, "INVALID_CONTEXT");
  return sha256(concat([utf8("MIMIR_CURRENT_POINT_RECORD_V1"), state.context, u(state.sequence, 8), encodeMimirCurrentPointRecord(state.record)]));
}

export function encodeMimirCurrentPointModule(state: MimirCurrentPointState): Uint8Array {
  const o = MIMIR_CURRENT_POINT_MODULE, r = state.record, out = new Uint8Array(o.length);
  check(state.sourceConfig.length === 32 && state.planHash.length === 32, "INVALID_CONTEXT");
  check(state.sequence > 0n && state.sequence < 1n << 64n, "INVALID_SEQUENCE");
  check(state.context.length === 32 && [state.context, state.sourceConfig, state.planHash, r.fingerprint].every(id => id.some(Boolean)), "INVALID_IDENTITY");
  out.set(utf8(o.magic)); putUint(out, 4, 4n, 2); putUint(out, 6, 1280n, 2); putUint(out, 8, r.slot, 8);
  putUint(out, 16, 10n, 2); putUint(out, 18, 5n, 2); out.set([16, 1, 1, 2], 20);
  out.set(state.context, 24); putUint(out, 56, r.unixTs, 8); out.set(state.sourceConfig, 64); out.set(state.planHash, 96);
  putUint(out, 128, state.sequence, 8);
  for (const at of [136, 152]) { putUint(out, at, r.slot, 8); putUint(out, at + 8, r.unixTs, 8); }
  putUint(out, 168, r.priceX64, 16); putUint(out, 184, r.priceX64, 16); putUint(out, 200, r.priceX64 + 1n, 16);
  out.set(computeMimirCurrentPointRecordDigest(state), 224); out.set(encodeMimirCurrentPointRecord(r), o.recordsOffset);
  return out;
}

export function decodeMimirCurrentPointModule(raw: Uint8Array): MimirCurrentPointState {
  const o = MIMIR_CURRENT_POINT_MODULE;
  check(raw.length === o.length && equal(raw.subarray(0, 4), utf8(o.magic)) && readUint(raw, 4, 2) === 4n && readUint(raw, 6, 2) === 1280n &&
    readUint(raw, 16, 2) === 10n && readUint(raw, 18, 2) === 5n && raw[20] === 16 && raw[21] === 1 && raw[22] === 1 && raw[23] === 2,
  "INVALID_MODULE_HEADER");
  const rec = raw.subarray(256, 320);
  const record = { slot: readUint(rec, 0, 8), unixTs: readUint(rec, 8, 8), priceX64: readUint(rec, 16, 16), fingerprint: rec.slice(32, 64) };
  const state: MimirCurrentPointState = { context: raw.slice(24, 56), sourceConfig: raw.slice(64, 96), planHash: raw.slice(96, 128),
    sequence: readUint(raw, 128, 8), record };
  check(state.sequence > 0n, "INVALID_SEQUENCE");
  check(equal(encodeMimirCurrentPointModule(state), raw), "MODULE_SUMMARY_OR_DIGEST_MISMATCH");
  return state;
}

export interface MimirCurrentPointReadiness {
  readonly status: typeof MIMIR_CURRENT_POINT_READY; readonly ready: true; readonly historySeconds: 0n;
  readonly slot: bigint; readonly unixTs: bigint; readonly ageSeconds: bigint; readonly priceX64: bigint;
  readonly lowerX64: bigint; readonly upperX64: bigint;
}

/** A valid point module is ready after one record; the interval is fixed-point rounding only, never a history bound. */
export function projectMimirCurrentPointReadiness(state: MimirCurrentPointState, clockUnixTs: bigint): MimirCurrentPointReadiness {
  const r = state.record, age = clockUnixTs - r.unixTs;
  encodeMimirCurrentPointRecord(r);
  return { status: MIMIR_CURRENT_POINT_READY, ready: true, historySeconds: 0n, slot: r.slot, unixTs: r.unixTs,
    ageSeconds: age > 0n ? age : 0n, priceX64: r.priceX64, lowerX64: r.priceX64, upperX64: r.priceX64 + 1n };
}

/** Offline mirror of the point transition (minSlotGap 0, sequence advances on any changed record). */
export function applyMimirCurrentPointObservation(previous: MimirCurrentPointState | null, input: Readonly<{
  record: MimirCurrentPointRecord; observedDepthNative: bigint; observedLiquidityNative: bigint }>, context: Uint8Array, options: Readonly<{
  sourceConfig: Uint8Array; planHash: Uint8Array; sourceDepthFloor: bigint; sourceMinLiquidity: bigint; expectedPrevSlot?: bigint;
  existingRingSlot?: bigint; existingRingPriceX64?: bigint; existingRingFingerprint?: Uint8Array;
}>): Readonly<{ state: MimirCurrentPointState; action: MimirCurrentPointTransitionAction }> {
  encodeMimirCurrentPointRecord(input.record);
  check(context.length === 32, "INVALID_CONTEXT");
  check(options.sourceDepthFloor > 0n && input.observedDepthNative >= options.sourceDepthFloor, "SOURCE_DEPTH_FLOOR");
  check(input.observedLiquidityNative >= options.sourceMinLiquidity, "SOURCE_DEPTH_FLOOR");
  const head = options.existingRingSlot ?? previous?.record.slot ?? 0n;
  check(previous === null || head === previous.record.slot, "RING_MODULE_HEAD_MISMATCH");
  check(previous === null || ((options.existingRingPriceX64 ?? previous.record.priceX64) === previous.record.priceX64 &&
    equal(options.existingRingFingerprint ?? previous.record.fingerprint, previous.record.fingerprint)), "RING_MODULE_HEAD_MISMATCH");
  check(input.record.slot >= head, "CLOCK_REGRESSION");
  check((options.expectedPrevSlot ?? 0n) === 0n || options.expectedPrevSlot === head, "STALE_CAS");
  const sameContext = previous !== null && equal(previous.context, context);
  if (previous && sameContext) {
    check(input.record.unixTs >= previous.record.unixTs, "CLOCK_REGRESSION");
    if (equal(encodeMimirCurrentPointRecord(input.record), encodeMimirCurrentPointRecord(previous.record))) return { state: previous, action: "NOOP" };
  }
  const sequence = sameContext ? previous!.sequence + 1n : 1n;
  check(sequence < 1n << 64n, "ARITHMETIC_OVERFLOW");
  const state = { context: Uint8Array.from(context), sourceConfig: options.sourceConfig, planHash: options.planHash, sequence, record: input.record };
  encodeMimirCurrentPointModule(state);
  return { state, action: !previous ? "INITIALIZE" : sameContext ? "ADVANCE" : "CONTEXT_RESET" };
}

/** Context serialization with the point domain and policy byte 2. */
export function computeMimirCurrentPointContextHash(input: Parameters<typeof computeMimirSampledContextHash>[0]): Readonly<{ preimage: Uint8Array; hash: Uint8Array }> {
  const sampled = computeMimirSampledContextHash(input).preimage;
  const body = sampled.slice(utf8("MIMIR_SAMPLED_CONTEXT_V1").length);
  const policyAt = 32 * 9 + 4 * 4 + input.sourceConfigData.length + input.feedConfigData.length + input.planData.length +
    input.registryData.length + 8 + 1;
  check(body[policyAt] === 1, "INVALID_CONTEXT");
  body[policyAt] = 2;
  const preimage = concat([utf8("MIMIR_CURRENT_POINT_CONTEXT_V1"), body]);
  return { preimage, hash: sha256(preimage) };
}

export function computeMimirCurrentPointFingerprint(input: Parameters<typeof computeMimirSampledObservationHash>[0]): Readonly<{ preimage: Uint8Array; hash: Uint8Array }> {
  const body = computeMimirSampledObservationHash(input).preimage.slice(utf8("MIMIR_SAMPLED_POINT_V1").length);
  const preimage = concat([utf8("MIMIR_CURRENT_POINT_STATE_V1"), body]);
  return { preimage, hash: sha256(preimage) };
}

/** Structural source-7 snapshot check; source-6/certified readers must reject this row. DEGRADED rows return liveness metadata only. */
export function decodeMimirCurrentPointSource7Snapshot(data: Uint8Array): Readonly<{ status: "fresh";
  priceX64: bigint; lowerX64: bigint; upperX64: bigint; dispersionBps: number; effectiveSourceCount: number; floorBudgetNative: bigint;
}> | Readonly<{ status: "degraded" } & MimirDegradedSnapshot> {
  if (data.length === 512 && data[104] === 1 && data[107] === 7) return { status: "degraded", ...validateDegradedSnapshot(data) };
  const zero = (at: number, n: number) => data.subarray(at, at + n).every(x => x === 0);
  if (data.length !== 512 || !equal(data.subarray(0, 8), utf8("MIMIRSNP")) || data[107] !== 7 || data[104] !== 0 || data[105] !== 4 ||
      data[106] !== 0 || data[429] === 0 || !zero(156, 32) || !zero(302, 32) || data[420] !== 2 || !zero(421, 8) || !zero(430, 26) || !zero(504, 8) ||
      !equal(data.subarray(472, 504), MIMIR_CURRENT_POINT_MODEL_HASH)) throw new Error("InvalidCurrentPointSource7Snapshot");
  const priceX64 = readUint(data, 200, 16), lowerX64 = readUint(data, 216, 16), upperX64 = readUint(data, 232, 16);
  if (lowerX64 <= 0n || lowerX64 > priceX64 || priceX64 > upperX64) throw new Error("InvalidCurrentPointSource7Snapshot");
  return { status: "fresh", priceX64, lowerX64, upperX64, dispersionBps: Number(readUint(data, 250, 2)), effectiveSourceCount: data[429]!,
    floorBudgetNative: readUint(data, 456, 16) };
}

/** F* = min committed F over the whole configured cohort, retained or filtered. */
export function mimirCurrentPointFloorBudget(sourceFloorsNative: readonly bigint[]): bigint {
  if (sourceFloorsNative.length < 1 || sourceFloorsNative.some(f => f < 1n)) throw new Error("InvalidSourceConfig");
  return sourceFloorsNative.reduce((a, b) => a < b ? a : b);
}

export interface MimirCurrentPointCaps { readonly floorUsdc6: bigint; readonly positionUsdc6: bigint; readonly sharedUsdc6: bigint;
  readonly newMarketMinimumUsdc6: bigint | null }
/** PointBounded(F*) caps. A non-USDC6 quote needs the authenticated strong converter's lower Q64 price (quote->USDC). */
export function mimirCurrentPointCaps(args: Readonly<{ floorNative: bigint; quoteDecimals: number; quoteToUsdcLowerX64?: bigint }>): MimirCurrentPointCaps {
  if (args.floorNative < 0n || !Number.isInteger(args.quoteDecimals) || args.quoteDecimals < 0 || args.quoteDecimals > 38) throw new Error("InvalidArgument");
  const floorUsdc6 = args.quoteToUsdcLowerX64 === undefined
    ? (args.quoteDecimals === 6 ? args.floorNative : (() => { throw new Error("CurrentPointQuoteConverterRequired"); })())
    : args.floorNative * args.quoteToUsdcLowerX64 * 1_000_000n / (10n ** BigInt(args.quoteDecimals) << 64n);
  const min = (a: bigint, b: bigint) => a < b ? a : b;
  const positionUsdc6 = min(floorUsdc6 / 10n, MIMIR_CURRENT_POINT_POSITION_CAP_USDC6);
  const sharedUsdc6 = min(floorUsdc6 / 4n, MIMIR_CURRENT_POINT_SHARED_CAP_USDC6);
  return { floorUsdc6, positionUsdc6, sharedUsdc6,
    newMarketMinimumUsdc6: positionUsdc6 > 0n ? min(MIMIR_CURRENT_POINT_RECOMMENDED_POSITION_USDC6, positionUsdc6) : null };
}

function utf8(value: string) { return new TextEncoder().encode(value); }
function u(value: bigint, size: number) { const out = new Uint8Array(size); putUint(out, 0, value, size); return out; }
function putUint(out: Uint8Array, at: number, value: bigint, size: number) {
  let x = value;
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
