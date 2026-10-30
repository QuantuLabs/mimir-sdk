import { PublicKey } from "@solana/web3.js";
export { SourceDirection } from "./sourceDirection.js";
import {
  canonicalAddress,
  freshCanonicalAuthority,
} from "./internal/canonicalAuthority.js";

const PUBLIC_AUTHORITY = freshCanonicalAuthority(PublicKey);
const PRIVATE_AUTHORITY = freshCanonicalAuthority(PublicKey);

export const MIMIR_MAINNET_PROGRAM_ADDRESS =
  canonicalAddress("MIMIR");
export const MIMIR_MAINNET_PROGRAM_ID = PUBLIC_AUTHORITY.MIMIR_MAINNET_PROGRAM_ID;
export const MIMIR_PROGRAM_ID = PUBLIC_AUTHORITY.MIMIR_PROGRAM_ID;

export const SPL_TOKEN_PROGRAM_ID = PUBLIC_AUTHORITY.SPL_TOKEN_PROGRAM_ID;
export const SPL_NATIVE_MINT_ID = PUBLIC_AUTHORITY.SPL_NATIVE_MINT_ID;
export const SPL_ASSOCIATED_TOKEN_PROGRAM_ID =
  PUBLIC_AUTHORITY.SPL_ASSOCIATED_TOKEN_PROGRAM_ID;
export const SPL_TOKEN_2022_PROGRAM_ID =
  PUBLIC_AUTHORITY.SPL_TOKEN_2022_PROGRAM_ID;
export const MIMIR_SOL_MINT = PUBLIC_AUTHORITY.MIMIR_SOL_MINT;
export const MIMIR_MAINNET_USDC_MINT =
  PUBLIC_AUTHORITY.MIMIR_MAINNET_USDC_MINT;
export const MIMIR_MAINNET_USDT_MINT =
  PUBLIC_AUTHORITY.MIMIR_MAINNET_USDT_MINT;
export const MIMIR_MAINNET_COLA_MINT =
  PUBLIC_AUTHORITY.MIMIR_MAINNET_COLA_MINT;
export const MIMIR_MAINNET_ADMITTED_POOL_QUOTE_MINTS =
  PUBLIC_AUTHORITY.MIMIR_MAINNET_ADMITTED_POOL_QUOTE_MINTS;
export const MIMIR_LOCALNET_ADMITTED_POOL_QUOTE_MINTS =
  PUBLIC_AUTHORITY.MIMIR_LOCALNET_ADMITTED_POOL_QUOTE_MINTS;
export const MIMIR_MAINNET_CLASSIC_FEED_QUOTE_MINTS =
  PUBLIC_AUTHORITY.MIMIR_MAINNET_CLASSIC_FEED_QUOTE_MINTS;
export const MIMIR_LOCALNET_CLASSIC_FEED_QUOTE_MINTS =
  PUBLIC_AUTHORITY.MIMIR_LOCALNET_CLASSIC_FEED_QUOTE_MINTS;
export const MIMIR_MAINNET_ADMITTED_QUOTE_MINTS =
  PUBLIC_AUTHORITY.MIMIR_MAINNET_ADMITTED_QUOTE_MINTS;
export const MIMIR_LOCALNET_ADMITTED_QUOTE_MINTS =
  PUBLIC_AUTHORITY.MIMIR_LOCALNET_ADMITTED_QUOTE_MINTS;
export const MIMIR_STABLECOIN_AUTHORITY_BYPASS_MINTS =
  PUBLIC_AUTHORITY.MIMIR_STABLECOIN_AUTHORITY_BYPASS_MINTS;
export const MIMIR_OPERATOR_CONTROLLED_AUTHORITY_MINTS =
  PUBLIC_AUTHORITY.MIMIR_OPERATOR_CONTROLLED_AUTHORITY_MINTS;
export type MimirCluster = "mainnet" | "localnet" | "devnet";
export type MimirProgramProfileName = "mainnet" | "custom";
export interface MimirProgramProfile {
  cluster: MimirCluster;
  name: MimirProgramProfileName;
  programId: PublicKey;
}
export interface ResolveMimirProgramProfileArgs {
  cluster?: MimirCluster;
  programId?: PublicKey | string | null;
}
export type MimirMintAuthorityPolicy =
  | "operator-controlled-strict"
  | "stablecoin-allowlist-bypass"
  | "unclassified";

function toPublicKey(value: PublicKey | string): PublicKey {
  return value instanceof PublicKey
    ? new PublicKey(value.toBytes())
    : new PublicKey(value);
}

