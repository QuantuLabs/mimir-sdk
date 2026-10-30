import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { getAddressDecoder, getAddressEncoder, type Address } from '@solana/kit';
import { expect, it, vi } from './vitest.js';
import * as V1 from '../../src/v1/index.js';
import { decodeMimirBetaCaptureCandidate, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, type MimirBetaEligiblePool } from '../../src/beta/index.js';
import { draftV1Classic, draftV1Composite, prepareV1CompositeFeed, prepareV1CompositeFeedJourney, prepareV1SimpleFeed } from '../../src/create/v1-create.js';
import { getCompiledTransactionMessageDecoder } from '@solana/transaction-messages';
import * as beta from '../../src/beta/index.js';
import { ReviewIntentChangedError } from '../../src/create/errors.js';
import { SolCreationContext } from '../../src/create/creation-context.js';
import { RENT_SYSVAR } from '../../src/create/helpers.js';
import { USDC_QUOTE_MINT } from '../../src/create/helpers.js';
import { makeBetaCaptureFixture } from '../fixtures/betaCaptureFixtures.js';
import { gateOr } from './first-price-sim.js';
let next = 1;
const rowVectors = async (rows: readonly { descriptor: { externalWidth: number } }[]) =>
    rows.map((r) => Array.from({ length: r.descriptor.externalWidth }, () => {
      const b = new Uint8Array(32); new DataView(b.buffer).setUint32(0, next++); b[31] = 9; return getAddressDecoder().decode(b); }));

const addr = (byte: number): Address => getAddressDecoder().decode(Uint8Array.from({ length: 32 }, () => byte));
const TOKEN = MIMIR_BETA_SPL_TOKEN_PROGRAM_ID as Address;
const paid = JSON.parse(gunzipSync(readFileSync('tests/create/fixtures/v1-mag5-replacement.json.gz')).toString('utf8'));
const paidReview = paid.receipts[1].reviewedStep.review;
const programId = paidReview.programId as Address, payer = paidReview.authority as Address, cola = addr(51);
const policy = { profile: 0, riskTier: 1, priceExponent: -8, maxDispersionBps: 100, maxSourceActivityAgeSlots: 150, minCoverageRatioBps: 10_000,
  maxConfidenceBps: 500, maxSnapshotAgeSlots: 150, anchorPolicyHash: new Uint8Array(32).fill(7), nativeExceptionHash: new Uint8Array(32).fill(8) };
const compositePolicy = { priceExponent: -8, maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150, maxComponentConfidenceBps: 500, maxComponentDispersionBps: 100 };
const FULL_SOL = { allowCollateralFunding: true, estimateFundingCosts: true, fullCollateralPurchase: true };
type Acc = { owner: Address; executable: boolean; data: Uint8Array };
const mint = (decimals: number): Acc => { const d = new Uint8Array(82); d[44] = decimals; d[45] = 1; return { owner: TOKEN, executable: false, data: d }; };

/** Admin: COLA base 1000 raw, tiers [150,30,5,2] tenths (4 chars = 500 raw, 5+ = 200, 1 char = 0); rent sysvar at 3480 lamports/byte-year x2. */
async function chain(store: Map<Address, Acc>, balance: bigint | null, archive = false) {
  const [admin] = await V1.findMimirV1AdminConfigPda(programId), [registry] = await V1.findMimirV1RegistryPda(programId);
  const a = new Uint8Array(192), av = new DataView(a.buffer);
  a.set(new TextEncoder().encode('MIMIRCFG')); av.setUint16(8, 1, true); av.setUint16(10, 192, true); a[12] = 1; a[13] = 255;
  a.fill(1, 16, 48); a.set(new Uint8Array(32).fill(51), 48); av.setBigUint64(80, 1_000n, true); a[88] = 1; a[89] = 3;
  av.setUint32(104, 11, true); av.setUint32(108, 13, true); av.setUint32(112, 17, true);
  a.set([150, 30, 5, 2], 116); a.set(getAddressEncoder().encode((await V1.findMimirV1TreasuryPda(programId))[0]), 120); av.setBigUint64(152, 1n, true); a.fill(3, 160, 192);
  const r = new Uint8Array(128), rv = new DataView(r.buffer);
  r.set(new TextEncoder().encode('MIMIRREG')); rv.setUint16(10, 128, true); r.fill(4, 16, 48); rv.setBigUint64(96, 3n, true);
  store.set(admin, { owner: programId, executable: false, data: a }); store.set(registry, { owner: programId, executable: false, data: r });
  store.set(cola, mint(6));
  const rent = new Uint8Array(17), rentView = new DataView(rent.buffer);
  rentView.setBigUint64(0, 3_480n, true); rentView.setFloat64(8, 2, true);
  store.set(RENT_SYSVAR, { owner: addr(6), executable: false, data: rent });
  const [ata] = await V1.findMimirV1AssociatedTokenAddress(payer, cola);
  if (balance !== null) {
    const t = new Uint8Array(165), tv = new DataView(t.buffer);
    t.set(getAddressEncoder().encode(cola), 0); t.set(getAddressEncoder().encode(payer), 32); tv.setBigUint64(64, balance, true); t[108] = 1;
    store.set(ata, { owner: TOKEN, executable: false, data: t });
  }
  const info = (x: Address) => { const v = store.get(x); return v ? { owner: v.owner, executable: v.executable, lamports: 1n, rentEpoch: 0n,
    space: BigInt(v.data.length), data: [Buffer.from(v.data).toString('base64'), 'base64'] } : null; };
  const ctx = { context: { slot: 1525n } };
  return { ata, rpc: { getSlot: () => ({ send: async () => 1525n }), getRecentPerformanceSamples: () => ({ send: async () => [{ numSlots: 120, samplePeriodSecs: 60 }] }), getAccountInfo: (x: Address) => ({ send: async () => ({ ...ctx, value: info(x) }) }),
    getTransaction: (signature: string) => ({ send: async () => signature === paid.receipts[1].signature ? paid.successor : null }),
    isBlockhashValid: () => ({ send: async () => ({ ...ctx, value: false }) }),
    getSignatureStatuses: () => ({ send: async () => ({ ...ctx, value: [null] }) }),
    getFirstAvailableBlock: () => ({ send: async () => 0n }),
    getLatestBlockhash: () => ({ send: async () => ({ ...ctx, value: { blockhash: addr(90), lastValidBlockHeight: 100n } }) }),
    getFeeForMessage: () => ({ send: async () => ({ ...ctx, value: 5000n }) }),
    simulateTransaction: gateOr(() => ({ send: async () => { throw new Error('RPC simulation reached'); } })),
    getMultipleAccounts: (xs: readonly Address[]) => ({ send: async () => ({ ...ctx, value: xs.map((x) => archive && paid.accounts1525[x] ? paid.accounts1525[x] : info(x)) }) }) } };
}
const deps = (rpc: object) => ({ deployment: { mimirProgramId: programId, cluster: 'mainnet-beta', mplCoreProgramId: V1.MIMIR_V1_MPL_CORE_PROGRAM_ID }, rpc, rpcUrl: 'http://127.0.0.1:8899', rowVectors }) as never;

