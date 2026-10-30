import { sha256 } from "@noble/hashes/sha256";

export const MIMIR_COND = Object.freeze({
  PAUSED: 1 << 0,
  VAULT_FROZEN: 1 << 1,
  HOOK_ACTIVE: 1 << 2,
  VAULT_SHORTFALL: 1 << 3,
  DEPTH_BELOW_FLOOR: 1 << 5,
  CP_RATIO_UNDEFINED: 1 << 7,
  NOT_READY: 1 << 8,
  TOKEN_PROFILE: 1 << 9,
  SCALE_UNREPRESENTABLE: 1 << 10,
} as const);
export const MIMIR_POWER = Object.freeze({
  MINT_AUTHORITY: 1 << 0,
  FREEZE_AUTHORITY: 1 << 1,
  PERMANENT_DELEGATE: 1 << 2,
  PAUSABLE: 1 << 3,
  HOOK_AUTHORITY: 1 << 4,
  DEFAULT_FROZEN: 1 << 7,
  SCALED_UI: 1 << 8,
  CONFIDENTIAL_MINT: 1 << 9,
} as const);
export const MIMIR_V1_COND_MASK = 0x07af;
/**
 * VAULT_SHORTFALL | CP_RATIO_UNDEFINED | SCALE_UNREPRESENTABLE: current source conditions that prevent a new price. A carry over a
 * priced predecessor keeps that price (Degraded, WITH_PRICE, these bits visible); only a never-priced image publishes NO_PRICE.
 */
export const MIMIR_NO_PRICE_CLASS = 0x0488;
export const MIMIR_V1_POWERS_MASK = 0x039f;
export const MIMIR_PRICE_STATE = Object.freeze({ WITH_PRICE: 1, NO_PRICE: 2 } as const);

export interface MimirRingStamp { readonly cond: number; readonly mask: number }

export interface MimirSnapshotLiveness {
  readonly publicationSlot: bigint;
  readonly publicationUnix: bigint;
  readonly degradedSinceSlot: bigint;
  readonly conditionFlags: number;
  readonly powersMask: number;
  readonly priceState: 1 | 2;
  readonly conditionedSources: number;
  readonly sourceCount: number;
}

export interface MimirLastUsable {
  readonly slot: bigint;
  readonly unix: bigint;
  readonly observed: bigint;
  readonly priceX64: bigint;
  readonly lowerX64: bigint;
  readonly upperX64: bigint;
}

export interface MimirDegradedSnapshot {
  readonly form: "cold" | "carried";
  readonly liveness: MimirSnapshotLiveness;
  readonly lastUsable: MimirLastUsable | null;
}

const enc = (s: string) => new TextEncoder().encode(s);
const CAP_MODEL_HASH_V2 = enc("MIMIR_CAP_MODEL_V2_FINAL_2026062");
const POINT_MODEL_HASH = sha256(enc("MIMIR_CURRENT_POINT_UNCERTIFIED_V1"));
const SAMPLED_MODEL_HASH = sha256(enc("MIMIR_SAMPLED_INTERVAL_UNCERTIFIED_V1"));

const le = (d: Uint8Array, o: number, n: number): bigint => {
  let v = 0n;
  for (let i = n - 1; i >= 0; i -= 1) v = (v << 8n) | BigInt(d[o + i]!);
  return v;
};
const u16 = (d: Uint8Array, o: number) => d[o]! | (d[o + 1]! << 8);
const i64 = (d: Uint8Array, o: number) => BigInt.asIntN(64, le(d, o, 8));
const zero = (d: Uint8Array, a: number, b: number) => d.subarray(a, b).every((x) => x === 0);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export function readMimirRingStamp(data: Uint8Array): MimirRingStamp {
  if (data.length !== 544) throw new Error("InvalidSourceRing");
  const cond = u16(data, 108), mask = u16(data, 382), reserved = data[111]!;
  const notReadyForm = [1, 2, 3].includes(data[52]!) && le(data, 12, 4) === 0n;
  const valid = data[110] === 0 ? cond === 0 && reserved === 0 && mask === 0
    : data[110] === 1 && cond !== 0 && (cond & ~MIMIR_V1_COND_MASK) === 0 && reserved === 0 &&
      (mask & ~MIMIR_V1_POWERS_MASK) === 0 && ((cond & MIMIR_COND.NOT_READY) === 0 || notReadyForm);
  if (!valid) throw new Error("InvalidSourceRing");
  return { cond, mask };
}

