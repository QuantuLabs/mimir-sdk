import { brand } from "../brand.js";
import type { Address } from "@solana/kit";
import type { MimirBetaEligiblePool } from "./discovery.js";
import type { MimirBetaCompositeJourneyPreviewV1 } from "./creation.js";
import type { MimirBetaConverterEligibility } from "./live.js";

export type MimirBetaErrorCode =
  | "INVALID_ARGUMENT"
  | "POOL_COUNT_OUT_OF_RANGE"
  | "DUPLICATE_POOL"
  | "POOL_INELIGIBLE"
  | "POOL_STALE"
  | "UNKNOWN_CAPTURE_DESCRIPTOR"
  | "UNKNOWN_CAPTURE_ALLOCATION"
  | "AMBIGUOUS_CAPTURE_ALLOCATION"
  | "INCOMPLETE_CAPTURE_DESCRIPTOR"
  | "CAPTURE_PLAN_MISMATCH"
  | "PAIR_ORIENTATION_CONFLICT"
  | "RPC_CONTEXT_MISMATCH"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_OWNER_MISMATCH"
  | "ACCOUNT_MALFORMED"
  | "PDA_MISMATCH"
  | "IDENTITY_UNVERIFIED"
  | "IDENTITY_ASSET_MISSING"
  | "TRANSACTION_TOO_LARGE"
  | "CREATION_TOO_LARGE"
  | "PLAN_STALE"
  | "RECEIPT_MISMATCH"
  | "STAGE_ALREADY_FINALIZED"
  | "UNCHANGED_RETRY_EXHAUSTED"
  | "RECONCILIATION_CONFLICT"
  | "NO_ELIGIBLE_POOLS"
  | "CREATION_CONTEXT_REQUIRED"
  | "COLLATERAL_REQUIRED"
  | "ONE_CHAR_ALLOWANCE_REQUIRED"
  | "SIMULATION_FAILED"
  | "PROGRAM_ABI_MISMATCH"
  | "CLASSIC_QUORUM_UNSUPPORTED"
  | "CLASSIC_CONVERTER_UNSUPPORTED"
  | "TRANSACTION_MALFORMED"
  | "TOKEN_PROGRAM_PAIR_UNSUPPORTED"
  | "TOKEN_2022_POLICY_UNSUPPORTED"
  | "PREPARATION_STALE"
  | "PUMPSWAP_BOOST_PENDING"
  | "VARIANT_UNAVAILABLE"
  | "VARIANT_TAKEN"
  | "PUBLICATION_AGE_UNSUPPORTED"
  | "RENT_THRESHOLD_UNSUPPORTED"
  | "CLASSIC_EXECUTION_EXISTS"
  | "CLASSIC_NATIVE_NOT_READY"
  | "CLASSIC_PUBLICATION_NOT_FRESH"
  | "SOURCE_BELOW_FLOOR_UNPUBLISHABLE"
  | "SOURCE_RING_REFUSED"
  | "COMPOSITE_PUBLICATION_NOT_FRESH"
  | "CLASSIC_RECIPE_UNSUPPORTED"
  | "INIT_PAYER_NOT_FEED_CREATOR"
  | "RELEASE_SCOPE_UNSUPPORTED"
  | "EXPIRY_FINALIZING"
  | "COMPOSITE_QUALITY_INCOMPATIBLE"
  | "FEED_UNPRICEABLE"
  | "CONVERTER_INELIGIBLE"
  | "COMPOSITE_ALREADY_EXISTS"
  | "CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT"
  | "DLMM_POINT_UNQUALIFIED"
  | "CALLER_PREFIX_REFUSED"
  | "ACCOUNT_SYSTEM_OWNED"
  | "GENERATION_MISMATCH";

