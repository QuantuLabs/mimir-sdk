import { createHash } from "./internal/sha256.js";
import { getMultipleAccountsInfoChunked } from "./chunkedAccounts.js";
import { address } from "@solana/kit";
import { mimirBetaClusterTable, mimirBetaVenueProgram } from "./beta/cluster.js";
import {
  PublicKey,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import {
  isMimirAdmittedPoolQuoteMint,
  isMimirClassicFeedQuoteMint,
  UNKNOWN_CORRELATED_DOMAIN,
  VERSION_V0,
  MAX_SOURCE_INDEX,
} from "./constants.js";
import {
  canonicalListIncludes,
  freshCanonicalAuthority,
  freshPublicKey,
  freshStringList,
} from "./internal/canonicalAuthority.js";
import {
  conservativeMintOracleSourceConfigFloor,
  cpmmZeroFeeImmediateUnwindBounds,
  Q64,
  squareQ64ToX64,
} from "./math.js";
import {
  findAdminConfigPda,
  findFeedCollateralLockPda,
  findFeedConfigPda,
  findFeedReservationPda,
  findFeedSnapshotPda,
  findFeedTwapPda,
  findSourceConfigPda,
  findSourceRingPda,
  findSourcingPlanPda,
} from "./pda.js";
import type {
  CompactSourceConfigArgs,
} from "./types.js";
import { legacyWeb3PoolAccountToCore } from "./internal/legacyWeb3PoolDiscoveryAdapter.js";
import { validatePoolCoreAccountEnvelope } from "./internal/rpcPoolDiscoveryCore.js";
import {
  classifyToken2022ClmmPair,
  isToken2022ClmmAccountError,
  isToken2022ClmmPolicyError,
  type Token2022ClmmAccount,
} from "./token2022Clmm.js";
import { MIMIR_COND } from "./liveness.js";

const PUBLIC_AUTHORITY = freshCanonicalAuthority(PublicKey);
const PRIVATE_AUTHORITY = freshCanonicalAuthority(PublicKey);
const {
  MIMIR_SOL_MINT,
  METEORA_DLMM_PROGRAM_ID,
  METEORA_DAMM_V2_PROGRAM_ID,
  ORCA_WHIRLPOOL_PROGRAM_ID: CANONICAL_ORCA_WHIRLPOOL_PROGRAM_ID,
  PUMPSWAP_PROGRAM_ID,
  RAYDIUM_CLMM_MAINNET_PROGRAM_ID,
  RAYDIUM_CPMM_MAINNET_PROGRAM_ID,
  RiskTier,
  SourceAdapterType,
  SourceDirection,
  SPL_TOKEN_PROGRAM_ID: CANONICAL_SPL_TOKEN_PROGRAM_ID,
  SPL_TOKEN_2022_PROGRAM_ID,
  ZERO_PUBLIC_KEY,
} = PRIVATE_AUTHORITY;

export type PublicKeyInput = PublicKey | string | Uint8Array;

export type MintOracleSourceFamily =
  | "orca-whirlpool"
  | "meteora-dlmm"
  | "meteora-damm-v2"
  | "raydium-clmm"
  | "raydium-cpmm"
  | "pumpswap";

export type MintOracleCluster = "mainnet" | "devnet" | "localnet";

export type MintOracleSourcePriority =
  | "production-priority"
  | "adapter-separate";

export const MINT_ORACLE_PRODUCTION_PRIORITY_SOURCE_FAMILIES: readonly MintOracleSourceFamily[] =
  PUBLIC_AUTHORITY.MINT_ORACLE_PRODUCTION_PRIORITY_SOURCE_FAMILIES;

export const MINT_ORACLE_ADAPTER_SEPARATE_SOURCE_FAMILIES: readonly MintOracleSourceFamily[] =
  PUBLIC_AUTHORITY.MINT_ORACLE_ADAPTER_SEPARATE_SOURCE_FAMILIES;

export const MINT_ORACLE_DEFAULT_DISCOVERY_SOURCE_FAMILIES: readonly MintOracleSourceFamily[] =
  PUBLIC_AUTHORITY.MINT_ORACLE_DEFAULT_DISCOVERY_SOURCE_FAMILIES;

export const MINT_ORACLE_SOURCE_FAMILY_ORDER: readonly MintOracleSourceFamily[] =
  PUBLIC_AUTHORITY.MINT_ORACLE_SOURCE_FAMILY_ORDER;

const SOL_MINT = MIMIR_SOL_MINT;
const SPL_TOKEN_ACCOUNT_LEN = 165;
const SPL_TOKEN_ACCOUNT_OFFSET_MINT = 0;
const SPL_TOKEN_ACCOUNT_OFFSET_OWNER = 32;
const SPL_TOKEN_ACCOUNT_OFFSET_AMOUNT = 64;
const SPL_TOKEN_ACCOUNT_OFFSET_DELEGATE_TAG = 72;
const SPL_TOKEN_ACCOUNT_OFFSET_STATE = 108;
const SPL_TOKEN_ACCOUNT_OFFSET_IS_NATIVE_TAG = 109;
const SPL_TOKEN_ACCOUNT_OFFSET_DELEGATED_AMOUNT = 121;
const SPL_TOKEN_ACCOUNT_OFFSET_CLOSE_AUTHORITY_TAG = 129;
const SPL_MINT_ACCOUNT_LEN = 82;
const SPL_MINT_OFFSET_DECIMALS = 44;
const SPL_MINT_OFFSET_IS_INITIALIZED = 45;
const SPL_MINT_OFFSET_SUPPLY = 36;
const PUMPSWAP_POOL_ACCOUNT_LENS = [300, 301, 287] as const;
const PUMPSWAP_POOL_DISCRIMINATOR = Buffer.from("f19a6d0411b16dbc", "hex");
const PUMPSWAP_POOL_OFFSET_BUMP = 8;
const PUMPSWAP_POOL_OFFSET_INDEX = 9;
const PUMPSWAP_POOL_OFFSET_CREATOR = 11;
const PUMPSWAP_POOL_OFFSET_BASE_MINT = 43;
const PUMPSWAP_POOL_OFFSET_QUOTE_MINT = 75;
const PUMPSWAP_POOL_OFFSET_LP_MINT = 107;
const PUMPSWAP_POOL_OFFSET_BASE_VAULT = 139;
const PUMPSWAP_POOL_OFFSET_QUOTE_VAULT = 171;
const PUMPSWAP_POOL_OFFSET_LP_SUPPLY = 203;
const PUMPSWAP_POOL_OFFSET_MAYHEM_MODE = 243;
const PUMPSWAP_POOL_OFFSET_CASHBACK = 244;
const PUMPSWAP_POOL_OFFSET_VIRTUAL_QUOTE_RESERVES = 245;
const PUMPSWAP_POOL_OFFSET_PENDING_PROTOCOL_FEES = 271;
const PUMPSWAP_POOL_OFFSET_PENDING_CREATOR_FEES = 279;
const ORCA_WHIRLPOOL_ACCOUNT_LEN = 653;
const ORCA_WHIRLPOOL_DISCRIMINATOR = Buffer.from([63, 149, 209, 12, 225, 128, 99, 9]);
const ORCA_WHIRLPOOL_OFFSET_CONFIG = 8;
const ORCA_WHIRLPOOL_OFFSET_LIQUIDITY = 49;
const ORCA_WHIRLPOOL_OFFSET_TOKEN_MINT_A = 101;
const ORCA_WHIRLPOOL_OFFSET_TOKEN_VAULT_A = 133;
const ORCA_WHIRLPOOL_OFFSET_TOKEN_MINT_B = 181;
const ORCA_WHIRLPOOL_OFFSET_TOKEN_VAULT_B = 213;
const METEORA_DLMM_LB_PAIR_LEN = 904;
const METEORA_DLMM_BIN_ARRAY_LEN = 10_136;
const METEORA_DLMM_LB_PAIR_OFFSET_ACTIVE_ID = 76;
const METEORA_DLMM_LB_PAIR_OFFSET_TOKEN_X_MINT = 88;
const METEORA_DLMM_LB_PAIR_OFFSET_TOKEN_Y_MINT = 120;
const METEORA_DLMM_LB_PAIR_OFFSET_RESERVE_X = 152;
const METEORA_DLMM_LB_PAIR_OFFSET_RESERVE_Y = 184;
const METEORA_DLMM_BIN_ARRAY_OFFSET_INDEX = 8;
const METEORA_DLMM_BIN_ARRAY_OFFSET_LB_PAIR = 24;
const METEORA_DLMM_BIN_ARRAY_OFFSET_BINS = 56;
const METEORA_DLMM_BIN_ARRAY_BIN_LEN = 144;
const METEORA_DLMM_LB_PAIR_OFFSET_BIN_STEP = 80;
const METEORA_DLMM_LB_PAIR_OFFSET_STATUS = 82;
const METEORA_DLMM_LB_PAIR_STATUS_ENABLED = 0;
const METEORA_DLMM_LB_PAIR_OFFSET_ACTIVATION_TYPE = 86;
const METEORA_DLMM_ACTIVATION_TYPE_SLOT = 0;
const METEORA_DLMM_ACTIVATION_TYPE_TIMESTAMP = 1;
const METEORA_DLMM_LB_PAIR_OFFSET_ACTIVATION_POINT = 816;
const METEORA_DLMM_MAX_BIN_STEP = 400;
const METEORA_DLMM_MAX_BIN_PER_ARRAY = 70;
const METEORA_DLMM_BIN_ARRAY_SEED = Buffer.from("bin_array", "ascii");
const METEORA_DLMM_BIN_OFFSET_AMOUNT_X = 0;
const METEORA_DLMM_BIN_OFFSET_AMOUNT_Y = 8;
const METEORA_DAMM_V2_POOL_LEN = 1112;
const METEORA_DAMM_V2_POOL_OFFSET_TOKEN_A_MINT = 168;
const METEORA_DAMM_V2_POOL_OFFSET_TOKEN_B_MINT = 200;
const METEORA_DAMM_V2_POOL_OFFSET_TOKEN_A_VAULT = 232;
const METEORA_DAMM_V2_POOL_OFFSET_TOKEN_B_VAULT = 264;
const METEORA_DAMM_V2_POOL_OFFSET_LIQUIDITY = 360;
const METEORA_DAMM_V2_POOL_OFFSET_SQRT_MIN_PRICE = 424;
const METEORA_DAMM_V2_POOL_OFFSET_SQRT_MAX_PRICE = 440;
const METEORA_DAMM_V2_POOL_OFFSET_SQRT_PRICE = 456;
const METEORA_DAMM_V2_POOL_OFFSET_ACTIVATION_POINT = 472;
const METEORA_DAMM_V2_POOL_OFFSET_ACTIVATION_TYPE = 480;
const METEORA_DAMM_V2_POOL_OFFSET_POOL_STATUS = 481;
const METEORA_DAMM_V2_ACTIVATION_TYPE_SLOT = 0;
const METEORA_DAMM_V2_ACTIVATION_TYPE_TIMESTAMP = 1;
const METEORA_DAMM_V2_POOL_STATUS_ENABLED = 0;
const METEORA_DAMM_V2_SQRT_DOWN_50_BPS_X64 = 18_400_569_422_882_917_161n;
const METEORA_DAMM_V2_SQRT_UP_50_BPS_X64 = 18_492_803_431_484_993_638n;
const RAYDIUM_CLMM_POOL_STATE_LEN = 1544;
const RAYDIUM_CLMM_POOL_OFFSET_AMM_CONFIG = 9;
const RAYDIUM_CLMM_POOL_OFFSET_TOKEN_MINT_0 = 73;
const RAYDIUM_CLMM_POOL_OFFSET_TOKEN_MINT_1 = 105;
const RAYDIUM_CLMM_POOL_OFFSET_TOKEN_VAULT_0 = 137;
const RAYDIUM_CLMM_POOL_OFFSET_TOKEN_VAULT_1 = 169;
const RAYDIUM_CLMM_POOL_OFFSET_STATUS = 389;
const RAYDIUM_CLMM_POOL_OFFSET_OPEN_TIME = 1080;
const RAYDIUM_CLMM_STATUS_SWAP_DISABLED_MASK = 16;
const RAYDIUM_CPMM_POOL_OFFSET_AMM_CONFIG = 8;
const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT = 72;
const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_VAULT = 104;
const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT = 168;
const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_MINT = 200;
const RAYDIUM_CPMM_POOL_OFFSET_STATUS = 329;
const RAYDIUM_CPMM_POOL_OFFSET_OPEN_TIME = 373;
const RAYDIUM_CPMM_STATUS_SWAP_DISABLED_MASK = 4;

interface RpcMintOracleMarketEvidence {
  identityKey: string;
  baseDecimals?: number;
  quoteDecimals?: number;
  minLiquidityNative?: bigint;
  minDepthTo50BpsNative?: bigint;
  tvlUsd?: number;
  liquidityUsd?: number;
  depthTo50BpsUsd?: number;
  volume24hUsd?: number;
  volume7dUsd?: number;
  spreadBps?: number;
  confidenceBps?: number;
  liquidityAgeSlots?: bigint;
  feeLossFloorNative?: bigint;
  retainedObservationCount?: number;
  lastObservationSlot?: bigint;
}

const rpcMintOracleDiscoveryEvidence = new WeakMap<
  MintOracleDiscoveredPool,
  RpcMintOracleMarketEvidence
>();

export const MINT_ORACLE_MARKET_FLAGS: typeof PUBLIC_AUTHORITY.MINT_ORACLE_MARKET_FLAGS = Object.freeze(Object.defineProperty(
  { ...PUBLIC_AUTHORITY.MINT_ORACLE_MARKET_FLAGS }, "MANIPULATION_COST_LOW", {
    enumerable: false, get() { throw new Error("MintOracleRemovedName MANIPULATION_COST_LOW: use FEE_LOSS_FLOOR_LOW"); } }));

export type MintOracleMarketFlagName = keyof typeof MINT_ORACLE_MARKET_FLAGS;

export interface DeriveMintPairFeedIdArgs {
  mintAddress: PublicKeyInput;
  quoteMintAddress?: PublicKeyInput;
  defaultQuoteMintAddress?: PublicKeyInput;
  cluster: MintOracleCluster;
  namespace?: string;
  allowPoolQuoteMint?: boolean;
  variant?: number;
}

export interface ResolveMintOracleAccountsArgs
  extends DeriveMintPairFeedIdArgs {
  feedId?: Uint8Array;
  programId?: PublicKey;
  sourceIndices?: readonly number[];
  ringVersion?: number;
  twapVersion?: number;
  planId?: number;
  planVersion?: number;
}

export interface ResolvedMintOracleSourceAccounts {
  sourceIndex: number;
  sourceConfig: PublicKey;
  sourceRing: PublicKey;
}

export interface ResolvedMintOracleAccounts {
  programId: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  feedId: Buffer;
  feedIdHex: string;
  adminConfig: PublicKey;
  feedReservation: PublicKey;
  feedCollateralLock: PublicKey;
  feedConfig: PublicKey;
  feedSnapshot: PublicKey;
  feedTwap: PublicKey;
  sourcingPlan: PublicKey;
  sourceAccounts: readonly ResolvedMintOracleSourceAccounts[];
}

export interface MintOracleDiscoveredPool {
  family: MintOracleSourceFamily;
  poolOrMarket: PublicKeyInput;
  baseVault: PublicKeyInput;
  quoteVault: PublicKeyInput;
  ammConfig?: PublicKeyInput;
  whirlpoolsConfig?: PublicKeyInput;
  lowerTickArray?: PublicKeyInput;
  activeTickArray?: PublicKeyInput;
  upperTickArray?: PublicKeyInput;
  activeBinArray?: PublicKeyInput;
  bids?: PublicKeyInput;
  asks?: PublicKeyInput;
  eventHeap?: PublicKeyInput;
  programId?: PublicKeyInput;
  tokenProgram?: PublicKeyInput;
  adapterVersion?: 0 | 1;
  token2022Mint?: PublicKeyInput;
  vaultAuthority?: PublicKeyInput;
  baseDecimals?: number;
  quoteDecimals?: number;
  /** Mimir condition word observed at discovery; conditioned issuers are listed, never filtered. */
  conditions?: number;
  sourceIndex?: number;
  direction?: number;
  venueGroup?: number;
  operatorGroup?: number;
  liquidityOwnerGroup?: number;
  routeCorrelationGroup?: number;
  quoteAssetGroup?: number;
  bridgeOrWrapperGroup?: number;
  oracleSourceClass?: number;
  upgradeAuthorityGroup?: number;
  maxSourceWeightBps?: number;
  minLiquidityNative?: bigint;
  minDepthTo50BpsNative?: bigint;
  tvlUsd?: number;
  liquidityUsd?: number;
  depthTo50BpsUsd?: number;
  volume24hUsd?: number;
  volume7dUsd?: number;
  spreadBps?: number;
  confidenceBps?: number;
  liquidityAgeSlots?: bigint;
  feeLossFloorNative?: bigint;
  retainedObservationCount?: number;
  lastObservationSlot?: bigint;
  label?: string;
}

export type UnsafeUnverifiedMintOraclePools = "unsafe-unverified-test-fixture";

export interface DiscoverMintOraclePoolsArgs {
  mintAddress: PublicKey;
  quoteMintAddress: PublicKey;
  cluster: MintOracleCluster;
  families: readonly MintOracleSourceFamily[];
}

export interface MintOraclePoolDiscoveryProvider {
  discoverMintOraclePools(
    args: DiscoverMintOraclePoolsArgs,
  ): Promise<readonly MintOracleDiscoveredPool[]>;
}

export interface RpcMintOraclePoolDiscoveryProviderConfig {
  connection: Pick<
    Connection,
    "getProgramAccounts" | "getMultipleAccountsInfo" | "getAccountInfo" | "getSlot"
  >;
  maxPoolsPerFamily?: number;
  currentUnixTimestamp?: number;
  currentSlot?: bigint;
}

export interface VerifyMintOraclePoolsWithRpcArgs {
  connection: Pick<
    Connection,
    "getMultipleAccountsInfo" | "getAccountInfo" | "getProgramAccounts" | "getSlot"
  >;
  mintAddress: PublicKeyInput;
  quoteMintAddress?: PublicKeyInput;
  defaultQuoteMintAddress?: PublicKeyInput;
  cluster: MintOracleCluster;
  pools: readonly MintOracleDiscoveredPool[];
  currentUnixTimestamp?: number;
  currentSlot?: bigint;
}

export interface MintOracleProgramRiskTierEvaluation {
  informedRiskTier: number;
  maxRefreshRiskTier: number;
  creationRiskTier: number;
  routeableAtomicPath:
    | "single-source"
    | "orca-raydium-clmm"
    | "meteora-raydium-clmm"
    | "orca-meteora"
    | "orca-meteora-raydium-clmm"
    | "raydium-cpmm-2"
    | "raydium-cpmm-3"
    | "raydium-cpmm-4"
    | "raydium-cpmm-5"
    | "retained-rings"
    | "unsupported";
  sourceCount: number;
  venueCount: number;
  correlationGroupCount: number;
  warnings: readonly string[];
}

export interface SelectMintOraclePoolsArgs {
  pools: readonly MintOracleDiscoveredPool[];
  families?: readonly MintOracleSourceFamily[];
  includeAdapterSeparate?: boolean;
  maxPoolsPerFamily?: number;
  minProductionSourceCount?: number;
  strict?: boolean;
  longTailPolicy?: MintOracleLongTailPolicy;
}

export interface SelectedMintOraclePools {
  selectedPools: readonly MintOracleDiscoveredPool[];
  productionPriorityPools: readonly MintOracleDiscoveredPool[];
  adapterSeparatePools: readonly MintOracleDiscoveredPool[];
  sourceFamilies: readonly MintOracleSourceFamily[];
  sourcePriority: MintOracleSourcePriority;
  programRiskTier: MintOracleProgramRiskTierEvaluation;
  warnings: readonly string[];
  longTailEvaluation?: MintOracleLongTailEvaluation;
}

export interface DiscoverMintOracleUsdQuotePoolsArgs {
  discoveryProvider: MintOraclePoolDiscoveryProvider;
  mintAddress: PublicKeyInput;
  cluster: MintOracleCluster;
  usdcMintAddress?: PublicKeyInput;
  usdtMintAddress?: PublicKeyInput;
  solMintAddress?: PublicKeyInput;
  includeSolQuote?: boolean;
  includeAdapterSeparate?: boolean;
  families?: readonly MintOracleSourceFamily[];
  maxPoolsPerFamily?: number;
  minProductionSourceCount?: number;
  strict?: boolean;
  longTailPolicy?: MintOracleLongTailPolicy;
  canonicalSolQuoteFeedId?: Uint8Array;
}

export interface MintOracleUsdQuoteAlternative
  extends SelectedMintOraclePools {
  quoteMintAddress: PublicKey;
  quoteKind:
    | "stable-usdc"
    | "stable-usdt"
    | "sol-via-canonical-feed";
  requiresSolQuoteFeed: boolean;
  requiresQuoteConversion: boolean;
}

export interface MintOracleUsdQuotePoolSelection {
  selected: MintOracleUsdQuoteAlternative;
  alternatives: readonly MintOracleUsdQuoteAlternative[];
  stableAlternatives: readonly MintOracleUsdQuoteAlternative[];
  solAlternative: MintOracleUsdQuoteAlternative | null;
  canonicalSolQuoteFeedId: Buffer | null;
  warnings: readonly string[];
}

export interface MintOracleLongTailPolicy {
  minSourceCount?: number;
  minVenueCount?: number;
  minTvlUsd?: number;
  minLiquidityUsd?: number;
  minDepthTo50BpsUsd?: number;
  minLiquidityAgeSlots?: bigint;
  minFeeLossFloorNative?: bigint;
  minRetainedObservationCount?: number;
  maxDominantSourceWeightBps?: number;
  maxSpreadBps?: number;
  maxConfidenceBps?: number;
  requireAnchor?: boolean;
}

export interface MintOracleLongTailMetrics {
  sourceCount: number;
  venueCount: number | null;
  totalTvlUsd: number | null;
  liquidityUsdMin: number | null;
  depthTo50BpsUsdMin: number | null;
  liquidityAgeSlotsMin: bigint | null;
  feeLossFloorNativeMin: bigint | null;
  retainedObservationCountMin: number | null;
  dominantSourceWeightBps: number;
  spreadBpsMax: number | null;
  confidenceBpsMax: number | null;
}

export interface MintOracleLongTailEvaluation {
  marketFlags: number;
  flagNames: readonly MintOracleMarketFlagName[];
  metrics: MintOracleLongTailMetrics;
  warnings: readonly string[];
  eligibleForStandardAtomicPath: boolean;
}

export interface BuildMintOracleSourceConfigArgs {
  feedId: Uint8Array;
  baseMint: PublicKeyInput;
  quoteMint: PublicKeyInput;
  pools: readonly MintOracleDiscoveredPool[];
  cluster: MintOracleCluster;
  allowUnverifiedPools?: UnsafeUnverifiedMintOraclePools;
  sourceConfigRevision?: bigint;
  sourceSetRevision?: bigint;
}

function toPublicKey(value: PublicKeyInput, name: string): PublicKey {
  try {
    return value instanceof PublicKey
      ? new PublicKey(value.toBytes())
      : new PublicKey(value);
  } catch (cause) {
    throw new Error(`Invalid${name}PublicKey`, { cause });
  }
}

function publicKeyInputSortKey(value: PublicKeyInput): string {
  try {
    return toPublicKey(value, "SortKey").toBase58();
  } catch {
    return value instanceof Uint8Array ? Buffer.from(value).toString("hex") : String(value);
  }
}

function bytes32(value: Uint8Array, name: string): Buffer {
  const out = Buffer.from(value);
  if (out.length !== 32) throw new Error(`${name}Expected32Bytes`);
  return out;
}

function requireQuoteMint(args: DeriveMintPairFeedIdArgs): PublicKey {
  const quoteMint = args.quoteMintAddress ?? args.defaultQuoteMintAddress;
  if (!quoteMint) throw new Error("MissingQuoteMintAddress");
  return toPublicKey(quoteMint, "QuoteMint");
}

function assertDistinctMintPair(baseMint: PublicKey, quoteMint: PublicKey): void {
  if (baseMint.equals(quoteMint)) {
    throw new Error("MintOracleBaseQuoteMintMustDiffer");
  }
}

function assertAdmittedMintOraclePoolQuoteMint(
  quoteMint: PublicKey,
  cluster: MintOracleCluster | undefined,
): void {
  if (!isMimirAdmittedPoolQuoteMint(quoteMint, activeMintOraclePolicyCluster(cluster))) {
    throw new Error("UnsupportedMintOracleQuoteMint");
  }
}

function assertAdmittedMintOracleClassicFeedQuoteMint(
  quoteMint: PublicKey,
  cluster: MintOracleCluster | undefined,
): void {
  if (!isMimirClassicFeedQuoteMint(quoteMint, activeMintOraclePolicyCluster(cluster))) {
    throw new Error("UnsupportedMintOracleQuoteMint");
  }
}

function assertU16(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`Invalid${name}`);
  }
}

