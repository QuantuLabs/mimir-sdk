import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import bs58 from "bs58";
import { getAddressFromPublicKey } from "@solana/addresses";
import { createSolanaRpcFromTransport, signature as kitSignature } from "@solana/kit";
import { addressBytes, base64, bytesAddress, hex, sha256 } from "../src/beta/bytes.js";
import { MimirBetaExpiryFinalizingError } from "../src/beta/errors.js";
import { getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder } from "@solana/transaction-messages";
import { assertMimirBetaReviewedMessageV1, compileMimirBetaTransactionV1, isMimirBetaWalletRewriteV1, mimirBetaReviewedMessageOfWalletV1,
  mimirBetaReviewedToWalletInstructionIndexesV1, partiallySignMimirBetaTransactionV1, verifyMimirBetaWalletSignedTransactionV1 } from "../src/beta/transactionV1.js";
import {
  assertMimirBetaNativeRefreshTrios,
  fingerprintMimirBetaAccount,
  createMimirBetaReconciliationSemanticHash,
  observeMimirBetaReceipt,
  observeMimirBetaConfirmedReceipt,
  observeMimirBetaConfirmedReceiptChain,
  observeMimirBetaReceiptChain,
  verifyMimirBetaFinalizedReceiptEvidence,
} from "../src/beta/reconciliation.js";
import {
  authenticateMimirBetaReviewedStep,
  reconcileStepReceipts,
  reconcileMimirBetaConfirmedPreparationReceipts,
  createMimirBetaStageReceipt,
  createExpectedWritesHash,
  createReviewHash,
  createStepIntentHash,
  type MimirBetaCreationReviewV1,
  type MimirBetaExpectedWrite,
  type MimirBetaPlanStep,
  type MimirBetaPreparedStep,
  type MimirBetaStageReceipt,
} from "../src/beta/review.js";
import { decodeMimirBetaFinalizedTransactionResponse, decodeMimirBetaSignatureStatusResponse } from "../src/beta/rpc.js";
import { deriveMimirBetaTickerPda, encodeMimirBetaIdentityCompositeData } from "../src/beta/abi.js";
import type { MimirBetaAccount, MimirBetaFinalizedTransactionEvidence } from "../src/beta/types.js";
import { buildTestSnapshotHeader, buildTestSourceObservationRingHeader } from "../src/fixtures.js";

const addr = (byte: number) => bytesAddress(Uint8Array.from({ length: 32 }, () => byte));
const payerKeys = await webcrypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
const payer = await getAddressFromPublicKey(payerKeys.publicKey); const stateAddress = addr(2); const programId = addr(3);
const data = Uint8Array.of(9, 8, 7);
const stateAccount: MimirBetaAccount = { address: stateAddress, owner: programId, executable: false, lamports: 5n, data };
const transaction = await compileMimirBetaTransactionV1({
  feePayer: payer,
  recentBlockhash: bs58.encode(Uint8Array.from({ length: 32 }, () => 4)),
  lastValidBlockHeight: 50n,
  instructions: [{ programAddress: programId, accounts: [{ address: stateAddress, isSigner: false, isWritable: true }], data: Uint8Array.of(7) }],
});
const signatureBytes = new Uint8Array(await webcrypto.subtle.sign("Ed25519", payerKeys.privateKey, transaction.serializedMessage));
const signature = bs58.encode(signatureBytes);
const signedBytes = transaction.serializedTransaction.slice();
signedBytes.set(signatureBytes, transaction.serializedMessage.length);
const draftHash = "1".repeat(64);
const expectedWrites = [{
  address: stateAddress,
  effect: "write" as const,
  ownerAfter: programId,
  dataLengthAfter: data.length,
  discriminatorHex: null,
  description: "write exact state",
  proof: {
    kind: "account" as const,
    transition: "write" as const,
    before: { exists: true, owner: programId, executable: false, lamports: 5n, dataLength: data.length, dataSha256: hex(await sha256(data)) },
    after: { exists: true as const, lamports: 5n, owner: programId, executable: false, data: { kind: "exact" as const, length: data.length, sha256: hex(await sha256(data)) } },
  },
}];
const step: MimirBetaPlanStep = { stepId: "classic:source-append:0", stage: "mimir-create", ordinal: 0,
  prerequisiteStepIds: [], requiredSigners: [payer], expectedWrites };
const expectedWritesHash = await createExpectedWritesHash(expectedWrites);
const stepIntentHash = await createStepIntentHash({ draftHash, step, expectedWritesHash });
const reviewBase: MimirBetaCreationReviewV1 = {
  schema: "mimir-beta-creation-review", version: 1, draftHash, stepId: step.stepId, kind: "classic", cluster: "localnet",
  programId, authority: payer, feedId: addr(6), feed: stateAddress, identityAsset: addr(7), ticker: "MIMIR", displayName: null,
  requiredSigners: transaction.requiredSigners,
  instructions: [{ programAddress: programId, accounts: transaction.instructions[0]!.accounts,
    dataBase64: base64(transaction.instructions[0]!.data), dataSha256: hex(await sha256(transaction.instructions[0]!.data)) }],
  expectedWrites, messageHash: transaction.messageHash, stepIntentHash, expectedWritesHash,
  packet: transaction.packet, simulation: { status: "succeeded", contextSlot: 10n, unitsConsumed: 1n,
    logsHash: "2".repeat(64), returnDataHash: null, error: null }, warnings: [],
};
const review = await createReviewHash(reviewBase);
const preparedStep = { step, transaction, review: reviewBase, ...review };
const receipt: MimirBetaStageReceipt = createMimirBetaStageReceipt({ preparedStep, signature, attempt: 1, retryOfSignature: null });

function rawResponse(err: unknown) {
  const count = transaction.packet.accountCount;
  const preBalances: number[] = Array.from({ length: count }, (_, index) => index === 0 ? 100 : index === 1 ? 5 : 1);
  const postBalances = [...preBalances]; postBalances[0] = 99;
  return { slot: 11, blockTime: 20, version: 1, transaction: [base64(signedBytes), "base64"], meta: {
    err, fee: 1, preBalances, postBalances, preTokenBalances: [], postTokenBalances: [], loadedAddresses: { writable: [], readonly: [] }, innerInstructions: null,
  } };
}

const finalized = decodeMimirBetaFinalizedTransactionResponse(signature, rawResponse(null));
assert(finalized);
const kitNormalized = decodeMimirBetaFinalizedTransactionResponse(signature, {
  ...rawResponse(null), version: 1n, slot: 11n,
});
assert(kitNormalized);
assert.equal(kitNormalized.version, 1);
assert.equal(kitNormalized.slot, 11n);
for (const version of [0, 0n, 2, 2n, "1", null, undefined, NaN, Infinity, {}, []]) {
  assert.throws(() => decodeMimirBetaFinalizedTransactionResponse(signature, { ...rawResponse(null), version }),
    /finalized transaction is not Transaction v1/);
}
const proven = await verifyMimirBetaFinalizedReceiptEvidence({ receipt, preparedStep, transaction: finalized,
  postAccounts: { slot: 11n, addresses: [stateAddress], value: [stateAccount] } });
assert.equal(proven.state, "finalized");
assert.equal(proven.writes.length, 1);

// A fee-only wallet rewrite becomes the record: receipt and reconciliation bind the wallet message hash.
const walletFeeTransaction = await compileMimirBetaTransactionV1({
  feePayer: payer, recentBlockhash: bs58.encode(Uint8Array.from({ length: 32 }, () => 4)), lastValidBlockHeight: 50n,
  priorityFeeLamports: 50_000n,
  instructions: [{ programAddress: programId, accounts: [{ address: stateAddress, isSigner: false, isWritable: true }], data: Uint8Array.of(7) }],
});
const walletMessage = walletFeeTransaction.serializedMessage;
const walletSignatureBytes = new Uint8Array(await webcrypto.subtle.sign("Ed25519", payerKeys.privateKey, walletMessage));
const walletSignature = bs58.encode(walletSignatureBytes);
const walletSignedBytes = walletFeeTransaction.serializedTransaction.slice();
walletSignedBytes.set(walletSignatureBytes, walletMessage.length);
const walletReceipt = createMimirBetaStageReceipt({ preparedStep, signature: walletSignature, attempt: 1, retryOfSignature: null,
  signedMessage: walletMessage });
assert.equal(walletReceipt.messageHash, hex(await sha256(walletMessage)));
assert.notEqual(walletReceipt.messageHash, reviewBase.messageHash);
assert.equal(walletReceipt.messageBase64, base64(walletMessage));
await authenticateMimirBetaReviewedStep(walletReceipt);
const walletFinalized = decodeMimirBetaFinalizedTransactionResponse(walletSignature,
  { ...rawResponse(null), transaction: [base64(walletSignedBytes), "base64"] });
assert(walletFinalized);
const walletProven = await verifyMimirBetaFinalizedReceiptEvidence({ receipt: walletReceipt, preparedStep, transaction: walletFinalized,
  postAccounts: { slot: 11n, addresses: [stateAddress], value: [stateAccount] } });
assert.equal(walletProven.state, "finalized");
assert.equal(walletProven.messageHash, walletReceipt.messageHash);
const nonFeeMessage = walletMessage.slice(); nonFeeMessage[nonFeeMessage.length - 1] ^= 1;
assert.throws(() => createMimirBetaStageReceipt({ preparedStep, signature: walletSignature, attempt: 1, retryOfSignature: null,
  signedMessage: nonFeeMessage }), (error: unknown) => (error as { code?: string }).code === "RECEIPT_MISMATCH");
const nonFeeHash = hex(await sha256(nonFeeMessage));
await assert.rejects(() => authenticateMimirBetaReviewedStep({ ...walletReceipt, messageBase64: base64(nonFeeMessage),
  messageHash: nonFeeHash }), (error: unknown) => (error as { code?: string }).code === "RECEIPT_MISMATCH");

// ComputeBudget data rewrites (disc-2, disc-3, combined with config) become the record end to end.
const computeBudget = "ComputeBudget111111111111111111111111111111" as typeof programId;
const budgeted = await compileMimirBetaTransactionV1({
  feePayer: payer, recentBlockhash: bs58.encode(Uint8Array.from({ length: 32 }, () => 4)), lastValidBlockHeight: 50n,
  instructions: [
    { programAddress: computeBudget, accounts: [], data: Uint8Array.of(2, 0x40, 0x0d, 0x03, 0) },
    { programAddress: computeBudget, accounts: [], data: Uint8Array.of(3, 1, 0, 0, 0, 0, 0, 0, 0) },
    { programAddress: programId, accounts: [{ address: stateAddress, isSigner: false, isWritable: true }], data: Uint8Array.of(7) },
  ],
});
const budgetedReviewBase: MimirBetaCreationReviewV1 = { ...reviewBase, requiredSigners: budgeted.requiredSigners,
  instructions: await Promise.all(budgeted.instructions.map(async (instruction) => ({ programAddress: instruction.programAddress,
    accounts: instruction.accounts, dataBase64: base64(instruction.data), dataSha256: hex(await sha256(instruction.data)) }))),
  messageHash: budgeted.messageHash, packet: budgeted.packet };
const budgetedPrepared = { step, transaction: budgeted, review: budgetedReviewBase, ...await createReviewHash(budgetedReviewBase) };
type BudgetCompiled = Extract<ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>, { version: 1 }>;
const budgetRewrite = (mutate: (message: BudgetCompiled) => BudgetCompiled) => new Uint8Array(getCompiledTransactionMessageEncoder().encode(
  mutate(getCompiledTransactionMessageDecoder().decode(budgeted.serializedMessage) as BudgetCompiled)));
const budgetData = (message: BudgetCompiled, index: number, ixData: Uint8Array): BudgetCompiled => ({ ...message,
  instructionPayloads: message.instructionPayloads.map((payload, at) => at === index ? { ...payload, instructionData: ixData } : payload) });
const budgetConfig = (message: BudgetCompiled): BudgetCompiled => ({ ...message,
  configValues: message.configValues.map((value, at) => at === message.configValues.length - 2 ? { kind: "u32", value: 200_000 } : value) });
const insertBudget = (message: BudgetCompiled, data: Uint8Array): BudgetCompiled => {
  const present = message.staticAccounts.indexOf(computeBudget);
  const staticAccounts = present >= 0 ? message.staticAccounts : [...message.staticAccounts, computeBudget];
  return { ...message, staticAccounts, numStaticAccounts: staticAccounts.length, numInstructions: message.numInstructions + 1,
    header: present >= 0 ? message.header : { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1 },
    instructionHeaders: [{ programAccountIndex: staticAccounts.indexOf(computeBudget), numInstructionAccounts: 0, numInstructionDataBytes: data.length },
      ...message.instructionHeaders], instructionPayloads: [{ instructionAccountIndices: [], instructionData: data }, ...message.instructionPayloads] };
};
const preparedOf = async (tx: typeof budgeted) => {
  const base: MimirBetaCreationReviewV1 = { ...reviewBase, requiredSigners: tx.requiredSigners,
    instructions: await Promise.all(tx.instructions.map(async (instruction) => ({ programAddress: instruction.programAddress,
      accounts: instruction.accounts, dataBase64: base64(instruction.data), dataSha256: hex(await sha256(instruction.data)) }))),
    messageHash: tx.messageHash, packet: tx.packet };
  return { step, transaction: tx, review: base, ...await createReviewHash(base) };
};
const r4Hash = bs58.encode(Uint8Array.from({ length: 32 }, () => 4));
const r4Program = { programAddress: programId, accounts: [{ address: stateAddress, isSigner: false, isWritable: true }], data: Uint8Array.of(7) };
const r4Compile = (instructions: (typeof r4Program)[], priorityFeeLamports?: bigint) => compileMimirBetaTransactionV1({
  feePayer: payer, recentBlockhash: r4Hash, lastValidBlockHeight: 50n, instructions, ...(priorityFeeLamports === undefined ? {} : { priorityFeeLamports }) });
const pricedPrepared = await preparedOf(await r4Compile([r4Program], 20_000n));
const reEncode = (bytes: Uint8Array, mutate: (message: BudgetCompiled) => BudgetCompiled) => new Uint8Array(getCompiledTransactionMessageEncoder().encode(
  mutate(getCompiledTransactionMessageDecoder().decode(bytes) as BudgetCompiled)));
const dropFirstIx = (message: BudgetCompiled): BudgetCompiled => ({ ...message, numInstructions: message.numInstructions - 1,
  instructionHeaders: message.instructionHeaders.slice(1), instructionPayloads: message.instructionPayloads.slice(1) });
const plainRewrite = (mutate: (message: BudgetCompiled) => BudgetCompiled) => new Uint8Array(getCompiledTransactionMessageEncoder().encode(
  mutate(getCompiledTransactionMessageDecoder().decode(transaction.serializedMessage) as BudgetCompiled)));
const cuPrice = Uint8Array.of(3, 9, 0, 0, 0, 0, 0, 0, 0);
const cuLimit = Uint8Array.of(2, 0x20, 0xa1, 0x07, 0);
const r5Reviewed = await r4Compile([r4Program, { programAddress: programId,
  accounts: [{ address: bytesAddress(Uint8Array.from({ length: 32 }, () => 77)), isSigner: false, isWritable: false }], data: Uint8Array.of(9) } as never]);
