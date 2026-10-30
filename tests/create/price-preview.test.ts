import { afterEach, expect, it, vi } from './vitest.js';
import { getAddressDecoder, getAddressEncoder, type Address } from '@solana/kit';
import { readMimirBetaAccountCohort } from '../../src/beta/rpc.js';
import { medianX64, readPoolPrices, type PreviewPool } from '../../src/create/helpers.js';

const Q64 = 1n << 64n;
const SOL = 'So11111111111111111111111111111111111111112' as Address;
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as Address;
const TOKEN = getAddressDecoder().decode(new Uint8Array(32).fill(7));
const addr = (n: number) => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const isqrt = (n: bigint) => { let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; };
const near = (actual: bigint | undefined, expected: number) => expect(Math.abs(Number(actual!) / Number(Q64) / expected - 1)).toBeLessThan(1e-9);

function bytes(size: number, writes: (view: DataView, data: Uint8Array) => void): Uint8Array {
  const data = new Uint8Array(size);
  writes(new DataView(data.buffer), data);
  return data;
}
const u128 = (view: DataView, offset: number, value: bigint) => { view.setBigUint64(offset, value & (Q64 - 1n), true); view.setBigUint64(offset + 8, value >> 64n, true); };
const mint = (decimals: number) => bytes(82, (_, data) => { data[44] = decimals; });
const vault = (amount: bigint) => bytes(165, (view) => view.setBigUint64(64, amount, true));

function fixture(family: string, n: number, mintA: Address, base: Address, quote: Address, write: (view: DataView) => void) {
  const pool: PreviewPool = { family: family as PreviewPool['family'], pool: addr(n), baseMint: base, quoteMint: quote, baseVault: addr(n + 1),
    quoteVault: addr(n + 2), readPlan: { auxiliary: [] } as unknown as PreviewPool['readPlan'] };
  const offset = { 'orca-whirlpool': 101, 'raydium-clmm': 73, 'meteora-damm-v2': 168, 'meteora-dlmm': 88, 'raydium-cpmm': 168, pumpswap: 43 }[family]!;
  const data = bytes(1544, (view, data) => { data.set(getAddressEncoder().encode(mintA), offset); write(view); });
  return { pool, data };
}

function reader(accounts: Record<string, Uint8Array>) {
  const read = vi.fn(async (addresses: readonly Address[]) => addresses.map((address) => accounts[address] ? { data: accounts[address]! } : null));
  return read;
}
const decimals = { [SOL]: mint(9), [USDC]: mint(6), [TOKEN]: mint(6) };

afterEach(() => { vi.useRealTimers(); });

it('prices CLMM sqrt pools in both orientations', async () => {
  const orca = fixture('orca-whirlpool', 10, SOL, SOL, USDC, (view) => u128(view, 65, isqrt(15n * Q64 * Q64 / 100n)));
  const clmm = fixture('raydium-clmm', 20, USDC, SOL, USDC, (view) => u128(view, 253, isqrt(100n * Q64 * Q64 / 15n)));
  const damm = fixture('meteora-damm-v2', 30, TOKEN, TOKEN, USDC, (view) => u128(view, 456, isqrt(Q64 * Q64 / 4n)));
  const prices = await readPoolPrices([orca.pool, clmm.pool, damm.pool],
    reader({ ...decimals, [orca.pool.pool]: orca.data, [clmm.pool.pool]: clmm.data, [damm.pool.pool]: damm.data }));
  near(prices.get(orca.pool.pool), 150);
  near(prices.get(clmm.pool.pool), 150);
  near(prices.get(damm.pool.pool), 0.25);
});

it('prices DLMM from active id and bin step', async () => {
  const up = fixture('meteora-dlmm', 40, TOKEN, TOKEN, USDC, (view) => { view.setInt32(76, 100, true); view.setUint16(80, 10, true); });
  const down = fixture('meteora-dlmm', 50, USDC, TOKEN, USDC, (view) => { view.setInt32(76, 100, true); view.setUint16(80, 10, true); });
  const prices = await readPoolPrices([up.pool, down.pool], reader({ ...decimals, [up.pool.pool]: up.data, [down.pool.pool]: down.data }));
  near(prices.get(up.pool.pool), 1.001 ** 100);
  near(prices.get(down.pool.pool), 1.001 ** -100);
});

it('prices reserve pools from vaults net of retained fees', async () => {
  const cpmm = fixture('raydium-cpmm', 60, SOL, SOL, USDC, (view) => view.setBigUint64(341, 5_000_000_000n, true));
  const pump = fixture('pumpswap', 70, TOKEN, TOKEN, SOL, (view) => { view.setBigUint64(271, 1_000_000_000n, true); view.setBigUint64(279, 1_000_000_000n, true); });
  const prices = await readPoolPrices([cpmm.pool, pump.pool], reader({ ...decimals, [cpmm.pool.pool]: cpmm.data, [pump.pool.pool]: pump.data,
    [cpmm.pool.baseVault]: vault(1_005_000_000_000n), [cpmm.pool.quoteVault]: vault(150_000_000_000n),
    [pump.pool.baseVault]: vault(1_000_000_000_000n), [pump.pool.quoteVault]: vault(32_000_000_000n) }));
  near(prices.get(cpmm.pool.pool), 150);
  near(prices.get(pump.pool.pool), 0.00003);
});

it('takes the median of two selected pools and converts SOL quotes to USDC', async () => {
  const a = fixture('orca-whirlpool', 80, SOL, SOL, USDC, (view) => u128(view, 65, isqrt(15n * Q64 * Q64 / 100n)));
  const b = fixture('orca-whirlpool', 90, SOL, SOL, USDC, (view) => u128(view, 65, isqrt(152n * Q64 * Q64 / 1000n)));
  const prices = await readPoolPrices([a.pool, b.pool], reader({ ...decimals, [a.pool.pool]: a.data, [b.pool.pool]: b.data }));
  near(medianX64([...prices.values()]), 151);
  expect(medianX64([5n])).toBe(5n);
});

it('reads through one getMultipleAccounts and never sends or simulates a transaction', async () => {
  const pool = fixture('orca-whirlpool', 120, SOL, SOL, USDC, (view) => u128(view, 65, isqrt(15n * Q64 * Q64 / 100n)));
  const accounts: Record<string, Uint8Array> = { ...decimals, [pool.pool.pool]: pool.data };
  const calls: string[] = [];
  const rpc = new Proxy({}, { get: (_, method: string) => (...args: unknown[]) => {
    calls.push(method);
    return { send: async () => ({ context: { slot: 1n }, value: (args[0] as Address[]).map((address) => ({
      data: [Buffer.from(accounts[address]!).toString('base64'), 'base64'], owner: '11111111111111111111111111111111', executable: false, lamports: 1n, space: 0n })) }) };
  } });
  const prices = await readPoolPrices([pool.pool], async (addresses) => (await readMimirBetaAccountCohort(rpc as never, addresses, 'confirmed')).value);
  near(prices.get(pool.pool.pool), 150);
  expect(calls).toEqual(['getMultipleAccounts']);
});

