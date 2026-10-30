import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getAddressDecoder, getAddressEncoder, type Address } from '@solana/kit';
import { expect, it, vi } from './vitest.js';
import * as V1 from '../../src/v1/index.js';
import { mock } from 'node:test';
import { decodeMimirBetaCaptureCandidate, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID } from '../../src/beta/capture.js';
import type { MimirBetaEligiblePool } from '../../src/beta/discovery.js';
import { MimirBetaError } from '../../src/beta/errors.js';
import { mimirAutoClassicPolicy, mimirAutoCompositePolicy, mimirAutoPriceExponent } from '../../src/beta/params.js';
import * as Helpers from '../../src/create/helpers.js';
import * as Decoders from '../../src/v1/decoders.js';
import * as Build from '../../src/v1/build.js';
import * as TxV1 from '../../src/beta/transactionV1.js';
import { UnpriceableFeedError } from '../../src/create/errors.js';
import { makeBetaCaptureFixture } from '../fixtures/betaCaptureFixtures.js';
import { firstPriceFeed, freshFirstPrice, slotSamples } from './first-price-sim.js';
const { medianX64, readPoolPrices, USDC_QUOTE_MINT } = Helpers;

const seen = { widths: [] as number[][], solRows: 1, fail: null as Error | null,
  malformed: null as string | null, buildFail: false, compiles: 0, noPrices: false };
const at = (path: string) => new URL(path, import.meta.url).href;
mock.module(at('../../src/create/helpers.ts'), { namedExports: { ...Helpers,
  readPoolPrices: (...args: Parameters<typeof Helpers.readPoolPrices>) => seen.noPrices ? Promise.resolve(new Map()) : Helpers.readPoolPrices(...args) } });
mock.module(at('../../src/v1/decoders.ts'), { namedExports: { ...Decoders, decodeV1ClassicFeed: (...args: Parameters<typeof Decoders.decodeV1ClassicFeed>) => {
  if (args[1] === seen.malformed) throw new Error('malformed sol feed');
  const f = Decoders.decodeV1ClassicFeed(...args);
  const k = seen.solRows;
  return k === 1 || f.header.n !== 1 ? f : { ...f, header: { ...f.header, n: k }, rows: Array(k).fill({ ...f.rows[0]!, descriptor: { ...f.rows[0]!.descriptor, externalWidth: 8 } }), memberships: Array(k).fill(f.memberships[0]) };
} } });
mock.module(at('../../src/v1/build.ts'), { namedExports: { ...Build, buildMimirV1FusedClassicRefreshInstruction: (...args: Parameters<typeof Build.buildMimirV1FusedClassicRefreshInstruction>) => {
  if (seen.buildFail) throw new Error('builder failed');
  return Build.buildMimirV1FusedClassicRefreshInstruction(...args);
} } });
mock.module(at('../../src/beta/transactionV1.ts'), { namedExports: { ...TxV1, compileMimirBetaTransactionV1: (...args: Parameters<typeof TxV1.compileMimirBetaTransactionV1>) => {
  seen.compiles++;
  return TxV1.compileMimirBetaTransactionV1(...args);
} } });
let next = 1;
/** The app mocked web3.js `mimirV1RowVectors`; the moved code takes it as `deps.rowVectors`. */
const rowVectors = async (rows: readonly { descriptor: { externalWidth: number } }[]) => {
  if (seen.fail) throw seen.fail;
  seen.widths.push(rows.map((r) => r.descriptor.externalWidth));
  return rows.map((r) => Array.from({ length: r.descriptor.externalWidth }, () => {
    const b = new Uint8Array(32); new DataView(b.buffer).setUint32(0, next++); b[31] = 9; return getAddressDecoder().decode(b); }));
};
const { classicLiveGap, draftV1Classic, liveGapRefusal, prepareV1SimpleFeed, toleranceLine } = await import('../../src/create/v1-create.js');
type V1ClassicRefreshReads = import('../../src/create/v1-create.js').V1ClassicRefreshReads;

