import assert from "node:assert/strict";
import { mock } from "node:test";
import { PublicKey } from "@solana/web3.js";
import type { Address } from "@solana/kit";

// End-to-end mock of the classic refresh-group tag-89 unit (A2 §4): sample-only while the private module matures, then publish.
const program = new PublicKey(new Uint8Array(32).fill(41)), payer = new PublicKey(new Uint8Array(32).fill(42)).toBase58() as Address;
const pda = (seed: string, ...values: (Uint8Array | number[])[]) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...values.map((v) => Buffer.from(v))], program)[0];
const b58 = (k: PublicKey) => k.toBase58() as Address;
const FEED = new Uint8Array(32).fill(5);
const ext = (n: number) => Array.from({ length: n }, (_, i) => b58(new PublicKey(new Uint8Array(32).fill(100 + i))));
const PLAN_HASH = new Uint8Array(32).fill(0xab);

const coreUrl = new URL("../src/internal/nativeMonoRefreshCore.ts", import.meta.url), core = await import(coreUrl.href);
mock.module(coreUrl.href, { namedExports: { ...core,
  decodeFeedConfigHeader: () => ({ feedConfigRevision: 7n }), decodeSourcingPlanHeader: () => ({ planHash: PLAN_HASH }) } });
const abiUrl = new URL("../src/beta/liveAbi.ts", import.meta.url), abi = await import(abiUrl.href);
mock.module(abiUrl.href, { namedExports: { ...abi,
  decodeMimirBetaLiveFeed: (d: Uint8Array) => d.length === 357 ? { ...abi.decodeMimirBetaLiveFeed(d), maxSnapshotAgeSlots: 30 } : ({ maxSnapshotAgeSlots: 30, maxSourceActivityAgeSlots: 10, feedConfigRevision: 7n, priceExponent: -8,
    defaultSourcingPlan: new Uint8Array(32), fallbackSourcingPlan: new Uint8Array(32) }) } });
const rowsUrl = new URL("../src/existingFeedRows.ts", import.meta.url), rowsModule = await import(rowsUrl.href);
mock.module(rowsUrl.href, { namedExports: { ...rowsModule,
  buildMimirExistingFeedFusedRows: async (a: { role: string }) => {
    assert.equal(a.role, "primary");
    return [{ externals: ext(8), ...(belowFloor ? { belowFloor: true } : {}) }];
  } } });
let belowFloor = false;
const { createMimirRefreshGroupBuilder } = await import("../src/refreshGroup.js");
const { buildMimirInitFusedClassicClosure, deriveMimirClassicRecipe, encodeMimirClassicPublicationProof, mimirClassicExecutionLayout, mimirClassicRefreshMode,
  decodeMimirClassicExecution } = await import("../src/beta/classicExecution.js");
const { classicExecutionImageFromSeal, sealClassicExecution, validRingV1 } = await import("./fixtures/compositeExecutionImage.js");
const { hex, sha256 } = await import("../src/beta/bytes.js");

// Tag-90 creation closure for one AMM-v4 sampled (mode 4) primary row; SEAL is what the image below materializes.
const amm = deriveMimirClassicRecipe({ role: "primary", adapterType: 4, adapterVersion: 0, externalWidth: 8, temporalModuleVersion: 4, minSlotGap: 1 });
const layout = mimirClassicExecutionLayout([amm], []);
const snapshot = pda("feed_snapshot", FEED); const execution = pda("classic_execution", FEED); const lock = pda("feed_collateral_lock", FEED);
const closure = buildMimirInitFusedClassicClosure({ programId: b58(program), payer, execution: b58(execution), collateralLock: b58(lock), snapshot: b58(snapshot),
  feedConfig: b58(pda("feed_config", FEED)), sourcingPlan: b58(pda("sourcing_plan", FEED)), registry: b58(pda("mimir_registry", [0, 0])), feedId: FEED, layout,
  witnesses: [{ feedId: FEED, sourceIndex: 0, ringVersion: 1, minSlotGap: 1, expectedSourceConfigRevision: 1n, expectedSourceSetRevision: 1n,
    expectedPlanHash: PLAN_HASH, sourceSetSiblings: [1, 2, 3].map((b) => new Uint8Array(32).fill(b)), accountsSiblings: [4, 5, 6].map((b) => new Uint8Array(32).fill(b)) }],
  primary: [{ sourceConfig: b58(pda("source_config", FEED, [0])), externals: ext(8) }] });
assert.deepEqual(closure.map((ix) => [ix.data[0], ix.data[1], ix.data.length]), [[90, 0, 40], [90, 2, 337]], "N1 AMM-v4: BEGIN + SEAL, no GROW");
assert.equal(layout.exactLength, 4_191);

