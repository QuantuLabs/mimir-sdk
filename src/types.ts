import type { MimirLastUsable, MimirRingStamp, MimirSnapshotLiveness } from "./liveness.js";
export type Bytes32 = Uint8Array;

export interface FeedSnapshotHeader {
  liveness?: MimirSnapshotLiveness;
  lastUsable?: MimirLastUsable | null;
  feedId: Bytes32;
  feedConfig: Bytes32;
  registryEpoch: bigint;
  feedConfigRevision: bigint;
  snapshotRevision: bigint;
  status: number;
  routeabilityStatus: number;
  riskTier: number;
  snapshotSource: number;
  freshnessProfile: number;
  planProfile: number;
  snapshotSlot: bigint;
  validUntilSlot: bigint;
  snapshotUnixTs: bigint;
  spotSlot: bigint;
  oldestSourceObservedSlot: bigint;
  oldestSourceActivitySlot: bigint;
  twapShortEndSlot: bigint;
  twapMediumEndSlot: bigint;
  twapLongEndSlot: bigint;
  priceMantissa: bigint;
  priceExponent: number;
  priceX64: bigint;
  priceLowerX64: bigint;
  priceUpperX64: bigint;
  confidenceBps: number;
  dispersionBps: number;
  sourceCount: number;
  venueCount: number;
  correlationGroupCount: number;
  coverageRatioBps: number;
  quoteStatus: number;
  sourcingPlanId: number;
  sourcingPlanVersion: number;
  sourcingPlanHash: Bytes32;
  sourceMask: bigint;
  bandCapitalNotional: bigint;
  attackerSetFeeLossFloorMirror: bigint;
  anchorProvider: number;
  anchorStatus: number;
  anchorPolicyHash: Bytes32;
  nativeExceptionHash: Bytes32;
  capModelVersion: number;
  capModelFlags: number;
  econLossBandBps: number;
  attackerSetWeightBps: number;
  attackerSetSourceCount: number;
  effectiveSourceCount: number;
  capTierSafetyFactor: number;
  attackerSourceMask: bigint;
  attackerSetEconLossFloorNative: bigint;
  attackerSetCapitalRequiredFloorNative: bigint;
  capModelHash: Bytes32;
}

export interface FeedConfigHeader {
  feedId: Bytes32;
  baseMint: Bytes32;
  quoteMint: Bytes32;
  priceExponent: number;
  riskTier: number;
  lifecycleState: number;
  baseDecimals: number;
  quoteDecimals: number;
  minSourceCount: number;
  minVenueCount: number;
  minCorrelationGroupCount: number;
  minCoverageRatioBps: number;
  maxConfidenceBps: number;
  maxDispersionBps: number;
  maxSnapshotAgeSlots: number;
  maxSourceActivityAgeSlots: number;
  sourceSetHash: Bytes32;
  defaultSourcingPlan: Bytes32;
  fallbackSourcingPlan: Bytes32;
  anchorPolicyHash: Bytes32;
  nativeExceptionHash: Bytes32;
  feedConfigRevision: bigint;
  registryEpoch: bigint;
  bump: number;
}

export interface CompactCreateFeedConfigArgs {
  feedId: Bytes32;
  priceExponent: number;
  riskTier: number;
  baseDecimals: number;
  quoteDecimals: number;
}

export interface OracleRegistryHeader {
  authority: Bytes32;
  emergencyAuthority: Bytes32;
  supportedAdapterMask: bigint;
  supportedAdapterVersionMasks: readonly number[];
  minFeedConfigVersion: number;
  registryEpoch: bigint;
  status: number;
  bump: number;
}

export interface GovernancePolicyHeader {
  authority: Bytes32;
  signer0: Bytes32;
  signer1: Bytes32;
  signer2: Bytes32;
  threshold: number;
  status: number;
  bump: number;
  minDelaySlots: bigint;
  actionTtlSlots: bigint;
  revision: bigint;
}

