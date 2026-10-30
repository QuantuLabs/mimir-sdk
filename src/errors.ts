import { PublicKey } from "@solana/web3.js";
import { freshPublicKey } from "./internal/canonicalAuthority.js";

export { RaydiumCpmmNativeTwapWindowWarmingError, MimirNativeTwapUnavailableError } from "./internal/nativeMonoRefreshCore.js";
export type { MimirNativeTwapUnavailableReason } from "./internal/nativeMonoRefreshCore.js";

export const MIMIR_ERROR_NAMES: Readonly<Record<number, string>> = {
  0: "InvalidInstruction",
  1: "InvalidInstructionData",
  2: "InvalidAccountData",
  3: "InvalidAccountOwner",
  4: "InvalidMagic",
  5: "UnsupportedVersion",
  6: "InvalidHeaderLength",
  7: "InvalidEnum",
  8: "InvalidFeed",
  9: "InvalidExponent",
  10: "InvalidPlan",
  11: "InvalidAnchorPolicy",
  12: "InvalidStatus",
  13: "InvalidRouteability",
  14: "StaleSnapshot",
  15: "StaleSourceActivity",
  16: "QuoteNotOk",
  17: "AnchorNotOk",
  18: "NativeExceptionRequired",
  19: "NotionalTooLarge",
  20: "ArithmeticOverflow",
  21: "UnsupportedBps",
  22: "InvalidSnapshotAddress",
  23: "MissingRequiredSignature",
  24: "ReadonlyAccount",
  25: "NonMonotonicSnapshot",
  26: "InvalidSystemProgram",
  27: "InvalidFeedConfigAddress",
  28: "InsufficientSourceCount",
  29: "InsufficientVenueCount",
  30: "InsufficientCorrelationGroupCount",
  31: "InsufficientCoverage",
  32: "ConfidenceTooWide",
  33: "DispersionTooWide",
  34: "InvalidFeedConfig",
  35: "FeedConfigNotActive",
  36: "FeedConfigRevisionMismatch",
  37: "RegistryEpochMismatch",
  38: "FeedConfigPolicyMismatch",
  39: "InvalidRegistryAddress",
  40: "RegistryNotActive",
  41: "NonMonotonicRegistry",
  42: "InvalidSourcingPlanAddress",
  43: "SourcingPlanNotActive",
  44: "InvalidSourcingPlanAccountHash",
  45: "InvalidSourceConfigAddress",
  46: "InvalidSourceConfig",
  47: "SourceConfigNotActive",
  48: "NonMonotonicSourceConfig",
  49: "InvalidTwapStateAddress",
  50: "InvalidTwapState",
  51: "TwapStateNotActive",
  52: "NonMonotonicTwapState",
  53: "InvalidSourceRingAddress",
  54: "InvalidSourceRing",
  55: "SourceRingNotActive",
  56: "NonMonotonicSourceRing",
  57: "DuplicateSourceRing",
  58: "UnexpectedSnapshotRevision",
  59: "UnexpectedTwapRevision",
  60: "Reserved60",
  61: "InvalidFeedReservationAddress",
  62: "InvalidFeedReservation",
  63: "FeedReservationAlreadyExists",
  64: "InvalidGovernanceAuthority",
  65: "FeedConfigAlreadyExists",
  66: "SourcingPlanAlreadyExists",
  67: "InvalidLifecycleTransition",
  68: "InvalidGovernancePolicy",
  69: "InvalidGovernanceAction",
  70: "InvalidSourceBucketAddress",
  71: "InvalidSourceBucket",
  72: "SourceBucketNotActive",
  73: "NonMonotonicSourceBucket",
  74: "InvalidFeedBucketAddress",
  75: "InvalidFeedBucket",
  76: "FeedBucketNotActive",
  77: "NonMonotonicFeedBucket",
  78: "InvalidCompositeFeed",
  79: "InvalidCompositeSnapshot",
  80: "NonMonotonicCompositeSnapshot",
  81: "InsufficientCompositeComponentCount",
  84: "InvalidIdentityOwner",
  85: "InvalidIdentityAccount",
  86: "InvalidIdentityPda",
  87: "InvalidIdentityRelation",
  88: "PumpSwapBoostPending",
  89: "InvalidCompositeExecutionAddress",
  90: "InvalidCompositeExecution",
  91: "CompositeExecutionAlreadyExists",
  92: "CompositeExecutionDefinitionMismatch",
  93: "CompositeExecutionNotReady",
  94: "UnsupportedCompositeExecutionRecipe",
  95: "V1NotImplemented",
  96: "CreationClosed",
  97: "ReservedVariant",
  98: "InvalidFeedId",
  99: "CreationAmountMismatch",
  100: "ConverterNotAdmitted",
  101: "InvalidConverterSource",
  102: "InvalidConstructionState",
  103: "MissingSealInstruction",
  104: "InvalidGenerationCounter",
  105: "GenerationCounterExists",
  106: "GenerationExhausted",
  107: "GenerationSlotOverflow",
  108: "InvalidCreator",
  109: "IdentityAlreadyAttached",
  110: "IdentityClaimExists",
  111: "AssetOwnerNotCreator",
  112: "IdentityAssetMismatch",
  113: "LiveAssetUnparseable",
  114: "InvalidPayoutDestination",
  115: "PayoutNotDeliverable",
  116: "FeeLiabilityViolated",
  117: "NoExcessRent",
  118: "ClosePowerRenounced",
  119: "InvalidAdminFlagTransition",
  120: "InvalidNoticeKind",
  121: "NoticeAlreadyPending",
  122: "NoNoticePending",
  123: "NoticeNotElapsed",
  124: "NoticeRescued",
  125: "NoticeNotRescued",
  126: "FeedNotAbandoned",
  127: "DuplicateWritableAccount",
  128: "InvalidProgramAccount",
  129: "PriceUnrepresentable",
  130: "VenueSourceUnavailable",
};

