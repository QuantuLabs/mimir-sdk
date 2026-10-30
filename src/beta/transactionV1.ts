import { address, getAddressEncoder, getAddressFromPublicKey, getPublicKeyFromAddress, type Address } from "@solana/addresses";
import { AccountRole, type Instruction } from "@solana/instructions";
import { signatureBytes, verifySignature } from "@solana/keys";
import { blockhash } from "@solana/rpc-types";
import {
  getCompiledTransactionMessageEncoder,
  getCompiledTransactionMessageDecoder,
  type TransactionMessage,
  type TransactionMessageWithBlockhashLifetime,
  type TransactionMessageWithFeePayer,
} from "@solana/transaction-messages";
import {
  compileTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Transaction,
} from "@solana/transactions";
import { sha256 as sha256Sync } from "@noble/hashes/sha2.js";
import bs58 from "bs58";
import { bytesEqual, fromBase64, hex, sha256 } from "./bytes.js";
import { LIGHTHOUSE_ASSERTION_PROGRAM } from "./callerPrefixIsolation.js";
import { betaError, type MimirBetaErrorCode } from "./errors.js";
import type { MimirBetaInstruction } from "./types.js";
import type {
  MimirBetaPacketProfile,
  MimirBetaSignerSignature,
  MimirBetaReviewedStepLineage,
  MimirBetaTransactionV1Config,
  MimirBetaUnsignedTransaction,
} from "./review.js";

export interface MimirBetaParsedReviewedMessageV1 {
  readonly messageBytes: Uint8Array;
  readonly blockhash: string;
  readonly requiredSignatureCount: number;
  readonly readonlySignedCount: number;
  readonly readonlyUnsignedCount: number;
  readonly staticAccountKeys: readonly Address[];
  readonly instructions: readonly Readonly<{ programIdIndex: number; accountIndexes: readonly number[]; data: Uint8Array }>[];
}

export function isMimirBetaTransactionV1ConfigEnvelope(message: Readonly<{ configMask: number; configValues: readonly Readonly<{ kind: string; value: unknown }>[] }>): boolean {
  const priced = (message.configMask & 3) === 3; const heap = (message.configMask & 16) !== 0;
  if ((message.configMask & ~16) !== (priced ? 15 : 12) || message.configValues.length !== (priced ? 3 : 2) + (heap ? 1 : 0)) return false;
  const [fee, cu, loaded, heapSize] = priced ? message.configValues : [undefined, ...message.configValues];
  return cu?.kind === "u32" && loaded?.kind === "u32" && (!heap || heapSize?.kind === "u32") &&
    validMimirBetaTransactionV1Limits({ computeUnitLimit: cu.value as number, loadedAccountsDataSizeLimit: loaded.value as number,
      ...(heap ? { heapSize: heapSize!.value as number } : {}) }) &&
    (!priced || fee?.kind === "u64" && typeof fee.value === "bigint" && fee.value >= mimirBetaMinPriorityFeeLamports(cu.value as number));
}

/** Canonical TxV1 limits: CU 1..1.4M, loaded data 1..64 MiB, heap a 1 KiB multiple in 32..256 KiB. */
export function validMimirBetaTransactionV1Limits(config: unknown): boolean {
  const c = config as Partial<MimirBetaTransactionV1Config> | null;
  const u32 = (v: unknown, max: number) => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= max;
  return !!c && u32(c.computeUnitLimit, MIMIR_BETA_TRANSACTION_V1_CONFIG.computeUnitLimit) &&
    u32(c.loadedAccountsDataSizeLimit, MIMIR_BETA_TRANSACTION_V1_CONFIG.loadedAccountsDataSizeLimit) &&
    (c.heapSize === undefined || u32(c.heapSize, 262_144) && c.heapSize >= 32_768 && c.heapSize % 1_024 === 0);
}

/** 10,000 µlamports per CU of the transaction's own compute-unit limit, rounded up. */
export const mimirBetaMinPriorityFeeLamports = (computeUnitLimit: number) =>
  (BigInt(computeUnitLimit) * MIMIR_BETA_TRANSACTION_V1_MIN_MICRO_LAMPORTS_PER_CU + 999_999n) / 1_000_000n;

function reviewedMessageError(code: MimirBetaErrorCode, message: string): never {
  return betaError(code, message);
}

function reviewedWritable(parsed: MimirBetaParsedReviewedMessageV1, index: number): boolean {
  if (index < parsed.requiredSignatureCount) return index < parsed.requiredSignatureCount - parsed.readonlySignedCount;
  return index < parsed.staticAccountKeys.length - parsed.readonlyUnsignedCount;
}

