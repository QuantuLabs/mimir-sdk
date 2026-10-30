import assert from "node:assert/strict";
import { getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";
import {
  buildMimirBetaClassicSourceArtifacts,
  buildMimirBetaPoolCreationBinding,
  buildMimirBetaSourceAppendInstruction,
  assertMimirBetaStateTuple,
  decodeMimirBetaCaptureCandidate, deriveMimirBetaPumpSwapBoostVault, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID,
  deriveMimirBetaClassicFeedId,
  deriveMimirBetaProposalHash,
  encodeMimirBetaProposalSnapshot,
  encodeMimirBetaClassicInitArgs,
  encodeMimirBetaCompositeV1Config,
  encodeMimirBetaIdentityActivationData,
  encodeMimirBetaIdentityCompositeData,
  encodeMimirBetaIdentityProposalData,
  encodeMimirBetaSourceAppendData,
  mimirBetaHashv,
  parseMimirBetaIntegerQuantityX64,
  decodeMimirBetaLiveSourceTemporalModuleV1,
  MimirBetaError,
  type MimirBetaClassicInitArgs,
  type MimirBetaEligiblePool,
} from "../src/beta/index.js";
import { SourceDirection } from "../src/sourceDirection.js";
import { makeBetaCaptureFixture } from "./fixtures/betaCaptureFixtures.js";
import { buildMimirBetaIdentityCompositeInstruction, deriveMimirBetaPda, encodeMimirBetaTicker } from "../src/beta/abi.js";
import { deriveMimirClassicRecipe } from "../src/beta/classicExecution.js";
import { SOURCE_TEMPORAL_MODULE_V1 } from "../src/codec.js";
import { COMPOSITE_CONFIG_OFFSETS, RING_OFFSETS } from "../src/constants.js";
import { buildTestSourceObservationRingHeader } from "../src/fixtures.js";

const addressDecoder = getAddressDecoder();
const addressEncoder = getAddressEncoder();
const raw = (byte: number) => Uint8Array.from({ length: 32 }, () => byte);
const addr = (byte: number): Address => addressDecoder.decode(raw(byte));
const addrBytes = (value: Address) => Uint8Array.from(addressEncoder.encode(value));
const hex = (value: Uint8Array) => Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
const sha = async (value: Uint8Array) => hex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer)));

const dammRing = (extended: boolean) => {
  const o = SOURCE_TEMPORAL_MODULE_V1;
  const length = extended ? o.headerLen : 544;
  const data = Buffer.alloc(length);
  if (extended) {
    data.write("MTP1", 0, "ascii"); data.writeUInt16LE(o.abiVersion, 4); data.writeUInt16LE(o.headerLen, 6);
    data.writeBigUInt64LE(10n, o.lastModuleRefreshSlotOffset);
    data.writeUInt16LE(o.proofKind, o.proofKindOffset); data.writeUInt16LE(o.presenceA, o.flagsOffset);
    data.fill(1, o.contextHashOffset, o.contextHashOffset + 32); data.writeBigInt64LE(1_200n, o.lastObservationUnixTsOffset);
    data.writeBigUInt64LE(10n, o.anchorOffset); data.writeBigInt64LE(1_000n, o.anchorOffset + 8);
    data.writeBigUInt64LE(0n, o.anchorOffset + 16); data.writeBigUInt64LE(1n, o.anchorOffset + 24);
    data.writeBigUInt64LE(1n, o.anchorOffset + 56);
  } else {
    buildTestSourceObservationRingHeader().copy(data);
    data.writeUInt16LE(0, 8); data.writeUInt16LE(length, 10);
    data.writeUInt16LE(1, RING_OFFSETS.ringVersion);
    data.writeUInt16LE(300, 56); data.writeUInt16LE(0, 58); data[52] = 7; data[53] = 0;
    for (const offset of [RING_OFFSETS.activeMinDepthTo50BpsNative, RING_OFFSETS.activeMinLiquidityNative,
      RING_OFFSETS.activeMinEconLossFloorNative, RING_OFFSETS.activeMinCapitalRequiredFloorNative]) data.writeBigUInt64LE(1n, offset);
  }
  return data;
};
const emptyRing = { newestSlot: (1n << 64n) - 1n } as Parameters<typeof decodeMimirBetaLiveSourceTemporalModuleV1>[1];
assert.equal(decodeMimirBetaLiveSourceTemporalModuleV1(dammRing(true), emptyRing).dammOnlyBTail?.kind, "damm-onlyb-interval-v1");

