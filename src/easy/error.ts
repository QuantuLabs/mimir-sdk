import type { StepReceiptJson } from "../mimir.js";
/** Deployed Mimir program on mainnet. */
export const MIMIR_MAINNET_PROGRAM = "hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR";
export const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
/** Mimir's free keyless read API (no RPC): prices, token search, pool candidates. */
export const DEFAULT_API = "https://api.mimirfeeds.io";

export type MimirErrorCode =
  | "NOT_FOUND" | "TICKER_NOT_FOUND" | "TICKER_MISMATCH" | "NOT_A_FEED" | "WRONG_OWNER" | "EXECUTABLE" | "WRONG_ADDRESS"
  | "GENERATION_MISMATCH" | "CLOSED_PROGRAM" | "MALFORMED" | "INVALID_INPUT" | "RPC" | "EXPIRED" | "PLAN_STALE" | "UNKNOWN"
  | "TICKER_TAKEN" | "UNPRICEABLE" | "INSUFFICIENT_SOL" | "SWAP_UNAVAILABLE" | "REVIEW_CHANGED" | "NOT_SUPPORTED"
  | "NO_WALLET" | "WALLET_UNSUPPORTED" | "WALLET_REJECTED" | "TOKEN_AMBIGUOUS" | "FEED_EXISTS" | "NO_POOL" | "PENDING" | "INSUFFICIENT_COLA"
  | "RATE_LIMITED" | "CAPACITY" | "UPSTREAM_UNAVAILABLE" | "COMPOSITE_CHILD_MULTI_ROW"
  | "CLASSIC_NATIVE_NOT_READY" | "CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT";

/** What to do next: retry now (rebuild from fresh reads), after an in-tx refresh, later, or never. */
export type MimirRetry = "now" | "after-refresh" | "later" | "never";

export const HINTS: Record<MimirRetry, string> = {
  now: "Rebuild the transaction from fresh reads and retry.",
  "after-refresh": "Put the Mimir refresh before your instruction in the same transaction (withFreshPrice).",
  later: "Unavailable right now; retry in a few seconds (an HTTP 429 says how long in Retry-After).",
  never: "Retrying will not help; check the feed, program id and accounts.",
};

const CODE_HINTS: Partial<Record<MimirErrorCode, (message: string) => string>> = {
  TICKER_NOT_FOUND: () => "List feeds with listFeeds({ rpc }) or browse app.mimirfeeds.io, or pass a feed address.",
  INVALID_INPUT: (message) => `Fix this input: ${message}.`,
  TICKER_TAKEN: () => "Choose another ticker, or omit ticker to get a free one.",
  INSUFFICIENT_SOL: () => "Fund the payer with the amount in the message, then call createFeed again. Nothing was sent.",
  NOT_SUPPORTED: (message) => /devnet/.test(message) ? "Use cluster: 'mainnet' (the default)." : "Use recipe default, native-bounded or current-point.",
  NO_WALLET: () => "Pass a wallet: new Mimir({ wallet }). To only see the plan and cost: createFeed({ mint, dryRun: true }).",
  WALLET_UNSUPPORTED: () => "Use a key pair, a @solana/kit signer, or a Wallet Standard wallet that signs Transaction v1 (wallet-adapter: pass useWallet().wallet).",
  WALLET_REJECTED: () => "Nothing was sent for this step. Call createFeed again with `after: error.signatures`.",
  REVIEW_CHANGED: () => "Nothing was sent. Approve the transaction as shown, without edits.",
  EXPIRED: () => "Approve within about 25 s, then call createFeed again with `after: error.signatures`.",
  NOT_FOUND: () => "Check the ticker at app.mimirfeeds.io, or create it: createFeed({ mint }).",
  TOKEN_AMBIGUOUS: () => "Pass the mint you mean: createFeed({ mint: '<mint>' }).",
  FEED_EXISTS: () => "Read it with mimir.price('<ticker>'), or pass variant: 'new' to create your own.",
  NO_POOL: () => "No Orca, Raydium, Meteora or PumpSwap pool can price this token.",
  UNPRICEABLE: () => "Choose other pools, or call again with `after: error.signatures` once they price: a COLA purchase that landed is kept and reused.",
  PENDING: () => "Call createFeed again with `after: error.signatures`: the COLA bought is reused.",
  RATE_LIMITED: () => "Retry after the wait in the message, or pass your own { rpc } to read on chain.",
  CAPACITY: () => "Retry in a few seconds, or pass your own { rpc } to read on chain.",
  COMPOSITE_CHILD_MULTI_ROW: () => "Pass the token's one-row feed, or create one first: createFeed({ mint, pools: [onePool] }).",
  UPSTREAM_UNAVAILABLE: () => "Retry later, or read on chain with your own { rpc }.",
  CLASSIC_NATIVE_NOT_READY: () => "The pool's native price history is not ready; retry after a fresh swap, or choose recipe default.",
  CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT: () => "Use the same recipe on every pool: all default, or native-bounded on every venue.",
};