/** Parses canonical message-first V1 bytes and binds every signer, role and instruction to the durable review. */
export function assertMimirBetaReviewedMessageV1(
  messageBytes: Uint8Array,
  reviewedStep: MimirBetaReviewedStepLineage,
  errorCode: MimirBetaErrorCode = "RECEIPT_MISMATCH",
): MimirBetaParsedReviewedMessageV1 {
  if (!(messageBytes instanceof Uint8Array) || messageBytes.length < 1 || messageBytes.length > MIMIR_BETA_TRANSACTION_V1_MAX_BYTES || messageBytes[0] !== 0x81) {
    return reviewedMessageError(errorCode, "message is not strict message-first Transaction v1 bytes");
  }
  let reviewedBytes: Uint8Array;
  try { reviewedBytes = mimirBetaReviewedMessageOfWalletV1(messageBytes, reviewedStep.review); }
  catch { return reviewedMessageError(errorCode, "Transaction v1 message is malformed"); }
  if (!isMimirBetaWalletRewriteV1(reviewedBytes, messageBytes, mimirBetaReviewWalletGuardAccountsV1(reviewedStep.review))) return reviewedMessageError(errorCode, "wallet message is not an admitted rewrite of the review");
  const message = decodeStrictV1Message(reviewedBytes);
  if (message.version !== 1 ||
    !isMimirBetaTransactionV1ConfigEnvelope(message) ||
    message.numStaticAccounts < 1 || message.numStaticAccounts > 64 || message.numInstructions > 64 ||
    message.header.numSignerAccounts < 1 || message.header.numSignerAccounts > 12) {
    return reviewedMessageError(errorCode, "Transaction v1 message config/count envelope is invalid");
  }
  const parsed: MimirBetaParsedReviewedMessageV1 = {
    messageBytes,
    blockhash: message.lifetimeToken,
    requiredSignatureCount: message.header.numSignerAccounts,
    readonlySignedCount: message.header.numReadonlySignerAccounts,
    readonlyUnsignedCount: message.header.numReadonlyNonSignerAccounts,
    staticAccountKeys: message.staticAccounts,
    instructions: message.instructionHeaders.map((header, index) => ({
      programIdIndex: header.programAccountIndex,
      accountIndexes: message.instructionPayloads[index]!.instructionAccountIndices,
      data: new Uint8Array(message.instructionPayloads[index]!.instructionData),
    })),
  };
  const review = reviewedStep.review;
  const roles = new Map<Address, { isSigner: boolean; isWritable: boolean }>();
  const merge = (key: Address, role: { isSigner: boolean; isWritable: boolean }) => {
    const current = roles.get(key);
    roles.set(key, { isSigner: Boolean(current?.isSigner || role.isSigner), isWritable: Boolean(current?.isWritable || role.isWritable) });
  };
  for (const signer of review.requiredSigners) merge(signer, { isSigner: true, isWritable: false });
  merge(review.authority, { isSigner: true, isWritable: true });
  if (parsed.instructions.length !== review.instructions.length) return reviewedMessageError(errorCode, "compiled instruction count differs from review");
  parsed.instructions.forEach((instruction, instructionIndex) => {
    const expected = review.instructions[instructionIndex]!;
    merge(expected.programAddress, { isSigner: false, isWritable: false });
    if (parsed.staticAccountKeys[instruction.programIdIndex] !== expected.programAddress ||
      instruction.accountIndexes.length !== expected.accounts.length || !bytesEqual(instruction.data, fromBase64(expected.dataBase64))) {
      reviewedMessageError(errorCode, `compiled instruction ${instructionIndex} differs from review`);
    }
    instruction.accountIndexes.forEach((accountIndex, position) => {
      const expectedAccount = expected.accounts[position]!;
      merge(expectedAccount.address, expectedAccount);
      if (parsed.staticAccountKeys[accountIndex] !== expectedAccount.address) reviewedMessageError(errorCode, `compiled instruction ${instructionIndex} account ${position} differs from review`);
    });
  });
  if (roles.size !== parsed.staticAccountKeys.length || parsed.staticAccountKeys.some((key, index) => {
    const expected = roles.get(key);
    return !expected || expected.isSigner !== (index < parsed.requiredSignatureCount) || expected.isWritable !== reviewedWritable(parsed, index);
  })) return reviewedMessageError(errorCode, "resolved message global account roles differ from reviewed transaction-wide union");
  if (parsed.staticAccountKeys[0] !== review.authority || parsed.requiredSignatureCount !== review.requiredSigners.length ||
    !parsed.staticAccountKeys.slice(0, parsed.requiredSignatureCount).every((key, index) => key === review.requiredSigners[index]) ||
    parsed.requiredSignatureCount !== review.packet.signatureCount || parsed.staticAccountKeys.length !== review.packet.accountCount ||
    parsed.instructions.length !== review.packet.instructionCount) {
    return reviewedMessageError(errorCode, "reviewed fee payer/signer/account envelope differs from raw message");
  }
  return parsed;
}

type CompiledV1Message = Extract<ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>, { version: 1 }>;
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const WALLET_FEE_CONFIG_BITS = 0b111;

/** Reviewed Mimir config with the wallet-owned priority-fee and compute-unit-limit fields left free. */
export function validMimirBetaWalletConfigV1(configMask: number, configValues: CompiledV1Message["configValues"]): boolean {
  const heap = (configMask & 16) !== 0;
  const loaded = configValues.at(heap ? -2 : -1); const heapSize = heap ? configValues.at(-1) : undefined;
  return ((configMask & ~WALLET_FEE_CONFIG_BITS) === 8 || (configMask & ~WALLET_FEE_CONFIG_BITS) === 24) && loaded?.kind === "u32" &&
    (!heap || heapSize?.kind === "u32") && validMimirBetaTransactionV1Limits({ computeUnitLimit: 1, loadedAccountsDataSizeLimit: loaded.value,
      ...(heap ? { heapSize: heapSize!.value } : {}) });
}

function decodeStrictV1Message(messageBytes: Uint8Array): CompiledV1Message {
  const message = getCompiledTransactionMessageDecoder().decode(messageBytes);
  if (message.version !== 1) throw new Error("Expected a version 1 message");
  if (!bytesEqual(new Uint8Array(getCompiledTransactionMessageEncoder().encode(message)), messageBytes)) {
    throw new Error("Transaction v1 message bytes are not canonical");
  }
  if (new Set(message.staticAccounts).size !== message.staticAccounts.length) throw new Error("Duplicate static account keys");
  assertCaps(message.staticAccounts.length, message.instructionHeaders.length, message.header.numSignerAccounts,
    messageBytes.length + 64 * message.header.numSignerAccounts);
  return message;
}

/**
 * Accepts a wallet-returned message only when it equals the reviewed message except for the
 * TxV1 priority-fee/compute-unit-limit config and account-free ComputeBudget
 * SetComputeUnitLimit (2) / SetComputeUnitPrice (3) instructions, which may change or be inserted
 * together with the ComputeBudget program key.
 */
export function isMimirBetaFeeOnlyWalletRewriteV1(reviewedMessage: Uint8Array, walletMessage: Uint8Array): boolean {
  try {
    const reviewed = feeIndependentMessageView(reviewedMessage);
    const wallet = feeIndependentMessageView(walletMessage);
    return reviewed.length === wallet.length && reviewed.every((entry, index) => entry === wallet[index]);
  } catch { return false; }
}

// The old fee-only predicate keeps its existing meaning.

