// Generic caller prefix: caller-owned instructions compiled ahead of one reviewed Classic activation in the same atomic
// Transaction v1. A mocked activation core behind a stand-in purchase (an opaque swap that credits the burn source), its
// typed refusals, the D4 opcode scope, and the no-prefix flow pinned to golden captures from SDK 0.4.0.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createKeyPairFromPrivateKeyBytes, signBytes } from "@solana/keys";
import { getAddressFromPublicKey, type Address } from "@solana/addresses";
import { getCompiledTransactionMessageDecoder } from "@solana/transaction-messages";
import { getTransactionDecoder } from "@solana/transactions";
import bs58 from "bs58";
import { prepareMimirBetaCompositeFeed, prepareMimirBetaSimpleFeed, prepareReview } from "../src/beta/creation.js";
import { assertMimirBetaFusedSignedTransaction, authenticateMimirBetaReviewedStep, createMimirBetaStageReceipt, createReviewHash, createStepIntentHash,
  type MimirBetaCallerPrefixReview, type MimirBetaPreparedStep, type MimirBetaStageReceipt } from "../src/beta/review.js";
import { observeMimirBetaConfirmedReceipt } from "../src/beta/reconciliation.js";
import * as txv1 from "../src/beta/transactionV1.js";
import { mimirBetaCallerPrefixViolationV1 } from "../src/beta/callerPrefixIsolation.js";
import * as errors from "../src/beta/errors.js";
import { freshNumberRecord } from "../src/internal/canonicalAuthority.js";
import { deriveMimirBetaTickerPda, encodeMimirBetaTicker } from "../src/beta/abi.js";
import { addressBytes, base64, bytesAddress, hex, sha256, utf8 } from "../src/beta/bytes.js";
import { MIMIR_BETA_SPL_TOKEN_PROGRAM_ID } from "../src/beta/capture.js";
import { MIMIR_BETA_SYSTEM_PROGRAM_ID } from "../src/beta/deployment.js";
import type { MimirBetaInstruction } from "../src/beta/types.js";

type State = Readonly<{ owner: Address; executable: boolean; lamports: bigint; data: Uint8Array }>;
const signer = async (seed: number) => {
  const pair = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(seed));
  return { pair, address: await getAddressFromPublicKey(pair.publicKey) };
};
const payerKey = await signer(1), assetKey = await signer(2);
const payer = payerKey.address, asset = assetKey.address;
const fixed = (byte: number) => bytesAddress(new Uint8Array(32).fill(byte));
const program = fixed(10), agentProgram = fixed(11), feed = fixed(20), mint = fixed(21), funding = fixed(22), feedId = fixed(23);
const tokenProgram = MIMIR_BETA_SPL_TOKEN_PROGRAM_ID;
const BLOCKHASH = fixed(99), DRAFT = "ab".repeat(32), BURN = 5n, FEE = 5_000n;
const [tickerPda, tickerBump] = await deriveMimirBetaTickerPda(program, "MIMIR");
const deployment = { cluster: "localnet", mimirProgramId: program, systemProgramId: MIMIR_BETA_SYSTEM_PROGRAM_ID, tokenProgramId: tokenProgram };

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const tokenAccount = (tokenMint: Address, owner: Address, amount: bigint) => {
  const data = new Uint8Array(165); data.set(addressBytes(tokenMint)); data.set(addressBytes(owner), 32);
  view(data).setBigUint64(64, amount, true); data[108] = 1; return data;
};
const mintData = (supply: bigint) => { const data = new Uint8Array(82); view(data).setBigUint64(36, supply, true); data[44] = 6; data[45] = 1; return data; };
const feedData = () => {
  const data = new Uint8Array(357); data.set(utf8("MIMIRCFG")); view(data).setUint16(8, 1, true); view(data).setUint16(10, 357, true);
  view(data).setUint32(12, 1, true); data.set(addressBytes(feedId), 16); data.set(addressBytes(fixed(24)), 48); data.set(addressBytes(fixed(25)), 80);
  data.set(encodeMimirBetaTicker("MIMIR"), 313); data.set(addressBytes(asset), 325); return data;
};
const tickerData = () => { const data = new Uint8Array(43); data.set(utf8("MIMIRTIK")); data[8] = 1; data[9] = 2; data[10] = tickerBump; data.set(addressBytes(feed), 11); return data; };
const system = (lamports: bigint): State => ({ owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false, lamports, data: new Uint8Array() });
const token = (data: Uint8Array): State => ({ owner: tokenProgram, executable: false, lamports: 2_039_280n, data });
const meta = (address: Address, isSigner = false, isWritable = false) => ({ address, isSigner, isWritable });
const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95" as Address;

// Mocked Classic activation core: two identity instructions and the tag-80 activation that burns BURN from `funding`.
const core: MimirBetaInstruction[] = [
  { programAddress: agentProgram, accounts: [meta(payer, true, true), meta(asset, true, true)], data: Uint8Array.of(1) },
  { programAddress: agentProgram, accounts: [meta(payer, true, true), meta(asset, true)], data: Uint8Array.of(2) },
  { programAddress: program, accounts: [meta(payer, true, true), meta(feed, false, true), meta(tickerPda, false, true), meta(funding, false, true),
    meta(mint, false, true), meta(tokenProgram), meta(asset, true)], data: Uint8Array.of(80, 7) },
];
const specs = [
  { kind: "account", address: feed, transition: "create", ownerAfter: program, dataLengthAfter: 357, description: "create classic feed", codec: "classic-feed-v1" },
  { kind: "account", address: tickerPda, transition: "create", ownerAfter: program, dataLengthAfter: 43, description: "claim ticker", codec: "ticker-claim-v1" },
  { kind: "account", address: funding, transition: "write", ownerAfter: tokenProgram, dataLengthAfter: 165, description: "debit the burn source" },
  { kind: "account", address: mint, transition: "write", ownerAfter: tokenProgram, dataLengthAfter: 82, description: "decrease mint supply" },
  { kind: "spl-token-burn-checked", address: funding, tokenProgram, mint, authority: payer, amountRaw: BURN, decimals: 6, outerInstructionIndex: 2,
    description: "burn with SPL Token BurnChecked" },
];
const coreBefore = (fundingAmount: bigint) => new Map<Address, State | null>([[payer, system(1_000_000_000n)],
  [funding, token(tokenAccount(mint, payer, fundingAmount))], [mint, { owner: tokenProgram, executable: false, lamports: 1_461_600n, data: mintData(1_000n) }]]);
