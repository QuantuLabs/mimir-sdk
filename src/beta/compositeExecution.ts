import type { Address } from "@solana/kit";
import { deriveMimirBetaPda } from "./abi.js";
import { addressBytes, bytesAddress, bytesEqual, concatBytes, isZeroBytes, sha256, utf8 } from "./bytes.js";
import { mimirSampledSourceAdapters } from "../internal/sampledTemporalCore.js";
import { MIMIR_BETA_SYSTEM_PROGRAM_ID } from "./deployment.js";
import { betaError } from "./errors.js";
import { assertMimirClassicConverterAdmitted, decodeEvidence, encodeEvidence, type MimirClassicEvidenceV1 } from "./classicExecution.js";
import type { MimirBetaAccount, MimirBetaInstruction } from "./types.js";
import { decodeMimirBetaLiveFeed, decodeMimirBetaLivePlanFields, decodeMimirBetaLiveSource } from "./liveAbi.js";
import { decodeFeedCollateralLockHeader, decodeFeedSnapshotHeader, decodeMimirBrowserCompositePublication, decodeFeedTwapStateHeader, decodeMimirBrowserCpmmQuietTemporalModuleV2, decodeMimirBrowserDammReserveTemporalModuleV3,
  decodeMimirBrowserSourceRingV1, decodeMimirBrowserSourceTemporalModuleV1 } from "../internal/nativeMonoRefreshCore.js";
import { decodeMimirCurrentPointModule } from "../internal/currentPointCore.js";
import { decodeMimirSampledTemporalModule, initialMimirSampledReadiness, mimirSampledClosureFromRing, projectMimirSampledReadiness,
  type MimirSampledReadiness } from "../internal/sampledTemporalCore.js";

export const MIMIR_FUSED_COMPOSITE_TAG = 87;
export const MIMIR_INIT_FUSED_COMPOSITE_TAG = 88;
export const MIMIR_REMOVED_COMPOSITE_TAGS = Object.freeze([65, 66, 67, 68, 69, 70, 71, 72] as const);
export const MIMIR_INSTRUCTIONS_SYSVAR_ID = "Sysvar1nstructions1111111111111111111111111" as Address;

export const MIMIR_COMPOSITE_EXECUTION = Object.freeze({
  seed: "composite_execution", magic: "MIMIRCEF", version: 1, headerLength: 128, componentRowLength: 1_621,
  converterFixedLength: 1_829, converterSourceRowLength: 944, membershipRecordHeaderLength: 4, physicalIdentityLength: 65,
  maxBindingWidth: 8, reallocGrowth: 10_240, descriptorLength: 16, sealWitnessLength: 285,
  cfcLength: 661, cspLength: 720, classicSnapshotLength: 512, proofMagic: "MIMIRCDP", proofVersion: 2, proofHeaderLength: 64, proofRowLength: 84, proofConverterLength: 56,
} as const);
const L = MIMIR_COMPOSITE_EXECUTION;
const ROW = { descriptor: 0, sourceConfig: 16, feedConfig: 400, plan: 757, ring: 1_077 } as const;
const CONV = { feedConfig: 0, plan: 357, twap: 677, snapshot: 1_317 } as const;
const CONV_SOURCE = { descriptor: 1_829, sourceConfig: 1_845, ring: 2_229 } as const;
const RING_NEWEST_SLOT = 64;
const RING_COMPLETED_END_SLOT = 448;
const SOURCE_CONFIG_REVISION = 360;
const U64_MAX = (1n << 64n) - 1n;

/** Temporal kind -> canonical module length (§4.3). */
export const MIMIR_FUSED_TEMPORAL_MODULE_LENGTH = Object.freeze({ 0: 0, 1: 192, 2: 256, 3: 320, 4: 1_280, 5: 1_280, 6: 0 } as const);
/** Temporal kind 6: `DUAL_NATIVE_POINT_V1` profile marker on a CPMM-v0 or DLMM classic primary or composite component row (native first, current point fallback; no module). */
export const MIMIR_TEMPORAL_DUAL_NATIVE_POINT_V1 = 6;
export const MIMIR_TEMPORAL_CPMM_DUAL_V1 = MIMIR_TEMPORAL_DUAL_NATIVE_POINT_V1;
export type MimirFusedTemporalKind = keyof typeof MIMIR_FUSED_TEMPORAL_MODULE_LENGTH;
/** 0 routeable spot, 1 visible spot, 2 native bounded, 3 quiet/interval, 4 sampled interval, 5 current point, 6 CPMM component spot projection. */
export type MimirFusedRecipeMode = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface MimirFusedDescriptor {
  readonly minSlotGap: number;
  readonly externalWidth: number;
  readonly temporalKind: MimirFusedTemporalKind;
  readonly moduleOffset: number;
  readonly moduleLength: number;
  readonly mode: MimirFusedRecipeMode;
  readonly requiresInstructionsSysvar: boolean;
  readonly adapterType: number;
  readonly adapterVersion: number;
  readonly bindingWidth: number;
  readonly accountsBindingVersion: 0 | 1;
}
export type MimirFusedRecipe = Omit<MimirFusedDescriptor, "moduleOffset" | "moduleLength">;

const le = (bytes: number, value: number | bigint) => {
  const out = new Uint8Array(bytes); const v = new DataView(out.buffer);
  if (bytes === 2) v.setUint16(0, Number(value), true); else if (bytes === 4) v.setUint32(0, Number(value), true);
  else v.setBigUint64(0, BigInt(value), true);
  return out;
};
const dv = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const reject = (message: string): never => betaError("PROGRAM_ABI_MISMATCH", message);
const isU = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max;
const u64ok = (value: bigint) => typeof value === "bigint" && value >= 0n && value <= U64_MAX;

/** Frozen `families.rs` Recipe: the only admissible row shape for a `(family, version, binding, mode, E, kind)` tuple. */
export interface MimirAdmittedRecipe {
  readonly mode: MimirFusedRecipeMode; readonly temporalKind: MimirFusedTemporalKind; readonly externalWidth: number;
  readonly requiresInstructionsSysvar: boolean; readonly bindingVariant: 0 | 1; readonly bindingWidth: number; readonly tag77Roles: number;
}
type Conv = "any" | "only" | "never" | "point";
// [adapterType, versions, mode, E, temporal kinds, converter rule, binding variant, legacy K, static K, source-shape roles] = frozen admitted_recipe arms.
// Legacy K 0 = static-binding-only arm.
const RECIPES: readonly (readonly [number, readonly number[], MimirFusedRecipeMode, number, readonly MimirFusedTemporalKind[], Conv, 0 | 1, number, number, number])[] = [
  [2, [0], 6, 4, [0], "never", 0, 4, 4, 4], [2, [0], 0, 4, [0], "only", 0, 4, 4, 4], [2, [0], 2, 5, [0], "only", 0, 4, 4, 5],
  [2, [0], 3, 7, [1], "only", 0, 4, 4, 5], [2, [0], 2, 7, [6], "point", 0, 4, 4, 5],
  [1, [0], 0, 7, [0], "any", 1, 7, 4, 7], [1, [0], 2, 8, [0], "any", 1, 7, 4, 8], [1, [1], 0, 8, [0], "any", 1, 8, 5, 8], [1, [1], 2, 9, [0], "any", 1, 8, 5, 9],
  [0, [0], 0, 7, [0], "any", 1, 7, 4, 7], [0, [0], 3, 9, [0], "any", 1, 7, 4, 7],
  [3, [0], 1, 4, [0], "any", 0, 4, 3, 4], [3, [0], 0, 6, [0], "any", 1, 6, 3, 6], [3, [0], 2, 7, [0], "any", 0, 4, 3, 7], [3, [0], 2, 9, [0], "any", 1, 6, 3, 9],
  [3, [1], 1, 5, [0], "any", 0, 5, 4, 5], [3, [1], 0, 7, [0], "any", 1, 7, 4, 7], [3, [1], 2, 8, [0], "any", 0, 5, 4, 8], [3, [1], 2, 10, [0], "any", 1, 7, 4, 10],
  [3, [0], 2, 7, [6], "point", 0, 0, 3, 7], [3, [1], 2, 8, [6], "point", 0, 0, 4, 8], [3, [0], 2, 9, [6], "point", 1, 0, 3, 9], [3, [1], 2, 10, [6], "point", 1, 0, 4, 10],
  [3, [0], 5, 6, [5], "point", 0, 0, 3, 4], [3, [1], 5, 7, [5], "point", 0, 0, 4, 5],
  [7, [0], 0, 3, [0], "any", 0, 3, 3, 3], [7, [0], 3, 5, [2, 3], "any", 0, 3, 3, 3],
  [4, [0], 4, 8, [4], "any", 0, 6, 6, 6], [4, [0], 5, 8, [5], "point", 0, 6, 6, 6],
  [6, [0, 1], 4, 9, [4], "any", 0, 7, 7, 7], [6, [0, 1], 5, 9, [5], "point", 0, 7, 7, 7],
];