export function resolveMimirProgramProfile(
  args: ResolveMimirProgramProfileArgs = {},
): MimirProgramProfile {
  const cluster = args.cluster ?? "mainnet";
  if (cluster !== "mainnet" && cluster !== "localnet" && cluster !== "devnet") {
    throw new Error("InvalidMimirCluster");
  }
  if (args.programId) {
    const programId = toPublicKey(args.programId);
    const name = programId.equals(PRIVATE_AUTHORITY.MIMIR_MAINNET_PROGRAM_ID)
      ? "mainnet"
      : "custom";
    return { cluster, name, programId };
  }
  return {
    cluster,
    name: "mainnet",
    programId: new PublicKey(PRIVATE_AUTHORITY.MIMIR_MAINNET_PROGRAM_ID.toBytes()),
  };
}

const MIMIR_DEVNET_CLASSIC_FEED_QUOTE_MINTS: readonly PublicKey[] = Object.freeze([
  new PublicKey("DRStb6fqmiX4zssMU1mEJEXRpoKcDDtsXuENAKeJ1wTQ"),
  new PublicKey("5W1Mg5LYmczXTGAqjSoTeMi7tXUQx3bfXsLr1MKvV1Tk"),
]);
const MIMIR_DEVNET_ADMITTED_QUOTE_MINTS: readonly PublicKey[] = Object.freeze([
  new PublicKey("So11111111111111111111111111111111111111112"),
  ...MIMIR_DEVNET_CLASSIC_FEED_QUOTE_MINTS,
]);
const MIMIR_DEVNET_COLA_MINT = new PublicKey("ADb8dPPZK2LU3BVyuEfwGbQ1FujEAtRDxdhaTreLV9ij");

function admittedQuoteMintsForCluster(
  cluster: MimirCluster,
): readonly PublicKey[] {
  switch (cluster) {
    case "mainnet":
    case "localnet":
      return PRIVATE_AUTHORITY.MIMIR_MAINNET_ADMITTED_QUOTE_MINTS;
    case "devnet":
      return MIMIR_DEVNET_ADMITTED_QUOTE_MINTS;
    default:
      throw new Error("InvalidMimirCluster");
  }
}

function classicFeedQuoteMintsForCluster(
  cluster: MimirCluster,
): readonly PublicKey[] {
  switch (cluster) {
    case "mainnet":
    case "localnet":
      return PRIVATE_AUTHORITY.MIMIR_MAINNET_CLASSIC_FEED_QUOTE_MINTS;
    case "devnet":
      return MIMIR_DEVNET_CLASSIC_FEED_QUOTE_MINTS;
    default:
      throw new Error("InvalidMimirCluster");
  }
}

export function isMimirAdmittedQuoteMint(
  mint: PublicKey,
  cluster: MimirCluster,
): boolean {
  if (mint.equals(PRIVATE_AUTHORITY.ZERO_PUBLIC_KEY)) return false;
  const admitted = admittedQuoteMintsForCluster(cluster);
  return admitted.some((candidate) => mint.equals(candidate));
}

export function isMimirAdmittedPoolQuoteMint(
  mint: PublicKey,
  cluster: MimirCluster,
): boolean {
  return isMimirAdmittedQuoteMint(mint, cluster);
}

export function isMimirClassicFeedQuoteMint(
  mint: PublicKey,
  cluster: MimirCluster,
): boolean {
  if (mint.equals(PRIVATE_AUTHORITY.ZERO_PUBLIC_KEY)) return false;
  const admitted = classicFeedQuoteMintsForCluster(cluster);
  return admitted.some((candidate) => mint.equals(candidate));
}

export function isMimirAdmittedFeedCreationCollateralMint(
  mint: PublicKey,
  cluster: MimirCluster,
): boolean {
  if (mint.equals(PRIVATE_AUTHORITY.ZERO_PUBLIC_KEY)) return false;
  switch (cluster) {
    case "mainnet":
    case "localnet":
      return mint.equals(PRIVATE_AUTHORITY.MIMIR_MAINNET_COLA_MINT);
    case "devnet":
      return mint.equals(MIMIR_DEVNET_COLA_MINT);
    default:
      throw new Error("InvalidMimirCluster");
  }
}

export function isMimirStablecoinAuthorityBypassMint(
  mint: PublicKey,
): boolean {
  return PRIVATE_AUTHORITY.MIMIR_STABLECOIN_AUTHORITY_BYPASS_MINTS.some((candidate) =>
    mint.equals(candidate),
  );
}