export interface MimirProgramError {
  programId: PublicKey;
  code: number;
  hex: string;
  name: string | null;
  instructionIndex: number | null;
  logs: readonly string[];
  rawMessage: string;
}

export interface ParseMimirProgramErrorOptions {
  programId?: PublicKey | string | null;
}

export type MimirProgramErrorUserAction =
  | "activation"
  | "refresh"
  | "trade"
  | "generic";

export interface FormatMimirProgramErrorForUserOptions
  extends ParseMimirProgramErrorOptions {
  action?: MimirProgramErrorUserAction;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error ?? "");
}

function getErrorLogs(error: unknown): string[] {
  if (!error || typeof error !== "object" || !("logs" in error)) {
    return [];
  }
  const logs = (error as { logs?: unknown }).logs;
  if (!Array.isArray(logs)) {
    return [];
  }
  return logs.filter((entry): entry is string => typeof entry === "string");
}

function parsePublicKey(value: PublicKey | string): PublicKey {
  return value instanceof PublicKey
    ? new PublicKey(value.toBytes())
    : new PublicKey(value);
}

function parseProgramId(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function knownProgramIds(expected?: PublicKey | string | null): PublicKey[] {
  const ids = [freshPublicKey("MIMIR", PublicKey)];
  if (expected) {
    ids.unshift(parsePublicKey(expected));
  }
  const deduped: PublicKey[] = [];
  for (const id of ids) {
    if (!deduped.some((candidate) => candidate.equals(id))) {
      deduped.push(id);
    }
  }
  return deduped;
}

function findFailedProgramId(raw: string): PublicKey | null {
  const matches = raw.matchAll(
    /Program ([1-9A-HJ-NP-Za-km-z]{32,44}) failed: custom program error/g,
  );
  for (const match of matches) {
    const id = parseProgramId(match[1] ?? "");
    if (id) {
      return id;
    }
  }
  return null;
}

function rawMentionsProgram(raw: string, programId: PublicKey): boolean {
  return raw.includes(programId.toBase58());
}

function extractCustomCode(raw: string): number | null {
  const hexMatch = raw.match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (hexMatch) {
    return Number.parseInt(hexMatch[1], 16);
  }
  const decimalMatch = raw.match(/custom program error: ([0-9]+)/);
  if (decimalMatch) {
    return Number.parseInt(decimalMatch[1], 10);
  }
  const jsonMatch = raw.match(/"Custom"\s*:\s*([0-9]+)/);
  if (jsonMatch) {
    return Number.parseInt(jsonMatch[1], 10);
  }
  const objectMatch = raw.match(/\bCustom\s*[:=]\s*([0-9]+)/);
  if (objectMatch) {
    return Number.parseInt(objectMatch[1], 10);
  }
  return null;
}

function extractInstructionIndex(raw: string): number | null {
  const jsonMatch = raw.match(/"InstructionError"\s*:\s*\[\s*([0-9]+)/);
  if (jsonMatch) {
    return Number.parseInt(jsonMatch[1], 10);
  }
  const ixMatch = raw.match(/Instruction ([0-9]+): custom program error/i);
  if (ixMatch) {
    return Number.parseInt(ixMatch[1], 10);
  }
  return null;
}

export function parseMimirProgramError(
  error: unknown,
  options: ParseMimirProgramErrorOptions = {},
): MimirProgramError | null {
  const message = getErrorMessage(error);
  const logs = getErrorLogs(error);
  const raw = `${message}\n${logs.join("\n")}`;
  const code = extractCustomCode(raw);
  if (code === null) {
    return null;
  }
  const knownIds = knownProgramIds(options.programId);
  const failedProgramId = findFailedProgramId(raw);
  const mentionedProgramId = knownIds.find((id) => rawMentionsProgram(raw, id));
  const programId =
    failedProgramId && knownIds.some((candidate) => candidate.equals(failedProgramId))
      ? failedProgramId
      : mentionedProgramId ?? (options.programId ? parsePublicKey(options.programId) : null);

  if (!programId) {
    return null;
  }
  if (failedProgramId && !failedProgramId.equals(programId)) {
    return null;
  }

  return {
    programId,
    code,
    hex: `0x${code.toString(16)}`,
    name: MIMIR_ERROR_NAMES[code] ?? null,
    instructionIndex: extractInstructionIndex(raw),
    logs,
    rawMessage: message,
  };
}

export function mimirProgramErrorUserMessage(
  error: MimirProgramError,
  options: Pick<FormatMimirProgramErrorForUserOptions, "action"> = {},
): string | null {
  switch (error.code) {
    case 33: {
      const subject =
        options.action === "activation"
          ? "Activation cannot finish yet"
          : "Mimir oracle refresh cannot finish yet";
      return `${subject}: the Raydium CP-Swap native TWAP price is outside the configured executable-price dispersion band. For a single-source Raydium CP-Swap feed, this usually means the native TWAP is still catching up to the current pool price after a liquidity or price move. Wait for the TWAP window to converge, then retry.`;
    }
    case 50: {
      const subject =
        options.action === "activation"
          ? "Activation cannot finish yet"
          : "Mimir oracle refresh cannot finish yet";
      return `${subject}: the Mimir TWAP state is not usable for the just-built refresh. This can happen when the feed TWAP revision changes while the transaction is being built, or when a single-source native TWAP window is temporarily invalid on the selected pool. Rebuild the oracle refresh from the latest Mimir accounts and retry.`;
    }
    case 130:
      return "A selected pool cannot be used: its venue account is in an unsupported layout, or the venue has disabled it. Choose another pool or retry once the venue re-enables it.";
    default:
      return null;
  }
}

export function formatMimirProgramErrorForUser(
  error: unknown,
  options: FormatMimirProgramErrorForUserOptions = {},
): string | null {
  const parsed = parseMimirProgramError(error, options);
  return parsed ? mimirProgramErrorUserMessage(parsed, options) : null;
}

/**
 * `fusedPublish`: tag-89/87 publish takes its revision and ring heads as floors, so a concurrent publication is reused or
 * superseded on chain. There 54 is a head below the signed bound, a future head or a genuine ring refusal, and 58/79 a
 * current revision below the signed floor; none is a race.
 */
export type MimirRetryOptions = Readonly<{ fusedPublish?: boolean }>;

export function isRetryableMimirRevisionDrift(error: unknown, options: MimirRetryOptions = {}): boolean {
  const parsed = parseMimirProgramError(error);
  return (parsed?.code === 58 && !options.fusedPublish) || parsed?.code === 59;
}

/** Execution-opening Custom54 is a runtime binding failure, never an automatic preparation-drift retry. */
export function isRetryableMimirHotStateDrift(error: unknown,
  options: Readonly<{ nativeOpeningMode?: "prepared" | "execution" }> & MimirRetryOptions = {}): boolean {
  const parsed = parseMimirProgramError(error);
  return (
    parsed?.code === 15 ||
    parsed?.code === 50 ||
    (parsed?.code === 54 && options.nativeOpeningMode !== "execution" && !options.fusedPublish) ||
    parsed?.code === 56 ||
    (parsed?.code === 58 && !options.fusedPublish) ||
    parsed?.code === 59
  );
}

export type MimirExecutionOpeningUnsupportedStage = "request" | "construction" | "simulation";

/** The requested execution-opening mode cannot be executed by this feed, source closure or deployment cohort. */
export class MimirExecutionOpeningUnsupportedError extends Error {
  readonly code = "MimirExecutionOpeningUnsupported";
  constructor(readonly details: Readonly<{ stage: MimirExecutionOpeningUnsupportedStage; reason: string;
    feedId?: Uint8Array; sourceIndex?: number; adapterType?: number; adapterVersion?: number; programId?: PublicKey }>,
    options?: ErrorOptions) {
    super(`Mimir execution-opening mode is unsupported (${details.stage}: ${details.reason}).`, options);
  }
}