function familyOrderIndex(family: MintOracleSourceFamily): number {
  const index = PRIVATE_AUTHORITY.MINT_ORACLE_SOURCE_FAMILY_ORDER.indexOf(family);
  return index === -1
    ? PRIVATE_AUTHORITY.MINT_ORACLE_SOURCE_FAMILY_ORDER.length
    : index;
}

function poolVenueGroup(pool: MintOracleDiscoveredPool): number {
  return pool.venueGroup ?? familyOrderIndex(pool.family) + 1;
}

function poolRouteCorrelationGroup(pool: MintOracleDiscoveredPool): number {
  return pool.routeCorrelationGroup ?? familyOrderIndex(pool.family) + 1;
}

const OPERATOR_DOMAIN: Record<MintOracleSourceFamily, number> = {
  "orca-whirlpool": 0, "raydium-clmm": 1, "raydium-cpmm": 1, "meteora-dlmm": 2, "meteora-damm-v2": 2, pumpswap: 3,
};

/** Known unique groups (65535 = unknown, never counted; 0 is a valid group), defaulting to the source's operator domain. */
function knownOperatorGroups(pools: readonly MintOracleDiscoveredPool[], pick: (pool: MintOracleDiscoveredPool) => number | undefined): number {
  return new Set(pools.map((pool) => pick(pool) ?? OPERATOR_DOMAIN[pool.family]).filter((group) => group !== 0xffff)).size;
}

function isExecutableRetainedRingFamily(family: MintOracleSourceFamily): boolean {
  return family !== "pumpswap";
}

function poolOperatorGroup(pool: MintOracleDiscoveredPool): number {
  return pool.operatorGroup ?? familyOrderIndex(pool.family) + 1;
}

function poolQuoteAssetGroup(pool: MintOracleDiscoveredPool): number {
  return pool.quoteAssetGroup ?? 1;
}

function poolBridgeOrWrapperGroup(pool: MintOracleDiscoveredPool): number {
  return pool.bridgeOrWrapperGroup ?? 0;
}

function poolOracleSourceClass(pool: MintOracleDiscoveredPool): number {
  return pool.oracleSourceClass ?? familyOrderIndex(pool.family) + 1;
}

function poolUpgradeAuthorityGroup(pool: MintOracleDiscoveredPool): number {
  return pool.upgradeAuthorityGroup ?? familyOrderIndex(pool.family) + 1;
}

function currentMintOracleSourceConfigMinDepthFloor(
  pool: MintOracleDiscoveredPool,
  evidence: { minDepthTo50BpsNative?: bigint } | null,
): bigint {
  if (
    (pool.family === "orca-whirlpool" || pool.family === "raydium-clmm") &&
    !hasRouteableRaydiumClmmTickArrays(pool)
  ) {
    return 1n;
  }
  if (pool.minDepthTo50BpsNative !== undefined) {
    return conservativeMintOracleSourceConfigFloor(pool.minDepthTo50BpsNative);
  }
  const discoveredOrExplicitDepth = evidence?.minDepthTo50BpsNative ?? 1n;
  return evidence?.minDepthTo50BpsNative !== undefined
    ? conservativeMintOracleSourceConfigFloor(discoveredOrExplicitDepth)
    : discoveredOrExplicitDepth;
}

function currentMintOracleSourceConfigMinLiquidityFloor(
  pool: MintOracleDiscoveredPool,
  evidence: { minLiquidityNative?: bigint } | null,
): bigint {
  if (pool.minLiquidityNative !== undefined) {
    return conservativeMintOracleSourceConfigFloor(pool.minLiquidityNative);
  }
  return evidence?.minLiquidityNative !== undefined
    ? conservativeMintOracleSourceConfigFloor(evidence.minLiquidityNative)
    : 1n;
}

function poolScore(pool: MintOracleDiscoveredPool): number {
  return computeMintOraclePoolScore(pool);
}

function hasRpcMintOracleDiscoveryEvidence(pool: MintOracleDiscoveredPool): boolean {
  return rpcMintOracleMarketEvidence(pool) !== null;
}

function rpcMintOracleMarketEvidence(
  pool: MintOracleDiscoveredPool,
): RpcMintOracleMarketEvidence | null {
  const evidence = rpcMintOracleDiscoveryEvidence.get(pool);
  if (!evidence || evidence.identityKey !== mintOraclePoolIdentityKey(pool)) {
    return null;
  }
  return evidence;
}

function mintOracleClusterProfile(cluster: MintOracleCluster | undefined) {
  const table = mimirBetaClusterTable(activeMintOraclePolicyCluster(cluster) === "devnet" ? "devnet" : "mainnet-beta");
  const { usdc, usdt, legacyUsdc } = table.usdStableQuoteMints;
  return {
    usdc: new PublicKey(usdc),
    usdt: usdt ? new PublicKey(usdt) : null,
    usdStableQuoteMints: [usdc, usdt, legacyUsdc].flatMap((mint) => (mint ? [new PublicKey(mint)] : [])),
    orcaWhirlpoolsConfig: new PublicKey(table.orcaWhirlpoolsConfig),
    raydiumCpmmPoolStateLength: table.raydiumCpmmPoolStateLength,
  };
}

function isUsdStableLikeQuoteMint(quoteMint: PublicKey, cluster: MintOracleCluster | undefined): boolean {
  return mintOracleClusterProfile(cluster).usdStableQuoteMints.some((mint) => quoteMint.equals(mint));
}

function optionalPublicKeyIdentity(value: PublicKeyInput | undefined): string {
  return value === undefined ? "" : toPublicKey(value, "PoolIdentity").toBase58();
}

function mintOraclePoolIdentityKey(pool: MintOracleDiscoveredPool): string {
  return [
    pool.family,
    optionalPublicKeyIdentity(pool.poolOrMarket),
    optionalPublicKeyIdentity(pool.baseVault),
    optionalPublicKeyIdentity(pool.quoteVault),
    optionalPublicKeyIdentity(pool.whirlpoolsConfig),
    optionalPublicKeyIdentity(pool.activeBinArray),
    optionalPublicKeyIdentity(pool.bids),
    optionalPublicKeyIdentity(pool.asks),
    optionalPublicKeyIdentity(pool.eventHeap),
    optionalPublicKeyIdentity(pool.programId),
    optionalPublicKeyIdentity(pool.tokenProgram),
    pool.adapterVersion ?? "",
    optionalPublicKeyIdentity(pool.token2022Mint),
    optionalPublicKeyIdentity(pool.vaultAuthority),
    pool.baseDecimals ?? "",
    pool.quoteDecimals ?? "",
    pool.direction ?? "",
  ].join("|");
}

function cloneMintOracleValue<T>(value: T): T {
  if (value instanceof PublicKey) return new PublicKey(value.toBytes()) as T;
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (value instanceof Uint8Array) return new Uint8Array(value) as T;
  if (Array.isArray(value)) return value.map(cloneMintOracleValue) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneMintOracleValue(entry)]),
    ) as T;
  }
  return value;
}

function cloneMintOraclePool<T extends MintOracleDiscoveredPool>(pool: T): T {
  return cloneMintOracleValue(pool);
}

function tagRpcMintOracleDiscoveryEvidence<T extends MintOracleDiscoveredPool>(
  pool: T,
): T {
  const snapshot = cloneMintOraclePool(pool);
  rpcMintOracleDiscoveryEvidence.set(snapshot, {
    identityKey: mintOraclePoolIdentityKey(snapshot),
    baseDecimals: snapshot.baseDecimals,
    quoteDecimals: snapshot.quoteDecimals,
    minLiquidityNative: snapshot.minLiquidityNative,
    minDepthTo50BpsNative: snapshot.minDepthTo50BpsNative,
    tvlUsd: snapshot.tvlUsd,
    liquidityUsd: snapshot.liquidityUsd,
    depthTo50BpsUsd: snapshot.depthTo50BpsUsd,
    volume24hUsd: snapshot.volume24hUsd,
    volume7dUsd: snapshot.volume7dUsd,
    spreadBps: snapshot.spreadBps,
    confidenceBps: snapshot.confidenceBps,
    liquidityAgeSlots: snapshot.liquidityAgeSlots,
    feeLossFloorNative: snapshot.feeLossFloorNative,
    retainedObservationCount: snapshot.retainedObservationCount,
    lastObservationSlot: snapshot.lastObservationSlot,
  });
  return snapshot;
}

function copyRpcMintOracleDiscoveryEvidence<T extends MintOracleDiscoveredPool>(
  pool: T,
  source: MintOracleDiscoveredPool,
): T {
  const evidence = rpcMintOracleMarketEvidence(source);
  if (evidence) {
    const copied = pool as T & {
      baseDecimals?: number;
      quoteDecimals?: number;
    };
    copied.baseDecimals ??= evidence.baseDecimals;
    copied.quoteDecimals ??= evidence.quoteDecimals;
    rpcMintOracleDiscoveryEvidence.set(copied, {
      ...evidence,
      identityKey: mintOraclePoolIdentityKey(copied),
    });
  }
  return pool;
}

function priorityRank(priority: MintOracleSourcePriority): number {
  switch (priority) {
    case "production-priority":
      return 0;
    case "adapter-separate":
      return 1;
  }
}

function sourceGraphOrderRank(family: MintOracleSourceFamily): number {
  switch (family) {
    case "orca-whirlpool":
      return 0;
    case "meteora-dlmm":
      return 1;
    case "meteora-damm-v2":
      return 2;
    case "raydium-clmm":
      return 3;
    case "raydium-cpmm":
      return 4;
    case "pumpswap":
      return 5;
  }
}

function assertSourceIndex(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SOURCE_INDEX) {
    throw new Error("InvalidSourceIndex");
  }
}

function assertUniqueSourceIndices(sourceIndices: readonly number[]): void {
  if (sourceIndices.length === 0) {
    throw new Error("MissingMintOracleSourceIndices");
  }
  const seen = new Set<number>();
  for (const sourceIndex of sourceIndices) {
    assertSourceIndex(sourceIndex);
    if (seen.has(sourceIndex)) throw new Error("DuplicateSourceIndex");
    seen.add(sourceIndex);
  }
}

function requireMintOracleCluster(
  cluster: MintOracleCluster | undefined,
): MintOracleCluster {
  if (cluster == null) {
    throw new Error("MissingMintOracleCluster");
  }
  if (cluster !== "mainnet" && cluster !== "devnet" && cluster !== "localnet") {
    throw new Error("InvalidMintOracleCluster");
  }
  return cluster;
}

function activeMintOraclePolicyCluster(
  cluster: MintOracleCluster | undefined,
): "mainnet" | "devnet" {
  return requireMintOracleCluster(cluster) === "devnet" ? "devnet" : "mainnet";
}

function resolveMintOraclePoolSourceIndices(
  pools: readonly MintOracleDiscoveredPool[],
): number[] {
  const used = new Set<number>();
  for (let index = 0; index < pools.length; index += 1) {
    const explicit = pools[index]?.sourceIndex;
    if (explicit === undefined) throw new Error("MissingMintOracleSourceIndex");
    assertSourceIndex(explicit);
    if (used.has(explicit)) throw new Error("DuplicateSourceIndex");
    used.add(explicit);
  }
  return pools.map((pool) => pool.sourceIndex as number);
}

function assertVerifiedMintOraclePools(
  pools: readonly MintOracleDiscoveredPool[],
  allowUnverifiedPools?: UnsafeUnverifiedMintOraclePools,
  cluster?: MintOracleCluster,
): void {
  if (allowUnverifiedPools === "unsafe-unverified-test-fixture") {
    if (
      process.env.MIMIR_ALLOW_UNVERIFIED_TEST_FIXTURES === "1" &&
      cluster !== undefined &&
      requireMintOracleCluster(cluster) === "localnet"
    ) {
      return;
    }
    throw new Error("UnverifiedMintOraclePoolGraph");
  }
  if (!pools.every((pool) => hasRpcMintOracleDiscoveryEvidence(pool))) {
    throw new Error("UnverifiedMintOraclePoolGraph");
  }
}

function assertSupportedPumpSwapSelection(
  pools: readonly MintOracleDiscoveredPool[],
  baseMint: PublicKey,
): void {
  const pumps = pools.filter((pool) => pool.family === "pumpswap");
  if (pumps.length === 0) return;
  const pump = pumps[0]!;
  const pumpVersion = pump.adapterVersion ?? (pump.token2022Mint === undefined ? VERSION_V0 : 1);
  if (pumps.length !== 1) throw new Error("PumpSwapRequiresSingleSelectedSource");
  if (pools.length === 1) {
    if (pumpVersion === 1 && pump.token2022Mint !== undefined &&
        !toPublicKey(pump.token2022Mint, "Token2022Mint").equals(baseMint)) {
      throw new Error("PumpSwapV1RequiresToken2022Base");
    }
    return;
  }
  const dlmm = pools.find((pool) => pool.family === "meteora-dlmm");
  const dlmmVersion = dlmm?.adapterVersion ?? (dlmm?.token2022Mint === undefined ? VERSION_V0 : 1);
  if (pools.length !== 2 || dlmm == null || pumpVersion !== 1 || dlmmVersion !== 1 ||
      pump.token2022Mint === undefined || dlmm.token2022Mint === undefined ||
      !toPublicKey(pump.token2022Mint, "Token2022Mint").equals(baseMint) ||
      !toPublicKey(dlmm.token2022Mint, "Token2022Mint").equals(baseMint)) {
    throw new Error("PumpSwapRequiresSingleSelectedSource");
  }
}

function boundedBigIntToNumber(value: bigint | undefined): number {
  if (value === undefined) return 0;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}

function nonNegativeFiniteMetric(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? 0 : value;
}

function bpsMetric(value: number | undefined): number {
  return Math.min(nonNegativeFiniteMetric(value), 10_000);
}

function positiveMetricScore(value: number | undefined, weight: number): number {
  const metric = nonNegativeFiniteMetric(value);
  return metric === 0 ? 0 : Math.log10(metric + 1) * weight;
}

function positiveBigIntMetricScore(
  value: bigint | null | undefined,
  weight: number,
): number {
  if (value === undefined || value === null || value <= 0n) return 0;
  return positiveMetricScore(boundedBigIntToNumber(value), weight);
}

function minDefinedNumber(values: readonly (number | undefined)[]): number | null {
  const defined = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
  return defined.length === 0 ? null : Math.min(...defined);
}

function maxDefinedNumber(values: readonly (number | undefined)[]): number | null {
  const defined = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
  return defined.length === 0 ? null : Math.max(...defined);
}

function minDefinedBigInt(values: readonly (bigint | undefined)[]): bigint | null {
  let min: bigint | null = null;
  for (const value of values) {
    if (value === undefined) continue;
    min = min === null || value < min ? value : min;
  }
  return min;
}

function sumDefinedNumber(values: readonly (number | undefined)[]): number | null {
  let found = false;
  let total = 0;
  for (const value of values) {
    if (value === undefined || !Number.isFinite(value)) continue;
    found = true;
    total += value;
  }
  return found ? total : null;
}

function addMarketFlag(
  names: MintOracleMarketFlagName[],
  name: MintOracleMarketFlagName,
): number {
  if (!names.includes(name)) names.push(name);
  return PRIVATE_AUTHORITY.MINT_ORACLE_MARKET_FLAGS[name];
}

