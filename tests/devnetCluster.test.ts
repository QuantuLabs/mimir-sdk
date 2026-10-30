import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import type { Address } from "@solana/kit";
import { createInjectedPoolDiscovery, type CreateInjectedPoolDiscoveryConfig, type MimirBetaEligiblePool } from "../src/beta/discovery.js";
import { decodeMimirBetaCaptureCandidate, deriveMimirBetaCaptureReadPlan, mimirBetaCapturePoolCoreLayout, mimirBetaCaptureScanDescriptors,
  MIMIR_BETA_ORCA_WHIRLPOOLS_CONFIG_MAINNET, type MimirBetaCapturedAccount } from "../src/beta/capture.js";
import { MIMIR_BETA_CLUSTER_TABLES, MIMIR_BETA_DEVNET_CUSDC_V2, mimirBetaVenueProgram } from "../src/beta/cluster.js";
import { MIMIR_BETA_MPL_CORE_PROGRAM_ID, MIMIR_BETA_SYSTEM_PROGRAM_ID, validateMimirBetaDeployment } from "../src/beta/deployment.js";
import { classicRowExternals, freshAdapterAccounts } from "../src/beta/live.js";
import { mimirSampledSourceAdapters } from "../src/internal/sampledTemporalCore.js";
import { addressBytes, bytesAddress } from "../src/beta/bytes.js";
import { isMimirAdmittedFeedCreationCollateralMint, isMimirAdmittedQuoteMint, isMimirClassicFeedQuoteMint, SourceAdapterType,
  resolveMimirProgramProfile } from "../src/constants.js";
import { mimirExecutableGenerationPins, mimirOrcaWhirlpoolsConfigAddress, mimirVenueDeploymentUnix, verifyCpmmExecutableGeneration,
  verifyDammExecutableGeneration, verifyDlmmExecutableGeneration, verifyOrcaExecutableGeneration } from "../src/internal/nativeMonoRefreshCore.js";
import { fixtureAddress, makeBetaCaptureFixture, type BetaCaptureFixture } from "./fixtures/betaCaptureFixtures.js";

const DEVNET_MIMIR = "4kxKWPhWUZMj1x2D2BaCBW9BfeBZ6po4WagfzkUCsAt4" as Address;
const CLOCK = "SysvarC1ock11111111111111111111111111111111" as Address;

// Profile validation.
const addr = (byte: number) => bytesAddress(Uint8Array.from({ length: 32 }, () => byte));
const deployment = validateMimirBetaDeployment({ cluster: "devnet", mimirProgramId: DEVNET_MIMIR,
  agentRegistryProgramId: "8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C" as Address, mplCoreProgramId: MIMIR_BETA_MPL_CORE_PROGRAM_ID,
  systemProgramId: MIMIR_BETA_SYSTEM_PROGRAM_ID, physicalCollection: addr(7), collectionPointer: "c1:abc" });
assert.equal(deployment.cluster, "devnet");
assert.throws(() => validateMimirBetaDeployment({ ...deployment, cluster: "testnet" as never }), /unsupported beta cluster/);
assert.equal(resolveMimirProgramProfile({ cluster: "devnet", programId: DEVNET_MIMIR }).cluster, "devnet");
const cusdcV2 = new PublicKey(MIMIR_BETA_DEVNET_CUSDC_V2);
const cusdcV1 = new PublicKey("5W1Mg5LYmczXTGAqjSoTeMi7tXUQx3bfXsLr1MKvV1Tk");
const mainnetUsdc = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const sol = new PublicKey("So11111111111111111111111111111111111111112");
assert(isMimirAdmittedQuoteMint(cusdcV2, "devnet") && isMimirAdmittedQuoteMint(cusdcV1, "devnet") && isMimirAdmittedQuoteMint(sol, "devnet"));
assert(isMimirClassicFeedQuoteMint(cusdcV2, "devnet") && !isMimirClassicFeedQuoteMint(sol, "devnet"));
assert(!isMimirAdmittedQuoteMint(mainnetUsdc, "devnet") && !isMimirAdmittedQuoteMint(cusdcV2, "mainnet"));
assert(isMimirAdmittedFeedCreationCollateralMint(new PublicKey("ADb8dPPZK2LU3BVyuEfwGbQ1FujEAtRDxdhaTreLV9ij"), "devnet"));

