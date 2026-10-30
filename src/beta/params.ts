import type { Address } from "@solana/kit";
import { betaError, MimirBetaCompositeQualityError, MimirBetaUnpriceableError, type MimirBetaCompositeQualityViolation, type MimirBetaQualityViolation } from "./errors.js";
import { mimirBetaSourceQualityFloorBps, type MimirBetaClassicPolicy, type MimirBetaCompositePolicy } from "./creation.js";
import type { MimirClassicRowRecipe } from "./live.js";
import type { MimirBetaSourceFamily } from "./types.js";

/**
 * Every margin of the auto creation parameters, in one place. A sealed parameter is never the exact measurement: it is the
 * observed value times a headroom (or a floor), clamped to the program bounds (`MIMIR_PARAM_BOUNDS`).
 */
export const MIMIR_PARAM_MARGINS = Object.freeze({
  /** Minimum confidence and dispersion cap (bps); auto never seals below it. */
  capFloorBps: 100,
  /** Pool-geometry floors (CLMM/Orca tick spacing, DLMM bin step, DAMM v2 5, CPMM-family 1/0) × this. They are immutable per pool. */
  geometryHeadroom: 1.25,
  /** Maximum of a geometry-driven cap: the program maximum, so every pool the program can admit is sealed with its headroom; a row whose own floor is above it is refused unless that cap is overridden. */
  autoRaiseMaxBps: 10_000,
  /** Classic rows whose confidence carries the native window gap (any recipe other than spot), without observed samples: this cap (the live SOL feed's). */
  windowConfidenceFloorBps: 300,
  /** With samples: clamp(ceil(p99 × observedHeadroom), max(capFloorBps, row floor + windowFloorMarginBps), windowConfidenceMaxBps). */
  windowFloorMarginBps: 50,
  windowConfidenceMaxBps: 500,
  /** Observed confidence / dispersion samples: their p99 × this. */
  observedHeadroom: 1.5,
  observedPercentile: 0.99,
  /** Two or more Classic pools: minimum cross-pool dispersion cap (bps). */
  multiSourceDispersionFloorBps: 200,
  /** Snapshot ages cover this many seconds (the program's native-proof bound, engine.rs `age > 60`) × `ageHeadroom`, in slots at the fastest measured slot duration. */
  ageTargetSeconds: 60,
  ageHeadroom: 1.25,
  /** Coverage: every row is required (`minSources = n`, 10,000 bps), sealed with a 20 % margin. */
  coverageRatioBps: 8_000,
  /** Depth floor = this share of the depth to 50 bps measured at creation: a 91 % liquidity withdrawal stays priceable. */
  depthFloorBps: 900,
  /** Price exponent from an observed price: the mantissa keeps `priceDigits` significant digits after a fall of `priceDropDecades` powers of ten. */
  priceDigits: 6,
  priceDropDecades: 2,
});

/** Program bounds of the overridable parameters (processor.rs `validate_lifecycle_init_args`, state.rs composite header). */
export const MIMIR_PARAM_BOUNDS = Object.freeze({
  classic: { maxConfidenceBps: [1, 9_999], maxDispersionBps: [1, 10_000], maxSnapshotAgeSlots: [1, 0xffff],
    maxSourceActivityAgeSlots: [5, 0xffff], minCoverageRatioBps: [1, 10_000], depthFloorBps: [1, 10_000], priceExponent: [-36, 19] },
  composite: { maxComponentConfidenceBps: [0, 10_000], maxComponentDispersionBps: [0, 10_000], maxSnapshotAgeSlots: [1, 0xffff],
    maxComponentSnapshotAgeSlots: [1, 0xffff], priceExponent: [-36, 19] },
} as const);

export type MimirClassicPolicyOverrides = Partial<Pick<MimirBetaClassicPolicy, keyof typeof MIMIR_PARAM_BOUNDS.classic>>;
export type MimirCompositePolicyOverrides = Partial<Pick<MimirBetaCompositePolicy, keyof typeof MIMIR_PARAM_BOUNDS.composite>>;

/** One selected source row. */
export interface MimirParamRow {
  readonly family: MimirBetaSourceFamily;
  readonly pool: Address;
  /** Pool account bytes; the tick-spacing / bin-step floors read them. */
  readonly poolData: Uint8Array | null | undefined;
  /** Classic recipe; omitted or `"spot"` observes a fixed quality, any other recipe adds the native window width. */
  readonly recipe?: MimirClassicRowRecipe | null;
}