export function computeMintOraclePoolScore(
  pool: MintOracleDiscoveredPool,
): number {
  const evidence = rpcMintOracleMarketEvidence(pool);
  if (evidence == null) return 0;
  const nativeLiquidity = boundedBigIntToNumber(evidence.minLiquidityNative);
  const nativeDepth = boundedBigIntToNumber(evidence.minDepthTo50BpsNative);
  const tvlScore = positiveMetricScore(evidence.tvlUsd, 28);
  const liquidityScore = positiveMetricScore(
    evidence.liquidityUsd ?? nativeLiquidity,
    18,
  );
  const depthScore = positiveMetricScore(
    evidence.depthTo50BpsUsd ?? nativeDepth,
    22,
  );
  const volume24hScore = positiveMetricScore(evidence.volume24hUsd, 18);
  const volume7dScore = positiveMetricScore(evidence.volume7dUsd, 10);
  const observationScore =
    evidence.retainedObservationCount === undefined
      ? 0
      : Math.min(Math.max(evidence.retainedObservationCount, 0), 10_000) / 100;
  const spreadPenalty = bpsMetric(evidence.spreadBps) * 0.4;
  const confidencePenalty = bpsMetric(evidence.confidenceBps) * 0.25;
  return (
    tvlScore +
    liquidityScore +
    depthScore +
    volume24hScore +
    volume7dScore +
    observationScore -
    spreadPenalty -
    confidencePenalty
  );
}

export function evaluateMintOracleLongTailPools(args: {
  pools: readonly MintOracleDiscoveredPool[];
  policy?: MintOracleLongTailPolicy;
  hasAnchor?: boolean;
}): MintOracleLongTailEvaluation {
  const policy = args.policy ?? {};
  if (Object.hasOwn(policy, "minManipulationCostFloorNative")) {
    throw new Error("MintOracleRemovedName minManipulationCostFloorNative: use minFeeLossFloorNative");
  }
  const evidencePools = args.pools.filter((pool) =>
    hasRpcMintOracleDiscoveryEvidence(pool),
  );
  const sourceCount = evidencePools.length;
  const venueGroups = new Set<number>();
  let venueCountKnown = true;
  for (const pool of evidencePools) {
    const venueGroup = poolVenueGroup(pool);
    if (!Number.isInteger(venueGroup) || venueGroup <= 0) {
      venueCountKnown = false;
      continue;
    }
    venueGroups.add(venueGroup);
  }
  const marketEvidence = args.pools
    .map((pool) => rpcMintOracleMarketEvidence(pool))
    .filter((evidence): evidence is RpcMintOracleMarketEvidence => evidence !== null);
  const totalTvlUsd = sumDefinedNumber(marketEvidence.map((evidence) => evidence.tvlUsd));
  const liquidityUsdMin = minDefinedNumber(
    marketEvidence.map((evidence) => evidence.liquidityUsd),
  );
  const depthTo50BpsUsdMin = minDefinedNumber(
    marketEvidence.map((evidence) => evidence.depthTo50BpsUsd),
  );
  const liquidityAgeSlotsMin = minDefinedBigInt(
    marketEvidence.map((evidence) => evidence.liquidityAgeSlots),
  );
  const feeLossFloorNativeMin = minDefinedBigInt(
    marketEvidence.map((evidence) => evidence.feeLossFloorNative),
  );
  const retainedObservationCountMin = minDefinedNumber(
    marketEvidence.map((evidence) => evidence.retainedObservationCount),
  );
  const spreadBpsMax = maxDefinedNumber(
    marketEvidence.map((evidence) => evidence.spreadBps),
  );
  const confidenceBpsMax = maxDefinedNumber(
    marketEvidence.map((evidence) => evidence.confidenceBps),
  );
  const dominantSourceWeightBps =
    sourceCount === 0
      ? args.pools.length > 0
        ? 10_000
        : 0
      : Math.ceil(10_000 / sourceCount);
  const metrics: MintOracleLongTailMetrics = {
    sourceCount,
    venueCount: venueCountKnown ? venueGroups.size : null,
    totalTvlUsd,
    liquidityUsdMin,
    depthTo50BpsUsdMin,
    liquidityAgeSlotsMin,
    feeLossFloorNativeMin,
    retainedObservationCountMin,
    dominantSourceWeightBps,
    spreadBpsMax,
    confidenceBpsMax,
  };
  const flagNames: MintOracleMarketFlagName[] = [];
  const warnings: string[] = [];
  let marketFlags = 0;
  const flag = (name: MintOracleMarketFlagName, warning?: string) => {
    marketFlags |= addMarketFlag(flagNames, name);
    if (warning) warnings.push(warning);
  };

  const minSourceCount = policy.minSourceCount ?? 2;
  const minVenueCount = policy.minVenueCount ?? 2;
  if (sourceCount <= 1) flag("SINGLE_SOURCE", "only one selected source");
  if (sourceCount < minSourceCount) {
    flag("LONG_TAIL", `source count ${sourceCount} below ${minSourceCount}`);
  }
  if (metrics.venueCount === null) {
    flag("UNKNOWN_VENUE_COUNT", "venue count is unknown");
  } else if (metrics.venueCount <= 1) {
    flag("SINGLE_VENUE", "only one selected venue");
  }
  if (metrics.venueCount !== null && metrics.venueCount < minVenueCount) {
    flag("LONG_TAIL", `venue count ${metrics.venueCount} below ${minVenueCount}`);
  }
  if (totalTvlUsd !== null && policy.minTvlUsd !== undefined && totalTvlUsd < policy.minTvlUsd) {
    flag("THIN_LIQUIDITY", `TVL ${totalTvlUsd} below ${policy.minTvlUsd}`);
    flag("LONG_TAIL");
  }
  if (
    liquidityUsdMin !== null &&
    policy.minLiquidityUsd !== undefined &&
    liquidityUsdMin < policy.minLiquidityUsd
  ) {
    flag("THIN_LIQUIDITY", `liquidity ${liquidityUsdMin} below ${policy.minLiquidityUsd}`);
    flag("LONG_TAIL");
  }
  if (depthTo50BpsUsdMin === null) {
    flag("UNKNOWN_DEPTH", "routeable depth is unknown");
  } else if (
    policy.minDepthTo50BpsUsd !== undefined &&
    depthTo50BpsUsdMin < policy.minDepthTo50BpsUsd
  ) {
    flag("LOW_DEPTH", `depth ${depthTo50BpsUsdMin} below ${policy.minDepthTo50BpsUsd}`);
    flag("LONG_TAIL");
  }
  if (liquidityAgeSlotsMin === null) {
    flag("UNKNOWN_LIQUIDITY_AGE", "liquidity age is unknown");
    flag("YOUNG_OR_UNKNOWN_LIQUIDITY");
    flag("BOOTSTRAP_LIQUIDITY");
  } else if (
    policy.minLiquidityAgeSlots !== undefined &&
    liquidityAgeSlotsMin < policy.minLiquidityAgeSlots
  ) {
    flag("YOUNG_OR_UNKNOWN_LIQUIDITY", `liquidity age ${liquidityAgeSlotsMin} below ${policy.minLiquidityAgeSlots}`);
    flag("BOOTSTRAP_LIQUIDITY");
    flag("LONG_TAIL");
  }
  if (
    retainedObservationCountMin !== null &&
    policy.minRetainedObservationCount !== undefined &&
    retainedObservationCountMin < policy.minRetainedObservationCount
  ) {
    flag("LOW_OBSERVATION_COUNT", `observation count ${retainedObservationCountMin} below ${policy.minRetainedObservationCount}`);
    flag("BOOTSTRAP_LIQUIDITY");
  }
  if (
    feeLossFloorNativeMin === null ||
    (policy.minFeeLossFloorNative !== undefined &&
      feeLossFloorNativeMin < policy.minFeeLossFloorNative)
  ) {
    flag("FEE_LOSS_FLOOR_LOW", "manipulation-cost floor is missing or below policy");
  }
  if (
    policy.maxDominantSourceWeightBps !== undefined &&
    dominantSourceWeightBps > policy.maxDominantSourceWeightBps
  ) {
    flag("DOMINANT_SOURCE", `dominant source weight ${dominantSourceWeightBps} bps above ${policy.maxDominantSourceWeightBps}`);
  }
  if (
    spreadBpsMax !== null &&
    policy.maxSpreadBps !== undefined &&
    spreadBpsMax > policy.maxSpreadBps
  ) {
    flag("WIDE_SPREAD", `spread ${spreadBpsMax} bps above ${policy.maxSpreadBps}`);
  }
  if (
    confidenceBpsMax !== null &&
    policy.maxConfidenceBps !== undefined &&
    confidenceBpsMax > policy.maxConfidenceBps
  ) {
    flag("HIGH_DISPERSION", `confidence ${confidenceBpsMax} bps above ${policy.maxConfidenceBps}`);
  }
  if (args.hasAnchor !== true) {
    flag(
      "ANCHOR_MISSING",
      policy.requireAnchor === true
        ? "required anchor is missing"
        : "anchor is missing",
    );
  }

  const eligibleForStandardAtomicPath =
    sourceCount > 0 &&
    !flagNames.includes("UNKNOWN_VENUE_COUNT") &&
    !flagNames.includes("UNKNOWN_DEPTH") &&
    !flagNames.includes("FEE_LOSS_FLOOR_LOW");

  return {
    marketFlags,
    flagNames,
    metrics,
    warnings,
    eligibleForStandardAtomicPath,
  };
}

