// The mint's symbol (verified API, else on-chain metadata) and the auto ticker: firstFreeTicker rules in one getMultipleAccounts of ≤ 20 claims.
import assert from 'node:assert/strict';
import { fakeRpc, mockApi, b64, WIF_MINT } from './fixtures.js';
import { resolveToken, tickerCandidates, autoTicker } from '../../src/create/token.js';
import { findMimirV1TickerClaimPda, MIMIR_V1_MAINNET_PROGRAM_ID } from '../../src/v1/build.js';
import type { MimirError } from '../../src/root.js';

const str = (s: string) => { const b = new TextEncoder().encode(s), out = new Uint8Array(4 + b.length); new DataView(out.buffer).setUint32(0, b.length, true); out.set(b, 4); return out; };
const metadata = Uint8Array.from([4, ...new Uint8Array(64), ...str('Other\0\0'), ...str('OTH\0\0')]);
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', META = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const taken = new Set<string>();
const rpc = await fakeRpc((method, params) => {
  const keys = (params as [string[]])[0];
  if (keys.length === 2) return { context: { slot: 1 }, value: [{ owner: TOKEN, executable: false, data: [b64(new Uint8Array(82)), 'base64'] }, { owner: META, executable: false, data: [b64(metadata), 'base64'] }] };
  return { context: { slot: 1 }, value: keys.map((k) => (taken.has(k) ? { owner: MIMIR_V1_MAINNET_PROGRAM_ID, executable: false, data: [b64(new Uint8Array(8)), 'base64'] } : null)) };
});
const api = await mockApi();
try {
  const wif = await resolveToken(WIF_MINT, { rpc: rpc.url, api: api.url, apiMode: true });
  assert.deepEqual([wif.symbol, wif.verified, wif.warnings, rpc.calls.length], ['$WIF', true, [], 0]);
  const other = 'Bogus11111111111111111111111111111111111111';
  const viaChain = await resolveToken(other, { rpc: rpc.url, api: api.url, apiMode: true });
  assert.deepEqual([viaChain.symbol, viaChain.verified, viaChain.warnings.length], ['OTH', false, 1], 'unverified in the API: the metadata symbol, with a warning');
  const rpcMode = await resolveToken(WIF_MINT, { rpc: rpc.url, apiMode: false });
  assert.equal(rpcMode.symbol, 'OTH'); assert.equal(api.requests.length, 2, 'RPC mode makes no API call');
  await assert.rejects(resolveToken('WIF', { rpc: rpc.url, apiMode: true }), (e: MimirError) => e.code === 'INVALID_INPUT' && /mint/.test(e.hint));

  assert.deepEqual(tickerCandidates('$wif', 'x').slice(0, 3), ['WIF', 'WIF1', 'WIF2']);
  assert.equal(tickerCandidates('$wif', 'x').length, 20);
  assert.deepEqual(tickerCandidates('x', 'm').slice(0, 2), ['X1', 'X2'], 'one letter starts at its 1');
  assert.equal(tickerCandidates('ABCDEFGHIJKLMNOP', 'm')[0], 'ABCDEFGHIJKL');
  assert.equal(tickerCandidates('ABCDEFGHIJKLMNOP', 'm')[19], 'ABCDEFGHIJ19');
  const claim = async (t: string) => (await findMimirV1TickerClaimPda(MIMIR_V1_MAINNET_PROGRAM_ID as never, t))[0] as string;
  taken.add(await claim('WIF')); taken.add(await claim('WIF1'));
  const before = rpc.calls.length;
  assert.equal(await autoTicker('$WIF', rpc.url), 'WIF2');
  assert.equal(rpc.calls.length - before, 1); assert.equal((rpc.calls.at(-1)!.params[0] as string[]).length, 20);
  for (const t of tickerCandidates('WIF', 'x')) taken.add(await claim(t));
  await assert.rejects(autoTicker('WIF', rpc.url), (e: MimirError) => e.code === 'TICKER_TAKEN');
  console.log('mimir token + ticker: ok');
} finally { await rpc.close(); await api.close(); }
