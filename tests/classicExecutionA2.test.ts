import { mimirClassicSampleOnlyRows } from "../src/beta/creation.js";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import type { Address } from "@solana/kit";
import * as beta from "../src/beta/index.js";
import * as publicApi from "../src/publicApi.js";
import * as easyApi from "../src/easy/index.js";
import * as instructionsEntry from "../src/instructions.js";
import * as v1Entry from "../src/v1/index.js";
import * as refreshEntry from "../src/v1/refresh.js";
import * as createEntry from "../src/create/index.js";
import {
  MIMIR_CLASSIC_EXECUTION, MIMIR_DELETED_CLASSIC_TAGS, buildMimirFusedClassicInstruction, buildMimirInitFusedClassicClosure,
  decodeMimirClassicExecution, decodeMimirClassicExecutionAccount, decodeMimirClassicPublicationProof, decodeMimirFusedClassicData, deriveMimirClassicExecutionAddress,
  deriveMimirClassicRecipe, encodeMimirClassicPublicationProof, encodeMimirFusedClassicData, mimirClassicDefinitionDigest,
  mimirClassicExecutionImmutableBytes, mimirClassicExecutionLayout, mimirClassicExecutionMutableRegions, mimirClassicMinSources, mimirClassicRefreshMode,
  mimirConsumerClassicCellMetas, mimirFusedClassicRequest, orderMimirConsumerProducers, assertMimirClassicConverterAdmitted, verifyMimirClassicDefinitionDigest,
  type MimirClassicEvidenceV1, type MimirClassicExecutionLayout,
} from "../src/beta/classicExecution.js";
import { decodeMimirCompositeExecution, deriveMimirFusedRecipe, encodeMimirFusedDescriptor, mimirAdmittedRecipe } from "../src/beta/compositeExecution.js";
import { decodeMimirBetaLiveSource } from "../src/beta/liveAbi.js";
import { compositeExecutionImage } from "./fixtures/compositeExecutionImage.js";
import { canonicalRowImages, validRingV1 } from "./fixtures/compositeExecutionImage.js";
import { addressBytes, bytesAddress, hex, sha256 } from "../src/beta/bytes.js";
import { deriveMimirBetaPda } from "../src/beta/abi.js";
import type { MimirBetaInstruction } from "../src/beta/types.js";

const key = (n: number) => bytesAddress(Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? n & 255 : i === 1 ? n >> 8 : 3)));
const PROGRAM = "4kxKWPhWUZMj1x2D2BaCBW9BfeBZ6po4WagfzkUCsAt4" as Address;
const FEED = new Uint8Array(32).fill(9);
const CONV_FEED = new Uint8Array(32).fill(8);
const throws = (f: () => unknown, re: RegExp) => assert.throws(f, (e: Error) => re.test(e.message));

// §5 adapter matrix: exact E / K / module / Instructions per family, version and mode, from the one shared recipe table.
type Row = [label: string, t: number, v: number, e: number, tm: number | undefined, point: boolean, mode: number, k: number, module: number, ix: boolean];
const MATRIX: Row[] = [
  ["CPMM spot", 2, 0, 4, undefined, false, 0, 4, 0, false], ["CPMM native", 2, 0, 5, undefined, false, 2, 4, 0, false],
  ["CPMM quiet", 2, 0, 7, 2, false, 3, 4, 192, false],
  ["CLMM v0 route", 1, 0, 7, undefined, false, 0, 4, 0, false], ["CLMM v0 native", 1, 0, 8, undefined, false, 2, 4, 0, false],
  ["CLMM v1 route", 1, 1, 8, undefined, false, 0, 5, 0, false], ["CLMM v1 native", 1, 1, 9, undefined, false, 2, 5, 0, false],
  ["Orca route", 0, 0, 7, undefined, false, 0, 4, 0, false], ["Orca marker", 0, 0, 9, undefined, false, 3, 4, 0, false],
  ["DLMM v0 visible", 3, 0, 4, undefined, false, 1, 3, 0, false], ["DLMM v0 route", 3, 0, 6, undefined, false, 0, 3, 0, false],
  ["DLMM v0 native-visible", 3, 0, 7, undefined, false, 2, 3, 0, false], ["DLMM v0 native-route", 3, 0, 9, undefined, false, 2, 3, 0, false],
  ["DLMM v1 visible", 3, 1, 5, undefined, false, 1, 4, 0, false], ["DLMM v1 route", 3, 1, 7, undefined, false, 0, 4, 0, false],
  ["DLMM v1 native-visible", 3, 1, 8, undefined, false, 2, 4, 0, false], ["DLMM v1 native-route", 3, 1, 10, undefined, false, 2, 4, 0, false],
  ["DAMM spot", 7, 0, 3, undefined, false, 0, 3, 0, false], ["DAMM OnlyB", 7, 0, 5, 1, false, 3, 3, 256, false],
  ["DAMM reserve", 7, 0, 5, 3, false, 3, 3, 320, false],
  ["AMM-v4 mode4", 4, 0, 8, 4, false, 4, 6, 1_280, true], ["AMM-v4 mode5", 4, 0, 8, 4, true, 5, 6, 1_280, true],
  ["Pump v0 mode4", 6, 0, 9, 4, false, 4, 7, 1_280, true], ["Pump v1 mode5", 6, 1, 9, 4, true, 5, 7, 1_280, true],
];
const recipe = (r: Row, role: "primary" | "converter" = "primary") => deriveMimirClassicRecipe({ role, adapterType: r[1], adapterVersion: r[2],
  externalWidth: r[3], ...(r[4] !== undefined ? { temporalModuleVersion: r[4] } : {}), currentPoint: r[5], minSlotGap: r[5] ? 0 : 1 });
const R = Object.fromEntries(MATRIX.map((r) => [r[0], r])) as Record<string, Row>;
for (const r of MATRIX) {
  const x = recipe(r);
  assert.deepEqual([x.mode, x.externalWidth, x.bindingWidth, beta.MIMIR_FUSED_TEMPORAL_MODULE_LENGTH[x.temporalKind], x.requiresInstructionsSysvar],
    [r[6], r[3], r[7], r[8], r[9]], r[0]);
  if ([2, 3, 4].includes(r[6])) assert.equal(recipe(r, "converter").mode, r[6]);
  else throws(() => recipe(r, "converter"), /converter row must be duration-bearing|UnsupportedCompositeExecutionRecipe/);
}
throws(() => deriveMimirClassicRecipe({ role: "primary", adapterType: 2, adapterVersion: 0, externalWidth: 6, minSlotGap: 1 }), /Unsupported/);

