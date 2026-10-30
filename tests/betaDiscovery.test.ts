import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import type { Address } from "@solana/kit";
import {
  buildMimirBetaPoolCreationBinding,
  createInjectedPoolDiscovery,
  validateSelectedPools,
  type CreateInjectedPoolDiscoveryConfig,
  type MimirBetaCapturePlanAccountLoader,
  type MimirBetaPoolDiscoverySource,
} from "../src/beta/discovery.js";
import { MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, MIMIR_BETA_TOKEN_2022_PROGRAM_ID, deriveMimirBetaPumpSwapBoostVault, mimirBetaCapturePoolCoreLayout, mimirBetaCaptureScanDescriptors, type MimirBetaCapturedAccount } from "../src/beta/capture.js";
import { decodeMimirBetaCaptureCandidate } from "../src/beta/capture.js";
import { explainMimirBetaTokenRefusal } from "../src/beta/errors.js";
import { addressBytes, bytesAddress, canonicalJson } from "../src/beta/bytes.js";
import type { MimirBetaSourceFamily } from "../src/beta/types.js";
import { cloneBetaCaptureFixture, fixtureAddress, makeBetaCaptureFixture, type BetaCaptureFixture } from "./fixtures/betaCaptureFixtures.js";

interface LoaderState {
  contextSlot: bigint;
  calls: number;
  requests: Parameters<MimirBetaCapturePlanAccountLoader["loadCapturePlanAccounts"]>[0][];
  currentRows?: ReadonlyMap<Address, MimirBetaCapturedAccount>;
  clockUnixTimestamp?: bigint;
  transform?: (rows: readonly MimirBetaCapturedAccount[], request: Parameters<MimirBetaCapturePlanAccountLoader["loadCapturePlanAccounts"]>[0]) => readonly MimirBetaCapturedAccount[];
}

function sourceFromFixtures(fixtures: readonly BetaCaptureFixture[], scanCounter?: { count: number }): MimirBetaPoolDiscoverySource {
  const first = fixtures[0]!;
  return {
    layouts: mimirBetaCaptureScanDescriptors().filter((descriptor) => descriptor.family === first.input.descriptor.family)
      .map(mimirBetaCapturePoolCoreLayout),
    loadProgram: async () => ({ executable: true }),
    scan: async () => { if (scanCounter) scanCounter.count += 1; return fixtures.map((fixture) => fixture.poolAccount); },
  };
}

const CLOCK = "SysvarC1ock11111111111111111111111111111111" as Address;
function clockRow(slot: bigint, unixTimestamp: bigint): MimirBetaCapturedAccount {
  const data = new Uint8Array(40); const view = new DataView(data.buffer);
  view.setBigUint64(0, slot, true); view.setBigInt64(32, unixTimestamp, true);
  return { address: CLOCK, owner: "Sysvar1111111111111111111111111111111111111" as Address, executable: false, data };
}

function accountLoader(fixtures: readonly BetaCaptureFixture[], state: LoaderState): MimirBetaCapturePlanAccountLoader["loadCapturePlanAccounts"] {
  const byAddress = new Map<Address, MimirBetaCapturedAccount>();
  for (const row of fixtures.flatMap((fixture) => [...fixture.input.accounts])) {
    const prior = byAddress.get(row.address);
    if (prior) assert.deepEqual([...prior.data], [...row.data]); else byAddress.set(row.address, row);
  }
  return async (request) => {
    state.calls += 1; state.requests.push(request);
    const requested = [...new Set(request.plans.flatMap((plan) => [...plan.addresses]))];
    const rows = requested.flatMap((address) => address === CLOCK ? [clockRow(state.contextSlot, state.clockUnixTimestamp ?? 20n)] :
      [state.currentRows?.get(address) ?? byAddress.get(address) ?? []].flat());
    return { contextSlot: state.contextSlot, accounts: state.transform?.(rows, request) ?? rows };
  };
}

function providerConfig(fixtures: readonly BetaCaptureFixture[], state: LoaderState,
  getContext = async () => ({ slot: 10n, unixTimestamp: 20n }), scanCounters?: readonly { count: number }[]): CreateInjectedPoolDiscoveryConfig {
  return {
    cluster: "mainnet-beta", evidenceTtlSlots: 5n, maxScanResultsPerFamily: 5,
    sources: fixtures.map((fixture, index) => sourceFromFixtures([fixture], scanCounters?.[index])),
    getContext, loadCapturePlanAccounts: accountLoader(fixtures, state),
  };
}

type LoaderInput = Parameters<MimirBetaCapturePlanAccountLoader["loadCapturePlanAccounts"]>[0];
// @ts-expect-error The loader input cannot accept family semantics or offsets.
const forbiddenLoaderInput: LoaderInput = { minContextSlot: 1n, plans: [], family: "orca-whirlpool" };
void forbiddenLoaderInput;
// @ts-expect-error The loader response cannot return a capacity scalar.
const forbiddenLoaderOutput: Awaited<ReturnType<MimirBetaCapturePlanAccountLoader["loadCapturePlanAccounts"]>> = { contextSlot: 1n, accounts: [], depth: 1n };
void forbiddenLoaderOutput;

const families: readonly MimirBetaSourceFamily[] = [
  "orca-whirlpool", "raydium-clmm", "raydium-cpmm", "meteora-dlmm", "meteora-damm-v2",
];
const pairFixture = await makeBetaCaptureFixture("orca-whirlpool");
const { baseMint, quoteMint } = pairFixture.input.pair;
const fixtures = await Promise.all(families.map((family, index) => makeBetaCaptureFixture(family, {
  seed: 20 + index * 29, baseMint, quoteMint,
  ...(family === "raydium-cpmm" ? { baseAmount: 1_000_000_000_000_000n, quoteAmount: 1_000_000_000_000_000n } : {}),
})));
const state: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const scanCounters = fixtures.map(() => ({ count: 0 }));
let currentContext = { slot: 10n, unixTimestamp: 20n };
const provider = createInjectedPoolDiscovery(providerConfig(fixtures, state, async () => currentContext, scanCounters));
const sources = await provider.listPoolSources();
assert.equal(sources.length, 5); assert.deepEqual(new Set(sources.map((source) => source.family)), new Set(families));
const result = await provider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 5 });
assert.equal(state.calls, 1); assert.equal(state.requests[0]!.plans.length, 5);
assert.equal(result.observedSlot, 12n); assert.equal(result.recommendedPools.length, 5);
for (const request of state.requests[0]!.plans) {
  const expected = fixtures.find((fixture) => fixture.input.expectedPlan.planHash === request.planHash)!.input.expectedPlan;
  assert.equal(request.descriptorId, expected.descriptorId); assert.equal(request.descriptorHash, expected.descriptorHash);
  assert.deepEqual(request.addresses, [...expected.allAddresses, CLOCK]); assert.deepEqual(request.nodes, expected.auxiliary);
  assert.deepEqual(Object.keys(request).sort(), ["addresses", "descriptorHash", "descriptorId", "nodes", "planHash"]);
}
for (const pool of result.recommendedPools) {
  assert.equal(pool.baseMint, baseMint); assert.equal(pool.quoteMint, quoteMint); assert.equal(pool.direction, "quote-per-base");
  assert.equal(pool.readPlan.descriptorId, pool.descriptorId); assert.equal(pool.readPlan.planHash.length, 64);
}
validateSelectedPools(result.recommendedPools, 17n);
assert.throws(() => validateSelectedPools(result.recommendedPools, 18n));
for (let index = 1; index < result.recommendedPools.length; index += 1) {
  const left = result.recommendedPools[index - 1]!; const right = result.recommendedPools[index]!;
  assert(left.minDepthTo50BpsNative > right.minDepthTo50BpsNative ||
    (left.minDepthTo50BpsNative === right.minDepthTo50BpsNative && left.minLiquidityNative >= right.minLiquidityNative));
}

const sixFixtures = await Promise.all(Array.from({ length: 6 }, (_, index) => makeBetaCaptureFixture("raydium-clmm", {
  seed: 701 + index, baseMint, quoteMint, curveLiquidity: BigInt(index + 1) * 1_000_000_000_000n,
})));
const sixState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const sixConfig = { ...providerConfig(sixFixtures, sixState), sources: [sourceFromFixtures(sixFixtures)], maxScanResultsPerFamily: 6 };
const sixResult = await createInjectedPoolDiscovery(sixConfig)
  .searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 });
assert.equal(sixState.requests[0]!.plans.length, 6);
assert.deepEqual(new Set(sixResult.pools.map((pool) => pool.pool)), new Set(sixFixtures.map((fixture) => fixture.input.expectedPlan.pool)));
assert.equal(sixResult.recommendedPools.length, 1);
assert.equal(sixResult.recommendedPools[0]!.pool, sixFixtures[5]!.input.expectedPlan.pool);
const sixEligiblePools = sixResult.pools.filter((pool) => pool.eligibility === "eligible");
assert.equal(sixEligiblePools.length, 6);
assert(sixEligiblePools.filter((pool) => pool.pool !== sixResult.recommendedPools[0]!.pool)
  .every((pool) => pool.minDepthTo50BpsNative < sixResult.recommendedPools[0]!.minDepthTo50BpsNative));
