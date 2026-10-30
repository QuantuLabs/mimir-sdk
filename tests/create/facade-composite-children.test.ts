// Index components resolve to one-row classics: a multi-row ticker falls back to the token's one-row feed (composite quote, then SOL),
// a mint resolves the same way, an explicit multi-row feed is COMPOSITE_CHILD_MULTI_ROW before any write.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { getAddressEncoder, type Address } from '@solana/kit';
import * as V1Create from '../../src/create/v1-create.js';
import * as Decoders from '../../src/v1/decoders.js';
import * as K from '../../src/v1/layout/classic.js';
import { MimirBetaCollateralRequiredError } from '../../src/beta/errors.js';

const payer = '6Ba7yenKXHuauCn451XN8UotWgKtZyvxPMFwcPZza2Kz', composite = 'Bb4vQ7vh6ftkZqHpZ7zFNu3eDeGHQzVdcBbSxLfzNJ2E';
const SOL = 'So11111111111111111111111111111111111111112', CBBTC = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LONE = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const shape = new Map<string, { n: number; base: string }>();
let journeys = 0;
mock.module(new URL('../../src/v1/decoders.ts', import.meta.url).href, { namedExports: { ...Decoders, decodeV1ClassicFeed: (data: Uint8Array, address: Address) => {
  const v1 = Decoders.decodeV1ClassicFeed(data, address), s = shape.get(address);
  if (!s) return v1;
  const image = new Uint8Array(v1.definition.feedImage); image.set(getAddressEncoder().encode(s.base as Address), K.CFG_OFFSET_BASE_MINT);
  return { ...v1, header: { ...v1.header, n: s.n }, definition: { ...v1.definition, feedImage: image } };
} } });
mock.module(new URL('../../src/create/v1-create.ts', import.meta.url).href, { namedExports: { ...V1Create,
  prepareV1CompositeFeedJourney: async () => { journeys++; throw new MimirBetaCollateralRequiredError({ authority: payer, mint: 'CoLAyH8CRuBLyr2BRDozka3dJ5XH97BSa6WpZL9NAqWL',
    tokenAccount: payer, decimals: 6, requiredAmountRaw: 1n, balanceRaw: 0n, shortfallRaw: 1n, accountMissing: false, draftHash: 'd',
    fundingCosts: { totalLamports: 1n, protocolFeeLamports: 0n }, compositeJourney: { root: { feed: composite, feedId: payer } } } as never); } } });
const { planComposite } = await import('../../src/create/facade.js');
const { deriveMimirV1ClassicFeedId, findMimirV1ClassicFeedPda, findMimirV1TickerClaimPda } = await import('../../src/v1/build.js');
const program = 'hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR' as never, enc = getAddressEncoder();

const classic = (address: string, id: number) => { const b = new Uint8Array(readFileSync('tests/fixtures/layout_v1/classic/reference_usdc_cpmm_m0.bin'));
  b.set(enc.encode(address as never), 48); b.fill(id, K.OFFSET_FEED_ID, K.OFFSET_FEED_ID + 32); return b; };
const claimOf = (feed: string) => { const b = new Uint8Array(43); b.set(new TextEncoder().encode('MIMIRTIK')); b.set([1, 2, 255], 8); b.set(enc.encode(feed as never), 11); return b; };
const variant = async (mint: string, quote: string, v: number) => (await findMimirV1ClassicFeedPda(program, await deriveMimirV1ClassicFeedId(mint as Address, quote as Address, v)))[0];
const accounts = new Map<string, Uint8Array>();
const put = (address: string, id: number, n: number, base: string) => { accounts.set(address, classic(address, id)); shape.set(address, { n, base }); };
// SOL: the ticker feed is « SOL Multi-venue » (n = 3, variant 0); its one-row classic is variant 2, USDC-quoted.
const solMulti = await variant(SOL, USDC, 0), solOne = await variant(SOL, USDC, 2);
put(solMulti, 1, 3, SOL); put(solOne, 2, 1, SOL);
// BTC: the ticker feed is n = 2; the only one-row classic is SOL-quoted (the converter carries it).
const btcMulti = await variant(CBBTC, USDC, 0), btcOne = await variant(CBBTC, SOL, 1);
put(btcMulti, 3, 2, CBBTC); put(btcOne, 4, 1, CBBTC);
// LONE: a token whose only feed is multi-row.
const loneMulti = await variant(LONE, USDC, 0); put(loneMulti, 5, 4, LONE);
for (const [t, f] of [['SOL', solMulti], ['BTC', btcMulti], ['LONE', loneMulti]]) accounts.set((await findMimirV1TickerClaimPda(program, t!))[0], claimOf(f!));
// An explicit multi-row feed id (its PDA holds an n = 3 classic).
const explicitId = 'GDLMMyfxmhaASE4pQw63yYqMqSxCQzZRmpanmUxgyLmm', explicitFeed = (await findMimirV1ClassicFeedPda(program, explicitId as Address))[0];
put(explicitFeed, 6, 3, SOL);

