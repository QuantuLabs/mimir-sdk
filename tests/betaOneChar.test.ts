import assert from "node:assert/strict";
import { address, getProgramDerivedAddress, type Address } from "@solana/kit";
import {
  buildMimirSetOneCharAllowanceInstruction,
  buildMimirTransferOneCharAllowanceInstruction,
  decodeMimirOneCharAllowance,
  deriveMimirOneCharAllowancePda,
  getMimirOneCharAllowance,
  MIMIR_BETA_SYSTEM_PROGRAM_ID,
} from "../src/beta/index.js";
import { addressBytes, base64 } from "../src/beta/bytes.js";
import { createMimirBetaReconciliationSemanticHash, sharedAccountRole, verifySharedAccountEffect } from "../src/beta/reconciliation.js";

const programId = address("8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C");
const wallet = address("AToMNmthLzvTy3D2kz2obFmbVCsTCmYpDw1ptWUJdeU8");
const governance = address("Vote111111111111111111111111111111111111111");
const adminConfig = address("Stake11111111111111111111111111111111111111");

function allowanceBytes(bump: number, remaining: bigint, revision: bigint): Uint8Array {
  const data = new Uint8Array(26); data.set(new TextEncoder().encode("MIMIR1CH")); data[8] = 1; data[9] = bump;
  const view = new DataView(data.buffer); view.setBigUint64(10, remaining, true); view.setBigUint64(18, revision, true);
  return data;
}

const [pda, bump] = await deriveMimirOneCharAllowancePda(programId, wallet);
const [expectedPda] = await getProgramDerivedAddress({ programAddress: programId,
  seeds: [new TextEncoder().encode("one-char"), addressBytes(wallet)] });
assert.equal(pda, expectedPda);

assert.deepEqual(decodeMimirOneCharAllowance(allowanceBytes(254, 3n, 1n)), { bump: 254, remaining: 3n, revision: 1n });
assert.deepEqual(decodeMimirOneCharAllowance(allowanceBytes(1, 0n, (1n << 64n) - 1n)).remaining, 0n);
assert.throws(() => decodeMimirOneCharAllowance(allowanceBytes(254, 3n, 1n).subarray(0, 25)), /ACCOUNT_MALFORMED/);
assert.throws(() => decodeMimirOneCharAllowance(Uint8Array.from([...allowanceBytes(254, 3n, 1n), 0])), /ACCOUNT_MALFORMED/);
for (const [offset, value] of [[0, 88], [8, 2]] as const) {
  const bad = allowanceBytes(254, 3n, 1n); bad[offset] = value;
  assert.throws(() => decodeMimirOneCharAllowance(bad), /ACCOUNT_MALFORMED/);
}
assert.throws(() => decodeMimirOneCharAllowance(allowanceBytes(254, 3n, 0n)), /ACCOUNT_MALFORMED/);

