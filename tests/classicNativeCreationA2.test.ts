import assert from "node:assert/strict";
import fs from "node:fs";
import type { Address } from "@solana/kit";
import { classicRowExternals, mimirClassicCpmmNativeReadiness, mimirClassicNativeAdmitted, mimirClassicNativeRowReadiness, mimirClassicNativeTail } from "../src/beta/live.js";
import { decodeMimirClassicExecutionAccount } from "../src/beta/classicExecution.js";
import { deriveMimirBetaPda } from "../src/beta/abi.js";
import { addressBytes, bytesAddress } from "../src/beta/bytes.js";
import { MimirBetaError } from "../src/beta/errors.js";

// Native-bounded classic creation: per-family native tail, program-parity readiness, no spot fallback; S=1 DLMM-native converter digest.
const key = (n: number) => bytesAddress(new Uint8Array(32).fill(n));
const DLMM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo" as Address;
const DLMM_PD = "HZcJwcJ2njPDxZtpPoKnF8v2w9QAx2rS7TdJPSRkbEhu" as Address;
const CPMM = "CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW" as Address;
const NOW = 1_800_000_000n;
const POOL = key(13);
const [ORACLE] = await deriveMimirBetaPda({ programId: DLMM, seed: "oracle", values: [addressBytes(POOL)] });
const pool = (adapterType: number, extra: object = {}) => ({ pool: POOL, programId: adapterType === 3 ? DLMM : CPMM,
  creation: { adapterType, adapterVersion: 0, observationState: key(15) }, readPlan: { auxiliary: [{ role: "clmm-observation", address: key(16) }] }, ...extra }) as never;
const account = (owner: Address, data: Uint8Array) => ({ address: key(0), owner, executable: false, lamports: 1n, data });

assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(mimirClassicNativeAdmitted), [false, true, true, true, false, false, false, false]);
assert.deepEqual(await mimirClassicNativeTail(pool(3)), [ORACLE, DLMM, DLMM_PD]);
assert.deepEqual(await mimirClassicNativeTail(pool(1)), [key(16)]);
assert.deepEqual(await mimirClassicNativeTail(pool(2)), []);
await assert.rejects(mimirClassicNativeTail(pool(0)), (e: unknown) => e instanceof MimirBetaError && e.code === "INVALID_ARGUMENT");

function oracle(entries: readonly (readonly [bigint, bigint])[]): Uint8Array {
  const d = new Uint8Array(32 + 32 * entries.length); const v = new DataView(d.buffer);
  d.set([139, 194, 131, 179, 140, 179, 229, 244]);
  v.setBigUint64(8, BigInt(entries.length - 1), true); v.setBigUint64(16, BigInt(entries.length), true); v.setBigUint64(24, BigInt(entries.length), true);
  entries.forEach(([created, updated], i) => { v.setBigUint64(32 + 32 * i + 16, NOW - created, true); v.setBigUint64(32 + 32 * i + 24, NOW - updated, true); });
  return d;
}
const lbPair = new Uint8Array(904); lbPair.set(addressBytes(ORACLE), 552);
const dlmmReadiness = (data: Uint8Array | null, owner = DLMM) => mimirClassicNativeRowReadiness({ row: 0, pool: pool(3), poolAccount: account(DLMM, lbPair),
  observation: ORACLE, observationAccount: data && account(owner, data), nowUnix: NOW, cluster: "mainnet" });

