import type { Address } from "@solana/kit";
import bs58 from "bs58";
import { decodeV1ClassicFeed, decodeV1CompositeFeed } from "../v1/decoders.js";
import * as K from "../v1/layout/classic.js";
import { decodePrice, DEFAULT_RPC, getMultipleAccounts as readAccounts, MimirError, readFeeds, type MimirAccount, type PriceOptions } from "./price.js";
import { getPrice, simulateRefreshedAccount } from "./refresh.js";
import { derivePdaSync, mimirBetaDlmmRouteableLegacyDepth } from "../beta/capture.js";
import { marketFit, type MarketFitVerdict, type MarketFitCohort, type MarketFitDefinition, type MarketFitIntent } from "./marketFit.js";

const FAMILY = ["orca-whirlpool", "raydium-clmm", "raydium-cpmm", "meteora-dlmm", "raydium-amm-v4", undefined, "pumpswap", "meteora-damm-v2"] as const;
const VENUE: Record<string, string> = { "orca-whirlpool": "Orca Whirlpool", "raydium-clmm": "Raydium CLMM", "raydium-cpmm": "Raydium CPMM",
  "meteora-dlmm": "Meteora DLMM", "meteora-damm-v2": "Meteora DAMM v2", pumpswap: "PumpSwap", "raydium-amm-v4": "Raydium AMM v4" };
const EXCHANGE: Record<string, string> = { "orca-whirlpool": "Orca", "raydium-clmm": "Raydium", "raydium-cpmm": "Raydium",
  "raydium-amm-v4": "Raydium", "meteora-dlmm": "Meteora", "meteora-damm-v2": "Meteora", pumpswap: "PumpSwap" };

/** Venue label of an adapter family slug ("orca-whirlpool" → "Orca Whirlpool"). */
export const venueLabel = (family: string): string => VENUE[family] ?? family;

export type FeedPool = {
  pool: string;
  /** Venue label, e.g. "Orca Whirlpool". */
  venue: string;
  /** Exchange group: pools on the same exchange count once ("Orca", "Raydium", "Meteora", "PumpSwap"). */
  exchange: string;
  adapterType: number;
  /** Quote needed to move this pool 50 bps (ring completed window), in USDC. Null when unknown (empty ring, a SOL quote with no SOL
   *  price, or a ring older than 150 slots at `FeedInfo.slot`). */
  depth50Usdc: number | null;
  /** Last fee rate of the pool, in ppm. */
  feePpm: number;
  /** Last confidence of the pool, in bps. */
  confBps: number;
  /** Row mode (recipe): 0/1/6 spot, 2 native-bounded, 3 quiet-interval, 4 sampled, 5 point. */
  mode: number;
  /** Slot of the ring's newest sample; `FeedInfo.slot − depthSlot` is the depth's age. */
  depthSlot: bigint;
};

export type FeedInfo = {
  feed: string;
  ticker: string;
  kind: "token" | "index";
  quote: "USDC" | "SOL" | string;
  generation: bigint;
  creator: string;
  /** Slot of the data: the read, or the simulated refresh when the stored ring was older than 150 slots. */
  slot: bigint;
  /** Token feeds: the primary source rows. Empty for an index. */
  pools: FeedPool[];
  /** Indexes only. */
  components: { feed: string; quantity: number }[];
  /** Sealed dispersion cap (an index: its component cap). */
  maxDispersionBps: number;
};

const u16 = (b: Uint8Array, at: number) => b[at]! | b[at + 1]! << 8;
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u128 = (b: Uint8Array, at: number) => { let v = 0n; for (let i = 15; i >= 0; i--) v = v << 8n | BigInt(b[at + i]!); return v; };

