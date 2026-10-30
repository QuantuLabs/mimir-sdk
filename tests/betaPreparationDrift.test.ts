import assert from "node:assert/strict";
import type { Address } from "@solana/kit";
import { buildMimirBetaPoolCreationBinding, createInjectedPoolDiscovery, type MimirBetaEligiblePool } from "../src/beta/discovery.js";
import { decodeMimirBetaCaptureCandidate, MIMIR_BETA_TOKEN_2022_PROGRAM_ID, mimirBetaCapturePoolCoreLayout, mimirBetaCaptureScanDescriptors, type MimirBetaCapturedAccount } from "../src/beta/capture.js";
import { base64, fromBase64 } from "../src/beta/bytes.js";
import { MimirBetaError, MimirBetaSimulationError, MimirBetaStalePreparationError, mimirBetaSimulationFailure } from "../src/beta/errors.js";
import { proveMimirBetaPreparationDrift, runMimirBetaRefreshEvidenceCohort, simulateExactPostAccounts } from "../src/beta/live.js";
import { compileMimirBetaTransactionV1 } from "../src/beta/transactionV1.js";
import type { MimirBetaAccount } from "../src/beta/types.js";
import { readMimirBetaAccountCohort } from "../src/beta/rpc.js";
import { isMimirBetaCohortNotConverged } from "../src/beta/index.js";
import { MAX_COHORT_ATTEMPTS } from "../src/chunkedAccounts.js";
import { fixtureAddress, makeBetaCaptureFixture } from "./fixtures/betaCaptureFixtures.js";

const CLOCK = "SysvarC1ock11111111111111111111111111111111" as Address;
const SYSVAR = "Sysvar1111111111111111111111111111111111111" as Address;

function clockData(slot: bigint, unixTimestamp: bigint): Uint8Array {
  const data = new Uint8Array(40); const view = new DataView(data.buffer);
  view.setBigUint64(0, slot, true); view.setBigInt64(32, unixTimestamp, true);
  return data;
}

const fixture = await makeBetaCaptureFixture("raydium-clmm", { seed: 611 });
const observation = fixture.fixtureAccounts.find((row) => row.fixtureRole === "clmm-observation")!;
const observationData = observation.data.slice(); const observationView = new DataView(observationData.buffer);
observationData[8] = 1; observationView.setUint16(17, 1, true); observationView.setUint32(51 + 44, 1_790_864_806, true);
const rows = new Map<Address, MimirBetaCapturedAccount>(fixture.input.accounts.map((row) =>
  [row.address, { address: row.address, owner: row.owner, executable: row.executable, data: row.address === observation.address ? observationData : row.data }]));

function discovery(clock: () => MimirBetaCapturedAccount, contextSlot: () => bigint, primary?: () => MimirBetaCapturedAccount) {
  return createInjectedPoolDiscovery({
    cluster: "mainnet-beta", evidenceTtlSlots: 5n, maxScanResultsPerFamily: 5,
    sources: [{
      layouts: mimirBetaCaptureScanDescriptors().filter((descriptor) => descriptor.family === "raydium-clmm").map(mimirBetaCapturePoolCoreLayout),
      loadProgram: async () => ({ executable: true }),
      scan: async () => [fixture.poolAccount],
    }],
    getContext: async () => ({ slot: 452_269_811n, unixTimestamp: 1_790_864_779n }),
    loadCapturePlanAccounts: async (request) => {
      const addresses = [...new Set(request.plans.flatMap((plan) => [...plan.addresses]))];
      const primaryRow = primary?.();
      return { contextSlot: contextSlot(), accounts: addresses.map((entry) => entry === CLOCK ? clock() :
        entry === fixture.poolAccount.address && primaryRow ? primaryRow : rows.get(entry)!) };
    },
  });
}
const pair = { baseMint: fixture.input.pair.baseMint, quoteMint: fixture.input.pair.quoteMint, query: "", maxPools: 1 as const };

const replay = await discovery(() => ({ address: CLOCK, owner: SYSVAR, executable: false, data: clockData(452_269_930n, 1_790_864_822n) }),
  () => 452_269_930n).searchSpotPools(pair);
assert.equal(replay.recommendedPools.length, 1);
assert.equal(replay.recommendedPools[0]!.readPlan.context.observedUnixTimestamp, 1_790_864_822n);
assert.equal(replay.recommendedPools[0]!.readPlan.context.observedSlot, 452_269_930n);