export interface GovernanceActionHeader {
  policy: Bytes32;
  actionHash: Bytes32;
  targetKind: number;
  status: number;
  approvalMask: number;
  threshold: number;
  proposedSlot: bigint;
  effectiveSlot: bigint;
  expiresSlot: bigint;
  revision: bigint;
  bump: number;
}

export interface AdminConfigHeader {
  compositeOwnerShareBps: number;
  adminAuthority: Bytes32;
  feedCreationCollateralMint: Bytes32;
  feedCreationCollateralAmountRaw: bigint;
  feedCreationCollateralRequired: number;
  closePower: boolean;
  creationOpen: boolean;
  compositeRefreshFeeLamports: bigint;
  compositeActivationOwnerFeeLamports: bigint;
  compositeActivationTreasuryComponentFeeLamports: bigint;
  compositeActivationTreasuryCreationFeeLamports: bigint;
  /** Ticker tariff tenths of the base for lengths 2, 3, 4 and 5-12. */
  tickerTierTenths: readonly [number, number, number, number];
  feeTreasury: Bytes32;
  configRevision: bigint;
  rentRecoveryDestination: Bytes32;
  status: number;
  bump: number;
}

export interface FeedCollateralLockHeader {
  feedId: Bytes32;
  creator: Bytes32;
  collateralMint: Bytes32;
  lockedAmountRaw: bigint;
  createdSlot: bigint;
  createdUnixTs: bigint;
  adminConfigRevisionAtCreation: bigint;
  status: number;
  bump: number;
}

export interface FeedFeeVaultHeader {
  feedId: Bytes32;
  compositeConfig: Bytes32;
  identityAsset: Bytes32;
  ownerGeneratedLamports: bigint;
  totalRefreshFeesLamports: bigint;
  ownerClaimedLamports: bigint;
  treasuryPaidLamports: bigint;
  lastAccrualConfigRevision: bigint;
  status: number;
  bump: number;
}

export interface FeedFeeVaultClaimSummary {
  eligible: boolean;
  ownerGeneratedLamports: bigint;
  ownerClaimedLamports: bigint;
  ownerClaimableLamports: bigint;
}

export interface CompositeComponentConfig {
  feedId: Bytes32;
  sourceConfig: Bytes32;
  quantityX64: bigint;
}

export interface CompositeFeedConfigHeader {
  compositeFeedId: Bytes32;
  creator: Bytes32;
  quoteMint: Bytes32;
  solConversionSourceConfig: Bytes32;
  priceExponent: number;
  status: number;
  routeabilityCap: number;
  riskTier: number;
  componentCount: number;
  maxSnapshotAgeSlots: number;
  maxComponentSnapshotAgeSlots: number;
  maxComponentConfidenceBps: number;
  maxComponentDispersionBps: number;
  componentSetHash: Bytes32;
  registryEpoch: bigint;
  configRevision: bigint;
  adminConfigRevisionAtCreation: bigint;
  bump: number;
  ticker: string | null;
  components: readonly CompositeComponentConfig[];
}

export interface CompositeSnapshotComponent {
  feedId: Bytes32;
  snapshotRevision: bigint;
  snapshotSlot: bigint;
  priceX64: bigint;
  contributionX64: bigint;
}

export interface CompositeSnapshotHeader {
  /** 1 marks an uncertified point-derived basket; absent/0 is the legacy form. */
  flags?: number;
  compositeFeedId: Bytes32;
  compositeConfig: Bytes32;
  registryEpoch: bigint;
  configRevision: bigint;
  snapshotRevision: bigint;
  status: number;
  routeabilityStatus: number;
  riskTier: number;
  snapshotSource: number;
  freshnessProfile: number;
  componentCount: number;
  quoteStatus: number;
  snapshotSlot: bigint;
  validUntilSlot: bigint;
  snapshotUnixTs: bigint;
  oldestComponentSnapshotSlot: bigint;
  oldestComponentActivitySlot: bigint;
  priceMantissa: bigint;
  priceExponent: number;
  confidenceBps: number;
  dispersionBps: number;
  priceX64: bigint;
  priceLowerX64: bigint;
  priceUpperX64: bigint;
  componentMinCapitalFloor: bigint;
  componentMinFeeLossFloor: bigint;
  componentSetHash: Bytes32;
  componentSnapshotHash: Bytes32;
  anchorProvider: number;
  anchorStatus: number;
  components: readonly CompositeSnapshotComponent[];
}

