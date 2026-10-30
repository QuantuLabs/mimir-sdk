import { conservativeMintOracleSourceConfigFloor, meteoraDlmmPriceFromIdX64, normalizedDirectQ64PriceX64, normalizedInverseQ64PriceX64 } from "../math.js";
import { token2022EconomicPriceTyped } from "../token2022Clmm.js";

const Q64 = 1n << 64n;
const U128_MAX = (1n << 128n) - 1n;
const BINS_PER_ARRAY = 70;

const u16 = (d: Uint8Array, o: number) => d[o]! | (d[o + 1]! << 8);
const u64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(o, true);
const floorDiv = (v: number, d: number) => Math.floor(v / d);
const mulQ64 = (a: bigint, b: bigint) => { const r = (a * b) >> 64n; if (r > U128_MAX) throw new Error("ArithmeticOverflow"); return r; };

/** `ceil(50/s) - 1`: bins strictly before the 50 bps arrival bin (program `dlmm_point_window_bins`). */
export function meteoraDlmmPointWindowBins(binStep: number): number {
  if (!Number.isInteger(binStep) || binStep < 1 || binStep > 400) throw new Error("InvalidMeteoraDlmmBinStep");
  return Math.ceil(50 / binStep) - 1;
}

/** Program `read_meteora_dlmm_fee_rate_ppm`: `base_factor·bin_step·10·10^power / 1000`, in `1..=100_000`. */
export function meteoraDlmmFeeRatePpm(lbPair: Uint8Array): bigint {
  const fee = BigInt(u16(lbPair, 8)) * BigInt(u16(lbPair, 80)) * 10n * 10n ** BigInt(lbPair[34]!) / 1_000n;
  if (fee === 0n || fee > 100_000n) throw new Error("InvalidMeteoraDlmmFeeRate");
  return fee;
}

/** `200·max(x, y) < 201·min(x, y)`, exact. */
export const meteoraDlmmWithin50Bps = (x: bigint, y: bigint) => { const [lo, hi] = x < y ? [x, y] : [y, x]; return (hi - lo) * 200n < lo; };

export interface MeteoraDlmmToken2022Binding { readonly selectedBase: boolean; readonly multiplierQ64: bigint }

/** Price the row would publish if `id` were the active bin; `null` on any helper failure (program `dlmm_published_price_x64`). */
function publishedPrice(id: number, step: number, xIsBase: boolean, baseDecimals: number, quoteDecimals: number,
  t22: MeteoraDlmmToken2022Binding | null): bigint | null {
  try {
    const raw = meteoraDlmmPriceFromIdX64(id, step);
    const n = xIsBase ? normalizedDirectQ64PriceX64(raw, baseDecimals, quoteDecimals) : normalizedInverseQ64PriceX64(raw, baseDecimals, quoteDecimals);
    return t22 ? token2022EconomicPriceTyped(n, t22.selectedBase ? Q64 : t22.multiplierQ64, t22.selectedBase ? t22.multiplierQ64 : Q64) : n;
  } catch { return null; }
}

export interface MeteoraDlmmPointDepth {
  /** Half-width D = ceil(50/s) - 1. */
  readonly window: number;
  readonly sumX: bigint; readonly sumY: bigint;
  /** Quote-atom value of the X and Y window stock (`classify_dlmm_depths`); 0 when a side is empty. */
  readonly xQuote: bigint; readonly yQuote: bigint;
  /** `D50_point = min(xQuote, yQuote)`, 0 when not credited. */
  readonly depth: bigint;
  readonly liquidity: bigint;
  readonly twoSided: boolean;
  /** Point scale floor (`p_n, p >= 2^24`) and the per-bin 50 bps window guard (endpoint form, §2.2.1). */
  readonly guardOk: boolean;
  /** Directional quote values of each arm, independent of the other arm being empty. */
  readonly xSide: bigint; readonly ySide: bigint;
  /** The window reaches past the supplied arrays: missing Y arm (`lower`) / X arm (`upper`). */
  readonly clippedLower: boolean; readonly clippedUpper: boolean;
}

/**
 * Exact program mirror of the compact point window (`observe_meteora_dlmm(…, DlmmDepthWindow::Point)`), or the Legacy window
 * (`legacy`, radius `ceil(50/s)`, no guard): `activeArray` is the authenticated canonical bin array holding `active`, `lowerArray` /
 * `upperArray` its optional canonical neighbours; reserves are the oriented vault amounts.
 */
