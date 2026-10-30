import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  MimirFrontierError, admitFrontier, admitOnlyB, applyFrontierBlock, decodePublicationBlock, encodeF1Block,
  frontierSelectedClipOk, frontierSupportAndFloor, publicationDigest, validateFrontier, validateOnlyBWitness, type MimirFrontierRow,
} from "../src/frontier.js";
import { validateDegradedSnapshot } from "../src/liveness.js";
import { decodeFeedSnapshotHeader } from "../src/internal/nativeMonoRefreshCore.js";

type Vector = { name: string; expect: string; source: number; status: number; stored_eligibility_gate: string; sha256: string;
  snapshot_hex: string; witness_hex?: string; snapshot_address?: string; pub_digest?: string };
const vectors = JSON.parse(readFileSync(new URL("./fixtures/frontier/VECTORS.json", import.meta.url), "utf8")) as Vector[];
const hex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const rule = (fn: () => void) => { try { fn(); return "valid"; } catch (e) { return e instanceof MimirFrontierError ? e.rule : "degraded"; } };

assert.equal(vectors.length, 52);
for (const v of vectors) {
  const s = hex(v.snapshot_hex);
  assert.equal(createHash("sha256").update(s).digest("hex"), v.sha256, v.name);
  let got = s[104] === 0 ? rule(() => validateFrontier(s)) : rule(() => validateDegradedSnapshot(s));
  if (v.witness_hex && got === "valid") got = rule(() => validateOnlyBWitness(hex(v.witness_hex!), s));
  assert.equal(got, v.expect, v.name);
  if (got === "valid" && v.witness_hex === undefined) {
    const block = decodePublicationBlock(s);
    const gate = block.kind === "f1" ? (block.recordEligible ? "eligible" : "ineligible") : "n/a";
    assert.equal(gate, v.stored_eligibility_gate, v.name);
  }
  if (v.snapshot_address) {
    assert.equal(Buffer.from(publicationDigest(new PublicKey(v.snapshot_address).toBytes(), s)).toString("hex"), v.pub_digest, v.name);
  }
}
const s5 = hex(vectors.find(v => v.name === "pos_src5_solua_like_0x81_0x82")!.snapshot_hex);
assert.equal(decodeFeedSnapshotHeader(s5).twapShortEndSlot, 0n);
assert.throws(() => decodeFeedSnapshotHeader(hex(vectors.find(v => v.name === "neg_f1_reserved_187")!.snapshot_hex)), MimirFrontierError);

const row = (index: number, kind: number, group: number, window: [bigint, bigint] | null, times: bigint[] = [], score: [bigint, bigint] = [1n, 1n]): MimirFrontierRow =>
  ({ index, kind, group, window, score: kind === 9 ? [0n, 0n, index] : [...score, index], rowFloor: window ? 32n : null, times });
const lo = 1_799_999_880n, hi = 1_800_000_000n, t13 = Array.from({ length: 13 }, (_, i) => lo + 10n * BigInt(i));
const cohort = (g: number[]) => [row(0, 0, g[0]!, null, [], [0n, 0n]), row(1, 9, g[1]!, [lo, hi], t13), row(2, 4, g[2]!, [lo, hi]), row(3, 5, g[3]!, [lo, hi])];
assert.ok(!frontierSelectedClipOk(cohort([1, 1, 2, 3]), 15n));
assert.ok(frontierSelectedClipOk(cohort([1, 4, 2, 3]), 15n));
const t16 = Array.from({ length: 16 }, (_, i) => 1_000n + 10n * BigInt(i));
assert.ok(!frontierSelectedClipOk([row(0, 9, 1, [1_000n, 1_119n], t16)], 1n) && frontierSelectedClipOk([row(0, 9, 1, [1_000n, 1_120n], t16)], 1n));
assert.ok(!frontierSelectedClipOk([row(0, 9, 1, [1_000n, 1_150n], t16.slice(0, 12))], 1n) && frontierSelectedClipOk([row(0, 9, 1, [1_000n, 1_150n], t16.slice(0, 13))], 1n));

