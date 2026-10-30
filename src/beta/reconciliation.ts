import { MIMIR_FUSED_CLASSIC_TAG, decodeMimirClassicExecutionAccount, decodeMimirClassicPublicationProof, deriveMimirClassicExecutionAddress,
  mimirClassicExecutionImmutableBytes } from "./classicExecution.js";
import { deriveMimirCompositeExecutionAddress, mimirCompositeExecutionImmutableBytes } from "./compositeExecution.js";
import type { Address } from "@solana/kit";
import bs58 from "bs58";
import { Key } from "@metaplex-foundation/mpl-core";
import {
  bytesEqual,
  addressBytes,
  bytesAddress,
  canonicalJson,
  domainHash,
  fromBase64,
  fromHex,
  hex,
  isZeroBytes,
  sha256,
} from "./bytes.js";
import { getCompiledTransactionMessageDecoder } from "@solana/transaction-messages";
import { getTransactionDecoder, getTransactionEncoder } from "@solana/transactions";
import { decodeMimirClassicConfig, decodeMimirCompositeConfig, decodeMimirTickerClaim } from "./codecs.js";
import { decodeFeedSnapshotHeader, decodeFeedTwapStateHeader, decodeLifecycleFeedSnapshotSentinel,
  decodeMimirBrowserCompositeSnapshotHeader, decodeMimirBrowserSourceRingV1 } from "../internal/nativeMonoRefreshCore.js";
import { computeMimirBetaCompositeComponentSetHash, deriveMimirBetaCompositeFeedId, deriveMimirBetaFeedPdas, deriveMimirBetaPda,
  deriveMimirBetaTickerPda, decodeMimirBetaTicker } from "./abi.js";
import { decodeV1ClassicFeed, decodeV1CompositeFeed } from "../v1/decoders.js";
import { decodeMimirBetaSplMint, decodeMimirBetaSplTokenAccount } from "./context.js";
import { assertMimirBetaCompositeFeeVaultBinding } from "./revenue.js";
import { betaError, MimirBetaExpiryFinalizingError } from "./errors.js";
import { sealMimirBetaExpiredObservation } from "../internal/expiredObservationSeal.js";
import { decodeMimirOneCharAllowance, deriveMimirOneCharAllowancePda } from "./oneChar.js";
import { decodeMimir8004AgentAccount, decodeMimir8004DisplayNameMetadata } from "./identity8004.js";
import {
  authenticateMimirBetaReviewedStep,
  type MimirBetaAccountPostcondition,
  type MimirBetaExpectedWrite,
  type MimirBetaPreparedStep,
  type MimirBetaProvenObservation,
  type MimirBetaConfirmedObservation,
  type MimirBetaReconciliationCodec,
  type MimirBetaReviewedStepLineage,
  type MimirBetaOneCharTransitionEvidence,
  type MimirBetaSampledTransitionEvidence,
  type MimirBetaStageReceipt,
  isV1CreationReview,
} from "./review.js";
import { applyMimirSampledObservation, decodeMimirSampledTemporalModule, encodeMimirSampledTemporalModule,
  mimirSampledClosureFromRing } from "../internal/sampledTemporalCore.js";
import { applyMimirCurrentPointObservation, decodeMimirCurrentPointModule, decodeMimirCurrentPointSource7Snapshot,
  encodeMimirCurrentPointModule, MIMIR_CURRENT_POINT_SNAPSHOT_SOURCE_KIND } from "../internal/currentPointCore.js";
import {
  decodeMimirBetaReceiptTransactionResponse,
  decodeMimirBetaBlockhashValidityResponse,
  decodeMimirBetaSignatureStatusResponse,
  FinalizedRpcReader,
  type MimirBetaReconciliationRpc,
} from "./rpc.js";
import { assertMimirBetaReviewedMessageV1, isMimirBetaWalletRewriteV1, mimirBetaReviewedMessageOfWalletV1,
  mimirBetaReviewedToWalletInstructionIndexesV1, mimirBetaReviewWalletGuardAccountsV1, validMimirBetaWalletConfigV1 } from "./transactionV1.js";
import type {
  MimirBetaAccount,
  MimirBetaAccountFingerprint,
  MimirBetaCompiledInnerInstruction,
  MimirBetaContext,
  MimirBetaFinalizedTransactionEvidence,
  MimirBetaTokenBalanceEvidence,
  MimirBetaWriteEvidence,
} from "./types.js";

type ParsedInstruction = Readonly<{
  programIdIndex: number;
  accountIndexes: readonly number[];
  data: Uint8Array;
}>;

interface ParsedV1Transaction {
  readonly signatures: readonly string[];
  readonly messageBytes: Uint8Array;
  readonly requiredSignatureCount: number;
  readonly readonlySignedCount: number;
  readonly readonlyUnsignedCount: number;
  readonly staticAccountKeys: readonly Address[];
  readonly instructions: readonly ParsedInstruction[];
}

function malformed(message: string): never {
  return betaError("TRANSACTION_MALFORMED", message);
}

function conflict(message: string, address?: Address): never {
  return betaError("RECONCILIATION_CONFLICT", message, address);
}

type NativeTrioCodec = Extract<MimirBetaReconciliationCodec,
  "native-mono-source-ring-v1" | "native-mono-feed-twap-v0" | "native-mono-feed-snapshot-v0">;
type NativeTrioWrite = { readonly codec: MimirBetaReconciliationCodec | undefined; readonly address: Address;
  readonly account: MimirBetaAccount | null };

function decodeNativeRing(address: Address, data: Uint8Array, contextSlot: bigint) {
  if (data.length !== 544) conflict("native source ring codec length invalid", address);
  const ring = decodeMimirBrowserSourceRingV1(data);
  if (ring.status !== 0 || ring.observationKind !== 0 || ![1, 2, 3].includes(ring.adapterType) || ring.windowFlags !== 3 ||
      ring.completedEndSlot === 0n || ring.completedEndSlot !== ring.newestSlot || ring.completedEndSlot > contextSlot ||
      ring.completedActivitySlot !== 0n || ring.completedPriceX64 === 0n || ring.completedMinDepthTo50BpsNative === 0n ||
      ring.completedMinLiquidityNative === 0n || ring.completedMinEconLossFloorNative === 0n ||
      ring.completedMinCapitalRequiredFloorNative === 0n) conflict("native source ring is not finalized and ready", address);
  return ring;
}

function decodeNativeTwap(address: Address, data: Uint8Array, contextSlot: bigint) {
  if (data.length !== 640) conflict("native TWAP codec length invalid", address);
  const twap = decodeFeedTwapStateHeader(data);
  if (twap.status !== 0 || twap.revision === 0n || twap.coverageRatioBps !== 10_000 || twap.sourceTableCount !== 1 ||
      twap.sourceActivitySlotMin > contextSlot || twap.shortEndSlot > contextSlot || twap.mediumEndSlot > contextSlot ||
      twap.longEndSlot > contextSlot || twap.attackerSetWeightBps !== 10_000 || twap.attackerSetSourceCount !== 1 ||
      twap.effectiveSourceCount !== 1 || (twap.sourceMask & (twap.sourceMask - 1n)) !== 0n) {
    conflict("native TWAP is not finalized single-source state", address);
  }
  return twap;
}

function nativePriceMantissa(priceX64: bigint, exponent: number, address: Address): bigint {
  if (priceX64 === 0n || !Number.isInteger(exponent) || exponent < -36 || exponent > 36) {
    conflict("native snapshot price/exponent is invalid", address);
  }
  const scale = 10n ** BigInt(Math.abs(exponent));
  const mantissa = exponent < 0 ? priceX64 * scale / (1n << 64n) : (priceX64 / (1n << 64n)) / scale;
  if (mantissa === 0n || mantissa > (1n << 64n) - 1n) conflict("native snapshot price mantissa is out of range", address);
  return mantissa;
}

function decodeNativeSnapshot(address: Address, data: Uint8Array, transactionSlot: bigint, contextSlot: bigint) {
  if (data.length !== 512) conflict("native snapshot codec length invalid", address);
  const snapshot = decodeFeedSnapshotHeader(data);
  if (snapshot.status !== 0 || snapshot.snapshotSource !== 2 || snapshot.snapshotRevision === 0n ||
      snapshot.snapshotSlot < transactionSlot || snapshot.snapshotSlot > contextSlot || snapshot.validUntilSlot < snapshot.snapshotSlot ||
      snapshot.sourceCount !== 1 || snapshot.venueCount !== 1 || snapshot.correlationGroupCount !== 1 ||
      snapshot.coverageRatioBps !== 10_000 || snapshot.priceX64 === 0n || snapshot.priceLowerX64 === 0n ||
      snapshot.priceLowerX64 > snapshot.priceX64 || snapshot.priceX64 > snapshot.priceUpperX64 ||
      snapshot.priceMantissa !== nativePriceMantissa(snapshot.priceX64, snapshot.priceExponent, address)) {
    conflict("native snapshot is not finalized Deep state", address);
  }
  return snapshot;
}

function decodeNativeAccount<T>(codec: NativeTrioCodec, address: Address, account: MimirBetaAccount,
  decode: () => T): T {
  if (account.address !== address || account.executable) conflict("native account identity/executable state is invalid", address);
  try { return decode(); }
  catch (error) {
    if (error instanceof Error && error.name === "MimirBetaError") throw error;
    return conflict(`SDK codec rejected ${codec} account`, address);
  }
}

