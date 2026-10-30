import type { Address } from "@solana/kit";
import bs58 from "bs58";
import { MIMIR_PRICE_STATE, MIMIR_V1_COND_MASK, MIMIR_V1_POWERS_MASK, predictMimirDegradedSnapshot,
  validateDegradedSnapshot } from "../liveness.js";
import { decodeFeedSnapshotHeader } from "../internal/nativeMonoRefreshCore.js";
import { decodeV1ClassicFeed, decodeV1CompositeFeed, V1_COMPOSITE_MAGIC, v1CompositePrefixLen } from "./decoders.js";
import * as C from "./layout/common.js";
import * as K from "./layout/classic.js";
import * as X from "./layout/composite.js";

/** A newly computed price, the predecessor's price kept byte for byte, or no price. */
export type MimirV1PublicationPrice = "published" | "carried" | "no-price";

interface PublicationFacts {
  readonly revision: bigint;
  /** Classic: Fresh `snapshot_slot` (116) or Degraded liveness publication slot (156); composite: CSP `snapshot_slot`. */
  readonly publicationSlot: bigint;
  /** A carried price keeps its predecessor's (possibly expired) clocks. */
  readonly validUntilSlot: bigint;
  readonly priceX64: bigint;
  readonly price: MimirV1PublicationPrice;
}

/** The V0 classic outcome shape plus the V1 publication facts. */
export type MimirV1ClassicPublicationOutcome = PublicationFacts & (
  | Readonly<{ status: "fresh" }>
  | Readonly<{ status: "degraded"; conditionFlags: number; priceState: "with-price" | "no-price"; conditionedSources: number;
      belowFloorSources: readonly number[] }>);

/** The V0 composite outcome shape (`rowsMask` bit i = component i, bit 7 = converter) plus the V1 publication facts. */
export type MimirV1CompositePublicationOutcome = PublicationFacts & (
  | Readonly<{ status: "fresh" }>
  | Readonly<{ status: "degraded"; conditionFlags: number; rowsMask: number; powersMask: number; priceState: "with-price" | "no-price";
      conditionedSources: number; belowFloorSources: readonly number[] }>);

/** The signed tag-89 publish and the planning/simulation slots a V1 Classic post-state must match. */
export interface MimirV1ClassicPublicationBinding {
  readonly feedId: Uint8Array;
  /** The V1 Classic feed account (prefix `@48`). */
  readonly feed: Address;
  readonly configRevision: bigint;
  readonly planHash: Uint8Array;
  /** The signed `previousSnapshotRevision`: a same-slot re-observation returns Ok without writing. */
  readonly minRevision: bigint;
  readonly floorSlot: bigint;
  readonly contextSlot: bigint;
}

/** The signed tag-87 request, its planning pre-state and the simulation context a V1 composite post-state must match. */
export interface MimirV1CompositePublicationBinding {
  readonly feedId: Uint8Array;
  /** The V1 composite account (CSP `@48`). */
  readonly composite: Address;
  readonly configRevision: bigint;
  /** The planning read of the composite account (or its prefix): the minimum revision, and what a carried price must equal. */
  readonly previous: Uint8Array;
  readonly contextSlot: bigint;
  readonly maxSnapshotAgeSlots: number;
  readonly maxComponentSnapshotAgeSlots: number;
}

const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const u16 = (d: Uint8Array, o: number) => view(d).getUint16(o, true);
const u64 = (d: Uint8Array, o: number) => view(d).getBigUint64(o, true);
const u128 = (d: Uint8Array, o: number) => u64(d, o) | (u64(d, o + 8) << 64n);
const zero = (d: Uint8Array, a: number, b: number) => d.subarray(a, b).every((x) => x === 0);
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const at = (d: Uint8Array, o: number, b: Uint8Array) => equal(d.subarray(o, o + b.length), b);
const fail = (kind: string, why: string): never => { throw new Error(`Invalid${kind}Publication: ${why}`); };

/**
 * A simulated tag-89 post-state of a V1 Classic feed (whole account or its 512-B prefix): Fresh, or the program's Degraded
 * snapshot, bound to the request; its publication clock lies in [floor, context] and a Fresh one is unexpired at the context.
 * A Degraded snapshot with a price always carries its predecessor's price.
 */