// §2.5 exact state sizes, N=1..5, and the converter row additions.
const SIZES: [Row, number[]][] = [
  [R["CPMM spot"]!, [2_781, 3_989, 5_197, 6_405, 7_613]], [R["CPMM quiet"]!, [2_973, 4_373, 5_773, 7_173, 8_573]],
  [R["CLMM v1 route"]!, [2_846, 4_119, 5_392, 6_665, 7_938]], [R["DAMM spot"]!, [2_716, 3_859, 5_002, 6_145, 7_288]],
  [R["DAMM OnlyB"]!, [2_972, 4_371, 5_770, 7_169, 8_568]], [R["DAMM reserve"]!, [3_036, 4_499, 5_962, 7_425, 8_888]],
  [R["AMM-v4 mode4"]!, [4_191, 6_809, 9_427, 12_045, 14_663]], [R["Pump v0 mode4"]!, [4_256, 6_939, 9_622, 12_305, 14_988]],
];
for (const [r, sizes] of SIZES) sizes.forEach((size, i) => assert.equal(mimirClassicExecutionLayout(Array(i + 1).fill(recipe(r)), []).exactLength, size, `${r[0]} N${i + 1}`));
const cpmm = recipe(R["CPMM spot"]!); const nativeCpmm = recipe(R["CPMM native"]!, "converter");
assert.equal(mimirClassicExecutionLayout([cpmm], [nativeCpmm]).exactLength - 2_781, 1_829 + 944 + 4 + 260, "one K4 converter source adds 3,037");
for (const [r, add] of [[R["CPMM quiet"]!, 3_229], [R["DAMM OnlyB"]!, 3_228], [R["DAMM reserve"]!, 3_292], [R["AMM-v4 mode4"]!, 4_447], [R["Pump v0 mode4"]!, 4_512],
  [R["CLMM v1 native"]!, 3_102]] as const) {
  assert.equal(mimirClassicExecutionLayout([cpmm], [recipe(r, "converter")]).exactLength - 2_781, add, `${r[0]} converter`);
}
throws(() => mimirClassicExecutionLayout([], []), /N must be 1..5/);
throws(() => mimirClassicExecutionLayout(Array(6).fill(cpmm), []), /N must be 1..5/);
throws(() => mimirClassicExecutionLayout([cpmm], Array(6).fill(nativeCpmm)), /S 0..5/);

// Image builder (what tag-90 SEAL writes: canonical images, valid rings) and the strict decoder.
function image(layout: MimirClassicExecutionLayout, opts: { status?: number; digest?: Uint8Array; ringSlot?: (r: number) => bigint } = {}): Uint8Array {
  const d = new Uint8Array(layout.exactLength); const v = new DataView(d.buffer);
  d.set(new TextEncoder().encode("MIMIRCLX")); v.setUint16(8, 1, true); v.setUint16(10, 384, true); v.setUint32(12, d.length, true);
  d.set(FEED, 16); d.set(addressBytes(key(1)), 48); d.set(opts.digest ?? new Uint8Array(32).fill(0xd1), 80); v.setBigUint64(112, 3n, true);
  d[120] = layout.componentCount; d[121] = layout.converterSourceCount; d[122] = 254; d[123] = opts.status ?? 1; v.setUint32(124, layout.converterSourceCount ? 1 : 0, true);
  const n = layout.componentCount;
  const primary = canonicalRowImages(FEED, layout.descriptors.slice(0, n)); new DataView(primary.feed.buffer).setBigUint64(296, 7n, true);
  const conv = layout.converterOffset === null ? null : canonicalRowImages(CONV_FEED, layout.descriptors.slice(n));
  d.set(primary.feed, 384); d.set(primary.plan, 741);
  if (conv) { d.set(conv.feed, layout.converterOffset!); d.set(conv.plan, layout.converterOffset! + 357); }
  layout.descriptors.forEach((desc, r) => {
    const o = layout.rowOffsets[r]!; d.set(encodeMimirFusedDescriptor(desc), o); d.set(r < n ? primary.sources[r]! : conv!.sources[r - n]!, o + 16);
    d.set(validRingV1(opts.ringSlot?.(r) ?? BigInt(100 + r)), o + 400);
    const m = layout.membershipOffsets[r]!; d[m] = desc.bindingWidth; d[m + 1] = 1;
    d[m + 2] = mimirAdmittedRecipe({ adapterType: desc.adapterType, adapterVersion: desc.adapterVersion, accountsBindingVersion: 1, mode: desc.mode,
      externalWidth: desc.externalWidth, temporalKind: desc.temporalKind, converterRow: true, pointOk: r < n }).bindingVariant;
    for (let i = 0; i < desc.bindingWidth; i += 1) d.set(addressBytes(key(500 + 10 * r + i)), m + 4 + 65 * i);
  });
  return d;
}
const quiet = recipe(R["CPMM quiet"]!); const amm = recipe(R["AMM-v4 mode5"]!);
const layout = mimirClassicExecutionLayout([cpmm, quiet, amm], [nativeCpmm, recipe(R["CPMM quiet"]!, "converter")]);
const data = image(layout);
const state = decodeMimirClassicExecution(data);
assert.deepEqual([state.componentCount, state.converterSourceCount, state.active, state.proof, state.bump, state.sourceSetRevision], [3, 2, true, null, 254, 3n]);
assert.equal(state.primary[2]!.descriptor.mode, 5); assert.equal(state.converter!.sources[1]!.ringNewestSlot, 104n);
assert.equal(state.primary[0]!.membership.accounts[3]!.address, key(503));
const bad = (mutate: (d: Uint8Array, v: DataView) => void, re: RegExp) => {
  const d = Uint8Array.from(data); mutate(d, new DataView(d.buffer)); throws(() => decodeMimirClassicExecution(d), re);
};
bad((d) => { d[0] = 0; }, /magic/);
bad((_, v) => v.setUint16(8, 2, true), /version/);
bad((_, v) => v.setUint16(10, 128, true), /length/);
bad((_, v) => v.setUint32(12, data.length + 1, true), /length/);
throws(() => decodeMimirClassicExecution(Uint8Array.of(...data, 0)), /length/);
bad((d) => { d[120] = 2; }, /geometry|header|descriptor/);
bad((d) => { d[121] = 1; }, /header|geometry|descriptor/);
bad((_, v) => v.setUint32(124, 3, true), /header/);
bad((d) => { d[123] = 2; }, /header/);
bad((d) => { d.fill(0, 80, 112); }, /definition digest/);
bad((d) => { d[layout.rowOffsets[0]! + 2] = 5; }, /row recipe/);
bad((d) => { d[layout.membershipOffsets[1]! + 3] = 1; }, /membership/);
bad((d) => { d[layout.membershipOffsets[0]! + 4 + 64] = 2; }, /executable/);
bad((d) => { d.set(encodeMimirFusedDescriptor(layout.descriptors[0]!), layout.rowOffsets[3]!); }, /geometry|row recipe/);
assert.equal(decodeMimirClassicExecution(image(layout, { status: 0, digest: new Uint8Array(32) })).active, false, "building state may carry a zero digest");

// Proof receipt.
const evidence = (over: Partial<MimirClassicEvidenceV1> = {}): MimirClassicEvidenceV1 => ({ declaredWireAge: 30, configuredSourceCount: 3, publishedK: 3,
  effectiveK: 2, venueCount: 2, correlationDomainCount: 2, quiet: false, sampled: true, point: false, commonSupport: true, minRingNewestSlot: 100n,
  quietLastRefresh: 0n, quietIntervalEnd: 0n, quietIntervalEndSlot: 0n, quietWidthBps: 0, sampledBandBps: 40, sampledCloseDeviationBps: 5,
  supportStart: 1_700_000_000n, supportEnd: 1_700_000_180n, nativeFloor: (1n << 70n) + 5n, ...over });
const proof = { valid: true, converterPresent: true, snapshotRevision: 11n, publicationSlot: 4_000n, primary: evidence(),
  converter: { evidence: evidence({ configuredSourceCount: 2, publishedK: 2, sampled: false, commonSupport: false, sampledBandBps: 0, sampledCloseDeviationBps: 0,
    supportStart: 0n, supportEnd: 0n }),
    snapshotRevision: 2n, snapshotSlot: 3_999n, validUntilSlot: 4_100n, feedId: CONV_FEED } } as const;
