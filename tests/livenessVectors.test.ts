import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readMimirRingStamp, validateDegradedSnapshot, withoutMimirRingStamp, MIMIR_V1_COND_MASK, MIMIR_NO_PRICE_CLASS, MIMIR_V1_POWERS_MASK } from "../src/liveness.js";
import { decodeFeedSnapshotHeader, decodeMimirBrowserSourceRingV1 } from "../src/internal/nativeMonoRefreshCore.js";
import { decodeMimirCurrentPointSource7Snapshot } from "../src/internal/currentPointCore.js";
import { decodeMimirSampledSource6Snapshot } from "../src/internal/sampledTemporalCore.js";

type Vector = { kind: "ring" | "snapshot"; positive: boolean; len: number; note: string; sha256: string; hex: string };
const file = JSON.parse(readFileSync(new URL("./fixtures/liveness/VECTORS.json", import.meta.url), "utf8")) as {
  constants: Record<string, string>; vectors: Record<string, Vector>;
};
assert.equal(Number(file.constants.V1_COND_MASK), MIMIR_V1_COND_MASK);
assert.equal(Number(file.constants.NO_PRICE_CLASS), MIMIR_NO_PRICE_CLASS);
assert.equal(Number(file.constants.V1_POWERS_MASK), MIMIR_V1_POWERS_MASK);

const u16 = (d: Uint8Array, o: number) => d[o]! | (d[o + 1]! << 8);
const FRESH_SNAPSHOTS = new Set(["snap_src1_fresh", "snap_src5_fresh", "snap_src6_fresh", "snap_src7_fresh", "snap_src5_recovered_fresh"]);
let checks = 0;
for (const [name, v] of Object.entries(file.vectors)) {
  const data = Uint8Array.from(Buffer.from(v.hex, "hex"));
  assert.equal(data.length, v.len, name);
  assert.equal(createHash("sha256").update(data).digest("hex"), v.sha256, name);
  if (v.kind === "ring") {
    if (!v.positive) {
      assert.throws(() => readMimirRingStamp(data), /InvalidSourceRing/, name);
      assert.throws(() => decodeMimirBrowserSourceRingV1(data), /InvalidSourceRing/, name);
      checks += 1;
      continue;
    }
    const stamp = readMimirRingStamp(data);
    const rebuilt = withoutMimirRingStamp(data);
    rebuilt.set([stamp.cond & 0xff, stamp.cond >> 8, stamp.cond === 0 ? 0 : 1, 0], 108);
    rebuilt.set([stamp.mask & 0xff, stamp.mask >> 8], 382);
    assert.deepEqual(rebuilt, data, name);
    assert.deepEqual(decodeMimirBrowserSourceRingV1(data).stamp, stamp, name);
    checks += 1;
    continue;
  }
  if (!v.positive) {
    assert.throws(() => validateDegradedSnapshot(data), /InvalidDegradedSnapshot/, name);
    assert.throws(() => decodeFeedSnapshotHeader(data), name);
    checks += 1;
    continue;
  }
  if (name === "snap_sentinel_src1_feed") {
    assert.throws(() => decodeFeedSnapshotHeader(data), name);
  } else if (FRESH_SNAPSHOTS.has(name)) {
    const header = decodeFeedSnapshotHeader(data);
    assert.equal(header.status, 0, name);
    assert.equal(header.liveness, undefined, name);
    assert.ok(data.subarray(156, 188).every((x) => x === 0), name);
  } else {
    const degraded = validateDegradedSnapshot(data);
    const header = decodeFeedSnapshotHeader(data);
    assert.deepEqual(header.liveness, degraded.liveness, name);
    assert.deepEqual(header.lastUsable, degraded.lastUsable, name);
    assert.equal(degraded.liveness.conditionFlags, u16(data, 180), name);
    assert.equal(degraded.form, data.subarray(116, 124).every((x) => x === 0) ? "cold" : "carried", name);
    const specialized = data[107] === 7 ? decodeMimirCurrentPointSource7Snapshot(data) : data[107] === 6 ? decodeMimirSampledSource6Snapshot(data) : undefined;
    if (specialized) assert.deepEqual(specialized, { status: "degraded", ...degraded }, name);
    assert.equal(header.oldestSourceActivitySlot | header.twapShortEndSlot | header.twapMediumEndSlot | header.twapLongEndSlot, 0n, name);
    const frontier = data.slice();
    frontier[184] = 0x81;
    assert.throws(() => validateDegradedSnapshot(frontier), /InvalidDegradedSnapshot/, name);
    assert.throws(() => decodeFeedSnapshotHeader(frontier), name);
  }
  checks += 1;
}
assert.equal(checks, 59);
console.log(`liveness vectors: ${checks}/59 ok`);
