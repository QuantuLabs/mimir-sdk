// S3: CREATE and the first price merged in one reviewed TxV1, with today's 2-transaction path as the fallback.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { getAddressDecoder, getAddressEncoder, type Address } from '@solana/kit';
import { expect, it, vi } from './vitest.js';
import * as V1 from '../../src/v1/index.js';
import { decodeMimirBetaCaptureCandidate, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID } from '../../src/beta/capture.js';
import type { MimirBetaEligiblePool } from '../../src/beta/discovery.js';
import * as BetaReview from '../../src/beta/review.js';
const { createDraftHash } = BetaReview;
import { MimirBetaError as BetaError, MimirBetaSimulationError as Sim } from '../../src/beta/errors.js';
import { UnpriceableFeedError } from '../../src/create/errors.js';
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

const seen = { classic: [] as { recipes?: unknown; temporalMode?: unknown }[], composite: undefined as ((data: Uint8Array) => unknown) | undefined,
  definition: undefined as ((a: any) => any) | undefined };
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
  seen.classic.push(args[1] as never); return Definition.prepareMimirV1ClassicCreation(args[0], seen.definition ? seen.definition(args[1]) : args[1], ...args.slice(2) as []); } } });
mock.module(new URL('../../src/v1/decoders.ts', import.meta.url).href, { namedExports: { ...Decoders,
  decodeV1CompositeFeed: (...args: Parameters<typeof Decoders.decodeV1CompositeFeed>) => seen.composite ? seen.composite(args[0]) as never : Decoders.decodeV1CompositeFeed(...args) } });
const { prepareV1SimpleFeed, observeV1Operation } = await import('../../src/create/v1-create.js');
const { prepareReview: realTightReview } = await import('../../src/create/review.js');

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


async function classicPool(family: 'raydium-clmm' | 'raydium-cpmm', seed = 11) {
  const fixture = await makeBetaCaptureFixture(family, { seed });
  const c = await decodeMimirBetaCaptureCandidate(fixture.input);
  const pool = { eligibility: 'eligible', family, programId: c.programId, pool: c.pool, descriptorId: c.descriptorId,
    descriptorHash: c.descriptorHash, readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1,
    canonicalPairKey: c.canonicalPairKey, direction: 'quote-per-base', baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault,
    quoteVault: c.quoteVault, adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
    minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: 'a'.repeat(64), creation: fixture.creation } as MimirBetaEligiblePool;
  const store = new Map<Address, Acc>(fixture.fixtureAccounts.map((x) => [x.address, x]));
  if (!store.has(c.baseMint)) store.set(c.baseMint, mint(9));
  if (!store.has(c.quoteMint)) store.set(c.quoteMint, mint(6));
  withReadyNativeHistory(store, 9n);
  const rpc = await chain(store);
  return { rpc, args: { authority: payer, ticker: 'MRG', baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool], policy } };
}
type ReviewArgs = { instructions: readonly { data: Uint8Array }[]; firstPrice?: { instructions: readonly { data: Uint8Array; accounts: readonly { address: string }[] }[] };
  callerPrefix?: object; refreshRows?: number; step: object; target: { feed: string } };
const capture = (behave: (a: ReviewArgs, n: number) => void = () => undefined) => {
  const calls: ReviewArgs[] = [];
  const spy = vi.spyOn(review, 'prepareReview').mockImplementation((async (a: ReviewArgs) => { calls.push(a); behave(a, calls.length);
    return { step: a.step, review: { simulation: { contextSlot: 9n } } }; }) as never);
  return { calls, spy };
};

it('(a) default and native-bounded: one merged review [93, 89] on the created feed, refresh rows passed for the tight reserve', async () => {
  for (const recipes of [undefined, ['native-bounded']] as const) {
    const { rpc, args } = await classicPool('raydium-clmm');
    const { calls, spy } = capture();
    await prepareV1SimpleFeed(deps(rpc), { ...args, ...(recipes ? { recipes } : {}) } as never).finally(() => spy.mockRestore());
    expect(calls).toHaveLength(1);
    const [a] = calls;
    expect([a!.instructions.at(-1)!.data[0], a!.firstPrice!.instructions.length, a!.firstPrice!.instructions[0]!.data[0], a!.refreshRows]).toEqual([93, 1, 89, 1]);
    expect(a!.firstPrice!.instructions[0]!.accounts[0]!.address).toBe(a!.target.feed);
  }
});

