import assert from "node:assert/strict";
import { meteoraDlmmFeeRatePpm, meteoraDlmmPointDepth, meteoraDlmmPointFloor, meteoraDlmmPointWindowBins } from "../src/internal/dlmmPointCore.js";
import { classifyMeteoraDlmmDualReadiness } from "../src/internal/nativeMonoRefreshCore.js";
import { meteoraDlmmPriceFromIdX64 } from "../src/math.js";

// Window theorem table (spec §2.2): D(s) = ceil(50/s) - 1.
assert.deepEqual([1, 2, 3, 4, 5, 10, 13, 17, 25, 49, 50, 400].map(meteoraDlmmPointWindowBins), [49, 24, 16, 12, 9, 4, 3, 2, 1, 1, 0, 0]);
assert.throws(() => meteoraDlmmPointWindowBins(0)); assert.throws(() => meteoraDlmmPointWindowBins(401));

const array = (local: number, bins: Readonly<Record<number, [bigint, bigint]>>) => {
  const a = new Uint8Array(10_136); const v = new DataView(a.buffer);
  for (const [i, [x, y]] of Object.entries(bins)) { v.setBigUint64(56 + (local + Number(i)) * 144, x, true); v.setBigUint64(56 + (local + Number(i)) * 144 + 8, y, true); }
  return a;
};
// Regression tuple: s=1, a=-404 923 (array -5785, local 27), X = base 12/6, v0.
const a = -404_923;
assert.deepEqual([meteoraDlmmPriceFromIdX64(a, 1), meteoraDlmmPriceFromIdX64(a + 1, 1), meteoraDlmmPriceFromIdX64(a + 49, 1)], [47n, 48n, 48n]);
const b1 = meteoraDlmmPointDepth({ activeArray: array(27, { 0: [1n, 25n], 1: [9_999_999_999_999_999_999n, 0n] }), active: a, binStep: 1, tokenXIsBase: true,
  baseDecimals: 12, quoteDecimals: 6, token2022: null, baseReserve: 10n ** 19n, quoteReserve: 25n });
assert.deepEqual([b1.window, b1.xQuote, b1.yQuote, b1.depth, b1.liquidity, b1.twoSided, b1.guardOk], [49, 25n, 25n, 25n, 25n, true, false]);
// Benign (H2b): a = 0, every s, 9/6 -> guard holds.
for (let s = 1; s <= 400; s += 1) {
  assert.ok(meteoraDlmmPointDepth({ activeArray: array(0, { 0: [10n ** 9n, 10n ** 6n] }), active: 0, binStep: s, tokenXIsBase: true, baseDecimals: 9, quoteDecimals: 6,
    token2022: null, baseReserve: 10n ** 12n, quoteReserve: 10n ** 12n }).guardOk, `s=${s}`);
}
// Worked example s=10 (§2.6): legacy a±5 credits 1025 per side, point a±4 credits 25; the arrival bin is never counted.
const ex = meteoraDlmmPointDepth({ activeArray: array(35, { "-5": [0n, 1000n], "-4": [0n, 5n], "-3": [0n, 5n], "-2": [0n, 5n], "-1": [0n, 5n], 0: [5n, 5n],
  1: [5n, 0n], 2: [5n, 0n], 3: [5n, 0n], 4: [5n, 0n], 5: [1000n, 0n] }), active: 35, binStep: 10, tokenXIsBase: true, baseDecimals: 6, quoteDecimals: 6,
  token2022: null, baseReserve: 10n ** 9n, quoteReserve: 10n ** 9n });
assert.deepEqual([ex.window, ex.sumX, ex.sumY, ex.twoSided], [4, 25n, 25n, true]);
// Optional canonical neighbours: absent arrays clip their arm; a supplied lower/upper array credits only its own arm inside the same radius.
{
  const base = { active: 0, binStep: 10, tokenXIsBase: true, baseDecimals: 6, quoteDecimals: 6, token2022: null, baseReserve: 10n ** 9n, quoteReserve: 10n ** 9n };
  const activeArray = array(0, { 0: [5n, 5n], 1: [5n, 0n] }), lowerArray = array(69, { "-5": [0n, 1000n], "-4": [0n, 7n], 0: [0n, 3n] });
  const visible = meteoraDlmmPointDepth({ ...base, activeArray, legacy: true });
  assert.deepEqual([visible.window, visible.sumX, visible.sumY, visible.ySide, visible.clippedLower, visible.clippedUpper], [5, 10n, 5n, 5n, true, false]);
  const lower = meteoraDlmmPointDepth({ ...base, activeArray, lowerArray, legacy: true });
  assert.deepEqual([lower.sumX, lower.sumY, lower.clippedLower], [10n, 15n, false], "bin -6 lies outside the Legacy radius");
  assert.deepEqual([meteoraDlmmPointDepth({ ...base, activeArray, lowerArray }).sumY, meteoraDlmmPointDepth({ ...base, activeArray, upperArray: lowerArray }).sumX], [8n, 10n]);
  const xOnly = meteoraDlmmPointDepth({ ...base, activeArray: array(0, { 0: [5n, 0n] }), legacy: true });
  assert.deepEqual([xOnly.depth, xOnly.xSide > 0n, xOnly.ySide], [0n, true, 0n]);
}
// One-sided active bin is not qualified.
assert.equal(meteoraDlmmPointDepth({ activeArray: array(0, { 0: [5n, 0n], 1: [5n, 0n] }), active: 0, binStep: 100, tokenXIsBase: true, baseDecimals: 6, quoteDecimals: 6,
  token2022: null, baseReserve: 10n, quoteReserve: 10n }).twoSided, false);