const r5Prepared = await preparedOf(r5Reviewed);
const insertCbAt = (message: BudgetCompiled, data: Uint8Array, ixAt: number, keyAt: number): BudgetCompiled => {
  const present = message.staticAccounts.indexOf(computeBudget);
  const at = message.staticAccounts.length - message.header.numReadonlyNonSignerAccounts + keyAt;
  const staticAccounts = present >= 0 ? message.staticAccounts : [...message.staticAccounts.slice(0, at), computeBudget, ...message.staticAccounts.slice(at)];
  const remap = (index: number) => staticAccounts.indexOf(message.staticAccounts[index]!);
  const headers = message.instructionHeaders.map((h) => ({ ...h, programAccountIndex: remap(h.programAccountIndex) }));
  const payloads = message.instructionPayloads.map((p) => ({ ...p, instructionAccountIndices: p.instructionAccountIndices.map(remap) }));
  headers.splice(ixAt, 0, { programAccountIndex: staticAccounts.indexOf(computeBudget), numInstructionAccounts: 0, numInstructionDataBytes: data.length });
  payloads.splice(ixAt, 0, { instructionAccountIndices: [], instructionData: data });
  return { ...message, staticAccounts, numStaticAccounts: staticAccounts.length, numInstructions: message.numInstructions + 1,
    header: present >= 0 ? message.header : { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1 },
    instructionHeaders: headers, instructionPayloads: payloads };
};
const budgetCases: Array<[string, Uint8Array, typeof budgetedPrepared]> = [
  ["insert CB disc-3 + key", plainRewrite((message) => insertBudget(message, cuPrice)), preparedStep],
  ["insert CB disc-2 + key", plainRewrite((message) => insertBudget(message, cuLimit)), preparedStep],
  ["insert both CB + key + config", plainRewrite((message) => budgetConfig(insertBudget(insertBudget(message, cuPrice), cuLimit))), preparedStep],
  ["insert CB between non-fee", reEncode(r5Reviewed.serializedMessage, (message) => insertCbAt(message, cuPrice, 1, 0)), r5Prepared],
  ["CB key in readonly middle", reEncode(r5Reviewed.serializedMessage, (message) => insertCbAt(message, cuPrice, 0, 1)), r5Prepared],
  ["two inserted disc-3", reEncode(r5Reviewed.serializedMessage, (message) => insertCbAt(insertCbAt(message, cuPrice, 2, 1), Uint8Array.of(3, 4, 0, 0, 0, 0, 0, 0, 0), 0, 0)), r5Prepared],
  ["priced review, wallet changes fee", (await r4Compile([r4Program], 280_000n)).serializedMessage, pricedPrepared],
];
for (const [label, budgetMessage, prepared] of budgetCases) {
  assert.notDeepEqual(budgetMessage, prepared.transaction.serializedMessage, label);
  const sigBytes = new Uint8Array(await webcrypto.subtle.sign("Ed25519", payerKeys.privateKey, budgetMessage));
  const sig = bs58.encode(sigBytes);
  const budgetReceipt = createMimirBetaStageReceipt({ preparedStep: prepared, signature: sig, attempt: 1, retryOfSignature: null,
    signedMessage: budgetMessage });
  assert.equal(budgetReceipt.messageHash, hex(await sha256(budgetMessage)), label);
  await authenticateMimirBetaReviewedStep(budgetReceipt);
  const signed = Uint8Array.from([...budgetMessage, ...sigBytes]);
  const count = getCompiledTransactionMessageDecoder().decode(budgetMessage).staticAccounts.length;
  const preBalances: number[] = Array.from({ length: count }, (_, index) => index === 0 ? 100 : index === 1 ? 5 : 1);
  const postBalances = [...preBalances]; postBalances[0] = 99;
  const budgetFinalized = decodeMimirBetaFinalizedTransactionResponse(sig, { ...rawResponse(null),
    transaction: [base64(signed), "base64"], meta: { ...rawResponse(null).meta, preBalances, postBalances } });
  assert(budgetFinalized, label);
  const budgetProven = await verifyMimirBetaFinalizedReceiptEvidence({ receipt: budgetReceipt, preparedStep: prepared,
    transaction: budgetFinalized, postAccounts: { slot: 11n, addresses: [stateAddress], value: [stateAccount] } });
  assert.equal(budgetProven.state, "finalized", label);
  assert.equal(budgetProven.messageHash, budgetReceipt.messageHash, label);
}

// Solflare COLA-paid shape on a two-signer activation: fee ComputeBudget prefix, payer guard, collateral token guard.
{
  const lighthouse = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95" as typeof programId;
  const solflare = (message: Uint8Array, collateral: typeof programId) => reEncode(message, (m) => {
    const fee = insertCbAt(m, cuPrice, 0, 0);
    const staticAccounts = [...fee.staticAccounts, lighthouse];
    const payerGuard = Uint8Array.from(Buffer.from("06050300a87cde1f000000000403000001000000000000000000", "hex"));
    const tokenGuard = Uint8Array.from(Buffer.from(`0a05060802ff9f65cf544f1d00040300000600000000000000000001${"00".repeat(32)}00070000`, "hex"));
    tokenGuard.set(addressBytes(payer), 28);
    const guards = [[0, payerGuard], [staticAccounts.indexOf(collateral), tokenGuard]] as const;
    return { ...fee, staticAccounts, numStaticAccounts: staticAccounts.length, numInstructions: fee.numInstructions + 2,
      header: { ...fee.header, numReadonlyNonSignerAccounts: fee.header.numReadonlyNonSignerAccounts + 1 },
      instructionHeaders: [...fee.instructionHeaders, ...guards.map(([, data]) => ({ programAccountIndex: staticAccounts.length - 1,
        numInstructionAccounts: 1, numInstructionDataBytes: data.length }))],
      instructionPayloads: [...fee.instructionPayloads, ...guards.map(([target, data]) => ({ instructionAccountIndices: [target], instructionData: data }))] };
  });
  const action = fixtureAccount(addr(90), 5n, 90), created = fixtureAccount(addr(91), 10n, 91);
  const shape = { kind: "composite" as const, stepId: "composite:activate" as const, fee: 3n,
    transitions: [{ address: action.address, transition: "write" as const, before: action, after: { ...action, data: Uint8Array.of(92) } },
      { address: created.address, transition: "create" as const, before: null, after: created }],
    lamports: [{ address: payer, beforeLamports: 1_000n, programDeltaLamports: -10n }] };
  const plain = await balanceFixture(shape);
  const plainProven = await plain.verify();
  assert.equal(plainProven.state, "finalized", "unguarded two-signer activation");
  const guarded = await balanceFixture({ ...shape, walletRewrite: solflare });
  const reviewed = guarded.preparedStep.transaction.serializedMessage;
  assert.notDeepEqual(guarded.finalMessage, reviewed);
  assert.equal(isMimirBetaWalletRewriteV1(reviewed, guarded.finalMessage), false);
  assert.equal(isMimirBetaWalletRewriteV1(reviewed, guarded.finalMessage, guarded.burnSource), true);
  assert.deepEqual([...mimirBetaReviewedToWalletInstructionIndexesV1(reviewed, guarded.finalMessage, guarded.burnSource)], [[0, 1], [1, 2], [2, 3], [3, 4]]);
  assert.equal(guarded.reviewHash, plain.reviewHash, "review hash unchanged by the wallet rewrite");
  assert.equal(guarded.review.messageHash, plain.review.messageHash);
  assert.equal(guarded.receipt.signature, guarded.signature);
  assert.equal(guarded.receipt.messageHash, hex(await sha256(guarded.finalMessage)));
  assert.equal(guarded.receipt.messageBase64, base64(guarded.finalMessage));
  const persisted = JSON.parse(JSON.stringify(guarded.receipt)) as MimirBetaStageReceipt;
  const revived = await authenticateMimirBetaReviewedStep(persisted);
  assert.equal(revived.reviewHash, plain.reviewHash);
  assert.equal(revived.review.identityAsset, plain.review.identityAsset);
  for (const options of [{}, { receipt: persisted, receiptOnly: true }]) {
    const proven = await guarded.verify(new Map(), options);
    assert.equal(proven.state, "finalized", "guarded final wire reconciles");
    if (proven.state !== "finalized" || plainProven.state !== "finalized") throw new Error("missing proof");
    assert.equal(proven.messageHash, guarded.receipt.messageHash);
    assert.deepEqual(proven.writes, plainProven.writes, "account/burn/lamport proofs remapped to the final wire");
  }
  const confirmed = await guarded.verify(new Map(), { receipt: persisted, receiptOnly: true, confirmed: true });
  assert.equal(confirmed.state, "confirmed", "guarded final wire, confirmed consumer");
  await assert.rejects(() => guarded.verify(new Map(), { burnOuterIndex: 3 }), "burn CPI under the unmapped outer index");
  const tampered = guarded.finalMessage.slice(); tampered[tampered.length - 1] ^= 1;
  await assert.rejects(() => authenticateMimirBetaReviewedStep({ ...persisted, messageBase64: base64(tampered),
    messageHash: hex(createHash("sha256").update(tampered).digest()) }), /RECEIPT_MISMATCH|not an admitted|authority invalid|not authentic/);
  await assert.rejects(() => authenticateMimirBetaReviewedStep({ ...persisted, messageHash: plain.receipt.messageHash }));
  console.log("beta reconciliation Solflare COLA guard chain passed");
}

const failedTransaction = decodeMimirBetaFinalizedTransactionResponse(signature, rawResponse({ InstructionError: [0, "Custom"] }));
assert(failedTransaction);
const failed = await verifyMimirBetaFinalizedReceiptEvidence({ receipt, preparedStep, transaction: failedTransaction,
  postAccounts: { slot: 11n, addresses: [stateAddress], value: [stateAccount] } });
assert.equal(failed.state, "failed");
if (failed.state === "failed") assert.equal(failed.rollback, "baseline-matched");
const diverged = await verifyMimirBetaFinalizedReceiptEvidence({ receipt, preparedStep, transaction: failedTransaction,
  postAccounts: { slot: 11n, addresses: [stateAddress], value: [{ ...stateAccount, data: Uint8Array.of(1) }] } });
if (diverged.state === "failed") assert.equal(diverged.rollback, "state-diverged");
await assert.rejects(() => verifyMimirBetaFinalizedReceiptEvidence({ receipt, preparedStep, transaction: finalized,
  postAccounts: { slot: 11n, value: [stateAccount] } }));
await assert.rejects(() => verifyMimirBetaFinalizedReceiptEvidence({ receipt: { ...receipt, signature: bs58.encode(Uint8Array.from({ length: 64 }, () => 6)) },
  preparedStep, transaction: finalized, postAccounts: { slot: 11n, addresses: [stateAddress], value: [stateAccount] } }));

const calls: Array<{ method: string; args: readonly unknown[] }> = [];
const rpc = {
  getTransaction(...args: readonly unknown[]) { calls.push({ method: "getTransaction", args }); return { send: async () => rawResponse(null) }; },
  getAccountInfo(...args: readonly unknown[]) { calls.push({ method: "getAccountInfo", args }); return { send: async () => null }; },
  getMultipleAccounts(...args: readonly unknown[]) {
    calls.push({ method: "getMultipleAccounts", args });
    return { send: async () => ({ context: { slot: 11 }, value: [[base64(data), "base64"]].map((encoded) => ({
      data: encoded, owner: programId, executable: false, lamports: 5,
    })) }) };
  },
};
const observedAfterReload = await observeMimirBetaReceipt({ rpc, receipt });
const observed = await observeMimirBetaReceipt({ rpc, receipt, preparedStep });
assert.deepEqual(observedAfterReload, observed);
assert.equal(observed.state, "finalized");
assert.equal(calls.filter((call) => call.method === "getTransaction").length, 2);
assert.equal(calls.filter((call) => call.method === "getMultipleAccounts").length, 2);
assert.deepEqual(calls.find((call) => call.method === "getTransaction")!.args[1], {
  commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 1,
});
assert.deepEqual(calls.find((call) => call.method === "getMultipleAccounts")!.args[1], {
  commitment: "finalized", encoding: "base64", minContextSlot: 11n,
});

{
const confirmedCalls: { commitment: string; minContextSlot?: bigint }[] = [];
const confirmedRpc = { ...rpc,
  getTransaction(_signature: string, config: { commitment: string }) {
    confirmedCalls.push(config); return { send: async () => config.commitment === "confirmed" ? rawResponse(null) : null };
  },
  getMultipleAccounts(_addresses: readonly unknown[], config: { commitment: string; minContextSlot?: bigint }) {
    confirmedCalls.push(config); return rpc.getMultipleAccounts(_addresses, config);
  },
  getSignatureStatuses: () => ({ send: async () => ({ context: { slot: 11 }, value: [{ slot: 11, confirmationStatus: "confirmed", confirmations: 1, err: null }] }) }),
  isBlockhashValid: () => ({ send: async () => ({ context: { slot: 11 }, value: true }) }),
};
const confirmed = await observeMimirBetaConfirmedReceipt({ rpc: confirmedRpc, receipt, preparedStep });
assert.equal(confirmed.state, "confirmed");
if (confirmed.state !== "confirmed" || proven.state !== "finalized") throw new Error("missing proof");
assert.notEqual(confirmed.evidenceHash, proven.evidenceHash);
assert.deepEqual(confirmed.writes, proven.writes);
assert.ok(confirmedCalls.every((call) => call.commitment === "confirmed"));
assert.equal(confirmedCalls[1]!.minContextSlot, 11n);
assert.equal((await observeMimirBetaReceipt({ rpc: confirmedRpc, receipt })).state, "pending");
const confirmedPlan = { draftHash, steps: [step], receipts: [receipt], observations: [confirmed], observedSlot: 11n };
assert.equal(reconcileMimirBetaConfirmedPreparationReceipts(confirmedPlan).action, "await-finality");
assert.equal(reconcileMimirBetaConfirmedPreparationReceipts(confirmedPlan).steps[0]!.finalizedSignature, null);
assert.equal(reconcileStepReceipts(confirmedPlan as never).action, "blocked", "confirmed evidence cannot authorize finalized reconciliation");
assert.equal(reconcileMimirBetaConfirmedPreparationReceipts({ ...confirmedPlan, steps: [step,
  { ...step, stepId: "classic:activate", ordinal: 1, prerequisiteStepIds: [step.stepId], expectedWrites: [] }] }).action, "review-next-step");
assert.equal((await observeMimirBetaConfirmedReceipt({ rpc: { ...confirmedRpc,
  getTransaction: () => ({ send: async () => null }) }, receipt })).state, "pending");
await assert.rejects(() => observeMimirBetaConfirmedReceipt({ rpc: confirmedRpc, receipt, minContextSlot: 12n }), /context regressed/);
await assert.rejects(() => observeMimirBetaConfirmedReceipt({ rpc: { ...confirmedRpc,
  getMultipleAccounts: () => ({ send: async () => ({ context: { slot: 11 }, value: [null] }) }) }, receipt }), /postcondition/);
await assert.rejects(() => observeMimirBetaConfirmedReceipt({ rpc: { ...confirmedRpc,
  getMultipleAccounts: () => ({ send: async () => ({ context: { slot: 11 }, value: [{
    data: [base64(Uint8Array.of(1, 2, 3)), "base64"], owner: programId, executable: false, lamports: 5 }] }) }) }, receipt }), /postcondition/);
const wrongConfirmedWire = signedBytes.slice(); wrongConfirmedWire[transaction.serializedMessage.length - 1] ^= 1;
await assert.rejects(() => observeMimirBetaConfirmedReceipt({ rpc: { ...confirmedRpc,
  getTransaction: () => ({ send: async () => ({ ...rawResponse(null), transaction: [base64(wrongConfirmedWire), "base64"] }) }) }, receipt }), /message hash differs/);
await assert.rejects(() => observeMimirBetaConfirmedReceipt({ rpc: confirmedRpc, receipt: { ...receipt,
  reviewedStep: { ...receipt.reviewedStep, review: { ...receipt.reviewedStep.review, authority: addr(99) } } } }), /RECEIPT_MISMATCH/);

}

