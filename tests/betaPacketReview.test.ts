import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const sha256Sync = (data: Uint8Array) => Uint8Array.from(createHash("sha256").update(data).digest());
import { webcrypto } from "node:crypto";
import bs58 from "bs58";
import { getAddressFromPublicKey } from "@solana/addresses";
import { base64, bytesAddress, hex, sha256 } from "../src/beta/bytes.js";
import {
  authenticateMimirBetaReviewedStep,
  createDraftHash,
  createExpectedWritesHash,
  createMessageHash,
  createMimirBetaStageReceipt,
  createReviewHash,
  createStepIntentHash,
  reconcileStageReceipts,
  verifyOrphanIdentityBinding,
  type MimirBetaStageReceipt,
} from "../src/beta/review.js";
import { compileMimirBetaTransactionV1 } from "../src/beta/transactionV1.js";

const addr = (byte: number) => bytesAddress(Uint8Array.from({ length: 32 }, () => byte));

const draftA = await createDraftHash({ schema: "mimir-beta-draft", version: 1, count: 1n });
const draftB = await createDraftHash({ count: 1n, version: 1, schema: "mimir-beta-draft" });
assert.equal(draftA.draftHash, draftB.draftHash);
assert.notEqual((await createDraftHash({ schema: "mimir-beta-draft", version: 1, count: 2n })).draftHash, draftA.draftHash);
assert.notEqual((await createReviewHash({ blockhash: "a", bytes: Uint8Array.of(1) })).reviewHash, (await createReviewHash({ blockhash: "b", bytes: Uint8Array.of(1) })).reviewHash);

const payerKeys = await webcrypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
const payer = await getAddressFromPublicKey(payerKeys.publicKey);
const asset = addr(7); const programId = addr(9);
const transaction = await compileMimirBetaTransactionV1({ feePayer: payer,
  recentBlockhash: bs58.encode(Uint8Array.from({ length: 32 }, () => 4)), lastValidBlockHeight: 50n,
  instructions: Array.from({ length: 5 }, (_, index) => ({ programAddress: programId,
    accounts: index === 0 ? [{ address: asset, isSigner: true, isWritable: true }] : [],
    data: index === 2 ? Uint8Array.of(78, 2) : index === 3 ? Uint8Array.of(78, 1) : new Uint8Array() })) });
const messageHash = await createMessageHash(transaction.serializedMessage);
const step = { stepId: "classic:activate" as const, stage: "mimir-create" as const, ordinal: 0, prerequisiteStepIds: [], requiredSigners: transaction.requiredSigners, expectedWrites: [] };
const expectedWritesHash = await createExpectedWritesHash([]);
const emptyDataHash = hex(await sha256(new Uint8Array()));
const stepIntentHash = await createStepIntentHash({ draftHash: draftA.draftHash, step, expectedWritesHash });
const reviewBase = { schema: "mimir-beta-creation-review" as const, version: 1 as const, draftHash: draftA.draftHash,
  stepId: step.stepId, kind: "classic" as const, cluster: "localnet" as const, programId, authority: payer,
  feedId: addr(10), feed: addr(11), identityAsset: asset, ticker: "MIMIR", displayName: null, requiredSigners: step.requiredSigners,
  instructions: transaction.instructions.map((instruction) => ({ programAddress: instruction.programAddress, accounts: instruction.accounts,
    dataBase64: base64(instruction.data), dataSha256: instruction.data.length ? hex(sha256Sync(instruction.data)) : emptyDataHash })),
  expectedWrites: [], messageHash, stepIntentHash, expectedWritesHash,
  packet: transaction.packet,
  simulation: { status: "succeeded" as const, contextSlot: 1n, unitsConsumed: 1n, logsHash: "0".repeat(64), returnDataHash: null, error: null }, warnings: [] };
