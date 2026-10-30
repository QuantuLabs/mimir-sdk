import assert from "node:assert/strict";
import { MARKET_RULES, MARKET_STANDARD_VOLATILE, marketFit, normalizeSolToUsdc6, scoreFeed, type MarketFitCohort, type MarketFitDefinition,
  type MarketFitIntent } from "../../src/easy/index.js";

// FIT.md §5 vectors. B: two spot sources; N: single native proof; PT: current point D=100; SA: sampled F=100.
type Case = { d: MarketFitDefinition; c: MarketFitCohort; i: MarketFitIntent };
const target = { program: true, layout: true, lifecycle: true };
// A read, bound source: liquidity, condition word and binding are evidence, never assumed.
const SRC = { liquidity: 1n, condition: 0, binding: true } as const;
// Authenticated FeedOI headroom (primary and SOL conversion): evidence, never assumed.
const OI = { feedOiHeadroomUsdc6: 1_000_000_000_000n, conversionOiHeadroomUsdc6: 1_000_000_000_000n };
const pub = { qualifiedSources: 2, qualifiedVenues: 2, coverageBps: 10_000, dispersionBps: 0, confBps: 5, ageSlots: 0 };
const B = (): Case => ({
  d: { kind: "classic", quote: "USDC", variant: 0, rows: [0, 0].map((mode) => ({ mode, confBps: 5, depthNative: 10_000_000_000n, floorNative: 9_000_000_000n, ...SRC })) },
  c: { target, capacity: { ...OI }, publication: { ...pub } },
  i: { policy: { maxDispersionBps: 200, minCoverageBps: 5000, deviationBps: 50, minSources: 2, minVenues: 1, ageSlots: 10 }, seedUsdc: 25_000, tradeUsdc: 50 } });
const single = (mode: number, adapterType = 3): Case => ({
  d: { kind: "classic", quote: "USDC", variant: 0, rows: [{ mode, adapterType, ...({ 2: { temporalKind: 0 }, 4: { temporalKind: 4 }, 5: { temporalKind: 5 } }[mode] ?? {}), confBps: 1, depthNative: 10_000_000_000n, floorNative: 9_000_000_000n, ...SRC }] },
  c: { target, capacity: { ...OI }, history: { supportSec: 600, rawSpanSec: 600, records: 20 },
    publication: { qualifiedSources: 1, qualifiedVenues: 1, coverageBps: 10_000, dispersionBps: 0, confBps: 5, ageSlots: 0, proofValid: true } },
  i: { policy: { maxDispersionBps: 50, minCoverageBps: 9000, deviationBps: 50, minSources: 1, minVenues: 1, ageSlots: 10 }, seedUsdc: 25_000, tradeUsdc: 50 } });
const N = () => single(2);
// A new feed: its market has no usage yet (input completion; an existing market's usage is evidence).
const PT = (): Case => { const k = single(5); k.c.existing = false; k.c.capacity = { ...OI, d50Usdc6: 100_000_000n }; k.i = { ...k.i, profile: { minActivationUsdc: 1, minPositionUsdc: 1 }, tradeUsdc: 1 }; return k; };
const SA = (): Case => { const k = single(4); k.c.existing = false; k.c.capacity = { ...OI, floorUsdc6: 100_000_000n }; k.i = { ...k.i, profile: { minActivationUsdc: 1, minPositionUsdc: 1 }, tradeUsdc: 1 }; return k; };
const run = (k: Case) => marketFit(k.d, k.c, k.i);
const status = (k: Case, rules: unknown) => { const r = marketFit(k.d, k.c, k.i, rules as never); return [r.status, r.reason]; };
const is = (k: Case, status: string, reason: string, label: string) => {
  const r = run(k);
  assert.deepEqual([r.status, r.reason], [status, reason], `${label}: ${JSON.stringify([r.failures, r.missing])}`);
  return r;
};
const ready = (k: Case, label: string) => is(k, "ready", "READY_PROJECTED", label);
const no = (k: Case, reason: string, label: string) => is(k, "not-as-is", reason, label);
const edit = (k: Case, f: (k: Case) => void) => { f(k); return k; };
let n = 0; const t = (label: string, f: () => void) => { f(); n++; void label; };