const init: MimirBetaClassicInitArgs = {
  baseMint: addr(1), quoteMint: addr(2), sourceSetRoot: raw(3), staticAccountsRoot: raw(4),
  anchorPolicyHash: raw(5), nativeExceptionHash: raw(6), adapterMask: 143n,
  namespaceVersion: 1, planId: 2, planVersion: 3, hashSchemeVersion: 4, ringVersion: 5,
  profile: 6, riskTier: 7, sourceCount: 2, minSources: 2, minVenues: 2,
  minCorrelationGroups: 2, baseDecimals: 9, quoteDecimals: 6,
  bindingVariants: [1, 0, 0, 0, 0], priceExponent: -8,
  maxDispersionBps: 100, maxSourceActivityAgeSlots: 200, minCoverageRatioBps: 300,
  maxConfidenceBps: 400, maxSnapshotAgeSlots: 500,
};

const initBytes = encodeMimirBetaClassicInitArgs(init);
assert.equal(initBytes.length, 236);
assert.equal(await sha(initBytes), "75509ae29971ca5bea7f8e2310fe14eb1575e93fc941c9aac434e0481091b262");
assert.equal(hex(initBytes.subarray(0, 32)), "01".repeat(32));
assert.equal(hex(initBytes.subarray(32, 64)), "02".repeat(32));
assert.equal(new DataView(initBytes.buffer, initBytes.byteOffset).getBigUint64(192, true), 143n);
assert.equal(new DataView(initBytes.buffer, initBytes.byteOffset).getInt32(222, true), -8);
for (const priceExponent of [-36, 19]) {
  assert.doesNotThrow(() => encodeMimirBetaIdentityProposalData({ ...init, priceExponent }, addr(14)));
}
for (const priceExponent of [20, 36]) {
  assert.throws(() => encodeMimirBetaIdentityProposalData({ ...init, priceExponent }, addr(14)),
    (error) => error instanceof MimirBetaError && error.code === "INVALID_ARGUMENT");
}
for (const maxConfidenceBps of [1, 9_999]) {
  assert.doesNotThrow(() => encodeMimirBetaIdentityProposalData({ ...init, maxConfidenceBps }, addr(14)));
}
for (const maxConfidenceBps of [0, 10_000, 65_535]) {
  assert.throws(() => encodeMimirBetaIdentityProposalData({ ...init, maxConfidenceBps }, addr(14)),
    (error) => error instanceof MimirBetaError && error.code === "INVALID_ARGUMENT");
}

const identityProposal = encodeMimirBetaIdentityProposalData(init, addr(14));
assert.equal(identityProposal.length, 270);
assert.deepEqual([...identityProposal.subarray(0, 2)], [78, 2]);
assert.equal(hex(identityProposal.subarray(238)), "0e".repeat(32));
assert.equal(await sha(identityProposal), "0d27ec1d03abe8bad5768f185512a6ea9f1a6d85ab7a27845d3d266906c21291");

const sourceAppend = encodeMimirBetaSourceAppendData({
  source: {
    feedId: addr(11), sourceIndex: 2, adapterType: 7, direction: 1, adapterVersion: 0,
    venueGroup: 8, operatorGroup: 9, liquidityOwnerGroup: 10, routeCorrelationGroup: 11,
    quoteAssetGroup: 12, bridgeOrWrapperGroup: 13, oracleSourceClass: 14,
    upgradeAuthorityGroup: 15, maxSourceWeightBps: 2500,
    minLiquidityNative: 123n, minDepthTo50BpsNative: 456n,
    programId: addr(26), poolOrMarket: addr(27), baseVault: addr(28), quoteVault: addr(29),
    tokenProgram: addr(30), vaultAuthority: addr(31), sourceConfigRevision: 2n, sourceSetRevision: 3n,
  },
  sourceRootProof: [raw(40), raw(41), raw(42)],
  accountRootProof: [raw(43), raw(44), raw(45)],
});
assert.equal(sourceAppend.length, 489);
assert.deepEqual([...sourceAppend.subarray(0, 2)], [78, 1]);
assert.equal(await sha(sourceAppend), "51d20a38bdcff6f4bbd28a925cf6e2296883ac726543b8b6b7eb0ac70be492a3");

