import { MIMIR_SAMPLED_SOURCE_ADAPTERS } from "../src/internal/sampledTemporalCore.js";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { getAddressFromPublicKey, type Address } from "@solana/addresses";
import { getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder } from "@solana/transaction-messages";
import { getTransactionDecoder, getTransactionEncoder, partiallySignTransaction, type Transaction } from "@solana/transactions";
import { readFileSync } from "node:fs";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { addressBytes, base64, bytesAddress, hex, sha256 } from "../src/beta/bytes.js";
import { MimirBetaError, MimirBetaStalePreparationError } from "../src/beta/errors.js";
import {
  MIMIR_BETA_TRANSACTION_V1_CONFIG,
  MIMIR_BETA_TRANSACTION_V1_MIN_PRIORITY_FEE_LAMPORTS,
  compileMimirBetaTransactionV1,
  isMimirBetaFeeOnlyWalletRewriteV1,
  isMimirBetaWalletRewriteV1,
  admitMimirBetaWalletSignedBatchV1,
  admitMimirBetaWalletSignedTransactionV1,
  mimirBetaReviewedMessageOfWalletV1,
  mimirBetaReviewCollateralTokenAccountV1,
  mimirBetaReviewedToWalletInstructionIndexesV1,
  partiallySignMimirBetaTransactionV1,
  verifyMimirBetaWalletSignedTransactionV1,
} from "../src/beta/transactionV1.js";
import { findOracleRegistryPda } from "../src/pda.js";
import { freshAdapterAccounts, mimirClassicNativeTail, mimirDlmmRouteableEdgeArrays, prepareMimirBetaClassicRefresh } from "../src/beta/live.js";
import { deriveMimirClassicExecutionAddress, mimirClassicExecutionLayout, mimirClassicRow } from "../src/beta/classicExecution.js";
import { encodeMimirFusedDescriptor, mimirAdmittedRecipe, mimirFusedRecipeBindingVariant } from "../src/beta/compositeExecution.js";
import { mimirRecipeTupleKey, type MimirAbi1Capability } from "../src/beta/abi1Release.js";
import { buildTestSnapshotHeader } from "../src/fixtures.js";
import { sealClassicExecution } from "./fixtures/compositeExecutionImage.js";
import { decodeMimirBetaLiveRing, decodeMimirBetaLiveSource } from "../src/beta/liveAbi.js";
import { buildMimirBetaClassicSourceArtifacts, deriveMimirBetaClassicFeedId, deriveMimirBetaFeedPdas, deriveMimirBetaPda } from "../src/beta/abi.js";
import { decodeMimirBetaCaptureCandidate, MIMIR_BETA_TOKEN_2022_PROGRAM_ID } from "../src/beta/capture.js";
import { makeBetaCaptureFixture } from "./fixtures/betaCaptureFixtures.js";
import { buildTestFeedConfigHeader, buildTestOracleRegistryHeader, buildTestSourceConfigHeader,
  buildTestSourceObservationRingHeader, buildTestSourcingPlanHeader } from "../src/fixtures.js";
import { computeLifecycleSourcingPlanHash, decodeSourcingPlanHeader } from "../src/codec.js";
import { CONFIG_OFFSETS, FEED_CONFIG_IDENTITY_ASSET_OFFSET, MIMIR_PROGRAM_ID, PLAN_OFFSETS, RING_OFFSETS,
  SOURCE_OFFSETS } from "../src/constants.js";
import type { MimirBetaPlanningRpc } from "../src/beta/client.js";
import { buildMimirBetaPoolCreationBinding, withMimirBetaPoolBindingVariant, type MimirBetaEligiblePool, type MimirBetaPoolDiscovery } from "../src/beta/discovery.js";
import type { MimirBetaAccount } from "../src/beta/types.js";

const addr = (byte: number) => bytesAddress(Uint8Array.from({ length: 32 }, () => byte));
const code = (expected: MimirBetaError["code"]) => (error: unknown) =>
  error instanceof MimirBetaError && error.code === expected;
const keyPair = async (): Promise<CryptoKeyPair> =>
  webcrypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]) as Promise<CryptoKeyPair>;

const walletKeyPair = await keyPair();
const assetKeyPair = await keyPair();
const wallet = await getAddressFromPublicKey(walletKeyPair.publicKey);
const asset = await getAddressFromPublicKey(assetKeyPair.publicKey);
const program = addr(9);
const transaction = await compileMimirBetaTransactionV1({
  feePayer: wallet,
  recentBlockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 50n,
  instructions: [{
    programAddress: program,
    accounts: [
      { address: wallet, isSigner: true, isWritable: true },
      { address: asset, isSigner: true, isWritable: true },
    ],
    data: Uint8Array.of(7),
  }],
});
assert.equal(transaction.messageVersion, 1);
assert.equal(transaction.serializedMessage[0], 0x81);
assert.equal(transaction.serializedTransaction[0], 0x81);
const compiledV1 = getCompiledTransactionMessageDecoder().decode(transaction.serializedMessage);
assert.equal(compiledV1.version, 1);
assert.equal(((compiledV1 as unknown as { addressTableLookups?: readonly unknown[] }).addressTableLookups?.length ?? 0), 0);
const defaultConfig = { ...MIMIR_BETA_TRANSACTION_V1_CONFIG, priorityFeeLamports: 14_000n };
assert.equal(MIMIR_BETA_TRANSACTION_V1_MIN_PRIORITY_FEE_LAMPORTS, 14_000n);
assert.deepEqual(transaction.config, defaultConfig);
assert.ok(transaction.config.priorityFeeLamports! * 1_000_000n / BigInt(transaction.config.computeUnitLimit) >= 10_000n);
assert.deepEqual(transaction.requiredSigners, [wallet, asset]);
assert.deepEqual(transaction.packet, {
  packetLimitBytes: 4096,
  serializedMessageBytes: transaction.serializedMessage.length,
  serializedTransactionBytes: transaction.serializedTransaction.length,
  accountCount: 3,
  instructionCount: 1,
  signatureCount: 2,
  config: defaultConfig,
  fitsPacketLimit: true,
});
assert.equal(transaction.serializedTransaction.length, transaction.serializedMessage.length + 128);
assert.ok(transaction.serializedTransaction.subarray(transaction.serializedMessage.length).every((byte) => byte === 0));

const assetPartial = await partiallySignMimirBetaTransactionV1({ transaction, signerAddress: asset, keyPair: assetKeyPair });
assert.equal(assetPartial.signature.address, asset);
assert.equal(assetPartial.signature.signature.length, 64);
assert.deepEqual(assetPartial.serializedTransaction.subarray(0, transaction.serializedMessage.length), transaction.serializedMessage);
const walletPartial = await partiallySignMimirBetaTransactionV1({
  transaction: { ...transaction, serializedTransaction: assetPartial.serializedTransaction },
  signerAddress: wallet,
  keyPair: walletKeyPair,
});
const finalized = await verifyMimirBetaWalletSignedTransactionV1({
  transaction,
  walletAddress: wallet,
  walletSignedTransaction: walletPartial.serializedTransaction,
  preservedSignatures: [assetPartial.signature],
});
assert.equal(finalized.firstSignature, finalized.signatures[0]!.signatureBase58);
assert.deepEqual(finalized.serializedTransaction, walletPartial.serializedTransaction);

const mutatedMessage = walletPartial.serializedTransaction.slice();
mutatedMessage[10] ^= 1;
await assert.rejects(() => verifyMimirBetaWalletSignedTransactionV1({
  transaction, walletAddress: wallet, walletSignedTransaction: mutatedMessage, preservedSignatures: [assetPartial.signature],
}), code("RECEIPT_MISMATCH"));
const erasedAsset = walletPartial.serializedTransaction.slice();
erasedAsset.fill(0, erasedAsset.length - 64, erasedAsset.length);
await assert.rejects(() => verifyMimirBetaWalletSignedTransactionV1({
  transaction, walletAddress: wallet, walletSignedTransaction: erasedAsset, preservedSignatures: [assetPartial.signature],
}), code("RECEIPT_MISMATCH"));
const v0 = walletPartial.serializedTransaction.slice(); v0[0] = 0x80;
await assert.rejects(() => verifyMimirBetaWalletSignedTransactionV1({
  transaction, walletAddress: wallet, walletSignedTransaction: v0, preservedSignatures: [assetPartial.signature],
}), code("TRANSACTION_MALFORMED"));

const feeU64 = (fee: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, fee, true); return b; };
const findBytes = (hay: Uint8Array, needle: Uint8Array) => hay.findIndex((_, i) => needle.every((byte, j) => hay[i + j] === byte));
const soloIx = [{ programAddress: program, accounts: [{ address: wallet, isSigner: true, isWritable: true }], data: Uint8Array.of(7) }];
const soloBase = { feePayer: wallet, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 50n, instructions: soloIx };
assert.equal((await compileMimirBetaTransactionV1({ ...soloBase, priorityFeeLamports: 0n })).config.priorityFeeLamports, 14_000n);
assert.equal((await compileMimirBetaTransactionV1({ ...soloBase, priorityFeeLamports: 90_000n })).config.priorityFeeLamports, 90_000n);
const solo = await compileMimirBetaTransactionV1(soloBase);
const feeAt = findBytes(solo.serializedMessage, feeU64(14_000n));
assert.ok(feeAt > 0);
const soloSigned = await partiallySignMimirBetaTransactionV1({ transaction: solo, signerAddress: wallet, keyPair: walletKeyPair });
assert.deepEqual((await verifyMimirBetaWalletSignedTransactionV1({ transaction: solo, walletAddress: wallet,
  walletSignedTransaction: soloSigned.serializedTransaction, preservedSignatures: [] })).serializedTransaction, soloSigned.serializedTransaction);
const rewrittenMessage = solo.serializedMessage.slice(); rewrittenMessage.set(feeU64(50_000n), feeAt);
const rewritten = await partiallySignMimirBetaTransactionV1({ transaction: { ...solo, serializedMessage: rewrittenMessage,
  serializedTransaction: Uint8Array.from([...rewrittenMessage, ...new Uint8Array(64)]) }, signerAddress: wallet, keyPair: walletKeyPair });
assert.deepEqual((await verifyMimirBetaWalletSignedTransactionV1({ transaction: solo, walletAddress: wallet,
  walletSignedTransaction: rewritten.serializedTransaction, preservedSignatures: [] })).serializedMessage, rewrittenMessage);

const base = { feePayer: wallet, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1n };
await assert.rejects(() => compileMimirBetaTransactionV1({ ...base, instructions: Array.from({ length: 65 }, () => ({
  programAddress: program, accounts: [], data: new Uint8Array(),
})) }), code("TRANSACTION_TOO_LARGE"));
await assert.rejects(() => compileMimirBetaTransactionV1({ ...base, instructions: [{
  programAddress: program,
  accounts: Array.from({ length: 64 }, (_, index) => ({ address: addr(index + 20), isSigner: false, isWritable: false })),
  data: new Uint8Array(),
}] }), code("TRANSACTION_TOO_LARGE"));
await assert.rejects(() => compileMimirBetaTransactionV1({ ...base, instructions: [{
  programAddress: program,
  accounts: Array.from({ length: 12 }, (_, index) => ({ address: addr(index + 100), isSigner: true, isWritable: false })),
  data: new Uint8Array(),
}] }), code("TRANSACTION_TOO_LARGE"));
await assert.rejects(() => compileMimirBetaTransactionV1({ ...base, instructions: [{
  programAddress: program, accounts: [], data: new Uint8Array(4096),
}] }), code("TRANSACTION_TOO_LARGE"));

const web3 = (byte: number) => new PublicKey(Uint8Array.from({ length: 32 }, () => byte));
const mimirProgram = web3(171); const payer = web3(172); const [registry] = findOracleRegistryPda(0, mimirProgram);
const refresh = { feedId: Uint8Array.from({ length: 32 }, () => 1), sourceIndex: 0, ringVersion: 1, minSlotGap: 1,
  expectedSourceConfigRevision: 1n, expectedSourceSetRevision: 1n, expectedPrevNewestSlot: 1n,
  expectedPlanHash: Uint8Array.from({ length: 32 }, () => 2) };
const membershipProof = { sourceSetSiblings: [3, 4, 5].map((byte) => Uint8Array.from({ length: 32 }, () => byte)),
  accountsSiblings: [6, 7, 8].map((byte) => Uint8Array.from({ length: 32 }, () => byte)) };

const writeU64 = (data: Uint8Array, offset: number, value: bigint) => new DataView(data.buffer, data.byteOffset).setBigUint64(offset, value, true);
const writeU128 = (data: Uint8Array, offset: number, value: bigint) => {
  writeU64(data, offset, value & ((1n << 64n) - 1n)); writeU64(data, offset + 8, value >> 64n);
};
const V1 = { windowFlags: 369, reserved: 382, activeMinDepth: 384, completedEndSlot: 448, completedPrice: 464, completedMinDepth: 480,
  completedMinLiquidity: 496, completedMinEconLoss: 512, completedMinCapital: 528 } as const;