async function classicCase(seed: number, baseMint?: Address, family: 'raydium-clmm' | 'meteora-dlmm' = 'raydium-clmm') {
  const fixture = await makeBetaCaptureFixture(family, { seed, quoteMint: USDC_QUOTE_MINT, ...(baseMint ? { baseMint } : {}) });
  const c = await decodeMimirBetaCaptureCandidate(fixture.input);
  const pool = { eligibility: 'eligible', family, programId: c.programId, pool: c.pool, descriptorId: c.descriptorId,
    descriptorHash: c.descriptorHash, readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1,
    canonicalPairKey: c.canonicalPairKey, direction: 'quote-per-base', baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault,
    quoteVault: c.quoteVault, adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
    minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: 'a'.repeat(64), creation: fixture.creation } as MimirBetaEligiblePool;
  const store = new Map<Address, Acc>(fixture.fixtureAccounts.map((x) => [x.address, x]));
  if (!store.has(c.baseMint)) store.set(c.baseMint, mint(9));
  if (!store.has(c.quoteMint)) store.set(c.quoteMint, mint(6));
  return { c, pool, store };
}

async function classicAt(store: Map<Address, Acc>, feedId: Address) {
  const bytes = new Uint8Array(readFileSync('tests/fixtures/layout_v1/classic/reference_usdc_cpmm_m0.bin'));
  const [feed] = await V1.findMimirV1ClassicFeedPda(programId, feedId);
  bytes.set(getAddressEncoder().encode(feed), 48); bytes.set(getAddressEncoder().encode(feedId), 16);
  store.set(feed, { owner: programId, executable: false, data: bytes });
}

const facts = async (p: Promise<unknown>) => {
  const error = await p.then(() => undefined, (e: unknown) => e) as beta.MimirBetaCollateralRequiredError | undefined;
  expect(error?.code, error?.message).toBe('COLLATERAL_REQUIRED');
  expect(error).toBeInstanceOf(beta.MimirBetaCollateralRequiredError);
  return error!;
};

it.each([['absent', null], ['zero', 0n], ['partial', 200n], ['sufficient', 10_000n]] as const)(
  'APP-SOL-01 Classic full-SOL intent with %s COLA buys the whole tariff and never reaches a burn of wallet COLA', async (_, balance) => {
  const { c, pool, store } = await classicCase(21);
  const { ata, rpc } = await chain(store, balance);
  const error = await facts(prepareV1SimpleFeed(deps(rpc), { authority: payer, ticker: 'SOLX', baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool],
    policy, creatorCollateralTokenAccount: ata, ...FULL_SOL } as never));
  expect(error).toMatchObject({ authority: payer, mint: cola, tokenAccount: ata, decimals: 6, requiredAmountRaw: 500n, balanceRaw: balance ?? 0n,
    shortfallRaw: 500n, accountMissing: balance === null, resolvedVariant: 1, selectedPools: [pool] });
  expect(error.fundingCosts!.totalLamports).toBeGreaterThan(19_000n);
  expect(error.fundingCosts!.observedSlot).toBeGreaterThanOrEqual(error.observedSlot);
});

it('APP-SOL-01 Classic: full SOL funding cannot be bypassed by a caller prefix; shortfall funding and one char is exempt', async () => {
  const { c, pool, store } = await classicCase(22);
  const { ata, rpc } = await chain(store, 200n);
  const args = { authority: payer, baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool], policy, creatorCollateralTokenAccount: ata };
  const callerPrefix = { instructions: [], maxAuthorityDebitLamports: 1n, funding: { tokenAccount: ata, minimumCreditRaw: 500n, coversBurn: true } };
  expect(await facts(prepareV1SimpleFeed(deps(rpc), { ...args, ticker: 'SOLX', ...FULL_SOL, callerPrefix } as never))).toMatchObject({ requiredAmountRaw: 500n, shortfallRaw: 500n });
  const partial = await facts(prepareV1SimpleFeed(deps(rpc), { ...args, ticker: 'SOLX', allowCollateralFunding: true, estimateFundingCosts: true } as never));
  expect(partial).toMatchObject({ requiredAmountRaw: 500n, balanceRaw: 200n, shortfallRaw: 300n });
  await expect(prepareV1SimpleFeed(deps(rpc), { ...args, ticker: 'S', ...FULL_SOL } as never)).rejects.toThrow('RPC simulation reached');
});

it('the post-swap classic review reuses the pre-swap draft: one draft per journey', async () => {
  const { c, pool, store } = await classicCase(21);
  const { ata, rpc } = await chain(store, null);
  const args = { authority: payer, ticker: 'SOLX', baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool], policy, creatorCollateralTokenAccount: ata };
  let drafts = 0;
  const counted = { ...(deps(rpc) as object), rowVectors: (...a: Parameters<typeof rowVectors>) => { drafts += 1; return rowVectors(...a); } } as never;
  await facts(prepareV1SimpleFeed(counted, { ...args, ...FULL_SOL } as never));
  const t = new Uint8Array(165), tv = new DataView(t.buffer);
  t.set(getAddressEncoder().encode(cola), 0); t.set(getAddressEncoder().encode(payer), 32); tv.setBigUint64(64, 500n, true); t[108] = 1;
  store.set(ata, { owner: TOKEN, executable: false, data: t });
  const after = { ...args, allowCollateralFunding: true, estimateFundingCosts: true, fullCollateralPurchase: false, reusePurchaseDraft: true };
  const first = drafts;
  await expect(prepareV1SimpleFeed(counted, after as never)).rejects.toThrow('RPC simulation reached');
  expect(drafts).toBe(first);
  await expect(prepareV1SimpleFeed(counted, after as never)).rejects.toThrow('RPC simulation reached');
  expect(drafts).toBeGreaterThan(first);
});

it('APP-SOL-01 Composite with the current priced revision under the full-SOL intent returns typed funding facts', async () => {
  const store = new Map<Address, Acc>();
  for (const id of [addr(60), addr(61)]) await classicAt(store, id);
  const { ata, rpc } = await chain(store, 10_000n);
  const error = await facts(prepareV1CompositeFeed(deps(rpc), { authority: payer, ticker: 'PAIR', quoteMint: USDC_QUOTE_MINT, displayName: '',
    policy: compositePolicy, creatorCollateralTokenAccount: ata, components: [addr(60), addr(61)].map((feedId) => ({ feedId, quantityX64: 1n << 64n })),
    pricedAdmin: { configRevision: 1n, collateralAmountRaw: 1_000n, tickerTierTenths: [150, 30, 5, 2] }, ...FULL_SOL } as never));
  expect(error).toMatchObject({ requiredAmountRaw: 500n, balanceRaw: 10_000n, shortfallRaw: 500n });
  expect(error.fundingCosts!.protocolFeeLamports).toBeGreaterThan(0n);
});