/** Checks only the native refresh accounts already bound by the reviewed write set. */
export async function assertMimirBetaNativeRefreshTrios(args: {
  readonly writes: readonly NativeTrioWrite[];
  readonly programId: Address;
  readonly transactionSlot: bigint;
  readonly accountContextSlot: bigint;
}): Promise<void> {
  const native = args.writes.filter((write): write is NativeTrioWrite & { codec: NativeTrioCodec } =>
    write.codec === "native-mono-source-ring-v1" || write.codec === "native-mono-feed-twap-v0" ||
    write.codec === "native-mono-feed-snapshot-v0");
  if (native.length === 0) return;
  if (args.accountContextSlot < args.transactionSlot) conflict("native account context precedes transaction");
  const cohorts = new Map<string, Partial<Record<NativeTrioCodec, { address: Address; account: MimirBetaAccount;
    decoded: ReturnType<typeof decodeNativeRing> | ReturnType<typeof decodeNativeTwap> | ReturnType<typeof decodeNativeSnapshot> }>>>();
  for (const write of native) {
    const { account, address, codec } = write;
    if (!account || account.owner !== args.programId || account.lamports < 0n) conflict("native reviewed account is missing or has wrong owner", address);
    const decoded = codec === "native-mono-source-ring-v1"
      ? decodeNativeAccount(codec, address, account, () => decodeNativeRing(address, account.data, args.accountContextSlot))
      : codec === "native-mono-feed-twap-v0"
        ? decodeNativeAccount(codec, address, account, () => decodeNativeTwap(address, account.data, args.accountContextSlot))
        : decodeNativeAccount(codec, address, account, () => decodeNativeSnapshot(address, account.data,
          args.transactionSlot, args.accountContextSlot));
    const feedId = decoded.feedId;
    const key = hex(feedId);
    const cohort = cohorts.get(key) ?? {};
    if (cohort[codec]) conflict("duplicate native refresh account in feed trio", address);
    cohort[codec] = { address, account, decoded };
    cohorts.set(key, cohort);
  }
  for (const [feedKey, cohort] of cohorts) {
    const ringEntry = cohort["native-mono-source-ring-v1"];
    const twapEntry = cohort["native-mono-feed-twap-v0"];
    const snapshotEntry = cohort["native-mono-feed-snapshot-v0"];
    if (!ringEntry || !twapEntry || !snapshotEntry) conflict("native refresh feed trio is incomplete");
    const ring = ringEntry.decoded as ReturnType<typeof decodeNativeRing>;
    const twap = twapEntry.decoded as ReturnType<typeof decodeNativeTwap>;
    const snapshot = snapshotEntry.decoded as ReturnType<typeof decodeNativeSnapshot>;
    if (new Set([ringEntry.address, twapEntry.address, snapshotEntry.address]).size !== 3 ||
        !bytesEqual(ring.feedId, twap.feedId) || !bytesEqual(ring.feedId, snapshot.feedId) || hex(ring.feedId) !== feedKey ||
        !bytesEqual(ring.selectedPlanHash, twap.selectedPlanHash) || !bytesEqual(ring.selectedPlanHash, snapshot.sourcingPlanHash) ||
        ring.sourceSetRevision !== twap.sourceSetRevision) conflict("native refresh feed/plan/source-set identity is incoherent", ringEntry.address);
    const [ringPda] = await deriveMimirBetaPda({ programId: args.programId, seed: "source_ring",
      values: [ring.feedId, Uint8Array.of(ring.sourceIndex), Uint8Array.of(1, 0)] });
    const feedPdas = await deriveMimirBetaFeedPdas({ programId: args.programId, feedId: bytesAddress(ring.feedId) });
    if (ringEntry.address !== ringPda || twapEntry.address !== feedPdas.twap[0] || snapshotEntry.address !== feedPdas.snapshot[0]) {
      conflict("native refresh accounts are not the reviewed feed PDAs", ringEntry.address);
    }
    const mask = 1n << BigInt(ring.sourceIndex);
    const sourceCap = twap.sourceCapEntries[0];
    const manipulationFloor = ring.completedMinDepthTo50BpsNative < ring.completedMinLiquidityNative
      ? ring.completedMinDepthTo50BpsNative : ring.completedMinLiquidityNative;
    const safetyFactor = snapshot.riskTier === 3 ? 6 : snapshot.riskTier === 2 ? 8 : snapshot.riskTier === 1 ? 10 : 0;
    const bandCapitalNotional = ring.completedMinCapitalRequiredFloorNative * 10_000n /
      BigInt(snapshot.econLossBandBps) / BigInt(snapshot.capTierSafetyFactor);
    if (twap.sourceMask !== mask || twap.attackerSourceMask !== mask || twap.shortEndSlot !== ring.completedEndSlot ||
        twap.mediumEndSlot !== ring.completedEndSlot || twap.longEndSlot !== ring.completedEndSlot ||
        twap.twapShortX64 !== ring.completedPriceX64 || twap.twapMediumX64 !== ring.completedPriceX64 ||
        twap.twapLongX64 !== ring.completedPriceX64 || twap.sanityMinDepthTo50BpsWindow !== ring.completedMinDepthTo50BpsNative ||
        twap.sanityFeeLossFloorWindow !== manipulationFloor || twap.sourceActivitySlotMin !== ring.completedEndSlot ||
        twap.attackerSetEconLossFloorWindowNative !== ring.completedMinEconLossFloorNative ||
        twap.attackerSetCapitalRequiredFloorWindowNative !== ring.completedMinCapitalRequiredFloorNative ||
        twap.capModelFlags !== ring.completedCapModelFlags || twap.sourceTableCount !== 1 ||
        sourceCap?.sourceIndex !== ring.sourceIndex || sourceCap.flags !== ((ring.completedCapModelFlags & 0xff) | 1) ||
        sourceCap.weightBps !== 10_000 || sourceCap.routeCorrelationGroup !== ring.routeCorrelationGroup ||
        sourceCap.econLossFloorNative !== ring.completedMinEconLossFloorNative ||
        sourceCap.capitalRequiredFloorNative !== ring.completedMinCapitalRequiredFloorNative ||
        sourceCap.sourceSetRevision !== ring.sourceSetRevision || snapshot.sourceMask !== mask ||
        snapshot.attackerSourceMask !== mask || snapshot.priceX64 !== ring.completedPriceX64 ||
        snapshot.twapShortEndSlot !== ring.completedEndSlot || snapshot.twapMediumEndSlot !== ring.completedEndSlot ||
        snapshot.twapLongEndSlot !== ring.completedEndSlot || snapshot.oldestSourceActivitySlot !== ring.completedEndSlot ||
        snapshot.attackerSetFeeLossFloorMirror !== ring.completedMinEconLossFloorNative || snapshot.bandCapitalNotional !== bandCapitalNotional ||
        snapshot.capModelFlags !== twap.capModelFlags || safetyFactor === 0 || snapshot.capTierSafetyFactor !== safetyFactor ||
        snapshot.freshnessProfile !== twap.freshnessProfile || snapshot.confidenceBps !== twap.maxConfidenceBps ||
        snapshot.dispersionBps !== twap.maxDispersionBps || snapshot.attackerSetWeightBps !== twap.attackerSetWeightBps ||
        snapshot.attackerSetSourceCount !== twap.attackerSetSourceCount || snapshot.effectiveSourceCount !== twap.effectiveSourceCount ||
        snapshot.attackerSetEconLossFloorNative !== ring.completedMinEconLossFloorNative ||
        snapshot.attackerSetCapitalRequiredFloorNative !== ring.completedMinCapitalRequiredFloorNative) {
      conflict("native ring/TWAP/snapshot relation is incoherent", ringEntry.address);
    }
  }
}

function parseRawV1Transaction(bytes: Uint8Array): ParsedV1Transaction {
  if (!(bytes instanceof Uint8Array) || bytes[0] !== 0x81 || bytes.length > 4096) malformed("transaction is not strict Transaction v1 bytes");
  let transaction;
  try { transaction = getTransactionDecoder().decode(bytes); }
  catch { return malformed("Transaction v1 bytes are malformed"); }
  if (!bytesEqual(new Uint8Array(getTransactionEncoder().encode(transaction)), bytes)) malformed("Transaction v1 bytes are non-canonical");
  const messageBytes = new Uint8Array(transaction.messageBytes);
  const message = getCompiledTransactionMessageDecoder().decode(messageBytes);
  if (message.version !== 1 || !validMimirBetaWalletConfigV1(message.configMask, message.configValues) ||
    message.numStaticAccounts > 64 || message.numInstructions > 64 || message.header.numSignerAccounts < 1 ||
    message.header.numSignerAccounts > 12 || bytes.length !== messageBytes.length + message.header.numSignerAccounts * 64) {
    malformed("Transaction v1 config/count envelope is invalid");
  }
  const signatures = message.staticAccounts.slice(0, message.header.numSignerAccounts).map((signer) => {
    const signature = transaction.signatures[signer];
    if (!signature) return malformed("Transaction v1 signature is missing");
    return bs58.encode(new Uint8Array(signature));
  });
  const instructions = message.instructionHeaders.map((header, index): ParsedInstruction => ({
    programIdIndex: header.programAccountIndex,
    accountIndexes: message.instructionPayloads[index]!.instructionAccountIndices,
    data: new Uint8Array(message.instructionPayloads[index]!.instructionData),
  }));
  return {
    signatures,
    messageBytes,
    requiredSignatureCount: message.header.numSignerAccounts,
    readonlySignedCount: message.header.numReadonlySignerAccounts,
    readonlyUnsignedCount: message.header.numReadonlyNonSignerAccounts,
    staticAccountKeys: message.staticAccounts,
    instructions,
  };
}