export function withoutMimirRingStamp(data: Uint8Array): Uint8Array {
  const out = data.slice();
  out.fill(0, 108, 112);
  out.fill(0, 382, 384);
  return out;
}

function need(ok: boolean, why: string): asserts ok {
  if (!ok) throw new Error(`InvalidDegradedSnapshot: ${why}`);
}

function carriedRules(s: Uint8Array): bigint | null {
  const lo = le(s, 216, 16), p = le(s, 200, 16), hi = le(s, 232, 16);
  need(0n < lo && lo <= p && p <= hi, "interval");
  if (s[107] === 6 || s[107] === 7) {
    const point = s[107] === 7;
    need(zero(s, 12, 16) && s[106] === 0 && zero(s, 110, 116), "source header");
    need(le(s, 140, 8) === le(s, 148, 8), "spot==observed");
    need(u16(s, 255) === 10_000 && s[257] === 0, "coverage/quote");
    need(s[334] === 0 && s[335] === 1 && zero(s, 336, 356), "anchor");
    need(u16(s, 420) === (point ? 2 : 0) && zero(s, 422, 429), "cap version");
    need(s[429]! > 0 && s[429]! <= 5 && s[429]! <= s[252]!, "effective count");
    need(zero(s, 430, 456), "cap zero");
    need(same(s.subarray(472, 504), point ? POINT_MODEL_HASH : SAMPLED_MODEL_HASH) && zero(s, 504, 512), "model");
    return le(s, 456, 16);
  }
  need(u16(s, 420) === 2 && u16(s, 424) === 50 && u16(s, 426) >= 5000, "cap v2");
  need(s[428]! > 0 && s[428]! <= s[429]! && s[429]! <= 5 && [6, 8, 10].includes(u16(s, 430)) && le(s, 432, 8) !== 0n, "cap set");
  need(same(s.subarray(472, 504), CAP_MODEL_HASH_V2), "cap hash");
  return null;
}

export function validateDegradedSnapshot(input: Uint8Array): MimirDegradedSnapshot {
  const s = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  need(s.length === 512 && same(s.subarray(0, 8), enc("MIMIRSNP")) && u16(s, 8) === 0 && u16(s, 10) === 512, "header");
  need(s[104] === 1 && s[105] === 5 && [5, 6, 7].includes(s[107]!), "status/route/source");
  need(s[106]! <= 3 && s[108]! <= 5 && s[109]! <= 4 && s[257]! <= 2 && s[334]! <= 4 && s[335]! <= 5, "header enums");
  const publicationSlot = le(s, 156, 8), publicationUnix = i64(s, 164), degradedSinceSlot = le(s, 172, 8);
  const conditionFlags = u16(s, 180), powersMask = u16(s, 182), priceState = s[185]!, conditionedSources = s[186]!;
  need(s[184] === 1 && s[187] === 0, "liveness version/reserved");
  need(conditionFlags !== 0 && (conditionFlags & ~MIMIR_V1_COND_MASK) === 0 && (powersMask & ~MIMIR_V1_POWERS_MASK) === 0, "flags");
  need(degradedSinceSlot > 0n && degradedSinceSlot <= publicationSlot && publicationUnix > 0n, "clocks");
  need(priceState === 1 || priceState === 2, "price_state");
  need(zero(s, 302, 334) && zero(s, 440, 472), "increase capacity");
  need(le(s, 96, 8) >= 1n, "revision");
  const sourceCount = s[252]!;
  need(sourceCount >= 1 && sourceCount <= 5 && conditionedSources > 0 && conditionedSources < (1 << sourceCount), "conditioned_sources vs count");
  const liveness: MimirSnapshotLiveness = { publicationSlot, publicationUnix, degradedSinceSlot, conditionFlags, powersMask,
    priceState: priceState as 1 | 2, conditionedSources, sourceCount };
  if (le(s, 116, 8) === 0n) {
    need(priceState === 2 && s[108] === 0, "cold price/freshness");
    for (const [a, b] of [[12, 16], [110, 156], [188, 196], [200, 252], [253, 258], [294, 356], [420, 512]] as const) need(zero(s, a, b), `cold zero ${a}..${b}`);
    need(!zero(s, 262, 294), "plan hash");
    return { form: "cold", liveness, lastUsable: null };
  }
  need(le(s, 116, 8) <= publicationSlot && i64(s, 132) > 0n && i64(s, 132) <= publicationUnix, "carried legacy clocks");
  const fstar = carriedRules(s);
  need(fstar === null || fstar === 0n, "F* must be zero while DEGRADED");
  return { form: "carried", liveness, lastUsable: { slot: le(s, 116, 8), unix: i64(s, 132), observed: le(s, 140, 8),
    priceX64: le(s, 200, 16), lowerX64: le(s, 216, 16), upperX64: le(s, 232, 16) } };
}

