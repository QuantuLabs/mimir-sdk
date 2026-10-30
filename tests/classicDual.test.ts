import assert from "node:assert/strict";
import { deriveMimirClassicRecipe, decodeMimirClassicPublicationProof, encodeMimirClassicPublicationProof, deriveMimirFusedRecipe } from "../src/beta/index.js";
import { mimirSnapshotPricingMode } from "../src/liveness.js";

const base = { adapterType: 2, adapterVersion: 0, externalWidth: 7, minSlotGap: 1, dual: true } as const;
const d = deriveMimirClassicRecipe({ ...base, role: "primary" });
assert.deepEqual([d.temporalKind, d.mode, d.requiresInstructionsSysvar, d.bindingWidth, d.externalWidth], [6, 2, true, 4, 7]);
assert.throws(() => deriveMimirClassicRecipe({ ...base, role: "converter" }));
assert.equal(deriveMimirFusedRecipe({ ...base, role: "component", accountsBindingVersion: 1 }).temporalKind, 6);
assert.throws(() => deriveMimirFusedRecipe({ ...base, role: "converter", accountsBindingVersion: 1 }));
assert.equal(deriveMimirClassicRecipe({ ...base, externalWidth: 5, dual: false, role: "primary" }).temporalKind, 0);

const ev = { declaredWireAge: 150, configuredSourceCount: 1, publishedK: 1, effectiveK: 1, venueCount: 1, correlationDomainCount: 1, quiet: false, sampled: false,
  point: true, commonSupport: false, minRingNewestSlot: 9n, quietLastRefresh: 0n, quietIntervalEnd: 0n, quietIntervalEndSlot: 0n, quietWidthBps: 0,
  sampledBandBps: 0, sampledCloseDeviationBps: 0, supportStart: 0n, supportEnd: 0n, nativeFloor: 80_000_000n };
const dual = { profile: "DUAL_NATIVE_POINT_V1", effectiveMode: "CURRENT_POINT", nativeQualificationReason: "NATIVE_ENDPOINT_STALE", appliedBoundKind: "POINT_DEPTH_UNCERTIFIED" } as const;
const proof = { valid: true, converterPresent: false, snapshotRevision: 3n, publicationSlot: 10n, primary: ev, converter: null, dual };
const bytes = encodeMimirClassicPublicationProof(proof);
assert.deepEqual([bytes[8], ...bytes.subarray(248, 256)], [2, 1, 2, 1, 2, 0, 0, 0, 0]);
assert.deepEqual(decodeMimirClassicPublicationProof(bytes)?.dual, dual);
const bad = Uint8Array.from(bytes); bad[251] = 1;
assert.throws(() => decodeMimirClassicPublicationProof(bad));
const v1 = Uint8Array.from(bytes); v1[8] = 1;
assert.throws(() => decodeMimirClassicPublicationProof(v1));
const { dual: _d, ...plain } = proof;
assert.equal(decodeMimirClassicPublicationProof(encodeMimirClassicPublicationProof(plain))?.dual, undefined);

const snap = new Uint8Array(512); snap.set(new TextEncoder().encode("MIMIRSNP")); snap[107] = 7;
assert.equal(mimirSnapshotPricingMode(snap), "current-point");
snap[107] = 5; assert.equal(mimirSnapshotPricingMode(snap), "standard");
snap[104] = 1; assert.equal(mimirSnapshotPricingMode(snap), null);
console.log("classicDual ok");

const { mimirClassicCpmmNativeReadiness } = await import("../src/beta/live.js");
const cold = new Uint8Array(4_075); cold.fill(7, 0, 8); cold.fill(9, 11, 43);
assert.deepEqual(mimirClassicCpmmNativeReadiness(cold, 1_000n, true), { ready: false, lastUpdate: 0n, ageSecs: 1_000n, maxEligibleSpanSecs: null, oldestSpanSecs: 0n });
assert.throws(() => mimirClassicCpmmNativeReadiness(cold, 1_000n));
const dirty = Uint8Array.from(cold); dirty[4_000] = 1;
assert.throws(() => mimirClassicCpmmNativeReadiness(dirty, 1_000n, true));
const init = Uint8Array.from(cold); init[8] = 1;
assert.throws(() => mimirClassicCpmmNativeReadiness(init, 1_000n, true));
console.log("classicDual cold observation ok");
