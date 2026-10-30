import assert from "node:assert/strict";
import { base64, bytesAddress } from "../src/beta/bytes.js";
import { createMimirBetaClient, type MimirBetaPlanningRpc } from "../src/beta/client.js";
import { createMimir8004IdentityAdapter } from "../src/beta/identity8004.js";
import { inspectMimirFeedOwnership } from "../src/beta/ownership.js";
import { MIMIR_BETA_MPL_CORE_PROGRAM_ID, MIMIR_BETA_SYSTEM_PROGRAM_ID } from "../src/beta/deployment.js";
import type { MimirBetaPoolDiscovery } from "../src/beta/discovery.js";
import { MIMIR_BETA_TRANSACTION_V1_FEATURE, MIMIR_BETA_TRANSACTION_V1_FEATURE_OWNER } from "../src/beta/transactionV1.js";

const addr = (byte: number) => bytesAddress(Uint8Array.from({ length: 32 }, () => byte));
const deployment = {
  cluster: "localnet" as const,
  mimirProgramId: addr(1), agentRegistryProgramId: addr(2), mplCoreProgramId: MIMIR_BETA_MPL_CORE_PROGRAM_ID,
  systemProgramId: MIMIR_BETA_SYSTEM_PROGRAM_ID, physicalCollection: addr(5),
  collectionPointer: "c1:bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  tokenProgramId: addr(6),
};
const pending = <T>(value: T) => ({ send: async () => value });
const featureData = new Uint8Array(9); featureData[0] = 1;
new DataView(featureData.buffer).setBigUint64(1, 1n, true);
let featureReads = 0;
const featureConfigs: unknown[] = [];
const rpc: MimirBetaPlanningRpc = {
  getAccountInfo: (address, config) => {
    if (address === MIMIR_BETA_TRANSACTION_V1_FEATURE) {
      featureReads += 1;
      featureConfigs.push(config);
      return pending({ context: { slot: 8 }, value: { owner: MIMIR_BETA_TRANSACTION_V1_FEATURE_OWNER,
        executable: false, lamports: 1, data: [base64(featureData), "base64"] } });
    }
    return pending({ context: { slot: 8 }, value: null });
  },
  getMultipleAccounts: (addresses) => pending({ context: { slot: 8 }, value: addresses.map(() => null) }),
  getLatestBlockhash: () => pending({ value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9 } }),
  simulateTransaction: () => pending({ context: { slot: 8 }, value: { err: null, accounts: [], logs: [] } }),
};
let listCalls = 0;
let searchCalls = 0;
const discovery: MimirBetaPoolDiscovery = {
  listPoolSources: async () => { listCalls += 1; return []; },
  searchSpotPools: async (args) => {
    searchCalls += 1;
    return { ...args, observedSlot: 8n, pools: [], recommendedPools: [], searchHash: "0".repeat(64) };
  },
  revalidateSelectedPools: async ({ pools, minContextSlot }) => ({ pools, freshPools: pools, slot: minContextSlot }),
};
const identity = createMimir8004IdentityAdapter(deployment);
const client = createMimirBetaClient({ deployment, rpc, discovery, identity });
assert.deepEqual(Object.keys(client).sort(), [
  "authenticateCompositeRevenueClaimReceipt", "createCompositeRevenueClaimReceipt", "inspectCompositeRevenue", "inspectConverterEligibility",
  "inspectFeedOwnership", "inspectNativeReadiness", "listPoolSources", "prepareClassicExecutionAttach", "prepareClassicQuietPrime", "prepareClassicRefresh", "prepareCompositeFeed",
  "prepareCompositeFeedConfirmed", "prepareCompositeFeedJourney", "prepareCompositeRevenueClaim", "prepareSimpleFeed", "prepareSimpleFeedConfirmed", "reconcileCompositeRevenueClaim", "searchSpotPools",
  "verifyClassicQuietPrime",
]);
assert.equal(Object.isFrozen(client), true);
await client.listPoolSources();
await client.searchSpotPools({ baseMint: addr(7), quoteMint: addr(8), query: "", maxPools: 5 });
assert.equal(listCalls, 1);
assert.equal(searchCalls, 1);
for (const forbidden of ["sign", "send", "createLookupTable", "createAlt"]) assert.equal(forbidden in client, false);
const wrappedOwnership = await client.inspectFeedOwnership({ feed: addr(9), minContextSlot: 7n });
const directOwnership = await inspectMimirFeedOwnership({ deployment, rpc, feed: addr(9), minContextSlot: 7n });
assert.deepEqual(wrappedOwnership, directOwnership);
assert.throws(() => createMimirBetaClient({ deployment, rpc, discovery,
  identity: { ...identity, physicalCollection: addr(10) } }));
await assert.rejects(() => client.prepareSimpleFeed({} as never));
await assert.rejects(() => client.prepareCompositeFeed({} as never));
await assert.rejects(() => client.prepareCompositeFeedJourney({} as never, rpc as never));
await assert.rejects(() => client.prepareClassicRefresh({} as never));
await assert.rejects(() => client.prepareClassicExecutionAttach({} as never));
assert.equal(featureReads, 1);
assert.deepEqual(featureConfigs, [{ commitment: "finalized", encoding: "base64" }]);
let failedFeatureReads = 0;
const failedFeatureClient = createMimirBetaClient({ deployment, discovery, identity, rpc: {
  ...rpc,
  getAccountInfo: () => { failedFeatureReads += 1; return pending({ context: { slot: 8 }, value: null }); },
} });
await assert.rejects(() => failedFeatureClient.prepareSimpleFeed({} as never));
await assert.rejects(() => failedFeatureClient.prepareCompositeFeed({} as never));
await assert.rejects(() => failedFeatureClient.prepareCompositeFeedJourney({} as never, rpc as never), /TRANSACTION_V1|feature/i);
await assert.rejects(() => failedFeatureClient.prepareClassicRefresh({} as never));
assert.equal(failedFeatureReads, 1);
const staleData = featureData.slice(); new DataView(staleData.buffer).setBigUint64(1, 9n, true);
for (const value of [
  { owner: addr(99), executable: false, lamports: 1, data: [base64(featureData), "base64"] },
  { owner: MIMIR_BETA_TRANSACTION_V1_FEATURE_OWNER, executable: false, lamports: 1, data: [base64(Uint8Array.of(1)), "base64"] },
  { owner: MIMIR_BETA_TRANSACTION_V1_FEATURE_OWNER, executable: false, lamports: 1, data: [base64(Uint8Array.of(0, ...featureData.slice(1))), "base64"] },
  { owner: MIMIR_BETA_TRANSACTION_V1_FEATURE_OWNER, executable: false, lamports: 1, data: [base64(staleData), "base64"] },
]) {
  const invalid = createMimirBetaClient({ deployment, discovery, identity, rpc: {
    ...rpc, getAccountInfo: () => pending({ context: { slot: 8 }, value }),
  } });
  await assert.rejects(() => invalid.prepareSimpleFeed({} as never));
}

console.log("beta client tests passed");