const coreAfter = (fundingAmount: bigint) => new Map<Address, State | null>([[funding, token(tokenAccount(mint, payer, fundingAmount))],
  [mint, { owner: tokenProgram, executable: false, lamports: 1_461_600n, data: mintData(1_000n - BURN) }],
  [feed, { owner: program, executable: false, lamports: 3_375_360n, data: feedData() }],
  [tickerPda, { owner: program, executable: false, lamports: 1_190_160n, data: tickerData() }]]);

const rpcValue = (state: State | null | undefined) => state ? { owner: state.owner, executable: state.executable, lamports: state.lamports,
  data: [base64(state.data), "base64"] } : null;
const stateOf = (states: readonly ReadonlyMap<Address, State | null>[], address: Address) => {
  for (const map of states) if (map.has(address)) return map.get(address) ?? null;
  return null;
};
const reviewWith = (before: ReadonlyMap<Address, State | null>, after: ReadonlyMap<Address, State | null>, extra: Record<string, unknown> = {},
  stepId = "classic:activate") => prepareReview({
  dependencies: { deployment, rpc: {
    getLatestBlockhash: () => ({ send: async () => ({ context: { slot: 100 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 99n } }) }),
    getMultipleAccounts: (addresses: readonly Address[]) => ({ send: async () => ({ context: { slot: 100 },
      value: addresses.map((address) => rpcValue(stateOf([before], address))) }) }),
    simulateTransaction: (_wire: string, config: { accounts: { addresses: readonly Address[] } }) => ({ send: async () => ({ context: { slot: 101 },
      value: { err: null, logs: [], unitsConsumed: 1_000, returnData: null, accounts: config.accounts.addresses.map((address) =>
        rpcValue(stateOf([after, before], address))) } }) }),
  } } as never,
  contextSlot: 100n, draftHash: DRAFT, plan: { authority: payer, cluster: "localnet", programId: program } as never,
  step: { stepId, stage: "mimir-create", ordinal: 0, prerequisiteStepIds: [], requiredSigners: [payer, asset], expectedWrites: [] } as never,
  instructions: core, specs: specs as never,
  target: { kind: "classic", feedId, feed, identityAsset: asset, ticker: "MIMIR", displayName: null, displayNameInstruction: null } as never,
  ...extra,
} as never);

const signedWire = async (prepared: MimirBetaPreparedStep) => {
  const message = prepared.transaction.serializedMessage;
  const signatures = await Promise.all([payerKey, assetKey].map(async ({ pair, address }) => ({ address, signature: await signBytes(pair.privateKey, message) })));
  const wire = prepared.transaction.serializedTransaction.slice();
  signatures.forEach(({ signature }, index) => wire.set(signature, message.length + index * 64));
  return { wire, signatures };
};
const receiptOf = async (prepared: MimirBetaPreparedStep) => {
  const { wire, signatures } = await signedWire(prepared);
  return { wire, signatures, receipt: createMimirBetaStageReceipt({ preparedStep: prepared, signature: bs58.encode(signatures[0]!.signature), attempt: 1, retryOfSignature: null }) };
};
type TokenRow = Readonly<{ address: Address; mint: Address; owner: Address; pre: bigint; post: bigint }>;
/** Confirmed observation of one landed wire: lamports per key from `pre`/`post` states, the payer as the fee-normalized residual. */
const observe = async (prepared: MimirBetaPreparedStep, landed: Readonly<{ receipt: MimirBetaStageReceipt; wire: Uint8Array }>,
  pre: readonly ReadonlyMap<Address, State | null>[], post: readonly ReadonlyMap<Address, State | null>[], tokens: readonly TokenRow[],
  err: unknown = null) => {
  const message = getCompiledTransactionMessageDecoder().decode(prepared.transaction.serializedMessage);
  if (message.version !== 1) throw new Error("expected Transaction v1");
  const keys = message.staticAccounts as readonly Address[];
  const lamports = (states: readonly ReadonlyMap<Address, State | null>[], key: Address) => stateOf(states, key)?.lamports ?? 0n;
  const preBalances = keys.map((key) => lamports(pre, key));
  const postBalances = err !== null ? preBalances.map((value, index) => index === 0 ? value - FEE : value)
    : keys.map((key, index) => index === 0 ? 0n : lamports([...post, ...pre], key));
  if (err === null) postBalances[0] = preBalances[0]! - FEE - postBalances.slice(1).reduce((sum, value, index) => sum + value - preBalances[index + 1]!, 0n);
  const burn = new Uint8Array(10); burn[0] = 15; view(burn).setBigUint64(1, BURN, true); burn[9] = 6;
  const burnIndex = prepared.review.instructions.length - 1;
  const balances = (side: "pre" | "post") => tokens.map((row) => ({ accountIndex: keys.indexOf(row.address), mint: row.mint, owner: row.owner,
    programId: tokenProgram, uiTokenAmount: { amount: String(row[side]), decimals: 6 } }));
  const raw = { slot: 102, blockTime: 1_800_000_000, version: 1, transaction: [base64(landed.wire), "base64"], meta: { err, fee: Number(FEE),
    preBalances: preBalances.map(Number), postBalances: postBalances.map(Number), preTokenBalances: balances("pre"), postTokenBalances: balances("post"),
    loadedAddresses: { writable: [], readonly: [] }, innerInstructions: err !== null ? [] : [{ index: burnIndex, instructions: [{
      programIdIndex: keys.indexOf(tokenProgram), accounts: [funding, mint, payer].map((key) => keys.indexOf(key)), data: bs58.encode(burn) }] }] } };
  const after = err !== null ? pre : [...post, ...pre];
  return observeMimirBetaConfirmedReceipt({ receipt: landed.receipt, rpc: {
    getTransaction: () => ({ send: async () => raw }),
    getAccountInfo: (address: Address) => ({ send: async () => ({ context: { slot: 103 }, value: rpcValue(stateOf(after, address)) }) }),
    getMultipleAccounts: (addresses: readonly Address[]) => ({ send: async () => ({ context: { slot: 103 },
      value: addresses.map((address) => rpcValue(stateOf(after, address))) }) }),
  } as never });
};
const jsonable = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry));
const unchanged = (rows: readonly TokenRow[]) => rows.map((row) => ({ ...row, post: row.pre }));
const failures: string[] = [];
const section = async (name: string, run: () => Promise<void>) => {
  try { await run(); console.log(`ok ${name}`); }
  catch (error) {
    failures.push(name);
    const detail = error instanceof assert.AssertionError && typeof error.actual === "string" ? `${error.actual} (expected ${String(error.expected)})`
      : String((error as Error)?.message ?? error).split("\n")[0];
    console.log(`FAIL ${name}: ${detail}`);
  }
};

