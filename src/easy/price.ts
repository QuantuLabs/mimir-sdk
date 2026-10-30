import type { Address } from "@solana/kit";
import bs58 from "bs58";
import { isMimirBetaCohortNotConverged } from "../chunkedAccounts.js";
import { parseMimirProgramError, mimirProgramErrorUserMessage } from "../errors.js";
import { MIMIR_PRICE_STATE, mimirSnapshotPricingMode, validateDegradedSnapshot } from "../liveness.js";
import { decodeFeedSnapshotHeader } from "../internal/nativeMonoRefreshCore.js";
import { decodeMimirTickerClaim } from "../beta/codecs.js";
import { decodeV1ClassicFeed, decodeV1CompositeFeed, V1_COMPOSITE_MAGIC, V1_SNAPSHOT_MAGIC } from "../v1/decoders.js";
import { findMimirV1ClassicFeedPda, findMimirV1CompositePda, findMimirV1TickerClaimPda, MIMIR_V1_MAINNET_PROGRAM_ID } from "../v1/build.js";
import { MIMIR_V1_NATIVE_MINT } from "../v1/composite.js";
import { validateCompositePrefix } from "../v1/publication.js";
import * as C from "../v1/layout/common.js";
import * as K from "../v1/layout/classic.js";
import { DEFAULT_RPC, HINTS, MimirError, messageOf, plainError, registerMimirErrorClassifier, retryOfProgramCode, sdkCodeError, type MimirErrorCode, type MimirRetry } from "./error.js";

/** Deployed Mimir programs. Devnet has no live Mimir deployment. */
export const MIMIR_PROGRAM_IDS = Object.freeze({ mainnet: MIMIR_V1_MAINNET_PROGRAM_ID });
/** Closed deployments: nothing may resolve to them. */
const CLOSED_PROGRAM_IDS: readonly string[] = ["hMuPDstPQEb5uaYc6d5N18Rz4srL1Bewc5fYibMimiR"];
export { DEFAULT_RPC } from "./error.js";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** A Mimir price: one shape for token feeds and indexes. */
export type Price = {
  /** The feed account address. */
  feed: string;
  ticker: string;
  kind: "token" | "index";
  /** Generation of the feed account; pin (feed, generation) onchain. */
  generation: bigint;
  /** "USDC", "SOL", or the quote mint. */
  quote: "USDC" | "SOL" | string;
  /** Display only; use `priceX64` or `mantissa`/`exponent` for exact math. Null when `status` is "none". */
  price: number | null;
  priceX64: bigint | null;
  lowerX64: bigint | null;
  upperX64: bigint | null;
  /** `price = mantissa × 10^exponent`. */
  mantissa: bigint | null;
  /** The exponent of `mantissa`; on a converted price (`mantissa` null), of `native.mantissa`. */
  exponent: number;
  /**
   * "fresh": a Fresh publication valid at the read slot.
   * "needs-refresh": the last Fresh publication, past its validity window. To use it onchain, put the refresh in the same
   *   transaction (`withFreshPrice`).
   * "degraded": a Degraded carry of the last good price, or a price whose quote asset is off peg or unknown: display it, do
   *   not trade on it.
   * "none": no price.
   */
  status: "fresh" | "needs-refresh" | "degraded" | "none";
  /**
   * "current-point": one pool's price at this slot, no history; cap what you risk on it. "standard": the feed's recipe (TWAP or
   * several sources). Read from the Fresh publication; "standard" when there is none.
   */
  mode: "standard" | "current-point";
  /**
   * True when the price is what an in-tx refresh would record now (simulated, never sent), not onchain state: onchain, put the
   * refresh in your transaction (`withFreshPrice`). False for a read of the stored account.
   */
  live: boolean;
  /** Set when a live read was asked but its simulation failed: this is the stored price (`live: false`). Check `ageSlots`. */
  liveError?: MimirErrorCode;
  confidenceBps: number;
  dispersionBps: number;
  /** Slot of the price (an index: its oldest component). */
  slot: bigint;
  validUntilSlot: bigint;
  /** Read slot − `slot`, floored at 0. */
  ageSlots: bigint;
  unixTs: number;
  /** Where it came from: the Mimir API's live shadow or stored snapshot, an RPC read of storage, or a simulated refresh. */
  source?: "shadow" | "storage" | "simulation";
  /**
   * Set when the feed's own quote is not USDC: `price` and `quote` are then in USDC (through Mimir's own SOL/USDC feed), the top-level
   * exact fields are null, and this holds the feed's native price with its exact fields.
   */
  native?: { price: number | null; quote: "SOL" | string; priceX64: bigint | null; lowerX64: bigint | null; upperX64: bigint | null; mantissa: bigint | null; exponent: number };
  /** Indexes only. */
  components?: { feed: string; quantity: number; priceX64: bigint; slot: bigint }[];
};

