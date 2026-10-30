// The SDK contract with the Mimir API: every read route, input order, chunks of 30, USDC with the native quote, errors and Retry-After, watch polling.
import assert from 'node:assert/strict';
import { mockApi, FEEDS, INDEX, SOL_MINT } from './fixtures.js';
import { api as api_ } from '../../src/api/client.js';
FEEDS.MEME = INDEX;
import { Mimir, MimirError } from '../../src/root.js';
import { searchTokens, poolCandidates } from '../../src/publicApi.js';

const api = await mockApi();
try {
  const mimir = new Mimir({ api: api.url });
  assert.equal(mimir.mode, 'api');
  const sol = await mimir.price('sol');
  assert.deepEqual([sol.ticker, sol.kind, sol.price, sol.quote?.symbol, sol.token?.mint, sol.sources?.[0]?.venue, sol.confidenceBps, sol.dispersionBps, sol.slot, sol.updatedAt, sol.reason],
    ['SOL', 'token', 182.41, 'USDC', SOL_MINT, 'orca-whirlpool', 12, 8, 462544186n, 1793136000, undefined]);
  for (const k of ['status', 'mode', 'live', 'priceX64', 'native', 'observedSlot', 'v', 'feed']) assert.equal(k in sol, false, k);
  assert.equal(api.requests.at(-1), 'POST /v1/feeds {"feeds":["sol"]}');

  const [wif, again] = await mimir.prices(['WIF', FEEDS.SOL!.address]);
  assert.deepEqual([wif!.price, wif!.quote?.symbol], [0.7479, 'SOL'], 'a SOL-quoted feed is priced in USDC by the API');
  assert.equal(again!.ticker, 'SOL');
  const before = api.requests.length;
  const cola = await mimir.price('COLA');
  assert.deepEqual([cola.price, cola.confidenceBps, cola.dispersionBps, cola.reason, cola.slot], [null, null, null, 'NOT_READY', 462544186n], 'not priced: the reason, the slot evaluated');
  assert.equal(api.requests.length - before, 1, 'no SOL conversion request');
  const meme = await mimir.price('MEME');
  assert.deepEqual([meme.kind, meme.token, meme.components?.map((c) => [c.ticker, c.weight])], ['index', null, [['WIF', 0.6], ['SOL', 0.4]]]);

  assert.deepEqual(await api_.feed(api.url, 'SOL').then((f) => [f.address, f.slot]), [FEEDS.SOL!.address, 462544186n]);
  const h = await api_.history(api.url, 'SOL', '1d');
  assert.deepEqual([h.address, h.range, h.points], [FEEDS.SOL!.address, '1d', [[1793132400, 181.9], [1793136000, 182.41]]]);

  const many = [...Array.from({ length: 30 }, (_, i) => (i % 2 ? 'SOL' : 'sol')), 'WIF', ...Object.values(FEEDS).map((f) => f.address)];
  const n = api.requests.length;
  const got = await mimir.prices(many);
  assert.deepEqual([got.length, got[30]!.ticker, got[31]!.ticker], [35, 'WIF', 'SOL']);
  assert.equal(api.requests.length - n, 1, 'deduplicated to 7 inputs: one batch');

  for (let i = 0; i < 31; i++) FEEDS[`T${i}`] = { ...FEEDS.SOL!, ticker: `T${i}`, address: `${FEEDS.SOL!.address.slice(0, -2)}${String.fromCharCode(65 + (i >> 4), 65 + (i & 15))}` };
  const m = api.requests.length;
  assert.equal((await mimir.prices(Array.from({ length: 31 }, (_, i) => `T${i}`))).at(-1)!.ticker, 'T30');
  assert.equal(api.requests.length - m, 2, 'chunks of 30');
  await assert.rejects(mimir.price('NOPE'), (e: MimirError) => e instanceof MimirError && e.code === 'NOT_FOUND' && e.retry === 'never' && e.hint === 'mock NOT_FOUND');
  api.limitOnce(1);
  const t0 = Date.now();
  assert.equal((await mimir.price('SOL')).ticker, 'SOL');
  assert.ok(Date.now() - t0 >= 950, 'Retry-After honoured');
  api.limitOnce(30);
  await assert.rejects(mimir.price('SOL'), (e: MimirError) => e.code === 'RATE_LIMITED' && e.retry === 'later' && /Retry-After 30/.test(e.message));

  assert.deepEqual((await searchTokens('WIF', { api: api.url })).map((t) => [t.symbol, t.verified]), [['$WIF', true], ['WIF', false]]);
  const pools = await poolCandidates(FEEDS.WIF ? 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' : '', 'USDC', { api: api.url });
  assert.deepEqual(pools, [{ pool: 'ADEjbFryLPfYLmCrMCFo2BUaoZb86VmCkBZbjnHPM5S8', venue: 'meteora-dlmm', programId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', quoteReserveRaw: 453_520_000n }]);

  // watch: one batch request per tick, never faster than 2 s; a "never" error stops it.
  const seen: string[] = [], start = api.requests.length;
  const stop = mimir.watch(['SOL', 'WIF'], (p) => seen.push(p.ticker!), undefined, { intervalMs: 10 });
  await new Promise((r) => setTimeout(r, 2_300));
  stop();
  const ticks = api.requests.slice(start).filter((r) => r.startsWith('POST /v1/feeds {"feeds":["SOL","WIF"]'));
  assert.equal(ticks.length, 2, `two ticks in 2.3 s at the 2 s minimum, got ${ticks.length}`);
  assert.deepEqual(seen, ['SOL', 'WIF', 'SOL', 'WIF']);
  const nan = api.requests.length, stopNaN = mimir.watch(['SOL'], () => {}, undefined, { intervalMs: NaN });
  await new Promise((r) => setTimeout(r, 300)); stopNaN();
  assert.equal(api.requests.length - nan, 1, 'a NaN interval falls back to the default');
  const errors: MimirError[] = [];
  const stop2 = mimir.watch(['NOPE'], () => {}, (e) => errors.push(e));
  await new Promise((r) => setTimeout(r, 300)); stop2();
  assert.deepEqual(errors.map((e) => e.code), ['NOT_FOUND']);
  console.log('mimir api contract: ok');
} finally { await api.close(); }