await assert.rejects(() => discovery(() => ({ address: CLOCK, owner: SYSVAR, executable: false, data: clockData(452_269_930n, 1_790_864_805n) }),
  () => 452_269_930n).searchSpotPools(pair), /InvalidRaydiumClmmObservationState/);
observationView.setUint32(51 + 44, 0, true); observationView.setBigInt64(51 + 44 + 4, 1n, true);
await assert.rejects(() => discovery(() => ({ address: CLOCK, owner: SYSVAR, executable: false, data: clockData(452_269_930n, 1_790_864_822n) }),
  () => 452_269_930n).searchSpotPools(pair), /InvalidRaydiumClmmObservationState/);
observationView.setUint32(51 + 44, 1_790_864_806, true); observationView.setBigInt64(51 + 44 + 4, 0n, true);

for (const clock of [
  { address: CLOCK, owner: fixtureAddress(9), executable: false, data: clockData(452_269_930n, 1_790_864_822n) },
  { address: CLOCK, owner: SYSVAR, executable: false, data: clockData(452_269_929n, 1_790_864_822n) },
  { address: CLOCK, owner: SYSVAR, executable: false, data: clockData(452_269_930n, 1_790_864_822n).subarray(0, 39) },
]) {
  await assert.rejects(() => discovery(() => clock, () => 452_269_930n).searchSpotPools(pair),
    (error) => error instanceof MimirBetaError && error.code === "RPC_CONTEXT_MISMATCH");
}

const selected = replay.recommendedPools[0]!;
let driftCalls = 0; let driftSlot = 452_269_940n;
const driftDiscovery = discovery(() => ({ address: CLOCK, owner: SYSVAR, executable: false, data: clockData(driftSlot, 1_790_864_830n) }),
  () => driftSlot, () => {
    const pool = rows.get(fixture.poolAccount.address)!;
    if (++driftCalls === 2) return pool;
    const data = pool.data.slice(); new DataView(data.buffer).setInt32(269, new DataView(data.buffer).getInt32(269, true) + 600_000, true);
    driftSlot += 1n; return { ...pool, data };
  });
await assert.rejects(() => driftDiscovery.revalidateSelectedPools({ pools: [selected], minContextSlot: 452_269_811n }),
  (error) => error instanceof MimirBetaStalePreparationError && error.retryable && error.reason === "source-drift" &&
    error.address === selected.pool && error.currentSlot === error.observedSlot + 1n);
assert.equal(driftCalls, 3, "a drifted frozen closure falls back to primary-first revalidation, which still refuses later drift");

const program = fixtureAddress(77); const payer = fixtureAddress(78); const pool = fixtureAddress(79);
const transaction = await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: fixtureAddress(80), lastValidBlockHeight: 10n,
  instructions: [{ programAddress: program, accounts: [{ address: pool, isSigner: false, isWritable: false }], data: Uint8Array.of(83) }] });
const before = new Map<Address, MimirBetaAccount>([[pool, { address: pool, owner: fixtureAddress(81), executable: false, lamports: 1n, data: Uint8Array.of(1, 2) }],
  [CLOCK, { address: CLOCK, owner: SYSVAR, executable: false, lamports: 1n, data: clockData(100n, 1_000n) }]]);
const rpcAccount = (account: MimirBetaAccount) => ({ owner: account.owner, executable: false, lamports: Number(account.lamports), data: [base64(account.data), "base64"] });
const ix = [{ programAddress: program, accounts: [{ address: pool, isSigner: false, isWritable: false }], data: Uint8Array.of(83) }];
function rpc(currentSlot: bigint, poolData: Uint8Array, code = 54, failedProgram: Address = program,
  clock: MimirBetaAccount = { ...before.get(CLOCK)!, data: clockData(currentSlot, 1_040n) }) {
  return {
    simulateTransaction: () => ({ send: async () => ({ context: { slot: 105 }, value: { err: { InstructionError: [0, { Custom: code }] },
      logs: [`Program ${failedProgram} invoke [1]`, `Program ${failedProgram} failed: custom program error: 0x${code.toString(16)}`], accounts: null } }) }),
    getMultipleAccounts: (addresses: readonly Address[]) => ({ send: async () => ({ context: { slot: currentSlot }, value: addresses.map((entry) =>
      entry === CLOCK ? { ...rpcAccount(clock), executable: clock.executable } : rpcAccount({ ...before.get(pool)!, data: poolData })) }) }),
  } as never;
}
const simulate = (client: never) => simulateExactPostAccounts(client, transaction.serializedTransaction, 100n, program, [pool], "confirmed")
  .catch((error: unknown) => proveMimirBetaPreparationDrift(client, before, 100n, program, "confirmed", error, ix));

