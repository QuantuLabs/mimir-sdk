import { address, getAddressDecoder, type Address } from '@solana/kit';
import type { MimirBetaEligiblePool } from '../beta/discovery.js';
import type { MimirBetaInstruction } from '../beta/types.js';
import type { PrepareSimpleFeedArgs } from '../beta/creation.js';
import { meteoraDlmmPriceFromIdX64, normalizedDirectQ64PriceX64, squareQ64ToX64 } from '../math.js';

/** The compute a transaction reserves: 1.2× its simulated units rounded up to 1,000, plus 10,000 for wallet-appended guard instructions, at least 20,000; `fallback` when no units were simulated. */
export const tightComputeUnitLimit = (unitsConsumed: bigint | number | null | undefined, fallback: number) =>
  unitsConsumed == null || Number(unitsConsumed) <= 0 ? fallback
    : Math.min(1_400_000, Math.max(20_000, Math.ceil(Number(unitsConsumed) * 6 / 5_000) * 1_000 + 10_000));

/** Compute a creation reserves before simulation prices it: 1.2× the ~90,000 units measured on localnet, with headroom for larger feeds. */
export const CREATE_COMPUTE_UNIT_LIMIT = 150_000;

/** Compute a SOL→COLA purchase reserves before simulation prices it: the tight limit of the ~31,941 units a route measured on localnet. */
export const PURCHASE_COMPUTE_UNIT_LIMIT = 49_000;


export const RENT_SYSVAR = address('SysvarRent111111111111111111111111111111111');

export function rentExemptLamports(sysvar: Uint8Array, dataLength: bigint | number): bigint {
  if (sysvar.length < 17) throw new Error('Rent sysvar data is malformed');
  const view = new DataView(sysvar.buffer, sysvar.byteOffset, sysvar.byteLength);
  const threshold = view.getFloat64(8, true);
  if (threshold !== 1 && threshold !== 2) throw new Error(`Unsupported rent exemption threshold ${threshold}`);
  return (BigInt(dataLength) + 128n) * view.getBigUint64(0, true) * BigInt(threshold);
}

export async function readRentExemptLamports(rpc: { getAccountInfo(address: typeof RENT_SYSVAR, config: object): { send(): Promise<unknown> } },
  dataLength: bigint | number): Promise<bigint> {
  const response = await rpc.getAccountInfo(RENT_SYSVAR, { commitment: 'finalized', encoding: 'base64' }).send() as
    { value?: { data?: unknown } | null } | null;
  const data = response?.value?.data;
  if (!Array.isArray(data) || typeof data[0] !== 'string') throw new Error('Rent sysvar is unavailable');
  return rentExemptLamports(Uint8Array.from(atob(data[0]), (c) => c.charCodeAt(0)), dataLength);
}


export function venueLabel(slug: string): string {
  return ({ 'orca-whirlpool': 'Orca Whirlpool', 'raydium-clmm': 'Raydium CLMM', 'raydium-cpmm': 'Raydium CPMM',
    'meteora-dlmm': 'Meteora DLMM', 'meteora-damm-v2': 'Meteora DAMM v2', pumpswap: 'PumpSwap',
    'raydium-amm-v4': 'Raydium AMM v4' } as Record<string, string>)[slug] ?? slug;
}


export type ClassicQuotePreference = 'auto' | 'USDC' | 'SOL';

export const SOL_QUOTE_MINT: Address = address('So11111111111111111111111111111111111111112');
export const USDC_QUOTE_MINT: Address = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export function isCompositeQuoteCompatible(componentQuoteMint: string, compositeQuoteMint: string): boolean {
  return componentQuoteMint === compositeQuoteMint ||
    (componentQuoteMint === SOL_QUOTE_MINT && compositeQuoteMint !== SOL_QUOTE_MINT);
}


export const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;
export type V1OwnerRecord = Readonly<{
  kind: 'classic' | 'composite';
  generation: bigint;
  closeAfterSlot: bigint;
  noticeKind: number;
  creator: Address;
  identityAsset: Address | null;
  lastPublicationSlot: bigint;
}>;
const key = (data: Uint8Array, at: number) => getAddressDecoder().decode(data.subarray(at, at + 32));
export type V1Owner = Readonly<{ state: 'creator' | 'core'; owner: Address } | { state: 'ownerless' }>;


export function resolveV1Owner(record: V1OwnerRecord, asset: Readonly<{ owner: Address; data: Uint8Array }> | null, mplCore: Address): V1Owner {
  if (!record.identityAsset) return { state: 'creator', owner: record.creator };
  if (!asset || (asset.owner === SYSTEM_PROGRAM && asset.data.length === 0) ||
      (asset.owner === mplCore && asset.data.length === 1 && asset.data[0] === 0)) return { state: 'ownerless' };
  if (asset.owner !== mplCore || asset.data[0] !== 1 || asset.data.length < 33) throw new Error('Feed identity asset is not a readable Core asset');
  return { state: 'core', owner: key(asset.data, 1) };
}

