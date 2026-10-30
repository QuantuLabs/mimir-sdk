import { address, getProgramDerivedAddress, type Address } from "@solana/kit";
import { addressBytes, bytesEqual, utf8 } from "./bytes.js";
import { decodeMimirClassicConfig, decodeMimirCompositeConfig } from "./codecs.js";
import { validateMimirBetaDeployment, type MimirBetaDeployment } from "./deployment.js";
import { MimirBetaError } from "./errors.js";
import {
  createMimir8004IdentityAdapter,
  decodeMimir8004AgentAccount,
  decodeMimir8004DisplayNameMetadata,
  decodeMimir8004RegistryConfig,
  decodeMimir8004RootConfig,
  verifyMimir8004ConfigPdas,
  type Mimir8004IdentityAdapter,
} from "./identity8004.js";
import { decodeMimirBetaCoreAsset, decodeMimirBetaCoreCollection } from "./mplCore.js";
import { FinalizedRpcReader, type MimirBetaFinalizedRpc } from "./rpc.js";
import type { MimirBetaAccount, MimirBetaFeedOwnership } from "./types.js";

const CLASSIC_MAGIC = utf8("MIMIRCFG");
export interface InspectMimirFeedOwnershipArgs {
  readonly feed: Address;
  readonly deployment: MimirBetaDeployment;
  readonly rpc: MimirBetaFinalizedRpc;
  readonly minContextSlot?: bigint;
}

export interface MimirBetaFeedOwnershipResult extends MimirBetaFeedOwnership {
  readonly baseMint: Address | null;
  readonly quoteMint: Address | null;
}

type Discovery = {
  readonly kind: "classic" | "composite";
  readonly feedId: Address;
  readonly identityAsset: Address | null;
  readonly baseMint: Address | null;
  readonly quoteMint: Address;
};

function decodeDiscovery(account: MimirBetaAccount, deployment: MimirBetaDeployment): Discovery {
  if (account.owner !== deployment.mimirProgramId || account.executable) {
    throw new MimirBetaError("ACCOUNT_OWNER_MISMATCH", "feed account owner mismatch");
  }
  if (bytesEqual(account.data.subarray(0, 8), CLASSIC_MAGIC)) {
    const decoded = decodeMimirClassicConfig(account.data);
    return { kind: "classic", feedId: decoded.feedId, identityAsset: decoded.identityAsset,
      baseMint: decoded.baseMint, quoteMint: decoded.quoteMint };
  }
  const decoded = decodeMimirCompositeConfig(account.data);
  if (decoded.components.length < 1) {
    throw new MimirBetaError("ACCOUNT_MALFORMED", "Composite requires 1..5 components");
  }
  return { kind: "composite", feedId: decoded.feedId, identityAsset: decoded.identityAsset,
    baseMint: null, quoteMint: decoded.quoteMint };
}

function result(
  deployment: MimirBetaDeployment,
  feed: Address,
  observedSlot: bigint,
  values: Partial<MimirBetaFeedOwnershipResult>,
): MimirBetaFeedOwnershipResult {
  return {
    cluster: deployment.cluster,
    feed,
    feedKind: null,
    immutableCreator: null,
    identityAsset: null,
    liveCoreOwner: null,
    displayName: null,
    baseMint: null,
    quoteMint: null,
    observedSlot,
    verificationStatus: "unverified",
    failureCode: "ACCOUNT_MALFORMED",
    ...values,
  };
}

async function derive(
  programAddress: Address,
  seed: string,
  feedId: Address,
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({ programAddress, seeds: [utf8(seed), addressBytes(feedId)] });
}

