// A SOL-quoted classic draft carries Mimir's SOL/USDC conversion source like the app's (v1-create reads it only when the quote is SOL); a USDC one does not.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import * as Discovery from '../../src/create/discovery.js';
import * as V1Create from '../../src/create/v1-create.js';
import { MIMIR_MAINNET_SOL_CONVERSION_SOURCE_CONFIG } from '../../src/create/policy.js';

const seen: { quoteMint: string; solConversionSourceConfig?: string }[] = [];
const eligible = async (_r: unknown, _b: unknown, quoteMint: string) => [{ pool: 'P1', family: 'orca-whirlpool', quoteMint, creation: { adapterType: 0, adapterVersion: 1 } }];
mock.module(new URL('../../src/create/discovery.ts', import.meta.url).href, { namedExports: { ...Discovery, resolveEligiblePools: eligible, resolveEligiblePoolsSplit: eligible } });
mock.module(new URL('../../src/create/v1-create.ts', import.meta.url).href, { namedExports: { ...V1Create,
  prepareV1SimpleFeed: async (_d: unknown, base: { quoteMint: string; solConversionSourceConfig?: string }) => { seen.push(base); throw new Error('stop'); } } });
const { prepareFeed } = await import('../../src/create/facade.js');
const { fakeRpc } = await import('../mimir/fixtures.js');
const mint = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', held = new Uint8Array(82); held.set((await import('@solana/kit')).getAddressEncoder().encode(mint as never));
const holding = { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', executable: false, lamports: 1, rentEpoch: 0, space: 82, data: [Buffer.from(held).toString('base64'), 'base64'] };
const rpc = await fakeRpc((method, params) => method === 'getAccountInfo' ? { context: { slot: 1 }, value: null }
  : { context: { slot: 1 }, value: method === 'getMultipleAccounts' ? (params[0] as string[]).map(() => holding) : [] });
const args = { payer: '6Ba7yenKXHuauCn451XN8UotWgKtZyvxPMFwcPZza2Kz', ticker: 'ABC', baseMint: mint, pools: ['So11111111111111111111111111111111111111112'], rpc: rpc.url };
for (const quote of ['SOL', 'USDC'] as const) await prepareFeed({ ...args, quote } as never).catch(() => undefined);
await rpc.close();
assert.equal(seen.length, 2);
assert.equal(seen[0]!.solConversionSourceConfig, MIMIR_MAINNET_SOL_CONVERSION_SOURCE_CONFIG, 'SOL quote: the converter rides the draft');
assert.equal(seen[1]!.solConversionSourceConfig, undefined, 'USDC quote: no converter');
console.log('create converter parity: ok');