const accounts = new Map<string, Uint8Array>();
const exec = sealClassicExecution(classicExecutionImageFromSeal(closure[1]!.data, b58(snapshot)), b58(program), b58(execution));
const snap = new Uint8Array(512);
accounts.set(b58(execution), exec); accounts.set(b58(snapshot), snap); accounts.set(b58(pda("feed_config", FEED)), Uint8Array.from([...new Uint8Array(16), ...FEED]));
const info = (key: PublicKey) => accounts.has(key.toBase58()) ? { owner: program, executable: false, lamports: 1, data: Buffer.from(accounts.get(key.toBase58())!) } : null;
let simulatedPost: Uint8Array | null = null;
const connection = { getAccountInfo: async (key: PublicKey) => info(key), getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(info),
  getAccountInfoAndContext: async (key: PublicKey) => ({ context: { slot: 950 }, value: info(key) }),
  getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
  _rpcRequest: async () => ({ result: { context: { slot: 950 }, value: { err: null, logs: [], unitsConsumed: 1,
    accounts: [{ data: [Buffer.from(simulatedPost!).toString("base64"), "base64"], owner: b58(program), executable: false, lamports: 1, rentEpoch: 0 }] } } }) };
const builder = createMimirRefreshGroupBuilder({ connection: connection as never, profile: { cluster: "localnet", name: "custom", programId: program } as never, payer });
const feedConfig = b58(pda("feed_config", FEED));
let matured = false;
const moduleReady = () => matured;
const cas = (data: Uint8Array) => { const v = new DataView(data.buffer, data.byteOffset); return [v.getBigUint64(35, true), v.getBigUint64(43, true), v.getBigUint64(104, true)]; };
const metas = (ix: { accounts: readonly { address: string; isWritable: boolean; isSigner: boolean }[] }) => ix.accounts.map((m: { isWritable: boolean; isSigner: boolean }) => `${m.isSigner ? "S" : ""}${m.isWritable ? "W" : "R"}`).join(",");

// 1. Cold sealed execution: the sampled module is zero, so the unit is sample-only (r/r with r = 0).
assert.equal(mimirClassicRefreshMode(decodeMimirClassicExecution(exec), moduleReady, exec), "sample");
const sample = await builder.classicSample!(feedConfig);
assert.equal(sample.instructions.length, 1);
const s89 = sample.instructions[0]!;
assert.deepEqual([s89.data[0], s89.data.length, ...cas(s89.data)], [89, 112, 0n, 0n, 0n]);
assert.equal(s89.data[93], 1);
assert.deepEqual(s89.accounts.slice(0, 3).map((m: { address: string }) => m.address), [b58(snapshot), b58(pda("mimir_registry", [0, 0])), b58(execution)]);
assert.deepEqual(s89.accounts.slice(3).map((m: { address: string }) => m.address), [...ext(8), "Sysvar1nstructions1111111111111111111111111"],
  "A2 §5: mode 4 requires the trailing Instructions sysvar");
assert.equal(metas(s89), ["W", "R", "W", ...ext(8).map(() => "R"), "R"].join(","));

// 2. Sample-only advanced the private ring; the module has matured (it stays A1.1-absent here), so the next unit publishes 0 -> 1 with the new ring CAS.
const ready = Uint8Array.from(exec); matured = true;
ready.set(validRingV1(900n), layout.rowOffsets[0]! + 400);
accounts.set(b58(execution), ready);
assert.equal(mimirClassicRefreshMode(decodeMimirClassicExecution(ready), moduleReady, ready), "publish");
const group = await builder({ kind: "classic", feedConfig });
assert.deepEqual(group.updates, []);
assert.deepEqual(cas(group.publish.instructions[0]!.data), [0n, 1n, 900n]);
assert.equal(group.check.account, b58(snapshot));

// 3. After the publish: the proof and public snapshot carry revision 1; publish is 1 -> 2 and sample-only is 1/1.
const published = Uint8Array.from(ready);
const evidence = { declaredWireAge: 30, configuredSourceCount: 1, publishedK: 1, effectiveK: 1, venueCount: 1, correlationDomainCount: 1,
  quiet: false, sampled: true, point: false, commonSupport: true, minRingNewestSlot: 901n, quietLastRefresh: 0n, quietIntervalEnd: 0n, quietIntervalEndSlot: 0n,
  quietWidthBps: 0, sampledBandBps: 40, sampledCloseDeviationBps: 5, supportStart: 1_700_000_000n, supportEnd: 1_700_000_180n, nativeFloor: 1n };