await assert.rejects(() => simulate(rpc(106n, Uint8Array.of(1, 3))), (error) => error instanceof MimirBetaStalePreparationError &&
  error.code === "PREPARATION_STALE" && error.reason === "source-drift" && error.address === pool && error.observedSlot === 100n &&
  error.currentSlot === 106n && error.observedUnixTimestamp === 1_000n && error.currentUnixTimestamp === 1_040n);
for (const client of [rpc(106n, Uint8Array.of(1, 2)), rpc(100n, Uint8Array.of(1, 3)), rpc(106n, Uint8Array.of(1, 3, 4))]) {
  await assert.rejects(() => simulate(client), (error) => error instanceof MimirBetaSimulationError && !(error instanceof MimirBetaStalePreparationError) &&
    error.customCode === 54 && error.instructionIndex === 0 && error.programId === program && error.logs.length === 2);
}
// No retained authenticated DLMM pool closure means Custom 3 stays structural.
for (const [code, failedProgram] of [[3, program], [99_999, program], [1, fixtureAddress(82)]] as const) {
  await assert.rejects(() => simulate(rpc(106n, Uint8Array.of(1, 3), code, failedProgram)), (error) =>
    error instanceof MimirBetaSimulationError && error.code === "SIMULATION_FAILED" && error.customCode === code && error.programId === failedProgram);
}
// Custom 46 (CLMM canonical tick-array window): a moved window is typed stale drift, even in the same slot; an unchanged window keeps the hard error.
{
  const clmm = { ...fixture.poolAccount, lamports: 1n } as MimirBetaAccount, at = clmm.address, ix46 = [{ ...ix[0]!, accounts: [{ address: at, isSigner: false, isWritable: false }] }];
  const tick = (shift: number) => { const data = clmm.data.slice(), v = new DataView(data.buffer); v.setInt32(269, v.getInt32(269, true) + shift * v.getUint16(235, true) * 60, true); return data; };
  const client46 = (data: Uint8Array) => ({ ...(rpc(100n, data, 46) as object), getMultipleAccounts: () => ({ send: async () => ({ context: { slot: 100 }, value: [rpcAccount({ ...clmm, data })] }) }) }) as never;
  const prove = (data: Uint8Array) => simulateExactPostAccounts(client46(data), transaction.serializedTransaction, 100n, program, [pool], "confirmed")
    .catch((error: unknown) => proveMimirBetaPreparationDrift(client46(data), new Map([[at, clmm]]), 100n, program, "confirmed", error, ix46));
  await assert.rejects(() => prove(tick(1)), (error) => error instanceof MimirBetaStalePreparationError && error.reason === "source-drift" && error.address === at);
  await assert.rejects(() => prove(tick(0)), (error) => error instanceof MimirBetaSimulationError && !(error instanceof MimirBetaStalePreparationError) && error.customCode === 46);
}
await assert.rejects(() => simulate(rpc(106n, Uint8Array.of(1, 3), 54, program,
  { address: CLOCK, owner: fixtureAddress(83), executable: true, lamports: 1n, data: clockData(999n, 4_000n) })),
  (error) => error instanceof MimirBetaError && error.code === "RPC_CONTEXT_MISMATCH");
await assert.rejects(() => simulate(rpc(106n, Uint8Array.of(1, 3), 54, program, { ...before.get(CLOCK)!, data: clockData(105n, 1_040n) })),
  (error) => error instanceof MimirBetaError && error.code === "RPC_CONTEXT_MISMATCH");

