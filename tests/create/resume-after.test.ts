// Resume: a landed COLA purchase in `after` is reused (the plan signs CREATE first); a buy-cola receipt that is not the payer's purchase still buys; an unreadable one is PENDING.
import assert from 'node:assert/strict';
const { runPlan } = await import('../../src/create/facade.js');
const { compileMimirBetaTransactionV1 } = await import('../../src/beta/transactionV1.js');
const { base64 } = await import('../../src/beta/bytes.js');
const payer = '6Ba7yenKXHuauCn451XN8UotWgKtZyvxPMFwcPZza2Kz', BUY = '5'.repeat(88);
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
// getTransaction json as providers return it: native v1, re-encoded legacy / v0 (Flux), jsonParsed (object keys, programId).
const tx = (program: string, version: unknown = 1, parsed = false) => ({ slot: 7, version, meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
  transaction: { signatures: [BUY], message: parsed ? { accountKeys: [{ pubkey: payer, signer: true }, { pubkey: program }], instructions: [{ programId: program, accounts: [], data: '' }] }
    : { accountKeys: [payer, program], instructions: [{ programIdIndex: 1, accounts: [0], data: '' }] } } });
const fin = { slot: 7, confirmations: null, err: null, confirmationStatus: 'finalized' };
type Receipt = { slot?: string; lastValidBlockHeight?: string; sentSlot?: string };
async function first(txn: unknown, status: unknown = fin, ctx = 9, receipt: Receipt = {}, ledger = 0) {
  const methods: string[] = [];
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => { const b = JSON.parse(init.body); methods.push(b.method);
    const result = b.method === 'getSignatureStatuses' ? { context: { slot: ctx }, value: [status] } : b.method === 'getSlot' ? 9 : b.method === 'getBlockHeight' ? 500
      : b.method === 'getFirstAvailableBlock' || b.method === 'minimumLedgerSlot' ? ledger : txn ?? null;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result }), { headers: { 'content-type': 'application/json' } }); }) as never;
  const kinds: string[] = [];
  const plan = { feed: payer, args: { payer, rpc: 'http://127.0.0.1:1' }, steps: [{ kind: 'buy-cola', costLamports: 1n }, { kind: 'create+price', costLamports: 1n }] } as never;
  const r = await runPlan(plan, async (p: { steps: { kind: string }[] }, i) => { kinds.push(p.steps[i]!.kind); throw new Error('stop'); }, { sign: async () => new Uint8Array(), after: [{ kind: 'buy-cola', signature: BUY, ...receipt }] }, ['createFeed', 'planFeed']);
  return [kinds[0] ?? r.error?.code, r.signatures.map((s) => s.signature)];
}
for (const [v, parsed] of [[1, false], ['legacy', false], [0, false], [1, true], ['legacy', true]] as const)
  assert.deepEqual(await first(tx(JUP, v, parsed)), ['create+price', [BUY]], `B10 a landed buy is reused (version ${v}, ${parsed ? 'jsonParsed' : 'json'})`);
assert.deepEqual(await first(tx(MEMO)), ['buy-cola', []], 'not a purchase: it still buys');
assert.deepEqual(await first({ ...tx(JUP), transaction: { message: { accountKeys: ['x'] } } }), ['PENDING', [BUY]], 'an unreadable shape: PENDING, never "not ours"');
assert.deepEqual(await first(null), ['PENDING', [BUY]], 'L2 status known, transaction null: PENDING, no buy');
assert.deepEqual(await first(null, null, 8), ['PENDING', [BUY]], 'L3 null below the fence: PENDING, no buy');
assert.deepEqual(await first(null, null, 9), ['PENDING', [BUY]], 'null at the fence, no blockhash expiry known: PENDING, no buy');
assert.deepEqual(await first(null, null, 9, { lastValidBlockHeight: '500' }), ['PENDING', [BUY]], 'B5 null at the fence, blockhash still valid: PENDING, no buy');
assert.deepEqual(await first(null, null, 9, { lastValidBlockHeight: '8', sentSlot: '5' }, 5), ['buy-cola', []], 'null at the fence, expired, the ledger covers the send: it buys');
assert.deepEqual(await first(null, null, 9, { lastValidBlockHeight: '8', sentSlot: '5' }, 6), ['PENDING', [BUY]], 'B9 Y4 the node dropped the send slot: PENDING, no buy');
assert.deepEqual(await first(null, null, 9, { lastValidBlockHeight: '200' }, 51), ['PENDING', [BUY]], 'B9 no sentSlot: the blockhash height (50) bounds it, a ledger from 51 is PENDING');
assert.deepEqual(await first(null, null, 9, { lastValidBlockHeight: '200' }, 50), ['buy-cola', []], 'no sentSlot, a full-history ledger: it buys');
assert.deepEqual(await first(null, null, 9, { slot: '7', lastValidBlockHeight: '8', sentSlot: '5' }, 0), ['PENDING', [BUY]], 'B9 Y1/Y3 a verified buy absent from the node: PENDING, no buy');
for (const reply of [{ error: { code: -32005, message: 'behind' } }, null]) {
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => { if (!reply) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(init.body).id, ...reply }), { headers: { 'content-type': 'application/json' } }); }) as never;
  const plan = { feed: payer, args: { payer, rpc: 'http://127.0.0.1:1' }, steps: [{ kind: 'buy-cola', costLamports: 1n }] } as never;
  const r = await runPlan(plan, async () => { throw new Error('planned a buy'); }, { sign: async () => new Uint8Array(), after: [{ kind: 'buy-cola', signature: BUY }] }, ['createFeed', 'planFeed']);
  assert.deepEqual([r.state, r.error?.code, r.error?.retry, r.signatures.map((s) => s.signature)], ['pending', 'PENDING', 'later', [BUY]], 'IP2/IP4 read error: PENDING later, the buy kept');
}
// S2: an error raised before any step on a resume call keeps its `after`.
const { typed } = await import('../../src/create/facade.js');
const pre = (() => { try { typed(new Error('fetch failed'), [{ kind: 'buy-cola', signature: BUY, lastValidBlockHeight: '9' }]); } catch (e) { return e as { code: string; signatures?: unknown }; } })()!;
assert.deepEqual([pre.code, pre.signatures], ['RPC', [{ slot: '0', kind: 'buy-cola', signature: BUY, lastValidBlockHeight: '9' }]], 'a pre-plan error keeps after');
console.log('create resume after: ok');
