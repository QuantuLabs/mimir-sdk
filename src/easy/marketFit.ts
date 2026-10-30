import { MARKET_RULES, MARKET_STANDARD_STABLE, MARKET_STANDARD_VOLATILE, type MarketRules } from "./marketRules.js";

/**
 * Market fit: can this feed back a lending market as created, under a named profile?
 * Pure. Each check is PASS, FAIL (a known fact breaks a rule) or MISSING (the fact was not supplied). Any FAIL → "not-as-is";
 * else any MISSING → "unknown"; else "ready". A missing fact is never guessed from a score.
 */

/** Stable reason codes, in decision order. */
export const MARKET_FIT_FAIL = ["TARGET_PROGRAM", "LAYOUT_VERSION", "FEED_KIND", "LIFECYCLE",
  "RECIPE_UNSUPPORTED", "RISK_PROFILE", "POLICY_INVALID",
  "QUOTE_UNSUPPORTED", "CONVERTER_REQUIRED", "CONVERTER_INVALID", "FEED_OI_UNADMITTED",
  "SOURCE_DEPTH", "SOURCE_LIQUIDITY", "SOURCE_CONDITION", "HISTORY_NOT_READY", "QUORUM", "COVERAGE",
  "CONFIDENCE", "DISPERSION", "STALE", "EXPIRED", "PROOF_INVALID", "COMPONENT_SKEW",
  "ACTIVATION_CAPACITY", "TRADE_CAPACITY", "OI_CAPACITY"] as const;
export const MARKET_FIT_MISSING = ["MISSING_TARGET", "MISSING_LAYOUT_PROJECTION",
  "MISSING_RECIPE", "MISSING_POLICY",
  "MISSING_CONVERTER", "MISSING_OI",
  "MISSING_SOURCE_DEPTH", "MISSING_BINDING", "MISSING_HISTORY", "MISSING_PUBLICATION",
  "MISSING_BOUNDS", "MISSING_CLOCK", "MISSING_PROOF",
  "MISSING_MARKET_TERMS", "MISSING_CAPACITY"] as const;
export type MarketFitFailure = typeof MARKET_FIT_FAIL[number];
export type MarketFitMissing = typeof MARKET_FIT_MISSING[number];
export type MarketFitReason = MarketFitFailure | MarketFitMissing | "READY_PROJECTED" | "READY_VERIFIED";

/** Market terms the verdict refers to. */
export type MarketProfile = {
  name: string;
  imBps: number; mmBps: number;
  /** Market max confidence (parent cap = min(feed max, this)). */
  maxConfBps: number;
  stalenessSec: number;
  collateral: "stable" | "volatile";
  /** BAND+VAULT LP cap: floor(equity × min(kappa, maxTraderOi) / 10000), and the policy max position. */
  kappaBps: number; maxTraderOiBps: number; maxPositionUsdc: number;
  minActivationUsdc: number;
  /** Market minimum position: an Open below it fails. Absent: the BAND rule
   * `MARKET_RULES.minPosition` at the seed; point, sampled and DUAL have no default (MISSING_MARKET_TERMS). */
  minPositionUsdc?: number;
};

export { MARKET_STANDARD_STABLE, MARKET_STANDARD_VOLATILE };
export const MARKET_DEFAULT_PROFILE = MARKET_STANDARD_STABLE;

export type MarketFitRow = {
  /** 0/1/6 spot, 2 native-bounded, 3 interval, 4 sampled, 5 point. */
  mode?: number;
  /** 6 = DUAL (with mode 2). */
  temporalKind?: number;
  adapterType?: number;
  /** Row confidence (a lower bound of the publication's when the row is necessarily included). */
  confBps?: number;
  /** Recipe-bound D50 and the sealed source floor, in quote native atoms. */
  depthNative?: bigint; floorNative?: bigint;
  /** Undefined: not read. Null: the source is known absent. */
  liquidity?: bigint | null;
  /** Source condition bits; nonzero or null (known absent) fails, undefined is not inspected. */
  condition?: number | null;
  /** The source account was read and is the planned program's account (true), known absent or another account (false), not read (undefined). */
  binding?: boolean;
};