const ready = dlmmReadiness(oracle([[400n, 300n], [250n, 150n], [100n, 10n]]));
assert.deepEqual([ready.ready, ready.ageSecs, ready.maxEligibleSpanSecs], [true, 10n, 290n]);
const gap = dlmmReadiness(oracle([[450n, 350n], [300n, 250n], [100n, 10n]]));
assert.deepEqual([gap.ready, gap.lastUpdate, gap.oldestSpanSecs], [false, NOW - 10n, 240n], "a >120 s creation gap is not ready (program returns None)");
// e9e904e: a 61–120 s tail extends the window to now; > 120 s is stale, with no ready estimate.
for (const tail of [61n, 120n]) assert.equal(dlmmReadiness(oracle([[400n, 300n], [250n, 150n], [tail + 5n, tail]])).ready, true, `tail ${tail}s is ready`);
const staleDlmm = dlmmReadiness(oracle([[400n, 300n], [250n, 150n], [130n, 121n]]));
assert.deepEqual([staleDlmm.ready, staleDlmm.reason, staleDlmm.readyAtUnixTs], [false, "stale-oracle", undefined], "a stale oracle is not ready");
assert.equal(dlmmReadiness(null).ready, false);
assert.throws(() => dlmmReadiness(oracle([[100n, 10n]]), CPMM), (e: unknown) => e instanceof MimirBetaError && e.code === "PLAN_STALE");
assert.throws(() => mimirClassicNativeRowReadiness({ row: 0, pool: pool(3), poolAccount: account(DLMM, new Uint8Array(904)), observation: ORACLE,
  observationAccount: account(DLMM, oracle([[100n, 10n]])), nowUnix: NOW, cluster: "mainnet" }), /PLAN_STALE/);

const cpmmObservation = new Uint8Array(4_075); { const v = new DataView(cpmmObservation.buffer);
  cpmmObservation.set([122, 174, 197, 53, 129, 9, 165, 132]); cpmmObservation[8] = 1; v.setUint16(9, 1, true); cpmmObservation.set(addressBytes(POOL), 11);
  v.setBigUint64(43, NOW - 300n, true); v.setBigUint64(83, NOW - 5n, true); v.setBigUint64(4_043, NOW - 5n, true); }
const cpmm = mimirClassicNativeRowReadiness({ row: 1, pool: pool(2), poolAccount: null, observation: key(15),
  observationAccount: account(CPMM, cpmmObservation), nowUnix: NOW, cluster: "mainnet" });
assert.deepEqual([cpmm.row, cpmm.ready, cpmm.maxEligibleSpanSecs], [1, true, 295n]);

// e9e904e `native_cpmm_history_ready` vectors: once the last update is > 60 s old the span is measured from now.
{
  const obs = (ts: readonly bigint[], lastUpdate: bigint) => { const d = new Uint8Array(4_075); const v = new DataView(d.buffer);
    d.set([122, 174, 197, 53, 129, 9, 165, 132]); d[8] = 1; v.setUint16(9, ts.length - 1, true); d.set(addressBytes(POOL), 11);
    ts.forEach((t, i) => { v.setBigUint64(43 + 40 * i, t, true); d[43 + 40 * i + 8] = 1; }); v.setBigUint64(4_043, lastUpdate, true); return d; };
  const ready = (ts: readonly bigint[], last: bigint, now: bigint) => mimirClassicCpmmNativeReadiness(obs(ts, last), now).ready;
  const base = [1_000n, 1_001n, 1_135n];
  assert.deepEqual([1_195n, 1_196n, 2_935n, 2_936n].map((now) => ready(base, 1_135n, now)), [true, true, true, false], "ready at +61 s … +1800 s, not +1801 s");
  assert.equal(ready([1_000n, 1_001n, 1_134n], 1_134n, 1_134n), true);
  const fresh = mimirClassicCpmmNativeReadiness(obs([1_001n, 1_134n], 1_134n), 1_134n);
  assert.deepEqual([fresh.ready, fresh.readyAtUnixTs], [false, 1_195n], "short history: oldest recent entry + 134 s, never before the last update + 61 s");
  assert.equal(mimirClassicCpmmNativeReadiness(obs(base, 1_135n), 2_936n).readyAtUnixTs, undefined, "no entry within 1800 s: no estimate");
  const ring: bigint[] = [];
  for (let step = 0n; step < 150n; step += 1n) { ring.push(1_000n + step * 15n); if (ring.length > 100) ring.shift(); }
  const resume = 1_000n + 150n * 15n + 13n * 3_600n;
  for (let now = resume; now <= resume + 300n; now += 15n) {
    ring.push(now); if (ring.length > 100) ring.shift();
    assert.equal(ready(ring, now, now), now - resume >= 135n, `idle 13 h, then ${now - resume}s of trading`);
  }
  // Recorded mainnet histories (native-ready-spec R2/R3): the SDK at 094677d3 called these not ready; the deployed rule says ready.
  const rec = JSON.parse(fs.readFileSync(new URL("./fixtures/native-ready-cpmm-history.json", import.meta.url), "utf8"));
  for (const [label, r] of Object.entries(rec.reads) as [string, { clockUnix: number; lastUpdateAgo: string; entryAgo: string[] }][]) {
    const now = BigInt(r.clockUnix);
    assert.equal(ready(r.entryAgo.map((x) => now - BigInt(x)).reverse(), now - BigInt(r.lastUpdateAgo), now), true, `${label} ready`);
  }
}

