import { Buffer } from "buffer";
import type { PublicKey } from "@solana/web3.js";

interface PublicKeyConstructor {
  new (value: string | Uint8Array): PublicKey;
  findProgramAddressSync(
    seeds: readonly Uint8Array[],
    programId: PublicKey,
  ): [PublicKey, number];
}

const ADDRESSES = {
  MIMIR: "dGJWYdFVUT8tVsH8CJLrfGwCyy9BzdELa46h3oMiMir",
  SYSTEM: "11111111111111111111111111111111",
  SYSVAR_INSTRUCTIONS: "Sysvar1nstructions1111111111111111111111111",
  SYSVAR_CLOCK: "SysvarC1ock11111111111111111111111111111111",
  SPL_TOKEN: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  SPL_NATIVE_MINT: "So11111111111111111111111111111111111111112",
  SPL_ASSOCIATED_TOKEN: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  SPL_TOKEN_2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  COLA: "CoLAyH8CRuBLyr2BRDozka3dJ5XH97BSa6WpZL9NAqWL",
  RAYDIUM_CPMM: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  RAYDIUM_CLMM: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  RAYDIUM_AMM_V4: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  ORCA_WHIRLPOOL: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  ORCA_WHIRLPOOLS_CONFIG: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
  METEORA_DLMM: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  METEORA_DAMM_V2: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  PUMPSWAP: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  PUMP: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  PUMP_FEE: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
} as const;

const BYTES = {
  RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR: "f7ede3f5d7c3de46",
  RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR: "7aaec5358109a584",
  RAYDIUM_CPMM_OBSERVATION_SEED: "6f62736572766174696f6e",
  FEED_SNAPSHOT_MAGIC: "4d494d4952534e50",
  FEED_CONFIG_MAGIC: "4d494d4952434647",
  FEED_RESERVATION_MAGIC: "4d494d4952525356",
  ORACLE_REGISTRY_MAGIC: "4d494d4952524547",
  SOURCING_PLAN_MAGIC: "4d494d4952504c4e",
  SOURCE_CONFIG_MAGIC: "4d494d4952535243",
  FEED_TWAP_MAGIC: "4d494d4952545750",
  SOURCE_RING_MAGIC: "4d494d4952524e47",
  NATIVE_TWAP_PROOF_MAGIC: "4d494d49524e5450",
  GOVERNANCE_POLICY_MAGIC: "4d494d4952474f56",
  GOVERNANCE_ACTION_MAGIC: "4d494d4952414354",
  ADMIN_CONFIG_MAGIC: "4d494d4952434647",
  FEED_COLLATERAL_LOCK_MAGIC: "4d494d4952434f4c",
  FEED_FEE_VAULT_MAGIC: "4d494d4952464545",
  COMPOSITE_FEED_CONFIG_MAGIC: "4d494d4952434643",
  COMPOSITE_SNAPSHOT_MAGIC: "4d494d4952435350",
  CAP_MODEL_HASH_V2: "4d494d49525f4341505f4d4f44454c5f56325f46494e414c5f32303236303632",
} as const;

