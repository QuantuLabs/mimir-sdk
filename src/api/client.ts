import { DEFAULT_API, MimirError, type MimirErrorCode, type MimirRetry } from "../easy/error.js";
import type { Price as ChainPrice } from "../easy/price.js";

const TIMEOUT_MS = 10_000, RETRY_BUDGET_MS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const CODES = new Set<string>(["NOT_FOUND", "TICKER_NOT_FOUND", "INVALID_INPUT", "RATE_LIMITED", "CAPACITY", "UPSTREAM_UNAVAILABLE", "TOKEN_AMBIGUOUS"]);

/**
 * One GET (or JSON POST) to the Mimir API. HTTP 429/503 is retried twice, never before Retry-After, within 20 s; the error JSON
 * (`{ error: { code, hint, retryAfterMs } }`) becomes a `MimirError`. No fallback to any RPC.
 */
export async function apiGet<T>(api: string | undefined, path: string, fetcher: typeof fetch = fetch, payload?: unknown): Promise<T> {
  const url = `${(api ?? DEFAULT_API).replace(/\/+$/, "")}${path}`;
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try { res = await fetcher(url, { method: payload ? "POST" : "GET", headers: payload ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" }, body: payload ? JSON.stringify(payload) : null, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch (e) { throw new MimirError("RPC", `the Mimir API is unreachable`, "later", { cause: e, hint: "Retry in a few seconds, or pass your own rpc: new Mimir({ rpc })." }); }
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      const h = res.headers.get("retry-after")?.trim() ?? "";
      const delay = /^\d+$/.test(h) ? Number(h) * 1000 : 1000 * 2 ** attempt;
      if (waited + delay <= RETRY_BUDGET_MS) { await sleep(delay); waited += delay; continue; }
    }
    const body = await res.json().catch(() => null) as { error?: ErrorJson } | null;
    if (res.ok && body) return body as T;
    const e = body?.error, wait = res.headers.get("retry-after");
    const code = (e?.code && CODES.has(e.code) ? e.code : res.status === 404 ? "NOT_FOUND" : res.status === 400 ? "INVALID_INPUT" : res.status === 429 ? "RATE_LIMITED" : "RPC") as MimirErrorCode;
    const retry: MimirRetry = res.status === 429 || res.status >= 500 ? "later" : retryOf(code);
    throw new MimirError(code, `the Mimir API answered ${e?.code ?? `HTTP ${res.status}`}${wait ? ` (Retry-After ${wait} s)` : ""}`, retry,
      e?.hint ? { hint: e.hint } : retry === "later" ? { hint: `Retry in ${wait ?? "a few"} s, or pass your own rpc: new Mimir({ rpc }).` } : undefined);
  }
}

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", SOL_MINT = "So11111111111111111111111111111111111111112";

/** A Mimir feed and its price, the same object in API and RPC mode. `price` is in USDC, null when the feed cannot be priced (`reason` says why). */
export type Price = {
  ticker: string | null;
  /** "token": one token priced from its pools; "index": built from other feeds. */
  kind: "token" | "index";
  /** The feed account a Solana program reads. */
  address: string | null;
  /** The priced token (token feeds; null for an index; absent in RPC mode). */
  token?: { mint: string; symbol: string | null; name: string | null } | null;
  /** The quote of the feed's pools. `price` is always in USDC. */
  quote: { mint: string; symbol: string | null } | null;
  /** Token feeds: the pools it reads and their USDC liquidity, null when unknown (API mode). */
  sources?: { pool: string; venue: string | null; liquidityUsdc: number | null }[];
  /** Indexes: the component feeds and their share of the index, 0–1, null without a price (API mode). */
  components?: { ticker: string | null; address: string | null; weight: number | null }[];
  /** Token feeds: the pools' recommendation score out of 100; null for an index or while unknown (API mode). */
  score?: { value: number; band: "Excellent" | "Strong" | "Good" | "Fair" | "Thin" } | null;
  price: number | null;
  confidenceBps: number | null;
  dispersionBps: number | null;
  /** The Solana slot whose pool states produced this price (or the slot evaluated, when not priced). */
  slot: bigint;
  /** Unix seconds of the price. */
  updatedAt: number;
  reason?: string;
};
export type FeedJson = Omit<Price, "slot"> & { slot: string };
export type HistoryPoint = [unixSeconds: number, usdc: number];
type ErrorJson = { code?: string; hint?: string; retryAfterMs?: number };

/** An API feed object as a `Price`. */
export const priceFromJson = (j: FeedJson): Price => ({ ...j, slot: BigInt(j.slot ?? 0) });

/** The retry class of an API error code. */
export const retryOf = (code: string): MimirRetry => (code === "RATE_LIMITED" || code === "CAPACITY" || code === "UPSTREAM_UNAVAILABLE" ? "later" : "never");

/** An onchain-decoded price as a `Price`: priced while fresh or needing a refresh, in USDC through `solUsdc` for a SOL-quoted feed. */
export function fromChain(p: ChainPrice, solUsdc?: number | null): Price {
  const sol = p.quote === "SOL", usable = p.status === "fresh" || p.status === "needs-refresh";
  const price = !usable || p.price === null ? null : sol ? (solUsdc ?? null) === null ? null : p.price * solUsdc! : p.price;
  return { ticker: p.ticker, kind: p.kind, address: p.feed, quote: { mint: sol ? SOL_MINT : p.quote === "USDC" ? USDC_MINT : p.quote, symbol: sol ? "SOL" : p.quote === "USDC" ? "USDC" : p.quote },
    price, confidenceBps: price === null ? null : p.confidenceBps, dispersionBps: price === null ? null : p.dispersionBps, slot: p.slot, updatedAt: p.unixTs,
    ...(price === null ? { reason: !usable ? (p.status === "none" ? "NO_PRICE" : "DEGRADED") : sol ? "NO_SOL_PRICE" : "NO_PRICE" } : {}) };
}

export type TokenItem = { mint: string; symbol: string; name: string; verified: boolean };
export type PoolItem = { pool: string; venue: string; programId: string; quoteReserveRaw: bigint };

/** The API routes the SDK reads: the only place their names and shapes live. */
export const api = {
  prices: async (base: string | undefined, feeds: readonly string[], f?: typeof fetch) =>
    (await apiGet<{ items: ({ input: string; feed: FeedJson } | { input: string; error: ErrorJson })[] }>(base, "/v1/feeds", f, { feeds })).items,
  feed: async (base: string | undefined, feed: string, f?: typeof fetch) =>
    priceFromJson((await apiGet<{ feed: FeedJson }>(base, `/v1/feed/${encodeURIComponent(feed)}`, f)).feed),
  history: (base: string | undefined, feed: string, range: string, f?: typeof fetch) =>
    apiGet<{ ticker: string; address: string; range: string; points: HistoryPoint[] }>(base, `/v1/feed/${encodeURIComponent(feed)}/history?range=${encodeURIComponent(range)}`, f),
  tokens: async (base: string | undefined, q: string, f?: typeof fetch) =>
    (await apiGet<{ items: TokenItem[] }>(base, `/v1/tokens/search?q=${encodeURIComponent(q)}`, f)).items,
  pools: async (base: string | undefined, mint: string, quote: "USDC" | "SOL", f?: typeof fetch): Promise<PoolItem[]> =>
    (await apiGet<{ items: (Omit<PoolItem, "quoteReserveRaw"> & { quoteReserveRaw: string })[] }>(base, `/v1/pools?mint=${mint}&quote=${quote}`, f)).items
      .map((x) => ({ pool: x.pool, venue: x.venue, programId: x.programId, quoteReserveRaw: BigInt(x.quoteReserveRaw) })),
};

/** Token search on the Mimir API (Jupiter-verified flag included), ≤ 8 ranked items. A UI helper: creation takes the mint. */
export const searchTokens = (q: string, opts: { api?: string } = {}): Promise<TokenItem[]> => api.tokens(opts.api, q);
