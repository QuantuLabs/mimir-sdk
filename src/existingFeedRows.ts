import { Buffer } from "buffer";
import { PublicKey, type AccountInfo, type Commitment, type Connection } from "@solana/web3.js";
import { address } from "@solana/kit";
import { getMultipleAccountsInfoAndContextChunked } from "./chunkedAccounts.js";
import { SourceAdapterType, type MimirProgramProfile } from "./constants.js";
import { verifySourceConfigHeader } from "./codec.js";
import { decodeSourceConfigHeader } from "./internal/nativeMonoRefreshCore.js";
import { findSourceConfigPda } from "./pda.js";
import { canonicalJson } from "./beta/bytes.js";
import type { MimirBetaPlanningRpc } from "./beta/client.js";
import { mimirBetaCaptureScanDescriptors, mimirBetaCapturePoolCoreLayout } from "./beta/capture.js";
import { createInjectedPoolDiscovery, type MimirBetaEligiblePool, type MimirBetaInjectedPoolDiscovery, type MimirBetaPoolDiscovery } from "./beta/discovery.js";
import { classicRowExternals, loadMimirBetaExistingLiveFeed, nativeTailed, type MimirBetaLiveDependencies } from "./beta/live.js";
import { deriveMimirBetaPda } from "./beta/abi.js";
import { deriveMimirFusedRecipe, type MimirFusedDescriptor, type MimirFusedRow } from "./beta/compositeExecution.js";
import { deriveMimirClassicRecipe } from "./beta/classicExecution.js";
import type { SourceConfigHeader } from "./types.js";
import { MimirBetaError } from "./beta/errors.js";
import { decodeMimirBetaCaptureRpcAccount } from "./beta/rpc.js";

/**
 * Family observer for existing feeds: exact pool rediscovery and the fused external vector per source (adapter roles, plus the
 * source program and ProgramData for a private temporal module). These rows feed tag-88/90 SEAL and tag-87/89 metas.
 */
const CLOCK_SYSVAR_OWNER = new PublicKey("Sysvar1111111111111111111111111111111111111");
const SYSVAR_CLOCK_ID = new PublicKey("SysvarC1ock11111111111111111111111111111111");

function requireAccount(label: string, pubkey: PublicKey, account: AccountInfo<Buffer> | null, owner: PublicKey, lengths: readonly number[]): AccountInfo<Buffer> {
  if (!account) throw new Error(`${label} account missing: ${pubkey.toBase58()}`);
  if (!account.owner.equals(owner)) throw new Error(`${label} owner mismatch`);
  if (account.executable) throw new Error(`${label} account executable`);
  if (!lengths.includes(account.data.length)) throw new Error(`${label} account length mismatch`);
  return account;
}

function requireExactAccount(
  label: string,
  pubkey: PublicKey,
  account: AccountInfo<Buffer> | null,
  owner: PublicKey,
  lengths: readonly number[],
): AccountInfo<Buffer> {
  const exact = requireAccount(label, pubkey, account, owner, lengths);
  if (exact.executable || !lengths.includes(exact.data.length)) {
    throw new Error(`${label} is not a canonical program account`);
  }
  return exact;
}

function web3AccountRpcValue(account: AccountInfo<Buffer> | null): unknown {
  return account === null ? null : {
    data: new Uint8Array(account.data.buffer, account.data.byteOffset, account.data.byteLength),
    executable: account.executable,
    lamports: account.lamports,
    owner: account.owner.toBase58(),
    rentEpoch: account.rentEpoch,
  };
}

function safeRpcSlot(value: bigint | undefined): number | undefined {
  if (value === undefined) return undefined;
  const slot = Number(value);
  if (!Number.isSafeInteger(slot) || slot < 0) throw new Error("MimirRpcSlotOutOfRange");
  return slot;
}