const expiryCalls: string[] = [];
const expiryRpc = {
  getTransaction() { expiryCalls.push("transaction"); return { send: async () => null }; },
  getSignatureStatuses(_signatures: readonly [string], config: { searchTransactionHistory: true }) {
    assert.deepEqual(config, { searchTransactionHistory: true }); expiryCalls.push("status");
    const slot = expiryCalls.filter((entry) => entry === "status").length === 1 ? 120 : 121;
    return { send: async () => ({ context: { slot }, value: [null] }) };
  },
  isBlockhashValid(blockhash: string, config: { commitment: "confirmed" | "finalized" }) {
    assert.equal(blockhash, transaction.recentBlockhash); assert.ok(["confirmed", "finalized"].includes(config.commitment)); expiryCalls.push("validity");
    return { send: async () => ({ context: { slot: 110 }, value: false }) };
  },
  getFirstAvailableBlock() { expiryCalls.push("firstAvailableBlock"); return { send: async () => 10n }; },
  getAccountInfo: rpc.getAccountInfo,
  getMultipleAccounts(...args: readonly unknown[]) {
    calls.push({ method: "getMultipleAccounts", args });
    const floor = (args[1] as { minContextSlot?: bigint }).minContextSlot ?? 11n;
    return { send: async () => ({ context: { slot: Number(floor) }, value: [{ data: [base64(data), "base64"], owner: programId, executable: false, lamports: 5 }] }) };
  },
};
const expired = await observeMimirBetaReceipt({ rpc: expiryRpc, receipt });
assert.equal(expired.state, "expired");
assert.deepEqual(expiryCalls, ["transaction", "status", "validity", "validity", "status", "transaction", "firstAvailableBlock"]);
if (expired.state === "expired") {
  assert.equal(expired.blockhash, transaction.recentBlockhash);
  assert.equal(expired.observedSlot, 110n); assert.equal(expired.accountContextSlot, 110n);
  assert.deepEqual(calls.at(-1)!.args[1], { commitment: "finalized", encoding: "base64", minContextSlot: 110n });
  const reconciled = (await import("../src/beta/review.js")).reconcileStepReceipts({ draftHash, steps: [step], receipts: [receipt],
    observations: [expired], observedSlot: expired.observedSlot });
  assert.equal(expired.rollback, "baseline-matched");
  assert.equal(reconciled.action, "retry-once"); assert.equal(reconciled.steps[0]!.state, "failed");
  assert.equal((await import("../src/beta/review.js")).reconcileStepReceipts({ draftHash, steps: [step], receipts: [receipt],
    observations: [{ ...expired }], observedSlot: expired.observedSlot }).action, "blocked");
}
await assert.rejects(() => observeMimirBetaReceipt({ rpc: { ...expiryRpc, getMultipleAccounts() {
  return { send: async () => ({ context: { slot: 11 }, value: [{ data: [base64(data), "base64"], owner: programId, executable: false, lamports: 5 }] }) };
} }, receipt }), /RPC_CONTEXT_MISMATCH/);
const drifted = await observeMimirBetaReceipt({ rpc: { ...expiryRpc, getMultipleAccounts() {
  return { send: async () => ({ context: { slot: 121 }, value: [{ data: [base64(Uint8Array.of(1)), "base64"], owner: programId, executable: false, lamports: 5 }] }) };
} }, receipt });
assert.equal(drifted.state, "expired");
if (drifted.state === "expired") {
  assert.equal(drifted.rollback, "state-diverged");
  assert.equal((await import("../src/beta/review.js")).reconcileStepReceipts({ draftHash, steps: [step], receipts: [receipt],
    observations: [drifted], observedSlot: drifted.observedSlot }).action, "blocked");
}
const laggingFinality = (rootStep: number, fail: (floor: bigint) => Error) => {
  let processedTip = 121; let finalizedRoot = 89; const requested: bigint[] = [];
  return { requested, rpc: { ...expiryRpc,
    getSignatureStatuses() { processedTip += 40; return { send: async () => ({ context: { slot: processedTip }, value: [null] }) }; },
    isBlockhashValid() { return { send: async () => ({ context: { slot: processedTip }, value: false }) }; },
    getMultipleAccounts(addresses: readonly unknown[], config: { commitment: string; minContextSlot: bigint }) {
      assert.equal(config.commitment, "finalized"); requested.push(config.minContextSlot); processedTip += 40;
      return { send: async () => {
        finalizedRoot += rootStep;
        if (BigInt(finalizedRoot) < config.minContextSlot) throw fail(config.minContextSlot);
        return { context: { slot: finalizedRoot }, value: addresses.map(() => ({ data: [base64(data), "base64"], owner: programId, executable: false, lamports: 5 })) };
      } };
    } } };
};
const kitLag = () => Object.assign(new Error("Minimum context slot has not been reached"), { code: -32016 });
const caughtUp = laggingFinality(40, kitLag);
const caughtUpExpiry = await observeMimirBetaReceipt({ rpc: caughtUp.rpc, receipt, finalityDelayMs: 0 });
assert.equal(caughtUpExpiry.state, "expired");
assert.deepEqual(caughtUp.requested, [161n, 161n]);
if (caughtUpExpiry.state === "expired") {
  assert.equal(caughtUpExpiry.observedSlot, 161n); assert.equal(caughtUpExpiry.accountContextSlot, 169n);
  assert.equal(caughtUpExpiry.rollback, "baseline-matched");
  assert.equal((await import("../src/beta/review.js")).reconcileStepReceipts({ draftHash, steps: [step], receipts: [receipt],
    observations: [caughtUpExpiry], observedSlot: caughtUpExpiry.observedSlot }).action, "retry-once");
}
const adapterLag = laggingFinality(40, () => new Error('getMultipleAccounts failed: {"code":-32016,"message":"Minimum context slot has not been reached"}'));
assert.equal((await observeMimirBetaReceipt({ rpc: adapterLag.rpc, receipt, finalityDelayMs: 0 })).state, "expired");
const stalled = laggingFinality(0, kitLag);
await assert.rejects(() => observeMimirBetaReceipt({ rpc: stalled.rpc, receipt, finalityDelayMs: 0 }), (error: unknown) => (error as { code?: number }).code === -32016);
assert.equal(stalled.requested.length, 120); assert(stalled.requested.every((floor) => floor === 161n));
const interactive = laggingFinality(0, kitLag);
await assert.rejects(() => observeMimirBetaReceipt({ rpc: interactive.rpc, receipt, finalityDelayMs: 0, finalityAttempts: 2 }),
  (error: unknown) => error instanceof MimirBetaExpiryFinalizingError && error.code === "EXPIRY_FINALIZING" && error.floor === 161n &&
    error.signature === receipt.signature);
