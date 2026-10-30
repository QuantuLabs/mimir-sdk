import type { MimirConsumerAdmissionV1 } from "./abi1Release.js";
import type { MimirSampledReadiness } from "../internal/sampledTemporalCore.js";
import type { MimirTemporalMode } from "../internal/currentPointCore.js";
import type { Address } from "@solana/kit";
import { addressBytes, bytesEqual, canonicalJson, concatBytes, domainHash, fromBase64, base64, hex, sha256, utf8 } from "./bytes.js";
import { decodeMimirBetaTicker, deriveMimirBetaPda, deriveMimirBetaTickerPda } from "./abi.js";
import { sha256 as sha256Sync } from "@noble/hashes/sha2.js";
import { getPublicKeyFromAddress } from "@solana/addresses";
import { signatureBytes, verifySignature } from "@solana/keys";
import bs58 from "bs58";
import { mimirBetaCallerPrefixViolationV1 } from "./callerPrefixIsolation.js";
import { assertMimirBetaReviewedMessageV1, isMimirBetaWalletRewriteV1, mimirBetaReviewCollateralTokenAccountV1,
  mimirBetaReviewWalletGuardAccountsV1, validMimirBetaTransactionV1Limits, MIMIR_BETA_TRANSACTION_V1_MAX_BYTES, mimirBetaReviewedMessageOfWalletV1 } from "./transactionV1.js";
import type { MimirBetaCluster } from "./deployment.js";
import type { MimirBetaEligiblePool } from "./discovery.js";
import { betaError } from "./errors.js";
import { freshNumberRecord } from "../internal/canonicalAuthority.js";
import { decodeMimirFusedRefreshData, isMimirFusedSampleOnlyData } from "./compositeExecution.js";
import { decodeMimirFusedClassicData } from "./classicExecution.js";
import { isSealedMimirBetaExpiredObservation } from "../internal/expiredObservationSeal.js";
import { validateMimirBetaDisplayName } from "./identity8004.js";
import type {
  MimirBetaAccountFingerprint,
  MimirBetaInstruction,
  MimirBetaInstructionAccount,
  MimirBetaWriteEvidence,
} from "./types.js";

const COMPOSITE_CONFIG_OFFSETS = freshNumberRecord("COMPOSITE_CONFIG_OFFSETS");

export type MimirBetaSourceOrdinal = 0 | 1 | 2 | 3 | 4;
export type MimirBetaStageId = "mimir-create";
export type MimirBetaStepId =
  | "classic:proposal-init"
  | `classic:source-append:${MimirBetaSourceOrdinal}`
  | "classic:activate"
  | `classic:source-initialize:${MimirBetaSourceOrdinal}`
  | "classic:ready"
  | "composite:activate"
  | "composite:execution"
  | "composite:init"
  | "composite:publish";

export interface MimirBetaExpectedWrite {
  readonly address: Address;
  readonly effect: "create" | "write" | "close" | "lamports" | "token-burn" | "caller-prefix";
  readonly ownerAfter: Address | null;
  readonly dataLengthAfter: number | null;
  readonly discriminatorHex: string | null;
  readonly description: string;
  readonly proof: MimirBetaExpectedWriteProof;
}

export type MimirBetaReconciliationCodec =
  | "identity-agent-v1"
  | "identity-display-name-v1"
  | "mpl-core-asset-v1"
  | "mpl-core-collection-v1"
  | "feed-plan-proposal-v1"
  | "classic-feed-v1"
  | "composite-feed-v1"
  | "ticker-claim-v1"
  | "source-config-v0"
  | "source-ring-v1"
  | "bounded-source-ring-v1"
  | "bounded-feed-snapshot-v5"
  | "dual-feed-snapshot-v5"
  | "native-mono-source-ring-v1"
  | "native-mono-feed-twap-v0"
  | "native-mono-feed-snapshot-v0"
  | "feed-snapshot-v0"
  | "feed-twap-sentinel-v0"
  | "composite-snapshot-v1"
  | "composite-execution-v1"
  | "classic-execution-v1"
  | "mimir-exact-layout-v1"
  | "sampled-temporal-v4"
  | "one-char-allowance-v1";

export type MimirBetaAccountPostcondition =
  | { readonly exists: false; readonly lamports: 0n }
  | {
      readonly exists: true;
      readonly lamports: bigint;
      readonly owner: Address;
      readonly executable: boolean;
      readonly data:
        | { readonly kind: "exact"; readonly length: number; readonly sha256: string }
        | { readonly kind: "sdk-codec"; readonly codec: MimirBetaReconciliationCodec; readonly length: number; readonly semanticHash: string;
            readonly sampledTransition?: MimirBetaSampledTransitionEvidence; readonly oneCharTransition?: MimirBetaOneCharTransitionEvidence };
    };

/** `consumed` is authenticated against the executed transaction; `revisionAfter` is advisory and never authenticated. */
export type MimirBetaOneCharTransitionEvidence = Readonly<{ consumed: number; revisionAfter?: string }>;

export type MimirBetaSampledTransitionEvidence = Readonly<{ ring: Address; preModuleHex: string | null; preRingHex: string | null;
  bandLimitBps: number; closeLimitBps: number; temporalMode?: "current-point" }>;

export type MimirBetaExpectedWriteProof =
  | { readonly kind: "account"; readonly transition: "create" | "write" | "close"; readonly before: MimirBetaAccountFingerprint;
      readonly beforeDataBase64?: string; readonly after: MimirBetaAccountPostcondition }
  | { readonly kind: "lamports"; readonly programDeltaLamports: bigint }
  | {
      readonly kind: "spl-token-burn-checked";
      readonly tokenProgram: Address;
      readonly mint: Address;
      readonly sourceTokenAccount: Address;
      readonly authority: Address;
      readonly amountRaw: bigint;
      readonly decimals: number;
      readonly outerInstructionIndex: number;
    }
  /** Writable only in the caller prefix: reviewed baseline and simulated lamport delta, no exact postcondition. */
  | { readonly kind: "caller-prefix"; readonly before: MimirBetaAccountFingerprint; readonly simulatedLamportDelta: bigint };

export interface MimirBetaPlanStep {
  readonly stepId: MimirBetaStepId;
  readonly stage: MimirBetaStageId;
  readonly ordinal: number;
  readonly prerequisiteStepIds: readonly MimirBetaStepId[];
  readonly requiredSigners: readonly Address[];
  readonly expectedWrites: readonly MimirBetaExpectedWrite[];
}

export interface MimirBetaUnsignedPlan {
  readonly schema: "mimir-beta-unsigned-plan";
  readonly version: 1;
  readonly kind: "classic" | "composite";
  readonly draftHash: string;
  readonly cluster: MimirBetaCluster;
  readonly programId: Address;
  readonly authority: Address;
  readonly feedId: Address;
  readonly feed: Address;
  readonly identityAsset: Address;
  readonly ticker: string;
  readonly displayName: string | null;
  readonly steps: readonly MimirBetaPlanStep[];
  readonly variant?: number;
}

export interface MimirBetaPacketProfile {
  readonly packetLimitBytes: 4096;
  readonly serializedMessageBytes: number;
  readonly serializedTransactionBytes: number;
  readonly accountCount: number;
  readonly instructionCount: number;
  readonly signatureCount: number;
  readonly config: MimirBetaTransactionV1Config;
  readonly fitsPacketLimit: true;
}

export interface MimirBetaTransactionV1Config {
  /** At most 1,400,000; a translated SetComputeUnitLimit may lower it. */
  readonly computeUnitLimit: number;
  /** At most 67,108,864; a translated SetLoadedAccountsDataSizeLimit may lower it. */
  readonly loadedAccountsDataSizeLimit: number;
  /** A translated RequestHeapFrame. */
  readonly heapSize?: number;
  readonly priorityFeeLamports?: bigint;
}

export interface MimirBetaSimulationFacts {
  readonly status: "succeeded";
  readonly contextSlot: bigint;
  readonly unitsConsumed: bigint | null;
  readonly logsHash: string;
  readonly returnDataHash: string | null;
  readonly error: null;
}

export interface MimirBetaUnsignedTransaction {
  readonly messageVersion: 1;
  readonly feePayer: Address;
  readonly recentBlockhash: string;
  readonly lastValidBlockHeight: bigint;
  readonly instructions: readonly MimirBetaInstruction[];
  readonly requiredSigners: readonly Address[];
  readonly serializedMessage: Uint8Array;
  readonly serializedTransaction: Uint8Array;
  readonly messageHash: string;
  readonly config: MimirBetaTransactionV1Config;
  readonly packet: MimirBetaPacketProfile;
}

