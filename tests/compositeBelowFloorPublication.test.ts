import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { Address } from "@solana/kit";
import { mimirCompositePublicationOutcome } from "../src/beta/refreshPlanner.js";
import { mimirCompositeBelowFloorPublication } from "../src/refreshGroup.js";
import { MimirBetaError, MimirBetaSimulationError, MimirBetaStalePreparationError } from "../src/beta/errors.js";
import { mimirBetaAllCaptureScanDescriptors } from "../src/beta/capture.js";
import { encodeMimirFusedRefreshData } from "../src/beta/compositeExecution.js";
import { bytesAddress } from "../src/beta/bytes.js";
import { decodeMimirBrowserCompositePublication, decodeMimirBrowserCompositeSnapshotHeader } from "../src/internal/nativeMonoRefreshCore.js";

// Exact-ELF 0adaf281 tag-87 CSP pre/post states (cells 148/197), liquidity/4 at the same price.
type Step = { pre: string; post: string | null; result: string };
type Case = { programId: Address; payer: Address; snapshot: Address; belowFloor: Step; sustained: Step; recovered: Step; malformed: Step };
const fixture = JSON.parse(readFileSync(new URL("./fixtures/compositeDegraded0adaf281.json", import.meta.url), "utf8")) as { cases: Record<string, Case> };
const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));
const rev = (b: Uint8Array) => Buffer.from(b).readBigUInt64LE(96);
const slot = (b: Uint8Array) => Buffer.from(b).readBigUInt64LE(112);
const bind = (post: Uint8Array, minRevision: bigint) => ({ feedId: post.subarray(16, 48), config: bytesAddress(post.subarray(48, 80)), configRevision: 1n,
  minRevision, contextSlot: slot(post), maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150 });

const rows = { "148-orca-component": [0x02, [1]], "197-orca-component": [0x02, [1]], "197-clmm-converter": [0x80, [7]] } as const;
for (const [name, c] of Object.entries(fixture.cases)) {
  const [mask, below] = rows[name as keyof typeof rows];
  for (const step of [c.belowFloor, c.sustained]) {
    const pre = bytes(step.pre), post = bytes(step.post!);
    assert.deepEqual(mimirCompositePublicationOutcome(post, below, bind(post, rev(pre) + 1n)), { status: "degraded", conditionFlags: 0x20, rowsMask: mask,
      powersMask: Buffer.from(post).readUInt16LE(316), priceState: "with-price", conditionedSources: mask, belowFloorSources: below }, name);
    assert.throws(() => mimirCompositePublicationOutcome(post, below, bind(post, rev(post) + 1n)), /revision/, `${name} unadvanced`);
    for (const [at, value] of [[105, 4], [314, 0x40], [318, 0], [319, 1], [216, 1], [232, 1], [168, 0]] as const) {
      const bad = Uint8Array.from(post); bad[at] = value;
      if (at === 168) bad.fill(0, 168, 184);
      assert.throws(() => mimirCompositePublicationOutcome(bad, below, bind(post, rev(pre) + 1n)), `${name} mutation @${at}`);
    }
  }
  for (const step of [c.belowFloor, c.sustained]) {
    const post = bytes(step.post!), decoded = decodeMimirBrowserCompositePublication(post);
    assert.deepEqual([decoded.status, decoded.routeabilityStatus, decoded.degraded?.rowsMask], [1, 5, mask], `${name} publication decode`);
    assert.throws(() => decodeMimirBrowserCompositeSnapshotHeader(post), `${name} consumer decode stays Fresh-only`);
  }
  assert.equal(decodeMimirBrowserCompositePublication(bytes(c.recovered.post!)).degraded, null, `${name} recovered decode`);
  const recovered = bytes(c.recovered.post!);
  assert.deepEqual(mimirCompositePublicationOutcome(recovered, [], bind(recovered, rev(bytes(c.recovered.pre)) + 1n)), { status: "fresh" }, `${name} recovered`);
  const dirty = Uint8Array.from(recovered); dirty[314] = 0x20;
  assert.throws(() => mimirCompositePublicationOutcome(dirty, [], bind(recovered, 0n)), `${name} fresh with conditions`);
  assert.equal(c.malformed.post, null); assert.match(c.malformed.result, /Custom\(54\)/);
}

// Exact-ELF 97df1a34 Degraded NO_PRICE CSPs (cell replay): retained price aged out, predecessor carried, byte 319 = 2, clocks expired.
const noPrice = JSON.parse(readFileSync(new URL("./fixtures/compositeNoPrice97df1a34.json", import.meta.url), "utf8")) as
  { cases: Record<string, { post: string; contextSlot: string; rowsMask: number }> };
for (const [name, n] of Object.entries(noPrice.cases)) {
  const post = bytes(n.post), at = { ...bind(post, rev(post)), contextSlot: BigInt(n.contextSlot) };
  assert.ok(at.contextSlot > Buffer.from(post).readBigUInt64LE(120), `${name} carried validity expired`);
  assert.deepEqual(decodeMimirBrowserCompositePublication(post).degraded, { conditionFlags: 0x20, powersMask: Buffer.from(post).readUInt16LE(316), rowsMask: n.rowsMask, noPrice: true }, name);
  assert.deepEqual(mimirCompositePublicationOutcome(post, [1], at), { status: "degraded", conditionFlags: 0x20, rowsMask: n.rowsMask,
    powersMask: Buffer.from(post).readUInt16LE(316), priceState: "no-price", conditionedSources: n.rowsMask, belowFloorSources: [1] }, name);
  assert.throws(() => mimirCompositePublicationOutcome(post, [], { ...at, minRevision: rev(post) + 1n }), /revision/, `${name} unadvanced`);
  for (const [o, v] of [[319, 1], [319, 3], [104, 0], [216, 1]] as const) { const bad = Uint8Array.from(post); bad[o] = v; assert.throws(() => mimirCompositePublicationOutcome(bad, [], at), `${name} @${o}=${v}`); }
  assert.throws(() => decodeMimirBrowserCompositeSnapshotHeader(post), `${name} consumer decode stays Fresh-only`);
}

