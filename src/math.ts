import { freshNumberRecord } from "./internal/canonicalAuthority.js";

const SourceDirection = freshNumberRecord("SourceDirection");

const U128_MAX = (1n << 128n) - 1n;
const U256_MAX = (1n << 256n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

export const Q64 = 1n << 64n;

export function conservativeMintOracleSourceConfigFloor(value: bigint, depthFloorBps = 9_000): bigint {
  if (!Number.isInteger(depthFloorBps) || depthFloorBps < 1 || depthFloorBps > 10_000) throw new RangeError("depthFloorBps out of range");
  if (value <= 1n) return 1n;
  const floored = (value * BigInt(depthFloorBps)) / 10_000n;
  return floored > 0n ? floored : 1n;
}

const SQRT_UP_10_BPS_X64 = 18_455_965_141_055_598_611n;
const SQRT_DOWN_10_BPS_X64 = 18_437_518_394_676_045_041n;
const SQRT_UP_50_BPS_X64 = 18_492_803_431_484_993_638n;
const SQRT_DOWN_50_BPS_X64 = 18_400_569_422_882_917_161n;
const SQRT_UP_100_BPS_X64 = 18_538_748_355_542_988_170n;
const SQRT_DOWN_100_BPS_X64 = 18_354_278_608_861_996_862n;

export interface CpmmManipulationBounds {
  capitalRequiredUpQuote: bigint;
  capitalRequiredDownQuote: bigint;
  capitalRequiredFloor: bigint;
  economicLossFloor: bigint;
}

function assertU128(value: bigint): void {
  if (value < 0n || value > U128_MAX) throw new Error("ArithmeticOverflow");
}

function checkedSubU128(left: bigint, right: bigint): bigint {
  assertU128(left);
  assertU128(right);
  if (right > left) throw new Error("ArithmeticOverflow");
  return left - right;
}

function checkedAddU128(left: bigint, right: bigint): bigint {
  assertU128(left);
  assertU128(right);
  const result = left + right;
  if (result > U128_MAX) throw new Error("ArithmeticOverflow");
  return result;
}

function checkedMulU128(left: bigint, right: bigint): bigint {
  assertU128(left);
  assertU128(right);
  const result = left * right;
  if (result > U128_MAX) throw new Error("ArithmeticOverflow");
  return result;
}

function checkedDivU128(left: bigint, right: bigint): bigint {
  assertU128(left);
  assertU128(right);
  if (right === 0n) throw new Error("ArithmeticOverflow");
  return left / right;
}

function checkedMulU256ByU128(left: bigint, right: bigint): bigint {
  if (left < 0n || left > U256_MAX) throw new Error("ArithmeticOverflow");
  assertU128(right);
  const result = left * right;
  if (result > U256_MAX) throw new Error("ArithmeticOverflow");
  return result;
}

function checkedDivU256ByU128(left: bigint, right: bigint): bigint {
  if (left < 0n || left > U256_MAX) throw new Error("ArithmeticOverflow");
  assertU128(right);
  if (right === 0n) throw new Error("ArithmeticOverflow");
  return left / right;
}

function gcdU128(left: bigint, right: bigint): bigint {
  assertU128(left);
  assertU128(right);
  let a = left;
  let b = right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0n ? 1n : a;
}

export function pow10U128(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("InvalidExponent");
  }
  let value = 1n;
  for (let index = 0; index < decimals; index += 1) {
    value = checkedMulU128(value, 10n);
  }
  return value;
}

export function ratioToX64(
  numerator: bigint,
  numeratorScale: bigint,
  denominator: bigint,
  denominatorScale: bigint,
): bigint {
  assertU128(numerator);
  assertU128(numeratorScale);
  assertU128(denominator);
  assertU128(denominatorScale);
  if (
    numerator === 0n ||
    numeratorScale === 0n ||
    denominator === 0n ||
    denominatorScale === 0n
  ) {
    throw new Error("InvalidAccountData");
  }

  let reducedNumerator = numerator;
  let reducedNumeratorScale = numeratorScale;
  let reducedDenominator = denominator;
  let reducedDenominatorScale = denominatorScale;

  let divisor = gcdU128(reducedNumeratorScale, reducedDenominator);
  reducedNumeratorScale /= divisor;
  reducedDenominator /= divisor;

  divisor = gcdU128(reducedNumerator, reducedDenominatorScale);
  reducedNumerator /= divisor;
  reducedDenominatorScale /= divisor;

  const numeratorFactors = [reducedNumerator, reducedNumeratorScale, Q64];
  const denominatorFactors = [reducedDenominator, reducedDenominatorScale];
  for (let numeratorIndex = 0; numeratorIndex < numeratorFactors.length; numeratorIndex += 1) {
    for (
      let denominatorIndex = 0;
      denominatorIndex < denominatorFactors.length;
      denominatorIndex += 1
    ) {
      divisor = gcdU128(
        numeratorFactors[numeratorIndex],
        denominatorFactors[denominatorIndex],
      );
      numeratorFactors[numeratorIndex] /= divisor;
      denominatorFactors[denominatorIndex] /= divisor;
    }
  }

  let scaledNumerator = 1n;
  for (const factor of numeratorFactors) {
    scaledNumerator = checkedMulU256ByU128(scaledNumerator, factor);
  }
  for (const factor of denominatorFactors) {
    scaledNumerator = checkedDivU256ByU128(scaledNumerator, factor);
  }
  assertU128(scaledNumerator);
  return scaledNumerator;
}

