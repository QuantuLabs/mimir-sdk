import type { Address } from "@solana/kit";
import type { MimirBetaErrorCode } from "./errors.js";

export type MimirBetaCount = 1 | 2 | 3 | 4 | 5;
export type MimirBetaAdapterType = 0 | 1 | 2 | 3 | 4 | 6 | 7;
export type MimirBetaAdapterVersion = 0 | 1;
export { sourceAdapterSupportsVersion } from "../sourceAdapterVersion.js";

export type MimirBetaSourceFamily =
  | "orca-whirlpool"
  | "meteora-dlmm"
  | "meteora-damm-v2"
  | "raydium-clmm"
  | "raydium-cpmm"
  | "raydium-amm-v4"
  | "pumpswap";

export interface MimirBetaAccount {
  readonly address: Address;
  readonly owner: Address;
  readonly executable: boolean;
  readonly lamports: bigint;
  readonly data: Uint8Array;
}

export interface MimirBetaContext<T> {
  readonly slot: bigint;
  readonly value: T;
  /** Exact request order when the context was produced by a coherent multi-account read. */
  readonly addresses?: readonly Address[];
}

export interface MimirBetaInstructionAccount {
  readonly address: Address;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export interface MimirBetaInstruction {
  readonly programAddress: Address;
  readonly accounts: readonly MimirBetaInstructionAccount[];
  readonly data: Uint8Array;
}

export type MimirBetaOwnershipVerificationStatus =
  | "verified"
  | "not-found"
  | "unverified";

export interface MimirBetaFeedOwnership {
  readonly cluster: "localnet" | "devnet" | "mainnet-beta";
  readonly feed: Address;
  readonly feedKind: "classic" | "composite" | null;
  readonly immutableCreator: Address | null;
  readonly identityAsset: Address | null;
  readonly liveCoreOwner: Address | null;
  readonly displayName: string | null;
  readonly observedSlot: bigint;
  readonly verificationStatus: MimirBetaOwnershipVerificationStatus;
  readonly failureCode: MimirBetaErrorCode | null;
}

export interface MimirBetaAccountFingerprint {
  readonly exists: boolean;
  readonly owner: Address | null;
  readonly executable: boolean | null;
  readonly lamports: bigint;
  readonly dataLength: number | null;
  readonly dataSha256: string | null;
}

export interface MimirBetaTokenBalanceEvidence {
  readonly accountIndex: number;
  readonly mint: Address;
  readonly owner: Address | null;
  readonly programId: Address;
  readonly amountRaw: bigint;
  readonly decimals: number;
}

export interface MimirBetaCompiledInnerInstruction {
  readonly programIdIndex: number;
  readonly accountIndexes: readonly number[];
  readonly data: Uint8Array;
}

export interface MimirBetaInnerInstructionGroup {
  readonly outerInstructionIndex: number;
  readonly instructions: readonly MimirBetaCompiledInnerInstruction[];
}

export interface MimirBetaFinalizedMeta {
  readonly err: string | null;
  readonly fee: bigint;
  readonly preBalances: readonly bigint[];
  readonly postBalances: readonly bigint[];
  readonly preTokenBalances: readonly MimirBetaTokenBalanceEvidence[];
  readonly postTokenBalances: readonly MimirBetaTokenBalanceEvidence[];
  readonly loadedAddresses: Readonly<{
    writable: readonly Address[];
    readonly: readonly Address[];
  }>;
  readonly innerInstructions: readonly MimirBetaInnerInstructionGroup[];
}

export interface MimirBetaFinalizedTransactionEvidence {
  readonly signature: string;
  readonly slot: bigint;
  readonly blockTime: bigint | null;
  readonly version: 1;
  readonly transactionBytes: Uint8Array;
  readonly messageBytes: Uint8Array;
  readonly signatures: readonly string[];
  readonly resolvedAccountKeys: readonly Address[];
  readonly meta: MimirBetaFinalizedMeta;
}

export interface MimirBetaWriteEvidence {
  readonly index: number;
  readonly address: Address;
  readonly kind: "account" | "lamports" | "spl-token-burn-checked" | "caller-prefix";
  readonly evidenceHash: string;
}