export interface CreateCompositeFeedConfigV1Args {
  creator: Bytes32;
  quoteMint: Bytes32;
  solConversionSourceConfig?: Bytes32;
  cluster: "mainnet" | "localnet" | "devnet";
  priceExponent: number;
  maxSnapshotAgeSlots: number;
  maxComponentSnapshotAgeSlots: number;
  maxComponentConfidenceBps: number;
  maxComponentDispersionBps: number;
  registryEpoch: bigint;
  configRevision: bigint;
  adminConfigRevisionAtCreation: bigint;
  refreshFeeLamports: bigint;
  components: readonly CompositeComponentConfig[];
}

export interface CreateFeedConfigWithAdminV1Args {
  config: CompactCreateFeedConfigArgs;
  expectedAdminConfigRevision: bigint;
}

export interface ClaimRefreshFeesV1Args {
  feedId: Bytes32;
  expectedOwnerClaimedLamports: bigint;
  claimAmountLamports: bigint;
}

export interface FeedReservationHeader {
  feedId: Bytes32;
  authority: Bytes32;
  baseMint: Bytes32;
  quoteMint: Bytes32;
  maxRiskTier: number;
  status: number;
  bump: number;
  registryEpoch: bigint;
  reservationRevision: bigint;
}

export interface SourcingPlanHeader {
  feedId: Bytes32;
  planId: number;
  planVersion: number;
  profile: number;
  status: number;
  riskTier: number;
  minSources: number;
  minVenues: number;
  minCorrelationGroups: number;
  maxDispersionBps: number;
  maxSourceActivityAgeSlots: number;
  priceExponent: number;
  baseMint: Bytes32;
  quoteMint: Bytes32;
  sourceSetHash: Bytes32;
  accountsHash: Bytes32;
  planHash: Bytes32;
  twapState: Bytes32;
  anchorPolicyHash: Bytes32;
  adapterMask: bigint;
  bump: number;
}

export interface LifecycleSourcingPlanHeader extends SourcingPlanHeader {
  hashSchemeVersion: number;
  ringVersion: number;
  accountsBindingVersion: number;
}

export interface LifecycleFeedConfigHeader extends FeedConfigHeader {
  identityAsset: Bytes32;
}

export interface LifecycleFeedTwapSentinel {
  feedId: Bytes32;
  twapVersion: number;
  status: number;
  selectedPlanHash: Bytes32;
  revision: 0n;
  sourceSetRevision: 1n;
  bump: number;
}

export interface LifecycleFeedSnapshotSentinel {
  feedId: Bytes32;
  feedConfig: Bytes32;
  registryEpoch: bigint;
  feedConfigRevision: 1n;
  snapshotRevision: 0n;
  status: number;
  routeabilityStatus: number;
  riskTier: number;
  snapshotSource: number;
  freshnessProfile: number;
  planProfile: number;
  priceExponent: number;
  sourcingPlanId: number;
  sourcingPlanVersion: number;
  sourcingPlanHash: Bytes32;
  anchorPolicyHash: Bytes32;
  nativeExceptionHash: Bytes32;
}

export interface CompactCreateSourcingPlanArgs {
  feedId: Bytes32;
  planId: number;
  planVersion: number;
  profile: number;
  riskTier: number;
  minSources: number;
  minVenues: number;
  minCorrelationGroups: number;
  maxDispersionBps: number;
  maxSourceActivityAgeSlots: number;
  minCoverageRatioBps: number;
  maxConfidenceBps: number;
  maxSnapshotAgeSlots: number;
  sourceSetHash: Bytes32;
  accountsHash: Bytes32;
  planHash: Bytes32;
  anchorPolicyHash: Bytes32;
  nativeExceptionHash: Bytes32;
  adapterMask: bigint;
}