export function normalizedCpmmPriceX64(
  baseReserve: bigint,
  quoteReserve: bigint,
  baseDecimals: number,
  quoteDecimals: number,
  direction: number,
): bigint {
  const baseScale = pow10U128(baseDecimals);
  const quoteScale = pow10U128(quoteDecimals);
  switch (direction) {
    case SourceDirection.QuotePerBase:
      return ratioToX64(quoteReserve, baseScale, baseReserve, quoteScale);
    case SourceDirection.BasePerQuote:
      return ratioToX64(baseReserve, quoteScale, quoteReserve, baseScale);
    default:
      throw new Error("InvalidSourceConfig");
  }
}

export function normalizedCpmmNativeTwapPriceX64(params: {
  token0IsBase: boolean;
  direction: number;
  baseDecimals: number;
  quoteDecimals: number;
  oldTimestamp: bigint;
  newTimestamp: bigint;
  oldCumulativeToken0PriceX32: bigint;
  newCumulativeToken0PriceX32: bigint;
  oldCumulativeToken1PriceX32: bigint;
  newCumulativeToken1PriceX32: bigint;
}): bigint {
  if (params.newTimestamp <= params.oldTimestamp) {
    throw new Error("InvalidTwapState");
  }
  const useToken0Price =
    (params.token0IsBase && params.direction === SourceDirection.QuotePerBase) ||
    (!params.token0IsBase && params.direction === SourceDirection.BasePerQuote);
  const oldCumulative = useToken0Price
    ? params.oldCumulativeToken0PriceX32
    : params.oldCumulativeToken1PriceX32;
  const newCumulative = useToken0Price
    ? params.newCumulativeToken0PriceX32
    : params.newCumulativeToken1PriceX32;
  assertU128(oldCumulative);
  assertU128(newCumulative);
  const elapsedSecs = params.newTimestamp - params.oldTimestamp;
  const cumulativeDelta = (newCumulative - oldCumulative) & U128_MAX;
  const averagePriceX32 = cumulativeDelta / elapsedSecs;
  if (averagePriceX32 === 0n) throw new Error("InvalidTwapState");
  const q32 = 1n << 32n;
  switch (params.direction) {
    case SourceDirection.QuotePerBase:
      return ratioToX64(
        averagePriceX32,
        pow10U128(params.baseDecimals),
        q32,
        pow10U128(params.quoteDecimals),
      );
    case SourceDirection.BasePerQuote:
      return ratioToX64(
        averagePriceX32,
        pow10U128(params.quoteDecimals),
        q32,
        pow10U128(params.baseDecimals),
      );
    default:
      throw new Error("InvalidSourceConfig");
  }
}

export function normalizedDirectQ64PriceX64(
  rawPriceX64: bigint,
  baseDecimals: number,
  quoteDecimals: number,
): bigint {
  return ratioToX64(
    rawPriceX64,
    pow10U128(baseDecimals),
    Q64,
    pow10U128(quoteDecimals),
  );
}

export function normalizedInverseQ64PriceX64(
  rawPriceX64: bigint,
  baseDecimals: number,
  quoteDecimals: number,
): bigint {
  return ratioToX64(
    Q64,
    pow10U128(baseDecimals),
    rawPriceX64,
    pow10U128(quoteDecimals),
  );
}

export function squareQ64ToX64(value: bigint): bigint {
  assertU128(value);
  const lo = value & U64_MAX;
  const hi = value >> 64n;
  const hiHi = checkedMulU128(hi, hi);
  if (hiHi > U64_MAX) throw new Error("ArithmeticOverflow");
  const term0 = hiHi << 64n;
  assertU128(term0);
  const term1 = checkedMulU128(hi, lo);
  const term2 = checkedMulU128(lo, hi);
  const term3 = checkedMulU128(lo, lo) >> 64n;
  return checkedAddU128(checkedAddU128(checkedAddU128(term0, term1), term2), term3);
}

function sqrtConstants(targetBps: number): readonly [bigint, bigint] {
  switch (targetBps) {
    case 10:
      return [SQRT_UP_10_BPS_X64, SQRT_DOWN_10_BPS_X64];
    case 50:
      return [SQRT_UP_50_BPS_X64, SQRT_DOWN_50_BPS_X64];
    case 100:
      return [SQRT_UP_100_BPS_X64, SQRT_DOWN_100_BPS_X64];
    default:
      throw new Error("UnsupportedBps");
  }
}