export function mimirV1ClassicPublicationOutcome(post: Uint8Array, belowFloorSources: readonly number[], b: MimirV1ClassicPublicationBinding): MimirV1ClassicPublicationOutcome {
  const need = (ok: boolean, why: string) => { if (!ok) fail("Classic", why); };
  need(post.length >= C.CLASSIC_PREFIX_LEN, "length");
  const p = post.subarray(0, C.CLASSIC_PREFIX_LEN);
  need(at(p, K.OFFSET_FEED_ID, b.feedId) && at(p, C.PREFIX_SELF_ADDRESS, bs58.decode(b.feed)) && u64(p, 88) === b.configRevision &&
    at(p, 262, b.planHash), "binding");
  const revision = u64(p, K.OFFSET_SNAPSHOT_REVISION);
  need(revision >= b.minRevision, "revision");
  const facts = (publicationSlot: bigint, price: MimirV1PublicationPrice) =>
    ({ revision, publicationSlot, validUntilSlot: u64(p, 124), priceX64: u128(p, 200), price });
  if (p[K.OFFSET_STATUS] === 0) {
    try { decodeFeedSnapshotHeader(p); } catch { need(false, "shape"); }
    const slot = u64(p, K.OFFSET_SNAPSHOT_SLOT);
    need(b.floorSlot <= slot && slot <= b.contextSlot && b.contextSlot <= u64(p, 124) && view(p).getBigInt64(132, true) > 0n, "fresh publication time");
    return { status: "fresh", ...facts(slot, "published") };
  }
  let degraded: ReturnType<typeof validateDegradedSnapshot> | null = null;
  try { degraded = validateDegradedSnapshot(p); } catch { need(false, "shape"); }
  const { publicationSlot, conditionFlags, priceState, conditionedSources } = degraded!.liveness;
  need(b.floorSlot <= publicationSlot && publicationSlot <= b.contextSlot, "degraded publication time");
  const withPrice = priceState === MIMIR_PRICE_STATE.WITH_PRICE;
  return { status: "degraded", conditionFlags, priceState: withPrice ? "with-price" : "no-price", conditionedSources, belowFloorSources,
    ...facts(publicationSlot, withPrice ? "carried" : "no-price") };
}

