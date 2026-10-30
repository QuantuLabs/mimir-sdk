import { readFileSync, writeFileSync } from 'node:fs';
import { getAddressDecoder, getAddressEncoder, type Address } from '@solana/kit';
import { expect, it, vi } from './vitest.js';
import * as V1 from '../../src/v1/index.js';
import { decodeMimirBetaCaptureCandidate, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID } from '../../src/beta/capture.js';
import type { MimirBetaEligiblePool } from '../../src/beta/discovery.js';
import * as BetaReview from '../../src/beta/review.js';
const { createDraftHash } = BetaReview;
import { MimirBetaError as BetaError } from '../../src/beta/errors.js';
import { mock } from 'node:test';
import { prepareReview as tightReview } from '../../src/create/review.js';
import * as Definition from '../../src/v1/definition.js';
import * as Decoders from '../../src/v1/decoders.js';
import * as Reconciliation from '../../src/beta/reconciliation.js';
import { fixtureAddress, makeBetaCaptureFixture } from '../fixtures/betaCaptureFixtures.js';
import { withReadyNativeHistory } from '../fixtures/nativeReadyHistory.js';
import { SolCreationContext } from '../../src/create/creation-context.js';
import { USDC_QUOTE_MINT } from '../../src/create/helpers.js';
import { MEDIA_MEMO_PROGRAM } from '../../src/create/helpers.js';
import { firstPriceComposite, freshFirstPrice, slotSamples } from './first-price-sim.js';

const seen = { classic: [] as { recipes?: unknown; temporalMode?: unknown }[], composite: undefined as ((data: Uint8Array) => unknown) | undefined, rows: undefined as number | undefined };
let next = 1;
const rowVectors = async (rows: readonly { descriptor: { externalWidth: number } }[]) =>
  rows.map((r) => Array.from({ length: r.descriptor.externalWidth }, () => {
    const b = new Uint8Array(32); new DataView(b.buffer).setUint32(0, next++); b[31] = 9; return getAddressDecoder().decode(b); }));
/** The app spied on its `beta` module; here the moved code's review and receipt-chain imports delegate to this object. */
const review = { ...Reconciliation, ...BetaReview, prepareReview: tightReview };
type AnyFn = (...a: any[]) => any;
mock.module(new URL('../../src/beta/review.ts', import.meta.url).href, { namedExports: { ...BetaReview,
  authenticateMimirBetaReviewedStep: (...a: unknown[]) => (review.authenticateMimirBetaReviewedStep as AnyFn)(...a) } });
mock.module(new URL('../../src/create/review.ts', import.meta.url).href, { namedExports: { prepareReview: (...a: unknown[]) => (review.prepareReview as AnyFn)(...a) } });
mock.module(new URL('../../src/beta/reconciliation.ts', import.meta.url).href, { namedExports: { ...Reconciliation,
  observeMimirBetaReceiptChain: (...a: unknown[]) => (review.observeMimirBetaReceiptChain as AnyFn)(...a), observeMimirBetaReceipt: (...a: unknown[]) => (review.observeMimirBetaReceipt as AnyFn)(...a) } });
mock.module(new URL('../../src/v1/definition.ts', import.meta.url).href, { namedExports: { ...Definition, prepareMimirV1ClassicCreation: (...args: Parameters<typeof Definition.prepareMimirV1ClassicCreation>) => {
  seen.classic.push(args[1] as never); return Definition.prepareMimirV1ClassicCreation(...args); } } });
mock.module(new URL('../../src/v1/decoders.ts', import.meta.url).href, { namedExports: { ...Decoders,
  decodeV1CompositeFeed: (...args: Parameters<typeof Decoders.decodeV1CompositeFeed>) => seen.composite ? seen.composite(args[0]) as never : Decoders.decodeV1CompositeFeed(...args),
  decodeV1ClassicFeed: (...args: Parameters<typeof Decoders.decodeV1ClassicFeed>) => { const f = Decoders.decodeV1ClassicFeed(...args); return seen.rows ? { ...f, header: { ...f.header, n: seen.rows } } : f; } } });
const { draftV1Classic, draftV1Composite, prepareV1CompositeFeed, prepareV1CompositeFeedJourney, prepareV1SimpleFeed } = await import('../../src/create/v1-create.js');

const addr = (byte: number): Address => getAddressDecoder().decode(Uint8Array.from({ length: 32 }, () => byte));
const TOKEN = MIMIR_BETA_SPL_TOKEN_PROGRAM_ID as Address;
const programId = V1.MIMIR_V1_MAINNET_PROGRAM_ID as Address, payer = addr(50), cola = addr(51);
const policy = { profile: 0, riskTier: 1, priceExponent: -8, maxDispersionBps: 100, maxSourceActivityAgeSlots: 150, minCoverageRatioBps: 10_000,
  maxConfidenceBps: 500, maxSnapshotAgeSlots: 150, anchorPolicyHash: new Uint8Array(32).fill(7), nativeExceptionHash: new Uint8Array(32).fill(8) };
type Acc = { owner: Address; executable: boolean; data: Uint8Array };
const mint = (decimals: number): Acc => { const d = new Uint8Array(82); d[44] = decimals; d[45] = 1; return { owner: TOKEN, executable: false, data: d }; };

async function chain(store: Map<Address, Acc>) {
  const [admin] = await V1.findMimirV1AdminConfigPda(programId), [registry] = await V1.findMimirV1RegistryPda(programId);
  const a = new Uint8Array(192), av = new DataView(a.buffer);
  a.set(new TextEncoder().encode('MIMIRCFG')); av.setUint16(8, 1, true); av.setUint16(10, 192, true); a[12] = 1; a[13] = 255;
  a.fill(1, 16, 48); a.set(new Uint8Array(32).fill(51), 48); av.setBigUint64(80, 1_000n, true); a[88] = 1; a[89] = 3;
  a.set([150, 30, 5, 2], 116); a.fill(2, 120, 152); av.setBigUint64(152, 1n, true); a.fill(3, 160, 192);
  const r = new Uint8Array(128), rv = new DataView(r.buffer);
  r.set(new TextEncoder().encode('MIMIRREG')); rv.setUint16(10, 128, true); r.fill(4, 16, 48); rv.setBigUint64(96, 3n, true);
  store.set(admin, { owner: programId, executable: false, data: a }); store.set(registry, { owner: programId, executable: false, data: r });
  store.set(cola, mint(6));
  const info = (x: Address) => { const v = store.get(x); return v ? { owner: v.owner, executable: v.executable, lamports: 1n, rentEpoch: 0n,
    space: BigInt(v.data.length), data: [Buffer.from(v.data).toString('base64'), 'base64'] } : null; };
  const ctx = { context: { slot: 9n } };
  return { getSlot: () => ({ send: async () => 9n }), getRecentPerformanceSamples: slotSamples, simulateTransaction: freshFirstPrice, getAccountInfo: (x: Address) => ({ send: async () => ({ ...ctx, value: info(x) }) }),
    getMultipleAccounts: (xs: readonly Address[]) => ({ send: async () => ({ ...ctx, value: xs.map(info) }) }) };
}
const deps = (rpc: object) => ({ deployment: { mimirProgramId: programId, cluster: 'localnet', mplCoreProgramId: V1.MIMIR_V1_MPL_CORE_PROGRAM_ID }, rpc, rpcUrl: 'http://127.0.0.1:8899', rowVectors }) as never;