export function isMimirOperatorControlledAuthorityMint(
  mint: PublicKey,
): boolean {
  return PRIVATE_AUTHORITY.MIMIR_OPERATOR_CONTROLLED_AUTHORITY_MINTS.some((candidate) =>
    mint.equals(candidate),
  );
}

export function classifyMimirMintAuthorityPolicy(
  mint: PublicKey,
): MimirMintAuthorityPolicy {
  if (isMimirOperatorControlledAuthorityMint(mint)) {
    return "operator-controlled-strict";
  }
  if (isMimirStablecoinAuthorityBypassMint(mint)) {
    return "stablecoin-allowlist-bypass";
  }
  return "unclassified";
}
export const RAYDIUM_CPMM_MAINNET_PROGRAM_ID =
  PUBLIC_AUTHORITY.RAYDIUM_CPMM_MAINNET_PROGRAM_ID;
export const RAYDIUM_CPMM_MAINNET_PROGRAM_DATA_ID =
  new PublicKey("DMawCQzbgNTmbzaESc7o6pvL1KAeetY8zA7jNpzntHhU");
export const RAYDIUM_CPMM_POOL_STATE_MAINNET_LEN = 637;
export const RAYDIUM_CPMM_POOL_STATE_LEN = 637;
export const RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR =
  PUBLIC_AUTHORITY.RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR;
export const RAYDIUM_CPMM_STATUS_SWAP_DISABLED_MASK = 4;
export const RAYDIUM_CPMM_POOL_OFFSET_AMM_CONFIG = 8;
export const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT = 72;
export const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_VAULT = 104;
export const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT = 168;
export const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_MINT = 200;
export const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_PROGRAM = 232;
export const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_PROGRAM = 264;
export const RAYDIUM_CPMM_POOL_OFFSET_STATUS = 329;
export const RAYDIUM_CPMM_POOL_OFFSET_MINT_0_DECIMALS = 331;
export const RAYDIUM_CPMM_POOL_OFFSET_MINT_1_DECIMALS = 332;
export const RAYDIUM_CPMM_POOL_OFFSET_PROTOCOL_FEES_TOKEN_0 = 341;
export const RAYDIUM_CPMM_POOL_OFFSET_PROTOCOL_FEES_TOKEN_1 = 349;
export const RAYDIUM_CPMM_POOL_OFFSET_FUND_FEES_TOKEN_0 = 357;
export const RAYDIUM_CPMM_POOL_OFFSET_FUND_FEES_TOKEN_1 = 365;
export const RAYDIUM_CPMM_POOL_OFFSET_OPEN_TIME = 373;
export const RAYDIUM_CPMM_POOL_OFFSET_CREATOR_FEES_TOKEN_0 = 397;
export const RAYDIUM_CPMM_POOL_OFFSET_CREATOR_FEES_TOKEN_1 = 405;
export const RAYDIUM_CPMM_OBSERVATION_SEED =
  PUBLIC_AUTHORITY.RAYDIUM_CPMM_OBSERVATION_SEED;
export const RAYDIUM_CPMM_NATIVE_TWAP_MIN_WINDOW_SECS = 120;
export const RAYDIUM_CPMM_NATIVE_TWAP_MAX_LAST_UPDATE_AGE_SECS = 60;
export const RAYDIUM_CPMM_NATIVE_TWAP_MAX_EXECUTABLE_VS_NATIVE_BPS = 50;
export const RAYDIUM_CPMM_NATIVE_TWAP_SLOT_EQUIVALENT_MILLIS = 400;
export const RAYDIUM_CPMM_POOL_OBSERVATION_KEY_OFFSET = 296;
export const RAYDIUM_CPMM_MAINNET_POOL_OBSERVATION_KEY_OFFSET =
  RAYDIUM_CPMM_POOL_OBSERVATION_KEY_OFFSET;
export const RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR =
  PUBLIC_AUTHORITY.RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR;
export const RAYDIUM_CPMM_OBSERVATION_STATE_LEN = 4075;
export const RAYDIUM_CPMM_OBSERVATION_STATE_INITIALIZED_OFFSET = 8;
export const RAYDIUM_CPMM_OBSERVATION_STATE_INDEX_OFFSET = 9;
export const RAYDIUM_CPMM_OBSERVATION_STATE_POOL_ID_OFFSET = 11;
export const RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATIONS_OFFSET = 43;
export const RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT = 100;
export const RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_LEN = 40;
export const RAYDIUM_CPMM_OBSERVATION_STATE_LAST_UPDATE_TIMESTAMP_OFFSET =
  RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATIONS_OFFSET +
  RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT *
    RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_LEN;
