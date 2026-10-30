import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import type { Address } from "@solana/kit";
import { validateDegradedSnapshot, MIMIR_NO_PRICE_CLASS } from "../src/liveness.js";
import { mimirV1ClassicPublicationOutcome, mimirV1CompositePublicationOutcome, mimirV1PriceClocks, predictMimirV1ClassicPublication,
  predictMimirV1CompositePublication } from "../src/v1/index.js";

// main9 carry rule over the real d89aa1b LiteSVM pairs: the program's NOT_READY post with only the condition word changed is
// what a data-quality carry writes (price kept; NO_PRICE only for never-priced images).
type State = { clock: { slot: number; unixTs: number }; account: string };
const states = (cell: string) => (JSON.parse(readFileSync(new URL(`./fixtures/v1Publication/${cell}.json`, import.meta.url), "utf8")) as { states: State[] }).states;
const bytes = (s: State) => new Uint8Array(Buffer.from(s.account, "base64"));
const clock = (s: State) => ({ slot: BigInt(s.clock.slot), unixTs: BigInt(s.clock.unixTs) });
const u64 = (d: Uint8Array, o: number) => Buffer.from(d.subarray(o, o + 8)).readBigUInt64LE();
const withCond = (d: Uint8Array, o: number, cond: number) => { const x = Uint8Array.from(d); x[o] = cond & 0xff; x[o + 1] = cond >> 8; return x; };
const hex = (d: Uint8Array) => Buffer.from(d).toString("hex");
const SHORTFALL = 0x8, CP = 0x80, SCALE = 0x400, NR = 0x100, DEPTH = 0x20, FROZEN = 0x2, UNDEFINED = 0x40;

const classic = (cell: string, k: number, cond: number, rows = 1) => {
  const s = states(cell), pre = bytes(s[k]!), post = bytes(s[k + 1]!);
  const p = predictMimirV1ClassicPublication(pre, { clock: clock(s[k + 1]!), conditions: { conditionFlags: cond, powersMask: 0, conditionedSources: rows } });
  assert.equal(p.kind, "degraded", cell);
  const prefix = (p as { prefix: Uint8Array }).prefix;
  assert.equal(hex(prefix), hex(withCond(post.subarray(0, 512), 180, cond)), `${cell} 0x${cond.toString(16)}`);
  const o = mimirV1ClassicPublicationOutcome(prefix, [], { feedId: pre.subarray(16, 48), feed: bs58.encode(pre.subarray(48, 80)) as Address,
    configRevision: u64(pre, 88), planHash: prefix.subarray(262, 294), minRevision: u64(pre, 96), floorSlot: 0n, contextSlot: BigInt(s[k + 1]!.clock.slot) });
  return { prefix, o };
};
// Classic: every NO_PRICE_CLASS constituent over a Fresh and a Degraded priced predecessor, and over a SOL converter.
for (const cond of [SHORTFALL, CP, SCALE, MIMIR_NO_PRICE_CLASS | 1]) {
  for (const [cell, k] of [["flip_clmm_twap_dev100", 0], ["flip_clmm_twap_dev100", 1], ["flip_sol_quoted_converter_dev100", 0]] as const) {
    const { prefix, o } = classic(cell, k, cond);
    assert.equal(prefix[185], 1, `${cell} WITH_PRICE`);
    assert.deepEqual([o.status, o.price, o.status === "degraded" && o.priceState], ["degraded", "carried", "with-price"]);
    assert.equal(validateDegradedSnapshot(prefix).lastUsable?.priceX64, o.priceX64);
    assert.equal(mimirV1PriceClocks(prefix, 0n)?.priceSlot, u64(bytes(states(cell)[0]!), 116), "price clock is the original snapshot slot");
  }
  // Never priced: NO_PRICE with the same conditions.
  const { prefix, o } = classic("v1_h21_clmm_cold", 0, cond);
  assert.deepEqual([prefix[185], o.price, mimirV1PriceClocks(prefix, 0n)], [2, "no-price", null]);
}
// Classic converter NOT_READY stays a price-kept carry.
assert.equal(classic("flip_sol_quoted_converter_dev100", 0, NR).o.price, "carried");
// Undefined condition bits stay refused.
{
  const s = states("flip_clmm_twap_dev100");
  assert.throws(() => predictMimirV1ClassicPublication(bytes(s[0]!), { clock: clock(s[1]!), conditions: { conditionFlags: UNDEFINED, powersMask: 0, conditionedSources: 1 } }),
    /InvalidDegradedSnapshot/);
  assert.throws(() => validateDegradedSnapshot(withCond(bytes(s[1]!).subarray(0, 512), 180, NR | UNDEFINED)), /InvalidDegradedSnapshot/);
}