/** The reviewed creator collateral token account: the payer-authorized SPL BurnChecked source, if exactly one. */
export function mimirBetaReviewCollateralTokenAccountV1(review: Readonly<{
  authority: Address;
  expectedWrites: readonly Readonly<{ proof: Readonly<{ kind: string; sourceTokenAccount?: Address; authority?: Address }> }>[];
}>): Address | null {
  const sources = new Set(review.expectedWrites.flatMap((write) => write.proof.kind === "spl-token-burn-checked" &&
    write.proof.authority === review.authority && write.proof.sourceTokenAccount ? [write.proof.sourceTokenAccount] : []));
  return sources.size === 1 ? [...sources][0]! : null;
}

/** Token accounts a wallet token-account guard may target: the reviewed burn source, or an explicit caller-declared set. */
export type MimirBetaWalletGuardAccountsV1 = Address | null | undefined | Readonly<{ tokenAccounts: readonly Address[] }>;

/** Guard targets of a review: its burn source, or with a caller prefix the declared set of that source and the prefix's guardable token accounts. */
export function mimirBetaReviewWalletGuardAccountsV1(review: Parameters<typeof mimirBetaReviewCollateralTokenAccountV1>[0] &
  Readonly<{ callerPrefix?: Readonly<{ guardTokenAccounts: readonly Address[] }> }>): MimirBetaWalletGuardAccountsV1 {
  const source = mimirBetaReviewCollateralTokenAccountV1(review);
  if (!review.callerPrefix) return source;
  return { tokenAccounts: [...new Set([...(source ? [source] : []), ...review.callerPrefix.guardTokenAccounts])] };
}

function walletGuardSpec(guards: MimirBetaWalletGuardAccountsV1): { tokens: readonly Address[]; declared: boolean } {
  if (guards && typeof guards === "object") return { tokens: guards.tokenAccounts, declared: true };
  return { tokens: guards ? [guards] : [], declared: false };
}

/**
 * Fee-only, or fee-only plus the exact supplemental tail: one payer assertion followed by token-account assertions, each on a
 * distinct admitted token account. Legacy single-account form: multi-signer reviews, at most the reviewed burn source.
 * Declared form: any signer count, each target a writable non-signer key of the reviewed message.
 */
export function isMimirBetaWalletRewriteV1(reviewedMessage: Uint8Array, walletMessage: Uint8Array,
  collateralTokenAccount?: MimirBetaWalletGuardAccountsV1): boolean {
  return walletGuardTailLength(reviewedMessage, walletMessage, collateralTokenAccount) >= 0;
}

// Borsh 0.10: AssertAccountInfoMulti, FailedEncodedMessage, 3 assertions:
// Lamports >= u64; KnownOwner == System; DataLength == 0. Floor is supplemental.
function isPayerGuardData(data: ArrayLike<number>): boolean {
  return data.length === 26 && data[0] === 6 && data[1] === 5 && data[2] === 3 && data[3] === 0 &&
    data[12] === 4 && data[13] === 3 && data[14] === 0 && data[15] === 0 && data[16] === 1 &&
    Array.from(data).slice(17).every((byte) => byte === 0);
}

