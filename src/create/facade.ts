import { createSolanaRpc, getAddressDecoder, getAddressEncoder, getAddressFromPublicKey, isAddress, type Address } from '@solana/kit';
import { decodeMimirTickerClaim } from '../beta/codecs.js';
import { decodeMimirBetaTicker } from '../beta/abi.js';
import { decodeV1ClassicFeed, decodeV1CompositeFeed } from '../v1/decoders.js';
import * as K from '../v1/layout/classic.js';
import { getCompiledTransactionMessageDecoder } from '@solana/transaction-messages';
import { MimirError, DEFAULT_RPC, decodePrice, type MimirErrorCode, type Price } from '../easy/price.js';
import { refreshInstructions } from '../easy/refresh.js';
import { base64, fromBase64 } from '../beta/bytes.js';
import { MimirBetaCollateralRequiredError, MimirBetaError } from '../beta/errors.js';
import { compileMimirBetaTransactionV1, admitMimirBetaWalletSignedTransactionV1, partiallySignMimirBetaTransactionV1 } from '../beta/transactionV1.js';
import { createMimirBetaStageReceipt, type MimirBetaExpectedWrite, type MimirBetaPreparedStep, type MimirBetaUnsignedTransaction } from '../beta/review.js';
import { buildMimirBetaComputeUnitLimitInstruction } from '../beta/liveAbi.js';
import { isMimirClassicIntervalRecipe, type MimirClassicRowRecipe } from '../beta/live.js';
import type { MimirBetaEligiblePool } from '../beta/discovery.js';
import { deriveMimirV1ClassicFeedId, findMimirV1AssociatedTokenAddress, findMimirV1ClassicFeedPda, findMimirV1SourceConfigAddress, findMimirV1TickerClaimPda } from '../v1/build.js';
import { mimirV1RefreshComputeUnitLimit } from '../v1/cost.js';
import { prepareV1SimpleFeed, prepareV1CompositeFeedJourney, observeV1Operation, type V1CreationDependencies } from './v1-create.js';
import { prepareCollateralPurchase } from './collateral-purchase.js';
import { quoteTxV1Fee } from './txv1-fee.js';
import { buildQuote, type BuildSwap } from './collateral-quote.js';
import { confirmSignature } from './confirm-signature.js';
import { admittedRecipes, marketEligible } from './recipes.js';
import { CompositeExistsError, exactSol, InsufficientSolError, ReviewIntentChangedError, UnpriceableFeedError } from './errors.js';
import { readRentExemptLamports, SOL_QUOTE_MINT, tightComputeUnitLimit, USDC_QUOTE_MINT, venueLabel } from './helpers.js';
import { resolveEligiblePoolsSplit } from './discovery.js';
import { poolCandidates } from './candidates.js';
import { MIMIR_MAINNET_CLASSIC_POLICY, MIMIR_MAINNET_COLLATERAL_MINT, MIMIR_MAINNET_COMPOSITE_POLICY, MIMIR_MAINNET_DEPLOYMENT, MIMIR_MAINNET_SOL_CONVERSION_SOURCE_CONFIG } from './policy.js';

/** Sealing recipe of one pool row. "default" = spot (current-point on PumpSwap / Raydium AMM v4). */
export type Recipe = 'default' | 'native-bounded' | 'current-point'
  | 'orca-marker-quiet' | 'cpmm-quiet-interval-v2' | 'damm-onlyb-interval-v1' | 'damm-reserve-interval-v3';
/** The trade-off of one recipe on one pool. A native row may pause on a sharp jump; spot never does. */
export type RecipeChoice = { recipe: Recipe; marketEligible: boolean; mimirTransactions: 1 | 2 | 3; firstPriceAfterSeconds: number; supported: boolean };
export type PoolChoice = { pool: string; venue: string; recipes: RecipeChoice[] };
/** Without `pools`, candidates come from the Mimir API (`api`, default) or a bounded scan of the venue programs on `rpc` (`discovery: 'rpc'`). */
export type FeedArgs = { payer: string; ticker: string; baseMint: string; quote: 'USDC' | 'SOL'; pools?: string[]; recipe?: Recipe | Recipe[];
  rpc?: string; wsUrl?: string; buildSwap?: BuildSwap; api?: string; discovery?: 'api' | 'rpc' };
export type StepKind = 'buy-cola' | 'create+price' | 'create' | 'first-price';
export type PlannedStep = { kind: StepKind; costLamports: bigint };
/** Ticker tariff in COLA (AdminConfig), burned at CREATE; `totalLamports` excludes it: the buy-cola step buys it with SOL and its review shows the SOL amount. */
export type Tariff = { tariffColaRaw: bigint; tariffCola: string };
export type FeedPlan = { kind: 'feed'; args: FeedArgs; feed: string; feedId: string; ticker: string; pools: PoolChoice[]; steps: PlannedStep[];
  prompts: number; totalLamports: bigint; warnings: string[] } & Tariff;
export type StepReview = { debitLamports: bigint; networkFeeLamports: bigint; writes: readonly MimirBetaExpectedWrite[];
  simulation: { slot: bigint; unitsConsumed: bigint | null; computeUnitLimit: number; bytes: number };
  cola?: { minimumOutRaw: bigint; inputLamports: bigint }; firstPrice: boolean; reviewHash: string };
export type StepToSign = { kind: StepKind; index: number; transaction: MimirBetaUnsignedTransaction; review: StepReview };
export type SignStep = (step: StepToSign) => Promise<Uint8Array>;
export type StepEvent = { kind: StepKind; state: 'prepared' | 'signed' | 'sent' | 'expired'; signature?: string; index?: number; of?: number }
  | { kind: StepKind; state: 'finalized'; signature: string; slot: bigint; index?: number; of?: number };
/** `pending`: a step was sent but its outcome is unknown (RPC unreachable); call `planFeed` again later to resume. `signatures` holds every sent step (slot 0n: not confirmed). */
export type FeedReceipt = { state: 'ready' | 'failed' | 'pending'; feed: string; signatures: { kind: StepKind; signature: string; slot: bigint; lastValidBlockHeight?: string; sentSlot?: string }[]; price: Price | null; error?: MimirError };

const fail = (code: MimirErrorCode, message: string, cause?: unknown, retry: 'never' | 'later' = 'never'): never => { throw new MimirError(code, message, retry, { cause }); };
const SIGNATURE_FEE = 5_000n, PRIORITY_MICRO_LAMPORTS = 10_000n;
const networkFee = (cu: number, signatures = 1) => SIGNATURE_FEE * BigInt(signatures) + BigInt(cu) * PRIORITY_MICRO_LAMPORTS / 1_000_000n;
const NO_TARIFF: Tariff = { tariffColaRaw: 0n, tariffCola: '0' };
const tariffOf = (e: MimirBetaCollateralRequiredError): Tariff => {
  const raw = e.requiredAmountRaw, unit = 10n ** BigInt(e.decimals), frac = (raw % unit).toString().padStart(e.decimals, '0').replace(/0+$/, '');
  return { tariffColaRaw: raw, tariffCola: `${raw / unit}${frac ? `.${frac}` : ''}` };
};
const INTERVAL: readonly Recipe[] = ['orca-marker-quiet', 'cpmm-quiet-interval-v2', 'damm-onlyb-interval-v1', 'damm-reserve-interval-v3'];

/** Jupiter's keyless `GET /swap/v2/build` (public default, rate-limited: 0.5 RPS keyless, 1 RPS with a free key). Never a paid API. */
export function jupiterSwapBuild(opts: { apiKey?: string } = {}): BuildSwap {
  return (q) => buildQuote({ url: new URL('https://api.jup.ag/swap/v2/build'), envelope: false, ...(opts.apiKey ? { headers: { 'x-api-key': opts.apiKey } } : {}),
    authority: q.taker as Address, collateralMint: q.outputMint as Address, amount: q.amount, ...(q.signal ? { signal: q.signal } : {}), ...(q.failFast ? { failFast: true } : {}) });
}

/** Node/bot signer over `partiallySignMimirBetaTransactionV1`. */
export async function keyPairSigner(keyPair: CryptoKeyPair): Promise<SignStep> {
  const signerAddress = await getAddressFromPublicKey(keyPair.publicKey);
  return async (step) => (await partiallySignMimirBetaTransactionV1({ transaction: step.transaction, signerAddress, keyPair })).serializedTransaction;
}

type Rpc = ReturnType<typeof createSolanaRpc>;
const FENCED = new Set(['getAccountInfo', 'getMultipleAccounts', 'getLatestBlockhash', 'simulateTransaction', 'getSlot', 'getBalance', 'getBlockHeight']);
const CONFIG_AT: Record<string, number> = { getLatestBlockhash: 0, getSlot: 0, getBlockHeight: 0 };
/**
 * A load-balanced RPC never answers behind a slot it already showed: each read carries `minContextSlot` = the highest context seen, and a node
 * that has not reached it (-32016) is asked again at once, a bounded number of times.
 */
