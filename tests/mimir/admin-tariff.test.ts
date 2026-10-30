// The tariff follows AdminConfig: each plan reads it; a revision change before the first signature re-plans once, after a signature it is a typed error.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { WIF_MINT } from './fixtures.js';
import * as Facade from '../../src/create/facade.js';
import { MimirError } from '../../src/easy/price.js';
import { computeMimirV1TickerTariff } from '../../src/v1/build.js';

const admin = { rev: 6, base: 15_000_000_000n, tiers: [100, 15, 3, 2] };
let plans = 0, buys = 0, bumpAfter: 'plan' | 'buy' | null = null;
mock.module(new URL('../../src/create/token.ts', import.meta.url).href, { namedExports: {
  resolveToken: async (mint: string) => ({ mint, symbol: 'WIF', verified: true, warnings: [] }), existingFeeds: async () => [], autoTicker: async () => 'WIF' } });
mock.module(new URL('../../src/create/facade.ts', import.meta.url).href, { namedExports: { ...Facade,
  prepareFeed: async (args: Facade.FeedArgs) => {
    plans++;
    const raw = computeMimirV1TickerTariff(admin.base, args.ticker, admin.tiers), steps = [{ kind: 'buy-cola', costLamports: 1n }, { kind: 'create+price', costLamports: 1n }];
    const plan = { kind: 'feed', args, feed: 'F', feedId: `rev${admin.rev}`, ticker: args.ticker, pools: [], steps, prompts: 2, totalLamports: 2n, warnings: [], tariffColaRaw: raw, tariffCola: String(raw / 1_000_000n) };
    if (bumpAfter === 'plan') { admin.rev++; bumpAfter = null; }
    return plan;
  },
  createFeed: async (plan: Facade.FeedPlan, opts: Facade.CreateOptions) => {
    const signatures: Facade.FeedReceipt['signatures'] = [];
    for (const s of plan.steps) {
      if (plan.feedId !== `rev${admin.rev}`) return { state: 'failed', feed: plan.feed, signatures, price: null, error: new MimirError('PLAN_STALE', 'AdminConfig revision changed', 'never') };
      await opts.sign({ kind: s.kind, index: 0, transaction: {}, review: { debitLamports: 0n } } as never);
      if (s.kind === 'buy-cola') buys++;
      signatures.push({ kind: s.kind, signature: `sig-${s.kind}`, slot: 1n });
      if (bumpAfter === 'buy') { admin.rev++; bumpAfter = null; }
    }
    return { state: 'ready', feed: plan.feed, signatures, price: { ticker: plan.ticker, price: 1, quote: 'USDC', status: 'fresh' } as never };
  } } });
const { Mimir } = await import('../../src/mimir.js');
const mimir = new Mimir({ wallet: { address: '6Ba7yenKXHuauCn451XN8UotWgKtZyvxPMFwcPZza2Kz', sign: async () => new Uint8Array(0) }, api: 'http://127.0.0.1:1', rpc: 'http://127.0.0.1:1' });
const dry = (): Promise<Facade.FeedPlan> => mimir.createFeed({ mint: WIF_MINT, pools: ['P1'], dryRun: true });

assert.equal((await dry()).tariffCola, '22500');
Object.assign(admin, { rev: 7, base: 20_000_000_000n, tiers: [150, 30, 5, 2] });
assert.equal((await dry()).tariffCola, '60000', 'the next plan uses the new AdminConfig');

plans = 0; buys = 0; bumpAfter = 'plan';
await mimir.createFeed({ mint: WIF_MINT, pools: ['P1'] });
assert.deepEqual([plans, buys], [2, 1], 'a revision change before the first signature re-plans exactly once');

plans = 0; buys = 0; bumpAfter = 'buy';
await assert.rejects(mimir.createFeed({ mint: WIF_MINT, pools: ['P1'] }), (e: MimirError) => e.code === 'PLAN_STALE' && e.signatures!.length === 1);
assert.deepEqual([plans, buys], [1, 1], 'after a signature: a typed error, no second purchase');
console.log('admin tariff follows AdminConfig: ok');