// Legacy: no caller prefix, every review hash, compiled byte and reconciliation verdict equals the SDK 0.4.0 capture.
await section("legacy golden (no prefix)", async () => {
  const before = coreBefore(7n), after = coreAfter(7n - BURN);
  const legacy = await reviewWith(before, after);
  const landed = await receiptOf(legacy);
  const coreTokens: TokenRow[] = [{ address: funding, mint, owner: payer, pre: 7n, post: 7n - BURN }];
  const success = await observe(legacy, landed, [before], [after], coreTokens);
  const failure = await observe(legacy, landed, [before], [after], unchanged(coreTokens), { InstructionError: [2, { Custom: 1 }] });
  const fused = await assertMimirBetaFusedSignedTransaction({ preparedStep: legacy, signedTransaction: landed.wire, signatures: landed.signatures })
    .then(() => "ok", (error: Error) => error.message);
  const golden = jsonable({ reviewHash: legacy.reviewHash, canonicalReviewSha256: hex(await sha256(utf8(legacy.canonicalReviewJson))),
    messageHash: legacy.transaction.messageHash, transactionBase64: base64(legacy.transaction.serializedTransaction),
    stepIntentHash: legacy.review.stepIntentHash, expectedWritesHash: legacy.review.expectedWritesHash, receiptSignature: landed.receipt.signature,
    success, failure, fused });
  const goldenFile = new URL("./fixtures/callerPrefixLegacyGolden.json", import.meta.url);
  assert.deepEqual(golden, JSON.parse(readFileSync(goldenFile, "utf8")));
  assert.equal(golden.success.state, "confirmed"); assert.equal(golden.failure.rollback, "baseline-matched"); assert.equal(golden.fused, "ok");
  assert.equal("callerPrefix" in legacy.review, false);
});

// Stand-in purchase ahead of the core: a lamport fee to a third-party account, then an opaque swap program that takes the authority's input
// tokens into a pool vault and pays BURN of the burn mint from a pool vault into `funding`, so the credit alone pays the burn.
const ammProgram = fixed(36), inputMint = fixed(31), poolAuthority = fixed(33);
const userInput = fixed(30), poolIn = fixed(32), poolOut = fixed(34), poolFee = fixed(35);
const transferIx = (to: Address, lamports: bigint): MimirBetaInstruction => {
  const data = new Uint8Array(12); data[0] = 2; view(data).setBigUint64(4, lamports, true);
  return { programAddress: MIMIR_BETA_SYSTEM_PROGRAM_ID, accounts: [meta(payer, true, true), meta(to, false, true)], data };
};
const swapIx = (extra: readonly ReturnType<typeof meta>[] = [], signerPoolIn = false): MimirBetaInstruction => ({ programAddress: ammProgram,
  accounts: [meta(payer, true, true), meta(userInput, false, true), meta(poolIn, signerPoolIn, true), meta(poolOut, false, true), meta(funding, false, true),
    meta(poolAuthority), meta(tokenProgram), ...extra], data: Uint8Array.of(9, 1, 2, 3) });
const prefixBefore = (changes: Iterable<[Address, State | null]> = []) => new Map<Address, State | null>([...coreBefore(2n),
  [userInput, token(tokenAccount(inputMint, payer, 10n))], [poolIn, token(tokenAccount(inputMint, poolAuthority, 100n))],
  [poolOut, token(tokenAccount(mint, poolAuthority, 100n))], [poolFee, system(1_000_000n)], ...changes]);
const prefixAfter = (changes: Iterable<[Address, State | null]> = []) => new Map<Address, State | null>([...coreAfter(2n),
  [userInput, token(tokenAccount(inputMint, payer, 0n))], [poolIn, token(tokenAccount(inputMint, poolAuthority, 110n))],
  [poolOut, token(tokenAccount(mint, poolAuthority, 100n - BURN))], [poolFee, system(1_005_000n)], ...changes]);
const purchase = { instructions: [transferIx(poolFee, 5_000n), swapIx()], funding: { tokenAccount: funding, minimumCreditRaw: BURN, coversBurn: true },
  guardTokenAccounts: [userInput], maxAuthorityDebitLamports: 10_000n };
const purchaseTokens = (credited = BURN): TokenRow[] => [{ address: userInput, mint: inputMint, owner: payer, pre: 10n, post: 0n },
  { address: poolIn, mint: inputMint, owner: poolAuthority, pre: 100n, post: 110n },
  { address: poolOut, mint, owner: poolAuthority, pre: 100n, post: 100n - credited }, { address: funding, mint, owner: payer, pre: 2n, post: 2n + credited - BURN }];
const coreDebit = -(3_375_360n + 1_190_160n);
let prefixed: MimirBetaPreparedStep | undefined;