const RECORDS = {
  SourceDirection: { BasePerQuote: 0, QuotePerBase: 1 },
  OFFSETS: {
    magic: 0, version: 8, headerLen: 10, feedId: 16, feedConfig: 48,
    registryEpoch: 80, feedConfigRevision: 88, snapshotRevision: 96,
    status: 104, routeabilityStatus: 105, riskTier: 106, snapshotSource: 107,
    freshnessProfile: 108, planProfile: 109, snapshotSlot: 116,
    validUntilSlot: 124, snapshotUnixTs: 132, spotSlot: 140,
    oldestSourceObservedSlot: 148, oldestSourceActivitySlot: 156,
    twapShortEndSlot: 164, twapMediumEndSlot: 172, twapLongEndSlot: 180,
    priceMantissa: 188, priceExponent: 196, priceX64: 200,
    priceLowerX64: 216, priceUpperX64: 232, confidenceBps: 248,
    dispersionBps: 250, sourceCount: 252, venueCount: 253,
    correlationGroupCount: 254, coverageRatioBps: 255, quoteStatus: 257,
    sourcingPlanId: 258, sourcingPlanVersion: 260, sourcingPlanHash: 262,
    sourceMask: 294, bandCapitalNotional: 302, attackerSetFeeLossFloorMirror: 318,
    anchorProvider: 334, anchorStatus: 335, anchorConfidenceBps: 352,
    anchorDivergenceBps: 354, anchorPolicyHash: 356, nativeExceptionHash: 388,
    capModelVersion: 420, capModelFlags: 422, econLossBandBps: 424,
    attackerSetWeightBps: 426, attackerSetSourceCount: 428,
    effectiveSourceCount: 429, capTierSafetyFactor: 430,
    attackerSourceMask: 432, attackerSetEconLossFloorNative: 440,
    attackerSetCapitalRequiredFloorNative: 456, capModelHash: 472,
  },
  SnapshotStatus: { Fresh: 0, Degraded: 1, Stale: 2, Halted: 3 },
  RouteabilityStatus: { Unrated: 0, TierC: 1, TierB: 2, TierA: 3, SafetyOnly: 4, Disabled: 5 },
  RiskTier: { Unrated: 0, TierC: 1, TierB: 2, TierA: 3 },
  SnapshotSource: { Keeper: 0, AtomicLite: 1, Deep: 2, Emergency: 3, Composite: 4, MixedBounded: 5, Sampled: 6 },
  FreshnessProfile: { Hot0: 0, Hot1: 1, Fast2: 2, Safe5: 3, PreviousSlotOnly: 4, AnchorChecked: 5 },
  PlanProfile: { Snapshot: 0, AtomicLite3: 1, AtomicLite4: 2, AtomicLite5: 3, Deep: 4 },
  QuoteStatus: { Ok: 0, Depeg: 1, Unknown: 2 },
  AnchorProvider: { None: 0, NativeOnlyException: 4 },
  AnchorStatus: { Ok: 0, Missing: 1, Stale: 2, WideConfidence: 3, Diverged: 4, InvalidVerification: 5 },
  FeedLifecycleState: { Created: 0, SourcesPending: 1, Warming: 2, Active: 3, SafetyOnly: 4, Deprecated: 5, Paused: 6, Halted: 7 },
  RegistryStatus: { Active: 0, SafetyOnly: 1, Paused: 2 },
  PlanStatus: { Active: 0, SafetyOnly: 1, Deprecated: 2, Paused: 3 },
  SourceAdapterType: { OrcaWhirlpool: 0, RaydiumClmm: 1, RaydiumCpmm: 2, MeteoraDlmm: 3, RaydiumAmmV4: 4, Reserved5: 5, PumpSwap: 6, MeteoraDammV2: 7, Custom: 5 },
  SourceStatus: { Active: 0, Disabled: 1, Paused: 2 },
  TwapStatus: { Active: 0, Stale: 1, Paused: 2 },
  ObservationKind: { Spot: 0, Bucket: 1 },
  CONFIG_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, feedId: 16,
    baseMint: 48, quoteMint: 80, priceExponent: 112, riskTier: 116,
    lifecycleState: 117, baseDecimals: 118, quoteDecimals: 119,
    minSourceCount: 120, minVenueCount: 121, minCorrelationGroupCount: 122,
    minCoverageRatioBps: 124, maxConfidenceBps: 126, maxDispersionBps: 128,
    maxSnapshotAgeSlots: 130, maxSourceActivityAgeSlots: 132,
    sourceSetHash: 136, defaultSourcingPlan: 168, fallbackSourcingPlan: 200,
    anchorPolicyHash: 232, nativeExceptionHash: 264, feedConfigRevision: 296,
    registryEpoch: 304, bump: 312,
  },
  REGISTRY_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, authority: 16,
    emergencyAuthority: 48, supportedAdapterMask: 80, minFeedConfigVersion: 88,
    registryEpoch: 96, status: 104, bump: 105, adapterVersionMasks: 106,
  },
  RESERVATION_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, feedId: 16,
    authority: 48, baseMint: 80, quoteMint: 112, maxRiskTier: 144,
    status: 145, bump: 146, registryEpoch: 152, reservationRevision: 160,
  },
  FeedReservationStatus: { Reserved: 0, Consumed: 1, Revoked: 2 },
  PLAN_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, feedId: 16, planId: 48,
    planVersion: 50, profile: 52, status: 53, riskTier: 54, minSources: 55,
    minVenues: 56, minCorrelationGroups: 57, maxDispersionBps: 58,
    maxSourceActivityAgeSlots: 60, priceExponent: 64, baseMint: 68,
    quoteMint: 100, sourceSetHash: 132, accountsHash: 164, planHash: 196,
    twapState: 228, anchorPolicyHash: 260, adapterMask: 292, bump: 300,
    hashSchemeVersion: 301, ringVersion: 302, accountsBindingVersion: 304,
    reservedTail: 305,
  },
  SOURCE_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, feedId: 16,
    sourceIndex: 48, adapterType: 49, status: 50, direction: 51,
    adapterVersion: 52, venueGroup: 54, operatorGroup: 56,
    liquidityOwnerGroup: 58, routeCorrelationGroup: 60, quoteAssetGroup: 62,
    bridgeOrWrapperGroup: 64, oracleSourceClass: 66, upgradeAuthorityGroup: 68,
    maxSourceWeightBps: 70, minLiquidityNative: 72,
    minDepthTo50BpsNative: 88, programId: 104, poolOrMarket: 136,
    baseVault: 168, quoteVault: 200, baseMint: 232, quoteMint: 264,
    tokenProgram: 296, vaultAuthority: 328, sourceConfigRevision: 360,
    sourceSetRevision: 368, bump: 376,
  },
  TWAP_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, feedId: 16,
    twapVersion: 48, status: 50, freshnessProfile: 51, shortEndSlot: 56,
    mediumEndSlot: 64, longEndSlot: 72, twapShortX64: 80,
    twapMediumX64: 96, twapLongX64: 112, coverageRatioBps: 128,
    sourceActivitySlotMin: 136, sourceMask: 144, unknownActivitySourceMask: 152,
    sanityMinDepthTo50BpsWindow: 160, sanityFeeLossFloorWindow: 176,
    selectedPlanHash: 192, correlationMaskHash: 224, revision: 256,
    sourceSetRevision: 264, bump: 272, maxConfidenceBps: 273,
    maxDispersionBps: 275, attackerSetEconLossFloorWindowNative: 320,
    attackerSetCapitalRequiredFloorWindowNative: 336,
    attackerSetWeightBps: 352, attackerSetSourceCount: 354,
    effectiveSourceCount: 355, capModelFlags: 356, econLossBandBps: 358,
    attackerSourceMask: 360, sourceTableCount: 368, sourceTable: 384,
  },
  RING_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, feedId: 16,
    sourceIndex: 48, status: 49, ringVersion: 50, adapterType: 52,
    observationKind: 53, sampleCount: 54, capacity: 56, head: 58,
    minSlotGap: 60, newestSlot: 64, oldestSlot: 72, lastActivitySlot: 80,
    lastPriceX64: 88, lastConfidenceBps: 104, lastSpreadBps: 106,
    lastDepthTo50BpsNative: 112, lastLiquidityNative: 128,
    cumulativePriceX64: 144, cumulativeSlotDelta: 160,
    sourceConfigRevision: 168, sourceSetRevision: 176,
    lastObservationHash: 184, sourceConfig: 216, poolOrMarket: 248,
    selectedPlanHash: 280, bump: 312, lastEconLossFloorNative: 320,
    lastCapitalRequiredFloorNative: 336, lastFeeRatePpm: 352,
    econLossBandBps: 360, sourceWeightBps: 362, routeCorrelationGroup: 364,
    capModelFlags: 366, feeSource: 368, windowFlags: 369,
    activeMaxConfidenceBps: 370, activeMaxSpreadBps: 372,
    activeCapModelFlags: 374, completedMaxConfidenceBps: 376,
    completedMaxSpreadBps: 378, completedCapModelFlags: 380,
    v1Reserved: 382, activeMinDepthTo50BpsNative: 384,
    activeMinLiquidityNative: 400, activeMinEconLossFloorNative: 416,
    activeMinCapitalRequiredFloorNative: 432, completedEndSlot: 448,
    completedActivitySlot: 456, completedPriceX64: 464,
    completedMinDepthTo50BpsNative: 480, completedMinLiquidityNative: 496,
    completedMinEconLossFloorNative: 512,
    completedMinCapitalRequiredFloorNative: 528,
  },
  SOURCE_CAP_ENTRY_OFFSETS: {
    sourceIndex: 0, flags: 1, weightBps: 2, routeCorrelationGroup: 4,
    reserved: 6, econLossFloorNative: 8, capitalRequiredFloorNative: 24,
    sourceSetRevision: 40,
  },
  GOVERNANCE_POLICY_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, authority: 16,
    signer0: 48, signer1: 80, signer2: 112, threshold: 144, status: 145,
    bump: 146, minDelaySlots: 152, actionTtlSlots: 160, revision: 168,
  },
  GOVERNANCE_ACTION_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, policy: 16,
    actionHash: 48, targetKind: 80, status: 81, approvalMask: 82,
    threshold: 83, proposedSlot: 88, effectiveSlot: 96, expiresSlot: 104,
    revision: 112, bump: 120,
  },
  ADMIN_CONFIG_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, status: 12, bump: 13,
    compositeOwnerShareBps: 14, adminAuthority: 16, collateralMint: 48,
    collateralAmountRaw: 80, collateralRequired: 88,
    compositeRefreshFeeLamports: 96, reserved1: 104,
    compositeActivationOwnerFeeLamports: 104, compositeActivationTreasuryComponentFeeLamports: 108,
    compositeActivationTreasuryCreationFeeLamports: 112, tickerTierTenths: 116, feeTreasury: 120,
    configRevision: 152, rentRecoveryDestination: 160,
  },
  FEED_COLLATERAL_LOCK_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, feedId: 16,
    creator: 48, collateralMint: 80, lockedAmountRaw: 112, createdSlot: 120,
    createdUnixTs: 128, adminConfigRevisionAtCreation: 136, status: 144,
    bump: 145, reservedTail: 146,
  },
  FEED_FEE_VAULT_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, feedId: 16,
    compositeConfig: 48, identityAsset: 80, ownerGeneratedLamports: 112,
    totalRefreshFeesLamports: 120, ownerClaimedLamports: 128,
    treasuryPaidLamports: 136, lastAccrualConfigRevision: 144,
    status: 152, bump: 153, reservedTail: 154,
  },
  COMPOSITE_CONFIG_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, feedId: 16,
    creator: 48, quoteMint: 80, priceExponent: 112, status: 116,
    routeabilityCap: 117, riskTier: 118, componentCount: 119,
    maxSnapshotAgeSlots: 120, maxComponentSnapshotAgeSlots: 122,
    maxComponentConfidenceBps: 124, maxComponentDispersionBps: 126,
    componentSetHash: 128, registryEpoch: 160, configRevision: 168,
    adminConfigRevisionAtCreation: 176, bump: 184,
    solConversionSourceConfig: 197, components: 229,
  },
  COMPOSITE_COMPONENT_OFFSETS: { feedId: 0, feedConfig: 32, quantityX64: 64 },
  COMPOSITE_SNAPSHOT_OFFSETS: {
    magic: 0, version: 8, headerLen: 10, flags: 12, feedId: 16,
    compositeConfig: 48, registryEpoch: 80, configRevision: 88,
    snapshotRevision: 96, status: 104, routeabilityStatus: 105,
    riskTier: 106, snapshotSource: 107, freshnessProfile: 108,
    componentCount: 109, quoteStatus: 110, snapshotSlot: 112,
    validUntilSlot: 120, snapshotUnixTs: 128,
    oldestComponentSnapshotSlot: 136, oldestComponentActivitySlot: 144,
    priceMantissa: 152, priceExponent: 160, confidenceBps: 164,
    dispersionBps: 166, priceX64: 168, priceLowerX64: 184,
    priceUpperX64: 200, componentMinCapitalFloor: 216,
    componentMinFeeLossFloor: 232, componentSetHash: 248,
    componentSnapshotHash: 280, anchorProvider: 312, anchorStatus: 313,
    components: 320,
  },
  COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS: {
    feedId: 0, snapshotRevision: 32, snapshotSlot: 40, priceX64: 48,
    contributionX64: 64,
  },
  FeedCollateralLockStatus: { Locked: 1, OneCharGranted: 2 },
  FeedFeeVaultStatus: { Active: 1 },
  AdminConfigStatus: { Active: 1, Paused: 2 },
  GovernancePolicyStatus: { Active: 0, Paused: 1 },
  GovernanceActionStatus: { Pending: 0, Approved: 1, Consumed: 2 },
  GovernanceActionTargetKind: { Registry: 1, Policy: 2 },
  VerifyFlags: {
    AllowDepegQuote: 1 << 0, AllowNativeException: 1 << 1,
    RequireTierA: 1 << 2, RequireCanonicalSnapshot: 1 << 3,
    RequireLiveFeedConfig: 1 << 4, RequireLiveRegistry: 1 << 5,
    RequireLiveSourcingPlan: 1 << 6, RequireLiveTwapState: 1 << 7,
  },
  MINT_ORACLE_MARKET_FLAGS: {
    SINGLE_SOURCE: 1 << 0, SINGLE_VENUE: 1 << 1, THIN_LIQUIDITY: 1 << 2,
    LOW_DEPTH: 1 << 3, WIDE_SPREAD: 1 << 4, HIGH_DISPERSION: 1 << 5,
    LOW_OBSERVATION_COUNT: 1 << 6, YOUNG_OR_UNKNOWN_LIQUIDITY: 1 << 7,
    SPOT_BUCKET_TWAP_DIVERGED: 1 << 8, SPOT_SHORT_TWAP_DIVERGED: 1 << 9,
    STALE_COMPONENT: 1 << 10, UNKNOWN_DEPTH: 1 << 11,
    UNKNOWN_LIQUIDITY_AGE: 1 << 12, ANCHOR_MISSING: 1 << 13,
    ANCHOR_DIVERGED: 1 << 14, SUPPORT_ONLY_SOURCE_PRESENT: 1 << 15,
    UNKNOWN_VENUE_COUNT: 1 << 16, LONG_TAIL: 1 << 17,
    BOOTSTRAP_LIQUIDITY: 1 << 18, DOMINANT_SOURCE: 1 << 19,
    FEE_LOSS_FLOOR_LOW: 1 << 20,
  },
} as const;

