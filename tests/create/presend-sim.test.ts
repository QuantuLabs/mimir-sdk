// A signed step whose bytes no longer simulate (stale DLMM bin array -> ix 2 Custom 3) is refused PLAN_STALE and never sent.
import assert from 'node:assert/strict';
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey, type Address } from '@solana/kit';
const { runPlan, keyPairSigner } = await import('../../src/create/facade.js');
const { compileMimirBetaTransactionV1 } = await import('../../src/beta/transactionV1.js');
const pair = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(3)), payer = await getAddressFromPublicKey(pair.publicKey);
const transaction = await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: 9n,
  instructions: [{ programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as Address, accounts: [{ address: payer, isSigner: true, isWritable: true }], data: Uint8Array.of(1) }] });
async function run(err: unknown) {
  const methods: string[] = [];
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => { const b = JSON.parse(init.body); methods.push(b.method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: { context: { slot: 9 }, value: { err, logs: [] } } }), { headers: { 'content-type': 'application/json' } }); }) as never;
  const plan = { feed: payer, args: { payer, rpc: 'http://127.0.0.1:1' }, steps: [{ kind: 'create+price', costLamports: 1n }] } as never;
  const r = await runPlan(plan, async (_p, index) => ({ kind: 'create+price', index, transaction, review: {} as never }),
    { sign: await keyPairSigner(pair), onStep: (e) => { if (e.state === 'signed') throw new Error('admitted'); } }, ['createFeed', 'planFeed']);
  return [r.state, r.error?.code, methods.includes('simulateTransaction'), methods.includes('sendTransaction')];
}
assert.deepEqual(await run({ InstructionError: [2, { Custom: 3 }] }), ['failed', 'PLAN_STALE', true, false], 'ix-2 error after signing: refused, unsent');
assert.deepEqual(await run(null), ['failed', 'UNKNOWN', true, false], 'clean simulation: admitted to the send');
console.log('create pre-send simulation: ok');