const convOk = (conv: Conv, converterRow: boolean, pointOk = !converterRow) =>
  conv === "any" || (conv === "point" ? pointOk : (conv === "only") === converterRow);

/** Binding variant of a sealed descriptor's frozen recipe arm (role does not change the variant). */
export function mimirFusedRecipeBindingVariant(d: Pick<MimirFusedRecipe, "adapterType" | "adapterVersion" | "mode" | "externalWidth" | "temporalKind">): 0 | 1 {
  const row = RECIPES.find(([t, vs, mode, e, kinds]) => t === d.adapterType && vs.includes(d.adapterVersion) && mode === d.mode &&
    e === d.externalWidth && (kinds as readonly number[]).includes(d.temporalKind));
  return row ? row[6] : reject(`UnsupportedCompositeExecutionRecipe: adapter ${d.adapterType} v${d.adapterVersion} mode ${d.mode} E=${d.externalWidth}`);
}

/** Byte-for-byte port of frozen `admitted_recipe`. */
export function mimirAdmittedRecipe(a: Readonly<{ adapterType: number; adapterVersion: number; accountsBindingVersion: number; mode: number;
  externalWidth: number; temporalKind: number; converterRow: boolean; /** Frozen `point_ok`: a primary row (default: not a converter row). */ pointOk?: boolean }>): MimirAdmittedRecipe {
  if (a.accountsBindingVersion !== 0 && a.accountsBindingVersion !== 1) return reject("UnsupportedCompositeExecutionRecipe: plan binding version");
  const row = RECIPES.find(([t, vs, mode, e, kinds, conv]) => t === a.adapterType && vs.includes(a.adapterVersion) && mode === a.mode &&
    e === a.externalWidth && (kinds as readonly number[]).includes(a.temporalKind) && convOk(conv, a.converterRow, a.pointOk));
  if (!row || (row[7] === 0 && a.accountsBindingVersion !== 1)) return reject(`UnsupportedCompositeExecutionRecipe: adapter ${a.adapterType} v${a.adapterVersion} mode ${a.mode} E=${a.externalWidth}`);
  const [, , mode, e, , , bindingVariant, legacy, fixed, tag77Roles] = row;
  return { mode, temporalKind: a.temporalKind as MimirFusedTemporalKind, externalWidth: e, requiresInstructionsSysvar: mode === 4 || mode === 5 || a.temporalKind === 6,
    bindingVariant, bindingWidth: a.accountsBindingVersion === 1 ? fixed : legacy, tag77Roles };
}

/** Byte-for-byte port of frozen `expected_descriptor`: Seal requires the row descriptor to equal this. */
export function mimirExpectedDescriptor(recipe: MimirAdmittedRecipe, source: Readonly<{ adapterType: number; adapterVersion: number; flags: number }>,
  accountsBindingVersion: number, moduleOffset: number): MimirFusedDescriptor {
  const mtp4Flags = recipe.mode === 4 ? 0 : recipe.mode === 5 ? 1 : null;
  if (source.adapterVersion > 255 || source.flags !== (mtp4Flags ?? 0)) return reject("UnsupportedCompositeExecutionRecipe: source flags / version");
  return { minSlotGap: source.flags === 1 ? 0 : 1, externalWidth: recipe.externalWidth, temporalKind: recipe.temporalKind, moduleOffset,
    moduleLength: MIMIR_FUSED_TEMPORAL_MODULE_LENGTH[recipe.temporalKind], mode: recipe.mode, requiresInstructionsSysvar: recipe.requiresInstructionsSysvar,
    adapterType: source.adapterType, adapterVersion: source.adapterVersion, bindingWidth: recipe.bindingWidth,
    accountsBindingVersion: accountsBindingVersion as 0 | 1 };
}

/**
 * Admitted family recipe for a canonical source shape, via the frozen table (§6.4). The mode is the unique table arm for
 * `(family, version, E, temporal kind, role)`; `temporalModuleVersion` is the source_temporal seed version (1/2/3/4), when present.
 */
export function deriveMimirFusedRecipe(args: Readonly<{
  role: "component" | "converter"; adapterType: number; adapterVersion: number; externalWidth: number;
  temporalModuleVersion?: number; currentPoint?: boolean; minSlotGap: number; accountsBindingVersion: number; pointOk?: boolean;
  /** CPMM-v0 / DLMM `DUAL_NATIVE_POINT_V1` (classic primary or composite component; never a converter). */ dual?: boolean;
}>): MimirFusedRecipe {
  const { adapterType: t, temporalModuleVersion: tm } = args;
  const kind = args.dual ? ((t === 2 || t === 3) && tm === undefined ? 6 : -1) : tm === undefined ? 0 : tm === 2 && t === 2 ? 1 : t === 7 && (tm === 1 || tm === 3) ? (tm === 1 ? 2 : 3)
    : tm === 4 && (t === 4 || t === 6 || t === 3) ? (args.currentPoint ? 5 : 4) : -1;
  const converterRow = args.role === "converter";
  const modes = RECIPES.filter(([rt, vs, , e, kinds, conv]) => rt === t && vs.includes(args.adapterVersion) && e === args.externalWidth &&
    (kinds as readonly number[]).includes(kind) && convOk(conv, converterRow, args.pointOk)).map((row) => row[2]);
  if (modes.length !== 1) return reject(`UnsupportedCompositeExecutionRecipe: adapter ${t} v${args.adapterVersion} E=${args.externalWidth}`);
  const recipe = mimirAdmittedRecipe({ ...args, mode: modes[0]!, temporalKind: kind, converterRow });
  const { moduleOffset: _o, moduleLength: _l, ...descriptor } = mimirExpectedDescriptor(recipe,
    { adapterType: t, adapterVersion: args.adapterVersion, flags: args.currentPoint ? 1 : 0 }, args.accountsBindingVersion, 0);
  if (args.minSlotGap !== descriptor.minSlotGap) return reject("UnsupportedCompositeExecutionRecipe: slot gap is program-derived");
  return descriptor;
}

export interface MimirCompositeExecutionLayout {
  readonly componentCount: number;
  readonly converterSourceCount: number;
  readonly rowsEnd: number;
  readonly membershipOffsets: readonly number[];
  readonly modulesOffset: number;
  readonly descriptors: readonly MimirFusedDescriptor[];
  readonly exactLength: number;
  readonly growCount: number;
  /** 2 iff a component row is `DUAL_NATIVE_POINT_V1` (temporal kind 6): the `MIMIRCDP` proof follows the modules. */
  readonly version: 1 | 2;
  readonly proofOffset: number;
  readonly proofLength: number;
}

/** Exact §4.1 layout from components-then-converter-sources recipes; assigns packed module offsets. */
export function mimirCompositeExecutionLayout(components: readonly MimirFusedRecipe[], converterSources: readonly MimirFusedRecipe[]): MimirCompositeExecutionLayout {
  const n = components.length; const s = converterSources.length;
  if (n < 1 || n > 5 || s > 5) return reject("InvalidCompositeExecution: N must be 1..5 and S 0..5");
  const rows = [...components, ...converterSources];
  for (const r of rows) if (!isU(r.bindingWidth, L.maxBindingWidth) || r.bindingWidth < 1 || (r.accountsBindingVersion === 1 && r.bindingWidth > 7)) reject("InvalidCompositeExecution: binding width");
  const b = L.headerLength + L.componentRowLength * n;
  const rowsEnd = s === 0 ? b : b + L.converterFixedLength + L.converterSourceRowLength * s;
  const membershipOffsets: number[] = []; let cursor = rowsEnd;
  for (const r of rows) { membershipOffsets.push(cursor); cursor += L.membershipRecordHeaderLength + L.physicalIdentityLength * r.bindingWidth; }
  const modulesOffset = cursor;
  const descriptors = rows.map((r) => {
    const moduleLength = MIMIR_FUSED_TEMPORAL_MODULE_LENGTH[r.temporalKind];
    const descriptor = { ...r, moduleOffset: moduleLength ? cursor : 0, moduleLength };
    cursor += moduleLength; return descriptor;
  });
  const version = components.some((r) => r.temporalKind === MIMIR_TEMPORAL_CPMM_DUAL_V1) ? 2 : 1;
  const proofOffset = cursor; const proofLength = version === 1 ? 0 : L.proofHeaderLength + L.proofRowLength * n + (s ? L.proofConverterLength : 0);
  cursor += proofLength;
  return { componentCount: n, converterSourceCount: s, rowsEnd, membershipOffsets, modulesOffset, descriptors, exactLength: cursor,
    growCount: Math.ceil(cursor / L.reallocGrowth) - 1, version, proofOffset, proofLength };
}

