import { getProgramDerivedAddress, type Address } from "@solana/kit";
import { addressBytes, bytesEqual } from "./bytes.js";
import { betaError } from "./errors.js";
import { MIMIR_BETA_SYSTEM_PROGRAM_ID } from "./deployment.js";
import { FinalizedRpcReader, type MimirBetaFinalizedRpc } from "./rpc.js";
import type { MimirBetaInstruction } from "./types.js";

export const MIMIR_ONE_CHAR_ALLOWANCE_SEED = "one-char";
export const MIMIR_ONE_CHAR_ALLOWANCE_MAGIC = new TextEncoder().encode("MIMIR1CH");
export const MIMIR_ONE_CHAR_ALLOWANCE_FORMAT_V1 = 1;
export const MIMIR_ONE_CHAR_ALLOWANCE_LEN = 26;
export const MIMIR_SET_ONE_CHAR_ALLOWANCE_V1_TAG = 86;
export const MIMIR_TRANSFER_ONE_CHAR_ALLOWANCE_V1_TAG = 92;
const U64_MAX = (1n << 64n) - 1n;

export interface MimirOneCharAllowance {
  readonly bump: number;
  readonly remaining: bigint;
  readonly revision: bigint;
}

export interface MimirOneCharAllowanceState extends MimirOneCharAllowance {
  readonly address: Address;
  readonly exists: boolean;
  readonly slot: bigint;
}

export function deriveMimirOneCharAllowancePda(programId: Address, wallet: Address): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({ programAddress: programId,
    seeds: [new TextEncoder().encode(MIMIR_ONE_CHAR_ALLOWANCE_SEED), addressBytes(wallet)] });
}

export function decodeMimirOneCharAllowance(data: Uint8Array): MimirOneCharAllowance {
  if (!(data instanceof Uint8Array) || data.length !== MIMIR_ONE_CHAR_ALLOWANCE_LEN ||
    !bytesEqual(data.subarray(0, 8), MIMIR_ONE_CHAR_ALLOWANCE_MAGIC) || data[8] !== MIMIR_ONE_CHAR_ALLOWANCE_FORMAT_V1) {
    betaError("ACCOUNT_MALFORMED", "one-character allowance layout is not canonical");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const revision = view.getBigUint64(18, true);
  if (revision === 0n) betaError("ACCOUNT_MALFORMED", "one-character allowance revision is zero");
  return { bump: data[9]!, remaining: view.getBigUint64(10, true), revision };
}

/** Reads the finalized allowance; an absent or empty System-owned account is a zero allowance at revision 0. */
export async function getMimirOneCharAllowance(rpc: MimirBetaFinalizedRpc, wallet: Address,
  options: { readonly programId: Address; readonly minContextSlot?: bigint }): Promise<MimirOneCharAllowanceState> {
  const [address, bump] = await deriveMimirOneCharAllowancePda(options.programId, wallet);
  const read = await new FinalizedRpcReader(rpc).account(address, options.minContextSlot);
  return { address, slot: read.slot, ...resolveMimirOneCharAllowance(read.value, options.programId, address, bump) };
}

export function resolveMimirOneCharAllowance(account: { readonly owner: Address; readonly executable: boolean; readonly data: Uint8Array } | null,
  programId: Address, address: Address, bump: number): MimirOneCharAllowance & { readonly exists: boolean } {
  if (!account || (account.owner === MIMIR_BETA_SYSTEM_PROGRAM_ID && !account.executable && account.data.length === 0)) {
    return { exists: false, bump, remaining: 0n, revision: 0n };
  }
  if (account.owner !== programId || account.executable) betaError("ACCOUNT_OWNER_MISMATCH", "one-character allowance owner mismatch", address);
  const decoded = decodeMimirOneCharAllowance(account.data);
  if (decoded.bump !== bump) betaError("PDA_MISMATCH", "one-character allowance bump mismatch", address);
  return { exists: true, ...decoded };
}

export async function buildMimirSetOneCharAllowanceInstruction(args: {
  readonly programId: Address;
  readonly governance: Address;
  readonly adminConfig: Address;
  readonly wallet: Address;
  readonly expectedRevision: bigint;
  readonly remaining: bigint;
}): Promise<MimirBetaInstruction> {
  for (const [label, value] of [["expectedRevision", args.expectedRevision], ["remaining", args.remaining]] as const) {
    if (typeof value !== "bigint" || value < 0n || value > U64_MAX) betaError("INVALID_ARGUMENT", `${label} must fit u64`);
  }
  if (args.expectedRevision === 0n && args.remaining === 0n) {
    betaError("INVALID_ARGUMENT", "creating a one-character allowance requires a non-zero count");
  }
  const [allowance] = await deriveMimirOneCharAllowancePda(args.programId, args.wallet);
  const data = new Uint8Array(49);
  data[0] = MIMIR_SET_ONE_CHAR_ALLOWANCE_V1_TAG;
  data.set(addressBytes(args.wallet), 1);
  const view = new DataView(data.buffer);
  view.setBigUint64(33, args.expectedRevision, true);
  view.setBigUint64(41, args.remaining, true);
  return { programAddress: args.programId, data, accounts: [
    { address: args.governance, isSigner: true, isWritable: true },
    { address: args.adminConfig, isSigner: false, isWritable: false },
    { address: allowance, isSigner: false, isWritable: true },
    { address: MIMIR_BETA_SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ] };
}

export interface MimirTransferOneCharAllowanceArgs {
  readonly programId: Address;
  /** Signer; pays the recipient allowance rent when it does not exist yet. */
  readonly holder: Address;
  readonly recipient: Address;
  readonly amount: bigint;
  /** Current holder allowance revision (compare-and-swap). */
  readonly expectedRevision: bigint;
}

export async function buildMimirTransferOneCharAllowanceInstruction(args: MimirTransferOneCharAllowanceArgs): Promise<MimirBetaInstruction> {
  for (const [label, value] of [["amount", args.amount], ["expectedRevision", args.expectedRevision]] as const) {
    if (typeof value !== "bigint" || value < 1n || value > U64_MAX) betaError("INVALID_ARGUMENT", `${label} must be a non-zero u64`);
  }
  if (args.holder === args.recipient) betaError("INVALID_ARGUMENT", "one-character allowance recipient must differ from the holder");
  const [[holderAllowance], [recipientAllowance]] = await Promise.all([
    deriveMimirOneCharAllowancePda(args.programId, args.holder),
    deriveMimirOneCharAllowancePda(args.programId, args.recipient),
  ]);
  const data = new Uint8Array(49);
  data[0] = MIMIR_TRANSFER_ONE_CHAR_ALLOWANCE_V1_TAG;
  data.set(addressBytes(args.recipient), 1);
  const view = new DataView(data.buffer);
  view.setBigUint64(33, args.amount, true);
  view.setBigUint64(41, args.expectedRevision, true);
  return { programAddress: args.programId, data, accounts: [
    { address: args.holder, isSigner: true, isWritable: true },
    { address: holderAllowance, isSigner: false, isWritable: true },
    { address: recipientAllowance, isSigner: false, isWritable: true },
    { address: MIMIR_BETA_SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ] };
}