/** The program's CSP shape checks (`unpack_composite_snapshot_header`, never-priced form included); returns the prefix length. */
export function validateCompositePrefix(d: Uint8Array): number {
  const need = (ok: boolean, why: string) => { if (!ok) fail("Composite", why); };
  need(d.length >= X.CSP_COMPONENTS && at(d, 0, V1_COMPOSITE_MAGIC) && u16(d, X.CSP_VERSION) === X.CSP_VERSION_VALUE &&
    u16(d, X.CSP_HEADER_LEN) === X.CSP_HEADER_LEN_VALUE, "header");
  const n = d[X.CSP_COUNT]!, len = v1CompositePrefixLen(n);
  need(n >= X.COMPOSITE_MIN_COMPONENTS && n <= X.COMPOSITE_MAX_COMPONENTS && d.length >= len, "count");
  const degraded = d[X.CSP_STATUS] === 1, conditions = u16(d, X.CSP_CONDITIONS), priceState = d[X.CSP_PRICE_STATE]!;
  need(d[X.CSP_STATUS]! <= 1 && d[X.CSP_ROUTEABILITY] === (degraded ? 5 : 4) && d[X.CSP_RISK_TIER] === 0 && d[X.CSP_SNAPSHOT_SOURCE] === 4 &&
    d[X.CSP_ANCHOR_PROVIDER] === 0 && d[X.CSP_ANCHOR_STATUS] === 1 && d[X.CSP_FRESHNESS]! <= 5 && d[X.CSP_QUOTE_STATUS]! <= 2 &&
    !zero(d, X.CSP_FEED_ID, X.CSP_CONFIG) && !zero(d, X.CSP_CONFIG, X.CSP_REGISTRY_EPOCH) && u64(d, X.CSP_REGISTRY_EPOCH) > 0n &&
    u64(d, X.CSP_REVISION) > 0n && u64(d, X.CSP_CONFIG_REVISION) > 0n && u64(d, X.CSP_SNAPSHOT_SLOT) > 0n &&
    !zero(d, X.CSP_COMPONENT_SET_HASH, X.CSP_COMPONENT_SET_HASH + 32), "identity");
  if (degraded) {
    need(conditions !== 0 && (conditions & ~MIMIR_V1_COND_MASK) === 0 && (u16(d, X.CSP_POWERS) & ~MIMIR_V1_POWERS_MASK) === 0 &&
      d[X.CSP_CONDITIONED_ROWS] !== 0 && (priceState === 0 || priceState === 2) &&
      zero(d, X.CSP_MAX_RECOMMENDED_NOTIONAL, X.CSP_COMPONENT_SET_HASH), "liveness");
  } else need(zero(d, X.CSP_CONDITIONS, X.CSP_COMPONENTS), "fresh liveness");
  if (degraded && priceState === 2 && u128(d, X.CSP_PRICE_X64) === 0n) {
    need(zero(d, X.CSP_FLAGS, X.CSP_FEED_ID) && d[X.CSP_FRESHNESS] === 0 && d[X.CSP_QUOTE_STATUS] === 0 && d[X.CSP_RESERVED0] === 0 && zero(d, X.CSP_VALID_UNTIL_SLOT, X.CSP_UNIX_TS) &&
      zero(d, X.CSP_OLDEST_COMPONENT_SNAPSHOT_SLOT, X.CSP_PRICE_EXPONENT) && zero(d, X.CSP_CONFIDENCE_BPS, X.CSP_COMPONENT_SET_HASH) &&
      zero(d, X.CSP_COMPONENT_SNAPSHOT_HASH, X.CSP_ANCHOR_PROVIDER) && zero(d, X.CSP_COMPONENTS, len), "never-priced");
    return len;
  }
  const flags = view(d).getUint32(X.CSP_FLAGS, true), price = u128(d, X.CSP_PRICE_X64);
  need((flags === 0 || flags === 1) && (u64(d, X.CSP_VALID_UNTIL_SLOT) >= u64(d, X.CSP_SNAPSHOT_SLOT) || degraded) &&
    u64(d, X.CSP_OLDEST_COMPONENT_SNAPSHOT_SLOT) > 0n && u64(d, X.CSP_PRICE_MANTISSA) > 0n && u128(d, X.CSP_PRICE_LOWER_X64) > 0n &&
    u128(d, X.CSP_PRICE_LOWER_X64) <= price && price <= u128(d, X.CSP_PRICE_UPPER_X64) && u16(d, X.CSP_CONFIDENCE_BPS) <= 10_000 &&
    u16(d, X.CSP_DISPERSION_BPS) <= 10_000 && !zero(d, X.CSP_COMPONENT_SNAPSHOT_HASH, X.CSP_COMPONENT_SNAPSHOT_HASH + 32), "price");
  need(flags === 0 || (zero(d, X.CSP_MAX_RECOMMENDED_NOTIONAL, X.CSP_COMPONENT_SET_HASH) && u64(d, X.CSP_OLDEST_COMPONENT_ACTIVITY_SLOT) === 0n), "current point");
  need(u64(d, X.CSP_OLDEST_COMPONENT_ACTIVITY_SLOT) !== 0n || (d[X.CSP_FRESHNESS] === 0 && d[X.CSP_QUOTE_STATUS] === 0), "zero activity");
  for (let i = 0; i < n; i++) {
    const c = X.CSP_COMPONENTS + X.CSP_COMPONENT_LEN * i;
    need(!zero(d, c, c + 32) && u64(d, c + 32) > 0n && u64(d, c + 40) > 0n && u128(d, c + 48) > 0n && u128(d, c + 64) > 0n, `component ${i}`);
  }
  return len;
}

/** The price-carrying CSP bytes a carry keeps: valid_until, oldest clocks, price block and components. */
const carriedPrice = (d: Uint8Array, len: number) => [d.subarray(X.CSP_VALID_UNTIL_SLOT, X.CSP_UNIX_TS),
  d.subarray(X.CSP_OLDEST_COMPONENT_SNAPSHOT_SLOT, X.CSP_MAX_RECOMMENDED_NOTIONAL), d.subarray(X.CSP_COMPONENTS, len)];

/**
 * A simulated tag-87 post-state of a V1 composite (whole account or its `P = 320 + 80N` prefix): Fresh, or the program's
 * Degraded CSP (any V1 condition), bound to the request and at least the planning revision. A Fresh CSP must be current at
 * the context (publication age, expiry, component ages); a Degraded one may carry its predecessor's expired clocks.
 * `price` is `carried` when the price bytes equal the planning read's, `published` when the program recomputed them.
 */
