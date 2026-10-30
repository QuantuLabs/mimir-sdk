// The facade's plan binding: a CREATE rebuilt for another variant than the planned feed is PLAN_STALE before any prompt.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import * as Discovery from '../../src/create/discovery.js';
import * as V1Create from '../../src/create/v1-create.js';
const payer = '6Ba7yenKXHuauCn451XN8UotWgKtZyvxPMFwcPZza2Kz', other = 'So11111111111111111111111111111111111111112';
const built = { plan: { feedId: payer, feed: payer }, next: {} };
const eligible = async () => [{ pool: other, family: 'raydium-clmm', creation: { adapterType: 1, adapterVersion: 0 } }];
mock.module(new URL('../../src/create/discovery.ts', import.meta.url).href, { namedExports: { ...Discovery, resolveEligiblePools: eligible, resolveEligiblePoolsSplit: eligible } });
mock.module(new URL('../../src/create/v1-create.ts', import.meta.url).href, { namedExports: { ...V1Create, prepareV1SimpleFeed: async () => built, observeV1Operation: async () => undefined } });
const Review = await import('../../src/beta/review.js');
mock.module(new URL('../../src/beta/review.ts', import.meta.url).href, { namedExports: { ...Review, createMimirBetaStageReceipt: () => ({}) } });
const { prepareStep } = await import('../../src/create/facade.js');
const plan = { kind: 'feed', args: { payer, ticker: 'ABC', baseMint: other, quote: 'USDC', pools: [other], recipe: ['native-bounded'], rpc: 'http://127.0.0.1:1' },
  feed: payer, feedId: other, ticker: 'ABC', pools: [], steps: [{ kind: 'create+price', costLamports: 0n }], prompts: 1, totalLamports: 0n, warnings: [] } as never;
await assert.rejects(prepareStep(plan, 0), (e: { code?: string }) => e.code === 'PLAN_STALE');
console.log('create facade plan: ok');

// Blocker 7: createFeed runs without the Node Buffer global (browser): it reaches the RPC instead of failing at the wire encoding.
const { createKeyPairFromPrivateKeyBytes } = await import('@solana/keys');
const { compileMimirBetaTransactionV1 } = await import('../../src/beta/transactionV1.js');
const { createFeed, keyPairSigner } = await import('../../src/create/facade.js');
const pair = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(3)), signer = (await import('@solana/kit')).getAddressFromPublicKey(pair.publicKey);
const transaction = await compileMimirBetaTransactionV1({ feePayer: await signer, recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: 9n,
  instructions: [{ programAddress: other as never, accounts: [{ address: await signer, isSigner: true, isWritable: true }], data: Uint8Array.of(1) }] });
Object.assign(built, { plan: { feedId: other, feed: payer }, next: { transaction, reviewHash: 'h', review: { firstPrice: { instructionCount: 1 }, expectedWrites: [], simulation: { contextSlot: 1n, unitsConsumed: 1n } } } });
const saved = globalThis.Buffer, fetched = globalThis.fetch; delete (globalThis as { Buffer?: unknown }).Buffer;
globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
  const body = JSON.parse(init.body);
  if (body.method !== 'getFeeForMessage') throw new Error('offline');
  const text = JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { context: { slot: 1 }, value: 5000 } });
  return { ok: true, status: 200, headers: new Headers(), text: async () => text, json: async () => JSON.parse(text) };
}) as unknown as typeof fetch;
const receipt = await createFeed({ ...(plan as object), args: { ...(plan as { args: object }).args, payer: await signer } } as never, { sign: await keyPairSigner(pair) })
  .finally(() => { globalThis.Buffer = saved; globalThis.fetch = fetched; });
assert.equal(receipt.state, 'pending');
assert.match(String((receipt.error?.cause as Error)?.message ?? receipt.error?.message), /offline|outcome unknown/);
console.log('create facade browser globals: ok');

