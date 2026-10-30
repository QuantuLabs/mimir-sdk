import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeFeedSnapshotHeader } from "../src/internal/nativeMonoRefreshCore.js";
import { readMimirRingStamp } from "../src/liveness.js";
import { classifyToken2022Mint } from "../src/token2022Clmm.js";

const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const cases = gunzipSync(readFileSync(new URL("./fixtures/decoderPartition.jsonl.gz", import.meta.url))).toString("utf8").split("\n")
  .map(line => JSON.parse(line) as { name: string; kind: string; hex: string; program: boolean });
const accepts = (fn: () => unknown) => { try { fn(); return true; } catch { return false; } };
const sdk = (c: (typeof cases)[number]) => {
  const d = Uint8Array.from(Buffer.from(c.hex, "hex"));
  if (c.kind === "snapshot") return accepts(() => decodeFeedSnapshotHeader(d));
  if (c.kind === "ring-stamp") return accepts(() => readMimirRingStamp(d));
  return accepts(() => classifyToken2022Mint({ account: { address: T22, owner: T22, data: d } as never, expectedMint: T22 as never, expectedDecimals: d[44]!, nowUnix: 0n }));
};
assert.equal(cases.length, 776);
const mismatches = cases.filter(c => sdk(c) !== c.program).map(c => c.name);
assert.deepEqual(mismatches, []);
console.log("decoder partition: 776 paired cases match the program");