/** Decodes a feed account read by the caller. `solUsdc` converts a SOL-quoted feed's depth to USDC (Mimir's own SOL price). */
export async function decodeFeedInfo(account: MimirAccount, ctx: PriceOptions & { slot: bigint | number; solUsdc?: number | null }): Promise<FeedInfo> {
  const price = await decodePrice(account, { slot: ctx.slot, program: ctx.program });
  const base = { feed: price.feed, ticker: price.ticker, kind: price.kind, quote: price.quote };
  if (price.kind === "index") {
    const c = decodeV1CompositeFeed(account.data, account.address as Address);
    return { ...base, generation: c.owner.generation, creator: c.config.creator, slot: BigInt(ctx.slot), pools: [],
      components: (price.components ?? []).map(({ feed, quantity }) => ({ feed, quantity })), maxDispersionBps: c.config.maxComponentDispersionBps };
  }
  const f = decodeV1ClassicFeed(account.data, account.address as Address);
  const image = f.definition.feedImage;
  const unit = 10 ** image[K.CFG_OFFSET_QUOTE_DECIMALS]!;
  const toUsdc = price.quote === "USDC" ? 1 : price.quote === "SOL" ? ctx.solUsdc ?? null : null;
  return { ...base, generation: f.owner.generation, creator: f.owner.creator as string, slot: BigInt(ctx.slot), components: [],
    maxDispersionBps: u16(image, K.CFG_OFFSET_MAX_DISPERSION_BPS),
    pools: f.rows.map((row) => {
      const adapterType = row.source[K.SRC_OFFSET_ADAPTER_TYPE]!;
      const family = FAMILY[adapterType] ?? String(adapterType);
      const native = u128(row.ring, K.RING_OFFSET_COMPLETED_MIN_DEPTH_TO_50BPS_NATIVE);
      const depthSlot = view(row.ring).getBigUint64(K.RING_OFFSET_NEWEST_SLOT, true);
      return { pool: bs58.encode(row.source.subarray(K.SRC_OFFSET_POOL_OR_MARKET, K.SRC_OFFSET_POOL_OR_MARKET + 32)), venue: venueLabel(family),
        exchange: EXCHANGE[family] ?? family, adapterType, depth50Usdc: native === 0n || toUsdc === null || BigInt(ctx.slot) - depthSlot > 150n ? null : Number(native) / unit * toUsdc,
        feePpm: view(row.ring).getUint32(K.RING_OFFSET_LAST_FEE_RATE_PPM, true), confBps: u16(row.ring, K.RING_OFFSET_LAST_CONFIDENCE_BPS),
        mode: row.descriptor.mode, depthSlot };
    }) };
}

/**
 * Feed robustness inputs, read from chain: pools with their depth in USDC, components, the sealed dispersion cap. Read only.
 * A ring older than 150 slots is replaced by what the in-tx refresh would record now (simulated); if that fails, the stored ring
 * stands, `slot − depthSlot` shows its age, its depth is null and `scoreFeed` returns null.
 */
export async function getFeedInfo(feedOrTicker: string, opts: PriceOptions & { payer?: string } = {}): Promise<FeedInfo> {
  const read = await readFeeds([feedOrTicker], opts);
  let account = read.accounts[0]!, slot = read.slot;
  let info = await decodeFeedInfo(account, { ...opts, slot });
  if (read.tickers[0] !== null && info.ticker !== read.tickers[0]) {
    throw new MimirError("TICKER_MISMATCH", `ticker ${read.tickers[0]} points at ${account.address} (${info.ticker})`, "never");
  }
  if (info.kind !== "token") return info;
  if (info.pools.some((p) => slot - p.depthSlot > 150n)) {
    ({ account, slot } = await simulateRefreshedAccount(read, account, opts.payer).catch(() => ({ account, slot })));
  }
  const sol = info.quote === "SOL" ? await getPrice("SOL", opts).then((p) => p.price, () => null) : null;
  return decodeFeedInfo(account, { ...opts, slot, solUsdc: sol });
}

/**
 * Depth to 50 bps of a routeable Meteora DLMM candidate, as creation seals it (the active bin array and its two neighbours), in
 * quote native units (a `bigint`): divide by 10^quote decimals, and for a SOL quote multiply by the SOL price, to get the USDC
 * `depth50Usdc` of a DLMM candidate in `recommendPools` (not the search depth). Read only. Errors are `MimirError`s.
 */
