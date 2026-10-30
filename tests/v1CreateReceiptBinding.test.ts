import assert from "node:assert/strict";
import fs from "node:fs";
import { bytesAddress } from "../src/beta/bytes.js";
import { authenticateMimirBetaReviewedStep, createReviewHash, reconcileStepReceipts } from "../src/beta/review.js";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/v1CreateClassicReceipt.json", import.meta.url), "utf8"),
  (_key, value) => value && value.$mimir === "bigint" ? BigInt(value.value) : value);
const receipt = fixture.receipt;
const lineage = await authenticateMimirBetaReviewedStep(receipt);
const reconciled = reconcileStepReceipts({ draftHash: receipt.draftHash, steps: [lineage.step], receipts: [receipt],
  observations: [fixture.observation], observedSlot: fixture.observation.observedSlot });
assert.equal(reconciled.action, "complete");
assert.equal(reconciled.steps[0]!.state, "finalized");

async function rebound(patch: object) {
  const review = { ...receipt.reviewedStep.review, ...patch };
  const { reviewHash, canonicalReviewJson } = await createReviewHash(review);
  return { ...receipt, reviewHash, reviewedStep: { ...receipt.reviewedStep, review, reviewHash, canonicalReviewJson } };
}
const foreign = { feed: bytesAddress(new Uint8Array(32).fill(91)), feedId: bytesAddress(new Uint8Array(32).fill(92)), ticker: "FOREIGN" };
await authenticateMimirBetaReviewedStep(await rebound({}));
for (const patch of [foreign, { feed: foreign.feed }, { feedId: foreign.feedId }, { ticker: foreign.ticker }]) {
  await assert.rejects(authenticateMimirBetaReviewedStep(await rebound(patch)), /RECEIPT_MISMATCH|reviewed-step authority/);
}
console.log("v1CreateReceiptBinding: ok");
