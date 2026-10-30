import assert from "node:assert/strict";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { getMultipleAccountsInfoAndContextChunked, MAX_COHORT_ATTEMPTS, setCohortSleepForTests } from "../src/chunkedAccounts.js";
import { MimirBetaError } from "../src/beta/errors.js";

const clock = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const owner = new PublicKey("Sysvar1111111111111111111111111111111111111");
const ordinary = new PublicKey(new Uint8Array(32).fill(1));
const info = (slot: number): AccountInfo<Buffer> => {
  const data = Buffer.alloc(40); data.writeBigUInt64LE(BigInt(slot)); data.writeBigInt64LE(20n, 32);
  return { data, owner, executable: false, lamports: 1 };
};
const sleeps: number[] = [];
setCohortSleepForTests(async (ms) => { sleeps.push(ms); });
const mismatch = (error: unknown) => error instanceof MimirBetaError && error.code === "RPC_CONTEXT_MISMATCH";

// Fake load-balanced RPC: the first bank context and its Clock disagree; later calls return a new coherent bank.
for (const keys of [[clock], [ordinary, clock]]) {
  const floors: (number | undefined)[] = [];
  const connection = { getMultipleAccountsInfoAndContext: async (chunk, config) => {
    floors.push(typeof config === "object" ? config.minContextSlot : undefined);
    const slot = 100 + floors.length;
    return { context: { slot }, value: chunk.map((key) => key.equals(clock) ? info(floors.length === 1 ? slot - 1 : slot) : info(slot)) };
  } } satisfies Pick<Connection, "getMultipleAccountsInfoAndContext">;
  const result = await getMultipleAccountsInfoAndContextChunked(connection, keys, { commitment: "confirmed", minContextSlot: 100 });
  assert.deepEqual(floors, [100, 101]); assert.equal(result.context.slot, 102);
  assert.ok(result.value.every((account) => account!.data.readBigUInt64LE() === 102n), "all bytes must come from the retried cohort");
}

{
  const keys = [...Array.from({ length: 100 }, (_, index) => new PublicKey(new Uint8Array(32).fill(index + 1))), clock];
  const calls: { floor: number | undefined; count: number }[] = [];
  const connection = { getMultipleAccountsInfoAndContext: async (chunk, config) => {
    calls.push({ floor: typeof config === "object" ? config.minContextSlot : undefined, count: chunk.length });
    const slot = calls.length === 1 ? 101 : calls.length === 2 ? 102 : 103;
    return { context: { slot }, value: chunk.map(() => info(slot)) };
  } } satisfies Pick<Connection, "getMultipleAccountsInfoAndContext">;
  const result = await getMultipleAccountsInfoAndContextChunked(connection, keys, { commitment: "confirmed", minContextSlot: 100 });
  assert.deepEqual(calls, [{ floor: 100, count: 100 }, { floor: 100, count: 1 }, { floor: 102, count: 100 }, { floor: 103, count: 1 }]);
  assert.equal(result.context.slot, 103); assert.ok(result.value.every((account) => account!.data.readBigUInt64LE() === 103n));
}

{
  let calls = 0;
  const connection = { getMultipleAccountsInfoAndContext: async () => {
    const slot = 100 + ++calls; return { context: { slot }, value: [info(slot - 1)] };
  } } satisfies Pick<Connection, "getMultipleAccountsInfoAndContext">;
  sleeps.length = 0;
  await assert.rejects(getMultipleAccountsInfoAndContextChunked(connection, [clock], { commitment: "confirmed" }), mismatch);
  assert.equal(calls, MAX_COHORT_ATTEMPTS); assert.deepEqual(sleeps, [200, 400, 800]);
}

// A future Clock raises the floor to its slot; > 100 accounts: a Clock mismatch re-reads every chunk, even one already at the floor.
{
  const keys = [...Array.from({ length: 100 }, (_, index) => new PublicKey(new Uint8Array(32).fill(index + 1))), clock];
  const calls: { floor: number | undefined; count: number }[] = [];
  const connection = { getMultipleAccountsInfoAndContext: async (chunk, config) => {
    const floor = typeof config === "object" ? config.minContextSlot : undefined;
    calls.push({ floor, count: chunk.length });
    const slot = calls.length <= 2 ? 101 : 105;
    return { context: { slot }, value: chunk.map((key) => info(key.equals(clock) && calls.length <= 2 ? 105 : slot)) };
  } } satisfies Pick<Connection, "getMultipleAccountsInfoAndContext">;
  sleeps.length = 0;
  const result = await getMultipleAccountsInfoAndContextChunked(connection, keys, { commitment: "confirmed", minContextSlot: 100 });
  assert.deepEqual(calls, [{ floor: 100, count: 100 }, { floor: 100, count: 1 }, { floor: 105, count: 100 }, { floor: 105, count: 1 }]);
  assert.deepEqual(sleeps, [200]);
  assert.equal(result.context.slot, 105); assert.ok(result.value.every((account) => account!.data.readBigUInt64LE() === 105n), "never mixed contexts");
}