export function encodeMimirFusedDescriptor(d: MimirFusedDescriptor): Uint8Array {
  if (!isU(d.minSlotGap, 0xffff) || !isU(d.externalWidth, 255) || !isU(d.moduleOffset, 0xffff_ffff) || !isU(d.moduleLength, 0xffff) ||
      MIMIR_FUSED_TEMPORAL_MODULE_LENGTH[d.temporalKind] !== d.moduleLength || (d.moduleLength === 0) !== (d.moduleOffset === 0) ||
      !isU(d.mode, 6) || !isU(d.adapterType, 255) || !isU(d.adapterVersion, 255) || !isU(d.bindingWidth, 8) || d.bindingWidth < 1 || d.accountsBindingVersion > 1) {
    return reject("InvalidCompositeExecution: descriptor");
  }
  return concatBytes(le(2, d.minSlotGap), Uint8Array.of(d.externalWidth, d.temporalKind), le(4, d.moduleOffset), le(2, d.moduleLength),
    Uint8Array.of(d.mode, d.requiresInstructionsSysvar ? 1 : 0, d.adapterType, d.adapterVersion, d.bindingWidth, d.accountsBindingVersion));
}

export function decodeMimirFusedDescriptor(data: Uint8Array): MimirFusedDescriptor {
  if (data.length !== 16) return reject("InvalidCompositeExecution: descriptor length");
  const v = dv(data); const kind = data[3]!;
  if (!(kind in MIMIR_FUSED_TEMPORAL_MODULE_LENGTH) || data[10]! > 6 || data[11]! > 1 || data[14]! < 1 || data[14]! > 8 || data[15]! > 1) {
    return reject("InvalidCompositeExecution: descriptor field");
  }
  const d: MimirFusedDescriptor = { minSlotGap: v.getUint16(0, true), externalWidth: data[2]!, temporalKind: kind as MimirFusedTemporalKind,
    moduleOffset: v.getUint32(4, true), moduleLength: v.getUint16(8, true), mode: data[10] as MimirFusedRecipeMode,
    requiresInstructionsSysvar: data[11] === 1, adapterType: data[12]!, adapterVersion: data[13]!, bindingWidth: data[14]!,
    accountsBindingVersion: data[15] as 0 | 1 };
  encodeMimirFusedDescriptor(d);
  return d;
}

export async function deriveMimirCompositeExecutionAddress(programId: Address, compositeFeedId: Uint8Array): Promise<readonly [Address, number]> {
  if (compositeFeedId.length !== 32 || isZeroBytes(compositeFeedId)) return reject("InvalidCompositeExecutionAddress: feed id");
  return deriveMimirBetaPda({ programId, seed: L.seed, values: [compositeFeedId] });
}

export async function mimirFusedCfcDigest(cfcAddress: Address, cfc: Uint8Array): Promise<Uint8Array> {
  if (cfc.length !== L.cfcLength) return reject("InvalidCompositeFeed: CFC must be 661 bytes");
  return sha256(concatBytes(utf8("MIMIR_FUSED_CFC_V1"), addressBytes(cfcAddress), cfc));
}

export interface MimirMembershipRecord {
  readonly bindingWidth: number; readonly accountsBindingVersion: number; readonly bindingVariant: 0 | 1;
  readonly accounts: readonly Readonly<{ address: Address; owner: Address; executable: boolean }>[];
}

const sealedStrict = <T>(what: string, part: string, fn: () => T): T => { try { return fn(); } catch { return reject(`${what}: ${part}`); } };

/** Seal-copied FeedConfig + SourcingPlan pair: strict images, nonzero revision, and the plan bound to the feed (frozen `validate_sourcing_plan_for_source_refresh`). */
export function mimirSealedFeedPlan(what: string, feedImage: Uint8Array, planImage: Uint8Array) {
  const feed = sealedStrict(what, "feed config image", () => decodeMimirBetaLiveFeed(feedImage));
  const plan = sealedStrict(what, "plan image", () => decodeMimirBetaLivePlanFields(planImage));
  const early = feed.lifecycleState <= 2 && isZeroBytes(feed.sourceSetHash);
  if (feed.feedConfigRevision === 0n || !bytesEqual(plan.feedId, feed.feedId) || plan.priceExponent !== feed.priceExponent ||
      !bytesEqual(plan.baseMint, feed.baseMint) || !bytesEqual(plan.quoteMint, feed.quoteMint) ||
      (!early && !bytesEqual(plan.sourceSetHash, feed.sourceSetHash))) {
    return reject(`${what}: feed/plan binding`);
  }
  return { feed, plan };
}

/** One sealed row: active SourceConfig with nonzero revisions bound to its feed/plan, the frozen derived descriptor and variant, A1.1 zero-as-absent ring/module. */
export function assertMimirSealedRow(a: Readonly<{ what: string; data: Uint8Array; sourceImage: Uint8Array;
  feedPlan: ReturnType<typeof mimirSealedFeedPlan>; descriptor: MimirFusedDescriptor; membership: MimirMembershipRecord; converterRow: boolean; pointOk?: boolean;
  ringOffset: number }>): void {
  const { what, data, descriptor: d, feedPlan: { plan } } = a;
  const source = sealedStrict(what, "source config image", () => decodeMimirBetaLiveSource(a.sourceImage));
  if (source.status !== 0 || source.sourceConfigRevision === 0n || source.sourceSetRevision === 0n || !bytesEqual(plan.feedId, source.feedId) ||
      !bytesEqual(source.baseMint, plan.baseMint) || !bytesEqual(source.quoteMint, plan.quoteMint) || (plan.adapterMask & (1n << BigInt(source.adapterType))) === 0n) {
    reject(`${what}: source config state`);
  }
  const recipe = mimirAdmittedRecipe({ adapterType: source.adapterType, adapterVersion: source.adapterVersion,
    accountsBindingVersion: plan.accountsBindingVersion, mode: d.mode, externalWidth: d.externalWidth, temporalKind: d.temporalKind, converterRow: a.converterRow,
    ...(a.pointOk !== undefined ? { pointOk: a.pointOk } : {}) });
  if (!bytesEqual(encodeMimirFusedDescriptor(mimirExpectedDescriptor(recipe, source, plan.accountsBindingVersion, d.moduleOffset)),
      encodeMimirFusedDescriptor(d)) || a.membership.bindingVariant !== recipe.bindingVariant) {
    reject(`${what}: descriptor differs from the frozen derived layout`);
  }
  const ringBytes = data.subarray(a.ringOffset, a.ringOffset + 544);
  const ring = isZeroBytes(ringBytes) ? null : sealedStrict(what, "ring image", () => decodeMimirBrowserSourceRingV1(ringBytes));
  if (!d.moduleLength) return;
  const module = data.subarray(d.moduleOffset, d.moduleOffset + d.moduleLength);
  if (isZeroBytes(module)) return;
  if (!ring) reject(`${what}: temporal module without ring`);
  sealedStrict(what, `temporal module image (kind ${d.temporalKind})`, () => d.temporalKind === 1 ? decodeMimirBrowserCpmmQuietTemporalModuleV2(module, ring!)
    : d.temporalKind === 2 ? decodeMimirBrowserSourceTemporalModuleV1(module, ring!)
    : d.temporalKind === 3 ? decodeMimirBrowserDammReserveTemporalModuleV3(module, ring!)
    : d.temporalKind === 4 ? decodeMimirSampledTemporalModule(module, mimirSampledClosureFromRing(module, ringBytes))
    : decodeMimirCurrentPointModule(module));
}