export interface MimirBetaCreationReviewV1 {
  readonly schema: "mimir-beta-creation-review";
  readonly version: 1;
  readonly draftHash: string;
  readonly stepId: MimirBetaStepId;
  readonly kind: "classic" | "composite";
  readonly cluster: MimirBetaCluster;
  readonly programId: Address;
  readonly authority: Address;
  readonly feedId: Address;
  readonly feed: Address;
  readonly identityAsset: Address;
  readonly ticker: string;
  readonly displayName: string | null;
  readonly requiredSigners: readonly Address[];
  readonly instructions: readonly Readonly<{
    programAddress: Address;
    accounts: readonly MimirBetaInstructionAccount[];
    dataBase64: string;
    dataSha256: string;
  }>[];
  readonly expectedWrites: readonly MimirBetaExpectedWrite[];
  readonly messageHash: string;
  readonly stepIntentHash: string;
  readonly expectedWritesHash: string;
  readonly packet: MimirBetaPacketProfile;
  readonly simulation: MimirBetaSimulationFacts;
  readonly warnings: readonly string[];
  /** Present only when caller-owned instructions lead the reviewed core in the same transaction. */
  readonly callerPrefix?: MimirBetaCallerPrefixReview;
  /** Present only when the created feed's first price (one tag 89 / 87) follows the CREATE core in the same transaction. */
  readonly firstPrice?: Readonly<{ instructionCount: number }>;
}

/** The reviewed caller prefix: its leading instruction count and declared terms, plus the simulated authority token balances it writes. */
export interface MimirBetaCallerPrefixReview {
  readonly instructionCount: number;
  readonly funding: Readonly<{ tokenAccount: Address; minimumCreditRaw: bigint; coversBurn: boolean }> | null;
  readonly guardTokenAccounts: readonly Address[];
  readonly maxAuthorityDebitLamports: bigint;
  /** Display only: simulated pre/post amounts of authority-owned token accounts the prefix writes (0 when absent). */
  readonly tokenDeltas: readonly Readonly<{ address: Address; mint: Address; preAmountRaw: bigint; postAmountRaw: bigint }>[];
}

export interface MimirBetaPreparedStep {
  readonly step: MimirBetaPlanStep;
  readonly transaction: MimirBetaUnsignedTransaction;
  readonly review: MimirBetaCreationReviewV1;
  readonly canonicalReviewJson: string;
  readonly reviewHash: string;
  readonly renewalWitnesses?: readonly MimirBetaRenewalWitness[];
}

export interface MimirBetaRenewalWitness {
  readonly address: Address;
  readonly role: "core-collection" | "burn-mint" | "one-char-allowance";
  readonly beforeStableSha256: string;
  readonly afterStableSha256: string;
  readonly effect: string;
}

export interface MimirBetaSignerSignature {
  readonly address: Address;
  readonly signature: Uint8Array;
}

function activationAssets(step: MimirBetaPlanStep): Address[] {
  return step.expectedWrites.flatMap((write) => write.proof.kind === "account" &&
    write.proof.transition === "create" && write.proof.after.exists && write.proof.after.data.kind === "sdk-codec" &&
    write.proof.after.data.codec === "mpl-core-asset-v1" ? [write.address] : []);
}

function compositeActivationCount(step: MimirBetaPlanStep): number {
  return step.stepId === "composite:activate" ? activationAssets(step).length : 0;
}

type CompositeCodecWrite = { readonly address: Address; readonly codec: string; readonly transition: "create" | "write" | "close" };

function compositeCodecWrites(step: MimirBetaPlanStep): CompositeCodecWrite[] {
  return step.expectedWrites.flatMap((write) => write.proof.kind === "account" && write.proof.after.exists &&
    write.proof.after.data.kind === "sdk-codec"
    ? [{ address: write.address, codec: write.proof.after.data.codec, transition: write.proof.transition }]
    : []);
}

function nativeWriteCounts(writes: readonly CompositeCodecWrite[]) {
  return {
    ring: writes.filter(({ codec }) => codec === "native-mono-source-ring-v1").length,
    twap: writes.filter(({ codec }) => codec === "native-mono-feed-twap-v0").length,
    snapshot: writes.filter(({ codec }) => codec === "native-mono-feed-snapshot-v0").length,
  };
}

/** `proposalUnits`: the activation transaction's own tag-78 proposal-init/append instructions (D0 greedy packing). */
/** V1 CREATE_CLASSIC / CREATE_COMPOSITE core (SINGLE, or BEGIN + GROW × k + SEAL): the payer is the only signer, no identity asset. */
export function isV1CreationReview(review: MimirBetaCreationReviewV1): boolean {
  const tags = v1CreationCore(review).map((instruction) =>
    instruction.programAddress === review.programId ? fromBase64(instruction.dataBase64)[0] : undefined);
  return (tags.at(-1) === 93 || tags.at(-1) === 95) && tags.every((tag) => tag === 93 || tag === 94 || tag === 95);
}

/** Reviewed instructions between the caller prefix and the first-price suffix. */
function v1CreationCore(review: MimirBetaCreationReviewV1): MimirBetaCreationReviewV1["instructions"] {
  return review.instructions.slice(review.callerPrefix?.instructionCount ?? 0, review.instructions.length - (review.firstPrice?.instructionCount ?? 0));
}

/** First-price suffix: absent, or one canonical first-price instruction (see `isMimirV1FirstPriceSuffix`). */
async function validV1FirstPrice(review: MimirBetaCreationReviewV1): Promise<boolean> {
  if (review.firstPrice === undefined) return true;
  if (review.firstPrice.instructionCount !== 1) return false;
  const ix = review.instructions.at(-1)!;
  return isMimirV1FirstPriceSuffix({ kind: review.kind, programId: review.programId, feedId: review.feedId, feed: review.feed, authority: review.authority },
    { programAddress: ix.programAddress, accounts: ix.accounts, data: fromBase64(ix.dataBase64) });
}

/**
 * The created feed's first price, and nothing else: canonical tag-89 (classic) / tag-87 (composite) data on `feedId`, its first publication
 * (revision 0 -> 1); writable only the feed (tag 89: meta 0) or the payer, the composite and the protocol treasury (tag 87: metas 0, 1, 4); the
 * authority, at tag-87 meta 0, the only signer.
 */
export async function isMimirV1FirstPriceSuffix(t: Readonly<{ kind: string; programId: Address; feedId: Address; feed: Address; authority: Address }>,
  ix: Readonly<{ programAddress: string; accounts: readonly Readonly<{ address: string; isSigner: boolean; isWritable: boolean }>[]; data: Uint8Array }>): Promise<boolean> {
  const classic = t.kind === "classic";
  if (ix.programAddress !== t.programId) return false;
  let request: { feedId?: Uint8Array; compositeFeedId?: Uint8Array; previousSnapshotRevision: bigint; nextSnapshotRevision: bigint };
  try { request = classic ? decodeMimirFusedClassicData(ix.data) : decodeMimirFusedRefreshData(ix.data); } catch { return false; }
  if (!bytesEqual(classic ? request.feedId! : request.compositeFeedId!, addressBytes(t.feedId)) || request.previousSnapshotRevision !== 0n || request.nextSnapshotRevision !== 1n) return false;
  const writes = classic ? [t.feed] : [t.authority, t.feed, (await deriveMimirBetaPda({ programId: t.programId, seed: "protocol_treasury", values: [Uint8Array.of(1, 0)] }))[0]];
  const at = classic ? [0] : [0, 1, 4];
  return at.every((i, k) => ix.accounts[i]?.address === writes[k]) &&
    ix.accounts.every((a, i) => a.isWritable === at.includes(i) && a.isSigner === (!classic && i === 0));
}