t("V01", () => ready(B(), "V01"));
t("V02", () => no(edit(B(), (k) => { k.d.rows = [k.d.rows[0]!]; }), "RECIPE_UNSUPPORTED", "V02"));
t("V03", () => ready(edit(N(), (k) => { k.c.publication!.confBps = 100; }), "V03"));
t("V04", () => {
  const r = no(edit(N(), (k) => { k.c.publication!.confBps = 101; delete k.c.publication!.ageSlots; }), "CONFIDENCE", "V04");
  assert.ok(r.missing.includes("MISSING_CLOCK"));
});
t("V05", () => is(edit(N(), (k) => { delete k.c.publication!.confBps; }), "unknown", "MISSING_BOUNDS", "V05"));
t("V06", () => ready(edit(N(), (k) => { k.c.publication!.confBps = 125; k.i.profile = MARKET_STANDARD_VOLATILE; k.i.policy!.feedMaxConfBps = 200; }), "V06"));
t("V07", () => no(edit(N(), (k) => { k.c.publication!.confBps = 125; k.i.profile = { imBps: 200, mmBps: 100, maxConfBps: 200, stalenessSec: 2 }; }), "RISK_PROFILE", "V07"));
t("V08", () => no(edit(N(), (k) => { k.c.history!.supportSec = 119; }), "HISTORY_NOT_READY", "V08"));
t("V09", () => ready(edit(N(), (k) => { k.c.history!.supportSec = 120; }), "V09"));
t("V10", () => no(edit(single(2, 2), (k) => { k.c.history!.rawSpanSec = 120; }), "HISTORY_NOT_READY", "V10"));
t("V11", () => {
  no(edit(N(), (k) => { k.i.policy!.minCoverageBps = 8999; }), "POLICY_INVALID", "V11 coverage");
  no(edit(N(), (k) => { k.i.policy!.maxDispersionBps = 51; }), "POLICY_INVALID", "V11 dispersion");
});
t("V12", () => ready(edit(N(), (k) => { k.c.publication!.coverageBps = 9000; }), "V12"));
t("V13", () => ready(edit(B(), (k) => { k.c.publication!.dispersionBps = 200; }), "V13"));
t("V14", () => no(edit(B(), (k) => { k.c.publication!.dispersionBps = 201; }), "DISPERSION", "V14"));
t("V15", () => ready(edit(B(), (k) => { for (const r of k.d.rows as { depthNative?: bigint; floorNative?: bigint }[]) { r.depthNative = 1_000_000n; r.floorNative = 1_000_000n; } }), "V15"));
t("V16", () => no(edit(B(), (k) => { (k.d.rows[0] as { depthNative?: bigint }).depthNative = 999_999n; (k.d.rows[0] as { floorNative?: bigint }).floorNative = 1_000_000n; }), "SOURCE_DEPTH", "V16"));
t("V17", () => no(edit(B(), (k) => { k.c.publication!.qualifiedSources = 1; }), "QUORUM", "V17"));
t("V18", () => ready(edit(B(), (k) => { k.c.publication!.qualifiedVenues = 1; }), "V18"));
t("V19", () => is(edit(B(), (k) => { k.c.existing = true; k.c.publication!.ageSlots = 2; }), "ready", "READY_VERIFIED", "V19"));
t("V20", () => no(edit(B(), (k) => { k.c.existing = true; k.c.publication!.ageSlots = 3; }), "STALE", "V20"));
t("V21", () => {
  is(edit(B(), (k) => { k.c.existing = true; Object.assign(k.c.publication!, { ageSlots: 8, stored: true }); }), "ready", "READY_VERIFIED", "V21 8");
  no(edit(B(), (k) => { k.c.existing = true; Object.assign(k.c.publication!, { ageSlots: 9, stored: true }); }), "STALE", "V21 9");
});
t("V22", () => no(edit(PT(), (k) => { Object.assign(k.c.publication!, { ageSlots: 1, stored: true }); }), "STALE", "V22"));
t("V23", () => {
  ready(edit(B(), (k) => { k.i.seedUsdc = 500; }), "V23 500");
  no(edit(B(), (k) => { k.i.seedUsdc = 499.999999; }), "ACTIVATION_CAPACITY", "V23 499.999999");
});
t("V24", () => {
  ready(edit(PT(), (k) => { k.i.tradeUsdc = 300; }), "V24 300");
  no(edit(PT(), (k) => { k.i.tradeUsdc = 301; }), "TRADE_CAPACITY", "V24 301");
});
t("V25", () => no(edit(PT(), (k) => { k.i.usedMarketUsdc = 1000; }), "TRADE_CAPACITY", "V25"));
t("V26", () => {
  ready(edit(SA(), (k) => { k.i.tradeUsdc = 10; k.i.sharedUsdc = 25; }), "V26 10/25");
  no(edit(SA(), (k) => { k.i.tradeUsdc = 11; }), "TRADE_CAPACITY", "V26 11");
  no(edit(SA(), (k) => { k.i.tradeUsdc = 10; k.i.sharedUsdc = 26; }), "OI_CAPACITY", "V26 shared 26");
});
t("V27", () => {
  const F = normalizeSolToUsdc6(1_000_000_000n, 100n << 64n);
  assert.equal(F, 100_000_000n);
  assert.equal(run(edit(SA(), (k) => { k.c.capacity = { ...OI, floorUsdc6: F }; })).limits.positionCapUsdc6, 10_000_000n);
  assert.equal(run(edit(PT(), (k) => { k.c.capacity = { ...OI, d50Usdc6: F }; k.i.tradeUsdc = 300; })).limits.positionCapUsdc6, 300_000_000n);
});
t("V28", () => no(edit(B(), (k) => { k.d.variant = 1; k.c.feedOi = { admitted: false }; }), "FEED_OI_UNADMITTED", "V28"));
t("V29", () => no(edit(B(), (k) => { k.d = { ...k.d, kind: "composite", cfcMaxConfBps: 200, cfcMaxDispersionBps: 100 }; }), "POLICY_INVALID", "V29"));
t("V30", () => {
  no(edit(B(), (k) => { k.c.target = { ...target, program: false }; }), "TARGET_PROGRAM", "V30 owner");
  no(edit(B(), (k) => { k.c.target = { ...target, layout: false }; }), "LAYOUT_VERSION", "V30 layout");
  is(edit(B(), (k) => { delete k.c.target; }), "unknown", "MISSING_TARGET", "V30 uninspected");
});
t("V31", () => {
  const r = is({ d: { kind: "classic", quote: "USDC", variant: 0, rows: [{ mode: 0, confBps: 5 }, { mode: 0, confBps: 5 }] }, c: { target }, i: {} },
    "unknown", "MISSING_POLICY", "V31");
  assert.ok(r.missing.includes("MISSING_PUBLICATION"));
  const s = scoreFeed({ pools: [{ exchange: "Orca", depth50Usdc: 10_000, mode: 0, confBps: 5 }, { exchange: "Meteora", depth50Usdc: 10_000, mode: 0, confBps: 5 }] })!;
  assert.deepEqual([s.fitVerdict.status, s.marketFit.fit], ["unknown", null]);
});
const V = n;

