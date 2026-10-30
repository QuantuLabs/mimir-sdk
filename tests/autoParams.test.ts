import assert from "node:assert/strict";
import type { Address } from "@solana/kit";
import { MimirBetaCompositeQualityError, MimirBetaError, MimirBetaUnpriceableError } from "../src/beta/errors.js";
import { assertMimirPriceable, mimirAgeSlots, mimirAutoClassicPolicy, mimirAutoCompositePolicy, mimirAutoPriceExponent, mimirMeasureSlotMs, mimirObservedCapBps,
  MIMIR_PARAM_MARGINS, type MimirCompositeParamRow, type MimirParamRow } from "../src/beta/params.js";
import { conservativeMintOracleSourceConfigFloor } from "../src/math.js";

const pool = (i: number) => `Pool${i}11111111111111111111111111111111111`.slice(0, 44) as Address;
const data = (offset: number, value: number) => { const d = new Uint8Array(300); new DataView(d.buffer).setUint16(offset, value, true); return d; };
const clmm = (i: number, tickSpacing: number): MimirParamRow => ({ family: "raydium-clmm", pool: pool(i), poolData: data(235, tickSpacing) });
const orca = (i: number, tickSpacing: number): MimirParamRow => ({ family: "orca-whirlpool", pool: pool(i), poolData: data(41, tickSpacing) });
const dlmm = (i: number, binStep: number, recipe: MimirParamRow["recipe"] = null): MimirParamRow => ({ family: "meteora-dlmm", pool: pool(i), poolData: data(80, binStep), recipe });
const component = (row: MimirParamRow, position: number, child = { maxConfidenceBps: 100, maxSourceActivityAgeSlots: 150 }): MimirCompositeParamRow =>
  ({ ...row, position, sourceConfig: pool(90 + position), child });
const base = { profile: 0, riskTier: 1, priceExponent: -8, anchorPolicyHash: new Uint8Array(32).fill(1), nativeExceptionHash: new Uint8Array(32).fill(2) };
const code = (c: string) => (e: unknown) => e instanceof MimirBetaError && e.code === c;
const SLOT_MS = 400;

// WALLST shape: CLMM tick spacings 60/10/60/120/60 (HOODX = component 4 as entered). The old 100/100 caps can never price HOODX.
const wallst = [60, 10, 60, 120, 60].map((t, i) => component(clmm(i, t), i + 1));
const refused = (() => { try { assertMimirPriceable({ kind: "composite", policy: { maxComponentConfidenceBps: 100, maxComponentDispersionBps: 100 }, rows: wallst }); } catch (e) { return e; } })();
assert.ok(refused instanceof MimirBetaCompositeQualityError && refused instanceof MimirBetaUnpriceableError);
assert.equal(refused.code, "COMPOSITE_QUALITY_INCOMPATIBLE");
assert.deepEqual(refused.violations.map((v) => [v.position, v.metric, v.valueBps, v.capBps]), [[4, "dispersion", 120, 100]]);
assert.match(refused.explanation, /^Component 4 \(raydium-clmm Pool3\w+\) has a 120 bps source spread; this basket allows 100 bps \(maxComponentDispersionBps\)\. It could never price/);
const auto = mimirAutoCompositePolicy({ rows: wallst, slotMs: SLOT_MS, priceExponent: -9 });
assert.deepEqual(auto.policy, { priceExponent: -9, maxSnapshotAgeSlots: 188, maxComponentSnapshotAgeSlots: 188, maxComponentConfidenceBps: 100, maxComponentDispersionBps: 150 });
assert.deepEqual(auto.widenedBy, [{ parameter: "maxComponentDispersionBps", position: 4, pool: pool(3), valueBps: 120, requiredBps: 150, capBps: 150 }]);
assertMimirPriceable({ kind: "composite", policy: auto.policy, rows: wallst });
// Each widening row carries its own requirement; only the one equal to the sealed cap set it (GTA 400 → 500, not 256/120/125).
const gta = mimirAutoCompositePolicy({ rows: [256, 120, 125, 400].map((b, i) => component(dlmm(i, b), i + 1, { maxConfidenceBps: Math.ceil(b * 1.25), maxSourceActivityAgeSlots: 150 })),
  slotMs: SLOT_MS, priceExponent: -8 }).widenedBy;