assert.deepEqual(interactive.requested, [161n, 161n], "an interactive bound keeps the exact expiry floor and stops early");
const interactiveCaughtUp = laggingFinality(40, kitLag);
assert.equal((await observeMimirBetaReceipt({ rpc: interactiveCaughtUp.rpc, receipt, finalityDelayMs: 0, finalityAttempts: 3 })).state, "expired");
for (const finalityAttempts of [0, 121, 1.5]) {
  await assert.rejects(() => observeMimirBetaReceipt({ rpc: interactive.rpc, receipt, finalityAttempts }), /INVALID_ARGUMENT/);
}
const otherFailure = laggingFinality(40, () => new Error("RPC transport down"));
await assert.rejects(() => observeMimirBetaReceipt({ rpc: otherFailure.rpc, receipt, finalityDelayMs: 0 }), /RPC transport down/);
assert.equal(otherFailure.requested.length, 1);
const assertHistoryUnavailable = async (rpc: Parameters<typeof observeMimirBetaReceipt>[0]["rpc"]) => assert.rejects(
  () => observeMimirBetaReceipt({ rpc, receipt }),
  (error: unknown) => error instanceof Error && error.message ===
    "CREATION_CONTEXT_REQUIRED:RPC history unavailable; transaction outcome unknown",
);
const rpcWithoutHistory: Parameters<typeof observeMimirBetaReceipt>[0]["rpc"] = { ...expiryRpc };
delete rpcWithoutHistory.getFirstAvailableBlock;
await assertHistoryUnavailable(rpcWithoutHistory);
for (const firstAvailableBlock of [11n, -1n, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10", null]) {
  await assertHistoryUnavailable({ ...expiryRpc, getFirstAvailableBlock() { return { send: async () => firstAvailableBlock }; } });
}
await assert.rejects(() => observeMimirBetaReceipt({ rpc: { ...expiryRpc,
  getFirstAvailableBlock() { return { send: async () => { throw new Error("history transport unavailable"); } }; },
}, receipt }), /history transport unavailable/);

let tamperRpcCalls = 0;
const tamperedMessage = transaction.serializedMessage.slice(); tamperedMessage[tamperedMessage.length - 1] ^= 1;
await assert.rejects(() => observeMimirBetaReceipt({ rpc: {
  ...expiryRpc, getTransaction() { tamperRpcCalls += 1; return { send: async () => null }; },
}, receipt: { ...receipt, messageBase64: base64(tamperedMessage) } }));
assert.equal(tamperRpcCalls, 0, "message mutation must fail before expiry RPC");
await assert.rejects(() => observeMimirBetaReceipt({ rpc: {
  ...expiryRpc, getTransaction() { tamperRpcCalls += 1; return { send: async () => null }; },
}, receipt: { ...receipt, signature: bs58.encode(Uint8Array.from({ length: 64 }, () => 9)) } }));
assert.equal(tamperRpcCalls, 0, "signature mutation must fail before expiry RPC");

const finalizedStatus = { slot: 11, confirmations: null, err: null, confirmationStatus: "finalized" };
await assert.rejects(() => observeMimirBetaReceipt({ rpc: {
  ...expiryRpc,
  getTransaction() { return { send: async () => null }; },
  getSignatureStatuses() { return { send: async () => ({ context: { slot: 120 }, value: [finalizedStatus] }) }; },
}, receipt }), /finalized signature status has no finalized transaction body/);
await assert.rejects(() => observeMimirBetaReceipt({ rpc: {
  ...expiryRpc,
  getTransaction() { return { send: async () => null }; },
  getSignatureStatuses() { const count = ++tamperRpcCalls; return { send: async () => ({ context: { slot: count % 2 ? 120 : 109 }, value: [null] }) }; },
}, receipt }), /context regressed/);
const pendingValid = await observeMimirBetaReceipt({ rpc: {
  ...expiryRpc,
  getTransaction() { return { send: async () => null }; },
  getSignatureStatuses() { return { send: async () => ({ context: { slot: 120 }, value: [null] }) }; },
  isBlockhashValid() { return { send: async () => ({ context: { slot: 110 }, value: true }) }; },
}, receipt });
assert.equal(pendingValid.state, "pending");
const lagValidityCommitments: string[] = [];
const finalizedLag = await observeMimirBetaReceipt({ rpc: {
  ...expiryRpc,
  getTransaction() { return { send: async () => null }; },
  getSignatureStatuses() { return { send: async () => ({ context: { slot: 120 }, value: [null] }) }; },
  isBlockhashValid(_blockhash: string, config: { commitment: string }) {
    lagValidityCommitments.push(config.commitment);
    return { send: async () => config.commitment === "finalized" ? { context: { slot: 80 }, value: false } : { context: { slot: 110 }, value: true } };
  },
}, receipt });
assert.equal(finalizedLag.state, "pending", "blockhash unknown to the finalized bank but valid at confirmed stays pending");
assert.deepEqual(lagValidityCommitments, ["confirmed"]);

// The same expiry negatives through the public chain collector.
{
  const publicLatest = async (rpc: Parameters<typeof observeMimirBetaReceipt>[0]["rpc"]) =>
    (await observeMimirBetaReceiptChain({ rpc, receipts: [receipt] })).at(-1)!;
  await assert.rejects(() => publicLatest(rpcWithoutHistory), /history unavailable/);
  await assert.rejects(() => publicLatest({ ...expiryRpc, getFirstAvailableBlock() { return { send: async () => 11n }; } }), /history unavailable/);
  let pendingReads = 0;
  const noReads = { getMultipleAccounts() { pendingReads += 1; throw new Error("unexpected account read"); } };
  assert.equal((await publicLatest({ ...expiryRpc, ...noReads, getSignatureStatuses() {
    return { send: async () => ({ context: { slot: 120 }, value: [{ slot: 11, confirmations: 1, err: null, confirmationStatus: "confirmed" }] }) };
  } })).state, "pending");
  assert.equal(pendingReads, 0);
  const divergedLatest = await publicLatest({ ...expiryRpc, getMultipleAccounts() {
    return { send: async () => ({ context: { slot: 500 }, value: [{ data: [base64(Uint8Array.of(1)), "base64"], owner: programId, executable: false, lamports: 5 }] }) };
  } });
  assert(divergedLatest.state === "expired" && divergedLatest.rollback === "state-diverged");
  assert.equal(reconcileStepReceipts({ draftHash, steps: [step], receipts: [receipt], observations: [divergedLatest],
    observedSlot: divergedLatest.observedSlot }).action, "blocked");
}

for (const confirmations of [-1n, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", undefined]) {
  assert.throws(() => decodeMimirBetaSignatureStatusResponse({ context: { slot: 120n }, value: [{
    slot: 119n, confirmations, err: null, confirmationStatus: "processed",
  }] }), /signature confirmations is not an unsigned integer/);
}

async function kitStatusRpc(statuses: readonly unknown[], valid: boolean, orderedCalls: string[]) {
  let statusIndex = 0;
  // @ts-expect-error The method-specific fixture intentionally returns its JSON-RPC response shape.
  const kitRpc = createSolanaRpcFromTransport(async ({ payload }) => {
    const method = (payload as { method: string }).method; orderedCalls.push(method);
    return { jsonrpc: "2.0" as const, id: (payload as { id: string }).id,
      result: { context: { slot: 120 + statusIndex }, value: [statuses[statusIndex++]] } };
  });
  return {
    getTransaction() { orderedCalls.push("getTransaction"); return { send: async () => null }; },
    getSignatureStatuses() { return kitRpc.getSignatureStatuses([kitSignature(receipt.signature)], { searchTransactionHistory: true }); },
    isBlockhashValid() { orderedCalls.push("isBlockhashValid"); return { send: async () => ({ context: { slot: 110 }, value: valid }) }; },
    getAccountInfo: rpc.getAccountInfo,
    getMultipleAccounts: rpc.getMultipleAccounts,
  };
}

const processedCalls: string[] = [];
const processedPending = await observeMimirBetaReceipt({ rpc: await kitStatusRpc([
  { slot: 119, confirmations: 1, err: null, confirmationStatus: "processed", status: { Ok: null } },
], true, processedCalls), receipt });
assert.equal(processedPending.state, "pending");
assert.deepEqual(processedCalls, ["getTransaction", "getSignatureStatuses"], "processed status skips expiry checks");

const confirmedCalls: string[] = [];
const confirmedPending = await observeMimirBetaReceipt({ rpc: await kitStatusRpc([null,
  { slot: 120, confirmations: 2, err: null, confirmationStatus: "confirmed", status: { Ok: null } },
], false, confirmedCalls), receipt });
assert.equal(confirmedPending.state, "pending");
assert.deepEqual(confirmedCalls, ["getTransaction", "getSignatureStatuses", "isBlockhashValid", "isBlockhashValid", "getSignatureStatuses"],
  "confirmed status after false validity skips final transaction read");

let lateTransactionRead = 0;
const lateFinalized = await observeMimirBetaReceipt({ rpc: {
  ...expiryRpc,
  getTransaction() { lateTransactionRead += 1; return { send: async () => lateTransactionRead === 2 ? rawResponse(null) : null }; },
  getSignatureStatuses() { return { send: async () => ({ context: { slot: 120 }, value: [null] }) }; },
  getMultipleAccounts: rpc.getMultipleAccounts,
}, receipt });
assert.equal(lateFinalized.state, "finalized", "post-invalidity finalized transaction must win");

type AccountTransitionFixture = Readonly<{
  address: ReturnType<typeof addr>;
  transition: "create" | "write" | "close";
  before: MimirBetaAccount | null;
  after: MimirBetaAccount | null;
}>;

type LamportFixture = Readonly<{
  address: ReturnType<typeof addr>;
  beforeLamports: bigint;
  programDeltaLamports: bigint;
}>;

function fixtureAccount(address: ReturnType<typeof addr>, lamports: bigint, marker: number): MimirBetaAccount {
  return { address, owner: programId, executable: false, lamports, data: Uint8Array.of(marker) };
}

function staticMessageKeys(message: Uint8Array): readonly ReturnType<typeof addr>[] {
  const decoded = getCompiledTransactionMessageDecoder().decode(message);
  if (decoded.version !== 1) throw new Error("expected Transaction v1 message");
  return decoded.staticAccounts;
}

async function balanceFixture(args: {
  kind: "classic" | "composite";
  stepId: "classic:activate" | "composite:activate";
  transitions: readonly AccountTransitionFixture[];
  lamports: readonly LamportFixture[];
  fee: bigint;
  walletRewrite?: (message: Uint8Array, collateral: ReturnType<typeof addr>) => Uint8Array;
}) {
  const fixtureIdentityAsset = addr(232); const ticker = "MIMIR"; const feedAddress = addr(231); const feedId = addr(230);
  const burnSource = addr(226); const burnMint = addr(227);
  const configData = new Uint8Array(args.kind === "classic" ? 357 : 661); const configView = new DataView(configData.buffer);
  configData.set(new TextEncoder().encode(args.kind === "classic" ? "MIMIRCFG" : "MIMIRCFC"));
  configView.setUint16(8, 1, true); configView.setUint16(10, configData.length, true); configView.setUint32(12, 1, true);
  configData.set(addressBytes(feedId), 16); configData.set(addressBytes(addr(220)), 48); configData.set(addressBytes(addr(221)), 80);
  if (args.kind === "classic") {
    configData[120] = 1; configData[121] = 1; configData[122] = 1; configData[312] = 1;
    configData.set([5, 77, 73, 77, 73, 82, 0], 313); configData.set(addressBytes(fixtureIdentityAsset), 325);
  } else {
    configData[116] = 1; configData[117] = 4; configData[119] = 2;
    configView.setUint16(120, 1, true); configView.setUint16(122, 1, true); configData.fill(1, 128, 160);
    configView.setBigUint64(160, 1n, true); configView.setBigUint64(168, 1n, true); configView.setBigUint64(176, 1n, true);
    configData[184] = 1; configData.set([5, 77, 73, 77, 73, 82, 0], 185);
    configData.set(addressBytes(addr(222)), 229); configData.set(addressBytes(addr(223)), 261); configView.setBigUint64(293, 1n, true);
    configData.set(addressBytes(addr(224)), 309); configData.set(addressBytes(addr(225)), 341); configView.setBigUint64(373, 1n, true);
    configData.set(addressBytes(fixtureIdentityAsset), 629);
  }
  const [tickerAddress, tickerBump] = await deriveMimirBetaTickerPda(programId, ticker);
  const tickerData = new Uint8Array(43); tickerData.set(new TextEncoder().encode("MIMIRTIK"));
  tickerData[8] = 1; tickerData[9] = 2; tickerData[10] = tickerBump; tickerData.set(addressBytes(feedAddress), 11);
  const configAccount = { address: feedAddress, owner: programId, executable: false, lamports: 1n, data: configData };
  const tickerAccount = { address: tickerAddress, owner: programId, executable: false, lamports: 1n, data: tickerData };
  const identityAccount = { address: fixtureIdentityAsset, owner: programId, executable: false, lamports: 1n, data: new Uint8Array(33) };
  const allTransitions = [...args.transitions, ...(args.kind === "composite" ? [{ address: fixtureIdentityAsset,
    transition: "create" as const, before: null, after: identityAccount }] : []),
    { address: feedAddress, transition: "create" as const, before: null, after: configAccount },
    { address: tickerAddress, transition: "create" as const, before: null, after: tickerAccount }];
  const accountWrites: MimirBetaExpectedWrite[] = await Promise.all(allTransitions.map(async (entry) => ({
    address: entry.address,
    effect: entry.transition,
    ownerAfter: entry.after?.owner ?? null,
    dataLengthAfter: entry.after?.data.length ?? null,
    discriminatorHex: null,
    description: `${args.kind} ${entry.transition}`,
    proof: {
      kind: "account" as const,
      transition: entry.transition,
      before: await fingerprintMimirBetaAccount(entry.before),
      after: entry.after === null ? { exists: false as const, lamports: 0n as const } : {
        exists: true as const,
        lamports: entry.after.lamports,
        owner: entry.after.owner,
        executable: entry.after.executable,
        data: entry.address === feedAddress || entry.address === tickerAddress || entry.address === fixtureIdentityAsset ? {
          kind: "sdk-codec" as const,
          codec: entry.address === fixtureIdentityAsset ? "mpl-core-asset-v1" as const : entry.address === tickerAddress ? "ticker-claim-v1" as const :
            args.kind === "classic" ? "classic-feed-v1" as const : "composite-feed-v1" as const,
          length: entry.after.data.length,
          semanticHash: await createMimirBetaReconciliationSemanticHash({ codec: entry.address === fixtureIdentityAsset ? "mpl-core-asset-v1" :
            entry.address === tickerAddress ? "ticker-claim-v1" :
            args.kind === "classic" ? "classic-feed-v1" : "composite-feed-v1", address: entry.address,
          account: entry.after, transactionSlot: 70n, blockTime: null }),
        } : { kind: "exact" as const, length: entry.after.data.length, sha256: hex(await sha256(entry.after.data)) },
      },
    },
  })));
  const lamports = args.lamports.map((entry) => entry.address === payer && entry.programDeltaLamports !== 0n
    ? { ...entry, programDeltaLamports: entry.programDeltaLamports - (args.kind === "composite" ? 3n : 2n) } : entry);
  const lamportWrites: MimirBetaExpectedWrite[] = lamports.map((entry) => ({
    address: entry.address,
    effect: "lamports",
    ownerAfter: null,
    dataLengthAfter: null,
    discriminatorHex: null,
    description: "exact program lamport delta",
    proof: { kind: "lamports", programDeltaLamports: entry.programDeltaLamports },
  }));
  const burnWrite: MimirBetaExpectedWrite[] = args.kind === "composite" ? [{ address: burnSource, effect: "token-burn",
    ownerAfter: null, dataLengthAfter: null, discriminatorHex: null, description: "burn composite collateral",
    proof: { kind: "spl-token-burn-checked", tokenProgram: programId, mint: burnMint, sourceTokenAccount: burnSource,
      authority: payer, amountRaw: 1n, decimals: 0, outerInstructionIndex: 3 } }] : [];
  const writes = [...accountWrites, ...lamportWrites, ...burnWrite];
  const instructionAddresses = [...new Set(writes.map((write) => write.address).filter((address) => address !== payer))];
  const compositeAccounts = [
    { address: payer, isSigner: true, isWritable: true },
    ...instructionAddresses.filter((address) => address !== fixtureIdentityAsset && address !== tickerAddress)
      .map((address) => ({ address, isSigner: false, isWritable: true })),
    { address: burnMint, isSigner: false, isWritable: true },
  ];
  while (compositeAccounts.length < 13) {
    const address = addr(140 + compositeAccounts.length);
    if (!compositeAccounts.some((account) => account.address === address)) {
      compositeAccounts.push({ address, isSigner: false, isWritable: false });
    }
  }
  assert.equal(compositeAccounts.length, 13);
  const compositeIdentityAccounts = [
    ...compositeAccounts,
    { address: tickerAddress, isSigner: false, isWritable: true },
    { address: addr(150), isSigner: false, isWritable: false },
    { address: addr(151), isSigner: false, isWritable: false },
    { address: addr(152), isSigner: false, isWritable: false },
    { address: fixtureIdentityAsset, isSigner: true, isWritable: true },
    { address: addr(153), isSigner: false, isWritable: true },
    { address: addr(154), isSigner: false, isWritable: false },
    { address: addr(155), isSigner: false, isWritable: true },
    { address: addr(156), isSigner: false, isWritable: false },
    { address: addr(157), isSigner: false, isWritable: true },
    { address: addr(158), isSigner: false, isWritable: false },
    { address: addr(159), isSigner: false, isWritable: true },
  ];
  if (compositeIdentityAccounts.length !== 25) throw new Error("Composite tag81 N2 fee-tail fixture length mismatch");
  const fixtureTransaction = await compileMimirBetaTransactionV1({
    feePayer: payer,
    recentBlockhash: bs58.encode(Uint8Array.from({ length: 32 }, () => 21)),
    lastValidBlockHeight: 80n,
    instructions: [
      { programAddress: programId, accounts: [
        { address: fixtureIdentityAsset, isSigner: true, isWritable: true },
      ], data: Uint8Array.of(1) },
      { programAddress: programId, accounts: [
        { address: fixtureIdentityAsset, isSigner: false, isWritable: false },
      ], data: Uint8Array.of(2) },
      ...(args.kind === "composite" ? [{ programAddress: programId, accounts: [
        { address: fixtureIdentityAsset, isSigner: false, isWritable: false },
      ], data: Uint8Array.of(3) }] : []),
      { programAddress: programId, accounts: args.kind === "composite" ? compositeIdentityAccounts : [
        ...instructionAddresses.map((address) => ({ address, isSigner: false, isWritable: true })),
        { address: fixtureIdentityAsset, isSigner: true, isWritable: true },
      ], data: args.kind === "composite" ? encodeMimirBetaIdentityCompositeData(configData) : Uint8Array.of(80) },
    ],
  });
  const finalMessage = args.walletRewrite?.(fixtureTransaction.serializedMessage, burnSource) ?? fixtureTransaction.serializedMessage;
  const fixtureSignatureBytes = new Uint8Array(await webcrypto.subtle.sign("Ed25519", payerKeys.privateKey, finalMessage));
  const fixtureSignature = bs58.encode(fixtureSignatureBytes);
  const fixtureSignedBytes = Uint8Array.from([...finalMessage, ...fixtureSignatureBytes,
    ...Array.from({ length: 64 }, () => args.kind === "classic" ? 24 : 25)]);
  const fixtureDraftHash = args.kind === "classic" ? "a".repeat(64) : "b".repeat(64);
  const fixtureStepId = args.stepId;
  const fixtureStep: MimirBetaPlanStep = {
    stepId: fixtureStepId, stage: "mimir-create", ordinal: args.kind === "classic" ? 3 : 0,
    prerequisiteStepIds: args.kind === "classic" ? ["classic:source-append:1"] : [],
    requiredSigners: fixtureTransaction.requiredSigners, expectedWrites: writes,
  };
  const fixtureExpectedWritesHash = await createExpectedWritesHash(writes);
  const fixtureStepIntentHash = await createStepIntentHash({
    draftHash: fixtureDraftHash, step: fixtureStep, expectedWritesHash: fixtureExpectedWritesHash,
  });
  const fixtureReviewBase: MimirBetaCreationReviewV1 = {
    schema: "mimir-beta-creation-review", version: 1, draftHash: fixtureDraftHash, stepId: fixtureStepId,
    kind: args.kind, cluster: "localnet", programId, authority: payer, feedId, feed: feedAddress,
    identityAsset: fixtureIdentityAsset, ticker, displayName: args.kind === "composite" ? "Composite Index" : null,
    requiredSigners: fixtureTransaction.requiredSigners,
    instructions: await Promise.all(fixtureTransaction.instructions.map(async (instruction) => ({ programAddress: programId,
      accounts: instruction.accounts, dataBase64: base64(instruction.data), dataSha256: hex(await sha256(instruction.data)) }))),
    expectedWrites: writes, messageHash: fixtureTransaction.messageHash,
    stepIntentHash: fixtureStepIntentHash, expectedWritesHash: fixtureExpectedWritesHash,
    packet: fixtureTransaction.packet, simulation: { status: "succeeded", contextSlot: 70n, unitsConsumed: 2n,
      logsHash: "c".repeat(64), returnDataHash: null, error: null }, warnings: [],
  };
  const fixtureReview = await createReviewHash(fixtureReviewBase);
  const fixturePreparedStep: MimirBetaPreparedStep = {
    step: fixtureStep, transaction: fixtureTransaction, review: fixtureReviewBase, ...fixtureReview,
  };
  const fixtureReceipt: MimirBetaStageReceipt = createMimirBetaStageReceipt({
    preparedStep: fixturePreparedStep, signature: fixtureSignature, attempt: 1, retryOfSignature: null, signedMessage: finalMessage,
  });
  const keys = staticMessageKeys(finalMessage);
  const burnOuterIndex = mimirBetaReviewedToWalletInstructionIndexesV1(fixtureTransaction.serializedMessage, finalMessage, burnSource).get(3) ?? 3;
  const transitionByAddress = new Map(allTransitions.map((entry) => [entry.address, entry]));
  const lamportByAddress = new Map(lamports.map((entry) => [entry.address, entry]));
  const proofAddresses = [...new Set(writes.flatMap((write) => write.proof.kind === "spl-token-burn-checked"
    ? [write.address, write.proof.mint] : [write.address]))];

  const verify = async (
    adjustments: ReadonlyMap<ReturnType<typeof addr>, bigint> = new Map(),
    options: Readonly<{ receiptOnly?: boolean; receipt?: MimirBetaStageReceipt; review?: MimirBetaCreationReviewV1; confirmed?: boolean; burnOuterIndex?: number }> = {},
  ): Promise<Awaited<ReturnType<typeof verifyMimirBetaFinalizedReceiptEvidence>> | Awaited<ReturnType<typeof observeMimirBetaConfirmedReceipt>>> => {
    const preBalances = keys.map((address) => {
      const transition = transitionByAddress.get(address);
      const lamport = lamportByAddress.get(address);
      if (transition) return transition.before?.lamports ?? 0n;
      return lamport?.beforeLamports ?? 1n;
    });
    const postBalances = keys.map((address, index) => {
      const transition = transitionByAddress.get(address);
      const lamport = lamportByAddress.get(address);
      const expected = transition ? transition.after?.lamports ?? 0n : lamport ?
        lamport.beforeLamports + lamport.programDeltaLamports - (index === 0 ? args.fee : 0n) : preBalances[index]!;
      return expected + (adjustments.get(address) ?? 0n);
    });
    const response = { slot: 71, blockTime: 72, version: 1, transaction: [base64(fixtureSignedBytes), "base64"], meta: {
      err: null, fee: Number(args.fee), preBalances: preBalances.map(Number), postBalances: postBalances.map(Number),
      preTokenBalances: args.kind === "composite" ? [{ accountIndex: keys.indexOf(burnSource), mint: burnMint, owner: payer,
        programId, uiTokenAmount: { amount: "10", decimals: 0 } }] : [],
      postTokenBalances: args.kind === "composite" ? [{ accountIndex: keys.indexOf(burnSource), mint: burnMint, owner: payer,
        programId, uiTokenAmount: { amount: "9", decimals: 0 } }] : [], loadedAddresses: { writable: [], readonly: [] },
      innerInstructions: args.kind === "composite" ? [{ index: options.burnOuterIndex ?? burnOuterIndex, instructions: [{ programIdIndex: keys.indexOf(programId),
        accounts: [keys.indexOf(burnSource), keys.indexOf(burnMint), keys.indexOf(payer)],
        data: bs58.encode(Uint8Array.of(15, 1, 0, 0, 0, 0, 0, 0, 0, 0)) }] }] : null,
    } };
    const decoded = decodeMimirBetaFinalizedTransactionResponse(fixtureSignature, response) as MimirBetaFinalizedTransactionEvidence;
    const postAccounts = proofAddresses.map((address) => {
      const transition = transitionByAddress.get(address);
      if (transition) {
        if (transition.after === null) return null;
        return { ...transition.after, lamports: transition.after.lamports + (adjustments.get(address) ?? 0n) };
      }
      const keyIndex = keys.indexOf(address);
      if (address === burnSource) {
        const tokenData = new Uint8Array(165); tokenData.set(addressBytes(burnMint)); tokenData.set(addressBytes(payer), 32);
        new DataView(tokenData.buffer).setBigUint64(64, 9n, true); tokenData[108] = 1;
        return { address, owner: programId, executable: false, lamports: postBalances[keyIndex]!, data: tokenData };
      }
      if (address === burnMint) {
        const mintData = new Uint8Array(82); new DataView(mintData.buffer).setBigUint64(36, 9n, true); mintData[45] = 1;
        return { address, owner: programId, executable: false, lamports: postBalances[keyIndex]!, data: mintData };
      }
      return { address, owner: programId, executable: false, lamports: postBalances[keyIndex]!, data: new Uint8Array() };
    });
    let selectedPreparedStep = fixturePreparedStep;
    let selectedReceipt = options.receipt ?? fixtureReceipt;
    if (options.review) {
      const selectedReviewHash = await createReviewHash(options.review);
      selectedPreparedStep = { ...fixturePreparedStep, review: options.review, ...selectedReviewHash };
      selectedReceipt = createMimirBetaStageReceipt({ preparedStep: selectedPreparedStep,
        signature: fixtureSignature, attempt: 1, retryOfSignature: null, signedMessage: finalMessage });
    }
    if (options.confirmed) {
      return observeMimirBetaConfirmedReceipt({ receipt: selectedReceipt, ...(options.receiptOnly ? {} : { preparedStep: selectedPreparedStep }), rpc: {
        getTransaction: (_signature: string, config: { commitment: string }) => ({ send: async () => config.commitment === "confirmed" ? response : null }),
        getMultipleAccounts: () => ({ send: async () => ({ context: { slot: 71 }, value: postAccounts.map((account) => account && {
          data: [base64(account.data), "base64"], owner: account.owner, executable: account.executable, lamports: Number(account.lamports) }) }) }),
        getSignatureStatuses: () => ({ send: async () => ({ context: { slot: 71 }, value: [{ slot: 71, confirmationStatus: "confirmed", confirmations: 1, err: null }] }) }),
        isBlockhashValid: () => ({ send: async () => ({ context: { slot: 71 }, value: true }) }),
      } as never });
    }
    return verifyMimirBetaFinalizedReceiptEvidence({ receipt: selectedReceipt,
      ...(options.receiptOnly ? {} : { preparedStep: selectedPreparedStep }), transaction: decoded,
      postAccounts: { slot: 71n, addresses: proofAddresses, value: postAccounts } });
  };
  return { writes, review: fixtureReviewBase, reviewHash: fixtureReview.reviewHash, receipt: fixtureReceipt,
    preparedStep: fixturePreparedStep, verify, finalMessage, signature: fixtureSignature, burnSource };
}

// R1: exercise the real RPC verifier with authenticated signed packet fixtures. These are
// verifier fixtures, not executable program/UI acceptance: only the reviewed proposal tag/key
// shape is modeled. Full creation packing/continuation remains in betaCreationStages fixtures.
{
  const proposal = addr(60); const unrelated = addr(61); const feed = addr(231);
  const [tickerAddress, tickerBump] = await deriveMimirBetaTickerPda(programId, "MIMIR");
  const configData = new Uint8Array(357); const configView = new DataView(configData.buffer);
  configData.set(new TextEncoder().encode("MIMIRCFG")); configView.setUint16(8, 1, true); configView.setUint16(10, 357, true); configView.setUint32(12, 1, true);
  configData.set(addressBytes(addr(6)), 16); configData.set(addressBytes(addr(220)), 48); configData.set(addressBytes(addr(221)), 80); configData[120] = 1; configData[121] = 1; configData[122] = 1; configData[312] = 1;
  configData.set([5, 77, 73, 77, 73, 82, 0], 313); configData.set(addressBytes(addr(7)), 325);
  const tickerData = new Uint8Array(43); tickerData.set(new TextEncoder().encode("MIMIRTIK"));
  tickerData[8] = 1; tickerData[9] = 2; tickerData[10] = tickerBump; tickerData.set(addressBytes(feed), 11);
  const configAccount: MimirBetaAccount = { address: feed, owner: programId, executable: false, lamports: 1n, data: configData };
  const tickerAccount: MimirBetaAccount = { address: tickerAddress, owner: programId, executable: false, lamports: 1n, data: tickerData };
  const unrelatedAccount: MimirBetaAccount = { ...stateAccount, address: unrelated };
  const proposalAt = (slot: bigint, variant: number): MimirBetaAccount => {
    const bytes = new Uint8Array(1000); const view = new DataView(bytes.buffer);
    view.setUint16(8, 1, true); view.setUint16(10, 608, true); view.setBigUint64(408, slot, true); view.setBigInt64(416, 20n, true);
    bytes[999] = variant;
    return { address: proposal, owner: programId, executable: false, lamports: 5n, data: bytes };
  };
  const accountWrite = async (address: typeof proposal, before: MimirBetaAccount | null, after: MimirBetaAccount | null,
    slot: bigint, codec?: "feed-plan-proposal-v1" | "ticker-claim-v1"): Promise<MimirBetaExpectedWrite> => ({
    address, effect: !after ? "close" : !before ? "create" : "write", ownerAfter: after?.owner ?? null,
    dataLengthAfter: after?.data.length ?? null, discriminatorHex: null, description: "chain fixture account",
    proof: { kind: "account", transition: !after ? "close" : !before ? "create" : "write", before: await fingerprintMimirBetaAccount(before),
      ...(before && address === proposal ? { beforeDataBase64: base64(before.data) } : {}),
      after: after ? { exists: true, owner: after.owner, executable: after.executable, lamports: after.lamports,
        data: codec ? { kind: "sdk-codec", codec, length: after.data.length,
          semanticHash: await createMimirBetaReconciliationSemanticHash({ codec, address, account: after, transactionSlot: slot, blockTime: 20n }) }
          : { kind: "exact", length: after.data.length, sha256: hex(await sha256(after.data)) } } : { exists: false, lamports: 0n } },
  });
  const makeChain = async (appends: number) => {
    const receipts: MimirBetaStageReceipt[] = []; const responses = new Map<string, ReturnType<typeof rawResponse>>();
    const accounts = new Map<typeof proposal, MimirBetaAccount | null>([[proposal, null], [unrelated, unrelatedAccount], [feed, configAccount], [tickerAddress, tickerAccount]]);
    let before: MimirBetaAccount | null = null;
    for (let ordinal = 0; ordinal <= appends + 2; ordinal++) {
      const slot = BigInt(20 + ordinal * 2); const activate = ordinal === appends + 1; const ready = ordinal === appends + 2;
      const stepId: MimirBetaPlanStep["stepId"] = ordinal === 0 ? "classic:proposal-init" : activate ? "classic:activate" : ready ? "classic:ready" : `classic:source-append:${ordinal - 1}` as MimirBetaPlanStep["stepId"];
      const after = activate || ready ? null : proposalAt(slot, ordinal);
      const writes = [await accountWrite(unrelated, unrelatedAccount, unrelatedAccount, slot),
        ...(!ready ? [await accountWrite(proposal, before, after, slot, after ? "feed-plan-proposal-v1" : undefined)] : []),
        ...(activate ? [await accountWrite(feed, null, configAccount, slot), await accountWrite(tickerAddress, null, tickerAccount, slot, "ticker-claim-v1")] : [])];
      const delta = writes.reduce((sum, w) => w.proof.kind === "account" ? sum + w.proof.after.lamports - w.proof.before.lamports : sum, 0n);
      if (delta) writes.push({ address: payer, effect: "lamports", ownerAfter: null, dataLengthAfter: null, discriminatorHex: null,
        description: "chain conservation", proof: { kind: "lamports", programDeltaLamports: -delta } });
      const addresses = ordinal === 0 ? [addr(80), addr(81), addr(82), addr(83), addr(84), proposal, unrelated] :
        [proposal, unrelated, ...(activate ? [feed, tickerAddress] : [])];
      const tx = await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: transaction.recentBlockhash, lastValidBlockHeight: 50n,
        instructions: [...(activate ? [1, 2].map((tag) => ({ programAddress: programId, accounts: [{ address: addr(7), isSigner: true, isWritable: true }], data: Uint8Array.of(tag) })) : []), { programAddress: programId, accounts: addresses.map((address) => ({ address, isSigner: false, isWritable: [proposal, unrelated, feed, tickerAddress].includes(address) })),
          data: ordinal === 0 ? Uint8Array.of(78, 2) : activate ? Uint8Array.of(80) : ready ? Uint8Array.of(90) : Uint8Array.of(78, 1, ordinal) }] });
      const planStep: MimirBetaPlanStep = { stepId, stage: "mimir-create", ordinal,
        prerequisiteStepIds: ordinal ? [receipts.at(-1)!.stepId] : [], requiredSigners: tx.requiredSigners, expectedWrites: writes };
      const writesHash = await createExpectedWritesHash(writes);
      const base: MimirBetaCreationReviewV1 = { ...reviewBase, feed, stepId, requiredSigners: tx.requiredSigners, expectedWrites: writes,
        expectedWritesHash: writesHash, stepIntentHash: await createStepIntentHash({ draftHash, step: planStep, expectedWritesHash: writesHash }),
        instructions: await Promise.all(tx.instructions.map(async (ix) => ({ programAddress: ix.programAddress, accounts: ix.accounts,
          dataBase64: base64(ix.data), dataSha256: hex(await sha256(ix.data)) }))), messageHash: tx.messageHash, packet: tx.packet,
        simulation: { ...reviewBase.simulation, contextSlot: slot - 1n } };
      const sigBytes = new Uint8Array(await webcrypto.subtle.sign("Ed25519", payerKeys.privateKey, tx.serializedMessage));
      const sig = bs58.encode(sigBytes);
      const receipt = createMimirBetaStageReceipt({ preparedStep: { step: planStep, transaction: tx, review: base, ...await createReviewHash(base) },
        signature: sig, attempt: 1, retryOfSignature: null });
      const keys = staticMessageKeys(tx.serializedMessage); const pre: bigint[] = keys.map((a) => a === payer ? 1000n : 1n); const post = [...pre];
      for (const w of writes) { const i = keys.indexOf(w.address);
        if (w.proof.kind === "account") { pre[i] = w.proof.before.lamports; post[i] = w.proof.after.lamports; }
        else if (w.proof.kind === "lamports") post[i] += w.proof.programDeltaLamports;
      }
      post[0] -= 1n;
      responses.set(sig, { ...rawResponse(null), slot: Number(slot), transaction: [base64(Uint8Array.from([...tx.serializedMessage, ...sigBytes, ...(activate ? new Uint8Array(64).fill(24) : [])])), "base64"],
        meta: { ...rawResponse(null).meta, preBalances: pre.map(Number), postBalances: post.map(Number) } });
      receipts.push(receipt); before = after;
    }
    const commitments: string[] = [];
    const chainRpc = { getTransaction: (sig: string, config: { commitment: string }) => ({ send: async () => { commitments.push(config.commitment); return responses.get(sig) ?? null; } }),
      getAccountInfo: () => ({ send: async () => null }),
      getMultipleAccounts: (addresses: readonly typeof proposal[], config: { commitment: string; minContextSlot?: bigint }) => ({ send: async () => {
        commitments.push(config.commitment);
        return { context: { slot: 40 }, value: addresses.map((address) => { const a = accounts.get(address);
          return a ? { owner: a.owner, executable: a.executable, lamports: Number(a.lamports), data: [base64(a.data), "base64"] } : null; }) };
      } }) };
    return { receipts, responses, accounts, commitments, chainRpc };
  };
  for (const appends of [0, 2]) {
    const f = await makeChain(appends);
    await assert.rejects(() => observeMimirBetaConfirmedReceipt({ rpc: f.chainRpc, receipt: f.receipts[0]! }), /postcondition/);
    f.commitments.length = 0;
    const confirmed = await observeMimirBetaConfirmedReceiptChain({ rpc: f.chainRpc, receipts: f.receipts });
    assert.deepEqual(confirmed.map((o) => o.state), f.receipts.map(() => "confirmed"));
    assert.deepEqual(confirmed.map((o) => o.signature), f.receipts.map((r) => r.signature));
    assert.deepEqual([...new Set(f.commitments)], ["confirmed"]);
    const plan = { draftHash, steps: f.receipts.map((r) => r.reviewedStep.step), receipts: f.receipts, observations: confirmed, observedSlot: 40n };
    assert.equal(reconcileMimirBetaConfirmedPreparationReceipts(plan).action, "await-finality");
    const ready = plan.steps.at(-1)!;
    assert.equal(reconcileMimirBetaConfirmedPreparationReceipts({ ...plan, receipts: f.receipts.slice(0, -1), observations: confirmed.slice(0, -1) }).nextStepId, ready.stepId);
    f.commitments.length = 0;
    const finalized = await observeMimirBetaReceiptChain({ rpc: f.chainRpc, receipts: f.receipts });
    assert.deepEqual([...new Set(f.commitments)], ["finalized"]);
    assert.equal(reconcileStepReceipts({ ...plan, observations: finalized }).action, "complete");
    const persisted = JSON.parse(JSON.stringify(f.receipts)) as MimirBetaStageReceipt[];
    assert.deepEqual(await observeMimirBetaReceiptChain({ rpc: f.chainRpc, receipts: persisted }), finalized, "durable chain needs no cached lineage or observation");
    assert.notDeepEqual(finalized, confirmed);
    await assert.rejects(() => observeMimirBetaConfirmedReceiptChain({ rpc: f.chainRpc, receipts: [...f.receipts].reverse() }), /order|prerequisites/);
    await assert.rejects(() => observeMimirBetaConfirmedReceiptChain({ rpc: f.chainRpc, receipts: f.receipts, minContextSlot: 41n }), /context regressed/);
    f.accounts.set(unrelated, { ...unrelatedAccount, data: Uint8Array.of(0, 0, 0) });
    await assert.rejects(() => observeMimirBetaConfirmedReceiptChain({ rpc: f.chainRpc, receipts: f.receipts }), /postcondition hash/);
    f.accounts.set(unrelated, unrelatedAccount);
    const activation = f.receipts.at(-2)!; const response = f.responses.get(activation.signature)!;
    f.responses.delete(activation.signature);
    const unavailable = await observeMimirBetaReceiptChain({ rpc: f.chainRpc, receipts: f.receipts });
    assert.equal(unavailable[0]!.state, "pending"); assert.equal(unavailable.at(-2)!.state, "pending");
    assert.equal(reconcileStepReceipts({ ...plan, observations: unavailable }).action, "await-finality");
    f.responses.set(activation.signature, response);
    const rebind = async (r: MimirBetaStageReceipt, change: (step: MimirBetaPlanStep, review: MimirBetaCreationReviewV1) => void) => {
      const step = structuredClone(r.reviewedStep.step); const review = structuredClone(r.reviewedStep.review);
      change(step, review);
      const expectedWritesHash = await createExpectedWritesHash(step.expectedWrites);
      const stepIntentHash = await createStepIntentHash({ draftHash: review.draftHash, step, expectedWritesHash });
      const base = { ...review, expectedWrites: step.expectedWrites, expectedWritesHash, stepIntentHash };
      const hash = await createReviewHash(base);
      return { ...r, draftHash: base.draftHash, expectedWritesHash, stepIntentHash, reviewHash: hash.reviewHash,
        reviewedStep: { step, review: base, ...hash } };
    };
    for (const mutation of ["bytes", "hash", "missing", "owner", "executable", "lamports", "length", "header", "runtime-slot", "runtime-time", "context", "authority", "draft", "message", "unrelated-proposal"] as const) {
      const altered = await rebind(activation, (step, review) => {
        const w = step.expectedWrites.find((w) => w.address === proposal)!;
        const proof = w.proof as Extract<MimirBetaExpectedWrite["proof"], { kind: "account" }>;
        const mutable = proof as unknown as { beforeDataBase64?: string; before: Record<string, unknown> };
        if (mutation === "bytes" || mutation === "header") { const b = Buffer.from(proof.beforeDataBase64!, "base64"); b[mutation === "header" ? 8 : 999] ^= 1;
          mutable.beforeDataBase64 = b.toString("base64"); if (mutation === "header") mutable.before.dataSha256 = createHash("sha256").update(b).digest("hex"); }
        if (mutation === "runtime-slot" || mutation === "runtime-time") { const b = Buffer.from(proof.beforeDataBase64!, "base64"); b[mutation === "runtime-slot" ? 408 : 416] ^= 1; mutable.beforeDataBase64 = b.toString("base64"); mutable.before.dataSha256 = createHash("sha256").update(b).digest("hex"); }
        if (mutation === "hash") mutable.before.dataSha256 = "f".repeat(64);
        if (mutation === "missing") delete mutable.beforeDataBase64;
        if (mutation === "owner") mutable.before.owner = addr(99);
        if (mutation === "executable") mutable.before.executable = true;
        if (mutation === "lamports") mutable.before.lamports = 6n;
        if (mutation === "length") mutable.before.dataLength = 608;
        if (mutation === "context") (review.simulation as { contextSlot: bigint }).contextSlot = 1n;
        if (mutation === "authority") (review as { authority: typeof payer }).authority = addr(99);
        if (mutation === "draft") (review as { draftHash: string }).draftHash = "e".repeat(64);
        if (mutation === "message") (review as { messageHash: string }).messageHash = "e".repeat(64);
        if (mutation === "unrelated-proposal") (w as { address: typeof proposal }).address = unrelated;
      });
      const receipts = f.receipts.map((r) => r === activation ? altered : r);
      await assert.rejects(() => observeMimirBetaConfirmedReceiptChain({ rpc: f.chainRpc, receipts }), (error: unknown) => error instanceof Error, mutation);
    }
    // A failed successor cannot bless an old proposal; its failed meta is checked before use.
    const failedPost = [...response.meta.preBalances]; failedPost[0] -= response.meta.fee;
    f.responses.set(activation.signature, { ...response, meta: { ...response.meta, postBalances: failedPost, err: { InstructionError: [0, "InvalidArgument"] } } });
    await assert.rejects(() => observeMimirBetaConfirmedReceiptChain({ rpc: f.chainRpc, receipts: f.receipts }), /postcondition/);
    const init = f.receipts[0]!; const initResponse = f.responses.get(init.signature)!;
    f.responses.set(activation.signature, response);
    const invalidPost = [...initResponse.meta.postBalances]; invalidPost[1] += 1;
    f.responses.set(init.signature, { ...initResponse, meta: { ...initResponse.meta, postBalances: invalidPost } });
    await assert.rejects(() => observeMimirBetaConfirmedReceiptChain({ rpc: f.chainRpc, receipts: f.receipts }), /lamport/);
    f.responses.set(init.signature, initResponse);
    f.responses.set(activation.signature, { ...response, transaction: rawResponse(null).transaction });
    await assert.rejects(() => observeMimirBetaConfirmedReceiptChain({ rpc: f.chainRpc, receipts: f.receipts }), /signature|message/);
  }
  // Expired latest step: the finalized prefix is reread at the expiry account context, so the expiry can be retried.
  const expiringChain = async (overrides: { valid?: boolean; accountsError?: () => Error } = {}) => {
    const f = await makeChain(0); f.responses.delete(f.receipts.at(-1)!.signature);
    const floors: bigint[] = []; let lagged = false;
    const rpc = { ...f.chainRpc,
      getSignatureStatuses: () => ({ send: async () => ({ context: { slot: 50 }, value: [null] }) }),
      isBlockhashValid: () => ({ send: async () => ({ context: { slot: 50 }, value: overrides.valid ?? false }) }),
      getFirstAvailableBlock: () => ({ send: async () => 0n }),
      getMultipleAccounts: (addresses: readonly typeof proposal[], config: { commitment: string; minContextSlot?: bigint }) => {
        floors.push(config.minContextSlot ?? 0n); const inner = f.chainRpc.getMultipleAccounts(addresses, config);
        return { send: async () => {
          if (overrides.accountsError) throw overrides.accountsError();
          if (!lagged) { lagged = true; throw kitLag(); }
          const value = await inner.send(); const floor = config.minContextSlot ?? 0n;
          return { ...value, context: { slot: floor > 40n ? Number(floor) : 40 } };
        } };
      } };
    return { f, floors, rpc };
  };
  {
    const { f, floors, rpc } = await expiringChain();
    const chain = await observeMimirBetaReceiptChain({ rpc, receipts: f.receipts, minContextSlot: 60n });
    assert.deepEqual(chain.map((o) => o.state), ["finalized", "finalized", "expired"]);
    assert.deepEqual(floors, [60n, 60n, 60n, 60n], "typed lag retries hold the caller floor; prefix rereads at the expiry context");
    const activation = chain[1]!; const expiry = chain[2]!;
    assert(activation.state === "finalized" && expiry.state === "expired");
    assert.equal(activation.writes.length, f.receipts[1]!.reviewedStep.step.expectedWrites.length);
    assert.equal(expiry.rollback, "baseline-matched"); assert.equal(expiry.accountContextSlot, 60n);
    assert(activation.accountContextSlot >= expiry.accountContextSlot);
    const plan = { draftHash, steps: f.receipts.map((r) => r.reviewedStep.step), receipts: f.receipts, observedSlot: expiry.observedSlot };
    const reconciled = reconcileStepReceipts({ ...plan, observations: chain });
    assert.deepEqual([reconciled.action, reconciled.nextStepId, reconciled.steps.map((s) => s.state)],
      ["retry-once", "classic:ready", ["finalized", "finalized", "failed"]]);
    assert.equal(reconcileStepReceipts({ ...plan, observations: [...chain.slice(0, -1), { ...expiry }] }).action, "blocked", "copied seal");
  }
  {
    const { f, floors, rpc } = await expiringChain({ valid: true });
    assert.deepEqual((await observeMimirBetaReceiptChain({ rpc, receipts: f.receipts })).map((o) => o.state), ["pending", "pending", "pending"]);
    assert.equal(floors.length, 0);
    const failing = await expiringChain({ accountsError: () => new Error("HTTP 503 Service Unavailable") });
    await assert.rejects(() => observeMimirBetaReceiptChain({ rpc: failing.rpc, receipts: failing.f.receipts }), /503/);
  }
  {
    const { f, rpc } = await expiringChain();
    const chain = await observeMimirBetaConfirmedReceiptChain({ rpc, receipts: f.receipts, minContextSlot: 90n });
    assert.deepEqual(chain.map((o) => o.state), ["finalized", "finalized", "expired"],
      "confirmed refresh retains chain-aware proposal supersession and rooted retry authority");
    assert.equal(reconcileMimirBetaConfirmedPreparationReceipts({ draftHash, steps: f.receipts.map((r) => r.reviewedStep.step),
      receipts: f.receipts, observations: chain, observedSlot: 90n }).action, "retry-once");
  }
}

