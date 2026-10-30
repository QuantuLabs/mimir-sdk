import type { MimirConsumerAdmissionInputsV1, MimirAbi1Capability } from "./abi1Release.js";
import { address, type Address } from "@solana/kit";
import {
  validateMimirBetaDeployment,
  type MimirBetaDeployment,
} from "./deployment.js";
import type {
  MimirBetaCount,
  MimirBetaFeedOwnership,
} from "./types.js";
import type { MimirBetaFinalizedRpc } from "./rpc.js";
import type {
  MimirBetaPoolDiscovery,
  MimirBetaPoolSearchResult,
  MimirBetaPoolSourceDescriptor,
} from "./discovery.js";
import type { Mimir8004IdentityAdapter } from "./identity8004.js";
import {
  prepareMimirBetaCompositeFeed,
  prepareMimirBetaSimpleFeed,
  prepareMimirBetaSimpleFeedConfirmed,
  prepareMimirBetaCompositeFeedConfirmed,
  prepareMimirBetaCompositeFeedJourney,
  inspectMimirBetaConverterEligibility,
  inspectMimirBetaClassicNativeReadiness,
  type MimirBetaPreparedCompositeJourney,
  type PrepareCompositeFeedArgs,
  type PrepareCompositeFeedJourneyArgs,
  type PrepareSimpleFeedArgs,
} from "./creation.js";
import type { MimirBetaPreparedCreation } from "./review.js";
import { inspectMimirFeedOwnership } from "./ownership.js";
import { betaError } from "./errors.js";
import { FinalizedRpcReader } from "./rpc.js";
import {
  MIMIR_BETA_TRANSACTION_V1_FEATURE,
  MIMIR_BETA_TRANSACTION_V1_FEATURE_OWNER,
} from "./transactionV1.js";
import {
  prepareMimirBetaClassicRefresh,
  prepareMimirBetaClassicQuietPrime,
  verifyMimirBetaClassicQuietPrime,
  prepareMimirClassicExecutionAttach,
  type PrepareMimirClassicExecutionAttachArgs,
  type MimirBetaPreparedClassicRefresh,
  type PrepareMimirBetaClassicRefreshArgs,
  type MimirBetaConverterEligibility,
} from "./live.js";
import {
  authenticateMimirBetaCompositeRevenueClaimReceipt,
  createMimirBetaCompositeRevenueClaimReceipt,
  inspectMimirBetaCompositeRevenue,
  prepareMimirBetaCompositeRevenueClaim,
  reconcileMimirBetaCompositeRevenueClaim,
  type MimirBetaCompositeRevenue,
  type MimirBetaPreparedCompositeRevenueClaim,
} from "./revenue.js";
import type { MimirBetaReconciliationRpc } from "./rpc.js";

export interface MimirBetaFacadeDeployment extends MimirBetaDeployment {
  readonly tokenProgramId: Address;
}

export interface MimirBetaRpcPending<T = unknown> { send(): Promise<T>; }

export interface MimirBetaPlanningRpc extends MimirBetaFinalizedRpc {
  getLatestBlockhash(config: Readonly<{ commitment: "confirmed" | "finalized" }>): MimirBetaRpcPending<unknown>;
  getFeeForMessage?(messageBase64: string, config: Readonly<{ commitment: "confirmed" | "finalized" }>): MimirBetaRpcPending<unknown>;
  simulateTransaction(wireTransactionBase64: string, config: Readonly<{
    commitment: "confirmed" | "finalized";
    encoding: "base64";
    sigVerify: false;
    replaceRecentBlockhash: false;
    minContextSlot?: bigint;
    accounts?: Readonly<{ addresses: readonly Address[]; encoding: "base64" }>;
  }>): MimirBetaRpcPending<unknown>;
}

export interface CreateMimirBetaClientArgs {
  readonly deployment: MimirBetaFacadeDeployment;
  readonly rpc: MimirBetaPlanningRpc;
  readonly discovery: MimirBetaPoolDiscovery;
  readonly identity: Mimir8004IdentityAdapter;
  /** Verified ABI-1 capability (`verifyMimirAbi1Capability`); required off localnet for composite creation. */
  readonly abi1Capability?: MimirAbi1Capability;
  /** Consumer budget contract inputs; prepared Composite creations then carry `consumerAdmission`. */
  readonly consumerAdmission?: MimirConsumerAdmissionInputsV1;
  /** Refuse recipes outside the verified capability's release scope. */
  readonly abi1ReleaseRecipeScope?: boolean;
}