export function mimirV1CompositePublicationOutcome(post: Uint8Array, belowFloorSources: readonly number[], b: MimirV1CompositePublicationBinding): MimirV1CompositePublicationOutcome {
  const need = (ok: boolean, why: string) => { if (!ok) fail("Composite", why); };
  const len = validateCompositePrefix(post), p = post.subarray(0, len);
  need(at(p, X.CSP_FEED_ID, b.feedId) && at(p, X.CSP_CONFIG, bs58.decode(b.composite)) && u64(p, X.CSP_CONFIG_REVISION) === b.configRevision, "binding");
  const revision = u64(p, X.CSP_REVISION), previous = b.previous.length >= X.CSP_COMPONENTS ? u64(b.previous, X.CSP_REVISION) : 0n;
  need(revision >= previous, "revision");
  const c = b.contextSlot, slot = u64(p, X.CSP_SNAPSHOT_SLOT);
  need(slot <= c, "publication time");
  const facts = (price: MimirV1PublicationPrice) =>
    ({ revision, publicationSlot: slot, validUntilSlot: u64(p, X.CSP_VALID_UNTIL_SLOT), priceX64: u128(p, X.CSP_PRICE_X64), price });
  if (p[X.CSP_STATUS] === 0) {
    need(c - slot <= BigInt(b.maxSnapshotAgeSlots) && c <= u64(p, X.CSP_VALID_UNTIL_SLOT), "publication age/expiry");
    for (const a of [u64(p, X.CSP_OLDEST_COMPONENT_SNAPSHOT_SLOT), u64(p, X.CSP_OLDEST_COMPONENT_ACTIVITY_SLOT)]) {
      need(a === 0n || (a <= c && c - a <= BigInt(b.maxComponentSnapshotAgeSlots)), "component age");
    }
    return { status: "fresh", ...facts("published") };
  }
  const conditionFlags = u16(p, X.CSP_CONDITIONS), powersMask = u16(p, X.CSP_POWERS), rowsMask = p[X.CSP_CONDITIONED_ROWS]!;
  const noPrice = p[X.CSP_PRICE_STATE] === 2;
  const carried = previous > 0n && carriedPrice(p, len).every((x, i) => equal(x, carriedPrice(b.previous, len)[i]!));
  return { status: "degraded", conditionFlags, rowsMask, powersMask, priceState: noPrice ? "no-price" : "with-price", conditionedSources: rowsMask,
    belowFloorSources, ...facts(noPrice ? "no-price" : carried ? "carried" : "published") };
}

/** The conditions a refresh stamps: ring/converter stamps and NOT_READY; Classic bit i = primary row i, composite bit 7 = converter. */
export interface MimirV1PublicationConditions {
  readonly conditionFlags: number;
  readonly powersMask: number;
  readonly conditionedSources: number;
}

export interface MimirV1PublicationInputs {
  readonly clock: Readonly<{ slot: bigint; unixTs: bigint }>;
  /** Null or zero flags: the refresh prices Fresh. */
  readonly conditions: MimirV1PublicationConditions | null;
}

export type MimirV1PublicationPrediction =
  /** Writes nothing: a publication already exists in this slot, or a composite carry would change nothing. */
  | Readonly<{ kind: "noop" }>
  /** A newly computed Fresh price; its bytes need the program's pricing kernel. */
  | Readonly<{ kind: "fresh" }>
  /** Composite only: a newly computed price published Degraded with these conditions. */
  | Readonly<{ kind: "degraded-recomputed"; conditions: MimirV1PublicationConditions }>
  /** The exact Degraded post prefix (Classic 512 B, composite P B); a Classic one also zeroes the proof. */
  | Readonly<{ kind: "degraded"; prefix: Uint8Array }>;

/**
 * What a tag-89 publish built from this V1 Classic pre-state writes: same-slot no-op, Fresh, or the program's exact Degraded
 * prefix (predecessor price carried in its original family, NO_PRICE from a blank or NO_PRICE predecessor, degraded-since kept).
 * A quorum feed (`min_sources < N`) predicts the quorum shortfall carry; `conditions` must then be its stamped rows. A
 * conditioned converter is folded in by the caller (its conditions, every primary row); a venue-unavailable row
 * (`MimirV1PreparedRefresh.unavailableRows`) is a stamped row with its `cond`; on a quorum feed whose primaries
 * price Fresh that publication takes the recipe family instead, which this does not predict.
 */