function comparePoolsForSelection(
  a: MintOracleDiscoveredPool,
  b: MintOracleDiscoveredPool,
): number {
  const scoreDelta = poolScore(b) - poolScore(a);
  if (scoreDelta !== 0) return scoreDelta;
  const priorityDelta =
    priorityRank(sourcePriorityForFamily(a.family)) -
    priorityRank(sourcePriorityForFamily(b.family));
  if (priorityDelta !== 0) return priorityDelta;
  const familyDelta = familyOrderIndex(a.family) - familyOrderIndex(b.family);
  if (familyDelta !== 0) return familyDelta;
  return publicKeyInputSortKey(a.poolOrMarket).localeCompare(
    publicKeyInputSortKey(b.poolOrMarket),
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

export function deriveMintPairFeedId(
  args: DeriveMintPairFeedIdArgs,
): Buffer {
  const baseMint = toPublicKey(args.mintAddress, "Mint");
  const quoteMint = requireQuoteMint(args);
  assertDistinctMintPair(baseMint, quoteMint);
  if (args.allowPoolQuoteMint) {
    assertAdmittedMintOraclePoolQuoteMint(quoteMint, args.cluster);
  } else {
    assertAdmittedMintOracleClassicFeedQuoteMint(quoteMint, args.cluster);
  }
  const namespace = args.namespace?.trim();
  const variant = args.variant ?? 0;
  if (!Number.isInteger(variant) || variant < 0 || variant > 0xffff) throw new Error("InvalidMintOracleVariant");
  if (args.variant !== undefined && namespace != null && namespace.length > 0) throw new Error("MintOracleVariantWithNamespace");
  if (variant !== 0) return canonicalMintPairFeedId(baseMint, quoteMint, variant);
  const hasher = createHash("sha256");
  hasher.update(
    Buffer.from(
      namespace == null || namespace.length === 0
        ? "MIMIR_MINT_PAIR_FEED_ID_V1"
        : "MIMIR_MINT_PAIR_FEED_ID_V1_NAMESPACE",
      "ascii",
    ),
  );
  hasher.update(Buffer.from([0]));
  if (namespace != null && namespace.length > 0) {
    hasher.update(Buffer.from(namespace, "utf8"));
    hasher.update(Buffer.from([0]));
  }
  hasher.update(baseMint.toBuffer());
  hasher.update(quoteMint.toBuffer());
  return hasher.digest();
}

export function canonicalMintPairFeedId(baseMint: PublicKey, quoteMint: PublicKey, variant = 0): Buffer {
  const hasher = createHash("sha256");
  hasher.update(Buffer.from("MIMIR_MINT_PAIR_FEED_ID_V1", "ascii"));
  if (variant === 0) {
    hasher.update(Buffer.from([0]));
  } else {
    const form = Buffer.alloc(3);
    form[0] = 1;
    form.writeUInt16LE(variant, 1);
    hasher.update(form);
  }
  hasher.update(baseMint.toBuffer());
  hasher.update(quoteMint.toBuffer());
  return hasher.digest();
}

export function recoverMintPairFeedVariant(baseMint: PublicKey, quoteMint: PublicKey, feedId: Uint8Array): number | null {
  for (let variant = 0; variant <= 0xffff; variant++) {
    if (sameBytes(canonicalMintPairFeedId(baseMint, quoteMint, variant), feedId)) return variant;
  }
  return null;
}

export function deriveMintPairFeedIdHex(
  args: DeriveMintPairFeedIdArgs,
): string {
  return deriveMintPairFeedId(args).toString("hex");
}

export function resolveMintOracleAccounts(
  args: ResolveMintOracleAccountsArgs,
): ResolvedMintOracleAccounts {
  const programId = args.programId
    ? new PublicKey(args.programId.toBytes())
    : freshPublicKey("MIMIR", PublicKey);
  const baseMint = toPublicKey(args.mintAddress, "Mint");
  const quoteMint = requireQuoteMint(args);
  assertDistinctMintPair(baseMint, quoteMint);
  if (args.allowPoolQuoteMint) {
    assertAdmittedMintOraclePoolQuoteMint(quoteMint, args.cluster);
  } else {
    assertAdmittedMintOracleClassicFeedQuoteMint(quoteMint, args.cluster);
  }
  const feedId = args.feedId ? Buffer.from(bytes32(args.feedId, "FeedId")) : deriveMintPairFeedId({
    mintAddress: baseMint,
    quoteMintAddress: quoteMint,
    cluster: args.cluster,
    namespace: args.namespace,
    allowPoolQuoteMint: args.allowPoolQuoteMint,
    variant: args.variant,
  });
  if (args.sourceIndices == null) {
    throw new Error("MissingMintOracleSourceIndices");
  }
  const sourceIndices = args.sourceIndices;
  const ringVersion = args.ringVersion ?? 0;
  const twapVersion = args.twapVersion ?? 0;

  assertUniqueSourceIndices(sourceIndices);

  const [feedReservation] = findFeedReservationPda(feedId, programId);
  const [adminConfig] = findAdminConfigPda(1, programId);
  const [feedCollateralLock] = findFeedCollateralLockPda(feedId, programId);
  const [feedConfig] = findFeedConfigPda(feedId, programId);
  const [feedSnapshot] = findFeedSnapshotPda(feedId, programId);
  const [feedTwap] = findFeedTwapPda(feedId, twapVersion, programId);
  const [sourcingPlan] = findSourcingPlanPda(
    feedId,
    args.planId ?? 1,
    args.planVersion ?? 1,
    programId,
  );

  return {
    programId,
    baseMint,
    quoteMint,
    feedId,
    feedIdHex: feedId.toString("hex"),
    adminConfig,
    feedReservation,
    feedCollateralLock,
    feedConfig,
    feedSnapshot,
    feedTwap,
    sourcingPlan,
    sourceAccounts: sourceIndices.map((sourceIndex) => {
      const [sourceConfig] = findSourceConfigPda(feedId, sourceIndex, programId);
      const [sourceRing] = findSourceRingPda(
        feedId,
        sourceIndex,
        ringVersion,
        programId,
      );
      return {
        sourceIndex,
        sourceConfig,
        sourceRing,
      };
    }),
  };
}

export function sourcePriorityForFamily(
  family: MintOracleSourceFamily,
): MintOracleSourcePriority {
  if (canonicalListIncludes("MINT_ORACLE_PRODUCTION_PRIORITY_SOURCE_FAMILIES", family)) {
    return "production-priority";
  }
  return "adapter-separate";
}

export function sourceFamilyToAdapterType(
  family: MintOracleSourceFamily,
): number {
  switch (family) {
    case "orca-whirlpool":
      return SourceAdapterType.OrcaWhirlpool;
    case "meteora-dlmm":
      return SourceAdapterType.MeteoraDlmm;
    case "meteora-damm-v2":
      return SourceAdapterType.MeteoraDammV2;
    case "raydium-clmm":
      return SourceAdapterType.RaydiumClmm;
    case "raydium-cpmm":
      return SourceAdapterType.RaydiumCpmm;
    case "pumpswap":
      return SourceAdapterType.PumpSwap;
  }
}

export function defaultProgramIdForSourceFamily(
  family: MintOracleSourceFamily,
  cluster: MintOracleCluster,
): PublicKey {
  if (activeMintOraclePolicyCluster(cluster) === "devnet") return new PublicKey(mimirBetaVenueProgram("devnet", family)!);
  switch (family) {
    case "orca-whirlpool":
      return freshPublicKey("ORCA_WHIRLPOOL", PublicKey);
    case "meteora-dlmm":
      return freshPublicKey("METEORA_DLMM", PublicKey);
    case "meteora-damm-v2":
      return freshPublicKey("METEORA_DAMM_V2", PublicKey);
    case "raydium-clmm":
      return freshPublicKey("RAYDIUM_CLMM", PublicKey);
    case "raydium-cpmm":
      return freshPublicKey("RAYDIUM_CPMM", PublicKey);
    case "pumpswap":
      return freshPublicKey("PUMPSWAP", PublicKey);
  }
}

export function adapterMaskForSourceFamilies(
  families: readonly MintOracleSourceFamily[],
): bigint {
  let mask = 0n;
  for (const family of families) {
    mask |= 1n << BigInt(sourceFamilyToAdapterType(family));
  }
  return mask;
}

function readPubkey(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function readU32LE(data: Buffer, offset: number): number {
  return data.readUInt32LE(offset);
}

function readU64LE(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

function readU128LE(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset) | (data.readBigUInt64LE(offset + 8) << 64n);
}

function readI128LE(data: Buffer, offset: number): bigint {
  const value = readU128LE(data, offset);
  return value >= 1n << 127n ? value - (1n << 128n) : value;
}

function readI32LE(data: Buffer, offset: number): number {
  return data.readInt32LE(offset);
}

function readI64LEAsNumber(data: Buffer, offset: number): number {
  return Number(data.readBigInt64LE(offset));
}

function readTokenMint(account: AccountInfo<Buffer> | null): PublicKey | null {
  if (account == null || account.data.length < SPL_TOKEN_ACCOUNT_LEN) return null;
  return readPubkey(account.data, SPL_TOKEN_ACCOUNT_OFFSET_MINT);
}

function readTokenAmount(account: AccountInfo<Buffer> | null): bigint {
  if (account == null || account.data.length < SPL_TOKEN_ACCOUNT_LEN) return 0n;
  return account.data.readBigUInt64LE(SPL_TOKEN_ACCOUNT_OFFSET_AMOUNT);
}

function readTokenOwner(account: AccountInfo<Buffer> | null): PublicKey | null {
  if (account == null || account.data.length < SPL_TOKEN_ACCOUNT_LEN) return null;
  return readPubkey(account.data, SPL_TOKEN_ACCOUNT_OFFSET_OWNER);
}

function isStrictSplTokenVault(
  account: AccountInfo<Buffer> | null,
  mint: PublicKey,
): boolean {
  if (
    account == null ||
    !account.owner.equals(CANONICAL_SPL_TOKEN_PROGRAM_ID) ||
    account.data.length !== SPL_TOKEN_ACCOUNT_LEN
  ) {
    return false;
  }
  const tokenMint = readTokenMint(account);
  const isNativeTag = readU32LE(account.data, SPL_TOKEN_ACCOUNT_OFFSET_IS_NATIVE_TAG);
  return (
    tokenMint != null &&
    tokenMint.equals(mint) &&
    readU32LE(account.data, SPL_TOKEN_ACCOUNT_OFFSET_DELEGATE_TAG) === 0 &&
    (account.data[SPL_TOKEN_ACCOUNT_OFFSET_STATE] === 1 || account.data[SPL_TOKEN_ACCOUNT_OFFSET_STATE] === 2) &&
    (isNativeTag === 0 || (isNativeTag === 1 && mint.equals(SOL_MINT))) &&
    readU64LE(account.data, SPL_TOKEN_ACCOUNT_OFFSET_DELEGATED_AMOUNT) === 0n &&
    readU32LE(account.data, SPL_TOKEN_ACCOUNT_OFFSET_CLOSE_AUTHORITY_TAG) === 0 &&
    readTokenAmount(account) > 0n
  );
}

function isStrictPumpSwapTokenVault(
  account: AccountInfo<Buffer> | null,
  mint: PublicKey,
  tokenProgram: PublicKey,
): boolean {
  const expectedLength = tokenProgram.equals(SPL_TOKEN_2022_PROGRAM_ID)
    ? 170
    : SPL_TOKEN_ACCOUNT_LEN;
  if (
    account == null ||
    account.executable ||
    !account.owner.equals(tokenProgram) ||
    account.data.length !== expectedLength
  ) {
    return false;
  }
  const tokenMint = readTokenMint(account);
  const amount = readTokenAmount(account);
  const isNativeTag = readU32LE(
    account.data,
    SPL_TOKEN_ACCOUNT_OFFSET_IS_NATIVE_TAG,
  );
  const nativeReserve = readU64LE(
    account.data,
    SPL_TOKEN_ACCOUNT_OFFSET_IS_NATIVE_TAG + 4,
  );
  const nativeStateIsValid = isNativeTag === 0
    ? nativeReserve === 0n
    : isNativeTag === 1 &&
      tokenProgram.equals(CANONICAL_SPL_TOKEN_PROGRAM_ID) &&
      mint.equals(SOL_MINT) &&
      nativeReserve > 0n &&
      amount >= nativeReserve;
  return (
    tokenMint != null &&
    tokenMint.equals(mint) &&
    pumpSwapCOptionNone(account.data, SPL_TOKEN_ACCOUNT_OFFSET_DELEGATE_TAG, 32) &&
    account.data[SPL_TOKEN_ACCOUNT_OFFSET_STATE] === 1 &&
    nativeStateIsValid &&
    readU64LE(account.data, SPL_TOKEN_ACCOUNT_OFFSET_DELEGATED_AMOUNT) === 0n &&
    pumpSwapCOptionNone(account.data, SPL_TOKEN_ACCOUNT_OFFSET_CLOSE_AUTHORITY_TAG, 32) &&
    amount > 0n &&
    (!tokenProgram.equals(SPL_TOKEN_2022_PROGRAM_ID) ||
      (account.data[165] === 2 &&
        account.data.readUInt16LE(166) === 7 &&
        account.data.readUInt16LE(168) === 0))
  );
}

function decodePumpSwapVaultEvidence(
  baseInfo: AccountInfo<Buffer> | null,
  quoteInfo: AccountInfo<Buffer> | null,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  baseTokenProgram: PublicKey,
  pool: PublicKey,
): ReturnType<typeof decodeVaultEvidence> {
  if (
    !isStrictPumpSwapTokenVault(baseInfo, baseMint, baseTokenProgram) ||
    !isStrictPumpSwapTokenVault(quoteInfo, quoteMint, CANONICAL_SPL_TOKEN_PROGRAM_ID)
  ) {
    return null;
  }
  const baseOwner = readTokenOwner(baseInfo);
  const quoteOwner = readTokenOwner(quoteInfo);
  if (baseOwner == null || !baseOwner.equals(pool) || !quoteOwner?.equals(pool)) {
    return null;
  }
  return {
    baseAmount: readTokenAmount(baseInfo),
    quoteAmount: readTokenAmount(quoteInfo),
    vaultAuthority: pool,
  };
}

interface MintOracleVaultEvidence {
  baseAmount: bigint;
  quoteAmount: bigint;
  vaultAuthority: PublicKey | null;
  adapterVersion?: 0 | 1;
  token2022Mint?: PublicKey | null;
  baseDecimals?: number;
  quoteDecimals?: number;
  conditions?: number;
}

function decodeVaultEvidence(
  baseInfo: AccountInfo<Buffer> | null,
  quoteInfo: AccountInfo<Buffer> | null,
  baseMint: PublicKey,
  quoteMint: PublicKey,
): MintOracleVaultEvidence | null {
  if (
    !isStrictSplTokenVault(baseInfo, baseMint) ||
    !isStrictSplTokenVault(quoteInfo, quoteMint)
  ) {
    return null;
  }
  const baseOwner = readTokenOwner(baseInfo);
  const quoteOwner = readTokenOwner(quoteInfo);
  if (baseOwner == null || quoteOwner == null || !baseOwner.equals(quoteOwner)) {
    return null;
  }
  return {
    baseAmount: readTokenAmount(baseInfo),
    quoteAmount: readTokenAmount(quoteInfo),
    vaultAuthority: baseOwner,
    adapterVersion: 0,
    token2022Mint: null,
    conditions: baseInfo!.data[SPL_TOKEN_ACCOUNT_OFFSET_STATE] === 2 || quoteInfo!.data[SPL_TOKEN_ACCOUNT_OFFSET_STATE] === 2 ? MIMIR_COND.VAULT_FROZEN : 0,
  };
}

function decodeRaydiumClmmVaultEvidence(
  mintBaseInfo: AccountInfo<Buffer> | null,
  mintQuoteInfo: AccountInfo<Buffer> | null,
  baseInfo: AccountInfo<Buffer> | null,
  quoteInfo: AccountInfo<Buffer> | null,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  baseVault: PublicKey,
  quoteVault: PublicKey,
  baseDecimals: number,
  quoteDecimals: number,
  authority: PublicKey,
): MintOracleVaultEvidence | null {
  if (!mintBaseInfo || !mintQuoteInfo || !baseInfo || !quoteInfo) return null;
  try {
    const baseMintAddress = address(baseMint.toBase58());
    const quoteMintAddress = address(quoteMint.toBase58());
    const baseVaultAddress = address(baseVault.toBase58());
    const quoteVaultAddress = address(quoteVault.toBase58());
    const authorityAddress = address(authority.toBase58());
    const classification = classifyToken2022ClmmPair({
      baseMint: baseMintAddress,
      quoteMint: quoteMintAddress,
      baseMintAccount: { address: baseMintAddress, owner: address(mintBaseInfo.owner.toBase58()), executable: mintBaseInfo.executable, data: Uint8Array.from(mintBaseInfo.data) },
      quoteMintAccount: { address: quoteMintAddress, owner: address(mintQuoteInfo.owner.toBase58()), executable: mintQuoteInfo.executable, data: Uint8Array.from(mintQuoteInfo.data) },
      baseVaultAccount: { address: baseVaultAddress, owner: address(baseInfo.owner.toBase58()), executable: baseInfo.executable, data: Uint8Array.from(baseInfo.data) },
      quoteVaultAccount: { address: quoteVaultAddress, owner: address(quoteInfo.owner.toBase58()), executable: quoteInfo.executable, data: Uint8Array.from(quoteInfo.data) },
      authority: authorityAddress,
      baseDecimals,
      quoteDecimals,
    });
    return {
      baseAmount: classification.baseAmount,
      quoteAmount: classification.quoteAmount,
      vaultAuthority: authority,
      adapterVersion: classification.adapterVersion,
      token2022Mint: classification.token2022Mint ? new PublicKey(classification.token2022Mint) : null,
      baseDecimals: classification.baseDecimals,
      quoteDecimals: classification.quoteDecimals,
      conditions: classification.conditions,
    };
  } catch (error) {
    if (isToken2022ClmmAccountError(error) || isToken2022ClmmPolicyError(error)) return null;
    throw error;
  }
}

function decodeMeteoraDlmmVaultEvidence(
  mintBaseInfo: AccountInfo<Buffer> | null,
  mintQuoteInfo: AccountInfo<Buffer> | null,
  baseInfo: AccountInfo<Buffer> | null,
  quoteInfo: AccountInfo<Buffer> | null,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  baseVault: PublicKey,
  quoteVault: PublicKey,
  authority: PublicKey,
  expectedToken2022Mint?: PublicKeyInput,
  expectedBaseDecimals?: number,
  expectedQuoteDecimals?: number,
): MintOracleVaultEvidence | null {
  if (!mintBaseInfo || !mintQuoteInfo || !baseInfo || !quoteInfo) return null;
  const baseIsToken2022 = mintBaseInfo.owner.equals(SPL_TOKEN_2022_PROGRAM_ID);
  const quoteIsToken2022 = mintQuoteInfo.owner.equals(SPL_TOKEN_2022_PROGRAM_ID);
  if (baseIsToken2022 === quoteIsToken2022) return null;
  const selectedMint = baseIsToken2022 ? baseMint : quoteMint;
  const expectedMint = expectedToken2022Mint === undefined
    ? selectedMint : toPublicKey(expectedToken2022Mint, "Token2022Mint");
  if (!selectedMint.equals(expectedMint)) return null;
  const selectedMintInfo = baseIsToken2022 ? mintBaseInfo : mintQuoteInfo;
  const baseDecimals = expectedBaseDecimals ?? mintBaseInfo.data[SPL_MINT_OFFSET_DECIMALS]!;
  const quoteDecimals = expectedQuoteDecimals ?? mintQuoteInfo.data[SPL_MINT_OFFSET_DECIMALS]!;
  const asToken2022Account = (key: PublicKey, info: AccountInfo<Buffer>): Token2022ClmmAccount => ({
    address: address(key.toBase58()),
    owner: address(info.owner.toBase58()),
    executable: info.executable,
    data: Uint8Array.from(info.data),
  });
  if (selectedMintInfo.data.length <= 82) return null;
  try {
    const selectedMintAddress = address(selectedMint.toBase58());
    const classification = classifyToken2022ClmmPair({
      baseMint: address(baseMint.toBase58()),
      quoteMint: address(quoteMint.toBase58()),
      baseMintAccount: asToken2022Account(baseMint, mintBaseInfo),
      quoteMintAccount: asToken2022Account(quoteMint, mintQuoteInfo),
      baseVaultAccount: asToken2022Account(baseVault, baseInfo),
      quoteVaultAccount: asToken2022Account(quoteVault, quoteInfo),
      authority: address(authority.toBase58()),
      baseDecimals,
      quoteDecimals,
    });
    if (classification.adapterVersion !== 1 || classification.token2022Mint !== selectedMintAddress) return null;
    return {
      baseAmount: classification.baseAmount,
      quoteAmount: classification.quoteAmount,
      vaultAuthority: authority,
      adapterVersion: 1,
      token2022Mint: new PublicKey(classification.token2022Mint),
      baseDecimals: classification.baseDecimals,
      quoteDecimals: classification.quoteDecimals,
      conditions: classification.conditions,
    };
  } catch (error) {
    if (isToken2022ClmmAccountError(error) || isToken2022ClmmPolicyError(error)) return null;
    throw error;
  }
}

async function fetchVaultEvidenceBatch(
  connection: Pick<Connection, "getMultipleAccountsInfo">,
  vaults: readonly {
    baseVault: PublicKey;
    quoteVault: PublicKey;
    family?: MintOracleSourceFamily;
    baseDecimals?: number;
    quoteDecimals?: number;
    pool?: MintOracleDiscoveredPool;
    poolOrMarket?: PublicKey;
  }[],
  baseMint: PublicKey,
  quoteMint: PublicKey,
  pumpSwapBaseTokenProgram?: PublicKey,
): Promise<readonly ReturnType<typeof decodeVaultEvidence>[]> {
  if (vaults.length === 0) return [];
  const [infos, mintInfos] = await Promise.all([
    getMultipleAccountsInfoChunked(connection, vaults.flatMap((vault) => [vault.baseVault, vault.quoteVault])),
    vaults.some((vault) => {
      const family = vault.pool?.family ?? vault.family;
      return family === "raydium-clmm" || family === "meteora-dlmm";
    })
      ? connection.getMultipleAccountsInfo([baseMint, quoteMint])
      : Promise.resolve(null),
  ]);
  return vaults.map((vault, index) =>
    (vault.pool?.family ?? vault.family) === "raydium-clmm"
      ? decodeRaydiumClmmVaultEvidence(
          mintInfos?.[0] ?? null,
          mintInfos?.[1] ?? null,
          infos[index * 2] ?? null,
          infos[index * 2 + 1] ?? null,
          baseMint,
          quoteMint,
          vault.baseVault,
          vault.quoteVault,
          vault.pool?.baseDecimals ?? vault.baseDecimals ?? (mintInfos?.[0]?.data[SPL_MINT_OFFSET_DECIMALS] ?? 0),
          vault.pool?.quoteDecimals ?? vault.quoteDecimals ?? (mintInfos?.[1]?.data[SPL_MINT_OFFSET_DECIMALS] ?? 0),
          vault.poolOrMarket ?? toPublicKey(vault.pool?.poolOrMarket ?? (vault as { poolOrMarket: PublicKey }).poolOrMarket, "PoolOrMarket"),
        )
      : (vault.pool?.family ?? vault.family) === "meteora-dlmm" &&
          (mintInfos?.[0]?.owner.equals(SPL_TOKEN_2022_PROGRAM_ID) || mintInfos?.[1]?.owner.equals(SPL_TOKEN_2022_PROGRAM_ID))
      ? decodeMeteoraDlmmVaultEvidence(
          mintInfos?.[0] ?? null,
          mintInfos?.[1] ?? null,
          infos[index * 2] ?? null,
          infos[index * 2 + 1] ?? null,
          baseMint,
          quoteMint,
          vault.baseVault,
          vault.quoteVault,
          vault.poolOrMarket ?? toPublicKey(vault.pool?.vaultAuthority ?? vault.pool?.poolOrMarket ?? (vault as { poolOrMarket: PublicKey }).poolOrMarket, "PoolOrMarket"),
          vault.pool?.token2022Mint,
          vault.pool?.baseDecimals ?? vault.baseDecimals,
          vault.pool?.quoteDecimals ?? vault.quoteDecimals,
        )
      : (vault.pool?.family ?? vault.family) === "pumpswap"
      ? decodePumpSwapVaultEvidence(
          infos[index * 2] ?? null,
          infos[index * 2 + 1] ?? null,
          baseMint,
          quoteMint,
          pumpSwapBaseTokenProgram ?? CANONICAL_SPL_TOKEN_PROGRAM_ID,
          vault.poolOrMarket ?? toPublicKey(vault.pool?.poolOrMarket ?? (vault as { poolOrMarket: PublicKey }).poolOrMarket, "PoolOrMarket"),
        )
      : decodeVaultEvidence(
          infos[index * 2] ?? null,
          infos[index * 2 + 1] ?? null,
          baseMint,
          quoteMint,
        ),
  );
}

function decodeSplMintDecimals(
  account: AccountInfo<Buffer> | null,
): number | null {
  if (
    account == null ||
    !account.owner.equals(CANONICAL_SPL_TOKEN_PROGRAM_ID) ||
    account.data.length !== SPL_MINT_ACCOUNT_LEN ||
    account.data[SPL_MINT_OFFSET_IS_INITIALIZED] !== 1
  ) {
    return null;
  }
  const decimals = account.data[SPL_MINT_OFFSET_DECIMALS];
  return decimals <= 18 ? decimals : null;
}

async function fetchMintPairDecimals(
  connection: Pick<Connection, "getMultipleAccountsInfo">,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  allowToken2022 = false,
): Promise<{ baseDecimals: number; quoteDecimals: number }> {
  const [baseInfo, quoteInfo] = await connection.getMultipleAccountsInfo([
    baseMint,
    quoteMint,
  ]);
  const decode = (account: AccountInfo<Buffer> | null, mint: PublicKey): number | null => {
    const classic = decodeSplMintDecimals(account);
    if (classic !== null) return classic;
    if (!allowToken2022 || account == null || !account.owner.equals(SPL_TOKEN_2022_PROGRAM_ID) || account.data.length < SPL_MINT_ACCOUNT_LEN) return null;
    const decimals = account.data[SPL_MINT_OFFSET_DECIMALS]!;
    return decimals;
  };
  const baseDecimals = decode(baseInfo, baseMint);
  const quoteDecimals = decode(quoteInfo, quoteMint);
  if (baseDecimals == null || quoteDecimals == null) {
    throw new Error("UnverifiedMintOracleMintMetadata");
  }
  return { baseDecimals, quoteDecimals };
}

async function fetchPumpSwapMintPairMetadata(
  connection: Pick<Connection, "getMultipleAccountsInfo">,
  baseMint: PublicKey,
  quoteMint: PublicKey,
): Promise<{ baseDecimals: number; quoteDecimals: number; baseTokenProgram: PublicKey }> {
  if (!quoteMint.equals(SOL_MINT)) throw new Error("UnsupportedPumpSwapQuoteMint");
  const [baseInfo, quoteInfo] = await connection.getMultipleAccountsInfo([
    baseMint,
    quoteMint,
  ]);
  const baseTokenProgram = baseInfo?.owner;
  if (
    baseInfo == null ||
    baseInfo.executable ||
    baseTokenProgram == null ||
    (!baseTokenProgram.equals(CANONICAL_SPL_TOKEN_PROGRAM_ID) &&
      !baseTokenProgram.equals(SPL_TOKEN_2022_PROGRAM_ID)) ||
    !isStrictPumpSwapBaseMint(baseInfo.data, baseMint, baseTokenProgram) ||
    quoteInfo == null ||
    quoteInfo.executable ||
    !quoteInfo.owner.equals(CANONICAL_SPL_TOKEN_PROGRAM_ID) ||
    quoteInfo.data.length !== SPL_MINT_ACCOUNT_LEN ||
    quoteInfo.data[SPL_MINT_OFFSET_DECIMALS] !== 9 ||
    quoteInfo.data[SPL_MINT_OFFSET_IS_INITIALIZED] !== 1 ||
    !pumpSwapCOptionNone(quoteInfo.data, 0, 32) ||
    !pumpSwapCOptionNone(quoteInfo.data, 46, 32)
  ) {
    throw new Error("UnverifiedMintOracleMintMetadata");
  }
  const baseDecimals = baseInfo.data[SPL_MINT_OFFSET_DECIMALS]!;
  const quoteDecimals = quoteInfo.data[SPL_MINT_OFFSET_DECIMALS]!;
  return { baseDecimals, quoteDecimals, baseTokenProgram };
}

function pumpSwapCOptionNone(
  data: Buffer,
  offset: number,
  valueLength: number,
): boolean {
  const end = offset + 4 + valueLength;
  return end <= data.length && data.subarray(offset, end).every((byte) => byte === 0);
}

function readPumpSwapTlv(
  data: Buffer,
  cursor: number,
): { type: number; value: Buffer; next: number } | null {
  if (cursor + 4 > data.length) return null;
  const length = data.readUInt16LE(cursor + 2);
  const next = cursor + 4 + length;
  return next <= data.length
    ? { type: data.readUInt16LE(cursor), value: data.subarray(cursor + 4, next), next }
    : null;
}

function isStrictPumpSwapTokenMetadata(data: Buffer, mint: PublicKey): boolean {
  if (
    data.length < 80 ||
    data.length > 512 ||
    data.subarray(0, 32).some((byte) => byte !== 0) ||
    !data.subarray(32, 64).equals(mint.toBuffer())
  ) {
    return false;
  }
  let cursor = 64;
  try {
    for (let index = 0; index < 3; index += 1) {
      if (cursor + 4 > data.length) return false;
      const length = data.readUInt32LE(cursor);
      cursor += 4;
      const end = cursor + length;
      if (end > data.length) return false;
      new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(cursor, end));
      cursor = end;
    }
  } catch {
    return false;
  }
  return cursor + 4 === data.length && data.readUInt32LE(cursor) === 0;
}

function isStrictPumpSwapBaseMint(
  data: Buffer,
  mint: PublicKey,
  tokenProgram: PublicKey,
): boolean {
  if (
    data.length < SPL_MINT_ACCOUNT_LEN ||
    data[SPL_MINT_OFFSET_DECIMALS]! < 6 ||
    data[SPL_MINT_OFFSET_DECIMALS]! > 9 ||
    data[SPL_MINT_OFFSET_IS_INITIALIZED] !== 1 ||
    readU64LE(data, SPL_MINT_OFFSET_SUPPLY) === 0n ||
    !pumpSwapCOptionNone(data, 0, 32) ||
    !pumpSwapCOptionNone(data, 46, 32)
  ) {
    return false;
  }
  if (data.length === SPL_MINT_ACCOUNT_LEN) return true;
  if (
    !tokenProgram.equals(SPL_TOKEN_2022_PROGRAM_ID) ||
    data.length < 318 ||
    data.length > 750 ||
    data.subarray(82, 165).some((byte) => byte !== 0) ||
    data[165] !== 1
  ) {
    return false;
  }
  const extensions = data.subarray(166);
  const pointer = readPumpSwapTlv(extensions, 0);
  if (
    pointer == null ||
    pointer.type !== 18 ||
    pointer.value.length !== 64 ||
    pointer.value.subarray(0, 32).some((byte) => byte !== 0) ||
    !pointer.value.subarray(32).equals(mint.toBuffer())
  ) {
    return false;
  }
  const metadata = readPumpSwapTlv(extensions, pointer.next);
  return metadata != null &&
    metadata.type === 19 &&
    metadata.next === extensions.length &&
    isStrictPumpSwapTokenMetadata(metadata.value, mint);
}

function pumpSwapPoolDataIsEligible(data: Buffer): boolean {
  const tailStart = PUMPSWAP_POOL_OFFSET_VIRTUAL_QUOTE_RESERVES + 16;
  return (
    PUMPSWAP_POOL_ACCOUNT_LENS.includes(data.length as 300 | 301 | 287) &&
    data.subarray(0, PUMPSWAP_POOL_DISCRIMINATOR.length).equals(
      PUMPSWAP_POOL_DISCRIMINATOR,
    ) &&
    readU64LE(data, PUMPSWAP_POOL_OFFSET_LP_SUPPLY) > 0n &&
    data[PUMPSWAP_POOL_OFFSET_MAYHEM_MODE] === 0 &&
    data[PUMPSWAP_POOL_OFFSET_CASHBACK] === 0 &&
    data.subarray(tailStart, PUMPSWAP_POOL_OFFSET_PENDING_PROTOCOL_FEES).every((byte) => byte === 0) &&
    data.subarray(PUMPSWAP_POOL_OFFSET_PENDING_CREATOR_FEES + 8).every((byte) => byte === 0)
  );
}

function pumpSwapPoolAddressIsCanonical(data: Buffer, pool: PublicKey): boolean {
  const [expectedPool, bump] = PublicKey.findProgramAddressSync([
    Buffer.from("pool"),
    data.subarray(PUMPSWAP_POOL_OFFSET_INDEX, PUMPSWAP_POOL_OFFSET_INDEX + 2),
    data.subarray(PUMPSWAP_POOL_OFFSET_CREATOR, PUMPSWAP_POOL_OFFSET_CREATOR + 32),
    data.subarray(PUMPSWAP_POOL_OFFSET_BASE_MINT, PUMPSWAP_POOL_OFFSET_BASE_MINT + 32),
    data.subarray(PUMPSWAP_POOL_OFFSET_QUOTE_MINT, PUMPSWAP_POOL_OFFSET_QUOTE_MINT + 32),
  ], PUMPSWAP_PROGRAM_ID);
  const [expectedLpMint] = PublicKey.findProgramAddressSync([
    Buffer.from("pool_lp_mint"),
    pool.toBuffer(),
  ], PUMPSWAP_PROGRAM_ID);
  return pool.equals(expectedPool) &&
    data[PUMPSWAP_POOL_OFFSET_BUMP] === bump &&
    readPubkey(data, PUMPSWAP_POOL_OFFSET_LP_MINT).equals(expectedLpMint);
}

function orderedVaults(args: {
  data: Buffer;
  mintAOffset: number;
  mintBOffset: number;
  vaultAOffset: number;
  vaultBOffset: number;
  baseMint: PublicKey;
  quoteMint: PublicKey;
}): { baseVault: PublicKey; quoteVault: PublicKey } | null {
  const mintA = readPubkey(args.data, args.mintAOffset);
  const mintB = readPubkey(args.data, args.mintBOffset);
  const vaultA = readPubkey(args.data, args.vaultAOffset);
  const vaultB = readPubkey(args.data, args.vaultBOffset);
  if (mintA.equals(args.baseMint) && mintB.equals(args.quoteMint)) {
    return { baseVault: vaultA, quoteVault: vaultB };
  }
  if (mintA.equals(args.quoteMint) && mintB.equals(args.baseMint)) {
    return { baseVault: vaultB, quoteVault: vaultA };
  }
  return null;
}

function minVaultLiquidityNative(baseAmount: bigint, quoteAmount: bigint): bigint {
  return baseAmount < quoteAmount ? baseAmount : quoteAmount;
}

function depthTo50BpsNativeFromLiquidity(liquidity: bigint): bigint {
  const depth = liquidity / 200n;
  return depth > 0n ? depth : 1n;
}

function meteoraVisibleDepthTo50BpsNative(args: {
  pairData: Buffer;
  activeBinArrayData: Buffer;
}): bigint {
  if (
    args.activeBinArrayData.length < METEORA_DLMM_BIN_ARRAY_LEN ||
    args.pairData.length < METEORA_DLMM_LB_PAIR_LEN
  ) {
    return 0n;
  }
  const activeId = readI32LE(args.pairData, METEORA_DLMM_LB_PAIR_OFFSET_ACTIVE_ID);
  const binStep = args.pairData.readUInt16LE(METEORA_DLMM_LB_PAIR_OFFSET_BIN_STEP);
  if (binStep === 0 || binStep > METEORA_DLMM_MAX_BIN_STEP) return 0n;
  const arrayIndex = readI64LEAsNumber(
    args.activeBinArrayData,
    METEORA_DLMM_BIN_ARRAY_OFFSET_INDEX,
  );
  const lowerBinId = arrayIndex * METEORA_DLMM_MAX_BIN_PER_ARRAY;
  const activeBinIndex = activeId - lowerBinId;
  if (
    activeBinIndex < 0 ||
    activeBinIndex >= METEORA_DLMM_MAX_BIN_PER_ARRAY
  ) {
    return 0n;
  }
  const targetBins = Math.ceil(50 / binStep);
  const lower = Math.max(0, activeBinIndex - targetBins);
  const upper = Math.min(
    activeBinIndex + targetBins,
    METEORA_DLMM_MAX_BIN_PER_ARRAY - 1,
  );
  let lowerSideQuoteDepth = 0n;
  for (let index = lower; index <= activeBinIndex; index += 1) {
    const binOffset =
      METEORA_DLMM_BIN_ARRAY_OFFSET_BINS + index * METEORA_DLMM_BIN_ARRAY_BIN_LEN;
    lowerSideQuoteDepth += readU64LE(
      args.activeBinArrayData,
      binOffset + METEORA_DLMM_BIN_OFFSET_AMOUNT_Y,
    );
  }
  let upperSideBaseDepth = 0n;
  for (let index = activeBinIndex; index <= upper; index += 1) {
    const binOffset =
      METEORA_DLMM_BIN_ARRAY_OFFSET_BINS + index * METEORA_DLMM_BIN_ARRAY_BIN_LEN;
    upperSideBaseDepth += readU64LE(
      args.activeBinArrayData,
      binOffset + METEORA_DLMM_BIN_OFFSET_AMOUNT_X,
    );
  }
  return lowerSideQuoteDepth < upperSideBaseDepth
    ? lowerSideQuoteDepth
    : upperSideBaseDepth;
}

function ceilDivBigInt(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("InvalidDenominator");
  return (numerator + denominator - 1n) / denominator;
}

function cpAmmBaseDeltaForRange(
  sqrtPriceA: bigint,
  sqrtPriceB: bigint,
  liquidityX64: bigint,
): bigint {
  if (liquidityX64 <= 0n || sqrtPriceA <= 0n || sqrtPriceB <= 0n) return 0n;
  const lower = sqrtPriceA < sqrtPriceB ? sqrtPriceA : sqrtPriceB;
  const upper = sqrtPriceA < sqrtPriceB ? sqrtPriceB : sqrtPriceA;
  if (lower === upper) return 0n;
  return ceilDivBigInt(liquidityX64 * (upper - lower), lower * upper);
}

function cpAmmQuoteDeltaForRange(
  sqrtPriceA: bigint,
  sqrtPriceB: bigint,
  liquidityX64: bigint,
): bigint {
  if (liquidityX64 <= 0n || sqrtPriceA <= 0n || sqrtPriceB <= 0n) return 0n;
  const lower = sqrtPriceA < sqrtPriceB ? sqrtPriceA : sqrtPriceB;
  const upper = sqrtPriceA < sqrtPriceB ? sqrtPriceB : sqrtPriceA;
  if (lower === upper) return 0n;
  return ceilDivBigInt(liquidityX64 * (upper - lower), Q64 * Q64);
}

function meteoraDammV2DepthTo50BpsNative(args: {
  poolData: Buffer;
  tokenAIsBase: boolean;
}): bigint {
  if (args.poolData.length < METEORA_DAMM_V2_POOL_LEN) return 0n;
  const liquidityX64 = readU128LE(args.poolData, METEORA_DAMM_V2_POOL_OFFSET_LIQUIDITY);
  const sqrtPrice = readU128LE(args.poolData, METEORA_DAMM_V2_POOL_OFFSET_SQRT_PRICE);
  const sqrtMinPrice = readU128LE(
    args.poolData,
    METEORA_DAMM_V2_POOL_OFFSET_SQRT_MIN_PRICE,
  );
  const sqrtMaxPrice = readU128LE(
    args.poolData,
    METEORA_DAMM_V2_POOL_OFFSET_SQRT_MAX_PRICE,
  );
  if (
    liquidityX64 <= 0n ||
    sqrtPrice <= 0n ||
    sqrtMinPrice <= 0n ||
    sqrtMaxPrice <= sqrtMinPrice ||
    sqrtPrice < sqrtMinPrice ||
    sqrtPrice > sqrtMaxPrice
  ) {
    return 0n;
  }
  const targetDown = (sqrtPrice * METEORA_DAMM_V2_SQRT_DOWN_50_BPS_X64) / Q64;
  const targetUp = ceilDivBigInt(
    sqrtPrice * METEORA_DAMM_V2_SQRT_UP_50_BPS_X64,
    Q64,
  );
  const lowerSqrtPrice =
    targetDown < sqrtMinPrice ? sqrtMinPrice : targetDown;
  const upperSqrtPrice =
    targetUp > sqrtMaxPrice ? sqrtMaxPrice : targetUp;
  const amountAForPriceDown = cpAmmBaseDeltaForRange(
    lowerSqrtPrice,
    sqrtPrice,
    liquidityX64,
  );
  const amountBForPriceUp = cpAmmQuoteDeltaForRange(
    sqrtPrice,
    upperSqrtPrice,
    liquidityX64,
  );
  const rawPriceX64 = squareQ64ToX64(sqrtPrice);
  const priceUpQuote = args.tokenAIsBase
    ? amountBForPriceUp
    : amountAForPriceDown;
  const priceDownQuote = args.tokenAIsBase
    ? (amountAForPriceDown * rawPriceX64) / Q64
    : (amountBForPriceUp * Q64) / rawPriceX64;
  const depth = priceUpQuote < priceDownQuote ? priceUpQuote : priceDownQuote;
  return depth > 0n ? depth : 0n;
}

async function preciseMintOraclePoolLiquidityEvidence(args: {
  connection: Pick<Connection, "getMultipleAccountsInfo">;
  pool: MintOracleDiscoveredPool;
  poolInfoData: Buffer;
  activeBinArrayInfo?: AccountInfo<Buffer> | null;
  baseAmount: bigint;
  quoteAmount: bigint;
}): Promise<{
  minLiquidityNative: bigint;
  minDepthTo50BpsNative: bigint;
}> {
  if (args.pool.family === "pumpswap") {
    const quoteAmount = args.quoteAmount -
      readU64LE(args.poolInfoData, PUMPSWAP_POOL_OFFSET_PENDING_PROTOCOL_FEES) -
      readU64LE(args.poolInfoData, PUMPSWAP_POOL_OFFSET_PENDING_CREATOR_FEES);
    if (quoteAmount <= 0n) return { minLiquidityNative: 0n, minDepthTo50BpsNative: 0n };
    args = { ...args, quoteAmount };
  }
  const reserveLiquidity = minVaultLiquidityNative(args.baseAmount, args.quoteAmount);
  if (args.pool.family === "meteora-damm-v2") {
    const baseVault = toPublicKey(args.pool.baseVault, "BaseVault");
    const quoteVault = toPublicKey(args.pool.quoteVault, "QuoteVault");
    const tokenAIsBase =
      readPubkey(args.poolInfoData, METEORA_DAMM_V2_POOL_OFFSET_TOKEN_A_VAULT).equals(
        baseVault,
      ) &&
      readPubkey(args.poolInfoData, METEORA_DAMM_V2_POOL_OFFSET_TOKEN_B_VAULT).equals(
        quoteVault,
      );
    const tokenBIsBase =
      readPubkey(args.poolInfoData, METEORA_DAMM_V2_POOL_OFFSET_TOKEN_B_VAULT).equals(
        baseVault,
      ) &&
      readPubkey(args.poolInfoData, METEORA_DAMM_V2_POOL_OFFSET_TOKEN_A_VAULT).equals(
        quoteVault,
      );
    if (!tokenAIsBase && !tokenBIsBase) {
      return { minLiquidityNative: 0n, minDepthTo50BpsNative: 0n };
    }
    const depth = meteoraDammV2DepthTo50BpsNative({
      poolData: args.poolInfoData,
      tokenAIsBase,
    });
    return {
      minLiquidityNative: depth < reserveLiquidity ? depth : reserveLiquidity,
      minDepthTo50BpsNative: depth,
    };
  }
  if (
    args.pool.family !== "meteora-dlmm" ||
    args.pool.activeBinArray == null
  ) {
    const minDepthTo50BpsNative = discoveredPoolMinDepthTo50BpsNative({
      family: args.pool.family,
      baseAmount: args.baseAmount,
      quoteAmount: args.quoteAmount,
    });
    return {
      minLiquidityNative: reserveLiquidity,
      minDepthTo50BpsNative,
    };
  }
  const activeBinArrayInfo =
    args.activeBinArrayInfo === undefined
      ? (await args.connection.getMultipleAccountsInfo([
          toPublicKey(args.pool.activeBinArray, "ActiveBinArray"),
        ]))[0] ?? null
      : args.activeBinArrayInfo;
  const visibleDepth =
    activeBinArrayInfo == null
      ? 0n
      : meteoraVisibleDepthTo50BpsNative({
          pairData: args.poolInfoData,
          activeBinArrayData: activeBinArrayInfo.data,
        });
  return {
    minLiquidityNative:
      visibleDepth < reserveLiquidity ? visibleDepth : reserveLiquidity,
    minDepthTo50BpsNative: visibleDepth,
  };
}

function discoveredPoolMinDepthTo50BpsNative(args: {
  family: MintOracleSourceFamily;
  baseAmount: bigint;
  quoteAmount: bigint;
}): bigint {
  if (args.family === "raydium-cpmm" || args.family === "pumpswap") {
    return cpmmZeroFeeImmediateUnwindBounds(
      args.baseAmount,
      args.quoteAmount,
      50,
    ).capitalRequiredFloor;
  }
  return depthTo50BpsNativeFromLiquidity(
    minVaultLiquidityNative(args.baseAmount, args.quoteAmount),
  );
}

function i64Le(value: number): Buffer {
  if (!Number.isSafeInteger(value)) {
    throw new Error("InvalidMeteoraDlmmBinArrayIndex");
  }
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(BigInt(value), 0);
  return out;
}

function meteoraBinArrayIndexForActiveId(activeId: number): number {
  if (!Number.isSafeInteger(activeId)) {
    throw new Error("InvalidMeteoraDlmmActiveId");
  }
  return Math.floor(activeId / METEORA_DLMM_MAX_BIN_PER_ARRAY);
}

function findMeteoraDlmmBinArrayPda(
  lbPair: PublicKey,
  binArrayIndex: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [METEORA_DLMM_BIN_ARRAY_SEED, lbPair.toBuffer(), i64Le(binArrayIndex)],
    METEORA_DLMM_PROGRAM_ID,
  );
}

function validateMeteoraBinArrayAccount(
  account: AccountInfo<Buffer> | null,
  lbPair: PublicKey,
  binArrayIndex: number,
): boolean {
  if (
    account == null ||
    !account.owner.equals(METEORA_DLMM_PROGRAM_ID) ||
    account.data.length !== METEORA_DLMM_BIN_ARRAY_LEN
  ) {
    return false;
  }
  const accountIndex = account.data.readBigInt64LE(
    METEORA_DLMM_BIN_ARRAY_OFFSET_INDEX,
  );
  return (
    accountIndex === BigInt(binArrayIndex) &&
    readPubkey(account.data, METEORA_DLMM_BIN_ARRAY_OFFSET_LB_PAIR).equals(lbPair)
  );
}

async function findMeteoraActiveBinArray(
  connection: RpcMintOraclePoolDiscoveryProviderConfig["connection"],
  lbPair: PublicKey,
  activeId: number,
): Promise<{ pubkey: PublicKey; account: AccountInfo<Buffer> } | null> {
  const targetIndex = meteoraBinArrayIndexForActiveId(activeId);
  const [binArray] = findMeteoraDlmmBinArrayPda(lbPair, targetIndex);
  const account = await connection.getAccountInfo(binArray);
  return validateMeteoraBinArrayAccount(account, lbPair, targetIndex)
    ? { pubkey: binArray, account: account! }
    : null;
}

type MintOraclePoolCandidate = {
  family: MintOracleSourceFamily;
  poolOrMarket: PublicKey;
  poolInfoData: Buffer;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  programId: PublicKey;
  ammConfig?: PublicKey;
  whirlpoolsConfig?: PublicKey;
  activeBinArray?: PublicKey;
  activeBinArrayInfo?: AccountInfo<Buffer>;
  liquidityNative?: bigint;
};

async function hydrateMintOraclePoolCandidates(args: {
  connection: Pick<Connection, "getMultipleAccountsInfo">;
  candidates: readonly MintOraclePoolCandidate[];
  baseMint: PublicKey;
  quoteMint: PublicKey;
  cluster: MintOracleCluster;
}): Promise<MintOracleDiscoveredPool[]> {
  if (args.candidates.length === 0) return [];
  const meteoraCandidates = args.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        candidate.family === "meteora-dlmm" &&
        candidate.activeBinArrayInfo == null,
    );
  const [vaultEvidences, activeBinArrayInfos] = await Promise.all([
    fetchVaultEvidenceBatch(
      args.connection,
      args.candidates,
      args.baseMint,
      args.quoteMint,
    ),
    meteoraCandidates.length === 0
      ? Promise.resolve([])
      : getMultipleAccountsInfoChunked(args.connection,
          meteoraCandidates.map(({ candidate }) =>
            toPublicKey(candidate.activeBinArray!, "ActiveBinArray"),
          ),
        ),
  ]);
  const activeBinArrayInfoByCandidate = new Map<number, AccountInfo<Buffer> | null>();
  for (let index = 0; index < args.candidates.length; index += 1) {
    const activeBinArrayInfo = args.candidates[index]!.activeBinArrayInfo;
    if (activeBinArrayInfo) activeBinArrayInfoByCandidate.set(index, activeBinArrayInfo);
  }
  for (let index = 0; index < meteoraCandidates.length; index += 1) {
    activeBinArrayInfoByCandidate.set(
      meteoraCandidates[index]!.index,
      activeBinArrayInfos[index] ?? null,
    );
  }
  const out: MintOracleDiscoveredPool[] = [];
  for (let index = 0; index < args.candidates.length; index += 1) {
    const candidate = args.candidates[index]!;
    const vaults = vaultEvidences[index];
    if (vaults == null || vaults.vaultAuthority == null) continue;
    const activeBinArrayInfo = activeBinArrayInfoByCandidate.get(index) ?? null;
    if (candidate.family === "meteora-dlmm") {
      const binArrayIndex = meteoraBinArrayIndexForActiveId(
        candidate.poolInfoData.readInt32LE(METEORA_DLMM_LB_PAIR_OFFSET_ACTIVE_ID),
      );
      if (
        !validateMeteoraBinArrayAccount(
          activeBinArrayInfo,
          candidate.poolOrMarket,
          binArrayIndex,
        )
      ) {
        continue;
      }
    }
    const {
      minLiquidityNative,
      minDepthTo50BpsNative,
    } = await preciseMintOraclePoolLiquidityEvidence({
      connection: args.connection,
      pool: candidate,
      poolInfoData: candidate.poolInfoData,
      activeBinArrayInfo,
      baseAmount: vaults.baseAmount,
      quoteAmount: vaults.quoteAmount,
    });
    const conditions = vaults.conditions ?? 0;
    if (conditions === 0 && (minDepthTo50BpsNative === 0n || minLiquidityNative === 0n)) continue;
    out.push(tagRpcMintOracleDiscoveryEvidence({
      ...(conditions === 0 ? {} : { conditions }),
      family: candidate.family,
      poolOrMarket: candidate.poolOrMarket,
      baseVault: candidate.baseVault,
      quoteVault: candidate.quoteVault,
      whirlpoolsConfig: candidate.whirlpoolsConfig,
      activeBinArray: candidate.activeBinArray,
      programId: candidate.programId,
      tokenProgram: vaults.adapterVersion === 1
        ? SPL_TOKEN_2022_PROGRAM_ID
        : CANONICAL_SPL_TOKEN_PROGRAM_ID,
      ...(candidate.family === "raydium-clmm"
        ? { adapterVersion: vaults.adapterVersion ?? 0, ...(vaults.token2022Mint ? { token2022Mint: vaults.token2022Mint } : {}) }
        : {}),
      ...(candidate.family === "meteora-dlmm"
        ? { adapterVersion: vaults.adapterVersion ?? 0, ...(vaults.token2022Mint ? { token2022Mint: vaults.token2022Mint } : {}) }
        : {}),
      ...(vaults.baseDecimals !== undefined ? { baseDecimals: vaults.baseDecimals } : {}),
      ...(vaults.quoteDecimals !== undefined ? { quoteDecimals: vaults.quoteDecimals } : {}),
      vaultAuthority: vaults.vaultAuthority,
      direction: SourceDirection.QuotePerBase,
      minLiquidityNative,
      minDepthTo50BpsNative,
      liquidityUsd:
        isUsdStableLikeQuoteMint(args.quoteMint, args.cluster)
          ? Number(vaults.quoteAmount) / 1_000_000
          : undefined,
    }));
  }
  return out;
}