const fiveBoundState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const fiveBoundConfig = { ...providerConfig(sixFixtures, fiveBoundState), sources: [sourceFromFixtures(sixFixtures)] };
await assert.rejects(() => createInjectedPoolDiscovery(fiveBoundConfig)
  .searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 }));
assert.equal(fiveBoundState.calls, 0);
assert.throws(() => createInjectedPoolDiscovery({ ...fiveBoundConfig, maxScanResultsPerFamily: Number.MAX_SAFE_INTEGER + 1 }));
assert.throws(() => validateSelectedPools(sixResult.pools, 12n),
  (error) => (error as { code?: string }).code === "POOL_COUNT_OUT_OF_RANGE");

const clmmPolicyBaseFixture = await makeBetaCaptureFixture("raydium-clmm", { seed: 407, baseMint: fixtureAddress(41), quoteMint: fixtureAddress(42) });
function clmmPolicyFixture(baseSelected: boolean, malformedEnvelope: boolean): BetaCaptureFixture {
  const baseFixture = cloneBetaCaptureFixture(clmmPolicyBaseFixture);
  const selectedMint = baseSelected ? baseFixture.input.pair.baseMint : baseFixture.input.pair.quoteMint;
  const selectedVault = baseSelected ? baseFixture.input.expectedPlan.baseVault : baseFixture.input.expectedPlan.quoteVault;
  const accounts = baseFixture.input.accounts.map((row) => {
    if (row.address === selectedMint) {
      if (malformedEnvelope) return { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, executable: true };
      const data = new Uint8Array(170); data.set(row.data); data[165] = 1; new DataView(data.buffer).setUint16(166, 99, true);
      return { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data };
    }
    if (row.address === selectedVault) return { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID };
    return row;
  });
  return { ...baseFixture, input: { ...baseFixture.input, accounts } };
}
const policyState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const policyProvider = createInjectedPoolDiscovery(providerConfig([clmmPolicyFixture(true, false)], policyState));
const policyResult = await policyProvider.searchSpotPools({ baseMint: clmmPolicyBaseFixture.input.pair.baseMint, quoteMint: clmmPolicyBaseFixture.input.pair.quoteMint, query: "", maxPools: 1 });
assert.equal(policyResult.recommendedPools.length, 0);
assert.equal(policyResult.pools.length, 1);
assert.equal(policyResult.pools[0]!.eligibility, "ineligible");
assert.equal((policyResult.pools[0]! as { exclusionCode: string }).exclusionCode, "TOKEN_2022_POLICY_UNSUPPORTED");
const malformedState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const malformedProvider = createInjectedPoolDiscovery(providerConfig([clmmPolicyFixture(true, true)], malformedState));
await assert.rejects(() => malformedProvider.searchSpotPools({ baseMint: clmmPolicyBaseFixture.input.pair.baseMint, quoteMint: clmmPolicyBaseFixture.input.pair.quoteMint, query: "", maxPools: 1 }),
  (error) => (error as { code?: string }).code === "ACCOUNT_MALFORMED");

function scaledMintData(row: BetaCaptureFixture["input"]["accounts"][number]): Uint8Array {
  const data = new Uint8Array(226); data.set(row.data); data[165] = 1;
  const view = new DataView(data.buffer); view.setUint16(166, 25, true); view.setUint16(168, 56, true);
  view.setBigUint64(202, 0x3ff0000000000000n, true); view.setBigInt64(210, 0n, true); view.setBigUint64(218, 0x3ff0000000000000n, true);
  return data;
}
function token2022BaseFixture(fixture: BetaCaptureFixture, scaled = false): BetaCaptureFixture {
  const selectedMint = fixture.input.pair.baseMint;
  const selectedVault = fixture.input.expectedPlan.baseVault;
  return { ...fixture, input: { ...fixture.input, accounts: fixture.input.accounts.map((row) =>
    row.address === selectedMint ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: scaled ? scaledMintData(row) : row.data } :
      row.address === selectedVault ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID } : row) } };
}
const v1BaseMint = fixtureAddress(71); const v1QuoteMint = fixtureAddress(72);
const v1Fixtures = await Promise.all([
  makeBetaCaptureFixture("raydium-clmm", { seed: 451, baseMint: v1BaseMint, quoteMint: v1QuoteMint, curveLiquidity: 2_000_000_000_000n }),
  makeBetaCaptureFixture("raydium-clmm", { seed: 452, baseMint: v1BaseMint, quoteMint: v1QuoteMint, curveLiquidity: 1_000_000_000_000n }),
  makeBetaCaptureFixture("raydium-clmm", { seed: 453, baseMint: v1BaseMint, quoteMint: v1QuoteMint, curveLiquidity: 1_000_000_000_000n }),
]).then((fixtures) => fixtures.map((fixture) => token2022BaseFixture(fixture, true)));
const v1DiscoveryConfig = (cluster: "localnet" | "mainnet-beta", state: LoaderState): CreateInjectedPoolDiscoveryConfig => ({
  cluster, evidenceTtlSlots: 5n, maxScanResultsPerFamily: 5,
  sources: [sourceFromFixtures(v1Fixtures)], getContext: async () => ({ slot: 12n, unixTimestamp: 20n }),
  loadCapturePlanAccounts: accountLoader(v1Fixtures, state),
});
const v1MainnetState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const v1LocalnetState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const v1MainnetProvider = createInjectedPoolDiscovery(v1DiscoveryConfig("mainnet-beta", v1MainnetState));
const v1LocalnetProvider = createInjectedPoolDiscovery(v1DiscoveryConfig("localnet", v1LocalnetState));
const v1Mainnet = await v1MainnetProvider
  .searchSpotPools({ baseMint: v1BaseMint, quoteMint: v1QuoteMint, query: "", maxPools: 3 });
const v1Localnet = await v1LocalnetProvider
  .searchSpotPools({ baseMint: v1BaseMint, quoteMint: v1QuoteMint, query: "", maxPools: 3 });
assert.equal(v1Mainnet.recommendedPools.length, 3);
assert(v1Mainnet.recommendedPools[0]!.minDepthTo50BpsNative > v1Mainnet.recommendedPools[1]!.minDepthTo50BpsNative);
assert.equal(v1Mainnet.recommendedPools[1]!.minDepthTo50BpsNative, v1Mainnet.recommendedPools[2]!.minDepthTo50BpsNative);
assert(Buffer.compare(addressBytes(v1Mainnet.recommendedPools[1]!.pool), addressBytes(v1Mainnet.recommendedPools[2]!.pool)) < 0);
for (const pool of v1Mainnet.recommendedPools) {
  assert.equal(pool.adapterVersion, 1); assert.equal(pool.token2022Mint, v1BaseMint);
  assert.match(pool.token2022PolicyHash!, /^[0-9a-f]{64}$/);
  assert.deepEqual(pool.creation.staticAccounts.map((account) => account.role), ["base-vault", "quote-vault", "pool", "amm-config", "token2022-mint"]);
}
const mixedBaseMint = fixtureAddress(181); const mixedQuoteMint = fixtureAddress(182);
const mixedFixtures = await Promise.all([
  makeBetaCaptureFixture("raydium-clmm", { seed: 461, baseMint: mixedBaseMint, quoteMint: mixedQuoteMint }),
  makeBetaCaptureFixture("orca-whirlpool", { seed: 462, baseMint: mixedBaseMint, quoteMint: mixedQuoteMint }),
]).then((fixtures) => fixtures.map((fixture) => token2022BaseFixture(fixture)));
const mixedState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const mixedResult = await createInjectedPoolDiscovery(providerConfig(mixedFixtures, mixedState, async () => ({ slot: 12n, unixTimestamp: 20n })))
  .searchSpotPools({ baseMint: mixedBaseMint, quoteMint: mixedQuoteMint, query: "", maxPools: 2 });
const mixedRefused = mixedResult.pools.find((pool) => pool.eligibility === "ineligible") as { family: string; exclusionCode: string };
assert.equal(mixedResult.pools.length, 2);
assert.equal(mixedRefused.family, "orca-whirlpool");
assert.equal(mixedRefused.exclusionCode, "TOKEN_PROGRAM_PAIR_UNSUPPORTED");
assert.equal(explainMimirBetaTokenRefusal(mixedRefused.exclusionCode), "This pool's token settings aren't supported for pricing. Choose another pool.");
assert.equal(explainMimirBetaTokenRefusal("ACCOUNT_OWNER_MISMATCH"), null);
assert.equal(mixedResult.recommendedPools.length, 1);
assert.equal(mixedResult.recommendedPools[0]!.family, "raydium-clmm");
assert.equal(mixedResult.recommendedPools[0]!.adapterVersion, 1);
const structuralV1 = (pool: (typeof v1Mainnet.recommendedPools)[number]) => {
  const { evidenceHash: _evidenceHash, observedSlot: _observedSlot, validThroughSlot: _validThroughSlot, ...identity } = pool;
  return identity;
};
assert.deepEqual(structuralV1(v1Mainnet.recommendedPools[0]!), structuralV1(v1Localnet.recommendedPools[0]!));
assert.notEqual(v1Mainnet.recommendedPools[0]!.evidenceHash, v1Localnet.recommendedPools[0]!.evidenceHash);

// Selected-pool revalidation must refresh mutable reserves, reject a stable policy mutation,
// and classify an unsupported policy mutation as the same stale selection failure.
const selectedV1 = v1Mainnet.recommendedPools[0]!;
const resetV1Rows = () => new Map(v1Fixtures.flatMap((fixture) => fixture.input.accounts)
  .map((row) => [row.address, { ...row, data: row.data.slice() }] as const));