export const RAYDIUM_CPMM_OBSERVATION_TIMESTAMP_OFFSET = 0;
export const RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN0_PRICE_X32_OFFSET = 8;
export const RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN1_PRICE_X32_OFFSET = 24;
export const RAYDIUM_CLMM_MAINNET_PROGRAM_ID =
  PUBLIC_AUTHORITY.RAYDIUM_CLMM_MAINNET_PROGRAM_ID;
export const RAYDIUM_CLMM_POOL_STATE_LEN = 1544;
export const RAYDIUM_CLMM_POOL_STATE_DISCRIMINATOR =
  RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR;
export const RAYDIUM_CLMM_POOL_OFFSET_AMM_CONFIG = 9;
export const ORCA_WHIRLPOOL_PROGRAM_ID =
  PUBLIC_AUTHORITY.ORCA_WHIRLPOOL_PROGRAM_ID;
export const METEORA_DLMM_PROGRAM_ID = PUBLIC_AUTHORITY.METEORA_DLMM_PROGRAM_ID;
export const METEORA_DAMM_V2_PROGRAM_ID =
  PUBLIC_AUTHORITY.METEORA_DAMM_V2_PROGRAM_ID;
export const RAYDIUM_AMM_V4_PROGRAM_ID =
  PUBLIC_AUTHORITY.RAYDIUM_AMM_V4_PROGRAM_ID;
export const PUMPSWAP_PROGRAM_ID = PUBLIC_AUTHORITY.PUMPSWAP_PROGRAM_ID;
export const PUMP_PROGRAM_ID = PUBLIC_AUTHORITY.PUMP_PROGRAM_ID;
export const PUMP_FEE_PROGRAM_ID = PUBLIC_AUTHORITY.PUMP_FEE_PROGRAM_ID;
export const PUMPSWAP_FEE_PROGRAM_ID = PUBLIC_AUTHORITY.PUMPSWAP_FEE_PROGRAM_ID;
export const PUMPSWAP_GLOBAL_CONFIG = PUBLIC_AUTHORITY.PUMPSWAP_GLOBAL_CONFIG;
export const PUMPSWAP_FEE_CONFIG = PUBLIC_AUTHORITY.PUMPSWAP_FEE_CONFIG;
export const ORCA_WHIRLPOOLS_CONFIG_MAINNET =
  PUBLIC_AUTHORITY.ORCA_WHIRLPOOLS_CONFIG_MAINNET;

export const FEED_SNAPSHOT_MAGIC = PUBLIC_AUTHORITY.FEED_SNAPSHOT_MAGIC;
export const FEED_CONFIG_MAGIC = PUBLIC_AUTHORITY.FEED_CONFIG_MAGIC;
export const FEED_RESERVATION_MAGIC = PUBLIC_AUTHORITY.FEED_RESERVATION_MAGIC;
export const ORACLE_REGISTRY_MAGIC = PUBLIC_AUTHORITY.ORACLE_REGISTRY_MAGIC;
export const SOURCING_PLAN_MAGIC = PUBLIC_AUTHORITY.SOURCING_PLAN_MAGIC;
export const SOURCE_CONFIG_MAGIC = PUBLIC_AUTHORITY.SOURCE_CONFIG_MAGIC;
export const FEED_TWAP_MAGIC = PUBLIC_AUTHORITY.FEED_TWAP_MAGIC;
export const SOURCE_RING_MAGIC = PUBLIC_AUTHORITY.SOURCE_RING_MAGIC;
export const NATIVE_TWAP_PROOF_MAGIC = PUBLIC_AUTHORITY.NATIVE_TWAP_PROOF_MAGIC;
export const GOVERNANCE_POLICY_MAGIC = PUBLIC_AUTHORITY.GOVERNANCE_POLICY_MAGIC;
export const GOVERNANCE_ACTION_MAGIC = PUBLIC_AUTHORITY.GOVERNANCE_ACTION_MAGIC;
export const ADMIN_CONFIG_MAGIC = PUBLIC_AUTHORITY.ADMIN_CONFIG_MAGIC;
export const FEED_COLLATERAL_LOCK_MAGIC =
  PUBLIC_AUTHORITY.FEED_COLLATERAL_LOCK_MAGIC;