function oldBase64(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  return globalThis.btoa(binary);
}
function oldFromBase64(value: string): Uint8Array | null {
  let binary: string;
  try { binary = globalThis.atob(value); } catch { return null; }
  const out = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return oldBase64(out) === value ? out : null;
}
function newFromBase64(value: string): Uint8Array | null {
  try { return fromBase64(value); } catch (error) { assert(error instanceof MimirBetaError && error.code === "INVALID_ARGUMENT"); return null; }
}
let seed = 0x9e3779b9;
const random = (limit: number) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % limit; };
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=-_ \n\t.éĀ";
const inputs = ["", "=", "==", "===", "====", "A", "AA", "AA=", "AA==", "AB==", "AAA=", "AAB=", "A===", "AA=A", "=AAA", "AAAA====", " AAAA", "AAAA\n", "AA==AAAA"];
for (let round = 0; round < 20_000; round += 1) {
  const bytes = Uint8Array.from({ length: random(40) }, () => random(256));
  const encoded = base64(bytes);
  assert.equal(encoded, oldBase64(bytes));
  inputs.push(encoded);
  if (encoded.length > 0) {
    const chars = [...encoded]; chars[random(chars.length)] = alphabet[random(alphabet.length)]!; inputs.push(chars.join(""));
    inputs.push(encoded.slice(0, random(encoded.length)));
    inputs.push(encoded.replace(/=+$/, ""));
  }
  inputs.push(Array.from({ length: random(13) }, () => alphabet[random(alphabet.length)]).join(""));
}
const large = Uint8Array.from({ length: 200_003 }, (_, index) => (index * 31) & 255);
assert.equal(base64(large), oldBase64(large)); inputs.push(base64(large));
for (const input of inputs) assert.deepEqual(newFromBase64(input), oldFromBase64(input), JSON.stringify(input.slice(0, 64)));

{
  const program = fixtureAddress(41), payer = fixtureAddress(42);
  const cohortRun = (failedIndex: number, _warmingConverter: boolean) => {
    const rpc = {
      getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: fixtureAddress(43), lastValidBlockHeight: 9n } }) }),
      simulateTransaction: () => ({ send: async () => ({ context: { slot: 105 }, value: {
        err: { InstructionError: [failedIndex, { Custom: 15 }] }, logs: [], accounts: null } }) }),
    };
    const ix = (tag: number) => ({ programAddress: program, data: Uint8Array.of(tag), accounts: [] });
    const feeds = [{ feedId: 1, instructions: [ix(77), ix(77), ix(60)] }, { feedId: 2, instructions: [ix(77), ix(83)] }];
    return runMimirBetaRefreshEvidenceCohort({ rpc, deployment: { cluster: "devnet" } } as never, payer, feeds.map((feed) => async (cohort) => {
      await cohort.simulate({ instructions: feed.instructions, minContextSlot: 100n, expectedProgram: program, addresses: [] })
        .catch((error: unknown) => {
          assert.ok(error instanceof MimirBetaSimulationError && error.instructionIndex === failedIndex);
          throw Object.assign(new Error(`feed ${feed.feedId} failed`), { feedId: feed.feedId });
        });
    }));
  };
  await assert.rejects(cohortRun(1, true), (error) => (error as { feedId?: number }).feedId === 1);
  await assert.rejects(cohortRun(3, false), (error) => (error as { feedId?: number }).feedId === 2);
}

{
  const program = fixtureAddress(41), payer = fixtureAddress(42);
  const ix = (tag: number) => ({ programAddress: program, data: Uint8Array.of(tag), accounts: [] });
  const revisedRun = (revise: (failure: MimirBetaSimulationError) => Promise<readonly ReturnType<typeof ix>[] | null>) => {
    const wires: string[] = [];
    const rpc = {
      getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: fixtureAddress(43), lastValidBlockHeight: 9n } }) }),
      simulateTransaction: (wire: string) => ({ send: async () => (wires.push(wire), { context: { slot: 105 }, value: wires.length === 1
        ? { err: { InstructionError: [4, { Custom: 15 }] }, logs: [], accounts: null }
        : { err: null, logs: [], accounts: [{ owner: SYSVAR, executable: false, lamports: 1, data: [base64(clockData(105n, 9n)), "base64"] }] } }) }),
    };
    const run = runMimirBetaRefreshEvidenceCohort({ rpc, deployment: { cluster: "devnet" } } as never, payer, [[ix(77), ix(60)], [ix(77), ix(77), ix(60)]].map((instructions, feed) =>
      (cohort) => cohort.simulate({ instructions, minContextSlot: 100n, expectedProgram: program, addresses: [CLOCK],
        ...(feed === 1 ? { revise } : {}) })));
    return { run, wires };
  };
  const seen: (number | null)[] = [];
  const ok = revisedRun(async (failure) => { seen.push(failure.instructionIndex); return [ix(77), ix(61)]; });
  const results = await ok.run;
  assert.deepEqual(seen, [2]);
  assert.equal(ok.wires.length, 2);
  assert.ok(results.every((result) => result.simulation.contextSlot === 105n && result.transaction === results[0]!.transaction));
  assert.deepEqual(fromBase64(ok.wires[1]!).includes(61), true);
  // Mainnet cohorts resolve only after a positive, limit-bounded exact simulation.
  for (const unitsConsumed of [undefined, 0, 1_400_001]) {
    const rpc = {
      getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: fixtureAddress(43), lastValidBlockHeight: 9n } }) }),
      simulateTransaction: () => ({ send: async () => ({ context: { slot: 105 }, value: { err: null, logs: [], unitsConsumed,
        accounts: [{ owner: SYSVAR, executable: false, lamports: 1, data: [base64(clockData(105n, 9n)), "base64"] }] } }) }),
    };
    await assert.rejects(runMimirBetaRefreshEvidenceCohort({ rpc, deployment: { cluster: "mainnet-beta" } } as never, payer,
      [(cohort) => cohort.simulate({ instructions: [ix(77), ix(60)], minContextSlot: 100n, expectedProgram: program, addresses: [CLOCK] })]), /no valid compute units/);
  }
  const refused = revisedRun(async () => { throw Object.assign(new Error("revise refused"), { feedId: 2 }); });
  await assert.rejects(refused.run, (error) => (error as { feedId?: number }).feedId === 2);
  assert.equal(refused.wires.length, 1);
  const declined = revisedRun(async () => null);
  await assert.rejects(declined.run, (error) => error instanceof MimirBetaSimulationError && error.instructionIndex === 4);
  assert.equal(declined.wires.length, 1);
}

