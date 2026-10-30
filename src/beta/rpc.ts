import { address, type Address } from "@solana/kit";
import { cohortClockRetryWait, COHORT_NOT_CONVERGED, isMimirBetaCohortNotConverged, MAX_COHORT_ATTEMPTS, MAX_MULTIPLE_ACCOUNTS, readCoherentPartitions, requireChunkLength } from "../chunkedAccounts.js";
import bs58 from "bs58";
import { base64 as toBase64, bytesEqual, canonicalJson, fromBase64 } from "./bytes.js";
import { getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder } from "@solana/transaction-messages";
import { getTransactionDecoder, getTransactionEncoder } from "@solana/transactions";
import { betaError } from "./errors.js";
import { MIMIR_BETA_SYSTEM_PROGRAM_ID } from "./deployment.js";
import type {
  MimirBetaAccount,
  MimirBetaCompiledInnerInstruction,
  MimirBetaContext,
  MimirBetaFinalizedMeta,
  MimirBetaFinalizedTransactionEvidence,
  MimirBetaTokenBalanceEvidence,
} from "./types.js";

type Pending<T> = { send(): Promise<T> };

export interface MimirBetaFinalizedRpc {
  getAccountInfo(address: Address, config: object): Pending<unknown>;
  getMultipleAccounts(addresses: readonly Address[], config: object): Pending<unknown>;
}

export interface MimirBetaReconciliationRpc extends MimirBetaFinalizedRpc {
  getTransaction(signature: string, config: Readonly<{
    commitment: "confirmed" | "finalized";
    encoding: "base64";
    maxSupportedTransactionVersion: 1;
  }>): Pending<unknown>;
  isBlockhashValid?(blockhash: string, config: Readonly<{ commitment: "confirmed" | "finalized" }>): Pending<unknown>;
  getSignatureStatuses?(signatures: readonly [string], config: Readonly<{ searchTransactionHistory: true }>): Pending<unknown>;
  getFirstAvailableBlock?(): Pending<unknown>;
}

export interface MimirBetaSignatureStatus {
  readonly slot: bigint;
  readonly confirmationStatus: "processed" | "confirmed" | "finalized";
}

function reconciliationContext(value: unknown): { readonly slot: bigint; readonly value: unknown } {
  if (!value || typeof value !== "object") betaError("RPC_CONTEXT_MISMATCH", "RPC context response malformed");
  const record = value as Record<string, unknown>;
  const context = record.context;
  if (!context || typeof context !== "object") betaError("RPC_CONTEXT_MISMATCH", "RPC context missing");
  const slot = (context as Record<string, unknown>).slot;
  if (!((typeof slot === "bigint" && slot >= 0n) || (typeof slot === "number" && Number.isSafeInteger(slot) && slot >= 0))) {
    betaError("RPC_CONTEXT_MISMATCH", "RPC context slot is not an unsigned integer");
  }
  return { slot: BigInt(slot), value: record.value };
}

export function decodeMimirBetaBlockhashValidityResponse(value: unknown): { readonly slot: bigint; readonly valid: boolean } {
  const decoded = reconciliationContext(value);
  if (typeof decoded.value !== "boolean") transactionMalformed("isBlockhashValid result malformed");
  return { slot: decoded.slot, valid: decoded.value };
}

export function decodeMimirBetaSignatureStatusResponse(value: unknown): { readonly slot: bigint; readonly status: MimirBetaSignatureStatus | null } {
  const decoded = reconciliationContext(value);
  if (!Array.isArray(decoded.value) || decoded.value.length !== 1) transactionMalformed("getSignatureStatuses result cardinality malformed");
  const status = decoded.value[0];
  if (status === null) return { slot: decoded.slot, status: null };
  if (!status || typeof status !== "object") transactionMalformed("signature status malformed");
  const record = status as Record<string, unknown>;
  const confirmationStatus = record.confirmationStatus;
  if (confirmationStatus !== "processed" && confirmationStatus !== "confirmed" && confirmationStatus !== "finalized") {
    transactionMalformed("signature confirmation status malformed");
  }
  const statusSlot = transactionBigint(record.slot, "signature status slot");
  if (record.confirmations !== null) transactionBigint(record.confirmations, "signature confirmations");
  if (!(record.err === null || typeof record.err === "object")) transactionMalformed("signature status fields malformed");
  return { slot: decoded.slot, status: { slot: statusSlot, confirmationStatus } };
}

