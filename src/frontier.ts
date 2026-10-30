import { sha256 } from "@noble/hashes/sha256";
import { validateDegradedSnapshot } from "./liveness.js";

export const MIMIR_FRONTIER_TAG_F1 = 0x81;
export const MIMIR_FRONTIER_TAG_O1 = 0x82;
export const MIMIR_FRONTIER_TAG_LIVENESS = 1;
export const MIMIR_FRONTIER_OFFSET_BLOCK = 156;
export const MIMIR_FRONTIER_OFFSET_ELIGIBLE = 186;
export const MIMIR_FRONTIER_OFFSET_FLOOR = 456;
export const MIMIR_FRONTIER_BIND_DOMAIN = new TextEncoder().encode("MIMIR_FRONTIER_BIND_V1");
export const MIMIR_PUBLICATION_DOMAIN = new TextEncoder().encode("MIMIR_PUBLICATION_V1");
export const MIMIR_ONLYB_WITNESS_SEED = "onlyb_witness";
export const MIMIR_ONLYB_WITNESS_MAGIC = new TextEncoder().encode("MIMIROBW");
export const MIMIR_ONLYB_WITNESS_LEN = 136;
export const MIMIR_FRONTIER_MIN_CLIP_SPAN = 120n;
export const MIMIR_FRONTIER_MIN_CLIP_RECORDS = 13;
export const TAG_INIT_ONLYB_WITNESS_V1 = 85;
const POINT_SUPPORT = 0xffff_ffff;
const KIND_CODES: Readonly<Record<number, number>> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 9: 9, 10: 0xa, 0x81: 0xb, 0x82: 0xc, 0x83: 0xd };
const KIND_OF: Readonly<Record<number, number>> = Object.fromEntries(Object.entries(KIND_CODES).map(([k, v]) => [v, Number(k)]));

const u16 = (d: Uint8Array, a: number) => d[a]! | (d[a + 1]! << 8);
const u32 = (d: Uint8Array, a: number) => (d[a]! | (d[a + 1]! << 8) | (d[a + 2]! << 16) | (d[a + 3]! << 24)) >>> 0;
const uint = (d: Uint8Array, a: number, n: number) => { let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(d[a + i]!); return v; };
const u64 = (d: Uint8Array, a: number) => uint(d, a, 8);
const i64 = (d: Uint8Array, a: number) => BigInt.asIntN(64, uint(d, a, 8));
const u128 = (d: Uint8Array, a: number) => uint(d, a, 16);
const zero = (d: Uint8Array, a: number, b: number) => d.subarray(a, b).every(x => x === 0);
const put = (d: Uint8Array, a: number, n: number, v: bigint | number) => { let x = BigInt.asUintN(n * 8, BigInt(v)); for (let i = 0; i < n; i++) { d[a + i] = Number(x & 0xffn); x >>= 8n; } };
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export type MimirFrontierRule = "not-fresh" | "tag" | "reserved" | "eligibility-code" | "count" | "unused-nibble" | "kind-code"
  | "prepared+execution" | "wire-age" | "slot-lag" | "quiet-without-kind" | "sampled-without-kind" | "time-without-kind"
  | "point-support" | "src5-kinds" | "src6-kinds" | "onlyb-mask" | "floor-without-frontier" | "point-block"
  | "witness-header" | "witness-format" | "witness-reserved" | "witness-revision" | "witness-index" | "witness-fields";

export class MimirFrontierError extends Error {
  constructor(readonly rule: MimirFrontierRule) { super(`InvalidMimirFrontier:${rule}`); }
}
const need = (ok: boolean, rule: MimirFrontierRule) => { if (!ok) throw new MimirFrontierError(rule); };

export interface MimirF1Facts {
  support: readonly [number, number]; bindTag: Uint8Array; wireAge: number; slotLag: number; quietBps: number;
  timeLag: number; band: number; close: number; kinds: readonly number[]; eligible: boolean;
}