function sameAddresses(left: readonly Address[], right: readonly Address[]): boolean {
  return left.length === right.length && left.every((address, index) => address === right[index]);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolvedWritable(parsed: ParsedV1Transaction, index: number): boolean {
  if (index < parsed.staticAccountKeys.length) {
    if (index < parsed.requiredSignatureCount) return index < parsed.requiredSignatureCount - parsed.readonlySignedCount;
    return index < parsed.staticAccountKeys.length - parsed.readonlyUnsignedCount;
  }
  return false;
}

function assertFinalizedMessageEnvelope(
  parsed: ParsedV1Transaction,
  reviewedStep: MimirBetaReviewedStepLineage,
  transaction: MimirBetaFinalizedTransactionEvidence,
): readonly Address[] {
  const loaded = transaction.meta.loadedAddresses;
  if (loaded.writable.length !== 0 || loaded.readonly.length !== 0) conflict("Transaction v1 cannot resolve loaded addresses");
  assertMimirBetaReviewedMessageV1(parsed.messageBytes, reviewedStep, "RECONCILIATION_CONFLICT");
  const resolved = [...parsed.staticAccountKeys];
  if (!sameAddresses(resolved, transaction.resolvedAccountKeys) || new Set(resolved).size !== resolved.length) {
    conflict("resolved message account vector is inconsistent or duplicated");
  }
  if (transaction.meta.preBalances.length !== resolved.length || transaction.meta.postBalances.length !== resolved.length) {
    conflict("balance vectors do not cover resolved message accounts");
  }
  return resolved;
}

export async function fingerprintMimirBetaAccount(account: MimirBetaAccount | null): Promise<MimirBetaAccountFingerprint> {
  return account === null ? {
    exists: false,
    owner: null,
    executable: null,
    lamports: 0n,
    dataLength: null,
    dataSha256: null,
  } : {
    exists: true,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: account.data.length,
    dataSha256: hex(await sha256(account.data)),
  };
}

function fingerprintShape(fingerprint: MimirBetaAccountFingerprint): boolean {
  return fingerprint.exists
    ? fingerprint.owner !== null && fingerprint.executable !== null && fingerprint.lamports >= 0n &&
      fingerprint.dataLength !== null && fingerprint.dataLength >= 0 && fingerprint.dataSha256 !== null && /^[0-9a-f]{64}$/.test(fingerprint.dataSha256)
    : fingerprint.owner === null && fingerprint.executable === null && fingerprint.lamports === 0n &&
      fingerprint.dataLength === null && fingerprint.dataSha256 === null;
}

function proofAddresses(writes: readonly MimirBetaExpectedWrite[]): readonly Address[] {
  const addresses: Address[] = [];
  const add = (address: Address) => { if (!addresses.includes(address)) addresses.push(address); };
  const identities = new Set<string>();
  const burnIdentities = new Set<string>();
  const burnIndexes = new Set<number>();
  const accountProofs = new Set<Address>();
  const lamportProofs = new Set<Address>();
  for (const write of writes) {
    const proof = write.proof;
    if (proof.kind !== "spl-token-burn-checked") {
      const identity = `${proof.kind}:${write.address}`;
      if (identities.has(identity)) betaError("PROGRAM_ABI_MISMATCH", "duplicate expected proof identity", write.address);
      identities.add(identity);
    }
    if (proof.kind === "account") {
      if (lamportProofs.has(write.address)) betaError("PROGRAM_ABI_MISMATCH", "account and lamport proofs conflict", write.address);
      if (proof.transition !== write.effect || !fingerprintShape(proof.before) ||
        (proof.transition === "create" && proof.before.exists) || (proof.transition !== "create" && !proof.before.exists)) {
        betaError("PROGRAM_ABI_MISMATCH", "account transition baseline is incoherent", write.address);
      }
      if ((proof.transition === "close") !== !proof.after.exists) betaError("PROGRAM_ABI_MISMATCH", "account transition postcondition is incoherent", write.address);
      if (proof.after.exists ? typeof proof.after.lamports !== "bigint" || proof.after.lamports < 0n : proof.after.lamports !== 0n) {
        betaError("PROGRAM_ABI_MISMATCH", "account postcondition lamports are incoherent", write.address);
      }
      if (proof.after.exists && (write.ownerAfter !== proof.after.owner ||
        write.dataLengthAfter !== null && write.dataLengthAfter !== proof.after.data.length) ||
        !proof.after.exists && (write.ownerAfter !== null || write.dataLengthAfter !== null || write.discriminatorHex !== null)) {
        betaError("PROGRAM_ABI_MISMATCH", "display account transition differs from mandatory proof", write.address);
      }
      accountProofs.add(write.address);
      add(write.address);
    } else if (proof.kind === "lamports") {
      if (accountProofs.has(write.address)) betaError("PROGRAM_ABI_MISMATCH", "account and lamport proofs conflict", write.address);
      if (write.effect !== "lamports" || write.ownerAfter !== null || write.dataLengthAfter !== null || write.discriminatorHex !== null ||
        typeof proof.programDeltaLamports !== "bigint" || proof.programDeltaLamports === 0n) {
        betaError("PROGRAM_ABI_MISMATCH", "lamport proof is incoherent", write.address);
      }
      lamportProofs.add(write.address);
      add(write.address);
    } else if (proof.kind === "caller-prefix") {
      if (accountProofs.has(write.address) || lamportProofs.has(write.address) || write.effect !== "caller-prefix" || write.ownerAfter !== null ||
        write.dataLengthAfter !== null || write.discriminatorHex !== null || !fingerprintShape(proof.before) || typeof proof.simulatedLamportDelta !== "bigint") {
        betaError("PROGRAM_ABI_MISMATCH", "caller-prefix proof is incoherent", write.address);
      }
      add(write.address);
    } else {
      if (write.effect !== "token-burn" || write.address !== proof.sourceTokenAccount || proof.amountRaw < 0n ||
        proof.decimals < 0 || proof.decimals > 255 || !Number.isInteger(proof.outerInstructionIndex)) {
        betaError("PROGRAM_ABI_MISMATCH", "BurnChecked proof is incoherent", write.address);
      }
      const identity = canonicalJson(proof as never);
      if (burnIdentities.has(identity) || burnIndexes.has(proof.outerInstructionIndex)) {
        betaError("PROGRAM_ABI_MISMATCH", "duplicate BurnChecked proof identity or outer index", write.address);
      }
      burnIdentities.add(identity); burnIndexes.add(proof.outerInstructionIndex);
      add(proof.sourceTokenAccount);
      add(proof.mint);
    }
  }
  return addresses;
}

function successReadAddresses(addresses: readonly Address[], reviewedStep: MimirBetaReviewedStepLineage): readonly Address[] {
  const { review } = reviewedStep;
  return review.kind === "composite" && !addresses.includes(review.feed) && reviewedProgramInstructions(reviewedStep)
    .some(({ keys, data }) => data[0] === 87 && keys.includes(review.feed)) ? [...addresses, review.feed] : addresses;
}

function assertPostAccountOrder(addresses: readonly Address[], post: MimirBetaContext<readonly (MimirBetaAccount | null)[]>, slot: bigint): void {
  if (post.slot < slot || post.value.length !== addresses.length || !post.addresses || !sameAddresses(post.addresses, addresses)) {
    conflict("post-account context is regressed, incomplete, or not address-bound");
  }
  post.value.forEach((account, index) => {
    if (account !== null && account.address !== addresses[index]) conflict("post-account order differs from proof-address order", account.address);
  });
}

export async function createMimirBetaReconciliationSemanticHash(args: {
  readonly codec: MimirBetaReconciliationCodec;
  readonly address: Address;
  readonly account: MimirBetaAccount;
  readonly transactionSlot: bigint;
  readonly accountContextSlot?: bigint;
  readonly blockTime: bigint | null;
  readonly sampledTransition?: MimirBetaSampledTransitionEvidence;
  readonly sampledRing?: MimirBetaAccount | null;
  readonly oneCharTransition?: MimirBetaOneCharTransitionEvidence;
  /** Post-state of the same transaction; the DUAL snapshot codec reads the classic execution proof from it. */
  readonly accounts?: ReadonlyMap<Address, MimirBetaAccount | null>;
}): Promise<string> {
  const { codec, address, account } = args;
  const accountContextSlot = args.accountContextSlot ?? args.transactionSlot;
  if (accountContextSlot < args.transactionSlot) conflict("account context precedes finalized transaction", address);
  let semanticData = account.data;
  let runtimeContract: Readonly<Record<string, bigint>> | null = null;
  try {
    if (codec === "identity-agent-v1") decodeMimir8004AgentAccount(account.data);
    else if (codec === "identity-display-name-v1") decodeMimir8004DisplayNameMetadata(account.data);
    else if (codec === "classic-feed-v1") {
      const decoded = decodeMimirClassicConfig(account.data);
      if (decoded.version !== 1) conflict("classic codec requires V1", address);
    } else if (codec === "composite-feed-v1") {
      const decoded = decodeMimirCompositeConfig(account.data);
      if (decoded.version !== 1) conflict("composite codec requires V1", address);
    } else if (codec === "feed-plan-proposal-v1") {
      if (account.data.length < 608 || (account.data.length - 608) % 392 !== 0 || account.data.length > 608 + 5 * 392 ||
        new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength).getUint16(8, true) !== 1 ||
        new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength).getUint16(10, true) !== 608) conflict("proposal codec tuple invalid", address);
      const view = new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength);
      if (view.getBigUint64(408, true) !== args.transactionSlot ||
        args.blockTime !== null && view.getBigInt64(416, true) !== args.blockTime) conflict("proposal runtime fields differ from finalized transaction context", address);
      semanticData = Uint8Array.from(account.data);
      semanticData.fill(0, 408, 424);
    } else if (codec === "source-config-v0") {
      if (account.data.length !== 384) conflict("source config codec tuple invalid", address);
    } else if (codec === "native-mono-source-ring-v1") {
      const ring = decodeNativeAccount(codec, address, account,
        () => decodeNativeRing(address, account.data, accountContextSlot));
      semanticData = Uint8Array.from(account.data);
      semanticData.fill(0, 64, 104); semanticData.fill(0, 112, 168); semanticData.fill(0, 184, 216);
      semanticData.fill(0, 320, 352); semanticData.fill(0, 384, 544);
    } else if (codec === "native-mono-feed-twap-v0") {
      decodeNativeAccount(codec, address, account, () => decodeNativeTwap(address, account.data, accountContextSlot));
      semanticData = Uint8Array.from(account.data);
      semanticData.fill(0, 56, 128); semanticData.fill(0, 136, 144); semanticData.fill(0, 160, 192);
      semanticData.fill(0, 320, 352); semanticData.fill(0, 392, 424);
    } else if (codec === "native-mono-feed-snapshot-v0") {
      decodeNativeAccount(codec, address, account, () => decodeNativeSnapshot(address, account.data,
        args.transactionSlot, accountContextSlot));
      semanticData = Uint8Array.from(account.data);
      semanticData.fill(0, 116, 196); semanticData.fill(0, 200, 248); semanticData.fill(0, 302, 334);
      semanticData.fill(0, 440, 472);
    } else if (codec === "source-ring-v1") {
      const ring = decodeMimirBrowserSourceRingV1(account.data);
      if (ring.observationKind !== 0 || ring.sampleCount !== 1 || ring.windowFlags !== 1 || ring.lastActivitySlot !== 0n ||
        ring.completedActivitySlot !== 0n || ring.completedEndSlot === 0n || ring.completedEndSlot > accountContextSlot ||
        ring.completedPriceX64 === 0n || ring.completedMinDepthTo50BpsNative === 0n ||
        ring.completedMinLiquidityNative === 0n ||
        (ring.completedMinEconLossFloorNative === 0n) !== (ring.pointOnly === true) ||
        (ring.completedMinCapitalRequiredFloorNative === 0n) !== (ring.pointOnly === true)) conflict("source ring is not finalized Atomic-Lite SPOT input", address);
      semanticData = Uint8Array.from(account.data);
      semanticData.fill(0, 64, 168); semanticData.fill(0, 184, 216); semanticData.fill(0, 320, 362); semanticData.fill(0, 366, 544);
      semanticData.fill(0, 544, account.data.length);
    } else if (codec === "bounded-source-ring-v1") {
      const ring = decodeMimirBrowserSourceRingV1(account.data);
      if (ring.completedEndSlot === 0n || ring.completedEndSlot > accountContextSlot || ring.completedPriceX64 === 0n) {
        conflict("source ring is not a completed bounded input", address);
      }
      semanticData = Uint8Array.from(account.data);
      semanticData.fill(0, 64, 168); semanticData.fill(0, 184, 216); semanticData.fill(0, 320, 362); semanticData.fill(0, 366, 544);
      semanticData.fill(0, 544, account.data.length);
    } else if (codec === "bounded-feed-snapshot-v5" || codec === "dual-feed-snapshot-v5") {
      const snapshot = decodeFeedSnapshotHeader(account.data);
      const point = codec === "dual-feed-snapshot-v5" && snapshot.snapshotSource === MIMIR_CURRENT_POINT_SNAPSHOT_SOURCE_KIND;
      if (point) try { decodeMimirCurrentPointSource7Snapshot(account.data); } catch { conflict("snapshot is not a DUAL current-point source-7 publication", address); }
      if (codec === "dual-feed-snapshot-v5") {
        const [execution] = await deriveMimirClassicExecutionAddress(account.owner, snapshot.feedId);
        const data = args.accounts?.get(execution)?.data;
        let proof: ReturnType<typeof decodeMimirClassicPublicationProof> = null;
        try { if (data && data.length >= 384) proof = decodeMimirClassicPublicationProof(data.subarray(128, 384)); } catch { /* conflict below */ }
        if (!proof?.dual || proof.dual.effectiveMode !== (point ? "CURRENT_POINT" : "NATIVE") ||
          proof.snapshotRevision !== snapshot.snapshotRevision || proof.publicationSlot !== snapshot.snapshotSlot) {
          conflict("DUAL snapshot is not bound to a proof v2 decision of the same branch", address);
        }
      }
      if (snapshot.status !== 0 || snapshot.snapshotSource !== (point ? 7 : 5) || !point && snapshot.quoteStatus !== 0 || snapshot.snapshotRevision === 0n ||
        snapshot.snapshotSlot < args.transactionSlot || snapshot.snapshotSlot > accountContextSlot ||
        snapshot.validUntilSlot < snapshot.snapshotSlot || snapshot.priceX64 === 0n || snapshot.priceLowerX64 === 0n ||
        snapshot.priceUpperX64 === 0n || snapshot.sourceCount < 1 || snapshot.sourceCount > 5 || snapshot.sourceMask === 0n) {
        conflict("snapshot is not a finalized source-5 bounded publication", address);
      }
      semanticData = Uint8Array.from(account.data);
      semanticData.fill(0, 116, 196); semanticData.fill(0, 200, 252); semanticData.fill(0, 302, 334);
      semanticData.fill(0, 422, 472);
    } else if (codec === "feed-snapshot-v0") {
      const snapshot = decodeFeedSnapshotHeader(account.data);
      if (snapshot.snapshotSource === MIMIR_CURRENT_POINT_SNAPSHOT_SOURCE_KIND) {
        try { decodeMimirCurrentPointSource7Snapshot(account.data); } catch { conflict("snapshot is not a current-point source-7 row", address); }
        if (snapshot.status !== 0 || snapshot.snapshotRevision === 0n || snapshot.snapshotSlot !== args.transactionSlot ||
          snapshot.snapshotSlot > accountContextSlot || snapshot.validUntilSlot < snapshot.snapshotSlot || snapshot.twapShortEndSlot !== 0n ||
          snapshot.twapMediumEndSlot !== 0n || snapshot.twapLongEndSlot !== 0n || snapshot.sourceCount < 1 || snapshot.sourceCount > 5 ||
          snapshot.sourceMask === 0n) conflict("snapshot is not finalized current-point state", address);
      } else if (snapshot.status !== 0 || snapshot.snapshotSource !== 1 || snapshot.quoteStatus !== 0 || snapshot.snapshotRevision === 0n ||
        snapshot.snapshotSlot < args.transactionSlot || snapshot.snapshotSlot > accountContextSlot ||
        snapshot.validUntilSlot < snapshot.snapshotSlot || snapshot.spotSlot === 0n ||
        snapshot.spotSlot > snapshot.snapshotSlot || snapshot.oldestSourceObservedSlot !== snapshot.spotSlot ||
        snapshot.oldestSourceActivitySlot !== 0n || snapshot.twapShortEndSlot !== 0n || snapshot.twapMediumEndSlot !== 0n ||
        snapshot.twapLongEndSlot !== 0n || snapshot.priceX64 === 0n || snapshot.priceLowerX64 === 0n ||
        snapshot.priceUpperX64 === 0n || snapshot.sourceCount < 1 || snapshot.sourceCount > 5 ||
        snapshot.coverageRatioBps !== 10_000 || snapshot.sourceMask === 0n) conflict("snapshot is not finalized Atomic-Lite state", address);
      semanticData = Uint8Array.from(account.data);
      semanticData.fill(0, 116, 196); semanticData.fill(0, 200, 252); semanticData.fill(0, 302, 334);
      semanticData.fill(0, 422, 472);
    } else if (codec === "feed-twap-sentinel-v0") {
      if (account.data.length !== 640) conflict("TWAP sentinel codec tuple invalid", address);
    } else if (codec === "composite-execution-v1") {
      let immutable: Uint8Array;
      try { immutable = mimirCompositeExecutionImmutableBytes(account.data); }
      catch { return conflict("Composite execution state is not active and well formed", address); }
      const [expected] = await deriveMimirCompositeExecutionAddress(account.owner, account.data.subarray(16, 48));
      if (expected !== address) conflict("Composite execution PDA is invalid", address);
      semanticData = immutable;
    } else if (codec === "classic-execution-v1") {
      let immutable: Uint8Array;
      try {
        await decodeMimirClassicExecutionAccount({ programId: account.owner, address, owner: account.owner, data: account.data, requireActive: true });
        immutable = mimirClassicExecutionImmutableBytes(account.data);
      } catch { return conflict("Classic execution state is not active and well formed", address); }
      semanticData = immutable;
    } else if (codec === "composite-snapshot-v1") {
      const snapshot = decodeMimirBrowserCompositeSnapshotHeader(account.data);
      const [expectedConfig] = await deriveMimirBetaPda({ programId: account.owner, seed: "composite_feed_config", values: [snapshot.compositeFeedId] });
      if (!bytesEqual(snapshot.compositeConfig, addressBytes(expectedConfig))) conflict("Composite root snapshot config PDA is invalid", address);
      if (snapshot.status !== 0 || snapshot.snapshotRevision !== 1n || snapshot.configRevision !== 1n ||
          snapshot.snapshotSlot !== args.transactionSlot || snapshot.validUntilSlot < args.transactionSlot ||
          snapshot.priceX64 === 0n || snapshot.components.some((component) => component.snapshotRevision === 0n ||
            component.snapshotSlot === 0n || component.snapshotSlot > args.transactionSlot)) {
        conflict("Composite root snapshot is not finalized and ready", address);
      }
      semanticData = Uint8Array.from(account.data);
      semanticData.fill(0, 112, 160); semanticData.fill(0, 164, 248); semanticData.fill(0, 280, 312);
      for (let index = 0; index < snapshot.componentCount; index += 1) {
        const offset = 320 + index * 80; semanticData.fill(0, offset + 40, offset + 80);
      }
    } else if (codec === "mpl-core-asset-v1" || codec === "mpl-core-collection-v1") {
      if (account.data.length < 33) conflict("MPL Core codec account truncated", address);
    } else if (codec === "mimir-exact-layout-v1") {
      if (account.data.length === 160 && String.fromCharCode(...account.data.subarray(0, 8)) === "MIMIRCOL") {
        const view = new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength);
        if (view.getBigUint64(120, true) !== args.transactionSlot ||
          args.blockTime !== null && view.getBigInt64(128, true) !== args.blockTime) conflict("collateral-lock runtime fields differ from finalized transaction context", address);
        semanticData = Uint8Array.from(account.data);
        semanticData.fill(0, 120, 136);
      }
    } else if (codec === "sampled-temporal-v4") {
      const evidence = args.sampledTransition, ring = args.sampledRing;
      if (!evidence || !ring || ring.address !== evidence.ring || ring.data.length !== 544) conflict("MTP4 transition evidence is missing", address);
      const data = account.data, view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const ringView = new DataView(ring.data.buffer, ring.data.byteOffset, ring.data.byteLength);
      const u128 = (at: number) => ringView.getBigUint64(at, true) | (ringView.getBigUint64(at + 8, true) << 64n);
      const moduleSlot = data.length === 1280 ? view.getBigUint64(152, true) : 0n;
      if (data.length !== 1280 || moduleSlot !== args.transactionSlot || moduleSlot > accountContextSlot ||
        (args.blockTime !== null && view.getBigInt64(160, true) !== args.blockTime)) {
        conflict("MTP4 module is not consistent with the finalized transaction", address);
      }
      const limits = { bandLimitBps: evidence.bandLimitBps, closeLimitBps: evidence.closeLimitBps };
      const preModule = evidence.preModuleHex === null ? null : fromHex(evidence.preModuleHex);
      const preRing = evidence.preRingHex === null ? null : fromHex(evidence.preRingHex);
      if (evidence.temporalMode === "current-point") {
        const prior = preModule === null || preModule[16] !== 10 ? null : decodeMimirCurrentPointModule(preModule);
        const existingRingSlot = preRing === null ? undefined : new DataView(preRing.buffer, preRing.byteOffset, 544).getBigUint64(64, true);
        if (preModule !== null && prior === null &&
            decodeMimirSampledTemporalModule(preModule, mimirSampledClosureFromRing(preModule, preRing!), limits).close.slot !== existingRingSlot) {
          conflict("MTP4 prior sampled module does not match its ring head", address);
        }
        const replay = applyMimirCurrentPointObservation(prior, { record: { slot: moduleSlot, unixTs: view.getBigInt64(160, true),
          priceX64: u128(88), fingerprint: ring.data.slice(184, 216) }, observedDepthNative: u128(112), observedLiquidityNative: u128(128) },
        data.slice(24, 56), { sourceConfig: data.slice(64, 96), planHash: data.slice(96, 128), sourceDepthFloor: 1n, sourceMinLiquidity: 0n,
          ...(existingRingSlot === undefined ? {} : { existingRingSlot }),
          ...(preRing === null ? {} : { existingRingPriceX64: new DataView(preRing.buffer, preRing.byteOffset, 544).getBigUint64(88, true) |
            (new DataView(preRing.buffer, preRing.byteOffset, 544).getBigUint64(96, true) << 64n), existingRingFingerprint: preRing.slice(184, 216) }) });
        if (!bytesEqual(encodeMimirCurrentPointModule(replay.state), data)) conflict("MTP4 point module differs from the reviewed transition replay", address);
      } else {
      const previous = preModule === null ? null : decodeMimirSampledTemporalModule(preModule, mimirSampledClosureFromRing(preModule, preRing!), limits);
      const replay = applyMimirSampledObservation(previous, { record: { slot: moduleSlot, unixTs: view.getBigInt64(160, true),
        priceX64: u128(88), observationHash: ring.data.slice(184, 216) }, observedDepthNative: u128(112) }, data.slice(24, 56),
        { sourceConfig: data.slice(64, 96), planHash: data.slice(96, 128), ...limits, minSlotGap: BigInt(ringView.getUint16(60, true)),
          ...(preRing === null ? {} : { existingRingSlot: new DataView(preRing.buffer, preRing.byteOffset, 544).getBigUint64(64, true) }) });
      if (!bytesEqual(encodeMimirSampledTemporalModule(replay.state), data)) conflict("MTP4 module differs from the reviewed transition replay", address);
      }
      semanticData = Uint8Array.from([...data.subarray(24, 56), ...data.subarray(64, 128), ...await sha256(preModule ?? new Uint8Array()),
        ...await sha256(preRing ?? new Uint8Array()), ...addressBytes(evidence.ring), evidence.bandLimitBps & 255, evidence.bandLimitBps >> 8,
        evidence.closeLimitBps & 255, evidence.closeLimitBps >> 8]);
    } else if (codec === "ticker-claim-v1") {
      decodeMimirTickerClaim(account.data);
    } else if (codec === "one-char-allowance-v1") {
      const evidence = args.oneCharTransition;
      const decoded = decodeMimirOneCharAllowance(account.data);
      if (!evidence || !Number.isSafeInteger(evidence.consumed) || evidence.consumed < 1 ||
        decoded.revision < 1n + BigInt(evidence.consumed)) {
        conflict("one-character allowance transition evidence invalid", address);
      }
      semanticData = Uint8Array.of(decoded.bump);
      runtimeContract = { consumed: BigInt(evidence.consumed) };
    } else {
      betaError("PROGRAM_ABI_MISMATCH", "unknown reconciliation codec", address);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "MimirBetaError") throw error;
    conflict(`SDK codec rejected ${codec} account`, address);
  }
  return domainHash(`MIMIR_BETA_CODEC_${codec.toUpperCase()}\0`, canonicalJson({ address, data: semanticData, runtimeContract }));
}