// Paid composite activate + expired init (archived receipts, activation wire and finalized closures).
// Account context metadata is mocked above the caller floor; archived bytes are not a historical proof at that slot.
{
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/compositeExpiredInitChain.json", import.meta.url), "utf8"),
    (_key, value) => value?.$mimir === "bigint" ? BigInt(value.value) : value) as {
    receipts: MimirBetaStageReceipt[]; initFloor: bigint; activationResponse: unknown; statuses: unknown[]; validity: unknown;
    firstAvailableBlock: number; closures: { addresses: string[]; accounts: ({ address: string; data: string; owner: string; lamports: string; executable: boolean } | null)[] }[];
  };
  const [activate, init] = fixture.receipts as [MimirBetaStageReceipt, MimirBetaStageReceipt];
  const returnedContext = fixture.initFloor + 4n; const floors: bigint[] = []; let statusIndex = 0; let lagged = false;
  const rpc = {
    getTransaction: (sig: string) => ({ send: async () => sig === activate.signature ? fixture.activationResponse : null }),
    getSignatureStatuses: () => ({ send: async () => fixture.statuses[Math.min(statusIndex++, fixture.statuses.length - 1)] }),
    isBlockhashValid: () => ({ send: async () => fixture.validity }),
    getFirstAvailableBlock: () => ({ send: async () => fixture.firstAvailableBlock }),
    getMultipleAccounts: (addresses: readonly string[], config: { minContextSlot: bigint }) => ({ send: async () => {
      floors.push(config.minContextSlot);
      if (!lagged) { lagged = true; throw kitLag(); }
      const closure = fixture.closures.find((c) => addresses.every((a) => c.addresses.includes(a)))!;
      return { context: { slot: Number(addresses.length === 2 ? returnedContext : config.minContextSlot) }, value: addresses.map((a) => {
        const x = closure.accounts[closure.addresses.indexOf(a)];
        return x && { data: [x.data, "base64"], owner: x.owner, lamports: BigInt(x.lamports), executable: x.executable };
      }) };
    } }),
  };
  const chain = await observeMimirBetaReceiptChain({ rpc: rpc as never, receipts: fixture.receipts, minContextSlot: fixture.initFloor });
  assert.deepEqual(chain.map((o) => o.state), ["finalized", "expired"]);
  const [activation, expiry] = chain;
  assert(activation!.state === "finalized" && expiry!.state === "expired");
  assert.equal(activation.writes.length, activate.reviewedStep.step.expectedWrites.length);
  assert.equal(expiry.rollback, "baseline-matched"); assert.equal(expiry.accountContextSlot, returnedContext);
  assert(expiry.accountContextSlot > fixture.initFloor);
  assert.deepEqual(floors, [fixture.initFloor, fixture.initFloor, returnedContext], "prefix rereads at the returned expiry context");
  const plan = { draftHash: activate.draftHash, steps: fixture.receipts.map((r) => r.reviewedStep.step), receipts: fixture.receipts, observedSlot: expiry.observedSlot };
  const reconciled = reconcileStepReceipts({ ...plan, observations: chain });
  assert.deepEqual([reconciled.action, reconciled.nextStepId, reconciled.steps.map((s) => s.state)],
    ["retry-once", init.stepId, ["finalized", "failed"]]);
  assert.equal(init.stepId, "composite:init");
  assert.equal(reconcileStepReceipts({ ...plan, observations: [activation, { ...expiry }] }).action, "blocked", "copied seal");
}

