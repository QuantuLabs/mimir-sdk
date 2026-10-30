import { admitMimirTxV1Packet, assertMimirAbi1Capable, assertMimirStrictSimulation, mimirCompositeWitnessA2, verifyMimirCuEvidenceA2, type MimirCuEvidenceA2, mimirClassicCellSignature, mimirCompositeCellSignature, preflightMimirConsumerAdmissionV1, type MimirConsumerAdmissionInputsV1, type MimirConsumerAdmissionV1, type MimirAbi1Capability } from "./abi1Release.js";
import { buildMimirFusedCompositeRefreshInstruction, buildMimirInitFusedCompositeClosure, deriveMimirCompositeExecutionAddress,
  mimirCompositeExecutionLayout, mimirFusedRecipeNeedsWarmup, mimirFusedRow, type MimirFusedRowSource } from "./compositeExecution.js";
import { buildMimirFusedClassicInstruction, buildMimirInitFusedClassicClosure, decodeMimirClassicExecutionAccount, deriveMimirClassicExecutionAddress, mimirClassicExecutionLayout, mimirClassicMinSources, assertMimirClassicBoundedMajorityPossible, assertMimirClassicConverterAdmitted,
  mimirClassicRow, type MimirClassicExecutionLayout } from "./classicExecution.js";
import { findFreeMimirBetaFeedVariant, isMimirBetaVariantOccupied } from "./pairFeeds.js";
import { address, getProgramDerivedAddress, type Address } from "@solana/kit";
import {
  addressBytes,
  base64,
  bytesAddress,
  bytesEqual,
  canonicalJson,
  fromBase64,
  hex,
  sha256,
  utf8,
} from "./bytes.js";
import {
  buildMimirBetaClassicSourceArtifacts,
  buildMimirBetaIdentityActivationInstruction,
  buildMimirBetaIdentityCompositeInstruction,
  recoverMimirBetaFeedVariantAsync,
  buildMimirBetaIdentityProposalInstruction,
  buildMimirBetaSourceAppendInstruction,
  canonicalizeMimirBetaCompositeComponents,
  canonicalizeMimirBetaTicker,
  computeMimirBetaClassicPlanHash,
  computeMimirBetaTickerTariff,
  deriveMimirBetaCanonicalPdas,
  deriveMimirBetaClassicFeedId,
  deriveMimirBetaFeedPdas,
  deriveMimirBetaPda,
  deriveMimirBetaProposalHash,
  deriveMimirBetaTickerPda,
  encodeMimirBetaTicker,
  encodeMimirBetaProposalSnapshot,
  encodeMimirBetaClassicInitArgs,
  encodeMimirBetaCompositeV1Config,
  mimirBetaHashv,
  type MimirBetaClassicInitArgs,
  type MimirBetaClassicSourceArtifact,
  type MimirBetaPhysicalAccountFact,
} from "./abi.js";
import {
  assertMimirBetaActiveCreationContext,
  assertMimirBetaSourceAdapterVersions,
  decodeMimirBetaAdminContext,
  decodeMimirBetaRegistryContext,
  decodeMimirBetaSplMint,
  decodeMimirBetaSplTokenAccount,
  verifyMimirBetaContextPda,
  type MimirBetaAdminContext,
  type MimirBetaRegistryContext,
  type MimirBetaSplMintContext,
  type MimirBetaSplTokenAccountContext,
} from "./context.js";
import { mimirBetaDlmmRouteableLegacyDepth, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, MIMIR_BETA_TOKEN_2022_PROGRAM_ID } from "./capture.js";
import { classifyToken2022Mint, classifyToken2022PumpSwapMetadataMint, isToken2022ClmmAccountError, isToken2022ClmmPolicyError } from "../token2022Clmm.js";
import type { MimirBetaFacadeDeployment, MimirBetaPlanningRpc } from "./client.js";
import { MIMIR_BETA_SYSTEM_PROGRAM_ID, type MimirBetaDeployment } from "./deployment.js";
import { decodeMimirOneCharAllowance, deriveMimirOneCharAllowancePda, MIMIR_ONE_CHAR_ALLOWANCE_LEN, resolveMimirOneCharAllowance, type MimirOneCharAllowance } from "./oneChar.js";
import { betaError, MimirBetaCallerPrefixError, MimirBetaCollateralRequiredError, MimirBetaCompositeQualityError, MimirBetaConverterIneligibleError, MimirBetaError, MimirBetaIdentityAssetMissingError, MimirBetaPacketRefusalError, MimirBetaSimulationError, mimirBetaSimulationFailure, type MimirBetaCompositeQualityViolation, type MimirBetaFundingCosts } from "./errors.js";
import {
  validateMimirBetaDisplayName,
  type Mimir8004IdentityAdapter,
} from "./identity8004.js";
import { decodeMimirClassicConfig, decodeMimirCompositeConfig, decodeMimirTickerClaim } from "./codecs.js";
import { buildMimirBetaComputeUnitLimitInstruction, decodeMimirBetaLiveFeed, decodeMimirBetaLivePlan, decodeMimirBetaLiveSource } from "./liveAbi.js";
import { MIMIR_NATIVE_CLOCK_ADDRESS, mimirExecutableGenerationPins } from "../internal/nativeMonoRefreshCore.js";
import { mimirBetaCallerPrefixViolationV1 } from "./callerPrefixIsolation.js";
import { compileMimirBetaTransactionV1 } from "./transactionV1.js";
import { quoteTxV1Fee } from "../create/txv1-fee.js";
import { conservativeMintOracleSourceConfigFloor } from "../math.js";
import {
  authenticateMimirBetaReviewedStep,
  createDraftHash,
  createExpectedWritesHash,
  createReviewHash,
  createStepIntentHash,
  reconcileStepReceipts,
  reconcileMimirBetaConfirmedPreparationReceipts,
  type MimirBetaCallerPrefixReview,
  type MimirBetaConfirmedObservation,
  type MimirBetaCreationReviewV1,
  type MimirBetaExpectedWrite,
  type MimirBetaPlanStep,
  type MimirBetaPreparedCreation,
  type MimirBetaFusedCompositeCreation,
  type MimirBetaVisibleDlmmLeg,
  type MimirBetaPreparedStep,
  type MimirBetaRenewalWitness,
  type MimirBetaOneCharTransitionEvidence,
  type MimirBetaReconciliationCodec,
  type MimirBetaSampledTransitionEvidence,
  type MimirBetaStageReceipt,
  type MimirBetaStepId,
  type MimirBetaUnsignedPlan,
  type ReconciliationObservation,
  isMimirV1FirstPriceSuffix,
} from "./review.js";
import {
  assertMimirBetaNativeRefreshTrios,
  createMimirBetaReconciliationSemanticHash,
  fingerprintMimirBetaAccount,
  observeMimirBetaConfirmedReceiptChain,
  observeMimirBetaReceiptChain,
  sharedAccountRole,
} from "./reconciliation.js";
import { decodeMimirBetaRpcAccount, decodeMimirBetaSignatureStatusResponse, FinalizedRpcReader } from "./rpc.js";
import type { MimirBetaReconciliationRpc } from "./rpc.js";
import { collectionBaseEnd, decodeMimirBetaCoreAsset, decodeMimirBetaCoreCollection } from "./mplCore.js";
import type { MimirBetaAccount, MimirBetaInstruction, MimirBetaSourceFamily } from "./types.js";
import { mimirBetaEligiblePoolConditions, withMimirBetaPoolBindingVariant, type MimirBetaEligiblePool, type MimirBetaPoolCreationBinding,
  type MimirBetaPoolDiscovery } from "./discovery.js";
import { MIMIR_COND } from "../liveness.js";
import { freshDynamicAccounts, freshAdapterAccounts, loadMimirBetaExistingLiveFeed, mimirClassicNativeAdmitted, mimirDlmmPointPreflight, mimirClassicNativeRowReadiness, mimirClassicNativeTail,
  MimirClassicNativeNotReadyError, mimirAuthenticClockUnix, type MimirClassicRowRecipe, isMimirClassicIntervalRecipe, mimirClassicIntervalRow,
  mimirClassicIntervalPins, assertMimirClassicIntervalGeneration, assertMimirClassicDammRecipePolicy, mimirClassicOrcaMarkerReadiness, type MimirClassicIntervalRecipe,
  mimirDlmmRouteableEdgeArrays, evaluateMimirBetaConverterLegs, mimirDlmmPointAdmitted, mimirDlmmPointTemporal, mimirClassicDualAdmitted, type MimirBetaConverterEligibility, mimirClassicNativeRebuild, type MimirClassicNativeReadiness,
  type MimirClassicNativeRebuildState, proveMimirBetaPreparationDrift } from "./live.js";
import { canonicalAddress } from "../internal/canonicalAuthority.js";
import { initialMimirSampledReadiness } from "../internal/sampledTemporalCore.js";
import { mimirCurrentPointAdmitted, type MimirTemporalMode } from "../internal/currentPointCore.js";
import { sampledModuleSpecs } from "./sampledModuleReview.js";
import { computeMimirRentExemptLamports, readMimirRentSysvar } from "./rent.js";

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
/** beta program only */
const COMPOSITE_ACTIVATION_OWNER_FEE_LAMPORTS = 800_000n;
/** beta program only */
const COMPOSITE_ACTIVATION_TREASURY_FEE_LAMPORTS = 700_000n;
/** beta program only */
const COMPOSITE_ACTIVATION_CREATION_FEE_LAMPORTS = 1_000_000n;
const MIMIR_BETA_PUMPSWAP_BOOST_MAX_DRIFT_BPS = 50n;
const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = address(canonicalAddress("SPL_ASSOCIATED_TOKEN"));


/** Typed refusal of a staged creation packet that does not fit one Transaction v1, with the roles that limit it. */
export function mimirClassicSnapshotCodec(nativeTails: readonly unknown[], intervals: readonly unknown[], duals: readonly boolean[] = []) {
  return duals.some(Boolean) ? "dual-feed-snapshot-v5" as const : nativeTails.some(Boolean) || intervals.some(Boolean) ? "bounded-feed-snapshot-v5" as const : "feed-snapshot-v0" as const;
}

export async function mimirBetaPacketRefusal(stage: MimirBetaPacketRefusalError["stage"], payer: Address,
  instructions: readonly MimirBetaInstruction[], roles: Readonly<Record<string, readonly Address[]>>, error: Error): Promise<MimirBetaPacketRefusalError> {
  const admission = await admitMimirTxV1Packet({ payer, instructions, cu: null, roles });
  return new MimirBetaPacketRefusalError(stage, admission.limitingRoles, `staged ${stage.startsWith("classic") ? "Classic" : "Composite"} ${stage} ` +
    `does not fit one Transaction v1 (${admission.keys} keys, ${admission.bytes ?? "?"} bytes): ${error.message}` +
    (stage === "composite:publish" ? "; every refresh of this composite needs that standalone tag-87 publication, so it cannot be created" : ""));
}

export const MIMIR_BETA_AGENT_URI_MAX_UTF8_BYTES = 54;

export interface MimirBetaIdentityDraft {
  readonly asset: Address;
  readonly agentUri: string;
}

export interface MimirBetaResumeInput {
  readonly receipts?: readonly MimirBetaStageReceipt[];
  readonly observations?: readonly ReconciliationObservation[];
  readonly preserveDraftPoolEvidence?: boolean;
  readonly allowCollateralFunding?: boolean;
  readonly estimateFundingCosts?: boolean;
  readonly fullCollateralPurchase?: boolean;
  /** Classic only: caller-owned instructions compiled ahead of the activation in the same atomic transaction. */
  readonly callerPrefix?: MimirBetaCallerPrefix;
}

/**
 * Caller-owned instructions (for example a purchase that funds the burn) leading one Classic activation in a single transaction. Signed by the
 * authority alone, isolated from the core, and refused with `MimirBetaCallerPrefixError` (or `TRANSACTION_TOO_LARGE`) whenever it cannot lead it.
 */
export interface MimirBetaCallerPrefix {
  readonly instructions: readonly MimirBetaInstruction[];
  /** The prefix credits at least `minimumCreditRaw` to the burn source `tokenAccount`; `coversBurn` asserts that credit alone pays the burn. */
  readonly funding?: Readonly<{ tokenAccount: Address; minimumCreditRaw: bigint; coversBurn?: boolean }>;
  /** Authority-owned token accounts the prefix writes that a wallet token-account guard may target, beside the burn source. */
  readonly guardTokenAccounts?: readonly Address[];
  /** Most lamports the prefix may take from the authority beyond the reviewed core debit and the network fee. */
  readonly maxAuthorityDebitLamports: bigint;
}

export interface MimirBetaClassicPolicy {
  /** Creation depth fraction in basis points (1..10000); defaults to 900 (9%). */
  readonly depthFloorBps?: number;
  readonly profile: number;
  readonly riskTier: number;
  readonly priceExponent: number;
  readonly maxDispersionBps: number;
  readonly maxSourceActivityAgeSlots: number;
  readonly minCoverageRatioBps: number;
  readonly maxConfidenceBps: number;
  readonly maxSnapshotAgeSlots: number;
  readonly anchorPolicyHash: Uint8Array;
  readonly nativeExceptionHash: Uint8Array;
}

export interface PrepareSimpleFeedArgs extends MimirBetaResumeInput {
  readonly ticker: string;
  readonly authority: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly pools: readonly MimirBetaEligiblePool[];
  readonly identity: MimirBetaIdentityDraft;
  readonly creatorCollateralTokenAccount: Address;
  readonly policy: MimirBetaClassicPolicy;
  /**
   * Point profile for AMMv4/PumpSwap sources; other families keep their current behavior. Omitted on a fresh creation with an admitted
   * point source resolves to `"current-point"` (returned as `temporalMode`); a resume must pass its bound mode.
   */
  readonly temporalMode?: MimirTemporalMode;
  /** Feed variant: omitted means 0; `"new"` draws a free variant and is accepted only before any receipt. */
  readonly variant?: number | "new";
  /** Frozen id from a prior preparation; must equal the variant's derivation. */
  readonly feedId?: Address;
  /** SourceConfig0 of an existing SOL/USDC classic feed embedded as the private converter (`S>0`); SOL-quoted feeds only. */
  readonly solConversionSourceConfig?: Address;
  /**
   * Per-pool classic recipe: omitted or `null` means `"spot"` (CPMM included); `"native-bounded"`
   * only for CLMM, CPMM and DLMM and requires ready native history (refused before any payment when not ready);
   * a mode-3 arm (`"cpmm-quiet-interval-v2"`, `"orca-marker-quiet"`, `"damm-onlyb-interval-v1"`, `"damm-reserve-interval-v3"`) only for its v0 family.
   */
  readonly recipes?: readonly (MimirClassicRowRecipe | null)[];
}

export interface MimirBetaCompositeComponentInput {
  readonly feedId: Address;
  readonly sourceConfig: Address;
  readonly quantityX64: bigint;
  readonly createClassic?: Readonly<{
    baseMint: Address;
    ticker: string;
    pool: MimirBetaEligiblePool;
    identity: MimirBetaIdentityDraft;
    policy: MimirBetaClassicPolicy;
    /** Numeric feed variant; omitted means 0. */
    variant?: number;
    /** Same as the standalone Classic `temporalMode`. */
    temporalMode?: MimirTemporalMode;
  }>;
}

export interface MimirBetaCompositePolicy {
  readonly priceExponent: number;
  readonly maxSnapshotAgeSlots: number;
  readonly maxComponentSnapshotAgeSlots: number;
  readonly maxComponentConfidenceBps: number;
  readonly maxComponentDispersionBps: number;
}

export interface PrepareCompositeFeedArgs extends MimirBetaResumeInput {
  readonly ticker: string;
  readonly authority: Address;
  readonly displayName: string;
  readonly quoteMint: Address;
  readonly components: readonly MimirBetaCompositeComponentInput[];
  readonly solConversionSourceConfig?: Address;
  readonly identity: MimirBetaIdentityDraft;
  readonly creatorCollateralTokenAccount: Address;
  readonly policy: MimirBetaCompositePolicy;
  /**
   * Row recipe per component, index-aligned with `components`: omitted or `null` keeps the source's default row; `"spot"`, `"native-bounded"`
   * or a mode-3 arm selects that row explicitly, including for a `createClassic` input. Sampled and point rows follow their source.
   */
  readonly componentRecipes?: readonly (MimirClassicRowRecipe | null)[];
  /** Row recipe per SOL-conversion source row, in its SourceConfig order; same meaning as `componentRecipes`. */
  readonly converterRecipes?: readonly (MimirClassicRowRecipe | null)[];
  /**
   * Explicit staged launch: `composite:activate`, then the indivisible tag-88 closure alone (`composite:init`), then the first tag 87
   * (`composite:publish`, omitted when no first tag 87 is due). Omitted keeps the automatic fused or two-transaction launch.
   */
  readonly stagedExecution?: boolean;
}


interface CreationDependencies {
  readonly deployment: MimirBetaFacadeDeployment;
  readonly rpc: MimirBetaPlanningRpc;
  readonly discovery: MimirBetaPoolDiscovery;
  readonly identity: Mimir8004IdentityAdapter;
  /** Verified ABI-1 capability; required off localnet before any tag-87/88 producer is prepared. */
  readonly abi1Capability?: MimirAbi1Capability;
  /** Opt-in pinned release recipe scope (`RELEASE_SCOPE_UNSUPPORTED`), enforced on every cluster including localnet. */
  readonly abi1ReleaseRecipeScope?: boolean;
  /** Consumer budget contract; every prepared fused Classic and Composite creation carries `consumerAdmission` (fails closed without it). */
  readonly consumerAdmission?: MimirConsumerAdmissionInputsV1;
}

const confirmedPreparation = new WeakMap<MimirBetaPlanningRpc, readonly MimirBetaConfirmedObservation[]>();

function reconcileCreation(dependencies: CreationDependencies, args: Parameters<typeof reconcileStepReceipts>[0]) {
  const observations = confirmedPreparation.get(dependencies.rpc);
  return observations ? reconcileMimirBetaConfirmedPreparationReceipts({ ...args, observations }) : reconcileStepReceipts(args);
}

interface GlobalContext {
  readonly slot: bigint;
  readonly registry: MimirBetaRegistryContext;
  readonly admin: MimirBetaAdminContext;
  readonly accounts: ReadonlyMap<Address, MimirBetaAccount>;
  readonly captureAccounts: ReadonlyMap<Address, MimirBetaAccount | null>;
  readonly quoteMint: MimirBetaSplMintContext;
  readonly baseMint: MimirBetaSplMintContext | null;
  readonly collateralAccount: MimirBetaSplTokenAccountContext | null;
  readonly collateralMint: MimirBetaSplMintContext | null;
  readonly oneCharAllowance: (MimirOneCharAllowance & { readonly address: Address; readonly exists: boolean }) | null;
}

const ONE_CHAR_SPEND_DESCRIPTION = "consume one-character ticker allowance";

function isOneCharTicker(ticker: string): boolean {
  return canonicalizeMimirBetaTicker(ticker).length === 1;
}

function requireOneCharAllowance(context: GlobalContext, required: number): void {
  const allowance = context.oneCharAllowance ?? betaError("CREATION_CONTEXT_REQUIRED", "one-character allowance context missing");
  if (allowance.remaining < BigInt(required)) {
    betaError("ONE_CHAR_ALLOWANCE_REQUIRED", `one-character ticker requires ${required} allowance, wallet has ${allowance.remaining}`,
      allowance.address);
  }
}

function oneCharAllowanceTransition(allowance: Address, programId: Address): ExpectedTransitionSpec {
  return accountTransition(allowance, "write", programId, MIMIR_ONE_CHAR_ALLOWANCE_LEN, ONE_CHAR_SPEND_DESCRIPTION, "one-char-allowance-v1");
}

type ExpectedAccountDataLength = number | readonly number[] | null;

type ExpectedTransitionSpec =
  | Readonly<{
      kind: "account";
      address: Address;
      transition: "create" | "write" | "close";
      ownerAfter: Address | null;
      dataLengthAfter: ExpectedAccountDataLength;
      description: string;
      codec?: MimirBetaReconciliationCodec;
      sampledTransition?: MimirBetaSampledTransitionEvidence;
    }>
  | Readonly<{
      kind: "spl-token-burn-checked";
      address: Address;
      tokenProgram: Address;
      mint: Address;
      authority: Address;
      amountRaw: bigint;
      decimals: number;
      outerInstructionIndex: number;
      description: string;
    }>;

function requiredObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) betaError("CREATION_CONTEXT_REQUIRED", `${label} is required`);
}

function validateCommonInput(args: PrepareSimpleFeedArgs | PrepareCompositeFeedArgs): void {
  requiredObject(args, "creation arguments");
  if (args.callerPrefix !== undefined && "components" in args) betaError("INVALID_ARGUMENT", "callerPrefix leads only a Classic activation");
  requiredObject(args.identity, "identity");
  requiredObject(args.policy, "policy");
  if (args.preserveDraftPoolEvidence !== undefined && typeof args.preserveDraftPoolEvidence !== "boolean") {
    betaError("INVALID_ARGUMENT", "preserveDraftPoolEvidence must be boolean");
  }
  if (args.allowCollateralFunding !== undefined && typeof args.allowCollateralFunding !== "boolean") {
    betaError("INVALID_ARGUMENT", "allowCollateralFunding must be boolean");
  }
  if (args.estimateFundingCosts !== undefined && typeof args.estimateFundingCosts !== "boolean") {
    betaError("INVALID_ARGUMENT", "estimateFundingCosts must be boolean");
  }
  if (args.estimateFundingCosts && !args.allowCollateralFunding) {
    betaError("INVALID_ARGUMENT", "estimateFundingCosts requires allowCollateralFunding=true");
  }
  if (args.fullCollateralPurchase !== undefined && typeof args.fullCollateralPurchase !== "boolean") {
    betaError("INVALID_ARGUMENT", "fullCollateralPurchase must be boolean");
  }
  if (args.fullCollateralPurchase && !args.allowCollateralFunding) {
    betaError("INVALID_ARGUMENT", "fullCollateralPurchase requires allowCollateralFunding=true");
  }
  if (!args.authority || !args.identity.asset || typeof args.identity.agentUri !== "string" ||
    !args.creatorCollateralTokenAccount) {
    betaError("CREATION_CONTEXT_REQUIRED", "identity, collateral, and policy fields are required");
  }
  if (args.identity.agentUri.trim() !== args.identity.agentUri ||
    utf8(args.identity.agentUri).length > MIMIR_BETA_AGENT_URI_MAX_UTF8_BYTES) {
    betaError("INVALID_ARGUMENT",
      `agent URI must be canonical and at most ${MIMIR_BETA_AGENT_URI_MAX_UTF8_BYTES} UTF-8 bytes`);
  }
  encodeMimirBetaTicker(args.ticker);
}

function validateCallerPrefix(prefix: MimirBetaCallerPrefix | undefined): void {
  if (prefix === undefined) return;
  const u64 = (value: unknown) => typeof value === "bigint" && value >= 0n && value <= U64_MAX;
  const guards = prefix?.guardTokenAccounts;
  if (!prefix || typeof prefix !== "object" || !Array.isArray(prefix.instructions) || prefix.instructions.length === 0 ||
    prefix.instructions.some((instruction) => !instruction || typeof instruction.programAddress !== "string" || !(instruction.data instanceof Uint8Array) ||
      !Array.isArray(instruction.accounts) || instruction.accounts.some((account: MimirBetaInstruction["accounts"][number]) => !account || typeof account.address !== "string" ||
        typeof account.isSigner !== "boolean" || typeof account.isWritable !== "boolean")) ||
    !u64(prefix.maxAuthorityDebitLamports) || prefix.funding !== undefined && (!prefix.funding || typeof prefix.funding.tokenAccount !== "string" ||
      !u64(prefix.funding.minimumCreditRaw) || prefix.funding.coversBurn !== undefined && typeof prefix.funding.coversBurn !== "boolean") ||
    guards !== undefined && (!Array.isArray(guards) || guards.some((guard) => typeof guard !== "string") || new Set(guards).size !== guards.length)) {
    betaError("INVALID_ARGUMENT", "callerPrefix is malformed");
  }
}

function requireInteger(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) betaError("INVALID_ARGUMENT", `${label} out of range`);
}

function validateClassicPolicy(policy: MimirBetaClassicPolicy): void {
  if (policy.depthFloorBps !== undefined) requireInteger(policy.depthFloorBps, 1, 10_000, "depth floor bps");
  for (const key of ["profile", "riskTier", "priceExponent", "maxDispersionBps", "maxSourceActivityAgeSlots",
    "minCoverageRatioBps", "maxConfidenceBps", "maxSnapshotAgeSlots"] as const) {
    if (typeof policy[key] !== "number") betaError("CREATION_CONTEXT_REQUIRED", `classic policy ${key} is required`);
  }
  requireInteger(policy.profile, 0, 2, "profile"); requireInteger(policy.riskTier, 1, 3, "risk tier");
  requireInteger(policy.priceExponent, -36, 19, "price exponent"); requireInteger(policy.maxDispersionBps, 1, 10_000, "dispersion");
  requireInteger(policy.maxSourceActivityAgeSlots, 5, 0xffff, "source activity age");
  requireInteger(policy.minCoverageRatioBps, 1, 10_000, "coverage ratio"); requireInteger(policy.maxConfidenceBps, 1, 9_999, "confidence");
  requireInteger(policy.maxSnapshotAgeSlots, 1, 0xffff, "snapshot age");
  if (!(policy.anchorPolicyHash instanceof Uint8Array) || policy.anchorPolicyHash.length !== 32 || policy.anchorPolicyHash.every((byte) => byte === 0) ||
    !(policy.nativeExceptionHash instanceof Uint8Array) || policy.nativeExceptionHash.length !== 32 || policy.nativeExceptionHash.every((byte) => byte === 0)) {
    betaError("CREATION_CONTEXT_REQUIRED", "classic policy hashes must be explicit nonzero 32-byte values");
  }
}

function validateCompositePolicy(policy: MimirBetaCompositePolicy): void {
  for (const key of ["priceExponent", "maxSnapshotAgeSlots", "maxComponentSnapshotAgeSlots",
    "maxComponentConfidenceBps", "maxComponentDispersionBps"] as const) {
    if (typeof policy[key] !== "number") betaError("CREATION_CONTEXT_REQUIRED", `composite policy ${key} is required`);
  }
  requireInteger(policy.priceExponent, -36, 19, "price exponent"); requireInteger(policy.maxSnapshotAgeSlots, 1, 0xffff, "snapshot age");
  requireInteger(policy.maxComponentSnapshotAgeSlots, 1, 0xffff, "component snapshot age");
  requireInteger(policy.maxComponentConfidenceBps, 0, 10_000, "component confidence");
  requireInteger(policy.maxComponentDispersionBps, 0, 10_000, "component dispersion");
}

function uniqueAddresses(values: readonly Address[]): Address[] { return [...new Set(values)]; }

