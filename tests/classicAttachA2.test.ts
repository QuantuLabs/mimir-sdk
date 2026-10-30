import assert from "node:assert/strict";
import type { Address } from "@solana/kit";
import { classicRowExternals, mimirClassicExecutionAttachFromState, mimirClassicCpmmNativeReadiness, MimirClassicNativeNotReadyError, mimirAuthenticClockUnix } from "../src/beta/live.js";
import { deriveMimirClassicExecutionAddress, decodeMimirFusedClassicData } from "../src/beta/classicExecution.js";
import { encodeMimirFusedDescriptor } from "../src/beta/compositeExecution.js";
import { addressBytes, bytesAddress, hex } from "../src/beta/bytes.js";
import { MimirBetaError } from "../src/beta/errors.js";
import { FEED_COLLATERAL_LOCK_HEADER_LEN, FEED_COLLATERAL_LOCK_MAGIC, FEED_COLLATERAL_LOCK_OFFSETS as LO } from "../src/constants.js";

// Attach ClassicExecutionV1 to an existing N1 CPMM classic feed: [90 BEGIN, 90 SEAL, 89 r -> r+1], explicit recipe, no fallback.
const key = (n: number) => bytesAddress(new Uint8Array(32).fill(n));
const PROGRAM = "4kxKWPhWUZMj1x2D2BaCBW9BfeBZ6po4WagfzkUCsAt4" as Address;
const CPMM = "CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW" as Address;
const FEED_ID = key(9); const [B, Q, P, C, O] = [11, 12, 13, 14, 15].map(key) as [Address, Address, Address, Address, Address];
const [FEED, PLAN, SNAP, REG, SRC, LOCK] = [21, 22, 23, 24, 25, 26].map(key) as [Address, Address, Address, Address, Address, Address];
const PLAN_HASH = new Uint8Array(32).fill(0xab); const NOW = 1_800_000_000n; const R = 41n;
const loaded = {
  feedId: FEED_ID, pdas: { feed: [FEED, 255], sourcingPlan: [PLAN, 255], snapshot: [SNAP, 255], collateralLock: [LOCK, 255] }, canonical: { registry: [REG, 255] },
  plan: { minSources: 1, ringVersion: 1, accountsBindingVersion: 1, planHash: PLAN_HASH }, feed: { feedConfigRevision: 1n },
  pools: [{ pool: P, programId: CPMM, creation: { adapterType: 2, adapterVersion: 0 } }], adapterAccounts: [[B, Q, P, C, O]],
  sourceStates: [{ source: { temporalMode: "sampled-interval", sourceConfigRevision: 1n, sourceSetRevision: 1n } }],
  artifacts: { artifacts: [{ sourceConfig: SRC, sourceRootProof: [1, 2, 3].map((b) => new Uint8Array(32).fill(b)),
    accountRootProof: [4, 5, 6].map((b) => new Uint8Array(32).fill(b)) }] },
  generationCluster: "devnet", cpmmPins: [key(31), key(32)],
} as never;
function observation(lastUpdate: bigint, spans: readonly bigint[]): Uint8Array {
  const d = new Uint8Array(4_075); const v = new DataView(d.buffer);
  d.set([122, 174, 197, 53, 129, 9, 165, 132]); d[8] = 1; v.setUint16(9, spans.length - 1, true); d.set(addressBytes(P), 11);
  spans.forEach((s, i) => { v.setBigUint64(43 + 40 * i, lastUpdate - s, true); d[43 + 40 * i + 8] = i + 1; });
  v.setBigUint64(4_043, lastUpdate, true); return d;
}
const account = (owner: Address, data: Uint8Array) => ({ address: key(0), owner, executable: false, lamports: 1n, data });
const snapshot = new Uint8Array(512); new DataView(snapshot.buffer).setBigUint64(96, R, true);
const clock = new Uint8Array(40); new DataView(clock.buffer).setBigUint64(0, 900n, true); new DataView(clock.buffer).setBigInt64(32, NOW, true);
const SYSTEM = "11111111111111111111111111111111" as Address;
type Envelope = { owner: Address; data: Uint8Array; executable?: boolean } | null;
const read = (obs: Uint8Array | null, execution: Envelope = null) => ({ slot: 900n, value: [execution && { ...account(execution.owner, execution.data), executable: !!execution.executable },
  account(PROGRAM, snapshot), account("Sysvar1111111111111111111111111111111111111" as Address, clock), ...(obs ? [account(CPMM, obs)] : [])] });