export interface MimirBetaClient {
  listPoolSources(): Promise<readonly MimirBetaPoolSourceDescriptor[]>;
  searchSpotPools(args: Readonly<{ baseMint: Address; quoteMint: Address; query: string; maxPools: MimirBetaCount }>): Promise<MimirBetaPoolSearchResult>;
  prepareSimpleFeed(args: PrepareSimpleFeedArgs): Promise<MimirBetaPreparedCreation>;
  prepareSimpleFeedConfirmed(args: PrepareSimpleFeedArgs, rpc: MimirBetaReconciliationRpc): Promise<MimirBetaPreparedCreation>;
  prepareCompositeFeedConfirmed(args: PrepareCompositeFeedArgs, rpc: MimirBetaReconciliationRpc): Promise<MimirBetaPreparedCreation>;
  prepareCompositeFeed(args: PrepareCompositeFeedArgs): Promise<MimirBetaPreparedCreation>;
  prepareCompositeFeedJourney(args: PrepareCompositeFeedJourneyArgs, rpc: MimirBetaReconciliationRpc): Promise<MimirBetaPreparedCompositeJourney>;
  inspectConverterEligibility(args: Readonly<{ feedId: Address }>): Promise<MimirBetaConverterEligibility>;
  prepareClassicRefresh(args: PrepareMimirBetaClassicRefreshArgs): Promise<MimirBetaPreparedClassicRefresh>;
  inspectNativeReadiness(args: Readonly<{ feedId: Address }>): ReturnType<typeof inspectMimirBetaClassicNativeReadiness>;
  prepareClassicQuietPrime(args: Parameters<typeof prepareMimirBetaClassicQuietPrime>[1]): ReturnType<typeof prepareMimirBetaClassicQuietPrime>;
  verifyClassicQuietPrime(prime: Parameters<typeof verifyMimirBetaClassicQuietPrime>[1], minContextSlot: bigint): ReturnType<typeof verifyMimirBetaClassicQuietPrime>;
  prepareClassicExecutionAttach(args: PrepareMimirClassicExecutionAttachArgs): ReturnType<typeof prepareMimirClassicExecutionAttach>;
  inspectFeedOwnership(args: Readonly<{ feed: Address; minContextSlot?: bigint }>): Promise<MimirBetaFeedOwnership>;
  inspectCompositeRevenue(args: Readonly<{ feed: Address; minContextSlot?: bigint }>): Promise<MimirBetaCompositeRevenue>;
  prepareCompositeRevenueClaim(args: Readonly<{ feed: Address; currentOwner: Address; minContextSlot?: bigint }>): Promise<MimirBetaPreparedCompositeRevenueClaim>;
  createCompositeRevenueClaimReceipt(args: Readonly<{ prepared: MimirBetaPreparedCompositeRevenueClaim; signature: string; walletSignedTransaction?: Uint8Array }>): ReturnType<typeof createMimirBetaCompositeRevenueClaimReceipt>;
  authenticateCompositeRevenueClaimReceipt(receipt: unknown): ReturnType<typeof authenticateMimirBetaCompositeRevenueClaimReceipt>;
  reconcileCompositeRevenueClaim(args: Readonly<{ rpc: MimirBetaReconciliationRpc; receipt: unknown; prepared?: MimirBetaPreparedCompositeRevenueClaim }>): ReturnType<typeof reconcileMimirBetaCompositeRevenueClaim>;
}

function validateFacadeDeployment(input: MimirBetaFacadeDeployment): MimirBetaFacadeDeployment {
  if (!input || !input.tokenProgramId) betaError("CREATION_CONTEXT_REQUIRED", "facade deployment programs are required");
  const base = validateMimirBetaDeployment(input);
  let tokenProgramId: Address;
  try { tokenProgramId = address(input.tokenProgramId); }
  catch { return betaError("INVALID_ARGUMENT", "facade program address invalid"); }
  const roles = [base.mimirProgramId, base.agentRegistryProgramId, base.mplCoreProgramId, base.systemProgramId,
    base.physicalCollection, tokenProgramId];
  if (new Set(roles).size !== roles.length) betaError("INVALID_ARGUMENT", "facade deployment roles alias");
  return Object.freeze({ ...base, tokenProgramId });
}