// Borsh 0.10: AssertTokenAccountMulti, FailedEncodedMessage, 6 assertions: OwnerIsDerived; Amount >= u64;
// Delegate == None; DelegatedAmount == 0; Owner == payer; CloseAuthority == None. Floor is supplemental.
const TOKEN_GUARD_HEAD = [10, 5, 6, 8, 2];
const TOKEN_GUARD_MIDDLE = [4, 3, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
const TOKEN_GUARD_TAIL = [0, 7, 0, 0];
function isTokenGuardData(data: ArrayLike<number>, payer: Address): boolean {
  const bytes = Array.from(data);
  const owner = Array.from(getAddressEncoder().encode(payer));
  return bytes.length === 64 && TOKEN_GUARD_HEAD.every((byte, index) => bytes[index] === byte) &&
    TOKEN_GUARD_MIDDLE.every((byte, index) => bytes[13 + index] === byte) &&
    owner.every((byte, index) => bytes[28 + index] === byte) && TOKEN_GUARD_TAIL.every((byte, index) => bytes[60 + index] === byte);
}

/** Number of admitted terminal guard instructions (0 for fee-only), or -1 when the rewrite is not admitted. */
function walletGuardTailLength(reviewedMessage: Uint8Array, walletMessage: Uint8Array,
  collateralTokenAccount?: MimirBetaWalletGuardAccountsV1): number {
  if (isMimirBetaFeeOnlyWalletRewriteV1(reviewedMessage, walletMessage)) return 0;
  const spec = walletGuardSpec(collateralTokenAccount);
  try {
    const reviewed = decodeStrictV1Message(reviewedMessage);
    const wallet = decodeStrictV1Message(walletMessage);
    if ((!spec.declared && reviewed.header.numSignerAccounts < 2) || reviewed.staticAccounts.includes(LIGHTHOUSE_ASSERTION_PROGRAM as Address)) return -1;
    const count = wallet.instructionHeaders.length;
    const guardAt = (index: number) => {
      const header = wallet.instructionHeaders[index];
      const payload = wallet.instructionPayloads[index];
      return header && payload && wallet.staticAccounts[header.programAccountIndex] === LIGHTHOUSE_ASSERTION_PROGRAM &&
        header.programAccountIndex >= wallet.staticAccounts.length - wallet.header.numReadonlyNonSignerAccounts &&
        payload.instructionAccountIndices.length === 1 ? { header, payload, target: payload.instructionAccountIndices[0]! } : null;
    };
    const payerGuard = (index: number) => {
      const guard = guardAt(index);
      return guard && guard.target === 0 && isPayerGuardData(guard.payload.instructionData) ? guard : null;
    };
    let first = count - 1;
    const guarded = new Set<Address>();
    while (first >= 0 && !payerGuard(first)) {
      const token = guardAt(first);
      const target = token ? wallet.staticAccounts[token.target]! : undefined;
      const at = target ? reviewed.staticAccounts.indexOf(target) : -1;
      const writable = at >= 0 && (!spec.declared ||
        at >= reviewed.header.numSignerAccounts && at < reviewed.staticAccounts.length - reviewed.header.numReadonlyNonSignerAccounts);
      if (!token || !target || !spec.tokens.includes(target) || guarded.has(target) || !writable ||
        !isTokenGuardData(token.payload.instructionData, wallet.staticAccounts[0]!)) return -1;
      guarded.add(target); first -= 1;
    }
    if (first < 0) return -1;
    const tail = count - first;
    const guardProgramIndex = wallet.instructionHeaders[count - 1]!.programAccountIndex;
    const remap = (index: number) => {
      if (index === guardProgramIndex) throw new Error("guard program is referenced by a core instruction");
      return index > guardProgramIndex ? index - 1 : index;
    };
    const kept = count - tail;
    const stripped: CompiledV1Message = {
      ...wallet,
      header: { ...wallet.header, numReadonlyNonSignerAccounts: wallet.header.numReadonlyNonSignerAccounts - 1 },
      numStaticAccounts: wallet.numStaticAccounts - 1,
      numInstructions: wallet.numInstructions - tail,
      staticAccounts: wallet.staticAccounts.filter((_, index) => index !== guardProgramIndex),
      instructionHeaders: wallet.instructionHeaders.slice(0, kept).map((entry) => ({
        ...entry, programAccountIndex: remap(entry.programAccountIndex),
      })),
      instructionPayloads: wallet.instructionPayloads.slice(0, kept).map((entry) => ({
        ...entry, instructionAccountIndices: entry.instructionAccountIndices.map(remap),
      })),
    };
    return isMimirBetaFeeOnlyWalletRewriteV1(reviewedMessage,
      new Uint8Array(getCompiledTransactionMessageEncoder().encode(stripped))) ? tail : -1;
  } catch { return -1; }
}

function isWalletFeeInstruction(programKey: string, accountCount: number, data: ArrayLike<number>): boolean {
  return programKey.startsWith(`${COMPUTE_BUDGET_PROGRAM}:`) && accountCount === 0 &&
    ((data[0] === 2 && data.length === 5) || (data[0] === 3 && data.length === 9));
}

function nonFeeInstructionIndexes(messageBytes: Uint8Array): number[] {
  const message = decodeStrictV1Message(messageBytes);
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = message.header;
  return message.instructionHeaders.flatMap((header, index) => {
    const account = message.staticAccounts[header.programAccountIndex];
    if (account === undefined) throw new Error("Account index out of range");
    const programIndex = header.programAccountIndex;
    const signer = programIndex < numSignerAccounts;
    const writable = signer ? programIndex < numSignerAccounts - numReadonlySignerAccounts
      : programIndex < message.staticAccounts.length - numReadonlyNonSignerAccounts;
    const payload = message.instructionPayloads[index]!;
    return isWalletFeeInstruction(`${account}:${signer ? "s" : ""}${writable ? "w" : ""}`,
      payload.instructionAccountIndices.length, payload.instructionData) ? [] : [index];
  });
}

/**
 * Maps each reviewed non-fee outer instruction index to its index in an admitted wallet rewrite;
 * throws unless the wallet message is such a rewrite.
 */
export function mimirBetaReviewedToWalletInstructionIndexesV1(reviewedMessage: Uint8Array, walletMessage: Uint8Array,
  collateralTokenAccount?: MimirBetaWalletGuardAccountsV1): ReadonlyMap<number, number> {
  const tail = walletGuardTailLength(reviewedMessage, walletMessage, collateralTokenAccount);
  if (tail < 0) throw new Error("wallet message is not an admitted rewrite of the review");
  const reviewed = nonFeeInstructionIndexes(reviewedMessage);
  const kept = decodeStrictV1Message(walletMessage).instructionHeaders.length - tail;
  const wallet = nonFeeInstructionIndexes(walletMessage).filter((index) => index < kept);
  if (reviewed.length !== wallet.length) throw new Error("non-fee instruction counts differ");
  return new Map(reviewed.map((index, position) => [index, wallet[position]!]));
}

function feeIndependentMessageView(messageBytes: Uint8Array): string[] {
  const message = decodeStrictV1Message(messageBytes);
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = message.header;
  const accountKey = (index: number) => {
    const account = message.staticAccounts[index];
    if (account === undefined) throw new Error("Account index out of range");
    const signer = index < numSignerAccounts;
    const writable = signer ? index < numSignerAccounts - numReadonlySignerAccounts
      : index < message.staticAccounts.length - numReadonlyNonSignerAccounts;
    return `${account}:${signer ? "s" : ""}${writable ? "w" : ""}`;
  };
  const view = [
    `lifetime:${message.lifetimeToken}`,
    `config:${message.configMask & ~WALLET_FEE_CONFIG_BITS}:${message.configValues.slice(
      message.configValues.length - [0b1000, 0b1_0000].filter((bit) => message.configMask & bit).length,
    ).map((value) => String(value.value)).join(",")}`,
    ...message.staticAccounts.flatMap((account, index) => account === COMPUTE_BUDGET_PROGRAM && accountKey(index).endsWith(":") ? [] : [`account:${accountKey(index)}`]),
  ];
  message.instructionHeaders.forEach((header, index) => {
    const program = accountKey(header.programAccountIndex);
    const payload = message.instructionPayloads[index]!;
    const data = payload.instructionData;
    if (isWalletFeeInstruction(program, payload.instructionAccountIndices.length, data)) return;
    view.push(`instruction:${program}:${payload.instructionAccountIndices.map(accountKey).join(",")}:${Array.from(data).join(",")}`);
  });
  return view;
}

/**
 * Reviewed message bytes recompiled from the durable review (fee payer, instructions with roles, config) at the
 * wallet's blockhash; fails closed unless they hash to the reviewed messageHash. The wallet key order is not used.
 */
export function mimirBetaReviewedMessageOfWalletV1(
  walletMessage: Uint8Array,
  review: Readonly<{
    requiredSigners: readonly Address[];
    instructions: readonly Readonly<{ programAddress: Address; accounts: readonly Readonly<{ address: Address; isSigner: boolean; isWritable: boolean }>[]; dataBase64: string }>[];
    packet: Readonly<{ config: MimirBetaTransactionV1Config }>;
    messageHash: string;
  }>,
): Uint8Array {
  const { lifetimeToken } = decodeStrictV1Message(walletMessage);
  const message: V1Message = {
    version: 1,
    feePayer: { address: address(review.requiredSigners[0]!) },
    lifetimeConstraint: { blockhash: blockhash(lifetimeToken), lastValidBlockHeight: 0n },
    instructions: review.instructions.map((instruction) => kitInstruction({ ...instruction, data: fromBase64(instruction.dataBase64) } as MimirBetaInstruction)),
    config: { ...review.packet.config, ...(review.packet.config.priorityFeeLamports === undefined ? {} : { priorityFeeLamports: BigInt(review.packet.config.priorityFeeLamports) }) },
  };
  const reviewed = new Uint8Array(compileTransaction(message).messageBytes);
  if (hex(sha256Sync(reviewed)) !== review.messageHash) throw new Error("reconstructed message differs from reviewed messageHash");
  return reviewed;
}

export const MIMIR_BETA_TRANSACTION_V1_FEATURE = address("txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL");
export const MIMIR_BETA_TRANSACTION_V1_FEATURE_OWNER = address("Feature111111111111111111111111111111111111");
export const MIMIR_BETA_TRANSACTION_V1_MAX_BYTES = 4_096;
export const MIMIR_BETA_TRANSACTION_V1_MAX_ACCOUNTS = 64;
export const MIMIR_BETA_TRANSACTION_V1_MAX_INSTRUCTIONS = 64;
export const MIMIR_BETA_TRANSACTION_V1_MAX_SIGNATURES = 12;
export const MIMIR_BETA_TRANSACTION_V1_CONFIG: MimirBetaTransactionV1Config = Object.freeze({
  computeUnitLimit: 1_400_000,
  loadedAccountsDataSizeLimit: 67_108_864,
} as const);
export const MIMIR_BETA_TRANSACTION_V1_MIN_MICRO_LAMPORTS_PER_CU = 10_000n;
export const MIMIR_BETA_TRANSACTION_V1_MIN_PRIORITY_FEE_LAMPORTS =
  (BigInt(MIMIR_BETA_TRANSACTION_V1_CONFIG.computeUnitLimit) * MIMIR_BETA_TRANSACTION_V1_MIN_MICRO_LAMPORTS_PER_CU + 999_999n) / 1_000_000n;

type V1Message = Extract<TransactionMessage, { version: 1 }> &
  TransactionMessageWithFeePayer & TransactionMessageWithBlockhashLifetime;

function failTooLarge(fact: string): never {
  return betaError("TRANSACTION_TOO_LARGE", `Transaction v1 exceeds ${fact}; no fallback or split is permitted`);
}

function kitRole(isSigner: boolean, isWritable: boolean): AccountRole {
  if (isSigner) return isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  return isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
}

function kitInstruction(instruction: MimirBetaInstruction): Instruction {
  return {
    programAddress: address(instruction.programAddress),
    accounts: instruction.accounts.map((account) => ({
      address: address(account.address),
      role: kitRole(account.isSigner, account.isWritable),
    })),
    data: new Uint8Array(instruction.data),
  };
}

function assertCaps(accountCount: number, instructionCount: number, signatureCount: number, bytes: number): void {
  if (accountCount > MIMIR_BETA_TRANSACTION_V1_MAX_ACCOUNTS) failTooLarge("64 accounts");
  if (instructionCount > MIMIR_BETA_TRANSACTION_V1_MAX_INSTRUCTIONS) failTooLarge("64 instructions");
  if (signatureCount > MIMIR_BETA_TRANSACTION_V1_MAX_SIGNATURES) failTooLarge("12 signatures");
  if (bytes > MIMIR_BETA_TRANSACTION_V1_MAX_BYTES) failTooLarge("4,096 serialized bytes");
}

function decodeCanonicalV1(bytes: Uint8Array, label: string): Transaction {
  if (!(bytes instanceof Uint8Array) || bytes[0] !== 0x81) {
    betaError("TRANSACTION_MALFORMED", `${label} is not a message-first Transaction v1`);
  }
  let decoded: Transaction;
  try { decoded = getTransactionDecoder().decode(bytes); }
  catch { return betaError("TRANSACTION_MALFORMED", `${label} is not canonical Transaction v1 bytes`); }
  const canonical = new Uint8Array(getTransactionEncoder().encode(decoded));
  if (!bytesEqual(canonical, bytes)) betaError("TRANSACTION_MALFORMED", `${label} serialization is non-canonical`);
  return decoded;
}

function signerAddresses(transaction: MimirBetaUnsignedTransaction): readonly Address[] {
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.serializedMessage);
  if (compiled.version !== 1 || compiled.header.numSignerAccounts !== transaction.requiredSigners.length) {
    betaError("TRANSACTION_MALFORMED", "reviewed Transaction v1 signer header is invalid");
  }
  return compiled.staticAccounts.slice(0, compiled.header.numSignerAccounts);
}