const SDK_CODES: Partial<Record<MimirErrorCode, MimirRetry>> = { CLASSIC_NATIVE_NOT_READY: "later", CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT: "never" };
/** @internal The message of any thrown value: a raw RPC error object is shown as JSON, never `[object Object]`. */
export const messageOf = (error: unknown): string => {
  const m = (error as Error)?.message ?? error;
  if (typeof m === "string") return m;
  try { return JSON.stringify(m, (_k, v) => typeof v === "bigint" ? String(v) : v) ?? String(m); } catch { return String(m); }
};
/** @internal Simulation and send failures that are not program errors: a missing fee payer, an expired blockhash. */
export const plainError = (error: unknown, message: string): MimirError | null => {
  if (/AccountNotFound/.test(message)) return new MimirError("INSUFFICIENT_SOL", "the fee payer has no SOL on this network (AccountNotFound)", "never",
    { cause: error, hint: "Fund the payer, or pass the address of a funded one." });
  if (/blockhash ?not ?found/i.test(message)) return new MimirError("EXPIRED", message, "now", { cause: error });
  return null;
};

/** @internal A typed SDK refusal carried by a lower-level error, or null. */
export const sdkCodeError = (error: unknown): MimirError | null => {
  const code = (error as { code?: unknown })?.code as MimirErrorCode;
  const retry = typeof code === "string" ? SDK_CODES[code] : undefined;
  return retry ? new MimirError(code, String((error as Error).message ?? error), retry, { cause: error }) : null;
};

/** Every error the easy API throws. `code` is a Mimir program error number or an SDK code. */
export class MimirError extends Error {
  override readonly name: string;
  readonly hint: string;
  /** Token search: the verified tokens that share the symbol (`TOKEN_AMBIGUOUS`) or the nearest ones (`NOT_FOUND`). */
  readonly candidates?: readonly { mint: string; symbol: string; name: string; verified: boolean }[];
  /** `FEED_EXISTS`: the feeds already priced for this token. */
  readonly feeds?: readonly { feed: string; ticker: string; quote: string }[];
  /** Creation: the steps that landed before this error. */
  readonly signatures?: StepReceiptJson[];
  constructor(readonly code: number | MimirErrorCode, message: string, readonly retry: MimirRetry,
    options?: { name?: string; hint?: string; cause?: unknown; candidates?: MimirError["candidates"]; feeds?: MimirError["feeds"]; signatures?: MimirError["signatures"] }) {
    super(message, { cause: options?.cause });
    this.name = options?.name ?? String(code);
    this.hint = options?.hint ?? (typeof code === "string" ? CODE_HINTS[code]?.(message) : undefined) ?? HINTS[retry];
    for (const k of ["candidates", "feeds", "signatures"] as const) if (options?.[k]) Object.defineProperty(this, k, { value: options[k], enumerable: true });
  }

  /**
   * Classifies any error (a failed send or simulation, an RPC error) into a `MimirError`. Without program logs naming Mimir, a
   * custom error is Mimir's only when `instructions` (the transaction's) puts Mimir at the failing index.
   */
  static from(error: unknown, options: { program?: string; instructions?: readonly { programAddress: string }[] } = {}): MimirError {
    if (error instanceof MimirError) return error;
    return classify(error, options);
  }
}

type Classify = (error: unknown, options: { program?: string; instructions?: readonly { programAddress: string }[] }) => MimirError;
/** Without the program-error parser loaded (any send, simulation or RPC read loads it): transport, expiry and Mimir's custom error number from the logs. */
let classify: Classify = (error, options) => {
  const message = messageOf(error);
  const other = (code: MimirErrorCode, retry: MimirRetry) => new MimirError(code, message, retry, { cause: error });
  if ((error as { code?: unknown })?.code === "PLAN_STALE") return other("PLAN_STALE", "now");
  const typed = sdkCodeError(error) ?? plainError(error, message); if (typed) return typed;
  if ((error as Error)?.name === "TransactionExpiredBlockheightExceededError" || /block ?height exceeded/i.test(message)) return other("EXPIRED", "now");
  if (/too many requests/i.test(message)) return other("RPC", "later");
  const e = error as { logs?: unknown; context?: { logs?: unknown } } | null;
  const logs = [message, ...[e?.logs, e?.context?.logs].flat().filter((l): l is string => typeof l === "string")].join("\n");
  const custom = new RegExp(`Program ${options.program ?? MIMIR_MAINNET_PROGRAM} failed: custom program error: 0x([0-9a-f]+)`, "i").exec(logs);
  if (!custom) return other("UNKNOWN", "never");
  const code = parseInt(custom[1]!, 16), retry = retryOfProgramCode(code);
  return new MimirError(code, `Mimir program error ${code} (Custom${code})`, retry, { name: `Custom${code}`, cause: error });
};
const NOW_CODES = new Set([15, 50, 56, 59]), LATER_CODES = new Set([16, 28, 29, 30, 31, 32, 33, 93, 129, 130]);
/** @internal The retry of a Mimir program error number. */
export const retryOfProgramCode = (code: number): MimirRetry => NOW_CODES.has(code) ? "now" : code === 14 ? "after-refresh" : LATER_CODES.has(code) ? "later" : "never";
/** @internal */
export const registerMimirErrorClassifier = (fn: Classify) => { classify = fn; };