export const MEDIA_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as Address;

/** SPL Memo v2 with no accounts binding the stage input (lowercase hex) to the creator's creation approval. */
export function mediaMemoInstruction(sha: string): MimirBetaInstruction {
  return Object.freeze({ programAddress: MEDIA_MEMO_PROGRAM, accounts: Object.freeze([]), data: new TextEncoder().encode(`mimir-media:v1:${sha}`) });
}

export type PreviewPool = Pick<MimirBetaEligiblePool, 'family' | 'pool' | 'baseMint' | 'quoteMint' | 'baseVault' | 'quoteVault' | 'readPlan'>;
export type PreviewRead = (addresses: readonly Address[]) => Promise<readonly ({ data: Uint8Array } | null)[]>;

const Q64 = 1n << 64n;
const MINT_A: Readonly<Record<string, number>> = {
  'orca-whirlpool': 101, 'raydium-clmm': 73, 'meteora-damm-v2': 168, 'meteora-dlmm': 88,
  'raydium-cpmm': 168, 'raydium-amm-v4': 400, pumpswap: 43
};
const SQRT: Readonly<Record<string, number>> = { 'orca-whirlpool': 65, 'raydium-clmm': 253, 'meteora-damm-v2': 456 };

const u64 = (data: Uint8Array, offset: number) => new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
const u128 = (data: Uint8Array, offset: number) => u64(data, offset) | (u64(data, offset + 8) << 64n);
const sum = (data: Uint8Array, offsets: readonly number[]) => offsets.reduce((total, offset) => total + u64(data, offset), 0n);
const reserveRaw = (base: bigint, quote: bigint) => {
  if (base <= 0n || quote <= 0n) throw new Error('empty reserve');
  return quote * Q64 / base;
};
const openOrders = (pool: PreviewPool) => pool.family === 'raydium-amm-v4'
  ? pool.readPlan.auxiliary.find((node) => node.role === 'open-orders')?.address : undefined;

/** Quote-per-base raw price (native units, X64), with the offsets and orientation the SDK capture uses. */
export function rawQuotePerBaseX64(pool: PreviewPool, data: Uint8Array, baseIsA: boolean, vault: (address: Address) => bigint, extra?: Uint8Array): bigint {
  const sqrt = SQRT[pool.family];
  if (sqrt !== undefined || pool.family === 'meteora-dlmm') {
    const raw = sqrt !== undefined ? squareQ64ToX64(u128(data, sqrt))
      : meteoraDlmmPriceFromIdX64(new DataView(data.buffer, data.byteOffset).getInt32(76, true), new DataView(data.buffer, data.byteOffset).getUint16(80, true));
    if (raw <= 0n) throw new Error('empty price');
    return baseIsA ? raw : Q64 * Q64 / raw;
  }
  const base = vault(pool.baseVault), quote = vault(pool.quoteVault);
  if (pool.family === 'raydium-cpmm') {
    const feesA = sum(data, [341, 357, 397]), feesB = sum(data, [349, 365, 405]);
    return reserveRaw(base - (baseIsA ? feesA : feesB), quote - (baseIsA ? feesB : feesA));
  }
  if (pool.family === 'raydium-amm-v4') {
    const open = extra && extra.length >= 109 ? [u64(extra, 85), u64(extra, 101)] : [0n, 0n];
    const poolA = (baseIsA ? base : quote) + open[0]! - u64(data, 192);
    const poolB = (baseIsA ? quote : base) + open[1]! - u64(data, 200);
    return baseIsA ? reserveRaw(poolA, poolB) : reserveRaw(poolB, poolA);
  }
  if (pool.family === 'pumpswap') {
    const poolBase = baseIsA ? base : quote;
    const spendableQuote = (baseIsA ? quote : base) - u64(data, 271) - u64(data, 279);
    return baseIsA ? reserveRaw(poolBase, spendableQuote) : reserveRaw(spendableQuote, poolBase);
  }
  throw new Error('unsupported family');
}