async function verifySnapshot(args: {
  readonly deployment: MimirBetaDeployment;
  readonly adapter: Mimir8004IdentityAdapter;
  readonly feed: Address;
  readonly slot: bigint;
  readonly addresses: readonly Address[];
  readonly accounts: readonly (MimirBetaAccount | null)[];
  readonly discovery: Discovery;
}): Promise<MimirBetaFeedOwnershipResult> {
  const byAddress = new Map(args.addresses.map((address, index) => [address, args.accounts[index]!] as const));
  const feedAccount = byAddress.get(args.feed) ?? null;
  if (!feedAccount) return result(args.deployment, args.feed, args.slot, { verificationStatus: "not-found", failureCode: "ACCOUNT_NOT_FOUND" });

  let kind: "classic" | "composite" = args.discovery.kind;
  let immutableCreator: Address | null = null;
  let identityAsset: Address | null = null;
  try {
    const finalDiscovery = decodeDiscovery(feedAccount, args.deployment);
    kind = finalDiscovery.kind;
    identityAsset = finalDiscovery.identityAsset;
    if (kind !== args.discovery.kind || finalDiscovery.feedId !== args.discovery.feedId ||
      identityAsset !== args.discovery.identityAsset || finalDiscovery.baseMint !== args.discovery.baseMint ||
      finalDiscovery.quoteMint !== args.discovery.quoteMint) {
      throw new MimirBetaError("RPC_CONTEXT_MISMATCH", "feed changed between discovery and coherent read");
    }
    const [expectedFeed, expectedFeedBump] = await derive(
      args.deployment.mimirProgramId,
      kind === "classic" ? "feed_config" : "composite_feed_config",
      finalDiscovery.feedId,
    );
    const decoded = kind === "classic" ? decodeMimirClassicConfig(feedAccount.data) : decodeMimirCompositeConfig(feedAccount.data);
    if (expectedFeed !== args.feed || decoded.bump !== expectedFeedBump) {
      throw new MimirBetaError("PDA_MISMATCH", "feed PDA mismatch");
    }

    if (kind === "composite") {
      immutableCreator = decodeMimirCompositeConfig(feedAccount.data).creator;
    }

    if (identityAsset === null) {
      throw new MimirBetaError("ACCOUNT_MALFORMED", "feed has no identity asset");
    }

    const [[rootAddress], [registryAddress], [agentAddress], [metadataAddress]] = await Promise.all([
      args.adapter.deriveRootConfig(),
      args.adapter.deriveRegistryConfig(),
      args.adapter.deriveAgentAccount(identityAsset),
      args.adapter.deriveDisplayNameMetadata(identityAsset),
    ]);
    const identityAddresses = [rootAddress, registryAddress, agentAddress, args.deployment.physicalCollection, identityAsset];
    if (kind === "composite") identityAddresses.push(metadataAddress);
    const required = identityAddresses
      .map((requiredAddress) => byAddress.get(requiredAddress) ?? null);
    if (required.some((account) => !account)) throw new MimirBetaError("ACCOUNT_NOT_FOUND", "identity account not found");
    const [rootAccount, registryAccount, agentAccount, collectionAccount, assetAccount] = required as readonly MimirBetaAccount[];
    if (rootAccount.owner !== args.deployment.agentRegistryProgramId || registryAccount.owner !== args.deployment.agentRegistryProgramId ||
      agentAccount.owner !== args.deployment.agentRegistryProgramId || rootAccount.executable || registryAccount.executable || agentAccount.executable) {
      throw new MimirBetaError("ACCOUNT_OWNER_MISMATCH", "8004 account owner mismatch");
    }
    const root = decodeMimir8004RootConfig(rootAccount.data);
    const registry = decodeMimir8004RegistryConfig(registryAccount.data);
    const agent = decodeMimir8004AgentAccount(agentAccount.data);
    await verifyMimir8004ConfigPdas({ adapter: args.adapter, rootAddress, root, registryAddress, registry });
    const [, expectedAgentBump] = await args.adapter.deriveAgentAccount(identityAsset);
    if (kind === "classic") immutableCreator = agent.creator;
    if (agent.bump !== expectedAgentBump || agent.asset !== identityAsset ||
      (kind === "composite" && agent.creator !== immutableCreator) ||
      agent.collection !== args.deployment.physicalCollection || agent.atomEnabled || !agent.collectionPointerLocked ||
      agent.collectionPointer !== args.deployment.collectionPointer) {
      throw new MimirBetaError("IDENTITY_UNVERIFIED", "8004 identity mismatch");
    }
    const collection = decodeMimirBetaCoreCollection(collectionAccount, args.deployment);
    const asset = decodeMimirBetaCoreAsset(assetAccount, args.deployment, identityAsset);
    if (asset.collection !== args.deployment.physicalCollection || collection.updateAuthority !== registryAddress) {
      throw new MimirBetaError("IDENTITY_UNVERIFIED", "Core identity mismatch");
    }
    let displayName: string | null = null;
    if (kind === "composite") {
      const metadataAccount = byAddress.get(metadataAddress) ?? null;
      if (!metadataAccount) throw new MimirBetaError("ACCOUNT_NOT_FOUND", "display-name metadata not found");
      if (metadataAccount.owner !== args.deployment.agentRegistryProgramId || metadataAccount.executable) {
        throw new MimirBetaError("ACCOUNT_OWNER_MISMATCH", "display-name metadata owner mismatch");
      }
      const metadata = decodeMimir8004DisplayNameMetadata(metadataAccount.data);
      const [, expectedMetadataBump] = await args.adapter.deriveDisplayNameMetadata(identityAsset);
      if (metadata.asset !== identityAsset || metadata.bump !== expectedMetadataBump) {
        throw new MimirBetaError("IDENTITY_UNVERIFIED", "display-name metadata identity mismatch");
      }
      displayName = metadata.displayName;
    }
    return result(args.deployment, args.feed, args.slot, {
      feedKind: kind,
      immutableCreator,
      identityAsset,
      liveCoreOwner: asset.liveOwner,
      displayName,
      baseMint: finalDiscovery.baseMint,
      quoteMint: finalDiscovery.quoteMint,
      verificationStatus: "verified",
      failureCode: null,
    });
  } catch (error) {
    return result(args.deployment, args.feed, args.slot, {
      feedKind: kind,
      immutableCreator,
      identityAsset,
      failureCode: error instanceof MimirBetaError ? error.code : "ACCOUNT_MALFORMED",
    });
  }
}