export interface SourceConfigHeader {
  feedId: Bytes32;
  sourceIndex: number;
  adapterType: number;
  status: number;
  direction: number;
  adapterVersion: number;
  venueGroup: number;
  operatorGroup: number;
  liquidityOwnerGroup: number;
  routeCorrelationGroup: number;
  quoteAssetGroup: number;
  bridgeOrWrapperGroup: number;
  oracleSourceClass: number;
  upgradeAuthorityGroup: number;
  maxSourceWeightBps: number;
  minLiquidityNative: bigint;
  minDepthTo50BpsNative: bigint;
  programId: Bytes32;
  poolOrMarket: Bytes32;
  baseVault: Bytes32;
  quoteVault: Bytes32;
  baseMint: Bytes32;
  quoteMint: Bytes32;
  tokenProgram: Bytes32;
  vaultAuthority: Bytes32;
  sourceConfigRevision: bigint;
  sourceSetRevision: bigint;
  bump: number;
  flags: number;
  temporalMode: "sampled-interval" | "current-point";
}

export interface CompactSourceConfigArgs {
  feedId: Bytes32;
  sourceIndex: number;
  adapterType: number;
  direction: number;
  adapterVersion: number;
  venueGroup: number;
  operatorGroup: number;
  liquidityOwnerGroup: number;
  routeCorrelationGroup: number;
  quoteAssetGroup: number;
  bridgeOrWrapperGroup: number;
  oracleSourceClass: number;
  upgradeAuthorityGroup: number;
  maxSourceWeightBps: number;
  minLiquidityNative: bigint;
  minDepthTo50BpsNative: bigint;
  programId: Bytes32;
  poolOrMarket: Bytes32;
  baseVault: Bytes32;
  quoteVault: Bytes32;
  tokenProgram: Bytes32;
  vaultAuthority: Bytes32;
  sourceConfigRevision: bigint;
  sourceSetRevision: bigint;
}

export interface FeedTwapStateHeader {
  feedId: Bytes32;
  twapVersion: number;
  status: number;
  freshnessProfile: number;
  shortEndSlot: bigint;
  mediumEndSlot: bigint;
  longEndSlot: bigint;
  twapShortX64: bigint;
  twapMediumX64: bigint;
  twapLongX64: bigint;
  coverageRatioBps: number;
  sourceActivitySlotMin: bigint;
  sourceMask: bigint;
  unknownActivitySourceMask: bigint;
  sanityMinDepthTo50BpsWindow: bigint;
  sanityFeeLossFloorWindow: bigint;
  selectedPlanHash: Bytes32;
  correlationMaskHash: Bytes32;
  revision: bigint;
  sourceSetRevision: bigint;
  bump: number;
  maxConfidenceBps: number;
  maxDispersionBps: number;
  attackerSetEconLossFloorWindowNative: bigint;
  attackerSetCapitalRequiredFloorWindowNative: bigint;
  attackerSetWeightBps: number;
  attackerSetSourceCount: number;
  effectiveSourceCount: number;
  capModelFlags: number;
  econLossBandBps: number;
  attackerSourceMask: bigint;
  sourceTableCount: number;
  sourceCapEntries: readonly SourceCapEntryV2[];
}

export interface SourceCapEntryV2 {
  sourceIndex: number;
  flags: number;
  weightBps: number;
  routeCorrelationGroup: number;
  econLossFloorNative: bigint;
  capitalRequiredFloorNative: bigint;
  sourceSetRevision: bigint;
}

export interface SourceObservationRingHeader {
  stamp?: MimirRingStamp;
  feedId: Bytes32;
  sourceIndex: number;
  status: number;
  ringVersion: number;
  adapterType: number;
  observationKind: number;
  sampleCount: number;
  capacity: number;
  head: number;
  minSlotGap: number;
  newestSlot: bigint;
  oldestSlot: bigint;
  lastActivitySlot: bigint;
  lastPriceX64: bigint;
  lastConfidenceBps: number;
  lastSpreadBps: number;
  lastDepthTo50BpsNative: bigint;
  lastLiquidityNative: bigint;
  cumulativePriceX64: bigint;
  cumulativeSlotDelta: bigint;
  sourceConfigRevision: bigint;
  sourceSetRevision: bigint;
  lastObservationHash: Bytes32;
  sourceConfig: Bytes32;
  poolOrMarket: Bytes32;
  selectedPlanHash: Bytes32;
  bump: number;
  lastEconLossFloorNative: bigint;
  lastCapitalRequiredFloorNative: bigint;
  lastFeeRatePpm: bigint;
  econLossBandBps: number;
  sourceWeightBps: number;
  routeCorrelationGroup: number;
  capModelFlags: number;
  feeSource: number;
}