// Blocker 9: the payer's own claimed feed without a price resumes as [first-price]; anyone else's claim stays TICKER_TAKEN.
const { readFileSync } = await import('node:fs');
const C = await import('../../src/v1/layout/common.js'), K = await import('../../src/v1/layout/classic.js');
const { getAddressEncoder } = await import('@solana/kit');
const { prepareFeed } = await import('../../src/create/facade.js');
const mine = 'Bb4vQ7vh6ftkZqHpZ7zFNu3eDeGHQzVdcBbSxLfzNJ2E', enc = getAddressEncoder();
const unpriced = (creator: string) => { const b = new Uint8Array(readFileSync('tests/fixtures/layout_v1/classic/reference_usdc_cpmm_m0.bin'));
  b.set(enc.encode(mine as never), 48); b.set(enc.encode(creator as never), K.CLASSIC_OWNER + C.OWNER_CLASSIC_CREATOR); b.fill(0, K.CLASSIC_PROOF, K.CLASSIC_PROOF + K.PROOF_LEN); return b; };
const claimBytes = new Uint8Array(43); claimBytes.set(new TextEncoder().encode('MIMIRTIK')); claimBytes.set([1, 2, 255], 8); claimBytes.set(enc.encode(mine as never), 11);
const account = (data: Uint8Array) => ({ owner: 'hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR', executable: false, lamports: 1, rentEpoch: 0, space: data.length, data: [Buffer.from(data).toString('base64'), 'base64'] });
const resume = async (creator: string) => {
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => { const { id, params } = JSON.parse(init.body);
    return Response.json({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: account(params[0] === mine ? unpriced(creator) : claimBytes) } }); }) as never;
  return prepareFeed({ payer, ticker: 'ABC', baseMint: other, quote: 'USDC', pools: [other], recipe: 'native-bounded', rpc: 'http://127.0.0.1:1' }).finally(() => { globalThis.fetch = fetched; });
};
const resumed = await resume(payer);
assert.deepEqual([resumed.feed, resumed.steps.map((s) => s.kind)], [mine, ['first-price']]);
await assert.rejects(resume(other), (e: { code?: string }) => e.code === 'TICKER_TAKEN');
console.log('create facade resume: ok');

