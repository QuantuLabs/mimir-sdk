import assert from "node:assert/strict";
import { decodeMimirClassicPublicationProof, deriveMimirClassicRecipe, deriveMimirFusedRecipe, encodeMimirClassicPublicationProof, encodeMimirCompositeDualProof,
  mimirAdmittedRecipe, mimirClassicExecutionLayout, mimirCompositeExecutionLayout, mimirFusedRecipeBindingVariant, mimirStaticSealWidth } from "../src/beta/index.js";

const throwsAbi = (fn: () => unknown) => assert.throws(fn, /Unsupported/);
const dual = (adapterVersion: 0 | 1, externalWidth: number, role: "primary" | "converter" = "primary", accountsBindingVersion = 1) =>
  deriveMimirClassicRecipe({ role, adapterType: 3, adapterVersion, externalWidth, minSlotGap: 1, dual: true, accountsBindingVersion });
// DLMM DUAL arms (§5.1): visible E7/E8 DIRECT, routeable E9/E10 ROUTEABLE; static binding only; never a converter.
for (const [v, e, k, variant, tag77] of [[0, 7, 3, 0, 7], [1, 8, 4, 0, 8], [0, 9, 3, 1, 9], [1, 10, 4, 1, 10]] as const) {
  const r = dual(v, e);
  assert.deepEqual([r.temporalKind, r.mode, r.bindingWidth, r.requiresInstructionsSysvar, r.minSlotGap, mimirFusedRecipeBindingVariant(r)], [6, 2, k, true, 1, variant]);
  assert.equal(mimirAdmittedRecipe({ ...r, converterRow: false }).tag77Roles, tag77);
  throwsAbi(() => dual(v, e, "converter")); throwsAbi(() => dual(v, e, "primary", 0));
  assert.equal(deriveMimirFusedRecipe({ role: "component", adapterType: 3, adapterVersion: v, externalWidth: e, minSlotGap: 1, accountsBindingVersion: 1, dual: true }).temporalKind, 6);
}
// exact_len N1/S0 (§4.1, §5.1): DUAL 2,716 / 2,781; point 3,996 / 4,061.
assert.deepEqual([mimirClassicExecutionLayout([dual(0, 7)], []).exactLength, mimirClassicExecutionLayout([dual(1, 8)], []).exactLength], [2_716, 2_781]);
const point = (v: 0 | 1, role: "component" | "converter" = "component", accountsBindingVersion = 1) => deriveMimirFusedRecipe({ role, adapterType: 3, adapterVersion: v,
  externalWidth: 6 + v, temporalModuleVersion: 4, currentPoint: true, minSlotGap: 0, accountsBindingVersion });
for (const v of [0, 1] as const) {
  const p = point(v);
  assert.deepEqual([p.mode, p.temporalKind, p.bindingWidth, p.requiresInstructionsSysvar, mimirStaticSealWidth({ ...p }), mimirAdmittedRecipe({ ...p, converterRow: false }).tag77Roles],
    [5, 5, 3 + v, true, 6 + v, 4 + v]);
  assert.equal(mimirClassicExecutionLayout([p], []).exactLength, [3_996, 4_061][v]);
  throwsAbi(() => point(v, "converter")); throwsAbi(() => point(v, "component", 0));
}
throwsAbi(() => deriveMimirFusedRecipe({ role: "component", adapterType: 3, adapterVersion: 0, externalWidth: 6, temporalModuleVersion: 4, minSlotGap: 1, accountsBindingVersion: 1 }));
// CompositeExecutionV2 iff a DUAL row (DLMM included).
assert.equal(mimirCompositeExecutionLayout([dual(0, 7), point(0)], []).version, 2);
assert.equal(mimirCompositeExecutionLayout([point(0), point(1)], []).version, 1);

// Reason 3 REBUILDING_AFTER_GAP: classic proof v2 codec; composite tuple [1,2,3,2] only on a DLMM DUAL row.
const ev = { declaredWireAge: 150, configuredSourceCount: 1, publishedK: 1, effectiveK: 1, venueCount: 1, correlationDomainCount: 1, quiet: false, sampled: false,
  point: true, commonSupport: false, minRingNewestSlot: 9n, quietLastRefresh: 0n, quietIntervalEnd: 0n, quietIntervalEndSlot: 0n, quietWidthBps: 0,
  sampledBandBps: 0, sampledCloseDeviationBps: 0, supportStart: 0n, supportEnd: 0n, nativeFloor: 500n };
const gap = { profile: "DUAL_NATIVE_POINT_V1", effectiveMode: "CURRENT_POINT", nativeQualificationReason: "REBUILDING_AFTER_GAP", appliedBoundKind: "POINT_DEPTH_UNCERTIFIED" } as const;
const classic = encodeMimirClassicPublicationProof({ valid: true, converterPresent: false, snapshotRevision: 3n, publicationSlot: 10n, primary: ev, converter: null, dual: gap });
assert.deepEqual([...classic.subarray(248, 252)], [1, 2, 3, 2]);
assert.equal(decodeMimirClassicPublicationProof(classic)?.dual?.nativeQualificationReason, "REBUILDING_AFTER_GAP");
const cpmm = deriveMimirFusedRecipe({ role: "component", adapterType: 2, adapterVersion: 0, externalWidth: 7, minSlotGap: 1, accountsBindingVersion: 1, dual: true });
const proof = (d: typeof cpmm) => encodeMimirCompositeDualProof({ converterPresent: false, currentPoint: true, parentRevision: 3n, parentSlot: 10n,
  cspCommitment: new Uint8Array(32).fill(1), rows: [{ ...gap, evidence: ev }], converter: null }, mimirCompositeExecutionLayout([d], []).descriptors, 0);
assert.deepEqual([...proof(deriveMimirFusedRecipe({ role: "component", adapterType: 3, adapterVersion: 0, externalWidth: 7, minSlotGap: 1, accountsBindingVersion: 1, dual: true }))
  .subarray(64 + 80, 64 + 84)], [1, 2, 3, 2]);
assert.throws(() => proof(cpmm), /decision/);
console.log("dlmmDual ok");