export type MarketFitDefinition = {
  kind: "classic" | "composite";
  /** Undefined: not known (the converter need is then missing). */
  quote?: string;
  rows: readonly MarketFitRow[];
  /** Classic variant (u16): 0 canonical (permissionless FeedOI), other values are governed. */
  variant?: number;
  /** Composite CFC configured maxima: both required. */
  cfcMaxConfBps?: number; cfcMaxDispersionBps?: number;
};

export type MarketFitCohort = {
  /** Owner/program, wire layout and lifecycle (active CORE, no notice) checks, each: false fails, anything else is not inspected. */
  target?: { program?: boolean; layout?: boolean; lifecycle?: boolean };
  /** True for an existing feed (READY_VERIFIED), else a projection (READY_PROJECTED). */
  existing?: boolean;
  /** Governed variants: admin admission of the FeedOI. */
  feedOi?: { admitted: boolean };
  /** SOL quote: the embedded SOL/USDC converter, or null when none is selected.
   * `valid` = identity, ACTIVE lifecycle, every row in `rules.converterRecipes`, canonical id, USDC quote.
   * `fresh` = its refresh in the trade transaction is ready, from authenticated reads of its own sources; false = known not ready (EXPIRED);
   * undefined = not proved (MISSING).
   * `condition` = the condition bits that refresh stamps from the sources' bin arrays and vaults (depth/liquidity below the sealed floor,
   * vault shortfall or frozen): 0 passes, nonzero or null (known absent) is CONVERTER_INVALID, undefined is MISSING_CONVERTER.
   * `confBps` / `dispersionBps`: its publication's bounds, composed with the primary's (both required). */
  converter?: { valid: boolean; fresh?: boolean; condition?: number | null; confBps?: number; dispersionBps?: number } | null;
  /** Native/interval/sampled support. `rawSpanSec` is the CPMM native opening span. */
  history?: { supportSec?: number; rawSpanSec?: number; records?: number; afterCreation?: true };
  /** Projected (or read) publication. Symmetric bounds. */
  publication?: { qualifiedSources?: number; qualifiedVenues?: number; coverageBps?: number; dispersionBps?: number; confBps?: number;
    ageSlots?: number; stored?: boolean; proofValid?: boolean; componentSkewSlots?: number };
  /** Authenticated capacity in USDC6 (u64). Point/DUAL: `d50Usdc6` = live D50 (position 3×, market 10×); sampled: `floorUsdc6` = F (F/10, F/4).
   * `positionUsdc6` / `marketUsdc6`: other authenticated caps, always intersected, never a replacement; DUAL needs `positionUsdc6` (its native arm).
   * `converterUsdc6`: the SOL converter's cap (F/10 of its floor), required for a SOL quote unless live point. A supplied invalid cap is MISSING_CAPACITY.
   * `feedOiHeadroomUsdc6` (always) and `conversionOiHeadroomUsdc6` (SOL quote: the converter's FeedOI, shared by every SOL-quoted market): what an
   * Open may still add, min(min(limit, budget, F/4 off live point) − risk, budget − total) as the market reads it.
   * Absent or invalid is MISSING_OI; a new feed's FeedOI does not exist yet, so only the caller knows it. */
  capacity?: { d50Usdc6?: bigint; floorUsdc6?: bigint; positionUsdc6?: bigint; marketUsdc6?: bigint; converterUsdc6?: bigint;
    feedOiHeadroomUsdc6?: bigint; conversionOiHeadroomUsdc6?: bigint };
};

export type MarketFitIntent = {
  profile?: Partial<MarketProfile>;
  policy?: { feedMaxConfBps?: number; maxDispersionBps: number; minCoverageBps: number; deviationBps: number;
    minSources: number; minVenues: number; ageSlots: number };
  seedUsdc?: number; tradeUsdc?: number;
  /** Point: market notional already used; sampled: shared notional after the trade. Unknown is MISSING_CAPACITY, except for a new feed
   * (`cohort.existing === false`): no usage, shared = this trade. */
  usedMarketUsdc?: number; sharedUsdc?: number;
};