export interface SourceObservationRingV1Header extends SourceObservationRingHeader {
  windowFlags: number;
  /** Zero-fee point-only ring (flag 1 @12): economic fields are zero; only sampled kind 9 consumes it. */
  pointOnly?: true;
  activeMaxConfidenceBps: number;
  activeMaxSpreadBps: number;
  activeCapModelFlags: number;
  completedMaxConfidenceBps: number;
  completedMaxSpreadBps: number;
  completedCapModelFlags: number;
  activeMinDepthTo50BpsNative: bigint;
  activeMinLiquidityNative: bigint;
  activeMinEconLossFloorNative: bigint;
  activeMinCapitalRequiredFloorNative: bigint;
  completedEndSlot: bigint;
  completedActivitySlot: bigint;
  completedPriceX64: bigint;
  completedMinDepthTo50BpsNative: bigint;
  completedMinLiquidityNative: bigint;
  completedMinEconLossFloorNative: bigint;
  completedMinCapitalRequiredFloorNative: bigint;
}

export interface DammOnlyBAnchorV1 {
  slot: bigint;
  unixTs: bigint;
  sqrtPrice: bigint;
  lpBCumulative: bigint;
  protocolBCumulative: bigint;
  permanentK: bigint;
}

export interface DammOnlyBIntervalTailV1 {
  kind: "damm-onlyb-interval-v1";
  contextHash: Bytes32;
  lastObservationUnixTs: bigint;
  invalidated: boolean;
  anchor: DammOnlyBAnchorV1;
  pendingAnchor: DammOnlyBAnchorV1 | null;
  publication: {
    lowerX64: bigint;
    upperX64: bigint;
    startSlot: bigint;
    startUnixTs: bigint;
    endSlot: bigint;
    endUnixTs: bigint;
    revision: bigint;
  } | null;
}

export interface SourceTemporalModuleV1 {
  abiVersion: 1;
  lastModuleRefreshSlot: bigint;
  dammOnlyBTail: DammOnlyBIntervalTailV1;
}

/** Exact reserve-surplus witness retained with its genuine anchor. */
export interface DammReserveAnchorV3 extends DammOnlyBAnchorV1 { db: bigint; }
export interface DammReserveIntervalTailV3 extends Omit<DammOnlyBIntervalTailV1, "kind" | "anchor" | "pendingAnchor"> {
  kind: "damm-reserve-interval-v3";
  anchor: DammReserveAnchorV3;
  pendingAnchor: DammReserveAnchorV3 | null;
}
export interface DammReserveTemporalModuleV3 {
  abiVersion: 3;
  lastModuleRefreshSlot: bigint;
  dammReserveTail: DammReserveIntervalTailV3;
}

export interface CpmmQuietTemporalAnchorV2 {
  slot: bigint;
  unixTs: bigint;
  nativeLastUpdate: bigint;
  netX: bigint;
  netY: bigint;
  lpSupply: bigint;
}

export interface CpmmQuietTemporalModuleV2 {
  kind: "cpmm-quiet-interval-v2";
  abiVersion: 2;
  ringNewestSlot: bigint;
  contextHash: Bytes32;
  lastRefreshUnixTs: bigint;
  anchorA: CpmmQuietTemporalAnchorV2;
  anchorB: CpmmQuietTemporalAnchorV2 | null;
  qLowerX64: bigint;
  qUpperX64: bigint;
  invalidated: boolean;
}