/**
 * D0: ComputeBudget opcodes 1-4 become TxV1 message config before hashing, caps, simulation, and review, with the runtime's
 * semantics: a duplicate opcode, a heap frame that is not a 1 KiB multiple in 32..256 KiB, or a zero loaded-data limit is an
 * error; CU and loaded-data limits clamp to their maxima; the unit price is priced against the translated CU limit.
 */
export function normalizeMimirBetaComputeBudgetV1(instructions: readonly MimirBetaInstruction[]): Readonly<{
  instructions: readonly MimirBetaInstruction[]; priorityFeeLamports?: bigint;
  computeUnitLimit?: number; loadedAccountsDataSizeLimit?: number; heapSize?: number;
}> {
  const seen = new Map<number, bigint>();
  const body = instructions.filter((ix) => {
    if (ix.programAddress !== COMPUTE_BUDGET_PROGRAM) return true;
    const d = ix.data; const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (ix.accounts.length !== 0) return betaError("TRANSACTION_MALFORMED", "ComputeBudget directive carries accounts");
    if (!(d[0]! >= 1 && d[0]! <= 4 && d.length === (d[0] === 3 ? 9 : 5))) {
      return betaError("TRANSACTION_MALFORMED", "unrecognized ComputeBudget directive has no Transaction v1 config");
    }
    if (seen.has(d[0]!)) return betaError("TRANSACTION_MALFORMED", "duplicate ComputeBudget directive");
    seen.set(d[0]!, d[0] === 3 ? v.getBigUint64(1, true) : BigInt(v.getUint32(1, true)));
    return false;
  });
  const heap = seen.get(1); const limit = seen.get(2); const price = seen.get(3); const loaded = seen.get(4);
  if (heap !== undefined && (heap % 1_024n !== 0n || heap < 32_768n || heap > 262_144n)) betaError("TRANSACTION_MALFORMED", "invalid ComputeBudget heap frame");
  if (loaded === 0n) betaError("TRANSACTION_MALFORMED", "invalid ComputeBudget loaded accounts data size limit");
  const max = MIMIR_BETA_TRANSACTION_V1_CONFIG;
  const computeUnitLimit = limit === undefined ? undefined : Math.min(Number(limit), max.computeUnitLimit);
  return { instructions: body,
    ...(computeUnitLimit !== undefined ? { computeUnitLimit } : {}),
    ...(loaded !== undefined ? { loadedAccountsDataSizeLimit: Math.min(Number(loaded), max.loadedAccountsDataSizeLimit) } : {}),
    ...(heap !== undefined ? { heapSize: Number(heap) } : {}),
    ...(price !== undefined ? { priorityFeeLamports: (BigInt(computeUnitLimit ?? max.computeUnitLimit) * price + 999_999n) / 1_000_000n } : {}) };
}