it('(a) the tight re-pack of a merged review reserves tight(units) with the refresh-aware fallback', async () => {
  const { tightComputeUnitLimit, CREATE_COMPUTE_UNIT_LIMIT } = await import('../../src/create/helpers.js');
  const { mimirV1RefreshComputeUnitLimit } = await import('../../src/v1/cost.js');
  expect(tightComputeUnitLimit(276_594n, CREATE_COMPUTE_UNIT_LIMIT + mimirV1RefreshComputeUnitLimit(1))).toBe(342_000);
  expect(tightComputeUnitLimit(null, Math.min(1_400_000, CREATE_COMPUTE_UNIT_LIMIT + mimirV1RefreshComputeUnitLimit(3)))).toBe(CREATE_COMPUTE_UNIT_LIMIT + mimirV1RefreshComputeUnitLimit(3));
  expect(typeof realTightReview).toBe('function');
});

it.each([['TRANSACTION_TOO_LARGE'], ['CREATION_TOO_LARGE'], ['compute']] as const)('(b) a merged pair that does not fit (%s) gives today\'s review exactly', async (why) => {
  const { rpc, args } = await classicPool('raydium-clmm');
  const { calls, spy } = capture((a) => {
    if (!a.firstPrice) return;
    if (why === 'compute') throw new Sim({ instructionIndex: 1, customCode: null, programId: null, outerProgramId: null, mimirTag: null, rejection: null,
      logs: ['Program x consumed 1400000 of 1400000 compute units', 'Program x failed: exceeded CUs meter at BPF instruction'], errorKind: 'InstructionError' });
    throw new BetaError(why, 'too large');
  });
  await prepareV1SimpleFeed(deps(rpc), args as never).finally(() => spy.mockRestore());
  expect(calls.map((c) => !!c.firstPrice)).toEqual([true, false]);
  const { firstPrice: _f, refreshRows: _r, ...merged } = calls[0]! as ReviewArgs & Record<string, unknown>;
  const { firstPrice: _g, refreshRows: _s, ...plain } = calls[1]! as ReviewArgs & Record<string, unknown>;
  expect(Object.keys(plain).sort()).toEqual(Object.keys(merged).sort());
  expect(plain.instructions).toBe(merged.instructions);
});

it('(b2) a pair out of compute at the first-price gate is no verdict: today\'s 2-transaction review follows', async () => {
  const { getTransactionDecoder } = await import('@solana/transactions');
  const { getCompiledTransactionMessageDecoder } = await import('@solana/transaction-messages');
  const { rpc, args } = await classicPool('raydium-clmm');
  (rpc as { simulateTransaction: unknown }).simulateTransaction = (wire: string) => ({ send: async () => {
    const at = (getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(wire, "base64")).messageBytes) as unknown as { instructionHeaders: unknown[] }).instructionHeaders.length - 1;
    return { context: { slot: 9n }, value: { err: { InstructionError: [at, 'ComputationalBudgetExceeded'] }, logs: [] } }; } });
  const { calls, spy } = capture((a) => { if (a.firstPrice) throw new Sim({ instructionIndex: 1, customCode: null, programId: null, outerProgramId: null, mimirTag: null,
    rejection: null, logs: ['Program x failed: exceeded CUs meter at BPF instruction'], errorKind: 'InstructionError' }); });
  await prepareV1SimpleFeed(deps(rpc), args as never).finally(() => spy.mockRestore());
  expect(calls.map((c) => !!c.firstPrice)).toEqual([true, false]);
});

it('(c) an interval recipe gets no first-price suffix', async () => {
  const { rpc, args } = await classicPool('raydium-cpmm', 21);
  const { calls, spy } = capture();
  // The fixture venue has no interval generation pin: the definition is sealed as Default, the interval choice stays on the request.
  seen.definition = ({ recipes: _r, ...a }) => a;
  await prepareV1SimpleFeed(deps(rpc), { ...args, recipes: ['cpmm-quiet-interval-v2'] } as never).finally(() => { spy.mockRestore(); seen.definition = undefined; });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.firstPrice).toBeUndefined();
});