async function verifyAccountPostcondition(
  address: Address,
  after: MimirBetaAccountPostcondition,
  account: MimirBetaAccount | null,
  transactionSlot: bigint,
  accountContextSlot: bigint,
  blockTime: bigint | null,
  accounts: ReadonlyMap<Address, MimirBetaAccount | null>,
  v1ProgramWrite = false,
): Promise<string> {
  if (!after.exists) {
    if (account !== null) conflict("closed account still exists", address);
    return domainHash("MIMIR_BETA_ACCOUNT_CLOSE_EVIDENCE_V1\0", canonicalJson({ address, exists: false, lamports: 0n }));
  }
  if (account === null || account.owner !== after.owner || account.executable !== after.executable) {
    conflict("account owner/executable postcondition mismatch", address);
  }
  if (account.data.length !== after.data.length) conflict("account data length postcondition mismatch", address);
  const observedHash = after.data.kind === "exact" ? hex(await sha256(account.data)) : await createMimirBetaReconciliationSemanticHash({
    codec: after.data.codec,
    address,
    account,
    transactionSlot,
    accountContextSlot,
    blockTime,
    accounts,
    ...(after.data.sampledTransition ? { sampledTransition: after.data.sampledTransition,
      sampledRing: accounts.get(after.data.sampledTransition.ring) ?? null } : {}),
  });
  const expectedHash = after.data.kind === "exact" ? after.data.sha256 : after.data.semanticHash;
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || observedHash !== expectedHash && !v1ProgramWrite) conflict("account data postcondition hash mismatch", address);
  return domainHash("MIMIR_BETA_ACCOUNT_WRITE_EVIDENCE_V1\0", canonicalJson({ address, owner: account.owner,
    executable: account.executable, lamports: after.lamports, length: account.data.length, observedHash }));
}

export type SharedAccountRole = "core-collection" | "burn-mint" | "burn-source" | "refreshable" | "one-char-allowance";

const REFRESHABLE_FEED_SEEDS: Readonly<Record<string, string>> = {
  MIMIRSNP: "feed_snapshot", MIMIRCSP: "composite_snapshot", MIMIRFEE: "feed_fee_vault" };

function accountMagic(account: MimirBetaAccount): string {
  return String.fromCharCode(...account.data.subarray(0, 8));
}

export type RefreshableRole = Readonly<{ kind: "feed" }>;

async function refreshableAccountRole(
  write: MimirBetaExpectedWrite,
  accounts: ReadonlyMap<Address, MimirBetaAccount | null>,
  programId: Address,
): Promise<RefreshableRole | null> {
  const proof = write.proof;
  if (proof.kind !== "account" || proof.transition === "close" || !proof.after.exists || proof.after.owner !== programId) return null;
  const account = accounts.get(write.address) ?? null;
  if (account === null || account.owner !== programId || account.data.length < 50) return null;
  const magic = accountMagic(account);
  const feedId = account.data.subarray(16, 48);
  const pda = async (seed: string, values: readonly Uint8Array[]) =>
    (await deriveMimirBetaPda({ programId, seed, values: [...values] }))[0] === write.address;
  const feed = { kind: "feed" } as const;
  const seed = REFRESHABLE_FEED_SEEDS[magic];
  if (seed) return await pda(seed, [feedId]) ? feed : null;
  return null;
}

type ReviewedInstruction = Readonly<{ keys: readonly Address[]; data: Uint8Array }>;

function reviewedProgramInstructions(reviewedStep: MimirBetaReviewedStepLineage): readonly ReviewedInstruction[] {
  return reviewedStep.review.instructions.filter((instruction) => instruction.programAddress === reviewedStep.review.programId)
    .map((instruction) => ({ keys: instruction.accounts.map((account) => account.address), data: fromBase64(instruction.dataBase64) }));
}

function reviewedPlanHashes(instructions: readonly ReviewedInstruction[], accounts: ReadonlyMap<Address, MimirBetaAccount | null>,
  feedId: Uint8Array): readonly Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const { keys, data } of instructions) {
    if (data[0] === MIMIR_FUSED_CLASSIC_TAG && data.length >= 104 && bytesEqual(data.subarray(1, 33), feedId)) out.push(data.subarray(60, 92));
    for (const key of keys) {
      const plan = accounts.get(key);
      if (plan && plan.data.length >= 228 && accountMagic(plan) === "MIMIRPLN" && bytesEqual(plan.data.subarray(16, 48), feedId)) {
        out.push(plan.data.subarray(196, 228));
      }
    }
  }
  return out;
}