const proofBytes = encodeMimirClassicPublicationProof(proof);
assert.equal(proofBytes.length, 256);
assert.deepEqual(decodeMimirClassicPublicationProof(proofBytes), proof);
const point = encodeMimirClassicPublicationProof({ ...proof, converterPresent: false, converter: null, primary: evidence({ sampled: false, point: true,
  commonSupport: false, sampledBandBps: 0, sampledCloseDeviationBps: 0, supportStart: 0n, supportEnd: 0n }) });
assert.equal(decodeMimirClassicPublicationProof(point)!.primary.point, true);
const badProof = (mutate: (p: Uint8Array, v: DataView) => void, re: RegExp, src = proofBytes) => {
  const p = Uint8Array.from(src); mutate(p, new DataView(p.buffer)); throws(() => decodeMimirClassicPublicationProof(p), re);
};
badProof((p) => { p[0] = 0; }, /proof header/);
badProof((_, v) => v.setUint16(8, 3, true), /proof header/);
badProof((_, v) => v.setUint16(8, 2, true), /dual decision/);
badProof((_, v) => v.setUint32(12, 2, true), /proof header/);
badProof((_, v) => v.setUint32(12, 7, true), /proof header/);
badProof((p) => { p[250] = 1; }, /proof header/);
badProof((p) => { p[32 + 7] |= 0x10; }, /reserved bits/);
badProof((p) => { p[32 + 46] = 1; }, /reserved bits/);
badProof((p) => { p[32 + 7] = 0x0b; }, /support interval/);
badProof((_, v) => v.setBigInt64(32 + 48, 1_800_000_000n, true), /support interval/);
badProof((p) => { p[32 + 7] = 0x0c; }, /point evidence/);
badProof((p) => { p[32 + 7] = 0; }, /spot evidence/);
badProof((_, v) => v.setUint32(12, 1, true), /converter proof fields/);
badProof((p) => { p[32 + 40] = 1; }, /point evidence/, point);
badProof((p) => { p[32 + 7] = 0x09; p[32 + 42] = 1; }, /sampled fields/);
throws(() => decodeMimirClassicPublicationProof(new Uint8Array(255)), /proof length/);
// R8: converter evidence is slot-coherent: flags 0, no support tuple, counts/floor/age/slots proof-locally coherent.
badProof((p) => { p[112 + 7] = 8; }, /converter evidence/);
badProof((p) => { p[112 + 48] = 1; }, /converter evidence/);
badProof((_, v) => v.setBigUint64(200, 3_997n, true), /converter evidence/);
badProof((_, v) => v.setBigUint64(200, 4_001n, true), /converter evidence/);
badProof((_, v) => v.setBigUint64(208, 3_999n, true), /converter evidence/);
badProof((_, v) => v.setBigUint64(192, 0n, true), /converter evidence/);
badProof((p) => { p[112] = 31; }, /converter evidence/);
badProof((p) => { p[112 + 4] = 0; }, /converter evidence/);
badProof((p) => { p[112 + 4] = 3; }, /converter evidence/);
badProof((p) => { p[112 + 3] = 3; }, /converter evidence/);
badProof((p) => { p.fill(0, 112 + 64, 112 + 80); }, /converter evidence/);
// R2: all-zero = absent; any non-zero proof carries the valid bit. R5: support_start = 0 is valid; support needs end > start.
assert.equal(decodeMimirClassicPublicationProof(new Uint8Array(256)), null);
badProof((_, v) => v.setUint32(12, 0, true), /proof header/);
assert.equal(decodeMimirClassicPublicationProof(encodeMimirClassicPublicationProof({ ...proof, primary: evidence({ supportStart: 0n }) }))!.primary.supportStart, 0n);
badProof((_, v) => v.setBigInt64(32 + 48, 1_700_000_180n, true), /support interval/);
badProof((_, v) => v.setBigInt64(32 + 48, -1n, true), /support interval/);
// Program image: tag 89 writes the 512-byte FeedSnapshot to the mirror, the converter TWAP/snapshot, and the proof copied
// from those bytes exactly as `classic_refresh.rs::encode_classic_proof` and `classic.rs::encode_proof` lay them out.
const SN = { feedId: 16, revision: 96, source: 107, slot: 116, validUntil: 124, unix: 132, lb: 156, shortEnd: 164, k: 252, effK: 429, floor: 456 } as const;
function snapshot512(o: { feedId: Uint8Array; revision: bigint; slot: bigint; validUntil: bigint; source: number; counts: readonly number[]; floor: bigint;
  unix?: bigint; support?: readonly [number, number]; lb?: readonly [number, number][]; shortEnd?: bigint }): Uint8Array {
  const s = new Uint8Array(512); const v = new DataView(s.buffer);
  s.set(o.feedId, SN.feedId); v.setBigUint64(SN.revision, o.revision, true); s[SN.source] = o.source; v.setBigUint64(SN.slot, o.slot, true);
  v.setBigUint64(SN.validUntil, o.validUntil, true); v.setBigInt64(SN.unix, o.unix ?? 0n, true);
  s[SN.k] = o.counts[0]!; s[253] = o.counts[2]!; s[254] = o.counts[3]!; s[SN.effK] = o.counts[1]!;
  v.setBigUint64(SN.floor, o.floor & ((1n << 64n) - 1n), true); v.setBigUint64(SN.floor + 8, o.floor >> 64n, true);
  if (o.support) { v.setUint32(SN.lb, o.support[0], true); v.setUint32(SN.lb + 4, o.support[1], true); }
  for (const [at, x] of o.lb ?? []) s[SN.lb + at] = x;
  if (o.shortEnd !== undefined) v.setBigUint64(SN.shortEnd, o.shortEnd, true);
  return s;
}
function programPublish(base: Uint8Array, l: MimirClassicExecutionLayout, mirror: Uint8Array, conv: Uint8Array | null, wireAge: number): Uint8Array {
  const d = Uint8Array.from(base); const v = new DataView(d.buffer); d.set(mirror, 1_061);
  const n = l.componentCount; const s = l.converterSourceCount; const m = new DataView(mirror.buffer); const slot = m.getBigUint64(SN.slot, true);
  const ev = (snap: Uint8Array, configured: number, minRing: bigint) => {
    const e = new Uint8Array(80); const ew = new DataView(e.buffer); ew.setUint16(0, wireAge, true);
    e.set([configured, snap[SN.k]!, snap[SN.effK]!, snap[253]!, snap[254]!], 2); ew.setBigUint64(8, minRing, true); e.set(snap.subarray(SN.floor, SN.floor + 16), 64);
    return { e, ew };
  };
  const minRing = l.rowOffsets.slice(0, n).map((o) => v.getBigUint64(o + 400 + 64, true)).reduce((a, b) => (a < b ? a : b));
  const { e, ew } = ev(mirror, n, minRing);
  const source = mirror[SN.source]!; const start = m.getUint32(SN.lb, true); const end = m.getUint32(SN.lb + 4, true);
  if (source === 7) e[7] = 4;
  else if ((source === 5 || source === 6) && end !== 0 && start <= end) {
    const sampled = source === 6; const quiet = !sampled && l.descriptors.slice(0, n).some((x) => x.mode === 3);
    e[7] = 8 | (sampled ? 2 : quiet ? 1 : 0); ew.setBigInt64(48, BigInt(start), true); ew.setBigInt64(56, BigInt(end), true);
    if (sampled) { ew.setUint16(42, mirror[SN.lb + 23]!, true); ew.setUint16(44, mirror[SN.lb + 24]!, true); }
    else if (quiet) {
      ew.setBigInt64(16, m.getBigInt64(SN.unix, true), true); ew.setBigInt64(24, BigInt(end), true);
      ew.setBigUint64(32, slot - BigInt(m.getUint16(SN.lb + 18, true)), true); ew.setUint16(40, m.getUint16(SN.lb + 20, true), true);
    }
  }
  const p = new Uint8Array(256); const pv = new DataView(p.buffer);
  p.set(new TextEncoder().encode("MIMIRCPR")); pv.setUint16(8, 1, true); pv.setUint16(10, 256, true); pv.setUint32(12, s ? 3 : 1, true);
  p.set(mirror.subarray(SN.revision, SN.revision + 8), 16); pv.setBigUint64(24, slot, true); p.set(e, 32);
  if (conv) {
    const c = l.converterOffset!; d.set(conv, c + 1_317);
    const shortEnd = new DataView(conv.buffer).getBigUint64(SN.shortEnd, true); v.setBigUint64(c + 677 + 56, shortEnd, true);
    p.set(ev(conv, s, shortEnd).e, 112); p.set(conv.subarray(SN.revision, SN.revision + 8), 192); p.set(conv.subarray(SN.slot, SN.slot + 8), 200);
    p.set(conv.subarray(SN.validUntil, SN.validUntil + 8), 208); p.set(conv.subarray(SN.feedId, SN.feedId + 32), 216);
  }
  d.set(p, 128);
  return d;
}
const SLOT = 4_000n;
const quietMirror = snapshot512({ feedId: FEED, revision: 11n, slot: SLOT, validUntil: 4_030n, source: 5, counts: [3, 2, 2, 2], floor: (1n << 70n) + 5n,
  unix: 1_700_000_200n, support: [1_700_000_000, 1_700_000_180], lb: [[18, 7], [20, 25]] });