// A retry must not weaken Clock's owner, executable, length, timestamp or context-floor checks.
for (const mutate of [
  (account: AccountInfo<Buffer>) => { account.owner = ordinary; },
  (account: AccountInfo<Buffer>) => { account.executable = true; },
  (account: AccountInfo<Buffer>) => { account.data = Buffer.alloc(39); },
  (account: AccountInfo<Buffer>) => { account.data.writeBigInt64LE(-1n, 32); },
]) {
  let calls = 0;
  const connection = { getMultipleAccountsInfoAndContext: async () => {
    calls++; const account = info(101); mutate(account); return { context: { slot: 101 }, value: [account] };
  } } satisfies Pick<Connection, "getMultipleAccountsInfoAndContext">;
  await assert.rejects(getMultipleAccountsInfoAndContextChunked(connection, [clock], { commitment: "confirmed" }), mismatch);
  assert.equal(calls, 1);
}
// Split-header handoff: the atomic fallback starts at the observed future Clock and retries an incoherent Clock on the paced schedule.
{
  const { readMimirBetaAccountCohort } = await import("../src/beta/rpc.js");
  const CLOCK = clock.toBase58(), PROGRAM_DATA = "DMawCQzbgNTmbzaESc7o6pvL1KAeetY8zA7jNpzntHhU";
  const respond = (keys: string[], slot: bigint, clockSlot: bigint) => ({ context: { slot }, value: keys.map((key) => {
    const data = Buffer.alloc(key === CLOCK ? 40 : 45);
    if (key === CLOCK) { data.writeBigUInt64LE(clockSlot); data.writeBigInt64LE(20n, 32); }
    return { owner: owner.toBase58(), executable: false, lamports: 1n, data: [data.toString("base64"), "base64"] };
  }) });
  const floors: (bigint | undefined)[] = [];
  let atomic = 0;
  const paced = { getMultipleAccounts: (keys: string[], config: { minContextSlot?: bigint }) => ({ send: async () => {
    if (keys.length === 2) { floors.push(config.minContextSlot); return atomic++ ? respond(keys, 103n, 103n) : respond(keys, 102n, 103n); }
    return keys.includes(CLOCK) ? respond(keys, 101n, 102n) : respond(keys, 100n, 0n);
  } }) };
  sleeps.length = 0;
  assert.equal((await readMimirBetaAccountCohort(paced as never, [PROGRAM_DATA, CLOCK] as never, "confirmed", 99n)).slot, 103n);
  assert.deepEqual([floors, sleeps], [[102n, 103n], [200]]);
  const behind = { getMultipleAccounts: (keys: string[]) => ({ send: async () =>
    keys.length === 2 ? respond(keys, 101n, 101n) : keys.includes(CLOCK) ? respond(keys, 101n, 102n) : respond(keys, 100n, 0n) }) };
  await assert.rejects(readMimirBetaAccountCohort(behind as never, [PROGRAM_DATA, CLOCK] as never, "confirmed", 99n), /context regressed/);
  let reads = 0; sleeps.length = 0;
  const never = { getMultipleAccounts: (keys: string[], config: { minContextSlot?: bigint }) => ({ send: async () => {
    if (keys.length !== 2) return keys.includes(CLOCK) ? respond(keys, 101n, 102n) : respond(keys, 100n, 0n);
    reads++; const slot = config.minContextSlot!; return respond(keys, slot, slot + 1n);
  } }) };
  await assert.rejects(readMimirBetaAccountCohort(never as never, [PROGRAM_DATA, CLOCK] as never, "confirmed", 99n), /did not converge/);
  assert.deepEqual([reads, sleeps], [MAX_COHORT_ATTEMPTS, [200, 400, 800]]);
}
console.log("coherentClock: OK");