export const FEED_FEE_VAULT_MAGIC = PUBLIC_AUTHORITY.FEED_FEE_VAULT_MAGIC;
export const COMPOSITE_FEED_CONFIG_MAGIC =
  PUBLIC_AUTHORITY.COMPOSITE_FEED_CONFIG_MAGIC;
export const COMPOSITE_SNAPSHOT_MAGIC = PUBLIC_AUTHORITY.COMPOSITE_SNAPSHOT_MAGIC;
export const VERSION_V0 = 0;
export const VERSION_V1 = 1;
export const FEED_SNAPSHOT_MIN_HEADER_LEN = 512;
export const FEED_CONFIG_HEADER_LEN = 325;
export const FEED_CONFIG_V1_HEADER_LEN = 357;
export const FEED_CONFIG_IDENTITY_ASSET_OFFSET = 325;
export const FEED_RESERVATION_HEADER_LEN = 176;
export const ORACLE_REGISTRY_HEADER_LEN = 128;
export const SOURCING_PLAN_HEADER_LEN = 320;
export const SOURCE_CONFIG_HEADER_LEN = 384;
export const MAX_SOURCE_INDEX = 63;
export const MAX_TWAP_AGGREGATION_SOURCES = 5;
export const UNKNOWN_CORRELATED_DOMAIN = 0xffff;
export const CAP_MODEL_VERSION_V2 = 2;
export const CAP_MODEL_ECON_LOSS_BAND_BPS = 50;
export const CAP_MODEL_ATTACKER_WEIGHT_THRESHOLD_BPS = 5_000;
export const CAP_MODEL_MAX_SOURCES = 5;
export const CAP_MODEL_SOURCE_ENTRY_LEN = 48;
export const CAP_MODEL_HASH_V2 = PUBLIC_AUTHORITY.CAP_MODEL_HASH_V2;
export const FEE_SOURCE_UNKNOWN = 0;
export const FEE_SOURCE_AMM_CONFIG = 1;
export const FEE_SOURCE_POOL_INLINE = 2;
export const FEE_SOURCE_DLMM_PAIR = 3;
export const FEED_TWAP_HEADER_LEN = 640;
export const SOURCE_RING_HEADER_LEN = 384;
export const SOURCE_RING_V1_HEADER_LEN = 544;
export const SOURCE_TEMPORAL_MAGIC = Uint8Array.of(0x4d, 0x54, 0x50, 0x31);
export const SOURCE_TEMPORAL_ABI_VERSION = 1;
export const SOURCE_TEMPORAL_MODULE_V1_LEN = 256;
export const SOURCE_TEMPORAL_POLICY_VERSION = 1;
export { CPMM_QUIET_TEMPORAL_MODULE_V2 } from "./internal/nativeMonoRefreshCore.js";
export const NATIVE_TWAP_PROOF_HEADER_LEN = 384;
export const GOVERNANCE_POLICY_HEADER_LEN = 224;
export const GOVERNANCE_ACTION_HEADER_LEN = 192;
export const ADMIN_CONFIG_HEADER_LEN = 192;
export const FEED_COLLATERAL_LOCK_HEADER_LEN = 160;
export const FEED_FEE_VAULT_HEADER_LEN = 160;
export const COMPOSITE_FEED_CONFIG_HEADER_LEN = 629;
export const COMPOSITE_FEED_CONFIG_V1_HEADER_LEN = 661;
export const COMPOSITE_COMPONENT_CONFIG_LEN = 80;
export const COMPOSITE_SNAPSHOT_HEADER_LEN = 720;
export const COMPOSITE_SNAPSHOT_COMPONENT_LEN = 80;
export const MAX_COMPOSITE_COMPONENTS = 5;
export const MIN_COMPOSITE_COMPONENTS = 1;

export const FEED_REFRESH_FEE_BPS_DENOMINATOR = 10_000n;

export const OFFSETS = PUBLIC_AUTHORITY.OFFSETS;

export const SnapshotStatus = PUBLIC_AUTHORITY.SnapshotStatus;

export const RouteabilityStatus = PUBLIC_AUTHORITY.RouteabilityStatus;

export const RiskTier = PUBLIC_AUTHORITY.RiskTier;

export const SnapshotSource = PUBLIC_AUTHORITY.SnapshotSource;

export const FreshnessProfile = PUBLIC_AUTHORITY.FreshnessProfile;

export const PlanProfile = PUBLIC_AUTHORITY.PlanProfile;

export const QuoteStatus = PUBLIC_AUTHORITY.QuoteStatus;

export const AnchorProvider = PUBLIC_AUTHORITY.AnchorProvider;