export function encodeF1Block(f: MimirF1Facts): Uint8Array {
  const nib = [...f.kinds.map(k => { const c = KIND_CODES[k]; if (c === undefined) throw new Error("InvalidMimirFrontierKind"); return c; }), 0, 0, 0, 0, 0];
  if (f.kinds.length < 1 || f.kinds.length > 5 || f.bindTag.length !== 8) throw new Error("InvalidMimirF1Facts");
  const b = new Uint8Array(32);
  put(b, 0, 4, f.support[0]); put(b, 4, 4, f.support[1]); b.set(f.bindTag, 8);
  put(b, 16, 2, f.wireAge); put(b, 18, 2, f.slotLag); put(b, 20, 2, f.quietBps);
  b[22] = f.timeLag; b[23] = f.band; b[24] = f.close;
  b[25] = nib[0]! | (nib[1]! << 4); b[26] = nib[2]! | (nib[3]! << 4); b[27] = nib[4]!;
  b[28] = MIMIR_FRONTIER_TAG_F1; b[29] = f.kinds.length; b[30] = f.eligible ? 1 : 0;
  return b;
}

export function encodeO1Block(bindTag: Uint8Array, wireAge: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set(bindTag, 8); put(b, 16, 2, wireAge); b[28] = MIMIR_FRONTIER_TAG_O1; b[29] = 1;
  return b;
}

function validateF1(s: Uint8Array): void {
  need(s[187] === 0, "reserved");
  need(s[186]! <= 1, "eligibility-code");
  const n = s[185]!;
  need(n >= 1 && n <= 5 && n === s[252], "count");
  const nib = [s[181]! & 15, s[181]! >> 4, s[182]! & 15, s[182]! >> 4, s[183]! & 15, s[183]! >> 4];
  need(nib.slice(n).every(x => x === 0), "unused-nibble");
  need(nib.slice(0, n).every(x => KIND_OF[x] !== undefined), "kind-code");
  const kinds = new Set(nib.slice(0, n).map(x => KIND_OF[x]!));
  const has = (...ks: number[]) => ks.some(k => kinds.has(k));
  need(!(has(1, 2, 3) && has(0x81, 0x82, 0x83)), "prepared+execution");
  need(u16(s, 172) > 0, "wire-age");
  const slot = u64(s, 116), lag = BigInt(u16(s, 174)), spot = u64(s, 140), observed = u64(s, 148);
  need(lag < slot && slot - lag <= (spot < observed ? spot : observed), "slot-lag");
  need(u16(s, 176) === 0 || has(4, 5, 6), "quiet-without-kind");
  need((s[179] === 0 && s[180] === 0) || has(9), "sampled-without-kind");
  need(s[178] === 0 || has(4, 5, 6, 9), "time-without-kind");
  need(!(u32(s, 156) === POINT_SUPPORT && u32(s, 160) === POINT_SUPPORT), "point-support");
  if (s[107] === 5) need(!has(9, 10) && has(...[...kinds].filter(k => k !== 0)), "src5-kinds");
  else need(has(9) && !has(10), "src6-kinds");
}

function validateO1(s: Uint8Array): void {
  need(zero(s, 156, 164) && zero(s, 174, 184) && s[186] === 0 && s[187] === 0, "reserved");
  need(s[185] === 1 && s[252] === 1 && s[429] === 1, "count");
  need(u16(s, 172) > 0, "wire-age");
  const mask = u64(s, 294);
  need(mask !== 0n && (mask & (mask - 1n)) === 0n && mask < 32n, "onlyb-mask");
}

/** FRESH dispatch by source first (`@107`), then `@184`; other sources keep their established meaning. */
export function validateFrontier(s: Uint8Array): void {
  need(s.length === 512 && s[104] === 0, "not-fresh");
  const blockZero = zero(s, 156, 188);
  switch (s[107]) {
    case 5: case 6:
      if (blockZero) return need(s[107] !== 6 || zero(s, 456, 472), "floor-without-frontier");
      need(s[184] === MIMIR_FRONTIER_TAG_F1, "tag");
      return validateF1(s);
    case 1:
      if (blockZero) return;
      need(s[184] === MIMIR_FRONTIER_TAG_O1, "tag");
      return validateO1(s);
    case 7:
      return need(blockZero, "point-block");
  }
}