/** V1 CREATE envelope: SINGLE, or BEGIN + GROW × k + SEAL, every core ix on `review.feed`, ticker claim and signed feed_id / ticker bound to the review. */
async function validV1CreationEnvelope(stepId: MimirBetaStepId, review: MimirBetaCreationReviewV1): Promise<boolean> {
  const classic = review.kind === "classic";
  if (stepId !== (classic ? "classic:activate" : "composite:activate")) return false;
  const tag = classic ? 93 : 95;
  const core = v1CreationCore(review);
  if (!await validV1FirstPrice(review)) return false;
  const data = core.map((instruction) => fromBase64(instruction.dataBase64));
  const last = data.at(-1)!;
  const begin = data[0]!;
  const shape = core.length === 1 ? last[2] === 0
    : begin[0] === tag && begin[1] === 1 && begin[2] === 1 && begin.length === 44 && last[2] === 2 &&
      data.slice(1, -1).every((grow) => grow[0] === 94 && grow[1] === 1 && grow.length === 6) &&
      bytesEqual(begin.subarray(12, 44), addressBytes(review.feedId));
  if (!shape || last[0] !== tag || last[1] !== 1 || core.some((instruction) => instruction.programAddress !== review.programId ||
    instruction.accounts[1]?.address !== review.feed)) return false;
  const [feed] = await deriveMimirBetaPda({ programId: review.programId, seed: classic ? "feed_snapshot" : "composite_snapshot",
    values: [addressBytes(review.feedId)] });
  const [ticker] = await deriveMimirBetaTickerPda(review.programId, review.ticker);
  if (feed !== review.feed || core.at(-1)!.accounts[2]?.address !== ticker) return false;
  const tickerAt = classic ? 16 + 313 : 30;
  try {
    return decodeMimirBetaTicker(last.subarray(tickerAt, tickerAt + 12)) === review.ticker &&
      (!classic || bytesEqual(last.subarray(32, 64), addressBytes(review.feedId)));
  } catch { return false; }
}

function terminalInstructionCount(step: MimirBetaPlanStep, proposalUnits = 0, lastData?: Uint8Array): number {
  const writes = compositeCodecWrites(step);
  const native = nativeWriteCounts(writes);
  if (native.ring !== native.twap || native.ring !== native.snapshot) return -1;
  const readySources = writes.filter(({ codec }) => codec === "source-ring-v1" || codec === "bounded-source-ring-v1").length;
  const readySnapshot = writes.filter(({ codec }) => codec === "feed-snapshot-v0" || codec === "bounded-feed-snapshot-v5" ||
    codec === "dual-feed-snapshot-v5").length;
  const nativePair = native.ring * 2;
  const compositeRoot = writes.some(({ codec }) => codec === "composite-snapshot-v1") ? 1 : 0;
  if (step.stepId === "composite:activate") {
    const execution = writes.filter(({ codec }) => codec === "composite-execution-v1");
    const length = execution.length === 1 ? step.expectedWrites.find(({ address }) => address === execution[0]!.address)?.dataLengthAfter ?? 0 : 0;
    if (compositeActivationCount(step) === 0 || (!length && (execution.length || compositeRoot))) return -1;
    if (!length) return 5 * (compositeActivationCount(step) - 1) + 4 + readySources + readySnapshot + nativePair;
    const sampleOnly = !compositeRoot && lastData !== undefined && isMimirFusedSampleOnlyData(lastData, 0n) ? 1 : 0;
    return 5 * (compositeActivationCount(step) - 1) + 4 + readySources + readySnapshot + nativePair + 1 + Math.ceil(length / 10_240) + compositeRoot + sampleOnly;
  }
  const classic = writes.find(({ codec }) => codec === "classic-execution-v1");
  const classicLength = classic ? step.expectedWrites.find(({ address }) => address === classic.address)?.dataLengthAfter ?? 0 : 0;
  if (classic && !classicLength) return -1;
  return 3 + proposalUnits + readySources + nativePair + (classic ? Math.ceil(classicLength / 10_240) + 2 : readySnapshot);
}

function isClassicActivationStep(stepId: MimirBetaStepId): boolean {
  return stepId === "classic:activate";
}

/** Reviewed instructions after the caller prefix: the core every terminal count describes. */
function coreInstructionCount(review: MimirBetaCreationReviewV1): number {
  return review.instructions.length - (review.callerPrefix?.instructionCount ?? 0) - (review.firstPrice?.instructionCount ?? 0);
}

/** A caller prefix leads only the Classic activation, funds only its burn source (covering every burn when declared so) and stays isolated from the core. */
function validCallerPrefix(stepId: MimirBetaStepId, review: MimirBetaCreationReviewV1): boolean {
  const prefix = review.callerPrefix;
  if (prefix === undefined) return true;
  const count = prefix.instructionCount;
  const funding = prefix.funding;
  const burned = review.expectedWrites.reduce((sum, write) => write.proof.kind === "spl-token-burn-checked" &&
    write.proof.sourceTokenAccount === funding?.tokenAccount ? sum + write.proof.amountRaw : sum, 0n);
  return isClassicActivationStep(stepId) && Number.isSafeInteger(count) && count >= 1 && count < review.instructions.length &&
    (funding === null || funding.tokenAccount === mimirBetaReviewCollateralTokenAccountV1(review) && typeof funding.coversBurn === "boolean" &&
      (!funding.coversBurn || funding.minimumCreditRaw >= burned)) &&
    mimirBetaCallerPrefixViolationV1({ authority: review.authority, programId: review.programId, fundingTokenAccount: funding?.tokenAccount ?? null,
      readonlyCoreAccounts: review.expectedWrites.flatMap((write) => write.proof.kind === "spl-token-burn-checked" ? [write.proof.mint] : []),
      prefix: review.instructions.slice(0, count), core: review.instructions.slice(count) }) === null;
}

/**
 * Tag 81 is followed by the contiguous complete tag-88 closure and, when the CSP is created, the first tag 87, ending the transaction.
 * Without a CSP creation the only admitted tail tag 87 is the post-Seal `0/0` fee-zero sample-only call (A1 §5).
 */
function validFusedCompositeTail(step: MimirBetaPlanStep, review: MimirBetaCreationReviewV1, standalone = false): boolean {
  const writes = compositeCodecWrites(step);
  const execution = writes.filter(({ codec }) => codec === "composite-execution-v1");
  const roots = writes.filter(({ codec }) => codec === "composite-snapshot-v1");
  if (!standalone && !execution.length && !roots.length) {
    // Staged ABI-1 launch, tx 1: identity + tag 81 only; the tag-88 closure and first tag 87 are `composite:execution`.
    try {
      const data = review.instructions.map((instruction) => fromBase64(instruction.dataBase64));
      return data.at(-1)?.[0] === 81 && review.instructions.at(-1)!.programAddress === review.programId &&
        !data.some((d, i) => review.instructions[i]!.programAddress === review.programId && (d[0] === 87 || d[0] === 88));
    } catch { return false; }
  }
  const length = execution.length === 1 ? step.expectedWrites.find(({ address }) => address === execution[0]!.address)?.dataLengthAfter ?? 0 : 0;
  if (!length || execution[0]!.transition !== "create" || roots.length > 1 || roots.some(({ transition }) => transition !== "create")) return false;
  const grows = Math.ceil(length / 10_240) - 1;
  try {
    const data = review.instructions.map((instruction) => fromBase64(instruction.dataBase64));
    const sampleOnly = !roots.length && isMimirFusedSampleOnlyData(data.at(-1)!, 0n);
    const begin = data.length - (roots.length || sampleOnly ? 3 : 2) - grows;
    const tail = data.slice(begin);
    const expected = [[88, 0], ...Array.from({ length: grows }, () => [88, 1]), [88, 2], ...(roots.length || sampleOnly ? [[87]] : [])];
    if ((standalone ? begin !== 0 : begin < 1 || data[begin - 1]![0] !== 81) || tail.length !== expected.length ||
        tail.some((d, i) => d[0] !== expected[i]![0] || (expected[i]![1] !== undefined && d[1] !== expected[i]![1])) ||
        review.instructions.slice(begin).some((instruction) => instruction.programAddress !== review.programId) ||
        data.slice(0, begin).some((d, i) => review.instructions[i]!.programAddress === review.programId && (d[0] === 87 || d[0] === 88))) return false;
    const beginIx = review.instructions[begin]!;
    if (beginIx.accounts[1]?.address !== execution[0]!.address || !beginIx.accounts[1].isWritable ||
        new DataView(tail[0]!.buffer, tail[0]!.byteOffset).getUint32(36, true) !== length) return false;
    if (roots.length) {
      const publish = review.instructions.at(-1)!;
      if (publish.accounts[1]?.address !== roots[0]!.address || publish.accounts[8]?.address !== execution[0]!.address) return false;
    }
    if (sampleOnly && review.instructions.at(-1)!.accounts[8]?.address !== execution[0]!.address) return false;
    return true;
  } catch { return false; }
}

