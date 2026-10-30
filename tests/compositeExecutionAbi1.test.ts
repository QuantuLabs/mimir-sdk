import { MIMIR_SAMPLED_SOURCE_ADAPTERS } from "../src/internal/sampledTemporalCore.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Address } from "@solana/kit";
import {
  buildMimirFusedCompositeRefreshInstruction, buildMimirInitFusedCompositeClosure, decodeMimirCompositeExecution, deriveMimirCompositeExecutionAddress,
  deriveMimirFusedRecipe, isMimirFusedSampleOnlyData, mimirAdmittedRecipe, mimirExpectedDescriptor, encodeMimirFusedDescriptor, encodeMimirFusedRefreshData,
  encodeMimirInitFusedBeginData, encodeMimirInitFusedGrowData,
  mimirCompositeExecutionLayout, mimirFusedRowExternals, MIMIR_INSTRUCTIONS_SYSVAR_ID, type MimirFusedRecipe, type MimirInitSourceWitness,
} from "../src/beta/compositeExecution.js";
import { addressBytes, bytesAddress, fromHex, hex, sha256 } from "../src/beta/bytes.js";
import { MIMIR_BETA_SYSTEM_PROGRAM_ID } from "../src/beta/deployment.js";

const PROGRAM = "4kxKWPhWUZMj1x2D2BaCBW9BfeBZ6po4WagfzkUCsAt4" as Address;
const throwsAbi = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: Error) => re.test(e.message));
const cpmm = (role: "component" | "converter" = "component"): MimirFusedRecipe =>
  deriveMimirFusedRecipe({ role, adapterType: 2, adapterVersion: 0, externalWidth: 4, minSlotGap: 1, accountsBindingVersion: 1 });

// §13 execution PDA / bump vectors.
for (const [feed, pda, bump] of [
  ["f8fd940c3a8a4cf4ffc708408c497cd807734302d4d8508e230185469016a9ae", "JBb8RoEqdeW3TSrCnervLHDd9i1sFxZoLAmVBjFerP5s", 255],
  ["28da92ed46272ef8c8a474fb7a2b7e2d9531973143ac3744a99e8a9fb679d1b4", "BwDiLxR5ACRSYqYJKir8pyBnYPPJtf6svzEwkkpiqs1N", 254],
  ["e56bfb3fb77bf063ac778a1ed90518645ad019638f85fc157e04941173f71f7b", "GsunPQ6F1qsJKT2PBCnAHVX6gbXkueG2upQmu5gBZ17c", 254],
  ["bd2ec4a4e849a804d8e8c796e0aa14fdc2dcc3447116ac08134d00ba4a125266", "3ZsF6wtvSjV9fNTjMQzp8zx83ucu19vRoLevXTDuBVJ6", 255],
  ["aaeb234934171ecf9f7d3672f83d13023739678d858e18dab021a78b35d330b2", "GYgdkoqx8CZzkPKLsxUidJE7qU3HtC5JxBGwKJqvNtZ6", 255],
  ["df88921a95164f4b2a5a519ca57450ee41b032d81af6cff89afcdff0c99418b9", "9Rv2gh3JSW9ireXhwUoJq1fN7LjpUJ5Bp4BHKK21xk1G", 254],
  ["ba8ed42ccfe7906fe19ed8ec6af4b3fb342c81661cba0bc4fe2001a49687a04e", "6nSevx7Kn6jgRuGuZvwp9zn3EyCAHWZ82gb4xjrSHZKA", 255],
] as const) assert.deepEqual(await deriveMimirCompositeExecutionAddress(PROGRAM, fromHex(feed)), [pda, bump]);

