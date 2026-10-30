// getSignatureStatuses always carries searchTransactionHistory: Agave 4.3.2 and the mainnet RPCs refuse an empty config.
import assert from 'node:assert/strict';
import { facadeRpc, submit } from '../../src/create/facade.js';

const bodies: { method: string; params: unknown[] }[] = [];
globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
  const body = JSON.parse(init.body); bodies.push(body);
  const result = body.method === 'getSignatureStatuses' ? { context: { slot: 9 }, value: [{ slot: 9, confirmations: null, err: null, confirmationStatus: 'finalized' }] }
    : body.method === 'getBlockHeight' ? 1 : 'sig';
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
}) as never;
const { outcome } = await submit(facadeRpc('http://127.0.0.1:1'), 'ws://127.0.0.1:1', new Uint8Array(100), '5'.repeat(88), 10n);
assert.equal(outcome, 'confirmed');
const calls = bodies.filter((b) => b.method === 'getSignatureStatuses');
assert.ok(calls.length > 0 && calls.every((b) => typeof (b.params[1] as { searchTransactionHistory?: unknown })?.searchTransactionHistory === 'boolean'), JSON.stringify(calls));
console.log('signature status params: ok');
process.exit(0);