it('V1 Classic draft is the SDK CREATE_CLASSIC for a captured pool', async () => {
  const fixture = await makeBetaCaptureFixture('raydium-clmm', { seed: 11 });
  const c = await decodeMimirBetaCaptureCandidate(fixture.input);
  const pool = { eligibility: 'eligible', family: 'raydium-clmm', programId: c.programId, pool: c.pool, descriptorId: c.descriptorId,
    descriptorHash: c.descriptorHash, readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1,
    canonicalPairKey: c.canonicalPairKey, direction: 'quote-per-base', baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault,
    quoteVault: c.quoteVault, adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
    minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: 'a'.repeat(64), creation: fixture.creation } as MimirBetaEligiblePool;
  const store = new Map<Address, Acc>(fixture.fixtureAccounts.map((x) => [x.address, x]));
  if (!store.has(c.baseMint)) store.set(c.baseMint, mint(9));
  if (!store.has(c.quoteMint)) store.set(c.quoteMint, mint(6));
  const rpc = await chain(store);
  const d = await draftV1Classic(deps(rpc), { authority: payer, ticker: 'SOLX', baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool], policy } as never);
  const sdk = await V1.prepareMimirV1ClassicCreation(rpc as never, { programId, payer, ticker: 'SOLX', baseMint: c.baseMint, quoteMint: c.quoteMint,
    pools: [pool], policy: d.v1.policy, variant: 'new', cluster: 'localnet' });
  expect(d.core).toHaveLength(1);
  expect(d.core[0]!.data[0]).toBe(93);
  expect([...d.core[0]!.data]).toEqual([...sdk.plan.instructions[0]!.data]);
  expect(d.v1.definition.variant).toBe(1);
  expect(d.v1.feed).toBe((await V1.findMimirV1ClassicFeedPda(programId, d.v1.feedId))[0]);
  expect(d.core[0]!.accounts.filter((m) => m.isSigner).map((m) => m.address)).toEqual([payer]);
  expect(d.specs.map((s) => s.address)).toContain(d.v1.feed);
  await classicAt(store, 'reference_usdc_cpmm_m0', d.v1.feedId);
  const done = await prepareV1SimpleFeed(deps(rpc), { authority: payer, ticker: 'SOLX', baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool],
    policy, variant: 1, receipts: [{ signature: 'sig' }] } as never);
  expect(done.plan.feed).toBe(d.v1.feed);
  expect(done.plan.steps.map((s) => [s.stepId, s.requiredSigners])).toEqual([['classic:activate', [payer]]]);
  expect(done.reconciliation.action).toBe('complete');
  expect(done.next).toBeNull();
  const fundingContext = new SolCreationContext();
  fundingContext.creditValidThroughSlot = 8n;
  const [admin] = await V1.findMimirV1AdminConfigPda(programId);
  store.delete(admin); // Terminal completion has no current-admin pricing dependency.
  const restored = await prepareV1SimpleFeed(deps(rpc), { authority: payer, ticker: 'SOLX', baseMint: c.baseMint, quoteMint: c.quoteMint,
    pools: [pool], policy, variant: 1, receipts: [{ signature: 'sig' }], landedSlot: 9n, fundingContext } as never);
  expect(restored.reconciliation.action).toBe('complete');
  expect(fundingContext.slot).toBe(9n);
  expect(() => fundingContext.assertTerms()).toThrow();
});

it('V1 composite draft is one CREATE_COMPOSITE over existing V1 Classics', async () => {
  const data = new Uint8Array(readFileSync('tests/fixtures/layout_v1/classic/reference_usdc_cpmm_m0.bin'));
  const store = new Map<Address, Acc>();
  const ids = [addr(60), addr(61)];
  for (const id of ids) {
    const [feed] = await V1.findMimirV1ClassicFeedPda(programId, id), bytes = data.slice();
    bytes.set(getAddressEncoder().encode(feed), 48);
    bytes.set(getAddressEncoder().encode(id), 16);
    store.set(feed, { owner: programId, executable: false, data: bytes });
  }
  const rpc = await chain(store);
  const d = await draftV1Composite(deps(rpc), { authority: payer, ticker: 'PAIR', quoteMint: USDC_QUOTE_MINT,
    displayName: '', policy: { priceExponent: -8, maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150, maxComponentConfidenceBps: 500,
      maxComponentDispersionBps: 100 }, components: ids.map((feedId) => ({ feedId, quantityX64: 1n << 64n })) } as never);
  const ix = d.core.at(-1)!;
  expect(ix.data[0]).toBe(95);
  expect(d.metas).toHaveLength(2);
  for (const m of d.metas) {
    expect(ix.accounts.map((a) => a.address)).toContain(m.feed);
    if ('ownerDestination' in m) expect(ix.accounts.map((a) => a.address)).toContain(m.ownerDestination);
  }
  expect(d.metas.every((m) => !('ownerDestination' in m) || m.ownerDestination !== payer)).toBe(true);
  expect(ix.accounts.filter((m) => m.isSigner).map((m) => m.address)).toEqual([payer]);
  expect(ix.data[4]).toBe(0);
  expect([ix.data[20], ix.data[21]]).toEqual([0, 4]);
  // I6: CREATE_COMPOSITE + its first tag87 must simulate Fresh; a degraded first price is refused before any approval.
  expect(d.tolerance).toBe(`Tolerance: spread ${d.policy.maxComponentDispersionBps / 100}% · confidence ${d.policy.maxComponentConfidenceBps / 100}%.`);
  const simulate = await d.gate();
  await expect(simulate()).resolves.toMatchObject({ instruction: { data: expect.any(Uint8Array) }, rows: 2 });
  const degraded = firstPriceComposite(d.composite);
  degraded[104] = 1; degraded[319] = 2; new DataView(degraded.buffer).setUint16(314, 4, true);
  (rpc as { simulateTransaction: unknown }).simulateTransaction = () => ({ send: async () => ({ context: { slot: 9n },
    value: { err: null, accounts: [{ data: [Buffer.from(degraded).toString('base64'), 'base64'] }] } }) });
  await expect(simulate()).rejects.toThrow('PAIR: its first price would not be fresh (conditions 4, rows 0). Choose other components. Nothing was sent.');
});