console.log("beta preparation drift tests passed");

{
  const calls: { addresses: readonly Address[]; config: Record<string, unknown> }[] = [];
  const programData = "DMawCQzbgNTmbzaESc7o6pvL1KAeetY8zA7jNpzntHhU" as Address, other = fixtureAddress(90);
  const rpc = { getMultipleAccounts: (addresses: readonly Address[], config: Record<string, unknown>) => ({ send: async () => {
    calls.push({ addresses, config });
    return { context: { slot: 10n }, value: addresses.map(() => ({ owner: other, executable: false, lamports: 1n,
      data: [base64(new Uint8Array(config.dataSlice ? 45 : 7)), "base64"] })) };
  } }) };
  const read = await readMimirBetaAccountCohort(rpc as never, [programData, other], "confirmed", 5n);
  assert.deepEqual(read.value.map((entry) => entry!.data.length), [45, 7]);
  assert.deepEqual(calls.map((call) => [call.addresses, call.config.dataSlice ?? null, call.config.minContextSlot]),
    [[[other], null, 5n], [[programData], { offset: 0, length: 45 }, 5n]]);
  assert.equal(read.slot, 10n);
}

{
  const programData = "DMawCQzbgNTmbzaESc7o6pvL1KAeetY8zA7jNpzntHhU" as Address, clock = "SysvarC1ock11111111111111111111111111111111" as Address;
  const cohort = (slotFor: (header: boolean, floor: bigint | undefined) => bigint, clockLag = 0n) => {
    const calls: [boolean, bigint | undefined][] = [];
    const rpc = { getMultipleAccounts: (addresses: readonly Address[], config: Record<string, unknown>) => ({ send: async () => {
      const header = !addresses.includes(clock), floor = config.minContextSlot as bigint | undefined;
      calls.push([header, floor]);
      const slot = slotFor(header, floor);
      return { context: { slot }, value: addresses.map((entry) => {
        const data = new Uint8Array(entry === clock ? 40 : 45);
        if (entry === clock) new DataView(data.buffer).setBigUint64(0, slot - clockLag, true);
        return { owner: "Sysvar1111111111111111111111111111111111111", executable: false, lamports: 1n, data: [base64(data), "base64"] };
      }) };
    } }) };
    return { calls, read: readMimirBetaAccountCohort(rpc as never, [programData, clock], "confirmed", 5n) };
  };
  const aligned = cohort((header, floor) => header ? 11n : floor === 11n ? 11n : 10n);
  const read = await aligned.read;
  assert.equal(read.slot, 11n);
  assert.deepEqual(read.value.map((entry) => entry!.data.length), [45, 40]);
  assert.deepEqual(aligned.calls, [[false, 5n], [true, 5n], [false, 11n]]);
  const diverging = cohort((header, floor) => (floor ?? 0n) + (header ? 1n : 0n));
  assert.equal((await diverging.read).slot, 6n);
  assert.deepEqual(diverging.calls, [[false, 5n], [true, 5n], [false, 6n]]);
  let head = 10n;
  const advancing = cohort((header, floor) => header ? ++head : floor === 5n ? head : floor!);
  assert.equal((await advancing.read).slot, 11n);
  assert.deepEqual(advancing.calls, [[false, 5n], [true, 5n], [false, 11n]]);
  const unpinnable = cohort(() => ++head);
  const atomic = await unpinnable.read;
  assert.equal(atomic.slot, head);
  assert.deepEqual(unpinnable.calls.slice(2), [[false, head - 1n]]);
  assert.equal(unpinnable.calls.length, 3);
  const staleClock = cohort(() => 11n, 1n);
  await assert.rejects(staleClock.read, (error) => (error as { code?: string }).code === "RPC_CONTEXT_MISMATCH");
  assert.deepEqual(staleClock.calls, [[false, 5n], [true, 5n], [false, 11n], [true, 11n], [false, 11n], [true, 11n], [false, 11n], [true, 11n], [false, 11n], [false, 11n], [false, 11n], [false, 11n]]);
}

