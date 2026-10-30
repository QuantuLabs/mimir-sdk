import {
  AnchorProvider,
  AnchorStatus,
  CAP_MODEL_ECON_LOSS_BAND_BPS,
  CAP_MODEL_HASH_V2,
  CAP_MODEL_SOURCE_ENTRY_LEN,
  CAP_MODEL_VERSION_V2,
  CONFIG_OFFSETS,
  FEED_CONFIG_HEADER_LEN,
  FEED_CONFIG_V1_HEADER_LEN,
  FEED_CONFIG_IDENTITY_ASSET_OFFSET,
  FEED_CONFIG_MAGIC,
  FEED_RESERVATION_HEADER_LEN,
  FEED_RESERVATION_MAGIC,
  FEED_SNAPSHOT_MAGIC,
  FEED_SNAPSHOT_MIN_HEADER_LEN,
  FEED_TWAP_HEADER_LEN,
  FEED_TWAP_MAGIC,
  FeedLifecycleState,
  FeedReservationStatus,
  FreshnessProfile,
  GOVERNANCE_ACTION_HEADER_LEN,
  GOVERNANCE_ACTION_MAGIC,
  GOVERNANCE_ACTION_OFFSETS,
  GOVERNANCE_POLICY_HEADER_LEN,
  GOVERNANCE_POLICY_MAGIC,
  GOVERNANCE_POLICY_OFFSETS,
  GovernanceActionStatus,
  GovernanceActionTargetKind,
  GovernancePolicyStatus,
  MIMIR_MAINNET_USDC_MINT,
  METEORA_DLMM_PROGRAM_ID,
  ObservationKind,
  OFFSETS,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORACLE_REGISTRY_HEADER_LEN,
  ORACLE_REGISTRY_MAGIC,
  PLAN_OFFSETS,
  PlanStatus,
  PlanProfile,
  QuoteStatus,
  RAYDIUM_CLMM_MAINNET_PROGRAM_ID,
  RAYDIUM_CPMM_MAINNET_PROGRAM_ID,
  REGISTRY_OFFSETS,
  RegistryStatus,
  RESERVATION_OFFSETS,
  RiskTier,
  RING_OFFSETS,
  RouteabilityStatus,
  SOURCE_CONFIG_HEADER_LEN,
  SOURCE_CAP_ENTRY_OFFSETS,
  SOURCE_CONFIG_MAGIC,
  SOURCE_OFFSETS,
  SOURCE_RING_HEADER_LEN,
  SOURCE_RING_V1_HEADER_LEN,
  SOURCE_RING_MAGIC,
  SourceAdapterType,
  SourceDirection,
  SourceStatus,
  SOURCING_PLAN_HEADER_LEN,
  SOURCING_PLAN_MAGIC,
  SnapshotSource,
  SnapshotStatus,
  SPL_TOKEN_PROGRAM_ID,
  VerifyFlags,
  TWAP_OFFSETS,
  TwapStatus,
} from "./constants.js";
import { PublicKey } from "@solana/web3.js";
import {
  findFeedConfigPda,
  findFeedReservationPda,
  findFeedTwapPda,
  findGovernanceActionPda,
  findGovernancePolicyPda,
  findOracleRegistryPda,
  findSourceConfigPda,
  findSourceRingPda,
  findSourcingPlanPda,
} from "./pda.js";
import { canonicalMintPairFeedId } from "./mintOracle.js";
import type { RefreshTwapPolicy, SnapshotPolicy } from "./types.js";

const TEST_BASE_MINT = Buffer.alloc(32, 10);
const TEST_QUOTE_MINT = MIMIR_MAINNET_USDC_MINT.toBuffer();
/** Test pair feed id; `variant` 0 keeps the legacy `TEST_FEED_ID`. */
export function buildTestFeedId(variant = 0): Buffer {
  return canonicalMintPairFeedId(new PublicKey(TEST_BASE_MINT), new PublicKey(TEST_QUOTE_MINT), variant);
}
export const TEST_FEED_ID = buildTestFeedId();
export const TEST_PLAN_HASH = Buffer.alloc(32, 2);
export const TEST_ANCHOR_POLICY_HASH = Buffer.alloc(32, 3);
export const TEST_NATIVE_EXCEPTION_HASH = Buffer.alloc(32, 4);
export const TEST_FEED_CONFIG = findFeedConfigPda(TEST_FEED_ID)[0].toBuffer();
export const TEST_GOVERNANCE_AUTHORITY = new PublicKey(Buffer.alloc(32, 15));

export const TEST_GOVERNANCE_SIGNER_1 = new PublicKey(Buffer.alloc(32, 17));
export const TEST_GOVERNANCE_SIGNER_2 = new PublicKey(Buffer.alloc(32, 18));
export const TEST_SNAPSHOT_SLOT = 100n;
export const TEST_CLOCK_SLOT = 101n;
export const TEST_VALID_UNTIL_SLOT = 110n;
export const TEST_BAND_CAPITAL_NOTIONAL = 500_000n;
export const TEST_NOTIONAL = 10_000n;
export const TEST_PRICE_EXPONENT = -8;
export const TEST_TWAP_PRICE_MANTISSA = 1_000_000n;
export const TEST_TWAP_PRICE_X64 = 184_467_440_737_095_517n;
export const TEST_PLAN_ID = 1;
export const TEST_PLAN_VERSION = 1;
export const TEST_TWAP_VERSION = 0;
export const TEST_RING_VERSION = 0;

function writeU64(buf: Buffer, offset: number, value: bigint): void {
  buf.writeBigUInt64LE(value, offset);
}

function writeU128(buf: Buffer, offset: number, value: bigint): void {
  buf.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  buf.writeBigUInt64LE(value >> 64n, offset + 8);
}