function monotonic(rpc: Rpc): Rpc {
  let seen = 0n;
  return new Proxy(rpc, { get: (target, method: string) => {
    const raw = (target as unknown as Record<string, (...a: unknown[]) => { send(): Promise<unknown> }>)[method]!;
    const call = (...a: unknown[]) => ({ send: () => limited(() => raw(...a).send()) });
    if (!FENCED.has(method)) return call;
    return (...args: unknown[]) => ({ send: async () => {
      for (let attempt = 1; ; attempt++) {
        const a = [...args], at = CONFIG_AT[method] ?? 1, config = (a[at] ?? {}) as { minContextSlot?: bigint };
        if (seen > 0n && (config.minContextSlot ?? 0n) < seen) a[at] = { ...config, minContextSlot: seen };
        try {
          const result = await call(...a).send() as { context?: { slot?: bigint } };
          const slot = method === 'getSlot' ? BigInt(result as unknown as bigint) : result?.context?.slot;
          if (slot !== undefined && BigInt(slot) > seen) seen = BigInt(slot);
          return result;
        } catch (e) {
          if (attempt >= 30 || !/Minimum context slot has not been reached/.test(String((e as Error)?.message))) throw e;
        }
      }
    } });
  } });
}
/** HTTP 429/503 retried twice, after Retry-After or 1 s then 2 s, within 20 s, like the price path. */
async function limited<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 0, waited = 0; ; attempt++) {
    try { return await send(); } catch (e) {
      const status = (e as { context?: { statusCode?: number } })?.context?.statusCode ?? Number(/HTTP error \((\d+)\)/.exec(String((e as Error)?.message))?.[1]);
      const delay = retryAfter(e) ?? 1_000 * 2 ** attempt;
      if (attempt >= 2 || (status !== 429 && status !== 503) || waited + delay > 20_000) throw e;
      await new Promise((r) => setTimeout(r, delay));
      waited += delay;
    }
  }
}
type Context = { rpc: Rpc; rpcUrl: string; deps: V1CreationDependencies; base: Parameters<typeof prepareV1SimpleFeed>[1]; pools: MimirBetaEligiblePool[] };

/** The plan carries no RPC URL (it may hold a key): it stays here, bound to the plan's args. */
type Endpoints = { rpc?: string; wsUrl?: string; api?: string };
const endpoints = new WeakMap<object, Endpoints>();
const rpcOf = (args: Endpoints) => endpoints.get(args)?.rpc ?? args.rpc;
function planArgs<A extends Endpoints>(args: A, extra: Partial<A>): A {
  const { rpc, wsUrl, api, ...rest } = args, bound = endpoints.get(args), out = { ...rest, ...extra } as A;
  endpoints.set(out, { ...bound, ...(rpc ? { rpc } : {}), ...(wsUrl ? { wsUrl } : {}), ...(api ? { api } : {}) });
  return out;
}
/** Tickers are case-insensitive like `getPrice`: upper-cased, keeping the args' bound endpoints. */
const tickerCase = /^[a-z0-9]{1,12}$/i;
function upperTickers<A extends Endpoints & { ticker: string; components?: CompositeComponent[] }>(args: A): A {
  const out = { ...args, ticker: typeof args.ticker === 'string' ? args.ticker.toUpperCase() : args.ticker,
    ...(Array.isArray(args.components) ? { components: args.components.map((c) => typeof c?.feed === 'string' && tickerCase.test(c.feed) ? { ...c, feed: c.feed.toUpperCase() } : c) } : {}) };
  const bound = endpoints.get(args);
  if (bound) endpoints.set(out, bound);
  return out;
}

const rowVectorsOf = (rpcUrl: string): V1CreationDependencies['rowVectors'] => async (rows, memberships, opts) => {
  const [{ Connection }, { mimirV1RowVectors }] = await Promise.all([import('@solana/web3.js'), import('../v1/refresh.js')]);
  return mimirV1RowVectors(new Connection(rpcUrl, 'confirmed'), rows, memberships, opts);
};

/** The RPC alone, no pool discovery: the own-unpriced resume and its first price need nothing else. */
const lightContext = (args: FeedArgs) => { const rpcUrl = rpcOf(args) ?? DEFAULT_RPC; return { rpc: monotonic(createSolanaRpc(rpcUrl)), rpcUrl }; };
async function context(args: FeedArgs): Promise<Context> {
  if (!/^[A-Z0-9]{1,12}$/.test(args.ticker)) fail('INVALID_INPUT', 'ticker must be 1-12 of A-Z0-9');
  const rpcUrl = rpcOf(args) ?? DEFAULT_RPC, rpc = monotonic(createSolanaRpc(rpcUrl));
  const quoteMint = args.quote === 'SOL' ? SOL_QUOTE_MINT : USDC_QUOTE_MINT, authority = args.payer as Address;
  const wanted = (args.pools ?? (await poolCandidates(args.baseMint, args.quote, args.discovery === 'rpc' ? { rpc: rpcUrl } : { ...(endpoints.get(args)?.api ?? args.api ? { api: endpoints.get(args)?.api ?? args.api! } : {}) }).catch((e) => {
    throw rpcOf(args) && e instanceof MimirError && e.hint.includes('new Mimir({ rpc })') ? new MimirError(e.code, e.message, e.retry, { cause: e, hint: "Retry in a few seconds, or discover pools on your rpc: discovery: 'rpc'." }) : e; })).map((c) => c.pool)) as Address[];
  if (!wanted.length) fail('NO_POOL', `no eligible pool for ${args.baseMint}/${args.quote}`);
  const eligible = await fresh(() => resolveEligiblePoolsSplit(rpc as never, args.baseMint as Address, quoteMint, wanted), 10);
  const pools = args.pools ? eligible : eligible.slice(0, 1);
  if (!pools.length || (args.pools && pools.length !== args.pools.length)) fail('NO_POOL', `no eligible pool for ${args.baseMint}/${args.quote}${args.pools ? ` among ${args.pools.join(', ')}` : ''}`);
  const chosen = pools.map((pool, i) => [args.recipe ?? []].flat()[i] ?? recipesOf(pool, pools.length)[0]!.recipe);
  const bad = chosen.find((r) => INTERVAL.includes(r));
  if (bad) fail('NOT_SUPPORTED', `${bad}: interval recipes are not supported yet in @quantulabs/mimir-sdk/create; use default, native-bounded or current-point`);
  const recipes = chosen.map((r) => r === 'default' ? null : r as MimirClassicRowRecipe);
  const deps = { deployment: MIMIR_MAINNET_DEPLOYMENT, rpc, rpcUrl, rowVectors: rowVectorsOf(rpcUrl), isTransportError } as unknown as V1CreationDependencies;
  const [ata] = await findMimirV1AssociatedTokenAddress(authority, MIMIR_MAINNET_COLLATERAL_MINT);
  const base = { authority, ticker: args.ticker, baseMint: args.baseMint as Address, quoteMint, pools, policy: MIMIR_MAINNET_CLASSIC_POLICY,
    identity: { asset: authority, agentUri: '' } as never, creatorCollateralTokenAccount: ata, variant: 'new' as const,
    ...(recipes.some((r) => r !== null) ? { recipes } : {}), ...(quoteMint === SOL_QUOTE_MINT ? { solConversionSourceConfig: MIMIR_MAINNET_SOL_CONVERSION_SOURCE_CONFIG } : {}) };
  return { rpc, rpcUrl, deps, base: base as never, pools };
}

const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
/** The base mint is a mint account, and every given pool holds it: typed before pool resolution. */
async function checkMint(rpc: Rpc, mint: string, pools?: readonly string[]) {
  if (typeof mint !== 'string' || !isAddress(mint)) fail('INVALID_INPUT', `${mint}: baseMint is not a valid mint address`);
  if (pools?.some((p) => typeof p !== 'string' || !isAddress(p))) fail('INVALID_INPUT', 'pools must be pool addresses');
  const read = (await rpc.getMultipleAccounts([mint, ...pools ?? []] as Address[], { commitment: 'confirmed', encoding: 'base64' }).send()).value;
  const m = read[0], data = m ? fromBase64(m.data[0]) : null;
  if (!m || !TOKEN_PROGRAMS.includes(m.owner) || !(data!.length === 82 || (m.owner === TOKEN_PROGRAMS[1] && data!.length > 165 && data![165] === 1))) fail('NOT_FOUND', `${mint} is not a token mint`);
  const key = getAddressEncoder().encode(mint as Address);
  const wrong = (pools ?? []).find((_, i) => { const d = read[i + 1] ? fromBase64(read[i + 1]!.data[0]) : null; return !d || !d.some((_, at) => key.every((b, j) => d[at + j] === b)); });
  if (wrong) fail('NOT_FOUND', `${wrong} is not a pool of ${mint}`);
}