const activeRingV1 = (adapterType: number): Uint8Array => {
  const data = new Uint8Array(544); data.set(buildTestSourceObservationRingHeader());
  const dataView = new DataView(data.buffer); dataView.setUint16(10, 544, true); dataView.setUint16(RING_OFFSETS.ringVersion, 1, true);
  data[RING_OFFSETS.adapterType] = adapterType; data[RING_OFFSETS.observationKind] = 0;
  dataView.setUint16(RING_OFFSETS.sampleCount, 1, true); dataView.setUint16(RING_OFFSETS.capacity, 300, true);
  dataView.setUint16(RING_OFFSETS.head, 0, true); dataView.setUint16(RING_OFFSETS.minSlotGap, 1, true);
  writeU64(data, RING_OFFSETS.oldestSlot, 100n); writeU64(data, RING_OFFSETS.newestSlot, 100n);
  writeU64(data, RING_OFFSETS.lastActivitySlot, 100n); writeU128(data, RING_OFFSETS.cumulativePriceX64, 0n);
  writeU64(data, RING_OFFSETS.cumulativeSlotDelta, 0n);
  return data;
};
for (const adapterType of [0, 1, 2, 3, 4, 6, 7]) assert.equal(decodeMimirBetaLiveRing(activeRingV1(adapterType)).adapterType, adapterType);
const nativeRing = activeRingV1(2); nativeRing[V1.windowFlags] = 3; writeU64(nativeRing, V1.completedEndSlot, 100n);
writeU128(nativeRing, V1.completedPrice, 1n); writeU128(nativeRing, V1.completedMinDepth, 1n);
writeU128(nativeRing, V1.completedMinLiquidity, 1n); writeU128(nativeRing, V1.completedMinEconLoss, 1n);
writeU128(nativeRing, V1.completedMinCapital, 1n); assert.equal(decodeMimirBetaLiveRing(nativeRing).windowFlags, 3);
const pausedRing = activeRingV1(0); pausedRing[RING_OFFSETS.status] = 2; pausedRing.fill(0, RING_OFFSETS.sampleCount, RING_OFFSETS.sourceConfigRevision);
pausedRing.fill(0, RING_OFFSETS.lastObservationHash, RING_OFFSETS.sourceConfig); pausedRing.fill(0, RING_OFFSETS.bump + 1, RING_OFFSETS.sourceWeightBps);
pausedRing.fill(0, RING_OFFSETS.capModelFlags); assert.equal(decodeMimirBetaLiveRing(pausedRing).status, 2);
const sentinelRingV1 = (adapterType: number): Uint8Array => {
  const data = activeRingV1(adapterType); data[RING_OFFSETS.status] = 2;
  data.fill(0, RING_OFFSETS.sampleCount, RING_OFFSETS.sourceConfigRevision);
  data.fill(0, RING_OFFSETS.lastObservationHash, RING_OFFSETS.sourceConfig);
  data.fill(0, RING_OFFSETS.bump + 1, RING_OFFSETS.sourceWeightBps); data.fill(0, RING_OFFSETS.capModelFlags);
  return data;
};
for (const mutate of [
  (data: Uint8Array) => { writeU128(data, V1.activeMinDepth, 1n); },
  (data: Uint8Array) => { data[V1.reserved] = 1; },
  (data: Uint8Array) => { data[V1.windowFlags] = 0x80; },
  (data: Uint8Array) => { data[V1.windowFlags] = 2; },
  (data: Uint8Array) => { writeU64(data, RING_OFFSETS.sourceConfigRevision, 0n); },
  (data: Uint8Array) => { writeU64(data, RING_OFFSETS.sourceSetRevision, 0n); },
]) {
  const malformed = activeRingV1(0); mutate(malformed); assert.throws(() => decodeMimirBetaLiveRing(malformed), /InvalidSourceRing/);
}
assert.throws(() => decodeMimirBetaLiveRing(activeRingV1(5)), /InvalidSourceRing/);
assert.throws(() => decodeMimirBetaLiveRing(activeRingV1(0).subarray(0, 384)), /InvalidAccountData/);

