import assert from "node:assert/strict";
import { decodeMimirFusedClassicData, encodeMimirFusedClassicData } from "../src/beta/classicExecution.js";
import { decodeMimirFusedRefreshData, encodeMimirFusedRefreshData } from "../src/beta/compositeExecution.js";
import { buildTestSnapshotHeader, defaultTestSnapshotPolicy } from "../src/fixtures.js";
import { decodeFeedSnapshotHeader, decodeVerifySnapshotReturnData, encodeVerifySnapshotData, verifySnapshotHeader } from "../src/index.js";

const sample = { feedId: new Uint8Array(32).fill(1), declaredMaxSnapshotAge: 150, previousSnapshotRevision: 4n, nextSnapshotRevision: 4n,
  componentCount: 1, sourceSetRevision: 1n, planHash: new Uint8Array(32).fill(2), converterSourceCount: 0, feedConfigRevision: 1n, ringNewestSlots: [9n] };
const exact = encodeMimirFusedClassicData(sample); const ensure = encodeMimirFusedClassicData({ ...sample, ensureSample: true });
assert.deepEqual([exact[93], ensure[93]], [0, 1]);
assert.deepEqual(decodeMimirFusedClassicData(ensure), { ...sample, ensureSample: true });
assert.equal(decodeMimirFusedClassicData(exact).ensureSample, undefined);
assert.throws(() => encodeMimirFusedClassicData({ ...sample, nextSnapshotRevision: 5n, ensureSample: true }));
assert.throws(() => decodeMimirFusedClassicData(Uint8Array.from(ensure, (b, i) => i === 93 ? 2 : b)));

const cSample = { compositeFeedId: new Uint8Array(32).fill(3), expectedConfigRevision: 1n, previousSnapshotRevision: 4n, nextSnapshotRevision: 4n,
  componentSourceConfigRevisions: [1n, 1n], maxRefreshFeeLamports: 0n, componentRingNewestSlots: [9n, 9n], converterRingNewestSlots: [7n] };
const cExact = encodeMimirFusedRefreshData(cSample); const cEnsure = encodeMimirFusedRefreshData({ ...cSample, ensureSample: true });
assert.deepEqual([cExact[63], cEnsure[63], cEnsure[58]], [0, 1, 1]);
assert.deepEqual(cEnsure.filter((_, i) => i !== 63), cExact.filter((_, i) => i !== 63));
assert.deepEqual(decodeMimirFusedRefreshData(cEnsure), { ...cSample, ensureSample: true });
assert.deepEqual(decodeMimirFusedRefreshData(cExact), cSample);
const cWindowed = encodeMimirFusedRefreshData({ ...cSample, nextSnapshotRevision: 5n, maxRefreshFeeLamports: 1n, maxReuseAgeSlots: 2 });
assert.equal(decodeMimirFusedRefreshData(cWindowed).maxReuseAgeSlots, 2);
assert.throws(() => encodeMimirFusedRefreshData({ ...cSample, nextSnapshotRevision: 5n, ensureSample: true }));
assert.throws(() => decodeMimirFusedRefreshData(Uint8Array.from(cEnsure, (b, i) => i === 63 ? 2 : b)));
assert.throws(() => decodeMimirFusedRefreshData(Uint8Array.from(cEnsure, (b, i) => i === 62 ? 1 : b)));

const policy = defaultTestSnapshotPolicy();
const plain = encodeVerifySnapshotData(policy); const minimum = encodeVerifySnapshotData({ ...policy, minimumRevision: true });
assert.deepEqual([minimum.length, minimum.at(-1), minimum.subarray(0, plain.length).equals(plain)], [plain.length + 1, 1, true]);
const header = decodeFeedSnapshotHeader(buildTestSnapshotHeader((d) => d.writeBigUInt64LE(3n, 96)));
verifySnapshotHeader(header, { ...policy, expectedSnapshotRevision: 2n, minimumRevision: true });
assert.throws(() => verifySnapshotHeader(header, { ...policy, expectedSnapshotRevision: 4n, minimumRevision: true }), /UnexpectedSnapshotRevision/);
assert.throws(() => verifySnapshotHeader(header, { ...policy, expectedSnapshotRevision: 2n }), /UnexpectedSnapshotRevision/);
const ret = new Uint8Array(24); const v = new DataView(ret.buffer); v.setBigUint64(0, 3n, true); v.setBigUint64(8, 100n, true);
assert.deepEqual(decodeVerifySnapshotReturnData(ret), { snapshotRevision: 3n, snapshotSlot: 100n, twapRevision: 0n });
assert.throws(() => decodeVerifySnapshotReturnData(new Uint8Array(23)));
console.log("minFreshConsumerAnchor ok");