// JUP DLMM/SOL C8Gr…NNwg: bin step 80, one exchange; J2/J3 are conditional on a full native publication.
const jup = (): Case => edit(N(), (k) => { k.d.quote = "SOL"; k.d.rows = [{ ...k.d.rows[0]!, confBps: 80 }]; k.c.publication!.confBps = 80;
  k.c.converter = { valid: true, fresh: true, condition: 0, confBps: 5, dispersionBps: 0 }; k.c.capacity = { ...OI, converterUsdc6: 10_000_000_000n }; });
t("J1", () => {
  const r = is({ d: { kind: "classic", quote: "SOL", variant: 0, rows: [{ mode: 2, adapterType: 3, temporalKind: 0, confBps: 80 }] }, c: { target }, i: {} }, "unknown", "MISSING_POLICY", "J1");
  for (const m of ["MISSING_HISTORY", "MISSING_CONVERTER", "MISSING_PUBLICATION"] as const) assert.ok(r.missing.includes(m), m);
});
t("J2", () => assert.equal(ready(jup(), "J2").limits.confBps, 86));
t("J3", () => assert.equal(no(edit(jup(), (k) => { k.c.converter = { valid: true, fresh: true, condition: 0, confBps: 20, dispersionBps: 0 }; }), "CONFIDENCE", "J3").limits.confBps, 101));
t("converter", () => {
  no(edit(jup(), (k) => { k.c.converter = null; }), "CONVERTER_REQUIRED", "no converter selected");
  is(edit(jup(), (k) => { delete k.c.converter; }), "unknown", "MISSING_CONVERTER", "converter not inspected");
});

