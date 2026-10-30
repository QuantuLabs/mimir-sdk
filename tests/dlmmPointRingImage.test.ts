import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeMimirClassicExecution } from "../src/beta/classicExecution.js";
import { assertMimirSealedRow, mimirSealedFeedPlan } from "../src/beta/compositeExecution.js";
import { decodeMimirBrowserSourceRingV1 } from "../src/internal/nativeMonoRefreshCore.js";

// Fresh DLMM compact-point classic execution produced by ELF 11396fa4 (adapter 3, SourceConfig flags 1, ring flags 1).
const fixture = JSON.parse(readFileSync(new URL("./fixtures/dlmmPointClassicExecution.11396fa4.json", import.meta.url), "utf8"));
const data = Uint8Array.from(Buffer.from(fixture.data, "base64"));
const row = 1_573, ringAt = row + 400;
const ringOf = (bytes: Uint8Array) => bytes.slice(ringAt, ringAt + 544);
assert.deepEqual([data[row + 12], new DataView(data.buffer).getUint32(ringAt + 12, true)], [3, 1]);

const exec = decodeMimirClassicExecution(data);
assert.equal(exec.active, true);
assert.equal(exec.primary[0]!.descriptor.adapterType, 3);
assert.equal(decodeMimirBrowserSourceRingV1(ringOf(data)).pointOnly, true);

// Same program ring image as a composite component row.
assertMimirSealedRow({ what: "InvalidCompositeExecution", data, descriptor: exec.primary[0]!.descriptor, membership: exec.primary[0]!.membership,
  converterRow: false, sourceImage: exec.primary[0]!.sourceConfigImage,
  feedPlan: mimirSealedFeedPlan("InvalidCompositeExecution", exec.feedConfigImage, exec.planImage), ringOffset: ringAt });

// Negatives: other adapters with the point flag, and a non-canonical DLMM point ring.
for (const adapter of [0, 1, 2, 5, 7]) {
  const ring = ringOf(data); ring[52] = adapter;
  assert.throws(() => decodeMimirBrowserSourceRingV1(ring), /InvalidSourceRing|InvalidEnum/, `adapter ${adapter}`);
}
for (const [at, value] of [[54, 2], [12, 2]] as const) {
  const bad = Uint8Array.from(data); bad[ringAt + at] = value;
  assert.throws(() => decodeMimirClassicExecution(bad), /InvalidClassicExecution: ring image/);
}
console.log("dlmmPointRingImage ok");