const nativeLoaded = { adapterAccounts: [[key(1), key(2), key(3), key(4), ORACLE, DLMM, DLMM_PD]], cpmmPins: [key(31), key(32)] } as never;
const d = (externalWidth: number, mode: number) => ({ adapterType: 3, adapterVersion: 0, mode, externalWidth, temporalKind: 0 }) as never;
assert.deepEqual(classicRowExternals([d(4, 1)], nativeLoaded), [[key(1), key(2), key(3), key(4)]], "a spot row ignores a loaded native tail");
assert.deepEqual(classicRowExternals([d(7, 2)], nativeLoaded), [[key(1), key(2), key(3), key(4), ORACLE, DLMM, DLMM_PD]]);

// M1h mainnet ELF output: X/SOL classic with one DLMM-native converter row (S=1). The program hashes converter FeedConfig bytes [48,80).
const real = JSON.parse(fs.readFileSync(new URL("./fixtures/m1h-classic-s1-dlmm-native-execution.json", import.meta.url), "utf8"));
const state = await decodeMimirClassicExecutionAccount({ programId: real.owner, address: real.address, owner: real.owner,
  data: Uint8Array.from(Buffer.from(real.hex, "hex")), requireActive: true });
assert.deepEqual([state.componentCount, state.converterSourceCount, state.converter!.sources[0]!.descriptor.mode, state.converter!.sources[0]!.descriptor.externalWidth],
  [1, 1, 2, 7]);
console.log("classic native creation A2 ok");

// Split classic:ready writes the same snapshot codec as the fused activation: native-bounded/interval rows publish a source-5 snapshot.
{
  const { mimirClassicSnapshotCodec } = await import("../src/beta/creation.js");
  assert.equal(mimirClassicSnapshotCodec([null, null], [null, null]), "feed-snapshot-v0");
  assert.equal(mimirClassicSnapshotCodec([null, [key(16)]], [null, null]), "bounded-feed-snapshot-v5");
  assert.equal(mimirClassicSnapshotCodec([null], ["orca-marker-quiet"]), "bounded-feed-snapshot-v5");
}

{
  const { mimirClassicNativeRebuild } = await import("../src/beta/live.js");
  assert.deepEqual(mimirClassicNativeRebuild(3, ready), { state: "ready", aboutSecs: 0n });
  const short = dlmmReadiness(oracle([[100n, 80n], [70n, 10n]]));
  assert.deepEqual([short.reason, mimirClassicNativeRebuild(3, short)], ["history-too-short", { state: "history-rebuilding", aboutSecs: 160n }]);
  assert.deepEqual(mimirClassicNativeRebuild(3, gap), { state: "history-rebuilding", aboutSecs: 230n }, "after a gap: readyAt − now");
  assert.deepEqual([short.readyAtUnixTs, gap.readyAtUnixTs], [NOW + 160n, NOW + 230n], "fresh endpoint: ready once the connected history spans 240 s");
  assert.deepEqual(mimirClassicNativeRebuild(3, staleDlmm),
    { state: "waiting-for-activity", aboutSecs: null }, "a stale oracle waits for a DEX update, no countdown");
  console.log("dlmm native rebuild state ok");
}