// Classic (tag 89/90) row admission: CLMM and DLMM external widths per adapter version.
const classicWidth = (adapterType: number, adapterVersion: number, externalWidth: number) =>
  deriveMimirClassicRecipe({ role: "primary", adapterType, adapterVersion, externalWidth, minSlotGap: 1 });
for (const [version, width] of [[0, 7], [0, 8], [1, 8], [1, 9]] as const) assert.equal(classicWidth(1, version, width).externalWidth, width);
for (const [version, width] of [[0, 9], [1, 7]] as const) assert.throws(() => classicWidth(1, version, width), /UnsupportedCompositeExecutionRecipe/);
for (const [version, width] of [[0, 4], [0, 6], [0, 7], [0, 9], [1, 5], [1, 7], [1, 8], [1, 10]] as const) assert.equal(classicWidth(3, version, width).externalWidth, width);
for (const [version, width] of [[0, 5], [0, 8], [1, 4], [1, 6], [1, 9]] as const) assert.throws(() => classicWidth(3, version, width), /UnsupportedCompositeExecutionRecipe/);

const orcaFixture = await makeBetaCaptureFixture("orca-whirlpool", { seed: 77 });
const orcaCandidate = await decodeMimirBetaCaptureCandidate(orcaFixture.input);
const orcaPool: MimirBetaEligiblePool = {
  family: "orca-whirlpool", programId: orcaCandidate.programId, pool: orcaCandidate.pool,
  adapterVersion: orcaCandidate.adapterVersion, token2022Mint: orcaCandidate.token2022Mint, token2022PolicyHash: orcaCandidate.token2022PolicyHash,
  descriptorId: orcaCandidate.descriptorId, descriptorHash: orcaCandidate.descriptorHash,
  readPlan: orcaFixture.input.expectedPlan, canonicalMint0: orcaCandidate.canonicalMint0,
  canonicalMint1: orcaCandidate.canonicalMint1, canonicalPairKey: orcaCandidate.canonicalPairKey,
  direction: "quote-per-base", baseMint: orcaCandidate.baseMint, quoteMint: orcaCandidate.quoteMint,
  eligibility: "eligible", baseVault: orcaCandidate.baseVault, quoteVault: orcaCandidate.quoteVault,
  minLiquidityNative: orcaCandidate.minLiquidityNative, minDepthTo50BpsNative: orcaCandidate.minDepthTo50BpsNative,
  observedSlot: 100n, validThroughSlot: 300n, evidenceHash: "1".repeat(64), creation: orcaFixture.creation,
};
const orcaFeedId = await deriveMimirBetaClassicFeedId(orcaPool.baseMint, orcaPool.quoteMint);
const orcaFacts = orcaFixture.creation.staticAccounts.map(({ address }) => {
  const account = orcaFixture.fixtureAccounts.find((entry) => entry.address === address)!;
  return { address, owner: account.owner, executable: account.executable };
});
const orcaArtifacts = await buildMimirBetaClassicSourceArtifacts({
  programId: addr(9), feedId: orcaFeedId, baseMint: orcaPool.baseMint, quoteMint: orcaPool.quoteMint,
  pools: [orcaPool], physicalAccounts: orcaFacts,
});
assert.equal(SourceDirection.QuotePerBase, 1);
assert.equal(orcaArtifacts.artifacts[0]!.source.direction, SourceDirection.QuotePerBase);

const clmmV1Fixture = await makeBetaCaptureFixture("raydium-clmm", { seed: 177, baseMint: addr(21), quoteMint: addr(22) });
const clmmV1Input = { ...clmmV1Fixture.input, accounts: clmmV1Fixture.input.accounts.map((row) =>
  row.address === clmmV1Fixture.input.pair.baseMint || row.address === clmmV1Fixture.input.expectedPlan.baseVault
    ? { ...row, owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address } : row) };