assert.deepEqual(gta.map((w) => [w.parameter, w.position, w.requiredBps, w.capBps]), 
  ["maxComponentDispersionBps", "maxComponentConfidenceBps"].flatMap((p) => [[p, 1, 320, 500], [p, 2, 150, 500], [p, 3, 157, 500], [p, 4, 500, 500]]));
// A converter-set confidence (300) is no row's requirement; a Classic native window (300) is not the row's either.
const converted = mimirAutoCompositePolicy({ rows: [component(dlmm(1, 120), 1, { maxConfidenceBps: 150, maxSourceActivityAgeSlots: 150 }), component(clmm(2, 1), 2)],
  slotMs: SLOT_MS, priceExponent: -8, converter: { sourceConfig: pool(80), rows: [], maxConfidenceBps: 300, maxDispersionBps: 100 } });
assert.deepEqual(converted.widenedBy.filter((w) => w.parameter === "maxComponentConfidenceBps").map((w) => [w.requiredBps, w.capBps]), [[150, 300]]);
assert.deepEqual(mimirAutoClassicPolicy({ rows: [dlmm(1, 120, "native-bounded")], slotMs: SLOT_MS, base }).widenedBy.map((w) => [w.requiredBps, w.capBps]), [[150, 300]]);

// Wide pools (index): CLMM 200 → 250; Orca 128 → 160, Orca 256 → 320; DLMM 125/200 lift both caps;
// a SOL-quoted index inherits the SOL feed's sealed caps; child caps and ages are kept.
const index = (rows: MimirParamRow[], extra = {}) => mimirAutoCompositePolicy({ rows: rows.map((r, i) => component(r, i + 1)), slotMs: SLOT_MS, priceExponent: -8, ...extra }).policy;
assert.deepEqual([[clmm(1, 200)], [orca(1, 128)], [orca(1, 256)], [dlmm(1, 125)], [dlmm(1, 200)]].map((r) => {
  const p = index([...r, clmm(2, 1)]); return [p.maxComponentConfidenceBps, p.maxComponentDispersionBps]; }), [[100, 250], [100, 160], [100, 320], [157, 157], [250, 250]]);
const wideDlmm = mimirAutoCompositePolicy({ rows: [component(dlmm(1, 250), 1), component(clmm(2, 1), 2, { maxConfidenceBps: 313, maxSourceActivityAgeSlots: 400 })],
  slotMs: SLOT_MS, priceExponent: -8, converter: { sourceConfig: pool(80), rows: [{ family: "raydium-cpmm", pool: pool(81), poolData: null }], maxConfidenceBps: 300, maxDispersionBps: 120 } });
assert.deepEqual([wideDlmm.policy.maxComponentConfidenceBps, wideDlmm.policy.maxComponentDispersionBps, wideDlmm.policy.maxComponentSnapshotAgeSlots], [313, 313, 400]);
assert.equal(index([clmm(1, 1), clmm(2, 1)], { converter: { sourceConfig: pool(80), rows: [], maxConfidenceBps: 300, maxDispersionBps: 100 } }).maxComponentConfidenceBps, 300);
// Every pool the program can admit is sealed: DLMM 400 → 500, an Orca splash pool (read as 10,000) → 10,000 (the program maximum).
assert.deepEqual([index([dlmm(1, 400), clmm(2, 1)]), index([orca(1, 32_896), clmm(2, 1)])].map((p) => [p.maxComponentConfidenceBps, p.maxComponentDispersionBps]),
  [[500, 500], [100, 10_000]]);
assert.deepEqual(index([dlmm(1, 400), clmm(2, 1)], { overrides: { maxComponentConfidenceBps: 400, maxComponentDispersionBps: 400 } }).maxComponentDispersionBps, 400);
// Row floors are capped at the program maximum, so an index row is never refused for its geometry; a bin step beyond it seals 10,000.
assert.deepEqual(index([dlmm(1, 12_000), clmm(2, 1)]).maxComponentConfidenceBps, 10_000);

// Classic: spot CLMM keeps 100; a wide DLMM bin step lifts confidence; windowed (native) rows get the volatile floor or observed p99 × 2.
const spot = mimirAutoClassicPolicy({ rows: [clmm(1, 120)], slotMs: SLOT_MS, base });
assert.deepEqual({ ...spot.policy, anchorPolicyHash: undefined, nativeExceptionHash: undefined }, { ...base, anchorPolicyHash: undefined, nativeExceptionHash: undefined,
  maxConfidenceBps: 100, maxDispersionBps: 100, maxSnapshotAgeSlots: 188, maxSourceActivityAgeSlots: 65_535, minCoverageRatioBps: 8_000, depthFloorBps: 900 });