export type MimirPublicationBlock =
  | Readonly<{ kind: "legacy" }>
  | Readonly<{ kind: "f1"; support: readonly [number, number]; bindTag: Uint8Array; wireAge: number; slotLag: number; quietBps: number;
      timeLag: number; band: number; close: number; kinds: readonly number[]; recordEligible: boolean; floor: bigint | null }>
  | Readonly<{ kind: "o1"; bindTag: Uint8Array; wireAge: number }>
  | Readonly<{ kind: "liveness" }>
  | Readonly<{ kind: "other-source" }>;

export function decodePublicationBlock(s: Uint8Array): MimirPublicationBlock {
  if (s.length !== 512) throw new Error("InvalidMimirSnapshot");
  if (s[104] === 1) { validateDegradedSnapshot(s); return { kind: "liveness" }; }
  if (![1, 5, 6, 7].includes(s[107]!)) return { kind: "other-source" };
  validateFrontier(s);
  if (zero(s, 156, 188)) return { kind: "legacy" };
  if (s[184] === MIMIR_FRONTIER_TAG_O1) return { kind: "o1", bindTag: s.slice(164, 172), wireAge: u16(s, 172) };
  const n = s[185]!;
  const nib = [s[181]! & 15, s[181]! >> 4, s[182]! & 15, s[182]! >> 4, s[183]! & 15];
  return { kind: "f1", support: [u32(s, 156), u32(s, 160)], bindTag: s.slice(164, 172), wireAge: u16(s, 172), slotLag: u16(s, 174),
    quietBps: u16(s, 176), timeLag: s[178]!, band: s[179]!, close: s[180]!, kinds: nib.slice(0, n).map(x => KIND_OF[x]!),
    recordEligible: s[186] === 1, floor: s[107] === 6 ? u128(s, 456) : null };
}

export function frontierBindTag(feedConfig: Uint8Array, sourcingPlan: Uint8Array): Uint8Array {
  return sha256(concat(MIMIR_FRONTIER_BIND_DOMAIN, feedConfig, sourcingPlan)).slice(0, 8);
}

export function publicationDigest(snapshotAddress: Uint8Array, snapshot: Uint8Array): Uint8Array {
  if (snapshotAddress.length !== 32 || snapshot.length !== 512) throw new Error("InvalidMimirPublicationDigestInput");
  return sha256(concat(MIMIR_PUBLICATION_DOMAIN, snapshotAddress, snapshot));
}

export interface MimirOnlyBWitness {
  bump: number; format: number; sourceIndex: number; snapshotRevision: bigint; qLow: bigint; qHigh: bigint; qSlot: bigint;
  qTime: bigint; lastRefresh: bigint; tokenProgram: Uint8Array; configRevision: bigint; setRevision: bigint;
}

function witnessHeaderOk(w: Uint8Array, formats: readonly number[]): boolean {
  return w.length === MIMIR_ONLYB_WITNESS_LEN && eq(w.subarray(0, 8), MIMIR_ONLYB_WITNESS_MAGIC) && u16(w, 8) === 0
    && u16(w, 10) === MIMIR_ONLYB_WITNESS_LEN && formats.includes(w[13]!) && w[15] === 0 && zero(w, 128, MIMIR_ONLYB_WITNESS_LEN);
}

export function decodeOnlyBWitness(w: Uint8Array): MimirOnlyBWitness {
  if (!witnessHeaderOk(w, [0, 1])) throw new Error("InvalidMimirOnlyBWitness");
  return { bump: w[12]!, format: w[13]!, sourceIndex: w[14]!, snapshotRevision: u64(w, 16), qLow: u128(w, 24), qHigh: u128(w, 40),
    qSlot: u64(w, 56), qTime: i64(w, 64), lastRefresh: i64(w, 72), tokenProgram: w.slice(80, 112), configRevision: u64(w, 112),
    setRevision: u64(w, 120) };
}

