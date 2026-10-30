import type { Address } from "@solana/kit";
import { decodeMimirBrowserSourceRingV1,
  decodeMimirBrowserDammReserveTemporalModuleV3, decodeMimirBrowserSourceTemporalModuleV1 } from "../internal/nativeMonoRefreshCore.js";
import { sha256 as sha256Sync } from "@noble/hashes/sha256";
import { mimirTemporalModeFromSourceFlags } from "../internal/currentPointCore.js";
import { bytesEqual, concatBytes, isZeroBytes, utf8 } from "./bytes.js";
import { betaError } from "./errors.js";
import { sourceAdapterSupportsVersion, type MimirBetaInstruction } from "./types.js";

const MAGIC = { feed: "MIMIRCFG", plan: "MIMIRPLN", source: "MIMIRSRC", ring: "MIMIRRNG" } as const;
const FEED = { feedId: 16, baseMint: 48, quoteMint: 80, priceExponent: 112, riskTier: 116, lifecycleState: 117,
  baseDecimals: 118, quoteDecimals: 119, minSourceCount: 120, minVenueCount: 121, minCorrelationGroupCount: 122,
  minCoverageRatioBps: 124, maxConfidenceBps: 126, maxDispersionBps: 128, maxSnapshotAgeSlots: 130,
  maxSourceActivityAgeSlots: 132, sourceSetHash: 136, defaultSourcingPlan: 168, fallbackSourcingPlan: 200,
  anchorPolicyHash: 232, nativeExceptionHash: 264, feedConfigRevision: 296, registryEpoch: 304, bump: 312,
  identityAsset: 325 } as const;
const PLAN = { feedId: 16, planId: 48, planVersion: 50, profile: 52, status: 53, riskTier: 54, minSources: 55,
  minVenues: 56, minCorrelationGroups: 57, maxDispersionBps: 58, maxSourceActivityAgeSlots: 60, priceExponent: 64,
  baseMint: 68, quoteMint: 100, sourceSetHash: 132, accountsHash: 164, planHash: 196, twapState: 228,
  anchorPolicyHash: 260, adapterMask: 292, bump: 300, hashSchemeVersion: 301, ringVersion: 302,
  accountsBindingVersion: 304, reservedTail: 305 } as const;
const SOURCE = { feedId: 16, sourceIndex: 48, adapterType: 49, status: 50, direction: 51, adapterVersion: 52,
  venueGroup: 54, operatorGroup: 56, liquidityOwnerGroup: 58, routeCorrelationGroup: 60, quoteAssetGroup: 62,
  bridgeOrWrapperGroup: 64, oracleSourceClass: 66, upgradeAuthorityGroup: 68, maxSourceWeightBps: 70,
  minLiquidityNative: 72, minDepthTo50BpsNative: 88, programId: 104, poolOrMarket: 136, baseVault: 168,
  quoteVault: 200, baseMint: 232, quoteMint: 264, tokenProgram: 296, vaultAuthority: 328,
  sourceConfigRevision: 360, sourceSetRevision: 368, bump: 376 } as const;

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const bytes = (data: Uint8Array, offset: number) => Uint8Array.from(data.subarray(offset, offset + 32));
const u16 = (data: Uint8Array, offset: number) => view(data).getUint16(offset, true);
const i32 = (data: Uint8Array, offset: number) => view(data).getInt32(offset, true);
const u64 = (data: Uint8Array, offset: number) => view(data).getBigUint64(offset, true);
const u128 = (data: Uint8Array, offset: number) => u64(data, offset) | (u64(data, offset + 8) << 64n);
const le16 = (value: number) => Uint8Array.of(value, value >> 8);
const le32 = (value: number) => { const out = new Uint8Array(4); new DataView(out.buffer).setInt32(0, value, true); return out; };
const le64 = (value: bigint) => { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, value, true); return out; };
const magic = (data: Uint8Array, value: string) => bytesEqual(data.subarray(0, 8), utf8(value));
const knownAdapter = (value: number) => Number.isInteger(value) && value >= 0 && value <= 7;