export async function dlmmRouteableDepth(args: { pool: string; baseMint: string; quoteMint: string; rpc?: string }): Promise<bigint> {
  return dlmmDepth(args).catch((e) => { throw MimirError.from(e); });
}

async function dlmmDepth(args: { pool: string; baseMint: string; quoteMint: string; rpc?: string }): Promise<bigint> {
  const rpc = args.rpc ?? DEFAULT_RPC;
  const [pair] = (await readAccounts(rpc, [args.pool])).accounts;
  if (!pair) throw new MimirError("INVALID_INPUT", `no DLMM pair ${args.pool}`, "never");
  const active = Math.floor(view(pair.data).getInt32(76, true) / 70);
  const arrays = [active - 1, active, active + 1].map((i) => {
    const index = new Uint8Array(8); view(index).setBigInt64(0, BigInt(i), true);
    return derivePdaSync(pair.owner as Address, [new TextEncoder().encode("bin_array"), bs58.decode(args.pool), index]) as string;
  });
  const bins = (await readAccounts(rpc, arrays)).accounts;
  if (bins.some((b) => !b)) throw new MimirError("INVALID_INPUT", `DLMM ${args.pool}: a bin array around the active bin is missing`, "later");
  const cap = (a: MimirAccount) => ({ ...a, address: a.address as Address, owner: a.owner as Address });
  return mimirBetaDlmmRouteableLegacyDepth({ pool: args.pool as Address, pair: cap(pair), baseMint: args.baseMint as Address, quoteMint: args.quoteMint as Address,
    binArrays: bins.map((b) => cap(b!)) as [ReturnType<typeof cap>, ReturnType<typeof cap>, ReturnType<typeof cap>] });
}

/** One pool of `scoreFeed`. `exchange` groups pools (same exchange counts once); `getFeedInfo` pools fit as is. */
export type ScorePool = { exchange: string; depth50Usdc: number | null;
  /** Slot of the depth; with `slot` in the input, a depth older than 150 slots counts as unknown. */
  depthSlot?: bigint; trades24h?: number | null; lastTradeMin?: number | null; feePpm?: number;
  /** Pool confidence in bps and the row mode the feed seals (see `FeedPool`); unknown → no market-fit factor. */
  confBps?: number; mode?: number; adapterType?: number; temporalKind?: number };

export type FeedScore = {
  /** 0–100. Information only: it never refuses anything. */
  score: number;
  band: "Excellent" | "Strong" | "Good" | "Fair" | "Thin";
  /** USDC to move the feed 50 bps. */
  costToMove: number;
  /** USDC to force Degraded on the default spot path; null with one exchange (no dispersion pause); 0 when `pausesWhenQuiet`. */
  pauseCost: number | null;
  /** True when a native-bounded Meteora DLMM or Raydium CPMM row pauses while its pool is quiet. */
  pausesWhenQuiet: boolean;
  exchanges: number;
  /** Each in [0, 1]. */
  factors: { depth: number; stays: number; exchanges: number; activity: number };
  /** Market fit summary: `fit` is `verdict.status` as true ("ready"), false ("not-as-is") or null ("unknown"); reported, never applied to `score`. */
  marketFit: { fit: boolean | null; eligible: boolean | null; confFloorBps: number | null; reason: string | null };
  /** The market-fit verdict under `fitVerdict.profile` (see `marketFit`). */
  fitVerdict: MarketFitVerdict;
};

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const logScale = (usdc: number) => clamp(Math.log10(Math.max(usdc, 1) / 100) / 4);
const band = (s: number): FeedScore["band"] => s >= 80 ? "Excellent" : s >= 65 ? "Strong" : s >= 50 ? "Good" : s >= 35 ? "Fair" : "Thin";
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
/** A slot as a bigint (a safe non-negative integer number is accepted); undefined when invalid. */
const slotOf = (x: unknown) => typeof x === "bigint" ? (x >= 0n ? x : undefined) : Number.isSafeInteger(x) && (x as number) >= 0 ? BigInt(x as number) : undefined;
const activityOf = (p: ScorePool) => {
  if (!num(p.trades24h)) return 0.5;
  const t = clamp(Math.log10(1 + p.trades24h) / 3);
  return num(p.lastTradeMin) && p.lastTradeMin > 60 ? t * 0.5 : t;
};