/** One composite component row, with its child Classic's sealed policy when the child exists. */
export interface MimirCompositeParamRow extends MimirParamRow {
  /** 1-based position as entered. */
  readonly position: number;
  readonly sourceConfig: Address;
  readonly child?: Readonly<{ maxConfidenceBps: number; maxSourceActivityAgeSlots: number }>;
}

/** SOL conversion of SOL-quoted children: the SOL feed's rows and its sealed caps. */
export interface MimirCompositeParamConverter {
  readonly sourceConfig: Address;
  readonly rows: readonly MimirParamRow[];
  readonly maxConfidenceBps: number;
  readonly maxDispersionBps: number;
}

/** A row that lifts a cap above `capFloorBps`: the cap is feed-wide, so it loosens every other row too. */
export interface MimirParamWidening {
  readonly parameter: string;
  readonly position: number;
  readonly pool: Address;
  readonly valueBps: number;
  /** This row's own requirement: `valueBps` × `geometryHeadroom`, clamped like the cap. The row set the cap when it equals `capBps`. */
  readonly requiredBps: number;
  readonly capBps: number;
}

export interface MimirPerformanceSampleRpc {
  getRecentPerformanceSamples(limit?: number): { send(): Promise<readonly Readonly<{ numSlots: bigint | number; samplePeriodSecs: number }>[]> };
}

/** Fastest slot duration (ms) over the node's recent performance samples; ages sized from it keep at least their target in seconds. */
export async function mimirMeasureSlotMs(rpc: MimirPerformanceSampleRpc, limit = 30): Promise<number> {
  const ms = (await rpc.getRecentPerformanceSamples(limit).send())
    .filter((s) => Number(s.numSlots) > 0 && s.samplePeriodSecs > 0).map((s) => s.samplePeriodSecs * 1_000 / Number(s.numSlots));
  return ms.length ? Math.min(...ms) : betaError("CREATION_CONTEXT_REQUIRED", "no recent performance sample to measure the slot duration");
}

/** Slots covering `ageTargetSeconds × ageHeadroom` at `slotMs`, within the u16 program field. */
export function mimirAgeSlots(slotMs: number, minimum = 1): number {
  if (!Number.isFinite(slotMs) || slotMs <= 0) betaError("CREATION_CONTEXT_REQUIRED", "a measured slot duration (ms) is required");
  return Math.min(0xffff, Math.max(minimum, Math.ceil(MIMIR_PARAM_MARGINS.ageTargetSeconds * MIMIR_PARAM_MARGINS.ageHeadroom * 1_000 / slotMs)));
}

/** p99 of observed bps samples × `observedHeadroom`; 0 without samples. */
export function mimirObservedCapBps(samples: readonly number[] | undefined): number {
  const sorted = (samples ?? []).filter((x) => Number.isFinite(x) && x >= 0).sort((x, y) => x - y);
  if (!sorted.length) return 0;
  return Math.ceil(sorted[Math.ceil(MIMIR_PARAM_MARGINS.observedPercentile * sorted.length) - 1]! * MIMIR_PARAM_MARGINS.observedHeadroom);
}

const geometry = (bps: number) => Math.max(bps, Math.min(Math.ceil(bps * MIMIR_PARAM_MARGINS.geometryHeadroom), MIMIR_PARAM_MARGINS.autoRaiseMaxBps));

/** Exponent keeping `priceDigits` significant digits after a `priceDropDecades` fall of `price` (quote per base), within the program's −36..19. */
export function mimirAutoPriceExponent(price: number): number {
  if (!Number.isFinite(price) || price <= 0) betaError("INVALID_ARGUMENT", "the auto price exponent needs an observed positive price");
  return Math.min(19, Math.max(-36, Math.floor(Math.log10(price)) - (MIMIR_PARAM_MARGINS.priceDigits - 1) - MIMIR_PARAM_MARGINS.priceDropDecades));
}

function priceExponent(observedPrice: number | undefined, fallback: number, override: number | undefined): number {
  if (override !== undefined && observedPrice !== undefined && observedPrice / 10 ** override < 1) {
    betaError("INVALID_ARGUMENT", `observed price ${observedPrice} is below the precision of exponent ${override} (mantissa 0: SCALE_UNREPRESENTABLE)`);
  }
  return observedPrice === undefined ? fallback : mimirAutoPriceExponent(observedPrice);
}