for (const [family, variant] of [...(["orca-whirlpool", "raydium-clmm", "raydium-cpmm", "meteora-dlmm", "raydium-amm-v4", "pumpswap"] as const)
  .map((family) => [family, "direct"] as const), ["meteora-dlmm", "routeable"] as const, ["raydium-clmm", "native"] as const]) {
  const seed = { "orca-whirlpool": 21, "raydium-clmm": 41, "raydium-cpmm": 11, "meteora-dlmm": 61,
    "raydium-amm-v4": 31, pumpswap: 91 }[family];
  const fixture = await makeBetaCaptureFixture(family, { seed });
  const candidate = await decodeMimirBetaCaptureCandidate(fixture.input);
  const directPool: MimirBetaEligiblePool = { family, adapterVersion: candidate.adapterVersion, token2022Mint: candidate.token2022Mint, token2022PolicyHash: candidate.token2022PolicyHash,
    programId: candidate.programId, pool: candidate.pool,
    descriptorId: candidate.descriptorId, descriptorHash: candidate.descriptorHash, readPlan: fixture.input.expectedPlan,
    canonicalMint0: candidate.canonicalMint0, canonicalMint1: candidate.canonicalMint1, canonicalPairKey: candidate.canonicalPairKey,
    direction: "quote-per-base", baseMint: candidate.baseMint, quoteMint: candidate.quoteMint, eligibility: "eligible",
    baseVault: candidate.baseVault, quoteVault: candidate.quoteVault, minLiquidityNative: candidate.minLiquidityNative,
    minDepthTo50BpsNative: candidate.minDepthTo50BpsNative, observedSlot: 100n, validThroughSlot: 300n,
    evidenceHash: ({ "orca-whirlpool": "0", "raydium-clmm": "1", "raydium-cpmm": "2", "meteora-dlmm": "3",
      "raydium-amm-v4": "4", pumpswap: "6" } as const)[family].repeat(64), creation: fixture.creation };
  const pool = variant === "routeable" ? withMimirBetaPoolBindingVariant(directPool, variant) : directPool;
  const nativeTail = variant === "native" ? await mimirClassicNativeTail(pool) : [];
  const programAddress = bytesAddress(MIMIR_PROGRAM_ID.toBytes()); const feedId = await deriveMimirBetaClassicFeedId(pool.baseMint, pool.quoteMint);
  const pdas = await deriveMimirBetaFeedPdas({ programId: programAddress, feedId });
  const [registryAddress, registryBump] = await deriveMimirBetaPda({ programId: programAddress, seed: "mimir_registry", values: [Uint8Array.of(0, 0)] });
  const [sourceConfig, sourceBump] = await deriveMimirBetaPda({ programId: programAddress, seed: "source_config", values: [addressBytes(feedId), Uint8Array.of(0)] });
  const [sourceRing, ringBump] = await deriveMimirBetaPda({ programId: programAddress, seed: "source_ring", values: [addressBytes(feedId), Uint8Array.of(0), Uint8Array.of(1, 0)] });
  const facts = fixture.creation.staticAccounts.map(({ address }) => {
    const account = fixture.fixtureAccounts.find((entry) => entry.address === address)!;
    return { address, owner: account.owner, executable: account.executable };
  });
  const artifacts = await buildMimirBetaClassicSourceArtifacts({ programId: programAddress, feedId, baseMint: pool.baseMint,
    quoteMint: pool.quoteMint, pools: [pool], physicalAccounts: facts });
  assert.equal(artifacts.artifacts[0]!.source.maxSourceWeightBps, 10_000);
  const fiveSourceArtifacts = await buildMimirBetaClassicSourceArtifacts({ programId: programAddress, feedId, baseMint: pool.baseMint,
    quoteMint: pool.quoteMint, pools: [pool, pool, pool, pool, pool], physicalAccounts: facts });
  assert.deepEqual(fiveSourceArtifacts.artifacts.map(({ source }) => source.maxSourceWeightBps), [2_000, 2_000, 2_000, 2_000, 2_000]);
  const registryData = buildTestOracleRegistryHeader((data) => {
    data.fill(0, 48, 80); writeU64(data, 80, 0xdfn); data[105] = registryBump;
    for (const adapter of [0, 1, 2, 3, 4, 6, 7]) new DataView(data.buffer).setUint16(106 + adapter * 2, 1, true);
  });
  const feedData = new Uint8Array(357); feedData.set(buildTestFeedConfigHeader());
  new DataView(feedData.buffer).setUint16(8, 1, true); new DataView(feedData.buffer).setUint16(10, 357, true);
  feedData.set(addressBytes(feedId), CONFIG_OFFSETS.feedId); feedData.set(addressBytes(pool.baseMint), CONFIG_OFFSETS.baseMint);
  feedData.set(addressBytes(pool.quoteMint), CONFIG_OFFSETS.quoteMint); feedData.set(artifacts.sourceSetRoot, CONFIG_OFFSETS.sourceSetHash);
  feedData.set(addressBytes(pdas.sourcingPlan[0]), CONFIG_OFFSETS.defaultSourcingPlan); feedData.set(addressBytes(pdas.sourcingPlan[0]), CONFIG_OFFSETS.fallbackSourcingPlan);
  feedData[CONFIG_OFFSETS.minSourceCount] = 1; feedData[CONFIG_OFFSETS.minVenueCount] = 1; feedData[CONFIG_OFFSETS.minCorrelationGroupCount] = 1;
  feedData[CONFIG_OFFSETS.bump] = pdas.feed[1]; feedData.set(addressBytes(addr(199)), FEED_CONFIG_IDENTITY_ASSET_OFFSET);
  const planData = buildTestSourcingPlanHeader((data) => {
    data.set(addressBytes(feedId), PLAN_OFFSETS.feedId); new DataView(data.buffer).setUint16(PLAN_OFFSETS.planId, 0, true);
    new DataView(data.buffer).setUint16(PLAN_OFFSETS.planVersion, 0, true); data[PLAN_OFFSETS.minSources] = 1; data[PLAN_OFFSETS.minVenues] = 1;
    data[PLAN_OFFSETS.minCorrelationGroups] = 1; data.set(addressBytes(pool.baseMint), PLAN_OFFSETS.baseMint); data.set(addressBytes(pool.quoteMint), PLAN_OFFSETS.quoteMint);
    data.set(artifacts.sourceSetRoot, PLAN_OFFSETS.sourceSetHash); data.set(artifacts.staticAccountsRoot, PLAN_OFFSETS.accountsHash);
    data.set(addressBytes(pdas.twap[0]), PLAN_OFFSETS.twapState); writeU64(data, PLAN_OFFSETS.adapterMask, artifacts.adapterMask);
    data[PLAN_OFFSETS.bump] = pdas.sourcingPlan[1]; data[PLAN_OFFSETS.hashSchemeVersion] = 1;
    new DataView(data.buffer).setUint16(PLAN_OFFSETS.ringVersion, 1, true); data[PLAN_OFFSETS.accountsBindingVersion] = 1;
  });
  const decodedPlan = decodeSourcingPlanHeader(planData); planData.set(computeLifecycleSourcingPlanHash({ ...decodedPlan,
    hashSchemeVersion: 1, ringVersion: 1, accountsBindingVersion: 1 }), PLAN_OFFSETS.planHash);
  const sourceData = buildTestSourceConfigHeader(0, (data) => {
    const source = artifacts.artifacts[0]!.source; data.set(addressBytes(feedId), SOURCE_OFFSETS.feedId); data[SOURCE_OFFSETS.adapterType] = source.adapterType;
    data[SOURCE_OFFSETS.direction] = source.direction; for (const [offset, value] of [[SOURCE_OFFSETS.venueGroup, source.venueGroup],
      [SOURCE_OFFSETS.operatorGroup, source.operatorGroup], [SOURCE_OFFSETS.liquidityOwnerGroup, source.liquidityOwnerGroup],
      [SOURCE_OFFSETS.routeCorrelationGroup, source.routeCorrelationGroup], [SOURCE_OFFSETS.quoteAssetGroup, source.quoteAssetGroup],
      [SOURCE_OFFSETS.bridgeOrWrapperGroup, source.bridgeOrWrapperGroup], [SOURCE_OFFSETS.oracleSourceClass, source.oracleSourceClass],
      [SOURCE_OFFSETS.upgradeAuthorityGroup, source.upgradeAuthorityGroup], [SOURCE_OFFSETS.maxSourceWeightBps, source.maxSourceWeightBps]] as const) {
      new DataView(data.buffer).setUint16(offset, value, true);
    }
    writeU128(data, SOURCE_OFFSETS.minLiquidityNative, source.minLiquidityNative); writeU128(data, SOURCE_OFFSETS.minDepthTo50BpsNative, source.minDepthTo50BpsNative);
    for (const [offset, value] of [[SOURCE_OFFSETS.programId, source.programId], [SOURCE_OFFSETS.poolOrMarket, source.poolOrMarket],
      [SOURCE_OFFSETS.baseVault, source.baseVault], [SOURCE_OFFSETS.quoteVault, source.quoteVault], [SOURCE_OFFSETS.baseMint, pool.baseMint],
      [SOURCE_OFFSETS.quoteMint, pool.quoteMint], [SOURCE_OFFSETS.tokenProgram, source.tokenProgram], [SOURCE_OFFSETS.vaultAuthority, source.vaultAuthority]] as const) data.set(addressBytes(value), offset);
    data[SOURCE_OFFSETS.bump] = sourceBump;
  });
  const ringData = family === "orca-whirlpool" ? sentinelRingV1(pool.creation.adapterType) : activeRingV1(pool.creation.adapterType);
  ringData.set(addressBytes(feedId), RING_OFFSETS.feedId);
  ringData.set(addressBytes(sourceConfig), RING_OFFSETS.sourceConfig); ringData.set(addressBytes(pool.pool), RING_OFFSETS.poolOrMarket);
  ringData.set(planData.subarray(PLAN_OFFSETS.planHash, PLAN_OFFSETS.planHash + 32), RING_OFFSETS.selectedPlanHash); ringData[RING_OFFSETS.bump] = ringBump;
  const accountRows = new Map<string, { owner: Address; executable: boolean; data: Uint8Array }>();
  const add = (key: Address, owner: Address, executable: boolean, data: Uint8Array) => accountRows.set(key, { owner, executable, data });
  add(registryAddress, programAddress, false, registryData); add(pdas.feed[0], programAddress, false, feedData);
  add(pdas.sourcingPlan[0], programAddress, false, planData); add(sourceConfig, programAddress, false, sourceData); add(sourceRing, programAddress, false, ringData);
  for (const account of fixture.fixtureAccounts) if (fixture.creation.staticAccounts.some((entry) => entry.address === account.address) ||
      fixture.creation.observationState === account.address || pool.readPlan.allAddresses.includes(account.address)) {
    add(account.address, account.owner, account.executable, account.data);
  }
  if (variant === "routeable") {
    const binArray = accountRows.get(pool.readPlan.auxiliary.find((entry) => entry.role === "depth-bin-array")!.address)!;
    for (const edge of await mimirDlmmRouteableEdgeArrays(pool)) add(edge, binArray.owner, false, binArray.data);
  }
  if (variant === "native") add(pdas.twap[0], programAddress, false, new Uint8Array(64));
  const clockData = new Uint8Array(40); new DataView(clockData.buffer).setBigUint64(0, 200n, true);
  new DataView(clockData.buffer).setBigInt64(32, pool.readPlan.context.observedUnixTimestamp, true);
  add("SysvarC1ock11111111111111111111111111111111" as Address, "Sysvar1111111111111111111111111111111111111" as Address, false, clockData);
  const rpcAccount = (row: { owner: Address; executable: boolean; data: Uint8Array }) => ({ owner: row.owner, executable: row.executable, lamports: 1, data: [base64(row.data), "base64"] });
  const pending = <T>(value: T) => ({ send: async () => value });
  let blockhashCalls = 0; let simulationCalls = 0;
  let postSnapshot = (data: Uint8Array): Uint8Array | null => data; let postOwner = programAddress; let postRequests: unknown[] = [];
  const simulated = (config: unknown) => {
    const requested = (config as { accounts?: { addresses: Address[] } }).accounts?.addresses; postRequests.push(requested);
    if (!requested) return { err: null, logs: [], unitsConsumed: 1 };
    const data = new Uint8Array(512); data.set(buildTestSnapshotHeader()); const view = new DataView(data.buffer);
    view.setBigUint64(96, new DataView(accountRows.get(pdas.snapshot[0])!.data.buffer).getBigUint64(96, true) + 1n, true); view.setBigInt64(132, 1n, true);
    data.set(addressBytes(feedId), 16); data.set(addressBytes(pdas.feed[0]), 48); view.setBigUint64(88, new DataView(feedData.buffer).getBigUint64(CONFIG_OFFSETS.feedConfigRevision, true), true);
    data.set(planData.subarray(PLAN_OFFSETS.planHash, PLAN_OFFSETS.planHash + 32), 262); view.setBigUint64(116, 200n, true); view.setBigUint64(124, 210n, true);
    const post = postSnapshot(data);
    return { err: null, logs: [], unitsConsumed: 1, accounts: requested.map(() => post && rpcAccount({ owner: postOwner, executable: false, data: post })) };
  };
  const sampledFamily = family === "raydium-amm-v4" || family === "pumpswap";
  const starts = { rpc: 0, revalidations: 0 }; let cohortExecution: Uint8Array | null = null;
  const liveRpc: MimirBetaPlanningRpc = {
    getAccountInfo: (key) => pending({ context: { slot: 200 }, value: accountRows.has(key) ? rpcAccount(accountRows.get(key)!) : null }),
    getMultipleAccounts: (keys, config) => (starts.rpc += 1, pending({ context: { slot: sampledFamily && (config as { commitment?: string } | undefined)?.commitment === "finalized" ? 100 : 200 }, value: keys.map((key) =>
      cohortExecution && keys.length > 1 && key === execution ? rpcAccount({ ...accountRows.get(key)!, data: cohortExecution }) : accountRows.has(key) ? rpcAccount(accountRows.get(key)!) : null) })),
    getLatestBlockhash: () => { blockhashCalls += 1; starts.rpc += 1; return pending({ value: { blockhash: base.recentBlockhash, lastValidBlockHeight: 250 } }); },
    simulateTransaction: (_wire, config) => { simulationCalls += 1; starts.rpc += 1; return pending({ context: { slot: 200 }, value: simulated(config) }); },
  };
  const dynamic = pool.creation.adapterType === 0 || pool.creation.adapterType === 1 || pool.creation.adapterType === 3;
  const stalePool = dynamic ? { ...pool, readPlan: { ...pool.readPlan, auxiliary: pool.readPlan.auxiliary.map((node, index) =>
    index === 0 ? { ...node, address: addr(240) } : node), allAddresses: pool.readPlan.allAddresses.map((entry, index) => index === 1 ? addr(240) : entry) } } : pool;
  const aboveFloorPool = { ...pool, minLiquidityNative: pool.minLiquidityNative + 1n,
    minDepthTo50BpsNative: pool.minDepthTo50BpsNative + 1n };
  let freshPool = aboveFloorPool;
  const discovery: MimirBetaPoolDiscovery = { listPoolSources: async () => [], searchSpotPools: async () => { throw new Error("unused"); },
    revalidateSelectedPools: async ({ pools }) => (starts.revalidations += 1, { slot: 150n, pools, freshPools: [freshPool] }) };
  const sampledFamilyMode = family === "raydium-amm-v4" || family === "pumpswap" ? "sample" as const : "publish" as const;
  const liveAdapterAccounts = await freshAdapterAccounts(pool, new Map([...accountRows].map(([key, row]) => [key as Address,
    { address: key as Address, owner: row.owner, executable: row.executable, lamports: 1n, data: row.data }])), true);
  const classicRow = mimirClassicRow({ role: "primary", adapterType: pool.creation.adapterType, adapterVersion: pool.creation.adapterVersion,
    currentPoint: false, sourceConfig, feedConfig: pdas.feed[0], sourcingPlan: pdas.sourcingPlan[0],
    adapterAccounts: pool.creation.adapterType === 2 ? liveAdapterAccounts.slice(0, 4) : [...liveAdapterAccounts, ...nativeTail],
    witness: { feedId: addressBytes(feedId), sourceIndex: 0, ringVersion: 1, minSlotGap: 1, expectedSourceConfigRevision: 1n,
      expectedSourceSetRevision: 1n, expectedPlanHash: planData.subarray(PLAN_OFFSETS.planHash, PLAN_OFFSETS.planHash + 32),
      sourceSetSiblings: artifacts.artifacts[0]!.sourceRootProof, accountsSiblings: artifacts.artifacts[0]!.accountRootProof } });
  const classicLayout = mimirClassicExecutionLayout([classicRow.recipe], []);
  const [execution, executionBump] = await deriveMimirClassicExecutionAddress(programAddress, addressBytes(feedId));
  const executionData = new Uint8Array(classicLayout.exactLength); const executionView = new DataView(executionData.buffer);
  executionData.set(new TextEncoder().encode("MIMIRCLX")); executionView.setUint16(8, 1, true); executionView.setUint16(10, 384, true);
  executionView.setUint32(12, executionData.length, true); executionData.set(addressBytes(feedId), 16); executionData.set(addressBytes(pdas.snapshot[0]), 48);
  executionData.fill(0xd1, 80, 112); executionView.setBigUint64(112, 1n, true); executionData[120] = 1; executionData[122] = executionBump; executionData[123] = 1;
  executionData.set(feedData, 384); executionData.set(planData, 741);
  executionData.set(encodeMimirFusedDescriptor(classicLayout.descriptors[0]!), classicLayout.rowOffsets[0]!);
  executionData.set(sourceData, classicLayout.rowOffsets[0]! + 16);
  const membership = classicLayout.membershipOffsets[0]!; executionData[membership] = classicLayout.descriptors[0]!.bindingWidth; executionData[membership + 1] = 1;
  { const d = classicLayout.descriptors[0]!; executionData[membership + 2] = mimirAdmittedRecipe({ adapterType: d.adapterType, adapterVersion: d.adapterVersion,
    accountsBindingVersion: 1, mode: d.mode, externalWidth: d.externalWidth, temporalKind: d.temporalKind, converterRow: true, pointOk: true }).bindingVariant; }
  for (let i = 0; i < classicLayout.descriptors[0]!.bindingWidth; i += 1) executionData.set(addressBytes(addr(150 + i)), membership + 4 + 65 * i);
  const sealedExecution = sealClassicExecution(executionData, programAddress, execution); add(execution, programAddress, false, sealedExecution);
  const snapshotData = new Uint8Array(512); snapshotData.set(buildTestSnapshotHeader()); new DataView(snapshotData.buffer).setBigUint64(96, 0n, true);
  add(pdas.snapshot[0], programAddress, false, snapshotData);
  const prepareMode = (mode: "sample" | "publish") => prepareMimirBetaClassicRefresh({ deployment: { cluster: "localnet", mimirProgramId: programAddress,
    agentRegistryProgramId: addr(181), mplCoreProgramId: addr(182), systemProgramId: "11111111111111111111111111111111" as Address,
    physicalCollection: addr(183), collectionPointer: "c1:bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", tokenProgramId: addr(184) },
    rpc: liveRpc, discovery }, { payer: addr(172), pools: [stalePool], mode, declaredMaxSnapshotAge: 10 });
  const prepare = () => prepareMode(sampledFamilyMode);
  const startsBefore = { ...starts };
  const prepared = await prepare();
  assert.deepEqual([starts.revalidations - startsBefore.revalidations, starts.rpc - startsBefore.rpc], [1, 4],
    "one primary load, native-tailed or not: execution probe, primary cohort, blockhash, simulation");
  if (variant === "native") {
    assert.equal(classicLayout.descriptors[0]!.mode, 2);
    cohortExecution = Uint8Array.from(sealedExecution); cohortExecution[cohortExecution.length - 1]! ^= 1;
    try { await assert.rejects(prepare, /classic execution changed/, "the probed execution must equal the coherent cohort's"); }
    finally { cohortExecution = null; }
  }
  {
    const d = classicLayout.descriptors[0]!; const tuple = mimirRecipeTupleKey(d);
    const cell = { id: "c", action: sampledFamilyMode, executionKind: "classic", primarySourceCount: 1, converterSourceCount: 0, sourceCount: 1, converter: false,
      recipe: tuple, recipeTupleKeys: [tuple], status: "measured", cuAfter: 1, fixtureSha256: "1".repeat(64), outputSha256: "2".repeat(64), instructionsSha256: "3".repeat(64) };
    const abi1Capability = { manifestSha256: "", cells: new Map([["c", cell]]), manifest: { clusterGenesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", programId: programAddress, recipes: [{ adapterType: d.adapterType,
      adapterVersion: d.adapterVersion, mode: d.mode, temporalKind: d.temporalKind, externalWidth: d.externalWidth, bindingWidth: d.bindingWidth,
      accountsBindingVersion: d.accountsBindingVersion, bindingVariant: mimirFusedRecipeBindingVariant(d), clusterEnabled: true,
      exactElfCells: { [sampledFamilyMode]: ["c"] } }] } } as unknown as MimirAbi1Capability;
    const devnet = (deps: object) => prepareMimirBetaClassicRefresh({ deployment: { cluster: "devnet", mimirProgramId: programAddress,
      agentRegistryProgramId: addr(181), mplCoreProgramId: addr(182), systemProgramId: "11111111111111111111111111111111" as Address,
      physicalCollection: addr(183), collectionPointer: "c1:bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", tokenProgramId: addr(184) },
      rpc: liveRpc, discovery, ...deps } as never, { payer: addr(172), pools: [stalePool], mode: sampledFamilyMode, declaredMaxSnapshotAge: 10 });
    await assert.rejects(devnet({}), /no verified capability/);
    if (d.mode === 4) await assert.rejects(devnet({ abi1Capability }), /mode-4 arm outside the release recipe scope/);
    else {
    assert.equal((await devnet({ abi1Capability })).mode, sampledFamilyMode, "classic refresh defaults to the client's verified capability");
    const mainnet = (units: unknown) => prepareMimirBetaClassicRefresh({ deployment: { cluster: "mainnet-beta", mimirProgramId: programAddress,
      agentRegistryProgramId: addr(181), mplCoreProgramId: addr(182), systemProgramId: "11111111111111111111111111111111" as Address,
      physicalCollection: addr(183), collectionPointer: "c1:bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", tokenProgramId: addr(184) },
      rpc: { ...liveRpc, simulateTransaction: (_wire: unknown, config: unknown) => pending({ context: { slot: 200 }, value: { ...simulated(config), unitsConsumed: units } }) }, discovery, abi1Capability: { ...abi1Capability, manifest: { ...abi1Capability.manifest, clusterGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" } } } as never,
      { payer: addr(172), pools: [stalePool], mode: sampledFamilyMode, declaredMaxSnapshotAge: 10 });
    assert.equal((await mainnet(1)).simulation.unitsConsumed, 1n);
    for (const units of [undefined, 0, 1_400_001]) await assert.rejects(mainnet(units), /no valid compute units/, "mainnet refresh needs strict simulation CU");
    }
  }
  for (const [mutate, reason] of [[(d: Uint8Array) => { d[123] = 0; }, "ClassicExecutionNotReady"], [(d: Uint8Array) => { d[80] ^= 1; }, "definition digest"]] as const) {
    const bad = Uint8Array.from(sealedExecution); mutate(bad); add(execution, programAddress, false, bad);
    try { await assert.rejects(prepare, new RegExp(reason)); } finally { add(execution, programAddress, false, sealedExecution); }
  }
  const warming = Uint8Array.from(snapshotData); warming[252] = 0;
  for (const snapshot of [new Uint8Array(512), warming]) {
    add(pdas.snapshot[0], programAddress, false, snapshot);
    try { for (const mode of ["sample", "publish"] as const) assert.equal((await prepareMode(mode)).mode, mode); }
    finally { add(pdas.snapshot[0], programAddress, false, snapshotData); }
  }
  if (!sampledFamily) {
    const descriptor = classicLayout.descriptors[0]!;
    const publishOnce = async (expected: MimirBetaError["code"] | null) => {
      const beforeSimulation = simulationCalls; postRequests = [];
      if (expected) await assert.rejects(prepareMode("publish"), code(expected));
      else assert.equal((await prepareMode("publish")).transaction.instructions.length, 1);
      assert.equal(simulationCalls, beforeSimulation + 1); assert.deepEqual(postRequests, [[pdas.snapshot[0]]]);
    };
    await publishOnce(null);
    for (const [mutate, expected] of [
      [(d: Uint8Array) => { d[104] = 1; return d; }, "CLASSIC_PUBLICATION_NOT_FRESH"],
      [(d: Uint8Array) => { d[104] = 2; return d; }, "CLASSIC_PUBLICATION_NOT_FRESH"],
      [(d: Uint8Array) => { new DataView(d.buffer).setBigUint64(96, 0n, true); return d; }, null],
      [(d: Uint8Array) => { const v = new DataView(d.buffer); v.setBigUint64(96, 0n, true); v.setBigUint64(116, 50n, true); return d; }, "CLASSIC_PUBLICATION_NOT_FRESH"],
      [(d: Uint8Array) => { new DataView(d.buffer).setBigUint64(96, 2n, true); return d; }, null],
      [(d: Uint8Array) => { d[104] = 1; new DataView(d.buffer).setBigUint64(96, 2n, true); return d; }, "CLASSIC_PUBLICATION_NOT_FRESH"],
      [(d: Uint8Array) => { new DataView(d.buffer).setBigInt64(132, 0n, true); return d; }, "CLASSIC_PUBLICATION_NOT_FRESH"],
      [() => null, "SIMULATION_FAILED"],
      [(d: Uint8Array) => d.subarray(0, 511), "ACCOUNT_MALFORMED"],
    ] as const) {
      postSnapshot = mutate;
      try { await publishOnce(expected); } finally { postSnapshot = (d) => d; }
    }
    postOwner = addr(241);
    try { await publishOnce("ACCOUNT_MALFORMED"); } finally { postOwner = programAddress; }
    postSnapshot = (d) => { d[104] = 1; return d; };
    try {
      postRequests = []; assert.equal((await prepareMode("sample")).mode, "sample"); assert.deepEqual(postRequests, [undefined]);
    } finally { postSnapshot = (d) => d; }
    if (family === "meteora-dlmm") assert.deepEqual([descriptor.adapterVersion, mimirFusedRecipeBindingVariant(descriptor)], [0, variant === "routeable" ? 1 : 0]);
  }
  add(execution, addr(241), false, sealedExecution);
  try { await assert.rejects(prepare); } finally { add(execution, programAddress, false, sealedExecution); }
  if (sampledFamily) assert.equal((await prepare()).mode, "sample");
  assert.equal(prepared.mode, sampledFamilyMode); assert.equal(prepared.execution, execution);
  const tag89 = prepared.transaction.instructions[0]!;
  assert.equal(tag89.data[0], 89); assert.equal(tag89.data.length, 112);
  assert.deepEqual(tag89.accounts.slice(0, 3).map(({ address, isWritable }) => [address, isWritable]),
    [[pdas.snapshot[0], true], [registryAddress, false], [execution, true]]);
  assert.deepEqual(tag89.accounts.slice(3, 3 + classicRow.externals.length).map(({ address }) => address), classicRow.externals);
  assert.equal(tag89.accounts.length, 3 + classicRow.externals.length + (classicRow.recipe.requiresInstructionsSysvar ? 1 : 0));
  if (dynamic) for (const node of pool.creation.adapterType === 3
    ? [pool.readPlan.auxiliary.find((entry) => entry.role === "depth-bin-array" && entry.index === "0")!]
    : ["tick-array-lower", "tick-array-active", "tick-array-upper"].map((role) => pool.readPlan.auxiliary.find((entry) => entry.role === role)!)) {
    assert.ok(classicRow.externals.includes(node.address));
  }
  if (family === "raydium-cpmm") assert.deepEqual(classicRow.externals,
    [...pool.creation.staticAccounts.map(({ address }) => address), pool.creation.observationState].slice(0, 4));
  assert.equal(prepared.transaction.messageVersion, 1); assert.deepEqual(prepared.transaction.requiredSigners, [addr(172)]); assert.equal(prepared.simulation.status, "succeeded");
  for (const [liquidityDelta, depthDelta] of [[0n, 0n], [0n, 1n], [1n, 0n]] as const) {
    freshPool = { ...pool, minLiquidityNative: pool.minLiquidityNative + liquidityDelta,
      minDepthTo50BpsNative: pool.minDepthTo50BpsNative + depthDelta };
    await prepare();
  }
  freshPool = aboveFloorPool;
  for (const capacity of ["minLiquidityNative", "minDepthTo50BpsNative"] as const) {
    freshPool = { ...aboveFloorPool, [capacity]: pool[capacity] - 1n };
    const beforeBlockhash = blockhashCalls; const beforeSimulation = simulationCalls;
    try { assert.equal((await prepare()).mode, sampledFamilyMode); }
    finally { freshPool = aboveFloorPool; }
    assert.equal(blockhashCalls, beforeBlockhash + 1); assert.equal(simulationCalls, beforeSimulation + 1);
  }
  for (const [creationDepth, legacy] of [[pool.minDepthTo50BpsNative * 2n, false], [pool.minDepthTo50BpsNative * 10n / 9n + 1n, true]] as const) {
    for (const [pct, ok] of [[89n, true], [55n, true], [49n, true]] as const) {
      freshPool = { ...aboveFloorPool, minDepthTo50BpsNative: creationDepth * pct / 100n };
      const beforeBlockhash = blockhashCalls;
      try {
        if (ok) assert.equal((await prepare()).mode, sampledFamilyMode, `${family} ${pct}% of creation depth prepares`);
        else { await assert.rejects(prepare, code("PLAN_STALE")); assert.equal(blockhashCalls, beforeBlockhash); }
      } finally { freshPool = aboveFloorPool; }
    }
  }
  if (dynamic) {
    const dynamicAddress = pool.readPlan.auxiliary.find((node) => node.role.startsWith("tick-array-") || node.role === "depth-bin-array")!.address;
    const dynamicRow = accountRows.get(dynamicAddress)!; accountRows.delete(dynamicAddress);
    try {
      if (pool.creation.adapterType === 0 || pool.creation.adapterType === 1) assert.equal((await prepare()).mode, sampledFamilyMode);
      else await assert.rejects(prepare, code("PLAN_STALE"));
    } finally { accountRows.set(dynamicAddress, dynamicRow); }
    accountRows.set(dynamicAddress, { ...dynamicRow, owner: addr(241) });
    try { await assert.rejects(prepare, code("ACCOUNT_OWNER_MISMATCH")); } finally { accountRows.set(dynamicAddress, dynamicRow); }
    const poolRow = accountRows.get(pool.pool)!; const changedPool = Uint8Array.from(poolRow.data);
    const rule = fixture.input.descriptor.planRule;
    const dynamicOffset = rule.kind === "meteora-dlmm" ? rule.activeIdOffset : rule.kind === "orca-whirlpool" || rule.kind === "raydium-clmm" ? rule.tickOffset : 0;
    const changedView = new DataView(changedPool.buffer); changedView.setInt32(dynamicOffset, changedView.getInt32(dynamicOffset, true) + 1_000, true);
    accountRows.set(pool.pool, { ...poolRow, data: changedPool });
    try { await assert.rejects(prepare, (error: unknown) => error instanceof MimirBetaStalePreparationError &&
      error.reason === "source-drift" && error.address === pool.pool && error.observedSlot === pool.readPlan.context.observedSlot &&
      error.currentSlot === 200n && error.observedUnixTimestamp === pool.readPlan.context.observedUnixTimestamp); }
    finally { accountRows.set(pool.pool, poolRow); }
    const clockKey = "SysvarC1ock11111111111111111111111111111111" as Address; const clockRow = accountRows.get(clockKey)!;
    const withClock = async (row: typeof clockRow | null, check: Parameters<typeof assert.rejects>[1]) => {
      if (row) accountRows.set(clockKey, row); else accountRows.delete(clockKey);
      try { await assert.rejects(prepare, check); } finally { accountRows.set(clockKey, clockRow); }
    };
    const beforeClockSimulation = simulationCalls;
    await withClock(null, code("RPC_CONTEXT_MISMATCH"));
    assert.equal(simulationCalls, beforeClockSimulation);
    await withClock({ ...clockRow, owner: addr(242) }, code("RPC_CONTEXT_MISMATCH"));
    await withClock({ ...clockRow, data: clockRow.data.subarray(0, 39) }, code("RPC_CONTEXT_MISMATCH"));
    const wrongSlot = Uint8Array.from(clockRow.data); new DataView(wrongSlot.buffer).setBigUint64(0, 199n, true);
    await withClock({ ...clockRow, data: wrongSlot }, code("RPC_CONTEXT_MISMATCH"));
    const negative = Uint8Array.from(clockRow.data); new DataView(negative.buffer).setBigInt64(32, -1n, true);
    await withClock({ ...clockRow, data: negative }, code("RPC_CONTEXT_MISMATCH"));
  }
  if (family === "raydium-cpmm") {
    const observationAddress = pool.creation.observationState!; const observation = accountRows.get(observationAddress)!;
    accountRows.set(observationAddress, { ...observation, executable: true });
    try { await assert.rejects(prepare, code("ACCOUNT_MALFORMED")); } finally { accountRows.set(observationAddress, observation); }
    const malformed = Uint8Array.from(observation.data); malformed[11] ^= 1; accountRows.set(observationAddress, { ...observation, data: malformed });
    try { await assert.rejects(prepare, code("PLAN_STALE")); } finally { accountRows.set(observationAddress, observation); }
  }
  if (family === "raydium-amm-v4") {
    const hostile = async (key: Address, mutate: (data: Uint8Array) => void) => {
      const row = accountRows.get(key)!; const original = row.data; const changed = Uint8Array.from(original); mutate(changed);
      accountRows.set(key, { ...row, data: changed }); const beforeBlockhash = blockhashCalls; const beforeSimulation = simulationCalls;
      try { await assert.rejects(prepare, code("PLAN_STALE")); }
      finally { accountRows.set(key, row); }
      assert.equal(blockhashCalls, beforeBlockhash); assert.equal(simulationCalls, beforeSimulation);
    };
    await hostile(pdas.feed[0], (data) => { data[0] ^= 1; });
    await hostile(pdas.feed[0], (data) => { new DataView(data.buffer).setUint16(8, 0, true); });
    await hostile(pdas.feed[0], (data) => { new DataView(data.buffer).setUint16(10, 325, true); });
    await hostile(pdas.sourcingPlan[0], (data) => { data[PLAN_OFFSETS.planHash] ^= 1; });
    await hostile(pdas.sourcingPlan[0], (data) => { data[PLAN_OFFSETS.sourceSetHash] ^= 1; });
    await hostile(pdas.sourcingPlan[0], (data) => { data[PLAN_OFFSETS.reservedTail] = 1; });
    await hostile(sourceConfig, (data) => { writeU64(data, SOURCE_OFFSETS.sourceConfigRevision, 2n); });
    await hostile(sourceConfig, (data) => { data[SOURCE_OFFSETS.poolOrMarket] ^= 1; });
    await hostile(sourceRing, (data) => { writeU64(data, RING_OFFSETS.sourceConfigRevision, 2n); });
    await hostile(sourceRing, (data) => { writeU64(data, RING_OFFSETS.newestSlot, 0n); });
  }
}

// V1 creation, live-account closure, and source reconstruction must preserve the
// adapter version and the selected Token-2022 mint instead of falling back to V0.
const token2022LiveBase = await makeBetaCaptureFixture("raydium-clmm", { seed: 511, baseMint: addr(191), quoteMint: addr(192) });
const token2022LiveInput = {
  ...token2022LiveBase.input,
  accounts: token2022LiveBase.input.accounts.map((row) =>
    row.address === token2022LiveBase.input.pair.baseMint || row.address === token2022LiveBase.input.expectedPlan.baseVault
      ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID } : row),
};
const token2022LiveCandidate = await decodeMimirBetaCaptureCandidate(token2022LiveInput);
assert.equal(token2022LiveCandidate.adapterVersion, 1);
assert.equal(token2022LiveCandidate.token2022Mint, token2022LiveInput.pair.baseMint);
const token2022LiveCreation = buildMimirBetaPoolCreationBinding(token2022LiveCandidate);
const token2022ProgramAddress = bytesAddress(MIMIR_PROGRAM_ID.toBytes());
const token2022LivePool: MimirBetaEligiblePool = {
  family: token2022LiveCandidate.family, adapterVersion: token2022LiveCandidate.adapterVersion,
  token2022Mint: token2022LiveCandidate.token2022Mint, token2022PolicyHash: token2022LiveCandidate.token2022PolicyHash,
  programId: token2022LiveCandidate.programId, pool: token2022LiveCandidate.pool,
  descriptorId: token2022LiveCandidate.descriptorId, descriptorHash: token2022LiveCandidate.descriptorHash,
  readPlan: token2022LiveInput.expectedPlan, canonicalMint0: token2022LiveCandidate.canonicalMint0,
  canonicalMint1: token2022LiveCandidate.canonicalMint1, canonicalPairKey: token2022LiveCandidate.canonicalPairKey,
  direction: "quote-per-base", baseMint: token2022LiveCandidate.baseMint, quoteMint: token2022LiveCandidate.quoteMint,
  eligibility: "eligible", baseVault: token2022LiveCandidate.baseVault, quoteVault: token2022LiveCandidate.quoteVault,
  minLiquidityNative: token2022LiveCandidate.minLiquidityNative, minDepthTo50BpsNative: token2022LiveCandidate.minDepthTo50BpsNative,
  observedSlot: 100n, validThroughSlot: 300n, evidenceHash: "c".repeat(64), creation: token2022LiveCreation,
};
const token2022LiveFacts = token2022LiveCreation.staticAccounts.map(({ address }) => {
  const account = token2022LiveInput.accounts.find((row) => row.address === address)!;
  return { address, owner: account.owner, executable: account.executable };
});
const token2022LiveFeed = await deriveMimirBetaClassicFeedId(token2022LivePool.baseMint, token2022LivePool.quoteMint);
const token2022LiveArtifacts = await buildMimirBetaClassicSourceArtifacts({
  programId: token2022ProgramAddress, feedId: token2022LiveFeed, baseMint: token2022LivePool.baseMint,
  quoteMint: token2022LivePool.quoteMint, pools: [token2022LivePool], physicalAccounts: token2022LiveFacts,
});
const token2022LiveRows = new Map<Address, MimirBetaAccount>(token2022LiveInput.accounts.map((row) =>
  [row.address, { ...row, lamports: 1n }]));