{
  const programData = "6naEzKeUuFh1Jeeu51NXQgr5qkXgXtc9WKNct4xynVJc" as Address, clock = "SysvarC1ock11111111111111111111111111111111" as Address;
  const pool = fixtureAddress(91), sysvar = "Sysvar1111111111111111111111111111111111111";
  const leapfrog = [456299445n, 456299444n, 456299446n, 456299447n, 456299448n];
  const cohort = (addresses: readonly Address[], atomicSlot: (floor: bigint) => bigint, atomicClockLag = 0n, programDataBytes = 10_485_760,
    poolBytes = (_atomic: boolean) => 8) => {
    const calls: { addresses: readonly Address[]; slice: number | undefined; floor: bigint | undefined; bytes: number }[] = [];
    let partitionReads = 0;
    const rpc = { getMultipleAccounts: (chunk: readonly Address[], config: Record<string, unknown>) => ({ send: async () => {
      const slice = (config.dataSlice as { offset: number; length: number } | undefined)?.length, floor = config.minContextSlot as bigint | undefined;
      if (chunk.length > 100) throw new Error("chunk limit");
      const union = chunk.length === addresses.length;
      const slot = union ? atomicSlot(floor!) : partitionReads < leapfrog.length ? leapfrog[partitionReads++]! : (partitionReads++, floor! + 1n);
      const value = chunk.map((entry) => {
        const size = entry === programData ? programDataBytes : entry === clock ? 40 : poolBytes(union);
        const data = new Uint8Array(Math.min(size, slice ?? size));
        if (entry === clock) new DataView(data.buffer).setBigUint64(0, union ? slot - atomicClockLag : slot, true);
        return { owner: entry === clock ? sysvar : "BPFLoaderUpgradeab1e11111111111111111111111", executable: false, lamports: 1n, data: [base64(data), "base64"] };
      });
      const response = { context: { slot }, value };
      calls.push({ addresses: chunk, slice, floor, bytes: JSON.stringify(response, (_, v) => typeof v === "bigint" ? String(v) : v).length });
      return response;
    } }) };
    return { calls, read: () => readMimirBetaAccountCohort(rpc as never, addresses, "confirmed", 456299444n) };
  };
  const requested = [pool, programData, clock];
  const converge = cohort(requested, (floor) => floor + 1n);
  const started = performance.now();
  const read = await converge.read();
  const ms = performance.now() - started;
  assert.equal(read.slot, 456299446n);
  assert.deepEqual(read.addresses, requested);
  assert.deepEqual(read.value.map((entry) => [entry!.address, entry!.data.length]), [[pool, 8], [programData, 45], [clock, 40]]);
  assert.equal(converge.calls.length, 3);
  const fallback = converge.calls[2]!;
  assert.deepEqual([fallback.addresses, fallback.slice, fallback.floor], [requested, 45, 456299445n]);
  assert.ok(fallback.bytes < 1_000, `bounded fallback response ${fallback.bytes} bytes`);
  console.log(`bounded prefix fallback: ${fallback.bytes} response bytes at L=${fallback.slice}, ${ms.toFixed(1)} ms total`);
  const grown = cohort(requested, (floor) => floor + 1n, 0n, 10_485_760, () => 300);
  assert.equal((await grown.read()).value[0]!.data.length, 300);
  assert.equal(grown.calls[2]!.slice, 301);
  const truncated = cohort(requested, (floor) => floor + 1n, 0n, 10_485_760, (atomic) => atomic ? 301 : 300);
  await assert.rejects(truncated.read(), (error) => error instanceof MimirBetaError && error.message === "RPC_CONTEXT_MISMATCH:cohort account may be truncated" &&
    error.address === pool && !isMimirBetaCohortNotConverged(error));
  const oversized = cohort(requested, (floor) => floor + 1n, 0n, 10_485_760, () => 65_536);
  await assert.rejects(oversized.read(), (error) => isMimirBetaCohortNotConverged(error));
  assert.equal(oversized.calls.length, 5);
  for (const [atomicSlot, lag] of [[(floor: bigint) => floor - 1n, 0n], [(floor: bigint) => floor, 1n]] as const) {
    const refused = cohort(requested, atomicSlot, lag, 64);
    await assert.rejects(refused.read(), (error) => error instanceof MimirBetaError && error.code === "RPC_CONTEXT_MISMATCH");
    assert.equal(refused.calls.length, lag ? 3 + MAX_COHORT_ATTEMPTS - 1 : 3);
  }
  const wide = cohort([...Array.from({ length: 100 }, (_, index) => fixtureAddress(index + 100)), programData, clock], (floor) => floor + 1n, 0n, 64);
  await assert.rejects(wide.read(), (error) => error instanceof MimirBetaError && /did not converge/.test(error.message));
  assert.ok(wide.calls.every((call) => call.addresses.length <= 100) && wide.calls.length < 10);
  const down = { getMultipleAccounts: () => ({ send: async () => { throw new Error("rpc down"); } }) };
  await assert.rejects(readMimirBetaAccountCohort(down as never, requested, "confirmed"), /rpc down/);
}