const clmmV1Candidate = await decodeMimirBetaCaptureCandidate(clmmV1Input);
const clmmV1Creation = buildMimirBetaPoolCreationBinding(clmmV1Candidate);
const clmmV1Pool: MimirBetaEligiblePool = {
  eligibility: "eligible", family: "raydium-clmm", programId: clmmV1Candidate.programId, pool: clmmV1Candidate.pool,
  descriptorId: clmmV1Candidate.descriptorId, descriptorHash: clmmV1Candidate.descriptorHash, readPlan: clmmV1Input.expectedPlan,
  canonicalMint0: clmmV1Candidate.canonicalMint0, canonicalMint1: clmmV1Candidate.canonicalMint1,
  canonicalPairKey: clmmV1Candidate.canonicalPairKey, direction: "quote-per-base", baseMint: clmmV1Candidate.baseMint,
  quoteMint: clmmV1Candidate.quoteMint, baseVault: clmmV1Candidate.baseVault, quoteVault: clmmV1Candidate.quoteVault,
  adapterVersion: clmmV1Candidate.adapterVersion, token2022Mint: clmmV1Candidate.token2022Mint,
  token2022PolicyHash: clmmV1Candidate.token2022PolicyHash, minLiquidityNative: clmmV1Candidate.minLiquidityNative,
  minDepthTo50BpsNative: clmmV1Candidate.minDepthTo50BpsNative, observedSlot: 1n, validThroughSlot: 2n,
  evidenceHash: "a".repeat(64), creation: clmmV1Creation,
};
const clmmV1Facts = clmmV1Creation.staticAccounts.map(({ address }) => {
  const account = clmmV1Input.accounts.find((row) => row.address === address)!;
  return { address, owner: account.owner, executable: account.executable };
});
const clmmV1Artifacts = await buildMimirBetaClassicSourceArtifacts({ programId: addr(9), feedId: await deriveMimirBetaClassicFeedId(clmmV1Pool.baseMint, clmmV1Pool.quoteMint),
  baseMint: clmmV1Pool.baseMint, quoteMint: clmmV1Pool.quoteMint, pools: [clmmV1Pool], physicalAccounts: clmmV1Facts });
const clmmV1Artifact = clmmV1Artifacts.artifacts[0]!;
assert.equal(clmmV1Artifact.staticAccounts.length, 5);
assert.deepEqual(clmmV1Creation.staticAccounts.map(({ role }) => role), ["base-vault", "quote-vault", "pool", "amm-config", "token2022-mint"]);
const proposalAppend = buildMimirBetaSourceAppendInstruction({ programId: addr(9),
  accounts: [{ address: addr(18), isSigner: false, isWritable: true }, ...clmmV1Artifact.staticAccounts.map((address) => ({ address, isSigner: false, isWritable: false }))],
  source: clmmV1Artifact.source, sourceRootProof: clmmV1Artifact.sourceRootProof, accountRootProof: clmmV1Artifact.accountRootProof });
assert.equal(proposalAppend.accounts.length - 1, 5);
assert.deepEqual(proposalAppend.accounts.slice(4).map(({ address }) => address), [clmmV1Creation.staticAccounts[3]!.address, clmmV1Creation.staticAccounts[4]!.address]);

const activation = encodeMimirBetaIdentityActivationData("ABC");
assert.deepEqual([...activation], [80, 3, 65, 66, 67, 0, 0, 0, 0, 0, 0, 0, 0]);

