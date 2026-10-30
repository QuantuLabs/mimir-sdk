// The recommender (the app's pool-score.ts, moved): USDC unless SOL scores at least 5 higher, depth through Mimir's SOL price, require filters.
import assert from 'node:assert/strict';
import { recommend, depthUsdc, recipeMode, CONF_BPS, scoreInput, autoChoice } from '../../src/create/recommend.js';
import { scoreFeed } from '../../src/easy/feedInfo.js';
import { SOL_MINT, USDC_MINT } from './fixtures.js';

const SOL_X64 = BigInt(150) << 64n;
const pool = (pool: string, family: string, quoteMint: string, depthNative: bigint, adapterType = 2) =>
  ({ pool, family, quoteMint, minDepthTo50BpsNative: depthNative, creation: { adapterType, adapterVersion: 1 } }) as never;
const usdc = pool('U1', 'raydium-cpmm', USDC_MINT, 20_000n * 10n ** 6n), sol = (lamports: bigint) => pool('S1', 'orca-whirlpool', SOL_MINT, lamports, 0);

assert.equal(depthUsdc(usdc, USDC_MINT), 20_000);
assert.equal(depthUsdc(sol(10n ** 9n * 100n), USDC_MINT, SOL_X64), 15_000);
assert.equal(depthUsdc(sol(1n), USDC_MINT), null, 'no SOL price: SOL depth unknown');
assert.deepEqual([recipeMode(undefined), recipeMode('native-bounded'), recipeMode('current-point'), recipeMode('orca-marker-quiet')], [0, 2, 5, 3]);
assert.deepEqual(CONF_BPS, { 0: 5, 1: 5, 2: 1, 4: 1, 6: 1, 7: 5 });

const onlyUsdc = recommend([usdc], { usdcMint: USDC_MINT, solUsdcX64: SOL_X64 })!;
assert.deepEqual(onlyUsdc.pools.map((p) => p.pool), ['U1']);
const rule = (solPool: never) => {
  const both = recommend([usdc, solPool], { usdcMint: USDC_MINT, solUsdcX64: SOL_X64 })!;
  const ranked = (p: never) => { const { mode: _, ...rest } = scoreInput(p, autoChoice(p), USDC_MINT, SOL_X64); return scoreFeed({ pools: [rest] })!.score; };
  const u = ranked(usdc), s = ranked(solPool);
  assert.equal(both.pools[0]!.pool, s >= u + 5 ? 'S1' : 'U1', `SOL only at +5 (usdc ${u}, sol ${s})`);
  return s - u;
};
const gaps = [1n, 10n, 150n, 10_000n, 1_000_000n].map((k) => rule(sol(10n ** 9n * k)));
assert.ok(gaps.some((g) => g < 5) && gaps.some((g) => g >= 5), `both sides of the +5 rule exercised: ${gaps}`);
assert.equal(recommend([sol(10n ** 12n)], { usdcMint: USDC_MINT }), null, 'SOL depth unknown without the SOL price');
assert.equal(recommend([], { usdcMint: USDC_MINT }), null);
assert.equal(recommend([usdc], { usdcMint: USDC_MINT, require: 'market-grade' }), null, 'a single CPMM pool under Default is not market-grade');
// The auto recipe follows the deployed program: native-bounded only on Raydium CLMM (it prices a quiet pool); DLMM and CPMM get Default.
const [dlmm, cpmm, clmm] = [3, 2, 1].map((t) => pool(`A${t}`, t === 3 ? 'meteora-dlmm' : t === 2 ? 'raydium-cpmm' : 'raydium-clmm', USDC_MINT, 20_000n * 10n ** 6n, t));
assert.deepEqual([autoChoice(dlmm), autoChoice(cpmm)], [null, null], 'DLMM/CPMM: no native auto choice');
assert.deepEqual(autoChoice(clmm), { recipe: 'native-bounded', routeable: false }, 'CLMM: native-bounded:direct');
assert.deepEqual(recommend([dlmm], { usdcMint: USDC_MINT })!.choices, {}, 'a DLMM pick seals Default');
assert.deepEqual(recommend([clmm], { usdcMint: USDC_MINT })!.choices, { A1: { recipe: 'native-bounded', routeable: false } });
assert.deepEqual([scoreInput(dlmm, null, USDC_MINT).adapterType, scoreInput(clmm, autoChoice(clmm), USDC_MINT).mode], [3, 2], 'scoreInput passes the adapter type');
assert.equal(recommend([usdc], { usdcMint: USDC_MINT, require: { minScore: 101 } }), null);
// One recipe class per set: CLMM native beside a Default DLMM would be a bounded minority the program refuses, so the set seals Default.
const mixed = recommend([clmm, dlmm], { usdcMint: USDC_MINT })!;
assert.deepEqual([mixed.pools.length, mixed.choices], [2, {}], 'a mixed set seals Default on every pool');
console.log('mimir recommend: ok');
