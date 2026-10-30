import assert from "node:assert/strict";
import { MARKET_RULES, MARKET_STANDARD_VOLATILE, marketFit, type MarketFitCohort, type MarketFitDefinition, type MarketFitIntent,
  type MarketRules } from "../../src/easy/index.js";
import { MIMIR_V1_FEED_IMAGE_LEN, MIMIR_V1_PLAN_IMAGE_LEN } from "../../src/v1/build.js";
import { CLASSIC_OWNER } from "../../src/v1/layout/classic.js";
import { MIMIR_CLASSIC_ADMITTED_CONVERTER_RECIPES } from "../../src/beta/classicExecution.js";

// SPEC §6a L1 vectors (R1–R6) plus the capacity / afterCreation / recipe additions.
type Case = { d: MarketFitDefinition; c: MarketFitCohort; i: MarketFitIntent };
const target = { program: true, layout: true, lifecycle: true };
// A read, bound source: liquidity, condition word and binding are evidence, never assumed.
const SRC = { liquidity: 1n, condition: 0, binding: true } as const;
// Authenticated FeedOI headroom (primary and SOL conversion): evidence, never assumed.
const OI = { feedOiHeadroomUsdc6: 1_000_000_000_000n, conversionOiHeadroomUsdc6: 1_000_000_000_000n };
const B = (): Case => ({
  d: { kind: "classic", quote: "USDC", variant: 0, rows: [0, 0].map((mode) => ({ mode, confBps: 5, depthNative: 10_000_000_000n, floorNative: 9_000_000_000n, ...SRC })) },
  c: { target, capacity: { ...OI }, publication: { qualifiedSources: 2, qualifiedVenues: 2, coverageBps: 10_000, dispersionBps: 0, confBps: 5, ageSlots: 0 } },
  i: { policy: { maxDispersionBps: 200, minCoverageBps: 5000, deviationBps: 50, minSources: 2, minVenues: 1, ageSlots: 10 }, seedUsdc: 25_000, tradeUsdc: 50 } });
const single = (mode: number, adapterType = 3, temporalKind?: number): Case => ({
  d: { kind: "classic", quote: "USDC", variant: 0, rows: [{ mode, adapterType, ...(temporalKind != null ? { temporalKind } : ({ 2: { temporalKind: 0 }, 4: { temporalKind: 4 }, 5: { temporalKind: 5 } }[mode] ?? {})),
    confBps: 1, depthNative: 10_000_000_000n, floorNative: 9_000_000_000n, ...SRC }] },
  c: { target, existing: false, capacity: { ...OI }, history: { supportSec: 600, rawSpanSec: 600, records: 20 },
    publication: { qualifiedSources: 1, qualifiedVenues: 1, coverageBps: 10_000, dispersionBps: 0, confBps: 5, ageSlots: 0, proofValid: true } },
  i: { policy: { maxDispersionBps: 50, minCoverageBps: 9000, deviationBps: 50, minSources: 1, minVenues: 1, ageSlots: 10 }, seedUsdc: 25_000, tradeUsdc: 50 } });
const N = () => single(2);
const PT = (): Case => { const k = single(5); k.c.capacity = { ...OI, d50Usdc6: 100_000_000n }; k.i = { ...k.i, profile: { minActivationUsdc: 1, minPositionUsdc: 1 }, tradeUsdc: 1 }; return k; };
const edit = (k: Case, f: (k: Case) => void) => { f(k); return k; };
const fit = (k: Case, rules?: MarketRules) => marketFit(k.d, k.c, k.i, rules);
const status = (k: Case, rules?: MarketRules) => { const r = fit(k, rules); return [r.status, r.reason]; };
const withRules = (f: (r: { -readonly [K in keyof MarketRules]: MarketRules[K] }) => void): MarketRules => {
  const r = structuredClone({ ...MARKET_RULES, converterRecipes: [...MARKET_RULES.converterRecipes] }) as { -readonly [K in keyof MarketRules]: MarketRules[K] };
  f(r); return r;
};

// R1: explicit default rules = no rules argument.
for (const k of [B, N, PT, () => single(5, 3), () => single(4, 3), () => single(2, 3, 6), () => edit(B(), (k) => { k.d.variant = 1; k.c.feedOi = { admitted: false }; })])
  assert.deepEqual(fit(k(), MARKET_RULES), fit(k()), "R1 default rules");
