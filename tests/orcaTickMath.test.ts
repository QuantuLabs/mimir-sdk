import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { clmmSqrtPriceX64FromTickIndex, orcaSqrtPriceX64FromTickIndex, validateSqrtTick } from "../src/beta/capture.js";

// Reference: @orca-so/whirlpools-sdk 0.22.0 PriceMath.tickIndexToSqrtPriceX64, every tick in [-443636, 443636].
const hash = createHash("sha256");
for (let tick = -443_636; tick <= 443_636; tick += 1) hash.update(`${tick} ${orcaSqrtPriceX64FromTickIndex(tick)}\n`);
assert.equal(hash.digest("hex"), "2eee366ea2fe45135a220be8adfa808daf6ffca6ceb00c302fcacc8b5b323b39");
for (const [tick, sqrt] of [
  [-443_636, 4295048016n], [-6912, 13056748947194648238n], [-1, 18445821805675392311n], [0, 18446744073709551616n],
  [1, 18447666387855959850n], [6912, 26061799020348857760n], [443_636, 79226673515401279992447579055n],
] as const) assert.equal(orcaSqrtPriceX64FromTickIndex(tick), sqrt);
assert.throws(() => orcaSqrtPriceX64FromTickIndex(443_637));

const orcaBoundary = 13056748947194648238n;
assert.equal(clmmSqrtPriceX64FromTickIndex(-6912), 13056748947194648240n);
validateSqrtTick(orcaBoundary, -6912, orcaSqrtPriceX64FromTickIndex);
assert.throws(() => validateSqrtTick(orcaBoundary, -6912), /CLMM sqrt price\/tick mismatch/);
validateSqrtTick(13056748947194648240n, -6912);
assert.throws(() => validateSqrtTick(orcaBoundary - 1n, -6912, orcaSqrtPriceX64FromTickIndex), /mismatch/);
// A zero-for-one crossing that ends exactly on an initialized tick keeps sqrt(next) with tick = next - 1 (both families).
validateSqrtTick(orcaBoundary, -6913, orcaSqrtPriceX64FromTickIndex);
assert.throws(() => validateSqrtTick(orcaBoundary + 1n, -6913, orcaSqrtPriceX64FromTickIndex), /mismatch/);
assert.throws(() => validateSqrtTick(orcaSqrtPriceX64FromTickIndex(-6913) - 1n, -6913, orcaSqrtPriceX64FromTickIndex), /mismatch/);
validateSqrtTick(13056748947194648240n, -6913);
assert.throws(() => validateSqrtTick(13056748947194648241n, -6913), /mismatch/);
console.log("orcaTickMath: ok");