// Supported Token2022 DLMM vault allocations use the canonical extension parser during drift authentication.
{
  const f = await makeBetaCaptureFixture("meteora-dlmm", { seed: 979, activeId: -22_402, binStep: 1 });
  for (const length of [165, 170]) {
    const retained = new Map(f.input.accounts.map((a) => [a.address, { ...a, lamports: 1n, data: a.data.slice() }]));
    const mint = f.input.pair.baseMint, vault = f.input.expectedPlan.baseVault;
    const m = retained.get(mint)!, md = new Uint8Array(226); md.set(m.data); md[165] = 1;
    const mv = new DataView(md.buffer); mv.setUint16(166, 25, true); mv.setUint16(168, 56, true);
    mv.setBigUint64(202, 0x3ff0000000000000n, true); mv.setBigUint64(218, 0x3ff0000000000000n, true);
    retained.set(mint, { ...m, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: md });
    const v = retained.get(vault)!, vd = new Uint8Array(length); vd.set(v.data);
    if (length === 170) { vd[165] = 2; new DataView(vd.buffer).setUint16(166, 7, true); }
    retained.set(vault, { ...v, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: vd });
    for (const a of retained.values()) if (a.data.length === 10_136) a.data[16] = 1;
    const candidate = await decodeMimirBetaCaptureCandidate({ ...f.input, accounts: [...retained.values()] });
    assert.equal(candidate.adapterVersion, 1);
    const pool = { ...candidate, readPlan: f.input.expectedPlan,
      creation: buildMimirBetaPoolCreationBinding(candidate) } as unknown as MimirBetaEligiblePool;
    const old = f.input.expectedPlan.auxiliary.find((n) => n.role === "depth-bin-array" && n.index === "-321")!.address;
    const instruction = { programAddress: program, data: Uint8Array.of(89), accounts: [...pool.creation.staticAccounts.map((a) => a.address), old]
      .map((address) => ({ address, isSigner: false, isWritable: false })) };
    const current = new Map(retained), primary = retained.get(pool.pool)!, data = primary.data.slice();
    new DataView(data.buffer).setInt32(76, -22_398, true); current.set(pool.pool, { ...primary, data });
    const client = { getMultipleAccounts: (keys: readonly Address[]) => ({ send: async () => ({ context: { slot: 13n },
      value: keys.map((key) => current.has(key) ? rpcAccount(current.get(key)!) : null) }) }) };
    const failure = new MimirBetaSimulationError(mimirBetaSimulationFailure({ InstructionError: [0, { Custom: 3 }] },
      [`Program ${program} invoke [1]`, `Program ${program} failed: custom program error: 0x3`], program, [instruction]));
    const prove = () => proveMimirBetaPreparationDrift(client as never, retained, 12n, program, "confirmed", failure, [instruction], [pool]);
    await assert.rejects(prove(), MimirBetaStalePreparationError, `Token2022 vault length ${length}`);
    if (length === 170) {
      const invalid = vd.slice(); new DataView(invalid.buffer).setUint16(166, 99, true);
      current.set(vault, { ...current.get(vault)!, data: invalid });
      await assert.rejects(prove(), (error) => error === failure, "unsupported fresh TLV stays hard");
    }
  }
}

