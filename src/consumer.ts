import {
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { MIMIR_FUSED_COMPOSITE_TAG } from "./constants.js";
import { MIMIR_FUSED_CLASSIC_TAG } from "./beta/classicExecution.js";
import {
  freshCanonicalAuthority,
  freshPublicKey,
} from "./internal/canonicalAuthority.js";
import {
  findAdminConfigPda,
  findCompositeFeedConfigPda,
  findCompositeSnapshotPda,
  findFeedFeeVaultPda,
  findFeedSnapshotPda,
  findOracleRegistryPda,
} from "./pda.js";
import { createVerifySnapshotInstruction } from "./instructions.js";
import type { SnapshotPolicy } from "./types.js";

const { VerifyFlags, SYSTEM_PROGRAM_ID } = freshCanonicalAuthority(PublicKey);

export interface MimirVerifiedConsumerAccounts {
  snapshot: PublicKey;
  feedConfig?: PublicKey;
  registry?: PublicKey;
  sourcingPlan?: PublicKey;
  feedTwap?: PublicKey;
}

export interface MimirAuditedDirectReadConsumerContract {
  auditId: string;
  consumerProgramId: PublicKey;
  requiresTwapRead?: boolean;
}

export interface MimirCompositeConsumerAccounts {
  compositeSnapshot: PublicKey;
  compositeConfig?: PublicKey;
}

export interface CreateMimirAuditedDirectReadConsumerInstructionsArgs
  extends MimirVerifiedConsumerAccounts {
  policy: SnapshotPolicy;
  consumerInstruction: TransactionInstruction;
  auditedConsumer: MimirAuditedDirectReadConsumerContract;
  preReadInstructions: readonly TransactionInstruction[];
  programId?: PublicKey;
  requireRevisionBinding?: boolean;
}

export interface CreateMimirRefreshReadConsumerInstructionsArgs
  extends MimirVerifiedConsumerAccounts {
  policy: SnapshotPolicy;
  consumerInstruction: TransactionInstruction;
  preReadInstructions: readonly TransactionInstruction[];
  programId?: PublicKey;
  requireRevisionBinding?: boolean;
  requiresTwapRead?: boolean;
}

export interface CreateMimirCompositeRefreshReadConsumerInstructionsArgs
  extends MimirCompositeConsumerAccounts {
  consumerInstruction: TransactionInstruction;
  preReadInstructions: readonly TransactionInstruction[];
  programId?: PublicKey;
}

function samePubkey(a: PublicKey, b: PublicKey): boolean {
  return a.equals(b);
}

function verifiedOracleAccounts(
  accounts: MimirVerifiedConsumerAccounts,
): PublicKey[] {
  return [
    accounts.snapshot,
    accounts.feedConfig,
    accounts.registry,
    accounts.sourcingPlan,
    accounts.feedTwap,
  ].filter((value): value is PublicKey => value !== undefined);
}

function verifiedCompositeOracleAccounts(
  accounts: MimirCompositeConsumerAccounts,
): PublicKey[] {
  return [accounts.compositeSnapshot, accounts.compositeConfig].filter(
    (value): value is PublicKey => value !== undefined,
  );
}

function assertRevisionBound(policy: SnapshotPolicy): void {
  if (policy.expectedSnapshotRevision === 0n) {
    throw new Error("MissingSnapshotRevisionBinding");
  }
  if (
    (policy.flags & VerifyFlags.RequireLiveTwapState) !== 0 &&
    policy.expectedTwapRevision === 0n
  ) {
    throw new Error("MissingTwapRevisionBinding");
  }
}

function assertConsumerDoesNotWriteVerifiedOracleAccounts(
  consumerInstruction: TransactionInstruction,
  oracleAccounts: readonly PublicKey[],
): void {
  for (const meta of consumerInstruction.keys) {
    if (!meta.isWritable) continue;
    if (oracleAccounts.some((account) => samePubkey(account, meta.pubkey))) {
      throw new Error("ConsumerWritesVerifiedOracleAccount");
    }
  }
}

function assertConsumerReadsSnapshot(
  consumerInstruction: TransactionInstruction,
  snapshot: PublicKey,
): void {
  const snapshotMeta = consumerInstruction.keys.find((meta) =>
    samePubkey(meta.pubkey, snapshot),
  );
  if (snapshotMeta === undefined) {
    throw new Error("ConsumerMissingSnapshotRead");
  }
  if (snapshotMeta.isSigner) {
    throw new Error("ConsumerRequiresSnapshotSigner");
  }
}

function assertConsumerReadsAccount(
  consumerInstruction: TransactionInstruction,
  account: PublicKey,
  errorName: string,
): void {
  const meta = consumerInstruction.keys.find((candidate) =>
    samePubkey(candidate.pubkey, account),
  );
  if (meta === undefined) {
    throw new Error(errorName);
  }
  if (meta.isSigner) {
    throw new Error("ConsumerRequiresOracleSigner");
  }
}

function assertInstructionMeta(
  instruction: TransactionInstruction,
  index: number,
  account: PublicKey | undefined,
  writable: boolean | null,
): void {
  if (account == null) return;
  const meta = instruction.keys[index];
  if (
    meta == null ||
    !samePubkey(meta.pubkey, account) ||
    meta.isSigner ||
    (writable != null && meta.isWritable !== writable)
  ) {
    throw new Error("InvalidMimirAtomicRefreshInstruction");
  }
}

function assertMimirInstruction(
  instruction: TransactionInstruction,
  programId: PublicKey,
): void {
  if (!instruction.programId.equals(programId)) {
    throw new Error("InvalidMimirAtomicRefreshInstruction");
  }
}

/** The only classic producer is the immediately preceding tag-89 publish (`new=previous+1`) over the canonical snapshot/execution pair. */
function tryDerive(derive: () => PublicKey): PublicKey | null {
  try { return derive(); } catch { return null; }
}

function assertClassicProducer(instruction: TransactionInstruction, snapshot: PublicKey, programId: PublicKey): void {
  assertMimirInstruction(instruction, programId);
  const d = instruction.data; const w = (d[51] ?? 0) + (d[92] ?? 0);
  const feedId = d.subarray(1, 33);
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (d[0] !== MIMIR_FUSED_CLASSIC_TAG || d.length < 104 || d.length !== 104 + 8 * w || instruction.keys.length < 3 ||
      view.getBigUint64(43, true) !== view.getBigUint64(35, true) + 1n ||
      !tryDerive(() => findFeedSnapshotPda(feedId, programId)[0])?.equals(snapshot) ||
      !tryDerive(() => findOracleRegistryPda(0, programId)[0])?.equals(instruction.keys[1]!.pubkey) ||
      !tryDerive(() => PublicKey.findProgramAddressSync([Buffer.from("classic_execution"), feedId], programId)[0])?.equals(instruction.keys[2]!.pubkey) ||
      instruction.keys.some((meta, index) => meta.isSigner || meta.isWritable !== (index === 0 || index === 2))) {
    throw new Error("InvalidMimirAtomicRefreshInstruction");
  }
  assertInstructionMeta(instruction, 0, snapshot, true);
}

function assertSnapshotAtomicPreReadInstructions(
  preReadInstructions: readonly TransactionInstruction[],
  args: MimirVerifiedConsumerAccounts,
  programId: PublicKey,
): void {
  if (preReadInstructions.length !== 1) throw new Error(preReadInstructions.length ? "InvalidMimirAtomicRefreshInstruction" : "MissingMimirAtomicRefreshInstruction");
  assertClassicProducer(preReadInstructions[0]!, args.snapshot, programId);
}

function assertCompositeAtomicPreReadInstructions(
  preReadInstructions: readonly TransactionInstruction[],
  args: MimirCompositeConsumerAccounts,
  programId: PublicKey,
): void {
  if (preReadInstructions.length === 0) {
    throw new Error("MissingMimirAtomicRefreshInstruction");
  }
  for (const instruction of preReadInstructions) {
    assertMimirInstruction(instruction, programId);
  }
  if (preReadInstructions.length > 2) throw new Error("InvalidMimirAtomicRefreshInstruction");
  for (const instruction of preReadInstructions.slice(0, -1)) {
    const snapshot = tryDerive(() => findFeedSnapshotPda(instruction.data.subarray(1, 33), programId)[0]);
    if (!snapshot) throw new Error("InvalidMimirAtomicRefreshInstruction");
    assertClassicProducer(instruction, snapshot, programId);
  }
  const instruction = preReadInstructions[preReadInstructions.length - 1]!;
  const componentCount = instruction.data[57] ?? 0;
  const rowCount = (instruction.data.length - 106) / 8;
  if (
    instruction.data[0] !== MIMIR_FUSED_COMPOSITE_TAG ||
    componentCount < 1 ||
    componentCount > 5 ||
    !Number.isInteger(rowCount) ||
    rowCount < componentCount ||
    rowCount > componentCount + 5 ||
    instruction.keys.length < 9
  ) {
    throw new Error("InvalidMimirAtomicRefreshInstruction");
  }
  assertInstructionMeta(instruction, 1, args.compositeSnapshot, true);
  assertInstructionMeta(instruction, 2, args.compositeConfig, false);
  const compositeFeedId = instruction.data.subarray(1, 33);
  const derived: readonly [number, () => PublicKey][] = [
    [1, () => findCompositeSnapshotPda(compositeFeedId, programId)[0]],
    [2, () => findCompositeFeedConfigPda(compositeFeedId, programId)[0]],
    [3, () => findOracleRegistryPda(0, programId)[0]],
    [4, () => findAdminConfigPda(1, programId)[0]],
    [5, () => findFeedFeeVaultPda(compositeFeedId, programId)[0]],
    [7, () => SYSTEM_PROGRAM_ID],
    [8, () => PublicKey.findProgramAddressSync([Buffer.from("composite_execution"), compositeFeedId], programId)[0]],
  ];
  const writable = [true, true, false, false, false, true, true, false, true];
  if (
    derived.some(([index, derive]) => !tryDerive(derive)?.equals(instruction.keys[index]!.pubkey)) ||
    instruction.keys.slice(0, 9).some((meta, index) => meta.isSigner !== (index === 0) || meta.isWritable !== writable[index]) ||
    instruction.keys.slice(9).some((meta) => meta.isSigner || meta.isWritable)
  ) {
    throw new Error("InvalidMimirAtomicRefreshInstruction");
  }
}

/** @deprecated No known user (legacy V0 consumer model). Use `withFreshPrice`. */
export function createMimirRefreshReadConsumerInstructions(
  args: CreateMimirRefreshReadConsumerInstructionsArgs,
): TransactionInstruction[] {
  const mimirProgramId = args.programId
    ? new PublicKey(args.programId.toBytes())
    : freshPublicKey("MIMIR", PublicKey);
  if (args.consumerInstruction.programId.equals(mimirProgramId)) {
    throw new Error("InvalidConsumerProgram");
  }
  if (args.requireRevisionBinding !== false) {
    assertRevisionBound(args.policy);
  }
  const oracleAccounts = verifiedOracleAccounts(args);
  assertConsumerReadsSnapshot(args.consumerInstruction, args.snapshot);
  assertConsumerDoesNotWriteVerifiedOracleAccounts(
    args.consumerInstruction,
    oracleAccounts,
  );
  if (args.requiresTwapRead === true) {
    if (args.feedTwap === undefined) throw new Error("MissingAuditedConsumerTwapAccount");
    assertConsumerReadsAccount(
      args.consumerInstruction,
      args.feedTwap,
      "ConsumerMissingTwapRead",
    );
  }
  assertSnapshotAtomicPreReadInstructions(
    args.preReadInstructions,
    args,
    mimirProgramId,
  );
  const verifySnapshotInstruction = createVerifySnapshotInstruction({
    snapshot: args.snapshot,
    feedConfig: args.feedConfig,
    registry: args.registry,
    sourcingPlan: args.sourcingPlan,
    feedTwap: args.feedTwap,
    policy: args.policy,
    programId: mimirProgramId,
  });
  return [
    ...args.preReadInstructions,
    verifySnapshotInstruction,
    args.consumerInstruction,
  ];
}

/** @deprecated No known user (legacy V0 consumer model). Use `withFreshPrice`. */
export function createMimirAuditedDirectReadConsumerInstructions(
  args: CreateMimirAuditedDirectReadConsumerInstructionsArgs,
): TransactionInstruction[] {
  const mimirProgramId = args.programId
    ? new PublicKey(args.programId.toBytes())
    : freshPublicKey("MIMIR", PublicKey);
  if (args.auditedConsumer.auditId.trim().length === 0) {
    throw new Error("MissingAuditedConsumerContract");
  }
  if (!args.consumerInstruction.programId.equals(args.auditedConsumer.consumerProgramId)) {
    throw new Error("InvalidAuditedConsumerProgram");
  }
  if (args.requireRevisionBinding !== false) {
    assertRevisionBound(args.policy);
  }
  const oracleAccounts = verifiedOracleAccounts(args);
  assertConsumerReadsSnapshot(args.consumerInstruction, args.snapshot);
  assertConsumerDoesNotWriteVerifiedOracleAccounts(
    args.consumerInstruction,
    oracleAccounts,
  );
  if (args.auditedConsumer.requiresTwapRead === true) {
    if (args.feedTwap === undefined) throw new Error("MissingAuditedConsumerTwapAccount");
    assertConsumerReadsAccount(
      args.consumerInstruction,
      args.feedTwap,
      "ConsumerMissingTwapRead",
    );
  }
  assertSnapshotAtomicPreReadInstructions(
    args.preReadInstructions,
    args,
    mimirProgramId,
  );
  return [...args.preReadInstructions, args.consumerInstruction];
}

/** @deprecated No known user (legacy V0 consumer model). Use `withFreshPrice`. */
export function createMimirCompositeRefreshReadConsumerInstructions(
  args: CreateMimirCompositeRefreshReadConsumerInstructionsArgs,
): TransactionInstruction[] {
  const mimirProgramId = args.programId
    ? new PublicKey(args.programId.toBytes())
    : freshPublicKey("MIMIR", PublicKey);
  if (args.consumerInstruction.programId.equals(mimirProgramId)) {
    throw new Error("InvalidConsumerProgram");
  }
  const oracleAccounts = verifiedCompositeOracleAccounts(args);
  assertConsumerReadsSnapshot(args.consumerInstruction, args.compositeSnapshot);
  assertConsumerDoesNotWriteVerifiedOracleAccounts(
    args.consumerInstruction,
    oracleAccounts,
  );
  assertCompositeAtomicPreReadInstructions(
    args.preReadInstructions,
    args,
    mimirProgramId,
  );
  return [...args.preReadInstructions, args.consumerInstruction];
}