/** An account as read from the RPC: base58 `owner`, raw `data`. */
export type MimirAccount = { address: string; owner: string; executable: boolean; data: Uint8Array };

export { MimirError, DEFAULT_API } from "./error.js";
export type { MimirErrorCode, MimirRetry } from "./error.js";
registerMimirErrorClassifier((error: unknown, options: { program?: string; instructions?: readonly { programAddress: string }[] } = {}): MimirError => {
  const program = options.program ?? MIMIR_V1_MAINNET_PROGRAM_ID;
  const message = messageOf(error);
  const other = (code: MimirErrorCode, retry: MimirRetry) => new MimirError(code, message, retry, { cause: error });
  if ((error as { code?: unknown })?.code === "PLAN_STALE") return other("PLAN_STALE", "now");
  const typed = sdkCodeError(error) ?? plainError(error, message); if (typed) return typed;
  if ((error as Error)?.name === "TransactionExpiredBlockheightExceededError" || /block ?height exceeded/i.test(message)) return other("EXPIRED", "now");
  if (/too many requests/i.test(message)) return other("RPC", "later");
  if (isMimirBetaCohortNotConverged(error)) return other("RPC", "now");
  const parsed = parseMimirProgramError(error, { programId: program });
  const named = parsed !== null && `${parsed.rawMessage}\n${parsed.logs.join("\n")}`.includes(program);
  if (!parsed || (!named && options.instructions?.[parsed.instructionIndex ?? -1]?.programAddress !== program)) return other("UNKNOWN", "never");
  const retry = retryOfProgramCode(parsed.code);
  const name = parsed.name ?? `Custom${parsed.code}`;
  return new MimirError(parsed.code, `Mimir program error ${parsed.code} (${name})`, retry,
    { name, hint: mimirProgramErrorUserMessage(parsed) ?? HINTS[retry], cause: error });
});

const fail = (code: MimirErrorCode, message: string, retry: MimirRetry = "never", cause?: unknown): never => {
  throw new MimirError(code, message, retry, { cause });
};

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(1, 1 + Math.min(bytes[0] ?? 0, bytes.length - 1)));
const quoteName = (mint: string) => (mint === USDC_MINT ? "USDC" : mint === MIMIR_V1_NATIVE_MINT ? "SOL" : mint);
const startsWith = (data: Uint8Array, magic: Uint8Array) => data.length >= 8 && magic.every((b, i) => data[i] === b);
const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const display = (x64: bigint | null) => (x64 === null ? null : Number(x64) / 2 ** 64);
const ageOf = (slot: bigint, at: bigint) => (slot > at ? slot - at : 0n);

type Quote = { priceX64: bigint; lowerX64: bigint; upperX64: bigint; mantissa: bigint; slot: bigint; validUntilSlot: bigint };

/** Fresh only when recorded, quote-ok, bounded and inside [slot, validUntil] at the read slot. Routeability is the consumer's policy. */
const isFreshAt = (q: Quote, s: { revision: bigint; quoteStatus: number }, slot: bigint) =>
  s.revision > 0n && s.quoteStatus === 0 && q.lowerX64 > 0n && q.slot <= slot && slot <= q.validUntilSlot;

function priceFields(status: Price["status"], q: Quote | null, readSlot: bigint, publicationSlot: bigint) {
  const slot = q?.slot ?? publicationSlot;
  return {
    status, live: false, price: display(q?.priceX64 ?? null), priceX64: q?.priceX64 ?? null, lowerX64: q?.lowerX64 ?? null,
    upperX64: q?.upperX64 ?? null, mantissa: q?.mantissa ?? null, slot, validUntilSlot: q?.validUntilSlot ?? 0n, ageSlots: ageOf(readSlot, slot),
  };
}