it('a multi-row child is refused by name before any pool is read', async () => {
  const data = new Uint8Array(readFileSync('tests/fixtures/layout_v1/classic/reference_usdc_cpmm_m0.bin'));
  const store = new Map<Address, Acc>();
  const ids = [addr(62), addr(63)];
  for (const id of ids) {
    const [feed] = await V1.findMimirV1ClassicFeedPda(programId, id), bytes = data.slice();
    bytes.set(getAddressEncoder().encode(feed), 48);
    bytes.set(getAddressEncoder().encode(id), 16);
    store.set(feed, { owner: programId, executable: false, data: bytes });
  }
  const rpc = await chain(store), gma = rpc.getMultipleAccounts;
  const asked: Address[] = [];
  rpc.getMultipleAccounts = (xs: readonly Address[]) => { asked.push(...xs); return gma(xs); };
  seen.rows = 2;
  try {
    await expect(draftV1Composite(deps(rpc), { authority: payer, ticker: 'PAIR', quoteMint: USDC_QUOTE_MINT, displayName: '',
      policy: { priceExponent: -8, maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150, maxComponentConfidenceBps: 500, maxComponentDispersionBps: 100 },
      components: ids.map((feedId) => ({ feedId, quantityX64: 1n << 64n })) } as never)).rejects.toThrow('V1 composite child must be a one-row Classic');
  } finally { seen.rows = undefined; }
  expect(asked).not.toContain(cola);
});

const SOL = 'So11111111111111111111111111111111111111112' as Address;
const compositePolicy = { priceExponent: -8, maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150, maxComponentConfidenceBps: 500, maxComponentDispersionBps: 100 };

it('composite CREATE carries the media memo: the real review simulates [memo, 95, 87] in one wire', async () => {
  const data = new Uint8Array(readFileSync('tests/fixtures/layout_v1/classic/reference_usdc_cpmm_m0.bin'));
  const store = new Map<Address, Acc>();
  const ids = [addr(60), addr(61)];
  for (const id of ids) {
    const [feed] = await V1.findMimirV1ClassicFeedPda(programId, id), bytes = data.slice();
    bytes.set(getAddressEncoder().encode(feed), 48);
    bytes.set(getAddressEncoder().encode(id), 16);
    store.set(feed, { owner: programId, executable: false, data: bytes });
  }
  const rpc = { ...await chain(store), getLatestBlockhash: () => ({ send: async () => ({ context: { slot: 9n }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 99n } }) }) };
  const [admin] = await V1.findMimirV1AdminConfigPda(programId), [treasury] = await V1.findMimirV1TreasuryPda(programId);
  store.get(admin)!.data.set(getAddressEncoder().encode(treasury), 120);
  const [ata] = await V1.findMimirV1AssociatedTokenAddress(payer, cola), funded = new Uint8Array(165);
  funded.set(getAddressEncoder().encode(cola)); funded.set(getAddressEncoder().encode(payer), 32); new DataView(funded.buffer).setBigUint64(64, 10n ** 15n, true); funded[108] = 1;
  store.set(ata, { owner: TOKEN, executable: false, data: funded });
  const sha = 'cd'.repeat(32), stop = new Error('simulated');
  let wire: Uint8Array | undefined;
  const gate = rpc.simulateTransaction as (w: string, o: unknown) => { send: () => Promise<unknown> };
  rpc.simulateTransaction = ((w: string, o: unknown) => Buffer.from(w, 'base64').includes(Buffer.from('mimir-media:v1:'))
    ? { send: async () => { wire = Buffer.from(w, 'base64'); throw stop; } } : gate(w, o)) as never;
  const calls: Parameters<typeof review.prepareReview>[0][] = [];
  const spy = vi.spyOn(review, 'prepareReview').mockImplementation(async (a) => { calls.push(a); return tightReview(a); });
  const input = { authority: payer, ticker: 'PAIR', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy,
    components: ids.map((feedId) => ({ feedId, quantityX64: 1n << 64n })), mediaMemoSha: sha };
  await expect(prepareV1CompositeFeed(deps(rpc), input as never).finally(() => spy.mockRestore())).rejects.toBe(stop);
  // The real review passed its prefix guard and simulates one wire: memo, then CREATE_COMPOSITE (95), then the first price (87).
  const [a] = calls, at = (data: Uint8Array) => Buffer.from(wire!).indexOf(Buffer.from(data));
  const memo = a!.callerPrefix!.instructions[0]!, create = a!.instructions.at(-1)!, first = a!.firstPrice!.instructions[0]!;
  expect([calls.length, memo.programAddress, create.data[0], first.data[0]]).toEqual([1, MEDIA_MEMO_PROGRAM, 95, 87]);
  expect(0 <= at(memo.data) && at(memo.data) < at(create.data) && at(create.data) < at(first.data)).toBe(true);
  const burn = a!.specs.find((s) => s.kind === 'spl-token-burn-checked') as { outerInstructionIndex: number } | undefined;
  if (burn) expect(a!.instructions[burn.outerInstructionIndex]!.data[0]).toBe(95);
});
/** A fixture Classic re-addressed under `feedId`; with `base`, re-based (feed image @48) as a CLMM mode-2 converter row. */
async function classicAt(store: Map<Address, Acc>, file: string, feedId: Address, base?: Address) {
  const bytes = new Uint8Array(readFileSync(`tests/fixtures/layout_v1/classic/${file}.bin`));
  const [feed] = await V1.findMimirV1ClassicFeedPda(programId, feedId);
  bytes.set(getAddressEncoder().encode(feed), 48);
  bytes.set(getAddressEncoder().encode(feedId), 16);
  if (base) {
    const image = V1.decodeV1ClassicFeed(bytes).definition.feedImage;
    const at = bytes.findIndex((_, i) => image.every((b, j) => bytes[i + j] === b));
    bytes.set(getAddressEncoder().encode(base), at + 48);
    const d = V1.V1Layout.CLASSIC_ROWS + V1.V1Layout.ROW_DESCRIPTOR;
    bytes[d + V1.V1Layout.D_MODE] = 2; bytes[d + V1.V1Layout.D_ADAPTER_TYPE] = 1; bytes[d + V1.V1Layout.D_ADAPTER_VERSION] = 0;
  }
  store.set(feed, { owner: programId, executable: false, data: bytes });
  return feed;
}