function writeSourceCapEntryV2(
  buf: Buffer,
  tableOffset: number,
  index: number,
  entry: {
    sourceIndex: number;
    flags?: number;
    weightBps: number;
    routeCorrelationGroup: number;
    econLossFloorNative: bigint;
    capitalRequiredFloorNative: bigint;
    sourceSetRevision: bigint;
  },
): void {
  const offset = tableOffset + index * CAP_MODEL_SOURCE_ENTRY_LEN;
  buf[offset + SOURCE_CAP_ENTRY_OFFSETS.sourceIndex] = entry.sourceIndex;
  buf[offset + SOURCE_CAP_ENTRY_OFFSETS.flags] = entry.flags ?? 0;
  buf.writeUInt16LE(entry.weightBps, offset + SOURCE_CAP_ENTRY_OFFSETS.weightBps);
  buf.writeUInt16LE(
    entry.routeCorrelationGroup,
    offset + SOURCE_CAP_ENTRY_OFFSETS.routeCorrelationGroup,
  );
  writeU128(
    buf,
    offset + SOURCE_CAP_ENTRY_OFFSETS.econLossFloorNative,
    entry.econLossFloorNative,
  );
  writeU128(
    buf,
    offset + SOURCE_CAP_ENTRY_OFFSETS.capitalRequiredFloorNative,
    entry.capitalRequiredFloorNative,
  );
  writeU64(
    buf,
    offset + SOURCE_CAP_ENTRY_OFFSETS.sourceSetRevision,
    entry.sourceSetRevision,
  );
}

export function buildTestSnapshotHeader(overrides?: (data: Buffer) => void): Buffer {
  const data = Buffer.alloc(FEED_SNAPSHOT_MIN_HEADER_LEN);
  FEED_SNAPSHOT_MAGIC.copy(data, OFFSETS.magic);
  data.writeUInt16LE(0, OFFSETS.version);
  data.writeUInt16LE(FEED_SNAPSHOT_MIN_HEADER_LEN, OFFSETS.headerLen);
  TEST_FEED_ID.copy(data, OFFSETS.feedId);
  TEST_FEED_CONFIG.copy(data, OFFSETS.feedConfig);
  writeU64(data, OFFSETS.registryEpoch, 1n);
  writeU64(data, OFFSETS.feedConfigRevision, 1n);
  writeU64(data, OFFSETS.snapshotRevision, 1n);
  data[OFFSETS.status] = SnapshotStatus.Fresh;
  data[OFFSETS.routeabilityStatus] = RouteabilityStatus.TierA;
  data[OFFSETS.riskTier] = RiskTier.TierA;
  data[OFFSETS.snapshotSource] = SnapshotSource.Keeper;
  data[OFFSETS.freshnessProfile] = FreshnessProfile.AnchorChecked;
  data[OFFSETS.planProfile] = PlanProfile.Snapshot;
  writeU64(data, OFFSETS.snapshotSlot, TEST_SNAPSHOT_SLOT);
  writeU64(data, OFFSETS.validUntilSlot, TEST_VALID_UNTIL_SLOT);
  writeU64(data, OFFSETS.oldestSourceActivitySlot, TEST_SNAPSHOT_SLOT - 1n);
  writeU64(data, OFFSETS.twapShortEndSlot, TEST_SNAPSHOT_SLOT);
  writeU64(data, OFFSETS.twapMediumEndSlot, TEST_SNAPSHOT_SLOT);
  writeU64(data, OFFSETS.twapLongEndSlot, TEST_SNAPSHOT_SLOT);
  writeU64(data, OFFSETS.priceMantissa, TEST_TWAP_PRICE_MANTISSA);
  data.writeInt32LE(TEST_PRICE_EXPONENT, OFFSETS.priceExponent);
  writeU128(data, OFFSETS.priceX64, TEST_TWAP_PRICE_X64);
  const delta = (TEST_TWAP_PRICE_X64 * 15n + 9_999n) / 10_000n;
  writeU128(data, OFFSETS.priceLowerX64, TEST_TWAP_PRICE_X64 - delta);
  writeU128(data, OFFSETS.priceUpperX64, TEST_TWAP_PRICE_X64 + delta);
  data.writeUInt16LE(15, OFFSETS.confidenceBps);
  data.writeUInt16LE(8, OFFSETS.dispersionBps);
  data[OFFSETS.sourceCount] = 4;
  data[OFFSETS.venueCount] = 4;
  data[OFFSETS.correlationGroupCount] = 3;
  data.writeUInt16LE(9_500, OFFSETS.coverageRatioBps);
  data[OFFSETS.quoteStatus] = QuoteStatus.Ok;
  data.writeUInt16LE(TEST_PLAN_ID, OFFSETS.sourcingPlanId);
  data.writeUInt16LE(TEST_PLAN_VERSION, OFFSETS.sourcingPlanVersion);
  TEST_PLAN_HASH.copy(data, OFFSETS.sourcingPlanHash);
  writeU64(data, OFFSETS.sourceMask, 0b1111n);
  writeU128(data, OFFSETS.bandCapitalNotional, TEST_BAND_CAPITAL_NOTIONAL);
  writeU128(data, OFFSETS.attackerSetFeeLossFloorMirror, 600_000n);
  data[OFFSETS.anchorProvider] = AnchorProvider.NativeOnlyException;
  data[OFFSETS.anchorStatus] = AnchorStatus.Ok;
  TEST_ANCHOR_POLICY_HASH.copy(data, OFFSETS.anchorPolicyHash);
  TEST_NATIVE_EXCEPTION_HASH.copy(data, OFFSETS.nativeExceptionHash);
  data.writeUInt16LE(CAP_MODEL_VERSION_V2, OFFSETS.capModelVersion);
  data.writeUInt16LE(0, OFFSETS.capModelFlags);
  data.writeUInt16LE(CAP_MODEL_ECON_LOSS_BAND_BPS, OFFSETS.econLossBandBps);
  data.writeUInt16LE(5_000, OFFSETS.attackerSetWeightBps);
  data[OFFSETS.attackerSetSourceCount] = 2;
  data[OFFSETS.effectiveSourceCount] = 4;
  data.writeUInt16LE(6, OFFSETS.capTierSafetyFactor);
  writeU64(data, OFFSETS.attackerSourceMask, 0b0011n);
  writeU128(data, OFFSETS.attackerSetEconLossFloorNative, 600_000n);
  writeU128(data, OFFSETS.attackerSetCapitalRequiredFloorNative, 15_000n);
  CAP_MODEL_HASH_V2.copy(data, OFFSETS.capModelHash);
  overrides?.(data);
  return data;
}

