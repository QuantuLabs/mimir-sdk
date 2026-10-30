// skipSend: 3 JSON-round-tripped POSTs → ready under the full-purchase rule (1 buy, then create+price); a lying `after` and a tampered `signed` are refused with 0 sends; a re-POST or a PENDING retry of the landed create+price answers ready; a non-fused create is sent, then first-price.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { WIF_MINT, USDC_MINT } from './fixtures.js';
import * as Facade from '../../src/create/facade.js';
import { compileMimirBetaTransactionV1 } from '../../src/beta/transactionV1.js';
import type { MimirError } from '../../src/easy/price.js';

const kp = Keypair.fromSeed(new Uint8Array(32).fill(9)), PAYER = kp.publicKey.toBase58(), FEED = 'Feed111111111111111111111111111111111111111';
const landed = new Map<string, number>(), wires = new Map<string, string>(), sends: string[] = [];
let ledgerFrom = 0n, readFails = false, created = false, unpriced = false, nonFused = false, pendingOnce: boolean | 'throw' | 'expired' = false;
mock.module(new URL('../../src/create/token.ts', import.meta.url).href, { namedExports: {
  resolveToken: async (mint: string) => ({ mint, symbol: 'WIF', verified: true, warnings: [] }), existingFeeds: async (mint: string) => (created || unpriced) && mint === WIF_MINT ? [{ feed: FEED, ticker: 'WIF', quote: 'USDC', creator: PAYER, priced: created }] : [], autoTicker: async () => 'WIF' } });
mock.module(new URL('../../src/create/candidates.ts', import.meta.url).href, { namedExports: { poolCandidates: async (_m: string, q: string) => q === 'USDC' ? [{ pool: 'P1' }] : [] } });
mock.module(new URL('../../src/create/discovery.ts', import.meta.url).href, { namedExports: { resolveEligiblePoolsSplit: async () => [{ pool: 'P1', quoteMint: USDC_MINT }] } });
mock.module(new URL('../../src/create/recommend.ts', import.meta.url).href, { namedExports: { recommend: (pools: unknown[]) => ({ pools, choices: {}, score: {} }) } });
mock.module(new URL('../../src/easy/refresh.ts', import.meta.url).href, { namedExports: { getPrice: async () => ({ feed: FEED, ticker: 'WIF', price: 0.75, quote: 'USDC', status: 'fresh', slot: 3n, generation: 1n }) } });
const tx = (memo: number) => compileMimirBetaTransactionV1({ feePayer: PAYER as never, recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: 99n,
  instructions: [{ programAddress: (memo === 3 ? 'Vote111111111111111111111111111111111111111' : memo === 1 ? 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' : 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') as never, accounts: [{ address: PAYER as never, isSigner: true, isWritable: true }], data: Uint8Array.of(memo) }] });