const unchangedV1Rows = resetV1Rows(); v1MainnetState.currentRows = unchangedV1Rows;
const unchangedV1 = await v1MainnetProvider.revalidateSelectedPools({ pools: [selectedV1], minContextSlot: 12n });
assert.equal(unchangedV1.freshPools!.length, 1);
const priorV1Fresh = unchangedV1.freshPools![0]!;
const reserveRows = resetV1Rows();
const reserve = reserveRows.get(selectedV1.baseVault)!; const reserveData = reserve.data.slice();
const reserveView = new DataView(reserveData.buffer); reserveView.setBigUint64(64, reserveView.getBigUint64(64, true) + 100n, true);
reserveRows.set(reserve.address, { ...reserve, data: reserveData }); v1MainnetState.currentRows = reserveRows;
const refreshedV1 = await v1MainnetProvider.revalidateSelectedPools({ pools: [selectedV1], minContextSlot: 12n });
assert.equal(refreshedV1.freshPools![0]!.token2022PolicyHash, priorV1Fresh.token2022PolicyHash);
assert.notEqual(refreshedV1.freshPools![0]!.minLiquidityNative, priorV1Fresh.minLiquidityNative);
const policyRows = resetV1Rows();
const policyMint = policyRows.get(selectedV1.token2022Mint!)!; const policyData = policyMint.data.slice();
const policyView = new DataView(policyData.buffer); policyView.setBigUint64(202, 0x4000000000000000n, true);
policyRows.set(policyMint.address, { ...policyMint, data: policyData }); v1MainnetState.currentRows = policyRows;
await assert.rejects(() => v1MainnetProvider.revalidateSelectedPools({ pools: [selectedV1], minContextSlot: 12n }),
  (error) => (error as { code?: string }).code === "POOL_STALE");
const unsupportedRows = resetV1Rows();
const unsupportedMint = unsupportedRows.get(selectedV1.token2022Mint!)!; const unsupportedData = unsupportedMint.data.slice();
unsupportedData[165] = 1; const unsupportedView = new DataView(unsupportedData.buffer);
unsupportedView.setUint16(166, 26, true); unsupportedView.setUint16(168, 33, true); unsupportedData[202] = 1;
unsupportedRows.set(unsupportedMint.address, { ...unsupportedMint, data: unsupportedData }); v1MainnetState.currentRows = unsupportedRows;
await assert.rejects(() => v1MainnetProvider.revalidateSelectedPools({ pools: [selectedV1], minContextSlot: 12n }),
  (error) => (error as { code?: string }).code === "POOL_STALE");
v1MainnetState.currentRows = undefined;

const nativeFixtures = await Promise.all((["raydium-amm-v4", "pumpswap"] as const).map((family, index) =>
  makeBetaCaptureFixture(family, { seed: 181 + index * 31, baseMint, quoteMint,
    baseAmount: 1_000_000_000_000_000n, quoteAmount: 1_000_000_000_000_000n })));
const allFixtures = [...fixtures, ...nativeFixtures]; const allState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const allProvider = createInjectedPoolDiscovery(providerConfig(allFixtures, allState));
const allSources = await allProvider.listPoolSources();
assert.equal(allSources.length, 7);
assert.equal(allSources.find((source) => source.family === "raydium-cpmm")!.adapterType, 2);
assert.equal(allSources.find((source) => source.family === "raydium-amm-v4")!.adapterType, 4);
assert.equal(allSources.find((source) => source.family === "pumpswap")!.adapterType, 6);
const mixed = await allProvider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 5 });
assert.equal(allState.calls, 1); assert.equal(allState.requests[0]!.plans.length, 7); assert.equal(mixed.recommendedPools.length, 5);
assert.deepEqual(new Set(mixed.pools.map((pool) => pool.family)), new Set([...families, "raydium-amm-v4", "pumpswap"]));
const expectedGroups = { "raydium-clmm": 1, "meteora-dlmm": 2, "meteora-damm-v2": 3, "orca-whirlpool": 4,
  "raydium-cpmm": 5, "raydium-amm-v4": 7, pumpswap: 8 } as const;
for (const fixture of allFixtures) {
  const binding = buildMimirBetaPoolCreationBinding(await decodeMimirBetaCaptureCandidate(fixture.input));
  const group = expectedGroups[fixture.input.descriptor.family];
  assert.deepEqual([binding.operatorGroup, binding.oracleSourceClass, binding.upgradeAuthorityGroup], [group, group, group]);
  assert.deepEqual([binding.liquidityOwnerGroup, binding.quoteAssetGroup, binding.bridgeOrWrapperGroup], [0xffff, 1, 0]);
}
const recommendedFamilies = new Set(mixed.recommendedPools.map((pool) => pool.family));
assert(recommendedFamilies.has("raydium-cpmm")); assert(recommendedFamilies.has("raydium-amm-v4")); assert(recommendedFamilies.has("pumpswap"));
const mixedAmm = mixed.pools.find((pool) => pool.family === "raydium-amm-v4")! as import("../src/beta/discovery.js").MimirBetaEligiblePool;
const mixedPump = mixed.pools.find((pool) => pool.family === "pumpswap")! as import("../src/beta/discovery.js").MimirBetaEligiblePool;
assert.deepEqual(mixedAmm.creation.staticAccounts.map((entry) => entry.role),
  ["base-vault", "quote-vault", "pool", "open-orders", "market", "market-program"]);
assert.deepEqual(mixedPump.creation.staticAccounts.map((entry) => entry.role),
  ["base-mint", "quote-mint", "base-vault", "quote-vault", "pool", "global-config", "fee-config"]);
{
  const pumpPool = nativeFixtures[1]!.fixtureAccounts.find((row) => row.fixtureRole === "pool")!;
  const rawQuote = bytesAddress(pumpPool.data.subarray(75, 107));
  const boostVault = deriveMimirBetaPumpSwapBoostVault(mixedPump.pool, rawQuote, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID);
  assert(allState.requests[0]!.plans.some((plan) => plan.addresses.includes(boostVault)), "boost vault rides the batched capture read");
  assert.deepEqual([mixedPump.boostVaultLamports, mixedPump.maxBoostDriftBps], [0n, 0n], "an absent boost vault discloses zero");
  const vaultData = new Uint8Array(165); vaultData.set(addressBytes(rawQuote), 0);
  vaultData.set(PublicKey.findProgramAddressSync([Buffer.from("boost_vault"), addressBytes(mixedPump.pool)],
    new PublicKey(mixedPump.programId))[0].toBytes(), 32);
  vaultData[108] = 1; new DataView(vaultData.buffer).setBigUint64(64, 7n, true);
  allState.currentRows = new Map([[boostVault, { address: boostVault, owner: MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, executable: false, data: vaultData }]]);
  const boosted = await allProvider.revalidateSelectedPools({ pools: [mixedPump], minContextSlot: 10n });
  assert.equal(boosted.freshPools[0]!.boostVaultLamports, 7n);
  assert.equal(typeof boosted.freshPools[0]!.maxBoostDriftBps, "bigint");
  allState.currentRows = undefined;
}

for (const [poolOffset, globalOffset] of [[243, 417], [244, 642]] as const) {
  const modeFixture = cloneBetaCaptureFixture(nativeFixtures[1]!);
  modeFixture.fixtureAccounts.find((row) => row.fixtureRole === "pool")!.data[poolOffset] = 1;
  modeFixture.fixtureAccounts.find((row) => row.fixtureRole === "global-config")!.data[globalOffset] = 0;
  for (const maxPools of [1, 5] as const) {
    const modeState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
    const modeScans = [{ count: 0 }];
    const admitted = await createInjectedPoolDiscovery(providerConfig([modeFixture], modeState, undefined, modeScans))
      .searchSpotPools({ baseMint, quoteMint, query: "", maxPools });
    assert.equal(admitted.recommendedPools.length, 1);
    assert.equal(admitted.recommendedPools[0]!.pool, modeFixture.input.expectedPlan.pool);
    assert.equal(admitted.recommendedPools[0]!.minLiquidityNative, mixedPump.minLiquidityNative);
    assert.equal(admitted.recommendedPools[0]!.minDepthTo50BpsNative, mixedPump.minDepthTo50BpsNative);
    assert.deepEqual([modeState.calls, modeScans[0]!.count], [1, 1]);
  }
}

// An unchanged frozen closure revalidates in one capture, re-derived from its own primary, without scanning.
currentContext = { slot: 13n, unixTimestamp: 22n }; state.contextSlot = 14n;
const scansBefore = scanCounters.map((counter) => counter.count); const callsBefore = state.calls;
const revalidated = await provider.revalidateSelectedPools({ pools: result.recommendedPools, minContextSlot: 13n });
assert.equal(revalidated.slot, 14n); assert.equal(state.calls, callsBefore + 1);
assert.deepEqual(scanCounters.map((counter) => counter.count), scansBefore);
assert.deepEqual(state.requests.at(-1)!.plans.map((plan) => plan.addresses), result.recommendedPools.map((pool) => [...pool.readPlan.allAddresses, CLOCK]));
assert.deepEqual(revalidated.freshPools!.map((pool) => pool.readPlan.context.observedSlot), revalidated.freshPools!.map(() => 14n));
assert.deepEqual(revalidated.pools, result.recommendedPools);
assert.deepEqual(revalidated.freshPools!.map((pool) => pool.pool), result.recommendedPools.map((pool) => pool.pool));