const ix = await buildMimirSetOneCharAllowanceInstruction({ programId, governance, adminConfig, wallet, expectedRevision: 2n, remaining: 5n });
assert.equal(ix.data.length, 49);
assert.equal(ix.data[0], 86);
assert.deepEqual(ix.data.subarray(1, 33), addressBytes(wallet));
assert.equal(new DataView(ix.data.buffer).getBigUint64(33, true), 2n);
assert.equal(new DataView(ix.data.buffer).getBigUint64(41, true), 5n);
assert.deepEqual(ix.accounts, [
  { address: governance, isSigner: true, isWritable: true },
  { address: adminConfig, isSigner: false, isWritable: false },
  { address: pda, isSigner: false, isWritable: true },
  { address: MIMIR_BETA_SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
]);
await assert.rejects(buildMimirSetOneCharAllowanceInstruction({ programId, governance, adminConfig, wallet,
  expectedRevision: 0n, remaining: 0n }), /INVALID_ARGUMENT/);
await assert.rejects(buildMimirSetOneCharAllowanceInstruction({ programId, governance, adminConfig, wallet,
  expectedRevision: 1n << 64n, remaining: 1n }), /INVALID_ARGUMENT/);

const transfer = await buildMimirTransferOneCharAllowanceInstruction({ programId, holder: wallet, recipient: governance, amount: 3n, expectedRevision: 2n });
const [recipientPda] = await deriveMimirOneCharAllowancePda(programId, governance);
assert.equal(transfer.data.length, 49);
assert.equal(transfer.data[0], 92);
assert.deepEqual(transfer.data.subarray(1, 33), addressBytes(governance));
assert.equal(new DataView(transfer.data.buffer).getBigUint64(33, true), 3n);
assert.equal(new DataView(transfer.data.buffer).getBigUint64(41, true), 2n);
assert.deepEqual(transfer.accounts, [
  { address: wallet, isSigner: true, isWritable: true },
  { address: pda, isSigner: false, isWritable: true },
  { address: recipientPda, isSigner: false, isWritable: true },
  { address: MIMIR_BETA_SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
]);
for (const bad of [{ amount: 0n }, { expectedRevision: 0n }, { amount: 1n << 64n }, { recipient: wallet }]) {
  await assert.rejects(buildMimirTransferOneCharAllowanceInstruction({ programId, holder: wallet, recipient: governance, amount: 1n,
    expectedRevision: 1n, ...bad }), /INVALID_ARGUMENT/);
}

function rpcWith(account: { owner: Address; data: Uint8Array; executable?: boolean } | null) {
  const value = account ? { owner: account.owner, executable: account.executable ?? false, lamports: 1n, rentEpoch: 0n, space: BigInt(account.data.length),
    data: [base64(account.data), "base64"] } : null;
  const pending = { send: async () => ({ context: { slot: 9n }, value }) };
  return { getAccountInfo: () => pending, getMultipleAccounts: () => pending };
}
assert.deepEqual(await getMimirOneCharAllowance(rpcWith(null), wallet, { programId }),
  { address: pda, slot: 9n, exists: false, bump, remaining: 0n, revision: 0n });
assert.deepEqual(await getMimirOneCharAllowance(rpcWith({ owner: programId, data: allowanceBytes(bump, 2n, 4n) }), wallet, { programId }),
  { address: pda, slot: 9n, exists: true, bump, remaining: 2n, revision: 4n });
await assert.rejects(getMimirOneCharAllowance(rpcWith({ owner: governance, data: allowanceBytes(bump, 2n, 4n) }), wallet, { programId }),
  /ACCOUNT_OWNER_MISMATCH/);
await assert.rejects(getMimirOneCharAllowance(rpcWith({ owner: programId, data: allowanceBytes(bump ^ 1, 2n, 4n) }), wallet, { programId }),
  /PDA_MISMATCH/);
assert.deepEqual(await getMimirOneCharAllowance(rpcWith({ owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, data: new Uint8Array() }), wallet, { programId }),
  { address: pda, slot: 9n, exists: false, bump, remaining: 0n, revision: 0n });
await assert.rejects(getMimirOneCharAllowance(rpcWith({ owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, data: Uint8Array.of(0) }), wallet, { programId }),
  /ACCOUNT_OWNER_MISMATCH/);
await assert.rejects(getMimirOneCharAllowance(rpcWith({ owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, data: new Uint8Array(), executable: true }), wallet,
  { programId }), /ACCOUNT_OWNER_MISMATCH/);
await assert.rejects(getMimirOneCharAllowance(rpcWith({ owner: programId, data: new Uint8Array() }), wallet, { programId }), /ACCOUNT_MALFORMED/);
await assert.rejects(getMimirOneCharAllowance(rpcWith({ owner: programId, data: allowanceBytes(bump, 1n, 1n), executable: true }), wallet,
  { programId }), /ACCOUNT_OWNER_MISMATCH/);

const asset = address("SysvarC1ock11111111111111111111111111111111");
const reviewedPost = { address: pda, owner: programId, executable: false, lamports: 1n, data: allowanceBytes(bump, 1n, 2n) };
const oneCharTransition = { consumed: 1, revisionAfter: "2" };
const allowanceWrite = { address: pda, effect: "write", ownerAfter: programId, dataLengthAfter: 26, discriminatorHex: "4d494d4952314348",
  description: "consume one-character ticker allowance", proof: { kind: "account", transition: "write",
    before: { exists: true, owner: programId, executable: false, lamports: 1n, dataLength: 26, dataSha256: "00".repeat(32) },
    after: { exists: true, owner: programId, executable: false, lamports: 1n, data: { kind: "sdk-codec", codec: "one-char-allowance-v1",
      length: 26, oneCharTransition, semanticHash: await createMimirBetaReconciliationSemanticHash({ codec: "one-char-allowance-v1",
        address: pda, account: reviewedPost, transactionSlot: 10n, blockTime: null, oneCharTransition }) } } } } as never;
const assetWrite = { address: asset, proof: { kind: "account", transition: "create",
  after: { exists: true, data: { kind: "sdk-codec", codec: "mpl-core-asset-v1" } } } } as never;
const writes = [allowanceWrite, assetWrite];
assert.equal(sharedAccountRole(allowanceWrite, writes), "one-char-allowance");
const parsed = (consumers = 1) => ({ signatures: [], messageBytes: new Uint8Array(), requiredSignatureCount: 1, readonlySignedCount: 0,
  readonlyUnsignedCount: 1, staticAccountKeys: [wallet, pda, programId],
  instructions: Array.from({ length: consumers }, () => ({ programIdIndex: 2, accountIndexes: [0, 1], data: Uint8Array.of(80) })) });
const verifyAllowance = (current: Uint8Array, options: { authority?: Address; consumers?: number; resolved?: Address[];
  write?: unknown } = {}) => verifySharedAccountEffect((options.write ?? allowanceWrite) as never, "one-char-allowance", writes,
  { address: pda, owner: programId, executable: false, lamports: 1n, data: current }, parsed(options.consumers) as never, { slot: 10n } as never,
  options.resolved ?? [wallet, pda, programId], undefined, new Map(),
  { review: { programId, authority: options.authority ?? wallet } } as never);
await verifyAllowance(allowanceBytes(bump, 1n, 2n));
await verifyAllowance(allowanceBytes(bump, 0n, 3n));
await verifyAllowance(allowanceBytes(bump, 9n, 4n));
await assert.rejects(verifyAllowance(allowanceBytes(bump, 1n, 2n), { authority: governance }), /identity mismatch/);
await assert.rejects(verifyAllowance(allowanceBytes(bump, 1n, 2n), { resolved: [wallet, adminConfig, programId] }), /identity mismatch/);
await assert.rejects(verifyAllowance(allowanceBytes(bump, 1n, 2n), { consumers: 2 }), /consumption count mismatch/);
await assert.rejects(verifyAllowance(allowanceBytes(bump, 1n, 1n)), /transition evidence invalid/);
await assert.rejects(verifyAllowance(allowanceBytes(bump, 1n, 3n), { write: { ...(allowanceWrite as object), proof: {
  ...(allowanceWrite as any).proof, after: { ...(allowanceWrite as any).proof.after, data: { ...(allowanceWrite as any).proof.after.data,
    oneCharTransition: { consumed: 2, revisionAfter: "2" } } } } } }), /identity mismatch/);
const advisory = { consumed: 1, revisionAfter: "1" };
const resealed = { ...(allowanceWrite as any).proof.after.data, oneCharTransition: advisory,
  semanticHash: await createMimirBetaReconciliationSemanticHash({ codec: "one-char-allowance-v1", address: pda, account: reviewedPost,
    transactionSlot: 10n, blockTime: null, oneCharTransition: advisory }) };
assert.equal(resealed.semanticHash, (allowanceWrite as any).proof.after.data.semanticHash);
await verifyAllowance(allowanceBytes(bump, 0n, 3n), { write: { ...(allowanceWrite as object), proof: {
  ...(allowanceWrite as any).proof, after: { ...(allowanceWrite as any).proof.after, data: resealed } } } });


console.log("betaOneChar ok");