// §11 size formula checks (static-v1 CPMM K=4, no modules) and K7/K8 all-ten-row upper shapes.
const len = (n: number, s: number, r: MimirFusedRecipe = cpmm()) => mimirCompositeExecutionLayout(Array(n).fill(r), Array(s).fill(r)).exactLength;
assert.equal(len(3, 0), 5_783); assert.equal(len(5, 0), 9_553); assert.equal(len(3, 1), 8_820); assert.equal(len(5, 1), 12_590); assert.equal(len(5, 5), 17_422);
assert.equal(len(5, 5, { ...cpmm(), bindingWidth: 7 }), 19_372);
assert.equal(len(5, 5, { ...cpmm(), bindingWidth: 8, accountsBindingVersion: 0 }), 20_022);
throwsAbi(() => len(1, 0, { ...cpmm(), bindingWidth: 8 }), /binding width/);
throwsAbi(() => len(6, 0), /N must be/); throwsAbi(() => len(1, 6), /N must be/);
// K1 membership record and GROW boundaries: ceil(final/10240)-1.
const k1 = mimirCompositeExecutionLayout([{ ...cpmm(), bindingWidth: 1 }], []);
assert.deepEqual([k1.rowsEnd, k1.membershipOffsets, k1.modulesOffset, k1.exactLength, k1.growCount], [1_749, [1_749], 1_818, 1_818, 0]);
assert.equal(len(5, 5, { ...cpmm(), bindingWidth: 7 }) > 10_240, true);
assert.equal(mimirCompositeExecutionLayout(Array(5).fill({ ...cpmm(), bindingWidth: 7 }), Array(5).fill({ ...cpmm(), bindingWidth: 7 })).growCount, 1);
const sampled = deriveMimirFusedRecipe({ role: "converter", adapterType: 6, adapterVersion: 0, externalWidth: 9, temporalModuleVersion: 4, minSlotGap: 1, accountsBindingVersion: 1 });
const big = mimirCompositeExecutionLayout(Array(5).fill(cpmm()), Array(5).fill(sampled));
assert.equal(big.exactLength, 14_782 + 5 * 264 + 5 * 459 + 5 * 1_280); assert.equal(big.growCount, 2);
assert.deepEqual(big.descriptors.slice(5).map((d) => d.moduleOffset), [0, 1, 2, 3, 4].map((j) => 14_782 + 5 * 264 + 5 * 459 + 1_280 * j));
assert.ok(big.descriptors.slice(0, 5).every((d) => d.moduleOffset === 0 && d.moduleLength === 0));