const movedFixtures = await Promise.all([
  makeBetaCaptureFixture("orca-whirlpool", { seed: 20, baseMint, quoteMint, tickSpacing: 2 }),
  makeBetaCaptureFixture("raydium-clmm", { seed: 49, baseMint, quoteMint, tickSpacing: 2 }),
  makeBetaCaptureFixture("meteora-dlmm", { seed: 107, baseMint, quoteMint, activeId: 6 }),
]);
const movedActiveBin = movedFixtures[2]!.fixtureAccounts.find((row) => row.fixtureRole === "depth-bin-array" && row.fixtureIndex === 0)!;
movedActiveBin.data.fill(0, 56 + 6 * 144 + 16, 56 + 6 * 144 + 32);
state.currentRows = new Map(movedFixtures.flatMap((fixture) => fixture.input.accounts).map((row) => [row.address, row]));
const moved = await provider.revalidateSelectedPools({ pools: result.recommendedPools, minContextSlot: 13n });
for (const family of ["orca-whirlpool", "raydium-clmm", "meteora-dlmm"] as const) {
  const frozen = moved.pools.find((pool) => pool.family === family)!;
  const fresh = moved.freshPools!.find((pool) => pool.family === family)!;
  assert.notEqual(fresh.readPlan.planHash, frozen.readPlan.planHash);
  assert.equal(fresh.pool, frozen.pool);
}
assert.deepEqual(moved.freshPools!.map((pool) => pool.pool), moved.pools.map((pool) => pool.pool));
state.currentRows = undefined;

const selected = result.recommendedPools.find((pool) => pool.family === "orca-whirlpool")!;
const selectedFixture = fixtures.find((fixture) => fixture.input.expectedPlan.pool === selected.pool)!;
const highConfidenceFixture = await makeBetaCaptureFixture("meteora-dlmm", { seed: 881, baseMint, quoteMint, binStep: 400 });
const highConfidenceState: LoaderState = { contextSlot: 14n, calls: 0, requests: [] };
const highConfidenceProvider = createInjectedPoolDiscovery(providerConfig([highConfidenceFixture], highConfidenceState,
  async () => ({ slot: 13n, unixTimestamp: 22n })));
const highConfidenceSelected = (await highConfidenceProvider.searchSpotPools({
  ...highConfidenceFixture.input.pair, query: "", maxPools: 1,
})).recommendedPools[0]!;
assert.equal(highConfidenceSelected.pool, highConfidenceFixture.input.expectedPlan.pool);
await assert.rejects(() => highConfidenceProvider.revalidateSelectedPools({
  pools: [highConfidenceSelected], minContextSlot: 13n, maxConfidenceBps: 100,
}), (error) => {
  assert.equal((error as { code?: string }).code, "POOL_INELIGIBLE");
  assert.equal((error as { address?: string }).address, highConfidenceSelected.pool);
  assert.match((error as { message?: string }).message!, /400 bps.*100 bps/);
  return true;
});
const callsAfterConfidenceRejection = highConfidenceState.calls;
for (const maxConfidenceBps of [0, 10_000, 1.5, "100"] as const) {
  await assert.rejects(() => highConfidenceProvider.revalidateSelectedPools({
    pools: [highConfidenceSelected], minContextSlot: 13n, maxConfidenceBps,
  } as never), (error) => (error as { code?: string }).code === "INVALID_ARGUMENT");
}
let confidenceGetterCalls = 0;
const accessorConfidenceArgs = Object.defineProperty({ pools: [highConfidenceSelected], minContextSlot: 13n }, "maxConfidenceBps", {
  enumerable: true, get: () => { confidenceGetterCalls += 1; return 100; },
});
await assert.rejects(() => highConfidenceProvider.revalidateSelectedPools(accessorConfidenceArgs as never),
  (error) => (error as { code?: string }).code === "INVALID_ARGUMENT");
assert.equal(confidenceGetterCalls, 0);
assert.equal(highConfidenceState.calls, callsAfterConfidenceRejection);

const equalConfidenceFixture = await makeBetaCaptureFixture("meteora-dlmm", { seed: 882, baseMint, quoteMint, binStep: 100 });
const mixedConfidenceState: LoaderState = { contextSlot: 14n, calls: 0, requests: [] };
let mixedContextCalls = 0;
const mixedScanCalls = { count: 0 };
const mixedConfidenceConfig = {
  ...providerConfig([highConfidenceFixture, equalConfidenceFixture], mixedConfidenceState, async () => {
    mixedContextCalls += 1; return { slot: 13n, unixTimestamp: 22n };
  }, [mixedScanCalls]),
  sources: [sourceFromFixtures([highConfidenceFixture, equalConfidenceFixture], mixedScanCalls)],
  maxConfidenceBps: 100,
};
const mixedConfidenceResult = await createInjectedPoolDiscovery(mixedConfidenceConfig as never).searchSpotPools({
  ...equalConfidenceFixture.input.pair, query: "", maxPools: 1,
});
assert.deepEqual(mixedConfidenceResult.recommendedPools.map((pool) => pool.pool), [equalConfidenceFixture.input.expectedPlan.pool]);
const confidenceExcluded = mixedConfidenceResult.pools.find((pool) => pool.pool === highConfidenceFixture.input.expectedPlan.pool)!;
assert.equal(confidenceExcluded.eligibility, "ineligible");
assert.equal((confidenceExcluded as { exclusionCode: string }).exclusionCode, "CONFIDENCE_EXCEEDS_POLICY");

let invalidConfidenceContextCalls = 0;
const invalidConfidenceState: LoaderState = { contextSlot: 14n, calls: 0, requests: [] };
const invalidConfidenceScanCalls = { count: 0 };
const invalidConfidenceBase = {
  ...providerConfig([equalConfidenceFixture], invalidConfidenceState, async () => {
    invalidConfidenceContextCalls += 1; return { slot: 13n, unixTimestamp: 22n };
  }, [invalidConfidenceScanCalls]),
};
for (const maxConfidenceBps of [undefined, "100", 1.5, 0, 10_000]) {
  assert.throws(() => createInjectedPoolDiscovery({ ...invalidConfidenceBase, maxConfidenceBps } as never),
    (error) => (error as { code?: string }).code === "INVALID_ARGUMENT");
}
let discoveryConfidenceGetterCalls = 0;
const accessorConfidenceConfig = { ...invalidConfidenceBase };
Object.defineProperty(accessorConfidenceConfig, "maxConfidenceBps", { enumerable: true, get: () => {
  discoveryConfidenceGetterCalls += 1; return 100;
} });
assert.throws(() => createInjectedPoolDiscovery(accessorConfidenceConfig as never),
  (error) => (error as { code?: string }).code === "INVALID_ARGUMENT");
assert.equal(discoveryConfidenceGetterCalls, 0);
assert.equal(invalidConfidenceContextCalls, 0);
assert.equal(invalidConfidenceScanCalls.count, 0);
assert.equal(invalidConfidenceState.calls, 0);

const searchNonDlmmConfidenceState: LoaderState = { contextSlot: 14n, calls: 0, requests: [] };
const searchNonDlmmConfidenceResult = await createInjectedPoolDiscovery({
  ...providerConfig([selectedFixture], searchNonDlmmConfidenceState), maxConfidenceBps: 1,
} as never).searchSpotPools({ ...selectedFixture.input.pair, query: "", maxPools: 1 });
assert.deepEqual(searchNonDlmmConfidenceResult.recommendedPools.map((pool) => pool.pool), [selectedFixture.input.expectedPlan.pool]);

const equalConfidenceState: LoaderState = { contextSlot: 14n, calls: 0, requests: [] };
const equalConfidenceProvider = createInjectedPoolDiscovery(providerConfig([equalConfidenceFixture], equalConfidenceState,
  async () => ({ slot: 13n, unixTimestamp: 22n })));
const equalConfidenceSelected = (await equalConfidenceProvider.searchSpotPools({
  ...equalConfidenceFixture.input.pair, query: "", maxPools: 1,
})).recommendedPools[0]!;
const equalConfidenceFresh = await equalConfidenceProvider.revalidateSelectedPools({
  pools: [equalConfidenceSelected], minContextSlot: 13n, maxConfidenceBps: 100,
});
assert.equal(equalConfidenceFresh.freshPools[0]!.pool, equalConfidenceSelected.pool);

const nonDlmmConfidenceState: LoaderState = { contextSlot: 14n, calls: 0, requests: [] };
const nonDlmmConfidenceProvider = createInjectedPoolDiscovery(providerConfig([selectedFixture], nonDlmmConfidenceState,
  async () => ({ slot: 13n, unixTimestamp: 22n })));
const nonDlmmConfidenceFresh = await nonDlmmConfidenceProvider.revalidateSelectedPools(canonicalJson({
  pools: [selected], minContextSlot: 13n, maxConfidenceBps: 1,
} as never));
assert.equal(nonDlmmConfidenceFresh.freshPools[0]!.pool, selected.pool);