function bigintValue(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  betaError("ACCOUNT_MALFORMED", `${label} is not an integer`);
}

function transactionMalformed(message: string): never {
  return betaError("TRANSACTION_MALFORMED", message);
}

function transactionBigint(value: unknown, label: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return transactionMalformed(`${label} is not an unsigned integer`);
}

function transactionAddress(value: unknown, label: string): Address {
  if (typeof value !== "string") return transactionMalformed(`${label} is not an address`);
  try { return address(value); } catch { return transactionMalformed(`${label} is not an address`); }
}

function rawTransactionEnvelope(transactionBytes: Uint8Array): {
  readonly messageBytes: Uint8Array;
  readonly signatures: readonly string[];
  readonly staticAccountKeys: readonly Address[];
} {
  if (transactionBytes[0] !== 0x81 || transactionBytes.length > 4096) {
    transactionMalformed("only strict message-first Transaction v1 is supported");
  }
  let transaction;
  try { transaction = getTransactionDecoder().decode(transactionBytes); }
  catch { return transactionMalformed("Transaction v1 wire is malformed"); }
  if (!bytesEqual(new Uint8Array(getTransactionEncoder().encode(transaction)), transactionBytes)) {
    transactionMalformed("Transaction v1 wire is non-canonical");
  }
  const messageBytes = new Uint8Array(transaction.messageBytes);
  const message = getCompiledTransactionMessageDecoder().decode(messageBytes);
  if (message.version !== 1 || message.numStaticAccounts < 1 || message.numStaticAccounts > 64 ||
    message.numInstructions > 64 || message.header.numSignerAccounts < 1 || message.header.numSignerAccounts > 12 ||
    transactionBytes.length !== messageBytes.length + message.header.numSignerAccounts * 64) {
    transactionMalformed("Transaction v1 message/count envelope is invalid");
  }
  const staticAccountKeys = message.staticAccounts;
  const signatures = staticAccountKeys.slice(0, message.header.numSignerAccounts).map((signer) => {
    const signature = transaction.signatures[signer];
    if (!signature) return transactionMalformed("finalized Transaction v1 has a missing signature");
    return bs58.encode(new Uint8Array(signature));
  });
  return { messageBytes, signatures, staticAccountKeys };
}

function tokenBalances(value: unknown, label: string): readonly MimirBetaTokenBalanceEvidence[] {
  if (!Array.isArray(value)) return transactionMalformed(`${label} is not an array`);
  const seen = new Set<number>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") return transactionMalformed(`${label}[${index}] is malformed`);
    const record = entry as Record<string, unknown>;
    const ui = record.uiTokenAmount;
    if (!ui || typeof ui !== "object") return transactionMalformed(`${label}[${index}] token amount is malformed`);
    const amount = (ui as Record<string, unknown>).amount;
    const decimals = (ui as Record<string, unknown>).decimals;
    if (typeof record.accountIndex !== "number" || !Number.isSafeInteger(record.accountIndex) || record.accountIndex < 0 ||
      seen.has(record.accountIndex) || typeof amount !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(amount) ||
      typeof decimals !== "number" || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
      return transactionMalformed(`${label}[${index}] fields are malformed`);
    }
    seen.add(record.accountIndex);
    return {
      accountIndex: record.accountIndex,
      mint: transactionAddress(record.mint, `${label}[${index}].mint`),
      owner: record.owner === undefined ? null : transactionAddress(record.owner, `${label}[${index}].owner`),
      programId: transactionAddress(record.programId, `${label}[${index}].programId`),
      amountRaw: BigInt(amount),
      decimals,
    };
  });
}