// Recipe table (§6.4): the ONE canonical table, transcribed from frozen 1fdb497 families.rs admitted_recipe.
// [type, version, mode, E, kind, role ("c" component / "x" converter / "*" both), variant, K legacy, K static, sysvar]
const FROZEN = [
  [2, 0, 6, 4, 0, "c", 0, 4, 4, 0], [2, 0, 0, 4, 0, "x", 0, 4, 4, 0], [2, 0, 2, 5, 0, "x", 0, 4, 4, 0], [2, 0, 3, 7, 1, "x", 0, 4, 4, 0],
  [1, 0, 0, 7, 0, "*", 1, 7, 4, 0], [1, 0, 2, 8, 0, "*", 1, 7, 4, 0], [1, 1, 0, 8, 0, "*", 1, 8, 5, 0], [1, 1, 2, 9, 0, "*", 1, 8, 5, 0],
  [0, 0, 0, 7, 0, "*", 1, 7, 4, 0], [0, 0, 3, 9, 0, "*", 1, 7, 4, 0],
  [3, 0, 1, 4, 0, "*", 0, 4, 3, 0], [3, 0, 0, 6, 0, "*", 1, 6, 3, 0], [3, 0, 2, 7, 0, "*", 0, 4, 3, 0], [3, 0, 2, 9, 0, "*", 1, 6, 3, 0],
  [3, 1, 1, 5, 0, "*", 0, 5, 4, 0], [3, 1, 0, 7, 0, "*", 1, 7, 4, 0], [3, 1, 2, 8, 0, "*", 0, 5, 4, 0], [3, 1, 2, 10, 0, "*", 1, 7, 4, 0],
  [7, 0, 0, 3, 0, "*", 0, 3, 3, 0], [7, 0, 3, 5, 2, "*", 0, 3, 3, 0], [7, 0, 3, 5, 3, "*", 0, 3, 3, 0],
  [4, 0, 4, 8, 4, "*", 0, 6, 6, 1], [4, 0, 5, 8, 5, "c", 0, 6, 6, 1],
  [6, 0, 4, 9, 4, "*", 0, 7, 7, 1], [6, 1, 4, 9, 4, "*", 0, 7, 7, 1], [6, 0, 5, 9, 5, "c", 0, 7, 7, 1], [6, 1, 5, 9, 5, "c", 0, 7, 7, 1],
] as const;
const tmOf = (t: number, kind: number) => kind === 0 ? undefined : kind === 1 ? 2 : kind === 2 ? 1 : kind === 3 ? 3 : 4;
for (const [t, v, mode, e, kind, role, variant, legacy, fixed, sysvar] of FROZEN) {
  for (const converterRow of [false, true]) {
    const admitted = role === "*" || (role === "x") === converterRow;
    for (const binding of [0, 1]) {
      const args = { adapterType: t, adapterVersion: v, accountsBindingVersion: binding, mode, externalWidth: e, temporalKind: kind, converterRow };
      if (!admitted) { throwsAbi(() => mimirAdmittedRecipe(args), /UnsupportedCompositeExecutionRecipe/); continue; }
      const r = mimirAdmittedRecipe(args);
      assert.deepEqual([r.mode, r.temporalKind, r.externalWidth, r.bindingVariant, r.bindingWidth, r.requiresInstructionsSysvar],
        [mode, kind, e, variant, binding ? fixed : legacy, sysvar === 1]);
      const tm = tmOf(t, kind);
      const derived = deriveMimirFusedRecipe({ role: converterRow ? "converter" : "component", adapterType: t, adapterVersion: v, externalWidth: e,
        ...(tm === undefined ? {} : { temporalModuleVersion: tm }), currentPoint: mode === 5, minSlotGap: mode === 5 ? 0 : 1, accountsBindingVersion: binding });
      assert.deepEqual(derived, { minSlotGap: mode === 5 ? 0 : 1, externalWidth: e, temporalKind: kind, mode, requiresInstructionsSysvar: sysvar === 1,
        adapterType: t, adapterVersion: v, bindingWidth: binding ? fixed : legacy, accountsBindingVersion: binding });
    }
  }
}
assert.equal(FROZEN.length, 27);
assert.deepEqual(cpmm().mode, 6);
// Off-table shapes: AMM-v4 v1, adapter version 2, mode-5 converter, ring/binding versions, caller-chosen gap, flags/mode mismatch.
throwsAbi(() => mimirAdmittedRecipe({ adapterType: 4, adapterVersion: 1, accountsBindingVersion: 1, mode: 4, externalWidth: 8, temporalKind: 4, converterRow: false }), /Unsupported/);
throwsAbi(() => mimirAdmittedRecipe({ adapterType: 6, adapterVersion: 2, accountsBindingVersion: 1, mode: 4, externalWidth: 9, temporalKind: 4, converterRow: false }), /Unsupported/);
throwsAbi(() => mimirAdmittedRecipe({ adapterType: 6, adapterVersion: 0, accountsBindingVersion: 1, mode: 5, externalWidth: 9, temporalKind: 5, converterRow: true }), /Unsupported/);
throwsAbi(() => mimirAdmittedRecipe({ adapterType: 2, adapterVersion: 0, accountsBindingVersion: 2, mode: 6, externalWidth: 4, temporalKind: 0, converterRow: false }), /binding version/);
for (const bad of [[1, 0, 4], [0, 0, 4], [2, 0, 6], [3, 0, 5], [7, 0, 4]] as [number, number, number][]) {
  throwsAbi(() => deriveMimirFusedRecipe({ role: "converter", adapterType: bad[0], adapterVersion: bad[1], externalWidth: bad[2], minSlotGap: 1, accountsBindingVersion: 1 }), /Unsupported/);
}
throwsAbi(() => deriveMimirFusedRecipe({ role: "component", adapterType: 2, adapterVersion: 0, externalWidth: 4, minSlotGap: 2, accountsBindingVersion: 1 }), /slot gap/);
throwsAbi(() => deriveMimirFusedRecipe({ role: "converter", adapterType: 6, adapterVersion: 0, externalWidth: 9, temporalModuleVersion: 4, currentPoint: true, minSlotGap: 0, accountsBindingVersion: 1 }), /Unsupported/);
throwsAbi(() => deriveMimirFusedRecipe({ role: "component", adapterType: 2, adapterVersion: 0, externalWidth: 5, minSlotGap: 1, accountsBindingVersion: 1 }), /Unsupported/);
const ammRecipe = mimirAdmittedRecipe({ adapterType: 4, adapterVersion: 0, accountsBindingVersion: 1, mode: 4, externalWidth: 8, temporalKind: 4, converterRow: false });
throwsAbi(() => mimirExpectedDescriptor(ammRecipe, { adapterType: 4, adapterVersion: 0, flags: 1 }, 1, 1_000), /flags/);
assert.equal(mimirExpectedDescriptor(ammRecipe, { adapterType: 4, adapterVersion: 0, flags: 0 }, 1, 1_000).requiresInstructionsSysvar, true);