mock.module(new URL('../../src/create/facade.ts', import.meta.url).href, { namedExports: { ...Facade,
  createdAndPriced: async (_r: unknown, feed: string, payer: string) => created && feed === FEED && payer === PAYER,
  facadeRpc: () => ({ getSlot: () => ({ send: async () => 10 }), getBlockHeight: () => ({ send: async () => 200n }), getFirstAvailableBlock: () => ({ send: async () => ledgerFrom }), minimumLedgerSlot: () => ({ send: async () => 0n }), getSignatureStatuses: ([s]: string[]) => ({ send: async () => readFails ? Promise.reject(new Error('Node is behind')) : ({ context: { slot: 10 }, value: [landed.has(s) ? { slot: landed.get(s), err: null, confirmationStatus: 'finalized' } : null] }) }),
    getTransaction: (s: string) => ({ send: async () => { if (!wires.has(s)) return null; const f = await Facade.wireFacts(Buffer.from(wires.get(s)!, 'base64')); return { version: 'legacy', transaction: { message: { accountKeys: [f.signers[0], ...f.programs], instructions: f.programs.map((_, i) => ({ programIdIndex: i + 1 })) } } }; } }) }),
  submit: async (_r: unknown, _w: string, signed: Uint8Array, signature: string) => { sends.push(signature); landed.set(signature, 5); wires.set(signature, Buffer.from(signed).toString('base64'));
    if (sends.length > 1) { if (nonFused && sends.length === 2) unpriced = true; else created = true; }
    if (pendingOnce) { const t = pendingOnce; pendingOnce = false; if (t === 'throw') throw new Error('Node is behind'); if (t === 'expired') { landed.delete(signature); return { outcome: 'expired' }; } return { outcome: 'timeout' }; } return { outcome: 'confirmed', slot: 5n }; },
  prepareFeed: async (args: Facade.FeedArgs) => { const steps = unpriced && !created ? [{ kind: 'first-price', costLamports: 1n }] : [{ kind: 'buy-cola', costLamports: 1n }, { kind: 'create+price', costLamports: 2n }];
    return { kind: 'feed', args, feed: FEED, feedId: FEED, ticker: args.ticker, pools: [], steps, prompts: steps.length, totalLamports: 3n, warnings: [], tariffColaRaw: 0n, tariffCola: '0' }; },
  prepareStep: async (plan: Facade.FeedPlan, i: number) => ({ kind: nonFused && plan.steps[i]!.kind === 'create+price' ? 'create' : plan.steps[i]!.kind, index: i, transaction: await tx(plan.steps[i]!.kind === 'buy-cola' ? 1 : plan.steps[i]!.kind === 'first-price' ? 4 : 2),
    review: { debitLamports: 1_000_000n, networkFeeLamports: 5_000n, writes: [], firstPrice: plan.steps[i]!.kind !== 'buy-cola', reviewHash: 'h', simulation: {} } }) } });
const { Mimir } = await import('../../src/mimir.js');
const server = new Mimir({ rpc: 'http://127.0.0.1:1/?api-key=SEKRET' }), browser = new Mimir({ wallet: kp });
const post = async (body: object) => { const text = JSON.stringify(await server.createFeed(JSON.parse(JSON.stringify(body))));
  assert.ok(!/SEKRET|127\.0\.0\.1/.test(text), 'a ServerStep holds no RPC URL'); return JSON.parse(text); };

let r = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address });
assert.deepEqual([r.state, r.step.kind, r.step.index, r.step.of, r.after], ['sign', 'buy-cola', 1, 2, []]);
assert.equal(typeof r.step.transaction, 'string');
const first = r, signed1 = await browser.sign(r.step);
const tampered = Buffer.from(signed1, 'base64'); tampered[tampered.length - 70] ^= 1;
await assert.rejects(post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: first, signed: tampered.toString('base64') }), (e: MimirError) => e.code === 'REVIEW_CHANGED');
assert.equal(sends.length, 0, 'a tampered wire is never sent');
r = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: first, signed: signed1 });
assert.deepEqual([r.state, r.step.kind, r.step.index, r.step.of, r.after.map((a: { kind: string }) => a.kind)], ['sign', 'create+price', 2, 2, ['buy-cola']]);
const again = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: first, signed: signed1 });
assert.deepEqual([sends.length, again.step.kind], [1, 'create+price'], 'a re-POST of a landed buy-cola re-plans and is not sent again');
const lie = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: { ...r, after: [{ kind: 'buy-cola', signature: 'lie', slot: '1' }] } }).catch((e: MimirError) => e) as never as MimirError;
assert.deepEqual([lie.code, lie.retry, sends.length], ['PENDING', 'later', 1], 'B9 a verified buy-cola receipt absent from the node: PENDING, no new buy');
const gone = { kind: 'buy-cola', signature: 'gone', slot: '0', lastValidBlockHeight: '160' };
assert.deepEqual((await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, after: [gone] })).step.kind, 'buy-cola', 'an unverified buy absent, expired, on a ledger from slot 0: never landed, bought');
ledgerFrom = 11n;
const short = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, after: [gone] }).catch((e: MimirError) => e) as never as MimirError;
assert.deepEqual([short.code, short.retry, short.signatures, sends.length], ['PENDING', 'later', [gone], 1], 'B9 the node dropped the send window (ledger from 11 > 10): PENDING with the buy, no new buy');
ledgerFrom = 0n;
await assert.rejects(post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: { ...r, after: [{ kind: 'create+price', signature: 'lie', slot: '1' }] }, signed: await browser.sign(r.step) }),
  (e: MimirError) => e.code === 'INVALID_INPUT' && /not a finalized success/.test(e.message));