function byteIndexes(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < 0 || entry > 255)) {
    return transactionMalformed(`${label} is not a byte-index array`);
  }
  return value as number[];
}

function innerInstruction(value: unknown, label: string): MimirBetaCompiledInnerInstruction {
  if (!value || typeof value !== "object") return transactionMalformed(`${label} is malformed`);
  const record = value as Record<string, unknown>;
  if (typeof record.programIdIndex !== "number" || !Number.isSafeInteger(record.programIdIndex) ||
    record.programIdIndex < 0 || record.programIdIndex > 255 || typeof record.data !== "string") {
    return transactionMalformed(`${label} fields are malformed`);
  }
  let data: Uint8Array;
  try { data = Uint8Array.from(bs58.decode(record.data)); }
  catch { return transactionMalformed(`${label}.data is not base58`); }
  return { programIdIndex: record.programIdIndex, accountIndexes: byteIndexes(record.accounts, `${label}.accounts`), data };
}

function finalizedMeta(value: unknown): MimirBetaFinalizedMeta {
  if (!value || typeof value !== "object") return transactionMalformed("finalized meta is missing");
  const record = value as Record<string, unknown>;
  const preBalances = Array.isArray(record.preBalances) ? record.preBalances.map((entry) => transactionBigint(entry, "pre balance")) : transactionMalformed("pre balances missing");
  const postBalances = Array.isArray(record.postBalances) ? record.postBalances.map((entry) => transactionBigint(entry, "post balance")) : transactionMalformed("post balances missing");
  const loaded = record.loadedAddresses;
  if (!loaded || typeof loaded !== "object") return transactionMalformed("loaded addresses missing");
  const loadedRecord = loaded as Record<string, unknown>;
  const writable = Array.isArray(loadedRecord.writable) ? loadedRecord.writable.map((entry, index) => transactionAddress(entry, `loaded writable ${index}`)) : transactionMalformed("loaded writable addresses missing");
  const readonly = Array.isArray(loadedRecord.readonly) ? loadedRecord.readonly.map((entry, index) => transactionAddress(entry, `loaded readonly ${index}`)) : transactionMalformed("loaded readonly addresses missing");
  if (writable.length !== 0 || readonly.length !== 0) transactionMalformed("Transaction v1 cannot carry loaded addresses");
  const innerRaw = record.innerInstructions === null ? [] : record.innerInstructions;
  if (!Array.isArray(innerRaw)) return transactionMalformed("inner instructions missing");
  const groupIndexes = new Set<number>();
  const innerInstructions = innerRaw.map((entry, groupIndex) => {
    if (!entry || typeof entry !== "object") return transactionMalformed(`inner group ${groupIndex} malformed`);
    const group = entry as Record<string, unknown>;
    if (typeof group.index !== "number" || !Number.isSafeInteger(group.index) || group.index < 0 || group.index > 255 ||
      groupIndexes.has(group.index) || !Array.isArray(group.instructions)) return transactionMalformed(`inner group ${groupIndex} fields malformed`);
    groupIndexes.add(group.index);
    return { outerInstructionIndex: group.index, instructions: group.instructions.map((ix, index) => innerInstruction(ix, `inner group ${groupIndex} instruction ${index}`)) };
  });
  let err: string | null;
  try { err = record.err === null ? null : canonicalJson(record.err as never); }
  catch { return transactionMalformed("transaction error is not canonicalizable"); }
  return {
    err,
    fee: transactionBigint(record.fee, "fee"),
    preBalances,
    postBalances,
    preTokenBalances: tokenBalances(record.preTokenBalances, "pre token balances"),
    postTokenBalances: tokenBalances(record.postTokenBalances, "post token balances"),
    loadedAddresses: { writable, readonly },
    innerInstructions,
  };
}