function header(data: Uint8Array, length: number, value: string, version: number, headerLength: number): void {
  if (!(data instanceof Uint8Array) || data.length !== length || !magic(data, value) || u16(data, 8) !== version || u16(data, 10) !== headerLength) {
    throw new Error("InvalidAccountData");
  }
}

export function decodeMimirBetaLiveFeed(data: Uint8Array) {
  header(data, 357, MAGIC.feed, 1, 357);
  const decoded = { feedId: bytes(data, FEED.feedId), baseMint: bytes(data, FEED.baseMint), quoteMint: bytes(data, FEED.quoteMint),
    priceExponent: i32(data, FEED.priceExponent), riskTier: data[FEED.riskTier]!, lifecycleState: data[FEED.lifecycleState]!,
    baseDecimals: data[FEED.baseDecimals]!, quoteDecimals: data[FEED.quoteDecimals]!, minSourceCount: data[FEED.minSourceCount]!,
    minVenueCount: data[FEED.minVenueCount]!, minCorrelationGroupCount: data[FEED.minCorrelationGroupCount]!,
    minCoverageRatioBps: u16(data, FEED.minCoverageRatioBps), maxConfidenceBps: u16(data, FEED.maxConfidenceBps),
    maxDispersionBps: u16(data, FEED.maxDispersionBps), maxSnapshotAgeSlots: u16(data, FEED.maxSnapshotAgeSlots),
    maxSourceActivityAgeSlots: u16(data, FEED.maxSourceActivityAgeSlots), sourceSetHash: bytes(data, FEED.sourceSetHash),
    defaultSourcingPlan: bytes(data, FEED.defaultSourcingPlan), fallbackSourcingPlan: bytes(data, FEED.fallbackSourcingPlan),
    anchorPolicyHash: bytes(data, FEED.anchorPolicyHash), nativeExceptionHash: bytes(data, FEED.nativeExceptionHash),
    feedConfigRevision: u64(data, FEED.feedConfigRevision), registryEpoch: u64(data, FEED.registryEpoch), bump: data[FEED.bump]!,
    identityAsset: bytes(data, FEED.identityAsset) };
  if (decoded.riskTier > 3 || decoded.lifecycleState > 7 || isZeroBytes(decoded.baseMint) || isZeroBytes(decoded.quoteMint) ||
      bytesEqual(decoded.baseMint, decoded.quoteMint) || decoded.minCoverageRatioBps > 10_000 || decoded.maxConfidenceBps > 10_000 ||
      decoded.maxDispersionBps > 10_000 || isZeroBytes(decoded.identityAsset) || data[123] !== 0 || data[134] !== 0 || data[135] !== 0) {
    throw new Error("InvalidLifecycleFeedConfig");
  }
  return decoded;
}

export async function decodeMimirBetaLivePlan(data: Uint8Array) {
  return decodeMimirBetaLivePlanFields(data);
}