const lockData = (creator: Address, status = 1, amount = 1n) => {
  const d = new Uint8Array(FEED_COLLATERAL_LOCK_HEADER_LEN); const v = new DataView(d.buffer);
  d.set(FEED_COLLATERAL_LOCK_MAGIC, LO.magic); v.setUint16(LO.headerLen, FEED_COLLATERAL_LOCK_HEADER_LEN, true);
  d.set(addressBytes(FEED_ID), LO.feedId); d.set(addressBytes(creator), LO.creator); d.set(addressBytes(Q), LO.collateralMint);
  v.setBigUint64(LO.lockedAmountRaw, amount, true); v.setBigUint64(LO.createdSlot, 1n, true); d[LO.status] = status; return d;
};
const LOCKED = account(PROGRAM, lockData(key(40)));
const attach = (recipe: string, obs: Uint8Array | null, execution: Envelope = null, lock: unknown = LOCKED) => mimirClassicExecutionAttachFromState({ loaded,
  read: read(obs, execution) as never, lock: lock as never, program: PROGRAM, payer: key(40), recipes: [recipe as never], declaredMaxSnapshotAge: 150 });
const ready = observation(NOW - 20n, [600n, 300n, 150n, 14n, 0n]);
const [execution] = await deriveMimirClassicExecutionAddress(PROGRAM, addressBytes(FEED_ID));

const native = await attach("native-bounded", ready);
assert.equal(hex(encodeMimirFusedDescriptor(native.descriptors[0]!)), "01000500000000000000020002000401");
assert.deepEqual([native.exactLength, native.mode, native.previousSnapshotRevision, native.nextSnapshotRevision], [2_781, "publish", R, R + 1n]);
assert.deepEqual(native.instructions.map((ix) => ix.data[0] === 90 ? `90.${ix.data[1]}` : `${ix.data[0]}`), ["90.0", "90.2", "89"]);
assert.deepEqual(native.instructions[0]!.accounts.map((m) => [m.address, m.isSigner, m.isWritable]), [[key(40), true, true], [execution, false, true],
  [SNAP, false, true], [SYSTEM, false, false], ["Sysvar1nstructions1111111111111111111111111", false, false], [LOCK, false, false]]);
const seal = native.instructions[1]!.accounts.map((m) => m.address);
assert.deepEqual(seal.slice(0, 13), [key(40), execution, SNAP, FEED, PLAN, REG, "11111111111111111111111111111111", SRC, B, Q, P, C, O]);
const publish = native.instructions[2]!;
assert.deepEqual(publish.accounts.map((m) => [m.address, m.isWritable]),
  [[SNAP, true], [REG, false], [execution, true], ...[B, Q, P, C, O].map((x) => [x, false])]);
const cas = decodeMimirFusedClassicData(publish.data);
assert.deepEqual([cas.previousSnapshotRevision, cas.nextSnapshotRevision, cas.ringNewestSlots], [R, R + 1n, [0n]]);
assert.equal(native.readiness[0]!.maxEligibleSpanSecs, 600n);

const spot = await attach("spot", null);
assert.equal(hex(encodeMimirFusedDescriptor(spot.descriptors[0]!)), "01000400000000000000000002000401");
assert.deepEqual(spot.instructions[2]!.accounts.slice(3).map((m) => m.address), [B, Q, P, C]);

const rejects = async (p: Promise<unknown>, code: string) => assert.rejects(p, (e: MimirBetaError) => e.code === code);
await rejects(attach("native-bounded", ready, { owner: PROGRAM, data: new Uint8Array(2_781) }), "CLASSIC_EXECUTION_EXISTS");
await rejects(attach("spot", null, { owner: PROGRAM, data: new Uint8Array(0) }), "CLASSIC_EXECUTION_EXISTS");
const prefunded = await attach("native-bounded", ready, { owner: SYSTEM, data: new Uint8Array(0) });
assert.deepEqual(prefunded.instructions.map((ix) => [...ix.data]), native.instructions.map((ix) => [...ix.data]));
assert.deepEqual(prefunded.instructions.map((ix) => ix.accounts), native.instructions.map((ix) => ix.accounts));
for (const envelope of [{ owner: CPMM, data: new Uint8Array(0) }, { owner: SYSTEM, data: new Uint8Array(1) },
  { owner: SYSTEM, data: new Uint8Array(0), executable: true }]) {
  await rejects(attach("native-bounded", ready, envelope), "ACCOUNT_MALFORMED");
}
await rejects(attach("quiet", ready), "INVALID_ARGUMENT");
await rejects(attach("native-bounded", ready, null, account(PROGRAM, lockData(key(41)))), "INIT_PAYER_NOT_FEED_CREATOR");
await rejects(attach("native-bounded", ready, null, account(PROGRAM, lockData(key(41), 2, 0n))), "INIT_PAYER_NOT_FEED_CREATOR");
const oneChar = await attach("native-bounded", ready, null, account(PROGRAM, lockData(key(40), 2, 0n)));
assert.deepEqual(oneChar.instructions.map((ix) => [...ix.data]), native.instructions.map((ix) => [...ix.data]));
for (const lock of [null, account(SYSTEM, lockData(key(40))), account(PROGRAM, new Uint8Array(160)),
  account(PROGRAM, lockData(key(40), 1, 0n)), account(PROGRAM, lockData(key(40), 2, 1n))]) await rejects(attach("native-bounded", ready, null, lock), "ACCOUNT_MALFORMED");