/**
 * The one authenticated read of a Mimir feed account: owner == the program (never a closed one), not executable, self-address and
 * PDA re-derived, generation when pinned, then the status from the snapshot (a Degraded carry is never "fresh") and the age at `slot`.
 */
export async function decodePrice(account: MimirAccount, ctx: { slot: bigint | number; program?: string; generation?: bigint }): Promise<Price> {
  const program = ctx.program ?? MIMIR_V1_MAINNET_PROGRAM_ID;
  const readSlot = BigInt(ctx.slot);
  if (CLOSED_PROGRAM_IDS.includes(program) || CLOSED_PROGRAM_IDS.includes(account.owner)) {
    fail("CLOSED_PROGRAM", `${account.owner === program ? program : account.owner} is a closed Mimir deployment`);
  }
  if (account.owner !== program) fail("WRONG_OWNER", `${account.address} is owned by ${account.owner}, not ${program}`);
  if (account.executable) fail("EXECUTABLE", `${account.address} is executable`);
  const data = account.data;
  const composite = startsWith(data, V1_COMPOSITE_MAGIC);
  if (!composite && !startsWith(data, V1_SNAPSHOT_MAGIC)) fail("NOT_A_FEED", `${account.address} is not a Mimir feed`);
  if (data.length < C.PREFIX_SELF_ADDRESS + 32 || bs58.encode(data.subarray(C.PREFIX_SELF_ADDRESS, C.PREFIX_SELF_ADDRESS + 32)) !== account.address) {
    fail("WRONG_ADDRESS", `${account.address} holds another feed's snapshot`);
  }
  const decode = <T>(f: () => T): T => { try { return f(); } catch (e) { return fail("MALFORMED", `${account.address}: ${(e as Error).message}`, "never", e); } };
  const p = program as Address;
  const mode = mimirSnapshotPricingMode(data) ?? "standard";
  if (!composite) {
    const feed = decode(() => decodeV1ClassicFeed(data, account.address as Address));
    const [pda, bump] = await findMimirV1ClassicFeedPda(p, bs58.encode(feed.feedId) as Address);
    if (pda !== account.address || bump !== feed.header.bump) fail("WRONG_ADDRESS", `${account.address} is not the feed PDA of its feed id`);
    if (ctx.generation !== undefined && feed.owner.generation !== ctx.generation) {
      fail("GENERATION_MISMATCH", `${account.address} generation ${feed.owner.generation} != pinned ${ctx.generation}`);
    }
    const s = feed.prefix;
    const h = decode(() => decodeFeedSnapshotHeader(s));
    const base = { feed: account.address, ticker: text(feed.definition.ticker), kind: "token" as const, generation: feed.owner.generation,
      quote: quoteName(bs58.encode(feed.definition.feedImage.subarray(K.CFG_OFFSET_QUOTE_MINT, K.CFG_OFFSET_QUOTE_MINT + 32))),
      exponent: h.priceExponent, unixTs: Number(h.snapshotUnixTs), mode };
    const q: Quote = { priceX64: h.priceX64, lowerX64: h.priceLowerX64, upperX64: h.priceUpperX64, mantissa: h.priceMantissa,
      slot: h.snapshotSlot, validUntilSlot: h.validUntilSlot };
    const none = { ...base, ...priceFields("none", null, readSlot, h.snapshotSlot), confidenceBps: 0, dispersionBps: 0 };
    if (feed.header.status !== C.STATUS_ACTIVE) return none;
    if (s[K.OFFSET_STATUS] === 1) {
      const degraded = decode(() => validateDegradedSnapshot(s));
      if (!degraded.lastUsable || degraded.liveness.priceState === MIMIR_PRICE_STATE.NO_PRICE) {
        return { ...none, ...priceFields("none", null, readSlot, degraded.liveness.publicationSlot) };
      }
      const u = degraded.lastUsable;
      return { ...base, ...priceFields("degraded", { ...q, priceX64: u.priceX64, lowerX64: u.lowerX64, upperX64: u.upperX64, slot: u.slot }, readSlot, u.slot),
        unixTs: Number(u.unix), confidenceBps: h.confidenceBps, dispersionBps: h.dispersionBps };
    }
    if (s[K.OFFSET_STATUS] !== 0 || h.snapshotRevision === 0n || h.priceX64 === 0n || h.priceLowerX64 === 0n) return none;
    const status = h.quoteStatus !== 0 ? "degraded" : isFreshAt(q, { revision: h.snapshotRevision, quoteStatus: h.quoteStatus }, readSlot) ? "fresh" : "needs-refresh";
    return { ...base, ...priceFields(status, q, readSlot, h.snapshotSlot), confidenceBps: h.confidenceBps, dispersionBps: h.dispersionBps };
  }
  const feed = decode(() => decodeV1CompositeFeed(data, account.address as Address));
  const [pda, bump] = await findMimirV1CompositePda(p, bs58.encode(feed.config.feedId) as Address);
  if (pda !== account.address || bump !== feed.header.bump) fail("WRONG_ADDRESS", `${account.address} is not the index PDA of its feed id`);
  if (ctx.generation !== undefined && feed.owner.generation !== ctx.generation) {
    fail("GENERATION_MISMATCH", `${account.address} generation ${feed.owner.generation} != pinned ${ctx.generation}`);
  }
  const s = feed.snapshot;
  const components = await Promise.all(feed.config.components.map(async (c, i) => ({
    feed: (await findMimirV1ClassicFeedPda(p, bs58.encode(c.feedId) as Address))[0] as string,
    quantity: Number(c.quantityX64) / 2 ** 64, priceX64: s.components[i]!.priceX64, slot: s.components[i]!.snapshotSlot,
  })));
  const base = { feed: account.address, ticker: text(feed.config.ticker), kind: "index" as const, generation: feed.owner.generation, quote: quoteName(feed.config.quoteMint),
    exponent: s.priceExponent, unixTs: Number(s.unixTs), mode, components };
  const q: Quote = { priceX64: s.priceX64, lowerX64: s.priceLowerX64, upperX64: s.priceUpperX64, mantissa: s.priceMantissa,
    slot: s.oldestComponentSnapshotSlot, validUntilSlot: s.validUntilSlot };
  const none = { ...base, ...priceFields("none", null, readSlot, s.snapshotSlot), confidenceBps: 0, dispersionBps: 0 };
  if (feed.header.status !== C.STATUS_ACTIVE || s.revision === 0n) return none;
  decode(() => validateCompositePrefix(data));
  if (s.status === 1 && s.priceState === MIMIR_PRICE_STATE.NO_PRICE) return none;
  const status = s.status === 1 || s.quoteStatus !== 0 ? "degraded" : isFreshAt(q, { revision: s.revision, quoteStatus: s.quoteStatus }, readSlot) ? "fresh" : "needs-refresh";
  return { ...base, ...priceFields(status, q, readSlot, q.slot), confidenceBps: s.confidenceBps, dispersionBps: s.dispersionBps };
}