export function buildTestFeedConfigHeader(overrides?: (data: Buffer) => void): Buffer {
  const data = Buffer.alloc(FEED_CONFIG_HEADER_LEN);
  const feedConfigPda = findFeedConfigPda(TEST_FEED_ID);
  FEED_CONFIG_MAGIC.copy(data, CONFIG_OFFSETS.magic);
  data.writeUInt16LE(0, CONFIG_OFFSETS.version);
  data.writeUInt16LE(FEED_CONFIG_HEADER_LEN, CONFIG_OFFSETS.headerLen);
  TEST_FEED_ID.copy(data, CONFIG_OFFSETS.feedId);
  TEST_BASE_MINT.copy(data, CONFIG_OFFSETS.baseMint);
  TEST_QUOTE_MINT.copy(data, CONFIG_OFFSETS.quoteMint);
  data.writeInt32LE(TEST_PRICE_EXPONENT, CONFIG_OFFSETS.priceExponent);
  data[CONFIG_OFFSETS.riskTier] = RiskTier.TierA;
  data[CONFIG_OFFSETS.lifecycleState] = FeedLifecycleState.Active;
  data[CONFIG_OFFSETS.baseDecimals] = 9;
  data[CONFIG_OFFSETS.quoteDecimals] = 6;
  data[CONFIG_OFFSETS.minSourceCount] = 4;
  data[CONFIG_OFFSETS.minVenueCount] = 4;
  data[CONFIG_OFFSETS.minCorrelationGroupCount] = 3;
  data.writeUInt16LE(9_000, CONFIG_OFFSETS.minCoverageRatioBps);
  data.writeUInt16LE(50, CONFIG_OFFSETS.maxConfidenceBps);
  data.writeUInt16LE(100, CONFIG_OFFSETS.maxDispersionBps);
  data.writeUInt16LE(5, CONFIG_OFFSETS.maxSnapshotAgeSlots);
  data.writeUInt16LE(5, CONFIG_OFFSETS.maxSourceActivityAgeSlots);
  Buffer.alloc(32, 12).copy(data, CONFIG_OFFSETS.sourceSetHash);
  TEST_PLAN_HASH.copy(data, CONFIG_OFFSETS.defaultSourcingPlan);
  TEST_PLAN_HASH.copy(data, CONFIG_OFFSETS.fallbackSourcingPlan);
  TEST_ANCHOR_POLICY_HASH.copy(data, CONFIG_OFFSETS.anchorPolicyHash);
  TEST_NATIVE_EXCEPTION_HASH.copy(data, CONFIG_OFFSETS.nativeExceptionHash);
  writeU64(data, CONFIG_OFFSETS.feedConfigRevision, 1n);
  writeU64(data, CONFIG_OFFSETS.registryEpoch, 1n);
  data[CONFIG_OFFSETS.bump] = feedConfigPda[1];
  overrides?.(data);
  return data;
}

export function buildTestCreatedFeedConfigHeader(overrides?: (data: Buffer) => void): Buffer {
  const data = Buffer.alloc(FEED_CONFIG_HEADER_LEN);
  const feedConfigPda = findFeedConfigPda(TEST_FEED_ID);
  FEED_CONFIG_MAGIC.copy(data, CONFIG_OFFSETS.magic);
  data.writeUInt16LE(0, CONFIG_OFFSETS.version);
  data.writeUInt16LE(FEED_CONFIG_HEADER_LEN, CONFIG_OFFSETS.headerLen);
  TEST_FEED_ID.copy(data, CONFIG_OFFSETS.feedId);
  TEST_BASE_MINT.copy(data, CONFIG_OFFSETS.baseMint);
  TEST_QUOTE_MINT.copy(data, CONFIG_OFFSETS.quoteMint);
  data.writeInt32LE(TEST_PRICE_EXPONENT, CONFIG_OFFSETS.priceExponent);
  data[CONFIG_OFFSETS.riskTier] = RiskTier.TierA;
  data[CONFIG_OFFSETS.lifecycleState] = FeedLifecycleState.Created;
  data[CONFIG_OFFSETS.baseDecimals] = 9;
  data[CONFIG_OFFSETS.quoteDecimals] = 6;
  writeU64(data, CONFIG_OFFSETS.feedConfigRevision, 1n);
  writeU64(data, CONFIG_OFFSETS.registryEpoch, 1n);
  data[CONFIG_OFFSETS.bump] = feedConfigPda[1];
  overrides?.(data);
  return data;
}

export function toTestFeedConfigV1(prefix: Buffer, identityAsset: Buffer = Buffer.alloc(32, 44)): Buffer {
  const data = Buffer.alloc(FEED_CONFIG_V1_HEADER_LEN);
  prefix.copy(data, 0, 0, FEED_CONFIG_HEADER_LEN);
  data.writeUInt16LE(1, CONFIG_OFFSETS.version);
  data.writeUInt16LE(FEED_CONFIG_V1_HEADER_LEN, CONFIG_OFFSETS.headerLen);
  identityAsset.copy(data, FEED_CONFIG_IDENTITY_ASSET_OFFSET);
  return data;
}