export function predictMimirV1ClassicPublication(pre: Uint8Array, i: MimirV1PublicationInputs): MimirV1PublicationPrediction {
  const feed = decodeV1ClassicFeed(pre), p = feed.prefix, n = feed.header.n, revision = u64(p, K.OFFSET_SNAPSHOT_REVISION);
  const slot = i.clock.slot;
  if (revision !== 0n && (p[K.OFFSET_STATUS] === 0 ? !!feed.proof && (feed.proof.flags & K.PROOF_FLAG_VALID) !== 0 && feed.proof.slot === slot
    : p[K.OFFSET_STATUS] === 1 && u64(p, 156) === slot)) return { kind: "noop" };
  if (!i.conditions?.conditionFlags) return { kind: "fresh" };
  const modes = feed.rows.map((r) => r.descriptor.mode);
  const family = modes.includes(C.MODE_CURRENT_POINT) || (feed.rows[0]!.descriptor.temporalKind === C.TEMPORAL_DUAL_NATIVE_POINT_V1 &&
    p[K.OFFSET_SNAPSHOT_SOURCE] === 7) ? 7 : modes.includes(C.MODE_SAMPLED_INTERVAL) ? 6 : 5;
  let base = p, snapshotSource: 5 | 6 | 7 = family;
  if (revision !== 0n && feed.definition.planImage[K.PLAN_OFFSET_MIN_SOURCES]! < n) {
    base = Uint8Array.from(p);
    if (base[K.OFFSET_SNAPSHOT_SOURCE] === 2) { base[K.OFFSET_SNAPSHOT_SOURCE] = 5; base[K.OFFSET_SOURCE_COUNT] = n; }
    snapshotSource = (base[K.OFFSET_SNAPSHOT_SOURCE] === 1 ? 5 : base[K.OFFSET_SNAPSHOT_SOURCE]) as 5 | 6 | 7;
  }
  return { kind: "degraded", prefix: predictMimirDegradedSnapshot(Uint8Array.from(base), { newRevision: revision + 1n, minSources: n, sourceCount: n, snapshotSource,
    clock: i.clock, conditionFlags: i.conditions.conditionFlags, powersMask: i.conditions.powersMask, conditionedSources: i.conditions.conditionedSources }) };
}

/** Why a composite publication keeps the predecessor price instead of recomputing it (any may combine). */
export interface MimirV1CompositeCarry {
  /**
   * A row or converter is NOT_READY (blank or immature ring, confidence/dispersion over the cap), a component row is venue-unavailable
   * (`MimirV1PreparedRefresh.unavailableRows`, NOT_READY or PAUSED), or a positive row price, conversion or composite contribution
   * rounds to 0 (SCALE_UNREPRESENTABLE).
   */
  readonly notReady?: boolean;
  /** A retained row price, or the converter, aged out: the carry keeps the price and its expired clocks. */
  readonly expired?: boolean;
  /** A point row keeps its retained depth: publication clocks advance, price kept. */
  readonly pointRetained?: boolean;
}

/**
 * What a tag-87 publish built from this V1 composite pre-state writes: same-slot no-op, Fresh, a recomputed price published
 * Degraded, or the program's exact Degraded carry (the predecessor CSP with its price state under any condition or expiry, the
 * never-priced image on a revision-0 composite, no-op when it would change nothing). A converter stamped with a
 * `MIMIR_NO_PRICE_CLASS` bit is a carry (`notReady`); any other defined converter condition keeps the computed conversion
 * (`degraded-recomputed`).
 */