export function meteoraDlmmPointDepth(a: Readonly<{ activeArray: Uint8Array; active: number; binStep: number; tokenXIsBase: boolean;
  baseDecimals: number; quoteDecimals: number; token2022: MeteoraDlmmToken2022Binding | null; baseReserve: bigint; quoteReserve: bigint;
  lowerArray?: Uint8Array | null; upperArray?: Uint8Array | null; legacy?: boolean }>): MeteoraDlmmPointDepth {
  const d = meteoraDlmmPointWindowBins(a.binStep) + (a.legacy ? 1 : 0);
  const first = floorDiv(a.active, BINS_PER_ARRAY) * BINS_PER_ARRAY; const local = a.active - first;
  const lo = -(a.lowerArray ? BINS_PER_ARRAY : 0), hi = BINS_PER_ARRAY - 1 + (a.upperArray ? BINS_PER_ARRAY : 0);
  const bin = (i: number) => {
    const [data, at] = i < 0 ? [a.lowerArray!, i + BINS_PER_ARRAY] : i >= BINS_PER_ARRAY ? [a.upperArray!, i - BINS_PER_ARRAY] : [a.activeArray, i];
    return { x: u64(data, 56 + at * 144), y: u64(data, 56 + at * 144 + 8) };
  };
  let sumX = 0n; let sumY = 0n;
  for (let i = Math.max(local - d, lo); i <= local; i += 1) sumY += bin(i).y;
  for (let i = local; i <= Math.min(local + d, hi); i += 1) sumX += bin(i).x;
  if (sumX > U128_MAX || sumY > U128_MAX) throw new Error("ArithmeticOverflow");
  const activeBin = bin(local); const twoSided = activeBin.x > 0n && activeBin.y > 0n;
  const raw = meteoraDlmmPriceFromIdX64(a.active, a.binStep);
  const rawQuotePerBase = a.tokenXIsBase ? raw : (1n << 128n) / raw;
  const [xSide, ySide] = a.tokenXIsBase ? [mulQ64(sumX, raw), sumY] : [sumX, mulQ64(sumY, rawQuotePerBase)];
  const [xQuote, yQuote] = sumX === 0n || sumY === 0n ? [0n, 0n] : [xSide, ySide];
  const depth = xQuote < yQuote ? xQuote : yQuote;
  const baseValue = (a.baseReserve * rawQuotePerBase) >> 64n;
  const liquidity = [depth, a.quoteReserve, baseValue].reduce((m, v) => v < m ? v : m);
  const price = (id: number, t22 = a.token2022) => publishedPrice(id, a.binStep, a.tokenXIsBase, a.baseDecimals, a.quoteDecimals, t22);
  const pA = price(a.active); const normalized = price(a.active, null) ?? 0n;
  const guardOk = pA !== null && pA >= 1n << 24n && normalized >= 1n << 24n &&
    [Math.max(a.active - d, first + lo), Math.min(a.active + d, first + hi)].every((id) => {
      const p = price(id); return p !== null && p !== 0n && meteoraDlmmWithin50Bps(p, pA);
    });
  return { window: d, sumX, sumY, xQuote, yQuote, depth, liquidity, twoSided, guardOk, xSide, ySide,
    clippedLower: local - d < lo, clippedUpper: local + d > hi };
}

/** Smallest depth floor with a non-zero internal econ floor: `ceil(10^6/fee)`. */
export const meteoraDlmmPointEconFloor = (feePpm: bigint) => (1_000_000n + feePpm - 1n) / feePpm;

/** Point floor `F = max(ceil(10^6/fee), max(1, floor(depth·bps/10000)))`; `null` when the pool cannot carry a non-zero internal econ floor at its own depth. */
export function meteoraDlmmPointFloor(depth: bigint, feePpm: bigint, depthFloorBps = 900): bigint | null {
  const fraction = conservativeMintOracleSourceConfigFloor(depth, depthFloorBps);
  const econ = meteoraDlmmPointEconFloor(feePpm);
  if (econ > depth) return null;
  return econ > fraction ? econ : fraction;
}
