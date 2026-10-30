// createFeed({ mint }) orchestration with the chain mocked: token → existing → pools → eligibility → SOL price → recommend → ticker → plan → signs → ready.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { WIF_MINT, USDC_MINT } from './fixtures.js';
import * as Facade from '../../src/create/facade.js';
import { MimirError } from '../../src/easy/price.js';

const log: string[] = [];
let existing: { feed: string; ticker: string; quote: 'USDC' | 'SOL'; creator: string; priced: boolean }[] = [];
let bought = false, reject = false, pending = false;
const PAYER = '6Ba7yenKXHuauCn451XN8UotWgKtZyvxPMFwcPZza2Kz', FEED = 'Feed111111111111111111111111111111111111111';
mock.module(new URL('../../src/create/token.ts', import.meta.url).href, { namedExports: {
  resolveToken: async (mint: string) => { log.push(`token ${mint === WIF_MINT}`); return { mint, symbol: '$WIF', verified: true, warnings: [] }; },
  existingFeeds: async () => { log.push('existing'); return existing; },
  autoTicker: async (symbol: string) => { log.push(`ticker ${symbol}`); return 'WIF'; } } });
mock.module(new URL('../../src/create/candidates.ts', import.meta.url).href, { namedExports: {
  poolCandidates: async (_m: string, q: string) => { log.push(`pools ${q}`); return q === 'USDC' ? [{ pool: 'P1' }] : []; } } });
mock.module(new URL('../../src/create/discovery.ts', import.meta.url).href, { namedExports: {
  resolveEligiblePoolsSplit: async (_r: unknown, _b: unknown, _q: unknown, pools: string[]) => { log.push(`eligible ${pools}`); return pools.map((pool) => ({ pool, quoteMint: USDC_MINT })); } } });
let noSet = false;
mock.module(new URL('../../src/create/recommend.ts', import.meta.url).href, { namedExports: {
  recommend: (pools: { pool: string }[]) => { log.push('recommend'); if (noSet) return null; return { pools, choices: { P1: { recipe: 'native-bounded', routeable: false } }, score: {} }; } } });
const step = (kind: string) => ({ kind, index: 0, transaction: {}, review: { debitLamports: kind === 'buy-cola' ? 10_000_000n : 6_000_000n } });
mock.module(new URL('../../src/create/facade.ts', import.meta.url).href, { namedExports: { ...Facade, facadeRpc: () => ({}),
  prepareFeed: async (args: Facade.FeedArgs) => { log.push(`plan ${args.ticker} ${args.quote} ${args.pools} ${args.recipe} ${args.payer === PAYER}`);
    const steps = existing.length ? [{ kind: 'first-price', costLamports: 1n }] : [...(bought ? [] : [{ kind: 'buy-cola', costLamports: 1n }]), { kind: 'create+price', costLamports: 2n }];
    return { kind: 'feed', args, feed: FEED, feedId: FEED, ticker: args.ticker, pools: [], steps, prompts: steps.length, totalLamports: 3n, warnings: [], tariffColaRaw: 0n, tariffCola: '0' }; },
  createFeed: async (plan: Facade.FeedPlan, opts: Facade.CreateOptions) => {
    const signatures: Facade.FeedReceipt['signatures'] = [];
    try {
      for (const s of plan.steps) {
        if (s.kind !== 'buy-cola' && reject) throw new MimirError('WALLET_REJECTED', 'declined', 'now');
        await opts.onStep?.({ kind: s.kind, state: 'prepared' });
        await opts.sign(step(s.kind) as never); log.push(`signed ${s.kind}`);
        if (pending) return { state: 'pending', feed: plan.feed, signatures, price: null, error: new MimirError('RPC', 'sig was sent; outcome unknown', 'later') };
        if (s.kind === 'buy-cola') bought = true;
        signatures.push({ kind: s.kind, signature: `sig-${s.kind}`, slot: 1n });
      }
    } catch (e) { return { state: 'failed', feed: plan.feed, signatures, price: null, error: MimirError.from(e) }; }
    return { state: 'ready', feed: plan.feed, signatures, price: { ticker: plan.ticker, price: 0.75, quote: 'USDC', status: 'fresh' } as never };
  } } });