const addr = (byte: number): Address => getAddressDecoder().decode(Uint8Array.from({ length: 32 }, () => byte));
const TOKEN = MIMIR_BETA_SPL_TOKEN_PROGRAM_ID as Address;
/** The program id the app's vendored SDK carried (hMuPD): the specs sha below are the app's, byte for byte. */
const CLOSED_SPEC_PROGRAM_ID = 'hMuPDstPQEb5uaYc6d5N18Rz4srL1Bewc5fYibMimiR' as Address;
const programId = CLOSED_SPEC_PROGRAM_ID, payer = addr(50), cola = addr(51);
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
  const slices: unknown[] = [];
  return { slices, getSlot: () => ({ send: async () => 9n }), getRecentPerformanceSamples: slotSamples, simulateTransaction: freshFirstPrice, getAccountInfo: (x: Address, c?: { dataSlice?: unknown }) => ({ send: async () => { slices.push(c?.dataSlice); return { ...ctx, value: info(x) }; } }),
    getMultipleAccounts: (xs: readonly Address[], c?: { dataSlice?: unknown }) => ({ send: async () => { slices.push(c?.dataSlice); return { ...ctx, value: xs.map(info) }; } }), sendTransaction: vi.fn() };
}
const deployment = { mimirProgramId: programId, cluster: 'localnet', mplCoreProgramId: V1.MIMIR_V1_MPL_CORE_PROGRAM_ID };
const reach = { rpcUrl: 'http://127.0.0.1:8899', rowVectors };

const SOL = 'So11111111111111111111111111111111111111112' as Address;

type Family = 'raydium-clmm' | 'raydium-cpmm';
async function shape(families: Family | readonly Family[], n: number, solQuoted = false) {
  const store = new Map<Address, Acc>(), pools: MimirBetaEligiblePool[] = [];
  const [solFeed] = await V1.findMimirV1SolFeedPda(programId, USDC_QUOTE_MINT);
  if (solQuoted) {
    const bytes = new Uint8Array(readFileSync('tests/fixtures/layout_v1/classic/reference_usdc_cpmm_m0.bin'));
    bytes.set(getAddressEncoder().encode(solFeed), 48);
    bytes.set(getAddressEncoder().encode(await V1.deriveMimirV1ClassicFeedId(SOL, USDC_QUOTE_MINT, 0)), 16);
    const image = V1.decodeV1ClassicFeed(bytes).definition.feedImage;
    const at = bytes.findIndex((_, i) => image.every((b, j) => bytes[i + j] === b));
    bytes.set(getAddressEncoder().encode(SOL), at + 48);
    const d = V1.V1Layout.CLASSIC_ROWS + V1.V1Layout.ROW_DESCRIPTOR;
    bytes[d + V1.V1Layout.D_MODE] = 2; bytes[d + V1.V1Layout.D_ADAPTER_TYPE] = 1; bytes[d + V1.V1Layout.D_ADAPTER_VERSION] = 0;
    store.set(solFeed, { owner: programId, executable: false, data: bytes });
  }
  for (let i = 0; i < n; i++) {
    const family = typeof families === 'string' ? families : families[i]!;
    const fixture = await makeBetaCaptureFixture(family, { seed: typeof families === 'string' ? 11 + i : 11 + i * 7, ...(solQuoted ? { quoteMint: SOL, quoteDecimals: 9 } : {}) });
    const c = await decodeMimirBetaCaptureCandidate(fixture.input);
    pools.push({ eligibility: 'eligible', family, programId: c.programId, pool: c.pool, descriptorId: c.descriptorId,
      descriptorHash: c.descriptorHash, readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1,
      canonicalPairKey: c.canonicalPairKey, direction: 'quote-per-base', baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault,
      quoteVault: c.quoteVault, adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
      minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: 'a'.repeat(64), creation: fixture.creation } as MimirBetaEligiblePool);
    for (const x of fixture.fixtureAccounts) store.set(x.address, x);
    if (!store.has(c.baseMint)) store.set(c.baseMint, mint(9));
    if (!store.has(c.quoteMint)) store.set(c.quoteMint, mint(6));
  }
  const rpc = await chain(store);
  const args = { authority: payer, ticker: 'FIT', baseMint: pools[0]!.baseMint, quoteMint: pools[0]!.quoteMint, pools, policy,
    ...(solQuoted ? { solConversionSourceConfig: solFeed } : {}) } as never;
  return { rpc, args, store };
}