await section("positive review: prefix compiled ahead, burn index shifted, prefix-only proofs, bound terms, authority token deltas", async () => {
  prefixed = await reviewWith(prefixBefore(), prefixAfter(), { callerPrefix: purchase });
  const { review, transaction } = prefixed;
  assert.deepEqual(review.callerPrefix, { instructionCount: 2, funding: { tokenAccount: funding, minimumCreditRaw: BURN, coversBurn: true },
    guardTokenAccounts: [userInput], maxAuthorityDebitLamports: 10_000n, tokenDeltas: [
      { address: funding, mint, preAmountRaw: 2n, postAmountRaw: 2n }, { address: userInput, mint: inputMint, preAmountRaw: 10n, postAmountRaw: 0n }] });
  assert.deepEqual(review.instructions.map(({ programAddress }) => programAddress), [MIMIR_BETA_SYSTEM_PROGRAM_ID, ammProgram, agentProgram, agentProgram, program]);
  assert.deepEqual(transaction.requiredSigners, [payer, asset]);
  const burn = review.expectedWrites.find((write) => write.proof.kind === "spl-token-burn-checked")!;
  assert.equal(burn.proof.kind === "spl-token-burn-checked" && burn.proof.outerInstructionIndex, 4);
  assert.deepEqual(review.expectedWrites.flatMap((write) => write.proof.kind === "caller-prefix" ? [[write.address, write.proof.simulatedLamportDelta]] : []),
    [[poolFee, 5_000n], [userInput, 0n], [poolIn, 0n], [poolOut, 0n]]);
  assert.deepEqual(review.expectedWrites.find((write) => write.address === payer)?.proof, { kind: "lamports", programDeltaLamports: coreDebit },
    "payer lamport proof stays the core-only residual");
  assert.deepEqual(txv1.mimirBetaReviewWalletGuardAccountsV1(review), { tokenAccounts: [funding, userInput] });
  const terms: MimirBetaCallerPrefixReview = review.callerPrefix!;
  const intent = (callerPrefix: MimirBetaCallerPrefixReview | undefined) => createStepIntentHash({ draftHash: DRAFT, step: prefixed!.step,
    expectedWritesHash: review.expectedWritesHash, ...(callerPrefix ? { callerPrefix } : {}) });
  assert.equal(await intent(terms), review.stepIntentHash);
  for (const tampered of [undefined, { ...terms, tokenDeltas: [] }, { ...terms, instructionCount: 3 }, { ...terms, guardTokenAccounts: [] }, { ...terms, maxAuthorityDebitLamports: 10_001n },
    { ...terms, funding: { ...terms.funding!, minimumCreditRaw: BURN + 1n } }, { ...terms, funding: null }]) {
    assert.notEqual(await intent(tampered), review.stepIntentHash);
  }
});

await section("positive size and packet gate: one Transaction v1 within limits", async () => {
  assert.ok(prefixed);
  const { packet, serializedTransaction } = prefixed.transaction;
  assert.equal(packet.instructionCount, 5); assert.equal(packet.signatureCount, 2); assert.equal(packet.fitsPacketLimit, true);
  assert.ok(serializedTransaction.length <= packet.packetLimitBytes && packet.accountCount <= 64);
});

await section("positive receipt: core-only terminal count authenticates and the fused envelope admits", async () => {
  assert.ok(prefixed);
  const landed = await receiptOf(prefixed);
  const reviewed = await authenticateMimirBetaReviewedStep(JSON.parse(JSON.stringify(landed.receipt)));
  assert.equal(reviewed.review.callerPrefix?.maxAuthorityDebitLamports, 10_000n, "persisted receipts revive the prefix terms");
  await assertMimirBetaFusedSignedTransaction({ preparedStep: prefixed, signedTransaction: landed.wire, signatures: landed.signatures });
});

await section("positive reconciliation: prefix-only deltas allowed, funded burn source, bounded authority debit", async () => {
  assert.ok(prefixed);
  const landed = await receiptOf(prefixed);
  const observation = await observe(prefixed, landed, [prefixBefore()], [prefixAfter()], purchaseTokens());
  assert.equal(observation.state, "confirmed");
  assert.deepEqual(observation.state === "confirmed" && observation.writes.map(({ kind }) => kind),
    ["account", "account", "account", "account", "spl-token-burn-checked", "lamports", "caller-prefix", "caller-prefix", "caller-prefix", "caller-prefix"]);
  const surplus = await observe(prefixed, landed, [prefixBefore()], [prefixAfter([[poolOut, token(tokenAccount(mint, poolAuthority, 90n))],
    [funding, token(tokenAccount(mint, payer, 7n))]])], purchaseTokens(10n));
  assert.equal(surplus.state, "confirmed", "a credit above the declared minimum stays exact on the burn itself");
});

await section("positive failure rollback: nothing moved, prefix accounts included", async () => {
  assert.ok(prefixed);
  const landed = await receiptOf(prefixed);
  const failed = await observe(prefixed, landed, [prefixBefore()], [], unchanged(purchaseTokens()), { InstructionError: [1, { Custom: 6001 }] });
  assert.equal(failed.state, "confirmed-failed");
  assert.equal(failed.state === "confirmed-failed" && failed.rollback, "baseline-matched");
  const moved = purchaseTokens().map((row) => row.address === poolOut ? row : { ...row, post: row.pre });
  await assert.rejects(observe(prefixed, landed, [prefixBefore()], [], moved, { InstructionError: [1, { Custom: 6001 }] }),
    (error: errors.MimirBetaError) => error.code === "RECONCILIATION_CONFLICT" && /non-atomic token effects/.test(error.message));
});

await section("refuse post-trade authority debit above the bound (reconciliation)", async () => {
  assert.ok(prefixed);
  const landed = await receiptOf(prefixed);
  await assert.rejects(observe(prefixed, landed, [prefixBefore()], [prefixAfter([[poolFee, system(1_020_000n)]])], purchaseTokens()),
    (error: errors.MimirBetaError) => error.code === "RECONCILIATION_CONFLICT" && /caller-prefix bound/.test(error.message));
});

await section("refuse landed funding credit below the declared minimum (reconciliation)", async () => {
  assert.ok(prefixed);
  const landed = await receiptOf(prefixed);
  await assert.rejects(observe(prefixed, landed, [prefixBefore()], [prefixAfter([[poolOut, token(tokenAccount(mint, poolAuthority, 97n))],
    [funding, token(tokenAccount(mint, payer, 0n))]])], purchaseTokens(3n)),
    (error: errors.MimirBetaError) => error.code === "RECONCILIATION_CONFLICT" && /BurnChecked token amount/.test(error.message));
});

// Typed refusals: each returns `REFUSE <reason>` (MimirBetaCallerPrefixError) or the packet code, so a caller falls back to two transactions.
// The burn source already holds the burn here, so without caller-prefix support the core alone would be prepared and the prefix dropped.
const verdict = (run: () => Promise<unknown>) => run().then(() => "ACCEPT", (error: errors.MimirBetaError & { reason?: string }) =>
  error?.code === "CALLER_PREFIX_REFUSED" && errors.MimirBetaCallerPrefixError && error instanceof errors.MimirBetaCallerPrefixError
    ? `REFUSE ${error.reason}` : String(error?.code ?? error));
const held = (amount: bigint): [Address, State] => [funding, token(tokenAccount(mint, payer, amount))];
const refused = (name: string, expected: string, prefix: Record<string, unknown>, before = prefixBefore([held(7n)]), after = prefixAfter([held(7n)]),
  stepId?: string) =>
  section(`refuse ${name}`, async () => assert.equal(await verdict(() => reviewWith(before, after, { callerPrefix: { ...purchase, ...prefix } }, stepId)), expected));