const token2022AdapterAccounts = await freshAdapterAccounts(token2022LivePool, token2022LiveRows, true);
assert.deepEqual(token2022AdapterAccounts.slice(0, token2022LiveCreation.staticAccounts.length),
  token2022LiveCreation.staticAccounts.map(({ address }) => address));
assert.equal(token2022AdapterAccounts[4], token2022LiveCandidate.token2022Mint);
assert.equal(token2022LiveArtifacts.artifacts[0]!.source.adapterVersion, 1);
assert.equal(token2022LiveArtifacts.artifacts[0]!.source.tokenProgram, MIMIR_BETA_TOKEN_2022_PROGRAM_ID);
const token2022Source = token2022LiveArtifacts.artifacts[0]!.source;
const token2022SourceData = buildTestSourceConfigHeader(0, (data) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  data.set(addressBytes(token2022LiveFeed), SOURCE_OFFSETS.feedId);
  data[SOURCE_OFFSETS.adapterType] = token2022Source.adapterType; data[SOURCE_OFFSETS.direction] = token2022Source.direction;
  view.setUint16(SOURCE_OFFSETS.adapterVersion, token2022Source.adapterVersion, true);
  for (const [offset, value] of [[SOURCE_OFFSETS.venueGroup, token2022Source.venueGroup], [SOURCE_OFFSETS.operatorGroup, token2022Source.operatorGroup],
    [SOURCE_OFFSETS.liquidityOwnerGroup, token2022Source.liquidityOwnerGroup], [SOURCE_OFFSETS.routeCorrelationGroup, token2022Source.routeCorrelationGroup],
    [SOURCE_OFFSETS.quoteAssetGroup, token2022Source.quoteAssetGroup], [SOURCE_OFFSETS.bridgeOrWrapperGroup, token2022Source.bridgeOrWrapperGroup],
    [SOURCE_OFFSETS.oracleSourceClass, token2022Source.oracleSourceClass], [SOURCE_OFFSETS.upgradeAuthorityGroup, token2022Source.upgradeAuthorityGroup],
    [SOURCE_OFFSETS.maxSourceWeightBps, token2022Source.maxSourceWeightBps]] as const) view.setUint16(offset, value, true);
  writeU128(data, SOURCE_OFFSETS.minLiquidityNative, token2022Source.minLiquidityNative);
  writeU128(data, SOURCE_OFFSETS.minDepthTo50BpsNative, token2022Source.minDepthTo50BpsNative);
  for (const [offset, value] of [[SOURCE_OFFSETS.programId, token2022Source.programId], [SOURCE_OFFSETS.poolOrMarket, token2022Source.poolOrMarket],
    [SOURCE_OFFSETS.baseVault, token2022Source.baseVault], [SOURCE_OFFSETS.quoteVault, token2022Source.quoteVault],
    [SOURCE_OFFSETS.baseMint, token2022LivePool.baseMint], [SOURCE_OFFSETS.quoteMint, token2022LivePool.quoteMint],
    [SOURCE_OFFSETS.tokenProgram, token2022Source.tokenProgram], [SOURCE_OFFSETS.vaultAuthority, token2022Source.vaultAuthority]] as const) {
    data.set(addressBytes(value), offset);
  }
});
const reconstructedToken2022Source = decodeMimirBetaLiveSource(token2022SourceData);
assert.equal(reconstructedToken2022Source.adapterType, 1);
assert.equal(reconstructedToken2022Source.adapterVersion, 1);
assert.deepEqual(reconstructedToken2022Source.poolOrMarket, addressBytes(token2022LivePool.pool));
assert.deepEqual(reconstructedToken2022Source.tokenProgram, addressBytes(MIMIR_BETA_TOKEN_2022_PROGRAM_ID));

