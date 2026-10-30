import assert from 'node:assert/strict';
import type { Address } from '@solana/kit';
import { resolveEligiblePools, resolveEligiblePoolsSplit } from '../../src/create/discovery.js';
import { mimirBetaCaptureScanDescriptors } from '../../src/beta/capture.js';
import { setCohortSleepForTests } from '../../src/chunkedAccounts.js';
import { MimirError } from '../../src/easy/error.js';
import { fixtureAddress, makeBetaCaptureFixture } from '../fixtures/betaCaptureFixtures.js';

const CLOCK = 'SysvarC1ock11111111111111111111111111111111' as Address;
const sleeps: number[] = [];
setCohortSleepForTests(async (ms) => { sleeps.push(ms); });

const fixture = await makeBetaCaptureFixture('raydium-cpmm', { cluster: 'mainnet-beta' });
const store = new Map<string, { owner: string; executable: boolean; data: Uint8Array }>(fixture.fixtureAccounts.map((x) => [x.address, x]));
for (const d of mimirBetaCaptureScanDescriptors('mainnet-beta')) store.set(d.programId, { owner: 'BPFLoaderUpgradeab1e11111111111111111111111', executable: true, data: new Uint8Array(36) });
const pool = fixture.poolAccount.address;

/** A scripted RPC: `skew(call)` gives the Clock's offset from the response slot on a call carrying Clock. */
function rpc(skew: (call: number) => number) {
  let slot = 1_000n, clockCalls = 0;
  const calls: { clock: boolean; size: number; floor?: bigint; slot: bigint }[] = [];
  const info = (x: string, clockSlot: bigint) => {
    if (x === CLOCK) { const d = Buffer.alloc(40); d.writeBigUInt64LE(clockSlot); d.writeBigInt64LE(1_800_000_000n, 32);
      return { owner: 'Sysvar1111111111111111111111111111111111111', executable: false, lamports: 1n, space: 40n, data: [d.toString('base64'), 'base64'] }; }
    const v = store.get(x);
    return v ? { owner: v.owner, executable: v.executable, lamports: 1n, space: BigInt(v.data.length), data: [Buffer.from(v.data).toString('base64'), 'base64'] } : null;
  };
  return { calls, getAccountInfo: () => { throw new Error('standalone Clock read'); },
    getMultipleAccounts: (xs: readonly Address[], c: { minContextSlot?: bigint }) => ({ send: async () => {
      slot = (c.minContextSlot ?? 0n) > slot ? c.minContextSlot! : slot + 1n;
      const clock = xs.includes(CLOCK), clockSlot = clock ? slot + BigInt(skew(++clockCalls)) : slot;
      calls.push({ clock, size: xs.length, floor: c.minContextSlot, slot });
      return { context: { slot }, value: xs.map((x) => info(x, clockSlot)) };
    } }) };
}
const resolve = (r: ReturnType<typeof rpc>) => resolveEligiblePools(r as never, fixtureAddress(180), fixtureAddress(220), [pool]);
const floorsNeverRegress = (r: ReturnType<typeof rpc>) => r.calls.reduce((prev, c) => { assert.ok(c.floor === undefined || prev === undefined || c.floor >= prev); return c.floor ?? prev; }, undefined as bigint | undefined);

// Matched: both the initial getContext ([Clock]) and the capture read (plan accounts + Clock) succeed on their first read.
{
  const r = rpc(() => 0); sleeps.length = 0;
  const pools = await resolve(r);
  assert.equal(pools.length, 1); assert.equal(pools[0]!.pool, pool);
  const clocks = r.calls.filter((c) => c.clock);
  assert.ok(clocks.some((c) => c.size === 1) && clocks.some((c) => c.size > 1), 'getContext and capture both read Clock in a cohort');
  assert.deepEqual(sleeps, []);
}

// ±1 on getContext, then on the capture: each re-reads its whole cohort at max(floor, context, future Clock), paced 200 ms.
for (const offset of [1, -1]) for (const bad of [1, 2]) {
  const r = rpc((n) => n === bad ? offset : 0); sleeps.length = 0;
  assert.equal((await resolve(r)).length, 1);
  const clocks = r.calls.filter((c) => c.clock);
  assert.equal(clocks.length, 3); assert.deepEqual(sleeps, [200]);
  const [first, retry] = [clocks[bad - 1]!, clocks[bad]!];
  assert.equal(retry.size, first.size);
  assert.equal(retry.floor, offset > 0 ? first.slot + 1n : first.slot);
  floorsNeverRegress(r);
}

// Mismatch on all four attempts: a retryable RPC error naming the provider's Clock skew, after 200/400/800 ms.
for (const bad of [(n: number) => n >= 1 ? 1 : 0, (n: number) => n >= 2 ? -1 : 0]) {
  const r = rpc(bad); sleeps.length = 0;
  const error = await resolve(r).catch((e) => e);
  assert.ok(error instanceof MimirError, String(error)); assert.equal(error.code, 'RPC'); assert.equal(error.retry, 'later');
  assert.match(error.hint, /clock/i);
  assert.deepEqual(sleeps, [200, 400, 800]); floorsNeverRegress(r);
  const split = await resolveEligiblePoolsSplit(rpc(bad) as never, fixtureAddress(180), fixtureAddress(220), [pool]).catch((e) => e);
  assert.ok(split instanceof MimirError && split.retry === 'later', 'the split path surfaces the skew error, never an empty list');
}
// A Clock entry that does not decode is the inauthentic-Clock refusal, mapped to the same retryable RPC error; the split path never answers [].
{
  const bad = rpc(() => 0), original = bad.getMultipleAccounts;
  bad.getMultipleAccounts = (xs, c) => ({ send: async () => {
    const result = await original(xs, c).send(), index = xs.indexOf(CLOCK);
    if (index !== -1) (result.value[index] as { owner: string }).owner = 'not-a-base58-address';
    return result;
  } });
  const error = await resolve(bad).catch((e) => e);
  assert.ok(error instanceof MimirError && error.code === 'RPC' && error.retry === 'later', String(error));
  assert.match(String((error.cause as Error).message), /cohort Clock is not authentic/);
  const split = await resolveEligiblePoolsSplit(bad as never, fixtureAddress(180), fixtureAddress(220), [pool]).catch((e) => e);
  assert.ok(split instanceof MimirError && split.code === 'RPC' && split.retry === 'later', 'malformed Clock surfaces, never an empty list');
}
console.log('discovery-clock: OK');