const classicAction = fixtureAccount(addr(30), 5n, 30);
const classicProposal = fixtureAccount(addr(31), 50n, 31);
const classicFeed = fixtureAccount(addr(32), 10n, 32);
const classicPlan = fixtureAccount(addr(33), 20n, 33);
const classicActivation = await balanceFixture({
  kind: "classic", stepId: "classic:activate", fee: 3n,
  transitions: [
    { address: classicAction.address, transition: "write", before: classicAction, after: { ...classicAction, data: Uint8Array.of(34) } },
    { address: classicProposal.address, transition: "close", before: classicProposal, after: null },
    { address: classicFeed.address, transition: "create", before: null, after: classicFeed },
    { address: classicPlan.address, transition: "create", before: null, after: classicPlan },
  ],
  lamports: [{ address: payer, beforeLamports: 1_000n, programDeltaLamports: 20n }],
});
assert.equal((await classicActivation.verify()).state, "finalized", "classic multi-create/close/refund/payer proof must verify");
assert.equal((await classicActivation.verify(new Map(), { receiptOnly: true })).state, "finalized",
  "classic fused identity roles must reconcile from the durable receipt alone");
const persistedClassicReceipt = JSON.parse(JSON.stringify(classicActivation.receipt)) as MimirBetaStageReceipt;
assert.equal((await classicActivation.verify(new Map(), { receipt: persistedClassicReceipt, receiptOnly: true })).state, "finalized",
  "JSON-persisted account deletion must authenticate and reconcile from the durable receipt alone");
const noncanonicalClassicReceipt = JSON.parse(JSON.stringify(classicActivation.receipt).replaceAll(
  '"after":{"exists":false,"lamports":"0"}', '"after":{"exists":false,"lamports":"00"}')) as MimirBetaStageReceipt;
await assert.rejects(() => authenticateMimirBetaReviewedStep(noncanonicalClassicReceipt), /post lamports is not canonical unsigned bigint/);

const compositeAction = fixtureAccount(addr(40), 5n, 40);
const metadataData = (asset: ReturnType<typeof addr>, name: string, immutable = 1) => {
  const value = new TextEncoder().encode(name); const key = new TextEncoder().encode("mimir.display_name.v1");
  const metadata = new Uint8Array(332); metadata.set([48,145,12,249,176,141,197,187]); metadata.set(addressBytes(asset), 8);
  metadata[40] = immutable; metadata[41] = 7; new DataView(metadata.buffer).setUint32(42, key.length, true); metadata.set(key, 46);
  const valueOffset = 46 + key.length; new DataView(metadata.buffer).setUint32(valueOffset, value.length, true); metadata.set(value, valueOffset + 4);
  return metadata;
};
const metadataAddress = addr(60); const metadataOwner = addr(63);
const canonicalMetadata = { address: metadataAddress, owner: metadataOwner, executable: false, lamports: 9n,
  data: metadataData(addr(61), "Café Index") } satisfies MimirBetaAccount;
const canonicalMetadataHash = await createMimirBetaReconciliationSemanticHash({ codec: "identity-display-name-v1",
  address: metadataAddress, account: canonicalMetadata, transactionSlot: 70n, blockTime: null });
assert.notEqual(canonicalMetadataHash, await createMimirBetaReconciliationSemanticHash({ codec: "identity-display-name-v1",
  address: metadataAddress, account: { ...canonicalMetadata, data: metadataData(addr(61), "Renamed Index") }, transactionSlot: 70n, blockTime: null }));
assert.notEqual(canonicalMetadataHash, await createMimirBetaReconciliationSemanticHash({ codec: "identity-display-name-v1",
  address: metadataAddress, account: { ...canonicalMetadata, data: metadataData(addr(62), "Café Index") }, transactionSlot: 70n, blockTime: null }));
await assert.rejects(() => createMimirBetaReconciliationSemanticHash({ codec: "identity-display-name-v1",
  address: metadataAddress, account: { ...canonicalMetadata, data: metadataData(addr(61), "Café Index", 0) }, transactionSlot: 70n, blockTime: null }));
const compositeConfig = fixtureAccount(addr(41), 10n, 41);
const compositeVault = fixtureAccount(addr(42), 10n, 42);
const compositeLock = fixtureAccount(addr(43), 10n, 43);

const locallyReadonlyIdentityReview: MimirBetaCreationReviewV1 = {
  ...classicActivation.review,
  instructions: classicActivation.review.instructions.map((instruction) => ({ ...instruction,
    accounts: instruction.accounts.map((account) => account.address === classicActivation.review.identityAsset ?
      { ...account, isWritable: false } : account) })),
};
await assert.rejects(() => classicActivation.verify(new Map(), {
  receiptOnly: true,
  review: locallyReadonlyIdentityReview,
}), /global account roles differ|reviewed-step authority invalid/, "raw global writable role must equal the reviewed transaction-wide union");

const changedClassicWrites = classicActivation.writes.map((write) => write.address === classicFeed.address && write.proof.kind === "account" && write.proof.after.exists ? {
  ...write, proof: { ...write.proof, after: { ...write.proof.after, lamports: write.proof.after.lamports + 1n } },
} : write);
const changedClassicWritesHash = await createExpectedWritesHash(changedClassicWrites);
const changedClassicReviewHash = (await createReviewHash({ ...classicActivation.review,
  expectedWrites: changedClassicWrites, expectedWritesHash: changedClassicWritesHash })).reviewHash;
assert.notEqual(changedClassicReviewHash, classicActivation.reviewHash, "review hash must commit exact post lamports");

const distinctProposal = fixtureAccount(addr(50), 50n, 50);
const distinctConfig = fixtureAccount(addr(51), 30n, 51);
const distinctRefund = addr(52);
const distinctRefundFixture = await balanceFixture({
  kind: "classic", stepId: "classic:activate", fee: 3n,
  transitions: [
    { address: distinctProposal.address, transition: "close", before: distinctProposal, after: null },
    { address: distinctConfig.address, transition: "create", before: null, after: distinctConfig },
  ],
  lamports: [
    { address: distinctRefund, beforeLamports: 200n, programDeltaLamports: 50n },
    { address: payer, beforeLamports: 1_000n, programDeltaLamports: -30n },
  ],
});
assert.equal((await distinctRefundFixture.verify()).state, "finalized", "ABI-valid distinct refund recipient must verify generically");
await assert.rejects(() => distinctRefundFixture.verify(new Map([[payer, 1n], [distinctRefund, -1n]])),
  /lamport delta differs from review/, "balanced payer/refund redistribution must not bypass exact reviewed deltas");

const conflictingProofFixture = await balanceFixture({
  kind: "classic", stepId: "classic:activate", fee: 3n,
  transitions: [{ address: compositeConfig.address, transition: "create", before: null, after: compositeConfig }],
  lamports: [
    { address: compositeConfig.address, beforeLamports: 0n, programDeltaLamports: 10n },
    { address: payer, beforeLamports: 1_000n, programDeltaLamports: -10n },
  ],
});
await assert.rejects(() => conflictingProofFixture.verify(), /account and lamport proofs conflict/);

const zeroProofFixture = await balanceFixture({
  kind: "classic", stepId: "classic:activate", fee: 3n, transitions: [],
  lamports: [{ address: payer, beforeLamports: 1_000n, programDeltaLamports: 0n }],
});
await assert.rejects(() => zeroProofFixture.verify(), /lamport proof is incoherent/);

const duplicateRefund = addr(60);
const duplicateProofFixture = await balanceFixture({
  kind: "classic", stepId: "classic:activate", fee: 3n, transitions: [],
  lamports: [
    { address: duplicateRefund, beforeLamports: 200n, programDeltaLamports: 10n },
    { address: duplicateRefund, beforeLamports: 200n, programDeltaLamports: 10n },
    { address: payer, beforeLamports: 1_000n, programDeltaLamports: -10n },
  ],
});
await assert.rejects(() => duplicateProofFixture.verify(), /duplicate expected proof identity/);