export function buildTestOracleRegistryHeader(overrides?: (data: Buffer) => void): Buffer {
  const data = Buffer.alloc(ORACLE_REGISTRY_HEADER_LEN);
  const registryPda = findOracleRegistryPda();
  ORACLE_REGISTRY_MAGIC.copy(data, REGISTRY_OFFSETS.magic);
  data.writeUInt16LE(0, REGISTRY_OFFSETS.version);
  data.writeUInt16LE(ORACLE_REGISTRY_HEADER_LEN, REGISTRY_OFFSETS.headerLen);
  Buffer.alloc(32, 15).copy(data, REGISTRY_OFFSETS.authority);
  Buffer.alloc(32, 16).copy(data, REGISTRY_OFFSETS.emergencyAuthority);
  writeU64(data, REGISTRY_OFFSETS.supportedAdapterMask, 1n);
  data.writeUInt16LE(0, REGISTRY_OFFSETS.minFeedConfigVersion);
  writeU64(data, REGISTRY_OFFSETS.registryEpoch, 1n);
  data[REGISTRY_OFFSETS.status] = RegistryStatus.Active;
  data[REGISTRY_OFFSETS.bump] = registryPda[1];
  overrides?.(data);
  return data;
}

export function buildTestGovernancePolicyHeader(
  overrides?: (data: Buffer) => void,
): Buffer {
  const data = Buffer.alloc(GOVERNANCE_POLICY_HEADER_LEN);
  const policyPda = findGovernancePolicyPda();
  GOVERNANCE_POLICY_MAGIC.copy(data, GOVERNANCE_POLICY_OFFSETS.magic);
  data.writeUInt16LE(0, GOVERNANCE_POLICY_OFFSETS.version);
  data.writeUInt16LE(
    GOVERNANCE_POLICY_HEADER_LEN,
    GOVERNANCE_POLICY_OFFSETS.headerLen,
  );
  TEST_GOVERNANCE_AUTHORITY.toBuffer().copy(
    data,
    GOVERNANCE_POLICY_OFFSETS.authority,
  );
  TEST_GOVERNANCE_AUTHORITY.toBuffer().copy(
    data,
    GOVERNANCE_POLICY_OFFSETS.signer0,
  );
  TEST_GOVERNANCE_SIGNER_1.toBuffer().copy(
    data,
    GOVERNANCE_POLICY_OFFSETS.signer1,
  );
  TEST_GOVERNANCE_SIGNER_2.toBuffer().copy(
    data,
    GOVERNANCE_POLICY_OFFSETS.signer2,
  );
  data[GOVERNANCE_POLICY_OFFSETS.threshold] = 2;
  data[GOVERNANCE_POLICY_OFFSETS.status] = GovernancePolicyStatus.Active;
  data[GOVERNANCE_POLICY_OFFSETS.bump] = policyPda[1];
  writeU64(data, GOVERNANCE_POLICY_OFFSETS.minDelaySlots, 2n);
  writeU64(data, GOVERNANCE_POLICY_OFFSETS.actionTtlSlots, 20n);
  writeU64(data, GOVERNANCE_POLICY_OFFSETS.revision, 1n);
  overrides?.(data);
  return data;
}

export function buildTestGovernanceActionHeader(
  actionHash: Uint8Array,
  proposedSlot: bigint,
  targetKindOrOverrides:
    | number
    | ((data: Buffer) => void) = GovernanceActionTargetKind.Registry,
  overrides?: (data: Buffer) => void,
): Buffer {
  if (actionHash.length !== 32) throw new Error("Expected32Bytes");
  const targetKind =
    typeof targetKindOrOverrides === "number"
      ? targetKindOrOverrides
      : GovernanceActionTargetKind.Registry;
  const applyOverrides =
    typeof targetKindOrOverrides === "function" ? targetKindOrOverrides : overrides;
  const data = Buffer.alloc(GOVERNANCE_ACTION_HEADER_LEN);
  const policyPda = findGovernancePolicyPda()[0];
  const actionPda = findGovernanceActionPda(actionHash);
  GOVERNANCE_ACTION_MAGIC.copy(data, GOVERNANCE_ACTION_OFFSETS.magic);
  data.writeUInt16LE(0, GOVERNANCE_ACTION_OFFSETS.version);
  data.writeUInt16LE(
    GOVERNANCE_ACTION_HEADER_LEN,
    GOVERNANCE_ACTION_OFFSETS.headerLen,
  );
  policyPda.toBuffer().copy(data, GOVERNANCE_ACTION_OFFSETS.policy);
  Buffer.from(actionHash).copy(data, GOVERNANCE_ACTION_OFFSETS.actionHash);
  data[GOVERNANCE_ACTION_OFFSETS.targetKind] = targetKind;
  data[GOVERNANCE_ACTION_OFFSETS.status] = GovernanceActionStatus.Pending;
  data[GOVERNANCE_ACTION_OFFSETS.approvalMask] = 1;
  data[GOVERNANCE_ACTION_OFFSETS.threshold] = 2;
  writeU64(data, GOVERNANCE_ACTION_OFFSETS.proposedSlot, proposedSlot);
  writeU64(data, GOVERNANCE_ACTION_OFFSETS.effectiveSlot, proposedSlot + 2n);
  writeU64(data, GOVERNANCE_ACTION_OFFSETS.expiresSlot, proposedSlot + 22n);
  writeU64(data, GOVERNANCE_ACTION_OFFSETS.revision, 1n);
  data[GOVERNANCE_ACTION_OFFSETS.bump] = actionPda[1];
  applyOverrides?.(data);
  return data;
}