export async function assertRefreshableIdentity(
  address: Address,
  account: MimirBetaAccount,
  role: RefreshableRole,
  accounts: ReadonlyMap<Address, MimirBetaAccount | null>,
  reviewedStep: MimirBetaReviewedStepLineage,
): Promise<void> {
  const programId = account.owner;
  const data = account.data;
  const magic = accountMagic(account);
  const all = reviewedProgramInstructions(reviewedStep);
  const own = all.filter((instruction) => instruction.keys.includes(address));
  if (own.length === 0) conflict("refreshable account is not bound by an authenticated reviewed instruction", address);
  const keys = new Set(own.flatMap((instruction) => instruction.keys));
  const derive = async (seed: string, values: readonly Uint8Array[]) => deriveMimirBetaPda({ programId, seed, values: [...values] });
  const bind = (ok: boolean, what: string) => { if (!ok) conflict(`refreshable ${what} differs from reviewed identity`, address); };
  const bindFeed = async (feedId: Uint8Array) => {
    const targets: Readonly<Record<number, readonly number[]>> = { 87: [1], [MIMIR_FUSED_CLASSIC_TAG]: [0] };
    for (const { keys: ixKeys, data: ix } of own) {
      if (targets[ix[0]!]?.some((index) => ixKeys[index] === address)) bind(bytesEqual(ix.subarray(1, 33), feedId), "feed ID");
    }
    const [feedConfig] = await derive(magic === "MIMIRCSP" ? "composite_feed_config" : "feed_config", [feedId]);
    bind(keys.has(feedConfig), "feed config");
    return feedConfig;
  };
  const bindPlan = (feedId: Uint8Array, planHash: Uint8Array) => {
    const expected = reviewedPlanHashes(all, accounts, feedId);
    bind(expected.length > 0 && expected.every((hash) => bytesEqual(hash, planHash)), "plan hash");
  };
  const reviewedComposite = async (configAddress: Address) => {
    const config = accounts.get(configAddress);
    const review = reviewedStep.review;
    if (config) {
      const decoded = decodeMimirCompositeConfig(config.data);
      const view = new DataView(config.data.buffer, config.data.byteOffset, config.data.byteLength);
      const conversion = config.data.subarray(197, 229);
      const identity = { creator: decoded.creator, quoteMint: decoded.quoteMint, priceExponent: view.getInt32(112, true),
        solConversionSourceConfig: isZeroBytes(conversion) ? undefined : bytesAddress(conversion),
        components: decoded.components.map(({ feed, sourceConfig, quantityX64 }) => ({ feedId: feed, sourceConfig, quantityX64 })) };
      const componentSetHash = config.data.subarray(128, 160);
      const [canonical, bump] = await derive("composite_feed_config", [addressBytes(decoded.feedId)]);
      if (config.owner !== programId || config.executable || decoded.version !== 1 || canonical !== configAddress || config.data[184] !== bump ||
        review.kind === "composite" && review.feed === configAddress &&
          (decoded.feedId !== review.feedId || decoded.identityAsset !== review.identityAsset) ||
        !bytesEqual(await computeMimirBetaCompositeComponentSetHash(identity), componentSetHash) ||
        await deriveMimirBetaCompositeFeedId(identity) !== decoded.feedId) conflict("Composite config differs from reviewed identity", configAddress);
      return { feedId: decoded.feedId, identityAsset: decoded.identityAsset, components: decoded.components, componentSetHash,
        configRevision: view.getBigUint64(168, true) };
    }
    if (review.kind !== "composite" || review.feed !== configAddress) return conflict("Composite config is not the reviewed config", address);
    return { feedId: review.feedId, identityAsset: review.identityAsset, components: null, componentSetHash: null, configRevision: null };
  };
  if (magic === "MIMIRSNP") {
    let feedId: Uint8Array, feedConfig: Uint8Array, planHash: Uint8Array;
    try { ({ feedId, feedConfig, sourcingPlanHash: planHash } = decodeFeedSnapshotHeader(data)); }
    catch {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      ({ feedId, feedConfig, sourcingPlanHash: planHash } = decodeLifecycleFeedSnapshotSentinel(data, { feedId: data.subarray(16, 48),
        feedConfig: data.subarray(48, 80), registryEpoch: view.getBigUint64(80, true), riskTier: data[106]!, planProfile: data[109]!,
        priceExponent: view.getInt32(196, true), sourcingPlanId: view.getUint16(258, true), sourcingPlanVersion: view.getUint16(260, true),
        sourcingPlanHash: data.subarray(262, 294), anchorPolicyHash: data.subarray(356, 388), nativeExceptionHash: data.subarray(388, 420) }));
    }
    bind(bytesEqual(feedConfig, addressBytes(await bindFeed(feedId))), "snapshot feed config");
    bindPlan(feedId, planHash);
  } else if (magic === "MIMIRFEE") {
    const configAddress = bytesAddress(data.subarray(48, 80));
    const composite = await reviewedComposite(configAddress);
    if (!keys.has(configAddress)) conflict("fee vault config is not the reviewed Composite config", address);
    assertMimirBetaCompositeFeeVaultBinding(data, composite, configAddress, await derive("feed_fee_vault", [addressBytes(composite.feedId)]));
  } else if (magic === "MIMIRCSP") {
    const snapshot = decodeMimirBrowserCompositeSnapshotHeader(data);
    const configAddress = await bindFeed(snapshot.compositeFeedId);
    const composite = await reviewedComposite(configAddress);
    const components = composite.components;
    bind(components !== null && composite.componentSetHash !== null && snapshot.configRevision === composite.configRevision &&
      bytesEqual(snapshot.compositeConfig, addressBytes(configAddress)) && composite.feedId === bytesAddress(snapshot.compositeFeedId) &&
      bytesEqual(snapshot.componentSetHash, composite.componentSetHash) && snapshot.components.length === components.length &&
      snapshot.components.every((component, index) => components[index]!.feed === bytesAddress(component.feedId)), "Composite root");
  } else {
    conflict("refreshable account role is unknown", address);
  }
}

export function sharedAccountRole(write: MimirBetaExpectedWrite, writes: readonly MimirBetaExpectedWrite[]): SharedAccountRole | null {
  const proof = write.proof;
  if (proof.kind !== "account" || proof.transition !== "write" || !proof.after.exists) return null;
  if (proof.after.data.kind === "sdk-codec" && proof.after.data.codec === "mpl-core-collection-v1") return "core-collection";
  if (proof.after.data.kind === "sdk-codec" && proof.after.data.codec === "one-char-allowance-v1") return "one-char-allowance";
  const owner = proof.after.owner;
  if (writes.some((entry) => entry.proof.kind === "spl-token-burn-checked" && entry.proof.sourceTokenAccount === write.address &&
    entry.proof.tokenProgram === owner)) return "burn-source";
  return writes.some((entry) => entry.proof.kind === "spl-token-burn-checked" && entry.proof.mint === write.address &&
    entry.proof.tokenProgram === owner) ? "burn-mint" : null;
}

export async function verifySharedAccountEffect(
  write: MimirBetaExpectedWrite,
  role: SharedAccountRole,
  writes: readonly MimirBetaExpectedWrite[],
  account: MimirBetaAccount | null,
  parsed: ParsedV1Transaction,
  transaction: MimirBetaFinalizedTransactionEvidence,
  resolved: readonly Address[],
  refreshable?: RefreshableRole,
  accounts: ReadonlyMap<Address, MimirBetaAccount | null> = new Map(),
  reviewedStep?: MimirBetaReviewedStepLineage,
): Promise<string> {
  const proof = write.proof as Extract<MimirBetaExpectedWrite["proof"], { kind: "account" }>;
  const after = proof.after as Extract<MimirBetaAccountPostcondition, { exists: true }>;
  if (account === null || account.owner !== after.owner || account.executable || account.data.length !== after.data.length ||
    role === "core-collection" && account.data[0] !== Key.CollectionV1) {
    conflict("shared account owner/layout postcondition mismatch", write.address);
  }
  if (role === "core-collection") {
    const assets = writes.filter((entry) => entry.proof.kind === "account" && entry.proof.transition === "create" &&
      entry.proof.after.exists && entry.proof.after.data.kind === "sdk-codec" && entry.proof.after.data.codec === "mpl-core-asset-v1");
    const creates = [...parsed.instructions, ...transaction.meta.innerInstructions.flatMap((group) => group.instructions)]
      .filter((instruction) => resolved[instruction.programIdIndex] === after.owner && instruction.data[0] === 20 &&
        instruction.accountIndexes.length >= 2 && resolved[instruction.accountIndexes[1]!] === write.address);
    if (assets.length === 0 || creates.length !== assets.length || assets.some((asset) =>
      creates.filter((instruction) => resolved[instruction.accountIndexes[0]!] === asset.address).length !== 1)) {
      conflict("Core asset creation into shared collection is missing or ambiguous", write.address);
    }
  } else if (role === "one-char-allowance") {
    const data = after.data as Extract<typeof after.data, { kind: "sdk-codec" }>;
    const programId = reviewedStep!.review.programId;
    const [pda, bump] = await deriveMimirOneCharAllowancePda(programId, reviewedStep!.review.authority);
    const index = resolved.indexOf(write.address);
    if (after.owner !== programId || pda !== write.address || account.data[9] !== bump || index < 0 || !resolvedWritable(parsed, index) ||
      await createMimirBetaReconciliationSemanticHash({ codec: "one-char-allowance-v1", address: write.address, account,
        transactionSlot: transaction.slot, blockTime: null, ...(data.oneCharTransition ? { oneCharTransition: data.oneCharTransition } : {}) }) !==
        data.semanticHash) {
      conflict("one-character allowance identity mismatch", write.address);
    }
    const consumed = parsed.instructions.filter((instruction) => resolved[instruction.programIdIndex] === programId &&
      instruction.accountIndexes.includes(index)).length;
    const assets = writes.filter((entry) => entry.proof.kind === "account" && entry.proof.transition === "create" &&
      entry.proof.after.exists && entry.proof.after.data.kind === "sdk-codec" && entry.proof.after.data.codec === "mpl-core-asset-v1").length;
    const burns = writes.filter((entry) => entry.proof.kind === "spl-token-burn-checked").length;
    if (consumed !== data.oneCharTransition!.consumed || consumed !== assets - burns) {
      conflict("one-character allowance consumption count mismatch", write.address);
    }
  } else if (role === "refreshable") {
    try {
      await assertRefreshableIdentity(write.address, account, refreshable!, accounts, reviewedStep!);
    } catch (error) {
      if (error instanceof Error && error.name === "MimirBetaError") throw error;
      conflict("refreshable account layout mismatch", write.address);
    }
  } else if (role === "burn-source") {
    const decoded = decodeMimirBetaSplTokenAccount(account, after.owner);
    if (writes.some((entry) => entry.proof.kind === "spl-token-burn-checked" && entry.proof.sourceTokenAccount === write.address &&
      (entry.proof.mint !== decoded.mint || entry.proof.authority !== decoded.owner))) {
      conflict("shared burn source layout mismatch", write.address);
    }
  } else {
    const burns = writes.filter((entry) => entry.proof.kind === "spl-token-burn-checked" && entry.proof.mint === write.address);
    const decoded = decodeMimirBetaSplMint(account, after.owner);
    if (burns.some((entry) => entry.proof.kind === "spl-token-burn-checked" && entry.proof.decimals !== decoded.decimals)) {
      conflict("shared burn mint layout mismatch", write.address);
    }
  }
  return domainHash("MIMIR_BETA_SHARED_ACCOUNT_EVIDENCE_V1\0", canonicalJson({ address: write.address, role, owner: account.owner,
    length: account.data.length }));
}

function tokenKey(balance: MimirBetaTokenBalanceEvidence): string {
  return `${balance.accountIndex}:${balance.mint}:${balance.owner ?? ""}:${balance.programId}:${balance.decimals}`;
}

function tokenMaps(balances: readonly MimirBetaTokenBalanceEvidence[]): Map<string, MimirBetaTokenBalanceEvidence> {
  const out = new Map<string, MimirBetaTokenBalanceEvidence>();
  for (const balance of balances) {
    const key = tokenKey(balance);
    if (out.has(key)) conflict("duplicate token balance identity");
    out.set(key, balance);
  }
  return out;
}

function innerMatchesBurn(
  instruction: MimirBetaCompiledInnerInstruction,
  proof: Extract<MimirBetaExpectedWrite["proof"], { kind: "spl-token-burn-checked" }>,
  resolved: readonly Address[],
): boolean {
  if (instruction.programIdIndex >= resolved.length || resolved[instruction.programIdIndex] !== proof.tokenProgram || instruction.accountIndexes.length !== 3 ||
    instruction.accountIndexes.some((index) => index >= resolved.length) || resolved[instruction.accountIndexes[0]!] !== proof.sourceTokenAccount ||
    resolved[instruction.accountIndexes[1]!] !== proof.mint || resolved[instruction.accountIndexes[2]!] !== proof.authority || instruction.data.length !== 10 ||
    instruction.data[0] !== 15 || instruction.data[9] !== proof.decimals) return false;
  return new DataView(instruction.data.buffer, instruction.data.byteOffset, instruction.data.byteLength).getBigUint64(1, true) === proof.amountRaw;
}