/** Strict `CompositeExecutionV1` decoder: header, layout, descriptors, membership table, and module placement. */
export function decodeMimirCompositeExecution(data: Uint8Array) {
  if (data.length < L.headerLength || !bytesEqual(data.subarray(0, 8), utf8(L.magic))) return reject("InvalidCompositeExecution: magic");
  const v = dv(data);
  const header = { version: v.getUint16(8, true), headerLength: v.getUint16(10, true), exactLength: v.getUint32(12, true),
    compositeFeedId: Uint8Array.from(data.subarray(16, 48)), cfc: bytesAddress(data.subarray(48, 80)), cfcDigest: Uint8Array.from(data.subarray(80, 112)),
    cfcRevision: v.getBigUint64(112, true), componentCount: data[120]!, bump: data[121]!, status: data[122]!, converterSourceCount: data[123]! };
  if ((header.version !== 1 && header.version !== 2) || header.headerLength !== 128 || header.exactLength !== data.length || header.status > 1 ||
      header.componentCount < 1 || header.componentCount > 5 || header.converterSourceCount > 5 || !isZeroBytes(data.subarray(124, 128)) ||
      isZeroBytes(header.compositeFeedId) || (header.status === 1 && (isZeroBytes(header.cfcDigest) || header.cfcRevision === 0n))) {
    return reject("InvalidCompositeExecution: header");
  }
  const n = header.componentCount; const s = header.converterSourceCount;
  const b = L.headerLength + L.componentRowLength * n;
  const rowOffsets = [...Array.from({ length: n }, (_, i) => L.headerLength + L.componentRowLength * i),
    ...Array.from({ length: s }, (_, j) => b + CONV_SOURCE.descriptor + L.converterSourceRowLength * j)];
  const rowsEnd = s === 0 ? b : b + L.converterFixedLength + L.converterSourceRowLength * s;
  if (data.length < rowsEnd) return reject("InvalidCompositeExecution: length");
  const descriptors = rowOffsets.map((o) => decodeMimirFusedDescriptor(data.subarray(o, o + 16)));
  const layout = mimirCompositeExecutionLayout(descriptors.slice(0, n), descriptors.slice(n));
  if (layout.exactLength !== data.length || layout.version !== header.version || layout.descriptors.some((d, i) =>
    d.moduleOffset !== descriptors[i]!.moduleOffset || d.moduleLength !== descriptors[i]!.moduleLength)) {
    return reject("InvalidCompositeExecution: layout");
  }
  const membership: MimirMembershipRecord[] = layout.membershipOffsets.map((o, r) => {
    const k = data[o]!; const bindingVersion = data[o + 1]!; const variant = data[o + 2]!;
    if (k !== descriptors[r]!.bindingWidth || bindingVersion !== descriptors[r]!.accountsBindingVersion || variant > 1 || data[o + 3] !== 0) {
      reject("InvalidCompositeExecution: membership record");
    }
    const accounts = Array.from({ length: k }, (_, i) => {
      const a = o + 4 + 65 * i;
      if (data[a + 64]! > 1) reject("InvalidCompositeExecution: executable bit");
      return { address: bytesAddress(data.subarray(a, a + 32)), owner: bytesAddress(data.subarray(a + 32, a + 64)), executable: data[a + 64] === 1 };
    });
    return { bindingWidth: k, accountsBindingVersion: bindingVersion, bindingVariant: variant as 0 | 1, accounts };
  });
  // Embedded images (frozen Seal copies) and A1.1 zero-as-absent private regions, then the program-derived descriptor/variant.
  const what = "InvalidCompositeExecution";
  const conv = s === 0 ? null : mimirSealedFeedPlan(what, data.subarray(b + CONV.feedConfig, b + CONV.plan), data.subarray(b + CONV.plan, b + CONV.twap));
  if (s !== 0) {
    const twap = data.subarray(b + CONV.twap, b + CONV.snapshot); const snapshot = data.subarray(b + CONV.snapshot, b + L.converterFixedLength);
    if (!isZeroBytes(twap)) sealedStrict(what, "converter TWAP image", () => decodeFeedTwapStateHeader(twap));
    if (!isZeroBytes(snapshot)) sealedStrict(what, "converter snapshot image", () => decodeFeedSnapshotHeader(snapshot));
  }
  for (let r = 0; r < n + s; r += 1) {
    const converterRow = r >= n;
    const o = converterRow ? b + L.converterSourceRowLength * (r - n) : rowOffsets[r]!;
    assertMimirSealedRow({ what, data, descriptor: descriptors[r]!, membership: membership[r]!, converterRow,
      sourceImage: converterRow ? data.subarray(o + CONV_SOURCE.sourceConfig, o + CONV_SOURCE.ring) : data.subarray(o + ROW.sourceConfig, o + ROW.feedConfig),
      feedPlan: converterRow ? conv! : mimirSealedFeedPlan(what, data.subarray(o + ROW.feedConfig, o + ROW.plan), data.subarray(o + ROW.plan, o + ROW.ring)),
      ringOffset: o + (converterRow ? CONV_SOURCE.ring : ROW.ring) });
  }
  const ringNewestSlot = (ringOffset: number) => v.getBigUint64(ringOffset + RING_NEWEST_SLOT, true);
  const ringCompletedEndSlot = (ringOffset: number) => v.getBigUint64(ringOffset + RING_COMPLETED_END_SLOT, true);
  const components = Array.from({ length: n }, (_, i) => {
    const o = rowOffsets[i]!;
    return { descriptor: descriptors[i]!, sourceConfigImage: data.subarray(o + ROW.sourceConfig, o + ROW.feedConfig),
      feedConfigImage: data.subarray(o + ROW.feedConfig, o + ROW.plan), planImage: data.subarray(o + ROW.plan, o + ROW.ring),
      sourceConfigRevision: v.getBigUint64(o + ROW.sourceConfig + SOURCE_CONFIG_REVISION, true),
      ringNewestSlot: ringNewestSlot(o + ROW.ring), ringCompletedEndSlot: ringCompletedEndSlot(o + ROW.ring), membership: membership[i]! };
  });
  const converter = s === 0 ? null : {
    feedConfigImage: data.subarray(b + CONV.feedConfig, b + CONV.plan), planImage: data.subarray(b + CONV.plan, b + CONV.twap),
    sources: Array.from({ length: s }, (_, j) => {
      const o = b + L.converterSourceRowLength * j;
      return { descriptor: descriptors[n + j]!, sourceConfigImage: data.subarray(o + CONV_SOURCE.sourceConfig, o + CONV_SOURCE.ring),
        ringNewestSlot: ringNewestSlot(o + CONV_SOURCE.ring), membership: membership[n + j]! };
    }) };
  const proof = layout.version === 2 ? decodeMimirCompositeDualProof(data.subarray(layout.proofOffset), descriptors.slice(0, n), s) : null;
  if (proof && !(header.status === 1)) reject("InvalidCompositeExecution: proof before activation");
  return { ...header, active: header.status === 1, layout, components, converter, proof };
}
export type MimirCompositeExecution = ReturnType<typeof decodeMimirCompositeExecution>;

// ---------------------------------------------------------------------------------------------------------------------
// CompositeExecutionV2: `CompositeDualPublicationProofV2` (MIMIRCDP) after the body; header unchanged (80..112 = CFC digest).

const ROW_PROFILES = ["FIXED_RECIPE", "DUAL_NATIVE_POINT_V1"] as const;
const ROW_MODES = [undefined, "NATIVE", "CURRENT_POINT", "FIXED_NON_POINT"] as const;
const ROW_REASONS = ["NATIVE_QUALIFIED", "NATIVE_ENDPOINT_STALE", "INSUFFICIENT_CONNECTED_HISTORY", "REBUILDING_AFTER_GAP"] as const;
const ROW_BOUNDS = [undefined, "NATIVE_CERTIFIED", "POINT_DEPTH_UNCERTIFIED", "EXISTING_COMPOSITE_V1"] as const;
/** Fresh admissible `[profile, mode, reason, bound]` tuples: DUAL rows (kind 6; reason 3 DLMM only), fixed current point (mode 5), other fixed rows. */
const DUAL_TUPLES = ["1.1.0.1", "1.2.1.2", "1.2.2.2"]; const DLMM_GAP_TUPLE = "1.2.3.2"; const FIXED_POINT_TUPLE = "0.2.0.2"; const FIXED_TUPLE = "0.3.0.3";

export interface MimirCompositeRowDecisionV2 {
  readonly profile: (typeof ROW_PROFILES)[number];
  readonly effectiveMode: "NATIVE" | "CURRENT_POINT" | "FIXED_NON_POINT";
  readonly nativeQualificationReason: (typeof ROW_REASONS)[number];
  readonly appliedBoundKind: "NATIVE_CERTIFIED" | "POINT_DEPTH_UNCERTIFIED" | "EXISTING_COMPOSITE_V1";
  /** Applied floor in the row's quote atoms: native floor (DUAL native) or F_point (point). */
  readonly evidence: MimirClassicEvidenceV1;
}
export interface MimirCompositeDualProofV2 {
  readonly converterPresent: boolean; readonly currentPoint: boolean;
  readonly parentRevision: bigint; readonly parentSlot: bigint; readonly cspCommitment: Uint8Array;
  /** `null` = all-zero record: a DUAL row stamped below floor, or a row without a price in a NO_PRICE CSP (Degraded parent only). */
  readonly rows: readonly (MimirCompositeRowDecisionV2 | null)[];
  readonly converter: Readonly<{ feedId: Uint8Array; snapshotRevision: bigint; snapshotSlot: bigint; validUntilSlot: bigint }> | null;
}

const tupleOf = (r: Pick<MimirCompositeRowDecisionV2, "profile" | "effectiveMode" | "nativeQualificationReason" | "appliedBoundKind">) =>
  [ROW_PROFILES.indexOf(r.profile), ROW_MODES.indexOf(r.effectiveMode), ROW_REASONS.indexOf(r.nativeQualificationReason), ROW_BOUNDS.indexOf(r.appliedBoundKind)];
function assertRowTuple(d: MimirFusedDescriptor, r: MimirCompositeRowDecisionV2): void {
  const key = tupleOf(r).join(".");
  const ok = d.temporalKind === MIMIR_TEMPORAL_DUAL_NATIVE_POINT_V1 ? DUAL_TUPLES.includes(key) || (d.adapterType === 3 && key === DLMM_GAP_TUPLE)
    : key === (d.mode === 5 ? FIXED_POINT_TUPLE : FIXED_TUPLE);
  const point = r.effectiveMode === "CURRENT_POINT";
  if (!ok || r.evidence.point !== point || (point && (r.evidence.supportStart !== 0n || r.evidence.supportEnd !== 0n)) ||
      (r.profile === "DUAL_NATIVE_POINT_V1" && !point && !r.evidence.commonSupport)) {
    reject("InvalidCompositeExecution: proof row decision");
  }
}