/** Strict synchronous SourcingPlan decoder: frozen scalars, canonical `(Merkle v1, ring v1, binding 0|1)` and the recomputed plan hash. */
export function decodeMimirBetaLivePlanFields(data: Uint8Array) {
  header(data, 320, MAGIC.plan, 0, 320);
  const decoded = { feedId: bytes(data, PLAN.feedId), planId: u16(data, PLAN.planId), planVersion: u16(data, PLAN.planVersion),
    profile: data[PLAN.profile]!, status: data[PLAN.status]!, riskTier: data[PLAN.riskTier]!, minSources: data[PLAN.minSources]!,
    minVenues: data[PLAN.minVenues]!, minCorrelationGroups: data[PLAN.minCorrelationGroups]!,
    maxDispersionBps: u16(data, PLAN.maxDispersionBps), maxSourceActivityAgeSlots: u16(data, PLAN.maxSourceActivityAgeSlots),
    priceExponent: i32(data, PLAN.priceExponent), baseMint: bytes(data, PLAN.baseMint), quoteMint: bytes(data, PLAN.quoteMint),
    sourceSetHash: bytes(data, PLAN.sourceSetHash), accountsHash: bytes(data, PLAN.accountsHash), planHash: bytes(data, PLAN.planHash),
    twapState: bytes(data, PLAN.twapState), anchorPolicyHash: bytes(data, PLAN.anchorPolicyHash), adapterMask: u64(data, PLAN.adapterMask),
    bump: data[PLAN.bump]!, hashSchemeVersion: data[PLAN.hashSchemeVersion]!, ringVersion: u16(data, PLAN.ringVersion),
    accountsBindingVersion: data[PLAN.accountsBindingVersion]! };
  if (decoded.profile > 4 || decoded.status > 3 || decoded.riskTier > 3 || isZeroBytes(decoded.baseMint) || isZeroBytes(decoded.quoteMint) ||
      bytesEqual(decoded.baseMint, decoded.quoteMint) || decoded.maxDispersionBps > 10_000 || decoded.hashSchemeVersion !== 1 ||
      decoded.ringVersion !== 1 || decoded.accountsBindingVersion > 1 || data.subarray(PLAN.reservedTail).some(Boolean) ||
      decoded.status !== 0 || decoded.minSources < 1 || decoded.minSources > 5 || decoded.adapterMask === 0n ||
      isZeroBytes(decoded.sourceSetHash) || isZeroBytes(decoded.accountsHash) || isZeroBytes(decoded.anchorPolicyHash) ||
      decoded.maxSourceActivityAgeSlots === 0 || decoded.minVenues < 1 || decoded.minVenues > decoded.minSources ||
      decoded.minCorrelationGroups < 1 || decoded.minCorrelationGroups > decoded.minSources) {
    throw new Error("InvalidLifecycleSourcingPlan");
  }
  const expected = sha256Sync(concatBytes(utf8("MIMIR_MINT_ORACLE_PLAN_V3"), Uint8Array.of(decoded.hashSchemeVersion),
    le16(decoded.ringVersion), Uint8Array.of(decoded.accountsBindingVersion), decoded.feedId, le16(decoded.planId),
    le16(decoded.planVersion), Uint8Array.of(decoded.profile, decoded.riskTier, decoded.minSources, decoded.minVenues,
      decoded.minCorrelationGroups), le16(decoded.maxDispersionBps), le16(decoded.maxSourceActivityAgeSlots),
    le32(decoded.priceExponent), decoded.baseMint, decoded.quoteMint, decoded.sourceSetHash, decoded.accountsHash,
    decoded.twapState, decoded.anchorPolicyHash, le64(decoded.adapterMask)));
  if (!bytesEqual(decoded.planHash, expected)) throw new Error("InvalidLifecycleSourcingPlan");
  return decoded;
}