export const AnchorStatus = PUBLIC_AUTHORITY.AnchorStatus;

export const FeedLifecycleState = PUBLIC_AUTHORITY.FeedLifecycleState;

export const CompositeFeedStatus = {
  Active: 1,
} as const;

export const CompositeFormulaKind = {
  UsdBasketSum: 1,
} as const;

export const CompositeProfile = {
  CompositeBasket: 1,
} as const;

export const RegistryStatus = PUBLIC_AUTHORITY.RegistryStatus;

export const PlanStatus = PUBLIC_AUTHORITY.PlanStatus;

export const SourceAdapterType = PUBLIC_AUTHORITY.SourceAdapterType;
export const SOURCE_ADAPTER_MAX = SourceAdapterType.MeteoraDammV2;
export const KNOWN_SOURCE_ADAPTER_TYPES = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7] as const);
export const SUPPORTED_SOURCE_ADAPTER_TYPES_V0 = Object.freeze([0, 1, 2, 3, 4, 6, 7] as const);
export function isKnownSourceAdapterType(value: number): boolean {
  return KNOWN_SOURCE_ADAPTER_TYPES.includes(value as (typeof KNOWN_SOURCE_ADAPTER_TYPES)[number]);
}
export function isSupportedSourceAdapterTypeV0(value: number): boolean {
  return SUPPORTED_SOURCE_ADAPTER_TYPES_V0.includes(
    value as (typeof SUPPORTED_SOURCE_ADAPTER_TYPES_V0)[number],
  );
}

export { sourceAdapterSupportsVersion } from "./sourceAdapterVersion.js";

export const REGISTRY_ADAPTER_VERSION_MASK_COUNT = 8;
export const REGISTRY_ADAPTER_VERSION_MASK_BYTES = 2;
export const MAX_SUPPORTED_SOURCE_ADAPTER_VERSION = VERSION_V1;
export const EXECUTABLE_SOURCE_ADAPTER_MASK_V0 =
  (1n << BigInt(SourceAdapterType.OrcaWhirlpool)) |
  (1n << BigInt(SourceAdapterType.RaydiumClmm)) |
  (1n << BigInt(SourceAdapterType.MeteoraDlmm)) |
  (1n << BigInt(SourceAdapterType.RaydiumCpmm)) |
  (1n << BigInt(SourceAdapterType.RaydiumAmmV4)) |
  (1n << BigInt(SourceAdapterType.PumpSwap)) |
  (1n << BigInt(SourceAdapterType.MeteoraDammV2));

export const SourceStatus = PUBLIC_AUTHORITY.SourceStatus;

export const TwapStatus = PUBLIC_AUTHORITY.TwapStatus;

export const ObservationKind = PUBLIC_AUTHORITY.ObservationKind;

export const MIMIR_ORACLE_FLAG_SINGLE_SOURCE_NATIVE_TWAP = 1 << 2;
export const MIMIR_NATIVE_TWAP_PROOF_KIND_RAYDIUM_CPMM_OBSERVATION_STATE = 1;

export const CONFIG_OFFSETS = PUBLIC_AUTHORITY.CONFIG_OFFSETS;

export const REGISTRY_OFFSETS = PUBLIC_AUTHORITY.REGISTRY_OFFSETS;

export const RESERVATION_OFFSETS = PUBLIC_AUTHORITY.RESERVATION_OFFSETS;

export const FeedReservationStatus = PUBLIC_AUTHORITY.FeedReservationStatus;

export const PLAN_OFFSETS = PUBLIC_AUTHORITY.PLAN_OFFSETS;

export const PLAN_HASH_SCHEME_MERKLE_V1 = 1;
export const PLAN_CANONICAL_RING_VERSION_MERKLE_V1 = 1;
export const PLAN_ACCOUNTS_BINDING_STATIC_V1 = 1;
export const PLAN_MEMBERSHIP_LEAF_COUNT_V1 = 8;

export const SOURCE_OFFSETS = PUBLIC_AUTHORITY.SOURCE_OFFSETS;

export const TWAP_OFFSETS = PUBLIC_AUTHORITY.TWAP_OFFSETS;

