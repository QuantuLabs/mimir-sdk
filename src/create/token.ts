import bs58 from "bs58";
import type { Address } from "@solana/kit";
import { decodePrice, getMultipleAccounts, MimirError, type MimirAccount } from "../easy/price.js";
import { api, type TokenItem } from "../api/client.js";
import { decodeV1ClassicFeed } from "../v1/decoders.js";
import { deriveMimirV1ClassicFeedId, findMimirV1ClassicFeedPda, findMimirV1TickerClaimPda, MIMIR_V1_MAINNET_PROGRAM_ID } from "../v1/build.js";
import { SOL_QUOTE_MINT, USDC_QUOTE_MINT } from "./helpers.js";

const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EnSAAvaWqm8PoCGTj7Lw7"];
const isAddress = (s: string) => { try { return bs58.decode(s).length === 32; } catch { return false; } };
const utf8 = new TextDecoder();

/** A Borsh string at `at`: [u32 len][bytes]. */
function str(d: Uint8Array, at: number): [string, number] {
  const n = new DataView(d.buffer, d.byteOffset).getUint32(at, true);
  return [utf8.decode(d.subarray(at + 4, at + 4 + n)).replace(/\0/g, "").trim(), at + 4 + n];
}
/** The symbol in a Token-2022 TokenMetadata extension (type 19) of the mint, else null. */
function token2022Symbol(d: Uint8Array): string | null {
  for (let at = 166; at + 4 <= d.length;) {
    const v = new DataView(d.buffer, d.byteOffset), type = v.getUint16(at, true), len = v.getUint16(at + 2, true);
    if (type === 19) { const [, afterName] = str(d, at + 4 + 64); return str(d, afterName)[0]; }
    at += 4 + len;
  }
  return null;
}

/** The on-chain symbol of a mint: Metaplex metadata, else the Token-2022 metadata extension. One `getMultipleAccounts`. */
export async function readMintSymbol(rpc: string, mint: string): Promise<{ symbol: string | null; mint: MimirAccount | null }> {
  const { getProgramDerivedAddress, getAddressEncoder } = await import("@solana/kit");
  const enc = getAddressEncoder();
  const [metadata] = await getProgramDerivedAddress({ programAddress: METADATA_PROGRAM as Address, seeds: ["metadata", enc.encode(METADATA_PROGRAM as Address), enc.encode(mint as Address)] });
  const { accounts: [m, md] } = await getMultipleAccounts(rpc, [mint, metadata]);
  if (!m || !TOKEN_PROGRAMS.includes(m.owner)) return { symbol: null, mint: null };
  if (md?.owner === METADATA_PROGRAM && md.data.length > 69) { try { const [, afterName] = str(md.data, 65); const s = str(md.data, afterName)[0]; if (s) return { symbol: s, mint: m }; } catch { /* next */ } }
  try { return { symbol: m.owner === TOKEN_PROGRAMS[1] ? token2022Symbol(m.data) : null, mint: m }; } catch { return { symbol: null, mint: m }; }
}

export type ResolvedToken = { mint: string; symbol: string; verified: boolean; warnings: string[] };

/**
 * The symbol of a mint. API mode: the verified token search, else the on-chain metadata (unverified, with a warning). RPC mode: the
 * on-chain metadata only. A mint that is not a token → NOT_FOUND.
 */
export async function resolveToken(mint: string, opts: { rpc: string; api?: string; apiMode: boolean; fetch?: typeof fetch }): Promise<ResolvedToken> {
  if (typeof mint !== "string" || !isAddress(mint)) throw new MimirError("INVALID_INPUT", `mint must be a token mint address, got ${JSON.stringify(mint)}`, "never", { hint: "Pass the token's mint address: createFeed({ mint })." });
  if (mint === USDC_QUOTE_MINT || mint === SOL_QUOTE_MINT) throw new MimirError("INVALID_INPUT", "USDC and SOL are the quotes, not a token to price", "never", { hint: "Read it with mimir.price('SOL')." });
  if (opts.apiMode) {
    const item = (await api.tokens(opts.api, mint, opts.fetch)).find((t: TokenItem) => t.mint === mint);
    if (item?.verified && item.symbol) return { mint, symbol: item.symbol, verified: true, warnings: [] };
  }
  const read = await readMintSymbol(opts.rpc, mint);
  if (!read.mint) throw new MimirError("NOT_FOUND", `${mint} is not a token mint`, "never", { hint: "Pass the token's mint address." });
  return { mint, symbol: read.symbol ?? "", verified: false, warnings: [`${mint}: the symbol comes from the token's own metadata, not a verified list`] };
}

/** The ticker candidates of a symbol: upper-cased A–Z0–9, 12 characters, then suffixes 1–19; a one-letter symbol starts at its "1". */
export function tickerCandidates(symbol: string, fallback: string): string[] {
  const base = (symbol.toUpperCase().replace(/[^A-Z0-9]/g, "") || fallback.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)).slice(0, 12);
  const suffixed = Array.from({ length: 19 }, (_, i) => `${base.slice(0, 12 - String(i + 1).length)}${i + 1}`);
  return base.length === 1 ? suffixed : [base, ...suffixed];
}

/** The first free ticker for `symbol`, in one `getMultipleAccounts` of ≤ 20 ticker claims. All taken → TICKER_TAKEN. */
export async function autoTicker(symbol: string, rpc: string, fallback = "FEED"): Promise<string> {
  const program = MIMIR_V1_MAINNET_PROGRAM_ID as Address, list = tickerCandidates(symbol, fallback);
  const claims = await Promise.all(list.map(async (t) => (await findMimirV1TickerClaimPda(program, t))[0] as string));
  const { accounts } = await getMultipleAccounts(rpc, claims);
  const i = accounts.findIndex((a) => a === null);
  if (i < 0) throw new MimirError("TICKER_TAKEN", `${list[0]} and its suffixes 1-19 are all claimed`, "never", { hint: "Choose another ticker, or omit ticker to get a free one." });
  return list[i]!;
}

export type ExistingFeed = { feed: string; ticker: string; quote: "USDC" | "SOL"; creator: string; priced: boolean };

/** The classic feeds of `mint` against USDC and SOL, variants 0–16, in one `getMultipleAccounts` of 34 PDAs. */
export async function existingFeeds(mint: string, rpc: string): Promise<ExistingFeed[]> {
  const program = MIMIR_V1_MAINNET_PROGRAM_ID as Address;
  const keys = await Promise.all((["USDC", "SOL"] as const).flatMap((quote) => Array.from({ length: 17 }, async (_, v) => ({ quote,
    pda: (await findMimirV1ClassicFeedPda(program, await deriveMimirV1ClassicFeedId(mint as Address, (quote === "SOL" ? SOL_QUOTE_MINT : USDC_QUOTE_MINT), v)))[0] as string }))));
  const read = await getMultipleAccounts(rpc, keys.map((k) => k.pda));
  const out: ExistingFeed[] = [];
  for (const [i, a] of read.accounts.entries()) {
    if (!a || a.owner !== program) continue;
    try {
      const p = await decodePrice(a, { slot: read.slot }), v1 = decodeV1ClassicFeed(a.data, a.address as Address);
      out.push({ feed: a.address, ticker: p.ticker, quote: keys[i]!.quote, creator: v1.owner.creator as string, priced: v1.proof !== null });
    } catch { /* not a live feed */ }
  }
  return out;
}