assert.deepEqual([125, 200, 250].map((step) => mimirAutoClassicPolicy({ rows: [dlmm(1, step)], slotMs: SLOT_MS, base }).policy.maxConfidenceBps), [157, 250, 313]);
assert.equal(mimirAutoClassicPolicy({ rows: [dlmm(1, 400)], slotMs: SLOT_MS, base }).policy.maxConfidenceBps, 500);
// Only a floor no legal cap admits is refused: a Classic DLMM confidence of 10,000 (bin step ≥ 10,000) above the program's 9,999.
const beyond = mimirAutoClassicPolicy({ rows: [dlmm(1, 12_000)], slotMs: SLOT_MS, base }).policy;
assert.equal(beyond.maxConfidenceBps, 9_999);
assert.throws(() => assertMimirPriceable({ kind: "classic", policy: beyond, rows: [dlmm(1, 12_000)] }),
  (e: unknown) => e instanceof MimirBetaUnpriceableError && /^Source 1 \(meteora-dlmm Pool1\w+\) has a 10000 bps source confidence; this feed allows 9999 bps \(maxConfidenceBps\)/.test(e.explanation));
assert.equal(mimirAutoClassicPolicy({ rows: [dlmm(1, 400)], slotMs: SLOT_MS, base, overrides: { maxConfidenceBps: 450 } }).policy.maxConfidenceBps, 450);
assert.equal(mimirAutoClassicPolicy({ rows: [dlmm(1, 20, "native-bounded")], slotMs: SLOT_MS, base }).policy.maxConfidenceBps, MIMIR_PARAM_MARGINS.windowConfidenceFloorBps);
// Windowed rows with observed |spot − TWAP| / TWAP samples: clamp(ceil(1.5 × p99), max(100, floor + 50), 500).
const memeWidths = Array.from({ length: 1_000 }, (_, i) => i < 989 ? 50 + (i % 400) : 890); // p99 = 890 bps (a volatile meme)
const meme = mimirAutoClassicPolicy({ rows: [dlmm(1, 20, "native-bounded")], slotMs: SLOT_MS, base, observedConfidenceBps: memeWidths });
assert.equal(mimirObservedCapBps(memeWidths), 1_335); assert.equal(meme.policy.maxConfidenceBps, 500);
assert.equal(mimirAutoClassicPolicy({ rows: [dlmm(1, 20, "native-bounded")], slotMs: SLOT_MS, base, observedConfidenceBps: [10, 20, 40] }).policy.maxConfidenceBps, 100);
assert.equal(mimirAutoClassicPolicy({ rows: [dlmm(1, 100, "native-bounded")], slotMs: SLOT_MS, base, observedConfidenceBps: [10, 20, 40] }).policy.maxConfidenceBps, 150);
// Two venues whose observed gap reaches 2.5× the 100 bps default: the dispersion cap follows the gap (p99 × 1.5).
assert.equal(mimirAutoClassicPolicy({ rows: [clmm(1, 1), orca(2, 1)], slotMs: SLOT_MS, base, observedDispersionBps: [80, 150, 250] }).policy.maxDispersionBps, 375);
const twoPools = mimirAutoClassicPolicy({ rows: [clmm(1, 60), clmm(2, 200)], slotMs: SLOT_MS, base, observedDispersionBps: [40, 90, 120] });
assert.deepEqual([twoPools.policy.maxDispersionBps, twoPools.policy.maxConfidenceBps], [250, 100]);
// Price exponent from the observed price: ≥ 6 significant digits after a 100× fall; micro prices never round to mantissa 0.
assert.deepEqual([925.76, 1.63e-6, 4e-9, 150].map(mimirAutoPriceExponent), [-5, -13, -16, -5]);
assert.deepEqual([925.76, 1.63e-6, 4e-9].map((p) => Math.floor(p / 10 ** mimirAutoPriceExponent(p)) >= 1e7), [true, true, true]);
assert.equal(mimirAutoClassicPolicy({ rows: [clmm(1, 1)], slotMs: SLOT_MS, base, observedPrice: 4e-9 }).policy.priceExponent, -16);
assert.throws(() => mimirAutoClassicPolicy({ rows: [clmm(1, 1)], slotMs: SLOT_MS, base, observedPrice: 4e-9, overrides: { priceExponent: -8 } }), /SCALE_UNREPRESENTABLE/);
assert.equal(mimirAutoCompositePolicy({ rows: wallst, slotMs: SLOT_MS, priceExponent: -8 }).policy.priceExponent, -8);

