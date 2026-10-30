import assert from "node:assert/strict";
import type { Address } from "@solana/kit";
import { decodeMimirCompositeExecution, deriveMimirFusedRecipe, encodeMimirCompositeDualProof, mimirAdmittedRecipe, mimirCompositeCspCommitmentV2,
  mimirCompositeDualPublication, mimirCompositeExecutionLayout, mimirCompositeExecutionImmutableBytes, mimirStaticSealWidth } from "../src/beta/compositeExecution.js";
import { canonicalRowImages, compositeExecutionImage } from "./fixtures/compositeExecutionImage.js";

const throwsAbi = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: Error) => re.test(e.message));
const dual = deriveMimirFusedRecipe({ role: "component", adapterType: 2, adapterVersion: 0, externalWidth: 7, minSlotGap: 1, accountsBindingVersion: 1, dual: true });
const spot = deriveMimirFusedRecipe({ role: "component", adapterType: 2, adapterVersion: 0, externalWidth: 4, minSlotGap: 1, accountsBindingVersion: 1 });
assert.deepEqual([dual.temporalKind, dual.mode, dual.externalWidth, dual.bindingWidth, dual.requiresInstructionsSysvar, mimirStaticSealWidth(dual)], [6, 2, 7, 4, true, 4]);
assert.equal(mimirAdmittedRecipe({ ...dual, converterRow: false }).tag77Roles, 5);
throwsAbi(() => deriveMimirFusedRecipe({ role: "converter", adapterType: 2, adapterVersion: 0, externalWidth: 7, minSlotGap: 1, accountsBindingVersion: 1, dual: true }), /Unsupported/);
// V2 geometry: Cu×5 10,037 / proof 484, Cu×2 4,130 / 232; V1 unchanged.
const l5 = mimirCompositeExecutionLayout(Array(5).fill(dual), []);
assert.deepEqual([l5.version, l5.exactLength, l5.proofLength, l5.growCount], [2, 10_037, 484, 0]);
assert.deepEqual([mimirCompositeExecutionLayout([dual, dual], []).exactLength, mimirCompositeExecutionLayout([dual, dual], []).proofLength], [4_130, 232]);
assert.deepEqual([mimirCompositeExecutionLayout([spot, spot], []).version, mimirCompositeExecutionLayout([spot, spot], []).exactLength], [1, 3_898]);

const feedId = new Uint8Array(32).fill(9); const cfc = "11111111111111111111111111111113" as Address;
const recipes = [dual, spot];
const im = canonicalRowImages(feedId, recipes);
const images = { rows: recipes.map((_, r) => ({ source: im.sources[r]!, feed: im.feed, plan: im.plan })) };
const sealed = compositeExecutionImage({ feedId, cfc, components: recipes, images });
const state0 = decodeMimirCompositeExecution(sealed);
assert.deepEqual([state0.version, state0.proof], [2, null]);
const v1 = Uint8Array.from(sealed); v1[8] = 1; throwsAbi(() => decodeMimirCompositeExecution(v1), /layout/);

const program = "11111111111111111111111111111112" as Address; const execution = "11111111111111111111111111111114" as Address; const csp = "11111111111111111111111111111115" as Address;
assert.equal((await mimirCompositeDualPublication({ programId: program, execution, state: state0, csp: null }))!.rows[0]!.effectiveMode, "UNAVAILABLE");
const cspData = new Uint8Array(720); const cv = new DataView(cspData.buffer);
cspData.set(new TextEncoder().encode("MIMIRCSP")); cv.setUint16(10, 720, true); cv.setUint32(12, 1, true); cspData.set(feedId, 16); cspData.fill(5, 48, 80);
cv.setBigUint64(80, 5n, true); cv.setBigUint64(88, 2n, true); cv.setBigUint64(96, 3n, true); cspData[105] = 4; cspData[107] = 4; cspData[109] = 1;
cv.setBigUint64(112, 10n, true); cv.setBigUint64(120, 160n, true); cv.setBigUint64(136, 10n, true); cv.setBigUint64(152, 1n, true); cv.setInt32(160, -6, true);
for (const o of [168, 184, 200, 352, 360, 368, 384]) cv.setBigUint64(o, 1n, true);
cspData.fill(6, 248, 312); cspData[313] = 1; cspData.fill(4, 320, 352);
const ev = { declaredWireAge: 150, configuredSourceCount: 1, publishedK: 1, effectiveK: 1, venueCount: 1, correlationDomainCount: 1, quiet: false, sampled: false,
  point: true, commonSupport: false, minRingNewestSlot: 9n, quietLastRefresh: 0n, quietIntervalEnd: 0n, quietIntervalEndSlot: 0n, quietWidthBps: 0,
  sampledBandBps: 0, sampledCloseDeviationBps: 0, supportStart: 0n, supportEnd: 0n, nativeFloor: 500_000n };
