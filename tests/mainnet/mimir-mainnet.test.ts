// Read-only mainnet canary on MIMIR_TEST_RPC (never printed): RPC-mode discovery under 60 calls, createFeed({ mint }) dry run and the full path
// up to a REJECTING signer, createIndex over live feeds the same way. Nothing is signed; a sendTransaction would fail the test.
import assert from 'node:assert/strict';
import { Mimir, MimirError } from '../../src/root.js';
import { poolCandidates } from '../../src/create/candidates.js';

const RPC = process.env.MIMIR_TEST_RPC ?? assert.fail('set MIMIR_TEST_RPC');
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', PAYER = process.env.MIMIR_TEST_PAYER ?? '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const host = new URL(RPC).host, calls = new Map<string, number>(), real = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes(host) && typeof init?.body === 'string') for (const m of [init.body].flatMap((b) => { const j = JSON.parse(b); return (Array.isArray(j) ? j : [j]).map((x) => x.method as string); })) {
    assert.notEqual(m, 'sendTransaction', 'mainnet: read and simulate only');
    calls.set(m, (calls.get(m) ?? 0) + 1);
  }
  return real(input, init);
}) as typeof fetch;
const total = () => [...calls.values()].reduce((a, b) => a + b, 0);
const log = (what: string) => console.log(`${what}: ${total()} RPC calls ${JSON.stringify(Object.fromEntries(calls))}`);
const rejecting = { address: PAYER, sign: async () => { throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); } };

const t0 = Date.now();
const [usdc, sol] = [await poolCandidates(WIF, 'USDC', { rpc: RPC }), await poolCandidates(WIF, 'SOL', { rpc: RPC })];
log(`discovery WIF (${Date.now() - t0} ms): USDC ${usdc.length} top ${usdc[0]?.venue} ${usdc[0]?.quoteReserveRaw}, SOL ${sol.length} top ${sol[0]?.venue}`);
assert.ok(total() <= 60, `discovery used ${total()} calls`);
assert.equal(calls.get('getProgramAccounts'), 30);
assert.ok(usdc.length > 0 && sol.length > 0);
calls.clear();

const reader = new Mimir({ rpc: RPC });
const { MIMIR_MAINNET_COLLATERAL_MINT } = await import('../../src/create/policy.js');
await assert.rejects(reader.createFeed({ mint: MIMIR_MAINNET_COLLATERAL_MINT, dryRun: true, payer: PAYER }),
  (e: MimirError) => { console.log(`COLA mint: ${e.code} ${JSON.stringify(e.feeds)}`); return e.code === 'FEED_EXISTS' && e.feeds!.some((f) => f.ticker === 'COLA'); });
log('FEED_EXISTS COLA');
calls.clear();
const exists = await reader.createFeed({ mint: WIF, dryRun: true, payer: PAYER }).then((p) => p, (e: MimirError) => e);
console.log(`WIF without variant: ${exists instanceof MimirError ? `${exists.code} ${JSON.stringify(exists.feeds ?? [])}` : `plan ${exists.ticker}`}`);
calls.clear();
const plan = await reader.createFeed({ mint: WIF, dryRun: true, payer: PAYER, variant: 'new' });
log(`dryRun WIF: ${plan.ticker} (${plan.symbol}) ${plan.args.quote} pools ${plan.pools.map((p) => `${p.venue}:${p.pool}`).join(',')} steps ${plan.steps.map((s) => s.kind)} total ${plan.totalLamports} lamports + ${plan.tariffCola} COLA`);
assert.ok(plan.steps.length >= 1 && plan.pools.length >= 1 && /^[A-Z0-9]{1,12}$/.test(plan.ticker));
calls.clear();

const solPlan = await reader.createFeed({ mint: WIF, dryRun: true, payer: PAYER, variant: 'new', quote: 'SOL' });
log(`dryRun WIF SOL-quoted: ${solPlan.ticker} ${solPlan.args.quote} pools ${solPlan.pools.map((p) => `${p.venue}:${p.pool}`).join(',')} steps ${solPlan.steps.map((s) => s.kind)} total ${solPlan.totalLamports} + ${solPlan.tariffCola} COLA`);
assert.equal(solPlan.args.quote, 'SOL');
assert.ok(solPlan.steps.length >= 1 && solPlan.pools.length >= 1);
calls.clear();

const creator = new Mimir({ wallet: rejecting, rpc: RPC });
const events: string[] = [];
await assert.rejects(creator.createFeed({ mint: WIF, variant: 'new', onStep: (e) => { events.push(`${e.kind}:${e.state}`); } }),
  (e: MimirError) => { console.log(`WIF rejecting signer: ${e.code} after ${JSON.stringify(events)}`); return e.code === 'WALLET_REJECTED' && !e.signatures?.length; });
log('createFeed WIF up to the signer');
assert.equal(calls.get('sendTransaction') ?? 0, 0);
calls.clear();

const ticker = `QA${Date.now().toString(36).toUpperCase().slice(-6)}`;
const index = await reader.createIndex({ ticker, components: { SOL: 1, WETH: '0.05' }, dryRun: true, payer: PAYER });
log(`dryRun index ${index.ticker}: ${index.components.map((c) => c.ticker)} steps ${index.steps.map((s) => s.kind)} activation ${index.activationFeeLamports}`);
calls.clear();
await assert.rejects(creator.createIndex({ ticker, components: { SOL: 1, WETH: '0.05' } }), (e: MimirError) => { console.log(`index rejecting signer: ${e.code}`); return e.code === 'WALLET_REJECTED'; });
log('createIndex up to the signer');
console.log('mimir mainnet canary: ok');