it('V1 composite with a SOL-quoted child carries s >= 1, the SOL feed meta and the exact length; the SOL feed may be a component', async () => {
  const store = new Map<Address, Acc>();
  const solId = await V1.deriveMimirV1ClassicFeedId(SOL, USDC_QUOTE_MINT, 0);
  const solFeed = await classicAt(store, 'reference_usdc_cpmm_m0', solId, SOL);
  expect(solFeed).toBe((await V1.findMimirV1SolFeedPda(programId, USDC_QUOTE_MINT))[0]);
  await classicAt(store, 'sol_quoted_cpmm_m0', addr(62));
  const solSource = V1.decodeV1ClassicFeed(store.get(solFeed)!.data, solFeed).rows[0]!.source, clmmPool = new Uint8Array(237);
  new DataView(clmmPool.buffer).setUint16(235, 1, true);
  store.set(getAddressDecoder().decode(solSource.subarray(V1.V1Layout.SRC_OFFSET_POOL_OR_MARKET, V1.V1Layout.SRC_OFFSET_POOL_OR_MARKET + 32)),
    { owner: programId, executable: false, data: clmmPool });
  const rpc = await chain(store);
  const d = await draftV1Composite(deps(rpc), { authority: payer, ticker: 'SOLB', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy,
    components: [solId, addr(62)].map((feedId) => ({ feedId, quantityX64: 1n << 64n })) } as never);
  const ix = d.core.at(-1)!;
  expect(ix.data[0]).toBe(95);
  expect(ix.data[4]).toBe(1);
  const decoded = await Promise.all([solId, addr(62)].map(async (id) => { const [f] = await V1.findMimirV1ClassicFeedPda(programId, id);
    return { feed: V1.decodeV1ClassicFeed(store.get(f)!.data, f), quantityX64: 1n << 64n }; }));
  expect(d.feedId).toBe(await V1.deriveMimirV1CompositeFeedIdFromFeeds({ programId, creator: payer, quoteMint: USDC_QUOTE_MINT, priceExponent: -8,
    children: decoded, solFeed: decoded[0]!.feed }));
  expect(ix.accounts.filter((m) => m.address === solFeed).length).toBeGreaterThanOrEqual(2);
  const target = d.specs.find((s) => s.kind === 'account' && s.address === d.composite) as { dataLengthAfter: number };
  expect(target.dataLengthAfter).toBeGreaterThan(0);
});

it('V1 all-new composite journey reviews the first child CREATE_CLASSIC and projects the root', async () => {
  const fixture = await makeBetaCaptureFixture('raydium-clmm', { seed: 12 });
  const c = await decodeMimirBetaCaptureCandidate(fixture.input);
  const pool = { eligibility: 'eligible', family: 'raydium-clmm', programId: c.programId, pool: c.pool, descriptorId: c.descriptorId,
    descriptorHash: c.descriptorHash, readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1,
    canonicalPairKey: c.canonicalPairKey, direction: 'quote-per-base', baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault,
    quoteVault: c.quoteVault, adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
    minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: 'a'.repeat(64), creation: fixture.creation } as MimirBetaEligiblePool;
  const store = new Map<Address, Acc>(fixture.fixtureAccounts.map((x) => [x.address, x]));
  if (!store.has(c.baseMint)) store.set(c.baseMint, mint(9));
  if (!store.has(c.quoteMint)) store.set(c.quoteMint, mint(6));
  await classicAt(store, 'reference_usdc_cpmm_m0', addr(63));
  withReadyNativeHistory(store, 9n);
  const rpc = await chain(store);
  const identity = { asset: addr(70), agentUri: '' };
  const input = { authority: payer, ticker: 'NEWB', quoteMint: c.quoteMint, displayName: '', policy: compositePolicy, identity,
    creatorCollateralTokenAccount: addr(71), components: [
      { feedId: addr(64), sourceConfig: addr(65), quantityX64: 1n << 64n, createClassic: { baseMint: c.baseMint, ticker: 'KID', pool, policy,
        identity: { asset: addr(72), agentUri: '' } } },
      { feedId: addr(63), sourceConfig: (await V1.findMimirV1SourceConfigAddress(programId, addr(63), 0))[0], quantityX64: 1n << 64n }] };
  const reviewed: unknown[] = [];
  const spy = vi.spyOn(review, 'prepareReview').mockImplementation(async (a) => { reviewed.push(a); return { step: a.step, review: { simulation: { contextSlot: 9n } },
    transaction: { serializedTransaction: new Uint8Array(900), packet: { accountCount: 20, instructionCount: 1, signatureCount: 1 } } } as never; });
  const j = await prepareV1CompositeFeedJourney(deps(rpc), { input } as never, rpc as never);
  spy.mockRestore();
  expect(j.action).toBe('review-next-step');
  expect(j.next?.operationId).toBe('child:0');
  expect((reviewed[0] as { instructions: { data: Uint8Array }[] }).instructions.at(-1)!.data[0]).toBe(93);
  expect(reviewed[0]).not.toHaveProperty('callerPrefix');
  const named: { callerPrefix?: { instructions: { data: Uint8Array }[] } }[] = [];
  const namedSpy = vi.spyOn(review, 'prepareReview').mockImplementation(async (a) => { named.push(a as never); return { step: a.step, review: { simulation: { contextSlot: 9n } },
    transaction: { serializedTransaction: new Uint8Array(900), packet: { accountCount: 20, instructionCount: 1, signatureCount: 1 } } } as never; });
  await prepareV1CompositeFeedJourney(deps(rpc), { input: { ...input, components: [{ ...input.components[0]!, createClassic: { ...input.components[0]!.createClassic!,
    mediaMemoSha: 'ef'.repeat(32) } }, input.components[1]!] } } as never, rpc as never).finally(() => namedSpy.mockRestore());
  expect(new TextDecoder().decode(named[0]!.callerPrefix!.instructions[0]!.data)).toBe(`mimir-media:v1:${'ef'.repeat(32)}`);

  const sha = 'cd'.repeat(32), memoArgs: { callerPrefix?: { instructions: { programAddress: string; accounts: unknown[]; data: Uint8Array }[]; maxAuthorityDebitLamports: bigint } }[] = [];
  const MimirBetaError = BetaError;
  const memoSpy = vi.spyOn(review, 'prepareReview').mockImplementation(async (a) => {
    memoArgs.push(a as never);
    if (a.callerPrefix && memoArgs.length > 1) throw new MimirBetaError('TRANSACTION_TOO_LARGE', 'too large');
    return { step: a.step, review: { simulation: { contextSlot: 9n } } } as never;
  });
  const classicArgs = { authority: payer, ticker: 'MEMOK', baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool], policy, identity: { asset: addr(74), agentUri: '' },
    creatorCollateralTokenAccount: addr(71), mediaMemoSha: sha };
  await prepareV1SimpleFeed(deps(rpc), classicArgs as never);
  await prepareV1SimpleFeed(deps(rpc), classicArgs as never).finally(() => memoSpy.mockRestore());
  const prefix = memoArgs[0]!.callerPrefix!;
  expect([prefix.instructions.length, prefix.instructions[0]!.programAddress, prefix.instructions[0]!.accounts.length, prefix.maxAuthorityDebitLamports])
    .toEqual([1, MEDIA_MEMO_PROGRAM, 0, 0n]);
  expect(new TextDecoder().decode(prefix.instructions[0]!.data)).toBe(`mimir-media:v1:${sha}`);
  // The merged review with the memo is too large: today's path runs unchanged, memo first, then without it.
  const merged = (i: number) => !!(memoArgs[i] as { firstPrice?: object }).firstPrice;
  expect([!!memoArgs[1]!.callerPrefix, merged(1), !!memoArgs[2]!.callerPrefix, merged(2), !!memoArgs[3]!.callerPrefix, merged(3)]).toEqual([true, true, true, false, false, false]);
  expect((memoArgs[3] as { instructions: { data: Uint8Array }[] }).instructions.at(-1)!.data[0]).toBe(93);
  expect(j.state.operations.map((o) => o.operationId)).toEqual(['child:0', 'root']);
  expect(j.root?.stepIds).toEqual(['composite:activate']);
  expect(j.packets.map((p) => p.operationId)).toEqual(['child:0', 'root']);
  await expect(prepareV1CompositeFeedJourney(deps(rpc), { input, state: { ...j.state, intentHash: '0'.repeat(64) } } as never, rpc as never))
    .rejects.toThrow('intent changed');
  expect(seen.classic.at(-1)).not.toHaveProperty('recipes');

  const native = { ...input, componentRecipes: ['native-bounded', null], components: [
    { ...input.components[0]!, createClassic: { ...input.components[0]!.createClassic!, temporalMode: 'sampled-interval' } }, input.components[1]!] };
  seen.classic.length = 0;
  const nativeSpy = vi.spyOn(review, 'prepareReview').mockImplementation(async (a) => ({ step: a.step, review: { simulation: { contextSlot: 9n } },
    transaction: { serializedTransaction: new Uint8Array(900), packet: { accountCount: 20, instructionCount: 1, signatureCount: 1 } } }) as never);
  const nj = await prepareV1CompositeFeedJourney(deps(rpc), { input: native } as never, rpc as never);
  nativeSpy.mockRestore();
  expect(seen.classic[0]).toMatchObject({ recipes: ['native-bounded'], temporalMode: 'sampled-interval' });
  expect(nj.intentHash).not.toBe(j.intentHash);
  expect(nj.state.operations[0]!.definitionHash).not.toBe(j.state.operations[0]!.definitionHash);
});

