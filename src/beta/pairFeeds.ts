import type { Address } from "@solana/kit";
import { deriveMimirBetaClassicFeedId, deriveMimirBetaFeedPdas, deriveMimirBetaPda, recoverMimirBetaFeedVariantAsync } from "./abi.js";
import { addressBytes, base64, bytesAddress, utf8 } from "./bytes.js";
import { decodeMimirClassicConfig } from "./codecs.js";
import { betaError } from "./errors.js";
import { decodeMimirBetaLivePlan, decodeMimirBetaLiveSource } from "./liveAbi.js";
import { decodeFeedSnapshotHeader } from "../internal/nativeMonoRefreshCore.js";
import { readMimirBetaAccountCohort, type MimirBetaFinalizedRpc } from "./rpc.js";
import type { MimirBetaAccount } from "./types.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const DRAWS = 8;

/** The five final PDAs activation requires uninitialized for `feed_id(base, quote, variant)`. */
export async function deriveMimirBetaVariantFinalPdas(programId: Address, baseMint: Address, quoteMint: Address, variant: number): Promise<readonly Address[]> {
  const feedId = await deriveMimirBetaClassicFeedId(baseMint, quoteMint, variant);
  const pdas = await deriveMimirBetaFeedPdas({ programId, feedId });
  return [pdas.feed[0], pdas.sourcingPlan[0], pdas.twap[0], pdas.snapshot[0], pdas.collateralLock[0]];
}

/** `is_lifecycle_uninitialized_account`: system-owned, empty and not executable; lamports alone do not occupy. */
export function isMimirBetaLifecycleUninitialized(account: MimirBetaAccount | null): boolean {
  return account === null || (account.owner === SYSTEM_PROGRAM && account.data.length === 0 && !account.executable);
}

/** R-FREE: occupied iff any of the five final PDAs is initialized. Pending proposals never occupy. */
export async function isMimirBetaVariantOccupied(args: {
  readonly rpc: MimirBetaFinalizedRpc; readonly programId: Address; readonly baseMint: Address; readonly quoteMint: Address; readonly variant: number;
}): Promise<boolean> {
  const addresses = await deriveMimirBetaVariantFinalPdas(args.programId, args.baseMint, args.quoteMint, args.variant);
  const read = await readMimirBetaAccountCohort(args.rpc, addresses, "finalized");
  return !read.value.every(isMimirBetaLifecycleUninitialized);
}

/**
 * Resolves `variant: "new"`: v0 when allowed and free; otherwise one draw from the indexer's complement (confirmed by R-FREE)
 * or up to eight CSPRNG draws checked in a single read. `VARIANT_UNAVAILABLE` only when every draw is occupied.
 */
export async function findFreeMimirBetaFeedVariant(args: {
  readonly rpc: MimirBetaFinalizedRpc; readonly programId: Address; readonly baseMint: Address; readonly quoteMint: Address;
  readonly allowV0: boolean; readonly randomU16?: () => number; readonly indexerOccupied?: readonly number[];
  readonly preferProposalFree?: (variant: number) => boolean;
}): Promise<number> {
  const random = args.randomU16 ?? (() => globalThis.crypto.getRandomValues(new Uint16Array(1))[0]!);
  const draw = (exclude: ReadonlySet<number>) => {
    if (exclude.size >= 0xffff) betaError("VARIANT_UNAVAILABLE", "every feed variant is occupied");
    for (;;) { const v = random() & 0xffff; if (v !== 0 && !exclude.has(v)) return v; }
  };
  const candidates = [...(args.allowV0 ? [0] : [])];
  const occupied = new Set((args.indexerOccupied ?? []).filter((v) => Number.isInteger(v) && v >= 1 && v <= 0xffff));
  if (args.indexerOccupied && occupied.size < 0xffff) {
    candidates.push(draw(occupied));
  } else {
    const seen = new Set<number>();
    while (seen.size < DRAWS) seen.add(draw(seen));
    candidates.push(...seen);
  }
  const pdas = await Promise.all(candidates.map(v => deriveMimirBetaVariantFinalPdas(args.programId, args.baseMint, args.quoteMint, v)));
  const read = await readMimirBetaAccountCohort(args.rpc, pdas.flat(), "finalized");
  const free = candidates.filter((_, i) => read.value.slice(i * 5, i * 5 + 5).every(isMimirBetaLifecycleUninitialized));
  if (free.length === 0) betaError("VARIANT_UNAVAILABLE", "every drawn feed variant is occupied");
  if (free[0] === 0) return 0;
  return (args.preferProposalFree && free.find(args.preferProposalFree)) ?? free[0]!;
}