/** Staged `composite:publish`: exactly one tag 87 writing its execution rows, creating the root snapshot or as the post-Seal `0/0` sample-only call. */
function validCompositeFirstPublication(step: MimirBetaPlanStep, review: MimirBetaCreationReviewV1): boolean {
  const writes = compositeCodecWrites(step);
  const execution = writes.filter(({ codec }) => codec === "composite-execution-v1");
  const roots = writes.filter(({ codec }) => codec === "composite-snapshot-v1");
  if (review.instructions.length !== 1 || review.instructions[0]!.programAddress !== review.programId ||
      execution.some(({ transition }) => transition !== "write") || roots.length > 1 || roots.some(({ transition }) => transition !== "create")) return false;
  try {
    const publish = review.instructions[0]!; const data = fromBase64(publish.dataBase64);
    if (data[0] !== 87) return false;
    if (execution.length !== 1 || publish.accounts[8]?.address !== execution[0]!.address) return false;
    if (roots.length) return publish.accounts[1]?.address === roots[0]!.address;
    return isMimirFusedSampleOnlyData(data, 0n);
  } catch { return false; }
}

function validCompositeActivationEnvelope(step: MimirBetaPlanStep, review: MimirBetaCreationReviewV1): boolean {
  const burns = step.expectedWrites.flatMap((write) => write.proof.kind === "spl-token-burn-checked" ? [write.proof] : []);
  const assets = activationAssets(step);
  if (assets.length === 0 || !validFusedCompositeTail(step, review)) return false;
  const missingCount = assets.length - 1;
  let burnIndexes: number[];
  try {
    const activations = review.instructions.flatMap((instruction, index) => {
      if (instruction.programAddress !== review.programId) return [];
      const opcode = fromBase64(instruction.dataBase64)[0];
      return opcode === 80 || opcode === 81 ? [{ index, opcode }] : [];
    });
    if (activations.length !== assets.length || activations.some((item, index) => item.opcode !== (index < missingCount ? 80 : 81))) return false;
    burnIndexes = activations.map(({ index }) => index);
  } catch { return false; }
  const first = burns[0];
  const oneCharSpends = step.expectedWrites.filter((write) => write.proof.kind === "account" && write.proof.transition === "write" &&
    write.proof.after.exists && write.proof.after.owner === review.programId && write.proof.after.data.length === 26 &&
    write.discriminatorHex === "4d494d4952314348");
  if (burns.length + oneCharSpends.length > assets.length || oneCharSpends.length > 1 ||
    (oneCharSpends.length === 0 && burns.length !== assets.length) ||
    new Set(burns.map((burn) => burn.outerInstructionIndex)).size !== burns.length ||
    !burns.every((burn) => burnIndexes.includes(burn.outerInstructionIndex) &&
    burn.tokenProgram === first!.tokenProgram && burn.sourceTokenAccount === first!.sourceTokenAccount && burn.mint === first!.mint &&
    burn.authority === first!.authority && burn.decimals === first!.decimals) ||
    (first && first.authority !== review.authority) ||
    coreInstructionCount(review) !== terminalInstructionCount(step, 0, fromBase64(review.instructions.at(-1)?.dataBase64 ?? ""))) return false;
  try {
    if (burnIndexes.some((outerIndex, index) => {
      const instruction = review.instructions[outerIndex];
      return !instruction || instruction.programAddress !== review.programId ||
        fromBase64(instruction.dataBase64)[0] !== (index < missingCount ? 80 : 81);
    })) return false;
  } catch { return false; }
  const expectedAssets = review.requiredSigners.slice(1);
  return new Set(assets).size === assets.length &&
    expectedAssets.length === assets.length && new Set(expectedAssets).size === expectedAssets.length &&
    assets.every((asset) => expectedAssets.includes(asset)) && burnIndexes.every((outerIndex, index) => {
      const instruction = review.instructions[outerIndex]!;
      const data = fromBase64(instruction.dataBase64);
      const identityIndex = data[0] === 81
        ? 15 + data[1 + COMPOSITE_CONFIG_OFFSETS.componentCount]! + Number(data.subarray(
          1 + COMPOSITE_CONFIG_OFFSETS.solConversionSourceConfig,
          1 + COMPOSITE_CONFIG_OFFSETS.components).some((byte) => byte !== 0))
        : -1;
      const identity = data[0] === 81 ? instruction.accounts[identityIndex] : instruction.accounts.at(-1);
      return identity?.address === assets[index] && identity.isSigner;
    }) && assets.at(-1) === review.identityAsset && review.packet.signatureCount === review.requiredSigners.length;
}

/**
 * Verifies that the wallet-signed transaction carries a fee-only rewrite of the reviewed message and
 * a signature vector over that wallet message.
 * This is a pure pre-send check that does not sign or send; it must succeed before the app persists the
 * public receipt, and successful receipt persistence must still precede sending.
 */
export async function assertMimirBetaFusedSignedTransaction(args: {
  readonly preparedStep: MimirBetaPreparedStep;
  readonly signedTransaction: Uint8Array;
  readonly signatures: readonly MimirBetaSignerSignature[];
}): Promise<void> {
  const { preparedStep } = args;
  const expectedSigners = preparedStep.transaction.requiredSigners;
  const expectedInstructionCount = terminalInstructionCount(preparedStep.step,
    preparedStep.transaction.instructions.filter((instruction) => instruction.programAddress === preparedStep.review.programId && instruction.data[0] === 78).length,
    preparedStep.transaction.instructions.at(-1)?.data);
  const expectedSignerCount = preparedStep.step.stepId === "composite:activate" ? compositeActivationCount(preparedStep.step) + 1 : 2;
  if ((!isClassicActivationStep(preparedStep.step.stepId) && preparedStep.step.stepId !== "composite:activate") ||
    coreInstructionCount(preparedStep.review) !== expectedInstructionCount ||
    !validCallerPrefix(preparedStep.step.stepId, preparedStep.review) ||
    !sameStringVector(expectedSigners, preparedStep.step.requiredSigners) ||
    !sameStringVector(expectedSigners, preparedStep.review.requiredSigners) ||
    expectedSigners.length !== expectedSignerCount || expectedSigners[0] !== preparedStep.review.authority ||
    (isClassicActivationStep(preparedStep.step.stepId) && expectedSigners.at(-1) !== preparedStep.review.identityAsset) ||
    preparedStep.transaction.packet.signatureCount !== expectedSignerCount ||
    (preparedStep.step.stepId === "composite:activate" && !validCompositeActivationEnvelope(preparedStep.step, preparedStep.review)) ||
    preparedStep.transaction.serializedTransaction[0] !== 0x81 ||
    args.signedTransaction.length > MIMIR_BETA_TRANSACTION_V1_MAX_BYTES || args.signedTransaction[0] !== 0x81 ||
    args.signatures.length !== expectedSignerCount) {
    betaError("RECEIPT_MISMATCH", "fused transaction/signature envelope invalid");
  }
  const messageLength = args.signedTransaction.length - expectedSignerCount * 64;
  const walletMessage = args.signedTransaction.slice(0, Math.max(messageLength, 0));
  let reviewedBytes: Uint8Array;
  try { reviewedBytes = mimirBetaReviewedMessageOfWalletV1(walletMessage, preparedStep.review); }
  catch { return betaError("RECEIPT_MISMATCH", "signed transaction message differs from reviewed bytes"); }
  if (!bytesEqual(reviewedBytes, preparedStep.transaction.serializedMessage) ||
    !bytesEqual(preparedStep.transaction.serializedTransaction.subarray(0, reviewedBytes.length), reviewedBytes) ||
    !isMimirBetaWalletRewriteV1(reviewedBytes, walletMessage, mimirBetaReviewWalletGuardAccountsV1(preparedStep.review))) {
    betaError("RECEIPT_MISMATCH", "signed transaction message differs from reviewed bytes");
  }
  assertMimirBetaReviewedMessageV1(walletMessage, preparedStep, "RECEIPT_MISMATCH");
  for (let index = 0; index < expectedSignerCount; index += 1) {
    const supplied = args.signatures[index]!;
    const reviewedStart = reviewedBytes.length + index * 64;
    const start = messageLength + index * 64;
    if (supplied.address !== expectedSigners[index] || supplied.signature.length !== 64 ||
      supplied.signature.every((byte) => byte === 0) ||
      preparedStep.transaction.serializedTransaction.subarray(reviewedStart, reviewedStart + 64).some((byte) => byte !== 0) ||
      supplied.signature.some((byte, byteIndex) => args.signedTransaction[start + byteIndex] !== byte) ||
      !(await verifySignature(await getPublicKeyFromAddress(supplied.address), signatureBytes(supplied.signature), walletMessage))) {
      betaError("RECEIPT_MISMATCH", "missing, reordered, or mutated fused signature");
    }
  }
}

