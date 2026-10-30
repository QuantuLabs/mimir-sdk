import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { afterEach, describe, expect, it, vi } from './vitest.js';
import { validateJupiterCollateralBuild } from '../../src/create/collateral-funding.js';
import { amountFor, buildQuote, sizeCollateralPurchaseQuote, type BuildSwap } from '../../src/create/collateral-quote.js';
import { prepareCollateralPurchase, purchaseNetworkFeeLamports } from '../../src/create/collateral-purchase.js';
/** The app's backend builder: its swap-build endpoint behind the `{ success, data }` envelope. */
const backend = (url: string | URL): BuildSwap => (q) => buildQuote({ url: new URL('/v1/collateral/swap-build', url), envelope: true, authority: q.taker as never,
  collateralMint: q.outputMint as never, amount: q.amount, ...(q.signal ? { signal: q.signal } : {}), ...(q.failFast ? { failFast: true } : {}) });
const __MIMIR_SDK_TAR_SHA256__ = 'sdk';
import { ReviewIntentChangedError } from '../../src/create/errors.js';

const authority = address(`${'1'.repeat(31)}A`);
const collateralMint = address(`${'1'.repeat(31)}B`);
const tokenProgram = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const systemProgram = address('11111111111111111111111111111111');
const ataProgram = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const wsolMint = address('So11111111111111111111111111111111111111112');
const jupiterProgram = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const eventAuthority = address('D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf');
const sourceRouteAccount = address(`${'1'.repeat(31)}C`);
const routeV2 = [0xbb, 0x64, 0xfa, 0xcc, 0x31, 0xc4, 0xaf, 0x14];

type RawBuild = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  setupInstructions: unknown[];
  computeBudgetInstructions: unknown[];
  cleanupInstruction: unknown;
  otherInstructions: unknown[];
  tipInstruction: unknown;
  swapInstruction: {
    programId: string;
    accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
    data: string;
  };
};

const le = (value: bigint, size: number) => Uint8Array.from({ length: size }, (_, index) => Number((value >> BigInt(index * 8)) & 0xffn));

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function ata(owner: typeof authority, mint: typeof wsolMint | typeof collateralMint) {
  const encode = getAddressEncoder();
  const [result] = await getProgramDerivedAddress({
    programAddress: ataProgram,
    seeds: [encode.encode(owner), encode.encode(tokenProgram), encode.encode(mint)]
  });
  return result;
}

function tokenAccountData(mint: typeof wsolMint | typeof collateralMint, owner: typeof authority, amount: bigint): string {
  const data = new Uint8Array(165);
  data.set(getAddressEncoder().encode(mint), 0);
  data.set(getAddressEncoder().encode(owner), 32);
  data.set(le(amount, 8), 64);
  data[108] = 1;
  return base64(data);
}