// Simulated publish: Degraded post-state -> outcome; Custom(54): retained price older than the age bound, or another ring refusal.
const c = fixture.cases["197-clmm-converter"]!;
const pre = bytes(c.belowFloor.pre), post = bytes(c.belowFloor.post!);
const connection = (value: object) => ({ getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
  _rpcRequest: async () => ({ result: { context: { slot: Number(slot(post)) }, value } }) }) as unknown as Connection;
const account = (b64: string) => ({ data: [b64, "base64"], owner: c.programId, executable: false, lamports: 1, rentEpoch: 0 });
const data = encodeMimirFusedRefreshData({ compositeFeedId: pre.subarray(16, 48), expectedConfigRevision: 1n, previousSnapshotRevision: rev(pre),
  nextSnapshotRevision: rev(pre) + 1n, componentSourceConfigRevisions: [1n], maxRefreshFeeLamports: 0n, componentRingNewestSlots: [slot(pre)], converterRingNewestSlots: [slot(pre)] });
const call = (value: object, retainedSlots?: (readonly [number, bigint])[]) => mimirCompositeBelowFloorPublication(connection(value), { payer: c.payer, programId: c.programId, commitment: "confirmed",
  instruction: { programAddress: c.programId, accounts: [{ address: c.payer, isSigner: true, isWritable: true }, { address: c.snapshot, isSigner: false, isWritable: true },
    { address: bytesAddress(pre.subarray(48, 80)), isSigner: false, isWritable: false }], data },
  snapshot: c.snapshot, belowFloorSources: [7], minContextSlot: slot(post), ageLimits: { maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150 }, retainedSlots });
assert.equal((await call({ err: null, logs: [], accounts: [account(c.belowFloor.post!)], unitsConsumed: 205189 })).status, "degraded");
const code = async (value: object, retained?: (readonly [number, bigint])[]) => (await call(value, retained).then(() => null, (e: unknown) => e) as MimirBetaError | null)?.code;
const ring54 = { err: { InstructionError: [0, { Custom: 54 }] }, logs: [], accounts: null };
assert.equal(await code(ring54), "SOURCE_RING_REFUSED");
assert.equal(await code(ring54, [[1, slot(post) - 150n]]), "SOURCE_RING_REFUSED", "retained price at the bound");
assert.equal(await code(ring54, [[1, slot(post) - 151n]]), "SOURCE_BELOW_FLOOR_UNPUBLISHABLE", "retained price aged out");
const noRows = bytes(c.belowFloor.post!); noRows[318] = 0;
assert.equal(await code({ err: null, logs: [], accounts: [account(Buffer.from(noRows).toString("base64"))] }), "COMPOSITE_PUBLICATION_NOT_FRESH");
console.log("compositeBelowFloorPublication: ok");

// Custom 46 (CLMM tick-array window): a moved window is typed PREPARATION_STALE; an unchanged window keeps the hard error.
{
  const clmmProgram = mimirBetaAllCaptureScanDescriptors().find((d) => d.family === "raydium-clmm")!.programId as Address;
  const pool = "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj" as Address;
  const poolData = (tick: number) => { const d = new Uint8Array(1544), v = new DataView(d.buffer); v.setUint16(235, 1, true); v.setInt32(269, tick, true); return d; };
  const observed = new Map([[pool, { address: pool, owner: clmmProgram, executable: false, lamports: 1n, data: poolData(0) }]]);
  const conn = (tick: number) => ({ getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    _rpcRequest: async (method: string) => ({ result: { context: { slot: Number(slot(post)) }, value: method === "simulateTransaction"
      ? { err: { InstructionError: [0, { Custom: 46 }] }, logs: [`Program ${c.programId} invoke [1]`, `Program ${c.programId} failed: custom program error: 0x2e`], accounts: null }
      : null } }),
    getMultipleAccountsInfoAndContext: async () => ({ context: { slot: Number(slot(post)) },
      value: [{ data: Buffer.from(poolData(tick)), owner: new PublicKey(clmmProgram), executable: false, lamports: 1, rentEpoch: 0 }] }) }) as unknown as Connection;
  const run = (tick: number) => mimirCompositeBelowFloorPublication(conn(tick), { payer: c.payer, programId: c.programId, commitment: "confirmed",
    instruction: { programAddress: c.programId, accounts: [{ address: c.payer, isSigner: true, isWritable: true }, { address: c.snapshot, isSigner: false, isWritable: true },
      { address: bytesAddress(pre.subarray(48, 80)), isSigner: false, isWritable: false }, { address: pool, isSigner: false, isWritable: false }], data },
    snapshot: c.snapshot, belowFloorSources: [7], minContextSlot: slot(post), ageLimits: { maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150 }, observed });
  await assert.rejects(() => run(60), (e) => e instanceof MimirBetaStalePreparationError && e.address === pool);
  await assert.rejects(() => run(1), (e) => e instanceof MimirBetaSimulationError && !(e instanceof MimirBetaStalePreparationError) && e.customCode === 46);
}