state.transform = (rows) => rows.map((row) => {
  if (row.address !== selected.pool) return row;
  const data = row.data.slice(); data.set(addressBytes(fixtureAddress(248)), 8); return { ...row, data };
});
const driftCalls = state.calls;
await assert.rejects(() => provider.revalidateSelectedPools({ pools: [selected], minContextSlot: 13n }),
  (error) => (error as { code?: string }).code === "POOL_INELIGIBLE");
assert.equal(state.calls, driftCalls + 1);
state.transform = undefined;

const cpmmPool = result.recommendedPools.find((pool) => pool.family === "raydium-cpmm")!;
const stableDrift = { ...cpmmPool, creation: { ...cpmmPool.creation, operatorGroup: cpmmPool.creation.operatorGroup + 1 } };
await assert.rejects(() => provider.revalidateSelectedPools({ pools: [stableDrift], minContextSlot: 13n }),
  (error) => (error as { code?: string }).code === "POOL_STALE");

let phase = 0;
state.transform = (rows, request) => {
  phase += 1;
  if (phase === 2) return rows;
  return rows.map((row) => {
    if (row.address !== selected.pool) return row;
    const data = row.data.slice(); new DataView(data.buffer).setInt32(81, 88, true); return { ...row, data };
  });
};
await assert.rejects(() => provider.revalidateSelectedPools({ pools: [selected], minContextSlot: 13n }),
  (error) => (error as { code?: string }).code === "CAPTURE_PLAN_MISMATCH");
assert.equal(phase, 3, "a moved frozen closure falls back to primary-first revalidation, which still refuses in-context drift");
state.transform = undefined;

async function rejectsLoaderTransform(transform: LoaderState["transform"], code: string): Promise<void> {
  const localState: LoaderState = { contextSlot: 12n, calls: 0, requests: [], transform };
  const local = createInjectedPoolDiscovery(providerConfig([selectedFixture], localState));
  await assert.rejects(() => local.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 }),
    (error) => (error as { code?: string }).code === code);
  assert.equal(localState.calls, 1);
}
await rejectsLoaderTransform((rows) => rows.slice(1), "CAPTURE_PLAN_MISMATCH");
await rejectsLoaderTransform((rows) => [...rows, rows[0]!], "CAPTURE_PLAN_MISMATCH");
await rejectsLoaderTransform((rows) => [...rows, { ...rows[0]!, address: fixtureAddress(247) }], "CAPTURE_PLAN_MISMATCH");
await rejectsLoaderTransform((rows) => rows.map((row, index) => index === 0 ? ({ ...row, data: null } as never) : row), "CAPTURE_PLAN_MISMATCH");

const regressedState: LoaderState = { contextSlot: 9n, calls: 0, requests: [] };
const regressed = createInjectedPoolDiscovery(providerConfig([selectedFixture], regressedState));
await assert.rejects(() => regressed.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 }),
  (error) => (error as { code?: string }).code === "RPC_CONTEXT_MISMATCH");

// Shuffled rows are address-keyed and deterministic.
const shuffledState: LoaderState = { contextSlot: 12n, calls: 0, requests: [], transform: (rows) => [...rows].reverse() };
const shuffled = await createInjectedPoolDiscovery(providerConfig(fixtures, shuffledState))
  .searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 5 });
assert.equal(shuffled.searchHash, result.searchHash);

// Only the exact mainnet CPMM allocation remains; incomplete or altered source layout sets fail at construction.
const cpmm637 = await makeBetaCaptureFixture("raydium-cpmm", { seed: 241, baseMint, quoteMint, cpmmAllocation: 637 });
assert.equal(sourceFromFixtures([cpmm637]).layouts.length, 1);
assert.doesNotThrow(() => createInjectedPoolDiscovery({ ...providerConfig([cpmm637], { contextSlot: 12n, calls: 0, requests: [] }),
  sources: [{ ...sourceFromFixtures([cpmm637]), layouts: [cpmm637.layout] }] }));
assert.throws(() => createInjectedPoolDiscovery({ ...providerConfig([cpmm637], { contextSlot: 12n, calls: 0, requests: [] }),
  sources: [{ ...sourceFromFixtures([cpmm637]), layouts: [{ ...cpmm637.layout, accountSize: 741 }] }] }));
assert.throws(() => createInjectedPoolDiscovery({ ...providerConfig([selectedFixture], { contextSlot: 12n, calls: 0, requests: [] }),
  sources: [{ ...sourceFromFixtures([selectedFixture]), layouts: [{ ...selectedFixture.layout, mintAOffset: 1 }] }] }));

// Mutations made before loader resolution are admitted and fail ordinary validation.
const immutableFixture = cloneBetaCaptureFixture(selectedFixture);
let releasePreResolution!: () => void; let markPreResolutionStarted!: () => void;
let preResolutionLoaderCalls = 0; let preResolutionScanCalls = 0;
const preResolutionGate = new Promise<void>((resolve) => { releasePreResolution = resolve; });
const preResolutionStarted = new Promise<void>((resolve) => { markPreResolutionStarted = resolve; });
const preResolutionRows = immutableFixture.input.accounts.map((row) => ({ ...row, data: row.data.slice() }));
const preResolutionBase = sourceFromFixtures([immutableFixture]);
const preResolutionProvider = createInjectedPoolDiscovery({ ...providerConfig([immutableFixture], { contextSlot: 12n, calls: 0, requests: [] }),
  sources: [{ ...preResolutionBase, scan: async (args) => { preResolutionScanCalls += 1; return preResolutionBase.scan(args); } }],
  loadCapturePlanAccounts: async () => {
    preResolutionLoaderCalls += 1; markPreResolutionStarted(); await preResolutionGate;
    return { contextSlot: 12n, accounts: preResolutionRows };
  },
});
const preResolutionPending = preResolutionProvider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 });
await preResolutionStarted;
Object.defineProperty(preResolutionRows[0]!.data, "hidden", { value: 1 });
releasePreResolution();
await assert.rejects(() => preResolutionPending, (error) => (error as { code?: string }).code === "INVALID_ARGUMENT");
assert.deepEqual([preResolutionLoaderCalls, preResolutionScanCalls], [1, 1]);

// Cross-identity row substitution is never accepted, even when the address set is unchanged.
let swappedLoaderCalls = 0;
const swappedRows = immutableFixture.input.accounts.map((row) => ({ ...row, data: row.data.slice() }));
const firstAddress = swappedRows[0]!.address; swappedRows[0]!.address = swappedRows[1]!.address; swappedRows[1]!.address = firstAddress;
const swappedBase = sourceFromFixtures([immutableFixture]);
const swappedProvider = createInjectedPoolDiscovery({ ...providerConfig([immutableFixture], { contextSlot: 12n, calls: 0, requests: [] }),
  sources: [swappedBase],
  loadCapturePlanAccounts: async () => { swappedLoaderCalls += 1; return { contextSlot: 12n, accounts: swappedRows }; },
});
await assert.rejects(() => swappedProvider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 }));
assert.equal(swappedLoaderCalls, 1);

// Construction captures exact values and methods onto frozen internal receivers.
const capturedFixture = cloneBetaCaptureFixture(selectedFixture);
const capturedLayouts = [...sourceFromFixtures([capturedFixture]).layouts as Exclude<MimirBetaPoolDiscoverySource["layouts"], string>];
let capturedContextCalls = 0; let capturedLoaderCalls = 0; let capturedScanCalls = 0;
const capturedLoaderState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const capturedLoader = accountLoader([capturedFixture], capturedLoaderState);
const mutableSource: MimirBetaPoolDiscoverySource = {
  layouts: capturedLayouts,
  async loadProgram() { assert(Object.isFrozen(this)); assert.notEqual(this, mutableSource); return { executable: true }; },
  async scan() { assert(Object.isFrozen(this)); assert.notEqual(this, mutableSource); capturedScanCalls += 1; return [capturedFixture.poolAccount]; },
};
const mutableConfig: CreateInjectedPoolDiscoveryConfig = {
  cluster: "mainnet-beta", evidenceTtlSlots: 5n, maxScanResultsPerFamily: 5, sources: [mutableSource],
  async getContext() { assert(Object.isFrozen(this)); assert.notEqual(this, mutableConfig); capturedContextCalls += 1; return { slot: 10n, unixTimestamp: 20n }; },
  async loadCapturePlanAccounts(request) {
    assert(Object.isFrozen(this)); assert.notEqual(this, mutableConfig); capturedLoaderCalls += 1; return capturedLoader(request);
  },
};
const capturedProvider = createInjectedPoolDiscovery(mutableConfig);
(capturedLayouts as { [index: number]: (typeof capturedLayouts)[number] })[0] = { ...capturedLayouts[0]!, accountSize: 1 };
Object.assign(mutableSource, { loadProgram: async () => assert.fail("mutated loadProgram called"),
  scan: async () => assert.fail("mutated scan called") });
Object.assign(mutableConfig, { cluster: "localnet", evidenceTtlSlots: 999n, maxScanResultsPerFamily: 1, sources: [],
  getContext: async () => assert.fail("mutated getContext called"), loadCapturePlanAccounts: async () => assert.fail("mutated loader called") });
const capturedResult = await capturedProvider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 });
assert.equal(capturedResult.recommendedPools[0]!.validThroughSlot, 17n);
assert.deepEqual([capturedContextCalls, capturedLoaderCalls, capturedScanCalls], [1, 1, 1]);

