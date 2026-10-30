import type { Address } from "@solana/kit";
import { decodeFeedConfigHeader, decodeSourcingPlanHeader } from "../internal/nativeMonoRefreshCore.js";
import { deriveMimirBetaPda } from "./abi.js";
import { addressBytes, bytesAddress, bytesEqual, concatBytes, isZeroBytes, sha256, utf8 } from "./bytes.js";
import {
  MIMIR_FUSED_TEMPORAL_MODULE_LENGTH, MIMIR_INSTRUCTIONS_SYSVAR_ID, assertMimirSealedRow, buildMimirInitFusedClosure, checkVectors, decodeMimirFusedDescriptor,
  mimirSealedFeedPlan,
  deriveMimirFusedRecipe, encodeMimirFusedDescriptor, meta, mimirFusedRowExternals, ro,
  type MimirFusedRowSource,
  type MimirFusedDescriptor, type MimirFusedRecipe, type MimirInitSourceWitness, type MimirMembershipRecord,
} from "./compositeExecution.js";
import { MIMIR_BETA_SYSTEM_PROGRAM_ID } from "./deployment.js";
import { betaError } from "./errors.js";
import { decodeMimirBetaLiveFeed, decodeMimirBetaLivePlanFields, decodeMimirBetaLiveSource } from "./liveAbi.js";
import type { MimirBetaInstruction } from "./types.js";

/** A2 fused classic publication: tag 89 sample/publish, tag 90 BEGIN/GROW/SEAL. Tags 59/60/77/82/83 are deleted and never reused. */
export const MIMIR_FUSED_CLASSIC_TAG = 89;
export const MIMIR_INIT_FUSED_CLASSIC_TAG = 90;
export const MIMIR_DELETED_CLASSIC_TAGS = Object.freeze([59, 60, 77, 82, 83] as const);

export const MIMIR_CLASSIC_EXECUTION = Object.freeze({
  seed: "classic_execution", magic: "MIMIRCLX", version: 1, headerLength: 384, proofOffset: 128, proofLength: 256, proofMagic: "MIMIRCPR",
  evidenceLength: 80, feedConfigOffset: 384, planOffset: 741, mirrorOffset: 1_061, rowsOffset: 1_573, feedConfigLength: 357, planLength: 320,
  snapshotLength: 512, rowLength: 944, sourceConfigLength: 384, ringLength: 544, converterFixedLength: 1_829, converterTwapLength: 640,
  reallocGrowth: 10_240, digestDomain: "MIMIR_FUSED_CLASSIC_DEFINITION_V1",
} as const);
const C = MIMIR_CLASSIC_EXECUTION;
const ROW = { descriptor: 0, sourceConfig: 16, ring: 400 } as const;
const CONV = { feedConfig: 0, plan: 357, twap: 677, snapshot: 1_317, rows: 1_829 } as const;
const RING_NEWEST_SLOT = 64;
const PLAN_MIN_SOURCES = 55;
const U64_MAX = (1n << 64n) - 1n;

const reject = (message: string): never => betaError("PROGRAM_ABI_MISMATCH", message);
const isU = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max;
const u64ok = (value: bigint) => typeof value === "bigint" && value >= 0n && value <= U64_MAX;
const dv = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const le = (bytes: 2 | 4 | 8, value: number | bigint) => {
  const out = new Uint8Array(bytes); const v = dv(out);
  if (bytes === 2) v.setUint16(0, Number(value), true); else if (bytes === 4) v.setUint32(0, Number(value), true); else v.setBigUint64(0, BigInt(value), true);
  return out;
};
const feedId32 = (id: Uint8Array, what = "feed id") =>
  id instanceof Uint8Array && id.length === 32 && !isZeroBytes(id) ? id : reject(`InvalidInstruction: classic ${what}`);

/** Converter recipes the scalar converter math publishes (R12): DLMM-native v0 (E7/E9) and CLMM-native v0 (E8). */
export const MIMIR_CLASSIC_ADMITTED_CONVERTER_RECIPES: readonly Readonly<{ adapterType: number; adapterVersion: number; mode: number }>[] =
  Object.freeze([Object.freeze({ adapterType: 3, adapterVersion: 0, mode: 2 }), Object.freeze({ adapterType: 1, adapterVersion: 0, mode: 2 })]);

