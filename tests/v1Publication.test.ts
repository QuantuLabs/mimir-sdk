import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import type { Address } from "@solana/kit";
import { mimirV1ClassicPublicationOutcome, mimirV1CompositePublicationOutcome, predictMimirV1ClassicPublication, predictMimirV1CompositePublication,
  type MimirV1CompositeCarry, type MimirV1PublicationPrice } from "../src/v1/index.js";

// Real LiteSVM pre/post pairs of the d89aa1b ELF, one appended tag89/tag87 per state.
type State = { advance: number | null; clock: { slot: number; unixTs: number }; account: string };
const load = (cell: string) => JSON.parse(readFileSync(new URL(`./fixtures/v1Publication/${cell}.json`, import.meta.url), "utf8")) as { states: State[] };
const bytes = (s: State) => new Uint8Array(Buffer.from(s.account, "base64"));
const clock = (s: State) => ({ slot: BigInt(s.clock.slot), unixTs: BigInt(s.clock.unixTs) });
const u64 = (d: Uint8Array, o: number) => Buffer.from(d.subarray(o, o + 8)).readBigUInt64LE();
const NR = 0x100;

// [cell, pre index, conditions (null = Fresh), predicted kind, outcome status, outcome price]
type Classic = [string, number, [number, number, number] | null, "fresh" | "noop" | "degraded", "fresh" | "degraded", MimirV1PublicationPrice];
const classic: Classic[] = [
  ["sol_usdc_clmm", 0, null, "fresh", "fresh", "published"],
  ["sol_usdc_clmm", 1, null, "noop", "fresh", "published"],
  ["sol_usdc_clmm", 2, null, "fresh", "fresh", "published"],
  ["flip_clmm_twap_dev100", 0, [NR, 0, 1], "degraded", "degraded", "carried"],
  ["flip_clmm_twap_dev100", 1, [NR, 0, 1], "degraded", "degraded", "carried"],
  ["flip_clmm_twap_dev100", 2, [NR, 0, 1], "noop", "degraded", "carried"],
  ["flip_sol_quoted_converter_dev100", 0, [NR, 0, 1], "degraded", "degraded", "carried"],
  ["flip_sol_quoted_converter_dev100", 1, [NR, 0, 1], "degraded", "degraded", "carried"],
  ["cpmm_nb_heeboo_quiet", 0, null, "fresh", "fresh", "published"],
  ["cpmm_nb_heeboo_quiet", 1, [NR, 0, 1], "degraded", "degraded", "carried"],
  ["v1_h21_clmm_cold", 0, [NR, 0, 1], "degraded", "degraded", "no-price"],
  ["v1_h21_clmm_cold", 1, [NR, 0, 1], "degraded", "degraded", "no-price"],
  ["v1_h21_clmm_cold", 2, [NR, 0, 1], "noop", "degraded", "no-price"],
  ["dlmm_cp_sol_usdc_s20", 0, [0x20, 0, 1], "degraded", "degraded", "carried"],
  ["dlmm_cp_sol_usdc_s20", 1, [0x20, 0, 1], "degraded", "degraded", "carried"],
  ["dlmm_cp_sol_usdc_s20_v1_cold", 0, [0x20, 0, 1], "degraded", "degraded", "no-price"],
  ["dlmm_cp_sol_usdc_s20_v1_cold", 1, [0x20, 0, 1], "degraded", "degraded", "no-price"],
  ["v1_fpr01_quorum_cold", 0, [NR, 0, 1], "degraded", "degraded", "no-price"],
  ["v1_fpr01_quorum_cold", 1, [NR, 0, 1], "degraded", "degraded", "no-price"],
  ["v1_fpr01_quorum_carry", 0, null, "fresh", "fresh", "published"],
  ["v1_fpr01_quorum_carry", 1, [NR, 0, 1], "degraded", "degraded", "carried"],
  ["v1_fpr01_quorum_carry", 2, [NR, 0, 1], "degraded", "degraded", "carried"],
];
for (const [cell, k, c, kind, status, price] of classic) {
  const name = `${cell} ${k}->${k + 1}`, { states } = load(cell), pre = bytes(states[k]!), post = bytes(states[k + 1]!);
  const conditions = c && { conditionFlags: c[0], powersMask: c[1], conditionedSources: c[2] };
  const p = predictMimirV1ClassicPublication(pre, { clock: clock(states[k + 1]!), conditions });
  assert.equal(p.kind, kind, name);
  if (p.kind === "degraded") assert.equal(Buffer.from(p.prefix).toString("hex"), Buffer.from(post.subarray(0, 512)).toString("hex"), `${name} prefix`);
  if (p.kind === "noop") assert.deepEqual(post, pre, `${name} wrote`);
  const b = { feedId: pre.subarray(16, 48), feed: bs58.encode(pre.subarray(48, 80)) as Address, configRevision: u64(pre, 88),
    planHash: post.subarray(262, 294), minRevision: u64(pre, 96), floorSlot: BigInt(states[k]!.clock.slot), contextSlot: BigInt(states[k + 1]!.clock.slot) };
  const o = mimirV1ClassicPublicationOutcome(post, [], b);
  assert.deepEqual([o.status, o.price, o.revision], [status, price, u64(post, 96)], `${name} outcome`);
  if (o.status === "degraded") assert.deepEqual([o.conditionFlags, o.conditionedSources], [c![0], c![2]], `${name} conditions`);
  assert.throws(() => mimirV1ClassicPublicationOutcome(post, [], { ...b, minRevision: u64(post, 96) + 1n }), /revision/, `${name} unadvanced`);
  assert.throws(() => mimirV1ClassicPublicationOutcome(post, [], { ...b, feed: bs58.encode(new Uint8Array(32).fill(1)) as Address }), /binding/, name);
}