it('V1 composite journey: a finalized child receipt pins its variant and the root is the next CREATE_COMPOSITE', async () => {
  const fixture = await makeBetaCaptureFixture('raydium-clmm', { seed: 13 });
  const c = await decodeMimirBetaCaptureCandidate(fixture.input);
  const pool = { eligibility: 'eligible', family: 'raydium-clmm', programId: c.programId, pool: c.pool, descriptorId: c.descriptorId,
    descriptorHash: c.descriptorHash, readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1,
    canonicalPairKey: c.canonicalPairKey, direction: 'quote-per-base', baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault,
    quoteVault: c.quoteVault, adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
    minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: 'a'.repeat(64), creation: fixture.creation } as MimirBetaEligiblePool;
  const store = new Map<Address, Acc>(fixture.fixtureAccounts.map((x) => [x.address, x]));
  if (!store.has(c.baseMint)) store.set(c.baseMint, mint(9));
  if (!store.has(c.quoteMint)) store.set(c.quoteMint, mint(6));
  const childId = await V1.deriveMimirV1ClassicFeedId(c.baseMint, c.quoteMint, 3);
  await classicAt(store, 'reference_usdc_cpmm_m0', childId);
  await classicAt(store, 'reference_usdc_cpmm_m0', addr(66));
  const rpc = await chain(store);
  const input = { authority: payer, ticker: 'ROOTB', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy, identity: { asset: addr(73), agentUri: '' },
    creatorCollateralTokenAccount: addr(71), components: [
      { feedId: addr(67), sourceConfig: addr(68), quantityX64: 1n << 64n, createClassic: { baseMint: c.baseMint, ticker: 'KIDB', pool, policy,
        identity: { asset: addr(74), agentUri: '' } } },
      { feedId: addr(66), sourceConfig: (await V1.findMimirV1SourceConfigAddress(programId, addr(66), 0))[0], quantityX64: 1n << 64n }] };
  const first = await (async () => {
    const spy = vi.spyOn(review, 'prepareReview');
    const observe = vi.spyOn(review, 'observeMimirBetaReceiptChain').mockResolvedValue([{ state: 'finalized' }] as never);
    const reviewed: { instructions: { data: Uint8Array }[] }[] = [];
    spy.mockImplementation(async (a) => { reviewed.push(a as never); return { step: a.step, review: { simulation: { contextSlot: 9n } },
      transaction: { serializedTransaction: new Uint8Array(900), packet: { accountCount: 20, instructionCount: 1, signatureCount: 1 } } } as never; });
    const state = { schema: 'mimir-beta-composite-journey-state', version: 1, intentHash: '', inputRevision: 0, operations: [
      { operationId: 'child:0', definitionHash: '', identity: input.components[0]!.createClassic!.identity, canonicalDraftJson: (await review.createDraftHash({ variant: 3 })).canonicalDraftJson,
        receipts: [{ signature: 'sig', stepId: 'classic:activate' }] }] };
    const probe = await prepareV1CompositeFeedJourney(deps(rpc), { input } as never, rpc as never);
    const j = await prepareV1CompositeFeedJourney(deps(rpc), { input, state: { ...state, intentHash: probe?.intentHash ?? '' } } as never, rpc as never);
    spy.mockRestore(); observe.mockRestore();
    return { j, reviewed };
  })();
  expect(first.j.next?.operationId).toBe('root');
  expect(first.reviewed.at(-1)!.instructions.at(-1)!.data[0]).toBe(95);
  expect(first.j.root?.feed).toBe(first.j.next?.plan.feed);
});

it('REVIEW activation-fee revisions bind the CREATE_COMPOSITE signed packet', async () => {
  const store = new Map<Address, Acc>();
  const ids = [addr(60), addr(61)];
  for (const id of ids) await classicAt(store, 'reference_usdc_cpmm_m0', id);
  const rpc = await chain(store);
  const args = { authority: payer, ticker: 'PAIR', quoteMint: USDC_QUOTE_MINT, displayName: '',
    policy: compositePolicy, components: ids.map((feedId) => ({ feedId, quantityX64: 1n << 64n })) } as never;
  const revisionOf = (core: readonly { data: Uint8Array }[]) => { const ix = core.find((x) => x.data[0] === 95)!;
    return new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).getBigUint64(74, true); };
  const before = await draftV1Composite(deps(rpc), args);
  const [adminKey] = await V1.findMimirV1AdminConfigPda(programId);
  const data = store.get(adminKey)!.data, view = new DataView(data.buffer);
  for (const at of [104, 108, 112]) view.setUint32(at, 100_000_000, true);
  view.setBigUint64(152, 2n, true);
  const after = await draftV1Composite(deps(rpc), args);
  expect(revisionOf(before.core)).toBe(1n);
  expect(revisionOf(after.core)).toBe(2n);
  expect(after.core).not.toEqual(before.core);
  const pricedAdmin = { configRevision: 1n, collateralAmountRaw: 1_000n, tickerTierTenths: [150, 30, 5, 2] };
  expect(revisionOf((await draftV1Composite(deps(rpc), { ...(args as object), pricedAdmin } as never)).core)).toBe(1n);
});