async function verifySuccess(
  writes: readonly MimirBetaExpectedWrite[],
  addresses: readonly Address[],
  post: MimirBetaContext<readonly (MimirBetaAccount | null)[]>,
  parsed: ParsedV1Transaction,
  transaction: MimirBetaFinalizedTransactionEvidence,
  resolved: readonly Address[],
  reviewedStep: MimirBetaReviewedStepLineage,
  proposalSupersessions: ReadonlyMap<Address, string>,
): Promise<readonly MimirBetaWriteEvidence[]> {
  const accounts = new Map(addresses.map((address, index) => [address, post.value[index] ?? null]));
  await assertMimirBetaNativeRefreshTrios({
    writes: writes.flatMap((write): NativeTrioWrite[] => write.proof.kind === "account" && write.proof.after.exists &&
      write.proof.after.data.kind === "sdk-codec" ? [{ codec: write.proof.after.data.codec, address: write.address,
        account: accounts.get(write.address) ?? null }] : []),
    programId: reviewedStep.review.programId,
    transactionSlot: transaction.slot,
    accountContextSlot: post.slot,
  });
  const hasTickerProof = writes.some((write) => write.proof.kind === "account" && write.proof.after.exists &&
    write.proof.after.data.kind === "sdk-codec" && write.proof.after.data.codec === "ticker-claim-v1");
  const v1Creation = isV1CreationReview(reviewedStep.review);
  if ((reviewedStep.step.stepId === "classic:activate" || reviewedStep.step.stepId === "composite:activate" && hasTickerProof) && !v1Creation) {
    const [canonicalTickerPda, canonicalBump] = await deriveMimirBetaTickerPda(reviewedStep.review.programId, reviewedStep.review.ticker);
    const tickerWrites = writes.filter((write) => write.proof.kind === "account" && write.proof.after.exists &&
      write.proof.after.data.kind === "sdk-codec" && write.proof.after.data.codec === "ticker-claim-v1" &&
      write.address === canonicalTickerPda);
    if (tickerWrites.length !== 1) conflict("terminal ticker claim expectation is missing or duplicated");
    const tickerWrite = tickerWrites[0]!;
    const tickerAccount = accounts.get(tickerWrite.address);
    const configAccount = accounts.get(reviewedStep.review.feed);
    if (!tickerAccount || !configAccount) conflict("ticker claim or feed config post-state missing");
    const claim = decodeMimirTickerClaim(tickerAccount.data);
    const config = reviewedStep.review.kind === "classic"
      ? decodeMimirClassicConfig(configAccount.data)
      : decodeMimirCompositeConfig(configAccount.data);
    if (tickerWrite.address !== canonicalTickerPda || claim.bump !== canonicalBump || claim.config !== reviewedStep.review.feed ||
      config.ticker !== reviewedStep.review.ticker) {
      conflict("ticker PDA, bump, config back-reference, or decoded ticker mismatch", tickerWrite.address);
    }
  }
  if (v1Creation) {
    const { review } = reviewedStep;
    const feed = accounts.get(review.feed);
    if (!feed || feed.owner !== review.programId || !writes.some((write) => write.address === review.feed && write.proof.kind === "account")) {
      conflict("V1 created feed post-state missing or not program-owned", review.feed);
    }
    let identity: { feedId: Uint8Array; ticker: Uint8Array };
    try {
      if (review.kind === "classic") {
        const decoded = decodeV1ClassicFeed(feed.data, review.feed);
        identity = { feedId: decoded.feedId, ticker: decoded.definition.ticker };
      } else {
        const decoded = decodeV1CompositeFeed(feed.data, review.feed);
        identity = { feedId: decoded.snapshot.feedId, ticker: decoded.config.ticker };
      }
    } catch { return conflict("V1 created feed does not decode", review.feed); }
    if (!bytesEqual(identity.feedId, addressBytes(review.feedId)) || decodeMimirBetaTicker(identity.ticker) !== review.ticker) {
      conflict("V1 created feed identity differs from the review", review.feed);
    }
  }
  let walletInstructionIndexes: ReadonlyMap<number, number>;
  try {
    walletInstructionIndexes = mimirBetaReviewedToWalletInstructionIndexesV1(
      mimirBetaReviewedMessageOfWalletV1(parsed.messageBytes, reviewedStep.review), parsed.messageBytes,
      mimirBetaReviewWalletGuardAccountsV1(reviewedStep.review));
  } catch { return conflict("reviewed outer instructions cannot be mapped to the wallet message"); }
  const callerPrefix = reviewedStep.review.callerPrefix;
  const prefixOnly = new Set(writes.flatMap((write) => write.proof.kind === "caller-prefix" ? [write.address] : []));
  const programDeltaExpectations = new Map<number, bigint>();
  const preToken = tokenMaps(transaction.meta.preTokenBalances);
  const postToken = tokenMaps(transaction.meta.postTokenBalances);
  const consumedTokenKeys = new Set<string>();
  const burnGroups = new Map<string, bigint>();
  for (const write of writes) {
    if (write.proof.kind !== "spl-token-burn-checked") continue;
    const proof = write.proof;
    const sourceIndex = resolved.indexOf(proof.sourceTokenAccount);
    const key = `${sourceIndex}:${proof.mint}:${proof.authority}:${proof.tokenProgram}:${proof.decimals}`;
    burnGroups.set(key, (burnGroups.get(key) ?? 0n) + proof.amountRaw);
  }
  const evidence: MimirBetaWriteEvidence[] = [];
  for (let index = 0; index < writes.length; index += 1) {
    const write = writes[index]!;
    const proof = write.proof;
    let evidenceHash: string;
    if (proof.kind === "account") {
      const refreshable = sharedAccountRole(write, writes) || v1Creation ? null
        : await refreshableAccountRole(write, accounts, reviewedStep.review.programId);
      const sharedRole = sharedAccountRole(write, writes) ?? (refreshable ? "refreshable" : null);
      evidenceHash = proposalSupersessions.get(write.address) ?? (sharedRole
        ? await verifySharedAccountEffect(write, sharedRole, writes, accounts.get(write.address) ?? null, parsed, transaction, resolved,
          refreshable ?? undefined, accounts, reviewedStep)
        : await verifyAccountPostcondition(write.address, proof.after, accounts.get(write.address) ?? null,
          transaction.slot, post.slot, transaction.blockTime, accounts, v1Creation && proof.after.exists && proof.after.owner === reviewedStep.review.programId));
      const keyIndex = resolved.indexOf(write.address);
      if (keyIndex < 0 || transaction.meta.preBalances[keyIndex] !== proof.before.lamports) {
        conflict("account transition pre-lamports differ from reviewed baseline", write.address);
      }
      if (keyIndex === 0 || programDeltaExpectations.has(keyIndex)) conflict("account transition lamport identity is ambiguous", write.address);
      const reviewedPostLamports = proof.after.exists ? proof.after.lamports : 0n;
      if (transaction.meta.postBalances[keyIndex] !== reviewedPostLamports) {
        conflict("account transition post-lamports differ from reviewed postcondition", write.address);
      }
      const delta = reviewedPostLamports - proof.before.lamports;
      if (proof.transition === "create" && reviewedPostLamports <= 0n || proof.transition === "close" && reviewedPostLamports !== 0n) {
        conflict("account transition lamport direction is invalid", write.address);
      }
      programDeltaExpectations.set(keyIndex, delta);
    } else if (proof.kind === "lamports") {
      const keyIndex = resolved.indexOf(write.address);
      if (keyIndex < 0 || programDeltaExpectations.has(keyIndex)) conflict("lamport expectation address is absent, duplicated, or conflicting", write.address);
      programDeltaExpectations.set(keyIndex, proof.programDeltaLamports);
      evidenceHash = await domainHash("MIMIR_BETA_LAMPORT_EVIDENCE_V1\0", canonicalJson({ address: write.address, delta: proof.programDeltaLamports }));
    } else if (proof.kind === "caller-prefix") {
      const keyIndex = resolved.indexOf(write.address);
      if (keyIndex <= 0 || programDeltaExpectations.has(keyIndex)) conflict("caller-prefix address is absent, the fee payer, or a core write", write.address);
      evidenceHash = await domainHash("MIMIR_BETA_CALLER_PREFIX_EVIDENCE_V1\0", canonicalJson({ address: write.address,
        preLamports: transaction.meta.preBalances[keyIndex]!, postLamports: transaction.meta.postBalances[keyIndex]! }));
    } else {
      const walletIndex = walletInstructionIndexes.get(proof.outerInstructionIndex);
      if (walletIndex === undefined) conflict("BurnChecked CPI proof outer instruction is not a reviewed non-fee instruction", write.address);
      const groups = transaction.meta.innerInstructions.filter((entry) => entry.outerInstructionIndex === walletIndex);
      if (groups.length > 1) conflict("BurnChecked CPI inner instruction group is duplicated", write.address);
      const matches = groups[0]?.instructions.filter((instruction) => innerMatchesBurn(instruction, proof, resolved)) ?? [];
      if (matches.length !== 1) conflict("BurnChecked CPI proof is missing or duplicated", write.address);
      const sourceIndex = resolved.indexOf(proof.sourceTokenAccount);
      const key = `${sourceIndex}:${proof.mint}:${proof.authority}:${proof.tokenProgram}:${proof.decimals}`;
      const aggregateAmountRaw = burnGroups.get(key);
      const before = preToken.get(key); const after = postToken.get(key);
      if (aggregateAmountRaw === undefined || !before || !after) conflict("BurnChecked token balance evidence missing", write.address);
      if (!consumedTokenKeys.has(key)) {
        const funding = callerPrefix?.funding?.tokenAccount === proof.sourceTokenAccount ? callerPrefix.funding : null;
        if (funding ? after.amountRaw - before.amountRaw + aggregateAmountRaw < funding.minimumCreditRaw
          : before.amountRaw < aggregateAmountRaw || before.amountRaw - after.amountRaw !== aggregateAmountRaw) {
          conflict("aggregate BurnChecked token amount delta mismatch", write.address);
        }
        const source = accounts.get(proof.sourceTokenAccount); const mint = accounts.get(proof.mint);
        if (!source || !mint) conflict("BurnChecked coherent source/mint post-read missing", write.address);
        const decodedSource = decodeMimirBetaSplTokenAccount(source, proof.tokenProgram);
        const decodedMint = decodeMimirBetaSplMint(mint, proof.tokenProgram);
        if (decodedSource.mint !== proof.mint || decodedSource.owner !== proof.authority ||
          decodedMint.decimals !== proof.decimals) conflict("BurnChecked coherent source/mint post-state mismatch", write.address);
        consumedTokenKeys.add(key);
      }
      evidenceHash = await domainHash("MIMIR_BETA_BURN_CHECKED_EVIDENCE_V1\0", canonicalJson({ proof,
        preAmountRaw: before.amountRaw, postAmountRaw: after.amountRaw, aggregateAmountRaw }));
    }
    evidence.push({ index, address: write.address, kind: proof.kind, evidenceHash });
  }
  let nonPayerProgramDelta = 0n;
  for (const [keyIndex, delta] of programDeltaExpectations) {
    if (keyIndex !== 0) nonPayerProgramDelta += delta;
  }
  const derivedPayerProgramDelta = -nonPayerProgramDelta;
  const reviewedPayerProgramDelta = programDeltaExpectations.get(0);
  if (derivedPayerProgramDelta === 0n ? reviewedPayerProgramDelta !== undefined : reviewedPayerProgramDelta !== derivedPayerProgramDelta) {
    conflict("fee payer program delta is missing, zero, or differs from reviewed conservation residual", resolved[0]);
  }
  programDeltaExpectations.set(0, derivedPayerProgramDelta);
  let adjustedSum = 0n;
  for (let index = 0; index < resolved.length; index += 1) {
    let delta = transaction.meta.postBalances[index]! - transaction.meta.preBalances[index]!;
    if (index === 0) delta += transaction.meta.fee;
    adjustedSum += delta;
    if (prefixOnly.has(resolved[index]!)) continue;
    const expected = programDeltaExpectations.get(index) ?? 0n;
    if (index === 0 && callerPrefix) {
      if (delta < expected - callerPrefix.maxAuthorityDebitLamports) conflict("authority lamport debit exceeds the reviewed caller-prefix bound", resolved[0]);
    } else if (delta !== expected) conflict("lamport delta differs from review or is unmodelled", resolved[index]);
  }
  if (adjustedSum !== 0n) conflict("fee-adjusted lamport conservation failed");
  const covered = callerPrefix?.funding?.coversBurn ? writes.flatMap((write) => write.proof.kind === "spl-token-burn-checked" &&
    write.proof.sourceTokenAccount === callerPrefix.funding!.tokenAccount ? [write.proof] : [])[0] : undefined;
  const allTokenKeys = new Set([...preToken.keys(), ...postToken.keys()]);
  for (const key of allTokenKeys) {
    const before = preToken.get(key); const after = postToken.get(key);
    const row = (before ?? after)!;
    if (covered && row.mint === covered.mint && row.owner === covered.authority && resolved[row.accountIndex] !== covered.sourceTokenAccount &&
      (after?.amountRaw ?? 0n) < (before?.amountRaw ?? 0n)) conflict("covered caller-prefix burn drew on another authority balance of the burn mint", resolved[row.accountIndex]);
    if (prefixOnly.has(resolved[row.accountIndex]!)) continue;
    if (!before || !after) conflict("token balance identity appeared or disappeared");
    if (before.amountRaw !== after.amountRaw && !consumedTokenKeys.has(key)) conflict("unmodelled token balance delta");
  }
  return evidence;
}

async function verifyFailureRollback(
  writes: readonly MimirBetaExpectedWrite[],
  addresses: readonly Address[],
  post: MimirBetaContext<readonly (MimirBetaAccount | null)[]>,
  transaction: MimirBetaFinalizedTransactionEvidence,
  resolved: readonly Address[],
): Promise<"baseline-matched" | "state-diverged"> {
  for (let index = 0; index < resolved.length; index += 1) {
    const delta = transaction.meta.postBalances[index]! - transaction.meta.preBalances[index]!;
    if (index === 0 ? delta !== -transaction.meta.fee : delta !== 0n) conflict("failed transaction has non-atomic lamport effects", resolved[index]);
  }
  const pre = tokenMaps(transaction.meta.preTokenBalances); const postMap = tokenMaps(transaction.meta.postTokenBalances);
  if (pre.size !== postMap.size || [...pre].some(([key, value]) => postMap.get(key)?.amountRaw !== value.amountRaw)) {
    conflict("failed transaction has non-atomic token effects");
  }
  return baselineRollback(writes, addresses, post, resolved[0]!, transaction.meta.fee);
}

async function baselineRollback(
  writes: readonly MimirBetaExpectedWrite[],
  addresses: readonly Address[],
  post: MimirBetaContext<readonly (MimirBetaAccount | null)[]>,
  feePayer: Address | null,
  fee: bigint,
): Promise<"baseline-matched" | "state-diverged"> {
  const current = new Map(addresses.map((address, index) => [address, post.value[index] ?? null]));
  for (const write of writes) {
    if (write.proof.kind !== "account") continue;
    const fingerprint = await fingerprintMimirBetaAccount(current.get(write.address) ?? null);
    const expected = write.proof.before;
    const expectedLamports = write.address === feePayer && expected.exists ? expected.lamports - fee : expected.lamports;
    if (expectedLamports < 0n || fingerprint.exists !== expected.exists || fingerprint.owner !== expected.owner ||
      fingerprint.executable !== expected.executable || fingerprint.lamports !== expectedLamports ||
      fingerprint.dataLength !== expected.dataLength || fingerprint.dataSha256 !== expected.dataSha256) return "state-diverged";
  }
  return "baseline-matched";
}