export function assertMimirClassicConverterAdmitted(converter: readonly Pick<MimirFusedRecipe, "adapterType" | "adapterVersion" | "mode">[]): void {
  for (const r of converter) {
    if (!MIMIR_CLASSIC_ADMITTED_CONVERTER_RECIPES.some((a) => a.adapterType === r.adapterType && a.adapterVersion === r.adapterVersion && a.mode === r.mode)) {
      betaError("CLASSIC_CONVERTER_UNSUPPORTED", `converter recipe (adapter ${r.adapterType} v${r.adapterVersion} mode ${r.mode}) is not consumable by the scalar converter math`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// §5 recipes. One admitted table (the P1/A1 family matrix); classic only adds the primary/converter role rule.

/**
 * Admitted classic recipe. Primary rows take every §5 family/mode, including point mode 5. Converter rows must be
 * duration-bearing (native bounded, quiet/interval, sampled): spot and point have no authenticated converter duration.
 */
export function deriveMimirClassicRecipe(args: Readonly<{
  role: "primary" | "converter"; adapterType: number; adapterVersion: number; externalWidth: number;
  temporalModuleVersion?: number; currentPoint?: boolean; minSlotGap: number; accountsBindingVersion?: number; dual?: boolean;
}>): MimirFusedRecipe {
  const { role, ...rest } = args;
  const recipe = deriveMimirFusedRecipe({ accountsBindingVersion: 1, ...rest, role: "converter", pointOk: role === "primary" });
  if (role === "converter" && ![2, 3, 4].includes(recipe.mode)) {
    return reject(`UnsupportedClassicExecutionRecipe: converter row must be duration-bearing (mode ${recipe.mode})`);
  }
  return recipe;
}

/** One classic row from a source's canonical binding: admitted recipe, witness and live external vector. */
export function mimirClassicRow(a: MimirFusedRowSource & Readonly<{ role: "primary" | "converter"; dual?: boolean }>):
  Readonly<{ recipe: MimirFusedRecipe; witness: MimirInitSourceWitness; sourceConfig: Address; externals: readonly Address[] }> {
  const { externals, temporalModuleVersion } = mimirFusedRowExternals(a);
  return { recipe: deriveMimirClassicRecipe({ role: a.role, adapterType: a.adapterType, adapterVersion: a.adapterVersion, externalWidth: externals.length,
    ...(temporalModuleVersion !== undefined ? { temporalModuleVersion } : {}), currentPoint: a.currentPoint, minSlotGap: a.witness.minSlotGap,
    ...(a.accountsBindingVersion !== undefined ? { accountsBindingVersion: a.accountsBindingVersion } : {}), ...(a.dual ? { dual: true } : {}) }),
    witness: a.witness, sourceConfig: a.sourceConfig, externals };
}

const TEMPORAL_MODULE_VERSION: Readonly<Record<number, number | undefined>> = { 0: undefined, 1: 2, 2: 1, 3: 3, 4: 4, 5: 4, 6: undefined };

/** A sealed descriptor must be exactly the admitted recipe for its own family/version/E/module/role. */
export function assertMimirClassicDescriptorAdmitted(d: MimirFusedDescriptor, role: "primary" | "converter"): void {
  const tm = TEMPORAL_MODULE_VERSION[d.temporalKind];
  let r: MimirFusedRecipe | undefined;
  try {
    r = deriveMimirClassicRecipe({ role, adapterType: d.adapterType, adapterVersion: d.adapterVersion, externalWidth: d.externalWidth,
      ...(tm !== undefined ? { temporalModuleVersion: tm } : {}), currentPoint: d.mode === 5, minSlotGap: d.minSlotGap, accountsBindingVersion: d.accountsBindingVersion,
      ...(d.temporalKind === 6 ? { dual: true } : {}) });
  } catch { r = undefined; }
  if (!r || r.mode !== d.mode || r.temporalKind !== d.temporalKind || r.bindingWidth !== d.bindingWidth ||
      r.requiresInstructionsSysvar !== d.requiresInstructionsSysvar || r.accountsBindingVersion !== d.accountsBindingVersion) {
    reject(`InvalidClassicExecution: ${role} row recipe`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// §2 layout and geometry.

export interface MimirClassicExecutionLayout {
  readonly componentCount: number;
  readonly converterSourceCount: number;
  readonly rowOffsets: readonly number[];
  readonly converterOffset: number | null;
  readonly rowsEnd: number;
  readonly membershipOffsets: readonly number[];
  readonly modulesOffset: number;
  readonly descriptors: readonly MimirFusedDescriptor[];
  readonly exactLength: number;
  readonly growCount: number;
}

/** Exact §2.4 layout from primary-then-converter recipes; assigns packed module offsets in row order. */
export function mimirClassicExecutionLayout(primary: readonly MimirFusedRecipe[], converter: readonly MimirFusedRecipe[]): MimirClassicExecutionLayout {
  const n = primary.length; const s = converter.length;
  if (n < 1 || n > 5 || s > 5) return reject("InvalidClassicExecution: N must be 1..5 and S 0..5");
  const rows = [...primary, ...converter];
  for (const r of rows) if (!isU(r.bindingWidth, 7) || r.bindingWidth < 1 || r.accountsBindingVersion !== 1) reject("InvalidClassicExecution: binding width");
  const converterOffset = s === 0 ? null : C.rowsOffset + C.rowLength * n;
  const rowOffsets = [...Array.from({ length: n }, (_, i) => C.rowsOffset + C.rowLength * i),
    ...Array.from({ length: s }, (_, j) => converterOffset! + CONV.rows + C.rowLength * j)];
  const rowsEnd = converterOffset === null ? C.rowsOffset + C.rowLength * n : converterOffset + C.converterFixedLength + C.rowLength * s;
  const membershipOffsets: number[] = []; let cursor = rowsEnd;
  for (const r of rows) { membershipOffsets.push(cursor); cursor += 4 + 65 * r.bindingWidth; }
  const modulesOffset = cursor;
  const descriptors = rows.map((r) => {
    const moduleLength = MIMIR_FUSED_TEMPORAL_MODULE_LENGTH[r.temporalKind];
    const d = { ...r, moduleOffset: moduleLength ? cursor : 0, moduleLength };
    cursor += moduleLength; return d;
  });
  return { componentCount: n, converterSourceCount: s, rowOffsets, converterOffset, rowsEnd, membershipOffsets, modulesOffset, descriptors,
    exactLength: cursor, growCount: Math.ceil(cursor / C.reallocGrowth) - 1 };
}

/** Byte ranges tag 89 may write: proof, mirror, private rings, converter TWAP+snapshot, private modules. Everything else is sealed. */
export function mimirClassicExecutionMutableRegions(layout: MimirClassicExecutionLayout): readonly (readonly [number, number])[] {
  return [
    [C.proofOffset, C.proofOffset + C.proofLength],
    [C.mirrorOffset, C.mirrorOffset + C.snapshotLength],
    ...layout.rowOffsets.map((o) => [o + ROW.ring, o + ROW.ring + C.ringLength] as const),
    ...(layout.converterOffset === null ? [] : [[layout.converterOffset + CONV.twap, layout.converterOffset + CONV.rows] as const]),
    ...layout.descriptors.filter((d) => d.moduleLength).map((d) => [d.moduleOffset, d.moduleOffset + d.moduleLength] as const),
  ];
}

export async function deriveMimirClassicExecutionAddress(programId: Address, feedId: Uint8Array): Promise<readonly [Address, number]> {
  return deriveMimirBetaPda({ programId, seed: C.seed, values: [feedId32(feedId)] });
}

/**
 * R7 creation admission: `1 <= Q <= N` (default `Q = N`, mixed-bounded publication). `Q < N` needs every primary row
 * quorum-capable (READY windows carry AUTHENTICATED_DURATION without NATIVE_BOUNDED): today only DLMM native (adapter 3, v0/v1, mode 2).
 */
export function mimirClassicMinSources(primary: readonly Pick<MimirFusedRecipe, "adapterType" | "adapterVersion" | "mode">[],
  minSources: number = primary.length): number {
  if (!Number.isInteger(minSources) || minSources < 1 || minSources > primary.length) betaError("INVALID_ARGUMENT", "min_sources must be 1..N");
  if (minSources < primary.length && !primary.every((r) => r.adapterType === 3 && (r.adapterVersion === 0 || r.adapterVersion === 1) && r.mode === 2)) {
    betaError("CLASSIC_QUORUM_UNSUPPORTED", "min_sources < source_count requires every primary source recipe to emit AUTHENTICATED_DURATION without NATIVE_BOUNDED");
  }
  return minSources;
}

/**
 * With `Q = N` every row survives into the cohort, one cheapest representative per correlation group at equal weight, and
 * publication needs strictly more than 5000 bps from non-spot (modes 0/1/6) representatives. Refuses sets that never can.
 */
export function assertMimirClassicBoundedMajorityPossible(primary: readonly Pick<MimirFusedRecipe, "mode">[],
  groups: readonly number[], minSources: number): void {
  const spot = (r: Pick<MimirFusedRecipe, "mode">) => r.mode === 0 || r.mode === 1 || r.mode === 6;
  if (minSources < primary.length || primary.every(spot)) return;
  const all = new Set(groups).size;
  const bounded = new Set(groups.filter((_, i) => !spot(primary[i]!))).size;
  const share = Math.floor(10_000 / all);
  const maxBps = bounded * share + Math.min(bounded, 10_000 - share * all);
  if (maxBps <= 5_000) {
    betaError("CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT", `this source composition supplies at most ${maxBps} bps of bounded evidence ` +
      `(${bounded} of ${all} venue groups); more than 5000 bps is required, so it can never publish`);
  }
}

/**
 * The deployed V1 program's `mixed_majority_ok`: with `Q = N`, a set mixing spot (modes 0/1/6) and bounded rows publishes only when
 * every choice of one representative per lifecycle domain gives the bounded rows strictly more than 5000 bps. Sampled or point rows exempt it.
 */
export function assertMimirV1MixedMajorityPossible(primary: readonly Pick<MimirFusedRecipe, "mode">[], domains: readonly number[], minSources: number): void {
  const spot = (r: Pick<MimirFusedRecipe, "mode">) => r.mode === 0 || r.mode === 1 || r.mode === 6;
  if (minSources < primary.length || primary.every(spot) || !primary.some(spot) || primary.some((r) => r.mode === 4 || r.mode === 5)) return;
  const all = new Set(domains).size;
  const bounded = new Set(domains.filter((d) => domains.every((e, j) => e !== d || !spot(primary[j]!)))).size;
  const share = Math.floor(10_000 / all), extra = 10_000 - share * all;
  const minBps = bounded * share + Math.max(0, extra - (all - bounded));
  if (minBps <= 5_000) {
    betaError("CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT", `this source composition can leave bounded evidence at ${minBps} bps ` +
      `(${bounded} of ${all} venue domains are bounded only); more than 5000 bps is required, so the program refuses it`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// §2.3 `ClassicPublicationProofV1` and `EvidenceV1`.

export interface MimirClassicEvidenceV1 {
  readonly declaredWireAge: number; readonly configuredSourceCount: number; readonly publishedK: number; readonly effectiveK: number;
  readonly venueCount: number; readonly correlationDomainCount: number;
  readonly quiet: boolean; readonly sampled: boolean; readonly point: boolean; readonly commonSupport: boolean;
  readonly minRingNewestSlot: bigint; readonly quietLastRefresh: bigint; readonly quietIntervalEnd: bigint; readonly quietIntervalEndSlot: bigint;
  readonly quietWidthBps: number; readonly sampledBandBps: number; readonly sampledCloseDeviationBps: number;
  readonly supportStart: bigint; readonly supportEnd: bigint; readonly nativeFloor: bigint;
}
export const MIMIR_CLASSIC_DUAL_PROFILE = "DUAL_NATIVE_POINT_V1" as const;
const DUAL_MODES = [undefined, "NATIVE", "CURRENT_POINT"] as const;
const DUAL_REASONS = ["NATIVE_QUALIFIED", "NATIVE_ENDPOINT_STALE", "INSUFFICIENT_CONNECTED_HISTORY", "REBUILDING_AFTER_GAP"] as const;
const DUAL_BOUNDS = [undefined, "NATIVE_CERTIFIED", "POINT_DEPTH_UNCERTIFIED"] as const;
/** Proof v2 bytes 248..252 of a `DUAL_NATIVE_POINT_V1` publication: the program's per-publication decision. */
export interface MimirClassicDualDecisionV2 {
  readonly profile: typeof MIMIR_CLASSIC_DUAL_PROFILE;
  readonly effectiveMode: "NATIVE" | "CURRENT_POINT";
  readonly nativeQualificationReason: (typeof DUAL_REASONS)[number];
  readonly appliedBoundKind: "NATIVE_CERTIFIED" | "POINT_DEPTH_UNCERTIFIED";
}
export interface MimirClassicPublicationProofV1 {
  readonly valid: boolean; readonly converterPresent: boolean; readonly snapshotRevision: bigint; readonly publicationSlot: bigint;
  /** Present iff proof version 2 (DUAL feed). */
  readonly dual?: MimirClassicDualDecisionV2;
  readonly primary: MimirClassicEvidenceV1;
  readonly converter: Readonly<{ evidence: MimirClassicEvidenceV1; snapshotRevision: bigint; snapshotSlot: bigint; validUntilSlot: bigint; feedId: Uint8Array }> | null;
}

const U128_MAX = (1n << 128n) - 1n;
/** @internal Shared `EvidenceV1` codec (classic proof and composite `MIMIRCDP` rows). */
export function decodeEvidence(e: Uint8Array): MimirClassicEvidenceV1 {
  const v = dv(e); const f = e[7]!;
  const ev: MimirClassicEvidenceV1 = { declaredWireAge: v.getUint16(0, true), configuredSourceCount: e[2]!, publishedK: e[3]!, effectiveK: e[4]!,
    venueCount: e[5]!, correlationDomainCount: e[6]!, quiet: (f & 1) !== 0, sampled: (f & 2) !== 0, point: (f & 4) !== 0, commonSupport: (f & 8) !== 0,
    minRingNewestSlot: v.getBigUint64(8, true), quietLastRefresh: v.getBigInt64(16, true), quietIntervalEnd: v.getBigInt64(24, true),
    quietIntervalEndSlot: v.getBigUint64(32, true), quietWidthBps: v.getUint16(40, true), sampledBandBps: v.getUint16(42, true),
    sampledCloseDeviationBps: v.getUint16(44, true), supportStart: v.getBigInt64(48, true), supportEnd: v.getBigInt64(56, true),
    nativeFloor: v.getBigUint64(64, true) | (v.getBigUint64(72, true) << 64n) };
  if (f > 15 || e[46] !== 0 || e[47] !== 0) reject("InvalidClassicExecution: evidence reserved bits");
  const u32 = 0xffff_ffffn;
  if (ev.point) {
    if (f !== 4 || !isZeroBytes(e.subarray(16, 64))) reject("InvalidClassicExecution: point evidence carries duration fields");
  } else if (ev.commonSupport) {
    if ((ev.quiet && ev.sampled) || ev.supportStart < 0n || ev.supportStart >= ev.supportEnd || ev.supportEnd > u32) reject("InvalidClassicExecution: support interval");
  } else if (f !== 0 || !isZeroBytes(e.subarray(16, 64))) reject("InvalidClassicExecution: spot evidence carries duration fields");
  if (!ev.quiet && !isZeroBytes(e.subarray(16, 42))) reject("InvalidClassicExecution: quiet fields without quiet bit");
  if (!ev.sampled && !isZeroBytes(e.subarray(42, 46))) reject("InvalidClassicExecution: sampled fields without sampled bit");
  return ev;
}
/** @internal */
export function encodeEvidence(ev: MimirClassicEvidenceV1): Uint8Array {
  const out = new Uint8Array(C.evidenceLength); const v = dv(out);
  if (!isU(ev.declaredWireAge, 0xffff) || !u64ok(ev.minRingNewestSlot) || ev.nativeFloor < 0n || ev.nativeFloor > U128_MAX) reject("InvalidClassicExecution: evidence field");
  v.setUint16(0, ev.declaredWireAge, true);
  out.set([ev.configuredSourceCount, ev.publishedK, ev.effectiveK, ev.venueCount, ev.correlationDomainCount,
    (ev.quiet ? 1 : 0) | (ev.sampled ? 2 : 0) | (ev.point ? 4 : 0) | (ev.commonSupport ? 8 : 0)], 2);
  v.setBigUint64(8, ev.minRingNewestSlot, true); v.setBigInt64(16, ev.quietLastRefresh, true); v.setBigInt64(24, ev.quietIntervalEnd, true);
  v.setBigUint64(32, ev.quietIntervalEndSlot, true); v.setUint16(40, ev.quietWidthBps, true); v.setUint16(42, ev.sampledBandBps, true);
  v.setUint16(44, ev.sampledCloseDeviationBps, true); v.setBigInt64(48, ev.supportStart, true); v.setBigInt64(56, ev.supportEnd, true);
  v.setBigUint64(64, ev.nativeFloor & U64_MAX, true); v.setBigUint64(72, ev.nativeFloor >> 64n, true);
  decodeEvidence(out);
  return out;
}

/** Strict 256-byte proof decoder. An all-zero proof is the unpublished state and decodes to `null`. */
export function decodeMimirClassicPublicationProof(p: Uint8Array): MimirClassicPublicationProofV1 | null {
  if (p.length !== C.proofLength) return reject("InvalidClassicExecution: proof length");
  if (isZeroBytes(p)) return null;
  const v = dv(p); const flags = v.getUint32(12, true); const version = v.getUint16(8, true);
  if (!bytesEqual(p.subarray(0, 8), utf8(C.proofMagic)) || (version !== 1 && version !== 2) || v.getUint16(10, true) !== C.proofLength ||
      flags > 3 || (flags & 1) === 0 || !isZeroBytes(p.subarray(version === 2 ? 252 : 248, 256))) {
    return reject("InvalidClassicExecution: proof header");
  }
  const converterPresent = (flags & 2) !== 0;
  if (!converterPresent && !isZeroBytes(p.subarray(112, 248))) reject("InvalidClassicExecution: converter proof fields without converter");
  const primary = decodeEvidence(p.subarray(32, 112));
  if (primary.effectiveK < 1 || primary.effectiveK > primary.publishedK || primary.publishedK > primary.configuredSourceCount) reject("InvalidClassicExecution: primary evidence");
  const publicationSlot = v.getBigUint64(24, true);
  // R8: slot-coherent converter EvidenceV1: flags 0, bytes [16,64) zero, floor > 0, 1 <= effective_Kc <= Kc <= S, primary's declared age.
  const ce = p.subarray(112, 192);
  if (converterPresent && (ce[7] !== 0 || !isZeroBytes(ce.subarray(16, 64)))) reject("InvalidClassicExecution: converter evidence");
  const converter = converterPresent ? { evidence: decodeEvidence(ce), snapshotRevision: v.getBigUint64(192, true),
    snapshotSlot: v.getBigUint64(200, true), validUntilSlot: v.getBigUint64(208, true), feedId: Uint8Array.from(p.subarray(216, 248)) } : null;
  if (converter) {
    const e = converter.evidence;
    if (isZeroBytes(converter.feedId) || e.nativeFloor === 0n || e.effectiveK < 1 || e.effectiveK > e.publishedK || e.publishedK > e.configuredSourceCount ||
        e.declaredWireAge !== primary.declaredWireAge || converter.snapshotRevision === 0n || converter.snapshotSlot === 0n ||
        converter.snapshotSlot > publicationSlot || publicationSlot - converter.snapshotSlot > 2n || converter.validUntilSlot < publicationSlot) {
      reject("InvalidClassicExecution: converter evidence");
    }
  }
  let dual: MimirClassicDualDecisionV2 | undefined;
  if (version === 2) {
    const effectiveMode = DUAL_MODES[p[249]!]; const nativeQualificationReason = DUAL_REASONS[p[250]!]; const appliedBoundKind = DUAL_BOUNDS[p[251]!];
    const point = effectiveMode === "CURRENT_POINT";
    if (p[248] !== 1 || !effectiveMode || !nativeQualificationReason || !appliedBoundKind || primary.point !== point ||
        (nativeQualificationReason === "NATIVE_QUALIFIED") === point || (appliedBoundKind === "POINT_DEPTH_UNCERTIFIED") !== point) {
      reject("InvalidClassicExecution: dual decision");
    }
    dual = { profile: MIMIR_CLASSIC_DUAL_PROFILE, effectiveMode: effectiveMode!, nativeQualificationReason: nativeQualificationReason!, appliedBoundKind: appliedBoundKind! };
  }
  return { valid: true, converterPresent, snapshotRevision: v.getBigUint64(16, true), publicationSlot, primary, converter, ...(dual ? { dual } : {}) };
}

export function encodeMimirClassicPublicationProof(p: MimirClassicPublicationProofV1): Uint8Array {
  const out = new Uint8Array(C.proofLength); const v = dv(out);
  if (!p.valid || p.converterPresent !== (p.converter !== null) || !u64ok(p.snapshotRevision) || !u64ok(p.publicationSlot)) reject("InvalidClassicExecution: proof");
  out.set(utf8(C.proofMagic)); v.setUint16(8, p.dual ? 2 : 1, true); v.setUint16(10, C.proofLength, true); v.setUint32(12, 1 | (p.converterPresent ? 2 : 0), true);
  v.setBigUint64(16, p.snapshotRevision, true); v.setBigUint64(24, p.publicationSlot, true); out.set(encodeEvidence(p.primary), 32);
  if (p.converter) {
    out.set(encodeEvidence(p.converter.evidence), 112); v.setBigUint64(192, p.converter.snapshotRevision, true);
    v.setBigUint64(200, p.converter.snapshotSlot, true); v.setBigUint64(208, p.converter.validUntilSlot, true); out.set(feedId32(p.converter.feedId, "converter feed id"), 216);
  }
  if (p.dual) out.set([1, DUAL_MODES.indexOf(p.dual.effectiveMode), DUAL_REASONS.indexOf(p.dual.nativeQualificationReason), DUAL_BOUNDS.indexOf(p.dual.appliedBoundKind)], 248);
  decodeMimirClassicPublicationProof(out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// §2.2/§2.4 strict `ClassicExecutionV1` decoder.

const SNAP = { feedId: 16, revision: 96, status: 104, source: 107, slot: 116, validUntil: 124, unixTs: 132, lb: 156, shortEnd: 164,
  k: 252, venues: 253, correlations: 254, effectiveK: 429, floor: 456 } as const;
const TWAP_SHORT_END_SLOT = 56;

/** Expected `EvidenceV1` bytes from a 512-byte FeedSnapshot, exactly as the program copies them; flags/temporal fields set by the caller. */
function snapshotEvidence(snap: Uint8Array, wireAge: Uint8Array, configured: number, minRing: Uint8Array): Uint8Array {
  const e = new Uint8Array(C.evidenceLength);
  e.set(wireAge, 0); e.set([configured, snap[SNAP.k]!, snap[SNAP.effectiveK]!, snap[SNAP.venues]!, snap[SNAP.correlations]!], 2);
  e.set(minRing, 8); e.set(snap.subarray(SNAP.floor, SNAP.floor + 16), 64);
  return e;
}

/** A2 §2.3 / R8: every duplicated proof field equals the mirror, the private rings, and the embedded converter TWAP/snapshot. */
function assertProofBinding(data: Uint8Array, feedId: Uint8Array, primaryRows: readonly MimirFusedDescriptor[], rowOffsets: readonly number[],
  converterOffset: number | null): void {
  const fail = (what: string): never => reject(`InvalidClassicExecution: proof ${what} binding`);
  const p = data.subarray(C.proofOffset, C.proofOffset + C.proofLength); const pv = dv(p);
  const m = data.subarray(C.mirrorOffset, C.rowsOffset); const mv = dv(m);
  if (m[SNAP.status] !== 0 || !bytesEqual(m.subarray(SNAP.feedId, SNAP.feedId + 32), feedId) ||
      !bytesEqual(p.subarray(16, 24), m.subarray(SNAP.revision, SNAP.revision + 8)) || !bytesEqual(p.subarray(24, 32), m.subarray(SNAP.slot, SNAP.slot + 8))) {
    fail("mirror");
  }
  const n = primaryRows.length; const slot = pv.getBigUint64(24, true);
  const minRing = rowOffsets.slice(0, n).reduce((a, o) => { const x = dv(data).getBigUint64(o + ROW.ring + RING_NEWEST_SLOT, true); return x < a ? x : a; }, U64_MAX);
  if (pv.getBigUint64(32 + 8, true) > minRing) fail("ring");
  const e = snapshotEvidence(m, p.subarray(32, 34), n, p.subarray(40, 48)); const ev = dv(e);
  const source = m[SNAP.source]!; const start = mv.getUint32(SNAP.lb, true); const end = mv.getUint32(SNAP.lb + 4, true);
  if (source === 7) e[7] = 4;
  else if ((source === 5 || source === 6) && end !== 0 && start <= end) {
    const sampled = source === 6; const quiet = !sampled && primaryRows.some((d) => d.mode === 3);
    e[7] = 8 | (sampled ? 2 : quiet ? 1 : 0); ev.setBigInt64(48, BigInt(start), true); ev.setBigInt64(56, BigInt(end), true);
    if (sampled) { ev.setUint16(42, m[SNAP.lb + 23]!, true); ev.setUint16(44, m[SNAP.lb + 24]!, true); }
    else if (quiet) {
      e.set(m.subarray(SNAP.unixTs, SNAP.unixTs + 8), 16); ev.setBigInt64(24, BigInt(end), true);
      const age = BigInt(mv.getUint16(SNAP.lb + 18, true)); ev.setBigUint64(32, slot > age ? slot - age : 0n, true);
      e.set(m.subarray(SNAP.lb + 20, SNAP.lb + 22), 40);
    }
  }
  if (!bytesEqual(e, p.subarray(32, 112))) fail("primary evidence");
  if (converterOffset === null) return;
  const cs = data.subarray(converterOffset + CONV.snapshot, converterOffset + CONV.rows);
  const shortEnd = data.subarray(converterOffset + CONV.twap + TWAP_SHORT_END_SLOT, converterOffset + CONV.twap + TWAP_SHORT_END_SLOT + 8);
  if (!bytesEqual(shortEnd, cs.subarray(SNAP.shortEnd, SNAP.shortEnd + 8)) ||
      !bytesEqual(cs.subarray(SNAP.feedId, SNAP.feedId + 32), data.subarray(converterOffset + CONV.feedConfig + 16, converterOffset + CONV.feedConfig + 48))) {
    fail("converter snapshot");
  }
  const expected = concatBytes(snapshotEvidence(cs, p.subarray(32, 34), rowOffsets.length - n, shortEnd), cs.subarray(SNAP.revision, SNAP.revision + 8),
    cs.subarray(SNAP.slot, SNAP.slot + 8), cs.subarray(SNAP.validUntil, SNAP.validUntil + 8), cs.subarray(SNAP.feedId, SNAP.feedId + 32));
  if (!bytesEqual(expected, p.subarray(112, 248))) fail("converter evidence");
}


/** Strict decoder: magic, version, header length, exact length, geometry, flags, reserved bytes, descriptors, membership, digest, proof. */
export function decodeMimirClassicExecution(data: Uint8Array) {
  if (data.length < C.rowsOffset + C.rowLength || !bytesEqual(data.subarray(0, 8), utf8(C.magic))) return reject("InvalidClassicExecution: magic");
  const v = dv(data);
  const header = { version: v.getUint16(8, true), headerLength: v.getUint16(10, true), exactLength: v.getUint32(12, true),
    feedId: Uint8Array.from(data.subarray(16, 48)), snapshot: bytesAddress(data.subarray(48, 80)), definitionDigest: Uint8Array.from(data.subarray(80, 112)),
    sourceSetRevision: v.getBigUint64(112, true), componentCount: data[120]!, converterSourceCount: data[121]!, bump: data[122]!, status: data[123]!,
    flags: v.getUint32(124, true) };
  if (header.version !== 1) return reject("InvalidClassicExecution: version");
  if (header.headerLength !== C.headerLength || header.exactLength !== data.length) return reject("InvalidClassicExecution: length");
  const n = header.componentCount; const s = header.converterSourceCount;
  if (n < 1 || n > 5 || s > 5 || header.status > 1 || header.flags !== (s > 0 ? 1 : 0) || isZeroBytes(header.feedId)) return reject("InvalidClassicExecution: header");
  if (header.status === 1 && isZeroBytes(header.definitionDigest)) return reject("InvalidClassicExecution: definition digest");
  const converterOffset = s === 0 ? null : C.rowsOffset + C.rowLength * n;
  const rowOffsets = [...Array.from({ length: n }, (_, i) => C.rowsOffset + C.rowLength * i),
    ...Array.from({ length: s }, (_, j) => converterOffset! + CONV.rows + C.rowLength * j)];
  const rowsEnd = converterOffset === null ? C.rowsOffset + C.rowLength * n : converterOffset + C.converterFixedLength + C.rowLength * s;
  if (data.length < rowsEnd) return reject("InvalidClassicExecution: geometry");
  const descriptors = rowOffsets.map((o) => decodeMimirFusedDescriptor(data.subarray(o, o + 16)));
  const layout = mimirClassicExecutionLayout(descriptors.slice(0, n), descriptors.slice(n));
  if (layout.exactLength !== data.length || layout.descriptors.some((d, i) => d.moduleOffset !== descriptors[i]!.moduleOffset || d.moduleLength !== descriptors[i]!.moduleLength)) {
    return reject("InvalidClassicExecution: geometry");
  }
  descriptors.forEach((d, r) => assertMimirClassicDescriptorAdmitted(d, r < n ? "primary" : "converter"));
  const membership: MimirMembershipRecord[] = layout.membershipOffsets.map((o, r) => {
    const k = data[o]!;
    if (k !== descriptors[r]!.bindingWidth || data[o + 1] !== descriptors[r]!.accountsBindingVersion || data[o + 2]! > 1 || data[o + 3] !== 0) {
      reject("InvalidClassicExecution: membership record");
    }
    const accounts = Array.from({ length: k }, (_, i) => {
      const a = o + 4 + 65 * i;
      if (data[a + 64]! > 1) reject("InvalidClassicExecution: executable bit");
      return { address: bytesAddress(data.subarray(a, a + 32)), owner: bytesAddress(data.subarray(a + 32, a + 64)), executable: data[a + 64] === 1 };
    });
    return { bindingWidth: k, accountsBindingVersion: data[o + 1]!, bindingVariant: data[o + 2] as 0 | 1, accounts };
  });
  if (header.status === 1) {
    const what = "InvalidClassicExecution";
    const primaryFeedPlan = mimirSealedFeedPlan(what, data.subarray(C.feedConfigOffset, C.planOffset), data.subarray(C.planOffset, C.mirrorOffset));
    if (!bytesEqual(primaryFeedPlan.feed.feedId, header.feedId)) reject(`${what}: feed binding`);
    const conv = converterOffset === null ? null : mimirSealedFeedPlan(what, data.subarray(converterOffset + CONV.feedConfig, converterOffset + CONV.plan),
      data.subarray(converterOffset + CONV.plan, converterOffset + CONV.twap));
    rowOffsets.forEach((o, r) => assertMimirSealedRow({ what, data, descriptor: descriptors[r]!, membership: membership[r]!, converterRow: true, pointOk: r < n,
      sourceImage: data.subarray(o + ROW.sourceConfig, o + ROW.ring), feedPlan: r < n ? primaryFeedPlan : conv!, ringOffset: o + ROW.ring }));
  }
  const proof = decodeMimirClassicPublicationProof(data.subarray(C.proofOffset, C.proofOffset + C.proofLength));
  if (proof && proof.converterPresent !== (s > 0)) reject("InvalidClassicExecution: proof converter flag");
  if (proof && (proof.dual !== undefined) !== (descriptors[0]!.temporalKind === 6)) reject("InvalidClassicExecution: proof version for profile");
  if (proof?.dual?.nativeQualificationReason === "REBUILDING_AFTER_GAP" && descriptors[0]!.adapterType !== 3) reject("InvalidClassicExecution: dual reason for adapter");
  if (proof?.converter && proof.converter.evidence.configuredSourceCount !== s) reject("InvalidClassicExecution: converter evidence");
  // A primary without a quiet/sampled (mode 3/4) row is native-bounded evidence: bit3 only, never quiet/sampled.
  if (proof && (proof.primary.quiet || proof.primary.sampled) && !descriptors.slice(0, n).some((d) => d.mode === 3 || d.mode === 4)) {
    reject("InvalidClassicExecution: evidence kind flags");
  }
  if (proof && isZeroBytes(data.subarray(C.mirrorOffset, C.rowsOffset))) reject("InvalidClassicExecution: proof without mirror");
  if (proof) assertProofBinding(data, header.feedId, descriptors.slice(0, n), rowOffsets, converterOffset);
  const pureSpot = data[C.planOffset + PLAN_MIN_SOURCES] === n && descriptors.slice(0, n).every((d) => d.mode === 0 || d.mode === 1 || d.mode === 6);
  if (proof && (data[C.mirrorOffset + SNAP.source] === 1) !== pureSpot) reject("InvalidClassicExecution: proof snapshot source");
  const row = (r: number) => {
    const o = rowOffsets[r]!;
    return { descriptor: descriptors[r]!, sourceConfigImage: data.subarray(o + ROW.sourceConfig, o + ROW.ring),
      ringNewestSlot: v.getBigUint64(o + ROW.ring + RING_NEWEST_SLOT, true), membership: membership[r]! };
  };
  return { ...header, active: header.status === 1, layout, proof,
    feedConfigImage: data.subarray(C.feedConfigOffset, C.planOffset), planImage: data.subarray(C.planOffset, C.mirrorOffset),
    mirror: data.subarray(C.mirrorOffset, C.rowsOffset),
    primary: Array.from({ length: n }, (_, i) => row(i)),
    converter: converterOffset === null ? null : {
      feedConfigImage: data.subarray(converterOffset + CONV.feedConfig, converterOffset + CONV.plan),
      planImage: data.subarray(converterOffset + CONV.plan, converterOffset + CONV.twap),
      twap: data.subarray(converterOffset + CONV.twap, converterOffset + CONV.snapshot),
      snapshot: data.subarray(converterOffset + CONV.snapshot, converterOffset + CONV.rows),
      sources: Array.from({ length: s }, (_, j) => row(n + j)) } };
}
export type MimirClassicExecution = ReturnType<typeof decodeMimirClassicExecution>;

/**
 * Typed DUAL readout of a decoded (authenticated) classic execution: `null` for a non-DUAL feed. `UNAVAILABLE` = no valid publication
 * (unpublished or Degraded, proof zeroed). Mode, bound and floor come from the same proof/mirror; trading policy stays with the consumer.
 */
export function mimirClassicDualPublication(state: MimirClassicExecution) {
  if (state.primary[0]?.descriptor.temporalKind !== 6) return null;
  const p = state.proof; const m = dv(state.mirror);
  return Object.freeze({ profile: MIMIR_CLASSIC_DUAL_PROFILE, effectiveMode: p?.dual?.effectiveMode ?? "UNAVAILABLE" as const,
    nativeQualificationReason: p?.dual?.nativeQualificationReason ?? null, appliedBoundKind: p?.dual?.appliedBoundKind ?? "NONE" as const,
    floorNative: p ? p.primary.nativeFloor : 0n, modelHash: p ? Uint8Array.from(state.mirror.subarray(472, 504)) : null,
    snapshotRevision: p?.snapshotRevision ?? 0n, publicationSlot: p?.publicationSlot ?? 0n, validUntilSlot: p ? m.getBigUint64(SNAP.validUntil, true) : 0n });
}
export type MimirClassicDualPublication = NonNullable<ReturnType<typeof mimirClassicDualPublication>>;

/** Execution bytes with every tag-89-writable region zeroed: the sealed image. */
export function mimirClassicExecutionImmutableBytes(data: Uint8Array): Uint8Array {
  const state = decodeMimirClassicExecution(data);
  const out = Uint8Array.from(data);
  for (const [a, b] of mimirClassicExecutionMutableRegions(state.layout)) out.fill(0, a, b);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// §2.4 definition digest.

const u8 = (x: number) => Uint8Array.of(x);
/**
 * `definition_digest`: SHA-256 over the ordered parts (vector SHA-256 = SHA-256 of the concatenation). Integers are little-endian:
 * lengths/offsets u32, region lengths u16, counts u8. Feed config / plan keys are the program-derived addresses.
 */
export async function mimirClassicDefinitionDigest(a: Readonly<{
  programId: Address; execution: Address; state: MimirClassicExecution; feedConfig: Address; plan: Address;
  converter?: Readonly<{ feedId: Uint8Array; feedConfig: Address; plan: Address }>;
}>): Promise<Uint8Array> {
  const st = a.state; const n = st.componentCount; const s = st.converterSourceCount;
  if ((s > 0) !== (a.converter !== undefined)) return reject("ClassicExecutionDefinitionMismatch: converter identity");
  const rowParts = (r: number) => {
    const row = r < n ? st.primary[r]! : st.converter!.sources[r - n]!;
    const m = row.membership;
    return [encodeMimirFusedDescriptor(row.descriptor), row.sourceConfigImage,
      concatBytes(u8(m.bindingWidth), u8(m.accountsBindingVersion), u8(m.bindingVariant), u8(0),
        ...m.accounts.map((x) => concatBytes(addressBytes(x.address), addressBytes(x.owner), u8(x.executable ? 1 : 0))))];
  };
  const parts: Uint8Array[] = [utf8(C.digestDomain), addressBytes(a.programId), addressBytes(a.execution), le(4, st.exactLength),
    st.feedId, addressBytes(st.snapshot), u8(n), u8(s), addressBytes(a.feedConfig), st.feedConfigImage, addressBytes(a.plan), st.planImage,
    ...Array.from({ length: n }, (_, r) => rowParts(r)).flat()];
  if (a.converter) {
    parts.push(st.converter!.feedConfigImage.subarray(48, 80), addressBytes(a.converter.feedConfig), st.converter!.feedConfigImage,
      addressBytes(a.converter.plan), st.converter!.planImage, ...Array.from({ length: s }, (_, j) => rowParts(n + j)).flat());
  }
  st.layout.descriptors.forEach((d, r) => parts.push(le(4, st.layout.rowOffsets[r]! + ROW.ring), le(2, C.ringLength), le(4, d.moduleOffset), le(2, d.moduleLength)));
  return sha256(concatBytes(...parts));
}

export async function verifyMimirClassicDefinitionDigest(a: Parameters<typeof mimirClassicDefinitionDigest>[0]): Promise<void> {
  if (!bytesEqual(await mimirClassicDefinitionDigest(a), a.state.definitionDigest)) reject("ClassicExecutionDefinitionMismatch: definition digest");
}

const u16le = (x: number) => le(2, x);
async function feedPlanKeys(programId: Address, feedImage: Uint8Array, planImage: Uint8Array) {
  const feed = decodeMimirBetaLiveFeed(feedImage); const plan = decodeMimirBetaLivePlanFields(planImage);
  const [[feedConfig], [planKey]] = await Promise.all([deriveMimirBetaPda({ programId, seed: "feed_config", values: [feed.feedId] }),
    deriveMimirBetaPda({ programId, seed: "sourcing_plan", values: [plan.feedId, u16le(plan.planId), u16le(plan.planVersion)] })]);
  return { feedId: feed.feedId, feedConfig, plan: planKey };
}

/**
 * The one context-aware entry for an execution account read from chain: owner, canonical PDA and bump, strict decode
 * (layout, proof and R8 bindings), and, for an active execution, header/rows binding and the recomputed definition digest.
 */
export async function decodeMimirClassicExecutionAccount(a: Readonly<{
  programId: Address; address: Address; owner: Address; data: Uint8Array; requireActive?: boolean;
}>): Promise<MimirClassicExecution> {
  if (a.owner !== a.programId) return reject("InvalidClassicExecution: owner");
  const state = decodeMimirClassicExecution(a.data);
  const [pda, bump] = await deriveMimirClassicExecutionAddress(a.programId, state.feedId);
  if (pda !== a.address || bump !== state.bump) return reject("InvalidClassicExecution: execution address");
  if (!state.active) return a.requireActive ? reject("ClassicExecutionNotReady: execution is not active") : state;
  if (state.primary.some((r) => decodeMimirBetaLiveSource(r.sourceConfigImage).sourceSetRevision !== state.sourceSetRevision)) {
    reject("InvalidClassicExecution: source set revision");
  }
  const primary = await feedPlanKeys(a.programId, state.feedConfigImage, state.planImage);
  const converter = state.converter ? await feedPlanKeys(a.programId, state.converter.feedConfigImage, state.converter.planImage) : undefined;
  await verifyMimirClassicDefinitionDigest({ programId: a.programId, execution: a.address, state, feedConfig: primary.feedConfig, plan: primary.plan,
    ...(converter ? { converter } : {}) });
  return state;
}

// ---------------------------------------------------------------------------------------------------------------------
// §3 tag 90 BEGIN/GROW/SEAL: the tag-88 closure planner with the classic account lists.

export interface MimirInitClassicRowAccounts { readonly sourceConfig: Address; readonly externals: readonly Address[] }

export function buildMimirInitFusedClassicClosure(a: Readonly<{
  programId: Address; payer: Address; execution: Address; collateralLock: Address; snapshot: Address; feedConfig: Address; sourcingPlan: Address; registry: Address;
  feedId: Uint8Array; layout: MimirClassicExecutionLayout; witnesses: readonly MimirInitSourceWitness[];
  primary: readonly MimirInitClassicRowAccounts[];
  converter?: Readonly<{ feedConfig: Address; sourcingPlan: Address; sources: readonly MimirInitClassicRowAccounts[] }>;
}>): MimirBetaInstruction[] {
  const { layout } = a;
  if (a.primary.length !== layout.componentCount || (a.converter?.sources.length ?? 0) !== layout.converterSourceCount) {
    return reject("ClassicExecutionDefinitionMismatch: account rows");
  }
  const rows = [...a.primary, ...(a.converter?.sources ?? [])];
  checkVectors(layout, rows.map((r) => r.externals));
  return buildMimirInitFusedClosure({ tag: MIMIR_INIT_FUSED_CLASSIC_TAG, programId: a.programId, payer: a.payer, execution: a.execution, collateralLock: a.collateralLock,
    feedId: a.feedId, layout, witnesses: a.witnesses, beginAccounts: [a.snapshot], beginWritable: [a.snapshot],
    sealAccounts: [a.snapshot, a.feedConfig, a.sourcingPlan, a.registry, MIMIR_BETA_SYSTEM_PROGRAM_ID,
      ...a.primary.flatMap((r) => [r.sourceConfig, ...r.externals]),
      ...(a.converter ? [a.converter.feedConfig, a.converter.sourcingPlan, ...a.converter.sources.flatMap((r) => [r.sourceConfig, ...r.externals])] : [])] });
}

// ---------------------------------------------------------------------------------------------------------------------
// §4 tag 89.

/**
 * Default signed publish reuse window: requests in the same burst (within 2 slots) share one paid publication, anything
 * later republishes `current+1` and pays. Apps may sign any value; the program caps it at the feed's max snapshot age.
 */
export const MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS = 2;

export interface MimirFusedClassicRequest {
  readonly feedId: Uint8Array;
  /** Proof `EV_AGE`; a fresh publication is reused only when it was published under this same age. */
  readonly declaredMaxSnapshotAge: number;
  /** Publish or ensure-sample: floor on the current snapshot revision. Exact sample-only: exact. */
  readonly previousSnapshotRevision: bigint;
  /** Publish: minimum landed revision; the program reuses a fresh publication at or above it, else publishes `current+1`. */
  readonly nextSnapshotRevision: bigint;
  readonly componentCount: number;
  readonly sourceSetRevision: bigint;
  readonly planHash: Uint8Array;
  readonly converterSourceCount: number;
  readonly feedConfigRevision: bigint;
  /** Private-ring newest slots, primary then converter. Publish or ensure-sample: per-row lower bounds. Exact sample-only: exact. */
  readonly ringNewestSlots: readonly bigint[];
  /** Sample-only byte 93 = 1: a row already sampled past its floor is kept (no write), others sample from the actual predecessor. */
  readonly ensureSample?: boolean;
  /** Publish bytes 94..96: reuse a fresh publication only while `clock - snapshot_slot <= maxReuseAgeSlots` (capped at the max snapshot age). Absent = 0 = same slot only. */
  readonly maxReuseAgeSlots?: number;
}

export function encodeMimirFusedClassicData(r: MimirFusedClassicRequest): Uint8Array {
  const w = r.componentCount + r.converterSourceCount;
  if (!isU(r.componentCount, 5) || r.componentCount < 1 || !isU(r.converterSourceCount, 5) || r.ringNewestSlots.length !== w ||
      !isU(r.declaredMaxSnapshotAge, 0xffff) || r.declaredMaxSnapshotAge === 0 || !u64ok(r.previousSnapshotRevision) || !u64ok(r.nextSnapshotRevision) ||
      (r.nextSnapshotRevision !== r.previousSnapshotRevision && r.nextSnapshotRevision !== r.previousSnapshotRevision + 1n) ||
      !u64ok(r.sourceSetRevision) || !u64ok(r.feedConfigRevision) || !(r.planHash instanceof Uint8Array) || r.planHash.length !== 32 ||
      r.ringNewestSlots.some((x) => !u64ok(x)) || (r.ensureSample === true && r.nextSnapshotRevision !== r.previousSnapshotRevision) ||
      !isU(r.maxReuseAgeSlots ?? 0, 0xffff)) {
    return reject("InvalidInstruction: tag-89 CAS request");
  }
  const out = concatBytes(u8(MIMIR_FUSED_CLASSIC_TAG), feedId32(r.feedId), le(2, r.declaredMaxSnapshotAge), le(8, r.previousSnapshotRevision),
    le(8, r.nextSnapshotRevision), u8(r.componentCount), le(8, r.sourceSetRevision), r.planHash, u8(r.converterSourceCount), u8(r.ensureSample ? 1 : 0), le(2, r.maxReuseAgeSlots ?? 0),
    le(8, r.feedConfigRevision), ...r.ringNewestSlots.map((x) => le(8, x)));
  if (out.length !== 104 + 8 * w) return reject("InvalidInstruction: tag-89 length");
  return out;
}

export function decodeMimirFusedClassicData(d: Uint8Array): MimirFusedClassicRequest {
  if (d.length < 104 || d[0] !== MIMIR_FUSED_CLASSIC_TAG) return reject("InvalidInstruction: not tag 89");
  const v = dv(d); const n = d[51]!; const s = d[92]!;
  if (d.length !== 104 + 8 * (n + s) || d[93]! > 1) return reject("InvalidInstruction: tag-89 length/reserved");
  const r: MimirFusedClassicRequest = { feedId: Uint8Array.from(d.subarray(1, 33)), declaredMaxSnapshotAge: v.getUint16(33, true),
    previousSnapshotRevision: v.getBigUint64(35, true), nextSnapshotRevision: v.getBigUint64(43, true), componentCount: n,
    sourceSetRevision: v.getBigUint64(52, true), planHash: Uint8Array.from(d.subarray(60, 92)), converterSourceCount: s,
    feedConfigRevision: v.getBigUint64(96, true), ringNewestSlots: Array.from({ length: n + s }, (_, i) => v.getBigUint64(104 + 8 * i, true)),
    ...(d[93] === 1 ? { ensureSample: true } : {}), ...(v.getUint16(94, true) !== 0 ? { maxReuseAgeSlots: v.getUint16(94, true) } : {}) };
  encodeMimirFusedClassicData(r);
  return r;
}

export type MimirClassicRefreshMode = "sample" | "publish";

/**
 * CAS from the decoded execution and current public snapshot revision. Sample-only keeps `new=previous=r`, exact unless `ensure`.
 * `ensure` (sample only) makes `r` and the heads floors, so a competing sampler/publisher turns the anchor into a Noop.
 * Publish is `new=previous+1`: `previous` is a floor, `new` the minimum landed revision, ring heads per-row lower bounds,
 * reuse window `maxReuseAgeSlots` (default `MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS`).
 * Read the landed revision and slot from the snapshot/proof, never from this request.
 */
export function mimirFusedClassicRequest(a: Readonly<{
  state: MimirClassicExecution; snapshotRevision: bigint; mode: MimirClassicRefreshMode; declaredMaxSnapshotAge: number; ensure?: boolean;
  maxReuseAgeSlots?: number;
}>): MimirFusedClassicRequest {
  const st = a.state;
  if (!st.active) return reject("ClassicExecutionNotReady: execution is not active");
  if (st.proof && st.proof.snapshotRevision !== a.snapshotRevision) reject("ClassicExecutionStale: proof revision differs from public snapshot");
  const feed = decodeFeedConfigHeader(st.feedConfigImage); const plan = decodeSourcingPlanHeader(st.planImage);
  return { feedId: st.feedId, declaredMaxSnapshotAge: a.declaredMaxSnapshotAge, previousSnapshotRevision: a.snapshotRevision,
    nextSnapshotRevision: a.mode === "publish" ? a.snapshotRevision + 1n : a.snapshotRevision, componentCount: st.componentCount,
    sourceSetRevision: st.sourceSetRevision, planHash: Uint8Array.from(plan.planHash), converterSourceCount: st.converterSourceCount,
    feedConfigRevision: feed.feedConfigRevision, ringNewestSlots: [...st.primary, ...(st.converter?.sources ?? [])].map((r) => r.ringNewestSlot),
    ...(a.ensure && a.mode === "sample" ? { ensureSample: true } : {}),
    ...(a.mode === "publish" ? { maxReuseAgeSlots: a.maxReuseAgeSlots ?? MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS } : a.maxReuseAgeSlots ? { maxReuseAgeSlots: a.maxReuseAgeSlots } : {}) };
}

/**
 * Sample-only scheduling: a temporal private row (quiet/interval or sampled) that is not yet mature forces `sample`;
 * spot/native/point rows publish on the first valid publish. A quorum feed (`plan.minSources < N`) is temporal as a whole:
 * every primary row's ring must be READY before publishing. `ready` reads the row's private module and ring bytes.
 */
export function mimirClassicRefreshMode(state: MimirClassicExecution, ready: (row: number, module: Uint8Array, ring: Uint8Array) => boolean,
  data: Uint8Array): MimirClassicRefreshMode {
  const minSources = state.planImage[PLAN_MIN_SOURCES]!;
  const quorum = minSources > 0 && minSources < state.componentCount;
  const temporal = state.layout.descriptors.map((d, r) => [d, r] as const).filter(([d, r]) => d.mode === 3 || d.mode === 4 || (quorum && r < state.componentCount));
  return temporal.every(([d, r]) => ready(r, data.subarray(d.moduleOffset, d.moduleOffset + d.moduleLength),
    data.subarray(state.layout.rowOffsets[r]! + ROW.ring, state.layout.rowOffsets[r]! + ROW.ring + C.ringLength))) ? "publish" : "sample";
}

/** §4.2 recurring metas: snapshot W, Registry R, execution W, primary then converter external vectors R, Instructions last iff required. */
export function buildMimirFusedClassicInstruction(a: Readonly<{
  programId: Address; snapshot: Address; registry: Address; execution: Address; layout: MimirClassicExecutionLayout;
  primaryExternals: readonly (readonly Address[])[]; converterExternals: readonly (readonly Address[])[]; request: MimirFusedClassicRequest;
}>): MimirBetaInstruction {
  const { layout, request } = a;
  if (request.componentCount !== layout.componentCount || request.converterSourceCount !== layout.converterSourceCount) {
    return reject("ClassicExecutionDefinitionMismatch: CAS width");
  }
  const externals = [...a.primaryExternals, ...a.converterExternals];
  checkVectors(layout, externals);
  if (a.snapshot === a.execution || externals.flat().some((x) => x === a.snapshot || x === a.execution || x === a.registry)) {
    return reject("InvalidInstruction: tag-89 external aliases a Mimir role");
  }
  return { programAddress: a.programId, data: encodeMimirFusedClassicData(request), accounts: [
    meta(a.snapshot, false, true), ro(a.registry), meta(a.execution, false, true), ...externals.flat().map(ro),
    ...(layout.descriptors.some((d) => d.requiresInstructionsSysvar) ? [ro(MIMIR_INSTRUCTIONS_SYSVAR_ID)] : []),
  ] };
}

// ---------------------------------------------------------------------------------------------------------------------
// §7 Consumer cell and producer order.

export interface MimirClassicCell { readonly snapshot: Address; readonly execution: Address }

/** Consumer action metas for a live classic cell: `[snapshot, execution]`, both readonly/nonsigner. Width two, producer span one. */
export function mimirConsumerClassicCellMetas(cell: MimirClassicCell) {
  if (cell.snapshot === cell.execution) return reject("InvalidInstruction: classic cell aliases");
  return [ro(cell.snapshot), ro(cell.execution)] as const;
}

/**
 * Canonical producer order (§7.1) with the collateral = component admission rule (§7.3). Ordinary is the action's -1 producer,
 * collateral its -2. Writable output pairs must be pairwise distinct, except an intentionally identical classic cell, which
 * emits exactly one tag-89 producer (identical feed/execution/CAS). No external role may alias any writable output, and
 * every external role is readonly/nonsigner everywhere.
 */
export function orderMimirConsumerProducers(a: Readonly<{ ordinary: MimirBetaInstruction; collateral?: MimirBetaInstruction }>): MimirBetaInstruction[] {
  const { ordinary, collateral } = a;
  const kind = (ix: MimirBetaInstruction) => ix.data[0];
  if (kind(ordinary) !== MIMIR_FUSED_CLASSIC_TAG && kind(ordinary) !== 87) return reject("InvalidInstruction: ordinary producer must be tag 89 or 87");
  if (!collateral) return [ordinary];
  if (kind(collateral) !== MIMIR_FUSED_CLASSIC_TAG) return reject("InvalidInstruction: collateral producer must be tag 89");
  const writable = (ix: MimirBetaInstruction) => ix.accounts.filter((m) => m.isWritable).map((m) => m.address);
  const sameCell = kind(ordinary) === MIMIR_FUSED_CLASSIC_TAG && writable(ordinary).every((x, i) => x === writable(collateral)[i]);
  if (sameCell) {
    if (ordinary.programAddress !== collateral.programAddress || !bytesEqual(ordinary.data, collateral.data) ||
        ordinary.accounts.length !== collateral.accounts.length ||
        ordinary.accounts.some((m, i) => m.address !== collateral.accounts[i]!.address || m.isWritable !== collateral.accounts[i]!.isWritable)) {
      return reject("InvalidInstruction: identical classic cell with different CAS or metas");
    }
    return [ordinary];
  }
  const outputs = [...writable(collateral), ...writable(ordinary)];
  if (new Set(outputs).size !== outputs.length) return reject("InvalidInstruction: two writers of one output");
  const externals = (ix: MimirBetaInstruction) => ix.accounts.filter((m) => !m.isWritable && !m.isSigner).map((m) => m.address);
  if ([...externals(collateral), ...externals(ordinary)].some((x) => outputs.includes(x))) return reject("InvalidInstruction: external aliases a writable output");
  return [collateral, ordinary];
}