// Search arguments are canonical snapshots before getContext yields.
let releaseSearchContext!: () => void;
const searchContextGate = new Promise<void>((resolve) => { releaseSearchContext = resolve; });
const searchArgState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const searchArgProvider = createInjectedPoolDiscovery(providerConfig([selectedFixture], searchArgState, async () => {
  await searchContextGate; return { slot: 10n, unixTimestamp: 20n };
}));
const mutableSearchArgs = { baseMint, quoteMint, query: "", maxPools: 1 as const };
const pendingSearch = searchArgProvider.searchSpotPools(mutableSearchArgs);
Object.assign(mutableSearchArgs, { baseMint: fixtureAddress(244), quoteMint: fixtureAddress(245), query: "changed", maxPools: 5 });
releaseSearchContext();
const snapshottedSearch = await pendingSearch;
assert.deepEqual({ baseMint: snapshottedSearch.baseMint, quoteMint: snapshottedSearch.quoteMint, query: snapshottedSearch.query,
  maxPools: snapshottedSearch.maxPools }, { baseMint, quoteMint, query: "", maxPools: 1 });
assert.equal(searchArgState.calls, 1);
assert.deepEqual(snapshottedSearch.recommendedPools.map((pool) => pool.readPlan.planHash), [selected.readPlan.planHash]);
const stableSearch = await searchArgProvider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 });
assert.equal(stableSearch.searchHash, snapshottedSearch.searchHash);
assert.equal(searchArgState.calls, 2);

// Revalidation returns a strict deep snapshot and ignores every post-entry mutation.
let releaseRevalidationContext!: () => void;
const revalidationContextGate = new Promise<void>((resolve) => { releaseRevalidationContext = resolve; });
const revalidationArgState: LoaderState = { contextSlot: 14n, calls: 0, requests: [] };
const revalidationArgProvider = createInjectedPoolDiscovery(providerConfig([selectedFixture], revalidationArgState, async () => {
  await revalidationContextGate; return { slot: 13n, unixTimestamp: 22n };
}));
const mutablePrior = { ...selected,
  readPlan: { ...selected.readPlan, context: { ...selected.readPlan.context }, allAddresses: [...selected.readPlan.allAddresses],
    auxiliary: selected.readPlan.auxiliary.map((node) => ({ ...node, derivedFrom: [...node.derivedFrom] })) },
  creation: { ...selected.creation, staticAccounts: selected.creation.staticAccounts.map((account) => ({ ...account })) },
};
const mutableRevalidationArgs = { pools: [mutablePrior], minContextSlot: 13n };
const pendingRevalidation = revalidationArgProvider.revalidateSelectedPools(mutableRevalidationArgs);
mutableRevalidationArgs.minContextSlot = 99n; mutablePrior.pool = fixtureAddress(243);
mutablePrior.readPlan.allAddresses[0] = fixtureAddress(242); mutablePrior.readPlan.auxiliary[0]!.derivedFrom[0] = fixtureAddress(241);
mutablePrior.creation.staticAccounts[0]!.address = fixtureAddress(240);
releaseRevalidationContext();
const snapshottedRevalidation = await pendingRevalidation;
assert.notEqual(snapshottedRevalidation.pools[0], mutablePrior);
assert.equal(snapshottedRevalidation.pools[0]!.pool, selected.pool);
assert.equal(snapshottedRevalidation.pools[0]!.readPlan.allAddresses[0], selected.readPlan.allAddresses[0]);
assert.equal(revalidationArgState.calls, 1);

// Accessors, cycles, sparse/exotic arrays, and non-byte account data fail closed before injected calls.
let hostileContextCalls = 0;
const hostileState: LoaderState = { contextSlot: 14n, calls: 0, requests: [] };
const hostileProvider = createInjectedPoolDiscovery(providerConfig([selectedFixture], hostileState, async () => {
  hostileContextCalls += 1; return { slot: 13n, unixTimestamp: 22n };
}));
const accessorArgs = Object.defineProperty({ minContextSlot: 13n }, "pools", { enumerable: true, get: () => [selected] });
await assert.rejects(() => hostileProvider.revalidateSelectedPools(accessorArgs as never));
const cyclicPool = { ...selected } as Record<string, unknown>; cyclicPool.self = cyclicPool;
await assert.rejects(() => hostileProvider.revalidateSelectedPools({ pools: [cyclicPool] as never, minContextSlot: 13n }));
const sparsePools = new Array(1) as never[];
await assert.rejects(() => hostileProvider.revalidateSelectedPools({ pools: sparsePools, minContextSlot: 13n }));
const exoticPools = [selected]; Object.setPrototypeOf(exoticPools, {});
await assert.rejects(() => hostileProvider.revalidateSelectedPools({ pools: exoticPools, minContextSlot: 13n }));
assert.equal(hostileContextCalls, 0); assert.equal(hostileState.calls, 0);

assert.throws(() => createInjectedPoolDiscovery(Object.defineProperty({ ...providerConfig([selectedFixture], hostileState) }, "sources",
  { enumerable: true, get: () => [sourceFromFixtures([selectedFixture])] }) as never));

// Transparent Proxies are rejected graph-wide before the following injected operation or publication.
function proxyBoundaryProvider(overrides: Partial<CreateInjectedPoolDiscoveryConfig> = {}): Readonly<{
  provider: ReturnType<typeof createInjectedPoolDiscovery>;
  counts: { scan: number; load: number; context: number };
}> {
  const counts = { scan: 0, load: 0, context: 0 };
  const base = sourceFromFixtures([selectedFixture]);
  const loaderState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
  const loader = accountLoader([selectedFixture], loaderState);
  const source: MimirBetaPoolDiscoverySource = { ...base,
    scan: async (args) => { counts.scan += 1; return base.scan(args); },
  };
  const config: CreateInjectedPoolDiscoveryConfig = {
    ...providerConfig([selectedFixture], loaderState), sources: [source],
    getContext: async () => { counts.context += 1; return { slot: 10n, unixTimestamp: 20n }; },
    loadCapturePlanAccounts: async (args) => { counts.load += 1; return loader(args); },
    ...overrides,
  };
  return Object.freeze({ provider: createInjectedPoolDiscovery(config), counts });
}

let proxiedContextCalls = 0;
const contextProxyBoundary = proxyBoundaryProvider({
  getContext: async () => { proxiedContextCalls += 1; return new Proxy({ slot: 10n, unixTimestamp: 20n }, {}); },
});
await assert.rejects(() => contextProxyBoundary.provider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 }));
assert.deepEqual(contextProxyBoundary.counts, { scan: 0, load: 0, context: 0 });
assert.equal(proxiedContextCalls, 1);

const scanProxyBoundary = proxyBoundaryProvider();
const scanProxySource = sourceFromFixtures([selectedFixture]);
const scanProxyProvider = createInjectedPoolDiscovery({
  ...providerConfig([selectedFixture], { contextSlot: 12n, calls: 0, requests: [] }),
  sources: [{ ...scanProxySource,
    scan: async () => { scanProxyBoundary.counts.scan += 1; return [new Proxy(selectedFixture.poolAccount, {})]; },
  }],
  loadCapturePlanAccounts: async () => { scanProxyBoundary.counts.load += 1; return assert.fail("loader called after proxied scan row"); },
});
await assert.rejects(() => scanProxyProvider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 }));
assert.deepEqual({ scan: scanProxyBoundary.counts.scan, load: scanProxyBoundary.counts.load }, { scan: 1, load: 0 });

const capacityProxyBoundary = proxyBoundaryProvider({
  loadCapturePlanAccounts: async () => {
    capacityProxyBoundary.counts.load += 1;
    return { contextSlot: 12n, accounts: selectedFixture.input.accounts.map((row, index) =>
      index === 0 ? { ...row, data: new Proxy(row.data, {}) as never } : row) };
  },
});
await assert.rejects(() => capacityProxyBoundary.provider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 }));
assert.deepEqual({ scan: capacityProxyBoundary.counts.scan, load: capacityProxyBoundary.counts.load }, { scan: 1, load: 1 });

let selfDetachingLoads = 0; let selfDetachingTraps = 0; let selfDetachingPublishedPools = 0;
const selfDetachingBase = sourceFromFixtures([selectedFixture]);
const selfDetachingLoaderState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const selfDetachingLoader = accountLoader([selectedFixture], selfDetachingLoaderState);
const selfDetachingProvider = createInjectedPoolDiscovery({ ...providerConfig([selectedFixture], selfDetachingLoaderState),
  sources: [selfDetachingBase],
  loadCapturePlanAccounts: async (args) => {
    selfDetachingLoads += 1;
    const response = await selfDetachingLoader(args) as Exclude<Awaited<ReturnType<typeof selfDetachingLoader>>, string>;
    const accounts = [...response.accounts]; const target = accounts[0]!;
    accounts[0] = new Proxy(target, { getPrototypeOf(value) {
      selfDetachingTraps += 1; accounts[0] = value; return Reflect.getPrototypeOf(value);
    } });
    return { ...response, accounts };
  },
});
await assert.rejects(async () => {
  const selfDetachingResult = await selfDetachingProvider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 });
  selfDetachingPublishedPools = selfDetachingResult.recommendedPools.length;
});
assert.deepEqual({ traps: selfDetachingTraps, load: selfDetachingLoads,
  publishedPools: selfDetachingPublishedPools }, { traps: 1, load: 1, publishedPools: 0 });