async function verifyReceiptEvidence(args: {
  readonly receipt: MimirBetaStageReceipt;
  readonly preparedStep?: MimirBetaPreparedStep;
  readonly transaction: MimirBetaFinalizedTransactionEvidence;
  readonly postAccounts: MimirBetaContext<readonly (MimirBetaAccount | null)[]>;
}, commitment: "confirmed" | "finalized", proposalSupersessions: ReadonlyMap<Address, string> = new Map()): Promise<Exclude<MimirBetaProvenObservation | MimirBetaConfirmedObservation, { state: "pending" }>> {
  const { receipt, transaction } = args;
  const reviewedStep = await authenticateMimirBetaReviewedStep(receipt);
  if (args.preparedStep && (canonicalJson(args.preparedStep.step as never) !== canonicalJson(reviewedStep.step as never) ||
    canonicalJson(args.preparedStep.review as never) !== canonicalJson(reviewedStep.review as never) ||
    args.preparedStep.canonicalReviewJson !== reviewedStep.canonicalReviewJson ||
    args.preparedStep.reviewHash !== reviewedStep.reviewHash ||
    args.preparedStep.transaction.messageHash !== reviewedStep.review.messageHash)) conflict("supplied prepared step differs from durable reviewed lineage");
  const parsed = parseRawV1Transaction(transaction.transactionBytes);
  if (transaction.version !== 1 || transaction.signature !== receipt.signature || parsed.signatures[0] !== receipt.signature ||
    !sameStrings(parsed.signatures, transaction.signatures) || !bytesEqual(parsed.messageBytes, transaction.messageBytes) ||
    args.preparedStep && !isMimirBetaWalletRewriteV1(args.preparedStep.transaction.serializedMessage, parsed.messageBytes,
      mimirBetaReviewWalletGuardAccountsV1(args.preparedStep.review))) conflict("raw transaction signature/message differs from receipt");
  const messageHash = hex(await sha256(parsed.messageBytes));
  if (messageHash !== receipt.messageHash) conflict("raw transaction message hash differs from receipt");
  const resolved = assertFinalizedMessageEnvelope(parsed, reviewedStep, transaction);
  const addresses = proofAddresses(reviewedStep.step.expectedWrites);
  for (const address of addresses) {
    const index = resolved.indexOf(address);
    if (index < 0 || !resolvedWritable(parsed, index)) conflict("expected write address is absent or readonly", address);
  }
  if (transaction.meta.err === null) {
    const readAddresses = successReadAddresses(addresses, reviewedStep);
    assertPostAccountOrder(readAddresses, args.postAccounts, transaction.slot);
    const writes = await verifySuccess(reviewedStep.step.expectedWrites, readAddresses, args.postAccounts, parsed, transaction, resolved, reviewedStep, proposalSupersessions);
    const evidenceHash = await domainHash(commitment === "finalized" ? "MIMIR_BETA_FINALIZED_EVIDENCE_V1\0" : "MIMIR_BETA_CONFIRMED_EVIDENCE_V1\0", canonicalJson({ signature: receipt.signature,
      slot: transaction.slot, accountContextSlot: args.postAccounts.slot, messageHash, writes } as never));
    return { state: commitment, stepId: receipt.stepId, signature: receipt.signature, observedSlot: transaction.slot,
      accountContextSlot: args.postAccounts.slot, messageHash, evidenceHash, writes };
  }
  assertPostAccountOrder(addresses, args.postAccounts, transaction.slot);
  const rollback = await verifyFailureRollback(reviewedStep.step.expectedWrites, addresses, args.postAccounts, transaction, resolved);
  const errorHash = await domainHash("MIMIR_BETA_TRANSACTION_ERROR_V1\0", transaction.meta.err);
  const evidenceHash = await domainHash(commitment === "finalized" ? "MIMIR_BETA_FAILED_EVIDENCE_V1\0" : "MIMIR_BETA_CONFIRMED_FAILED_EVIDENCE_V1\0", canonicalJson({ signature: receipt.signature,
    slot: transaction.slot, messageHash, errorHash, rollback }));
  return { state: commitment === "finalized" ? "failed" : "confirmed-failed", stepId: receipt.stepId, signature: receipt.signature, observedSlot: transaction.slot,
    messageHash, errorHash, rollback, evidenceHash };
}

export async function verifyMimirBetaFinalizedReceiptEvidence(args: Parameters<typeof verifyReceiptEvidence>[0]):
  Promise<Exclude<MimirBetaProvenObservation, { state: "pending" }>> {
  return await verifyReceiptEvidence(args, "finalized") as Exclude<MimirBetaProvenObservation, { state: "pending" }>;
}

export async function observeMimirBetaConfirmedReceipt(args: {
  readonly rpc: MimirBetaReconciliationRpc;
  readonly receipt: MimirBetaStageReceipt;
  readonly preparedStep?: MimirBetaPreparedStep;
  readonly minContextSlot?: bigint;
}): Promise<MimirBetaConfirmedObservation> {
  const reviewedStep = await authenticateMimirBetaReviewedStep(args.receipt);
  const transaction = await decodeMimirBetaReceiptTransactionResponse(args.receipt.signature, await args.rpc.getTransaction(args.receipt.signature, {
    commitment: "confirmed", encoding: "base64", maxSupportedTransactionVersion: 1,
  }).send(), fromBase64(args.receipt.messageBase64));
  if (!transaction) return { state: "pending", stepId: args.receipt.stepId, signature: args.receipt.signature };
  if (transaction.slot < reviewedStep.review.simulation.contextSlot) conflict("confirmed transaction precedes reviewed context");
  const proofs = proofAddresses(reviewedStep.step.expectedWrites);
  const addresses = transaction.meta.err === null ? successReadAddresses(proofs, reviewedStep) : proofs;
  const floor = args.minContextSlot !== undefined && args.minContextSlot > transaction.slot ? args.minContextSlot : transaction.slot;
  const postAccounts = await new FinalizedRpcReader(args.rpc, "confirmed").accounts(addresses, floor);
  return await verifyReceiptEvidence({ ...args, transaction, postAccounts }, "confirmed") as MimirBetaConfirmedObservation;
}

type ReceiptChainArgs = {
  readonly rpc: MimirBetaReconciliationRpc;
  readonly receipts: readonly MimirBetaStageReceipt[];
  /** Account freshness floor at the collector's commitment. */
  readonly minContextSlot?: bigint;
  readonly finalityAttempts?: number;
};

function classicProposalAddresses(lineage: MimirBetaReviewedStepLineage): ReadonlySet<Address> {
  return new Set(lineage.review.kind !== "classic" ? [] : reviewedProgramInstructions(lineage).flatMap(({ keys, data }) =>
    data[0] === 78 && (data[1] === 2 || data[1] === 3) && keys[5] ? [keys[5]] :
      data[0] === 78 && data[1] === 1 && keys[0] ? [keys[0]] : []));
}

async function proposalSupersessionEvidence(
  receipt: MimirBetaStageReceipt,
  lineage: MimirBetaReviewedStepLineage,
  transaction: MimirBetaFinalizedTransactionEvidence,
  successor: { receipt: MimirBetaStageReceipt; lineage: MimirBetaReviewedStepLineage;
    transaction: MimirBetaFinalizedTransactionEvidence; observation: MimirBetaProvenObservation | MimirBetaConfirmedObservation },
): Promise<ReadonlyMap<Address, string>> {
  const evidence = new Map<Address, string>();
  if (successor.observation.state !== "confirmed" && successor.observation.state !== "finalized") return evidence;
  if (successor.lineage.step.ordinal !== lineage.step.ordinal + 1 ||
    !successor.lineage.step.prerequisiteStepIds.includes(receipt.stepId)) return evidence;
  const parent = lineage.review; const child = successor.lineage.review;
  if (child.kind !== parent.kind || child.feedId !== parent.feedId || child.feed !== parent.feed ||
    child.identityAsset !== parent.identityAsset || child.ticker !== parent.ticker) return evidence;
  const proposals = classicProposalAddresses(lineage);
  for (const write of lineage.step.expectedWrites) {
    const proof = write.proof;
    if (!proposals.has(write.address) || proof.kind !== "account" || !proof.after.exists ||
      proof.after.owner !== lineage.review.programId || proof.after.executable ||
      proof.after.data.length < 608 || (proof.after.data.length - 608) % 392 !== 0 || proof.after.data.length > 608 + 392 * 5) continue;
    const nextWrite = successor.lineage.step.expectedWrites.find((next) => next.address === write.address && next.proof.kind === "account");
    if (!nextWrite || nextWrite.proof.kind !== "account") continue;
    const nextProof = nextWrite.proof;
    if (nextProof.transition !== "write" && nextProof.transition !== "close") continue;
    const before = nextProof.before;
    if (!before.exists || before.owner !== proof.after.owner || before.executable !== proof.after.executable ||
      before.lamports !== proof.after.lamports || typeof nextProof.beforeDataBase64 !== "string") {
      conflict("proposal successor baseline witness is missing or incompatible", write.address);
    }
    const baseline: MimirBetaAccount = { address: write.address, owner: before.owner, executable: before.executable,
      lamports: before.lamports, data: fromBase64(nextProof.beforeDataBase64) };
    if (canonicalJson(await fingerprintMimirBetaAccount(baseline) as never) !== canonicalJson(before as never)) {
      conflict("proposal successor baseline fingerprint mismatch", write.address);
    }
    const view = new DataView(baseline.data.buffer, baseline.data.byteOffset, baseline.data.byteLength);
    if (baseline.data.length !== proof.after.data.length || view.getUint16(8, true) !== 1 || view.getUint16(10, true) !== 608) {
      conflict("proposal successor baseline header mismatch", write.address);
    }
    const baselineSlot = successor.lineage.review.simulation.contextSlot;
    if (transaction.slot > baselineSlot || baselineSlot > successor.transaction.slot) {
      conflict("proposal successor baseline context is not causal", write.address);
    }
    const predecessorWriteEvidence = await verifyAccountPostcondition(write.address, proof.after, baseline,
      transaction.slot, baselineSlot, transaction.blockTime, new Map([[write.address, baseline]]));
    evidence.set(write.address, await domainHash("MIMIR_BETA_PROPOSAL_SUPERSESSION_EVIDENCE_V1\0", canonicalJson({
      predecessorSignature: receipt.signature, predecessorMessageHash: receipt.messageHash, predecessorWrite: write,
      predecessorWriteEvidence, successorSignature: successor.receipt.signature, successorReviewHash: successor.receipt.reviewHash,
      successorMessageHash: successor.receipt.messageHash, baseline: before, baselineSlot,
      successorEvidenceHash: successor.observation.evidenceHash,
    } as never)));
  }
  return evidence;
}