const config = new Uint8Array(661);
const configView = new DataView(config.buffer);
configView.setUint16(8, 1, true);
configView.setUint16(10, 661, true);
configView.setUint32(12, 1, true);
config.set([3, 65, 66, 67, 0, 0, 0], 185);
config[119] = 2;
config.set(raw(1), 229); config.set(raw(3), 261); configView.setBigUint64(293, 1n, true);
config.set(raw(2), 309); config.set(raw(4), 341); configView.setBigUint64(373, 2n, true);
config.set(raw(14), 629);
const composite = encodeMimirBetaIdentityCompositeData(config);
assert.equal(composite.length, 662);
assert.equal(composite[0], 81);
assert.deepEqual(composite.subarray(1), config);
{
  const converted = config.slice(); converted.fill(9, 197, 229);
  const tailed = encodeMimirBetaIdentityCompositeData(converted, [0, 4242, 4242]);
  assert.deepEqual([...tailed.subarray(662)], [0x01, 0x00, 0x00, 0x92, 0x10, 0x92, 0x10]);
  assert.deepEqual(tailed.subarray(0, 662), encodeMimirBetaIdentityCompositeData(converted));
  assert.deepEqual(encodeMimirBetaIdentityCompositeData(converted, [0, 0, 0]), encodeMimirBetaIdentityCompositeData(converted));
  assert.throws(() => encodeMimirBetaIdentityCompositeData(converted, [0, 4242]), (error) => error instanceof MimirBetaError && error.code === "PROGRAM_ABI_MISMATCH");
  assert.throws(() => encodeMimirBetaIdentityCompositeData(config, [0, 4242, 4242]), (error) => error instanceof MimirBetaError && error.code === "PROGRAM_ABI_MISMATCH");
}
// Tag-81 layout vector: the fused identity envelope reads these canonical CFC offsets after the opcode byte.
assert.deepEqual([COMPOSITE_CONFIG_OFFSETS.componentCount, COMPOSITE_CONFIG_OFFSETS.bump,
  COMPOSITE_CONFIG_OFFSETS.solConversionSourceConfig, COMPOSITE_CONFIG_OFFSETS.components], [119, 184, 197, 229]);
{
  const twelve = config.slice(); twelve.set(encodeMimirBetaTicker("ABCDEFGHIJKL"), 185);
  const data = encodeMimirBetaIdentityCompositeData(twelve);
  assert.equal(data[1 + COMPOSITE_CONFIG_OFFSETS.componentCount], 2);
  assert.equal(new TextDecoder().decode(data.subarray(186, 198)), "ABCDEFGHIJKL");
  assert.ok(data.subarray(198, 230).every((byte) => byte === 0));
  twelve.fill(9, 197, 229);
  assert.ok(encodeMimirBetaIdentityCompositeData(twelve).subarray(198, 230).every((byte) => byte === 9));
}
const oneComponentConfig = config.slice();
oneComponentConfig[119] = 1;
oneComponentConfig.fill(0, 309, 389);
assert.equal(encodeMimirBetaIdentityCompositeData(oneComponentConfig)[0], 81);
const oneComponentAccounts = Array.from({ length: 21 }, (_, index) => ({
  address: addr(40 + index), isSigner: false, isWritable: index === 12,
}));
const oneComponentInstruction = buildMimirBetaIdentityCompositeInstruction({
  programId: addr(9), canonicalConfig: oneComponentConfig, componentSourceCount: 1, accounts: oneComponentAccounts,
});
assert.equal(oneComponentInstruction.data[0], 81);
assert.equal(oneComponentInstruction.accounts.length, 21);
const zeroComponentConfig = oneComponentConfig.slice();
zeroComponentConfig[119] = 0;
assert.throws(() => buildMimirBetaIdentityCompositeInstruction({
  programId: addr(9), canonicalConfig: zeroComponentConfig, componentSourceCount: 1, accounts: oneComponentAccounts,
}), (error) => error instanceof MimirBetaError && error.code === "PROGRAM_ABI_MISMATCH");
const compositeConfigArgs = {
  programId: addr(9), creator: addr(10), quoteMint: addr(11), priceExponent: -8,
  maxSnapshotAgeSlots: 20, maxComponentSnapshotAgeSlots: 20, maxComponentConfidenceBps: 100,
  maxComponentDispersionBps: 100, registryEpoch: 1n, configRevision: 1n, adminConfigRevisionAtCreation: 1n,
  components: [
    { feedId: addr(1), sourceConfig: addr(3), quantityX64: 1n },
    { feedId: addr(2), sourceConfig: addr(4), quantityX64: 2n },
  ], identityAsset: addr(14), ticker: "ABC",
};
for (const priceExponent of [-36, 19]) {
  await assert.doesNotReject(() => encodeMimirBetaCompositeV1Config({ ...compositeConfigArgs, priceExponent }));
  const wrapped = config.slice(); new DataView(wrapped.buffer).setInt32(112, priceExponent, true);
  assert.doesNotThrow(() => encodeMimirBetaIdentityCompositeData(wrapped));
}
for (const priceExponent of [20, 36]) {
  await assert.rejects(() => encodeMimirBetaCompositeV1Config({ ...compositeConfigArgs, priceExponent }),
    (error) => error instanceof MimirBetaError && error.code === "INVALID_ARGUMENT");
  const wrapped = config.slice(); new DataView(wrapped.buffer).setInt32(112, priceExponent, true);
  assert.throws(() => encodeMimirBetaIdentityCompositeData(wrapped),
    (error) => error instanceof MimirBetaError && error.code === "PROGRAM_ABI_MISMATCH");
}