const convSnap = snapshot512({ feedId: CONV_FEED, revision: 2n, slot: 3_999n, validUntil: 4_100n, source: 4, counts: [2, 1, 1, 1], floor: 9n, shortEnd: 3_990n });
const live = programPublish(data, layout, quietMirror, convSnap, 30);
{
  const st = decodeMimirClassicExecution(live);
  assert.deepEqual([st.proof!.snapshotRevision, st.proof!.publicationSlot, st.proof!.primary.quiet, st.proof!.primary.minRingNewestSlot,
    st.proof!.primary.quietIntervalEndSlot, st.proof!.converter!.evidence.minRingNewestSlot, st.proof!.converter!.snapshotSlot], [11n, SLOT, true, 100n, 3_993n, 3_990n, 3_999n]);
  const unpublished = Uint8Array.from(data); unpublished.set(live.subarray(128, 384), 128);
  throws(() => decodeMimirClassicExecution(unpublished), /proof without mirror/);
  const n = Uint8Array.from(live); n.set(point, 128); throws(() => decodeMimirClassicExecution(n), /proof converter flag/);
  // Sample-only advances private rings after the proof: the proof minimum may trail them, never lead them.
  const later = Uint8Array.from(live); for (const o of layout.rowOffsets) later.set(validRingV1(200n), o + 400);
  assert.equal(decodeMimirClassicExecution(later).proof!.primary.minRingNewestSlot, 100n);
  // One mutation per compared field: every duplicate must equal its embedded source.
  const reject = (label: string, mutate: (d: Uint8Array, v: DataView) => void, src = live) => {
    const d = Uint8Array.from(src); mutate(d, new DataView(d.buffer)); throws(() => decodeMimirClassicExecution(d), /InvalidClassicExecution/);
    void label;
  };
  const bump = (at: number) => (d: Uint8Array) => { d[at] ^= 1; };
  const P = 128; const E = P + 32; const CE = P + 112; const c = layout.converterOffset!;
  const fields: [string, number][] = [["proof revision", P + 16], ["publication slot", P + 24], ["primary configured", E + 2], ["primary K", E + 3],
    ["primary effective K", E + 4], ["primary venues", E + 5], ["primary correlation", E + 6], ["primary flags", E + 7],
    ["quiet last refresh", E + 16], ["quiet end", E + 24], ["quiet end slot", E + 32], ["quiet width", E + 40], ["support start", E + 48], ["support end", E + 56],
    ["primary floor", E + 64], ["primary floor high", E + 72], ["converter age", CE], ["converter configured", CE + 2], ["converter K", CE + 3],
    ["converter effective K", CE + 4], ["converter venues", CE + 5], ["converter correlation", CE + 6], ["converter flags", CE + 7],
    ["converter short_end", CE + 8], ["converter floor", CE + 64], ["converter revision", P + 192], ["converter slot", P + 200],
    ["converter valid-until", P + 208], ["converter feed id", P + 216],
    ["mirror revision", 1_061 + SN.revision], ["mirror slot", 1_061 + SN.slot], ["mirror status", 1_061 + 104], ["mirror feed id", 1_061 + SN.feedId],
    ["mirror K", 1_061 + SN.k], ["mirror effective K", 1_061 + SN.effK], ["mirror venues", 1_061 + 253], ["mirror correlation", 1_061 + 254],
    ["mirror floor", 1_061 + SN.floor], ["mirror source", 1_061 + SN.source], ["mirror support", 1_061 + SN.lb], ["mirror quiet age", 1_061 + SN.lb + 18],
    ["mirror quiet width", 1_061 + SN.lb + 20], ["mirror unix", 1_061 + SN.unix],
    ["converter twap short_end", c + 677 + 56], ["converter snapshot short_end", c + 1_317 + SN.shortEnd], ["converter snapshot revision", c + 1_317 + SN.revision],
    ["converter snapshot slot", c + 1_317 + SN.slot], ["converter snapshot valid-until", c + 1_317 + SN.validUntil], ["converter snapshot feed id", c + 1_317 + SN.feedId],
    ["converter snapshot K", c + 1_317 + SN.k], ["converter snapshot effective K", c + 1_317 + SN.effK], ["converter snapshot venues", c + 1_317 + 253],
    ["converter snapshot correlation", c + 1_317 + 254], ["converter snapshot floor", c + 1_317 + SN.floor]];
  for (const [label, at] of fields) reject(label, bump(at));
  reject("primary min ring ahead of rings", (_, v) => v.setBigUint64(E + 8, 101n, true));
  reject("primary chain effective K > K", (d) => { d[E + 4] = 3; d[1_061 + SN.effK] = 3; d[E + 3] = 2; d[1_061 + SN.k] = 2; });
  reject("primary K > N", (d) => { d[E + 3] = 4; d[1_061 + SN.k] = 4; });
  reject("converter chain K > S", (d) => { d[CE + 3] = 3; d[c + 1_317 + SN.k] = 3; });
  // Sampled primary: band/close come from block bytes 23/24 of source 6.
  const sl = mimirClassicExecutionLayout([recipe(R["AMM-v4 mode4"]!)], []);
  const sampled = programPublish(image(sl), sl, snapshot512({ feedId: FEED, revision: 4n, slot: SLOT, validUntil: 4_030n, source: 6, counts: [1, 1, 1, 1], floor: 1n,
    support: [1_700_000_000, 1_700_000_180], lb: [[23, 40], [24, 5]] }), null, 30);
  assert.deepEqual([decodeMimirClassicExecution(sampled).proof!.primary.sampledBandBps, decodeMimirClassicExecution(sampled).proof!.primary.sampledCloseDeviationBps], [40, 5]);
  for (const at of [E + 42, E + 44, 1_061 + SN.lb + 23, 1_061 + SN.lb + 24]) reject(`sampled ${at}`, bump(at), sampled);
  // Point primary: source 7 is bit 2 only.
  const pl = mimirClassicExecutionLayout([amm], []);
  const pointImage = programPublish(image(pl), pl, snapshot512({ feedId: FEED, revision: 4n, slot: SLOT, validUntil: 4_030n, source: 7, counts: [1, 1, 1, 1], floor: 0n }), null, 30);
  assert.equal(decodeMimirClassicExecution(pointImage).proof!.primary.point, true);
  reject("point source as spot", (d) => { d[1_061 + SN.source] = 4; }, pointImage);
  // R11: a pure-spot primary publishes atomic-lite (source 1), flags 0, support zero; non-spot sets never do.
  const spotLayout = mimirClassicExecutionLayout([cpmm, cpmm], []);
  const spot = (source: number, l = spotLayout) => programPublish(image(l), l, snapshot512({ feedId: FEED, revision: 1n, slot: SLOT, validUntil: 4_030n, source,
    counts: [l.componentCount, l.componentCount, 1, 1], floor: 1n }), null, 30);
  const spotProof = decodeMimirClassicExecution(spot(1)).proof!.primary;
  assert.deepEqual([spotProof.quiet, spotProof.sampled, spotProof.point, spotProof.commonSupport, spotProof.supportStart, spotProof.supportEnd], [false, false, false, false, 0n, 0n]);
  throws(() => decodeMimirClassicExecution(spot(5)), /proof snapshot source/);
  throws(() => decodeMimirClassicExecution(spot(1, pl)), /proof snapshot source/);
  reject("pure-spot support", (d) => { d[E + 7] = 8; d[E + 56] = 1; }, spot(1));
}
{
  // R4: a primary with no quiet/sampled row is native-bounded evidence (bit3 only); quiet or sampled bits on it are rejected.
  const nativeLayout = mimirClassicExecutionLayout([cpmm, amm], [nativeCpmm, nativeCpmm]);
  const withProof = (primary: MimirClassicEvidenceV1) => { const d = image(nativeLayout); d.fill(1, 1_061, 1_573);
    d.set(encodeMimirClassicPublicationProof({ ...proof, primary }), 128); return d; };
  throws(() => decodeMimirClassicExecution(withProof(evidence())), /evidence kind flags/);
  throws(() => decodeMimirClassicExecution(withProof(evidence({ sampled: false, quiet: true, quietLastRefresh: 1n, quietWidthBps: 7, sampledBandBps: 0,
    sampledCloseDeviationBps: 0 }))), /evidence kind flags/);
  // R8: converter configured count must be the execution's S.
  const one = image(mimirClassicExecutionLayout([cpmm, quiet, amm], [nativeCpmm])); one.fill(1, 1_061, 1_573); one.set(proofBytes, 128);
  throws(() => decodeMimirClassicExecution(one), /converter evidence/);
}