const review = await createReviewHash(reviewBase);
const compositeReview = await createReviewHash({ ...reviewBase, kind: "composite", stepId: "composite:activate",
  displayName: "Café Index", instructions: [...reviewBase.instructions, reviewBase.instructions[0]!],
  packet: { ...reviewBase.packet, instructionCount: 4 } });
const renamedReview = await createReviewHash({ ...reviewBase, kind: "composite", stepId: "composite:activate",
  displayName: "Renamed Index", instructions: [...reviewBase.instructions, reviewBase.instructions[0]!],
  packet: { ...reviewBase.packet, instructionCount: 4 } });
assert.match(compositeReview.canonicalReviewJson, /"displayName":"Café Index"/);
assert.notEqual(compositeReview.reviewHash, renamedReview.reviewHash, "the exact reviewed display name is hash-bound");
const preparedStep = { step, transaction, review: reviewBase, ...review };
const payerSignature = bs58.encode(new Uint8Array(await webcrypto.subtle.sign("Ed25519", payerKeys.privateKey, transaction.serializedMessage)));
const receipt: MimirBetaStageReceipt = createMimirBetaStageReceipt({ preparedStep,
  signature: payerSignature, attempt: 1, retryOfSignature: null });
assert.equal((await authenticateMimirBetaReviewedStep(receipt)).reviewHash, receipt.reviewHash);
assert.equal(Object.isFrozen(receipt.reviewedStep.review), true);
assert.throws(() => createMimirBetaStageReceipt({
  preparedStep: { ...preparedStep, review: { ...reviewBase, privateKey: "must-never-be-persisted" } as never },
  signature: receipt.signature,
  attempt: 1,
  retryOfSignature: null,
}));
const persisted = JSON.stringify(receipt);
for (const forbidden of ["serializedMessage", "serializedTransaction", "transactionBytes", "signedBytes", "wallet", "seed", "privateKey", "CryptoKey"]) {
  assert.equal(persisted.includes(`"${forbidden}"`), false);
}
const restoredReceipt = JSON.parse(persisted) as MimirBetaStageReceipt;
assert.equal((await authenticateMimirBetaReviewedStep(restoredReceipt)).reviewHash, receipt.reviewHash);
const { reviewedStep: _omitted, ...oldReceipt } = receipt;
assert.throws(() => reconcileStageReceipts({ draftHash: draftA.draftHash, steps: [step], receipts: [oldReceipt as never], observations: [], observedSlot: 1n }));
const withLineage = (reviewedStep: MimirBetaStageReceipt["reviewedStep"]) => ({ ...receipt, reviewedStep }) as MimirBetaStageReceipt;
await assert.rejects(() => authenticateMimirBetaReviewedStep(withLineage({ ...receipt.reviewedStep, canonicalReviewJson: "{}" })));
await assert.rejects(() => authenticateMimirBetaReviewedStep(withLineage({ ...receipt.reviewedStep,
  review: { ...receipt.reviewedStep.review, instructions: receipt.reviewedStep.review.instructions.map((instruction, index) =>
    index === 0 ? { ...instruction, dataBase64: "AA==" } : instruction) } })));
await assert.rejects(() => authenticateMimirBetaReviewedStep(withLineage({ ...receipt.reviewedStep,
  review: { ...receipt.reviewedStep.review, instructions: receipt.reviewedStep.review.instructions.map((instruction, index) =>
    index === 0 ? { ...instruction, accounts: [{ address: addr(13), isSigner: false, isWritable: true }] } : instruction) } })));
await assert.rejects(() => authenticateMimirBetaReviewedStep(withLineage({ ...receipt.reviewedStep,
  review: { ...receipt.reviewedStep.review, packet: { ...receipt.reviewedStep.review.packet,
    config: { ...receipt.reviewedStep.review.packet.config, computeUnitLimit: 1 } } as never } })));
await assert.rejects(() => authenticateMimirBetaReviewedStep(withLineage({ ...receipt.reviewedStep,
  step: { ...receipt.reviewedStep.step, ordinal: 1 } })));
