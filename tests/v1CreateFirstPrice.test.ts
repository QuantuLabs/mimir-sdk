// CREATE + first price in one TxV1: the `firstPrice` suffix of `prepareReview` and its review authentication.
import assert from "node:assert/strict";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Address } from "@solana/addresses";
import { getAddressFromPublicKey } from "@solana/addresses";
import { createKeyPairFromPrivateKeyBytes, signBytes } from "@solana/keys";
import bs58 from "bs58";
import { prepareReview } from "../src/beta/creation.js";
import { authenticateMimirBetaReviewedStep, createMimirBetaStageReceipt, createReviewHash, isV1CreationReview,
  type MimirBetaPreparedStep, type MimirBetaStageReceipt } from "../src/beta/review.js";
import { deriveMimirBetaPda, deriveMimirBetaTickerPda, encodeMimirBetaTicker } from "../src/beta/abi.js";
import { addressBytes, base64, bytesAddress } from "../src/beta/bytes.js";
import { MIMIR_BETA_SYSTEM_PROGRAM_ID } from "../src/beta/deployment.js";
import type { MimirBetaInstruction } from "../src/beta/types.js";
import { encodeMimirFusedClassicData } from "../src/beta/classicExecution.js";

// (5) Suffix-free V1 CREATE receipts authenticate with an identical reviewHash.
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/v1CreateClassicReceipt.json", import.meta.url), "utf8"),
  (_key, value) => value && value.$mimir === "bigint" ? BigInt(value.value) : value);
const captured = fixture.receipt as MimirBetaStageReceipt;
// App-signed receipts archived from journey storage (localnet MAG5: the dropped attempt and its replacement).
const mag5 = JSON.parse(gunzipSync(fs.readFileSync(new URL("./create/fixtures/v1-mag5-replacement.json.gz", import.meta.url))).toString("utf8"));
for (const receipt of [captured, ...mag5.receipts as MimirBetaStageReceipt[]]) {
  const lineage = await authenticateMimirBetaReviewedStep(receipt);
  assert.equal((await createReviewHash(lineage.review)).reviewHash, receipt.reviewHash);
  assert.equal(lineage.review.firstPrice, undefined);
}
const capturedLineage = await authenticateMimirBetaReviewedStep(captured);

const fixed = (byte: number) => bytesAddress(new Uint8Array(32).fill(byte));
const meta = (address: Address, isSigner = false, isWritable = false) => ({ address, isSigner, isWritable });
const pair = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(1));
const payer = await getAddressFromPublicKey(pair.publicKey);
const program = fixed(10), feedId = fixed(21), registry = fixed(7), other = fixed(9);
const [feed] = await deriveMimirBetaPda({ programId: program, seed: "feed_snapshot", values: [addressBytes(feedId)] });
const [ticker] = await deriveMimirBetaTickerPda(program, "MIMIR");
const createData = new Uint8Array(16 + 313 + 12); createData.set([93, 1, 0]); createData.set(addressBytes(feedId), 32);
createData.set(encodeMimirBetaTicker("MIMIR"), 16 + 313);
const create: MimirBetaInstruction = { programAddress: program, accounts: [meta(payer, true, true), meta(feed, false, true), meta(ticker, false, true)], data: createData };
const firstPriceData = (patch: object = {}) => encodeMimirFusedClassicData({ feedId: addressBytes(feedId), declaredMaxSnapshotAge: 150, previousSnapshotRevision: 0n,
  nextSnapshotRevision: 1n, componentCount: 1, sourceSetRevision: 1n, planHash: new Uint8Array(32), converterSourceCount: 0, feedConfigRevision: 1n, ringNewestSlots: [0n], ...patch });
const tag89 = (patch: Partial<MimirBetaInstruction> = {}): MimirBetaInstruction =>
  ({ programAddress: program, accounts: [meta(feed, false, true), meta(registry)], data: firstPriceData(), ...patch });