it('a Classic whose minimal first refresh locks more than 64 accounts is refused before any signature', async () => {
  const { rpc, args } = await shape('raydium-clmm', 4, true);
  seen.widths = []; seen.solRows = 5;
  const input = { ...args as object, allowCollateralFunding: true, refreshFitReads: new Map() } as never;
  const refused = await prepareV1SimpleFeed({ deployment, rpc, ...reach } as never, input).catch((e: unknown) => e);
  await expect(prepareV1SimpleFeed({ deployment, rpc, ...reach } as never, input)).rejects.toMatchObject({ code: 'TRANSACTION_TOO_LARGE' });
  expect(refused).toBeInstanceOf(MimirBetaError);
  expect((refused as MimirBetaError).code).toBe('TRANSACTION_TOO_LARGE');
  expect((refused as MimirBetaError).message).toContain('64 accounts');
  expect(seen.widths).toHaveLength(1);
  expect(seen.widths[0]!.reduce((a, b) => a + b, 0) + 5).toBe(73);
  expect(rpc.sendTransaction).not.toHaveBeenCalled();
  seen.solRows = 1;
});

const ixImage = (core: readonly { programAddress: string; accounts: readonly { address: string; isSigner: boolean; isWritable: boolean }[]; data: Uint8Array }[]) => core.map((ix) => [ix.programAddress, ix.accounts.map((m) => [m.address, m.isSigner, m.isWritable]), ix.data]);
/** The SDK's own CREATE for the policy the app sealed: the app passes it through unchanged. */
const sdkCore = async (rpc: object, args: object, d: Awaited<ReturnType<typeof draftV1Classic>>) => {
  const a = args as { baseMint: Address; quoteMint: Address; pools: MimirBetaEligiblePool[]; solConversionSourceConfig?: Address };
  const sdk = await V1.prepareMimirV1ClassicCreation(rpc as never, { programId, payer, ticker: 'FIT', baseMint: a.baseMint, quoteMint: a.quoteMint, pools: a.pools,
    policy: d.v1.policy, variant: d.v1.definition.variant, cluster: 'localnet', ...(a.solConversionSourceConfig ? { solFeed: a.solConversionSourceConfig } : {}) });
  return sha(ixImage(sdk.plan.instructions));
};
const sha = (x: unknown) => createHash('sha256').update(JSON.stringify(x, (_k, v) => typeof v === 'bigint' ? `${v}n` : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v)).digest('hex');
it.each([
  ['raydium-cpmm', 5, true, 'f22e77b0dfc74d09d0f9f5563b3b99cfb9a863b23d9a0d8c5b086d748773b47e', '7249534958b0b3b9a5eba54dc42500e07d4cf621b5726be6b9e40b3b200f75a5', 9043],
  ['raydium-clmm', 4, true, '85faeeb06c5e98011a4260165620b8928a1a6eb7141cbfc8566d81a949bb35ac', 'adc5991a46eb309ea3cd37d7feff44d6ecc6c0e53f3592693536d06d88c07224', 8095],
  ['raydium-clmm', 1, false, '1fa71b433f6019096cc8425d8f760fa3dfb24297bfaa0396986e63acda6a821d', '0d1349dc88e79c487dd723db8ab39754e212a4d5b0d1ba569e37a5bbd878bf4b', 2506]
] as const)('a %s N%i (SOL-quoted %s) Classic fits and its creation transaction is the SDK CREATE for the sealed auto policy', async (family, n, sol, _core, specs, exactLen) => {
  const { rpc, args } = await shape(family, n, sol);
  seen.widths = [];
  const guarded = await draftV1Classic({ deployment, rpc, ...reach } as never, args);
  expect(seen.widths).toHaveLength(1);
  expect(sha(ixImage(guarded.core))).toBe(await sdkCore(rpc, args, guarded));
  expect([guarded.v1.policy.maxSnapshotAgeSlots, guarded.v1.policy.maxSourceActivityAgeSlots, guarded.v1.policy.minCoverageRatioBps, guarded.v1.policy.maxDispersionBps])
    .toEqual([150, 65_535, 8_000, n > 1 ? 200 : 100]);
  expect(sha(guarded.specs)).toBe(specs);
  expect(guarded.v1.exactLen).toBe(exactLen);
});