it('APP15-01 CREATE_COMPOSITE signs the priced revision and tariff, never the newer chain revision', async () => {
  const store = new Map<Address, Acc>();
  const ids = [addr(60), addr(61)];
  for (const id of ids) await classicAt(store, 'reference_usdc_cpmm_m0', id);
  const rpc = await chain(store);
  const [adminKey] = await V1.findMimirV1AdminConfigPda(programId);
  const chainAdmin = new DataView(store.get(adminKey)!.data.buffer); // the chain already moved to revision 2 with new fees and tiers
  chainAdmin.setBigUint64(152, 2n, true);
  for (const at of [104, 108, 112]) chainAdmin.setUint32(at, 100_000_000, true);
  chainAdmin.setUint8(118, 50);
  const pricedAdmin = { configRevision: 1n, collateralAmountRaw: 1_000n, tickerTierTenths: [150, 30, 5, 2] };
  const draft = await draftV1Composite(deps(rpc), { authority: payer, ticker: 'PAIR', quoteMint: USDC_QUOTE_MINT, displayName: '',
    policy: compositePolicy, components: ids.map((feedId) => ({ feedId, quantityX64: 1n << 64n })), pricedAdmin } as never);
  const ix = draft.core.find((i) => i.data[0] === 95)!;
  const v = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
  expect(v.getBigUint64(74, true)).toBe(1n);
  expect(v.getBigUint64(8, true)).toBe(500n);
});

/** Five new child Classics then the root, driven like the store: each `next` is one wallet prompt, its receipt lands (or, once, is dropped). */
async function fiveChildJourney(opts: { drop?: number; replacementReview?: (r: object) => object; landedDefinition?: (c: object) => object; terminalContext?: boolean; rootConfirmed?: boolean } = {}) {
  const store = new Map<Address, Acc>();
  const pools = await Promise.all([31, 32, 33, 34, 35].map(async (seed) => {
    const fixture = await makeBetaCaptureFixture('raydium-clmm', { seed, baseMint: fixtureAddress(seed + 150) });
    const c = await decodeMimirBetaCaptureCandidate(fixture.input);
    for (const x of fixture.fixtureAccounts) store.set(x.address, x);
    if (!store.has(c.baseMint)) store.set(c.baseMint, mint(9));
    if (!store.has(c.quoteMint)) store.set(c.quoteMint, mint(6));
    return { eligibility: 'eligible', family: 'raydium-clmm', programId: c.programId, pool: c.pool, descriptorId: c.descriptorId,
      descriptorHash: c.descriptorHash, readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1,
      canonicalPairKey: c.canonicalPairKey, direction: 'quote-per-base', baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault,
      quoteVault: c.quoteVault, adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
      minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: 'a'.repeat(64), creation: fixture.creation } as MimirBetaEligiblePool;
  }));
  const base = await chain(store), floors: unknown[] = [];
  const rpc = { ...base, getSignatureStatuses: (signatures: string[]) => ({ send: async () => ({ context: { slot: 10001n }, value: signatures.map(signature => opts.rootConfirmed && signature.startsWith('root') ? { slot: 1526n, err: null, confirmationStatus: 'confirmed' } : null) }) }),
    getMultipleAccounts: (xs: readonly Address[], c?: { minContextSlot?: bigint }) => ({ send: async () => { floors.push(c?.minContextSlot);
      const r = await base.getMultipleAccounts(xs).send(); return { ...r, context: { slot: c?.minContextSlot ?? r.context.slot } }; } }) };
  const input = { authority: payer, ticker: 'MAGF', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy, identity: { asset: addr(80), agentUri: '' },
    creatorCollateralTokenAccount: addr(71), components: pools.map((pool, i) => ({ feedId: addr(90 + i), sourceConfig: addr(95 + i),
      quantityX64: BigInt(i + 1) << 60n, createClassic: { baseMint: pool.baseMint, ticker: `KID${'ABCDE'[i]}`, pool, policy, identity: { asset: addr(81 + i), agentUri: '' } } })) };
  const landed = new Map<string, { state: string; observedSlot: bigint }>();
  const observation = (r: { signature: string; stepId: string }) => ({ ...(opts.rootConfirmed && r.signature.startsWith('root') ? { state: 'pending' } : landed.get(r.signature) ?? { state: 'pending' }), signature: r.signature, stepId: r.stepId });
  const spies = [
    vi.spyOn(review, 'prepareReview').mockImplementation(async (a) => ({ step: a.step, review: { cluster: a.plan.cluster, programId: a.plan.programId,
      authority: a.plan.authority, draftHash: a.draftHash, stepId: a.step.stepId, kind: a.target.kind, feedId: a.target.feedId, feed: a.target.feed,
      identityAsset: a.target.identityAsset, ticker: a.target.ticker, instructions: a.instructions, simulation: { contextSlot: 9n } },
      transaction: { serializedTransaction: new Uint8Array(900), packet: { accountCount: 20, instructionCount: 1, signatureCount: 1 } } }) as never),
    vi.spyOn(review, `authenticateMimirBetaReviewedStep`).mockImplementation(async (r) => ({ review: (r as unknown as { review: object }).review }) as never),
    vi.spyOn(review, 'observeMimirBetaReceiptChain').mockImplementation(async ({ receipts }) => { // the SDK's strict same-hash retry guard
      if (receipts[1] && receipts[1].stepIntentHash !== receipts[0]!.stepIntentHash) throw new Error('RECONCILIATION_CONFLICT:receipt chain retry differs from predecessor');
      return receipts.map(observation) as never; }),
    vi.spyOn(review, 'observeMimirBetaReceipt').mockImplementation(async ({ receipt }) => observation(receipt) as never)];
  let state: unknown, j: Awaited<ReturnType<typeof prepareV1CompositeFeedJourney>> | undefined, slot = 1520n;
  const prompts: string[] = [];
  try {
    for (let n = 0; n < 12; n++) {
      j = await prepareV1CompositeFeedJourney(deps(rpc), { input, ...(state ? { state } : {}) } as never, rpc as never);
      if (!j.next) break;
      const { operationId, preparedStep } = j.next, op = j.state.operations.find((o) => o.operationId === operationId)!, prior = op.receipts.at(-1);
      const attempt = op.receipts.length + 1, signature = `${operationId}-${attempt}`;
      const reviewed = (attempt === 2 && opts.replacementReview ? opts.replacementReview(preparedStep.review) : preparedStep.review) as { feedId: Address; feed: Address };
      prompts.push(signature);
      if (operationId === `child:${opts.drop}` && attempt === 1) landed.set(signature, { state: 'expired', observedSlot: 1243n });
      else {
        landed.set(signature, { state: 'finalized', observedSlot: ++slot });
        if (operationId === 'root') {
          store.set(reviewed.feed, { owner: programId, executable: false, data: new Uint8Array(8) });
          const signed = JSON.parse(j.next.canonicalDraftJson) as { feedId: Address; components: { feedId: Address; quantityX64: string }[] };
          const config = { feedId: getAddressEncoder().encode(signed.feedId), creator: payer, priceExponent: -8,
            components: signed.components.map((c) => ({ feedId: getAddressEncoder().encode(c.feedId), quantityX64: BigInt(c.quantityX64) })) };
          seen.composite = () => ({ config: opts.landedDefinition ? opts.landedDefinition(config) : config });
        } else await classicAt(store, 'reference_usdc_cpmm_m0', reviewed.feedId);
      }
      const receipt = { signature, stepId: preparedStep.step.stepId, attempt, retryOfSignature: prior?.signature ?? null,
        stepIntentHash: signature, expectedWritesHash: signature, review: reviewed };
      state = { ...j.state, operations: j.state.operations.map((o) => o.operationId === operationId ? { ...o, receipts: [...o.receipts, receipt] } : o) };
    }
    const fundingContext = new SolCreationContext();
    fundingContext.creditValidThroughSlot = 8n;
    if (opts.terminalContext) {
      const [admin] = await V1.findMimirV1AdminConfigPda(programId);
      store.delete(admin);
    }
    const restored = await prepareV1CompositeFeedJourney(deps(rpc), {
      input: { ...input, ...(opts.terminalContext ? { fundingContext } : {}) }, state
    } as never, rpc as never);
    if (opts.terminalContext) {
      expect(fundingContext.slot).toBeGreaterThanOrEqual(slot);
      expect(() => fundingContext.assertTerms()).toThrow();
    }
    return { j: j!, restored, prompts, floors, slot, state: state as { operations: { operationId: string; receipts: { signature: string }[] }[] } };
  } finally {
    for (const spy of spies) spy.mockRestore();
    seen.composite = undefined;
  }
}