async function loadGlobalContext(args: {
  readonly dependencies: CreationDependencies;
  readonly minContextSlot: bigint;
  readonly authority: Address;
  readonly quoteMint: Address;
  readonly baseMint?: Address;
  readonly selectedSourceBindings?: readonly MimirBetaPoolCreationBinding[];
  readonly collateralAccount: Address;
  readonly allowCollateralFunding?: boolean;
  readonly oneCharTickers?: boolean;
  readonly collateralOptional?: boolean;
  readonly extraAddresses: readonly Address[];
}): Promise<GlobalContext> {
  const { deployment, rpc } = args.dependencies;
  const reader = new FinalizedRpcReader(rpc);
  const pdas = await deriveMimirBetaCanonicalPdas(deployment.mimirProgramId);
  const firstAddresses = [pdas.registry[0], pdas.admin[0]];
  const first = await reader.accounts(firstAddresses, args.minContextSlot);
  const firstAdminAccount = first.value[1];
  if (!firstAdminAccount) betaError("CREATION_CONTEXT_REQUIRED", "admin config missing");
  const firstAdmin = await decodeMimirBetaAdminContext(pdas.admin[0], firstAdminAccount.data);
  const oneCharPda = args.oneCharTickers ? await deriveMimirOneCharAllowancePda(deployment.mimirProgramId, args.authority) : null;
  const addresses = uniqueAddresses([...(oneCharPda ? [oneCharPda[0]] : []),
    ...firstAddresses, deployment.mimirProgramId, deployment.tokenProgramId, deployment.systemProgramId,
    args.quoteMint, ...(args.baseMint ? [args.baseMint] : []), args.collateralAccount,
    ...(firstAdmin.collateralMint ? [firstAdmin.collateralMint] : []), ...args.extraAddresses,
  ]);
  const coherent = await reader.accounts(addresses, first.slot);
  const map = new Map<Address, MimirBetaAccount>();
  const captureAccounts = new Map<Address, MimirBetaAccount | null>();
  coherent.value.forEach((account, index) => {
    const address = addresses[index]!;
    captureAccounts.set(address, account);
    if (account) map.set(address, account);
  });
  const registryAccount = map.get(pdas.registry[0]); const adminAccount = map.get(pdas.admin[0]);
  if (!registryAccount || !adminAccount) betaError("CREATION_CONTEXT_REQUIRED", "global creation account missing");
  for (const [label, account] of [["registry", registryAccount], ["admin", adminAccount]] as const) {
    if (account.owner !== deployment.mimirProgramId || account.executable) betaError("ACCOUNT_OWNER_MISMATCH", `${label} owner mismatch`, account.address);
  }
  const [registry, admin] = await Promise.all([
    decodeMimirBetaRegistryContext(pdas.registry[0], registryAccount.data),
    decodeMimirBetaAdminContext(pdas.admin[0], adminAccount.data),
  ]);
  await Promise.all([
    verifyMimirBetaContextPda({ programId: deployment.mimirProgramId, address: registry.address, seed: "mimir_registry", seedValues: [Uint8Array.of(0, 0)], bump: registry.bump }),
    verifyMimirBetaContextPda({ programId: deployment.mimirProgramId, address: admin.address, seed: "admin_config", seedValues: [Uint8Array.of(1, 0)], bump: admin.bump }),
  ]);
  if (args.selectedSourceBindings) {
    assertMimirBetaSourceAdapterVersions({ registry, sources: args.selectedSourceBindings });
  }
  assertMimirBetaActiveCreationContext({ registry, admin });
  if (deployment.cluster === "devnet" && !admin.collateralRequired) betaError("ACCOUNT_MALFORMED", "admin collateral is required on devnet", admin.address);
  for (const programId of [deployment.mimirProgramId, deployment.tokenProgramId, deployment.systemProgramId]) {
    const program = map.get(programId);
    if (!program) betaError("CREATION_CONTEXT_REQUIRED", "executable program account missing", programId);
    if (!program.executable) betaError("ACCOUNT_OWNER_MISMATCH", "program account not executable", programId);
  }
  const quoteAccount = map.get(args.quoteMint); const collateral = map.get(args.collateralAccount);
  if (!quoteAccount || (!collateral && !args.allowCollateralFunding && !args.collateralOptional)) {
    betaError("CREATION_CONTEXT_REQUIRED", "mint or collateral token account missing");
  }
  const baseAccount = args.baseMint ? map.get(args.baseMint) ?? betaError("CREATION_CONTEXT_REQUIRED", "base mint missing") : null;
  const clmmV1Bindings = args.selectedSourceBindings?.filter((binding) => binding.adapterType === 1 && binding.adapterVersion === 1) ?? [];
  const dlmmV1Bindings = args.selectedSourceBindings?.filter((binding) => binding.adapterType === 3 && binding.adapterVersion === 1) ?? [];
  const pumpV1Bindings = args.selectedSourceBindings?.filter((binding) => binding.adapterType === 6 && binding.adapterVersion === 1) ?? [];
  let quoteMint: MimirBetaSplMintContext;
  let baseMint: MimirBetaSplMintContext | null;
  if (clmmV1Bindings.length > 0) {
    const token2022MintAddress = clmmV1Bindings[0]!.token2022Mint;
    if (!baseAccount || token2022MintAddress === null || clmmV1Bindings.length !== args.selectedSourceBindings!.length ||
        clmmV1Bindings.some((binding) => binding.token2022Mint !== token2022MintAddress)) {
      betaError("PLAN_STALE", "Token-2022 feed mint requires exclusively bound CLMM V1 sources");
    }
    const baseIsToken2022 = baseAccount.owner === MIMIR_BETA_TOKEN_2022_PROGRAM_ID;
    const quoteIsToken2022 = quoteAccount.owner === MIMIR_BETA_TOKEN_2022_PROGRAM_ID;
    if (baseIsToken2022 === quoteIsToken2022 ||
        (baseIsToken2022 ? baseAccount.address : quoteAccount.address) !== token2022MintAddress ||
        (baseIsToken2022 ? quoteAccount.owner : baseAccount.owner) !== MIMIR_BETA_SPL_TOKEN_PROGRAM_ID) {
      betaError("ACCOUNT_OWNER_MISMATCH", "CLMM V1 feed requires its bound Token-2022 mint and one classic SPL mint");
    }
    const token2022Account = baseIsToken2022 ? baseAccount : quoteAccount;
    let parsed: ReturnType<typeof classifyToken2022Mint>;
    try {
      parsed = classifyToken2022Mint({ account: token2022Account, expectedMint: token2022MintAddress,
        expectedDecimals: token2022Account.data[44]!, nowUnix: 0n });
    } catch (error) {
      if (isToken2022ClmmAccountError(error)) betaError("ACCOUNT_MALFORMED", error.message, token2022Account.address);
      if (isToken2022ClmmPolicyError(error)) betaError(error.code, error.message, token2022Account.address);
      throw error;
    }
    const token2022Mint: MimirBetaSplMintContext = { address: token2022Account.address, decimals: parsed.decimals,
      supply: new DataView(token2022Account.data.buffer, token2022Account.data.byteOffset, token2022Account.data.byteLength).getBigUint64(36, true) };
    const classicAccount = baseIsToken2022 ? quoteAccount : baseAccount;
    const classicMint = decodeMimirBetaSplMint(classicAccount, deployment.tokenProgramId);
    baseMint = baseIsToken2022 ? token2022Mint : classicMint;
    quoteMint = quoteIsToken2022 ? token2022Mint : classicMint;
  } else if (dlmmV1Bindings.length > 0 && pumpV1Bindings.length === 0) {
    const bindings = args.selectedSourceBindings ?? [];
    const token2022MintAddress = dlmmV1Bindings[0]!.token2022Mint;
    if (bindings.length !== dlmmV1Bindings.length || dlmmV1Bindings.some((binding) =>
        binding.tokenProgramId !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID || binding.token2022Mint !== token2022MintAddress ||
        binding.staticAccounts.at(-1)?.role !== "token2022-mint" ||
        binding.staticAccounts.at(-1)?.address !== token2022MintAddress) ||
        !baseAccount || token2022MintAddress === null ||
        (token2022MintAddress !== baseAccount.address && token2022MintAddress !== quoteAccount.address) ||
        (token2022MintAddress === baseAccount.address
          ? baseAccount.owner !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID || quoteAccount.owner !== deployment.tokenProgramId
          : quoteAccount.owner !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID || baseAccount.owner !== deployment.tokenProgramId)) {
      betaError("PLAN_STALE", "DLMM V1 feed requires isolated, independently bound Token-2022 mint sources");
    }
    const token2022Account = token2022MintAddress === baseAccount.address ? baseAccount : quoteAccount;
    if (token2022Account.data.length <= 82) betaError("PLAN_STALE", "DLMM V1 requires an extended Token-2022 mint", token2022Account.address);
    let parsed: ReturnType<typeof classifyToken2022Mint>;
    try {
      parsed = classifyToken2022Mint({ account: token2022Account, expectedMint: token2022MintAddress,
        expectedDecimals: token2022Account.data[44]!, nowUnix: 0n });
    } catch (error) {
      if (isToken2022ClmmAccountError(error)) betaError("ACCOUNT_MALFORMED", error.message, token2022Account.address);
      if (isToken2022ClmmPolicyError(error)) betaError(error.code, error.message, token2022Account.address);
      throw error;
    }
    const token2022Mint: MimirBetaSplMintContext = { address: token2022Account.address, decimals: parsed.decimals,
      supply: new DataView(token2022Account.data.buffer, token2022Account.data.byteOffset, token2022Account.data.byteLength).getBigUint64(36, true) };
    const classicAccount = token2022MintAddress === baseAccount.address ? quoteAccount : baseAccount;
    const classicMint = decodeMimirBetaSplMint(classicAccount, deployment.tokenProgramId);
    baseMint = token2022MintAddress === baseAccount.address ? token2022Mint : classicMint;
    quoteMint = token2022MintAddress === quoteAccount.address ? token2022Mint : classicMint;
  } else if (pumpV1Bindings.length > 0 ||
      (baseAccount?.owner === MIMIR_BETA_TOKEN_2022_PROGRAM_ID &&
        args.selectedSourceBindings?.some((binding) => binding.adapterType === 6))) {
    const bindings = args.selectedSourceBindings ?? [];
    if (!baseAccount || baseAccount.owner !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID || quoteAccount.owner !== MIMIR_BETA_SPL_TOKEN_PROGRAM_ID ||
        bindings.length === 0 || bindings.some((binding) => pumpV1Bindings.length > 0
          ? (binding.adapterType !== 3 && binding.adapterType !== 6) || binding.adapterVersion !== 1 ||
            binding.tokenProgramId !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID || binding.token2022Mint !== baseAccount.address ||
            (binding.adapterType === 3 && (binding.staticAccounts.at(-1)?.role !== "token2022-mint" ||
              binding.staticAccounts.at(-1)?.address !== baseAccount.address))
          : binding.adapterType !== 6 || (binding.adapterVersion === 1 && binding.token2022Mint !== baseAccount.address)) ||
        (baseAccount.data.length !== 82 && pumpV1Bindings.length + dlmmV1Bindings.length !== bindings.length) ||
        (dlmmV1Bindings.length > 0 && baseAccount.data.length === 82)) {
      betaError("PLAN_STALE", "Token-2022 PumpSwap/DLMM sources require independent base-mint V1 bindings and classic quote");
    }
    let token2022Mint: MimirBetaSplMintContext;
    if (baseAccount.data.length === 82) {
      token2022Mint = decodeMimirBetaSplMint(baseAccount, MIMIR_BETA_TOKEN_2022_PROGRAM_ID);
    } else {
      let parsed: ReturnType<typeof classifyToken2022PumpSwapMetadataMint>;
      try {
        parsed = classifyToken2022PumpSwapMetadataMint({ account: baseAccount, expectedMint: baseAccount.address,
          expectedDecimals: baseAccount.data[44]!, nowUnix: 0n });
      } catch (error) {
        if (isToken2022ClmmAccountError(error)) betaError("ACCOUNT_MALFORMED", error.message, baseAccount.address);
        if (isToken2022ClmmPolicyError(error)) betaError(error.code, error.message, baseAccount.address);
        throw error;
      }
      token2022Mint = { address: baseAccount.address, decimals: parsed.decimals,
        supply: new DataView(baseAccount.data.buffer, baseAccount.data.byteOffset, baseAccount.data.byteLength).getBigUint64(36, true) };
    }
    baseMint = token2022Mint;
    quoteMint = decodeMimirBetaSplMint(quoteAccount, deployment.tokenProgramId);
  } else {
    quoteMint = decodeMimirBetaSplMint(quoteAccount, deployment.tokenProgramId);
    baseMint = baseAccount ? decodeMimirBetaSplMint(baseAccount, deployment.tokenProgramId) : null;
  }
  let collateralMint: MimirBetaSplMintContext | null = null;
  if (args.allowCollateralFunding) {
    const collateralMintAddress = admin.collateralMint ?? betaError("CREATION_CONTEXT_REQUIRED", "admin collateral mint missing");
    const collateralMintAccount = map.get(collateralMintAddress) ??
      betaError("CREATION_CONTEXT_REQUIRED", "admin collateral mint account missing", collateralMintAddress);
    collateralMint = decodeMimirBetaSplMint(collateralMintAccount, deployment.tokenProgramId);
  }
  const collateralAccount = collateral ? decodeMimirBetaSplTokenAccount(collateral, deployment.tokenProgramId) : null;
  if (!collateralAccount && args.allowCollateralFunding && !args.collateralOptional) {
    const collateralMintAddress = admin.collateralMint ?? betaError("CREATION_CONTEXT_REQUIRED", "admin collateral mint missing");
    const [canonicalTokenAccount] = await getProgramDerivedAddress({
      programAddress: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
      seeds: [addressBytes(args.authority), addressBytes(deployment.tokenProgramId), addressBytes(collateralMintAddress)],
    });
    if (args.collateralAccount !== canonicalTokenAccount) {
      betaError("PDA_MISMATCH", "missing collateral token account must be the canonical associated token account",
        args.collateralAccount);
    }
  }
  // Balance is checked by the exact activation simulation/burn proof, not after that burn during reconciliation.
  if (collateralAccount && (collateralAccount.owner !== args.authority || (admin.collateralRequired &&
    (admin.collateralMint === null || collateralAccount.mint !== admin.collateralMint)))) {
    betaError("ACCOUNT_MALFORMED", "creator collateral token account does not satisfy admin policy", args.collateralAccount);
  }
  const oneCharAllowance = oneCharPda ? { address: oneCharPda[0], ...resolveMimirOneCharAllowance(map.get(oneCharPda[0]) ?? null,
    deployment.mimirProgramId, oneCharPda[0], oneCharPda[1]) } : null;
  return { slot: coherent.slot, registry, admin, accounts: map, captureAccounts, quoteMint, baseMint, collateralAccount, collateralMint,
    oneCharAllowance };
}

function throwCollateralFundingRequired(args: {
  readonly context: GlobalContext;
  readonly authority: Address;
  readonly tokenAccount: Address;
  readonly draftHash: string;
  readonly requiredAmountRaw: bigint;
  readonly fundingCosts?: MimirBetaFundingCosts;
  readonly resolvedVariant?: number;
  readonly feedId?: Address;
  readonly selectedPools?: readonly MimirBetaEligiblePool[];
  readonly fullPurchase?: boolean;
  readonly compositeJourney?: MimirBetaCompositeJourneyPreviewV1;
}): never {
  if (args.requiredAmountRaw < 0n || args.requiredAmountRaw > U64_MAX) {
    betaError("INVALID_ARGUMENT", "remaining activation tariffs overflow u64");
  }
  const mint = args.context.collateralMint ?? betaError("CREATION_CONTEXT_REQUIRED", "authenticated collateral mint missing");
  if (args.context.admin.collateralMint !== mint.address) {
    betaError("CREATION_CONTEXT_REQUIRED", "authenticated collateral mint differs from admin config", mint.address);
  }
  const balanceRaw = args.context.collateralAccount?.amount ?? 0n;
  const shortfallRaw = args.fullPurchase ? args.requiredAmountRaw
    : args.requiredAmountRaw > balanceRaw ? args.requiredAmountRaw - balanceRaw : 0n;
  throw new MimirBetaCollateralRequiredError({
    authority: args.authority,
    mint: mint.address,
    tokenAccount: args.tokenAccount,
    decimals: mint.decimals,
    requiredAmountRaw: args.requiredAmountRaw,
    balanceRaw,
    shortfallRaw,
    accountMissing: args.context.collateralAccount === null,
    observedSlot: args.context.slot,
    draftHash: args.draftHash,
    ...(args.fundingCosts ? { fundingCosts: args.fundingCosts } : {}),
    ...(args.resolvedVariant !== undefined ? { resolvedVariant: args.resolvedVariant } : {}),
    ...(args.feedId !== undefined ? { feedId: args.feedId } : {}),
    ...(args.selectedPools !== undefined ? { selectedPools: args.selectedPools } : {}),
    ...(args.compositeJourney !== undefined ? { compositeJourney: args.compositeJourney } : {}),
  });
}

function accountTransition(address: Address, transition: "create" | "write" | "close", ownerAfter: Address | null,
  dataLengthAfter: ExpectedAccountDataLength, description: string, codec?: MimirBetaReconciliationCodec): ExpectedTransitionSpec {
  return { kind: "account", address, transition, ownerAfter, dataLengthAfter, description, ...(codec ? { codec } : {}) };
}

function matchesExpectedDataLength(expected: ExpectedAccountDataLength, observed: number): boolean {
  return expected === null || (typeof expected === "number" ? expected === observed : expected.includes(observed));
}

function maximumExpectedDataLength(expected: ExpectedAccountDataLength): number | null {
  return expected === null ? null : typeof expected === "number" ? expected : Math.max(...expected);
}

function sameExpectedDataLength(left: ExpectedAccountDataLength, right: ExpectedAccountDataLength): boolean {
  if (left === null || right === null || typeof left === "number" || typeof right === "number") return left === right;
  return left.length === right.length && left.every((size, index) => size === right[index]);
}

function burnChecked(args: Omit<Extract<ExpectedTransitionSpec, { kind: "spl-token-burn-checked" }>, "kind">): ExpectedTransitionSpec {
  return { kind: "spl-token-burn-checked", ...args };
}

function specAddresses(specs: readonly ExpectedTransitionSpec[]): readonly Address[] {
  const addresses: Address[] = [];
  const add = (value: Address) => { if (!addresses.includes(value)) addresses.push(value); };
  for (const spec of specs) {
    add(spec.address);
    if (spec.kind === "spl-token-burn-checked") add(spec.mint);
  }
  return addresses;
}

function stepsFromIds(authority: Address, ids: readonly { id: MimirBetaStepId; stage: MimirBetaPlanStep["stage"]; signers: readonly Address[];
  writes: readonly MimirBetaExpectedWrite[] }[]): readonly MimirBetaPlanStep[] {
  return ids.map((entry, ordinal) => ({ stepId: entry.id, stage: entry.stage, ordinal,
    prerequisiteStepIds: ordinal === 0 ? [] : [ids[ordinal - 1]!.id],
    requiredSigners: uniqueAddresses([authority, ...entry.signers]), expectedWrites: entry.writes }));
}

async function hydrateReviewedSteps(args: {
  readonly draftHash: string;
  readonly steps: readonly MimirBetaPlanStep[];
  readonly receipts: readonly MimirBetaStageReceipt[];
  readonly targets: ReadonlyMap<MimirBetaStepId, ReviewTarget>;
}): Promise<readonly MimirBetaPlanStep[]> {
  const reviewed = await Promise.all(args.receipts.map(authenticateMimirBetaReviewedStep));
  const byStep = new Map<MimirBetaStepId, MimirBetaPlanStep>();
  for (let index = 0; index < reviewed.length; index += 1) {
    const lineage = reviewed[index]!;
    const receipt = args.receipts[index]!;
    const base = args.steps.find((step) => step.stepId === lineage.step.stepId);
    const target = args.targets.get(lineage.step.stepId);
    const reviewedDisplayNameInstruction = target?.displayNameInstruction === null ? undefined : lineage.review.instructions.find((instruction) =>
      target?.displayNameInstruction && instruction.programAddress === target.displayNameInstruction.programAddress &&
      canonicalJson(instruction.accounts as never) === canonicalJson(target.displayNameInstruction.accounts as never) &&
      bytesEqual(fromBase64(instruction.dataBase64), target.displayNameInstruction.data));
    if (receipt.draftHash !== args.draftHash || lineage.review.draftHash !== args.draftHash) {
      betaError("RECEIPT_MISMATCH", "receipt is bound to another draft; resume with the prepared selectedPools and unchanged draft inputs");
    }
    if (!base || !target ||
      lineage.review.kind !== target.kind || lineage.review.feedId !== target.feedId || lineage.review.feed !== target.feed ||
      lineage.review.identityAsset !== target.identityAsset || lineage.review.ticker !== target.ticker ||
      lineage.review.displayName !== target.displayName ||
      (target.displayNameInstruction !== null && !reviewedDisplayNameInstruction) ||
      base.stage !== lineage.step.stage || base.ordinal !== lineage.step.ordinal ||
      canonicalJson(base.prerequisiteStepIds as never) !== canonicalJson(lineage.step.prerequisiteStepIds as never) ||
      canonicalJson(base.requiredSigners as never) !== canonicalJson(lineage.step.requiredSigners as never)) {
      betaError("RECEIPT_MISMATCH", "reviewed step cannot hydrate this draft plan");
    }
    const prior = byStep.get(lineage.step.stepId);
    if (prior && canonicalJson(prior as never) !== canonicalJson(lineage.step as never)) {
      betaError("RECEIPT_MISMATCH", "retry changed reviewed expected-write lineage");
    }
    byStep.set(lineage.step.stepId, lineage.step);
  }
  return args.steps.map((step) => byStep.get(step.stepId) ?? step);
}

function instructionAccount(address: Address, isSigner = false, isWritable = false) { return { address, isSigner, isWritable }; }

function parseBlockhash(value: unknown): { blockhash: string; lastValidBlockHeight: bigint } {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const candidate = record?.value && typeof record.value === "object" ? record.value as Record<string, unknown> : record;
  const height = candidate?.lastValidBlockHeight;
  if (!candidate || typeof candidate.blockhash !== "string" ||
    !((typeof height === "bigint" && height >= 0n) || (typeof height === "number" && Number.isSafeInteger(height) && height >= 0))) {
    betaError("RPC_CONTEXT_MISMATCH", "latest blockhash response malformed");
  }
  return { blockhash: candidate.blockhash, lastValidBlockHeight: typeof height === "bigint" ? height : BigInt(height) };
}

async function simulateExact(rpc: MimirBetaPlanningRpc, wire: Uint8Array, minContextSlot: bigint,
  addresses: readonly Address[], mimirProgramId: Address, instructions?: readonly MimirBetaInstruction[]) {
  const response = await rpc.simulateTransaction(base64(wire), {
    commitment: "confirmed", encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, minContextSlot,
    accounts: { addresses, encoding: "base64" },
  }).send();
  if (!response || typeof response !== "object") betaError("SIMULATION_FAILED", "simulation response malformed");
  const record = response as Record<string, unknown>; const context = record.context as Record<string, unknown> | undefined;
  const value = record.value as Record<string, unknown> | undefined; const slotValue = context?.slot;
  const slot = typeof slotValue === "bigint" ? slotValue : typeof slotValue === "number" && Number.isSafeInteger(slotValue) ? BigInt(slotValue) : -1n;
  if (value && slot >= minContextSlot && value.err !== null && value.err !== undefined) {
    throw new MimirBetaSimulationError(mimirBetaSimulationFailure(value.err, value.logs, mimirProgramId, instructions));
  }
  if (!value || slot < minContextSlot || value.err !== null) betaError("SIMULATION_FAILED", "exact unsigned transaction simulation failed");
  const logs = Array.isArray(value.logs) && value.logs.every((log) => typeof log === "string") ? value.logs as string[] : [];
  const logsHash = hex(await sha256(utf8(canonicalJson(logs as never))));
  let returnDataHash: string | null = null;
  if (value.returnData !== null && value.returnData !== undefined) {
    const returnData = value.returnData as Record<string, unknown>; const data = returnData.data;
    if (!Array.isArray(data) || data.length !== 2 || data[1] !== "base64" || typeof data[0] !== "string") betaError("SIMULATION_FAILED", "simulation return data malformed");
    returnDataHash = hex(await sha256(fromBase64(data[0])));
  }
  const units = value.unitsConsumed;
  const unitsConsumed = units === null || units === undefined ? null : typeof units === "bigint" ? units :
    typeof units === "number" && Number.isSafeInteger(units) && units >= 0 ? BigInt(units) : betaError("SIMULATION_FAILED", "simulation units malformed");
  if (!Array.isArray(value.accounts) || value.accounts.length !== addresses.length) {
    betaError("SIMULATION_FAILED", "simulation did not return the exact post-account vector");
  }
  const accounts = value.accounts.map((account, index) => decodeMimirBetaRpcAccount(addresses[index]!, account));
  return { facts: { status: "succeeded" as const, contextSlot: slot, unitsConsumed, logsHash, returnDataHash, error: null }, accounts };
}

async function classicFusedPointFits(dependencies: CreationDependencies, authority: Address,
  instructions: readonly MimirBetaInstruction[], minContextSlot: bigint): Promise<boolean> {
  const blockhash = parseBlockhash(await dependencies.rpc.getLatestBlockhash({ commitment: "confirmed" }).send());
  try {
    const transaction = await compileMimirBetaTransactionV1({ feePayer: authority, recentBlockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight, instructions });
    const simulated = await simulateExact(dependencies.rpc, transaction.serializedTransaction, minContextSlot, [],
      dependencies.deployment.mimirProgramId, instructions);
    assertMimirStrictSimulation(transaction, { err: null, unitsConsumed: simulated.facts.unitsConsumed });
    return true;
  } catch (error) {
    if (error instanceof MimirBetaSimulationError) {
      if (classicFusedPointPackingFailure(error, dependencies.deployment)) return false;
      throw error;
    }
    if (error instanceof MimirBetaError && (error.code === "TRANSACTION_TOO_LARGE" || error.code === "SIMULATION_FAILED")) return false;
    throw error;
  }
}

/** Compute/size exhaustion, or a fee/rent/collateral shortfall that hides the Mimir outcome; any other simulated refusal is structural. */
function classicFusedPointPackingFailure(error: MimirBetaSimulationError, deployment: MimirBetaFacadeDeployment): boolean {
  return ["AccountNotFound", "InsufficientFundsForFee", "InsufficientFundsForRent", "MaxLoadedAccountsDataSizeExceeded"].includes(error.errorKind ?? "") ||
    error.programId === deployment.tokenProgramId || error.programId === deployment.systemProgramId ||
    error.logs.some((log) => /exceeded CUs meter|Computational budget exceeded/.test(log));
}

async function buildExpectedWrites(args: {
  readonly specs: readonly ExpectedTransitionSpec[];
  readonly before: readonly (MimirBetaAccount | null)[];
  readonly after: readonly (MimirBetaAccount | null)[];
  readonly addresses: readonly Address[];
  readonly writableAddresses: readonly Address[];
  readonly feePayer: Address;
  readonly simulationSlot: bigint;
  readonly deployment: MimirBetaFacadeDeployment;
  readonly compositeFee?: Readonly<{ feeVault: Address; collateralLock: Address; treasury: Address; total: bigint; ownerShareBps: number }>;
  readonly compositeActivationFee?: Readonly<{ treasury: Address; owners: readonly Address[];
    assets: readonly Readonly<{ address: Address; owner: Address }>[] }>;
  /** Writable only in a caller prefix: a `caller-prefix` proof instead of an exact transition. */
  readonly callerPrefixAccounts?: ReadonlySet<Address>;
}): Promise<readonly MimirBetaExpectedWrite[]> {
  const before = new Map(args.addresses.map((address, index) => [address, args.before[index] ?? null]));
  const after = new Map(args.addresses.map((address, index) => [address, args.after[index] ?? null]));
  for (const entry of args.compositeActivationFee?.assets ?? []) {
    const account = after.get(entry.address);
    if (!account || decodeMimirBetaCoreAsset(account, args.deployment, entry.address).liveOwner !== entry.owner) {
      betaError("SIMULATION_FAILED", "simulated Classic Core owner differs from activation payout", entry.address);
    }
  }
  const accountSpecs = new Map<Address, Extract<ExpectedTransitionSpec, { kind: "account" }>>();
  const burnIdentities = new Set<string>();
  const burnIndexes = new Set<number>();
  const specs = args.specs.filter((spec) => {
    if (spec.kind === "account") {
      const first = accountSpecs.get(spec.address);
      if (!first) { accountSpecs.set(spec.address, spec); return true; }
      if (first.transition !== "write" || spec.transition !== "write" || first.ownerAfter !== spec.ownerAfter ||
        !sameExpectedDataLength(first.dataLengthAfter, spec.dataLengthAfter) || first.codec !== spec.codec || first.description !== spec.description) {
        betaError("PROGRAM_ABI_MISMATCH", "incompatible duplicate account transition spec", spec.address);
      }
      return false;
    }
    const identity = canonicalJson({ outerInstructionIndex: spec.outerInstructionIndex, tokenProgram: spec.tokenProgram,
      sourceTokenAccount: spec.address, mint: spec.mint, authority: spec.authority, amountRaw: spec.amountRaw,
      decimals: spec.decimals });
    if (burnIdentities.has(identity) || burnIndexes.has(spec.outerInstructionIndex)) {
      betaError("PROGRAM_ABI_MISMATCH", "duplicate BurnChecked transition spec", spec.address);
    }
    burnIdentities.add(identity); burnIndexes.add(spec.outerInstructionIndex);
    return true;
  });
  await assertMimirBetaNativeRefreshTrios({
    writes: args.specs.flatMap((spec) => spec.kind === "account" &&
      (spec.codec === "native-mono-source-ring-v1" || spec.codec === "native-mono-feed-twap-v0" ||
        spec.codec === "native-mono-feed-snapshot-v0")
      ? [{ codec: spec.codec, address: spec.address, account: after.get(spec.address) ?? null }] : []),
    programId: args.deployment.mimirProgramId,
    transactionSlot: args.simulationSlot,
    accountContextSlot: args.simulationSlot,
  });
  const burns = specs.filter((spec): spec is Extract<ExpectedTransitionSpec, { kind: "spl-token-burn-checked" }> =>
    spec.kind === "spl-token-burn-checked");
  const oneCharSpends = args.specs.filter((spec) => spec.kind === "account" && spec.description === ONE_CHAR_SPEND_DESCRIPTION);
  if (oneCharSpends.length > 0) {
    const address = oneCharSpends[0]!.address;
    const pre = before.get(address); const post = after.get(address);
    if (oneCharSpends.some((spec) => spec.address !== address) || !pre || !post) {
      betaError("SIMULATION_FAILED", "one-character allowance state missing", address);
    }
    const preAllowance = decodeMimirOneCharAllowance(pre.data); const postAllowance = decodeMimirOneCharAllowance(post.data);
    const spent = BigInt(oneCharSpends.length);
    if (preAllowance.remaining - postAllowance.remaining !== spent || postAllowance.revision - preAllowance.revision !== spent ||
      postAllowance.bump !== preAllowance.bump) {
      betaError("SIMULATION_FAILED", "one-character allowance simulation delta mismatch", address);
    }
  }
  if (burns.length + oneCharSpends.length > 1) {
    const groups = new Map<string, { proof: typeof burns[number]; total: bigint }>();
    for (const burn of burns) {
      const key = canonicalJson({ tokenProgram: burn.tokenProgram, sourceTokenAccount: burn.address, mint: burn.mint,
        authority: burn.authority, decimals: burn.decimals });
      const group = groups.get(key) ?? { proof: burn, total: 0n };
      if (burn.amountRaw < 0n || group.total > U64_MAX - burn.amountRaw) {
        betaError("PROGRAM_ABI_MISMATCH", "aggregate BurnChecked amount overflows u64", burn.address);
      }
      group.total += burn.amountRaw; groups.set(key, group);
    }
    for (const { proof, total } of groups.values()) {
      const preSource = before.get(proof.address); const postSource = after.get(proof.address);
      const preMint = before.get(proof.mint); const postMint = after.get(proof.mint);
      if (!preSource || !postSource || !preMint || !postMint) {
        betaError("SIMULATION_FAILED", "aggregate BurnChecked source/mint state missing", proof.address);
      }
      const decodedPreSource = decodeMimirBetaSplTokenAccount(preSource, proof.tokenProgram);
      const decodedPostSource = decodeMimirBetaSplTokenAccount(postSource, proof.tokenProgram);
      const decodedPreMint = decodeMimirBetaSplMint(preMint, proof.tokenProgram);
      const decodedPostMint = decodeMimirBetaSplMint(postMint, proof.tokenProgram);
      if (decodedPreSource.amount < total || decodedPreMint.supply < total ||
        decodedPreSource.amount - decodedPostSource.amount !== total || decodedPreMint.supply - decodedPostMint.supply !== total ||
        decodedPreSource.mint !== proof.mint || decodedPostSource.mint !== proof.mint ||
        decodedPreSource.owner !== proof.authority || decodedPostSource.owner !== proof.authority ||
        decodedPreMint.decimals !== proof.decimals || decodedPostMint.decimals !== proof.decimals) {
        betaError("SIMULATION_FAILED", "aggregate BurnChecked simulation delta mismatch", proof.address);
      }
    }
    const assets = specs.filter((spec) => spec.kind === "account" && spec.transition === "create" && spec.codec === "mpl-core-asset-v1");
    const collections = specs.filter((spec) => spec.kind === "account" && spec.transition === "write" && spec.codec === "mpl-core-collection-v1");
    if (assets.length !== burns.length + oneCharSpends.length || collections.length !== 1) {
      betaError("PROGRAM_ABI_MISMATCH", "aggregate activation Core proof count mismatch");
    }
    const collection = collections[0]!;
    const preCollection = before.get(collection.address); const postCollection = after.get(collection.address);
    if (!preCollection || !postCollection) betaError("SIMULATION_FAILED", "aggregate collection state missing", collection.address);
    const decodedPre = decodeMimirBetaCoreCollection(preCollection, args.deployment);
    const decodedPost = decodeMimirBetaCoreCollection(postCollection, args.deployment);
    const count = assets.length;
    if (decodedPre.numMinted > 0xffff_ffff - count || decodedPre.currentSize > 0xffff_ffff - count ||
      decodedPost.numMinted !== decodedPre.numMinted + count || decodedPost.currentSize !== decodedPre.currentSize + count) {
      betaError("SIMULATION_FAILED", "aggregate collection counter delta mismatch", collection.address);
    }
  }
  const writes = await Promise.all(specs.map(async (spec): Promise<MimirBetaExpectedWrite> => {
    if (spec.kind === "spl-token-burn-checked") {
      return {
        address: spec.address,
        effect: "token-burn",
        ownerAfter: spec.tokenProgram,
        dataLengthAfter: 165,
        discriminatorHex: null,
        description: spec.description,
        proof: {
          kind: "spl-token-burn-checked",
          tokenProgram: spec.tokenProgram,
          mint: spec.mint,
          sourceTokenAccount: spec.address,
          authority: spec.authority,
          amountRaw: spec.amountRaw,
          decimals: spec.decimals,
          outerInstructionIndex: spec.outerInstructionIndex,
        },
      };
    }
    const pre = before.get(spec.address) ?? null;
    const simulatedPost = after.get(spec.address) ?? null;
    const post = spec.transition === "close" && isAbsentPostAccount(simulatedPost) ? null : simulatedPost;
    if ((spec.transition === "create" && pre !== null) || (spec.transition !== "create" && pre === null) ||
      (spec.transition === "close" ? post !== null : post === null)) {
      betaError("SIMULATION_FAILED", `simulation transition ${spec.transition} mismatch`, spec.address);
    }
    if (post && (post.owner !== spec.ownerAfter || !matchesExpectedDataLength(spec.dataLengthAfter, post.data.length) || post.executable)) {
      betaError("SIMULATION_FAILED", "simulation post-account tuple differs from current ABI", spec.address);
    }
    const afterCondition = post === null ? { exists: false as const, lamports: 0n as const } : {
      exists: true as const,
      lamports: post.lamports,
      owner: post.owner,
      executable: post.executable,
      data: spec.codec ? await (async (codec: MimirBetaReconciliationCodec, oneCharTransition?: MimirBetaOneCharTransitionEvidence) => ({
        kind: "sdk-codec" as const,
        codec,
        length: post.data.length,
        semanticHash: await createMimirBetaReconciliationSemanticHash({ codec, address: spec.address,
          account: post, transactionSlot: args.simulationSlot, blockTime: null, accounts: after,
          ...(spec.sampledTransition ? { sampledTransition: spec.sampledTransition, sampledRing: after.get(spec.sampledTransition.ring) ?? null } : {}),
          ...(oneCharTransition ? { oneCharTransition } : {}) }),
        ...(spec.sampledTransition ? { sampledTransition: spec.sampledTransition } : {}),
        ...(oneCharTransition ? { oneCharTransition } : {}),
      }))(spec.codec, spec.codec === "one-char-allowance-v1" ? { consumed: oneCharSpends.length,
        revisionAfter: decodeMimirOneCharAllowance(post.data).revision.toString() } : undefined) : {
        kind: "exact" as const,
        length: post.data.length,
        sha256: hex(await sha256(post.data)),
      },
    };
    return {
      address: spec.address,
      effect: spec.transition,
      ownerAfter: spec.ownerAfter,
      dataLengthAfter: post?.data.length ?? null,
      discriminatorHex: post && post.data.length >= 8 ? hex(post.data.subarray(0, 8)) : null,
      description: spec.description,
      proof: { kind: "account", transition: spec.transition, before: await fingerprintMimirBetaAccount(pre), after: afterCondition,
        ...(pre && pre.owner === args.deployment.mimirProgramId && pre.data.length >= 608 && pre.data.length <= 608 + 5 * 392 &&
          (pre.data.length - 608) % 392 === 0 && new DataView(pre.data.buffer, pre.data.byteOffset, pre.data.byteLength).getUint16(8, true) === 1 &&
          new DataView(pre.data.buffer, pre.data.byteOffset, pre.data.byteLength).getUint16(10, true) === 608
          ? { beforeDataBase64: base64(pre.data) } : {}) },
    };
  }));
  const accountAddresses = new Set(writes.filter((write) => write.proof.kind === "account").map((write) => write.address));
  if (accountAddresses.has(args.feePayer)) {
    betaError("PROGRAM_ABI_MISMATCH", "fee payer cannot also be an account transition", args.feePayer);
  }
  const emptySystemAccount = (account: MimirBetaAccount | null) => account === null ||
    account.owner === args.deployment.systemProgramId && !account.executable && account.data.length === 0;
  const sameAccountState = (left: MimirBetaAccount | null, right: MimirBetaAccount | null): boolean =>
    emptySystemAccount(left) && emptySystemAccount(right) || left !== null && right !== null &&
      left.owner === right.owner && left.executable === right.executable && bytesEqual(left.data, right.data);
  const lamportWrites: MimirBetaExpectedWrite[] = [];
  const prefixWrites: MimirBetaExpectedWrite[] = [];
  for (const address of args.writableAddresses) {
    if (accountAddresses.has(address)) continue;
    const pre = before.get(address) ?? null;
    const post = after.get(address) ?? null;
    if (args.callerPrefixAccounts?.has(address)) {
      prefixWrites.push({ address, effect: "caller-prefix", ownerAfter: null, dataLengthAfter: null, discriminatorHex: null,
        description: "caller-prefix write: reviewed baseline and simulated lamport delta, no exact postcondition",
        proof: { kind: "caller-prefix", before: await fingerprintMimirBetaAccount(pre), simulatedLamportDelta: (post?.lamports ?? 0n) - (pre?.lamports ?? 0n) } });
      continue;
    }
    if (!sameAccountState(pre, post)) {
      betaError("PROGRAM_ABI_MISMATCH", "writable account has an unmodelled non-lamport transition", address);
    }
    if (address === args.feePayer) continue;
    const delta = (post?.lamports ?? 0n) - (pre?.lamports ?? 0n);
    if (delta === 0n) continue;
    lamportWrites.push({
      address,
      effect: "lamports",
      ownerAfter: null,
      dataLengthAfter: null,
      discriminatorHex: null,
      description: "apply exact reviewed program lamport delta",
      proof: { kind: "lamports", programDeltaLamports: delta },
    });
  }
  let otherProgramDelta = 0n;
  for (const write of writes) {
    if (write.proof.kind !== "account") continue;
    const postLamports = write.proof.after.exists ? write.proof.after.lamports : 0n;
    otherProgramDelta += postLamports - write.proof.before.lamports;
  }
  for (const write of lamportWrites) {
    if (write.proof.kind === "lamports") otherProgramDelta += write.proof.programDeltaLamports;
  }
  const payerProgramDelta = -otherProgramDelta;
  if (payerProgramDelta !== 0n) {
    lamportWrites.push({
      address: args.feePayer,
      effect: "lamports",
      ownerAfter: null,
      dataLengthAfter: null,
      discriminatorHex: null,
      description: "apply fee-normalized exact payer program lamport delta",
      proof: { kind: "lamports", programDeltaLamports: payerProgramDelta },
    });
  }
  const activationCredit = (address: Address): bigint => {
    if (!args.compositeActivationFee || address === args.feePayer) return 0n;
    const ownerCredits = BigInt(args.compositeActivationFee.owners.filter((owner) => owner === address).length) *
      COMPOSITE_ACTIVATION_OWNER_FEE_LAMPORTS;
    const treasuryCredit = args.compositeActivationFee.treasury === address
      ? COMPOSITE_ACTIVATION_TREASURY_FEE_LAMPORTS * BigInt(args.compositeActivationFee.owners.length) +
        COMPOSITE_ACTIVATION_CREATION_FEE_LAMPORTS : 0n;
    return ownerCredits + treasuryCredit;
  };
  if (args.compositeActivationFee) {
    const expected = new Map<Address, bigint>();
    for (const owner of args.compositeActivationFee.owners) {
      if (owner !== args.feePayer) expected.set(owner,
        (expected.get(owner) ?? 0n) + COMPOSITE_ACTIVATION_OWNER_FEE_LAMPORTS);
    }
    const { treasury, owners } = args.compositeActivationFee;
    if (treasury !== args.feePayer) expected.set(treasury,
      (expected.get(treasury) ?? 0n) + COMPOSITE_ACTIVATION_TREASURY_FEE_LAMPORTS * BigInt(owners.length) +
        COMPOSITE_ACTIVATION_CREATION_FEE_LAMPORTS);
    if (args.compositeFee && args.compositeFee.treasury !== args.feePayer) {
      const ownerShare = args.compositeFee.total * BigInt(args.compositeFee.ownerShareBps) / 10_000n;
      expected.set(args.compositeFee.treasury,
        (expected.get(args.compositeFee.treasury) ?? 0n) + args.compositeFee.total - ownerShare);
    }
    for (const [address, amount] of expected) {
      const write = lamportWrites.find((candidate) => candidate.address === address && candidate.proof.kind === "lamports");
      if ((write?.proof.kind === "lamports" ? write.proof.programDeltaLamports : 0n) !== amount) {
        betaError("SIMULATION_FAILED", "Composite activation owner/Treasury payment delta differs from fixed policy", address);
      }
    }
  }
  if (args.compositeFee) {
    const accountDelta = (address: Address): bigint => {
      const write = writes.find((candidate) => candidate.address === address && candidate.proof.kind === "account");
      if (!write || write.proof.kind !== "account" || !write.proof.after.exists) {
        return betaError("PROGRAM_ABI_MISMATCH", "composite fee account proof missing", address);
      }
      return write.proof.after.lamports - write.proof.before.lamports;
    };
    const lamportDelta = (address: Address): bigint => {
      const write = lamportWrites.find((candidate) => candidate.address === address && candidate.proof.kind === "lamports");
      return write?.proof.kind === "lamports" ? write.proof.programDeltaLamports : 0n;
    };
    const vaultShare = args.compositeFee.total * BigInt(args.compositeFee.ownerShareBps) / 10_000n;
    const treasuryShare = args.compositeFee.total - vaultShare;
    const vaultRent = before.get(args.compositeFee.feeVault) === null ? accountDelta(args.compositeFee.collateralLock) : 0n;
    if (accountDelta(args.compositeFee.feeVault) - vaultRent !== vaultShare ||
        args.compositeFee.treasury !== args.feePayer &&
          lamportDelta(args.compositeFee.treasury) - activationCredit(args.compositeFee.treasury) !== treasuryShare) {
      betaError("SIMULATION_FAILED", "composite refresh fee split differs from configured owner/treasury policy");
    }
  }
  return [...writes, ...lamportWrites, ...prefixWrites];
}