/**
 * Feed score v2: depth 50%, then (gated until 1,000 USDC to move) stays priced 20%, exchanges 15%, activity 15% (unknown or invalid
 * = 0.5). The market-fit verdict under the profile is reported in `marketFit` / `fitVerdict`, never applied to the score. Null when any depth is unknown, not a
 * finite non-negative number, or older than 150 slots, or when `capBps` / `marketMaxConfBps` is not a finite positive number.
 * Invalid fees and confidences count as unknown. `marketMaxConfBps` overrides the profile's max confidence; `quote` and `fit`
 * pass the facts the pools do not carry. `fit.definition`: the caller's authenticated definition (rows with depth, floor, liquidity,
 * condition, binding), forwarded unchanged instead of the one built from `pools` / `quote` / `fit.variant`; it never changes `score`.
 */
export function scoreFeed(input: { pools: readonly ScorePool[]; capBps?: number; marketMaxConfBps?: number; slot?: bigint; quote?: string;
    fit?: { cohort?: MarketFitCohort; intent?: MarketFitIntent; variant?: number; definition?: MarketFitDefinition } }): FeedScore | null {
  const pools = Array.isArray(input?.pools) ? input.pools.filter((p) => p && typeof p === "object") : [];
  const slot = input?.slot == null ? null : slotOf(input.slot);
  const unknown = (p: ScorePool) => !num(p.depth50Usdc)
    || (slot != null && p.depthSlot != null && (slotOf(p.depthSlot) === undefined || slot - slotOf(p.depthSlot)! > 150n));
  const positive = (x: number | undefined) => x == null || (num(x) && x > 0);
  if (!pools.length || pools.length !== input.pools.length || slot === undefined || pools.some(unknown) || !positive(input.capBps)
    || !positive(input.marketMaxConfBps)) return null;
  const capBps = input.capBps ?? (pools.length > 1 ? 200 : 100);
  const d = (p: ScorePool) => p.depth50Usdc!;
  const conf = (p: ScorePool) => num(p.confBps) ? p.confBps : undefined;
  const feeKnown = new Map<string, boolean>();
  for (const p of pools) feeKnown.set(p.exchange, (feeKnown.get(p.exchange) ?? true) && num(p.feePpm));
  const key = (p: ScorePool) => d(p) * (feeKnown.get(p.exchange) ? p.feePpm! : 1);
  // Point/sampled rows: the program takes the group's first row in source order; spot keeps the fee comparator.
  const ordered = (p: ScorePool) => p.mode === 4 || p.mode === 5;
  const byGroup = new Map<string, ScorePool>();
  for (const p of pools) {
    const cur = byGroup.get(p.exchange);
    if (cur && ordered(cur)) continue;
    const k = key(p), kc = cur && key(cur);
    if (!cur || ordered(p) || k < kc! || (k === kc && d(p) < d(cur))) byGroup.set(p.exchange, p);
  }
  const reps = [...byGroup.values()].map(d).sort((a, b) => a - b);
  const G = reps.length;
  const sum = (k: number) => reps.slice(0, k).reduce((a, b) => a + b, 0);
  const M = G % 2 ? sum((G + 1) / 2) : Math.min(2 * sum(G / 2), sum(G / 2 + 1));
  const P = G === 1 ? Infinity : reps[0]! * (G === 2 ? 2 : 1) * capBps / 50;
  const pausesWhenQuiet = pools.some((p) => p.mode === 2 && p.temporalKind !== 6 && (p.adapterType === 2 || p.adapterType === 3));
  const factors = { depth: logScale(M), stays: pausesWhenQuiet ? 0 : G === 1 ? 1 : logScale(P), exchanges: Math.min(G, 3) / 3, activity: Math.min(...pools.map(activityOf)) };
  const gate = clamp(factors.depth / 0.25);
  const intent = input.fit?.intent ?? {};
  const verdict = marketFit(input.fit?.definition ?? { kind: "classic", quote: input.quote, variant: input.fit?.variant,
    rows: pools.map((p) => ({ mode: p.mode, adapterType: p.adapterType, temporalKind: p.temporalKind, confBps: conf(p) })) }, input.fit?.cohort,
    input.marketMaxConfBps == null ? intent : { ...intent, profile: { ...intent.profile, maxConfBps: input.marketMaxConfBps } });
  const mode = pools[0]!.mode;
  const eligible = pools.length >= 2 ? true : typeof mode !== "number" ? null : mode >= 2 && mode <= 5;
  const confFloorBps = pools.every((p) => conf(p) != null) ? Math.max(...pools.map((p) => p.confBps!)) : null;
  const fit = verdict.status === "not-as-is" ? false : verdict.status === "ready" ? true : null;
  const reason = verdict.reason === "RECIPE_UNSUPPORTED" ? "single spot pool: use the interval/point recipe"
    : verdict.reason === "CONFIDENCE" ? `conf ${verdict.limits.confBps ?? pools[0]!.confBps} > ${verdict.limits.parentMaxConfBps}`
    : fit === false ? verdict.reason : null;
  const score = Math.round(100 * (0.5 * factors.depth + gate * (0.2 * factors.stays + 0.15 * factors.exchanges + 0.15 * factors.activity)));
  return { score, band: band(score), costToMove: M, pauseCost: pausesWhenQuiet ? 0 : Number.isFinite(P) ? P : null, pausesWhenQuiet, exchanges: G, factors,
    marketFit: { fit, eligible, confFloorBps, reason }, fitVerdict: verdict };
}

