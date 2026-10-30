import { DEFAULT_API, DEFAULT_RPC, MimirError, type MimirRetry } from "./easy/error.js";
import type { Price as ChainPrice } from "./easy/price.js";
import { api, CODES, fromChain, priceFromJson, retryOf, type Price } from "./api/client.js";
import { normaliseWallet, type MimirSigner, type WalletInput } from "./wallet.js";
import type * as Facade from "./create/facade.js";
import type { BuildSwap } from "./create/collateral-quote.js";
import type { RecommendRequire } from "./create/recommend.js";

export type MimirOptions = {
  /** Signs the create steps; omit for read-only. */
  wallet?: WalletInput;
  /** Your RPC: every read and transaction goes there, nothing to the Mimir API. Without it, reads use the Mimir API and transactions Solana's public RPC. */
  rpc?: string;
  cluster?: "mainnet" | "devnet";
  /** @advanced The Mimir API base, for self-hosting or tests. */
  api?: string;
  /** @advanced The COLA swap route; default Jupiter's keyless build. */
  buildSwap?: BuildSwap;
};
export type StepKind = Facade.StepKind;
export type CreateEvent = Facade.StepEvent;
export type CreatedFeed = { state: "ready"; ticker: string; feed: string; price: Price;
  signatures: { kind: StepKind; signature: string; slot: bigint }[]; cost: { sol: string; lamports: bigint } };
export type CreateFeedArgs = {
  /** The token mint to price. */
  mint: string;
  /** Override; default the token's symbol, first free of SYMBOL, SYMBOL1 … SYMBOL19. */
  ticker?: string;
  /** Force the quote pools; default the recommender's pick (prices are returned in USDC either way). */
  quote?: "USDC" | "SOL";
  pools?: string[];
  recipe?: Facade.Recipe | Facade.Recipe[];
  require?: RecommendRequire;
  /** "new": create another feed when one exists for this token. */
  variant?: "new";
  onStep?: (event: CreateEvent) => unknown;
  /** Resume: the `signatures` of an interrupted run (or its error's); a COLA purchase that landed there is reused, never bought again. */
  after?: Resume;
};
export type FeedPlan = Facade.FeedPlan & { symbol: string };
export type IndexArgs = { ticker: string; components: Record<string, number | string> | Facade.CompositeComponent[]; quote?: "USDC" | "SOL"; onStep?: (event: CreateEvent) => unknown; after?: Resume };
type Resume = Facade.CreateOptions["after"];
/** `lastValidBlockHeight`: set on a sent step whose outcome is unknown (slot "0"); until the chain passes it, the step may still land. `sentSlot`: a slot before it was signed. */
export type StepReceiptJson = { kind: StepKind; signature: string; slot: string; lastValidBlockHeight?: string; sentSlot?: string };
/** The next unsigned step of a server-built creation, JSON-safe: no secret, no RPC URL. */
export type UnsignedStep = { kind: StepKind; index: number; of: number; payer: string; feed: string; transaction: string; lastValidBlockHeight: string;
  review: { debitSol: string; networkFeeSol: string; colaMinOutRaw?: string; firstPrice: boolean; reviewHash: string } };
/** The unsigned fresh-price Transaction v1 of `buildWithFreshPrice`, JSON-safe: sign it with `mimir.sign(step)`, then send the wire through your RPC before `lastValidBlockHeight`. */
export type FreshPriceStep = Omit<UnsignedStep, "kind" | "feed"> & { kind: "fresh-price"; feeds: string[] };
export type ServerStep = { state: "sign"; step: UnsignedStep; after: StepReceiptJson[] }
  | { state: "ready"; ticker: string; feed: string; price: PriceJson; signatures: StepReceiptJson[]; cost: { sol: string }; after: StepReceiptJson[] };
export type PriceJson = Record<string, string | number | boolean | null | object>;
type SplitArgs = { skipSend: true; payer: string; resume?: ServerStep; signed?: string };

const SOL = (l: bigint) => { const s = (l < 0n ? -l : l).toString().padStart(10, "0"); return `${l < 0n ? "-" : ""}${s.slice(0, -9)}.${s.slice(-9)}`.replace(/\.?0+$/, ""); };
const facade = () => import("./create/facade.js");
const fail = (code: "RPC" | "TICKER_MISMATCH", message: string): never => { throw new MimirError(code, message, code === "RPC" ? "later" : "never"); };
const MIN_WATCH_MS = 2_000;