export function decodeMimirBetaFinalizedTransactionResponse(
  signature: string,
  value: unknown,
): MimirBetaFinalizedTransactionEvidence | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") return transactionMalformed("getTransaction response malformed");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 && record.version !== 1n) transactionMalformed("finalized transaction is not Transaction v1");
  const wire = record.transaction;
  if (!Array.isArray(wire) || wire.length !== 2 || wire[1] !== "base64" || typeof wire[0] !== "string") {
    return transactionMalformed("finalized transaction is not canonical base64");
  }
  let transactionBytes: Uint8Array;
  try { transactionBytes = fromBase64(wire[0]); }
  catch { return transactionMalformed("finalized transaction base64 is invalid"); }
  const envelope = rawTransactionEnvelope(transactionBytes);
  const meta = finalizedMeta(record.meta);
  const resolvedAccountKeys = [...envelope.staticAccountKeys, ...meta.loadedAddresses.writable, ...meta.loadedAddresses.readonly];
  const blockTime = record.blockTime === null ? null : transactionBigint(record.blockTime, "block time");
  return {
    signature,
    slot: transactionBigint(record.slot, "transaction slot"),
    blockTime,
    version: 1,
    transactionBytes,
    messageBytes: envelope.messageBytes,
    signatures: envelope.signatures,
    resolvedAccountKeys,
    meta,
  };
}

function legacyInstructionsEqual(v1: Extract<ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>, { version: 1 }>,
  legacy: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>): boolean {
  if (legacy.version === 1 || !("instructions" in legacy) || legacy.instructions.length !== v1.instructionHeaders.length) return false;
  return legacy.instructions.every((instruction, index) => {
    const header = v1.instructionHeaders[index]!, payload = v1.instructionPayloads[index]!;
    return instruction.programAddressIndex === header.programAccountIndex &&
      canonicalJson([...(instruction.accountIndices ?? [])] as never) === canonicalJson([...payload.instructionAccountIndices] as never) &&
      bytesEqual(new Uint8Array(instruction.data ?? []), new Uint8Array(payload.instructionData));
  });
}

/** Rebuilds the canonical Transaction v1 wire from an RPC answer that re-encoded it as legacy, bound to the receipt's signed message. */
async function legacyAsReceiptV1Wire(signature: string, legacyWire: Uint8Array, receiptMessage: Uint8Array): Promise<Uint8Array> {
  let legacyTransaction, legacy, v1;
  try {
    legacyTransaction = getTransactionDecoder().decode(legacyWire);
    legacy = getCompiledTransactionMessageDecoder().decode(new Uint8Array(legacyTransaction.messageBytes));
    v1 = getCompiledTransactionMessageDecoder().decode(receiptMessage);
  } catch { return transactionMalformed("legacy transaction or receipt message is malformed"); }
  if (!bytesEqual(new Uint8Array(getTransactionEncoder().encode(legacyTransaction)), legacyWire) || legacy.version !== "legacy" ||
    !bytesEqual(new Uint8Array(getCompiledTransactionMessageEncoder().encode(legacy)), new Uint8Array(legacyTransaction.messageBytes)) || v1.version !== 1 ||
    !bytesEqual(new Uint8Array(getCompiledTransactionMessageEncoder().encode(v1)), receiptMessage)) {
    transactionMalformed("legacy transaction or receipt message encoding is unsupported");
  }
  if (canonicalJson(legacy.header as never) !== canonicalJson(v1.header as never) || legacy.staticAccounts.join() !== v1.staticAccounts.join() ||
    legacy.lifetimeToken !== v1.lifetimeToken || !legacyInstructionsEqual(v1, legacy)) {
    transactionMalformed("legacy transaction differs from the receipt Transaction v1 message");
  }
  const signers = v1.staticAccounts.slice(0, v1.header.numSignerAccounts);
  const signatures = signers.map((signer) => legacyTransaction.signatures[signer]);
  if (signatures.length < 1 || Object.keys(legacyTransaction.signatures).join() !== signers.join() ||
    signatures.some((entry) => !entry || entry.length !== 64) || bs58.encode(new Uint8Array(signatures[0]!)) !== signature) {
    transactionMalformed("legacy transaction signatures do not match the receipt signer order");
  }
  for (const [index, signer] of signers.entries()) {
    let valid = false;
    try {
      const key = await crypto.subtle.importKey("raw", new Uint8Array(bs58.decode(signer)), { name: "Ed25519" }, false, ["verify"]);
      valid = await crypto.subtle.verify("Ed25519", key, new Uint8Array(signatures[index]!), new Uint8Array(receiptMessage));
    } catch { valid = false; }
    if (!valid) transactionMalformed("legacy transaction signature does not verify over the receipt Transaction v1 message");
  }
  const wire = new Uint8Array(receiptMessage.length + signatures.length * 64);
  wire.set(receiptMessage);
  signatures.forEach((entry, index) => wire.set(new Uint8Array(entry!), receiptMessage.length + index * 64));
  return wire;
}