export type MarketFitVerdict = {
  status: "ready" | "not-as-is" | "unknown";
  reason: MarketFitReason;
  failures: MarketFitFailure[];
  missing: MarketFitMissing[];
  profile: MarketProfile;
  /** The rules revision checked against. */
  rules: string;
  limits: { parentMaxConfBps: number; confBps: number | null; activationDepthUsdc6: bigint | null; positionCapUsdc6: bigint | null;
    marketCapUsdc6: bigint | null };
};

const SPOT = new Set([0, 1, 6]);
const U8 = 0xff, U16 = 0xffff, U32 = 0xffff_ffff, U64 = (1n << 64n) - 1n, U128 = (1n << 128n) - 1n;
/** Unsigned integer ≤ max. */
const uint = (x: unknown, max = Number.MAX_SAFE_INTEGER): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= max;
const pos = (x: unknown, max?: number): x is number => uint(x, max) && x > 0;
const big = (x: unknown, max = U64): x is bigint => typeof x === "bigint" && x >= 0n && x <= max;
/** USDC amount whose USDC6 value is an exact integer below 2^53. */
const money = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x * 1e6 <= Number.MAX_SAFE_INTEGER;
const usdc6 = (x: number) => BigInt(Math.round(x * 1e6));
const min = (xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
const obj = <T extends object>(o: unknown): T | undefined => (o && typeof o === "object" ? o as T : undefined);
/** Evidence object with each listed field kept only when valid (invalid = not supplied); null and undefined pass through. */
const clean = <T extends object>(o: T | null | undefined, valid: Record<string, (x: unknown) => boolean>): T | null | undefined =>
  o === null || o === undefined ? o : typeof o !== "object" ? undefined
    : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, valid[k] && v != null && !valid[k]!(v) ? undefined : v])) as T;
const u8 = (x: unknown): x is number => uint(x, U8), u16 = (x: unknown): x is number => uint(x, U16);
const bps = (x: unknown): x is number => uint(x, 10_000), u = (x: unknown): x is number => uint(x), u64 = (x: unknown): x is bigint => big(x);
/** Every number the evaluator reads from the rules object; a malformed rules object is POLICY_INVALID. */
function rulesValid(r: MarketRules): boolean {
  try {
    const { deviationBps: d, singleProof: s, history: h, age: a, margins: m, highRisk: x, layout: l, terms: t } = r;
    const quotes = (q: unknown, ok: string[]) => Array.isArray(q) && q.every((v) => ok.includes(v));
    return [d.min, d.max, d.market, s.deviationBps, s.maxDispersionBps, m.imBps, m.mmBps, x.imBps, x.mmBps, x.maxConfBps].every(u16) && bps(s.minCoverageBps)
      && [h.minSupportSec, h.minSampledRecords, a.liveSlots, a.storedSlots, a.componentSkewSlots, x.maxStalenessSec].every(u)
      && [l.snapshotVersion, l.prefixBytes, l.configImageVersion, l.configImageBytes, l.planImageBytes].every(u)
      && typeof r.revision === "string" && typeof r.mimirProgram === "string" && quotes(r.quotes.classic, ["USDC", "SOL"]) && quotes(r.quotes.composite, ["USDC"])
      && Array.isArray(r.recipes) && r.recipes.every((x) => obj(x) && u8(x.mode) && u8(x.kind) && (x.adapters == null || (Array.isArray(x.adapters) && x.adapters.every(u8))))
      && Array.isArray(r.converterRecipes) && r.converterRecipes.every((x) => obj(x) && u8(x.adapterType) && u16(x.adapterVersion) && u8(x.mode))
      && (r.feedOi.permissionless === "canonical" || r.feedOi.permissionless === "any")
      && [t.band.seedUsdc, t.band.tradeUsdc, t.point.seedUsdc, t.point.tradeUsdc, r.minPosition.maxUsdc, r.minPosition.feedOiLimitUsdc].every(money)
      && pos(r.minPosition.usableBps, 10_000)
      && !!obj(r.profiles.stable) && !!obj(r.profiles.volatile);
  } catch { return false; }
}

/** Composed confidence of two symmetric bounds, rounded outward: a + b + ceil(a·b / 10000). */
export const composeConfBps = (a: number, b: number) => a + b + Math.ceil(a * b / 10_000);