export interface MimirBetaStageReceipt {
  readonly schema: "mimir-beta-stage-receipt";
  readonly version: 2;
  readonly draftHash: string;
  readonly stepId: MimirBetaStepId;
  readonly attempt: 1 | 2;
  readonly stepIntentHash: string;
  readonly expectedWritesHash: string;
  readonly reviewHash: string;
  readonly messageHash: string;
  readonly messageBase64: string;
  readonly signature: string;
  readonly retryOfSignature: string | null;
  readonly reviewedStep: MimirBetaReviewedStepLineage;
}

export interface MimirBetaReviewedStepLineage {
  readonly step: MimirBetaPlanStep;
  readonly review: MimirBetaCreationReviewV1;
  readonly canonicalReviewJson: string;
  readonly reviewHash: string;
}

export type MimirBetaProvenObservation =
  | { readonly state: "pending"; readonly stepId: MimirBetaStepId; readonly signature: string }
  | {
      readonly state: "expired";
      readonly stepId: MimirBetaStepId;
      readonly signature: string;
      readonly observedSlot: bigint;
      readonly messageHash: string;
      readonly blockhash: string;
      readonly accountContextSlot: bigint;
      readonly rollback: "baseline-matched" | "state-diverged";
      readonly evidenceHash: string;
    }
  | {
      readonly state: "finalized";
      readonly stepId: MimirBetaStepId;
      readonly signature: string;
      readonly observedSlot: bigint;
      readonly accountContextSlot: bigint;
      readonly messageHash: string;
      readonly evidenceHash: string;
      readonly writes: readonly MimirBetaWriteEvidence[];
    }
  | {
      readonly state: "failed";
      readonly stepId: MimirBetaStepId;
      readonly signature: string;
      readonly observedSlot: bigint;
      readonly messageHash: string;
      readonly errorHash: string;
      readonly rollback: "baseline-matched" | "state-diverged";
      readonly evidenceHash: string;
    };

export type MimirBetaConfirmedObservation =
  | MimirBetaProvenObservation
  | (Omit<Extract<MimirBetaProvenObservation, { state: "finalized" }>, "state"> & { readonly state: "confirmed" })
  | (Omit<Extract<MimirBetaProvenObservation, { state: "failed" }>, "state"> & { readonly state: "confirmed-failed" });

/** @deprecated Proven observations replace caller-authored reconciliation claims. */
export type ReconciliationObservation = MimirBetaProvenObservation;

export interface MimirBetaStepReconciliation {
  readonly stepId: MimirBetaStepId;
  readonly state: "blocked" | "reviewable" | "pending" | "finalized" | "confirmed" | "failed" | "conflict";
  readonly finalizedSignature: string | null;
  readonly observedSlot: bigint | null;
}

export interface MimirBetaCreationReconciliation {
  readonly steps: readonly MimirBetaStepReconciliation[];
  readonly action: "review-next-step" | "await-finality" | "retry-once" | "complete" | "blocked";
  readonly nextStepId: MimirBetaStepId | null;
  readonly observedSlot: bigint;
}

export interface MimirBetaPreparedCreation {
  readonly schema: "mimir-beta-prepared-creation";
  readonly version: 1;
  readonly canonicalDraftJson: string;
  readonly draftHash: string;
  readonly selectedPools: readonly MimirBetaEligiblePool[] | null;
  readonly plan: MimirBetaUnsignedPlan;
  readonly reconciliation: MimirBetaCreationReconciliation;
  readonly next: MimirBetaPreparedStep | null;
  /** Present only for zero-fee AMM-v4/PumpSwap feeds: the snapshot is warming; publish once ready. */
  readonly snapshot?: "warming";
  readonly readiness?: MimirSampledReadiness;
  readonly resolvedVariant?: number;
  readonly feedId?: Address;
  /** Classic temporal mode resolved for this creation (omitted input on an admitted point source resolves to `"current-point"`); pass it on resume. */
  readonly temporalMode?: MimirTemporalMode;
  readonly fusedComposite?: MimirBetaFusedCompositeCreation;
  /** SDK compile admission against the hash-pinned consumer budget contract; render verbatim, never re-assemble packets. */
  readonly consumerAdmission?: MimirConsumerAdmissionV1;
}

/** Fresh fused Composite creation: one transaction carries definitions/CFC, the complete tag-88 closure, and tag 87 when ready (or two when staged). */
/** One inline DLMM leg that may be created with the native-visible (one bin array) binding instead of routeable. */
export interface MimirBetaVisibleDlmmLeg {
  readonly componentIndex: number;
  /** The inline Classic is also the SOL-conversion feed, so its converter row switches too. */
  readonly converter: boolean;
  readonly pool: Address;
  /** Visible lower-bound depth (active bin array only); the source floor is this value, never the routeable window. */
  readonly minDepthTo50BpsNative: bigint;
}

export interface MimirBetaFusedCompositeCreation {
  readonly execution: Address;
  readonly executionLength: number;
  readonly growCount: number;
  readonly freshCreationAtomic: boolean;
  /**
   * ABI-1 two-transaction launch: `composite:activate` (identity + tag 81), then `composite:execution` (tag-88 closure + first tag 87).
   * With `stagedExecution`: `composite:activate`, `composite:init` (tag-88 closure only), then `composite:publish` (first tag 87).
   */
  readonly staged: boolean;
  readonly temporalWarmupRequired: boolean;
  /** Fresh mode-4 creation: Seal is followed by the `0/0`, fee-zero sample-only tag 87 that records the first anchor. */
  readonly postSealSampleOnly: boolean;
  /** Later permissionless tag-87 publication once the temporal window matures; null when the first tag 87 is in the creating transaction. */
  readonly warmupPublication: Readonly<{ kind: "permissionless-tag87"; compositeConfig: Address }> | null;
  /** Inline DLMM legs created native visible (one bin array, reduced depth window) so the producer fits; absent when none switched. */
  readonly visibleDlmmLegs?: readonly MimirBetaVisibleDlmmLeg[];
}


const STEP_IDS = new Set<string>([
  "classic:proposal-init",
  "classic:source-append:0", "classic:source-append:1", "classic:source-append:2",
  "classic:source-append:3", "classic:source-append:4", "classic:activate",
  "classic:source-initialize:0", "classic:source-initialize:1", "classic:source-initialize:2",
  "classic:source-initialize:3", "classic:source-initialize:4", "classic:ready",
  "composite:activate", "composite:execution", "composite:init", "composite:publish",
]);
const validStepId = (stepId: string) => STEP_IDS.has(stepId);
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const RECEIPT_KEYS = ["attempt", "draftHash", "expectedWritesHash", "messageBase64", "messageHash", "retryOfSignature", "reviewHash",
  "reviewedStep", "schema", "signature", "stepId", "stepIntentHash", "version"] as const;
const REVIEWED_STEP_KEYS = ["canonicalReviewJson", "review", "reviewHash", "step"] as const;
const STEP_KEYS = ["expectedWrites", "ordinal", "prerequisiteStepIds", "requiredSigners", "stage", "stepId"] as const;
const FORBIDDEN_PUBLIC_KEY_FRAGMENTS = Object.freeze([
  "private", "secret", "seed", "keypair", "keymaterial", "wallet", "cryptokey",
]);
const FORBIDDEN_PUBLIC_KEYS = new Set([
  "serializedmessage", "serializedtransaction", "transactionbytes", "messagebytes", "signedbytes", "signaturebytes",
]);

function isForbiddenPublicKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return FORBIDDEN_PUBLIC_KEYS.has(normalized) || FORBIDDEN_PUBLIC_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function publicSnapshot<T>(value: T): T {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) betaError("RECEIPT_MISMATCH", "reviewed lineage contains a non-integer number");
    return value;
  }
  if (value instanceof Uint8Array || typeof value !== "object") {
    betaError("RECEIPT_MISMATCH", "reviewed lineage contains bytes or a non-public value");
  }
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => publicSnapshot(entry))) as T;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    betaError("RECEIPT_MISMATCH", "reviewed lineage contains a non-plain object");
  }
  const out: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (isForbiddenPublicKey(key) || member === undefined) {
      betaError("RECEIPT_MISMATCH", "reviewed lineage contains a forbidden public field");
    }
    out[key] = publicSnapshot(member);
  }
  return Object.freeze(out) as T;
}

function jsonSafePublicValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map(jsonSafePublicValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, jsonSafePublicValue(member)]));
  return value;
}

function receiptBigint(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  return betaError("RECEIPT_MISMATCH", `reviewed lineage ${label} is not canonical unsigned bigint`);
}

function receiptSignedBigint(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^(?:0|-?[1-9][0-9]*)$/.test(value)) return BigInt(value);
  return betaError("RECEIPT_MISMATCH", `reviewed lineage ${label} is not canonical bigint`);
}