// Descriptor golden bytes.
const d5 = encodeMimirFusedDescriptor(big.descriptors[5]!);
assert.deepEqual([...d5], [1, 0, 9, 4, ...[...new Uint8Array(new Uint32Array([18_397]).buffer)], 0x00, 0x05, 4, 1, 6, 0, 7, 1]);
throwsAbi(() => encodeMimirFusedDescriptor({ ...big.descriptors[5]!, moduleOffset: 0 }), /descriptor/);
throwsAbi(() => encodeMimirFusedDescriptor({ ...big.descriptors[0]!, moduleLength: 192 }), /descriptor/);

// Tag-88 BEGIN / GROW golden data.
const feed = fromHex("bd2ec4a4e849a804d8e8c796e0aa14fdc2dcc3447116ac08134d00ba4a125266");
assert.equal(hex(encodeMimirInitFusedBeginData({ compositeFeedId: feed, componentCount: 2, converterSourceCount: 0, finalLength: 3_888 })),
  "5800" + hex(feed) + "0200" + "300f0000");
assert.equal(hex(encodeMimirInitFusedGrowData({ compositeFeedId: feed, expectedCurrentLength: 10_240 })), "5801" + hex(feed) + "00280000");
assert.equal(encodeMimirInitFusedBeginData({ compositeFeedId: feed, componentCount: 1, converterSourceCount: 0, finalLength: 1_813 }).length, 40);
throwsAbi(() => encodeMimirInitFusedBeginData({ compositeFeedId: new Uint8Array(32), componentCount: 1, converterSourceCount: 0, finalLength: 1_813 }), /feed id/);
throwsAbi(() => encodeMimirInitFusedBeginData({ compositeFeedId: feed, componentCount: 0, converterSourceCount: 0, finalLength: 1_813 }), /BEGIN/);

// Full closure: N5 + S5 admitted DLMM v0 E9 converter => BEGIN, 1 GROW, SEAL; exact metas. The sampled converter layout is refused.
const dlmmConv = deriveMimirFusedRecipe({ role: "converter", adapterType: 3, adapterVersion: 0, externalWidth: 9, minSlotGap: 1, accountsBindingVersion: 1 });
const bigAdmitted = mimirCompositeExecutionLayout(Array(5).fill(cpmm()), Array(5).fill(dlmmConv));
const keys = Array.from({ length: 80 }, (_, i) => bytesAddress(new Uint8Array(32).fill(i + 1)));
const LOCK = bytesAddress(new Uint8Array(32).fill(200));
const witness = (i: number, gap: number): MimirInitSourceWitness => ({ feedId: Uint8Array.from({ length: 32 }, (_, k) => (k + i + 1) & 255), sourceIndex: i % 5,
  ringVersion: 1, minSlotGap: gap, expectedSourceConfigRevision: 1n, expectedSourceSetRevision: 1n, expectedPlanHash: new Uint8Array(32).fill(i + 1),
  sourceSetSiblings: [1, 2, 3].map((x) => new Uint8Array(32).fill(x)), accountsSiblings: [4, 5, 6].map((x) => new Uint8Array(32).fill(x)) });
let k = 10;
const comp = Array.from({ length: 5 }, () => ({ sourceConfig: keys[k++]!, feedConfig: keys[k++]!, sourcingPlan: keys[k++]!, externals: [keys[k++]!, keys[k++]!, keys[k++]!, keys[k++]!] }));
const conv = { feedConfig: keys[k++]!, sourcingPlan: keys[k++]!, sources: Array.from({ length: 5 }, () => ({ sourceConfig: keys[k++]!,
  externals: Array.from({ length: 9 }, (_, i) => keys[(k + i) % 80]!) })) };
const closure = buildMimirInitFusedCompositeClosure({ programId: PROGRAM, payer: keys[0]!, execution: keys[1]!, collateralLock: LOCK, compositeConfig: keys[2]!, registry: keys[3]!,
  compositeFeedId: feed, layout: bigAdmitted, witnesses: [...Array.from({ length: 5 }, (_, i) => witness(i, 1)), ...Array.from({ length: 5 }, (_, i) => witness(i + 5, 1))],
  components: comp, converter: conv });
assert.deepEqual(closure.map((ix) => [ix.data[0], ix.data[1], ix.data.length, ix.accounts.length]),
  [[88, 0, 40, 6], [88, 1, 38, 4], [88, 2, 36 + 301 * 10, 5 + 5 * 7 + 2 + 5 * (1 + 3) + 1]]);