export class MimirSourceConditionedError extends Error {
  readonly code = "MimirSourceConditioned";
  constructor(readonly conditions: number, readonly mask: number) {
    super(`Mimir source is conditioned (0x${conditions.toString(16)}); refresh through the tag-89 private execution flow.`);
  }
}

/**
 * The program's DEGRADED writer: the predecessor snapshot with the liveness block, cleared capacity and the predecessor's degraded-since.
 * Any condition keeps a priced predecessor's price; NO_PRICE only from the sentinel or a NO_PRICE predecessor.
 */
export function predictMimirDegradedSnapshot(pre: Uint8Array, args: {
  readonly newRevision: bigint; readonly minSources: number; readonly sourceCount: number; readonly snapshotSource: 5 | 6 | 7;
  readonly clock: Readonly<{ slot: bigint; unixTs: bigint }>;
  readonly conditionFlags: number; readonly powersMask: number; readonly conditionedSources: number;
}): Uint8Array {
  if (pre.length !== 512) throw new Error("InvalidMimirSnapshot");
  const out = pre.slice(), view = new DataView(out.buffer);
  const sentinel = args.newRevision === 1n, degraded = !sentinel && out[104] === 1;
  if (sentinel) out[252] = args.minSources;
  else if (!(out[107] === args.snapshotSource || (args.snapshotSource === 5 && out[107] === 1)) || out[252] !== args.sourceCount) {
    throw new Error("UnexpectedSnapshotRevision");
  }
  const since = degraded ? view.getBigUint64(172, true) : args.clock.slot;
  const noPrice = sentinel || (degraded && out[185] === MIMIR_PRICE_STATE.NO_PRICE);
  view.setBigUint64(96, args.newRevision, true);
  out[104] = 1; out[105] = 5; out[107] = args.snapshotSource;
  view.setBigUint64(156, args.clock.slot, true); view.setBigInt64(164, args.clock.unixTs, true); view.setBigUint64(172, since, true);
  view.setUint16(180, args.conditionFlags, true); view.setUint16(182, args.powersMask, true);
  out[184] = 1;
  out[185] = noPrice ? MIMIR_PRICE_STATE.NO_PRICE : MIMIR_PRICE_STATE.WITH_PRICE;
  out[186] = args.conditionedSources; out[187] = 0;
  out.fill(0, 302, 334); out.fill(0, 440, 472);
  validateDegradedSnapshot(out);
  return out;
}

export type MimirSnapshotPricingMode = "current-point" | "standard";

/**
 * What a Fresh public snapshot prices with right now: classic `snapshotSource == 7` or composite (MIMIRCSP) `flags == 1` is the
 * current pool price (uncertified, zero history), anything else Fresh is the feed's standard recipe. `null` = not Fresh or not a snapshot.
 * Display only; a trading decision needs the authenticated execution proof.
 */
export function mimirSnapshotPricingMode(data: Uint8Array): MimirSnapshotPricingMode | null {
  if (data.length < 512 || data[104] !== 0) return null;
  const magic = new TextDecoder().decode(data.subarray(0, 8));
  if (magic === "MIMIRSNP") return data[107] === 7 ? "current-point" : "standard";
  if (magic === "MIMIRCSP") return u16(data, 12) === 1 && zero(data, 14, 16) ? "current-point" : "standard";
  return null;
}