// R2: FeedOI admission is data.
const v28 = () => edit(B(), (k) => { k.d.variant = 1; k.c.feedOi = { admitted: false }; });
assert.deepEqual(status(v28()), ["not-as-is", "FEED_OI_UNADMITTED"]);
assert.deepEqual(status(v28(), withRules((r) => { r.feedOi = { permissionless: "any" }; })), ["ready", "READY_PROJECTED"], "R2");
// R3: market max confidence is data.
const v06 = () => edit(N(), (k) => { k.c.publication!.confBps = 125; k.i.profile = MARKET_STANDARD_VOLATILE; k.i.policy!.feedMaxConfBps = 200; });
assert.deepEqual(status(v06()), ["ready", "READY_PROJECTED"]);
const tight = withRules((r) => { r.profiles = { ...r.profiles, volatile: { ...r.profiles.volatile, maxConfBps: 120 } }; });
assert.deepEqual(status(edit(v06(), (k) => { k.i.profile = tight.profiles.volatile; }), tight), ["not-as-is", "CONFIDENCE"], "R3");
// R4: minimum support is data (and the CPMM raw span follows it + 14 s).
const slow = withRules((r) => { r.history = { ...r.history, minSupportSec: 180 }; });
assert.deepEqual(status(edit(N(), (k) => { k.c.history!.supportSec = 150; })), ["ready", "READY_PROJECTED"]);
assert.deepEqual(status(edit(N(), (k) => { k.c.history!.supportSec = 150; }), slow), ["not-as-is", "HISTORY_NOT_READY"], "R4");
assert.deepEqual(status(edit(single(2, 2), (k) => { k.c.history!.rawSpanSec = 190; }), slow), ["not-as-is", "HISTORY_NOT_READY"], "R4 raw span");
// R5: SDK V1 layout constants = rules.layout.
assert.deepEqual([MARKET_RULES.layout.configImageBytes, MARKET_RULES.layout.planImageBytes, MARKET_RULES.layout.prefixBytes],
  [MIMIR_V1_FEED_IMAGE_LEN, MIMIR_V1_PLAN_IMAGE_LEN, CLASSIC_OWNER], "R5");
assert.equal(MARKET_RULES.converterRecipes, MIMIR_CLASSIC_ADMITTED_CONVERTER_RECIPES, "converter list reused");
// R6: verdict names the rules revision.
assert.equal(fit(N()).rules, "87607828");
assert.equal(fit(N(), withRules((r) => { r.revision = "next"; })).rules, "next");

// Authenticated caps are intersected with 3× / 10× D50, never a replacement (mixed_bounded.rs:34-35).
const capped = fit(edit(PT(), (k) => { k.c.capacity = { ...OI, d50Usdc6: 100_000_000n, positionUsdc6: 500_000n, marketUsdc6: 2_000_000n }; }));
assert.deepEqual([capped.status, capped.failures, capped.limits.positionCapUsdc6, capped.limits.marketCapUsdc6],
  ["not-as-is", ["ACTIVATION_CAPACITY", "TRADE_CAPACITY"], 500_000n, 2_000_000n], "0.5 USDC cap: activation 0.5 < 1, trade 1 > 0.5");
const over = fit(edit(PT(), (k) => { k.c.capacity = { ...OI, d50Usdc6: 100_000_000n, positionUsdc6: 500_000_000n }; k.i.tradeUsdc = 301; }));
assert.deepEqual([over.reason, over.limits.positionCapUsdc6], ["TRADE_CAPACITY", 300_000_000n], "a 500 cap does not lift 3·D50 = 300");
assert.deepEqual(status(edit(PT(), (k) => { k.c.capacity = { ...OI, positionUsdc6: 2_000_000n, marketUsdc6: 2_000_000n }; })), ["unknown", "MISSING_CAPACITY"], "point needs the live D50");
// afterCreation: interval history is checked only after creation.
const interval = () => edit(single(3, 2, 1), (k) => { k.c.history = { afterCreation: true }; });
assert.deepEqual(status(interval()), ["unknown", "MISSING_HISTORY"]);
assert.deepEqual(status(edit(interval(), (k) => { k.c.history = { supportSec: 600, afterCreation: true }; })), ["unknown", "MISSING_HISTORY"]);
// Recipe tuples: known parts only.
assert.deepEqual(status(single(3, 3, 1)), ["not-as-is", "RECIPE_UNSUPPORTED"], "DLMM is not a quiet-interval adapter");
assert.deepEqual(status(edit(single(3, 2, 1), (k) => { delete (k.d.rows[0] as { adapterType?: number }).adapterType; })), ["unknown", "MISSING_RECIPE"], "unknown adapter of a constrained recipe is missing, never ready");
assert.deepEqual(status(edit(single(5, 4), (k) => { k.i.profile = { minPositionUsdc: 1 }; })), ["unknown", "MISSING_CAPACITY"]);
assert.deepEqual(status(edit(single(5, 4), (k) => { k.c.capacity = { ...OI, d50Usdc6: 100_000_000n }; k.i = { ...k.i, profile: { minActivationUsdc: 1, minPositionUsdc: 1 }, tradeUsdc: 1 }; }),
  withRules((r) => { r.recipes = r.recipes.filter((x) => x.mode !== 5); })), ["not-as-is", "RECIPE_UNSUPPORTED"], "a removed recipe is data");
console.log("marketRules OK: R1-R6, caps, afterCreation, recipes");