export interface SnapshotPolicy {
  expectedFeedId: Bytes32;
  expectedPlanHash: Bytes32;
  expectedAnchorPolicyHash: Bytes32;
  expectedNativeExceptionHash: Bytes32;
  expectedPriceExponent: number;
  clockSlot: bigint;
  maxSnapshotAgeSlots: number;
  maxSourceActivityAgeSlots: number;
  minSourceCount: number;
  minVenueCount: number;
  minCorrelationGroupCount: number;
  minCoverageRatioBps: number;
  maxConfidenceBps: number;
  maxDispersionBps: number;
  notional: bigint;
  expectedSnapshotRevision: bigint;
  expectedTwapRevision: bigint;
  expectedRouteabilityStatus: number;
  flags: number;
  /** Tag-0 minimum mode: the snapshot/TWAP revisions are floors and the accepted observation is returned. */
  minimumRevision?: boolean;
}

export interface RefreshTwapPolicy {
  expectedFeedId: Bytes32;
  twapVersion: number;
  maxObservationAgeSlots: number;
  minSourceCount: number;
  expectedPrevRevision: bigint;
  expectedNewRevision: bigint;
}

export interface RaydiumCpmmNativeTwapObservationSample {
  observationState: Bytes32;
  oldTimestamp: bigint;
  newTimestamp: bigint;
  lastUpdateTimestamp: bigint;
  oldCumulativeToken0PriceX32: bigint;
  newCumulativeToken0PriceX32: bigint;
  oldCumulativeToken1PriceX32: bigint;
  newCumulativeToken1PriceX32: bigint;
}

export interface ProjectRaydiumCpmmObservationAfterCrankParams {
  observationData: Uint8Array;
  currentUnixTs: bigint;
  token0PriceX32: bigint;
  token1PriceX32: bigint;
}
/** Witnesses open existing source fingerprints; UNKNOWN has no temporal claim. */
export type MimirMixedBoundedProofV1 =
  | Readonly<{ kind: 0 }>
  | Readonly<{ kind: 4 }>
  | Readonly<{ kind: 5 }>
  | Readonly<{ kind: 6 }>
  /** Orca Whirlpool marker-quiet interval; tail [Whirlpool, Orca program, Orca ProgramData]. */
  | Readonly<{ kind: 7 }>
  /** Generic sampled interval (MTP4); tail [MTP4, DEX program, ProgramData]; snapshot source 6. */
  | Readonly<{ kind: 9 }>
  /** Current point (MTP4 kind 10, policy 2); tail [MTP4, DEX program, ProgramData]; snapshot source 7. */
  | Readonly<{ kind: 10 }>
  /** Execution-opening native proof: wire kind 0x80|kind, empty payload; the program selects the witness at execution. */
  | Readonly<{ kind: 1 | 2 | 3; openingMode: "execution" }>
  | Readonly<{ kind: 1; openingMode?: "prepared"; oraclePubkey: Uint8Array; latestIndex: number;
      oldTimestamp: bigint; oldCumulative: bigint; latestTimestamp: bigint; latestCumulative: bigint;
      currentTick: number; token2022?: MimirMixedToken2022BindingV1 }>
  /** Native-bounded V2: old/new timestamps and cumulatives are the fixed historical bracket; lower/upper are committed bounds. */
  | Readonly<{ kind: 2; openingMode?: "prepared"; oraclePubkey: Uint8Array; oldTimestamp: bigint; newTimestamp: bigint;
      selectedOldCumulative: bigint; selectedNewCumulative: bigint; lowerX64: bigint; upperX64: bigint }>
  | Readonly<{ kind: 3; openingMode?: "prepared"; oraclePubkey: Uint8Array; oldTimestamp: bigint; newTimestamp: bigint;
      oldCumulativeBin: bigint; newCumulativeBin: bigint; token2022?: MimirMixedToken2022BindingV1 }>;

export type MimirMixedNativeOpeningMode = "prepared" | "execution";

export interface MimirMixedToken2022BindingV1 {
  readonly selectedMint: Uint8Array;
  readonly selectedBase: boolean;
  readonly selectedMultiplierQ64: bigint;
}