function reviveExpectedWrite(write: MimirBetaExpectedWrite): MimirBetaExpectedWrite {
  const proof = write.proof;
  if (proof.kind === "account") return { ...write, proof: { ...proof,
    before: { ...proof.before, lamports: receiptBigint(proof.before.lamports, "account baseline lamports") },
    after: { ...proof.after, lamports: receiptBigint(proof.after.lamports, "account post lamports") } as MimirBetaAccountPostcondition,
  } };
  if (proof.kind === "lamports") return { ...write, proof: { ...proof,
    programDeltaLamports: receiptSignedBigint(proof.programDeltaLamports, "program lamport delta") } };
  if (proof.kind === "caller-prefix") return { ...write, proof: { ...proof,
    before: { ...proof.before, lamports: receiptBigint(proof.before.lamports, "caller-prefix baseline lamports") },
    simulatedLamportDelta: receiptSignedBigint(proof.simulatedLamportDelta, "caller-prefix lamport delta") } };
  return { ...write, proof: { ...proof, amountRaw: receiptBigint(proof.amountRaw, "burn amount") } };
}

function reviveCallerPrefix(prefix: MimirBetaCallerPrefixReview): MimirBetaCallerPrefixReview {
  if (!prefix || typeof prefix !== "object" || !Array.isArray(prefix.guardTokenAccounts) || !Array.isArray(prefix.tokenDeltas) ||
    prefix.funding !== null && (!prefix.funding || typeof prefix.funding !== "object")) betaError("RECEIPT_MISMATCH", "reviewed caller prefix is malformed");
  return { ...prefix,
    funding: prefix.funding && { ...prefix.funding, minimumCreditRaw: receiptBigint(prefix.funding.minimumCreditRaw, "caller-prefix minimum credit") },
    maxAuthorityDebitLamports: receiptBigint(prefix.maxAuthorityDebitLamports, "caller-prefix debit bound"),
    tokenDeltas: prefix.tokenDeltas.map((delta) => ({ ...delta, preAmountRaw: receiptBigint(delta.preAmountRaw, "caller-prefix token balance"),
      postAmountRaw: receiptBigint(delta.postAmountRaw, "caller-prefix token balance") })) };
}

function reviveReviewedStep(lineage: MimirBetaReviewedStepLineage): MimirBetaReviewedStepLineage {
  const step = { ...lineage.step, expectedWrites: lineage.step.expectedWrites.map(reviveExpectedWrite) };
  const review = { ...lineage.review,
    expectedWrites: lineage.review.expectedWrites.map(reviveExpectedWrite),
    simulation: { ...lineage.review.simulation,
      contextSlot: receiptBigint(lineage.review.simulation.contextSlot, "simulation slot"),
      unitsConsumed: lineage.review.simulation.unitsConsumed === null ? null : receiptBigint(lineage.review.simulation.unitsConsumed, "simulation units"),
    },
    ...(lineage.review.callerPrefix === undefined ? {} : { callerPrefix: reviveCallerPrefix(lineage.review.callerPrefix) }),
  };
  return { ...lineage, step, review };
}

function base58Length(value: string): number {
  if (value.length === 0) return 0;
  const bytes = [0];
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return -1;
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index]! * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  let zeroes = 0;
  while (zeroes < value.length && value[zeroes] === "1") zeroes += 1;
  return bytes.length + zeroes - (bytes.length === 1 && bytes[0] === 0 ? 1 : 0);
}

export async function createDraftHash(payload: object): Promise<{ readonly canonicalDraftJson: string; readonly draftHash: string }> {
  const canonicalDraftJson = canonicalJson(payload as never);
  return { canonicalDraftJson, draftHash: await domainHash("MIMIR_BETA_DRAFT_V1\0", canonicalDraftJson) };
}

export async function createReviewHash(payload: object): Promise<{ readonly canonicalReviewJson: string; readonly reviewHash: string }> {
  const canonicalReviewJson = canonicalJson(payload as never);
  return { canonicalReviewJson, reviewHash: await domainHash("MIMIR_BETA_REVIEW_V1\0", canonicalReviewJson) };
}

export async function createMessageHash(serializedMessage: Uint8Array): Promise<string> {
  return hex(await sha256(serializedMessage));
}

export async function createExpectedWritesHash(writes: readonly MimirBetaExpectedWrite[]): Promise<string> {
  return domainHash("MIMIR_BETA_EXPECTED_WRITES_V1\0", canonicalJson(writes as never));
}

/** A reviewed caller prefix binds its whole review, simulated token balances included, into the intent. */
export async function createStepIntentHash(args: {
  readonly draftHash: string;
  readonly step: MimirBetaPlanStep;
  readonly expectedWritesHash: string;
  readonly callerPrefix?: MimirBetaCallerPrefixReview;
}): Promise<string> {
  const { callerPrefix, ...intent } = args;
  return domainHash("MIMIR_BETA_STEP_INTENT_V1\0", canonicalJson((callerPrefix ? { ...intent, callerPrefix } : intent) as never));
}

/**
 * Snapshots the public reviewed lineage before a caller persists a signed-stage receipt.
 * This helper never signs, sends, or persists transaction bytes.
 */
export function createMimirBetaStageReceipt(args: {
  readonly preparedStep: MimirBetaPreparedStep;
  readonly signature: string;
  readonly attempt: 1 | 2;
  readonly retryOfSignature: string | null;
  /** Wallet-signed message bytes; defaults to the reviewed message. */
  readonly signedMessage?: Uint8Array;
}): MimirBetaStageReceipt {
  const signedMessage = args.signedMessage ?? args.preparedStep.transaction.serializedMessage;
  if (!isMimirBetaWalletRewriteV1(args.preparedStep.transaction.serializedMessage, signedMessage,
    mimirBetaReviewWalletGuardAccountsV1(args.preparedStep.review))) {
    betaError("RECEIPT_MISMATCH", "wallet changed the reviewed Transaction v1 message");
  }
  if (args.preparedStep.step.stepId !== args.preparedStep.review.stepId ||
    args.preparedStep.transaction.messageHash !== args.preparedStep.review.messageHash ||
    !/^[0-9a-f]{64}$/.test(args.preparedStep.reviewHash) ||
    args.preparedStep.canonicalReviewJson.length === 0 ||
    !sameStringVector(args.preparedStep.step.requiredSigners, args.preparedStep.review.requiredSigners) ||
    !sameStringVector(args.preparedStep.transaction.requiredSigners, args.preparedStep.review.requiredSigners) ||
    canonicalJson(args.preparedStep.step.expectedWrites as never) !== canonicalJson(args.preparedStep.review.expectedWrites as never)) {
    betaError("RECEIPT_MISMATCH", "prepared step public review binding invalid");
  }
  const reviewedStep = publicSnapshot<MimirBetaReviewedStepLineage>({
    step: args.preparedStep.step,
    review: args.preparedStep.review,
    canonicalReviewJson: args.preparedStep.canonicalReviewJson,
    reviewHash: args.preparedStep.reviewHash,
  });
  const receipt: MimirBetaStageReceipt = {
    schema: "mimir-beta-stage-receipt",
    version: 2,
    draftHash: reviewedStep.review.draftHash,
    stepId: reviewedStep.step.stepId,
    attempt: args.attempt,
    stepIntentHash: reviewedStep.review.stepIntentHash,
    expectedWritesHash: reviewedStep.review.expectedWritesHash,
    reviewHash: reviewedStep.reviewHash,
    messageHash: hex(sha256Sync(signedMessage)),
    messageBase64: base64(signedMessage),
    signature: args.signature,
    retryOfSignature: args.retryOfSignature,
    reviewedStep,
  };
  Object.defineProperty(receipt, "toJSON", { enumerable: false, value: () => jsonSafePublicValue(receipt) });
  Object.freeze(receipt);
  validateStageReceipt(receipt);
  return receipt;
}

