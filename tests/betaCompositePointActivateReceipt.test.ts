import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authenticateMimirBetaReviewedStep, type MimirBetaStageReceipt } from "../src/beta/review.js";

// Inert historical fixture: a pre-ABI-1 tag-65 Composite activation. The release reviewer no longer recognizes that route.
const receipt = JSON.parse(readFileSync(new URL("./fixtures/compositePointActivateReceipt.json", import.meta.url), "utf8")) as MimirBetaStageReceipt;
const tags = receipt.reviewedStep.review.instructions.map(({ dataBase64 }) => Buffer.from(dataBase64, "base64")[0]);
assert.ok(tags.includes(65));
await assert.rejects(authenticateMimirBetaReviewedStep(receipt), (error: Error) => /RECEIPT_MISMATCH/.test(error.message));
console.log("beta composite point activate receipt tests passed");