const proof = { converterPresent: false, currentPoint: true, parentRevision: 3n, parentSlot: 10n, cspCommitment: await mimirCompositeCspCommitmentV2(program, execution, csp, cspData),
  rows: [{ profile: "DUAL_NATIVE_POINT_V1", effectiveMode: "CURRENT_POINT", nativeQualificationReason: "NATIVE_ENDPOINT_STALE", appliedBoundKind: "POINT_DEPTH_UNCERTIFIED", evidence: ev },
    { profile: "FIXED_RECIPE", effectiveMode: "FIXED_NON_POINT", nativeQualificationReason: "NATIVE_QUALIFIED", appliedBoundKind: "EXISTING_COMPOSITE_V1", evidence: { ...ev, point: false, nativeFloor: 0n } }],
  converter: null } as const;
const descriptors = state0.layout.descriptors;
const bytes = encodeMimirCompositeDualProof(proof, descriptors, 0);
assert.deepEqual([...bytes.subarray(64 + 80, 64 + 84), ...bytes.subarray(148 + 80, 148 + 84), bytes[12]], [1, 2, 1, 2, 0, 3, 0, 3, 5]);
const published = Uint8Array.from(sealed); published.set(bytes, state0.layout.proofOffset);
const state = decodeMimirCompositeExecution(published);
assert.deepEqual(state.proof!.rows.map((r) => r?.effectiveMode), ["CURRENT_POINT", "FIXED_NON_POINT"]);
assert.deepEqual(mimirCompositeExecutionImmutableBytes(published), mimirCompositeExecutionImmutableBytes(sealed));
for (const [at, value, re] of [[64 + 81, 1, /decision/], [64 + 83, 1, /decision/], [148 + 81, 2, /decision/], [12, 1, /CURRENT_POINT/], [8, 1, /header/], [64 + 80, 0, /decision/]] as const) {
  const bad = Uint8Array.from(published); bad[state0.layout.proofOffset + at] = value; throwsAbi(() => decodeMimirCompositeExecution(bad), re);
}
throwsAbi(() => decodeMimirCompositeExecution(published.subarray(0, published.length - 1)), /header/);
const pub = (await mimirCompositeDualPublication({ programId: program, execution, state, csp: { address: csp, data: cspData } }))!;
assert.deepEqual([pub.parentCurrentPoint, pub.parentRevision, pub.rows[0]!.effectiveMode, pub.rows[0]!.floor, pub.rows[1]!.appliedBoundKind],
  [true, 3n, "CURRENT_POINT", 500_000n, "EXISTING_COMPOSITE_V1"]);
// The typed readout must bind the exact CSP; a changed or absent CSP is refused, never mixed.
const other = Uint8Array.from(cspData); other[160] = 0xf9;
await assert.rejects(mimirCompositeDualPublication({ programId: program, execution, state, csp: { address: csp, data: other } }), /commit/);
await assert.rejects(mimirCompositeDualPublication({ programId: program, execution, state, csp: null }), /commit/);
// A below-floor DUAL row publishes an all-zero record under a Degraded CSP; a Fresh CSP never carries one.
for (const status of [1, 0]) {
  const csp2 = Uint8Array.from(cspData); new DataView(csp2.buffer).setUint32(12, 0, true);
  if (status) { csp2[104] = 1; csp2[105] = 5; csp2[314] = 0x20; csp2[318] = 1; }
  const zero = encodeMimirCompositeDualProof({ ...proof, currentPoint: false, cspCommitment: await mimirCompositeCspCommitmentV2(program, execution, csp, csp2),
    rows: [null, proof.rows[1]] }, descriptors, 0);
  const st = decodeMimirCompositeExecution(Uint8Array.from([...sealed.subarray(0, state0.layout.proofOffset), ...zero]));
  assert.equal(st.proof!.rows[0], null);
  const read = mimirCompositeDualPublication({ programId: program, execution, state: st, csp: { address: csp, data: csp2 } });
  if (status) assert.equal((await read)!.rows[0]!.effectiveMode, "UNAVAILABLE"); else await assert.rejects(read, /commit/);
}
console.log("compositeDual ok");