assert.equal(new DataView(closure[1]!.data.buffer, closure[1]!.data.byteOffset).getUint32(34, true), 10_240);
assert.deepEqual(closure[0]!.accounts.map((m) => [m.isSigner, m.isWritable]), [[true, true], [false, true], [false, false], [false, false], [false, false], [false, false]]);
assert.deepEqual(closure[0]!.accounts.map((m) => m.address), [keys[0], keys[1], keys[2], "11111111111111111111111111111111", "Sysvar1nstructions1111111111111111111111111", LOCK]);
assert.equal(closure[0]!.accounts[4]!.address, MIMIR_INSTRUCTIONS_SYSVAR_ID); assert.equal(closure[2]!.accounts.at(-1)!.address, MIMIR_INSTRUCTIONS_SYSVAR_ID);
assert.ok(closure[2]!.accounts.slice(2).every((m) => !m.isWritable && !m.isSigner));
const seal = closure[2]!.data;
assert.deepEqual([...seal.subarray(34, 36)], [5, 5]);
assert.deepEqual(seal.subarray(36 + 16 * 5, 36 + 16 * 6), encodeMimirFusedDescriptor(bigAdmitted.descriptors[5]!));
const w0 = seal.subarray(36 + 160, 36 + 160 + 285);
assert.equal(w0[32], 0); assert.deepEqual([...w0.subarray(33, 37)], [1, 0, 1, 0]); assert.ok(w0.subarray(53, 61).every((x) => x === 0));
assert.equal(hex(await sha256(seal)), "24e4b24725eb05fbd21b67b15344f9350f38680ad89f427bbe0017c3a9018b3e");
throwsAbi(() => buildMimirInitFusedCompositeClosure({ programId: PROGRAM, payer: keys[0]!, execution: keys[1]!, collateralLock: LOCK, compositeConfig: keys[2]!, registry: keys[3]!,
  compositeFeedId: feed, layout: bigAdmitted, witnesses: [], components: comp, converter: conv }), /witness count/);
throwsAbi(() => buildMimirInitFusedCompositeClosure({ programId: PROGRAM, payer: keys[0]!, execution: keys[1]!, collateralLock: LOCK, compositeConfig: keys[2]!, registry: keys[3]!,
  compositeFeedId: feed, layout: bigAdmitted, witnesses: Array.from({ length: 10 }, (_, i) => witness(i, 2)), components: comp, converter: conv }), /slot gap/);
throwsAbi(() => buildMimirInitFusedCompositeClosure({ programId: PROGRAM, payer: keys[0]!, execution: keys[1]!, collateralLock: LOCK, compositeConfig: keys[2]!, registry: keys[3]!,
  compositeFeedId: feed, layout: bigAdmitted, witnesses: [], components: [{ ...comp[0]!, externals: comp[0]!.externals.slice(1) }, ...comp.slice(1)], converter: conv }), /width/);
throwsAbi(() => buildMimirInitFusedCompositeClosure({ programId: PROGRAM, payer: keys[0]!, execution: keys[1]!, collateralLock: LOCK, compositeConfig: keys[2]!, registry: keys[3]!,
  compositeFeedId: feed, layout: bigAdmitted, witnesses: [], components: [{ ...comp[0]!, externals: [keys[0]!, keys[0]!, keys[1]!, keys[2]!] }, ...comp.slice(1)], converter: conv }), /duplicate role/);
assert.throws(() => buildMimirInitFusedCompositeClosure({ programId: PROGRAM, payer: keys[0]!, execution: keys[1]!, collateralLock: LOCK, compositeConfig: keys[2]!, registry: keys[3]!,
  compositeFeedId: feed, layout: big, witnesses: [], components: comp, converter: conv }), (e: { code?: string }) => e.code === "CLASSIC_CONVERTER_UNSUPPORTED");

// Tag-87 CAS golden data and metas.
const req = { compositeFeedId: feed, expectedConfigRevision: 1n, previousSnapshotRevision: 7n, nextSnapshotRevision: 8n, componentSourceConfigRevisions: [1n, 1n],
  maxRefreshFeeLamports: 5_000n, componentRingNewestSlots: [100n, 101n], converterRingNewestSlots: [] as bigint[] };