export function predictMimirV1CompositePublication(pre: Uint8Array, i: MimirV1PublicationInputs & Readonly<{ carry?: MimirV1CompositeCarry }>): MimirV1PublicationPrediction {
  const feed = decodeV1CompositeFeed(pre), len = feed.prefixLen, revision = feed.snapshot.revision, slot = i.clock.slot;
  const dual = feed.rows.some((r) => r.descriptor.temporalKind === C.TEMPORAL_DUAL_NATIVE_POINT_V1);
  if (revision !== 0n && (dual ? !!feed.dualProof && (feed.dualProof.flags & K.PROOF_FLAG_VALID) !== 0 && feed.dualProof.slot === slot
    : feed.snapshot.snapshotSlot === slot)) return { kind: "noop" };
  const c = i.conditions?.conditionFlags ? i.conditions : null, carry = i.carry ?? {};
  if (!carry.notReady && !carry.expired && !carry.pointRetained) return c ? { kind: "degraded-recomputed", conditions: c } : { kind: "fresh" };
  if (!c) fail("Composite", "a carry needs its conditions");
  const out = Uint8Array.from(pre.subarray(0, len)), v = view(out);
  const degrade = () => {
    out[X.CSP_STATUS] = 1; out[X.CSP_ROUTEABILITY] = 5; out.fill(0, X.CSP_MAX_RECOMMENDED_NOTIONAL, X.CSP_COMPONENT_SET_HASH);
    v.setUint16(X.CSP_CONDITIONS, c!.conditionFlags, true); v.setUint16(X.CSP_POWERS, c!.powersMask, true); out[X.CSP_CONDITIONED_ROWS] = c!.conditionedSources;
  };
  const stamp = () => { v.setBigUint64(X.CSP_SNAPSHOT_SLOT, slot, true); v.setBigInt64(X.CSP_UNIX_TS, i.clock.unixTs, true); };
  if (revision === 0n) {
    const cfc = feed.config, self = out.slice(X.CSP_CONFIG, X.CSP_CONFIG + 32);
    out.fill(0);
    out.set(V1_COMPOSITE_MAGIC, 0); v.setUint16(X.CSP_HEADER_LEN, X.CSP_HEADER_LEN_VALUE, true);
    out.set(cfc.feedId, X.CSP_FEED_ID); out.set(self, X.CSP_CONFIG);
    v.setBigUint64(X.CSP_REGISTRY_EPOCH, cfc.registryEpoch, true); v.setBigUint64(X.CSP_CONFIG_REVISION, cfc.configRevision, true);
    v.setBigUint64(X.CSP_REVISION, 1n, true); out[X.CSP_SNAPSHOT_SOURCE] = 4; out[X.CSP_COUNT] = cfc.componentCount; stamp();
    v.setInt32(X.CSP_PRICE_EXPONENT, cfc.priceExponent, true); out.set(cfc.componentSetHash, X.CSP_COMPONENT_SET_HASH);
    out[X.CSP_ANCHOR_STATUS] = 1; out[X.CSP_PRICE_STATE] = MIMIR_PRICE_STATE.NO_PRICE;
    degrade();
  } else if (carry.pointRetained && !carry.notReady && !carry.expired && out[X.CSP_PRICE_STATE] === 0) {
    stamp(); v.setBigUint64(X.CSP_REVISION, revision + 1n, true); degrade();
  } else {
    degrade();
    if (equal(out, pre.subarray(0, len))) return { kind: "noop" };
    v.setBigUint64(X.CSP_REVISION, revision + 1n, true); stamp();
  }
  validateCompositePrefix(out);
  return { kind: "degraded", prefix: out };
}

/** The price's own clocks, which a carry keeps while the publication clock advances. */
export interface MimirV1PriceClocks {
  /** Classic `valid_until` @124; composite `valid_until` @120. */
  readonly validUntilSlot: bigint;
  /** Classic `snapshot_slot` @116; composite oldest component snapshot slot @136. */
  readonly priceSlot: bigint;
  /** Composite oldest component activity slot @144 (0 = current point); Classic 0. */
  readonly activitySlot: bigint;
  /** `context - priceSlot`, floored at 0. */
  readonly ageSlots: bigint;
  /** `context - validUntilSlot` when past expiry, else 0. */
  readonly expiredBySlots: bigint;
}

/**
 * The clocks of the price a V1 Classic (MIMIRSNP prefix) or composite (MIMIRCSP) publication holds, Fresh or carried; null when
 * it holds no price (Degraded NO_PRICE). Never the publication clock (Classic @156, composite @112).
 */
export function mimirV1PriceClocks(account: Uint8Array, contextSlot: bigint): MimirV1PriceClocks | null {
  const composite = at(account, 0, V1_COMPOSITE_MAGIC);
  if (account.length < (composite ? X.CSP_COMPONENTS : C.CLASSIC_PREFIX_LEN) ||
    !(composite || new TextDecoder().decode(account.subarray(0, 8)) === K.FEED_SNAPSHOT_MAGIC)) fail("Price", "account");
  const degraded = account[composite ? X.CSP_STATUS : K.OFFSET_STATUS] === 1;
  if (degraded && account[composite ? X.CSP_PRICE_STATE : K.OFFSET_LB_PRICE_STATE] === MIMIR_PRICE_STATE.NO_PRICE) return null;
  const validUntilSlot = u64(account, composite ? X.CSP_VALID_UNTIL_SLOT : 124);
  const priceSlot = u64(account, composite ? X.CSP_OLDEST_COMPONENT_SNAPSHOT_SLOT : K.OFFSET_SNAPSHOT_SLOT);
  const pos = (x: bigint) => (x > 0n ? x : 0n);
  return { validUntilSlot, priceSlot, activitySlot: composite ? u64(account, X.CSP_OLDEST_COMPONENT_ACTIVITY_SLOT) : 0n,
    ageSlots: pos(contextSlot - priceSlot), expiredBySlots: pos(contextSlot - validUntilSlot) };
}