/** Strict `MIMIRCDP` decoder over the exact proof region; all-zero = unpublished (`null`). */
export function decodeMimirCompositeDualProof(p: Uint8Array, components: readonly MimirFusedDescriptor[], converterSourceCount: number): MimirCompositeDualProofV2 | null {
  const n = components.length; const len = L.proofHeaderLength + L.proofRowLength * n + (converterSourceCount ? L.proofConverterLength : 0);
  if (p.length !== len) return reject("InvalidCompositeExecution: proof length");
  if (isZeroBytes(p)) return null;
  const v = dv(p); const flags = v.getUint32(12, true);
  if (!bytesEqual(p.subarray(0, 8), utf8(L.proofMagic)) || v.getUint16(8, true) !== L.proofVersion || v.getUint16(10, true) !== len ||
      flags > 7 || (flags & 1) === 0 || ((flags & 2) !== 0) !== (converterSourceCount > 0)) {
    return reject("InvalidCompositeExecution: proof header");
  }
  const parentRevision = v.getBigUint64(16, true); const parentSlot = v.getBigUint64(24, true); const cspCommitment = Uint8Array.from(p.subarray(32, 64));
  if (parentRevision === 0n || parentSlot === 0n || isZeroBytes(cspCommitment)) reject("InvalidCompositeExecution: proof publication");
  const rows = components.map((d, i): MimirCompositeRowDecisionV2 | null => {
    const o = L.proofHeaderLength + L.proofRowLength * i;
    if (isZeroBytes(p.subarray(o, o + L.proofRowLength))) return null;
    const profile = ROW_PROFILES[p[o + 80]!]; const effectiveMode = ROW_MODES[p[o + 81]!];
    const nativeQualificationReason = ROW_REASONS[p[o + 82]!]; const appliedBoundKind = ROW_BOUNDS[p[o + 83]!];
    if (!profile || !effectiveMode || !nativeQualificationReason || !appliedBoundKind) reject("InvalidCompositeExecution: proof row code");
    const row = { profile: profile!, effectiveMode: effectiveMode!, nativeQualificationReason: nativeQualificationReason!, appliedBoundKind: appliedBoundKind!,
      evidence: decodeEvidence(p.subarray(o, o + 80)) };
    assertRowTuple(d, row);
    return row;
  });
  const currentPoint = rows.some((r) => r?.effectiveMode === "CURRENT_POINT");
  if (((flags & 4) !== 0) !== currentPoint) reject("InvalidCompositeExecution: proof CURRENT_POINT flag");
  let converter: MimirCompositeDualProofV2["converter"] = null;
  if (converterSourceCount) {
    const o = L.proofHeaderLength + L.proofRowLength * n;
    converter = { feedId: Uint8Array.from(p.subarray(o, o + 32)), snapshotRevision: v.getBigUint64(o + 32, true), snapshotSlot: v.getBigUint64(o + 40, true),
      validUntilSlot: v.getBigUint64(o + 48, true) };
    if (isZeroBytes(converter.feedId) || converter.snapshotRevision === 0n || converter.snapshotSlot === 0n || converter.validUntilSlot < converter.snapshotSlot) {
      reject("InvalidCompositeExecution: proof converter");
    }
  }
  return { converterPresent: converterSourceCount > 0, currentPoint, parentRevision, parentSlot, cspCommitment, rows, converter };
}

export function encodeMimirCompositeDualProof(proof: MimirCompositeDualProofV2, components: readonly MimirFusedDescriptor[], converterSourceCount: number): Uint8Array {
  const n = components.length;
  if (proof.rows.length !== n || proof.converterPresent !== (converterSourceCount > 0) || (proof.converter !== null) !== proof.converterPresent ||
      !u64ok(proof.parentRevision) || !u64ok(proof.parentSlot) || proof.cspCommitment.length !== 32) {
    return reject("InvalidCompositeExecution: proof");
  }
  const out = new Uint8Array(L.proofHeaderLength + L.proofRowLength * n + (converterSourceCount ? L.proofConverterLength : 0)); const v = dv(out);
  out.set(utf8(L.proofMagic)); v.setUint16(8, L.proofVersion, true); v.setUint16(10, out.length, true);
  v.setUint32(12, 1 | (proof.converterPresent ? 2 : 0) | (proof.currentPoint ? 4 : 0), true);
  v.setBigUint64(16, proof.parentRevision, true); v.setBigUint64(24, proof.parentSlot, true); out.set(proof.cspCommitment, 32);
  proof.rows.forEach((r, i) => { const o = L.proofHeaderLength + L.proofRowLength * i; if (r) { out.set(encodeEvidence(r.evidence), o); out.set(tupleOf(r), o + 80); } });
  if (proof.converter) {
    const o = L.proofHeaderLength + L.proofRowLength * n;
    out.set(proof.converter.feedId, o); v.setBigUint64(o + 32, proof.converter.snapshotRevision, true);
    v.setBigUint64(o + 40, proof.converter.snapshotSlot, true); v.setBigUint64(o + 48, proof.converter.validUntilSlot, true);
  }
  decodeMimirCompositeDualProof(out, components, converterSourceCount);
  return out;
}

/** `sha256("MIMIR_DUAL_COMPOSITE_CSP_V2\0" || program || execution || csp || csp_data[720])`: the proof's commitment to the exact parent CSP. */
export async function mimirCompositeCspCommitmentV2(programId: Address, execution: Address, csp: Address, cspData: Uint8Array): Promise<Uint8Array> {
  if (cspData.length !== L.cspLength) return reject("InvalidCompositeSnapshot: CSP must be 720 bytes");
  return sha256(concatBytes(utf8("MIMIR_DUAL_COMPOSITE_CSP_V2"), Uint8Array.of(0), addressBytes(programId), addressBytes(execution), addressBytes(csp), cspData));
}

/**
 * Typed readout of an authenticated V2 execution and its parent CSP: per-row profile/mode/reason/bound/floor and the parent CURRENT_POINT
 * flag (CSP flags@12). `null` for a V1 execution. Unpublished proof = `UNAVAILABLE` rows. A proof that does not commit to this exact CSP
 * (revision, slot, flag, hash) is refused, never mixed.
 */
export async function mimirCompositeDualPublication(a: Readonly<{ programId: Address; execution: Address; state: MimirCompositeExecution;
  csp: Readonly<{ address: Address; data: Uint8Array }> | null }>) {
  const { state } = a;
  if (state.version !== 2) return null;
  const descriptors = state.layout.descriptors.slice(0, state.componentCount);
  const p = state.proof;
  const unavailable = (d: MimirFusedDescriptor) => Object.freeze({
    profile: d.temporalKind === MIMIR_TEMPORAL_DUAL_NATIVE_POINT_V1 ? "DUAL_NATIVE_POINT_V1" as const : "FIXED_RECIPE" as const, effectiveMode: "UNAVAILABLE" as const,
    nativeQualificationReason: null, appliedBoundKind: "NONE" as const, floor: 0n });
  if (!p) return Object.freeze({ parentCurrentPoint: null, parentRevision: 0n, parentSlot: 0n, rows: descriptors.map(unavailable) });
  const header = a.csp ? (() => { try { return decodeMimirBrowserCompositePublication(a.csp!.data); } catch { return null; } })() : null;
  if (!a.csp || !header || a.csp.data.length !== L.cspLength || !bytesEqual(header.compositeFeedId, state.compositeFeedId) || header.snapshotRevision !== p.parentRevision ||
      header.snapshotSlot !== p.parentSlot || (header.flags === 1) !== p.currentPoint || p.rows.some((r, i) => !r && !(header.degraded && (header.degraded.noPrice || (header.degraded.rowsMask >> i) & 1))) ||
      !bytesEqual(await mimirCompositeCspCommitmentV2(a.programId, a.execution, a.csp.address, a.csp.data), p.cspCommitment)) {
    return reject("CompositeExecutionDefinitionMismatch: proof does not commit to this CSP");
  }
  return Object.freeze({ parentCurrentPoint: p.currentPoint, parentRevision: p.parentRevision, parentSlot: p.parentSlot, rows: p.rows.map((r, i) => !r ? unavailable(descriptors[i]!) : Object.freeze({
    profile: r.profile, effectiveMode: r.effectiveMode, nativeQualificationReason: r.nativeQualificationReason as (typeof ROW_REASONS)[number] | null,
    appliedBoundKind: r.appliedBoundKind as MimirCompositeRowDecisionV2["appliedBoundKind"] | "NONE", floor: r.evidence.nativeFloor })) });
}
export type MimirCompositeDualPublication = NonNullable<Awaited<ReturnType<typeof mimirCompositeDualPublication>>>;