const computeUnitLimit = Uint8Array.of(2, 0x40, 0x42, 0x0f, 0);
await refused("foreign signer in the prefix", "REFUSE foreign-signer", { instructions: [transferIx(poolFee, 5_000n), swapIx([], true)] });
await refused("Mimir instruction in the prefix", "REFUSE reserved-program", { instructions: [{ programAddress: program, accounts: [meta(payer, true, true)], data: Uint8Array.of(87) }, swapIx()] });
await refused("Mimir program reachable from the prefix", "REFUSE reserved-program", { instructions: [swapIx([meta(program)])] });
await refused("Lighthouse instruction in the prefix", "REFUSE reserved-program",
  { instructions: [{ programAddress: LIGHTHOUSE, accounts: [meta(payer, true, true)], data: Uint8Array.of(6) }, swapIx()] });
await refused("ComputeBudget instruction in the prefix", "REFUSE reserved-program",
  { instructions: [{ programAddress: "ComputeBudget111111111111111111111111111111" as Address, accounts: [], data: computeUnitLimit }, swapIx()] });
await refused("prefix-writable core account", "REFUSE core-account-overlap", { instructions: [swapIx([meta(feed, false, true)])] });
await refused("prefix-writable burn mint", "REFUSE core-account-overlap", { instructions: [swapIx([meta(mint, false, true)])] });
await refused("coversBurn with minimumCreditRaw below the burn", "REFUSE funding-below-burn",
  { funding: { tokenAccount: funding, minimumCreditRaw: BURN - 1n, coversBurn: true } });
await refused("funding declared on a token account the core does not burn", "REFUSE funding-account",
  { instructions: [{ ...swapIx(), accounts: swapIx().accounts.filter(({ address }) => address !== funding) }], funding: { tokenAccount: userInput, minimumCreditRaw: BURN } });
await refused("funding redirected while the prefix writes the burn source", "REFUSE core-account-overlap", { funding: { tokenAccount: userInput, minimumCreditRaw: BURN } });
await refused("funding account absent before the transaction", "REFUSE funding-account", {}, prefixBefore([[funding, null]]));
await refused("simulated funding credit below the declared minimum", "REFUSE funding-shortfall", {}, undefined,
  prefixAfter([[poolOut, token(tokenAccount(mint, poolAuthority, 96n))], held(6n)]));
await refused("simulated authority debit above the bound", "REFUSE authority-debit-above-bound", { maxAuthorityDebitLamports: 4_999n });
await refused("guard declared on a non-authority-owned token account", "REFUSE foreign-token-account", { guardTokenAccounts: [poolIn] });
await refused("prefix moving an authority token account to another owner", "REFUSE foreign-token-account", {}, undefined,
  prefixAfter([held(7n), [userInput, token(tokenAccount(inputMint, poolAuthority, 0n))]]));
await refused("prefix leaving a delegate on the burn source", "REFUSE foreign-token-account", {}, undefined, prefixAfter([[funding,
  token((() => { const data = tokenAccount(mint, payer, 7n); data[72] = 1; data.set(addressBytes(poolAuthority), 76); return data; })())]]));
await refused("oversize transaction", "TRANSACTION_TOO_LARGE", { instructions: [transferIx(poolFee, 5_000n),
  swapIx(Array.from({ length: 50 }, (_, index) => meta(fixed(100 + index))))] });
await refused("prefix on a step other than the Classic activation", "REFUSE step", {}, undefined, undefined, "classic:ready");

const classicPolicy = { profile: 0, riskTier: 1, priceExponent: -8, maxDispersionBps: 100, maxSourceActivityAgeSlots: 10, minCoverageRatioBps: 10_000,
  maxConfidenceBps: 500, maxSnapshotAgeSlots: 20, anchorPolicyHash: new Uint8Array(32).fill(1), nativeExceptionHash: new Uint8Array(32).fill(2) };
const inputs = { ticker: "MIMIR", authority: payer, identity: { asset, agentUri: "https://example.com/mimir/feed.json" }, creatorCollateralTokenAccount: funding };
await section("refuse malformed callerPrefix input", async () => assert.equal(await verdict(() => prepareMimirBetaSimpleFeed({} as never, { ...inputs,
  baseMint: fixed(25), quoteMint: fixed(24), pools: [], policy: classicPolicy, callerPrefix: { instructions: [], maxAuthorityDebitLamports: 0n } } as never)), "INVALID_ARGUMENT"));
await section("refuse callerPrefix on Composite input (journey children not wired)", async () => assert.equal(await verdict(() => prepareMimirBetaCompositeFeed({} as never,
  { ...inputs, ticker: "BASKET", displayName: "Basket", quoteMint: fixed(24), components: [], callerPrefix: purchase, policy: { priceExponent: -8,
    maxSnapshotAgeSlots: 20, maxComponentSnapshotAgeSlots: 20, maxComponentConfidenceBps: 500, maxComponentDispersionBps: 500 } } as never)), "INVALID_ARGUMENT"));

// D4: the fused-tail 87/88 scans read only Mimir instructions. A staged Composite activation (identity + tag 81) is the scanned envelope.
const coreAssetKey = await signer(3);
const offsets = freshNumberRecord("COMPOSITE_CONFIG_OFFSETS");
const tag81 = new Uint8Array(1 + offsets.components); tag81[0] = 81;
const stagedActivation: MimirBetaInstruction = { programAddress: program, data: tag81, accounts: [meta(payer, true, true),
  ...Array.from({ length: 14 }, (_, index) => meta(fixed(60 + index), false, true)), meta(coreAssetKey.address, true, true)] };