export function buildTestFeedReservationHeader(
  authority = TEST_GOVERNANCE_AUTHORITY,
  overrides?: (data: Buffer) => void,
): Buffer {
  const data = Buffer.alloc(FEED_RESERVATION_HEADER_LEN);
  const reservationPda = findFeedReservationPda(TEST_FEED_ID);
  FEED_RESERVATION_MAGIC.copy(data, RESERVATION_OFFSETS.magic);
  data.writeUInt16LE(0, RESERVATION_OFFSETS.version);
  data.writeUInt16LE(FEED_RESERVATION_HEADER_LEN, RESERVATION_OFFSETS.headerLen);
  TEST_FEED_ID.copy(data, RESERVATION_OFFSETS.feedId);
  authority.toBuffer().copy(data, RESERVATION_OFFSETS.authority);
  TEST_BASE_MINT.copy(data, RESERVATION_OFFSETS.baseMint);
  TEST_QUOTE_MINT.copy(data, RESERVATION_OFFSETS.quoteMint);
  data[RESERVATION_OFFSETS.maxRiskTier] = RiskTier.TierA;
  data[RESERVATION_OFFSETS.status] = FeedReservationStatus.Reserved;
  data[RESERVATION_OFFSETS.bump] = reservationPda[1];
  writeU64(data, RESERVATION_OFFSETS.registryEpoch, 1n);
  writeU64(data, RESERVATION_OFFSETS.reservationRevision, 1n);
  overrides?.(data);
  return data;
}

export function buildTestSourcingPlanHeader(overrides?: (data: Buffer) => void): Buffer {
  const data = Buffer.alloc(SOURCING_PLAN_HEADER_LEN);
  const planPda = findSourcingPlanPda(TEST_FEED_ID, TEST_PLAN_ID, TEST_PLAN_VERSION);
  const twapPda = findFeedTwapPda(TEST_FEED_ID, TEST_TWAP_VERSION);
  SOURCING_PLAN_MAGIC.copy(data, PLAN_OFFSETS.magic);
  data.writeUInt16LE(0, PLAN_OFFSETS.version);
  data.writeUInt16LE(SOURCING_PLAN_HEADER_LEN, PLAN_OFFSETS.headerLen);
  TEST_FEED_ID.copy(data, PLAN_OFFSETS.feedId);
  data.writeUInt16LE(TEST_PLAN_ID, PLAN_OFFSETS.planId);
  data.writeUInt16LE(TEST_PLAN_VERSION, PLAN_OFFSETS.planVersion);
  data[PLAN_OFFSETS.profile] = PlanProfile.Snapshot;
  data[PLAN_OFFSETS.status] = PlanStatus.Active;
  data[PLAN_OFFSETS.riskTier] = RiskTier.TierA;
  data[PLAN_OFFSETS.minSources] = 4;
  data[PLAN_OFFSETS.minVenues] = 4;
  data[PLAN_OFFSETS.minCorrelationGroups] = 3;
  data.writeUInt16LE(100, PLAN_OFFSETS.maxDispersionBps);
  data.writeUInt16LE(5, PLAN_OFFSETS.maxSourceActivityAgeSlots);
  data.writeInt32LE(TEST_PRICE_EXPONENT, PLAN_OFFSETS.priceExponent);
  TEST_BASE_MINT.copy(data, PLAN_OFFSETS.baseMint);
  TEST_QUOTE_MINT.copy(data, PLAN_OFFSETS.quoteMint);
  Buffer.alloc(32, 12).copy(data, PLAN_OFFSETS.sourceSetHash);
  Buffer.alloc(32, 13).copy(data, PLAN_OFFSETS.accountsHash);
  TEST_PLAN_HASH.copy(data, PLAN_OFFSETS.planHash);
  twapPda[0].toBuffer().copy(data, PLAN_OFFSETS.twapState);
  TEST_ANCHOR_POLICY_HASH.copy(data, PLAN_OFFSETS.anchorPolicyHash);
  writeU64(data, PLAN_OFFSETS.adapterMask, 1n);
  data[PLAN_OFFSETS.bump] = planPda[1];
  overrides?.(data);
  return data;
}

export function buildTestSourceConfigHeader(
  sourceIndex = 0,
  overrides?: (data: Buffer) => void,
): Buffer {
  const data = Buffer.alloc(SOURCE_CONFIG_HEADER_LEN);
  const sourceConfigPda = findSourceConfigPda(TEST_FEED_ID, sourceIndex);
  SOURCE_CONFIG_MAGIC.copy(data, SOURCE_OFFSETS.magic);
  data.writeUInt16LE(0, SOURCE_OFFSETS.version);
  data.writeUInt16LE(SOURCE_CONFIG_HEADER_LEN, SOURCE_OFFSETS.headerLen);
  TEST_FEED_ID.copy(data, SOURCE_OFFSETS.feedId);
  data[SOURCE_OFFSETS.sourceIndex] = sourceIndex;
  data[SOURCE_OFFSETS.adapterType] = SourceAdapterType.OrcaWhirlpool;
  data[SOURCE_OFFSETS.status] = SourceStatus.Active;
  data[SOURCE_OFFSETS.direction] = SourceDirection.BasePerQuote;
  data.writeUInt16LE(0, SOURCE_OFFSETS.adapterVersion);
  data.writeUInt16LE(sourceIndex + 1, SOURCE_OFFSETS.venueGroup);
  data.writeUInt16LE(sourceIndex + 11, SOURCE_OFFSETS.operatorGroup);
  data.writeUInt16LE(sourceIndex + 21, SOURCE_OFFSETS.liquidityOwnerGroup);
  data.writeUInt16LE(sourceIndex + 31, SOURCE_OFFSETS.routeCorrelationGroup);
  data.writeUInt16LE(1, SOURCE_OFFSETS.quoteAssetGroup);
  data.writeUInt16LE(1, SOURCE_OFFSETS.bridgeOrWrapperGroup);
  data.writeUInt16LE(1, SOURCE_OFFSETS.oracleSourceClass);
  data.writeUInt16LE(sourceIndex + 41, SOURCE_OFFSETS.upgradeAuthorityGroup);
  data.writeUInt16LE(2_500, SOURCE_OFFSETS.maxSourceWeightBps);
  writeU128(data, SOURCE_OFFSETS.minLiquidityNative, 1_000_000n);
  writeU128(data, SOURCE_OFFSETS.minDepthTo50BpsNative, 500_000n);
  Buffer.alloc(32, 20).copy(data, SOURCE_OFFSETS.programId);
  Buffer.alloc(32, 21).copy(data, SOURCE_OFFSETS.poolOrMarket);
  Buffer.alloc(32, 22).copy(data, SOURCE_OFFSETS.baseVault);
  Buffer.alloc(32, 23).copy(data, SOURCE_OFFSETS.quoteVault);
  TEST_BASE_MINT.copy(data, SOURCE_OFFSETS.baseMint);
  TEST_QUOTE_MINT.copy(data, SOURCE_OFFSETS.quoteMint);
  Buffer.alloc(32, 24).copy(data, SOURCE_OFFSETS.tokenProgram);
  Buffer.alloc(32, 25).copy(data, SOURCE_OFFSETS.vaultAuthority);
  writeU64(data, SOURCE_OFFSETS.sourceConfigRevision, 1n);
  writeU64(data, SOURCE_OFFSETS.sourceSetRevision, 1n);
  data[SOURCE_OFFSETS.bump] = sourceConfigPda[1];
  overrides?.(data);
  return data;
}