let seed = 701;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
const range = (a: number, b: number) => a + Math.floor(rnd() * (b - a));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
type Row = MimirFrontierRow & { metaOk: boolean };
const present = (rows: Row[], mask: number) => rows.filter(r => (mask >> r.index) & 1);
const less = (a: Row["score"], b: Row["score"]) => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
function consumerSupportFloor(rows: Row[], mask: number, sampled: boolean) {
  const p = present(rows, mask);
  let support: [number, number] | null = null, floor: bigint | null = null;
  for (const r of p) {
    if (sampled && p.some(o => o.group === r.group && less(o.score, r.score))) continue;
    if (r.window) support = support ? [Math.max(support[0], Number(r.window[0])), Math.min(support[1], Number(r.window[1]))] : [Number(r.window[0]), Number(r.window[1])];
    if (sampled && r.rowFloor !== null) floor = floor === null || r.rowFloor < floor ? r.rowFloor : floor;
  }
  return { support, floor: sampled ? floor ?? 0n : null };
}
function consumerIntrinsic(rows: Row[], mask: number, sampled: boolean): boolean {
  if (!rows.every(r => r.metaOk)) return false;
  if (!sampled) return true;
  const best = new Map<number, Row>();
  for (const r of present(rows, mask)) if (!best.has(r.group) || less(r.score, best.get(r.group)!.score)) best.set(r.group, r);
  const sel = [...best.values()].filter(r => r.kind === 9);
  if (sel.length === 0) return false;
  const cs = sel.reduce((m, r) => (r.window![0] > m ? r.window![0] : m), -(1n << 63n)), ce = sel.reduce((m, r) => (r.window![1] < m ? r.window![1] : m), (1n << 63n) - 1n);
  return ce - cs >= 120n && sel.every(r => r.times.filter(t => t >= cs && t <= ce).length >= 13);
}
const W = (d: Uint8Array, a: number, n: number, v: bigint | number) => { let x = BigInt.asUintN(n * 8, BigInt(v)); for (let i = 0; i < n; i++) { d[a + i] = Number(x & 0xffn); x >>= 8n; } };
const stats = { publications: 0, cases: 0, accept: 0, mismatch: 0, supportMismatch: 0, eligibilityMismatch: 0, ineligible: 0 };
const QUIET = [4, 5, 6];
while (stats.cases < 120_000) {
  const slot = range(1_000, 5_000_000), unix = range(1_700_000_000, 1_900_000_000), src = pick([5, 6]), n = range(1, 6);
  const kinds: number[] = Array.from({ length: n }, () => pick<number>(src === 5 ? [0, 1, 2, 3, 4, 5, 6, 7, 0x81, 0x82, 0x83] : [0, 9, 9, 4, 5, 6, 0x81]));
  if (src === 6 && !kinds.includes(9)) kinds[0] = 9;
  if (src === 5 && !kinds.some(k => k !== 0)) kinds[0] = 0x81;
  if (kinds.some(k => k >= 1 && k <= 3) && kinds.some(k => k >= 0x81)) kinds.forEach((k, i) => { if (k >= 1 && k <= 3) kinds[i] = 0x81; });
  const lag = Math.min(pick([1, 2, 5, 20, 150, 400, 65535]), 3000, slot - 1);
  const ringSlots = kinds.map(() => slot - range(0, lag + 1));
  const spot = Math.max(Math.min(...ringSlots) - range(0, 3), slot - lag, 1);
  const qSlots = kinds.filter(k => QUIET.includes(k)).map(() => slot - range(0, lag + 1));
  const qEnd = kinds.filter(k => QUIET.includes(k)).map(() => unix - range(0, 61));
  const qBps = qEnd.map(() => pick([0, 1, 40, 99, 100, 500, 65535]));
  const band = kinds.filter(k => k === 9).map(() => pick([0, 1, 50, 99, 100, 101, 400]));
  const close = band.map(() => pick([0, 1, 30, 49, 50, 51, 300]));
  let mask = range(1, 1 << n);
  const rows: Row[] = kinds.map((kind, index) => {
    let st = unix - pick([60, 119, 120, 121, 240, 600, 900]), en = unix - pick([0, 0, 1, 5, 30, 60]);
    let times: bigint[] = [];
    if (kind === 9) {
      const count = range(13, 17), end = unix - pick([0, 0, 3, 15, 30, 59, 60, 61, 200, 300]);
      const t = [end - range(0, 16)];
      for (let i = 1; i < count; i++) t.push(t[i - 1]! - range(10, 16));
      t.reverse(); times = t.map(BigInt); st = t[0]!; en = Math.min(t[t.length - 1]! + range(0, 16), unix);
    }
    const pointOnly = kind === 0 && src === 6 && rnd() < 0.5;
    const econ = BigInt(range(0, 4)), cap = BigInt(range(0, 4)), src88 = pick([0n, 1n, 10n ** 6n, 10n ** 9n]), r112 = pick([0n, 5n, 10n ** 6n, 10n ** 12n]);
    return { index, kind, group: range(0, 3), window: kind === 0 ? null : [BigInt(st), BigInt(en)],
      score: kind === 9 || kind === 10 || pointOnly ? [0n, 0n, index] : [econ, cap, index],
      rowFloor: kind === 0 ? null : kind === 9 ? src88 : r112, times, metaOk: rnd() >= 0.03 };
  });
  if (!rows.some(r => (mask >> r.index) & 1 && r.kind !== 0)) mask |= 1 << rows.find(r => r.kind !== 0)!.index;
  const sampled = src === 6;
  const sdk = frontierSupportAndFloor(rows, BigInt(mask), sampled), col = consumerSupportFloor(rows, mask, sampled);
  if (!sdk.support) continue;
  stats.publications++;
  if (JSON.stringify([sdk.support, String(sdk.floor)]) !== JSON.stringify([col.support, String(col.floor)])) stats.supportMismatch++;
  const eligible = rows.every(r => r.metaOk) && (!sampled || frontierSelectedClipOk(rows, BigInt(mask)));
  const colOk = consumerIntrinsic(rows, mask, sampled);
  if (eligible !== colOk) stats.eligibilityMismatch++;
  if (!colOk) stats.ineligible++;
  const timed = [...qEnd, ...rows.filter(r => r.kind === 9).map(r => Number(r.window![1]))];
  const oldestSlot = Math.min(spot, ...ringSlots, ...qSlots);
  const s = new Uint8Array(s5);
  s[104] = 0; s[107] = src; s[252] = n;
  W(s, 116, 8, slot); W(s, 124, 8, slot + 150); W(s, 132, 8, unix); W(s, 140, 8, spot); W(s, 148, 8, spot); W(s, 294, 8, mask);
  const wireAge = pick([1, 2, 20, 150, 300]);
  const snap = applyFrontierBlock(s, encodeF1Block({ support: sdk.support, bindTag: new Uint8Array(8).fill(3), wireAge, slotLag: slot - oldestSlot,
    quietBps: Math.max(0, ...qBps), timeLag: timed.length ? Math.min(255, unix - Math.min(...timed)) : 0, band: Math.min(255, Math.max(0, ...band)),
    close: Math.min(255, Math.max(0, ...close)), kinds, eligible }), sdk.floor ?? undefined);
  const qLast = qEnd.map(e => e + range(0, unix - e + 1));
  const sEnd = rows.filter(r => r.kind === 9).map(r => Number(r.window![1]));
  for (let k = 0; k < 4; k++) {
    const nowSlot = slot + pick([0, 0, 1, 2, 5, 20, 150, 151, 400, 3000, 70000]), now = unix + pick([0, 0, 1, 10, 59, 60, 61, 120]);
    const lim = { maxAge: pick([1, 2, 20, 150, 300, 65535]), maxSourceAge: BigInt(pick([1, 2, 20, 150, 400, 3000, 65535])), maxConfidenceBps: pick([0, 40, 99, 100, 500, 65535]) };
    const clock = nowSlot >= slot && nowSlot >= spot && BigInt(nowSlot - spot) <= lim.maxSourceAge && now >= unix;
    const slotOk = (x: number) => x !== 0 && nowSlot >= x && BigInt(nowSlot - x) <= lim.maxSourceAge;
    const timeOk = (t: number) => now - t >= 0 && now - t <= 60;
    const record = clock && colOk && wireAge <= lim.maxAge && slotOk(Math.min(...ringSlots)) && slotOk(spot)
      && (!qEnd.length || (timeOk(Math.min(...qLast)) && timeOk(Math.min(...qEnd)) && slotOk(Math.min(...qSlots)) && Math.max(...qBps) <= lim.maxConfidenceBps))
      && (!sEnd.length || (timeOk(Math.min(...sEnd)) && Math.max(...band) <= Math.min(lim.maxConfidenceBps, 100) && Math.max(...close) <= Math.min(lim.maxConfidenceBps, 50)));
    const frontier = clock && admitFrontier(snap, lim, BigInt(nowSlot), BigInt(now));
    stats.cases++;
    if (record !== frontier) stats.mismatch++;
    if (record) stats.accept++;
  }
}
assert.deepEqual([stats.mismatch, stats.supportMismatch, stats.eligibilityMismatch], [0, 0, 0], JSON.stringify(stats));
assert.ok(stats.cases >= 100_000 && stats.accept > 1_000 && stats.ineligible > 1_000, JSON.stringify(stats));

const onlyb = vectors.find(v => v.name === "pos_src1_onlyb_o1_with_witness")!;
const o1 = hex(onlyb.snapshot_hex), wit = hex(onlyb.witness_hex!);
const o1Slot = new DataView(o1.buffer).getBigUint64(140, true), o1Unix = new DataView(o1.buffer).getBigInt64(132, true);
assert.ok(admitOnlyB(o1, wit, { maxAge: 150, maxSourceAge: 10n }, o1Slot, o1Unix));
assert.ok(!admitOnlyB(o1, Uint8Array.from(wit, (x, i) => (i === 130 ? 1 : x)), { maxAge: 150, maxSourceAge: 10n }, o1Slot, o1Unix));
console.log(`frontier vectors ${vectors.length}, equivalence ${JSON.stringify(stats)}`);