const STRING_LISTS = {
  MINT_ORACLE_PRODUCTION_PRIORITY_SOURCE_FAMILIES: [
    "raydium-clmm", "meteora-dlmm", "meteora-damm-v2", "orca-whirlpool",
  ],
  MINT_ORACLE_ADAPTER_SEPARATE_SOURCE_FAMILIES: ["raydium-cpmm", "pumpswap"],
  MINT_ORACLE_DEFAULT_DISCOVERY_SOURCE_FAMILIES: [
    "raydium-clmm", "meteora-dlmm", "meteora-damm-v2", "orca-whirlpool",
    "raydium-cpmm",
  ],
  MINT_ORACLE_SOURCE_FAMILY_ORDER: [
    "raydium-clmm", "meteora-dlmm", "meteora-damm-v2", "orca-whirlpool",
    "raydium-cpmm", "pumpswap",
  ],
} as const;

type AddressName = keyof typeof ADDRESSES;
type BytesName = keyof typeof BYTES;
type RecordName = keyof typeof RECORDS;
type StringListName = keyof typeof STRING_LISTS;

export function canonicalAddress(name: AddressName): string {
  return ADDRESSES[name];
}

export function freshPublicKey(
  name: AddressName,
  PublicKeyClass: PublicKeyConstructor,
): PublicKey {
  return new PublicKeyClass(ADDRESSES[name]);
}