export function cpmmZeroFeeImmediateUnwindBounds(
  reserveBase: bigint,
  reserveQuote: bigint,
  targetBps: number,
): CpmmManipulationBounds {
  if (reserveBase <= 0n || reserveQuote <= 0n) {
    throw new Error("InvalidAccountData");
  }
  assertU128(reserveBase);
  assertU128(reserveQuote);

  const [sqrtUp, sqrtDown] = sqrtConstants(targetBps);
  const upDelta = checkedSubU128(sqrtUp, Q64);
  const downDelta = checkedSubU128(Q64, sqrtDown);

  const capitalRequiredUpQuote = checkedDivU128(
    checkedMulU128(reserveQuote, upDelta),
    Q64,
  );
  const baseInDown = checkedDivU128(
    checkedMulU128(reserveBase, downDelta),
    sqrtDown,
  );
  const priceX64 = checkedDivU128(checkedMulU128(reserveQuote, Q64), reserveBase);
  const capitalRequiredDownQuote = checkedDivU128(
    checkedMulU128(baseInDown, priceX64),
    Q64,
  );
  const capitalRequiredFloor =
    capitalRequiredUpQuote < capitalRequiredDownQuote
      ? capitalRequiredUpQuote
      : capitalRequiredDownQuote;

  return {
    capitalRequiredUpQuote,
    capitalRequiredDownQuote,
    capitalRequiredFloor,
    economicLossFloor: 0n,
  };
}

function assertI32(value: number): void {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new Error("InvalidMeteoraDlmmPriceInput");
  }
}

function assertU16(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error("InvalidMeteoraDlmmPriceInput");
  }
}

function checkedMulShiftRight64(left: bigint, right: bigint): bigint {
  return checkedMulU128(left, right) >> 64n;
}

function powQ64I32(base: bigint, exponent: number): bigint {
  if (exponent === 0) return Q64;
  if (exponent === -0x8000_0000) throw new Error("ArithmeticOverflow");

  let invert = exponent < 0;
  const absExponent = Math.abs(exponent);
  if (absExponent >= 0x80000) throw new Error("ArithmeticOverflow");

  let squaredBase = base;
  let result = Q64;
  if (squaredBase >= result) {
    squaredBase = checkedDivU128(U128_MAX, squaredBase);
    invert = !invert;
  }

  for (let bit = 1; bit <= 0x40000; bit <<= 1) {
    if ((absExponent & bit) !== 0) {
      result = checkedMulShiftRight64(result, squaredBase);
    }
    if (bit !== 0x40000) {
      squaredBase = checkedMulShiftRight64(squaredBase, squaredBase);
    }
  }

  if (result === 0n) throw new Error("ArithmeticOverflow");
  if (invert) {
    result = checkedDivU128(U128_MAX, result);
  }
  return result;
}

export function meteoraDlmmPriceFromIdX64(
  activeId: number,
  binStep: number,
): bigint {
  assertI32(activeId);
  assertU16(binStep);
  const bps = checkedDivU128(BigInt(binStep) << 64n, 10_000n);
  const base = checkedAddU128(Q64, bps);
  return powQ64I32(base, activeId);
}

export function meteoraDlmmPriceFromCumulativeBinX64(
  cumulativeBinDelta: bigint,
  window: bigint,
  binStep: number,
): bigint {
  if (
    cumulativeBinDelta < -(1n << 127n) ||
    cumulativeBinDelta > (1n << 127n) - 1n ||
    window <= 0n ||
    window > U64_MAX ||
    !Number.isInteger(binStep) ||
    binStep < 1 ||
    binStep > 400
  ) {
    throw new Error("InvalidMeteoraDlmmPriceInput");
  }

  let integerBin = cumulativeBinDelta / window;
  let remainder = cumulativeBinDelta % window;
  if (remainder < 0n) {
    integerBin -= 1n;
    remainder += window;
  }
  const integerBinNumber = Number(integerBin);
  assertI32(integerBinNumber);
  const integerFactor = meteoraDlmmPriceFromIdX64(integerBinNumber, binStep);

  const d = (BigInt(binStep) * Q64) / 10_000n;
  const z = (d * Q64) / (2n * Q64 + d);
  const z2 = (z * z) >> 64n;
  let power = z;
  let log = 0n;
  for (const divisor of [1n, 3n, 5n, 7n, 9n, 11n]) {
    log += power / divisor;
    if (divisor !== 11n) power = (power * z2) >> 64n;
  }
  log *= 2n;
  const x = (log * remainder) / window;
  let fractionalFactor = Q64;
  let term = Q64;
  for (let divisor = 1n; divisor <= 10n; divisor += 1n) {
    term = ((term * x) >> 64n) / divisor;
    fractionalFactor += term;
  }
  assertU128(fractionalFactor);

  const product = integerFactor * fractionalFactor;
  if (product > U256_MAX) throw new Error("ArithmeticOverflow");
  const result = product >> 64n;
  assertU128(result);
  return result;
}