export const NATIVE_TWAP_PROOF_OFFSETS = {
  magic: 0,
  version: 8,
  headerLen: 10,
  flags: 12,
  proofKind: 14,
  status: 15,
  feedId: 16,
  twapVersion: 48,
  sourceIndex: 50,
  adapterType: 51,
  proofBump: 52,
  proofRevision: 56,
  twapRevision: 64,
  sourceConfigRevision: 72,
  sourceSetRevision: 80,
  shortEndSlot: 88,
  mediumEndSlot: 96,
  longEndSlot: 104,
  nativeWindowSecs: 112,
  oldTimestamp: 120,
  newTimestamp: 128,
  lastUpdateTimestamp: 136,
  nativeTwapX64: 144,
  cumulativeOldX32: 160,
  cumulativeNewX32: 176,
  currentDepthTo50BpsNative: 192,
  currentLiquidityNative: 208,
  selectedPlanHash: 224,
  sourceConfig: 256,
  poolState: 288,
  observationState: 320,
  proofHash: 352,
} as const;

export const RING_OFFSETS = PUBLIC_AUTHORITY.RING_OFFSETS;

export const SOURCE_CAP_ENTRY_OFFSETS = PUBLIC_AUTHORITY.SOURCE_CAP_ENTRY_OFFSETS;

export const GOVERNANCE_POLICY_OFFSETS =
  PUBLIC_AUTHORITY.GOVERNANCE_POLICY_OFFSETS;

export const GOVERNANCE_ACTION_OFFSETS =
  PUBLIC_AUTHORITY.GOVERNANCE_ACTION_OFFSETS;

export const ADMIN_CONFIG_OFFSETS = PUBLIC_AUTHORITY.ADMIN_CONFIG_OFFSETS;

export const FEED_COLLATERAL_LOCK_OFFSETS =
  PUBLIC_AUTHORITY.FEED_COLLATERAL_LOCK_OFFSETS;

export const FEED_FEE_VAULT_OFFSETS = PUBLIC_AUTHORITY.FEED_FEE_VAULT_OFFSETS;

export const COMPOSITE_CONFIG_OFFSETS = PUBLIC_AUTHORITY.COMPOSITE_CONFIG_OFFSETS;

export const COMPOSITE_COMPONENT_OFFSETS =
  PUBLIC_AUTHORITY.COMPOSITE_COMPONENT_OFFSETS;

export const COMPOSITE_SNAPSHOT_OFFSETS =
  PUBLIC_AUTHORITY.COMPOSITE_SNAPSHOT_OFFSETS;

export const COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS =
  PUBLIC_AUTHORITY.COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS;

export const FeedCollateralLockStatus = PUBLIC_AUTHORITY.FeedCollateralLockStatus;

export const FeedFeeVaultStatus = PUBLIC_AUTHORITY.FeedFeeVaultStatus;

export const AdminConfigStatus = PUBLIC_AUTHORITY.AdminConfigStatus;

export const GovernancePolicyStatus = PUBLIC_AUTHORITY.GovernancePolicyStatus;

export const GovernanceActionStatus = PUBLIC_AUTHORITY.GovernanceActionStatus;

export const GovernanceActionTargetKind =
  PUBLIC_AUTHORITY.GovernanceActionTargetKind;

export const VerifyFlags = PUBLIC_AUTHORITY.VerifyFlags;

export const VERIFY_SNAPSHOT_TAG = 0;
export const VERIFY_SNAPSHOT_MODE_MINIMUM = 1;
export const RECLAIM_FEED_RESERVATION_TAG = 14;
export const UPSERT_REGISTRY_TAG = 19;
export const REFRESH_SOURCE_RING_FROM_CPMM_TAG = 23;
export const UPSERT_GOVERNANCE_POLICY_TAG = 32;
export const CREATE_GOVERNANCE_ACTION_TAG = 33;
export const APPROVE_GOVERNANCE_ACTION_TAG = 34;
export const UPSERT_ADMIN_CONFIG_V1_TAG = 62;
export const CLAIM_REFRESH_FEES_V1_TAG = 63;
export const WITHDRAW_PROTOCOL_TREASURY_V1_TAG = 84;
export const WITHDRAW_PROTOCOL_TREASURY_V1_LEN = 8;
export const PROTOCOL_TREASURY_SEED = "protocol_treasury";
export { MIMIR_FUSED_COMPOSITE_TAG, MIMIR_INIT_FUSED_COMPOSITE_TAG } from "./beta/compositeExecution.js";
export const CLOSE_STALE_PROOF_OR_BUCKET_V1_TAG = 74;
export const CLOSE_STALE_PROOF_OR_BUCKET_V1_LEN = 0;
export const APPROVE_GOVERNANCE_ACTION_LEN = 32 + 8;
export const RECLAIM_FEED_RESERVATION_LEN = 32;
export const UPSERT_ADMIN_CONFIG_V1_LEN = ADMIN_CONFIG_HEADER_LEN;
export const ADMIN_MAX_COMPOSITE_REFRESH_FEE_LAMPORTS = 1_000_000n;
export const ADMIN_MAX_COMPOSITE_ACTIVATION_FEE_LAMPORTS = 100_000_000n;
export const CLAIM_REFRESH_FEES_V1_LEN = 32 + 8 + 8;
export const REFRESH_TWAP_POLICY_LEN = 32 + 2 + 2 + 1 + 8 + 8;
export const REFRESH_SOURCE_RING_FROM_CPMM_LEN = 32 + 1 + 2 + 2 + 8 + 8 + 8 + 32;
export const SOURCE_MEMBERSHIP_PROOF_DEPTH_V1 = 3;
export const REFRESH_SOURCE_RING_V1_LEN =
  REFRESH_SOURCE_RING_FROM_CPMM_LEN + 32 * SOURCE_MEMBERSHIP_PROOF_DEPTH_V1 * 2;