const d4 = async (instructions: readonly MimirBetaInstruction[]) => {
  const transaction = await txv1.compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: BLOCKHASH, lastValidBlockHeight: 99n, instructions });
  const writes = [{ address: coreAssetKey.address, effect: "create", ownerAfter: fixed(12), dataLengthAfter: 1, discriminatorHex: null, description: "create Core asset",
    proof: { kind: "account", transition: "create", before: { exists: false, owner: null, executable: null, lamports: 0n, dataLength: null, dataSha256: null },
      after: { exists: true, lamports: 1n, owner: fixed(12), executable: false, data: { kind: "sdk-codec", codec: "mpl-core-asset-v1", length: 1, semanticHash: "00".repeat(32) } } } },
  { address: funding, effect: "token-burn", ownerAfter: tokenProgram, dataLengthAfter: 165, discriminatorHex: null, description: "burn",
    proof: { kind: "spl-token-burn-checked", tokenProgram, mint, sourceTokenAccount: funding, authority: payer, amountRaw: BURN, decimals: 6, outerInstructionIndex: 3 } }];
  const step = { stepId: "composite:activate", stage: "mimir-create", ordinal: 0, prerequisiteStepIds: [], requiredSigners: transaction.requiredSigners, expectedWrites: writes };
  const review = { programId: program, authority: payer, identityAsset: coreAssetKey.address, requiredSigners: transaction.requiredSigners, expectedWrites: writes,
    instructions: instructions.map((instruction) => ({ programAddress: instruction.programAddress, accounts: instruction.accounts, dataBase64: base64(instruction.data) })),
    packet: transaction.packet, messageHash: transaction.messageHash };
  const message = transaction.serializedMessage;
  const signatures = await Promise.all([payerKey, coreAssetKey].map(async ({ pair, address }) => ({ address, signature: await signBytes(pair.privateKey, message) })));
  const wire = transaction.serializedTransaction.slice(); signatures.forEach(({ signature }, index) => wire.set(signature, message.length + index * 64));
  return verdict(() => assertMimirBetaFusedSignedTransaction({ preparedStep: { step, review, transaction } as never, signedTransaction: wire, signatures }));
};
const agentIx = (data: number) => ({ programAddress: agentProgram, accounts: [meta(payer, true, true)], data: Uint8Array.of(data) });
await section("D4 Mimir-like opcode byte in a foreign instruction no longer trips the fused-tail scan", async () =>
  assert.equal(await d4([{ ...agentIx(87), data: Uint8Array.of(87, 0) }, agentIx(2), agentIx(3), stagedActivation]), "ACCEPT"));
await section("D4 a tag 87 inside the Mimir core is still refused", async () =>
  assert.equal(await d4([agentIx(1), { programAddress: program, accounts: [meta(payer, true, true)], data: Uint8Array.of(87) }, agentIx(3), stagedActivation]),
    "RECEIPT_MISMATCH"));

// Isolation is message-wide: the runtime derives every top-level account role from the message, so a prefix reference inherits the core's
// writability and signatures whatever role the prefix instruction lists.
const tokenTransferIx = (source: Address, destination: Address, amount: bigint, sourceWritable: boolean): MimirBetaInstruction => {
  const data = new Uint8Array(9); data[0] = 3; view(data).setBigUint64(1, amount, true);
  return { programAddress: tokenProgram, accounts: [meta(source, false, sourceWritable), meta(destination, false, true), meta(payer, true, false)], data };
};
const attacker = fixed(40), attackerToken = fixed(41), userStake = fixed(43), stakeProgram = fixed(44), userBurnMint2 = fixed(45);
const userAsset = fixed(46), assetProgram = fixed(47);
await section("a read-only prefix reference to the core-writable burn source is refused", async () => {
  const before = new Map<Address, State | null>([...coreBefore(7n), [attackerToken, token(tokenAccount(mint, attacker, 0n))]]);
  const after = new Map<Address, State | null>([...coreAfter(7n - BURN - 2n), [attackerToken, token(tokenAccount(mint, attacker, 2n))]]);
  const prefix = { instructions: [tokenTransferIx(funding, attackerToken, 2n, false)], maxAuthorityDebitLamports: 0n };
  assert.equal(await verdict(() => reviewWith(before, after, { callerPrefix: prefix })), "REFUSE core-account-overlap");
});
await section("lamports pushed into a core-writable account through a read-only reference are refused", async () => {
  const after = new Map<Address, State | null>([...coreAfter(7n - BURN), [feed, { owner: program, executable: false, lamports: 3_375_360n + 1_000_000n, data: feedData() }]]);
  const prefix = { instructions: [{ ...transferIx(feed, 1_000_000n), accounts: [meta(payer, true, true), meta(feed, false, false)] }], maxAuthorityDebitLamports: 0n };
  assert.equal(await verdict(() => reviewWith(coreBefore(7n), after, { callerPrefix: prefix })), "REFUSE core-account-overlap");
});
await section("a core signer referenced by the prefix as a non-signer is refused", async () => {
  const prefix = { ...purchase, instructions: [transferIx(poolFee, 5_000n), swapIx([meta(asset)])] };
  assert.match(await verdict(() => reviewWith(prefixBefore([held(7n)]), prefixAfter([held(7n)]), { callerPrefix: prefix })), /^REFUSE (foreign-signer|core-account-overlap)$/);
});
await section("a purchase route that reads the burn mint stays admitted", async () => {
  const prefix = { ...purchase, instructions: [transferIx(poolFee, 5_000n), swapIx([meta(mint)])] };
  assert.equal(await verdict(() => reviewWith(prefixBefore(), prefixAfter(), { callerPrefix: prefix })), "ACCEPT");
});
await section("an extra burn through the read-only burn mint is refused", async () => {
  const before = new Map<Address, State | null>([...coreBefore(7n), [userBurnMint2, token(tokenAccount(mint, payer, 9n))]]);
  const after = new Map<Address, State | null>([...coreAfter(7n - BURN), [userBurnMint2, token(tokenAccount(mint, payer, 6n))],
    [mint, { owner: tokenProgram, executable: false, lamports: 1_461_600n, data: mintData(1_000n - BURN - 3n) }]]);
  const data = new Uint8Array(9); data[0] = 8; view(data).setBigUint64(1, 3n, true);
  const burnIx: MimirBetaInstruction = { programAddress: tokenProgram, accounts: [meta(userBurnMint2, false, true), meta(mint), meta(payer, true, false)], data };
  assert.equal(await verdict(() => reviewWith(before, after, { callerPrefix: { instructions: [burnIx], maxAuthorityDebitLamports: 0n } })), "REFUSE core-account-overlap");
});
await section("lamports pushed into the declared funding account are refused", async () => {
  const after = prefixAfter([[funding, { ...token(tokenAccount(mint, payer, 2n)), lamports: 2_039_280n + 1_000_000n }]]);
  const prefix = { ...purchase, instructions: [...purchase.instructions, transferIx(funding, 1_000_000n)] };
  assert.equal(await verdict(() => reviewWith(prefixBefore(), after, { callerPrefix: prefix })), "REFUSE core-account-overlap");
});
await section("the recorded purchase wire ahead of the recorded activation core passes isolation, and needs the burn-mint exemption", async () => {
  const decompile = (name: string) => {
    const m = getCompiledTransactionMessageDecoder().decode(new Uint8Array(getTransactionDecoder()
      .decode(new Uint8Array(readFileSync(new URL(`./fixtures/walletGuards/${name}`, import.meta.url)))).messageBytes)) as never as {
      header: { numSignerAccounts: number; numReadonlySignerAccounts: number; numReadonlyNonSignerAccounts: number }; staticAccounts: Address[];
      instructionHeaders: { programAccountIndex: number }[]; instructionPayloads: { instructionAccountIndices: number[] }[] };
    const { header: h, staticAccounts: keys } = m;
    const writable = (i: number) => i < h.numSignerAccounts ? i < h.numSignerAccounts - h.numReadonlySignerAccounts : i < keys.length - h.numReadonlyNonSignerAccounts;
    return { payer: keys[0]!, instructions: m.instructionHeaders.map((header, i) => ({ programAddress: keys[header.programAccountIndex]!,
      accounts: m.instructionPayloads[i]!.instructionAccountIndices.map((k) => ({ address: keys[k]!, isSigner: k < h.numSignerAccounts, isWritable: writable(k) })) })) };
  };
  const buy = decompile("buy.wire.bin"), activation = decompile("core.wire.bin");
  const keys = (wire: typeof buy, isWritable: boolean) => new Set(wire.instructions.flatMap((ix) => ix.accounts.filter((a) => a.isWritable === isWritable).map((a) => a.address)));
  const coreWritable = keys(activation, true);
  const funding = [...keys(buy, true)].find((a) => a !== buy.payer && coreWritable.has(a)) ?? null;
  const mints = [...keys(buy, false)].filter((a) => a !== buy.payer && coreWritable.has(a));
  const run = (readonlyCoreAccounts?: Address[]) => mimirBetaCallerPrefixViolationV1({ authority: activation.payer,
    programId: activation.instructions.at(-1)!.programAddress, fundingTokenAccount: funding, readonlyCoreAccounts, prefix: buy.instructions, core: activation.instructions });
  assert.equal(buy.payer, activation.payer); assert.notEqual(funding, null); assert.equal(mints.length, 1);
  assert.equal(run(mints), null);
  assert.equal(run()?.reason, "core-account-overlap");
});

