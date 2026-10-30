import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { raydiumSqrtPriceX64FromTickIndex, validateSqrtTick } from "../src/beta/capture.js";

// Reference: raydium-clmm 51fdba2 tick_math.rs get_sqrt_price_at_tick compiled verbatim, every tick in [-443636, 443636].
const hash = createHash("sha256");
for (let tick = -443_636; tick <= 443_636; tick += 1) hash.update(`${tick} ${raydiumSqrtPriceX64FromTickIndex(tick)}\n`);
assert.equal(hash.digest("hex"), "3910c767ee4367579364f6056c6de99a4ea2fe45af4163f86eff0a07fc02a925");
for (const [tick, sqrt] of [
  [-443_636, 4295048016n], [-6913, 13056096158707462663n], [-6912, 13056748947196091839n], [-1, 18445821805675395072n],
  [0, 18446744073709551616n], [1, 18447666387855957090n], [6912, 26061799020345976279n],
  [443_636, 79226673521066979257578248091n],
] as const) assert.equal(raydiumSqrtPriceX64FromTickIndex(tick), sqrt);
assert.throws(() => raydiumSqrtPriceX64FromTickIndex(443_637));
assert.throws(() => raydiumSqrtPriceX64FromTickIndex(-443_637));

const raydiumBoundary = 13056748947196091839n;
// A zero-for-one crossing that ends exactly on an initialized tick keeps sqrt(next) with tick = next - 1.
validateSqrtTick(raydiumBoundary, -6913, raydiumSqrtPriceX64FromTickIndex);
validateSqrtTick(raydiumBoundary, -6912, raydiumSqrtPriceX64FromTickIndex);
assert.throws(() => validateSqrtTick(raydiumBoundary + 1n, -6913, raydiumSqrtPriceX64FromTickIndex), /mismatch/);
assert.throws(() => validateSqrtTick(raydiumSqrtPriceX64FromTickIndex(-6913) - 1n, -6913, raydiumSqrtPriceX64FromTickIndex), /mismatch/);
assert.throws(() => validateSqrtTick(raydiumBoundary, -6913), /mismatch/);
console.log("raydiumTickMath: ok");