const feed = await deriveMimirBetaClassicFeedId(addr(1), addr(2));
assert.equal(hex(Uint8Array.from(addressEncoder.encode(feed))), "9351804a73167c5bdeca43663e512e7538ec9df002a9c612b4a49c6aa5cef77c");
const snapshot = encodeMimirBetaProposalSnapshot({ registryEpochAtProposal: 0x0102030405060708n,
  adminRevisionAtProposal: 0x1112131415161718n, refreshFeeDefaultLamportsAtProposal: 0x2122232425262728n,
  collateralAmountRawAtProposal: 0x3132333435363738n, collateralMintAtProposal: addr(51), feeTreasuryAtProposal: addr(52) });
assert.equal(snapshot.length, 96);
assert.equal(hex(snapshot.subarray(0, 32)), "0807060504030201181716151413121128272625242322213837363534333231");
assert.equal(hex(snapshot.subarray(32, 64)), "33".repeat(32));
assert.equal(hex(snapshot.subarray(64, 96)), "34".repeat(32));
const proposalState = new Uint8Array(608 + 392); const proposalView = new DataView(proposalState.buffer);
proposalView.setUint16(8, 1, true); proposalView.setUint16(10, 608, true); proposalState.fill(14, 464, 496);
proposalState.set(snapshot, 512);
assert.equal(assertMimirBetaStateTuple({ kind: "proposal", data: proposalState, sourceCount: 1 }), 1);
for (const headerLength of [512, 607, 609]) {
  const malformed = proposalState.slice(); new DataView(malformed.buffer).setUint16(10, headerLength, true);
  assert.throws(() => assertMimirBetaStateTuple({ kind: "proposal", data: malformed, sourceCount: 1 }),
    (error) => error instanceof MimirBetaError && error.code === "PROGRAM_ABI_MISMATCH");
}
const proposal = await deriveMimirBetaProposalHash({
  programId: addr(9), proposer: addr(10), feedId: addr(11), registryStateHash: raw(7),
  adminStateHash: raw(8), snapshot, legacyInitArgs: initBytes, identityAsset: addr(14), planHash: raw(15),
});
assert.equal(hex(proposal), "fceedbf404f9ffc2d8a7195edf0d9188712242141815d96aecd6a37c019022fe");
assert.equal(hex(proposal), await sha(new Uint8Array([
  ...new TextEncoder().encode("MIMIR_FEED_PLAN_PROPOSAL_IDENTITY_V1"), ...raw(9), ...raw(10), ...raw(11),
  ...raw(7), ...raw(8), ...snapshot, ...initBytes, ...raw(14), ...raw(15),
])));
for (let offset = 0; offset < snapshot.length; offset += 1) {
  const changed = snapshot.slice(); changed[offset] ^= 1;
  assert.notEqual(hex(await deriveMimirBetaProposalHash({ programId: addr(9), proposer: addr(10), feedId: addr(11),
    registryStateHash: raw(7), adminStateHash: raw(8), snapshot: changed, legacyInitArgs: initBytes,
    identityAsset: addr(14), planHash: raw(15) })), hex(proposal), `snapshot byte ${offset}`);
}

