import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Address } from "@solana/kit";
import { createMimirBetaReconciliationSemanticHash } from "../src/beta/reconciliation.js";
import { mimirClassicSnapshotCodec } from "../src/beta/creation.js";
import { deriveMimirClassicExecutionAddress, encodeMimirClassicPublicationProof, mimirClassicExecutionLayout,
  deriveMimirClassicRecipe } from "../src/beta/index.js";
import { decodeFeedSnapshotHeader } from "../src/codec.js";
import { buildTestSnapshotHeader } from "../src/fixtures.js";

// DUAL rows expect a DUAL snapshot; native-bounded keeps source 5 only.
assert.equal(mimirClassicSnapshotCodec([["obs"]], [null], [true]), "dual-feed-snapshot-v5");
assert.equal(mimirClassicSnapshotCodec([["obs"]], [null], [false]), "bounded-feed-snapshot-v5");
assert.equal(mimirClassicSnapshotCodec([["obs"]], [null]), "bounded-feed-snapshot-v5");

const programId = "MiMiR11111111111111111111111111111111111111" as Address;
const snapshotAddress = "SnapShot1111111111111111111111111111111111" as Address;
const pointSnapshot = new Uint8Array(readFileSync(new URL("./fixtures/current-point/point-snapshot.bin", import.meta.url)));
const header = decodeFeedSnapshotHeader(pointSnapshot);
const slot = header.snapshotSlot; const revision = header.snapshotRevision;
// The same publication on a ready pool: native bounded source 5.
const nativeSnapshot = buildTestSnapshotHeader((data) => { const v = new DataView(data.buffer, data.byteOffset);
  data.set(pointSnapshot.subarray(16, 48), 16); data[107] = 5; data.fill(0, 156, 188); v.setUint16(255, 10_000, true);
  v.setBigUint64(96, revision, true); for (const at of [116, 140, 148]) v.setBigUint64(at, slot, true); v.setBigUint64(124, slot + 20n, true); });
const [execution] = await deriveMimirClassicExecutionAddress(programId, header.feedId);

const ev = (point: boolean) => ({ declaredWireAge: 150, configuredSourceCount: 1, publishedK: 1, effectiveK: 1, venueCount: 1, correlationDomainCount: 1,
  quiet: false, sampled: false, point, commonSupport: !point, minRingNewestSlot: slot, quietLastRefresh: 0n, quietIntervalEnd: 0n, quietIntervalEndSlot: 0n,
  quietWidthBps: 0, sampledBandBps: 0, sampledCloseDeviationBps: 0, supportStart: point ? 0n : 1n, supportEnd: point ? 0n : 2n, nativeFloor: 400n });
type Reason = "NATIVE_QUALIFIED" | "NATIVE_ENDPOINT_STALE" | "INSUFFICIENT_CONNECTED_HISTORY" | "REBUILDING_AFTER_GAP";
const executionAccount = (adapterType: 2 | 3, reason: Reason | null, at = { revision, slot }) => {
  const layout = mimirClassicExecutionLayout([deriveMimirClassicRecipe({ role: "primary", adapterType, adapterVersion: 0, externalWidth: 7, minSlotGap: 1,
    dual: true, ...(adapterType === 3 ? { accountsBindingVersion: 1 } : {}) })], []);
  const data = new Uint8Array(layout.exactLength);
  const point = reason !== "NATIVE_QUALIFIED";
  if (reason) data.set(encodeMimirClassicPublicationProof({ valid: true, converterPresent: false, snapshotRevision: at.revision, publicationSlot: at.slot,
    primary: ev(point), converter: null, ...(reason === null ? {} : { dual: { profile: "DUAL_NATIVE_POINT_V1" as const,
      effectiveMode: point ? "CURRENT_POINT" as const : "NATIVE" as const, nativeQualificationReason: reason,
      appliedBoundKind: point ? "POINT_DEPTH_UNCERTIFIED" as const : "NATIVE_CERTIFIED" as const } }) }), 128);
  return { address: execution, owner: programId, executable: false, lamports: 1n, data };
};
const hash = (codec: "dual-feed-snapshot-v5" | "bounded-feed-snapshot-v5", data: Uint8Array, exec: ReturnType<typeof executionAccount> | null,
  contextSlot = slot) => createMimirBetaReconciliationSemanticHash({ codec, address: snapshotAddress,
  account: { address: snapshotAddress, owner: programId, executable: false, lamports: 1n, data }, transactionSlot: slot, accountContextSlot: contextSlot,
  blockTime: null, accounts: new Map(exec ? [[execution, exec]] : []) });
const refused = (p: Promise<unknown>) => assert.rejects(p, (e: { code?: string }) => e.code === "RECONCILIATION_CONFLICT");

// Idle CPMM v0 (STALE) and DLMM v0 (REBUILDING_AFTER_GAP / cold) publish the point branch; active pools publish native.
// The simulated post-state (prepare) and the finalized post-state read later (reconcile) hash equal.
for (const [adapter, reason] of [[2, "NATIVE_ENDPOINT_STALE"], [2, "INSUFFICIENT_CONNECTED_HISTORY"], [3, "REBUILDING_AFTER_GAP"],
  [3, "INSUFFICIENT_CONNECTED_HISTORY"]] as const) {
  const prepared = await hash("dual-feed-snapshot-v5", pointSnapshot, executionAccount(adapter, reason));
  assert.equal(await hash("dual-feed-snapshot-v5", pointSnapshot, executionAccount(adapter, reason), slot + 5n), prepared);
}
for (const adapter of [2, 3] as const) {
  const prepared = await hash("dual-feed-snapshot-v5", nativeSnapshot, executionAccount(adapter, "NATIVE_QUALIFIED"));
  assert.equal(await hash("dual-feed-snapshot-v5", nativeSnapshot, executionAccount(adapter, "NATIVE_QUALIFIED"), slot + 5n), prepared);
}
// Branch must match the proof v2 decision, revision and slot; no proof, v1 proof or missing execution refuse.
await refused(hash("dual-feed-snapshot-v5", pointSnapshot, executionAccount(2, "NATIVE_QUALIFIED")));
await refused(hash("dual-feed-snapshot-v5", nativeSnapshot, executionAccount(3, "REBUILDING_AFTER_GAP")));
await refused(hash("dual-feed-snapshot-v5", pointSnapshot, executionAccount(2, "NATIVE_ENDPOINT_STALE", { revision: revision + 1n, slot })));
await refused(hash("dual-feed-snapshot-v5", pointSnapshot, executionAccount(2, "NATIVE_ENDPOINT_STALE", { revision, slot: slot - 1n })));
await refused(hash("dual-feed-snapshot-v5", pointSnapshot, executionAccount(2, null)));
await refused(hash("dual-feed-snapshot-v5", pointSnapshot, null));
const degraded = Uint8Array.from(pointSnapshot); degraded[104] = 1;
await refused(hash("dual-feed-snapshot-v5", degraded, executionAccount(2, "NATIVE_ENDPOINT_STALE")));
const spot = Uint8Array.from(nativeSnapshot); spot[107] = 1;
await refused(hash("dual-feed-snapshot-v5", spot, executionAccount(2, "NATIVE_QUALIFIED")));
// A source-7 publication for a non-DUAL (native-bounded) recipe is still refused; its source-5 path is unchanged.
await refused(hash("bounded-feed-snapshot-v5", pointSnapshot, executionAccount(2, "NATIVE_ENDPOINT_STALE")));
await hash("bounded-feed-snapshot-v5", nativeSnapshot, null);
console.log("dualIdleCreation ok");