function recipesOf(pool: MimirBetaEligiblePool, poolCount: number): RecipeChoice[] {
  return admittedRecipes(pool.creation.adapterType, pool.creation.adapterVersion).map((r) => {
    const recipe = (r ?? 'default') as Recipe, interval = INTERVAL.includes(recipe);
    return { recipe, marketEligible: marketEligible(r, pool.creation, poolCount), supported: !interval,
      mimirTransactions: !interval ? 1 : recipe === 'orca-marker-quiet' ? 2 : 3, firstPriceAfterSeconds: interval ? 120 : 0 };
  });
}

/** A load-balanced RPC answers a node or a slot behind the frame: re-run from fresh reads, a bounded few times, no wait. */
const lagging = (e: unknown) => e instanceof ReviewIntentChangedError && (e.refusal as { origin?: string } | undefined)?.origin === 'context-regression'
  || /Minimum context slot has not been reached|context regressed|RPC_CONTEXT_MISMATCH|not authentic for the context slot/.test(String((e as Error)?.message ?? e));
async function fresh<T>(run: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await run(); } catch (e) { if (i >= attempts || !lagging(e)) throw e; }
  }
}

/** `typedError`, keeping a resume call's `after` on an error raised before any step was sent. */
export const typed = (error: unknown, after?: CreateOptions['after']): never => {
  try { return typedError(error); } catch (e) {
    throw Array.isArray(after) && after.length && e instanceof MimirError && !e.signatures ? new MimirError(e.code, e.message, e.retry, { hint: e.hint, cause: e.cause ?? e, signatures: after.filter((r) => r && typeof r === 'object').map((r) => ({ slot: '0', ...r, kind: r.kind as StepKind })) }) : e;
  }
};
const typedError = (error: unknown): never => {
  if (error instanceof MimirError) throw error;
  if ((error as Error)?.name === 'SolanaError' || /fetch failed|HTTP error \(/.test(String((error as Error)?.message))) fail('RPC', String((error as Error)?.message ?? error), error, 'later');
  if (error instanceof UnpriceableFeedError) fail('UNPRICEABLE', error.message, error);
  if (error instanceof InsufficientSolError) fail('INSUFFICIENT_SOL', error.message, error, 'later');
  if (error instanceof CompositeExistsError) throw new MimirError('FEED_EXISTS', error.message, 'never', { cause: error, hint: 'Read it with mimir.price(), or change a quantity or a component.',
    feeds: [{ feed: error.feed, ticker: error.ticker ?? '', quote: '' }] });
  if (error instanceof MimirBetaError && error.code === 'DLMM_POINT_UNQUALIFIED') {
    throw new MimirError('UNPRICEABLE', error.message.replace(/^DLMM_POINT_UNQUALIFIED:/, ''), 'later', { cause: error,
      hint: 'The pool cannot publish a current point now (market state): retry later, or pass recipe: "native-bounded" or "default".' });
  }
  if (error instanceof MimirBetaError && error.code === 'INVALID_ARGUMENT') {
    const reason = error.message.replace(/^INVALID_ARGUMENT:/, ''), mint = /^(base|quote) mint address invalid$/.exec(reason);
    fail('INVALID_INPUT', mint ? `${mint[1]}Mint is not a valid mint address` : reason, error);
  }
  throw MimirError.from(error);
};

/**
 * The funding facts the SDK refuses with: feed, variant, exact remaining costs. Builds no transaction for signing. A creation that burns no COLA
 * (a one-character ticker spends its allowance) returns its prepared CREATE instead.
 */
async function fundingFacts(c: Context) {
  const result = await fresh(() => prepareV1SimpleFeed(c.deps, { ...c.base, allowCollateralFunding: true, estimateFundingCosts: true, fullCollateralPurchase: true } as never)
    .then((prepared) => ({ prepared }), (e: unknown) => { if (lagging(e)) throw e; return { error: e }; })).catch((e: unknown) => ({ error: e }));
  if ('prepared' in result) return result.prepared;
  if (!(result.error instanceof MimirBetaCollateralRequiredError)) return typed(result.error);
  return result.error;
}
const collateral = (facts: Awaited<ReturnType<typeof fundingFacts>>) =>
  facts instanceof MimirBetaCollateralRequiredError ? facts : fail('PLAN_STALE', 'this creation burns no COLA: no purchase step');
/** Payer debit of a prepared CREATE: its network fee plus what the program takes from the payer (rent, fees). */
const debitOf = (fee: bigint, next: MimirBetaPreparedStep, payer: string) => {
  const program = next.review.expectedWrites.find((w) => w.address === payer && w.proof.kind === 'lamports')?.proof as { programDeltaLamports?: bigint } | undefined;
  return fee - (program?.programDeltaLamports ?? 0n);
};
/** The confirmed fee of a built step's own message, from a bank at or after `minContextSlot` (its reviewed simulation). */
const exactFee = async (rpc: Rpc, t: MimirBetaUnsignedTransaction, minContextSlot?: bigint) => {
  const quote = await quoteTxV1Fee(rpc as never, t, { commitment: 'confirmed', ...(minContextSlot === undefined ? {} : { minContextSlot }) });
  if (minContextSlot !== undefined && quote.context.slot < minContextSlot) fail('RPC', 'the fee quote is behind the reviewed simulation', undefined, 'later');
  return quote.value ?? fail('PLAN_STALE', 'the step blockhash expired', undefined, 'later');
};

/** The claimed feed when the payer created it and it was never priced (a CREATE whose separate first price failed), else null. */
async function ownUnpricedFeed(c: { rpc: Rpc }, payer: string, claim: Uint8Array) {
  const feed = decodeMimirTickerClaim(claim).config;
  const read = (await c.rpc.getAccountInfo(feed, { commitment: 'confirmed', encoding: 'base64' }).send()).value;
  if (!read || read.owner !== MIMIR_MAINNET_DEPLOYMENT.mimirProgramId) return null;
  let v1: ReturnType<typeof decodeV1ClassicFeed>;
  try { v1 = decodeV1ClassicFeed(fromBase64(read.data[0]), feed); } catch { return null; }
  return v1.owner.creator === payer && v1.proof === null
    ? { feed, feedId: getAddressDecoder().decode(v1.feedId) as string, rows: v1.header.n + v1.header.s } : null;
}

/** @internal The feed at finalized is a Mimir account created by `payer` and priced: the server split's `ready`, decided from chain state only. */
export async function createdAndPriced(rpc: Rpc, feed: string, payer: string): Promise<boolean> {
  const read = (await rpc.getAccountInfo(feed as Address, { commitment: 'finalized', encoding: 'base64' }).send()).value;
  if (!read || read.owner !== MIMIR_MAINNET_DEPLOYMENT.mimirProgramId) return false;
  const data = fromBase64(read.data[0]);
  try { const v1 = decodeV1ClassicFeed(data, feed as Address); return v1.owner.creator === payer && v1.proof !== null; } catch { /* not a classic */ }
  try {
    const v1 = decodeV1CompositeFeed(data, feed as Address);
    return v1.config.creator === payer && (await decodePrice({ address: feed, owner: read.owner, executable: read.executable, data }, { slot: 0n })).status !== 'none';
  } catch { return false; }
}

/** The plan: steps, estimated SOL, prompts, recipe trade-offs and warnings. Builds and signs nothing. */
export function prepareFeed(args: FeedArgs): Promise<FeedPlan> {
  return prepareFeedRaw(upperTickers(args)).catch(typed);
}
async function prepareFeedRaw(args: FeedArgs): Promise<FeedPlan> {
  if (!/^[A-Z0-9]{1,12}$/.test(args.ticker)) fail('INVALID_INPUT', 'ticker must be 1-12 of A-Z0-9');
  const light = lightContext(args);
  const [claim] = await findMimirV1TickerClaimPda(MIMIR_MAINNET_DEPLOYMENT.mimirProgramId, args.ticker);
  const held = (await light.rpc.getAccountInfo(claim, { commitment: 'confirmed', encoding: 'base64' }).send()).value;
  if (held) {
    const own = await ownUnpricedFeed(light, args.payer, fromBase64(held.data[0]))
      ?? fail('TICKER_TAKEN', `${args.ticker} is already claimed (ticker claim ${claim})`);
    const steps: PlannedStep[] = [{ kind: 'first-price', costLamports: networkFee(mimirV1RefreshComputeUnitLimit(own.rows)) }];
    return { kind: 'feed', args: planArgs(args, {}), feed: own.feed, feedId: own.feedId, ticker: args.ticker, pools: [], steps,
      prompts: 1, totalLamports: steps[0]!.costLamports, warnings: [`${args.ticker} is your feed without a price yet: only its first price remains`], ...NO_TARIFF };
  }
  await checkMint(light.rpc, args.baseMint, args.pools);
  const c = await context(args);
  const pools = c.pools.map((p) => ({ pool: p.pool, venue: venueLabel(p.family), recipes: recipesOf(p, c.pools.length) }));
  const chosen = pools.map((p, i) => [args.recipe ?? []].flat()[i] ?? p.recipes[0]!.recipe);
  const facts = await fundingFacts(c);
  const rows = c.pools.length;
  if (!(facts instanceof MimirBetaCollateralRequiredError)) {
    const next = facts.next ?? fail('PLAN_STALE', `${args.ticker} is already created`);
    const steps: PlannedStep[] = [{ kind: 'create+price', costLamports: debitOf(await exactFee(c.rpc, next.transaction), next, args.payer) + (next.review.firstPrice ? 0n : networkFee(mimirV1RefreshComputeUnitLimit(rows))) }];
    return { kind: 'feed', args: planArgs(args, { pools: c.pools.map((p) => p.pool), recipe: chosen }), feed: facts.plan.feed, feedId: facts.plan.feedId, ticker: args.ticker, pools, steps,
      prompts: 1, totalLamports: steps[0]!.costLamports, warnings: [], ...NO_TARIFF };
  }
  const feedId = facts.feedId!, [feed] = await findMimirV1ClassicFeedPda(MIMIR_MAINNET_DEPLOYMENT.mimirProgramId, feedId);
  const ataRent = facts.accountMissing ? await readRentExemptLamports(c.rpc as never, 165n) : 0n;
  const steps: PlannedStep[] = [{ kind: 'buy-cola', costLamports: networkFee(49_000) + ataRent },
    { kind: 'create+price', costLamports: (facts.fundingCosts?.totalLamports ?? 0n) + networkFee(mimirV1RefreshComputeUnitLimit(rows)) }];
  const warnings = [...pools.flatMap((p, i) => p.recipes.find((r) => r.recipe === chosen[i])?.marketEligible ? []
      : [`${p.venue} ${p.pool}: ${chosen[i]} is not market-eligible (a 1-pool spot feed); native-bounded is, but may pause on a sharp jump`]),
    'totalLamports excludes the ticker tariff (tariffCola); the buy-cola review shows its SOL amount'];
  return { kind: 'feed', args: planArgs(args, { pools: c.pools.map((p) => p.pool), recipe: chosen }), feed, feedId, ticker: args.ticker, pools, steps,
    prompts: steps.length, totalLamports: steps.reduce((s, x) => s + x.costLamports, 0n), warnings, ...tariffOf(facts) };
}

/** Another creator took the planned variant since: the SDK would now build a different feed. */
const samePlan = (plan: FeedPlan, feedId: string | undefined, feed = plan.feed) => {
  if (feedId !== plan.feedId || feed !== plan.feed) fail('PLAN_STALE', `${plan.ticker}: the planned feed ${plan.feed} is no longer the next free variant; prepare a new plan`);
};

/** Builds step `index` just in time with its exact simulation. Internal to `createFeed` and the simulate-only smoke. */
export function prepareStep(plan: FeedPlan, index: number): Promise<StepToSign & { prepared?: MimirBetaPreparedStep }> {
  return prepareStepRaw(plan, index).catch(typed);
}
async function prepareStepRaw(plan: FeedPlan, index: number): Promise<StepToSign & { prepared?: MimirBetaPreparedStep }> {
  const kind = plan.steps[index]!.kind;
  if (kind === 'first-price') return firstPriceStep(lightContext(plan.args), plan, index);
  const c = await context(plan.args);
  if (kind === 'buy-cola') {
    const purchase = await fresh(async () => { const e = collateral(await fundingFacts(c)); samePlan(plan, e.feedId); return prepareCollateralPurchase({ cluster: 'mainnet-beta', rpc: c.rpc as never, authority: e.authority, collateralMint: e.mint,
      collateralTokenAccount: e.tokenAccount, decimals: e.decimals, shortfallRaw: e.shortfallRaw, draftHash: e.draftHash, observedBalanceRaw: e.balanceRaw,
      accountMissing: e.accountMissing, costs: e.fundingCosts!, firstPriceLamports: networkFee(mimirV1RefreshComputeUnitLimit(c.pools.length)), fingerprints: plan.feed, buildSwap: plan.args.buildSwap ?? jupiterSwapBuild() }); }).catch(typed);
    const t = purchase.transaction;
    return { kind, index, transaction: t, review: { debitLamports: purchase.inputLamports + purchase.networkFeeLamports + purchase.ataRentLamports,
      networkFeeLamports: purchase.networkFeeLamports, writes: [], firstPrice: false, reviewHash: t.messageHash,
      simulation: { slot: purchase.simulationSlot, unitsConsumed: null, computeUnitLimit: t.config.computeUnitLimit, bytes: t.serializedTransaction.length },
      cola: { minimumOutRaw: purchase.minimumOutputRaw, inputLamports: purchase.inputLamports } } };
  }
  const prepared = await fresh(() => prepareV1SimpleFeed(c.deps, c.base)).catch(typed);
  const next = prepared.next ?? fail('PLAN_STALE', `${plan.ticker} is already created`);
  samePlan(plan, prepared.plan.feedId, prepared.plan.feed);
  const t = next.transaction, merged = !!next.review.firstPrice;
  const fee = await exactFee(c.rpc, t, next.review.simulation.contextSlot);
  return { kind: merged ? 'create+price' : 'create', index, transaction: t, prepared: next, review: { debitLamports: debitOf(fee, next, plan.args.payer), networkFeeLamports: fee,
    writes: next.review.expectedWrites, firstPrice: merged, reviewHash: next.reviewHash,
    simulation: { slot: next.review.simulation.contextSlot, unitsConsumed: next.review.simulation.unitsConsumed, computeUnitLimit: t.config.computeUnitLimit,
      bytes: t.serializedTransaction.length } } };
}

/** The first price of a created, unpriced feed (classic or composite), tight compute-unit limit from its simulation. */
async function firstPriceStep(c: { rpc: Rpc; rpcUrl: string }, plan: { feed: string; ticker: string; args: { payer: string } }, index: number): Promise<StepToSign> {
  const kind = 'first-price' as const;
  const refresh = await refreshInstructions(plan.feed, { rpc: c.rpcUrl, payer: plan.args.payer });
  const block = (await c.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
  const compile = (cu: number) => compileMimirBetaTransactionV1({ feePayer: plan.args.payer as Address, recentBlockhash: block.blockhash,
    lastValidBlockHeight: block.lastValidBlockHeight, instructions: [buildMimirBetaComputeUnitLimitInstruction(cu), ...refresh.instructions as never[]] });
  const simulate = async (tx: MimirBetaUnsignedTransaction) => {
    const sim = (await c.rpc.simulateTransaction(base64(tx.serializedTransaction) as never,
      { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed' } as never).send()) as unknown as { context: { slot: bigint }; value: { err: unknown; unitsConsumed?: bigint } };
    if (sim.value.err) fail('UNPRICEABLE', `${plan.ticker}: its first price fails (${JSON.stringify(sim.value.err)})`);
    return sim;
  };
  const t = await compile(tightComputeUnitLimit((await simulate(await compile(1_400_000))).value.unitsConsumed, mimirV1RefreshComputeUnitLimit(refresh.instructions.length)));
  const sim = await simulate(t);
  const fee = await exactFee(c.rpc, t, BigInt(sim.context.slot));
  return { kind, index, transaction: t, review: { debitLamports: fee, networkFeeLamports: fee,
    writes: [], firstPrice: true, reviewHash: t.messageHash,
    simulation: { slot: BigInt(sim.context.slot), unitsConsumed: sim.value.unitsConsumed ?? null, computeUnitLimit: t.config.computeUnitLimit, bytes: t.serializedTransaction.length } } };
}

/** @internal A fresh-price Transaction v1 for `payer`: [compute budget, refreshes, yours], simulated (sigVerify off) on a confirmed blockhash, signed by the payer only. */
export async function freshPriceTransaction(rpcUrl: string, feeds: string | readonly string[], instructions: readonly unknown[], payer: string) {
  const rpc = facadeRpc(rpcUrl);
  const { withFreshPrice } = await import('../easy/refresh.js');
  const own = instructions.map((ix) => (ix as { programId?: unknown }).programId ? kitOf(ix as never) : ix) as never[];
  const ixs = (await withFreshPrice({ feeds, instructions: own, payer, rpc: rpcUrl, simulate: true })).instructions;
  const block = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
  const simulate = async (t: MimirBetaUnsignedTransaction) => {
    const sim = (await rpc.simulateTransaction(base64(t.serializedTransaction) as never, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed' } as never)
      .send()) as unknown as { context: { slot: bigint }; value: { err: unknown; logs?: string[] | null; unitsConsumed?: bigint } };
    if (sim.value.err) throw MimirError.from({ message: JSON.stringify(sim.value.err, (_k, v) => typeof v === 'bigint' ? Number(v) : v), logs: sim.value.logs ?? [] }, { instructions: ixs });
    return sim;
  };
  const t = await compileMimirBetaTransactionV1({ feePayer: payer as Address, recentBlockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight, instructions: ixs })
    .catch((e) => { throw MimirError.from(e); });
  if (t.requiredSigners.length !== 1) fail('INVALID_INPUT', `your instructions need ${t.requiredSigners.length - 1} signer(s) besides the payer; sendWithFreshPrice signs with the payer only`);
  await simulate(t);
  return t;
}
const kitOf = (ix: { programId: { toBase58(): string }; keys: { pubkey: { toBase58(): string }; isSigner: boolean; isWritable: boolean }[]; data: Uint8Array }) =>
  ({ programAddress: ix.programId.toBase58() as Address, data: Uint8Array.from(ix.data), accounts: ix.keys.map((k) => ({ address: k.pubkey.toBase58() as Address, isSigner: k.isSigner, isWritable: k.isWritable })) });

/** The only programs a creation step calls: Mimir, compute budget, system, SPL Token, Token-2022, associated token, Jupiter, Memo. */
const STEP_PROGRAMS = new Set(["hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR", "ComputeBudget111111111111111111111111111111", "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"]);

/** The TxV1 config compute-unit limit (mask bit 2, after the u64 priority fee); a ComputeBudget SetComputeUnitLimit instruction counts as a change. */
export function computeUnitLimitOf(message: Uint8Array): number | null {
  const m = getCompiledTransactionMessageDecoder().decode(message) as unknown as { version: number; configMask: number; configValues: { value: unknown }[];
    staticAccounts: string[]; instructionHeaders: { programAccountIndex: number }[]; instructionPayloads: { instructionData: Uint8Array }[] };
  if (m.version !== 1 || !(m.configMask & 4) || m.instructionHeaders.some((h, i) => m.staticAccounts[h.programAccountIndex] === 'ComputeBudget111111111111111111111111111111'
    && m.instructionPayloads[i]!.instructionData[0] === 2)) return null;
  return Number(m.configValues[(m.configMask & 3) === 3 ? 1 : 0]!.value);
}

/** @internal The wallet admission of a signed step and its fee-payer signature: TxV1 is message-first, the signature slots trail the message. */
export async function admitSigned(transaction: MimirBetaUnsignedTransaction, payer: string, signed: Uint8Array) {
  const admission = await admitMimirBetaWalletSignedTransactionV1({ transaction, walletAddress: payer as Address, walletSignedTransaction: signed })
    .catch((e) => fail('REVIEW_CHANGED', 'the wallet changed this transaction beyond the network fee; nothing was sent', e));
  if (computeUnitLimitOf(admission.serializedMessage) !== transaction.config.computeUnitLimit) {
    fail('REVIEW_CHANGED', 'the wallet changed the compute-unit limit; nothing was sent');
  }
  const at = admission.serializedMessage.length;
  return { admission, signature: (await import('bs58')).default.encode(signed.subarray(at, at + 64)) };
}

/** RPC/transport failures (429, 5xx, network), never a program or review refusal. */
function isTransportError(e: unknown): boolean {
  const ctx = (e as { context?: { statusCode?: number } })?.context;
  if (typeof ctx?.statusCode === 'number') return ctx.statusCode === 429 || ctx.statusCode >= 500;
  return e instanceof TypeError || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network|HTTP error \((429|5\d\d)\)/i.test(String((e as Error)?.message ?? e));
}
const retryAfter = (e: unknown) => {
  const h = (e as { context?: { headers?: Headers | Record<string, string> } })?.context?.headers;
  const v = h ? (typeof (h as Headers).get === 'function' ? (h as Headers).get('retry-after') : (h as Record<string, string>)['retry-after']) : null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n * 1_000 : undefined;
};
/** A wait read that rides out 429/transport errors: undefined while backing off (exponential, or Retry-After), so the wait keeps going. */
function backoff() {
  let until = 0, delay = 1_000;
  return async <T>(read: () => Promise<T>): Promise<T | undefined> => {
    if (Date.now() < until) return undefined;
    try { const v = await read(); delay = 1_000; return v; } catch (e) {
      if (!isTransportError(e)) throw e;
      until = Date.now() + (retryAfter(e) ?? delay); delay = Math.min(delay * 2, 16_000);
      return undefined;
    }
  };
}

/** @internal Sends a signed wire (the same bytes rebroadcast until processed or expired) and waits for `finalized`. */
export async function submit(rpc: Rpc, wsUrl: string, signed: Uint8Array, signature: string, lastValidBlockHeight: bigint, patient = backoff(),
  rebroadcastMs = 1_000, sent?: () => unknown, commitment: 'confirmed' | 'finalized' = 'finalized') {
  const wire = base64(signed);
  const send = async () => { await rpc.sendTransaction(wire as never, { encoding: 'base64', skipPreflight: true, maxRetries: 0n } as never).send().catch(() => undefined); };
  await send();
  const hook = await Promise.resolve().then(sent).then(() => undefined, (error: unknown) => ({ error }));
  let slot = 0n, fence = 0n;
  const outcome = await confirmSignature({ wsUrl, signature, commitment, rebroadcast: send, rebroadcastMs, timeoutMs: 120_000, pollMs: 1_000,
    getStatus: async (s, history) => {
      const read = await patient(() => rpc.getSignatureStatuses([s as never], { searchTransactionHistory: !!history }).send()).catch(() => undefined);
      if (!read) return undefined;
      const status = read.value[0] ?? null;
      if (!status && history && BigInt(read.context.slot) < fence) return undefined;
      if (status?.slot) slot = BigInt(status.slot);
      return status as never;
    },
    expired: async () => {
      const height = await patient(() => rpc.getBlockHeight({ commitment: 'confirmed' }).send()).catch(() => undefined);
      if (height === undefined || height <= lastValidBlockHeight) return false;
      const at = await patient(() => rpc.getSlot({ commitment: 'confirmed' }).send()).catch(() => undefined);
      if (at === undefined) return false;
      fence = BigInt(at);
      return true;
    } });
  if (hook) throw hook.error;
  return { outcome, slot };
}
/** @internal A monotonic kit RPC with the facade's 429 handling. */
export const facadeRpc = (url: string) => monotonic(createSolanaRpc(url));

/** Signs, sends (same bytes rebroadcast each second until processed or expired) and waits for `finalized`, step by step. */
export function createFeed(plan: FeedPlan, opts: CreateOptions): Promise<FeedReceipt> {
  return runPlan(plan, prepareStep, opts, ['createFeed', 'planFeed']);
}

/** `onStep` is awaited: a throw on `signed` stops before the send. `rebroadcastMs` (default 1,000) paces the resend of the same wire. */
/** `after`: the signatures of an interrupted run (its receipt's or error's `signatures`); a COLA purchase that landed there is reused, never bought again. */
export type CreateOptions = { sign: SignStep; onStep?: (event: StepEvent) => unknown; rpc?: string; wsUrl?: string; rebroadcastMs?: number;
  after?: readonly { kind: string; signature: string; lastValidBlockHeight?: string; sentSlot?: string }[] };
type RunnablePlan = { feed: string; args: Endpoints & { payer: string }; steps: PlannedStep[] };
/** @internal The shared sign/send/wait loop of `createFeed` and `createComposite`. */
export async function runPlan<P extends RunnablePlan>(plan: P, prepare: (plan: P, index: number) => Promise<StepToSign & { prepared?: MimirBetaPreparedStep }>,
  opts: CreateOptions, [create, resume]: [string, string]): Promise<FeedReceipt> {
  const rpcUrl = opts.rpc ?? rpcOf(plan.args);
  if (!rpcUrl) return { state: 'failed', feed: plan.feed, signatures: [], price: null,
    error: new MimirError('INVALID_INPUT', `${create} needs your own RPC (\`rpc\` in ${resume} or ${create}); the public endpoint cannot carry the wait`, 'never') };
  if (opts.rpc) plan = { ...plan, args: planArgs({ ...plan.args, rpc: opts.rpc, ...(opts.wsUrl ? { wsUrl: opts.wsUrl } : {}) }, {}) };
  const rpc = monotonic(createSolanaRpc(rpcUrl)), wsUrl = opts.wsUrl ?? endpoints.get(plan.args)?.wsUrl ?? plan.args.wsUrl ?? rpcUrl.replace(/^http/, 'ws');
  const patient = backoff();
  const signatures: FeedReceipt['signatures'] = [];
  let inFlight: string | undefined, sent: { kind: StepKind; signature: string; lastValidBlockHeight: string; sentSlot?: string } | undefined;
  const steps = [...plan.steps];
  const reused = opts.after?.length && steps[0]?.kind === 'buy-cola' ? await landedBuy(rpc, opts.after, plan.args.payer).catch((error: MimirError) => error) : undefined;
  if (reused instanceof MimirError) return { state: 'pending', feed: plan.feed, price: null, error: reused,
    signatures: opts.after!.map((r) => ({ kind: r.kind as StepKind, signature: r.signature, slot: 0n, ...(r.lastValidBlockHeight ? { lastValidBlockHeight: r.lastValidBlockHeight } : {}), ...(r.sentSlot ? { sentSlot: r.sentSlot } : {}) })) };
  try {
    if (reused) signatures.push(reused);
    for (let i = reused ? 1 : 0; i < steps.length; i++) {
      const step = await prepare({ ...plan, steps }, i);
      if (step.kind === 'create') steps.splice(i, 1, { kind: 'create', costLamports: steps[i]!.costLamports }, { kind: 'first-price', costLamports: step.review.networkFeeLamports });
      const at = { index: i + 1, of: steps.length };
      await opts.onStep?.({ kind: step.kind, state: 'prepared', ...at });
      const sentSlot = step.kind === 'buy-cola' ? await Promise.resolve().then(() => rpc.getSlot({ commitment: 'confirmed' }).send()).then(String, () => undefined) : undefined;
      const signed = await opts.sign(step);
      const { admission, signature } = await admitSigned(step.transaction, plan.args.payer, signed);
      const err = (await rpc.simulateTransaction(base64(signed) as never, { encoding: 'base64', sigVerify: true, commitment: 'confirmed' } as never).send().catch(() => undefined))?.value?.err;
      if (err) fail('PLAN_STALE', `${step.kind}: the signed transaction no longer simulates (${JSON.stringify(err, (_k, v) => typeof v === 'bigint' ? Number(v) : v)}); nothing was sent, call ${create} again`);
      await opts.onStep?.({ kind: step.kind, state: 'signed', signature, ...at });
      inFlight = signature;
      sent = { kind: step.kind, signature, lastValidBlockHeight: String(step.transaction.lastValidBlockHeight), ...(sentSlot ? { sentSlot } : {}) };
      const { outcome, slot } = await submit(rpc, wsUrl, signed, signature, step.transaction.lastValidBlockHeight, patient, opts.rebroadcastMs,
        () => opts.onStep?.({ kind: step.kind, state: 'sent', signature, ...at }));
      if (outcome === 'timeout') fail('RPC', `${step.kind} ${signature}: outcome unknown`);
      if (outcome !== 'confirmed') inFlight = undefined;
      if (outcome !== 'confirmed') fail(outcome === 'expired' ? 'EXPIRED' : 'RPC', `${step.kind} ${signature} ${outcome}`);
      if (step.prepared) await observeV1Operation(rpc as never, [createMimirBetaStageReceipt({ preparedStep: step.prepared, signature, attempt: 1,
        retryOfSignature: null, signedMessage: admission.serializedMessage })]);
      signatures.push({ kind: step.kind, signature, slot });
      inFlight = sent = undefined;
      await opts.onStep?.({ kind: step.kind, state: 'finalized', signature, slot, ...at });
    }
    const read = await rpc.getAccountInfo(plan.feed as Address, { commitment: 'finalized', encoding: 'base64' }).send();
    const price = read.value ? await decodePrice({ address: plan.feed, owner: read.value.owner, executable: read.value.executable,
      data: fromBase64(read.value.data[0]) }, { slot: read.context.slot }) : null;
    return { state: price?.status === 'fresh' ? 'ready' : 'failed', feed: plan.feed, signatures, price };
  } catch (error) {
    if (sent) signatures.push({ ...sent, slot: 0n });
    if (inFlight) return { state: 'pending', feed: plan.feed, signatures, price: null,
      error: new MimirError('RPC', `${inFlight} was sent; its outcome is unknown. Call ${create} again with after: error.signatures: the COLA already bought is reused`, 'later', { cause: error }) };
    return { state: 'failed', feed: plan.feed, signatures, price: null, error: MimirError.from(error) };
  }
}

/** One index component: an existing classic feed (its ticker or feed id) and its quantity (a decimal, up to 9 places). */
export type CompositeComponent = { feed: string; quantity: string };
export type CompositeArgs = { payer: string; ticker: string; components: CompositeComponent[]; quote: 'USDC' | 'SOL'; displayName?: string;
  rpc?: string; wsUrl?: string; buildSwap?: BuildSwap };
export type CompositePlan = { kind: 'composite'; args: CompositeArgs; feed: string; feedId: string; ticker: string;
  components: { feed: string; feedId: string; ticker: string; quantityX64: bigint }[]; steps: PlannedStep[]; prompts: number; totalLamports: bigint;
  activationFeeLamports: bigint; warnings: string[] } & Tariff;

const Q64 = 1n << 64n;
function quantityX64(text: string): bigint {
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,9}))?$/.exec(text), scale = 10n ** BigInt(m?.[2]?.length ?? 0);
  const value = m && BigInt(m[1]!) < Q64 ? (BigInt(m[1]!) << 64n) + (BigInt(m[2] ?? 0) * Q64 + scale / 2n) / scale : 0n;
  return value || fail('INVALID_INPUT', `quantity ${text}: a number above 0, up to 9 decimals`);
}

type CompositeContext = { rpc: Rpc; rpcUrl: string; deps: V1CreationDependencies; input: Record<string, unknown>; components: CompositePlan['components'] };

async function compositeContext(args: CompositeArgs): Promise<CompositeContext> {
  if (!/^[A-Z0-9]{1,12}$/.test(args.ticker)) fail('INVALID_INPUT', 'ticker must be 1-12 of A-Z0-9');
  if (!Array.isArray(args.components) || args.components.length < 2 || args.components.length > 5) fail('INVALID_INPUT', 'a composite takes 2 to 5 components');
  const quantities = args.components.map((c) => quantityX64(c.quantity));
  const rpcUrl = rpcOf(args) ?? DEFAULT_RPC, rpc = monotonic(createSolanaRpc(rpcUrl)), program = MIMIR_MAINNET_DEPLOYMENT.mimirProgramId;
  const ticker = (f: string) => /^[A-Z0-9]{1,12}$/.test(f);
  const claims = await Promise.all(args.components.map(async (c) => ticker(c.feed) ? (await findMimirV1TickerClaimPda(program, c.feed))[0] : null));
  const claimed = claims.some(Boolean) ? (await rpc.getMultipleAccounts(claims.filter((x): x is Address => !!x), { commitment: 'confirmed', encoding: 'base64' }).send()).value : [];
  let at = 0;
  const feeds = await Promise.all(args.components.map(async (c, i) => {
    if (!claims[i]) return isAddress(c.feed) ? (await findMimirV1ClassicFeedPda(program, c.feed as Address))[0] : fail('INVALID_INPUT', `${c.feed}: not a ticker, a mint or a feed id`);
    const claim = claimed[at++];
    return claim ? decodeMimirTickerClaim(fromBase64(claim.data[0])).config as Address : fail('NOT_FOUND', `${c.feed}: no feed with this ticker`);
  }));
  const decode = (account: { owner: string; data: [string, string] } | null | undefined, address: Address) => {
    try { return account?.owner === program ? decodeV1ClassicFeed(fromBase64(account.data[0]), address) : undefined; } catch { return undefined; } };
  const direct = args.components.map((c, i) => !claims[i] && isAddress(c.feed) ? c.feed as Address : null).filter((x): x is Address => !!x);
  const both = (await rpc.getMultipleAccounts([...feeds, ...direct], { commitment: 'confirmed', encoding: 'base64' }).send()).value;
  const read = both.slice(0, feeds.length);
  direct.forEach((address, k) => { const i = args.components.findIndex((c) => c.feed === address), account = both[feeds.length + k];
    if (decode(account, address)) { feeds[i] = address; read[i] = account; } });
  const quotes = args.quote === 'SOL' ? [SOL_QUOTE_MINT] : [USDC_QUOTE_MINT, SOL_QUOTE_MINT];
  /** A one-row classic of `mint`: the composite quote first, then SOL (the converter). */
  const oneRow = async (mint: Address) => {
    const keys = await Promise.all(quotes.filter((q) => q !== mint).flatMap((q) => Array.from({ length: 17 }, async (_, v) => (await findMimirV1ClassicFeedPda(program, await deriveMimirV1ClassicFeedId(mint, q, v)))[0])));
    const value = (await rpc.getMultipleAccounts(keys, { commitment: 'confirmed', encoding: 'base64' }).send()).value;
    const found = keys.map((k, i) => ({ k, v1: decode(value[i], k) })).filter((x) => x.v1);
    return { any: found.length > 0, pick: found.find((x) => x.v1!.header.n === 1) };
  };
  const v1s = await Promise.all(read.map(async (account, i) => {
    const given = args.components[i]!.feed, v1 = decode(account, feeds[i]!);
    if (v1?.header.n === 1) return v1;
    if (v1 && !claims[i]) fail('COMPOSITE_CHILD_MULTI_ROW', `${given}: feed ${feeds[i]} has ${v1.header.n} rows; an index component must be a one-row classic`);
    const mint = v1 ? getAddressDecoder().decode(v1.definition.feedImage.subarray(K.CFG_OFFSET_BASE_MINT, K.CFG_OFFSET_BASE_MINT + 32)) : given as Address;
    const { any, pick } = await oneRow(mint);
    if (pick) { feeds[i] = pick.k; return pick.v1!; }
    if (!v1 && !any) fail('INVALID_INPUT', `${given}: not a live classic feed`);
    return fail('COMPOSITE_CHILD_MULTI_ROW', `${given}: no one-row classic for ${mint}; an index component must be a one-row classic`);
  }));
  const components = v1s.map((v1, i) => ({ feed: feeds[i]! as string, feedId: getAddressDecoder().decode(v1.feedId) as string,
    ticker: (() => { try { return decodeMimirBetaTicker(v1.definition.ticker); } catch { return args.components[i]!.feed; } })(), quantityX64: quantities[i]! }));
  if (new Set(components.map((c) => c.feedId)).size !== components.length) fail('INVALID_INPUT', 'a component appears twice');
  const deps = { deployment: MIMIR_MAINNET_DEPLOYMENT, rpc, rpcUrl, rowVectors: rowVectorsOf(rpcUrl), isTransportError } as unknown as V1CreationDependencies;
  const authority = args.payer as Address, quoteMint = args.quote === 'SOL' ? SOL_QUOTE_MINT : USDC_QUOTE_MINT;
  const [ata] = await findMimirV1AssociatedTokenAddress(authority, MIMIR_MAINNET_COLLATERAL_MINT);
  const input = { authority, ticker: args.ticker, displayName: args.displayName ?? args.ticker, quoteMint, identity: { asset: authority, agentUri: '' },
    creatorCollateralTokenAccount: ata, policy: MIMIR_MAINNET_COMPOSITE_POLICY,
    components: await Promise.all(components.map(async (c) => ({ feedId: c.feedId as Address,
      sourceConfig: (await findMimirV1SourceConfigAddress(program, c.feedId as Address, 0))[0], quantityX64: c.quantityX64 }))) };
  return { rpc, rpcUrl, deps, input, components };
}

const journey = (c: CompositeContext, extra: Record<string, unknown> = {}) =>
  fresh(() => prepareV1CompositeFeedJourney(c.deps, { input: { ...c.input, ...extra } as never }, c.rpc as never));
/** The composite funding facts: the purchase the SDK refuses with, or the journey when no COLA is burned. */
async function compositeFunding(c: CompositeContext) {
  return journey(c, { allowCollateralFunding: true, estimateFundingCosts: true, fullCollateralPurchase: true })
    .catch((e: unknown) => e instanceof MimirBetaCollateralRequiredError ? e : typed(e));
}

/** The composite plan: steps, estimated SOL (activation fee included), prompts and warnings. Builds and signs nothing. */
export function planComposite(args: CompositeArgs): Promise<CompositePlan> {
  return planCompositeRaw(upperTickers(args)).catch(typed);
}
async function planCompositeRaw(args: CompositeArgs): Promise<CompositePlan> {
  const c = await compositeContext(args);
  const [claim] = await findMimirV1TickerClaimPda(MIMIR_MAINNET_DEPLOYMENT.mimirProgramId, args.ticker);
  if ((await c.rpc.getAccountInfo(claim, { commitment: 'confirmed', encoding: 'base64' }).send()).value) fail('TICKER_TAKEN', `${args.ticker} is already claimed (ticker claim ${claim})`);
  const facts = await compositeFunding(c), firstPrice = networkFee(mimirV1RefreshComputeUnitLimit(c.components.length));
  const plan = (feed: string, feedId: string, steps: PlannedStep[], activationFeeLamports: bigint, warnings: string[], tariff = NO_TARIFF): CompositePlan => ({ kind: 'composite',
    args: planArgs(args, {}), feed, feedId, ticker: args.ticker, components: c.components, steps, prompts: steps.length,
    totalLamports: steps.reduce((s, x) => s + x.costLamports, 0n), activationFeeLamports, warnings, ...tariff });
  if (!(facts instanceof MimirBetaCollateralRequiredError)) {
    const next = facts.next?.operationId === 'root' ? facts.next.preparedStep : fail('PLAN_STALE', `${args.ticker} is already created`);
    const root = facts.root ?? fail('PLAN_STALE', `${args.ticker}: no composite root`);
    return plan(root.feed, root.feedId, [{ kind: 'create+price', costLamports: debitOf(await exactFee(c.rpc, next.transaction), next, args.payer) + (next.review.firstPrice ? 0n : firstPrice) }],
      facts.fundingCosts?.protocolFeeLamports ?? 0n, []);
  }
  const root = facts.compositeJourney?.root ?? fail('PLAN_STALE', `${args.ticker}: no composite root in the funding facts`);
  const ataRent = facts.accountMissing ? await readRentExemptLamports(c.rpc as never, 165n) : 0n;
  return plan(root.feed, root.feedId, [{ kind: 'buy-cola', costLamports: networkFee(49_000) + ataRent },
    { kind: 'create+price', costLamports: (facts.fundingCosts?.totalLamports ?? 0n) + firstPrice }], facts.fundingCosts?.protocolFeeLamports ?? 0n,
    ['totalLamports excludes the ticker tariff (tariffCola); the buy-cola review shows its SOL amount'], tariffOf(facts));
}

/** Builds composite step `index` just in time with its exact simulation. */
export function prepareComposite(plan: CompositePlan, index: number): Promise<StepToSign & { prepared?: MimirBetaPreparedStep }> {
  return prepareCompositeRaw(plan, index).catch(typed);
}
async function prepareCompositeRaw(plan: CompositePlan, index: number): Promise<StepToSign & { prepared?: MimirBetaPreparedStep }> {
  if (plan.steps[index]!.kind === 'first-price') return firstPriceStep(lightContext(plan.args as never), plan, index);
  const c = await compositeContext(plan.args), kind = plan.steps[index]!.kind;
  const same = (feed: string | undefined) => { if (feed !== plan.feed) fail('PLAN_STALE', `${plan.ticker}: the planned composite ${plan.feed} changed; plan again`); };
  if (kind === 'buy-cola') {
    const purchase = await fresh(async () => {
      const e = await compositeFunding(c);
      if (!(e instanceof MimirBetaCollateralRequiredError)) return fail('PLAN_STALE', 'this creation burns no COLA: no purchase step');
      same(e.compositeJourney?.root.feed);
      return prepareCollateralPurchase({ cluster: 'mainnet-beta', rpc: c.rpc as never, authority: e.authority, collateralMint: e.mint,
        collateralTokenAccount: e.tokenAccount, decimals: e.decimals, shortfallRaw: e.shortfallRaw, draftHash: e.draftHash, observedBalanceRaw: e.balanceRaw,
        accountMissing: e.accountMissing, costs: e.fundingCosts!, firstPriceLamports: networkFee(mimirV1RefreshComputeUnitLimit(c.components.length)), fingerprints: plan.feed,
        buildSwap: plan.args.buildSwap ?? jupiterSwapBuild() });
    }).catch(typed);
    const t = purchase.transaction;
    return { kind, index, transaction: t, review: { debitLamports: purchase.inputLamports + purchase.networkFeeLamports + purchase.ataRentLamports,
      networkFeeLamports: purchase.networkFeeLamports, writes: [], firstPrice: false, reviewHash: t.messageHash,
      simulation: { slot: purchase.simulationSlot, unitsConsumed: null, computeUnitLimit: t.config.computeUnitLimit, bytes: t.serializedTransaction.length },
      cola: { minimumOutRaw: purchase.minimumOutputRaw, inputLamports: purchase.inputLamports } } };
  }
  const j = await journey(c).catch(typed);
  same(j.root?.feed);
  const next = j.next?.operationId === 'root' ? j.next.preparedStep : fail('PLAN_STALE', `${plan.ticker} is already created`);
  const t = next.transaction, merged = !!next.review.firstPrice;
  const fee = await exactFee(c.rpc, t, next.review.simulation.contextSlot);
  return { kind: merged ? 'create+price' : 'create', index, transaction: t, prepared: next, review: { debitLamports: debitOf(fee, next, plan.args.payer),
    networkFeeLamports: fee, writes: next.review.expectedWrites, firstPrice: merged, reviewHash: next.reviewHash,
    simulation: { slot: next.review.simulation.contextSlot, unitsConsumed: next.review.simulation.unitsConsumed, computeUnitLimit: t.config.computeUnitLimit,
      bytes: t.serializedTransaction.length } } };
}

/** Signs, sends and waits for `finalized`, step by step, like `createFeed`. `pending`: call `planComposite` again later to resume. */
export function createComposite(plan: CompositePlan, opts: CreateOptions): Promise<FeedReceipt> {
  return runPlan(plan, prepareComposite, opts, ['createComposite', 'planComposite']);
}

/** @internal The reviewed unsigned transaction behind a JSON step, rebuilt from its wire. */
export async function unsignedFromWire(step: { kind?: string; transaction: string; payer: string; lastValidBlockHeight: string }): Promise<MimirBetaUnsignedTransaction> {
  const { sha256 } = await import("@noble/hashes/sha256");
  const wire = fromBase64(step.transaction);
  let message: Uint8Array, signers: string[], programs: (string | undefined)[];
  try { ({ message, signers, programs } = await wireFacts(wire)); }
  catch (e) { throw new MimirError("INVALID_INPUT", "the step's transaction is not a Transaction v1 wire", "never", { cause: e }); }
  if (wire[0] !== 0x81 || signers[0] !== step.payer) throw new MimirError("INVALID_INPUT", "the step's transaction is not a Transaction v1 paid by its payer", "never");
  const foreign = programs.findIndex((p) => !p || (step.kind !== 'fresh-price' && !STEP_PROGRAMS.has(p)));
  if (foreign >= 0) throw new MimirError("INVALID_INPUT", `the step's transaction calls ${programs[foreign] ?? "an out-of-range program"}, not a Mimir creation program`, "never");
  const cu = computeUnitLimitOf(message);
  if (cu === null) throw new MimirError("INVALID_INPUT", "the step's transaction has no compute-unit limit in its config", "never");
  return { messageVersion: 1, feePayer: step.payer, recentBlockhash: "", lastValidBlockHeight: BigInt(step.lastValidBlockHeight), instructions: [], requiredSigners: signers,
    serializedMessage: message, serializedTransaction: wire, messageHash: Array.from(sha256(message), (b) => b.toString(16).padStart(2, "0")).join(""),
    config: { computeUnitLimit: cu }, packet: {} } as never;
}

/** @internal A wire's message, signers and called programs (undefined: an out-of-range index). */
export async function wireFacts(wire: Uint8Array) {
  const { getTransactionDecoder } = await import("@solana/transactions");
  const message = new Uint8Array(getTransactionDecoder().decode(wire).messageBytes);
  const compiled = getCompiledTransactionMessageDecoder().decode(message) as { staticAccounts: string[]; header: { numSignerAccounts: number }; instructionHeaders: { programAccountIndex: number }[] };
  return { message, signers: compiled.staticAccounts.slice(0, compiled.header.numSignerAccounts),
    programs: compiled.instructionHeaders.map((h) => compiled.staticAccounts[h.programAccountIndex] as string | undefined) };
}

const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
/** @internal The finalized transaction `signature` is signed first by `payer` and calls Jupiter: a landed COLA purchase (undefined: not readable yet). Any transaction version, json or jsonParsed. */
export async function boughtBy(rpc: Rpc, signature: string, payer: string): Promise<boolean | undefined> {
  const t = (await rpc.getTransaction(signature as never, { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 1 } as never).send()) as
    { transaction?: { message?: { accountKeys?: (string | { pubkey?: string })[]; instructions?: { programIdIndex?: number; programId?: string }[] } } } | null;
  const m = t?.transaction?.message;
  if (!Array.isArray(m?.accountKeys) || !Array.isArray(m.instructions)) return undefined;
  const key = (k: unknown) => (typeof k === 'string' ? k : (k as { pubkey?: string } | undefined)?.pubkey);
  return key(m.accountKeys[0]) === payer && m.instructions.some((i) => (i.programId ?? key(m.accountKeys![i.programIdIndex ?? -1])) === JUPITER);
}

type BuyReceipt = { kind: string; signature: string; slot?: string | bigint; lastValidBlockHeight?: string; sentSlot?: string };
/** @internal `payer`'s landed COLA purchase in `after` (finalized success + `boughtBy`); one landed but not finalized yet throws PENDING. */
export async function landedBuy(rpc: Rpc, after: readonly BuyReceipt[], payer: string) {
  try { return await readLandedBuy(rpc, after, payer); } catch (cause) {
    throw cause instanceof MimirError && cause.code === 'PENDING' ? cause : new MimirError('PENDING', 'the COLA purchase in after could not be read; its outcome is unknown', 'later', { cause });
  }
}
// Absent counts as never landed only for an unverified send whose blockhash expired, on a node whose ledger starts at or before its send slot (else its blockhash height, a lower bound).
async function readLandedBuy(rpc: Rpc, after: readonly BuyReceipt[], payer: string) {
  for (const r of after) {
    if (r.kind !== 'buy-cola') continue;
    const status = () => rpc.getSignatureStatuses([r.signature as never], { searchTransactionHistory: true }).send();
    let read = await status();
    if (!read.value[0]) {
      const fence = await rpc.getSlot({ commitment: 'confirmed' }).send().then(BigInt, () => undefined);
      read = await status();
      if (!read.value[0] && (fence === undefined || BigInt(read.context.slot) < fence)) throw new MimirError('PENDING', `buy-cola ${r.signature}: the node is behind, its outcome is unknown`, 'later');
      if (!read.value[0] && r.lastValidBlockHeight && await rpc.getBlockHeight({ commitment: 'confirmed' }).send() <= BigInt(r.lastValidBlockHeight)) throw new MimirError('PENDING', `buy-cola ${r.signature} may still land`, 'later');
      if (!read.value[0]) {
        const start = r.slot !== undefined && String(r.slot) !== '0' || !r.lastValidBlockHeight ? undefined : BigInt(r.sentSlot ?? BigInt(r.lastValidBlockHeight) - 150n);
        const first = start === undefined ? undefined : await Promise.all([rpc.getFirstAvailableBlock().send(), rpc.minimumLedgerSlot().send()])
          .then(([a, b]) => (BigInt(a) > BigInt(b) ? BigInt(a) : BigInt(b)), () => undefined);
        if (start === undefined || first === undefined || first > start) throw new MimirError('PENDING',
          `buy-cola ${r.signature} is not on this node and its ledger does not cover the purchase; resume with an RPC that keeps transaction history`, 'later');
      }
    }
    const s = read.value[0];
    if (!s || s.err) continue;
    if (s.confirmationStatus !== 'finalized') throw new MimirError('PENDING', `buy-cola ${r.signature} landed but is not finalized yet`, 'later');
    const bought = await boughtBy(rpc, r.signature, payer);
    if (bought === undefined) throw new MimirError('PENDING', `buy-cola ${r.signature} is finalized but not readable yet`, 'later');
    if (bought) return { kind: 'buy-cola' as const, signature: r.signature, slot: BigInt(s.slot) };
  }
  return undefined;
}

/** @internal The ticker claim of `ticker` points at `feed` (finalized). */
export async function claimsFeed(rpc: Rpc, ticker: string, feed: string): Promise<boolean> {
  const [claim] = await findMimirV1TickerClaimPda(MIMIR_MAINNET_DEPLOYMENT.mimirProgramId, ticker.toUpperCase());
  const held = (await rpc.getAccountInfo(claim, { commitment: 'finalized', encoding: 'base64' }).send()).value;
  return !!held && held.owner === MIMIR_MAINNET_DEPLOYMENT.mimirProgramId && decodeMimirTickerClaim(fromBase64(held.data[0])).config === feed;
}

/** @internal A prepared step as the server split's JSON-safe `UnsignedStep`: no secret, no RPC URL. */
export const stepJson = (step: StepToSign, p: { feed: string; steps: PlannedStep[] }, done: number, payer: string) => ({ kind: step.kind, index: done + 1, of: done + p.steps.length,
  payer, feed: p.feed, transaction: base64(step.transaction.serializedTransaction), lastValidBlockHeight: String(step.transaction.lastValidBlockHeight),
  review: { debitSol: exactSol(step.review.debitLamports), networkFeeSol: exactSol(step.review.networkFeeLamports), firstPrice: step.review.firstPrice, reviewHash: step.review.reviewHash,
    ...(step.review.cola ? { colaMinOutRaw: String(step.review.cola.minimumOutRaw) } : {}) } });