export type MimirCompositeComponentPricingMode = "NATIVE" | "CURRENT_POINT" | "SPOT_OR_NATIVE" | "UNAVAILABLE";
/**
 * Per-component pricing mode of a decoded execution (display/consumer information; the CSP flag stays the authenticated aggregate):
 * CEF V2 rows read the `MIMIRCDP` decision (unpublished = `UNAVAILABLE`), fixed current-point rows are `CURRENT_POINT`, other rows `SPOT_OR_NATIVE`.
 */
export function mimirCompositeComponentPricingModes(state: MimirCompositeExecution): readonly Readonly<{ mode: MimirCompositeComponentPricingMode;
  reason: MimirCompositeRowDecisionV2["nativeQualificationReason"] | null }>[] {
  return state.layout.descriptors.slice(0, state.componentCount).map((d, i) => {
    const row = state.proof?.rows[i];
    if (d.temporalKind === MIMIR_TEMPORAL_DUAL_NATIVE_POINT_V1) {
      return row ? { mode: row.effectiveMode as "NATIVE" | "CURRENT_POINT", reason: row.nativeQualificationReason } : { mode: "UNAVAILABLE", reason: null };
    }
    return { mode: d.mode === 5 ? "CURRENT_POINT" : "SPOT_OR_NATIVE", reason: null };
  });
}

export const meta = (address: Address, isSigner: boolean, isWritable: boolean) => ({ address, isSigner, isWritable });
export const ro = (address: Address) => meta(address, false, false);

function feedIdBytes(id: Uint8Array): Uint8Array {
  if (!(id instanceof Uint8Array) || id.length !== 32 || isZeroBytes(id)) return reject("InvalidInstruction: composite feed id");
  return id;
}

type InitTag = typeof MIMIR_INIT_FUSED_COMPOSITE_TAG | 90;
const initTag = (tag: InitTag) => (tag === 88 || tag === 90 ? tag : reject("InvalidInstruction: init tag"));

export function encodeMimirInitFusedBeginData(a: Readonly<{ compositeFeedId: Uint8Array; componentCount: number; converterSourceCount: number; finalLength: number }>, tag: InitTag = 88): Uint8Array {
  if (!isU(a.componentCount, 5) || a.componentCount < 1 || !isU(a.converterSourceCount, 5) || !isU(a.finalLength, 0xffff_ffff) || a.finalLength <= L.headerLength) {
    return reject(`InvalidInstruction: tag-${tag} BEGIN`);
  }
  return concatBytes(Uint8Array.of(initTag(tag), 0), feedIdBytes(a.compositeFeedId), Uint8Array.of(a.componentCount, a.converterSourceCount), le(4, a.finalLength));
}

export function encodeMimirInitFusedGrowData(a: Readonly<{ compositeFeedId: Uint8Array; expectedCurrentLength: number }>, tag: InitTag = 88): Uint8Array {
  if (!isU(a.expectedCurrentLength, 0xffff_ffff) || a.expectedCurrentLength < 1) return reject(`InvalidInstruction: tag-${tag} GROW`);
  return concatBytes(Uint8Array.of(initTag(tag), 1), feedIdBytes(a.compositeFeedId), le(4, a.expectedCurrentLength));
}

/** `InitSourceWitnessV1`: the 285-byte tag-88/90 SEAL source witness. Previous-head is zero for the initializer. */
export interface MimirInitSourceWitness {
  readonly feedId: Uint8Array; readonly sourceIndex: number; readonly ringVersion: number; readonly minSlotGap: number;
  readonly expectedSourceConfigRevision: bigint; readonly expectedSourceSetRevision: bigint; readonly expectedPlanHash: Uint8Array;
  readonly sourceSetSiblings: readonly Uint8Array[]; readonly accountsSiblings: readonly Uint8Array[];
}

function encodeWitness(w: MimirInitSourceWitness): Uint8Array {
  const sibs = [...w.sourceSetSiblings, ...w.accountsSiblings];
  if (feedIdBytes(w.feedId) && (!isU(w.sourceIndex, 63) || w.ringVersion !== 1 || !isU(w.minSlotGap, 0xffff) ||
      w.expectedSourceConfigRevision !== 1n || w.expectedSourceSetRevision !== 1n || w.expectedPlanHash.length !== 32 ||
      w.sourceSetSiblings.length !== 3 || w.accountsSiblings.length !== 3 || sibs.some((x) => x.length !== 32))) {
    return reject("InvalidInstruction: tag-88 SEAL source witness");
  }
  const out = concatBytes(w.feedId, Uint8Array.of(w.sourceIndex), le(2, w.ringVersion), le(2, w.minSlotGap),
    le(8, w.expectedSourceConfigRevision), le(8, w.expectedSourceSetRevision), le(8, 0n), w.expectedPlanHash, ...sibs);
  if (out.length !== L.sealWitnessLength) return reject("InvalidInstruction: witness length");
  return out;
}

export function encodeMimirInitFusedSealData(a: Readonly<{ compositeFeedId: Uint8Array; layout: MimirInitLayout; witnesses: readonly MimirInitSourceWitness[] }>, tag: InitTag = 88): Uint8Array {
  const w = a.layout.componentCount + a.layout.converterSourceCount;
  if (a.witnesses.length !== w) return reject(`InvalidInstruction: tag-${tag} SEAL witness count`);
  a.witnesses.forEach((x, r) => { if (x.minSlotGap !== a.layout.descriptors[r]!.minSlotGap) reject("CompositeExecutionDefinitionMismatch: slot gap"); });
  const out = concatBytes(Uint8Array.of(initTag(tag), 2), feedIdBytes(a.compositeFeedId), Uint8Array.of(a.layout.componentCount, a.layout.converterSourceCount),
    ...a.layout.descriptors.map(encodeMimirFusedDescriptor), ...a.witnesses.map(encodeWitness));
  if (out.length !== 36 + 301 * w) return reject(`InvalidInstruction: tag-${tag} SEAL length`);
  return out;
}

export interface MimirInitFusedComponentAccounts {
  readonly sourceConfig: Address; readonly feedConfig: Address; readonly sourcingPlan: Address; readonly externals: readonly Address[];
}
export interface MimirInitFusedConverterAccounts {
  readonly feedConfig: Address; readonly sourcingPlan: Address;
  readonly sources: readonly Readonly<{ sourceConfig: Address; externals: readonly Address[] }>[];
}

/** The layout facts BEGIN/GROW/SEAL need; shared by `CompositeExecutionV1` (tag 88) and `ClassicExecutionV1` (tag 90). */
export type MimirInitLayout = Pick<MimirCompositeExecutionLayout, "componentCount" | "converterSourceCount" | "descriptors" | "exactLength" | "growCount">;

/**
 * Contiguous complete tag-88/90 closure: BEGIN at `min(final, 10,240)`, exactly `growCount` GROWs of at most 10,240 bytes, SEAL.
 * One TxV1 must carry it unbroken.
 */
export function buildMimirInitFusedClosure(a: Readonly<{
  tag: InitTag; programId: Address; payer: Address; execution: Address; collateralLock: Address; feedId: Uint8Array; layout: MimirInitLayout;
  witnesses: readonly MimirInitSourceWitness[]; beginAccounts: readonly Address[]; beginWritable?: readonly Address[]; sealAccounts: readonly Address[];
}>): MimirBetaInstruction[] {
  const { layout, tag } = a;
  if (tag === 88) assertMimirClassicConverterAdmitted(layout.descriptors.slice(layout.componentCount));
  const payer = meta(a.payer, true, true); const exe = meta(a.execution, false, true);
  const begin: MimirBetaInstruction = { programAddress: a.programId, data: encodeMimirInitFusedBeginData({ compositeFeedId: a.feedId,
    componentCount: layout.componentCount, converterSourceCount: layout.converterSourceCount, finalLength: layout.exactLength }, tag),
    accounts: [payer, exe, ...a.beginAccounts.map((x) => meta(x, false, a.beginWritable?.includes(x) ?? false)),
      ro(MIMIR_BETA_SYSTEM_PROGRAM_ID), ro(MIMIR_INSTRUCTIONS_SYSVAR_ID), ro(a.collateralLock)] };
  const grows = Array.from({ length: layout.growCount }, (_, g): MimirBetaInstruction => ({ programAddress: a.programId,
    data: encodeMimirInitFusedGrowData({ compositeFeedId: a.feedId, expectedCurrentLength: Math.min(L.reallocGrowth * (g + 1), layout.exactLength) }, tag),
    accounts: [payer, exe, ro(MIMIR_BETA_SYSTEM_PROGRAM_ID), ro(MIMIR_INSTRUCTIONS_SYSVAR_ID)] }));
  const seal: MimirBetaInstruction = { programAddress: a.programId,
    data: encodeMimirInitFusedSealData({ compositeFeedId: a.feedId, layout, witnesses: a.witnesses }, tag),
    accounts: [payer, exe, ...a.sealAccounts.map(ro), ro(MIMIR_INSTRUCTIONS_SYSVAR_ID)] };
  return [begin, ...grows, seal];
}