const le8 = (x: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, x, true); return hex(b); };
assert.equal(hex(encodeMimirFusedRefreshData(req)), "57" + hex(feed) + le8(1n) + le8(7n) + le8(8n) + "02" + le8(1n) + le8(1n) + le8(0n).repeat(3) + le8(5_000n) + le8(100n) + le8(101n));
assert.equal(encodeMimirFusedRefreshData({ ...req, nextSnapshotRevision: 7n, maxRefreshFeeLamports: 0n }).length, 122);
assert.ok(isMimirFusedSampleOnlyData(encodeMimirFusedRefreshData({ ...req, nextSnapshotRevision: 7n, maxRefreshFeeLamports: 0n }), 7n));
assert.ok(!isMimirFusedSampleOnlyData(encodeMimirFusedRefreshData(req)));
for (const bad of [{ nextSnapshotRevision: 9n }, { nextSnapshotRevision: 7n }, { expectedConfigRevision: 2n }, { componentSourceConfigRevisions: [1n, 2n] }, { componentRingNewestSlots: [1n] }, { previousSnapshotRevision: -1n }]) {
  throwsAbi(() => encodeMimirFusedRefreshData({ ...req, ...bad }), /tag-87/);
}
const two = mimirCompositeExecutionLayout([cpmm(), cpmm()], []);
const fixed = { programId: PROGRAM, payer: keys[0]!, compositeSnapshot: keys[1]!, compositeConfig: keys[2]!, registry: keys[3]!, adminConfig: keys[4]!,
  feeVault: keys[5]!, treasury: keys[6]!, execution: keys[7]!, layout: two, converterExternals: [], request: req };
const ix87 = buildMimirFusedCompositeRefreshInstruction({ ...fixed, componentExternals: [comp[0]!.externals, comp[1]!.externals] });
assert.deepEqual(ix87.accounts.map((m) => `${m.isSigner ? "S" : ""}${m.isWritable ? "W" : "R"}`).join(","), "SW,W,R,R,R,W,W,R,W,R,R,R,R,R,R,R,R");
assert.equal(ix87.accounts[7]!.address, MIMIR_BETA_SYSTEM_PROGRAM_ID); assert.ok(!ix87.accounts.some((m) => m.address === MIMIR_INSTRUCTIONS_SYSVAR_ID));
throwsAbi(() => buildMimirFusedCompositeRefreshInstruction({ ...fixed, componentExternals: [[keys[1]!, ...comp[0]!.externals.slice(1)], comp[1]!.externals] }), /writable alias/);
throwsAbi(() => buildMimirFusedCompositeRefreshInstruction({ ...fixed, treasury: keys[5]!, componentExternals: [comp[0]!.externals, comp[1]!.externals] }), /writable alias/);
throwsAbi(() => buildMimirFusedCompositeRefreshInstruction({ ...fixed, componentExternals: [comp[0]!.externals] }), /row count/);
const point = mimirCompositeExecutionLayout([deriveMimirFusedRecipe({ role: "component", adapterType: 6, adapterVersion: 0, externalWidth: 9, temporalModuleVersion: 4, currentPoint: true, minSlotGap: 0, accountsBindingVersion: 1 })], []);
assert.equal(buildMimirFusedCompositeRefreshInstruction({ ...fixed, layout: point, componentExternals: [conv.sources[0]!.externals],
  request: { ...req, componentSourceConfigRevisions: [1n], componentRingNewestSlots: [0n] } }).accounts.at(-1)!.address, MIMIR_INSTRUCTIONS_SYSVAR_ID);
// A1 §5 sample-only: r/r + fee 0 only over a layout with a mode-4 row; mode 4 carries the shared Instructions sysvar.
const sampledRow = mimirCompositeExecutionLayout([deriveMimirFusedRecipe({ role: "component", adapterType: 4, adapterVersion: 0, externalWidth: 8, temporalModuleVersion: 4, minSlotGap: 1, accountsBindingVersion: 1 })], []);
const sampleReq = { ...req, previousSnapshotRevision: 0n, nextSnapshotRevision: 0n, maxRefreshFeeLamports: 0n, componentSourceConfigRevisions: [1n], componentRingNewestSlots: [0n] };
const sampleIx = buildMimirFusedCompositeRefreshInstruction({ ...fixed, layout: sampledRow, componentExternals: [keys.slice(60, 68)], request: sampleReq });
assert.equal(sampleIx.accounts.at(-1)!.address, MIMIR_INSTRUCTIONS_SYSVAR_ID); assert.ok(isMimirFusedSampleOnlyData(sampleIx.data, 0n));
throwsAbi(() => buildMimirFusedCompositeRefreshInstruction({ ...fixed, componentExternals: [comp[0]!.externals, comp[1]!.externals],
  request: { ...req, nextSnapshotRevision: 7n, maxRefreshFeeLamports: 0n } }), /mode-4/);