function isAbsentPostAccount(account: MimirBetaAccount | null): boolean {
  return account === null || account.owner === MIMIR_BETA_SYSTEM_PROGRAM_ID && account.lamports === 0n &&
    account.data.length === 0 && !account.executable;
}

/** Review-time caller-prefix terms from the exact simulation: debit bound, funding credit and authority token accounts. */
function reviewCallerPrefix(args: Readonly<{ prefix: MimirBetaCallerPrefix; authority: Address; tokenProgramId: Address; burned: bigint;
  mintBurns: ReadonlyMap<Address, bigint>; writes: readonly MimirBetaExpectedWrite[]; prefixOnly: ReadonlySet<Address>;
  state: (address: Address, side: "before" | "after") => MimirBetaAccount | null }>): MimirBetaCallerPrefixReview {
  const { prefix, authority } = args; const funding = prefix.funding;
  const debit = args.writes.reduce((sum, write) => write.proof.kind === "caller-prefix" ? sum + write.proof.simulatedLamportDelta : sum, 0n);
  if (debit > prefix.maxAuthorityDebitLamports) {
    throw new MimirBetaCallerPrefixError("authority-debit-above-bound", `simulated caller-prefix authority debit ${debit} exceeds ${prefix.maxAuthorityDebitLamports} lamports`, authority);
  }
  const tokenOf = (account: MimirBetaAccount | null) => account && !account.executable &&
    (account.owner === args.tokenProgramId || account.owner === MIMIR_BETA_TOKEN_2022_PROGRAM_ID) &&
    (account.data.length === 165 || account.data.length > 165 && account.data[165] === 2) && (account.data[108] === 1 || account.data[108] === 2)
    ? { mint: bytesAddress(account.data.subarray(0, 32)), owner: bytesAddress(account.data.subarray(32, 64)),
      amount: new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength).getBigUint64(64, true),
      // owner, delegate and close-authority fields
      control: hex(Uint8Array.from([...account.data.subarray(32, 64), ...account.data.subarray(72, 108), ...account.data.subarray(129, 165)])) } : null;
  const uncontrolled = (owner: Address) => hex(Uint8Array.from([...addressBytes(owner), ...new Uint8Array(72)]));
  const tokenDeltas: { address: Address; mint: Address; preAmountRaw: bigint; postAmountRaw: bigint }[] = [];
  for (const address of [...(funding ? [funding.tokenAccount] : []), ...args.prefixOnly]) {
    const pre = tokenOf(args.state(address, "before")); const post = tokenOf(args.state(address, "after"));
    if (pre?.owner !== authority && post?.owner !== authority) continue;
    if (post && post.control !== (pre?.control ?? uncontrolled(authority))) {
      throw new MimirBetaCallerPrefixError("foreign-token-account", "caller prefix changes the owner, delegate or close authority of an authority token account", address);
    }
    tokenDeltas.push({ address, mint: (post ?? pre)!.mint, preAmountRaw: pre?.amount ?? 0n, postAmountRaw: post?.amount ?? 0n });
  }
  const foreign = [...(funding ? [funding.tokenAccount] : []), ...(prefix.guardTokenAccounts ?? [])].find((address) =>
    !tokenDeltas.some((delta) => delta.address === address) || tokenOf(args.state(address, "after"))?.owner !== authority);
  if (foreign) throw new MimirBetaCallerPrefixError("foreign-token-account", "a declared caller-prefix token account is not an authority token account the prefix writes", foreign);
  const funded = funding && tokenDeltas.find((delta) => delta.address === funding.tokenAccount)!;
  if (funding && funded && funded.postAmountRaw - funded.preAmountRaw + args.burned < funding.minimumCreditRaw) {
    throw new MimirBetaCallerPrefixError("funding-shortfall", `simulated funding credit ${funded.postAmountRaw - funded.preAmountRaw + args.burned} is below the declared ${funding.minimumCreditRaw}`,
      funding.tokenAccount);
  }
  if (funding?.coversBurn && tokenDeltas.some((delta) => delta.address !== funding.tokenAccount && delta.mint === funded?.mint && delta.postAmountRaw < delta.preAmountRaw)) {
    throw new MimirBetaCallerPrefixError("funding-from-authority", "caller prefix pays the covered burn from another authority balance of the burn mint", funding.tokenAccount);
  }
  const authorityBytes = addressBytes(authority);
  const names = (account: MimirBetaAccount | null) => account !== null &&
    account.data.some((_, index) => authorityBytes.every((byte, offset) => account.data[index + offset] === byte));
  for (const address of args.prefixOnly) {
    const before = args.state(address, "before"); const after = args.state(address, "after");
    if (!names(before) && !names(after)) continue;
    if (tokenOf(after) ? tokenOf(before) !== null && before!.data[108] !== after!.data[108]
      : before === null || after === null || before.owner !== after.owner || before.lamports !== after.lamports || !bytesEqual(before.data, after.data)) {
      throw new MimirBetaCallerPrefixError("authority-account", "caller prefix changes authority state other than a token balance", address);
    }
  }
  if (funding && args.state(funding.tokenAccount, "before")?.lamports !== args.state(funding.tokenAccount, "after")?.lamports) {
    throw new MimirBetaCallerPrefixError("core-account-overlap", "caller prefix moves lamports into the funding token account", funding.tokenAccount);
  }
  for (const [mint, total] of args.mintBurns) {
    const before = args.state(mint, "before"); const after = args.state(mint, "after");
    const supply = (account: MimirBetaAccount) => new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength).getBigUint64(36, true);
    const rest = (account: MimirBetaAccount) => Uint8Array.from(account.data, (byte, index) => index >= 36 && index < 44 ? 0 : byte);
    if (!before || !after || before.owner !== after.owner || before.lamports !== after.lamports || before.data.length < 82 ||
      before.data.length !== after.data.length || supply(before) - supply(after) !== total || !bytesEqual(rest(before), rest(after))) {
      throw new MimirBetaCallerPrefixError("core-account-overlap", "caller prefix changes a burn mint beyond the reviewed burn", mint);
    }
  }
  return { instructionCount: prefix.instructions.length,
    funding: funding ? { tokenAccount: funding.tokenAccount, minimumCreditRaw: funding.minimumCreditRaw, coversBurn: funding.coversBurn === true } : null,
    guardTokenAccounts: [...(prefix.guardTokenAccounts ?? [])], maxAuthorityDebitLamports: prefix.maxAuthorityDebitLamports, tokenDeltas };
}

export async function prepareReview(args: {
  readonly dependencies: CreationDependencies;
  readonly contextSlot: bigint;
  readonly strictSimulation?: boolean;
  readonly draftHash: string;
  readonly plan: MimirBetaUnsignedPlan;
  readonly step: MimirBetaPlanStep;
  readonly instructions: readonly MimirBetaInstruction[];
  readonly specs: readonly ExpectedTransitionSpec[];
  readonly transientAddresses?: readonly Address[];
  readonly target: ReviewTarget;
  /** Capture rows the instructions were built from: a moved CLMM window (Custom 46) is typed PREPARATION_STALE. */
  readonly observedRows?: ReadonlyMap<Address, MimirBetaAccount | null>;
  readonly compositeFee?: Readonly<{ feeVault: Address; collateralLock: Address; treasury: Address; total: bigint; ownerShareBps: number }>;
  readonly compositeActivationFee?: Readonly<{ treasury: Address; owners: readonly Address[];
    assets: readonly Readonly<{ address: Address; owner: Address }>[] }>;
  /** Caller-owned instructions compiled ahead of `instructions`; only the Classic and composite activation steps take one. */
  readonly callerPrefix?: MimirBetaCallerPrefix;
  /** The created feed's first price, compiled after `instructions` in the same transaction: one tag 89 (classic) or tag 87
   *  (composite) on `target.feed`. Activation steps only. */
  readonly firstPrice?: Readonly<{ instructions: readonly MimirBetaInstruction[] }>;
  /** TxV1 config compute-unit limit of the simulated and reviewed message (default: the TxV1 maximum). */
  readonly computeUnitLimit?: number;
}): Promise<MimirBetaPreparedStep> {
  const prefix = args.callerPrefix; const funding = prefix?.funding; const authority = args.plan.authority;
  const burned = args.specs.reduce((sum, spec) => spec.kind === "spl-token-burn-checked" && spec.address === funding?.tokenAccount ? sum + spec.amountRaw : sum, 0n);
  const mintBurns = new Map<Address, bigint>();
  for (const spec of args.specs) if (spec.kind === "spl-token-burn-checked") mintBurns.set(spec.mint, (mintBurns.get(spec.mint) ?? 0n) + spec.amountRaw);
  if (prefix) {
    if (args.step.stepId !== "classic:activate" && args.step.stepId !== "composite:activate") {
      throw new MimirBetaCallerPrefixError("step", "a caller prefix leads only an activation step");
    }
    const violation = mimirBetaCallerPrefixViolationV1({ authority, programId: args.dependencies.deployment.mimirProgramId,
      fundingTokenAccount: funding?.tokenAccount ?? null, readonlyCoreAccounts: [...mintBurns.keys()], prefix: prefix.instructions, core: args.instructions });
    if (violation) throw new MimirBetaCallerPrefixError(violation.reason, `caller prefix ${violation.reason}`, violation.address);
    if (funding && burned === 0n) throw new MimirBetaCallerPrefixError("funding-account", "declared funding token account is not this step's burn source", funding.tokenAccount);
    if (funding?.coversBurn && funding.minimumCreditRaw < burned) {
      throw new MimirBetaCallerPrefixError("funding-below-burn", "declared funding credit does not cover the burn", funding.tokenAccount);
    }
  }
  const suffix = args.firstPrice?.instructions ?? [];
  if (suffix.length) {
    if (args.step.stepId !== `${args.target.kind}:activate` || suffix.length !== 1 || !await isMimirV1FirstPriceSuffix({ kind: args.target.kind,
      programId: args.dependencies.deployment.mimirProgramId, feedId: args.target.feedId, feed: args.target.feed, authority }, suffix[0]!)) {
      betaError("INVALID_ARGUMENT", "firstPrice must be one tag-89/87 on the created feed");
    }
  }
  const instructions = [...(prefix?.instructions ?? []), ...args.instructions, ...suffix];
  const specs = prefix ? args.specs.map((spec) => spec.kind === "spl-token-burn-checked"
    ? { ...spec, outerInstructionIndex: spec.outerInstructionIndex + prefix.instructions.length } : spec) : args.specs;
  const blockhash = parseBlockhash(await args.dependencies.rpc.getLatestBlockhash({ commitment: "confirmed" }).send());
  const transaction = await compileMimirBetaTransactionV1({ feePayer: authority, recentBlockhash: blockhash.blockhash,
    lastValidBlockHeight: blockhash.lastValidBlockHeight,
    instructions: args.computeUnitLimit === undefined ? instructions : [buildMimirBetaComputeUnitLimitInstruction(args.computeUnitLimit), ...instructions],
  });
  if (specs.length === 0) betaError("PROGRAM_ABI_MISMATCH", "reviewable step has no proof-complete transition specs");
  const writableAddresses = uniqueAddresses([authority, ...instructions.flatMap((instruction) =>
    instruction.accounts.filter((account) => account.isWritable).map((account) => account.address))]);
  const addresses = uniqueAddresses([...specAddresses(specs), ...(args.transientAddresses ?? []), ...writableAddresses,
    ...(args.compositeActivationFee?.assets.map(({ address }) => address) ?? [])]);
  const before = await new FinalizedRpcReader(args.dependencies.rpc, "confirmed").accounts(addresses, args.contextSlot);
  const burnTotals = new Map<Address, bigint>();
  for (const spec of specs) {
    if (spec.kind !== "spl-token-burn-checked") continue;
    const total = (burnTotals.get(spec.address) ?? 0n) + spec.amountRaw;
    const source = before.value[addresses.indexOf(spec.address)];
    if (!source && spec.address === funding?.tokenAccount) {
      throw new MimirBetaCallerPrefixError("funding-account", "declared funding token account must exist before the transaction", spec.address);
    }
    if (!source || total > U64_MAX ||
      decodeMimirBetaSplTokenAccount(source, spec.tokenProgram).amount + (spec.address === funding?.tokenAccount ? funding.minimumCreditRaw : 0n) < total) {
      betaError("SIMULATION_FAILED", "creator balance cannot cover activation burns", spec.address);
    }
    burnTotals.set(spec.address, total);
  }
  const observed = new Map([...args.observedRows ?? []].flatMap(([key, account]) => account ? [[key, account] as const] : []));
  const simulated = await simulateExact(args.dependencies.rpc, transaction.serializedTransaction, before.slot, addresses, args.dependencies.deployment.mimirProgramId, instructions)
    .catch((error: unknown) => error instanceof MimirBetaSimulationError && error.customCode === 46 && observed.size
      ? proveMimirBetaPreparationDrift(args.dependencies.rpc, observed, args.contextSlot, args.dependencies.deployment.mimirProgramId, "confirmed", error, instructions)
      : Promise.reject(error));
  if (args.dependencies.deployment.cluster === "mainnet-beta" || confirmedPreparation.has(args.dependencies.rpc) || args.strictSimulation === true) assertMimirStrictSimulation(transaction, { err: null, unitsConsumed: simulated.facts.unitsConsumed });
  for (const address of args.transientAddresses ?? []) {
    const index = addresses.indexOf(address);
    if (before.value[index] !== null || !isAbsentPostAccount(simulated.accounts[index]!)) {
      betaError("SIMULATION_FAILED", "transient proposal must be absent before and after exact simulation", address);
    }
  }
  const transientAddresses = new Set(args.transientAddresses ?? []);
  const after = simulated.accounts.map((account, index) => transientAddresses.has(addresses[index]!) ? null : account);
  const moduleSpecs = await sampledModuleSpecs({ specified: specAddresses(specs), addresses, writableAddresses, before: before.value, after,
    payer: authority, programId: args.dependencies.deployment.mimirProgramId, rpc: args.dependencies.rpc });
  const prefixOnly = prefix && new Set(prefix.instructions.flatMap((instruction) => instruction.accounts.flatMap((account) =>
    account.isWritable && account.address !== authority && account.address !== funding?.tokenAccount ? [account.address] : [])));
  const expectedWrites = await buildExpectedWrites({ specs: [...specs, ...moduleSpecs], before: before.value, after,
    addresses, writableAddresses, feePayer: authority, simulationSlot: simulated.facts.contextSlot,
    deployment: args.dependencies.deployment, compositeFee: args.compositeFee,
    compositeActivationFee: args.compositeActivationFee, ...(prefixOnly ? { callerPrefixAccounts: prefixOnly } : {}) });
  const callerPrefix = prefix && reviewCallerPrefix({ prefix, authority, tokenProgramId: args.dependencies.deployment.tokenProgramId, burned, mintBurns,
    writes: expectedWrites, prefixOnly: prefixOnly!, state: (address, side) => (side === "before" ? before.value : after)[addresses.indexOf(address)] ?? null });
  const step: MimirBetaPlanStep = { ...args.step, expectedWrites };
  const instructionReviews = await Promise.all(instructions.map(async (instruction) => ({ programAddress: instruction.programAddress,
    accounts: instruction.accounts, dataBase64: base64(instruction.data), dataSha256: hex(await sha256(instruction.data)) })));
  const expectedWritesHash = await createExpectedWritesHash(expectedWrites);
  const stepIntentHash = await createStepIntentHash({ draftHash: args.draftHash, step, expectedWritesHash, ...(callerPrefix ? { callerPrefix } : {}) });
  const review: MimirBetaCreationReviewV1 = {
    schema: "mimir-beta-creation-review", version: 1, draftHash: args.draftHash, stepId: args.step.stepId,
    kind: args.target.kind, cluster: args.plan.cluster, programId: args.plan.programId, authority: args.plan.authority,
    feedId: args.target.feedId, feed: args.target.feed, identityAsset: args.target.identityAsset, displayName: args.target.displayName,
    ticker: args.target.ticker,
    requiredSigners: transaction.requiredSigners, instructions: instructionReviews,
    expectedWrites, messageHash: transaction.messageHash,
    stepIntentHash, expectedWritesHash,
    packet: transaction.packet, simulation: simulated.facts, warnings: [], ...(callerPrefix ? { callerPrefix } : {}),
    ...(suffix.length ? { firstPrice: { instructionCount: suffix.length } } : {}),
  };
  const hashes = await createReviewHash(review);
  const renewalWitnesses = await createMimirBetaRenewalWitnesses(expectedWrites,
    new Map(addresses.map((address, index) => [address, before.value[index] ?? null])),
    new Map(addresses.map((address, index) => [address, after[index] ?? null])), args.dependencies.deployment);
  return { step, transaction, review, ...hashes, renewalWitnesses };
}

export async function createMimirBetaRenewalWitnesses(
  writes: readonly MimirBetaExpectedWrite[],
  before: ReadonlyMap<Address, MimirBetaAccount | null>,
  after: ReadonlyMap<Address, MimirBetaAccount | null>,
  deployment: MimirBetaDeployment,
): Promise<readonly MimirBetaRenewalWitness[]> {
  const witnesses: MimirBetaRenewalWitness[] = [];
  for (const write of writes) {
    const role = sharedAccountRole(write, writes);
    if (role !== "core-collection" && role !== "burn-mint" && role !== "one-char-allowance") continue;
    const pre = before.get(write.address); const post = after.get(write.address);
    if (!pre || !post) betaError("SIMULATION_FAILED", "shared account state missing", write.address);
    const stable = (account: MimirBetaAccount, offset: number, length: number) => {
      const data = Uint8Array.from(account.data); data.fill(0, offset, offset + length);
      return sha256(utf8(canonicalJson({ owner: account.owner, executable: account.executable, data: hex(data) })));
    };
    let effect: string; let offset: number; let length: number;
    if (role === "core-collection") {
      const decodedPre = decodeMimirBetaCoreCollection(pre, deployment);
      const decodedPost = decodeMimirBetaCoreCollection(post, deployment);
      offset = collectionBaseEnd(post.data) - 8; length = 8;
      if (collectionBaseEnd(pre.data) - 8 !== offset) betaError("SIMULATION_FAILED", "shared collection layout changed", write.address);
      effect = canonicalJson({ numMinted: decodedPost.numMinted - decodedPre.numMinted,
        currentSize: decodedPost.currentSize - decodedPre.currentSize });
    } else if (role === "one-char-allowance") {
      const decodedPre = decodeMimirOneCharAllowance(pre.data); const decodedPost = decodeMimirOneCharAllowance(post.data);
      offset = 10; length = 16;
      effect = canonicalJson({ remaining: (decodedPost.remaining - decodedPre.remaining).toString(),
        revision: (decodedPost.revision - decodedPre.revision).toString() });
    } else {
      const decodedPre = decodeMimirBetaSplMint(pre, post.owner);
      const decodedPost = decodeMimirBetaSplMint(post, post.owner);
      offset = 36; length = 8;
      effect = canonicalJson({ supply: (decodedPost.supply - decodedPre.supply).toString() });
    }
    witnesses.push({ address: write.address, role, beforeStableSha256: hex(await stable(pre, offset, length)),
      afterStableSha256: hex(await stable(post, offset, length)), effect });
  }
  return witnesses;
}

function assertRetryReviewBinding(args: {
  readonly action: ReturnType<typeof reconcileStepReceipts>["action"];
  readonly receipts: readonly MimirBetaStageReceipt[];
  readonly next: MimirBetaPreparedStep;
}): void {
  if (args.action !== "retry-once") return;
  const prior = args.receipts.filter((receipt) => receipt.stepId === args.next.step.stepId);
  if (prior.length !== 1 || prior[0]!.attempt !== 1 ||
    prior[0]!.stepIntentHash !== args.next.review.stepIntentHash ||
    prior[0]!.expectedWritesHash !== args.next.review.expectedWritesHash ||
    prior[0]!.messageHash === args.next.transaction.messageHash ||
    prior[0]!.reviewHash === args.next.reviewHash) {
    betaError("RECEIPT_MISMATCH", "retry must preserve intent and expected writes while refreshing review and message");
  }
}

function preparedBase(args: { draft: { canonicalDraftJson: string; draftHash: string }; selectedPools: readonly MimirBetaEligiblePool[] | null;
  plan: MimirBetaUnsignedPlan; reconciliation: ReturnType<typeof reconcileStepReceipts>; next: MimirBetaPreparedStep | null }): MimirBetaPreparedCreation {
  return { schema: "mimir-beta-prepared-creation", version: 1, canonicalDraftJson: args.draft.canonicalDraftJson,
    draftHash: args.draft.draftHash, selectedPools: args.selectedPools, plan: args.plan, reconciliation: args.reconciliation, next: args.next };
}

async function identityInstructions(dependencies: CreationDependencies, identity: MimirBetaIdentityDraft, authority: Address): Promise<readonly MimirBetaInstruction[]> {
  return Promise.all([
    dependencies.identity.buildRegister({ asset: identity.asset, authority, agentUri: identity.agentUri }),
    dependencies.identity.buildSetCollectionPointer({ asset: identity.asset, authority }),
  ]);
}

interface FundingStepSelection {
  readonly instructions: readonly MimirBetaInstruction[];
  readonly specs: readonly ExpectedTransitionSpec[];
  readonly rentSpecs?: readonly ExpectedTransitionSpec[];
  readonly identities?: readonly MimirBetaIdentityDraft[];
}

async function estimateFundingCosts(args: {
  readonly dependencies: CreationDependencies;
  readonly authority: Address;
  readonly minContextSlot: bigint;
  readonly steps: readonly FundingStepSelection[];
  readonly identities: readonly MimirBetaIdentityDraft[];
  readonly externallyCreatedCollateralAccount?: Address;
  readonly protocolFeeLamports?: bigint;
  /** One identity probe per group (one per journey operation); omitted keeps the single all-identities probe. */
  readonly identityGroups?: readonly (readonly MimirBetaIdentityDraft[])[];
  readonly rentBreakdown?: { retainedLamports: bigint; peakTemporaryLamports: bigint };
}): Promise<MimirBetaFundingCosts> {
  const { rpc, deployment, identity } = args.dependencies;
  if (!rpc.getFeeForMessage) {
    betaError("CREATION_CONTEXT_REQUIRED", "funding cost RPC methods are unavailable");
  }
  const u64 = (value: unknown, label: string, positive = false): bigint => {
    const parsed = typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : -1n;
    if (parsed < 0n || parsed > U64_MAX || positive && parsed === 0n) {
      betaError("RPC_CONTEXT_MISMATCH", `${label} is not a valid u64`);
    }
    return parsed;
  };
  const add = (left: bigint, right: bigint, label: string): bigint => {
    if (right < 0n || left > U64_MAX - right) betaError("RPC_CONTEXT_MISMATCH", `${label} overflows u64`);
    return left + right;
  };
  const uniqueIdentities = [...new Map(args.identities.map((value) => [value.asset, value])).values()];
  const identityRows = await Promise.all(uniqueIdentities.map(async (value) => ({ value,
    agent: (await identity.deriveAgentAccount(value.asset))[0] })));
  const identityAddresses = new Set<Address>([
    deployment.physicalCollection, ...identityRows.flatMap(({ value, agent: agentAddress }) => [value.asset, agentAddress]),
  ]);
  const specs = args.steps.flatMap(({ specs: stepSpecs, rentSpecs }) => [...(rentSpecs ?? []), ...stepSpecs]);
  const accountSpecs = specs.filter((spec): spec is Extract<ExpectedTransitionSpec, { kind: "account" }> => spec.kind === "account" &&
    !(spec.address === args.externallyCreatedCollateralAccount && spec.transition === "write"));
  const checkedAddresses = uniqueAddresses(accountSpecs.map(({ address }) => address).filter((value) => !identityAddresses.has(value)));
  const reader = new FinalizedRpcReader(rpc, "confirmed");
  const beforeRead = checkedAddresses.length ? await reader.accounts(checkedAddresses, args.minContextSlot) : null;
  let observedSlot = beforeRead?.slot ?? args.minContextSlot;
  const current = new Map<Address, { readonly owner: Address; readonly executable: boolean; readonly dataLength: number } | null>(
    checkedAddresses.map((value, index) => { const account = beforeRead!.value[index];
      return [value, account ? { owner: account.owner, executable: account.executable, dataLength: account.data.length } : null]; }));
  const requiredSizes = new Map<Address, number>();
  for (const spec of accountSpecs) {
    if (identityAddresses.has(spec.address)) continue;
    const prior = current.get(spec.address) ?? null;
    const requiredSize = maximumExpectedDataLength(spec.dataLengthAfter);
    if (spec.transition === "create") {
      if (prior !== null) betaError("SIMULATION_FAILED", "remaining account create collides with finalized state", spec.address);
      current.set(spec.address, spec.ownerAfter === null ? null : { owner: spec.ownerAfter, executable: false,
        dataLength: requiredSize ?? 0 });
    } else if (spec.transition === "write") {
      if (prior === null || prior.executable || spec.ownerAfter !== null && prior.owner !== spec.ownerAfter) {
        betaError("SIMULATION_FAILED", "remaining account write has stale or malformed finalized state", spec.address);
      }
      current.set(spec.address, { owner: spec.ownerAfter ?? prior.owner, executable: false,
        dataLength: requiredSize ?? prior.dataLength });
    } else {
      if (prior === null || prior.executable) betaError("SIMULATION_FAILED", "remaining account close has no valid allocation", spec.address);
      current.set(spec.address, null);
      continue;
    }
    if (requiredSize !== null) {
      requiredSizes.set(spec.address, Math.max(requiredSizes.get(spec.address) ?? 0, requiredSize));
    }
  }
  const initialLamports = new Map<Address, bigint>(checkedAddresses.map((value, index) => [value,
    beforeRead!.value[index] ? u64(beforeRead!.value[index]!.lamports, "account balance") : 0n]));
  const rentSysvar = await readMimirRentSysvar(rpc);
  let accountRentLamports = 0n;
  for (const [value, size] of requiredSizes) {
    const rent = computeMimirRentExemptLamports(rentSysvar, size);
    const balance = initialLamports.get(value) ?? 0n;
    const due = rent > balance ? rent - balance : 0n;
    accountRentLamports = add(accountRentLamports, due, "account rent reserve");
    if (!args.rentBreakdown) continue;
    if (current.get(value) === null) {
      if (due > args.rentBreakdown.peakTemporaryLamports) args.rentBreakdown.peakTemporaryLamports = due;
    } else args.rentBreakdown.retainedLamports = add(args.rentBreakdown.retainedLamports, due, "retained rent");
  }

  const blockhash = parseBlockhash(await rpc.getLatestBlockhash({ commitment: "confirmed" }).send());
  let identityLamports = 0n;
  for (const group of args.identityGroups ?? [uniqueIdentities]) {
    if (!group.length) continue;
    const identityRowsOf = identityRows.filter(({ value }) => group.some((entry) => entry.asset === value.asset));
    const instructions = (await Promise.all(group.map((value) => identityInstructions(args.dependencies, value, args.authority)))).flat();
    const addresses = uniqueAddresses([args.authority, ...instructions.flatMap((instruction) => instruction.accounts
      .filter((account) => account.isWritable).map((account) => account.address))]);
    const transaction = await compileMimirBetaTransactionV1({ feePayer: args.authority, recentBlockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight, instructions });
    const before = await reader.accounts(addresses, observedSlot);
    observedSlot = before.slot;
    const prior = new Map(addresses.map((value, index) => [value, before.value[index] ?? null]));
    if (!prior.get(args.authority)) betaError("SIMULATION_FAILED", "identity probe payer account is missing", args.authority);
    for (const [value, account] of prior) if (account) u64(account.lamports, "identity probe account balance");
    for (const { value, agent: agentAddress } of identityRowsOf) {
      if (!isAbsentPostAccount(prior.get(value.asset) ?? null) || !isAbsentPostAccount(prior.get(agentAddress) ?? null)) {
        betaError("RECONCILIATION_CONFLICT", "remaining identity already has finalized asset or agent state", value.asset);
      }
    }
    const collection = prior.get(deployment.physicalCollection) ?? null;
    if (!collection || collection.owner !== deployment.mplCoreProgramId || collection.executable) {
      betaError("ACCOUNT_OWNER_MISMATCH", "identity probe collection state is invalid", deployment.physicalCollection);
    }
    const simulated = await simulateExact(rpc, transaction.serializedTransaction, before.slot, addresses, deployment.mimirProgramId, instructions);
    observedSlot = simulated.facts.contextSlot;
    const after = new Map(addresses.map((value, index) => [value, simulated.accounts[index] ?? null]));
    for (const [value, account] of after) if (account) u64(account.lamports, "identity probe post-balance");
    for (const { value, agent: agentAddress } of identityRowsOf) {
      const assetAccount = after.get(value.asset); const agentAccount = after.get(agentAddress);
      if (!assetAccount || assetAccount.owner !== deployment.mplCoreProgramId || assetAccount.executable || assetAccount.data.length === 0 ||
        !agentAccount || agentAccount.owner !== deployment.agentRegistryProgramId || agentAccount.executable || agentAccount.data.length !== 748) {
        betaError("SIMULATION_FAILED", "identity probe returned malformed Core asset or agent state", value.asset);
      }
    }
    const collectionAfter = after.get(deployment.physicalCollection);
    if (!collectionAfter || collectionAfter.owner !== deployment.mplCoreProgramId || collectionAfter.executable) {
      betaError("SIMULATION_FAILED", "identity probe returned malformed collection state", deployment.physicalCollection);
    }
    let groupLamports = 0n;
    for (const value of addresses) {
      if (value === args.authority) continue;
      const delta = (after.get(value)?.lamports ?? 0n) - (prior.get(value)?.lamports ?? 0n);
      if (delta < 0n) betaError("SIMULATION_FAILED", "identity probe returned a negative program lamport delta", value);
      groupLamports = add(groupLamports, delta, "identity reserve");
    }
    const payerAfter = after.get(args.authority);
    if (!payerAfter) betaError("SIMULATION_FAILED", "identity probe omitted payer poststate", args.authority);
    const payerDebit = prior.get(args.authority)!.lamports - payerAfter.lamports;
    if (payerDebit < groupLamports) betaError("SIMULATION_FAILED", "identity probe payer debit does not cover program lamport deltas", args.authority);
    identityLamports = add(identityLamports, groupLamports, "identity reserve");
  }

  let networkFeeLamports = 0n;
  for (const { instructions } of args.steps) {
    const transaction = await compileMimirBetaTransactionV1({ feePayer: args.authority, recentBlockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight, instructions });
    const response = await quoteTxV1Fee(rpc as never, transaction, { commitment: "confirmed" });
    if (!response || typeof response !== "object") betaError("RPC_CONTEXT_MISMATCH", "message fee response malformed");
    const record = response as Record<string, unknown>;
    const context = record.context && typeof record.context === "object" ? record.context as Record<string, unknown> : null;
    const slot = u64(context?.slot, "message fee context slot");
    if (slot < args.minContextSlot) betaError("RPC_CONTEXT_MISMATCH", "message fee context predates creation evidence");
    observedSlot = slot > observedSlot ? slot : observedSlot;
    networkFeeLamports = add(networkFeeLamports, u64(record.value, "message fee"), "network fee reserve");
  }
  const protocolFeeLamports = u64(args.protocolFeeLamports ?? 0n, "protocol fee");
  const totalLamports = add(add(add(identityLamports, accountRentLamports, "funding reserve"), networkFeeLamports,
    "funding reserve"), protocolFeeLamports, "funding reserve");
  return Object.freeze({ observedSlot: u64(observedSlot, "observed slot"), identityLamports, accountRentLamports,
    networkFeeLamports, protocolFeeLamports, totalLamports });
}