await assert.rejects(new Mimir({ wallet: Keypair.generate() }).sign(r.step), (e: MimirError) => e.code === 'INVALID_INPUT', 'another wallet cannot sign this step');
const foreign = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: { state: 'ready', feed: 'Other11111111111111111111111111111111111111', after: [{ kind: 'create+price', signature: sends[0], slot: '5' }] } });
assert.equal(foreign.state, 'sign', 'a finalized foreign signature labelled create+price does not give ready');
const evil = await tx(3), evilWire = Buffer.from(evil.serializedTransaction).toString('base64');
await assert.rejects(post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: { ...r, step: { ...r.step, transaction: evilWire } }, signed: evilWire }),
  (e: MimirError) => e.code === 'INVALID_INPUT' && /calls/.test(e.message));
const relabelled = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: { ...r, step: { ...first.step, kind: 'create+price', index: 2 } }, signed: signed1 });
assert.deepEqual([sends.length, relabelled.step.kind], [1, 'create+price'], 'a buy wire relabelled create+price is read from its programs and never bought twice');
const finalBody = { mint: WIF_MINT, skipSend: true, payer: browser.address, resume: r, signed: await browser.sign(r.step) };
pendingOnce = true;
await assert.rejects(post(finalBody), (e: MimirError) => e.code === 'PENDING');
r = await post(finalBody);
assert.deepEqual([r.state, r.ticker, r.feed, r.price.price, r.signatures.map((s: { kind: string }) => s.kind)], ['ready', 'WIF', FEED, 0.75, ['buy-cola', 'create+price']]);
assert.equal(sends.length, 2, 'exactly 1 buy-cola, then create+price');
const replay = await post(finalBody);
assert.deepEqual([replay.state, replay.signatures, sends.length], ['ready', r.signatures, 2], 'a re-POST of the landed create+price answers ready with the same signatures');
// S1: the payer's priced WIF feed is not `ready` for a request on another mint (an SPCX request pointing at it).
const SPCX = 'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4';
const spcx = JSON.parse(JSON.stringify(await server.createFeed({ mint: SPCX, skipSend: true, payer: PAYER, resume: { state: 'ready', feed: FEED, after: r.signatures } } as never)));
assert.equal(spcx.state, 'sign', 'ready is bound to the requested mint');
// R2: a non-fused create is sent, then first-price, then ready.
sends.length = 0; landed.clear(); wires.clear(); created = false; nonFused = true;
let n = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address });
const kinds: string[] = [];
while (n.state === 'sign' && kinds.length < 5) { kinds.push(n.step.kind); n = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: n, signed: await browser.sign(n.step) }); }
assert.deepEqual([kinds, n.state, sends.length], [['buy-cola', 'create', 'first-price'], 'ready', 3], 'a non-fused create is sent once, then first-price');
// R3: a buy-cola that ends PENDING returns its signature; once it lands, the re-POST with it in `after` goes to CREATE, never a second buy.
sends.length = 0; landed.clear(); wires.clear(); created = unpriced = nonFused = false;
const start = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address });
pendingOnce = true;
const pending = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: start, signed: await browser.sign(start.step) }).catch((e: MimirError) => e);
assert.deepEqual([(pending as MimirError).code, (pending as MimirError).signatures?.map((s) => [s.kind, s.signature])], ['PENDING', [['buy-cola', sends[0]]]], 'a PENDING buy returns its signature');
const resumed = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: { ...start, after: (pending as MimirError).signatures! } });
assert.deepEqual([resumed.step.kind, resumed.after.map((a: { kind: string }) => a.kind), sends.length], ['create+price', ['buy-cola'], 1], 'the landed buy is reused');
const done = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: resumed, signed: await browser.sign(resumed.step) });
assert.deepEqual([done.state, sends.length], ['ready', 2], 'one buy, then CREATE');
// R3 variant: the wait throws after the buy was sent -> PENDING with the JSON-safe signature, and the resume reuses it.
sends.length = 0; landed.clear(); wires.clear(); created = false;
const start2 = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address });
pendingOnce = 'throw';
const thrown = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: start2, signed: await browser.sign(start2.step) }).catch((e: MimirError) => e) as MimirError;
assert.deepEqual([thrown.code, thrown.retry, JSON.parse(JSON.stringify(thrown.signatures))], ['PENDING', 'later', [{ kind: 'buy-cola', signature: sends[0], slot: '0', lastValidBlockHeight: '99' }]], 'a thrown wait is PENDING with the buy');
const resumed2 = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: { ...start2, after: thrown.signatures! } });
assert.deepEqual([resumed2.step.kind, sends.length], ['create+price', 1], 'no second buy');
// B4 (SP2/SP3): the reuse check cannot read the chain -> PENDING later with the buy kept, never a new buy.
readFails = true;
const unread = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: { ...start2, after: thrown.signatures! } }).catch((e: MimirError) => e) as MimirError;
readFails = false;
assert.deepEqual([unread.code, unread.retry, unread.signatures?.map((s) => s.signature), sends.length], ['PENDING', 'later', [sends[0]], 1], 'an unreadable buy stays in the error');
// B6 (N14/N15): the hint's top-level `after` is honoured: no resume, or `resume` without `after`, never plans a second buy.
const top = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, after: thrown.signatures! });
assert.deepEqual([top.step.kind, top.after.map((a: { kind: string }) => a.kind), sends.length], ['create+price', ['buy-cola'], 1], 'top-level after reuses the buy');
const both = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: start2, after: thrown.signatures! });
assert.deepEqual([both.step.kind, both.after.length, sends.length], ['create+price', 1, 1], 'resume + top-level after reuses the buy once');
// B8 (X1/X2): a create+price that times out or expires after a landed buy carries only the verified buy; resuming with it re-plans create+price, never INVALID_INPUT, never a second buy.
for (const t of [true, 'expired'] as const) {
  pendingOnce = t;
  const e = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, resume: top, signed: await browser.sign(top.step) }).catch((x: MimirError) => x) as MimirError;
  assert.deepEqual([e.code, e.signatures?.map((s) => s.kind)], [t === true ? 'PENDING' : 'EXPIRED', ['buy-cola']], `a ${t} create+price keeps only the buy`);
  created = false; landed.delete(sends.at(-1)!); const bought = sends.filter((s) => s === sends[0]).length;
  for (const body of [{ resume: { ...top, after: e.signatures! } }, { after: e.signatures! }]) {
    const back = await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, ...body });
    assert.deepEqual([back.step.kind, back.after.map((a: { kind: string }) => a.kind), bought], ['create+price', ['buy-cola'], 1], 'the resume re-plans create+price with the buy reused');
  }
}
// S4: a malformed browser `after` is a MimirError, never a raw TypeError.
for (const after of ['abc', [null]]) await post({ mint: WIF_MINT, skipSend: true, payer: browser.address, after }).then(() => {}, (e: MimirError) => assert.ok(!(e instanceof TypeError) && typeof e.code === 'string', String(e)));
console.log('mimir server split: ok');