const { Mimir } = await import('../../src/mimir.js');
const wallet = { address: PAYER, sign: async () => new Uint8Array(0) };
const mimir = new Mimir({ wallet, api: 'http://127.0.0.1:1' });

const plan = await new Mimir({ api: 'http://127.0.0.1:1' }).createFeed({ mint: WIF_MINT, dryRun: true });
assert.deepEqual([plan.ticker, plan.symbol, plan.steps.map((s) => s.kind)], ['WIF', '$WIF', ['buy-cola', 'create+price']], 'dryRun needs no wallet and signs nothing');
assert.ok(!log.some((l) => l.startsWith('signed')));
assert.deepEqual(log, ['token true', 'existing', 'pools USDC', 'pools SOL', 'eligible P1', 'recommend', 'ticker $WIF', 'plan WIF USDC P1 native-bounded false']);

log.length = 0;
const events: string[] = [];
const feed = await mimir.createFeed({ mint: WIF_MINT, onStep: (e) => { events.push(`${e.kind}:${e.state}`); } });
assert.deepEqual([feed.state, feed.ticker, feed.feed, feed.price.price, feed.signatures.map((s) => s.kind), feed.cost], ['ready', 'WIF', FEED, 0.75, ['buy-cola', 'create+price'], { sol: '0.016', lamports: 16_000_000n }]);
assert.deepEqual(log.slice(-2), ['signed buy-cola', 'signed create+price']);
assert.deepEqual(events, ['buy-cola:prepared', 'create+price:prepared']);

existing = [{ feed: FEED, ticker: 'WIF', quote: 'USDC', creator: 'someone', priced: true }];
await assert.rejects(mimir.createFeed({ mint: WIF_MINT }), (e: MimirError) => e.code === 'FEED_EXISTS' && e.feeds![0]!.ticker === 'WIF' && /mimir\.price\('WIF'\)/.test(e.hint));
existing = [{ feed: FEED, ticker: 'WIF7', quote: 'SOL', creator: PAYER, priced: false }];
log.length = 0;
const own = await mimir.createFeed({ mint: WIF_MINT });
assert.deepEqual([own.ticker, own.signatures.map((s) => s.kind)], ['WIF7', ['first-price']], 'own unpriced feed: only its first price');
assert.ok(log.includes('plan WIF7 SOL undefined undefined true') && !log.some((l) => l.startsWith('pools')));

existing = []; bought = false; reject = true;
await assert.rejects(mimir.createFeed({ mint: WIF_MINT }), (e: MimirError) => e.code === 'WALLET_REJECTED' && e.signatures!.length === 1 && e.signatures![0]!.kind === 'buy-cola');
reject = false; log.length = 0;
const resumed = await mimir.createFeed({ mint: WIF_MINT });
assert.deepEqual(resumed.signatures.map((s) => s.kind), ['create+price'], 'the second call never buys COLA again');
bought = false; pending = true;
await assert.rejects(mimir.createFeed({ mint: WIF_MINT }), (e: MimirError) => e.code === 'PENDING' && e.retry === 'later');
pending = false;
await assert.rejects(mimir.createFeed({ mint: 'not-a-mint' }), (e: MimirError) => e.code === 'INVALID_INPUT' || e.code === 'NOT_FOUND');
noSet = true;
await assert.rejects(new Mimir({ api: 'http://127.0.0.1:1' }).createFeed({ mint: WIF_MINT, dryRun: true }), (e: MimirError) => e.code === 'NO_POOL' && !/undefined/.test(e.message));
noSet = false;
console.log('mimir createFeed auto path: ok');
