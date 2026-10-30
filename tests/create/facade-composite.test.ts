// The composite facade: plan shape and costs, a stable review hash, the 429-proof wait, and components refused before any purchase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { getAddressEncoder } from '@solana/kit';
import * as V1Create from '../../src/create/v1-create.js';
import { MimirBetaCollateralRequiredError } from '../../src/beta/errors.js';
import * as K from '../../src/v1/layout/classic.js';

const payer = '6Ba7yenKXHuauCn451XN8UotWgKtZyvxPMFwcPZza2Kz', composite = 'Bb4vQ7vh6ftkZqHpZ7zFNu3eDeGHQzVdcBbSxLfzNJ2E';
const feeds: Record<string, string> = { AAA: 'So11111111111111111111111111111111111111112', BBB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' };
let journeys = 0, outcome: () => unknown;
mock.module(new URL('../../src/create/v1-create.ts', import.meta.url).href, { namedExports: { ...V1Create,
  prepareV1CompositeFeedJourney: async () => { journeys++; return outcome(); }, observeV1Operation: async () => undefined } });
mock.module(new URL('../../src/easy/refresh.ts', import.meta.url).href, { namedExports: { refreshInstructions: async () => ({ instructions: [{ programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', accounts: [], data: Uint8Array.of(1) }] }) } });
const Price = await import('../../src/easy/price.js');
let priced = false;
mock.module(new URL('../../src/easy/price.ts', import.meta.url).href, { namedExports: { ...Price,
  decodePrice: async (a: never, o: never) => priced ? { feed: composite, ticker: 'MYIDX', status: 'fresh' } : Price.decodePrice(a, o) } });
const Review = await import('../../src/beta/review.js');
mock.module(new URL('../../src/beta/review.ts', import.meta.url).href, { namedExports: { ...Review, createMimirBetaStageReceipt: () => ({}) } });
const { planComposite, prepareComposite, createComposite, keyPairSigner } = await import('../../src/create/facade.js');
const { findMimirV1TickerClaimPda } = await import('../../src/v1/build.js');
const program = 'hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR' as never, enc = getAddressEncoder();

const classic = (address: string, id: number) => { const b = new Uint8Array(readFileSync('tests/fixtures/layout_v1/classic/reference_usdc_cpmm_m0.bin'));
  b.set(enc.encode(address as never), 48); b.fill(id, K.OFFSET_FEED_ID, K.OFFSET_FEED_ID + 32); return b; };
const claimOf = (feed: string) => { const b = new Uint8Array(43); b.set(new TextEncoder().encode('MIMIRTIK')); b.set([1, 2, 255], 8); b.set(enc.encode(feed as never), 11); return b; };
const claims = new Map<string, Uint8Array>();
for (const [t, f] of Object.entries(feeds)) claims.set((await findMimirV1TickerClaimPda(program, t))[0], claimOf(f));
const accounts = new Map<string, Uint8Array>([...claims, [feeds.AAA!, classic(feeds.AAA!, 1)], [feeds.BBB!, classic(feeds.BBB!, 2)]]);
const wire = (data?: Uint8Array) => data ? { owner: program, executable: false, lamports: 1, rentEpoch: 0, space: data.length, data: [Buffer.from(data).toString('base64'), 'base64'] } : null;
const fetched = globalThis.fetch;
const reads = (async (_u: unknown, init: { body: string }) => { const { id, method, params } = JSON.parse(init.body);
  const value = method === 'getFeeForMessage' ? 5000 : method === 'getMultipleAccounts' ? params[0].map((a: string) => wire(accounts.get(a))) : wire(accounts.get(params[0]));
  return Response.json({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value } }); }) as never;
globalThis.fetch = reads;
const args = { payer, ticker: 'MYIDX', quote: 'USDC' as const, rpc: 'http://127.0.0.1:1/?key=SECRET', components: [{ feed: 'AAA', quantity: '1' }, { feed: 'BBB', quantity: '0.5' }] };

// Invalid components are refused before the journey (so before any purchase).
for (const [bad, code] of [[[{ feed: 'AAA', quantity: '0' }, { feed: 'BBB', quantity: '1' }], 'INVALID_INPUT'], [[], 'INVALID_INPUT'], [[{ feed: 'AAA', quantity: '1' }], 'INVALID_INPUT'], [Array(6).fill({ feed: 'AAA', quantity: '1' }), 'INVALID_INPUT'],
  [[{ feed: 'NOPE', quantity: '1' }, { feed: 'BBB', quantity: '1' }], 'NOT_FOUND'], [[{ feed: composite, quantity: '1' }, { feed: 'BBB', quantity: '1' }], 'INVALID_INPUT'], [[{ feed: 'AAA', quantity: '1' }, { feed: 'AAA', quantity: '2' }], 'INVALID_INPUT']] as const) {
  await assert.rejects(planComposite({ ...args, components: bad as never }), (e: { code?: string }) => e.code === code, JSON.stringify(bad));
}
assert.equal(journeys, 0);

// A rate-limited RPC is retried, then surfaces as MimirError RPC "later", never a raw SolanaError.
let hits = 0;
globalThis.fetch = (async () => { hits++; return new Response('busy', { status: 429, headers: { 'retry-after': '0' } }); }) as never;
await assert.rejects(planComposite(args), (e: { code?: string; retry?: string; name?: string }) => e.code === 'RPC' && e.retry === 'later');
assert.equal(hits, 3);
globalThis.fetch = reads;
assert.equal((await planComposite({ ...args, ticker: 'x-y' }).catch((e) => e)).hint.startsWith('Fix this input: ticker'), true);

// Plan shape and costs: buy-cola, then CREATE_COMPOSITE + first price carrying the activation fee; the plan holds no RPC URL.
const fundingCosts = { observedSlot: 1n, identityLamports: 0n, accountRentLamports: 20_000_000n, networkFeeLamports: 10_000n, protocolFeeLamports: 3_200_000n, totalLamports: 23_210_000n };
outcome = () => { throw new MimirBetaCollateralRequiredError({ authority: payer, mint: 'CoLAyH8CRuBLyr2BRDozka3dJ5XH97BSa6WpZL9NAqWL', tokenAccount: payer, decimals: 6,
  requiredAmountRaw: 4_000_000_000n, balanceRaw: 0n, shortfallRaw: 1n, accountMissing: false, draftHash: 'd', fundingCosts, compositeJourney: { root: { feed: composite, feedId: payer } } } as never); };
const plan = await planComposite(args);
assert.deepEqual([plan.kind, plan.feed, plan.feedId, plan.steps.map((s) => s.kind), plan.prompts, plan.activationFeeLamports, plan.components.map((c) => c.quantityX64)],
  ['composite', composite, payer, ['buy-cola', 'create+price'], 2, 3_200_000n, [1n << 64n, 1n << 63n]]);
assert.ok(plan.steps[1]!.costLamports > fundingCosts.totalLamports && plan.totalLamports === plan.steps[0]!.costLamports + plan.steps[1]!.costLamports);
assert.deepEqual([plan.tariffColaRaw, plan.tariffCola], [4_000_000_000n, '4000']);
assert.doesNotMatch(JSON.stringify(plan, (_k, v) => typeof v === 'bigint' ? String(v) : v), /SECRET|127\.0\.0\.1/);
// Tickers are case-insensitive: the plan's ticker and component tickers come back upper-cased.
const lower = await planComposite({ ...args, ticker: 'myidx', components: [{ feed: 'aaa', quantity: '1' }, { feed: 'bbb', quantity: '0.5' }] });
assert.deepEqual([lower.args.ticker, lower.args.components.map((c) => c.feed), lower.feed], ['MYIDX', ['AAA', 'BBB'], composite]);
console.log('composite plan: ok');

// The CREATE step: its review hash is the journey's, stable across rebuilds; another composite is PLAN_STALE.
const { createKeyPairFromPrivateKeyBytes } = await import('@solana/keys');
const { compileMimirBetaTransactionV1 } = await import('../../src/beta/transactionV1.js');
const pair = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(3)), signer = await (await import('@solana/kit')).getAddressFromPublicKey(pair.publicKey);
const transaction = await compileMimirBetaTransactionV1({ feePayer: signer, recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: 9n,
  instructions: [{ programAddress: feeds.AAA as never, accounts: [{ address: signer, isSigner: true, isWritable: true }], data: Uint8Array.of(1) }] });
const step = { transaction, reviewHash: 'h1', review: { firstPrice: { instructionCount: 1 }, expectedWrites: [], simulation: { contextSlot: 1n, unitsConsumed: 1n } } };
let root = composite;
outcome = () => ({ root: { feed: root, feedId: payer }, next: { operationId: 'root', preparedStep: step } });
const createOnly = { ...plan, steps: [plan.steps[1]!] };
const [a, b] = [await prepareComposite(createOnly, 0), await prepareComposite(createOnly, 0)];
assert.deepEqual([a.kind, a.review.reviewHash, b.review.reviewHash, a.review.firstPrice], ['create+price', 'h1', 'h1', true]);
assert.deepEqual([a.review.networkFeeLamports, a.review.debitLamports], [5_000n + transaction.config.priorityFeeLamports!, 5_000n + transaction.config.priorityFeeLamports!]);
root = payer;
await assert.rejects(prepareComposite(createOnly, 0), (e: { code?: string }) => e.code === 'PLAN_STALE');
root = composite;
// One fee quote per review, at or after the reviewed simulation slot; a quote from an older bank is refused as retryable.
{
  let feeCalls = 0, feeSlot = 1;
  const configs: { minContextSlot?: number }[] = [];
  globalThis.fetch = (async (u: unknown, init: { body: string }) => { const { id, method, params } = JSON.parse(init.body);
    if (method !== 'getFeeForMessage') return (reads as typeof fetch)(u as never, init as never);
    configs.push(params[1]);
    return Response.json({ jsonrpc: '2.0', id, result: { context: { slot: feeSlot }, value: feeCalls++ ? 8000 : 5000 } }); }) as never;
  const once = await prepareComposite(createOnly, 0);
  assert.deepEqual([feeCalls, once.review.debitLamports === once.review.networkFeeLamports, Number(configs[0]!.minContextSlot)], [1, true, 1]);
  feeSlot = 0;
  await assert.rejects(prepareComposite(createOnly, 0), (e: { code?: string; retry?: string }) => e.code === 'RPC' && e.retry === 'later');
  globalThis.fetch = reads;
}
console.log('composite review hash: ok');

// A 429 burst after send still resolves the step; no RPC is refused before anything is signed.
let limited = 0;
globalThis.fetch = (async (u: unknown, init: { body: string }) => {
  const { id, method } = JSON.parse(init.body);
  if (method === 'sendTransaction') return Response.json({ jsonrpc: '2.0', id, result: '1'.repeat(64) });
  if (method === 'getSignatureStatuses' && limited++ < 3) return new Response('busy', { status: 429, headers: { 'retry-after': '1' } });
  if (method === 'getSignatureStatuses') return Response.json({ jsonrpc: '2.0', id, result: { context: { slot: 9 }, value: [{ slot: 9, err: null, confirmationStatus: 'finalized', confirmations: null }] } });
  if (method === 'getBlockHeight') return new Response('busy', { status: 429 });
  return (reads as typeof fetch)(u as never, init as never);
}) as never;
const events: string[] = [];
const landed = await createComposite({ ...createOnly, args: { ...createOnly.args, payer: signer } }, { sign: await keyPairSigner(pair), rpc: 'http://127.0.0.1:1', onStep: (e) => events.push(e.state) });
assert.ok(limited > 3);
assert.deepEqual([events, landed.signatures.length, landed.state === 'pending'], [['prepared', 'signed', 'sent', 'finalized'], 1, false]);
globalThis.fetch = fetched;
const noRpc = await createComposite({ ...createOnly, args: { ...createOnly.args } }, { sign: await keyPairSigner(pair) });
assert.equal(noRpc.error?.code, 'INVALID_INPUT');
console.log('composite 429 wait: ok');

// A composite CREATE without the fused first price: create, then the first-price step from its own builder, then ready.
outcome = () => ({ root: { feed: composite, feedId: payer }, next: { operationId: 'root', preparedStep: { ...step, review: { ...step.review, firstPrice: null } } } });
globalThis.fetch = (async (u: unknown, init: { body: string }) => {
  const { id, method } = JSON.parse(init.body), ok = (result: unknown) => Response.json({ jsonrpc: '2.0', id, result });
  if (method === 'getLatestBlockhash') return ok({ context: { slot: 9 }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 99 } });
  if (method === 'simulateTransaction') return ok({ context: { slot: 9 }, value: { err: null, unitsConsumed: 1000, logs: [] } });
  if (method === 'sendTransaction') return ok('1'.repeat(64));
  if (method === 'getSignatureStatuses') return ok({ context: { slot: 9 }, value: [{ slot: 9, err: null, confirmationStatus: 'finalized', confirmations: null }] });
  if (method === 'getBlockHeight') return ok(1);
  if (method === 'getFeeForMessage') return ok({ context: { slot: 9 }, value: 5000 });
  if (method === 'getAccountInfo' && JSON.parse(init.body).params[0] === composite) return ok({ context: { slot: 9 }, value: wire(new Uint8Array(8)) });
  return (reads as typeof fetch)(u as never, init as never);
}) as never;
priced = true;
const split = await Promise.race([createComposite({ ...createOnly, args: { ...createOnly.args, payer: signer } }, { sign: await keyPairSigner(pair), rpc: 'http://127.0.0.1:1' }),
  new Promise<never>((_, no) => setTimeout(() => no(new Error('createComposite did not finish in 10 s')), 10_000).unref())]);
assert.deepEqual([split.state, split.signatures.map((x) => x.kind)], ['ready', ['create', 'first-price']], String(split.error?.message));
globalThis.fetch = fetched;
console.log('composite create then first-price: ok');