/** Rows whose own floor is above the owner maximum, for each cap the caller did not override. */
function aboveAutoMax<V>(parameterOverridden: boolean, rows: readonly Readonly<{ floor: number; violation: V }>[]): V[] {
  return parameterOverridden ? [] : rows.filter((row) => row.floor > MIMIR_PARAM_MARGINS.autoRaiseMaxBps).map((row) => row.violation);
}
/** A SOL conversion row is held to the confidence cap only; CLMM/Orca confidence is fixed, so their pool state is not needed. */
const converterConfidenceBps = (row: MimirParamRow) => row.family === "raydium-clmm" || row.family === "orca-whirlpool" ? 5
  : mimirBetaSourceQualityFloorBps(row.family, row.poolData).confidenceBps;
const windowed = (row: MimirParamRow) => (row.recipe ?? "spot") !== "spot";

function applyOverrides<T extends object>(auto: T, overrides: Partial<T> | undefined, bounds: Readonly<Record<string, readonly [number, number]>>, kind: string): T {
  if (overrides === undefined) return auto;
  if (!overrides || typeof overrides !== "object") betaError("INVALID_ARGUMENT", `${kind} overrides must be an object`);
  for (const [key, value] of Object.entries(overrides)) {
    const range = bounds[key] ?? betaError("INVALID_ARGUMENT", `${kind} override ${key} is not an overridable parameter`);
    if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < range[0] || value > range[1])) {
      betaError("INVALID_ARGUMENT", `${kind} override ${key}=${String(value)} is outside the program range ${range[0]}..${range[1]}`);
    }
  }
  return { ...auto, ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) };
}

function widening(parameter: string, cap: number, max: number, rows: readonly Readonly<{ position: number; pool: Address; valueBps: number }>[]): MimirParamWidening[] {
  return rows.filter((row) => cap > MIMIR_PARAM_MARGINS.capFloorBps && row.valueBps > MIMIR_PARAM_MARGINS.capFloorBps)
    .map((row) => ({ parameter, position: row.position, pool: row.pool, valueBps: row.valueBps, requiredBps: Math.min(max, geometry(row.valueBps)), capBps: cap }));
}

/**
 * Classic policy from the selected pools: confidence and dispersion caps from the row floors and observed samples with their
 * headrooms, snapshot age from the measured slot duration, source-activity age the u16 maximum 65,535 (a quiet pool is never
 * refused for activity age), coverage and depth floor from `MIMIR_PARAM_MARGINS`. `overrides` replaces any
 * of them after a program-bounds check; `assertMimirPriceable` still refuses a cap a row can never meet.
 */
export function mimirAutoClassicPolicy(a: Readonly<{
  rows: readonly MimirParamRow[];
  slotMs: number;
  base: Omit<MimirBetaClassicPolicy, Exclude<keyof MimirClassicPolicyOverrides, "priceExponent">>;
  /** Observed confidence of windowed rows (native window widths, bps) over a recent window. */
  observedConfidenceBps?: readonly number[];
  /** Observed cross-pool dispersion (bps) over a recent window. */
  observedDispersionBps?: readonly number[];
  /** Observed price (quote per base): sets the price exponent (`mimirAutoPriceExponent`) unless overridden. */
  observedPrice?: number;
  overrides?: MimirClassicPolicyOverrides;
}>): Readonly<{ policy: MimirBetaClassicPolicy; widenedBy: readonly MimirParamWidening[] }> {
  if (!a.rows.length) betaError("POOL_COUNT_OUT_OF_RANGE", "auto Classic policy needs at least one pool");
  const floors = a.rows.map((row, i) => ({ ...mimirBetaSourceQualityFloorBps(row.family, row.poolData), position: i + 1, pool: row.pool, windowed: windowed(row) }));
  const capped = aboveAutoMax(a.overrides?.maxConfidenceBps !== undefined, floors.map((f) => ({ floor: f.confidenceBps,
    violation: { role: "source" as const, position: f.position, pool: f.pool, family: a.rows[f.position - 1]!.family, metric: "confidence" as const,
      valueBps: f.confidenceBps, capBps: MIMIR_PARAM_MARGINS.autoRaiseMaxBps, autoMax: true as const } })));
  if (capped.length) throw new MimirBetaUnpriceableError(capped);
  const observed = mimirObservedCapBps(a.observedConfidenceBps);
  const window = (floor: number) => observed ? Math.min(MIMIR_PARAM_MARGINS.windowConfidenceMaxBps,
    Math.max(MIMIR_PARAM_MARGINS.capFloorBps, floor + MIMIR_PARAM_MARGINS.windowFloorMarginBps, observed)) : MIMIR_PARAM_MARGINS.windowConfidenceFloorBps;
  const confidence = Math.min(9_999, Math.max(MIMIR_PARAM_MARGINS.capFloorBps, ...floors.map((f) => geometry(f.confidenceBps)),
    ...floors.map((f) => f.windowed ? window(f.confidenceBps) : 0)));
  const dispersion = a.rows.length === 1 ? MIMIR_PARAM_MARGINS.capFloorBps : Math.min(10_000, Math.max(MIMIR_PARAM_MARGINS.multiSourceDispersionFloorBps,
    ...floors.map((f) => geometry(f.spreadBps)), mimirObservedCapBps(a.observedDispersionBps)));
  const policy = applyOverrides<MimirBetaClassicPolicy>({ ...a.base, priceExponent: priceExponent(a.observedPrice, a.base.priceExponent, a.overrides?.priceExponent),
    maxConfidenceBps: confidence, maxDispersionBps: dispersion,
    maxSnapshotAgeSlots: mimirAgeSlots(a.slotMs), maxSourceActivityAgeSlots: MIMIR_PARAM_BOUNDS.classic.maxSourceActivityAgeSlots[1],
    minCoverageRatioBps: MIMIR_PARAM_MARGINS.coverageRatioBps, depthFloorBps: MIMIR_PARAM_MARGINS.depthFloorBps }, a.overrides, MIMIR_PARAM_BOUNDS.classic, "Classic");
  return { policy, widenedBy: widening("maxConfidenceBps", policy.maxConfidenceBps, 9_999, floors.map((f) => ({ ...f, valueBps: f.confidenceBps }))) };
}