// The prefix may not touch the authority's non-token state: any prefix-only account whose data names the authority may only change as a
// token account balance.
const namesAuthority = (owner: Address) => { const data = new Uint8Array(200); data[0] = 2; data.set(addressBytes(payer), 12); return { owner, executable: false, data }; };
await section("lamports withdrawn from an authority-controlled non-payer account are refused", async () => {
  const before = new Map<Address, State | null>([...coreBefore(7n), [userStake, { ...namesAuthority(stakeProgram), lamports: 1_000_000_000n }], [attacker, system(0n)]]);
  const after = new Map<Address, State | null>([...coreAfter(7n - BURN), [userStake, { ...namesAuthority(stakeProgram), lamports: 950_000_000n }],
    [attacker, system(50_000_000n)]]);
  const prefix = { instructions: [{ programAddress: stakeProgram, accounts: [meta(userStake, false, true), meta(attacker, false, true), meta(payer, true, false)],
    data: Uint8Array.of(4) }], maxAuthorityDebitLamports: 0n };
  assert.equal(await verdict(() => reviewWith(before, after, { callerPrefix: prefix })), "REFUSE authority-account");
});
await section("an authority record reassigned to a third party is refused", async () => {
  const reassigned = namesAuthority(assetProgram); reassigned.data.set(addressBytes(attacker), 12);
  const before = new Map<Address, State | null>([...coreBefore(7n), [userAsset, { ...namesAuthority(assetProgram), lamports: 3_000_000n }]]);
  const after = new Map<Address, State | null>([...coreAfter(7n - BURN), [userAsset, { ...reassigned, lamports: 3_000_000n }]]);
  const prefix = { instructions: [{ programAddress: assetProgram, accounts: [meta(userAsset, false, true), meta(payer, true, false), meta(attacker)], data: Uint8Array.of(14) }],
    maxAuthorityDebitLamports: 0n };
  assert.equal(await verdict(() => reviewWith(before, after, { callerPrefix: prefix })), "REFUSE authority-account");
});
await section("an authority token account closed to a third party is refused", async () => {
  const before = new Map<Address, State | null>([...prefixBefore([held(7n)]), [userBurnMint2, token(tokenAccount(inputMint, payer, 0n))], [attacker, system(0n)]]);
  const after = new Map<Address, State | null>([...prefixAfter([held(7n)]), [userBurnMint2, null], [attacker, system(2_039_280n)]]);
  const prefix = { ...purchase, instructions: [...purchase.instructions, { programAddress: tokenProgram,
    accounts: [meta(userBurnMint2, false, true), meta(attacker, false, true), meta(payer, true, false)], data: Uint8Array.of(9) }] };
  assert.match(await verdict(() => reviewWith(before, after, { callerPrefix: prefix })), /^REFUSE /);
});

// coversBurn means the credit is bought: it may not come from another authority balance of the burn mint.
await section("a covering credit drawn from another authority burn-mint account is refused", async () => {
  const before = new Map<Address, State | null>([...coreBefore(2n), [userBurnMint2, token(tokenAccount(mint, payer, 9n))]]);
  const after = new Map<Address, State | null>([...coreAfter(2n), [userBurnMint2, token(tokenAccount(mint, payer, 9n - BURN))]]);
  const prefix = { instructions: [tokenTransferIx(userBurnMint2, funding, BURN, true)], funding: { tokenAccount: funding, minimumCreditRaw: BURN, coversBurn: true },
    maxAuthorityDebitLamports: 0n };
  assert.equal(await verdict(() => reviewWith(before, after, { callerPrefix: prefix })), "REFUSE funding-from-authority");
});
await section("a landed covering credit drawn from another authority burn-mint account conflicts at reconciliation", async () => {
  const before = prefixBefore([[userBurnMint2, token(tokenAccount(mint, payer, 9n))]]);
  const after = prefixAfter([[userBurnMint2, token(tokenAccount(mint, payer, 9n))]]);
  const prepared = await reviewWith(before, after, { callerPrefix: { ...purchase, instructions: [transferIx(poolFee, 5_000n), swapIx([meta(userBurnMint2, false, true)])] } });
  const tokens: TokenRow[] = [...purchaseTokens().map((row) => row.address === poolOut ? { ...row, post: row.pre } : row),
    { address: userBurnMint2, mint, owner: payer, pre: 9n, post: 9n - BURN }];
  assert.equal(await observe(prepared, await receiptOf(prepared), [before], [after], tokens).then((o) => o.state, (e: errors.MimirBetaError) => String(e.code)),
    "RECONCILIATION_CONFLICT");
});