async function readPools<T>(pools: readonly PreviewPool[], read: PreviewRead, vaults: boolean,
  value: (pool: PreviewPool, priceX64: bigint, data: (address: Address) => Uint8Array) => T): Promise<Map<string, T>> {
  const addresses = [...new Set(pools.flatMap((pool) => [pool.pool, pool.baseMint, pool.quoteMint,
    ...(vaults || SQRT[pool.family] === undefined && pool.family !== 'meteora-dlmm' ? [pool.baseVault, pool.quoteVault] : []),
    ...(openOrders(pool) ? [openOrders(pool)!] : [])]))];
  const accounts = await read(addresses);
  const data = (address: Address) => {
    const account = accounts[addresses.indexOf(address)];
    if (!account) throw new Error('missing account');
    return account.data;
  };
  const values = new Map<string, T>();
  for (const pool of pools) {
    try {
      const poolData = data(pool.pool);
      const baseIsA = key(poolData, MINT_A[pool.family]!) === pool.baseMint;
      const raw = rawQuotePerBaseX64(pool, poolData, baseIsA, (address) => u64(data(address), 64), openOrders(pool) ? data(openOrders(pool)!) : undefined);
      values.set(pool.pool, value(pool, normalizedDirectQ64PriceX64(raw, data(pool.baseMint)[44]!, data(pool.quoteMint)[44]!), data));
    } catch { /* this pool stays without a value */ }
  }
  return values;
}

/** One read-only account cohort for all pools; returns the normalized quote-per-base price (X64) of each decodable pool. */
export function readPoolPrices(pools: readonly PreviewPool[], read: PreviewRead): Promise<Map<string, bigint>> {
  return readPools(pools, read, false, (_pool, priceX64) => priceX64);
}

export function medianX64(values: readonly bigint[]): bigint | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2n;
}

const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

/** The sealed-limits line a prepared CREATE (or the purchase funding the creation) carries to its approval. */
export const toleranceOf = (prepared: object | null | undefined) => (prepared as { tolerance?: string } | null | undefined)?.tolerance;
/**
 * The sealed limits, one compact line for the review, plus who widened them: "Tolerance: spread 1.5% · confidence 1%. HOODX's pool widens this index's tolerance to 1.5%."
 * `defaultExponent`: the exponent sealed without an observed price.
 */
export function toleranceLine(kind: 'feed' | 'index', spreadBps: number, confidenceBps: number, widenedBy: readonly Readonly<{ who: string; requiredBps: number; capBps: number }>[], defaultExponent?: number) {
  const cap = Math.max(spreadBps, confidenceBps);
  const names = [...new Set(widenedBy.filter((w) => w.requiredBps === w.capBps && w.capBps === cap).map((w) => w.who))];
  const hint = names.length ? ` ${names.join(' and ')} widen${names.length > 1 ? '' : 's'} this ${kind}'s tolerance to ${pct(cap)}.` : '';
  return `Tolerance: spread ${pct(spreadBps)} · confidence ${pct(confidenceBps)}.${hint}${defaultExponent === undefined ? '' : ` Price exponent ${defaultExponent}: no pool price could be read.`}`;
}
const VENUE_GROUP = (family: string) => family === 'orca-whirlpool' ? 'Orca' : family.startsWith('raydium') ? 'Raydium' : family.startsWith('meteora') ? 'Meteora' : 'PumpSwap';

/**
 * Live cross-pool gap as the program computes it: one pool per venue group, equal-weight median, largest deviation (bps). The program keeps
 * the group's pool with the lower live economic floor, known only at refresh, so every pick is measured: the widest sizes the cap, `narrowest` refuses.
 */
export function classicLiveGap(pools: readonly Pick<PrepareSimpleFeedArgs['pools'][number], 'family' | 'pool'>[], prices: ReadonlyMap<string, bigint>) {
  const groups = new Map<string, bigint[]>();
  for (const pool of pools) {
    const price = prices.get(pool.pool), venue = VENUE_GROUP(pool.family);
    if (price === undefined || price <= 0n) return undefined;
    groups.set(venue, [...groups.get(venue) ?? [], price]);
  }
  let picks: { venue: string; price: bigint }[][] = [[]];
  for (const [venue, xs] of groups) picks = picks.flatMap((pick) => xs.map((price) => [...pick, { venue, price }]));
  const gaps = picks.map((pick) => {
    const entries = pick.sort((a, b) => a.price < b.price ? -1 : a.price > b.price ? 1 : 0);
    const reference = medianX64(entries.map((e) => e.price))!;
    const low = entries[0]!, high = entries.at(-1)!;
    return { venues: entries.length, low: low.venue, high: high.venue, apartBps: Number((high.price - low.price) * 10_000n / low.price),
      dispersionBps: Math.max(...entries.map((e) => Number((e.price > reference ? e.price - reference : reference - e.price) * 10_000n / reference))) };
  }).sort((a, b) => a.dispersionBps - b.dispersionBps);
  return { ...gaps.at(-1)!, narrowest: gaps[0]! };
}
/** The pools disagree beyond the program maximum whichever pool per venue group the program keeps. */
export const liveGapRefusal = (ticker: string, g: Readonly<{ low: string; high: string; apartBps: number; dispersionBps: number }>, maxBps: number) =>
  `${ticker}: the ${g.low} and ${g.high} pools are ${pct(g.apartBps)} apart, ${pct(g.dispersionBps)} from their median · limit ${pct(maxBps)}. Use one pool, or pools that agree. Nothing was sent.`;