it('V1 five-new-child composite: six finalized operations, six prompts, complete at the root landed slot', async () => {
  const run = await fiveChildJourney();
  expect(run.prompts).toEqual(['child:0-1', 'child:1-1', 'child:2-1', 'child:3-1', 'child:4-1', 'root-1']);
  expect([run.j.action, run.j.next, run.restored.action, run.restored.next]).toEqual(['complete', null, 'complete', null]);
  expect(run.floors).toContain(run.slot);
});

it('MAG5 recovery: dropped child attempt 1 -> proven expiry -> one replacement -> remaining children and root complete, also after restoration', async () => {
  const run = await fiveChildJourney({ drop: 1 });
  expect(run.prompts).toEqual(['child:0-1', 'child:1-1', 'child:1-2', 'child:2-1', 'child:3-1', 'child:4-1', 'root-1']);
  expect(run.state.operations.find((o) => o.operationId === 'child:1')!.receipts.map((r) => r.signature)).toEqual(['child:1-1', 'child:1-2']);
  expect([run.j.action, run.restored.action, run.restored.next]).toEqual(['complete', 'complete', null]);
  expect(run.restored.remainingCollateralRaw).toBe(0n);
  expect(run.floors).toContain(run.slot);
});

it('MAG5 recovery: a replacement reviewing another target or core CREATE is a new intent and nothing downstream is sent', async () => {
  for (const change of [(r: object) => ({ ...r, feed: addr(99) }), (r: object) => ({ ...r, instructions: [] })]) {
    await expect(fiveChildJourney({ drop: 1, replacementReview: change })).rejects.toThrow('not the same reviewed V1 CREATE');
  }
});

it('MAG5 root: a landed composite whose quantity or exponent differs from the signed intent is never complete', async () => {
  for (const change of [(c: { components: { quantityX64: bigint }[] }) => ({ ...c, components: c.components.map((x, i) => i === 4 ? { ...x, quantityX64: x.quantityX64 + 1n } : x) }),
    (c: object) => ({ ...c, priceExponent: -7 })]) {
    await expect(fiveChildJourney({ landedDefinition: change as never })).rejects.toThrow('does not carry the signed definition');
  }
});

it('paid staged root restores in observer phase after expiry without current admin pricing', async () => {
  const run = await fiveChildJourney({ terminalContext: true });
  expect(run.prompts).toHaveLength(6);
  expect(run.restored).toMatchObject({ action: 'complete', next: null, remainingCollateralRaw: 0n });
});

it('confirmed root observation after expiry never reauthorizes unpaid terms', async () => {
 const run = await fiveChildJourney({ terminalContext: true, rootConfirmed: true });
 expect(run.restored.action).toBe('await-finality');
 expect(run.restored.next).toBeNull();
});

it('J5: an all-new two-child composite never sends the empty getMultipleAccounts the relay refuses', async () => {
  const store = new Map<Address, Acc>();
  await classicAt(store, 'reference_usdc_cpmm_m0', await V1.deriveMimirV1ClassicFeedId(SOL, USDC_QUOTE_MINT, 0), SOL);
  const kids = await Promise.all([SOL, USDC_QUOTE_MINT].map(async (quoteMint, i) => {
    const fixture = await makeBetaCaptureFixture('raydium-clmm', { seed: 14 + i, baseMint: fixtureAddress(181 + i), quoteMint });
    const c = await decodeMimirBetaCaptureCandidate(fixture.input);
    for (const x of fixture.fixtureAccounts) store.set(x.address, x);
    if (!store.has(c.baseMint)) store.set(c.baseMint, mint(9));
    if (!store.has(c.quoteMint)) store.set(c.quoteMint, mint(6));
    return { c, pool: { eligibility: 'eligible', family: 'raydium-clmm', programId: c.programId, pool: c.pool, descriptorId: c.descriptorId,
      descriptorHash: c.descriptorHash, readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1,
      canonicalPairKey: c.canonicalPairKey, direction: 'quote-per-base', baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault,
      quoteVault: c.quoteVault, adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
      minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: 'a'.repeat(64), creation: fixture.creation } as MimirBetaEligiblePool };
  }));
  const base = await chain(store), empty: unknown[] = [];
  const rpc = { ...base, getMultipleAccounts: (xs: readonly Address[]) => xs.length ? base.getMultipleAccounts(xs)
    : { send: async () => { empty.push(xs); throw Object.assign(new Error('HTTP error (400)'), { context: { statusCode: 400 } }); } } };
  const input = { authority: payer, ticker: 'CTRU5', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy, identity: { asset: addr(80), agentUri: '' },
    creatorCollateralTokenAccount: addr(71), components: kids.map(({ c, pool }, i) => ({ feedId: addr(81 + i), sourceConfig: addr(83 + i), quantityX64: 1n << 64n,
      createClassic: { baseMint: c.baseMint, ticker: `KID${i}`, pool, policy, identity: { asset: addr(85 + i), agentUri: '' } } })) };
  const spy = vi.spyOn(review, 'prepareReview').mockImplementation(async (a) => ({ step: a.step, review: { simulation: { contextSlot: 9n } },
    transaction: { serializedTransaction: new Uint8Array(900), packet: { accountCount: 20, instructionCount: 1, signatureCount: 1 } } }) as never);
  const j = await prepareV1CompositeFeedJourney(deps(rpc), { input } as never, rpc as never).finally(() => spy.mockRestore());
  expect(empty).toEqual([]);
  expect(j.state.operations.map((o) => o.operationId)).toEqual(['child:0', 'child:1', 'root']);
});