export async function compileMimirBetaTransactionV1(args: Readonly<{
  feePayer: Address;
  recentBlockhash: string;
  lastValidBlockHeight: bigint;
  instructions: readonly MimirBetaInstruction[];
  /** TxV1 message-config priority fee; raised to at least 10,000 µlamports per CU. */
  priorityFeeLamports?: bigint;
}>): Promise<MimirBetaUnsignedTransaction> {
  if (!Array.isArray(args.instructions) || args.instructions.length === 0) {
    betaError("INVALID_ARGUMENT", "unsigned step has no instructions");
  }
  const budget = normalizeMimirBetaComputeBudgetV1(args.instructions);
  const limits = { computeUnitLimit: budget.computeUnitLimit ?? MIMIR_BETA_TRANSACTION_V1_CONFIG.computeUnitLimit,
    loadedAccountsDataSizeLimit: budget.loadedAccountsDataSizeLimit ?? MIMIR_BETA_TRANSACTION_V1_CONFIG.loadedAccountsDataSizeLimit,
    ...(budget.heapSize !== undefined ? { heapSize: budget.heapSize } : {}) };
  args = { ...args, instructions: budget.instructions,
    ...(budget.priorityFeeLamports !== undefined && (args.priorityFeeLamports === undefined || budget.priorityFeeLamports > args.priorityFeeLamports)
      ? { priorityFeeLamports: budget.priorityFeeLamports } : {}) };
  if (args.instructions.length === 0) betaError("INVALID_ARGUMENT", "unsigned step has no instructions");
  if (args.instructions.length > MIMIR_BETA_TRANSACTION_V1_MAX_INSTRUCTIONS) failTooLarge("64 instructions");
  const accountAddresses = new Set<Address>([args.feePayer]);
  const signerAddresses = new Set<Address>([args.feePayer]);
  for (const instruction of args.instructions) {
    accountAddresses.add(instruction.programAddress);
    for (const account of instruction.accounts) {
      accountAddresses.add(account.address);
      if (account.isSigner) signerAddresses.add(account.address);
    }
  }
  assertCaps(accountAddresses.size, args.instructions.length, signerAddresses.size, 0);
  if (typeof args.lastValidBlockHeight !== "bigint" || args.lastValidBlockHeight < 0n) {
    betaError("INVALID_ARGUMENT", "last valid block height is invalid");
  }
  const fee = args.priorityFeeLamports;
  if (fee !== undefined && (typeof fee !== "bigint" || fee < 0n || fee >= 1n << 64n)) betaError("INVALID_ARGUMENT", "priority fee is invalid");
  const floor = mimirBetaMinPriorityFeeLamports(limits.computeUnitLimit);
  const config: MimirBetaTransactionV1Config = { ...limits, priorityFeeLamports: fee === undefined || fee < floor ? floor : fee };
  let message: V1Message;
  try {
    message = {
      version: 1,
      feePayer: { address: address(args.feePayer) },
      lifetimeConstraint: { blockhash: blockhash(args.recentBlockhash), lastValidBlockHeight: args.lastValidBlockHeight },
      instructions: args.instructions.map(kitInstruction),
      config,
    };
  } catch { return betaError("INVALID_ARGUMENT", "Transaction v1 input is malformed"); }
  let transaction: Transaction;
  try { transaction = compileTransaction(message); }
  catch { return betaError("PROGRAM_ABI_MISMATCH", "Transaction v1 message compilation failed"); }
  const serializedMessage = new Uint8Array(transaction.messageBytes);
  const serializedTransaction = new Uint8Array(getTransactionEncoder().encode(transaction));
  if (serializedMessage[0] !== 0x81 || serializedTransaction[0] !== 0x81) {
    betaError("PROGRAM_ABI_MISMATCH", "Kit did not produce message-first Transaction v1 bytes");
  }
  const compiled = getCompiledTransactionMessageDecoder().decode(serializedMessage);
  if (compiled.version !== 1) betaError("PROGRAM_ABI_MISMATCH", "compiled message is not Transaction v1");
  const requiredSigners = compiled.staticAccounts.slice(0, compiled.header.numSignerAccounts);
  assertCaps(compiled.numStaticAccounts, compiled.numInstructions, requiredSigners.length, serializedTransaction.length);
  if (serializedTransaction.length !== serializedMessage.length + requiredSigners.length * 64 ||
    !bytesEqual(serializedTransaction.subarray(0, serializedMessage.length), serializedMessage) ||
    serializedTransaction.subarray(serializedMessage.length).some((byte) => byte !== 0)) {
    betaError("PROGRAM_ABI_MISMATCH", "unsigned Transaction v1 signature vector is not fixed and trailing");
  }
  const packet: MimirBetaPacketProfile = {
    packetLimitBytes: MIMIR_BETA_TRANSACTION_V1_MAX_BYTES,
    serializedMessageBytes: serializedMessage.length,
    serializedTransactionBytes: serializedTransaction.length,
    accountCount: compiled.numStaticAccounts,
    instructionCount: compiled.numInstructions,
    signatureCount: requiredSigners.length,
    config,
    fitsPacketLimit: true,
  };
  return {
    messageVersion: 1,
    feePayer: args.feePayer,
    recentBlockhash: args.recentBlockhash,
    lastValidBlockHeight: args.lastValidBlockHeight,
    instructions: args.instructions,
    requiredSigners,
    serializedMessage,
    serializedTransaction,
    messageHash: hex(await sha256(serializedMessage)),
    config,
    packet,
  };
}