it('a Classic whose refresh check fails is refused with that error, not as too large, before any signature', async () => {
  const { rpc, args } = await shape('raydium-clmm', 1);
  seen.fail = new Error('row read failed');
  const refused = await prepareV1SimpleFeed({ deployment, rpc, ...reach } as never, args).catch((e: unknown) => e);
  seen.fail = null;
  expect((refused as Error).message).toBe('PLAN_STALE:row read failed');
  expect((refused as MimirBetaError).code).not.toBe('TRANSACTION_TOO_LARGE');
  expect(rpc.sendTransaction).not.toHaveBeenCalled();
});

it.each(['malformed SOL feed', 'refresh builder exception'] as const)('a Classic whose %s fails the refresh check is refused with that error, before any compile or signature', async (kind) => {
  const { rpc, args } = await shape('raydium-clmm', 1, true);
  const [solFeed] = await V1.findMimirV1SolFeedPda(programId, USDC_QUOTE_MINT);
  if (kind === 'malformed SOL feed') seen.malformed = solFeed; else seen.buildFail = true;
  seen.compiles = 0;
  const refused = await prepareV1SimpleFeed({ deployment, rpc, ...reach } as never, args).catch((e: unknown) => e);
  seen.malformed = null; seen.buildFail = false;
  expect((refused as Error).message).toBe(kind === 'malformed SOL feed' ? 'PLAN_STALE:malformed sol feed' : 'PLAN_STALE:builder failed');
  expect((refused as MimirBetaError).code).not.toBe('TRANSACTION_TOO_LARGE');
  expect(seen.compiles).toBe(0);
  expect(rpc.sendTransaction).not.toHaveBeenCalled();
});

it('a SOL-quoted Classic prepares whatever the SOL feed snapshot says, without reading it', async () => {
  const [solFeed] = await V1.findMimirV1SolFeedPda(programId, USDC_QUOTE_MINT);
  const L = V1.V1Layout as unknown as Record<string, number>;
  for (const mutate of [(d: Uint8Array) => new DataView(d.buffer).setBigUint64(L.OFFSET_VALID_UNTIL_SLOT!, 1n, true),
    (d: Uint8Array) => { d[L.OFFSET_STATUS!] = 1; }, (d: Uint8Array) => { d[L.OFFSET_LB_PRICE_STATE!] = 2; }]) {
    const { rpc, args, store } = await shape('raydium-clmm', 4, true);
    mutate(store.get(solFeed)!.data);
    seen.widths = [];
    const guarded = await draftV1Classic({ deployment, rpc, ...reach } as never, args);
    expect(sha(ixImage(guarded.core))).toBe(await sdkCore(rpc, args, guarded));
    expect(rpc.slices.every((slice) => slice === undefined)).toBe(true);
  }
});

const CPMM_N5: Family[] = ['raydium-clmm', 'raydium-clmm', 'raydium-clmm', 'raydium-clmm', 'raydium-cpmm'];
it('an N5 Classic with a Raydium CPMM row too large to create is refused with the too-many-sources copy, not the generic one', async () => {
  const { rpc, args } = await shape(CPMM_N5, 5);
  const refused = await prepareV1SimpleFeed({ deployment, rpc, ...reach } as never, args).catch((e: unknown) => e);
  expect((refused as MimirBetaError).code).toBe('CREATION_TOO_LARGE');
  expect(rpc.sendTransaction).not.toHaveBeenCalled();
});