// Mutable regions tile exactly what tag 89 may write; the immutable image is invariant under them.
const regions = mimirClassicExecutionMutableRegions(layout);
assert.deepEqual(regions.slice(0, 2), [[128, 384], [1_061, 1_573]]);
assert.deepEqual(regions.slice(2, 7), layout.rowOffsets.map((o) => [o + 400, o + 944]));
assert.deepEqual(regions[7], [layout.converterOffset! + 677, layout.converterOffset! + 1_829]);
assert.equal(regions.slice(8).reduce((a, [x, y]) => a + y - x, 0), 192 + 1_280 + 192);
{
  const d = Uint8Array.from(data); d.fill(0x5a, 1_061, 1_573); for (const o of layout.rowOffsets) d.set(validRingV1(777n), o + 400);
  assert.deepEqual(mimirClassicExecutionImmutableBytes(d), mimirClassicExecutionImmutableBytes(data));
}

// Definition digest (§2.4): deterministic, bound to program/execution/keys/converter identity.
const [execution, bump] = await deriveMimirClassicExecutionAddress(PROGRAM, FEED);
assert.ok(bump <= 255);
const digestArgs = { programId: PROGRAM, execution, state, feedConfig: key(20), plan: key(21), converter: { feedId: CONV_FEED, feedConfig: key(22), plan: key(23) } };
const digest = await mimirClassicDefinitionDigest(digestArgs);
assert.notDeepEqual(digest, await mimirClassicDefinitionDigest({ ...digestArgs, plan: key(24) }));
assert.notDeepEqual(digest, await mimirClassicDefinitionDigest({ ...digestArgs, execution: key(25) }));
{
  const d = Uint8Array.from(data); d.set(validRingV1(555n), layout.rowOffsets[1]! + 400);
  assert.deepEqual(await mimirClassicDefinitionDigest({ ...digestArgs, state: decodeMimirClassicExecution(d) }), digest, "mutable bytes are excluded");
  d[layout.rowOffsets[0]! + 16 + 54] ^= 1;
  assert.notDeepEqual(await mimirClassicDefinitionDigest({ ...digestArgs, state: decodeMimirClassicExecution(d) }), digest, "SourceConfig image is bound");
}
await assert.rejects(mimirClassicDefinitionDigest({ ...digestArgs, converter: undefined } as never), /converter identity/);
await assert.rejects(verifyMimirClassicDefinitionDigest(digestArgs), /definition digest/);
{
  const d = image(layout, { digest }); await verifyMimirClassicDefinitionDigest({ ...digestArgs, state: decodeMimirClassicExecution(d) });
}

// Context-aware account entry: owner, PDA/bump, strict decode, active, header/rows binding, recomputed digest with PDA-derived keys.
{
  const keys = async (feedImage: Uint8Array, planImage: Uint8Array) => {
    const pv = new DataView(planImage.buffer, planImage.byteOffset);
    const u16 = (x: number) => Uint8Array.of(x & 255, x >> 8);
    const [[feedConfig], [plan]] = await Promise.all([deriveMimirBetaPda({ programId: PROGRAM, seed: "feed_config", values: [feedImage.subarray(16, 48)] }),
      deriveMimirBetaPda({ programId: PROGRAM, seed: "sourcing_plan", values: [planImage.subarray(16, 48), u16(pv.getUint16(48, true)), u16(pv.getUint16(50, true))] })]);
    return { feedConfig, plan };
  };
  const [addr, b] = await deriveMimirClassicExecutionAddress(PROGRAM, FEED);
  const sealed = (() => { const d = image(layout); d[122] = b; for (const o of layout.rowOffsets.slice(0, 3)) new DataView(d.buffer).setBigUint64(o + 16 + 368, 3n, true); return d; })();
  const st = decodeMimirClassicExecution(sealed);
  const conv = { feedId: CONV_FEED, ...(await keys(st.converter!.feedConfigImage, st.converter!.planImage)) };
  sealed.set(await mimirClassicDefinitionDigest({ programId: PROGRAM, execution: addr, state: st, ...(await keys(st.feedConfigImage, st.planImage)), converter: conv }), 80);
  const account = (data = sealed) => ({ programId: PROGRAM, address: addr, owner: PROGRAM, data, requireActive: true });
  assert.equal((await decodeMimirClassicExecutionAccount(account())).active, true);
  const bad = async (a: Parameters<typeof decodeMimirClassicExecutionAccount>[0], re: RegExp) => assert.rejects(decodeMimirClassicExecutionAccount(a), re);
  const mut = (f: (d: Uint8Array, v: DataView) => void) => { const d = Uint8Array.from(sealed); f(d, new DataView(d.buffer)); return account(d); };
  await bad({ ...account(), owner: key(9) }, /owner/);
  await bad({ ...account(), address: key(9) }, /execution address/);
  await bad(mut((d) => { d[122] ^= 1; }), /execution address/);
  await bad(mut((d) => { d[0] = 0; }), /magic/);
  await bad(mut((_, v) => v.setUint16(8, 2, true)), /version/);
  await bad(account(Uint8Array.of(...sealed, 0)), /length/);
  await bad(mut((d) => { d[123] = 0; }), /not active/);
  assert.equal((await decodeMimirClassicExecutionAccount({ ...mut((d) => { d[123] = 0; }), requireActive: false })).active, false);
  await bad(mut((_, v) => v.setBigUint64(112, 4n, true)), /source set revision/);
  await bad(mut((d) => { d[80] ^= 1; }), /definition digest/);
  await bad(mut((d) => { d[layout.membershipOffsets[0]! + 4] ^= 1; }), /definition digest/);
  await bad(mut((d) => { d[layout.converterOffset! + 357 + 200] ^= 1; }), /definition digest|InvalidClassicExecution/);
  await bad(account(programPublish(sealed, layout, quietMirror, convSnap, 30).map((x, i) => (i === 128 + 112 + 3 ? x ^ 1 : x))), /converter evidence/);
}