export async function partiallySignMimirBetaTransactionV1(args: Readonly<{
  transaction: MimirBetaUnsignedTransaction;
  signerAddress: Address;
  keyPair: CryptoKeyPair;
}>): Promise<Readonly<{ serializedTransaction: Uint8Array; signature: MimirBetaSignerSignature }>> {
  const expected = signerAddresses(args.transaction);
  if (!expected.includes(args.signerAddress)) betaError("RECEIPT_MISMATCH", "local signer is not required by the reviewed message");
  let derived: Address;
  try { derived = await getAddressFromPublicKey(args.keyPair.publicKey); }
  catch { return betaError("INVALID_ARGUMENT", "asset CryptoKeyPair is invalid"); }
  if (derived !== args.signerAddress) betaError("RECEIPT_MISMATCH", "asset CryptoKeyPair address differs from reviewed signer");
  const decoded = decodeCanonicalV1(args.transaction.serializedTransaction, "partial-sign input");
  if (!bytesEqual(new Uint8Array(decoded.messageBytes), args.transaction.serializedMessage)) {
    betaError("RECEIPT_MISMATCH", "partial-sign input message differs from review");
  }
  const normalized = {
    ...decoded,
    messageBytes: new Uint8Array(decoded.messageBytes) as unknown as typeof decoded.messageBytes,
    signatures: { ...decoded.signatures },
  };
  const signed = await partiallySignTransaction([args.keyPair], normalized);
  const signature = signed.signatures[address(args.signerAddress)];
  if (!signature) betaError("RECEIPT_MISMATCH", "asset signer produced no signature");
  const serializedTransaction = new Uint8Array(getTransactionEncoder().encode(signed));
  assertCaps(args.transaction.packet.accountCount, args.transaction.packet.instructionCount,
    args.transaction.packet.signatureCount, serializedTransaction.length);
  return { serializedTransaction, signature: { address: args.signerAddress, signature: new Uint8Array(signature) } };
}

export interface MimirBetaWalletAdmissionV1 {
  readonly serializedMessage: Uint8Array;
  readonly messageHash: string;
  readonly walletAddress: Address;
  readonly requiredSigners: readonly Address[];
}

async function admitWalletMessage(args: Readonly<{ transaction: MimirBetaUnsignedTransaction; walletAddress: Address;
  walletSignedTransaction: Uint8Array; collateralTokenAccount?: MimirBetaWalletGuardAccountsV1 }>) {
  const expected = signerAddresses(args.transaction);
  if (args.walletAddress !== args.transaction.feePayer || expected[0] !== args.walletAddress) {
    betaError("RECEIPT_MISMATCH", "wallet is not the reviewed Transaction v1 fee payer");
  }
  const decoded = decodeCanonicalV1(args.walletSignedTransaction, "wallet result");
  const walletMessage = new Uint8Array(decoded.messageBytes);
  let walletCompiled: CompiledV1Message;
  try { walletCompiled = getCompiledTransactionMessageDecoder().decode(walletMessage) as CompiledV1Message; }
  catch { return betaError("RECEIPT_MISMATCH", "wallet changed the reviewed Transaction v1 message"); }
  assertCaps(walletCompiled.staticAccounts.length, walletCompiled.instructionHeaders.length,
    walletCompiled.header.numSignerAccounts, args.walletSignedTransaction.length);
  if (!isMimirBetaWalletRewriteV1(args.transaction.serializedMessage, walletMessage, args.collateralTokenAccount)) {
    betaError("RECEIPT_MISMATCH", "wallet changed the reviewed Transaction v1 message");
  }
  const walletSignature = decoded.signatures[address(args.walletAddress)];
  if (!walletSignature || !(await verifySignature(await getPublicKeyFromAddress(address(args.walletAddress)), signatureBytes(new Uint8Array(walletSignature)), walletMessage))) {
    betaError("RECEIPT_MISMATCH", `Transaction v1 signature is invalid for ${args.walletAddress}`);
  }
  return { expected, decoded, walletMessage, rewritten: !bytesEqual(walletMessage, args.transaction.serializedMessage) };
}

/** Wallet-only admission of a returned wire: exact reviewed rewrite and wallet signature, every local slot still empty; never signs. */
export async function admitMimirBetaWalletSignedTransactionV1(args: Readonly<{
  transaction: MimirBetaUnsignedTransaction;
  walletAddress: Address;
  walletSignedTransaction: Uint8Array;
  collateralTokenAccount?: MimirBetaWalletGuardAccountsV1;
}>): Promise<MimirBetaWalletAdmissionV1> {
  const { expected, decoded, walletMessage } = await admitWalletMessage(args);
  const returned = Object.keys(decoded.signatures) as Address[];
  if (returned.length !== expected.length || returned.some((value, index) => value !== expected[index])) {
    betaError("RECEIPT_MISMATCH", "wallet changed the ordered Transaction v1 signer vector");
  }
  if (expected.slice(1).some((signer) => decoded.signatures[address(signer)])) {
    betaError("RECEIPT_MISMATCH", "wallet filled a local signer slot");
  }
  return Object.freeze({ serializedMessage: walletMessage, messageHash: hex(await sha256(walletMessage)),
    walletAddress: args.walletAddress, requiredSigners: Object.freeze([...expected]) });
}