type Composite = [string, number, [number, number, number] | null, MimirV1CompositeCarry | undefined,
  "fresh" | "noop" | "degraded" | "degraded-recomputed", "fresh" | "degraded", MimirV1PublicationPrice];
const composite: Composite[] = [
  ["v1_composite_n2_f2", 0, null, undefined, "fresh", "fresh", "published"],
  ["v1_composite_n2_f2", 1, null, undefined, "fresh", "fresh", "published"],
  ["v1_composite_n2_f2", 2, null, undefined, "noop", "fresh", "published"],
  ["v1_composite_n2_f2", 3, null, undefined, "fresh", "fresh", "published"],
  ["comp9_cldl_flip_twap", 0, [NR, 0, 2], { notReady: true }, "degraded", "degraded", "carried"],
  ["comp9_cldl_flip_twap", 1, [NR, 0, 2], { notReady: true }, "noop", "degraded", "carried"],
  ["comp9_cldl_flip_twap", 2, [NR, 0, 2], { notReady: true }, "noop", "degraded", "carried"],
  ["v1_composite_n2s1_f2", 0, null, undefined, "fresh", "fresh", "published"],
  ["comp9_sq2_flip_conv", 0, [NR, 0, 0x80], undefined, "degraded-recomputed", "degraded", "published"],
  ["comp9_sq2_flip_conv", 1, [NR, 0, 0x80], undefined, "degraded-recomputed", "degraded", "published"],
  ["v1_fixl_amcp2", 0, [0x120, 0, 2], { notReady: true }, "degraded", "degraded", "no-price"],
  ["v1_fixl_amcp2", 1, [0x120, 0, 2], { notReady: true }, "noop", "degraded", "no-price"],
];
for (const [cell, k, c, carry, kind, status, price] of composite) {
  const name = `${cell} ${k}->${k + 1}`, { states } = load(cell), pre = bytes(states[k]!), post = bytes(states[k + 1]!);
  const n = post[109]!, len = 320 + 80 * n;
  const conditions = c && { conditionFlags: c[0], powersMask: c[1], conditionedSources: c[2] };
  const p = predictMimirV1CompositePublication(pre, { clock: clock(states[k + 1]!), conditions, carry });
  assert.equal(p.kind, kind, name);
  if (p.kind === "degraded") assert.equal(Buffer.from(p.prefix).toString("hex"), Buffer.from(post.subarray(0, len)).toString("hex"), `${name} prefix`);
  if (p.kind === "noop") assert.deepEqual(post.subarray(0, len), pre.subarray(0, len), `${name} wrote`);
  const b = { feedId: post.subarray(16, 48), composite: bs58.encode(post.subarray(48, 80)) as Address, configRevision: u64(post, 88), previous: pre,
    contextSlot: BigInt(states[k + 1]!.clock.slot), maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150 };
  const o = mimirV1CompositePublicationOutcome(post, [], b);
  assert.deepEqual([o.status, o.price, o.revision], [status, price, u64(post, 96)], `${name} outcome`);
  if (o.status === "degraded") assert.deepEqual([o.conditionFlags, o.rowsMask, o.conditionedSources], [c![0], c![2], c![2]], `${name} conditions`);
  assert.throws(() => mimirV1CompositePublicationOutcome(post, [], { ...b, configRevision: b.configRevision + 1n }), /binding/, name);
  for (const [o, v] of [[104, 2], [105, 3], [319, 1], [109, 6], [108, 255], [110, 255]] as const) {
    const bad = Uint8Array.from(post); bad[o] = v;
    assert.throws(() => mimirV1CompositePublicationOutcome(bad, [], b), /InvalidCompositePublication/, `${name} @${o}=${v}`);
  }
  const noEpoch = Uint8Array.from(post).fill(0, 80, 88);
  assert.throws(() => mimirV1CompositePublicationOutcome(noEpoch, [], b), /InvalidCompositePublication/, `${name} registry_epoch 0`);
}
// A Buffer, or a Buffer view at an offset, predicts the same prefix and is left unchanged.
{
  const { states } = load("flip_clmm_twap_dev100"), pre = bytes(states[0]!);
  const i = { clock: clock(states[1]!), conditions: { conditionFlags: NR, powersMask: 0, conditionedSources: 1 } };
  const want = predictMimirV1ClassicPublication(pre, i), backing = Buffer.alloc(pre.length + 16);
  backing.set(pre, 16);
  for (const input of [Uint8Array.from(pre), Buffer.from(pre), backing.subarray(16)]) {
    assert.deepEqual(predictMimirV1ClassicPublication(input, i), want);
    assert.deepEqual(Uint8Array.from(input), pre);
  }
}
// A Fresh CSP past its expiry or age at the context is refused.
{
  const { states } = load("v1_composite_n2_f2"), post = bytes(states[2]!);
  const b = { feedId: post.subarray(16, 48), composite: bs58.encode(post.subarray(48, 80)) as Address, configRevision: u64(post, 88),
    previous: bytes(states[1]!), maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150 };
  assert.throws(() => mimirV1CompositePublicationOutcome(post, [], { ...b, contextSlot: u64(post, 120) + 1n }), /age\/expiry/);
  assert.throws(() => mimirV1CompositePublicationOutcome(post, [], { ...b, contextSlot: u64(post, 112) - 1n }), /publication time/);
}
console.log(`v1Publication: ${classic.length} classic + ${composite.length} composite d89aa1b transitions ok`);