/** Consumer-side witness checks against the bound snapshot; PDA and owner are account-level checks. */
export function validateOnlyBWitness(w: Uint8Array, s: Uint8Array): void {
  need(w.length === MIMIR_ONLYB_WITNESS_LEN && eq(w.subarray(0, 8), MIMIR_ONLYB_WITNESS_MAGIC) && u16(w, 8) === 0
    && u16(w, 10) === MIMIR_ONLYB_WITNESS_LEN, "witness-header");
  need(w[13] === 1 && w[15] === 0, "witness-format");
  need(zero(w, 128, MIMIR_ONLYB_WITNESS_LEN), "witness-reserved");
  need(u64(w, 16) === u64(s, 96), "witness-revision");
  need(w[14]! < 64 && u64(s, 294) === 1n << BigInt(w[14]!), "witness-index");
  need(!zero(w, 80, 112) && u64(w, 112) !== 0n && u64(w, 120) !== 0n, "witness-fields");
}

export function writeOnlyBWitness(pre: Uint8Array, v: Omit<MimirOnlyBWitness, "bump" | "format">): Uint8Array {
  if (!witnessHeaderOk(pre, [0, 1])) throw new Error("InvalidMimirOnlyBWitness");
  const w = pre.slice();
  w[13] = 1; w[14] = v.sourceIndex; put(w, 16, 8, v.snapshotRevision); put(w, 24, 16, v.qLow); put(w, 40, 16, v.qHigh);
  put(w, 56, 8, v.qSlot); put(w, 64, 8, v.qTime); put(w, 72, 8, v.lastRefresh); w.set(v.tokenProgram, 80);
  put(w, 112, 8, v.configRevision); put(w, 120, 8, v.setRevision);
  return w;
}

export interface MimirFrontierRow {
  index: number; kind: number; group: number; window: readonly [bigint, bigint] | null;
  score: readonly [bigint, bigint, number]; rowFloor: bigint | null; times: readonly bigint[];
}

const scoreLess = (a: MimirFrontierRow["score"], b: MimirFrontierRow["score"]) =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

function groupBest(rows: readonly MimirFrontierRow[], mask: bigint, sampled: boolean): MimirFrontierRow[] {
  const present = rows.filter(r => r.index < 64 && ((mask >> BigInt(r.index)) & 1n) === 1n);
  return present.filter(r => !sampled || !present.some(o => o.group === r.group && scoreLess(o.score, r.score)));
}

/** The consumer's support meet and floor over the `@294` rows (sampled rows collapsed by the consumer's score). */
export function frontierSupportAndFloor(rows: readonly MimirFrontierRow[], mask: bigint, sampled: boolean): {
  support: readonly [number, number] | null; floor: bigint | null;
} {
  let support: [number, number] | null = null, floor: bigint | null = null;
  for (const r of groupBest(rows, mask, sampled)) {
    if (r.window) {
      const [a, b] = r.window;
      if (a < 0n || b < 0n || a > 0xffff_ffffn || b > 0xffff_ffffn) throw new Error("InvalidMimirFrontierSpan");
      support = support ? [Math.max(support[0], Number(a)), Math.min(support[1], Number(b))] : [Number(a), Number(b)];
    }
    if (sampled && r.rowFloor !== null) floor = floor === null || r.rowFloor < floor ? r.rowFloor : floor;
  }
  return { support, floor: sampled ? floor ?? 0n : null };
}

/** E-S: the consumer's `common_clip(selected kind-9 rows, 120)`, an empty selection refused. */
export function frontierSelectedClipOk(rows: readonly MimirFrontierRow[], mask: bigint): boolean {
  const clip = groupBest(rows, mask, true).filter(r => r.kind === 9);
  if (clip.length === 0 || clip.some(r => !r.window)) return false;
  const start = clip.reduce((m, r) => (r.window![0] > m ? r.window![0] : m), -(1n << 63n));
  const end = clip.reduce((m, r) => (r.window![1] < m ? r.window![1] : m), (1n << 63n) - 1n);
  const span = end - start;
  return span >= MIMIR_FRONTIER_MIN_CLIP_SPAN && span < 1n << 63n
    && clip.every(r => r.times.slice(0, 16).filter(t => t >= start && t <= end).length >= MIMIR_FRONTIER_MIN_CLIP_RECORDS);
}