/** As decodeMimirBetaFinalizedTransactionResponse; a `legacy` answer is verified against the stored signed receipt message, never relabelled. */
export async function decodeMimirBetaReceiptTransactionResponse(
  signature: string,
  value: unknown,
  receiptMessage: Uint8Array,
): Promise<MimirBetaFinalizedTransactionEvidence | null> {
  if (!value || typeof value !== "object" || (value as Record<string, unknown>).version !== "legacy") {
    return decodeMimirBetaFinalizedTransactionResponse(signature, value);
  }
  const record = value as Record<string, unknown>;
  const wire = record.transaction;
  if (!Array.isArray(wire) || wire.length !== 2 || wire[1] !== "base64" || typeof wire[0] !== "string") {
    return transactionMalformed("finalized transaction is not canonical base64");
  }
  let legacyWire: Uint8Array;
  try { legacyWire = fromBase64(wire[0]); }
  catch { return transactionMalformed("finalized transaction base64 is invalid"); }
  const v1Wire = await legacyAsReceiptV1Wire(signature, legacyWire, receiptMessage);
  return decodeMimirBetaFinalizedTransactionResponse(signature, { ...record, version: 1, transaction: [toBase64(v1Wire), "base64"] });
}

export function decodeMimirBetaRpcAccount(accountAddress: Address, value: unknown): MimirBetaAccount | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") betaError("ACCOUNT_MALFORMED", "RPC account shape invalid");
  const record = value as Record<string, unknown>;
  const data = record.data;
  const bytes = mimirBetaRpcAccountBytes(data);
  if (bytes === undefined) betaError("ACCOUNT_MALFORMED", "RPC account data is not base64");
  if (typeof record.owner !== "string" || typeof record.executable !== "boolean") {
    betaError("ACCOUNT_MALFORMED", "RPC owner/executable invalid");
  }
  let owner: Address;
  try { owner = address(record.owner); }
  catch { betaError("ACCOUNT_MALFORMED", "RPC account owner is not a valid address"); }
  return {
    address: accountAddress,
    owner,
    executable: record.executable,
    lamports: bigintValue(record.lamports, "lamports"),
    data: bytes,
  };
}

export function mimirBetaRpcAccountBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) return data;
  if (!Array.isArray(data) || data.length !== 2 || data[1] !== "base64" || typeof data[0] !== "string") return undefined;
  return fromBase64(data[0]);
}

export function decodeMimirBetaCaptureRpcAccount(address: Address, value: unknown): MimirBetaAccount {
  if (value === null) {
    return { address, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false, lamports: 0n, data: new Uint8Array() };
  }
  const account = decodeMimirBetaRpcAccount(address, value);
  if (account === null) betaError("ACCOUNT_MALFORMED", "RPC capture account is null");
  return account;
}

function contextRecord(value: unknown): { slot: bigint; value: unknown } {
  if (!value || typeof value !== "object") betaError("ACCOUNT_MALFORMED", "RPC context missing");
  const record = value as Record<string, unknown>;
  const context = record.context;
  if (!context || typeof context !== "object") betaError("ACCOUNT_MALFORMED", "RPC context missing");
  return {
    slot: bigintValue((context as Record<string, unknown>).slot, "context slot"),
    value: record.value,
  };
}