// §3 tag 90: BEGIN at min(final, 10,240), ceil(final/10,240)-1 GROWs, SEAL 36+301W, exact account lists.
const witness = (feedId: Uint8Array, i: number, minSlotGap = 1) => ({ feedId, sourceIndex: i, ringVersion: 1, minSlotGap, expectedSourceConfigRevision: 1n,
  expectedSourceSetRevision: 1n, expectedPlanHash: new Uint8Array(32).fill(0xab), sourceSetSiblings: [0, 1, 2].map(() => new Uint8Array(32)),
  accountsSiblings: [0, 1, 2].map(() => new Uint8Array(32)) });
const ext = (r: number, w: number) => Array.from({ length: w }, (_, i) => key(1_000 + 20 * r + i));
const closure = (l: MimirClassicExecutionLayout) => buildMimirInitFusedClassicClosure({ programId: PROGRAM, payer: key(2), execution, collateralLock: key(3), snapshot: key(1),
  feedConfig: key(20), sourcingPlan: key(21), registry: key(3), feedId: FEED, layout: l,
  witnesses: l.descriptors.map((d, r) => witness(r < l.componentCount ? FEED : CONV_FEED, r < l.componentCount ? r : r - l.componentCount, d.minSlotGap)),
  primary: l.descriptors.slice(0, l.componentCount).map((d, r) => ({ sourceConfig: key(40 + r), externals: ext(r, d.externalWidth) })),
  ...(l.converterSourceCount ? { converter: { feedConfig: key(22), sourcingPlan: key(23),
    sources: l.descriptors.slice(l.componentCount).map((d, j) => ({ sourceConfig: key(50 + j), externals: ext(10 + j, d.externalWidth) })) } } : {}) });
const init = closure(layout);
assert.equal(layout.exactLength > 10_240, true); assert.equal(layout.growCount, 1);
assert.deepEqual(init.map((ix) => [ix.data[0], ix.data[1], ix.data.length]), [[90, 0, 40], [90, 1, 38], [90, 2, 36 + 301 * 5]]);
assert.equal(new DataView(init[0]!.data.buffer, init[0]!.data.byteOffset).getUint32(36, true), layout.exactLength);
assert.equal(new DataView(init[1]!.data.buffer, init[1]!.data.byteOffset).getUint32(34, true), 10_240);
const flags = (ix: MimirBetaInstruction) => ix.accounts.map((m) => `${m.isSigner ? "S" : ""}${m.isWritable ? "W" : "R"}`).join(",");
assert.deepEqual(init[0]!.accounts.map((m) => m.address), [key(2), execution, key(1), "11111111111111111111111111111111", "Sysvar1nstructions1111111111111111111111111", key(3)]);
assert.equal(flags(init[0]!), "SW,W,W,R,R,R");
assert.equal(flags(init[1]!), "SW,W,R,R");
assert.deepEqual(init[2]!.accounts.slice(2, 7).map((m) => m.address), [key(1), key(20), key(21), key(3), "11111111111111111111111111111111"]);
assert.equal(init[2]!.accounts.length, 2 + 5 + (1 + 4) + (1 + 7) + (1 + 8) + 2 + (1 + 5) + (1 + 7) + 1);
assert.equal(init[2]!.accounts.at(-1)!.address, "Sysvar1nstructions1111111111111111111111111");
assert.deepEqual(closure(mimirClassicExecutionLayout([cpmm], [])).map((ix) => ix.data.length), [40, 337], "N1 spot: no GROW");
{
  const big = mimirClassicExecutionLayout(Array(5).fill(recipe(R["Pump v0 mode4"]!)), Array(5).fill(recipe(R["Pump v0 mode4"]!, "converter")));
  const c = closure(big);
  assert.equal(c.length, 2 + Math.ceil(big.exactLength / 10_240) - 1);
  c.slice(1, -1).forEach((g, i) => assert.equal(new DataView(g.data.buffer, g.data.byteOffset).getUint32(34, true), 10_240 * (i + 1)));
  assert.equal(c.at(-1)!.data.length, 3_046, "W=10 SEAL is 3,046 bytes");
}
throws(() => buildMimirInitFusedClassicClosure({ programId: PROGRAM, payer: key(2), execution, collateralLock: key(3), snapshot: key(1), feedConfig: key(20), sourcingPlan: key(21),
  registry: key(3), feedId: FEED, layout: mimirClassicExecutionLayout([cpmm], []), witnesses: [witness(FEED, 0)], primary: [{ sourceConfig: key(40), externals: ext(0, 3) }] }),
  /external vector width/);

// §4 tag 89: exact 104+8W wire, CAS modes, metas.
const liveState = decodeMimirClassicExecution(live);
const publish = mimirFusedClassicRequest({ state: liveState, snapshotRevision: 11n, mode: "publish", declaredMaxSnapshotAge: 30 });
const sample = mimirFusedClassicRequest({ state: liveState, snapshotRevision: 11n, mode: "sample", declaredMaxSnapshotAge: 30 });
assert.deepEqual([publish.previousSnapshotRevision, publish.nextSnapshotRevision, sample.nextSnapshotRevision], [11n, 12n, 11n]);
assert.deepEqual([publish.feedConfigRevision, publish.sourceSetRevision, hex(publish.planHash), publish.ringNewestSlots],
  [7n, 3n, hex(data.subarray(741 + 196, 741 + 228)), [100n, 101n, 102n, 103n, 104n]]);
assert.deepEqual(sample.ringNewestSlots, publish.ringNewestSlots, "R10: sample-only heads cover all rows");
assert.deepEqual(mimirClassicSampleOnlyRows(liveState.layout, 3), [1, 2, 3, 4], "R10: selected transition rows");
assert.deepEqual(mimirClassicSampleOnlyRows(liveState.layout, 2), [0, 1, 2, 3, 4], "R10: quorum selects every primary row");
{
  const reviewer = mimirClassicExecutionLayout([cpmm, quiet], [nativeCpmm]);
  assert.deepEqual(reviewer.descriptors.map((d) => [d.mode, d.moduleLength !== 0]), [[0, false], [3, true], [2, false]]);
  assert.deepEqual(mimirClassicSampleOnlyRows(reviewer, 2), [1, 2], "R10: spot primary row is not sampled");
  assert.deepEqual(mimirClassicSampleOnlyRows(reviewer, 1), [0, 1, 2], "R10: quorum selects the spot primary row");
}
throws(() => mimirFusedClassicRequest({ state: liveState, snapshotRevision: 10n, mode: "publish", declaredMaxSnapshotAge: 30 }), /proof revision/);
throws(() => mimirFusedClassicRequest({ state: decodeMimirClassicExecution(image(layout, { status: 0 })), snapshotRevision: 0n, mode: "sample",
  declaredMaxSnapshotAge: 30 }), /not active/);