await section("a prefixed step admits wallet guards on the burn source and declared accounts only", async () => {
  const prepared = await reviewWith(prefixBefore(), prefixAfter(), { callerPrefix: purchase });
  const payerGuard = () => { const data = new Uint8Array(26); data.set([6, 5, 3, 0]); data.set([4, 3, 0, 0, 1], 12); return data; };
  const tokenGuard = () => { const data = new Uint8Array(64); data.set([10, 5, 6, 8, 2]); data.set([4, 3, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 13);
    data.set(addressBytes(payer), 28); data.set([0, 7, 0, 0], 60); return data; };
  const guard = (target: Address): MimirBetaInstruction => ({ programAddress: LIGHTHOUSE,
    accounts: [meta(target, target === payer, true)], data: target === payer ? payerGuard() : tokenGuard() });
  const walletMessage = async (targets: readonly Address[]) => (await txv1.compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: BLOCKHASH,
    lastValidBlockHeight: 99n, instructions: [...prepared.transaction.instructions, ...[payer, ...targets].map(guard)] })).serializedMessage;
  const guards = txv1.mimirBetaReviewWalletGuardAccountsV1(prepared.review);
  const admitted = async (targets: readonly Address[]) => txv1.isMimirBetaWalletRewriteV1(prepared.transaction.serializedMessage, await walletMessage(targets), guards);
  assert.equal(await admitted([funding, userInput]), true, "burn source + declared guard");
  for (const target of [poolIn, feed, mint]) assert.equal(await admitted([funding, target]), false, `undeclared ${target}`);
  assert.equal(txv1.mimirBetaReviewWalletGuardAccountsV1((await reviewWith(coreBefore(7n), coreAfter(7n - BURN))).review), funding, "legacy guard set unchanged");
});

// Resealed receipts: a forger can recompute every public hash, so only the signed bytes and the structural checks bind the prefix.
const reseal = async (prepared: MimirBetaPreparedStep, mutate: (review: MimirBetaPreparedStep["review"]) => MimirBetaPreparedStep["review"]) => {
  const mutated = mutate({ ...prepared.review });
  const stepIntentHash = await createStepIntentHash({ draftHash: mutated.draftHash, step: prepared.step, expectedWritesHash: mutated.expectedWritesHash,
    ...(mutated.callerPrefix ? { callerPrefix: mutated.callerPrefix } : {}) });
  const review = { ...mutated, stepIntentHash };
  const { canonicalReviewJson, reviewHash } = await createReviewHash(review);
  const { signatures } = await signedWire(prepared);
  const receipt = createMimirBetaStageReceipt({ preparedStep: { ...prepared, review, canonicalReviewJson, reviewHash }, signature: bs58.encode(signatures[0]!.signature),
    attempt: 1, retryOfSignature: null });
  return JSON.parse(JSON.stringify(receipt)) as MimirBetaStageReceipt;
};
const authVerdict = (receipt: MimirBetaStageReceipt) => authenticateMimirBetaReviewedStep(receipt).then(() => "ACCEPT", (e: errors.MimirBetaError) => String(e.code));
await section("receipts: resealing an unchanged prefixed receipt authenticates", async () => {
  const prepared = await reviewWith(prefixBefore(), prefixAfter(), { callerPrefix: purchase });
  assert.equal(await authVerdict(await reseal(prepared, (review) => review)), "ACCEPT");
});
await section("receipts: a resealed instructionCount off by one is refused", async () => {
  const prepared = await reviewWith(prefixBefore(), prefixAfter(), { callerPrefix: purchase });
  for (const count of [1, 3]) {
    const forged = await reseal(prepared, (review) => ({ ...review, callerPrefix: { ...review.callerPrefix!, instructionCount: count } }));
    assert.equal(await authVerdict(forged), "RECEIPT_MISMATCH", `instructionCount ${count}`);
  }
});
await section("receipts: a resealed receipt without its callerPrefix is refused", async () => {
  const prepared = await reviewWith(prefixBefore(), prefixAfter(), { callerPrefix: purchase });
  assert.equal(await authVerdict(await reseal(prepared, (review) => { const { callerPrefix: _drop, ...rest } = review; return rest; })), "RECEIPT_MISMATCH");
});
await section("receipts: core instructions resealed as a prefix of a legacy receipt are refused", async () => {
  const legacy = await reviewWith(coreBefore(7n), coreAfter(7n - BURN));
  for (const count of [1, 2]) {
    const forged = await reseal(legacy, (review) => ({ ...review, callerPrefix: { instructionCount: count, funding: null, guardTokenAccounts: [],
      maxAuthorityDebitLamports: 0n, tokenDeltas: [] } }));
    assert.equal(await authVerdict(forged), "RECEIPT_MISMATCH", `count ${count}`);
  }
});
await section("receipts: tampered tokenDeltas without resealing are refused", async () => {
  const prepared = await reviewWith(prefixBefore(), prefixAfter(), { callerPrefix: purchase });
  const json = JSON.parse(JSON.stringify((await receiptOf(prepared)).receipt));
  json.reviewedStep.review.callerPrefix.tokenDeltas[1].postAmountRaw = "10";
  assert.equal(await authVerdict(json), "RECEIPT_MISMATCH");
});
await section("fused assert: an in-memory instructionCount off by one is refused", async () => {
  const prepared = await reviewWith(prefixBefore(), prefixAfter(), { callerPrefix: purchase });
  const { wire, signatures } = await signedWire(prepared);
  for (const count of [1, 3]) {
    const forged = { ...prepared, review: { ...prepared.review, callerPrefix: { ...prepared.review.callerPrefix!, instructionCount: count } } };
    assert.equal(await verdict(() => assertMimirBetaFusedSignedTransaction({ preparedStep: forged, signedTransaction: wire, signatures })), "RECEIPT_MISMATCH");
  }
});

if (failures.length) {
  console.error(`callerPrefix: ${failures.length} failing section(s): ${failures.join("; ")}`);
  process.exit(1);
}
console.log("callerPrefix tests passed");
