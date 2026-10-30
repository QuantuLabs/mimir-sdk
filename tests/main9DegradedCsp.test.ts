import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { decodeCompositePublication } from "../src/codec.js";
import { decodeFeedSnapshotHeader } from "../src/internal/nativeMonoRefreshCore.js";
import { mimirV1ClassicPublicationOutcome, mimirV1CompositePublicationOutcome } from "../src/v1/index.js";
import { validateDegradedSnapshot } from "../src/liveness.js";
import bs58 from "bs58";
import type { Address } from "@solana/kit";

// The indexer's 13 main9 Degraded shapes (wt-v1w3-idx-b4 display-stream-main9-compat): the SDK must read exactly what main9 state.rs reads.
const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/main9Degraded/${n}`, import.meta.url), "utf8"));
const launch = fx("launch11396fa4.json") as { programId: string; cases: Record<string, { data: string }> };
const vectors = fx("liveness-snapshot-vectors.json") as Array<{ name: string; hex: string }>;
const program = new PublicKey(launch.programId);
const csp = (name: string) => Buffer.from(launch.cases[name]!.data, "base64");
const snp = (name: string) => Buffer.from(vectors.find((v) => v.name === name)!.hex, "hex");
const carried = () => { const d = csp("composite-degraded-priced"); d.writeUInt16LE(0x0488, 314); d.writeBigUInt64LE(454_900_000n, 112); d.writeBigInt64LE(d.readBigInt64LE(128) + 240n, 128); return d; };
const neverPriced = () => {
  const source = csp("composite-no-price"), never = Buffer.alloc(source.length);
  for (const [from, to] of [[0, 12], [16, 120], [128, 136], [160, 164], [248, 280], [314, 320]] as const) source.copy(never, from, from, to);
  Object.assign(never, { 106: 0, 107: 4, 108: 0, 110: 0, 111: 0, 312: 0, 313: 1, 319: 2 });
  never.writeUInt16LE(0x0188, 314);
  return never;
};
const zeroUntil = carried(); zeroUntil.writeBigUInt64LE(0n, 120);
const rows = carried(); rows[318] = 0x40;
const expired = csp("composite-degraded-priced"); expired.writeUInt16LE(0x0120, 314); expired.writeBigUInt64LE(454_900_000n, 112);
const classicNoPriceClass = snp("snap_src5_carried_with_price"); classicNoPriceClass.writeUInt16LE(classicNoPriceClass.readUInt16LE(180) | 0x0488, 180);

const classic = [...["snap_src5_carried_with_price", "snap_src5_carried_no_price", "snap_src6_cold_not_ready", "no_price_class_with_price"].map(snp), classicNoPriceClass];
const composites = [csp("composite-degraded-priced"), csp("composite-no-price"), carried(), expired, neverPriced(), zeroUntil, rows];
for (const [i, d] of classic.entries()) assert.equal(decodeFeedSnapshotHeader(d).liveness?.conditionFlags, d.readUInt16LE(180), `classic ${i}`);
assert.equal(decodeFeedSnapshotHeader(csp("classic-degraded")).status, 1);
const v1 = (d: Buffer) => mimirV1CompositePublicationOutcome(d, [], { feedId: d.subarray(16, 48), composite: bs58.encode(d.subarray(48, 80)) as Address,
  configRevision: d.readBigUInt64LE(88), previous: new Uint8Array(0), contextSlot: d.readBigUInt64LE(112), maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150 });
for (const [i, d] of composites.entries()) {
  const h = decodeCompositePublication(d, program);
  assert.deepEqual([h.status, h.degraded?.conditionFlags, h.degraded?.rowsMask, h.validUntilSlot], [1, d.readUInt16LE(314), d[318], d.readBigUInt64LE(120)], `composite ${i}`);
  // The V1 CSP reader (any N) admits the same shapes.
  assert.equal(v1(d).status, "degraded", `v1 composite ${i}`);
}
assert.equal(decodeCompositePublication(neverPriced(), program).degraded?.noPrice, true);
// Still refused: zero rows, zero price with a price, undefined bit, capacity, wrong config PDA, a never-priced image with a stray clock.
const bad: [string, Buffer][] = [];
const m = (name: string, f: (d: Buffer) => void, base = carried) => { const d = base(); f(d); bad.push([name, d]); };
m("zero rows", (d) => { d[318] = 0; });
m("zero price", (d) => { d.fill(0, 168, 184); });
m("undefined bit", (d) => { d.writeUInt16LE(0x0040 | 0x0008, 314); });
m("zero conditions", (d) => { d.writeUInt16LE(0, 314); });
m("capacity", (d) => { d[216] = 1; });
m("price_state 1", (d) => { d[319] = 1; });
m("lower > price", (d) => { d.writeBigUInt64LE(d.readBigUInt64LE(168) + 1n, 184); d.writeBigUInt64LE(d.readBigUInt64LE(176), 192); });
m("wrong config", (d) => { d[48] ^= 1; });
m("never-priced valid_until", (d) => { d.writeBigUInt64LE(1n, 120); }, neverPriced);
m("never-priced component", (d) => { d[320] = 1; }, neverPriced);
m("never-priced rows 0", (d) => { d[318] = 0; }, neverPriced);
m("zero activity, freshness 1", (d) => { d.writeBigUInt64LE(0n, 144); d[108] = 1; });
for (const [name, d] of bad) {
  assert.throws(() => decodeCompositePublication(d, program), name);
  // The V1 reader binds the CSP to its own address, not the codec's config PDA.
  if (name !== "wrong config") assert.throws(() => v1(d), `v1 ${name}`);
}
// An undefined risk tier is refused before the degraded rules, as main9 unpack_feed_snapshot_header does.
const badRisk = snp("snap_src5_carried_with_price"); badRisk[106] = 255;
assert.throws(() => validateDegradedSnapshot(badRisk), /header enums/);
assert.throws(() => mimirV1ClassicPublicationOutcome(badRisk, [], { feedId: badRisk.subarray(16, 48), feed: bs58.encode(badRisk.subarray(48, 80)) as Address,
  configRevision: badRisk.readBigUInt64LE(88), planHash: badRisk.subarray(262, 294), minRevision: 0n, floorSlot: 0n, contextSlot: badRisk.readBigUInt64LE(156) }), /shape/);
console.log(`main9DegradedCsp: ${classic.length + 1} classic + ${composites.length} composite shapes, ${bad.length} refusals ok`);
