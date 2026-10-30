import { MIMIR_SAMPLED_SOURCE_ADAPTERS } from "../src/internal/sampledTemporalCore.js";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { getAddressFromPublicKey, type Address } from "@solana/addresses";
import { getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder } from "@solana/transaction-messages";
import { getTransactionEncoder, partiallySignTransaction, type Transaction } from "@solana/transactions";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { addressBytes, base64, bytesAddress, hex, sha256 } from "../src/beta/bytes.js";
import { MimirBetaError, MimirBetaStalePreparationError } from "../src/beta/errors.js";
import {
  MIMIR_BETA_TRANSACTION_V1_CONFIG,
  MIMIR_BETA_TRANSACTION_V1_MIN_PRIORITY_FEE_LAMPORTS,
  compileMimirBetaTransactionV1,
  isMimirBetaFeeOnlyWalletRewriteV1,
  mimirBetaReviewedMessageOfWalletV1,
  partiallySignMimirBetaTransactionV1,
  verifyMimirBetaWalletSignedTransactionV1,
} from "../src/beta/transactionV1.js";
import { findOracleRegistryPda } from "../src/pda.js";
import { freshAdapterAccounts, mimirClassicNativeTail, mimirDlmmRouteableEdgeArrays, prepareMimirBetaClassicRefresh } from "../src/beta/live.js";
import { deriveMimirClassicExecutionAddress, mimirClassicExecutionLayout, mimirClassicRow } from "../src/beta/classicExecution.js";
import { encodeMimirFusedDescriptor, mimirAdmittedRecipe, mimirFusedRecipeBindingVariant } from "../src/beta/compositeExecution.js";
import { mimirRecipeTupleKey, type MimirAbi1Capability } from "../src/beta/abi1Release.js";
import { buildTestSnapshotHeader } from "../src/fixtures.js";
import { MIMIR_COND, predictMimirDegradedSnapshot } from "../src/liveness.js";
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
const base = {recentBlockhash: "11111111111111111111111111111111"};
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

for (const [family, variant] of [["orca-whirlpool", "direct"]] as [Exclude<MimirBetaEligiblePool["family"], "meteora-damm-v2">, "direct" | "routeable" | "native"][]) {
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
  const degradedPost = (d: Uint8Array) => predictMimirDegradedSnapshot(d, { newRevision: new DataView(d.buffer, d.byteOffset).getBigUint64(96, true),
    minSources: 1, sourceCount: 1, snapshotSource: 5, clock: { slot: 200n, unixTs: 1_700_000_000n }, conditionFlags: MIMIR_COND.DEPTH_BELOW_FLOOR,
    powersMask: 0, conditionedSources: 1 });
  const cases = [
    ["above-floor", false, (d: Uint8Array) => d],
    ["below-floor-lands-degraded", true, degradedPost],
    ["below-floor-bare-status-refused", true, (d: Uint8Array) => { d[104] = 1; return d; }],
    ["recovered-fresh", false, (d: Uint8Array) => d],
    ["wrong-feed-a", true, (d: Uint8Array) => { const p = degradedPost(d); p[16]! ^= 1; return p; }],
    ["wrong-feed-b", true, (d: Uint8Array) => { const p = degradedPost(d); p[16]! ^= 2; return p; }],
    ["future-degraded", true, (d: Uint8Array) => predictMimirDegradedSnapshot(d, { newRevision: new DataView(d.buffer, d.byteOffset).getBigUint64(96, true),
      minSources: 1, sourceCount: 1, snapshotSource: 5, clock: { slot: 500n, unixTs: 1_700_000_000n }, conditionFlags: MIMIR_COND.DEPTH_BELOW_FLOOR,
      powersMask: 0, conditionedSources: 1 })],
    ["wrong-plan-fresh", false, (d: Uint8Array) => { d[262]! ^= 1; return d; }],
    ["wrong-config-revision-fresh", false, (d: Uint8Array) => { d[88]! ^= 1; return d; }],
    ["future-fresh", false, (d: Uint8Array) => { new DataView(d.buffer).setBigUint64(116, 201n, true); return d; }],
    ["expired-fresh", false, (d: Uint8Array) => { new DataView(d.buffer).setBigUint64(124, 199n, true); return d; }],
    ["same-slot-unchanged-fresh", false, (d: Uint8Array) => { new DataView(d.buffer).setBigUint64(96, 0n, true); return d; }],
    ["unchanged-fresh-older-than-floor", false, (d: Uint8Array) => { const v = new DataView(d.buffer); v.setBigUint64(96, 0n, true); v.setBigUint64(116, 50n, true); return d; }],
  ] as const;
  const out: Record<string, unknown>[] = [];
  for (const [name, change, post] of cases) {
    freshPool = change ? { ...aboveFloorPool, minDepthTo50BpsNative: pool.minDepthTo50BpsNative - 1n } : aboveFloorPool;
    postSnapshot = post;
    const before = [blockhashCalls, simulationCalls];
    try { const p = await prepare(); out.push({ name, result: "prepared", mode: p.mode, publication: p.publication, calls: [blockhashCalls-before[0]!,simulationCalls-before[1]!] }); }
    catch (e) { const error = e as Error & {code?:string}; out.push({name,result: error.code,message:error.message,calls:[blockhashCalls-before[0]!,simulationCalls-before[1]!]}); }
  }
  assert.deepEqual(out[0]!.publication, { status: "fresh" });
  // Cold test predecessor (snapshot slot 0): the predicted program write is NO_PRICE; a warm feed carries WITH_PRICE (exact-ELF cell 23).
  assert.deepEqual(out[1]!.publication, { status: "degraded", conditionFlags: MIMIR_COND.DEPTH_BELOW_FLOOR, priceState: "no-price",
    conditionedSources: 1, belowFloorSources: [0] });
  assert.deepEqual(out[1]!.calls, [1, 1]);
  assert.equal(out[2]!.result, "CLASSIC_PUBLICATION_NOT_FRESH");
  assert.deepEqual(out[3]!.publication, { status: "fresh" });
  assert.deepEqual(out.at(-2)!.publication, { status: "fresh" }, "same-slot-unchanged-fresh");
  for (const result of [...out.slice(4, -2), out.at(-1)!]) assert.equal(result.result, "CLASSIC_PUBLICATION_NOT_FRESH", String(result.name));
}