async function scanMintOraclePoolFamily(args: {
  connection: RpcMintOraclePoolDiscoveryProviderConfig["connection"];
  family: MintOracleSourceFamily;
  cluster: MintOracleCluster;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  maxPools: number;
  currentUnixTimestamp: number;
  currentSlot: bigint | null;
}): Promise<MintOracleDiscoveredPool[]> {
  const profile = mintOracleClusterProfile(args.cluster);
  const programId = defaultProgramIdForSourceFamily(args.family, args.cluster);
  const candidates: MintOraclePoolCandidate[] = [];
  const addCandidate = (candidate: MintOraclePoolCandidate) => {
    candidates.push(candidate);
  };

  const raydiumPoolIsOpen = (
    data: Buffer,
    statusOffset: number,
    disabledMask: number,
    openTimeOffset: number,
  ): boolean => {
    if ((data[statusOffset] & disabledMask) !== 0) return false;
    return readU64LE(data, openTimeOffset) <= BigInt(args.currentUnixTimestamp);
  };

  const meteoraPairIsOpen = (data: Buffer): boolean => {
    const status = data[METEORA_DLMM_LB_PAIR_OFFSET_STATUS];
    const binStep = data.readUInt16LE(METEORA_DLMM_LB_PAIR_OFFSET_BIN_STEP);
    if (
      status !== METEORA_DLMM_LB_PAIR_STATUS_ENABLED ||
      binStep === 0 ||
      binStep > METEORA_DLMM_MAX_BIN_STEP
    ) {
      return false;
    }
    const activationType = data[METEORA_DLMM_LB_PAIR_OFFSET_ACTIVATION_TYPE];
    const activationPoint = readU64LE(
      data,
      METEORA_DLMM_LB_PAIR_OFFSET_ACTIVATION_POINT,
    );
    if (activationType === METEORA_DLMM_ACTIVATION_TYPE_TIMESTAMP) {
      return activationPoint <= BigInt(args.currentUnixTimestamp);
    }
    if (activationType === METEORA_DLMM_ACTIVATION_TYPE_SLOT) {
      return args.currentSlot != null && activationPoint <= args.currentSlot;
    }
    return false;
  };

  const meteoraDammV2PoolIsOpen = (data: Buffer): boolean =>
    meteoraDammV2PoolDataIsOpen({
      data,
      currentUnixTimestamp: args.currentUnixTimestamp,
      currentSlot: args.currentSlot,
    });

  const scanPairOffsets = async (config: {
    programId: PublicKey;
    dataSize: number;
    mintAOffset: number;
    mintBOffset: number;
    vaultAOffset: number;
    vaultBOffset: number;
    statusOffset?: number;
  }) => {
    for (const [mintA, mintB] of [
      [args.baseMint, args.quoteMint],
      [args.quoteMint, args.baseMint],
    ] as const) {
      if (args.family === "pumpswap" && mintA !== args.baseMint) continue;
      const accounts = await args.connection.getProgramAccounts(config.programId, {
        filters: [
          { dataSize: config.dataSize },
          { memcmp: { offset: config.mintAOffset, bytes: mintA.toBase58() } },
          { memcmp: { offset: config.mintBOffset, bytes: mintB.toBase58() } },
        ],
      });
      for (const account of accounts) {
        const coreAccount = legacyWeb3PoolAccountToCore(account.pubkey, account.account);
        if (
          validatePoolCoreAccountEnvelope(
            coreAccount,
            config.programId.toBase58(),
            config.dataSize,
          ) !== null
        ) {
          continue;
        }
        if (
          args.family === "orca-whirlpool" &&
          !account.account.data.subarray(0, 8).equals(ORCA_WHIRLPOOL_DISCRIMINATOR)
        ) {
          continue;
        }
        const ordered = orderedVaults({
          data: account.account.data,
          mintAOffset: config.mintAOffset,
          mintBOffset: config.mintBOffset,
          vaultAOffset: config.vaultAOffset,
          vaultBOffset: config.vaultBOffset,
          baseMint: args.baseMint,
          quoteMint: args.quoteMint,
        });
        if (ordered == null) continue;
        if (args.family === "orca-whirlpool") {
          const whirlpoolsConfig = readPubkey(
            account.account.data,
            ORCA_WHIRLPOOL_OFFSET_CONFIG,
          );
          if (!whirlpoolsConfig.equals(profile.orcaWhirlpoolsConfig)) {
            continue;
          }
          addCandidate({
            family: args.family,
            poolOrMarket: account.pubkey,
            poolInfoData: account.account.data,
            baseVault: ordered.baseVault,
            quoteVault: ordered.quoteVault,
            programId: config.programId,
            whirlpoolsConfig,
            liquidityNative: account.account.data.readBigUInt64LE(
              ORCA_WHIRLPOOL_OFFSET_LIQUIDITY,
            ),
          });
        } else if (args.family === "meteora-dlmm") {
          if (!meteoraPairIsOpen(account.account.data)) continue;
          const activeBinArray = await findMeteoraActiveBinArray(
            args.connection,
            account.pubkey,
            account.account.data.readInt32LE(METEORA_DLMM_LB_PAIR_OFFSET_ACTIVE_ID),
          );
          if (activeBinArray == null) continue;
          addCandidate({
            family: args.family,
            poolOrMarket: account.pubkey,
            poolInfoData: account.account.data,
            baseVault: ordered.baseVault,
            quoteVault: ordered.quoteVault,
            programId: config.programId,
            activeBinArray: activeBinArray.pubkey,
            activeBinArrayInfo: activeBinArray.account,
          });
        } else if (args.family === "pumpswap") {
          if (
            !pumpSwapPoolDataIsEligible(account.account.data) ||
            !pumpSwapPoolAddressIsCanonical(account.account.data, account.pubkey)
          ) {
            continue;
          }
          addCandidate({
            family: args.family,
            poolOrMarket: account.pubkey,
            poolInfoData: account.account.data,
            baseVault: ordered.baseVault,
            quoteVault: ordered.quoteVault,
            programId: config.programId,
          });
        } else if (args.family === "meteora-damm-v2") {
          if (!meteoraDammV2PoolIsOpen(account.account.data)) continue;
          await addCandidate({
            family: args.family,
            poolOrMarket: account.pubkey,
            poolInfoData: account.account.data,
            baseVault: ordered.baseVault,
            quoteVault: ordered.quoteVault,
            programId: config.programId,
          });
        } else {
          if (
            args.family === "raydium-clmm" &&
            !raydiumPoolIsOpen(
              account.account.data,
              RAYDIUM_CLMM_POOL_OFFSET_STATUS,
              RAYDIUM_CLMM_STATUS_SWAP_DISABLED_MASK,
              RAYDIUM_CLMM_POOL_OFFSET_OPEN_TIME,
            )
          ) {
            continue;
          }
          if (
            args.family === "raydium-cpmm" &&
            !raydiumPoolIsOpen(
              account.account.data,
              RAYDIUM_CPMM_POOL_OFFSET_STATUS,
              RAYDIUM_CPMM_STATUS_SWAP_DISABLED_MASK,
              RAYDIUM_CPMM_POOL_OFFSET_OPEN_TIME,
            )
          ) {
            continue;
          }
          addCandidate({
            family: args.family,
            poolOrMarket: account.pubkey,
            poolInfoData: account.account.data,
            baseVault: ordered.baseVault,
            quoteVault: ordered.quoteVault,
            ammConfig: readPubkey(
              account.account.data,
              args.family === "raydium-clmm"
                ? RAYDIUM_CLMM_POOL_OFFSET_AMM_CONFIG
                : RAYDIUM_CPMM_POOL_OFFSET_AMM_CONFIG,
            ),
            programId: config.programId,
          });
        }
      }
    }
  };

  switch (args.family) {
    case "orca-whirlpool":
      await scanPairOffsets({
        programId,
        dataSize: ORCA_WHIRLPOOL_ACCOUNT_LEN,
        mintAOffset: ORCA_WHIRLPOOL_OFFSET_TOKEN_MINT_A,
        mintBOffset: ORCA_WHIRLPOOL_OFFSET_TOKEN_MINT_B,
        vaultAOffset: ORCA_WHIRLPOOL_OFFSET_TOKEN_VAULT_A,
        vaultBOffset: ORCA_WHIRLPOOL_OFFSET_TOKEN_VAULT_B,
      });
      break;
    case "meteora-dlmm":
      await scanPairOffsets({
        programId,
        dataSize: METEORA_DLMM_LB_PAIR_LEN,
        mintAOffset: METEORA_DLMM_LB_PAIR_OFFSET_TOKEN_X_MINT,
        mintBOffset: METEORA_DLMM_LB_PAIR_OFFSET_TOKEN_Y_MINT,
        vaultAOffset: METEORA_DLMM_LB_PAIR_OFFSET_RESERVE_X,
        vaultBOffset: METEORA_DLMM_LB_PAIR_OFFSET_RESERVE_Y,
      });
      break;
    case "meteora-damm-v2":
      await scanPairOffsets({
        programId,
        dataSize: METEORA_DAMM_V2_POOL_LEN,
        mintAOffset: METEORA_DAMM_V2_POOL_OFFSET_TOKEN_A_MINT,
        mintBOffset: METEORA_DAMM_V2_POOL_OFFSET_TOKEN_B_MINT,
        vaultAOffset: METEORA_DAMM_V2_POOL_OFFSET_TOKEN_A_VAULT,
        vaultBOffset: METEORA_DAMM_V2_POOL_OFFSET_TOKEN_B_VAULT,
      });
      break;
    case "raydium-clmm":
      await scanPairOffsets({
        programId,
        dataSize: RAYDIUM_CLMM_POOL_STATE_LEN,
        mintAOffset: RAYDIUM_CLMM_POOL_OFFSET_TOKEN_MINT_0,
        mintBOffset: RAYDIUM_CLMM_POOL_OFFSET_TOKEN_MINT_1,
        vaultAOffset: RAYDIUM_CLMM_POOL_OFFSET_TOKEN_VAULT_0,
        vaultBOffset: RAYDIUM_CLMM_POOL_OFFSET_TOKEN_VAULT_1,
        statusOffset: RAYDIUM_CLMM_POOL_OFFSET_STATUS,
      });
      break;
    case "raydium-cpmm":
      await scanPairOffsets({
        programId,
        dataSize: profile.raydiumCpmmPoolStateLength,
        mintAOffset: RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT,
        mintBOffset: RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_MINT,
        vaultAOffset: RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT,
        vaultBOffset: RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_VAULT,
        statusOffset: RAYDIUM_CPMM_POOL_OFFSET_STATUS,
      });
      break;
    case "pumpswap":
      for (const dataSize of PUMPSWAP_POOL_ACCOUNT_LENS) {
        await scanPairOffsets({
          programId,
          dataSize,
          mintAOffset: PUMPSWAP_POOL_OFFSET_BASE_MINT,
          mintBOffset: PUMPSWAP_POOL_OFFSET_QUOTE_MINT,
          vaultAOffset: PUMPSWAP_POOL_OFFSET_BASE_VAULT,
          vaultBOffset: PUMPSWAP_POOL_OFFSET_QUOTE_VAULT,
        });
      }
      break;
  }
  const out = await hydrateMintOraclePoolCandidates({
    connection: args.connection,
    candidates,
    baseMint: args.baseMint,
    quoteMint: args.quoteMint,
    cluster: args.cluster,
  });
  return out.sort(comparePoolsForSelection).slice(0, args.maxPools);
}