await assert.rejects(() => authenticateMimirBetaReviewedStep(withLineage({ ...receipt.reviewedStep,
  step: { ...receipt.reviewedStep.step, prerequisiteStepIds: ["classic:proposal-init"] } })));
await assert.rejects(() => authenticateMimirBetaReviewedStep(withLineage({ ...receipt.reviewedStep,
  step: { ...receipt.reviewedStep.step, requiredSigners: [addr(1), addr(8)] } })));
await assert.rejects(() => authenticateMimirBetaReviewedStep({ ...receipt, messageHash: "f".repeat(64) }));
await assert.rejects(() => authenticateMimirBetaReviewedStep({ ...receipt, draftHash: "f".repeat(64) }));
assert.throws(() => reconcileStageReceipts({ draftHash: draftA.draftHash, steps: [step], receipts: [receipt, receipt], observations: [], observedSlot: 1n }));
assert.equal(reconcileStageReceipts({ draftHash: draftA.draftHash, steps: [step], receipts: [receipt], observations: [
  { stepId: step.stepId, signature: receipt.signature, state: "pending" }], observedSlot: 1n }).action, "await-finality");
const failedObservation = { stepId: step.stepId, signature: receipt.signature, state: "failed" as const, observedSlot: 2n,
  messageHash, errorHash: "e".repeat(64), rollback: "baseline-matched" as const, evidenceHash: "f".repeat(64) };
const failed = reconcileStageReceipts({ draftHash: draftA.draftHash, steps: [step], receipts: [receipt], observations: [failedObservation], observedSlot: 2n });
assert.equal(failed.steps.find((entry) => entry.stepId === step.stepId)!.state, "failed");
const retryReviewBase = { ...reviewBase, messageHash: "2".repeat(64) };
const retryReview = await createReviewHash(retryReviewBase);
const retry = createMimirBetaStageReceipt({ preparedStep: { ...preparedStep,
  transaction: { ...transaction, messageHash: retryReviewBase.messageHash },
  review: retryReviewBase, ...retryReview }, attempt: 2,
  signature: bs58.encode(Uint8Array.from({ length: 64 }, () => 2)), retryOfSignature: receipt.signature });
assert.throws(() => reconcileStageReceipts({ draftHash: draftA.draftHash, steps: [step], receipts: [receipt, retry], observations: [
  { ...failedObservation, signature: retry.signature, observedSlot: 3n, messageHash: retry.messageHash }], observedSlot: 3n }));
assert.equal(reconcileStageReceipts({ draftHash: draftA.draftHash, steps: [step], receipts: [receipt], observations: [
  { stepId: step.stepId, signature: receipt.signature, state: "finalized", observedSlot: 2n, accountContextSlot: 2n,
    messageHash: "b".repeat(64), evidenceHash: "3".repeat(64), writes: [] }], observedSlot: 2n }).steps[0]!.state, "conflict");
assert.equal(reconcileStageReceipts({ draftHash: draftA.draftHash, steps: [step], receipts: [receipt], observations: [
  { stepId: step.stepId, signature: receipt.signature, state: "finalized", observedSlot: 2n, accountContextSlot: 2n,
    messageHash, evidenceHash: "3".repeat(64), writes: [] }], observedSlot: 2n }).action, "complete");
verifyOrphanIdentityBinding({ expectedDraftHash: draftA.draftHash, receipt, creatorMatches: true, assetMatches: true, atomDisabled: true, collectionMatches: true, pointerLockedAndMatches: true, coreOwnerVerified: true, conflictingMimirConfigExists: false });
assert.throws(() => verifyOrphanIdentityBinding({ expectedDraftHash: draftA.draftHash, receipt, creatorMatches: true, assetMatches: true, atomDisabled: true, collectionMatches: true, pointerLockedAndMatches: false, coreOwnerVerified: true, conflictingMimirConfigExists: false }));

console.log("beta packet/review tests passed");