// The base mint (So11…, an SPL mint) and its pool (the same address here): both hold the mint's key.
const mintRead = (body: string) => { const { id, params } = JSON.parse(body), d = new Uint8Array(82); d.set(enc.encode(other as never));
  return Response.json({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: params[0].map(() => ({ ...account(d), owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' })) } }); };

// Blocker 10: a creation that burns no COLA (one-character ticker, tariff 0) plans CREATE alone, no purchase and no refusal.
globalThis.fetch = (async (_u: unknown, init: { body: string }) => JSON.parse(init.body).method === 'getMultipleAccounts' ? mintRead(init.body)
  : Response.json({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: { context: { slot: 1 }, value: JSON.parse(init.body).method === 'getFeeForMessage' ? 5000 : null } })) as never;
const oneChar = await prepareFeed({ payer, ticker: 'a', baseMint: other, quote: 'USDC', pools: [other], recipe: 'native-bounded', rpc: 'http://127.0.0.1:1' })
  .finally(() => { globalThis.fetch = fetched; });
assert.deepEqual([oneChar.ticker, oneChar.feed, oneChar.feedId, oneChar.steps.map((s) => s.kind), oneChar.tariffColaRaw, oneChar.tariffCola], ['A', built.plan.feed, built.plan.feedId, ['create+price'], 0n, '0']);
console.log('create facade one-char: ok');

// The post-send wait rides out a 429 burst (Retry-After honoured) and still finalizes; the plan carries no RPC URL.
globalThis.fetch = (async (_u: unknown, init: { body: string }) => JSON.parse(init.body).method === 'getMultipleAccounts' ? mintRead(init.body)
  : Response.json({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: { context: { slot: 1 }, value: JSON.parse(init.body).method === 'getFeeForMessage' ? 5000 : null } })) as never;
const planned = await prepareFeed({ payer, ticker: 'A', baseMint: other, quote: 'USDC', pools: [other], recipe: 'native-bounded', rpc: 'http://127.0.0.1:1/?key=SECRET' })
  .finally(() => { globalThis.fetch = fetched; });
assert.doesNotMatch(JSON.stringify(planned, (_k, v) => typeof v === 'bigint' ? String(v) : v), /SECRET|127\.0\.0\.1/);
let limited = 0;
globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
  const { id, method } = JSON.parse(init.body);
  if (method === 'sendTransaction') return Response.json({ jsonrpc: '2.0', id, result: '1'.repeat(64) });
  if (method === 'getSignatureStatuses' && limited++ < 3) return new Response('busy', { status: 429, headers: { 'retry-after': '1' } });
  if (method === 'getSignatureStatuses') return Response.json({ jsonrpc: '2.0', id, result: { context: { slot: 9 }, value: [{ slot: 9, err: null, confirmationStatus: 'finalized', confirmations: null }] } });
  if (method === 'getBlockHeight') return new Response('busy', { status: 429 });
  return Response.json({ jsonrpc: '2.0', id, result: { context: { slot: 9 }, value: method === 'getFeeForMessage' ? 5000 : null } });
}) as never;
const events: string[] = [];
const landed = await createFeed({ ...planned, args: { ...planned.args, payer: await signer } }, { sign: await keyPairSigner(pair), rpc: 'http://127.0.0.1:1', onStep: (e) => events.push(e.state) })
  .finally(() => { globalThis.fetch = fetched; });
assert.ok(limited > 3);
assert.deepEqual([events.at(-1), landed.signatures.length, landed.state === 'pending'], ['finalized', 1, false]);
const noRpc = await createFeed({ ...planned, args: { ...planned.args } }, { sign: await keyPairSigner(pair) });
assert.equal(noRpc.error?.code, 'INVALID_INPUT');
console.log('create facade 429 wait + rpc out of plan: ok');

// No candidate from the pool API (a mock answering an empty list) is NO_POOL for the pair, not UNKNOWN.
const before = globalThis.fetch;
globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => init?.body && JSON.parse(init.body).method === 'getMultipleAccounts' ? mintRead(init.body) : new Response(JSON.stringify(init?.body ? { jsonrpc: '2.0', id: JSON.parse(init.body).id, result: { context: { slot: 1 }, value: null } } : { v: 1, items: [] }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
await assert.rejects(prepareFeed({ payer, ticker: 'ABC', baseMint: other, quote: 'USDC', rpc: 'http://127.0.0.1:1', api: 'http://mock.test' } as never),
  (e: { code?: string; message?: string }) => e.code === 'NO_POOL' && e.message === `no eligible pool for ${other}/USDC`).finally(() => { globalThis.fetch = before; });
console.log('create facade no candidates: ok');

// The base mint is typed before pool resolution, pools given or not: a bad string, a non-mint, a pool of another mint.
const mintCase = (baseMint: string, accounts: (unknown | null)[]) => {
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => { const { id, method } = JSON.parse(init.body);
    return Response.json({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: method === 'getMultipleAccounts' ? accounts : null } }); }) as never;
  return prepareFeed({ payer, ticker: 'ABC', baseMint, quote: 'USDC', pools: [other], rpc: 'http://127.0.0.1:1' }).then(() => 'ok', (e) => e.code).finally(() => { globalThis.fetch = before; });
};
const wallet = { ...account(new Uint8Array(0)), owner: '11111111111111111111111111111111' }, mintOnly = { ...account(new Uint8Array(82)), owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' };
assert.deepEqual([await mintCase('not-a-mint', []), await mintCase(payer, [wallet, mintOnly]), await mintCase(other, [mintOnly, mintOnly])], ['INVALID_INPUT', 'NOT_FOUND', 'NOT_FOUND']);
console.log('create facade mint typed before pools: ok');