export function buildTestCpmmSourceConfigHeader(
  sourceIndex = 0,
  overrides?: (data: Buffer) => void,
): Buffer {
  return buildTestSourceConfigHeader(sourceIndex, (data) => {
    data[SOURCE_OFFSETS.adapterType] = SourceAdapterType.RaydiumCpmm;
    RAYDIUM_CPMM_MAINNET_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.programId);
    SPL_TOKEN_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.tokenProgram);
    PublicKey.findProgramAddressSync(
      [Buffer.from("vault_and_lp_mint_auth_seed", "ascii")],
      RAYDIUM_CPMM_MAINNET_PROGRAM_ID,
    )[0]
      .toBuffer()
      .copy(data, SOURCE_OFFSETS.vaultAuthority);
    overrides?.(data);
  });
}

export function buildTestOrcaWhirlpoolSourceConfigHeader(
  sourceIndex = 0,
  overrides?: (data: Buffer) => void,
): Buffer {
  return buildTestSourceConfigHeader(sourceIndex, (data) => {
    data[SOURCE_OFFSETS.adapterType] = SourceAdapterType.OrcaWhirlpool;
    data[SOURCE_OFFSETS.direction] = SourceDirection.QuotePerBase;
    ORCA_WHIRLPOOL_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.programId);
    SPL_TOKEN_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.tokenProgram);
    writeU128(data, SOURCE_OFFSETS.minLiquidityNative, 1n);
    writeU128(data, SOURCE_OFFSETS.minDepthTo50BpsNative, 1n);
    Buffer.alloc(32, 41).copy(data, SOURCE_OFFSETS.poolOrMarket);
    Buffer.alloc(32, 42).copy(data, SOURCE_OFFSETS.baseVault);
    Buffer.alloc(32, 43).copy(data, SOURCE_OFFSETS.quoteVault);
    Buffer.alloc(32, 44).copy(data, SOURCE_OFFSETS.vaultAuthority);
    overrides?.(data);
  });
}

export function buildTestMeteoraDlmmSourceConfigHeader(
  sourceIndex = 0,
  overrides?: (data: Buffer) => void,
): Buffer {
  return buildTestSourceConfigHeader(sourceIndex, (data) => {
    data[SOURCE_OFFSETS.adapterType] = SourceAdapterType.MeteoraDlmm;
    data[SOURCE_OFFSETS.direction] = SourceDirection.QuotePerBase;
    METEORA_DLMM_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.programId);
    SPL_TOKEN_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.tokenProgram);
    writeU128(data, SOURCE_OFFSETS.minLiquidityNative, 1n);
    writeU128(data, SOURCE_OFFSETS.minDepthTo50BpsNative, 1n);
    Buffer.alloc(32, 51).copy(data, SOURCE_OFFSETS.poolOrMarket);
    Buffer.alloc(32, 52).copy(data, SOURCE_OFFSETS.baseVault);
    Buffer.alloc(32, 53).copy(data, SOURCE_OFFSETS.quoteVault);
    Buffer.alloc(32, 51).copy(data, SOURCE_OFFSETS.vaultAuthority);
    overrides?.(data);
  });
}

export function buildTestRaydiumClmmSourceConfigHeader(
  sourceIndex = 0,
  overrides?: (data: Buffer) => void,
): Buffer {
  return buildTestSourceConfigHeader(sourceIndex, (data) => {
    data[SOURCE_OFFSETS.adapterType] = SourceAdapterType.RaydiumClmm;
    data[SOURCE_OFFSETS.direction] = SourceDirection.QuotePerBase;
    RAYDIUM_CLMM_MAINNET_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.programId);
    SPL_TOKEN_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.tokenProgram);
    writeU128(data, SOURCE_OFFSETS.minLiquidityNative, 1n);
    writeU128(data, SOURCE_OFFSETS.minDepthTo50BpsNative, 1n);
    Buffer.alloc(32, 61).copy(data, SOURCE_OFFSETS.poolOrMarket);
    Buffer.alloc(32, 62).copy(data, SOURCE_OFFSETS.baseVault);
    Buffer.alloc(32, 63).copy(data, SOURCE_OFFSETS.quoteVault);
    Buffer.alloc(32, 61).copy(data, SOURCE_OFFSETS.vaultAuthority);
    overrides?.(data);
  });
}