export interface MimirBetaPairFeed {
  readonly feedId: Address;
  readonly feedConfig: Address;
  readonly variant: number;
  readonly ticker: string | null;
  readonly lifecycleState: number;
  readonly riskTier: number;
  readonly minSourceCount: number;
  readonly minVenueCount: number;
  readonly minCorrelationGroupCount: number;
  /** Source configs present at indices 0..4 of the authenticated closure. */
  readonly configuredSourceCount: number;
  readonly pools: readonly Address[];
  /** Adapter type of each configured source, aligned with `pools`; -1 when the source codec rejects it. */
  readonly adapterTypes: readonly number[];
  readonly planProfile: number | null;
  /** Latest decoded publication (any status: FRESH, DEGRADED, HALTED); null when never published or unreadable. */
  readonly publication: Readonly<{ status: number; snapshotSource: number; snapshotSlot: bigint; validUntilSlot: bigint; bandCapitalNotional: bigint }> | null;
}

/** Indexer `/internal/feeds` rows; only `feedConfig` and the pair are used, every row is re-authenticated on chain. */
export interface MimirBetaIndexerFeedRow {
  readonly feedConfig: string;
  readonly baseMint: string;
  readonly quoteMint: string;
  readonly pairKey?: string;
}

/** Minimal `getProgramAccounts` surface (Kit shape, base64 encoding). */
export interface MimirBetaProgramAccountsRpc {
  getProgramAccounts(programId: Address, config: object): { send(): Promise<unknown> };
}

const memcmp = (offset: number, bytes: Uint8Array) => ({ memcmp: { offset: BigInt(offset), bytes: base64(bytes), encoding: "base64" } });

async function programAccountAddresses(rpc: MimirBetaProgramAccountsRpc, programId: Address, filters: readonly object[]): Promise<Address[]> {
  const rows = await rpc.getProgramAccounts(programId, { commitment: "finalized", encoding: "base64", dataSlice: { offset: 0, length: 0 }, filters }).send();
  const list = Array.isArray(rows) ? rows : (rows as { value?: unknown }).value;
  if (!Array.isArray(list)) betaError("RPC_CONTEXT_MISMATCH", "getProgramAccounts returned no list");
  return list.map((row: { pubkey: Address }) => row.pubkey);
}

/** Fetches the indexer catalogue rows of one pair from `GET {url}/internal/feeds`. */
export async function fetchMimirBetaIndexerPairFeeds(args: {
  readonly url: string; readonly baseMint: Address; readonly quoteMint: Address; readonly fetch?: typeof globalThis.fetch;
}): Promise<readonly MimirBetaIndexerFeedRow[]> {
  const response = await (args.fetch ?? globalThis.fetch)(`${args.url.replace(/\/$/, "")}/internal/feeds`);
  const body = await response.json() as { success?: boolean; data?: MimirBetaIndexerFeedRow[] };
  if (!response.ok || body.success !== true || !Array.isArray(body.data)) betaError("RPC_CONTEXT_MISMATCH", "indexer feed catalogue unavailable");
  return body.data.filter((row) => row.baseMint === args.baseMint && row.quoteMint === args.quoteMint);
}

/**
 * Every authenticated classic feed of `(baseMint, quoteMint)`, ordered by SPEC 5.2. Candidates come from the indexer rows when given,
 * else from getProgramAccounts; each is re-read, owner- and PDA-checked, decoded, and its variant recovered.
 */