const setU16 = (bytes: Uint8Array, offset: number, value: number) => new DataView(bytes.buffer).setUint16(offset, value, true);
const setU64 = (bytes: Uint8Array, offset: number, value: bigint) => new DataView(bytes.buffer).setBigUint64(offset, value, true);
const setU128 = (bytes: Uint8Array, offset: number, value: bigint) => {
  setU64(bytes, offset, value); setU64(bytes, offset + 8, value >> 64n);
};
const readinessRing = (slot: bigint) => {
  const bytes = new Uint8Array(544); bytes.set(buildTestSourceObservationRingHeader());
  setU16(bytes, 10, 544); setU16(bytes, 50, 1); bytes[53] = 0; setU16(bytes, 54, 1); setU16(bytes, 56, 300);
  setU16(bytes, 58, 0); setU16(bytes, 60, 1); setU64(bytes, 64, slot); setU64(bytes, 72, slot); setU64(bytes, 80, 0n);
  setU128(bytes, 88, 1n); setU128(bytes, 112, 1n); setU128(bytes, 128, 1n); bytes.fill(1, 184, 216);
  setU128(bytes, 144, 0n); setU64(bytes, 160, 0n);
  setU128(bytes, 320, 1n); setU128(bytes, 336, 1n); setU64(bytes, 352, 1n); setU16(bytes, 360, 50);
  bytes[369] = 1; bytes.fill(0, 370, 448); setU64(bytes, 448, slot); setU64(bytes, 456, 0n);
  for (const offset of [464, 480, 496, 512, 528]) setU128(bytes, offset, 1n);
  return bytes;
};
const readinessSnapshot = (snapshotSlot: bigint, spotSlot = snapshotSlot) => buildTestSnapshotHeader((bytes) => {
  bytes[107] = 1; bytes[108] = 0; bytes[109] = 1; setU64(bytes, 116, snapshotSlot); setU64(bytes, 124, snapshotSlot + 20n);
  setU64(bytes, 140, spotSlot); setU64(bytes, 148, spotSlot); setU64(bytes, 156, 0n);
  for (const offset of [164, 172, 180]) setU64(bytes, offset, 0n);
  bytes[252] = 1; bytes[253] = 1; bytes[254] = 1;
  setU16(bytes, 255, 10_000); setU64(bytes, 294, 1n); bytes[334] = 0; bytes[335] = 1;
});
const semanticAccount = (bytes: Uint8Array): MimirBetaAccount => ({ address: stateAddress, owner: programId,
  executable: false, lamports: 5n, data: bytes });
const assertSemanticInputImmutable = async (codec: Parameters<typeof createMimirBetaReconciliationSemanticHash>[0]["codec"],
  bytes: Uint8Array, options: Partial<Parameters<typeof createMimirBetaReconciliationSemanticHash>[0]> = {}) => {
  const offsetBacking = Buffer.alloc(bytes.length + 8, 0xa5); offsetBacking.set(bytes, 4);
  const variants: Uint8Array[] = [Uint8Array.from(bytes), Buffer.from(bytes), offsetBacking.subarray(4, bytes.length + 4)];
  let expectedHash: string | null = null;
  for (const input of variants) {
    const before = Buffer.isBuffer(input) ? Buffer.from(input) : Uint8Array.from(input);
    const args = { codec, address: stateAddress, account: semanticAccount(input), transactionSlot: 70n,
      blockTime: null, ...options };
    const first = await createMimirBetaReconciliationSemanticHash(args);
    const second = await createMimirBetaReconciliationSemanticHash(args);
    assert.deepEqual(input, before, `${codec} must not mutate caller bytes`);
    assert.equal(second, first, `${codec} repeat hash must be stable`);
    expectedHash ??= first; assert.equal(first, expectedHash, `${codec} Buffer and Uint8Array hashes must match`);
  }
};

const proposalBytes = new Uint8Array(608); setU16(proposalBytes, 8, 1); setU16(proposalBytes, 10, 608);
setU64(proposalBytes, 408, 70n); setU64(proposalBytes, 416, 72n);
await assertSemanticInputImmutable("feed-plan-proposal-v1", proposalBytes, { blockTime: 72n });
await assertSemanticInputImmutable("source-ring-v1", readinessRing(70n));
await assertSemanticInputImmutable("feed-snapshot-v0", readinessSnapshot(70n));

const collateralLock = new Uint8Array(160); collateralLock.set(new TextEncoder().encode("MIMIRCOL"));
setU64(collateralLock, 120, 70n); setU64(collateralLock, 128, 72n);
await assertSemanticInputImmutable("mimir-exact-layout-v1", collateralLock, { blockTime: 72n });

const originalRingHash = await createMimirBetaReconciliationSemanticHash({ codec: "source-ring-v1", address: stateAddress,
  account: semanticAccount(readinessRing(70n)), transactionSlot: 70n, blockTime: null });
assert.equal(originalRingHash, await createMimirBetaReconciliationSemanticHash({ codec: "source-ring-v1", address: stateAddress,
  account: semanticAccount(readinessRing(75n)), transactionSlot: 70n, accountContextSlot: 75n, blockTime: null }));
await assert.rejects(() => createMimirBetaReconciliationSemanticHash({ codec: "source-ring-v1", address: stateAddress,
  account: semanticAccount(readinessRing(76n)), transactionSlot: 70n, accountContextSlot: 75n, blockTime: null }));
await assert.rejects(() => createMimirBetaReconciliationSemanticHash({ codec: "source-ring-v1", address: stateAddress,
  account: semanticAccount(readinessRing(70n)), transactionSlot: 70n, accountContextSlot: 69n, blockTime: null }));
const driftedRing = readinessRing(75n); driftedRing[216] ^= 1;
assert.notEqual(originalRingHash, await createMimirBetaReconciliationSemanticHash({ codec: "source-ring-v1", address: stateAddress,
  account: semanticAccount(driftedRing), transactionSlot: 70n, accountContextSlot: 75n, blockTime: null }));
const unsupported784Ring = new Uint8Array(784); unsupported784Ring.set(readinessRing(70n)); setU16(unsupported784Ring, 10, 784);
await assert.rejects(() => createMimirBetaReconciliationSemanticHash({ codec: "source-ring-v1", address: stateAddress,
  account: semanticAccount(unsupported784Ring), transactionSlot: 70n, blockTime: null }));
const originalSnapshotHash = await createMimirBetaReconciliationSemanticHash({ codec: "feed-snapshot-v0", address: stateAddress,
  account: semanticAccount(readinessSnapshot(70n)), transactionSlot: 70n, blockTime: null });
assert.equal(originalSnapshotHash, await createMimirBetaReconciliationSemanticHash({ codec: "feed-snapshot-v0", address: stateAddress,
  account: semanticAccount(readinessSnapshot(75n, 74n)), transactionSlot: 70n, accountContextSlot: 75n, blockTime: null }));
await assert.rejects(() => createMimirBetaReconciliationSemanticHash({ codec: "feed-snapshot-v0", address: stateAddress,
  account: semanticAccount(readinessSnapshot(76n)), transactionSlot: 70n, accountContextSlot: 75n, blockTime: null }));
await assert.rejects(() => createMimirBetaReconciliationSemanticHash({ codec: "feed-snapshot-v0", address: stateAddress,
  account: semanticAccount(readinessSnapshot(75n, 76n)), transactionSlot: 70n, accountContextSlot: 75n, blockTime: null }));

const nativeCapture = JSON.parse(fs.readFileSync(new URL("./fixtures/nativeMonoPublicProjectionCapture.json", import.meta.url), "utf8")) as {
  contextSlot: number; addresses: string[]; accounts: Array<{ owner: string; executable: boolean; data: [string, "base64"] }>;
};
const nativeContextSlot = BigInt(nativeCapture.contextSlot);
const nativeAccount = (index: number): MimirBetaAccount => ({ address: nativeCapture.addresses[index]! as MimirBetaAccount["address"],
  owner: nativeCapture.accounts[index]!.owner as MimirBetaAccount["owner"], executable: nativeCapture.accounts[index]!.executable,
  lamports: 10n, data: Uint8Array.from(Buffer.from(nativeCapture.accounts[index]!.data[0], "base64")) });
const nativeSnapshotAccount = nativeAccount(0); const nativeTwapAccount = nativeAccount(1); const nativeRingAccount = nativeAccount(2);
const nativeProgram = nativeSnapshotAccount.owner;
const nativeWrites = (ring: MimirBetaAccount, twap: MimirBetaAccount, snapshot: MimirBetaAccount) => [
  { codec: "native-mono-source-ring-v1" as const, address: ring.address, account: ring },
  { codec: "native-mono-feed-twap-v0" as const, address: twap.address, account: twap },
  { codec: "native-mono-feed-snapshot-v0" as const, address: snapshot.address, account: snapshot },
];
const baseNativeWrites = nativeWrites(nativeRingAccount, nativeTwapAccount, nativeSnapshotAccount);
await assertMimirBetaNativeRefreshTrios({ writes: baseNativeWrites, programId: nativeProgram,
  transactionSlot: nativeContextSlot, accountContextSlot: nativeContextSlot });
const nativeSemanticHashes = async (writes: ReturnType<typeof nativeWrites>, transactionSlot: bigint) => Promise.all(writes.map((write) =>
  createMimirBetaReconciliationSemanticHash({ codec: write.codec, address: write.address, account: write.account,
    transactionSlot, accountContextSlot: transactionSlot, blockTime: null })));
const baseNativeHashes = await nativeSemanticHashes(baseNativeWrites, nativeContextSlot);
const driftedNativeRing = { ...nativeRingAccount, data: Uint8Array.from(nativeRingAccount.data) };
const driftedNativeTwap = { ...nativeTwapAccount, data: Uint8Array.from(nativeTwapAccount.data) };
const driftedNativeSnapshot = { ...nativeSnapshotAccount, data: Uint8Array.from(nativeSnapshotAccount.data) };
for (const offset of [64, 72, 448]) setU64(driftedNativeRing.data, offset,
  new DataView(driftedNativeRing.data.buffer, driftedNativeRing.data.byteOffset).getBigUint64(offset, true) + 1n);
for (const offset of [56, 64, 72, 136]) setU64(driftedNativeTwap.data, offset,
  new DataView(driftedNativeTwap.data.buffer, driftedNativeTwap.data.byteOffset).getBigUint64(offset, true) + 1n);
for (const offset of [116, 124, 132, 156, 164, 172, 180]) setU64(driftedNativeSnapshot.data, offset,
  new DataView(driftedNativeSnapshot.data.buffer, driftedNativeSnapshot.data.byteOffset).getBigUint64(offset, true) + 1n);
const driftedNativeWrites = nativeWrites(driftedNativeRing, driftedNativeTwap, driftedNativeSnapshot);
const driftedContextSlot = nativeContextSlot + 1n;
await assertMimirBetaNativeRefreshTrios({ writes: driftedNativeWrites, programId: nativeProgram,
  transactionSlot: driftedContextSlot, accountContextSlot: driftedContextSlot });
const driftedNativeHashes = await nativeSemanticHashes(driftedNativeWrites, driftedContextSlot);
assert.deepEqual(driftedNativeHashes, baseNativeHashes, "native temporal output drift keeps all three semantic hashes stable");
const nativeStepFor = (writes: ReturnType<typeof nativeWrites>, hashes: readonly string[]): MimirBetaPlanStep => ({
  stepId: "composite:activate", stage: "mimir-create", ordinal: 1, prerequisiteStepIds: ["classic:activate"],
  requiredSigners: [payer], expectedWrites: writes.map((write, index): MimirBetaExpectedWrite => ({
    address: write.address, effect: "write", ownerAfter: nativeProgram, dataLengthAfter: write.account.data.length,
    discriminatorHex: null, description: "native refresh", proof: { kind: "account", transition: "write",
      before: { exists: true, owner: nativeProgram, executable: false, lamports: 10n,
        dataLength: write.account.data.length, dataSha256: "f".repeat(64) },
      after: { exists: true, lamports: 10n, owner: nativeProgram, executable: false,
        data: { kind: "sdk-codec", codec: write.codec, length: write.account.data.length, semanticHash: hashes[index]! } } },
  })),
});
const nativeDraftHash = "3".repeat(64);
const nativeBaseStep = nativeStepFor(baseNativeWrites, baseNativeHashes);
const nativeDriftedStep = nativeStepFor(driftedNativeWrites, driftedNativeHashes);
const nativeBaseExpectedWritesHash = await createExpectedWritesHash(nativeBaseStep.expectedWrites);
const nativeDriftedExpectedWritesHash = await createExpectedWritesHash(nativeDriftedStep.expectedWrites);
assert.equal(nativeBaseExpectedWritesHash, nativeDriftedExpectedWritesHash);
assert.equal(await createStepIntentHash({ draftHash: nativeDraftHash, step: nativeBaseStep,
  expectedWritesHash: nativeBaseExpectedWritesHash }), await createStepIntentHash({ draftHash: nativeDraftHash,
  step: nativeDriftedStep, expectedWritesHash: nativeDriftedExpectedWritesHash }));
const changedNativeIdentity = Uint8Array.from(nativeRingAccount.data); changedNativeIdentity[16] ^= 1;
const changedNativePlan = Uint8Array.from(nativeRingAccount.data); changedNativePlan[280] ^= 1;
assert.notEqual(baseNativeHashes[0], await createMimirBetaReconciliationSemanticHash({ codec: "native-mono-source-ring-v1",
  address: nativeRingAccount.address, account: { ...nativeRingAccount, data: changedNativeIdentity },
  transactionSlot: nativeContextSlot, accountContextSlot: nativeContextSlot, blockTime: null }));
assert.notEqual(baseNativeHashes[0], await createMimirBetaReconciliationSemanticHash({ codec: "native-mono-source-ring-v1",
  address: nativeRingAccount.address, account: { ...nativeRingAccount, data: changedNativePlan },
  transactionSlot: nativeContextSlot, accountContextSlot: nativeContextSlot, blockTime: null }));
const changedNativeAssurance = Uint8Array.from(nativeRingAccount.data); changedNativeAssurance[369] = 1;
await assert.rejects(() => createMimirBetaReconciliationSemanticHash({ codec: "native-mono-source-ring-v1",
  address: nativeRingAccount.address, account: { ...nativeRingAccount, data: changedNativeAssurance },
  transactionSlot: nativeContextSlot, accountContextSlot: nativeContextSlot, blockTime: null }));
const changedNativeMantissa = Uint8Array.from(nativeSnapshotAccount.data);
setU64(changedNativeMantissa, 188, new DataView(changedNativeMantissa.buffer).getBigUint64(188, true) + 1n);
await assert.rejects(() => createMimirBetaReconciliationSemanticHash({ codec: "native-mono-feed-snapshot-v0",
  address: nativeSnapshotAccount.address, account: { ...nativeSnapshotAccount, data: changedNativeMantissa },
  transactionSlot: nativeContextSlot, accountContextSlot: nativeContextSlot, blockTime: null }));
const incoherentNativeTwap = Uint8Array.from(nativeTwapAccount.data); incoherentNativeTwap[192] ^= 1;
await assert.rejects(() => assertMimirBetaNativeRefreshTrios({ writes: nativeWrites(nativeRingAccount,
  { ...nativeTwapAccount, data: incoherentNativeTwap }, nativeSnapshotAccount), programId: nativeProgram,
  transactionSlot: nativeContextSlot, accountContextSlot: nativeContextSlot }));