it('a refresh check failure that is not a typed SDK or network error is refused as moved prices, never the generic copy', async () => {
  const { rpc, args } = await shape('raydium-clmm', 1);
  seen.fail = new RangeError('offset out of range');
  const refused = await prepareV1SimpleFeed({ deployment, rpc, ...reach } as never, args).catch((e: unknown) => e);
  seen.fail = null;
  expect((refused as MimirBetaError).code).toBe('PLAN_STALE');
  expect(rpc.sendTransaction).not.toHaveBeenCalled();
});

it('one SOL-funded preparation reuses validated refresh reads across preflight, funding and creation, but still compiles every shape', async () => {
  const { rpc, args } = await shape('raydium-clmm', 1, true);
  const [solFeed] = await V1.findMimirV1SolFeedPda(programId, USDC_QUOTE_MINT);
  const reads: V1ClassicRefreshReads = new Map();
  const accountRead = vi.spyOn(rpc, 'getMultipleAccounts');
  seen.widths = []; seen.compiles = 0;
  const input = { ...args as object, allowCollateralFunding: true, refreshFitReads: reads } as never;
  for (let phase = 0; phase < 3; phase++) await draftV1Classic({ deployment, rpc, ...reach } as never, input);
  expect(seen.widths).toHaveLength(1);
  expect(seen.compiles).toBe(3);
  expect(accountRead.mock.calls.filter(([xs]) => xs.length === 1 && xs[0] === solFeed)).toHaveLength(0);
  await draftV1Classic({ deployment, rpc, ...reach } as never, { ...input as object, refreshFitReads: new Map() } as never);
  expect(seen.widths).toHaveLength(2);
  const laterRpc = new Proxy(rpc, { get(target, key) {
    const method = Reflect.get(target, key);
    if (typeof method !== 'function' || key === 'sendTransaction') return method;
    return (...params: unknown[]) => ({ send: async () => {
      const result = await (Reflect.apply(method, target, params) as { send(): Promise<object> }).send();
      return key === 'getSlot' ? 10n : { ...result, context: { slot: 10n } };
    } });
  } });
  await draftV1Classic({ deployment, rpc: laterRpc, ...reach } as never, input);
  expect(seen.widths).toHaveLength(3);
});

const simulated = (value: object) => (_wire: string, c?: { minContextSlot?: bigint }) => ({ send: async () => ({ context: { slot: c?.minContextSlot ?? 9n }, value }) });
it('the first-price gate refuses a Classic whose CREATE + first refresh is not Fresh before any approval, naming metric, value and limit', async () => {
  const { rpc, args } = await shape('raydium-clmm', 2);
  const d = await draftV1Classic({ deployment, rpc, ...reach } as never, args);
  const r = rpc as unknown as { simulateTransaction: unknown };
  const degraded = firstPriceFeed(d.v1.feed, 0n, 1);
  new DataView(degraded.buffer).setUint16(180, 3, true); degraded[186] = 1; new DataView(degraded.buffer).setUint16(250, 250, true);
  r.simulateTransaction = simulated({ err: null, accounts: [{ data: [Buffer.from(degraded).toString('base64'), 'base64'] }] });
  const refused = await d.gate().catch((e: unknown) => e);
  expect(refused).toBeInstanceOf(UnpriceableFeedError);
  expect((refused as Error).message).toBe(`FIT: pools 2.5% from their median · limit ${d.v1.policy.maxDispersionBps / 100}%. Choose other pools. Nothing was sent.`);
  degraded.fill(0, 250, 252);
  r.simulateTransaction = simulated({ err: null, accounts: [{ data: [Buffer.from(degraded).toString('base64'), 'base64'] }] });
  await expect(d.gate()).rejects.toThrow('FIT: its first price would not be fresh (conditions 3, rows 1). Choose other pools. Nothing was sent.');
  // TxV1 folds the ComputeBudget instruction into its config: the compiled message is [...core, refresh].
  r.simulateTransaction = simulated({ err: { InstructionError: [d.core.length, { Custom: 15 }] }, logs: [] });
  await expect(d.gate()).rejects.toThrow(/^FIT: its first price fails \(15\)\. Choose other pools/);
  r.simulateTransaction = simulated({ err: null, accounts: [null] });
  await expect(d.gate()).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
  r.simulateTransaction = simulated({ err: { InstructionError: [d.core.length - 1, { Custom: 1 }] }, logs: [] });
  await expect(d.gate()).resolves.toMatchObject({ instruction: { data: expect.any(Uint8Array) }, rows: 2 });
  expect(rpc.sendTransaction).not.toHaveBeenCalled();
});