// Fee rate and floor policy (§7.4): F = max(ceil(1e6/fee), max(1, floor(depth*bps/10000))); refuse when ceil(1e6/fee) > depth.
const pair = new Uint8Array(904); new DataView(pair.buffer).setUint16(8, 10_000, true); new DataView(pair.buffer).setUint16(80, 25, true);
assert.equal(meteoraDlmmFeeRatePpm(pair), 2_500n);
assert.deepEqual([meteoraDlmmPointFloor(25n, 100_000n), meteoraDlmmPointFloor(1_000n, 2_500n), meteoraDlmmPointFloor(5n, 100_000n)], [10n, 400n, null]);

assert.equal(meteoraDlmmPointFloor(1_001n, 100_000n), 90n);
assert.equal(meteoraDlmmPointFloor(1_001n, 100_000n, 9_000), 900n);
assert.equal(meteoraDlmmPointFloor(10n, 100_000n, 1), 10n, "economic minimum dominates tiny fractions");
for (const bps of [0, -1, NaN, 1.5, 10_001]) assert.throws(() => meteoraDlmmPointFloor(1_000n, 100_000n, bps), RangeError);

// DUAL readiness classifier (§5.2), program mapping authoritative.
const T = 2_000_000_000n;
const oracle = (latest: number, samples: readonly (readonly [bigint, bigint])[], length = samples.length, active = samples.length) => {
  const d = new Uint8Array(32 + 32 * length); const v = new DataView(d.buffer); d.set([139, 194, 131, 179, 140, 179, 229, 244]);
  v.setBigUint64(8, BigInt(latest), true); v.setBigUint64(16, BigInt(active), true); v.setBigUint64(24, BigInt(length), true);
  samples.forEach(([c, u], i) => { v.setBigUint64(32 + 32 * i + 16, c, true); v.setBigUint64(32 + 32 * i + 24, u, true); });
  return d;
};
const hist = [[T + 600n, T + 690n], [T + 700n, T + 790n], [T + 800n, T + 890n], [T + 900n, T + 990n]] as const;
assert.equal(classifyMeteoraDlmmDualReadiness(oracle(3, hist), T + 1_000n), "ready");
for (const now of [T + 1_051n, T + 1_110n]) assert.equal(classifyMeteoraDlmmDualReadiness(oracle(3, hist), now), "ready", "a 61–120 s tail extends to now (e9e904e)");
assert.equal(classifyMeteoraDlmmDualReadiness(oracle(3, hist), T + 1_111n), "STALE");
assert.equal(classifyMeteoraDlmmDualReadiness(oracle(2, hist.slice(1)), T + 1_000n), "INSUFFICIENT");
assert.equal(classifyMeteoraDlmmDualReadiness(oracle(3, [hist[0], [T + 700n, T + 790n], [T + 950n, T + 960n], [T + 970n, T + 990n]]), T + 1_000n), "GAP");
assert.equal(classifyMeteoraDlmmDualReadiness(oracle(3, hist), T + 900n), "INVALID");
assert.equal(classifyMeteoraDlmmDualReadiness(oracle(0, [], 2, 0), T), "INSUFFICIENT", "cold pristine oracle");
const dirty = oracle(0, [], 2, 0); dirty[40] = 1;
assert.equal(classifyMeteoraDlmmDualReadiness(dirty, T), "INVALID", "non-pristine empty oracle");
assert.equal(classifyMeteoraDlmmDualReadiness(oracle(3, hist.map(([c, u]) => [c - T + 10n, u - T + 10n] as const)), 1_000n), "INVALID", "pre-deployment history");

// Explicit DLMM compact point creation row: direct vector + pinned DLMM program/ProgramData tail -> m5.k5 E6 (v0) / E7 (v1); never a converter.
const { mimirClassicRow } = await import("../src/beta/classicExecution.js");
const { mimirFusedRow } = await import("../src/beta/compositeExecution.js");
const { mimirExecutableGenerationPins } = await import("../src/internal/nativeMonoRefreshCore.js");
const [dlmmProgram, dlmmProgramData] = mimirExecutableGenerationPins("mainnet").dlmm;
const k = "11111111111111111111111111111111" as never;
const pointRow = (v: 0 | 1) => ({ adapterType: 3, adapterVersion: v, currentPoint: true, sourceConfig: k, feedConfig: k, sourcingPlan: k, adapterAccounts: Array(4 + v).fill(k),
  temporal: { version: 4, sourceProgram: dlmmProgram as never, sourceProgramData: dlmmProgramData as never }, witness: { minSlotGap: 0 } as never });
for (const v of [0, 1] as const) {
  const c = mimirClassicRow({ ...pointRow(v), role: "primary" });
  assert.deepEqual([c.recipe.mode, c.recipe.temporalKind, c.recipe.externalWidth, c.externals.at(-2)], [5, 5, 6 + v, dlmmProgram]);
  assert.equal(mimirFusedRow({ ...pointRow(v), role: "component" }).recipe.mode, 5);
  assert.throws(() => mimirClassicRow({ ...pointRow(v), role: "converter" }));
}
console.log("dlmmPoint ok");