async function observeReceiptChain(args: ReceiptChainArgs, commitment: "confirmed" | "finalized",
  expired?: Extract<MimirBetaProvenObservation, { state: "expired" }>):
  Promise<readonly (MimirBetaProvenObservation | MimirBetaConfirmedObservation)[]> {
  const lineages = await Promise.all(args.receipts.map(authenticateMimirBetaReviewedStep));
  const subject = (lineage: MimirBetaReviewedStepLineage) => {
    const { draftHash, cluster, programId, authority } = lineage.review;
    return canonicalJson({ draftHash, cluster, programId, authority });
  };
  const latestByOrdinal = new Map<number, number>();
  const priorSteps = new Set<string>();
  const signatures = new Set<string>();
  for (let index = 0; index < lineages.length; index++) {
    const lineage = lineages[index]!;
    const previous = lineages[index - 1];
    const receipt = args.receipts[index]!;
    if (subject(lineage) !== subject(lineages[0]!) || signatures.has(receipt.signature) ||
      previous && lineage.step.ordinal < previous.step.ordinal ||
      lineage.step.prerequisiteStepIds.some((id) => !priorSteps.has(id))) conflict("receipt chain subject, order, or prerequisites differ");
    const priorIndex = latestByOrdinal.get(lineage.step.ordinal);
    if (priorIndex !== undefined) {
      const prior = args.receipts[priorIndex]!;
      if (receipt.stepId !== prior.stepId || receipt.attempt !== prior.attempt + 1 || receipt.retryOfSignature !== prior.signature ||
        receipt.stepIntentHash !== prior.stepIntentHash || receipt.expectedWritesHash !== prior.expectedWritesHash) conflict("receipt chain retry differs from predecessor");
    }
    latestByOrdinal.set(lineage.step.ordinal, index);
    priorSteps.add(receipt.stepId);
    signatures.add(receipt.signature);
  }
  const verified = new Map<number, { receipt: MimirBetaStageReceipt; lineage: MimirBetaReviewedStepLineage;
    transaction: MimirBetaFinalizedTransactionEvidence; observation: MimirBetaProvenObservation | MimirBetaConfirmedObservation }>();
  const observations: (MimirBetaProvenObservation | MimirBetaConfirmedObservation)[] = new Array(args.receipts.length);
  for (let index = args.receipts.length - 1; index >= 0; index--) {
    const receipt = args.receipts[index]!;
    const lineage = lineages[index]!;
    if (expired && index === args.receipts.length - 1) {
      observations[index] = expired;
      continue;
    }
    const transaction = await decodeMimirBetaReceiptTransactionResponse(receipt.signature, await args.rpc.getTransaction(receipt.signature, {
      commitment, encoding: "base64", maxSupportedTransactionVersion: 1,
    }).send(), fromBase64(receipt.messageBase64));
    const successorIndex = latestByOrdinal.get(lineage.step.ordinal + 1);
    const successor = successorIndex === undefined ? undefined : verified.get(successorIndex);
    const pendingSuccessor = successorIndex !== undefined && observations[successorIndex]?.state === "pending" &&
      lineages[successorIndex]!.step.prerequisiteStepIds.includes(receipt.stepId);
    if (transaction && transaction.slot < lineage.review.simulation.contextSlot) conflict(`${commitment} transaction precedes reviewed context`);
    if (!transaction || pendingSuccessor) {
      observations[index] = { state: "pending", stepId: receipt.stepId, signature: receipt.signature };
      continue;
    }
    const proofs = proofAddresses(lineage.step.expectedWrites);
    const addresses = transaction.meta.err === null ? successReadAddresses(proofs, lineage) : proofs;
    const floor = args.minContextSlot !== undefined && args.minContextSlot > transaction.slot ? args.minContextSlot : transaction.slot;
    const postAccounts = await new FinalizedRpcReader(args.rpc, commitment).accounts(addresses, floor);
    const supersessions = transaction.meta.err === null && successor
      ? await proposalSupersessionEvidence(receipt, lineage, transaction, successor) : new Map<Address, string>();
    const observation = await verifyReceiptEvidence({ receipt, transaction, postAccounts }, commitment, supersessions);
    observations[index] = observation;
    verified.set(index, { receipt, lineage, transaction, observation });
  }
  return observations;
}

export async function observeMimirBetaConfirmedReceiptChain(args: ReceiptChainArgs): Promise<readonly MimirBetaConfirmedObservation[]> {
  return await observeReceiptChainWithExpiry(args, "confirmed") as readonly MimirBetaConfirmedObservation[];
}

export async function observeMimirBetaReceiptChain(args: ReceiptChainArgs): Promise<readonly MimirBetaProvenObservation[]> {
  return await observeReceiptChainWithExpiry(args, "finalized") as readonly MimirBetaProvenObservation[];
}

async function observeReceiptChainWithExpiry(args: ReceiptChainArgs, commitment: "confirmed" | "finalized") {
  const observations = await observeReceiptChain(args, commitment);
  const receipt = args.receipts.at(-1);
  if (!receipt || observations.at(-1)?.state !== "pending") return observations;
  if (commitment === "confirmed" && (!args.rpc.getSignatureStatuses || !args.rpc.isBlockhashValid)) return observations;
  const latest = await observeMimirBetaReceipt({
    rpc: args.rpc, receipt,
    ...(commitment === "finalized" && args.minContextSlot !== undefined ? { minContextSlot: args.minContextSlot } : {}),
    ...(args.finalityAttempts === undefined ? {} : { finalityAttempts: args.finalityAttempts }),
  });
  if (latest.state !== "expired") return observations;
  if (commitment === "confirmed" && args.minContextSlot !== undefined && latest.rollback === "baseline-matched") {
    // Keep a confirmed caller's freshness floor on confirmed reads; expiry itself is proven at a rooted bank.
    const lineage = await authenticateMimirBetaReviewedStep(receipt);
    const addresses = proofAddresses(lineage.step.expectedWrites);
    const floor = args.minContextSlot > latest.accountContextSlot ? args.minContextSlot : latest.accountContextSlot;
    const current = await new FinalizedRpcReader(args.rpc, "confirmed").accounts(addresses, floor);
    if (await baselineRollback(lineage.step.expectedWrites, addresses, current, null, 0n) !== "baseline-matched") {
      conflict("expired stage baseline changed during confirmed preparation");
    }
  }
  const finalized = await observeReceiptChain({
    ...args,
    minContextSlot: commitment === "finalized" && args.minContextSlot !== undefined && args.minContextSlot > latest.accountContextSlot
      ? args.minContextSlot : latest.accountContextSlot,
  }, "finalized", latest);
  if (commitment === "confirmed" && args.minContextSlot !== undefined) {
    const current = await observeReceiptChain({ ...args, minContextSlot: args.minContextSlot > latest.accountContextSlot
      ? args.minContextSlot : latest.accountContextSlot }, "confirmed", latest);
    for (const [index, prior] of finalized.entries()) {
      const fresh = current[index]!;
      if (prior.state === "finalized" && (fresh.state !== "confirmed" || fresh.observedSlot !== prior.observedSlot ||
        fresh.messageHash !== prior.messageHash || fresh.accountContextSlot < prior.accountContextSlot)) {
        conflict("finalized prerequisite changed during confirmed preparation");
      }
    }
  }
  return Object.freeze(finalized);
}

const MIMIR_BETA_EXPIRY_FINALITY_ATTEMPTS = 120;

function minContextSlotNotReached(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; context?: { __code?: unknown } };
  return record.code === -32016 || record.context?.__code === -32016 ||
    (error instanceof Error && /-32016|minimum context slot has not been reached/i.test(error.message));
}

export async function observeMimirBetaReceipt(args: {
  readonly rpc: MimirBetaReconciliationRpc;
  readonly receipt: MimirBetaStageReceipt;
  readonly preparedStep?: MimirBetaPreparedStep;
  readonly finalityDelayMs?: number;
  readonly minContextSlot?: bigint;
  /** Bounded floor acquisitions for an expiry proof (1..120, default 120); exhaustion throws `MimirBetaExpiryFinalizingError`. */
  readonly finalityAttempts?: number;
}): Promise<MimirBetaProvenObservation> {
  const finalityAttempts = args.finalityAttempts ?? MIMIR_BETA_EXPIRY_FINALITY_ATTEMPTS;
  if (!Number.isSafeInteger(finalityAttempts) || finalityAttempts < 1 || finalityAttempts > MIMIR_BETA_EXPIRY_FINALITY_ATTEMPTS) {
    betaError("INVALID_ARGUMENT", "expiry finality attempts must be 1..120");
  }
  const reviewedStep = await authenticateMimirBetaReviewedStep(args.receipt);
  const message = assertMimirBetaReviewedMessageV1(fromBase64(args.receipt.messageBase64), reviewedStep);
  const getTransaction = async () => decodeMimirBetaReceiptTransactionResponse(args.receipt.signature, await args.rpc.getTransaction(args.receipt.signature, {
    commitment: "finalized",
    encoding: "base64",
    maxSupportedTransactionVersion: 1,
  }).send(), fromBase64(args.receipt.messageBase64));
  const verify = async (transaction: MimirBetaFinalizedTransactionEvidence) => {
    const proofs = proofAddresses(reviewedStep.step.expectedWrites);
    const addresses = transaction.meta.err === null ? successReadAddresses(proofs, reviewedStep) : proofs;
    const floor = args.minContextSlot !== undefined && args.minContextSlot > transaction.slot ? args.minContextSlot : transaction.slot;
    const postAccounts = await new FinalizedRpcReader(args.rpc).accounts(addresses, floor);
    return verifyMimirBetaFinalizedReceiptEvidence({ receipt: args.receipt, preparedStep: args.preparedStep, transaction, postAccounts });
  };
  let transaction = await getTransaction();
  if (transaction) return verify(transaction);
  if (!args.rpc.getSignatureStatuses || !args.rpc.isBlockhashValid) malformed("reconciliation RPC does not support authenticated expiry history");
  const getSignatureStatuses = args.rpc.getSignatureStatuses.bind(args.rpc);
  const isBlockhashValid = args.rpc.isBlockhashValid.bind(args.rpc);
  const status1 = decodeMimirBetaSignatureStatusResponse(await getSignatureStatuses([args.receipt.signature], { searchTransactionHistory: true }).send());
  if (status1.status) {
    if (status1.status.confirmationStatus !== "finalized") return { state: "pending", stepId: args.receipt.stepId, signature: args.receipt.signature };
    transaction = await getTransaction();
    if (!transaction) conflict("finalized signature status has no finalized transaction body");
    return verify(transaction);
  }
  const validity = decodeMimirBetaBlockhashValidityResponse(await isBlockhashValid(message.blockhash, { commitment: "confirmed" }).send());
  if (validity.valid) return { state: "pending", stepId: args.receipt.stepId, signature: args.receipt.signature };
  // A finalized bank must have reached the reviewed message before absence means expiry, not an unrooted blockhash.
  const rootedValidity = decodeMimirBetaBlockhashValidityResponse(await isBlockhashValid(message.blockhash, { commitment: "finalized" }).send());
  if (rootedValidity.valid || rootedValidity.slot < reviewedStep.review.simulation.contextSlot) {
    return { state: "pending", stepId: args.receipt.stepId, signature: args.receipt.signature };
  }
  const status2 = decodeMimirBetaSignatureStatusResponse(await getSignatureStatuses([args.receipt.signature], { searchTransactionHistory: true }).send());
  if (status2.slot < validity.slot || status2.slot < rootedValidity.slot || status2.slot < status1.slot) betaError("RPC_CONTEXT_MISMATCH", "post-invalidity signature status context regressed");
  if (status2.status) {
    if (status2.status.confirmationStatus !== "finalized") return { state: "pending", stepId: args.receipt.stepId, signature: args.receipt.signature };
    transaction = await getTransaction();
    if (!transaction) conflict("finalized signature status has no finalized transaction body");
    return verify(transaction);
  }
  transaction = await getTransaction();
  if (transaction) return verify(transaction);
  const historyUnavailableMessage = "RPC history unavailable; transaction outcome unknown";
  const getFirstAvailableBlock = args.rpc.getFirstAvailableBlock;
  if (!getFirstAvailableBlock) betaError("CREATION_CONTEXT_REQUIRED", historyUnavailableMessage);
  let rawFirstAvailableBlock: unknown;
  try {
    rawFirstAvailableBlock = await getFirstAvailableBlock.call(args.rpc).send();
  } catch (error) {
    if (error instanceof Error && error.message.trim()) throw error;
    betaError("CREATION_CONTEXT_REQUIRED", historyUnavailableMessage);
  }
  let firstAvailableBlock: bigint | null = null;
  if (typeof rawFirstAvailableBlock === "bigint" && rawFirstAvailableBlock >= 0n) firstAvailableBlock = rawFirstAvailableBlock;
  else if (typeof rawFirstAvailableBlock === "number" && Number.isSafeInteger(rawFirstAvailableBlock) && rawFirstAvailableBlock >= 0) {
    firstAvailableBlock = BigInt(rawFirstAvailableBlock);
  }
  if (firstAvailableBlock === null || firstAvailableBlock > reviewedStep.review.simulation.contextSlot) {
    betaError("CREATION_CONTEXT_REQUIRED", historyUnavailableMessage);
  }
  const addresses = proofAddresses(reviewedStep.step.expectedWrites);
  const floor = args.minContextSlot !== undefined && args.minContextSlot > rootedValidity.slot ? args.minContextSlot : rootedValidity.slot;
  const reader = new FinalizedRpcReader(args.rpc);
  let postAccounts: Awaited<ReturnType<FinalizedRpcReader["accounts"]>>;
  for (let attempt = 1; ; attempt++) {
    try {
      postAccounts = await reader.accounts(addresses, floor);
      break;
    } catch (error) {
      if (!minContextSlotNotReached(error)) throw error;
      if (attempt >= finalityAttempts) {
        if (finalityAttempts < MIMIR_BETA_EXPIRY_FINALITY_ATTEMPTS) throw new MimirBetaExpiryFinalizingError(args.receipt.signature, floor);
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, args.finalityDelayMs ?? 500));
    }
  }
  assertPostAccountOrder(addresses, postAccounts, floor);
  const rollback = await baselineRollback(reviewedStep.step.expectedWrites, addresses, postAccounts, null, 0n);
  const evidenceHash = await domainHash("MIMIR_BETA_EXPIRED_EVIDENCE_V1\0", canonicalJson({ stepId: args.receipt.stepId,
    signature: args.receipt.signature, messageHash: args.receipt.messageHash, blockhash: message.blockhash, observedSlot: rootedValidity.slot,
    accountContextSlot: postAccounts.slot, rollback }));
  return sealMimirBetaExpiredObservation({ state: "expired", stepId: args.receipt.stepId, signature: args.receipt.signature, observedSlot: rootedValidity.slot,
    messageHash: args.receipt.messageHash, blockhash: message.blockhash, accountContextSlot: postAccounts.slot, rollback, evidenceHash });
}