// Fluctuations inside the margins stay priceable.
// (a) Large trade within the window: a spot row's confidence is the fixed 5 bps floor whatever the move; a native row's confidence is the
//     window width J/(1+J), so a +15 % move (1,305 bps) fits the meme's auto cap and not the 100 bps default.
const width = (jump: number) => Math.ceil(jump / (1 + jump) * 10_000);
assertMimirPriceable({ kind: "classic", policy: spot.policy, rows: [clmm(1, 120)] });
assert.ok(width(0.05) <= meme.policy.maxConfidenceBps && width(0.05) > 100);
// (b) Liquidity withdrawal: the sealed depth floor is 9 % of the creation depth, so a 90 % withdrawal stays above it, 92 % does not.
const depth = 2_047_840_816n; const floor = conservativeMintOracleSourceConfigFloor(depth, MIMIR_PARAM_MARGINS.depthFloorBps);
assert.ok(depth / 10n >= floor && depth * 8n / 100n < floor);
// (c) Temporarily quiet pool: never refused for activity age (the u16 maximum, 65,535 slots); the native proof may be 60 s old (engine.rs) and the
//     snapshot age covers 75 s at the measured rate, the fixed 150 slots only 37.5 s at 250 ms.
const quietSlots = Math.ceil(59_000 / 250);
assert.ok(quietSlots > 150 && quietSlots <= mimirAgeSlots(250));
assert.deepEqual([mimirAgeSlots(400), mimirAgeSlots(250), mimirAgeSlots(0.5, 5)], [188, 300, 65_535]);

// Jumps (owner question): confidence = distance to the native window bounds. NOT_READY lasts until the window no longer holds the
// pre-jump price: at least the 120 s minimum span (engine.rs), up to the span in use (≤ 1,800 s, families.rs). Spot rows never widen.
const state = (cap: number, jump: number) => width(jump) > cap ? "NOT_READY ≥120 s" : "priceable";
const table = [0.05, 0.1, 0.2, 0.5].map((jump) => ({ jump: `+${jump * 100}%`, widthBps: width(jump), default100: state(100, jump), autoNoData300: state(300, jump),
  autoMeme500: state(meme.policy.maxConfidenceBps, jump), override2000: state(2_000, jump), spotRow: "priceable (5 bps)" }));
assert.deepEqual(table.map((r) => [r.widthBps, r.default100, r.autoNoData300, r.autoMeme500, r.override2000]), [
  [477, "NOT_READY ≥120 s", "NOT_READY ≥120 s", "priceable", "priceable"], [910, "NOT_READY ≥120 s", "NOT_READY ≥120 s", "NOT_READY ≥120 s", "priceable"],
  [1_667, "NOT_READY ≥120 s", "NOT_READY ≥120 s", "NOT_READY ≥120 s", "priceable"], [3_334, "NOT_READY ≥120 s", "NOT_READY ≥120 s", "NOT_READY ≥120 s", "NOT_READY ≥120 s"]]);
console.table(table);

// The guard refuses rows that can never price, before anything is built.
assert.throws(() => assertMimirPriceable({ kind: "classic", policy: { maxConfidenceBps: 100 }, rows: [clmm(1, 60), dlmm(2, 250)] }),
  (e: unknown) => e instanceof MimirBetaUnpriceableError && e.code === "FEED_UNPRICEABLE" && e.violations.length === 1 && e.violations[0]!.position === 2 &&
    /^Source 2 \(meteora-dlmm Pool2\w+\) has a 250 bps source confidence; this feed allows 100 bps \(maxConfidenceBps\)\. It could never price.*Nothing was sent\.$/.test(e.explanation));