it('APP-SOL-01 staged composite with a paid child prices only the remaining root and carries the journey preview', async () => {
  const account = paid.accounts1525[paidReview.feed];
  const data = new Uint8Array(Buffer.from(account.data[0], 'base64'));
  const child = V1.decodeV1ClassicFeed(data, paidReview.feed);
  const baseMint = getAddressDecoder().decode(child.definition.feedImage.subarray(V1.V1Layout.CFG_OFFSET_BASE_MINT, V1.V1Layout.CFG_OFFSET_BASE_MINT + 32));
  const { c, pool, store } = await classicCase(23, baseMint);
  let variant = 1;
  while (variant < 100 && await V1.deriveMimirV1ClassicFeedId(c.baseMint, c.quoteMint, variant) !== paidReview.feedId) variant++;
  expect(variant).toBeLessThan(100);
  store.set(paidReview.feed, { owner: programId, executable: false, data });
  // The paid child's own CLMM pool, read for the root's component caps.
  store.set(getAddressDecoder().decode(child.rows[0]!.source.subarray(V1.V1Layout.SRC_OFFSET_POOL_OR_MARKET, V1.V1Layout.SRC_OFFSET_POOL_OR_MARKET + 32)), store.get(pool.pool)!);
  await classicAt(store, addr(66));
  const { ata, rpc } = await chain(store, 10_000n, true);
  const input = { authority: payer, ticker: 'ROOTB', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy, identity: { asset: addr(73), agentUri: '' },
    creatorCollateralTokenAccount: ata, components: [
      { feedId: addr(67), sourceConfig: addr(68), quantityX64: 1n << 64n, createClassic: { baseMint: c.baseMint, ticker: 'KIDB', pool, policy,
        identity: { asset: addr(74), agentUri: '' } } },
      { feedId: addr(66), sourceConfig: (await V1.findMimirV1SourceConfigAddress(programId, addr(66), 0))[0], quantityX64: 1n << 64n }] };
  const fresh = await facts(prepareV1CompositeFeedJourney(deps(rpc), { input: { ...input, ...FULL_SOL } } as never, rpc as never));
  expect(fresh).toMatchObject({ requiredAmountRaw: 700n, shortfallRaw: 700n });
  expect(fresh.compositeJourney!.intentHash).toBe(fresh.draftHash);
  expect(fresh.compositeJourney!.state.operations.map((o) => o.operationId)).toEqual(['child:0', 'root']);
  expect(fresh.fundingCosts!.networkFeeLamports).toBe(13_000n);
  const state = { schema: 'mimir-beta-composite-journey-state', version: 1, intentHash: fresh.draftHash, inputRevision: 0, operations: [
    { operationId: 'child:0', definitionHash: '', identity: input.components[0]!.createClassic!.identity,
      canonicalDraftJson: (await beta.createDraftHash({ variant })).canonicalDraftJson, receipts: paid.receipts }] };
  const staged = await facts(prepareV1CompositeFeedJourney(deps(rpc), { input: { ...input, ...FULL_SOL }, state } as never, rpc as never));
  expect(staged).toMatchObject({ requiredAmountRaw: 200n, balanceRaw: 10_000n, shortfallRaw: 200n });
  expect(staged.compositeJourney!.packets.map((p) => p.operationId)).toEqual(['root']);
  expect(staged.fundingCosts!.networkFeeLamports).toBe(6_500n);
  expect(staged.fundingCosts!.totalLamports).toBeLessThan(fresh.fundingCosts!.totalLamports);
  await expect(prepareV1CompositeFeedJourney(deps(rpc), { input: { ...input, allowCollateralFunding: true, estimateFundingCosts: true }, state } as never, rpc as never)).rejects.toThrow('RPC simulation reached');
});

it.each(['localnet', 'devnet'] as const)('APP-SOL-01 keeps the %s COLA route on the original review path', async (cluster) => {
  const { c, pool, store } = await classicCase(24);
  const { ata, rpc } = await chain(store, 10_000n);
  const dependencies = { ...deps(rpc) as object, deployment: { mimirProgramId: programId, cluster, mplCoreProgramId: V1.MIMIR_V1_MPL_CORE_PROGRAM_ID } } as never;
  await expect(prepareV1SimpleFeed(dependencies, { authority: payer, ticker: 'COLAX', baseMint: c.baseMint, quoteMint: c.quoteMint,
    pools: [pool], policy, creatorCollateralTokenAccount: ata } as never)).rejects.toThrow('RPC simulation reached');
});

it.each(['direct', 'staged'] as const)('APP-SOL-MAX-01: %s composite refuses a known stale priced revision before SOL purchase dispatch', async (route) => {
  const store = new Map<Address, Acc>();
  for (const id of [addr(60), addr(61)]) await classicAt(store, id);
  const { ata, rpc } = await chain(store, 10_000n);
  const [adminKey] = await V1.findMimirV1AdminConfigPda(programId);
  const view = new DataView(store.get(adminKey)!.data.buffer);
  view.setBigUint64(152, 2n, true);
  view.setUint8(118, 50); // PAIR now requires 5000 raw rather than 500.
  for (const at of [104, 108, 112]) view.setUint32(at, 100_000_000, true);
  const pricedAdmin = { configRevision: 1n, collateralAmountRaw: 1_000n, tickerTierTenths: [150, 30, 5, 2] };
  const input = { authority: payer, ticker: 'PAIR', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy,
    identity: { asset: addr(73), agentUri: '' }, creatorCollateralTokenAccount: ata,
    components: [addr(60), addr(61)].map((feedId) => ({ feedId, quantityX64: 1n << 64n })), pricedAdmin, ...FULL_SOL };
  const p = route === 'direct' ? prepareV1CompositeFeed(deps(rpc), input as never)
    : prepareV1CompositeFeedJourney(deps(rpc), { input } as never, rpc as never);
  const error = await p.then(() => undefined, (e: unknown) => e) as beta.MimirBetaCollateralRequiredError | undefined;
  expect(error).toBeInstanceOf(ReviewIntentChangedError);
  expect(error?.code, 'Known chain revision 2 must not dispatch purchase priced at revision 1').not.toBe('COLLATERAL_REQUIRED');
});

// Risk/decision: an older child read must not fund a newer quoted/root frame; otherwise
// the purchase succeeds short of the burns that the subsequent fresh child reviews require.
it.each(['coherent', 'coherent-fallback', 'lagged-child', 'lagged-child-fallback', 'lagged-root-fallback', 'changed-mint', 'changed-quote', 'lagged-balance', 'lagged-rent', 'lagged-fee'] as const)('sibling frame review: %s child/root pricing', async (mode) => {
  const children = await Promise.all([41, 42].map((seed) => classicCase(seed, addr(seed + 100))));
  const store = new Map(children.flatMap((x) => [...x.store]));
  const { ata, rpc: base } = await chain(store, 10_000n);
  const [adminKey] = await V1.findMimirV1AdminConfigPda(programId);
  store.set(addr(52), mint(6));
  const old = new Uint8Array(store.get(adminKey)!.data);
  const live = store.get(adminKey)!.data, v = new DataView(live.buffer);
  v.setBigUint64(152, 2n, true); v.setUint8(118, 50); // every 4-char creation costs 5000 raw
  let reads = 0;
  const trace: { read: number; revision: string; slot: string; requestedMinimum: string | null }[] = [];
  const packetBurns: string[] = [];
  const rpc = { ...base, getFeeForMessage: (message: string) => ({ send: async () => {
    expect(getCompiledTransactionMessageDecoder().decode(new Uint8Array(Buffer.from(message, 'base64'))).version).toBe(0);
    packetBurns.push(message);
    const fee = await base.getFeeForMessage().send();
    return mode === 'lagged-fee' ? { ...fee, context: { slot: 1524n } } : fee;
  } }), getMultipleAccounts: (xs: readonly Address[], ...config: unknown[]) => ({ send: async () => {
    const result = await base.getMultipleAccounts(xs).send();
    if (xs.includes(adminKey)) {
      reads++;
      const lagged = mode === 'lagged-root-fallback' || mode.startsWith('lagged-child') && reads === 1;
      if (mode === 'changed-mint' && reads === 1) {
        const other = new Uint8Array(live); other.set(getAddressEncoder().encode(addr(52)), 48);
        result.value[xs.indexOf(adminKey)]!.data = [Buffer.from(other).toString('base64'), 'base64'];
      }
      const slot = lagged ? 1524n : 1525n;
      if (lagged) result.value[xs.indexOf(adminKey)]!.data = [Buffer.from(old).toString('base64'), 'base64'];
      result.context = { slot };
      const minimum = (config[0] as { minContextSlot?: bigint } | undefined)?.minContextSlot;
      // Deliberately return stale evidence even when the new fence requests a newer bank.
      trace.push({ read: reads, revision: lagged ? '1' : '2', slot: slot.toString(), requestedMinimum: minimum?.toString() ?? null });
    }
    if (mode === 'lagged-balance' && xs.length === 1 && xs[0] === ata || mode === 'lagged-rent' && xs.includes(RENT_SYSVAR)) {
      result.context = { slot: 1524n };
    }
    return result;
  } }) };
  const input = { authority: payer, ticker: 'ROOT', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy,
    identity: { asset: addr(73), agentUri: '' }, creatorCollateralTokenAccount: ata, ...FULL_SOL,
    ...(mode.endsWith('fallback') ? {} : { pricedAdmin: { configRevision: 2n, collateralAmountRaw: 1_000n, tickerTierTenths: [150, 30, mode === 'changed-quote' ? 5 : 50, 2] } }),
    components: children.map(({ c, pool }, i) => ({ feedId: addr(80 + i), sourceConfig: addr(90 + i), quantityX64: 1n << 64n,
      createClassic: { baseMint: c.baseMint, ticker: `KID${i}`, pool, policy, identity: { asset: addr(74 + i), agentUri: '' } } })) };
  const error = await prepareV1CompositeFeedJourney(deps(rpc), { input } as never, rpc as never).then(() => undefined, e => e);
  if (mode.startsWith('coherent')) {
    expect(reads).toBe(3); // two real SDK child drafts followed by the real root drafter
    expect(packetBurns).toHaveLength(3);
    expect(error).toBeInstanceOf(beta.MimirBetaCollateralRequiredError);
    expect(error.requiredAmountRaw).toBe(15_000n);
  } else if (mode === 'lagged-balance' || mode === 'lagged-rent' || mode === 'lagged-fee' || mode === 'lagged-root-fallback') {
    expect(error?.message).toMatch(/context regressed|stale/);
    expect(error?.code).not.toBe('COLLATERAL_REQUIRED');
  } else {
    expect(error).toBeInstanceOf(ReviewIntentChangedError);
    expect(error?.code).not.toBe('COLLATERAL_REQUIRED');
    expect(packetBurns).toEqual([]);
  }
});