const ceilBps = (delta: bigint, mean: bigint) => (mean === 0n ? (1n << 128n) - 1n : (delta * 10_000n + mean - 1n) / mean);
const clampN = (v: bigint, max: number) => Number(v > BigInt(max) ? BigInt(max) : v);
const absDiff = (a: bigint, b: bigint) => (a > b ? a - b : b - a);
const satSub = (a: bigint, b: bigint) => (a > b ? a - b : 0n);

export interface MimirF1Row {
  kind: number; sourceConfigData: Uint8Array; ringData: Uint8Array; moduleData?: Uint8Array; programData?: Uint8Array; window: readonly [bigint, bigint] | null;
}

export function frontierWireKind(proof: { kind: number; openingMode?: string }): number {
  return proof.openingMode === "execution" ? 0x80 | proof.kind : proof.kind;
}

/** F1 post-image prediction, as the program's writer computes it from the accounts it reads. */
export function predictF1Block(args: {
  rows: readonly MimirF1Row[]; mask: bigint; spotSlot: bigint; clockSlot: bigint; now: bigint; bindTag: Uint8Array; wireAge: number;
  sampled: boolean;
}): { block: Uint8Array; floor: bigint; rows: MimirFrontierRow[] } {
  let oldestSlot = args.spotSlot, oldestUnix: bigint | null = null, quiet = 0n, band = 0n, close = 0n, recordForm = true;
  const rows = args.rows.map((r, i): MimirFrontierRow => {
    const ring = r.ringData, src = r.sourceConfigData, kind = r.kind;
    const pointOnly = u32(ring, 12) === 1;
    if (kind === 9 || kind === 10) recordForm &&= pointOnly && zero(ring, 320, 352) && ring[369] === 1
      && u128(ring, 112) >= u128(src, 88) && u128(ring, 128) >= u128(src, 72);
    const row: MimirFrontierRow = {
      index: i, kind, group: u16(src, 60), window: kind === 0 ? null : r.window,
      score: kind === 9 || kind === 10 || pointOnly ? [0n, 0n, i] : [u128(ring, 512), u128(ring, 528), i],
      rowFloor: kind === 0 ? null : kind === 9 || kind === 10 ? u128(src, 88) : u128(ring, 112), times: [],
    };
    const newest = u64(ring, 64);
    if (newest < oldestSlot) oldestSlot = newest;
    const m = r.moduleData;
    const minUnix = (t: bigint) => { oldestUnix = oldestUnix === null || t < oldestUnix ? t : oldestUnix; };
    if (kind >= 4 && kind <= 6) {
      if (!m) throw new Error("MissingMimirFrontierModule");
      const [endSlot, end, lower, upper] = kind === 5 ? [u64(m, 112), i64(m, 120), u128(m, 160), u128(m, 176)]
        : [u64(m, 240), i64(m, 248), u128(m, 208), u128(m, 224)];
      const price = u128(ring, 464);
      if (endSlot < oldestSlot) oldestSlot = endSlot;
      minUnix(end); minUnix(i64(m, 56));
      const q = ceilBps(satSub(price, lower) > satSub(upper, price) ? satSub(price, lower) : satSub(upper, price), price);
      if (q > quiet) quiet = q;
    } else if (kind === 9) {
      if (!m) throw new Error("MissingMimirFrontierModule");
      const pd = r.programData;
      if (!pd || pd.length < 13) throw new Error("MissingMimirFrontierProgramData");
      recordForm &&= pd.length >= 45 && pd[12]! <= 1 && !zero(pd, 13, 45) === (pd[12] === 1);
      const mean = u128(m, 168), lower = u128(m, 184), upper = u128(m, 200);
      const b = ceilBps(satSub(upper, lower), mean), c = ceilBps(absDiff(u128(ring, 88), mean), mean);
      if (b > band) band = b;
      if (c > close) close = c;
      minUnix(i64(m, 160));
      const n = m[21]!, next = m[22]!, count = Math.min(n, 16);
      row.times = Array.from({ length: count }, (_, k) => i64(m, 256 + 64 * ((next + 32 - count + k) % 16) + 8)) as bigint[];
    }
    return row;
  });
  const { support, floor } = frontierSupportAndFloor(rows, args.mask, args.sampled);
  if (!support || args.clockSlot < oldestSlot || args.clockSlot - oldestSlot > 0xffffn) throw new Error("InvalidMimirFrontierFacts");
  const eligible = recordForm && (!args.sampled || frontierSelectedClipOk(rows, args.mask));
  let timeLag = 0;
  if (oldestUnix !== null) {
    const lag: bigint = args.now - oldestUnix;
    if (lag < 0n) throw new Error("InvalidMimirFrontierFacts");
    timeLag = clampN(lag, 255);
  }
  const block = encodeF1Block({ support, bindTag: args.bindTag, wireAge: args.wireAge, slotLag: Number(args.clockSlot - oldestSlot),
    quietBps: clampN(quiet, 0xffff), timeLag, band: clampN(band, 255), close: clampN(close, 255), kinds: args.rows.map(r => r.kind), eligible });
  return { block, floor: floor ?? 0n, rows };
}