const wire = encodeMimirFusedClassicData(publish);
assert.equal(wire.length, 104 + 8 * 5); assert.equal(wire[0], 89); assert.equal(wire[51], 3); assert.equal(wire[92], 2);
assert.deepEqual(decodeMimirFusedClassicData(wire), publish);
throws(() => encodeMimirFusedClassicData({ ...publish, nextSnapshotRevision: 13n }), /CAS request/);
throws(() => encodeMimirFusedClassicData({ ...publish, declaredMaxSnapshotAge: 0 }), /CAS request/);
throws(() => decodeMimirFusedClassicData(Uint8Array.of(...wire, 0)), /length/);
assert.equal(decodeMimirFusedClassicData((() => { const w = Uint8Array.from(wire); w[94] = 7; w[95] = 0; return w; })()).maxReuseAgeSlots, 7);
const externals = layout.descriptors.map((d, r) => ext(r, d.externalWidth));
const tag89 = buildMimirFusedClassicInstruction({ programId: PROGRAM, snapshot: key(1), registry: key(3), execution, layout,
  primaryExternals: externals.slice(0, 3), converterExternals: externals.slice(3), request: publish });
assert.equal(flags(tag89), ["W", "R", "W", ...externals.flat().map(() => "R"), "R"].join(","));
assert.deepEqual(tag89.accounts.slice(0, 3).map((m) => m.address), [key(1), key(3), execution]);
assert.equal(tag89.accounts.at(-1)!.address, "Sysvar1nstructions1111111111111111111111111", "point mode 5 requires Instructions last");
assert.equal(tag89.accounts.length, 3 + 4 + 7 + 8 + 5 + 7 + 1);
const noIx = mimirClassicExecutionLayout([cpmm], []);
assert.equal(buildMimirFusedClassicInstruction({ programId: PROGRAM, snapshot: key(1), registry: key(3), execution, layout: noIx, primaryExternals: [ext(0, 4)],
  converterExternals: [], request: { ...publish, componentCount: 1, converterSourceCount: 0, ringNewestSlots: [0n] } }).accounts.length, 3 + 4);
throws(() => buildMimirFusedClassicInstruction({ programId: PROGRAM, snapshot: key(1), registry: key(3), execution, layout: noIx,
  primaryExternals: [[key(1), ...ext(0, 3)]], converterExternals: [], request: { ...publish, componentCount: 1, converterSourceCount: 0, ringNewestSlots: [0n] } }), /aliases/);
// Sample-only scheduling from private module readiness: temporal rows gate publish; spot/point rows never do.
assert.equal(mimirClassicRefreshMode(liveState, () => true, live), "publish");
const seen: number[] = [];
assert.equal(mimirClassicRefreshMode(liveState, (r, m) => { seen.push(r, m.length); return r !== 4; }, live), "sample");
assert.deepEqual(seen, [1, 192, 4, 192], "only quiet/sampled rows are asked");
// R1: a quorum feed (min_sources < N) is temporal as a whole: every primary ring must be READY before publishing.
{
  const planImage = Uint8Array.from(liveState.planImage); planImage[55] = 2;
  const asked: number[] = [];
  assert.equal(mimirClassicRefreshMode({ ...liveState, planImage }, (r, _m, ring) => { asked.push(r, ring.length); return r !== 4; }, live), "sample");
  assert.deepEqual(asked, [0, 544, 1, 544, 2, 544, 4, 544], "quorum: every primary row plus temporal converter rows");
  assert.equal(mimirClassicRefreshMode({ ...liveState, planImage }, () => true, live), "publish");
  planImage[55] = 3; assert.equal(mimirClassicRefreshMode({ ...liveState, planImage }, (r) => r !== 0, live), "publish", "min_sources == N is not quorum");
}

// R7: quorum creation admission.
{
  const dlmmNative = { adapterType: 3, adapterVersion: 1, mode: 2 as const };
  const refusal = (() => { try { mimirClassicMinSources([cpmm, cpmm, cpmm], 2); } catch (e) { return e as { code: string; message: string; address?: string }; } })();
  assert.deepEqual([refusal?.code, refusal?.message, refusal?.address], ["CLASSIC_QUORUM_UNSUPPORTED",
    "CLASSIC_QUORUM_UNSUPPORTED:min_sources < source_count requires every primary source recipe to emit AUTHENTICATED_DURATION without NATIVE_BOUNDED", undefined]);
  assert.equal(mimirClassicMinSources([dlmmNative, dlmmNative, { ...dlmmNative, adapterVersion: 0 }], 2), 2, "DLMM native N=3,Q=2 admitted");
  throws(() => mimirClassicMinSources([dlmmNative, dlmmNative, cpmm], 2), /CLASSIC_QUORUM_UNSUPPORTED/);
  assert.equal(mimirClassicMinSources([cpmm, cpmm, cpmm]), 3, "CPMM default Q = N (mixed-bounded, not quorum)");
  throws(() => mimirClassicMinSources([cpmm], 0), /min_sources/);
  assertMimirClassicConverterAdmitted([{ ...dlmmNative, adapterVersion: 0 }, { ...dlmmNative, adapterVersion: 0 }]);
  const clmmNative = recipe(R["CLMM v0 native"]!, "converter");
  assertMimirClassicConverterAdmitted([clmmNative, recipe(R["DLMM v0 native-visible"]!, "converter"), recipe(R["DLMM v0 native-route"]!, "converter")]);
  for (const r of [nativeCpmm, recipe(R["CPMM quiet"]!, "converter"), recipe(R["AMM-v4 mode4"]!, "converter"), dlmmNative,
    recipe(R["CLMM v1 native"]!, "converter"), { ...clmmNative, mode: 0 as const }, { ...clmmNative, mode: 1 as const }]) {
    throws(() => assertMimirClassicConverterAdmitted([{ ...dlmmNative, adapterVersion: 0 }, r]), /CLASSIC_CONVERTER_UNSUPPORTED/);
  }
  assert.equal(mimirClassicMinSources([cpmm, quiet]), 2, "R12 leaves primary recipes unaffected"); throws(() => mimirClassicMinSources([cpmm], 2), /min_sources/);
}

// §7 Consumer cell and producer order.
assert.deepEqual(mimirConsumerClassicCellMetas({ snapshot: key(1), execution }), [
  { address: key(1), isSigner: false, isWritable: false }, { address: execution, isSigner: false, isWritable: false }]);
assert.deepEqual(orderMimirConsumerProducers({ ordinary: tag89 }), [tag89]);
assert.deepEqual(orderMimirConsumerProducers({ ordinary: tag89, collateral: tag89 }), [tag89], "identical cell: one shared producer");
const other = buildMimirFusedClassicInstruction({ programId: PROGRAM, snapshot: key(60), registry: key(3), execution: key(61), layout: noIx,
  primaryExternals: [ext(0, 4)], converterExternals: [], request: { ...publish, feedId: CONV_FEED, componentCount: 1, converterSourceCount: 0, ringNewestSlots: [0n] } });