export const REFRESH_SOURCE_RING_FROM_ORCA_WHIRLPOOL_LEN =
  REFRESH_SOURCE_RING_FROM_CPMM_LEN;
export const REFRESH_SOURCE_RING_FROM_METEORA_DLMM_LEN =
  REFRESH_SOURCE_RING_FROM_CPMM_LEN;
export const REFRESH_SOURCE_RING_FROM_RAYDIUM_CLMM_LEN =
  REFRESH_SOURCE_RING_FROM_CPMM_LEN;
export const REFRESH_CPMM_SOURCE_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_CPMM_LEN + REFRESH_TWAP_POLICY_LEN;
export const REFRESH_ORCA_WHIRLPOOL_SOURCE_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_ORCA_WHIRLPOOL_LEN + REFRESH_TWAP_POLICY_LEN;
export const REFRESH_METEORA_DLMM_SOURCE_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_METEORA_DLMM_LEN + REFRESH_TWAP_POLICY_LEN;
export const REFRESH_RAYDIUM_CLMM_SOURCE_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_RAYDIUM_CLMM_LEN + REFRESH_TWAP_POLICY_LEN;
export const REFRESH_ORCA_RAYDIUM_CLMM_SOURCES_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_ORCA_WHIRLPOOL_LEN +
  REFRESH_SOURCE_RING_FROM_RAYDIUM_CLMM_LEN +
  REFRESH_TWAP_POLICY_LEN;
export const REFRESH_METEORA_RAYDIUM_CLMM_SOURCES_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_METEORA_DLMM_LEN +
  REFRESH_SOURCE_RING_FROM_RAYDIUM_CLMM_LEN +
  REFRESH_TWAP_POLICY_LEN;
export const REFRESH_ORCA_METEORA_DLMM_SOURCES_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_ORCA_WHIRLPOOL_LEN +
  REFRESH_SOURCE_RING_FROM_METEORA_DLMM_LEN +
  REFRESH_TWAP_POLICY_LEN;
export const REFRESH_ORCA_METEORA_RAYDIUM_CLMM_SOURCES_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_ORCA_WHIRLPOOL_LEN +
  REFRESH_SOURCE_RING_FROM_METEORA_DLMM_LEN +
  REFRESH_SOURCE_RING_FROM_RAYDIUM_CLMM_LEN +
  REFRESH_TWAP_POLICY_LEN;
export const REFRESH_TWO_CPMM_SOURCES_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_TWAP_POLICY_LEN;
export const REFRESH_THREE_CPMM_SOURCES_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_TWAP_POLICY_LEN;
export const REFRESH_FOUR_CPMM_SOURCES_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_TWAP_POLICY_LEN;
export const REFRESH_FIVE_CPMM_SOURCES_AND_FEED_TWAP_LEN =
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_SOURCE_RING_FROM_CPMM_LEN +
  REFRESH_TWAP_POLICY_LEN;
export const REFRESH_FEED_TWAP_FROM_RINGS_AND_SNAPSHOT_LEN =
  REFRESH_TWAP_POLICY_LEN + 2 + 8 + 8 + 1;

export const DAMM_RESERVE_TEMPORAL_MAGIC_V3 = Uint8Array.of(0x4d, 0x54, 0x50, 0x33);
export const DAMM_RESERVE_TEMPORAL_ABI_VERSION_V3 = 3;
export const DAMM_RESERVE_TEMPORAL_MODULE_V3_LEN = 320;