function raydiumPoolDataIsOpen(args: {
  data: Buffer;
  statusOffset: number;
  disabledMask: number;
  openTimeOffset: number;
  currentUnixTimestamp: number;
}): boolean {
  if ((args.data[args.statusOffset] & args.disabledMask) !== 0) return false;
  return readU64LE(args.data, args.openTimeOffset) <= BigInt(args.currentUnixTimestamp);
}

function meteoraPairDataIsOpen(args: {
  data: Buffer;
  currentUnixTimestamp: number;
  currentSlot: bigint | null;
}): boolean {
  const status = args.data[METEORA_DLMM_LB_PAIR_OFFSET_STATUS];
  const binStep = args.data.readUInt16LE(METEORA_DLMM_LB_PAIR_OFFSET_BIN_STEP);
  if (
    status !== METEORA_DLMM_LB_PAIR_STATUS_ENABLED ||
    binStep === 0 ||
    binStep > METEORA_DLMM_MAX_BIN_STEP
  ) {
    return false;
  }
  const activationType = args.data[METEORA_DLMM_LB_PAIR_OFFSET_ACTIVATION_TYPE];
  const activationPoint = readU64LE(
    args.data,
    METEORA_DLMM_LB_PAIR_OFFSET_ACTIVATION_POINT,
  );
  if (activationType === METEORA_DLMM_ACTIVATION_TYPE_TIMESTAMP) {
    return activationPoint <= BigInt(args.currentUnixTimestamp);
  }
  if (activationType === METEORA_DLMM_ACTIVATION_TYPE_SLOT) {
    return args.currentSlot != null && activationPoint <= args.currentSlot;
  }
  return false;
}

function meteoraDammV2PoolDataIsOpen(args: {
  data: Buffer;
  currentUnixTimestamp: number;
  currentSlot: bigint | null;
}): boolean {
  if (args.data[METEORA_DAMM_V2_POOL_OFFSET_POOL_STATUS] !== METEORA_DAMM_V2_POOL_STATUS_ENABLED) {
    return false;
  }
  const activationType = args.data[METEORA_DAMM_V2_POOL_OFFSET_ACTIVATION_TYPE];
  const activationPoint = readU64LE(args.data, METEORA_DAMM_V2_POOL_OFFSET_ACTIVATION_POINT);
  if (activationType === METEORA_DAMM_V2_ACTIVATION_TYPE_TIMESTAMP) {
    return activationPoint <= BigInt(args.currentUnixTimestamp);
  }
  if (activationType === METEORA_DAMM_V2_ACTIVATION_TYPE_SLOT) {
    return args.currentSlot != null && activationPoint <= args.currentSlot;
  }
  return false;
}

function sourceFamilyPairLayout(args: {
  family: MintOracleSourceFamily;
  cluster: MintOracleCluster;
  currentUnixTimestamp: number;
  currentSlot: bigint | null;
}): {
  programId: PublicKey;
  dataSize: number;
  mintAOffset: number;
  mintBOffset: number;
  vaultAOffset: number;
  vaultBOffset: number;
  isOpen(data: Buffer): boolean;
} {
  const programId = defaultProgramIdForSourceFamily(args.family, args.cluster);
  switch (args.family) {
    case "orca-whirlpool":
      return {
        programId,
        dataSize: ORCA_WHIRLPOOL_ACCOUNT_LEN,
        mintAOffset: ORCA_WHIRLPOOL_OFFSET_TOKEN_MINT_A,
        mintBOffset: ORCA_WHIRLPOOL_OFFSET_TOKEN_MINT_B,
        vaultAOffset: ORCA_WHIRLPOOL_OFFSET_TOKEN_VAULT_A,
        vaultBOffset: ORCA_WHIRLPOOL_OFFSET_TOKEN_VAULT_B,
        isOpen: () => true,
      };
    case "meteora-dlmm":
      return {
        programId,
        dataSize: METEORA_DLMM_LB_PAIR_LEN,
        mintAOffset: METEORA_DLMM_LB_PAIR_OFFSET_TOKEN_X_MINT,
        mintBOffset: METEORA_DLMM_LB_PAIR_OFFSET_TOKEN_Y_MINT,
        vaultAOffset: METEORA_DLMM_LB_PAIR_OFFSET_RESERVE_X,
        vaultBOffset: METEORA_DLMM_LB_PAIR_OFFSET_RESERVE_Y,
        isOpen: (data) =>
          meteoraPairDataIsOpen({
            data,
            currentUnixTimestamp: args.currentUnixTimestamp,
            currentSlot: args.currentSlot,
          }),
      };
    case "meteora-damm-v2":
      return {
        programId,
        dataSize: METEORA_DAMM_V2_POOL_LEN,
        mintAOffset: METEORA_DAMM_V2_POOL_OFFSET_TOKEN_A_MINT,
        mintBOffset: METEORA_DAMM_V2_POOL_OFFSET_TOKEN_B_MINT,
        vaultAOffset: METEORA_DAMM_V2_POOL_OFFSET_TOKEN_A_VAULT,
        vaultBOffset: METEORA_DAMM_V2_POOL_OFFSET_TOKEN_B_VAULT,
        isOpen: (data) =>
          meteoraDammV2PoolDataIsOpen({
            data,
            currentUnixTimestamp: args.currentUnixTimestamp,
            currentSlot: args.currentSlot,
          }),
      };
    case "raydium-clmm":
      return {
        programId,
        dataSize: RAYDIUM_CLMM_POOL_STATE_LEN,
        mintAOffset: RAYDIUM_CLMM_POOL_OFFSET_TOKEN_MINT_0,
        mintBOffset: RAYDIUM_CLMM_POOL_OFFSET_TOKEN_MINT_1,
        vaultAOffset: RAYDIUM_CLMM_POOL_OFFSET_TOKEN_VAULT_0,
        vaultBOffset: RAYDIUM_CLMM_POOL_OFFSET_TOKEN_VAULT_1,
        isOpen: (data) =>
          raydiumPoolDataIsOpen({
            data,
            statusOffset: RAYDIUM_CLMM_POOL_OFFSET_STATUS,
            disabledMask: RAYDIUM_CLMM_STATUS_SWAP_DISABLED_MASK,
            openTimeOffset: RAYDIUM_CLMM_POOL_OFFSET_OPEN_TIME,
            currentUnixTimestamp: args.currentUnixTimestamp,
          }),
      };
    case "raydium-cpmm":
      return {
        programId,
        dataSize: mintOracleClusterProfile(args.cluster).raydiumCpmmPoolStateLength,
        mintAOffset: RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT,
        mintBOffset: RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_MINT,
        vaultAOffset: RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT,
        vaultBOffset: RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_VAULT,
        isOpen: (data) =>
          raydiumPoolDataIsOpen({
            data,
            statusOffset: RAYDIUM_CPMM_POOL_OFFSET_STATUS,
            disabledMask: RAYDIUM_CPMM_STATUS_SWAP_DISABLED_MASK,
            openTimeOffset: RAYDIUM_CPMM_POOL_OFFSET_OPEN_TIME,
            currentUnixTimestamp: args.currentUnixTimestamp,
          }),
      };
    case "pumpswap":
      return {
        programId,
        dataSize: PUMPSWAP_POOL_ACCOUNT_LENS[0],
        mintAOffset: PUMPSWAP_POOL_OFFSET_BASE_MINT,
        mintBOffset: PUMPSWAP_POOL_OFFSET_QUOTE_MINT,
        vaultAOffset: PUMPSWAP_POOL_OFFSET_BASE_VAULT,
        vaultBOffset: PUMPSWAP_POOL_OFFSET_QUOTE_VAULT,
        isOpen: pumpSwapPoolDataIsEligible,
      };
  }
}