assert.deepEqual(orderMimirConsumerProducers({ ordinary: tag89, collateral: other }), [other, tag89], "collateral -2, ordinary -1; shared readonly DEX roles admitted");
throws(() => orderMimirConsumerProducers({ ordinary: tag89, collateral: { ...tag89, data: encodeMimirFusedClassicData(sample) } }), /different CAS/);
throws(() => orderMimirConsumerProducers({ ordinary: tag89, collateral: { ...other, accounts: [other.accounts[0]!, other.accounts[1]!, { ...other.accounts[2]!, address: execution }, ...other.accounts.slice(3)] } }), /two writers/);
throws(() => orderMimirConsumerProducers({ ordinary: tag89, collateral: { ...other, accounts: [...other.accounts.slice(0, 3), { ...other.accounts[3]!, address: key(1) }, ...other.accounts.slice(4)] } }), /external aliases/);
throws(() => orderMimirConsumerProducers({ ordinary: { ...tag89, data: Uint8Array.of(83) } }), /tag 89 or 87/);

// Golden vectors: pinned hash over canonical A2 byte vectors.
const golden = hex(await sha256(new Uint8Array([...data, ...proofBytes, ...wire, ...init.flatMap((ix) => [...ix.data]), ...digest])));
const pinned = JSON.parse(readFileSync(new URL("./fixtures/classicA2Golden.json", import.meta.url), "utf8")) as { sha256: string };
assert.equal(golden, pinned.sha256, "A2 golden vector");

// Deletion: no tag 59/60/77/82/83 builder, planner, codec or consumer budget contract v1 survives in exports or sources.
assert.deepEqual([...MIMIR_DELETED_CLASSIC_TAGS], [59, 60, 77, 82, 83]);
assert.equal(MIMIR_CLASSIC_EXECUTION.headerLength, 384);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, unknown> };
const entries: Record<string, Record<string, unknown>> = { ".": easyApi, "./advanced": publicApi, "./beta": beta, "./create": createEntry, ...("./internal/instructions" in pkg.exports ? { "./internal/instructions": instructionsEntry } : {}), "./v1": v1Entry, "./v1/refresh": refreshEntry };
assert.deepEqual(Object.keys(pkg.exports).filter((k) => k !== "./package.json").sort(), Object.keys(entries).sort(), "ratchet scans every package entry point");
const exported = Object.values(entries).flatMap((m) => Object.keys(m));
const forbidden = new RegExp(`RefreshSourceRing|RefreshFeedTwap|ClassicAtomicLite|ClassicMixedBounded|Tag77|Tag83|Tag82|Tag60|Tag59|tag77|tag83|tag82|tag60|tag59|StrongOnlyB|MonoPoolRefresh|IntervalProvenance|PointProvenance|PrefixGrammar|PublisherOk|LiveRefresh|ConditionedRefresh`);
// Ratchet at zero: the beta classic creation/live path is tag 90/89 only; no deleted-tag export remains.
assert.deepEqual(exported.filter((k) => forbidden.test(k)), [], "no deleted-tag export");
const srcFiles = (dir: URL): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? srcFiles(new URL(`${e.name}/`, dir)) : e.name.endsWith(".ts") ? [readFileSync(new URL(e.name, dir), "utf8")] : []);
const all = srcFiles(new URL("../src/", import.meta.url)).join("\n");
const T = "(?:59|60|77|82|83)";
for (const re of [/REFRESH_SOURCE_RING_V1_TAG/, /REFRESH_FEED_TWAP_FROM_RINGS_AND_SNAPSHOT_TAG/,
  new RegExp(`\\[0\\]!?\\s*[!=]==?\\s*\\(?[^;|&\\n]*?\\b${T}\\b(?!\\s*[*+/-])`), new RegExp(`\\b${T}\\s*[!=]==?\\s*[\\w.$]+\\[0\\]`),
  new RegExp(`Uint8Array\\.of\\(\\s*${T}\\b`), new RegExp(`\\[[^\\]\\n]*\\]\\s*=\\s*${T}\\s*;`), new RegExp(`case\\s+${T}\\s*:`),
  new RegExp(`[{,]\\s*${T}\\s*:\\s*\\[`), new RegExp(`_TAG\\s*=\\s*${T}\\b`),
  /mimirFusedExternalsFromTag77|mimirFusedRowFromTag77|prepareMimirBetaLiveRefresh|unwrapMimirStrongOnlyB|predictStrongOnlyBPostImage|verifyMimirMonoPoolRefreshCore/,
  /buildMimirBeta(LiveRefresh|ClassicAtomicLiteSnapshot|SampledSnapshot|MixedPointSnapshot|MonoPoolTwap)Instruction/]) assert.ok(!re.test(all), `deleted surface ${re}`);
const prescriptive = all.split("\n").filter((line) => new RegExp(`\\btags?[- ]?${T}\\b|\\[\\s*${T}\\s*,\\s*${T}\\s*\\]`, "i").test(line) && !/deleted/i.test(line));
assert.deepEqual(prescriptive, [], "deleted tags appear only in explicit deletion declarations");
assert.ok(!/\[77, 83\]/.test(new publicApi.MimirSourceConditionedError(1, 1).message), "conditioned guidance names no deleted route");

// DLMM compact point (adapter 3, v0/v1, mode 5, K3/K4): build -> decode round-trip, classic and composite component; SourceConfig flags 1 only here.
for (const v of [0, 1] as const) {
  const dp = deriveMimirClassicRecipe({ role: "primary", adapterType: 3, adapterVersion: v, externalWidth: 6 + v, temporalModuleVersion: 4, currentPoint: true, minSlotGap: 0 });
  assert.deepEqual([dp.mode, dp.temporalKind, dp.bindingWidth], [5, 5, 3 + v]);
  const l = mimirClassicExecutionLayout([dp], []); const img = image(l); const st = decodeMimirClassicExecution(img);
  const src = img.subarray(l.rowOffsets[0]! + 16, l.rowOffsets[0]! + 400);
  assert.deepEqual([st.componentCount, new DataView(src.buffer, src.byteOffset).getUint32(12, true), decodeMimirBetaLiveSource(src).temporalMode], [1, 1, "current-point"]);
  for (const flags of [0, 2]) {
    const bad = Uint8Array.from(img); new DataView(bad.buffer).setUint32(l.rowOffsets[0]! + 16 + 12, flags, true);
    assert.throws(() => decodeMimirClassicExecution(bad), `DLMM v${v} point row with SourceConfig flags ${flags}`);
  }
  const fc = deriveMimirFusedRecipe({ role: "component", adapterType: 3, adapterVersion: v, externalWidth: 6 + v, temporalModuleVersion: 4, currentPoint: true, minSlotGap: 0, accountsBindingVersion: 1 });
  const rows = canonicalRowImages(FEED, [fc]);
  const comp = decodeMimirCompositeExecution(compositeExecutionImage({ feedId: FEED, cfc: key(3), components: [fc],
    images: { rows: [{ source: rows.sources[0]!, feed: rows.feed, plan: rows.plan }] } }));
  assert.deepEqual([comp.componentCount, comp.components[0]!.descriptor.mode, comp.components[0]!.descriptor.adapterType], [1, 5, 3]);
}
for (const t of [0, 1, 2, 7]) {
  const s = canonicalRowImages(FEED, [cpmm]).sources[0]!; s[49] = t; new DataView(s.buffer, s.byteOffset).setUint32(12, 1, true);
  throws(() => decodeMimirBetaLiveSource(s), /InvalidSourceConfig/);
}
console.log("classicExecutionA2 ok", golden);