export function createConnectionPlanningRpc(connection: Connection): MimirBetaPlanningRpc {
  const raw = connection as Connection & {
    _rpcRequest(method: string, args: readonly unknown[]): Promise<Readonly<{ result?: unknown; error?: { message?: string } }>>;
  };
  const rpcResult = async (method: string, args: readonly unknown[]) => {
    if (typeof raw._rpcRequest !== "function") throw new Error("MimirConnectionTransportUnavailable");
    const response = await raw._rpcRequest(method, args);
    if (response.error || response.result === undefined) throw new Error(response.error?.message ?? `${method} failed`);
    return response.result;
  };
  return {
    getAccountInfo(key, config) {
      return { send: async () => {
        const value = config as { commitment?: Commitment; minContextSlot?: bigint };
        const response = await connection.getAccountInfoAndContext(new PublicKey(key), {
          commitment: value.commitment, minContextSlot: safeRpcSlot(value.minContextSlot),
        });
        return { context: { slot: response.context.slot }, value: web3AccountRpcValue(response.value) };
      } };
    },
    getMultipleAccounts(keys, config) {
      return { send: async () => {
        const value = config as { commitment?: Commitment; minContextSlot?: bigint; dataSlice?: { offset: number; length: number } };
        const response = await connection.getMultipleAccountsInfoAndContext(keys.map((key) => new PublicKey(key)), {
          commitment: value.commitment, minContextSlot: safeRpcSlot(value.minContextSlot), dataSlice: value.dataSlice,
        });
        return { context: { slot: response.context.slot }, value: response.value.map(web3AccountRpcValue) };
      } };
    },
    getLatestBlockhash(config) {
      return { send: async () => ({ value: await connection.getLatestBlockhash(config.commitment) }) };
    },
    simulateTransaction(wire, config) {
      return { send: () => rpcResult("simulateTransaction", [wire, {
        ...config,
        ...(config.minContextSlot === undefined ? {} : { minContextSlot: safeRpcSlot(config.minContextSlot) }),
      }]) };
    },
  };
}

function clockContextOf(clock: AccountInfo<Buffer> | null, contextSlot: number): string {
  if (!clock || clock.executable || !clock.owner.equals(CLOCK_SYSVAR_OWNER) || clock.data.length !== 40) throw new Error("MimirClockAccountInvalid");
  const view = new DataView(clock.data.buffer, clock.data.byteOffset, clock.data.byteLength);
  const slot = view.getBigUint64(0, true); const unixTimestamp = view.getBigInt64(32, true);
  if (slot !== BigInt(contextSlot) || unixTimestamp < 0n) throw new Error("MimirClockAccountInvalid");
  return canonicalJson({ slot, unixTimestamp });
}

async function clockContext(connection: Connection, commitment: "confirmed" | "finalized"): Promise<string> {
  const response = await getMultipleAccountsInfoAndContextChunked(connection, [SYSVAR_CLOCK_ID], { commitment });
  return clockContextOf(response.value[0]!, response.context.slot);
}

export function exactExistingPoolDiscovery(discovered: readonly Awaited<ReturnType<typeof discoverExactExistingPool>>[]): MimirBetaPoolDiscovery {
  return {
    listPoolSources: async () => { throw new Error("MimirExistingFeedDiscoveryIsExactOnly"); },
    searchSpotPools: async () => { throw new Error("MimirExistingFeedDiscoveryIsExactOnly"); },
    revalidateSelectedPools: async ({ pools, minContextSlot }) => {
      const results = await Promise.all(pools.map((pool, index) => {
        const entry = discovered[index];
        if (!entry || entry.pool !== pool) throw new Error("MimirExistingPoolAuthorityMismatch");
        return entry.discovery.revalidateSelectedPools(canonicalJson({ pools: [pool], minContextSlot } as never));
      }));
      return { slot: results.reduce((slot, result) => result.slot > slot ? result.slot : slot, 0n), pools, freshPools: results.map((result) => result.freshPools[0]!) };
    },
  };
}