// Execution-state decoder over exact frozen-ELF images (f3d8e5f4…, 1fdb497; bank replay of a fused PHONES creation, N3 CPMM):
// post-Seal (rings/modules zero = absent) and post-tag-87 (rings written), then one mutation per embedded field.
const frozen = (name: string) => fromHex(readFileSync(new URL(`./fixtures/abi1/${name}.hex`, import.meta.url), "utf8"));
const sealed = frozen("phones-execution-post-seal"), image = frozen("phones-execution-post-tag87");
const provenance = JSON.parse(readFileSync(new URL("./fixtures/abi1/PROVENANCE.json", import.meta.url), "utf8"));
assert.deepEqual([provenance.elf.sha256, provenance.elf.length, provenance.elf.sourceCommit, provenance.elf.inPublicTree],
  ["f3d8e5f4a26100b2c54800a560c9174426fa56d7196ef713cb4e4f851f76839e", 1_503_720, "1fdb4970eccb27516d3fd6d83b5588d7074dc052", false]);
assert.equal(hex(await sha256(sealed)), "70222f33fd20f628c9d67c39c1c0d40bee12883012b62404a694297ee9b3b7d2");
assert.equal(hex(await sha256(image)), "bf754188752b78d5bea8eeae96137e1970407af11ecfe2f00db6ae1328ea653f");
for (const [state, slot] of [[sealed, 0n], [image, 508_831_055n]] as const) {
  const d = decodeMimirCompositeExecution(state);
  assert.deepEqual([d.active, d.exactLength, d.componentCount, d.converterSourceCount, d.bump, d.cfcRevision], [true, 5_783, 3, 0, 255, 1n]);
  assert.deepEqual(d.components.map((c) => [c.descriptor.mode, c.membership.bindingVariant, c.sourceConfigRevision, c.ringNewestSlot]), Array(3).fill([6, 0, 1n, slot]));
  assert.deepEqual(d.components.map((c) => encodeMimirFusedDescriptor(c.descriptor)), Array(3).fill(encodeMimirFusedDescriptor(mimirCompositeExecutionLayout([cpmm()], []).descriptors[0]!)));
}
const decoded = decodeMimirCompositeExecution(image); const m0 = decoded.layout.membershipOffsets[0]!;
const corrupt = (fn: (x: Uint8Array) => void, re: RegExp, base = image) => { const x = Uint8Array.from(base); fn(x); throwsAbi(() => decodeMimirCompositeExecution(x), re); };
corrupt((x) => { x[0] = 0; }, /magic/); corrupt((x) => { x[8] = 2; }, /layout/); corrupt((x) => { x[8] = 3; }, /header/); corrupt((x) => { x[122] = 2; }, /header/); corrupt((x) => { x[125] = 1; }, /header/);
corrupt((x) => { x[12] = 0; }, /header/); corrupt((x) => { x.fill(0, 80, 112); }, /header/); corrupt((x) => { x[128 + 10] = 7; }, /descriptor/);
corrupt((x) => { x[m0] = 3; }, /membership/); corrupt((x) => { x[m0 + 3] = 1; }, /membership/); corrupt((x) => { x[m0 + 68] = 2; }, /executable/);
corrupt((x) => { x[m0 + 2] = 1; }, /frozen derived layout/); corrupt((x) => { x[128 + 13] = 1; }, /frozen derived layout|Unsupported/);
corrupt((x) => { x[128] = 0; x[129] = 0; }, /frozen derived layout/);
// SourceConfig @+16, FeedConfig @+400, SourcingPlan @+757, ring @+1077: magic / version / length / reserved.
for (const [at, what] of [[16, /source config image/], [400, /feed config image/], [757, /plan image/], [1_077, /ring image/]] as const) {
  corrupt((x) => { x[128 + at] ^= 1; }, what); corrupt((x) => { x[128 + at + 8] ^= 1; }, what); corrupt((x) => { x[128 + at + 10] ^= 1; }, what);
}
corrupt((x) => { x[128 + 757 + 305] = 1; }, /plan image/); corrupt((x) => { x[128 + 757 + 304] = 0; }, /plan image/);
corrupt((x) => { x[128 + 16 + 49] = 1; }, /frozen derived layout|Unsupported|source config state/);
// Seal-equivalent embedded state: active source with nonzero revisions, FeedConfig reserved bytes and revision, plan scalars and hash.
const zero = (at: number, len: number) => (x: Uint8Array) => { x.fill(0, 128 + at, 128 + at + len); };
corrupt((x) => { x[128 + 16 + 50] = 1; }, /source config state/); corrupt(zero(16 + 360, 8), /source config state/);
corrupt(zero(16 + 368, 8), /source config state/);
corrupt((x) => { x[128 + 400 + 123] = 1; }, /feed config image/); corrupt((x) => { x[128 + 400 + 134] = 1; }, /feed config image/);
corrupt((x) => { x[128 + 400 + 135] = 1; }, /feed config image/); corrupt(zero(400 + 296, 8), /feed\/plan binding/);
corrupt((x) => { x[128 + 757 + 196] ^= 1; }, /plan image/); corrupt(zero(757 + 60, 2), /plan image/);
corrupt((x) => { x[128 + 1_077 + 100] = 1; }, /ring image/, sealed);
throwsAbi(() => decodeMimirCompositeExecution(image.subarray(0, image.length - 1)), /header/);