it('D-T20-1: a pruned ledger holding no performance sample yet delays the Classic draft until the next sample, never refuses it', async () => {
  const fixture = await makeBetaCaptureFixture('raydium-clmm', { seed: 11 });
  const c = await decodeMimirBetaCaptureCandidate(fixture.input);
  const pool = { eligibility: 'eligible', family: 'raydium-clmm', programId: c.programId, pool: c.pool, descriptorId: c.descriptorId,
    descriptorHash: c.descriptorHash, readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1,
    canonicalPairKey: c.canonicalPairKey, direction: 'quote-per-base', baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault,
    quoteVault: c.quoteVault, adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
    minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: 'a'.repeat(64), creation: fixture.creation } as MimirBetaEligiblePool;
  const store = new Map<Address, Acc>(fixture.fixtureAccounts.map((x) => [x.address, x]));
  if (!store.has(c.baseMint)) store.set(c.baseMint, mint(9));
  if (!store.has(c.quoteMint)) store.set(c.quoteMint, mint(6));
  let calls = 0;
  const rpc = { ...await chain(store), getRecentPerformanceSamples: () => ({ send: async () => calls++ < 2 ? [] : [{ numSlots: 120, samplePeriodSecs: 60 }] }) };
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    const draft = draftV1Classic({ ...deps(rpc) as object, rpcUrl: 'http://127.0.0.1:8898' } as never,
      { authority: payer, ticker: 'SOLX', baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool], policy } as never);
    draft.catch(() => {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await draft).core[0]!.data[0]).toBe(93);
    expect(calls).toBe(3);
  } finally { vi.useRealTimers(); }
});

it('one-character Classic and composite spend the allowance, never a COLA burn, so a wallet without a COLA ATA passes the review guards', async () => {
  const fixture = await makeBetaCaptureFixture('raydium-clmm', { seed: 13 });
  const c = await decodeMimirBetaCaptureCandidate(fixture.input);
  const pool = { eligibility: 'eligible', family: 'raydium-clmm', programId: c.programId, pool: c.pool, descriptorId: c.descriptorId,
    descriptorHash: c.descriptorHash, readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1,
    canonicalPairKey: c.canonicalPairKey, direction: 'quote-per-base', baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault,
    quoteVault: c.quoteVault, adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
    minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: 'a'.repeat(64), creation: fixture.creation } as MimirBetaEligiblePool;
  const store = new Map<Address, Acc>(fixture.fixtureAccounts.map((x) => [x.address, x]));
  if (!store.has(c.baseMint)) store.set(c.baseMint, mint(9));
  if (!store.has(c.quoteMint)) store.set(c.quoteMint, mint(6));
  const [allowance, bump] = await V1.findMimirV1OneCharAllowancePda(programId, payer);
  const held = new Uint8Array(26), hv = new DataView(held.buffer);
  held.set(new TextEncoder().encode('MIMIR1CH')); held[8] = 1; held[9] = bump; hv.setBigUint64(10, 3n, true); hv.setBigUint64(18, 1n, true);
  store.set(allowance, { owner: programId, executable: false, data: held });
  const ids = [addr(90), addr(91)];
  for (const id of ids) await classicAt(store, 'reference_usdc_cpmm_m0', id);
  const rpc = Object.assign(await chain(store), { getLatestBlockhash: () => ({ send: async () => ({ context: { slot: 9n },
    value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n } }) }) });
  const [ata] = await V1.findMimirV1AssociatedTokenAddress(payer, cola);
  expect(store.has(ata)).toBe(false);
  const spend = { kind: 'account', address: allowance, transition: 'write', ownerAfter: programId, dataLengthAfter: 26,
    description: 'consume one-character ticker allowance', codec: 'one-char-allowance-v1' };
  const colaFree = (specs: readonly { kind: string; address: Address }[]) =>
    expect(specs.filter((s) => s.kind === 'spl-token-burn-checked' || s.address === ata || s.address === cola)).toEqual([]);

  const requests: Parameters<typeof review.prepareReview>[0][] = [];
  const spy = vi.spyOn(review, 'prepareReview').mockImplementation(async (a) => { requests.push(a); return { step: a.step, review: { simulation: { contextSlot: 9n } } } as never; });
  const classic = (ticker: string) => prepareV1SimpleFeed(deps(rpc), { authority: payer, ticker, baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool], policy } as never);
  await classic('A');
  await classic('SOLY');
  spy.mockRestore();
  const [one, two] = requests;
  expect(one!.specs.at(-1)).toEqual(spend);
  colaFree(one!.specs);
  expect(two!.specs.filter((s) => s.kind === 'spl-token-burn-checked')).toHaveLength(1);
  if (process.env.ONECHAR_REVIEW_OUT) writeFileSync(process.env.ONECHAR_REVIEW_OUT, JSON.stringify(one, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v, 2));

  // The SDK's pre-simulation burn guard: 1-char reaches simulation, 4-char without an ATA is refused before it.
  const reached = new Error('reached simulation');
  (rpc as { simulateTransaction: unknown }).simulateTransaction = () => ({ send: async () => { throw reached; } });
  await expect(review.prepareReview(one!)).rejects.toBe(reached);
  await expect(review.prepareReview(two!)).rejects.toThrow('creator balance cannot cover activation burns');

  const d = await draftV1Composite(deps(rpc), { authority: payer, ticker: 'B', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy,
    components: ids.map((feedId) => ({ feedId, quantityX64: 1n << 64n })) } as never);
  expect(d.core.at(-1)!.accounts.map((m) => m.address)).toContain(allowance);
  expect(d.specs).toContainEqual(spend);
  colaFree(d.specs);
});