export class MimirBetaError extends Error {
  constructor(
    readonly code: MimirBetaErrorCode,
    message: string,
    readonly address?: string,
  ) {
    super(`${code}:${message}`);
    this.name = "MimirBetaError";
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaError", MimirBetaError);

export type MimirBetaDlmmPointRefusal = "disabled" | "not-activated" | "one-sided" | "zero-depth" | "window-guard" | "vault-frozen" | "vault-shortfall" | "econ-floor";

/** A DLMM compact-point (or DUAL point branch) row that cannot publish its first point; refused before any payment. */
export class MimirBetaDlmmPointError extends MimirBetaError {
  constructor(readonly reason: MimirBetaDlmmPointRefusal, message: string, address?: string) {
    super("DLMM_POINT_UNQUALIFIED", message, address);
    this.name = "MimirBetaDlmmPointError";
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaDlmmPointError", MimirBetaDlmmPointError);

export type MimirBetaCallerPrefixRefusal = "step" | "foreign-signer" | "reserved-program" | "core-account-overlap" | "funding-account"
  | "funding-below-burn" | "funding-shortfall" | "funding-from-authority" | "authority-debit-above-bound" | "foreign-token-account" | "authority-account";

/** Caller-prefix instructions that cannot lead this reviewed step in one transaction; refused before any signature, so the caller keeps its separate transaction. */
export class MimirBetaCallerPrefixError extends MimirBetaError {
  constructor(readonly reason: MimirBetaCallerPrefixRefusal, message: string, address?: string) {
    super("CALLER_PREFIX_REFUSED", message, address);
    this.name = "MimirBetaCallerPrefixError";
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaCallerPrefixError", MimirBetaCallerPrefixError);

export type MimirBetaIneligibleReason = "PUMPSWAP_POOL_BASE_SUPPLY_ZERO" | Readonly<{ kind: "TOKEN_2022_FAMILY_UNSUPPORTED"; family: string }>;

/** Pool refused by a named capture policy, so search can keep the reason on the ineligible entry. */
export class MimirBetaPoolIneligibleError extends MimirBetaError {
  constructor(readonly reason: MimirBetaIneligibleReason, message: string, address?: string, code: MimirBetaErrorCode = "POOL_INELIGIBLE") {
    super(code, message, address);
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaPoolIneligibleError", MimirBetaPoolIneligibleError);

/** Staged creation packet that still exceeds one Transaction v1: the refused stage and its limiting roles (most keys first). */
export class MimirBetaPacketRefusalError extends MimirBetaError {
  constructor(readonly stage: "composite:activate" | "composite:execution" | "composite:init" | "composite:publish" | "classic:ready", readonly limitingRoles: readonly Readonly<{ role: string; keys: number }>[],
    message: string) {
    super("TRANSACTION_TOO_LARGE", message);
    this.name = "MimirBetaPacketRefusalError";
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaPacketRefusalError", MimirBetaPacketRefusalError);

/** One row whose program-fixed source quality exceeds an immutable sealed cap. */
export interface MimirBetaQualityViolation {
  /** `source`: a Classic row; `component` / `converter`: a composite row. */
  readonly role: "component" | "converter" | "source";
  /** 1-based position as entered (components, Classic pools) or converter source order. */
  readonly position: number;
  readonly sourceConfig?: Address;
  readonly pool: Address;
  readonly family: string;
  readonly metric: "confidence" | "dispersion";
  readonly valueBps: number;
  readonly capBps: number;
  /** The cap is the automatic maximum (`MIMIR_PARAM_MARGINS.autoRaiseMaxBps`), which an explicit override lifts. */
  readonly autoMax?: true;
}

/** One composite row whose program-fixed source quality exceeds the immutable composite policy. */
export type MimirBetaCompositeQualityViolation = MimirBetaQualityViolation & Readonly<{ role: "component" | "converter"; sourceConfig: Address }>;

/** The sealed policy field a violation refers to. */
export const mimirBetaQualityParameter = (v: Pick<MimirBetaQualityViolation, "role" | "metric">) =>
  v.role === "source" ? "maxConfidenceBps" : v.metric === "confidence" ? "maxComponentConfidenceBps" : "maxComponentDispersionBps";

/** A feed whose selected rows can never pass its sealed quality caps; refused before any transaction is built. */
export class MimirBetaUnpriceableError extends MimirBetaError {
  readonly explanation: string;
  constructor(readonly violations: readonly MimirBetaQualityViolation[], code: MimirBetaErrorCode = "FEED_UNPRICEABLE") {
    const lines = violations.map((v) => `${v.role === "component" ? "Component" : v.role === "converter" ? "SOL conversion source" : "Source"} ${v.position} (${v.family} ${v.pool}) has a ${v.valueBps} bps source ${v.metric === "confidence" ? "confidence" : "spread"}; this ${v.role === "source" ? "feed" : "basket"} allows ${v.capBps} bps (${mimirBetaQualityParameter(v)}${v.autoMax ? ", automatic maximum" : ""})`);
    const explanation = `${lines.join(". ")}. It could never price: raise that limit or choose a compatible source. Nothing was sent.`;
    super(code, explanation, violations[0]?.pool);
    this.name = "MimirBetaUnpriceableError";
    this.explanation = explanation;
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaUnpriceableError", MimirBetaUnpriceableError);

/** A composite whose selected rows can never pass its publication quality caps; refused before any payable review. */
export class MimirBetaCompositeQualityError extends MimirBetaUnpriceableError {
  declare readonly violations: readonly MimirBetaCompositeQualityViolation[];
  constructor(violations: readonly MimirBetaCompositeQualityViolation[]) {
    super(violations, "COMPOSITE_QUALITY_INCOMPATIBLE");
    this.name = "MimirBetaCompositeQualityError";
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaCompositeQualityError", MimirBetaCompositeQualityError);

export interface MimirBetaCollateralFundingFacts {
  readonly authority: Address;
  readonly mint: Address;
  readonly tokenAccount: Address;
  readonly decimals: number;
  readonly requiredAmountRaw: bigint;
  readonly balanceRaw: bigint;
  readonly shortfallRaw: bigint;
  readonly accountMissing: boolean;
  readonly observedSlot: bigint;
  readonly draftHash: string;
  readonly fundingCosts?: MimirBetaFundingCosts;
  readonly resolvedVariant?: number;
  readonly feedId?: Address;
  readonly selectedPools?: readonly MimirBetaEligiblePool[];
  /** Whole remaining journey (operations, root, packets) when a multi-transaction Composite journey needs funding. */
  readonly compositeJourney?: MimirBetaCompositeJourneyPreviewV1;
}

export interface MimirBetaFundingCosts {
  readonly observedSlot: bigint;
  readonly identityLamports: bigint;
  readonly accountRentLamports: bigint;
  readonly networkFeeLamports: bigint;
  readonly protocolFeeLamports: bigint;
  readonly totalLamports: bigint;
}

export class MimirBetaCollateralRequiredError extends MimirBetaError implements MimirBetaCollateralFundingFacts {
  readonly authority: Address;
  readonly mint: Address;
  readonly tokenAccount: Address;
  readonly decimals: number;
  readonly requiredAmountRaw: bigint;
  readonly balanceRaw: bigint;
  readonly shortfallRaw: bigint;
  readonly accountMissing: boolean;
  readonly observedSlot: bigint;
  readonly draftHash: string;
  readonly fundingCosts?: MimirBetaFundingCosts;
  readonly resolvedVariant?: number;
  readonly feedId?: Address;
  readonly selectedPools?: readonly MimirBetaEligiblePool[];
  readonly compositeJourney?: MimirBetaCompositeJourneyPreviewV1;

  constructor(facts: MimirBetaCollateralFundingFacts) {
    super("COLLATERAL_REQUIRED", "creator collateral balance cannot cover remaining activation burns", facts.tokenAccount);
    this.name = "MimirBetaCollateralRequiredError";
    this.authority = facts.authority;
    this.mint = facts.mint;
    this.tokenAccount = facts.tokenAccount;
    this.decimals = facts.decimals;
    this.requiredAmountRaw = facts.requiredAmountRaw;
    this.balanceRaw = facts.balanceRaw;
    this.shortfallRaw = facts.shortfallRaw;
    this.accountMissing = facts.accountMissing;
    this.observedSlot = facts.observedSlot;
    this.draftHash = facts.draftHash;
    if (facts.fundingCosts) this.fundingCosts = Object.freeze({ ...facts.fundingCosts });
    if (facts.resolvedVariant !== undefined) this.resolvedVariant = facts.resolvedVariant;
    if (facts.feedId !== undefined) this.feedId = facts.feedId;
    if (facts.selectedPools !== undefined) this.selectedPools = frozenCopy(facts.selectedPools);
    if (facts.compositeJourney !== undefined) this.compositeJourney = frozenCopy(facts.compositeJourney);
    Object.freeze(this);
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaCollateralRequiredError", MimirBetaCollateralRequiredError);

function frozenCopy<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  if (ArrayBuffer.isView(value)) return (value as unknown as Uint8Array).slice() as T;
  const copy = (Array.isArray(value) ? value.map(frozenCopy) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, frozenCopy(v)]))) as T;
  return Object.freeze(copy);
}

export type MimirBetaProgramRejectionCode =
  | "INVALID_PLAN"
  | "INVALID_SOURCE_CONFIG"
  | "INVALID_SOURCE_RING"
  | "STALE_SNAPSHOT"
  | "STALE_SOURCE_ACTIVITY"
  | "QUOTE_NOT_OK"
  | "ANCHOR_NOT_OK"
  | "INSUFFICIENT_SOURCE_COUNT"
  | "INSUFFICIENT_VENUE_COUNT"
  | "INSUFFICIENT_CORRELATION_GROUP_COUNT"
  | "INSUFFICIENT_COVERAGE"
  | "CONFIDENCE_TOO_WIDE"
  | "DISPERSION_TOO_WIDE"
  | "INVALID_COMPOSITE_SNAPSHOT";

const PROGRAM_REJECTIONS: Readonly<Record<number, MimirBetaProgramRejectionCode>> = {
  10: "INVALID_PLAN",
  46: "INVALID_SOURCE_CONFIG",
  54: "INVALID_SOURCE_RING",
  14: "STALE_SNAPSHOT",
  15: "STALE_SOURCE_ACTIVITY",
  16: "QUOTE_NOT_OK",
  17: "ANCHOR_NOT_OK",
  28: "INSUFFICIENT_SOURCE_COUNT",
  29: "INSUFFICIENT_VENUE_COUNT",
  30: "INSUFFICIENT_CORRELATION_GROUP_COUNT",
  31: "INSUFFICIENT_COVERAGE",
  32: "CONFIDENCE_TOO_WIDE",
  33: "DISPERSION_TOO_WIDE",
  79: "INVALID_COMPOSITE_SNAPSHOT",
};

const CONVERTER_LEG_REASON = {
  "recipe-unsupported": () => "is not an admitted native converter source",
  "native-not-ready": () => "has no usable native price history right now",
  "activity-unproven": () => "has no verified recent successful pool trade",
  "activity-stale": (age: bigint | null, limit: bigint) => `last traded ${age} slots ago; this converter allows ${limit}`,
} as const;

/** An embedded SOL/USDC converter with at least one unusable leg; refused before collateral funding or any payable review. */
export class MimirBetaConverterIneligibleError extends MimirBetaError {
  readonly explanation: string;
  constructor(readonly eligibility: MimirBetaConverterEligibility) {
    const refused = eligibility.legs.filter((leg) => !leg.eligible);
    const lines = refused.map((leg) => `SOL conversion source ${leg.row + 1} (${leg.family} ${leg.pool}) ${CONVERTER_LEG_REASON[leg.reason!](leg.activityAgeSlots, eligibility.maxActivityAgeSlots)}`);
    const explanation = `${lines.join(". ") || "This SOL conversion feed has no usable source"}. Choose another SOL/USDC feed. Nothing was sent.`;
    super("CONVERTER_INELIGIBLE", explanation, refused[0]?.pool ?? eligibility.sourceConfig);
    this.name = "MimirBetaConverterIneligibleError";
    this.explanation = explanation;
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaConverterIneligibleError", MimirBetaConverterIneligibleError);

/** An existing component feed whose Core identity asset is absent on this network: its payout cannot be built. */
export class MimirBetaIdentityAssetMissingError extends MimirBetaError {
  readonly reason = "identity-asset-missing" as const;
  readonly explanation: string;
  constructor(readonly feed: string, readonly asset: string) {
    const explanation = "Its identity asset is missing on this network. Choose a feed created on this network. Nothing was sent.";
    super("IDENTITY_ASSET_MISSING", explanation, feed);
    this.name = "MimirBetaIdentityAssetMissingError";
    this.explanation = explanation;
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaIdentityAssetMissingError", MimirBetaIdentityAssetMissingError);

export interface MimirBetaSimulationFailure {
  readonly instructionIndex: number | null;
  readonly customCode: number | null;
  readonly programId: string | null;
  readonly outerProgramId?: string | null;
  readonly mimirTag?: number | null;
  readonly rejection: MimirBetaProgramRejectionCode | null;
  readonly logs: readonly string[];
  /** RPC `TransactionError` kind, e.g. `BlockhashNotFound` or `InstructionError`. */
  readonly errorKind?: string | null;
}

export class MimirBetaSimulationError extends MimirBetaError implements MimirBetaSimulationFailure {
  readonly instructionIndex: number | null;
  readonly customCode: number | null;
  readonly programId: string | null;
  readonly outerProgramId: string | null;
  readonly mimirTag: number | null;
  readonly rejection: MimirBetaProgramRejectionCode | null;
  readonly logs: readonly string[];
  readonly errorKind: string | null;

  constructor(failure: MimirBetaSimulationFailure) {
    super("SIMULATION_FAILED", failure.rejection
      ? `exact unsigned transaction simulation rejected: ${failure.rejection}`
      : "exact unsigned transaction simulation failed", failure.programId ?? undefined);
    this.name = "MimirBetaSimulationError";
    this.instructionIndex = failure.instructionIndex;
    this.customCode = failure.customCode;
    this.programId = failure.programId;
    this.outerProgramId = failure.outerProgramId ?? null;
    this.mimirTag = failure.mimirTag ?? null;
    this.rejection = failure.rejection;
    this.logs = Object.freeze([...failure.logs]);
    this.errorKind = failure.errorKind ?? null;
    Object.freeze(this);
  }

  toJSON(): MimirBetaSimulationFailure & { readonly code: string; readonly message: string } {
    return { code: this.code, message: this.message, instructionIndex: this.instructionIndex, customCode: this.customCode,
      programId: this.programId, outerProgramId: this.outerProgramId, mimirTag: this.mimirTag, rejection: this.rejection, logs: this.logs, errorKind: this.errorKind };
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaSimulationError", MimirBetaSimulationError);

function safeInteger(value: unknown): number | null {
  const number = typeof value === "bigint" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function mimirBetaSimulationFailure(err: unknown, logs: unknown, mimirProgramId: string,
  instructions?: readonly Readonly<{ programAddress: string; data: Uint8Array }>[]): MimirBetaSimulationFailure {
  const lines = Array.isArray(logs) ? logs.filter((log): log is string => typeof log === "string") : [];
  const bounded = lines.slice(-32).map((log) => log.slice(0, 512));
  const tuple = err && typeof err === "object" ? (err as Record<string, unknown>).InstructionError : undefined;
  const index = Array.isArray(tuple) ? safeInteger(tuple[0]) : null;
  const detail = Array.isArray(tuple) && tuple[1] && typeof tuple[1] === "object" ? (tuple[1] as Record<string, unknown>).Custom : undefined;
  const customCode = safeInteger(detail);
  const start = lines.map((log) => /^Program \S+ invoke \[\d+\]$/.test(log)).lastIndexOf(true);
  const failure = lines.slice(Math.max(start, 0)).map((log) => /^Program (\S+) failed: (.+)$/.exec(log)).find(Boolean) ?? null;
  const failed = failure?.[1] ?? null;
  const originCode = /^custom program error: (0x[0-9a-f]+|\d+)$/i.exec(failure?.[2] ?? "")?.[1];
  const outer = index === null ? undefined : instructions?.[index];
  const outerProgramId = outer?.programAddress ?? null;
  const mimirTag = outerProgramId === mimirProgramId && outer!.data.length > 0 ? outer!.data[0]! : null;
  const rejection = customCode !== null && failed === mimirProgramId && (!outer || outerProgramId === mimirProgramId) && originCode !== undefined && Number(originCode) === customCode
    ? PROGRAM_REJECTIONS[customCode] ?? null : null;
  const errorKind = typeof err === "string" ? err : err && typeof err === "object" ? Object.keys(err)[0] ?? null : null;
  return { instructionIndex: index, customCode, programId: failed, outerProgramId, mimirTag, rejection, logs: bounded, errorKind };
}

export interface MimirBetaStalePreparationFacts {
  readonly reason: "context-drift" | "source-drift";
  readonly address: string;
  readonly observedSlot: bigint;
  readonly currentSlot: bigint;
  readonly observedUnixTimestamp: bigint | null;
  readonly currentUnixTimestamp: bigint | null;
}

export class MimirBetaStalePreparationError extends MimirBetaError implements MimirBetaStalePreparationFacts {
  readonly retryable = true as const;
  readonly reason: MimirBetaStalePreparationFacts["reason"];
  declare readonly address: string;
  readonly observedSlot: bigint;
  readonly currentSlot: bigint;
  readonly observedUnixTimestamp: bigint | null;
  readonly currentUnixTimestamp: bigint | null;

  constructor(facts: MimirBetaStalePreparationFacts) {
    super("PREPARATION_STALE", `${facts.reason} between slot ${facts.observedSlot} and ${facts.currentSlot}`, facts.address);
    this.name = "MimirBetaStalePreparationError";
    this.reason = facts.reason;
    this.observedSlot = facts.observedSlot;
    this.currentSlot = facts.currentSlot;
    this.observedUnixTimestamp = facts.observedUnixTimestamp;
    this.currentUnixTimestamp = facts.currentUnixTimestamp;
    Object.freeze(this);
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaStalePreparationError", MimirBetaStalePreparationError);

/** The receipt's blockhash expired with no history, but its rollback floor is not finalized within the caller's bound; neither expired nor retryable yet. */
export class MimirBetaExpiryFinalizingError extends MimirBetaError {
  constructor(readonly signature: string, readonly floor: bigint) {
    super("EXPIRY_FINALIZING", `expiry proof waits for finalized slot ${floor}`);
    this.name = "MimirBetaExpiryFinalizingError";
    Object.freeze(this);
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirBetaExpiryFinalizingError", MimirBetaExpiryFinalizingError);

export function betaError(
  code: MimirBetaErrorCode,
  message: string,
  address?: string,
): never {
  throw new MimirBetaError(code, message, address);
}

export function explainMimirBetaTokenRefusal(code: string | null | undefined, reason?: MimirBetaIneligibleReason | null): string | null {
  if (typeof reason === "object" && reason?.kind === "TOKEN_2022_FAMILY_UNSUPPORTED") {
    const family = ({ "meteora-damm-v2": "Meteora DAMM v2", "raydium-amm-v4": "Raydium AMM v4", "raydium-cpmm": "Raydium CPMM" } as Record<string, string>)[reason.family] ?? reason.family;
    return `${family} does not support Token-2022 pricing. Choose a supported pool.`;
  }
  if (reason === "PUMPSWAP_POOL_BASE_SUPPLY_ZERO") {
    return "This PumpSwap pool's native base token has zero supply, so this pair orientation isn't supported. Choose another pool.";
  }
  return code === "TOKEN_PROGRAM_PAIR_UNSUPPORTED" || code === "TOKEN_2022_POLICY_UNSUPPORTED"
    ? "This pool's token settings aren't supported for pricing. Choose another pool."
    : null;
}