export function buildTestFeedTwapStateHeader(overrides?: (data: Buffer) => void): Buffer {
  const data = Buffer.alloc(FEED_TWAP_HEADER_LEN);
  const twapPda = findFeedTwapPda(TEST_FEED_ID, TEST_TWAP_VERSION);
  FEED_TWAP_MAGIC.copy(data, TWAP_OFFSETS.magic);
  data.writeUInt16LE(0, TWAP_OFFSETS.version);
  data.writeUInt16LE(FEED_TWAP_HEADER_LEN, TWAP_OFFSETS.headerLen);
  TEST_FEED_ID.copy(data, TWAP_OFFSETS.feedId);
  data.writeUInt16LE(TEST_TWAP_VERSION, TWAP_OFFSETS.twapVersion);
  data[TWAP_OFFSETS.status] = TwapStatus.Active;
  data[TWAP_OFFSETS.freshnessProfile] = FreshnessProfile.AnchorChecked;
  writeU64(data, TWAP_OFFSETS.shortEndSlot, TEST_SNAPSHOT_SLOT);
  writeU64(data, TWAP_OFFSETS.mediumEndSlot, TEST_SNAPSHOT_SLOT);
  writeU64(data, TWAP_OFFSETS.longEndSlot, TEST_SNAPSHOT_SLOT);
  writeU128(data, TWAP_OFFSETS.twapShortX64, TEST_TWAP_PRICE_X64);
  writeU128(data, TWAP_OFFSETS.twapMediumX64, TEST_TWAP_PRICE_X64);
  writeU128(data, TWAP_OFFSETS.twapLongX64, TEST_TWAP_PRICE_X64);
  data.writeUInt16LE(9_500, TWAP_OFFSETS.coverageRatioBps);
  writeU64(data, TWAP_OFFSETS.sourceActivitySlotMin, TEST_SNAPSHOT_SLOT - 1n);
  writeU64(data, TWAP_OFFSETS.sourceMask, 0b1111n);
  writeU128(data, TWAP_OFFSETS.sanityMinDepthTo50BpsWindow, 500_000n);
  writeU128(data, TWAP_OFFSETS.sanityFeeLossFloorWindow, 500_000n);
  TEST_PLAN_HASH.copy(data, TWAP_OFFSETS.selectedPlanHash);
  Buffer.alloc(32, 26).copy(data, TWAP_OFFSETS.correlationMaskHash);
  writeU64(data, TWAP_OFFSETS.revision, 1n);
  writeU64(data, TWAP_OFFSETS.sourceSetRevision, 1n);
  data[TWAP_OFFSETS.bump] = twapPda[1];
  data.writeUInt16LE(15, TWAP_OFFSETS.maxConfidenceBps);
  data.writeUInt16LE(8, TWAP_OFFSETS.maxDispersionBps);
  writeU128(data, TWAP_OFFSETS.attackerSetEconLossFloorWindowNative, 600_000n);
  writeU128(
    data,
    TWAP_OFFSETS.attackerSetCapitalRequiredFloorWindowNative,
    15_000n,
  );
  data.writeUInt16LE(5_000, TWAP_OFFSETS.attackerSetWeightBps);
  data[TWAP_OFFSETS.attackerSetSourceCount] = 2;
  data[TWAP_OFFSETS.effectiveSourceCount] = 4;
  data.writeUInt16LE(0, TWAP_OFFSETS.capModelFlags);
  data.writeUInt16LE(CAP_MODEL_ECON_LOSS_BAND_BPS, TWAP_OFFSETS.econLossBandBps);
  writeU64(data, TWAP_OFFSETS.attackerSourceMask, 0b0011n);
  data[TWAP_OFFSETS.sourceTableCount] = 2;
  writeSourceCapEntryV2(data, TWAP_OFFSETS.sourceTable, 0, {
    sourceIndex: 0,
    flags: 1,
    weightBps: 2_500,
    routeCorrelationGroup: 1,
    econLossFloorNative: 250_000n,
    capitalRequiredFloorNative: 6_000n,
    sourceSetRevision: 1n,
  });
  writeSourceCapEntryV2(data, TWAP_OFFSETS.sourceTable, 1, {
    sourceIndex: 1,
    flags: 1,
    weightBps: 2_500,
    routeCorrelationGroup: 2,
    econLossFloorNative: 350_000n,
    capitalRequiredFloorNative: 9_000n,
    sourceSetRevision: 1n,
  });
  overrides?.(data);
  return data;
}