export function freshBytes(name: BytesName): Buffer {
  return Buffer.from(BYTES[name], "hex");
}

export function freshNumberRecord<Name extends RecordName>(
  name: Name,
): { readonly [Key in keyof (typeof RECORDS)[Name]]: (typeof RECORDS)[Name][Key] } {
  return { ...RECORDS[name] };
}

export function freshStringList<Name extends StringListName>(
  name: Name,
): Array<(typeof STRING_LISTS)[Name][number]> {
  return [...STRING_LISTS[name]];
}

export function canonicalListIncludes<Name extends StringListName>(
  name: Name,
  value: string,
): boolean {
  return (STRING_LISTS[name] as readonly string[]).includes(value);
}

export function freshCanonicalDataAuthority() {
  const records = Object.fromEntries(
    Object.keys(RECORDS).map((name) => [
      name,
      freshNumberRecord(name as RecordName),
    ]),
  ) as { [Name in RecordName]: ReturnType<typeof freshNumberRecord<Name>> };
  const lists = Object.fromEntries(
    Object.keys(STRING_LISTS).map((name) => [
      name,
      freshStringList(name as StringListName),
    ]),
  ) as { [Name in StringListName]: Array<(typeof STRING_LISTS)[Name][number]> };
  return {
    ...Object.fromEntries(
      Object.keys(BYTES).map((name) => [name, freshBytes(name as BytesName)]),
    ) as { [Name in BytesName]: Buffer },
    RAYDIUM_CLMM_POOL_STATE_DISCRIMINATOR:
      freshBytes("RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR"),
    ...records,
    ...lists,
  };
}