// Risk/decision: a Classic SDK child can see an updated fee-only admin frame while
// the root RPC node lags; equal COLA tariffs do not make root fees/revision current.
it.each(['quoted', 'fallback', 'coherent'] as const)('independent reverse-frame: %s child sees fee-only admin update before root', async (mode) => {
  const children = await Promise.all([41, 42].map((seed) => classicCase(seed, addr(seed + 100))));
  const store = new Map(children.flatMap((x) => [...x.store]));
  const { ata, rpc: base } = await chain(store, 10_000n);
  const [adminKey] = await V1.findMimirV1AdminConfigPda(programId);
  const old = new Uint8Array(store.get(adminKey)!.data);
  const newer = new Uint8Array(old), v = new DataView(newer.buffer);
  v.setBigUint64(152, 2n, true);
  for (const at of [104, 108, 112]) v.setUint32(at, 100_000_000, true);
  let reads = 0, readBank = 1525n;
  const trace: unknown[] = [];
  const packets: string[] = [];
  const rpc = { ...base, getLatestBlockhash: () => ({ send: async () => ({ ...await base.getLatestBlockhash().send(), context: { slot: mode === 'coherent' ? 1526n : 1525n } }) }), getMultipleAccounts: (xs: readonly Address[], config?: { minContextSlot?: bigint }) => ({ send: async () => {
    const result = await base.getMultipleAccounts(xs).send();
    if (xs.includes(adminKey)) {
      reads++;
      const fresh = mode === 'coherent' || reads <= 2;
      const slot = fresh ? 1526n : 1525n;
      readBank = slot;
      result.context = { slot };
      result.value[xs.indexOf(adminKey)]!.data = [Buffer.from(fresh ? newer : old).toString('base64'), 'base64'];
      trace.push({ read: reads, slot: slot.toString(), revision: fresh ? '2' : '1', minimum: config?.minContextSlot?.toString() ?? null });
    } else result.context = { slot: readBank };
    return result;
  } }), getFeeForMessage: (message: string) => ({ send: async () => {
    expect(getCompiledTransactionMessageDecoder().decode(new Uint8Array(Buffer.from(message, 'base64'))).version).toBe(0);
    packets.push(message);
    return { context: { slot: mode === 'coherent' ? 1526n : 1525n }, value: 5000n };
  } }) };
  const input = { authority: payer, ticker: 'ROOT', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy,
    identity: { asset: addr(73), agentUri: '' }, creatorCollateralTokenAccount: ata, ...FULL_SOL,
    ...(mode === 'fallback' ? {} : { pricedAdmin: { configRevision: mode === 'coherent' ? 2n : 1n, collateralAmountRaw: 1_000n, tickerTierTenths: [150, 30, 5, 2] } }),
    components: children.map(({ c, pool }, i) => ({ feedId: addr(80 + i), sourceConfig: addr(90 + i), quantityX64: 1n << 64n,
      createClassic: { baseMint: c.baseMint, ticker: `KID${i}`, pool, policy, identity: { asset: addr(74 + i), agentUri: '' } } })) };
  const error = await prepareV1CompositeFeedJourney(deps(rpc), { input } as never, rpc as never).then(() => undefined, e => e);
  if (mode === 'coherent') {
    expect(error).toBeInstanceOf(beta.MimirBetaCollateralRequiredError);
    expect(error.fundingCosts.protocolFeeLamports).toBe(100_000_000n);
  } else {
    expect(error).toBeInstanceOf(ReviewIntentChangedError);
    expect(packets).toEqual([]);
  }
});

// Risk/decision: direct dispatch must carry the root admin/assets context into
// balance/rent/fee facts, even if a load-balanced getSlot call goes backwards.
it('independent direct root: funding context must not regress behind the pricing/assets read', async () => {
  const store = new Map<Address, Acc>();
  for (const id of [addr(60), addr(61)]) await classicAt(store, id);
  const { ata, rpc: base } = await chain(store, 10_000n);
  const [adminKey] = await V1.findMimirV1AdminConfigPda(programId);
  const trace: unknown[] = [];
  const rpc = { ...base, getMultipleAccounts: (xs: readonly Address[], config?: { minContextSlot?: bigint }) => ({ send: async () => {
    const result = await base.getMultipleAccounts(xs).send();
    const slot = xs.includes(adminKey) || xs.includes(cola) ? 1526n : 1525n;
    result.context = { slot };
    trace.push({ addresses: xs.map(x => x === adminKey ? 'admin' : x === cola ? 'mint' : x === ata ? 'ata' : x === RENT_SYSVAR ? 'rent' : 'other'), slot: slot.toString(), minimum: config?.minContextSlot?.toString() ?? null });
    return result;
  } }) };
  const input = { authority: payer, ticker: 'PAIR', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy,
    creatorCollateralTokenAccount: ata, ...FULL_SOL, pricedAdmin: { configRevision: 1n, collateralAmountRaw: 1_000n, tickerTierTenths: [150, 30, 5, 2] },
    components: [addr(60), addr(61)].map((feedId) => ({ feedId, quantityX64: 1n << 64n })) };
  const error = await prepareV1CompositeFeed(deps(rpc), input as never).then(() => undefined, e => e);
  expect(error).toBeInstanceOf(ReviewIntentChangedError);
});