export function decodeMimirBetaLiveSource(data: Uint8Array) {
  header(data, 384, MAGIC.source, 0, 384);
  const decoded = { feedId: bytes(data, SOURCE.feedId), sourceIndex: data[SOURCE.sourceIndex]!, adapterType: data[SOURCE.adapterType]!,
    status: data[SOURCE.status]!, direction: data[SOURCE.direction]!, adapterVersion: u16(data, SOURCE.adapterVersion),
    venueGroup: u16(data, SOURCE.venueGroup), operatorGroup: u16(data, SOURCE.operatorGroup),
    liquidityOwnerGroup: u16(data, SOURCE.liquidityOwnerGroup), routeCorrelationGroup: u16(data, SOURCE.routeCorrelationGroup),
    quoteAssetGroup: u16(data, SOURCE.quoteAssetGroup), bridgeOrWrapperGroup: u16(data, SOURCE.bridgeOrWrapperGroup),
    oracleSourceClass: u16(data, SOURCE.oracleSourceClass), upgradeAuthorityGroup: u16(data, SOURCE.upgradeAuthorityGroup),
    maxSourceWeightBps: u16(data, SOURCE.maxSourceWeightBps), minLiquidityNative: u128(data, SOURCE.minLiquidityNative),
    minDepthTo50BpsNative: u128(data, SOURCE.minDepthTo50BpsNative), programId: bytes(data, SOURCE.programId),
    poolOrMarket: bytes(data, SOURCE.poolOrMarket), baseVault: bytes(data, SOURCE.baseVault), quoteVault: bytes(data, SOURCE.quoteVault),
    baseMint: bytes(data, SOURCE.baseMint), quoteMint: bytes(data, SOURCE.quoteMint), tokenProgram: bytes(data, SOURCE.tokenProgram),
    vaultAuthority: bytes(data, SOURCE.vaultAuthority), sourceConfigRevision: u64(data, SOURCE.sourceConfigRevision),
    sourceSetRevision: u64(data, SOURCE.sourceSetRevision), bump: data[SOURCE.bump]!, flags: view(data).getUint32(12, true) };
  const temporalMode = mimirTemporalModeFromSourceFlags(decoded.flags, decoded.adapterType, decoded.adapterVersion);
  if (!knownAdapter(decoded.adapterType) || !sourceAdapterSupportsVersion(decoded.adapterType, decoded.adapterVersion) || decoded.status > 2 || decoded.direction > 1 || decoded.sourceIndex > 63 ||
      decoded.maxSourceWeightBps === 0 || decoded.maxSourceWeightBps > 10_000 || decoded.minLiquidityNative === 0n ||
      decoded.minDepthTo50BpsNative === 0n || isZeroBytes(decoded.programId) || isZeroBytes(decoded.poolOrMarket) ||
      isZeroBytes(decoded.baseMint) || isZeroBytes(decoded.quoteMint) || bytesEqual(decoded.baseMint, decoded.quoteMint)) {
    throw new Error("InvalidSourceConfig");
  }
  return { ...decoded, temporalMode };
}

export function decodeMimirBetaLiveRing(data: Uint8Array) {
  return decodeMimirBrowserSourceRingV1(data);
}

export function decodeMimirBetaLiveSourceTemporalModuleV1(data: Uint8Array, ring: ReturnType<typeof decodeMimirBetaLiveRing>) {
  return decodeMimirBrowserSourceTemporalModuleV1(data, ring);
}

export const MIMIR_BETA_COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111" as Address;
export const MIMIR_CURRENT_POINT_COMPUTE_UNITS = Object.freeze({ base: 490_000, perSource: 390_000, max: 1_400_000 } as const);

export function mimirCurrentPointComputeUnitLimit(sourceCount: number): number {
  if (!Number.isInteger(sourceCount) || sourceCount < 1 || sourceCount > 5) betaError("PROGRAM_ABI_MISMATCH", "point source count must be 1..5");
  const c = MIMIR_CURRENT_POINT_COMPUTE_UNITS;
  return Math.min(c.max, c.base + c.perSource * sourceCount);
}

export function buildMimirBetaComputeUnitLimitInstruction(units: number): MimirBetaInstruction {
  if (!Number.isInteger(units) || units < 1 || units > MIMIR_CURRENT_POINT_COMPUTE_UNITS.max) betaError("INVALID_ARGUMENT", "compute unit limit invalid");
  const data = new Uint8Array(5); data[0] = 2; new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: MIMIR_BETA_COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data };
}

export function decodeMimirBetaLiveDammReserveTemporalModuleV3(data: Uint8Array, ring: ReturnType<typeof decodeMimirBetaLiveRing>) {
  return decodeMimirBrowserDammReserveTemporalModuleV3(data, ring);
}
