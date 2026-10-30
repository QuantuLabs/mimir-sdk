import assert from "node:assert/strict";
import { encodeMimirFusedClassicData } from "../src/beta/classicExecution.js";
import { readFileSync } from "node:fs";
import {
  createHash,
  sign as signMessage,
  } from "node:crypto";
import { classifyMeteoraDlmmDualReadiness, decodeMimirBrowserCompositeSnapshotHeader, decodeMimirBrowserSourceRingFields } from "../src/internal/nativeMonoRefreshCore.js";
import { createMimirBetaReconciliationSemanticHash } from "../src/beta/reconciliation.js";
import { bytesAddress } from "../src/beta/bytes.js";
import { sourceAdapterSupportsVersion as betaSourceAdapterSupportsVersion } from "../src/beta/types.js";
import { ObservationKind, sourceAdapterSupportsVersion as sharedSourceAdapterSupportsVersion } from "../src/constants.js";
import { findProtocolTreasuryPda, findSourceTemporalPda } from "../src/pda.js";
import { createWithdrawProtocolTreasuryV1Instruction, encodeWithdrawProtocolTreasuryV1Data } from "../src/instructions.js";
import { REFRESH_SOURCE_RING_V1_LEN } from "../src/constants.js";
import { readRaydiumClmmPoolObservationKey, METEORA_DLMM_PROGRAMDATA_ADDRESS, ACCEPTED_METEORA_DLMM_DEPLOYMENT_UNIX } from "../src/codec.js";
import { decodeCpmmQuietTemporalModuleV2,  decodeSourceObservationRingV1Header, decodeSourceTemporalModuleV1, SOURCE_RING_DAMM_ONLYB_V1 } from "../src/codec.js";
import { decodeMimirBetaLiveRing } from "../src/beta/liveAbi.js";
import {  decodeMimirBetaLiveSourceTemporalModuleV1 } from "../src/beta/index.js";

{
  const pool = Buffer.alloc(1544), oracle = new Uint8Array(32).fill(7);
  pool.set([247, 237, 227, 245, 215, 195, 222, 70]); pool.set(oracle, 201);
  assert.deepEqual(readRaydiumClmmPoolObservationKey(pool), oracle);
  assert.throws(() => readRaydiumClmmPoolObservationKey(pool.subarray(1)), /InvalidRaydiumClmmPoolState/);
  pool[0] ^= 1;
  assert.throws(() => readRaydiumClmmPoolObservationKey(pool), /InvalidRaydiumClmmPoolState/);
  pool[0] ^= 1; pool.fill(0, 201, 233);
  assert.throws(() => readRaydiumClmmPoolObservationKey(pool), /InvalidRaydiumClmmPoolState/);
}

process.env.MIMIR_ALLOW_UNVERIFIED_TEST_FIXTURES = "1";

import {
  AnchorProvider,
  AnchorStatus,
  MIMIR_MAINNET_PROGRAM_ADDRESS,
  MIMIR_MAINNET_PROGRAM_ID,
  MIMIR_PROGRAM_ID,
  MIMIR_MAINNET_COLA_MINT,
  MIMIR_MAINNET_USDC_MINT,
  MIMIR_MAINNET_USDT_MINT,
  MIMIR_SOL_MINT,
  isRetryableMimirRevisionDrift,
  parseMimirProgramError,
  resolveMimirProgramProfile,
  
  adapterMaskForSourceFamilies,
  
  
  
  
  
  
  
  
  buildMintOracleSourceConfigArgs,
  
  
  
  
  
  classifyMimirMintAuthorityPolicy,
  computeMeteoraDlmmNativeTwapPriceX64,
  METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS,
  METEORA_DLMM_NATIVE_TWAP_MAX_LAST_UPDATE_AGE_SECS,
  computeRaydiumCpmmNativeTwapPriceX64ForFeed,
  extractMeteoraDlmmNativeTwapSample,
  readMeteoraDlmmPoolObservationKey,
  extractRaydiumCpmmNativeTwapObservationSample,
  projectRaydiumCpmmObservationAfterCrank,
  RaydiumCpmmNativeTwapWindowWarmingError,
  MimirNativeTwapUnavailableError,
  
  
  computeTierAAnchorPolicyHash,
  
  evaluateTierAAnchorPolicy,
  
  
  
  stringifyAnchorPolicyReport,
  
  
  
  
  
  
  
  
  
  
  
  
  buildRouteableDepthEvidenceFromRanges,
  buildRouteableDepthEvidenceFromDecodedLevels,
  computeRouteableDepthAccountDataHash,
  computeRouteableDepthAccountBundleHash,
  computeRouteableDepthAccountBundleSetHash,
  fetchRouteableDepthAccountBundle,
  evaluateNewGovernanceActionHeader,
  evaluateGovernanceActionApproval,
  
  computeRouteableDepthAdapterFixtureHash,
  computeRouteableDepthAdapterFixtureSetHash,
  computeRouteableDepthTraversalHash,
  computeRouteableDepthTraversalSetHash,
  computeRouteableDepthRangeEvidenceHash,
  computeFeeLossVectorHash,
  evaluateRouteableDepthEvidence,
  evaluateFeeLossVector,
  stringifyRouteableDepthRangeEvidenceReport,
  stringifyFeeLossVectorReport,
  
  
  CONFIG_OFFSETS,
  computeCpmmSourceAccountsHash,
  computePumpSwapSourceAccountsHash,
  
  
  computeMeteoraDammV2SourceAccountsHash,
  computeMeteoraDlmmRouteableSourceAccountsHash,
  computeMeteoraDlmmSourceAccountsHash,
  computeMintOraclePoolScore,
  discoverMintOraclePoolsForMint,
  discoverMintOracleUsdQuotePoolsForMint,
  defaultProgramIdForSourceFamily,
  verifyMintOraclePoolsWithRpc,
  
  
  evaluateMintOracleProgramRiskTier,
  evaluateMintOracleLongTailPools,
  
  
  
  
  
  computeOrcaWhirlpoolRouteableSourceAccountsHash,
  computeOrcaWhirlpoolSourceAccountsHash,
  
  computeRaydiumClmmRouteableSourceAccountsHash,
  computeRaydiumClmmSourceAccountsHash,
  computeRetainedRingSourcesAccountsHash,
  
  
  
  
  createClaimRefreshFeesV1Instruction,
  buildCompositeSumOfPricesComponents,
  buildCompositeSumOfPricesConfig,
  
  encodeCompositeFeedConfigHeader,
  
  
  
  
  createUpsertAdminConfigV1Instruction,
  createFeedCreationCollateralAccountMetas,
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  createMimirAuditedDirectReadConsumerInstructions,
  createMimirCompositeRefreshReadConsumerInstructions,
  createMimirRefreshReadConsumerInstructions,
  createGovernanceActionInstruction,
  
  upsertGovernancePolicyInstruction,
  
  
  
  cpmmZeroFeeImmediateUnwindBounds,
  meteoraDlmmPriceFromCumulativeBinX64,
  meteoraDlmmPriceFromIdX64,
  normalizedCpmmPriceX64,
  normalizedDirectQ64PriceX64,
  normalizedInverseQ64PriceX64,
  reclaimFeedReservationInstruction,
  upsertRegistryInstruction,
  approveGovernanceActionInstruction,
  computeGovernancePolicyActionHash,
  computeRegistryGovernanceActionHash,
  computeCompositeComponentSnapshotHash,
  computeCompositeComponentSetHash,
  deriveCompositeFeedId,
  deriveMintPairFeedId,
  calculateFeedFeeVaultClaims,
  decodeAdminConfigHeader,
  decodeCompositeFeedConfigHeader,
  decodeCompositeSnapshotHeader,
  decodeFeedCollateralLockHeader,
  decodeFeedConfigHeader,
  decodeFeedFeeVaultHeader,
  
  decodeFeedReservationHeader,
  decodeFeedTwapStateHeader,
  decodeGovernanceActionHeader,
  decodeGovernancePolicyHeader,
  
  decodeOracleRegistryHeader,
  decodeSourceConfigHeader,
  
  decodeSourceObservationRingHeader,
  decodeLifecycleFeedConfigHeader,
  decodeSourcingPlanHeader,
  decodeFeedSnapshotHeader,
  ADMIN_CONFIG_HEADER_LEN,
  ADMIN_CONFIG_MAGIC,
  ADMIN_CONFIG_OFFSETS,
  EXECUTABLE_SOURCE_ADAPTER_MASK_V0,
  FEED_COLLATERAL_LOCK_HEADER_LEN,
  FEED_COLLATERAL_LOCK_MAGIC,
  FEED_COLLATERAL_LOCK_OFFSETS,
  FEED_FEE_VAULT_HEADER_LEN,
  FEED_FEE_VAULT_MAGIC,
  FEED_FEE_VAULT_OFFSETS,
  FEED_SNAPSHOT_MIN_HEADER_LEN,
  FEED_TWAP_HEADER_LEN,
  COMPOSITE_COMPONENT_CONFIG_LEN,
  COMPOSITE_COMPONENT_OFFSETS,
  COMPOSITE_CONFIG_OFFSETS,
  COMPOSITE_FEED_CONFIG_HEADER_LEN,
  COMPOSITE_FEED_CONFIG_MAGIC,
  COMPOSITE_SNAPSHOT_COMPONENT_LEN,
  COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS,
  COMPOSITE_SNAPSHOT_HEADER_LEN,
  COMPOSITE_SNAPSHOT_MAGIC,
  COMPOSITE_SNAPSHOT_OFFSETS,
  
  
  
  
  FeedLifecycleState,
  FreshnessProfile,
  GOVERNANCE_ACTION_OFFSETS,
  GovernanceActionTargetKind,
  GovernanceActionStatus,
  GOVERNANCE_POLICY_OFFSETS,
  isMimirAdmittedFeedCreationCollateralMint,
  isMimirOperatorControlledAuthorityMint,
  
  
  OFFSETS,
  METEORA_DLMM_PROGRAM_ID,
  METEORA_DAMM_V2_PROGRAM_ID,
  
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORCA_WHIRLPOOLS_CONFIG_MAINNET,
  PLAN_OFFSETS,
  PlanStatus,
  QuoteStatus,
  RAYDIUM_CLMM_MAINNET_PROGRAM_ID,
  RAYDIUM_CPMM_MAINNET_PROGRAM_ID,
  RAYDIUM_CPMM_POOL_OBSERVATION_KEY_OFFSET,
  RAYDIUM_CPMM_POOL_OFFSET_AMM_CONFIG,
  RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR,
  RAYDIUM_CPMM_OBSERVATION_STATE_INDEX_OFFSET,
  RAYDIUM_CPMM_OBSERVATION_STATE_INITIALIZED_OFFSET,
  RAYDIUM_CPMM_OBSERVATION_STATE_LAST_UPDATE_TIMESTAMP_OFFSET,
  RAYDIUM_CPMM_OBSERVATION_STATE_LEN,
  RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_LEN,
  RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATIONS_OFFSET,
  RAYDIUM_CPMM_OBSERVATION_STATE_POOL_ID_OFFSET,
  RAYDIUM_CPMM_POOL_OFFSET_MINT_0_DECIMALS,
  RAYDIUM_CPMM_POOL_OFFSET_MINT_1_DECIMALS,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_PROGRAM,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_MINT,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_PROGRAM,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_VAULT,
  RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR,
  
  ROUTEABLE_DEPTH_ADAPTER_FIXTURE_HASH_DOMAIN,
  ROUTEABLE_DEPTH_ADAPTER_FIXTURE_SET_HASH_DOMAIN,
  ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_HASH_DOMAIN,
  ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_SET_HASH_DOMAIN,
  ROUTEABLE_DEPTH_ACCOUNT_DATA_HASH_DOMAIN,
  ROUTEABLE_DEPTH_RANGE_EVIDENCE_HASH_DOMAIN,
  ROUTEABLE_DEPTH_TRAVERSAL_HASH_DOMAIN,
  ROUTEABLE_DEPTH_TRAVERSAL_SET_HASH_DOMAIN,
  FEE_LOSS_VECTOR_HASH_DOMAIN,
  MINT_ORACLE_MARKET_FLAGS,
  
  
  
  
  REFRESH_FEED_TWAP_FROM_RINGS_AND_SNAPSHOT_LEN,
  
  CLAIM_REFRESH_FEES_V1_LEN,
  CLAIM_REFRESH_FEES_V1_TAG,
  
  
  
  
  
  
  
  
  
  UPSERT_ADMIN_CONFIG_V1_LEN,
  UPSERT_ADMIN_CONFIG_V1_TAG,
  
  
  REFRESH_METEORA_RAYDIUM_CLMM_SOURCES_AND_FEED_TWAP_LEN,
  
  REFRESH_ORCA_METEORA_DLMM_SOURCES_AND_FEED_TWAP_LEN,
  
  REFRESH_ORCA_METEORA_RAYDIUM_CLMM_SOURCES_AND_FEED_TWAP_LEN,
  
  REFRESH_ORCA_RAYDIUM_CLMM_SOURCES_AND_FEED_TWAP_LEN,
  
  
  
  
  RECLAIM_FEED_RESERVATION_LEN,
  
  
  REFRESH_SOURCE_RING_FROM_METEORA_DLMM_LEN,
  REFRESH_SOURCE_RING_FROM_ORCA_WHIRLPOOL_LEN,
  
  REFRESH_SOURCE_RING_FROM_RAYDIUM_CLMM_LEN,
  REFRESH_TWAP_POLICY_LEN,
  RING_OFFSETS,
  REGISTRY_ADAPTER_VERSION_MASK_BYTES,
  REGISTRY_OFFSETS,
  RegistryStatus,
  RESERVATION_OFFSETS,
  RouteabilityStatus,
  RiskTier,
  SnapshotSource,
  SnapshotStatus,
  SOURCE_OFFSETS,
  SourceAdapterType,
  isKnownSourceAdapterType,
  isSupportedSourceAdapterTypeV0,
  SourceDirection,
  SourceStatus,
  PUMPSWAP_FEE_PROGRAM_ID,
  PUMPSWAP_PROGRAM_ID,
  SPL_TOKEN_2022_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  
  
  
  
  
  
  
  
  
  
  
  
  TWAP_OFFSETS,
  TwapStatus,
  UNKNOWN_CORRELATED_DOMAIN,
  findAdminConfigPda,
  findCompositeFeedConfigPda,
  findCompositeSnapshotPda,
  findFeedCollateralLockPda,
  findFeedConfigPda,
  
  findFeedFeeVaultPda,
  findFeedReservationPda,
  findFeedTwapPda,
  findNativeTwapProofPda,
  findGovernanceActionPda,
  findGovernancePolicyPda,
  
  findOracleRegistryPda,
  findSourceConfigPda,
  
  findSourceRingPda,
  findRaydiumCpmmObservationStatePda,
  findMeteoraDlmmObservationStatePda,
  findSourcingPlanPda,
  findFeedSnapshotPda,
  
  
  
  
  VERIFY_SNAPSHOT_TAG,
  VerifyFlags,
  Q64,
  
  
  squareQ64ToX64,
  
  selectMintOraclePools,
  MINT_ORACLE_DEFAULT_DISCOVERY_SOURCE_FAMILIES,
  sourceFamilyToAdapterType,
  
  normalizedRegistryAdapterVersionMask,
  
  registrySupportsAdapterVersion,
  
  
  
  verifyRegistryAdapterVersionPolicy,
  verifyFeedConfigForSnapshot,
  
  
  verifyFeedReservationAccount,
  verifyCompositeSnapshotAccount,
  verifyFeedSnapshotAccount,
  verifyFeedTwapStateAccount,
  verifyFeedTwapStateHeader,
  verifyRegistryForSnapshot,
  verifySourceConfigAccount,
  verifySourceConfigHeader,
  
  
  verifySourceObservationRingAccount,
  verifySourceObservationRingHeader,
  verifySourcingPlanForSnapshot,
  verifySnapshotHeader,
  isMimirAdmittedQuoteMint,
  isMimirClassicFeedQuoteMint,
  isMimirStablecoinAuthorityBypassMint,
  
} from "../src/index.js";

const CURRENT_RING_VERSION = 1;
const currentRing = (sourceIndex = 0, overrides?: (data: Buffer) => void) =>
  toTestSourceRingV1(buildTestSourceObservationRingHeader(sourceIndex, (data) => {
    data[RING_OFFSETS.adapterType] = SourceAdapterType.RaydiumCpmm;
    overrides?.(data);
  }));
const OLD_DEVNET_PROGRAM_ID = new PublicKey(
  "GqGbSz8rncAyJRpDgJ1RN7vBvkaAi3dXRF4xNQfFuMVe",
);
const OLD_LEGACY_PROGRAM_ID = new PublicKey(
  "6PCcv1q4pSzqyvyMkyNyBNaXdND8ESdjcPqdQuRsb4xM",
);
const OLD_CUSDC_MINT = new PublicKey(
  "DRStb6fqmiX4zssMU1mEJEXRpoKcDDtsXuENAKeJ1wTQ",
);
const OLD_DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);
const OLD_DEVNET_COLA_MINT = new PublicKey(
  "ADb8dPPZK2LU3BVyuEfwGbQ1FujEAtRDxdhaTreLV9ij",
);
import {
  
  createVerifySnapshotInstruction,
  
} from "../src/instructions.js";
import {
  buildTestCreatedFeedConfigHeader,
  buildTestCpmmSourceConfigHeader,
  buildTestFeedConfigHeader,
  
  buildTestMeteoraDlmmSourceConfigHeader,
  
  buildTestOrcaWhirlpoolSourceConfigHeader,
  buildTestRaydiumClmmSourceConfigHeader,
  buildTestFeedReservationHeader,
  buildTestFeedTwapStateHeader,
  
  buildTestGovernanceActionHeader,
  buildTestGovernancePolicyHeader,
  
  buildTestOracleRegistryHeader,
  buildTestSourceConfigHeader,
  
  buildTestSourceObservationRingHeader,
  toTestSourceRingV1,
  toTestFeedConfigV1,
  buildTestSourcingPlanHeader,
  buildTestSnapshotHeader,
  defaultTestRefreshTwapPolicy,
  defaultTestSnapshotPolicy,
  TEST_CLOCK_SLOT,
  TEST_ANCHOR_POLICY_HASH,
  TEST_NATIVE_EXCEPTION_HASH,
  TEST_PLAN_HASH,
  TEST_RING_VERSION,
  TEST_TWAP_VERSION,
  TEST_FEED_ID,
  TEST_GOVERNANCE_AUTHORITY,
  TEST_GOVERNANCE_SIGNER_1,
  TEST_GOVERNANCE_SIGNER_2,
  TEST_TWAP_PRICE_X64
} from "../src/fixtures.js";
import {
  
  createLocalnetFixtureUpsertFeedTwapInstruction,
  createLocalnetFixtureUpsertRegistryInstruction,
  createLocalnetFixtureUpsertSnapshotInstruction,
  createLocalnetFixtureUpsertSourceConfigInstruction,
  
  
  createLocalnetFixtureUpsertSourcingPlanInstruction,
} from "../scripts/localnetFixtureInstructions.js";
import {
  type AccountInfo,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionMessage,
  TransactionInstruction,
} from "@solana/web3.js";

process.env.MIMIR_ALLOW_UNVERIFIED_TEST_FIXTURES = "1";

const TEST_U64_MASK = (1n << 64n) - 1n;
function testPublicKey(seed: number): PublicKey {
  return new PublicKey(Buffer.alloc(32, seed));
}

function buildTestFeedCollateralLockHeader(
  overrides?: (data: Buffer) => void,
): Buffer {
  const data = Buffer.alloc(FEED_COLLATERAL_LOCK_HEADER_LEN);
  FEED_COLLATERAL_LOCK_MAGIC.copy(data, FEED_COLLATERAL_LOCK_OFFSETS.magic);
  data.writeUInt16LE(0, FEED_COLLATERAL_LOCK_OFFSETS.version);
  data.writeUInt16LE(
    FEED_COLLATERAL_LOCK_HEADER_LEN,
    FEED_COLLATERAL_LOCK_OFFSETS.headerLen,
  );
  Buffer.from(TEST_FEED_ID).copy(data, FEED_COLLATERAL_LOCK_OFFSETS.feedId);
  testPublicKey(201).toBuffer().copy(
    data,
    FEED_COLLATERAL_LOCK_OFFSETS.creator,
  );
  testPublicKey(202).toBuffer().copy(
    data,
    FEED_COLLATERAL_LOCK_OFFSETS.collateralMint,
  );
  data.writeBigUInt64LE(50_000n, FEED_COLLATERAL_LOCK_OFFSETS.lockedAmountRaw);
  data.writeBigUInt64LE(123_456n, FEED_COLLATERAL_LOCK_OFFSETS.createdSlot);
  data.writeBigInt64LE(1_765_000_000n, FEED_COLLATERAL_LOCK_OFFSETS.createdUnixTs);
  data.writeBigUInt64LE(
    7n,
    FEED_COLLATERAL_LOCK_OFFSETS.adminConfigRevisionAtCreation,
  );
  data[FEED_COLLATERAL_LOCK_OFFSETS.status] = 1;
  data[FEED_COLLATERAL_LOCK_OFFSETS.bump] = 254;
  overrides?.(data);
  return data;
}

function buildTestFeedFeeVaultHeader(overrides?: (data: Buffer) => void): Buffer {
  const data = Buffer.alloc(FEED_FEE_VAULT_HEADER_LEN);
  FEED_FEE_VAULT_MAGIC.copy(data, FEED_FEE_VAULT_OFFSETS.magic);
  data.writeUInt16LE(1, FEED_FEE_VAULT_OFFSETS.version);
  data.writeUInt16LE(FEED_FEE_VAULT_HEADER_LEN, FEED_FEE_VAULT_OFFSETS.headerLen);
  Buffer.from(TEST_FEED_ID).copy(data, FEED_FEE_VAULT_OFFSETS.feedId);
  testPublicKey(203).toBuffer().copy(data, FEED_FEE_VAULT_OFFSETS.compositeConfig);
  testPublicKey(204).toBuffer().copy(data, FEED_FEE_VAULT_OFFSETS.identityAsset);
  data.writeBigUInt64LE(80_000n, FEED_FEE_VAULT_OFFSETS.ownerGeneratedLamports);
  data.writeBigUInt64LE(100_001n, FEED_FEE_VAULT_OFFSETS.totalRefreshFeesLamports);
  data.writeBigUInt64LE(5_000n, FEED_FEE_VAULT_OFFSETS.ownerClaimedLamports);
  data.writeBigUInt64LE(20_001n, FEED_FEE_VAULT_OFFSETS.treasuryPaidLamports);
  data.writeBigUInt64LE(
    8n,
    FEED_FEE_VAULT_OFFSETS.lastAccrualConfigRevision,
  );
  data[FEED_FEE_VAULT_OFFSETS.status] = 1;
  data[FEED_FEE_VAULT_OFFSETS.bump] = 253;
  overrides?.(data);
  return data;
}

function buildTestAdminConfigHeader(overrides?: (data: Buffer) => void): Buffer {
  const data = Buffer.alloc(ADMIN_CONFIG_HEADER_LEN);
  ADMIN_CONFIG_MAGIC.copy(data, ADMIN_CONFIG_OFFSETS.magic);
  data.writeUInt16LE(1, ADMIN_CONFIG_OFFSETS.version);
  data.writeUInt16LE(ADMIN_CONFIG_HEADER_LEN, ADMIN_CONFIG_OFFSETS.headerLen);
  data[ADMIN_CONFIG_OFFSETS.status] = 1;
  data[ADMIN_CONFIG_OFFSETS.bump] = 252;
  testPublicKey(211).toBuffer().copy(data, ADMIN_CONFIG_OFFSETS.adminAuthority);
  testPublicKey(212).toBuffer().copy(data, ADMIN_CONFIG_OFFSETS.collateralMint);
  data.writeBigUInt64LE(50_000n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw);
  data[ADMIN_CONFIG_OFFSETS.collateralRequired] = 1;
  data.writeUInt16LE(8_000, ADMIN_CONFIG_OFFSETS.compositeOwnerShareBps);
  data.writeBigUInt64LE(1_000n, ADMIN_CONFIG_OFFSETS.compositeRefreshFeeLamports);
  testPublicKey(213).toBuffer().copy(data, ADMIN_CONFIG_OFFSETS.feeTreasury);
  data.writeBigUInt64LE(9n, ADMIN_CONFIG_OFFSETS.configRevision);
  testPublicKey(214).toBuffer().copy(data, ADMIN_CONFIG_OFFSETS.rentRecoveryDestination);
  overrides?.(data);
  return data;
}

const mintOracleBaseMint = testPublicKey(31);
const mintOracleQuoteMint = MIMIR_MAINNET_USDC_MINT;
const [mintOracleRegistry] = findOracleRegistryPda(0, MIMIR_PROGRAM_ID);
const localnetMintOracleFeedId = deriveMintPairFeedId({
  mintAddress: mintOracleBaseMint,
  quoteMintAddress: mintOracleQuoteMint,
  cluster: "localnet",
});
assert.equal(isMimirAdmittedQuoteMint(MIMIR_MAINNET_USDC_MINT, "mainnet"), true);
assert.equal(isMimirAdmittedQuoteMint(MIMIR_MAINNET_USDT_MINT, "mainnet"), true);
assert.equal(isMimirAdmittedQuoteMint(MIMIR_SOL_MINT, "mainnet"), true);
assert.equal(isMimirAdmittedQuoteMint(MIMIR_MAINNET_USDC_MINT, "localnet"), true);
assert.equal(isMimirAdmittedQuoteMint(MIMIR_MAINNET_USDT_MINT, "localnet"), true);
assert.equal(isMimirAdmittedQuoteMint(MIMIR_SOL_MINT, "localnet"), true);
assert.equal(isMimirAdmittedQuoteMint(OLD_CUSDC_MINT, "mainnet"), false);
assert.equal(isMimirAdmittedQuoteMint(OLD_CUSDC_MINT, "localnet"), false);
assert.equal(isMimirAdmittedQuoteMint(OLD_DEVNET_USDC_MINT, "localnet"), false);
assert.equal(isMimirAdmittedQuoteMint(testPublicKey(99), "localnet"), false);
assert.equal(isMimirClassicFeedQuoteMint(MIMIR_MAINNET_USDC_MINT, "mainnet"), true);
assert.equal(isMimirClassicFeedQuoteMint(MIMIR_MAINNET_USDT_MINT, "mainnet"), false);
assert.equal(isMimirClassicFeedQuoteMint(MIMIR_SOL_MINT, "mainnet"), true);
assert.equal(
  classifyMimirMintAuthorityPolicy(MIMIR_MAINNET_USDC_MINT),
  "stablecoin-allowlist-bypass",
);
assert.equal(
  classifyMimirMintAuthorityPolicy(MIMIR_MAINNET_USDT_MINT),
  "stablecoin-allowlist-bypass",
);
assert.equal(
  classifyMimirMintAuthorityPolicy(MIMIR_MAINNET_COLA_MINT),
  "operator-controlled-strict",
);
assert.equal(classifyMimirMintAuthorityPolicy(OLD_CUSDC_MINT), "unclassified");
assert.equal(classifyMimirMintAuthorityPolicy(OLD_DEVNET_COLA_MINT), "unclassified");
assert.equal(isMimirOperatorControlledAuthorityMint(MIMIR_MAINNET_USDC_MINT), false);
assert.equal(isMimirOperatorControlledAuthorityMint(MIMIR_MAINNET_COLA_MINT), true);
assert.equal(isMimirStablecoinAuthorityBypassMint(MIMIR_MAINNET_USDC_MINT), true);
assert.equal(isMimirStablecoinAuthorityBypassMint(MIMIR_MAINNET_USDT_MINT), true);
assert.equal(isMimirStablecoinAuthorityBypassMint(OLD_CUSDC_MINT), false);
assert.equal(
  defaultProgramIdForSourceFamily("raydium-clmm", "localnet").toBase58(),
  RAYDIUM_CLMM_MAINNET_PROGRAM_ID.toBase58(),
);
assert.equal(
  defaultProgramIdForSourceFamily("raydium-cpmm", "localnet").toBase58(),
  RAYDIUM_CPMM_MAINNET_PROGRAM_ID.toBase58(),
);

const mintOraclePools = [
  {
    family: "raydium-clmm" as const,
    poolOrMarket: testPublicKey(43),
    baseVault: testPublicKey(44),
    quoteVault: testPublicKey(45),
    vaultAuthority: testPublicKey(67),
    tvlUsd: 15_000,
    sourceIndex: 2,
  },
  {
    family: "orca-whirlpool" as const,
    poolOrMarket: testPublicKey(46),
    baseVault: testPublicKey(47),
    quoteVault: testPublicKey(48),
    whirlpoolsConfig: testPublicKey(76),
    vaultAuthority: testPublicKey(68),
    tvlUsd: 20_000,
    sourceIndex: 0,
  },
  {
    family: "meteora-dlmm" as const,
    poolOrMarket: testPublicKey(49),
    baseVault: testPublicKey(50),
    quoteVault: testPublicKey(51),
    activeBinArray: testPublicKey(77),
    vaultAuthority: testPublicKey(69),
    tvlUsd: 30_000,
    sourceIndex: 1,
  },
];
const selectedMintOraclePools = selectMintOraclePools({
  pools: mintOraclePools,
  minProductionSourceCount: 3,
});
assert.deepEqual(
  selectedMintOraclePools.selectedPools.map((pool) => pool.family),
  ["raydium-clmm", "meteora-dlmm", "orca-whirlpool"],
);
assert.equal(
  computeMintOraclePoolScore({
    family: "raydium-clmm",
    poolOrMarket: testPublicKey(60),
    baseVault: testPublicKey(61),
    quoteVault: testPublicKey(62),
    vaultAuthority: testPublicKey(70),
    tvlUsd: 1_000_000,
    depthTo50BpsUsd: 400_000,
    volume24hUsd: 2_000_000,
  }),
  0,
);
assert.equal(
  computeMintOraclePoolScore({
    family: "orca-whirlpool",
    poolOrMarket: testPublicKey(63),
    baseVault: testPublicKey(64),
    quoteVault: testPublicKey(65),
    vaultAuthority: testPublicKey(71),
    tvlUsd: 100_000,
    depthTo50BpsUsd: 20_000,
    volume24hUsd: 50_000,
    spreadBps: 90,
  }),
  0,
);
assert.deepEqual(
  MINT_ORACLE_DEFAULT_DISCOVERY_SOURCE_FAMILIES,
  ["raydium-clmm", "meteora-dlmm", "meteora-damm-v2", "orca-whirlpool", "raydium-cpmm"],
);
assert.equal(
  sourceFamilyToAdapterType("orca-whirlpool"),
  SourceAdapterType.OrcaWhirlpool,
);
const mintOraclePoolsWithCpmm = [
  ...mintOraclePools,
  {
    family: "raydium-cpmm" as const,
    poolOrMarket: testPublicKey(72),
    baseVault: testPublicKey(73),
    quoteVault: testPublicKey(74),
    vaultAuthority: testPublicKey(75),
    tvlUsd: 200_000,
    sourceIndex: 4,
  },
];
const selectedMintOraclePoolsWithSeparateCpmm = selectMintOraclePools({
  pools: mintOraclePoolsWithCpmm,
  includeAdapterSeparate: true,
  minProductionSourceCount: 3,
});
assert.deepEqual(
  selectedMintOraclePoolsWithSeparateCpmm.selectedPools.map((pool) => pool.family),
  ["raydium-clmm", "meteora-dlmm", "orca-whirlpool"],
);
assert.equal(
  selectedMintOraclePoolsWithSeparateCpmm.warnings.some((warning) =>
    warning.includes("kept on the separate CPMM adapter path"),
  ),
  true,
);
const selectedMintOracleCpmmOnlyPools = selectMintOraclePools({
  pools: [
    {
      family: "raydium-cpmm" as const,
      poolOrMarket: testPublicKey(78),
      baseVault: testPublicKey(79),
      quoteVault: testPublicKey(80),
      vaultAuthority: testPublicKey(81),
      tvlUsd: 100_000,
    },
  ],
  includeAdapterSeparate: true,
});
assert.deepEqual(
  selectedMintOracleCpmmOnlyPools.selectedPools.map((pool) => pool.family),
  ["raydium-cpmm"],
);
const cpmmThreeSameVenueRisk = evaluateMintOracleProgramRiskTier({
  pools: [0, 1, 2].map((index) => ({
    family: "raydium-cpmm" as const,
    poolOrMarket: testPublicKey(82 + index * 3),
    baseVault: testPublicKey(83 + index * 3),
    quoteVault: testPublicKey(84 + index * 3),
    vaultAuthority: testPublicKey(91 + index),
    sourceIndex: index,
  })),
});
assert.equal(cpmmThreeSameVenueRisk.maxRefreshRiskTier, RiskTier.TierC);
assert.equal(cpmmThreeSameVenueRisk.informedRiskTier, RiskTier.TierC);
const cpmmThreeIndependentRisk = evaluateMintOracleProgramRiskTier({
  pools: [0, 1, 2].map((index) => ({
    family: "raydium-cpmm" as const,
    poolOrMarket: testPublicKey(101 + index * 3),
    baseVault: testPublicKey(102 + index * 3),
    quoteVault: testPublicKey(103 + index * 3),
    vaultAuthority: testPublicKey(110 + index),
    venueGroup: index + 1,
    routeCorrelationGroup: index + 1,
    sourceIndex: index,
  })),
  anchorPolicyHash: TEST_ANCHOR_POLICY_HASH,
  nativeTierAExceptionHash: TEST_NATIVE_EXCEPTION_HASH,
});
assert.equal(cpmmThreeIndependentRisk.maxRefreshRiskTier, RiskTier.TierB);
assert.equal(cpmmThreeIndependentRisk.informedRiskTier, RiskTier.TierB);
assert.equal(cpmmThreeIndependentRisk.venueCount, 3);
assert.equal(cpmmThreeIndependentRisk.correlationGroupCount, 3);
assert.equal(
  cpmmThreeIndependentRisk.warnings.some((warning) =>
    warning.includes("same-family CPMM feeds need explicit venue/correlation evidence"),
  ),
  true,
);
const cpmmFourIndependentRisk = evaluateMintOracleProgramRiskTier({
  pools: [0, 1, 2, 3].map((index) => ({
    family: "raydium-cpmm" as const,
    poolOrMarket: testPublicKey(120 + index * 3),
    baseVault: testPublicKey(121 + index * 3),
    quoteVault: testPublicKey(122 + index * 3),
    vaultAuthority: testPublicKey(132 + index),
    venueGroup: index + 1,
    routeCorrelationGroup: index + 1,
    sourceIndex: index,
  })),
  anchorPolicyHash: TEST_ANCHOR_POLICY_HASH,
  nativeTierAExceptionHash: TEST_NATIVE_EXCEPTION_HASH,
});
assert.equal(cpmmFourIndependentRisk.maxRefreshRiskTier, RiskTier.TierA);
assert.equal(cpmmFourIndependentRisk.informedRiskTier, RiskTier.TierA);
const mixedNonCpmmThreeSourceRisk = evaluateMintOracleProgramRiskTier({
  pools: [
    {
      family: "orca-whirlpool" as const,
      poolOrMarket: testPublicKey(150),
      baseVault: testPublicKey(151),
      quoteVault: testPublicKey(152),
      whirlpoolsConfig: testPublicKey(153),
      sourceIndex: 0,
      venueGroup: 1,
      routeCorrelationGroup: 1,
    },
    {
      family: "meteora-dlmm" as const,
      poolOrMarket: testPublicKey(154),
      baseVault: testPublicKey(155),
      quoteVault: testPublicKey(156),
      activeBinArray: testPublicKey(157),
      sourceIndex: 1,
      venueGroup: 2,
      routeCorrelationGroup: 2,
    },
    {
      family: "raydium-clmm" as const,
      poolOrMarket: testPublicKey(158),
      baseVault: testPublicKey(159),
      quoteVault: testPublicKey(160),
      sourceIndex: 2,
      venueGroup: 3,
      routeCorrelationGroup: 3,
    },
  ],
  anchorPolicyHash: TEST_ANCHOR_POLICY_HASH,
  nativeTierAExceptionHash: TEST_NATIVE_EXCEPTION_HASH,
});
assert.equal(mixedNonCpmmThreeSourceRisk.routeableAtomicPath, "orca-meteora-raydium-clmm");
assert.equal(mixedNonCpmmThreeSourceRisk.maxRefreshRiskTier, RiskTier.TierB);
assert.equal(mixedNonCpmmThreeSourceRisk.creationRiskTier, RiskTier.TierB);
assert.equal(mixedNonCpmmThreeSourceRisk.warnings.length, 0);
const mixedNonCpmmTwoSourceRisk = evaluateMintOracleProgramRiskTier({
  pools: [
    {
      family: "orca-whirlpool" as const,
      poolOrMarket: testPublicKey(161),
      baseVault: testPublicKey(162),
      quoteVault: testPublicKey(163),
      whirlpoolsConfig: testPublicKey(164),
      sourceIndex: 0,
      venueGroup: 1,
      routeCorrelationGroup: 1,
    },
    {
      family: "raydium-clmm" as const,
      poolOrMarket: testPublicKey(165),
      baseVault: testPublicKey(166),
      quoteVault: testPublicKey(167),
      sourceIndex: 1,
      venueGroup: 2,
      routeCorrelationGroup: 2,
    },
  ],
  anchorPolicyHash: TEST_ANCHOR_POLICY_HASH,
});
assert.equal(mixedNonCpmmTwoSourceRisk.routeableAtomicPath, "orca-raydium-clmm");
assert.equal(mixedNonCpmmTwoSourceRisk.maxRefreshRiskTier, RiskTier.TierC);
assert.equal(mixedNonCpmmTwoSourceRisk.creationRiskTier, RiskTier.TierC);
const allMeteoraRetainedRingRisk = evaluateMintOracleProgramRiskTier({
  pools: [
    {
      family: "meteora-dlmm" as const,
      poolOrMarket: testPublicKey(168),
      baseVault: testPublicKey(169),
      quoteVault: testPublicKey(170),
      activeBinArray: testPublicKey(171),
      sourceIndex: 0,
    },
    {
      family: "meteora-dlmm" as const,
      poolOrMarket: testPublicKey(172),
      baseVault: testPublicKey(173),
      quoteVault: testPublicKey(174),
      activeBinArray: testPublicKey(175),
      sourceIndex: 1,
    },
    {
      family: "meteora-damm-v2" as const,
      poolOrMarket: testPublicKey(176),
      baseVault: testPublicKey(177),
      quoteVault: testPublicKey(178),
      sourceIndex: 2,
    },
  ],
  anchorPolicyHash: TEST_ANCHOR_POLICY_HASH,
  nativeTierAExceptionHash: TEST_NATIVE_EXCEPTION_HASH,
});
assert.equal(allMeteoraRetainedRingRisk.routeableAtomicPath, "retained-rings");
assert.equal(allMeteoraRetainedRingRisk.maxRefreshRiskTier, RiskTier.TierC);
assert.equal(allMeteoraRetainedRingRisk.creationRiskTier, RiskTier.TierC);
assert.equal(allMeteoraRetainedRingRisk.venueCount, 1);
assert.equal(allMeteoraRetainedRingRisk.correlationGroupCount, 1);
{
  const pool = (family: "raydium-clmm" | "raydium-cpmm" | "orca-whirlpool" | "meteora-dlmm", i: number, venueGroup?: number, routeCorrelationGroup?: number) => ({
    family, poolOrMarket: testPublicKey(200 + i * 4), baseVault: testPublicKey(201 + i * 4), quoteVault: testPublicKey(202 + i * 4),
    vaultAuthority: testPublicKey(203 + i * 4), whirlpoolsConfig: testPublicKey(199), activeBinArray: testPublicKey(198), sourceIndex: i,
    ...(venueGroup !== undefined ? { venueGroup } : {}), ...(routeCorrelationGroup !== undefined ? { routeCorrelationGroup } : {}) });
  const tier = (pools: ReturnType<typeof pool>[]) => evaluateMintOracleProgramRiskTier({ pools,
    anchorPolicyHash: TEST_ANCHOR_POLICY_HASH, nativeTierAExceptionHash: TEST_NATIVE_EXCEPTION_HASH });
  const raydiumPair = tier([pool("raydium-clmm", 0), pool("raydium-cpmm", 1)]);
  assert.deepEqual([raydiumPair.venueCount, raydiumPair.correlationGroupCount, raydiumPair.maxRefreshRiskTier], [1, 1, RiskTier.TierC]);
  const twoOperators = tier([pool("raydium-clmm", 0, 0, 0), pool("raydium-clmm", 1, 0, 1), pool("orca-whirlpool", 2, 1, 2)]);
  assert.deepEqual([twoOperators.venueCount, twoOperators.correlationGroupCount, twoOperators.maxRefreshRiskTier], [2, 3, RiskTier.TierB]);
  const threeOfFour = tier([pool("raydium-clmm", 0, 0, 0), pool("raydium-clmm", 1, 0, 1), pool("orca-whirlpool", 2, 1, 2), pool("meteora-dlmm", 3, 2, 3)]);
  assert.deepEqual([threeOfFour.venueCount, threeOfFour.correlationGroupCount, threeOfFour.maxRefreshRiskTier], [3, 4, RiskTier.TierA]);
  const unknownRoutes = tier([pool("raydium-clmm", 0, 0, 0xffff), pool("orca-whirlpool", 1, 1, 0xffff), pool("meteora-dlmm", 2, 2, 0xffff), pool("raydium-cpmm", 3, 0, 0xffff)]);
  assert.deepEqual([unknownRoutes.correlationGroupCount, unknownRoutes.maxRefreshRiskTier], [0, RiskTier.TierC]);
}
const mintOracleLongTailEvaluation = evaluateMintOracleLongTailPools({
  pools: [
    {
      family: "raydium-clmm" as const,
      poolOrMarket: testPublicKey(72),
      baseVault: testPublicKey(73),
      quoteVault: testPublicKey(74),
      vaultAuthority: testPublicKey(75),
      tvlUsd: 8_000,
      liquidityUsd: 2_500,
      depthTo50BpsUsd: 300,
      liquidityAgeSlots: 12n,
      feeLossFloorNative: 90n,
      retainedObservationCount: 2,
      maxSourceWeightBps: 10_000,
      spreadBps: 180,
      confidenceBps: 250,
    },
  ],
  policy: {
    minSourceCount: 2,
    minVenueCount: 2,
    minTvlUsd: 100_000,
    minLiquidityUsd: 50_000,
    minDepthTo50BpsUsd: 10_000,
    minLiquidityAgeSlots: 1_000n,
    minFeeLossFloorNative: 10_000n,
    minRetainedObservationCount: 16,
    maxDominantSourceWeightBps: 6_000,
    maxSpreadBps: 100,
    maxConfidenceBps: 100,
    requireAnchor: true,
  },
  hasAnchor: false,
});
assert.equal(
  (mintOracleLongTailEvaluation.marketFlags &
    MINT_ORACLE_MARKET_FLAGS.LONG_TAIL) !==
    0,
  true,
);
assert.equal(
  (mintOracleLongTailEvaluation.marketFlags &
    MINT_ORACLE_MARKET_FLAGS.BOOTSTRAP_LIQUIDITY) !==
    0,
  true,
);
assert.equal(
  (mintOracleLongTailEvaluation.marketFlags &
    MINT_ORACLE_MARKET_FLAGS.DOMINANT_SOURCE) !==
    0,
  true,
);
assert.equal(
  (mintOracleLongTailEvaluation.marketFlags &
    MINT_ORACLE_MARKET_FLAGS.FEE_LOSS_FLOOR_LOW) !==
    0,
  true,
);
assert.equal(
  (mintOracleLongTailEvaluation.marketFlags &
    MINT_ORACLE_MARKET_FLAGS.ANCHOR_MISSING) !==
    0,
  true,
);
assert.equal(mintOracleLongTailEvaluation.eligibleForStandardAtomicPath, false);
const usdQuoteBaseMint = testPublicKey(130);
const usdQuoteUsdcMint = MIMIR_MAINNET_USDC_MINT;
const usdQuoteUsdtMint = MIMIR_MAINNET_USDT_MINT;
const usdQuoteSolMint = MIMIR_SOL_MINT;
const usdQuoteProviderClusters: string[] = [];
const usdQuoteProvider = {
  async discoverMintOraclePools(args: {
    quoteMintAddress: PublicKey;
    cluster: string;
  }) {
    usdQuoteProviderClusters.push(args.cluster);
    if (args.quoteMintAddress.equals(usdQuoteUsdcMint)) {
      return [
        {
          family: "raydium-clmm" as const,
          poolOrMarket: testPublicKey(134),
          baseVault: testPublicKey(135),
          quoteVault: testPublicKey(136),
          vaultAuthority: testPublicKey(137),
          tvlUsd: 100_000,
        },
      ];
    }
    if (args.quoteMintAddress.equals(usdQuoteUsdtMint)) {
      return [
        {
          family: "raydium-clmm" as const,
          poolOrMarket: testPublicKey(138),
          baseVault: testPublicKey(139),
          quoteVault: testPublicKey(140),
          vaultAuthority: testPublicKey(141),
          tvlUsd: 120_000,
        },
      ];
    }
    if (args.quoteMintAddress.equals(usdQuoteSolMint)) {
      return [
        {
          family: "raydium-clmm" as const,
          poolOrMarket: testPublicKey(142),
          baseVault: testPublicKey(143),
          quoteVault: testPublicKey(144),
          vaultAuthority: testPublicKey(145),
          tvlUsd: 1_000_000,
        },
      ];
    }
    return [];
  },
};
const usdQuoteSelection = await discoverMintOracleUsdQuotePoolsForMint({
  discoveryProvider: usdQuoteProvider,
  cluster: "localnet",
  mintAddress: usdQuoteBaseMint,
  usdcMintAddress: usdQuoteUsdcMint,
  usdtMintAddress: usdQuoteUsdtMint,
  solMintAddress: usdQuoteSolMint,
});
assert.equal(usdQuoteSelection.selected.quoteKind, "stable-usdc");
assert.ok(usdQuoteProviderClusters.every((cluster) => cluster === "mainnet"));
const mainnetDefaultUsdQuoteRequests: string[] = [];
await discoverMintOracleUsdQuotePoolsForMint({
  discoveryProvider: {
    async discoverMintOraclePools(args: { quoteMintAddress: PublicKey }) {
      mainnetDefaultUsdQuoteRequests.push(args.quoteMintAddress.toBase58());
      if (
        args.quoteMintAddress.equals(MIMIR_MAINNET_USDC_MINT) ||
        args.quoteMintAddress.equals(MIMIR_MAINNET_USDT_MINT)
      ) {
        return [
          {
            family: "raydium-clmm" as const,
            poolOrMarket: testPublicKey(158),
            baseVault: testPublicKey(159),
            quoteVault: testPublicKey(160),
            vaultAuthority: testPublicKey(161),
            tvlUsd: 100_000,
          },
        ];
      }
      return [];
    },
  },
  cluster: "mainnet",
  mintAddress: usdQuoteBaseMint,
  includeSolQuote: false,
});
assert.deepEqual(mainnetDefaultUsdQuoteRequests.sort(), [
  MIMIR_MAINNET_USDC_MINT.toBase58(),
  MIMIR_MAINNET_USDT_MINT.toBase58(),
].sort());
assert.equal(
  mainnetDefaultUsdQuoteRequests.includes(OLD_CUSDC_MINT.toBase58()),
  false,
);
assert.equal(mainnetDefaultUsdQuoteRequests.includes(OLD_DEVNET_USDC_MINT.toBase58()), false);
const localnetDefaultUsdQuoteRequests: string[] = [];
await discoverMintOracleUsdQuotePoolsForMint({
  discoveryProvider: {
    async discoverMintOraclePools(args: {
      quoteMintAddress: PublicKey;
      cluster: string;
    }) {
      assert.equal(args.cluster, "mainnet");
      localnetDefaultUsdQuoteRequests.push(args.quoteMintAddress.toBase58());
      return args.quoteMintAddress.equals(MIMIR_MAINNET_USDC_MINT)
        ? [{
            family: "raydium-clmm" as const,
            poolOrMarket: testPublicKey(158),
            baseVault: testPublicKey(159),
            quoteVault: testPublicKey(160),
            vaultAuthority: testPublicKey(161),
            tvlUsd: 100_000,
          }]
        : [];
    },
  },
  cluster: "localnet",
  mintAddress: usdQuoteBaseMint,
  includeSolQuote: false,
});
assert.deepEqual(localnetDefaultUsdQuoteRequests.sort(), [
  MIMIR_MAINNET_USDC_MINT.toBase58(),
  MIMIR_MAINNET_USDT_MINT.toBase58(),
].sort());
for (const rejectedQuoteMint of [OLD_CUSDC_MINT, OLD_DEVNET_USDC_MINT]) {
  await assert.rejects(
    () => discoverMintOraclePoolsForMint({
      discoveryProvider: {
        async discoverMintOraclePools() {
          return [];
        },
      },
      cluster: "localnet",
      mintAddress: usdQuoteBaseMint,
      quoteMintAddress: rejectedQuoteMint,
    }),
    /UnsupportedMintOracleQuoteMint/,
  );
}
await assert.rejects(
  () =>
    discoverMintOracleUsdQuotePoolsForMint({
      discoveryProvider: usdQuoteProvider,
      cluster: "mainnet",
      mintAddress: usdQuoteBaseMint,
      usdcMintAddress: OLD_DEVNET_USDC_MINT,
      includeSolQuote: false,
    }),
  /UnsupportedMintOracleQuoteMint/,
);
assert.ok(
  computeMintOraclePoolScore({
    family: "raydium-clmm",
    poolOrMarket: testPublicKey(150),
    baseVault: testPublicKey(151),
    quoteVault: testPublicKey(152),
    vaultAuthority: testPublicKey(153),
    tvlUsd: 1,
    spreadBps: -1_000_000,
    confidenceBps: -1_000_000,
  }) < 20,
);
assert.equal(
  computeMintOraclePoolScore({
    family: "raydium-clmm",
    poolOrMarket: testPublicKey(150),
    baseVault: testPublicKey(151),
    quoteVault: testPublicKey(152),
    vaultAuthority: testPublicKey(153),
    tvlUsd: 1,
    retainedObservationCount: 10_000,
  }),
  computeMintOraclePoolScore({
    family: "raydium-clmm",
    poolOrMarket: testPublicKey(150),
    baseVault: testPublicKey(151),
    quoteVault: testPublicKey(152),
    vaultAuthority: testPublicKey(153),
    tvlUsd: 1,
  }),
);
assert.equal(
  usdQuoteSelection.warnings.some((warning) =>
    warning.includes("canonical SOL/quote feed id is required"),
  ),
  true,
);
await assert.rejects(
  () =>
    discoverMintOracleUsdQuotePoolsForMint({
      discoveryProvider: usdQuoteProvider,
      cluster: "localnet",
      mintAddress: usdQuoteBaseMint,
      usdcMintAddress: usdQuoteUsdcMint,
      canonicalSolQuoteFeedId: Buffer.alloc(32, 199),
    }),
  /InvalidCanonicalSolQuoteFeedId/,
);
const canonicalSolQuoteFeedId = deriveMintPairFeedId({
  mintAddress: usdQuoteSolMint,
  quoteMintAddress: usdQuoteUsdcMint,
  cluster: "localnet",
});
const usdQuoteSolOnlySelection = await discoverMintOracleUsdQuotePoolsForMint({
  discoveryProvider: {
    async discoverMintOraclePools(args: { quoteMintAddress: PublicKey }) {
      return args.quoteMintAddress.equals(usdQuoteSolMint)
        ? [
            {
              family: "raydium-clmm" as const,
              poolOrMarket: testPublicKey(146),
              baseVault: testPublicKey(147),
              quoteVault: testPublicKey(148),
              vaultAuthority: testPublicKey(149),
              tvlUsd: 1_000_000,
            },
          ]
        : [];
    },
  },
  cluster: "localnet",
  mintAddress: usdQuoteBaseMint,
  usdcMintAddress: usdQuoteUsdcMint,
  usdtMintAddress: usdQuoteUsdtMint,
  solMintAddress: usdQuoteSolMint,
  canonicalSolQuoteFeedId,
});
assert.equal(usdQuoteSolOnlySelection.selected.quoteKind, "sol-via-canonical-feed");
assert.equal(usdQuoteSolOnlySelection.selected.requiresQuoteConversion, true);
const usdQuoteUsdtOnlySelection = await discoverMintOracleUsdQuotePoolsForMint({
  discoveryProvider: {
    async discoverMintOraclePools(args: { quoteMintAddress: PublicKey }) {
      return args.quoteMintAddress.equals(usdQuoteUsdtMint)
        ? [
            {
              family: "raydium-clmm" as const,
              poolOrMarket: testPublicKey(168),
              baseVault: testPublicKey(169),
              quoteVault: testPublicKey(170),
              vaultAuthority: testPublicKey(171),
              tvlUsd: 1_000_000,
            },
          ]
        : [];
    },
  },
  cluster: "localnet",
  mintAddress: usdQuoteBaseMint,
  usdcMintAddress: usdQuoteUsdcMint,
  usdtMintAddress: usdQuoteUsdtMint,
  includeSolQuote: false,
});
assert.equal(usdQuoteUsdtOnlySelection.selected.quoteKind, "stable-usdt");
assert.equal(usdQuoteUsdtOnlySelection.selected.requiresQuoteConversion, true);
await assert.rejects(
  () =>
    discoverMintOracleUsdQuotePoolsForMint({
      discoveryProvider: {
        async discoverMintOraclePools(args: { quoteMintAddress: PublicKey }) {
          return args.quoteMintAddress.equals(usdQuoteSolMint)
            ? [
                {
                  family: "raydium-clmm" as const,
                  poolOrMarket: testPublicKey(146),
                  baseVault: testPublicKey(147),
                  quoteVault: testPublicKey(148),
                  vaultAuthority: testPublicKey(149),
                  tvlUsd: 1_000_000,
                },
              ]
            : [];
        },
      },
      cluster: "localnet",
      mintAddress: usdQuoteBaseMint,
      usdcMintAddress: usdQuoteUsdcMint,
      usdtMintAddress: usdQuoteUsdtMint,
      solMintAddress: usdQuoteSolMint,
    }),
  /NoMintOracleUsdQuotePoolsFound/,
);
const usdQuoteCpmmOnlySelection = await discoverMintOracleUsdQuotePoolsForMint({
  discoveryProvider: {
    async discoverMintOraclePools(args: { quoteMintAddress: PublicKey }) {
      return args.quoteMintAddress.equals(usdQuoteUsdcMint)
        ? [
            {
              family: "raydium-cpmm" as const,
              poolOrMarket: testPublicKey(154),
              baseVault: testPublicKey(155),
              quoteVault: testPublicKey(156),
              vaultAuthority: testPublicKey(157),
              tvlUsd: 20_000,
            },
          ]
        : [];
    },
  },
  cluster: "localnet",
  mintAddress: usdQuoteBaseMint,
  usdcMintAddress: usdQuoteUsdcMint,
  includeSolQuote: false,
  includeAdapterSeparate: true,
});
assert.equal(usdQuoteCpmmOnlySelection.selected.sourcePriority, "adapter-separate");
assert.deepEqual(
  usdQuoteCpmmOnlySelection.selected.selectedPools.map((pool) => pool.family),
  ["raydium-cpmm"],
);
const selectedMintOracleLongTailPools = selectMintOraclePools({
  pools: mintOraclePools,
  minProductionSourceCount: 3,
  longTailPolicy: {
    minSourceCount: 3,
    minVenueCount: 3,
    minFeeLossFloorNative: 1n,
  },
});
assert.ok(selectedMintOracleLongTailPools.longTailEvaluation);

const mintOracleSourceConfigArgs = buildMintOracleSourceConfigArgs({
  feedId: localnetMintOracleFeedId,
  baseMint: mintOracleBaseMint,
  quoteMint: mintOracleQuoteMint,
  pools: selectedMintOraclePools.selectedPools,
  cluster: "localnet",
  allowUnverifiedPools: "unsafe-unverified-test-fixture",
});
assert.equal(mintOracleSourceConfigArgs.length, 3);
assert.equal(
  mintOracleSourceConfigArgs[0].adapterType,
  SourceAdapterType.OrcaWhirlpool,
);
assert.equal(mintOracleSourceConfigArgs[0].minDepthTo50BpsNative, 1n);
assert.equal(mintOracleSourceConfigArgs[2].minDepthTo50BpsNative, 1n);
const mintOracleSelectedOrcaPool = selectedMintOraclePools.selectedPools.find(
  (pool) => pool.family === "orca-whirlpool",
);
const mintOracleSelectedMeteoraPool = selectedMintOraclePools.selectedPools.find(
  (pool) => pool.family === "meteora-dlmm",
);
const mintOracleSelectedRaydiumClmmPool = selectedMintOraclePools.selectedPools.find(
  (pool) => pool.family === "raydium-clmm",
);
assert.ok(mintOracleSelectedOrcaPool);
assert.ok(mintOracleSelectedMeteoraPool);
assert.ok(mintOracleSelectedRaydiumClmmPool);
assert.equal(mintOracleSourceConfigArgs[0].minLiquidityNative, 1n);
assert.equal(mintOracleSourceConfigArgs[1].minLiquidityNative, 1n);
assert.equal(mintOracleSourceConfigArgs[2].minLiquidityNative, 1n);
assert.equal(mintOracleSourceConfigArgs[1].minDepthTo50BpsNative, 1n);
const mintOracleSpotTierCFlooredSourceConfigs = buildMintOracleSourceConfigArgs({
  feedId: localnetMintOracleFeedId,
  baseMint: mintOracleBaseMint,
  quoteMint: mintOracleQuoteMint,
  cluster: "localnet",
  allowUnverifiedPools: "unsafe-unverified-test-fixture",
  pools: [
    {
      family: "orca-whirlpool" as const,
      poolOrMarket: testPublicKey(170),
      baseVault: testPublicKey(171),
      quoteVault: testPublicKey(172),
      whirlpoolsConfig: testPublicKey(173),
      vaultAuthority: testPublicKey(174),
      sourceIndex: 0,
      minDepthTo50BpsNative: 999n,
    },
    {
      family: "meteora-dlmm" as const,
      poolOrMarket: testPublicKey(175),
      baseVault: testPublicKey(176),
      quoteVault: testPublicKey(177),
      activeBinArray: testPublicKey(178),
      vaultAuthority: testPublicKey(179),
      sourceIndex: 1,
      minDepthTo50BpsNative: 777n,
    },
    {
      family: "raydium-clmm" as const,
      poolOrMarket: testPublicKey(180),
      baseVault: testPublicKey(181),
      quoteVault: testPublicKey(182),
      vaultAuthority: testPublicKey(183),
      sourceIndex: 2,
      minDepthTo50BpsNative: 555n,
    },
  ],
});
assert.equal(mintOracleSpotTierCFlooredSourceConfigs[0].minDepthTo50BpsNative, 1n);
assert.equal(
  mintOracleSpotTierCFlooredSourceConfigs[1].minDepthTo50BpsNative,
  699n,
);
assert.equal(mintOracleSpotTierCFlooredSourceConfigs[2].minDepthTo50BpsNative, 1n);
const mintOracleAdapterMask = adapterMaskForSourceFamilies(
  selectedMintOraclePools.selectedPools.map((pool) => pool.family),
);
assert.equal(
  mintOracleAdapterMask,
  (1n << BigInt(SourceAdapterType.OrcaWhirlpool)) |
    (1n << BigInt(SourceAdapterType.MeteoraDlmm)) |
    (1n << BigInt(SourceAdapterType.RaydiumClmm)),
);

const mintOracleCollateralFeedId = deriveMintPairFeedId({
  mintAddress: mintOracleBaseMint,
  quoteMintAddress: mintOracleQuoteMint,
  cluster: "localnet",
});
const [mintOracleFeedCollateralLock] = findFeedCollateralLockPda(
  mintOracleCollateralFeedId,
);
await assert.rejects(
  () =>
    discoverMintOraclePoolsForMint({
      discoveryProvider: {
        async discoverMintOraclePools() {
          return [];
        },
      },
      cluster: "mainnet",
      mintAddress: mintOracleBaseMint,
      quoteMintAddress: OLD_DEVNET_USDC_MINT,
    }),
  /UnsupportedMintOracleQuoteMint/,
);

function writeTestU128(data: Buffer, offset: number, value: bigint): void {
  data.writeBigUInt64LE(value & TEST_U64_MASK, offset);
  data.writeBigUInt64LE(value >> 64n, offset + 8);
}

function buildTestSplMintAccount(decimals: number): AccountInfo<Buffer> {
  const data = Buffer.alloc(82);
  data[44] = decimals;
  data[45] = 1;
  return {
    data,
    executable: false,
    lamports: 1,
    owner: SPL_TOKEN_PROGRAM_ID,
    rentEpoch: 0,
  };
}

function buildTestPumpSwapMintAccount(
  decimals: number,
  tokenProgram: PublicKey,
  mint: PublicKey,
): AccountInfo<Buffer> {
  const account = buildTestSplMintAccount(decimals);
  account.data.writeBigUInt64LE(1_000_000_000n, 36);
  if (!tokenProgram.equals(SPL_TOKEN_2022_PROGRAM_ID)) {
    return { ...account, owner: tokenProgram };
  }
  const data = Buffer.alloc(414);
  account.data.copy(data);
  data[165] = 1;
  data.writeUInt16LE(18, 166);
  data.writeUInt16LE(64, 168);
  mint.toBuffer().copy(data, 202);
  data.writeUInt16LE(19, 234);
  data.writeUInt16LE(176, 236);
  mint.toBuffer().copy(data, 270);
  let cursor = 302;
  for (const value of [Buffer.from("Pump"), Buffer.from("PUMP"), Buffer.alloc(88, 0x61)]) {
    data.writeUInt32LE(value.length, cursor);
    cursor += 4;
    value.copy(data, cursor);
    cursor += value.length;
  }
  data.writeUInt32LE(0, cursor);
  return { ...account, data, owner: tokenProgram };
}

function buildTestSplVaultAccount(args: {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
}): AccountInfo<Buffer> {
  const data = Buffer.alloc(165);
  args.mint.toBuffer().copy(data, 0);
  args.owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(args.amount, 64);
  data[108] = 1;
  return {
    data,
    executable: false,
    lamports: 1,
    owner: SPL_TOKEN_PROGRAM_ID,
    rentEpoch: 0,
  };
}

function buildTestPumpSwapVaultAccount(args: {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  tokenProgram: PublicKey;
}): AccountInfo<Buffer> {
  const account = buildTestSplVaultAccount(args);
  if (!args.tokenProgram.equals(SPL_TOKEN_2022_PROGRAM_ID)) {
    return { ...account, owner: args.tokenProgram };
  }
  const data = Buffer.alloc(170);
  account.data.copy(data);
  data[165] = 2;
  data.writeUInt16LE(7, 166);
  data.writeUInt16LE(0, 168);
  return { ...account, data, owner: args.tokenProgram };
}

function buildTestPumpSwapPoolAccount(args: {
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  bump: number;
  index: number;
  creator: PublicKey;
  lpMint: PublicKey;
  dataLength?: 300 | 301;
}): AccountInfo<Buffer> {
  const data = Buffer.alloc(args.dataLength ?? 300);
  Buffer.from("f19a6d0411b16dbc", "hex").copy(data, 0);
  data[8] = args.bump;
  data.writeUInt16LE(args.index, 9);
  args.creator.toBuffer().copy(data, 11);
  args.baseMint.toBuffer().copy(data, 43);
  args.quoteMint.toBuffer().copy(data, 75);
  args.lpMint.toBuffer().copy(data, 107);
  args.baseVault.toBuffer().copy(data, 139);
  args.quoteVault.toBuffer().copy(data, 171);
  data.writeBigUInt64LE(1n, 203);
  data[243] = 0;
  data[244] = 0;
  return {
    data,
    executable: false,
    lamports: 1,
    owner: PUMPSWAP_PROGRAM_ID,
    rentEpoch: 0,
  };
}

function buildTestRaydiumCpmmPoolAccount(args: {
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  observationKey?: PublicKey;
  programId?: PublicKey;
}): AccountInfo<Buffer> {
  const data = Buffer.alloc(637);
  RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR.copy(data, 0);
  args.baseVault.toBuffer().copy(data, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT);
  args.quoteVault.toBuffer().copy(data, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_VAULT);
  args.baseMint.toBuffer().copy(data, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT);
  args.quoteMint.toBuffer().copy(data, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_MINT);
  SPL_TOKEN_PROGRAM_ID.toBuffer().copy(
    data,
    RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_PROGRAM,
  );
  SPL_TOKEN_PROGRAM_ID.toBuffer().copy(
    data,
    RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_PROGRAM,
  );
  (args.observationKey ?? testPublicKey(219))
    .toBuffer()
    .copy(data, RAYDIUM_CPMM_POOL_OBSERVATION_KEY_OFFSET);
  data[329] = 0;
  data[RAYDIUM_CPMM_POOL_OFFSET_MINT_0_DECIMALS] = 9;
  data[RAYDIUM_CPMM_POOL_OFFSET_MINT_1_DECIMALS] = 6;
  data.writeBigUInt64LE(0n, 373);
  return {
    data,
    executable: false,
    lamports: 1,
    owner: args.programId ?? RAYDIUM_CPMM_MAINNET_PROGRAM_ID,
    rentEpoch: 0,
  };
}

assert.equal(UNKNOWN_CORRELATED_DOMAIN, 0xffff);
assert.equal(Q64, 18_446_744_073_709_551_616n);

const cpmmBounds10 = cpmmZeroFeeImmediateUnwindBounds(
  1_000_000_000n,
  1_000_000_000n,
  10,
);
assert.equal(cpmmBounds10.capitalRequiredUpQuote, 499_875n);
assert.equal(cpmmBounds10.capitalRequiredDownQuote, 500_375n);
assert.equal(cpmmBounds10.capitalRequiredFloor, 499_875n);
assert.equal(cpmmBounds10.economicLossFloor, 0n);
const cpmmBounds50 = cpmmZeroFeeImmediateUnwindBounds(
  1_000_000_000n,
  1_000_000_000n,
  50,
);
assert.equal(cpmmBounds50.capitalRequiredUpQuote, 2_496_882n);
assert.equal(cpmmBounds50.capitalRequiredDownQuote, 2_509_414n);
assert.equal(cpmmBounds50.capitalRequiredFloor, 2_496_882n);
const cpmmBounds100 = cpmmZeroFeeImmediateUnwindBounds(
  1_000_000_000n,
  1_000_000_000n,
  100,
);
assert.equal(cpmmBounds100.capitalRequiredUpQuote, 4_987_562n);
assert.equal(cpmmBounds100.capitalRequiredDownQuote, 5_037_815n);
assert.equal(cpmmBounds100.capitalRequiredFloor, 4_987_562n);
assert.throws(
  () => cpmmZeroFeeImmediateUnwindBounds(0n, 1_000_000_000n, 10),
  /InvalidAccountData/,
);
assert.throws(
  () => cpmmZeroFeeImmediateUnwindBounds(1_000_000_000n, 1_000_000_000n, 25),
  /UnsupportedBps/,
);
assert.throws(
  () => cpmmZeroFeeImmediateUnwindBounds(1n, (1n << 128n) - 1n, 10),
  /ArithmeticOverflow/,
);
function testCpmmVerificationFixture(
  cluster: "mainnet" | "localnet",
) {
  const baseMint = testPublicKey(211);
  const quoteMint = MIMIR_MAINNET_USDC_MINT;
  const authority = testPublicKey(213);
  const pool = testPublicKey(214);
  const baseVault = testPublicKey(215);
  const quoteVault = testPublicKey(216);
  const programId = RAYDIUM_CPMM_MAINNET_PROGRAM_ID;
  const accounts = new Map<string, AccountInfo<Buffer>>([
    [baseMint.toBase58(), buildTestSplMintAccount(6)],
    [quoteMint.toBase58(), buildTestSplMintAccount(6)],
    [
      pool.toBase58(),
      buildTestRaydiumCpmmPoolAccount({
        baseMint,
        quoteMint,
        baseVault,
        quoteVault,
        programId,
      }),
    ],
    [
      baseVault.toBase58(),
      buildTestSplVaultAccount({
        mint: baseMint,
        owner: authority,
        amount: 1_000_000_000n,
      }),
    ],
    [
      quoteVault.toBase58(),
      buildTestSplVaultAccount({
        mint: quoteMint,
        owner: authority,
        amount: 1_000_000_000n,
      }),
    ],
  ]);
  const verify = () => verifyMintOraclePoolsWithRpc({
    connection: {
      async getSlot() {
        return 7;
      },
      async getMultipleAccountsInfo(pubkeys: readonly PublicKey[]) {
        return pubkeys.map((pubkey) => accounts.get(pubkey.toBase58()) ?? null);
      },
    } as unknown as Parameters<typeof verifyMintOraclePoolsWithRpc>[0]["connection"],
    cluster,
    mintAddress: baseMint,
    quoteMintAddress: quoteMint,
    currentUnixTimestamp: 1,
    pools: [{
      family: "raydium-cpmm" as const,
      poolOrMarket: pool,
      baseVault,
      quoteVault,
      vaultAuthority: authority,
      baseDecimals: 6,
      quoteDecimals: 6,
      minLiquidityNative: 999n,
      minDepthTo50BpsNative: 777n,
    }],
  });
  return { accounts, baseMint, quoteMint, pool, baseVault, quoteVault, verify };
}

const verifiedCpmmPools = await testCpmmVerificationFixture("mainnet").verify();
assert.equal(verifiedCpmmPools.length, 1);
assert.equal(verifiedCpmmPools[0]?.minLiquidityNative, 1_000_000_000n);
assert.equal(
  verifiedCpmmPools[0]?.minDepthTo50BpsNative,
  cpmmBounds50.capitalRequiredFloor,
);
assert.equal(
  verifiedCpmmPools[0]!.minDepthTo50BpsNative < 1_000_000_000n / 200n,
  true,
);
for (const cluster of ["mainnet", "localnet"] as const) {
  const [verified] = await testCpmmVerificationFixture(cluster).verify();
  assert.equal(verified?.programId?.toString(), RAYDIUM_CPMM_MAINNET_PROGRAM_ID.toString());
  assert.equal(verified?.minLiquidityNative, 1_000_000_000n);
  assert.equal(verified?.minDepthTo50BpsNative, cpmmBounds50.capitalRequiredFloor);
}

async function assertCpmmVerifierRejects(
  mutate: (fixture: ReturnType<typeof testCpmmVerificationFixture>) => void,
): Promise<void> {
  const fixture = testCpmmVerificationFixture("localnet");
  mutate(fixture);
  await assert.rejects(fixture.verify, /UnverifiedMintOraclePoolGraph/);
}

await assertCpmmVerifierRejects((fixture) => {
  const account = fixture.accounts.get(fixture.pool.toBase58())!;
  fixture.accounts.set(fixture.pool.toBase58(), { ...account, owner: SystemProgram.programId });
});
await assertCpmmVerifierRejects((fixture) => {
  testPublicKey(217).toBuffer().copy(
    fixture.accounts.get(fixture.pool.toBase58())!.data,
    RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT,
  );
});
await assertCpmmVerifierRejects((fixture) => {
  testPublicKey(218).toBuffer().copy(
    fixture.accounts.get(fixture.pool.toBase58())!.data,
    RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT,
  );
});
await assertCpmmVerifierRejects((fixture) => {
  fixture.accounts.get(fixture.pool.toBase58())!.data[329] = 4;
});

function testPumpSwapVerificationFixture(
  baseTokenProgram: PublicKey,
  dataLength: 300 | 301,
) {
  const baseMint = testPublicKey(dataLength === 300 ? 220 : 221);
  const quoteMint = MIMIR_SOL_MINT;
  const creator = testPublicKey(dataLength === 300 ? 222 : 223);
  const index = 0;
  const [pool, bump] = PublicKey.findProgramAddressSync([
    Buffer.from("pool"),
    Buffer.from([index, 0]),
    creator.toBuffer(),
    baseMint.toBuffer(),
    quoteMint.toBuffer(),
  ], PUMPSWAP_PROGRAM_ID);
  const [lpMint] = PublicKey.findProgramAddressSync([
    Buffer.from("pool_lp_mint"),
    pool.toBuffer(),
  ], PUMPSWAP_PROGRAM_ID);
  const baseVault = testPublicKey(dataLength === 300 ? 224 : 225);
  const quoteVault = testPublicKey(dataLength === 300 ? 226 : 227);
  const accounts = new Map<string, AccountInfo<Buffer>>([
    [baseMint.toBase58(), buildTestPumpSwapMintAccount(6, baseTokenProgram, baseMint)],
    [quoteMint.toBase58(), buildTestPumpSwapMintAccount(9, SPL_TOKEN_PROGRAM_ID, quoteMint)],
    [
      pool.toBase58(),
      buildTestPumpSwapPoolAccount({
        baseMint,
        quoteMint,
        baseVault,
        quoteVault,
        bump,
        index,
        creator,
        lpMint,
        dataLength,
      }),
    ],
    [
      baseVault.toBase58(),
      buildTestPumpSwapVaultAccount({
        mint: baseMint,
        owner: pool,
        amount: 2_000_000_000n,
        tokenProgram: baseTokenProgram,
      }),
    ],
    [
      quoteVault.toBase58(),
      buildTestPumpSwapVaultAccount({
        mint: quoteMint,
        owner: pool,
        amount: 3_000_000_000n,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
      }),
    ],
  ]);
  const verify = (cluster: "mainnet" | "localnet" = "localnet") => verifyMintOraclePoolsWithRpc({
    connection: {
      async getSlot() {
        return 7;
      },
      async getMultipleAccountsInfo(pubkeys: readonly PublicKey[]) {
        return pubkeys.map((pubkey) => accounts.get(pubkey.toBase58()) ?? null);
      },
    } as unknown as Parameters<typeof verifyMintOraclePoolsWithRpc>[0]["connection"],
    cluster,
    mintAddress: baseMint,
    quoteMintAddress: quoteMint,
    currentUnixTimestamp: 1,
    pools: [{
      family: "pumpswap" as const,
      poolOrMarket: pool,
      baseVault,
      quoteVault,
      vaultAuthority: pool,
      sourceIndex: 0,
      baseDecimals: 6,
      quoteDecimals: 9,
    }],
  });
  return { accounts, baseMint, quoteMint, pool, baseVault, quoteVault, verify };
}

const pumpSwapSplFixture = testPumpSwapVerificationFixture(SPL_TOKEN_PROGRAM_ID, 300);
const [verifiedPumpSwapSpl] = await pumpSwapSplFixture.verify();
assert.ok(verifiedPumpSwapSpl);
assert.equal(verifiedPumpSwapSpl.tokenProgram?.toString(), SPL_TOKEN_PROGRAM_ID.toString());
assert.equal(verifiedPumpSwapSpl.vaultAuthority?.toString(), pumpSwapSplFixture.pool.toString());

const pumpSwapToken2022Fixture = testPumpSwapVerificationFixture(
  SPL_TOKEN_2022_PROGRAM_ID,
  301,
);
const [verifiedPumpSwapToken2022] = await pumpSwapToken2022Fixture.verify();
assert.ok(verifiedPumpSwapToken2022);
assert.equal((await pumpSwapToken2022Fixture.verify("mainnet")).length, 1);
assert.equal((await pumpSwapToken2022Fixture.verify("localnet")).length, 1);
assert.equal(
  pumpSwapToken2022Fixture.accounts.get(pumpSwapToken2022Fixture.baseMint.toBase58())!.data.length,
  414,
);
assert.equal(
  pumpSwapToken2022Fixture.accounts.get(pumpSwapToken2022Fixture.baseVault.toBase58())!.data.length,
  170,
);
assert.equal(
  verifiedPumpSwapToken2022.tokenProgram?.toString(),
  SPL_TOKEN_2022_PROGRAM_ID.toString(),
);

const badPumpSwapToken2022Mint = testPumpSwapVerificationFixture(
  SPL_TOKEN_2022_PROGRAM_ID,
  301,
);
badPumpSwapToken2022Mint.accounts.get(
  badPumpSwapToken2022Mint.baseMint.toBase58(),
)!.data[202] ^= 0xff;
await assert.rejects(
  badPumpSwapToken2022Mint.verify,
  /UnverifiedMintOracleMintMetadata/,
);
const badPumpSwapToken2022Vault = testPumpSwapVerificationFixture(
  SPL_TOKEN_2022_PROGRAM_ID,
  301,
);
badPumpSwapToken2022Vault.accounts.get(
  badPumpSwapToken2022Vault.baseVault.toBase58(),
)!.data[166] = 8;
await assert.rejects(
  badPumpSwapToken2022Vault.verify,
  /UnverifiedMintOraclePoolGraph/,
);

async function assertPumpSwapVerifierRejects(
  mutate: (fixture: ReturnType<typeof testPumpSwapVerificationFixture>) => void,
): Promise<void> {
  const fixture = testPumpSwapVerificationFixture(SPL_TOKEN_PROGRAM_ID, 300);
  mutate(fixture);
  await assert.rejects(fixture.verify, /UnverifiedMintOraclePoolGraph/);
}

await assertPumpSwapVerifierRejects((fixture) => {
  const account = fixture.accounts.get(fixture.pool.toBase58())!;
  fixture.accounts.set(fixture.pool.toBase58(), { ...account, owner: SystemProgram.programId });
});
await assertPumpSwapVerifierRejects((fixture) => {
  const account = fixture.accounts.get(fixture.pool.toBase58())!;
  fixture.accounts.set(fixture.pool.toBase58(), { ...account, data: account.data.subarray(0, 299) });
});
await assertPumpSwapVerifierRejects((fixture) => {
  fixture.accounts.get(fixture.pool.toBase58())!.data[0] ^= 0xff;
});
await assertPumpSwapVerifierRejects((fixture) => {
  testPublicKey(228).toBuffer().copy(
    fixture.accounts.get(fixture.pool.toBase58())!.data,
    43,
  );
});
await assertPumpSwapVerifierRejects((fixture) => {
  testPublicKey(229).toBuffer().copy(
    fixture.accounts.get(fixture.baseVault.toBase58())!.data,
    32,
  );
});
await assertPumpSwapVerifierRejects((fixture) => {
  fixture.accounts.get(fixture.baseVault.toBase58())!.data[76] = 1;
});
await assertPumpSwapVerifierRejects((fixture) => {
  fixture.accounts.get(fixture.pool.toBase58())!.data[8] ^= 1;
});
await assertPumpSwapVerifierRejects((fixture) => {
  fixture.accounts.get(fixture.pool.toBase58())!.data[107] ^= 1;
});
await assertPumpSwapVerifierRejects((fixture) => {
  fixture.accounts.get(fixture.pool.toBase58())!.data.fill(0, 203, 211);
});
await assertPumpSwapVerifierRejects((fixture) => {
  fixture.accounts.get(fixture.pool.toBase58())!.data[243] = 1;
});
await assertPumpSwapVerifierRejects((fixture) => {
  fixture.accounts.get(fixture.pool.toBase58())!.data[261] = 1;
});

const pumpSwapFeedId = deriveMintPairFeedId({
  mintAddress: pumpSwapToken2022Fixture.baseMint,
  quoteMintAddress: pumpSwapToken2022Fixture.quoteMint,
  cluster: "localnet",
  allowPoolQuoteMint: true,
});
const [pumpSwapSourceConfig] = buildMintOracleSourceConfigArgs({
  feedId: pumpSwapFeedId,
  baseMint: pumpSwapToken2022Fixture.baseMint,
  quoteMint: pumpSwapToken2022Fixture.quoteMint,
  pools: [verifiedPumpSwapToken2022],
  cluster: "localnet",
});
assert.ok(pumpSwapSourceConfig);
assert.equal(pumpSwapSourceConfig.adapterType, SourceAdapterType.PumpSwap);
assert.equal(
  Buffer.from(pumpSwapSourceConfig.programId).equals(PUMPSWAP_PROGRAM_ID.toBuffer()),
  true,
);
assert.equal(
  Buffer.from(pumpSwapSourceConfig.tokenProgram).equals(
    SPL_TOKEN_2022_PROGRAM_ID.toBuffer(),
  ),
  true,
);
assert.equal(
  Buffer.from(pumpSwapSourceConfig.vaultAuthority).equals(
    pumpSwapToken2022Fixture.pool.toBuffer(),
  ),
  true,
);
assert.equal(adapterMaskForSourceFamilies(["pumpswap"]), 1n << 6n);

const [pumpSwapSourceConfigAddress] = findSourceConfigPda(pumpSwapFeedId, 0);
const pumpSwapHashInput = {
  sourceConfigAddress: pumpSwapSourceConfigAddress,
  sourceConfig: {
    ...pumpSwapSourceConfig,
    baseMint: pumpSwapToken2022Fixture.baseMint.toBuffer(),
    quoteMint: pumpSwapToken2022Fixture.quoteMint.toBuffer(),
  },
};
const pumpSwapHash = computePumpSwapSourceAccountsHash(pumpSwapHashInput);
const [pumpSwapGlobalConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("global_config")],
  PUMPSWAP_PROGRAM_ID,
);
const [pumpSwapFeeConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("fee_config"), PUMPSWAP_PROGRAM_ID.toBuffer()],
  PUMPSWAP_FEE_PROGRAM_ID,
);
const independentPumpSwapHash = createHash("sha256")
  .update(Buffer.from("MIMIR_PUMPSWAP_ACCOUNTS_V1"))
  .update(pumpSwapFeedId)
  .update(Buffer.from([0, SourceAdapterType.PumpSwap]))
  .update(Buffer.from([0, 0]))
  .update(Buffer.from([SourceDirection.QuotePerBase]))
  .update(pumpSwapSourceConfigAddress.toBuffer())
  .update(PUMPSWAP_PROGRAM_ID.toBuffer())
  .update(pumpSwapToken2022Fixture.pool.toBuffer())
  .update(pumpSwapToken2022Fixture.baseMint.toBuffer())
  .update(pumpSwapToken2022Fixture.quoteMint.toBuffer())
  .update(pumpSwapToken2022Fixture.baseVault.toBuffer())
  .update(pumpSwapToken2022Fixture.quoteVault.toBuffer())
  .update(pumpSwapGlobalConfig.toBuffer())
  .update(pumpSwapFeeConfig.toBuffer())
  .update(SPL_TOKEN_2022_PROGRAM_ID.toBuffer())
  .update(SPL_TOKEN_PROGRAM_ID.toBuffer())
  .update(pumpSwapToken2022Fixture.pool.toBuffer())
  .digest();
assert.deepEqual(pumpSwapHash, independentPumpSwapHash);
assert.throws(
  () => buildMintOracleSourceConfigArgs({
    feedId: pumpSwapFeedId,
    baseMint: pumpSwapToken2022Fixture.baseMint,
    quoteMint: pumpSwapToken2022Fixture.quoteMint,
    pools: [verifiedPumpSwapToken2022, verifiedPumpSwapSpl],
    cluster: "localnet",
  }),
  /PumpSwapRequiresSingleSelectedSource/,
);
assert.equal(meteoraDlmmPriceFromIdX64(0, 10), Q64);
assert.equal(meteoraDlmmPriceFromIdX64(1, 10), 18_465_190_817_783_261_167n);
assert.equal(meteoraDlmmPriceFromIdX64(-1, 10), 18_428_315_757_951_600_016n);
assert.throws(() => meteoraDlmmPriceFromIdX64(0x80000, 10), /ArithmeticOverflow/);
assert.throws(
  () => meteoraDlmmPriceFromIdX64(-0x8000_0000, 10),
  /ArithmeticOverflow/,
);
assert.throws(
  () => meteoraDlmmPriceFromIdX64(1, 0x1_0000),
  /InvalidMeteoraDlmmPriceInput/,
);
const sqrtFiveX64 = 5n * Q64;
const rawTwentyFiveX64 = squareQ64ToX64(sqrtFiveX64);
assert.equal(rawTwentyFiveX64, 461_168_601_842_738_790_400n);
assert.equal(normalizedDirectQ64PriceX64(rawTwentyFiveX64, 6, 6), rawTwentyFiveX64);
assert.equal(normalizedInverseQ64PriceX64(rawTwentyFiveX64, 6, 6), 737_869_762_948_382_064n);
assert.equal(normalizedDirectQ64PriceX64(Q64, 6, 9), 18_446_744_073_709_551n);
assert.equal(normalizedDirectQ64PriceX64(Q64, 9, 6), 18_446_744_073_709_551_616_000n);
assert.equal(
  normalizedInverseQ64PriceX64(meteoraDlmmPriceFromIdX64(1, 10), 9, 6),
  18_428_315_757_951_600_016_598n,
);
assert.equal(
  normalizedCpmmPriceX64(
    2_000_000n,
    50_000_000n,
    6,
    6,
    SourceDirection.QuotePerBase,
  ),
  rawTwentyFiveX64,
);
assert.equal(
  normalizedCpmmPriceX64(
    2_000_000n,
    50_000_000n,
    6,
    6,
    SourceDirection.BasePerQuote,
  ),
  737_869_762_948_382_064n,
);
assert.throws(() => squareQ64ToX64(1n << 128n), /ArithmeticOverflow/);
assert.throws(() => normalizedDirectQ64PriceX64(0n, 6, 6), /InvalidAccountData/);
assert.throws(() => normalizedDirectQ64PriceX64(Q64, 19, 6), /InvalidExponent/);
assert.throws(
  () => normalizedCpmmPriceX64(1n, 1n, 6, 6, 99),
  /InvalidSourceConfig/,
);
const nativeTwapFeedConfig = decodeFeedConfigHeader(toTestFeedConfigV1(buildTestFeedConfigHeader()));
const nativeTwapSourceConfig = decodeSourceConfigHeader(
  buildTestCpmmSourceConfigHeader(),
);
const nativeTwapObservationState = testPublicKey(218);
function buildNativeTwapObservationFixture(params: {
  timestamps: readonly bigint[];
  lastUpdateTimestamp: bigint;
  observationIndex?: number;
}): Buffer {
  const data = Buffer.alloc(RAYDIUM_CPMM_OBSERVATION_STATE_LEN);
  RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR.copy(data, 0);
  data[RAYDIUM_CPMM_OBSERVATION_STATE_INITIALIZED_OFFSET] = 1;
  data.writeUInt16LE(
    params.observationIndex ?? params.timestamps.length - 1,
    RAYDIUM_CPMM_OBSERVATION_STATE_INDEX_OFFSET,
  );
  Buffer.from(nativeTwapSourceConfig.poolOrMarket).copy(
    data,
    RAYDIUM_CPMM_OBSERVATION_STATE_POOL_ID_OFFSET,
  );
  params.timestamps.forEach((timestamp, index) => {
    const offset =
      RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATIONS_OFFSET +
      index * RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_LEN;
    data.writeBigUInt64LE(timestamp, offset);
    data.writeBigUInt64LE(BigInt(index + 1), offset + 8);
    data.writeBigUInt64LE(BigInt(index + 11), offset + 24);
  });
  data.writeBigUInt64LE(
    params.lastUpdateTimestamp,
    RAYDIUM_CPMM_OBSERVATION_STATE_LAST_UPDATE_TIMESTAMP_OFFSET,
  );
  return data;
}

const coldNativeTwapObservation = buildNativeTwapObservationFixture({
  timestamps: [1n, 120n],
  lastUpdateTimestamp: 120n,
});
assert.throws(
  () =>
    extractRaydiumCpmmNativeTwapObservationSample({
      observationState: coldNativeTwapObservation,
      observationStateAddress: nativeTwapObservationState.toBuffer(),
      expectedPoolState: nativeTwapSourceConfig.poolOrMarket,
      windowSecs: 120n,
    }),
  (error: unknown) =>
    error instanceof RaydiumCpmmNativeTwapWindowWarmingError &&
    error.message === "InvalidTwapState" &&
    error.observedSpanSecs === 119n &&
    error.requiredWindowSecs === 120n,
);

assert.throws(
  () =>
    extractRaydiumCpmmNativeTwapObservationSample({
      observationState: coldNativeTwapObservation,
      observationStateAddress: nativeTwapObservationState.toBuffer(),
      expectedPoolState: nativeTwapSourceConfig.poolOrMarket,
      windowSecs: 120n,
      currentTimestamp: 1_000n,
      maxNativeLastUpdateAgeSecs: 60n,
    }),
  (error: unknown) =>
    error instanceof RaydiumCpmmNativeTwapWindowWarmingError &&
    error.message === "InvalidTwapState" &&
    error.observedSpanSecs === 119n &&
    error.requiredWindowSecs === 120n,
  "canonical cold history remains typed even when last update is old",
);

assert.throws(
  () =>
    extractRaydiumCpmmNativeTwapObservationSample({
      observationState: coldNativeTwapObservation,
      observationStateAddress: nativeTwapObservationState.toBuffer(),
      expectedPoolState: nativeTwapSourceConfig.poolOrMarket,
      windowSecs: 120n,
      currentTimestamp: 119n,
      maxNativeLastUpdateAgeSecs: 60n,
    }),
  (error: unknown) =>
    error instanceof Error &&
    !(error instanceof RaydiumCpmmNativeTwapWindowWarmingError) &&
    error.message === "StaleSourceActivity",
  "future last update remains terminal before cold-window classification",
);

for (const invalidCase of [
  {
    label: "non-positive window",
    data: coldNativeTwapObservation,
    windowSecs: 0n,
  },
  {
    label: "future observation",
    data: buildNativeTwapObservationFixture({
      timestamps: [1n, 121n],
      lastUpdateTimestamp: 120n,
    }),
    windowSecs: 120n,
  },
  {
    label: "non-monotonic observations",
    data: buildNativeTwapObservationFixture({
      timestamps: [100n, 90n],
      lastUpdateTimestamp: 120n,
    }),
    windowSecs: 120n,
  },
] as const) {
  assert.throws(
    () =>
      extractRaydiumCpmmNativeTwapObservationSample({
        observationState: invalidCase.data,
        observationStateAddress: nativeTwapObservationState.toBuffer(),
        expectedPoolState: nativeTwapSourceConfig.poolOrMarket,
        windowSecs: invalidCase.windowSecs,
      }),
    (error: unknown) =>
      error instanceof Error &&
      !(error instanceof RaydiumCpmmNativeTwapWindowWarmingError) &&
      error.message === "InvalidTwapState",
    invalidCase.label,
  );
}

const validNativeTwapObservation = buildNativeTwapObservationFixture({
  timestamps: [1n, 121n],
  lastUpdateTimestamp: 121n,
});
const extractedNativeTwapSample = extractRaydiumCpmmNativeTwapObservationSample({
  observationState: validNativeTwapObservation,
  observationStateAddress: nativeTwapObservationState.toBuffer(),
  expectedPoolState: nativeTwapSourceConfig.poolOrMarket,
  windowSecs: 120n,
});
assert.equal(extractedNativeTwapSample.oldTimestamp, 1n);
assert.equal(extractedNativeTwapSample.newTimestamp, 121n);

const projectedNativeTwapObservation = Buffer.from(
  projectRaydiumCpmmObservationAfterCrank({
    observationData: buildNativeTwapObservationFixture({
      timestamps: [100n],
      lastUpdateTimestamp: 100n,
    }),
    currentUnixTs: 115n,
    token0PriceX32: 2n,
    token1PriceX32: 3n,
  }),
);
assert.equal(
  projectedNativeTwapObservation.readUInt16LE(
    RAYDIUM_CPMM_OBSERVATION_STATE_INDEX_OFFSET,
  ),
  1,
);
const projectedObservationOffset =
  RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATIONS_OFFSET +
  RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_LEN;
assert.equal(
  projectedNativeTwapObservation.readBigUInt64LE(projectedObservationOffset),
  115n,
);
assert.equal(
  projectedNativeTwapObservation.readBigUInt64LE(projectedObservationOffset + 8),
  31n,
);
assert.equal(
  projectedNativeTwapObservation.readBigUInt64LE(projectedObservationOffset + 24),
  56n,
);
assert.equal(
  projectedNativeTwapObservation.readBigUInt64LE(
    RAYDIUM_CPMM_OBSERVATION_STATE_LAST_UPDATE_TIMESTAMP_OFFSET,
  ),
  115n,
);
const nativeTwapPool = buildTestRaydiumCpmmPoolAccount({
  baseMint: new PublicKey(nativeTwapSourceConfig.baseMint),
  quoteMint: new PublicKey(nativeTwapSourceConfig.quoteMint),
  baseVault: new PublicKey(nativeTwapSourceConfig.baseVault),
  quoteVault: new PublicKey(nativeTwapSourceConfig.quoteVault),
  observationKey: nativeTwapObservationState,
}).data;
const nativeTwapSample = {
  observationState: nativeTwapObservationState.toBuffer(),
  oldTimestamp: 1n,
  newTimestamp: 121n,
  lastUpdateTimestamp: 121n,
  oldCumulativeToken0PriceX32: 1n << 32n,
  newCumulativeToken0PriceX32: 121n << 32n,
  oldCumulativeToken1PriceX32: 2n << 32n,
  newCumulativeToken1PriceX32: 122n << 32n,
};
assert.equal(
  computeRaydiumCpmmNativeTwapPriceX64ForFeed({
    poolStateAddress: nativeTwapSourceConfig.poolOrMarket,
    poolStateData: nativeTwapPool,
    sourceConfig: nativeTwapSourceConfig,
    feedConfig: nativeTwapFeedConfig,
    direction: nativeTwapSourceConfig.direction,
    sample: nativeTwapSample,
  }) > 0n,
  true,
);
assert.throws(
  () =>
    computeRaydiumCpmmNativeTwapPriceX64ForFeed({
      poolStateAddress: testPublicKey(250).toBuffer(),
      poolStateData: nativeTwapPool,
      sourceConfig: nativeTwapSourceConfig,
      feedConfig: nativeTwapFeedConfig,
      direction: nativeTwapSourceConfig.direction,
      sample: nativeTwapSample,
    }),
  /InvalidSourceConfig/,
);
assert.throws(
  () =>
    computeRaydiumCpmmNativeTwapPriceX64ForFeed({
      poolStateAddress: nativeTwapSourceConfig.poolOrMarket,
      poolStateData: nativeTwapPool,
      sourceConfig: nativeTwapSourceConfig,
      feedConfig: nativeTwapFeedConfig,
      direction: nativeTwapSourceConfig.direction,
      sample: {
        ...nativeTwapSample,
        observationState: testPublicKey(251).toBuffer(),
      },
    }),
  /InvalidRaydiumCpmmObservationState/,
);

const nativeDlmmFeedConfig = decodeFeedConfigHeader(toTestFeedConfigV1(buildTestFeedConfigHeader()));
const nativeDlmmSourceConfig = decodeSourceConfigHeader(buildTestMeteoraDlmmSourceConfigHeader());
const nativeDlmmPoolAddress = new PublicKey(nativeDlmmSourceConfig.poolOrMarket);
const canonicalNativeDlmmObservationStatePda = PublicKey.findProgramAddressSync(
  [Buffer.from("oracle"), nativeDlmmPoolAddress.toBuffer()], METEORA_DLMM_PROGRAM_ID,
);
const nativeDlmmObservationStatePda = findMeteoraDlmmObservationStatePda(nativeDlmmPoolAddress);
assert.deepEqual(
  [nativeDlmmObservationStatePda[0].toBase58(), nativeDlmmObservationStatePda[1]],
  [canonicalNativeDlmmObservationStatePda[0].toBase58(), canonicalNativeDlmmObservationStatePda[1]],
);
const repeatedNativeDlmmObservationStatePda = findMeteoraDlmmObservationStatePda(nativeDlmmPoolAddress);
assert.deepEqual(
  [repeatedNativeDlmmObservationStatePda[0].toBase58(), repeatedNativeDlmmObservationStatePda[1]],
  [nativeDlmmObservationStatePda[0].toBase58(), nativeDlmmObservationStatePda[1]],
);
const nativeDlmmOracleDiscriminator = Uint8Array.of(139, 194, 131, 179, 140, 179, 229, 244);
const nativeDlmmT = 1_790_576_000n;
function buildNativeDlmmOracle(params: {
  oldUpdated?: bigint;
  midUpdated?: bigint;
  newUpdated?: bigint;
  oldCumulative?: bigint;
  newCumulative?: bigint;
  records?: readonly (readonly [cumulative: bigint, created: bigint, updated: bigint])[];
} = {}): Uint8Array {
  const oldUpdated = params.oldUpdated ?? nativeDlmmT;
  const newUpdated = params.newUpdated ?? nativeDlmmT + 240n;
  const midUpdated = params.midUpdated ?? (oldUpdated + newUpdated) / 2n;
  const data = new Uint8Array(128);
  data.set(nativeDlmmOracleDiscriminator);
  const view = new DataView(data.buffer);
  view.setBigUint64(8, 2n, true);
  view.setBigUint64(16, 3n, true);
  view.setBigUint64(24, 3n, true);
  const writeSample = (index: number, cumulative: bigint, timestamp: bigint, created = timestamp) => {
    const offset = 32 + index * 32;
    const encoded = cumulative < 0n ? (1n << 128n) + cumulative : cumulative;
    view.setBigUint64(offset, encoded & ((1n << 64n) - 1n), true);
    view.setBigUint64(offset + 8, encoded >> 64n, true);
    view.setBigUint64(offset + 16, created, true);
    view.setBigUint64(offset + 24, timestamp, true);
  };
  if (params.records) {
    params.records.forEach(([cumulative, created, updated], index) => writeSample(index, cumulative, updated, created));
    return data;
  }
  writeSample(0, params.oldCumulative ?? 0n, oldUpdated);
  writeSample(1, ((params.oldCumulative ?? 0n) + (params.newCumulative ?? 120n)) / 2n, midUpdated);
  writeSample(2, params.newCumulative ?? 120n, newUpdated);
  return data;
}
function buildNativeDlmmPool(reverse = false): Uint8Array {
  const data = new Uint8Array(904);
  data.set([33, 11, 49, 98, 181, 101, 177, 13]);
  data.set(new Uint8Array(32).fill(73), 552);
  new DataView(data.buffer).setUint16(80, 10, true);
  data.set(reverse ? nativeDlmmSourceConfig.quoteMint : nativeDlmmSourceConfig.baseMint, 88);
  data.set(reverse ? nativeDlmmSourceConfig.baseMint : nativeDlmmSourceConfig.quoteMint, 120);
  data.set(reverse ? nativeDlmmSourceConfig.quoteVault : nativeDlmmSourceConfig.baseVault, 152);
  data.set(reverse ? nativeDlmmSourceConfig.baseVault : nativeDlmmSourceConfig.quoteVault, 184);
  return data;
}
assert.equal(METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS, 240);
assert.equal(ACCEPTED_METEORA_DLMM_DEPLOYMENT_UNIX, 1780470187n);
assert.equal(Buffer.from(new PublicKey(METEORA_DLMM_PROGRAMDATA_ADDRESS).toBytes()).toString("hex"),
  "f6158048804122cbd528149bb50667d1a8e3f4a7493b8f54d92775954f32ca58");
assert.equal(METEORA_DLMM_NATIVE_TWAP_MAX_LAST_UPDATE_AGE_SECS, 60);
const nativeDlmmPool = buildNativeDlmmPool();
const copiedNativeDlmmObservationKey = readMeteoraDlmmPoolObservationKey(nativeDlmmPool);
assert.deepEqual(copiedNativeDlmmObservationKey, new Uint8Array(32).fill(73));
copiedNativeDlmmObservationKey.fill(0);
assert.deepEqual(nativeDlmmPool.subarray(552, 584), new Uint8Array(32).fill(73));
assert.throws(() => readMeteoraDlmmPoolObservationKey(nativeDlmmPool.subarray(0, 903)));
const malformedNativeDlmmPool = Uint8Array.from(nativeDlmmPool);
malformedNativeDlmmPool[0] ^= 1;
assert.throws(() => readMeteoraDlmmPoolObservationKey(malformedNativeDlmmPool));
const nativeDlmmOracle = buildNativeDlmmOracle();
const nativeDlmmSample = extractMeteoraDlmmNativeTwapSample({ oracleData: nativeDlmmOracle });
assert.equal(nativeDlmmSample.oldTimestamp, nativeDlmmT);
assert.equal(nativeDlmmSample.newTimestamp - nativeDlmmSample.oldTimestamp, 240n);
assert.deepEqual(
  extractMeteoraDlmmNativeTwapSample({ oracleData: nativeDlmmOracle, currentTimestamp: nativeDlmmT + 300n }),
  nativeDlmmSample,
);
// e9e904e `classify_native_dlmm_readiness`: a 61–120 s tail extends to now with the active bin; > 120 s is stale.
for (const [tail, old, oldCumulative] of [[61n, nativeDlmmT, 0n], [120n, nativeDlmmT + 120n, 60n]] as const) {
  assert.deepEqual(extractMeteoraDlmmNativeTwapSample({ oracleData: nativeDlmmOracle, currentTimestamp: nativeDlmmT + 240n + tail, activeId: 3 }),
    { oldTimestamp: old, oldCumulativeBin: oldCumulative, newTimestamp: nativeDlmmT + 240n + tail, newCumulativeBin: nativeDlmmSample.newCumulativeBin + 3n * tail },
    `tail ${tail}s extends to now; the window is measured from now`);
  assert.equal(classifyMeteoraDlmmDualReadiness(nativeDlmmOracle, nativeDlmmT + 240n + tail), "ready");
}
assert.throws(() => extractMeteoraDlmmNativeTwapSample({ oracleData: nativeDlmmOracle, currentTimestamp: nativeDlmmT + 361n }),
  (error: unknown) => error instanceof MimirNativeTwapUnavailableError && error.reason === "stale-oracle", "tail 121s is stale");
assert.equal(classifyMeteoraDlmmDualReadiness(nativeDlmmOracle, nativeDlmmT + 361n), "STALE");
assert.throws(() => extractMeteoraDlmmNativeTwapSample({ oracleData: nativeDlmmOracle, currentTimestamp: nativeDlmmT + 239n }));
assert.throws(() => extractMeteoraDlmmNativeTwapSample({ oracleData: nativeDlmmOracle, currentTimestamp: -1n }));
assert.throws(() => extractMeteoraDlmmNativeTwapSample({
  oracleData: nativeDlmmOracle, currentTimestamp: 1n << 64n,
}));
const malformedNativeDlmmOracle = Uint8Array.from(nativeDlmmOracle);
malformedNativeDlmmOracle[0] ^= 1;
assert.throws(() => extractMeteoraDlmmNativeTwapSample({ oracleData: malformedNativeDlmmOracle }));
assert.throws(() => extractMeteoraDlmmNativeTwapSample({
  oracleData: buildNativeDlmmOracle({ oldUpdated: nativeDlmmT + 130n, midUpdated: nativeDlmmT + 120n }),
}), /InvalidTwapState/);
assert.throws(() => extractMeteoraDlmmNativeTwapSample({
  oracleData: buildNativeDlmmOracle({ oldUpdated: nativeDlmmT + 1n }),
}));
{
  const T = nativeDlmmT;
  const outcome = (records: readonly (readonly [bigint, bigint, bigint])[], currentTimestamp: bigint | undefined = T + 240n) => {
    try { return extractMeteoraDlmmNativeTwapSample({ oracleData: buildNativeDlmmOracle({ records }), currentTimestamp }); }
    catch (error) { return error; }
  };
  const unavailable = (error: unknown, reason: string, olderUnixTs: bigint | null) => {
    assert.ok(error instanceof MimirNativeTwapUnavailableError);
    assert.equal(error.message, "InvalidTwapState");
    assert.equal(error.reason, reason);
    assert.equal(error.timestamps.olderUnixTs, olderUnixTs);
  };
  const sparse = (midUpdated: bigint) => outcome([[0n, T, T], [60n, midUpdated, midUpdated], [120n, T + 240n, T + 240n]]);
  assert.deepEqual(sparse(T + 120n), { oldTimestamp: T, newTimestamp: T + 240n, oldCumulativeBin: 0n, newCumulativeBin: 120n });
  unavailable(sparse(T + 119n), "interval-too-sparse", T + 119n);
  unavailable(sparse(T + 121n), "interval-too-sparse", T);
  // Record span h: < 120 accepted, 120 refused, on the latest, interior and boundary records.
  assert.equal((outcome([[0n, T, T], [60n, T + 1n, T + 120n], [120n, T + 121n, T + 240n]]) as { oldTimestamp: bigint }).oldTimestamp, T);
  unavailable(outcome([[0n, T, T], [60n, T + 120n, T + 120n], [120n, T + 120n, T + 240n]]), "interval-too-sparse", null);
  unavailable(outcome([[0n, T, T], [60n, T, T + 120n], [120n, T + 240n, T + 240n]]), "interval-too-sparse", T + 120n);
  unavailable(outcome([[0n, T - 120n, T], [60n, T + 120n, T + 120n], [120n, T + 240n, T + 240n]]), "interval-too-sparse", T);
  // Zero creation gap is an ordering failure, not a sparse history.
  const zeroGap = outcome([[0n, T, T], [60n, T + 1n, T + 120n], [120n, T + 120n, T + 239n]]);
  assert.ok(zeroGap instanceof Error && !(zeroGap instanceof MimirNativeTwapUnavailableError) && zeroGap.message === "InvalidTwapState");
  // Window start must be strictly after the pinned DLMM deployment second.
  const D = ACCEPTED_METEORA_DLMM_DEPLOYMENT_UNIX;
  const chronology = (start: bigint) => outcome([[0n, start, start], [0n, start + 120n, start + 120n], [0n, start + 240n, start + 240n]], start + 240n);
  unavailable(chronology(D), "history-too-short", D);
  assert.deepEqual(chronology(D + 1n), { oldTimestamp: D + 1n, newTimestamp: D + 241n, oldCumulativeBin: 0n, newCumulativeBin: 0n });
  // Final-return example: accepted as (T, T+240, 0, 0); the event-ordered bound is 5 bins.
  assert.deepEqual(outcome([[0n, T, T], [0n, T + 120n, T + 120n], [0n, T + 240n, T + 240n]]),
    { oldTimestamp: T, newTimestamp: T + 240n, oldCumulativeBin: 0n, newCumulativeBin: 0n });
  {
    type Event = { t: bigint; write: boolean; bin: number };
    const events: Event[] = [{ t: T, write: true, bin: 0 }, { t: T + 120n, write: true, bin: -10 },
      { t: T + 240n, write: false, bin: 0 }, { t: T + 240n, write: true, bin: 0 }];
    let bin = 0, lastWrite = T, prev = T, integral = 0, charged = 0, eventBound = 0, strictBound = 0;
    for (const event of events.slice(1)) {
      integral += bin * Number(event.t - prev);
      if (event.write) charged += bin * Number(event.t - lastWrite);
      const move = Math.abs(event.bin - bin);
      if (!event.write && move !== 0) {
        eventBound += move * Number(event.t - lastWrite);
        if (event.t < T + 240n) strictBound += move * Number(event.t - lastWrite);
      }
      if (event.write) lastWrite = event.t;
      prev = event.t; bin = event.bin;
    }
    const mu = integral / 240, m = charged / 240;
    assert.equal(mu, -5); assert.equal(m, 0);
    assert.equal(eventBound / 240, 5); assert.equal(strictBound, 0);
    assert.ok(Math.abs(mu - m) <= eventBound / 240 && strictBound / 240 < 5);
  }
  const stale = (() => { try { extractMeteoraDlmmNativeTwapSample({ oracleData: nativeDlmmOracle, currentTimestamp: nativeDlmmT + 361n }); }
    catch (error) { return error; } })();
  assert.ok(stale instanceof MimirNativeTwapUnavailableError && stale.reason === "stale-oracle" && stale.timestamps.latestUnixTs === nativeDlmmT + 240n);
  const short = (() => { try { extractMeteoraDlmmNativeTwapSample({ oracleData: buildNativeDlmmOracle({ oldUpdated: nativeDlmmT + 1n }) }); }
    catch (error) { return error; } })();
  assert.ok(short instanceof MimirNativeTwapUnavailableError && short.reason === "history-too-short");
  // Program ring walk wraps over active_size, not the allocated length.
  const wrapped = new Uint8Array(32 + 8 * 32);
  wrapped.set(nativeDlmmOracle.subarray(0, 32));
  const wrappedView = new DataView(wrapped.buffer);
  wrappedView.setBigUint64(8, 0n, true); wrappedView.setBigUint64(16, 3n, true); wrappedView.setBigUint64(24, 8n, true);
  wrapped.set(nativeDlmmOracle.subarray(96, 128), 32);
  wrapped.set(nativeDlmmOracle.subarray(32, 96), 64);
  assert.deepEqual(extractMeteoraDlmmNativeTwapSample({ oracleData: wrapped, currentTimestamp: nativeDlmmT + 240n }), nativeDlmmSample);
  wrappedView.setBigUint64(8, 3n, true);
  assert.throws(() => extractMeteoraDlmmNativeTwapSample({ oracleData: wrapped }), /InvalidMeteoraDlmmOracleState/);
}
// This same sample is 61 seconds old at T+301; omitting the clock parses structure only.
const structurallyReadStaleDlmmSample = extractMeteoraDlmmNativeTwapSample({ oracleData: nativeDlmmOracle });
assert.equal("currentTimestamp" in structurallyReadStaleDlmmSample, false);

const nativeDlmmWindow = nativeDlmmSample.newTimestamp - nativeDlmmSample.oldTimestamp;
const nativeDlmmDelta = nativeDlmmSample.newCumulativeBin - nativeDlmmSample.oldCumulativeBin;
const nativeDlmmRawPrice = meteoraDlmmPriceFromCumulativeBinX64(nativeDlmmDelta, nativeDlmmWindow, 10);
assert.equal(
  computeMeteoraDlmmNativeTwapPriceX64({
    poolStateData: buildNativeDlmmPool(), sourceConfig: nativeDlmmSourceConfig,
    feedConfig: nativeDlmmFeedConfig, sample: nativeDlmmSample,
  }),
  normalizedDirectQ64PriceX64(nativeDlmmRawPrice, nativeDlmmFeedConfig.baseDecimals, nativeDlmmFeedConfig.quoteDecimals),
);
assert.equal(
  computeMeteoraDlmmNativeTwapPriceX64({
    poolStateData: buildNativeDlmmPool(true), sourceConfig: nativeDlmmSourceConfig,
    feedConfig: nativeDlmmFeedConfig, sample: nativeDlmmSample,
  }),
  normalizedInverseQ64PriceX64(nativeDlmmRawPrice, nativeDlmmFeedConfig.baseDecimals, nativeDlmmFeedConfig.quoteDecimals),
);
const wrongNativeDlmmPairData = buildTestMeteoraDlmmSourceConfigHeader();
wrongNativeDlmmPairData[SOURCE_OFFSETS.baseMint] ^= 1;
assert.throws(() => computeMeteoraDlmmNativeTwapPriceX64({
  poolStateData: buildNativeDlmmPool(), sourceConfig: decodeSourceConfigHeader(wrongNativeDlmmPairData),
  feedConfig: nativeDlmmFeedConfig, sample: nativeDlmmSample,
}));
const wrongNativeDlmmDirectionData = buildTestMeteoraDlmmSourceConfigHeader();
wrongNativeDlmmDirectionData[SOURCE_OFFSETS.direction] = SourceDirection.BasePerQuote;
assert.throws(() => computeMeteoraDlmmNativeTwapPriceX64({
  poolStateData: buildNativeDlmmPool(), sourceConfig: decodeSourceConfigHeader(wrongNativeDlmmDirectionData),
  feedConfig: nativeDlmmFeedConfig, sample: nativeDlmmSample,
}));
assert.throws(() => computeMeteoraDlmmNativeTwapPriceX64({
  poolStateData: buildNativeDlmmPool(), sourceConfig: nativeDlmmSourceConfig,
  feedConfig: nativeDlmmFeedConfig,
  sample: { ...nativeDlmmSample, newCumulativeBin: 443_636n * nativeDlmmWindow + 1n },
}));

const bundleSourceIndex = 0;
const bundleSnapshotData = buildTestSnapshotHeader();
const bundleFeedConfigData = buildTestFeedConfigHeader();
const bundleTwapData = buildTestFeedTwapStateHeader();
const bundlePlanData = buildTestSourcingPlanHeader();
const bundleSourceConfigData = buildTestCpmmSourceConfigHeader(bundleSourceIndex);
const bundleSourceRingData = currentRing(
  bundleSourceIndex,
  (data) => {
    data[RING_OFFSETS.adapterType] = SourceAdapterType.RaydiumCpmm;
  },
);
const bundleSnapshotHeader = decodeFeedSnapshotHeader(bundleSnapshotData);
const bundleFeedConfigHeader = decodeFeedConfigHeader(toTestFeedConfigV1(bundleFeedConfigData));
const bundleTwapHeader = decodeFeedTwapStateHeader(bundleTwapData);
const bundlePlanHeader = decodeSourcingPlanHeader(bundlePlanData);
const bundleSourceConfigHeader = decodeSourceConfigHeader(
  bundleSourceConfigData,
);
const bundleSourceRingHeader = decodeSourceObservationRingHeader(
  bundleSourceRingData,
);
const bundleAccounts = {
  feedSnapshot: findFeedSnapshotPda(TEST_FEED_ID)[0],
  feedConfig: findFeedConfigPda(TEST_FEED_ID)[0],
  registry: findOracleRegistryPda(0)[0],
  sourcingPlan: findSourcingPlanPda(
    TEST_FEED_ID,
    bundlePlanHeader.planId,
    bundlePlanHeader.planVersion,
  )[0],
  feedTwap: findFeedTwapPda(TEST_FEED_ID, TEST_TWAP_VERSION)[0],
  sourceConfig: findSourceConfigPda(TEST_FEED_ID, bundleSourceIndex)[0],
  sourceRing: findSourceRingPda(
    TEST_FEED_ID,
    bundleSourceIndex,
    CURRENT_RING_VERSION,
  )[0],
  baseVault: new PublicKey(bundleSourceConfigHeader.baseVault),
  quoteVault: new PublicKey(bundleSourceConfigHeader.quoteVault),
  poolOrMarket: new PublicKey(bundleSourceConfigHeader.poolOrMarket),
  ammConfig: testPublicKey(217),
  observationState: PublicKey.default,
  nativeTwapProof: PublicKey.default,
};
bundleAccounts.observationState = findRaydiumCpmmObservationStatePda(
  bundleAccounts.poolOrMarket,
  RAYDIUM_CPMM_MAINNET_PROGRAM_ID,
)[0];
bundleAccounts.nativeTwapProof = findNativeTwapProofPda(
  TEST_FEED_ID,
  TEST_TWAP_VERSION,
  bundleSourceIndex,
  bundleAccounts.observationState,
)[0];
const bundlePoolData = buildTestRaydiumCpmmPoolAccount({
  baseMint: new PublicKey(bundleSourceConfigHeader.baseMint),
  quoteMint: new PublicKey(bundleSourceConfigHeader.quoteMint),
  baseVault: bundleAccounts.baseVault,
  quoteVault: bundleAccounts.quoteVault,
  observationKey: bundleAccounts.observationState,
}).data;
bundleAccounts.ammConfig
  .toBuffer()
  .copy(bundlePoolData, RAYDIUM_CPMM_POOL_OFFSET_AMM_CONFIG);
const bundlePayer = testPublicKey(252);
const header = decodeFeedSnapshotHeader(buildTestSnapshotHeader());
const aliasingSnapshotData = buildTestSnapshotHeader();
const aliasingSnapshotHeader = decodeFeedSnapshotHeader(aliasingSnapshotData);
aliasingSnapshotData[OFFSETS.feedId] ^= 0xff;
assert.equal(aliasingSnapshotHeader.feedId[0], TEST_FEED_ID[0]);
assert.equal(
  MIMIR_PROGRAM_ID.toBase58(),
  MIMIR_MAINNET_PROGRAM_ADDRESS,
);
assert.equal(MIMIR_PROGRAM_ID.equals(MIMIR_MAINNET_PROGRAM_ID), true);
for (const profile of [
  resolveMimirProgramProfile(),
  resolveMimirProgramProfile({ cluster: "mainnet" }),
  resolveMimirProgramProfile({ cluster: "localnet" }),
]) {
  assert.equal(profile.name, "mainnet");
  assert.equal(profile.programId.toBase58(), MIMIR_MAINNET_PROGRAM_ADDRESS);
}
assert.equal(
  resolveMimirProgramProfile({ cluster: "localnet", programId: OLD_DEVNET_PROGRAM_ID }).name,
  "custom",
);
assert.equal(
  resolveMimirProgramProfile({ cluster: "localnet", programId: OLD_LEGACY_PROGRAM_ID }).name,
  "custom",
);
assert.throws(() => resolveMimirProgramProfile({ cluster: "testnet" as never }));
for (const oldProgramId of [OLD_DEVNET_PROGRAM_ID, OLD_LEGACY_PROGRAM_ID]) {
  const oldProgramError = Object.assign(new Error("custom program error: 0x3a"), {
    logs: [`Program ${oldProgramId.toBase58()} failed: custom program error: 0x3a`],
  });
  assert.equal(parseMimirProgramError(oldProgramError), null);
  assert.equal(
    parseMimirProgramError(oldProgramError, { programId: oldProgramId })?.code,
    58,
  );
}
const mimirRevisionError = new Error(
  'Transaction failed: {"InstructionError":[1,{"Custom":58}]}',
);
(mimirRevisionError as { logs?: string[] }).logs = [
  `Program ${MIMIR_PROGRAM_ID.toBase58()} invoke [1]`,
  `Program ${MIMIR_PROGRAM_ID.toBase58()} failed: custom program error: 0x3a`,
];
const parsedMimirRevisionError = parseMimirProgramError(mimirRevisionError);
assert.equal(parsedMimirRevisionError?.programId.equals(MIMIR_PROGRAM_ID), true);
assert.equal(parsedMimirRevisionError?.code, 58);
assert.equal(parsedMimirRevisionError?.hex, "0x3a");
assert.equal(parsedMimirRevisionError?.name, "UnexpectedSnapshotRevision");
assert.equal(parsedMimirRevisionError?.instructionIndex, 1);
assert.equal(isRetryableMimirRevisionDrift(mimirRevisionError), true);
verifySnapshotHeader(header, defaultTestSnapshotPolicy());
assert.throws(
  () =>
    verifySnapshotHeader(header, {
      ...defaultTestSnapshotPolicy(),
      notional: 1_000_000n,
    }),
  /NotionalTooLarge/,
);

const inconsistentEconomicAndCapitalDerivedCap = decodeFeedSnapshotHeader(
  buildTestSnapshotHeader((data) => {
    writeTestU128(
      data,
      OFFSETS.attackerSetCapitalRequiredFloorNative,
      12_000_000n,
    );
  }),
);
assert.throws(
  () =>
    verifySnapshotHeader(inconsistentEconomicAndCapitalDerivedCap, {
      ...defaultTestSnapshotPolicy(),
      notional: 1_000_000n,
    }),
  /InvalidCapModel/,
);

const inconsistentAttackerSetFeeLossFloorMirror = decodeFeedSnapshotHeader(
  buildTestSnapshotHeader((data) => {
    writeTestU128(data, OFFSETS.attackerSetFeeLossFloorMirror, 600_001n);
  }),
);
assert.throws(
  () =>
    verifySnapshotHeader(
      inconsistentAttackerSetFeeLossFloorMirror,
      defaultTestSnapshotPolicy(),
    ),
  /InvalidCapModel/,
);

const roundedCapitalDerivedCap = decodeFeedSnapshotHeader(
  buildTestSnapshotHeader((data) => {
    writeTestU128(data, OFFSETS.attackerSetFeeLossFloorMirror, 600_001n);
    writeTestU128(data, OFFSETS.attackerSetEconLossFloorNative, 600_001n);
    writeTestU128(data, OFFSETS.attackerSetCapitalRequiredFloorNative, 15_001n);
    writeTestU128(data, OFFSETS.bandCapitalNotional, 500_033n);
  }),
);
assert.equal(
  roundedCapitalDerivedCap.attackerSetFeeLossFloorMirror,
  roundedCapitalDerivedCap.attackerSetEconLossFloorNative,
);
verifySnapshotHeader(roundedCapitalDerivedCap, {
  ...defaultTestSnapshotPolicy(),
  notional: 500_033n,
});
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(
        buildTestSnapshotHeader((data) => {
          writeTestU128(
            data,
            OFFSETS.attackerSetCapitalRequiredFloorNative,
            15_001n,
          );
          writeTestU128(data, OFFSETS.bandCapitalNotional, 500_032n);
        }),
      ),
      defaultTestSnapshotPolicy(),
    ),
  /InvalidCapModel/,
);
const testU128Max = (1n << 128n) - 1n;
const maxNonOverflowCapital = testU128Max / 10_000n;
const maxNonOverflowDerivedNotional =
  (maxNonOverflowCapital * 10_000n) / 50n / 6n;
verifySnapshotHeader(
  decodeFeedSnapshotHeader(
    buildTestSnapshotHeader((data) => {
      writeTestU128(
        data,
        OFFSETS.attackerSetCapitalRequiredFloorNative,
        maxNonOverflowCapital,
      );
      writeTestU128(
        data,
        OFFSETS.bandCapitalNotional,
        maxNonOverflowDerivedNotional,
      );
    }),
  ),
  defaultTestSnapshotPolicy(),
);
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(
        buildTestSnapshotHeader((data) => {
          writeTestU128(data, OFFSETS.bandCapitalNotional, 500_001n);
        }),
      ),
      defaultTestSnapshotPolicy(),
    ),
  /InvalidCapModel/,
);
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(
        buildTestSnapshotHeader((data) => {
          writeTestU128(
            data,
            OFFSETS.attackerSetCapitalRequiredFloorNative,
            maxNonOverflowCapital + 1n,
          );
          writeTestU128(
            data,
            OFFSETS.bandCapitalNotional,
            testU128Max,
          );
        }),
      ),
      defaultTestSnapshotPolicy(),
    ),
  /InvalidCapModel/,
);
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(
        buildTestSnapshotHeader((data) => {
          data.writeUInt16LE(8, OFFSETS.capTierSafetyFactor);
        }),
      ),
      defaultTestSnapshotPolicy(),
    ),
  /InvalidCapModel/,
);
const canonicalSnapshotPolicy = {
  ...defaultTestSnapshotPolicy(),
  flags:
    defaultTestSnapshotPolicy().flags | VerifyFlags.RequireCanonicalSnapshot,
};
assert.throws(
  () => verifySnapshotHeader(header, canonicalSnapshotPolicy),
  /MissingSnapshotAddress/,
);
verifySnapshotHeader(header, canonicalSnapshotPolicy, {
  snapshot: findFeedSnapshotPda(TEST_FEED_ID)[0],
});
assert.throws(
  () =>
    verifySnapshotHeader(header, canonicalSnapshotPolicy, {
      snapshot: Keypair.generate().publicKey,
    }),
  /InvalidSnapshotAddress/,
);
assert.throws(
  () =>
    verifySnapshotHeader(header, {
      ...defaultTestSnapshotPolicy(),
      expectedSnapshotRevision: 9n,
    }),
  /UnexpectedSnapshotRevision/,
);
const feedConfigHeader = decodeFeedConfigHeader(toTestFeedConfigV1(buildTestFeedConfigHeader()));
assert.throws(
  () =>
    decodeFeedConfigHeader(toTestFeedConfigV1(
      buildTestFeedConfigHeader((data) => {
        Buffer.alloc(32).copy(data, CONFIG_OFFSETS.baseMint);
      }),
    )),
  /InvalidFeedConfig/,
);
assert.throws(
  () =>
    decodeFeedConfigHeader(toTestFeedConfigV1(
      buildTestFeedConfigHeader((data) => {
        Buffer.from(data.subarray(CONFIG_OFFSETS.baseMint, CONFIG_OFFSETS.baseMint + 32)).copy(
          data,
          CONFIG_OFFSETS.quoteMint,
        );
      }),
    )),
  /InvalidFeedConfig/,
);
verifyFeedConfigForSnapshot(
  feedConfigHeader,
  header,
  defaultTestSnapshotPolicy(),
);
assert.throws(
  () =>
    verifyFeedConfigForSnapshot(
      decodeFeedConfigHeader(toTestFeedConfigV1(
        buildTestFeedConfigHeader((data) => {
          Buffer.alloc(32, 88).copy(data, CONFIG_OFFSETS.anchorPolicyHash);
        }),
      )),
      header,
      defaultTestSnapshotPolicy(),
    ),
  /FeedConfigPolicyMismatch/,
);
verifyFeedConfigForSnapshot(
  feedConfigHeader,
  decodeFeedSnapshotHeader(
    buildTestSnapshotHeader((data) => {
      data[OFFSETS.riskTier] = RiskTier.TierB;
    }),
  ),
  defaultTestSnapshotPolicy(),
);
const tierBFeedConfigHeader = { ...feedConfigHeader, riskTier: RiskTier.TierB };
verifyFeedConfigForSnapshot(
  tierBFeedConfigHeader,
  decodeFeedSnapshotHeader(
    buildTestSnapshotHeader((data) => {
      data[OFFSETS.riskTier] = RiskTier.TierC;
    }),
  ),
  defaultTestSnapshotPolicy(),
);
assert.throws(
  () => verifyFeedConfigForSnapshot(tierBFeedConfigHeader, header, defaultTestSnapshotPolicy()),
  /InvalidRouteability/,
);
const registryHeader = decodeOracleRegistryHeader(
  buildTestOracleRegistryHeader(),
);
const adapterVersionPolicyCases = [
  { adapterType: 1, adapterVersion: 0, rawMask: 0, expected: true, registryExpected: true },
  { adapterType: 1, adapterVersion: 1, rawMask: 0, expected: true, registryExpected: false },
  { adapterType: 1, adapterVersion: 0, rawMask: 1, expected: true, registryExpected: true },
  { adapterType: 1, adapterVersion: 1, rawMask: 1, expected: true, registryExpected: false },
  { adapterType: 1, adapterVersion: 0, rawMask: 2, expected: true, registryExpected: false },
  { adapterType: 1, adapterVersion: 1, rawMask: 2, expected: true, registryExpected: false },
  { adapterType: 1, adapterVersion: 0, rawMask: 3, expected: true, registryExpected: true },
  { adapterType: 1, adapterVersion: 1, rawMask: 3, expected: true, registryExpected: true },
  { adapterType: 1, adapterVersion: 1, rawMask: 4, expected: true, registryExpected: false },
  { adapterType: 0, adapterVersion: 1, rawMask: 3, expected: false, registryExpected: false },
  { adapterType: 8, adapterVersion: 0, rawMask: 0, expected: false, registryExpected: false },
  { adapterType: 1, adapterVersion: 2, rawMask: 3, expected: false, registryExpected: false },
] as const;
for (const testCase of adapterVersionPolicyCases) {
  const shared = sharedSourceAdapterSupportsVersion(testCase.adapterType, testCase.adapterVersion);
  const beta = betaSourceAdapterSupportsVersion(testCase.adapterType, testCase.adapterVersion);
  assert.equal(shared, testCase.expected, `shared adapter policy ${JSON.stringify(testCase)}`);
  assert.equal(beta, testCase.expected, `beta adapter policy ${JSON.stringify(testCase)}`);
  assert.equal(shared, beta, `public adapter policy parity ${JSON.stringify(testCase)}`);
  if (testCase.adapterType !== 8) {
    const supportedAdapterMask = 2n;
    const registry = { ...registryHeader, supportedAdapterMask,
      supportedAdapterVersionMasks: [0, testCase.rawMask, 0, 0, 0, 0, 0, 0] };
    assert.equal(registrySupportsAdapterVersion(registry, testCase.adapterType, testCase.adapterVersion), testCase.registryExpected,
      `registry adapter policy ${JSON.stringify(testCase)}`);
  }
}
assert.deepEqual(
  Array.from({ length: 9 }, (_, value) => isKnownSourceAdapterType(value)),
  [true, true, true, true, true, true, true, true, false],
);
assert.deepEqual(
  Array.from({ length: 9 }, (_, value) => isSupportedSourceAdapterTypeV0(value)),
  [true, true, true, true, true, false, true, true, false],
);
verifyRegistryForSnapshot(registryHeader, header, feedConfigHeader);
const additiveRegistry = decodeOracleRegistryHeader(buildTestOracleRegistryHeader((data) => {
  data.writeBigUInt64LE(2n, REGISTRY_OFFSETS.registryEpoch);
}));
assert.doesNotThrow(() => verifyRegistryForSnapshot(additiveRegistry, header, feedConfigHeader));
const regressedRegistry = { ...registryHeader, registryEpoch: 0n };
assert.throws(() => verifyRegistryForSnapshot(regressedRegistry, header, feedConfigHeader), /RegistryEpochMismatch/);
assert.deepEqual(registryHeader.supportedAdapterVersionMasks, [0, 0, 0, 0, 0, 0, 0, 0]);
assert.equal(normalizedRegistryAdapterVersionMask(0), 1);
assert.equal(
  registrySupportsAdapterVersion(
    registryHeader,
    SourceAdapterType.OrcaWhirlpool,
    0,
  ),
  true,
);
assert.equal(
  registrySupportsAdapterVersion(
    registryHeader,
    SourceAdapterType.MeteoraDlmm,
    0,
  ),
  true,
);
assert.equal(
  registrySupportsAdapterVersion(
    registryHeader,
    SourceAdapterType.MeteoraDammV2,
    0,
  ),
  true,
);
assert.equal(
  registrySupportsAdapterVersion(
    registryHeader,
    SourceAdapterType.OrcaWhirlpool,
    1,
  ),
  false,
);
const explicitV0Registry = decodeOracleRegistryHeader(
  buildTestOracleRegistryHeader((data) => {
    data.writeUInt16LE(
      1,
      REGISTRY_OFFSETS.adapterVersionMasks +
        SourceAdapterType.OrcaWhirlpool * REGISTRY_ADAPTER_VERSION_MASK_BYTES,
    );
  }),
);
assert.equal(
  explicitV0Registry.supportedAdapterVersionMasks[
    SourceAdapterType.OrcaWhirlpool
  ],
  1,
);
verifyRegistryAdapterVersionPolicy(explicitV0Registry);
const unsupportedVersionRegistry = decodeOracleRegistryHeader(
  buildTestOracleRegistryHeader((data) => {
    data.writeUInt16LE(
      2,
      REGISTRY_OFFSETS.adapterVersionMasks +
        SourceAdapterType.OrcaWhirlpool * REGISTRY_ADAPTER_VERSION_MASK_BYTES,
    );
  }),
);
assert.throws(
  () => verifyRegistryAdapterVersionPolicy(unsupportedVersionRegistry),
  /InvalidRegistry/,
);
const strayClmmVersionRegistry = decodeOracleRegistryHeader(
  buildTestOracleRegistryHeader((data) => {
    data.writeUInt16LE(
      1,
      REGISTRY_OFFSETS.adapterVersionMasks +
        SourceAdapterType.RaydiumClmm * REGISTRY_ADAPTER_VERSION_MASK_BYTES,
    );
  }),
);
assert.throws(
  () => verifyRegistryAdapterVersionPolicy(strayClmmVersionRegistry),
  /InvalidRegistry/,
);
const fullCapabilityRegistry = decodeOracleRegistryHeader(
  buildTestOracleRegistryHeader((data) => {
    data.writeBigUInt64LE(
      EXECUTABLE_SOURCE_ADAPTER_MASK_V0,
      REGISTRY_OFFSETS.supportedAdapterMask,
    );
  }),
);
verifyRegistryAdapterVersionPolicy(fullCapabilityRegistry);
assert.equal(
  registrySupportsAdapterVersion(fullCapabilityRegistry, SourceAdapterType.RaydiumAmmV4, 0),
  true,
);
assert.equal(
  registrySupportsAdapterVersion(fullCapabilityRegistry, SourceAdapterType.PumpSwap, 0),
  true,
);
const customAdmittedRegistry = decodeOracleRegistryHeader(
  buildTestOracleRegistryHeader((data) => {
    data.writeBigUInt64LE(
      EXECUTABLE_SOURCE_ADAPTER_MASK_V0 |
        (1n << BigInt(SourceAdapterType.Custom)),
      REGISTRY_OFFSETS.supportedAdapterMask,
    );
  }),
);
assert.throws(
  () => verifyRegistryAdapterVersionPolicy(customAdmittedRegistry),
  /InvalidRegistry/,
);
const clmmAdmittedRegistry = decodeOracleRegistryHeader(
  buildTestOracleRegistryHeader((data) => {
    data.writeBigUInt64LE(
      EXECUTABLE_SOURCE_ADAPTER_MASK_V0,
      REGISTRY_OFFSETS.supportedAdapterMask,
    );
  }),
);
verifyRegistryAdapterVersionPolicy(clmmAdmittedRegistry);
for (const adapterType of [SourceAdapterType.RaydiumClmm, SourceAdapterType.PumpSwap]) {
  for (const [rawMask, expectedV0, expectedV1] of [
    [0, true, false],
    [1, true, false],
    [2, false, false],
    [3, true, true],
    [4, false, false],
  ] as const) {
    const matrixRegistry = decodeOracleRegistryHeader(
      buildTestOracleRegistryHeader((data) => {
        data.writeBigUInt64LE(1n << BigInt(adapterType), REGISTRY_OFFSETS.supportedAdapterMask);
        data.writeUInt16LE(
          rawMask,
          REGISTRY_OFFSETS.adapterVersionMasks + adapterType * REGISTRY_ADAPTER_VERSION_MASK_BYTES,
        );
      }),
    );
    assert.equal(registrySupportsAdapterVersion(matrixRegistry, adapterType, 0), expectedV0);
    assert.equal(registrySupportsAdapterVersion(matrixRegistry, adapterType, 1), expectedV1);
    if (rawMask === 2 || rawMask === 4) {
      assert.throws(() => verifyRegistryAdapterVersionPolicy(matrixRegistry), /InvalidRegistry/);
    } else {
      assert.doesNotThrow(() => verifyRegistryAdapterVersionPolicy(matrixRegistry));
    }
  }
}
const nonClmmVersion3Registry = decodeOracleRegistryHeader(
  buildTestOracleRegistryHeader((data) => {
    data.writeUInt16LE(
      3,
      REGISTRY_OFFSETS.adapterVersionMasks + SourceAdapterType.OrcaWhirlpool * REGISTRY_ADAPTER_VERSION_MASK_BYTES,
    );
  }),
);
assert.equal(registrySupportsAdapterVersion(nonClmmVersion3Registry, SourceAdapterType.OrcaWhirlpool, 1), false);
assert.throws(() => verifyRegistryAdapterVersionPolicy(nonClmmVersion3Registry), /InvalidRegistry/);
assert.throws(
  () => verifyRegistryAdapterVersionPolicy(
    decodeOracleRegistryHeader(buildTestOracleRegistryHeader((data) => {
      data.writeBigUInt64LE(0n, REGISTRY_OFFSETS.supportedAdapterMask);
    })),
  ),
  /InvalidRegistry/,
);
const governancePolicy = findGovernancePolicyPda()[0];
const governancePolicyHeader = decodeGovernancePolicyHeader(
  buildTestGovernancePolicyHeader(),
);
assert.equal(
  Buffer.from(governancePolicyHeader.authority).equals(
    TEST_GOVERNANCE_AUTHORITY.toBuffer(),
  ),
  true,
);
assert.equal(
  Buffer.from(governancePolicyHeader.signer1).equals(
    TEST_GOVERNANCE_SIGNER_1.toBuffer(),
  ),
  true,
);
assert.equal(governancePolicyHeader.threshold, 2);
const invalidGovernancePolicy = buildTestGovernancePolicyHeader();
invalidGovernancePolicy.writeBigUInt64LE(0n, GOVERNANCE_POLICY_OFFSETS.minDelaySlots);
assert.throws(
  () => decodeGovernancePolicyHeader(invalidGovernancePolicy),
  /InvalidGovernancePolicy/,
);
const registryRiskRaise = buildTestOracleRegistryHeader((data) => {
  data.writeBigUInt64LE(
    EXECUTABLE_SOURCE_ADAPTER_MASK_V0,
    REGISTRY_OFFSETS.supportedAdapterMask,
  );
  data.writeBigUInt64LE(2n, REGISTRY_OFFSETS.registryEpoch);
});
const governanceActionHash = computeRegistryGovernanceActionHash(
  buildTestOracleRegistryHeader(),
  registryRiskRaise,
);
const governanceAction = findGovernanceActionPda(governanceActionHash)[0];
const governanceActionHeader = decodeGovernanceActionHeader(
  buildTestGovernanceActionHeader(governanceActionHash, 100n),
);
assert.equal(
  Buffer.from(governanceActionHeader.policy).equals(governancePolicy.toBuffer()),
  true,
);
assert.equal(
  Buffer.from(governanceActionHeader.actionHash).equals(governanceActionHash),
  true,
);
assert.equal(governanceActionHeader.approvalMask, 1);
const newGovernanceActionEvaluation = evaluateNewGovernanceActionHeader({
  policy: governancePolicyHeader,
  action: governanceActionHeader,
  policyAddress: governancePolicy.toBuffer(),
  proposer: TEST_GOVERNANCE_AUTHORITY.toBuffer(),
  clockSlot: 100n,
});
assert.equal(newGovernanceActionEvaluation.eligible, true);
assert.equal(newGovernanceActionEvaluation.signerBit, 1);
assert.equal(
  newGovernanceActionEvaluation.expectedStatus,
  GovernanceActionStatus.Pending,
);
const approveGovernanceActionEvaluation = evaluateGovernanceActionApproval({
  policy: governancePolicyHeader,
  action: governanceActionHeader,
  policyAddress: governancePolicy.toBuffer(),
  actionHash: governanceActionHash,
  signer: TEST_GOVERNANCE_SIGNER_1.toBuffer(),
  clockSlot: 101n,
  expectedActionRevision: 1n,
});
assert.equal(approveGovernanceActionEvaluation.eligible, true);
assert.equal(approveGovernanceActionEvaluation.signerBit, 2);
assert.equal(approveGovernanceActionEvaluation.nextApprovalMask, 3);
assert.equal(approveGovernanceActionEvaluation.nextStatus, GovernanceActionStatus.Approved);
assert.equal(approveGovernanceActionEvaluation.nextRevision, 2n);
const duplicateGovernanceApproval = evaluateGovernanceActionApproval({
  policy: governancePolicyHeader,
  action: governanceActionHeader,
  policyAddress: governancePolicy.toBuffer(),
  actionHash: governanceActionHash,
  signer: TEST_GOVERNANCE_AUTHORITY.toBuffer(),
  clockSlot: 101n,
  expectedActionRevision: 1n,
});
assert.deepEqual(duplicateGovernanceApproval.failureCodes, [
  "DuplicateApproval",
]);
const expiredGovernanceApproval = evaluateGovernanceActionApproval({
  policy: governancePolicyHeader,
  action: governanceActionHeader,
  policyAddress: governancePolicy.toBuffer(),
  actionHash: governanceActionHash,
  signer: TEST_GOVERNANCE_SIGNER_1.toBuffer(),
  clockSlot: 123n,
  expectedActionRevision: 1n,
});
assert.deepEqual(expiredGovernanceApproval.failureCodes, ["ActionExpired"]);
const unsupportedTargetGovernanceAction = evaluateNewGovernanceActionHeader({
  policy: governancePolicyHeader,
  action: {
    ...governanceActionHeader,
    targetKind: 99,
  },
  policyAddress: governancePolicy.toBuffer(),
  proposer: TEST_GOVERNANCE_AUTHORITY.toBuffer(),
  clockSlot: 100n,
});
assert.deepEqual(unsupportedTargetGovernanceAction.failureCodes, [
  "UnsupportedTargetKind",
]);
const earlyGovernanceAction = evaluateNewGovernanceActionHeader({
  policy: governancePolicyHeader,
  action: {
    ...governanceActionHeader,
    effectiveSlot: 101n,
    expiresSlot: 121n,
  },
  policyAddress: governancePolicy.toBuffer(),
  proposer: TEST_GOVERNANCE_AUTHORITY.toBuffer(),
  clockSlot: 100n,
});
assert.deepEqual(earlyGovernanceAction.failureCodes, ["EffectiveSlotTooEarly"]);
const thresholdOneGovernancePolicyHeader = decodeGovernancePolicyHeader(
  buildTestGovernancePolicyHeader((data) => {
    data[GOVERNANCE_POLICY_OFFSETS.threshold] = 1;
  }),
);
const thresholdOneGovernanceActionHeader = decodeGovernanceActionHeader(
  buildTestGovernanceActionHeader(governanceActionHash, 100n, (data) => {
    data[GOVERNANCE_ACTION_OFFSETS.status] = GovernanceActionStatus.Approved;
    data[GOVERNANCE_ACTION_OFFSETS.threshold] = 1;
  }),
);
const thresholdOneGovernanceActionEvaluation =
  evaluateNewGovernanceActionHeader({
    policy: thresholdOneGovernancePolicyHeader,
    action: thresholdOneGovernanceActionHeader,
    policyAddress: governancePolicy.toBuffer(),
    proposer: TEST_GOVERNANCE_AUTHORITY.toBuffer(),
    clockSlot: 100n,
  });
assert.equal(thresholdOneGovernanceActionEvaluation.eligible, true);
assert.equal(
  thresholdOneGovernanceActionEvaluation.expectedStatus,
  GovernanceActionStatus.Approved,
);
const thresholdThreeGovernancePolicyHeader = decodeGovernancePolicyHeader(
  buildTestGovernancePolicyHeader((data) => {
    data[GOVERNANCE_POLICY_OFFSETS.threshold] = 3;
  }),
);
const thresholdThreeGovernanceActionHeader = decodeGovernanceActionHeader(
  buildTestGovernanceActionHeader(governanceActionHash, 100n, (data) => {
    data[GOVERNANCE_ACTION_OFFSETS.threshold] = 3;
  }),
);
const thresholdThreeSecondApproval = evaluateGovernanceActionApproval({
  policy: thresholdThreeGovernancePolicyHeader,
  action: thresholdThreeGovernanceActionHeader,
  policyAddress: governancePolicy.toBuffer(),
  actionHash: governanceActionHash,
  signer: TEST_GOVERNANCE_SIGNER_1.toBuffer(),
  clockSlot: 101n,
  expectedActionRevision: 1n,
});
assert.equal(thresholdThreeSecondApproval.eligible, true);
assert.equal(
  thresholdThreeSecondApproval.nextStatus,
  GovernanceActionStatus.Pending,
);
const thresholdThreeThirdApproval = evaluateGovernanceActionApproval({
  policy: thresholdThreeGovernancePolicyHeader,
  action: {
    ...thresholdThreeGovernanceActionHeader,
    approvalMask: thresholdThreeSecondApproval.nextApprovalMask ?? 0,
    revision: thresholdThreeSecondApproval.nextRevision ?? 0n,
    status: GovernanceActionStatus.Pending,
  },
  policyAddress: governancePolicy.toBuffer(),
  actionHash: governanceActionHash,
  signer: TEST_GOVERNANCE_SIGNER_2.toBuffer(),
  clockSlot: 101n,
  expectedActionRevision: 2n,
});
assert.equal(thresholdThreeThirdApproval.eligible, true);
assert.equal(
  thresholdThreeThirdApproval.nextStatus,
  GovernanceActionStatus.Approved,
);
const rotatedPolicyHeader = buildTestGovernancePolicyHeader((data) => {
  data[GOVERNANCE_POLICY_OFFSETS.threshold] = 3;
  data.writeBigUInt64LE(2n, GOVERNANCE_POLICY_OFFSETS.revision);
});
const policyActionHash = computeGovernancePolicyActionHash(
  buildTestGovernancePolicyHeader(),
  rotatedPolicyHeader,
);
assert.equal(policyActionHash.length, 32);
const policyActionHeader = decodeGovernanceActionHeader(
  buildTestGovernanceActionHeader(
    policyActionHash,
    100n,
    GovernanceActionTargetKind.Policy,
  ),
);
assert.equal(policyActionHeader.targetKind, GovernanceActionTargetKind.Policy);
for (const retiredTargetKind of [3, 4, 5, 6, 7, 8, 9]) {
  assert.throws(
    () =>
      decodeGovernanceActionHeader(
        buildTestGovernanceActionHeader(
          governanceActionHash,
          100n,
          retiredTargetKind,
        ),
      ),
    /InvalidGovernanceAction/,
  );
}
const invalidGovernanceAction = buildTestGovernanceActionHeader(
  governanceActionHash,
  100n,
);
invalidGovernanceAction[GOVERNANCE_ACTION_OFFSETS.targetKind] = 0;
assert.throws(
  () => decodeGovernanceActionHeader(invalidGovernanceAction),
  /InvalidGovernanceAction/,
);
const reservationHeader = decodeFeedReservationHeader(
  buildTestFeedReservationHeader(),
);
assert.equal(Buffer.from(reservationHeader.feedId).equals(TEST_FEED_ID), true);
assert.equal(
  Buffer.from(reservationHeader.authority).equals(
    TEST_GOVERNANCE_AUTHORITY.toBuffer(),
  ),
  true,
);
const sourcingPlanHeader = decodeSourcingPlanHeader(
  buildTestSourcingPlanHeader(),
);
assert.throws(
  () =>
    decodeSourcingPlanHeader(
      buildTestSourcingPlanHeader((data) => {
        Buffer.alloc(32).copy(data, PLAN_OFFSETS.quoteMint);
      }),
    ),
  /InvalidPlan/,
);
assert.throws(
  () =>
    decodeSourcingPlanHeader(
      buildTestSourcingPlanHeader((data) => {
        Buffer.from(data.subarray(PLAN_OFFSETS.baseMint, PLAN_OFFSETS.baseMint + 32)).copy(
          data,
          PLAN_OFFSETS.quoteMint,
        );
      }),
    ),
  /InvalidPlan/,
);
verifySourcingPlanForSnapshot(
  sourcingPlanHeader,
  header,
  defaultTestSnapshotPolicy(),
  feedConfigHeader,
  registryHeader,
);
const sourceConfigHeader = decodeSourceConfigHeader(
  buildTestSourceConfigHeader(),
);
verifySourceConfigHeader(sourceConfigHeader, TEST_FEED_ID, 0);
const sourceRingHeader = decodeSourceObservationRingHeader(
  currentRing(),
);
verifySourceObservationRingHeader(
  sourceRingHeader,
  TEST_FEED_ID,
  0,
  CURRENT_RING_VERSION,
  TEST_PLAN_HASH,
  TEST_CLOCK_SLOT,
  5,
);

const setTestU128 = (data: Buffer, offset: number, value: bigint) => {
  data.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  data.writeBigUInt64LE(value >> 64n, offset + 8);
};
const makeDammOnlyBRing = () => {
  const data = Buffer.alloc(544);
  buildTestSourceObservationRingHeader().copy(data);
  data.writeUInt16LE(544, 10);
  data.writeUInt16LE(1, RING_OFFSETS.ringVersion);
  data.writeUInt16LE(300, RING_OFFSETS.capacity);
  data.writeUInt16LE(0, RING_OFFSETS.head);
  data[RING_OFFSETS.adapterType] = SourceAdapterType.MeteoraDammV2;
  data[RING_OFFSETS.observationKind] = ObservationKind.Spot;
  for (const offset of [RING_OFFSETS.activeMinDepthTo50BpsNative, RING_OFFSETS.activeMinLiquidityNative,
    RING_OFFSETS.activeMinEconLossFloorNative, RING_OFFSETS.activeMinCapitalRequiredFloorNative]) setTestU128(data, offset, 1n);
  return data;
};
const makeDammOnlyBModule = (ring: Buffer, withPublication = false, invalidated = false) => {
  const data = Buffer.alloc(256);
  data.set([0x4d, 0x54, 0x50, 0x31]);
  data.writeUInt16LE(1, 4); data.writeUInt16LE(256, 6);
  data.writeBigUInt64LE(ring.readBigUInt64LE(RING_OFFSETS.newestSlot), 8);
  const o = SOURCE_RING_DAMM_ONLYB_V1;
  data.writeUInt16LE(o.proofKind, o.proofKindOffset);
  data.writeUInt16LE(o.presenceA | (withPublication ? o.presenceB | o.presenceQ : 0) | (invalidated ? o.invalidated : 0), o.flagsOffset);
  data.fill(1, o.contextHashOffset, o.contextHashOffset + 32);
  data.writeBigInt64LE(1_200n, o.lastObservationUnixTsOffset);
  const writeAnchor = (offset: number, slot: bigint, unixTs: bigint) => {
    data.writeBigUInt64LE(slot, offset);
    data.writeBigInt64LE(unixTs, offset + 8);
    setTestU128(data, offset + 16, 1n << 64n);
    setTestU128(data, offset + 32, 0n);
    data.writeBigUInt64LE(0n, offset + 48);
    setTestU128(data, offset + 56, 1n);
  };
  writeAnchor(o.anchorOffset, 10n, 1_000n);
  if (withPublication) {
    writeAnchor(o.pendingAnchorOffset, 50n, 1_050n);
    setTestU128(data, o.lowerX64Offset, 1n);
    setTestU128(data, o.upperX64Offset, 2n);
    data.writeBigUInt64LE(100n, o.endSlotOffset);
    data.writeBigInt64LE(1_120n, o.endUnixTsOffset);
  }
  return data;
};
const legacy544 = makeDammOnlyBRing();
const ringHeader = decodeSourceObservationRingV1Header(legacy544);
const validABQ = makeDammOnlyBModule(legacy544, true);
const validBefore = Buffer.from(validABQ);
const legacyScalar = decodeSourceObservationRingV1Header(legacy544);
assert.deepEqual(decodeMimirBetaLiveRing(legacy544), legacyScalar);
const rawABQ = decodeSourceTemporalModuleV1(validABQ, ringHeader).dammOnlyBTail;
assert.deepEqual(decodeMimirBetaLiveSourceTemporalModuleV1(validABQ, ringHeader).dammOnlyBTail, rawABQ);
assert.equal(rawABQ?.kind, "damm-onlyb-interval-v1");
assert.equal(rawABQ?.publication?.revision, rawABQ?.publication?.endSlot);
assert.equal(rawABQ?.publication?.startSlot, rawABQ?.anchor.slot);
assert.deepEqual(validABQ, validBefore);
assert.equal(decodeSourceTemporalModuleV1(makeDammOnlyBModule(legacy544), ringHeader).dammOnlyBTail?.publication, null);
assert.equal(decodeSourceTemporalModuleV1(makeDammOnlyBModule(legacy544, true, true), ringHeader).dammOnlyBTail?.invalidated, true);

const maxRustDammSqrtPrice = 79226673521066979257578248091n;
for (const [offset, anchorName] of [[SOURCE_RING_DAMM_ONLYB_V1.anchorOffset, "A"], [SOURCE_RING_DAMM_ONLYB_V1.pendingAnchorOffset, "B"]] as const) {
  const atMax = Buffer.from(validABQ);
  setTestU128(atMax, offset + 16, maxRustDammSqrtPrice);
  const maxTail = decodeSourceTemporalModuleV1(atMax, ringHeader).dammOnlyBTail;
  assert.equal(anchorName === "A" ? maxTail?.anchor.sqrtPrice : maxTail?.pendingAnchor?.sqrtPrice, maxRustDammSqrtPrice);
  assert.deepEqual(decodeMimirBetaLiveSourceTemporalModuleV1(atMax, ringHeader).dammOnlyBTail, maxTail);
}

const malformedRings: Uint8Array[] = [
  legacy544.subarray(0, 543),
  (() => { const d = Buffer.alloc(545); legacy544.copy(d); return d; })(),
  (() => { const d = Buffer.alloc(784); legacy544.copy(d); d.writeUInt16LE(784, 10); return d; })(),
  (() => { const d = Buffer.from(legacy544); d[RING_OFFSETS.adapterType] = 0xff; return d; })(),
  (() => { const d = Buffer.from(legacy544); d[RING_OFFSETS.status] = SourceStatus.Paused; return d; })(),
];
for (const malformed of malformedRings) {
  for (const decode of [decodeSourceObservationRingV1Header, decodeMimirBetaLiveRing]) assert.throws(() => decode(malformed));
}

const malformedDammModules: Uint8Array[] = [
  validABQ.subarray(0, 255),
  (() => { const d = Buffer.alloc(257); validABQ.copy(d); return d; })(),
  (() => { const d = Buffer.from(validABQ); d[0] ^= 1; return d; })(),
  (() => { const d = Buffer.from(validABQ); d.writeUInt16LE(0, 4); return d; })(),
  (() => { const d = Buffer.from(validABQ); d.writeUInt16LE(255, 6); return d; })(),
  (() => { const d = Buffer.from(validABQ); d.writeBigUInt64LE(101n, 8); return d; })(),
  (() => { const d = Buffer.from(validABQ); d.writeUInt16LE(2, SOURCE_RING_DAMM_ONLYB_V1.proofKindOffset); return d; })(),
  (() => { const d = Buffer.from(validABQ); d.writeUInt16LE(17, SOURCE_RING_DAMM_ONLYB_V1.flagsOffset); return d; })(),
  (() => { const d = Buffer.from(validABQ); d[SOURCE_RING_DAMM_ONLYB_V1.reservedOffset] = 1; return d; })(),
  (() => { const d = Buffer.from(validABQ); d.fill(0, SOURCE_RING_DAMM_ONLYB_V1.contextHashOffset, SOURCE_RING_DAMM_ONLYB_V1.lastObservationUnixTsOffset); return d; })(),
  (() => { const d = makeDammOnlyBModule(legacy544, true); d.writeUInt16LE(5, SOURCE_RING_DAMM_ONLYB_V1.flagsOffset); return d; })(),
  (() => { const d = makeDammOnlyBModule(legacy544, true); d.fill(0, SOURCE_RING_DAMM_ONLYB_V1.pendingAnchorOffset, SOURCE_RING_DAMM_ONLYB_V1.lowerX64Offset); return d; })(),
  (() => { const d = makeDammOnlyBModule(legacy544, true); d.writeUInt16LE(3, SOURCE_RING_DAMM_ONLYB_V1.flagsOffset); return d; })(),
  (() => { const d = makeDammOnlyBModule(legacy544, true); d.writeBigUInt64LE(101n, SOURCE_RING_DAMM_ONLYB_V1.endSlotOffset); return d; })(),
  (() => { const d = makeDammOnlyBModule(legacy544, true); d.writeBigInt64LE(-1n, SOURCE_RING_DAMM_ONLYB_V1.anchorOffset + 8); return d; })(),
  (() => { const d = Buffer.from(validABQ); setTestU128(d, SOURCE_RING_DAMM_ONLYB_V1.anchorOffset + 16, maxRustDammSqrtPrice + 1n); return d; })(),
  (() => { const d = Buffer.from(validABQ); setTestU128(d, SOURCE_RING_DAMM_ONLYB_V1.pendingAnchorOffset + 16, maxRustDammSqrtPrice + 1n); return d; })(),
  (() => { const d = makeDammOnlyBModule(legacy544); d.writeBigInt64LE(-1n, SOURCE_RING_DAMM_ONLYB_V1.lastObservationUnixTsOffset); return d; })(),
  (() => { const d = makeDammOnlyBModule(legacy544, true); d.writeBigUInt64LE(3n, SOURCE_RING_DAMM_ONLYB_V1.lowerX64Offset); d.writeBigUInt64LE(2n, SOURCE_RING_DAMM_ONLYB_V1.upperX64Offset); return d; })(),
  (() => { const d = makeDammOnlyBModule(legacy544, true); d.writeBigInt64LE(1_201n, SOURCE_RING_DAMM_ONLYB_V1.pendingAnchorOffset + 8); return d; })(),
  (() => { const d = makeDammOnlyBModule(legacy544, true); d.writeBigInt64LE(1_119n, SOURCE_RING_DAMM_ONLYB_V1.endUnixTsOffset); return d; })(),
  (() => { const d = makeDammOnlyBModule(legacy544); d.writeBigUInt64LE(0n, SOURCE_RING_DAMM_ONLYB_V1.anchorOffset + 56); return d; })(),
  (() => { const d = makeDammOnlyBModule(legacy544); d.writeUInt16LE(0, SOURCE_RING_DAMM_ONLYB_V1.flagsOffset); return d; })(),
];
for (const [fixtureIndex, malformed] of malformedDammModules.entries()) {
  for (const [decoderIndex, decode] of [
    (data: Uint8Array) => decodeSourceTemporalModuleV1(data, ringHeader),
    (data: Uint8Array) => decodeMimirBetaLiveSourceTemporalModuleV1(data, ringHeader),
  ].entries()) assert.throws(() => decode(malformed));
}

const makeCpmmQuietModule = (qualified = false) => {
  const data = Buffer.alloc(192);
  data.set(Buffer.from("MTP2"));
  data.writeUInt16LE(2, 4); data.writeUInt16LE(192, 6);
  data.writeBigUInt64LE(ringHeader.newestSlot, 8);
  data.writeUInt16LE(2, 16);
  data.writeUInt16LE(1 | 2 | (qualified ? 4 : 0), 18);
  data.fill(1, 24, 56);
  data.writeBigInt64LE(1_200n, 56);
  const writeAnchor = (offset: number, slot: bigint, unixTs: bigint, netX: bigint, netY: bigint) => {
    data.writeBigUInt64LE(slot, offset);
    data.writeBigInt64LE(unixTs, offset + 8);
    data.writeBigUInt64LE(900n, offset + 16);
    data.writeBigUInt64LE(netX, offset + 24);
    data.writeBigUInt64LE(netY, offset + 32);
    data.writeBigUInt64LE(1_000n, offset + 40);
  };
  writeAnchor(64, 10n, 1_000n, 100n, 200n);
  writeAnchor(112, qualified ? 50n : 20n, qualified ? 1_120n : 1_050n, 110n, 220n);
  if (qualified) {
    setTestU128(data, 160, 1n);
    setTestU128(data, 176, 2n);
  }
  return data;
};
const pendingCpmm = makeCpmmQuietModule();
const qualifiedCpmm = makeCpmmQuietModule(true);
assert.equal(decodeCpmmQuietTemporalModuleV2(pendingCpmm, ringHeader).kind, "cpmm-quiet-interval-v2");
const decodedCpmm = decodeCpmmQuietTemporalModuleV2(qualifiedCpmm, ringHeader);
assert.equal(decodedCpmm.abiVersion, 2);
assert.equal(decodedCpmm.anchorB?.nativeLastUpdate, 900n);
assert.equal(decodedCpmm.anchorB?.unixTs - decodedCpmm.anchorA.unixTs, 120n);
assert.equal(decodedCpmm.qLowerX64, 1n);
assert.equal(decodedCpmm.qUpperX64, 2n);
const behindRingCpmm = Buffer.from(pendingCpmm);
behindRingCpmm.writeBigUInt64LE(ringHeader.newestSlot - 1n, 8);
assert.equal(decodeCpmmQuietTemporalModuleV2(behindRingCpmm, ringHeader).ringNewestSlot, ringHeader.newestSlot - 1n);
const malformedCpmmModules = [
  (() => { const d = Buffer.from(qualifiedCpmm); d.set(Buffer.from("MTP1"), 0); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeUInt16LE(1, 4); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeUInt16LE(1, 16); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeUInt16LE(17, 18); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeUInt16LE(0, 18); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d[20] = 1; return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.fill(0, 24, 56); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeBigUInt64LE(ringHeader.newestSlot + 1n, 8); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeUInt16LE(15, 18); return d; })(),
  (() => { const d = Buffer.from(pendingCpmm); d.writeUInt16LE(1, 18); return d; })(),
  (() => { const d = Buffer.from(pendingCpmm); d.writeBigUInt64LE(1n, 160); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeBigUInt64LE(0n, 112 + 24); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeBigUInt64LE(99n, 112 + 24); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeBigUInt64LE(901n, 112 + 16); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeBigUInt64LE(1_120n, 112 + 16); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeUInt16LE(3, 18); return d; })(),
  (() => { const d = Buffer.from(qualifiedCpmm); d.writeBigUInt64LE(ringHeader.newestSlot + 1n, 112); return d; })(),
];
for (const malformed of malformedCpmmModules) assert.throws(() => decodeCpmmQuietTemporalModuleV2(malformed, ringHeader));
const temporalFeedId = Buffer.alloc(32, 73);
const [v1Default] = findSourceTemporalPda(temporalFeedId, 2);
const [v1Explicit] = findSourceTemporalPda(temporalFeedId, 2, 1);
const [v2Pda, v2Bump] = findSourceTemporalPda(temporalFeedId, 2, 2);
const [v2Direct, v2DirectBump] = PublicKey.findProgramAddressSync(
  [Buffer.from("source_temporal"), temporalFeedId, Buffer.from([2]), Buffer.from([2, 0])],
  MIMIR_PROGRAM_ID,
);
assert.ok(v1Default.equals(v1Explicit));
assert.ok(v2Pda.equals(v2Direct));
assert.equal(v2Bump, v2DirectBump);
const [v3Pda] = findSourceTemporalPda(temporalFeedId, 2, 3);
assert.ok(v3Pda.equals(PublicKey.findProgramAddressSync(
  [Buffer.from("source_temporal"), temporalFeedId, Buffer.from([2]), Buffer.from([3, 0])],
  MIMIR_PROGRAM_ID,
)[0]));
assert.ok(findSourceTemporalPda(temporalFeedId, 2, 4)[0].equals(PublicKey.findProgramAddressSync(
  [Buffer.from("source_temporal"), temporalFeedId, Buffer.from([2]), Buffer.from([4, 0])],
  MIMIR_PROGRAM_ID,
)[0]));
assert.throws(() => findSourceTemporalPda(temporalFeedId, 2, 5), /UnsupportedSourceTemporalModuleVersion/);
const twapHeader = decodeFeedTwapStateHeader(buildTestFeedTwapStateHeader());
assert.equal(twapHeader.maxConfidenceBps, 15);
assert.equal(twapHeader.maxDispersionBps, 8);
assert.deepEqual(
  twapHeader.sourceCapEntries.map((entry) => entry.flags & 1),
  [1, 1],
);
assert.throws(
  () => decodeFeedTwapStateHeader(buildTestFeedTwapStateHeader().subarray(0, 320)),
  /InvalidAccountData/,
);
assert.throws(
  () =>
    decodeFeedTwapStateHeader(
      buildTestFeedTwapStateHeader((data) => {
        data[TWAP_OFFSETS.sourceTableCount] = 255;
      }),
    ),
  /InvalidAccountData/,
);

verifyFeedTwapStateHeader(
  twapHeader,
  TEST_FEED_ID,
  TEST_TWAP_VERSION,
  TEST_PLAN_HASH,
  TEST_CLOCK_SLOT,
  5,
);
assert.throws(
  () =>
    verifyFeedTwapStateHeader(
      decodeFeedTwapStateHeader(
        buildTestFeedTwapStateHeader((data) => {
          data.writeBigUInt64LE(TEST_CLOCK_SLOT - 6n, TWAP_OFFSETS.shortEndSlot);
        }),
      ),
      TEST_FEED_ID,
      TEST_TWAP_VERSION,
      TEST_PLAN_HASH,
      TEST_CLOCK_SLOT,
      5,
    ),
  /StaleSnapshot/,
);
verifyFeedTwapStateHeader(
  decodeFeedTwapStateHeader(
    buildTestFeedTwapStateHeader((data) => {
      data.writeBigUInt64LE(TEST_CLOCK_SLOT - 7n, TWAP_OFFSETS.mediumEndSlot);
      data.writeBigUInt64LE(TEST_CLOCK_SLOT - 8n, TWAP_OFFSETS.longEndSlot);
    }),
  ),
  TEST_FEED_ID,
  TEST_TWAP_VERSION,
  TEST_PLAN_HASH,
  TEST_CLOCK_SLOT,
  5,
);
for (const horizonOffset of [
  TWAP_OFFSETS.shortEndSlot,
  TWAP_OFFSETS.mediumEndSlot,
  TWAP_OFFSETS.longEndSlot,
]) {
  assert.throws(
    () =>
      verifyFeedTwapStateHeader(
        decodeFeedTwapStateHeader(
          buildTestFeedTwapStateHeader((data) => {
            data.writeBigUInt64LE(TEST_CLOCK_SLOT + 1n, horizonOffset);
          }),
        ),
        TEST_FEED_ID,
        TEST_TWAP_VERSION,
        TEST_PLAN_HASH,
        TEST_CLOCK_SLOT,
        5,
      ),
    /StaleSnapshot/,
  );
}
assert.throws(
  () =>
    verifyFeedTwapStateHeader(
      decodeFeedTwapStateHeader(
        buildTestFeedTwapStateHeader((data) => {
          data.writeBigUInt64LE(
            TEST_CLOCK_SLOT - 6n,
            TWAP_OFFSETS.sourceActivitySlotMin,
          );
        }),
      ),
      TEST_FEED_ID,
      TEST_TWAP_VERSION,
      TEST_PLAN_HASH,
      TEST_CLOCK_SLOT,
      5,
    ),
  /StaleSourceActivity/,
);

const depeg = buildTestSnapshotHeader();
depeg[OFFSETS.quoteStatus] = QuoteStatus.Depeg;
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(depeg),
      defaultTestSnapshotPolicy(),
    ),
  /QuoteNotOk/,
);

const safetyOnlyRouteability = buildTestSnapshotHeader((data) => {
  data[OFFSETS.routeabilityStatus] = RouteabilityStatus.SafetyOnly;
});
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(safetyOnlyRouteability),
      defaultTestSnapshotPolicy(),
    ),
  /InvalidRouteability/,
);

const truncated = buildTestSnapshotHeader().subarray(0, FEED_SNAPSHOT_MIN_HEADER_LEN - 1);
assert.throws(() => decodeFeedSnapshotHeader(truncated), /InvalidAccountData/);
assert.throws(
  () => decodeFeedSnapshotHeader(buildTestSnapshotHeader().subarray(0, 420)),
  /InvalidAccountData/,
);

const wrongMagic = buildTestSnapshotHeader();
wrongMagic[OFFSETS.magic] = "X".charCodeAt(0);
assert.throws(() => decodeFeedSnapshotHeader(wrongMagic), /InvalidMagic/);

const wrongVersion = buildTestSnapshotHeader();
wrongVersion.writeUInt16LE(1, OFFSETS.version);
assert.throws(
  () => decodeFeedSnapshotHeader(wrongVersion),
  /UnsupportedVersion/,
);

const wrongHeaderLen = buildTestSnapshotHeader();
wrongHeaderLen.writeUInt16LE(419, OFFSETS.headerLen);
assert.throws(
  () => decodeFeedSnapshotHeader(wrongHeaderLen),
  /InvalidHeaderLength/,
);

const invalidCapTierSafetyFactor = buildTestSnapshotHeader();
invalidCapTierSafetyFactor.writeUInt16LE(7, OFFSETS.capTierSafetyFactor);
assert.throws(
  () => decodeFeedSnapshotHeader(invalidCapTierSafetyFactor),
  /InvalidSnapshot/,
);

const invalidCapModelHash = buildTestSnapshotHeader();
invalidCapModelHash[OFFSETS.capModelHash] ^= 0xff;
assert.throws(
  () => decodeFeedSnapshotHeader(invalidCapModelHash),
  /InvalidSnapshot/,
);

const reservedEnum = buildTestSnapshotHeader();
reservedEnum[OFFSETS.riskTier] = 99;
assert.throws(() => decodeFeedSnapshotHeader(reservedEnum), /InvalidEnum/);

const futureSnapshot = buildTestSnapshotHeader((data) => {
  data.writeBigUInt64LE(200n, OFFSETS.snapshotSlot);
});
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(futureSnapshot),
      defaultTestSnapshotPolicy(),
    ),
  /StaleSnapshot/,
);

const nativeException = buildTestSnapshotHeader((data) => {
  data[OFFSETS.anchorProvider] = AnchorProvider.NativeOnlyException;
  Buffer.from(TEST_NATIVE_EXCEPTION_HASH).copy(
    data,
    OFFSETS.nativeExceptionHash,
  );
});
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(nativeException),
      { ...defaultTestSnapshotPolicy(), flags: VerifyFlags.RequireTierA },
    ),
  /AnchorNotOk/,
);
verifySnapshotHeader(decodeFeedSnapshotHeader(nativeException), {
  ...defaultTestSnapshotPolicy(),
  expectedNativeExceptionHash: TEST_NATIVE_EXCEPTION_HASH,
  flags: defaultTestSnapshotPolicy().flags | VerifyFlags.AllowNativeException,
});

for (const anchorProvider of [1, 2, 3]) {
  assert.throws(
    () =>
      verifySnapshotHeader(
        decodeFeedSnapshotHeader(
          buildTestSnapshotHeader((data) => {
            data[OFFSETS.anchorProvider] = anchorProvider;
          }),
        ),
        defaultTestSnapshotPolicy(),
      ),
    /AnchorNotOk/,
  );
}

const noAnchor = buildTestSnapshotHeader((data) => {
  data[OFFSETS.anchorProvider] = AnchorProvider.None;
});
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(noAnchor),
      defaultTestSnapshotPolicy(),
    ),
  /AnchorNotOk/,
);

const lowSources = buildTestSnapshotHeader((data) => {
  data[OFFSETS.sourceCount] = 3;
});
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(lowSources),
      defaultTestSnapshotPolicy(),
    ),
  /InsufficientSourceCount/,
);

const lowVenues = buildTestSnapshotHeader((data) => {
  data[OFFSETS.venueCount] = 3;
});
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(lowVenues),
      defaultTestSnapshotPolicy(),
    ),
  /InsufficientVenueCount/,
);

const lowCorrelation = buildTestSnapshotHeader((data) => {
  data[OFFSETS.correlationGroupCount] = 2;
});
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(lowCorrelation),
      defaultTestSnapshotPolicy(),
    ),
  /InsufficientCorrelationGroupCount/,
);

const lowCoverage = buildTestSnapshotHeader((data) => {
  data.writeUInt16LE(8_999, OFFSETS.coverageRatioBps);
});
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(lowCoverage),
      defaultTestSnapshotPolicy(),
    ),
  /InsufficientCoverage/,
);

const wideConfidence = buildTestSnapshotHeader((data) => {
  data.writeUInt16LE(51, OFFSETS.confidenceBps);
  const delta = (TEST_TWAP_PRICE_X64 * 51n + 9_999n) / 10_000n;
  writeTestU128(data, OFFSETS.priceLowerX64, TEST_TWAP_PRICE_X64 - delta);
  writeTestU128(data, OFFSETS.priceUpperX64, TEST_TWAP_PRICE_X64 + delta);
});
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(wideConfidence),
      defaultTestSnapshotPolicy(),
    ),
  /ConfidenceTooWide/,
);

const wideDispersion = buildTestSnapshotHeader((data) => {
  data.writeUInt16LE(101, OFFSETS.dispersionBps);
});
assert.throws(
  () =>
    verifySnapshotHeader(
      decodeFeedSnapshotHeader(wideDispersion),
      defaultTestSnapshotPolicy(),
    ),
  /DispersionTooWide/,
);

const pausedFeedConfig = buildTestFeedConfigHeader((data) => {
  data[CONFIG_OFFSETS.lifecycleState] = FeedLifecycleState.Paused;
});
assert.throws(
  () =>
    verifyFeedConfigForSnapshot(
      decodeFeedConfigHeader(toTestFeedConfigV1(pausedFeedConfig)),
      header,
      defaultTestSnapshotPolicy(),
    ),
  /FeedConfigNotActive/,
);

const pausedRegistry = buildTestOracleRegistryHeader((data) => {
  data[REGISTRY_OFFSETS.status] = RegistryStatus.Paused;
});
assert.throws(
  () =>
    verifyRegistryForSnapshot(
      decodeOracleRegistryHeader(pausedRegistry),
      header,
      feedConfigHeader,
    ),
  /RegistryNotActive/,
);

const pausedPlan = buildTestSourcingPlanHeader((data) => {
  data[PLAN_OFFSETS.status] = PlanStatus.Paused;
});
assert.throws(
  () =>
    verifySourcingPlanForSnapshot(
      decodeSourcingPlanHeader(pausedPlan),
      header,
      defaultTestSnapshotPolicy(),
      feedConfigHeader,
      registryHeader,
  ),
  /SourcingPlanNotActive/,
);
verifySourcingPlanForSnapshot(
  sourcingPlanHeader,
  decodeFeedSnapshotHeader(
    buildTestSnapshotHeader((data) => {
      data[OFFSETS.riskTier] = RiskTier.TierB;
    }),
  ),
  defaultTestSnapshotPolicy(),
  feedConfigHeader,
  registryHeader,
);
assert.throws(
  () =>
    verifySourcingPlanForSnapshot(
      { ...sourcingPlanHeader, riskTier: RiskTier.TierB },
      header,
      defaultTestSnapshotPolicy(),
      feedConfigHeader,
      registryHeader,
    ),
  /InvalidRouteability/,
);

const unsupportedRegistry = buildTestOracleRegistryHeader((data) => {
  data.writeBigUInt64LE(0n, REGISTRY_OFFSETS.supportedAdapterMask);
});
assert.throws(
  () =>
    verifySourcingPlanForSnapshot(
      sourcingPlanHeader,
      header,
      defaultTestSnapshotPolicy(),
      feedConfigHeader,
      decodeOracleRegistryHeader(unsupportedRegistry),
    ),
  /InvalidPlan/,
);

const unsupportedAdapterPlan = buildTestSourcingPlanHeader((data) => {
  data.writeBigUInt64LE(2n, PLAN_OFFSETS.adapterMask);
});
assert.throws(
  () =>
    verifySourcingPlanForSnapshot(
      decodeSourcingPlanHeader(unsupportedAdapterPlan),
      header,
      defaultTestSnapshotPolicy(),
      feedConfigHeader,
      registryHeader,
    ),
  /InvalidPlan/,
);

const pausedSourceConfig = buildTestSourceConfigHeader(0, (data) => {
  data[SOURCE_OFFSETS.status] = SourceStatus.Paused;
});
assert.throws(
  () =>
    verifySourceConfigHeader(
      decodeSourceConfigHeader(pausedSourceConfig),
      TEST_FEED_ID,
      0,
    ),
  /SourceConfigNotActive/,
);

const zeroSourceProgram = buildTestSourceConfigHeader(0, (data) => {
  Buffer.alloc(32).copy(data, SOURCE_OFFSETS.programId);
});
assert.throws(
  () => decodeSourceConfigHeader(zeroSourceProgram),
  /InvalidSourceConfig/,
);

const pausedTwap = buildTestFeedTwapStateHeader((data) => {
  data[TWAP_OFFSETS.status] = TwapStatus.Paused;
});
assert.throws(
  () =>
    verifyFeedTwapStateHeader(
      decodeFeedTwapStateHeader(pausedTwap),
      TEST_FEED_ID,
      TEST_TWAP_VERSION,
      TEST_PLAN_HASH,
      TEST_CLOCK_SLOT,
      5,
    ),
  /TwapStateNotActive/,
);

const zeroTwapSourceMask = buildTestFeedTwapStateHeader((data) => {
  data.writeBigUInt64LE(0n, TWAP_OFFSETS.sourceMask);
});
assert.throws(
  () => decodeFeedTwapStateHeader(zeroTwapSourceMask),
  /InvalidTwapState/,
);

const zeroTwapShort = buildTestFeedTwapStateHeader((data) => {
  data.writeBigUInt64LE(0n, TWAP_OFFSETS.twapShortX64);
  data.writeBigUInt64LE(0n, TWAP_OFFSETS.twapShortX64 + 8);
});
assert.throws(
  () => decodeFeedTwapStateHeader(zeroTwapShort),
  /InvalidTwapState/,
);

const zeroTwapActivity = buildTestFeedTwapStateHeader((data) => {
  data.writeBigUInt64LE(0n, TWAP_OFFSETS.sourceActivitySlotMin);
});
assert.throws(
  () => decodeFeedTwapStateHeader(zeroTwapActivity),
  /InvalidTwapState/,
);

const invalidTwapConfidence = buildTestFeedTwapStateHeader((data) => {
  data.writeUInt16LE(10_001, TWAP_OFFSETS.maxConfidenceBps);
});
assert.throws(
  () => decodeFeedTwapStateHeader(invalidTwapConfidence),
  /InvalidTwapState/,
);

const invalidTwapDispersion = buildTestFeedTwapStateHeader((data) => {
  data.writeUInt16LE(10_001, TWAP_OFFSETS.maxDispersionBps);
});
assert.throws(
  () => decodeFeedTwapStateHeader(invalidTwapDispersion),
  /InvalidTwapState/,
);

assert.throws(() => decodeSourceObservationRingHeader(buildTestSourceObservationRingHeader()), /InvalidAccountData/);
{
  const bucket = currentRing(); bucket[RING_OFFSETS.observationKind] = ObservationKind.Bucket;
  assert.throws(() => decodeSourceObservationRingHeader(bucket), /InvalidSourceRing/);
}
assert.throws(() => decodeLifecycleFeedConfigHeader(buildTestFeedConfigHeader()), /InvalidLifecycleFeedConfig/);
assert.deepEqual(decodeLifecycleFeedConfigHeader(toTestFeedConfigV1(buildTestFeedConfigHeader())).identityAsset, new Uint8Array(32).fill(44));
const currentSpotRing = decodeSourceObservationRingHeader(currentRing());
verifySourceObservationRingHeader(currentSpotRing, TEST_FEED_ID, 0, CURRENT_RING_VERSION, TEST_PLAN_HASH, TEST_CLOCK_SLOT, 5);
const retiredRing0 = decodeMimirBrowserSourceRingFields(buildTestSourceObservationRingHeader());
assert.throws(
  () => verifySourceObservationRingHeader(retiredRing0, retiredRing0.feedId, retiredRing0.sourceIndex, retiredRing0.ringVersion, retiredRing0.selectedPlanHash, retiredRing0.newestSlot + 1n, 100),
  /InvalidSourceRing/,
);
assert.throws(
  () => verifySourceObservationRingHeader({ ...currentSpotRing, observationKind: ObservationKind.Bucket }, TEST_FEED_ID, 0, CURRENT_RING_VERSION, TEST_PLAN_HASH, TEST_CLOCK_SLOT, 5),
  /InvalidSourceRing/,
);
assert.throws(
  () => verifySourceObservationRingHeader(currentSpotRing, TEST_FEED_ID, 0, 0, TEST_PLAN_HASH, TEST_CLOCK_SLOT, 5),
  /InvalidSourceRing/,
);
assert.throws(() => decodeFeedConfigHeader(buildTestFeedConfigHeader()), /InvalidLifecycleFeedConfig/);
const pausedSourceRing = { ...decodeSourceObservationRingHeader(currentRing()), status: SourceStatus.Paused };
assert.throws(
  () =>
    verifySourceObservationRingHeader(
      pausedSourceRing,
      TEST_FEED_ID,
      0,
      CURRENT_RING_VERSION,
      TEST_PLAN_HASH,
      TEST_CLOCK_SLOT,
      5,
    ),
  /SourceRingNotActive/,
);

const zeroSourceRingSamples = currentRing(
  0,
  (data) => {
    data.writeUInt16LE(0, RING_OFFSETS.sampleCount);
  },
);
assert.throws(
  () => decodeSourceObservationRingHeader(zeroSourceRingSamples),
  /InvalidSourceRing/,
);

const zeroSourceRingPrice = currentRing(0, (data) => {
  data.writeBigUInt64LE(0n, RING_OFFSETS.lastPriceX64);
  data.writeBigUInt64LE(0n, RING_OFFSETS.lastPriceX64 + 8);
});
assert.throws(
  () => decodeSourceObservationRingHeader(zeroSourceRingPrice),
  /InvalidSourceRing/,
);

const futureSourceRing = currentRing(0, (data) => {
  data.writeBigUInt64LE(TEST_CLOCK_SLOT - 3n, RING_OFFSETS.oldestSlot);
  data.writeBigUInt64LE(TEST_CLOCK_SLOT + 1n, RING_OFFSETS.newestSlot);
  data.writeBigUInt64LE(TEST_CLOCK_SLOT + 1n, RING_OFFSETS.lastActivitySlot);
});
assert.throws(
  () =>
    verifySourceObservationRingHeader(
      decodeSourceObservationRingHeader(futureSourceRing),
      TEST_FEED_ID,
      0,
      CURRENT_RING_VERSION,
      TEST_PLAN_HASH,
      TEST_CLOCK_SLOT,
      5,
    ),
  /StaleSourceActivity/,
);

const zeroPlanHash = buildTestSourcingPlanHeader((data) => {
  Buffer.alloc(32).copy(data, PLAN_OFFSETS.planHash);
});
assert.throws(
  () =>
    verifySourcingPlanForSnapshot(
      decodeSourcingPlanHeader(zeroPlanHash),
      header,
      defaultTestSnapshotPolicy(),
      feedConfigHeader,
      registryHeader,
    ),
  /InvalidPlan/,
);

const zeroSourceSetHash = buildTestSourcingPlanHeader((data) => {
  Buffer.alloc(32).copy(data, PLAN_OFFSETS.sourceSetHash);
});
assert.throws(
  () =>
    verifySourcingPlanForSnapshot(
      decodeSourcingPlanHeader(zeroSourceSetHash),
      header,
      defaultTestSnapshotPolicy(),
      feedConfigHeader,
      registryHeader,
    ),
  /InvalidSourcingPlanAccountHash/,
);

const payer = Keypair.generate();
const snapshot = findFeedSnapshotPda(TEST_FEED_ID)[0];
const feedConfig = findFeedConfigPda(TEST_FEED_ID)[0];
const feedReservation = findFeedReservationPda(TEST_FEED_ID)[0];
const feedTwap = findFeedTwapPda(TEST_FEED_ID, TEST_TWAP_VERSION)[0];
const registry = findOracleRegistryPda()[0];
const sourceConfig = findSourceConfigPda(TEST_FEED_ID, 0)[0];
const sourceRing = findSourceRingPda(TEST_FEED_ID, 0, TEST_RING_VERSION)[0];
const sourceConfig1 = findSourceConfigPda(TEST_FEED_ID, 1)[0];
const sourceRing1 = findSourceRingPda(TEST_FEED_ID, 1, TEST_RING_VERSION)[0];
const sourceConfig2 = findSourceConfigPda(TEST_FEED_ID, 2)[0];
const sourceRing2 = findSourceRingPda(TEST_FEED_ID, 2, TEST_RING_VERSION)[0];
const sourceConfig3 = findSourceConfigPda(TEST_FEED_ID, 3)[0];
const sourceRing3 = findSourceRingPda(TEST_FEED_ID, 3, TEST_RING_VERSION)[0];
const sourceConfig4 = findSourceConfigPda(TEST_FEED_ID, 4)[0];
const sourceRing4 = findSourceRingPda(TEST_FEED_ID, 4, TEST_RING_VERSION)[0];
const sourcingPlan = findSourcingPlanPda(
  TEST_FEED_ID,
  header.sourcingPlanId,
  header.sourcingPlanVersion,
)[0];
function cpmmRefreshArgs(sourceIndex: number, expectedPrevNewestSlot: bigint) {
  return {
    feedId: TEST_FEED_ID,
    sourceIndex,
    ringVersion: TEST_RING_VERSION,
    minSlotGap: 0,
    expectedSourceConfigRevision: 1n,
    expectedSourceSetRevision: 1n,
    expectedPrevNewestSlot,
    expectedPlanHash: TEST_PLAN_HASH,
  };
}
const accountHeader = verifyFeedSnapshotAccount({
  snapshot,
  owner: MIMIR_PROGRAM_ID,
  data: buildTestSnapshotHeader(),
  policy: canonicalSnapshotPolicy,
});
assert.equal(Buffer.from(accountHeader.feedId).equals(TEST_FEED_ID), true);
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot: Keypair.generate().publicKey,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestSnapshotHeader(),
      policy: canonicalSnapshotPolicy,
    }),
  /InvalidSnapshotAddress/,
);
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot,
      owner: PublicKey.default,
      data: buildTestSnapshotHeader(),
      policy: defaultTestSnapshotPolicy(),
    }),
  /InvalidAccountOwner/,
);
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestSnapshotHeader((data) =>
        Buffer.alloc(32, 9).copy(data, OFFSETS.feedConfig),
      ),
      policy: defaultTestSnapshotPolicy(),
    }),
  /InvalidFeedConfigAddress/,
);
const reservationAccountHeader = verifyFeedReservationAccount({
  feedReservation,
  owner: MIMIR_PROGRAM_ID,
  data: buildTestFeedReservationHeader(),
  expectedFeedId: TEST_FEED_ID,
  expectedAuthority: TEST_GOVERNANCE_AUTHORITY,
});
assert.equal(reservationAccountHeader.maxRiskTier, RiskTier.TierA);
assert.throws(
  () =>
    verifyFeedReservationAccount({
      feedReservation: Keypair.generate().publicKey,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestFeedReservationHeader(),
      expectedFeedId: TEST_FEED_ID,
    }),
  /InvalidFeedReservationAddress/,
);
assert.throws(
  () =>
    decodeFeedReservationHeader(
      buildTestFeedReservationHeader(TEST_GOVERNANCE_AUTHORITY, (data) => {
        data.writeUInt32LE(1, RESERVATION_OFFSETS.flags);
      }),
    ),
  /InvalidFeedReservation/,
);
assert.throws(
  () =>
    decodeFeedReservationHeader(
      buildTestFeedReservationHeader(TEST_GOVERNANCE_AUTHORITY, (data) => {
        data[RESERVATION_OFFSETS.maxRiskTier] = RiskTier.Unrated;
      }),
    ),
  /InvalidFeedReservation/,
);

const livePolicy = {
  ...defaultTestSnapshotPolicy(),
  flags: defaultTestSnapshotPolicy().flags | VerifyFlags.RequireLiveFeedConfig,
};
verifyFeedSnapshotAccount({
  snapshot,
  owner: MIMIR_PROGRAM_ID,
  data: buildTestSnapshotHeader(),
  policy: livePolicy,
  feedConfig: {
    pubkey: feedConfig,
    owner: MIMIR_PROGRAM_ID,
    data: toTestFeedConfigV1(buildTestFeedConfigHeader()),
  },
});
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestSnapshotHeader(),
      policy: livePolicy,
      feedConfig: { pubkey: feedConfig, owner: MIMIR_PROGRAM_ID, data: buildTestFeedConfigHeader() },
    }),
  /InvalidLifecycleFeedConfig/,
);
const registryPolicy = {
  ...livePolicy,
  flags: livePolicy.flags | VerifyFlags.RequireLiveRegistry,
};
verifyFeedSnapshotAccount({
  snapshot,
  owner: MIMIR_PROGRAM_ID,
  data: buildTestSnapshotHeader(),
  policy: registryPolicy,
  feedConfig: {
    pubkey: feedConfig,
    owner: MIMIR_PROGRAM_ID,
    data: toTestFeedConfigV1(buildTestFeedConfigHeader()),
  },
  registry: {
    pubkey: registry,
    owner: MIMIR_PROGRAM_ID,
    data: buildTestOracleRegistryHeader(),
  },
});
const planPolicy = {
  ...registryPolicy,
  flags: registryPolicy.flags | VerifyFlags.RequireLiveSourcingPlan,
};
verifyFeedSnapshotAccount({
  snapshot,
  owner: MIMIR_PROGRAM_ID,
  data: buildTestSnapshotHeader(),
  policy: planPolicy,
  feedConfig: {
    pubkey: feedConfig,
    owner: MIMIR_PROGRAM_ID,
    data: toTestFeedConfigV1(buildTestFeedConfigHeader()),
  },
  registry: {
    pubkey: registry,
    owner: MIMIR_PROGRAM_ID,
    data: buildTestOracleRegistryHeader(),
  },
  sourcingPlan: {
    pubkey: sourcingPlan,
    owner: MIMIR_PROGRAM_ID,
    data: buildTestSourcingPlanHeader(),
  },
});
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestSnapshotHeader(),
      policy: planPolicy,
      feedConfig: {
        pubkey: feedConfig,
        owner: MIMIR_PROGRAM_ID,
        data: toTestFeedConfigV1(buildTestFeedConfigHeader()),
      },
      registry: {
        pubkey: registry,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestOracleRegistryHeader((data) => {
          data.writeBigUInt64LE(0n, REGISTRY_OFFSETS.supportedAdapterMask);
        }),
      },
      sourcingPlan: {
        pubkey: sourcingPlan,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestSourcingPlanHeader(),
      },
    }),
  /InvalidRegistry/,
);
const twapPolicy = {
  ...planPolicy,
  expectedTwapRevision: 1n,
  flags: planPolicy.flags | VerifyFlags.RequireLiveTwapState,
};
const buildTestProducerBoundSnapshotHeader = (overrides?: (data: Buffer) => void) => {
  const data = buildTestSnapshotHeader();
  const delta = (TEST_TWAP_PRICE_X64 * 15n + 9_999n) / 10_000n;
  writeTestU128(data, OFFSETS.priceLowerX64, TEST_TWAP_PRICE_X64 - delta);
  writeTestU128(data, OFFSETS.priceUpperX64, TEST_TWAP_PRICE_X64 + delta);
  overrides?.(data);
  return data;
};
verifyFeedSnapshotAccount({
  snapshot,
  owner: MIMIR_PROGRAM_ID,
  data: buildTestProducerBoundSnapshotHeader(),
  policy: twapPolicy,
  feedConfig: {
    pubkey: feedConfig,
    owner: MIMIR_PROGRAM_ID,
    data: toTestFeedConfigV1(buildTestFeedConfigHeader()),
  },
  registry: {
    pubkey: registry,
    owner: MIMIR_PROGRAM_ID,
    data: buildTestOracleRegistryHeader(),
  },
  sourcingPlan: {
    pubkey: sourcingPlan,
    owner: MIMIR_PROGRAM_ID,
    data: buildTestSourcingPlanHeader(),
  },
  feedTwap: {
    pubkey: feedTwap,
    owner: MIMIR_PROGRAM_ID,
    data: buildTestFeedTwapStateHeader(),
  },
});
const verifyTestConfidenceBounds = (
  priceX64: bigint,
  confidenceBps: number,
  priceLowerX64: bigint,
  priceUpperX64: bigint,
) => verifyFeedSnapshotAccount({
  snapshot,
  owner: MIMIR_PROGRAM_ID,
  data: buildTestProducerBoundSnapshotHeader((data) => {
    writeTestU128(data, OFFSETS.priceX64, priceX64);
    writeTestU128(data, OFFSETS.priceLowerX64, priceLowerX64);
    writeTestU128(data, OFFSETS.priceUpperX64, priceUpperX64);
    data.writeUInt16LE(confidenceBps, OFFSETS.confidenceBps);
  }),
  policy: twapPolicy,
  feedConfig: { pubkey: feedConfig, owner: MIMIR_PROGRAM_ID, data: toTestFeedConfigV1(buildTestFeedConfigHeader()) },
  registry: { pubkey: registry, owner: MIMIR_PROGRAM_ID, data: buildTestOracleRegistryHeader() },
  sourcingPlan: { pubkey: sourcingPlan, owner: MIMIR_PROGRAM_ID, data: buildTestSourcingPlanHeader() },
  feedTwap: { pubkey: feedTwap, owner: MIMIR_PROGRAM_ID, data: buildTestFeedTwapStateHeader((data) => {
    writeTestU128(data, TWAP_OFFSETS.twapShortX64, priceX64);
    data.writeUInt16LE(confidenceBps, TWAP_OFFSETS.maxConfidenceBps);
  }) },
});
verifyTestConfidenceBounds(10_001n, 0, 10_001n, 10_001n);
verifyTestConfidenceBounds(10_001n, 1, 9_999n, 10_003n);
assert.throws(() => verifyTestConfidenceBounds(1n, 1, 0n, 2n), /Invalid/);
const u128Max = (1n << 128n) - 1n;
assert.throws(() => verifyTestConfidenceBounds(u128Max, 1, u128Max - 1n, u128Max), /InvalidTwapState/);
assert.throws(() => verifyTestConfidenceBounds(10_001n, 1, 10_000n, 10_003n), /InvalidTwapState/);
assert.throws(() => verifyTestConfidenceBounds(10_001n, 1, 9_999n, 10_002n), /InvalidTwapState/);
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestProducerBoundSnapshotHeader((data) => {
        data.writeBigUInt64LE(0b0111n, OFFSETS.sourceMask);
      }),
      policy: twapPolicy,
      feedConfig: {
        pubkey: feedConfig,
        owner: MIMIR_PROGRAM_ID,
        data: toTestFeedConfigV1(buildTestFeedConfigHeader()),
      },
      registry: {
        pubkey: registry,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestOracleRegistryHeader(),
      },
      sourcingPlan: {
        pubkey: sourcingPlan,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestSourcingPlanHeader(),
      },
      feedTwap: {
        pubkey: feedTwap,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestFeedTwapStateHeader(),
      },
    }),
  /InvalidSnapshot/,
);
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestProducerBoundSnapshotHeader((data) => {
        data[OFFSETS.sourceCount] = 5;
      }),
      policy: twapPolicy,
      feedConfig: {
        pubkey: feedConfig,
        owner: MIMIR_PROGRAM_ID,
        data: toTestFeedConfigV1(buildTestFeedConfigHeader()),
      },
      registry: {
        pubkey: registry,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestOracleRegistryHeader(),
      },
      sourcingPlan: {
        pubkey: sourcingPlan,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestSourcingPlanHeader(),
      },
      feedTwap: {
        pubkey: feedTwap,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestFeedTwapStateHeader(),
      },
    }),
  /InvalidSnapshot/,
);
const sourceAccountHeader = verifySourceConfigAccount({
  sourceConfig,
  owner: MIMIR_PROGRAM_ID,
  data: buildTestSourceConfigHeader(),
  expectedFeedId: TEST_FEED_ID,
  expectedSourceIndex: 0,
});
assert.equal(sourceAccountHeader.sourceIndex, 0);
const twapAccountHeader = verifyFeedTwapStateAccount({
  feedTwap,
  owner: MIMIR_PROGRAM_ID,
  data: buildTestFeedTwapStateHeader(),
  expectedFeedId: TEST_FEED_ID,
  expectedTwapVersion: TEST_TWAP_VERSION,
  expectedPlanHash: TEST_PLAN_HASH,
  clockSlot: TEST_CLOCK_SLOT,
  maxTwapAgeSlots: 5,
});
assert.equal(twapAccountHeader.twapVersion, TEST_TWAP_VERSION);
const sourceRingAccountHeader = verifySourceObservationRingAccount({
  sourceRing: findSourceRingPda(TEST_FEED_ID, 0, CURRENT_RING_VERSION)[0],
  owner: MIMIR_PROGRAM_ID,
  data: currentRing(),
  expectedFeedId: TEST_FEED_ID,
  expectedSourceIndex: 0,
  expectedRingVersion: CURRENT_RING_VERSION,
  expectedPlanHash: TEST_PLAN_HASH,
  clockSlot: TEST_CLOCK_SLOT,
  maxObservationAgeSlots: 5,
  sourceConfig: {
    pubkey: sourceConfig,
    owner: MIMIR_PROGRAM_ID,
    data: buildTestCpmmSourceConfigHeader(),
  },
});
assert.equal(sourceRingAccountHeader.ringVersion, CURRENT_RING_VERSION);
assert.throws(
  () =>
    verifySourceConfigAccount({
      sourceConfig: Keypair.generate().publicKey,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestSourceConfigHeader(),
      expectedFeedId: TEST_FEED_ID,
      expectedSourceIndex: 0,
    }),
  /InvalidSourceConfigAddress/,
);
assert.throws(
  () =>
    verifySourceObservationRingAccount({
      sourceRing: Keypair.generate().publicKey,
      owner: MIMIR_PROGRAM_ID,
      data: currentRing(),
      expectedFeedId: TEST_FEED_ID,
      expectedSourceIndex: 0,
      expectedRingVersion: CURRENT_RING_VERSION,
      expectedPlanHash: TEST_PLAN_HASH,
      clockSlot: TEST_CLOCK_SLOT,
      maxObservationAgeSlots: 5,
    }),
  /InvalidSourceRingAddress/,
);
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestProducerBoundSnapshotHeader(),
      policy: livePolicy,
    }),
  /MissingFeedConfig/,
);
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestSnapshotHeader(),
      policy: registryPolicy,
      feedConfig: {
        pubkey: feedConfig,
        owner: MIMIR_PROGRAM_ID,
        data: toTestFeedConfigV1(buildTestFeedConfigHeader()),
      },
    }),
  /MissingRegistry/,
);
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestSnapshotHeader(),
      policy: planPolicy,
      feedConfig: {
        pubkey: feedConfig,
        owner: MIMIR_PROGRAM_ID,
        data: toTestFeedConfigV1(buildTestFeedConfigHeader()),
      },
      registry: {
        pubkey: registry,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestOracleRegistryHeader(),
      },
    }),
  /MissingSourcingPlan/,
);
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestSnapshotHeader(),
      policy: twapPolicy,
      feedConfig: {
        pubkey: feedConfig,
        owner: MIMIR_PROGRAM_ID,
        data: toTestFeedConfigV1(buildTestFeedConfigHeader()),
      },
      registry: {
        pubkey: registry,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestOracleRegistryHeader(),
      },
      sourcingPlan: {
        pubkey: sourcingPlan,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestSourcingPlanHeader(),
      },
    }),
  /MissingFeedTwap/,
);

const verifyWithTwap = createVerifySnapshotInstruction({
  snapshot,
  feedConfig,
  registry,
  sourcingPlan,
  feedTwap,
  policy: {
    ...twapPolicy,
    expectedSnapshotRevision: 1n,
    expectedTwapRevision: 1n,
  },
});
assert.equal(verifyWithTwap.data.length, 188);
assert.equal(verifyWithTwap.keys.length, 5);
assert.equal(verifyWithTwap.keys[4].pubkey.equals(feedTwap), true);
assert.throws(
  () =>
    createVerifySnapshotInstruction({
      snapshot,
      policy: {
        ...defaultTestSnapshotPolicy(),
        expectedTwapRevision: 1n,
      },
    }),
  /InvalidSnapshotPolicy/,
);
assert.throws(
  () =>
    verifyFeedSnapshotAccount({
      snapshot,
      owner: MIMIR_PROGRAM_ID,
      data: buildTestSnapshotHeader(),
      policy: {
        ...twapPolicy,
        expectedTwapRevision: 9n,
      },
      feedConfig: {
        pubkey: feedConfig,
        owner: MIMIR_PROGRAM_ID,
        data: toTestFeedConfigV1(buildTestFeedConfigHeader()),
      },
      registry: {
        pubkey: registry,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestOracleRegistryHeader(),
      },
      sourcingPlan: {
        pubkey: sourcingPlan,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestSourcingPlanHeader(),
      },
      feedTwap: {
        pubkey: feedTwap,
        owner: MIMIR_PROGRAM_ID,
        data: buildTestFeedTwapStateHeader(),
      },
    }),
  /UnexpectedTwapRevision/,
);
assert.throws(
  () =>
    createVerifySnapshotInstruction({
      snapshot,
      feedConfig,
      registry,
      sourcingPlan,
      policy: twapPolicy,
    }),
  /MissingFeedTwap/,
);

const tag89PreRead = (programId: PublicKey) => new TransactionInstruction({ programId, keys: [
  { pubkey: findFeedSnapshotPda(TEST_FEED_ID, programId)[0], isSigner: false, isWritable: true },
  { pubkey: findOracleRegistryPda(0, programId)[0], isSigner: false, isWritable: false },
  { pubkey: PublicKey.findProgramAddressSync([Buffer.from("classic_execution"), TEST_FEED_ID], programId)[0], isSigner: false, isWritable: true },
], data: Buffer.from(encodeMimirFusedClassicData({ feedId: TEST_FEED_ID, declaredMaxSnapshotAge: 5, previousSnapshotRevision: 1n,
  nextSnapshotRevision: 2n, componentCount: 1, sourceSetRevision: 1n, planHash: new Uint8Array(32), converterSourceCount: 0,
  feedConfigRevision: 1n, ringNewestSlots: [0n] })) });
const fusedRingsSnapshot = tag89PreRead(MIMIR_PROGRAM_ID);
assert.throws(
  () => findSourceConfigPda(TEST_FEED_ID, 64),
  /InvalidSourceIndex/,
);

const [feedCollateralLock] = findFeedCollateralLockPda(TEST_FEED_ID);
const [adminConfig, adminConfigBump] = findAdminConfigPda(1);
assert.equal(findAdminConfigPda()[0].equals(adminConfig), true);
assert.throws(() => findAdminConfigPda(0), /UnsupportedAdminConfigVersion/);
assert.throws(() => findAdminConfigPda(2), /UnsupportedAdminConfigVersion/);
assert.equal(
  adminConfig.equals(
    PublicKey.findProgramAddressSync(
      [Buffer.from("admin_config"), Buffer.from([1, 0])],
      MIMIR_PROGRAM_ID,
    )[0],
  ),
  true,
);
assert.equal(
  feedCollateralLock.equals(
    PublicKey.findProgramAddressSync(
      [Buffer.from("feed_collateral_lock"), Buffer.from(TEST_FEED_ID)],
      MIMIR_PROGRAM_ID,
    )[0],
  ),
  true,
);
const [feedFeeVault] = findFeedFeeVaultPda(TEST_FEED_ID);
assert.equal(
  feedFeeVault.equals(
    PublicKey.findProgramAddressSync(
      [Buffer.from("feed_fee_vault"), Buffer.from(TEST_FEED_ID)],
      MIMIR_PROGRAM_ID,
    )[0],
  ),
  true,
);
assert.throws(() => findFeedCollateralLockPda(Buffer.alloc(32)), /InvalidFeedId/);
assert.throws(() => findFeedFeeVaultPda(Buffer.alloc(32)), /InvalidFeedId/);

const adminConfigHeader = decodeAdminConfigHeader(buildTestAdminConfigHeader());
assert.equal(adminConfigHeader.feedCreationCollateralAmountRaw, 50_000n);
assert.equal(adminConfigHeader.feedCreationCollateralRequired, 1);
assert.equal(adminConfigHeader.compositeOwnerShareBps, 8_000);
assert.equal(adminConfigHeader.compositeRefreshFeeLamports, 1_000n);
assert.equal(adminConfigHeader.configRevision, 9n);
assert.equal(adminConfigHeader.status, 1);
assert.equal(adminConfigHeader.bump, 252);
assert.equal(adminConfigHeader.closePower, false);
assert.equal(adminConfigHeader.creationOpen, false);
for (const [flags, closePower, creationOpen] of [[1, true, false], [3, true, true]] as const) {
  const flagged = decodeAdminConfigHeader(buildTestAdminConfigHeader((data) => { data[89] = flags; }));
  assert.equal(flagged.closePower, closePower);
  assert.equal(flagged.creationOpen, creationOpen);
}
assert.throws(() => decodeAdminConfigHeader(buildTestAdminConfigHeader((data) => { data[89] = 4; })), /InvalidAdminConfig/);
assert.throws(() => decodeAdminConfigHeader(buildTestAdminConfigHeader((data) => { data[89] = 1; data[90] = 1; })), /InvalidAdminConfig/);
assert.equal(
  isMimirAdmittedFeedCreationCollateralMint(MIMIR_MAINNET_COLA_MINT, "localnet"),
  true,
);
assert.equal(
  isMimirAdmittedFeedCreationCollateralMint(OLD_DEVNET_COLA_MINT, "localnet"),
  false,
);
assert.equal(
  isMimirAdmittedFeedCreationCollateralMint(OLD_CUSDC_MINT, "mainnet"),
  false,
);
assert.equal(
  isMimirAdmittedFeedCreationCollateralMint(MIMIR_MAINNET_COLA_MINT, "mainnet"),
  true,
);
assert.equal(
  isMimirAdmittedFeedCreationCollateralMint(MIMIR_MAINNET_USDC_MINT, "mainnet"),
  false,
);
assert.equal(
  isMimirAdmittedFeedCreationCollateralMint(MIMIR_MAINNET_USDT_MINT, "mainnet"),
  false,
);
assert.throws(
  () =>
    decodeAdminConfigHeader(
      buildTestAdminConfigHeader((data) => {
        data.writeUInt16LE(10_001, ADMIN_CONFIG_OFFSETS.compositeOwnerShareBps);
      }),
    ),
  /InvalidAdminConfig/,
);
assert.throws(
  () =>
    decodeAdminConfigHeader(
      buildTestAdminConfigHeader((data) => {
        data.writeUInt32LE(100_000_001, ADMIN_CONFIG_OFFSETS.compositeActivationTreasuryCreationFeeLamports);
      }),
    ),
  /InvalidAdminConfig/,
);
{
  const fees = decodeAdminConfigHeader(buildTestAdminConfigHeader((data) => {
    data.writeUInt32LE(800_000, 104); data.writeUInt32LE(700_000, 108); data.writeUInt32LE(100_000_000, 112); data.set([150, 30, 5, 2], 116);
  }));
  assert.deepEqual([fees.compositeActivationOwnerFeeLamports, fees.compositeActivationTreasuryComponentFeeLamports,
    fees.compositeActivationTreasuryCreationFeeLamports, fees.tickerTierTenths], [800_000n, 700_000n, 100_000_000n, [150, 30, 5, 2]]);
}
assert.throws(
  () =>
    decodeAdminConfigHeader(
      buildTestAdminConfigHeader((data) => {
        data.fill(0, ADMIN_CONFIG_OFFSETS.rentRecoveryDestination, ADMIN_CONFIG_OFFSETS.rentRecoveryDestination + 32);
      }),
    ),
  /InvalidAdminConfig/,
);
assert.throws(
  () =>
    decodeAdminConfigHeader(
      buildTestAdminConfigHeader((data) => {
        data[ADMIN_CONFIG_OFFSETS.status] = 2;
      }),
    ),
  /InvalidAdminConfig/,
);
const bypassAdminConfigHeader = decodeAdminConfigHeader(
  buildTestAdminConfigHeader((data) => {
    data[ADMIN_CONFIG_OFFSETS.collateralRequired] = 0;
    data
      .subarray(
        ADMIN_CONFIG_OFFSETS.collateralMint,
        ADMIN_CONFIG_OFFSETS.collateralMint + 32,
      )
      .fill(0);
    data.writeBigUInt64LE(0n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw);
  }),
);
assert.equal(bypassAdminConfigHeader.feedCreationCollateralRequired, 0);
assert.equal(bypassAdminConfigHeader.feedCreationCollateralAmountRaw, 0n);

const collateralLockHeader = decodeFeedCollateralLockHeader(
  buildTestFeedCollateralLockHeader(),
);
assert.equal(Buffer.from(collateralLockHeader.feedId).equals(Buffer.from(TEST_FEED_ID)), true);
assert.equal(collateralLockHeader.lockedAmountRaw, 50_000n);
assert.equal(collateralLockHeader.createdSlot, 123_456n);
assert.equal(collateralLockHeader.createdUnixTs, 1_765_000_000n);
assert.equal(collateralLockHeader.adminConfigRevisionAtCreation, 7n);
assert.equal(collateralLockHeader.status, 1);
assert.equal(collateralLockHeader.bump, 254);
assert.throws(
  () =>
    decodeFeedCollateralLockHeader(
      buildTestFeedCollateralLockHeader((data) => {
        data.writeBigUInt64LE(
          0n,
          FEED_COLLATERAL_LOCK_OFFSETS.lockedAmountRaw,
        );
      }),
    ),
  /InvalidFeedCollateralLock/,
);
assert.throws(
  () =>
    decodeFeedCollateralLockHeader(
      buildTestFeedCollateralLockHeader((data) => {
        data[FEED_COLLATERAL_LOCK_OFFSETS.reservedTail] = 1;
      }),
    ),
  /InvalidFeedCollateralLock/,
);
assert.throws(
  () =>
    decodeFeedCollateralLockHeader(
      buildTestFeedCollateralLockHeader((data) => {
        data[FEED_COLLATERAL_LOCK_OFFSETS.status] = 0;
      }),
    ),
  /InvalidFeedCollateralLock/,
);
const oneCharLockHeader = decodeFeedCollateralLockHeader(
  buildTestFeedCollateralLockHeader((data) => {
    data[FEED_COLLATERAL_LOCK_OFFSETS.status] = 2;
    data.writeBigUInt64LE(0n, FEED_COLLATERAL_LOCK_OFFSETS.lockedAmountRaw);
  }),
);
assert.equal(oneCharLockHeader.status, 2);
assert.equal(oneCharLockHeader.lockedAmountRaw, 0n);
assert.throws(
  () =>
    decodeFeedCollateralLockHeader(
      buildTestFeedCollateralLockHeader((data) => {
        data[FEED_COLLATERAL_LOCK_OFFSETS.status] = 2;
      }),
    ),
  /InvalidFeedCollateralLock/,
);
assert.throws(
  () =>
    decodeFeedCollateralLockHeader(
      buildTestFeedCollateralLockHeader((data) => {
        data[FEED_COLLATERAL_LOCK_OFFSETS.status] = 3;
        data.writeBigUInt64LE(0n, FEED_COLLATERAL_LOCK_OFFSETS.lockedAmountRaw);
      }),
    ),
  /InvalidEnum/,
);

const feeVaultHeader = decodeFeedFeeVaultHeader(buildTestFeedFeeVaultHeader());
assert.equal(Buffer.from(feeVaultHeader.feedId).equals(Buffer.from(TEST_FEED_ID)), true);
assert.equal(feeVaultHeader.ownerGeneratedLamports, 80_000n);
assert.equal(feeVaultHeader.totalRefreshFeesLamports, 100_001n);
assert.equal(feeVaultHeader.ownerClaimedLamports, 5_000n);
assert.equal(feeVaultHeader.lastAccrualConfigRevision, 8n);
assert.equal(feeVaultHeader.status, 1);
const feeClaims = calculateFeedFeeVaultClaims(feeVaultHeader);
assert.equal(feeClaims.eligible, true);
assert.equal(feeClaims.ownerGeneratedLamports, 80_000n);
assert.equal(feeClaims.ownerClaimedLamports, 5_000n);
assert.equal(feeClaims.ownerClaimableLamports, 75_000n);
const thresholdMetFeeClaims = calculateFeedFeeVaultClaims(
  decodeFeedFeeVaultHeader(
    buildTestFeedFeeVaultHeader((data) => {
      data.writeBigUInt64LE(0n, FEED_FEE_VAULT_OFFSETS.ownerClaimedLamports);
    }),
  ),
);
assert.equal(thresholdMetFeeClaims.eligible, true);
assert.equal(thresholdMetFeeClaims.ownerClaimableLamports, 80_000n);
const dustGatedFeeClaims = calculateFeedFeeVaultClaims(
  decodeFeedFeeVaultHeader(
    buildTestFeedFeeVaultHeader((data) => {
      data.writeBigUInt64LE(
        99_999n,
        FEED_FEE_VAULT_OFFSETS.ownerGeneratedLamports,
      );
      data.writeBigUInt64LE(119_999n, FEED_FEE_VAULT_OFFSETS.totalRefreshFeesLamports);
      data.writeBigUInt64LE(20_000n, FEED_FEE_VAULT_OFFSETS.treasuryPaidLamports);
      data.writeBigUInt64LE(0n, FEED_FEE_VAULT_OFFSETS.ownerClaimedLamports);
    }),
  ),
);
assert.equal(dustGatedFeeClaims.eligible, true);
assert.equal(dustGatedFeeClaims.ownerClaimableLamports, 99_999n);
assert.throws(
  () =>
    decodeFeedFeeVaultHeader(
      buildTestFeedFeeVaultHeader((data) => {
        data.writeBigUInt64LE(80_001n, FEED_FEE_VAULT_OFFSETS.ownerClaimedLamports);
      }),
    ),
  /InvalidFeedFeeVault/,
);
assert.throws(
  () =>
    decodeFeedFeeVaultHeader(
      buildTestFeedFeeVaultHeader((data) => {
        data[FEED_FEE_VAULT_OFFSETS.status] = 0;
      }),
    ),
  /InvalidFeedFeeVault/,
);


const collateralMetas = createFeedCreationCollateralAccountMetas({
  feedCollateralLock,
  creatorCollateralTokenAccount: testPublicKey(206),
  collateralMint: testPublicKey(208),
});
assert.equal(collateralMetas.length, 4);
assert.equal(collateralMetas[0].pubkey.equals(feedCollateralLock), true);
assert.equal(collateralMetas[0].isSigner, false);
assert.equal(collateralMetas[0].isWritable, true);
assert.equal(collateralMetas[1].isWritable, true);
assert.equal(collateralMetas[2].pubkey.equals(testPublicKey(208)), true);
assert.equal(collateralMetas[2].isWritable, true);
assert.equal(collateralMetas[3].pubkey.equals(SPL_TOKEN_PROGRAM_ID), true);
assert.equal(collateralMetas[3].isWritable, false);
const tierAStructuredAnchorPolicy = {
  feedId: TEST_FEED_ID,
  anchorProvider: AnchorProvider.NativeOnlyException,
  providerProgramId: Buffer.alloc(32, 47),
  providerFeedHash: Buffer.alloc(32, 48),
  verificationLevel: 1,
  minPublisherCount: 5,
  maxConfidenceBps: 10,
  maxPublishAgeSlots: 8,
  maxDivergenceBps: 25,
  nativeExceptionHash: TEST_NATIVE_EXCEPTION_HASH,
};
const tierAStructuredAnchorPolicyHash = computeTierAAnchorPolicyHash(
  tierAStructuredAnchorPolicy,
);
const feeLossVectorSources = [
  {
    sourceId: "orca-whirlpool-tick-array-v1",
    adapterType: SourceAdapterType.OrcaWhirlpool,
    fixtureHash: Buffer.alloc(32, 61).toString("hex"),
    venueGroup: 1,
    correlationGroup: 1,
    weightBps: 2_500,
    capitalRequiredFloor: 120_000n,
    economicLossFloor: 120_000n,
    executableOnchainAdapter: true,
    productionPriorityEligible: true,
    productionPriorityBlockingReasons: [],
  },
  {
    sourceId: "raydium-clmm-tick-array-v1",
    adapterType: SourceAdapterType.RaydiumClmm,
    fixtureHash: Buffer.alloc(32, 62).toString("hex"),
    venueGroup: 2,
    correlationGroup: 2,
    weightBps: 2_500,
    capitalRequiredFloor: 130_000n,
    economicLossFloor: 130_000n,
    executableOnchainAdapter: true,
    productionPriorityEligible: true,
    productionPriorityBlockingReasons: [],
  },
  {
    sourceId: "meteora-dlmm-three-bin-array-v1",
    adapterType: SourceAdapterType.MeteoraDlmm,
    fixtureHash: Buffer.alloc(32, 63).toString("hex"),
    venueGroup: 3,
    correlationGroup: 3,
    weightBps: 2_500,
    capitalRequiredFloor: 140_000n,
    economicLossFloor: 140_000n,
    executableOnchainAdapter: true,
    productionPriorityEligible: true,
    productionPriorityBlockingReasons: [],
  },
  {
    sourceId: "openbook-l2-book-v1",
    adapterType: 4,
    fixtureHash: Buffer.alloc(32, 64).toString("hex"),
    venueGroup: 4,
    correlationGroup: 4,
    weightBps: 2_500,
    capitalRequiredFloor: 150_000n,
    economicLossFloor: 150_000n,
    executableOnchainAdapter: true,
    productionPriorityEligible: false,
    productionPriorityBlockingReasons: [
      "openbook-live-trade-flow-proof-missing",
      "openbook-two-sided-depth-proof-missing",
      "openbook-liquidity-age-calibration-missing",
      "openbook-manipulation-cost-calibration-missing",
    ],
  },
];
const passingFeeLossVector = evaluateFeeLossVector({
  sources: feeLossVectorSources,
  acceptedNotional: 10_000n,
  manipulationSafetyFactor: 10,
  minSourceCount: 4,
  minVenueGroupCount: 4,
  minCorrelationGroupCount: 4,
  maxSingleSourceWeightBps: 2_500,
  maxCorrelationGroupWeightBps: 2_500,
});
assert.equal(
  FEE_LOSS_VECTOR_HASH_DOMAIN,
  "MIMIR_MANIPULATION_COST_VECTOR_V1",
);
assert.equal(passingFeeLossVector.eligible, true);
assert.equal(passingFeeLossVector.failures.length, 0);
assert.equal(passingFeeLossVector.sourceCount, 4);
assert.equal(passingFeeLossVector.totalWeightBps, 10_000);
assert.equal(passingFeeLossVector.venueGroupCount, 4);
assert.equal(passingFeeLossVector.correlationGroupCount, 4);
assert.equal(passingFeeLossVector.capitalRequiredFloorMin, 120_000n);
assert.equal(passingFeeLossVector.economicLossFloorMin, 120_000n);
assert.equal(passingFeeLossVector.weightedEconomicLossFloor, 135_000n);
assert.equal(passingFeeLossVector.requiredEconomicLossFloor, 100_000n);
assert.deepEqual(
  passingFeeLossVector.correlationGroups.map((group) => [
    group.group,
    group.weightBps,
    group.weightedEconomicLossFloor,
  ]),
  [
    [1, 2_500, 30_000n],
    [2, 2_500, 32_500n],
    [3, 2_500, 35_000n],
    [4, 2_500, 37_500n],
  ],
);
const feeLossVectorHash = computeFeeLossVectorHash({
  sources: feeLossVectorSources,
  acceptedNotional: 10_000n,
  evaluation: passingFeeLossVector,
});
const feeLossVectorReportRoundTripPayload = {
  sources: feeLossVectorSources,
  acceptedNotional: 10_000n,
  evaluation: passingFeeLossVector,
};
const parsedFeeLossVectorReport = JSON.parse(
  stringifyFeeLossVectorReport({
    vectorHash: computeFeeLossVectorHash(
      feeLossVectorReportRoundTripPayload,
    ),
    payload: feeLossVectorReportRoundTripPayload,
  }),
) as {
  vectorHash: string;
  payload: unknown;
};
assert.match(feeLossVectorHash, /^[0-9a-f]{64}$/);
assert.equal(
  feeLossVectorHash,
  computeFeeLossVectorHash({
    evaluation: passingFeeLossVector,
    acceptedNotional: 10_000n,
    sources: feeLossVectorSources,
  }),
);
assert.equal(
  parsedFeeLossVectorReport.vectorHash,
  computeFeeLossVectorHash(parsedFeeLossVectorReport.payload),
);
const sourceOverweightFeeLossVector = evaluateFeeLossVector({
  sources: feeLossVectorSources.map((source, index) => ({
    ...source,
    weightBps: index === 0 ? 4_000 : 2_000,
  })),
  acceptedNotional: 10_000n,
  maxSingleSourceWeightBps: 2_500,
  maxCorrelationGroupWeightBps: 5_000,
});
assert.equal(sourceOverweightFeeLossVector.eligible, false);
assert.deepEqual(
  sourceOverweightFeeLossVector.failures.map(
    (failure) => failure.code,
  ),
  ["SourceWeightTooHigh"],
);
const correlatedFeeLossVector = evaluateFeeLossVector({
  sources: feeLossVectorSources.map((source, index) => ({
    ...source,
    correlationGroup: index <= 1 ? 1 : index + 1,
  })),
  acceptedNotional: 10_000n,
  minCorrelationGroupCount: 3,
  maxCorrelationGroupWeightBps: 2_500,
});
assert.equal(correlatedFeeLossVector.eligible, false);
assert.deepEqual(
  correlatedFeeLossVector.failures.map((failure) => failure.code),
  ["CorrelationGroupWeightTooHigh"],
);
const lowLossFeeLossVector = evaluateFeeLossVector({
  sources: feeLossVectorSources.map((source) => ({
    ...source,
    economicLossFloor: 10_000n,
  })),
  acceptedNotional: 10_000n,
  manipulationSafetyFactor: 10,
});
assert.equal(lowLossFeeLossVector.eligible, false);
assert.deepEqual(
  lowLossFeeLossVector.failures.map((failure) => failure.code),
  ["WeightedEconomicLossTooLow"],
);
const missingExecutableFeeLossVector = evaluateFeeLossVector({
  sources: feeLossVectorSources.map((source, index) => ({
    ...source,
    executableOnchainAdapter:
      index === feeLossVectorSources.length - 1
        ? false
        : source.executableOnchainAdapter,
  })),
  acceptedNotional: 10_000n,
  requireExecutableOnchainAdapters: true,
});
assert.deepEqual(
  missingExecutableFeeLossVector.failures.map(
    (failure) => failure.code,
  ),
  ["AdapterNotExecutable"],
);
const supportOnlyFeeLossVector = evaluateFeeLossVector({
  sources: feeLossVectorSources,
  acceptedNotional: 10_000n,
  requireProductionPrioritySources: true,
});
assert.deepEqual(
  supportOnlyFeeLossVector.failures.map((failure) => failure.code),
  ["SourceNotProductionPriority"],
);
const duplicateFixtureFeeLossVector = evaluateFeeLossVector({
  sources: feeLossVectorSources.map((source, index) => ({
    ...source,
    fixtureHash:
      index === 1
        ? feeLossVectorSources[0].fixtureHash
        : source.fixtureHash,
  })),
  acceptedNotional: 10_000n,
});
assert.equal(duplicateFixtureFeeLossVector.eligible, false);
assert.deepEqual(
  duplicateFixtureFeeLossVector.failures.map((failure) => failure.code),
  ["DuplicateFixtureHash"],
);
assert.throws(
  () =>
    evaluateFeeLossVector({
      sources: [
        feeLossVectorSources[0],
        feeLossVectorSources[0],
        feeLossVectorSources[1],
        feeLossVectorSources[2],
      ],
      acceptedNotional: 10_000n,
    }),
  /InvalidFeeLossVector/,
);
const passingAnchorPolicy = evaluateTierAAnchorPolicy({
  policy: tierAStructuredAnchorPolicy,
  expectedFeedId: TEST_FEED_ID,
  expectedNativeExceptionHash: TEST_NATIVE_EXCEPTION_HASH,
  allowNativeOnlyException: true,
});
assert.equal(passingAnchorPolicy.eligible, true);
assert.equal(
  passingAnchorPolicy.anchorPolicyHash.equals(tierAStructuredAnchorPolicyHash),
  true,
);
const parsedAnchorPolicyReport = JSON.parse(
  stringifyAnchorPolicyReport({
    schema: "mimir-anchor-policy-report-v1",
    anchorPolicyHash: passingAnchorPolicy.anchorPolicyHash,
    anchorPolicy: tierAStructuredAnchorPolicy,
    evaluation: passingAnchorPolicy,
    safety: {
      usesRpc: false,
      loadsKeypair: false,
      signsTransactions: false,
      sendsTransactions: false,
    },
  }),
) as {
  anchorPolicyHash: string;
  anchorPolicy: {
    feedId: string;
    providerProgramId: string;
    providerFeedHash: string;
  } & Omit<
    typeof tierAStructuredAnchorPolicy,
    "feedId" | "providerProgramId" | "providerFeedHash"
  >;
  evaluation: {
    anchorPolicyHash: string;
    eligible: boolean;
  };
};
const parsedAnchorPolicy = {
  ...parsedAnchorPolicyReport.anchorPolicy,
  feedId: Buffer.from(parsedAnchorPolicyReport.anchorPolicy.feedId, "hex"),
  nativeExceptionHash: TEST_NATIVE_EXCEPTION_HASH,
  providerProgramId: Buffer.from(
    parsedAnchorPolicyReport.anchorPolicy.providerProgramId,
    "hex",
  ),
  providerFeedHash: Buffer.from(
    parsedAnchorPolicyReport.anchorPolicy.providerFeedHash,
    "hex",
  ),
};
assert.equal(
  parsedAnchorPolicyReport.anchorPolicyHash,
  computeTierAAnchorPolicyHash(parsedAnchorPolicy).toString("hex"),
);
assert.equal(
  parsedAnchorPolicyReport.evaluation.anchorPolicyHash,
  parsedAnchorPolicyReport.anchorPolicyHash,
);
assert.equal(parsedAnchorPolicyReport.evaluation.eligible, true);
const failingAnchorPolicy = evaluateTierAAnchorPolicy({
  policy: {
    ...tierAStructuredAnchorPolicy,
    anchorProvider: 1,
  },
  expectedFeedId: TEST_FEED_ID,
});
assert.equal(failingAnchorPolicy.eligible, false);
assert.deepEqual(
  failingAnchorPolicy.failures.map((failure) => failure.code),
  ["AnchorProviderInvalid"],
);
const passingRouteableDepthEvidence = evaluateRouteableDepthEvidence({
  targetBps: 50,
  acceptedNotional: 10_000n,
  minLiquidityAgeSlots: 64,
  sides: [
    {
      side: "up",
      targetBps: 50,
      covered: true,
      rangeCount: 3,
      missingRangeCount: 0,
      capitalRequiredFloor: 120_000n,
      economicLossFloor: 110_000n,
      liquidityAgeSlotsMin: 128,
    },
    {
      side: "down",
      targetBps: 50,
      covered: true,
      rangeCount: 4,
      capitalRequiredFloor: 130_000n,
      economicLossFloor: 115_000n,
      liquidityAgeSlotsMin: 96,
    },
  ],
});
assert.equal(passingRouteableDepthEvidence.eligible, true);
assert.equal(passingRouteableDepthEvidence.requiredCapitalFloor, 10_000n);
assert.equal(passingRouteableDepthEvidence.requiredEconomicLossFloor, 100_000n);
assert.equal(passingRouteableDepthEvidence.capitalRequiredFloor, 120_000n);
assert.equal(passingRouteableDepthEvidence.economicLossFloor, 110_000n);
assert.equal(passingRouteableDepthEvidence.minLiquidityAgeSlotsObserved, 96n);
const builtRouteableDepthEvidence = buildRouteableDepthEvidenceFromRanges({
  targetBps: 50,
  sides: [
    {
      side: "up",
      ranges: [
        {
          lowerBps: 0,
          upperBps: 15,
          capitalRequired: 30_000n,
          economicLoss: 30_000n,
          liquidityAgeSlots: 128n,
        },
        {
          lowerBps: 15,
          upperBps: 35,
          capitalRequired: 40_000n,
          economicLoss: 35_000n,
          liquidityAgeSlots: 110n,
        },
        {
          lowerBps: 35,
          upperBps: 50,
          capitalRequired: 50_000n,
          economicLoss: 45_000n,
          liquidityAgeSlots: 96n,
        },
      ],
    },
    {
      side: "down",
      ranges: [
        {
          lowerBps: 0,
          upperBps: 20,
          capitalRequired: 45_000n,
          economicLoss: 40_000n,
          liquidityAgeSlots: 144n,
        },
        {
          lowerBps: 20,
          upperBps: 50,
          capitalRequired: 85_000n,
          economicLoss: 75_000n,
          liquidityAgeSlots: 120n,
        },
      ],
    },
  ],
});
assert.equal(
  ROUTEABLE_DEPTH_RANGE_EVIDENCE_HASH_DOMAIN,
  "MIMIR_ROUTEABLE_DEPTH_RANGES_V1",
);
assert.equal(builtRouteableDepthEvidence.sides[0]?.capitalRequiredFloor, 120_000n);
assert.equal(builtRouteableDepthEvidence.sides[0]?.economicLossFloor, 110_000n);
assert.equal(builtRouteableDepthEvidence.sides[0]?.liquidityAgeSlotsMin, 96n);
assert.equal(builtRouteableDepthEvidence.rangeSummaries[1]?.coverageEndBps, 50);
const builtRouteableDepthHash = computeRouteableDepthRangeEvidenceHash(
  builtRouteableDepthEvidence,
);
assert.equal(builtRouteableDepthHash.length, 64);
assert.equal(
  builtRouteableDepthHash,
  computeRouteableDepthRangeEvidenceHash(builtRouteableDepthEvidence),
);
const parsedRouteableDepthRangeReport = JSON.parse(
  stringifyRouteableDepthRangeEvidenceReport({
    schema: "mimir-routeable-depth-range-evidence-report-v1",
    hashDomain: ROUTEABLE_DEPTH_RANGE_EVIDENCE_HASH_DOMAIN,
    evidenceHash: builtRouteableDepthHash,
    rangeEvidence: builtRouteableDepthEvidence,
    evaluation: {
      eligible: true,
    },
    safety: {
      usesRpc: false,
      loadsKeypair: false,
      signsTransactions: false,
      sendsTransactions: false,
    },
  }),
) as {
  evidenceHash: string;
  rangeEvidence: typeof builtRouteableDepthEvidence;
};
assert.equal(
  parsedRouteableDepthRangeReport.evidenceHash,
  computeRouteableDepthRangeEvidenceHash(
    parsedRouteableDepthRangeReport.rangeEvidence,
  ),
);
const passingBuiltRouteableDepthEvidence = evaluateRouteableDepthEvidence({
  ...builtRouteableDepthEvidence,
  acceptedNotional: 10_000n,
  minLiquidityAgeSlots: 64,
});
assert.equal(passingBuiltRouteableDepthEvidence.eligible, true);
assert.equal(
  ROUTEABLE_DEPTH_TRAVERSAL_HASH_DOMAIN,
  "MIMIR_ROUTEABLE_DEPTH_TRAVERSAL_V1",
);
assert.equal(
  ROUTEABLE_DEPTH_TRAVERSAL_SET_HASH_DOMAIN,
  "MIMIR_ROUTEABLE_DEPTH_TRAVERSAL_SET_V1",
);
const decodedTraversal = buildRouteableDepthEvidenceFromDecodedLevels({
  targetBps: 50,
  currentSlot: 1_000n,
  sides: [
    {
      side: "up",
      levels: [
        {
          lowerBps: 0,
          upperBps: 25,
          capitalRequired: 60_000n,
          economicLoss: 55_000n,
          observedSlot: 900n,
        },
        {
          lowerBps: 25,
          upperBps: 50,
          capitalRequired: 70_000n,
          economicLoss: 65_000n,
          observedSlot: 880n,
        },
      ],
    },
    {
      side: "down",
      levels: [
        {
          lowerBps: 0,
          upperBps: 50,
          capitalRequired: 135_000n,
          economicLoss: 120_000n,
          observedSlot: 904n,
        },
      ],
    },
  ],
});
assert.equal(decodedTraversal.currentSlot, 1_000n);
assert.equal(decodedTraversal.rangeEvidence.sides[0]?.liquidityAgeSlotsMin, 100n);
assert.equal(decodedTraversal.traversalSummaries[0]?.inputLevelCount, 2);
assert.equal(decodedTraversal.traversalSummaries[0]?.coverageEndBps, 50);
const decodedTraversalEvaluation = evaluateRouteableDepthEvidence({
  ...decodedTraversal.rangeEvidence,
  acceptedNotional: 10_000n,
  minLiquidityAgeSlots: 64,
});
assert.equal(decodedTraversalEvaluation.eligible, true);
const decodedTraversalHash = computeRouteableDepthTraversalHash({
  fixtureId: "decoded-depth-fixture",
  traversal: decodedTraversal,
});
const decodedTraversalSetHash = computeRouteableDepthTraversalSetHash([
  {
    fixtureId: "decoded-depth-fixture",
    traversalHash: decodedTraversalHash,
  },
]);
assert.equal(decodedTraversalHash.length, 64);
assert.equal(decodedTraversalSetHash.length, 64);
assert.throws(
  () =>
    buildRouteableDepthEvidenceFromDecodedLevels({
      currentSlot: 10n,
      sides: [
        {
          side: "up",
          levels: [
            {
              lowerBps: 0,
              upperBps: 50,
              capitalRequired: 1n,
              economicLoss: 1n,
              observedSlot: 11n,
            },
          ],
        },
      ],
    }),
  /InvalidRouteableDepthTraversal/,
);
assert.throws(
  () =>
    computeRouteableDepthTraversalSetHash([
      {
        fixtureId: "decoded-depth-fixture",
        traversalHash: decodedTraversalHash,
      },
      {
        fixtureId: "decoded-depth-fixture",
        traversalHash: decodedTraversalHash,
      },
    ]),
  /InvalidRouteableDepthTraversal/,
);
assert.equal(
  ROUTEABLE_DEPTH_ACCOUNT_DATA_HASH_DOMAIN,
  "MIMIR_ROUTEABLE_DEPTH_ACCOUNT_DATA_V1",
);
assert.equal(
  ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_HASH_DOMAIN,
  "MIMIR_ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_V1",
);
assert.equal(
  ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_SET_HASH_DOMAIN,
  "MIMIR_ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_SET_V1",
);
const routeableDepthMarketAccount = Keypair.generate().publicKey;
const routeableDepthVaultAccount = Keypair.generate().publicKey;
const routeableDepthMarketOwner = Keypair.generate().publicKey;
const routeableDepthVaultOwner = SPL_TOKEN_PROGRAM_ID;
const routeableDepthMarketData = Buffer.alloc(512, 7);
const routeableDepthVaultData = Buffer.alloc(165, 8);
const routeableDepthAccountBundle = await fetchRouteableDepthAccountBundle({
  fixtureId: "decoded-depth-fixture",
  commitment: "confirmed",
  requests: [
    {
      role: "market",
      publicKey: routeableDepthMarketAccount,
      expectedOwnerProgramId: routeableDepthMarketOwner,
      minDataLength: 512,
      maxDataLength: 512,
    },
    {
      role: "base-vault",
      publicKey: routeableDepthVaultAccount,
      expectedOwnerProgramId: routeableDepthVaultOwner,
      minDataLength: 165,
      maxDataLength: 165,
    },
  ],
  connection: {
    async getMultipleAccountsInfo(publicKeys, commitment) {
      assert.equal(commitment, "confirmed");
      assert.equal(publicKeys[0]?.equals(routeableDepthMarketAccount), true);
      assert.equal(publicKeys[1]?.equals(routeableDepthVaultAccount), true);
      return [
        {
          data: routeableDepthMarketData,
          owner: routeableDepthMarketOwner,
          executable: false,
        },
        {
          data: routeableDepthVaultData,
          owner: routeableDepthVaultOwner,
          executable: false,
        },
      ];
    },
  },
});
assert.equal(routeableDepthAccountBundle.accountCount, 2);
assert.equal(routeableDepthAccountBundle.records[0]?.dataLength, 512);
assert.equal(
  routeableDepthAccountBundle.records[0]?.dataHash,
  computeRouteableDepthAccountDataHash(routeableDepthMarketData),
);
assert.equal(
  routeableDepthAccountBundle.bundleHash,
  computeRouteableDepthAccountBundleHash({
    fixtureId: routeableDepthAccountBundle.fixtureId,
    commitment: routeableDepthAccountBundle.commitment,
    accountCount: routeableDepthAccountBundle.accountCount,
    records: routeableDepthAccountBundle.records,
  }),
);
const routeableDepthAccountBundleSetHash =
  computeRouteableDepthAccountBundleSetHash([
    {
      fixtureId: routeableDepthAccountBundle.fixtureId,
      bundleHash: routeableDepthAccountBundle.bundleHash,
    },
  ]);
assert.equal(routeableDepthAccountBundleSetHash.length, 64);
await assert.rejects(
  () =>
    fetchRouteableDepthAccountBundle({
      fixtureId: "owner-mismatch",
      requests: [
        {
          role: "market",
          publicKey: routeableDepthMarketAccount,
          expectedOwnerProgramId: routeableDepthMarketOwner,
          minDataLength: 512,
        },
      ],
      connection: {
        async getMultipleAccountsInfo() {
          return [
            {
              data: routeableDepthMarketData,
              owner: Keypair.generate().publicKey,
              executable: false,
            },
          ];
        },
      },
    }),
  /RouteableDepthAccountOwnerMismatch/,
);
await assert.rejects(
  () =>
    fetchRouteableDepthAccountBundle({
      fixtureId: "executable-account",
      requests: [
        {
          role: "market",
          publicKey: routeableDepthMarketAccount,
          minDataLength: 512,
        },
      ],
      connection: {
        async getMultipleAccountsInfo() {
          return [
            {
              data: routeableDepthMarketData,
              owner: routeableDepthMarketOwner,
              executable: true,
            },
          ];
        },
      },
    }),
  /ExecutableRouteableDepthAccount/,
);
assert.equal(
  ROUTEABLE_DEPTH_ADAPTER_FIXTURE_HASH_DOMAIN,
  "MIMIR_ROUTEABLE_DEPTH_ADAPTER_FIXTURE_V1",
);
assert.equal(
  ROUTEABLE_DEPTH_ADAPTER_FIXTURE_SET_HASH_DOMAIN,
  "MIMIR_ROUTEABLE_DEPTH_ADAPTER_FIXTURE_SET_V1",
);
const routeableDepthAdapterFixture = {
  fixtureId: "meteora-dlmm-three-bin-array-v1",
  adapterName: "Meteora DLMM",
  adapterType: SourceAdapterType.MeteoraDlmm,
  sourceLayout: "meteora-dlmm-lower-active-upper-bin-arrays-v1",
  executableOnchainAdapter: true,
  productionPriorityEligible: true,
  productionPriorityBlockingReasons: [],
  accountGraphHash: Buffer.alloc(32, 54),
  rangeEvidence: builtRouteableDepthEvidence,
  evaluation: passingBuiltRouteableDepthEvidence,
  notes: ["offline fixture hash"],
};
const routeableDepthAdapterFixtureHash =
  computeRouteableDepthAdapterFixtureHash(routeableDepthAdapterFixture);
const routeableDepthAdapterFixtureSetHash =
  computeRouteableDepthAdapterFixtureSetHash([routeableDepthAdapterFixture]);
const parsedRouteableDepthAdapterFixtureReport = JSON.parse(
  stringifyRouteableDepthRangeEvidenceReport({
    fixtureSetHash: routeableDepthAdapterFixtureSetHash,
    fixtureHashes: [
      {
        fixtureId: routeableDepthAdapterFixture.fixtureId,
        fixtureHash: routeableDepthAdapterFixtureHash,
        eligible: routeableDepthAdapterFixture.evaluation.eligible,
      },
    ],
    fixtures: [routeableDepthAdapterFixture],
  }),
) as {
  fixtureSetHash: string;
  fixtureHashes: Array<{
    eligible: boolean;
    fixtureHash: string;
    fixtureId: string;
  }>;
  fixtures: typeof routeableDepthAdapterFixture[];
};
assert.equal(routeableDepthAdapterFixtureHash.length, 64);
assert.equal(routeableDepthAdapterFixtureSetHash.length, 64);
assert.equal(
  routeableDepthAdapterFixtureHash,
  computeRouteableDepthAdapterFixtureHash(routeableDepthAdapterFixture),
);
assert.equal(
  parsedRouteableDepthAdapterFixtureReport.fixtureHashes[0]?.fixtureHash,
  computeRouteableDepthAdapterFixtureHash(
    parsedRouteableDepthAdapterFixtureReport.fixtures[0],
  ),
);
assert.equal(
  parsedRouteableDepthAdapterFixtureReport.fixtureSetHash,
  computeRouteableDepthAdapterFixtureSetHash(
    parsedRouteableDepthAdapterFixtureReport.fixtures,
  ),
);
assert.throws(
  () =>
    computeRouteableDepthAdapterFixtureSetHash([
      routeableDepthAdapterFixture,
      routeableDepthAdapterFixture,
    ]),
  /InvalidRouteableDepthAdapterFixture/,
);
assert.throws(
  () =>
    computeRouteableDepthAdapterFixtureSetHash([
      routeableDepthAdapterFixture,
      {
        ...routeableDepthAdapterFixture,
        fixtureId: "same-account-graph-different-fixture",
      },
    ]),
  /InvalidRouteableDepthAdapterFixture/,
);
const gappedBuiltRouteableDepthEvidence = buildRouteableDepthEvidenceFromRanges({
  targetBps: 50,
  sides: [
    {
      side: "up",
      ranges: [
        {
          lowerBps: 0,
          upperBps: 20,
          capitalRequired: 30_000n,
          economicLoss: 40_000n,
          liquidityAgeSlots: 90n,
        },
        {
          lowerBps: 30,
          upperBps: 50,
          capitalRequired: 30_000n,
          economicLoss: 40_000n,
          liquidityAgeSlots: 90n,
        },
      ],
    },
    {
      side: "down",
      ranges: [
        {
          lowerBps: 0,
          upperBps: 50,
          covered: false,
          capitalRequired: 0n,
          economicLoss: 0n,
          liquidityAgeSlots: null,
        },
      ],
    },
  ],
});
assert.equal(gappedBuiltRouteableDepthEvidence.sides[0]?.covered, false);
assert.equal(gappedBuiltRouteableDepthEvidence.sides[0]?.missingRangeCount, 1);
assert.equal(gappedBuiltRouteableDepthEvidence.sides[1]?.missingRangeCount, 2);
const failingBuiltRouteableDepthEvidence = evaluateRouteableDepthEvidence({
  ...gappedBuiltRouteableDepthEvidence,
  acceptedNotional: 10_000n,
  minLiquidityAgeSlots: 64,
});
assert.equal(failingBuiltRouteableDepthEvidence.eligible, false);
assert.deepEqual(
  failingBuiltRouteableDepthEvidence.failures.map((failure) => failure.code),
  [
    "CoverageIncomplete",
    "MissingRange",
    "EconomicLossTooLow",
    "CoverageIncomplete",
    "RangeCountTooLow",
    "MissingRange",
    "CapitalFloorTooLow",
    "EconomicLossTooLow",
    "LiquidityAgeMissing",
  ],
);
const youngBuiltRouteableDepthEvidence = buildRouteableDepthEvidenceFromRanges({
  targetBps: 50,
  sides: [
    {
      side: "up",
      ranges: [
        {
          lowerBps: 0,
          upperBps: 50,
          capitalRequired: 120_000n,
          economicLoss: 110_000n,
          liquidityAgeSlots: 63n,
        },
      ],
    },
    {
      side: "down",
      ranges: [
        {
          lowerBps: 0,
          upperBps: 50,
          capitalRequired: 130_000n,
          economicLoss: 115_000n,
          liquidityAgeSlots: 96n,
        },
      ],
    },
  ],
});
const youngRouteableDepthEvaluation = evaluateRouteableDepthEvidence({
  ...youngBuiltRouteableDepthEvidence,
  acceptedNotional: 10_000n,
  minLiquidityAgeSlots: 64,
});
assert.deepEqual(
  youngRouteableDepthEvaluation.failures.map((failure) => failure.code),
  ["LiquidityAgeTooYoung"],
);
assert.throws(
  () =>
    buildRouteableDepthEvidenceFromRanges({
      targetBps: 50,
      sides: [
        {
          side: "up",
          ranges: [
            {
              lowerBps: 25,
              upperBps: 25,
              capitalRequired: 1n,
              economicLoss: 1n,
              liquidityAgeSlots: 1n,
            },
          ],
        },
      ],
    }),
  /InvalidRouteableDepthEvidence/,
);
const missingSideRouteableDepthEvidence = evaluateRouteableDepthEvidence({
  targetBps: 50,
  acceptedNotional: 10_000n,
  minLiquidityAgeSlots: 64,
  sides: [
    {
      side: "up",
      targetBps: 50,
      covered: true,
      rangeCount: 3,
      capitalRequiredFloor: 120_000n,
      economicLossFloor: 110_000n,
      liquidityAgeSlotsMin: 128,
    },
  ],
});
assert.equal(missingSideRouteableDepthEvidence.eligible, false);
assert.deepEqual(
  missingSideRouteableDepthEvidence.failures.map((failure) => failure.code),
  ["MissingSide"],
);
const failingRouteableDepthEvidence = evaluateRouteableDepthEvidence({
  targetBps: 50,
  acceptedNotional: 10_000n,
  minLiquidityAgeSlots: 64,
  sides: [
    {
      side: "up",
      targetBps: 50,
      covered: true,
      rangeCount: 3,
      capitalRequiredFloor: 120_000n,
      economicLossFloor: 110_000n,
      liquidityAgeSlotsMin: 128,
    },
    {
      side: "down",
      targetBps: 50,
      covered: false,
      rangeCount: 0,
      missingRangeCount: 2,
      capitalRequiredFloor: 9_000n,
      economicLossFloor: 90_000n,
      liquidityAgeSlotsMin: 12,
    },
  ],
});
assert.equal(failingRouteableDepthEvidence.eligible, false);
assert.deepEqual(
  failingRouteableDepthEvidence.failures.map((failure) => failure.code),
  [
    "CoverageIncomplete",
    "RangeCountTooLow",
    "MissingRange",
    "CapitalFloorTooLow",
    "EconomicLossTooLow",
    "LiquidityAgeTooYoung",
  ],
);
assert.throws(
  () =>
    evaluateRouteableDepthEvidence({
      targetBps: 0,
      acceptedNotional: 10_000n,
      sides: [],
    }),
  /InvalidRouteableDepthEvidence/,
);

const consumerProgram = new PublicKey(new Uint8Array(32).fill(201));
const consumerState = new PublicKey(new Uint8Array(32).fill(202));
const consumerInstruction = new TransactionInstruction({
  programId: consumerProgram,
  keys: [
    { pubkey: consumerState, isSigner: false, isWritable: true },
    { pubkey: snapshot, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([7, 8, 9]),
});
const refreshReadConsumerInstructions = createMimirRefreshReadConsumerInstructions({
  preReadInstructions: [fusedRingsSnapshot],
  snapshot,
  feedConfig,
  registry,
  sourcingPlan,
  feedTwap,
  policy: {
    ...twapPolicy,
    expectedSnapshotRevision: 1n,
    expectedTwapRevision: 1n,
  },
  consumerInstruction,
});
assert.equal(refreshReadConsumerInstructions.length, 3);
assert.equal(refreshReadConsumerInstructions[0], fusedRingsSnapshot);
assert.equal(refreshReadConsumerInstructions[1]?.data[0], VERIFY_SNAPSHOT_TAG);
assert.equal(refreshReadConsumerInstructions[2], consumerInstruction);
const directReadConsumerInstruction = new TransactionInstruction({
  programId: consumerProgram,
  keys: [
    { pubkey: consumerState, isSigner: false, isWritable: true },
    { pubkey: snapshot, isSigner: false, isWritable: false },
    { pubkey: feedTwap, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([10, 11, 12]),
});
const directReadInstructions = createMimirAuditedDirectReadConsumerInstructions({
  preReadInstructions: [fusedRingsSnapshot],
  snapshot,
  feedConfig,
  registry,
  sourcingPlan,
  feedTwap,
  policy: {
    ...twapPolicy,
    expectedSnapshotRevision: 2n,
    expectedTwapRevision: 2n,
  },
  consumerInstruction: directReadConsumerInstruction,
  auditedConsumer: {
    auditId: "mimir-consumer-fixture/full-live-v0",
    consumerProgramId: consumerProgram,
    requiresTwapRead: true,
  },
});
assert.equal(directReadInstructions.length, 2);
assert.equal(directReadInstructions[0], fusedRingsSnapshot);
assert.equal(directReadInstructions[1], directReadConsumerInstruction);
const alternateConsumerProgramId = testPublicKey(245);
const alternateSnapshot = findFeedSnapshotPda(
  TEST_FEED_ID,
  alternateConsumerProgramId,
)[0];
const alternateFeedConfig = findFeedConfigPda(
  TEST_FEED_ID,
  alternateConsumerProgramId,
)[0];
const alternateFeedTwap = findFeedTwapPda(
  TEST_FEED_ID,
  TEST_TWAP_VERSION,
  alternateConsumerProgramId,
)[0];
const alternateRegistry = findOracleRegistryPda(0, alternateConsumerProgramId)[0];
const alternateSourcingPlan = findSourcingPlanPda(
  TEST_FEED_ID,
  header.sourcingPlanId,
  header.sourcingPlanVersion,
  alternateConsumerProgramId,
)[0];
const alternateFusedRingsSnapshot = tag89PreRead(alternateConsumerProgramId);
const alternateDirectReadConsumerInstruction = new TransactionInstruction({
  programId: consumerProgram,
  keys: [
    { pubkey: consumerState, isSigner: false, isWritable: true },
    { pubkey: alternateSnapshot, isSigner: false, isWritable: false },
    { pubkey: alternateFeedTwap, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([13, 14, 15]),
});
assert.throws(
  () =>
    createMimirAuditedDirectReadConsumerInstructions({
      preReadInstructions: [alternateFusedRingsSnapshot],
      snapshot: alternateSnapshot,
      feedConfig: alternateFeedConfig,
      registry: alternateRegistry,
      sourcingPlan: alternateSourcingPlan,
      feedTwap: alternateFeedTwap,
      policy: {
        ...twapPolicy,
        expectedSnapshotRevision: 2n,
        expectedTwapRevision: 2n,
      },
      consumerInstruction: alternateDirectReadConsumerInstruction,
      auditedConsumer: {
        auditId: "mimir-consumer-fixture/full-live-v0",
        consumerProgramId: consumerProgram,
        requiresTwapRead: true,
      },
    }),
  /InvalidMimirAtomicRefreshInstruction/,
);
const alternateDirectReadInstructions =
  createMimirAuditedDirectReadConsumerInstructions({
    preReadInstructions: [alternateFusedRingsSnapshot],
    snapshot: alternateSnapshot,
    feedConfig: alternateFeedConfig,
    registry: alternateRegistry,
    sourcingPlan: alternateSourcingPlan,
    feedTwap: alternateFeedTwap,
    policy: {
      ...twapPolicy,
      expectedSnapshotRevision: 2n,
      expectedTwapRevision: 2n,
    },
    consumerInstruction: alternateDirectReadConsumerInstruction,
    auditedConsumer: {
      auditId: "mimir-consumer-fixture/full-live-v0",
      consumerProgramId: consumerProgram,
      requiresTwapRead: true,
    },
    programId: alternateConsumerProgramId,
  });
assert.equal(alternateDirectReadInstructions.length, 2);
assert.equal(alternateDirectReadInstructions[0], alternateFusedRingsSnapshot);
assert.equal(
  alternateDirectReadInstructions[1],
  alternateDirectReadConsumerInstruction,
);
assert.throws(
  () =>
    createMimirAuditedDirectReadConsumerInstructions({
      preReadInstructions: [fusedRingsSnapshot],
      snapshot,
      feedTwap,
      policy: {
        ...twapPolicy,
        expectedSnapshotRevision: 2n,
        expectedTwapRevision: 2n,
      },
      consumerInstruction,
      auditedConsumer: {
        auditId: "missing-twap-read",
        consumerProgramId: consumerProgram,
        requiresTwapRead: true,
      },
    }),
  /ConsumerMissingTwapRead/,
);
assert.throws(
  () =>
    createMimirRefreshReadConsumerInstructions({
      snapshot,
      policy: {
        ...defaultTestSnapshotPolicy(),
        expectedSnapshotRevision: 0n,
      },
      consumerInstruction,
      preReadInstructions: [fusedRingsSnapshot],
    }),
  /MissingSnapshotRevisionBinding/,
);
assert.throws(
  () =>
    createMimirRefreshReadConsumerInstructions({
      snapshot,
      feedConfig,
      registry,
      sourcingPlan,
      feedTwap,
      policy: {
        ...twapPolicy,
        expectedSnapshotRevision: 1n,
        expectedTwapRevision: 0n,
      },
      consumerInstruction,
      preReadInstructions: [fusedRingsSnapshot],
    }),
  /MissingTwapRevisionBinding/,
);
assert.throws(
  () =>
    createMimirRefreshReadConsumerInstructions({
      snapshot,
      policy: {
        ...defaultTestSnapshotPolicy(),
        expectedSnapshotRevision: 1n,
      },
      preReadInstructions: [fusedRingsSnapshot],
      consumerInstruction: new TransactionInstruction({
        programId: consumerProgram,
        keys: [{ pubkey: consumerState, isSigner: false, isWritable: true }],
        data: Buffer.alloc(0),
      }),
    }),
  /ConsumerMissingSnapshotRead/,
);
assert.throws(
  () =>
    createMimirRefreshReadConsumerInstructions({
      snapshot,
      policy: {
        ...defaultTestSnapshotPolicy(),
        expectedSnapshotRevision: 1n,
      },
      preReadInstructions: [fusedRingsSnapshot],
      consumerInstruction: new TransactionInstruction({
        programId: consumerProgram,
        keys: [{ pubkey: snapshot, isSigner: true, isWritable: false }],
        data: Buffer.alloc(0),
      }),
    }),
  /ConsumerRequiresSnapshotSigner/,
);
assert.throws(
  () =>
    createMimirRefreshReadConsumerInstructions({
      snapshot,
      policy: {
        ...defaultTestSnapshotPolicy(),
        expectedSnapshotRevision: 1n,
      },
      preReadInstructions: [fusedRingsSnapshot],
      consumerInstruction: new TransactionInstruction({
        programId: consumerProgram,
        keys: [{ pubkey: snapshot, isSigner: false, isWritable: true }],
        data: Buffer.alloc(0),
      }),
    }),
  /ConsumerWritesVerifiedOracleAccount/,
);
assert.throws(
  () =>
    createMimirRefreshReadConsumerInstructions({
      snapshot,
      policy: {
        ...defaultTestSnapshotPolicy(),
        expectedSnapshotRevision: 1n,
      },
      preReadInstructions: [fusedRingsSnapshot],
      consumerInstruction: createVerifySnapshotInstruction({
        snapshot,
        policy: {
          ...defaultTestSnapshotPolicy(),
          expectedSnapshotRevision: 1n,
        },
      }),
    }),
  /InvalidConsumerProgram/,
);
assert.throws(
  () =>
    createMimirRefreshReadConsumerInstructions({
      snapshot,
      feedConfig,
      registry,
      sourcingPlan,
      feedTwap,
      policy: {
        ...twapPolicy,
        expectedSnapshotRevision: 2n,
        expectedTwapRevision: 2n,
      },
      consumerInstruction,
      preReadInstructions: [],
    }),
  /MissingMimirAtomicRefreshInstruction/,
);
assert.throws(
  () =>
    createMimirAuditedDirectReadConsumerInstructions({
      snapshot,
      feedConfig,
      registry,
      sourcingPlan,
      feedTwap,
      policy: {
        ...twapPolicy,
        expectedSnapshotRevision: 2n,
        expectedTwapRevision: 2n,
      },
      consumerInstruction: directReadConsumerInstruction,
      auditedConsumer: {
        auditId: "mimir-consumer-fixture/full-live-v0",
        consumerProgramId: consumerProgram,
        requiresTwapRead: true,
      },
      preReadInstructions: [],
    }),
  /MissingMimirAtomicRefreshInstruction/,
);
assert.throws(
  () =>
    createMimirRefreshReadConsumerInstructions({
      snapshot,
      feedConfig,
      registry,
      sourcingPlan,
      feedTwap,
      policy: {
        ...twapPolicy,
        expectedSnapshotRevision: 2n,
        expectedTwapRevision: 2n,
      },
      consumerInstruction,
      preReadInstructions: [new TransactionInstruction({
        programId: consumerProgram,
        keys: [],
        data: Buffer.from([1]),
      })],
    }),
  /InvalidMimirAtomicRefreshInstruction/,
);
assert.equal(
  REFRESH_ORCA_RAYDIUM_CLMM_SOURCES_AND_FEED_TWAP_LEN,
  REFRESH_SOURCE_RING_FROM_ORCA_WHIRLPOOL_LEN +
    REFRESH_SOURCE_RING_FROM_RAYDIUM_CLMM_LEN +
    REFRESH_TWAP_POLICY_LEN,
);

assert.equal(
  REFRESH_METEORA_RAYDIUM_CLMM_SOURCES_AND_FEED_TWAP_LEN,
  REFRESH_SOURCE_RING_FROM_METEORA_DLMM_LEN +
    REFRESH_SOURCE_RING_FROM_RAYDIUM_CLMM_LEN +
    REFRESH_TWAP_POLICY_LEN,
);
assert.equal(
  REFRESH_ORCA_METEORA_DLMM_SOURCES_AND_FEED_TWAP_LEN,
  REFRESH_SOURCE_RING_FROM_ORCA_WHIRLPOOL_LEN +
    REFRESH_SOURCE_RING_FROM_METEORA_DLMM_LEN +
    REFRESH_TWAP_POLICY_LEN,
);
assert.equal(
  REFRESH_ORCA_METEORA_RAYDIUM_CLMM_SOURCES_AND_FEED_TWAP_LEN,
  REFRESH_SOURCE_RING_FROM_ORCA_WHIRLPOOL_LEN +
    REFRESH_SOURCE_RING_FROM_METEORA_DLMM_LEN +
    REFRESH_SOURCE_RING_FROM_RAYDIUM_CLMM_LEN +
    REFRESH_TWAP_POLICY_LEN,
);

const cpmmComponentRingSources = [
  {
    sourceRing,
    sourceConfig,
    feedConfig,
    sourcingPlan,
    baseVault: new PublicKey(new Uint8Array(32).fill(22)),
    quoteVault: new PublicKey(new Uint8Array(32).fill(23)),
    poolOrMarket: new PublicKey(new Uint8Array(32).fill(21)),
    refresh: cpmmRefreshArgs(0, 99n),
  },
  {
    sourceRing: sourceRing1,
    sourceConfig: sourceConfig1,
    feedConfig,
    sourcingPlan,
    baseVault: new PublicKey(new Uint8Array(32).fill(32)),
    quoteVault: new PublicKey(new Uint8Array(32).fill(33)),
    poolOrMarket: new PublicKey(new Uint8Array(32).fill(31)),
    refresh: cpmmRefreshArgs(1, 98n),
  },
  {
    sourceRing: sourceRing2,
    sourceConfig: sourceConfig2,
    feedConfig,
    sourcingPlan,
    baseVault: new PublicKey(new Uint8Array(32).fill(42)),
    quoteVault: new PublicKey(new Uint8Array(32).fill(43)),
    poolOrMarket: new PublicKey(new Uint8Array(32).fill(41)),
    refresh: cpmmRefreshArgs(2, 97n),
  },
  {
    sourceRing: sourceRing3,
    sourceConfig: sourceConfig3,
    feedConfig,
    sourcingPlan,
    baseVault: new PublicKey(new Uint8Array(32).fill(52)),
    quoteVault: new PublicKey(new Uint8Array(32).fill(53)),
    poolOrMarket: new PublicKey(new Uint8Array(32).fill(51)),
    refresh: cpmmRefreshArgs(3, 96n),
  },
  {
    sourceRing: sourceRing4,
    sourceConfig: sourceConfig4,
    feedConfig,
    sourcingPlan,
    baseVault: new PublicKey(new Uint8Array(32).fill(62)),
    quoteVault: new PublicKey(new Uint8Array(32).fill(63)),
    poolOrMarket: new PublicKey(new Uint8Array(32).fill(61)),
    refresh: cpmmRefreshArgs(4, 95n),
  },
] as const;
const fusedCpmmComponentRingSources = cpmmComponentRingSources.map((source, index) => ({
  ...source,
  refresh: {
    ...source.refresh,
    feedId: Uint8Array.from({ length: 32 }, () => 90 + index),
  },
}));
const fiveCompositeConfigForFusedRefresh = buildCompositeSumOfPricesConfig({
  creator: TEST_GOVERNANCE_AUTHORITY.toBytes(),
  quoteMint: MIMIR_MAINNET_USDC_MINT.toBytes(),
  cluster: "localnet",
  priceExponent: -6,
  maxSnapshotAgeSlots: 8,
  maxComponentSnapshotAgeSlots: 8,
  maxComponentConfidenceBps: 100,
  maxComponentDispersionBps: 150,
  registryEpoch: 1n,
  configRevision: 1n,
  adminConfigRevisionAtCreation: 9n,
  refreshFeeLamports: 1_000n,
  components: fusedCpmmComponentRingSources.map((source) => ({
    feedId: source.refresh.feedId,
    sourceConfig: source.sourceConfig.toBytes(),
  })),
});
const fiveCompositeFeedIdForFusedRefresh = deriveCompositeFeedId(
  fiveCompositeConfigForFusedRefresh,
);
const [fiveCompositeSnapshotForFusedRefresh] = findCompositeSnapshotPda(
  fiveCompositeFeedIdForFusedRefresh,
);
const [fiveCompositeFeedConfigForFusedRefresh] = findCompositeFeedConfigPda(
  fiveCompositeFeedIdForFusedRefresh,
);
const [fiveCompositeFeeVaultForFusedRefresh] = findFeedFeeVaultPda(
  fiveCompositeFeedIdForFusedRefresh,
);

const HASH_FIXTURE_MIMIR_PROGRAM_ID = new PublicKey("TYo5SEVfHyFzpjsbFVzNFKTnmLdBvdYjLxmnv32iQ9r");
const cpmmSourceConfigHeader = buildTestCpmmSourceConfigHeader();
const cpmmSourceConfig = decodeSourceConfigHeader(cpmmSourceConfigHeader);
const [cpmmSourceConfigAddress] = findSourceConfigPda(
  TEST_FEED_ID,
  cpmmSourceConfig.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const cpmmSourceConfigHeader1 = buildTestCpmmSourceConfigHeader(1);
const cpmmSourceConfigForSource1 = decodeSourceConfigHeader(cpmmSourceConfigHeader1);
const [cpmmSourceConfigAddress1] = findSourceConfigPda(
  TEST_FEED_ID,
  cpmmSourceConfigForSource1.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const cpmmSourceConfigHeader2 = buildTestCpmmSourceConfigHeader(2);
const cpmmSourceConfigForSource2 = decodeSourceConfigHeader(cpmmSourceConfigHeader2);
const [cpmmSourceConfigAddress2] = findSourceConfigPda(
  TEST_FEED_ID,
  cpmmSourceConfigForSource2.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const cpmmSourceConfigHeader3 = buildTestCpmmSourceConfigHeader(3);
const cpmmSourceConfigForSource3 = decodeSourceConfigHeader(cpmmSourceConfigHeader3);
const [cpmmSourceConfigAddress3] = findSourceConfigPda(
  TEST_FEED_ID,
  cpmmSourceConfigForSource3.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const cpmmSourceConfigHeader4 = buildTestCpmmSourceConfigHeader(4);
const cpmmSourceConfigForSource4 = decodeSourceConfigHeader(cpmmSourceConfigHeader4);
const [cpmmSourceConfigAddress4] = findSourceConfigPda(
  TEST_FEED_ID,
  cpmmSourceConfigForSource4.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const orcaSourceConfigHeader = buildTestOrcaWhirlpoolSourceConfigHeader();
const orcaSourceConfig = decodeSourceConfigHeader(orcaSourceConfigHeader);
const [orcaSourceConfigAddress] = findSourceConfigPda(
  TEST_FEED_ID,
  orcaSourceConfig.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const meteoraSourceConfigHeader = buildTestMeteoraDlmmSourceConfigHeader();
const meteoraSourceConfig = decodeSourceConfigHeader(meteoraSourceConfigHeader);
const [meteoraSourceConfigAddress] = findSourceConfigPda(
  TEST_FEED_ID,
  meteoraSourceConfig.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const meteoraV1BaseMint = new PublicKey(new Uint8Array(32).fill(202));
const meteoraV1QuoteMint = new PublicKey(new Uint8Array(32).fill(203));
const meteoraV1SourceConfig = decodeSourceConfigHeader(
  buildTestMeteoraDlmmSourceConfigHeader(0, (data) => {
    data.writeUInt16LE(1, SOURCE_OFFSETS.adapterVersion);
    SPL_TOKEN_2022_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.tokenProgram);
    meteoraV1BaseMint.toBuffer().copy(data, SOURCE_OFFSETS.baseMint);
    meteoraV1QuoteMint.toBuffer().copy(data, SOURCE_OFFSETS.quoteMint);
  }),
);
const meteoraSourceConfigHeader1 = buildTestMeteoraDlmmSourceConfigHeader(1);
const meteoraSourceConfigForSource1 = decodeSourceConfigHeader(
  meteoraSourceConfigHeader1,
);
const [meteoraSourceConfigAddress1] = findSourceConfigPda(
  TEST_FEED_ID,
  meteoraSourceConfigForSource1.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const meteoraDammV2SourceConfigHeader = buildTestMeteoraDlmmSourceConfigHeader(2, (data) => {
  data[SOURCE_OFFSETS.adapterType] = SourceAdapterType.MeteoraDammV2;
  METEORA_DAMM_V2_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.programId);
  Buffer.alloc(32, 57).copy(data, SOURCE_OFFSETS.poolOrMarket);
  Buffer.alloc(32, 58).copy(data, SOURCE_OFFSETS.baseVault);
  Buffer.alloc(32, 59).copy(data, SOURCE_OFFSETS.quoteVault);
  Buffer.alloc(32, 57).copy(data, SOURCE_OFFSETS.vaultAuthority);
});
const meteoraDammV2SourceConfig = decodeSourceConfigHeader(
  meteoraDammV2SourceConfigHeader,
);
const [meteoraDammV2SourceConfigAddress] = findSourceConfigPda(
  TEST_FEED_ID,
  meteoraDammV2SourceConfig.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const raydiumClmmSourceConfigHeader = buildTestRaydiumClmmSourceConfigHeader();
const raydiumClmmSourceConfig = decodeSourceConfigHeader(raydiumClmmSourceConfigHeader);
const [raydiumClmmSourceConfigAddress] = findSourceConfigPda(
  TEST_FEED_ID,
  raydiumClmmSourceConfig.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const raydiumClmmSourceConfigHeader1 = buildTestRaydiumClmmSourceConfigHeader(1);
const raydiumClmmSourceConfigForSource1 = decodeSourceConfigHeader(
  raydiumClmmSourceConfigHeader1,
);
const [raydiumClmmSourceConfigAddress1] = findSourceConfigPda(
  TEST_FEED_ID,
  raydiumClmmSourceConfigForSource1.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const raydiumClmmSourceConfigHeader2 = buildTestRaydiumClmmSourceConfigHeader(2);
const raydiumClmmSourceConfigForSource2 = decodeSourceConfigHeader(
  raydiumClmmSourceConfigHeader2,
);
const [raydiumClmmSourceConfigAddress2] = findSourceConfigPda(
  TEST_FEED_ID,
  raydiumClmmSourceConfigForSource2.sourceIndex,
  HASH_FIXTURE_MIMIR_PROGRAM_ID,
);
const cpmmAccountsHash = computeCpmmSourceAccountsHash({
  sourceConfigAddress: cpmmSourceConfigAddress,
  sourceConfig: cpmmSourceConfig,
});
const orcaAccountsHash = computeOrcaWhirlpoolSourceAccountsHash({
  sourceConfigAddress: orcaSourceConfigAddress,
  sourceConfig: orcaSourceConfig,
  whirlpoolsConfig: ORCA_WHIRLPOOLS_CONFIG_MAINNET,
});
const orcaRouteableAccountsHash = computeOrcaWhirlpoolRouteableSourceAccountsHash({
  sourceConfigAddress: orcaSourceConfigAddress,
  sourceConfig: orcaSourceConfig,
  whirlpoolsConfig: ORCA_WHIRLPOOLS_CONFIG_MAINNET,
  lowerTickArray: new PublicKey(new Uint8Array(32).fill(44)),
  activeTickArray: new PublicKey(new Uint8Array(32).fill(45)),
  upperTickArray: new PublicKey(new Uint8Array(32).fill(46)),
});
const meteoraAccountsHash = computeMeteoraDlmmSourceAccountsHash({
  sourceConfigAddress: meteoraSourceConfigAddress,
  sourceConfig: meteoraSourceConfig,
  activeBinArray: new PublicKey(new Uint8Array(32).fill(54)),
});
const meteoraRouteableAccountsHash = computeMeteoraDlmmRouteableSourceAccountsHash({
  sourceConfigAddress: meteoraSourceConfigAddress,
  sourceConfig: meteoraSourceConfig,
  lowerBinArray: new PublicKey(new Uint8Array(32).fill(55)),
  activeBinArray: new PublicKey(new Uint8Array(32).fill(54)),
  upperBinArray: new PublicKey(new Uint8Array(32).fill(56)),
});
const meteoraV1AccountsHash = computeMeteoraDlmmSourceAccountsHash({
  sourceConfigAddress: meteoraSourceConfigAddress,
  sourceConfig: meteoraV1SourceConfig,
  token2022Mint: meteoraV1BaseMint,
  activeBinArray: new PublicKey(new Uint8Array(32).fill(54)),
});
const meteoraV1RouteableAccountsHash = computeMeteoraDlmmRouteableSourceAccountsHash({
  sourceConfigAddress: meteoraSourceConfigAddress,
  sourceConfig: meteoraV1SourceConfig,
  token2022Mint: meteoraV1BaseMint,
  lowerBinArray: new PublicKey(new Uint8Array(32).fill(55)),
  activeBinArray: new PublicKey(new Uint8Array(32).fill(54)),
  upperBinArray: new PublicKey(new Uint8Array(32).fill(56)),
});
assert.equal(meteoraV1AccountsHash.length, 32);
assert.equal(meteoraV1RouteableAccountsHash.length, 32);
assert.notDeepEqual(meteoraV1AccountsHash, meteoraAccountsHash);
assert.throws(() => computeMeteoraDlmmSourceAccountsHash({
  sourceConfigAddress: meteoraSourceConfigAddress,
  sourceConfig: meteoraV1SourceConfig,
  activeBinArray: new PublicKey(new Uint8Array(32).fill(54)),
}), /MissingToken2022Mint/);
assert.throws(() => computeMeteoraDlmmSourceAccountsHash({
  sourceConfigAddress: meteoraSourceConfigAddress,
  sourceConfig: meteoraV1SourceConfig,
  token2022Mint: new PublicKey(new Uint8Array(32).fill(204)),
  activeBinArray: new PublicKey(new Uint8Array(32).fill(54)),
}), /InvalidToken2022Mint/);
const meteoraDammV2AccountsHash = computeMeteoraDammV2SourceAccountsHash({
  sourceConfigAddress: meteoraDammV2SourceConfigAddress,
  sourceConfig: meteoraDammV2SourceConfig,
});
const allMeteoraRetainedRingAccountsHash = computeRetainedRingSourcesAccountsHash([
  {
    sourceConfigAddress: meteoraSourceConfigAddress,
    sourceConfig: meteoraSourceConfig,
    activeBinArray: new PublicKey(new Uint8Array(32).fill(54)),
  },
  {
    sourceConfigAddress: meteoraSourceConfigAddress1,
    sourceConfig: meteoraSourceConfigForSource1,
    activeBinArray: new PublicKey(new Uint8Array(32).fill(55)),
  },
  {
    sourceConfigAddress: meteoraDammV2SourceConfigAddress,
    sourceConfig: meteoraDammV2SourceConfig,
  },
]);
const raydiumClmmAccountsHash = computeRaydiumClmmSourceAccountsHash({
  sourceConfigAddress: raydiumClmmSourceConfigAddress,
  sourceConfig: raydiumClmmSourceConfig,
});
const raydiumClmmRouteableAccountsHash =
  computeRaydiumClmmRouteableSourceAccountsHash({
    sourceConfigAddress: raydiumClmmSourceConfigAddress,
    sourceConfig: raydiumClmmSourceConfig,
    poolOrMarket: new PublicKey(new Uint8Array(32).fill(61)),
    baseVault: new PublicKey(new Uint8Array(32).fill(62)),
    quoteVault: new PublicKey(new Uint8Array(32).fill(63)),
    lowerTickArray: new PublicKey(new Uint8Array(32).fill(64)),
    activeTickArray: new PublicKey(new Uint8Array(32).fill(65)),
    upperTickArray: new PublicKey(new Uint8Array(32).fill(66)),
  });
assert.equal(cpmmSourceConfig.adapterType, SourceAdapterType.RaydiumCpmm);
assert.equal(
  Buffer.from(cpmmSourceConfig.programId).equals(RAYDIUM_CPMM_MAINNET_PROGRAM_ID.toBuffer()),
  true,
);
assert.equal(
  Buffer.from(cpmmSourceConfig.tokenProgram).equals(SPL_TOKEN_PROGRAM_ID.toBuffer()),
  true,
);
assert.equal(
  Buffer.from(cpmmSourceConfig.tokenProgram).equals(SPL_TOKEN_2022_PROGRAM_ID.toBuffer()),
  false,
);
assert.equal(orcaSourceConfig.adapterType, SourceAdapterType.OrcaWhirlpool);
assert.equal(
  Buffer.from(orcaSourceConfig.programId).equals(ORCA_WHIRLPOOL_PROGRAM_ID.toBuffer()),
  true,
);
assert.equal(
  Buffer.from(orcaSourceConfig.tokenProgram).equals(SPL_TOKEN_PROGRAM_ID.toBuffer()),
  true,
);
assert.equal(orcaAccountsHash.length, 32);
assert.notEqual(orcaAccountsHash.toString("hex"), cpmmAccountsHash.toString("hex"));
assert.equal(
  orcaAccountsHash.toString("hex"),
  "1be28a21ced48a7a6c6f73955f24bd8f1921abe2711f56841317843287571a43",
);
assert.equal(orcaRouteableAccountsHash.length, 32);
assert.notEqual(
  orcaRouteableAccountsHash.toString("hex"),
  orcaAccountsHash.toString("hex"),
);
assert.equal(meteoraSourceConfig.adapterType, SourceAdapterType.MeteoraDlmm);
assert.equal(meteoraSourceConfig.direction, SourceDirection.QuotePerBase);
assert.equal(
  Buffer.from(meteoraSourceConfig.programId).equals(METEORA_DLMM_PROGRAM_ID.toBuffer()),
  true,
);
assert.equal(
  Buffer.from(meteoraSourceConfig.tokenProgram).equals(SPL_TOKEN_PROGRAM_ID.toBuffer()),
  true,
);
assert.equal(
  Buffer.from(meteoraSourceConfig.vaultAuthority).equals(
    new PublicKey(new Uint8Array(32).fill(51)).toBuffer(),
  ),
  true,
);
assert.equal(meteoraAccountsHash.length, 32);
assert.notEqual(meteoraAccountsHash.toString("hex"), cpmmAccountsHash.toString("hex"));
assert.notEqual(meteoraAccountsHash.toString("hex"), orcaAccountsHash.toString("hex"));
assert.equal(
  meteoraAccountsHash.toString("hex"),
  "1a9251527c8f23eddb2b75050271822b5b962c3c4610ae90c3000875862e9e70",
);
assert.equal(meteoraRouteableAccountsHash.length, 32);
assert.notEqual(
  meteoraRouteableAccountsHash.toString("hex"),
  meteoraAccountsHash.toString("hex"),
);
assert.equal(meteoraDammV2SourceConfig.adapterType, SourceAdapterType.MeteoraDammV2);
assert.equal(meteoraDammV2SourceConfig.direction, SourceDirection.QuotePerBase);
assert.equal(
  Buffer.from(meteoraDammV2SourceConfig.programId).equals(
    METEORA_DAMM_V2_PROGRAM_ID.toBuffer(),
  ),
  true,
);
assert.equal(meteoraDammV2AccountsHash.length, 32);
assert.notEqual(meteoraDammV2AccountsHash.toString("hex"), meteoraAccountsHash.toString("hex"));
assert.notEqual(
  meteoraDammV2AccountsHash.toString("hex"),
  meteoraRouteableAccountsHash.toString("hex"),
);
assert.equal(allMeteoraRetainedRingAccountsHash.length, 32);
assert.notEqual(
  allMeteoraRetainedRingAccountsHash.toString("hex"),
  meteoraAccountsHash.toString("hex"),
);
assert.notEqual(
  allMeteoraRetainedRingAccountsHash.toString("hex"),
  meteoraDammV2AccountsHash.toString("hex"),
);
assert.equal(raydiumClmmSourceConfig.adapterType, SourceAdapterType.RaydiumClmm);
assert.equal(raydiumClmmSourceConfig.direction, SourceDirection.QuotePerBase);
assert.equal(
  Buffer.from(raydiumClmmSourceConfig.programId).equals(
    RAYDIUM_CLMM_MAINNET_PROGRAM_ID.toBuffer(),
  ),
  true,
);
assert.equal(
  Buffer.from(raydiumClmmSourceConfig.tokenProgram).equals(SPL_TOKEN_PROGRAM_ID.toBuffer()),
  true,
);
assert.equal(
  Buffer.from(raydiumClmmSourceConfig.vaultAuthority).equals(
    new PublicKey(new Uint8Array(32).fill(61)).toBuffer(),
  ),
  true,
);
assert.equal(raydiumClmmAccountsHash.length, 32);
assert.notEqual(raydiumClmmAccountsHash.toString("hex"), cpmmAccountsHash.toString("hex"));
assert.notEqual(raydiumClmmAccountsHash.toString("hex"), orcaAccountsHash.toString("hex"));
assert.notEqual(raydiumClmmAccountsHash.toString("hex"), meteoraAccountsHash.toString("hex"));
assert.equal(
  raydiumClmmAccountsHash.toString("hex"),
  "6eaec6ea3234ce8cd24909b8be23015cef52364ee0eb57ed55c205f6bb97e4b4",
);
assert.equal(raydiumClmmRouteableAccountsHash.length, 32);
assert.notEqual(
  raydiumClmmRouteableAccountsHash.toString("hex"),
  raydiumClmmAccountsHash.toString("hex"),
);
assert.notEqual(
  raydiumClmmRouteableAccountsHash.toString("hex"),
  orcaRouteableAccountsHash.toString("hex"),
);
assert.equal(
  cpmmAccountsHash.toString("hex"),
  "04671c08c3be0a8f524c02bf92e75c345bcf3b23ace1977e7ed19b696fecdd8a",
);
assert.notEqual(
  computeCpmmSourceAccountsHash({
    sourceConfigAddress: cpmmSourceConfigAddress,
    sourceConfig: cpmmSourceConfig,
    poolOrMarket: new PublicKey(new Uint8Array(32).fill(99)),
  }).toString("hex"),
  cpmmAccountsHash.toString("hex"),
);
assert.throws(
  () =>
    computeCpmmSourceAccountsHash({
      sourceConfigAddress: new Uint8Array(31),
      sourceConfig: cpmmSourceConfig,
    }),
  /SourceConfigAddressExpected32Bytes/,
);

const upsert = createLocalnetFixtureUpsertSnapshotInstruction({
  payer: payer.publicKey,
  snapshot,
  snapshotHeader: buildTestSnapshotHeader(),
  cluster: "localnet",
});
assert.equal(upsert.data.length, 1 + FEED_SNAPSHOT_MIN_HEADER_LEN);
assert.equal(upsert.keys.length, 3);
assert.equal(upsert.keys[0].isSigner, true);
assert.equal(upsert.keys[1].isWritable, true);
const fixtureEnv = process.env.MIMIR_ALLOW_UNVERIFIED_TEST_FIXTURES;
delete process.env.MIMIR_ALLOW_UNVERIFIED_TEST_FIXTURES;
assert.throws(
  () =>
    createLocalnetFixtureUpsertSnapshotInstruction({
      payer: payer.publicKey,
      snapshot,
      snapshotHeader: buildTestSnapshotHeader(),
      cluster: "localnet",
    }),
  /UnsafeFixtureRequiresLocalnetEnv/,
);
process.env.MIMIR_ALLOW_UNVERIFIED_TEST_FIXTURES = fixtureEnv;
assert.throws(
  () =>
    createLocalnetFixtureUpsertSnapshotInstruction({
      payer: payer.publicKey,
      snapshot,
      snapshotHeader: buildTestSnapshotHeader(),
      cluster: "devnet" as "localnet",
    }),
  /UnsafeFixtureRequiresLocalnetEnv/,
);


const createdConfigHeader = buildTestCreatedFeedConfigHeader();
const decodedCreatedConfig = decodeFeedConfigHeader(toTestFeedConfigV1(createdConfigHeader));
assert.equal(decodedCreatedConfig.riskTier, RiskTier.TierA);
assert.equal(decodedCreatedConfig.lifecycleState, FeedLifecycleState.Created);
assert.equal(decodedCreatedConfig.feedConfigRevision, 1n);
assert.equal(decodedCreatedConfig.registryEpoch, 1n);
assert.equal(
  Buffer.from(decodedCreatedConfig.sourceSetHash).equals(Buffer.alloc(32)),
  true,
);
const upsertAdminConfig = createUpsertAdminConfigV1Instruction({
  payer: payer.publicKey,
  authority: TEST_GOVERNANCE_AUTHORITY,
  adminConfig,
  adminConfigHeader: buildTestAdminConfigHeader((data) => {
    TEST_GOVERNANCE_AUTHORITY.toBuffer().copy(
      data,
      ADMIN_CONFIG_OFFSETS.adminAuthority,
    );
    data[ADMIN_CONFIG_OFFSETS.bump] = adminConfigBump;
  }),
});
assert.equal(upsertAdminConfig.data.length, 1 + UPSERT_ADMIN_CONFIG_V1_LEN);
assert.equal(upsertAdminConfig.data[0], UPSERT_ADMIN_CONFIG_V1_TAG);
assert.equal(upsertAdminConfig.keys.length, 4);
assert.equal(upsertAdminConfig.keys[0].isSigner, true);
assert.equal(upsertAdminConfig.keys[0].isWritable, true);
assert.equal(upsertAdminConfig.keys[1].isSigner, true);
assert.equal(upsertAdminConfig.keys[1].isWritable, false);
assert.equal(upsertAdminConfig.keys[2].pubkey.equals(adminConfig), true);
assert.equal(upsertAdminConfig.keys[2].isWritable, true);
assert.equal(upsertAdminConfig.keys[3].pubkey.equals(SystemProgram.programId), true);
assert.throws(
  () =>
    createUpsertAdminConfigV1Instruction({
      payer: payer.publicKey,
      authority: TEST_GOVERNANCE_AUTHORITY,
      adminConfig,
      adminConfigHeader: Buffer.alloc(ADMIN_CONFIG_HEADER_LEN - 1),
    }),
  /InvalidAdminConfigHeaderLength/,
);
assert.throws(
  () =>
    createUpsertAdminConfigV1Instruction({
      payer: payer.publicKey,
      authority: TEST_GOVERNANCE_AUTHORITY,
      adminConfig,
      adminConfigHeader: buildTestAdminConfigHeader((data) => {
        data.writeUInt16LE(10_001, ADMIN_CONFIG_OFFSETS.compositeOwnerShareBps);
      }),
    }),
  /InvalidAdminConfig/,
);
assert.throws(
  () =>
    createUpsertAdminConfigV1Instruction({
      payer: payer.publicKey,
      authority: TEST_GOVERNANCE_AUTHORITY,
      adminConfig: testPublicKey(99),
      adminConfigHeader: buildTestAdminConfigHeader((data) => {
        TEST_GOVERNANCE_AUTHORITY.toBuffer().copy(
          data,
          ADMIN_CONFIG_OFFSETS.adminAuthority,
        );
        data[ADMIN_CONFIG_OFFSETS.bump] = adminConfigBump;
      }),
    }),
  /InvalidAdminConfigAddress/,
);
assert.throws(
  () =>
    createUpsertAdminConfigV1Instruction({
      payer: payer.publicKey,
      authority: testPublicKey(100),
      adminConfig,
      adminConfigHeader: buildTestAdminConfigHeader(),
    }),
  /InvalidGovernanceAuthority/,
);
assert.throws(
  () =>
    createUpsertAdminConfigV1Instruction({
      payer: payer.publicKey,
      authority: TEST_GOVERNANCE_AUTHORITY,
      adminConfig,
      adminConfigHeader: buildTestAdminConfigHeader((data) => {
        TEST_GOVERNANCE_AUTHORITY.toBuffer().copy(
          data,
          ADMIN_CONFIG_OFFSETS.adminAuthority,
        );
        data[ADMIN_CONFIG_OFFSETS.bump] = 1;
      }),
    }),
  /InvalidAdminConfigAddress/,
);

const reclaimReservation = reclaimFeedReservationInstruction({
  authority: TEST_GOVERNANCE_AUTHORITY,
  registry,
  feedReservation,
  feedConfig,
  feedId: TEST_FEED_ID,
});
assert.equal(reclaimReservation.data.length, 1 + RECLAIM_FEED_RESERVATION_LEN);
assert.equal(reclaimReservation.data[0], 14);
assert.equal(reclaimReservation.keys.length, 4);
assert.equal(
  reclaimReservation.keys[0].pubkey.equals(TEST_GOVERNANCE_AUTHORITY),
  true,
);
assert.equal(reclaimReservation.keys[0].isSigner, true);
assert.equal(reclaimReservation.keys[0].isWritable, true);
assert.equal(reclaimReservation.keys[1].pubkey.equals(registry), true);
assert.equal(reclaimReservation.keys[1].isWritable, false);
assert.equal(reclaimReservation.keys[2].pubkey.equals(feedReservation), true);
assert.equal(reclaimReservation.keys[2].isWritable, true);
assert.equal(reclaimReservation.keys[3].pubkey.equals(feedConfig), true);
assert.equal(reclaimReservation.keys[3].isWritable, false);
assert.throws(
  () =>
    reclaimFeedReservationInstruction({
      authority: TEST_GOVERNANCE_AUTHORITY,
      registry,
      feedReservation,
      feedConfig,
      feedId: TEST_FEED_ID.subarray(0, 31),
    }),
  /Expected32Bytes/,
);

const claimCoreAsset = testPublicKey(223);
const [claimCompositeConfig] = findCompositeFeedConfigPda(TEST_FEED_ID);
const claimRefreshFees = createClaimRefreshFeesV1Instruction({
  feedFeeVault,
  currentOwner: TEST_GOVERNANCE_AUTHORITY,
  coreAsset: claimCoreAsset,
  claim: { feedId: TEST_FEED_ID, expectedOwnerClaimedLamports: 5_000n, claimAmountLamports: 75_000n },
});
assert.equal(claimRefreshFees.data.length, 1 + CLAIM_REFRESH_FEES_V1_LEN);
assert.equal(claimRefreshFees.data[0], CLAIM_REFRESH_FEES_V1_TAG);
assert.equal(claimRefreshFees.keys.length, 4);
assert.equal(claimRefreshFees.keys[0].pubkey.equals(TEST_GOVERNANCE_AUTHORITY), true);
assert.equal(claimRefreshFees.keys[0].isSigner, true);
assert.equal(claimRefreshFees.keys[0].isWritable, true);
assert.equal(claimRefreshFees.keys[1].pubkey.equals(claimCompositeConfig), true);
assert.equal(claimRefreshFees.keys[1].isSigner, false);
assert.equal(claimRefreshFees.keys[1].isWritable, false);
assert.equal(claimRefreshFees.keys[2].pubkey.equals(feedFeeVault), true);
assert.equal(claimRefreshFees.keys[2].isSigner, false);
assert.equal(claimRefreshFees.keys[2].isWritable, true);
assert.equal(claimRefreshFees.keys[3].pubkey.equals(claimCoreAsset), true);
assert.equal(claimRefreshFees.data.readBigUInt64LE(33), 5_000n);
assert.equal(claimRefreshFees.data.readBigUInt64LE(41), 75_000n);
assert.throws(
  () =>
    createClaimRefreshFeesV1Instruction({
      feedFeeVault,
      currentOwner: TEST_GOVERNANCE_AUTHORITY,
      coreAsset: claimCoreAsset,
      claim: { feedId: TEST_FEED_ID.subarray(0, 31), expectedOwnerClaimedLamports: 0n, claimAmountLamports: 1n },
    }),
  /Expected32Bytes/,
);
assert.throws(
  () =>
    createClaimRefreshFeesV1Instruction({
      feedFeeVault: testPublicKey(224),
      currentOwner: TEST_GOVERNANCE_AUTHORITY,
      coreAsset: claimCoreAsset,
      claim: { feedId: TEST_FEED_ID, expectedOwnerClaimedLamports: 0n, claimAmountLamports: 1n },
    }),
  /InvalidFeedFeeVault/,
);

const compositeComponentFeedIdA = Buffer.alloc(32, 11);
const compositeComponentFeedIdB = Buffer.alloc(32, 12);
const [compositeComponentSourceConfigA] = findSourceConfigPda(
  compositeComponentFeedIdA,
  0,
);
const [compositeComponentSourceConfigB] = findSourceConfigPda(
  compositeComponentFeedIdB,
  0,
);
const compositeComponents = [
  {
    feedId: compositeComponentFeedIdA,
    sourceConfig: compositeComponentSourceConfigA.toBytes(),
    quantityX64: Q64,
  },
  {
    feedId: compositeComponentFeedIdB,
    sourceConfig: compositeComponentSourceConfigB.toBytes(),
    quantityX64: Q64 * 2n,
  },
];
const compositeConfigArgs = {
  creator: TEST_GOVERNANCE_AUTHORITY.toBytes(),
  quoteMint: MIMIR_MAINNET_USDC_MINT.toBytes(),
  cluster: "localnet" as const,
  priceExponent: -6,
  maxSnapshotAgeSlots: 8,
  maxComponentSnapshotAgeSlots: 8,
  maxComponentConfidenceBps: 100,
  maxComponentDispersionBps: 150,
  registryEpoch: 1n,
  configRevision: 1n,
  adminConfigRevisionAtCreation: 9n,
  refreshFeeLamports: 1_000n,
  components: compositeComponents,
};
const oneComponentCompositeConfigArgs = {
  ...compositeConfigArgs,
  components: [compositeComponents[0]],
};
const oneComponentCompositeFeedId = deriveCompositeFeedId(
  oneComponentCompositeConfigArgs,
);
const compositeSumOfPricesComponents = buildCompositeSumOfPricesComponents([
  {
    feedId: compositeComponentFeedIdB,
    sourceConfig: compositeComponentSourceConfigB.toBytes(),
  },
  {
    feedId: compositeComponentFeedIdA,
    sourceConfig: compositeComponentSourceConfigA.toBytes(),
    quantityX64: Q64 * 2n,
  },
]);
assert.equal(compositeSumOfPricesComponents.length, 2);
assert.equal(
  Buffer.from(compositeSumOfPricesComponents[0].feedId).equals(compositeComponentFeedIdA),
  true,
);
assert.equal(compositeSumOfPricesComponents[0].quantityX64, Q64 * 2n);
assert.equal(
  Buffer.from(compositeSumOfPricesComponents[1].feedId).equals(compositeComponentFeedIdB),
  true,
);
assert.equal(compositeSumOfPricesComponents[1].quantityX64, Q64);
assert.throws(
  () =>
    buildCompositeSumOfPricesComponents([
      {
        feedId: compositeComponentFeedIdA,
        sourceConfig: compositeComponentSourceConfigA.toBytes(),
        quantityX64: 0n,
      },
      {
        feedId: compositeComponentFeedIdB,
        sourceConfig: compositeComponentSourceConfigB.toBytes(),
      },
    ]),
  /InvalidCompositeQuantity/,
);
const compositeSumOfPricesConfig = buildCompositeSumOfPricesConfig({
  ...compositeConfigArgs,
  components: [
    {
      feedId: compositeComponentFeedIdB,
      sourceConfig: compositeComponentSourceConfigB.toBytes(),
    },
    {
      feedId: compositeComponentFeedIdA,
      sourceConfig: compositeComponentSourceConfigA.toBytes(),
      quantityX64: Q64 * 2n,
    },
  ],
});
assert.equal(compositeSumOfPricesConfig.components.length, 2);
assert.equal(
  Buffer.from(compositeSumOfPricesConfig.components[0].feedId).equals(
    compositeComponentFeedIdA,
  ),
  true,
);
assert.equal(compositeSumOfPricesConfig.components[0].quantityX64, Q64 * 2n);
assert.equal(
  Buffer.from(compositeSumOfPricesConfig.components[1].feedId).equals(
    compositeComponentFeedIdB,
  ),
  true,
);
assert.equal(compositeSumOfPricesConfig.components[1].quantityX64, Q64);
const compositeComponentSetHash =
  computeCompositeComponentSetHash(compositeConfigArgs);
const compositeFeedId = deriveCompositeFeedId(compositeConfigArgs);
assert.equal(compositeComponentSetHash.length, 32);
assert.equal(compositeFeedId.length, 32);
assert.equal(
  Buffer.from(deriveCompositeFeedId(compositeConfigArgs)).equals(compositeFeedId),
  true,
);
assert.equal(
  Buffer.from(
    deriveCompositeFeedId({
      ...compositeConfigArgs,
      components: [
        compositeComponents[0],
        { ...compositeComponents[1], quantityX64: Q64 * 3n },
      ],
    }),
  ).equals(compositeFeedId),
  false,
);
assert.equal(
  Buffer.from(
    deriveCompositeFeedId({
      ...compositeConfigArgs,
      creator: testPublicKey(239).toBytes(),
    }),
  ).equals(compositeFeedId),
  false,
);
assert.throws(
  () =>
    deriveCompositeFeedId({
      ...compositeConfigArgs,
      components: [],
    }),
  /InvalidCompositeComponentCount/,
);
assert.throws(
  () =>
    deriveCompositeFeedId({
      ...compositeConfigArgs,
      components: [compositeComponents[0], compositeComponents[0]],
    }),
  /DuplicateCompositeComponent/,
);
assert.throws(
  () =>
    deriveCompositeFeedId({
      ...compositeConfigArgs,
      components: [
        compositeComponents[0],
        { ...compositeComponents[1], quantityX64: 0n },
      ],
    }),
  /InvalidCompositeQuantity/,
);
const compositeHeader = encodeCompositeFeedConfigHeader(compositeConfigArgs);
assert.equal(compositeHeader.length, COMPOSITE_FEED_CONFIG_HEADER_LEN);
assert.equal(
  compositeHeader
    .subarray(COMPOSITE_CONFIG_OFFSETS.magic, COMPOSITE_CONFIG_OFFSETS.magic + 8)
    .equals(COMPOSITE_FEED_CONFIG_MAGIC),
  true,
);
const toCompositeV1 = (prefix: Buffer) => {
  const data = Buffer.alloc(661, 44);
  prefix.copy(data);
  data.writeUInt16LE(1, COMPOSITE_CONFIG_OFFSETS.version);
  data.writeUInt16LE(661, COMPOSITE_CONFIG_OFFSETS.headerLen);
  return data;
};
assert.throws(() => decodeCompositeFeedConfigHeader(compositeHeader), /InvalidAccountData/);
assert.throws(() => decodeCompositeFeedConfigHeader(toCompositeV1(compositeHeader).fill(0, 629)), /InvalidCompositeFeed/);
assert.throws(() => {
  const v0 = toCompositeV1(compositeHeader); v0.writeUInt16LE(0, COMPOSITE_CONFIG_OFFSETS.version);
  decodeCompositeFeedConfigHeader(v0);
}, /UnsupportedVersion/);
const decodedCompositeConfig =
  decodeCompositeFeedConfigHeader(toCompositeV1(compositeHeader));
assert.equal(
  Buffer.from(decodedCompositeConfig.compositeFeedId).equals(compositeFeedId),
  true,
);
assert.equal(decodedCompositeConfig.componentCount, 2);
assert.equal(decodedCompositeConfig.components[1].quantityX64, Q64 * 2n);
assert.equal(decodedCompositeConfig.routeabilityCap, RouteabilityStatus.SafetyOnly);
assert.equal(decodedCompositeConfig.riskTier, RiskTier.Unrated);
const oneComponentCompositeHeader = encodeCompositeFeedConfigHeader(
  oneComponentCompositeConfigArgs,
);
const decodedOneComponentCompositeConfig = decodeCompositeFeedConfigHeader(
  toCompositeV1(oneComponentCompositeHeader),
);
assert.equal(decodedOneComponentCompositeConfig.componentCount, 1);
assert.equal(
  Buffer.from(decodedOneComponentCompositeConfig.components[0].feedId).equals(
    compositeComponentFeedIdA,
  ),
  true,
);
assert.throws(
  () => {
    const invalid = Buffer.from(compositeHeader);
    invalid[COMPOSITE_CONFIG_OFFSETS.routeabilityCap] = RouteabilityStatus.Disabled;
    decodeCompositeFeedConfigHeader(toCompositeV1(invalid));
  },
  /InvalidCompositeFeed/,
);

const [compositeFeedConfig] = findCompositeFeedConfigPda(compositeFeedId);
const [compositeSnapshot] = findCompositeSnapshotPda(compositeFeedId);
const [compositeFeeVault] = findFeedFeeVaultPda(compositeFeedId);
const [compositeFeedCollateralLock] = findFeedCollateralLockPda(compositeFeedId);
const [oneComponentCompositeFeedConfig] = findCompositeFeedConfigPda(
  oneComponentCompositeFeedId,
);

const compositeSnapshotHeader = Buffer.alloc(COMPOSITE_SNAPSHOT_HEADER_LEN);
COMPOSITE_SNAPSHOT_MAGIC.copy(
  compositeSnapshotHeader,
  COMPOSITE_SNAPSHOT_OFFSETS.magic,
);
compositeSnapshotHeader.writeUInt16LE(0, COMPOSITE_SNAPSHOT_OFFSETS.version);
compositeSnapshotHeader.writeUInt16LE(
  COMPOSITE_SNAPSHOT_HEADER_LEN,
  COMPOSITE_SNAPSHOT_OFFSETS.headerLen,
);
Buffer.from(compositeFeedId).copy(
  compositeSnapshotHeader,
  COMPOSITE_SNAPSHOT_OFFSETS.feedId,
);
compositeFeedConfig.toBuffer().copy(
  compositeSnapshotHeader,
  COMPOSITE_SNAPSHOT_OFFSETS.compositeConfig,
);
compositeSnapshotHeader.writeBigUInt64LE(1n, COMPOSITE_SNAPSHOT_OFFSETS.registryEpoch);
compositeSnapshotHeader.writeBigUInt64LE(1n, COMPOSITE_SNAPSHOT_OFFSETS.configRevision);
compositeSnapshotHeader.writeBigUInt64LE(1n, COMPOSITE_SNAPSHOT_OFFSETS.snapshotRevision);
compositeSnapshotHeader[COMPOSITE_SNAPSHOT_OFFSETS.status] = SnapshotStatus.Fresh;
compositeSnapshotHeader[COMPOSITE_SNAPSHOT_OFFSETS.routeabilityStatus] =
  RouteabilityStatus.SafetyOnly;
compositeSnapshotHeader[COMPOSITE_SNAPSHOT_OFFSETS.riskTier] = RiskTier.Unrated;
compositeSnapshotHeader[COMPOSITE_SNAPSHOT_OFFSETS.snapshotSource] =
  SnapshotSource.Composite;
compositeSnapshotHeader[COMPOSITE_SNAPSHOT_OFFSETS.freshnessProfile] =
  FreshnessProfile.Hot0;
compositeSnapshotHeader[COMPOSITE_SNAPSHOT_OFFSETS.componentCount] = 2;
compositeSnapshotHeader[COMPOSITE_SNAPSHOT_OFFSETS.quoteStatus] = QuoteStatus.Ok;
compositeSnapshotHeader.writeBigUInt64LE(100n, COMPOSITE_SNAPSHOT_OFFSETS.snapshotSlot);
compositeSnapshotHeader.writeBigUInt64LE(108n, COMPOSITE_SNAPSHOT_OFFSETS.validUntilSlot);
compositeSnapshotHeader.writeBigInt64LE(
  1_765_000_000n,
  COMPOSITE_SNAPSHOT_OFFSETS.snapshotUnixTs,
);
compositeSnapshotHeader.writeBigUInt64LE(
  99n,
  COMPOSITE_SNAPSHOT_OFFSETS.oldestComponentSnapshotSlot,
);
compositeSnapshotHeader.writeBigUInt64LE(
  98n,
  COMPOSITE_SNAPSHOT_OFFSETS.oldestComponentActivitySlot,
);
compositeSnapshotHeader.writeBigUInt64LE(3_000_000n, COMPOSITE_SNAPSHOT_OFFSETS.priceMantissa);
compositeSnapshotHeader.writeInt32LE(-6, COMPOSITE_SNAPSHOT_OFFSETS.priceExponent);
compositeSnapshotHeader.writeUInt16LE(100, COMPOSITE_SNAPSHOT_OFFSETS.confidenceBps);
compositeSnapshotHeader.writeUInt16LE(150, COMPOSITE_SNAPSHOT_OFFSETS.dispersionBps);
writeTestU128(compositeSnapshotHeader, COMPOSITE_SNAPSHOT_OFFSETS.priceX64, Q64 * 3n);
writeTestU128(compositeSnapshotHeader, COMPOSITE_SNAPSHOT_OFFSETS.priceLowerX64, Q64 * 2n);
writeTestU128(compositeSnapshotHeader, COMPOSITE_SNAPSHOT_OFFSETS.priceUpperX64, Q64 * 4n);
writeTestU128(compositeSnapshotHeader, COMPOSITE_SNAPSHOT_OFFSETS.componentMinCapitalFloor, 1_000n);
writeTestU128(compositeSnapshotHeader, COMPOSITE_SNAPSHOT_OFFSETS.componentMinFeeLossFloor, 2_000n);
compositeComponentSetHash.copy(
  compositeSnapshotHeader,
  COMPOSITE_SNAPSHOT_OFFSETS.componentSetHash,
);
compositeSnapshotHeader[COMPOSITE_SNAPSHOT_OFFSETS.anchorProvider] =
  AnchorProvider.None;
compositeSnapshotHeader[COMPOSITE_SNAPSHOT_OFFSETS.anchorStatus] =
  AnchorStatus.Missing;
const compositeSnapshotComponents = compositeComponents.map((component, index) => ({
  feedId: component.feedId,
  snapshotRevision: BigInt(index + 2),
  snapshotSlot: BigInt(99 + index),
  priceX64: Q64,
  contributionX64: component.quantityX64,
}));
for (let index = 0; index < compositeComponents.length; index += 1) {
  const offset =
    COMPOSITE_SNAPSHOT_OFFSETS.components +
    index * COMPOSITE_SNAPSHOT_COMPONENT_LEN;
  Buffer.from(compositeSnapshotComponents[index].feedId).copy(
    compositeSnapshotHeader,
    offset + COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.feedId,
  );
  compositeSnapshotHeader.writeBigUInt64LE(
    compositeSnapshotComponents[index].snapshotRevision,
    offset + COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.snapshotRevision,
  );
  compositeSnapshotHeader.writeBigUInt64LE(
    compositeSnapshotComponents[index].snapshotSlot,
    offset + COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.snapshotSlot,
  );
  writeTestU128(
    compositeSnapshotHeader,
    offset + COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.priceX64,
    compositeSnapshotComponents[index].priceX64,
  );
  writeTestU128(
    compositeSnapshotHeader,
    offset + COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.contributionX64,
    compositeSnapshotComponents[index].contributionX64,
  );
}
const compositeComponentSnapshotHash = computeCompositeComponentSnapshotHash({
  componentCount: 2,
  components: compositeSnapshotComponents,
});
compositeComponentSnapshotHash.copy(
  compositeSnapshotHeader,
  COMPOSITE_SNAPSHOT_OFFSETS.componentSnapshotHash,
);
const decodedCompositeSnapshot =
  decodeCompositeSnapshotHeader(compositeSnapshotHeader);
assert.deepEqual(
  decodeMimirBrowserCompositeSnapshotHeader(compositeSnapshotHeader),
  decodedCompositeSnapshot,
);
assert.equal(decodedCompositeSnapshot.componentCount, 2);
assert.equal(decodedCompositeSnapshot.snapshotSource, SnapshotSource.Composite);
assert.equal(decodedCompositeSnapshot.priceX64, Q64 * 3n);
assert.equal(decodedCompositeSnapshot.components[1].contributionX64, Q64 * 2n);
const compositeSnapshotAddress = bytesAddress(compositeSnapshot.toBytes());
const compositeSnapshotOwner = bytesAddress(MIMIR_PROGRAM_ID.toBytes());
const compositeSnapshotAccount = {
  address: compositeSnapshotAddress,
  owner: compositeSnapshotOwner,
  executable: false,
  lamports: 1n,
  data: compositeSnapshotHeader,
};
const compositeSnapshotBeforeHash = Buffer.from(compositeSnapshotHeader);
const compositeSemanticHash = await createMimirBetaReconciliationSemanticHash({
  codec: "composite-snapshot-v1",
  address: compositeSnapshotAddress,
  account: compositeSnapshotAccount,
  transactionSlot: 100n,
  blockTime: null,
});
assert.equal(typeof compositeSemanticHash, "string");
assert.deepEqual(compositeSnapshotHeader, compositeSnapshotBeforeHash, "Composite semantic hashing must not mutate Buffer input");
assert.equal(compositeSemanticHash, await createMimirBetaReconciliationSemanticHash({
  codec: "composite-snapshot-v1", address: compositeSnapshotAddress,
  account: { ...compositeSnapshotAccount, data: Uint8Array.from(compositeSnapshotHeader) }, transactionSlot: 100n, blockTime: null,
}), "Composite Buffer and Uint8Array semantic hashes must match");
assert.equal(compositeSemanticHash, await createMimirBetaReconciliationSemanticHash({
  codec: "composite-snapshot-v1", address: compositeSnapshotAddress,
  account: compositeSnapshotAccount, transactionSlot: 100n, blockTime: null,
}), "Composite repeat hash must be stable");
const compositeBacking = Buffer.alloc(compositeSnapshotHeader.length + 8, 0xa5);
compositeSnapshotHeader.copy(compositeBacking, 4); const compositeOffsetView = compositeBacking.subarray(4, -4);
const compositeBackingBeforeHash = Buffer.from(compositeBacking);
assert.equal(compositeSemanticHash, await createMimirBetaReconciliationSemanticHash({
  codec: "composite-snapshot-v1", address: compositeSnapshotAddress,
  account: { ...compositeSnapshotAccount, data: compositeOffsetView }, transactionSlot: 100n, blockTime: null,
}), "Composite offset Buffer view hash must match");
assert.deepEqual(compositeBacking, compositeBackingBeforeHash, "Composite hashing must not mutate offset Buffer backing bytes");
await assert.rejects(
  createMimirBetaReconciliationSemanticHash({
    codec: "composite-snapshot-v1",
    address: compositeSnapshotAddress,
    account: { ...compositeSnapshotAccount, data: Uint8Array.from(compositeSnapshotHeader, (value, index) =>
      index === COMPOSITE_SNAPSHOT_OFFSETS.compositeConfig ? value ^ 1 : value) },
    transactionSlot: 100n,
    blockTime: null,
  }),
  /config PDA is invalid/,
);
const verifiedCompositeSnapshot = verifyCompositeSnapshotAccount({
  snapshot: compositeSnapshot,
  owner: MIMIR_PROGRAM_ID,
  data: compositeSnapshotHeader,
  clockSlot: 104n,
  expectedCompositeFeedId: compositeFeedId,
  config: {
    pubkey: compositeFeedConfig,
    owner: MIMIR_PROGRAM_ID,
    data: toCompositeV1(compositeHeader),
  },
});
assert.equal(verifiedCompositeSnapshot.snapshotRevision, 1n);
assert.throws(
  () => {
    const invalid = Buffer.from(compositeSnapshotHeader);
    invalid[COMPOSITE_SNAPSHOT_OFFSETS.componentSnapshotHash] ^= 1;
    verifyCompositeSnapshotAccount({
      snapshot: compositeSnapshot,
      owner: MIMIR_PROGRAM_ID,
      data: invalid,
      clockSlot: 104n,
    });
  },
  /InvalidCompositeSnapshot/,
);
assert.throws(
  () => {
    const invalid = Buffer.from(compositeSnapshotHeader);
    invalid.writeBigUInt64LE(105n, COMPOSITE_SNAPSHOT_OFFSETS.oldestComponentActivitySlot);
    verifyCompositeSnapshotAccount({
      snapshot: compositeSnapshot,
      owner: MIMIR_PROGRAM_ID,
      data: invalid,
      clockSlot: 104n,
      config: {
        pubkey: compositeFeedConfig,
        owner: MIMIR_PROGRAM_ID,
        data: toCompositeV1(compositeHeader),
      },
    });
  },
  /InvalidCompositeSnapshot/,
);
assert.throws(
  () => {
    const invalid = Buffer.from(compositeSnapshotHeader);
    writeTestU128(
      invalid,
      COMPOSITE_SNAPSHOT_OFFSETS.components +
        COMPOSITE_SNAPSHOT_COMPONENT_LEN +
        COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.contributionX64,
      Q64 * 3n,
    );
    computeCompositeComponentSnapshotHash({
      componentCount: 2,
      components: [
        compositeSnapshotComponents[0],
        {
          ...compositeSnapshotComponents[1],
          contributionX64: Q64 * 3n,
        },
      ],
    }).copy(invalid, COMPOSITE_SNAPSHOT_OFFSETS.componentSnapshotHash);
    verifyCompositeSnapshotAccount({
      snapshot: compositeSnapshot,
      owner: MIMIR_PROGRAM_ID,
      data: invalid,
      clockSlot: 104n,
      config: {
        pubkey: compositeFeedConfig,
        owner: MIMIR_PROGRAM_ID,
        data: toCompositeV1(compositeHeader),
      },
    });
  },
  /InvalidCompositeSnapshot/,
);
assert.throws(
  () => {
    const invalid = Buffer.from(compositeSnapshotHeader);
    writeTestU128(
      invalid,
      COMPOSITE_SNAPSHOT_OFFSETS.components +
        COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.contributionX64,
      Q64 * 2n,
    );
    writeTestU128(
      invalid,
      COMPOSITE_SNAPSHOT_OFFSETS.components +
        COMPOSITE_SNAPSHOT_COMPONENT_LEN +
        COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.contributionX64,
      Q64,
    );
    computeCompositeComponentSnapshotHash({
      componentCount: 2,
      components: [
        {
          ...compositeSnapshotComponents[0],
          contributionX64: Q64 * 2n,
        },
        {
          ...compositeSnapshotComponents[1],
          contributionX64: Q64,
        },
      ],
    }).copy(invalid, COMPOSITE_SNAPSHOT_OFFSETS.componentSnapshotHash);
    verifyCompositeSnapshotAccount({
      snapshot: compositeSnapshot,
      owner: MIMIR_PROGRAM_ID,
      data: invalid,
      clockSlot: 104n,
      config: {
        pubkey: compositeFeedConfig,
        owner: MIMIR_PROGRAM_ID,
        data: toCompositeV1(compositeHeader),
      },
    });
  },
  /InvalidCompositeSnapshot/,
);
assert.throws(
  () =>
    verifyCompositeSnapshotAccount({
      snapshot: compositeSnapshot,
      owner: MIMIR_PROGRAM_ID,
      data: compositeSnapshotHeader,
      clockSlot: 109n,
    }),
  /StaleCompositeSnapshot/,
);
assert.throws(
  () => {
    const invalid = Buffer.from(compositeSnapshotHeader);
    invalid[COMPOSITE_SNAPSHOT_OFFSETS.snapshotSource] = SnapshotSource.Deep;
    decodeCompositeSnapshotHeader(invalid);
  },
  /InvalidCompositeSnapshot/,
);
assert.throws(
  () => {
    const invalid = Buffer.from(compositeSnapshotHeader);
    invalid[COMPOSITE_SNAPSHOT_OFFSETS.riskTier] = RiskTier.TierC;
    decodeCompositeSnapshotHeader(invalid);
  },
  /InvalidCompositeSnapshot/,
);
assert.throws(
  () => {
    const invalid = Buffer.from(compositeSnapshotHeader);
    invalid[COMPOSITE_SNAPSHOT_OFFSETS.routeabilityStatus] =
      RouteabilityStatus.TierB;
    decodeCompositeSnapshotHeader(invalid);
  },
  /InvalidCompositeSnapshot/,
);

const governedRegistry = upsertRegistryInstruction({
  payer: payer.publicKey,
  authority: TEST_GOVERNANCE_AUTHORITY,
  registry,
  registryHeader: buildTestOracleRegistryHeader(),
});
assert.equal(governedRegistry.data.length, 129);
assert.equal(governedRegistry.data[0], 19);
assert.equal(governedRegistry.keys.length, 4);
assert.equal(governedRegistry.keys[0].isSigner, true);
assert.equal(governedRegistry.keys[0].isWritable, true);
assert.equal(governedRegistry.keys[1].isSigner, true);
assert.equal(governedRegistry.keys[1].isWritable, false);
assert.equal(governedRegistry.keys[2].pubkey.equals(registry), true);
assert.equal(governedRegistry.keys[2].isWritable, true);
const riskRaiseRegistry = upsertRegistryInstruction({
  payer: payer.publicKey,
  authority: TEST_GOVERNANCE_AUTHORITY,
  registry,
  registryHeader: registryRiskRaise,
  governancePolicy,
  governanceAction,
});
assert.equal(riskRaiseRegistry.keys.length, 6);
assert.equal(riskRaiseRegistry.keys[4].pubkey.equals(governancePolicy), true);
assert.equal(riskRaiseRegistry.keys[4].isWritable, false);
assert.equal(riskRaiseRegistry.keys[5].pubkey.equals(governanceAction), true);
assert.equal(riskRaiseRegistry.keys[5].isWritable, false);
assert.throws(
  () =>
    upsertRegistryInstruction({
      payer: payer.publicKey,
      authority: TEST_GOVERNANCE_AUTHORITY,
      registry,
      registryHeader: buildTestOracleRegistryHeader().subarray(0, 127),
    }),
  /InvalidRegistryHeaderLength/,
);
assert.throws(
  () =>
    upsertRegistryInstruction({
      payer: payer.publicKey,
      authority: TEST_GOVERNANCE_AUTHORITY,
      registry,
      registryHeader: buildTestOracleRegistryHeader(),
      governancePolicy,
    }),
  /IncompleteGovernanceAction/,
);

const upsertPolicy = upsertGovernancePolicyInstruction({
  payer: payer.publicKey,
  authority: TEST_GOVERNANCE_AUTHORITY,
  policy: governancePolicy,
  policyHeader: buildTestGovernancePolicyHeader(),
});
assert.equal(upsertPolicy.data.length, 225);
assert.equal(upsertPolicy.data[0], 32);
assert.equal(upsertPolicy.keys.length, 4);
assert.equal(upsertPolicy.keys[2].pubkey.equals(governancePolicy), true);
assert.equal(upsertPolicy.keys[2].isWritable, true);
const governedUpsertPolicy = upsertGovernancePolicyInstruction({
  payer: payer.publicKey,
  authority: TEST_GOVERNANCE_AUTHORITY,
  policy: governancePolicy,
  policyHeader: rotatedPolicyHeader,
  governanceAction,
});
assert.equal(governedUpsertPolicy.keys.length, 5);
assert.equal(governedUpsertPolicy.keys[4].pubkey.equals(governanceAction), true);
assert.equal(governedUpsertPolicy.keys[4].isWritable, false);

const createAction = createGovernanceActionInstruction({
  payer: payer.publicKey,
  proposer: TEST_GOVERNANCE_AUTHORITY,
  policy: governancePolicy,
  action: governanceAction,
  actionHeader: buildTestGovernanceActionHeader(governanceActionHash, 100n),
});
assert.equal(createAction.data.length, 193);
assert.equal(createAction.data[0], 33);
assert.equal(createAction.keys.length, 5);
assert.equal(createAction.keys[2].pubkey.equals(governancePolicy), true);
assert.equal(createAction.keys[2].isWritable, false);
assert.equal(createAction.keys[3].pubkey.equals(governanceAction), true);
assert.equal(createAction.keys[3].isWritable, true);

const approveAction = approveGovernanceActionInstruction({
  signer: TEST_GOVERNANCE_SIGNER_1,
  policy: governancePolicy,
  action: governanceAction,
  actionHash: governanceActionHash,
  expectedActionRevision: 1n,
});
assert.equal(approveAction.data.length, 41);
assert.equal(approveAction.data[0], 34);
assert.equal(approveAction.keys.length, 3);
assert.equal(approveAction.keys[2].isWritable, true);

const upsertTwap = createLocalnetFixtureUpsertFeedTwapInstruction({
  payer: payer.publicKey,
  feedTwap,
  feedTwapHeader: buildTestFeedTwapStateHeader(),
  cluster: "localnet",
});
assert.equal(upsertTwap.data.length, 1 + FEED_TWAP_HEADER_LEN);
assert.equal(upsertTwap.keys.length, 3);
assert.equal(upsertTwap.keys[0].isSigner, true);
assert.equal(upsertTwap.keys[1].isWritable, true);

const upsertRegistry = createLocalnetFixtureUpsertRegistryInstruction({
  payer: payer.publicKey,
  registry,
  registryHeader: buildTestOracleRegistryHeader(),
  cluster: "localnet",
});
assert.equal(upsertRegistry.data.length, 129);
assert.equal(upsertRegistry.keys.length, 3);
assert.equal(upsertRegistry.keys[0].isSigner, true);
assert.equal(upsertRegistry.keys[1].isWritable, true);

const upsertPlan = createLocalnetFixtureUpsertSourcingPlanInstruction({
  payer: payer.publicKey,
  sourcingPlan,
  sourcingPlanHeader: buildTestSourcingPlanHeader(),
  cluster: "localnet",
});
assert.equal(upsertPlan.data.length, 321);
assert.equal(upsertPlan.keys.length, 3);
assert.equal(upsertPlan.keys[0].isSigner, true);
assert.equal(upsertPlan.keys[1].isWritable, true);

const upsertSourceConfig = createLocalnetFixtureUpsertSourceConfigInstruction({
  payer: payer.publicKey,
  sourceConfig,
  sourceConfigHeader: buildTestSourceConfigHeader(),
  cluster: "localnet",
});
assert.equal(upsertSourceConfig.data.length, 385);
assert.equal(upsertSourceConfig.keys.length, 3);
assert.equal(upsertSourceConfig.keys[0].isSigner, true);
assert.equal(upsertSourceConfig.keys[1].isWritable, true);

{
  const localnet = JSON.parse(readFileSync(new URL("./fixtures/localnet-composite-accounts.json", import.meta.url), "utf8")) as
    Record<string, { address: string; owner: string; dataBase64: string }>;
  const account = (name: string) => ({ pubkey: new PublicKey(localnet[name]!.address), owner: new PublicKey(localnet[name]!.owner),
    data: new Uint8Array(Buffer.from(localnet[name]!.dataBase64, "base64")) });
  const localnetProgramId = account("N003_composite_config").owner;
  for (const [name, ticker] of [["N003_composite_config", "N003"], ["N1_composite_config", "N1"], ["N189B04_composite_config", "N189B04"]] as const) {
    const config = account(name);
    assert.equal(config.data[12], 1);
    assert.equal(decodeCompositeFeedConfigHeader(config.data, localnetProgramId).ticker, ticker);
  }
  const config = account("N003_composite_config");
  const snapshot = account("N003_composite_snapshot");
  const verified = verifyCompositeSnapshotAccount({ snapshot: snapshot.pubkey, owner: snapshot.owner, data: snapshot.data,
    clockSlot: 451_988_102n + 100n, config, programId: localnetProgramId });
  assert.equal(verified.snapshotSlot, 451_988_102n);
  assert.throws(() => verifyCompositeSnapshotAccount({ snapshot: snapshot.pubkey, owner: snapshot.owner, data: snapshot.data,
    clockSlot: verified.validUntilSlot + 1n, config, programId: localnetProgramId }), /StaleCompositeSnapshot/);
  const unknownFlag = config.data.slice();
  unknownFlag[12] = 3;
  assert.throws(() => decodeCompositeFeedConfigHeader(unknownFlag, localnetProgramId), /InvalidCompositeFeed/);
  const clearedWithTicker = config.data.slice();
  clearedWithTicker[12] = 0;
  assert.throws(() => decodeCompositeFeedConfigHeader(clearedWithTicker, localnetProgramId), /InvalidCompositeFeed/);
  clearedWithTicker.fill(0, 185, 197);
  assert.equal(decodeCompositeFeedConfigHeader(clearedWithTicker, localnetProgramId).ticker, null);
  const badTicker = config.data.slice();
  badTicker[186] = 0x61;
  assert.throws(() => decodeCompositeFeedConfigHeader(badTicker, localnetProgramId), /InvalidCompositeFeed/);
}

{
  const treasuryProgram = new PublicKey("TYo5SEVfHyFzpjsbFVzNFKTnmLdBvdYjLxmnv32iQ9r");
  const [treasury, treasuryBump] = findProtocolTreasuryPda(treasuryProgram);
  assert.equal(treasury.toBase58(), "761WAwLBaWC5WSNmp8HrpBsMAhc8B3E2ke3zFAUKbYRZ");
  assert.equal(treasuryBump, 253);
  assert.deepEqual([...encodeWithdrawProtocolTreasuryV1Data(0x0102030405060708n)], [84, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.throws(() => encodeWithdrawProtocolTreasuryV1Data(0n), /InvalidWithdrawAmount/);
  assert.throws(() => encodeWithdrawProtocolTreasuryV1Data(1n << 64n), /InvalidWithdrawAmount/);
  const governance = new PublicKey(Buffer.alloc(32, 21));
  const adminConfig = findAdminConfigPda(1, treasuryProgram)[0];
  const withdraw = createWithdrawProtocolTreasuryV1Instruction({
    governanceAuthority: governance, adminConfig, protocolTreasury: treasury, amountLamports: 5n, programId: treasuryProgram,
  });
  assert.ok(withdraw.programId.equals(treasuryProgram));
  assert.deepEqual([...withdraw.data], [84, 5, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(withdraw.keys.map(({ pubkey, isSigner, isWritable }) => [pubkey.toBase58(), isSigner, isWritable]), [
    [governance.toBase58(), true, true],
    [adminConfig.toBase58(), false, false],
    [treasury.toBase58(), false, true],
    ["11111111111111111111111111111111", false, false],
  ]);
  assert.throws(() => createWithdrawProtocolTreasuryV1Instruction({
    governanceAuthority: governance, adminConfig, protocolTreasury: governance, amountLamports: 5n, programId: treasuryProgram,
  }), /InvalidProtocolTreasuryAddress/);
  const zeroEmergency = decodeOracleRegistryHeader(buildTestOracleRegistryHeader((data) => {
    data.fill(0, REGISTRY_OFFSETS.emergencyAuthority, REGISTRY_OFFSETS.emergencyAuthority + 32);
  }));
  assert.ok(Buffer.from(zeroEmergency.emergencyAuthority).equals(Buffer.alloc(32)));
}
import "./compositeConverterTail.test.js";