// Same release-gate risk, now with a concrete direct reserve discrepancy:
// a root bank already shows expired F2 credits, but a regressed getSlot prices them as live.
it('independent direct F2: known root bank must govern the activation fee reserve', async () => {
  const store = new Map<Address, Acc>(), ids = [addr(60), addr(61)];
  const born = 1525n, older = born + BigInt(V1.V1Layout.F2_WINDOW_SLOTS) - 1n, current = older + 2n;
  for (const id of ids) {
    await classicAt(store, id);
    const [feed] = await V1.findMimirV1ClassicFeedPda(programId, id);
    const data = store.get(feed)!.data;
    data.set(getAddressEncoder().encode(payer), 529); data.fill(0, 561, 593);
    data[593 + 61] = V1.V1Layout.F2_CREDIT_AVAILABLE;
    new DataView(data.buffer).setBigUint64(512, born << 20n, true);
    expect(V1.decodeV1ClassicFeed(data, feed).owner.createdSlot).toBe(born);
  }
  const { ata, rpc: base } = await chain(store, 10_000n);
  const rpc = { ...base, getSlot: () => ({ send: async () => older }),
    getLatestBlockhash: () => ({ send: async () => ({ ...await base.getLatestBlockhash().send(), context: { slot: current } }) }),
    getMultipleAccounts: (xs: readonly Address[], config?: { minContextSlot?: bigint }) => ({ send: async () => {
      return { ...await base.getMultipleAccounts(xs).send(), context: { slot: current } };
    } }), getFeeForMessage: () => ({ send: async () => ({ context: { slot: current }, value: 5000n }) }) };
  const input = { authority: payer, ticker: 'PAIR', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy,
    creatorCollateralTokenAccount: ata, ...FULL_SOL,
    components: ids.map((feedId) => ({ feedId, quantityX64: 1n << 64n })) };
  const correct = await draftV1Composite(deps({ ...rpc, getSlot: () => ({ send: async () => current }) }), input as never);
  expect(correct.protocolFeeLamports).toBe(43n);
  const error = await prepareV1CompositeFeed(deps(rpc), input as never).then(() => undefined, e => e);
  expect(error).toBeInstanceOf(beta.MimirBetaCollateralRequiredError);
  expect(error.fundingCosts.protocolFeeLamports, 'Credits were expired in the already-read root bank, so reserve must include both component fees').toBe(correct.protocolFeeLamports);
});

// Property oracle: independent revision assignments and all binary bank orderings.
// A stale getSlot may be clamped; account/fee evidence must never go backwards.
// Domain: two adjacent banks and admin revisions; the expiry-relative matrix below extends the final-boundary oracle.
it('APP-SOL-MAX-03 property: only one coherent frame can cross the funding boundary', async () => {
  const children = await Promise.all([41, 42].map(seed => classicCase(seed, addr(seed + 100))));
  const store = new Map(children.flatMap(x => [...x.store]));
  for (const id of [addr(60), addr(61)]) await classicAt(store, id);
  const { ata, rpc: base } = await chain(store, 10_000n);
  const [adminKey] = await V1.findMimirV1AdminConfigPda(programId);
  const admins = [1n, 2n].map(revision => {
    const data = new Uint8Array(store.get(adminKey)!.data), view = new DataView(data.buffer);
    view.setBigUint64(152, revision, true); data[118] = 50; // same tariff, different fee-only frames
    view.setUint32(112, revision === 1n ? 17 : 100_000_000, true);
    return data;
  });
  let escaped = 0, refused = 0;
  for (const route of ['classic', 'direct', 'staged'] as const) {
    const names = route === 'staged' ? ['child0', 'child1', 'root', 'assets', 'getSlot', 'balance', 'rent', 'block', 'fee']
      : ['root', 'assets', 'getSlot', 'balance', 'rent', 'block', 'fee'];
    const revisionCases = route === 'staged' ? 8 : route === 'direct' ? 4 : 2;
    for (let revisions = 0; revisions < revisionCases; revisions++) for (let ordering = 0; ordering < 2 ** names.length; ordering++) {
      const slots = Object.fromEntries(names.map((name, bit) => [name, 1525n + BigInt(ordering >> bit & 1)]));
      const frames = route === 'staged' ? [0, 1, 2].map(bit => revisions >> bit & 1) : [revisions & 1];
      const quoteFrame = route === 'direct' ? revisions >> 1 & 1 : frames.at(-1)!;
      const events = route === 'staged' ? ['getSlot', 'child0', 'child1', 'root', 'getSlot', 'assets', 'balance', 'rent', 'block', 'fee', 'fee', 'fee']
        : route === 'direct' ? ['root', 'getSlot', 'assets', 'getSlot', 'balance', 'rent', 'block', 'fee']
        : ['root', 'assets', 'getSlot', 'balance', 'rent', 'block', 'fee'];
      let maximum = 1525n;
      const monotone = events.every(event => {
        const slot = slots[event]!;
        const safe = event === 'getSlot' || slot >= maximum;
        if (slot > maximum) maximum = slot;
        return safe;
      });
      const coherent = monotone && frames.every(frame => frame === frames.at(-1)) && quoteFrame === frames.at(-1);
      let adminReads = 0, lastAdminSlot = 1525n;
      const rpc = { ...base, getSlot: () => ({ send: async () => slots.getSlot }),
        getLatestBlockhash: () => ({ send: async () => ({ ...await base.getLatestBlockhash().send(), context: { slot: slots.block } }) }),
        getFeeForMessage: () => ({ send: async () => ({ context: { slot: slots.fee }, value: 5000n }) }),
        getMultipleAccounts: (xs: readonly Address[], config?: { minContextSlot?: bigint }) => ({ send: async () => {
          const response = await base.getMultipleAccounts(xs).send();
          let slot = 1525n;
          if (xs.includes(adminKey)) {
            const index = adminReads++;
            slot = slots[route === 'staged' ? ['child0', 'child1', 'root'][index]! : 'root']!;
            lastAdminSlot = slot;
            response.value[xs.indexOf(adminKey)]!.data = [Buffer.from(admins[frames[index]!]!).toString('base64'), 'base64'];
          } else if (xs.includes(RENT_SYSVAR)) slot = slots.rent!;
          else if (xs.length === 1 && xs[0] === ata) slot = slots.balance!;
          else if (xs.includes(cola)) slot = route === 'staged' && adminReads < 3 ? lastAdminSlot : slots.assets!;
          response.context = { slot };
          // Return the chosen bank even below the requested floor: the adapter must fail closed.
          if (coherent) expect(config?.minContextSlot === undefined || config.minContextSlot <= slot).toBe(true);
          return response;
        } }) };
      const common = { authority: payer, ticker: 'ROOT', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy,
        identity: { asset: addr(73), agentUri: '' }, creatorCollateralTokenAccount: ata, ...FULL_SOL };
      const pending = children.map(({ c, pool }, i) => ({ feedId: addr(80 + i), sourceConfig: addr(90 + i), quantityX64: 1n << 64n,
        createClassic: { baseMint: c.baseMint, ticker: `KID${i}`, pool, policy, identity: { asset: addr(74 + i), agentUri: '' } } }));
      const input = { ...common, components: route === 'staged' ? pending : [addr(60), addr(61)].map(feedId => ({ feedId, quantityX64: 1n << 64n })),
        pricedAdmin: { configRevision: BigInt(quoteFrame + 1), collateralAmountRaw: 1000n, tickerTierTenths: [150, 30, 50, 2] } };
      const operation = route === 'staged' ? prepareV1CompositeFeedJourney(deps(rpc), { input } as never, rpc as never)
        : route === 'direct' ? prepareV1CompositeFeed(deps(rpc), input as never)
        : prepareV1SimpleFeed(deps(rpc), { ...common, baseMint: children[0]!.c.baseMint, pools: [children[0]!.pool], policy } as never);
      const error = await operation.then(() => undefined, error => error);
      const label = JSON.stringify({ route, revisions, ordering });
      if (coherent) {
        escaped++;
        expect(error, label).toBeInstanceOf(beta.MimirBetaCollateralRequiredError);
        expect(error.requiredAmountRaw, label).toBe(route === 'staged' ? 15_000n : 5000n);
        expect(error.shortfallRaw, label).toBe(error.requiredAmountRaw);
        const costs = error.fundingCosts;
        if (route === 'staged') expect(costs.accountRentLamports, label).toBe(65_013_360n);
        expect(costs.networkFeeLamports, label).toBe(route === 'staged' ? 19_500n : 6_500n);
        expect(costs.protocolFeeLamports, label).toBe(route === 'classic' ? 0n : (frames.at(-1) === 0 ? 17n : 100_000_000n) + (route === 'direct' ? 48n : 0n));
        expect(costs.totalLamports, label).toBe(costs.accountRentLamports + costs.networkFeeLamports + costs.protocolFeeLamports);
        expect(costs.observedSlot, label).toBe(maximum);
      } else {
        refused++;
        expect(error, label).toBeInstanceOf(ReviewIntentChangedError);
      }
    }
  }
  expect(escaped).toBeGreaterThan(0);
  expect(refused).toBeGreaterThan(2000);
}, 120_000);