for (const obs of [observation(NOW - 1_801n, [600n, 0n]), observation(NOW - 5n, [133n, 0n]), observation(NOW - 5n, [1_801n, 0n])]) {
  await assert.rejects(attach("native-bounded", obs), (e: Error) => e instanceof MimirClassicNativeNotReadyError && e.code === "CLASSIC_NATIVE_NOT_READY");
}
await rejects(attach("bogus", ready), "INVALID_ARGUMENT");
assert.deepEqual(mimirClassicCpmmNativeReadiness(observation(NOW - 61n, [600n, 0n]), NOW).ageSecs, 61n);
// Recurring refresh of the attached feed rebuilds the sealed vector: native E5 keeps the observation, spot E4 drops it.
assert.deepEqual(classicRowExternals(native.descriptors, loaded), [[B, Q, P, C, O]]);
assert.deepEqual(classicRowExternals(spot.descriptors, loaded), [[B, Q, P, C]]);
// Fresh creation and refresh share one Clock authentication: executable, cohort-slot mismatch and negative timestamps refuse before readiness.
{
  const sysvar = "Sysvar1111111111111111111111111111111111111" as Address;
  const bad = (e: Error) => (e as { code?: string }).code === "RPC_CONTEXT_MISMATCH";
  assert.equal(mimirAuthenticClockUnix(account(sysvar, clock), 900n, "x"), NOW);
  assert.throws(() => mimirAuthenticClockUnix({ ...account(sysvar, clock), executable: true }, 900n, "x"), bad);
  assert.throws(() => mimirAuthenticClockUnix(account(sysvar, clock), 901n, "x"), bad);
  const negative = clock.slice(); new DataView(negative.buffer).setBigInt64(32, -1n, true);
  assert.throws(() => mimirAuthenticClockUnix(account(sysvar, negative), 900n, "x"), bad);
  assert.throws(() => mimirAuthenticClockUnix(account(SYSTEM, clock), 900n, "x"), bad);
  assert.throws(() => mimirAuthenticClockUnix(account(sysvar, clock.slice(0, 39)), 900n, "x"), bad);
  assert.throws(() => mimirAuthenticClockUnix(undefined, 900n, "x"), bad);
}
// DAMM interval attach: the explicit recipe must match the authenticated pool policy before any seal/wallet work.
{
  const DAMM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG" as Address;
  const pool = new Uint8Array(1112); pool.set([241, 154, 109, 4, 17, 177, 109, 188]); pool[484] = 1;
  pool[360] = 2; pool[552] = 1; // Preserve this test's eligible OnlyB premise.
  const dammLoaded = { ...(loaded as object), pools: [{ pool: P, programId: DAMM, creation: { adapterType: 7, adapterVersion: 0 } }] } as never;
  const dammAttach = (recipe: string) => mimirClassicExecutionAttachFromState({ loaded: dammLoaded, read: { slot: 900n, value: [...read(null).value,
    null, null, account(DAMM, pool)] } as never, lock: LOCKED as never, program: PROGRAM, payer: key(40), recipes: [recipe as never], declaredMaxSnapshotAge: 150 });
  await rejects(dammAttach("damm-reserve-interval-v3"), "CLASSIC_RECIPE_UNSUPPORTED");
  await rejects(dammAttach("damm-onlyb-interval-v1"), "PLAN_STALE");
}
console.log("classicAttachA2 ok");