/** Native SOL atoms → USDC6 at the converter's lower bound (Q64): floor(native · lower · 1e6 / (10^decimals · 2^64)).
 * Undefined (never a throw) when `native` / `lowerX64` is not a u64 / u128 BigInt or `decimals` not an integer 0..18. */
export const normalizeSolToUsdc6 = (native: bigint, lowerX64: bigint, decimals = 9): bigint | undefined =>
  big(native) && big(lowerX64, U128) && uint(decimals, 18) ? native * lowerX64 * 1_000_000n / (10n ** BigInt(decimals) << 64n) : undefined;

export function marketFit(definition: MarketFitDefinition, cohort: MarketFitCohort = {}, intent: MarketFitIntent = {},
  rules: MarketRules = MARKET_RULES): MarketFitVerdict {
  const d = obj<MarketFitDefinition>(definition) ?? ({} as MarketFitDefinition);
  const co = obj<MarketFitCohort>(cohort) ?? {}, it = obj<MarketFitIntent>(intent) ?? {};
  const fail = new Set<MarketFitFailure>(), miss = new Set<MarketFitMissing>();
  const limits: MarketFitVerdict["limits"] = { parentMaxConfBps: 0, confBps: null, activationDepthUsdc6: null, positionCapUsdc6: null, marketCapUsdc6: null };
  const done = (profile: MarketProfile, revision: string): MarketFitVerdict => {
    const failures = MARKET_FIT_FAIL.filter((r) => fail.has(r)), missing = MARKET_FIT_MISSING.filter((r) => miss.has(r));
    const status = failures.length ? "not-as-is" : missing.length ? "unknown" : "ready";
    const reason = failures[0] ?? missing[0] ?? (co.existing === true ? "READY_VERIFIED" : "READY_PROJECTED");
    return { status, reason, failures, missing, profile, rules: revision, limits };
  };
  if (!obj(rules) || !rulesValid(rules)) {
    fail.add("POLICY_INVALID");
    const revision = obj<MarketRules>(rules)?.revision;
    return done({ ...MARKET_STANDARD_STABLE, ...obj<Partial<MarketProfile>>(it.profile) }, typeof revision === "string" ? revision : "");
  }
  const profile: MarketProfile = { ...rules.profiles.stable, ...obj<Partial<MarketProfile>>(it.profile) };
  const rowsKnown = Array.isArray(d.rows);
  const rows: MarketFitRow[] = rowsKnown ? d.rows.map((r) => clean(obj<MarketFitRow>(r) ?? {}, { mode: u8, temporalKind: u8, adapterType: u8 })!) : [];
  const pol = obj<NonNullable<MarketFitIntent["policy"]>>(it.policy);
  const pub = clean(obj<NonNullable<MarketFitCohort["publication"]>>(co.publication), { qualifiedSources: u8, qualifiedVenues: u8, coverageBps: bps,
    dispersionBps: u16, confBps: u16, ageSlots: u, componentSkewSlots: u });
  const h = clean(obj<NonNullable<MarketFitCohort["history"]>>(co.history), { supportSec: u, rawSpanSec: u, records: u });
  const converter = co.converter === null ? null : clean(obj<NonNullable<MarketFitCohort["converter"]>>(co.converter), { confBps: u16, dispersionBps: u16,
    condition: (x) => uint(x, U32) });
  const profileMax = pos(profile.maxConfBps, 10_000) ? profile.maxConfBps : 0;
  const polOk = !!pol && [pol.maxDispersionBps, pol.deviationBps].every(u16) && bps(pol.minCoverageBps) && [pol.minSources, pol.minVenues].every(u8)
    && u16(pol.ageSlots) && (pol.feedMaxConfBps == null || pos(pol.feedMaxConfBps, 10_000));
  const parentMaxConfBps = limits.parentMaxConfBps = Math.min(polOk && pol!.feedMaxConfBps != null ? pol!.feedMaxConfBps : profileMax, profileMax);

  // 1. Target, layout, kind, lifecycle.
  const target = obj<NonNullable<MarketFitCohort["target"]>>(co.target);
  for (const [k, f, m] of [["program", "TARGET_PROGRAM", "MISSING_TARGET"], ["layout", "LAYOUT_VERSION", "MISSING_LAYOUT_PROJECTION"],
    ["lifecycle", "LIFECYCLE", "MISSING_TARGET"]] as const) {
    if (target?.[k] === false) fail.add(f);
    else if (target?.[k] !== true) miss.add(m);
  }
  if (!rowsKnown) miss.add("MISSING_RECIPE");
  else if (rows.length < 1 || rows.length > 5) fail.add("FEED_KIND");

  // 2. Recipe, risk profile, policy.
  const modes = rows.map((r) => r.mode);
  const single = rows.length === 1, m0 = modes[0];
  const point = modes.includes(5), sampled = modes.includes(4);
  // A row's tuple is known when every part the market constrains for its mode is: spot needs the mode, others the temporal kind and,
  // when a recipe of that mode lists adapters, the adapter.
  const rowKnown = (r: MarketFitRow) => r.mode != null && (SPOT.has(r.mode)
    || (r.temporalKind != null && (r.adapterType != null || !rules.recipes.some((x) => x.mode === r.mode && x.adapters))));
  const tupleKnown = rowsKnown && rows.every(rowKnown);
  const dual = tupleKnown && single && m0 === 2 && rows[0]!.temporalKind === 6;
  // Single-source proof policy (the market's single-source flag): one native-bounded row, or interval rows only.
  const singleProof = tupleKnown && !dual && rows.length > 0 && ((single && m0 === 2) || modes.every((m) => m === 3));
  if (!tupleKnown) miss.add("MISSING_RECIPE");
  else if (single && SPOT.has(m0!)) fail.add("RECIPE_UNSUPPORTED");
  if (rows.some((r) => rowKnown(r) && !rules.recipes.some((x) => x.mode === r.mode && ((SPOT.has(r.mode!) && r.temporalKind == null) || x.kind === r.temporalKind)
      && (!x.adapters || (r.adapterType != null && x.adapters.includes(r.adapterType)))))) fail.add("RECIPE_UNSUPPORTED");
  const marginShape = bps(profile.imBps) && bps(profile.mmBps) && profile.mmBps < profile.imBps;
  const profileOk = marginShape && profileMax > 0 && pos(profile.stalenessSec) && pos(profile.kappaBps, 10_000) && pos(profile.maxTraderOiBps, 10_000)
    && money(profile.maxPositionUsdc) && usdc6(profile.maxPositionUsdc) > 0n && usdc6(profile.maxPositionUsdc) <= 1n << 44n
    && money(profile.minActivationUsdc) && usdc6(profile.minActivationUsdc) > 0n && (profile.collateral === "stable" || profile.collateral === "volatile")
    && typeof profile.name === "string" && (profile.minPositionUsdc === undefined || (money(profile.minPositionUsdc) && usdc6(profile.minPositionUsdc) > 0n
      && money(profile.maxPositionUsdc) && usdc6(profile.minPositionUsdc) <= usdc6(profile.maxPositionUsdc)));
  if (!profileOk) fail.add("POLICY_INVALID");
  const hr = rules.highRisk, std = rules.margins;
  if (marginShape && !(profile.imBps === std.imBps && profile.mmBps === std.mmBps) && !(profile.imBps === hr.imBps && profile.mmBps === hr.mmBps
      && profileMax <= hr.maxConfBps && pos(profile.stalenessSec) && profile.stalenessSec <= hr.maxStalenessSec)) fail.add("RISK_PROFILE");
  if (d.kind === "composite") {
    const cc = d.cfcMaxConfBps, cd = d.cfcMaxDispersionBps;
    if (!u16(cc) || !u16(cd)) miss.add("MISSING_POLICY");
    if ((u16(cc) && cc > parentMaxConfBps) || (u16(cd) && polOk && cd > pol!.maxDispersionBps)) fail.add("POLICY_INVALID");
  } else if (d.kind !== "classic") fail.add("FEED_KIND");
  if (!pol) miss.add("MISSING_POLICY");
  else {
    if (!polOk) fail.add("POLICY_INVALID");
    else if (pol.deviationBps < rules.deviationBps.min || pol.deviationBps > rules.deviationBps.max || pol.maxDispersionBps <= 0 || pol.ageSlots <= 0
        || pol.minSources < 1 || pol.minVenues < 1) fail.add("POLICY_INVALID");
    // Single proof: counts 1/1/1, coverage, dispersion and deviation, each checked on its own.
    if (polOk && singleProof && (rows.length !== 1 || pol.minSources !== 1 || pol.minVenues !== 1 || pol.minCoverageBps < rules.singleProof.minCoverageBps
        || pol.maxDispersionBps > rules.singleProof.maxDispersionBps || pol.deviationBps !== rules.singleProof.deviationBps)) fail.add("POLICY_INVALID");
  }

  // 3. Quote, converter, FeedOI.
  const sol = d.quote === "SOL";
  if (d.quote == null) miss.add("MISSING_CONVERTER");
  else if (!(d.kind === "composite" ? rules.quotes.composite : rules.quotes.classic).includes(d.quote as "USDC")) fail.add("QUOTE_UNSUPPORTED");
  if (sol) {
    if (converter === null) fail.add("CONVERTER_REQUIRED");
    else if (!converter || typeof converter.valid !== "boolean") miss.add("MISSING_CONVERTER");
    else if (!converter.valid) fail.add("CONVERTER_INVALID");
    else if (converter.condition === null || (uint(converter.condition, U32) && converter.condition !== 0)) fail.add("CONVERTER_INVALID");
    else if (converter.fresh === false) fail.add("EXPIRED");
    else if (converter.fresh !== true || converter.condition !== 0) miss.add("MISSING_CONVERTER");
  }
  // FeedOI headroom: the primary's, and the conversion FeedOI's for a SOL quote.
  const capIn = co.capacity == null ? {} : obj<Record<string, unknown>>(co.capacity);
  const head = (k: string) => (u64(capIn?.[k]) ? capIn![k] as bigint : undefined);
  const oiHeads = [head("feedOiHeadroomUsdc6"), ...(sol ? [head("conversionOiHeadroomUsdc6")] : [])];
  if (oiHeads.includes(undefined)) miss.add("MISSING_OI");
  if (d.kind === "classic") {
    const feedOi = obj<NonNullable<MarketFitCohort["feedOi"]>>(co.feedOi);
    if (!uint(d.variant, U16)) miss.add("MISSING_OI");
    else if (d.variant !== 0 && rules.feedOi.permissionless !== "any") {
      if (typeof feedOi?.admitted !== "boolean") miss.add("MISSING_OI");
      else if (!feedOi.admitted) fail.add("FEED_OI_UNADMITTED");
    }
  }

  // 4. Sources (null = known absent, undefined = not read), history, quorum, coverage.
  for (const r of rows) {
    if (!big(r.depthNative) || !big(r.floorNative)) miss.add("MISSING_SOURCE_DEPTH");
    else if (r.depthNative < r.floorNative) fail.add("SOURCE_DEPTH");
    if (r.liquidity === null || r.liquidity === 0n) fail.add("SOURCE_LIQUIDITY");
    else if (!big(r.liquidity, U128)) miss.add("MISSING_SOURCE_DEPTH");
    if (r.condition === null || (uint(r.condition, U32) && r.condition !== 0)) fail.add("SOURCE_CONDITION");
    else if (!uint(r.condition, U32)) miss.add("MISSING_BINDING");
    if (r.binding === false) fail.add("SOURCE_CONDITION");
    else if (r.binding !== true) miss.add("MISSING_BINDING");
  }
  const nativeRows = rows.filter((r) => r.mode === 2 && r.temporalKind !== 6);
  if (nativeRows.length || modes.includes(3) || sampled) {
    const minSupport = rules.history.minSupportSec;
    if (!h || h.supportSec == null || h.afterCreation) miss.add("MISSING_HISTORY");
    else if (h.supportSec < minSupport) fail.add("HISTORY_NOT_READY");
    // CPMM native opening: raw span ≥ support + 14 s (the start shifts 14 s).
    if (!tupleKnown && rows.some((r) => r.mode === 2)) miss.add("MISSING_HISTORY");
    else if (nativeRows.some((r) => r.adapterType === 2)) {
      if (h?.rawSpanSec == null) miss.add("MISSING_HISTORY");
      else if (h.rawSpanSec < minSupport + 14) fail.add("HISTORY_NOT_READY");
    }
    if (sampled) {
      if (h?.records == null) miss.add("MISSING_HISTORY");
      else if (h.records < rules.history.minSampledRecords) fail.add("HISTORY_NOT_READY");
    }
  }
  // Quorum, venues and coverage each on its own: a known failure stands next to a missing sibling.
  if (!pub || pub.qualifiedSources == null || pub.qualifiedVenues == null || pub.coverageBps == null) miss.add("MISSING_PUBLICATION");
  const quorumBad = (n: number | undefined, need: number | undefined) => n != null && ((need != null && n < need) || (singleProof && n !== 1));
  if (quorumBad(pub?.qualifiedSources, polOk ? pol!.minSources : undefined) || quorumBad(pub?.qualifiedVenues, polOk ? pol!.minVenues : undefined)) fail.add("QUORUM");
  if (pub?.coverageBps != null && polOk && pub.coverageBps < pol!.minCoverageBps) fail.add("COVERAGE");

  // 5. Confidence, dispersion, freshness, proof.
  // A composed bound is at least the primary's: a known primary excess fails even with the converter's bound absent.
  const pconf = pub?.confBps ?? null;
  let conf = pconf;
  if (conf != null && sol && converter) conf = converter.confBps == null ? null : composeConfBps(conf, converter.confBps);
  limits.confBps = conf;
  const confs = rows.map((r) => r.confBps);
  if (confs.some((c) => c != null && !u16(c))) miss.add("MISSING_BOUNDS");
  const known = rows.length && confs.every(u16) ? Math.min(...(confs as number[])) : undefined;
  if ((conf != null && conf > parentMaxConfBps) || (pconf != null && pconf > parentMaxConfBps) || (known !== undefined && known > parentMaxConfBps)) fail.add("CONFIDENCE");
  else if (conf == null) miss.add("MISSING_BOUNDS");
  // Converted dispersion: the primary's composed with the converter's, as the bounds.
  const pdisp = pub?.dispersionBps ?? null;
  let disp = pdisp;
  if (disp != null && sol && converter) disp = converter.dispersionBps == null ? null : composeConfBps(disp, converter.dispersionBps);
  if (polOk && ((disp != null && disp > pol!.maxDispersionBps) || (pdisp != null && pdisp > pol!.maxDispersionBps))) fail.add("DISPERSION");
  else if (pub && disp == null && (rows.length > 1 || (sol && converter))) miss.add("MISSING_BOUNDS");
  if (pub) {
    if (pub.ageSlots == null) miss.add("MISSING_CLOCK");
    else if (point ? pub.ageSlots > 0 : pub.ageSlots > Math.min(polOk ? pol!.ageSlots : Infinity, pub.stored ? rules.age.storedSlots : rules.age.liveSlots)) fail.add("STALE");
    if (single && m0 != null && !SPOT.has(m0)) {
      if (typeof pub.proofValid !== "boolean") miss.add("MISSING_PROOF");
      else if (!pub.proofValid) fail.add("PROOF_INVALID");
    }
    if (d.kind === "composite") {
      if (pub.componentSkewSlots == null) miss.add("MISSING_CLOCK");
      else if (pub.componentSkewSlots > rules.age.componentSkewSlots) fail.add("COMPONENT_SKEW");
    }
  }

  // 6. Activation and trade capacity. Known parts of a cap only lower it: a FAIL on them stands, the rest is MISSING_CAPACITY.
  const { seedUsdc, tradeUsdc } = it;
  const termsOk = money(seedUsdc) && money(tradeUsdc) && [it.usedMarketUsdc, it.sharedUsdc].every((x) => x == null || money(x));
  if (!termsOk) miss.add("MISSING_MARKET_TERMS");
  else if (profileOk) {
    const seed = usdc6(seedUsdc), trade = usdc6(tradeUsdc);
    // The program rejects a zero signed delta.
    if (trade === 0n) fail.add("TRADE_CAPACITY");
    // A supplied cap that is not a u64 is unknown, never dropped.
    let capMissing = !capIn;
    const c: NonNullable<MarketFitCohort["capacity"]> = {};
    for (const k of ["d50Usdc6", "floorUsdc6", "positionUsdc6", "marketUsdc6", "converterUsdc6"] as const) {
      const v = capIn?.[k];
      if (u64(v)) c[k] = v; else if (v !== undefined) capMissing = true;
    }
    const isNew = co.existing === false;
    const used = it.usedMarketUsdc ?? (isNew ? 0 : undefined), shared = it.sharedUsdc ?? (isNew ? tradeUsdc : undefined);
    // Matcher normalized cap: market max position, any authenticated cap, then the regime's own (live 3·D50, sampled F/10).
    const caps = [usdc6(profile.maxPositionUsdc), ...(c.positionUsdc6 != null ? [c.positionUsdc6] : [])];
    // SOL quote: the converter's cap F/10 is intersected, except on a live point (lib.rs classic_converter_sample).
    if (sol && !point && !dual) { if (c.converterUsdc6 == null) capMissing = true; else caps.push(c.converterUsdc6); }
    if (point || dual) {
      if (c.d50Usdc6 == null) capMissing = true; else caps.push(3n * c.d50Usdc6);
      if (dual && c.positionUsdc6 == null) capMissing = true;
      if (used == null) capMissing = true;
      const market = [...(c.d50Usdc6 != null ? [10n * c.d50Usdc6] : []), ...(c.marketUsdc6 != null ? [c.marketUsdc6] : [])];
      if (market.length) {
        limits.marketCapUsdc6 = min(market);
        if (usdc6(used ?? 0) + trade > limits.marketCapUsdc6) fail.add("TRADE_CAPACITY");
      }
    } else if (sampled) {
      if (c.floorUsdc6 == null) capMissing = true;
      else {
        caps.push(c.floorUsdc6 / 10n);
        limits.marketCapUsdc6 = c.floorUsdc6 / 4n;
        if (shared == null) capMissing = true;
        else if (usdc6(shared) > limits.marketCapUsdc6) fail.add("OI_CAPACITY");
      }
    }
    if (capMissing) miss.add("MISSING_CAPACITY");
    if (oiHeads.some((x) => x !== undefined && trade > x)) fail.add("OI_CAPACITY");
    // Minimum position: the profile's, else the BAND rule at this seed (usable = min(max position, FeedOI limit, R_vault)); its
    // activation (minimum / usable share) raises the profile's.
    let minPos: bigint | undefined, minAct = usdc6(profile.minActivationUsdc);
    if (profile.minPositionUsdc !== undefined) minPos = usdc6(profile.minPositionUsdc);
    else if (!point && !dual && !sampled) {
      const mp = rules.minPosition, share = BigInt(mp.usableBps);
      const usable = min([usdc6(profile.maxPositionUsdc), usdc6(mp.feedOiLimitUsdc), seed * BigInt(Math.min(profile.kappaBps, profile.maxTraderOiBps)) / 10_000n]);
      minPos = min([usable * share / 10_000n, usdc6(mp.maxUsdc)]);
      const act = (minPos * 10_000n + share - 1n) / share;
      if (act > minAct) minAct = act;
    }
    if (minPos === undefined) miss.add("MISSING_MARKET_TERMS");
    else if (trade < minPos) fail.add("TRADE_CAPACITY");
    const normalized = min(caps);
    // Activation depth = min(half the seed, normalized cap) ≥ the market minimum.
    limits.activationDepthUsdc6 = min([seed / 2n, normalized]);
    if (limits.activationDepthUsdc6 < minAct) fail.add("ACTIVATION_CAPACITY");
    // Position: the normalized cap ∩ the wrapper LP cap floor(equity × min(kappa, maxTraderOi) / 10000).
    limits.positionCapUsdc6 = min([normalized, seed * BigInt(Math.min(profile.kappaBps, profile.maxTraderOiBps)) / 10_000n]);
    if (trade > limits.positionCapUsdc6) fail.add("TRADE_CAPACITY");
  }
  return done(profile, rules.revision);
}