assert.throws(() => assertMimirPriceable({ kind: "classic", policy: { maxConfidenceBps: 30 }, rows: [{ family: "raydium-cpmm", pool: pool(1), poolData: null, recipe: "native-bounded" }] }),
  (e: unknown) => e instanceof MimirBetaUnpriceableError && e.violations[0]!.valueBps === 40);
assert.throws(() => assertMimirPriceable({ kind: "composite", policy: { maxComponentConfidenceBps: 100, maxComponentDispersionBps: 10_000 }, rows: [component(clmm(1, 60), 1)],
  converter: { sourceConfig: pool(80), rows: [dlmm(81, 150)] } }), (e: unknown) => e instanceof MimirBetaCompositeQualityError && e.violations[0]!.role === "converter");
assert.throws(() => assertMimirPriceable({ kind: "composite", policy: { maxComponentConfidenceBps: 100, maxComponentDispersionBps: 100 }, rows: [component({ ...clmm(1, 1), poolData: null }, 1)] }),
  code("CREATION_CONTEXT_REQUIRED"));
// A SOL conversion row is held to the confidence cap only: a CLMM converter needs no pool state (fixed 5 bps), a DLMM one does.
assertMimirPriceable({ kind: "composite", policy: { maxComponentConfidenceBps: 100, maxComponentDispersionBps: 100 }, rows: [component(clmm(1, 60), 1)],
  converter: { sourceConfig: pool(80), rows: [{ ...clmm(81, 500), poolData: null }] } });
assert.throws(() => assertMimirPriceable({ kind: "composite", policy: { maxComponentConfidenceBps: 100, maxComponentDispersionBps: 100 }, rows: [component(clmm(1, 60), 1)],
  converter: { sourceConfig: pool(80), rows: [{ ...dlmm(81, 50), poolData: null }] } }), code("CREATION_CONTEXT_REQUIRED"));

// Overrides: applied within the program bounds, refused outside them or on unknown fields; a cap under a row floor is still refused by the guard.
assert.equal(mimirAutoCompositePolicy({ rows: wallst, slotMs: SLOT_MS, priceExponent: -8, overrides: { maxComponentDispersionBps: 130, maxSnapshotAgeSlots: 300 } }).policy.maxComponentDispersionBps, 130);
assert.throws(() => mimirAutoCompositePolicy({ rows: wallst, slotMs: SLOT_MS, priceExponent: -8, overrides: { maxComponentDispersionBps: 10_001 } }),
  (e: unknown) => e instanceof MimirBetaError && e.code === "INVALID_ARGUMENT" && /maxComponentDispersionBps=10001 is outside the program range 0\.\.10000/.test(e.message));
assert.throws(() => mimirAutoClassicPolicy({ rows: [clmm(1, 1)], slotMs: SLOT_MS, base, overrides: { maxConfidenceBps: 10_000 } }), /1\.\.9999/);
assert.throws(() => mimirAutoClassicPolicy({ rows: [clmm(1, 1)], slotMs: SLOT_MS, base, overrides: { maxSourceActivityAgeSlots: 4 } }), /5\.\.65535/);
assert.throws(() => mimirAutoClassicPolicy({ rows: [clmm(1, 1)], slotMs: SLOT_MS, base, overrides: { riskTier: 2 } as never }), /not an overridable parameter/);
const lowered = mimirAutoCompositePolicy({ rows: wallst, slotMs: SLOT_MS, priceExponent: -8, overrides: { maxComponentDispersionBps: 100 } }).policy;
assert.throws(() => assertMimirPriceable({ kind: "composite", policy: lowered, rows: wallst }), code("COMPOSITE_QUALITY_INCOMPATIBLE"));

// Slot duration: the fastest recent performance sample; no sample, no ages.
const samples = (rows: { numSlots: number; samplePeriodSecs: number }[]) => ({ getRecentPerformanceSamples: () => ({ send: async () => rows }) });
assert.equal(await mimirMeasureSlotMs(samples([{ numSlots: 150, samplePeriodSecs: 60 }, { numSlots: 160, samplePeriodSecs: 60 }, { numSlots: 0, samplePeriodSecs: 60 }])), 375);
await assert.rejects(mimirMeasureSlotMs(samples([])), code("CREATION_CONTEXT_REQUIRED"));
assert.throws(() => mimirAgeSlots(Number.NaN), code("CREATION_CONTEXT_REQUIRED"));
console.log("auto params: WALLST →", auto.policy, "widened by", auto.widenedBy);