async function proveTransactionV1Feature(rpc: MimirBetaPlanningRpc): Promise<void> {
  const proof = await new FinalizedRpcReader(rpc).account(MIMIR_BETA_TRANSACTION_V1_FEATURE);
  const account = proof.value;
  if (!account || account.owner !== MIMIR_BETA_TRANSACTION_V1_FEATURE_OWNER || account.executable ||
    account.data.length !== 9 || account.data[0] !== 1) {
    betaError("TRANSACTION_MALFORMED", "finalized Transaction v1 feature account proof is missing or malformed");
  }
  const activationSlot = new DataView(account.data.buffer, account.data.byteOffset + 1, 8).getBigUint64(0, true);
  if (proof.slot < activationSlot) {
    betaError("RPC_CONTEXT_MISMATCH", "Transaction v1 feature proof predates its activation slot");
  }
}

export function createMimirBetaClient(args: CreateMimirBetaClientArgs): MimirBetaClient {
  if (!args || !args.rpc || !args.discovery || !args.identity) {
    betaError("CREATION_CONTEXT_REQUIRED", "client dependencies must be injected");
  }
  const deployment = validateFacadeDeployment(args.deployment);
  for (const key of ["cluster", "mimirProgramId", "agentRegistryProgramId", "mplCoreProgramId", "systemProgramId",
    "physicalCollection", "collectionPointer"] as const) {
    if (args.identity[key] !== deployment[key]) betaError("INVALID_ARGUMENT", "identity adapter deployment mismatch");
  }
  const dependencies = Object.freeze({ deployment, rpc: args.rpc, discovery: args.discovery, identity: args.identity,
    ...(args.abi1Capability ? { abi1Capability: args.abi1Capability } : {}),
    ...(args.consumerAdmission ? { consumerAdmission: args.consumerAdmission } : {}),
    ...(args.abi1ReleaseRecipeScope !== undefined ? { abi1ReleaseRecipeScope: args.abi1ReleaseRecipeScope } : {}) });
  let featureProof: Promise<void> | undefined;
  const requireFeature = (): Promise<void> => featureProof ??= proveTransactionV1Feature(args.rpc);
  const client: MimirBetaClient = {
    listPoolSources: () => args.discovery.listPoolSources(),
    searchSpotPools: (input) => args.discovery.searchSpotPools(input),
    prepareSimpleFeed: async (input) => { await requireFeature(); return prepareMimirBetaSimpleFeed(dependencies, input); },
    prepareCompositeFeed: async (input) => { await requireFeature(); return prepareMimirBetaCompositeFeed(dependencies, input); },
    prepareSimpleFeedConfirmed: async (input, rpc) => { await requireFeature(); return prepareMimirBetaSimpleFeedConfirmed(dependencies, input, rpc); },
    prepareCompositeFeedConfirmed: async (input, rpc) => { await requireFeature(); return prepareMimirBetaCompositeFeedConfirmed(dependencies, input, rpc); },
    prepareCompositeFeedJourney: async (input, rpc) => { await requireFeature(); return prepareMimirBetaCompositeFeedJourney(dependencies, input, rpc); },
    inspectConverterEligibility: (input) => inspectMimirBetaConverterEligibility(dependencies, input),
    prepareClassicRefresh: async (input) => { await requireFeature(); return prepareMimirBetaClassicRefresh(dependencies, input); },
    inspectNativeReadiness: (input) => inspectMimirBetaClassicNativeReadiness(dependencies, input),
    prepareClassicQuietPrime: async (input) => { await requireFeature(); return prepareMimirBetaClassicQuietPrime(dependencies, input); },
    verifyClassicQuietPrime: (prime, minContextSlot) => verifyMimirBetaClassicQuietPrime(dependencies, prime, minContextSlot),
    prepareClassicExecutionAttach: async (input) => { await requireFeature(); return prepareMimirClassicExecutionAttach(dependencies, input); },
    inspectFeedOwnership: (input) => inspectMimirFeedOwnership({
      feed: input.feed,
      minContextSlot: input.minContextSlot,
      deployment,
      rpc: args.rpc,
    }),
    inspectCompositeRevenue: (input) => inspectMimirBetaCompositeRevenue({
      feed: input.feed,
      minContextSlot: input.minContextSlot,
      deployment,
      rpc: args.rpc,
    }),
    prepareCompositeRevenueClaim: async (input) => {
      await requireFeature();
      return prepareMimirBetaCompositeRevenueClaim({ deployment, rpc: args.rpc }, input);
    },
    createCompositeRevenueClaimReceipt: createMimirBetaCompositeRevenueClaimReceipt,
    authenticateCompositeRevenueClaimReceipt: authenticateMimirBetaCompositeRevenueClaimReceipt,
    reconcileCompositeRevenueClaim: (input) => reconcileMimirBetaCompositeRevenueClaim({ ...input, deployment }),
  };
  return Object.freeze(client);
}