/** Tag 88/90 BEGIN requires `payer == FeedCollateralLock.creator`; refuse before building/sending. */
export function assertMimirInitPayerIsFeedCreator(lockData: Uint8Array | null | undefined, payer: Address, lock: Address): void {
  let creator: Uint8Array;
  try { creator = decodeFeedCollateralLockHeader(lockData ?? new Uint8Array(0)).creator; } catch { return betaError("ACCOUNT_MALFORMED", "feed collateral lock is missing or malformed", lock); }
  if (!bytesEqual(creator, addressBytes(payer))) betaError("INIT_PAYER_NOT_FEED_CREATOR", "execution init payer must be the feed creator", lock);
}

export function checkVectors(layout: MimirInitLayout, vectors: readonly (readonly Address[])[]) {
  if (vectors.length !== layout.descriptors.length) reject("CompositeExecutionDefinitionMismatch: row count");
  vectors.forEach((v, r) => {
    if (v.length !== layout.descriptors[r]!.externalWidth) reject("CompositeExecutionDefinitionMismatch: external vector width");
    const roles = v.filter((x, i) => !(x === MIMIR_BETA_SYSTEM_PROGRAM_ID && layout.descriptors[r]!.adapterType === 4 && i === 3));
    if (new Set(roles).size !== roles.length) reject("InvalidInstruction: duplicate role inside one external vector");
  });
}

/**
 * Contiguous complete tag-88 closure: BEGIN, exactly `growCount` GROWs, SEAL (§5). One TxV1 must carry it unbroken.
 */
export function buildMimirInitFusedCompositeClosure(a: Readonly<{
  programId: Address; payer: Address; execution: Address; collateralLock: Address; compositeConfig: Address; registry: Address; compositeFeedId: Uint8Array;
  layout: MimirCompositeExecutionLayout; witnesses: readonly MimirInitSourceWitness[];
  components: readonly MimirInitFusedComponentAccounts[]; converter?: MimirInitFusedConverterAccounts;
}>): MimirBetaInstruction[] {
  const { layout } = a;
  if (a.components.length !== layout.componentCount || (a.converter?.sources.length ?? 0) !== layout.converterSourceCount) {
    return reject("CompositeExecutionDefinitionMismatch: account rows");
  }
  checkVectors(layout, [...a.components.map((c) => c.externals), ...(a.converter?.sources.map((s) => s.externals) ?? [])]);
  return buildMimirInitFusedClosure({ tag: 88, programId: a.programId, payer: a.payer, execution: a.execution, collateralLock: a.collateralLock, feedId: a.compositeFeedId,
    layout, witnesses: a.witnesses, beginAccounts: [a.compositeConfig],
    sealAccounts: [a.compositeConfig, a.registry, MIMIR_BETA_SYSTEM_PROGRAM_ID,
      ...a.components.flatMap((c, r) => [c.sourceConfig, c.feedConfig, c.sourcingPlan, ...staticSeal(layout, r, c.externals)]),
      ...(a.converter ? [a.converter.feedConfig, a.converter.sourcingPlan,
        ...a.converter.sources.flatMap((s, j) => [s.sourceConfig, ...staticSeal(layout, layout.componentCount + j, s.externals)])] : [])] });
}

/** Tag-88 static SEAL width: a static-v1 row carries its bound prefix plus the MTP4 generation pins; tag 87 keeps the full vector. */
export function mimirStaticSealWidth(d: Pick<MimirFusedDescriptor, "accountsBindingVersion" | "mode" | "bindingWidth" | "externalWidth">): number {
  if (d.accountsBindingVersion !== 1) return d.externalWidth;
  return d.mode === 4 || d.mode === 5 ? d.externalWidth : Math.min(d.bindingWidth, d.externalWidth);
}

const staticSeal = (layout: MimirInitLayout, r: number, externals: readonly Address[]) => externals.slice(0, mimirStaticSealWidth(layout.descriptors[r]!));

export interface MimirFusedRefreshRequest {
  readonly compositeFeedId: Uint8Array;
  readonly expectedConfigRevision: bigint;
  /** Publish or ensure-sample: floor on the current composite snapshot revision. Exact sample-only: exact. */
  readonly previousSnapshotRevision: bigint;
  /** Publish: minimum landed revision; a fresh composite snapshot at or above it is reused (no fee), else `current+1` is published. */
  readonly nextSnapshotRevision: bigint;
  readonly componentSourceConfigRevisions: readonly bigint[];
  /** Cap, charged only when a publication happens. */
  readonly maxRefreshFeeLamports: bigint;
  /** Publish or ensure-sample: per-row lower bounds. Exact sample-only: exact. */
  readonly componentRingNewestSlots: readonly bigint[];
  readonly converterRingNewestSlots: readonly bigint[];
  /** Publish bytes 64..66 (high bytes of the first component revision): reuse window in slots, capped at the max snapshot age. Absent = 0 = same slot only. */
  readonly maxReuseAgeSlots?: number;
  /** Sample-only byte 63 = 1: a row already sampled past its floor is kept (no write), others sample from the actual predecessor. */
  readonly ensureSample?: boolean;
}

export function encodeMimirFusedRefreshData(r: MimirFusedRefreshRequest): Uint8Array {
  const n = r.componentSourceConfigRevisions.length;
  if (n < 1 || n > 5 || r.componentRingNewestSlots.length !== n || r.converterRingNewestSlots.length > 5 ||
      r.expectedConfigRevision !== 1n || !u64ok(r.previousSnapshotRevision) || !u64ok(r.maxRefreshFeeLamports) ||
      (r.nextSnapshotRevision !== r.previousSnapshotRevision && r.nextSnapshotRevision !== r.previousSnapshotRevision + 1n) ||
      (r.nextSnapshotRevision === r.previousSnapshotRevision && r.maxRefreshFeeLamports !== 0n) ||
      !u64ok(r.nextSnapshotRevision) || r.componentSourceConfigRevisions.some((x) => x !== 1n) ||
      [...r.componentRingNewestSlots, ...r.converterRingNewestSlots].some((x) => !u64ok(x)) || !isU(r.maxReuseAgeSlots ?? 0, 0xffff) ||
      (r.ensureSample === true && r.nextSnapshotRevision !== r.previousSnapshotRevision)) {
    return reject("InvalidInstruction: tag-87 CAS request");
  }
  const out = concatBytes(Uint8Array.of(87), feedIdBytes(r.compositeFeedId), le(8, r.expectedConfigRevision), le(8, r.previousSnapshotRevision),
    le(8, r.nextSnapshotRevision), Uint8Array.of(n), ...Array.from({ length: 5 }, (_, i) => le(8, r.componentSourceConfigRevisions[i] ?? 0n)),
    le(8, r.maxRefreshFeeLamports), ...r.componentRingNewestSlots.map((x) => le(8, x)), ...r.converterRingNewestSlots.map((x) => le(8, x)));
  if (out.length !== 106 + 8 * (n + r.converterRingNewestSlots.length)) return reject("InvalidInstruction: tag-87 length");
  out[63] = r.ensureSample ? 1 : 0;
  out.set(le(2, r.maxReuseAgeSlots ?? 0), 64);
  return out;
}

export function decodeMimirFusedRefreshData(d: Uint8Array): MimirFusedRefreshRequest {
  if (d.length < 106 || d[0] !== MIMIR_FUSED_COMPOSITE_TAG) return reject("InvalidInstruction: not tag 87");
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength); const u = (o: number) => v.getBigUint64(o, true);
  const n = d[57]!; const s = (d.length - 106) / 8 - n;
  if (n < 1 || n > 5 || !Number.isInteger(s) || s < 0 || s > 5 || d[63]! > 1) return reject("InvalidInstruction: tag-87 length/reserved");
  const r: MimirFusedRefreshRequest = { compositeFeedId: Uint8Array.from(d.subarray(1, 33)), expectedConfigRevision: u(33), previousSnapshotRevision: u(41),
    nextSnapshotRevision: u(49), componentSourceConfigRevisions: Array.from({ length: n }, (_, i) => i === 0 ? u(58) & 0xff_ffff_ffffn : u(58 + 8 * i)),
    maxRefreshFeeLamports: u(98), componentRingNewestSlots: Array.from({ length: n }, (_, i) => u(106 + 8 * i)),
    converterRingNewestSlots: Array.from({ length: s }, (_, j) => u(106 + 8 * (n + j))),
    ...(v.getUint16(64, true) !== 0 ? { maxReuseAgeSlots: v.getUint16(64, true) } : {}), ...(d[63] === 1 ? { ensureSample: true } : {}) };
  if (!bytesEqual(encodeMimirFusedRefreshData(r), d)) return reject("InvalidInstruction: tag-87 non-canonical");
  return r;
}