export async function verifyMintOraclePoolsWithRpc(
  args: VerifyMintOraclePoolsWithRpcArgs,
): Promise<readonly MintOracleDiscoveredPool[]> {
  const baseMint = toPublicKey(args.mintAddress, "Mint");
  const quoteMint = requireQuoteMint(args);
  const cluster = requireMintOracleCluster(args.cluster);
  assertAdmittedMintOraclePoolQuoteMint(quoteMint, cluster);
  assertSupportedPumpSwapSelection(args.pools, baseMint);
  const currentUnixTimestamp =
    args.currentUnixTimestamp ?? Math.floor(Date.now() / 1_000);
  const currentSlot =
    args.currentSlot ?? BigInt(await args.connection.getSlot("confirmed"));
  const pumpSwapMintMetadata = args.pools.some((pool) => pool.family === "pumpswap")
    ? await fetchPumpSwapMintPairMetadata(args.connection, baseMint, quoteMint)
    : null;
  const mintDecimals = pumpSwapMintMetadata ?? await fetchMintPairDecimals(
    args.connection,
    baseMint,
    quoteMint,
    args.pools.some((pool) => pool.family === "raydium-clmm" || pool.family === "meteora-dlmm"),
  );

  const poolContexts = args.pools.map((pool) => {
    if (
      (pool.baseDecimals != null && pool.baseDecimals !== mintDecimals.baseDecimals) ||
      (pool.quoteDecimals != null && pool.quoteDecimals !== mintDecimals.quoteDecimals)
    ) {
      throw new Error("InvalidMintOracleMintMetadata");
    }
    const layout = sourceFamilyPairLayout({
      family: pool.family,
      cluster,
      currentUnixTimestamp,
      currentSlot,
    });
    const poolOrMarket = toPublicKey(pool.poolOrMarket, "PoolOrMarket");
    const baseVault = toPublicKey(pool.baseVault, "BaseVault");
    const quoteVault = toPublicKey(pool.quoteVault, "QuoteVault");
    const expectedProgramId = pool.programId
      ? toPublicKey(pool.programId, "ProgramId")
      : layout.programId;
    if (!expectedProgramId.equals(layout.programId)) {
      throw new Error("InvalidMintOraclePoolProgram");
    }
    return {
      pool,
      layout,
      poolOrMarket,
      baseVault,
      quoteVault,
    };
  });
  const poolInfos = await getMultipleAccountsInfoChunked(args.connection,
    poolContexts.map((context) => context.poolOrMarket),
  );
  const activeBinArrayLookups: {
    contextIndex: number;
    activeBinArray: PublicKey;
    binArrayIndex: number;
    lbPair: PublicKey;
  }[] = [];
  const hydratedContexts = poolContexts.map((context, index) => {
    const poolInfo = poolInfos[index] ?? null;
    if (
      poolInfo == null ||
      !poolInfo.owner.equals(context.layout.programId) ||
      (context.pool.family !== "pumpswap" &&
        poolInfo.data.length !== context.layout.dataSize) ||
      (context.pool.family === "orca-whirlpool" &&
        !poolInfo.data.subarray(0, 8).equals(ORCA_WHIRLPOOL_DISCRIMINATOR)) ||
      !context.layout.isOpen(poolInfo.data) ||
      (context.pool.family === "pumpswap" &&
        !pumpSwapPoolAddressIsCanonical(poolInfo.data, context.poolOrMarket))
    ) {
      throw new Error("UnverifiedMintOraclePoolGraph");
    }
    const ordered = context.pool.family === "pumpswap"
      ? (() => {
          const decodedBaseVault = readPubkey(
            poolInfo.data,
            PUMPSWAP_POOL_OFFSET_BASE_VAULT,
          );
          const decodedQuoteVault = readPubkey(
            poolInfo.data,
            PUMPSWAP_POOL_OFFSET_QUOTE_VAULT,
          );
          return readPubkey(poolInfo.data, PUMPSWAP_POOL_OFFSET_BASE_MINT).equals(baseMint) &&
            readPubkey(poolInfo.data, PUMPSWAP_POOL_OFFSET_QUOTE_MINT).equals(quoteMint) &&
            !decodedBaseVault.equals(ZERO_PUBLIC_KEY) &&
            !decodedQuoteVault.equals(ZERO_PUBLIC_KEY)
            ? { baseVault: decodedBaseVault, quoteVault: decodedQuoteVault }
            : null;
        })()
      : orderedVaults({
          data: poolInfo.data,
          mintAOffset: context.layout.mintAOffset,
          mintBOffset: context.layout.mintBOffset,
          vaultAOffset: context.layout.vaultAOffset,
          vaultBOffset: context.layout.vaultBOffset,
          baseMint,
          quoteMint,
        });
    if (
      ordered == null ||
      !ordered.baseVault.equals(context.baseVault) ||
      !ordered.quoteVault.equals(context.quoteVault)
    ) {
      throw new Error("UnverifiedMintOraclePoolGraph");
    }
    let whirlpoolsConfig: PublicKey | undefined;
    let activeBinArray: PublicKey | undefined;
    let ammConfig: PublicKey | undefined;
    if (context.pool.family === "orca-whirlpool") {
      whirlpoolsConfig = readPubkey(poolInfo.data, ORCA_WHIRLPOOL_OFFSET_CONFIG);
      if (!whirlpoolsConfig.equals(mintOracleClusterProfile(cluster).orcaWhirlpoolsConfig)) {
        throw new Error("UnverifiedMintOraclePoolGraph");
      }
      if (
        context.pool.whirlpoolsConfig &&
        !toPublicKey(context.pool.whirlpoolsConfig, "WhirlpoolsConfig").equals(
          whirlpoolsConfig,
        )
      ) {
        throw new Error("UnverifiedMintOraclePoolGraph");
      }
    } else if (context.pool.family === "meteora-dlmm") {
      const binArrayIndex = meteoraBinArrayIndexForActiveId(
        poolInfo.data.readInt32LE(METEORA_DLMM_LB_PAIR_OFFSET_ACTIVE_ID),
      );
      activeBinArray = findMeteoraDlmmBinArrayPda(
        context.poolOrMarket,
        binArrayIndex,
      )[0];
      if (
        context.pool.activeBinArray &&
        !toPublicKey(context.pool.activeBinArray, "ActiveBinArray").equals(
          activeBinArray,
        )
      ) {
        throw new Error("UnverifiedMintOraclePoolGraph");
      }
      activeBinArrayLookups.push({
        contextIndex: index,
        activeBinArray,
        binArrayIndex,
        lbPair: context.poolOrMarket,
      });
    } else if (
      context.pool.family === "raydium-clmm" ||
      context.pool.family === "raydium-cpmm"
    ) {
      ammConfig = readPubkey(
        poolInfo.data,
        context.pool.family === "raydium-clmm"
          ? RAYDIUM_CLMM_POOL_OFFSET_AMM_CONFIG
          : RAYDIUM_CPMM_POOL_OFFSET_AMM_CONFIG,
      );
      if (
        context.pool.ammConfig &&
        !toPublicKey(context.pool.ammConfig, "AmmConfig").equals(ammConfig)
      ) {
        throw new Error("UnverifiedMintOraclePoolGraph");
      }
    }
    return {
      ...context,
      poolInfoData: poolInfo.data,
      whirlpoolsConfig,
      activeBinArray,
      ammConfig,
    };
  });
  const [vaultEvidences, activeBinArrayInfos] = await Promise.all([
    fetchVaultEvidenceBatch(
      args.connection,
      hydratedContexts,
      baseMint,
      quoteMint,
      pumpSwapMintMetadata?.baseTokenProgram,
    ),
    Promise.all(
      activeBinArrayLookups.map((lookup) =>
        args.connection.getAccountInfo(lookup.activeBinArray),
      ),
    ),
  ]);
  const activeBinArrayInfoByContext = new Map<number, AccountInfo<Buffer>>();
  for (let index = 0; index < activeBinArrayLookups.length; index += 1) {
    const lookup = activeBinArrayLookups[index]!;
    const activeBinArrayInfo = activeBinArrayInfos[index] ?? null;
    if (
      !validateMeteoraBinArrayAccount(
        activeBinArrayInfo,
        lookup.lbPair,
        lookup.binArrayIndex,
      )
    ) {
      throw new Error("UnverifiedMintOraclePoolGraph");
    }
    activeBinArrayInfoByContext.set(lookup.contextIndex, activeBinArrayInfo!);
  }

  const verified: MintOracleDiscoveredPool[] = [];
  for (let index = 0; index < hydratedContexts.length; index += 1) {
    const context = hydratedContexts[index]!;
    const { pool } = context;
    const vaults = vaultEvidences[index];
    if (vaults == null || vaults.vaultAuthority == null) {
      throw new Error("UnverifiedMintOraclePoolGraph");
    }
    if (
      pool.vaultAuthority &&
      !toPublicKey(pool.vaultAuthority, "VaultAuthority").equals(vaults.vaultAuthority)
    ) {
      throw new Error("UnverifiedMintOraclePoolGraph");
    }
    if (pool.family === "raydium-clmm") {
      const observedAdapterVersion = vaults.adapterVersion ?? 0;
      if (pool.adapterVersion !== undefined && pool.adapterVersion !== observedAdapterVersion) {
        throw new Error("UnverifiedMintOraclePoolGraph");
      }
      const observedTokenProgram = observedAdapterVersion === 1
        ? SPL_TOKEN_2022_PROGRAM_ID
        : CANONICAL_SPL_TOKEN_PROGRAM_ID;
      if (pool.tokenProgram !== undefined &&
          !toPublicKey(pool.tokenProgram, "TokenProgram").equals(observedTokenProgram)) {
        throw new Error("UnverifiedMintOraclePoolGraph");
      }
      const observedToken2022Mint = vaults.token2022Mint ?? null;
      if (pool.token2022Mint !== undefined &&
          (observedToken2022Mint === null ||
            !toPublicKey(pool.token2022Mint, "Token2022Mint").equals(observedToken2022Mint))) {
        throw new Error("UnverifiedMintOraclePoolGraph");
      }
    }
    if (
      pool.family === "pumpswap" &&
      (vaults.vaultAuthority == null ||
        !vaults.vaultAuthority.equals(context.poolOrMarket) ||
        BigInt(vaults.quoteAmount) +
          readI128LE(
            context.poolInfoData,
            PUMPSWAP_POOL_OFFSET_VIRTUAL_QUOTE_RESERVES,
          ) <=
          0n)
    ) {
      throw new Error("UnverifiedMintOraclePoolGraph");
    }
    const {
      minLiquidityNative,
      minDepthTo50BpsNative: discoveredMinDepthTo50BpsNative,
    } = await preciseMintOraclePoolLiquidityEvidence({
      connection: args.connection,
      pool: context.activeBinArray ? { ...pool, activeBinArray: context.activeBinArray } : pool,
      poolInfoData: context.poolInfoData,
      activeBinArrayInfo: activeBinArrayInfoByContext.get(index) ?? null,
      baseAmount: vaults.baseAmount,
      quoteAmount: vaults.quoteAmount,
    });
    if ((vaults.conditions ?? 0) === 0 && (minLiquidityNative === 0n || discoveredMinDepthTo50BpsNative === 0n)) {
      throw new Error("UnverifiedMintOraclePoolGraph");
    }
    verified.push(tagRpcMintOracleDiscoveryEvidence({
      ...pool,
      ...((vaults.conditions ?? 0) === 0 ? {} : { conditions: vaults.conditions }),
      poolOrMarket: context.poolOrMarket,
      baseVault: context.baseVault,
      quoteVault: context.quoteVault,
      ammConfig: context.ammConfig,
      whirlpoolsConfig: context.whirlpoolsConfig,
      activeBinArray: context.activeBinArray,
      programId: context.layout.programId,
      tokenProgram: vaults.adapterVersion === 1
        ? SPL_TOKEN_2022_PROGRAM_ID
        : pumpSwapMintMetadata?.baseTokenProgram ?? CANONICAL_SPL_TOKEN_PROGRAM_ID,
      ...(pool.family === "raydium-clmm"
        ? { adapterVersion: vaults.adapterVersion ?? 0, ...(vaults.token2022Mint ? { token2022Mint: vaults.token2022Mint } : {}) }
        : {}),
      ...(pool.family === "meteora-dlmm"
        ? { adapterVersion: vaults.adapterVersion ?? 0, ...(vaults.token2022Mint ? { token2022Mint: vaults.token2022Mint } : {}) }
        : {}),
      baseDecimals: vaults.baseDecimals ?? mintDecimals.baseDecimals,
      quoteDecimals: vaults.quoteDecimals ?? mintDecimals.quoteDecimals,
      vaultAuthority: vaults.vaultAuthority,
      direction: SourceDirection.QuotePerBase,
      minLiquidityNative,
      minDepthTo50BpsNative: discoveredMinDepthTo50BpsNative,
      liquidityUsd:
        isUsdStableLikeQuoteMint(quoteMint, cluster)
          ? Number(vaults.quoteAmount) / 10 ** mintDecimals.quoteDecimals
          : undefined,
    }));
  }
  return verified;
}

export function createRpcMintOraclePoolDiscoveryProvider(
  config: RpcMintOraclePoolDiscoveryProviderConfig,
): MintOraclePoolDiscoveryProvider {
  return {
    async discoverMintOraclePools(args): Promise<readonly MintOracleDiscoveredPool[]> {
      const cluster = requireMintOracleCluster(args.cluster);
      const families = args.families;
      const currentUnixTimestamp =
        config.currentUnixTimestamp ?? Math.floor(Date.now() / 1_000);
      const currentSlot =
        config.currentSlot ?? BigInt(await config.connection.getSlot("confirmed"));
      const discovered = await Promise.all(
        families.map((family) =>
          scanMintOraclePoolFamily({
            connection: config.connection,
            family,
            cluster,
            baseMint: args.mintAddress,
            quoteMint: args.quoteMintAddress,
            maxPools: config.maxPoolsPerFamily ?? 8,
            currentUnixTimestamp,
            currentSlot,
          }),
        ),
      );
      return discovered.flat().sort(comparePoolsForSelection);
    },
  };
}

export function evaluateMintOracleProgramRiskTier(args: {
  pools: readonly MintOracleDiscoveredPool[];
  anchorPolicyHash?: Uint8Array;
  nativeTierAExceptionHash?: Uint8Array;
}): MintOracleProgramRiskTierEvaluation {
  const pools = [...args.pools].sort((a, b) => {
    const ai = a.sourceIndex ?? 255;
    const bi = b.sourceIndex ?? 255;
    return ai === bi
      ? sourceGraphOrderRank(a.family) - sourceGraphOrderRank(b.family)
      : ai - bi;
  });
  const families = pools.map((pool) => pool.family);
  const familyKey = families.join(",");
  const sourceCount = pools.length;
  const venueCount = knownOperatorGroups(pools, (pool) => pool.venueGroup);
  const correlationGroupCount = knownOperatorGroups(pools, (pool) => pool.routeCorrelationGroup);
  const warnings: string[] = [];
  let routeableAtomicPath: MintOracleProgramRiskTierEvaluation["routeableAtomicPath"] =
    "unsupported";
  let maxRefreshRiskTier: number = RiskTier.TierC;

  if (sourceCount === 0) {
    return {
      informedRiskTier: RiskTier.Unrated,
      maxRefreshRiskTier: RiskTier.Unrated,
      creationRiskTier: RiskTier.Unrated,
      routeableAtomicPath,
      sourceCount,
      venueCount,
      correlationGroupCount,
      warnings: ["no selected pools"],
    };
  }

  if (families.every((family) => family === "raydium-cpmm")) {
    routeableAtomicPath =
      sourceCount === 5
        ? "raydium-cpmm-5"
        : sourceCount === 4
          ? "raydium-cpmm-4"
          : sourceCount === 3
            ? "raydium-cpmm-3"
            : sourceCount === 2
              ? "raydium-cpmm-2"
              : "single-source";
    if (sourceCount >= 3) {
      warnings.push(
        "same-family CPMM feeds need explicit venue/correlation evidence on each source config to escape TierC",
      );
    }
  } else if (familyKey === "orca-whirlpool,raydium-clmm") {
    routeableAtomicPath = "orca-raydium-clmm";
  } else if (familyKey === "meteora-dlmm,raydium-clmm") {
    routeableAtomicPath = "meteora-raydium-clmm";
  } else if (familyKey === "orca-whirlpool,meteora-dlmm") {
    routeableAtomicPath = "orca-meteora";
  } else if (familyKey === "orca-whirlpool,meteora-dlmm,raydium-clmm") {
    routeableAtomicPath = "orca-meteora-raydium-clmm";
  } else if (sourceCount === 1) {
    routeableAtomicPath = "single-source";
  } else if (families.every(isExecutableRetainedRingFamily)) {
    routeableAtomicPath = "retained-rings";
  } else {
    warnings.push("selected source set has no current fused program account-hash path");
  }

  if (routeableAtomicPath !== "unsupported") {
    if (sourceCount >= 4 && venueCount >= 3 && correlationGroupCount >= 3) maxRefreshRiskTier = RiskTier.TierA;
    else if (sourceCount >= 3 && venueCount >= 2 && correlationGroupCount >= 2) maxRefreshRiskTier = RiskTier.TierB;
  }
  if (
    routeableAtomicPath === "retained-rings" &&
    maxRefreshRiskTier === RiskTier.TierC
  ) {
    warnings.push(
      "retained-ring source sets need at least three sources, two venues and two route-correlation groups to escape TierC",
    );
  }
  if (maxRefreshRiskTier === RiskTier.TierA) {
    const anchorHash = args.anchorPolicyHash
      ? bytes32(args.anchorPolicyHash, "AnchorPolicyHash")
      : Buffer.alloc(32);
    const nativeExceptionHash = args.nativeTierAExceptionHash
      ? bytes32(args.nativeTierAExceptionHash, "NativeTierAExceptionHash")
      : Buffer.alloc(32);
    if (anchorHash.every((byte) => byte === 0)) {
      warnings.push("TierA requires a non-zero anchor policy hash");
    }
    if (nativeExceptionHash.every((byte) => byte === 0)) {
      warnings.push("current TierA snapshot writer requires a native exception hash");
    }
  }

  const informedRiskTier = maxRefreshRiskTier;
  return {
    informedRiskTier,
    maxRefreshRiskTier,
    creationRiskTier: informedRiskTier,
    routeableAtomicPath,
    sourceCount,
    venueCount,
    correlationGroupCount,
    warnings,
  };
}

export function selectMintOraclePools(
  args: SelectMintOraclePoolsArgs,
): SelectedMintOraclePools {
  const maxPoolsPerFamily = args.maxPoolsPerFamily ?? 1;
  if (!Number.isInteger(maxPoolsPerFamily) || maxPoolsPerFamily <= 0) {
    throw new Error("InvalidMaxPoolsPerFamily");
  }
  const allowedFamilies = new Set(
    args.families ?? PRIVATE_AUTHORITY.MINT_ORACLE_SOURCE_FAMILY_ORDER,
  );
  const sortedPools = args.pools
    .map((pool) => copyRpcMintOracleDiscoveryEvidence(cloneMintOraclePool(pool), pool))
    .filter((pool) => allowedFamilies.has(pool.family))
    .sort(comparePoolsForSelection);

  const buckets = new Map<MintOracleSourceFamily, MintOracleDiscoveredPool[]>();
  const cappedPools: MintOracleDiscoveredPool[] = [];
  for (const pool of sortedPools) {
    const current = buckets.get(pool.family) ?? [];
    if (current.length < maxPoolsPerFamily) {
      current.push(pool);
      buckets.set(pool.family, current);
      cappedPools.push(pool);
    }
  }

  const productionPriorityPools = cappedPools.filter(
    (pool) => sourcePriorityForFamily(pool.family) === "production-priority",
  );
  const adapterSeparatePools = cappedPools.filter(
    (pool) => sourcePriorityForFamily(pool.family) === "adapter-separate",
  );
  const minProductionSourceCount = args.minProductionSourceCount ?? 3;
  const warnings: string[] = [];
  const selectedPools =
    productionPriorityPools.length > 0
      ? productionPriorityPools
      : productionPriorityPools.length === 0 && args.includeAdapterSeparate
        ? adapterSeparatePools
        : [];
  if (
    args.includeAdapterSeparate &&
    productionPriorityPools.length > 0 &&
    adapterSeparatePools.length > 0
  ) {
    warnings.push(
      "Raydium CPMM pool(s) were discovered but kept on the separate CPMM adapter path; v0.1 does not mix CPMM with production-priority non-CPMM source sets.",
    );
  }
  if (productionPriorityPools.length < minProductionSourceCount) {
    warnings.push(
      `Only ${productionPriorityPools.length} production-priority pool(s) found; expected at least ${minProductionSourceCount}.`,
    );
  }
  if (warnings.length > 0 && args.strict) {
    throw new Error(warnings.join(" "));
  }
  const longTailEvaluation = args.longTailPolicy
    ? evaluateMintOracleLongTailPools({
        pools: selectedPools,
        policy: args.longTailPolicy,
      })
    : undefined;

  return {
    selectedPools,
    productionPriorityPools,
    adapterSeparatePools,
    sourceFamilies: selectedPools.map((pool) => pool.family),
    sourcePriority:
      selectedPools.length > 0 &&
      selectedPools.every(
        (pool) =>
          sourcePriorityForFamily(pool.family) === "production-priority",
      )
        ? "production-priority"
        : "adapter-separate",
    programRiskTier: evaluateMintOracleProgramRiskTier({
      pools: selectedPools,
    }),
    warnings,
    longTailEvaluation,
  };
}