// Scorer findings: known conf over the ceiling fails; point rows keep source order; invalid numbers never reach the score.
const p = (o: object) => ({ exchange: "Meteora", depth50Usdc: 10_000, ...o });
t("A2", () => {
  const s = scoreFeed({ pools: [p({ confBps: 125 })] })!;
  assert.deepEqual([s.score, s.marketFit.fit, s.fitVerdict.reason], [57, false, "CONFIDENCE"]);
  assert.equal(scoreFeed({ pools: [p({ confBps: 125, mode: 2 })] })!.score, 57);
  assert.equal(scoreFeed({ pools: [p({ confBps: 100 })] })!.marketFit.fit, null);
});
t("A6", () => {
  const s = scoreFeed({ pools: [p({ mode: 5 }), p({ mode: 5, depth50Usdc: 1000 })] })!;
  assert.deepEqual([s.costToMove, s.score], [10_000, 57]);
  assert.equal(scoreFeed({ pools: [p({ mode: 0, feePpm: 100 }), p({ mode: 0, depth50Usdc: 1000, feePpm: 100 })] })!.costToMove, 1000);
});
t("A13", () => {
  for (const bad of [NaN, Infinity, -1]) {
    const s = scoreFeed({ pools: [p({ trades24h: bad })] })!;
    assert.deepEqual([s.score, s.factors.activity], [57, 0.5], `trades ${bad}`);
  }
  for (const capBps of [Infinity, NaN, 0, -1]) assert.equal(scoreFeed({ pools: [p({}), p({ exchange: "Orca" })], capBps }), null, `cap ${capBps}`);
  assert.equal(scoreFeed({ pools: [p({})], marketMaxConfBps: NaN }), null);
  assert.equal(scoreFeed({ pools: [p({ confBps: NaN })] })!.fitVerdict.status, "unknown");
  assert.equal(scoreFeed({ pools: [p({ feePpm: NaN }), p({ depth50Usdc: 1000, feePpm: 5 })] })!.costToMove, 1000);
  assert.ok(Number.isFinite(scoreFeed({ pools: [p({ lastTradeMin: Infinity, trades24h: 100 })] })!.score));
});
t("F2 multi-pool proven conf", () => {
  no(edit(B(), (k) => { for (const r of k.d.rows as { confBps?: number }[]) r.confBps = 125; }), "CONFIDENCE", "F2 [125,125]");
  assert.equal(run(edit(B(), (k) => { (k.d.rows[0] as { confBps?: number }).confBps = 125; })).status, "ready", "F2 [125,5]");
  assert.equal(scoreFeed({ pools: [p({ confBps: 125, mode: 2 }), p({ exchange: "Orca", confBps: 125, mode: 2 })] })!.marketFit.fit, false);
});
t("F3 DUAL 3·D50", () => {
  const dual = () => edit(N(), (k) => { (k.d.rows[0] as { temporalKind?: number }).temporalKind = 6; k.c.existing = false; k.c.capacity = { ...OI, d50Usdc6: 10_000_000n }; });
  // Activation is clamped to the normalized cap too: min(12,500, 30) < 250.
  const r = no(dual(), "ACTIVATION_CAPACITY", "F3 activation 30 < 250");
  assert.ok(r.failures.includes("TRADE_CAPACITY") && r.missing.includes("MISSING_CAPACITY"), "F3 trade 50 > 30; DUAL native arm cap unknown");
  assert.deepEqual([r.limits.positionCapUsdc6, r.limits.activationDepthUsdc6], [30_000_000n, 30_000_000n]);
  ready(edit(dual(), (k) => { k.c.capacity = { ...OI, d50Usdc6: 100_000_000n, positionUsdc6: 300_000_000n }; k.i.profile = { minActivationUsdc: 1, minPositionUsdc: 1 }; }), "F3 native arm cap known");
  is(edit(dual(), (k) => { k.c.capacity = { ...OI }; k.i.profile = { minPositionUsdc: 1 }; }), "unknown", "MISSING_CAPACITY", "F3 no D50");
});
t("F4 tuple not guessed", () => {
  const a = run(edit(single(2, 2), (k) => { delete (k.d.rows[0] as { adapterType?: number }).adapterType; delete k.c.history!.rawSpanSec; }));
  assert.deepEqual([a.status, a.reason], ["unknown", "MISSING_RECIPE"]);
  const b = run(edit(N(), (k) => { delete (k.d.rows[0] as { temporalKind?: number }).temporalKind; Object.assign(k.i.policy!, { minCoverageBps: 5000, maxDispersionBps: 200 }); }));
  assert.deepEqual([b.status, b.reason], ["unknown", "MISSING_RECIPE"]);
  assert.equal(scoreFeed({ pools: [p({ mode: 2, adapterType: 7 })] })!.fitVerdict.status, "unknown");
  const cpmm = scoreFeed({ pools: [p({ mode: 2, adapterType: 2, temporalKind: 0 })], fit: { cohort: { history: { supportSec: 120 } } } })!;
  assert.ok(cpmm.fitVerdict.missing.includes("MISSING_HISTORY") && !cpmm.fitVerdict.missing.includes("MISSING_RECIPE"));
});
t("F5 non-finite", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    for (const f of ["qualifiedSources", "coverageBps", "confBps", "ageSlots", "dispersionBps"] as const)
      assert.notEqual(run(edit(B(), (k) => { (k.c.publication as Record<string, number>)[f] = bad; })).status, "ready", `pub ${f} ${bad}`);
    for (const f of ["seedUsdc", "tradeUsdc", "usedMarketUsdc"] as const) {
      const r = run(edit(PT(), (k) => { (k.i as Record<string, number>)[f] = bad; }));
      assert.deepEqual([r.status, r.reason], ["unknown", "MISSING_MARKET_TERMS"], `${f} ${bad}`);
    }
    assert.doesNotThrow(() => scoreFeed({ pools: [p({})], fit: { intent: { seedUsdc: bad, tradeUsdc: bad } } }));
    assert.equal(run(edit(B(), (k) => { k.i.profile = { maxPositionUsdc: bad }; })).status, "not-as-is");
  }
});
t("R2-1 non-finite policy/history/converter/profile", () => {
  const notReady = (k: Case, label: string) => {
    const r = run(k);
    assert.notEqual(r.status, "ready", label);
    assert.ok(Object.values(r.limits).every((v) => typeof v !== "number" || Number.isFinite(v)), `${label} limits`);
  };
  for (const f of ["maxDispersionBps", "minCoverageBps", "deviationBps", "minSources", "minVenues", "ageSlots", "feedMaxConfBps"] as const)
    no(edit(B(), (k) => { (k.i.policy as Record<string, number>)[f] = NaN; }), "POLICY_INVALID", `policy ${f}`);
  for (const f of ["supportSec", "rawSpanSec", "records"] as const)
    is(edit(f === "rawSpanSec" ? single(2, 2) : f === "records" ? SA() : N(), (k) => { (k.c.history as Record<string, number>)[f] = NaN; }), "unknown", "MISSING_HISTORY", `history ${f}`);
  is(edit(jup(), (k) => { k.c.converter!.confBps = NaN; }), "unknown", "MISSING_BOUNDS", "converter conf");
  for (const f of ["imBps", "stalenessSec", "maxConfBps"] as const)
    notReady(edit(B(), (k) => { k.i.profile = { [f]: NaN }; }), `profile ${f}`);
  no(edit(B(), (k) => { k.i.profile = { imBps: NaN }; }), "POLICY_INVALID", "profile imBps");
});
t("R2-2 fractional profile term", () => {
  for (const profile of [{ kappaBps: 100.5 }, { maxTraderOiBps: 0.5 }]) {
    const s = scoreFeed({ pools: [p({})], fit: { intent: { seedUsdc: 25_000, tradeUsdc: 50, profile } } })!;
    assert.ok(s.fitVerdict.failures.includes("POLICY_INVALID"), JSON.stringify(profile));
  }
});
t("R2-3 composite skew required", () => {
  const c = () => edit(B(), (k) => { k.d = { ...k.d, kind: "composite", cfcMaxConfBps: 5, cfcMaxDispersionBps: 100 }; });
  is(c(), "unknown", "MISSING_CLOCK", "R2-3 no skew");
  no(edit(c(), (k) => { k.c.publication!.componentSkewSlots = 3; }), "COMPONENT_SKEW", "R2-3 skew 3");
  ready(edit(c(), (k) => { k.c.publication!.componentSkewSlots = 2; }), "R2-3 skew 2");
});
t("R3-1 non-finite composite policy, row condition", () => {
  for (const d of [{ cfcMaxConfBps: NaN, cfcMaxDispersionBps: 100 }, { cfcMaxConfBps: 5, cfcMaxDispersionBps: NaN }, { cfcMaxConfBps: 5.5 }])
    is(edit(B(), (k) => { k.d = { ...k.d, kind: "composite", ...d }; k.c.publication!.componentSkewSlots = 0; }), "unknown", "MISSING_POLICY", JSON.stringify(d));
  no(edit(B(), (k) => { k.d.rows[0]!.condition = 1; }), "SOURCE_CONDITION", "condition 1");
  for (const c of [NaN, -1, 0.5]) is(edit(B(), (k) => { k.d.rows[0]!.condition = c; }), "unknown", "MISSING_BINDING", `invalid condition ${c} = not inspected`);
  ready(edit(B(), (k) => { k.d.rows[0]!.condition = 0; }), "condition 0");
});
t("R3-2 huge finite USDC term", () => {
  for (const f of ["seedUsdc", "tradeUsdc", "usedMarketUsdc", "sharedUsdc"] as const)
    is(edit(PT(), (k) => { (k.i as Record<string, number>)[f] = Number.MAX_VALUE; }), "unknown", "MISSING_MARKET_TERMS", f);
  for (const f of ["maxPositionUsdc", "minActivationUsdc"] as const)
    no(edit(B(), (k) => { k.i.profile = { [f]: Number.MAX_VALUE }; }), "POLICY_INVALID", f);
  const s = scoreFeed({ pools: [p({})], fit: { intent: { seedUsdc: Number.MAX_VALUE, tradeUsdc: 50, profile: { maxPositionUsdc: Number.MAX_VALUE } } } })!;
  assert.ok(s.fitVerdict.failures.includes("POLICY_INVALID") && s.fitVerdict.missing.includes("MISSING_MARKET_TERMS"));
});
t("R3-3 profile checked without market terms; integer policy", () => {
  for (const profile of [{ kappaBps: 100.5 }, { kappaBps: NaN }])
    no(edit(B(), (k) => { delete k.i.seedUsdc; k.i.profile = profile; }), "POLICY_INVALID", JSON.stringify(profile));
  for (const f of ["maxDispersionBps", "minCoverageBps", "deviationBps", "minSources", "minVenues", "ageSlots", "feedMaxConfBps"] as const)
    no(edit(B(), (k) => { (k.i.policy as Record<string, number>)[f] = ((k.i.policy as Record<string, number>)[f] ?? 99) + 0.5; }), "POLICY_INVALID", `fractional ${f}`);
  ready(B(), "default profile");
});
// Counterexamples (each was Ready or threw before the fix).
t("C1 converter freshness", () => {
  is(edit(jup(), (k) => { k.c.converter = { valid: true, confBps: 5 }; }), "unknown", "MISSING_CONVERTER", "fresh not proved");
  no(edit(jup(), (k) => { k.c.converter = { valid: true, fresh: false, confBps: 5 }; }), "EXPIRED", "expired, refresh not ready");
});
t("C2 null vs unread", () => {
  for (const f of ["liquidity", "condition", "binding"] as const) {
    const r = run(edit(B(), (k) => { delete (k.d.rows[0] as Record<string, unknown>)[f]; }));
    assert.equal(r.status, "unknown", `${f} unread`);
  }
  no(edit(B(), (k) => { k.d.rows[0]!.liquidity = null; }), "SOURCE_LIQUIDITY", "liquidity known absent");
  no(edit(B(), (k) => { k.d.rows[0]!.condition = null; }), "SOURCE_CONDITION", "condition known absent");
  no(edit(B(), (k) => { k.d.rows[0]!.binding = false; }), "SOURCE_CONDITION", "binding refused");
});
t("C5 activation clamped to the normalized cap", () => {
  no(edit(B(), (k) => { k.i.seedUsdc = 500; k.i.tradeUsdc = 0; k.c.capacity = { ...OI, positionUsdc6: 1_000_000n }; }), "ACTIVATION_CAPACITY", "band, 1 USDC cap");
  no(edit(PT(), (k) => { k.i.seedUsdc = 10; k.i.tradeUsdc = 0.1; k.c.capacity = { ...OI, d50Usdc6: 166_666n }; }), "ACTIVATION_CAPACITY", "point 3·D50 0.499998 < 1");
});
t("C6 profile", () => {
  for (const profile of [{ mmBps: 500 }, { mmBps: NaN }, { imBps: 500.5 }, { kappaBps: 10_001 }, { kappaBps: 0 }, { stalenessSec: 0 }, { maxTraderOiBps: 10_001 },
    { collateral: "gold" }, { maxPositionUsdc: 2 ** 44 }, { minActivationUsdc: 0 }])
    no(edit(B(), (k) => { k.i.profile = profile as never; }), "POLICY_INVALID", JSON.stringify(profile));
  no(edit(B(), (k) => { k.i.profile = { imBps: 600, mmBps: 300 }; }), "RISK_PROFILE", "inadmissible margin pair");
  ready(edit(N(), (k) => { k.i.profile = { imBps: 200, mmBps: 100, maxConfBps: 100, stalenessSec: 2 }; }), "high-leverage pair within bounds");
  // FAIL beats MISSING: a bad profile is reported even with nothing else supplied.
  assert.equal(marketFit({ kind: "classic", rows: [{ mode: 2 }] }, {}, { profile: { mmBps: 900 } }).status, "not-as-is");
});
t("C7 numbers", () => {
  const bad = [NaN, Infinity, -1, 0.5, Number.MAX_VALUE, "1" as never];
  for (const v of bad) {
    assert.equal(run(edit(B(), (k) => { k.d.variant = v; k.c.feedOi = { admitted: true }; })).status, "unknown", `variant ${String(v)}`);
    assert.notEqual(run(edit(B(), (k) => { (k.c.publication as Record<string, unknown>).qualifiedSources = v; })).status, "ready", `sources ${String(v)}`);
    assert.notEqual(run(edit(B(), (k) => { (k.c.publication as Record<string, unknown>).coverageBps = v === 0.5 ? 10_001 : v; })).status, "ready", `coverage ${String(v)}`);
    no(edit(B(), (k) => { k.c.publication!.ageSlots = 9; }), "STALE", "age 9 > 2");
    assert.deepEqual(status(edit(B(), (k) => { k.c.publication!.ageSlots = 9; }), { ...MARKET_RULES, age: { ...MARKET_RULES.age, liveSlots: v } }),
      ["not-as-is", "POLICY_INVALID"], `rules age ${String(v)}`);
  }
  for (const v of [-1n, 1n << 64n, 0.5, NaN, Infinity, 100]) {
    assert.notEqual(run(edit(B(), (k) => { (k.d.rows[0] as Record<string, unknown>).floorNative = v; })).status, "ready", `floor ${String(v)}`);
    for (const f of ["d50Usdc6", "positionUsdc6", "marketUsdc6"]) {
      const r = run(edit(PT(), (k) => { (k.c.capacity as Record<string, unknown>)[f] = v; }));
      assert.ok(r.status !== "ready" || f !== "d50Usdc6", `${f} ${String(v)}`);
    }
  }
  for (const rules of [null, {}, { ...MARKET_RULES, recipes: [null] }] as never[]) assert.equal(marketFit(B().d, B().c, B().i, rules).reason, "POLICY_INVALID");
  for (const args of [[null, null, null], [{ kind: "classic" }, 5, "x"], [{ kind: "classic", rows: [null, 3] }]] as never[][])
    assert.doesNotThrow(() => (marketFit as (...a: unknown[]) => unknown)(...args));
  for (const slot of [5, NaN, -1, 1.5, "x"]) assert.doesNotThrow(() => scoreFeed({ pools: [p({ depthSlot: 1n }), p({ depthSlot: 3 as never })], slot: slot as never }));
  assert.equal(scoreFeed({ pools: [p({ depthSlot: 1n })], slot: 100 as never })!.costToMove, 10_000, "numeric slot accepted");
  assert.equal(scoreFeed({ pools: [p({ depthSlot: 1n })], slot: NaN as never }), null, "NaN slot");
});
t("C9 single proof shape", () => {
  no(edit(N(), (k) => { delete k.c.publication; k.i.policy!.minSources = 2; }), "POLICY_INVALID", "native, minSources 2, no publication");
  no(edit(single(3, 2, ), (k) => { k.d.rows = [{ ...k.d.rows[0]!, temporalKind: 1 }]; Object.assign(k.i.policy!, { minCoverageBps: 5000, maxDispersionBps: 200 }); }),
    "POLICY_INVALID", "interval, coverage 5000 / dispersion 200");
  ready(edit(single(3, 2), (k) => { k.d.rows = [{ ...k.d.rows[0]!, temporalKind: 1 }]; }), "interval, 9000 / 50");
  no(edit(N(), (k) => { k.c.publication!.qualifiedVenues = 2; k.i.policy!.minVenues = 1; }), "QUORUM", "single proof publishes 1/1");
});
t("C10 composite dispersion required", () => {
  const c = () => edit(B(), (k) => { k.d = { ...k.d, kind: "composite", cfcMaxConfBps: 100 }; k.c.publication!.componentSkewSlots = 0; });
  is(c(), "unknown", "MISSING_POLICY", "omitted");
  no(edit(c(), (k) => { k.d.cfcMaxDispersionBps = 201; }), "POLICY_INVALID", "201 > 200");
  ready(edit(c(), (k) => { k.d.cfcMaxDispersionBps = 200; }), "200");
});
// Counterexamples (each was Ready or threw before the fix).
t("D3 SOL converter cap", () => {
  is(edit(jup(), (k) => { k.c.capacity = { ...OI }; }), "unknown", "MISSING_CAPACITY", "converter cap not proved");
  const r = no(edit(jup(), (k) => { k.c.capacity = { ...OI, converterUsdc6: 1_000_000n }; }), "ACTIVATION_CAPACITY", "F/10 = 1 USDC");
  assert.ok(r.failures.includes("TRADE_CAPACITY"));
  ready(edit(PT(), (k) => { k.d.quote = "SOL"; k.c.converter = { valid: true, fresh: true, condition: 0, confBps: 1, dispersionBps: 0 }; }), "live point: no converter cap");
});
t("D4 converted dispersion", () => {
  no(edit(jup(), (k) => { k.c.converter = { valid: true, fresh: true, condition: 0, confBps: 51, dispersionBps: 51 }; k.i.profile = MARKET_STANDARD_VOLATILE; }), "DISPERSION", "0 ⊕ 51 > 50 (conf 132 ≤ 300)");
  is(edit(jup(), (k) => { delete k.c.converter!.dispersionBps; }), "unknown", "MISSING_BOUNDS", "converter dispersion uninspected");
});
t("D5 point adapter tuple", () => {
  for (const a of [undefined, NaN]) is(edit(PT(), (k) => { k.d.rows[0]!.adapterType = a as never; }), "unknown", "MISSING_RECIPE", `adapter ${a}`);
  is(edit(PT(), (k) => { delete k.d.rows[0]!.temporalKind; }), "unknown", "MISSING_RECIPE", "temporal kind unread");
  no(edit(PT(), (k) => { k.d.rows[0]!.adapterType = 2; }), "RECIPE_UNSUPPORTED", "CPMM point");
});
t("D6 existing market usage", () => {
  const low = () => edit(PT(), (k) => { k.c.capacity = { ...OI, d50Usdc6: 1_000_000n }; k.i = { ...k.i, seedUsdc: 20, tradeUsdc: 2 }; });
  is(edit(low(), (k) => { k.c.existing = true; }), "unknown", "MISSING_CAPACITY", "existing, usage unread");
  is(edit(low(), (k) => { delete k.c.existing; }), "unknown", "MISSING_CAPACITY", "unknown market, usage unread");
  no(edit(low(), (k) => { k.c.existing = true; k.i.usedMarketUsdc = 9; }), "TRADE_CAPACITY", "9 + 2 > 10");
  ready(low(), "new feed: no usage");
  is(edit(SA(), (k) => { k.c.existing = true; }), "unknown", "MISSING_CAPACITY", "sampled shared OI unread");
});
t("D7 invalid caps", () => {
  for (const v of [500_000, NaN, -1n, null, "1"]) for (const f of ["positionUsdc6", "marketUsdc6", "converterUsdc6"])
    is(edit(PT(), (k) => { (k.c.capacity as Record<string, unknown>)[f] = v; k.i.seedUsdc = 10; }), "unknown", "MISSING_CAPACITY", `${f} ${String(v)}`);
});
t("D8 zero trade", () => {
  for (const tradeUsdc of [0, 0.0000004]) no(edit(PT(), (k) => { k.i = { ...k.i, seedUsdc: 10, tradeUsdc }; }), "TRADE_CAPACITY", `trade ${tradeUsdc}`);
});
t("D10 quorum independent", () => {
  no(edit(N(), (k) => { k.c.publication!.qualifiedSources = 0; delete k.c.publication!.coverageBps; }), "QUORUM", "0 sources, coverage unread");
  no(edit(B(), (k) => { k.c.publication!.coverageBps = 1; delete k.c.publication!.qualifiedVenues; }), "COVERAGE", "coverage known, venues unread");
});
t("D11 target per field", () => {
  const r = is(edit(B(), (k) => { k.c.target = { layout: true, lifecycle: true }; }), "unknown", "MISSING_TARGET", "program uninspected");
  assert.deepEqual(r.failures, []);
  is(edit(B(), (k) => { k.c.target = { program: true, lifecycle: true, layout: "x" as never }; }), "unknown", "MISSING_LAYOUT_PROJECTION", "layout invalid");
  no(edit(B(), (k) => { k.c.target = { program: false }; }), "TARGET_PROGRAM", "program refused, rest uninspected");
});
t("D12 rules schema", () => {
  for (const bad of [{ converterRecipes: undefined }, { converterRecipes: [{ adapterType: 3 }] }, { feedOi: { permissionless: "invalid" } },
    { recipes: [{ mode: 5, kind: 5, adapters: ["x"] }] }, { quotes: { classic: ["EUR"], composite: ["USDC"] } }, { terms: { band: {}, point: {} } }, { mimirProgram: 1 }])
    assert.deepEqual(status(PT(), { ...MARKET_RULES, ...bad }), ["not-as-is", "POLICY_INVALID"], JSON.stringify(bad));
});
t("D13 no throw", () => {
  for (const bad of [Symbol("x"), JSON.parse('{"valueOf":null,"toString":null}')])
    for (const f of ["deviationBps", "minSources", "maxDispersionBps", "ageSlots"])
      assert.deepEqual(status(edit(PT(), (k) => { (k.i.policy as Record<string, unknown>)[f] = bad; }), undefined), ["not-as-is", "POLICY_INVALID"], f);
  for (const args of [[1n, 1n, -1], [1n, 1n, 1.5], [-1n, 1n], [1n, 1n << 128n], [1, 1n]] as never[][])
    assert.equal((normalizeSolToUsdc6 as (...a: unknown[]) => unknown)(...args), undefined, JSON.stringify(args.map(String)));
});
t("D14 scoreFeed forwards the caller's definition", () => {
  const k = edit(PT(), (k) => { k.i.seedUsdc = 10; });
  const pools = [{ exchange: "Pumpswap", depth50Usdc: 1000, mode: 5, adapterType: 6, temporalKind: 5, confBps: 1 }];
  const a = scoreFeed({ pools, quote: "USDC", fit: { definition: k.d, cohort: k.c, intent: k.i } })!;
  const b = scoreFeed({ pools, quote: "USDC", fit: { definition: k.d, cohort: { ...k.c, target: { ...target, program: false } }, intent: k.i } })!;
  assert.deepEqual([a.fitVerdict.status, a.marketFit.fit, b.marketFit.fit, a.score], ["ready", true, false, b.score]);
  assert.deepEqual(a.fitVerdict, marketFit(k.d, k.c, k.i));
});
// Round 3 (84d40d65 was Ready or threw on each).
t("E1 converter refresh condition", () => {
  is(edit(jup(), (k) => { delete k.c.converter!.condition; }), "unknown", "MISSING_CONVERTER", "fresh without its depth/vault evidence");
  for (const c of [32, null]) no(edit(jup(), (k) => { k.c.converter!.condition = c; }), "CONVERTER_INVALID", `condition ${c}`);
});
t("E2 FeedOI headroom", () => {
  is(edit(B(), (k) => { delete k.c.capacity; }), "unknown", "MISSING_OI", "primary headroom unread");
  is(edit(jup(), (k) => { delete k.c.capacity!.conversionOiHeadroomUsdc6; }), "unknown", "MISSING_OI", "conversion headroom unread");
  is(edit(jup(), (k) => { k.c.capacity!.conversionOiHeadroomUsdc6 = -1n; }), "unknown", "MISSING_OI", "conversion headroom invalid");
  no(edit(B(), (k) => { k.c.capacity!.feedOiHeadroomUsdc6 = 49_999_999n; }), "OI_CAPACITY", "primary full");
  no(edit(jup(), (k) => { k.c.existing = true; k.c.capacity!.conversionOiHeadroomUsdc6 = 49_999_999n; }), "OI_CAPACITY", "conversion full");
  ready(edit(B(), (k) => { k.c.capacity!.feedOiHeadroomUsdc6 = 50_000_000n; }), "headroom = trade");
});
t("E3 minimum position", () => {
  // BAND rule at seed 500: usable min(10000, 50000, 500 × 1000 / 10000 = 50) → minimum 10, activation 50.
  no(edit(B(), (k) => { k.i.seedUsdc = 500; k.i.tradeUsdc = 1; }), "TRADE_CAPACITY", "1 < 10 at seed 500");
  ready(edit(B(), (k) => { k.i.seedUsdc = 500; k.i.tradeUsdc = 10; }), "10 at seed 500");
  no(edit(B(), (k) => { k.i.tradeUsdc = 49.999999; }), "TRADE_CAPACITY", "seed 25000: minimum 50");
  no(edit(B(), (k) => { k.i.profile = { minPositionUsdc: 100 }; }), "TRADE_CAPACITY", "profile minimum 100");
  is(edit(PT(), (k) => { k.i.profile = { minActivationUsdc: 1 }; }), "unknown", "MISSING_MARKET_TERMS", "point: no default minimum");
  for (const m of [0, 10_001, -1, NaN]) no(edit(B(), (k) => { k.i.profile = { minPositionUsdc: m }; }), "POLICY_INVALID", `minimum ${m}`);
  // The rule's activation raises a lower profile minimum: 5 × 50 = 250 at seed 25000.
  assert.ok(run(edit(B(), (k) => { k.i.profile = { minActivationUsdc: 1 }; k.c.capacity!.positionUsdc6 = 249_999_999n; })).failures.includes("ACTIVATION_CAPACITY"), "rule activation");
  assert.deepEqual(status(B(), { ...MARKET_RULES, minPosition: undefined }), ["not-as-is", "POLICY_INVALID"], "rule absent");
});
t("E4 FAIL before MISSING", () => {
  no(edit(jup(), (k) => { k.c.publication!.confBps = 400; delete k.c.converter!.confBps; }), "CONFIDENCE", "primary conf 400 > 300, converter bound absent");
  no(edit(jup(), (k) => { k.c.publication!.dispersionBps = 60; delete k.c.converter!.dispersionBps; }), "DISPERSION", "primary dispersion 60 > 50");
});
t("E5 no throw", () => {
  assert.equal(marketFit(B().d, B().c, B().i, { ...MARKET_RULES, revision: Object.create(null) } as never).rules, "");
  for (const mode of [Symbol("m"), Object.create(null), "3"])
    assert.equal(scoreFeed({ pools: [{ exchange: "x", depth50Usdc: 1000, mode: mode as never }] })!.marketFit.eligible, null);
});
console.log(`marketFit OK: ${V} V vectors (FIT V01-V31), ${n - V} more (J1-J3, converter, cases 2/6/13)`);