type AdapterType = MimirBetaEligiblePool["creation"]["adapterType"];
const staticAccountCounts: Readonly<Record<AdapterType, number>> = { 0: 4, 1: 4, 2: 4, 3: 3, 4: 6, 6: 7, 7: 3 };
const familyByAdapter: Readonly<Record<AdapterType, MimirBetaEligiblePool["family"]>> = {
  0: "orca-whirlpool", 1: "raydium-clmm", 2: "raydium-cpmm", 3: "meteora-dlmm",
  4: "raydium-amm-v4", 6: "pumpswap", 7: "meteora-damm-v2",
};
const staticRoles = ["base-vault", "quote-vault", "pool", "amm-config", "base-mint", "quote-mint", "global-config"] as const;
function lifecyclePool(adapterType: AdapterType, index: number): MimirBetaEligiblePool {
  const staticAccounts = staticRoles.slice(0, staticAccountCounts[adapterType]).map((role, offset) =>
    ({ role, address: addr(100 + index * 10 + offset) }));
  return {
    eligibility: "eligible", family: familyByAdapter[adapterType], adapterVersion: 0, token2022Mint: null, token2022PolicyHash: null, programId: addr(200 + adapterType), pool: staticAccounts[2]!.address,
    descriptorId: `lifecycle-${adapterType}`, descriptorHash: "a".repeat(64), readPlan: {} as never,
    canonicalMint0: addr(210), canonicalMint1: addr(211), canonicalPairKey: "lifecycle", direction: "quote-per-base",
    baseMint: addr(210), quoteMint: addr(211), baseVault: staticAccounts[0]!.address, quoteVault: staticAccounts[1]!.address,
    minLiquidityNative: 1n, minDepthTo50BpsNative: 1n, observedSlot: 1n, validThroughSlot: 2n,
    evidenceHash: "b".repeat(64), creation: { adapterType, adapterVersion: 0, token2022Mint: null,
      bindingVariant: adapterType === 0 || adapterType === 1 ? "routeable" : "direct",
      tokenProgramId: addr(220), vaultAuthority: addr(221), staticAccounts,
      observationState: adapterType === 2 ? addr(180 + index) : null, operatorGroup: 1, liquidityOwnerGroup: 1,
      quoteAssetGroup: 1, bridgeOrWrapperGroup: 1, oracleSourceClass: 1, upgradeAuthorityGroup: 1 },
  };
}
async function assertLifecycleGroups(adapters: readonly AdapterType[], expected: readonly number[], distinct: number): Promise<void> {
  const pools = adapters.map(lifecyclePool);
  const physicalAccounts = pools.flatMap((pool) => pool.creation.staticAccounts.map(({ address }) =>
    ({ address, owner: addr(230), executable: false })));
  const result = await buildMimirBetaClassicSourceArtifacts({ programId: addr(231), feedId: addr(232),
    baseMint: addr(210), quoteMint: addr(211), pools, physicalAccounts });
  assert.deepEqual(result.artifacts.map(({ source }) => source.venueGroup), expected);
  assert.deepEqual(result.artifacts.map(({ source }) => source.routeCorrelationGroup), expected);
  assert.equal(result.lifecycleGroupCount, distinct);
}

await assertLifecycleGroups([0, 1, 7, 1, 1], [0, 1, 2, 1, 1], 3);
await assertLifecycleGroups([6], [0], 1);
await assertLifecycleGroups([6, 4, 2, 3, 7], [0, 1, 1, 2, 2], 3);
await assertLifecycleGroups([6, 0, 1, 3], [0, 1, 2, 3], 4);
const unsupported = lifecyclePool(0, 0);
await assert.rejects(() => buildMimirBetaClassicSourceArtifacts({ programId: addr(231), feedId: addr(232),
  baseMint: addr(210), quoteMint: addr(211), pools: [{ ...unsupported,
    creation: { ...unsupported.creation, adapterType: 5 as AdapterType } }],
  physicalAccounts: unsupported.creation.staticAccounts.map(({ address }) => ({ address, owner: addr(230), executable: false })) }),
code("PROGRAM_ABI_MISMATCH"));

// Fee-only wallet rewrites (e.g. Solflare priority fee) are accepted; the wallet message is the record.
type CompiledV1 = Extract<ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>, { version: 1 }>;
const computeBudget = "ComputeBudget111111111111111111111111111111" as Address;
// D0 hoists both directives into the TxV1 config: the reviewed message carries only the program instruction.
const budgeted = await compileMimirBetaTransactionV1({
  feePayer: wallet, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 50n,
  instructions: [
    { programAddress: computeBudget, accounts: [], data: Uint8Array.of(2, 0x40, 0x0d, 0x03, 0) },
    { programAddress: computeBudget, accounts: [], data: Uint8Array.of(3, 1, 0, 0, 0, 0, 0, 0, 0) },
    { programAddress: program, accounts: [
      { address: wallet, isSigner: true, isWritable: true }, { address: asset, isSigner: true, isWritable: true },
      { address: addr(10), isSigner: false, isWritable: true }, { address: addr(11), isSigner: false, isWritable: false },
    ], data: Uint8Array.of(7) },
  ],
});
const rewrite = (source: Uint8Array, mutate: (message: CompiledV1) => CompiledV1) => new Uint8Array(
  getCompiledTransactionMessageEncoder().encode(mutate(getCompiledTransactionMessageDecoder().decode(source) as CompiledV1)));
const walletOnly = async (messageBytes: Uint8Array) => new Uint8Array(getTransactionEncoder().encode(
  await partiallySignTransaction([walletKeyPair], {
    messageBytes, signatures: { [wallet]: null, [asset]: null },
  } as unknown as Transaction)));
const withPriorityFee = await compileMimirBetaTransactionV1({
  feePayer: wallet, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 50n,
  priorityFeeLamports: 50_000n, instructions: [{ programAddress: program, accounts: [
    { address: wallet, isSigner: true, isWritable: true }, { address: asset, isSigner: true, isWritable: true },
  ], data: Uint8Array.of(7) }],
});
const ixData = (message: CompiledV1, index: number, data: Uint8Array): CompiledV1 => ({ ...message,
  instructionPayloads: message.instructionPayloads.map((payload, at) => at === index ? { ...payload, instructionData: data } : payload) });