published.set(encodeMimirClassicPublicationProof({ valid: true, converterPresent: false, snapshotRevision: 1n, publicationSlot: 901n, primary: evidence, converter: null }), 128);
{
  const m = published.subarray(1_061, 1_573); const v = new DataView(m.buffer, m.byteOffset);
  m.set(FEED, 16); v.setBigUint64(96, 1n, true); m[107] = 6; v.setBigUint64(116, 901n, true); v.setUint32(156, 1_700_000_000, true); v.setUint32(160, 1_700_000_180, true);
  m[179] = 40; m[180] = 5; m[252] = 1; m[253] = 1; m[254] = 1; m[429] = 1; m[456] = 1;
}
published.set(validRingV1(901n), layout.rowOffsets[0]! + 400);
const snap1 = Uint8Array.from(snap); new DataView(snap1.buffer).setBigUint64(96, 1n, true);
accounts.set(b58(execution), published); accounts.set(b58(snapshot), snap1);
assert.deepEqual(cas((await builder({ kind: "classic", feedConfig })).publish.instructions[0]!.data), [1n, 2n, 901n]);
assert.deepEqual(cas((await builder.classicSample!(feedConfig)).instructions[0]!.data), [1n, 1n, 901n]);

// 3b. FB7: a newly below-floor primary row (Fresh predecessor) carries the simulated, request-bound Degraded publication; never Fresh capacity.
{
  const { buildTestSnapshotHeader } = await import("../src/fixtures.js");
  const { MIMIR_COND, predictMimirDegradedSnapshot } = await import("../src/liveness.js");
  const fresh = new Uint8Array(512); fresh.set(buildTestSnapshotHeader()); const v = new DataView(fresh.buffer);
  fresh.set(FEED, 16); fresh.set(pda("feed_config", FEED).toBytes(), 48); v.setBigUint64(88, 7n, true); v.setBigUint64(96, 1n, true); fresh.set(PLAN_HASH, 262); fresh[107] = 5; v.setBigInt64(132, 1_700_000_000n, true);
  const degraded = (slot: bigint) => predictMimirDegradedSnapshot(fresh, { newRevision: 2n, minSources: 1, sourceCount: fresh[252]!, snapshotSource: 5,
    clock: { slot, unixTs: 1_700_000_200n }, conditionFlags: MIMIR_COND.DEPTH_BELOW_FLOOR, powersMask: 0, conditionedSources: 1 });
  belowFloor = true;
  simulatedPost = degraded(950n);
  const g = await builder({ kind: "classic", feedConfig });
  assert.deepEqual(g.publication, { status: "degraded", conditionFlags: MIMIR_COND.DEPTH_BELOW_FLOOR, priceState: "with-price", conditionedSources: 1, belowFloorSources: [0] });
  assert.equal(g.check.expectedStatus, 0, "consumer admission stays Fresh-only");
  const code = async () => (await builder({ kind: "classic", feedConfig }).then(() => null, (e: { code?: string }) => e))?.code;
  simulatedPost = degraded(951n); assert.equal(await code(), "CLASSIC_PUBLICATION_NOT_FRESH", "future publication");
  simulatedPost = degraded(950n); simulatedPost[16]! ^= 1; assert.equal(await code(), "CLASSIC_PUBLICATION_NOT_FRESH", "wrong feed");
  belowFloor = false;
  assert.equal((await builder({ kind: "classic", feedConfig })).publication, undefined, "above floor: no simulation");
}

// 4. Fail closed: a public snapshot that disagrees with the proof, or an execution that is not active.
const snap2 = Uint8Array.from(snap); new DataView(snap2.buffer).setBigUint64(96, 2n, true);
accounts.set(b58(snapshot), snap2);
await assert.rejects(builder({ kind: "classic", feedConfig }), /ClassicExecutionStale/);
accounts.set(b58(snapshot), snap1);
const building = Uint8Array.from(published); building[123] = 0;
accounts.set(b58(execution), building);
await assert.rejects(builder({ kind: "classic", feedConfig }), /ClassicExecutionNotReady/);

// Golden: the tag-90 closure and the sample/publish tag-89 wires for this cell.
const golden = hex(await sha256(new Uint8Array([...closure.flatMap((ix) => [...ix.data]), ...s89.data, ...group.publish.instructions[0]!.data])));
assert.equal(golden, "dd320719dad24fad2c0dbda5a4782500d1db40065e88807d9fd8c457757b2106");
console.log("classic refresh-group A2 ok", golden);
