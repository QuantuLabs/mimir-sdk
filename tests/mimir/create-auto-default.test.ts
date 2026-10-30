// createFeed({ mint, dryRun }) with the real recommender: a DLMM pick seals Default, a CLMM pick native-bounded.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { WIF_MINT, USDC_MINT } from './fixtures.js';
import * as Facade from '../../src/create/facade.js';

const recipes: unknown[] = [];
let adapterType = 3;
mock.module(new URL('../../src/create/token.ts', import.meta.url).href, { namedExports: {
  resolveToken: async (mint: string) => ({ mint, symbol: '$WIF', verified: true, warnings: [] }), existingFeeds: async () => [], autoTicker: async () => 'WIF' } });
mock.module(new URL('../../src/create/candidates.ts', import.meta.url).href, { namedExports: {
  poolCandidates: async (_m: string, q: string) => q === 'USDC' ? [{ pool: 'P1' }] : [] } });
mock.module(new URL('../../src/create/discovery.ts', import.meta.url).href, { namedExports: {
  resolveEligiblePoolsSplit: async () => [{ pool: 'P1', family: adapterType === 3 ? 'meteora-dlmm' : 'raydium-clmm', quoteMint: USDC_MINT,
    minDepthTo50BpsNative: 50_000n * 10n ** 6n, creation: { adapterType, adapterVersion: 1 } }] } });
mock.module(new URL('../../src/create/facade.ts', import.meta.url).href, { namedExports: { ...Facade, facadeRpc: () => ({}),
  prepareFeed: async (args: Facade.FeedArgs) => { recipes.push(args.recipe);
    return { kind: 'feed', args, feed: 'F', feedId: 'F', ticker: args.ticker, pools: [], steps: [], prompts: 0, totalLamports: 0n, warnings: [], tariffColaRaw: 0n, tariffCola: '0' }; } } });
const { Mimir } = await import('../../src/mimir.js');
const mimir = new Mimir({ api: 'http://127.0.0.1:1' });
await mimir.createFeed({ mint: WIF_MINT, dryRun: true });
adapterType = 1;
await mimir.createFeed({ mint: WIF_MINT, dryRun: true });
assert.deepEqual(recipes, [['default'], ['native-bounded']], 'DLMM → Default; CLMM → native-bounded');
console.log('mimir createFeed default recipe: ok');