it('(d) a merged simulation failing at the suffix is UNPRICEABLE before any prompt; a CREATE failure stays as it is', async () => {
  const { rpc, args } = await classicPool('raydium-clmm');
  const fail = (index: number) => () => new Sim({ instructionIndex: index, customCode: 54, programId: programId, outerProgramId: programId, mimirTag: 89, rejection: null, logs: [], errorKind: 'InstructionError' });
  let spy = capture((a) => { if (a.firstPrice) throw fail(1)(); }).spy;
  await expect(prepareV1SimpleFeed(deps(rpc), args as never).finally(() => spy.mockRestore())).rejects.toBeInstanceOf(UnpriceableFeedError);
  spy = capture((a) => { if (a.firstPrice) throw fail(0)(); }).spy;
  await expect(prepareV1SimpleFeed(deps(rpc), args as never).finally(() => spy.mockRestore())).rejects.toBeInstanceOf(Sim);
});

it('(e) a replacement whose suffix vector moved keeps the same CREATE intent', async () => {
  const mag5 = JSON.parse(gunzipSync(readFileSync('tests/create/fixtures/v1-mag5-replacement.json.gz')).toString('utf8'));
  const [prior, retry] = mag5.receipts;
  const suffix = (byte: number) => ({ programAddress: retry.reviewedStep.review.programId, accounts: [{ address: retry.reviewedStep.review.feed, isSigner: false, isWritable: true },
    { address: getAddressDecoder().decode(new Uint8Array(32).fill(byte)), isSigner: false, isWritable: false }], dataBase64: 'WQE=', dataSha256: '' });
  const withSuffix = (r: { reviewedStep: { review: { instructions: unknown[] } } }, byte: number) => ({ ...r.reviewedStep.review,
    instructions: [...r.reviewedStep.review.instructions, suffix(byte)], firstPrice: { instructionCount: 1 } });
  const ledger = { getTransaction: () => ({ send: async () => retry.signature ? mag5.successor : null }),
    getMultipleAccounts: (xs: string[]) => ({ send: async () => ({ context: { slot: 1525 }, value: xs.map((x) => mag5.accounts1525[x] ?? null) }) }),
    getSignatureStatuses: () => ({ send: async () => ({ context: { slot: 1525 }, value: [null] }) }),
    isBlockhashValid: () => ({ send: async () => ({ context: { slot: 1525 }, value: false }) }), getFirstAvailableBlock: () => ({ send: async () => 0n }) };
  const real = review.authenticateMimirBetaReviewedStep as (...a: any[]) => Promise<{ review: object }>;
  for (const [a, b] of [[3, 4], [3, 3]] as const) {
    const spy = vi.spyOn(review, 'authenticateMimirBetaReviewedStep').mockImplementation((async (r: { signature: string }) => {
      const lineage = await real(r); return { ...lineage, review: withSuffix(r as never, r.signature === prior.signature ? a : b) }; }) as never);
    const observed = observeV1Operation(ledger as never, mag5.receipts).finally(() => spy.mockRestore());
    await expect(observed.then(() => 'ok', (e: Error) => /not the same reviewed V1 CREATE/.test(e.message) ? 'refused' : 'ok')).resolves.toBe('ok');
  }
  const spy = vi.spyOn(review, 'authenticateMimirBetaReviewedStep').mockImplementation((async (r: { signature: string }) => {
    const lineage = await real(r); const changed = withSuffix(r as never, 3) as { instructions: { dataBase64: string }[] };
    return { ...lineage, review: r.signature === prior.signature ? changed : { ...changed, instructions: changed.instructions.map((ix, i) => i === 0 ? { ...ix, dataBase64: 'AA==' } : ix) } }; }) as never);
  await expect(observeV1Operation(ledger as never, mag5.receipts).finally(() => spy.mockRestore())).rejects.toThrow('not the same reviewed V1 CREATE');
});