/**
 * The Mimir client. `new Mimir()` reads prices from the free Mimir API; `new Mimir({ rpc })` reads on chain from your RPC only.
 * With a `wallet` it also creates feeds and indexes; transactions go to your `rpc`, else Solana's public RPC.
 */
export class Mimir {
  readonly mode: "api" | "rpc";
  readonly cluster: "mainnet" | "devnet";
  readonly #rpc: string | undefined;
  readonly #api: string;
  readonly #signer: MimirSigner | null;
  readonly #buildSwap: BuildSwap | undefined;

  constructor(opts: MimirOptions = {}) {
    if (opts.rpc !== undefined && (typeof opts.rpc !== "string" || !/^https?:\/\//.test(opts.rpc))) throw new MimirError("INVALID_INPUT", "rpc must be an http(s) URL", "never");
    this.cluster = opts.cluster ?? "mainnet";
    if (this.cluster === "devnet" && !opts.rpc) throw new MimirError("INVALID_INPUT", "devnet needs your rpc: the Mimir API serves mainnet", "never", { hint: "Pass new Mimir({ cluster: 'devnet', rpc })." });
    this.mode = opts.rpc ? "rpc" : "api";
    this.#rpc = opts.rpc;
    this.#api = opts.api ?? DEFAULT_API;
    this.#signer = opts.wallet === undefined || opts.wallet === null ? null : normaliseWallet(opts.wallet);
    this.#buildSwap = opts.buildSwap;
  }

  /** The wallet's address, or null (read-only or not connected). */
  get address(): string | null { return this.#signer?.address() ?? null; }
  get canWrite(): boolean { return this.#signer !== null; }
  toJSON() { return { mode: this.mode, cluster: this.cluster, address: this.address }; }
  [Symbol.for("nodejs.util.inspect.custom")]() { return `Mimir ${JSON.stringify(this.toJSON())}`; }

  get #txRpc() { return this.#rpc ?? DEFAULT_RPC; }
  #devnet() { if (this.cluster === "devnet") throw new MimirError("NOT_SUPPORTED", "Mimir has no published devnet deployment yet", "never", { hint: "Use cluster: 'mainnet' (the default)." }); }

  /** One price, in USDC. A ticker or a feed address. */
  async price(feedOrTicker: string): Promise<Price> { return (await this.prices([feedOrTicker]))[0]!; }

  /** Several prices in input order, in USDC. API mode: one request per 30 feeds. RPC mode: read in one slot, simulated live when not fresh. */
  async prices(list: readonly string[]): Promise<Price[]> {
    if (!Array.isArray(list) || !list.length || list.some((x) => typeof x !== "string")) throw new MimirError("INVALID_INPUT", "pass one or more tickers or feed addresses", "never");
    this.#devnet();
    let out: Price[];
    if (this.mode === "rpc") {
      const { getPrices } = await import("./easy/refresh.js");
      out = await this.#toUsdc(await getPrices(list, { rpc: this.#rpc! }));
    } else {
      const unique = [...new Set(list)], got = new Map<string, Price>();
      for (let i = 0; i < unique.length; i += 30) {
        for (const item of await api.prices(this.#api, unique.slice(i, i + 30))) {
          if ("error" in item) { const code = item.error.code ?? ""; throw new MimirError(CODES.has(code) ? code as never : "NOT_FOUND", `${item.input}: ${code || "no price"}`, retryOf(code), item.error.hint ? { hint: item.error.hint } : undefined); }
          got.set(item.input, priceFromJson(item.feed));
        }
      }
      out = list.map((x) => {
        const p = got.get(x) ?? fail("RPC", `the Mimir API answered no item for ${x}`);
        if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x) ? p.address !== x : p.ticker !== x.trim().toUpperCase()) fail("TICKER_MISMATCH", `${x} answered ${p.address} (${p.ticker})`);
        return p;
      });
    }
    return out;
  }

  /**
   * Calls `onPrice` with each price every `intervalMs` (default 5,000, minimum 2,000): one batch request per tick in API mode.
   * `onError` gets a `MimirError`; one with `retry: "never"` stops the watch. Returns the unsubscribe function.
   */
  watch(feeds: readonly string[], onPrice: (price: Price) => void, onError?: (error: MimirError) => void, opts: { intervalMs?: number } = {}): () => void {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const every = Number.isFinite(opts.intervalMs) ? Math.min(Math.max(opts.intervalMs!, MIN_WATCH_MS), 2_147_483_647) : 5_000;
    const tick = async () => {
      try { const prices = await this.prices(feeds); if (!stopped) prices.forEach(onPrice); } catch (e) {
        const error = MimirError.from(e);
        if (!stopped) onError?.(error);
        if (error.retry === "never") stopped = true;
      }
      if (!stopped) timer = setTimeout(tick, every);
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }

  /** Your instructions behind a fresh Mimir price: [compute budget, refresh(feeds), ...yours]. Same instruction type back (kit or web3.js). */
  async withFreshPrice<I>(feeds: string | readonly string[], instructions: readonly I[], opts: { payer?: string; simulate?: boolean } = {}): Promise<I[]> {
    this.#devnet();
    const payer = opts.payer ?? this.address ?? this.#noWallet("withFreshPrice needs a payer: a wallet, or { payer }");
    const { withFreshPrice } = await import("./easy/refresh.js");
    return (await withFreshPrice({ feeds, instructions: instructions as never[], payer, rpc: this.#txRpc, ...(opts.simulate ? { simulate: true } : {}) })).instructions as I[];
  }

  /**
   * Builds, simulates, signs with the wallet, sends and confirms one Transaction v1: [compute budget, refresh(feeds), ...yours].
   * Fits every feed, indexes included. Prices that move during the approval rebuild it once. Instructions: kit or web3.js.
   */
  async sendWithFreshPrice<I>(feeds: string | readonly string[], instructions: readonly I[], opts: { commitment?: "confirmed" | "finalized" } = {}): Promise<{ signature: string; slot: bigint }> {
    this.#devnet();
    const payer = this.#payer(), f = await facade(), rpc = f.facadeRpc(this.#txRpc);
    for (let attempt = 0; ; attempt++) {
      const t = await f.freshPriceTransaction(this.#txRpc, feeds, instructions, payer);
      const signed = await this.#signer!.sign(t, { ...freshStep(t, payer, feeds), transaction: t });
      const { signature } = await f.admitSigned(t, payer, signed);
      const err = (await rpc.simulateTransaction((await import("./beta/bytes.js")).base64(signed) as never, { encoding: "base64", sigVerify: true, commitment: "confirmed" } as never).send().catch(() => undefined))?.value?.err;
      if (err && attempt === 0) continue;
      if (err) throw new MimirError("PLAN_STALE", `the signed transaction no longer simulates (${JSON.stringify(err, (_k, v) => typeof v === "bigint" ? Number(v) : v)}); nothing was sent`, "now");
      const { outcome, slot } = await f.submit(rpc, this.#txRpc.replace(/^http/, "ws"), signed, signature, t.lastValidBlockHeight, undefined, this.#rpc ? 1_000 : 2_000, undefined, opts.commitment ?? "confirmed");
      if (outcome === "confirmed") return { signature, slot };
      if (outcome === "expired") throw new MimirError("EXPIRED", `${signature} expired before it landed`, "now");
      if (outcome === "failed") throw new MimirError("UNKNOWN", `${signature} landed and failed`, "never");
      throw new MimirError("PENDING", `${signature} was sent; its outcome is unknown`, "later");
    }
  }

  /** The unsigned `sendWithFreshPrice` transaction for a wallet elsewhere: `mimir.sign(step)` signs it; you send the wire. */
  async buildWithFreshPrice<I>(feeds: string | readonly string[], instructions: readonly I[], opts: { payer?: string } = {}): Promise<FreshPriceStep> {
    this.#devnet();
    const payer = this.#payer(opts.payer);
    return freshStep(await (await facade()).freshPriceTransaction(this.#txRpc, feeds, instructions, payer), payer, feeds);
  }

  #noWallet(message = "this needs a wallet"): never {
    throw new MimirError("NO_WALLET", message, "never");
  }
  #payer(explicit?: string): string {
    return explicit ?? this.address ?? this.#noWallet(this.#signer ? "the wallet is not connected" : "creating a feed needs a wallet");
  }
  #sign = (step: Facade.StepToSign) => this.#signer ? this.#signer.sign(step.transaction, step) : this.#noWallet();

  /** The plan to price `mint`: token, pools (checked on chain, the app's recommender), ticker, steps and full SOL cost. Signs nothing. */
  async #plan(args: CreateFeedArgs, payer: string): Promise<FeedPlan> {
    const [{ resolveToken, existingFeeds, autoTicker }, f] = await Promise.all([import("./create/token.js"), facade()]);
    const rpc = this.#txRpc, token = await resolveToken(args.mint, { rpc, api: this.#api, apiMode: this.mode === "api" });
    const quotes = args.quote ? [args.quote] : (["USDC", "SOL"] as const);
    const existing = (await existingFeeds(args.mint, rpc)).filter((e) => quotes.includes(e.quote));
    const own = existing.find((e) => e.creator === payer && !e.priced);
    if (!own && existing.length && args.variant !== "new") {
      const first = existing[0]!, mine = existing.find((e) => e.creator === payer);
      throw new MimirError("FEED_EXISTS", `${args.mint} already has a Mimir feed: ${existing.map((e) => `${e.ticker} (${e.feed}, ${e.quote})`).join(", ")}`, "never",
        { hint: mine ? `This is your feed: read it with mimir.price('${mine.ticker}').` : `Read it with mimir.price('${first.ticker}'), or pass variant: 'new' to create your own.`, feeds: existing.map(({ feed, ticker, quote }) => ({ feed, ticker, quote })) });
    }
    let quote: "USDC" | "SOL", pools: string[] | undefined = args.pools, recipe = args.recipe, warnings = [...token.warnings];
    if (own) { quote = own.quote; }
    else if (pools) { quote = args.quote ?? "USDC"; }
    else {
      const { poolCandidates } = await import("./create/candidates.js");
      const { resolveEligiblePoolsSplit } = await import("./create/discovery.js");
      const { recommend } = await import("./create/recommend.js");
      const { SOL_QUOTE_MINT, USDC_QUOTE_MINT } = await import("./create/helpers.js");
      const kit = f.facadeRpc(rpc);
      const eligible = (await Promise.all(quotes.map(async (q) => {
        const c = await poolCandidates(args.mint, q, this.mode === "rpc" ? { rpc } : { api: this.#api });
        return c.length ? resolveEligiblePoolsSplit(kit as never, args.mint as never, (q === "SOL" ? SOL_QUOTE_MINT : USDC_QUOTE_MINT), c.map((x) => x.pool) as never) : [];
      }))).flat();
      const sol = eligible.some((p) => p.quoteMint === SOL_QUOTE_MINT) ? (await this.price("SOL").catch(() => null)) : null;
      const rec = recommend(eligible, { usdcMint: USDC_QUOTE_MINT, ...(sol?.price ? { solUsdcX64: BigInt(Math.round(sol.price * 2 ** 32)) << 32n } : {}), ...(args.require ? { require: args.require } : {}) });
      if (!rec) throw new MimirError("NO_POOL", eligible.length ? `no pool set of ${args.mint} ${args.require ? `meets ${JSON.stringify(args.require)}` : "can be scored"}` : `no eligible pool for ${args.mint}`, "never",
        { hint: `Mimir prices pools on Orca, Raydium (CLMM, CPMM, AMM v4), Meteora (DLMM, DAMM v2) and PumpSwap; none can price this token${args.quote === "USDC" ? " in USDC: try quote: 'SOL'" : ""}.` });
      quote = rec.pools[0]!.quoteMint === SOL_QUOTE_MINT ? "SOL" : "USDC";
      pools = rec.pools.map((p) => p.pool);
      recipe ??= pools.map((p) => (rec.choices[p]?.recipe ?? "default") as Facade.Recipe);
      if (quote === "SOL") warnings.push("SOL-quoted pools scored best: the feed is SOL-quoted; prices are returned in USDC through Mimir's SOL/USDC feed");
    }
    const ticker = (own?.ticker ?? args.ticker ?? await autoTicker(token.symbol, rpc, args.mint)).toUpperCase();
    const plan = await f.prepareFeed({ payer, ticker, baseMint: args.mint, quote, rpc, ...(pools ? { pools } : {}), ...(recipe ? { recipe } : {}),
      ...(this.mode === "rpc" ? { discovery: "rpc" as const } : { api: this.#api }), ...(this.#buildSwap ? { buildSwap: this.#buildSwap } : {}) });
    return { ...plan, symbol: token.symbol, warnings: [...warnings, ...plan.warnings] };
  }

  /**
   * Creates and prices a feed for a token mint: finds and checks its pools, picks a free ticker from its symbol, buys the COLA, creates
   * with the first price and waits for `finalized`. `dryRun` returns the plan and cost (no wallet needed). `skipSend` returns the next
   * unsigned step for a browser wallet (`mimir.sign(step)`), stateless between calls.
   */
  createFeed(args: CreateFeedArgs & { dryRun: true; payer?: string }): Promise<FeedPlan>;
  createFeed(args: CreateFeedArgs & SplitArgs): Promise<ServerStep>;
  createFeed(args: CreateFeedArgs): Promise<CreatedFeed>;
  async createFeed(args: CreateFeedArgs & { dryRun?: boolean; skipSend?: boolean; payer?: string; resume?: ServerStep; signed?: string }): Promise<FeedPlan | ServerStep | CreatedFeed> {
    this.#devnet();
    if (!args || typeof args !== "object" || typeof args.mint !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(args.mint)) throw new MimirError("INVALID_INPUT", "createFeed takes { mint }", "never", { hint: "Pass the token's mint address: createFeed({ mint })." });
    if (!args.dryRun && !args.skipSend) this.#payer();
    if (!this.#rpc) throw new MimirError("INVALID_INPUT", "createFeed needs rpc", "never", { hint: "Pass your RPC: new Mimir({ wallet, rpc }). The dry run needs it too." });
    const f = await facade();
    try {
      if (args.dryRun) return await this.#plan(args, args.payer ?? this.address ?? await freshPayer());
      if (args.skipSend) return await this.#server(args as CreateFeedArgs & SplitArgs, (payer) => this.#plan(args, payer),
        (plan, i) => f.prepareStep(plan as Facade.FeedPlan, i),
        async (feed, payer) => (await (await import("./create/token.js")).existingFeeds(args.mint, this.#txRpc)).some((e) => e.feed === feed && e.creator === payer));
      const payer = this.#payer();
      return await this.#run(() => this.#plan(args, payer), (plan, opts) => f.createFeed(plan as Facade.FeedPlan, opts), args.onStep, args.after ?? args.resume?.after);
    } catch (e) { return f.typed(e, args.after ?? args.resume?.after); }
  }

  /** Creates and prices an index over existing Mimir feeds: `components` maps a ticker or feed address to a quantity (2–5). */
  createIndex(args: IndexArgs & { dryRun: true; payer?: string }): Promise<Facade.CompositePlan>;
  createIndex(args: IndexArgs & SplitArgs): Promise<ServerStep>;
  createIndex(args: IndexArgs): Promise<CreatedFeed>;
  async createIndex(args: IndexArgs & { dryRun?: boolean; skipSend?: boolean; payer?: string; resume?: ServerStep; signed?: string }): Promise<Facade.CompositePlan | ServerStep | CreatedFeed> {
    this.#devnet();
    if (!args || typeof args.ticker !== "string" || !args.components) throw new MimirError("INVALID_INPUT", "createIndex takes { ticker, components }", "never");
    const f = await facade();
    const components = Array.isArray(args.components) ? args.components
      : Object.entries(args.components).map(([feed, q]) => ({ feed, quantity: typeof q === "number" ? q.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 9 }) : q }));
    const plan = (payer: string) => f.planComposite({ payer, ticker: args.ticker, components, quote: args.quote ?? "USDC", rpc: this.#txRpc,
      ...(this.#buildSwap ? { buildSwap: this.#buildSwap } : {}) }).catch((e) => {
      if (e instanceof MimirError && e.code === "NOT_FOUND" && /no feed with this ticker/.test(e.message)) {
        throw new MimirError("NOT_FOUND", e.message, "never", { hint: "Create it first: createFeed({ mint, pools: [onePool] })." });
      }
      throw e;
    });
    try {
      if (args.dryRun) return await plan(args.payer ?? this.address ?? await freshPayer());
      if (args.skipSend) return await this.#server(args as IndexArgs & SplitArgs, plan, (p, i) => f.prepareComposite(p as Facade.CompositePlan, i),
        (feed) => f.claimsFeed(f.facadeRpc(this.#txRpc), args.ticker, feed));
      const payer = this.#payer();
      return await this.#run(() => plan(payer), (p, opts) => f.createComposite(p as Facade.CompositePlan, opts), args.onStep, args.after ?? args.resume?.after);
    } catch (e) { return f.typed(e, args.after ?? args.resume?.after); }
  }

  async #run(plan: () => Promise<Facade.FeedPlan | Facade.CompositePlan>, run: (plan: Facade.FeedPlan | Facade.CompositePlan, opts: Facade.CreateOptions) => Promise<Facade.FeedReceipt>,
    onStep?: (event: CreateEvent) => unknown, after?: Resume): Promise<CreatedFeed> {
    for (let attempt = 0; ; attempt++) {
      const p = await plan();
      let spent = 0n;
      const receipt = await run(p, { rpc: this.#txRpc, rebroadcastMs: this.#rpc ? 1_000 : 2_000, ...(onStep ? { onStep } : {}), ...(after?.length ? { after } : {}),
        sign: async (step) => { const wire = await this.#sign(step); spent += step.review.debitLamports; return wire; } });
      const signatures = receipt.signatures;
      if (receipt.state === "ready" && receipt.price) {
        return { state: "ready", ticker: p.ticker, feed: p.feed, price: (await this.#toUsdc([receipt.price]))[0]!, signatures, cost: { sol: SOL(spent), lamports: spent } };
      }
      const e = receipt.error ?? new MimirError("UNPRICEABLE", `${p.ticker} was created but has no fresh price yet`, "later");
      if (e.code === "PLAN_STALE" && attempt === 0 && !signatures.length) continue;
      const sent = signatures.map((s) => ({ ...s, slot: String(s.slot) }));
      const message = e.code === "UNPRICEABLE" && signatures.length ? e.message.replace(/Nothing was sent\.?/, "The create step was not sent; the COLA bought is kept: pass after: error.signatures to reuse it.") : e.message;
      if (receipt.state === "pending") throw new MimirError("PENDING", e.message, "later", { cause: e, signatures: sent });
      throw new MimirError(e.code, message, e.retry, { hint: e.code === "RPC" && !this.#rpc ? "Pass your own { rpc } to send transactions: Solana's public RPC refuses browsers and rate-limits." : e.hint, cause: e.cause ?? e, signatures: sent });
    }
  }

  /** Onchain prices as `Price`s in USDC, SOL-quoted ones through Mimir's own SOL feed. */
  async #toUsdc(prices: ChainPrice[]): Promise<Price[]> {
    const sol = !prices.some((p) => p.quote === "SOL") ? null : prices.find((p) => p.ticker === "SOL" && p.quote === "USDC") ? fromChain(prices.find((p) => p.ticker === "SOL" && p.quote === "USDC")!) : await this.price("SOL").catch(() => null);
    return prices.map((p) => fromChain(p, sol?.price));
  }

  /** One server call of the split: send the signed step if given, then return the next unsigned step or `ready`. */
  async #server(args: SplitArgs & { onStep?: unknown }, plan: (payer: string) => Promise<Facade.FeedPlan | Facade.CompositePlan>,
    prepare: (plan: Facade.FeedPlan | Facade.CompositePlan, index: number) => Promise<Facade.StepToSign>, bound: (feed: string, payer: string) => Promise<boolean>): Promise<ServerStep> {
    const payer = args.payer ?? this.#noWallet("skipSend needs payer: the browser wallet's address");
    return (await import("./split.js")).serverStep({ args, payer, rpcUrl: this.#txRpc, rebroadcastMs: this.#rpc ? 1_000 : 2_000, plan, prepare, bound, toUsdc: (p) => this.#toUsdc(p) }) as Promise<ServerStep>;
  }

  /** The browser half of `skipSend`: checks the payer, signs once with the wallet, admits the result, returns the signed wire as base64. */
  async sign(step: UnsignedStep | FreshPriceStep): Promise<string> {
    const payer = this.#payer();
    if (step?.payer !== payer) throw new MimirError("INVALID_INPUT", `this step is for ${step?.payer}, not the wallet ${payer}`, "never");
    const tx = await (await facade()).unsignedFromWire(step);
    const signed = await this.#signer!.sign(tx, { ...step, transaction: tx });
    await (await facade()).admitSigned(tx, payer, signed);
    return (await import("./beta/bytes.js")).base64(signed);
  }
}

const freshStep = (t: Awaited<ReturnType<typeof Facade.freshPriceTransaction>>, payer: string, feeds: string | readonly string[]): FreshPriceStep => {
  const fee = SOL(5_000n * BigInt(t.requiredSigners.length) + (t.config.priorityFeeLamports ?? 0n));
  return { kind: "fresh-price", index: 1, of: 1, payer, feeds: typeof feeds === "string" ? [feeds] : [...feeds], transaction: btoa(String.fromCharCode(...t.serializedTransaction)),
    lastValidBlockHeight: String(t.lastValidBlockHeight), review: { debitSol: fee, networkFeeSol: fee, firstPrice: false, reviewHash: t.messageHash } };
};

/** A fresh random planning payer with no SOL, no COLA and no token account: the upper bound of the cost. */
const freshPayer = async () => (await import("bs58")).default.encode(crypto.getRandomValues(new Uint8Array(32)));