export async function discoverExactExistingPool(
  connection: Connection,
  profile: MimirProgramProfile,
  source: SourceConfigHeader,
  commitment: "confirmed" | "finalized",
  batch?: Readonly<{ accounts: ReadonlyMap<string, AccountInfo<Buffer> | null>; context: string; fresh: () => Promise<string> }>,
): Promise<Readonly<{ pool: MimirBetaEligiblePool; discovery: MimirBetaInjectedPoolDiscovery }>> {
  const family = ({ [SourceAdapterType.OrcaWhirlpool]: "orca-whirlpool", [SourceAdapterType.RaydiumClmm]: "raydium-clmm",
    [SourceAdapterType.RaydiumCpmm]: "raydium-cpmm", [SourceAdapterType.MeteoraDlmm]: "meteora-dlmm",
    [SourceAdapterType.MeteoraDammV2]: "meteora-damm-v2", [SourceAdapterType.RaydiumAmmV4]: "raydium-amm-v4",
    [SourceAdapterType.PumpSwap]: "pumpswap" } as Partial<Record<number, string>>)[source.adapterType];
  if (!family) throw new Error("MimirExistingNativeFeedRequiresOneAuthenticatedSource");
  const pool = new PublicKey(source.poolOrMarket);
  const program = new PublicKey(source.programId);
  const descriptors = mimirBetaCaptureScanDescriptors(profile.cluster === "mainnet" ? "mainnet-beta" : profile.cluster).filter((entry) => entry.family === family);
  if (descriptors.length === 0) throw new Error(`MimirSourceFamilyUnavailableOnCluster:${family}:${profile.cluster}`);
  const serializedLayouts = canonicalJson(descriptors.map(mimirBetaCapturePoolCoreLayout).map((layout) =>
    Object.fromEntries(Object.entries(layout).filter(([, value]) => value !== undefined))) as never);
  const accountAt = async (key: PublicKey) => {
    const account = batch ? batch.accounts.get(key.toBase58()) ?? null : await connection.getAccountInfo(key, commitment);
    if (!account) throw new Error(`MimirExistingPoolAccountMissing:${key.toBase58()}`);
    return account;
  };
  let first = batch?.context;
  const discovery = createInjectedPoolDiscovery({
    cluster: profile.cluster === "mainnet" ? "mainnet-beta" : profile.cluster,
    evidenceTtlSlots: 32n,
    maxScanResultsPerFamily: 1,
    existingFeed: true,
    sources: [{
      layouts: serializedLayouts,
      loadProgram: async () => canonicalJson({ executable: (await accountAt(program)).executable }),
      scan: async () => {
        const account = await accountAt(pool);
        return canonicalJson([{ address: address(pool.toBase58()), owner: address(account.owner.toBase58()),
          data: Uint8Array.from(account.data) }] as never);
      },
    }],
    getContext: async () => {
      if (!batch) return clockContext(connection, commitment);
      const context = first ?? await batch.fresh();
      first = undefined;
      return context;
    },
    loadCapturePlanAccounts: async ({ minContextSlot, plans }) => {
      const keys = [...new Set(plans.flatMap((entry) => [...entry.addresses]))];
      const response = await getMultipleAccountsInfoAndContextChunked(connection, keys.map((key) => new PublicKey(key)), {
        commitment, minContextSlot: safeRpcSlot(minContextSlot),
      });
      return canonicalJson({ contextSlot: BigInt(response.context.slot), accounts: response.value.map((account, index) => {
        if (!account) {
          const { owner, executable, data } = decodeMimirBetaCaptureRpcAccount(address(keys[index]!), null);
          return { address: keys[index]!, owner, executable, data };
        }
        return { address: keys[index]!, owner: address(account.owner.toBase58()), executable: account.executable, data: Uint8Array.from(account.data) };
      }) } as never);
    },
  });
  const result = await discovery.searchSpotPools(canonicalJson({ baseMint: address(new PublicKey(source.baseMint).toBase58()),
    quoteMint: address(new PublicKey(source.quoteMint).toBase58()), query: pool.toBase58(), maxPools: 1 }));
  const matches = result.recommendedPools.filter((entry) => entry.pool === pool.toBase58());
  if (matches.length !== 1) throw new Error("MimirExistingPoolAuthorityMismatch");
  return Object.freeze({ pool: matches[0]!, discovery });
}

