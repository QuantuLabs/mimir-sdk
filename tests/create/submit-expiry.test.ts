// An expiry verdict needs a history read at or past the expiry fence: a lagging node or a 429 is unknown, never `expired`.
import assert from 'node:assert/strict';
const { facadeRpc, submit } = await import('../../src/create/facade.js');

let historyReads = 0;
type History = { slot: number; status: unknown } | 429 | 'error';
async function run(history: History[], heightErrors = 0, sent?: () => unknown) {
  const seen = [...history]; historyReads = 0;
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body);
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
    if (body.method === 'getBlockHeight') return heightErrors-- > 0 ? new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32016, message: 'Minimum context slot has not been reached' } }), { headers: { 'content-type': 'application/json' } }) : reply(1_000);
    if (body.method === 'getSlot') return reply(500);
    if (body.method !== 'getSignatureStatuses') return reply('sig');
    if (!body.params[1].searchTransactionHistory) return reply({ context: { slot: 600 }, value: [null] });
    historyReads++;
    const next = seen.length > 1 ? seen.shift()! : seen[0]!;
    if (next === 429) return new Response('busy', { status: 429, headers: { 'retry-after': '0' } });
    if (next === 'error') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32005, message: 'Node is behind' } }), { headers: { 'content-type': 'application/json' } });
    return reply({ context: { slot: next.slot }, value: [next.status] });
  }) as never;
  return (await submit(facadeRpc('http://127.0.0.1:1'), 'ws://127.0.0.1:1', new Uint8Array(100), '5'.repeat(88), 10n, undefined, 1_000, sent)).outcome;
}
const landed = { slot: 450, confirmations: null, err: null, confirmationStatus: 'finalized' };

assert.equal(await run([{ slot: 400, status: null }, { slot: 600, status: landed }]), 'confirmed', 'lagging history node');
assert.equal(await run([429, 429, 429, { slot: 600, status: landed }]), 'confirmed', 'history read rate-limited');
assert.equal(await run(['error', { slot: 600, status: landed }]), 'confirmed', 'A1 an error reply, then landed');
assert.equal(await run([{ slot: 400, status: null }, { slot: 400, status: null }, { slot: 600, status: landed }], 40), 'confirmed', 'A2 -32016 on the expiry read is waited out');
assert.equal(await run([{ slot: 600, status: null }]), 'expired', 'absent at the fence');
let hookAt = -1;
await assert.rejects(run([{ slot: 400, status: null }, { slot: 600, status: landed }], 0, () => { hookAt = historyReads; throw new Error('hook'); }), /hook/, 'B5 a sent-hook throw is rethrown');
assert.ok(hookAt === 0 && historyReads >= 2, 'B5 the wait still reaches the outcome after a sent-hook throw');
console.log('submit expiry fence: ok');
process.exit(0);