export function validateStageReceipt(receipt: MimirBetaStageReceipt): void {
  const lineage = receipt?.reviewedStep;
  if (!receipt || typeof receipt !== "object" || !exactKeys(receipt, RECEIPT_KEYS) ||
    receipt.schema !== "mimir-beta-stage-receipt" || receipt.version !== 2 ||
    !validStepId(receipt.stepId) || (receipt.attempt !== 1 && receipt.attempt !== 2) ||
    !/^[0-9a-f]{64}$/.test(receipt.draftHash) || !/^[0-9a-f]{64}$/.test(receipt.reviewHash) ||
    !/^[0-9a-f]{64}$/.test(receipt.messageHash) || typeof receipt.messageBase64 !== "string" || !/^[0-9a-f]{64}$/.test(receipt.stepIntentHash) ||
    !/^[0-9a-f]{64}$/.test(receipt.expectedWritesHash) || base58Length(receipt.signature) !== 64 ||
    (receipt.attempt === 1 ? receipt.retryOfSignature !== null : base58Length(receipt.retryOfSignature ?? "") !== 64) ||
    !lineage || typeof lineage !== "object" || !exactKeys(lineage, REVIEWED_STEP_KEYS) ||
    !lineage.step || typeof lineage.step !== "object" || !exactKeys(lineage.step, STEP_KEYS) ||
    !lineage.review || typeof lineage.review !== "object" || typeof lineage.canonicalReviewJson !== "string" ||
    !/^[0-9a-f]{64}$/.test(lineage.reviewHash) || !Array.isArray(lineage.step.prerequisiteStepIds) ||
    !Array.isArray(lineage.step.requiredSigners) || !Array.isArray(lineage.step.expectedWrites) ||
    !Array.isArray(lineage.review.requiredSigners) || !Array.isArray(lineage.review.instructions) ||
    !Array.isArray(lineage.review.expectedWrites)) {
    betaError("RECEIPT_MISMATCH", "receipt schema/hash/signature invalid");
  }
  publicSnapshot(lineage);
}

/** Recomputes every public reviewed-step binding carried by a durable receipt. */
export async function authenticateMimirBetaReviewedStep(receipt: MimirBetaStageReceipt): Promise<MimirBetaReviewedStepLineage> {
  validateStageReceipt(receipt);
  const revived = reviveReviewedStep(receipt.reviewedStep);
  const { step, review, canonicalReviewJson, reviewHash } = revived;
  const expectedWritesHash = await createExpectedWritesHash(step.expectedWrites);
  const stepIntentHash = await createStepIntentHash({ draftHash: receipt.draftHash, step, expectedWritesHash, callerPrefix: review.callerPrefix });
  const recomputedReview = await createReviewHash(review);
  const instructionsValid = review.instructions.every((instruction) => {
    if (!instruction || typeof instruction !== "object" || typeof instruction.programAddress !== "string" ||
      !Array.isArray(instruction.accounts) || typeof instruction.dataBase64 !== "string" ||
      !/^[0-9a-f]{64}$/.test(instruction.dataSha256)) return false;
    try {
      const data = fromBase64(instruction.dataBase64);
      return instruction.accounts.every((account) => account && typeof account.address === "string" &&
        typeof account.isSigner === "boolean" && typeof account.isWritable === "boolean") && data.length >= 0;
    } catch { return false; }
  });
  const instructionHashes = await Promise.all(review.instructions.map(async (instruction) =>
    hex(await sha256(fromBase64(instruction.dataBase64)))));
  const terminal = isClassicActivationStep(step.stepId) || step.stepId === "composite:activate";
  const v1 = terminal && isV1CreationReview(review);
  const expectedInstructionCount = terminalInstructionCount(step, review.instructions.filter((instruction) =>
    instruction.programAddress === review.programId && fromBase64(instruction.dataBase64)[0] === 78).length,
    review.instructions.at(-1) ? fromBase64(review.instructions.at(-1)!.dataBase64) : undefined);
  const expectedSignerCount = step.stepId === "composite:activate" ? compositeActivationCount(step) + 1 : 2;
  if (review.schema !== "mimir-beta-creation-review" || review.version !== 1 || review.draftHash !== receipt.draftHash ||
    review.stepId !== receipt.stepId || step.stepId !== receipt.stepId || step.stage !== "mimir-create" ||
    !Number.isSafeInteger(step.ordinal) || step.ordinal < 0 || step.prerequisiteStepIds.some((id) => !validStepId(id)) ||
    new Set(step.prerequisiteStepIds).size !== step.prerequisiteStepIds.length ||
    !sameStringVector(step.requiredSigners, review.requiredSigners) || new Set(step.requiredSigners).size !== step.requiredSigners.length ||
    canonicalJson(step.expectedWrites as never) !== canonicalJson(review.expectedWrites as never) ||
    receipt.expectedWritesHash !== expectedWritesHash || review.expectedWritesHash !== expectedWritesHash ||
    receipt.stepIntentHash !== stepIntentHash || review.stepIntentHash !== stepIntentHash ||
    !/^[0-9a-f]{64}$/.test(review.messageHash) ||
    receipt.reviewHash !== reviewHash || reviewHash !== recomputedReview.reviewHash ||
    canonicalReviewJson !== recomputedReview.canonicalReviewJson || !instructionsValid ||
    instructionHashes.some((hash, index) => hash !== review.instructions[index]!.dataSha256) ||
    !review.packet || typeof review.packet !== "object" || review.packet.packetLimitBytes !== 4096 ||
    !validMimirBetaTransactionV1Limits(review.packet.config) ||
    review.authority !== review.requiredSigners[0] ||
    !/^[A-Z0-9]{1,12}$/.test(review.ticker) ||
    (v1 && (review.requiredSigners.length !== 1 || review.packet.signatureCount !== 1 || !(await validV1CreationEnvelope(step.stepId, review)))) ||
    (terminal && !v1 && (review.requiredSigners.length !== expectedSignerCount ||
      isClassicActivationStep(step.stepId) && review.requiredSigners.at(-1) !== review.identityAsset ||
      coreInstructionCount(review) !== expectedInstructionCount || review.packet.signatureCount !== expectedSignerCount)) ||
    !validCallerPrefix(step.stepId, review) || (review.firstPrice !== undefined && !v1) ||
    (step.stepId === "composite:activate" && !v1 && !validCompositeActivationEnvelope(step, review)) ||
    ((step.stepId === "composite:execution" || step.stepId === "composite:init") && !validFusedCompositeTail(step, review, true)) ||
    (step.stepId === "composite:publish" && !validCompositeFirstPublication(step, review)) ||
    (review.kind === "classic" ? review.displayName !== null : typeof review.displayName !== "string")) {
    betaError("RECEIPT_MISMATCH", "receipt reviewed-step authority invalid");
  }
  if (review.kind === "composite") {
    try { validateMimirBetaDisplayName(review.displayName as string); }
    catch { betaError("RECEIPT_MISMATCH", "receipt display name is not canonical"); }
  }
  let messageBytes: Uint8Array;
  let signature: Uint8Array;
  try {
    messageBytes = fromBase64(receipt.messageBase64);
    signature = Uint8Array.from(bs58.decode(receipt.signature));
  } catch { return betaError("RECEIPT_MISMATCH", "receipt message/signature encoding invalid"); }
  if (messageBytes.length < 1 || messageBytes.length > 4096 || base64(messageBytes) !== receipt.messageBase64 ||
    hex(await sha256(messageBytes)) !== receipt.messageHash) betaError("RECEIPT_MISMATCH", "receipt message encoding/hash invalid");
  if (reviewedMessageHashOf(receipt) !== review.messageHash) betaError("RECEIPT_MISMATCH", "receipt reviewed-step authority invalid");
  const parsed = assertMimirBetaReviewedMessageV1(messageBytes, revived);
  if (parsed.staticAccountKeys[0] !== review.authority || signature.length !== 64 ||
    !(await verifySignature(await getPublicKeyFromAddress(review.authority), signatureBytes(signature), messageBytes))) {
    betaError("RECEIPT_MISMATCH", "receipt payer signature is not authentic");
  }
  return revived;
}

function reviewedMessageHashOf(receipt: MimirBetaStageReceipt): string | null {
  try {
    const walletMessage = fromBase64(receipt.messageBase64);
    const reviewed = mimirBetaReviewedMessageOfWalletV1(walletMessage, receipt.reviewedStep.review);
    return isMimirBetaWalletRewriteV1(reviewed, walletMessage, mimirBetaReviewWalletGuardAccountsV1(receipt.reviewedStep.review)) ? hex(sha256Sync(reviewed)) : null;
  } catch { return null; }
}