/** Ordered all-or-nothing admission of one wallet batch: output i must admit against review i and its own collateral account. */
export async function admitMimirBetaWalletSignedBatchV1(args: Readonly<{
  walletAddress: Address;
  reviews: readonly Readonly<{ transaction: MimirBetaUnsignedTransaction; collateralTokenAccount?: MimirBetaWalletGuardAccountsV1 }>[];
  walletSignedTransactions: readonly Uint8Array[];
}>): Promise<readonly MimirBetaWalletAdmissionV1[]> {
  if (!args.reviews.length || args.walletSignedTransactions.length !== args.reviews.length) {
    betaError("RECEIPT_MISMATCH", "wallet batch output count differs from the reviewed inputs");
  }
  const admitted: MimirBetaWalletAdmissionV1[] = [];
  for (const [index, review] of args.reviews.entries()) {
    admitted.push(await admitMimirBetaWalletSignedTransactionV1({ ...review, walletAddress: args.walletAddress,
      walletSignedTransaction: args.walletSignedTransactions[index]! }));
  }
  if (new Set(admitted.map(({ messageHash }) => messageHash)).size !== admitted.length) betaError("RECEIPT_MISMATCH", "wallet batch repeats a message");
  return Object.freeze(admitted);
}

export async function verifyMimirBetaWalletSignedTransactionV1(args: Readonly<{
  transaction: MimirBetaUnsignedTransaction;
  walletAddress: Address;
  walletSignedTransaction: Uint8Array;
  preservedSignatures: readonly MimirBetaSignerSignature[];
  /** Local identities completed only on the admitted final wallet message; empty preserved evidence supports wallet-first. */
  localSigners?: readonly Readonly<{ address: Address; keyPair: CryptoKeyPair }>[];
  /** Token accounts supplemental wallet token-account assertions may target: the reviewed burn source, or a declared set. */
  collateralTokenAccount?: MimirBetaWalletGuardAccountsV1;
}>): Promise<Readonly<{
  serializedTransaction: Uint8Array;
  /** The wallet message is the record: receipts and reconciliation bind these bytes and hash. */
  serializedMessage: Uint8Array;
  messageHash: string;
  firstSignature: string;
  signatures: readonly Readonly<{ address: Address; signature: Uint8Array; signatureBase58: string }>[];
}>> {
  const expected = signerAddresses(args.transaction);
  if (args.walletAddress !== args.transaction.feePayer || expected[0] !== args.walletAddress) {
    betaError("RECEIPT_MISMATCH", "wallet is not the reviewed Transaction v1 fee payer");
  }
  if (new Set(args.preservedSignatures.map((entry) => entry.address)).size !== args.preservedSignatures.length ||
    args.preservedSignatures.some((entry) => entry.address === args.walletAddress || !expected.includes(entry.address) || entry.signature.length !== 64)) {
    betaError("RECEIPT_MISMATCH", "preserved signature evidence is invalid");
  }
  const admitted = await admitWalletMessage(args);
  let { decoded } = admitted;
  const { walletMessage, rewritten } = admitted;
  if ((rewritten || args.preservedSignatures.length === 0) && args.localSigners?.length) {
    if (args.localSigners.some((entry) => entry.address === args.walletAddress || !expected.includes(entry.address))) {
      betaError("RECEIPT_MISMATCH", "local signer is not required by the reviewed message");
    }
    if (new Set(args.localSigners.map((entry) => entry.address)).size !== args.localSigners.length) {
      betaError("RECEIPT_MISMATCH", "duplicate local signer");
    }
    if (args.preservedSignatures.length === 0 && args.localSigners.some((entry) => decoded.signatures[entry.address])) {
      betaError("RECEIPT_MISMATCH", "wallet filled a local signer slot");
    }
    for (const entry of args.localSigners) {
      let derived: Address;
      try { derived = await getAddressFromPublicKey(entry.keyPair.publicKey); }
      catch { return betaError("INVALID_ARGUMENT", "asset CryptoKeyPair is invalid"); }
      if (derived !== entry.address) betaError("RECEIPT_MISMATCH", "asset CryptoKeyPair address differs from reviewed signer");
    }
    decoded = await partiallySignTransaction(args.localSigners.map((entry) => entry.keyPair), {
      ...decoded,
      messageBytes: walletMessage as unknown as typeof decoded.messageBytes,
      signatures: { ...decoded.signatures },
    });
  }
  const returned = Object.keys(decoded.signatures) as Address[];
  if (returned.length !== expected.length || returned.some((value, index) => value !== expected[index])) {
    betaError("RECEIPT_MISMATCH", "wallet changed the ordered Transaction v1 signer vector");
  }
  const evidence = [] as Array<Readonly<{ address: Address; signature: Uint8Array; signatureBase58: string }>>;
  for (const signer of expected) {
    const value = decoded.signatures[address(signer)];
    if (!value) betaError("RECEIPT_MISMATCH", `wallet result is missing signature ${signer}`);
    const bytes = new Uint8Array(value);
    const preserved = args.preservedSignatures.find((entry) => entry.address === signer);
    if (preserved && !rewritten && !bytesEqual(bytes, preserved.signature)) {
      betaError("RECEIPT_MISMATCH", `wallet mutated preserved signature ${signer}`);
    }
    const publicKey = await getPublicKeyFromAddress(address(signer));
    if (!(await verifySignature(publicKey, signatureBytes(bytes), walletMessage))) {
      betaError("RECEIPT_MISMATCH", `Transaction v1 signature is invalid for ${signer}`);
    }
    evidence.push({ address: signer, signature: bytes, signatureBase58: bs58.encode(bytes) });
  }
  if (args.preservedSignatures.some((entry) => !evidence.some((proof) => proof.address === entry.address))) {
    betaError("RECEIPT_MISMATCH", "preserved signature evidence is incomplete");
  }
  return {
    serializedTransaction: new Uint8Array(getTransactionEncoder().encode(decoded)),
    serializedMessage: walletMessage,
    messageHash: hex(await sha256(walletMessage)),
    firstSignature: evidence[0]!.signatureBase58,
    signatures: evidence,
  };
}
