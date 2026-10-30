import bs58 from "bs58";
import type { Address } from "@solana/kit";
import { listV1ClassicFeeds, listV1Composites } from "../v1/discovery.js";
import type { MimirBetaProgramAccountsRpc } from "../beta/pairFeeds.js";
import { decodePrice, MimirError, MIMIR_PROGRAM_IDS, readFeeds, rpcCall, type Price, type PriceOptions } from "./price.js";
import { getPrices, type GetPriceOptions } from "./refresh.js";

/**
 * Every Mimir feed: address, ticker and kind. Uses `getProgramAccounts`, which some RPCs refuse: pass `{ rpc }`.
 */
export async function listFeeds(opts: PriceOptions & { rpc: string }): Promise<{ feed: string; ticker: string; kind: "token" | "index" }[]> {
  const program = (opts.program ?? MIMIR_PROGRAM_IDS.mainnet) as Address;
  const gpa = { getProgramAccounts: (p: string, cfg: object) => ({ send: () =>
    rpcCall(opts.rpc, "getProgramAccounts", [p, JSON.parse(JSON.stringify(cfg, (k, v) => (typeof v === "bigint" ? Number(v)
      : k === "memcmp" ? { offset: Number(v.offset), bytes: bs58.encode(Uint8Array.from(atob(v.bytes), (c) => c.charCodeAt(0))) } : v)))]) }) };
  const rows = await Promise.all([listV1ClassicFeeds, listV1Composites].map((list) =>
    list(gpa as unknown as MimirBetaProgramAccountsRpc, program).catch((e) => { throw MimirError.from(e, { program }); })));
  const addresses = rows.flat().map((r) => r.address as string);
  if (!addresses.length) return [];
  const read = await readFeeds(addresses, { ...opts, program });
  const out = await Promise.all(read.accounts.map((a) => decodePrice(a, { slot: read.slot, program }).then(
    (p) => ({ feed: p.feed, ticker: p.ticker, kind: p.kind }), () => null)));
  return out.filter((x) => x !== null);
}

/**
 * Polls `getPrices` every `intervalMs` (default 5,000) and calls `onPrice` with each price. A failed poll is passed to
 * `onError` when given; an error whose `retry` is "never" (an RPC answering 403, say) is passed once and stops the polling. Returns the unsubscribe function. Each poll costs about 10 RPC calls per non-fresh feed (its refresh
 * is simulated); for many feeds or a short interval use `live: false` or your own RPC.
 */
export function watchPrices(feeds: readonly string[], onPrice: (price: Price) => void,
  opts: GetPriceOptions & { intervalMs?: number; onError?: (error: MimirError) => void } = {}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failing = false;
  const tick = async () => {
    try {
      const prices = await getPrices(feeds, opts);
      if (stopped) return;
      const missed = prices.find((p) => p.liveError);
      if (missed && !failing) opts.onError?.(new MimirError(missed.liveError!, `${missed.ticker}: live simulation failed; returning the stored price (live: false)`, "later"));
      failing = !!missed;
      prices.forEach(onPrice);
    } catch (e) {
      const error = MimirError.from(e);
      if (!stopped) opts.onError?.(error);
      if (error.retry === "never") stopped = true;
    }
    if (!stopped) timer = setTimeout(tick, opts.intervalMs ?? 5000);
  };
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}