export function freshCanonicalAuthority(PublicKeyClass: PublicKeyConstructor) {
  const MIMIR_MAINNET_PROGRAM_ID = freshPublicKey("MIMIR", PublicKeyClass);
  const SPL_NATIVE_MINT_ID = freshPublicKey("SPL_NATIVE_MINT", PublicKeyClass);
  const MIMIR_SOL_MINT = freshPublicKey("SPL_NATIVE_MINT", PublicKeyClass);
  const MIMIR_MAINNET_USDC_MINT = freshPublicKey("USDC", PublicKeyClass);
  const MIMIR_MAINNET_USDT_MINT = freshPublicKey("USDT", PublicKeyClass);
  const MIMIR_MAINNET_COLA_MINT = freshPublicKey("COLA", PublicKeyClass);
  const MIMIR_MAINNET_ADMITTED_POOL_QUOTE_MINTS = [
    MIMIR_SOL_MINT, MIMIR_MAINNET_USDC_MINT, MIMIR_MAINNET_USDT_MINT,
  ] as const;
  const MIMIR_MAINNET_CLASSIC_FEED_QUOTE_MINTS = [
    MIMIR_SOL_MINT, MIMIR_MAINNET_USDC_MINT,
  ] as const;
  const PUMPSWAP_PROGRAM_ID = freshPublicKey("PUMPSWAP", PublicKeyClass);
  const PUMP_FEE_PROGRAM_ID = freshPublicKey("PUMP_FEE", PublicKeyClass);
  const PUMPSWAP_GLOBAL_CONFIG = PublicKeyClass.findProgramAddressSync(
    [Buffer.from("global_config")], PUMPSWAP_PROGRAM_ID,
  )[0];
  const PUMPSWAP_FEE_CONFIG = PublicKeyClass.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMPSWAP_PROGRAM_ID.toBuffer()],
    PUMP_FEE_PROGRAM_ID,
  )[0];
  const data = freshCanonicalDataAuthority();

  return {
    MIMIR_MAINNET_PROGRAM_ID,
    MIMIR_PROGRAM_ID: MIMIR_MAINNET_PROGRAM_ID,
    SYSTEM_PROGRAM_ID: freshPublicKey("SYSTEM", PublicKeyClass),
    SYSVAR_INSTRUCTIONS_ID: freshPublicKey("SYSVAR_INSTRUCTIONS", PublicKeyClass),
    SYSVAR_CLOCK_ID: freshPublicKey("SYSVAR_CLOCK", PublicKeyClass),
    ZERO_PUBLIC_KEY: freshPublicKey("SYSTEM", PublicKeyClass),
    SPL_TOKEN_PROGRAM_ID: freshPublicKey("SPL_TOKEN", PublicKeyClass),
    SPL_NATIVE_MINT_ID,
    SPL_ASSOCIATED_TOKEN_PROGRAM_ID: freshPublicKey("SPL_ASSOCIATED_TOKEN", PublicKeyClass),
    SPL_TOKEN_2022_PROGRAM_ID: freshPublicKey("SPL_TOKEN_2022", PublicKeyClass),
    MIMIR_SOL_MINT,
    MIMIR_MAINNET_USDC_MINT,
    MIMIR_MAINNET_USDT_MINT,
    MIMIR_MAINNET_COLA_MINT,
    MIMIR_MAINNET_ADMITTED_POOL_QUOTE_MINTS,
    MIMIR_LOCALNET_ADMITTED_POOL_QUOTE_MINTS:
      MIMIR_MAINNET_ADMITTED_POOL_QUOTE_MINTS,
    MIMIR_MAINNET_CLASSIC_FEED_QUOTE_MINTS,
    MIMIR_LOCALNET_CLASSIC_FEED_QUOTE_MINTS:
      MIMIR_MAINNET_CLASSIC_FEED_QUOTE_MINTS,
    MIMIR_MAINNET_ADMITTED_QUOTE_MINTS:
      MIMIR_MAINNET_ADMITTED_POOL_QUOTE_MINTS,
    MIMIR_LOCALNET_ADMITTED_QUOTE_MINTS:
      MIMIR_MAINNET_ADMITTED_POOL_QUOTE_MINTS,
    MIMIR_STABLECOIN_AUTHORITY_BYPASS_MINTS: [
      MIMIR_MAINNET_USDC_MINT, MIMIR_MAINNET_USDT_MINT,
    ] as const,
    MIMIR_OPERATOR_CONTROLLED_AUTHORITY_MINTS: [MIMIR_MAINNET_COLA_MINT] as const,
    RAYDIUM_CPMM_MAINNET_PROGRAM_ID: freshPublicKey("RAYDIUM_CPMM", PublicKeyClass),
    RAYDIUM_CLMM_MAINNET_PROGRAM_ID: freshPublicKey("RAYDIUM_CLMM", PublicKeyClass),
    RAYDIUM_AMM_V4_PROGRAM_ID: freshPublicKey("RAYDIUM_AMM_V4", PublicKeyClass),
    ORCA_WHIRLPOOL_PROGRAM_ID: freshPublicKey("ORCA_WHIRLPOOL", PublicKeyClass),
    ORCA_WHIRLPOOLS_CONFIG_MAINNET: freshPublicKey("ORCA_WHIRLPOOLS_CONFIG", PublicKeyClass),
    METEORA_DLMM_PROGRAM_ID: freshPublicKey("METEORA_DLMM", PublicKeyClass),
    METEORA_DAMM_V2_PROGRAM_ID: freshPublicKey("METEORA_DAMM_V2", PublicKeyClass),
    PUMPSWAP_PROGRAM_ID,
    PUMP_PROGRAM_ID: freshPublicKey("PUMP", PublicKeyClass),
    PUMP_FEE_PROGRAM_ID,
    PUMPSWAP_FEE_PROGRAM_ID: PUMP_FEE_PROGRAM_ID,
    PUMPSWAP_GLOBAL_CONFIG,
    PUMPSWAP_FEE_CONFIG,
    MIMIR_COLLATERAL_PROGRAM_ID: freshPublicKey("MIMIR", PublicKeyClass),
    ...data,
  };
}
