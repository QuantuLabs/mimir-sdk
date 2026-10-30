import assert from "node:assert/strict";
import { decodeMimirFusedClassicData, encodeMimirFusedClassicData, MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS } from "../src/beta/classicExecution.js";
import { encodeMimirFusedRefreshData } from "../src/beta/compositeExecution.js";

const publish = { feedId: new Uint8Array(32).fill(1), declaredMaxSnapshotAge: 150, previousSnapshotRevision: 4n, nextSnapshotRevision: 5n,
  componentCount: 1, sourceSetRevision: 1n, planHash: new Uint8Array(32).fill(2), converterSourceCount: 0, feedConfigRevision: 1n, ringNewestSlots: [9n] };
assert.equal(MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS, 2);
for (const w of [0, 2, 150]) {
  const d = encodeMimirFusedClassicData({ ...publish, maxReuseAgeSlots: w });
  assert.deepEqual([d.length, d[94]! | (d[95]! << 8)], [112, w]);
  assert.equal(decodeMimirFusedClassicData(d).maxReuseAgeSlots, w === 0 ? undefined : w);
}
assert.throws(() => encodeMimirFusedClassicData({ ...publish, maxReuseAgeSlots: 0x10000 }));
const composite = { compositeFeedId: new Uint8Array(32).fill(3), expectedConfigRevision: 1n, previousSnapshotRevision: 4n, nextSnapshotRevision: 5n,
  componentSourceConfigRevisions: [1n, 1n], maxRefreshFeeLamports: 20_000n, componentRingNewestSlots: [9n, 9n], converterRingNewestSlots: [] };
const plain = encodeMimirFusedRefreshData(composite); const windowed = encodeMimirFusedRefreshData({ ...composite, maxReuseAgeSlots: 2 });
assert.deepEqual([windowed.length, windowed[64], windowed[65], windowed[58]], [plain.length, 2, 0, 1]);
assert.deepEqual(windowed.filter((_, i) => i !== 64), plain.filter((_, i) => i !== 64));
console.log("publishReuseWindow ok");