let programProxyScans = 0;
const programProxySource = sourceFromFixtures([selectedFixture]);
const programProxyProvider = createInjectedPoolDiscovery({
  ...providerConfig([selectedFixture], { contextSlot: 12n, calls: 0, requests: [] }),
  sources: [{ ...programProxySource, loadProgram: async () => new Proxy({ executable: true }, {}),
    scan: async (args) => { programProxyScans += 1; return programProxySource.scan(args); } }],
});
await assert.rejects(() => programProxyProvider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 }));
assert.equal(programProxyScans, 0);

const callerProxyBoundary = proxyBoundaryProvider();
await assert.rejects(() => callerProxyBoundary.provider.searchSpotPools(new Proxy(
  { baseMint, quoteMint, query: "", maxPools: 1 as const }, {})
));
await assert.rejects(() => callerProxyBoundary.provider.revalidateSelectedPools({
  pools: [new Proxy(selected, {})], minContextSlot: 13n,
}));
assert.equal(callerProxyBoundary.counts.context, 0);

let accessorInvocations = 0;
const accessorBoundary = proxyBoundaryProvider();
const accessorSearchArgs = Object.defineProperty({ baseMint, quoteMint, maxPools: 1 }, "query", {
  enumerable: true, get: () => { accessorInvocations += 1; return ""; },
});
await assert.rejects(() => accessorBoundary.provider.searchSpotPools(accessorSearchArgs as never));
assert.equal(accessorInvocations, 0); assert.equal(accessorBoundary.counts.context, 0);

const boundedBoundary = proxyBoundaryProvider();
await assert.rejects(() => boundedBoundary.provider.searchSpotPools({
  baseMint, quoteMint, query: "", maxPools: 1, extraneous: new Array(10_000).fill(selected),
} as never));
await assert.rejects(() => boundedBoundary.provider.revalidateSelectedPools({
  pools: new Array(6).fill(selected), minContextSlot: 13n,
}), (error) => (error as { code?: string }).code === "POOL_COUNT_OUT_OF_RANGE");
assert.deepEqual(boundedBoundary.counts, { scan: 0, load: 0, context: 0 });

const maximumFixtures = await Promise.all(Array.from({ length: 5 }, (_, index) =>
  makeBetaCaptureFixture("raydium-clmm", { seed: 301 + index, baseMint, quoteMint,
    curveLiquidity: BigInt(index + 1) * 1_000_000_000_000n }))).then((fixtures) =>
  fixtures.map((fixture) => token2022BaseFixture(fixture, true)));
const maximumState: LoaderState = { contextSlot: 14n, calls: 0, requests: [] };
let maximumContextCalls = 0;
const maximumProvider = createInjectedPoolDiscovery({
  ...providerConfig(maximumFixtures, maximumState, async () => {
    maximumContextCalls += 1; return { slot: 13n, unixTimestamp: 22n };
  }),
  sources: [sourceFromFixtures(maximumFixtures)],
});
const maximumResult = await maximumProvider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 5 });
assert.equal(maximumResult.recommendedPools.length + maximumResult.recommendedPools.reduce((total, pool) => total +
  pool.readPlan.auxiliary.length + pool.readPlan.auxiliary.reduce((sum, node) => sum + node.derivedFrom.length, 0) +
  pool.readPlan.allAddresses.length + pool.creation.staticAccounts.length, 0), 170);
const maximumCallsBefore = [maximumContextCalls, maximumState.calls];
const maximumObjectFresh = await maximumProvider.revalidateSelectedPools({ pools: maximumResult.recommendedPools, minContextSlot: 13n });
assert.deepEqual([maximumContextCalls, maximumState.calls], [maximumCallsBefore[0]! + 1, maximumCallsBefore[1]! + 1]);
const maximumCallsAfterObject = [maximumContextCalls, maximumState.calls];
const maximumSerializedFresh = await maximumProvider.revalidateSelectedPools(canonicalJson({
  pools: maximumResult.recommendedPools, minContextSlot: 13n,
} as never));
assert.deepEqual(maximumSerializedFresh, maximumObjectFresh);
assert.deepEqual([maximumContextCalls, maximumState.calls], [maximumCallsAfterObject[0]! + 1, maximumCallsAfterObject[1]! + 1]);

const overBoundPools = maximumResult.recommendedPools.map((pool, poolIndex) => poolIndex === 0 ? ({ ...pool,
  readPlan: { ...pool.readPlan, auxiliary: pool.readPlan.auxiliary.map((node, nodeIndex) => nodeIndex === 0 ? ({ ...node,
    derivedFrom: [...node.derivedFrom, node.address],
  }) : node) },
}) : pool);
const overBoundCallsBefore = [maximumContextCalls, maximumState.calls];
await assert.rejects(() => maximumProvider.revalidateSelectedPools({ pools: overBoundPools, minContextSlot: 13n }),
  (error) => (error as { code?: string; message?: string }).code === "INVALID_ARGUMENT" &&
    (error as { message?: string }).message === "INVALID_ARGUMENT:pool revalidation arguments exceeds its array bounds");
assert.deepEqual([maximumContextCalls, maximumState.calls], overBoundCallsBefore);

Object.freeze(selected);
const frozenRevalidation = await provider.revalidateSelectedPools(Object.freeze({
  pools: Object.freeze([selected]), minContextSlot: 13n,
}));
assert.equal(frozenRevalidation.pools[0]!.pool, selected.pool);

// Every injected data boundary also admits canonicalJson's fixed decimal-string/base64 representation.
const serializedCounts = { context: 0, program: 0, scan: 0, capture: 0 };
const serializedLoaderState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const serializedLoader = accountLoader([selectedFixture], serializedLoaderState);
let serializedContextSlot = 10n;
const serializedLayouts = mimirBetaCaptureScanDescriptors().filter((descriptor) => descriptor.family === selected.family)
  .map(mimirBetaCapturePoolCoreLayout).map((layout) => Object.fromEntries(Object.entries(layout).filter(([, value]) => value !== undefined)));
const serializedProvider = createInjectedPoolDiscovery({
  cluster: "mainnet-beta", evidenceTtlSlots: 5n, maxScanResultsPerFamily: 1,
  sources: [{ layouts: canonicalJson(serializedLayouts as never),
    loadProgram: async () => { serializedCounts.program += 1; return canonicalJson({ executable: true }); },
    scan: async () => { serializedCounts.scan += 1; return canonicalJson([selectedFixture.poolAccount] as never); },
  }],
  getContext: async () => { serializedCounts.context += 1; return canonicalJson({ slot: serializedContextSlot, unixTimestamp: 20n }); },
  loadCapturePlanAccounts: async (request) => { serializedCounts.capture += 1;
    return canonicalJson(await serializedLoader(request) as never); },
});
const objectSingleState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const objectSingle = createInjectedPoolDiscovery(providerConfig([selectedFixture], objectSingleState,
  async () => ({ slot: serializedContextSlot, unixTimestamp: 20n })));
const objectSingleResult = await objectSingle.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 });
const serializedResult = await serializedProvider.searchSpotPools(canonicalJson({ baseMint, quoteMint, query: "", maxPools: 1 }));
assert.equal(serializedResult.searchHash, objectSingleResult.searchHash);
assert.deepEqual(serializedResult.recommendedPools, objectSingleResult.recommendedPools);
serializedContextSlot = 13n; serializedLoaderState.contextSlot = 14n; objectSingleState.contextSlot = 14n;
const serializedFresh = await serializedProvider.revalidateSelectedPools(canonicalJson({
  pools: serializedResult.recommendedPools, minContextSlot: 13n,
} as never));
const objectFresh = await objectSingle.revalidateSelectedPools({ pools: objectSingleResult.recommendedPools, minContextSlot: 13n });
assert.equal(serializedFresh.freshPools[0]!.evidenceHash, objectFresh.freshPools[0]!.evidenceHash);
assert.deepEqual(serializedCounts, { context: 2, program: 1, scan: 1, capture: 2 });

for (const invalid of ["{", canonicalJson({ baseMint, quoteMint, query: "", maxPools: -1 }),
  JSON.stringify({ baseMint, quoteMint, query: "", maxPools: 1 }),
  canonicalJson({ baseMint, quoteMint, query: "", maxPools: 1, constructor: "bad" } as never), "x".repeat(2_049)]) {
  await assert.rejects(() => serializedProvider.searchSpotPools(invalid));
}
await assert.rejects(() => serializedProvider.revalidateSelectedPools(canonicalJson({ pools: [], minContextSlot: 13n } as never)),
  (error) => (error as { code?: string }).code === "POOL_COUNT_OUT_OF_RANGE");