/**
 * Auto pick: the deepest pool per exchange, the best-scoring subset; within 1 point, fewer pools. `deltas[i]` is what the score
 * becomes minus the chosen score if `candidates[i]` is added to (or removed from) the chosen set; null when not comparable. Pure: the
 * caller checks the SDK admits the set, gives each candidate the depth of the binding the SDK seals (routeable DLMM:
 * `dlmmRouteableDepth`) and the mode it will seal. Sets with an unknown depth are skipped.
 */
export function recommendPools<T extends ScorePool>(candidates: readonly T[], capBpsFor: (pools: readonly T[]) => number | undefined = () => undefined) {
  const score = (set: readonly T[]) => scoreFeed({ pools: set, capBps: capBpsFor(set) });
  const best = new Map<string, T>();
  for (const p of candidates) { const cur = best.get(p.exchange); if (!cur || (p.depth50Usdc ?? 0) > (cur.depth50Usdc ?? 0)) best.set(p.exchange, p); }
  const tops = [...best.values()];
  let pick: { pools: T[]; score: FeedScore } | null = null;
  for (let mask = 1; mask < 1 << tops.length; mask++) {
    const set = tops.filter((_, i) => mask & (1 << i)); const e = score(set);
    if (!e) continue;
    if (!pick || e.score > pick.score.score + 1 || (Math.abs(e.score - pick.score.score) <= 1 && set.length < pick.pools.length)
        || (e.score === pick.score.score && set.length === pick.pools.length && e.costToMove > pick.score.costToMove)) pick = { pools: set, score: e };
  }
  if (!pick) return null;
  const chosen = pick;
  const deltas = candidates.map((c) => {
    const set = chosen.pools.includes(c) ? chosen.pools.filter((p) => p !== c) : [...chosen.pools, c];
    const e = set.length ? score(set) : null;
    return e ? e.score - chosen.score.score : null;
  });
  return { ...chosen, deltas };
}