export async function inspectMimirFeedOwnership(args: InspectMimirFeedOwnershipArgs): Promise<MimirBetaFeedOwnershipResult> {
  const deployment = validateMimirBetaDeployment(args.deployment);
  const feed = address(args.feed);
  const reader = new FinalizedRpcReader(args.rpc);
  const discoveryRead = await reader.account(feed, args.minContextSlot);
  if (!discoveryRead.value) {
    return result(deployment, feed, discoveryRead.slot, { verificationStatus: "not-found", failureCode: "ACCOUNT_NOT_FOUND" });
  }

  let discovery: Discovery;
  try {
    discovery = decodeDiscovery(discoveryRead.value, deployment);
  } catch (error) {
    return result(deployment, feed, discoveryRead.slot, {
      failureCode: error instanceof MimirBetaError ? error.code : "ACCOUNT_MALFORMED",
    });
  }

  const adapter = createMimir8004IdentityAdapter(deployment);
  const addresses: Address[] = [feed];
  if (discovery.identityAsset !== null) {
    const [[root], [registry], [agent], [metadata]] = await Promise.all([
      adapter.deriveRootConfig(),
      adapter.deriveRegistryConfig(),
      adapter.deriveAgentAccount(discovery.identityAsset),
      adapter.deriveDisplayNameMetadata(discovery.identityAsset),
    ]);
    addresses.push(root, registry, agent, deployment.physicalCollection, discovery.identityAsset);
    if (discovery.kind === "composite") addresses.push(metadata);
  }
  const coherent = await reader.accounts(addresses, discoveryRead.slot);
  return verifySnapshot({ deployment, adapter, feed, slot: coherent.slot, addresses, accounts: coherent.value, discovery });
}