export function buildTestSourceObservationRingHeader(
  sourceIndex = 0,
  overrides?: (data: Buffer) => void,
): Buffer {
  const data = Buffer.alloc(SOURCE_RING_HEADER_LEN);
  const ringPda = findSourceRingPda(TEST_FEED_ID, sourceIndex, TEST_RING_VERSION);
  SOURCE_RING_MAGIC.copy(data, RING_OFFSETS.magic);
  data.writeUInt16LE(0, RING_OFFSETS.version);
  data.writeUInt16LE(SOURCE_RING_HEADER_LEN, RING_OFFSETS.headerLen);
  TEST_FEED_ID.copy(data, RING_OFFSETS.feedId);
  data[RING_OFFSETS.sourceIndex] = sourceIndex;
  data[RING_OFFSETS.status] = SourceStatus.Active;
  data.writeUInt16LE(TEST_RING_VERSION, RING_OFFSETS.ringVersion);
  data[RING_OFFSETS.adapterType] = SourceAdapterType.OrcaWhirlpool;
  data[RING_OFFSETS.observationKind] = ObservationKind.Bucket;
  data.writeUInt16LE(4, RING_OFFSETS.sampleCount);
  data.writeUInt16LE(16, RING_OFFSETS.capacity);
  data.writeUInt16LE(3, RING_OFFSETS.head);
  data.writeUInt16LE(1, RING_OFFSETS.minSlotGap);
  writeU64(data, RING_OFFSETS.newestSlot, TEST_SNAPSHOT_SLOT);
  writeU64(data, RING_OFFSETS.oldestSlot, TEST_SNAPSHOT_SLOT - 4n);
  writeU64(data, RING_OFFSETS.lastActivitySlot, TEST_SNAPSHOT_SLOT);
  writeU128(data, RING_OFFSETS.lastPriceX64, TEST_TWAP_PRICE_X64);
  data.writeUInt16LE(15, RING_OFFSETS.lastConfidenceBps);
  data.writeUInt16LE(20, RING_OFFSETS.lastSpreadBps);
  writeU128(data, RING_OFFSETS.lastDepthTo50BpsNative, 500_000n);
  writeU128(data, RING_OFFSETS.lastLiquidityNative, 1_000_000n);
  writeU128(data, RING_OFFSETS.cumulativePriceX64, TEST_TWAP_PRICE_X64 * 4n);
  writeU64(data, RING_OFFSETS.cumulativeSlotDelta, 4n);
  writeU64(data, RING_OFFSETS.sourceConfigRevision, 1n);
  writeU64(data, RING_OFFSETS.sourceSetRevision, 1n);
  Buffer.alloc(32, 27).copy(data, RING_OFFSETS.lastObservationHash);
  findSourceConfigPda(TEST_FEED_ID, sourceIndex)[0].toBuffer().copy(data, RING_OFFSETS.sourceConfig);
  Buffer.alloc(32, 21).copy(data, RING_OFFSETS.poolOrMarket);
  TEST_PLAN_HASH.copy(data, RING_OFFSETS.selectedPlanHash);
  data[RING_OFFSETS.bump] = ringPda[1];
  writeU128(data, RING_OFFSETS.lastEconLossFloorNative, 250_000n);
  writeU128(data, RING_OFFSETS.lastCapitalRequiredFloorNative, 5_000_000n);
  writeU64(data, RING_OFFSETS.lastFeeRatePpm, 2_500n);
  data.writeUInt16LE(CAP_MODEL_ECON_LOSS_BAND_BPS, RING_OFFSETS.econLossBandBps);
  data.writeUInt16LE(2_500, RING_OFFSETS.sourceWeightBps);
  data.writeUInt16LE(sourceIndex + 1, RING_OFFSETS.routeCorrelationGroup);
  data.writeUInt16LE(0, RING_OFFSETS.capModelFlags);
  data[RING_OFFSETS.feeSource] = 1;
  overrides?.(data);
  return data;
}

export function toTestSourceRingV1(prefix: Buffer): Buffer {
  const data = Buffer.alloc(SOURCE_RING_V1_HEADER_LEN);
  prefix.copy(data, 0, 0, SOURCE_RING_HEADER_LEN);
  data.writeUInt16LE(SOURCE_RING_V1_HEADER_LEN, RING_OFFSETS.headerLen);
  data.writeUInt16LE(1, RING_OFFSETS.ringVersion);
  data.writeUInt16LE(300, RING_OFFSETS.capacity);
  data.writeUInt16LE(0, RING_OFFSETS.head);
  data[RING_OFFSETS.observationKind] = ObservationKind.Spot;
  data[RING_OFFSETS.bump] = findSourceRingPda(data.subarray(RING_OFFSETS.feedId, RING_OFFSETS.feedId + 32), data[RING_OFFSETS.sourceIndex], 1)[1];
  for (const offset of [RING_OFFSETS.activeMinDepthTo50BpsNative, RING_OFFSETS.activeMinLiquidityNative,
    RING_OFFSETS.activeMinEconLossFloorNative, RING_OFFSETS.activeMinCapitalRequiredFloorNative]) writeU128(data, offset, 1n);
  const adapter = data[RING_OFFSETS.adapterType];
  const authenticated = adapter === SourceAdapterType.RaydiumCpmm || adapter === SourceAdapterType.MeteoraDlmm ||
    adapter === SourceAdapterType.RaydiumClmm;
  data[RING_OFFSETS.windowFlags] = authenticated ? 3 : 1;
  writeU64(data, RING_OFFSETS.completedEndSlot, data.readBigUInt64LE(RING_OFFSETS.newestSlot));
  writeU128(data, RING_OFFSETS.completedPriceX64, TEST_TWAP_PRICE_X64);
  for (const offset of [RING_OFFSETS.completedMinDepthTo50BpsNative, RING_OFFSETS.completedMinLiquidityNative,
    RING_OFFSETS.completedMinEconLossFloorNative, RING_OFFSETS.completedMinCapitalRequiredFloorNative]) writeU128(data, offset, 1n);
  return data;
}

export function defaultTestSnapshotPolicy(): SnapshotPolicy {
  return {
    expectedFeedId: TEST_FEED_ID,
    expectedPlanHash: TEST_PLAN_HASH,
    expectedAnchorPolicyHash: TEST_ANCHOR_POLICY_HASH,
    expectedNativeExceptionHash: TEST_NATIVE_EXCEPTION_HASH,
    expectedPriceExponent: TEST_PRICE_EXPONENT,
    clockSlot: TEST_CLOCK_SLOT,
    maxSnapshotAgeSlots: 5,
    maxSourceActivityAgeSlots: 5,
    minSourceCount: 4,
    minVenueCount: 4,
    minCorrelationGroupCount: 3,
    minCoverageRatioBps: 9_000,
    maxConfidenceBps: 50,
    maxDispersionBps: 100,
    notional: TEST_NOTIONAL,
    expectedSnapshotRevision: 1n,
    expectedTwapRevision: 0n,
    expectedRouteabilityStatus: RouteabilityStatus.TierA,
    flags: VerifyFlags.RequireTierA | VerifyFlags.AllowNativeException,
  };
}

export function defaultTestRefreshTwapPolicy(): RefreshTwapPolicy {
  return {
    expectedFeedId: TEST_FEED_ID,
    twapVersion: TEST_TWAP_VERSION,
    maxObservationAgeSlots: 5,
    minSourceCount: 1,
    expectedPrevRevision: 1n,
    expectedNewRevision: 2n,
  };
}