/**
 * Composite root policy from its rows: each cap admits every row floor × `geometryHeadroom` and every child's own sealed cap (the
 * index never refuses what its child accepts), plus the SOL feed's caps for SOL-quoted children; ages from the measured slot
 * duration and no shorter than any child's activity age. The program has one cap per index, not per row: a wide pool loosens it for all.
 */
export function mimirAutoCompositePolicy(a: Readonly<{
  rows: readonly MimirCompositeParamRow[];
  converter?: MimirCompositeParamConverter;
  slotMs: number;
  /** Caller exponent; it is part of the index identity. */
  priceExponent: number;
  /** Observed basket price (quote): sets the exponent (`mimirAutoPriceExponent`) unless overridden, which changes the identity. */
  observedPrice?: number;
  overrides?: MimirCompositePolicyOverrides;
}>): Readonly<{ policy: MimirBetaCompositePolicy; widenedBy: readonly MimirParamWidening[] }> {
  if (!a.rows.length) betaError("INVALID_ARGUMENT", "auto composite policy needs its components");
  const floors = a.rows.map((row) => ({ ...mimirBetaSourceQualityFloorBps(row.family, row.poolData), position: row.position, pool: row.pool, row }));
  const converter = (a.converter?.rows ?? []).map(converterConfidenceBps);
  const violation = (f: (typeof floors)[number], metric: "confidence" | "dispersion", valueBps: number) => ({ role: "component" as const, position: f.position,
    sourceConfig: f.row.sourceConfig, pool: f.pool, family: f.row.family, metric, valueBps, capBps: MIMIR_PARAM_MARGINS.autoRaiseMaxBps, autoMax: true as const });
  const capped = [
    ...aboveAutoMax(a.overrides?.maxComponentConfidenceBps !== undefined, floors.map((f) => ({ floor: f.confidenceBps, violation: violation(f, "confidence", f.confidenceBps) }))),
    ...aboveAutoMax(a.overrides?.maxComponentConfidenceBps !== undefined, converter.map((floor, i) => ({ floor, violation: { role: "converter" as const, position: i + 1,
      sourceConfig: a.converter!.sourceConfig, pool: a.converter!.rows[i]!.pool, family: a.converter!.rows[i]!.family, metric: "confidence" as const, valueBps: floor,
      capBps: MIMIR_PARAM_MARGINS.autoRaiseMaxBps, autoMax: true as const } }))),
    ...aboveAutoMax(a.overrides?.maxComponentDispersionBps !== undefined, floors.map((f) => ({ floor: f.spreadBps, violation: violation(f, "dispersion", f.spreadBps) }))),
  ];
  if (capped.length) throw new MimirBetaCompositeQualityError(capped);
  const confidence = Math.min(10_000, Math.max(MIMIR_PARAM_MARGINS.capFloorBps, ...floors.map((f) => geometry(f.confidenceBps)),
    ...converter.map(geometry), ...a.rows.map((row) => row.child?.maxConfidenceBps ?? 0), a.converter?.maxConfidenceBps ?? 0));
  const dispersion = Math.min(10_000, Math.max(MIMIR_PARAM_MARGINS.capFloorBps, ...floors.map((f) => geometry(f.spreadBps)), a.converter?.maxDispersionBps ?? 0));
  const age = Math.max(mimirAgeSlots(a.slotMs), ...a.rows.map((row) => row.child?.maxSourceActivityAgeSlots ?? 0));
  const policy = applyOverrides<MimirBetaCompositePolicy>({ priceExponent: priceExponent(a.observedPrice, a.priceExponent, a.overrides?.priceExponent),
    maxSnapshotAgeSlots: mimirAgeSlots(a.slotMs),
    maxComponentSnapshotAgeSlots: age, maxComponentConfidenceBps: confidence, maxComponentDispersionBps: dispersion },
  a.overrides, MIMIR_PARAM_BOUNDS.composite, "Composite");
  return { policy, widenedBy: [...widening("maxComponentDispersionBps", policy.maxComponentDispersionBps, 10_000, floors.map((f) => ({ ...f, valueBps: f.spreadBps }))),
    ...widening("maxComponentConfidenceBps", policy.maxComponentConfidenceBps, 10_000, floors.map((f) => ({ ...f, valueBps: f.confidenceBps })))] };
}