// Custom3 class closure: pin envelopes, absence, and every DLMM array authentication field.
{
  const f = await makeBetaCaptureFixture("meteora-dlmm", { seed: 980, activeId: -22_402, binStep: 1 });
  const retained = new Map(f.input.accounts.map((a) => [a.address, { ...a, lamports: 1n, data: a.data.slice() }]));
  for (const a of retained.values()) if (a.data.length === 10_136) a.data[16] = 1;
  const candidate = await decodeMimirBetaCaptureCandidate({ ...f.input, accounts: [...retained.values()] });
  const pool = { ...candidate, readPlan: f.input.expectedPlan, creation: buildMimirBetaPoolCreationBinding(candidate) } as unknown as MimirBetaEligiblePool;
  const oldKey = f.input.expectedPlan.auxiliary.find((n) => n.role === "depth-bin-array" && n.index === "-321")!.address;
  const newKey = f.input.expectedPlan.auxiliary.find((n) => n.role === "depth-bin-array" && n.index === "-320")!.address;
  const oracle = fixtureAddress(2001), programData = "DMawCQzbgNTmbzaESc7o6pvL1KAeetY8zA7jNpzntHhU" as Address;
  for (const key of [oracle, programData]) retained.set(key, { address: key, owner: program, executable: false, lamports: 1n, data: new Uint8Array(45) });
  const absent = fixtureAddress(2002);
  const instruction = { programAddress: program, data: Uint8Array.of(89), accounts:
    [...pool.creation.staticAccounts.map((a) => a.address), oldKey, oracle, programData, absent]
      .map((address) => ({ address, isSigner: false, isWritable: false })) };
  const current = new Map<Address, MimirBetaAccount | null>(retained), primary = retained.get(pool.pool)!, moved = primary.data.slice();
  new DataView(moved.buffer).setInt32(76, -22_398, true); current.set(pool.pool, { ...primary, data: moved });
  const client = { getMultipleAccounts: (keys: readonly Address[]) => ({ send: async () => ({ context: { slot: 13n },
    value: keys.map((key) => { const a = current.get(key); return a ? { ...rpcAccount(a), executable: a.executable } : null; }) }) }) };
  const failure = new MimirBetaSimulationError(mimirBetaSimulationFailure({ InstructionError: [0, { Custom: 3 }] },
    [`Program ${program} invoke [1]`, `Program ${program} failed: custom program error: 0x3`], program, [instruction]));
  const prove = () => proveMimirBetaPreparationDrift(client as never, retained, 12n, program, "confirmed", failure, [instruction], [pool], new Map([...retained, [absent, null]]));
  await assert.rejects(prove(), MimirBetaStalePreparationError, "unchanged pins and absence permit movement");
  for (const key of [oracle, programData]) {
    const good = current.get(key)!;
    for (const bad of [null, { ...good, owner: SYSVAR }, { ...good, executable: true }, { ...good, data: new Uint8Array(44) }]) {
      current.set(key, bad);
      await assert.rejects(prove(), (e) => e === failure, `pin ${key} envelope keeps original failure`);
    }
    current.set(key, good);
  }
  for (const account of [primary, { ...primary, owner: SYSVAR }, { ...primary, data: new Uint8Array(0) }]) {
    current.set(absent, { ...account, address: absent });
    await assert.rejects(prove(), (e) => e === failure, "newly present role always keeps original failure");
  }
  current.set(absent, null);
  for (const key of [oldKey, newKey]) {
    const good = current.get(key)!;
    const corrupt = (offset: number) => { const data = good.data.slice(); data[offset] ^= 0xff; return { ...good, data }; };
    for (const bad of [null, { ...good, owner: SYSVAR }, { ...good, executable: true },
      { ...good, data: good.data.slice(1) }, { ...good, data: new Uint8Array(10_137) },
      ...[0, 8, 16, 17, 24].map(corrupt)]) {
      current.set(key, bad);
      await assert.rejects(prove(), (e) => e === failure, `array ${key} metadata/schema/PDA binding keeps original failure`);
    }
    current.set(key, good);
  }
  await assert.rejects(prove(), MimirBetaStalePreparationError, "restored closure permits movement");
}