const insertIx = (message: CompiledV1, program: Address, data: Uint8Array, accounts: number[] = [], writable = false): CompiledV1 => {
  const present = message.staticAccounts.indexOf(program);
  const staticAccounts = present >= 0 ? message.staticAccounts : writable
    ? [...message.staticAccounts.slice(0, message.staticAccounts.length - message.header.numReadonlyNonSignerAccounts), program,
      ...message.staticAccounts.slice(message.staticAccounts.length - message.header.numReadonlyNonSignerAccounts)]
    : [...message.staticAccounts, program];
  const remap = (index: number) => staticAccounts.indexOf(message.staticAccounts[index]!);
  return { ...message, staticAccounts, numStaticAccounts: staticAccounts.length, numInstructions: message.numInstructions + 1,
    header: present >= 0 || writable ? message.header : { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1 },
    instructionHeaders: [{ programAccountIndex: staticAccounts.indexOf(program), numInstructionAccounts: accounts.length, numInstructionDataBytes: data.length },
      ...message.instructionHeaders.map((header) => ({ ...header, programAccountIndex: remap(header.programAccountIndex) }))],
    instructionPayloads: [{ instructionAccountIndices: accounts, instructionData: data },
      ...message.instructionPayloads.map((payload) => ({ ...payload, instructionAccountIndices: payload.instructionAccountIndices.map(remap) }))] };
};
const cuPrice = Uint8Array.of(3, 5, 0, 0, 0, 0, 0, 0, 0);
const cuLimit = Uint8Array.of(2, 0x20, 0xa1, 0x07, 0);
const accepted: Array<[string, typeof transaction, Uint8Array]> = [
  ["config priority fee", transaction, withPriorityFee.serializedMessage],
  ["config CU limit", transaction, rewrite(transaction.serializedMessage, (message) => ({ ...message,
    configValues: message.configValues.map((value, at) => at === message.configValues.length - 2 ? { kind: "u32", value: 200_000 } : value) }))],
  // Formerly rejected in r2: inserting account-free CB 2/3 instructions plus the readonly CB key is fee-only (consumer budget rule).
  ["insert CB disc-3 + key", transaction, rewrite(transaction.serializedMessage, (message) => insertIx(message, computeBudget, cuPrice))],
  ["insert CB disc-2 + key", transaction, rewrite(transaction.serializedMessage, (message) => insertIx(message, computeBudget, cuLimit))],
  ["insert both CB + key", transaction, rewrite(transaction.serializedMessage, (message) => insertIx(insertIx(message, computeBudget, cuPrice), computeBudget, cuLimit))],
  ["insert CB + config", transaction, rewrite(withPriorityFee.serializedMessage, (message) => insertIx(message, computeBudget, cuPrice))],
];
for (const [label, reviewed, walletMessage] of accepted) {
  assert.notDeepEqual(walletMessage, reviewed.serializedMessage, label);
  const assetPartialSig = await partiallySignMimirBetaTransactionV1({ transaction: reviewed, signerAddress: asset, keyPair: assetKeyPair });
  const result = await verifyMimirBetaWalletSignedTransactionV1({ transaction: reviewed, walletAddress: wallet,
    walletSignedTransaction: await walletOnly(walletMessage), preservedSignatures: [assetPartialSig.signature],
    localSigners: [{ address: asset, keyPair: assetKeyPair }] });
  assert.deepEqual(result.serializedMessage, walletMessage, label);
  assert.equal(result.messageHash, hex(await sha256(walletMessage)), label);
  assert.notEqual(result.messageHash, reviewed.messageHash, label);
  assert.deepEqual(result.serializedTransaction.subarray(0, walletMessage.length), walletMessage, label);
  assert.equal(result.signatures.length, 2, label);
}

const multi = await compileMimirBetaTransactionV1({
  feePayer: wallet, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 50n,
  instructions: [
    { programAddress: program, accounts: [
      { address: wallet, isSigner: true, isWritable: true }, { address: asset, isSigner: true, isWritable: true },
      { address: addr(11), isSigner: false, isWritable: false },
    ], data: Uint8Array.of(7) },
    { programAddress: program, accounts: [{ address: addr(14), isSigner: false, isWritable: false }], data: Uint8Array.of(9) },
  ],
});
// Inserts an account-free CB instruction at instruction position `ixAt`, adding the CB key at readonly slot `keyAt` when absent.
const insertCbAt = (message: CompiledV1, data: Uint8Array, ixAt: number, keyAt: number, role: "r" | "w" | "s" = "r"): CompiledV1 => {
  const present = message.staticAccounts.indexOf(computeBudget);
  const readonlyStart = message.staticAccounts.length - message.header.numReadonlyNonSignerAccounts;
  const at = role === "s" ? 0 : role === "w" ? readonlyStart : readonlyStart + keyAt;
  const staticAccounts = present >= 0 ? message.staticAccounts
    : [...message.staticAccounts.slice(0, at), computeBudget, ...message.staticAccounts.slice(at)];
  const remap = (index: number) => staticAccounts.indexOf(message.staticAccounts[index]!);
  const header = present >= 0 ? message.header : role === "r"
    ? { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1 }
    : role === "s" ? { ...message.header, numSignerAccounts: message.header.numSignerAccounts + 1 } : message.header;
  const headers = message.instructionHeaders.map((h) => ({ ...h, programAccountIndex: remap(h.programAccountIndex) }));
  const payloads = message.instructionPayloads.map((p) => ({ ...p, instructionAccountIndices: p.instructionAccountIndices.map(remap) }));
  headers.splice(ixAt, 0, { programAccountIndex: staticAccounts.indexOf(computeBudget), numInstructionAccounts: 0, numInstructionDataBytes: data.length });
  payloads.splice(ixAt, 0, { instructionAccountIndices: [], instructionData: data });
  return { ...message, staticAccounts, numStaticAccounts: staticAccounts.length, numInstructions: message.numInstructions + 1,
    header, instructionHeaders: headers, instructionPayloads: payloads };
};
const multiRewrite = (mutate: (message: CompiledV1) => CompiledV1) => rewrite(multi.serializedMessage, mutate);
const positional: Array<[string, Uint8Array]> = [
  ["insert CB before non-fee", multiRewrite((m) => insertCbAt(m, cuPrice, 0, 1))],
  ["insert CB between non-fee", multiRewrite((m) => insertCbAt(m, cuPrice, 1, 1))],
  ["insert CB after non-fee", multiRewrite((m) => insertCbAt(m, cuPrice, 2, 1))],
  ["CB key at readonly head", multiRewrite((m) => insertCbAt(m, cuPrice, 0, 0))],
  ["CB key at readonly middle", multiRewrite((m) => insertCbAt(m, cuPrice, 0, 1))],
  ["CB key at readonly tail", multiRewrite((m) => insertCbAt(m, cuPrice, 0, 3))],
  ["two inserted disc-2", multiRewrite((m) => insertCbAt(insertCbAt(m, cuLimit, 0, 2), Uint8Array.of(2, 0x10, 0, 0, 0), 2, 0))],
  ["two inserted disc-3", multiRewrite((m) => insertCbAt(insertCbAt(m, cuPrice, 1, 2), Uint8Array.of(3, 7, 0, 0, 0, 0, 0, 0, 0), 3, 0))],
];
for (const [label, walletMessage] of positional) {
  assert.equal(isMimirBetaFeeOnlyWalletRewriteV1(multi.serializedMessage, walletMessage), true, label);
  const assetPartialSig = await partiallySignMimirBetaTransactionV1({ transaction: multi, signerAddress: asset, keyPair: assetKeyPair });
  const result = await verifyMimirBetaWalletSignedTransactionV1({ transaction: multi, walletAddress: wallet,
    walletSignedTransaction: await walletOnly(walletMessage), preservedSignatures: [assetPartialSig.signature],
    localSigners: [{ address: asset, keyPair: assetKeyPair }] });
  assert.deepEqual(result.serializedMessage, walletMessage, label);
}
const keyIndex = (bytes: Uint8Array) => (getCompiledTransactionMessageDecoder().decode(bytes) as CompiledV1).staticAccounts.indexOf(computeBudget);
assert.deepEqual(positional.slice(3, 6).map(([, bytes]) => keyIndex(bytes)), [2, 3, 5]);
const multiRejected: Array<[string, Uint8Array]> = [
  ["signer inserted CB key", multiRewrite((m) => insertCbAt(m, cuPrice, 0, 0, "s"))],
  ["writable inserted CB key (multi)", multiRewrite((m) => insertCbAt(m, cuPrice, 0, 0, "w"))],
  ["duplicate inserted CB keys", multiRewrite((m) => { const once = insertCbAt(m, cuPrice, 0, 0);
    return { ...once, staticAccounts: [...once.staticAccounts, computeBudget], numStaticAccounts: once.numStaticAccounts + 1,
      header: { ...once.header, numReadonlyNonSignerAccounts: once.header.numReadonlyNonSignerAccounts + 1 } }; })],
  ["duplicate non-CB key", multiRewrite((m) => ({ ...m, staticAccounts: [...m.staticAccounts, addr(11)], numStaticAccounts: m.numStaticAccounts + 1,
    header: { ...m.header, numReadonlyNonSignerAccounts: m.header.numReadonlyNonSignerAccounts + 1 } }))],
];
for (const [label, walletMessage] of multiRejected) {
  assert.equal(isMimirBetaFeeOnlyWalletRewriteV1(multi.serializedMessage, walletMessage), false, label);
  let walletSigned: Uint8Array;
  try { walletSigned = await walletOnly(walletMessage); } catch { continue; }
  await assert.rejects(() => verifyMimirBetaWalletSignedTransactionV1({ transaction: multi, walletAddress: wallet,
    walletSignedTransaction: walletSigned, preservedSignatures: [], localSigners: [{ address: asset, keyPair: assetKeyPair }] }), label);
}
assert.throws(() => mimirBetaReviewedMessageOfWalletV1(multiRejected[2]![1], { requiredSigners: multi.requiredSigners,
  instructions: [], packet: multi.packet, messageHash: multi.messageHash }), /Duplicate static account keys/);
// Caps on the wallet message itself: a 64-account review plus one inserted CB key is 65 accounts.
const wide = await compileMimirBetaTransactionV1({
  feePayer: wallet, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 50n,
  instructions: [{ programAddress: program, accounts: [
    { address: wallet, isSigner: true, isWritable: true }, { address: asset, isSigner: true, isWritable: true },
    ...Array.from({ length: 61 }, (_, index) => ({ address: addr(100 + index), isSigner: false, isWritable: false })),
  ], data: Uint8Array.of(7) }],
});
assert.equal(wide.packet.accountCount, 64);
const wide65 = rewrite(wide.serializedMessage, (m) => insertCbAt(m, cuPrice, 0, 0));
assert.equal(isMimirBetaFeeOnlyWalletRewriteV1(wide.serializedMessage, wide65), false);
await assert.rejects(async () => verifyMimirBetaWalletSignedTransactionV1({ transaction: wide, walletAddress: wallet,
  walletSignedTransaction: await walletOnly(wide65), preservedSignatures: [], localSigners: [{ address: asset, keyPair: assetKeyPair }] }),
code("TRANSACTION_TOO_LARGE"));
const big = await compileMimirBetaTransactionV1({
  feePayer: wallet, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 50n,
  instructions: [{ programAddress: program, accounts: [
    { address: wallet, isSigner: true, isWritable: true }, { address: asset, isSigner: true, isWritable: true }],
  data: Uint8Array.from({ length: 3_700 }, () => 1) }],
});
const bigOver = Array.from({ length: 30 }).reduce<Uint8Array>((bytes) => rewrite(bytes, (m) => insertCbAt(m, cuPrice, 0, 0)), big.serializedMessage);
assert.ok(big.serializedTransaction.length <= 4_096 && bigOver.length > 4_096, `${big.serializedTransaction.length} ${bigOver.length}`);
assert.equal(isMimirBetaFeeOnlyWalletRewriteV1(big.serializedMessage, bigOver), false);
await assert.rejects(async () => verifyMimirBetaWalletSignedTransactionV1({ transaction: big, walletAddress: wallet,
  walletSignedTransaction: await walletOnly(bigOver), preservedSignatures: [], localSigners: [{ address: asset, keyPair: assetKeyPair }] }),
code("TRANSACTION_TOO_LARGE"));
// The same 30 insertions under the cap are fee-only, so only the size cap rejects them above.
const bigUnder = Array.from({ length: 30 }).reduce<Uint8Array>((bytes) => rewrite(bytes, (m) => insertCbAt(m, cuPrice, 0, 0)), multi.serializedMessage);
assert.equal(isMimirBetaFeeOnlyWalletRewriteV1(multi.serializedMessage, bigUnder), true);