async function fixture(options: { input?: bigint; quote?: bigint; slippage?: number; required?: bigint; threshold?: bigint } = {}) {
  const input = options.input ?? 1000n;
  const quote = options.quote ?? 11_001n;
  const slippage = options.slippage ?? 50;
  const minimum = (quote * BigInt(10_000 - slippage)) / 10_000n;
  const threshold = options.threshold ?? (quote * BigInt(10_000 - slippage) + 9_999n) / 10_000n;
  const sourceAta = await ata(authority, wsolMint);
  const collateralAta = await ata(authority, collateralMint);
  const data = Uint8Array.from([
    ...routeV2,
    ...le(input, 8),
    ...le(quote, 8),
    ...le(BigInt(slippage), 2),
    0, 0,
    0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
    0, 0, 0, 0, 0
  ]);
  const raw: RawBuild = {
    inputMint: wsolMint,
    outputMint: collateralMint,
    inAmount: input.toString(),
    outAmount: quote.toString(),
    otherAmountThreshold: threshold.toString(),
    slippageBps: slippage,
    setupInstructions: [{ opaque: 'ignored' }],
    computeBudgetInstructions: [{ opaque: 'ignored' }],
    cleanupInstruction: { opaque: 'ignored' },
    otherInstructions: [],
    tipInstruction: null,
    swapInstruction: {
      programId: jupiterProgram,
      accounts: [
        { pubkey: authority, isSigner: true, isWritable: false },
        { pubkey: sourceAta, isSigner: false, isWritable: true },
        { pubkey: collateralAta, isSigner: false, isWritable: true },
        { pubkey: wsolMint, isSigner: false, isWritable: false },
        { pubkey: collateralMint, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
        { pubkey: jupiterProgram, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: jupiterProgram, isSigner: false, isWritable: false },
        { pubkey: sourceRouteAccount, isSigner: false, isWritable: true }
      ],
      data: base64(data)
    }
  };
  const expected = {
    authority,
    collateralMint,
    collateralTokenAccount: collateralAta,
    requiredOutputRaw: options.required ?? 10_000n,
    maxInputLamports: input,
    slippageBps: slippage
  };
  return { raw, expected, sourceAta, collateralAta, data, minimum, threshold };
}

const rentSysvar = (lamportsPerByteYear: bigint) => vi.fn(() => ({ send: async () => {
  const data = new Uint8Array(17); const view = new DataView(data.buffer);
  view.setBigUint64(0, lamportsPerByteYear, true); view.setFloat64(8, 1, true);
  return { context: { slot: 20 }, value: { data: [btoa(String.fromCharCode(...data)), 'base64'] } };
} }));

async function purchaseFixture(options: { shortfallRaw?: bigint; payerLamports?: bigint } = {}) {
  const getMultipleAccounts = vi.fn(() => ({ send: async () => ({ context: { slot: 20 }, value: [
    { owner: systemProgram, executable: false, lamports: options.payerLamports ?? 1_000_000_000n, data: ['', 'base64'] }, null, null
  ] }) }));
  const getAccountInfo = rentSysvar(0n);
  const getLatestBlockhash = vi.fn(() => ({ send: async () => ({ context: { slot: 19 }, value: {
    blockhash: 'fixture-blockhash', lastValidBlockHeight: 100
  } }) }));
  const getFeeForMessage = vi.fn(() => ({ send: async () => ({ context: { slot: 20 }, value: 5_000 }) }));
  const simulateTransaction = vi.fn(() => ({ send: async () => { throw new Error('unexpected purchase simulation'); } }));
  return {
    args: {
      cluster: 'localnet' as const,
      rpc: { getMultipleAccounts, getAccountInfo, getLatestBlockhash, getFeeForMessage, simulateTransaction } as never,
      authority, collateralMint, collateralTokenAccount: await ata(authority, collateralMint), decimals: 6,
      shortfallRaw: options.shortfallRaw ?? 185_000_000_000_000n, draftHash: 'a'.repeat(64),
      observedBalanceRaw: 0n, accountMissing: true,
      costs: { observedSlot: 10n, identityLamports: 0n, accountRentLamports: 0n, networkFeeLamports: 0n,
        protocolFeeLamports: 0n, totalLamports: 1_000_000n },
      fingerprints: { sdk: __MIMIR_SDK_TAR_SHA256__, program: 'program', sbf: 'sbf', capture: 'capture', cohort: 'cohort' },
      buildSwap: backend('http://localhost:19204')
    },
    getLatestBlockhash, getFeeForMessage, simulateTransaction
  };
}

function stubQuotes(quoteFor: (amount: bigint, request: number) => bigint, inputs: bigint[], advanceFakeClock = false) {
  if (advanceFakeClock && !vi.isFakeTimers()) vi.useFakeTimers();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const amount = BigInt(new URL(String(input)).searchParams.get('amount')!);
    inputs.push(amount);
    const build = await fixture({ input: amount, quote: quoteFor(amount, inputs.length), slippage: 100 });
    if (advanceFakeClock) await vi.advanceTimersByTimeAsync(2_300);
    return new Response(JSON.stringify({ success: true, data: build.raw }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Jupiter SOL collateral admission', () => {
  it('skips Jupiter when the finalized COLA shortfall is zero', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(sizeCollateralPurchaseQuote({ buildSwap: backend(new URL('http://localhost/v1/collateral/swap-build')),
        authority, collateralMint, collateralTokenAccount: await ata(authority, collateralMint),
        shortfallRaw: 0n, maxInputLamports: 1_000_000n })).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reuses the validated route for renewal while recompiling, repricing, simulating, and rejecting drift', async () => {
    vi.useFakeTimers();
    let blockhashSlot = 20n;
    const getMultipleAccounts = vi.fn(() => ({ send: async () => ({ context: { slot: 20 }, value: [
      { owner: systemProgram, executable: false, lamports: 1_000_000_000n, data: ['', 'base64'] }, null, null
    ] }) }));
    const getAccountInfo = rentSysvar(0n);
    const getLatestBlockhash = vi.fn(() => ({ send: async () => {
      blockhashSlot += 2n;
      return { context: { slot: blockhashSlot }, value: { blockhash: blockhashSlot === 22n ? authority : collateralMint,
        lastValidBlockHeight: blockhashSlot + 100n } };
    } }));
    const getFeeForMessage = vi.fn(() => ({ send: async () => ({ context: { slot: blockhashSlot + 1n }, value: 5_000 }) }));
    const simulateTransaction = vi.fn(() => ({ send: async () => ({ context: { slot: blockhashSlot + 2n }, value: {
      err: null,
      accounts: [
        { owner: systemProgram, executable: false, lamports: 900_000_000n, data: ['', 'base64'] },
        { owner: tokenProgram, executable: false, lamports: 2_000_000n, data: [tokenAccountData(wsolMint, authority, 0n), 'base64'] },
        { owner: tokenProgram, executable: false, lamports: 2_000_000n, data: [tokenAccountData(collateralMint, authority, 20_000n), 'base64'] }
      ]
    } }) }));
    const inputs: bigint[] = [];
    const fetchMock = stubQuotes(() => 11_001n, inputs, true);
    const args = {
      cluster: 'localnet' as const,
      rpc: { getMultipleAccounts, getAccountInfo, getLatestBlockhash, getFeeForMessage, simulateTransaction } as never,
      authority, collateralMint, collateralTokenAccount: await ata(authority, collateralMint), decimals: 6,
      shortfallRaw: 1_000n, draftHash: 'b'.repeat(64), observedBalanceRaw: 0n, accountMissing: true,
      costs: { observedSlot: 10n, identityLamports: 0n, accountRentLamports: 0n, networkFeeLamports: 0n,
        protocolFeeLamports: 0n, totalLamports: 1_000_000n },
      fingerprints: { sdk: __MIMIR_SDK_TAR_SHA256__, program: 'program', sbf: 'sbf', capture: 'capture', cohort: 'cohort' },
      buildSwap: backend('http://localhost:19204')
    };
    try {
      const first = await prepareCollateralPurchase(args);
      const renewed = await prepareCollateralPurchase({ ...args, existingPreparedPurchase: first });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(renewed.transaction.instructions).toEqual(first.transaction.instructions);
      expect(renewed.inputLamports).toBe(first.inputLamports);
      expect(renewed.minimumOutputRaw).toBe(first.minimumOutputRaw);
      expect(renewed.transaction.messageHash).not.toBe(first.transaction.messageHash);
      expect(getLatestBlockhash).toHaveBeenCalledTimes(2);
      expect(getFeeForMessage).toHaveBeenCalledTimes(2);
      expect(simulateTransaction).toHaveBeenCalledTimes(2);
      expect(getLatestBlockhash).toHaveBeenCalledWith({ commitment: 'confirmed', minContextSlot: 20n });
      expect(getFeeForMessage).toHaveBeenCalledWith(expect.any(String), { commitment: 'confirmed', minContextSlot: 22n });
      expect(simulateTransaction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ commitment: 'confirmed' }));

      await expect(prepareCollateralPurchase({ ...args, shortfallRaw: args.shortfallRaw + 1n,
        existingPreparedPurchase: renewed })).rejects.toThrow(/renewal facts changed/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(getLatestBlockhash).toHaveBeenCalledTimes(2);
      expect(simulateTransaction).toHaveBeenCalledTimes(2);

      const sims = vi.fn(async () => { const response = await simulateTransaction().send(); return { ...response, value: { ...response.value, unitsConsumed: 31_941n } }; });
      const tight = await prepareCollateralPurchase({ ...args, rpc: { ...(args.rpc as object), simulateTransaction: () => ({ send: sims }),
        getFeeForMessage: () => ({ send: async () => ({ context: { slot: blockhashSlot + 2n }, value: 5_000 }) }) } as never });
      expect([tight.transaction.config.computeUnitLimit, sims.mock.calls.length]).toEqual([49_000, 1]);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('admits an existing WSOL account whose syncNative re-prices the reserve, and still refuses a WSOL spend', async () => {
    const wsol = (lamports: bigint, amount: bigint) => ({ owner: tokenProgram, executable: false, lamports, data: [tokenAccountData(wsolMint, authority, amount), 'base64'] });
    const getMultipleAccounts = vi.fn(() => ({ send: async () => ({ context: { slot: 20 }, value: [
      { owner: systemProgram, executable: false, lamports: 1_000_000_000n, data: ['', 'base64'] }, wsol(13_985_774n, 11_946_494n), null
    ] }) }));
    const simulated = (source: ReturnType<typeof wsol>) => vi.fn(() => ({ send: async () => ({ context: { slot: 30n }, value: { err: null, accounts: [
      { owner: systemProgram, executable: false, lamports: 900_000_000n, data: ['', 'base64'] }, source,
      { owner: tokenProgram, executable: false, lamports: 2_000_000n, data: [tokenAccountData(collateralMint, authority, 20_000n), 'base64'] }
    ] } }) }));
    const rpc = { getMultipleAccounts, getAccountInfo: rentSysvar(0n),
      getLatestBlockhash: () => ({ send: async () => ({ context: { slot: 22 }, value: { blockhash: authority, lastValidBlockHeight: 200n } }) }),
      getFeeForMessage: () => ({ send: async () => ({ context: { slot: 23 }, value: 5_000 }) }) };
    stubQuotes(() => 11_001n, []);
    const args = { cluster: 'localnet' as const, authority, collateralMint, collateralTokenAccount: await ata(authority, collateralMint), decimals: 6,
      shortfallRaw: 1_000n, draftHash: 'b'.repeat(64), observedBalanceRaw: 0n, accountMissing: true,
      costs: { observedSlot: 10n, identityLamports: 0n, accountRentLamports: 0n, networkFeeLamports: 0n, protocolFeeLamports: 0n, totalLamports: 1_000_000n },
      fingerprints: {}, buildSwap: backend('http://localhost:19204') };
    try {
      await expect(prepareCollateralPurchase({ ...args, rpc: { ...rpc, simulateTransaction: simulated(wsol(13_985_774n, 12_497_334n)) } as never }))
        .resolves.toMatchObject({ minimumOutputRaw: expect.any(BigInt) });
      for (const spent of [wsol(13_985_773n, 12_497_333n), wsol(13_985_774n, 11_946_493n)]) {
        await expect(prepareCollateralPurchase({ ...args, rpc: { ...rpc, simulateTransaction: simulated(spent) } as never }))
          .rejects.toThrow(/does not guarantee the reviewed COLA minimum/);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('adds one lamport after ratio rounding and rejects u64 overflow', () => {
    expect(amountFor(434_691n, 1_000n, 451_000_000n)).toBe(2n);
    expect(() => amountFor((1n << 64n) - 1n, 1n, 1n)).toThrow('SOL purchase amount exceeds u64');
  });

  it('requests the backend swap build with GET and the five string query parameters', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) =>
      new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await buildQuote({ url: new URL('http://localhost:19204/v1/collateral/swap-build'), envelope: true, authority,
        collateralMint, amount: 123n });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [requestUrl, requestOptions] = fetchMock.mock.calls[0]!;
      const request = new URL(String(requestUrl));
      expect(request.pathname).toBe('/v1/collateral/swap-build');
      expect([...request.searchParams.entries()].sort()).toEqual([
        ['amount', '123'], ['inputMint', wsolMint], ['outputMint', collateralMint],
        ['slippageBps', '100'], ['taker', authority]
      ]);
      expect(requestOptions).toEqual({ method: 'GET' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('waits through twelve 429s before giving up on the swap build', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '1' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = buildQuote({ url: new URL('http://localhost:19204/v1/collateral/swap-build'), envelope: true, authority,
        collateralMint, amount: 123n }).catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await result).toEqual(new Error('Collateral quote provider is unavailable'));
      expect(fetchMock).toHaveBeenCalledTimes(13);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('rejects a SOL purchase when ATA rent and the creation reserve consume the wallet balance', async () => {
    const getMultipleAccounts = vi.fn(() => ({ send: async () => ({ context: { slot: 20 }, value: [
      { owner: systemProgram, executable: false, lamports: 500_000, data: ['', 'base64'] }, null, null
    ] }) }));
    const getFeeForMessage = vi.fn(() => ({ send: async () => ({ context: { slot: 20 }, value: 5_000 }) }));
    const getAccountInfo = rentSysvar(200n);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(prepareCollateralPurchase({
        cluster: 'localnet',
        rpc: { getMultipleAccounts, getFeeForMessage, getAccountInfo } as never,
        authority, collateralMint, collateralTokenAccount: await ata(authority, collateralMint), decimals: 6,
        shortfallRaw: 10n, draftHash: 'a'.repeat(64), observedBalanceRaw: 0n, accountMissing: true,
        costs: { observedSlot: 10n, identityLamports: 0n, accountRentLamports: 0n, networkFeeLamports: 0n,
          protocolFeeLamports: 0n, totalLamports: 400_000n },
        fingerprints: { sdk: __MIMIR_SDK_TAR_SHA256__, program: 'program', sbf: 'sbf', capture: 'capture', cohort: 'cohort' },
        buildSwap: backend('http://localhost:19204')
      })).rejects.toThrow('You need 0.0005438 SOL');

      expect(getAccountInfo).toHaveBeenCalledWith('SysvarRent111111111111111111111111111111111', { commitment: 'confirmed', encoding: 'base64', minContextSlot: 20n });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('replays the recorded quote outputs with headroom and reaches the existing post-quote guard', async () => {
    const recordedQuotes = [
      [1_000n, 469_594_717n],
      [397_936_095n, 186_680_892_674_304n],
      [398_336_406n, 186_868_307_712_028n],
      // Synthetic covering response at the recalculated input; not a live Jupiter quote.
      [398_337_216n, 186_868_686_868_687n]
    ] as const;
    const inputs: bigint[] = [];
    const purchase = await purchaseFixture();
    const fetchMock = stubQuotes((_amount, request) => recordedQuotes[request - 1]![1], inputs);
    const minimum = (output: bigint) => output * 9_900n / 10_000n;
    const firstCorrection = amountFor(185_000_000_000_000n, recordedQuotes[1]![0], minimum(recordedQuotes[1]![1]));
    const firstPadded = firstCorrection + (firstCorrection * 100n + 9_999n) / 10_000n;
    const secondCorrection = amountFor(185_000_000_000_000n, firstPadded, minimum(recordedQuotes[2]![1]));
    const secondPadded = secondCorrection + (secondCorrection * 100n + 9_999n) / 10_000n;
    try {
      await expect(prepareCollateralPurchase(purchase.args)).rejects.toThrow(ReviewIntentChangedError);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(inputs).toEqual([recordedQuotes[0]![0], recordedQuotes[1]![0], firstPadded, secondPadded]);
      expect(inputs.every((input, index) => index === 0 || input > inputs[index - 1]!)).toBe(true);
      expect(purchase.getLatestBlockhash).toHaveBeenCalledTimes(1);
      expect(purchase.getFeeForMessage).not.toHaveBeenCalled();
      expect(purchase.simulateTransaction).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  }, 15_000);

  it('uses synthetic high-tier quote headroom to converge before the correction budget', async () => {
    const shortfall = 749_401_788_145_591n;
    const probeInput = 1_000n;
    const recordedFirstInput = 1_696_308_901n;
    const recordedFinalInput = 1_708_941_444n;
    const recordedFinalOutput = 756_971_500_792_229n;
    const probeMinimum = (shortfall * probeInput + recordedFirstInput - 2n) / (recordedFirstInput - 1n);
    const probeOutput = (probeMinimum * 10_000n + 9_899n) / 9_900n;
    const span = recordedFinalInput - probeInput;
    const rateDrop = probeOutput * recordedFinalInput - recordedFinalOutput * probeInput;
    // Synthetic concave interpolation: inferred probe anchor reproduces the recorded first input; final anchor is captured Jupiter output.
    const outputAt = (input: bigint) => input * (probeOutput * recordedFinalInput * span -
      rateDrop * (input - probeInput)) / (probeInput * recordedFinalInput * span);
    const minimumAt = (input: bigint) => outputAt(input) * 9_900n / 10_000n;
    let unpadded = amountFor(shortfall, probeInput, minimumAt(probeInput));
    expect(unpadded).toBe(recordedFirstInput);
    for (let correction = 0; correction < 3; correction += 1) {
      unpadded = amountFor(shortfall, unpadded, minimumAt(unpadded));
    }
    expect(minimumAt(unpadded)).toBeLessThan(shortfall);

    const inputs: bigint[] = [];
    const purchase = await purchaseFixture({ shortfallRaw: shortfall, payerLamports: 9_365_873_265n });
    const fetchMock = stubQuotes((input) => outputAt(input), inputs);
    const corrected = amountFor(shortfall, recordedFirstInput, minimumAt(recordedFirstInput));
    const padded = corrected + (corrected * 100n + 9_999n) / 10_000n;
    try {
      await expect(prepareCollateralPurchase(purchase.args)).rejects.toThrow(ReviewIntentChangedError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(inputs).toEqual([probeInput, recordedFirstInput, padded]);
      expect(minimumAt(padded)).toBeGreaterThanOrEqual(shortfall);
      expect(purchase.getLatestBlockhash).toHaveBeenCalledTimes(1);
      expect(purchase.getFeeForMessage).not.toHaveBeenCalled();
      expect(purchase.simulateTransaction).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  }, 15_000);

  it('keeps the unpadded correction when quote headroom would exceed the SOL cap', async () => {
    const shortfall = 185_000_000_000_000n;
    const probeMinimum = 469_594_717n * 9_900n / 10_000n;
    const initial = amountFor(shortfall, 1_000n, probeMinimum);
    const correction = amountFor(shortfall, initial, 180_000_000_000_000n * 9_900n / 10_000n);
    const inputs: bigint[] = [];
    const purchase = await purchaseFixture({ shortfallRaw: shortfall, payerLamports: correction + 1_000_000n });
    const fetchMock = stubQuotes((_input, request) => request === 1 ? 469_594_717n : request === 2
      ? 180_000_000_000_000n : 190_000_000_000_000n, inputs);
    const padded = correction + (correction * 100n + 9_999n) / 10_000n;
    try {
      await expect(prepareCollateralPurchase(purchase.args)).rejects.toThrow(ReviewIntentChangedError);
      expect(padded).toBeGreaterThan(correction);
      expect(inputs).toEqual([1_000n, initial, correction]);
      expect(inputs[2]).toBeLessThanOrEqual(correction);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(purchase.getLatestBlockhash).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  }, 15_000);

  it('stops after four target quotes when conservative output never converges', async () => {
    const inputs: bigint[] = [];
    const purchase = await purchaseFixture();
    const fetchMock = stubQuotes((_amount, request) => request === 1 ? 469_594_717n : 185_000_000_000_000n, inputs);
    try {
      await expect(prepareCollateralPurchase(purchase.args)).rejects.toThrow('COLA quote minimum is below the required shortfall');
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(inputs.every((input, index) => index === 0 || input > inputs[index - 1]!)).toBe(true);
      expect(inputs.every((input) => input <= 999_000_000n)).toBe(true);
      expect(purchase.getLatestBlockhash).not.toHaveBeenCalled();
      expect(purchase.getFeeForMessage).not.toHaveBeenCalled();
      expect(purchase.simulateTransaction).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  }, 15_000);

  it('stops before blockhash and compilation when SOL or u64 bounds fail', async () => {
    const u64Max = (1n << 64n) - 1n;
    for (const scenario of [
      { purchase: await purchaseFixture({ payerLamports: 300_000_000n }), quote: 469_594_717n,
        error: 'Required COLA shortfall exceeds available SOL' },
      { purchase: await purchaseFixture({ shortfallRaw: u64Max }), quote: 2n,
        error: 'SOL purchase amount exceeds u64' }
    ]) {
      const inputs: bigint[] = [];
      const fetchMock = stubQuotes(() => scenario.quote, inputs);
      try {
        await expect(prepareCollateralPurchase(scenario.purchase.args)).rejects.toThrow(scenario.error);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(inputs).toEqual([1_000n]);
        expect(scenario.purchase.getLatestBlockhash).not.toHaveBeenCalled();
        expect(scenario.purchase.getFeeForMessage).not.toHaveBeenCalled();
        expect(scenario.purchase.simulateTransaction).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.useRealTimers();
      }
    }
  });

  it('admits only the reviewed non-shared route and builds copied ATA, SOL wrap, and swap instructions', async () => {
    const f = await fixture();
    const result = await validateJupiterCollateralBuild(f.raw, f.expected);

    expect(result).toMatchObject({
      inputLamports: 1000n,
      quotedOutputRaw: 11_001n,
      minimumOutputRaw: f.minimum,
      sourceTokenAccount: f.sourceAta,
      collateralTokenAccount: f.collateralAta
    });
    expect(result.instructions.map(({ programAddress }) => programAddress)).toEqual([
      ataProgram, ataProgram, systemProgram, tokenProgram, jupiterProgram
    ]);
    expect(result.instructions[0]!.data).toEqual(Uint8Array.of(1));
    expect(result.instructions[1]!.accounts[3]!.address).toBe(collateralMint);
    expect(result.instructions[2]!.data).toEqual(Uint8Array.of(2, 0, 0, 0, ...le(1000n, 8)));
    expect(result.instructions[3]!.data).toEqual(Uint8Array.of(17));
    expect(result.instructions[4]!.data).toEqual(f.data);
    expect(result.instructions).toHaveLength(5); // no WSOL close; existing SOL balance stays wrapped

    f.raw.swapInstruction.data = base64(Uint8Array.of(1));
    f.raw.swapInstruction.accounts[10]!.pubkey = authority;
    expect(result.instructions[4]!.data).toEqual(f.data);
    expect(result.instructions[4]!.accounts[10]!.address).toBe(sourceRouteAccount);
  });

  it('rejects financial, destination, signer, fee, discriminator, and unsupported-extra drift', async () => {
    const mutations: [string, (raw: RawBuild) => void][] = [
      ['input metadata', (raw) => { raw.inAmount = '999'; }],
      ['reported minimum output', (raw) => { raw.otherAmountThreshold = '11000'; }],
      ['destination ATA', (raw) => { raw.swapInstruction.accounts[2]!.pubkey = sourceRouteAccount; }],
      ['external signer', (raw) => { raw.swapInstruction.accounts[10]!.isSigner = true; }],
      ['platform fee', (raw) => {
        const bytes = Uint8Array.from(atob(raw.swapInstruction.data), (char) => char.charCodeAt(0));
        bytes[26] = 1;
        raw.swapInstruction.data = base64(bytes);
      }],
      ['instruction discriminator', (raw) => {
        const bytes = Uint8Array.from(atob(raw.swapInstruction.data), (char) => char.charCodeAt(0));
        bytes[0] ^= 1;
        raw.swapInstruction.data = base64(bytes);
      }],
      ['opaque other instruction', (raw) => { raw.otherInstructions.push({ programId: systemProgram }); }],
      ['tip instruction', (raw) => { raw.tipInstruction = { programId: systemProgram }; }]
    ];
    for (const [label, mutate] of mutations) {
      const f = await fixture();
      mutate(f.raw);
      await expect(validateJupiterCollateralBuild(f.raw, f.expected), label).rejects.toThrow();
    }

    const wrongAta = await fixture();
    await expect(validateJupiterCollateralBuild(wrongAta.raw, {
      ...wrongAta.expected,
      collateralTokenAccount: wrongAta.sourceAta
    })).rejects.toThrow(/not the authority ATA/);

    const shared = await fixture();
    const sharedData = Uint8Array.from(atob(shared.raw.swapInstruction.data), (char) => char.charCodeAt(0));
    sharedData.set([0xd1, 0x98, 0x53, 0x93, 0x7c, 0xfe, 0xd8, 0xe9]);
    shared.raw.swapInstruction.data = base64(sharedData);
    await expect(validateJupiterCollateralBuild(shared.raw, shared.expected)).rejects.toThrow(/shared_accounts_route_v2 is unsupported/);
  });

  it('rejects a one-raw-unit rounding shortfall even when Jupiter reports the rounded-up threshold', async () => {
    const f = await fixture({ quote: 10n, slippage: 1, required: 10n, threshold: 10n });
    await expect(validateJupiterCollateralBuild(f.raw, f.expected)).rejects.toThrow(/guaranteed output/);
  });
});

async function reuseFixture(simulationErrors = 0) {
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 60_000);
  let slot = 20n;
  let failures = simulationErrors;
  const getMultipleAccounts = vi.fn((_addresses: unknown, config: { minContextSlot?: bigint }) => ({ send: async () => ({ context: { slot: config.minContextSlot && config.minContextSlot > 20n ? config.minContextSlot : 20n }, value: [
    { owner: systemProgram, executable: false, lamports: 1_000_000_000n, data: ['', 'base64'] }, null, null
  ] }) }));
  const getLatestBlockhash = vi.fn(() => ({ send: async () => {
    slot += 2n;
    return { context: { slot }, value: { blockhash: authority, lastValidBlockHeight: slot + 100n } };
  } }));
  const getFeeForMessage = vi.fn(() => ({ send: async () => ({ context: { slot: slot + 1n }, value: 5_000 }) }));
  const simulateTransaction = vi.fn(() => ({ send: async () => ({ context: { slot: slot + 2n }, value: {
    err: failures-- > 0 ? { InstructionError: [4, { Custom: 6001 }] } : null,
    accounts: [
      { owner: systemProgram, executable: false, lamports: 900_000_000n, data: ['', 'base64'] },
      { owner: tokenProgram, executable: false, lamports: 2_000_000n, data: [tokenAccountData(wsolMint, authority, 0n), 'base64'] },
      { owner: tokenProgram, executable: false, lamports: 2_000_000n, data: [tokenAccountData(collateralMint, authority, 20_000n), 'base64'] }
    ]
  } }) }));
  const collateralTokenAccount = await ata(authority, collateralMint);
  const inputs: bigint[] = [];
  const fetchMock = stubQuotes(() => 11_001n, inputs, true);
  const sized = (await sizeCollateralPurchaseQuote({ buildSwap: backend(new URL('http://localhost:19204/v1/collateral/swap-build')), authority,
    collateralMint, collateralTokenAccount, shortfallRaw: 1_000n, maxInputLamports: 1_000_000_000n }))!;
  fetchMock.mockClear();
  const estimateRoute = Object.freeze({ ...sized, authority, collateralMint, collateralTokenAccount, shortfallRaw: 1_000n, expiresAt: Date.now() + 30_000 });
  const args = {
    cluster: 'localnet' as const,
    rpc: { getMultipleAccounts, getAccountInfo: (_address: unknown, config: { minContextSlot?: bigint }) => ({ send: async () => ({
      ...await rentSysvar(0n)().send(), context: { slot: config.minContextSlot ?? 20n }
    }) }), getLatestBlockhash, getFeeForMessage, simulateTransaction } as never,
    authority, collateralMint, collateralTokenAccount, decimals: 6,
    shortfallRaw: 1_000n, draftHash: 'b'.repeat(64), observedBalanceRaw: 0n, accountMissing: true,
    costs: { observedSlot: 10n, identityLamports: 0n, accountRentLamports: 0n, networkFeeLamports: 0n,
      protocolFeeLamports: 0n, totalLamports: 1_000_000n },
    fingerprints: { sdk: __MIMIR_SDK_TAR_SHA256__, program: 'program', sbf: 'sbf', capture: 'capture', cohort: 'cohort' },
    buildSwap: backend('http://localhost:19204'), estimateRoute
  };
  return { args, estimateRoute, fetchMock, simulateTransaction };
}

describe('estimate route reuse for the SOL purchase', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('signs a fresh estimate route with zero swap-build calls and still simulates it', async () => {
    const { args, estimateRoute, fetchMock, simulateTransaction } = await reuseFixture();
    const purchase = await prepareCollateralPurchase(args);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(simulateTransaction).toHaveBeenCalledTimes(1);
    expect(purchase.inputLamports).toBe(estimateRoute.inputLamports);
    expect(purchase.transaction.instructions).toEqual(estimateRoute.instructions);
  });

  it.each([
    ['expired', { expiresAt: 0 }],
    ['ATA mismatch', { collateralTokenAccount: sourceRouteAccount }],
    ['authority mismatch', { authority: collateralMint }],
    ['input above the cap', { inputLamports: 1_000_000_000n }]
  ])('quotes afresh when the estimate route is %s', async (_name, change) => {
    const { args, estimateRoute, fetchMock } = await reuseFixture();
    await prepareCollateralPurchase({ ...args, estimateRoute: { ...estimateRoute, ...change } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sizes from a fresh estimate route at another shortfall with one build and no probe', async () => {
    const { args, estimateRoute, fetchMock } = await reuseFixture();
    await prepareCollateralPurchase({ ...args, estimateRoute: { ...estimateRoute, shortfallRaw: 999n } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once with a fresh quote when the reused route fails simulation', async () => {
    const { args, fetchMock, simulateTransaction } = await reuseFixture(1);
    await prepareCollateralPurchase(args);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(simulateTransaction).toHaveBeenCalledTimes(2);
  });
});

describe('confirmed context floors on the SOL purchase build', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const blockhashAt = (slot: (floor?: bigint) => bigint) => vi.fn((config: { minContextSlot?: bigint }) => ({ send: async () => ({
    context: { slot: slot(config.minContextSlot) }, value: { blockhash: authority, lastValidBlockHeight: 200n } }) }));

  it('reads the blockhash and fee no older than the wallet accounts, so a lagging node is skipped', async () => {
    const { args } = await reuseFixture();
    const relay = (floor?: bigint) => floor ?? 19n;
    const getLatestBlockhash = blockhashAt(relay);
    const getFeeForMessage = vi.fn((_message: string, config: { minContextSlot?: bigint }) => ({ send: async () => ({
      context: { slot: relay(config.minContextSlot) }, value: 5_000 }) }));
    const purchase = await prepareCollateralPurchase({ ...args, rpc: { ...(args.rpc as object), getLatestBlockhash, getFeeForMessage } as never });
    expect(getLatestBlockhash).toHaveBeenCalledWith({ commitment: 'confirmed', minContextSlot: 20n });
    expect(getFeeForMessage).toHaveBeenCalledWith(expect.any(String), { commitment: 'confirmed', minContextSlot: 20n });
    expect(purchase.networkFeeLamports).toBe(5_000n + purchase.transaction.config.priorityFeeLamports!);
  });

  it('refuses a blockhash below the journey floor through the current-terms path', async () => {
    const { args } = await reuseFixture();
    const error = await prepareCollateralPurchase({ ...args, rpc: { ...(args.rpc as object), getLatestBlockhash: blockhashAt(() => 19n) } as never })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReviewIntentChangedError);
  });
});

// FINAL-BOUNDARY: no later observed bank may silently reuse an expired F2 reserve.
describe('selected F2 credit endpoint through purchase and renewal', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it.each(['purchase', 'renewal'] as const)('%s: expiry at each existing read refuses current terms', async mode => {
    for (const stage of ['getMultipleAccounts', 'getAccountInfo', 'getLatestBlockhash', 'getFeeForMessage', 'simulateTransaction'] as const) {
      const { args } = await reuseFixture();
      let expire = false;
      const rpc = Object.fromEntries(Object.entries(args.rpc as object).map(([name, method]) => [name, (...params: unknown[]) => ({ send: async () => {
        const response = await method(...params).send();
        return { ...response, context: { slot: expire && name === stage ? 101n : response.context?.slot ?? 20n } };
      } })]));
      const selected = { ...args, rpc: rpc as never, costs: { ...args.costs, creditValidThroughSlot: 100n } };
      const first = mode === 'renewal' ? await prepareCollateralPurchase(selected) : undefined;
      expire = true;
      await expect(prepareCollateralPurchase({ ...selected, ...(first ? { existingPreparedPurchase: first } : {}) }), stage)
        .rejects.toBeInstanceOf(ReviewIntentChangedError);
    }
  });
  it('keeps the inclusive endpoint valid with no additional RPC reads', async () => {
    const { args, simulateTransaction } = await reuseFixture();
    const rpc = { ...(args.rpc as object), getAccountInfo: () => ({ send: async () => ({
      ...await rentSysvar(0n)().send(), context: { slot: 20n }
    }) }), simulateTransaction: (...params: unknown[]) => ({ send: async () => ({
      ...await (simulateTransaction as Function)(...params).send(), context: { slot: 100n }
    }) }) };
    const purchase = await prepareCollateralPurchase({ ...args, rpc: rpc as never, costs: { ...args.costs, creditValidThroughSlot: 100n } });
    expect(purchase.simulationSlot).toBe(100n);
    expect(simulateTransaction).toHaveBeenCalledTimes(1);
  });
});