// Independent safety oracle: every already-observed bank must preserve the F2
// eligibility used to reserve activation fees. An ordinary one-slot advance at
// expiry is sufficient; no admin revision change or RPC regression is needed.
it.each(['direct', 'journey', 'mixed-pending'] as const)('F2 final-frame %s: boundary matrix', async (route) => {
  const results: unknown[] = [];
  const stages = route === 'direct' ? ['steady', 'root', 'assets', 'review-slot', 'balance', 'rent', 'block', 'fee0']
    : ['steady', 'root', 'assets', 'balance', 'rent', 'block', 'fee0', ...(route === 'mixed-pending' ? ['fee1'] : [])];
  for (const stage of stages) {
    const store = new Map<Address, Acc>(), ids = [addr(60), addr(61)];
    const born = 1525n, edge = born + BigInt(V1.V1Layout.F2_WINDOW_SLOTS), expired = edge + 1n;
    for (const id of ids) {
      await classicAt(store, id);
      const [feed] = await V1.findMimirV1ClassicFeedPda(programId, id);
      const bytes = store.get(feed)!.data;
      bytes.set(getAddressEncoder().encode(payer), 529); bytes.fill(0, 561, 593);
      bytes[593 + 61] = V1.V1Layout.F2_CREDIT_AVAILABLE;
      new DataView(bytes.buffer).setBigUint64(512, born << 20n, true);
      expect(V1.decodeV1ClassicFeed(bytes, feed).owner.createdSlot).toBe(born);
    }
    const pendingChild = route === 'mixed-pending' ? await classicCase(43, addr(143)) : null;
    if (pendingChild) for (const [key, value] of pendingChild.store) store.set(key, value);
    const { ata, rpc: base } = await chain(store, 10_000n);
    const [registry] = await V1.findMimirV1RegistryPda(programId);
    const [admin] = await V1.findMimirV1AdminConfigPda(programId);
    let now = edge, seenAdmin = false, slotsAfterAdmin = 0, feeIndex = 0;
    const trace: { event: string; slot: string; minimum?: string }[] = [];
    const observe = (event: string, minimum?: bigint) => {
      if (stage === event) now = expired;
      trace.push({ event, slot: now.toString(), minimum: minimum?.toString() });
      return now;
    };
    const rpc = { ...base,
      getSlot: () => ({ send: async () => {
        const event = seenAdmin && ++slotsAfterAdmin === 2 ? 'review-slot' : 'slot';
        return observe(event);
      } }),
      getMultipleAccounts: (xs: readonly Address[], config?: { minContextSlot?: bigint }) => ({ send: async () => {
        const response = await base.getMultipleAccounts(xs).send();
        const event = xs.includes(admin) ? (xs.includes(registry) ? 'child' : 'root') : xs.includes(cola) ? 'assets'
          : xs.includes(RENT_SYSVAR) ? 'rent' : xs.length === 1 && xs[0] === ata ? 'balance' : 'other';
        if (event === 'root') { seenAdmin = true; slotsAfterAdmin = 0; }
        return { ...response, context: { slot: observe(event, config?.minContextSlot) } };
      } }),
      getLatestBlockhash: (config?: { minContextSlot?: bigint }) => ({ send: async () => ({
        ...await base.getLatestBlockhash().send(), context: { slot: observe('block', config?.minContextSlot) }
      }) }),
      getFeeForMessage: () => ({ send: async () => ({ context: { slot: observe(`fee${feeIndex++}`) }, value: 5000n }) })
    };
    const input = { authority: payer, ticker: 'PAIR', quoteMint: USDC_QUOTE_MINT, displayName: '', policy: compositePolicy,
      identity: { asset: addr(73), agentUri: '' }, creatorCollateralTokenAccount: ata, ...FULL_SOL,
      components: pendingChild ? [
        { feedId: addr(80), sourceConfig: addr(90), quantityX64: 1n << 64n, createClassic: { baseMint: pendingChild.c.baseMint, ticker: 'KIDA',
          pool: pendingChild.pool, policy, identity: { asset: addr(74), agentUri: '' } } },
        { feedId: ids[1]!, quantityX64: 1n << 64n }
      ] : ids.map(feedId => ({ feedId, quantityX64: 1n << 64n })) };
    const operation = route === 'direct' ? prepareV1CompositeFeed(deps(rpc), input as never)
      : prepareV1CompositeFeedJourney(deps(rpc), { input } as never, rpc as never);
    const error = await operation.then(() => undefined, error => error);
    const escaped = error instanceof beta.MimirBetaCollateralRequiredError;
    const expectedProtocol = now <= edge ? 17n : route === 'mixed-pending' ? 30n : 43n; // 17 creation + 2 x 13 non-credit component treasury fees.
    const actualProtocol = escaped ? error.fundingCosts?.protocolFeeLamports : null;
    results.push({ stage, escaped, expectedProtocol: expectedProtocol.toString(), actualProtocol: actualProtocol?.toString(),
      observedSlot: escaped ? error.fundingCosts?.observedSlot.toString() : undefined, code: error?.code, trace });
    // Safe controls must continue without a new user action; crossings must fail
    // closed or return the exact current reserve before allowing any purchase.
    if (stage === 'steady' || stage === 'root') expect(error).toBeInstanceOf(beta.MimirBetaCollateralRequiredError);
    if (escaped) {
      expect.soft(actualProtocol, JSON.stringify(results.at(-1))).toBe(expectedProtocol);
      const endpoint = (error.fundingCosts as import('../../src/create/creation-context.js').MimirBetaFundingCosts).creditValidThroughSlot;
      if (stage === 'steady') expect(endpoint).toBe(edge);
      if (stage === 'root' && route !== 'mixed-pending') expect(endpoint).toBeUndefined();
    }
    else expect.soft(error).toBeInstanceOf(ReviewIntentChangedError);
  }
  expect(results).toHaveLength(stages.length);
});