function sameStringVector(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validExpiredObservation(receipt: MimirBetaStageReceipt, observation: Extract<MimirBetaProvenObservation, { state: "expired" }>): boolean {
  const parsed = assertMimirBetaReviewedMessageV1(fromBase64(receipt.messageBase64), receipt.reviewedStep);
  const canonical = canonicalJson({ stepId: observation.stepId, signature: observation.signature, messageHash: observation.messageHash,
    blockhash: observation.blockhash, observedSlot: observation.observedSlot, accountContextSlot: observation.accountContextSlot,
    rollback: observation.rollback });
  return observation.blockhash === parsed.blockhash && observation.observedSlot >= 0n &&
    (observation.rollback === "baseline-matched" || observation.rollback === "state-diverged") &&
    observation.evidenceHash === hex(sha256Sync(concatBytes(utf8("MIMIR_BETA_EXPIRED_EVIDENCE_V1\0"), utf8(canonical))));
}

function reconcileReceipts(args: {
  readonly draftHash: string;
  readonly steps: readonly MimirBetaPlanStep[];
  readonly receipts: readonly MimirBetaStageReceipt[];
  readonly observations: readonly (MimirBetaProvenObservation | MimirBetaConfirmedObservation)[];
  readonly observedSlot: bigint;
}, confirmedPreparation = false): MimirBetaCreationReconciliation {
  const ordered = args.steps;
  if (ordered.length === 0 || new Set(ordered.map((step) => step.stepId)).size !== ordered.length ||
    ordered.some((step, index) => step.ordinal !== index || !validStepId(step.stepId))) {
    betaError("INVALID_ARGUMENT", "invalid ordered step plan");
  }
  const receiptMap = new Map<MimirBetaStepId, MimirBetaStageReceipt[]>();
  for (const receipt of args.receipts) {
    validateStageReceipt(receipt);
    const plannedStep = ordered.find((step) => step.stepId === receipt.stepId);
    if (receipt.draftHash !== args.draftHash || !plannedStep ||
      canonicalJson(plannedStep as never) !== canonicalJson(receipt.reviewedStep.step as never) ||
      receipt.reviewedStep.review.draftHash !== receipt.draftHash || receipt.reviewedStep.review.stepId !== receipt.stepId ||
      receipt.reviewedStep.reviewHash !== receipt.reviewHash || receipt.reviewedStep.review.messageHash !== reviewedMessageHashOf(receipt) ||
      receipt.reviewedStep.review.expectedWritesHash !== receipt.expectedWritesHash ||
      receipt.reviewedStep.review.stepIntentHash !== receipt.stepIntentHash) {
      betaError("RECEIPT_MISMATCH", "receipt bound to another draft or step");
    }
    const list = receiptMap.get(receipt.stepId) ?? [];
    if (list.some((other) => other.attempt === receipt.attempt || other.signature === receipt.signature)) {
      betaError("RECEIPT_MISMATCH", "replayed receipt");
    }
    if (list.length > 0 && (list[0]!.stepIntentHash !== receipt.stepIntentHash || list[0]!.expectedWritesHash !== receipt.expectedWritesHash ||
      receipt.retryOfSignature !== list[0]!.signature || receipt.reviewHash === list[0]!.reviewHash ||
      receipt.messageHash === list[0]!.messageHash || receipt.signature === list[0]!.signature)) {
      betaError("RECEIPT_MISMATCH", "retry intent or fresh transaction binding invalid");
    }
    if (list.length >= 2) betaError("UNCHANGED_RETRY_EXHAUSTED", `step ${receipt.stepId} has more than two attempts`);
    list.push(receipt);
    receiptMap.set(receipt.stepId, list);
  }
  const observationMap = new Map<string, MimirBetaProvenObservation | MimirBetaConfirmedObservation>();
  for (const observation of args.observations) {
    const key = `${observation.stepId}:${observation.signature}`;
    if (observationMap.has(key)) betaError("RECEIPT_MISMATCH", "duplicate observation");
    observationMap.set(key, observation);
  }
  const states: MimirBetaStepReconciliation[] = [];
  const finalized = new Set<MimirBetaStepId>();
  let action: MimirBetaCreationReconciliation["action"] = "complete";
  let nextStepId: MimirBetaStepId | null = null;
  let terminalChosen = false;
  for (const step of ordered) {
    const receipts = [...(receiptMap.get(step.stepId) ?? [])].sort((a, b) => a.attempt - b.attempt);
    const prerequisitesMet = step.prerequisiteStepIds.every((id) => finalized.has(id));
    let state: MimirBetaStepReconciliation["state"];
    let signature: string | null = null;
    let observedSlot: bigint | null = null;
    if (receipts.length === 0) {
      if (!prerequisitesMet) state = "blocked";
      else state = "reviewable";
    } else {
      const receipt = receipts.at(-1)!;
      const observation = observationMap.get(`${step.stepId}:${receipt.signature}`);
      observedSlot = observation && observation.state !== "pending" ? observation.observedSlot : null;
      if (!observation || observation.state === "pending") state = "pending";
      else if (observation.messageHash !== receipt.messageHash) {
        state = "conflict";
        signature = observation.signature;
      } else if (observation.state === "confirmed-failed") state = "pending";
      else if (observation.state === "failed") {
        state = observation.rollback === "baseline-matched" ? "failed" : "conflict";
        signature = observation.signature;
        if (receipt.attempt === 2 && observation.rollback === "baseline-matched") betaError("UNCHANGED_RETRY_EXHAUSTED", `step ${step.stepId} failed twice`);
      } else if (observation.state === "expired") {
        state = !validExpiredObservation(receipt, observation) ? "conflict"
          : observation.rollback === "baseline-matched" && receipt.attempt === 1 && prerequisitesMet &&
            step.prerequisiteStepIds.every((id) => states.some((prior) => prior.stepId === id && prior.state === "finalized")) &&
            typeof observation.accountContextSlot === "bigint" && observation.accountContextSlot >= observation.observedSlot &&
            observation.accountContextSlot >= receipt.reviewedStep.review.simulation.contextSlot &&
            isSealedMimirBetaExpiredObservation(observation) ? "failed" : "blocked";
        signature = observation.signature;
      } else if ((observation.state === "finalized" || confirmedPreparation && observation.state === "confirmed") && observation.accountContextSlot >= observation.observedSlot && /^[0-9a-f]{64}$/.test(observation.evidenceHash) &&
        observation.writes.length === step.expectedWrites.length && observation.writes.every((write, index) => {
          const expected = step.expectedWrites[index];
          const expectedKind = expected?.proof.kind === "spl-token-burn-checked" ? "spl-token-burn-checked" : expected?.proof.kind;
          return write.index === index && write.address === expected?.address && write.kind === expectedKind &&
            /^[0-9a-f]{64}$/.test(write.evidenceHash);
        })) {
        state = observation.state;
        signature = observation.state === "finalized" ? observation.signature : null;
        finalized.add(step.stepId);
      } else {
        state = "conflict";
        signature = observation.signature;
      }
    }
    states.push({ stepId: step.stepId, state, finalizedSignature: signature, observedSlot });
    if (!terminalChosen && state !== "finalized" && state !== "confirmed") {
      terminalChosen = true;
      nextStepId = step.stepId;
      if (state === "reviewable") action = "review-next-step";
      else if (state === "pending") action = "await-finality";
      else if (state === "failed") action = "retry-once";
      else action = "blocked";
    }
  }
  if (action === "complete" && states.some((step) => step.state === "confirmed")) action = "await-finality";
  return { steps: states, action, nextStepId, observedSlot: args.observedSlot };
}

export function reconcileStepReceipts(args: Omit<Parameters<typeof reconcileReceipts>[0], "observations"> & {
  readonly observations: readonly MimirBetaProvenObservation[];
}): MimirBetaCreationReconciliation {
  return reconcileReceipts(args);
}

export function reconcileMimirBetaConfirmedPreparationReceipts(args: Omit<Parameters<typeof reconcileReceipts>[0], "observations"> & {
  readonly observations: readonly MimirBetaConfirmedObservation[];
}): MimirBetaCreationReconciliation {
  return reconcileReceipts(args, true);
}

/** Backwards-compatible name; reconciliation is step-bound in the beta facade. */
export const reconcileStageReceipts = reconcileStepReceipts;

export function verifyOrphanIdentityBinding(args: {
  readonly expectedDraftHash: string;
  readonly receipt: MimirBetaStageReceipt;
  readonly creatorMatches: boolean;
  readonly assetMatches: boolean;
  readonly atomDisabled: boolean;
  readonly collectionMatches: boolean;
  readonly pointerLockedAndMatches: boolean;
  readonly coreOwnerVerified: boolean;
  readonly conflictingMimirConfigExists: boolean;
}): void {
  validateStageReceipt(args.receipt);
  if (!isClassicActivationStep(args.receipt.stepId) && args.receipt.stepId !== "composite:activate" ||
    args.receipt.draftHash !== args.expectedDraftHash ||
    !args.creatorMatches || !args.assetMatches || !args.atomDisabled || !args.collectionMatches ||
    !args.pointerLockedAndMatches || !args.coreOwnerVerified || args.conflictingMimirConfigExists) {
    betaError("RECONCILIATION_CONFLICT", "orphan identity binding mismatch");
  }
}