export function buildMimirFusedCompositeRefreshInstruction(a: Readonly<{
  programId: Address; payer: Address; compositeSnapshot: Address; compositeConfig: Address; registry: Address; adminConfig: Address;
  feeVault: Address; treasury: Address; execution: Address; layout: MimirCompositeExecutionLayout;
  componentExternals: readonly (readonly Address[])[]; converterExternals: readonly (readonly Address[])[];
  request: MimirFusedRefreshRequest;
}>): MimirBetaInstruction {
  const { layout, request } = a;
  if (request.componentSourceConfigRevisions.length !== layout.componentCount || request.converterRingNewestSlots.length !== layout.converterSourceCount) {
    return reject("CompositeExecutionDefinitionMismatch: CAS width");
  }
  assertMimirClassicConverterAdmitted(layout.descriptors.slice(layout.componentCount));
  if (request.nextSnapshotRevision === request.previousSnapshotRevision && !layout.descriptors.some((d) => d.mode === 4)) {
    return reject("InvalidInstruction: sample-only tag-87 requires a mode-4 row");
  }
  const externals = [...a.componentExternals, ...a.converterExternals];
  checkVectors(layout, externals);
  const fixed = [a.compositeSnapshot, a.execution, a.feeVault, a.treasury];
  if (new Set(fixed).size !== 4 || externals.flat().some((x) => fixed.includes(x))) return reject("InvalidInstruction: tag-87 writable alias");
  return { programAddress: a.programId, data: encodeMimirFusedRefreshData(request), accounts: [
    meta(a.payer, true, true), meta(a.compositeSnapshot, false, true), ro(a.compositeConfig), ro(a.registry), ro(a.adminConfig),
    meta(a.feeVault, false, true), meta(a.treasury, false, true), ro(MIMIR_BETA_SYSTEM_PROGRAM_ID), meta(a.execution, false, true),
    ...externals.flat().map(ro),
    ...(layout.descriptors.some((d) => d.requiresInstructionsSysvar) ? [ro(MIMIR_INSTRUCTIONS_SYSVAR_ID)] : []),
  ] };
}

export interface MimirFusedRowSource {
  readonly adapterType: number; readonly adapterVersion: number; readonly currentPoint: boolean;
  readonly sourceConfig: Address; readonly feedConfig: Address; readonly sourcingPlan: Address;
  /** Live adapter vector, already narrowed by the caller (a CPMM spot row keeps `B,Q,P,C`). */
  readonly adapterAccounts: readonly Address[];
  /** Temporal tail; sampled AMM-v4/PumpSwap default to module version 4 with their pinned program and ProgramData. */
  readonly temporal?: Readonly<{ version: number; sourceProgram: Address; sourceProgramData: Address }>;
  readonly witness: MimirInitSourceWitness;
  /** Decoded SourcingPlan `accounts_binding_version` (0 or 1); SDK-built plans are 1. */
  readonly accountsBindingVersion?: number;
  /** Generation-pin cluster for the sampled AMM-v4/PumpSwap tail (A1.2: both clusters admit both families). */
  readonly cluster?: "mainnet" | "devnet" | "localnet";
  /** CPMM-v0 `DUAL_NATIVE_POINT_V1` component: `adapterAccounts` is the full `[B,Q,P,C,O,G,PD]` vector. */
  readonly dual?: boolean;
}

/** Fused external vector: the adapter accounts, then for a temporal row the source program and ProgramData (the module is embedded). */
export function mimirFusedRowExternals(s: Pick<MimirFusedRowSource, "adapterType" | "adapterAccounts" | "temporal" | "cluster">):
  Readonly<{ externals: readonly Address[]; temporalModuleVersion?: number }> {
  const sampled = s.adapterType === 4 || s.adapterType === 6 ? mimirSampledSourceAdapters(s.cluster)[s.adapterType] : undefined;
  const temporal = s.temporal ?? (sampled ? { version: 4, sourceProgram: sampled.program as Address, sourceProgramData: sampled.programData as Address } : undefined);
  return temporal ? { externals: [...s.adapterAccounts, temporal.sourceProgram, temporal.sourceProgramData], temporalModuleVersion: temporal.version }
    : { externals: [...s.adapterAccounts] };
}

export interface MimirFusedRow {
  readonly recipe: MimirFusedRecipe;
  readonly witness: MimirInitSourceWitness;
  readonly externals: readonly Address[];
  readonly sourceConfig: Address;
  readonly feedConfig: Address;
  readonly sourcingPlan: Address;
  /** Existing-feed rows only: the source is below its configured depth floor. */
  readonly belowFloor?: true;
  /** Existing-feed rows only: the planning account rows the externals were built from. */
  readonly observed?: ReadonlyMap<Address, MimirBetaAccount>;
}

/** One SEAL/tag-87 row from the source's canonical binding: witness body, admitted recipe, and fused external vector. A CPMM component keeps `B,Q,P,C`. */
export function mimirFusedRow(a: MimirFusedRowSource & Readonly<{ role: "component" | "converter" }>): MimirFusedRow {
  const cpmmComponent = a.role === "component" && a.adapterType === 2;
  const { externals, temporalModuleVersion } = mimirFusedRowExternals(cpmmComponent ? { adapterType: 2, adapterAccounts: a.dual ? a.adapterAccounts : a.adapterAccounts.slice(0, 4) } : a);
  const recipe = deriveMimirFusedRecipe({ role: a.role, adapterType: a.adapterType, adapterVersion: a.adapterVersion, externalWidth: externals.length,
    ...(temporalModuleVersion !== undefined ? { temporalModuleVersion } : {}), currentPoint: a.currentPoint, minSlotGap: a.witness.minSlotGap,
    accountsBindingVersion: a.accountsBindingVersion ?? 1, ...(a.dual ? { dual: true } : {}) });
  return { recipe, witness: a.witness, externals, sourceConfig: a.sourceConfig, feedConfig: a.feedConfig, sourcingPlan: a.sourcingPlan };
}

/**
 * Readiness of every mode-4 row from its embedded MTP4 module and row ring, at chain `clockUnixTs`. A row is ready only when the
 * program's ready bit is set and the projection agrees; an untouched module projects the first-sample warm-up.
 */
export function mimirCompositeSampledReadiness(data: Uint8Array, state: ReturnType<typeof decodeMimirCompositeExecution>, clockUnixTs: bigint):
  readonly Readonly<{ sourceIndex: number; sampled: MimirSampledReadiness }>[] {
  const b = L.headerLength + L.componentRowLength * state.componentCount;
  const rows = [...state.components.map((c, i) => ({ d: c.descriptor, ring: L.headerLength + L.componentRowLength * i + ROW.ring, sourceIndex: i })),
    ...(state.converter?.sources ?? []).map((c, j) => ({ d: c.descriptor, ring: b + L.converterSourceRowLength * j + CONV_SOURCE.ring, sourceIndex: j }))];
  return rows.filter(({ d }) => d.mode === 4).map(({ d, ring, sourceIndex }) => {
    const module = data.subarray(d.moduleOffset, d.moduleOffset + d.moduleLength);
    if (isZeroBytes(module)) return { sourceIndex, sampled: initialMimirSampledReadiness() };
    const projected = projectMimirSampledReadiness(decodeMimirSampledTemporalModule(module,
      mimirSampledClosureFromRing(module, data.subarray(ring, ring + 544))), clockUnixTs);
    return { sourceIndex, sampled: projected.status === "ready" && module[18] !== 3 ? { ...projected, status: "quality-hold" as const } : projected };
  });
}

/** A1 §5 sample-only tag 87 (`prev == new`, fee 0); the post-Seal creation form is `0/0`. */
export function isMimirFusedSampleOnlyData(data: Uint8Array, prev?: bigint): boolean {
  if (data[0] !== 87 || data.length < 106) return false;
  const v = dv(data); const p = v.getBigUint64(41, true);
  return p === v.getBigUint64(49, true) && v.getBigUint64(98, true) === 0n && (prev === undefined || p === prev);
}

/** A recipe whose security window cannot mature in the creating slot: interval/sampled modes warm up before tag 87 publishes. */
export function mimirFusedRecipeNeedsWarmup(recipe: MimirFusedRecipe): boolean {
  return recipe.mode === 3 || recipe.mode === 4;
}

/** Execution-state bytes with every tag-87-writable region (rings, temporal modules, converter TWAP/snapshot) zeroed. */
export function mimirCompositeExecutionImmutableBytes(data: Uint8Array): Uint8Array {
  const state = decodeMimirCompositeExecution(data);
  if (!state.active) return reject("CompositeExecutionNotReady: execution state is not active");
  const out = Uint8Array.from(data);
  const n = state.componentCount; const b = L.headerLength + L.componentRowLength * n;
  for (let i = 0; i < n; i += 1) out.fill(0, L.headerLength + L.componentRowLength * i + ROW.ring, L.headerLength + L.componentRowLength * (i + 1));
  if (state.converter) {
    out.fill(0, b + CONV.twap, b + CONV_SOURCE.descriptor);
    for (let j = 0; j < state.converterSourceCount; j += 1) {
      const o = b + L.converterSourceRowLength * j;
      out.fill(0, o + CONV_SOURCE.ring, o + CONV_SOURCE.ring + 544);
    }
  }
  out.fill(0, state.layout.modulesOffset);
  return out;
}