const budgetedMessage = budgeted.serializedMessage;
const twoPrograms = await compileMimirBetaTransactionV1({
  feePayer: wallet, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 50n,
  instructions: [
    { programAddress: computeBudget, accounts: [], data: Uint8Array.of(3, 1, 0, 0, 0, 0, 0, 0, 0) },
    { programAddress: program, accounts: [
      { address: wallet, isSigner: true, isWritable: true }, { address: asset, isSigner: true, isWritable: true },
    ], data: Uint8Array.of(7) },
    { programAddress: program, accounts: [{ address: addr(10), isSigner: false, isWritable: true }], data: Uint8Array.of(9) },
  ],
});
const swap = <T>(items: readonly T[]) => [items[1]!, items[0]!];
const rejected: Array<[string, Uint8Array]> = [
  ["blockhash", rewrite(budgetedMessage, (message) => ({ ...message, lifetimeToken: "22222222222222222222222222222222" as never }))],
  ["fee payer", rewrite(budgetedMessage, (message) => ({ ...message, staticAccounts: [addr(12), ...message.staticAccounts.slice(1)] }))],
  ["account order", rewrite(budgetedMessage, (message) => {
    const accounts = [...message.staticAccounts]; const a = accounts.indexOf(addr(10)); const b = accounts.indexOf(addr(11));
    [accounts[a], accounts[b]] = [accounts[b]!, accounts[a]!];
    return { ...message, staticAccounts: accounts };
  })],
  ["role flag", rewrite(budgetedMessage, (message) => ({ ...message,
    header: { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1 } }))],
  ["non-budget data", rewrite(budgetedMessage, (message) => ixData(message, 0, Uint8Array.of(8)))],
  ["account indices", rewrite(budgetedMessage, (message) => ({ ...message, instructionPayloads: message.instructionPayloads.map((payload, at) =>
    at === 0 ? { ...payload, instructionAccountIndices: [...payload.instructionAccountIndices].reverse() } : payload) }))],
  ["added instruction", rewrite(budgetedMessage, (message) => ({ ...message, numInstructions: message.numInstructions + 1,
    instructionHeaders: [...message.instructionHeaders, message.instructionHeaders[0]!],
    instructionPayloads: [...message.instructionPayloads, message.instructionPayloads[0]!] }))],
  ["removed instruction", rewrite(budgetedMessage, (message) => ({ ...message, numInstructions: message.numInstructions - 1,
    instructionHeaders: message.instructionHeaders.slice(1), instructionPayloads: message.instructionPayloads.slice(1) }))],
  ["inserted non-CB instruction", rewrite(budgetedMessage, (message) => insertIx(message, addr(11), cuPrice))],
  ["inserted CB with accounts", rewrite(budgetedMessage, (message) => insertIx(message, computeBudget, cuPrice, [0]))],
  ["inserted CB disc 0", rewrite(budgetedMessage, (message) => insertIx(message, computeBudget, Uint8Array.of(0, 1, 0, 0, 0)))],
  ["inserted CB disc 1", rewrite(budgetedMessage, (message) => insertIx(message, computeBudget, Uint8Array.of(1, 1, 0, 0, 0)))],
  ["inserted CB disc 4", rewrite(budgetedMessage, (message) => insertIx(message, computeBudget, Uint8Array.of(4, 1, 0, 0, 0)))],
  ["inserted CB disc-3 short", rewrite(budgetedMessage, (message) => insertIx(message, computeBudget, Uint8Array.of(3, 1, 0, 0, 0)))],
  ["inserted CB disc-2 long", rewrite(budgetedMessage, (message) => insertIx(message, computeBudget, Uint8Array.of(2, 5, 0, 0, 0, 0, 0, 0, 0)))],
  ["extra non-CB key", rewrite(budgetedMessage, (message) => ({ ...message, staticAccounts: [...message.staticAccounts, addr(13)],
    numStaticAccounts: message.numStaticAccounts + 1, header: { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1 } }))],
  ["signer order", rewrite(budgetedMessage, (message) => {
    const accounts = [...message.staticAccounts]; [accounts[0], accounts[1]] = [accounts[1]!, accounts[0]!];
    return { ...message, staticAccounts: accounts };
  })],
  ["writable inserted CB key", rewrite(transaction.serializedMessage, (message) => insertIx(message, computeBudget, cuPrice, [], true))],
  ["inserted CB + reordered", rewrite(twoPrograms.serializedMessage, (message) => insertIx({ ...message,
    instructionHeaders: swap(message.instructionHeaders), instructionPayloads: swap(message.instructionPayloads) }, computeBudget, cuLimit))],
  ["instruction order", rewrite(twoPrograms.serializedMessage, (message) => ({ ...message,
    instructionHeaders: swap(message.instructionHeaders), instructionPayloads: swap(message.instructionPayloads) }))],
  ["program account index", rewrite(budgetedMessage, (message) => ({ ...message, instructionHeaders: message.instructionHeaders.map((header, at) =>
    at === 0 ? { ...header, programAccountIndex: message.staticAccounts.indexOf(addr(11)) } : header) }))],
  ["trailing bytes", Uint8Array.from([...budgetedMessage, 0])],
  ["non-canonical encoding", rewrite(budgetedMessage, (message) => ({ ...message, numInstructions: message.numInstructions + 1 }))],
  ["added non-fee config field", rewrite(budgetedMessage, (message) => ({ ...message, configMask: message.configMask | 0b1_0000,
    configValues: [...message.configValues, { kind: "u32", value: 1 }] }))],
  ["removed non-fee config field", rewrite(budgetedMessage, (message) => ({ ...message, configMask: message.configMask & ~0b1000,
    configValues: message.configValues.slice(0, -1) }))],
];
for (const [label, walletMessage] of rejected) {
  const reviewed = label === "writable inserted CB key" ? transaction : label === "instruction order" || label === "inserted CB + reordered" ? twoPrograms : budgeted;
  assert.equal(isMimirBetaFeeOnlyWalletRewriteV1(reviewed.serializedMessage, walletMessage), false, label);
  let walletSigned: Uint8Array;
  try { walletSigned = await walletOnly(walletMessage); } catch { continue; }
  await assert.rejects(() => verifyMimirBetaWalletSignedTransactionV1({ transaction: reviewed, walletAddress: wallet,
    walletSignedTransaction: walletSigned, preservedSignatures: [], localSigners: [{ address: asset, keyPair: assetKeyPair }] }),
  code("RECEIPT_MISMATCH"), label);
}

console.log("beta Transaction v1 tests passed");

// Caps apply to unchanged wallet bytes too; the 4,096-byte cap counts 64 bytes per required signature.
{
  const decodeV1 = (bytes: Uint8Array) => getCompiledTransactionMessageDecoder().decode(bytes) as Extract<ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>, { version: 1 }>;
  const encodeV1 = (message: ReturnType<typeof decodeV1>) => new Uint8Array(getCompiledTransactionMessageEncoder().encode(message));
  const same = (bytes: Uint8Array) => isMimirBetaFeeOnlyWalletRewriteV1(bytes, bytes);
  const oneSigner = await compileMimirBetaTransactionV1({
    feePayer: wallet, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 50n,
    instructions: [{ programAddress: program, accounts: [{ address: wallet, isSigner: true, isWritable: true }], data: Uint8Array.of(1) }],
  });
  const sized = (source: Uint8Array, totalBytes: number) => {
    const m = decodeV1(source), target = totalBytes - 64 * m.header.numSignerAccounts;
    for (let n = Math.max(0, target - source.length - 8); n <= target + 8; n++) {
      const candidate = encodeV1({ ...m,
        instructionHeaders: m.instructionHeaders.map((h, i) => i ? h : { ...h, numInstructionDataBytes: n }),
        instructionPayloads: m.instructionPayloads.map((p, i) => i ? p : { ...p, instructionData: new Uint8Array(n) }) });
      if (candidate.length === target) return candidate;
    }
    throw new Error(`no ${totalBytes} byte transaction`);
  };
  const signers = (source: Uint8Array, count: number) => {
    const m = decodeV1(source), add = count - m.header.numSignerAccounts;
    const extra = Array.from({ length: add }, (_, i) => addr(200 + i));
    const staticAccounts = [...m.staticAccounts.slice(0, m.header.numSignerAccounts), ...extra, ...m.staticAccounts.slice(m.header.numSignerAccounts)];
    const remap = (index: number) => staticAccounts.indexOf(m.staticAccounts[index]!);
    return encodeV1({ ...m, staticAccounts, numStaticAccounts: staticAccounts.length,
      header: { ...m.header, numSignerAccounts: count, numReadonlySignerAccounts: m.header.numReadonlySignerAccounts + add },
      instructionHeaders: m.instructionHeaders.map((h) => ({ ...h, programAccountIndex: remap(h.programAccountIndex) })),
      instructionPayloads: m.instructionPayloads.map((p) => ({ ...p, instructionAccountIndices: p.instructionAccountIndices.map(remap) })) });
  };
  const instructions = (source: Uint8Array, count: number) => {
    const m = decodeV1(source);
    return encodeV1({ ...m, numInstructions: count,
      instructionHeaders: Array.from({ length: count }, (_, i) => m.instructionHeaders[i % m.instructionHeaders.length]!),
      instructionPayloads: Array.from({ length: count }, (_, i) => m.instructionPayloads[i % m.instructionPayloads.length]!) });
  };
  const base = transaction.serializedMessage;
  assert.equal(decodeV1(base).header.numSignerAccounts, 2);
  for (const [label, bytes, accepted] of [
    ["tx 4096 / 1 signer", sized(oneSigner.serializedMessage, 4_096), true],
    ["tx 4096 / 2 signers", sized(base, 4_096), true],
    ["12 signers", signers(base, 12), true],
    ["64 instructions", instructions(base, 64), true],
    ["64 accounts", wide.serializedMessage, true],
    ["row 39: tx 4097 / 1 signer", sized(oneSigner.serializedMessage, 4_097), false],
    ["row 41: tx 4097 / 2 signers", sized(base, 4_097), false],
    ["row 42: message 4096 + 1 signature", sized(oneSigner.serializedMessage, 4_160), false],
    ["row 43: 65 accounts", wide65, false],
    ["row 45: 13 signers", signers(base, 13), false],
    ["row 47: 65 instructions", instructions(base, 65), false],
  ] as const) assert.equal(same(bytes), accepted, label);
}