const deployment = { cluster: "localnet", mimirProgramId: program, systemProgramId: MIMIR_BETA_SYSTEM_PROGRAM_ID };
type State = { owner: Address; executable: boolean; lamports: bigint; data: Uint8Array };
const rpcValue = (s: State | null) => s ? { owner: s.owner, executable: s.executable, lamports: s.lamports, data: [base64(s.data), "base64"] } : null;
const payerState: State = { owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false, lamports: 1_000_000_000n, data: new Uint8Array() };
const feedState: State = { owner: program, executable: false, lamports: 3_000_000n, data: new Uint8Array(64) };
const tickerState: State = { owner: program, executable: false, lamports: 1_000_000n, data: new Uint8Array(43) };
// Malicious RPC: it reports `other` (a system account) receiving lamports, as if the suffix moved the payer's SOL there.
const after = (a: Address) => a === feed ? feedState : a === ticker ? tickerState : a === payer ? { ...payerState, lamports: payerState.lamports - 4_000_000n }
  : a === other ? { ...payerState, lamports: 1_000_000n } : null;
const review = (extra: Record<string, unknown>, stepId = "classic:activate", instructions = [create]) => prepareReview({
  dependencies: { deployment, rpc: {
    getLatestBlockhash: () => ({ send: async () => ({ context: { slot: 100 }, value: { blockhash: fixed(99), lastValidBlockHeight: 99n } }) }),
    getMultipleAccounts: (addresses: readonly Address[]) => ({ send: async () => ({ context: { slot: 100 },
      value: addresses.map((a) => a === payer ? rpcValue(payerState) : null) }) }),
    simulateTransaction: (_w: string, config: { accounts: { addresses: readonly Address[] } }) => ({ send: async () => ({ context: { slot: 101 },
      value: { err: null, logs: [], unitsConsumed: 1_000, returnData: null, accounts: config.accounts.addresses.map((a) => rpcValue(after(a))) } }) }),
  } } as never,
  contextSlot: 100n, draftHash: "ab".repeat(32), plan: { authority: payer, cluster: "localnet", programId: program } as never,
  step: { stepId, stage: "mimir-create", ordinal: 0, prerequisiteStepIds: [], requiredSigners: [payer], expectedWrites: [] } as never,
  instructions,
  specs: [{ kind: "account", address: feed, transition: "create", ownerAfter: program, dataLengthAfter: 64, description: "create feed" },
    { kind: "account", address: ticker, transition: "create", ownerAfter: program, dataLengthAfter: 43, description: "claim ticker" }] as never,
  target: { kind: "classic", feedId, feed, identityAsset: payer, ticker: "MIMIR", displayName: null } as never,
  ...extra,
} as never);
const receiptOf = async (prepared: MimirBetaPreparedStep) => {
  const signature = await signBytes(pair.privateKey, prepared.transaction.serializedMessage);
  return createMimirBetaStageReceipt({ preparedStep: prepared, signature: bs58.encode(signature), attempt: 1, retryOfSignature: null });
};
/** Re-binds a review patch to the receipt (hashes recomputed): only the patched field differs. */
const rebound = async (receipt: MimirBetaStageReceipt, patch: object) => {
  const r = { ...receipt.reviewedStep.review, ...patch } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete r[k];
  const { reviewHash, canonicalReviewJson } = await createReviewHash(r);
  return { ...receipt, reviewHash, reviewedStep: { ...receipt.reviewedStep, review: r, reviewHash, canonicalReviewJson } } as unknown as MimirBetaStageReceipt;
};

// (1) A merged [93, 89] review authenticates; expectedWrites match the CREATE-only review.
const plain = await review({});
assert.equal(plain.review.firstPrice, undefined);
await authenticateMimirBetaReviewedStep(await receiptOf(plain));
const merged = await review({ firstPrice: { instructions: [tag89()] } });
assert.deepEqual(merged.review.firstPrice, { instructionCount: 1 });
assert.deepEqual(merged.review.instructions.map((i) => Buffer.from(i.dataBase64, "base64")[0]), [93, 89]);
const mergedReceipt = await receiptOf(merged);
const lineage = await authenticateMimirBetaReviewedStep(mergedReceipt);
assert.equal(isV1CreationReview(lineage.review), true);
assert.deepEqual(merged.step.expectedWrites.map((w) => [w.address, w.effect]), plain.step.expectedWrites.map((w) => [w.address, w.effect]));