{
  const source = addr(0x52); const mint = addr(0x53); const program = addr(0x54);
  const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as ReturnType<typeof addr>;
  const computeBudget = "ComputeBudget111111111111111111111111111111" as ReturnType<typeof addr>;
  const burnIx = { programAddress: program, accounts: [
    { address: payer, isSigner: true, isWritable: true },
    { address: source, isSigner: false, isWritable: true },
    { address: mint, isSigner: false, isWritable: true },
    { address: tokenProgram, isSigner: false, isWritable: false },
  ], data: Uint8Array.of(7) };
  const otherIx = { ...burnIx, data: Uint8Array.of(8) };
  const price = { programAddress: computeBudget, accounts: [], data: Uint8Array.of(3, 9, 0, 0, 0, 0, 0, 0, 0) };
  const limit = { programAddress: computeBudget, accounts: [], data: Uint8Array.of(2, 9, 0, 0, 0) };
  const lifetime = { feePayer: payer, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 100n };
  const tokenData = new Uint8Array(165);
  tokenData.set(addressBytes(mint), 0); tokenData.set(addressBytes(payer), 32);
  new DataView(tokenData.buffer).setBigUint64(64, 9n, true); tokenData[108] = 1;
  const mintData = new Uint8Array(82); new DataView(mintData.buffer).setBigUint64(36, 9n, true); mintData[45] = 1;
  const postAccounts = { slot: 11n, addresses: [source, mint], value: [
    { address: source, owner: tokenProgram, executable: false, lamports: 1n, data: tokenData },
    { address: mint, owner: tokenProgram, executable: false, lamports: 1n, data: mintData },
  ] };
  type Ix = typeof burnIx | typeof price;
  const run = async (reviewedInstructions: Ix[], walletInstructions: Ix[], reviewedIndex: number, groupIndexes: number[], amount = 1) => {
    const reviewedTx = await compileMimirBetaTransactionV1({ ...lifetime, instructions: reviewedInstructions });
    const expectedWrites: MimirBetaExpectedWrite[] = [{ address: source, effect: "token-burn", ownerAfter: tokenProgram, dataLengthAfter: 165,
      discriminatorHex: null, description: "coherent collateral burn proof", proof: { kind: "spl-token-burn-checked",
        tokenProgram, mint, sourceTokenAccount: source, authority: payer, amountRaw: BigInt(amount), decimals: 0, outerInstructionIndex: reviewedIndex } }] as never;
    const step = { stepId: "classic:source-append:0", stage: "mimir-create", ordinal: 0, prerequisiteStepIds: [],
      requiredSigners: [payer], expectedWrites } as unknown as MimirBetaPlanStep;
    const draftHash = "1".repeat(64); const expectedWritesHash = await createExpectedWritesHash(expectedWrites);
    const stepIntentHash = await createStepIntentHash({ draftHash, step, expectedWritesHash });
    const review = { schema: "mimir-beta-creation-review", version: 1, draftHash, stepId: step.stepId, kind: "classic", cluster: "localnet",
      programId: program, authority: payer, feedId: addr(0x56), feed: source, identityAsset: addr(0x57), ticker: "MIMIR", displayName: null,
      requiredSigners: reviewedTx.requiredSigners, instructions: reviewedTx.instructions.map((ix) => ({ programAddress: ix.programAddress,
        accounts: ix.accounts, dataBase64: base64(ix.data), dataSha256: createHash("sha256").update(ix.data).digest("hex") })), expectedWrites,
      messageHash: reviewedTx.messageHash, stepIntentHash, expectedWritesHash, packet: reviewedTx.packet,
      simulation: { status: "succeeded", contextSlot: 10n, unitsConsumed: 1n, logsHash: "2".repeat(64), returnDataHash: null, error: null },
      warnings: [] } as unknown as MimirBetaCreationReviewV1;
    const preparedStep = { step, transaction: reviewedTx, review, ...await createReviewHash(review) } as unknown as MimirBetaPreparedStep;
    const walletTx = await compileMimirBetaTransactionV1({ ...lifetime, instructions: walletInstructions });
    const walletSigned = await partiallySignMimirBetaTransactionV1({ transaction: walletTx, signerAddress: payer, keyPair: payerKeys });
    const signed = await verifyMimirBetaWalletSignedTransactionV1({ transaction: reviewedTx, walletAddress: payer,
      walletSignedTransaction: walletSigned.serializedTransaction, preservedSignatures: [] });
    const receipt = JSON.parse(JSON.stringify(createMimirBetaStageReceipt({ preparedStep, signature: signed.firstSignature, attempt: 1,
      retryOfSignature: null, signedMessage: signed.serializedMessage }))) as MimirBetaStageReceipt;
    await authenticateMimirBetaReviewedStep(receipt);
    const accountKeys = getCompiledTransactionMessageDecoder().decode(signed.serializedMessage).staticAccounts;
    const tokenBalance = (amount: number) => ({ accountIndex: accountKeys.indexOf(source), mint, owner: payer, programId: tokenProgram,
      uiTokenAmount: { amount: String(amount), decimals: 0 } });
    const preBalances = accountKeys.map((_, index): number => index === 0 ? 100 : 1); const postBalances = [...preBalances]; postBalances[0] = 99;
    const response = { slot: 11, blockTime: 20, version: 1, transaction: [base64(signed.serializedTransaction), "base64"], meta: {
      err: null, fee: 1, preBalances, postBalances, preTokenBalances: [tokenBalance(10)], postTokenBalances: [tokenBalance(10 - amount)],
      loadedAddresses: { writable: [], readonly: [] }, innerInstructions: groupIndexes.map((index) => ({ index, instructions: [{
        programIdIndex: accountKeys.indexOf(tokenProgram), accounts: [accountKeys.indexOf(source), accountKeys.indexOf(mint), accountKeys.indexOf(payer)],
        data: bs58.encode(Uint8Array.of(15, amount, 0, 0, 0, 0, 0, 0, 0, 0)) }] })) } };
    const finalized = decodeMimirBetaFinalizedTransactionResponse(signed.firstSignature, response as never);
    assert.ok(finalized);
    return verifyMimirBetaFinalizedReceiptEvidence({ receipt, transaction: finalized, postAccounts: postAccounts as never });
  };
  // D0: ComputeBudget directives are TxV1 config on both the reviewed and the wallet message, never body instructions.
  const cases: [Ix[], Ix[], number, number][] = [
    [[burnIx], [burnIx], 0, 0],
    [[price, burnIx], [burnIx], 0, 0],
    [[burnIx], [limit, burnIx], 0, 0],
    [[burnIx], [burnIx, price], 0, 0],
  ];
  for (const [reviewed, wallet, reviewedIndex, walletIndex] of cases) {
    assert.equal((await run(reviewed, wallet, reviewedIndex, [walletIndex])).state, "finalized");
  }
  // Tariff 0: the program still CPIs BurnChecked with amount 0 (mainnet Z1), so a landed 0-amount burn finalizes.
  assert.equal((await run([burnIx], [burnIx], 0, [0], 0)).state, "finalized");
  const rejectsConflict = (promise: Promise<unknown>, message: RegExp) =>
    assert.rejects(promise, (error: { code?: string; message: string }) => error.code === "RECONCILIATION_CONFLICT" && message.test(error.message));
  await rejectsConflict(run([burnIx], [price, burnIx], 0, [1]), /BurnChecked CPI proof is missing or duplicated/);
  await assert.rejects(run([burnIx], [price, burnIx], 0, [0, 0]), (error: { code?: string }) => error.code === "TRANSACTION_MALFORMED");
  const reviewedPair = await compileMimirBetaTransactionV1({ ...lifetime, instructions: [price, burnIx, otherIx] });
  const reorderedPair = await compileMimirBetaTransactionV1({ ...lifetime, instructions: [otherIx, burnIx] });
  const feeOnlyPair = await compileMimirBetaTransactionV1({ ...lifetime, instructions: [burnIx, limit, otherIx] });
  assert.equal(reviewedPair.packet.instructionCount, 2, "the reviewed price directive is hoisted into config");
  assert.throws(() => mimirBetaReviewedToWalletInstructionIndexesV1(reviewedPair.serializedMessage, reorderedPair.serializedMessage));
  assert.deepEqual([...mimirBetaReviewedToWalletInstructionIndexesV1(reviewedPair.serializedMessage, feeOnlyPair.serializedMessage)], [[0, 0], [1, 1]]);
}

console.log("beta reconciliation tests passed");

// A finalized TxV1 an RPC re-encodes as `legacy` is accepted only when bound to the stored signed receipt message.
{
  const { getTransactionEncoder, getTransactionDecoder } = await import("@solana/transactions");
  const { decodeMimirBetaReceiptTransactionResponse } = await import("../src/beta/rpc.js");
  type Patch = { blockhash?: string; data?: number; signers?: (keys: Address[]) => Address[] };
  type Address = ReturnType<typeof addr>;
  const legacyOf = (message: Uint8Array, signatures: readonly Uint8Array[], patch: Patch = {}) => {
    const v1 = getCompiledTransactionMessageDecoder().decode(message);
    if (v1.version !== 1) throw new Error("fixture is not v1");
    const signers = v1.staticAccounts.slice(0, v1.header.numSignerAccounts);
    const order = patch.signers ? patch.signers([...signers]) : signers;
    const messageBytes = getCompiledTransactionMessageEncoder().encode({ version: "legacy", header: v1.header,
      staticAccounts: [...order, ...v1.staticAccounts.slice(signers.length)], lifetimeToken: patch.blockhash ?? v1.lifetimeToken,
      instructions: v1.instructionHeaders.map((header, index) => ({ programAddressIndex: header.programAccountIndex,
        accountIndices: [...v1.instructionPayloads[index]!.instructionAccountIndices],
        data: patch.data === undefined ? v1.instructionPayloads[index]!.instructionData : Uint8Array.of(patch.data) })) } as never);
    return new Uint8Array(getTransactionEncoder().encode({ messageBytes,
      signatures: Object.fromEntries(order.map((key) => [key, signatures[signers.indexOf(key)]!])) } as never));
  };
  const legacyResponse = (wire: Uint8Array) => ({ ...rawResponse(null), version: "legacy", transaction: [base64(wire), "base64"] });
  const receiptMessage = new Uint8Array(Buffer.from(receipt.messageBase64, "base64"));
  const legacyWire = legacyOf(receiptMessage, [signatureBytes]);
  assert.notDeepEqual(legacyWire, signedBytes);
  const adapted = await decodeMimirBetaReceiptTransactionResponse(signature, legacyResponse(legacyWire), receiptMessage);
  assert(adapted);
  assert.deepEqual(adapted.transactionBytes, signedBytes, "reconstructs the original TxV1 bytes");
  assert.deepEqual(adapted.signatures, [signature]);
  assert.deepEqual(adapted.meta, finalized.meta, "meta passes through unchanged");
  assert.deepEqual(await decodeMimirBetaReceiptTransactionResponse(signature, rawResponse(null), receiptMessage), finalized, "v1 path unchanged");
  assert.equal(await decodeMimirBetaReceiptTransactionResponse(signature, null, receiptMessage), null, "history gap stays null");
  const legacyRpc = { ...rpc, getTransaction: () => ({ send: async () => legacyResponse(legacyWire) }) };
  assert.equal((await observeMimirBetaReceipt({ rpc: legacyRpc, receipt, preparedStep })).state, "finalized");
  assert.equal((await observeMimirBetaConfirmedReceipt({ rpc: { ...rpc, getTransaction: () => ({ send: async () => null }) }, receipt })).state, "pending");
  assert.throws(() => decodeMimirBetaFinalizedTransactionResponse(signature, legacyResponse(legacyWire)), /not Transaction v1/, "absent receipt rejects");
  const reject = (wire: Uint8Array, message = receiptMessage, response: object = legacyResponse(wire), sig = signature) =>
    assert.rejects(() => decodeMimirBetaReceiptTransactionResponse(sig, response, message), /TRANSACTION_MALFORMED|transaction|Transaction/);
  const substitutedMessage = receiptMessage.slice(); substitutedMessage[substitutedMessage.length - 1] ^= 1;
  await reject(legacyWire, substitutedMessage);
  const badSignature = signatureBytes.slice(); badSignature[5] ^= 1;
  await reject(legacyOf(receiptMessage, [badSignature]), receiptMessage, legacyResponse(legacyOf(receiptMessage, [badSignature])), bs58.encode(badSignature));
  await reject(legacyWire, receiptMessage, legacyResponse(legacyWire), bs58.encode(badSignature));
  await reject(legacyOf(receiptMessage, [signatureBytes], { blockhash: bs58.encode(Uint8Array.from({ length: 32 }, () => 5)) }));
  await reject(legacyOf(receiptMessage, [signatureBytes], { data: 8 }));
  // Only a canonical `legacy` message: a redundant-zero account-count shortvec and a lookup-free v0 labeled legacy are refused.
  const countOffset = 1 + getCompiledTransactionMessageDecoder().decode(receiptMessage).header.numSignerAccounts * 64 + 3;
  await reject(Uint8Array.from([...legacyWire.slice(0, countOffset), legacyWire[countOffset]! | 0x80, 0, ...legacyWire.slice(countOffset + 1)]));
  const decodedLegacy = getTransactionDecoder().decode(legacyWire);
  const asV0 = { ...getCompiledTransactionMessageDecoder().decode(decodedLegacy.messageBytes), version: 0, addressTableLookups: [] };
  await reject(new Uint8Array(getTransactionEncoder().encode({ ...decodedLegacy, messageBytes: getCompiledTransactionMessageEncoder().encode(asV0 as never) } as never)));
  await reject(legacyWire, receiptMessage, { ...legacyResponse(legacyWire), meta: { ...rawResponse(null).meta, fee: -1 } });
  await reject(legacyWire, receiptMessage, { ...legacyResponse(legacyWire), transaction: [base64(legacyWire), "base58"] });
  await assert.rejects(() => observeMimirBetaReceipt({ rpc: { ...rpc, getTransaction: () => ({ send: async () =>
    legacyResponse(legacyOf(receiptMessage, [signatureBytes], { data: 8 })) }) }, receipt }));

  // Two signers, built through the SDK's own TxV1 builder with deterministic keys.
  const seeded = async (byte: number) => {
    const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, byte)]);
    const privateKey = await webcrypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
    const jwk = await webcrypto.subtle.exportKey("jwk", privateKey);
    const publicKey = await webcrypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, true, ["verify"]);
    return { privateKey, address: await getAddressFromPublicKey(publicKey) };
  };
  const [first, second] = [await seeded(41), await seeded(42)];
  const two = await compileMimirBetaTransactionV1({ feePayer: first.address, recentBlockhash: bs58.encode(Uint8Array.from({ length: 32 }, () => 4)),
    lastValidBlockHeight: 50n, instructions: [{ programAddress: programId, data: Uint8Array.of(7), accounts: [
      { address: second.address, isSigner: true, isWritable: false }, { address: stateAddress, isSigner: false, isWritable: true }] }] });
  const twoMessage = new Uint8Array(two.serializedMessage);
  const twoSigners = getCompiledTransactionMessageDecoder().decode(twoMessage).staticAccounts.slice(0, 2);
  assert.deepEqual(twoSigners, [first.address, second.address]);
  const twoSignatures = [new Uint8Array(await webcrypto.subtle.sign("Ed25519", first.privateKey, twoMessage)),
    new Uint8Array(await webcrypto.subtle.sign("Ed25519", second.privateKey, twoMessage))];
  const twoOriginal = new Uint8Array([...twoMessage, ...twoSignatures[0]!, ...twoSignatures[1]!]);
  assert.equal(Object.keys(getTransactionDecoder().decode(twoOriginal).signatures).length, 2);
  const twoAdapted = await decodeMimirBetaReceiptTransactionResponse(bs58.encode(twoSignatures[0]!),
    legacyResponse(legacyOf(twoMessage, twoSignatures)), twoMessage);
  assert.deepEqual(twoAdapted?.transactionBytes, twoOriginal);
  assert.deepEqual(twoAdapted?.signatures, twoSignatures.map((entry) => bs58.encode(entry)));
  const forged = twoSignatures[1]!.slice(); forged[0] ^= 1;
  await reject(legacyOf(twoMessage, [twoSignatures[0]!, forged]), twoMessage, legacyResponse(legacyOf(twoMessage, [twoSignatures[0]!, forged])),
    bs58.encode(twoSignatures[0]!));
  const swapped = legacyOf(twoMessage, twoSignatures, { signers: (keys) => keys.reverse() });
  await reject(swapped, twoMessage, legacyResponse(swapped), bs58.encode(twoSignatures[0]!));
  await reject(legacyOf(twoMessage, [twoSignatures[1]!, twoSignatures[0]!]), twoMessage,
    legacyResponse(legacyOf(twoMessage, [twoSignatures[1]!, twoSignatures[0]!])), bs58.encode(twoSignatures[1]!));
}