function identityTransitionSpecs(dependencies: CreationDependencies, agent: Address, asset: Address): readonly ExpectedTransitionSpec[] {
  return [
    accountTransition(agent, "create", dependencies.deployment.agentRegistryProgramId, 748,
      "atomically register immutable feed identity", "identity-agent-v1"),
    accountTransition(asset, "create", dependencies.deployment.mplCoreProgramId, null,
      "atomically create transferable Core identity asset", "mpl-core-asset-v1"),
    accountTransition(dependencies.deployment.physicalCollection, "write", dependencies.deployment.mplCoreProgramId, null,
      "increment the physical Core collection in the fused activation", "mpl-core-collection-v1"),
  ];
}

function tickerTransition(context: GlobalContext, tickerPda: Address, dependencies: CreationDependencies): ExpectedTransitionSpec {
  const account = context.accounts.get(tickerPda);
  if (account && (account.owner !== dependencies.deployment.systemProgramId || account.executable || account.data.length !== 0)) {
    betaError("ACCOUNT_MALFORMED", "ticker PDA is already assigned or malformed", tickerPda);
  }
  return accountTransition(tickerPda, account ? "write" : "create", dependencies.deployment.mimirProgramId, 43,
    "atomically claim canonical ticker", "ticker-claim-v1");
}

interface OnePoolClassicAssembly {
  readonly currentPoint: boolean;
  readonly resolvedVariant: number;
  readonly selectedPools: readonly MimirBetaEligiblePool[];
  readonly contextSlot: bigint;
  readonly feedId: Address;
  readonly feed: Address;
  readonly sourceConfig: Address;
  readonly sourceRing: Address;
  readonly rowSources: readonly MimirFusedRowSource[];
  readonly tickerPda: Address;
  readonly ticker: string;
  readonly identity: MimirBetaIdentityDraft;
  readonly canonicalDraftJson: string;
  readonly draftHash: string;
  readonly instructions: readonly MimirBetaInstruction[];
  readonly specs: readonly ExpectedTransitionSpec[];
  readonly proposalSpecs: readonly ExpectedTransitionSpec[];
  readonly transientAddresses: readonly Address[];
  readonly observedRows: ReadonlyMap<Address, MimirBetaAccount | null>;
  readonly assertNativeReady: (activated: boolean) => void;
}

interface ReviewTarget {
  readonly kind: "classic" | "composite";
  readonly feedId: Address;
  readonly feed: Address;
  readonly identityAsset: Address;
  readonly ticker: string;
  readonly displayName: string | null;
  readonly displayNameInstruction: MimirBetaInstruction | null;
}

interface OnePoolClassicAssemblyMode {
  readonly preserveInputPools: boolean;
}

async function prepareMimirBetaSimpleFeedInternal(dependencies: CreationDependencies, args: PrepareSimpleFeedArgs,
  assemblyMode: OnePoolClassicAssemblyMode): Promise<OnePoolClassicAssembly>;
async function prepareMimirBetaSimpleFeedInternal(dependencies: CreationDependencies, args: PrepareSimpleFeedArgs,
  assemblyMode: false): Promise<MimirBetaPreparedCreation>;
async function prepareMimirBetaSimpleFeedInternal(dependencies: CreationDependencies, args: PrepareSimpleFeedArgs,
  assemblyMode: false | OnePoolClassicAssemblyMode): Promise<MimirBetaPreparedCreation | OnePoolClassicAssembly> {
  validateCommonInput(args); validateClassicPolicy(args.policy); validateCallerPrefix(args.callerPrefix);
  if (!Array.isArray(args.pools) || args.pools.length === 0) betaError("NO_ELIGIBLE_POOLS", "simple feed needs an eligible pool");
  if (args.pools.length > 5) betaError("POOL_COUNT_OUT_OF_RANGE", "simple feed pools must total 1..5");
  const minEvidenceSlot = args.pools.reduce((slot, pool) => pool.observedSlot > slot ? pool.observedSlot : slot, 0n);
  const revalidated = await dependencies.discovery.revalidateSelectedPools({ pools: args.pools, minContextSlot: minEvidenceSlot,
    maxConfidenceBps: args.policy.maxConfidenceBps });
  const boosted = revalidated.freshPools.find((pool) => (pool.maxBoostDriftBps ?? 0n) >= MIMIR_BETA_PUMPSWAP_BOOST_MAX_DRIFT_BPS);
  if (boosted) betaError("PUMPSWAP_BOOST_PENDING", "PumpSwap boost vault drift reaches the program limit; retry after the boost is spent", boosted.pool);
  const committed = (args.receipts ?? []).length > 0 || assemblyMode !== false && assemblyMode.preserveInputPools;
  const selectedPools = committed || args.preserveDraftPoolEvidence === true ? revalidated.pools : revalidated.freshPools;
  const draftPools = committed || args.preserveDraftPoolEvidence === true ? revalidated.pools : revalidated.freshPools;
  const receiptCount = (args.receipts ?? []).length;
  if (args.variant === "new" && receiptCount > 0) betaError("INVALID_ARGUMENT", "variant must be resolved before resume");
  const occupancy = { rpc: dependencies.rpc, programId: dependencies.deployment.mimirProgramId, baseMint: args.baseMint, quoteMint: args.quoteMint };
  const variant = args.variant === "new" ? await findFreeMimirBetaFeedVariant({ ...occupancy, allowV0: false }) : args.variant ?? 0;
  if (!Number.isInteger(variant) || variant < 0 || variant > 0xffff) betaError("INVALID_ARGUMENT", "feed variant is out of range");
  const feedId = await deriveMimirBetaClassicFeedId(args.baseMint, args.quoteMint, variant);
  if (args.feedId !== undefined && args.feedId !== feedId) betaError("INVALID_ARGUMENT", "frozen feed id does not match the variant");
  if (args.variant !== "new" && receiptCount === 0 && assemblyMode === false && await isMimirBetaVariantOccupied({ ...occupancy, variant })) {
    betaError("VARIANT_TAKEN", "feed variant is already activated", feedId);
  }
  if (args.recipes !== undefined && (!Array.isArray(args.recipes) || args.recipes.length !== args.pools.length ||
      args.recipes.some((r, i) => r !== null && r !== "spot" && !isMimirClassicIntervalRecipe(r) &&
        (r === "dual-native-point" ? !mimirClassicDualAdmitted(args.pools, i) : r === "current-point" ? !mimirDlmmPointAdmitted(args.pools[i]!)
          : r !== "native-bounded" || !mimirClassicNativeAdmitted(args.pools[i]!.creation.adapterType))))) {
    betaError("INVALID_ARGUMENT", "classic recipes must be spot, native-bounded (CLMM, CPMM, DLMM), dual-native-point (one CPMM v0 or DLMM pool), current-point (direct DLMM) or a mode-3 arm, one per pool");
  }
  const recipes = assemblyMode === false ? args.pools.map((_, i) => args.recipes?.[i] ?? null) : args.recipes;
  const duals = selectedPools.map((_, i) => recipes?.[i] === "dual-native-point");
  const dlmmPoints = selectedPools.map((_, i) => recipes?.[i] === "current-point");
  const cluster = generationCluster(dependencies.deployment.cluster);
  const intervals = selectedPools.map((pool, i) => {
    const r = recipes?.[i];
    if (!isMimirClassicIntervalRecipe(r)) return null;
    mimirClassicIntervalRow({ adapterType: pool.creation.adapterType, adapterVersion: pool.creation.adapterVersion, adapterAccounts: [], recipe: r, cluster, pool: pool.pool });
    return r;
  });
  const nativeTails = await Promise.all(selectedPools.map((pool, i) => recipes?.[i] === "native-bounded" || duals[i] ? mimirClassicNativeTail(pool) : null));
  const nativeObservation = (i: number) => selectedPools[i]!.creation.adapterType === 2 ? selectedPools[i]!.creation.observationState! : nativeTails[i]![0]!;
  const [tickerPda] = await deriveMimirBetaTickerPda(dependencies.deployment.mimirProgramId, args.ticker);
  const dynamicCapture = selectedPools.some((pool) => pool.creation.adapterType === 0 || pool.creation.adapterType === 1 || pool.creation.adapterType === 3);
  const staticAddresses = [tickerPda, ...(nativeTails.some(Boolean) || intervals.some(Boolean) || dynamicCapture ? [MIMIR_NATIVE_CLOCK_ADDRESS] : []),
    ...new Set(intervals.flatMap((r) => r ? mimirClassicIntervalPins(r, cluster) : [])),
    ...nativeTails.flatMap((tail, i) => tail ? [nativeObservation(i)] : []), ...selectedPools.flatMap((pool) => [...pool.creation.staticAccounts.map((account) => account.address),
    ...(pool.creation.observationState ? [pool.creation.observationState] : []),
    ...(pool.creation.adapterType === 0 || pool.creation.adapterType === 1 || pool.creation.adapterType === 3
      ? pool.readPlan.allAddresses : [])]), ...(await Promise.all(selectedPools.map((pool) => pool.creation.bindingVariant === "routeable"
      ? mimirDlmmRouteableEdgeArrays(pool) : []))).flat()];
  const context = await loadGlobalContext({ dependencies, minContextSlot: revalidated.slot, authority: args.authority,
    baseMint: args.baseMint, quoteMint: args.quoteMint, selectedSourceBindings: selectedPools.map((pool) => pool.creation),
    collateralAccount: args.creatorCollateralTokenAccount, allowCollateralFunding: args.allowCollateralFunding,
    oneCharTickers: isOneCharTicker(args.ticker), collateralOptional: isOneCharTicker(args.ticker), extraAddresses: staticAddresses });
  const staticRoles = new Map<Address, Set<string>>();
  for (const pool of selectedPools) for (const binding of pool.creation.staticAccounts) {
    const roles = staticRoles.get(binding.address) ?? new Set<string>(); roles.add(binding.role); staticRoles.set(binding.address, roles);
  }
  const facts: MimirBetaPhysicalAccountFact[] = uniqueAddresses([
    ...selectedPools.flatMap((pool) => pool.creation.staticAccounts.map((account) => account.address)), args.baseMint, args.quoteMint,
  ]).map((address) => {
    const account = context.accounts.get(address) ?? betaError("CREATION_CONTEXT_REQUIRED", "static binding account missing", address);
    const roles = staticRoles.get(address) ?? new Set<string>();
    const expectedExecutable = roles.has("market-program") || (roles.has("open-orders") && address === dependencies.deployment.systemProgramId);
    if (account.executable !== expectedExecutable) betaError("ACCOUNT_OWNER_MISMATCH", "static binding executable role mismatch", address);
    return { address, owner: account.owner, executable: account.executable };
  });
  const pdas = await deriveMimirBetaFeedPdas({ programId: dependencies.deployment.mimirProgramId, feedId });
  if (args.temporalMode !== undefined && args.temporalMode !== "current-point" && args.temporalMode !== "sampled-interval") {
    betaError("INVALID_ARGUMENT", "temporalMode invalid");
  }
  const temporalMode = args.temporalMode ?? (dlmmPoints.includes(true) ? "current-point" as const
    : !selectedPools.some((pool) => pool.creation.adapterType !== 3 && mimirCurrentPointAdmitted(pool.creation.adapterType, pool.creation.adapterVersion))
    ? undefined : committed ? betaError("INVALID_ARGUMENT", "resuming a point-capable source needs its bound temporalMode") : "current-point" as const);
  if (dlmmPoints.includes(true) && temporalMode !== "current-point") betaError("INVALID_ARGUMENT", "a current-point DLMM row needs temporalMode current-point");
  if (args.temporalMode === "current-point" && !selectedPools.some((pool, i) => (pool.creation.adapterType !== 3 || dlmmPoints[i])
    && mimirCurrentPointAdmitted(pool.creation.adapterType, pool.creation.adapterVersion))) betaError("INVALID_ARGUMENT", "temporalMode current-point is unsupported by the selected sources");
  const depthFloorBps = args.policy.depthFloorBps ?? 900;
  const sealedFloors = committed ? await Promise.all(selectedPools.map(async (pool, i) => {
    if (!(duals[i] || dlmmPoints[i] || pool.creation.bindingVariant === "routeable") || pool.creation.adapterType !== 3) return undefined;
    const [address] = await deriveMimirBetaPda({ programId: dependencies.deployment.mimirProgramId, seed: "source_config", values: [addressBytes(feedId), Uint8Array.of(i)] });
    const account = (await new FinalizedRpcReader(dependencies.rpc, "confirmed").accounts([address], context.slot)).value[0];
    return account?.owner === dependencies.deployment.mimirProgramId ? decodeMimirBetaLiveSource(account.data).minDepthTo50BpsNative : undefined;
  })) : [];
  const captureContext = dynamicCapture ? { observedSlot: context.slot,
    observedUnixTimestamp: mimirAuthenticClockUnix(context.captureAccounts.get(MIMIR_NATIVE_CLOCK_ADDRESS), context.slot, "creation capture Clock is not authentic") } : undefined;
  const legacyFloors = await Promise.all(selectedPools.map(async (pool, i) => {
    if (sealedFloors[i] !== undefined) return sealedFloors[i]!;
    let depth = pool.minDepthTo50BpsNative;
    if (pool.creation.adapterType === 3 && pool.creation.bindingVariant === "routeable" && !dlmmPoints[i]) {
      const addresses = await freshDynamicAccounts(pool, context.captureAccounts, false, captureContext);
      const binArrays = addresses.map((address) => context.captureAccounts.get(address)
        ?? betaError("PLAN_STALE", "routeable DLMM bin array missing", address));
      depth = await mimirBetaDlmmRouteableLegacyDepth({ pool: pool.pool,
        pair: context.captureAccounts.get(pool.pool) ?? betaError("PLAN_STALE", "routeable DLMM pair missing", pool.pool),
        baseMint: pool.baseMint, quoteMint: pool.quoteMint,
        binArrays: binArrays as [MimirBetaAccount, MimirBetaAccount, MimirBetaAccount] });
    }
    return conservativeMintOracleSourceConfigFloor(depth, depthFloorBps);
  }));
  const dlmmPointFloors = await Promise.all(selectedPools.map(async (pool, i) => {
    if (!(duals[i] || dlmmPoints[i]) || pool.creation.adapterType !== 3) return null;
    const nowUnix = mimirAuthenticClockUnix(context.captureAccounts.get(MIMIR_NATIVE_CLOCK_ADDRESS), context.slot, "DLMM point Clock is not authentic");
    const floor = await mimirDlmmPointPreflight(pool, context.captureAccounts, context.slot, nowUnix, sealedFloors[i], depthFloorBps);
    if (sealedFloors[i] !== undefined || !duals[i]) return floor;
    const nativeFloor = legacyFloors[i]!;
    return nativeFloor > floor
      ? mimirDlmmPointPreflight(pool, context.captureAccounts, context.slot, nowUnix, nativeFloor, depthFloorBps) : floor;
  }));
  const configuredPools = selectedPools.map((pool, i) => ({ ...pool,
    minLiquidityNative: 1n,
    minDepthTo50BpsNative: sealedFloors[i] ?? dlmmPointFloors[i] ?? legacyFloors[i]! }));
  const sourceArtifacts = await buildMimirBetaClassicSourceArtifacts({ programId: dependencies.deployment.mimirProgramId,
    feedId, baseMint: args.baseMint, quoteMint: args.quoteMint, pools: configuredPools, physicalAccounts: facts,
    ...(temporalMode ? { temporalMode, dlmmPointRows: dlmmPoints } : {}) });
  const pointMode = sourceArtifacts.artifacts.some((artifact) => artifact.source.temporalMode === "current-point");
  const planHash = await computeMimirBetaClassicPlanHash({ feedId, profile: args.policy.profile, riskTier: args.policy.riskTier,
    minSources: selectedPools.length, minVenues: sourceArtifacts.lifecycleGroupCount,
    minCorrelationGroups: sourceArtifacts.lifecycleGroupCount,
    maxDispersionBps: args.policy.maxDispersionBps, maxSourceActivityAgeSlots: args.policy.maxSourceActivityAgeSlots,
    priceExponent: args.policy.priceExponent, baseMint: args.baseMint, quoteMint: args.quoteMint,
    sourceSetRoot: sourceArtifacts.sourceSetRoot, staticAccountsRoot: sourceArtifacts.staticAccountsRoot,
    twap: pdas.twap[0], anchorPolicyHash: args.policy.anchorPolicyHash, adapterMask: sourceArtifacts.adapterMask });
  const init: MimirBetaClassicInitArgs = {
    baseMint: args.baseMint, quoteMint: args.quoteMint, sourceSetRoot: sourceArtifacts.sourceSetRoot,
    staticAccountsRoot: sourceArtifacts.staticAccountsRoot, anchorPolicyHash: args.policy.anchorPolicyHash,
    nativeExceptionHash: args.policy.nativeExceptionHash, adapterMask: sourceArtifacts.adapterMask,
    namespaceVersion: 1, planId: 0, planVersion: 0, hashSchemeVersion: 1, ringVersion: 1,
    profile: args.policy.profile, riskTier: args.policy.riskTier, sourceCount: selectedPools.length,
    minSources: selectedPools.length, minVenues: sourceArtifacts.lifecycleGroupCount,
    minCorrelationGroups: sourceArtifacts.lifecycleGroupCount,
    baseDecimals: context.baseMint!.decimals, quoteDecimals: context.quoteMint.decimals,
    bindingVariants: [...selectedPools.map((pool) => pool.creation.bindingVariant === "routeable" ? 1 : 0), ...Array(5 - selectedPools.length).fill(0)],
    priceExponent: args.policy.priceExponent, maxDispersionBps: args.policy.maxDispersionBps,
    maxSourceActivityAgeSlots: args.policy.maxSourceActivityAgeSlots, minCoverageRatioBps: args.policy.minCoverageRatioBps,
    maxConfidenceBps: args.policy.maxConfidenceBps, maxSnapshotAgeSlots: args.policy.maxSnapshotAgeSlots,
  };
  const initBytes = encodeMimirBetaClassicInitArgs(init);
  const snapshot = encodeMimirBetaProposalSnapshot({
    registryEpochAtProposal: context.registry.registryEpoch,
    adminRevisionAtProposal: context.admin.configRevision,
    refreshFeeDefaultLamportsAtProposal: context.admin.compositeRefreshFeeLamports,
    collateralAmountRawAtProposal: context.admin.collateralAmountRaw,
    collateralMintAtProposal: context.admin.collateralMint ?? betaError("CREATION_CONTEXT_REQUIRED", "collateral mint missing for current program ABI"),
    feeTreasuryAtProposal: context.admin.feeTreasury,
  });
  const proposalHash = await deriveMimirBetaProposalHash({ programId: dependencies.deployment.mimirProgramId, proposer: args.authority,
    feedId, registryStateHash: context.registry.stateHash, adminStateHash: context.admin.stateHash, legacyInitArgs: initBytes,
    snapshot, identityAsset: args.identity.asset, planHash });
  const [proposal] = await deriveMimirBetaPda({ programId: dependencies.deployment.mimirProgramId, seed: "feed_plan_proposal", values: [proposalHash] });
  const [agent] = await dependencies.identity.deriveAgentAccount(args.identity.asset); const [root] = await dependencies.identity.deriveRootConfig();
  const collateralMint = context.admin.collateralMint ?? betaError("CREATION_CONTEXT_REQUIRED", "collateral mint missing for current program ABI");
  const collateralTariffRaw = computeMimirBetaTickerTariff(context.admin.collateralAmountRaw, args.ticker);
  const proposalInstruction = () => buildMimirBetaIdentityProposalInstruction({ programId: dependencies.deployment.mimirProgramId,
    accounts: [instructionAccount(args.authority, true, true), instructionAccount(context.registry.address), instructionAccount(context.admin.address),
      instructionAccount(args.baseMint), instructionAccount(args.quoteMint), instructionAccount(proposal, false, true),
      instructionAccount(dependencies.deployment.systemProgramId)],
    init, identityAsset: args.identity.asset, variant });
  const oneCharFunding = isOneCharTicker(args.ticker) ? context.oneCharAllowance?.address ??
    betaError("CREATION_CONTEXT_REQUIRED", "one-character allowance context missing") : null;
  const collateralSpecs = (outerInstructionIndex: number): readonly ExpectedTransitionSpec[] => oneCharFunding
    ? [oneCharAllowanceTransition(oneCharFunding, dependencies.deployment.mimirProgramId)] : [
    accountTransition(args.creatorCollateralTokenAccount, "write", dependencies.deployment.tokenProgramId, 165,
      "debit the exact collateral amount from the creator token account"),
    accountTransition(collateralMint, "write", dependencies.deployment.tokenProgramId, 82,
      "decrease the exact collateral mint supply"),
    burnChecked({ address: args.creatorCollateralTokenAccount, tokenProgram: dependencies.deployment.tokenProgramId,
      mint: collateralMint, authority: args.authority, amountRaw: collateralTariffRaw,
      decimals: decodeMimirBetaSplMint(context.accounts.get(collateralMint) ?? betaError("CREATION_CONTEXT_REQUIRED", "collateral mint missing"),
        dependencies.deployment.tokenProgramId).decimals,
      outerInstructionIndex, description: "burn configured creation collateral with SPL Token BurnChecked" }),
  ];
  const proposalSpecs: readonly ExpectedTransitionSpec[] = [
    accountTransition(proposal, "create", dependencies.deployment.mimirProgramId, 608 + selectedPools.length * 392,
      "create identity-bound feed proposal", "feed-plan-proposal-v1"),
  ];
  const appendInstruction = (artifact: MimirBetaClassicSourceArtifact) => buildMimirBetaSourceAppendInstruction({
    programId: dependencies.deployment.mimirProgramId,
    accounts: [instructionAccount(proposal, false, true), ...artifact.staticAccounts.map((address) => instructionAccount(address)),
      ...(artifact.boostVault ? [instructionAccount(artifact.boostVault)] : [])],
    source: artifact.source, sourceRootProof: artifact.sourceRootProof, accountRootProof: artifact.accountRootProof,
  });
  const activationInstruction = () => {
    const sourceAccounts = sourceArtifacts.artifacts.flatMap((artifact) => [
      instructionAccount(artifact.sourceConfig, false, true), instructionAccount(artifact.sourceRing, false, true),
      ...(artifact.nativeProof ? [instructionAccount(artifact.nativeProof, false, true),
        instructionAccount(selectedPools[artifact.source.sourceIndex]!.creation.observationState!)] : []),
      ...artifact.staticAccounts.map((address) => instructionAccount(address)),
      ...(artifact.boostVault ? [instructionAccount(artifact.boostVault)] : []),
    ]);
    return buildMimirBetaIdentityActivationInstruction({ programId: dependencies.deployment.mimirProgramId,
      accounts: [instructionAccount(args.authority, true, true), instructionAccount(proposal, false, true),
        instructionAccount(args.authority, false, true), instructionAccount(pdas.feed[0], false, true),
        instructionAccount(pdas.sourcingPlan[0], false, true), instructionAccount(pdas.twap[0], false, true),
        instructionAccount(pdas.snapshot[0], false, true), instructionAccount(pdas.collateralLock[0], false, true),
        instructionAccount(dependencies.deployment.systemProgramId),
        instructionAccount(oneCharFunding ?? args.creatorCollateralTokenAccount, false, true), instructionAccount(collateralMint, false, true),
        instructionAccount(dependencies.deployment.tokenProgramId), ...sourceAccounts,
        instructionAccount(tickerPda, false, true),
        instructionAccount(agent, false, true), instructionAccount(root),
        instructionAccount(dependencies.deployment.physicalCollection, false, true), instructionAccount(args.identity.asset, true, true)],
      sourceBundleAccountCount: sourceAccounts.length, ticker: args.ticker });
  };
  const intervalNowUnix = intervals.some(Boolean)
    ? mimirAuthenticClockUnix(context.captureAccounts.get(MIMIR_NATIVE_CLOCK_ADDRESS), context.slot, "classic interval Clock is not authentic") : 0n;
  intervals.forEach((r, row) => { if (r === "damm-onlyb-interval-v1" || r === "damm-reserve-interval-v3") assertMimirClassicDammRecipePolicy({ row,
    version: r === "damm-onlyb-interval-v1" ? 1 : 3, pool: selectedPools[row]!.pool, poolAccount: context.captureAccounts.get(selectedPools[row]!.pool) }); });
  intervals.forEach((r) => { if (r) assertMimirClassicIntervalGeneration(r, context.captureAccounts, cluster); });
  const rowSources = await Promise.all(sourceArtifacts.artifacts.map(async (artifact, index): Promise<MimirFusedRowSource> => {
    const pool = selectedPools[index]!;
    const tail = nativeTails[index];
    const adapterAccounts = await freshAdapterAccounts(pool, context.captureAccounts, true, captureContext);
    const point = artifact.source.temporalMode === "current-point";
    const interval = intervals[index] ? mimirClassicIntervalRow({ adapterType: artifact.source.adapterType, adapterVersion: artifact.source.adapterVersion,
      adapterAccounts, recipe: intervals[index]!, cluster, pool: pool.pool }) : null;
    return { adapterType: artifact.source.adapterType, adapterVersion: artifact.source.adapterVersion, currentPoint: point, ...(duals[index] ? { dual: true } : {}),
      cluster: generationCluster(dependencies.deployment.cluster), ...interval?.temporal ? { temporal: interval.temporal } : {},
      ...(point && artifact.source.adapterType === 3 ? { temporal: mimirDlmmPointTemporal(cluster) } : {}),
      sourceConfig: artifact.sourceConfig, feedConfig: pdas.feed[0], sourcingPlan: pdas.sourcingPlan[0],
      adapterAccounts: interval ? interval.adapterAccounts : duals[index] && artifact.source.adapterType === 2 ? [...adapterAccounts.slice(0, 5), ...mimirExecutableGenerationPins(cluster).cpmm.slice(0, 2) as Address[]]
        : tail ? [...adapterAccounts, ...tail] : artifact.source.adapterType === 2 ? adapterAccounts.slice(0, 4) : adapterAccounts,
      witness: { feedId: addressBytes(feedId), sourceIndex: artifact.source.sourceIndex, ringVersion: 1, minSlotGap: point ? 0 : 1,
        expectedSourceConfigRevision: 1n, expectedSourceSetRevision: 1n, expectedPlanHash: planHash,
        sourceSetSiblings: artifact.sourceRootProof, accountsSiblings: artifact.accountRootProof } };
  }));
  const converterSources = await classicConverterSources(dependencies, args, assemblyMode !== false, context.slot);
  const classic = assemblyMode !== false ? null : await (async () => {
    const rows = rowSources.map((source, i) => mimirClassicRow({ ...source, role: "primary", dual: duals[i] }));
    const converterRows = converterSources.map((source) => mimirClassicRow({ ...source, role: "converter" }));
    assertMimirClassicConverterAdmitted(converterRows.map(({ recipe }) => recipe));
    const layout = mimirClassicExecutionLayout(rows.map(({ recipe }) => recipe), converterRows.map(({ recipe }) => recipe));
    const minSources = mimirClassicMinSources(rows.map(({ recipe }) => recipe), selectedPools.length);
    assertMimirClassicBoundedMajorityPossible(rows.map(({ recipe }) => recipe),
      sourceArtifacts.artifacts.map((artifact) => artifact.source.routeCorrelationGroup), minSources);
    assertMimirAbi1Capable({ cluster: dependencies.deployment.cluster, programId: dependencies.deployment.mimirProgramId,
      ...(dependencies.abi1Capability ? { capability: dependencies.abi1Capability } : {}), releaseRecipeScope: dependencies.abi1ReleaseRecipeScope,
      recipes: [...rows, ...converterRows].map(({ recipe }) => recipe), action: "fresh-creation", executionKind: "classic", converterSourceCount: converterRows.length });
    const [execution] = await deriveMimirClassicExecutionAddress(dependencies.deployment.mimirProgramId, addressBytes(feedId));
    const mode = mimirClassicSampleOnlyRows(layout, minSources).some((row) => mimirFusedRecipeNeedsWarmup(layout.descriptors[row]!)) ? "sample" as const : "publish" as const;
    const closure = buildMimirInitFusedClassicClosure({ programId: dependencies.deployment.mimirProgramId, payer: args.authority, execution, collateralLock: pdas.collateralLock[0],
      snapshot: pdas.snapshot[0], feedConfig: pdas.feed[0], sourcingPlan: pdas.sourcingPlan[0], registry: context.registry.address,
      feedId: addressBytes(feedId), layout, witnesses: [...rows, ...converterRows].map(({ witness }) => witness), primary: rows,
      ...(converterSources.length ? { converter: { feedConfig: converterSources[0]!.feedConfig, sourcingPlan: converterSources[0]!.sourcingPlan,
        sources: converterRows } } : {}) });
    const refresh = buildMimirFusedClassicInstruction({ programId: dependencies.deployment.mimirProgramId, snapshot: pdas.snapshot[0],
      registry: context.registry.address, execution, layout, primaryExternals: rows.map(({ externals }) => externals),
      converterExternals: converterRows.map(({ externals }) => externals),
      request: { feedId: addressBytes(feedId), declaredMaxSnapshotAge: args.policy.maxSnapshotAgeSlots, previousSnapshotRevision: 0n,
        nextSnapshotRevision: mode === "publish" ? 1n : 0n, componentCount: rows.length, sourceSetRevision: 1n, planHash,
        converterSourceCount: converterRows.length, feedConfigRevision: 1n, ringNewestSlots: [...rows, ...converterRows].map(() => 0n) } });
    return { layout, execution, mode, closure, refresh };
  })();
  const assertNativeReady = (activated: boolean) => {
    if (nativeTails.some(Boolean)) {
      const nowUnix = mimirAuthenticClockUnix(context.captureAccounts.get(MIMIR_NATIVE_CLOCK_ADDRESS), context.slot, "classic native Clock is not authentic");
      for (const [row, tail] of nativeTails.entries()) {
        if (!tail) continue;
        const pool = selectedPools[row]!; const observation = nativeObservation(row);
        const readiness = mimirClassicNativeRowReadiness({ row, pool, poolAccount: context.captureAccounts.get(pool.pool), observation,
          observationAccount: context.captureAccounts.get(observation), nowUnix, cluster: generationCluster(dependencies.deployment.cluster), dual: duals[row] });
        if (!readiness.ready && !duals[row]) throw new MimirClassicNativeNotReadyError(readiness, activated);
      }
    }
    if (classic?.mode === "publish") intervals.forEach((r, row) => {
      if (r !== "orca-marker-quiet") return;
      const marker = mimirClassicOrcaMarkerReadiness({ row, pool: selectedPools[row]!.pool, poolAccount: context.captureAccounts.get(selectedPools[row]!.pool),
        nowUnix: intervalNowUnix, cluster });
      if (!marker.ready) throw new MimirClassicNativeNotReadyError(marker, activated);
    });
  };
  const readyInstructions = classic?.closure ?? [];
  const readySnapshotInstructions = classic ? [classic.refresh] : [];
  const sampledWarming = classic?.mode === "sample";
  const warming = sampledWarming ? { snapshot: "warming" as const, readiness: initialMimirSampledReadiness() } : {};
  const activationOutputSpecs = (ready = true, snapshotReady = ready && !sampledWarming): readonly ExpectedTransitionSpec[] => [
    accountTransition(pdas.feed[0], "create", dependencies.deployment.mimirProgramId, 357, "create immutable-identity classic feed", "classic-feed-v1"),
    accountTransition(pdas.sourcingPlan[0], "create", dependencies.deployment.mimirProgramId, 320, "create canonical sourcing plan"),
    accountTransition(pdas.snapshot[0], "create", dependencies.deployment.mimirProgramId, 512,
      snapshotReady ? "create first fused classic snapshot" : "create awaiting-refresh snapshot sentinel",
      snapshotReady ? mimirClassicSnapshotCodec(nativeTails, intervals, duals) : undefined),
    accountTransition(pdas.collateralLock[0], "create", dependencies.deployment.mimirProgramId, 160, "create collateral lock",
      "mimir-exact-layout-v1"),
    assemblyMode !== false
      ? accountTransition(tickerPda, "create", dependencies.deployment.mimirProgramId, 43,
        "atomically claim canonical ticker", "ticker-claim-v1")
      : tickerTransition(context, tickerPda, dependencies),
    ...sourceArtifacts.artifacts.flatMap((artifact): ExpectedTransitionSpec[] => [
      accountTransition(artifact.sourceConfig, "create", dependencies.deployment.mimirProgramId, 384,
        `create source config ${artifact.source.sourceIndex}`, "source-config-v0"),
    ]),
    ...(ready && classic ? [accountTransition(classic.execution, "create", dependencies.deployment.mimirProgramId, classic.layout.exactLength,
      "create sealed classic execution", "classic-execution-v1")] : []),
  ];
  const activationSpecs = (outerInstructionIndex: number, ready = true): readonly ExpectedTransitionSpec[] => [
    ...identityTransitionSpecs(dependencies, agent, args.identity.asset),
    ...collateralSpecs(outerInstructionIndex),
    accountTransition(proposal, "close", null, null, "close and refund completed proposal"),
    ...activationOutputSpecs(ready),
  ];
  const activationCoreInstructions = selectedPools.length === 1
    ? [...await identityInstructions(dependencies, args.identity, args.authority), proposalInstruction(), appendInstruction(sourceArtifacts.artifacts[0]!), activationInstruction()]
    : [...await identityInstructions(dependencies, args.identity, args.authority), activationInstruction()];
  let readinessFused = !pointMode;
  const assertClassicReadyCompiles = async () => {
    const instructions = [...readyInstructions, ...readySnapshotInstructions];
    try {
      await compileMimirBetaTransactionV1({ feePayer: args.authority, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n, instructions });
    } catch (readyError) {
      if (!(readyError instanceof MimirBetaError) || readyError.code !== "TRANSACTION_TOO_LARGE") throw readyError;
      throw await mimirBetaPacketRefusal("classic:ready", args.authority, instructions,
        Object.fromEntries([...rowSources.map((row, i) => [`source${i}`, row.adapterAccounts] as const),
          ...converterSources.map((row, j) => [`converter${j}`, row.adapterAccounts] as const)]), readyError);
    }
  };
  if (assemblyMode === false && !pointMode) {
    try {
      await compileMimirBetaTransactionV1({ feePayer: args.authority, recentBlockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 0n, instructions: [...activationCoreInstructions, ...readyInstructions, ...readySnapshotInstructions] });
    } catch (error) {
      if (!(error instanceof MimirBetaError) || error.code !== "TRANSACTION_TOO_LARGE") throw error;
      await assertClassicReadyCompiles();
      readinessFused = false;
    }
  }
  // D0: proposal-init and source appends pack greedily, in order, ahead of the activation; a split happens only where the next unit fails to compile.
  type ClassicUnit = "proposal" | number;
  const unitInstruction = (unit: ClassicUnit) => unit === "proposal" ? proposalInstruction() : appendInstruction(sourceArtifacts.artifacts[unit]!);
  const identityPair = await identityInstructions(dependencies, args.identity, args.authority);
  const finalInstructions = (prefix: readonly ClassicUnit[]) => [...identityPair, ...prefix.map(unitInstruction), activationInstruction(),
    ...(readinessFused ? [...readyInstructions, ...readySnapshotInstructions] : [])];
  const compiles = async (instructions: readonly MimirBetaInstruction[]) => {
    try {
      await compileMimirBetaTransactionV1({ feePayer: args.authority, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n, instructions });
      return true;
    } catch (error) {
      if (error instanceof MimirBetaError && error.code === "TRANSACTION_TOO_LARGE") return false;
      throw error;
    }
  };
  const prepGroups: ClassicUnit[][] = []; let finalPrefix: ClassicUnit[] = [];
  let activationIds: { id: MimirBetaStepId; stage: "mimir-create"; signers: Address[]; writes: MimirBetaExpectedWrite[] }[] = [];
  const groupId = (group: readonly ClassicUnit[]): MimirBetaStepId => group[0] === "proposal" ? "classic:proposal-init" : `classic:source-append:${group[0]}` as MimirBetaStepId;
  const pack = async (fused: boolean) => {
    readinessFused = fused; prepGroups.length = 0; finalPrefix = [];
    if (selectedPools.length > 1) {
      const units: ClassicUnit[] = ["proposal", ...sourceArtifacts.artifacts.map((_, index) => index)];
      let current: ClassicUnit[] = [];
      for (const unit of units) {
        if (await compiles([...current, unit].map(unitInstruction))) { current.push(unit); continue; }
        if (current.length) prepGroups.push(current);
        current = [unit];
      }
      if (await compiles(finalInstructions(current))) finalPrefix = current; else prepGroups.push(current);
    }
    activationIds = [
      ...prepGroups.map((group) => ({ id: groupId(group), stage: "mimir-create" as const, signers: [args.authority], writes: [] })),
      { id: "classic:activate", stage: "mimir-create", signers: [args.authority, args.identity.asset], writes: [] },
    ];
  };
  await pack(assemblyMode === false && pointMode ? true : readinessFused);
  const draftFor = async (fused: boolean) => {
    const ids = fused ? activationIds : [...activationIds,
      { id: "classic:ready" as MimirBetaStepId, stage: "mimir-create" as const, signers: [args.authority], writes: [] }];
    const draftSteps = stepsFromIds(args.authority, ids);
    const draftPayload = { schema: "mimir-beta-draft", version: 1, kind: "classic", deployment: dependencies.deployment,
      authority: args.authority, ticker: args.ticker, baseMint: args.baseMint, quoteMint: args.quoteMint, pools: draftPools,
      identity: args.identity, collateralTokenAccount: args.creatorCollateralTokenAccount, policy: args.policy,
      registry: { address: context.registry.address, stateHash: context.registry.stateHash, epoch: context.registry.registryEpoch },
      admin: { address: context.admin.address, stateHash: context.admin.stateHash, revision: context.admin.configRevision },
      proposalSnapshot: snapshot, feedId, feed: pdas.feed[0], proposal, planHash, configByteHash: await sha256(initBytes), steps: draftSteps,
      ...(variant !== 0 ? { variant } : {}), ...(args.solConversionSourceConfig ? { solConversionSourceConfig: args.solConversionSourceConfig } : {}),
      ...(nativeTails.some(Boolean) || intervals.some(Boolean)
        ? { recipes: nativeTails.map((tail, i) => intervals[i] ?? (duals[i] ? "dual-native-point" : tail ? "native-bounded" : "spot")) } : {}) };
    return { draftSteps, draft: await createDraftHash(draftPayload) };
  };
  if (assemblyMode === false && pointMode) {
    const frozenDraftHash = receiptCount > 0 ? (await draftFor(true)).draft.draftHash : null;
    const probePrefix: ClassicUnit[] = selectedPools.length === 1 ? ["proposal", 0] : finalPrefix;
    const fused = receiptCount > 0
      ? args.receipts!.every((receipt) => receipt.draftHash === frozenDraftHash)
      : probePrefix[0] === "proposal" &&
        await classicFusedPointFits(dependencies, args.authority, finalInstructions(probePrefix), context.slot);
    if (!fused) { await pack(false); await assertClassicReadyCompiles(); }
  }
  const { draftSteps, draft } = await draftFor(readinessFused);
  const admissionInputs = dependencies.consumerAdmission ?? {};
  const classicAdmission = !classic ? {} : { consumerAdmission: await preflightMimirConsumerAdmissionV1({ ...admissionInputs, capability: dependencies.abi1Capability,
    cell: mimirClassicCellSignature(classic.layout.descriptors, classic.layout.componentCount),
    ...await (async () => {
      const init = [...readyInstructions, ...readySnapshotInstructions];
      const fresh = finalInstructions(selectedPools.length === 1 ? ["proposal", 0] : finalPrefix);
      const cu = (action: "init" | "fresh-creation", instructions: readonly MimirBetaInstruction[], evidence?: MimirCuEvidenceA2) =>
        verifyMimirCuEvidenceA2({ ...(dependencies.abi1Capability ? { capability: dependencies.abi1Capability } : {}), action, payer: args.authority, instructions, evidence: evidence ?? null });
      return { initializer: { payer: args.authority, instructions: init, cu: await cu("init", init, admissionInputs.initializerCu) },
        freshCreation: { payer: args.authority, instructions: fresh, cu: await cu("fresh-creation", fresh, admissionInputs.freshCreationCu) } };
    })() }) };
  const target: ReviewTarget = { kind: "classic", feedId, feed: pdas.feed[0], identityAsset: args.identity.asset,
    ticker: args.ticker, displayName: null, displayNameInstruction: null };
  const steps = await hydrateReviewedSteps({ draftHash: draft.draftHash, steps: draftSteps, receipts: args.receipts ?? [],
    targets: new Map(draftSteps.map((step) => [step.stepId, target])) });
  const plan: MimirBetaUnsignedPlan = { schema: "mimir-beta-unsigned-plan", version: 1, kind: "classic", draftHash: draft.draftHash,
    cluster: dependencies.deployment.cluster, programId: dependencies.deployment.mimirProgramId, authority: args.authority,
    feedId, feed: pdas.feed[0], identityAsset: args.identity.asset, ticker: args.ticker, displayName: null, steps,
    ...(variant !== 0 ? { variant } : {}) };
  const reconciliation = reconcileCreation(dependencies, { draftHash: draft.draftHash, steps, receipts: args.receipts ?? [],
    observations: args.observations ?? [], observedSlot: context.slot });
  const activationState = reconciliation.steps.find(({ stepId }) => stepId === "classic:activate")?.state;
  if (variant !== 0 && receiptCount > 0 && ["blocked", "reviewable", "failed", "expired"].includes(activationState ?? "reviewable") &&
      await isMimirBetaVariantOccupied({ ...occupancy, variant })) {
    betaError("VARIANT_TAKEN", "frozen feed variant was activated by another journey", feedId);
  }
  const step = steps.find((candidate) => candidate.stepId === reconciliation.nextStepId) ?? null;
  if (!step || reconciliation.action !== "review-next-step" && reconciliation.action !== "retry-once") return { ...preparedBase({ draft, selectedPools: draftPools, plan, reconciliation, next: null }), ...warming, ...classicAdmission, resolvedVariant: variant, feedId,
    ...(temporalMode ? { temporalMode } : {}) };
  if (assemblyMode === false) assertNativeReady(step.stepId === "classic:ready");
  const selectClassicStep = (candidate: MimirBetaPlanStep): FundingStepSelection & { readonly transientAddresses: readonly Address[] } => {
    let instructions: readonly MimirBetaInstruction[];
    let specs: readonly ExpectedTransitionSpec[];
    let transientAddresses: readonly Address[] = [];
    const prep = prepGroups.find((group) => groupId(group) === candidate.stepId);
    if (prep) {
    const appends = prep.filter((unit): unit is number => unit !== "proposal");
    instructions = prep.map(unitInstruction);
    specs = prep[0] === "proposal" ? proposalSpecs : [accountTransition(proposal, "write", dependencies.deployment.mimirProgramId,
      608 + selectedPools.length * 392, `append canonical source ${appends.join(", ")}`)];
    } else if (candidate.stepId === "classic:proposal-init" || candidate.stepId.startsWith("classic:source-append:")) {
    betaError("PROGRAM_ABI_MISMATCH", "source append ordinal missing");
    } else if (candidate.stepId === "classic:activate") {
    if (selectedPools.length === 1) {
      instructions = readinessFused ? [...activationCoreInstructions, ...readyInstructions, ...readySnapshotInstructions] : activationCoreInstructions;
      specs = [...identityTransitionSpecs(dependencies, agent, args.identity.asset), ...collateralSpecs(4),
        ...activationOutputSpecs(readinessFused)];
      transientAddresses = [proposal];
    } else {
      instructions = finalInstructions(finalPrefix);
      specs = finalPrefix[0] === "proposal"
        ? [...identityTransitionSpecs(dependencies, agent, args.identity.asset), ...collateralSpecs(2 + finalPrefix.length), ...activationOutputSpecs(readinessFused)]
        : activationSpecs(2 + finalPrefix.length, readinessFused);
      if (finalPrefix[0] === "proposal") transientAddresses = [proposal];
    }
    } else if (candidate.stepId === "classic:ready" && classic) {
    instructions = [...readyInstructions, ...readySnapshotInstructions];
    specs = [accountTransition(classic.execution, "create", dependencies.deployment.mimirProgramId, classic.layout.exactLength,
      "create sealed classic execution", "classic-execution-v1"),
      ...sampledWarming ? [] : [accountTransition(pdas.snapshot[0], "write", dependencies.deployment.mimirProgramId, 512,
        "publish first fused classic snapshot", mimirClassicSnapshotCodec(nativeTails, intervals, duals))]];
    } else betaError("PROGRAM_ABI_MISMATCH", "unknown classic beta step");
    return { instructions, specs, transientAddresses,
      ...(transientAddresses.length ? { rentSpecs: proposalSpecs } : {}),
      ...(candidate.stepId === "classic:activate" ? { identities: [args.identity] } : {}) };
  };
  const selectedStep = selectClassicStep(step);
  let { instructions, specs, transientAddresses } = selectedStep;
  if (assemblyMode !== false) {
    if (selectedPools.length !== 1) {
      betaError("PROGRAM_ABI_MISMATCH", "composite assembly requires exactly one Classic source");
    }
    instructions = activationCoreInstructions;
    specs = [...identityTransitionSpecs(dependencies, agent, args.identity.asset), ...collateralSpecs(4), ...activationOutputSpecs(false)];
    return { selectedPools: draftPools, resolvedVariant: variant, contextSlot: context.slot, feedId, feed: pdas.feed[0], sourceConfig: sourceArtifacts.artifacts[0]!.sourceConfig,
      sourceRing: sourceArtifacts.artifacts[0]!.sourceRing, rowSources, currentPoint: pointMode,
      tickerPda, ticker: args.ticker, identity: args.identity,
      canonicalDraftJson: draft.canonicalDraftJson, draftHash: draft.draftHash, instructions, specs,
      proposalSpecs, transientAddresses, observedRows: context.captureAccounts, assertNativeReady };
  }
  const activationRemaining = steps.slice(step.ordinal).some((candidate) => candidate.stepId === "classic:activate");
  if (oneCharFunding && activationRemaining) requireOneCharAllowance(context, 1);
  if (args.allowCollateralFunding && !oneCharFunding) {
    const requiredAmountRaw = activationRemaining
      ? computeMimirBetaTickerTariff(context.admin.collateralAmountRaw, args.ticker) : 0n;
    const fullPurchase = args.fullCollateralPurchase === true && requiredAmountRaw > 0n;
    const funding = args.callerPrefix?.funding;
    if (fullPurchase && !funding?.coversBurn || (context.collateralAccount?.amount ?? 0n) + (funding?.minimumCreditRaw ?? 0n) < requiredAmountRaw) {
      const fundingCosts = args.estimateFundingCosts && requiredAmountRaw > 0n
        ? await estimateFundingCosts({ dependencies, authority: args.authority, minContextSlot: context.slot,
          steps: steps.slice(step.ordinal).map(selectClassicStep),
          identities: steps.slice(step.ordinal).flatMap((candidate) => selectClassicStep(candidate).identities ?? []),
          ...(context.collateralAccount === null ? { externallyCreatedCollateralAccount: args.creatorCollateralTokenAccount } : {}) })
        : undefined;
      throwCollateralFundingRequired({ context, authority: args.authority, tokenAccount: args.creatorCollateralTokenAccount,
        draftHash: draft.draftHash, requiredAmountRaw, ...(fundingCosts ? { fundingCosts } : {}),
        resolvedVariant: variant, feedId, selectedPools: draftPools, ...(fullPurchase ? { fullPurchase } : {}) });
    }
  }
  const next = await prepareReview({ dependencies, contextSlot: context.slot, strictSimulation: pointMode, draftHash: draft.draftHash, plan, step, instructions, specs,
    transientAddresses, target, observedRows: context.captureAccounts, ...(args.callerPrefix ? { callerPrefix: args.callerPrefix } : {}) });
  assertRetryReviewBinding({ action: reconciliation.action, receipts: args.receipts ?? [], next });
  const reviewedPlan = { ...plan, steps: plan.steps.map((candidate) => candidate.stepId === next.step.stepId ? next.step : candidate) };
  return { ...preparedBase({ draft, selectedPools: draftPools, plan: reviewedPlan, reconciliation, next }), ...warming, ...classicAdmission, resolvedVariant: variant, feedId,
    ...(temporalMode ? { temporalMode } : {}) };
}