/**
 * Fused rows of an existing classic feed's sources, in source-index order. CPMM composite components keep their 4-role spot vector.
 * With `descriptors` (sealed, aligned with the returned rows) every row is rehydrated from its descriptor: native tails, routeable
 * DLMM edges, temporal tails and Orca generation pins.
 */
export async function buildMimirExistingFeedFusedRows(args: Readonly<{ connection: Connection; profile: MimirProgramProfile; feedId: Uint8Array;
  role: "component" | "composite-converter" | "primary" | "converter"; sourceIndex?: number; commitment?: "confirmed" | "finalized";
  descriptors?: readonly MimirFusedDescriptor[] }>): Promise<readonly MimirFusedRow[]> {
  const { connection, profile } = args; const commitment = args.commitment ?? "confirmed";
  const feedId = Buffer.from(args.feedId);
  const keys = Array.from({ length: 5 }, (_, index) => findSourceConfigPda(feedId, index, profile.programId)[0]);
  const infos = await connection.getMultipleAccountsInfo(keys, commitment);
  const sources = infos.flatMap((account, index) => {
    if (account === null) return [];
    const source = decodeSourceConfigHeader(requireExactAccount("SourceConfig", keys[index]!, account, profile.programId, [384]).data);
    verifySourceConfigHeader(source, feedId, index);
    return [source];
  });
  if (!sources.length || sources.some((source, index) => source.sourceIndex !== index) || (args.sourceIndex !== undefined && !sources[args.sourceIndex])) {
    throw new Error("MimirExistingFeedConfiguredSourceSetMismatch");
  }
  const cohortKeys = [...new Set(sources.flatMap((source) => [new PublicKey(source.programId).toBase58(), new PublicKey(source.poolOrMarket).toBase58()])),
    SYSVAR_CLOCK_ID.toBase58()];
  const cohort = await getMultipleAccountsInfoAndContextChunked(connection, cohortKeys.map((key) => new PublicKey(key)), { commitment });
  const accounts = new Map(cohortKeys.map((key, index) => [key, cohort.value[index] ?? null]));
  const batch = { accounts, context: clockContextOf(accounts.get(SYSVAR_CLOCK_ID.toBase58())!, cohort.context.slot),
    fresh: () => clockContext(connection, commitment) };
  const discovered = await Promise.all(sources.map((source) => discoverExactExistingPool(connection, profile, source, commitment, batch)));
  const programId = address(profile.programId.toBase58());
  const dependencies = { deployment: { cluster: profile.cluster === "mainnet" ? "mainnet-beta" : profile.cluster, mimirProgramId: programId },
    rpc: createConnectionPlanningRpc(connection), discovery: exactExistingPoolDiscovery(discovered) } as MimirBetaLiveDependencies;
  const pools = discovered.map((entry) => entry.pool);
  const captured = pools.length === 1 && pools[0]!.observedSlot >= BigInt(cohort.context.slot) ? pools[0]!.observedSlot : undefined;
  const loaded = await loadMimirBetaExistingLiveFeed(dependencies, pools, undefined, false, commitment, "mixed-bounded-v1",
    args.descriptors?.some(nativeTailed) ?? false, address(new PublicKey(feedId).toBase58()), false, [], captured);
  if (args.role === "converter" && loaded.belowFloorSources.length) {
    throw new MimirBetaError("SOURCE_BELOW_FLOOR_UNPUBLISHABLE", `${args.role} source ${loaded.belowFloorSources[0]} is below its configured floor`);
  }
  const below = (i: number) => loaded.belowFloorSources.includes(i) ? { belowFloor: true as const } : {};
  const indices = args.sourceIndex === undefined ? sources.map((_, i) => i) : [args.sourceIndex];
  if (args.descriptors && args.descriptors.length !== indices.length) throw new Error("ExecutionDefinitionMismatch: row count");
  return Promise.all(indices.map(async (i, row) => {
    const sealed = args.descriptors?.[row];
    if (sealed) {
      const { moduleOffset: _o, moduleLength: _l, ...recipe } = sealed; const state = loaded.sourceStates[i]!; const artifact = loaded.artifacts.artifacts[i]!;
      return { ...below(i), observed: loaded.rows, recipe, externals: classicRowExternals([sealed], { ...loaded, adapterAccounts: [loaded.adapterAccounts[i]!] })[0]!,
        sourceConfig: artifact.sourceConfig, feedConfig: loaded.pdas.feed[0], sourcingPlan: loaded.pdas.sourcingPlan[0],
        witness: { feedId: Uint8Array.from(feedId), sourceIndex: i, ringVersion: loaded.plan.ringVersion, minSlotGap: sealed.minSlotGap,
          expectedSourceConfigRevision: state.source.sourceConfigRevision, expectedSourceSetRevision: state.source.sourceSetRevision,
          expectedPlanHash: loaded.plan.planHash, sourceSetSiblings: artifact.sourceRootProof, accountsSiblings: artifact.accountRootProof } };
    }
    const pool = pools[i]!; const artifact = loaded.artifacts.artifacts[i]!; const state = loaded.sourceStates[i]!; const temporal = loaded.mixedTemporal[i];
    const point = sources[i]!.temporalMode === "current-point";
    const t = pool.creation.adapterType; const v = pool.creation.adapterVersion;
    const cpmmComponent = args.role === "component" && t === 2;
    const adapter = cpmmComponent ? loaded.adapterAccounts[i]!.slice(0, 4) : loaded.adapterAccounts[i]!;
    const withModule = temporal && !cpmmComponent;
    const externals = withModule ? [...adapter, temporal!.sourceProgram, temporal!.sourceProgramData] : [...adapter];
    let temporalModuleVersion: number | undefined;
    if (withModule) {
      for (const version of [1, 2, 3, 4]) {
        const [pda] = await deriveMimirBetaPda({ programId, seed: "source_temporal", values: [feedId, Uint8Array.of(i), Uint8Array.of(version, 0)] });
        if (pda === temporal!.module[0]) temporalModuleVersion = version;
      }
      if (temporalModuleVersion === undefined) throw new Error("UnsupportedCompositeExecutionRecipe: unknown temporal module");
    }
    const minSlotGap = point ? 0 : 1;
    const recipeArgs = { adapterType: t, adapterVersion: v, externalWidth: externals.length, currentPoint: point, minSlotGap,
      ...(temporalModuleVersion !== undefined ? { temporalModuleVersion } : {}) };
    const recipe = args.role === "component" || args.role === "composite-converter"
      ? deriveMimirFusedRecipe({ ...recipeArgs, role: args.role === "component" ? "component" : "converter", accountsBindingVersion: loaded.plan.accountsBindingVersion })
      : deriveMimirClassicRecipe({ ...recipeArgs, role: args.role, accountsBindingVersion: loaded.plan.accountsBindingVersion });
    return { ...below(i), recipe, externals, sourceConfig: artifact.sourceConfig, feedConfig: loaded.pdas.feed[0], sourcingPlan: loaded.pdas.sourcingPlan[0],
      witness: { feedId: Uint8Array.from(feedId), sourceIndex: i, ringVersion: loaded.plan.ringVersion, minSlotGap,
        expectedSourceConfigRevision: state.source.sourceConfigRevision, expectedSourceSetRevision: state.source.sourceSetRevision,
        expectedPlanHash: loaded.plan.planHash, sourceSetSiblings: artifact.sourceRootProof, accountsSiblings: artifact.accountRootProof } };
  }));
}

export type { SourceConfigHeader, MimirBetaEligiblePool, MimirBetaInjectedPoolDiscovery, MimirBetaPlanningRpc, AccountInfo, Commitment };