// (2) prepareReview refusals.
for (const [extra, stepId] of [
  [{ firstPrice: { instructions: [tag89()] } }, "classic:publish"],
  [{ firstPrice: { instructions: [tag89(), tag89()] } }],
  [{ firstPrice: { instructions: [tag89({ programAddress: other })] } }],
  [{ firstPrice: { instructions: [tag89({ data: Uint8Array.of(87) })] } }],
  [{ firstPrice: { instructions: [tag89({ accounts: [meta(registry, false, true)] })] } }],
  [{ firstPrice: { instructions: [tag89({ accounts: [meta(feed)] })] } }],
  [{ firstPrice: { instructions: [tag89({ accounts: [meta(feed, false, true), meta(other, true)] })] } }],
  [{ firstPrice: { instructions: [tag89({ data: Uint8Array.of(89, 1) })] } }],
  [{ firstPrice: { instructions: [tag89({ data: firstPriceData({ feedId: addressBytes(other) }) })] } }],
  [{ firstPrice: { instructions: [tag89({ data: firstPriceData({ previousSnapshotRevision: 1n, nextSnapshotRevision: 2n }) })] } }],
  [{ firstPrice: { instructions: [tag89({ accounts: [meta(feed, false, true), meta(registry), meta(other, false, true)] })] } }],
  [{ firstPrice: { instructions: [tag89({ accounts: [meta(feed, false, true), meta(registry), meta(payer, true, true)] })] } }],
] as [Record<string, unknown>, string?][]) await assert.rejects(review(extra, stepId), /firstPrice must be one/);

await authenticateMimirBetaReviewedStep(await rebound(mergedReceipt, {}));
// (2) Authentication refusals: an edited count, a dropped record, or a suffix the reviewer must refuse (same signed bytes).
for (const patch of [{ firstPrice: { instructionCount: 2 } }, { firstPrice: { instructionCount: 0 } }, { firstPrice: undefined }]) {
  await assert.rejects(authenticateMimirBetaReviewedStep(await rebound(mergedReceipt, patch)), /RECEIPT_MISMATCH/);
}
for (const bad of [tag89({ programAddress: other }), tag89({ data: Uint8Array.of(88) }), tag89({ accounts: [meta(other, false, true)] }),
  tag89({ accounts: [meta(feed)] }), tag89({ data: Uint8Array.of(89, 1) }), tag89({ accounts: [meta(feed, false, true), meta(registry), meta(other, false, true)] })]) {
  const unrecorded = await receiptOf(await review({}, "classic:activate", [create, bad]));
  await assert.rejects(authenticateMimirBetaReviewedStep(unrecorded), /RECEIPT_MISMATCH/);
  await assert.rejects(authenticateMimirBetaReviewedStep(await rebound(unrecorded, { firstPrice: { instructionCount: 1 } })), /RECEIPT_MISMATCH/);
}
await assert.rejects(authenticateMimirBetaReviewedStep({ ...mergedReceipt, reviewedStep: { ...mergedReceipt.reviewedStep,
  review: { ...mergedReceipt.reviewedStep.review, firstPrice: { instructionCount: 0 } } } } as MimirBetaStageReceipt), /RECEIPT_MISMATCH/);

// (4) Oversize suffix.
await assert.rejects(review({ firstPrice: { instructions: [tag89({ accounts: [meta(feed, false, true), ...Array.from({ length: 120 }, (_, i) => meta(fixed(100 + i)))] })] } }), /TRANSACTION_TOO_LARGE|4096|too large/i);
console.log("v1CreateFirstPrice: ok");