const pumpMetadataFixtureSource = await makeBetaCaptureFixture("pumpswap", { seed: 971 });
const pumpBaseMintRow = pumpMetadataFixtureSource.input.accounts.find((row) => row.address === pumpMetadataFixtureSource.input.pair.baseMint)!;
const pumpBaseVaultRow = pumpMetadataFixtureSource.input.accounts.find((row) => row.address === pumpMetadataFixtureSource.input.expectedPlan.baseVault)!;
const pumpMetadata = new Uint8Array(166); pumpMetadata.set(addressBytes(pumpBaseMintRow.address), 32);
let metadataOffset = 64;
for (const field of ["Mimir metadata token", "MIMIR", "u".repeat(61)]) {
  const bytes = new TextEncoder().encode(field); new DataView(pumpMetadata.buffer).setUint32(metadataOffset, bytes.length, true);
  metadataOffset += 4; pumpMetadata.set(bytes, metadataOffset); metadataOffset += bytes.length;
}
new DataView(pumpMetadata.buffer).setUint32(metadataOffset, 0, true);
const pointer = new Uint8Array(64); pointer.set(addressBytes(pumpBaseMintRow.address), 32);
const extendedPumpMint = new Uint8Array(404); extendedPumpMint.set(pumpBaseMintRow.data.slice(0, 82)); extendedPumpMint[165] = 1;
const extendedPumpMintView = new DataView(extendedPumpMint.buffer);
extendedPumpMintView.setUint16(166, 18, true); extendedPumpMintView.setUint16(168, pointer.length, true); extendedPumpMint.set(pointer, 170);
extendedPumpMintView.setUint16(234, 19, true); extendedPumpMintView.setUint16(236, pumpMetadata.length, true); extendedPumpMint.set(pumpMetadata, 238);
const immutablePumpVault = new Uint8Array(170); immutablePumpVault.set(pumpBaseVaultRow.data); immutablePumpVault[165] = 2;
new DataView(immutablePumpVault.buffer).setUint16(166, 7, true);
const pumpMetadataFixture: BetaCaptureFixture = { ...pumpMetadataFixtureSource,
  input: { ...pumpMetadataFixtureSource.input, accounts: pumpMetadataFixtureSource.input.accounts.map((row) =>
    row.address === pumpBaseMintRow.address ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: extendedPumpMint }
      : row.address === pumpBaseVaultRow.address ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: immutablePumpVault } : row) },
};
const pumpMetadataState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const pumpMetadataProvider = createInjectedPoolDiscovery(providerConfig([pumpMetadataFixture], pumpMetadataState,
  async () => ({ slot: 12n, unixTimestamp: 20n })));
const pumpMetadataResult = await pumpMetadataProvider.searchSpotPools({
  ...pumpMetadataFixture.input.pair, query: "", maxPools: 1,
});
const pumpMetadataSelected = pumpMetadataResult.recommendedPools[0]!;
assert.equal(pumpMetadataSelected.adapterVersion, 1);
assert.equal(pumpMetadataSelected.token2022Mint, pumpMetadataFixture.input.pair.baseMint);
assert.equal(pumpMetadataSelected.token2022PolicyHash, null);
assert.deepEqual(pumpMetadataSelected.creation.staticAccounts.map((entry) => entry.role),
  ["base-mint", "quote-mint", "base-vault", "quote-vault", "pool", "global-config", "fee-config"]);
const pumpMetadataRevalidated = await pumpMetadataProvider.revalidateSelectedPools({ pools: [pumpMetadataSelected], minContextSlot: 12n });
assert.equal(pumpMetadataRevalidated.freshPools[0]!.adapterVersion, 1);
assert.equal(pumpMetadataRevalidated.freshPools[0]!.token2022PolicyHash, null);

const dlmmPolicySource = await makeBetaCaptureFixture("meteora-dlmm", { seed: 979 });
const dlmmPolicyMintRow = dlmmPolicySource.input.accounts.find((row) => row.address === dlmmPolicySource.input.pair.baseMint)!;
const dlmmPolicyVaultRow = dlmmPolicySource.input.accounts.find((row) => row.address === dlmmPolicySource.input.expectedPlan.baseVault)!;
const dlmmScaledValue = new Uint8Array(56);
const dlmmScaledView = new DataView(dlmmScaledValue.buffer);
dlmmScaledView.setBigUint64(32, 0x3ff0000000000000n, true);
dlmmScaledView.setBigInt64(40, 0n, true);
dlmmScaledView.setBigUint64(48, 0x3ff0000000000000n, true);
const dlmmScaledMint = new Uint8Array(226);
dlmmScaledMint.set(dlmmPolicyMintRow.data.slice(0, 165)); dlmmScaledMint[165] = 1;
new DataView(dlmmScaledMint.buffer).setUint16(166, 25, true);
new DataView(dlmmScaledMint.buffer).setUint16(168, dlmmScaledValue.length, true);
dlmmScaledMint.set(dlmmScaledValue, 170);
const dlmmPolicyVault = new Uint8Array(170); dlmmPolicyVault.set(dlmmPolicyVaultRow.data);
dlmmPolicyVault[165] = 2; new DataView(dlmmPolicyVault.buffer).setUint16(166, 7, true);
const dlmmPolicyFixture: BetaCaptureFixture = { ...dlmmPolicySource, input: { ...dlmmPolicySource.input,
  accounts: dlmmPolicySource.input.accounts.map((row) => row.address === dlmmPolicyMintRow.address
    ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: dlmmScaledMint }
    : row.address === dlmmPolicyVaultRow.address
      ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: dlmmPolicyVault }
      : row) } };
const dlmmPolicyState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const dlmmPolicyProvider = createInjectedPoolDiscovery(providerConfig([dlmmPolicyFixture], dlmmPolicyState,
  async () => ({ slot: 12n, unixTimestamp: 20n })));
const dlmmPolicyResult = await dlmmPolicyProvider.searchSpotPools({
  ...dlmmPolicyFixture.input.pair, query: "", maxPools: 1,
});
const dlmmPolicySelected = dlmmPolicyResult.recommendedPools[0]!;
assert.equal(dlmmPolicySelected.adapterVersion, 1);
assert.match(dlmmPolicySelected.token2022PolicyHash!, /^[0-9a-f]{64}$/);
assert.deepEqual(dlmmPolicySelected.creation.staticAccounts.map((entry) => entry.role),
  ["base-vault", "quote-vault", "pool", "token2022-mint"]);
await assert.rejects(() => dlmmPolicyProvider.revalidateSelectedPools({
  pools: [{ ...dlmmPolicySelected, token2022PolicyHash: null }], minContextSlot: 12n,
}), (error) => (error as { code?: string }).code === "INVALID_ARGUMENT");
const dlmmMutatedRows = new Map(dlmmPolicyFixture.input.accounts.map((row) => [row.address, row]));
const dlmmMutatedMint = dlmmMutatedRows.get(dlmmPolicySelected.token2022Mint!)!;
const dlmmMutatedData = dlmmMutatedMint.data.slice();
new DataView(dlmmMutatedData.buffer).setBigUint64(202, 0x4000000000000000n, true);
dlmmMutatedRows.set(dlmmMutatedMint.address, { ...dlmmMutatedMint, data: dlmmMutatedData });
dlmmPolicyState.currentRows = dlmmMutatedRows;
await assert.rejects(() => dlmmPolicyProvider.revalidateSelectedPools({
  pools: [dlmmPolicySelected], minContextSlot: 12n,
}), (error) => (error as { code?: string }).code === "POOL_STALE");

const inactiveDlmm = await makeBetaCaptureFixture("meteora-dlmm", { seed: 913, baseMint, quoteMint });
const inactiveStatus = inactiveDlmm.input.descriptor.status!;
const inactiveData = inactiveDlmm.poolAccount.data.slice();
if (inactiveStatus.acceptedU64) new DataView(inactiveData.buffer).setBigUint64(inactiveStatus.offset, 0n, true);
else inactiveData[inactiveStatus.offset] = inactiveStatus.disabledMask ?? (inactiveStatus.enabled! + 1);
const inactiveFixture = { ...inactiveDlmm, poolAccount: { ...inactiveDlmm.poolAccount, data: inactiveData } };
const inactiveState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const inactiveResult = await createInjectedPoolDiscovery(providerConfig([inactiveFixture], inactiveState))
  .searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 });
assert.equal(inactiveResult.recommendedPools.length, 0);
assert.deepEqual(inactiveResult.pools.map((pool) => [pool.eligibility, pool.pool, (pool as { exclusionCode?: string }).exclusionCode]),
  [["ineligible", inactiveDlmm.poolAccount.address, "POOL_INELIGIBLE"]]);
assert.equal(inactiveState.calls, 0);
const mixedInactiveState: LoaderState = { contextSlot: 12n, calls: 0, requests: [] };
const mixedInactive = await createInjectedPoolDiscovery(providerConfig([inactiveFixture, selectedFixture], mixedInactiveState))
  .searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 2 });
assert.deepEqual(mixedInactive.recommendedPools.map((pool) => pool.pool), [selectedFixture.input.expectedPlan.pool]);
assert.equal(mixedInactive.pools.length, 2);
await assert.rejects(() => createInjectedPoolDiscovery({ ...providerConfig([selectedFixture], { contextSlot: 12n, calls: 0, requests: [] }),
  sources: [{ ...sourceFromFixtures([selectedFixture]), scan: async () => [] }] }).searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 }),
  (error) => (error as { code?: string }).code === "NO_ELIGIBLE_POOLS");
for (const fixture of [selectedFixture, inactiveFixture]) {
  const provider = createInjectedPoolDiscovery(providerConfig([fixture], { contextSlot: 12n, calls: 0, requests: [] }));
  assert.equal((await provider.searchSpotPools({ baseMint, quoteMint, query: "", maxPools: 1 })).pools.length, 1);
  const unmatched = await provider.searchSpotPools({ baseMint, quoteMint, query: "no_matching_pool", maxPools: 1 });
  assert.equal(unmatched.pools.length, 0);
  assert.equal(unmatched.recommendedPools.length, 0);
}

console.log("beta discovery tests passed");