export class FinalizedRpcReader {
  constructor(readonly rpc: MimirBetaFinalizedRpc, readonly commitment: "confirmed" | "finalized" = "finalized") {}

  async account(address: Address, minContextSlot?: bigint): Promise<MimirBetaContext<MimirBetaAccount | null>> {
    const response = contextRecord(await this.rpc.getAccountInfo(address, {
      commitment: this.commitment,
      encoding: "base64",
      ...(minContextSlot === undefined ? {} : { minContextSlot }),
    }).send());
    if (minContextSlot !== undefined && response.slot < minContextSlot) betaError("RPC_CONTEXT_MISMATCH", "context regressed");
    return { slot: response.slot, value: decodeMimirBetaRpcAccount(address, response.value), addresses: [address] };
  }

  async accounts(addresses: readonly Address[], minContextSlot?: bigint): Promise<MimirBetaContext<readonly (MimirBetaAccount | null)[]>> {
    return readMimirBetaAccountCohort(this.rpc, addresses, this.commitment, minContextSlot);
  }
}

/** @internal Explicit-commitment coherent reader for unsigned preparation only. */
/** Pinned source ProgramData accounts: refresh preparation reads only the 45-byte header (deploy slot and upgrade authority). */
export const MIMIR_BETA_HEADER_ONLY_PROGRAM_DATA: ReadonlySet<Address> = new Set([
  "DMawCQzbgNTmbzaESc7o6pvL1KAeetY8zA7jNpzntHhU", "AUh8bm2XsMfex3KjYGcM3G4uBqUNSDw6HEhWaWMYnyPH",
  "CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD", "HZcJwcJ2njPDxZtpPoKnF8v2w9QAx2rS7TdJPSRkbEhu",
  "A7ZG7ByDi8DpzT9Ab7CiXhvgYTJQmaDPJkMDoPitaCQV", "6naEzKeUuFh1Jeeu51NXQgr5qkXgXtc9WKNct4xynVJc",
  "3KvTa2fYhMxMZNfHho5oX34yLQLwRauoU2JScBkugvXF",
] as Address[]);

/** Byte slice a standalone `readAccount` may request for `address`: the 45-byte header of pinned venue ProgramData, otherwise none. */
export function mimirBetaStandaloneDataSlice(address: Address): Readonly<{ offset: 0; length: 45 }> | undefined {
  return MIMIR_BETA_HEADER_ONLY_PROGRAM_DATA.has(address) ? { offset: 0, length: 45 } : undefined;
}

const CLOCK_ADDRESS = "SysvarC1ock11111111111111111111111111111111" as Address;
const MAX_COHORT_PREFIX_BYTES = 65_536;