// Composite.
const binding = (pre: Uint8Array, post: Uint8Array, contextSlot: bigint) => ({ feedId: post.subarray(16, 48), composite: bs58.encode(post.subarray(48, 80)) as Address,
  configRevision: u64(post, 88), previous: pre, contextSlot, maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150 });
const composite = (cell: string, k: number, cond: number, rows: number) => {
  const s = states(cell), pre = bytes(s[k]!), post = bytes(s[k + 1]!), len = 320 + 80 * post[109]!;
  const p = predictMimirV1CompositePublication(pre, { clock: clock(s[k + 1]!), conditions: { conditionFlags: cond, powersMask: 0, conditionedSources: rows }, carry: { notReady: true } });
  assert.equal(p.kind, "degraded", cell);
  const prefix = (p as { prefix: Uint8Array }).prefix;
  assert.equal(hex(prefix), hex(withCond(post.subarray(0, len), 314, cond)), `${cell} 0x${cond.toString(16)}`);
  return { prefix, o: mimirV1CompositePublicationOutcome(prefix, [], binding(pre, post, BigInt(s[k + 1]!.clock.slot))) };
};
for (const cond of [SHORTFALL, CP, SCALE, MIMIR_NO_PRICE_CLASS | NR]) {
  const { prefix, o } = composite("comp9_cldl_flip_twap", 0, cond, 2);
  assert.deepEqual([prefix[319], o.status, o.price, o.status === "degraded" && o.priceState], [0, "degraded", "carried", "with-price"]);
  const never = composite("v1_fixl_amcp2", 0, cond, 2);
  assert.deepEqual([never.prefix[319], never.o.price, mimirV1PriceClocks(never.prefix, 0n)], [2, "no-price", null]);
}
// After a component window expiry: the price and its clocks are kept, only the publication clock (@112) advances.
{
  const s = states("comp9_cldl_flip_twap"), pre = bytes(s[1]!), validUntil = u64(pre, 120), slot = validUntil + 10n;
  const p = predictMimirV1CompositePublication(pre, { clock: { slot, unixTs: BigInt(s[1]!.clock.unixTs) + 4n },
    conditions: { conditionFlags: DEPTH, powersMask: 0, conditionedSources: 1 }, carry: { expired: true } });
  assert.equal(p.kind, "degraded");
  const post = (p as { prefix: Uint8Array }).prefix;
  assert.deepEqual([post[319], u64(post, 112), u64(post, 120), u64(post, 136), u64(post, 144)], [0, slot, validUntil, u64(pre, 136), u64(pre, 144)]);
  const o = mimirV1CompositePublicationOutcome(post, [0], binding(pre, post, slot));
  assert.deepEqual([o.price, o.status === "degraded" && o.priceState, o.validUntilSlot], ["carried", "with-price", validUntil]);
  const t = mimirV1PriceClocks(post, slot)!;
  assert.deepEqual([t.validUntilSlot, t.priceSlot, t.expiredBySlots, t.ageSlots], [validUntil, u64(pre, 136), 10n, slot - u64(pre, 136)]);
  // An undefined bit on the same CSP is refused.
  assert.throws(() => mimirV1CompositePublicationOutcome(withCond(post, 314, DEPTH | UNDEFINED), [], binding(pre, post, slot)), /InvalidCompositePublication/);
}
// A converter with a non-NO_PRICE_CLASS defined condition keeps the computed conversion: a recomputed Degraded publication.
{
  const s = states("comp9_sq2_flip_conv");
  const p = predictMimirV1CompositePublication(bytes(s[0]!), { clock: clock(s[1]!), conditions: { conditionFlags: FROZEN, powersMask: 0, conditionedSources: 0x80 } });
  assert.equal(p.kind, "degraded-recomputed");
}
console.log("v1Main9Publication: ok");