// Real SDK pricing counterpart to the mounted FINAL atomic-prefix consumer guard.
// The adapter receives credit coverage, not the original tariff; the store binds these two frames.
it.each(['same', 'decrease', 'increase'] as const)('FINAL atomic prefix frame: %s tariff at redraft', async mode => {
  const { c, pool, store } = await classicCase(43);
  const { ata, rpc: base } = await chain(store, 10_000n);
  let now = 1525n;
  const rpc = { ...base, getSlot: () => ({ send: async () => now }),
    getMultipleAccounts: (xs: readonly Address[]) => ({ send: async () => ({ ...await base.getMultipleAccounts(xs).send(), context: { slot: now } }) }),
    getLatestBlockhash: () => ({ send: async () => ({ ...await base.getLatestBlockhash().send(), context: { slot: now } }) }),
    getFeeForMessage: () => ({ send: async () => ({ context: { slot: now }, value: 5000n }) }) };
  const args = { authority: payer, ticker: 'SOLX', baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool],
    policy, variant: 1, creatorCollateralTokenAccount: ata, ...FULL_SOL };
  const previous = await facts(prepareV1SimpleFeed(deps(rpc), args as never));
  expect(previous.requiredAmountRaw).toBe(500n);
  if (mode !== 'same') {
    const [admin] = await V1.findMimirV1AdminConfigPda(programId);
    const bytes = store.get(admin)!.data;
    bytes[118] = mode === 'decrease' ? 2 : 20;
    new DataView(bytes.buffer).setBigUint64(152, 2n, true);
    now = 1526n;
  }
  const callerPrefix = { instructions: [], maxAuthorityDebitLamports: 1n,
    funding: { tokenAccount: ata, minimumCreditRaw: previous.requiredAmountRaw, coversBurn: true } };
  const d = await draftV1Classic(deps(rpc), { ...args, callerPrefix } as never);
  const burn = d.specs.find(spec => spec.kind === 'spl-token-burn-checked')!;
  const error = await prepareV1SimpleFeed(deps(rpc), { ...args, callerPrefix } as never).then(() => undefined, error => error);
  expect(burn.amountRaw).toBe(mode === 'decrease' ? 200n : mode === 'increase' ? 2000n : previous.requiredAmountRaw);
  expect(error).toBeInstanceOf(beta.MimirBetaCollateralRequiredError);
  expect(error.requiredAmountRaw).toBe(burn.amountRaw);
});

// Independent finite oracle across the complete unpaid journey: each stage may return
// an older/equal/newer bank; each selected term may change at any boundary.
it('APP-SOL-MAX-06/07 property: one ledger survives prepare → purchase → redraft → confirm → pre-wallet → post-wallet', async () => {
  const stages = ['prepare', 'purchase', 'redraft', 'confirm', 'pre-wallet', 'post-wallet'];
  const selected = { configRevision: 1n, collateralRequired: true, collateralMint: cola, collateralAmountRaw: 1000n,
    tickerTierTenths: [150, 30, 5, 2], compositeActivationOwnerFeeLamports: 11n,
    compositeActivationTreasuryComponentFeeLamports: 13n, compositeActivationTreasuryCreationFeeLamports: 17n };
  let cases = 0;
  for (let ordering = 0; ordering < 3 ** stages.length; ordering++) {
    for (const term of ['none', 'revision', 'tariff', 'fee', 'burn', 'expiry', 'child'] as const) {
      for (let boundary = 0; boundary < (term === 'none' ? 1 : stages.length); boundary++) {
        const context = new SolCreationContext();
        context.admin(selected); context.select('burn', 500n);
        const child = addr(60);
        context.retain(() => context.account(child)?.data[0] !== 0);
        context.retain(slot => slot <= 102n, 102n);
        let code = ordering, floor = 100n, refusal = false;
        context.observe(floor);
        for (let index = 0; index < stages.length; index++) {
          const slot = 100n + BigInt(code % 3); code = Math.floor(code / 3);
          const changes = term !== 'none' && index === boundary;
          const expectedRefusal = slot < floor || changes;
          let error: unknown;
          try {
            const rpc = context.rpc({ simulateTransaction: (_wire: string, _config: object) => ({ send: async () => ({ context: { slot }, value: {} }) }) });
            await rpc.simulateTransaction('', {}).send();
            const accountRpc = context.rpc({ getAccountInfo: (_address: Address) => ({ send: async () => ({ context: { slot },
              value: { owner: programId, executable: false, lamports: 1n, data: [Buffer.from([changes && term === 'child' ? 0 : 1]).toString('base64'), 'base64'] } }) }) });
            await accountRpc.getAccountInfo(child).send();
            const admin = { ...selected,
              ...(changes && term === 'revision' ? { configRevision: 2n } : {}),
              ...(changes && term === 'tariff' ? { collateralAmountRaw: 1001n } : {}),
              ...(changes && term === 'fee' ? { compositeActivationTreasuryCreationFeeLamports: 18n } : {}) };
            context.admin(admin);
            context.select('burn', changes && term === 'burn' ? 499n : 500n);
            context.assertTerms(changes && term === 'expiry' ? 103n : slot, admin);
          } catch (caught) { error = caught; }
          expect(error instanceof ReviewIntentChangedError, `${ordering}/${term}/${boundary}/${stages[index]}`).toBe(expectedRefusal);
          if (error) { refusal = true; break; }
          if (slot > floor) floor = slot;
        }
        if (!refusal) expect(context.slot).toBe(floor);
        cases++;
      }
    }
  }
  expect(cases).toBe(26973);
});

it('explicit current-terms preparation replaces refused terms while retaining the journey floor', () => {
  const context = new SolCreationContext();
  context.observe(100n); context.select('burn', 500n); context.retain(slot => slot <= 100n, 100n);
  expect(() => context.assertTerms(101n)).toThrow(ReviewIntentChangedError);
  context.reprice();
  context.select('burn', 600n); context.assertTerms(101n);
  expect(context.slot).toBe(101n);
  expect(() => context.observe(100n)).toThrow(ReviewIntentChangedError);
});