// Venue resolution per cluster.
assert.equal(mimirBetaVenueProgram("devnet", "raydium-cpmm"), "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
assert.equal(mimirBetaVenueProgram("devnet", "raydium-clmm"), "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
assert.equal(mimirBetaVenueProgram("devnet", "orca-whirlpool"), "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
assert.equal(mimirBetaVenueProgram("devnet", "meteora-dlmm"), "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
assert.equal(mimirBetaVenueProgram("devnet", "meteora-damm-v2"), "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
assert.equal(mimirBetaVenueProgram("devnet", "raydium-amm-v4"), "DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav");
assert.equal(mimirBetaVenueProgram("devnet", "pumpswap"), "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
{
  const pins = (cluster: "mainnet" | "devnet") => Object.values(mimirSampledSourceAdapters(cluster)).map((a) => [a.program, a.programData, a.deploymentSlot]);
  assert.deepEqual(pins("mainnet"), [["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", "A7ZG7ByDi8DpzT9Ab7CiXhvgYTJQmaDPJkMDoPitaCQV", 445763204n],
    ["pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", "6naEzKeUuFh1Jeeu51NXQgr5qkXgXtc9WKNct4xynVJc", 454596406n]]);
  assert.deepEqual(pins("devnet"), [["DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav", "CBzefV6o4R3jkFThNxzFsDNSJrnoUwgf6CBfUBiqh6VE", 494463161n],
    ["pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", "6naEzKeUuFh1Jeeu51NXQgr5qkXgXtc9WKNct4xynVJc", 508659436n]]);
}
assert.equal(mimirBetaVenueProgram("mainnet-beta", "raydium-cpmm"), "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
assert.equal(MIMIR_BETA_CLUSTER_TABLES.devnet.orcaWhirlpoolsConfig, "FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");
assert.equal(MIMIR_BETA_CLUSTER_TABLES.devnet.twapMinCoverageBps, 9_000);
assert.equal(MIMIR_BETA_CLUSTER_TABLES["mainnet-beta"].twapMinCoverageBps, 9_000);
assert.equal(MIMIR_BETA_CLUSTER_TABLES.devnet.raydiumCpmmPoolStateLength, 637);
const devnetDescriptors = mimirBetaCaptureScanDescriptors("devnet");
const mainnetDescriptors = mimirBetaCaptureScanDescriptors();
assert.deepEqual(new Set(devnetDescriptors.map((entry) => entry.family)),
  new Set(["meteora-damm-v2", "meteora-dlmm", "orca-whirlpool", "pumpswap", "raydium-amm-v4", "raydium-clmm", "raydium-cpmm"]));
assert.deepEqual(mimirBetaCaptureScanDescriptors("localnet"), mainnetDescriptors);
assert.deepEqual(mimirBetaCaptureScanDescriptors("mainnet-beta"), mainnetDescriptors);
const devnetHashes = new Set(devnetDescriptors.map((entry) => entry.descriptorHash));
assert.deepEqual(mainnetDescriptors.filter((entry) => devnetHashes.has(entry.descriptorHash)).map((entry) => entry.family).sort(),
  ["meteora-damm-v2", "meteora-dlmm", "pumpswap", "pumpswap", "pumpswap"]);
assert.equal(devnetDescriptors.find((entry) => entry.family === "raydium-cpmm")!.allocationSize, 637);

// Devnet discovery: CPMM with a cUSDC v2 quote, an Orca feed, and a K=2 cohort.
function config(cluster: "devnet" | "mainnet-beta", fixtures: readonly BetaCaptureFixture[], layoutCluster = cluster): CreateInjectedPoolDiscoveryConfig {
  const byAddress = new Map<Address, MimirBetaCapturedAccount>(fixtures.flatMap((fixture) => fixture.input.accounts.map((row) => [row.address, row] as const)));
  return {
    cluster, evidenceTtlSlots: 5n, maxScanResultsPerFamily: 5,
    sources: fixtures.map((fixture) => ({
      layouts: mimirBetaCaptureScanDescriptors(layoutCluster).filter((entry) => entry.family === fixture.input.descriptor.family)
        .map(mimirBetaCapturePoolCoreLayout),
      loadProgram: async () => ({ executable: true }), scan: async () => [fixture.poolAccount],
    })),
    getContext: async () => ({ slot: 10n, unixTimestamp: 20n }),
    loadCapturePlanAccounts: async (request) => {
      const requested = [...new Set(request.plans.flatMap((plan) => [...plan.addresses]))];
      const rows = requested.flatMap((value) => {
        if (value !== CLOCK) return [byAddress.get(value) ?? []].flat();
        const data = new Uint8Array(40); const view = new DataView(data.buffer); view.setBigUint64(0, 12n, true); view.setBigInt64(32, 20n, true);
        return [{ address: CLOCK, owner: "Sysvar1111111111111111111111111111111111111" as Address, executable: false, data }];
      });
      return { contextSlot: 12n, accounts: rows };
    },
  };
}
const baseMint = fixtureAddress(31);
const cpmm = await makeBetaCaptureFixture("raydium-cpmm", { cluster: "devnet", seed: 51, baseMint, quoteMint: MIMIR_BETA_DEVNET_CUSDC_V2,
  baseAmount: 1_000_000_000_000_000n, quoteAmount: 1_000_000_000_000_000n });
const orca = await makeBetaCaptureFixture("orca-whirlpool", { cluster: "devnet", seed: 61, baseMint, quoteMint: MIMIR_BETA_DEVNET_CUSDC_V2 });
assert.equal(cpmm.poolAccount.owner, "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
assert.equal(cpmm.poolAccount.data.length, 637);
const pair = { baseMint, quoteMint: MIMIR_BETA_DEVNET_CUSDC_V2 as Address, query: "", maxPools: 5 as never };
const cpmmOnly = await createInjectedPoolDiscovery(config("devnet", [cpmm])).searchSpotPools(pair);
assert.deepEqual(cpmmOnly.recommendedPools.map((pool) => [pool.family, pool.programId, pool.quoteMint]),
  [["raydium-cpmm", "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb", MIMIR_BETA_DEVNET_CUSDC_V2]]);
assert.equal(cpmmOnly.recommendedPools[0]!.creation.adapterType, 2);
const orcaOnly = await createInjectedPoolDiscovery(config("devnet", [orca])).searchSpotPools(pair);
assert.equal(orcaOnly.recommendedPools.length, 1);
const orcaPool = orcaOnly.recommendedPools[0]! as MimirBetaEligiblePool;
assert(orcaPool.readPlan.auxiliary.some((node) => node.role === "whirlpools-config" && node.address === "FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR"));
const dlmm = await makeBetaCaptureFixture("meteora-dlmm", { cluster: "devnet", seed: 81, baseMint, quoteMint: MIMIR_BETA_DEVNET_CUSDC_V2 });
const dlmmOnly = await createInjectedPoolDiscovery(config("devnet", [dlmm])).searchSpotPools(pair);
assert.deepEqual(dlmmOnly.recommendedPools.map((pool) => [pool.family, pool.programId]),
  [["meteora-dlmm", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"]]);
const composite = await createInjectedPoolDiscovery(config("devnet", [cpmm, orca])).searchSpotPools(pair);
assert.deepEqual(composite.recommendedPools.map((pool) => pool.family).sort(), ["orca-whirlpool", "raydium-cpmm"]);

// Live-refresh planning on devnet: the adapter tail resolves through the devnet descriptor.
const liveRows = new Map(orca.input.accounts.map((row) => [row.address, row] as const)) as never;
const tail = await freshAdapterAccounts(orcaPool, liveRows, true);
assert.deepEqual(tail.slice(0, orcaPool.creation.staticAccounts.length), orcaPool.creation.staticAccounts.map((entry) => entry.address));
assert(orca.fixtureAccounts.filter((row) => row.fixtureRole.startsWith("tick-array")).every((row) => tail.includes(row.address)));

// Cross-cluster refusal.
assert.throws(() => createInjectedPoolDiscovery(config("mainnet-beta", [cpmm], "devnet")), /complete exact exported family descriptor set/);
assert.throws(() => createInjectedPoolDiscovery(config("devnet", [cpmm], "mainnet-beta")), /complete exact exported family descriptor set/);
const mainnetAmm = await makeBetaCaptureFixture("raydium-amm-v4", { seed: 71 });
assert.throws(() => createInjectedPoolDiscovery(config("devnet", [mainnetAmm], "mainnet-beta")), /complete exact exported family descriptor set/);
const mainnetPump = await makeBetaCaptureFixture("pumpswap", { seed: 72 });
assert.doesNotThrow(() => createInjectedPoolDiscovery(config("devnet", [mainnetPump], "mainnet-beta")));
const devnetProfile = resolveMimirProgramProfile({ cluster: "devnet" } as never);
await assert.rejects(() => createInjectedPoolDiscovery(config("devnet", [{ ...cpmm,
  poolAccount: { ...cpmm.poolAccount, owner: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C" as Address } }])).searchSpotPools(pair),
  /UNKNOWN_CAPTURE_ALLOCATION/);
const mainnetConfigData = orca.input.accounts[0]!.data.slice(); mainnetConfigData.set(addressBytes(MIMIR_BETA_ORCA_WHIRLPOOLS_CONFIG_MAINNET), 8);
await assert.rejects(() => decodeMimirBetaCaptureCandidate({ ...orca.input,
  accounts: orca.input.accounts.map((row, index) => index === 0 ? { ...row, data: mainnetConfigData } : row) }));
const devnetOrcaOnMainnet = mainnetDescriptors.find((entry) => entry.family === "orca-whirlpool")!;
await assert.rejects(() => decodeMimirBetaCaptureCandidate({ ...orca.input, descriptor: devnetOrcaOnMainnet }));

// Venue executable-generation pins: devnet pins on devnet, mainnet pins elsewhere.
const generationShells = (pin: readonly [string, string, bigint]) => {
  const program = new Uint8Array(36); program[0] = 2; program.set(addressBytes(pin[1] as Address), 4);
  const data = new Uint8Array(45); data[0] = 3; new DataView(data.buffer).setBigUint64(4, pin[2], true);
  const loader = "BPFLoaderUpgradeab1e11111111111111111111111" as Address;
  return [{ address: pin[0] as Address, owner: loader, executable: true, data: program },
    { address: pin[1] as Address, owner: loader, executable: false, data }] as const;
};
const devnetPins = mimirExecutableGenerationPins("devnet"), mainnetPins = mimirExecutableGenerationPins("mainnet");
assert.deepEqual(devnetPins.cpmm, ["DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb", "3KvTa2fYhMxMZNfHho5oX34yLQLwRauoU2JScBkugvXF", 498_629_438n]);
assert.deepEqual(devnetPins.orca, ["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", "CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD", 439_560_432n]);
assert.deepEqual(devnetPins.dlmm, ["LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", "HZcJwcJ2njPDxZtpPoKnF8v2w9QAx2rS7TdJPSRkbEhu", 466_305_525n]);
assert.deepEqual(devnetPins.damm, ["cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", "AUh8bm2XsMfex3KjYGcM3G4uBqUNSDw6HEhWaWMYnyPH", 503_166_267n]);
assert.equal(mimirExecutableGenerationPins("localnet"), mainnetPins);
assert.deepEqual(mimirVenueDeploymentUnix("devnet"), { orca: 1_770_107_735n, dlmm: 1_780_277_719n });
assert.deepEqual(mimirVenueDeploymentUnix("mainnet"), { orca: 1_792_048_925n, dlmm: 1_780_470_187n });
assert.equal(mimirOrcaWhirlpoolsConfigAddress("devnet"), "FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");
assert.equal(mimirOrcaWhirlpoolsConfigAddress("mainnet"), MIMIR_BETA_ORCA_WHIRLPOOLS_CONFIG_MAINNET);
for (const [verify, key] of [[verifyCpmmExecutableGeneration, "cpmm"], [verifyOrcaExecutableGeneration, "orca"],
  [verifyDlmmExecutableGeneration, "dlmm"], [verifyDammExecutableGeneration, "damm"]] as const) {
  const devnet = generationShells(devnetPins[key]), mainnet = generationShells(mainnetPins[key]);
  assert(verify(...devnet, "devnet") && verify(...mainnet) && verify(...mainnet, "localnet"));
  const upgraded = generationShells([mainnetPins[key][0], mainnetPins[key][1], 999_999_999n]);
  assert(verify(...upgraded) && verify(...upgraded, "localnet"));
  if (key === "cpmm") assert(!verify(...devnet) && !verify(...devnet, "localnet") && !verify(...mainnet, "devnet"));
}

{
  const capture = JSON.parse(readFileSync(new URL("./fixtures/devnet-raydium-amm-v4-1wC1zR8P.json", import.meta.url), "utf8"));
  const row = capture.accounts[capture.pool];
  const plan = (cluster: "devnet" | "mainnet-beta", owner: Address = row.owner) => deriveMimirBetaCaptureReadPlan({
    descriptor: mimirBetaCaptureScanDescriptors(cluster).find((d) => d.family === "raydium-amm-v4")!,
    primary: { address: capture.pool, owner, executable: false, data: Buffer.from(row.data[0], "base64") },
    pair: { baseMint: capture.baseMint, quoteMint: capture.quoteMint },
    context: { observedSlot: BigInt(capture.captureSlot), observedUnixTimestamp: 1_790_000_000n } });
  const nodes = plan("devnet").auxiliary;
  assert.equal(nodes.find((n) => n.role === "market-program")!.address, "EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj");
  assert.throws(() => plan("mainnet-beta", MIMIR_BETA_CLUSTER_TABLES["mainnet-beta"].venuePrograms["raydium-amm-v4"]!), /venue closure/);
}

{
  const capture = JSON.parse(readFileSync(new URL("./fixtures/devnet-raydium-amm-v4-1wC1zR8P-coherent.json", import.meta.url), "utf8"));
  const rows = Object.entries(capture.accounts as Record<string, { owner: Address; executable: boolean; data: [string] }>).map(([address, row]) =>
    ({ address: address as Address, owner: row.owner, executable: row.executable, data: new Uint8Array(Buffer.from(row.data[0], "base64")) }));
  const descriptor = mimirBetaCaptureScanDescriptors("devnet").find((d) => d.family === "raydium-amm-v4")!;
  const context = { observedSlot: BigInt(capture.slot), observedUnixTimestamp: BigInt(capture.unix) };
  const pair = { baseMint: capture.baseMint, quoteMint: capture.quoteMint };
  const expectedPlan = deriveMimirBetaCaptureReadPlan({ descriptor, primary: rows.find((row) => row.address === capture.pool)!, pair, context });
  const planned = new Set([capture.pool, ...expectedPlan.auxiliary.map((node) => node.address)]);
  const decode = (accounts: typeof rows) => decodeMimirBetaCaptureCandidate({ descriptor, pair, context, expectedPlan,
    accounts: accounts.filter((row) => planned.has(row.address)) });
  assert.equal(MIMIR_BETA_CLUSTER_TABLES.devnet.ammV4AdministrativeOwner, "DRayqG9RXYi8WHgWEmRQGrUWRWbhjYWYkCRJDd6JBBak");
  await decode(rows);
  const mainnetOwner = rows.map((row) => row.address !== capture.pool ? row : { ...row, data: row.data.slice() });
  mainnetOwner.find((row) => row.address === capture.pool)!.data.set(addressBytes(MIMIR_BETA_CLUSTER_TABLES["mainnet-beta"].ammV4AdministrativeOwner), 688);
  await assert.rejects(() => decode(mainnetOwner), /AMM-v4 authority mismatch/);
}

{
  // Recurring tag-89 externals of a sampled AMM-v4 row carry the deployment cluster's program/ProgramData pins.
  const row = (cluster: "devnet" | "mainnet") => classicRowExternals([{ adapterType: 4, temporalKind: 4, externalWidth: 9 } as never],
    { adapterAccounts: [[CLOCK]], cpmmPins: [CLOCK, CLOCK], generationCluster: cluster } as never)[0]!.slice(-2);
  for (const cluster of ["devnet", "mainnet"] as const) {
    assert.deepEqual(row(cluster), [mimirSampledSourceAdapters(cluster)[4].program, mimirSampledSourceAdapters(cluster)[4].programData]);
  }
}

console.log("devnet cluster tests passed");