/** CPMM native-bounded / DUAL creation floor (families.rs `seal_floor_ok`, RAYDIUM_CPMM_NATIVE_MIN_CONFIDENCE_BPS). */
const CPMM_NATIVE_MIN_CONFIDENCE_BPS = 40;

export type MimirPriceablePlan =
  | Readonly<{ kind: "classic"; policy: Pick<MimirBetaClassicPolicy, "maxConfidenceBps">; rows: readonly MimirParamRow[] }>
  | Readonly<{ kind: "composite"; policy: Pick<MimirBetaCompositePolicy, "maxComponentConfidenceBps" | "maxComponentDispersionBps">;
    rows: readonly MimirCompositeParamRow[]; converter?: Pick<MimirCompositeParamConverter, "sourceConfig" | "rows"> }>;

/**
 * Refuses, before any transaction is built, a plan with a row that could never price under its sealed caps: a Classic pool whose
 * fixed confidence (DLMM bin step, CPMM native floor) exceeds `maxConfidenceBps`; a composite row whose fixed confidence or spread
 * (tick spacing, bin step) exceeds the index caps; a SOL conversion row above the confidence cap.
 * Throws `MimirBetaUnpriceableError` (Classic) or `MimirBetaCompositeQualityError` (composite), naming row, parameter, value and cap.
 */
export function assertMimirPriceable(plan: MimirPriceablePlan): void {
  if (plan.kind === "classic") {
    const cap = plan.policy.maxConfidenceBps;
    const violations: MimirBetaQualityViolation[] = plan.rows.flatMap((row, i) => {
      const floor = mimirBetaSourceQualityFloorBps(row.family, row.poolData).confidenceBps;
      const value = Math.max(floor, row.recipe === "native-bounded" && row.family === "raydium-cpmm" ? CPMM_NATIVE_MIN_CONFIDENCE_BPS : 0);
      return value > cap ? [{ role: "source" as const, position: i + 1, pool: row.pool, family: row.family, metric: "confidence" as const, valueBps: value, capBps: cap }] : [];
    });
    if (violations.length) throw new MimirBetaUnpriceableError(violations);
    return;
  }
  const { maxComponentConfidenceBps: confidence, maxComponentDispersionBps: dispersion } = plan.policy;
  const violations: MimirBetaCompositeQualityViolation[] = [];
  const check = (row: MimirParamRow, role: "component" | "converter", position: number, sourceConfig: Address) => {
    const floor = role === "component" ? mimirBetaSourceQualityFloorBps(row.family, row.poolData) : { confidenceBps: converterConfidenceBps(row), spreadBps: 0 };
    const base = { role, position, sourceConfig, pool: row.pool, family: row.family };
    if (floor.confidenceBps > confidence) violations.push({ ...base, metric: "confidence", valueBps: floor.confidenceBps, capBps: confidence });
    if (floor.spreadBps > dispersion) violations.push({ ...base, metric: "dispersion", valueBps: floor.spreadBps, capBps: dispersion });
  };
  plan.rows.forEach((row) => check(row, "component", row.position, row.sourceConfig));
  plan.converter?.rows.forEach((row, i) => check(row, "converter", i + 1, plan.converter!.sourceConfig));
  if (violations.length) throw new MimirBetaCompositeQualityError(violations);
}
