import { createMimirBetaClient } from "../src/beta/client.js";
import { MIMIR_BETA_TRANSACTION_V1_FEATURE, MIMIR_BETA_TRANSACTION_V1_FEATURE_OWNER } from "../src/beta/transactionV1.js";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { classicExecutionImageFromSeal, compositeExecutionImageFromSeal, sealClassicExecution, validRingV1 } from "./fixtures/compositeExecutionImage.js";
import fs from "node:fs";
import { deriveMimirOneCharAllowancePda } from "../src/beta/oneChar.js";
import { webcrypto } from "node:crypto";
import { address, getProgramDerivedAddress, type Address } from "@solana/kit";
import { getAddressFromPublicKey } from "@solana/addresses";
import bs58 from "bs58";
import { getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder } from "@solana/transaction-messages";
import { getTransactionDecoder } from "@solana/transactions";
import {
  buildMimirBetaClassicSourceArtifacts,
  canonicalizeMimirBetaCompositeComponents,
  computeMimirBetaClassicPlanHash,
  computeMimirBetaTickerTariff,
  deriveMimirBetaCanonicalPdas,
  deriveMimirBetaClassicFeedId,
  deriveMimirBetaFeedPdas,
  deriveMimirBetaPda,
  deriveMimirBetaTickerPda,
  encodeMimirBetaTicker,
  parseMimirBetaIntegerQuantityX64,
} from "../src/beta/abi.js";
import {
  MIMIR_BETA_AGENT_URI_MAX_UTF8_BYTES,
  prepareMimirBetaCompositeFeed,
  prepareMimirBetaSimpleFeed,
  prepareMimirBetaSimpleFeedConfirmed,
  prepareMimirBetaCompositeFeedConfirmed,
  prepareMimirBetaCompositeFeedJourney,
  type MimirBetaCompositeComponentInput,
  type PrepareCompositeFeedJourneyArgs,
} from "../src/beta/creation.js";
import { assertMimirBetaSourceAdapterVersions } from "../src/beta/context.js";
import {
  MIMIR_BETA_MPL_CORE_PROGRAM_ID,
  MIMIR_BETA_SYSTEM_PROGRAM_ID,
} from "../src/beta/deployment.js";
import { MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, MIMIR_BETA_TOKEN_2022_PROGRAM_ID } from "../src/beta/capture.js";
import { MIMIR_RENT_SYSVAR } from "../src/beta/rent.js";
const testRentSysvar = (() => { const data = new Uint8Array(17); const view = new DataView(data.buffer); view.setBigUint64(0, 100n, true); view.setFloat64(8, 1, true); return data; })();
import { MimirBetaCollateralRequiredError, MimirBetaConverterIneligibleError, MimirBetaError, MimirBetaIdentityAssetMissingError, MimirBetaSimulationError, mimirBetaSimulationFailure } from "../src/beta/errors.js";
import { MimirClassicNativeNotReadyError, rankMimirBetaConverterEligibility, type MimirBetaConverterEligibility } from "../src/beta/live.js";
import { decodeMimirCompositeConfig } from "../src/beta/codecs.js";
import type { MimirBetaEligiblePool } from "../src/beta/discovery.js";
import { assertMimirClassicBoundedMajorityPossible, assertMimirV1MixedMajorityPossible } from "../src/beta/classicExecution.js";
import { createMimir8004IdentityAdapter } from "../src/beta/identity8004.js";
import { observeMimirBetaConfirmedReceiptChain, observeMimirBetaReceiptChain, observeMimirBetaReceipt, verifyMimirBetaFinalizedReceiptEvidence } from "../src/beta/reconciliation.js";
import { decodeMimirBetaFinalizedTransactionResponse } from "../src/beta/rpc.js";
import { compileMimirBetaTransactionV1, MIMIR_BETA_TRANSACTION_V1_CONFIG, MIMIR_BETA_TRANSACTION_V1_MIN_PRIORITY_FEE_LAMPORTS } from "../src/beta/transactionV1.js";
import {
  assertMimirBetaFusedSignedTransaction,
  authenticateMimirBetaReviewedStep,
  createDraftHash,
  createExpectedWritesHash,
  createMimirBetaStageReceipt,
  createReviewHash,
  createStepIntentHash,
  reconcileMimirBetaConfirmedPreparationReceipts,
  reconcileStepReceipts,
  type MimirBetaExpectedWrite,
  type MimirBetaPlanStep,
  type MimirBetaPreparedStep,
  type MimirBetaProvenObservation,
  type MimirBetaStageReceipt,
  type MimirBetaStepId,
} from "../src/beta/review.js";
import { addressBytes, base64, bytesAddress, canonicalJson, concatBytes, domainHash, fromBase64, hex, sha256, utf8 } from "../src/beta/bytes.js";
import { conservativeMintOracleSourceConfigFloor } from "../src/math.js";
import { decodeMimirBetaLiveFeed, decodeMimirBetaLivePlan, decodeMimirBetaLiveSource } from "../src/beta/liveAbi.js";
import { buildTestSnapshotHeader, buildTestSourceConfigHeader, buildTestSourceObservationRingHeader } from "../src/fixtures.js";
import { SOURCE_RING_DAMM_ONLYB_V1 } from "../src/codec.js";
import { COMPOSITE_SNAPSHOT_COMPONENT_LEN, COMPOSITE_SNAPSHOT_MAGIC, COMPOSITE_SNAPSHOT_OFFSETS,
  CONFIG_OFFSETS, FEED_COLLATERAL_LOCK_HEADER_LEN, FEED_COLLATERAL_LOCK_MAGIC, FEED_COLLATERAL_LOCK_OFFSETS,
  FeedCollateralLockStatus, METEORA_DLMM_PROGRAM_ID, OFFSETS, PLAN_OFFSETS, RING_OFFSETS, SOURCE_OFFSETS,
  TWAP_OFFSETS, VERSION_V0 } from "../src/constants.js";
import { canonicalAddress } from "../src/internal/canonicalAuthority.js";
import { sealMimirBetaExpiredObservation } from "../src/internal/expiredObservationSeal.js";

const servedAccounts = new Map<string, unknown>();
const rawAddr = (byte: number) => bytesAddress(Uint8Array.from({ length: 32 }, () => byte));
const receiptPayerKeys = await webcrypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
const receiptPayer = await getAddressFromPublicKey(receiptPayerKeys.publicKey);
const rpcEvents: { method: string; commitment: string }[] = [];
const addr = (byte: number) => byte === 1 ? receiptPayer : rawAddr(byte);
const associatedTokenProgramId = address(canonicalAddress("SPL_ASSOCIATED_TOKEN"));
const deriveAssociatedTokenAddress = async (owner: Address, tokenProgram: Address, mint: Address) =>
  (await getProgramDerivedAddress({ programAddress: associatedTokenProgramId,
    seeds: [addressBytes(owner), addressBytes(tokenProgram), addressBytes(mint)] }))[0];
const feeOnlyRewrite = (message: Uint8Array) => {
  const compiled = getCompiledTransactionMessageDecoder().decode(message) as Extract<ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>, { version: 1 }>;
  assert.equal(compiled.configMask, 15);
  return new Uint8Array(getCompiledTransactionMessageEncoder().encode({ ...compiled,
    configValues: [{ kind: "u64", value: 280_000n }, ...compiled.configValues.slice(1)] } as never));
};
async function signedStageReceipt(preparedStep: Parameters<typeof createMimirBetaStageReceipt>[0]["preparedStep"], attempt: 1 | 2 = 1,
  retryOfSignature: string | null = null): Promise<MimirBetaStageReceipt> {
  const signature = bs58.encode(new Uint8Array(await webcrypto.subtle.sign("Ed25519", receiptPayerKeys.privateKey, preparedStep.transaction.serializedMessage)));
  return createMimirBetaStageReceipt({ preparedStep, signature, attempt, retryOfSignature, signedMessage: preparedStep.transaction.serializedMessage });
}
function finalizedActivationRpc(preparedStep: MimirBetaPreparedStep, receipt: MimirBetaStageReceipt,
  capture: { readonly addresses: readonly Address[]; readonly accounts: readonly ({ owner: Address; executable: boolean;
    lamports: bigint; data: Uint8Array } | null)[] }, slot: bigint, blockTime: bigint) {
  const message = getCompiledTransactionMessageDecoder().decode(preparedStep.transaction.serializedMessage);
  assert.equal(message.version, 1);
  if (message.version !== 1) throw new Error("expected Transaction v1");
  const signedBytes = preparedStep.transaction.serializedTransaction.slice();
  signedBytes.fill(113, preparedStep.transaction.serializedMessage.length);
  signedBytes.set(bs58.decode(receipt.signature), preparedStep.transaction.serializedMessage.length);
  const captured = new Map(capture.addresses.map((address, index) => [address, capture.accounts[index]!] as const));
  const writes = receipt.reviewedStep.step.expectedWrites;
  const writesByAddress = new Map(writes.map((write) => [write.address, write] as const));
  const deltas = new Map<Address, bigint>();
  for (const write of writes) {
    if (write.proof.kind === "account") {
      deltas.set(write.address, (write.proof.after.exists ? write.proof.after.lamports : 0n) - write.proof.before.lamports);
    } else if (write.proof.kind === "lamports") deltas.set(write.address, write.proof.programDeltaLamports);
  }
  const payer = preparedStep.review.authority;
  const payerDelta = -[...deltas].reduce((sum, [address, delta]) => address === payer ? sum : sum + delta, 0n);
  const fee = 1n;
  const preBalances = message.staticAccounts.map((address) => {
    const write = writesByAddress.get(address);
    const post = captured.get(address) ?? null;
    if (address === payer) return (post?.lamports ?? 1n) + fee - payerDelta;
    if (write?.proof.kind === "account") return write.proof.before.lamports;
    if (write?.proof.kind === "lamports") return (post?.lamports ?? 1n) - write.proof.programDeltaLamports;
    return post?.lamports ?? 1n;
  });
  const postBalances = message.staticAccounts.map((address, index) => {
    if (address === payer) return preBalances[index]! - fee + payerDelta;
    const write = writesByAddress.get(address);
    if (write?.proof.kind === "account") return write.proof.after.exists ? write.proof.after.lamports : 0n;
    return captured.get(address)?.lamports ?? preBalances[index]!;
  });
  const burns = writes.flatMap(({ proof }) => proof.kind === "spl-token-burn-checked" ? [proof] : []);
  const tokenBalances = (before: boolean) => burns.map((burn) => ({ accountIndex: message.staticAccounts.indexOf(burn.sourceTokenAccount),
    mint: burn.mint, owner: burn.authority, programId: burn.tokenProgram,
    uiTokenAmount: { amount: (new DataView(captured.get(burn.sourceTokenAccount)!.data.buffer).getBigUint64(64, true) +
      (before ? burn.amountRaw : 0n)).toString(), decimals: burn.decimals } }));
  const innerInstructions = burns.map((burn) => {
    const data = new Uint8Array(10); data[0] = 15; putU64(data, 1, burn.amountRaw); data[9] = burn.decimals;
    return { index: burn.outerInstructionIndex, instructions: [{ programIdIndex: message.staticAccounts.indexOf(burn.tokenProgram),
      accounts: [burn.sourceTokenAccount, burn.mint, burn.authority].map((a) => message.staticAccounts.indexOf(a)), data: bs58.encode(data) }] };
  });
  if (burns.length) {
    const core = writes.filter((write) => write.proof.kind === "account" && write.proof.after.exists &&
      write.proof.after.data.kind === "sdk-codec" && /mpl-core-(asset|collection)-v1/.test(write.proof.after.data.codec));
    innerInstructions.push({ index: 0, instructions: [{ programIdIndex: message.staticAccounts.indexOf(captured.get(core[0]!.address)!.owner),
      accounts: core.map((write) => message.staticAccounts.indexOf(write.address)), data: bs58.encode(Uint8Array.of(20)) }] });
  }
  const rawTransaction = { slot: Number(slot), blockTime: Number(blockTime), version: 1,
    transaction: [base64(signedBytes), "base64"], meta: { err: null, fee: Number(fee), preBalances: preBalances.map(Number),
      postBalances: postBalances.map(Number), preTokenBalances: tokenBalances(true), postTokenBalances: tokenBalances(false),
      loadedAddresses: { writable: [], readonly: [] }, innerInstructions } };
  const calls = { transactions: 0, accountReads: 0 };
  const rpc: Parameters<typeof observeMimirBetaReceipt>[0]["rpc"] = {
    getTransaction(signature) {
      calls.transactions += 1; assert.equal(signature, receipt.signature); return { send: async () => rawTransaction };
    },
    getAccountInfo() { return { send: async () => null }; },
    getMultipleAccounts(addresses) {
      calls.accountReads += 1;
      return { send: async () => ({ context: { slot: Number(slot) }, value: addresses.map((address) => {
        const account = captured.get(address) ?? null;
        return account ? { owner: account.owner, executable: account.executable, lamports: Number(account.lamports),
          data: [base64(account.data), "base64"] } : null;
      }) }) };
    },
  };
  return { rpc, calls };
}
const code = (expected: MimirBetaError["code"]) => (error: unknown) => error instanceof MimirBetaError && error.code === expected;
const readU128 = (data: { readonly buffer: ArrayBufferLike; readonly byteOffset: number; readonly byteLength: number }, offset: number) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(offset, true) | (view.getBigUint64(offset + 8, true) << 64n);
};

const clmmV1Registry = (versionMask: number) => ({ supportedAdapterMask: 2n, supportedAdapterVersionMasks: [0, versionMask, 0, 0, 0, 0, 0, 0] });
const pumpswapV1Registry = (versionMask: number) => ({ supportedAdapterMask: 1n << 6n, supportedAdapterVersionMasks: [0, 0, 0, 0, 0, 0, versionMask, 0] });
assert.throws(() => assertMimirBetaSourceAdapterVersions({ registry: clmmV1Registry(1), sources: [{ adapterType: 1, adapterVersion: 1 }] }), code("PLAN_STALE"));
assert.doesNotThrow(() => assertMimirBetaSourceAdapterVersions({ registry: clmmV1Registry(3), sources: [{ adapterType: 1, adapterVersion: 1 }] }));
assert.throws(() => assertMimirBetaSourceAdapterVersions({ registry: pumpswapV1Registry(1), sources: [{ adapterType: 6, adapterVersion: 1 }] }), code("PLAN_STALE"));
assert.doesNotThrow(() => assertMimirBetaSourceAdapterVersions({ registry: pumpswapV1Registry(3), sources: [{ adapterType: 6, adapterVersion: 1 }] }));

assert.deepEqual([1n, 2n, 10n, 11n].map((value) => conservativeMintOracleSourceConfigFloor(value)), [1n, 1n, 9n, 9n]);

assert.equal(parseMimirBetaIntegerQuantityX64("1"), 1n << 64n);
assert.equal(parseMimirBetaIntegerQuantityX64("18446744073709551615"), ((1n << 64n) - 1n) << 64n);
for (const invalid of ["", "0", "+1", "-1", "01", "1.0", "1e1", " 1", "18446744073709551616"]) {
  assert.throws(() => parseMimirBetaIntegerQuantityX64(invalid), code("INVALID_ARGUMENT"));
}

const common = {
  authority: addr(1), quoteMint: addr(2), ticker: "MIMIR", identity: { asset: addr(3), agentUri: "https://example.com/mimir/feed.json" },
  creatorCollateralTokenAccount: addr(4), displayName: "Composite Index",
};
const nativeSolMint = "So11111111111111111111111111111111111111112" as Address;
const classicPolicy = { profile: 0, riskTier: 1, priceExponent: -8, maxDispersionBps: 100,
  maxSourceActivityAgeSlots: 10, minCoverageRatioBps: 8000, maxConfidenceBps: 100,
  maxSnapshotAgeSlots: 20, anchorPolicyHash: new Uint8Array(32).fill(1), nativeExceptionHash: new Uint8Array(32).fill(2) };
const compositePolicy = { priceExponent: -8, maxSnapshotAgeSlots: 20, maxComponentSnapshotAgeSlots: 20,
  maxComponentConfidenceBps: 100, maxComponentDispersionBps: 100 };
for (const priceExponent of [-36, 19]) {
  await assert.rejects(() => prepareMimirBetaSimpleFeed({} as never, {
    ...common, baseMint: addr(6), pools: [], policy: { ...classicPolicy, priceExponent },
  }), code("NO_ELIGIBLE_POOLS"));
  await assert.rejects(() => prepareMimirBetaCompositeFeed({} as never, {
    ...common, components: [],
    policy: { ...compositePolicy, priceExponent },
  }), code("POOL_COUNT_OUT_OF_RANGE"));
}
for (const priceExponent of [20, 36]) {
  await assert.rejects(() => prepareMimirBetaSimpleFeed({} as never, {
    ...common, baseMint: addr(6), pools: [], policy: { ...classicPolicy, priceExponent },
  }), code("INVALID_ARGUMENT"));
  await assert.rejects(() => prepareMimirBetaCompositeFeed({} as never, {
    ...common, components: [{ feedId: addr(7), sourceConfig: addr(8), quantityX64: 1n }],
    policy: { ...compositePolicy, priceExponent },
  }), code("INVALID_ARGUMENT"));
}
for (const maxConfidenceBps of [1, 9_999]) {
  await assert.rejects(() => prepareMimirBetaSimpleFeed({} as never, {
    ...common, baseMint: addr(6), pools: [], policy: { ...classicPolicy, maxConfidenceBps },
  }), code("NO_ELIGIBLE_POOLS"));
}
for (const maxConfidenceBps of [0, 10_000]) {
  await assert.rejects(() => prepareMimirBetaSimpleFeed({} as never, {
    ...common, baseMint: addr(6), pools: [], policy: { ...classicPolicy, maxConfidenceBps },
  }), code("INVALID_ARGUMENT"));
}
assert.equal(MIMIR_BETA_AGENT_URI_MAX_UTF8_BYTES, 54);
const invalidAgentUris = ["   ", " https://example.com/mimir/feed.json", "https://example.com/mimir/feed.json ",
  "x".repeat(MIMIR_BETA_AGENT_URI_MAX_UTF8_BYTES + 1), "é".repeat(28)];
let dependencyAccesses = 0;
const forbiddenDependencies = new Proxy({}, { get() { dependencyAccesses += 1; throw new Error("dependency accessed"); } });
for (const agentUri of invalidAgentUris) {
  await assert.rejects(() => prepareMimirBetaSimpleFeed(forbiddenDependencies as never, {
    ...common, identity: { ...common.identity, agentUri }, baseMint: addr(6), pools: [], policy: classicPolicy,
  }), code("INVALID_ARGUMENT"));
  await assert.rejects(() => prepareMimirBetaCompositeFeed(forbiddenDependencies as never, {
    ...common, identity: { ...common.identity, agentUri },
    components: [{ feedId: addr(7), sourceConfig: addr(8), quantityX64: 1n }], policy: compositePolicy,
  }), code("INVALID_ARGUMENT"));
}
assert.equal(dependencyAccesses, 0);

for (const depthFloorBps of [0, -1, NaN, 1.5, 10_001]) {
  await assert.rejects(() => prepareMimirBetaSimpleFeed(forbiddenDependencies as never, {
    ...common, baseMint: addr(6), pools: [], policy: { ...classicPolicy, depthFloorBps },
  }), code("INVALID_ARGUMENT"));
  assert.throws(() => conservativeMintOracleSourceConfigFloor(100n, depthFloorBps), RangeError);
}
assert.equal(dependencyAccesses, 0, "invalid depth fractions reject before dependency access");

for (const preserveDraftPoolEvidence of [null, 0, "true", [], {}]) {
  await assert.rejects(() => prepareMimirBetaSimpleFeed(forbiddenDependencies as never, {
    ...common, baseMint: addr(6), pools: [], policy: classicPolicy, preserveDraftPoolEvidence,
  } as never), code("INVALID_ARGUMENT"));
}
assert.equal(dependencyAccesses, 0, "malformed draft-evidence flags reject before dependency access");

await assert.rejects(() => prepareMimirBetaSimpleFeed(forbiddenDependencies as never, {
  ...common, identity: { ...common.identity, agentUri: "" }, baseMint: addr(6), pools: [], policy: classicPolicy,
}), code("NO_ELIGIBLE_POOLS"));
await assert.rejects(() => prepareMimirBetaCompositeFeed(forbiddenDependencies as never, {
  ...common, identity: { ...common.identity, agentUri: "" },
  components: [], policy: compositePolicy,
}), code("POOL_COUNT_OUT_OF_RANGE"));
assert.equal(dependencyAccesses, 0, "canonical empty agent URI reaches feed-specific validation without dependency access");

for (const displayName of ["", " name", "name ", "e\u0301", "a".repeat(251), "a\u0000b", "a\u202eb"]) {
  await assert.rejects(() => prepareMimirBetaCompositeFeed(forbiddenDependencies as never, {
    ...common, displayName, components: [{ feedId: addr(7), sourceConfig: addr(8), quantityX64: 1n }], policy: compositePolicy,
  }), code("INVALID_ARGUMENT"));
}
assert.equal(dependencyAccesses, 0, "invalid Composite display names reject before RPC/dependency access");

const exactBoundaryUri = `https://example.com/${"a".repeat(34)}`;
assert.equal(utf8(exactBoundaryUri).length, MIMIR_BETA_AGENT_URI_MAX_UTF8_BYTES);
await assert.rejects(() => prepareMimirBetaSimpleFeed(forbiddenDependencies as never, {
  ...common, identity: { ...common.identity, agentUri: exactBoundaryUri }, baseMint: addr(6), pools: [], policy: classicPolicy,
}), code("NO_ELIGIBLE_POOLS"));
await assert.rejects(() => prepareMimirBetaCompositeFeed(forbiddenDependencies as never, {
  ...common, identity: { ...common.identity, agentUri: exactBoundaryUri },
  components: [
    { feedId: addr(7), sourceConfig: addr(8), quantityX64: 0n },
    { feedId: addr(9), sourceConfig: addr(10), quantityX64: 1n },
  ], policy: compositePolicy,
}), (error: unknown) => error instanceof MimirBetaError && error.code === "INVALID_ARGUMENT" &&
  error.message.includes("quantity X64"));
assert.equal(dependencyAccesses, 0);

{
  const boostedPool = { family: "pumpswap", pool: addr(13), observedSlot: 5n };
  let rpcAccesses = 0;
  const boostDependencies = new Proxy({}, { get(_, key) {
    if (key === "discovery") return { revalidateSelectedPools: async ({ pools }: { pools: unknown[] }) =>
      ({ slot: 5n, pools, freshPools: [{ ...boostedPool, boostVaultLamports: 11_060_000_000n, maxBoostDriftBps: 50n }] }) };
    rpcAccesses += 1; throw new Error("dependency accessed");
  } });
  await assert.rejects(() => prepareMimirBetaSimpleFeed(boostDependencies as never, {
    ...common, baseMint: addr(6), pools: [boostedPool] as never, policy: classicPolicy,
  }), (error: unknown) => error instanceof MimirBetaError && error.code === "PUMPSWAP_BOOST_PENDING" && error.address === addr(13));
  assert.equal(rpcAccesses, 0, "a funded PumpSwap boost vault refuses creation before any RPC or transaction");
}

const identityAdapter = createMimir8004IdentityAdapter({
  cluster: "localnet", mimirProgramId: addr(10), agentRegistryProgramId: addr(11),
  mplCoreProgramId: MIMIR_BETA_MPL_CORE_PROGRAM_ID, systemProgramId: MIMIR_BETA_SYSTEM_PROGRAM_ID,
  physicalCollection: addr(12), collectionPointer: "c1:bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
});
const protocolBoundaryUri = `https://example.com/${"é".repeat(115)}`;
assert.equal(utf8(protocolBoundaryUri).length, 250);
const register = await identityAdapter.buildRegister({ asset: common.identity.asset, authority: common.authority, agentUri: protocolBoundaryUri });
assert.deepEqual(register.data.subarray(0, 8), Uint8Array.of(177, 175, 96, 41, 59, 166, 13, 6));
assert.equal(new DataView(register.data.buffer, register.data.byteOffset + 8, 4).getUint32(0, true), 250);
assert.deepEqual(register.data.subarray(12, 262), utf8(protocolBoundaryUri));
assert.equal(register.data[262], 0);

await assert.rejects(() => prepareMimirBetaSimpleFeed({} as never, {
  ...common, baseMint: addr(6), pools: [],
  policy: classicPolicy,
}), code("NO_ELIGIBLE_POOLS"));
await assert.rejects(() => prepareMimirBetaCompositeFeed({} as never, {
  ...common, components: [
    { feedId: addr(7), sourceConfig: addr(8), quantityX64: 0n },
    { feedId: addr(9), sourceConfig: addr(10), quantityX64: 1n },
  ],
  policy: compositePolicy,
}), code("INVALID_ARGUMENT"));

const activation: MimirBetaPlanStep = {
  stepId: "classic:activate", stage: "mimir-create", ordinal: 0, prerequisiteStepIds: [],
  requiredSigners: [addr(1), addr(3)], expectedWrites: [],
};
const reconciled = reconcileStepReceipts({ draftHash: "1".repeat(64), steps: [activation], receipts: [], observations: [], observedSlot: 1n });
assert.equal(reconciled.action, "review-next-step");
assert.equal(reconciled.nextStepId, "classic:activate");
assert.equal(reconciled.steps.some((state) => state.stepId.includes("initialize")), false);
assert.deepEqual(activation.requiredSigners, [addr(1), addr(3)]);

const instructionDataHash = hex(await sha256(Uint8Array.of(1)));
async function reviewedReceipt(args: { kind: "classic" | "composite"; draftHash: string; step: MimirBetaPlanStep; marker: number;
  attempt?: 1 | 2; retryOfSignature?: string }) {
  const expectedWritesHash = await createExpectedWritesHash(args.step.expectedWrites);
  const stepIntentHash = await createStepIntentHash({ draftHash: args.draftHash, step: args.step, expectedWritesHash });
  const reviewedTransaction = await compileMimirBetaTransactionV1({ feePayer: receiptPayer,
    recentBlockhash: bs58.encode(Uint8Array.from({ length: 32 }, () => args.marker)), lastValidBlockHeight: 50n,
    instructions: [{ programAddress: addr(20), accounts: [
      { address: args.step.expectedWrites[0]!.address, isSigner: false, isWritable: true },
      ...args.step.requiredSigners.slice(1).map((address) => ({ address, isSigner: true, isWritable: true })),
    ], data: Uint8Array.of(1) }] });
  const messageHash = reviewedTransaction.messageHash;
  const reviewBase = {
    schema: "mimir-beta-creation-review" as const, version: 1 as const, draftHash: args.draftHash, stepId: args.step.stepId,
    kind: args.kind, cluster: "localnet" as const, programId: addr(20), authority: receiptPayer, feedId: addr(21), feed: addr(22),
    identityAsset: addr(3), ticker: common.ticker, displayName: args.kind === "composite" ? common.displayName : null,
    requiredSigners: args.step.requiredSigners,
    instructions: [{ programAddress: addr(20), accounts: reviewedTransaction.instructions[0]!.accounts,
      dataBase64: "AQ==", dataSha256: instructionDataHash }],
    expectedWrites: args.step.expectedWrites, messageHash, stepIntentHash, expectedWritesHash,
    packet: reviewedTransaction.packet,
    simulation: { status: "succeeded" as const, contextSlot: 1n, unitsConsumed: 1n, logsHash: "a".repeat(64), returnDataHash: null, error: null }, warnings: [],
  };
  const review = await createReviewHash(reviewBase);
  const preparedStep = { step: args.step, transaction: reviewedTransaction, review: reviewBase, ...review };
  return signedStageReceipt(preparedStep, args.attempt, args.retryOfSignature);
}

const oldDraft = await createDraftHash({ schema: "mimir-beta-draft", version: 1, identity: common.identity });
const changedDraft = await createDraftHash({ schema: "mimir-beta-draft", version: 1,
  identity: { ...common.identity, agentUri: "https://example.com/mimir/changed.json" } });
assert.notEqual(changedDraft.draftHash, oldDraft.draftHash);
assert.match(oldDraft.canonicalDraftJson, /"agentUri":"https:\/\/example\.com\/mimir\/feed\.json"/);
const lineageStep: MimirBetaPlanStep = { ...activation, requiredSigners: [receiptPayer, addr(3)], expectedWrites: [{ address: addr(42), effect: "lamports",
  ownerAfter: null, dataLengthAfter: null, discriminatorHex: null, description: "lineage write",
  proof: { kind: "lamports", programDeltaLamports: 1n } }] };
const oldUriReceipt = await reviewedReceipt({ kind: "classic", draftHash: oldDraft.draftHash, step: lineageStep, marker: 9 });
assert.throws(() => reconcileStepReceipts({ draftHash: changedDraft.draftHash, steps: [lineageStep], receipts: [oldUriReceipt],
  observations: [], observedSlot: 1n }), code("RECEIPT_MISMATCH"));

async function proveSequentialResume(kind: "classic" | "composite", ids: readonly [MimirBetaStepId, MimirBetaStepId, MimirBetaStepId]) {
  const draftHash = (kind === "classic" ? "c" : "d").repeat(64);
  const base = ids.map((stepId, ordinal): MimirBetaPlanStep => ({ stepId, stage: "mimir-create", ordinal,
    prerequisiteStepIds: ordinal === 0 ? [] : [ids[ordinal - 1]!], requiredSigners: [receiptPayer], expectedWrites: [] }));
  const writeFor = (marker: number): MimirBetaExpectedWrite => ({ address: addr(marker), effect: "lamports", ownerAfter: null,
    dataLengthAfter: null, discriminatorHex: null, description: "exact reviewed write",
    proof: { kind: "lamports", programDeltaLamports: 1n } });
  const firstStep = { ...base[0]!, expectedWrites: [writeFor(kind === "classic" ? 40 : 50)] };
  const secondStep = { ...base[1]!, expectedWrites: [writeFor(kind === "classic" ? 41 : 51)] };
  const first = await reviewedReceipt({ kind, draftHash, step: firstStep, marker: kind === "classic" ? 4 : 5 });
  const second = await reviewedReceipt({ kind, draftHash, step: secondStep, marker: kind === "classic" ? 6 : 7 });
  const hydrate = async (receipts: readonly MimirBetaStageReceipt[]) => {
    const lineages = await Promise.all(receipts.map(authenticateMimirBetaReviewedStep));
    return base.map((step) => lineages.find((lineage) => lineage.step.stepId === step.stepId)?.step ?? step);
  };
  const observation = (receipt: MimirBetaStageReceipt) => ({ state: "finalized" as const, stepId: receipt.stepId,
    signature: receipt.signature, observedSlot: 2n, accountContextSlot: 2n, messageHash: receipt.messageHash,
    evidenceHash: "e".repeat(64), writes: receipt.reviewedStep.step.expectedWrites.map((write, index) => ({
      index, address: write.address, kind: "lamports" as const, evidenceHash: "f".repeat(64),
    })) });
  const afterOneSteps = await hydrate([first]);
  const afterOne = reconcileStepReceipts({ draftHash, steps: afterOneSteps, receipts: [first], observations: [observation(first)], observedSlot: 2n });
  assert.equal(afterOne.steps[0]!.state, "finalized");
  assert.equal(afterOne.action, "review-next-step");
  assert.equal(afterOne.nextStepId, ids[1]);
  const afterTwoSteps = await hydrate([first, second]);
  const afterTwo = reconcileStepReceipts({ draftHash, steps: afterTwoSteps, receipts: [first, second],
    observations: [observation(first), observation(second)], observedSlot: 3n });
  assert.equal(afterTwo.steps[0]!.state, "finalized");
  assert.equal(afterTwo.steps[1]!.state, "finalized");
  assert.equal(afterTwo.nextStepId, ids[2]);
  assert.equal(afterTwoSteps[0]!.expectedWrites.length, 1);
  assert.equal(afterTwoSteps[1]!.expectedWrites.length, 1);
  const changedWrite = { ...first.reviewedStep.step.expectedWrites[0]!, address: addr(99) };
  await assert.rejects(() => authenticateMimirBetaReviewedStep({ ...first, reviewedStep: { ...first.reviewedStep,
    step: { ...first.reviewedStep.step, expectedWrites: [changedWrite] } } }));
  const wrongObservation = { ...observation(first), writes: [{ index: 0, address: addr(99), kind: "lamports" as const, evidenceHash: "f".repeat(64) }] };
  assert.equal(reconcileStepReceipts({ draftHash, steps: afterOneSteps, receipts: [first], observations: [wrongObservation], observedSlot: 2n }).action, "blocked");
  const secondMarker = kind === "classic" ? 6 : 7;
  const expired = async (receipt: MimirBetaStageReceipt, marker: number, rollback: "baseline-matched" | "state-diverged") => {
    const fields = { stepId: receipt.stepId, signature: receipt.signature, messageHash: receipt.messageHash,
      blockhash: bs58.encode(Uint8Array.from({ length: 32 }, () => marker)), observedSlot: 3n, accountContextSlot: 3n, rollback };
    return { state: "expired" as const, ...fields, evidenceHash: await domainHash("MIMIR_BETA_EXPIRED_EVIDENCE_V1\0", canonicalJson(fields as never)) };
  };
  const sealedExpired = async (receipt: MimirBetaStageReceipt, marker: number, rollback: "baseline-matched" | "state-diverged") =>
    sealMimirBetaExpiredObservation(await expired(receipt, marker, rollback));
  const afterExpiry = (receipts: readonly MimirBetaStageReceipt[], observations: readonly MimirBetaProvenObservation[]) =>
    reconcileStepReceipts({ draftHash, steps: afterTwoSteps, receipts: [first, ...receipts],
      observations: [observation(first), ...observations], observedSlot: 3n });
  assert.equal(afterExpiry([second], [await expired(second, secondMarker, "baseline-matched")]).action, "blocked");
  const retry = afterExpiry([second], [await sealedExpired(second, secondMarker, "baseline-matched")]);
  assert.equal(retry.steps[0]!.state, "finalized");
  assert.equal(retry.action, "retry-once");
  assert.equal(retry.nextStepId, ids[1]);
  assert.equal(afterExpiry([second], [await sealedExpired(second, secondMarker, "state-diverged")]).action, "blocked");
  assert.equal(afterExpiry([second], [{ ...await expired(second, secondMarker, "state-diverged"), rollback: "baseline-matched" }]).action, "blocked");
  assert.equal(afterExpiry([second], [{ ...await expired(second, secondMarker, "baseline-matched"), messageHash: first.messageHash }]).action, "blocked");
  assert.equal(reconcileStepReceipts({ draftHash, steps: afterTwoSteps, receipts: [first, second],
    observations: [await sealedExpired(second, secondMarker, "baseline-matched")], observedSlot: 3n }).action, "await-finality");
  const retried = await reviewedReceipt({ kind, draftHash, step: secondStep, marker: secondMarker + 10, attempt: 2, retryOfSignature: second.signature });
  assert.equal(afterExpiry([second, retried], [await sealedExpired(retried, secondMarker + 10, "baseline-matched")]).action, "blocked");
}

await proveSequentialResume("classic", ["classic:proposal-init", "classic:source-append:0", "classic:activate"]);

const putU16 = (data: Uint8Array, offset: number, value: number) => new DataView(data.buffer).setUint16(offset, value, true);
const putU32 = (data: Uint8Array, offset: number, value: number) => new DataView(data.buffer).setUint32(offset, value, true);
const putU64 = (data: Uint8Array, offset: number, value: bigint) => new DataView(data.buffer).setBigUint64(offset, value, true);
const putU128 = (data: Uint8Array, offset: number, value: bigint) => {
  putU64(data, offset, value); putU64(data, offset + 8, value >> 64n);
};
const proposalCreationSlot = 2n;
const proposalCreationUnixTs = 3n;
const compositeSimulationSlot = 5n;
const compositeSimulationUnixTs = 4n;
const compositeFinalizedSlot = 6n;
const compositeFinalizedBlockTime = 7n;
const atomicRing = (slot: bigint) => {
  const data = new Uint8Array(544); data.set(buildTestSourceObservationRingHeader());
  putU16(data, 10, 544); putU16(data, 50, 1); data[53] = 0; putU16(data, 54, 1); putU16(data, 56, 300); putU16(data, 58, 0); putU16(data, 60, 1);
  putU64(data, 64, slot); putU64(data, 72, slot); putU64(data, 80, 0n); putU128(data, 144, 0n); putU64(data, 160, 0n);
  putU128(data, 88, 1n); putU128(data, 112, 1n); putU128(data, 128, 1n);
  data.fill(1, 184, 216); putU128(data, 320, 1n); putU128(data, 336, 1n); putU64(data, 352, 1n); putU16(data, 360, 50);
  data[369] = 1; data.fill(0, 370, 448); putU64(data, 448, slot); putU64(data, 456, 0n);
  for (const offset of [464, 480, 496, 512, 528]) putU128(data, offset, 1n);
  return data;
};
const pointOnlyAtomicRing = (slot: bigint) => {
  const data = atomicRing(slot); new DataView(data.buffer).setUint32(12, 1, true); data[52] = 6; putU16(data, 104, 1); putU16(data, 106, 0);
  data.fill(0, 320, 352); putU16(data, 360, 0); data[368] = 2; putU16(data, 376, 1); data.fill(0, 512, 544);
  return data;
};
const extendedDammRing = (prefix: Uint8Array, slot: bigint, adapterType = 7, malformed = false) => {
  const data = new Uint8Array(784); data.set(prefix.subarray(0, 544));
  data[8] = 1; putU16(data, 10, 784); data[RING_OFFSETS.adapterType] = adapterType;
  const o = SOURCE_RING_DAMM_ONLYB_V1;
  putU16(data, o.proofKindOffset, o.proofKind); putU16(data, o.flagsOffset, o.presenceA);
  data.fill(1, o.contextHashOffset, o.contextHashOffset + 32);
  new DataView(data.buffer).setBigInt64(o.lastObservationUnixTsOffset, 4n, true);
  putU64(data, o.anchorOffset, slot); new DataView(data.buffer).setBigInt64(o.anchorOffset + 8, 4n, true);
  putU128(data, o.anchorOffset + 16, 1n << 64n); putU128(data, o.anchorOffset + 32, 0n);
  putU64(data, o.anchorOffset + 48, 0n); putU128(data, o.anchorOffset + 56, 1n);
  if (malformed) data[o.reservedOffset] = 1;
  return data;
};
const atomicSnapshot = (slot: bigint, sourceCount = 1, feedId?: Address) => buildTestSnapshotHeader((data) => {
  if (feedId) data.set(addressBytes(feedId), 16);
  data[107] = 1; data[108] = 0; data[109] = 1; putU64(data, 116, slot); putU64(data, 124, slot + 20n);
  putU64(data, 140, slot); putU64(data, 148, slot); putU64(data, 156, 0n);
  for (const offset of [164, 172, 180]) putU64(data, offset, 0n);
  data[252] = sourceCount; data[253] = sourceCount; data[254] = sourceCount; putU16(data, 255, 10_000);
  putU64(data, 294, (1n << BigInt(sourceCount)) - 1n); data[334] = 0; data[335] = 1;
});
const compositeSnapshot = (programId: Address, config: Address, configData: Uint8Array, slot: bigint, count: number) => {
  const data = new Uint8Array(720); data.set(COMPOSITE_SNAPSHOT_MAGIC); putU16(data, 10, 720);
  data.set(configData.subarray(16, 48), COMPOSITE_SNAPSHOT_OFFSETS.feedId); data.set(addressBytes(config), COMPOSITE_SNAPSHOT_OFFSETS.compositeConfig);
  putU64(data, 80, 1n); putU64(data, 88, 1n); putU64(data, 96, 1n); data[104] = 0; data[105] = 4; data[106] = 0;
  data[107] = 4; data[108] = 0; data[109] = count; data[110] = 0; putU64(data, 112, slot); putU64(data, 120, slot + 20n);
  putU64(data, 136, slot); putU64(data, 144, 0n); putU64(data, 152, 1n); putU128(data, 168, 1n);
  putU128(data, 184, 1n); putU128(data, 200, 1n); data.fill(1, 248, 312); data.set(configData.subarray(128, 160), 248); data[313] = 1;
  for (let index = 0; index < count; index += 1) { const offset = 320 + index * COMPOSITE_SNAPSHOT_COMPONENT_LEN;
    data.set(configData.subarray(229 + index * 80, 261 + index * 80), offset); putU64(data, offset + 32, 1n); putU64(data, offset + 40, slot);
    putU128(data, offset + 48, 1n); putU128(data, offset + 64, 1n); }
  return data;
};
const collateralLockData = (creationSlot = proposalCreationSlot, creationUnixTs = proposalCreationUnixTs) => {
  const data = new Uint8Array(160); data.set(utf8("MIMIRCOL"));
  putU64(data, 120, creationSlot); putU64(data, 128, creationUnixTs);
  return data;
};
const rpcValue = (account: { owner: Address; executable: boolean; lamports: bigint; data: Uint8Array } | null) => account === null ? null : ({
  owner: account.owner, executable: account.executable, lamports: account.lamports, data: [base64(account.data), "base64"],
});
const coreCollectionData = (updateAuthority: Address) => {
  const u32 = (value: number) => { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, true); return out; };
  return concatBytes(Uint8Array.of(5), addressBytes(updateAuthority), u32(0), u32(0), u32(0), u32(0));
};
const coreAssetData = (owner: Address, collection: Address) => {
  const sized = (value: Uint8Array) => {
    const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, value.length, true);
    return concatBytes(length, value);
  };
  return concatBytes(Uint8Array.of(1), addressBytes(owner), Uint8Array.of(2), addressBytes(collection),
    sized(utf8("Component")), sized(new Uint8Array()), Uint8Array.of(0));
};

type OfflineNativeAccount = { address: Address; owner: Address; executable: boolean; lamports: bigint; data: Uint8Array };
type OfflineNativeConverter = { programId: Address; quoteMint: Address; feedId: Address; sourceConfig: Address;
  pool: MimirBetaEligiblePool; contextSlot: bigint; before: readonly OfflineNativeAccount[];
  after: ReadonlyMap<Address, OfflineNativeAccount> };
const nativeProjectionCapture = JSON.parse(fs.readFileSync(
  new URL("./fixtures/nativeMonoPublicProjectionCapture.json", import.meta.url), "utf8")) as {
    contextSlot: number; addresses: Address[]; accounts: Array<{ owner: Address; executable: boolean; data: [string, "base64"] }>;
  };
const offlineNativeConverter = (history: "valid" | "invalid" | "unavailable" = "valid", fresh = false): OfflineNativeConverter => {
  const contextSlot = BigInt(nativeProjectionCapture.contextSlot);
  const captured = nativeProjectionCapture.addresses.slice(0, 10).map((key, index): OfflineNativeAccount => ({
    address: key, owner: nativeProjectionCapture.accounts[index]!.owner,
    executable: nativeProjectionCapture.accounts[index]!.executable, lamports: 10n,
    data: Uint8Array.from(Buffer.from(nativeProjectionCapture.accounts[index]!.data[0], "base64")),
  }));
  const source = decodeMimirBetaLiveSource(captured[5]!.data);
  const programId = captured[5]!.owner;
  const previousSnapshot = Uint8Array.from(captured[0]!.data);
  const previousTwap = Uint8Array.from(captured[1]!.data);
  const previousRing = Uint8Array.from(captured[2]!.data);
  const staleSlot = fresh ? contextSlot - 1n : contextSlot - 200n;
  const snapshotView = new DataView(previousSnapshot.buffer, previousSnapshot.byteOffset);
  const twapView = new DataView(previousTwap.buffer, previousTwap.byteOffset);
  const previousNewestSlot = contextSlot - 1n;
  const previousRingView = new DataView(previousRing.buffer, previousRing.byteOffset);
  putU64(previousRing, RING_OFFSETS.newestSlot, previousNewestSlot);
  putU64(previousRing, RING_OFFSETS.oldestSlot,
    previousNewestSlot - previousRingView.getBigUint64(RING_OFFSETS.cumulativeSlotDelta, true));
  putU64(previousRing, RING_OFFSETS.lastActivitySlot,
    previousRingView.getBigUint64(RING_OFFSETS.lastActivitySlot, true) > previousNewestSlot
      ? previousNewestSlot : previousRingView.getBigUint64(RING_OFFSETS.lastActivitySlot, true));
  putU64(previousRing, RING_OFFSETS.completedEndSlot, previousNewestSlot);
  putU64(previousSnapshot, OFFSETS.snapshotRevision, snapshotView.getBigUint64(OFFSETS.snapshotRevision, true) - 1n);
  putU64(previousSnapshot, OFFSETS.snapshotSlot, staleSlot);
  putU64(previousSnapshot, OFFSETS.validUntilSlot, staleSlot + 150n);
  putU64(previousSnapshot, OFFSETS.spotSlot, staleSlot);
  putU64(previousSnapshot, OFFSETS.oldestSourceObservedSlot, staleSlot);
  putU64(previousSnapshot, OFFSETS.oldestSourceActivitySlot, staleSlot);
  for (const offset of [OFFSETS.twapShortEndSlot, OFFSETS.twapMediumEndSlot, OFFSETS.twapLongEndSlot]) {
    putU64(previousSnapshot, offset, staleSlot);
  }
  putU64(previousTwap, TWAP_OFFSETS.revision, twapView.getBigUint64(TWAP_OFFSETS.revision, true) - 1n);
  for (const offset of [TWAP_OFFSETS.shortEndSlot, TWAP_OFFSETS.mediumEndSlot, TWAP_OFFSETS.longEndSlot,
    TWAP_OFFSETS.sourceActivitySlotMin]) putU64(previousTwap, offset, staleSlot);
  const before = captured.map((account) => ({ ...account, data: Uint8Array.from(account.data) }));
  before[0]!.data = previousSnapshot; before[1]!.data = previousTwap; before[2]!.data = previousRing;
  if (history === "invalid") before[8]!.data[0] ^= 1;
  const poolAddress = bytesAddress(source.poolOrMarket);
  const baseVault = bytesAddress(source.baseVault);
  const quoteVault = bytesAddress(source.quoteVault);
  const observationState = captured[8]!.address;
  const ammConfig = address("D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2");
  const staticAccounts = [{ role: "base-vault" as const, address: baseVault }, { role: "quote-vault" as const, address: quoteVault },
    { role: "pool" as const, address: poolAddress }, { role: "amm-config" as const, address: ammConfig }];
  for (const binding of staticAccounts) if (!before.some((account) => account.address === binding.address)) before.push({
    address: binding.address, owner: binding.role === "base-vault" || binding.role === "quote-vault"
      ? bytesAddress(source.tokenProgram) : bytesAddress(source.programId), executable: false, lamports: 10n, data: new Uint8Array(),
  });
  const pool: MimirBetaEligiblePool = { eligibility: "eligible", family: "raydium-cpmm", programId: bytesAddress(source.programId),
    pool: poolAddress, descriptorId: "captured-cpmm", descriptorHash: "0".repeat(64),
    readPlan: {} as never,
    canonicalMint0: bytesAddress(source.baseMint), canonicalMint1: bytesAddress(source.quoteMint), canonicalPairKey: "captured-cpmm",
    direction: "quote-per-base", baseMint: bytesAddress(source.baseMint), quoteMint: bytesAddress(source.quoteMint), baseVault, quoteVault,
    minLiquidityNative: source.minLiquidityNative, minDepthTo50BpsNative: source.minDepthTo50BpsNative,
    observedSlot: contextSlot - 1n, validThroughSlot: contextSlot + 10n, evidenceHash: "1".repeat(64),
    creation: { adapterType: 2, adapterVersion: 0, bindingVariant: "direct", tokenProgramId: bytesAddress(source.tokenProgram),
      token2022Mint: null, vaultAuthority: bytesAddress(source.vaultAuthority), staticAccounts, observationState,
      operatorGroup: source.operatorGroup, liquidityOwnerGroup: source.liquidityOwnerGroup, quoteAssetGroup: source.quoteAssetGroup,
      bridgeOrWrapperGroup: source.bridgeOrWrapperGroup, oracleSourceClass: source.oracleSourceClass,
      upgradeAuthorityGroup: source.upgradeAuthorityGroup } } as unknown as MimirBetaEligiblePool;
  const after = new Map(captured.map((account) => [account.address, account]));
  for (const account of before) if (!after.has(account.address)) after.set(account.address, account);
  return { programId, quoteMint: bytesAddress(source.quoteMint), feedId: bytesAddress(source.feedId),
    sourceConfig: captured[5]!.address, pool, contextSlot,
    before: before.filter((account) => history !== "unavailable" || account.address !== observationState), after };
};

async function creationFixture(threshold: 1 | 2, signers: readonly Address[], kind: "classic" | "composite",
  thirdSigner: Address | null = addr(9), resume: Readonly<{
    receipts?: readonly MimirBetaStageReceipt[];
    observations?: readonly import("../src/beta/review.js").ReconciliationObservation[];
    preserveDraftPoolEvidence?: boolean;
    allowCollateralFunding?: boolean;
    estimateFundingCosts?: boolean;
    fullCollateralPurchase?: boolean;
    callerPrefix?: import("../src/beta/creation.js").MimirBetaCallerPrefix;
    abi1Capability?: import("../src/beta/abi1Release.js").MimirAbi1Capability;
    collateralAccountMissing?: boolean;
    collateralAccountAddress?: Address;
    collateralBalanceRaw?: bigint;
    collateralDataLength?: number;
    collateralMintOverride?: Address;
    collateralAuthorityOverride?: Address;
    collateralTokenProgramOwner?: Address;
    rpcContextFloors?: bigint[];
    confirmedRpc?: Parameters<typeof prepareMimirBetaSimpleFeedConfirmed>[2];
    finalizedOnlyPlanning?: boolean;
    simulationUnits?: number;
    revalidationSlot?: (baseMint: Address) => bigint;
    revalidationCalls?: { count: number; slots?: bigint[]; maxInFlight?: number; baseMints?: Address[] };
    pools?: readonly unknown[];
    slot?: bigint;
    freshEvidenceSlot?: bigint;
    clockUnix?: bigint;
    freshFloorDrift?: boolean;
    enforceEvidenceWindow?: true;
    action?: Readonly<{ status: number; effectiveSlot: bigint; expiresSlot: bigint }>;
    supportedAdapterMask?: bigint;
    supportedAdapterVersionMasks?: readonly number[];
    preparationCalls?: { blockhash: number; simulation: number };
    fundingPayerLamports?: bigint;
    fundingCollateralLamports?: bigint;
    fundingCostCapture?: { rentReads: number; feeMessages: string[]; blockhashCalls?: number };
    fundingCostRpc?: Readonly<{ missingFee?: true; feeValues?: readonly unknown[] }>;
    simulationWire?: { value: string | null };
    simulatedRingLength?: 544 | 784 | 785;
    simulatedRingAdapterType?: number;
    simulatedPointOnlyRing?: boolean;
    temporalMode?: "current-point" | "sampled-interval";
    depthFloorBps?: number;
    baseMint?: Address;
    tokenProgramId?: Address;
    recipes?: readonly (string | null)[];
    componentRecipes?: readonly (string | null)[];
    nativeAccounts?: readonly Readonly<{ address: Address; owner: Address; data: Uint8Array<ArrayBuffer> }>[];
    variant?: number | "new";
    frozenFeedId?: Address;
    malformedSimulatedRingTail?: true;
    simulationErr?: unknown;
    pointProbe?: "ok" | "err" | "structural" | "absent-proposal";
    dexActivity?: "none" | "failed" | "readonly";
    pointProbeUnits?: number | null;
    pointProbeSlot?: bigint;
    pointProbeWire?: { value: string | null };
    simulationLogs?: readonly string[];
    activationProposalPost?: Readonly<{
      address: Address;
      account: { owner: Address; executable: boolean; lamports: bigint; data: Uint8Array };
    }>;
    successfulCompositeActivation?: true;
    configuredRecovery?: true;
    configuredRootPresent?: true;
    configuredLockBindingMismatch?: true;
    configuredStateReceipt?: MimirBetaStageReceipt;
    reconciliationRpc?: Parameters<typeof observeMimirBetaReceipt>[0]["rpc"];
    retryBlockhash?: string;
    configuredCoreOwnerOverride?: Address;
    recoveryIntent?: Readonly<{ ticker?: string; identityAsset?: Address; componentQuantityX64?: bigint }>;
    extraDependencies?: Readonly<Record<string, unknown>>;
    compositeCreateClassicPool?: unknown;
    occupiedCompositeClassic?: true;
    occupiedIdentity?: Address;
    compositeCreateClassicIndex?: number;
    compositeCreateClassicVariant?: number;
    compositeCreateClassicTemporalMode?: "current-point" | "sampled-interval";
    stagedExecution?: true;
    compositeCreateClassicPools?: readonly unknown[];
    displayName?: string;
    componentCount?: 0 | 1 | 2 | 4 | 5;
    reverseComponents?: true;
    solConversionSourceConfig?: Address;
    componentInputCapture?: MimirBetaCompositeComponentInput[];
    existingSentinelPools?: readonly MimirBetaEligiblePool[];
    existingComponentAccounts?: readonly OfflineNativeAccount[];
    omitExistingRings?: true;
    existingRingOwner?: Address;
    prefundedAddresses?: readonly Address[];
    missingComponentCoreAsset?: true;
    existingComponentPool?: (pool: MimirBetaEligiblePool, index: number) => MimirBetaEligiblePool;
    qualityCaps?: { maxComponentConfidenceBps: number; maxComponentDispersionBps: number };
    nativeConverter?: OfflineNativeConverter;
    existingAuthenticated?: true;
    existingDammRing784?: true;
    journey?: Omit<PrepareCompositeFeedJourneyArgs, "input"> & { rpc?: Partial<Parameters<typeof observeMimirBetaReceipt>[0]["rpc"]>;
      simulations?: { commitment: string; minContextSlot: bigint }[]; childPools?: ReadonlyMap<number, MimirBetaEligiblePool> };
    existingDammRingAddress?: Address;
    existingDammRingLamports?: bigint;
    useExistingSentinelConversion?: true;
    existingSentinelHeaderMismatch?: true;
    missingExistingDiscovery?: true;
    discoveryCalls?: { query: string; maxPools: number; maxInFlight: number };
    discoveryQueries?: string[];
    discoveryDelayMs?: (query: string) => number;
    blankDiscoveryWinner?: MimirBetaEligiblePool;
    exactDiscoveryError?: unknown;
    exactDiscoverySubstitute?: (pool: MimirBetaEligiblePool) => MimirBetaEligiblePool;
    useCanonicalSolConversion?: true;
    nativeDeepConversion?: true;
    staleNativeDeepConversion?: true;
    mixedConversion?: true;
    sentinelOrdinary?: true;
    belowFloorComponent?: true;
    sentinelConversionRing?: true;
    stagedPrefixInvalid?: "malformed" | "future";
    stagedReadinessInvalid?: "malformed" | "future" | "binding";
    finalizedClassicOwnerOverride?: Address;
    existingReadySlot?: bigint;
    maxComponentSnapshotAgeSlots?: number;
    useFreshClassicConversion?: true;
    canonicalSolConversionPool?: (pool: MimirBetaEligiblePool) => MimirBetaEligiblePool;
    converterRecipes?: readonly ("native-bounded" | null)[];
    existingAtomicStale?: true;
    solQuotedComponent?: true;
    occupiedProposalAddress?: Address;
    assignedTickerConfig?: Address;
    ticker?: string;
    oneCharAllowanceRemaining?: bigint;
    simulationAccountOverrides?: ReadonlyMap<Address, { owner: Address; executable: boolean; lamports: bigint; data: Uint8Array }>;
    feeTreasuryPostLamports?: bigint;
    feeVaultPostLamports?: bigint;
    simulationCapture?: { addresses: Address[]; accounts: Array<{ owner: Address; executable: boolean; lamports: bigint; data: Uint8Array } | null> };
    creationBoundary?: Readonly<{
      source: "clmm-v1" | "pumpswap-v1" | "classic";
      token2022Side: "base" | "quote";
      token2022Owner?: Address;
      otherMintOwner?: Address;
      registryVersionMask?: number;
      malformedTlv?: true;
    }>;
  }> = {}) {
  const creator = addr(1); const asset = addr(3); const mimirProgramId = resume.nativeConverter?.programId ?? addr(10);
  const rootQuoteMint = resume.nativeConverter?.quoteMint ?? common.quoteMint;
  const tokenProgramId = resume.tokenProgramId ?? (resume.creationBoundary ? MIMIR_BETA_SPL_TOKEN_PROGRAM_ID : addr(14));
  const deployment = { cluster: "localnet" as const, mimirProgramId, agentRegistryProgramId: addr(11),
    mplCoreProgramId: MIMIR_BETA_MPL_CORE_PROGRAM_ID, systemProgramId: MIMIR_BETA_SYSTEM_PROGRAM_ID,
    physicalCollection: addr(12), collectionPointer: "c1:bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    tokenProgramId };
  const pdas = await deriveMimirBetaCanonicalPdas(mimirProgramId);
  const [tickerPda, tickerBump] = await deriveMimirBetaTickerPda(mimirProgramId, resume.ticker ?? common.ticker);
  const registry = new Uint8Array(128); registry.set(utf8("MIMIRREG")); putU16(registry, 10, 128);
  registry.set(addressBytes(addr(40)), 16); putU64(registry, 80, resume.supportedAdapterMask ?? 0xdfn);
  resume.supportedAdapterVersionMasks?.forEach((versions, adapter) => putU16(registry, 106 + adapter * 2, versions));
  if (resume.creationBoundary?.source === "clmm-v1") putU16(registry, 108, resume.creationBoundary.registryVersionMask ?? 3);
  if (resume.creationBoundary?.source === "pumpswap-v1") putU16(registry, 106 + 6 * 2, resume.creationBoundary.registryVersionMask ?? 3);
  putU16(registry, 88, 1); putU64(registry, 96, 1n); registry[105] = pdas.registry[1];
  const collateralMint = addr(42); const admin = new Uint8Array(192); admin.set(utf8("MIMIRCFG")); putU16(admin, 10, 192);
  putU16(admin, 8, 1); putU16(admin, 14, 8_000);
  admin[12] = 1; admin[13] = pdas.admin[1]; admin.set(addressBytes(addr(43)), 16); admin.set(addressBytes(collateralMint), 48);
  putU64(admin, 80, 5n); admin[88] = 1; putU64(admin, 96, 1_000n);
  admin.set(addressBytes(addr(44)), 120); putU64(admin, 152, 1n); admin.set(addressBytes(addr(45)), 160);
  const mint = () => { const data = new Uint8Array(82); putU64(data, 36, 1_000n); data[44] = 6; data[45] = 1; return data; };
  const token2022Mint = () => {
    if (resume.creationBoundary?.source === "pumpswap-v1") {
      const mintAddress = addr(resume.creationBoundary.token2022Side === "base" ? 6 : 2);
      const metadata = new Uint8Array(166); metadata.set(addressBytes(mintAddress), 32);
      const fields = ["Mimir metadata token", "MIMIR", "u".repeat(61)]; let offset = 64;
      for (const field of fields) { const bytes = new TextEncoder().encode(field); new DataView(metadata.buffer).setUint32(offset, bytes.length, true); offset += 4; metadata.set(bytes, offset); offset += bytes.length; }
      new DataView(metadata.buffer).setUint32(offset, 0, true);
      const data = new Uint8Array(404); putU64(data, 36, 1_000n); data[44] = 6; data[45] = 1; data[165] = 1;
      putU16(data, 166, 18); putU16(data, 168, 64); data.set(addressBytes(mintAddress), 202);
      putU16(data, 234, 19); putU16(data, 236, metadata.length); data.set(metadata, 238);
      return data;
    }
    const data = new Uint8Array(resume.creationBoundary?.malformedTlv ? 170 : 166);
    putU64(data, 36, 1_000n); data[44] = 6; data[45] = 1; data[165] = 1;
    if (resume.creationBoundary?.malformedTlv) { putU16(data, 166, 0xffff); putU16(data, 168, 0); }
    return data;
  };
  const vault = (mintAddress: Address, authority: Address) => {
    const data = new Uint8Array(165); data.set(addressBytes(mintAddress), 0); data.set(addressBytes(authority), 32);
    data[108] = 1; return data;
  };
  const collateralTokenAccount = resume.collateralAccountAddress ?? (resume.allowCollateralFunding
    ? await deriveAssociatedTokenAddress(creator, tokenProgramId, collateralMint) : addr(4));
  const collateral = new Uint8Array(resume.collateralDataLength ?? 165);
  collateral.set(addressBytes(resume.collateralMintOverride ?? collateralMint), 0);
  collateral.set(addressBytes(resume.collateralAuthorityOverride ?? creator), 32);
  if (collateral.length >= 72) putU64(collateral, 64, resume.collateralBalanceRaw ?? 10n);
  if (collateral.length > 108) collateral[108] = 1;
  const accounts = new Map<Address, { owner: Address; executable: boolean; lamports: bigint; data: Uint8Array }>();
  const add = (address: Address, owner: Address, data = new Uint8Array(), executable = false) =>
    accounts.set(address, { owner, executable, lamports: 10n, data });
  const finalizedClassicAssets = new Set<Address>();
  add(pdas.registry[0], mimirProgramId, registry); add(pdas.admin[0], mimirProgramId, admin);
  for (const program of [mimirProgramId, tokenProgramId, MIMIR_BETA_SYSTEM_PROGRAM_ID]) add(program, addr(46), new Uint8Array(), true);
  const boundary = resume.creationBoundary;
  const token2022Address = boundary?.token2022Side === "base" ? addr(6) : addr(2);
  const otherMintAddress = boundary?.token2022Side === "base" ? addr(2) : addr(6);
  add(creator, MIMIR_BETA_SYSTEM_PROGRAM_ID);
  if (resume.fundingPayerLamports !== undefined) accounts.get(creator)!.lamports = resume.fundingPayerLamports;
  if (boundary) {
    add(token2022Address, boundary.token2022Owner ?? MIMIR_BETA_TOKEN_2022_PROGRAM_ID, token2022Mint());
    add(otherMintAddress, boundary.otherMintOwner ?? tokenProgramId, mint());
  } else {
    add(addr(2), tokenProgramId, mint()); add(addr(6), tokenProgramId, mint());
    add(rootQuoteMint, tokenProgramId, mint());
  }
  add(deployment.physicalCollection, deployment.mplCoreProgramId, Uint8Array.from(coreCollectionData(deployment.agentRegistryProgramId)));
  add(addr(44), MIMIR_BETA_SYSTEM_PROGRAM_ID);
  add(collateralMint, tokenProgramId, mint());
  const [oneCharAllowance, oneCharAllowanceBump] = await deriveMimirOneCharAllowancePda(mimirProgramId, creator);
  if (resume.oneCharAllowanceRemaining !== undefined) {
    add(oneCharAllowance, mimirProgramId, oneCharAllowanceData(oneCharAllowanceBump, resume.oneCharAllowanceRemaining, 1n));
  }
  if (!resume.collateralAccountMissing) {
    add(collateralTokenAccount, resume.collateralTokenProgramOwner ?? tokenProgramId, collateral);
  }
  if (resume.fundingCollateralLamports !== undefined) {
    const collateralAccount = accounts.get(collateralTokenAccount);
    if (collateralAccount) collateralAccount.lamports = resume.fundingCollateralLamports;
  }
  for (let byte = 30; byte <= 39; byte += 1) add(addr(byte), addr(47), Uint8Array.of(byte));
  for (const candidate of [...(resume.pools ?? []), ...(resume.existingSentinelPools ?? []),
    ...(resume.compositeCreateClassicPool ? [resume.compositeCreateClassicPool] : []),
    ...(resume.compositeCreateClassicPools ?? [])] as readonly MimirBetaEligiblePool[]) {
    if (!accounts.has(candidate.baseMint)) add(candidate.baseMint, tokenProgramId, mint());
    if (!accounts.has(candidate.quoteMint)) add(candidate.quoteMint, tokenProgramId, mint());
    for (const binding of candidate.creation.staticAccounts) {
      if (!accounts.has(binding.address)) add(binding.address, candidate.programId,
        binding.role === "pool" && candidate.creation.adapterType === 3 ? new Uint8Array(904) : Uint8Array.of(1),
        binding.role === "market-program");
    }
    for (const dynamicAddress of candidate.readPlan.allAddresses ?? []) {
      if (!accounts.has(dynamicAddress)) add(dynamicAddress, candidate.programId, Uint8Array.of(1));
    }
    if (candidate.creation.adapterType !== 2 || !candidate.creation.observationState) continue;
    const observation = new Uint8Array(4_075);
    observation.set(Uint8Array.of(122, 174, 197, 53, 129, 9, 165, 132)); observation[8] = 1;
    observation.set(addressBytes(candidate.pool), 11);
    add(candidate.creation.observationState, candidate.programId, observation);
  }
  const postCreated = (address: Address) => {
    if (kind === "classic") {
      const sourceCount = resume.pools?.length ?? 1;
      const data = new Uint8Array(608 + sourceCount * 392); putU16(data, 8, 1); putU16(data, 10, 608); putU64(data, 408, 5n);
      data.fill(1, 464, 496); putU64(data, 512, 1n); putU64(data, 520, 1n); putU64(data, 528, 1n);
      putU64(data, 536, 1n); data.fill(42, 544, 576); data.fill(44, 576, 608);
      return { owner: mimirProgramId, executable: false, lamports: 1n, data };
    }
    const data = new Uint8Array(661); putU16(data, 8, 1); putU16(data, 10, 661); data.fill(3, 629, 661);
    return { owner: mimirProgramId, executable: false, lamports: 1n, data };
  };
  const pending = (value: unknown) => ({ send: async () => value });
  const resumedAccount = (address: Address) => {
    const value = postCreated(address); const data = value.data.slice(); data[data.length - 1] ^= 1;
    return { ...value, data };
  };
  const configuredReceipt = resume.configuredStateReceipt;
  const configuredTag81 = configuredReceipt?.reviewedStep.review.instructions.map((instruction) => fromBase64(instruction.dataBase64))
    .find((data) => data[0] === 81);
  const configuredCompositeData = configuredTag81 ? Uint8Array.from(configuredTag81.subarray(1, 662)) : null;
  const configuredFeedId = configuredCompositeData ? bytesAddress(configuredCompositeData.subarray(16, 48)) : null;
  const configuredFeed = configuredReceipt?.reviewedStep.review.feed ?? null;
  const configuredAuthority = configuredReceipt?.reviewedStep.review.authority ?? creator;
  const [configuredIdentityRoot, configuredRootBump] = await identityAdapter.deriveRootConfig();
  const [configuredIdentityRegistry, configuredRegistryBump] = await identityAdapter.deriveRegistryConfig();
  const [configuredIdentityAgent, configuredAgentBump] = await identityAdapter.deriveAgentAccount(asset);
  const configuredFeeVaultPda = configuredFeedId ? await deriveMimirBetaPda({ programId: mimirProgramId,
    seed: "feed_fee_vault", values: [addressBytes(configuredFeedId)] }) : null;
  const configuredLockPda = configuredFeedId ? await deriveMimirBetaPda({ programId: mimirProgramId,
    seed: "feed_collateral_lock", values: [addressBytes(configuredFeedId)] }) : null;
  const configuredSnapshotPda = configuredFeedId ? await deriveMimirBetaPda({ programId: mimirProgramId,
    seed: "composite_snapshot", values: [addressBytes(configuredFeedId)] }) : null;
  const configuredLockData = (slot = resume.slot ?? compositeSimulationSlot) => {
    const data = new Uint8Array(FEED_COLLATERAL_LOCK_HEADER_LEN);
    const offsets = FEED_COLLATERAL_LOCK_OFFSETS;
    data.set(FEED_COLLATERAL_LOCK_MAGIC, offsets.magic); putU16(data, offsets.version, VERSION_V0);
    putU16(data, offsets.headerLen, FEED_COLLATERAL_LOCK_HEADER_LEN);
    data.set(addressBytes(configuredFeedId!), offsets.feedId); data.set(addressBytes(configuredAuthority), offsets.creator);
    data.set(addressBytes(collateralMint), offsets.collateralMint); putU64(data, offsets.lockedAmountRaw, 1n);
    putU64(data, offsets.createdSlot, slot);
    new DataView(data.buffer).setBigInt64(offsets.createdUnixTs, compositeSimulationUnixTs, true);
    putU64(data, offsets.adminConfigRevisionAtCreation,
      new DataView(configuredCompositeData!.buffer, configuredCompositeData!.byteOffset, configuredCompositeData!.byteLength)
        .getBigUint64(176, true));
    data[offsets.status] = FeedCollateralLockStatus.Locked; data[offsets.bump] = configuredLockPda![1];
    if (resume.configuredLockBindingMismatch) data[offsets.feedId]! ^= 1;
    return data;
  };
  const configuredAccountData = (address: Address) => {
    if (!resume.configuredRecovery || !configuredReceipt || !configuredCompositeData || !configuredFeedId) return null;
    const account = (owner: Address, data: Uint8Array, lamports = 1n) => ({ owner, executable: false, lamports, data });
    if (resume.configuredRootPresent && configuredSnapshotPda && address === configuredSnapshotPda[0]) {
      const index = resume.simulationCapture?.addresses.indexOf(address) ?? -1;
      const simulated = index < 0 ? null : resume.simulationCapture!.accounts[index] ?? null;
      return account(mimirProgramId, simulated?.data ?? compositeSnapshot(mimirProgramId, configuredFeed!, configuredCompositeData,
        resume.slot ?? compositeSimulationSlot, resume.componentCount ?? 5), simulated?.lamports ?? 720n);
    }
    if (address === configuredIdentityRoot) {
      const data = new Uint8Array(73); data.set([42,216,8,82,19,209,223,246]);
      data.set(addressBytes(deployment.physicalCollection), 8); data.set(addressBytes(addr(40)), 40); data[72] = configuredRootBump;
      return account(deployment.agentRegistryProgramId, data);
    }
    if (address === configuredIdentityRegistry) {
      const data = new Uint8Array(73); data.set([23,118,10,246,173,231,243,156]);
      data.set(addressBytes(deployment.physicalCollection), 8); data.set(addressBytes(addr(40)), 40); data[72] = configuredRegistryBump;
      return account(deployment.agentRegistryProgramId, data);
    }
    if (address === configuredIdentityAgent) {
      const data = new Uint8Array(748); data.set([241,119,69,140,233,9,112,50]);
      data.set(addressBytes(deployment.physicalCollection), 8); data.set(addressBytes(configuredAuthority), 40);
      data.set(addressBytes(configuredAuthority), 72); data.set(addressBytes(asset), 104); data[136] = configuredAgentBump;
      let cursor = 138; data[cursor++] = 0; cursor += 120; data[cursor++] = 0; data[cursor++] = 0; data[cursor++] = 1;
      const writeString = (value: string) => { const bytes = utf8(value); putU32(data, cursor, bytes.length); cursor += 4;
        data.set(bytes, cursor); cursor += bytes.length; };
      writeString(common.identity.agentUri); writeString("Mimir Feed"); writeString(deployment.collectionPointer);
      return account(deployment.agentRegistryProgramId, data);
    }
    if (address === displayNameMetadata) return account(deployment.agentRegistryProgramId, displayNameData());
    if (address === asset) return account(deployment.mplCoreProgramId,
      Uint8Array.from(coreAssetData(resume.configuredCoreOwnerOverride ?? configuredAuthority, deployment.physicalCollection)));
    if (address === deployment.physicalCollection) {
      const sized = (value: Uint8Array) => { const length = new Uint8Array(4); putU32(length, 0, value.length); return concatBytes(length, value); };
      return account(deployment.mplCoreProgramId, concatBytes(Uint8Array.of(5), addressBytes(configuredIdentityRegistry),
        sized(utf8("Collection")), sized(utf8("https://example.com/collection")), new Uint8Array(8)));
    }
    if (address === configuredFeed) return account(mimirProgramId, configuredCompositeData);
    if (configuredFeeVaultPda && address === configuredFeeVaultPda[0]) {
      const data = new Uint8Array(160); data.set(utf8("MIMIRFEE")); putU16(data, 8, 1); putU16(data, 10, 160);
      data.set(addressBytes(configuredFeedId), 16); data.set(addressBytes(configuredFeed!), 48);
      data.set(addressBytes(asset), 80); data[152] = 1; data[153] = configuredFeeVaultPda[1];
      return account(mimirProgramId, data, 801n);
    }
    if (address === tickerPda) {
      const data = new Uint8Array(43); data.set(utf8("MIMIRTIK")); data[8] = 1; data[9] = 2;
      data[10] = tickerBump; data.set(addressBytes(configuredFeed!), 11); return account(mimirProgramId, data);
    }
    if (configuredLockPda && address === configuredLockPda[0]) {
      return account(mimirProgramId, configuredLockData());
    }
    return null;
  };
  const configuredAccount = (address: Address) => {
    const configured = configuredAccountData(address);
    if (configured) return configured;
    if (resume.configuredRecovery) return null;
    const write = configuredReceipt?.reviewedStep.step.expectedWrites.find((candidate) => candidate.address === address &&
      candidate.proof.kind === "account");
    if (!write || write.proof.kind !== "account" || !write.proof.after.exists) return null;
    const tag81 = configuredTag81;
    const data = write.description.includes("composite feed") && tag81 ? Uint8Array.from(tag81.subarray(1, 662))
      : write.description.includes("collateral lock") ? collateralLockData(compositeSimulationSlot, compositeSimulationUnixTs)
      : new Uint8Array(write.proof.after.data.length);
    return { owner: write.proof.after.owner, executable: false, lamports: write.proof.after.lamports, data };
  };
  const preparingActivation = kind === "classic" && (resume.receipts?.length === 2 || !!resume.confirmedRpc && !!resume.activationProposalPost);
  const [displayNameMetadata, displayNameBump] = await identityAdapter.deriveDisplayNameMetadata(asset);
  const displayNameData = () => {
    const data = new Uint8Array(332); data.set([48,145,12,249,176,141,197,187]); data.set(addressBytes(asset), 8);
    data[40] = 1; data[41] = displayNameBump; let cursor = 42;
    for (const value of ["mimir.display_name.v1", resume.displayName ?? common.displayName]) {
      const bytes = utf8(value); new DataView(data.buffer).setUint32(cursor, bytes.length, true); cursor += 4; data.set(bytes, cursor); cursor += bytes.length;
    }
    return data;
  };
  const tickerClaimData = (config: Address) => {
    const data = new Uint8Array(43); data.set(utf8("MIMIRTIK")); data[8] = 1; data[9] = 2; data[10] = tickerBump;
    data.set(addressBytes(config), 11); return data;
  };
  if (resume.assignedTickerConfig) add(tickerPda, mimirProgramId, tickerClaimData(resume.assignedTickerConfig));
  const activationPost = (address: Address, index: number, compositeConfig: Uint8Array | null, addresses: readonly Address[]) => {
    if (index === 0) {
      const data = new Uint8Array(748);
      data.set(Uint8Array.of(241, 119, 69, 140, 233, 9, 112, 50));
      data.set(addressBytes(deployment.physicalCollection), 8); data.set(addressBytes(creator), 40);
      data.set(addressBytes(addresses[1]!), 104);
      return { owner: deployment.agentRegistryProgramId, executable: false, lamports: 1n, data };
    }
    if (index === 1 || index === 2) {
      return { owner: deployment.mplCoreProgramId, executable: false, lamports: index === 1 ? 1n : 10n,
        data: index === 2 ? Uint8Array.from(coreCollectionData(deployment.agentRegistryProgramId)) : new Uint8Array(33).fill(index + 1) };
    }
    if (kind === "composite") {
      if (address === addr(44)) return { owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false,
        lamports: resume.feeTreasuryPostLamports ?? 210n, data: new Uint8Array() };
      if (index === 3) {
        return { owner: deployment.agentRegistryProgramId, executable: false, lamports: 1n, data: displayNameData() };
      }
      if (index === 4) {
        assert.ok(compositeConfig);
        return { owner: mimirProgramId, executable: false, lamports: 1n, data: compositeConfig };
      }
      if (index === 5 || index === 6) {
        return { owner: mimirProgramId, executable: false, lamports: index === 5 ? 801n : 1n,
          data: index === 6 ? collateralLockData(resume.slot ?? compositeSimulationSlot, compositeSimulationUnixTs) : new Uint8Array(160) };
      }
      if (index === 7 || index === 8) {
        if (address === tickerPda) return { owner: mimirProgramId, executable: false, lamports: 1n, data: tickerClaimData(addresses[4]!) };
      }
      if (index === 7) return { owner: mimirProgramId, executable: false, lamports: 720n,
        data: compositeSnapshot(mimirProgramId, addresses[4]!, compositeConfig!, resume.slot ?? compositeSimulationSlot, resume.componentCount ?? 5) };
      if (index === 8) return { owner: mimirProgramId, executable: false, lamports: 1n, data: tickerClaimData(addresses[4]!) };
      if (address === addr(45)) return { ...accounts.get(address)!, lamports: 210n };
      return accounts.get(address) ?? null;
    }
    if (index === 3) return resume.activationProposalPost!.account;
    const lengths = [357, 320, 640, 512, 160, 384, 544] as const;
    const length = lengths[index - 4];
    if (length !== undefined) {
      const data = new Uint8Array(length);
      if (index === 4) {
        data.set(utf8("MIMIRCFG")); putU16(data, 8, 1); putU16(data, 10, 357);
        new DataView(data.buffer).setUint32(12, 1, true); data.set([5, 77, 73, 77, 73, 82, 0], 313);
        data.set(addressBytes(address), 16); data.set(addressBytes(addr(6)), 48);
        data.set(addressBytes(addr(2)), 80); data.set(addressBytes(addresses[1]!), 325);
      }
      if (index === 7) data.set(atomicSnapshot(resume.slot ?? compositeSimulationSlot, resume.pools?.length ?? 1));
      if (index === 8) data.set(collateralLockData());
      if (index === 10) data.set(atomicRing(resume.slot ?? compositeSimulationSlot));
      return { owner: mimirProgramId, executable: false, lamports: 1n, data };
    }
    return accounts.get(address) ?? null;
  };
  let classicExecution90: { address: Address; data: Uint8Array } | null = null;
  const fusedClassicPost = (address: Address, index: number, addresses: readonly Address[]) => {
    if (classicExecution90?.address === address) return { owner: mimirProgramId, executable: false, lamports: 1n, data: classicExecution90.data };
    if (resume.oneCharAllowanceRemaining !== undefined) {
      if (address === oneCharAllowance) return { owner: mimirProgramId, executable: false, lamports: 1n,
        data: oneCharAllowanceData(oneCharAllowanceBump, resume.oneCharAllowanceRemaining - 1n, 2n) };
      if (index > 3) index += 1;
    }
    if (index < 3) return activationPost(address, index, null, addresses);
    if (index === 3 || index === 4) {
      const account = accounts.get(address); if (!account) return null;
      const data = account.data.slice(); putU64(data, index === 3 ? 64 : 36, index === 3 ? 9n : 999n);
      return { ...account, data };
    }
    const lengths = [357, 320, 640, 512, 160, 43] as const;
    const length = index < 11 ? lengths[index - 5] : index - 11 < (resume.pools?.length ?? 1) ? 384 : undefined;
    if (length !== undefined) {
      const data = new Uint8Array(length);
      if (index === 5) {
        data.set(utf8("MIMIRCFG")); putU16(data, 8, 1); putU16(data, 10, 357);
        new DataView(data.buffer).setUint32(12, 1, true); data.set([5, 77, 73, 77, 73, 82, 0], 313);
        data.set(addressBytes(address), 16); data.set(addressBytes(addr(6)), 48);
        data.set(addressBytes(addr(2)), 80); data.set(addressBytes(asset), 325);
      }
      if (index === 9) data.set(collateralLockData(resume.slot ?? compositeSimulationSlot, compositeSimulationUnixTs));
      if (index === 10) data.set(tickerClaimData(addresses[5]!));
      if (index === 8) data.set(atomicSnapshot(resume.slot ?? compositeSimulationSlot, resume.pools?.length ?? 1));
      if (index === 8 && resume.recipes?.[0] === "native-bounded") {
        data[OFFSETS.snapshotSource] = 5; putU64(data, OFFSETS.snapshotRevision, 1n);
        for (const offset of [OFFSETS.priceX64, OFFSETS.priceLowerX64, OFFSETS.priceUpperX64]) putU128(data, offset, 1n);
      }
      return { owner: mimirProgramId, executable: false, lamports: 1n, data };
    }
    return accounts.get(address) ?? null;
  };
  for (const extra of resume.nativeAccounts ?? []) add(extra.address, extra.owner, extra.data);
  {
    const clock = new Uint8Array(40); putU64(clock, 0, resume.slot ?? 5n); putU64(clock, 32, resume.clockUnix ?? 1000n);
    add("SysvarC1ock11111111111111111111111111111111" as Address, "Sysvar1111111111111111111111111111111111111" as Address, clock);
  }
  const fundingCostRpc = resume.fundingCostRpc;
  const rpc = {
    getSignaturesForAddress: (address: Address) => pending(resume.dexActivity === "none" ? [] :
      [{ signature: `dex:${address}`, slot: 1, err: resume.dexActivity === "failed" ? { InstructionError: [0, { Custom: 1 }] } : null }]),
    getTransaction: (signature: string) => {
      const pool = signature.slice(4) as Address;
      return pending({ slot: 1, meta: { err: null, logMessages: [`Program ${accounts.get(pool)?.owner} invoke [1]`, `Program ${accounts.get(pool)?.owner} success`],
        loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [] },
        transaction: { message: { accountKeys: [creator, pool, accounts.get(pool)?.owner], instructions: [{ programIdIndex: 2, accounts: [1], data: "" }],
          header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: resume.dexActivity === "readonly" ? 2 : 1 } } } });
    },
    getMultipleAccounts: (addresses: readonly Address[], config: { commitment: string; minContextSlot?: bigint }) => (rpcEvents.push({ method: "getMultipleAccounts", commitment: config.commitment }),
      addresses.length === 2 && addresses[0] === pdas.registry[0] && resume.rpcContextFloors?.push(config.minContextSlot ?? 0n),
      pending({ context: { slot: Number(resume.rpcContextFloors && (config.minContextSlot ?? 0n) > (resume.slot ?? 5n)
        ? config.minContextSlot : resume.slot ?? 5n) },
      value: addresses.map((address) => rpcValue(resume.collateralAccountMissing && address === collateralTokenAccount ? null :
        (resume.configuredRecovery ? configuredAccount(address) ?? accounts.get(address) : accounts.get(address) ?? configuredAccount(address)) ??
        (address === resume.occupiedProposalAddress ? { owner: mimirProgramId, executable: false, lamports: 1n, data: new Uint8Array(1000) } :
        (preparingActivation && address === resume.activationProposalPost?.address ? resume.confirmedRpc ? resume.activationProposalPost.account : resumedAccount(address) :
          kind === "classic" && resume.receipts?.length && !preparingActivation && address !== tickerPda ? resumedAccount(address) : null)))) })),
    getAccountInfo: (address: Address) => address === MIMIR_RENT_SYSVAR ? (resume.fundingCostCapture && (resume.fundingCostCapture.rentReads += 1),
      pending({ context: { slot: Number(resume.slot ?? 5n) }, value: rpcValue({ owner: addr(0), executable: false, lamports: 1n, data: testRentSysvar }) }))
      : pending({ context: { slot: Number(resume.slot ?? 5n) },
      value: rpcValue(resume.collateralAccountMissing && address === collateralTokenAccount ? null :
        (resume.configuredRecovery ? configuredAccount(address) ?? accounts.get(address) : accounts.get(address) ?? configuredAccount(address)) ??
        (kind === "classic" && resume.receipts?.length && address !== tickerPda ? resumedAccount(address) : null)) }),
    getLatestBlockhash: (config: { commitment: string }) => {
      rpcEvents.push({ method: "getLatestBlockhash", commitment: config.commitment });
      if (resume.preparationCalls) resume.preparationCalls.blockhash += 1;
      if (resume.fundingCostCapture) resume.fundingCostCapture.blockhashCalls = (resume.fundingCostCapture.blockhashCalls ?? 0) + 1;
      return pending({ value: { blockhash: resume.retryBlockhash ?? "11111111111111111111111111111111", lastValidBlockHeight: 99 } });
    },
    simulateTransaction: (wire: string, config: { commitment: string; accounts: { addresses: readonly Address[] } }) => {
      rpcEvents.push({ method: "simulateTransaction", commitment: config.commitment });
      if ((!config.accounts || config.accounts.addresses.length === 0) && resume.pointProbeWire) resume.pointProbeWire.value = wire;
      if (!config.accounts || config.accounts.addresses.length === 0) return pending({ context: { slot: Number(resume.pointProbeSlot ?? resume.slot ?? 5n) },
        value: { err: resume.pointProbe === "ok" ? null : resume.pointProbe === "absent-proposal" ? { InstructionError: [2, { Custom: 2 }] }
          : { InstructionError: [6, resume.pointProbe === "structural" ? { Custom: 54 } : "ComputationalBudgetExceeded"] },
          logs: resume.pointProbe === "ok" ? [] : resume.pointProbe === "absent-proposal"
            ? [`Program ${mimirProgramId} invoke [1]`, `Program ${mimirProgramId} consumed 640 of 1340934 compute units`, `Program ${mimirProgramId} failed: custom program error: 0x2`]
            : resume.pointProbe === "structural"
            ? [`Program ${mimirProgramId} invoke [1]`, `Program ${mimirProgramId} failed: custom program error: 0x36`]
            : [`Program ${mimirProgramId} invoke [1]`, `Program ${mimirProgramId} failed: exceeded CUs meter at BPF instruction`], unitsConsumed: resume.pointProbeUnits === undefined ? 530_317 : resume.pointProbeUnits, accounts: [] } });
      if (config.commitment !== "confirmed") return pending({ context: { slot: Number(resume.slot ?? 5n) }, value: { err: "BlockhashNotFound", logs: [], accounts: null } });
      if (resume.preparationCalls) resume.preparationCalls.simulation += 1;
      const decoded = kind === "composite" ? decodeMimirInstructions(wire, mimirProgramId) : [];
      const classicTags = kind === "classic" ? decodeMimirInstructions(wire, mimirProgramId).map(({ data }) => data[0] === 78 ? 78_00 + data[1]! : data[0]) : [];
      const begin90 = kind === "classic" ? decodeMimirInstructions(wire, mimirProgramId).find(({ data }) => data[0] === 90 && data[1] === 0) : undefined;
      const seal90 = kind === "classic" ? decodeMimirInstructions(wire, mimirProgramId).find(({ data }) => data[0] === 90 && data[1] === 2) : undefined;
      classicExecution90 = begin90 && seal90 ? { address: begin90.accounts[1]!, data: sealClassicExecution(classicExecutionImageFromSeal(Uint8Array.from(seal90.data), begin90.accounts[2]!), mimirProgramId, begin90.accounts[1]!) } : null;
      const classicFused = classicTags.includes(80) && classicTags.some((tag) => tag > 78_01 && tag < 79_00);
      const nativeProofSimulation = !!resume.nativeConverter && decoded.some(({ data }) => data[0] === 60) &&
        !decoded.some(({ data }) => data[0] === 65 || data[0] === 81);
      if (resume.simulationWire && !nativeProofSimulation) {
        resume.simulationWire.value = wire; throw new Error("captured activation simulation");
      }
      const tag81 = decoded.find(({ data }) => data[0] === 81);
      const tag87 = decoded.find(({ data }) => data[0] === 87);
      const tag87SampleOnly = !!tag87 && tag87.data.subarray(41, 49).every((byte, i) => byte === tag87.data[49 + i]);
      const begin88 = decoded.find(({ data }) => data[0] === 88 && data[1] === 0);
      const configuredTag81 = tag81 ?? [ ...(resume.configuredStateReceipt ? [resume.configuredStateReceipt] : []), ...(resume.receipts ?? []) ]
        .flatMap((receipt) => receipt.reviewedStep.review.instructions)
        .map((instruction) => ({ data: fromBase64(instruction.dataBase64) })).find(({ data }) => data[0] === 81);
      const compositeConfig = resume.successfulCompositeActivation && configuredTag81
        ? Uint8Array.from(configuredTag81.data.subarray(1, 662))
        : null;
      const roleIndex = (address: Address) => {
        if (!tag81) return -1;
        const sourceCount = (resume.componentCount ?? 5) + (solConversionSourceConfig ? 1 : 0);
        const roles = new Map<Address, number>([
          [displayNameMetadata, 3],
          [tag81.accounts[3]!, 4], [tag81.accounts[5]!, 5], [tag81.accounts[7 + sourceCount]!, 6],
          [tag81.accounts[8 + sourceCount]!, 9], [tag81.accounts[9 + sourceCount]!, 10],
          [tag81.accounts[11 + sourceCount]!, 8], [tag81.accounts[12 + sourceCount]!, 0],
          [tag81.accounts[14 + sourceCount]!, 2], [tag81.accounts[15 + sourceCount]!, 1],
        ]);
        return roles.get(address) ?? -1;
      };
      const compositePost = (address: Address, index: number) => {
        const nativePost = decoded.some(({ data }) => data[0] === 60) ? resume.nativeConverter?.after.get(address) : undefined;
        if (nativePost) return nativePost;
        const refresh = decoded.find(({ data, accounts: instructionAccounts }) => data[0] === 77 && instructionAccounts[1] === address);
        if (refresh) {
          const pre = accounts.get(address)!; const slot = resume.slot ?? compositeSimulationSlot;
          const data = pre.data.length === 784 ? extendedDammRing(atomicRing(slot), slot) : atomicRing(slot);
          data.set(pre.data.subarray(RING_OFFSETS.feedId, RING_OFFSETS.feedId + 32), RING_OFFSETS.feedId);
          data[RING_OFFSETS.sourceIndex] = pre.data[RING_OFFSETS.sourceIndex]!;
          data[RING_OFFSETS.adapterType] = pre.data[RING_OFFSETS.adapterType]!;
          data.set(pre.data.subarray(RING_OFFSETS.sourceConfigRevision, RING_OFFSETS.lastObservationHash), RING_OFFSETS.sourceConfigRevision);
          data.set(pre.data.subarray(RING_OFFSETS.sourceConfig, RING_OFFSETS.bump + 1), RING_OFFSETS.sourceConfig);
          putU16(data, RING_OFFSETS.sourceWeightBps, new DataView(pre.data.buffer, pre.data.byteOffset).getUint16(RING_OFFSETS.sourceWeightBps, true));
          putU16(data, RING_OFFSETS.routeCorrelationGroup, new DataView(pre.data.buffer, pre.data.byteOffset).getUint16(RING_OFFSETS.routeCorrelationGroup, true));
          return { ...pre, data };
        }
        const snapshot = decoded.find(({ data, accounts: instructionAccounts }) => data[0] === 82 && instructionAccounts[0] === address);
        if (snapshot) {
          const pre = accounts.get(address)!; const count = snapshot.data[51]!;
          const data = Uint8Array.from(atomicSnapshot(resume.slot ?? compositeSimulationSlot, count,
            bytesAddress(snapshot.data.subarray(1, 33))));
          data.set(addressBytes(snapshot.accounts[1]!), OFFSETS.feedConfig); data.set(pre.data.subarray(80, 96), 80);
          putU64(data, OFFSETS.snapshotRevision, new DataView(snapshot.data.buffer, snapshot.data.byteOffset).getBigUint64(43, true));
          return { ...pre, data };
        }
        if (begin88?.accounts[1] === address) {
          const seal = decoded.find(({ data }) => data[0] === 88 && data[1] === 2)!;
          return { owner: mimirProgramId, executable: false, lamports: 1n, data: compositeExecutionImageFromSeal(Uint8Array.from(seal.data), begin88.accounts[2]!,
            seal.accounts, (key) => accounts.get(key)!.data) };
        }
        if (tag87?.accounts[1] === address) {
          if (tag87SampleOnly) return accounts.get(address) ?? null;
          const configAddress = tag87.accounts[2]!;
          return { owner: mimirProgramId, executable: false, lamports: 720n,
            data: compositeSnapshot(mimirProgramId, configAddress, compositeConfig!, resume.slot ?? compositeSimulationSlot,
              resume.componentCount ?? 5) };
        }
        if (!tag81) {
          const prior = configuredAccount(address);
          const description = configuredReceipt?.reviewedStep.step.expectedWrites.find((write) => write.address === address)?.description;
          if (prior && description?.includes("fee vault")) return { ...prior,
            lamports: resume.feeVaultPostLamports ?? prior.lamports + 800n };
          if (address === addr(44)) return { ...accounts.get(address)!, lamports: resume.feeTreasuryPostLamports ?? 210n };
          return accounts.get(address) ?? prior ?? null;
        }
        const sourceCount = (resume.componentCount ?? 5) + (solConversionSourceConfig ? 1 : 0);
        const componentCount = resume.componentCount ?? 5;
        const treasuryIndex = 16 + sourceCount;
        const ownerCredit = Array.from({ length: componentCount }, (_, component) =>
          tag81!.accounts[treasuryIndex + 1 + component * 3 + 2] === address ? 800_000n : 0n)
          .reduce<bigint>((sum, value) => sum + value, 0n);
        const refreshCredit = decoded.some(({ data }) => data[0] === 87) && !tag87SampleOnly
          ? resume.feeTreasuryPostLamports === undefined ? 200n :
            resume.feeTreasuryPostLamports - (accounts.get(address)?.lamports ?? 10n) : 0n;
        const treasuryCredit = tag81.accounts[treasuryIndex] === address
          ? 700_000n * BigInt(componentCount) + 1_000_000n +
            refreshCredit : 0n;
        if (ownerCredit || treasuryCredit) {
          const prior = accounts.get(address);
          if (!prior) return { owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false,
            lamports: ownerCredit + treasuryCredit, data: new Uint8Array() };
          return { ...prior, lamports: prior.lamports + ownerCredit + treasuryCredit };
        }
        const role = roleIndex(address);
        if (role >= 0) {
          const roleAddresses = [...config.accounts.addresses]; roleAddresses[4] = tag81!.accounts[3]!;
          return activationPost(address, role, compositeConfig, roleAddresses);
        }
        return activationPost(address, index, compositeConfig, config.accounts.addresses);
      };
      const activation = decodeMimirInstructions(wire, mimirProgramId).find(({ accounts: keys }) => keys.length > 12 && keys[0] === keys[2]);
      const twapPlaceholder = activation?.accounts[5];
      const legacyOrder = (list: readonly Address[]) => {
        if (!twapPlaceholder || !list.includes(twapPlaceholder)) return list;
        const rest = list.filter((key) => key !== twapPlaceholder); const plan = rest.indexOf(activation!.accounts[4]!);
        return plan < 0 ? list : [...rest.slice(0, plan + 1), twapPlaceholder, ...rest.slice(plan + 1)];
      };
      const simulatedAccounts = config.accounts.addresses.map((address) => {
        if (address === twapPlaceholder) return accounts.get(address) ?? null;
        const legacyAddresses = legacyOrder(config.accounts.addresses); const index = legacyAddresses.indexOf(address);
        const nativePost = nativeProofSimulation ? resume.nativeConverter?.after.get(address) : undefined;
        if (resume.confirmedRpc && resume.activationProposalPost && kind === "classic") {
          if (address === resume.activationProposalPost.address) return null;
          const remaining = legacyOrder(config.accounts.addresses.filter((key) => key !== resume.activationProposalPost!.address));
          return fusedClassicPost(address, remaining.indexOf(address), remaining);
        }
        return resume.simulationAccountOverrides?.get(address) ?? nativePost ??
            (finalizedClassicAssets.has(address) ? accounts.get(address)! :
              ((kind === "classic" && !resume.receipts?.length && classicFused) ||
                (kind === "composite" && !!(resume.compositeCreateClassicPool || resume.compositeCreateClassicPools) && (!tag81 || index < 12) &&
                  decoded.some(({ data }) => data[0] === 80))
                ? fusedClassicPost(address, index, legacyAddresses) :
              resume.successfulCompositeActivation ? compositePost(address, index) :
              resume.activationProposalPost ? activationPost(address, index, compositeConfig, legacyAddresses) : accounts.get(address) ??
              (index === 0 ? postCreated(address) : null)));
      });
      if (resume.simulationCapture) {
        resume.simulationCapture.addresses = [...config.accounts.addresses];
        resume.simulationCapture.accounts = simulatedAccounts;
      }
      if (resume.simulationErr) return pending({ context: { slot: Number(resume.slot ?? 5n) }, value: { err: resume.simulationErr,
        logs: resume.simulationLogs ?? [`Program ${mimirProgramId} invoke [1]`, `Program ${mimirProgramId} failed: custom program error: 0x${
          ((resume.simulationErr as { InstructionError: [number, { Custom: number }] }).InstructionError[1].Custom).toString(16)}`], accounts: null } });
      return pending({ context: { slot: Number(resume.slot ?? 5n) }, value: { err: null, logs: [], unitsConsumed: resume.simulationUnits ?? 1, returnData: null,
        accounts: simulatedAccounts.map(rpcValue) } });
    },
    ...(fundingCostRpc?.missingFee ? {} : { getFeeForMessage: (message: string, config: { commitment: string }) => {
      rpcEvents.push({ method: "getFeeForMessage", commitment: config.commitment });
      if (config.commitment !== "confirmed") return pending({ context: { slot: Number(resume.slot ?? 5n) }, value: null });
      const capture = resume.fundingCostCapture;
      const index = capture?.feeMessages.length ?? 0;
      capture?.feeMessages.push(message);
      const value = fundingCostRpc?.feeValues && index < fundingCostRpc.feeValues.length
        ? fundingCostRpc.feeValues[index] : BigInt(12_345 + index * 1_007);
      return pending({ context: { slot: Number(resume.slot ?? 5n) },
        value });
    } }),
  };
  const servedRead = rpc.getMultipleAccounts;
  rpc.getMultipleAccounts = (addresses, config) => {
    const request = servedRead(addresses, config);
    return { send: async () => {
      const response = await request.send() as { context: { slot: number }; value: unknown[] };
      addresses.forEach((key, index) => servedAccounts.set(key, response.value[index]));
      return response;
    } };
  };
  const discoveryPools: MimirBetaEligiblePool[] = [...(resume.existingSentinelPools ?? [])];
  let discoveryInFlight = 0; let revalidationInFlight = 0;
  const dependencies = { deployment, rpc, identity: identityAdapter, ...(resume.abi1Capability ? { abi1Capability: resume.abi1Capability } : {}),
    discovery: {
      searchSpotPools: async ({ baseMint, quoteMint, query, maxPools }: { baseMint: Address; quoteMint: Address; query: string; maxPools: number }) => {
        discoveryInFlight += 1;
        resume.discoveryQueries?.push(query);
        if (resume.discoveryCalls) Object.assign(resume.discoveryCalls, { query, maxPools,
          maxInFlight: Math.max(resume.discoveryCalls.maxInFlight, discoveryInFlight) });
        try {
          await (resume.discoveryDelayMs ? new Promise((resolve) => setTimeout(resolve, resume.discoveryDelayMs!(query))) : Promise.resolve());
          if (query && resume.exactDiscoveryError) throw resume.exactDiscoveryError;
          if (!query && resume.blankDiscoveryWinner) return { pools: [resume.blankDiscoveryWinner], recommendedPools: [resume.blankDiscoveryWinner] };
          const pools = (resume.missingExistingDiscovery ? [] : discoveryPools.filter((pool) =>
            pool.baseMint === baseMint && pool.quoteMint === quoteMint && (!query || pool.pool === query)))
            .map((pool) => query && resume.exactDiscoverySubstitute ? resume.exactDiscoverySubstitute(pool) : pool).slice(0, maxPools);
          return { pools, recommendedPools: pools };
        } finally { discoveryInFlight -= 1; }
      },
      revalidateSelectedPools: async ({ pools, minContextSlot }: { pools: readonly Record<string, unknown>[]; minContextSlot: bigint }) => {
        if (resume.enforceEvidenceWindow && pools.some((pool) => minContextSlot > (pool.validThroughSlot as bigint))) {
          throw new MimirBetaError("POOL_STALE", "selected pool evidence expired");
        }
        if (resume.revalidationCalls) {
          resume.revalidationCalls.count += 1;
          resume.revalidationCalls.baseMints?.push(pools[0]!.baseMint as Address);
          resume.revalidationCalls.maxInFlight = Math.max(resume.revalidationCalls.maxInFlight ?? 0, ++revalidationInFlight);
          await Promise.resolve(); revalidationInFlight -= 1;
        }
        const slot = resume.revalidationSlot?.(pools[0]!.baseMint as Address) ?? resume.freshEvidenceSlot ?? resume.slot ?? 5n;
        resume.revalidationCalls?.slots?.push(slot);
        return { slot: resume.revalidationSlot ? slot : resume.slot ?? 5n, pools, freshPools: pools.map((pool) => ({ ...pool,
          minLiquidityNative: (pool.minLiquidityNative as bigint) + (resume.freshFloorDrift ? slot : 1n),
          ...(resume.freshFloorDrift ? { minDepthTo50BpsNative: (pool.minDepthTo50BpsNative as bigint) - slot } : {}),
          evidenceHash: slot.toString(16).padStart(64, "0"), observedSlot: slot, validThroughSlot: slot + 5n,
          readPlan: { ...(pool.readPlan as object), planHash: (slot + 1n).toString(16).padStart(64, "0"),
            context: { observedSlot: slot, observedUnixTimestamp: 1_789_158_000n + slot } } })) };
      } } };
  const confirmedRpc = resume.confirmedRpc && { ...resume.confirmedRpc,
    getAccountInfo: (a: Address) => rpc.getAccountInfo(a),
    getMultipleAccounts: (addresses: readonly Address[], config: object) => addresses.every((a) => (resume.receipts ?? []).some((receipt) =>
      receipt.reviewedStep.step.expectedWrites.some((write) => write.address === a)))
      ? resume.confirmedRpc!.getMultipleAccounts(addresses, config) : rpc.getMultipleAccounts(addresses, config as never),
  };
  const planning = resume.finalizedOnlyPlanning ? { ...dependencies, rpc: { ...dependencies.rpc,
    getAccountInfo() { throw new Error("finalized-only planning read"); },
    getMultipleAccounts() { throw new Error("finalized-only planning read"); },
  } } : dependencies;
  if (kind === "classic") {
    const clmmV1 = boundary?.source === "clmm-v1";
    const pumpswapV1 = boundary?.source === "pumpswap-v1";
    const pool = { eligibility: "eligible", family: clmmV1 ? "raydium-clmm" : pumpswapV1 ? "pumpswap" : "meteora-damm-v2", programId: addr(30), pool: addr(31),
      descriptorId: "fixture", descriptorHash: "a".repeat(64), canonicalMint0: addr(6), canonicalMint1: addr(2),
      canonicalPairKey: "fixture", direction: "quote-per-base", baseMint: addr(6), quoteMint: addr(2), baseVault: addr(32),
      quoteVault: addr(33), minLiquidityNative: 1n, minDepthTo50BpsNative: 1n, observedSlot: 5n, validThroughSlot: 10n,
      adapterVersion: clmmV1 || pumpswapV1 ? 1 : 0, token2022Mint: clmmV1 || pumpswapV1 ? token2022Address : null,
      token2022PolicyHash: clmmV1 ? "c".repeat(64) : null,
      evidenceHash: "b".repeat(64), creation: { adapterType: clmmV1 ? 1 : pumpswapV1 ? 6 : 7, adapterVersion: clmmV1 || pumpswapV1 ? 1 : 0,
        bindingVariant: clmmV1 ? "routeable" : "direct", tokenProgramId: clmmV1 || pumpswapV1 ? MIMIR_BETA_TOKEN_2022_PROGRAM_ID : tokenProgramId,
        token2022Mint: clmmV1 || pumpswapV1 ? token2022Address : null, vaultAuthority: addr(34), staticAccounts: pumpswapV1 ? [
          { role: "base-mint" as const, address: addr(6) }, { role: "quote-mint" as const, address: addr(2) },
          { role: "base-vault" as const, address: addr(32) }, { role: "quote-vault" as const, address: addr(33) },
          { role: "pool" as const, address: addr(31) }, { role: "global-config" as const, address: addr(35) },
          { role: "fee-config" as const, address: addr(36) }] : [
          { role: "base-vault" as const, address: addr(32) }, { role: "quote-vault" as const, address: addr(33) }, { role: "pool" as const, address: addr(31) },
          ...(clmmV1 ? [{ role: "amm-config" as const, address: addr(35) }, { role: "token2022-mint" as const, address: token2022Address }] : [])], observationState: null,
        operatorGroup: 1, liquidityOwnerGroup: 1, quoteAssetGroup: 1, bridgeOrWrapperGroup: 1,
        oracleSourceClass: 1, upgradeAuthorityGroup: 1 },
      readPlan: clmmV1 ? { allAddresses: [addr(35), addr(36), addr(37), addr(38)], auxiliary: [
        { role: "tick-array-lower", index: null, derivedFrom: [], address: addr(36) },
        { role: "tick-array-active", index: null, derivedFrom: [], address: addr(37) },
        { role: "tick-array-upper", index: null, derivedFrom: [], address: addr(38) },
        { role: "clmm-observation", index: null, derivedFrom: [], address: addr(39) },
      ] } : {} };
    return (confirmedRpc ? (deps: never, args: Parameters<typeof prepareMimirBetaSimpleFeed>[1]) => prepareMimirBetaSimpleFeedConfirmed(deps, args, confirmedRpc) : prepareMimirBetaSimpleFeed)(planning as never, { ...common, ...(resume.ticker ? { ticker: resume.ticker } : {}), authority: creator, identity: { ...common.identity, asset },
      baseMint: resume.baseMint ?? addr(6), pools: (resume.pools ?? [pool]) as never, policy: { ...classicPolicy, ...(resume.depthFloorBps !== undefined ? { depthFloorBps: resume.depthFloorBps } : {}) },
      ...(resume.temporalMode ? { temporalMode: resume.temporalMode } : {}),
      ...(resume.recipes ? { recipes: resume.recipes as never } : {}),
      ...(resume.variant === undefined ? {} : { variant: resume.variant }),
      ...(resume.frozenFeedId === undefined ? {} : { feedId: resume.frozenFeedId }),
      receipts: resume.receipts, observations: resume.observations,
      preserveDraftPoolEvidence: resume.preserveDraftPoolEvidence,
      creatorCollateralTokenAccount: collateralTokenAccount, allowCollateralFunding: resume.allowCollateralFunding,
      estimateFundingCosts: resume.estimateFundingCosts,
      ...(resume.fullCollateralPurchase !== undefined ? { fullCollateralPurchase: resume.fullCollateralPurchase } : {}),
      ...(resume.callerPrefix ? { callerPrefix: resume.callerPrefix } : {}) });
  }
  const components: MimirBetaCompositeComponentInput[] = [];
  let solConversionSourceConfig = resume.solConversionSourceConfig;
  const stagedReadinessWrites = new Set<Address>();
  const addExistingClassic = async (pools: readonly MimirBetaEligiblePool[], options: Readonly<{
    stale?: true; headerMismatch?: true; ready?: true; nativeReady?: true; nativeStale?: true; mixed?: true; authenticated?: true; variant?: number;
    sentinelRing?: true; belowFloor?: true;
  }> = {}) => {
    discoveryPools.push(...pools.filter((pool) => !discoveryPools.includes(pool)));
    for (const pool of pools) {
      if (!accounts.has(pool.baseMint)) add(pool.baseMint, tokenProgramId, mint());
      if (!accounts.has(pool.quoteMint)) add(pool.quoteMint, tokenProgramId, mint());
      for (const binding of pool.creation.staticAccounts) if (!accounts.has(binding.address)) {
        const mintAddress = binding.role === "base-vault" ? pool.baseMint : binding.role === "quote-vault" ? pool.quoteMint : null;
        add(binding.address, mintAddress ? pool.creation.tokenProgramId : pool.programId,
          mintAddress ? vault(mintAddress, pool.creation.vaultAuthority) : Uint8Array.of(1), binding.role === "market-program");
      }
    }
    const feedId = await deriveMimirBetaClassicFeedId(pools[0]!.baseMint, pools[0]!.quoteMint, options.variant ?? 0);
    const feedPdas = await deriveMimirBetaFeedPdas({ programId: mimirProgramId, feedId });
    const facts = [...new Map(pools.flatMap((pool) => pool.creation.staticAccounts.map(({ address }) => {
      const account = accounts.get(address)!; return [address, { address, owner: account.owner, executable: account.executable }] as const;
    }))).values()];
    const floorPools = options.belowFloor ? pools.map((pool) => ({ ...pool, minLiquidityNative: pool.minLiquidityNative + 2n })) : pools;
    const seedArtifacts = await buildMimirBetaClassicSourceArtifacts({ programId: mimirProgramId, feedId,
      baseMint: pools[0]!.baseMint, quoteMint: pools[0]!.quoteMint, pools: floorPools, physicalAccounts: facts, ...(resume.existingComponentPool ? { temporalMode: "current-point" as const } : {}) });
    const artifacts = await buildMimirBetaClassicSourceArtifacts({ programId: mimirProgramId, feedId,
      baseMint: pools[0]!.baseMint, quoteMint: pools[0]!.quoteMint, pools: floorPools, physicalAccounts: facts, ...(resume.existingComponentPool ? { temporalMode: "current-point" as const } : {}),
      authoritativeSources: seedArtifacts.artifacts.map(({ source }, index) => ({ ...source,
        sourceConfigRevision: 1n, sourceSetRevision: 1n })) });
    const planHash = await computeMimirBetaClassicPlanHash({ feedId, profile: 0, riskTier: 1, minSources: pools.length,
      minVenues: artifacts.lifecycleGroupCount, minCorrelationGroups: artifacts.lifecycleGroupCount, maxDispersionBps: 100,
      maxSourceActivityAgeSlots: 10, priceExponent: -8, baseMint: pools[0]!.baseMint, quoteMint: pools[0]!.quoteMint,
      sourceSetRoot: artifacts.sourceSetRoot, staticAccountsRoot: artifacts.staticAccountsRoot, twap: feedPdas.twap[0],
      anchorPolicyHash: classicPolicy.anchorPolicyHash, adapterMask: artifacts.adapterMask });
    const feed = new Uint8Array(357); feed.set(utf8("MIMIRCFG")); putU16(feed, 8, 1); putU16(feed, 10, 357);
    feed.set(addressBytes(feedId), CONFIG_OFFSETS.feedId); feed.set(addressBytes(pools[0]!.baseMint), CONFIG_OFFSETS.baseMint);
    feed.set(addressBytes(pools[0]!.quoteMint), CONFIG_OFFSETS.quoteMint); new DataView(feed.buffer).setInt32(CONFIG_OFFSETS.priceExponent, -8, true);
    feed[CONFIG_OFFSETS.riskTier] = 1; feed[CONFIG_OFFSETS.lifecycleState] = 3; feed[CONFIG_OFFSETS.baseDecimals] = 6;
    feed[CONFIG_OFFSETS.quoteDecimals] = 6; feed[CONFIG_OFFSETS.minSourceCount] = pools.length;
    putU16(feed, CONFIG_OFFSETS.maxSourceActivityAgeSlots, 10); putU16(feed, CONFIG_OFFSETS.maxSnapshotAgeSlots, 20);
    feed.set(artifacts.sourceSetRoot, CONFIG_OFFSETS.sourceSetHash); feed.set(addressBytes(feedPdas.sourcingPlan[0]), CONFIG_OFFSETS.defaultSourcingPlan);
    feed.set(classicPolicy.anchorPolicyHash, CONFIG_OFFSETS.anchorPolicyHash); feed.set(classicPolicy.nativeExceptionHash, CONFIG_OFFSETS.nativeExceptionHash);
    putU64(feed, CONFIG_OFFSETS.feedConfigRevision, 1n); putU64(feed, CONFIG_OFFSETS.registryEpoch, 1n); feed[CONFIG_OFFSETS.bump] = feedPdas.feed[1];
    feed.set(addressBytes(addr(90)), 325); decodeMimirBetaLiveFeed(feed); add(feedPdas.feed[0], mimirProgramId, feed);
    if (!resume.missingComponentCoreAsset) add(addr(90), deployment.mplCoreProgramId, Uint8Array.from(coreAssetData(addr(95), deployment.physicalCollection)));
    // addr(95) intentionally has no account before payout.
    const plan = new Uint8Array(320); plan.set(utf8("MIMIRPLN")); putU16(plan, 10, 320); plan.set(addressBytes(feedId), PLAN_OFFSETS.feedId);
    plan[PLAN_OFFSETS.riskTier] = 1; plan[PLAN_OFFSETS.minSources] = pools.length; plan[PLAN_OFFSETS.minVenues] = artifacts.lifecycleGroupCount;
    plan[PLAN_OFFSETS.minCorrelationGroups] = artifacts.lifecycleGroupCount; putU16(plan, PLAN_OFFSETS.maxDispersionBps, 100);
    putU16(plan, PLAN_OFFSETS.maxSourceActivityAgeSlots, 10); new DataView(plan.buffer).setInt32(PLAN_OFFSETS.priceExponent, -8, true);
    plan.set(addressBytes(pools[0]!.baseMint), PLAN_OFFSETS.baseMint); plan.set(addressBytes(pools[0]!.quoteMint), PLAN_OFFSETS.quoteMint);
    plan.set(artifacts.sourceSetRoot, PLAN_OFFSETS.sourceSetHash); plan.set(artifacts.staticAccountsRoot, PLAN_OFFSETS.accountsHash);
    plan.set(planHash, PLAN_OFFSETS.planHash); plan.set(addressBytes(feedPdas.twap[0]), PLAN_OFFSETS.twapState);
    plan.set(classicPolicy.anchorPolicyHash, PLAN_OFFSETS.anchorPolicyHash); putU64(plan, PLAN_OFFSETS.adapterMask, artifacts.adapterMask);
    plan[PLAN_OFFSETS.bump] = feedPdas.sourcingPlan[1]; plan[PLAN_OFFSETS.hashSchemeVersion] = 1; putU16(plan, PLAN_OFFSETS.ringVersion, 1);
    plan[PLAN_OFFSETS.accountsBindingVersion] = 1; await decodeMimirBetaLivePlan(plan); add(feedPdas.sourcingPlan[0], mimirProgramId, plan);
    for (const [index, artifact] of artifacts.artifacts.entries()) {
      const source = Uint8Array.from(buildTestSourceConfigHeader(index)); source.set(addressBytes(feedId), SOURCE_OFFSETS.feedId);
      source[SOURCE_OFFSETS.sourceIndex] = index;
      if (resume.existingComponentPool && artifact.source.temporalMode === "current-point") source[SOURCE_OFFSETS.flags] = 1; source[SOURCE_OFFSETS.adapterType] = artifact.source.adapterType;
      source[SOURCE_OFFSETS.direction] = artifact.source.direction; putU16(source, SOURCE_OFFSETS.adapterVersion, artifact.source.adapterVersion);
      for (const [offset, value] of [[SOURCE_OFFSETS.venueGroup, artifact.source.venueGroup], [SOURCE_OFFSETS.operatorGroup, artifact.source.operatorGroup],
        [SOURCE_OFFSETS.liquidityOwnerGroup, artifact.source.liquidityOwnerGroup], [SOURCE_OFFSETS.routeCorrelationGroup, artifact.source.routeCorrelationGroup],
        [SOURCE_OFFSETS.quoteAssetGroup, artifact.source.quoteAssetGroup], [SOURCE_OFFSETS.bridgeOrWrapperGroup, artifact.source.bridgeOrWrapperGroup],
        [SOURCE_OFFSETS.oracleSourceClass, artifact.source.oracleSourceClass], [SOURCE_OFFSETS.upgradeAuthorityGroup, artifact.source.upgradeAuthorityGroup],
        [SOURCE_OFFSETS.maxSourceWeightBps, artifact.source.maxSourceWeightBps]] as const) putU16(source, offset, value);
      putU128(source, SOURCE_OFFSETS.minLiquidityNative, artifact.source.minLiquidityNative);
      putU128(source, SOURCE_OFFSETS.minDepthTo50BpsNative, artifact.source.minDepthTo50BpsNative);
      for (const [offset, value] of [[SOURCE_OFFSETS.programId, artifact.source.programId], [SOURCE_OFFSETS.poolOrMarket, artifact.source.poolOrMarket],
        [SOURCE_OFFSETS.baseVault, artifact.source.baseVault], [SOURCE_OFFSETS.quoteVault, artifact.source.quoteVault],
        [SOURCE_OFFSETS.baseMint, pools[0]!.baseMint], [SOURCE_OFFSETS.quoteMint, pools[0]!.quoteMint],
        [SOURCE_OFFSETS.tokenProgram, artifact.source.tokenProgram], [SOURCE_OFFSETS.vaultAuthority, artifact.source.vaultAuthority]] as const) source.set(addressBytes(value), offset);
      putU64(source, SOURCE_OFFSETS.sourceConfigRevision, 1n); putU64(source, SOURCE_OFFSETS.sourceSetRevision, 1n);
      source[SOURCE_OFFSETS.bump] = (await deriveMimirBetaPda({ programId: mimirProgramId, seed: "source_config",
        values: [addressBytes(feedId), Uint8Array.of(index)] }))[1]; add(artifact.sourceConfig, mimirProgramId, source);
      const readySlot = resume.existingReadySlot ?? resume.slot ?? compositeSimulationSlot;
      const stagedReady = stagedReadinessWrites.has(artifact.sourceRing);
      const stale = (options.stale || options.nativeStale) && !stagedReady;
      const ready = options.ready || options.nativeReady || stagedReady;
      const ringReady = ready && !options.sentinelRing;
      const ring = stale ? atomicRing(1n) : ringReady ? atomicRing(readySlot) : new Uint8Array(544);
      ring.set(utf8("MIMIRRNG")); putU16(ring, 10, 544); ring.set(addressBytes(feedId), RING_OFFSETS.feedId);
      ring[RING_OFFSETS.sourceIndex] = index; ring[RING_OFFSETS.status] = stale || ringReady ? 0 : 2; putU16(ring, RING_OFFSETS.ringVersion, 1);
      ring[RING_OFFSETS.adapterType] = artifact.source.adapterType; putU64(ring, RING_OFFSETS.sourceConfigRevision, 1n);
      putU64(ring, RING_OFFSETS.sourceSetRevision, 1n); ring.set(addressBytes(artifact.sourceConfig), RING_OFFSETS.sourceConfig);
      ring.set(addressBytes(artifact.source.poolOrMarket), RING_OFFSETS.poolOrMarket); ring.set(planHash, RING_OFFSETS.selectedPlanHash);
      if (stagedReady && resume.stagedReadinessInvalid === "malformed") ring[0] = 0;
      if (stagedReady && resume.stagedReadinessInvalid === "future") putU64(ring, RING_OFFSETS.completedEndSlot, readySlot + 1n);
      if (stagedReady && resume.stagedReadinessInvalid === "binding") ring.set(addressBytes(addr(99)), RING_OFFSETS.sourceConfig);
      if (options.headerMismatch && index === 0) ring.set(addressBytes(addr(99)), RING_OFFSETS.poolOrMarket);
      ring[RING_OFFSETS.bump] = (await deriveMimirBetaPda({ programId: mimirProgramId, seed: "source_ring",
        values: [addressBytes(feedId), Uint8Array.of(index), Uint8Array.of(1, 0)] }))[1];
      putU16(ring, RING_OFFSETS.sourceWeightBps, artifact.source.maxSourceWeightBps);
      putU16(ring, RING_OFFSETS.routeCorrelationGroup, artifact.source.routeCorrelationGroup);
      if (options.authenticated) ring[RING_OFFSETS.windowFlags] |= 2;
      const ringData = resume.existingDammRing784 && stale && artifact.source.adapterType === 7
        ? extendedDammRing(ring, 1n) : ring;
      if (!resume.omitExistingRings) add(artifact.sourceRing, resume.existingRingOwner ?? mimirProgramId,
        resume.existingRingOwner === MIMIR_BETA_SYSTEM_PROGRAM_ID ? new Uint8Array() : ringData);
      if (resume.existingDammRingLamports !== undefined &&
          (resume.existingDammRingAddress === undefined || resume.existingDammRingAddress === artifact.sourceRing)) {
        accounts.get(artifact.sourceRing)!.lamports = resume.existingDammRingLamports;
      }
    }
    const stagedSnapshot = stagedReadinessWrites.has(feedPdas.snapshot[0]);
    const snapshotStale = (options.stale || options.nativeStale) && !stagedSnapshot;
    const snapshotReady = options.ready || options.nativeReady || stagedSnapshot;
    const snapshot = snapshotStale ? Uint8Array.from(atomicSnapshot(1n, pools.length, feedId)) : snapshotReady
      ? Uint8Array.from(atomicSnapshot(resume.existingReadySlot ?? resume.slot ?? compositeSimulationSlot, pools.length, feedId)) : new Uint8Array(512);
    snapshot.set(utf8("MIMIRSNP")); putU16(snapshot, 10, 512);
    snapshot.set(addressBytes(feedId), OFFSETS.feedId); snapshot.set(addressBytes(feedPdas.feed[0]), OFFSETS.feedConfig);
    putU64(snapshot, OFFSETS.registryEpoch, 1n); putU64(snapshot, OFFSETS.feedConfigRevision, 1n);
    snapshot[OFFSETS.status] = snapshotStale || snapshotReady ? 0 : 3;
    snapshot[OFFSETS.routeabilityStatus] = snapshotStale || snapshotReady ? 0 : 5;
    snapshot[OFFSETS.riskTier] = 1; new DataView(snapshot.buffer).setInt32(OFFSETS.priceExponent, -8, true);
    if (snapshotStale) putU64(snapshot, OFFSETS.validUntilSlot, 2n);
    if (options.mixed) snapshot[OFFSETS.snapshotSource] = 5;
    if (options.nativeReady || options.nativeStale) {
      snapshot[OFFSETS.snapshotSource] = 2;
      putU64(snapshot, OFFSETS.oldestSourceActivitySlot, options.nativeStale ? 1n : resume.slot ?? compositeSimulationSlot);
    }
    snapshot.set(planHash, OFFSETS.sourcingPlanHash); snapshot.set(classicPolicy.anchorPolicyHash, OFFSETS.anchorPolicyHash);
    snapshot.set(classicPolicy.nativeExceptionHash, OFFSETS.nativeExceptionHash); add(feedPdas.snapshot[0], mimirProgramId, snapshot);
    return { feedId, sourceConfig: artifacts.artifacts[0]!.sourceConfig, snapshot: feedPdas.snapshot[0], artifacts };
  };
  const realisticBaseMints = [addr(123), addr(112), addr(142), addr(100), addr(168)] as const;
  const directPool = (index: number, baseMint: Address = realisticBaseMints[index]!, quoteMint: Address = rootQuoteMint): MimirBetaEligiblePool => ({
    eligibility: "eligible", family: "meteora-damm-v2", adapterVersion: 0, token2022Mint: null, token2022PolicyHash: null, programId: addr(47), pool: addr(200 + index),
    descriptorId: `composite-existing-${index}`, descriptorHash: index.toString(16).padStart(64, "0"), readPlan: {} as never,
    canonicalMint0: baseMint, canonicalMint1: quoteMint, canonicalPairKey: `composite-existing-${index}`,
    direction: "quote-per-base", baseMint, quoteMint, baseVault: addr(210 + index), quoteVault: addr(220 + index),
    minLiquidityNative: 1n, minDepthTo50BpsNative: 1n, observedSlot: 5n, validThroughSlot: 10n,
    evidenceHash: (index + 10).toString(16).padStart(64, "0"), creation: { adapterType: 7, adapterVersion: 0,
      bindingVariant: "direct", tokenProgramId, token2022Mint: null, vaultAuthority: addr(230 + index), staticAccounts: [
        { role: "base-vault", address: addr(210 + index) }, { role: "quote-vault", address: addr(220 + index) },
        { role: "pool", address: addr(200 + index) }], observationState: null, operatorGroup: 1,
      liquidityOwnerGroup: 1, quoteAssetGroup: 1, bridgeOrWrapperGroup: 1, oracleSourceClass: 1,
      upgradeAuthorityGroup: 1 },
  });
  const defaultDirectPools: MimirBetaEligiblePool[] = [];
  for (let index = 0; index < (resume.componentCount ?? 5); index += 1) {
    const pool = directPool(index, realisticBaseMints[index]!, resume.solQuotedComponent && index === (resume.componentCount ?? 5) - 1
      ? nativeSolMint : rootQuoteMint);
    const selected = resume.existingComponentPool?.(pool, index) ?? pool;
    defaultDirectPools.push(selected);
    const existing = await addExistingClassic([selected], resume.sentinelOrdinary ? {} : { ready: true, ...(resume.belowFloorComponent && index === 0 ? { belowFloor: true } : {}) });
    components.push({ feedId: existing.feedId, sourceConfig: existing.sourceConfig, quantityX64: 1n });
  }
  if (resume.existingSentinelPools) {
    const existing = await addExistingClassic(resume.existingSentinelPools, {
      stale: resume.existingAtomicStale, headerMismatch: resume.existingSentinelHeaderMismatch,
      authenticated: resume.existingAuthenticated,
    });
    components[0] = { feedId: existing.feedId, sourceConfig: existing.sourceConfig, quantityX64: 1n };
    if (resume.useExistingSentinelConversion) solConversionSourceConfig = existing.artifacts.artifacts[1]!.sourceConfig;
  }
  if (resume.nativeConverter) {
    discoveryPools.push(resume.nativeConverter.pool);
    for (const account of resume.nativeConverter.before) {
      const data = Uint8Array.from(account.data);
      if (account.address === pdas.registry[0]) data.fill(0, 48, 80);
      add(account.address, account.owner, data, account.executable);
    }
    solConversionSourceConfig = resume.nativeConverter.sourceConfig;
  }
  if (resume.useCanonicalSolConversion) {
    const direct = directPool(5, "So11111111111111111111111111111111111111112" as Address);
    const pool = resume.canonicalSolConversionPool?.(direct) ?? direct; defaultDirectPools.push(pool);
    for (const extra of [...pool.creation.staticAccounts.filter(({ role }) => role === "amm-config").map(({ address }) => address), pool.creation.observationState]) {
      if (extra && !accounts.has(extra)) add(extra, pool.programId, Uint8Array.of(1));
    }
    if (pool.creation.observationState) {
      const observation = new Uint8Array(4_075); observation.set([122, 174, 197, 53, 129, 9, 165, 132]); observation[8] = 1;
      observation.set(addressBytes(pool.pool), 11); add(pool.creation.observationState, pool.programId, observation);
    }
    const conversion = await addExistingClassic([pool],
      resume.nativeDeepConversion ? { nativeReady: true } : resume.staleNativeDeepConversion ? { nativeStale: true } : resume.mixedConversion ? { ready: true, mixed: true } : { ready: true, ...(resume.sentinelConversionRing ? { sentinelRing: true } : {}) });
    solConversionSourceConfig = conversion.sourceConfig;
  }
  assert.equal(new Set(defaultDirectPools.flatMap((pool) => [pool.pool, pool.baseVault, pool.quoteVault, pool.baseMint])).size,
    defaultDirectPools.length * 4, "default direct-pool fixture roles are globally disjoint");
  for (const pool of defaultDirectPools) {
    assert.deepEqual(accounts.get(pool.pool), { owner: pool.programId, executable: false, lamports: 10n, data: Uint8Array.of(1) });
    assert.deepEqual(accounts.get(pool.baseMint), { owner: tokenProgramId, executable: false, lamports: 10n, data: mint() });
    assert.deepEqual(accounts.get(pool.baseVault), { owner: tokenProgramId, executable: false, lamports: 10n,
      data: vault(pool.baseMint, pool.creation.vaultAuthority) });
    assert.deepEqual(accounts.get(pool.quoteVault), { owner: tokenProgramId, executable: false, lamports: 10n,
      data: vault(pool.quoteMint, pool.creation.vaultAuthority) });
  }
  for (const account of resume.existingComponentAccounts ?? []) accounts.set(account.address, account);
  for (const address of resume.prefundedAddresses ?? []) accounts.set(address, { owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false, lamports: 7_000_000n, data: new Uint8Array() });
  if (resume.reverseComponents) components.reverse();
  if (resume.compositeCreateClassicPool) {
    const pool = resume.compositeCreateClassicPool as MimirBetaEligiblePool;
    const feedId = await deriveMimirBetaClassicFeedId(pool.baseMint, pool.quoteMint, resume.compositeCreateClassicVariant ?? 0);
    const [sourceConfig] = await deriveMimirBetaPda({ programId: mimirProgramId, seed: "source_config",
      values: [addressBytes(feedId), Uint8Array.of(0)] });
    components[resume.compositeCreateClassicIndex ?? (resume.existingSentinelPools ? 1 : 0)] = { feedId, sourceConfig, quantityX64: 1n, createClassic: { baseMint: pool.baseMint,
      ticker: "CHILD", pool, identity: { ...common.identity, asset: addr(50) }, policy: { ...classicPolicy, ...(resume.depthFloorBps !== undefined ? { depthFloorBps: resume.depthFloorBps } : {}) },
      ...(resume.compositeCreateClassicVariant !== undefined ? { variant: resume.compositeCreateClassicVariant } : {}),
      ...(resume.compositeCreateClassicTemporalMode !== undefined ? { temporalMode: resume.compositeCreateClassicTemporalMode } : {}) } };
    if (resume.useFreshClassicConversion) solConversionSourceConfig = sourceConfig;
    if (resume.occupiedCompositeClassic) {
      const existing = await addExistingClassic([pool], { ready: true, variant: resume.compositeCreateClassicVariant ?? 0 });
      assert.equal(existing.sourceConfig, sourceConfig);
      const feedPdas = await deriveMimirBetaFeedPdas({ programId: mimirProgramId, feedId });
      const feedData = accounts.get(feedPdas.feed[0])!.data;
      new DataView(feedData.buffer, feedData.byteOffset, feedData.byteLength).setUint32(12, 1, true);
      feedData.set(encodeMimirBetaTicker("CHILD"), 313);
      feedData.set(addressBytes(resume.occupiedIdentity ?? addr(50)), 325);
      add(resume.occupiedIdentity ?? addr(50), deployment.mplCoreProgramId, Uint8Array.from(coreAssetData(creator, deployment.physicalCollection)));
      const [childTicker, childTickerBump] = await deriveMimirBetaTickerPda(mimirProgramId, "CHILD");
      const claim = new Uint8Array(43); claim.set(utf8("MIMIRTIK")); claim[8] = 1; claim[9] = 2; claim[10] = childTickerBump;
      claim.set(addressBytes(feedPdas.feed[0]), 11); add(childTicker, mimirProgramId, claim);
    }
  }
  for (const [index, candidate] of (resume.compositeCreateClassicPools ?? []).entries()) {
    const pool = candidate as MimirBetaEligiblePool;
    const feedId = await deriveMimirBetaClassicFeedId(pool.baseMint, pool.quoteMint);
    const [sourceConfig] = await deriveMimirBetaPda({ programId: mimirProgramId, seed: "source_config",
      values: [addressBytes(feedId), Uint8Array.of(0)] });
    components[index] = { feedId, sourceConfig, quantityX64: 1n, createClassic: { baseMint: pool.baseMint,
      ticker: `CHILD${index}`, pool, identity: { ...common.identity, asset: addr(50 + index) }, policy: classicPolicy } };
  }
  for (const receipt of resume.receipts ?? []) {
    if (!receipt.stepId.startsWith("composite:classic-activate:")) continue;
    const index = Number(receipt.stepId.slice(-1)); const component = components[index]!;
    const [sourceRing] = await deriveMimirBetaPda({ programId: mimirProgramId, seed: "source_ring",
      values: [addressBytes(component.feedId), Uint8Array.of(0), Uint8Array.of(1, 0)] });
    const ring = atomicRing(resume.existingReadySlot ?? resume.slot ?? compositeSimulationSlot); ring.set(addressBytes(component.feedId), RING_OFFSETS.feedId);
    ring.set(addressBytes(component.sourceConfig), RING_OFFSETS.sourceConfig); ring[RING_OFFSETS.adapterType] = 7;
    if (index === 1 && resume.stagedPrefixInvalid === "malformed") ring[0] = 0;
    if (index === 1 && resume.stagedPrefixInvalid === "future") putU64(ring, RING_OFFSETS.completedEndSlot, (resume.slot ?? compositeSimulationSlot) + 1n);
    add(sourceRing, mimirProgramId, ring);
  }
  for (const component of components) {
    if (component.createClassic || accounts.get(component.sourceConfig)?.data.length === 384) continue;
    const sourceData = buildTestSourceConfigHeader(0, (data) => { data.set(addressBytes(component.feedId), 16); data[49] = 7; });
    add(component.sourceConfig as Address, mimirProgramId, Uint8Array.from(sourceData));
    const [sourceRing] = await deriveMimirBetaPda({ programId: mimirProgramId, seed: "source_ring",
      values: [addressBytes(component.feedId), Uint8Array.of(0), Uint8Array.of(1, 0)] });
    const [snapshot] = await deriveMimirBetaPda({ programId: mimirProgramId, seed: "feed_snapshot", values: [addressBytes(component.feedId)] });
    const ringData = atomicRing(resume.slot ?? compositeSimulationSlot); ringData.set(addressBytes(component.feedId), 16);
    ringData.set(addressBytes(component.sourceConfig), 216); add(sourceRing, mimirProgramId, ringData);
    add(snapshot, mimirProgramId, Uint8Array.from(atomicSnapshot(resume.slot ?? compositeSimulationSlot, 1, component.feedId)));
  }
  if (solConversionSourceConfig && !resume.useFreshClassicConversion && !accounts.has(solConversionSourceConfig)) {
    const conversionFeed = addr(29); const sourceData = buildTestSourceConfigHeader(0, (data) => { data.set(addressBytes(conversionFeed), 16); data[49] = 7; });
    add(solConversionSourceConfig, mimirProgramId, Uint8Array.from(sourceData));
    const [snapshot] = await deriveMimirBetaPda({ programId: mimirProgramId, seed: "feed_snapshot", values: [addressBytes(conversionFeed)] });
    add(snapshot, mimirProgramId, Uint8Array.from(atomicSnapshot(resume.slot ?? compositeSimulationSlot, 1, conversionFeed)));
  }
  for (const receipt of resume.receipts ?? []) {
    if (receipt.stepId.startsWith("composite:classic-activate:")) {
      const stagedAsset = receipt.reviewedStep.review.identityAsset;
      const index = Number(receipt.stepId.slice(-1)); const component = components[index]!;
      if (resume.finalizedClassicOwnerOverride !== undefined) {
        if (!accounts.has(component.sourceConfig)) {
          const sourceData = buildTestSourceConfigHeader(0, (data) => {
            data.set(addressBytes(component.feedId), 16); data[49] = 7;
          });
          add(component.sourceConfig, mimirProgramId, Uint8Array.from(sourceData));
        }
        add(stagedAsset, deployment.mplCoreProgramId,
          Uint8Array.from(coreAssetData(resume.finalizedClassicOwnerOverride, deployment.physicalCollection)));
        finalizedClassicAssets.add(stagedAsset);
      } else if (!accounts.has(stagedAsset)) add(stagedAsset, deployment.mplCoreProgramId,
        Uint8Array.from(coreAssetData(creator, deployment.physicalCollection)));
    }
  }
  resume.componentInputCapture?.push(...components);
  const recoveryIdentity = resume.recoveryIntent?.identityAsset ?? asset;
  const recoveryComponents = resume.recoveryIntent?.componentQuantityX64 === undefined ? components : components.map((component, index) =>
    index === 0 ? { ...component, quantityX64: resume.recoveryIntent!.componentQuantityX64! } : component);
  const defaultReconciliationRpc: Parameters<typeof observeMimirBetaReceipt>[0]["rpc"] = {
    getTransaction: () => pending(null),
    getAccountInfo: (address) => rpc.getAccountInfo(address),
    getMultipleAccounts: (addresses, config) => rpc.getMultipleAccounts(addresses, config as { commitment: string }),
    getSignatureStatuses: () => pending({ context: { slot: Number(resume.slot ?? 5n) }, value: [null] }),
    isBlockhashValid: () => pending({ context: { slot: Number(resume.slot ?? 5n) }, value: true }),
  };
  const compositeArgs = { ...common, ticker: resume.recoveryIntent?.ticker ?? resume.ticker ?? common.ticker, quoteMint: rootQuoteMint,
    authority: creator, identity: { ...common.identity, asset: recoveryIdentity },
    creatorCollateralTokenAccount: collateralTokenAccount,
    displayName: resume.displayName ?? common.displayName,
    components: recoveryComponents, solConversionSourceConfig, ...(resume.converterRecipes ? { converterRecipes: resume.converterRecipes } : {}),
    ...(resume.componentRecipes ? { componentRecipes: resume.componentRecipes as never } : {}),
    policy: { ...compositePolicy, maxComponentSnapshotAgeSlots: resume.maxComponentSnapshotAgeSlots ?? compositePolicy.maxComponentSnapshotAgeSlots, ...resume.qualityCaps },
    receipts: resume.receipts, observations: resume.observations,
    preserveDraftPoolEvidence: resume.preserveDraftPoolEvidence,
    allowCollateralFunding: resume.allowCollateralFunding, estimateFundingCosts: resume.estimateFundingCosts,
    ...(resume.fullCollateralPurchase !== undefined ? { fullCollateralPurchase: resume.fullCollateralPurchase } : {}),
    ...(resume.stagedExecution ? { stagedExecution: true } : {}) };
  for (const receipt of resume.receipts ?? []) {
    if (receipt.stepId !== "composite:init") continue;
    if (resume.observations?.some((o) => o.signature === receipt.signature && o.state === "expired")) continue;
    const ixs = receipt.reviewedStep.review.instructions.map((ix) => ({ data: fromBase64(ix.dataBase64), accounts: ix.accounts.map((a) => a.address) }));
    const begin = ixs.find((ix) => ix.data[0] === 88 && ix.data[1] === 0)!;
    const seal = ixs.find((ix) => ix.data[0] === 88 && ix.data[1] === 2)!;
    accounts.set(begin.accounts[1]!, { owner: mimirProgramId, executable: false, lamports: 1n,
      data: compositeExecutionImageFromSeal(seal.data, begin.accounts[2]!, seal.accounts, (key) => accounts.get(key)!.data) });
  }
  void defaultReconciliationRpc;
  if (resume.journey) {
    const { rpc: journeyRpc, simulations, childPools, ...journeyArgs } = resume.journey;
    const { receipts: _receipts, observations: _observations, ...input } = compositeArgs;
    const simulate = planning.rpc.simulateTransaction;
    const journeyPlanning = { ...planning, rpc: { ...planning.rpc, simulateTransaction: (wire: string, config: { commitment: string; minContextSlot: bigint; accounts: { addresses: readonly Address[] } }) => {
      if (config.accounts?.addresses.length) simulations?.push({ commitment: config.commitment, minContextSlot: config.minContextSlot });
      return simulate(wire, { ...config, commitment: config.commitment === "processed" ? "confirmed" : config.commitment });
    } } };
    return prepareMimirBetaCompositeFeedJourney({ ...journeyPlanning, ...resume.extraDependencies } as never, { ...journeyArgs, input: { ...input,
      components: input.components.map((component, index) => childPools?.has(index) ? { ...component, createClassic: { ...component.createClassic!, pool: childPools.get(index)! } } : component) } as never },
      { ...defaultReconciliationRpc, ...journeyRpc }) as never;
  }
  if (resume.extraDependencies?.viaClient) {
    const facadeRpc = { ...dependencies.rpc, getAccountInfo: (a: Address, config: never) => a === MIMIR_BETA_TRANSACTION_V1_FEATURE
      ? pending({ context: { slot: 5 }, value: { owner: MIMIR_BETA_TRANSACTION_V1_FEATURE_OWNER, executable: false,
        lamports: 1, data: [base64(Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0, 0)), "base64"] } }) : (dependencies.rpc.getAccountInfo as (a: Address, c: never) => unknown)(a, config) };
    return createMimirBetaClient({ ...dependencies, ...resume.extraDependencies, rpc: facadeRpc } as never).prepareCompositeFeed(compositeArgs);
  }
  return (confirmedRpc ? (deps: never, args: Parameters<typeof prepareMimirBetaCompositeFeed>[1]) => prepareMimirBetaCompositeFeedConfirmed(deps, args, confirmedRpc) : prepareMimirBetaCompositeFeed)({ ...planning, ...resume.extraDependencies } as never, compositeArgs);
}

async function proveSignerVectorLineage(kind: "classic" | "composite", steps: readonly MimirBetaPlanStep[],
  expected: readonly Readonly<{ id: MimirBetaStepId; signers: readonly Address[] }>[]) {
  assert.equal(steps.length, expected.length);
  assert.deepEqual(steps.map((step) => ({ id: step.stepId, signers: step.requiredSigners })), expected);
  for (const [index, draftStep] of steps.entries()) {
    const instructionCount = draftStep.stepId.endsWith(":activate") ? 3 : 1;
    const instructions = Array.from({ length: instructionCount }, (_, instructionIndex) => ({ programAddress: addr(90 + instructionIndex),
      accounts: draftStep.requiredSigners.slice(1).map((address) => ({ address, isSigner: true, isWritable: false })),
      data: Uint8Array.of(index, instructionIndex) }));
    const transaction = await compileMimirBetaTransactionV1({ feePayer: addr(1), recentBlockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 99n, instructions });
    assert.deepEqual(transaction.requiredSigners, draftStep.requiredSigners);
    assert.equal(transaction.serializedTransaction[0], 0x81);
    assert.equal(transaction.packet.signatureCount, draftStep.requiredSigners.length);
    const expectedWritesHash = await createExpectedWritesHash(draftStep.expectedWrites);
    const stepIntentHash = await createStepIntentHash({ draftHash: (kind === "classic" ? "a" : "b").repeat(64), step: draftStep, expectedWritesHash });
    const reviewBase = { schema: "mimir-beta-creation-review" as const, version: 1 as const,
      draftHash: (kind === "classic" ? "a" : "b").repeat(64), stepId: draftStep.stepId, kind, cluster: "localnet" as const,
      programId: addr(20), authority: addr(1), feedId: addr(21), feed: addr(22), identityAsset: addr(3),
      ticker: common.ticker, displayName: kind === "composite" ? common.displayName : null,
      requiredSigners: transaction.requiredSigners, instructions: await Promise.all(instructions.map(async (instruction) => ({
        programAddress: instruction.programAddress, accounts: instruction.accounts, dataBase64: base64(instruction.data),
        dataSha256: hex(await sha256(instruction.data)) }))), expectedWrites: draftStep.expectedWrites,
      messageHash: transaction.messageHash, stepIntentHash, expectedWritesHash,
      packet: transaction.packet, simulation: { status: "succeeded" as const, contextSlot: 5n, unitsConsumed: 1n,
        logsHash: "c".repeat(64), returnDataHash: null, error: null }, warnings: [] };
    const review = await createReviewHash(reviewBase);
    const receipt = await signedStageReceipt({ step: draftStep, transaction, review: reviewBase, ...review });
    const hydrated = await authenticateMimirBetaReviewedStep(receipt);
    assert.deepEqual(hydrated.step.requiredSigners, draftStep.requiredSigners);
    assert.deepEqual(hydrated.review.requiredSigners, transaction.requiredSigners);
  }
}

async function provePreparedNext(prepared: Awaited<ReturnType<typeof prepareMimirBetaSimpleFeed>>) {
  assert.ok(prepared.next);
  assert.deepEqual(prepared.next.step.requiredSigners, prepared.plan.steps[0]!.requiredSigners);
  assert.deepEqual(prepared.next.review.requiredSigners, prepared.next.transaction.requiredSigners);
  assert.equal(prepared.next.transaction.serializedTransaction[0], 0x81);
  const receipt = await signedStageReceipt(prepared.next);
  assert.deepEqual((await authenticateMimirBetaReviewedStep(receipt)).step.requiredSigners, prepared.next.step.requiredSigners);
}

const creator = addr(1); const governanceAuthority = addr(5); const approver = addr(6); const asset = addr(3);
for (const token2022Side of ["base", "quote"] as const) {
  const prepared = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
    creationBoundary: { source: "clmm-v1", token2022Side },
  });
  assert.equal(prepared.selectedPools?.[0]!.creation.adapterType, 1);
  assert.equal(prepared.selectedPools?.[0]!.creation.adapterVersion, 1);
  assert.ok(prepared.plan.steps.flatMap((step) => step.expectedWrites).every((write) => !write.description?.includes("TWAP")));
  assert.equal(prepared.selectedPools?.[0]!.creation.token2022Mint, token2022Side === "base" ? addr(6) : addr(2));
  assert.ok(prepared.plan.steps.length > 0, `prepared CLMM V1 creation with Token-2022 on ${token2022Side}`);
  assert.equal(prepared.temporalMode, undefined, "non-point families keep their mode");
}
await assert.rejects(creationFixture(1, [governanceAuthority], "classic", addr(9), { creationBoundary: { source: "clmm-v1", token2022Side: "base" },
  temporalMode: "current-point" }), /INVALID_ARGUMENT:temporalMode current-point is unsupported by the selected sources/);
const pumpswapV1Prepared = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, temporalMode: "sampled-interval",
});
assert.equal(pumpswapV1Prepared.selectedPools?.[0]!.creation.adapterType, 6);
assert.equal(pumpswapV1Prepared.selectedPools?.[0]!.creation.adapterVersion, 1);
assert.equal(pumpswapV1Prepared.selectedPools?.[0]!.creation.token2022Mint, addr(6));
assert.ok(pumpswapV1Prepared.plan.steps.flatMap((step) => step.expectedWrites).every((write) => !write.description.includes("source ring")),
  "activation leaves the public source ring unallocated");
assert.deepEqual(pumpswapV1Prepared.selectedPools?.[0]!.creation.staticAccounts.map((entry) => entry.role),
  ["base-mint", "quote-mint", "base-vault", "quote-vault", "pool", "global-config", "fee-config"]);
assert.ok(pumpswapV1Prepared.plan.steps.length > 0, "prepared PumpSwap V1 Simple feed with bound metadata base");
const tags = (prepared: typeof pumpswapV1Prepared) => prepared.next!.transaction.instructions
  .filter((instruction) => instruction.programAddress === prepared.plan.programId).map((instruction) => instruction.data[0]);
assert.ok(tags(pumpswapV1Prepared).includes(90) && tags(pumpswapV1Prepared).includes(89), "PumpSwap activation fuses the tag-90 closure and tag 89");
assert.equal(pumpswapV1Prepared.snapshot, "warming", "sampled rows mature through tag-89 sample-only");
const pumpswapV1Repeat = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, temporalMode: "sampled-interval",
});
assert.equal(pumpswapV1Repeat.next!.transaction.messageHash, pumpswapV1Prepared.next!.transaction.messageHash);
const zeroFeePrepared = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  creationBoundary: { source: "pumpswap-v1", token2022Side: "base" },
  pools: [{ ...pumpswapV1Prepared.selectedPools![0]!, pointOnly: true }], simulatedPointOnlyRing: true, temporalMode: "sampled-interval",
});
assert.ok(tags(zeroFeePrepared).includes(90) && tags(zeroFeePrepared).includes(89), "zero-fee PumpSwap activation seals and samples its private row");
assert.equal(zeroFeePrepared.snapshot, "warming");
for (const pointOnly of [true, false]) for (const depthFloorBps of [undefined, 9_000]) {
  const depth = 1_001n, pool = { ...pumpswapV1Prepared.selectedPools![0]!, minDepthTo50BpsNative: depth, ...(pointOnly ? { pointOnly } : {}) };
  const prepared = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
    creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, pools: [pool], depthFloorBps, simulatedPointOnlyRing: pointOnly, temporalMode: pointOnly ? "current-point" : "sampled-interval" });
  const appends = prepared.next!.transaction.instructions.map(({ data }) => Buffer.from(data))
    .filter((data) => data[0] === 78 && data[1] === 1);
  assert.equal(appends.length, 1);
  assert.deepEqual([readU128(appends[0]!, 57), readU128(appends[0]!, 73)], [1n, depthFloorBps === undefined ? 90n : 900n]);
}
assert.deepEqual([zeroFeePrepared.readiness?.status, zeroFeePrepared.readiness?.requiredCount,
  zeroFeePrepared.readiness?.requiredSpanSeconds], ["warming", 13, 120n]);
const pointPrepared = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  creationBoundary: { source: "pumpswap-v1", token2022Side: "base" },
  pools: [{ ...pumpswapV1Prepared.selectedPools![0]!, pointOnly: true }], simulatedPointOnlyRing: true, temporalMode: "current-point",
});
assert.equal(pointPrepared.snapshot, undefined, "point creation has no warm-up stage");
assert.equal(pointPrepared.readiness, undefined);
assert.deepEqual(pointPrepared.plan.steps.map((step) => step.stepId).slice(-2), ["classic:activate", "classic:ready"], "point [90,89] runs after activation");
const pointIxs = pointPrepared.next!.transaction.instructions.filter((instruction) => instruction.programAddress === pointPrepared.plan.programId);
assert.ok(!pointIxs.some((instruction) => instruction.data[0] === 89 || instruction.data[0] === 90), "activation keeps point publication out of its writable-config transaction");
assert.ok(pointIxs.some((instruction) => instruction.data[0] === 78 && instruction.data[1] === 1 && instruction.data[2 + 34] === 0x81),
  "compact source carries the point bit");
{
  const base = { ...pumpswapV1Prepared.selectedPools![0]!, pointOnly: true };
  const pools = [0, 1, 2, 3, 4].map((i) => {
    if (i === 0) return base;
    const staticAccounts = base.creation.staticAccounts.map((a, j) => a.role.endsWith("mint") ? a : { ...a, address: bytesAddress(Uint8Array.from({ length: 32 }, (_, k) => k === 0 ? 0xee : k === 1 ? i : k === 2 ? j : 3)) });
    const at = (role: string) => staticAccounts.find((a) => a.role === role)!.address;
    return { ...base, pool: at("pool"), baseVault: at("base-vault"), quoteVault: at("quote-vault"), creation: { ...base.creation, staticAccounts } };
  });
  // A staged point fallback whose ready packet compiles still reaches the collateral decision.
  const r = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
    creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, pools, simulatedPointOnlyRing: true, temporalMode: "current-point",
    pointProbe: "err", allowCollateralFunding: true, collateralBalanceRaw: 0n }).catch((e: unknown) => e);
  assert.ok(r instanceof MimirBetaCollateralRequiredError && r.fundingCosts === undefined, String(r));
  const overflow = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
    creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, pools, simulatedPointOnlyRing: true, temporalMode: "current-point", pointProbe: "err" });
  assert.deepEqual(overflow.plan.steps.map((step) => step.stepId), ["classic:proposal-init", "classic:activate", "classic:ready"]);
  // 3-4 point sources stage the proposal ahead, so no fused probe runs against its absent account (was tag 80 Custom 2 escaping).
  for (const count of [3, 4]) {
    const absentProbe = { value: null as string | null };
    const staged = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
      creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, pools: pools.slice(0, count), simulatedPointOnlyRing: true,
      temporalMode: "current-point", pointProbe: "absent-proposal", pointProbeWire: absentProbe });
    assert.deepEqual(staged.plan.steps.map((step) => step.stepId).slice(-2), ["classic:activate", "classic:ready"]);
    assert.equal(absentProbe.value, null, "no activation-suffix probe before the proposal exists");
  }
  assert.equal(overflow.next!.transaction.instructions.length, 5);
  assert.ok(overflow.next!.transaction.packet.serializedTransactionBytes <= 4096);
  console.log("point overflow fixture:", JSON.stringify({ sources: 5, approvals: overflow.plan.steps.length,
    keys: overflow.next!.transaction.packet.accountCount, bytes: overflow.next!.transaction.packet.serializedTransactionBytes }));
}
{
  const pointArgs = { creationBoundary: { source: "pumpswap-v1" as const, token2022Side: "base" as const },
    pools: [{ ...pumpswapV1Prepared.selectedPools![0]!, pointOnly: true }], simulatedPointOnlyRing: true };
  const omitted = await creationFixture(1, [governanceAuthority], "classic", addr(9), pointArgs);
  const explicit = await creationFixture(1, [governanceAuthority], "classic", addr(9), { ...pointArgs, temporalMode: "current-point" });
  assert.deepEqual([omitted.temporalMode, omitted.snapshot, omitted.draftHash], ["current-point", undefined, explicit.draftHash],
    "omitted mode on a fresh PumpSwap source resolves to current-point");
  assert.equal(pumpswapV1Prepared.temporalMode, "sampled-interval", "explicit sampled stays sampled");
  const omittedReceipt = await signedStageReceipt(omitted.next!);
  await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), { ...pointArgs, pools: omitted.selectedPools!,
    receipts: [omittedReceipt] }), /INVALID_ARGUMENT:resuming a point-capable source needs its bound temporalMode/);
  for (const funding of [{}, { allowCollateralFunding: true, collateralBalanceRaw: 0n }]) {
    const refused = await creationFixture(1, [governanceAuthority], "classic", addr(9), { ...pointArgs, temporalMode: "current-point",
      pointProbe: "structural", ...funding }).catch((e: unknown) => e);
    assert.ok(refused instanceof MimirBetaSimulationError && refused.customCode === 54, `structural probe refusal is not packing: ${String(refused)}`);
  }
}
for (const pointProbe of ["ok", "err"] as const) {
  const prepared = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
    creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, pointProbe,
    pools: [{ ...pumpswapV1Prepared.selectedPools![0]!, pointOnly: true }], simulatedPointOnlyRing: true, temporalMode: "current-point",
  });
  const ids = prepared.plan.steps.map((step) => step.stepId);
  const tags = prepared.next!.transaction.instructions.filter((instruction) => instruction.programAddress === prepared.plan.programId)
    .map((instruction) => instruction.data[0]);
  if (pointProbe === "ok") {
    assert.deepEqual(ids.slice(-1), ["classic:activate"], "fitting point classic fuses into one activation");
    assert.deepEqual(tags.slice(-2), [90, 89], "fused activation ends with SEAL and the point publish");
    assert.ok(prepared.next!.review.expectedWrites.some((write) => write.address === prepared.plan.feed), "fused activation keeps expected writes");
  } else {
    assert.deepEqual(ids.slice(-2), ["classic:activate", "classic:ready"], "probe refusal keeps the split");
    assert.ok(!tags.includes(89) && !tags.includes(90));
  }
  const resumed = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
    creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, pointProbe: pointProbe === "ok" ? "err" : "ok",
    pools: prepared.selectedPools!, simulatedPointOnlyRing: true, temporalMode: "current-point",
    receipts: [await signedStageReceipt(prepared.next!)],
  });
  assert.equal(resumed.plan.draftHash, prepared.plan.draftHash, "topology is frozen once a receipt exists");
  assert.deepEqual(resumed.plan.steps.map((step) => step.stepId), ids);
}
{
  const base = { ...pumpswapV1Prepared.selectedPools![0]!, pointOnly: true };
  const second = { ...base, pool: addr(61), baseVault: addr(62), quoteVault: addr(63), creation: { ...base.creation,
    staticAccounts: base.creation.staticAccounts.map((meta) => ({ ...meta, address: meta.role === "pool" ? addr(61) :
      meta.role === "base-vault" ? addr(62) : meta.role === "quote-vault" ? addr(63) : meta.address })) } };
  for (const pools of [[base], [base, second]]) {
    for (const pointProbe of ["ok", "err"] as const) {
      const pointProbeWire = { value: null as string | null };
      const prepared = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
        creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, pointProbe, pointProbeWire,
        pools, simulatedPointOnlyRing: true, temporalMode: "current-point" });
      const packet = prepared.next!.transaction.packet;
      const tags = prepared.next!.transaction.instructions.filter((ix) => ix.programAddress === prepared.plan.programId).map((ix) => ix.data[0]);
      assert.equal(tags.filter((tag) => tag === 78).length, pools.length + 1, "exact final packet includes proposal and every append");
      assert.deepEqual(prepared.plan.steps.map((step) => step.stepId), pointProbe === "ok" ? ["classic:activate"] : ["classic:activate", "classic:ready"]);
      if (pointProbe === "ok") assert.equal(pointProbeWire.value, base64(prepared.next!.transaction.serializedTransaction), "admission and review simulate the exact combined packet");
      const burn = prepared.next!.review.expectedWrites.find((write) => write.proof.kind === "spl-token-burn-checked")!;
      assert.equal(burn.proof.kind === "spl-token-burn-checked" && burn.proof.outerInstructionIndex, 3 + pools.length);
      const resumed = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
        creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, pointProbe: pointProbe === "ok" ? "err" : "ok",
        pools: prepared.selectedPools!, receipts: [await signedStageReceipt(prepared.next!)], simulatedPointOnlyRing: true, temporalMode: "current-point" });
      assert.equal(resumed.draftHash, prepared.draftHash);
      assert.deepEqual(resumed.plan.steps.map((step) => step.stepId), prepared.plan.steps.map((step) => step.stepId));
      console.log("point packing fixture:", JSON.stringify({ sources: pools.length, probe: pointProbe, approvals: prepared.plan.steps.length,
        keys: packet.accountCount, bytes: packet.serializedTransactionBytes, cu: String(prepared.next!.review.simulation.unitsConsumed),
        simulationSlot: String(prepared.next!.review.simulation.contextSlot), messageHash: prepared.next!.transaction.messageHash }));
    }
  }
  for (const probe of [{ pointProbeUnits: null }, { pointProbeUnits: 0 }, { pointProbeUnits: 1_400_001 }, { pointProbeSlot: 4n }]) {
    const prepared = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
      creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, pointProbe: "ok", ...probe,
      pools: [base], simulatedPointOnlyRing: true, temporalMode: "current-point" });
    assert.deepEqual(prepared.plan.steps.map((step) => step.stepId), ["classic:activate", "classic:ready"]);
  }
}
const dlmmV1Pool: MimirBetaEligiblePool = {
  ...pumpswapV1Prepared.selectedPools![0]!, family: "meteora-dlmm", programId: address(String(METEORA_DLMM_PROGRAM_ID)),
  pool: addr(50), descriptorId: "fixture-dlmm-v1", descriptorHash: "d".repeat(64),
  baseVault: addr(51), quoteVault: addr(52), readPlan: {
    ...pumpswapV1Prepared.selectedPools![0]!.readPlan,
    descriptorId: "fixture-dlmm-v1", descriptorHash: "d".repeat(64), family: "meteora-dlmm",
    program: address(String(METEORA_DLMM_PROGRAM_ID)), pool: addr(50), baseVault: addr(51), quoteVault: addr(52),
    allAddresses: [addr(53)], auxiliary: [
      { role: "depth-bin-array", index: "0", derivedFrom: [], address: addr(53) },
    ],
  },
  creation: { ...pumpswapV1Prepared.selectedPools![0]!.creation, adapterType: 3, staticAccounts: [
    { role: "base-vault", address: addr(51) }, { role: "quote-vault", address: addr(52) },
    { role: "pool", address: addr(50) }, { role: "token2022-mint", address: addr(6) },
  ] },
};
const dlmmV1QuotePool: MimirBetaEligiblePool = { ...dlmmV1Pool, token2022Mint: addr(2),
  creation: { ...dlmmV1Pool.creation, token2022Mint: addr(2), staticAccounts: [
    ...dlmmV1Pool.creation.staticAccounts.slice(0, -1), { role: "token2022-mint", address: addr(2) },
  ] } };
// Explicit DLMM DUAL keeps its compact-point preflight before payment (this fixture has no live bin array).
await assert.rejects(creationFixture(1, [governanceAuthority], "classic", addr(9), { creationBoundary: { source: "pumpswap-v1", token2022Side: "base" },
  supportedAdapterVersionMasks: [0, 0, 0, 3], pools: [dlmmV1Pool], recipes: ["dual-native-point"] }), /DLMM active bin array moved/);
for (const [side, pool] of [["base", dlmmV1Pool], ["quote", dlmmV1QuotePool]] as const) {
  const mono = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
    creationBoundary: { source: "pumpswap-v1", token2022Side: side },
    supportedAdapterVersionMasks: [0, 0, 0, 3], pools: [pool], recipes: ["spot"],
  });
  assert.equal(mono.selectedPools?.[0]!.creation.adapterType, 3);
  assert.equal(mono.selectedPools?.[0]!.creation.token2022Mint, side === "base" ? addr(6) : addr(2));
  assert.ok(mono.plan.steps.length > 0, `prepared DLMM V1 mono with Token-2022 on ${side}`);
}
{
  const prepared = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
    creationBoundary: { source: "pumpswap-v1", token2022Side: "base" }, supportedAdapterVersionMasks: [0, 0, 0, 3],
    pools: [{ ...dlmmV1Pool, minDepthTo50BpsNative: 1_001n }], recipes: ["spot"] });
  const appends = prepared.next!.transaction.instructions.map(({ data }) => Buffer.from(data))
    .filter((data) => data[0] === 78 && data[1] === 1);
  assert.equal(appends.length, 1);
  assert.deepEqual([readU128(appends[0]!, 57), readU128(appends[0]!, 73)], [1n, 90n]);
}
const mixedV1Boundary = { creationBoundary: { source: "pumpswap-v1" as const, token2022Side: "base" as const },
  supportedAdapterVersionMasks: [0, 0, 0, 3] };
// Bound metadata base passes source binding; bounded PumpSwap + spot DLMM is one bounded group of two, refused typed before any payable step.
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  ...mixedV1Boundary, pools: [pumpswapV1Prepared.selectedPools![0]!, dlmmV1Pool],
}), code("CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT"));
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  ...mixedV1Boundary, pools: [{ ...pumpswapV1Prepared.selectedPools![0]!, pointOnly: true }, dlmmV1Pool], simulatedPointOnlyRing: true,
  temporalMode: "current-point" }), code("CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT"));
const missingDlmmMintBinding: MimirBetaEligiblePool = { ...dlmmV1Pool,
  creation: { ...dlmmV1Pool.creation, staticAccounts: dlmmV1Pool.creation.staticAccounts.slice(0, -1) } };
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  ...mixedV1Boundary, pools: [pumpswapV1Prepared.selectedPools![0]!, missingDlmmMintBinding],
}), code("PLAN_STALE"), "mixed creation rejects a DLMM binding without its bound Token-2022 mint account");
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  creationBoundary: { source: "pumpswap-v1", token2022Side: "base", registryVersionMask: 1 },
}), code("PLAN_STALE"));
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  creationBoundary: { source: "clmm-v1", token2022Side: "base", registryVersionMask: 1 },
}), code("PLAN_STALE"));
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  supportedAdapterVersionMasks: [3],
}), code("PLAN_STALE"), "version mask 3 remains invalid for an adapter without V1 support");
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  supportedAdapterVersionMasks: [0, 4],
}), code("PLAN_STALE"), "version mask bit 4 remains invalid");
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  creationBoundary: { source: "clmm-v1", token2022Side: "base", otherMintOwner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID },
}), code("ACCOUNT_OWNER_MISMATCH"));
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  creationBoundary: { source: "clmm-v1", token2022Side: "base", token2022Owner: addr(48) },
}), code("ACCOUNT_OWNER_MISMATCH"));
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  creationBoundary: { source: "classic", token2022Side: "base" },
}), code("ACCOUNT_OWNER_MISMATCH"));
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  creationBoundary: { source: "clmm-v1", token2022Side: "base", malformedTlv: true },
}), code("TOKEN_2022_POLICY_UNSUPPORTED"));

const fusedSimulationCapture = { addresses: [] as Address[],
  accounts: [] as Array<{ owner: Address; executable: boolean; lamports: bigint; data: Uint8Array } | null> };
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  simulationErr: { InstructionError: [8, { Custom: 33 }] },
}), (error: unknown) => error instanceof MimirBetaSimulationError && error.code === "SIMULATION_FAILED" &&
  error.rejection === "DISPERSION_TOO_WIDE" && error.customCode === 33 && error.instructionIndex === 8 &&
  error.programId === addr(10) && error.logs.length === 2);
{
  const mimir = "TYo5SEVfHyFzpjsbFVzNFKTnmLdBvdYjLxmnv32iQ9r", token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const err = { InstructionError: [4, { Custom: 14 }] };
  const direct = mimirBetaSimulationFailure(err, [`Program ${mimir} invoke [1]`,
    `Program ${mimir} failed: custom program error: 0xe`], mimir);
  assert.equal(direct.programId, mimir);
  assert.equal(direct.rejection, "STALE_SNAPSHOT");
  assert.equal(mimirBetaSimulationFailure({ InstructionError: [2, { Custom: 79 }] }, [`Program ${mimir} invoke [1]`,
    `Program ${mimir} failed: custom program error: 0x4f`], mimir).rejection, "INVALID_COMPOSITE_SNAPSHOT");
  const propagated = new MimirBetaSimulationError(mimirBetaSimulationFailure(err, [`Program ${mimir} invoke [1]`,
    `Program ${token} invoke [2]`, `Program ${token} failed: custom program error: 0xe`,
    `Program ${mimir} consumed 1000 of 1400000 compute units`, `Program ${mimir} failed: custom program error: 0xe`], mimir));
  assert.equal(propagated.programId, token);
  assert.equal(propagated.rejection, null);
  assert.equal(propagated.instructionIndex, 4);
  assert.equal(propagated.customCode, 14);
  assert.equal(propagated.message, "SIMULATION_FAILED:exact unsigned transaction simulation failed");
  assert.equal(propagated.logs.length, 5);
  assert.ok(Object.isFrozen(propagated));
  const earlier = mimirBetaSimulationFailure(err, [`Program ${token} invoke [1]`, `Program ${token} failed: custom program error: 0xe`,
    `Program ${mimir} invoke [1]`, `Program ${mimir} failed: custom program error: 0xe`], mimir);
  assert.equal(earlier.rejection, "STALE_SNAPSHOT");
  assert.equal(mimirBetaSimulationFailure(err, [], mimir).rejection, null);
}
{
  const mimir = "TYo5SEVfHyFzpjsbFVzNFKTnmLdBvdYjLxmnv32iQ9r", token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const ix = (programAddress: string, tag: number) => ({ programAddress, data: Uint8Array.of(tag) });
  const instructions = [ix(token, 1), ix(token, 1), ix(token, 1), ix(mimir, 81)];
  for (const err of [{ InstructionError: [3, { Custom: 65 }] }, { InstructionError: [3n, { Custom: 65n }] }]) {
    const failure = new MimirBetaSimulationError(mimirBetaSimulationFailure(err, [], mimir, instructions));
    assert.deepEqual([failure.instructionIndex, failure.customCode, failure.mimirTag, failure.outerProgramId], [3, 65, 81, mimir]);
    assert.equal(failure.message, "SIMULATION_FAILED:exact unsigned transaction simulation failed");
  }
  const foreign = mimirBetaSimulationFailure({ InstructionError: [1n, { Custom: 65n }] }, [], mimir, instructions);
  assert.deepEqual([foreign.customCode, foreign.mimirTag, foreign.outerProgramId], [65, null, token]);
  for (const err of [{ InstructionError: [3, "InvalidAccountData"] }, "AccountNotFound"]) {
    const failure = mimirBetaSimulationFailure(err, [], mimir, instructions);
    assert.equal(failure.customCode, null); assert.equal(failure.rejection, null);
  }
  const negative = mimirBetaSimulationFailure({ InstructionError: [-1, { Custom: 65 }] }, [], mimir, instructions);
  assert.deepEqual([negative.instructionIndex, negative.mimirTag, negative.outerProgramId], [null, null, null]);
}
{
  const mimir = "TYo5SEVfHyFzpjsbFVzNFKTnmLdBvdYjLxmnv32iQ9r", token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const outer = "6Ckm2BrnXxsSjyG5b17kQQRjoECVrts92RKXVGT8XeqS";
  const fail = (program: string, code: number) => `Program ${program} failed: custom program error: 0x${code.toString(16)}`;
  const cases: Array<[number, string[], string | null, string | null]> = [
    [14, [`Program ${mimir} invoke [1]`, fail(mimir, 14)], mimir, "STALE_SNAPSHOT"],
    [14, [`Program ${token} invoke [1]`, fail(token, 14)], token, null],
    [14, [`Program ${mimir} invoke [1]`, `Program ${token} invoke [2]`, fail(token, 14), fail(mimir, 14)], token, null],
    [14, [`Program ${outer} invoke [1]`, `Program ${token} invoke [2]`, fail(token, 14), `Program ${outer} success`,
      `Program ${mimir} invoke [1]`, fail(mimir, 14)], mimir, "STALE_SNAPSHOT"],
    [14, [`Program ${outer} invoke [1]`, `Program ${token} invoke [2]`, fail(token, 14), `Program ${outer} success`,
      `Program ${mimir} invoke [1]`], null, null],
    [14, [], null, null],
    [15, [`Program ${mimir} invoke [1]`, fail(mimir, 14)], mimir, null],
    [15, [`Program ${outer} invoke [1]`, `Program ${mimir} invoke [2]`, fail(mimir, 14), `Program ${token} invoke [2]`,
      fail(token, 15), fail(outer, 15)], token, null],
  ];
  for (const [code, logs, programId, rejection] of cases) {
    const error = new MimirBetaSimulationError(mimirBetaSimulationFailure({ InstructionError: [4, { Custom: code }] }, logs, mimir));
    assert.equal(error.programId, programId);
    assert.equal(error.rejection, rejection);
    assert.equal(error.instructionIndex, 4);
    assert.equal(error.customCode, code);
    assert.ok(Object.isFrozen(error));
  }
}
const onePoolClassic = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  simulationCapture: fusedSimulationCapture, simulatedRingLength: 544,
});
{
  const pool = onePoolClassic.selectedPools![0]!;
  const feedId = await deriveMimirBetaClassicFeedId(pool.baseMint, pool.quoteMint, 0);
  const [ring] = await deriveMimirBetaPda({ programId: addr(10), seed: "source_ring", values: [addressBytes(feedId), Uint8Array.of(0), Uint8Array.of(1, 0)] });
  const prefunded = await creationFixture(1, [governanceAuthority], "classic", addr(9), { simulatedRingLength: 544,
    prefundedAddresses: [(await deriveMimirBetaFeedPdas({ programId: addr(10), feedId })).twap[0], ring] });
  assert.equal(prefunded.plan.draftHash, onePoolClassic.plan.draftHash, "pre-funded reserved TWAP/ring placeholders stage the same plan");
  assert.ok(prefunded.next!.step.expectedWrites.every((write) => write.proof.kind !== "account" || (write.address !== ring && !write.description.includes("TWAP"))),
    "pre-funded placeholders stay unmodelled empty accounts");
}
assert.equal(onePoolClassic.selectedPools?.[0]!.minLiquidityNative, 2n);
const liveCapacityPool = { ...onePoolClassic.selectedPools![0]!, minLiquidityNative: 43_167_377n,
  minDepthTo50BpsNative: 107_783n };
const classicCollateralTariff = computeMimirBetaTickerTariff(5n, common.ticker);
const canonicalCreatorCollateralAta = await deriveAssociatedTokenAddress(creator, addr(14), addr(42));
const absentCollateralCalls = { blockhash: 0, simulation: 0 };
// Per-row classic recipe: explicit spot keeps the default draft; native-bounded refuses without authentic ready history, never falling back to spot.
{
  const spot = await creationFixture(1, [creator], "classic", addr(9), { recipes: ["spot"] });
  const defaulted = await creationFixture(1, [creator], "classic", addr(9));
  assert.equal(spot.plan.draftHash, defaulted.plan.draftHash);
  for (const recipes of [["native-bounded", "spot"], ["quiet"], ["native-bounded"]]) {
    await assert.rejects(creationFixture(1, [creator], "classic", addr(9), { recipes }), code("INVALID_ARGUMENT"));
  }
  await assert.rejects(creationFixture(1, [addr(5)], "classic", addr(9), { recipes: ["native-bounded"],
    creationBoundary: { source: "clmm-v1", token2022Side: "base" } }), code("PLAN_STALE"));
}
const absentCollateral = await creationFixture(1, [creator], "classic", addr(9), {
  allowCollateralFunding: true, collateralAccountMissing: true, preparationCalls: absentCollateralCalls,
}).catch((error: unknown) => error);
assert.ok(absentCollateral instanceof MimirBetaCollateralRequiredError);
assert.equal(absentCollateral.code, "COLLATERAL_REQUIRED");
assert.equal(absentCollateral.authority, creator);
assert.equal(absentCollateral.mint, addr(42));
assert.equal(absentCollateral.tokenAccount, canonicalCreatorCollateralAta);
assert.equal(absentCollateral.decimals, 6);
assert.equal(absentCollateral.requiredAmountRaw, classicCollateralTariff);
assert.equal(absentCollateral.balanceRaw, 0n);
assert.equal(absentCollateral.shortfallRaw, classicCollateralTariff);
assert.equal(absentCollateral.accountMissing, true);
assert.equal(absentCollateral.observedSlot, 5n);
assert.match(absentCollateral.draftHash, /^[0-9a-f]{64}$/);
assert.ok(Object.isFrozen(absentCollateral));
assert.equal(absentCollateral.resolvedVariant, 0);
assert.equal(absentCollateral.feedId, await deriveMimirBetaClassicFeedId(absentCollateral.selectedPools![0]!.baseMint, absentCollateral.selectedPools![0]!.quoteMint, 0));
assert.ok(Object.isFrozen(absentCollateral.selectedPools) && Object.isFrozen(absentCollateral.selectedPools![0]));
assert.deepEqual(absentCollateralCalls, { blockhash: 0, simulation: 0 }, "missing ATA preflight stops before blockhash and simulation");
const lowCollateralCalls = { blockhash: 0, simulation: 0 };
const lowCollateral = await creationFixture(1, [creator], "classic", addr(9), {
  allowCollateralFunding: true, collateralBalanceRaw: 0n, preparationCalls: lowCollateralCalls,
}).catch((error: unknown) => error);
assert.ok(lowCollateral instanceof MimirBetaCollateralRequiredError);
assert.equal(lowCollateral.balanceRaw, 0n);
assert.equal(lowCollateral.shortfallRaw, classicCollateralTariff);
assert.equal(lowCollateral.accountMissing, false);
assert.deepEqual(lowCollateralCalls, { blockhash: 0, simulation: 0 });
await assert.rejects(async () => creationFixture(1, [creator], "classic", addr(9), {
  estimateFundingCosts: true,
}), code("INVALID_ARGUMENT"), "cost estimation requires explicit SOL-only funding opt-in");
await assert.rejects(async () => creationFixture(1, [creator], "classic", addr(9), {
  fullCollateralPurchase: true,
}), code("INVALID_ARGUMENT"), "full purchase requires explicit SOL-only funding opt-in");
const unchangedFull = await creationFixture(1, [creator], "classic", addr(9), { allowCollateralFunding: true,
  fullCollateralPurchase: false });
assert.deepEqual(unchangedFull.next!.review.instructions,
  (await creationFixture(1, [creator], "classic", addr(9), { allowCollateralFunding: true })).next!.review.instructions);
// Caller prefix: a same-transaction credit covering the burn satisfies the full-purchase gate and leads the reviewed activation.
{
  const source = addr(48);
  const tokenData = (amount: bigint, owner = creator) => { const data = new Uint8Array(165); data.set(addressBytes(addr(42))); data.set(addressBytes(owner), 32);
    putU64(data, 64, amount); data[108] = 1; return data; };
  const prefix = (coversBurn: boolean, minimumCreditRaw = classicCollateralTariff) => ({ maxAuthorityDebitLamports: 0n,
    funding: { tokenAccount: canonicalCreatorCollateralAta, minimumCreditRaw, coversBurn },
    instructions: [{ programAddress: addr(14), data: Uint8Array.of(3), accounts: [{ address: creator, isSigner: true, isWritable: true },
      { address: source, isSigner: false, isWritable: true }, { address: canonicalCreatorCollateralAta, isSigner: false, isWritable: true }] }] });
  const funded = (callerPrefix: ReturnType<typeof prefix>, collateralBalanceRaw = 10n, fullCollateralPurchase = true) =>
    creationFixture(1, [creator], "classic", addr(9), { allowCollateralFunding: true, fullCollateralPurchase, callerPrefix, collateralBalanceRaw,
      nativeAccounts: [{ address: source, owner: addr(14), data: tokenData(100n, addr(49)) }],
      simulationAccountOverrides: new Map([[canonicalCreatorCollateralAta, { owner: addr(14), executable: false, lamports: 10n, data: tokenData(collateralBalanceRaw) }],
        [source, { owner: addr(14), executable: false, lamports: 10n, data: tokenData(100n - classicCollateralTariff, addr(49)) }]]) });
  const covered = await funded(prefix(true));
  assert.deepEqual(covered.next!.review.callerPrefix?.funding, { tokenAccount: canonicalCreatorCollateralAta, minimumCreditRaw: classicCollateralTariff, coversBurn: true });
  assert.equal(covered.next!.review.instructions[0]!.programAddress, addr(14));
  assert.equal(covered.next!.review.instructions.length, unchangedFull.next!.review.instructions.length + 1);
  const partial = await funded(prefix(false), 0n, false);
  assert.equal(partial.next!.review.callerPrefix?.funding?.coversBurn, false, "an empty burn source funded in the same transaction passes the balance gate");
  const uncovered = await funded(prefix(false)).catch((error: unknown) => error);
  assert.ok(uncovered instanceof MimirBetaCollateralRequiredError, "a full purchase still needs a credit declared to cover the burn");
  const short = await funded(prefix(false, classicCollateralTariff - 1n), 0n, false).catch((error: unknown) => error);
  assert.ok(short instanceof MimirBetaCollateralRequiredError, "balance plus declared credit must reach the tariff");
}
await assert.rejects(async () => creationFixture(1, [creator], "classic", addr(9), { ticker: "q" }),
  code("ONE_CHAR_ALLOWANCE_REQUIRED"), "absent allowance PDA is a zero count");
await assert.rejects(async () => creationFixture(1, [creator], "classic", addr(9), { ticker: "Q", oneCharAllowanceRemaining: 0n,
  collateralAccountMissing: true }), code("ONE_CHAR_ALLOWANCE_REQUIRED"));
await assert.rejects(async () => creationFixture(1, [creator], "composite", addr(9), { ticker: "Q" }),
  code("ONE_CHAR_ALLOWANCE_REQUIRED"), "composite root ticker requires an allowance");
const oneChar = await creationFixture(1, [creator], "classic", addr(9), { ticker: "Q", oneCharAllowanceRemaining: 1n,
  collateralAccountMissing: true });
const [oneCharAllowancePda] = await deriveMimirOneCharAllowancePda(addr(10), creator);
const oneCharActivation = oneChar.next!.review.instructions.find((instruction) => fromBase64(instruction.dataBase64)[0] === 80)!;
assert.equal(oneCharActivation.accounts[9]!.address, oneCharAllowancePda);
assert.equal(oneCharActivation.accounts[9]!.isWritable, true);
assert.equal(oneChar.next!.step.expectedWrites.some((write) => write.effect === "token-burn"), false);
assert.equal(oneChar.next!.step.expectedWrites.some((write) => write.address === addr(4)), false);
assert.ok(oneChar.next!.step.expectedWrites.some((write) => write.address === oneCharAllowancePda && write.effect === "write" &&
  write.dataLengthAfter === 26 && write.discriminatorHex === "4d494d4952314348"));
function oneCharAllowanceData(bump: number, remaining: bigint, revision: bigint) {
  const data = new Uint8Array(26); data.set(utf8("MIMIR1CH")); data[8] = 1; data[9] = bump;
  putU64(data, 10, remaining); putU64(data, 18, revision); return data;
}
async function identityProbePoststate(assets: readonly Address[], payerBalance = 30_000_000n, debitedAssets = assets.length) {
  const accounts = new Map<Address, { owner: Address; executable: boolean; lamports: bigint; data: Uint8Array }>();
  const identityTotal = 9_044_640n * BigInt(debitedAssets);
  const payerDebit = identityTotal + 5_000n * BigInt(debitedAssets + 1);
  accounts.set(creator, { owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false,
    lamports: payerBalance - payerDebit, data: new Uint8Array() });
  accounts.set(addr(12), { owner: MIMIR_BETA_MPL_CORE_PROGRAM_ID, executable: false, lamports: 10n, data: Uint8Array.of(1) });
  for (const identityAsset of assets) {
    const [agent] = await identityAdapter.deriveAgentAccount(identityAsset);
    accounts.set(identityAsset, { owner: MIMIR_BETA_MPL_CORE_PROGRAM_ID, executable: false,
      lamports: 2_947_680n, data: Uint8Array.of(1) });
    accounts.set(agent, { owner: addr(11), executable: false, lamports: 6_096_960n, data: new Uint8Array(748) });
  }
  return accounts;
}
for (const kind of ["classic", "composite"] as const) {
  for (const collateralBalanceRaw of [classicCollateralTariff * 1000n, classicCollateralTariff / 2n]) {
    const full = await creationFixture(1, [creator], kind, addr(9), {
      ...(kind === "composite" ? { componentCount: 2 } : {}), simulationAccountOverrides: await identityProbePoststate([asset]),
      allowCollateralFunding: true, estimateFundingCosts: true, fullCollateralPurchase: true, collateralBalanceRaw,
      fundingPayerLamports: 30_000_000n,
    }).catch((error: unknown) => error);
    assert.ok(full instanceof MimirBetaCollateralRequiredError, `${kind} ${String(full)}`);
    assert.equal(full.balanceRaw, collateralBalanceRaw);
    assert.equal(full.shortfallRaw, full.requiredAmountRaw);
    assert.ok(full.requiredAmountRaw > 0n && full.fundingCosts!.totalLamports > 0n);
  }
}
const onePoolCostCapture = { rentReads: 0, feeMessages: [] as string[] };
const onePoolCostOverrides = await identityProbePoststate([asset]);
const onePoolCost = await creationFixture(1, [creator], "classic", addr(9), {
  allowCollateralFunding: true, estimateFundingCosts: true, collateralBalanceRaw: 0n,
  fundingPayerLamports: 30_000_000n, fundingCollateralLamports: 1_016_500n, simulationAccountOverrides: onePoolCostOverrides,
  fundingCostCapture: onePoolCostCapture, fundingCostRpc: { feeValues: [12_345n] },
}).catch((error: unknown) => error);
assert.ok(onePoolCost instanceof MimirBetaCollateralRequiredError);
assert.equal(onePoolCost.fundingCosts?.identityLamports, 9_044_640n,
  "identity probe sums observed asset and agent account deltas, including Core protocol charge");
assert.equal(onePoolCost.fundingCosts?.networkFeeLamports, 12_345n + MIMIR_BETA_TRANSACTION_V1_MIN_PRIORITY_FEE_LAMPORTS, "message fee is not a fixed 5000-lamport assumption");
assert.equal(onePoolCost.fundingCosts?.protocolFeeLamports, 0n);
assert.equal(onePoolCost.fundingCosts?.totalLamports,
  onePoolCost.fundingCosts!.identityLamports + onePoolCost.fundingCosts!.accountRentLamports + 12_345n + MIMIR_BETA_TRANSACTION_V1_MIN_PRIORITY_FEE_LAMPORTS);
assert.equal(onePoolCost.fundingCosts?.observedSlot, 5n);
assert.ok(Object.isFrozen(onePoolCost.fundingCosts));
assert.ok(onePoolCost.fundingCosts!.accountRentLamports > 0n);
assert.ok(onePoolCost.fundingCosts!.accountRentLamports >= 1_128n * 100n, "fused Classic reserves transient proposal rent");
assert.equal(onePoolCostCapture.rentReads, 1, "rent sysvar is read once per estimate");
assert.equal(onePoolCostCapture.feeMessages.length, 1);
const missingOnePoolCostCapture = { rentReads: 0, feeMessages: [] as string[] };
const missingOnePoolCost = await creationFixture(1, [creator], "classic", addr(9), {
  allowCollateralFunding: true, estimateFundingCosts: true, collateralAccountMissing: true, collateralBalanceRaw: 0n,
  fundingPayerLamports: 30_000_000n, simulationAccountOverrides: await identityProbePoststate([asset]),
  fundingCostCapture: missingOnePoolCostCapture, fundingCostRpc: { feeValues: [12_345n] },
}).catch((error: unknown) => error);
assert.ok(missingOnePoolCost instanceof MimirBetaCollateralRequiredError);
assert.equal(missingOnePoolCost.code, "COLLATERAL_REQUIRED");
assert.equal(missingOnePoolCost.accountMissing, true);
assert.ok(missingOnePoolCost.fundingCosts!.totalLamports > 0n);
assert.equal(missingOnePoolCost.fundingCosts!.accountRentLamports, onePoolCost.fundingCosts!.accountRentLamports,
  "preceding swap owns canonical COLA ATA rent");
assert.equal(missingOnePoolCost.fundingCosts!.totalLamports, onePoolCost.fundingCosts!.totalLamports,
  "remaining Classic reserve matches the otherwise identical empty ATA");
await assert.rejects(async () => creationFixture(1, [creator], "classic", addr(9), {
  allowCollateralFunding: true, estimateFundingCosts: true, collateralBalanceRaw: 0n,
  fundingCostRpc: { missingFee: true },
}), code("CREATION_CONTEXT_REQUIRED"), "missing cost RPC fails closed");
await assert.rejects(async () => creationFixture(1, [creator], "classic", addr(9), {
  allowCollateralFunding: true, estimateFundingCosts: true, collateralBalanceRaw: 0n,
  fundingPayerLamports: 30_000_000n, simulationAccountOverrides: await identityProbePoststate([asset]),
  fundingCostRpc: { feeValues: [null] },
}), code("RPC_CONTEXT_MISMATCH"), "malformed fee response fails closed");
await assert.rejects(async () => creationFixture(1, [creator], "classic", addr(9), {
  allowCollateralFunding: true, estimateFundingCosts: true, collateralBalanceRaw: 0n,
  fundingPayerLamports: 30_000_000n, simulationAccountOverrides: await identityProbePoststate([asset]),
  fundingCostRpc: { feeValues: [(1n << 64n) - 1n] },
}), code("RPC_CONTEXT_MISMATCH"), "aggregate reserve overflow fails closed");
const noncanonicalMissing = await creationFixture(1, [creator], "classic", addr(9), {
  allowCollateralFunding: true, collateralAccountMissing: true, collateralAccountAddress: addr(4),
}).catch((error: unknown) => error);
assert.ok(noncanonicalMissing instanceof MimirBetaError);
assert.equal(noncanonicalMissing.code, "PDA_MISMATCH", "only canonical ATA absence is eligible for funding preflight");
for (const malformedCollateral of [
  { collateralDataLength: 164 },
  { collateralAuthorityOverride: addr(55) },
  { collateralMintOverride: addr(56) },
  { collateralTokenProgramOwner: addr(57) },
]) {
  await assert.rejects(() => creationFixture(1, [creator], "classic", addr(9), {
    allowCollateralFunding: true, ...malformedCollateral,
  }), (error: unknown) => error instanceof MimirBetaError &&
    (error.code === "ACCOUNT_MALFORMED" || error.code === "ACCOUNT_OWNER_MISMATCH"));
}
await assert.rejects(() => creationFixture(1, [creator], "classic", addr(9), {
  collateralAccountMissing: true,
}), code("CREATION_CONTEXT_REQUIRED"), "default missing-account behavior is unchanged");
const defaultLowBalanceCalls = { blockhash: 0, simulation: 0 };
const defaultLowBalance = await creationFixture(1, [creator], "classic", addr(9), {
  collateralBalanceRaw: 0n, preparationCalls: defaultLowBalanceCalls,
}).catch((error: unknown) => error);
assert.ok(defaultLowBalance instanceof MimirBetaError);
assert.equal(defaultLowBalance.code, "SIMULATION_FAILED", "default low balance keeps existing prepareReview validation");
assert.deepEqual(defaultLowBalanceCalls, { blockhash: 1, simulation: 0 },
  "default low balance keeps the existing prepareReview burn check");
const existingN2Pools: readonly MimirBetaEligiblePool[] = [liveCapacityPool, {
  ...liveCapacityPool, pool: addr(71), baseVault: addr(72), quoteVault: addr(73), descriptorId: "existing-source-1",
  descriptorHash: "d".repeat(64), canonicalPairKey: "existing-source-1", readPlan: { ...liveCapacityPool.readPlan,
    pool: addr(71), descriptorId: "existing-source-1", descriptorHash: "d".repeat(64), allAddresses: [addr(71)],
    auxiliary: [], planHash: "e".repeat(64) }, creation: { ...liveCapacityPool.creation,
      staticAccounts: [{ role: "base-vault", address: addr(72) }, { role: "quote-vault", address: addr(73) },
        { role: "pool", address: addr(71) }] }, evidenceHash: "f".repeat(64),
}];
const occupiedComponentPreflightCalls = { blockhash: 0, simulation: 0 };
const occupiedComponentPreflight = await creationFixture(1, [creator], "composite", addr(9), {
  componentCount: 2, compositeCreateClassicPool: liveCapacityPool,
  allowCollateralFunding: true, collateralAccountMissing: true, preparationCalls: occupiedComponentPreflightCalls,
}).catch((error: unknown) => error);
// A missing inline Classic plus the Composite create, tag-88 closure, and tag 87 exceed one TxV1: staged (ABI-1 2-tx launch), so the
// missing collateral account is what remains to resolve.
assert.ok(occupiedComponentPreflight instanceof MimirBetaCollateralRequiredError, String(occupiedComponentPreflight));
assert.deepEqual(occupiedComponentPreflightCalls, { blockhash: 0, simulation: 0 });
for (const variant of [undefined, 0, 7]) {
  const refused = await creationFixture(1, [creator], "composite", addr(9), {
    componentCount: 2, compositeCreateClassicPool: liveCapacityPool, allowCollateralFunding: true, collateralAccountMissing: true,
    ...(variant !== undefined ? { compositeCreateClassicVariant: variant } : {}) }).catch((error: unknown) => error);
  assert.ok(refused instanceof MimirBetaCollateralRequiredError, String(refused));
}
const existingCompositeCostCapture = { rentReads: 0, feeMessages: [] as string[] };
const existingCompositeCost = await creationFixture(1, [creator], "composite", addr(9), {
  componentCount: 2, allowCollateralFunding: true, estimateFundingCosts: true, collateralBalanceRaw: 0n,
  fundingPayerLamports: 30_000_000n, fundingCollateralLamports: 1_016_500n,
  simulationAccountOverrides: await identityProbePoststate([asset]),
  fundingCostCapture: existingCompositeCostCapture,
}).catch((error: unknown) => error);
assert.ok(existingCompositeCost instanceof MimirBetaCollateralRequiredError);
assert.equal(existingCompositeCost.fundingCosts?.identityLamports, 9_044_640n,
  "already existing component identities are excluded from the remaining identity probe");
assert.equal(existingCompositeCost.fundingCosts?.protocolFeeLamports, 4_001_000n,
  "N2 pays 0.8m to each current owner, 0.7m/component plus 1m to Treasury, and one 1k root refresh");
assert.ok(existingCompositeCost.fundingCosts!.accountRentLamports >= 460n * 100n, "Composite display-name metadata rent has one accounting owner");
const missingExistingCompositeCost = await creationFixture(1, [creator], "composite", addr(9), {
  componentCount: 2, allowCollateralFunding: true, estimateFundingCosts: true, collateralAccountMissing: true,
  collateralBalanceRaw: 0n, fundingPayerLamports: 30_000_000n,
  simulationAccountOverrides: await identityProbePoststate([asset]),
}).catch((error: unknown) => error);
assert.ok(missingExistingCompositeCost instanceof MimirBetaCollateralRequiredError);
assert.equal(missingExistingCompositeCost.code, "COLLATERAL_REQUIRED");
assert.equal(missingExistingCompositeCost.accountMissing, true);
assert.ok(missingExistingCompositeCost.fundingCosts!.totalLamports > 0n);
assert.equal(missingExistingCompositeCost.fundingCosts!.accountRentLamports,
  existingCompositeCost.fundingCosts!.accountRentLamports, "preceding swap owns canonical COLA ATA rent");
assert.equal(missingExistingCompositeCost.fundingCosts!.totalLamports, existingCompositeCost.fundingCosts!.totalLamports,
  "remaining Composite reserve matches the otherwise identical empty ATA");
const renewalPools = Array.from({ length: 5 }, (_, index): MimirBetaEligiblePool => ({
  ...liveCapacityPool, pool: addr(70 + index), baseVault: addr(80 + index), quoteVault: addr(90 + index),
  descriptorId: `renewal-${index}`, descriptorHash: (index + 1).toString(16).padStart(64, "0"),
  canonicalPairKey: `renewal-${index}`, evidenceHash: (index + 11).toString(16).padStart(64, "0"),
  readPlan: { ...liveCapacityPool.readPlan, pool: addr(70 + index), descriptorId: `renewal-${index}`,
    descriptorHash: (index + 1).toString(16).padStart(64, "0"), allAddresses: [addr(70 + index)],
    auxiliary: [], planHash: (index + 21).toString(16).padStart(64, "0") },
  creation: { ...liveCapacityPool.creation, staticAccounts: [
    { role: "base-vault", address: addr(80 + index) }, { role: "quote-vault", address: addr(90 + index) },
    { role: "pool", address: addr(70 + index) },
  ] },
}));
const fivePoolCostCapture = { rentReads: 0, feeMessages: [] as string[] };
const fivePoolCostFees = Array.from({ length: 12 }, (_, index) => BigInt(20_001 + index * 113));
const fivePoolCost = await creationFixture(1, [creator], "classic", addr(9), {
  pools: renewalPools, allowCollateralFunding: true, estimateFundingCosts: true, collateralBalanceRaw: 0n,
  fundingPayerLamports: 30_000_000n, simulationAccountOverrides: await identityProbePoststate([asset]),
  fundingCostCapture: fivePoolCostCapture, fundingCostRpc: { feeValues: fivePoolCostFees },
}).catch((error: unknown) => error);
assert.ok(fivePoolCost instanceof MimirBetaCollateralRequiredError);
assert.ok(fivePoolCost.fundingCosts!.accountRentLamports >= 2_696n * 100n, "five-pool Classic reserves its proposal allocation");
assert.ok(fivePoolCostCapture.feeMessages.length > 1, "remaining five-pool packets are quoted independently");
assert.equal(fivePoolCost.fundingCosts?.networkFeeLamports,
  fivePoolCostFees.slice(0, fivePoolCostCapture.feeMessages.length).reduce((sum, fee) => sum + fee + MIMIR_BETA_TRANSACTION_V1_MIN_PRIORITY_FEE_LAMPORTS, 0n));
for (let count = 1; count <= 5; count += 1) {
  const calls = { count: 0 };
  const pools = renewalPools.slice(0, count);
  const prior = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
    pools, freshEvidenceSlot: 20n, preserveDraftPoolEvidence: true, revalidationCalls: calls,
  });
  const renewed = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
    pools, freshEvidenceSlot: 21n, preserveDraftPoolEvidence: true, revalidationCalls: calls,
  });
  assert.equal(calls.count, 2, `Classic N=${count} revalidates both preparations`);
  assert.equal(renewed.canonicalDraftJson, prior.canonicalDraftJson);
  assert.equal(renewed.draftHash, prior.draftHash);
  assert.deepEqual(renewed.selectedPools, pools);
  assert.deepEqual(renewed.next!.review.instructions, prior.next!.review.instructions);
  assert.deepEqual(renewed.next!.step.expectedWrites, prior.next!.step.expectedWrites);
}
const floorDriftPrior = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  pools: renewalPools.slice(0, 2), freshEvidenceSlot: 20n, freshFloorDrift: true, preserveDraftPoolEvidence: true,
});
const floorDriftRenewed = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  pools: renewalPools.slice(0, 2), freshEvidenceSlot: 21n, freshFloorDrift: true, preserveDraftPoolEvidence: true,
});
assert.equal(floorDriftRenewed.draftHash, floorDriftPrior.draftHash);
assert.deepEqual(floorDriftRenewed.next!.review.instructions, floorDriftPrior.next!.review.instructions);
assert.deepEqual(floorDriftRenewed.selectedPools, renewalPools.slice(0, 2));
const defaultRenewalPrior = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  pools: renewalPools.slice(0, 2), freshEvidenceSlot: 20n,
});
const defaultRenewalNext = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  pools: renewalPools.slice(0, 2), freshEvidenceSlot: 21n, preserveDraftPoolEvidence: false,
});
assert.notEqual(defaultRenewalNext.draftHash, defaultRenewalPrior.draftHash,
  "omitted/false keeps fresh observation evidence in the draft");
const existingSentinelWire = { value: null as string | null };
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2,
  existingSentinelPools: existingN2Pools, compositeCreateClassicPool: { ...liveCapacityPool, baseMint: addr(74) },
  missingExistingDiscovery: true }), code("PLAN_STALE"));
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2,
  existingSentinelPools: existingN2Pools, compositeCreateClassicPool: { ...liveCapacityPool, baseMint: addr(74) },
  existingSentinelHeaderMismatch: true }), code("PLAN_STALE"));
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2,
  existingSentinelPools: existingN2Pools, compositeCreateClassicPool: { ...liveCapacityPool, baseMint: addr(74) },
  useExistingSentinelConversion: true, simulationWire: existingSentinelWire,
  supportedAdapterVersionMasks: [0, 3, 0, 0, 0, 0, 3, 0] }), /SourceConfig0/, "the CFC converter witness must be the converter feed's SourceConfig0");
const driftQueries: string[] = []; const driftCalls = { query: "", maxPools: 0, maxInFlight: 0 };
const driftWire = { value: null as string | null };
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2,
  existingSentinelPools: existingN2Pools, compositeCreateClassicPool: { ...liveCapacityPool, baseMint: addr(74) },
  useExistingSentinelConversion: true, simulationWire: driftWire, discoveryQueries: driftQueries, discoveryCalls: driftCalls,
  blankDiscoveryWinner: { ...existingN2Pools[0]!, pool: addr(299) },
  supportedAdapterVersionMasks: [0, 3, 0, 0, 0, 0, 3, 0] }), /SourceConfig0/,
"a drifted blank-query winner does not displace the bound existing sources");
assert.ok(driftQueries.length >= existingN2Pools.length && !driftQueries.includes(""), "existing closures never issue blank lookups");
assert.deepEqual(driftQueries, existingN2Pools.map(({ pool }) => pool),
  "both source closures coalesce the same exact searches in source-index order");
assert.equal(driftCalls.maxPools, 1);
assert.equal(driftCalls.maxInFlight, existingN2Pools.length, "exact source searches of one feed run concurrently");
const exactBase = { componentCount: 2 as const, existingSentinelPools: existingN2Pools,
  compositeCreateClassicPool: { ...liveCapacityPool, baseMint: addr(74) } };
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { ...exactBase,
  exactDiscoveryError: new MimirBetaError("NO_ELIGIBLE_POOLS", "no pools") }),
(error: unknown) => error instanceof MimirBetaError && error.code === "PLAN_STALE" &&
  error.message.includes("existing source 0 has no unique exact discovered pool"));
for (const passthrough of [new MimirBetaError("RPC_CONTEXT_MISMATCH", "context"), new Error("discovery busy")]) {
  await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { ...exactBase, exactDiscoveryError: passthrough }),
    (error: unknown) => error === passthrough, "busy/network/context failures keep their identity");
}
for (const substitute of [
  (pool: MimirBetaEligiblePool) => ({ ...pool, pool: addr(298) }),
  (pool: MimirBetaEligiblePool) => ({ ...pool, programId: addr(297) }),
  (pool: MimirBetaEligiblePool) => ({ ...pool, quoteVault: addr(296) }),
  (pool: MimirBetaEligiblePool) => ({ ...pool, creation: { ...pool.creation, adapterType: 1 as const } }),
  (pool: MimirBetaEligiblePool) => ({ ...pool, creation: { ...pool.creation, vaultAuthority: addr(295) } }),
  (pool: MimirBetaEligiblePool) => ({ ...pool, eligibility: "ineligible" }) as unknown as MimirBetaEligiblePool,
]) {
  await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { ...exactBase, exactDiscoverySubstitute: substitute }),
    code("PLAN_STALE"), "a substituted exact-search result is never accepted");
}
const freshConversionWire = { value: null as string | null };
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2,
  existingSentinelPools: existingN2Pools, compositeCreateClassicPool: { ...liveCapacityPool, baseMint: addr(74) },
  useFreshClassicConversion: true, simulationWire: freshConversionWire }), code("CLASSIC_CONVERTER_UNSUPPORTED"));
assert.equal(freshConversionWire.value, null, "an unadmitted composite converter is refused before any instruction is built");
const staleAtomicWire = { value: null as string | null };
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2,
  existingSentinelPools: existingN2Pools, compositeCreateClassicPool: { ...liveCapacityPool, baseMint: addr(74) },
  existingAtomicStale: true, simulationWire: staleAtomicWire }), /captured activation simulation/);
assert.deepEqual(decodeMimirInstructions(staleAtomicWire.value!, addr(10)).filter(({ data }) => data[0] === 81 || data[0] === 87 || data[0] === 88).map(({ data }) => data[0]),
  [81], "staged tx 1 ends at tag 81; the tag-88 closure is composite:execution");
const liveCapacityClassic = await creationFixture(1, [governanceAuthority], "classic", addr(9), { pools: [liveCapacityPool] });
assert.equal(liveCapacityPool.minLiquidityNative, 43_167_377n, "input evidence is not mutated");
const cpmmProgram = addr(61); const cpmmPoolAddress = addr(62);
const [cpmmObservation] = await deriveMimirBetaPda({ programId: cpmmProgram, seed: "observation",
  values: [addressBytes(cpmmPoolAddress)] });
const cpmmPool: MimirBetaEligiblePool = { ...liveCapacityPool, family: "raydium-cpmm", programId: cpmmProgram,
  pool: cpmmPoolAddress, descriptorId: "cpmm-actual-tail", canonicalPairKey: "cpmm-actual-tail",
  creation: { ...liveCapacityPool.creation, adapterType: 2, bindingVariant: "direct",
    staticAccounts: [{ role: "base-vault", address: addr(32) }, { role: "quote-vault", address: addr(33) },
      { role: "pool", address: cpmmPoolAddress }, { role: "amm-config", address: addr(34) }],
    observationState: cpmmObservation } };
const cpmmNativeConversionWire = { value: null as string | null };
const [cpmmConversionObservation] = await deriveMimirBetaPda({ programId: cpmmProgram, seed: "observation", values: [addressBytes(addr(205))] });
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, useCanonicalSolConversion: true,
  canonicalSolConversionPool: (pool) => ({ ...pool, family: "raydium-cpmm", programId: cpmmProgram, creation: { ...pool.creation, adapterType: 2,
    staticAccounts: [...pool.creation.staticAccounts, { role: "amm-config", address: addr(34) }], observationState: cpmmConversionObservation } }),
  converterRecipes: ["native-bounded"], simulationWire: cpmmNativeConversionWire }),
(error: unknown) => error instanceof MimirBetaError && error.code === "CLASSIC_CONVERTER_UNSUPPORTED" && error.message.includes("adapter 2 v0 mode 2"));
assert.equal(cpmmNativeConversionWire.value, null, "a CPMM-native SOL conversion row is refused before any instruction is built");
const staleCpmmObservation = new Uint8Array(4_075); { const v = new DataView(staleCpmmObservation.buffer);
  staleCpmmObservation.set([122, 174, 197, 53, 129, 9, 165, 132]); staleCpmmObservation[8] = 1; v.setUint16(9, 1, true);
  staleCpmmObservation.set(addressBytes(cpmmPoolAddress), 11); v.setBigUint64(43, 880n, true); v.setBigUint64(83, 895n, true); v.setBigUint64(4_043, 900n, true); }
const cpmmDefaultWire = { value: null as string | null };
const cpmmDefault = await creationFixture(1, [governanceAuthority], "classic", addr(9), { pools: [cpmmPool], simulationWire: cpmmDefaultWire, recipes: ["native-bounded"],
  allowCollateralFunding: true, nativeAccounts: [{ address: cpmmObservation, owner: cpmmProgram, data: staleCpmmObservation }] }).then(() => null, (error: unknown) => error);
assert.ok(cpmmDefault instanceof MimirClassicNativeNotReadyError && cpmmDefault.readiness.observation === cpmmObservation,
  "an explicit native-bounded CPMM recipe with a not-ready history is refused before funding or any instruction");
const cpmmOmittedWire = { value: null as string | null };
const cpmmOmitted = await creationFixture(1, [governanceAuthority], "classic", addr(9), { pools: [cpmmPool], simulationWire: cpmmOmittedWire,
  allowCollateralFunding: true, nativeAccounts: [{ address: cpmmObservation, owner: cpmmProgram, data: staleCpmmObservation }] }).then(() => null, (error: unknown) => error);
assert.ok(cpmmOmitted instanceof Error && /captured activation simulation/.test(cpmmOmitted.message),
  "an omitted single-pool CPMM recipe is spot: a not-ready native history is not consulted and creation reaches the exact simulation");
assert.deepEqual(decodeMimirInstructions(cpmmOmittedWire.value!).find(({ data }) => data[0] === 89)!.accounts.slice(3),
  cpmmPool.creation.staticAccounts.map(({ address }) => address), "omitted CPMM recipe = spot tag89 over the four static roles");
const cpmmExplicitDual = await creationFixture(1, [governanceAuthority], "classic", addr(9), { pools: [cpmmPool], recipes: ["dual-native-point"],
  simulationWire: { value: null as string | null }, allowCollateralFunding: true,
  nativeAccounts: [{ address: cpmmObservation, owner: cpmmProgram, data: staleCpmmObservation }] }).then(() => null, (error: unknown) => error);
assert.ok(cpmmExplicitDual instanceof Error && /captured activation simulation/.test(cpmmExplicitDual.message), "an explicit DUAL CPMM recipe is still honoured");
assert.equal(cpmmDefaultWire.value, null);
const cpmmWire = { value: null as string | null };
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9),
  { pools: [cpmmPool], recipes: ["spot"], simulationWire: cpmmWire }), /captured activation simulation/);
const cpmmRefresh = decodeMimirInstructions(cpmmWire.value!).find(({ data }) => data[0] === 89)!;
assert.deepEqual(cpmmRefresh.accounts.slice(3),
  cpmmPool.creation.staticAccounts.map(({ address }) => address),
  "prepareSimpleFeed CPMM spot tag89 uses exactly four canonical static roles");
const existingCpmmFeedId = await deriveMimirBetaClassicFeedId(cpmmPool.baseMint, cpmmPool.quoteMint);
const [existingCpmmSourceConfig] = await deriveMimirBetaPda({ programId: addr(10), seed: "source_config",
  values: [addressBytes(existingCpmmFeedId), Uint8Array.of(0)] });
const existingCpmmWire = { value: null as string | null };
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, componentRecipes: ["spot", "spot"],
  existingSentinelPools: [cpmmPool], existingAtomicStale: true, slot: 1000n, simulationWire: existingCpmmWire,
}), /captured activation simulation/);
// Omitted recipe on a single-source CPMM v0 component: the 4-role spot projection, no DUAL row; an explicit DUAL recipe seals DUAL_NATIVE_POINT_V1.
const existingOmittedWire = { value: null as string | null };
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2,
  existingSentinelPools: [cpmmPool], existingAtomicStale: true, slot: 1000n, simulationWire: existingOmittedWire }), /captured activation simulation/);
{
  const seal = decodeMimirInstructions(existingOmittedWire.value!).find(({ data }) => data[0] === 88 && data[1] === 2)!;
  assert.deepEqual(Array.from({ length: seal.data[34]! }, (_, r) => `${seal.data[36 + 16 * r + 3]}.${seal.data[36 + 16 * r + 2]}`).filter((k) => k.startsWith("6.")), [],
    "an omitted CPMM component recipe seals no DUAL row");
  assert.equal(decodeMimirInstructions(existingOmittedWire.value!).at(-1)!.accounts.includes(cpmmObservation), false, "spot projection: no Observation tail");
}
const coldCpmmObservation = new Uint8Array(4_075); coldCpmmObservation.set([122, 174, 197, 53, 129, 9, 165, 132]); coldCpmmObservation.set(addressBytes(cpmmPoolAddress), 11);
const existingDualWire = { value: null as string | null };
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, componentRecipes: ["dual-native-point", null],
  existingSentinelPools: [cpmmPool], existingAtomicStale: true, slot: 1000n, simulationWire: existingDualWire,
  nativeAccounts: [{ address: cpmmObservation, owner: cpmmProgram, data: coldCpmmObservation }] }), /captured activation simulation/);
{
  const decoded = decodeMimirInstructions(existingDualWire.value!);
  const seal = decoded.find(({ data }) => data[0] === 88 && data[1] === 2)!;
  assert.deepEqual(Array.from({ length: seal.data[34]! }, (_, r) => `${seal.data[36 + 16 * r + 3]}.${seal.data[36 + 16 * r + 2]}`).filter((k) => k === "6.7"), ["6.7"],
    "the CPMM component row is sealed DUAL_NATIVE_POINT_V1 (temporal kind 6, E7)");
  const at = seal.accounts.indexOf(existingCpmmSourceConfig);
  assert.deepEqual(seal.accounts.slice(at + 3, at + 7), cpmmPool.creation.staticAccounts.map(({ address }) => address), "static SEAL keeps the K4 prefix");
  const publish = decoded.at(-1)!;
  assert.ok(publish.accounts.includes(cpmmObservation) && publish.accounts.at(-1) === "Sysvar1nstructions1111111111111111111111111", "tag 87 carries E7 and the Instructions sysvar");
}
// Fresh Composite over an existing CPMM component: no readiness tag 77; tag 88 seals the 4-role spot projection and tag 87 publishes.
const fusedTags = (wire: string) => decodeMimirInstructions(wire).map(({ data }) => data[0] === 88 ? `88.${data[1]}` : String(data[0]));
for (const wire of [existingCpmmWire]) {
  const decoded = decodeMimirInstructions(wire.value!);
  assert.ok(!decoded.some(({ data, accounts }) => data[0] === 77 && accounts[2] === existingCpmmSourceConfig), "no canonical CPMM ring writer");
  assert.deepEqual(fusedTags(wire.value!).slice(-3), ["88.0", "88.2", "87"]);
  const seal = decoded.find(({ data }) => data[0] === 88 && data[1] === 2)!;
  const at = seal.accounts.indexOf(existingCpmmSourceConfig);
  assert.deepEqual(seal.accounts.slice(at + 3, at + 7), cpmmPool.creation.staticAccounts.map(({ address }) => address));
  const publish = decoded.at(-1)!;
  assert.ok(cpmmPool.creation.staticAccounts.every(({ address }) => publish.accounts.includes(address)));
  assert.ok(!publish.accounts.includes(cpmmObservation), "the fused CPMM component is spot-only");
}
const existingAuthenticatedCpmmWire = { value: null as string | null };
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, componentRecipes: ["spot", "spot"],
  existingSentinelPools: [cpmmPool], existingAtomicStale: true, existingAuthenticated: true, slot: 1000n,
  simulationWire: existingAuthenticatedCpmmWire,
}), /captured activation simulation/);
assert.deepEqual(decodeMimirInstructions(existingAuthenticatedCpmmWire.value!).at(-1)!.accounts,
  decodeMimirInstructions(existingCpmmWire.value!).at(-1)!.accounts, "native-window ring state does not change the fused spot projection");
const ringlessCpmmWire = { value: null as string | null };
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, componentRecipes: ["spot", "spot"],
  existingSentinelPools: [cpmmPool], existingAtomicStale: true, slot: 1000n, simulationWire: ringlessCpmmWire, omitExistingRings: true,
}), /captured activation simulation/);
assert.deepEqual(decodeMimirInstructions(ringlessCpmmWire.value!), decodeMimirInstructions(existingCpmmWire.value!),
  "a component without public source rings builds the same Composite activation");
for (const [authenticated, label] of [[false, "windowFlags 0"], [true, "windowFlags 2"]] as const) {
  const fundedRingWire = { value: null as string | null };
  await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, componentRecipes: ["spot", "spot"],
    existingSentinelPools: [cpmmPool], existingAtomicStale: true, slot: 1000n, simulationWire: fundedRingWire,
    existingRingOwner: MIMIR_BETA_SYSTEM_PROGRAM_ID, existingDammRingLamports: 5_000_000n, ...(authenticated ? { existingAuthenticated: true } : {}),
  }), /captured activation simulation/);
  assert.deepEqual(decodeMimirInstructions(fundedRingWire.value!), decodeMimirInstructions(ringlessCpmmWire.value!),
    `a lamport-funded empty System source ring loads as absent (${label} sibling)`);
}
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, componentRecipes: ["spot", "spot"],
  existingSentinelPools: [cpmmPool], existingAtomicStale: true, slot: 1000n, existingRingOwner: addr(99),
}), code("ACCOUNT_MALFORMED"), "a foreign-owned source ring is still refused");
assert.deepEqual(liveCapacityClassic.selectedPools!.map(({ minLiquidityNative, minDepthTo50BpsNative }) =>
  ({ minLiquidityNative, minDepthTo50BpsNative })), [{ minLiquidityNative: 43_167_378n, minDepthTo50BpsNative: 107_783n }],
"selected revalidation evidence remains raw");
const liveCapacityAppend = fromBase64(liveCapacityClassic.next!.review.instructions[3]!.dataBase64);
assert.deepEqual([...liveCapacityAppend.subarray(0, 2)], [78, 1]);
assert.equal(readU128(liveCapacityAppend, 57), 1n);
assert.equal(readU128(liveCapacityAppend, 73), 9_700n);
await provePreparedNext(onePoolClassic);
assert.deepEqual(onePoolClassic.plan.steps.map((step) => ({ id: step.stepId, ordinal: step.ordinal,
  prerequisites: step.prerequisiteStepIds, signers: step.requiredSigners })), [
  { id: "classic:activate", ordinal: 0, prerequisites: [], signers: [creator, asset] },
]);
assert.equal(onePoolClassic.next!.transaction.instructions.length, 8);
assert.equal(onePoolClassic.next!.transaction.packet.instructionCount, 8);
assert.equal(onePoolClassic.next!.transaction.packet.signatureCount, 2);
assert.ok(onePoolClassic.next!.step.expectedWrites.every((write) => !write.description.includes("source ring")));
assert.equal(onePoolClassic.next!.step.expectedWrites.find((write) => write.description.includes("first fused classic snapshot"))
  ?.dataLengthAfter, 512, "spot classic publishes its first snapshot through tag 89");
const spotOnlyDammClassic = await creationFixture(1, [governanceAuthority], "classic", addr(9));
assert.ok(spotOnlyDammClassic.next!.step.expectedWrites.every((write) => !write.description.includes("source ring")),
  "nonqualified DAMM leaves the public source ring unallocated");
assert.deepEqual(onePoolClassic.next!.transaction.requiredSigners, [creator, asset]);
const fusedData = onePoolClassic.next!.review.instructions.map((instruction) => fromBase64(instruction.dataBase64));
assert.deepEqual([...fusedData[2]!.subarray(0, 2)], [78, 2]);
assert.deepEqual([...fusedData[3]!.subarray(0, 2)], [78, 1]);
assert.deepEqual([...fusedData[4]!], [80, 5, 77, 73, 77, 73, 82, 0, 0, 0, 0, 0, 0]);
assert.deepEqual([...fusedData[5]!.subarray(0, 2), ...fusedData[6]!.subarray(0, 2), fusedData[7]![0]], [90, 0, 90, 2, 89]);
assert.equal(onePoolClassic.plan.ticker, common.ticker); assert.equal(onePoolClassic.next!.review.ticker, common.ticker);
assert.equal(onePoolClassic.next!.review.instructions[2]!.accounts.length, 7);
const fusedActivationAccounts = onePoolClassic.next!.review.instructions[4]!.accounts.map(({ address }) => address);
assert.deepEqual(fusedActivationAccounts.slice(9, 12), [addr(4), addr(42), addr(14)]);
const [expectedAgent] = await identityAdapter.deriveAgentAccount(asset);
const [expectedRoot] = await identityAdapter.deriveRootConfig();
assert.deepEqual(fusedActivationAccounts.slice(-4), [expectedAgent, expectedRoot, addr(12), asset]);
const fusedBurn = onePoolClassic.next!.step.expectedWrites.filter((write) => write.proof.kind === "spl-token-burn-checked");
assert.equal(fusedBurn.length, 1);
assert.equal(fusedBurn[0]!.proof.kind === "spl-token-burn-checked" ? fusedBurn[0]!.proof.outerInstructionIndex : -1, 4);
const onePoolProposal = JSON.parse(onePoolClassic.canonicalDraftJson).proposal as Address;
assert.equal(onePoolClassic.next!.step.expectedWrites.some((write) => write.address === onePoolProposal), false,
  "transient proposal is excluded from net final writes");
const proposalTombstone = { owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false, lamports: 0n, data: new Uint8Array() };
const tombstonePrepared = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  simulationAccountOverrides: new Map([[onePoolProposal, proposalTombstone]]),
});
assert.ok(tombstonePrepared.next, "an exact Agave closed-account tombstone completes fused preparation");
for (const invalid of [
  { ...proposalTombstone, lamports: 1n },
  { ...proposalTombstone, owner: addr(99) },
  { ...proposalTombstone, data: Uint8Array.of(1) },
  { ...proposalTombstone, executable: true },
]) {
  await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
    simulationAccountOverrides: new Map([[onePoolProposal, invalid]]),
  }), (error: unknown) => error instanceof MimirBetaError && error.code === "SIMULATION_FAILED" &&
    error.message.includes("transient proposal must be absent"));
}
const classicCollateralLock = onePoolClassic.next!.step.expectedWrites.find((write) => write.description === "create collateral lock")!;
{
  const a = (onePoolClassic as { consumerAdmission?: import("../src/beta/abi1Release.js").MimirConsumerAdmissionV1 }).consumerAdmission!;
  assert.match(a.cell, /^classic:N1S0:/); assert.equal(a.witness, null);
  assert.ok(a.initializer!.instructions >= 3 && a.freshCreation!.keys > 0 && !a.admitted && a.reasons.includes("UNKNOWN_CU"), "classic tag-90/89 creation carries the A2 admission");
}
const onePoolReceipt = await signedStageReceipt(onePoolClassic.next!);
const onePoolSignatureBytes = Uint8Array.from(bs58.decode(onePoolReceipt.signature));
const onePoolSignedBytes = onePoolClassic.next!.transaction.serializedTransaction.slice();
onePoolSignedBytes.set(onePoolSignatureBytes, onePoolClassic.next!.transaction.serializedMessage.length);
onePoolSignedBytes.set(new Uint8Array(64).fill(113), onePoolClassic.next!.transaction.serializedMessage.length + 64);
const onePoolMessage = getCompiledTransactionMessageDecoder().decode(onePoolClassic.next!.transaction.serializedMessage);
assert.equal(onePoolMessage.version, 1);
if (onePoolMessage.version !== 1) throw new Error("expected TxV1");
const onePoolAccountProofs = new Map(onePoolClassic.next!.step.expectedWrites.flatMap((write) =>
  write.proof.kind === "account" ? [[write.address, write.proof] as const] : []));
const onePoolPreBalances = onePoolMessage.staticAccounts.map((address, index) => index === 0 ? 100n : onePoolAccountProofs.get(address)?.before.lamports ?? 10n);
const onePoolPostBalances = onePoolMessage.staticAccounts.map((address, index) => {
  const after = onePoolAccountProofs.get(address)?.after;
  return after ? after.exists ? after.lamports : 0n : onePoolPreBalances[index]!;
});
const nonPayerDelta = onePoolPostBalances.slice(1).reduce((sum, balance, index) =>
  sum + balance - onePoolPreBalances[index + 1]!, 0n);
onePoolPostBalances[0] = onePoolPreBalances[0]! - nonPayerDelta - 1n;
const onePoolBurn = fusedBurn[0]!.proof;
if (onePoolBurn.kind !== "spl-token-burn-checked") throw new Error("expected fused BurnChecked proof");
const onePoolBurnData = new Uint8Array(10); onePoolBurnData[0] = 15;
putU64(onePoolBurnData, 1, onePoolBurn.amountRaw); onePoolBurnData[9] = onePoolBurn.decimals;
const onePoolCoreProofs = ["mpl-core-asset-v1", "mpl-core-collection-v1"].map((codec) => [...onePoolAccountProofs].find(([, proof]) =>
  proof.after.exists && proof.after.data.kind === "sdk-codec" && proof.after.data.codec === codec)!);
const onePoolCoreAccounts = onePoolCoreProofs.map(([address]) => onePoolMessage.staticAccounts.indexOf(address));
const onePoolCoreProgramIndex = onePoolMessage.staticAccounts.indexOf((onePoolCoreProofs[0]![1].after as { owner: Address }).owner);
const onePoolRawOf = (signedBytes: Uint8Array) => ({
  slot: Number(compositeFinalizedSlot), blockTime: Number(compositeFinalizedBlockTime), version: 1,
  transaction: [base64(signedBytes), "base64"], meta: {
    err: null, fee: 1, preBalances: onePoolPreBalances.map(Number), postBalances: onePoolPostBalances.map(Number),
    preTokenBalances: [{ accountIndex: onePoolMessage.staticAccounts.indexOf(onePoolBurn.sourceTokenAccount), mint: onePoolBurn.mint,
      owner: onePoolBurn.authority, programId: onePoolBurn.tokenProgram,
      uiTokenAmount: { amount: "10", decimals: onePoolBurn.decimals } }],
    postTokenBalances: [{ accountIndex: onePoolMessage.staticAccounts.indexOf(onePoolBurn.sourceTokenAccount), mint: onePoolBurn.mint,
      owner: onePoolBurn.authority, programId: onePoolBurn.tokenProgram,
      uiTokenAmount: { amount: "9", decimals: onePoolBurn.decimals } }],
    loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [{ index: onePoolBurn.outerInstructionIndex,
      instructions: [{ programIdIndex: onePoolMessage.staticAccounts.indexOf(onePoolBurn.tokenProgram),
        accounts: [onePoolMessage.staticAccounts.indexOf(onePoolBurn.sourceTokenAccount),
          onePoolMessage.staticAccounts.indexOf(onePoolBurn.mint), onePoolMessage.staticAccounts.indexOf(onePoolBurn.authority)],
        data: bs58.encode(onePoolBurnData) }] }, { index: 0, instructions: [{ programIdIndex: onePoolCoreProgramIndex,
        accounts: onePoolCoreAccounts, data: bs58.encode(Uint8Array.of(20)) }] }],
  },
});
const onePoolFinalizedOf = (signature: string, signedBytes: Uint8Array) => decodeMimirBetaFinalizedTransactionResponse(signature, onePoolRawOf(signedBytes));
const onePoolFinalized = onePoolFinalizedOf(onePoolReceipt.signature, onePoolSignedBytes);
assert.ok(onePoolFinalized);
const onePoolProofAddresses = [...new Set(onePoolClassic.next!.step.expectedWrites.map((write) => write.address))];
const finalizedOnePoolAccounts = onePoolProofAddresses.map((address) => {
  const index = fusedSimulationCapture.addresses.indexOf(address); const account = fusedSimulationCapture.accounts[index];
  assert.ok(account, `missing fused simulation account ${address}`);
  const data = account.data.slice(); const codecProof = onePoolAccountProofs.get(address);
  const codec = codecProof?.after.exists && codecProof.after.data.kind === "sdk-codec" ? codecProof.after.data.codec : null;
  if (codec === "feed-snapshot-v0") { putU64(data, 116, compositeFinalizedSlot); putU64(data, 124, compositeFinalizedSlot + 20n);
    putU64(data, 140, compositeFinalizedSlot); putU64(data, 148, compositeFinalizedSlot); }
  if (codec === "source-ring-v1") { putU64(data, 64, compositeFinalizedSlot); putU64(data, 72, compositeFinalizedSlot);
    putU64(data, 448, compositeFinalizedSlot); }
  return { address, ...account, lamports: onePoolPostBalances[onePoolMessage.staticAccounts.indexOf(address)]!,
    data: address === classicCollateralLock.address ? collateralLockData(compositeFinalizedSlot, compositeFinalizedBlockTime) : data };
});
const verifyOnePool = (accounts = finalizedOnePoolAccounts) => verifyMimirBetaFinalizedReceiptEvidence({ receipt: onePoolReceipt,
  preparedStep: onePoolClassic.next!, transaction: onePoolFinalized,
  postAccounts: { slot: compositeFinalizedSlot, addresses: onePoolProofAddresses, value: accounts } });
const onePoolObservation = await verifyOnePool();
assert.equal(onePoolObservation.state, "finalized");
{
  const prepared = onePoolClassic.next!;
  const walletMessage = feeOnlyRewrite(prepared.transaction.serializedMessage);
  const signatureBytes = new Uint8Array(await webcrypto.subtle.sign("Ed25519", receiptPayerKeys.privateKey, walletMessage));
  const receipt = createMimirBetaStageReceipt({ preparedStep: prepared, signature: bs58.encode(signatureBytes), attempt: 1,
    retryOfSignature: null, signedMessage: walletMessage });
  await authenticateMimirBetaReviewedStep(receipt);
  const signed = Uint8Array.from([...walletMessage, ...signatureBytes, ...new Uint8Array(64).fill(113)]);
  const observed = await verifyMimirBetaFinalizedReceiptEvidence({ receipt, preparedStep: prepared,
    transaction: onePoolFinalizedOf(receipt.signature, signed)!,
    postAccounts: { slot: compositeFinalizedSlot, addresses: onePoolProofAddresses, value: finalizedOnePoolAccounts } });
  assert.equal(observed.state, "finalized", "classic activation fee-only wallet rewrite finalizes");
}
{
  const rpc = {
    getTransaction: (_signature: string, config: { commitment: string }) => ({ send: async () => { assert.equal(config.commitment, "confirmed");
      return onePoolRawOf(onePoolSignedBytes);
    } }),
    getAccountInfo: () => ({ send: async () => null }),
    getMultipleAccounts: (addresses: readonly Address[], config: { commitment: string }) => ({ send: async () => { assert.equal(config.commitment, "confirmed");
      return { context: { slot: Number(compositeFinalizedSlot) }, value: addresses.map((key) => {
        const account = finalizedOnePoolAccounts[onePoolProofAddresses.indexOf(key)]!;
        return { ...account, lamports: Number(account.lamports), data: [base64(account.data), "base64"] };
      }) };
    } }),
  };
  const terminal = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
    slot: compositeFinalizedSlot, pools: onePoolClassic.selectedPools!, receipts: [onePoolReceipt], confirmedRpc: rpc,
    assignedTickerConfig: onePoolClassic.plan.feed });
  assert.deepEqual([terminal.next, terminal.reconciliation.action, terminal.reconciliation.steps[0]!.state], [null, "await-finality", "confirmed"]);
}
const shortenedOnePoolSource = finalizedOnePoolAccounts.slice();
const onePoolSourceIndex = onePoolProofAddresses.indexOf(onePoolClassic.next!.step.expectedWrites
  .find((write) => write.description.includes("create source config"))!.address);
shortenedOnePoolSource[onePoolSourceIndex] = { ...shortenedOnePoolSource[onePoolSourceIndex]!,
  data: shortenedOnePoolSource[onePoolSourceIndex]!.data.subarray(0, 383) };
await assert.rejects(() => verifyOnePool(shortenedOnePoolSource), /account data length postcondition mismatch/);
const onePoolLockIndex = onePoolProofAddresses.indexOf(classicCollateralLock.address);
const onePoolLockAccount = finalizedOnePoolAccounts[onePoolLockIndex]!;
const wrongOnePoolLockSlot = finalizedOnePoolAccounts.slice(); wrongOnePoolLockSlot[onePoolLockIndex] = {
  ...onePoolLockAccount, data: collateralLockData(compositeSimulationSlot, compositeFinalizedBlockTime),
};
await assert.rejects(() => verifyOnePool(wrongOnePoolLockSlot), /collateral-lock runtime fields differ from finalized transaction context/);
const wrongOnePoolLockTime = finalizedOnePoolAccounts.slice(); wrongOnePoolLockTime[onePoolLockIndex] = {
  ...onePoolLockAccount, data: collateralLockData(compositeFinalizedSlot, compositeSimulationUnixTs),
};
await assert.rejects(() => verifyOnePool(wrongOnePoolLockTime), /collateral-lock runtime fields differ from finalized transaction context/);
const driftedOnePoolLockData = collateralLockData(compositeFinalizedSlot, compositeFinalizedBlockTime); driftedOnePoolLockData[159] ^= 1;
const driftedOnePoolLock = finalizedOnePoolAccounts.slice(); driftedOnePoolLock[onePoolLockIndex] = {
  ...onePoolLockAccount, data: driftedOnePoolLockData,
};
await assert.rejects(() => verifyOnePool(driftedOnePoolLock), /account data postcondition hash mismatch/);
const reloadedOnePool = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  pools: onePoolClassic.selectedPools!, receipts: [onePoolReceipt], observations: [onePoolObservation],
  assignedTickerConfig: onePoolClassic.plan.feed,
});
assert.equal(reloadedOnePool.reconciliation.action, "complete");
assert.equal(reloadedOnePool.next, null, "a successful fused transaction is not reissued on reload");
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  pools: onePoolClassic.selectedPools!, assignedTickerConfig: onePoolClassic.plan.feed,
}), /ticker PDA is already assigned or malformed/);
const slotTickDraft = await creationFixture(1, [governanceAuthority], "classic", addr(9), { freshEvidenceSlot: 6n });
const slotTickReceipt = await signedStageReceipt(slotTickDraft.next!);
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  receipts: [slotTickReceipt], preserveDraftPoolEvidence: true, freshEvidenceSlot: 7n,
}), (error: unknown) => error instanceof MimirBetaError && error.code === "RECEIPT_MISMATCH" &&
  error.message.includes("resume with the prepared selectedPools"));
const slotTickResume = await creationFixture(1, [governanceAuthority], "classic", addr(9), {
  pools: slotTickDraft.selectedPools!, receipts: [slotTickReceipt], preserveDraftPoolEvidence: true, freshEvidenceSlot: 7n,
});
assert.equal(slotTickResume.draftHash, slotTickDraft.draftHash, "resume after a finalized-slot tick keeps the receipt draft");
assert.equal(slotTickResume.reconciliation.action, "await-finality");
const occupiedProbe = await creationFixture(1, [governanceAuthority], "classic", addr(9), { pools: onePoolClassic.selectedPools! });
const occupiedProposal = JSON.parse(occupiedProbe.canonicalDraftJson).proposal as Address;
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  pools: onePoolClassic.selectedPools!, occupiedProposalAddress: occupiedProposal,
}), (error: unknown) => error instanceof MimirBetaError && error.code === "SIMULATION_FAILED" &&
  error.message.includes("transient proposal must be absent"));
assert.doesNotMatch(onePoolClassic.canonicalDraftJson, /governance|approver|timelock|actionRevision/i);

const r35Adapters = [0, 1, 7, 1, 1] as const;
const r35BasePool = onePoolClassic.selectedPools![0]!;
const r35Pools = r35Adapters.map((adapterType, index) => ({
  ...r35BasePool, family: adapterType === 0 ? "orca-whirlpool" as const :
    adapterType === 1 ? "raydium-clmm" as const : "meteora-damm-v2" as const,
  pool: addr(35 + index), descriptorId: `r35-${index}`, canonicalPairKey: `r35-${index}`,
  evidenceHash: (index + 1).toString().repeat(64),
  readPlan: adapterType === 7 ? r35BasePool.readPlan : {
    ...r35BasePool.readPlan,
    allAddresses: [addr(70 + index * 3), addr(71 + index * 3), addr(72 + index * 3)],
    auxiliary: (["tick-array-lower", "tick-array-active", "tick-array-upper"] as const).map((role, offset) => ({
      role, index: String(offset), address: addr(70 + index * 3 + offset),
    })),
  },
  creation: { ...r35BasePool.creation, adapterType,
    bindingVariant: adapterType === 7 ? "direct" as const : "routeable" as const,
    staticAccounts: [{ role: "base-vault" as const, address: addr(32) }, { role: "quote-vault" as const, address: addr(33) },
      { role: "pool" as const, address: addr(35 + index) }, ...(adapterType === 7 ? [] : [{
        role: adapterType === 0 ? "whirlpools-config" as const : "amm-config" as const, address: addr(34),
      }])] },
}));
const r35Capture = { addresses: [] as Address[], accounts: [] as Array<{ owner: Address; executable: boolean; lamports: bigint; data: Uint8Array } | null> };
const r35Classic = await creationFixture(2, [governanceAuthority, approver], "classic", addr(9), { pools: r35Pools, simulationCapture: r35Capture });
await provePreparedNext(r35Classic);
assert.equal(r35Classic.next!.step.expectedWrites[0]!.dataLengthAfter, 608 + 5 * 392);
assert.equal(r35Classic.next!.review.instructions[0]!.accounts.length, 7);
assert.equal(r35Classic.next!.step.expectedWrites.some((write) => write.proof.kind === "spl-token-burn-checked"), false);
// D0: proposal-init and all five appends pack into one transaction; the activation splits off at the first failed limit.
assert.deepEqual(r35Classic.plan.steps.map((step) => step.stepId), ["classic:proposal-init", "classic:activate"]);
assert.deepEqual(r35Classic.next!.review.instructions.map(({ dataBase64 }) => [...fromBase64(dataBase64).subarray(0, 2)]),
  [[78, 2], ...r35Adapters.map(() => [78, 1])]);
assert.ok(r35Classic.next!.transaction.packet.serializedTransactionBytes <= 4096);
await proveSignerVectorLineage("classic", r35Classic.plan.steps, [
  { id: "classic:proposal-init", signers: [creator] },
  { id: "classic:activate", signers: [creator, asset] },
]);
{
  // D0 N=2: proposal-init + both appends + activation + first publication in one approval when it compiles.
  const n2 = await creationFixture(2, [governanceAuthority, approver], "classic", addr(9), { pools: r35Pools.slice(0, 2) });
  const packet = n2.next!.transaction.packet;
  console.log("classic N2 D0 packet:", JSON.stringify({ steps: n2.plan.steps.map((step) => step.stepId), keys: packet.accountCount,
    bytes: packet.serializedTransactionBytes, instructions: packet.instructionCount, signatures: packet.signatureCount }));
  assert.deepEqual(n2.plan.steps.map((step) => step.stepId), ["classic:activate"]);
  assert.deepEqual(n2.next!.review.instructions.filter(({ programAddress }) => programAddress === n2.plan.programId)
    .map(({ dataBase64 }) => fromBase64(dataBase64)[0]), [78, 78, 78, 80, 90, 90, 89]);
  assert.deepEqual([packet.instructionCount, packet.signatureCount], [9, 2]);
}
{
  const receipt = await signedStageReceipt(r35Classic.next!);
  const decoded = getCompiledTransactionMessageDecoder().decode(fromBase64(receipt.messageBase64));
  const keys = decoded.staticAccounts;
  const pre = keys.map(() => 1n); const post = [...pre];
  for (const write of receipt.reviewedStep.step.expectedWrites) {
    const index = keys.indexOf(write.address);
    if (write.proof.kind === "account") { pre[index] = write.proof.before.lamports; post[index] = write.proof.after.exists ? write.proof.after.lamports : 0n; }
    if (write.proof.kind === "lamports") { pre[index] = 100n; post[index] = 100n + write.proof.programDeltaLamports - 1n; }
  }
  const response = { slot: 6, blockTime: 0, version: 1,
    transaction: [base64(Uint8Array.from([...fromBase64(receipt.messageBase64), ...bs58.decode(receipt.signature)])), "base64"],
    meta: { err: null, fee: 1, preBalances: pre.map(Number), postBalances: post.map(Number),
      preTokenBalances: [], postTokenBalances: [], loadedAddresses: { writable: [], readonly: [] }, innerInstructions: null } };
  let reads = 0; let transactions = 0;
  const rpc = {
    getTransaction: (_signature: string, config: { commitment: string }) => ({ send: async () => { assert.equal(config.commitment, "confirmed"); transactions++; return response; } }),
    getAccountInfo: () => ({ send: async () => null }),
    getMultipleAccounts: (addresses: readonly Address[], config: { commitment: string; minContextSlot?: bigint }) => ({ send: async () => {
      assert.equal(config.commitment, "confirmed"); assert.ok(config.minContextSlot! >= 6n); reads++;
      return { context: { slot: 7 }, value: addresses.map((address) => { const a = r35Capture.accounts[r35Capture.addresses.indexOf(address)];
        return a ? { ...a, lamports: Number(a.lamports), data: [base64(a.data), "base64"] } : null; }) };
    } }),
  };
  const proposal = receipt.reviewedStep.step.expectedWrites.find((write) => write.proof.kind === "account")!.address;
  const account = r35Capture.accounts[r35Capture.addresses.indexOf(proposal)]!;
  putU64(account.data, 408, 6n);
  const resume = { slot: 7n, pools: r35Classic.selectedPools!, receipts: [receipt], confirmedRpc: rpc, finalizedOnlyPlanning: true,
    activationProposalPost: { address: proposal, account } };
  const floors: bigint[] = [];
  const prepared = await creationFixture(2, [governanceAuthority, approver], "classic", addr(9), { ...resume, rpcContextFloors: floors });
  assert.deepEqual([prepared.reconciliation.steps[0]!.state, prepared.next!.step.stepId], ["confirmed", "classic:activate"]);
  assert.equal(prepared.reconciliation.steps[0]!.finalizedSignature, null);
  assert.equal(prepared.plan.draftHash, r35Classic.plan.draftHash);
  const closeProof = prepared.next!.step.expectedWrites.find((write) => write.address === proposal)!.proof;
  assert.equal(closeProof.kind, "account");
  if (closeProof.kind !== "account") throw new Error("expected proposal close proof");
  assert.equal(closeProof.beforeDataBase64, base64(account.data), "SDK activation review authenticates the actual proposal baseline bytes");
  assert.equal(closeProof.before.dataSha256, hex(await sha256(fromBase64(closeProof.beforeDataBase64!))));

  assert.equal(transactions, 2); assert.equal(reads, 2); assert.ok(floors.every((slot) => slot >= 7n));
  const pending = await creationFixture(2, [governanceAuthority, approver], "classic", addr(9), { ...resume,
    observations: [{ state: "confirmed", stepId: receipt.stepId, signature: receipt.signature } as never],
    confirmedRpc: { ...rpc, getTransaction: () => ({ send: async () => null }) } });
  assert.deepEqual([pending.next, pending.reconciliation.action], [null, "await-finality"], "caller claims never skip fresh authentication");
  for (const rollback of ["missing", "stale"] as const) {
    reads = 0;
    const bad = { ...rpc, getMultipleAccounts: (addresses: readonly Address[], config: { commitment: string; minContextSlot?: bigint }) => ({ send: async () => {
      const value = await rpc.getMultipleAccounts(addresses, config).send();
      if (reads === 2) {
        if (rollback === "missing") value.value[0] = null;
        else { const a = value.value[0]!; const bytes = fromBase64(a.data[0]); bytes[bytes.length - 1] ^= 1; a.data = [base64(bytes), "base64"]; }
      }
      return value;
    } }) };
    await assert.rejects(() => creationFixture(2, [governanceAuthority, approver], "classic", addr(9), { ...resume, confirmedRpc: bad }), /postcondition/);
  }
  // The paid proposal-init confirmed after the frozen pool evidence expired; resume re-proves fresh evidence for the
  // same frozen pools (draft unchanged, no second proposal-init) instead of POOL_STALE.
  const late = r35Classic.selectedPools!.reduce((slot, pool) => pool.validThroughSlot > slot ? pool.validThroughSlot : slot, 0n) + 2n;
  const lateRpc = { ...rpc,
    getTransaction: (signature: string, config: { commitment: string }) => ({ send: async () =>
      ({ ...(await rpc.getTransaction(signature, config).send()), slot: Number(late - 1n) }) }),
    getMultipleAccounts: (addresses: readonly Address[], config: { commitment: string; minContextSlot?: bigint }) => ({ send: async () =>
      ({ ...(await rpc.getMultipleAccounts(addresses, config).send()), context: { slot: Number(late) } }) }) };
  putU64(account.data, 408, late - 1n);
  const expired = await creationFixture(2, [governanceAuthority, approver], "classic", addr(9), { ...resume, slot: late,
    confirmedRpc: lateRpc, enforceEvidenceWindow: true });
  assert.deepEqual([expired.reconciliation.steps[0]!.state, expired.next!.step.stepId, expired.plan.draftHash],
    ["confirmed", "classic:activate", r35Classic.plan.draftHash]);
  assert.ok(!expired.next!.review.instructions.some(({ dataBase64 }) => fromBase64(dataBase64)[0] === 78 && fromBase64(dataBase64)[1] === 0),
    "no second proposal-init");
}
const r35ProposalData = fromBase64(r35Classic.next!.review.instructions[0]!.dataBase64);
assert.deepEqual([...r35ProposalData.subarray(0, 2)], [78, 2]);
const r35Init = r35ProposalData.subarray(2, 238);
assert.deepEqual([...r35Init.subarray(211, 215)], [5, 5, 3, 3]);
const r35Selected = r35Classic.selectedPools!;
const r35FeedId = await deriveMimirBetaClassicFeedId(addr(6), addr(2));
const r35Pdas = await deriveMimirBetaFeedPdas({ programId: addr(10), feedId: r35FeedId });
const r35Facts = [...new Map(r35Selected.flatMap((pool) => pool.creation.staticAccounts.map(({ address }) =>
  [address, { address, owner: addr(47), executable: false }] as const))).values()];
const r35Configured = r35Selected.map((pool) => ({ ...pool,
  minLiquidityNative: 1n,
  minDepthTo50BpsNative: conservativeMintOracleSourceConfigFloor(pool.minDepthTo50BpsNative, 900) }));
const r35Artifacts = await buildMimirBetaClassicSourceArtifacts({ programId: addr(10), feedId: r35FeedId,
  baseMint: addr(6), quoteMint: addr(2), pools: r35Configured, physicalAccounts: r35Facts });
assert.deepEqual(r35Artifacts.artifacts.map(({ source }) => source.venueGroup), [0, 1, 2, 1, 1]);
assert.equal(r35Artifacts.lifecycleGroupCount, 3);
const r35ExpectedPlanHash = await computeMimirBetaClassicPlanHash({ feedId: r35FeedId,
  profile: classicPolicy.profile, riskTier: classicPolicy.riskTier, minSources: 5, minVenues: 3, minCorrelationGroups: 3,
  maxDispersionBps: classicPolicy.maxDispersionBps, maxSourceActivityAgeSlots: classicPolicy.maxSourceActivityAgeSlots,
  priceExponent: classicPolicy.priceExponent, baseMint: addr(6), quoteMint: addr(2), sourceSetRoot: r35Artifacts.sourceSetRoot,
  staticAccountsRoot: r35Artifacts.staticAccountsRoot, twap: r35Pdas.twap[0], anchorPolicyHash: classicPolicy.anchorPolicyHash,
  adapterMask: r35Artifacts.adapterMask });
const r35Draft = JSON.parse(r35Classic.canonicalDraftJson) as { planHash: string; configByteHash: string };
assert.equal(r35Draft.planHash, base64(r35ExpectedPlanHash));
assert.equal(r35Draft.configByteHash, base64(await sha256(r35Init)));
const oldStagedReceipt = await signedStageReceipt(r35Classic.next!);
await assert.rejects(() => creationFixture(1, [governanceAuthority], "classic", addr(9), {
  pools: onePoolClassic.selectedPools!, receipts: [oldStagedReceipt],
}), code("RECEIPT_MISMATCH"), "old staged one-pool lineage is never migrated or replayed as fused");
const disabledAdapterCalls = { blockhash: 0, simulation: 0 };
await assert.rejects(() => creationFixture(1, [creator], "classic", addr(9), {
  supportedAdapterMask: 0x5fn, preparationCalls: disabledAdapterCalls,
}), code("PLAN_STALE"));
assert.deepEqual(disabledAdapterCalls, { blockhash: 0, simulation: 0 });
const canonicalPdas = await deriveMimirBetaCanonicalPdas(addr(10));
function decodeMimirInstruction(wire: string) {
  const transaction = getTransactionDecoder().decode(fromBase64(wire));
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  assert.equal(message.version, 1);
  if (message.version !== 1) throw new Error("expected TxV1");
  const index = message.instructionHeaders.findIndex((header) => message.staticAccounts[header.programAccountIndex] === addr(10));
  assert.notEqual(index, -1);
  const payload = message.instructionPayloads[index]!;
  return { header: message.instructionHeaders[index]!, payload,
    accounts: payload.instructionAccountIndices.map((accountIndex) => message.staticAccounts[accountIndex]!) };
}
function decodeMimirInstructionData(wire: string) {
  const transaction = getTransactionDecoder().decode(fromBase64(wire));
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  assert.equal(message.version, 1);
  if (message.version !== 1) throw new Error("expected TxV1");
  return message.instructionHeaders.flatMap((header, index) =>
    message.staticAccounts[header.programAccountIndex] === addr(10) ? [message.instructionPayloads[index]!.instructionData] : []);
}
function decodeMimirInstructions(wire: string, programId = addr(10)) {
  const transaction = getTransactionDecoder().decode(fromBase64(wire));
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  assert.equal(message.version, 1);
  if (message.version !== 1) throw new Error("expected TxV1");
  return message.instructionHeaders.flatMap((header, index) =>
    message.staticAccounts[header.programAccountIndex] === programId ? [{
      data: message.instructionPayloads[index]!.instructionData,
      accounts: message.instructionPayloads[index]!.instructionAccountIndices.map((accountIndex) => message.staticAccounts[accountIndex]!),
    }] : []);
}
assert.equal(classicCollateralLock.proof.kind, "account");
if (classicCollateralLock.proof.kind !== "account" || !classicCollateralLock.proof.after.exists ||
  classicCollateralLock.proof.after.data.kind !== "sdk-codec") throw new Error("fused classic collateral lock must use runtime codec");
assert.equal(classicCollateralLock.proof.after.data.length, 160);
assert.equal(classicCollateralLock.proof.after.data.codec, "mimir-exact-layout-v1");
assert.equal(onePoolClassic.next!.review.simulation.contextSlot, compositeSimulationSlot);
assert.notEqual(compositeSimulationSlot, compositeFinalizedSlot);

// ABI-1 fresh Composite creation: tag 81, the contiguous complete tag-88 closure, and the ready tag 87 in one TxV1, or a refusal.
const compositeCalls = { blockhash: 0, simulation: 0 };
// ABI-1 staged launch: N5 fresh create + tag88 + tag87 exceeds one TxV1, so tx 1 is identity + tag 81 and tx 2 the tag-88 closure + first tag 87.
const stagedArgs = { preparationCalls: compositeCalls, successfulCompositeActivation: true as const, componentCount: 5 as const };
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { ...stagedArgs, simulationUnits: 0,
  finalizedOnlyPlanning: true, confirmedRpc: {
    getTransaction: () => ({ send: async () => null }), getAccountInfo: () => ({ send: async () => null }),
    getMultipleAccounts: () => ({ send: async () => null }),
  } }), /no valid compute units/);
const stagedN5 = await creationFixture(1, [creator], "composite", addr(9), stagedArgs);
assert.deepEqual(stagedN5.plan.steps.map((step) => step.stepId), ["composite:activate", "composite:execution"]);
assert.deepEqual(stagedN5.plan.steps[1]!.prerequisiteStepIds, ["composite:activate"]);
assert.deepEqual([stagedN5.fusedComposite!.staged, stagedN5.fusedComposite!.freshCreationAtomic], [true, false]);
const stagedTx1 = decodeMimirInstructions(base64(stagedN5.next!.transaction.serializedTransaction));
assert.equal(stagedTx1.at(-1)!.data[0], 81, "tx 1 ends at tag 81");
assert.ok(!stagedTx1.some(({ data }) => data[0] === 87 || data[0] === 88) && stagedN5.next!.transaction.packet.fitsPacketLimit);
assert.ok(!stagedN5.next!.review.expectedWrites.some(({ dataLengthAfter }) => dataLengthAfter === stagedN5.fusedComposite!.executionLength));
const stagedReceipt = await signedStageReceipt(stagedN5.next!);
const stagedObservation = { state: "finalized" as const, stepId: stagedReceipt.stepId, signature: stagedReceipt.signature, observedSlot: 2n,
  accountContextSlot: 2n, messageHash: stagedReceipt.messageHash, evidenceHash: "e".repeat(64), writes: stagedReceipt.reviewedStep.step.expectedWrites
    .map((write, index) => ({ index, address: write.address, kind: write.proof.kind, evidenceHash: "f".repeat(64) })) };
const stagedTx2 = await creationFixture(1, [creator], "composite", addr(9), { ...stagedArgs, receipts: [stagedReceipt], configuredStateReceipt: stagedReceipt,
  observations: [stagedObservation as never] });
assert.equal(stagedTx2.plan.draftHash, stagedN5.plan.draftHash, "the staged topology is frozen by the tx-1 receipt");
assert.deepEqual([stagedTx2.reconciliation.steps[0]!.state, stagedTx2.next!.step.stepId], ["finalized", "composite:execution"]);
const stagedTx2Ixs = decodeMimirInstructions(base64(stagedTx2.next!.transaction.serializedTransaction)).filter(({ data }) => data[0] === 87 || data[0] === 88);
{
  const ringless = { ...stagedArgs, omitExistingRings: true as const };
  const ringlessN5 = await creationFixture(1, [creator], "composite", addr(9), ringless);
  assert.equal(ringlessN5.plan.draftHash, stagedN5.plan.draftHash, "ringless components prepare the same staged Composite");
  const ringlessReceipt = await signedStageReceipt(ringlessN5.next!);
  const ringlessTx2 = await creationFixture(1, [creator], "composite", addr(9), { ...ringless, receipts: [ringlessReceipt],
    configuredStateReceipt: ringlessReceipt, observations: [{ ...stagedObservation, signature: ringlessReceipt.signature } as never] });
  assert.deepEqual([ringlessTx2.reconciliation.steps[0]!.state, ringlessTx2.next!.step.stepId], ["finalized", "composite:execution"],
    "Composite creation resumes over ringless components");
}
const grows = stagedN5.fusedComposite!.growCount;
assert.deepEqual(stagedTx2Ixs.map(({ data }) => data[0] === 88 ? `88.${data[1]}` : String(data[0])), ["88.0", ...Array(grows).fill("88.1"), "88.2", "87"]);
assert.ok(stagedTx2.next!.transaction.packet.fitsPacketLimit && stagedTx2.next!.transaction.requiredSigners.length === 1, "tx 2 is payer-only");
assert.ok(stagedTx2.next!.review.expectedWrites.some(({ address, dataLengthAfter }) => address === stagedN5.fusedComposite!.execution &&
  dataLengthAfter === stagedN5.fusedComposite!.executionLength), "tx 2 creates the sealed execution");
// Post-ready reconcile: the execution step's receipt hydrates although only tx 1 carries the display-name instruction.
const stagedReceipt2 = await signedStageReceipt(stagedTx2.next!);
const stagedObservation2 = { ...stagedObservation, stepId: stagedReceipt2.stepId, signature: stagedReceipt2.signature, messageHash: stagedReceipt2.messageHash,
  writes: stagedReceipt2.reviewedStep.step.expectedWrites.map((write, index) => ({ index, address: write.address, kind: write.proof.kind, evidenceHash: "f".repeat(64) })) };
{
  const collectExpiredStep = (receipt: MimirBetaStageReceipt) => {
    let processedTip = compositeSimulationSlot + 100n; let finalizedRoot = processedTip - 32n;
    return observeMimirBetaReceipt({ receipt, finalityDelayMs: 0, rpc: {
      getTransaction() { return { send: async () => null }; },
      getSignatureStatuses() { processedTip += 8n; return { send: async () => ({ context: { slot: processedTip }, value: [null] }) }; },
      isBlockhashValid() { return { send: async () => ({ context: { slot: processedTip }, value: false }) }; },
      getFirstAvailableBlock() { return { send: async () => 0n }; },
      getAccountInfo() { throw new Error("unexpected single-account read"); },
      getMultipleAccounts(addresses: readonly Address[], config: { commitment: string; minContextSlot: bigint }) {
        assert.equal(config.commitment, "finalized"); assert.equal(config.minContextSlot, compositeSimulationSlot + 108n);
        processedTip += 8n; finalizedRoot += 8n;
        return { send: async () => {
          if (finalizedRoot < config.minContextSlot) throw Object.assign(new Error("Minimum context slot has not been reached"), { code: -32016 });
          return { context: { slot: finalizedRoot }, value: addresses.map((key) => {
            assert(servedAccounts.has(key), `missing baseline ${key}`); return servedAccounts.get(key);
          }) };
        } };
      } } });
  };
  const collectedExpiry = await collectExpiredStep(stagedReceipt2);
  assert.equal(collectedExpiry.state, "expired");
  if (collectedExpiry.state !== "expired") throw new Error("expected expiry");
  assert.equal(collectedExpiry.rollback, "baseline-matched");
  const retryInputs = { ...stagedArgs, receipts: [stagedReceipt, stagedReceipt2], configuredStateReceipt: stagedReceipt,
    observations: [stagedObservation as never, collectedExpiry], retryBlockhash: bs58.encode(new Uint8Array(32).fill(91)) };
  const freshExecutionRetry = await creationFixture(1, [creator], "composite", addr(9), retryInputs);
  assert.equal(freshExecutionRetry.reconciliation.action, "retry-once");
  assert.equal(freshExecutionRetry.next!.step.stepId, "composite:execution");
  assert.equal(freshExecutionRetry.draftHash, stagedN5.draftHash);
  assert.equal(freshExecutionRetry.next!.review.stepIntentHash, stagedReceipt2.stepIntentHash);
  assert.equal(freshExecutionRetry.next!.review.expectedWritesHash, stagedReceipt2.expectedWritesHash);
  assert.notEqual(freshExecutionRetry.next!.transaction.messageHash, stagedReceipt2.messageHash);
  assert.equal(freshExecutionRetry.next!.step.expectedWrites.some((write) => write.proof.kind === "spl-token-burn-checked"), false);
  assert.equal(decodeMimirInstructions(base64(freshExecutionRetry.next!.transaction.serializedTransaction)).some(({ data }) => data[0] === 81), false);
  const copiedExpiry = await creationFixture(1, [creator], "composite", addr(9), { ...retryInputs, observations: [stagedObservation as never, { ...collectedExpiry }] });
  assert.equal(copiedExpiry.reconciliation.action, "blocked");
  const reobserved = await creationFixture(1, [creator], "composite", addr(9),
    { ...retryInputs, observations: [stagedObservation as never, await collectExpiredStep(stagedReceipt2)] });
  assert.equal(reobserved.reconciliation.action, "retry-once");
  const secondAttempt = await signedStageReceipt(freshExecutionRetry.next!, 2, stagedReceipt2.signature);
  const exhausted = await creationFixture(1, [creator], "composite", addr(9), { ...retryInputs, receipts: [...retryInputs.receipts, secondAttempt],
    observations: [stagedObservation as never, collectedExpiry, await collectExpiredStep(secondAttempt)] });
  assert.equal(exhausted.reconciliation.action, "blocked"); assert.equal(exhausted.next, null);
}
const stagedTx3 = await creationFixture(1, [creator], "composite", addr(9), { ...stagedArgs, receipts: [stagedReceipt, stagedReceipt2],
  configuredStateReceipt: stagedReceipt, observations: [stagedObservation as never, stagedObservation2 as never] });
assert.deepEqual([stagedTx3.plan.draftHash, stagedTx3.next, stagedTx3.reconciliation.steps.map(({ state }) => state)],
  [stagedN5.plan.draftHash, null, ["finalized", "finalized"]]);
// Explicit staged mode on a shape that fits fused: activation, then the tag-88 closure alone, then the first tag 87; next stage follows each receipt.
{
  const observe = (receipt: Awaited<ReturnType<typeof signedStageReceipt>>) => ({ ...stagedObservation, stepId: receipt.stepId, signature: receipt.signature,
    messageHash: receipt.messageHash, writes: receipt.reviewedStep.step.expectedWrites.map((write, index) => ({ index, address: write.address, kind: write.proof.kind,
      evidenceHash: "f".repeat(64) })) }) as never;
  const args = { successfulCompositeActivation: true as const, componentCount: 2 as const, stagedExecution: true as const };
  const tags = (prepared: typeof stagedN5) => decodeMimirInstructions(base64(prepared.next!.transaction.serializedTransaction))
    .filter(({ data }) => data[0] === 81 || data[0] === 87 || data[0] === 88).map(({ data }) => data[0] === 88 ? `88.${data[1]}` : String(data[0]));
  const activationCapture = { addresses: [] as Address[], accounts: [] as Array<{ owner: Address; executable: boolean; lamports: bigint; data: Uint8Array } | null> };
  const s1 = await creationFixture(1, [creator], "composite", addr(9), { ...args, simulationCapture: activationCapture });
  const exec = s1.fusedComposite!.execution;
  assert.deepEqual(s1.plan.steps.map((step) => step.stepId), ["composite:activate", "composite:init", "composite:publish"]);
  assert.deepEqual(s1.plan.steps.map((step) => step.prerequisiteStepIds), [[], ["composite:activate"], ["composite:init"]]);
  const paused = await creationFixture(1, [creator], "composite", addr(9), { ...args, sentinelOrdinary: true }).then(() => null, (error) => error.code);
  assert.equal(paused, null, "a never-sampled classic ring does not block staged launch; composite steps never read it");
  const belowFloor = await creationFixture(1, [creator], "composite", addr(9), { ...args, belowFloorComponent: true }).then(() => null, (error) => error.code);
  assert.equal(belowFloor, "SOURCE_BELOW_FLOOR_UNPUBLISHABLE", "staged launch refuses before payment when a later step's source is below floor");
  const automatic = await creationFixture(1, [creator], "composite", addr(9), { successfulCompositeActivation: true, componentCount: 2 });
  assert.deepEqual([automatic.plan.steps.map((step) => step.stepId), automatic.fusedComposite!.staged], [["composite:activate"], false], "default stays fused");
  assert.notEqual(s1.plan.draftHash, automatic.plan.draftHash, "staged intent is part of the draft");
  assert.deepEqual([s1.next!.step.stepId, tags(s1), s1.fusedComposite!.staged], ["composite:activate", ["81"], true]);
  assert.ok(!s1.next!.review.expectedWrites.some(({ address }) => address === exec));
  const r1 = await signedStageReceipt(s1.next!);
  const s2 = await creationFixture(1, [creator], "composite", addr(9), { ...args, receipts: [r1], configuredStateReceipt: r1, observations: [observe(r1)] });
  assert.deepEqual([s2.plan.draftHash, s2.next!.step.stepId], [s1.plan.draftHash, "composite:init"]);
  assert.deepEqual(tags(s2), ["88.0", ...Array(s1.fusedComposite!.growCount).fill("88.1"), "88.2"], "BEGIN/GROW/SEAL stay in one transaction, no tag 87");
  assert.deepEqual(s2.next!.review.expectedWrites.map(({ address, effect, dataLengthAfter }) => [address, effect, dataLengthAfter]),
    [[exec, "create", s1.fusedComposite!.executionLength], [creator, "lamports", null]], "init-only writes: the sealed execution and the payer rent");
  assert.ok(!s2.next!.review.expectedWrites.some(({ proof }) => proof.kind === "spl-token-burn-checked"), "no root burn after the activation");
  const spent = await creationFixture(1, [creator], "composite", addr(9), { ...args, collateralBalanceRaw: 0n, receipts: [r1],
    configuredStateReceipt: r1, observations: [observe(r1)] });
  assert.equal(spent.next!.step.stepId, "composite:init", "continuation needs no repeated activation collateral");
  const r2 = await signedStageReceipt(s2.next!);
  // Processed status context stays ahead of finalized; an expired, never-landed init must resume once.
  {
    const finalizedTip = compositeSimulationSlot + 100n; const processedTip = finalizedTip + 32n;
    const activation = finalizedActivationRpc(s1.next!, r1, activationCapture, compositeSimulationSlot, compositeSimulationUnixTs);
    const baseline = new Map(servedAccounts); const floors: bigint[] = [];
    const rpc = { ...activation.rpc,
      getTransaction: (signature: string, config: Parameters<typeof activation.rpc.getTransaction>[1]) => signature === r1.signature
        ? activation.rpc.getTransaction(signature, config) : { send: async () => null },
      getSignatureStatuses: () => ({ send: async () => ({ context: { slot: processedTip }, value: [null] }) }),
      isBlockhashValid: (_hash: string, config: { commitment: string }) => ({ send: async () => ({
        context: { slot: config.commitment === "finalized" ? finalizedTip : processedTip - 1n }, value: false }) }),
      getFirstAvailableBlock: () => ({ send: async () => 0n }),
      getMultipleAccounts: (addresses: readonly Address[], config: { commitment?: string; minContextSlot?: bigint }) => ({ send: async () => {
        const tip = config.commitment === "finalized" ? finalizedTip : processedTip;
        if (config.commitment === "finalized") floors.push(config.minContextSlot ?? 0n);
        if ((config.minContextSlot ?? 0n) > tip) throw Object.assign(new Error("Minimum context slot has not been reached"), { code: -32016 });
        const value = addresses.includes(exec) ? addresses.map((a) => baseline.get(a) ?? null)
          : (await activation.rpc.getMultipleAccounts(addresses, config).send() as { value: unknown[] }).value;
        return { context: { slot: tip }, value };
      } }),
    };
    const receipts = [r1, r2];
    for (const rooted of [{ slot: compositeSimulationSlot - 1n, value: false }, { slot: finalizedTip, value: true }]) {
      const pending = await observeMimirBetaReceipt({ rpc: { ...rpc, isBlockhashValid: (_hash, config) => ({ send: async () =>
        config.commitment === "finalized" ? { context: { slot: rooted.slot }, value: rooted.value }
          : { context: { slot: processedTip - 1n }, value: false } }) }, receipt: r2, finalityAttempts: 1 });
      assert.equal(pending.state, "pending", "a rooted invalidity witness must cover the reviewed blockhash");
    }
    assert.equal(floors.length, 0, "no baseline read before proven expiry");
    const chain = await observeMimirBetaReceiptChain({ rpc, receipts, finalityAttempts: 1 });
    assert.deepEqual(chain.map(({ state }) => state), ["finalized", "expired"]);
    const confirmed = await observeMimirBetaConfirmedReceiptChain({ rpc, receipts, finalityAttempts: 1 });
    assert.deepEqual(confirmed.map(({ state }) => state), ["finalized", "expired"], "expired successor must release the finalized paid prerequisite");
    assert.equal(reconcileMimirBetaConfirmedPreparationReceipts({ draftHash: s1.draftHash, steps: s2.plan.steps, receipts,
      observations: [{ ...chain[0]!, state: "confirmed" } as never, chain[1]!], observedSlot: finalizedTip }).action, "blocked",
    "confirmed-only activation cannot authorize an expired init retry");
    const retryArgs = { ...args, receipts, configuredStateReceipt: r1, observations: chain,
      retryBlockhash: bs58.encode(new Uint8Array(32).fill(92)) };
    const retry = await creationFixture(1, [creator], "composite", addr(9), retryArgs);
    assert.deepEqual([retry.reconciliation.action, retry.next!.step.stepId, tags(retry)],
      ["retry-once", "composite:init", ["88.0", ...Array(s1.fusedComposite!.growCount).fill("88.1"), "88.2"]]);
    assert.equal(retry.next!.review.expectedWritesHash, r2.expectedWritesHash);
    assert.notEqual(retry.next!.transaction.recentBlockhash, s2.next!.transaction.recentBlockhash);
    assert.ok(!retry.next!.step.expectedWrites.some(({ proof }) => proof.kind === "spl-token-burn-checked"));
    const confirmedRetry = await creationFixture(1, [creator], "composite", addr(9), { ...retryArgs, slot: processedTip,
      confirmedRpc: rpc });
    assert.deepEqual([confirmedRetry.reconciliation.action, confirmedRetry.next!.step.stepId], ["retry-once", "composite:init"]);
    const stalePrefixRpc = { ...rpc, getMultipleAccounts: (addresses: readonly Address[], config: { commitment?: string; minContextSlot?: bigint }) => ({ send: async () => {
      const response = await rpc.getMultipleAccounts(addresses, config).send();
      if (config.commitment === "confirmed") response.value = response.value.map((account, i) => addresses[i] === s1.plan.feed ? null : account);
      return response;
    } }) };
    await assert.rejects(() => observeMimirBetaConfirmedReceiptChain({ rpc: stalePrefixRpc, receipts,
      minContextSlot: processedTip, finalityAttempts: 1 }), code("RECONCILIATION_CONFLICT"), "confirmed floor covers prerequisite postconditions too");
    const driftCalls = { blockhash: 0, simulation: 0 };
    const driftedRpc = { ...rpc, getMultipleAccounts: (addresses: readonly Address[], config: { commitment?: string; minContextSlot?: bigint }) => ({ send: async () => {
      const response = await rpc.getMultipleAccounts(addresses, config).send();
      if (driftCalls.simulation > 0 && config.commitment === "confirmed" && (config.minContextSlot ?? 0n) > finalizedTip && addresses.includes(exec)) {
        response.value = response.value.map((account, i) => addresses[i] === exec ? baseline.get(creator) : account);
      }
      return response;
    } }) };
    await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { ...retryArgs, slot: processedTip,
      confirmedRpc: driftedRpc, preparationCalls: driftCalls }), /expired stage baseline changed/, "refresh divergence withholds the prepared retry");
    assert.ok(floors.every((floor) => floor <= finalizedTip));
    const second = await signedStageReceipt(retry.next!, 2, r2.signature);
    const exhausted = await observeMimirBetaReceiptChain({ rpc, receipts: [...receipts, second], finalityAttempts: 1 });
    assert.equal(reconcileStepReceipts({ draftHash: s1.draftHash, steps: retry.plan.steps, receipts: [...receipts, second],
      observations: exhausted, observedSlot: finalizedTip }).action, "blocked", "no third attempt");
  }
  const capture = { addresses: [] as Address[], accounts: [] as Array<{ owner: Address; executable: boolean; lamports: bigint; data: Uint8Array } | null> };
  await creationFixture(1, [creator], "composite", addr(9), { ...args, receipts: [r1], configuredStateReceipt: r1, observations: [observe(r1)], simulationCapture: capture });
  const sealed = capture.accounts[capture.addresses.indexOf(exec)]!;
  const ringWrite = { ...sealed, data: sealed.data.slice() }; ringWrite.data.set(validRingV1(5n), 128 + 1_077);
  const s3 = await creationFixture(1, [creator], "composite", addr(9), { ...args, receipts: [r1, r2], configuredStateReceipt: r1, observations: [observe(r1), observe(r2)],
    simulationAccountOverrides: new Map([[exec, ringWrite]]) });
  assert.deepEqual([s3.plan.draftHash, s3.next!.step.stepId, tags(s3)], [s1.plan.draftHash, "composite:publish", ["87"]]);
  assert.ok(s3.next!.review.expectedWrites.some(({ description }) => description === "create ready Composite root snapshot"));
  assert.deepEqual(s3.next!.review.expectedWrites.filter(({ address }) => address === exec).map(({ effect }) => effect), ["write"],
    "the first publication writes, never recreates, the execution");
  const s3unchanged = await creationFixture(1, [creator], "composite", addr(9), { ...args, receipts: [r1, r2], configuredStateReceipt: r1, observations: [observe(r1), observe(r2)] });
  assert.equal(s3unchanged.next!.step.stepId, "composite:publish");
  const r3 = await signedStageReceipt(s3.next!);
  const s4 = await creationFixture(1, [creator], "composite", addr(9), { ...args, receipts: [r1, r2, r3], configuredStateReceipt: r1,
    observations: [observe(r1), observe(r2), observe(r3)] });
  assert.deepEqual([s4.next, s4.reconciliation.steps.map(({ state }) => state)], [null, ["finalized", "finalized", "finalized"]]);
}
// A stage that still does not fit is a typed refusal naming its limiting roles, before any blockhash or simulation.
{
  const { MimirBetaPacketRefusalError } = await import("../src/beta/errors.js");
  const calls = { blockhash: 0, simulation: 0 };
  const refusal = await creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, preparationCalls: calls,
    compositeCreateClassicPools: [{ ...liveCapacityPool, baseMint: addr(74) }, { ...liveCapacityPool, baseMint: addr(75) }] }).catch((error: unknown) => error);
  assert.ok(refusal instanceof MimirBetaPacketRefusalError && refusal.code === "TRANSACTION_TOO_LARGE", String(refusal));
  assert.equal(refusal.stage, "composite:activate");
  assert.deepEqual(refusal.limitingRoles.map(({ role }) => role).slice(0, 3), ["composite-activate", "classic1", "classic0"]);
  assert.deepEqual(calls, { blockhash: 0, simulation: 0 });
}
const noncanonicalInput: MimirBetaCompositeComponentInput[] = [];
const reorderedComposite = await creationFixture(1, [creator], "composite", addr(9), {
  successfulCompositeActivation: true, componentCount: 2, reverseComponents: true, componentInputCapture: noncanonicalInput,
});
const reorderedTag81 = decodeMimirInstructions(base64(reorderedComposite.next!.transaction.serializedTransaction)).find(({ data }) => data[0] === 81)!;
const canonicalSources = Array.from({ length: 2 }, (_, index) => bytesAddress(reorderedTag81.data.subarray(1 + 229 + index * 80 + 32, 1 + 229 + index * 80 + 64)));
const expectedCanonicalSources = canonicalizeMimirBetaCompositeComponents(noncanonicalInput).map(({ sourceConfig }) => sourceConfig);
assert.deepEqual(noncanonicalInput.map((component) => component.sourceConfig), [...expectedCanonicalSources].reverse(),
  "public preparation does not mutate or reorder component input");
assert.deepEqual(canonicalSources, expectedCanonicalSources);
const reorderedSeal = decodeMimirInstructions(base64(reorderedComposite.next!.transaction.serializedTransaction)).find(({ data }) => data[0] === 88 && data[1] === 2)!;
assert.deepEqual(expectedCanonicalSources.map((source) => reorderedSeal.accounts.indexOf(source)).every((at, i, all) => at > 0 && (i === 0 || at > all[i - 1]!)), true,
  "SEAL rows follow the canonical CFC component order");

const activationFeeSimulation = { addresses: [] as Address[], accounts: [] as Array<{
  owner: Address; executable: boolean; lamports: bigint; data: Uint8Array;
} | null> };
const activatedComposite = await creationFixture(1, [creator], "composite", addr(9), {
  successfulCompositeActivation: true, componentCount: 2, simulationCapture: activationFeeSimulation,
});
assert.equal(activatedComposite.next?.step.stepId, "composite:activate");
{
  const missing = await creationFixture(1, [creator], "composite", addr(9), { successfulCompositeActivation: true, componentCount: 2, missingComponentCoreAsset: true })
    .then(() => null, (error: unknown) => error);
  assert.ok(missing instanceof MimirBetaIdentityAssetMissingError, "missing component Core asset is refused before a payable review");
  assert.deepEqual([missing.code, missing.reason, missing.asset], ["IDENTITY_ASSET_MISSING", "identity-asset-missing", addr(90)]);
  assert.equal(missing.address, missing.feed);
}
assert.equal(activatedComposite.plan.displayName, common.displayName);
assert.equal(activatedComposite.next!.review.displayName, common.displayName);
assert.deepEqual(activatedComposite.plan.steps.map(({ stepId }) => stepId), ["composite:activate"], "one approval; no configure/readiness stages");
assert.ok(activatedComposite.next!.transaction.packet.fitsPacketLimit, "N2 fresh fused transaction fits the complete TxV1 packet limit");
const activatedDecoded = decodeMimirInstructions(base64(activatedComposite.next!.transaction.serializedTransaction));
assert.deepEqual(activatedDecoded.map(({ data }) => data[0] === 88 ? `88.${data[1]}` : String(data[0])).slice(-4), ["81", "88.0", "88.2", "87"],
  "tag 81, contiguous BEGIN/SEAL, then the first tag 87");
assert.ok(!activatedDecoded.some(({ data }) => [65, 66, 67, 68, 69, 70, 71, 72, 77, 60, 82, 83, 89, 90].includes(data[0]!)), "no removed tag and no readiness unit");
assert.equal(activatedDecoded.find(({ data }) => data[0] === 81)?.accounts.length, 25, "N2 tag81 carries Treasury plus three metas per component");
assert.equal(activatedDecoded.find(({ data }) => data[0] === 88 && data[1] === 2)!.data.length, 36 + 301 * 2);
assert.equal(activatedDecoded.at(-1)!.data.length, 106 + 8 * 2);
{
  const a = activatedComposite.consumerAdmission!;
  assert.deepEqual([a.admitted, a.rejection, a.contractSha256, a.cases.length], [false, "UNKNOWN_CU", null, 0], "no consumer contract: fail closed");
  assert.match(a.cell, /^composite:N2S0:/);
  const init = a.initializer!;
  assert.ok(init.keys > 0 && init.freeKeys === 64 - init.keys && init.bytes! > 0 && init.instructions > 0 && init.rejection === "UNKNOWN_CU");
  assert.deepEqual(a.limitingRoles, init.limitingRoles); assert.ok(a.limitingRoles.length > 0 && a.maxCase === null);
  // Initializer CU evidence is a successful simulation receipt over the exact compiled tag-88 packet; a caller number is not evidence.
  const { compileMimirBetaTransactionV1 } = await import("../src/beta/transactionV1.js");
  const initIxs = activatedComposite.next!.review.instructions.filter((ix) => fromBase64(ix.dataBase64)[0] === 88)
    .map((ix) => ({ programAddress: ix.programAddress, accounts: ix.accounts, data: fromBase64(ix.dataBase64) }));
  const initMessage = await compileMimirBetaTransactionV1({ feePayer: activatedComposite.next!.review.authority, recentBlockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 0n, instructions: initIxs });
  const simulation = { recentBlockhash: "11111111111111111111111111111111", serializedMessageBase64: base64(initMessage.serializedMessage), unitsConsumed: 60_000, err: null };
  const measured = await creationFixture(1, [creator], "composite", addr(9), { successfulCompositeActivation: true, componentCount: 2,
    simulationCapture: activationFeeSimulation, extraDependencies: { consumerAdmission: { initializerCu: { simulation } } } });
  assert.deepEqual([measured.consumerAdmission!.initializer!.rejection, measured.consumerAdmission!.initializer!.cu], [null, 60_000]);
  const forged = await creationFixture(1, [creator], "composite", addr(9), { successfulCompositeActivation: true, componentCount: 2,
    simulationCapture: activationFeeSimulation, extraDependencies: { consumerAdmission: { initializerCu: { simulation: { ...simulation, serializedMessageBase64: base64(new Uint8Array(8)) } } } } });
  assert.deepEqual([forged.consumerAdmission!.initializer!.rejection, forged.consumerAdmission!.initializer!.cu], ["UNKNOWN_CU", null]);
  assert.equal(a.witness, activatedComposite.next!.review.instructions.find((ix) => fromBase64(ix.dataBase64)[0] === 88 && fromBase64(ix.dataBase64)[1] === 2)!
    .accounts[5]!.address, "no converter: the five-role witness is component SourceConfig0 (first SEAL row)");
  assert.ok(a.freshCreation!.keys > 0 && a.freshCreation!.rejection === "UNKNOWN_CU" && a.reasons.includes("UNKNOWN_CU") && !a.admitted);
}
assert.deepEqual([activatedComposite.fusedComposite?.freshCreationAtomic, activatedComposite.fusedComposite?.temporalWarmupRequired,
  activatedComposite.fusedComposite?.warmupPublication, activatedComposite.fusedComposite?.postSealSampleOnly], [true, false, null, false]);
assert.equal(activatedComposite.next!.step.expectedWrites.find(({ address }) => address === activatedComposite.fusedComposite!.execution)?.dataLengthAfter,
  activatedComposite.fusedComposite!.executionLength, "the review covers the execution PDA at its exact final length");
console.log("fresh N2 fused packet:", JSON.stringify({ keys: activatedComposite.next!.transaction.packet.accountCount,
  bytes: activatedComposite.next!.transaction.packet.serializedTransactionBytes, instructions: activatedComposite.next!.transaction.packet.instructionCount,
  executionLength: activatedComposite.fusedComposite!.executionLength }));
const oneComponentComposite = await creationFixture(1, [creator], "composite", addr(9), {
  successfulCompositeActivation: true, componentCount: 1,
});
assert.equal(oneComponentComposite.next?.step.stepId, "composite:activate");
assert.equal(decodeMimirInstructions(base64(oneComponentComposite.next!.transaction.serializedTransaction))
  .find(({ data }) => data[0] === 81)?.accounts.length, 21, "N1 tag81 keeps its per-component account roles");
// A mode-4 (sampled PumpSwap) component: the fused creation ends with a sample-only tag 87 that neither creates the root snapshot nor charges the refresh fee.
const sampledComposite = await creationFixture(1, [creator], "composite", addr(9), { successfulCompositeActivation: true, componentCount: 1,
  compositeCreateClassicPool: { ...pumpswapV1Prepared.selectedPools![0]!, creation: { ...pumpswapV1Prepared.selectedPools![0]!.creation,
    token2022Mint: null, adapterVersion: 0, tokenProgramId: addr(14) } },
  supportedAdapterVersionMasks: [0, 0, 0, 0, 0, 0, 3, 0], occupiedCompositeClassic: true });
assert.deepEqual([sampledComposite.next?.step.stepId, sampledComposite.fusedComposite?.temporalWarmupRequired, sampledComposite.fusedComposite?.postSealSampleOnly,
  sampledComposite.fusedComposite?.staged], ["composite:activate", true, true, false]);
assert.ok(!sampledComposite.next!.step.expectedWrites.some(({ description }) => description.includes("Composite root snapshot")),
  "sample-only tag 87 does not create the root snapshot");
// Inline createClassic forwards temporalMode to the Classic creation: point changes the draft, an invalid mode is refused there.
{
  const inline = (temporalMode?: string, depthFloorBps?: number, revalidationCalls?: { count: number }) => creationFixture(1, [creator], "composite", addr(9), { componentCount: 1, simulatedPointOnlyRing: true, depthFloorBps, revalidationCalls,
    compositeCreateClassicPool: { ...pumpswapV1Prepared.selectedPools![0]!, pointOnly: true, creation: { ...pumpswapV1Prepared.selectedPools![0]!.creation,
      token2022Mint: null, adapterVersion: 0, tokenProgramId: addr(14) } }, allowCollateralFunding: true, collateralAccountMissing: true,
    supportedAdapterVersionMasks: [0, 0, 0, 0, 0, 0, 3, 0], ...(temporalMode ? { compositeCreateClassicTemporalMode: temporalMode as "current-point" } : {}) })
    .catch((error: unknown) => error as MimirBetaCollateralRequiredError);
  const [sampled, point, omitted] = [await inline("sampled-interval"), await inline("current-point"), await inline()];
  const strict = await inline("current-point", 9_000);
  assert.ok(strict instanceof MimirBetaCollateralRequiredError);
  assert.notEqual(strict.draftHash, point.draftHash, "inline depth fraction forwarded to classic draft");
  for (const bps of [0, -1, NaN, 1.5, 10_001]) {
    const calls = { count: 0 };
    const invalid = await inline("current-point", bps, calls);
    assert.ok(invalid instanceof MimirBetaError && invalid.code === "INVALID_ARGUMENT");
    assert.equal(calls.count, 0, "invalid inline fraction rejects before pool revalidation");
  }
  assert.ok(sampled instanceof MimirBetaCollateralRequiredError && point instanceof MimirBetaCollateralRequiredError && omitted instanceof MimirBetaCollateralRequiredError);
  assert.notEqual(point.draftHash, sampled.draftHash, "inline point is not silently downgraded to sampled");
  assert.equal(omitted.draftHash, point.draftHash, "omitted inline mode on a fresh PumpSwap source resolves to current-point");
  assert.match(String(await inline("bogus")), /INVALID_ARGUMENT:temporalMode invalid/);
}
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 0 }), code("POOL_COUNT_OUT_OF_RANGE"));
assert.match(activatedComposite.canonicalDraftJson, /"displayName":"Composite Index"/);
const compositeFeeVault = activatedComposite.next!.step.expectedWrites.find(
  (write) => write.description === "create composite fee vault")!;
const compositeLock = activatedComposite.next!.step.expectedWrites.find(
  (write) => write.description === "create composite collateral lock")!;
const treasuryFee = activatedComposite.next!.step.expectedWrites.find(
  (write) => write.address === addr(44) && write.proof.kind === "lamports")!;
const componentOwnerFee = activatedComposite.next!.step.expectedWrites.find(
  (write) => write.address === addr(95) && write.proof.kind === "lamports")!;
assert.equal(compositeFeeVault.proof.kind === "account" && compositeFeeVault.proof.after.exists
  ? compositeFeeVault.proof.after.lamports : null, 801n);
assert.equal(compositeLock.proof.kind === "account" && compositeLock.proof.after.exists
  ? compositeLock.proof.after.lamports : null, 1n);
assert.equal(componentOwnerFee.proof.kind === "lamports" ? componentOwnerFee.proof.programDeltaLamports : null, 1_600_000n,
  "N2 coalesces both 0.8m owner payouts to the authenticated current owner");
const missingOwnerIndex = activationFeeSimulation.addresses.indexOf(addr(95));
assert.ok(missingOwnerIndex >= 0);
assert.deepEqual(activationFeeSimulation.accounts[missingOwnerIndex], { owner: MIMIR_BETA_SYSTEM_PROGRAM_ID,
  executable: false, lamports: 1_600_000n, data: new Uint8Array() },
  "two transfers create the initially absent system account for the live component owner");
assert.equal(treasuryFee.proof.kind === "lamports" ? treasuryFee.proof.programDeltaLamports : null, 2_400_200n,
  "N2 activation Treasury receives 0.7m/component plus 1m creation and the configured 200-lamport refresh share");
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { successfulCompositeActivation: true,
  componentCount: 2, feeTreasuryPostLamports: 211n }),
  /Composite activation owner\/Treasury payment delta differs from fixed policy/);
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), {
  successfulCompositeActivation: true, componentCount: 2, feeVaultPostLamports: 802n, feeTreasuryPostLamports: 209n,
}), /composite refresh fee split differs|payment delta differs/, "the first tag 87 rejects a wrong 801/199 owner/treasury split");
const displayNameWrite = activatedComposite.next!.step.expectedWrites.find(
  (write) => write.description === "create immutable identity display name")!;
assert.equal(displayNameWrite.dataLengthAfter, 332);
assert.equal(displayNameWrite.proof.kind === "account" && displayNameWrite.proof.after.exists &&
  displayNameWrite.proof.after.data.kind === "sdk-codec" ? displayNameWrite.proof.after.data.codec : null, "identity-display-name-v1");
const renamedComposite = await creationFixture(1, [creator], "composite", addr(9), {
  successfulCompositeActivation: true, displayName: "Renamed Index", componentCount: 2,
});
const twoComponentComposite = await creationFixture(1, [creator], "composite", addr(9), {
  successfulCompositeActivation: true, componentCount: 2,
});
assert.deepEqual(twoComponentComposite.plan.steps.map(({ stepId }) => stepId), ["composite:activate"], "Composite N=2 remains one fused ready step");
assert.notEqual(renamedComposite.draftHash, twoComponentComposite.draftHash);
assert.notEqual(renamedComposite.next!.reviewHash, twoComponentComposite.next!.reviewHash);
assert.notEqual(renamedComposite.next!.transaction.messageHash, twoComponentComposite.next!.transaction.messageHash);
assert.notEqual(renamedComposite.next!.review.expectedWritesHash, twoComponentComposite.next!.review.expectedWritesHash);
const staleNameReceipt = await signedStageReceipt(twoComponentComposite.next!);
const resumedComposite = await creationFixture(1, [creator], "composite", addr(9), {
  successfulCompositeActivation: true, componentCount: 2, receipts: [staleNameReceipt],
});
assert.equal(resumedComposite.reconciliation.action, "await-finality", "nominal Composite resume remains green");
const forgedNameReviewBase = { ...twoComponentComposite.next!.review, displayName: "Forged Review" };
const forgedNameReview = await createReviewHash(forgedNameReviewBase);
const forgedNameReceipt = await signedStageReceipt({
  ...twoComponentComposite.next!, review: forgedNameReviewBase, ...forgedNameReview,
});
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), {
  successfulCompositeActivation: true, componentCount: 2, receipts: [forgedNameReceipt],
}), code("RECEIPT_MISMATCH"));
const forgedMetadataInstruction = await identityAdapter.buildSetImmutableDisplayName({
  asset, authority: creator, displayName: "Forged Metadata",
});
const forgedMetadataDataSha256 = hex(await sha256(forgedMetadataInstruction.data));
const forgedMetadataReviewBase = { ...twoComponentComposite.next!.review, instructions:
  twoComponentComposite.next!.review.instructions.map((instruction, index) => index === 2 ? {
    programAddress: forgedMetadataInstruction.programAddress, accounts: forgedMetadataInstruction.accounts,
    dataBase64: base64(forgedMetadataInstruction.data), dataSha256: forgedMetadataDataSha256,
  } : instruction) };
const forgedMetadataReview = await createReviewHash(forgedMetadataReviewBase);
const forgedMetadataReceipt = await signedStageReceipt({
  ...twoComponentComposite.next!, review: forgedMetadataReviewBase, ...forgedMetadataReview,
});
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), {
  successfulCompositeActivation: true, componentCount: 2, receipts: [forgedMetadataReceipt],
}), code("RECEIPT_MISMATCH"));
await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), {
  successfulCompositeActivation: true, componentCount: 2, displayName: "Renamed Index", receipts: [staleNameReceipt],
}), code("RECEIPT_MISMATCH"));
const compositeCollateralLock = activatedComposite.next!.step.expectedWrites.find(
  (write) => write.description === "create composite collateral lock")!;
assert.equal(compositeCollateralLock.proof.kind, "account");
if (compositeCollateralLock.proof.kind !== "account" || !compositeCollateralLock.proof.after.exists ||
  compositeCollateralLock.proof.after.data.kind !== "sdk-codec") throw new Error("composite collateral lock must use runtime codec");
assert.equal(compositeCollateralLock.proof.after.data.length, 160);
assert.equal(compositeCollateralLock.proof.after.data.codec, "mimir-exact-layout-v1");
assert.equal(activatedComposite.next!.review.simulation.contextSlot, compositeSimulationSlot);
assert.notEqual(compositeSimulationSlot, compositeFinalizedSlot);
assert.notEqual(compositeSimulationUnixTs, compositeFinalizedBlockTime);

const exactLockTransaction = await compileMimirBetaTransactionV1({ feePayer: creator,
  recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 99n,
  instructions: [{ programAddress: addr(10), accounts: [{ address: compositeCollateralLock.address,
    isSigner: false, isWritable: true }], data: Uint8Array.of(81) }] });
const exactLockWrites: readonly MimirBetaExpectedWrite[] = [compositeCollateralLock, {
  address: creator, effect: "lamports", ownerAfter: null, dataLengthAfter: null, discriminatorHex: null,
  description: "fee-normalized payer delta", proof: { kind: "lamports", programDeltaLamports: -1n },
}];
const exactLockWritesHash = await createExpectedWritesHash(exactLockWrites);
const exactLockStep: MimirBetaPlanStep = { stepId: "classic:source-append:0", stage: "mimir-create", ordinal: 0,
  prerequisiteStepIds: [], requiredSigners: exactLockTransaction.requiredSigners, expectedWrites: exactLockWrites };
const exactLockStepIntentHash = await createStepIntentHash({ draftHash: activatedComposite.draftHash,
  step: exactLockStep, expectedWritesHash: exactLockWritesHash });
const exactLockReviewBase = { schema: "mimir-beta-creation-review" as const, version: 1 as const,
  draftHash: activatedComposite.draftHash, stepId: exactLockStep.stepId, kind: "classic" as const,
  cluster: "localnet" as const, programId: addr(10), authority: creator, feedId: activatedComposite.plan.feedId,
  feed: activatedComposite.plan.feed, identityAsset: asset, ticker: common.ticker, displayName: null,
  requiredSigners: exactLockTransaction.requiredSigners,
  instructions: await Promise.all(exactLockTransaction.instructions.map(async (instruction) => ({
    programAddress: instruction.programAddress, accounts: instruction.accounts, dataBase64: base64(instruction.data),
    dataSha256: hex(await sha256(instruction.data)),
  }))), expectedWrites: exactLockWrites, messageHash: exactLockTransaction.messageHash,
  stepIntentHash: exactLockStepIntentHash, expectedWritesHash: exactLockWritesHash, packet: exactLockTransaction.packet,
  simulation: { status: "succeeded" as const, contextSlot: 5n, unitsConsumed: 1n,
    logsHash: "a".repeat(64), returnDataHash: null, error: null }, warnings: [],
};
const exactLockReview = await createReviewHash(exactLockReviewBase);
const exactLockPrepared = { step: exactLockStep, transaction: exactLockTransaction,
  review: exactLockReviewBase, ...exactLockReview };
const exactLockSignatureBytes = new Uint8Array(await webcrypto.subtle.sign("Ed25519", receiptPayerKeys.privateKey,
  exactLockPrepared.transaction.serializedMessage));
const exactLockSignature = bs58.encode(exactLockSignatureBytes);
const exactLockReceipt = createMimirBetaStageReceipt({ preparedStep: exactLockPrepared,
  signature: exactLockSignature, attempt: 1, retryOfSignature: null });
const exactLockSignedBytes = exactLockTransaction.serializedTransaction.slice();
exactLockSignedBytes.set(exactLockSignatureBytes, exactLockTransaction.serializedMessage.length);
const exactLockMessage = getCompiledTransactionMessageDecoder().decode(exactLockTransaction.serializedMessage);
assert.equal(exactLockMessage.version, 1);
if (exactLockMessage.version !== 1) throw new Error("expected TxV1");
const exactLockPreBalances = exactLockMessage.staticAccounts.map((address) => address === creator ? 10 : address === compositeCollateralLock.address ? 0 : 1);
const exactLockPostBalances = exactLockMessage.staticAccounts.map((address) => address === creator ? 8 : 1);
const exactLockFinalized = decodeMimirBetaFinalizedTransactionResponse(exactLockSignature, {
  slot: Number(compositeFinalizedSlot), blockTime: Number(compositeFinalizedBlockTime), version: 1,
  transaction: [base64(exactLockSignedBytes), "base64"], meta: {
    err: null, fee: 1, preBalances: exactLockPreBalances, postBalances: exactLockPostBalances,
    preTokenBalances: [], postTokenBalances: [], loadedAddresses: { writable: [], readonly: [] }, innerInstructions: null,
  },
});
assert.ok(exactLockFinalized);
const verifyExactLock = (data: Uint8Array) => verifyMimirBetaFinalizedReceiptEvidence({ receipt: exactLockReceipt,
  preparedStep: exactLockPrepared, transaction: exactLockFinalized,
  postAccounts: { slot: compositeFinalizedSlot, addresses: [compositeCollateralLock.address, creator], value: [
    { address: compositeCollateralLock.address, owner: addr(10), executable: false, lamports: 1n, data },
    { address: creator, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false, lamports: 8n, data: new Uint8Array() },
  ] } });
assert.equal((await verifyExactLock(collateralLockData(compositeFinalizedSlot, compositeFinalizedBlockTime))).state, "finalized");
await assert.rejects(() => verifyExactLock(collateralLockData(compositeSimulationSlot, compositeFinalizedBlockTime)),
  /collateral-lock runtime fields differ from finalized transaction context/);
await assert.rejects(() => verifyExactLock(collateralLockData(compositeFinalizedSlot, compositeSimulationUnixTs)),
  /collateral-lock runtime fields differ from finalized transaction context/);
const driftedCompositeLock = collateralLockData(compositeFinalizedSlot, compositeFinalizedBlockTime);
driftedCompositeLock[159] ^= 1;
await assert.rejects(() => verifyExactLock(driftedCompositeLock), /account data postcondition hash mismatch/);

{
  const { deriveMimirBetaClassicFeedId } = await import("../src/beta/abi.js");
  const v0 = await creationFixture(1, [governanceAuthority], "classic", addr(9));
  const v4242 = await creationFixture(1, [governanceAuthority], "classic", addr(9), { variant: 4242 });
  const expected = await deriveMimirBetaClassicFeedId(addr(6), addr(2), 4242);
  assert.equal(v4242.plan.feedId, expected);
  assert.equal(v4242.plan.variant, 4242);
  assert.equal(v0.plan.variant, undefined);
  assert.ok(!v0.canonicalDraftJson.includes("\"variant\":") && v4242.canonicalDraftJson.includes("\"variant\":\"4242\""));
  assert.notEqual(v0.draftHash, v4242.draftHash);
  const frozen = await creationFixture(1, [governanceAuthority], "classic", addr(9), { variant: 4242, frozenFeedId: expected });
  assert.equal(frozen.draftHash, v4242.draftHash);
  await assert.rejects(creationFixture(1, [governanceAuthority], "classic", addr(9), { variant: 4242, frozenFeedId: v0.plan.feedId }),
    (error: any) => error?.code === "INVALID_ARGUMENT");
  await assert.rejects(creationFixture(1, [governanceAuthority], "classic", addr(9), { variant: "new", receipts: [{} as never] }),
    (error: any) => error?.code === "INVALID_ARGUMENT" && /resolved before resume/.test(error.message));
  const drawn = await creationFixture(1, [governanceAuthority], "classic", addr(9), { variant: "new" });
  assert.ok(drawn.plan.variant! >= 1 && drawn.plan.feedId === await deriveMimirBetaClassicFeedId(addr(6), addr(2), drawn.plan.variant!));
  const { deriveMimirBetaVariantFinalPdas } = await import("../src/beta/pairFeeds.js");
  const v0Final = (await deriveMimirBetaVariantFinalPdas(addr(10), addr(6), addr(2), 0))[0]!;
  const v0Calls = { blockhash: 0, simulation: 0 };
  await assert.rejects(creationFixture(1, [governanceAuthority], "classic", addr(9), { occupiedProposalAddress: v0Final, preparationCalls: v0Calls }),
    (error: any) => error?.code === "VARIANT_TAKEN");
  assert.equal(v0Calls.simulation, 0);
  await assert.rejects(creationFixture(1, [governanceAuthority], "classic", addr(9), { variant: 0, occupiedProposalAddress: v0Final }),
    (error: any) => error?.code === "VARIANT_TAKEN");
  const v4242Final = (await deriveMimirBetaVariantFinalPdas(addr(10), addr(6), addr(2), 4242))[0]!;
  await assert.rejects(creationFixture(1, [governanceAuthority], "classic", addr(9), { variant: 4242, occupiedProposalAddress: v4242Final }),
    (error: any) => error?.code === "VARIANT_TAKEN");
  const drawnPastV0 = await creationFixture(1, [governanceAuthority], "classic", addr(9), { variant: "new", occupiedProposalAddress: v0Final });
  assert.ok(drawnPastV0.plan.variant! >= 1);
  const variantReceipt = await signedStageReceipt(v4242.next!);
  assert.equal(variantReceipt.stepId, "classic:activate");
  const resumeVariant = (observations: readonly never[]) => creationFixture(1, [governanceAuthority], "classic", addr(9), {
    variant: 4242, frozenFeedId: expected, pools: v4242.selectedPools!, receipts: [variantReceipt], observations, preserveDraftPoolEvidence: true });
  const ownPending = await resumeVariant([]);
  assert.equal(ownPending.draftHash, v4242.draftHash, "own pending activation over initialized final PDAs is not VARIANT_TAKEN");
  assert.equal(ownPending.reconciliation.action, "await-finality");
  await assert.rejects(resumeVariant([{ state: "failed", stepId: variantReceipt.stepId, signature: variantReceipt.signature, observedSlot: 5n,
    messageHash: variantReceipt.messageHash, rollback: "baseline-matched" } as never]),
  (error: any) => error?.code === "VARIANT_TAKEN" && error.message.includes("another journey"));
}

const commitmentsOf = (method: string) => [...new Set(rpcEvents.filter((event) => event.method === method).map((event) => event.commitment))].sort();
assert.deepEqual(commitmentsOf("getLatestBlockhash"), ["confirmed"]);
assert.deepEqual(commitmentsOf("simulateTransaction"), ["confirmed"]);
assert.deepEqual(commitmentsOf("getFeeForMessage"), ["confirmed"]);
assert.ok(commitmentsOf("getMultipleAccounts").includes("confirmed"));

console.log("beta creation-stage tests passed");
{
  // An oversized classic:ready (tag 90 + 89) packet is refused with the typed error and its limiting roles, never a bare TRANSACTION_TOO_LARGE.
  const { mimirBetaPacketRefusal } = await import("../src/beta/creation.js");
  const { MimirBetaPacketRefusalError } = await import("../src/beta/errors.js");
  const src = (i: number) => Array.from({ length: 14 }, (_, j) => addr(3_000 + 20 * i + j));
  const ixs = [0, 1, 2, 3, 4].map((i) => ({ programAddress: addr(2_999), data: Uint8Array.of(89), accounts: src(i).map((address) => ({ address, isSigner: false, isWritable: false })) }));
  const refusal = await mimirBetaPacketRefusal("classic:ready", creator, ixs, Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`source${i}`, src(i)])), new Error("too large"));
  assert.ok(refusal instanceof MimirBetaPacketRefusalError && refusal.code === "TRANSACTION_TOO_LARGE" && refusal.stage === "classic:ready");
  assert.deepEqual(refusal.limitingRoles.map((r) => r.keys), [14, 14, 14, 14, 14]); assert.match(refusal.message, /Classic classic:ready .*72 keys/);
}

// Public facade forwards abi1ReleaseRecipeScope; inline Classic validation sees every defined temporalMode.
{
  const sampledArgs = { successfulCompositeActivation: true as const, componentCount: 1 as const,
    compositeCreateClassicPool: { ...pumpswapV1Prepared.selectedPools![0]!, creation: { ...pumpswapV1Prepared.selectedPools![0]!.creation,
      token2022Mint: null, adapterVersion: 0, tokenProgramId: addr(14) } },
    supportedAdapterVersionMasks: [0, 0, 0, 0, 0, 0, 3, 0], occupiedCompositeClassic: true as const };
  for (const viaClient of [false, true]) {
    const calls = { blockhash: 0, simulation: 0 };
    const refused = await creationFixture(1, [creator], "composite", addr(9), { ...sampledArgs, preparationCalls: calls,
      extraDependencies: { abi1ReleaseRecipeScope: true, viaClient } }).catch((e: unknown) => e);
    assert.match(String(refused), /RELEASE_SCOPE_UNSUPPORTED/); assert.deepEqual(calls, { blockhash: 0, simulation: 0 });
  }
  const emptyInline = await creationFixture(1, [creator], "composite", addr(9), { componentCount: 1, simulatedPointOnlyRing: true,
    compositeCreateClassicPool: { ...pumpswapV1Prepared.selectedPools![0]!, pointOnly: true, creation: { ...pumpswapV1Prepared.selectedPools![0]!.creation,
      token2022Mint: null, adapterVersion: 0, tokenProgramId: addr(14) } }, allowCollateralFunding: true, collateralAccountMissing: true,
    supportedAdapterVersionMasks: [0, 0, 0, 0, 0, 0, 3, 0], compositeCreateClassicTemporalMode: "" as never }).catch((e: unknown) => e);
  assert.ok(emptyInline instanceof MimirBetaError && emptyInline.code === "INVALID_ARGUMENT", String(emptyInline));
}
// Staged composite with one ready component and one missing helper: burn proofs bind the assembled tag-80/81 positions.
{
  const token = new Uint8Array(165); token.set(addressBytes(addr(42)), 0); token.set(addressBytes(creator), 32); putU64(token, 64, 8n); token[108] = 1;
  const supply = new Uint8Array(82); putU64(supply, 36, 998n); supply[44] = 6; supply[45] = 1;
  const collection = Uint8Array.from(coreCollectionData(addr(11))); collection[41] = 2; collection[45] = 2;
  for (const ticker of [common.ticker, "MIMIRS", "MIMIRSE", "MIMIRSEV", "MIMIRSEVENAB"]) {
  const prepared = await creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, compositeCreateClassicPool: liveCapacityPool,
    ticker, successfulCompositeActivation: true, stagedExecution: true, simulationAccountOverrides: new Map([
      [addr(50), { owner: MIMIR_BETA_MPL_CORE_PROGRAM_ID, executable: false, lamports: 1n, data: Uint8Array.from(coreAssetData(creator, addr(12))) }],
      [addr(4), { owner: addr(14), executable: false, lamports: 10n, data: token }], [addr(42), { owner: addr(14), executable: false, lamports: 10n, data: supply }],
      [addr(12), { owner: MIMIR_BETA_MPL_CORE_PROGRAM_ID, executable: false, lamports: 10n, data: collection }]]) });
  const review = prepared.next!.review;
  const activations = review.instructions.flatMap((instruction, index) => instruction.programAddress === review.programId &&
    [80, 81].includes(fromBase64(instruction.dataBase64)[0]!) ? [index] : []);
  const burns = prepared.next!.step.expectedWrites.flatMap(({ proof }) => proof.kind === "spl-token-burn-checked" ? [proof.outerInstructionIndex] : []);
  assert.deepEqual([prepared.next!.step.stepId, prepared.fusedComposite!.staged, activations, burns], ["composite:activate", true, [4, 8], [4, 8]]);
  await authenticateMimirBetaReviewedStep(await signedStageReceipt(prepared.next!));
  }
}

{
  const heavyArgs = { successfulCompositeActivation: true as const, componentCount: 5 as const,
    existingComponentPool: (pool: MimirBetaEligiblePool, index: number): MimirBetaEligiblePool => ({ ...pool,
      family: index < 3 ? "pumpswap" : "raydium-amm-v4", creation: { ...pool.creation, adapterType: index < 3 ? 6 : 4, staticAccounts: [
        ...(index < 3 ? [{ role: "base-mint" as const, address: pool.baseMint }, { role: "quote-mint" as const, address: pool.quoteMint }] : []),
        ...pool.creation.staticAccounts,
        ...(index < 3 ? [{ role: "global-config" as const, address: addr(350 + index) }] : []),
        ...(index < 3 ? [{ role: "fee-config" as const, address: addr(320 + index) }] : [
          { role: "open-orders" as const, address: addr(320 + index) }, { role: "market" as const, address: addr(330 + index) },
          { role: "market-program" as const, address: addr(340 + index) }])] } }) };
  const firstQueries: string[] = []; const secondQueries: string[] = [];
  const first = await creationFixture(1, [creator], "composite", addr(9), { ...heavyArgs, discoveryQueries: firstQueries });
  const r1 = await signedStageReceipt(first.next!);
  const observe = (r: MimirBetaStageReceipt) => ({ ...stagedObservation, stepId: r.stepId, signature: r.signature, messageHash: r.messageHash,
    writes: r.reviewedStep.step.expectedWrites.map((w, index) => ({ index, address: w.address, kind: w.proof.kind, evidenceHash: "f".repeat(64) })) }) as never;
  const second = await creationFixture(1, [creator], "composite", addr(9), { ...heavyArgs, discoveryQueries: secondQueries, receipts: [r1], configuredStateReceipt: r1, observations: [observe(r1)] });
  assert.deepEqual(first.plan.steps.map(({ stepId }) => stepId), ["composite:activate", "composite:execution"]);
  assert.deepEqual([first.next!.transaction.packet.serializedTransactionBytes, second.next!.transaction.packet.serializedTransactionBytes,
    second.next!.transaction.packet.accountCount], [2164, 4014, 62]);
  assert.equal(firstQueries.length, 5);
  assert.deepEqual(secondQueries, firstQueries, "each preparation refreshes every exact component search");
  const reversedCalls = { query: "", maxPools: 0, maxInFlight: 0 };
  const reversed = await creationFixture(1, [creator], "composite", addr(9), { ...heavyArgs, discoveryCalls: reversedCalls,
    discoveryDelayMs: (query) => 5 * (firstQueries.length - firstQueries.indexOf(query)) });
  assert.equal(reversedCalls.maxInFlight, 5, "five distinct existing feeds resolve in one wave");
  assert.deepEqual([reversed.plan.draftHash, reversed.next!.reviewHash, reversed.next!.transaction.messageHash],
    [first.plan.draftHash, first.next!.reviewHash, first.next!.transaction.messageHash],
    "concurrent feed groups resolving in reverse order give the same canonical instructions and review intent");
  const splitArgs = { ...heavyArgs, stagedExecution: true as const };
  const split1 = await creationFixture(1, [creator], "composite", addr(9), splitArgs);
  const sr1 = await signedStageReceipt(split1.next!);
  const split2 = await creationFixture(1, [creator], "composite", addr(9), { ...splitArgs, receipts: [sr1],
    configuredStateReceipt: sr1, observations: [observe(sr1)] });
  const sr2 = await signedStageReceipt(split2.next!);
  const split3 = await creationFixture(1, [creator], "composite", addr(9), { ...splitArgs, receipts: [sr1, sr2],
    configuredStateReceipt: sr1, observations: [observe(sr1), observe(sr2)] });
  console.log("heavy explicit split packets:", [split1, split2, split3].map((s) => ({ step: s.next!.step.stepId,
    bytes: s.next!.transaction.packet.serializedTransactionBytes, keys: s.next!.transaction.packet.accountCount })));
  assert.deepEqual([split1, split2, split3].map((s) => s.next!.transaction.packet.serializedTransactionBytes), [2164, 3683, 1797]);
  assert.deepEqual([split2.plan.draftHash, split3.plan.draftHash], [split1.plan.draftHash, split1.plan.draftHash]);

  const { makeBetaCaptureFixture } = await import("./fixtures/betaCaptureFixtures.js");
  const { decodeMimirBetaCaptureCandidate, deriveMimirBetaCaptureReadPlan } = await import("../src/beta/capture.js");
  const capture = await makeBetaCaptureFixture("raydium-clmm", { seed: 10, baseMint: nativeSolMint, quoteMint: addr(2) });
  const observation = capture.fixtureAccounts.find(({ fixtureRole }) => fixtureRole === "clmm-observation")!.data;
  observation[8] = 1; putU16(observation, 17, 1);
  new DataView(observation.buffer).setUint32(51, 700, true);
  new DataView(observation.buffer).setUint32(95, 995, true);
  const context = { observedSlot: 5n, observedUnixTimestamp: 1000n };
  const readPlan = deriveMimirBetaCaptureReadPlan({ descriptor: capture.input.descriptor, primary: capture.input.accounts[0]!,
    pair: capture.input.pair, context });
  const candidate = await decodeMimirBetaCaptureCandidate({ ...capture.input, context, expectedPlan: readPlan });
  const converterPool = { ...candidate, eligibility: "eligible", observedSlot: 5n, validThroughSlot: 10n,
    evidenceHash: "a".repeat(64), readPlan, creation: capture.creation,
    minLiquidityNative: 1n, minDepthTo50BpsNative: 1n } as MimirBetaEligiblePool;
  const autoArgs = { ...heavyArgs, creationBoundary: { source: "classic" as const, token2022Side: "base" as const },
    existingComponentPool: (pool: MimirBetaEligiblePool, index: number) => index < 3 ? pool : heavyArgs.existingComponentPool(pool, index),
    useCanonicalSolConversion: true as const, converterRecipes: ["native-bounded"] as const,
    canonicalSolConversionPool: () => converterPool,
    existingComponentAccounts: capture.fixtureAccounts.map((account) => ({ ...account, lamports: 10n })) };
  const auto1 = await creationFixture(1, [creator], "composite", addr(9), autoArgs);
  const sentinelNative = await creationFixture(1, [creator], "composite", addr(9), { ...autoArgs, sentinelConversionRing: true });
  assert.deepEqual([sentinelNative.fusedComposite!.staged, sentinelNative.draftHash], [true, auto1.draftHash],
    "a native-bounded source keeps its Paused ring sentinel and still prepares staged");
  assert.deepEqual(auto1.plan.steps.map(({ stepId }) => stepId), ["composite:activate", "composite:init", "composite:publish"]);
  const ar1 = await signedStageReceipt(auto1.next!);
  const auto2 = await creationFixture(1, [creator], "composite", addr(9), { ...autoArgs, receipts: [ar1],
    configuredStateReceipt: ar1, observations: [observe(ar1)] });
  const ar2 = await signedStageReceipt(auto2.next!);
  const auto3 = await creationFixture(1, [creator], "composite", addr(9), { ...autoArgs, receipts: [ar1, ar2],
    configuredStateReceipt: ar1, observations: [observe(ar1), observe(ar2)] });
  console.log("heavier automatic split packets:", [auto1, auto2, auto3].map((s) => ({ step: s.next!.step.stepId,
    bytes: s.next!.transaction.packet.serializedTransactionBytes, keys: s.next!.transaction.packet.accountCount })));
  assert.deepEqual([auto1, auto2, auto3].map((s) => s.next!.transaction.packet.serializedTransactionBytes), [2197, 3813, 1667]);
  assert.deepEqual([auto1, auto2, auto3].map((s) => s.next!.transaction.packet.accountCount), [34, 53, 42]);
  for (const dexActivity of ["none", "failed", "readonly"] as const) {
    const refused = await creationFixture(1, [creator], "composite", addr(9), { ...autoArgs, dexActivity, allowCollateralFunding: true, collateralBalanceRaw: 0n })
      .catch((e: unknown) => e);
    assert.ok(refused instanceof MimirBetaConverterIneligibleError && refused.eligibility.legs[0]!.reason === "activity-unproven",
      `unproven converter activity refuses before funding facts: ${String(refused)}`);
  }
  const paid = await creationFixture(1, [creator], "composite", addr(9), { ...autoArgs, dexActivity: "none", receipts: [ar1],
    configuredStateReceipt: ar1, observations: [observe(ar1)] });
  assert.equal(paid.draftHash, auto1.draftHash, "a paid activation keeps its bound converter");
  const leg = (eligible: boolean, age: bigint) => ({ row: 0, pool: addr(1), family: "raydium-clmm", eligible, reason: eligible ? null : "activity-stale" as const,
    nativeAgeSecs: 1n, lastActivitySlot: 1n, activityAgeSlots: age });
  const converterCandidate = (feedId: Address, legs: ReturnType<typeof leg>[], headroomSlots: bigint | null): MimirBetaConverterEligibility => ({ feedId, sourceConfig: feedId,
    slot: 9n, maxActivityAgeSlots: 150n, eligible: legs.every((l) => l.eligible), legs, headroomSlots });
  assert.deepEqual(rankMimirBetaConverterEligibility([converterCandidate(addr(1), [leg(false, 200n)], null), converterCandidate(addr(2), [leg(true, 1n), leg(true, 2n)], 148n),
    converterCandidate(addr(3), [leg(true, 90n)], 60n), converterCandidate(addr(4), [leg(true, 10n)], 140n)]).map(({ feedId }) => feedId), [addr(4), addr(3), addr(2), addr(1)],
    "eligible single source first, then weakest-leg headroom; refused last");
  assert.deepEqual([auto2.canonicalDraftJson, auto3.canonicalDraftJson], [auto1.canonicalDraftJson, auto1.canonicalDraftJson]);
  assert.deepEqual([auto2.draftHash, auto3.draftHash], [auto1.draftHash, auto1.draftHash]);
  const instructions = [...auto2.next!.transaction.instructions, ...auto3.next!.transaction.instructions];
  const { compileTransaction, getTransactionEncoder } = await import("@solana/transactions");
  const combined: import("@solana/transactions").Transaction = compileTransaction({ version: 1, feePayer: { address: creator },
    lifetimeConstraint: { blockhash: auto2.next!.transaction.recentBlockhash, lastValidBlockHeight: 99n },
    config: auto2.next!.transaction.packet.config, instructions: instructions.map((ix) => ({ ...ix,
      accounts: ix.accounts.map((a) => ({ address: a.address, role: a.isSigner ? a.isWritable ? 3 : 2 : a.isWritable ? 1 : 0 })) })) } as never);
  const combinedBytes = getTransactionEncoder().encode(combined).length;
  const combinedKeys = getCompiledTransactionMessageDecoder().decode(combined.messageBytes).staticAccounts.length;
  console.log("heavy combined packet:", { bytes: combinedBytes, keys: combinedKeys });
  assert.ok(combinedBytes > 4096 && combinedKeys <= 64);
  await assert.rejects(() => compileMimirBetaTransactionV1({ feePayer: creator, recentBlockhash: auto2.next!.transaction.recentBlockhash,
    lastValidBlockHeight: 99n, instructions }), code("TRANSACTION_TOO_LARGE"));
  const ar3 = await signedStageReceipt(auto3.next!);
  const done = await creationFixture(1, [creator], "composite", addr(9), { ...autoArgs, receipts: [ar1, ar2, ar3],
    configuredStateReceipt: ar1, observations: [observe(ar1), observe(ar2), observe(ar3)] });
  assert.equal(done.next, null);
  assert.equal(done.canonicalDraftJson, auto1.canonicalDraftJson);
  assert.equal(done.draftHash, auto1.draftHash);
  const calls = { blockhash: 0, simulation: 0 };
  const refusal = await creationFixture(1, [creator], "composite", addr(9), { ...autoArgs,
    existingComponentPool: (pool, index) => index < 2 ? pool : heavyArgs.existingComponentPool(pool, index),
    allowCollateralFunding: true, collateralAccountMissing: true, preparationCalls: calls }).catch((error: unknown) => error);
  assert.ok(refusal instanceof MimirBetaError && refusal.code === "COLLATERAL_REQUIRED", "the former 63-key initializer passes packet admission");
  assert.deepEqual(calls, { blockhash: 0, simulation: 0 });

}

// Composite quality admission: a row whose program-fixed confidence/spread exceeds the immutable caps refuses before any payable review.
{
  const { makeBetaCaptureFixture } = await import("./fixtures/betaCaptureFixtures.js");
  const { decodeMimirBetaCaptureCandidate, deriveMimirBetaCaptureReadPlan } = await import("../src/beta/capture.js");
  const { MimirBetaCompositeQualityError } = await import("../src/beta/errors.js");
  const { assertMimirBetaCompositeQuality, mimirBetaSourceQualityFloorBps } = await import("../src/beta/creation.js");
  const caps = { maxComponentConfidenceBps: 300, maxComponentDispersionBps: 100 };
  const component = async (family: "meteora-dlmm" | "raydium-clmm" | "orca-whirlpool", options: { binStep?: number; tickSpacing?: number; activeId?: number }) => {
    const capture = await makeBetaCaptureFixture(family, { seed: 30, baseMint: addr(181), quoteMint: common.quoteMint, ...options });
    const context = { observedSlot: 5n, observedUnixTimestamp: 1000n };
    const readPlan = deriveMimirBetaCaptureReadPlan({ descriptor: capture.input.descriptor, primary: capture.input.accounts[0]!, pair: capture.input.pair, context });
    const candidate = await decodeMimirBetaCaptureCandidate({ ...capture.input, context, expectedPlan: readPlan });
    return { pool: { ...candidate, eligibility: "eligible", observedSlot: 5n, validThroughSlot: 10n, evidenceHash: "b".repeat(64), readPlan,
      creation: capture.creation, minLiquidityNative: 1n, minDepthTo50BpsNative: 1n } as MimirBetaEligiblePool,
      accounts: capture.fixtureAccounts.map((account) => {
        if (family !== "meteora-dlmm" || account.address !== candidate.pool) return { ...account, lamports: 10n };
        const data = account.data.slice(); new DataView(data.buffer).setUint16(8, 10_000, true); // non-zero DLMM base fee: a qualifiable point pair
        return { ...account, data, lamports: 10n };
      }) };
  };
  const probe = async (family: "meteora-dlmm" | "raydium-clmm" | "orca-whirlpool", options: { binStep?: number; tickSpacing?: number; activeId?: number },
    edit = (accounts: OfflineNativeAccount[]) => accounts) => {
    const { pool, accounts } = await component(family, options); edit(accounts);
    const calls = { blockhash: 0, simulation: 0 };
    const result = await creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, qualityCaps: caps, preparationCalls: calls,
      creationBoundary: { source: "classic" as const, token2022Side: "base" as const },
      existingComponentPool: (p, index) => index === 1 ? pool : p, existingComponentAccounts: accounts }).catch((error: unknown) => error);
    return { result, calls };
  };
  for (const [family, options, metrics] of [
    ["meteora-dlmm", { binStep: 400 }, [["confidence", 400, 300], ["dispersion", 400, 100]]],
    ["meteora-dlmm", { binStep: 160 }, [["dispersion", 160, 100]]],
    ["raydium-clmm", { tickSpacing: 128 }, [["dispersion", 128, 100]]],
  ] as const) {
    const { result, calls } = await probe(family, options);
    assert.ok(result instanceof MimirBetaCompositeQualityError, `${family} ${JSON.stringify(options)}: ${String(result)}`);
    assert.equal(result.code, "COMPOSITE_QUALITY_INCOMPATIBLE");
    assert.deepEqual(result.violations.map((v) => [v.metric, v.valueBps, v.capBps]), metrics);
    assert.ok(result.violations.every((v) => v.role === "component" && v.position === 2 && v.family === family));
    assert.match(result.explanation, new RegExp(`^Component 2 \\(${family} [1-9A-HJ-NP-Za-km-z]+\\) has a ${metrics.at(-1)![1]} bps source`));
    assert.match(result.explanation, /Nothing was sent\.$/);
    assert.deepEqual(calls, { blockhash: 0, simulation: 0 }, "refused before any review, blockhash or simulation");
    console.log("composite quality refusal:", result.explanation);
  }
  // B2-1: a reused DLMM row (here a spot row, SourceConfig flags 0) runs the canonical point preflight before any review or payment.
  const oneSided = await probe("meteora-dlmm", { binStep: 100, activeId: 35 }, (accounts) => {
    const array = accounts.find((account) => { const f = account as { fixtureRole?: string; fixtureIndex?: number }; return f.fixtureRole === "depth-bin-array" && f.fixtureIndex === 0; })!;
    const data = array.data.slice(); new DataView(data.buffer).setBigUint64(56 + 35 * 144 + 8, 0n, true); accounts[accounts.indexOf(array)] = { ...array, data };
    return accounts;
  });
  assert.ok(oneSided.result instanceof MimirBetaError && oneSided.result.code === "DLMM_POINT_UNQUALIFIED" &&
    /not two-sided/.test(oneSided.result.message), String(oneSided.result));
  assert.deepEqual(oneSided.calls, { blockhash: 0, simulation: 0 }, "one-sided DLMM reuse refused before any review");
  const qualified = await probe("meteora-dlmm", { binStep: 100 });
  assert.ok(!(qualified.result instanceof MimirBetaError && qualified.result.code === "DLMM_POINT_UNQUALIFIED"), String(qualified.result));
  assert.ok(qualified.calls.simulation > 0, "a qualified reused DLMM row reaches review simulation");
  {
    const { mimirDlmmPointPreflight } = await import("../src/beta/live.js");
    const { pool, accounts } = await component("meteora-dlmm", { binStep: 400 });
    const rows = new Map(accounts.map((account) => [account.address, account]));
    const defaultFloor = await mimirDlmmPointPreflight(pool, rows, 5n, 1000n);
    const { mimirClassicNativeTail } = await import("../src/beta/live.js");
    const [oracleAddress] = await mimirClassicNativeTail(pool);
    const pairAccount = accounts.find((account) => account.address === pool.pool)!;
    pairAccount.data.set(addressBytes(oracleAddress!), 552);
    const oracleData = new Uint8Array(96); oracleData.set([139, 194, 131, 179, 140, 179, 229, 244]);
    putU64(oracleData, 24, 2n);
    const nativeAccounts = [...accounts, { address: oracleAddress!, owner: pool.programId, data: oracleData }]
      .map((account) => ({ ...account, data: new Uint8Array(account.data) }));
    const strictFloor = await mimirDlmmPointPreflight(pool, rows, 5n, 1000n, undefined, 9_000);
    assert.ok(strictFloor > defaultFloor);
    assert.equal(await mimirDlmmPointPreflight(pool, rows, 5n, 1000n, 50n), 50n,
      "a sealed .80 half-depth floor remains unchanged under the new default");
    assert.equal(await mimirDlmmPointPreflight(pool, rows, 5n, 1000n, 50n, 10_000), 50n,
      "sealed floor bypasses recalibration even under an explicit stricter fraction");
    await assert.rejects(mimirDlmmPointPreflight(pool, rows, 5n, 1000n, 10n ** 30n), (e: MimirBetaError) => e.code === "DLMM_POINT_UNQUALIFIED" &&
      /sealed depth floor/.test(e.message), "sealed-floor control still refused");
  }
  {
    const { withMimirBetaPoolBindingVariant } = await import("../src/beta/discovery.js");
    const { mimirDlmmPointPreflight, mimirClassicNativeTail } = await import("../src/beta/live.js");
    const capture = await makeBetaCaptureFixture("meteora-dlmm", { seed: 30, activeId: 0, binStep: 50,
      baseMint: addr(181), quoteMint: common.quoteMint, baseAmount: 2_000_000_000n, quoteAmount: 2_000_000_000n });
    const pair = capture.input.accounts[0]!; putU16(pair.data, 8, 20_000);
    const arrays = await Promise.all([-1, 0, 1].map(async (index) => {
      const le = new Uint8Array(8); new DataView(le.buffer).setBigInt64(0, BigInt(index), true);
      const [address] = await getProgramDerivedAddress({ programAddress: pair.owner,
        seeds: [utf8("bin_array"), addressBytes(pair.address), le] });
      const data = new Uint8Array(10_136); data.set([92, 142, 92, 220, 5, 148, 70, 181]); data[16] = 1;
      new DataView(data.buffer).setBigInt64(8, BigInt(index), true); data.set(addressBytes(pair.address), 24);
      return { address, owner: pair.owner, data };
    }));
    const stock = (heavy: bigint) => {
      for (const a of arrays) a.data.fill(0, 56);
      putU64(arrays[0]!.data, 56 + 69 * 144 + 8, heavy);
      putU64(arrays[1]!.data, 56, 10_000n); putU64(arrays[1]!.data, 64, 10_000n);
      putU64(arrays[1]!.data, 80, 1n); // active stored price Q64
      putU64(arrays[1]!.data, 56 + 144, heavy);
    };
    stock(1_000_000_000n);
    const context = { observedSlot: 5n, observedUnixTimestamp: 1_800_000_000n };
    const readPlan = deriveMimirBetaCaptureReadPlan({ descriptor: capture.input.descriptor, primary: pair, pair: capture.input.pair, context });
    const candidate = await decodeMimirBetaCaptureCandidate({ ...capture.input, context, expectedPlan: readPlan,
      accounts: capture.input.accounts.map((a) => ({ ...(arrays.find((b) => b.address === a.address) ?? a), executable: false })) });
    assert.equal(candidate.minDepthTo50BpsNative, 10_000n);
    const direct = { ...candidate, eligibility: "eligible", observedSlot: 5n, validThroughSlot: 10n, evidenceHash: "b".repeat(64), readPlan,
      creation: capture.creation, minLiquidityNative: 1n } as MimirBetaEligiblePool;
    const pool = await withMimirBetaPoolBindingVariant(direct, "routeable");
    const [oracleAddress] = await mimirClassicNativeTail(pool); pair.data.set(addressBytes(oracleAddress!), 552);
    const oracleData = new Uint8Array(128); oracleData.set([139, 194, 131, 179, 140, 179, 229, 244]);
    putU64(oracleData, 8, 2n); putU64(oracleData, 16, 3n); putU64(oracleData, 24, 3n);
    [[600n, 700n], [750n, 850n], [900n, 990n]].forEach(([created, updated], i) => {
      putU64(oracleData, 32 + 32 * i + 16, context.observedUnixTimestamp - 1000n + created!);
      putU64(oracleData, 32 + 32 * i + 24, context.observedUnixTimestamp - 1000n + updated!);
    });
    const accounts = [...capture.fixtureAccounts.filter((a) => !arrays.some((b) => a.address === b.address))
      .map((a) => ({ ...a, data: new Uint8Array(a.data) })), ...arrays,
      { address: oracleAddress!, owner: pair.owner, data: oracleData }];
    const prepare = (recipe: string | undefined, selected = pool, extra: Partial<NonNullable<Parameters<typeof creationFixture>[4]>> = {}) =>
      creationFixture(1, [creator], "classic", addr(9), { pools: [selected], ...(recipe ? { recipes: [recipe] } : {}),
        baseMint: pool.baseMint, tokenProgramId: MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, nativeAccounts: accounts, clockUnix: context.observedUnixTimestamp, ...extra });
    const calls = { blockhash: 0, simulation: 0 };
    await assert.rejects(prepare("dual-native-point", pool, { preparationCalls: calls, allowCollateralFunding: true, collateralAccountMissing: true }),
      (e: MimirBetaError) => e.code === "DLMM_POINT_UNQUALIFIED" && /sealed depth floor/.test(e.message));
    assert.deepEqual(calls, { blockhash: 0, simulation: 0 });
    const floorOf = (p: Awaited<ReturnType<typeof creationFixture>>) => {
      const append = p.next!.transaction.instructions.find((ix) => ix.data[0] === 78 && ix.data[1] === 1)!;
      return readU128(append.data, 73);
    };
    assert.equal(floorOf(await prepare("spot")), 90_000_900n);
    for (const selected of [pool, direct]) {
      const defaulted = await prepare(undefined, selected), spot = await prepare("spot", selected);
      assert.equal(defaulted.draftHash, spot.draftHash, "DLMM default is the existing legacy spot recipe for either binding");
      assert.equal(floorOf(defaulted), selected === pool ? 90_000_900n : 900n, "default seals 900 bps of its legacy window");
    }
    const inlineWire = { value: null as string | null };
    await assert.rejects(creationFixture(1, [creator], "composite", addr(9), { componentCount: 1,
      compositeCreateClassicPool: pool, nativeAccounts: accounts, clockUnix: context.observedUnixTimestamp,
      tokenProgramId: MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, simulationWire: inlineWire }), /captured activation simulation/);
    const inlineDecoded = decodeMimirInstructions(inlineWire.value!, addr(10));
    const inlineSeal = inlineDecoded.find(({ data }) => data[0] === 88 && data[1] === 2)!;
    assert.deepEqual([inlineSeal.data[38], inlineSeal.data[39]], [6, 0], "inline DLMM component default seals spot, without DUAL");
    assert.equal(readU128(inlineDecoded.find(({ data }) => data[0] === 78 && data[1] === 1)!.data, 73), 90_000_900n);

    assert.ok(50_000_500n < 90_000_900n, "matched full-basis 95% pull falls below the sealed legacy floor");
    assert.equal(floorOf(await prepare("spot", direct)), 900n, "direct stays clipped with heavy neighbors");
    assert.equal(floorOf(await prepare("current-point", direct, { simulatedPointOnlyRing: true })), 900n,
      "explicit compact point stays unchanged");
    const emittedFloor = async (recipe: string) => {
      const wire = { value: null as string | null };
      // Capture the actual builder wire before the generic simulator fabricates a publication.
      await assert.rejects(prepare(recipe, pool, { simulationWire: wire }), /captured activation simulation/);
      const append = decodeMimirInstructions(wire.value!, addr(10)).find(({ data }) => data[0] === 78 && data[1] === 1)!;
      return readU128(append.data, 73);
    };
    assert.equal(await emittedFloor("native-bounded"), 90_000_900n);
    stock(10_000n);
    assert.equal(await emittedFloor("dual-native-point"), 1_800n);
    const rows = new Map(accounts.map((a) => [a.address, { ...a, executable: false, lamports: 10n }]));
    assert.equal(await mimirDlmmPointPreflight(pool, rows, 5n, 1000n, 1_800n), 1_800n);
    const initial = await prepare("spot");
    const receipt = await signedStageReceipt(initial.next!);
    const feedId = initial.plan.feedId;
    const [sourceConfig] = await deriveMimirBetaPda({ programId: addr(10), seed: "source_config",
      values: [addressBytes(feedId), Uint8Array.of(0)] });
    const sourceData = Uint8Array.from(buildTestSourceConfigHeader(0));
    putU128(sourceData, SOURCE_OFFSETS.minDepthTo50BpsNative, 1_800n);
    sourceData.set(addressBytes(feedId), SOURCE_OFFSETS.feedId);
    stock(1_000_000_000n);
    const resumed = await prepare("spot", initial.selectedPools![0]!, { receipts: [receipt],
      nativeAccounts: [...accounts, { address: sourceConfig, owner: addr(10), data: sourceData }] });
    assert.equal(resumed.draftHash, initial.draftHash, "sealed ordinary routeable floor survives changed live legacy stock");
    stock(10_000n);
    for (const bad of ["missing", "index", "pool"] as const) {
      const broken = accounts.map((a) => ({ ...a, data: a.data.slice() }));
      const upper = broken.findIndex((a) => a.address === arrays[2]!.address);
      if (bad === "missing") broken.splice(upper, 1);
      else broken[upper]!.data[bad === "index" ? 8 : 24] ^= 1;
      const calls = { blockhash: 0, simulation: 0 };
      await assert.rejects(prepare("spot", pool, { nativeAccounts: broken, preparationCalls: calls,
        allowCollateralFunding: true, collateralAccountMissing: true }));
      assert.deepEqual(calls, { blockhash: 0, simulation: 0 }, `bad ${bad} neighbor refuses before payment`);
    }
  }
  const compatible = await probe("raydium-clmm", { tickSpacing: 100 });
  assert.ok(!(compatible.result instanceof MimirBetaCompositeQualityError), String(compatible.result));
  assert.ok(compatible.calls.simulation > 0, "a tick-100 CLMM component at the 100 bps cap passes admission and reaches review simulation");
  const floor = (family: "meteora-dlmm" | "raydium-clmm" | "orca-whirlpool", offset: number, value: number) => {
    const data = new Uint8Array(300); new DataView(data.buffer).setUint16(offset, value, true); return mimirBetaSourceQualityFloorBps(family, data);
  };
  assert.deepEqual(floor("orca-whirlpool", 41, 128), { confidenceBps: 5, spreadBps: 128 });
  assert.deepEqual(floor("raydium-clmm", 235, 20_000), { confidenceBps: 5, spreadBps: 10_000 });
  assert.deepEqual(mimirBetaSourceQualityFloorBps("pumpswap", null), { confidenceBps: 1, spreadBps: 0 });
  assert.deepEqual(mimirBetaSourceQualityFloorBps("meteora-damm-v2", null), { confidenceBps: 5, spreadBps: 5 });
  assert.throws(() => mimirBetaSourceQualityFloorBps("meteora-dlmm", null), code("CREATION_CONTEXT_REQUIRED"));
  const { pool } = await component("meteora-dlmm", {});
  const row = (role: "component" | "converter", step: number) => ({ role, position: 1, sourceConfig: addr(8), pool,
    poolData: (() => { const d = new Uint8Array(100); new DataView(d.buffer).setUint16(80, step, true); return d; })() });
  assertMimirBetaCompositeQuality(caps, [row("component", 100)]);
  assert.throws(() => assertMimirBetaCompositeQuality(caps, [row("component", 101)]), code("COMPOSITE_QUALITY_INCOMPATIBLE"));
  assertMimirBetaCompositeQuality(caps, [row("converter", 300)]);
  const converter = (() => { try { assertMimirBetaCompositeQuality(caps, [row("component", 50), row("converter", 301)]); } catch (e) { return e; } })();
  assert.ok(converter instanceof MimirBetaCompositeQualityError);
  assert.deepEqual(converter.violations.map((v) => [v.role, v.metric, v.valueBps, v.capBps]), [["converter", "confidence", 301, 300]]);
  assert.match(converter.explanation, /^SOL conversion source 1 \(meteora-dlmm /);
}

// Independent inline assemblies enter revalidation concurrently in input order.
{
  const pools = [74, 75].map((byte) => ({ ...liveCapacityPool, baseMint: addr(byte) }));
  const calls = { count: 0, maxInFlight: 0, baseMints: [] as Address[] };
  const floors: bigint[] = [];
  const refused = await creationFixture(1, [creator], "composite", addr(9), { componentCount: 2,
    compositeCreateClassicPools: pools, revalidationCalls: calls, rpcContextFloors: floors,
    revalidationSlot: (baseMint) => baseMint === pools[0]!.baseMint ? 5n : 9n }).catch((error: unknown) => error);
  assert.ok(refused instanceof MimirBetaError && refused.code === "TRANSACTION_TOO_LARGE", String(refused));
  assert.deepEqual(calls.baseMints, pools.map(({ baseMint }) => baseMint));
  assert.equal(calls.maxInFlight, 2, "inline assemblies enter revalidation concurrently");
  assert.deepEqual(floors, [5n, 9n, 9n], "root global context uses the maximum independently assembled slot");
}

// Wire: the refused probe packet activates (tag 80) a proposal that no earlier instruction in it creates.
{
  const wire = fs.readFileSync(new URL("./fixtures/point-proposal-classic-c63f9a22653d7377.b64", import.meta.url), "utf8").trim();
  const mimir = decodeMimirInstructions(wire, address("TYo5SEVfHyFzpjsbFVzNFKTnmLdBvdYjLxmnv32iQ9r"));
  assert.deepEqual(mimir.map(({ data }) => data[0]), [80, 90, 90, 89]);
  assert.equal(mimir.some(({ data }) => data[0] === 78), false, "no proposal-init/append ahead of the activation");
  assert.equal(mimir[0]!.accounts[1], address("5crmah34Fm25LndUiWJzCwZxihggd8pExQktDiKxSHxP"));
}

// Compositions whose non-spot venue groups can never exceed 5000 bps refuse typed; data readiness passes admission.
{
  const m = (...modes: number[]) => modes.map((mode) => ({ mode: mode as 0 }));
  const refuse = (modes: number[], groups: number[]) => assert.throws(() => assertMimirClassicBoundedMajorityPossible(m(...modes), groups, modes.length),
    code("CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT"));
  refuse([2, 0, 2], [1, 0, 1]);  // CLMM native + Orca spot + CPMM native
  refuse([2, 0], [1, 2]);  // CPMM native + DAMM spot
  refuse([0, 2, 0], [1, 2, 2]);  // CLMM spot + DLMM native + DAMM spot
  refuse([5, 0, 1], [1, 0, 2]); // point leg in one of three groups
  refuse([2, 0, 2, 0], [0, 1, 2, 3]);
  assertMimirClassicBoundedMajorityPossible(m(2, 0, 2), [2, 1, 1], 3); // DLMM native + CLMM spot + CPMM native
  assertMimirClassicBoundedMajorityPossible(m(0, 0), [0, 1], 2); // all spot: atomic-lite path
  assertMimirClassicBoundedMajorityPossible(m(5, 2, 0), [1, 2, 0], 3);
  assertMimirClassicBoundedMajorityPossible(m(2, 0), [1, 2], 1); // quorum shapes are not mixed-majority bound here
  // V1 mixed_majority_ok: the worst representative per domain counts; a domain holding a spot row is not bounded.
  const v1Refuse = (modes: number[], domains: number[]) => assert.throws(() => assertMimirV1MixedMajorityPossible(m(...modes), domains, modes.length),
    code("CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT"));
  v1Refuse([2, 0], [0, 1]);
  v1Refuse([2, 0, 2], [1, 0, 0]); // DLMM native, CLMM spot + CPMM native share a domain
  v1Refuse([2, 2, 0, 0], [0, 1, 2, 3]);
  assertMimirV1MixedMajorityPossible(m(2, 2, 0), [0, 1, 2], 3);
  assertMimirV1MixedMajorityPossible(m(2, 0), [0, 0], 1); // quorum
  assertMimirV1MixedMajorityPossible(m(5, 0), [0, 1], 2); // a point row exempts it
  assertMimirV1MixedMajorityPossible(m(0, 0), [0, 1], 2);
}

// A fresh composite whose canonical root already exists refuses typed with the existing address and ticker, before simulation.
{
  const args = { successfulCompositeActivation: true as const, componentCount: 2 as const };
  const created = await creationFixture(1, [creator], "composite", addr(9), args);
  const receipt = await signedStageReceipt(created.next!);
  const calls = { blockhash: 0, simulation: 0 };
  const duplicate = await creationFixture(1, [creator], "composite", addr(9), { ...args, configuredStateReceipt: receipt, preparationCalls: calls })
    .catch((error: unknown) => error);
  assert.ok(duplicate instanceof MimirBetaError && duplicate.code === "COMPOSITE_ALREADY_EXISTS", String(duplicate));
  assert.equal(duplicate.address, created.plan.feed);
  assert.match(duplicate.message, new RegExp(`\\(${common.ticker}\\)`));
  assert.equal(calls.simulation, 0);
}
console.log("probe and composition refusal tests passed");


// A landed native-bounded activation resumes to its own reconciliation; the pre-sign gates never refuse our own landed state.
{
  const observationData = (pool: Address, age: bigint, oldest = 700n) => { const d = new Uint8Array(4_075); const v = new DataView(d.buffer);
    d.set([122, 174, 197, 53, 129, 9, 165, 132]); d[8] = 1; v.setUint16(9, 1, true); d.set(addressBytes(pool), 11);
    v.setBigUint64(43, oldest, true); v.setBigUint64(83, 1000n - age, true); v.setBigUint64(4_043, 1000n - age, true); return d; };
  const native = (age: bigint, extra: Readonly<{ address: Address; owner: Address; data: Uint8Array<ArrayBuffer> }>[] = []) => ({ pools: [cpmmPool],
    recipes: ["native-bounded" as const], nativeAccounts: [{ address: cpmmObservation, owner: cpmmProgram, data: observationData(cpmmPoolAddress, age) }, ...extra] });
  const first = await creationFixture(1, [governanceAuthority], "classic", addr(9), native(5n));
  assert.deepEqual(first.plan.steps.map((step) => step.stepId), ["classic:activate"]);
  const receipt = await signedStageReceipt(first.next!);
  const landed = { state: "finalized" as const, stepId: receipt.stepId, signature: receipt.signature, observedSlot: 5n, accountContextSlot: 5n,
    messageHash: receipt.messageHash, evidenceHash: "e".repeat(64), writes: receipt.reviewedStep.step.expectedWrites.map((write, index) => ({
      index, address: write.address, kind: write.proof.kind, evidenceHash: "f".repeat(64) })) };
  for (const age of [100n, 5n]) {
    const resumed = await creationFixture(1, [governanceAuthority], "classic", addr(9), { ...native(age), pools: first.selectedPools!,
      receipts: [receipt], observations: [landed as never], assignedTickerConfig: first.plan.feed });
    assert.deepEqual([resumed.draftHash, resumed.reconciliation.action, resumed.next], [first.draftHash, "complete", null],
      `own landed activation and ticker reconcile (pool age ${age}s)`);
  }
  const [tickerPda] = await deriveMimirBetaTickerPda(addr(10), common.ticker);
  for (const ticker of [{ assignedTickerConfig: addr(99) }, { nativeAccounts: native(5n, [{ address: tickerPda, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, data: new Uint8Array(5) }]).nativeAccounts }]) {
    await assert.rejects(creationFixture(1, [governanceAuthority], "classic", addr(9), { ...native(5n), ...ticker }),
      (error: unknown) => error instanceof MimirBetaError && error.code === "ACCOUNT_MALFORMED", "a foreign or malformed ticker is still refused");
  }
  const split = await Promise.all([0, 1, 2, 3, 4].map(async (i) => {
    if (i === 0) return { pool: cpmmPool, observation: cpmmObservation };
    const pool = addr(240 + i);
    const staticAccounts = cpmmPool.creation.staticAccounts.map((a, j) => a.role === "pool" ? { ...a, address: pool } : a.role === "amm-config" ? a : { ...a, address: addr(244 + 2 * i + j) });
    const [observation] = await deriveMimirBetaPda({ programId: cpmmProgram, seed: "observation", values: [addressBytes(pool)] });
    return { pool: { ...cpmmPool, pool, descriptorId: `cpmm-${i}`, canonicalPairKey: `cpmm-${i}`, baseVault: staticAccounts[0]!.address,
      quoteVault: staticAccounts[1]!.address, creation: { ...cpmmPool.creation, staticAccounts, observationState: observation } } as MimirBetaEligiblePool, observation };
  }));
  const splitArgs = (age: bigint, oldest?: bigint) => ({ pools: split.map(({ pool }) => pool), recipes: split.map(() => "native-bounded" as const),
    nativeAccounts: split.map(({ pool, observation }) => ({ address: observation, owner: cpmmProgram, data: observationData(pool.pool, age, oldest) })) });
  const splitPlan = await creationFixture(1, [governanceAuthority], "classic", addr(9), splitArgs(5n));
  assert.deepEqual(splitPlan.plan.steps.map((step) => step.stepId), ["classic:proposal-init", "classic:activate", "classic:ready"]);
  const notReady = await creationFixture(1, [governanceAuthority], "classic", addr(9), splitArgs(100n, 880n)).catch((error: unknown) => error);
  assert.ok(notReady instanceof MimirClassicNativeNotReadyError && !notReady.activated && /^CLASSIC_NATIVE_NOT_READY:row 0/.test(notReady.message), String(notReady));
  const waiting = new MimirClassicNativeNotReadyError(notReady.readiness, true);
  assert.match(waiting.message, /^CLASSIC_NATIVE_NOT_READY:activation done; waiting for a fresh swap to publish: row 0/);
}
console.log("creation resume tests passed");

// Multi-transaction composite journey — one atomic child activation core per missing Classic, then the root from live references.
{
  const { MimirBetaCollateralRequiredError } = await import("../src/beta/errors.js");
  const childPools = (count: number) => Array.from({ length: count }, (_, index) => ({ ...liveCapacityPool, baseMint: addr(74 + index) }));
  type Journey = Awaited<ReturnType<typeof prepareMimirBetaCompositeFeedJourney>>;
  const journey = (count: number, extra: Parameters<typeof creationFixture>[4] = {}) => creationFixture(1, [creator], "composite", addr(9),
    { componentCount: count as 2, compositeCreateClassicPools: childPools(count), journey: {}, ...extra }) as unknown as Promise<Journey>;
  const tagsOf = (j: Journey) => j.next!.preparedStep.review.instructions.filter((ix) => ix.programAddress === addr(10)).map((ix) => fromBase64(ix.dataBase64)[0]);
  for (const count of [2, 4, 5]) {
    const prepared = await journey(count);
    assert.equal(prepared.action, "review-next-step", `${count}`);
    assert.deepEqual(prepared.state.operations.map(({ operationId }) => operationId), [...Array.from({ length: count }, (_, i) => `child:${i}`), "root"]);
    assert.equal(prepared.next!.operationId, "child:0");
    assert.deepEqual(tagsOf(prepared), [78, 78, 80], "core: proposal + source append + tag 80, never tag 81");
    assert.equal(prepared.next!.preparedStep.review.instructions.length, 5);
    assert.deepEqual(prepared.next!.preparedStep.step.requiredSigners, [creator, addr(50)]);
    assert.equal(prepared.next!.provisional, false);
    assert.deepEqual(prepared.packets.map(({ operationId, stepId }) => `${operationId}/${stepId}`).slice(0, count),
      Array.from({ length: count }, (_, i) => `child:${i}/classic:activate`));
    const rootPackets = prepared.packets.filter(({ operationId }) => operationId === "root");
    assert.ok(rootPackets.length >= 1 && prepared.packets.every(({ bytes, accounts }) => bytes <= 4_096 && accounts <= 64), JSON.stringify(prepared.packets));
    assert.ok(rootPackets.every(({ stepId, signatures }) => signatures === (stepId === "composite:activate" ? 2 : 1)), "root activation signs payer + root asset only");
    assert.equal(prepared.remainingCollateralRaw, computeMimirBetaTickerTariff(5n, common.ticker) +
      Array.from({ length: count }, (_, i) => computeMimirBetaTickerTariff(5n, `CHILD${i}`)).reduce((a, b) => a + b, 0n));
    assert.equal(prepared.root!.identityAsset, asset);
    // The same child core is reproducible: identical draft for an unchanged input.
    assert.equal((await journey(count)).next!.draftHash, prepared.next!.draftHash);
  }
  const batch = await journey(3, { journey: { reviewMode: "child-batch" } });
  assert.deepEqual(batch.childBatch!.map(({ operationId }) => operationId), ["child:0", "child:1", "child:2"]);
  assert.equal(new Set(batch.childBatch!.map(({ draftHash }) => draftHash)).size, 3);
  assert.ok(batch.childBatch!.every((entry) => entry.preparedStep.step.requiredSigners.length === 2));
  // Inline path still refuses two new children in one transaction (unchanged single-packet policy).
  const inline = await creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, compositeCreateClassicPools: childPools(2) }).catch((e: unknown) => e);
  assert.ok(inline instanceof MimirBetaError && inline.code === "TRANSACTION_TOO_LARGE");
  // Journey input rejects legacy receipts/observations and malformed state.
  await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, compositeCreateClassicPools: childPools(2),
    journey: { state: { schema: "mimir-beta-composite-journey-state", version: 1, intentHash: "0".repeat(64), inputRevision: 0, operations: [] } } }), code("RECONCILIATION_CONFLICT"));
  const fresh = await journey(2);
  const tooMany = { ...fresh.state, operations: [...fresh.state.operations, ...fresh.state.operations, ...fresh.state.operations, fresh.state.operations[0]!] };
  await assert.rejects(() => journey(2, { journey: { state: tooMany } }), code("INVALID_ARGUMENT"));
  await assert.rejects(() => journey(2, { journey: { state: { ...fresh.state, operations: [fresh.state.operations[0]!, fresh.state.operations[0]!] } } }), code("INVALID_ARGUMENT"));
  await assert.rejects(() => journey(2, { journey: { state: { ...fresh.state, operations: [{ ...fresh.state.operations[0]!, operationId: "child:4" }] } } }), code("INVALID_ARGUMENT"));
  // Funding: one aggregate requirement over every remaining child + root, bound to the parent intent, with the whole approval count.
  const funding = await journey(3, { allowCollateralFunding: true, collateralBalanceRaw: 0n }).catch((e: unknown) => e);
  assert.ok(funding instanceof MimirBetaCollateralRequiredError, String(funding));
  assert.equal(funding.draftHash, fresh.state.intentHash === funding.draftHash ? funding.draftHash : funding.compositeJourney!.intentHash);
  assert.equal(funding.draftHash, funding.compositeJourney!.intentHash);
  assert.equal(funding.requiredAmountRaw, computeMimirBetaTickerTariff(5n, common.ticker) + [0, 1, 2].reduce((a, i) => a + computeMimirBetaTickerTariff(5n, `CHILD${i}`), 0n));
  assert.deepEqual(funding.compositeJourney!.state.operations.map(({ operationId, receipts }) => [operationId, receipts.length]),
    [["child:0", 0], ["child:1", 0], ["child:2", 0], ["root", 0]]);
  assert.ok(Object.isFrozen(funding.compositeJourney) && funding.compositeJourney!.packets.length >= 4);
  assert.equal(JSON.stringify(funding.compositeJourney, (_, v) => typeof v === "bigint" ? v.toString() : v).includes("serializedTransaction"), false);
  console.log("composite journey preparation tests passed");

  // Receipt-bound continuation: a pending child blocks; processed status only provisionally unlocks the next child.
  const first = await journey(2);
  const receipt = await signedStageReceipt(first.next!.preparedStep);
  const pools = new Map([[0, first.next!.selectedPools![0]!]]);
  const withReceipt = { ...first.state, operations: first.state.operations.map((operation) => operation.operationId === "child:0"
    ? { ...operation, canonicalDraftJson: first.next!.canonicalDraftJson, receipts: [receipt] } : operation) };
  const awaiting = await journey(2, { journey: { state: withReceipt, childPools: pools } });
  assert.deepEqual([awaiting.action, awaiting.next], ["await-finality", null]);
  const statuses = (...values: unknown[]) => { let call = 0;
    return { getSignatureStatuses: () => ({ send: async () => ({ context: { slot: 9 }, value: [values[Math.min(call++, values.length - 1)]] }) }) }; };
  const landed = { slot: 5, confirmations: 0, err: null, confirmationStatus: "processed" };
  for (const status of [null, { ...landed, err: { InstructionError: [4, { Custom: 1 }] } }]) {
    const blocked = await journey(2, { journey: { state: withReceipt, childPools: pools, preparationCommitment: "processed", rpc: statuses(status) } });
    assert.deepEqual([blocked.action, blocked.next], ["await-finality", null], "missing or failed processed status never unlocks");
  }
  const simulations: { commitment: string; minContextSlot: bigint }[] = [];
  const provisional = await journey(2, { journey: { state: withReceipt, childPools: pools, preparationCommitment: "processed", rpc: statuses(landed), simulations } });
  assert.equal(provisional.next!.operationId, "child:1");
  assert.equal(provisional.next!.provisional, true);
  assert.deepEqual(provisional.next!.prerequisites, [{ signature: receipt.signature, slot: 5n, commitment: "processed" }]);
  assert.ok(simulations.length > 0 && simulations.every(({ commitment, minContextSlot }) => commitment === "processed" && minContextSlot >= 5n), JSON.stringify(simulations, (_, v) => typeof v === "bigint" ? `${v}` : v));
  assert.notEqual(provisional.action, "complete");
  await assert.rejects(() => journey(2, { journey: { state: withReceipt, childPools: pools, preparationCommitment: "processed",
    rpc: statuses({ ...landed, slot: 6 }) } }), code("RPC_CONTEXT_MISMATCH"), "planning context below the landed floor");
  const relocated: { commitment: string; minContextSlot: bigint }[] = [];
  await assert.rejects(() => journey(2, { journey: { state: withReceipt, childPools: pools, preparationCommitment: "processed", simulations: relocated,
    rpc: { getSignatureStatuses: () => ({ send: async () => ({ context: { slot: 9 }, value: [{ ...landed, slot: relocated.length ? 4 : 5 }] }) }) } } }),
  code("RECONCILIATION_CONFLICT"), "relocated prerequisite after the exact simulation");
  // A receipt-bound child keeps its identity and definition; a mutated identity or a swapped receipt is refused.
  await assert.rejects(() => journey(2, { journey: { state: { ...withReceipt, operations: withReceipt.operations.map((operation) =>
    operation.operationId === "child:0" ? { ...operation, identity: { ...operation.identity, asset: addr(99) } } : operation) }, childPools: pools } }), code("RECONCILIATION_CONFLICT"));
  await assert.rejects(() => journey(2, { journey: { state: { ...withReceipt, operations: withReceipt.operations.map((operation) =>
    operation.operationId === "root" ? { ...operation, receipts: [receipt], canonicalDraftJson: "{}" } : operation) }, childPools: pools } }), code("RECONCILIATION_CONFLICT"));
  await assert.rejects(() => journey(2, { journey: { state: { ...withReceipt, operations: withReceipt.operations.map((operation) =>
    operation.operationId === "child:1" ? { ...operation, receipts: [receipt], canonicalDraftJson: first.next!.canonicalDraftJson } : operation) }, childPools: pools } }),
    (e: unknown) => e instanceof MimirBetaError && ["RECONCILIATION_CONFLICT", "RECEIPT_MISMATCH"].includes(e.code));
  // Existing canonical child tuple: reused (no child op prepared, no child tariff); the root is prepared from live references only.
  const reusedJourney = await creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, compositeCreateClassicPool: liveCapacityPool,
    occupiedCompositeClassic: true, successfulCompositeActivation: true, journey: {} }) as unknown as Journey;
  assert.deepEqual([reusedJourney.reusedComponentIndexes, reusedJourney.next!.operationId], [[0], "root"]);
  assert.equal(reusedJourney.remainingCollateralRaw, computeMimirBetaTickerTariff(5n, common.ticker));
  const rootTags = tagsOf(reusedJourney);
  assert.ok(rootTags.includes(81) && !rootTags.includes(80) && !rootTags.includes(78), JSON.stringify(rootTags));
  assert.equal(reusedJourney.next!.preparedStep.review.identityAsset, asset);
  // An occupied tuple under another identity is refused before any child is prepared.
  const simulatedOther: { commitment: string; minContextSlot: bigint }[] = [];
  await assert.rejects(() => creationFixture(1, [creator], "composite", addr(9), { componentCount: 2, compositeCreateClassicPool: liveCapacityPool,
    occupiedCompositeClassic: true, occupiedIdentity: addr(61), successfulCompositeActivation: true, journey: { simulations: simulatedOther } }),
  (e: unknown) => e instanceof MimirBetaError && e.code === "RECONCILIATION_CONFLICT" && /under another identity/.test(e.message));
  assert.equal(simulatedOther.length, 0, "no child or root simulation before the refusal");
  // Funding estimate covers every remaining packet (children + root), one identity probe per operation.
  const capture = { rentReads: 0, feeMessages: [] as string[] };
  const estimated = await journey(2, { allowCollateralFunding: true, estimateFundingCosts: true, collateralBalanceRaw: 0n,
    fundingCostCapture: capture, fundingPayerLamports: 30_000_000n, simulationAccountOverrides: await identityProbePoststate([addr(50), addr(51), asset]) }).catch((e: unknown) => e);
  assert.ok(estimated instanceof MimirBetaCollateralRequiredError && estimated.fundingCosts, String(estimated));
  assert.equal(capture.feeMessages.length, estimated.compositeJourney!.packets.length, "one message fee per remaining packet");
  assert.ok(estimated.fundingCosts.identityLamports > 0n && estimated.fundingCosts.accountRentLamports > 0n);
  // Each identity probe debits the payer for its own group only; the debit check is per group, the reserve is the sum.
  const perGroup = await journey(2, { allowCollateralFunding: true, estimateFundingCosts: true, collateralBalanceRaw: 0n,
    fundingPayerLamports: 30_000_000n, simulationAccountOverrides: await identityProbePoststate([addr(50), addr(51), asset], 30_000_000n, 1) }).catch((e: unknown) => e);
  assert.ok(perGroup instanceof MimirBetaCollateralRequiredError && perGroup.fundingCosts, String(perGroup));
  assert.equal(perGroup.fundingCosts.identityLamports, estimated.fundingCosts.identityLamports);
  console.log("composite journey continuation tests passed");
}
