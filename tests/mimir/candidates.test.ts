// RPC-mode pool discovery: exactly 15 gPA with the venue filters and a vault-only dataSlice, reserve reads with dataSlice {64, 8}, ranking caps,
// Retry-After, the 60 s cache and in-flight de-duplication. API mode makes no gPA.
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { fakeRpc, mockApi, b64, WIF_MINT, USDC_MINT } from './fixtures.js';
import { poolCandidates, clearCandidateCache, scanQueries } from '../../src/create/candidates.js';

const key = (i: number, tag: number) => bs58.encode(Uint8Array.from({ length: 32 }, (_, j) => (j === 0 ? tag : j === 1 ? i : 7)));
const queries = scanQueries(WIF_MINT, USDC_MINT);
assert.equal(queries.length, 15);
let limited = false;
const rpc = await fakeRpc((method, params) => {
  if (method === 'getProgramAccounts') {
    if (!limited) { limited = true; return ['status', 429, { 'retry-after': '1' }]; }
    const [program, cfg] = params as [string, { dataSlice: { length: number }; filters: { memcmp?: { bytes: string } }[] }];
    const qi = queries.findIndex((q) => q.programId === program && JSON.stringify(q.config) === JSON.stringify(cfg));
    assert.ok(qi >= 0, 'every gPA is one of the 15 queries');
    const q = queries[qi]!, n = q.family === 'meteora-dlmm' && cfg.filters[1]!.memcmp!.bytes === WIF_MINT ? 6 : qi === 0 ? 1 : 0;
    return Array.from({ length: n }, (_, i) => { const d = new Uint8Array(cfg.dataSlice.length); d.set(bs58.decode(key(i, 200 + qi)), q.quoteVaultAt);
      return { pubkey: key(i, qi), account: { data: [b64(d), 'base64'] } }; });
  }
  if (method === 'getMultipleAccounts') {
    const [keys, cfg] = params as [string[], { dataSlice: unknown }];
    assert.deepEqual(cfg.dataSlice, { offset: 64, length: 8 });
    return { context: { slot: 1 }, value: keys.map((k) => { const d = new Uint8Array(8); new DataView(d.buffer).setBigUint64(0, BigInt(1000 + bs58.decode(k)[1]!), true); return { data: [b64(d), 'base64'] }; }) };
  }
  throw new Error(method);
});
try {
  const t0 = Date.now();
  const [a, b] = await Promise.all([poolCandidates(WIF_MINT, 'USDC', { rpc: rpc.url }), poolCandidates(WIF_MINT, 'USDC', { rpc: rpc.url })]);
  assert.equal(a, b, 'in-flight de-duplication');
  assert.ok(Date.now() - t0 >= 950, 'Retry-After honoured');
  const gpa = rpc.calls.filter((c) => c.method === 'getProgramAccounts');
  assert.equal(gpa.length, 16, '15 queries + the one 429 retry');
  for (const c of gpa) { const cfg = c.params[1] as { encoding: string; commitment: string; dataSlice: { length: number } }; assert.deepEqual([cfg.encoding, cfg.commitment], ['base64', 'confirmed']); assert.ok(cfg.dataSlice.length <= 112); }
  assert.equal(rpc.calls.filter((c) => c.method === 'getMultipleAccounts').length, 1);
  assert.deepEqual(a.map((x) => x.venue), ['meteora-dlmm', 'meteora-dlmm', 'meteora-dlmm', 'meteora-dlmm', queries[0]!.family], 'top 4 per venue, deepest first');
  assert.deepEqual(a.slice(0, 4).map((x) => x.quoteReserveRaw), [1005n, 1004n, 1003n, 1002n]);
  const calls = rpc.calls.length;
  await poolCandidates(WIF_MINT, 'USDC', { rpc: rpc.url });
  assert.equal(rpc.calls.length, calls, 'served from the 60 s cache');
  clearCandidateCache();
  const api = await mockApi();
  try {
    const before = rpc.calls.length;
    const viaApi = await poolCandidates(WIF_MINT, 'USDC', { api: api.url });
    assert.deepEqual([viaApi.length, rpc.calls.length - before, api.requests], [1, 0, [`GET /v1/pools?mint=${WIF_MINT}&quote=USDC`]]);
  } finally { await api.close(); }
  console.log('mimir pool candidates: ok');
} finally { await rpc.close(); }