it('the live gap counts one pool per venue group, against the equal-weight median; the observed price sets the exponent', async () => {
  const p = (pool: string, family: string, depth = 1n) => ({ pool, family, minDepthTo50BpsNative: depth }) as never;
  const x64 = (v: number) => BigInt(Math.round(v * 1e6)) * (1n << 64n) / 1_000_000n;
  const gap = classicLiveGap([p('o', 'orca-whirlpool'), p('r', 'raydium-clmm')], new Map([['o', x64(1)], ['r', x64(1.042)]]))!;
  expect([gap.venues, gap.low, gap.high, gap.apartBps, gap.dispersionBps]).toEqual([2, 'Orca', 'Raydium', 419, 205]);
  expect(classicLiveGap([p('r1', 'raydium-clmm', 5n), p('r2', 'raydium-cpmm', 9n)], new Map([['r1', x64(1)], ['r2', x64(1.5)]]))!.dispersionBps).toBe(0);
  // The program keeps the Raydium pool with the lower live economic floor, known only at refresh: the cap covers either pick, the refusal needs both.
  const either = classicLiveGap([p('o', 'orca-whirlpool'), p('r1', 'raydium-clmm', 5n), p('r2', 'raydium-cpmm', 9n)], new Map([['o', x64(1)], ['r1', x64(1)], ['r2', x64(1.5)]]))!;
  expect([either.dispersionBps, either.narrowest.dispersionBps]).toEqual([2_000, 0]);
  const far = classicLiveGap([p('o', 'orca-whirlpool'), p('r', 'raydium-clmm'), p('m', 'meteora-dlmm')], new Map([['o', x64(1)], ['r', x64(1.5)], ['m', x64(4)]]))!;
  expect(liveGapRefusal('FIT', far.narrowest, 10_000)).toBe('FIT: the Orca and Meteora pools are 300% apart, 166.66% from their median · limit 100%. Use one pool, or pools that agree. Nothing was sent.');
  const { rpc, args, store } = await shape('raydium-clmm', 1);
  const d = await draftV1Classic({ deployment, rpc, ...reach } as never, args);
  const prices = await readPoolPrices((args as { pools: MimirBetaEligiblePool[] }).pools, async (xs) => xs.map((x) => store.get(x) ?? null));
  expect(d.v1.policy.priceExponent).toBe(mimirAutoPriceExponent(Number(medianX64([...prices.values()])) / 2 ** 64));
});

it('with no pool price read, the exponent stays the runtime default and the review line says so', async () => {
  const { rpc, args } = await shape('raydium-clmm', 1);
  seen.noPrices = true;
  const d = await draftV1Classic({ deployment, rpc, ...reach } as never, args).finally(() => { seen.noPrices = false; });
  expect([d.v1.policy.priceExponent, d.priced]).toEqual([-8, false]);
  expect(toleranceLine('feed', 100, 100, [], -8)).toBe('Tolerance: spread 1% · confidence 1%. Price exponent -8: no pool price could be read.');
});