// Wallet-first: Solflare may append one exact payer Lighthouse assertion; the asset signs the final bytes after the wallet.
{
  const lighthouse = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95" as Address;
  const guardData = Uint8Array.from(Buffer.from("06050300801c5a02000000000403000001000000000000000000", "hex"));
  const addGuard = (m: CompiledV1, data = guardData, program: Address = lighthouse, accounts = [0]): CompiledV1 => {
    const staticAccounts = [...m.staticAccounts, program];
    return { ...m, staticAccounts, numStaticAccounts: staticAccounts.length, numInstructions: m.numInstructions + 1,
      header: { ...m.header, numReadonlyNonSignerAccounts: m.header.numReadonlyNonSignerAccounts + 1 },
      instructionHeaders: [...m.instructionHeaders, { programAccountIndex: staticAccounts.length - 1, numInstructionAccounts: accounts.length, numInstructionDataBytes: data.length }],
      instructionPayloads: [...m.instructionPayloads, { instructionAccountIndices: accounts, instructionData: data }] };
  };
  const flip = (at: number, value: number) => { const data = Uint8Array.from(guardData); data[at] = value; return data; };
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/solflareGuardRegistry.json", import.meta.url), "utf8"));
  const messageOf = (b64: string) => new Uint8Array(getTransactionDecoder().decode(Buffer.from(b64, "base64")).messageBytes);
  const solflareReviewed = messageOf(fixture.reviewedWireBase64), solflareFinal = messageOf(fixture.enrichedTxBase64);
  assert.equal(isMimirBetaFeeOnlyWalletRewriteV1(solflareReviewed, solflareFinal), false, "fee-only keeps rejecting guards");
  assert.equal(isMimirBetaWalletRewriteV1(solflareReviewed, solflareFinal), true, "observed Solflare guard");
  assert.deepEqual([...mimirBetaReviewedToWalletInstructionIndexesV1(solflareReviewed, solflareFinal)], [[0, 0], [1, 1]]);

  const guarded = multiRewrite((m) => addGuard(insertCbAt(m, cuPrice, 0, 1)));
  assert.equal(isMimirBetaWalletRewriteV1(multi.serializedMessage, guarded), true);
  assert.deepEqual([...mimirBetaReviewedToWalletInstructionIndexesV1(multi.serializedMessage, guarded)], [[0, 1], [1, 2]]);
  const result = await verifyMimirBetaWalletSignedTransactionV1({ transaction: multi, walletAddress: wallet,
    walletSignedTransaction: await walletOnly(guarded), preservedSignatures: [], localSigners: [{ address: asset, keyPair: assetKeyPair }] });
  assert.deepEqual(result.serializedMessage, guarded);
  assert.deepEqual(result.signatures.map((entry) => entry.address), [wallet, asset]);
  // Unchanged message, wallet-first: asset signs after the wallet with empty preserved evidence.
  const unchanged = await verifyMimirBetaWalletSignedTransactionV1({ transaction: multi, walletAddress: wallet,
    walletSignedTransaction: await walletOnly(multi.serializedMessage), preservedSignatures: [], localSigners: [{ address: asset, keyPair: assetKeyPair }] });
  assert.deepEqual(unchanged.serializedMessage, multi.serializedMessage);
  // No local signer → asset slot stays empty → rejected.
  await assert.rejects(async () => verifyMimirBetaWalletSignedTransactionV1({ transaction: multi, walletAddress: wallet,
    walletSignedTransaction: await walletOnly(guarded), preservedSignatures: [] }), code("RECEIPT_MISMATCH"));
  // Invalid wallet signature is rejected before any local signing.
  const forged = await walletOnly(guarded); forged[guarded.length] ^= 1;
  await assert.rejects(() => verifyMimirBetaWalletSignedTransactionV1({ transaction: multi, walletAddress: wallet,
    walletSignedTransaction: forged, preservedSignatures: [], localSigners: [{ address: asset, keyPair: assetKeyPair }] }),
  /signature is invalid for/);
  // Wallet-first: a wallet-filled asset slot is rejected, never overwritten.
  const filled = await walletOnly(guarded); filled[guarded.length + 64] = 1;
  await assert.rejects(() => verifyMimirBetaWalletSignedTransactionV1({ transaction: multi, walletAddress: wallet,
    walletSignedTransaction: filled, preservedSignatures: [], localSigners: [{ address: asset, keyPair: assetKeyPair }] }),
  /wallet filled a local signer slot/);
  // Local key must derive to the reviewed signer; duplicates rejected.
  await assert.rejects(async () => verifyMimirBetaWalletSignedTransactionV1({ transaction: multi, walletAddress: wallet,
    walletSignedTransaction: await walletOnly(guarded), preservedSignatures: [], localSigners: [{ address: asset, keyPair: walletKeyPair }] }), code("RECEIPT_MISMATCH"));
  await assert.rejects(async () => verifyMimirBetaWalletSignedTransactionV1({ transaction: multi, walletAddress: wallet,
    walletSignedTransaction: await walletOnly(guarded), preservedSignatures: [],
    localSigners: [{ address: asset, keyPair: assetKeyPair }, { address: asset, keyPair: assetKeyPair }] }), code("RECEIPT_MISMATCH"));

  const oneSignerReview = await compileMimirBetaTransactionV1({
    feePayer: wallet, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 50n,
    instructions: [{ programAddress: program, accounts: [{ address: wallet, isSigner: true, isWritable: true }], data: Uint8Array.of(1) }],
  });
  const guardRejected: Array<[string, Uint8Array, Uint8Array]> = [
    ["other program", multi.serializedMessage, multiRewrite((m) => addGuard(m, guardData, addr(77)))],
    ["other account", multi.serializedMessage, multiRewrite((m) => addGuard(m, guardData, lighthouse, [1]))],
    ["extra account", multi.serializedMessage, multiRewrite((m) => addGuard(m, guardData, lighthouse, [0, 0]))],
    ["no account", multi.serializedMessage, multiRewrite((m) => addGuard(m, guardData, lighthouse, []))],
    ["opcode", multi.serializedMessage, multiRewrite((m) => addGuard(m, flip(0, 7)))],
    ["log mode", multi.serializedMessage, multiRewrite((m) => addGuard(m, flip(1, 0)))],
    ["count", multi.serializedMessage, multiRewrite((m) => addGuard(m, flip(2, 4)))],
    ["first assertion kind", multi.serializedMessage, multiRewrite((m) => addGuard(m, flip(3, 1)))],
    ["lamports operator", multi.serializedMessage, multiRewrite((m) => addGuard(m, flip(12, 0)))],
    ["owner kind", multi.serializedMessage, multiRewrite((m) => addGuard(m, flip(13, 2)))],
    ["owner value", multi.serializedMessage, multiRewrite((m) => addGuard(m, flip(14, 1)))],
    ["owner operator", multi.serializedMessage, multiRewrite((m) => addGuard(m, flip(15, 1)))],
    ["length kind", multi.serializedMessage, multiRewrite((m) => addGuard(m, flip(16, 2)))],
    ["length value", multi.serializedMessage, multiRewrite((m) => addGuard(m, flip(17, 1)))],
    ["length operator", multi.serializedMessage, multiRewrite((m) => addGuard(m, flip(25, 1)))],
    ["trailing data", multi.serializedMessage, multiRewrite((m) => addGuard(m, Uint8Array.from([...guardData, 0])))],
    ["short data", multi.serializedMessage, multiRewrite((m) => addGuard(m, guardData.subarray(0, 25)))],
    ["two guards", multi.serializedMessage, multiRewrite((m) => { const g = addGuard(m); return { ...g, numInstructions: g.numInstructions + 1,
      instructionHeaders: [...g.instructionHeaders, g.instructionHeaders.at(-1)!], instructionPayloads: [...g.instructionPayloads, g.instructionPayloads.at(-1)!] }; })],
    ["guard not last", multi.serializedMessage, multiRewrite((m) => { const g = addGuard(m);
      const order = [0, 2, 1]; return { ...g, instructionHeaders: order.map((i) => g.instructionHeaders[i]!), instructionPayloads: order.map((i) => g.instructionPayloads[i]!) }; })],
    ["writable guard program", multi.serializedMessage, multiRewrite((m) => { const g = addGuard(m);
      return { ...g, header: { ...g.header, numReadonlyNonSignerAccounts: g.header.numReadonlyNonSignerAccounts - 1 } }; })],
    ["core references guard program", multi.serializedMessage, multiRewrite((m) => { const g = addGuard(m);
      return { ...g, instructionPayloads: g.instructionPayloads.map((p, i) => i === 1 ? { ...p, instructionAccountIndices: [g.staticAccounts.length - 1] } : p) }; })],
    ["guard + lifetime change", multi.serializedMessage, multiRewrite((m) => addGuard({ ...m, lifetimeToken: "22222222222222222222222222222222" as never }))],
    ["guard + extra key", multi.serializedMessage, multiRewrite((m) => addGuard({ ...m, staticAccounts: [...m.staticAccounts, addr(13)],
      numStaticAccounts: m.numStaticAccounts + 1, header: { ...m.header, numReadonlyNonSignerAccounts: m.header.numReadonlyNonSignerAccounts + 1 } }))],
    ["one-signer review", oneSignerReview.serializedMessage, rewrite(oneSignerReview.serializedMessage, (m) => addGuard(m))],
  ];
  for (const [label, reviewed, walletMessage] of guardRejected) {
    assert.equal(isMimirBetaWalletRewriteV1(reviewed, walletMessage), false, label);
  }
  await assert.rejects(async () => verifyMimirBetaWalletSignedTransactionV1({ transaction: multi, walletAddress: wallet,
    walletSignedTransaction: await walletOnly(guardRejected[1]![2]), preservedSignatures: [], localSigners: [{ address: asset, keyPair: assetKeyPair }] }),
  code("RECEIPT_MISMATCH"));
  // Final caps include the guard: a 64-account review plus the guard key is 65 accounts.
  const wideGuard = rewrite(wide.serializedMessage, (m) => addGuard(m));
  assert.equal(isMimirBetaWalletRewriteV1(wide.serializedMessage, wideGuard), false);
  // No-sign admission: wallet-only output admitted with every local slot still empty; never signs.
  const admit = (walletSignedTransaction: Uint8Array, transaction = multi, collateralTokenAccount?: Address) =>
    admitMimirBetaWalletSignedTransactionV1({ transaction, walletAddress: wallet, walletSignedTransaction, collateralTokenAccount });
  for (const message of [multi.serializedMessage, multiRewrite((m) => insertCbAt(m, cuPrice, 0, 1)), guarded]) {
    const wire = await walletOnly(message); const admitted = await admit(wire);
    assert.deepEqual([admitted.serializedMessage, admitted.messageHash, admitted.requiredSigners], [message, hex(await sha256(message)), [wallet, asset]]);
    assert.ok(wire.subarray(message.length + 64).every((byte) => byte === 0), "asset slot untouched");
  }
  await assert.rejects(() => admit(filled), /wallet filled a local signer slot/);
  await assert.rejects(() => admit(forged), /signature is invalid for/);
  await assert.rejects(async () => admit(await walletOnly(rewrite(multi.serializedMessage, (m) => ({ ...m, lifetimeToken: "22222222222222222222222222222222" as never })))), code("RECEIPT_MISMATCH"));
  await assert.rejects(async () => admit(await walletOnly(multiRewrite((m) => ixData(m, 0, Uint8Array.of(8))))), code("RECEIPT_MISMATCH"));
  await assert.rejects(async () => admit(await walletOnly(multiRewrite((m) => addGuard(m, guardData, lighthouse, [1])))), code("RECEIPT_MISMATCH"));
  await assert.rejects(async () => admit(await walletOnly(wideGuard), wide), (e: unknown) => e instanceof MimirBetaError);
  await assert.rejects(async () => admitMimirBetaWalletSignedTransactionV1({ transaction: multi, walletAddress: asset,
    walletSignedTransaction: await walletOnly(guarded) }), code("RECEIPT_MISMATCH"));
  // Batch: every output correlates to its own review in order; any defect rejects the whole group before any local signature.
  const second = await compileMimirBetaTransactionV1({ feePayer: wallet, recentBlockhash: addr(77), lastValidBlockHeight: 50n,
    instructions: [{ programAddress: program, accounts: [{ address: wallet, isSigner: true, isWritable: true },
      { address: asset, isSigner: true, isWritable: true }, { address: addr(11), isSigner: false, isWritable: false }], data: Uint8Array.of(7) }] });
  const batch = (outputs: readonly Uint8Array[]) => admitMimirBetaWalletSignedBatchV1({ walletAddress: wallet,
    reviews: [{ transaction: multi }, { transaction: second }], walletSignedTransactions: outputs });
  const [w1, w2] = [await walletOnly(guarded), await walletOnly(second.serializedMessage)];
  assert.deepEqual((await batch([w1, w2])).map(({ messageHash }) => messageHash), [hex(await sha256(guarded)), second.messageHash]);
  const tampered = Uint8Array.from(w2); tampered[w2.length - 1] = 1;
  for (const outputs of [[w1], [w1, w2, w2], [w2, w1], [w1, w1], [w1, tampered]]) await assert.rejects(() => batch(outputs), code("RECEIPT_MISMATCH"));
  console.log("beta Transaction v1 wallet-first guard tests passed");
}

// Solflare COLA-paid creation (real bytes): payer guard, then a token-account guard on the reviewed collateral account.
{
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/solflareGuardColaCreation.json", import.meta.url), "utf8"));
  const messageOf = (b64: string) => new Uint8Array(getTransactionDecoder().decode(Buffer.from(b64, "base64")).messageBytes);
  const reviewed = messageOf(fixture.reviewedWireBase64), final = messageOf(fixture.enrichedTxBase64);
  const collateral = fixture.collateralTokenAccount as Address, payer = fixture.payer as Address;
  assert.equal(isMimirBetaFeeOnlyWalletRewriteV1(reviewed, final), false);
  assert.equal(isMimirBetaWalletRewriteV1(reviewed, final), false, "token guard needs the reviewed collateral account");
  assert.equal(isMimirBetaWalletRewriteV1(reviewed, final, payer), false, "token guard on another account");
  assert.equal(isMimirBetaWalletRewriteV1(reviewed, final, collateral), true, "observed Solflare COLA guards");
  assert.deepEqual([...mimirBetaReviewedToWalletInstructionIndexesV1(reviewed, final, collateral)], Array.from({ length: 8 }, (_, i) => [i, i]));
  assert.throws(() => mimirBetaReviewedToWalletInstructionIndexesV1(reviewed, final));
  const W = getCompiledTransactionMessageDecoder().decode(final) as CompiledV1;
  const last = W.instructionHeaders.length - 1, collateralIndex = W.staticAccounts.indexOf(collateral);
  const encode = (m: CompiledV1) => new Uint8Array(getCompiledTransactionMessageEncoder().encode(m));
  const setGuard = (at: number, patch: (p: CompiledV1["instructionPayloads"][number]) => CompiledV1["instructionPayloads"][number]) =>
    encode({ ...W, instructionPayloads: W.instructionPayloads.map((p, i) => i === at ? patch(p) : p) });
  const tokenData = (at: number, value: number) => setGuard(last, (p) => { const d = Uint8Array.from(p.instructionData); d[at] = value; return { ...p, instructionData: d }; });
  const order = (indexes: number[]) => encode({ ...W, numInstructions: indexes.length,
    instructionHeaders: indexes.map((i) => W.instructionHeaders[i]!), instructionPayloads: indexes.map((i) => W.instructionPayloads[i]!) });
  const core = Array.from({ length: last - 1 }, (_, i) => i);
  for (const floor of [0, 0xff]) {
    const m = setGuard(last, (p) => { const d = Uint8Array.from(p.instructionData); d.fill(floor, 5, 13); return { ...p, instructionData: d }; });
    assert.equal(isMimirBetaWalletRewriteV1(reviewed, m, collateral), true, `token floor ${floor}`);
  }
  for (let at = 0; at < 64; at += 1) {
    if (at >= 5 && at < 13) continue;
    const original = W.instructionPayloads[last]!.instructionData[at]!;
    assert.equal(isMimirBetaWalletRewriteV1(reviewed, tokenData(at, original ^ 1), collateral), false, `token guard byte ${at}`);
  }
  const rejected: Array<[string, Uint8Array]> = [
    ["token guard on the asset", setGuard(last, (p) => ({ ...p, instructionAccountIndices: [1] }))],
    ["token guard on another writable account", setGuard(last, (p) => ({ ...p, instructionAccountIndices: [collateralIndex === 2 ? 3 : 2] }))],
    ["token guard extra account", setGuard(last, (p) => ({ ...p, instructionAccountIndices: [collateralIndex, collateralIndex] }))],
    ["token guard trailing byte", setGuard(last, (p) => ({ ...p, instructionData: Uint8Array.from([...p.instructionData, 0]) }))],
    ["payer guard byte", setGuard(last - 1, (p) => { const d = Uint8Array.from(p.instructionData); d[13] ^= 1; return { ...p, instructionData: d }; })],
    ["token guard only", order([...core, last])],
    ["token guard first", order([...core, last, last - 1])],
    ["token guard twice", order([...core, last - 1, last, last])],
    ["payer guard twice", order([...core, last - 1, last - 1])],
    ["guards before core", order([last - 1, last, ...core])],
  ];
  for (const [label, m] of rejected) assert.equal(isMimirBetaWalletRewriteV1(reviewed, m, collateral), false, label);
  const burn = (source: Address, authority: Address) => ({ proof: { kind: "spl-token-burn-checked", sourceTokenAccount: source, authority } });
  assert.equal(mimirBetaReviewCollateralTokenAccountV1({ authority: payer, expectedWrites: [burn(collateral, payer), burn(collateral, payer)] }), collateral);
  assert.equal(mimirBetaReviewCollateralTokenAccountV1({ authority: payer, expectedWrites: [burn(collateral, asset)] }), null);
  assert.equal(mimirBetaReviewCollateralTokenAccountV1({ authority: payer, expectedWrites: [burn(collateral, payer), burn(asset, payer)] }), null);
  console.log("beta Transaction v1 Solflare COLA guard tests passed");
}