export type PriceOptions = { rpc?: string; program?: string };


type RpcAccount = { data: [string, string]; owner: string; executable: boolean } | null;

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const RETRY_BUDGET_MS = 20_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One read-only JSON-RPC call; transport and RPC errors become a `MimirError` "RPC". HTTP 429/503 is retried twice, never before
 * Retry-After (seconds or HTTP-date) or else after 1 s then 2 s, within 20 s in total; a longer requested wait fails at once. Internal to the easy API.
 */
export async function rpcCall<T>(rpc: string, method: string, params: unknown[]): Promise<T> {
  const host = (() => { try { return new URL(rpc).host; } catch { return "rpc"; } })();
  let body: { result?: T; error?: { code: number; message: string } };
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if ((res.status === 429 || res.status === 503) && attempt < 2) {
        const h = res.headers.get("retry-after")?.trim() ?? "";
        const asked = /^\d+$/.test(h) ? Number(h) * 1000 : h ? Date.parse(h) - Date.now() : NaN;
        const delay = Number.isFinite(asked) ? Math.max(asked, 0) : 1000 * 2 ** attempt;
        if (waited + delay > RETRY_BUDGET_MS) {
          throw new MimirError("RPC", `${host} answered HTTP ${res.status}`, "later", { hint: `The RPC asked to wait ${Math.ceil(delay / 1000)} s before retrying; retry then, or pass your own { rpc }.` });
        }
        await sleep(delay);
        waited += delay;
        continue;
      }
      if (res.status === 403) {
        throw new MimirError("RPC", `${host} answered HTTP 403`, "never", { hint: "This RPC refuses the request. Solana's public mainnet RPC refuses browser origins: pass your own { rpc }." });
      }
      if (!res.ok) return fail("RPC", `${host} answered HTTP ${res.status}`, res.status === 429 || res.status >= 500 ? "later" : "never");
      body = await res.json();
      break;
    } catch (e) {
      if (e instanceof MimirError) throw e;
      return fail("RPC", `${host}: request failed`, "later", e);
    }
  }
  return body.result ?? fail("RPC", `${method}: ${body.error?.message ?? "no result"}`, "later");
}