async function prepareConfirmedCreation<T extends PrepareSimpleFeedArgs | PrepareCompositeFeedArgs>(
  dependencies: CreationDependencies, args: T, rpc: MimirBetaReconciliationRpc,
  prepare: (dependencies: CreationDependencies, args: T) => Promise<MimirBetaPreparedCreation>,
): Promise<MimirBetaPreparedCreation> {
  const receipts = args.receipts ?? [];
  const observations = await observeMimirBetaConfirmedReceiptChain({ rpc, receipts });
  const floor = observations.reduce((slot, observation) => observation.state === "confirmed" || observation.state === "finalized" || observation.state === "expired"
    ? [slot, observation.observedSlot, observation.accountContextSlot].reduce((a, b) => a > b ? a : b) : slot, 0n);
  const planningRpc = new Proxy(dependencies.rpc, {
    get(target, key) {
      if (key === "getAccountInfo" || key === "getMultipleAccounts" || key === "simulateTransaction") {
        return (input: never, config: { minContextSlot?: bigint }) => {
          const pinned = { ...config, commitment: "confirmed", minContextSlot: config.minContextSlot !== undefined && config.minContextSlot > floor ? config.minContextSlot : floor };
          const request = key === "simulateTransaction" ? target.simulateTransaction(input, pinned as never) : rpc[key](input, pinned);
          return { send: async () => {
            const response = await request.send();
            const rawSlot = (response as { context?: { slot?: unknown } } | null)?.context?.slot;
            const slot = typeof rawSlot === "bigint" ? rawSlot : typeof rawSlot === "number" && Number.isSafeInteger(rawSlot) ? BigInt(rawSlot) : -1n;
            if (slot < pinned.minContextSlot) betaError("RPC_CONTEXT_MISMATCH", "confirmed preparation context regressed");
            return response;
          } };
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const discovery = {
    listPoolSources: () => dependencies.discovery.listPoolSources(),
    searchSpotPools: (request: Parameters<MimirBetaPoolDiscovery["searchSpotPools"]>[0]) => dependencies.discovery.searchSpotPools(request),
    revalidateSelectedPools: async (request: Parameters<MimirBetaPoolDiscovery["revalidateSelectedPools"]>[0]) => {
      const result = await dependencies.discovery.revalidateSelectedPools(request);
      if (result.slot < floor) betaError("RPC_CONTEXT_MISMATCH", "confirmed pool revalidation context regressed");
      return result;
    },
  };
  const scoped = { ...dependencies, rpc: planningRpc, discovery };
  confirmedPreparation.set(planningRpc, observations);
  const prepared = await prepare(scoped, { ...args, observations: [] });
  if (prepared.next) {
    if (prepared.next.review.simulation.contextSlot < floor) betaError("RPC_CONTEXT_MISMATCH", "confirmed review simulation context regressed");
    const refreshed = await observeMimirBetaConfirmedReceiptChain({ rpc, receipts,
      minContextSlot: prepared.next.review.simulation.contextSlot });
    for (let index = 0; index < observations.length; index += 1) {
      const prior = observations[index]!; const current = refreshed[index]!;
      if (prior.state === "expired" && (current.state !== "expired" || current.rollback !== prior.rollback ||
        current.messageHash !== prior.messageHash || current.accountContextSlot < prior.accountContextSlot)) {
        betaError("RECONCILIATION_CONFLICT", "expired stage changed during next-stage preparation");
      }
      if ((prior.state === "confirmed" || prior.state === "finalized") && (current.state !== prior.state || current.observedSlot !== prior.observedSlot ||
        current.messageHash !== prior.messageHash || current.accountContextSlot < prior.accountContextSlot)) {
        betaError("RECONCILIATION_CONFLICT", "confirmed prerequisite changed during next-stage preparation");
      }
    }
  }
  return prepared;
}

export function prepareMimirBetaSimpleFeedConfirmed(dependencies: CreationDependencies, args: PrepareSimpleFeedArgs,
  rpc: MimirBetaReconciliationRpc): Promise<MimirBetaPreparedCreation> {
  return prepareConfirmedCreation(dependencies, args, rpc, prepareMimirBetaSimpleFeed);
}

export function prepareMimirBetaCompositeFeedConfirmed(dependencies: CreationDependencies, args: PrepareCompositeFeedArgs,
  rpc: MimirBetaReconciliationRpc): Promise<MimirBetaPreparedCreation> {
  return prepareConfirmedCreation(dependencies, args, rpc, prepareMimirBetaCompositeFeed);
}

export async function prepareMimirBetaSimpleFeed(dependencies: CreationDependencies,
  args: PrepareSimpleFeedArgs): Promise<MimirBetaPreparedCreation> {
  return prepareMimirBetaSimpleFeedInternal(dependencies, { ...args, ticker: canonicalizeMimirBetaTicker(args.ticker) }, false);
}

type ExistingLiveFeed = Awaited<ReturnType<typeof loadMimirBetaExistingLiveFeed>>;

async function settledInOrder<T>(work: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(work);
  return settled.map((entry) => { if (entry.status === "rejected") throw entry.reason; return entry.value; });
}

async function resolveExistingSource(dependencies: CreationDependencies, sourceConfig: Address,
  sourceAccount: MimirBetaAccount, minContextSlot: bigint, nativeSourceSet = false): Promise<Readonly<{
    sourceConfig: Address; sourceRing: Address; loaded: ExistingLiveFeed;
  }>> {
  const program = dependencies.deployment.mimirProgramId;
  if (sourceAccount.owner !== program || sourceAccount.executable || sourceAccount.data.length !== 384) {
    betaError("ACCOUNT_MALFORMED", "existing source config envelope mismatch", sourceConfig);
  }
  let initial;
  try { initial = decodeMimirBetaLiveSource(sourceAccount.data); }
  catch { return betaError("ACCOUNT_MALFORMED", "existing source config codec rejected state", sourceConfig); }
  const feedId = bytesAddress(initial.feedId); const baseMint = bytesAddress(initial.baseMint); const quoteMint = bytesAddress(initial.quoteMint);
  const pdas = await deriveMimirBetaFeedPdas({ programId: program, feedId });
  const [expectedInitial] = await deriveMimirBetaPda({ programId: program, seed: "source_config",
    values: [initial.feedId, Uint8Array.of(initial.sourceIndex)] });
  if (sourceConfig !== expectedInitial) betaError("ACCOUNT_MALFORMED", "existing source pointer is not its canonical index PDA", sourceConfig);
  const preliminary = await new FinalizedRpcReader(dependencies.rpc).accounts([pdas.feed[0], pdas.sourcingPlan[0]], minContextSlot);
  const [feedAccount, planAccount] = preliminary.value;
  if (!feedAccount || !planAccount || [feedAccount, planAccount].some((account) => account.owner !== program || account.executable)) {
    betaError("CREATION_CONTEXT_REQUIRED", "existing feed and sourcing plan are missing", sourceConfig);
  }
  let feed; let plan;
  try { feed = decodeMimirBetaLiveFeed(feedAccount.data); plan = await decodeMimirBetaLivePlan(planAccount.data); }
  catch { return betaError("ACCOUNT_MALFORMED", "existing feed or sourcing plan codec rejected state", sourceConfig); }
  if (feed.lifecycleState !== 3 || plan.status !== 0 || plan.minSources < 1 || plan.minSources > 5 ||
      !bytesEqual(feed.feedId, initial.feedId) || !bytesEqual(plan.feedId, initial.feedId) ||
      !bytesEqual(feed.baseMint, initial.baseMint) || !bytesEqual(feed.quoteMint, initial.quoteMint) ||
      !bytesEqual(feed.defaultSourcingPlan, addressBytes(pdas.sourcingPlan[0]))) {
    betaError("ACCOUNT_MALFORMED", "existing feed and sourcing plan identity mismatch", sourceConfig);
  }
  const sourcePdas = await Promise.all(Array.from({ length: plan.minSources }, (_, sourceIndex) => deriveMimirBetaPda({
    programId: program, seed: "source_config", values: [initial.feedId, Uint8Array.of(sourceIndex)] })));
  const sourceRead = await new FinalizedRpcReader(dependencies.rpc).accounts(sourcePdas.map(([address]) => address), preliminary.slot);
  const sources = sourceRead.value.map((account, index) => {
    if (!account || account.owner !== program || account.executable || account.data.length !== 384) {
      return betaError("ACCOUNT_MALFORMED", `existing source config ${index} envelope mismatch`, sourcePdas[index]![0]);
    }
    try { return decodeMimirBetaLiveSource(account.data); }
    catch { return betaError("ACCOUNT_MALFORMED", `existing source config ${index} codec rejected state`, sourcePdas[index]![0]); }
  });
  const selected = await settledInOrder(sources.map(async (source, index) => {
    let search;
    try { search = await dependencies.discovery.searchSpotPools({ baseMint, quoteMint, query: bytesAddress(source.poolOrMarket), maxPools: 1 }); }
    catch (error) {
      if (error instanceof MimirBetaError && error.code === "NO_ELIGIBLE_POOLS") {
        betaError("PLAN_STALE", `existing source ${index} has no unique exact discovered pool`, sourcePdas[index]![0]);
      }
      throw error;
    }
    const matches = search.pools.filter((pool): pool is MimirBetaEligiblePool => pool.eligibility === "eligible" &&
      pool.programId === bytesAddress(source.programId) &&
      pool.pool === bytesAddress(source.poolOrMarket) && pool.baseMint === baseMint && pool.quoteMint === quoteMint &&
      pool.creation.adapterType === source.adapterType && pool.baseVault === bytesAddress(source.baseVault) &&
      pool.quoteVault === bytesAddress(source.quoteVault) && pool.creation.tokenProgramId === bytesAddress(source.tokenProgram) &&
      pool.creation.vaultAuthority === bytesAddress(source.vaultAuthority));
    if (matches.length !== 1) betaError("PLAN_STALE", `existing source ${index} has no unique exact discovered pool`, sourcePdas[index]![0]);
    return { pool: matches[0]!, slot: search.observedSlot };
  }));
  if (new Set(selected.map(({ pool }) => `${pool.programId}:${pool.pool}:${pool.baseMint}:${pool.quoteMint}:${pool.creation.adapterType}`)).size !== selected.length) {
    betaError("PLAN_STALE", "existing source set contains duplicate discovered identities", sourceConfig);
  }
  const captured = selected.length === 1 && selected[0]!.slot >= sourceRead.slot ? selected[0]!.slot : undefined;
  const loaded = await loadMimirBetaExistingLiveFeed(dependencies, selected.map(({ pool }) => pool), undefined, true, undefined, undefined, nativeSourceSet, feedId,
    false, [], captured);
  if (loaded.coherentSlot < sourceRead.slot || loaded.feedId !== feedId || loaded.sourcePdas[initial.sourceIndex]?.sourceConfig[0] !== sourceConfig) {
    betaError("PLAN_STALE", "existing source closure drifted during authoritative reload", sourceConfig);
  }
  return { sourceConfig, sourceRing: loaded.sourcePdas[initial.sourceIndex]!.sourceRing[0], loaded };
}

/**
 * Program-fixed observation quality of one pool `(confidence, spread)` in bps: CPMM/AMM-v4/PumpSwap 1/0, DAMM-v2 5/5,
 * Orca/Raydium CLMM 5/tick spacing, DLMM bin step/bin step (each capped at 10,000). Every ring and converter snapshot carries at least it.
 */
export function mimirBetaSourceQualityFloorBps(family: MimirBetaSourceFamily, poolData: Uint8Array | null | undefined): Readonly<{ confidenceBps: number; spreadBps: number }> {
  const u16 = (offset: number) => {
    if (!poolData || poolData.length < offset + 2) return betaError("CREATION_CONTEXT_REQUIRED", `${family} pool state missing for quality admission`);
    return Math.min(new DataView(poolData.buffer, poolData.byteOffset, poolData.byteLength).getUint16(offset, true), 10_000);
  };
  switch (family) {
    case "raydium-cpmm": case "raydium-amm-v4": case "pumpswap": return { confidenceBps: 1, spreadBps: 0 };
    case "meteora-damm-v2": return { confidenceBps: 5, spreadBps: 5 };
    case "orca-whirlpool": return { confidenceBps: 5, spreadBps: u16(41) };
    case "raydium-clmm": return { confidenceBps: 5, spreadBps: u16(235) };
    case "meteora-dlmm": { const step = u16(80); return { confidenceBps: step, spreadBps: step }; }
  }
}

/**
 * Composite publication caps: a component ring must satisfy both caps (Custom 79); the SOL converter snapshot confidence must
 * satisfy the confidence cap (QuoteNotOk), its dispersion being cross-source. Refuses every violating row before any review.
 */
export function assertMimirBetaCompositeQuality(policy: Pick<MimirBetaCompositePolicy, "maxComponentConfidenceBps" | "maxComponentDispersionBps">,
  rows: readonly Readonly<{ role: "component" | "converter"; position: number; sourceConfig: Address; pool: MimirBetaEligiblePool; poolData: Uint8Array | null | undefined }>[]): void {
  const violations: MimirBetaCompositeQualityViolation[] = [];
  for (const row of rows) {
    const floor = mimirBetaSourceQualityFloorBps(row.pool.family, row.poolData);
    const base = { role: row.role, position: row.position, sourceConfig: row.sourceConfig, pool: row.pool.pool, family: row.pool.family };
    if (floor.confidenceBps > policy.maxComponentConfidenceBps) {
      violations.push({ ...base, metric: "confidence", valueBps: floor.confidenceBps, capBps: policy.maxComponentConfidenceBps });
    }
    if (row.role === "component" && floor.spreadBps > policy.maxComponentDispersionBps) {
      violations.push({ ...base, metric: "dispersion", valueBps: floor.spreadBps, capBps: policy.maxComponentDispersionBps });
    }
  }
  if (violations.length) throw new MimirBetaCompositeQualityError(violations);
}

const generationCluster = (cluster: MimirBetaFacadeDeployment["cluster"]) => cluster === "mainnet-beta" ? "mainnet" as const : cluster;

function existingRowSource(loaded: ExistingLiveFeed, index: number, cluster: MimirBetaFacadeDeployment["cluster"]): MimirFusedRowSource {
  const artifact = loaded.artifacts.artifacts[index] ?? betaError("ACCOUNT_MALFORMED", "required source is outside existing feed closure");
  const state = loaded.sourceStates[index]!;
  const point = state.source.temporalMode === "current-point";
  return { adapterType: artifact.source.adapterType, adapterVersion: artifact.source.adapterVersion, currentPoint: point,
    ...(point && artifact.source.adapterType === 3 ? { temporal: mimirDlmmPointTemporal(generationCluster(cluster)) } : {}),
    cluster: generationCluster(cluster), accountsBindingVersion: loaded.plan.accountsBindingVersion, sourceConfig: artifact.sourceConfig, feedConfig: loaded.pdas.feed[0], sourcingPlan: loaded.pdas.sourcingPlan[0],
    adapterAccounts: artifact.source.adapterType === 2 && ((state.ring?.windowFlags ?? 0) & 2) === 0
      ? loaded.adapterAccounts[index]!.slice(0, 4) : loaded.adapterAccounts[index]!,
    witness: { feedId: addressBytes(loaded.feedId), sourceIndex: index, ringVersion: loaded.plan.ringVersion, minSlotGap: point ? 0 : 1,
      expectedSourceConfigRevision: state.source.sourceConfigRevision, expectedSourceSetRevision: state.source.sourceSetRevision,
      expectedPlanHash: loaded.plan.planHash, sourceSetSiblings: artifact.sourceRootProof, accountsSiblings: artifact.accountRootProof } };
}


const WSOL_MINT = "So11111111111111111111111111111111111111112" as Address;

/** Rows tag-89 sample-only matures before the first publish. */
export const mimirClassicSampleOnlyRows = (layout: MimirClassicExecutionLayout, minSources: number) =>
  layout.descriptors.flatMap((descriptor, row) => descriptor.moduleLength !== 0 || row >= layout.componentCount
    || (minSources < layout.componentCount && row < layout.componentCount) ? [row] : []);

/** Authenticated rows of the embedded SOL/USDC converter: an existing live classic SOL/non-SOL feed named by its SourceConfig0. */
async function converterEligibility(dependencies: CreationDependencies, loaded: ExistingLiveFeed, sourceConfig: Address,
  minContextSlot: bigint): Promise<MimirBetaConverterEligibility> {
  return evaluateMimirBetaConverterLegs({ rpc: dependencies.rpc, cluster: generationCluster(dependencies.deployment.cluster), feedId: loaded.feedId,
    sourceConfig, pools: loaded.pools, maxActivityAgeSlots: Math.min(loaded.feed.maxSourceActivityAgeSlots, loaded.plan.maxSourceActivityAgeSlots), minContextSlot });
}

async function assertConverterEligible(dependencies: CreationDependencies, loaded: ExistingLiveFeed, sourceConfig: Address, minContextSlot: bigint): Promise<void> {
  const eligibility = await converterEligibility(dependencies, loaded, sourceConfig, minContextSlot);
  if (!eligibility.eligible) throw new MimirBetaConverterIneligibleError(eligibility);
}

/**
 * Every-leg eligibility of an existing SOL/USDC classic feed as an embedded converter (its SourceConfig0), for converter pickers.
 * Creation re-evaluates the selected converter before collateral funding facts and each pre-activation review.
 */
export async function inspectMimirBetaConverterEligibility(dependencies: CreationDependencies, args: Readonly<{ feedId: Address }>): Promise<MimirBetaConverterEligibility> {
  const [sourceConfig] = await deriveMimirBetaPda({ programId: dependencies.deployment.mimirProgramId, seed: "source_config",
    values: [addressBytes(args.feedId), Uint8Array.of(0)] });
  const read = await new FinalizedRpcReader(dependencies.rpc).accounts([sourceConfig]);
  const account = read.value[0] ?? betaError("CREATION_CONTEXT_REQUIRED", "SOL conversion source config missing", sourceConfig);
  const { loaded } = await resolveExistingSource(dependencies, sourceConfig, account, read.slot, true);
  if (loaded.pools[0]!.baseMint !== WSOL_MINT || loaded.pools[0]!.quoteMint === WSOL_MINT) {
    betaError("INVALID_ARGUMENT", "SOL conversion feed must be SOL-based and non-SOL-quoted", sourceConfig);
  }
  return converterEligibility(dependencies, loaded, sourceConfig, read.slot);
}

export interface MimirBetaClassicNativeRowStatus {
  readonly row: number;
  readonly pool: Address;
  readonly family: string;
  readonly readiness: MimirClassicNativeReadiness;
  readonly state: MimirClassicNativeRebuildState;
  /** DLMM only: estimated seconds of uninterrupted activity until the native window qualifies; null without an estimate. */
  readonly aboutSecs: bigint | null;
  /** `DUAL_NATIVE_POINT_V1` row: while not ready it publishes the current point instead of refusing. */
  readonly dual: boolean;
}

/** Native-history state of every native-bounded primary row of an existing classic feed, at finalized chain Clock time; `[]` without an execution. */
export async function inspectMimirBetaClassicNativeReadiness(dependencies: CreationDependencies, args: Readonly<{ feedId: Address }>):
  Promise<Readonly<{ feedId: Address; slot: bigint; rows: readonly MimirBetaClassicNativeRowStatus[] }>> {
  const program = dependencies.deployment.mimirProgramId;
  const [sourceConfig] = await deriveMimirBetaPda({ programId: program, seed: "source_config", values: [addressBytes(args.feedId), Uint8Array.of(0)] });
  const read = await new FinalizedRpcReader(dependencies.rpc).accounts([sourceConfig]);
  const account = read.value[0] ?? betaError("CREATION_CONTEXT_REQUIRED", "classic source config missing", sourceConfig);
  const { loaded } = await resolveExistingSource(dependencies, sourceConfig, account, read.slot, true);
  const [execution] = await deriveMimirClassicExecutionAddress(program, addressBytes(loaded.feedId));
  const observations = await Promise.all(loaded.pools.map(async (pool) => !mimirClassicNativeAdmitted(pool.creation.adapterType) ? null
    : pool.creation.adapterType === 2 ? pool.creation.observationState ?? null : (await mimirClassicNativeTail(pool))[0]!));
  const reads = uniqueAddresses([execution, MIMIR_NATIVE_CLOCK_ADDRESS, ...loaded.pools.map(({ pool }) => pool),
    ...observations.filter((value): value is Address => value !== null)]);
  const cohort = await new FinalizedRpcReader(dependencies.rpc).accounts(reads, read.slot);
  const rows = new Map(reads.map((entry, i) => [entry, cohort.value[i] ?? null] as const));
  const executionAccount = rows.get(execution);
  if (!executionAccount) return { feedId: loaded.feedId, slot: cohort.slot, rows: [] };
  const state = await decodeMimirClassicExecutionAccount({ programId: program, address: execution, owner: executionAccount.owner, data: executionAccount.data });
  const nowUnix = mimirAuthenticClockUnix(rows.get(MIMIR_NATIVE_CLOCK_ADDRESS), cohort.slot, "native readiness Clock is not authentic");
  const cluster = generationCluster(dependencies.deployment.cluster);
  return { feedId: loaded.feedId, slot: cohort.slot, rows: state.layout.descriptors.slice(0, state.componentCount).flatMap((d, row) => {
    const pool = loaded.pools[row]; const observation = observations[row];
    if (d.mode !== 2 || !pool || !observation) return [];
    const readiness = mimirClassicNativeRowReadiness({ row, pool, poolAccount: rows.get(pool.pool), observation,
      observationAccount: rows.get(observation), nowUnix, cluster, dual: d.temporalKind === 6 });
    return [{ row, pool: pool.pool, family: pool.family, readiness, ...mimirClassicNativeRebuild(d.adapterType, readiness), dual: d.temporalKind === 6 }];
  }) };
}

async function classicConverterSources(dependencies: CreationDependencies, args: PrepareSimpleFeedArgs, assembly: boolean,
  minContextSlot: bigint): Promise<readonly MimirFusedRowSource[]> {
  const sourceConfig = args.solConversionSourceConfig;
  if (!sourceConfig) return [];
  if (assembly || args.quoteMint !== WSOL_MINT) betaError("INVALID_ARGUMENT", "a SOL conversion source is only accepted for a SOL-quoted classic feed", sourceConfig);
  const read = await new FinalizedRpcReader(dependencies.rpc).accounts([sourceConfig], minContextSlot);
  const account = read.value[0] ?? betaError("CREATION_CONTEXT_REQUIRED", "SOL conversion source config missing", sourceConfig);
  const { loaded } = await resolveExistingSource(dependencies, sourceConfig, account, read.slot, true);
  const pair = loaded.pools[0]!;
  if (loaded.artifacts.artifacts[0]?.sourceConfig !== sourceConfig) {
    betaError("INVALID_ARGUMENT", "SOL conversion source must be the converter feed's SourceConfig0", sourceConfig);
  }
  if (pair.baseMint !== WSOL_MINT || pair.quoteMint === WSOL_MINT) betaError("INVALID_ARGUMENT", "SOL conversion feed must be SOL-based and non-SOL-quoted", sourceConfig);
  if (!(args.receipts ?? []).some(({ stepId }) => stepId === "classic:activate")) await assertConverterEligible(dependencies, loaded, sourceConfig, read.slot);
  return loaded.sourceStates.map((_, index) => existingRowSource(loaded, index, dependencies.deployment.cluster));
}

/**
 * Routeable inline DLMM legs that may switch to native visible, in switch order: converter legs first, then components, larger pool first, then index.
 * A leg whose visible depth is zero or below floor never switches.
 */
export function mimirDlmmVisibleFitOrder(legs: readonly Readonly<{ componentIndex: number; converter: boolean; pool: MimirBetaEligiblePool }>[]): MimirBetaVisibleDlmmLeg[] {
  return legs.filter(({ pool }) => pool.creation.adapterType === 3 && pool.creation.bindingVariant === "routeable" && pool.minDepthTo50BpsNative > 0n &&
    (mimirBetaEligiblePoolConditions(pool) & MIMIR_COND.DEPTH_BELOW_FLOOR) === 0)
    .sort((a, b) => Number(b.converter) - Number(a.converter) || (a.pool.minLiquidityNative === b.pool.minLiquidityNative ? 0
      : a.pool.minLiquidityNative > b.pool.minLiquidityNative ? -1 : 1) || a.componentIndex - b.componentIndex)
    .map(({ componentIndex, converter, pool }) => ({ componentIndex, converter, pool: pool.pool, minDepthTo50BpsNative: pool.minDepthTo50BpsNative }));
}

/**
 * New-feed creation only: when the planned tag-88/87 producer does not fit one Transaction v1, the minimum prefix of
 * `mimirDlmmVisibleFitOrder` inline legs is created native visible and refit; existing feeds keep their sealed binding.
 * Still too large: the pre-payment `MimirBetaPacketRefusalError`. The switched legs are `fusedComposite.visibleDlmmLegs`.
 */
export async function prepareMimirBetaCompositeFeed(dependencies: CreationDependencies, args: PrepareCompositeFeedArgs): Promise<MimirBetaPreparedCreation> {
  return prepareCompositeFeedFit(dependencies, args);
}

async function prepareCompositeFeedFit(dependencies: CreationDependencies, args: PrepareCompositeFeedArgs,
  projection?: CompositeRootProjection): Promise<MimirBetaPreparedCreation> {
  const fit: { legs?: MimirBetaVisibleDlmmLeg[] } = {};
  for (let k = 0; ; k += 1) {
    const legs = fit.legs?.slice(0, k) ?? [];
    const visible = new Set(legs.map(({ componentIndex }) => componentIndex));
    const attempt = !visible.size ? args : { ...args, components: args.components.map((component, index) => !visible.has(index) ? component
      : { ...component, createClassic: { ...component.createClassic!, pool: withMimirBetaPoolBindingVariant(component.createClassic!.pool, "direct") } }) };
    try {
      const prepared = await prepareMimirBetaCompositeFeedOnce(dependencies, attempt, fit, projection);
      return !legs.length || !prepared.fusedComposite ? prepared : { ...prepared, fusedComposite: { ...prepared.fusedComposite, visibleDlmmLegs: legs } };
    } catch (error) {
      if (!(error instanceof MimirBetaPacketRefusalError) || (error.stage !== "composite:publish" && error.stage !== "composite:init") ||
        k >= (fit.legs?.length ?? 0)) throw error;
    }
  }
}

interface CompositeRootProjection {
  result?: Readonly<{
    children: readonly Readonly<{ componentIndex: number; packet: Omit<MimirBetaCompositeJourneyPacketV1, "operationId" | "stepId">;
      funding: FundingStepSelection; assembly: OnePoolClassicAssembly }>[];
    root: readonly Readonly<{ stepId: MimirBetaStepId; packet: Omit<MimirBetaCompositeJourneyPacketV1, "operationId" | "stepId">; funding: FundingStepSelection }>[];
    feedId: Address; feed: Address; fusedComposite: MimirBetaFusedCompositeCreation; protocolFeeLamports: bigint; contextSlot: bigint;
  }>;
}

const packetOf = (compiled: Awaited<ReturnType<typeof compileMimirBetaTransactionV1>>) => ({ bytes: compiled.serializedTransaction.length,
  accounts: compiled.packet.accountCount, instructions: compiled.packet.instructionCount, signatures: compiled.packet.signatureCount });

function compositeChildAssembly(dependencies: CreationDependencies, args: PrepareCompositeFeedArgs, componentIndex: number,
  preserveInputPools: boolean): Promise<OnePoolClassicAssembly> {
  const component = args.components[componentIndex]!; const create = component.createClassic!;
  if (create.variant !== undefined && typeof create.variant !== "number") betaError("INVALID_ARGUMENT", "inline Classic variant must be numeric");
  const recipe = args.componentRecipes?.[componentIndex] ?? null;
  return prepareMimirBetaSimpleFeedInternal(dependencies, { ...(recipe ? { recipes: [recipe] } : {}),
    authority: args.authority, baseMint: create.baseMint, quoteMint: create.pool.quoteMint, ticker: create.ticker,
    pools: [create.pool], identity: create.identity, variant: create.variant ?? 0, feedId: component.feedId,
    ...(create.temporalMode !== undefined ? { temporalMode: create.temporalMode } : {}),
    creatorCollateralTokenAccount: args.creatorCollateralTokenAccount, policy: create.policy,
    preserveDraftPoolEvidence: args.preserveDraftPoolEvidence, allowCollateralFunding: args.allowCollateralFunding,
  }, { preserveInputPools });
}

/** `"absent"`, `"match"` (canonical tuple of this exact child) or `"differs"`; partial or malformed tuples are conflicts. */
async function classicTupleOccupancy(dependencies: CreationDependencies, tuple: Readonly<{ feed: Address; sourceConfig: Address; tickerPda: Address;
  feedId: Address; contextSlot: bigint; create: NonNullable<MimirBetaCompositeComponentInput["createClassic"]> }>): Promise<"absent" | "match" | "differs"> {
  const { create } = tuple;
  const occupied = await new FinalizedRpcReader(dependencies.rpc).accounts([tuple.feed, tuple.sourceConfig, tuple.tickerPda], tuple.contextSlot);
  const present = occupied.value.map((account) => account !== null);
  if (!present.some(Boolean)) return "absent";
  if (!present.every(Boolean)) betaError("RECONCILIATION_CONFLICT", "missing Classic tuple is only partially present", tuple.feed);
  const [feedAccount, sourceAccount, tickerAccount] = occupied.value as readonly [MimirBetaAccount, MimirBetaAccount, MimirBetaAccount];
  try {
    const feed = decodeMimirClassicConfig(feedAccount.data);
    const source = decodeMimirBetaLiveSource(sourceAccount.data);
    const claim = decodeMimirTickerClaim(tickerAccount.data);
    const [, tickerBump] = await deriveMimirBetaTickerPda(dependencies.deployment.mimirProgramId, create.ticker);
    return feedAccount.owner !== dependencies.deployment.mimirProgramId || feedAccount.executable ||
      sourceAccount.owner !== dependencies.deployment.mimirProgramId || sourceAccount.executable ||
      tickerAccount.owner !== dependencies.deployment.mimirProgramId || tickerAccount.executable ||
      feed.version !== 1 || feed.feedId !== tuple.feedId || feed.baseMint !== create.baseMint ||
      feed.quoteMint !== create.pool.quoteMint || feed.identityAsset !== create.identity.asset || feed.ticker !== create.ticker ||
      !bytesEqual(source.feedId, addressBytes(tuple.feedId)) || source.sourceIndex !== 0 ||
      claim.config !== tuple.feed || claim.bump !== tickerBump ? "differs" : "match";
  } catch {
    return betaError("RECONCILIATION_CONFLICT", "occupied Classic tuple is malformed", tuple.feed);
  }
}

async function prepareMimirBetaCompositeFeedOnce(dependencies: CreationDependencies, args: PrepareCompositeFeedArgs,
  fit: { legs?: MimirBetaVisibleDlmmLeg[] }, projection?: CompositeRootProjection): Promise<MimirBetaPreparedCreation> {
  const separate = projection !== undefined;
  args = { ...args, ticker: canonicalizeMimirBetaTicker(args.ticker) };
  validateCommonInput(args); validateCompositePolicy(args.policy);
  if (args.quoteMint === "So11111111111111111111111111111111111111112" && args.solConversionSourceConfig) {
    betaError("INVALID_ARGUMENT", "SOL-quoted composites must not supply a SOL conversion source");
  }
  const displayName = validateMimirBetaDisplayName(args.displayName);
  if (!Array.isArray(args.components) || args.components.length < 1 || args.components.length > 5) {
    betaError("POOL_COUNT_OUT_OF_RANGE", "composite components must total 1..5");
  }
  for (const component of args.components) {
    if (!component || !component.feedId || !component.sourceConfig || typeof component.quantityX64 !== "bigint") betaError("CREATION_CONTEXT_REQUIRED", "composite component context missing");
    if (component.quantityX64 < 1n || component.quantityX64 > U128_MAX) betaError("INVALID_ARGUMENT", "composite quantity X64 out of range");
    if (component.createClassic) validateClassicPolicy(component.createClassic.policy);
  }
  const recipeOk = (r: unknown) => r === null || r === "spot" || r === "native-bounded" || isMimirClassicIntervalRecipe(r);
  if (args.componentRecipes !== undefined && (!Array.isArray(args.componentRecipes) || args.componentRecipes.length !== args.components.length ||
      !args.componentRecipes.every((r) => recipeOk(r) || r === "dual-native-point" || r === "current-point"))) betaError("INVALID_ARGUMENT", "composite component recipes must be one valid recipe per component");
  if (args.converterRecipes !== undefined && (!Array.isArray(args.converterRecipes) || !args.solConversionSourceConfig ||
      !args.converterRecipes.every(recipeOk))) betaError("INVALID_ARGUMENT", "composite converter recipes need a SOL conversion source and valid recipes");
  args = { ...args, components: args.components.map((component) => component.createClassic ? {
    ...component, createClassic: { ...component.createClassic, ticker: canonicalizeMimirBetaTicker(component.createClassic.ticker) },
  } : component) };
  const distinct = (values: readonly string[], label: string) => {
    if (new Set(values).size !== values.length) betaError("INVALID_ARGUMENT", `composite ${label} must be distinct`);
  };
  distinct(args.components.map(({ feedId }) => feedId), "component feed IDs");
  distinct(args.components.map(({ sourceConfig }) => sourceConfig), "component source configs");
  const missingInputs = args.components.flatMap((component, componentIndex) => component.createClassic
    ? [{ component, componentIndex, create: component.createClassic }] : []);
  const invalidQuote = missingInputs.find(({ create }) => create.pool.quoteMint !== args.quoteMint &&
    (create.pool.quoteMint !== "So11111111111111111111111111111111111111112" ||
      args.quoteMint === "So11111111111111111111111111111111111111112" || !args.solConversionSourceConfig));
  if (invalidQuote) betaError("INVALID_ARGUMENT", "missing Classic quote must match root quote or use a supplied SOL conversion source",
    invalidQuote.create.pool.quoteMint);
  distinct([args.identity.asset, ...missingInputs.map(({ create }) => create.identity.asset)], "identity assets");
  distinct([args.ticker, ...missingInputs.map(({ create }) => create.ticker)], "tickers");
  distinct(missingInputs.map(({ create }) => create.baseMint), "Classic base mints");
  const discovery = dependencies.discovery;
  const searches = new Map<string, ReturnType<MimirBetaPoolDiscovery["searchSpotPools"]>>();
  dependencies = { ...dependencies, discovery: {
    listPoolSources: () => discovery.listPoolSources(),
    revalidateSelectedPools: (request) => discovery.revalidateSelectedPools(request),
    searchSpotPools: (request) => {
      if (!request.query) return discovery.searchSpotPools(request);
      const key = JSON.stringify([request.baseMint, request.quoteMint, request.query, request.maxPools]);
      let pending = searches.get(key);
      if (!pending) {
        pending = discovery.searchSpotPools(request).catch((error) => { searches.delete(key); throw error; });
        searches.set(key, pending);
      }
      return pending;
    },
  } };
  const authenticatedReceipts = await Promise.all((args.receipts ?? []).map(authenticateMimirBetaReviewedStep));
  const receiptCreatedAccounts = new Set(authenticatedReceipts
    .flatMap(({ step }) => step.expectedWrites.flatMap((write) =>
      write.proof.kind === "account" && write.proof.transition === "create" ? [write.address] : [])));
  const inputAssemblies = await Promise.all(missingInputs.map(async ({ component, componentIndex }) => {
    const assembly = await compositeChildAssembly(dependencies, args, componentIndex, (args.receipts ?? []).length > 0);
    if (assembly.feedId !== component.feedId || assembly.sourceConfig !== component.sourceConfig) {
      betaError("INVALID_ARGUMENT", "missing Classic feedId/sourceConfig must match canonical derivation", component.sourceConfig);
    }
    return { componentIndex, assembly };
  }));
  const assemblies: Array<{ componentIndex: number; assembly: OnePoolClassicAssembly }> = [];
  for (const { componentIndex, assembly } of inputAssemblies) {
    const create = args.components[componentIndex]!.createClassic!;
    if (![assembly.feed, assembly.sourceConfig, assembly.tickerPda].every((address) => receiptCreatedAccounts.has(address))) {
      const occupancy = await classicTupleOccupancy(dependencies, { ...assembly, create });
      if (occupancy === "differs") {
        if (assembly.resolvedVariant !== 0) betaError("VARIANT_TAKEN", "inline Classic variant is activated by another identity", assembly.feedId);
        betaError("RECONCILIATION_CONFLICT", "occupied Classic tuple differs from the requested canonical activation", assembly.feed);
      }
      if (occupancy === "match") continue;
    }
    assemblies.push({ componentIndex, assembly });
  }
  fit.legs ??= mimirDlmmVisibleFitOrder(assemblies.map(({ componentIndex, assembly }) => ({ componentIndex,
    converter: assembly.sourceConfig === args.solConversionSourceConfig, pool: args.components[componentIndex]!.createClassic!.pool })));
  const [tickerPda] = await deriveMimirBetaTickerPda(dependencies.deployment.mimirProgramId, args.ticker);
  const referenced = args.components.flatMap((component) => [component.sourceConfig]);
  if (args.solConversionSourceConfig) referenced.push(args.solConversionSourceConfig);
  const classicTickerPdas = await Promise.all(missingInputs.map(({ create }) =>
    deriveMimirBetaTickerPda(dependencies.deployment.mimirProgramId, create.ticker).then(([address]) => address)));
  const contextSlot = inputAssemblies.reduce((slot, { assembly }) => assembly.contextSlot > slot ? assembly.contextSlot : slot, 0n);
  const context = await loadGlobalContext({ dependencies, minContextSlot: contextSlot, authority: args.authority,
    quoteMint: args.quoteMint, collateralAccount: args.creatorCollateralTokenAccount,
    allowCollateralFunding: args.allowCollateralFunding,
    oneCharTickers: [args.ticker, ...missingInputs.map(({ create }) => create.ticker)].some(isOneCharTicker),
    collateralOptional: [args.ticker, ...missingInputs.map(({ create }) => create.ticker)].every(isOneCharTicker),
    extraAddresses: [...referenced, tickerPda, ...classicTickerPdas, ...missingInputs.map(({ create }) => create.pool.pool)] });
  const rootOneCharFunding = isOneCharTicker(args.ticker) ? context.oneCharAllowance?.address ??
    betaError("CREATION_CONTEXT_REQUIRED", "one-character allowance context missing") : null;
  const missingSources = new Set(assemblies.map(({ assembly }) => assembly.sourceConfig));
  for (const address of referenced) {
    if (missingSources.has(address)) continue;
    const account = context.accounts.get(address);
    if (!account) betaError("CREATION_CONTEXT_REQUIRED", "component source config missing", address);
    if (account.owner !== dependencies.deployment.mimirProgramId || account.executable || account.data.length !== 384) betaError("ACCOUNT_MALFORMED", "component source config invalid", address);
  }
  const canonicalComponents = canonicalizeMimirBetaCompositeComponents(args.components);
  const resolvedBySource = new Map<Address, Awaited<ReturnType<typeof resolveExistingSource>>>();
  const resolvedByFeed = new Map<Address, ExistingLiveFeed>();
  const existingSources = [...canonicalComponents.filter((component) =>
    !assemblies.some(({ assembly }) => assembly.sourceConfig === component.sourceConfig)).map((component) => component.sourceConfig),
    ...(args.solConversionSourceConfig && !assemblies.some(({ assembly }) => assembly.sourceConfig === args.solConversionSourceConfig)
      ? [args.solConversionSourceConfig] : [])];
  const existingEntries = [...new Set(existingSources)].map((sourceConfig) => {
    const sourceAccount = context.accounts.get(sourceConfig) ?? betaError("CREATION_CONTEXT_REQUIRED", "existing source config missing", sourceConfig);
    const source = decodeMimirBetaLiveSource(sourceAccount.data);
    return { sourceConfig, sourceAccount, source, feedId: bytesAddress(source.feedId) };
  });
  const feedOwners = existingEntries.filter((entry, index) => existingEntries.findIndex((other) => other.feedId === entry.feedId) === index);
  const resolvedOwners = await settledInOrder(feedOwners.map(({ sourceConfig, sourceAccount }) =>
    resolveExistingSource(dependencies, sourceConfig, sourceAccount, context.slot)));
  feedOwners.forEach(({ feedId, sourceConfig }, index) => {
    resolvedByFeed.set(feedId, resolvedOwners[index]!.loaded); resolvedBySource.set(sourceConfig, resolvedOwners[index]!);
  });
  for (const { sourceConfig, source, feedId } of existingEntries) {
    if (resolvedBySource.has(sourceConfig)) continue;
    const loaded = resolvedByFeed.get(feedId)!;
    const entry = loaded.sourcePdas[source.sourceIndex];
    if (!entry || entry.sourceConfig[0] !== sourceConfig) betaError("PLAN_STALE", "existing source pointer is outside recovered feed closure", sourceConfig);
    resolvedBySource.set(sourceConfig, { sourceConfig, sourceRing: entry.sourceRing[0], loaded });
  }
  const payoutSources = await Promise.all(canonicalComponents.map(async (component) => {
    const assembly = assemblies.find(({ assembly }) => assembly.sourceConfig === component.sourceConfig)?.assembly;
    if (assembly) {
      const sourceAccount = context.accounts.get(component.sourceConfig);
      if (!sourceAccount) return { component, feed: assembly.feed, asset: assembly.identity.asset, sourceConfig: null,
        newInTransaction: true as const };
      if (sourceAccount.owner !== dependencies.deployment.mimirProgramId || sourceAccount.executable || sourceAccount.data.length !== 384) {
        betaError("ACCOUNT_MALFORMED", "finalized component source config invalid", component.sourceConfig);
      }
      const source = decodeMimirBetaLiveSource(sourceAccount.data);
      if (bytesAddress(source.feedId) !== component.feedId || source.sourceIndex !== 0) {
        betaError("ACCOUNT_MALFORMED", "finalized component source config binding mismatch", component.sourceConfig);
      }
      return { component, feed: assembly.feed, asset: assembly.identity.asset, sourceConfig: component.sourceConfig,
        newInTransaction: false as const };
    }
    const resolved = resolvedBySource.get(component.sourceConfig) ??
      betaError("CREATION_CONTEXT_REQUIRED", "component ownership source closure missing", component.sourceConfig);
    const feed = resolved.loaded.pdas.feed[0];
    const feedAccount = resolved.loaded.rows.get(feed) ?? betaError("CREATION_CONTEXT_REQUIRED", "component Classic feed missing", feed);
    const liveFeed = decodeMimirBetaLiveFeed(feedAccount.data);
    if (bytesAddress(liveFeed.feedId) !== component.feedId || !liveFeed.identityAsset) {
      betaError("ACCOUNT_MALFORMED", "component Classic identity binding missing", feed);
    }
    return { component, feed, asset: bytesAddress(liveFeed.identityAsset), sourceConfig: component.sourceConfig,
      newInTransaction: false as const };
  }));
  const existingPayoutSources = payoutSources.filter((entry) => !entry.newInTransaction);
  const payoutAddresses = uniqueAddresses(existingPayoutSources.map((entry) => entry.asset));
  const payoutRead = payoutAddresses.length
    ? await new FinalizedRpcReader(dependencies.rpc).accounts(payoutAddresses, context.slot)
    : null;
  const payoutAccounts = new Map(payoutAddresses.map((entry, index) => [entry, payoutRead!.value[index]!] as const));
  const componentActivationAccounts = await Promise.all(payoutSources.map(async (entry) => {
    if (entry.newInTransaction) return { feed: entry.feed, asset: entry.asset, owner: args.authority };
    const assetAccount = payoutAccounts.get(entry.asset) ?? null;
    if (!assetAccount) throw new MimirBetaIdentityAssetMissingError(entry.feed, entry.asset);
    const current = decodeMimirBetaCoreAsset(assetAccount, dependencies.deployment, entry.asset);
    if (current.collection !== dependencies.deployment.physicalCollection) {
      betaError("IDENTITY_UNVERIFIED", "component Core asset collection changed", entry.asset);
    }
    return { feed: entry.feed, asset: entry.asset, owner: current.liveOwner };
  }));
  const program = dependencies.deployment.mimirProgramId;
  const cluster = generationCluster(dependencies.deployment.cluster);
  const natives: { row: number; pool: MimirBetaEligiblePool; observation: Address; dual?: boolean }[] = [];
  const intervalRecipes = new Set<MimirClassicIntervalRecipe>();
  const recipeRow = (source: MimirFusedRowSource, role: "component" | "converter", recipe: MimirClassicRowRecipe | null) => {
    let row;
    try { row = mimirFusedRow({ ...source, role, ...(recipe === "dual-native-point" ? { dual: true } : {}) }); }
    catch (error) { if (!recipe) throw error; return betaError("CLASSIC_RECIPE_UNSUPPORTED", `${recipe} is not admitted for this ${role} row`, source.sourceConfig); }
    if (recipe === "native-bounded" ? row.recipe.mode !== 2 : recipe === "dual-native-point" ? row.recipe.temporalKind !== 6
      : recipe === "current-point" ? row.recipe.mode !== 5 || source.adapterType !== 3
      : isMimirClassicIntervalRecipe(recipe) && row.recipe.mode !== 3) {
      betaError("CLASSIC_RECIPE_UNSUPPORTED", `${recipe} is not admitted for this ${role} row`, source.sourceConfig);
    }
    return row;
  };
  const existingRow = async (loaded: ExistingLiveFeed, index: number, role: "component" | "converter", recipe: MimirClassicRowRecipe | null = null) => {
    const base = existingRowSource(loaded, index, dependencies.deployment.cluster);
    const pool = loaded.pools[index]!; const full = loaded.adapterAccounts[index]!;
    if (base.adapterType === 3) await mimirDlmmPointPreflight(pool, loaded.rows, loaded.coherentSlot, mimirAuthenticClockUnix(
      loaded.rows.get(MIMIR_NATIVE_CLOCK_ADDRESS), loaded.coherentSlot, "DLMM point Clock is not authentic"),
      base.currentPoint ? loaded.sourceStates[index]!.source.minDepthTo50BpsNative : undefined);
    if (!recipe) return mimirFusedRow({ ...base, role });
    let source = base;
    if (isMimirClassicIntervalRecipe(recipe)) {
      const interval = mimirClassicIntervalRow({ adapterType: base.adapterType, adapterVersion: base.adapterVersion, adapterAccounts: full, recipe, cluster, pool: pool.pool });
      intervalRecipes.add(recipe);
      if (base.adapterType === 7 && interval.temporal) assertMimirClassicDammRecipePolicy({ row: index, version: interval.temporal.version, pool: pool.pool,
        poolAccount: loaded.rows.get(pool.pool) });
      source = { ...base, adapterAccounts: interval.adapterAccounts, ...interval.temporal ? { temporal: interval.temporal } : {} };
    } else if (recipe === "dual-native-point") {
      const dlmm = base.adapterType === 3;
      if (!(dlmm || base.adapterType === 2 && base.adapterVersion === 0) || loaded.pools.length !== 1 || loaded.plan.minSources !== 1 ||
          loaded.sourceStates[index]!.source.flags !== 0) {
        betaError("CLASSIC_RECIPE_UNSUPPORTED", "dual-native-point needs a single-source CPMM v0 or DLMM feed", pool.pool);
      }
      const tail = dlmm ? await mimirClassicNativeTail(pool) : [];
      if (dlmm) await mimirDlmmPointPreflight(pool, loaded.rows, loaded.coherentSlot, mimirAuthenticClockUnix(loaded.rows.get(MIMIR_NATIVE_CLOCK_ADDRESS),
        loaded.coherentSlot, "DLMM point Clock is not authentic"), loaded.sourceStates[index]!.source.minDepthTo50BpsNative);
      natives.push({ row: index, pool, observation: dlmm ? tail[0]! : pool.creation.observationState!, dual: true });
      source = { ...base, adapterAccounts: dlmm ? [...full, ...tail] : [...full.slice(0, 5), ...mimirExecutableGenerationPins(cluster).cpmm.slice(0, 2) as Address[]] };
    } else if (recipe === "native-bounded") {
      if (!mimirClassicNativeAdmitted(base.adapterType)) betaError("CLASSIC_RECIPE_UNSUPPORTED", "native-bounded is not admitted for this family", pool.pool);
      const tail = await mimirClassicNativeTail(pool);
      natives.push({ row: index, pool, observation: base.adapterType === 2 ? pool.creation.observationState! : tail[0]! });
      source = { ...base, adapterAccounts: base.adapterType === 2 ? full.slice(0, 5) : [...full, ...tail] };
    } else if (base.adapterType === 2) source = { ...base, adapterAccounts: full.slice(0, 4) };
    return recipeRow(source, role, recipe);
  };
  const assemblyRows = (assembly: OnePoolClassicAssembly, role: "component" | "converter", recipe: MimirClassicRowRecipe | null = null) =>
    assembly.rowSources.map((source) => recipe ? recipeRow(source, role, recipe) : mimirFusedRow({ ...source, role }));
  const recipeOf = (sourceConfig: Address) => args.componentRecipes?.[args.components.findIndex((c) => c.sourceConfig === sourceConfig)] ?? null;
  const componentRows = await Promise.all(canonicalComponents.map(async (component) => {
    const assembly = assemblies.find(({ assembly }) => assembly.sourceConfig === component.sourceConfig)?.assembly;
    if (assembly) return assemblyRows(assembly, "component", recipeOf(component.sourceConfig))[0]!;
    const resolved = resolvedBySource.get(component.sourceConfig) ?? betaError("CREATION_CONTEXT_REQUIRED", "existing component closure missing", component.sourceConfig);
    if (resolved.loaded.feedId !== component.feedId) betaError("ACCOUNT_MALFORMED", "component source config feed binding mismatch", component.sourceConfig);
    const index = decodeMimirBetaLiveSource(context.accounts.get(component.sourceConfig)!.data).sourceIndex;
    return existingRow(resolved.loaded, index, "component", recipeOf(component.sourceConfig));
  }));
  const converterRows = !args.solConversionSourceConfig ? [] : await (async () => {
    const assembly = assemblies.find(({ assembly }) => assembly.sourceConfig === args.solConversionSourceConfig)?.assembly;
    if (assembly) {
      const recipe = recipeOf(args.solConversionSourceConfig!);
      if (args.converterRecipes && args.converterRecipes.some((r) => (r ?? null) !== recipe)) {
        betaError("CLASSIC_RECIPE_UNSUPPORTED", "an inline SOL conversion feed keeps its component recipe", args.solConversionSourceConfig);
      }
      return assemblyRows(assembly, "converter", recipe);
    }
    const resolved = resolvedBySource.get(args.solConversionSourceConfig!) ??
      betaError("CREATION_CONTEXT_REQUIRED", "SOL conversion source closure missing", args.solConversionSourceConfig);
    if (resolved.loaded.artifacts.artifacts[0]?.sourceConfig !== args.solConversionSourceConfig) {
      betaError("INVALID_ARGUMENT", "SOL conversion source must be the converter feed's SourceConfig0", args.solConversionSourceConfig);
    }
    if (args.converterRecipes && args.converterRecipes.length !== resolved.loaded.sourceStates.length) {
      betaError("INVALID_ARGUMENT", "composite converter recipes must be one per SOL conversion source row");
    }
    return Promise.all(resolved.loaded.sourceStates.map((_, index) => existingRow(resolved.loaded, index, "converter", args.converterRecipes?.[index] ?? null)));
  })();
  assertMimirClassicConverterAdmitted(converterRows.map(({ recipe }) => recipe));
  if (args.solConversionSourceConfig && !authenticatedReceipts.some(({ step }) => step.stepId === "composite:activate")) {
    const conversion = assemblies.find(({ assembly }) => assembly.sourceConfig === args.solConversionSourceConfig);
    const eligibility = conversion ? await evaluateMimirBetaConverterLegs({ rpc: dependencies.rpc, cluster: generationCluster(dependencies.deployment.cluster),
      feedId: conversion.assembly.feedId, sourceConfig: args.solConversionSourceConfig, pools: conversion.assembly.selectedPools,
      maxActivityAgeSlots: args.components[conversion.componentIndex]!.createClassic!.policy.maxSourceActivityAgeSlots, minContextSlot: context.slot })
      : await converterEligibility(dependencies, resolvedBySource.get(args.solConversionSourceConfig)!.loaded, args.solConversionSourceConfig, context.slot);
    if (!eligibility.eligible) throw new MimirBetaConverterIneligibleError(eligibility);
  }
  const assemblyOf = (sourceConfig: Address) => assemblies.find(({ assembly }) => assembly.sourceConfig === sourceConfig)?.assembly;
  const existingPools = (sourceConfig: Address) => {
    const { loaded } = resolvedBySource.get(sourceConfig)!;
    return loaded.pools.map((pool) => ({ pool, poolData: loaded.rows.get(pool.pool)?.data }));
  };
  const rowPools = (sourceConfig: Address) => {
    const assembly = assemblyOf(sourceConfig);
    return assembly ? assembly.selectedPools.map((pool) => ({ pool, poolData: context.captureAccounts.get(pool.pool)?.data })) : existingPools(sourceConfig);
  };
  assertMimirBetaCompositeQuality(args.policy, [
    ...args.components.map((component, index) => {
      const pools = rowPools(component.sourceConfig);
      const at = assemblyOf(component.sourceConfig) ? 0 : decodeMimirBetaLiveSource(context.accounts.get(component.sourceConfig)!.data).sourceIndex;
      return { role: "component" as const, position: index + 1, sourceConfig: component.sourceConfig, ...pools[at]! };
    }),
    ...(args.solConversionSourceConfig ? rowPools(args.solConversionSourceConfig).slice(0, converterRows.length).map((entry, index) => ({
      role: "converter" as const, position: index + 1, sourceConfig: args.solConversionSourceConfig!, ...entry })) : []),
  ]);
  if (natives.length || intervalRecipes.size) {
    const reads = uniqueAddresses([MIMIR_NATIVE_CLOCK_ADDRESS, ...natives.flatMap(({ pool, observation }) => [pool.pool, observation]),
      ...[...intervalRecipes].flatMap((r) => mimirClassicIntervalPins(r, cluster))]);
    const cohort = await new FinalizedRpcReader(dependencies.rpc).accounts(reads, context.slot);
    const rows = new Map(reads.map((address, i) => [address, cohort.value[i] ?? null] as const));
    const nowUnix = mimirAuthenticClockUnix(rows.get(MIMIR_NATIVE_CLOCK_ADDRESS), cohort.slot, "composite native Clock is not authentic");
    for (const n of natives) {
      const readiness = mimirClassicNativeRowReadiness({ row: n.row, pool: n.pool, poolAccount: rows.get(n.pool.pool), observation: n.observation,
        observationAccount: rows.get(n.observation), nowUnix, cluster, ...(n.dual ? { dual: true } : {}) });
      if (!readiness.ready && !n.dual) throw new MimirClassicNativeNotReadyError(readiness);
    }
    intervalRecipes.forEach((r) => assertMimirClassicIntervalGeneration(r, rows, cluster));
  }
  const layout = mimirCompositeExecutionLayout(componentRows.map(({ recipe }) => recipe), converterRows.map(({ recipe }) => recipe));
  assertMimirAbi1Capable({ cluster: dependencies.deployment.cluster, programId: program, capability: dependencies.abi1Capability,
    releaseRecipeScope: dependencies.abi1ReleaseRecipeScope, recipes: [...componentRows, ...converterRows].map(({ recipe }) => recipe), action: "fresh-creation", executionKind: "composite", converterSourceCount: converterRows.length });
  const encoded = await encodeMimirBetaCompositeV1Config({ programId: program,
    creator: args.authority, quoteMint: args.quoteMint, solConversionSourceConfig: args.solConversionSourceConfig,
    priceExponent: args.policy.priceExponent, maxSnapshotAgeSlots: args.policy.maxSnapshotAgeSlots,
    maxComponentSnapshotAgeSlots: args.policy.maxComponentSnapshotAgeSlots,
    maxComponentConfidenceBps: args.policy.maxComponentConfidenceBps, maxComponentDispersionBps: args.policy.maxComponentDispersionBps,
    registryEpoch: context.registry.registryEpoch, configRevision: 1n, adminConfigRevisionAtCreation: context.admin.configRevision,
    components: args.components, identityAsset: args.identity.asset, ticker: args.ticker });
  if (!(args.receipts ?? []).length) {
    const [existing] = (await new FinalizedRpcReader(dependencies.rpc, "confirmed").accounts([encoded.configAddress], context.slot)).value;
    if (existing) {
      const ticker = existing.owner === program ? decodeMimirCompositeConfig(existing.data).ticker : null;
      betaError("COMPOSITE_ALREADY_EXISTS", `a feed with these components and quantities already exists for this creator${ticker ? ` (${ticker})` : ""}`,
        encoded.configAddress);
    }
  }
  const compositeFeedId = addressBytes(encoded.feedId);
  const [feeVault] = await deriveMimirBetaPda({ programId: program, seed: "feed_fee_vault", values: [compositeFeedId] });
  const [collateralLock] = await deriveMimirBetaPda({ programId: program, seed: "feed_collateral_lock", values: [compositeFeedId] });
  const [execution] = await deriveMimirCompositeExecutionAddress(program, compositeFeedId);
  const inputAssemblyByIndex = new Map(inputAssemblies.map((entry) => [entry.componentIndex, entry.assembly]));
  const assemblyByIndex = new Map(assemblies.map((entry) => [entry.componentIndex, entry.assembly]));
  const selectedPools = inputAssemblies.length === 0 ? null : inputAssemblies.flatMap(({ assembly }) => assembly.selectedPools);
  const normalizedComponents = args.components.map((component, index) => {
    const assembly = inputAssemblyByIndex.get(index);
    if (!assembly) return component;
    const { variant: _variant, ...create } = component.createClassic!;
    return { ...component, createClassic: { ...create, pool: assembly.selectedPools[0]!,
      ...(assembly.resolvedVariant !== 0 ? { variant: assembly.resolvedVariant } : {}), ...(assembly.currentPoint ? { temporalMode: "current-point" as const } : {}) } };
  });
  const componentCommitments = args.components.map((component, index) => {
    const assembly = assemblyByIndex.get(index);
    return assembly ? utf8(assembly.canonicalDraftJson) : context.accounts.get(component.sourceConfig)!.data;
  });
  if (args.solConversionSourceConfig) {
    const conversionAssembly = assemblies.find(({ assembly }) => assembly.sourceConfig === args.solConversionSourceConfig)?.assembly;
    componentCommitments.push(conversionAssembly ? utf8(conversionAssembly.canonicalDraftJson) :
      context.accounts.get(args.solConversionSourceConfig)!.data);
  }
  const componentStatesHash = await mimirBetaHashv([utf8("MIMIR_COMPOSITE_COMPONENT_STATES_V1"), ...componentCommitments]);
  const [[agent], [displayNameMetadata], [root]] = await Promise.all([
    dependencies.identity.deriveAgentAccount(args.identity.asset),
    dependencies.identity.deriveDisplayNameMetadata(args.identity.asset),
    dependencies.identity.deriveRootConfig(),
  ]);
  const displayNameInstruction = await dependencies.identity.buildSetImmutableDisplayName({
    asset: args.identity.asset, authority: args.authority, displayName });
  const compositeCollateralMint = context.admin.collateralMint ??
    betaError("CREATION_CONTEXT_REQUIRED", "collateral mint missing for current program ABI");
  const componentSources = [...canonicalComponents.map((component) => component.sourceConfig),
    ...(args.solConversionSourceConfig ? [args.solConversionSourceConfig] : [])];
  const closureIdentity = async (sourceConfig: Address) => {
    const assembly = inputAssemblies.find(({ assembly }) => assembly.sourceConfig === sourceConfig)?.assembly;
    if (assembly) {
      const { create } = missingInputs.find(({ component }) => component.sourceConfig === sourceConfig)!;
      return { pair: `${create.baseMint}:${create.pool.quoteMint}`, feedId: assembly.feedId, variant: assembly.resolvedVariant };
    }
    const resolved = resolvedBySource.get(sourceConfig) ?? betaError("CREATION_CONTEXT_REQUIRED", "component closure missing", sourceConfig);
    const feedAccount = resolved.loaded.rows.get(resolved.loaded.pdas.feed[0]) ??
      betaError("CREATION_CONTEXT_REQUIRED", "component Classic feed missing", resolved.loaded.pdas.feed[0]);
    const feed = decodeMimirBetaLiveFeed(feedAccount.data);
    const baseMint = bytesAddress(feed.baseMint), quoteMint = bytesAddress(feed.quoteMint);
    const variant = await recoverMimirBetaFeedVariantAsync(baseMint, quoteMint, resolved.loaded.feedId) ??
      betaError("ACCOUNT_MALFORMED", "component feed identity is not a recoverable Classic variant", sourceConfig);
    return { pair: `${baseMint}:${quoteMint}`, feedId: resolved.loaded.feedId, variant };
  };
  const componentIdentities = await Promise.all(canonicalComponents.map((component) => closureIdentity(component.sourceConfig)));
  distinct(componentIdentities.map(({ pair }) => pair), "component mint pairs");
  const converterIdentity = args.solConversionSourceConfig ? await closureIdentity(args.solConversionSourceConfig) : null;
  if (converterIdentity && componentIdentities.some(({ pair, feedId }) => pair === converterIdentity.pair && feedId !== converterIdentity.feedId)) {
    betaError("INVALID_ARGUMENT", "SOL/quote component must use the selected converter feed", args.solConversionSourceConfig);
  }
  const activation = buildMimirBetaIdentityCompositeInstruction({ programId: program,
    componentSourceCount: componentSources.length, canonicalConfig: encoded.config,
    variantHints: [...componentIdentities, ...(converterIdentity ? [converterIdentity] : [])].map(({ variant }) => variant),
    accounts: [instructionAccount(args.authority, true, true), instructionAccount(args.authority, true), instructionAccount(context.registry.address),
      instructionAccount(encoded.configAddress, false, true), instructionAccount(context.admin.address), instructionAccount(feeVault, false, true),
      instructionAccount(dependencies.deployment.systemProgramId),
      ...componentSources.map((address) => instructionAccount(address, false, !separate && missingSources.has(address))),
      instructionAccount(collateralLock, false, true), instructionAccount(rootOneCharFunding ?? args.creatorCollateralTokenAccount, false, true),
      instructionAccount(compositeCollateralMint, false, true), instructionAccount(dependencies.deployment.tokenProgramId),
      instructionAccount(tickerPda, false, true), instructionAccount(agent, false, true), instructionAccount(root),
      instructionAccount(dependencies.deployment.physicalCollection, false, true), instructionAccount(args.identity.asset, true, true),
      instructionAccount(context.admin.feeTreasury, false, true),
      ...componentActivationAccounts.flatMap(({ feed, asset, owner }) => [instructionAccount(feed), instructionAccount(asset),
        instructionAccount(owner, false, true)])] });
  const [compositeSnapshot] = await deriveMimirBetaPda({ programId: program, seed: "composite_snapshot", values: [compositeFeedId] });
  const initializer = buildMimirInitFusedCompositeClosure({ programId: program, payer: args.authority, execution, collateralLock,
    compositeConfig: encoded.configAddress, registry: context.registry.address, compositeFeedId, layout,
    witnesses: [...componentRows, ...converterRows].map(({ witness }) => witness),
    components: componentRows.map(({ sourceConfig, feedConfig, sourcingPlan, externals }) => ({ sourceConfig, feedConfig, sourcingPlan, externals })),
    ...(converterRows.length ? { converter: { feedConfig: converterRows[0]!.feedConfig, sourcingPlan: converterRows[0]!.sourcingPlan,
      sources: converterRows.map(({ sourceConfig, externals }) => ({ sourceConfig, externals })) } } : {}) });
  const temporalWarmupRequired = [...componentRows, ...converterRows].some(({ recipe }) => mimirFusedRecipeNeedsWarmup(recipe));
  const firstPublication = buildMimirFusedCompositeRefreshInstruction({ programId: program, payer: args.authority, compositeSnapshot,
    compositeConfig: encoded.configAddress, registry: context.registry.address, adminConfig: context.admin.address, feeVault,
    treasury: context.admin.feeTreasury, execution, layout, componentExternals: componentRows.map(({ externals }) => externals),
    converterExternals: converterRows.map(({ externals }) => externals), request: { compositeFeedId, expectedConfigRevision: 1n,
      previousSnapshotRevision: 0n, nextSnapshotRevision: 1n, componentSourceConfigRevisions: componentRows.map(() => 1n),
      maxRefreshFeeLamports: context.admin.compositeRefreshFeeLamports, componentRingNewestSlots: componentRows.map(() => 0n),
      converterRingNewestSlots: converterRows.map(() => 0n) } });
  const postSealSampleOnly = temporalWarmupRequired && layout.descriptors.some((d) => d.mode === 4);
  const sampleOnly = !postSealSampleOnly ? null : buildMimirFusedCompositeRefreshInstruction({ programId: program, payer: args.authority,
    compositeSnapshot, compositeConfig: encoded.configAddress, registry: context.registry.address, adminConfig: context.admin.address, feeVault,
    treasury: context.admin.feeTreasury, execution, layout, componentExternals: componentRows.map(({ externals }) => externals),
    converterExternals: converterRows.map(({ externals }) => externals), request: { compositeFeedId, expectedConfigRevision: 1n,
      previousSnapshotRevision: 0n, nextSnapshotRevision: 0n, componentSourceConfigRevisions: componentRows.map(() => 1n),
      maxRefreshFeeLamports: 0n, componentRingNewestSlots: componentRows.map(() => 0n), converterRingNewestSlots: converterRows.map(() => 0n) } });
  const publication = !temporalWarmupRequired ? [firstPublication] : sampleOnly ? [sampleOnly] : [];
  const publishes = !temporalWarmupRequired;
  const finalActivationInstructions = [...await identityInstructions(dependencies, args.identity, args.authority), displayNameInstruction, activation];
  const activationInstructions = [...(separate ? [] : assemblies.flatMap(({ assembly }) => assembly.instructions)), ...finalActivationInstructions];
  const executionInstructions = [...initializer, ...publication];
  const freshInstructions = [...activationInstructions, ...executionInstructions];
  const tickers = [...assemblies.map(({ assembly }) => assembly.ticker), args.ticker];
  let collateralRequired = 0n; let oneCharRequired = 0;
  for (const ticker of tickers) {
    if (isOneCharTicker(ticker)) oneCharRequired += 1;
    const tariff = computeMimirBetaTickerTariff(context.admin.collateralAmountRaw, ticker);
    if (collateralRequired > U64_MAX - tariff) betaError("INVALID_ARGUMENT", "remaining activation tariffs overflow u64");
    collateralRequired += tariff;
  }
  // ABI-1 two-transaction launch when the fused packet does not fit: tx 1 identity + tag 81, tx 2 tag-88 closure + first tag 87.
  const tooLarge = (error: unknown) => error instanceof MimirBetaError && error.code === "TRANSACTION_TOO_LARGE";
  const probe = (instructions: readonly MimirBetaInstruction[]) => compileMimirBetaTransactionV1({ feePayer: args.authority,
    recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n, instructions });
  const rowRoles = Object.fromEntries([...componentRows.map((row, i) => [`component${i}`, row.externals] as const),
    ...converterRows.map((row, j) => [`converter${j}`, row.externals] as const)]);
  const keysOf = (instructions: readonly MimirBetaInstruction[]) => instructions.flatMap((ix) => [ix.programAddress, ...ix.accounts.map((m) => m.address)]);
  const activationRoles = Object.fromEntries([...assemblies.map(({ assembly }, i) => [`classic${i}`, keysOf(assembly.instructions)] as const),
    ["composite-activate", keysOf(finalActivationInstructions)] as const]);
  let stagedExecution = args.stagedExecution === true;
  const stagedProbe = async (stage: "composite:activate" | "composite:execution" | "composite:init" | "composite:publish", instructions: readonly MimirBetaInstruction[]) => {
    try { return await probe(instructions); } catch (error) {
      if (!tooLarge(error)) throw error;
      throw await mimirBetaPacketRefusal(stage, args.authority, instructions, stage === "composite:activate" ? activationRoles : rowRoles, error as Error);
    }
  };
  await stagedProbe("composite:publish", [firstPublication]);
  let finalProbe; let staged = stagedExecution;
  if (!staged) try { finalProbe = await probe(freshInstructions); } catch (error) { if (!tooLarge(error)) throw error; staged = true; }
  if (staged) {
    finalProbe = await stagedProbe("composite:activate", activationInstructions);
    if (!stagedExecution) {
      try { await probe(executionInstructions); } catch (error) {
        if (!tooLarge(error)) throw error;
        stagedExecution = true;
      }
    }
    if (stagedExecution) {
      await stagedProbe("composite:init", initializer);
      if (publication.length) await stagedProbe("composite:publish", publication);
    }
  }
  if (staged && !authenticatedReceipts.length) {
    for (const sourceConfig of new Set(existingSources)) {
      const { loaded } = resolvedBySource.get(sourceConfig)!;
      const rows = new Set(sourceConfig === args.solConversionSourceConfig ? loaded.sourceStates.map((_, i) => i) : []);
      if (canonicalComponents.some((component) => component.sourceConfig === sourceConfig)) rows.add(decodeMimirBetaLiveSource(context.accounts.get(sourceConfig)!.data).sourceIndex);
      const blocked = [...rows].find((i) => loaded.belowFloorSources.includes(i));
      if (blocked !== undefined) betaError("SOURCE_BELOW_FLOOR_UNPUBLISHABLE", `source ${blocked} of feed ${loaded.feedId} is below its configured floor; the later staged steps could not publish, so nothing is charged`, sourceConfig);
    }
  }
  const fusedComposite: MimirBetaFusedCompositeCreation = { execution, executionLength: layout.exactLength, growCount: layout.growCount,
    freshCreationAtomic: !temporalWarmupRequired && !staged, staged, temporalWarmupRequired, postSealSampleOnly,
    warmupPublication: temporalWarmupRequired ? { kind: "permissionless-tag87", compositeConfig: encoded.configAddress } : null };
  const admissionInputs = dependencies.consumerAdmission ?? {};
  const consumerAdmission = await preflightMimirConsumerAdmissionV1({ ...admissionInputs, capability: dependencies.abi1Capability,
    cell: mimirCompositeCellSignature(layout.descriptors, componentRows.length),
    witness: mimirCompositeWitnessA2(componentRows, converterRows),
    ...await (async () => {
      const init = staged && !stagedExecution ? executionInstructions : initializer; const fresh = staged ? activationInstructions : freshInstructions;
      const cu = (action: "init" | "fresh-creation", instructions: readonly MimirBetaInstruction[], evidence?: MimirCuEvidenceA2) =>
        verifyMimirCuEvidenceA2({ ...(dependencies.abi1Capability ? { capability: dependencies.abi1Capability } : {}), action, payer: args.authority, instructions, evidence: evidence ?? null });
      return { initializer: { payer: args.authority, instructions: init, cu: await cu("init", init, admissionInputs.initializerCu) },
        freshCreation: { payer: args.authority, instructions: fresh, cu: await cu("fresh-creation", fresh, admissionInputs.freshCreationCu) } };
    })() });
  const attached = { fusedComposite, consumerAdmission };
  const draftSteps = stepsFromIds(args.authority, [{ id: "composite:activate", stage: "mimir-create",
    signers: finalProbe!.requiredSigners.slice(1), writes: [] },
    ...(stagedExecution ? [{ id: "composite:init" as const, stage: "mimir-create" as const, signers: [], writes: [] },
      ...(publication.length ? [{ id: "composite:publish" as const, stage: "mimir-create" as const, signers: [], writes: [] }] : [])]
      : staged ? [{ id: "composite:execution" as const, stage: "mimir-create" as const, signers: [], writes: [] }] : [])]);
  const draftPayload = { schema: "mimir-beta-draft", version: 1, kind: "composite", deployment: dependencies.deployment,
    authority: args.authority, ticker: args.ticker, displayName, quoteMint: args.quoteMint, components: normalizedComponents, solConversionSourceConfig: args.solConversionSourceConfig ?? null,
    identity: args.identity, collateralTokenAccount: args.creatorCollateralTokenAccount, policy: args.policy,
    registry: { address: context.registry.address, stateHash: context.registry.stateHash, epoch: context.registry.registryEpoch },
    admin: { address: context.admin.address, stateHash: context.admin.stateHash, revision: context.admin.configRevision },
    feedId: encoded.feedId, feed: encoded.configAddress, componentStatesHash,
    missingClassics: assemblies.map(({ componentIndex, assembly }) => ({ componentIndex,
      normalizedDefinitionAndArtifacts: JSON.parse(assembly.canonicalDraftJson), artifactCommitment: assembly.draftHash })),
    configByteHash: await sha256(encoded.config), fused: { execution, executionLength: layout.exactLength, temporalWarmupRequired, staged, ...(stagedExecution ? { stagedExecution } : {}) },
    steps: draftSteps };
  const draft = await createDraftHash(draftPayload);
  const finalTarget: ReviewTarget = { kind: "composite", feedId: encoded.feedId, feed: encoded.configAddress,
    identityAsset: args.identity.asset, ticker: args.ticker, displayName, displayNameInstruction };
  const targets = new Map<MimirBetaStepId, ReviewTarget>([["composite:activate", finalTarget],
    ["composite:execution", { ...finalTarget, displayNameInstruction: null }], ["composite:init", { ...finalTarget, displayNameInstruction: null }],
    ["composite:publish", { ...finalTarget, displayNameInstruction: null }]]);
  const steps = await hydrateReviewedSteps({ draftHash: draft.draftHash, steps: draftSteps, receipts: args.receipts ?? [], targets });
  const reconciliation = reconcileCreation(dependencies, { draftHash: draft.draftHash, steps, receipts: args.receipts ?? [],
    observations: args.observations ?? [], observedSlot: context.slot });
  const plan: MimirBetaUnsignedPlan = { schema: "mimir-beta-unsigned-plan", version: 1, kind: "composite", draftHash: draft.draftHash,
    cluster: dependencies.deployment.cluster, programId: program, authority: args.authority,
    feedId: encoded.feedId, feed: encoded.configAddress, identityAsset: args.identity.asset, ticker: args.ticker, displayName, steps };
  const step = steps.find((candidate) => candidate.stepId === reconciliation.nextStepId) ?? null;
  if (!step || reconciliation.action !== "review-next-step" && reconciliation.action !== "retry-once") {
    return { ...preparedBase({ draft, selectedPools, plan, reconciliation, next: null }), ...attached };
  }
  assemblies.forEach(({ assembly }) => assembly.assertNativeReady(step.stepId !== "composite:activate"));
  const rootFundingSpecs = (outerInstructionIndex: number): readonly ExpectedTransitionSpec[] => rootOneCharFunding
    ? [oneCharAllowanceTransition(rootOneCharFunding, program)] : [
      accountTransition(args.creatorCollateralTokenAccount, "write", dependencies.deployment.tokenProgramId, 165,
        "debit the exact collateral amount from the creator token account"),
      accountTransition(compositeCollateralMint, "write", dependencies.deployment.tokenProgramId, 82,
        "decrease the exact collateral mint supply"),
      burnChecked({ address: args.creatorCollateralTokenAccount, tokenProgram: dependencies.deployment.tokenProgramId,
        mint: compositeCollateralMint, authority: args.authority,
        amountRaw: computeMimirBetaTickerTariff(context.admin.collateralAmountRaw, args.ticker),
        decimals: decodeMimirBetaSplMint(context.accounts.get(compositeCollateralMint) ?? betaError("CREATION_CONTEXT_REQUIRED", "collateral mint missing"),
          dependencies.deployment.tokenProgramId).decimals,
        outerInstructionIndex, description: "burn configured creation collateral with SPL Token BurnChecked" }),
    ];
  const executionStep = step.stepId !== "composite:activate";
  if (executionStep) collateralRequired = 0n;
  else if (oneCharRequired > 0) requireOneCharAllowance(context, oneCharRequired);
  if (!executionStep) {
    tickerTransition(context, tickerPda, dependencies);
    assemblies.forEach(({ assembly }) => tickerTransition(context, assembly.tickerPda, dependencies));
  }
  const executionSpecs: ExpectedTransitionSpec[] = [
    accountTransition(execution, "create", program, layout.exactLength, "create and seal the private fused composite execution state", "composite-execution-v1"),
    ...(publishes ? [accountTransition(compositeSnapshot, "create", program, 720,
      "create ready Composite root snapshot", "composite-snapshot-v1")] : []),
    ...(staged && publishes ? [accountTransition(feeVault, "write", program, 160, "credit the composite fee vault")] : [])];
  const initSpecs = executionSpecs.slice(0, 1);
  const publishSpecs = publishes ? [accountTransition(execution, "write", program, layout.exactLength, "refresh the composite execution rows", "composite-execution-v1"),
    ...executionSpecs.slice(1)]
    : [accountTransition(execution, "write", program, layout.exactLength, "record the first composite execution samples", "composite-execution-v1")];
  let helperPrefix = 0;
  const classicSpecs = separate ? [] : assemblies.flatMap(({ assembly }) => {
    const prefix = helperPrefix; helperPrefix += assembly.instructions.length;
    return assembly.specs.map((spec): ExpectedTransitionSpec =>
      spec.kind === "spl-token-burn-checked" ? { ...spec, outerInstructionIndex: spec.outerInstructionIndex + prefix } : spec);
  });
  const specs: ExpectedTransitionSpec[] = executionStep ? [] : [
    ...classicSpecs,
    ...identityTransitionSpecs(dependencies, agent, args.identity.asset),
    accountTransition(displayNameMetadata, "create", dependencies.deployment.agentRegistryProgramId, 332,
      "create immutable identity display name", "identity-display-name-v1"),
    accountTransition(encoded.configAddress, "create", program, 661, "create immutable-identity composite feed", "composite-feed-v1"),
    accountTransition(feeVault, "create", program, 160, "create composite fee vault"),
    accountTransition(collateralLock, "create", program, 160, "create composite collateral lock", "mimir-exact-layout-v1"),
    ...(staged ? [] : executionSpecs),
    tickerTransition(context, tickerPda, dependencies),
    ...rootFundingSpecs(helperPrefix + finalActivationInstructions.indexOf(activation)),
  ];
  const transientAddresses = separate ? [] : assemblies.flatMap(({ assembly }) => assembly.transientAddresses);
  const rentSpecs = separate ? [] : assemblies.flatMap(({ assembly }) => assembly.transientAddresses.length ? assembly.proposalSpecs : []);
  const identities = [args.identity, ...(separate ? [] : assemblies.map(({ assembly }) => assembly.identity))];
  const activationContextSlot = [context.slot, payoutRead?.slot ?? 0n].reduce((latest, slot) => slot > latest ? slot : latest, 0n);
  const protocolFeeLamports = componentActivationAccounts.reduce((total, entry) => total + (entry.owner === args.authority ? 0n : COMPOSITE_ACTIVATION_OWNER_FEE_LAMPORTS), 0n) +
    (context.admin.feeTreasury === args.authority ? 0n :
      COMPOSITE_ACTIVATION_TREASURY_FEE_LAMPORTS * BigInt(componentActivationAccounts.length) + COMPOSITE_ACTIVATION_CREATION_FEE_LAMPORTS) +
    (publishes ? context.admin.compositeRefreshFeeLamports : 0n);
  if (projection) {
    const rootSteps: { stepId: MimirBetaStepId; funding: FundingStepSelection }[] = stagedExecution
      ? [{ stepId: "composite:activate", funding: { instructions: activationInstructions, specs, identities } },
        { stepId: "composite:init", funding: { instructions: initializer, specs: initSpecs } },
        ...(publication.length ? [{ stepId: "composite:publish" as const, funding: { instructions: publication, specs: publishSpecs } }] : [])]
      : staged ? [{ stepId: "composite:activate", funding: { instructions: activationInstructions, specs, identities } },
        { stepId: "composite:execution", funding: { instructions: executionInstructions, specs: executionSpecs } }]
      : [{ stepId: "composite:activate", funding: { instructions: freshInstructions, specs, identities } }];
    projection.result = { feedId: encoded.feedId, feed: encoded.configAddress, fusedComposite, protocolFeeLamports, contextSlot: activationContextSlot,
      root: await Promise.all(rootSteps.map(async (entry) => ({ ...entry, packet: packetOf(await probe(entry.funding.instructions)) }))),
      children: await Promise.all(assemblies.map(async ({ componentIndex, assembly }) => ({ componentIndex, assembly,
        packet: packetOf(await probe(assembly.instructions)),
        funding: { instructions: assembly.instructions, specs: assembly.specs, rentSpecs: assembly.proposalSpecs, identities: [assembly.identity] } }))) };
    return { ...preparedBase({ draft, selectedPools, plan, reconciliation, next: null }), ...attached };
  }
  const fullPurchase = args.fullCollateralPurchase === true && collateralRequired > 0n;
  if (args.allowCollateralFunding && (fullPurchase || (context.collateralAccount?.amount ?? 0n) < collateralRequired)) {
    const fundingCosts = args.estimateFundingCosts && collateralRequired > 0n
      ? await estimateFundingCosts({ dependencies, authority: args.authority, minContextSlot: activationContextSlot,
        steps: stagedExecution ? [{ instructions: activationInstructions, specs, rentSpecs, identities }, { instructions: initializer, specs: initSpecs },
          ...(publication.length ? [{ instructions: publication, specs: publishSpecs }] : [])]
          : staged ? [{ instructions: activationInstructions, specs, rentSpecs, identities }, { instructions: executionInstructions, specs: executionSpecs }]
          : [{ instructions: freshInstructions, specs, rentSpecs, identities }], identities,
        ...(context.collateralAccount === null ? { externallyCreatedCollateralAccount: args.creatorCollateralTokenAccount } : {}),
        protocolFeeLamports })
      : undefined;
    throwCollateralFundingRequired({ context, authority: args.authority, tokenAccount: args.creatorCollateralTokenAccount,
      draftHash: draft.draftHash, requiredAmountRaw: collateralRequired, ...(fundingCosts ? { fundingCosts } : {}),
      ...(selectedPools ? { selectedPools } : {}), ...(fullPurchase ? { fullPurchase } : {}) });
  }
  if (!args.allowCollateralFunding && (context.collateralAccount?.amount ?? 0n) < collateralRequired) {
    betaError("SIMULATION_FAILED", "creator balance cannot cover activation burns for all remaining feeds", args.creatorCollateralTokenAccount);
  }
  const stepInstructions = step.stepId === "composite:init" ? initializer : step.stepId === "composite:publish" ? publication
    : executionStep ? executionInstructions : staged ? activationInstructions : freshInstructions;
  const stepSpecs = step.stepId === "composite:init" ? initSpecs : step.stepId === "composite:publish" ? publishSpecs : executionStep ? executionSpecs : specs;
  const next = await prepareReview({ dependencies, contextSlot: activationContextSlot, draftHash: draft.draftHash, plan, step,
    instructions: stepInstructions, specs: stepSpecs, transientAddresses: executionStep ? [] : transientAddresses, target: finalTarget, observedRows: context.captureAccounts,
    ...(publishes && (step.stepId === "composite:execution" || step.stepId === "composite:publish" || !staged) ? { compositeFee: { feeVault, collateralLock, treasury: context.admin.feeTreasury,
      total: context.admin.compositeRefreshFeeLamports, ownerShareBps: context.admin.compositeOwnerShareBps } } : {}),
    ...(executionStep ? {} : { compositeActivationFee: { treasury: context.admin.feeTreasury, owners: componentActivationAccounts.map(({ owner }) => owner),
      assets: componentActivationAccounts.map(({ asset, owner }) => ({ address: asset, owner })) } }) });
  assertRetryReviewBinding({ action: reconciliation.action, receipts: args.receipts ?? [], next });
  const reviewedPlan = { ...plan, steps: plan.steps.map((candidate) => candidate.stepId === next.step.stepId ? next.step : candidate) };
  return { ...preparedBase({ draft, selectedPools, plan: reviewedPlan, reconciliation, next }), ...attached };
}

export type MimirBetaCompositeJourneyOperationId = `child:${0 | 1 | 2 | 3 | 4}` | "root";

export interface MimirBetaCompositeJourneyOperationV1 {
  readonly operationId: MimirBetaCompositeJourneyOperationId;
  readonly definitionHash: string;
  readonly identity: MimirBetaIdentityDraft;
  readonly canonicalDraftJson: string | null;
  readonly receipts: readonly MimirBetaStageReceipt[];
}

export interface MimirBetaCompositeJourneyStateV1 {
  readonly schema: "mimir-beta-composite-journey-state";
  readonly version: 1;
  readonly intentHash: string;
  readonly inputRevision: number;
  readonly operations: readonly MimirBetaCompositeJourneyOperationV1[];
}

export interface PrepareCompositeFeedJourneyArgs {
  readonly input: Omit<PrepareCompositeFeedArgs, "receipts" | "observations">;
  readonly state?: MimirBetaCompositeJourneyStateV1;
  readonly preparationCommitment?: "processed" | "confirmed" | "finalized";
  readonly reviewMode?: "next" | "child-batch";
}

export interface MimirBetaCompositeJourneyNextV1 {
  readonly operationId: MimirBetaCompositeJourneyOperationId;
  readonly canonicalDraftJson: string;
  readonly draftHash: string;
  readonly plan: MimirBetaUnsignedPlan;
  readonly selectedPools: readonly MimirBetaEligiblePool[] | null;
  readonly preparedStep: MimirBetaPreparedStep;
  readonly provisional: boolean;
  readonly prerequisites: readonly Readonly<{ signature: string; slot: bigint; commitment: "processed" | "confirmed" | "finalized" }>[];
  readonly fusedComposite?: MimirBetaFusedCompositeCreation;
  readonly consumerAdmission?: MimirConsumerAdmissionV1;
}

export interface MimirBetaCompositeJourneyPacketV1 {
  readonly operationId: MimirBetaCompositeJourneyOperationId;
  readonly stepId: MimirBetaStepId;
  readonly bytes: number;
  readonly accounts: number;
  readonly instructions: number;
  readonly signatures: number;
}

export interface MimirBetaCompositeJourneyRootV1 {
  readonly feedId: Address;
  readonly feed: Address;
  readonly identityAsset: Address;
  readonly ticker: string;
  readonly stepIds: readonly MimirBetaStepId[];
  readonly fusedComposite: MimirBetaFusedCompositeCreation;
}

export interface MimirBetaCompositeJourneyPreviewV1 {
  readonly intentHash: string;
  readonly state: MimirBetaCompositeJourneyStateV1;
  readonly root: MimirBetaCompositeJourneyRootV1;
  readonly packets: readonly MimirBetaCompositeJourneyPacketV1[];
}

export interface MimirBetaPreparedCompositeJourney extends Omit<MimirBetaCompositeJourneyPreviewV1, "root"> {
  /** `null` only while `blocked` before any root definition could be projected. */
  readonly root: MimirBetaCompositeJourneyRootV1 | null;
  readonly schema: "mimir-beta-prepared-composite-journey";
  readonly version: 1;
  readonly canonicalIntentJson: string;
  readonly action: "review-next-step" | "await-prerequisites" | "await-finality" | "retry-once" | "complete" | "blocked";
  readonly reusedComponentIndexes: readonly number[];
  readonly remainingCollateralRaw: bigint;
  readonly remainingOneCharActivations: number;
  /** Authoritative remaining SOL estimate over every remaining packet; `null` unless `input.estimateFundingCosts`. */
  readonly fundingCosts: MimirBetaFundingCosts | null;
  readonly peakTemporaryLamports: bigint | null;
  readonly retainedAccountRentLamports: bigint | null;
  readonly next: MimirBetaCompositeJourneyNextV1 | null;
  readonly childBatch: readonly MimirBetaCompositeJourneyNextV1[] | null;
}

type JourneyPrerequisite = MimirBetaCompositeJourneyNextV1["prerequisites"][number];

const JOURNEY_OPERATION_ID = /^(?:child:[0-4]|root)$/;

/** Raw error-aware processed status of one landed receipt; `null` when absent, failed or malformed. */
async function journeyLandedStatus(rpc: MimirBetaReconciliationRpc, signature: string): Promise<JourneyPrerequisite | null> {
  if (!rpc.getSignatureStatuses) betaError("CREATION_CONTEXT_REQUIRED", "processed preparation needs getSignatureStatuses");
  const response = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
  const decoded = decodeMimirBetaSignatureStatusResponse(response);
  const raw = ((response as { value: unknown[] }).value[0] ?? null) as { err?: unknown } | null;
  if (!decoded.status || !raw || raw.err !== null) return null;
  return { signature, slot: decoded.status.slot, commitment: decoded.status.confirmationStatus };
}

/** Processed planning scope: reads and exact simulation at `processed`, never below the landed prerequisites' floor. */
function processedPlanning(dependencies: CreationDependencies, floor: bigint): CreationDependencies {
  const rpc = new Proxy(dependencies.rpc, {
    get(target, key) {
      if (key === "getAccountInfo" || key === "getMultipleAccounts" || key === "simulateTransaction") {
        return (input: never, config: { minContextSlot?: bigint }) => {
          const pinned = { ...config, commitment: "processed", minContextSlot: config.minContextSlot !== undefined && config.minContextSlot > floor ? config.minContextSlot : floor };
          const request = (target[key] as (input: never, config: never) => { send(): Promise<unknown> })(input, pinned as never);
          return { send: async () => {
            const response = await request.send();
            const rawSlot = (response as { context?: { slot?: unknown } } | null)?.context?.slot;
            const slot = typeof rawSlot === "bigint" ? rawSlot : typeof rawSlot === "number" && Number.isSafeInteger(rawSlot) ? BigInt(rawSlot) : -1n;
            if (slot < pinned.minContextSlot) betaError("RPC_CONTEXT_MISMATCH", "processed preparation context is below its prerequisite floor");
            return response;
          } };
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const discovery = { ...dependencies.discovery,
    listPoolSources: () => dependencies.discovery.listPoolSources(),
    searchSpotPools: (request: Parameters<MimirBetaPoolDiscovery["searchSpotPools"]>[0]) => dependencies.discovery.searchSpotPools(request),
    revalidateSelectedPools: async (request: Parameters<MimirBetaPoolDiscovery["revalidateSelectedPools"]>[0]) => {
      const result = await dependencies.discovery.revalidateSelectedPools({ ...request, minContextSlot: request.minContextSlot > floor ? request.minContextSlot : floor });
      if (result.slot < floor) betaError("RPC_CONTEXT_MISMATCH", "processed pool revalidation is below its prerequisite floor");
      return result;
    } };
  return { ...dependencies, rpc, discovery };
}

/** One child's own atomic Classic activation core (identity + proposal + source + tag 80) as its own reviewed draft. */
async function prepareCompositeChildActivation(dependencies: CreationDependencies, args: PrepareCompositeFeedArgs, componentIndex: number,
  parentIntentHash: string): Promise<MimirBetaPreparedCreation> {
  const receipts = args.receipts ?? [];
  const component = args.components[componentIndex]!; const create = component.createClassic!;
  const assembly = await compositeChildAssembly(dependencies, args, componentIndex, receipts.length > 0);
  if (assembly.feedId !== component.feedId || assembly.sourceConfig !== component.sourceConfig) {
    betaError("INVALID_ARGUMENT", "missing Classic feedId/sourceConfig must match canonical derivation", component.sourceConfig);
  }
  assembly.assertNativeReady(false);
  const draftSteps = stepsFromIds(args.authority, [{ id: "classic:activate", stage: "mimir-create", signers: [create.identity.asset], writes: [] }]);
  const draft = await createDraftHash({ schema: "mimir-beta-draft", version: 1, kind: "composite-child", parentIntentHash, componentIndex,
    deployment: dependencies.deployment, authority: args.authority, identity: create.identity, collateralTokenAccount: args.creatorCollateralTokenAccount,
    normalizedDefinitionAndArtifacts: JSON.parse(assembly.canonicalDraftJson), artifactCommitment: assembly.draftHash, steps: draftSteps });
  const target: ReviewTarget = { kind: "classic", feedId: assembly.feedId, feed: assembly.feed, identityAsset: create.identity.asset,
    ticker: assembly.ticker, displayName: null, displayNameInstruction: null };
  const steps = await hydrateReviewedSteps({ draftHash: draft.draftHash, steps: draftSteps, receipts, targets: new Map([["classic:activate", target]]) });
  const plan: MimirBetaUnsignedPlan = { schema: "mimir-beta-unsigned-plan", version: 1, kind: "classic", draftHash: draft.draftHash,
    cluster: dependencies.deployment.cluster, programId: dependencies.deployment.mimirProgramId, authority: args.authority,
    feedId: assembly.feedId, feed: assembly.feed, identityAsset: create.identity.asset, ticker: assembly.ticker, displayName: null, steps,
    ...(assembly.resolvedVariant !== 0 ? { variant: assembly.resolvedVariant } : {}) };
  const reconciliation = reconcileCreation(dependencies, { draftHash: draft.draftHash, steps, receipts,
    observations: args.observations ?? [], observedSlot: assembly.contextSlot });
  const step = steps.find((candidate) => candidate.stepId === reconciliation.nextStepId) ?? null;
  if (!step || reconciliation.action !== "review-next-step" && reconciliation.action !== "retry-once") {
    return preparedBase({ draft, selectedPools: assembly.selectedPools, plan, reconciliation, next: null });
  }
  const next = await prepareReview({ dependencies, contextSlot: assembly.contextSlot, strictSimulation: assembly.currentPoint, draftHash: draft.draftHash,
    plan, step, instructions: assembly.instructions, specs: assembly.specs, transientAddresses: assembly.transientAddresses, target,
    observedRows: assembly.observedRows });
  assertRetryReviewBinding({ action: reconciliation.action, receipts, next });
  return preparedBase({ draft, selectedPools: assembly.selectedPools, plan: { ...plan, steps: plan.steps.map((candidate) =>
    candidate.stepId === next.step.stepId ? next.step : candidate) }, reconciliation, next });
}

/**
 * Multi-transaction Composite creation: every missing one-pool Classic is its own atomic, reviewed activation, then the Composite is
 * prepared from live existing references only. One operation is materialized at a time (or the currently preparable child group);
 * `state` is evidence, re-authenticated against the input and live accounts. Never one atomic journey and never one wallet prompt.
 */
export async function prepareMimirBetaCompositeFeedJourney(dependencies: CreationDependencies, args: PrepareCompositeFeedJourneyArgs,
  rpc: MimirBetaReconciliationRpc): Promise<MimirBetaPreparedCompositeJourney> {
  requiredObject(args, "composite journey arguments"); requiredObject(args.input, "composite journey input");
  const raw = args.input as PrepareCompositeFeedArgs;
  if (raw.receipts !== undefined || raw.observations !== undefined) betaError("INVALID_ARGUMENT", "journey receipts belong to state.operations");
  const commitment = args.preparationCommitment ?? "confirmed";
  if (!["processed", "confirmed", "finalized"].includes(commitment)) betaError("INVALID_ARGUMENT", "preparationCommitment is invalid");
  const reviewMode = args.reviewMode ?? "next";
  if (reviewMode !== "next" && reviewMode !== "child-batch") betaError("INVALID_ARGUMENT", "reviewMode is invalid");
  validateCommonInput(raw); validateCompositePolicy(raw.policy);
  if (!Array.isArray(raw.components) || raw.components.length < 1 || raw.components.length > 5) betaError("POOL_COUNT_OUT_OF_RANGE", "composite components must total 1..5");
  const input: PrepareCompositeFeedArgs = { ...raw, ticker: canonicalizeMimirBetaTicker(raw.ticker), components: raw.components.map((component) => {
    if (!component || !component.feedId || !component.sourceConfig || typeof component.quantityX64 !== "bigint") betaError("CREATION_CONTEXT_REQUIRED", "composite component context missing");
    if (component.createClassic) validateClassicPolicy(component.createClassic.policy);
    return component.createClassic ? { ...component, createClassic: { ...component.createClassic, ticker: canonicalizeMimirBetaTicker(component.createClassic.ticker) } } : component;
  }) };
  const childDefinition = (index: number) => {
    const { feedId, sourceConfig, quantityX64, createClassic: create } = input.components[index]!;
    return { feedId, sourceConfig, quantityX64, baseMint: create!.baseMint, ticker: create!.ticker,
      pool: { pool: create!.pool.pool, programId: create!.pool.programId, family: create!.pool.family, quoteMint: create!.pool.quoteMint },
      policy: create!.policy, variant: create!.variant ?? 0, temporalMode: create!.temporalMode ?? null, recipe: input.componentRecipes?.[index] ?? null };
  };
  const childIndexes = input.components.flatMap((component, index) => component.createClassic ? [index] : [])
    .sort((left, right) => Number(input.components[right]!.sourceConfig === input.solConversionSourceConfig) -
      Number(input.components[left]!.sourceConfig === input.solConversionSourceConfig) || left - right);
  const intent = await createDraftHash({ schema: "mimir-beta-composite-journey-intent", version: 1, deployment: dependencies.deployment,
    authority: input.authority, ticker: input.ticker, displayName: validateMimirBetaDisplayName(input.displayName), quoteMint: input.quoteMint,
    solConversionSourceConfig: input.solConversionSourceConfig ?? null, policy: input.policy, collateralTokenAccount: input.creatorCollateralTokenAccount,
    componentRecipes: input.componentRecipes ?? null, converterRecipes: input.converterRecipes ?? null, stagedExecution: input.stagedExecution === true,
    components: input.components.map((component, index) => component.createClassic ? { create: childDefinition(index) }
      : { feedId: component.feedId, sourceConfig: component.sourceConfig, quantityX64: component.quantityX64 }) });
  const definitionHash = async (id: MimirBetaCompositeJourneyOperationId) => id === "root" ? intent.draftHash
    : (await createDraftHash({ schema: "mimir-beta-composite-journey-child", version: 1, ...childDefinition(Number(id.slice(6))) })).draftHash;
  const childId = (index: number): MimirBetaCompositeJourneyOperationId => `child:${index}` as MimirBetaCompositeJourneyOperationId;
  const ids: readonly MimirBetaCompositeJourneyOperationId[] = [...childIndexes.map(childId), "root"];
  const saved = new Map<MimirBetaCompositeJourneyOperationId, MimirBetaCompositeJourneyOperationV1>();
  const state = args.state;
  if (state !== undefined) {
    requiredObject(state, "composite journey state");
    if (state.schema !== "mimir-beta-composite-journey-state" || state.version !== 1 || !Number.isSafeInteger(state.inputRevision) ||
      state.inputRevision < 0 || !Array.isArray(state.operations) || state.operations.length > 6) betaError("INVALID_ARGUMENT", "composite journey state is malformed");
    if (state.intentHash !== intent.draftHash) betaError("RECONCILIATION_CONFLICT", "composite journey intent changed; a new intent needs a new review");
    for (const operation of state.operations as readonly MimirBetaCompositeJourneyOperationV1[]) {
      requiredObject(operation, "composite journey operation");
      if (typeof operation.operationId !== "string" || !JOURNEY_OPERATION_ID.test(operation.operationId) || !(ids as readonly string[]).includes(operation.operationId) ||
        saved.has(operation.operationId) || !Array.isArray(operation.receipts) || !operation.identity || operation.receipts.length > (operation.operationId === "root" ? 6 : 2)) {
        betaError("INVALID_ARGUMENT", "composite journey operation is malformed or out of bounds");
      }
      saved.set(operation.operationId, operation);
      const identity = operation.operationId === "root" ? input.identity : input.components[Number(operation.operationId.slice(6))]!.createClassic!.identity;
      if (operation.receipts.length && (operation.definitionHash !== await definitionHash(operation.operationId) ||
        operation.identity.asset !== identity.asset || operation.identity.agentUri !== identity.agentUri || typeof operation.canonicalDraftJson !== "string" ||
        operation.receipts.some((receipt) => receipt.draftHash !== operation.receipts[0]!.draftHash))) {
        betaError("RECONCILIATION_CONFLICT", "a journey operation with receipts keeps its original identity and definition");
      }
    }
    const signatures = [...saved.values()].flatMap(({ receipts }) => receipts.map(({ signature }) => signature));
    if (new Set(signatures).size !== signatures.length) betaError("RECONCILIATION_CONFLICT", "a receipt signature appears in two journey operations");
  }
  const receiptsOf = (id: MimirBetaCompositeJourneyOperationId) => saved.get(id)?.receipts ?? [];
  const inner: PrepareCompositeFeedArgs = { ...input, ...(input.allowCollateralFunding ? { allowCollateralFunding: true } : {}) };
  delete (inner as { fullCollateralPurchase?: boolean }).fullCollateralPurchase; delete (inner as { estimateFundingCosts?: boolean }).estimateFundingCosts;
  let provisional = false; let floor = 0n;
  type Prepare = (deps: CreationDependencies, a: PrepareCompositeFeedArgs) => Promise<MimirBetaPreparedCreation>;
  const prepareWithReceipts = async (receipts: readonly MimirBetaStageReceipt[], prepare: Prepare) => commitment === "finalized"
    ? prepare(dependencies, { ...inner, receipts, observations: receipts.length ? await observeMimirBetaReceiptChain({ rpc, receipts }) : [] })
    : provisional && !receipts.length ? prepare(processedPlanning(dependencies, floor), { ...inner, receipts: [] })
    : prepareConfirmedCreation(dependencies, { ...inner, receipts }, rpc, prepare);
  const inScope = async <T>(work: (deps: CreationDependencies) => Promise<T>): Promise<T> => {
    let out: T | undefined;
    await prepareWithReceipts([], async (deps) => { out = await work(deps); return { next: null } as unknown as MimirBetaPreparedCreation; });
    return out as T;
  };
  const drafts = new Map<MimirBetaCompositeJourneyOperationId, string>();
  const created: number[] = []; const reused: number[] = []; const missing: number[] = [];
  const pending: { index: number; signature: string }[] = []; const retries = new Map<number, MimirBetaPreparedCreation>();
  let blocked = false; let allFinal = true;
  const program = dependencies.deployment.mimirProgramId;
  for (const index of childIndexes) {
    const id = childId(index); const receipts = receiptsOf(id);
    const create = input.components[index]!.createClassic!;
    if (receipts.length) {
      const prepared = await prepareWithReceipts(receipts, (deps, a) => prepareCompositeChildActivation(deps, a, index, intent.draftHash));
      if (prepared.draftHash !== receipts[0]!.draftHash) betaError("RECONCILIATION_CONFLICT", "child receipts are bound to another child draft", create.identity.asset);
      drafts.set(id, prepared.canonicalDraftJson);
      const stateOf = prepared.reconciliation.steps[0]!.state;
      if (stateOf === "finalized" || stateOf === "confirmed") { created.push(index); if (stateOf !== "finalized") allFinal = false; }
      else if (prepared.next) retries.set(index, prepared);
      else if (stateOf === "pending") { pending.push({ index, signature: receipts.at(-1)!.signature }); allFinal = false; }
      else blocked = true;
      continue;
    }
    const feedPdas = await deriveMimirBetaFeedPdas({ programId: program, feedId: input.components[index]!.feedId });
    const [tickerPda] = await deriveMimirBetaTickerPda(program, create.ticker);
    const occupancy = await classicTupleOccupancy(dependencies, { feed: feedPdas.feed[0], sourceConfig: input.components[index]!.sourceConfig,
      tickerPda, feedId: input.components[index]!.feedId, contextSlot: 0n, create });
    if (occupancy === "absent") { missing.push(index); continue; }
    if (occupancy === "differs") betaError("RECONCILIATION_CONFLICT", "this Classic already exists under another identity; select the existing feed explicitly", feedPdas.feed[0]);
    reused.push(index);
  }
  const prerequisites: JourneyPrerequisite[] = [];
  if (pending.length && commitment === "processed" && !blocked) {
    for (const { signature } of pending) {
      const landed = await journeyLandedStatus(rpc, signature);
      if (!landed) { prerequisites.length = 0; break; }
      prerequisites.push(landed);
    }
  }
  provisional = pending.length > 0 && prerequisites.length === pending.length;
  floor = prerequisites.reduce((slot, { slot: landed }) => landed > slot ? landed : slot, 0n);
  const stripped = (keep: readonly number[]): PrepareCompositeFeedArgs => ({ ...inner, components: inner.components.map((component, index) =>
    component.createClassic && !keep.includes(index) ? { feedId: component.feedId, sourceConfig: component.sourceConfig, quantityX64: component.quantityX64 } : component) });
  const remainingChildren = [...retries.keys(), ...missing];
  const rootReceipts = receiptsOf("root");
  const projection: CompositeRootProjection = {};
  const unfinished = [...remainingChildren, ...pending.map(({ index }) => index)];
  const projected = !rootReceipts.length && !blocked ? await inScope((deps) => prepareCompositeFeedFit(deps, stripped(unfinished), projection)) : undefined;
  if ((projected as { fusedComposite?: MimirBetaFusedCompositeCreation } | undefined)?.fusedComposite?.visibleDlmmLegs?.length) {
    betaError("TRANSACTION_TOO_LARGE", "this basket fits only if a new DLMM feed is created native visible; create that feed first or choose its direct binding");
  }
  const preview = projection.result;
  const packets: MimirBetaCompositeJourneyPacketV1[] = preview ? [
    ...remainingChildren.flatMap((index) => preview.children.filter((entry) => entry.componentIndex === index)
      .map(({ packet }) => ({ operationId: childId(index), stepId: "classic:activate" as const, ...packet }))),
    ...preview.root.map(({ stepId, packet }) => ({ operationId: "root" as const, stepId, ...packet }))] : [];
  const tickers = [...remainingChildren.map((index) => input.components[index]!.createClassic!.ticker),
    ...(rootReceipts.some(({ stepId }) => stepId === "composite:activate") ? [] : [input.ticker])];
  const { context, fundingCosts, rentBreakdown } = await inScope(async (scoped) => {
    const context = await loadGlobalContext({ dependencies: scoped, minContextSlot: preview?.contextSlot ?? floor, authority: input.authority,
    quoteMint: input.quoteMint, collateralAccount: input.creatorCollateralTokenAccount, allowCollateralFunding: input.allowCollateralFunding,
    oneCharTickers: tickers.some(isOneCharTicker), collateralOptional: tickers.every(isOneCharTicker), extraAddresses: [] });
  const fundingSteps = preview ? [...remainingChildren.flatMap((index) => preview.children.filter((entry) => entry.componentIndex === index).map(({ funding }) => funding)),
    ...preview.root.map(({ funding }) => funding)] : [];
  const rentBreakdown = { retainedLamports: 0n, peakTemporaryLamports: 0n };
  const fundingCosts = input.estimateFundingCosts && preview ? await estimateFundingCosts({ dependencies: scoped, authority: input.authority,
    minContextSlot: preview.contextSlot, steps: fundingSteps, identities: fundingSteps.flatMap(({ identities }) => identities ?? []),
    identityGroups: fundingSteps.map(({ identities }) => identities ?? []), rentBreakdown, protocolFeeLamports: preview.protocolFeeLamports,
    ...(context.collateralAccount === null ? { externallyCreatedCollateralAccount: input.creatorCollateralTokenAccount } : {}) }) : null;
    return { context, fundingCosts, rentBreakdown };
  });
  let remainingCollateralRaw = 0n; let remainingOneCharActivations = 0;
  for (const ticker of tickers) {
    if (isOneCharTicker(ticker)) { remainingOneCharActivations += 1; continue; }
    const tariff = computeMimirBetaTickerTariff(context.admin.collateralAmountRaw, ticker);
    if (remainingCollateralRaw > U64_MAX - tariff) betaError("INVALID_ARGUMENT", "remaining activation tariffs overflow u64");
    remainingCollateralRaw += tariff;
  }
  if (remainingOneCharActivations > 0) requireOneCharAllowance(context, remainingOneCharActivations);
  const operations = async (): Promise<MimirBetaCompositeJourneyOperationV1[]> => Promise.all(ids.map(async (id) => ({ operationId: id,
    definitionHash: await definitionHash(id),
    identity: id === "root" ? input.identity : input.components[Number(id.slice(6))]!.createClassic!.identity,
    canonicalDraftJson: drafts.get(id) ?? saved.get(id)?.canonicalDraftJson ?? null, receipts: receiptsOf(id) })));
  const rebound = state !== undefined && state.operations.some((operation) => !operation.receipts.length &&
    operation.identity.asset !== (operation.operationId === "root" ? input.identity : input.components[Number(operation.operationId.slice(6))]!.createClassic!.identity).asset);
  const journeyState = async (): Promise<MimirBetaCompositeJourneyStateV1> => ({ schema: "mimir-beta-composite-journey-state", version: 1,
    intentHash: intent.draftHash, inputRevision: (state?.inputRevision ?? 0) + (rebound ? 1 : 0), operations: await operations() });
  const rootPreview = (prepared: MimirBetaPreparedCreation | null): MimirBetaCompositeJourneyRootV1 => prepared
    ? { feedId: prepared.plan.feedId, feed: prepared.plan.feed, identityAsset: input.identity.asset, ticker: input.ticker,
      stepIds: prepared.plan.steps.map(({ stepId }) => stepId), fusedComposite: (prepared as { fusedComposite?: MimirBetaFusedCompositeCreation }).fusedComposite! }
    : { feedId: preview!.feedId, feed: preview!.feed, identityAsset: input.identity.asset, ticker: input.ticker,
      stepIds: preview!.root.map(({ stepId }) => stepId), fusedComposite: preview!.fusedComposite };
  const fullPurchase = input.fullCollateralPurchase === true && remainingCollateralRaw > 0n;
  const balance = context.collateralAccount?.amount ?? 0n;
  if (!blocked && (fullPurchase || balance < remainingCollateralRaw)) {
    if (!input.allowCollateralFunding) betaError("SIMULATION_FAILED", "creator balance cannot cover activation burns for all remaining feeds", input.creatorCollateralTokenAccount);
    const compositeJourney: MimirBetaCompositeJourneyPreviewV1 | undefined = preview
      ? { intentHash: intent.draftHash, state: await journeyState(), root: rootPreview(null), packets } : undefined;
    throwCollateralFundingRequired({ context, authority: input.authority, tokenAccount: input.creatorCollateralTokenAccount,
      draftHash: intent.draftHash, requiredAmountRaw: remainingCollateralRaw, ...(fundingCosts ? { fundingCosts } : {}),
      ...(fullPurchase ? { fullPurchase } : {}), ...(compositeJourney ? { compositeJourney } : {}) });
  }
  const wrap = (id: MimirBetaCompositeJourneyOperationId, prepared: MimirBetaPreparedCreation, isProvisional: boolean): MimirBetaCompositeJourneyNextV1 => {
    const extra = prepared as { fusedComposite?: MimirBetaFusedCompositeCreation; consumerAdmission?: MimirConsumerAdmissionV1 };
    return { operationId: id, canonicalDraftJson: prepared.canonicalDraftJson, draftHash: prepared.draftHash, plan: prepared.plan,
      selectedPools: prepared.selectedPools, preparedStep: prepared.next!, provisional: isProvisional, prerequisites: isProvisional ? prerequisites : [],
      ...(extra.fusedComposite ? { fusedComposite: extra.fusedComposite } : {}), ...(extra.consumerAdmission ? { consumerAdmission: extra.consumerAdmission } : {}) };
  };
  const recheck = async () => {
    for (const prior of prerequisites) {
      const current = await journeyLandedStatus(rpc, prior.signature);
      if (!current || current.slot !== prior.slot) betaError("RECONCILIATION_CONFLICT", "processed prerequisite changed during preparation");
    }
  };
  let action: MimirBetaPreparedCompositeJourney["action"] = blocked ? "blocked" : "await-prerequisites";
  let next: MimirBetaCompositeJourneyNextV1 | null = null; let childBatch: MimirBetaCompositeJourneyNextV1[] | null = null;
  let rootPrepared: MimirBetaPreparedCreation | null = null;
  if (!blocked && (!pending.length || provisional)) {
    const retry = childIndexes.find((index) => retries.has(index));
    if (retry !== undefined) {
      action = "retry-once"; next = wrap(childId(retry), retries.get(retry)!, false);
    } else if (missing.length) {
      const order = childIndexes.filter((index) => missing.includes(index));
      const batch = reviewMode === "child-batch" && !provisional ? order : order.slice(0, 1);
      const prepared = await settledInOrder(batch.map(async (index) => {
        const child = await prepareWithReceipts([], (deps, a) => prepareCompositeChildActivation(deps, a, index, intent.draftHash));
        drafts.set(childId(index), child.canonicalDraftJson);
        return wrap(childId(index), child, provisional);
      }));
      action = "review-next-step"; next = prepared[0]!; childBatch = reviewMode === "child-batch" ? prepared : null;
    } else {
      rootPrepared = await prepareWithReceipts(rootReceipts, prepareMimirBetaCompositeFeed);
      if (rootReceipts.length && rootPrepared.draftHash !== rootReceipts[0]!.draftHash) betaError("RECONCILIATION_CONFLICT", "root receipts are bound to another root draft");
      drafts.set("root", rootPrepared.canonicalDraftJson);
      const finalRoot = rootPrepared.reconciliation.steps.every(({ state: stepState }) => stepState === "finalized");
      action = rootPrepared.reconciliation.action === "complete" ? finalRoot && allFinal && !provisional ? "complete" : "await-finality"
        : rootPrepared.reconciliation.action;
      if (rootPrepared.next) next = wrap("root", rootPrepared, provisional);
    }
    if (provisional && next) await recheck();
  } else if (!blocked) action = "await-finality";
  return { schema: "mimir-beta-prepared-composite-journey", version: 1, canonicalIntentJson: intent.canonicalDraftJson, intentHash: intent.draftHash,
    state: await journeyState(), root: rootPrepared ? rootPreview(rootPrepared) : preview ? rootPreview(null) : null, packets: rootPrepared?.next
      ? [{ operationId: "root", stepId: rootPrepared.next.step.stepId, bytes: rootPrepared.next.transaction.serializedTransaction.length,
        accounts: rootPrepared.next.transaction.packet.accountCount, instructions: rootPrepared.next.transaction.packet.instructionCount,
        signatures: rootPrepared.next.transaction.packet.signatureCount }] : packets,
    action, reusedComponentIndexes: reused.sort((left, right) => left - right), remainingCollateralRaw, remainingOneCharActivations,
    fundingCosts, peakTemporaryLamports: fundingCosts ? rentBreakdown.peakTemporaryLamports : null,
    retainedAccountRentLamports: fundingCosts ? rentBreakdown.retainedLamports : null, next, childBatch };
}