it('S3 the facade plan reads its tariff from the AdminConfig account, and the split starts on that full-purchase plan', async () => {
  const { mock } = await import('node:test'), { fakeRpc } = await import('../mimir/fixtures.js'), Policy = await import('../../src/create/policy.js');
  const Discovery = await import('../../src/create/discovery.js');
  const { c, pool, store } = await classicCase(23);
  const { rpc } = await chain(store, 10_000n);
  const plain = (v: unknown): unknown => typeof v === 'bigint' ? Number(v) : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;
  const server = await fakeRpc(async (method, params) => plain(await (rpc as Record<string, (...a: unknown[]) => { send: () => Promise<unknown> }>)[method]!(...params).send()));
  mock.module(new URL('../../src/create/policy.ts', import.meta.url).href, { namedExports: { ...Policy, MIMIR_MAINNET_COLLATERAL_MINT: cola,
    MIMIR_MAINNET_DEPLOYMENT: { ...Policy.MIMIR_MAINNET_DEPLOYMENT, mimirProgramId: programId } } });
  mock.module(new URL('../../src/create/discovery.ts', import.meta.url).href, { namedExports: { ...Discovery, resolveEligiblePoolsSplit: async () => [pool] } });
  const Refresh = await import('../../src/v1/refresh.js');
  mock.module(new URL('../../src/v1/refresh.ts', import.meta.url).href, { namedExports: { ...Refresh, mimirV1RowVectors: async (_c: unknown, rows: never) => rowVectors(rows) } });
  const { prepareFeed } = await import('../../src/create/facade.js');
  try {
    const plan = await prepareFeed({ payer, ticker: 'SOLX', baseMint: c.baseMint, quote: 'USDC', pools: [pool.pool], recipe: 'default', rpc: server.url });
    expect([plan.steps.map((s) => s.kind), plan.tariffColaRaw]).toEqual([['buy-cola', 'create+price'], 500n]);
    // The server split on that real plan: one buy, then create+price, also when the landed buy is replayed from `after`.
    const Facade = await import('../../src/create/facade.js'), Token = await import('../../src/create/token.js');
    const { Keypair } = await import('@solana/web3.js'), { compileMimirBetaTransactionV1 } = await import('../../src/beta/transactionV1.js');
    const kp = Keypair.fromSeed(new Uint8Array(32).fill(5)), me = kp.publicKey.toBase58(), sends: string[] = [], wires = new Map<string, string>();
    const wire = (program: string) => compileMimirBetaTransactionV1({ feePayer: me as never, recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: 99n,
      instructions: [{ programAddress: program as never, accounts: [{ address: me as never, isSigner: true, isWritable: true }], data: Uint8Array.of(1) }] });
    mock.module(new URL('../../src/create/token.ts', import.meta.url).href, { namedExports: { ...Token,
      resolveToken: async (mint: string) => ({ mint, symbol: 'SOLX', verified: true, warnings: [] }), existingFeeds: async () => [] } });
    mock.module(new URL('../../src/create/facade.ts', import.meta.url).href, { namedExports: { ...Facade,
      facadeRpc: () => ({ getSignatureStatuses: ([x]: string[]) => ({ send: async () => ({ value: [wires.has(x) ? { slot: 5, err: null, confirmationStatus: 'finalized' } : null] }) }),
        getTransaction: (x: string) => ({ send: async () => { if (!wires.has(x)) return null; const f = await Facade.wireFacts(Buffer.from(wires.get(x)!, 'base64')); return { version: 'legacy', transaction: { message: { accountKeys: [f.signers[0], ...f.programs], instructions: f.programs.map((_, i) => ({ programIdIndex: i + 1 })) } } }; } }) }),
      submit: async (_r: unknown, _w: string, signed: Uint8Array, signature: string) => { sends.push(signature); wires.set(signature, Buffer.from(signed).toString('base64')); return { outcome: 'confirmed', slot: 5n }; },
      prepareStep: async (p: { steps: { kind: string }[] }, i: number) => ({ kind: p.steps[i]!.kind, index: i,
        transaction: await wire(p.steps[i]!.kind === 'buy-cola' ? 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' : 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        review: { debitLamports: 1n, networkFeeLamports: 1n, writes: [], firstPrice: i > 0, reviewHash: 'h', simulation: {} } }) } });
    const { Mimir } = await import('../../src/mimir.js');
    const srv = new Mimir({ rpc: server.url }), browser = new Mimir({ wallet: kp });
    const post = async (body: object) => JSON.parse(JSON.stringify(await srv.createFeed({ mint: c.baseMint, pools: [pool.pool], ticker: 'SOLX', skipSend: true, payer: me, ...body } as never)));
    const first = await post({});
    const second = await post({ resume: first, signed: await browser.sign(first.step) });
    const replay = await post({ resume: { ...second, state: 'ready', feed: second.step.feed } });
    expect([first.step.kind, second.step.kind, replay.step.kind, sends.length]).toEqual(['buy-cola', 'create+price', 'create+price', 1]);
  } finally { await server.close(); }
});

it('an explicit native-bounded DLMM row is refused before any COLA purchase when its oracle is not ready (recorded C8Gr), and reaches funding when dense (HTvjz)', async () => {
  const rec = JSON.parse(readFileSync('tests/create/fixtures/native-ready-dlmm-oracles.json', 'utf8'));
  for (const [name, ready] of [['C8Gr', false], ['HTvjz', true]] as const) {
    const { c, pool, store } = await classicCase(23, undefined, 'meteora-dlmm');
    const [oracle] = await beta.deriveMimirBetaPda({ programId: c.programId, seed: 'oracle', values: [getAddressEncoder().encode(c.pool) as Uint8Array] });
    const poolData = Uint8Array.from(store.get(c.pool)!.data); poolData.set(getAddressEncoder().encode(oracle), 552);
    store.set(c.pool, { ...store.get(c.pool)!, data: poolData });
    store.set(oracle, { owner: c.programId, executable: false, data: Uint8Array.from(Buffer.from(rec.oracles[name], 'base64')) });
    const clock = new Uint8Array(40); new DataView(clock.buffer).setBigUint64(0, 1525n, true); new DataView(clock.buffer).setBigInt64(32, BigInt(rec.clockUnix), true);
    store.set('SysvarC1ock11111111111111111111111111111111' as Address, { owner: 'Sysvar1111111111111111111111111111111111111' as Address, executable: false, data: clock });
    const { ata, rpc } = await chain(store, null);
    const run = prepareV1SimpleFeed(deps(rpc), { authority: payer, ticker: 'SOLX', baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool], recipes: ['native-bounded'],
      policy, creatorCollateralTokenAccount: ata, ...FULL_SOL } as never);
    if (ready) { await facts(run); continue; }
    const error = await run.then(() => undefined, (e: unknown) => e) as beta.MimirClassicNativeNotReadyError;
    expect(error).toBeInstanceOf(beta.MimirClassicNativeNotReadyError);
    expect([error.readiness.ready, error.readiness.reason, error.readiness.readyAtUnixTs]).toEqual([false, 'stale-oracle', undefined]);
  }
});

it('a mixed V1 set the program refuses (DLMM native + CLMM spot: bounded 5000 bps) is refused typed before any COLA purchase', async () => {
  const rec = JSON.parse(readFileSync('tests/create/fixtures/native-ready-dlmm-oracles.json', 'utf8'));
  const a = await classicCase(41, undefined, 'meteora-dlmm'), b = await classicCase(42, a.c.baseMint);
  const store = new Map([...b.store, ...a.store]);
  const [oracle] = await beta.deriveMimirBetaPda({ programId: a.c.programId, seed: 'oracle', values: [getAddressEncoder().encode(a.c.pool) as Uint8Array] });
  const poolData = Uint8Array.from(store.get(a.c.pool)!.data); poolData.set(getAddressEncoder().encode(oracle), 552);
  store.set(a.c.pool, { ...store.get(a.c.pool)!, data: poolData });
  store.set(oracle, { owner: a.c.programId, executable: false, data: Uint8Array.from(Buffer.from(rec.oracles.HTvjz, 'base64')) });
  const clock = new Uint8Array(40); new DataView(clock.buffer).setBigUint64(0, 1525n, true); new DataView(clock.buffer).setBigInt64(32, BigInt(rec.clockUnix), true);
  store.set('SysvarC1ock11111111111111111111111111111111' as Address, { owner: 'Sysvar1111111111111111111111111111111111111' as Address, executable: false, data: clock });
  const { ata, rpc } = await chain(store, null);
  const error = await prepareV1SimpleFeed(deps(rpc), { authority: payer, ticker: 'MIXD', baseMint: a.c.baseMint, quoteMint: a.c.quoteMint, pools: [a.pool, b.pool],
    recipes: ['native-bounded', null], policy, creatorCollateralTokenAccount: ata, ...FULL_SOL } as never).then(() => undefined, (e: unknown) => e) as beta.MimirBetaError;
  expect([error?.code, error instanceof beta.MimirBetaCollateralRequiredError, error?.message]).toEqual(['CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT', false, error?.message]);
});