const originalAsset = config.slice(629, 661);
const mutated = config.slice(); mutated.set(raw(15), 629);
assert.notEqual(hex(await mimirBetaHashv([config])), hex(await mimirBetaHashv([mutated])));
assert.equal(hex(originalAsset), "0e".repeat(32));
assert.equal(parseMimirBetaIntegerQuantityX64("1"), 1n << 64n);
assert.equal(parseMimirBetaIntegerQuantityX64("18446744073709551615"), ((1n << 64n) - 1n) << 64n);
for (const invalid of ["", "0", "+1", "-1", "01", "1.0", "1e2", "18446744073709551616"]) {
  assert.throws(() => parseMimirBetaIntegerQuantityX64(invalid), (error) => error instanceof MimirBetaError && error.code === "INVALID_ARGUMENT");
}

console.log("betaCurrentProgramAbi.test.ts passed");

assert.equal(clmmV1Artifact.boostVault, null);
const pumpFixture = await makeBetaCaptureFixture("pumpswap", { seed: 178, baseMint: addr(23), quoteMint: addr(24) });
const pumpCandidate = await decodeMimirBetaCaptureCandidate(pumpFixture.input);
const pumpCreation = buildMimirBetaPoolCreationBinding(pumpCandidate);
const pumpPool: MimirBetaEligiblePool = { ...clmmV1Pool, family: "pumpswap", programId: pumpCandidate.programId, pool: pumpCandidate.pool,
  descriptorId: pumpCandidate.descriptorId, descriptorHash: pumpCandidate.descriptorHash, readPlan: pumpFixture.input.expectedPlan,
  canonicalMint0: pumpCandidate.canonicalMint0, canonicalMint1: pumpCandidate.canonicalMint1, canonicalPairKey: pumpCandidate.canonicalPairKey,
  baseMint: pumpCandidate.baseMint, quoteMint: pumpCandidate.quoteMint, baseVault: pumpCandidate.baseVault, quoteVault: pumpCandidate.quoteVault,
  adapterVersion: pumpCandidate.adapterVersion, token2022Mint: pumpCandidate.token2022Mint, token2022PolicyHash: pumpCandidate.token2022PolicyHash,
  minLiquidityNative: pumpCandidate.minLiquidityNative, minDepthTo50BpsNative: pumpCandidate.minDepthTo50BpsNative, creation: pumpCreation };
const pumpFacts = pumpCreation.staticAccounts.map(({ address }) => {
  const account = pumpFixture.input.accounts.find((row) => row.address === address)!;
  return { address, owner: account.owner, executable: account.executable };
});
const pumpArtifact = (await buildMimirBetaClassicSourceArtifacts({ programId: addr(9), feedId: await deriveMimirBetaClassicFeedId(pumpPool.baseMint, pumpPool.quoteMint),
  baseMint: pumpPool.baseMint, quoteMint: pumpPool.quoteMint, pools: [pumpPool], physicalAccounts: pumpFacts })).artifacts[0]!;
assert.equal(pumpArtifact.boostVault, deriveMimirBetaPumpSwapBoostVault(pumpCandidate.pool, pumpCandidate.quoteMint, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID));
assert.equal(pumpCreation.staticAccounts[4]!.address, pumpCandidate.pool);
for (const [pumpSwapBaseIsA, poolQuoteMint] of [[true, pumpCandidate.quoteMint], [false, pumpCandidate.baseMint]] as const) {
  const oriented = (await buildMimirBetaClassicSourceArtifacts({ programId: addr(9), feedId: await deriveMimirBetaClassicFeedId(pumpPool.baseMint, pumpPool.quoteMint),
    baseMint: pumpPool.baseMint, quoteMint: pumpPool.quoteMint, pools: [{ ...pumpPool, boostVaultLamports: 0n, maxBoostDriftBps: 0n, pumpSwapBaseIsA }],
    physicalAccounts: pumpFacts })).artifacts[0]!;
  assert.equal(oriented.boostVault, deriveMimirBetaPumpSwapBoostVault(pumpCandidate.pool, poolQuoteMint, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID));
}
console.log("current program ABI: PumpSwap admission boost vault ok");