export async function discoverMintOraclePoolsForMint(args: {
  discoveryProvider: MintOraclePoolDiscoveryProvider;
  mintAddress: PublicKeyInput;
  quoteMintAddress?: PublicKeyInput;
  defaultQuoteMintAddress?: PublicKeyInput;
  cluster: MintOracleCluster;
  families?: readonly MintOracleSourceFamily[];
  includeAdapterSeparate?: boolean;
  maxPoolsPerFamily?: number;
  minProductionSourceCount?: number;
  strict?: boolean;
  longTailPolicy?: MintOracleLongTailPolicy;
}): Promise<SelectedMintOraclePools & { allPools: readonly MintOracleDiscoveredPool[] }> {
  const mintAddress = toPublicKey(args.mintAddress, "Mint");
  const quoteMintAddress = requireQuoteMint(args);
  const cluster = requireMintOracleCluster(args.cluster);
  const policyCluster = activeMintOraclePolicyCluster(cluster);
  assertAdmittedMintOraclePoolQuoteMint(quoteMintAddress, cluster);
  const families = args.families
    ? [...args.families]
    : freshStringList("MINT_ORACLE_DEFAULT_DISCOVERY_SOURCE_FAMILIES");
  const allPools = (await args.discoveryProvider.discoverMintOraclePools({
    mintAddress,
    quoteMintAddress,
    cluster: policyCluster,
    families: [...families],
  })).map(cloneMintOraclePool);
  const selected = selectMintOraclePools({
      pools: allPools,
      families,
      includeAdapterSeparate: args.includeAdapterSeparate,
      maxPoolsPerFamily: args.maxPoolsPerFamily,
      minProductionSourceCount: args.minProductionSourceCount,
      strict: args.strict,
      longTailPolicy: args.longTailPolicy,
  });
  return {
    ...withResolvedMintOracleSourceIndices(selected),
    allPools,
  };
}

function selectedPoolScore(selection: SelectedMintOraclePools): number {
  const basePoolScore = selection.selectedPools.reduce(
    (sum, pool) => sum + computeMintOraclePoolScore(pool),
    0,
  );
  const sourceFamilies = new Set(selection.selectedPools.map((pool) => pool.family));
  const venueGroups = new Set(
    selection.selectedPools.map((pool) => poolVenueGroup(pool)),
  );
  const correlationGroups = new Set(
    selection.selectedPools.map((pool) => poolRouteCorrelationGroup(pool)),
  );
  const rpcEvidence = selection.selectedPools
    .map((pool) => rpcMintOracleMarketEvidence(pool))
    .filter((evidence): evidence is RpcMintOracleMarketEvidence => evidence !== null);
  const hasCompleteRpcEvidence =
    rpcEvidence.length > 0 && rpcEvidence.length === selection.selectedPools.length;
  const routeEvidence = hasCompleteRpcEvidence ? rpcEvidence : [];
  const routeabilityScore =
    !hasCompleteRpcEvidence
      ? 0
      : selection.programRiskTier.routeableAtomicPath === "unsupported"
        ? -80
        : selection.programRiskTier.routeableAtomicPath === "single-source"
          ? -20
          : 36;
  const recencyScore = positiveBigIntMetricScore(
    minDefinedBigInt(routeEvidence.map((evidence) => evidence.lastObservationSlot)),
    4,
  );
  const liquidityAgeScore = positiveBigIntMetricScore(
    minDefinedBigInt(routeEvidence.map((evidence) => evidence.liquidityAgeSlots)),
    3,
  );
  const manipulationScore = positiveBigIntMetricScore(
    minDefinedBigInt(
      routeEvidence.map((evidence) => evidence.feeLossFloorNative),
    ),
    8,
  );
  const observationScore = positiveMetricScore(
    minDefinedNumber(
      routeEvidence.map((evidence) => evidence.retainedObservationCount),
    ) ?? undefined,
    3,
  );
  return (
    basePoolScore +
    (hasCompleteRpcEvidence ? selection.selectedPools.length * 8 : 0) +
    (hasCompleteRpcEvidence ? sourceFamilies.size * 18 : 0) +
    (hasCompleteRpcEvidence ? venueGroups.size * 10 : 0) +
    (hasCompleteRpcEvidence ? correlationGroups.size * 10 : 0) +
    routeabilityScore +
    recencyScore +
    liquidityAgeScore +
    manipulationScore +
    observationScore
  );
}

function withResolvedMintOracleSourceIndices(
  selection: SelectedMintOraclePools,
): SelectedMintOraclePools {
  const sourceGraphOrderedPools = [...selection.selectedPools].sort((a, b) => {
    const familyDelta = sourceGraphOrderRank(a.family) - sourceGraphOrderRank(b.family);
    if (familyDelta !== 0) return familyDelta;
    return publicKeyInputSortKey(a.poolOrMarket).localeCompare(
      publicKeyInputSortKey(b.poolOrMarket),
    );
  });
  const sourceIndexByMarket = new Map<string, number>();
  sourceGraphOrderedPools.forEach((pool, index) => {
    sourceIndexByMarket.set(publicKeyInputSortKey(pool.poolOrMarket), pool.sourceIndex ?? index);
  });
  const indexedSelected = selection.selectedPools.map((pool) => {
    if (pool.sourceIndex != null) return pool;
    const sourceIndex = sourceIndexByMarket.get(publicKeyInputSortKey(pool.poolOrMarket));
    if (sourceIndex == null) throw new Error("MissingMintOracleSourceIndex");
    return copyRpcMintOracleDiscoveryEvidence({ ...pool, sourceIndex }, pool);
  });
  const byMarket = new Map(
    indexedSelected.map((pool) => [publicKeyInputSortKey(pool.poolOrMarket), pool]),
  );
  const rewrite = (pools: readonly MintOracleDiscoveredPool[]) =>
    pools.map((pool) => byMarket.get(publicKeyInputSortKey(pool.poolOrMarket)) ?? pool);
  return {
    ...selection,
    selectedPools: indexedSelected,
    productionPriorityPools: rewrite(selection.productionPriorityPools),
    adapterSeparatePools: rewrite(selection.adapterSeparatePools),
  };
}

function quoteAlternativeRank(quoteKind: MintOracleUsdQuoteAlternative["quoteKind"]): number {
  switch (quoteKind) {
    case "stable-usdc":
    case "stable-usdt":
      return 0;
    case "sol-via-canonical-feed":
      return 1;
  }
}

function stableQuoteTieBreakRank(
  quoteKind: MintOracleUsdQuoteAlternative["quoteKind"],
): number {
  switch (quoteKind) {
    case "stable-usdc":
      return 0;
    case "stable-usdt":
      return 1;
    case "sol-via-canonical-feed":
      return 2;
  }
}

export async function discoverMintOracleUsdQuotePoolsForMint(
  args: DiscoverMintOracleUsdQuotePoolsArgs,
): Promise<MintOracleUsdQuotePoolSelection> {
  const mintAddress = toPublicKey(args.mintAddress, "Mint");
  const cluster = requireMintOracleCluster(args.cluster);
  const profile = mintOracleClusterProfile(cluster);
  const usdcMint = args.usdcMintAddress
    ? toPublicKey(args.usdcMintAddress, "UsdcMint")
    : profile.usdc;
  const solMint = args.solMintAddress
    ? toPublicKey(args.solMintAddress, "SolMint")
    : SOL_MINT;
  const usdtMint = args.usdtMintAddress
    ? toPublicKey(args.usdtMintAddress, "UsdtMint")
    : profile.usdt;
  assertAdmittedMintOracleClassicFeedQuoteMint(usdcMint, cluster);
  if (usdtMint != null) assertAdmittedMintOraclePoolQuoteMint(usdtMint, cluster);
  assertAdmittedMintOraclePoolQuoteMint(solMint, cluster);
  const expectedCanonicalSolQuoteFeedId = deriveMintPairFeedId({
    mintAddress: solMint,
    quoteMintAddress: usdcMint,
    cluster,
  });
  if (
    args.canonicalSolQuoteFeedId &&
    !sameBytes(
      bytes32(args.canonicalSolQuoteFeedId, "CanonicalSolQuoteFeedId"),
      expectedCanonicalSolQuoteFeedId,
    ) &&
    recoverMintPairFeedVariant(solMint, usdcMint, bytes32(args.canonicalSolQuoteFeedId, "CanonicalSolQuoteFeedId")) === null
  ) {
    throw new Error("InvalidCanonicalSolQuoteFeedId");
  }
  const stableQuotes: Array<{
    quoteMint: PublicKey;
    quoteKind: MintOracleUsdQuoteAlternative["quoteKind"];
  }> = [{
    quoteMint: usdcMint,
    quoteKind: "stable-usdc",
  }];
  if (usdtMint != null) {
    stableQuotes.push({
      quoteMint: usdtMint,
      quoteKind: "stable-usdt",
    });
  }
  const quoteRequests = [
    ...stableQuotes,
    ...(args.includeSolQuote !== false && !mintAddress.equals(solMint)
      ? [{ quoteMint: solMint, quoteKind: "sol-via-canonical-feed" as const }]
      : []),
  ];
  const alternatives: MintOracleUsdQuoteAlternative[] = [];
  const blockedWarnings: string[] = [];
  const quoteAlternatives = await Promise.all(quoteRequests.map(async (quote) => {
    if (mintAddress.equals(quote.quoteMint)) return null;
    if (
      quote.quoteKind === "sol-via-canonical-feed" &&
      !args.canonicalSolQuoteFeedId
    ) {
      blockedWarnings.push(
        "SOL quote route skipped because a canonical SOL/quote feed id is required for USD selection",
      );
      return null;
    }
    const discovered = await discoverMintOraclePoolsForMint({
      discoveryProvider: args.discoveryProvider,
      mintAddress,
      quoteMintAddress: quote.quoteMint,
      cluster,
      families: args.families,
      includeAdapterSeparate: args.includeAdapterSeparate,
      maxPoolsPerFamily: args.maxPoolsPerFamily,
      minProductionSourceCount: args.minProductionSourceCount,
      strict: args.strict,
      longTailPolicy: args.longTailPolicy,
    });
    if (discovered.selectedPools.length === 0) return null;
    return {
      ...discovered,
      quoteMintAddress: quote.quoteMint,
      quoteKind: quote.quoteKind,
      requiresSolQuoteFeed: quote.quoteKind === "sol-via-canonical-feed",
      requiresQuoteConversion: !quote.quoteMint.equals(usdcMint),
    };
  }));
  for (const alternative of quoteAlternatives) {
    if (alternative != null) alternatives.push(alternative);
  }
  const stableAlternatives = alternatives.filter(
    (alt) =>
      alt.quoteKind === "stable-usdc" ||
      alt.quoteKind === "stable-usdt",
  );
  const solAlternative =
    alternatives.find((alt) => alt.quoteKind === "sol-via-canonical-feed") ?? null;
  const ranked = [...alternatives].sort((a, b) => {
    const routeClassDelta =
      quoteAlternativeRank(a.quoteKind) - quoteAlternativeRank(b.quoteKind);
    if (routeClassDelta !== 0) return routeClassDelta;
    const riskDelta = b.programRiskTier.informedRiskTier - a.programRiskTier.informedRiskTier;
    if (riskDelta !== 0) return riskDelta;
    const scoreDelta = selectedPoolScore(b) - selectedPoolScore(a);
    if (scoreDelta !== 0) return scoreDelta;
    return stableQuoteTieBreakRank(a.quoteKind) - stableQuoteTieBreakRank(b.quoteKind);
  });
  const selected = ranked[0];
  if (selected == null) throw new Error("NoMintOracleUsdQuotePoolsFound");
  const warnings: string[] = [...blockedWarnings];
  if (stableAlternatives.length > 1) {
    warnings.push(
      "stable-USD alternatives are evaluated separately because current feed config has one quote mint",
    );
  }
  return {
    selected,
    alternatives: ranked,
    stableAlternatives,
    solAlternative,
    canonicalSolQuoteFeedId: args.canonicalSolQuoteFeedId
      ? bytes32(args.canonicalSolQuoteFeedId, "CanonicalSolQuoteFeedId")
      : null,
    warnings,
  };
}

export function buildMintOracleSourceConfigArgs(
  args: BuildMintOracleSourceConfigArgs,
): CompactSourceConfigArgs[] {
  const feedId = bytes32(args.feedId, "FeedId");
  const baseMint = toPublicKey(args.baseMint, "BaseMint");
  const quoteMint = toPublicKey(args.quoteMint, "QuoteMint");
  const cluster = requireMintOracleCluster(args.cluster);
  assertDistinctMintPair(baseMint, quoteMint);
  assertSupportedPumpSwapSelection(args.pools, baseMint);
  assertVerifiedMintOraclePools(args.pools, args.allowUnverifiedPools, cluster);
  const sourceConfigRevision = args.sourceConfigRevision ?? 1n;
  const sourceSetRevision = args.sourceSetRevision ?? 1n;
  const sourceIndices = resolveMintOraclePoolSourceIndices(args.pools);

  return args.pools.map((pool, index) => {
    const sourceIndex = sourceIndices[index] ?? index;
    assertSourceIndex(sourceIndex);
    if (!pool.vaultAuthority) {
      throw new Error("MissingPoolVaultAuthority");
    }
    const evidence = rpcMintOracleMarketEvidence(pool);
    const adapterType = sourceFamilyToAdapterType(pool.family);
    const adapterVersion = pool.family === "raydium-clmm"
      ? pool.adapterVersion ?? (pool.token2022Mint !== undefined ? 1 : 0)
      : pool.family === "pumpswap" || pool.family === "meteora-dlmm"
        ? pool.adapterVersion ?? (pool.token2022Mint !== undefined ? 1 : VERSION_V0)
        : VERSION_V0;
    const pumpswapV1 = pool.family === "pumpswap" && adapterVersion === 1;
    const meteoraDlmmV1 = pool.family === "meteora-dlmm" && adapterVersion === 1;
    if (adapterType !== SourceAdapterType.RaydiumClmm && !pumpswapV1 && !meteoraDlmmV1 && adapterVersion !== VERSION_V0) {
      throw new Error("UnsupportedMintOracleAdapterVersion");
    }
    if (pool.family === "raydium-clmm" && adapterVersion === 1) {
      if (!hasRouteableRaydiumClmmTickArrays(pool)) throw new Error("RaydiumClmmV1RequiresRouteableTickArrays");
      if (pool.token2022Mint === undefined) throw new Error("MissingToken2022Mint");
    } else if (pool.family === "raydium-clmm" && pool.token2022Mint !== undefined) {
      throw new Error("UnexpectedToken2022Mint");
    }
    if (meteoraDlmmV1 && pool.token2022Mint === undefined) throw new Error("MissingToken2022Mint");
    if (pool.family === "meteora-dlmm" && adapterVersion === VERSION_V0 && pool.token2022Mint !== undefined) {
      throw new Error("UnexpectedToken2022Mint");
    }
    const token2022Mint = pool.token2022Mint === undefined
      ? null
      : toPublicKey(pool.token2022Mint, "Token2022Mint");
    if (pumpswapV1 && (token2022Mint === null || !token2022Mint.equals(baseMint) || !pool.tokenProgram ||
        !toPublicKey(pool.tokenProgram, "TokenProgram").equals(SPL_TOKEN_2022_PROGRAM_ID))) {
      throw new Error("PumpSwapV1RequiresToken2022Base");
    }
    if (adapterVersion === 1 && token2022Mint !== null && !token2022Mint.equals(baseMint) && !token2022Mint.equals(quoteMint)) {
      throw new Error("InvalidToken2022Mint");
    }
    if (meteoraDlmmV1 && pool.tokenProgram !== undefined &&
        !toPublicKey(pool.tokenProgram, "TokenProgram").equals(SPL_TOKEN_2022_PROGRAM_ID)) {
      throw new Error("DlmmV1RequiresToken2022Mint");
    }
    const venueGroup = poolVenueGroup(pool);
    const operatorGroup = poolOperatorGroup(pool);
    const liquidityOwnerGroup =
      pool.liquidityOwnerGroup ?? UNKNOWN_CORRELATED_DOMAIN;
    const routeCorrelationGroup = poolRouteCorrelationGroup(pool);
    const quoteAssetGroup = poolQuoteAssetGroup(pool);
    const bridgeOrWrapperGroup = poolBridgeOrWrapperGroup(pool);
    const oracleSourceClass = poolOracleSourceClass(pool);
    const upgradeAuthorityGroup = poolUpgradeAuthorityGroup(pool);
    const maxSourceWeightBps =
      pool.maxSourceWeightBps ?? Math.ceil(10_000 / Math.max(args.pools.length, 1));
    for (const [name, value] of [
      ["VenueGroup", venueGroup],
      ["OperatorGroup", operatorGroup],
      ["LiquidityOwnerGroup", liquidityOwnerGroup],
      ["RouteCorrelationGroup", routeCorrelationGroup],
      ["QuoteAssetGroup", quoteAssetGroup],
      ["BridgeOrWrapperGroup", bridgeOrWrapperGroup],
      ["OracleSourceClass", oracleSourceClass],
      ["UpgradeAuthorityGroup", upgradeAuthorityGroup],
      ["MaxSourceWeightBps", maxSourceWeightBps],
    ] as const) {
      assertU16(value, name);
    }

    return {
      feedId,
      sourceIndex,
      adapterType,
      direction: SourceDirection.QuotePerBase,
      adapterVersion,
      venueGroup,
      operatorGroup,
      liquidityOwnerGroup,
      routeCorrelationGroup,
      quoteAssetGroup,
      bridgeOrWrapperGroup,
      oracleSourceClass,
      upgradeAuthorityGroup,
      maxSourceWeightBps,
      minLiquidityNative:
        currentMintOracleSourceConfigMinLiquidityFloor(pool, evidence),
      minDepthTo50BpsNative: currentMintOracleSourceConfigMinDepthFloor(
        pool,
        evidence,
      ),
      programId: defaultProgramIdForSourceFamily(
        pool.family,
        cluster,
      ).toBuffer(),
      poolOrMarket: toPublicKey(pool.poolOrMarket, "PoolOrMarket").toBuffer(),
      baseVault: toPublicKey(pool.baseVault, "BaseVault").toBuffer(),
      quoteVault: toPublicKey(pool.quoteVault, "QuoteVault").toBuffer(),
      tokenProgram: (pool.family === "pumpswap"
        ? requiredPoolAccount(pool.tokenProgram, "TokenProgram")
        : adapterVersion === 1
          ? SPL_TOKEN_2022_PROGRAM_ID
        : CANONICAL_SPL_TOKEN_PROGRAM_ID
      ).toBuffer(),
      vaultAuthority: toPublicKey(
        pool.vaultAuthority,
        "VaultAuthority",
      ).toBuffer(),
      sourceConfigRevision,
      sourceSetRevision,
    };
  }).sort((a, b) => a.sourceIndex - b.sourceIndex);
}

export function computeMintOracleSourceSetHash(
  sourceConfigArgs: readonly CompactSourceConfigArgs[],
): Buffer {
  const canonicalSources = canonicalMintOracleSourceConfigArgs(sourceConfigArgs);
  const hasher = createHash("sha256");
  hasher.update(Buffer.from("MIMIR_MINT_ORACLE_SOURCE_SET_V1", "ascii"));
  for (const source of canonicalSources) {
    hasher.update(bytes32(source.feedId, "FeedId"));
    hasher.update(Buffer.from([source.sourceIndex, source.adapterType]));
    hasher.update(source.programId);
    hasher.update(source.poolOrMarket);
    hasher.update(source.baseVault);
    hasher.update(source.quoteVault);
  }
  return hasher.digest();
}

function canonicalMintOracleSourceConfigArgs(
  sourceConfigArgs: readonly CompactSourceConfigArgs[],
): CompactSourceConfigArgs[] {
  const seen = new Set<number>();
  return [...sourceConfigArgs]
    .map((source) => {
      assertSourceIndex(source.sourceIndex);
      if (seen.has(source.sourceIndex)) throw new Error("DuplicateSourceIndex");
      seen.add(source.sourceIndex);
      return source;
    })
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
}

function hasRouteableRaydiumClmmTickArrays(
  pool: MintOracleDiscoveredPool,
): boolean {
  return (
    pool.family === "raydium-clmm" &&
    pool.lowerTickArray != null &&
    pool.activeTickArray != null &&
    pool.upperTickArray != null
  );
}

function requiredPoolAccount(
  account: PublicKeyInput | undefined,
  name: string,
): PublicKey {
  if (account === undefined) throw new Error(`Missing${name}`);
  return toPublicKey(account, name);
}