export async function getMultipleAccounts(rpc: string, keys: readonly string[]): Promise<{ slot: bigint; accounts: (MimirAccount | null)[] }> {
  let slot = 0n;
  const accounts: (MimirAccount | null)[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const result = await rpcCall<{ context: { slot: number }; value: RpcAccount[] }>(rpc, "getMultipleAccounts", [chunk, { encoding: "base64", commitment: "confirmed" }]);
    if (BigInt(result.context.slot) > slot) slot = BigInt(result.context.slot);
    result.value.forEach((a, j) => accounts.push(a && { address: chunk[j]!, owner: a.owner, executable: a.executable, data: fromBase64(a.data[0]) }));
  }
  return { slot, accounts };
}

const isAddress = (s: string) => { try { return s.length >= 32 && bs58.decode(s).length === 32; } catch { return false; } };

/** Feed or ticker → the feed account, in one `getMultipleAccounts` for the tickers and one for the feeds. Internal to the easy API. */
export async function readFeeds(list: readonly string[], opts: PriceOptions = {}) {
  const rpc = opts.rpc ?? DEFAULT_RPC;
  const program = opts.program ?? MIMIR_V1_MAINNET_PROGRAM_ID;
  if (CLOSED_PROGRAM_IDS.includes(program)) fail("CLOSED_PROGRAM", `${program} is a closed Mimir deployment`);
  const tickers = list.map((x) => (isAddress(x) ? null : x.trim().toUpperCase()));
  const claims = await Promise.all(tickers.map(async (t) => {
    if (t === null) return null;
    try { return (await findMimirV1TickerClaimPda(program as Address, t))[0] as string; } catch (e) { return fail("INVALID_INPUT", `"${t}" is neither a feed address nor a ticker`, "never", e); }
  }));
  const claimKeys = claims.filter((c): c is string => c !== null);
  const read = claimKeys.length ? await getMultipleAccounts(rpc, claimKeys) : { slot: 0n, accounts: [] };
  const byClaim = new Map(claimKeys.map((k, i) => [k, read.accounts[i]!] as const));
  const addresses = list.map((x, i) => {
    if (claims[i] === null) return x;
    const claim = byClaim.get(claims[i]!);
    if (!claim) return fail("TICKER_NOT_FOUND", `No Mimir ticker ${tickers[i]}`);
    if (claim.owner !== program) return fail("WRONG_OWNER", `ticker ${tickers[i]} account is owned by ${claim.owner}`);
    try { return decodeMimirTickerClaim(claim.data).config as string; } catch (e) { return fail("MALFORMED", `ticker ${tickers[i]}: ${(e as Error).message}`, "never", e); }
  });
  const unique = [...new Set(addresses)];
  const feeds = await getMultipleAccounts(rpc, unique);
  const byFeed = new Map(unique.map((k, i) => [k, feeds.accounts[i]!] as const));
  return { program, rpc, slot: feeds.slot, tickers, accounts: addresses.map((a) => byFeed.get(a) ?? fail("NOT_FOUND", `No account at ${a}`)) };
}