const wire = (data?: Uint8Array) => data ? { owner: program, executable: false, lamports: 1, rentEpoch: 0, space: data.length, data: [Buffer.from(data).toString('base64'), 'base64'] } : null;
const methods: string[] = [];
globalThis.fetch = (async (_u: unknown, init: { body: string }) => { const { id, method, params } = JSON.parse(init.body); methods.push(method);
  const value = method === 'getFeeForMessage' ? 5000 : method === 'getMultipleAccounts' ? params[0].map((a: string) => wire(accounts.get(a))) : wire(accounts.get(params[0]));
  return Response.json({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value } }); }) as never;
const args = { payer, ticker: 'MYIDX', quote: 'USDC' as const, rpc: 'http://127.0.0.1:1/', components: [{ feed: 'SOL', quantity: '1' }, { feed: 'BTC', quantity: '1' }] };

// By ticker: SOL and BTC pick their one-row classics (composite quote first, then SOL-quoted).
const plan = await planComposite(args);
assert.deepEqual(plan.components.map((c) => c.feed), [solOne, btcOne]);
// By mint: the same one-row classics.
assert.deepEqual((await planComposite({ ...args, components: [{ feed: SOL, quantity: '1' }, { feed: CBBTC, quantity: '1' }] })).components.map((c) => c.feed), [solOne, btcOne]);
// By feed account address: a one-row account is the component itself.
assert.deepEqual((await planComposite({ ...args, components: [{ feed: solOne, quantity: '1' }, { feed: 'BTC', quantity: '1' }] })).components.map((c) => c.feed), [solOne, btcOne]);
console.log('one-row component resolution: ok');

// An explicit multi-row feed id: COMPOSITE_CHILD_MULTI_ROW naming the feed, before the journey and any write.
const before = journeys; methods.length = 0;
await assert.rejects(planComposite({ ...args, components: [{ feed: explicitId, quantity: '1' }, { feed: 'BTC', quantity: '1' }] }),
  (e: { code?: string; message: string; hint: string }) => e.code === 'COMPOSITE_CHILD_MULTI_ROW' && e.message.includes(explicitFeed) && /createFeed/.test(e.hint));
assert.equal(journeys, before);
assert.ok(methods.every((m) => m === 'getMultipleAccounts' || m === 'getAccountInfo'), methods.join());
// An explicit multi-row feed account address: the same named refusal, before any write.
await assert.rejects(planComposite({ ...args, components: [{ feed: solMulti, quantity: '1' }, { feed: 'BTC', quantity: '1' }] }),
  (e: { code?: string; message: string }) => e.code === 'COMPOSITE_CHILD_MULTI_ROW' && e.message.includes(solMulti));
assert.equal(journeys, before);
// A token with no one-row classic: COMPOSITE_CHILD_MULTI_ROW (create its one-row feed with createFeed first), never INVALID_ARGUMENT.
await assert.rejects(planComposite({ ...args, components: [{ feed: 'LONE', quantity: '1' }, { feed: 'BTC', quantity: '1' }] }),
  (e: { code?: string; message: string }) => e.code === 'COMPOSITE_CHILD_MULTI_ROW' && e.message.includes(LONE));
assert.equal(journeys, before);
console.log('multi-row components refused: ok');