/** Applies a predicted F1/O1 block (and the source-6 floor) to a predicted snapshot post-image. */
export function applyFrontierBlock(snapshot: Uint8Array, block: Uint8Array, floor?: bigint): Uint8Array {
  const out = snapshot.slice();
  out.set(block, 156);
  if (out[107] === 6 && floor !== undefined) put(out, 456, 16, floor);
  validateFrontier(out);
  return out;
}

export interface MimirFrontierLimits { maxAge: number; maxSourceAge: bigint; maxConfidenceBps: number }

/** An eligible F1 publication admitted as the consumer's stored mixed record at `nowSlot`/`now`. */
export function admitFrontier(s: Uint8Array, limits: MimirFrontierLimits, nowSlot: bigint, now: bigint): boolean {
  const block = decodePublicationBlock(s);
  if (block.kind !== "f1" || !block.recordEligible || block.wireAge === 0 || block.wireAge > limits.maxAge) return false;
  const slotOk = (x: bigint) => x !== 0n && nowSlot >= x && nowSlot - x <= limits.maxSourceAge;
  const timeOk = (t: bigint) => now - t >= 0n && now - t <= 60n;
  const oldestSlot = u64(s, 116) - BigInt(block.slotLag), oldestUnix = i64(s, 132) - BigInt(block.timeLag);
  if (!slotOk(oldestSlot) || !slotOk(u64(s, 148)) || !slotOk(u64(s, 140))) return false;
  if (block.kinds.some(k => k >= 4 && k <= 6) && (!timeOk(oldestUnix) || block.quietBps > limits.maxConfidenceBps)) return false;
  if (block.kinds.includes(9) && (!timeOk(oldestUnix) || block.band > Math.min(limits.maxConfidenceBps, 100)
      || block.close > Math.min(limits.maxConfidenceBps, 50))) return false;
  return true;
}

/** C-O3 mirror: O1 plus its witness admitted as the consumer's stored OnlyB interval. */
export function admitOnlyB(s: Uint8Array, witness: Uint8Array, limits: Omit<MimirFrontierLimits, "maxConfidenceBps">, nowSlot: bigint, now: bigint): boolean {
  const block = decodePublicationBlock(s);
  if (block.kind !== "o1" || block.wireAge === 0 || block.wireAge > limits.maxAge) return false;
  try { validateOnlyBWitness(witness, s); } catch { return false; }
  const w = decodeOnlyBWitness(witness);
  const timeOk = (t: bigint) => t > 0n && now - t >= 0n && now - t <= 60n;
  return timeOk(w.lastRefresh) && timeOk(w.qTime) && w.qSlot !== 0n && nowSlot >= w.qSlot && nowSlot - w.qSlot <= limits.maxSourceAge;
}