// Source binding -> fused external vectors.
assert.deepEqual(mimirFusedRowExternals({ adapterType: 2, adapterAccounts: keys.slice(50, 54) }), { externals: keys.slice(50, 54) });
assert.deepEqual(mimirFusedRowExternals({ adapterType: 2, adapterAccounts: keys.slice(50, 55),
  temporal: { version: 2, sourceProgram: keys[61]!, sourceProgramData: keys[62]! } }), { externals: [...keys.slice(50, 55), keys[61], keys[62]], temporalModuleVersion: 2 });
assert.deepEqual(mimirFusedRowExternals({ adapterType: 6, adapterAccounts: keys.slice(50, 57) }).externals.slice(7),
  [MIMIR_SAMPLED_SOURCE_ADAPTERS[6].program, MIMIR_SAMPLED_SOURCE_ADAPTERS[6].programData]);
// P2 frozen-ELF bank: the accepted CPMM component descriptor and the PHONES (N3) / SDEFI1 (N5) execution lengths match this SDK,
// and the frozen PHONES header is the address-derived one.
assert.equal(hex(encodeMimirFusedDescriptor(mimirCompositeExecutionLayout([cpmm()], []).descriptors[0]!)), "01000400000000000000060002000401");
assert.deepEqual([len(3, 0), len(5, 0)], [5_783, 9_553]);
assert.equal(hex(image.subarray(0, 16)), "4d494d49524345460100800097160000");
assert.equal(hex(decoded.compositeFeedId), "bd2ec4a4e849a804d8e8c796e0aa14fdc2dcc3447116ac08134d00ba4a125266");
assert.deepEqual(await deriveMimirCompositeExecutionAddress(PROGRAM, decoded.compositeFeedId), ["3ZsF6wtvSjV9fNTjMQzp8zx83ucu19vRoLevXTDuBVJ6", 255]);
// Binding-v0 (Merkle-v1, ring-v1) plans: the plan decoders admit them with the recomputed hash, the recipe takes the legacy K,
// and a Seal image of that plan decodes with the frozen descriptor/membership; a binding-1 descriptor over it is rejected.
{
  const { canonicalRowImages, compositeExecutionImage } = await import("./fixtures/compositeExecutionImage.js");
  const { decodeMimirBetaLivePlan } = await import("../src/beta/liveAbi.js");
  const clmm = (accountsBindingVersion: number) => deriveMimirFusedRecipe({ role: "component", adapterType: 1, adapterVersion: 0, externalWidth: 7, minSlotGap: 1, accountsBindingVersion });
  assert.deepEqual([clmm(0).bindingWidth, clmm(0).accountsBindingVersion, clmm(1).bindingWidth], [7, 0, 4]);
  const im = canonicalRowImages(new Uint8Array(32).fill(21), [clmm(0)]);
  assert.equal((await decodeMimirBetaLivePlan(im.plan)).accountsBindingVersion, 0);
  const bad = Uint8Array.from(im.plan); bad[304] = 2; await assert.rejects(decodeMimirBetaLivePlan(bad), /InvalidLifecycleSourcingPlan/);
  const images = { rows: [{ source: im.sources[0]!, feed: im.feed, plan: im.plan }] };
  const v0 = decodeMimirCompositeExecution(compositeExecutionImage({ feedId: new Uint8Array(32).fill(22), cfc: keys[3]!, components: [clmm(0)], images }));
  assert.deepEqual([v0.components[0]!.membership.bindingWidth, v0.components[0]!.membership.accountsBindingVersion, v0.components[0]!.membership.bindingVariant], [7, 0, 1]);
  throwsAbi(() => decodeMimirCompositeExecution(compositeExecutionImage({ feedId: new Uint8Array(32).fill(22), cfc: keys[3]!, components: [clmm(1)], images })),
    /frozen derived layout/);
}
console.log("compositeExecutionAbi1 ok");
