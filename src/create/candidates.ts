import bs58 from "bs58";
import { rpcCall } from "../easy/price.js";
import { api, type PoolItem } from "../api/client.js";
import { mimirBetaCaptureScanDescriptors } from "../beta/capture.js";
import { SOL_QUOTE_MINT, USDC_QUOTE_MINT } from "./helpers.js";

export type PoolCandidate = PoolItem;
export type CandidateSource = { api?: string; rpc?: string; fetch?: typeof fetch };

const TTL_MS = 60_000, MAX_ENTRIES = 64, PER_VENUE = 4, MAX_RESPONSE_BYTES = 2_000_000;
const cache = new Map<string, { at: number; value: Promise<PoolCandidate[]> }>();
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PUBLIC = /api\.mainnet-beta\.solana\.com/;

/** @internal The gPA of each venue and direction: 6 venues × 2 orders + PumpSwap's 3 sizes on the base side = 15 calls. */
export function scanQueries(mint: string, quoteMint: string) {
  return mimirBetaCaptureScanDescriptors("mainnet-beta").flatMap((d) => {
    const pump = d.family === "pumpswap", start = Math.min(d.vaultAOffset, d.vaultBOffset), length = Math.abs(d.vaultAOffset - d.vaultBOffset) + 32;
    return (pump ? [[mint, quoteMint]] : [[mint, quoteMint], [quoteMint, mint]]).map(([a, b]) => ({ family: d.family, programId: d.programId as string,
      quoteVaultAt: (b === quoteMint ? d.vaultBOffset : d.vaultAOffset) - start,
      config: { encoding: "base64", commitment: "confirmed", dataSlice: { offset: start, length },
        filters: [{ dataSize: d.allocationSize }, { memcmp: { offset: d.mintAOffset, bytes: a } }, { memcmp: { offset: d.mintBOffset, bytes: b } }] } }));
  });
}

async function scan(rpc: string, mint: string, quote: "USDC" | "SOL"): Promise<PoolCandidate[]> {
  const quoteMint = quote === "SOL" ? SOL_QUOTE_MINT : USDC_QUOTE_MINT, queries = scanQueries(mint, quoteMint), paced = PUBLIC.test(rpc);
  const hits: { pool: string; family: string; programId: string; vault: string }[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: paced ? 1 : 4 }, async () => {
    for (let i = next++; i < queries.length; i = next++) {
      if (paced && i) await sleep(1_100);
      const q = queries[i]!;
      const rows = await rpcCall<{ pubkey: string; account: { data: [string, string] } }[]>(rpc, "getProgramAccounts", [q.programId, q.config]);
      if (rows.reduce((n, r) => n + r.account.data[0].length, 0) > MAX_RESPONSE_BYTES) continue;
      for (const r of rows) hits.push({ pool: r.pubkey, family: q.family, programId: q.programId, vault: bs58.encode(fromB64(r.account.data[0]).subarray(q.quoteVaultAt, q.quoteVaultAt + 32)) });
    }
  }));
  const reserves = new Map<string, bigint>();
  for (let i = 0; i < hits.length; i += 100) {
    const chunk = hits.slice(i, i + 100).map((h) => h.vault);
    const r = await rpcCall<{ value: ({ data: [string, string] } | null)[] }>(rpc, "getMultipleAccounts", [chunk, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 64, length: 8 } }]);
    r.value.forEach((a, j) => { const d = a ? fromB64(a.data[0]) : null; if (d?.length === 8) reserves.set(chunk[j]!, new DataView(d.buffer, d.byteOffset).getBigUint64(0, true)); });
  }
  const ranked = hits.filter((h, i) => hits.findIndex((x) => x.pool === h.pool) === i).map((h) => ({ pool: h.pool, venue: h.family, programId: h.programId,
    quoteReserveRaw: reserves.get(h.vault) ?? 0n })).filter((h) => h.quoteReserveRaw > 0n)
    .sort((a, b) => (b.quoteReserveRaw > a.quoteReserveRaw ? 1 : b.quoteReserveRaw < a.quoteReserveRaw ? -1 : 0));
  const perVenue = new Map<string, number>();
  return ranked.filter((h) => { const n = perVenue.get(h.venue) ?? 0; perVenue.set(h.venue, n + 1); return n < PER_VENUE; }).slice(0, 8);
}

/**
 * Candidate pools of `mint` against one quote, deepest quote reserve first, at most 8 (≤ 4 per venue). Untrusted hints: every pool is
 * checked on chain before use. `rpc` scans the venue programs on your RPC (15 `getProgramAccounts` plus 1–3 reserve reads); else the
 * Mimir API. Cached 60 s per (mint, quote, source), in-flight calls shared.
 */
export function poolCandidates(mint: string, quote: "USDC" | "SOL", source: CandidateSource = {}): Promise<PoolCandidate[]> {
  const key = `${source.rpc ? "rpc" : `api:${source.api ?? ""}`}|${mint}|${quote}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = source.rpc ? scan(source.rpc, mint, quote) : api.pools(source.api, mint, quote, source.fetch);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}
/** @internal */
export const clearCandidateCache = () => cache.clear();