it('the review line shows the sealed limits and who widened them', () => {
  expect(toleranceLine('feed', 100, 100, [])).toBe('Tolerance: spread 1% · confidence 1%.');
  const pool = (i: number) => getAddressDecoder().decode(new Uint8Array(32).fill(i + 1));
  const bytes = (offset: number, value: number) => { const d = new Uint8Array(300); new DataView(d.buffer).setUint16(offset, value, true); return d; };
  const dlmm = (i: number, binStep: number) => ({ family: 'meteora-dlmm' as const, pool: pool(i), poolData: bytes(80, binStep) });
  const clmm = (i: number, tickSpacing: number) => ({ family: 'raydium-clmm' as const, pool: pool(i), poolData: bytes(235, tickSpacing) });
  const index = (rows: ReturnType<typeof dlmm | typeof clmm>[], names: string[], converter?: { sourceConfig: Address; rows: []; maxConfidenceBps: number; maxDispersionBps: number }) => {
    const { policy, widenedBy } = mimirAutoCompositePolicy({ slotMs: 400, priceExponent: -8, ...(converter ? { converter } : {}), rows: rows.map((row, i) => ({ ...row, position: i + 1,
      sourceConfig: pool(90 + i), child: { maxConfidenceBps: Math.max(100, ...widenedOf(row)), maxSourceActivityAgeSlots: 150 } })) });
    return toleranceLine('index', policy.maxComponentDispersionBps, policy.maxComponentConfidenceBps, widenedBy.map((w) => ({ who: `${names[w.position - 1]}'s pool`, requiredBps: w.requiredBps, capBps: w.capBps })));
  };
  const widenedOf = (row: ReturnType<typeof dlmm | typeof clmm>) => mimirAutoClassicPolicy({ rows: [row], slotMs: 400, base }).widenedBy.map((w) => w.capBps);
  const base = { profile: 0, riskTier: 1, priceExponent: -8, anchorPolicyHash: new Uint8Array(32), nativeExceptionHash: new Uint8Array(32) };
  expect(index([256, 120, 125, 400].map((b, i) => dlmm(i, b)), ['PERPSPAD', 'PEAQ', 'W1PNG', 'GTA']))
    .toBe("Tolerance: spread 5% · confidence 5%. GTA's pool widens this index's tolerance to 5%.");
  expect(index([dlmm(0, 400), dlmm(1, 400), clmm(2, 1)], ['GTA', 'TIE', 'NARROW']))
    .toBe("Tolerance: spread 5% · confidence 5%. GTA's pool and TIE's pool widen this index's tolerance to 5%.");
  expect(index([clmm(0, 120), clmm(1, 1)], ['HOODX', 'NARROW'])).toBe("Tolerance: spread 1.5% · confidence 1%. HOODX's pool widens this index's tolerance to 1.5%.");
  expect(index([dlmm(0, 120), clmm(1, 1)], ['SMALL', 'NARROW'], { sourceConfig: pool(80), rows: [], maxConfidenceBps: 300, maxDispersionBps: 100 }))
    .toBe('Tolerance: spread 1.5% · confidence 3%.');
  expect(index([clmm(0, 400), dlmm(1, 240)], ['WIDE', 'SMALL'])).toBe("Tolerance: spread 5% · confidence 3%. WIDE's pool widens this index's tolerance to 5%.");
  const classic = (row: ReturnType<typeof dlmm>) => { const { policy, widenedBy } = mimirAutoClassicPolicy({ rows: [row], slotMs: 400, base });
    return toleranceLine('feed', policy.maxDispersionBps, policy.maxConfidenceBps, widenedBy.map((w) => ({ who: 'The Meteora DLMM pool', requiredBps: w.requiredBps, capBps: w.capBps }))); };
  expect(classic(dlmm(0, 400))).toBe("Tolerance: spread 1% · confidence 5%. The Meteora DLMM pool widens this feed's tolerance to 5%.");
  expect(classic({ ...dlmm(0, 120), recipe: 'native-bounded' } as never)).toBe('Tolerance: spread 1% · confidence 3%.');
});