export async function listMimirBetaPairFeeds(args: {
  readonly rpc: MimirBetaFinalizedRpc & Partial<MimirBetaProgramAccountsRpc>; readonly programId: Address;
  readonly baseMint: Address; readonly quoteMint: Address; readonly indexerFeeds?: readonly MimirBetaIndexerFeedRow[];
}): Promise<readonly MimirBetaPairFeed[]> {
  let candidates: Address[];
  if (args.indexerFeeds) {
    candidates = args.indexerFeeds.filter((row) => row.baseMint === args.baseMint && row.quoteMint === args.quoteMint).map((row) => row.feedConfig as Address);
  } else {
    if (!args.rpc.getProgramAccounts) betaError("INVALID_ARGUMENT", "pair feed listing needs an indexer or getProgramAccounts");
    const pair = [memcmp(0, utf8("MIMIRCFG")), memcmp(48, addressBytes(args.baseMint)), memcmp(80, addressBytes(args.quoteMint))];
    candidates = (await Promise.all([357, 325].map((dataSize) =>
      programAccountAddresses(args.rpc as MimirBetaProgramAccountsRpc, args.programId, [{ dataSize: BigInt(dataSize) }, ...pair])))).flat();
  }
  candidates = [...new Set(candidates)];
  if (candidates.length === 0) return [];
  const read = await readMimirBetaAccountCohort(args.rpc, candidates, "finalized");
  const feeds: Omit<MimirBetaPairFeed, "configuredSourceCount" | "pools" | "adapterTypes" | "planProfile" | "publication">[] = [];
  for (const [index, account] of read.value.entries()) {
    if (!account || account.owner !== args.programId) continue;
    let config;
    try { config = decodeMimirClassicConfig(account.data, true); } catch { continue; }
    if (config.baseMint !== args.baseMint || config.quoteMint !== args.quoteMint) continue;
    const [pda] = await deriveMimirBetaPda({ programId: args.programId, seed: "feed_config", values: [addressBytes(config.feedId)] });
    const variant = pda === candidates[index] ? await recoverMimirBetaFeedVariantAsync(args.baseMint, args.quoteMint, config.feedId) : null;
    if (variant === null) continue;
    const d = account.data;
    feeds.push({ feedId: config.feedId, feedConfig: pda, variant, ticker: config.ticker, lifecycleState: d[117]!, riskTier: d[116]!,
      minSourceCount: d[120]!, minVenueCount: d[121]!, minCorrelationGroupCount: d[122]! });
  }
  const closures = await Promise.all(feeds.map(async (feed) => {
    const pdas = await deriveMimirBetaFeedPdas({ programId: args.programId, feedId: feed.feedId });
    const sources = await Promise.all([0, 1, 2, 3, 4].map(async (index) => (await deriveMimirBetaPda({ programId: args.programId,
      seed: "source_config", values: [addressBytes(feed.feedId), Uint8Array.of(index)] }))[0]));
    return [pdas.sourcingPlan[0], pdas.snapshot[0], ...sources];
  }));
  const closureRead = feeds.length ? await readMimirBetaAccountCohort(args.rpc, closures.flat(), "finalized") : null;
  const listed: MimirBetaPairFeed[] = await Promise.all(feeds.map(async (feed, index) => {
    const [plan, snapshot, ...sources] = closureRead!.value.slice(index * 7, index * 7 + 7);
    const owned = (account: MimirBetaAccount | null | undefined): account is MimirBetaAccount => !!account && account.owner === args.programId && !account.executable;
    const id = addressBytes(feed.feedId);
    const configured = sources.filter((source, sourceIndex) => owned(source) && source.data.length === 384 &&
      bytesAddress(source.data.subarray(16, 48)) === feed.feedId && source.data[48] === sourceIndex && utf8("MIMIRSRC").every((b, i) => source.data[i] === b));
    let planProfile: number | null = null;
    try { if (owned(plan)) { const decoded = await decodeMimirBetaLivePlan(plan.data); if (compare(decoded.feedId, id) === 0) planProfile = decoded.profile; } } catch { planProfile = null; }
    let publication: MimirBetaPairFeed["publication"] = null;
    try {
      if (owned(snapshot)) {
        const header = decodeFeedSnapshotHeader(snapshot.data);
        if (compare(header.feedId, id) === 0 && header.snapshotRevision > 0n) publication = { status: header.status, snapshotSource: header.snapshotSource, snapshotSlot: header.snapshotSlot,
          validUntilSlot: header.validUntilSlot, bandCapitalNotional: header.bandCapitalNotional };
      }
    } catch { publication = null; }
    return { ...feed, configuredSourceCount: configured.length, pools: configured.map((source) => bytesAddress(source!.data.subarray(136, 168))),
      adapterTypes: configured.map((source) => { try { return decodeMimirBetaLiveSource(source!.data).adapterType; } catch { return -1; } }),
      planProfile, publication };
  }));
  const bytes = (feed: MimirBetaPairFeed) => addressBytes(feed.feedId);
  return listed.sort((a, b) => Number(b.lifecycleState === ACTIVE) - Number(a.lifecycleState === ACTIVE) || b.riskTier - a.riskTier ||
    b.minSourceCount - a.minSourceCount || b.configuredSourceCount - a.configuredSourceCount || b.minVenueCount - a.minVenueCount || b.minCorrelationGroupCount - a.minCorrelationGroupCount ||
    Number(b.variant === 0) - Number(a.variant === 0) || compare(bytes(a), bytes(b)));
}

/** Source configs bound to `pool` (gPA `dataSize 384`, `MIMIRSRC`, `memcmp(136, pool)`), owner- and PDA-checked. */
export async function findMimirBetaFeedsByPool(args: {
  readonly rpc: MimirBetaFinalizedRpc & MimirBetaProgramAccountsRpc; readonly programId: Address; readonly pool: Address;
}): Promise<readonly { readonly feedId: Address; readonly sourceConfig: Address; readonly sourceIndex: number }[]> {
  const addresses = [...new Set(await programAccountAddresses(args.rpc, args.programId,
    [{ dataSize: 384n }, memcmp(0, utf8("MIMIRSRC")), memcmp(136, addressBytes(args.pool))]))];
  if (addresses.length === 0) return [];
  const read = await readMimirBetaAccountCohort(args.rpc, addresses, "finalized");
  const out = [];
  for (const [index, account] of read.value.entries()) {
    if (!account || account.owner !== args.programId || account.data.length !== 384) continue;
    const feedId = bytesAddress(account.data.subarray(16, 48)); const sourceIndex = account.data[48]!;
    const [pda] = await deriveMimirBetaPda({ programId: args.programId, seed: "source_config", values: [addressBytes(feedId), Uint8Array.of(sourceIndex)] });
    if (pda === addresses[index] && bytesAddress(account.data.subarray(136, 168)) === args.pool) out.push({ feedId, sourceConfig: pda, sourceIndex });
  }
  return out;
}

const ACTIVE = 3;
function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