export async function readMimirBetaAccountCohort(rpc: MimirBetaFinalizedRpc, addresses: readonly Address[],
  commitment: "confirmed" | "finalized", minContextSlot?: bigint, fullEnvelopes = false): Promise<MimirBetaContext<readonly (MimirBetaAccount | null)[]>> {
  if (new Set(addresses).size !== addresses.length) betaError("INVALID_ARGUMENT", "duplicate coherent-read address");
  const headers = addresses.filter((entry) => !fullEnvelopes && MIMIR_BETA_HEADER_ONLY_PROGRAM_DATA.has(entry));
  const full = addresses.filter((entry) => fullEnvelopes || !MIMIR_BETA_HEADER_ONLY_PROGRAM_DATA.has(entry));
  let observed = minContextSlot, fullLength = 0;
  const readChunk = async (chunk: readonly Address[], floor: bigint | undefined, length?: number) => {
    const response = contextRecord(await rpc.getMultipleAccounts(chunk, {
      commitment, encoding: "base64", ...(floor === undefined ? {} : { minContextSlot: floor }),
      ...(length === undefined ? {} : { dataSlice: { offset: 0, length } }),
    }).send());
    if (observed === undefined || response.slot > observed) observed = response.slot;
    const index = chunk.indexOf(CLOCK_ADDRESS);
    if (index === -1 || !Array.isArray(response.value)) return response;
    let clock;
    try { clock = decodeMimirBetaRpcAccount(CLOCK_ADDRESS, response.value[index]); } catch { clock = null; }
    const view = clock ? new DataView(clock.data.buffer, clock.data.byteOffset, clock.data.byteLength) : null;
    if (!clock || !view || clock.executable || clock.owner !== "Sysvar1111111111111111111111111111111111111" || clock.data.length !== 40 ||
      view.getBigInt64(32, true) < 0n) betaError("RPC_CONTEXT_MISMATCH", "cohort Clock is not authentic", CLOCK_ADDRESS);
    const clockSlot = view.getBigUint64(0, true);
    if (clockSlot > observed!) observed = clockSlot;
    return { ...response, coherent: clockSlot === response.slot, clockSlot };
  };
  let read;
  try {
    read = await readCoherentPartitions<Address, unknown>([full, headers], minContextSlot, async (chunk, floor, partition) => {
      if (partition === 1) return readChunk(chunk, floor, 45);
      const response = await readChunk(chunk, floor);
      if (Array.isArray(response.value)) for (const entry of response.value) {
        const bytes = entry && typeof entry === "object" ? mimirBetaRpcAccountBytes((entry as { data?: unknown }).data) : undefined;
        if (bytes && bytes.length > fullLength) fullLength = bytes.length;
      }
      return response;
    }, headers.length && addresses.length <= MAX_MULTIPLE_ACCOUNTS ? () => Math.max(45, fullLength + 1) <= MAX_COHORT_PREFIX_BYTES : undefined);
  } catch (error) {
    if (!headers.length || addresses.length > MAX_MULTIPLE_ACCOUNTS || !isMimirBetaCohortNotConverged(error)) throw error;
    const length = Math.max(45, fullLength + 1);
    if (length > MAX_COHORT_PREFIX_BYTES) throw error;
    let atomic, values;
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) await cohortClockRetryWait(attempt);
      const floor = observed;
      atomic = await readChunk(addresses, floor, length);
      if (floor !== undefined && atomic.slot < floor) betaError("RPC_CONTEXT_MISMATCH", "context regressed");
      values = requireChunkLength<unknown>(atomic.value, addresses);
      if ((atomic as { coherent?: boolean }).coherent !== false) break;
      if (attempt + 1 >= MAX_COHORT_ATTEMPTS) betaError("RPC_CONTEXT_MISMATCH", COHORT_NOT_CONVERGED);
    }
    return { slot: atomic.slot, addresses: [...addresses], value: addresses.map((entry, index) => {
      const account = decodeMimirBetaRpcAccount(entry, values[index]);
      if (account && MIMIR_BETA_HEADER_ONLY_PROGRAM_DATA.has(entry)) return { ...account, data: account.data.slice(0, 45) };
      if (account && account.data.length >= length) betaError("RPC_CONTEXT_MISMATCH", "cohort account may be truncated", entry);
      return account;
    }) };
  }
  const byAddress = new Map<Address, MimirBetaAccount | null>([
    ...full.map((entry, index) => [entry, decodeMimirBetaRpcAccount(entry, read.value[0]![index])] as const),
    ...headers.map((entry, index) => [entry, decodeMimirBetaRpcAccount(entry, read.value[1]![index])] as const)]);
  return { slot: read.slot, value: addresses.map((entry) => byAddress.get(entry)!), addresses: [...addresses] };
}

export function requireSameContext<T>(reads: readonly MimirBetaContext<T>[]): bigint {
  if (reads.length === 0) betaError("INVALID_ARGUMENT", "empty coherent context set");
  const slot = reads[0]!.slot;
  if (reads.some((read) => read.slot !== slot)) betaError("RPC_CONTEXT_MISMATCH", "mixed RPC contexts");
  return slot;
}
