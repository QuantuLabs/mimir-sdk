import { createHash } from "./internal/sha256.js";

const U128_MAX = (1n << 128n) - 1n;

export type RouteableDepthSide = "up" | "down";

export const ROUTEABLE_DEPTH_RANGE_EVIDENCE_HASH_DOMAIN =
  "MIMIR_ROUTEABLE_DEPTH_RANGES_V1";
export const ROUTEABLE_DEPTH_ADAPTER_FIXTURE_HASH_DOMAIN =
  "MIMIR_ROUTEABLE_DEPTH_ADAPTER_FIXTURE_V1";
export const ROUTEABLE_DEPTH_ADAPTER_FIXTURE_SET_HASH_DOMAIN =
  "MIMIR_ROUTEABLE_DEPTH_ADAPTER_FIXTURE_SET_V1";

export interface RouteableDepthSideEvidence {
  side: RouteableDepthSide;
  targetBps: number;
  covered: boolean;
  rangeCount: number;
  capitalRequiredFloor: bigint;
  economicLossFloor: bigint;
  liquidityAgeSlotsMin?: bigint | number | null;
  missingRangeCount?: number;
}

export interface RouteableDepthRangeEvidence {
  lowerBps: number;
  upperBps: number;
  covered?: boolean;
  capitalRequired: bigint;
  economicLoss: bigint;
  liquidityAgeSlots?: bigint | number | null;
}

export interface RouteableDepthSideRangeEvidence {
  side: RouteableDepthSide;
  targetBps?: number;
  ranges: readonly RouteableDepthRangeEvidence[];
}

export interface BuildRouteableDepthEvidenceFromRangesArgs {
  targetBps?: number;
  sides: readonly RouteableDepthSideRangeEvidence[];
}

export interface RouteableDepthRangeSideSummary {
  side: RouteableDepthSide;
  targetBps: number;
  coverageEndBps: number;
  covered: boolean;
  rangeCount: number;
  missingRangeCount: number;
  capitalRequiredFloor: bigint;
  economicLossFloor: bigint;
  liquidityAgeSlotsMin: bigint | null;
}

export interface BuiltRouteableDepthEvidence {
  targetBps: number;
  sides: RouteableDepthSideEvidence[];
  rangeSummaries: RouteableDepthRangeSideSummary[];
}

export interface RouteableDepthAdapterFixture {
  fixtureId: string;
  adapterName: string;
  adapterType: number;
  sourceLayout: string;
  executableOnchainAdapter: boolean;
  productionPriorityEligible: boolean;
  productionPriorityBlockingReasons?: readonly string[];
  accountGraphHash?: string | Uint8Array | null;
  rangeEvidence: BuiltRouteableDepthEvidence;
  evaluation: RouteableDepthEvidenceEvaluation;
  notes?: readonly string[];
}

export interface EvaluateRouteableDepthEvidenceArgs {
  sides: readonly RouteableDepthSideEvidence[];
  targetBps?: number;
  acceptedNotional: bigint;
  manipulationSafetyFactor?: number;
  minCapitalFloor?: bigint;
  minEconomicLossFloor?: bigint;
  minLiquidityAgeSlots?: bigint | number;
  requireBothSides?: boolean;
}

export type RouteableDepthEvidenceFailureCode =
  | "MissingSide"
  | "TargetBpsMismatch"
  | "CoverageIncomplete"
  | "RangeCountTooLow"
  | "MissingRange"
  | "CapitalFloorTooLow"
  | "EconomicLossTooLow"
  | "LiquidityAgeMissing"
  | "LiquidityAgeTooYoung";

export interface RouteableDepthEvidenceFailure {
  code: RouteableDepthEvidenceFailureCode;
  side?: RouteableDepthSide;
  actual?: bigint | number | string;
  required?: bigint | number | string;
}

export interface RouteableDepthEvidenceEvaluation {
  eligible: boolean;
  failures: RouteableDepthEvidenceFailure[];
  targetBps: number;
  capitalRequiredFloor: bigint;
  economicLossFloor: bigint;
  requiredCapitalFloor: bigint;
  requiredEconomicLossFloor: bigint;
  minLiquidityAgeSlotsObserved: bigint | null;
}

function assertU128(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value > U128_MAX) {
    throw new Error("InvalidRouteableDepthEvidence");
  }
}

function assertBps(value: number): void {
  if (!Number.isInteger(value) || value <= 0 || value > 10_000) {
    throw new Error("InvalidRouteableDepthEvidence");
  }
}

function assertBpsBoundary(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error("InvalidRouteableDepthEvidence");
  }
}

function slotDeltaToBigint(value: bigint | number): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error("InvalidRouteableDepthEvidence");
    return value;
  }
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(value)
  ) {
    throw new Error("InvalidRouteableDepthEvidence");
  }
  return BigInt(value);
}

function assertCount(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error("InvalidRouteableDepthEvidence");
  }
}

function assertSide(value: string): asserts value is RouteableDepthSide {
  if (value !== "up" && value !== "down") {
    throw new Error("InvalidRouteableDepthEvidence");
  }
}

function minBigint(current: bigint | null, value: bigint): bigint {
  return current == null || value < current ? value : current;
}

function checkedAddU128(left: bigint, right: bigint): bigint {
  const value = left + right;
  assertU128(value);
  return value;
}

function normalizeRouteableDepthEvidenceValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeRouteableDepthEvidenceValue(entry));
  }
  if (value != null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = normalizeRouteableDepthEvidenceValue(source[key]);
    }
    return out;
  }
  return value;
}

export function stringifyRouteableDepthRangeEvidenceReport(
  report: unknown,
): string {
  return `${JSON.stringify(normalizeRouteableDepthEvidenceValue(report), null, 2)}\n`;
}

export function computeRouteableDepthRangeEvidenceHash(value: unknown): string {
  const hasher = createHash("sha256");
  hasher.update(ROUTEABLE_DEPTH_RANGE_EVIDENCE_HASH_DOMAIN, "ascii");
  hasher.update(Buffer.from([0]));
  hasher.update(
    JSON.stringify(normalizeRouteableDepthEvidenceValue(value)),
    "utf8",
  );
  return hasher.digest("hex");
}

function assertNonEmptyAscii(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[\x20-\x7e]+$/.test(value)
  ) {
    throw new Error("InvalidRouteableDepthAdapterFixture");
  }
}

function adapterFixtureAccountGraphHashHex(
  fixture: RouteableDepthAdapterFixture,
): string | null {
  if (fixture.accountGraphHash == null) return null;
  const hash =
    typeof fixture.accountGraphHash === "string"
      ? Buffer.from(fixture.accountGraphHash, "hex")
      : Buffer.from(fixture.accountGraphHash);
  if (hash.length !== 32) {
    throw new Error("InvalidRouteableDepthAdapterFixture");
  }
  return hash.toString("hex");
}

function validateAdapterFixture(fixture: RouteableDepthAdapterFixture): void {
  assertNonEmptyAscii(fixture.fixtureId);
  assertNonEmptyAscii(fixture.adapterName);
  assertNonEmptyAscii(fixture.sourceLayout);
  if (
    !Number.isInteger(fixture.adapterType) ||
    fixture.adapterType < 0 ||
    fixture.adapterType > 255 ||
    typeof fixture.executableOnchainAdapter !== "boolean" ||
    typeof fixture.productionPriorityEligible !== "boolean"
  ) {
    throw new Error("InvalidRouteableDepthAdapterFixture");
  }
  const priorityBlockers = fixture.productionPriorityBlockingReasons ?? [];
  if (!Array.isArray(priorityBlockers)) {
    throw new Error("InvalidRouteableDepthAdapterFixture");
  }
  if (fixture.productionPriorityEligible && priorityBlockers.length !== 0) {
    throw new Error("InvalidRouteableDepthAdapterFixture");
  }
  if (!fixture.productionPriorityEligible && priorityBlockers.length === 0) {
    throw new Error("InvalidRouteableDepthAdapterFixture");
  }
  for (const reason of priorityBlockers) assertNonEmptyAscii(reason);
  adapterFixtureAccountGraphHashHex(fixture);
  if (
    fixture.rangeEvidence == null ||
    fixture.rangeEvidence.sides.length === 0 ||
    fixture.evaluation == null ||
    !Array.isArray(fixture.evaluation.failures)
  ) {
    throw new Error("InvalidRouteableDepthAdapterFixture");
  }
  if (fixture.notes != null) {
    for (const note of fixture.notes) assertNonEmptyAscii(note);
  }
}

export function computeRouteableDepthAdapterFixtureHash(
  fixture: RouteableDepthAdapterFixture,
): string {
  validateAdapterFixture(fixture);
  const hasher = createHash("sha256");
  hasher.update(ROUTEABLE_DEPTH_ADAPTER_FIXTURE_HASH_DOMAIN, "ascii");
  hasher.update(Buffer.from([0]));
  hasher.update(
    JSON.stringify(normalizeRouteableDepthEvidenceValue(fixture)),
    "utf8",
  );
  return hasher.digest("hex");
}

export function computeRouteableDepthAdapterFixtureSetHash(
  fixtures: readonly RouteableDepthAdapterFixture[],
): string {
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error("InvalidRouteableDepthAdapterFixture");
  }
  const seen = new Set<string>();
  const seenAccountGraphHashes = new Set<string>();
  const fixtureInputs = fixtures.map((fixture) => {
    validateAdapterFixture(fixture);
    if (seen.has(fixture.fixtureId)) {
      throw new Error("InvalidRouteableDepthAdapterFixture");
    }
    seen.add(fixture.fixtureId);
    const accountGraphHash = adapterFixtureAccountGraphHashHex(fixture);
    if (accountGraphHash != null) {
      if (seenAccountGraphHashes.has(accountGraphHash)) {
        throw new Error("InvalidRouteableDepthAdapterFixture");
      }
      seenAccountGraphHashes.add(accountGraphHash);
    }
    return {
      fixture,
      fixtureHash: computeRouteableDepthAdapterFixtureHash(fixture),
    };
  }).sort((a, b) => {
    const fixtureDelta = a.fixture.fixtureId.localeCompare(b.fixture.fixtureId);
    if (fixtureDelta !== 0) return fixtureDelta;
    return a.fixtureHash.localeCompare(b.fixtureHash);
  });
  const hasher = createHash("sha256");
  hasher.update(ROUTEABLE_DEPTH_ADAPTER_FIXTURE_SET_HASH_DOMAIN, "ascii");
  hasher.update(Buffer.from([0]));
  hasher.update(
    JSON.stringify(normalizeRouteableDepthEvidenceValue(fixtureInputs)),
    "utf8",
  );
  return hasher.digest("hex");
}

function buildRouteableDepthSideEvidenceFromRanges(
  args: RouteableDepthSideRangeEvidence,
  defaultTargetBps: number,
): {
  evidence: RouteableDepthSideEvidence;
  summary: RouteableDepthRangeSideSummary;
} {
  assertSide(args.side);
  const targetBps = args.targetBps ?? defaultTargetBps;
  assertBps(targetBps);
  if (!Array.isArray(args.ranges) || args.ranges.length > 65_535) {
    throw new Error("InvalidRouteableDepthEvidence");
  }

  const ranges = [...args.ranges].sort((left, right) => {
    if (left.lowerBps !== right.lowerBps) {
      return left.lowerBps - right.lowerBps;
    }
    return left.upperBps - right.upperBps;
  });
  let coverageEndBps = 0;
  let rangeCount = 0;
  let missingRangeCount = ranges.length === 0 ? 1 : 0;
  let capitalRequiredFloor = 0n;
  let economicLossFloor = 0n;
  let liquidityAgeSlotsMin: bigint | null = null;
  let liquidityAgeMissing = false;

  for (const range of ranges) {
    assertBpsBoundary(range.lowerBps);
    assertBpsBoundary(range.upperBps);
    if (range.lowerBps >= range.upperBps || range.lowerBps >= targetBps) {
      throw new Error("InvalidRouteableDepthEvidence");
    }
    assertU128(range.capitalRequired);
    assertU128(range.economicLoss);
    const covered = range.covered ?? true;
    if (typeof covered !== "boolean") {
      throw new Error("InvalidRouteableDepthEvidence");
    }
    const cappedUpperBps = Math.min(range.upperBps, targetBps);
    if (!covered) {
      missingRangeCount += 1;
      continue;
    }
    if (range.lowerBps > coverageEndBps) {
      missingRangeCount += 1;
    }
    coverageEndBps = Math.max(coverageEndBps, cappedUpperBps);
    rangeCount += 1;
    capitalRequiredFloor = checkedAddU128(
      capitalRequiredFloor,
      range.capitalRequired,
    );
    economicLossFloor = checkedAddU128(economicLossFloor, range.economicLoss);
    if (range.liquidityAgeSlots == null) {
      liquidityAgeMissing = true;
    } else {
      liquidityAgeSlotsMin = minBigint(
        liquidityAgeSlotsMin,
        slotDeltaToBigint(range.liquidityAgeSlots),
      );
    }
  }

  if (coverageEndBps < targetBps) {
    missingRangeCount += 1;
  }
  const covered = missingRangeCount === 0 && coverageEndBps >= targetBps;
  const finalLiquidityAgeSlotsMin = liquidityAgeMissing
    ? null
    : liquidityAgeSlotsMin;
  const evidence: RouteableDepthSideEvidence = {
    side: args.side,
    targetBps,
    covered,
    rangeCount,
    missingRangeCount,
    capitalRequiredFloor,
    economicLossFloor,
    liquidityAgeSlotsMin: finalLiquidityAgeSlotsMin,
  };
  const summary: RouteableDepthRangeSideSummary = {
    side: args.side,
    targetBps,
    coverageEndBps,
    covered,
    rangeCount,
    missingRangeCount,
    capitalRequiredFloor,
    economicLossFloor,
    liquidityAgeSlotsMin: finalLiquidityAgeSlotsMin,
  };
  return { evidence, summary };
}

export function buildRouteableDepthEvidenceFromRanges(
  args: BuildRouteableDepthEvidenceFromRangesArgs,
): BuiltRouteableDepthEvidence {
  const targetBps = args.targetBps ?? 50;
  assertBps(targetBps);
  if (
    !Array.isArray(args.sides) ||
    args.sides.length === 0 ||
    args.sides.length > 2
  ) {
    throw new Error("InvalidRouteableDepthEvidence");
  }
  const seen = new Set<RouteableDepthSide>();
  const sides: RouteableDepthSideEvidence[] = [];
  const rangeSummaries: RouteableDepthRangeSideSummary[] = [];
  for (const side of args.sides) {
    if (seen.has(side.side)) {
      throw new Error("InvalidRouteableDepthEvidence");
    }
    seen.add(side.side);
    const { evidence, summary } = buildRouteableDepthSideEvidenceFromRanges(
      side,
      targetBps,
    );
    if (evidence.targetBps !== targetBps) {
      throw new Error("InvalidRouteableDepthEvidence");
    }
    sides.push(evidence);
    rangeSummaries.push(summary);
  }
  return { targetBps, sides, rangeSummaries };
}

export function evaluateRouteableDepthEvidence(
  args: EvaluateRouteableDepthEvidenceArgs,
): RouteableDepthEvidenceEvaluation {
  const targetBps = args.targetBps ?? 50;
  assertBps(targetBps);
  assertU128(args.acceptedNotional);
  if (
    !Array.isArray(args.sides) ||
    args.sides.length === 0 ||
    args.sides.length > 2
  ) {
    throw new Error("InvalidRouteableDepthEvidence");
  }

  const manipulationSafetyFactor = args.manipulationSafetyFactor ?? 10;
  if (
    !Number.isInteger(manipulationSafetyFactor) ||
    manipulationSafetyFactor <= 0
  ) {
    throw new Error("InvalidRouteableDepthEvidence");
  }
  const requiredCapitalFloor = args.minCapitalFloor ?? args.acceptedNotional;
  const requiredEconomicLossFloor =
    args.minEconomicLossFloor ??
    args.acceptedNotional * BigInt(manipulationSafetyFactor);
  assertU128(requiredCapitalFloor);
  assertU128(requiredEconomicLossFloor);

  const minLiquidityAgeSlots = slotDeltaToBigint(
    args.minLiquidityAgeSlots ?? 0,
  );
  const requireBothSides = args.requireBothSides ?? true;
  const reportsBySide = new Map<RouteableDepthSide, RouteableDepthSideEvidence>();
  const failures: RouteableDepthEvidenceFailure[] = [];
  let capitalRequiredFloor: bigint | null = null;
  let economicLossFloor: bigint | null = null;
  let minLiquidityAgeSlotsObserved: bigint | null = null;

  for (const evidence of args.sides) {
    assertSide(evidence.side);
    assertBps(evidence.targetBps);
    if (typeof evidence.covered !== "boolean") {
      throw new Error("InvalidRouteableDepthEvidence");
    }
    assertCount(evidence.rangeCount);
    assertU128(evidence.capitalRequiredFloor);
    assertU128(evidence.economicLossFloor);
    const missingRangeCount = evidence.missingRangeCount ?? 0;
    assertCount(missingRangeCount);
    if (reportsBySide.has(evidence.side)) {
      throw new Error("InvalidRouteableDepthEvidence");
    }
    reportsBySide.set(evidence.side, evidence);
    capitalRequiredFloor = minBigint(
      capitalRequiredFloor,
      evidence.capitalRequiredFloor,
    );
    economicLossFloor = minBigint(economicLossFloor, evidence.economicLossFloor);

    if (evidence.targetBps !== targetBps) {
      failures.push({
        code: "TargetBpsMismatch",
        side: evidence.side,
        actual: evidence.targetBps,
        required: targetBps,
      });
    }
    if (!evidence.covered) {
      failures.push({
        code: "CoverageIncomplete",
        side: evidence.side,
        required: "covered",
      });
    }
    if (evidence.rangeCount === 0) {
      failures.push({
        code: "RangeCountTooLow",
        side: evidence.side,
        actual: 0,
        required: 1,
      });
    }
    if (missingRangeCount !== 0) {
      failures.push({
        code: "MissingRange",
        side: evidence.side,
        actual: missingRangeCount,
        required: 0,
      });
    }
    if (evidence.capitalRequiredFloor < requiredCapitalFloor) {
      failures.push({
        code: "CapitalFloorTooLow",
        side: evidence.side,
        actual: evidence.capitalRequiredFloor,
        required: requiredCapitalFloor,
      });
    }
    if (evidence.economicLossFloor < requiredEconomicLossFloor) {
      failures.push({
        code: "EconomicLossTooLow",
        side: evidence.side,
        actual: evidence.economicLossFloor,
        required: requiredEconomicLossFloor,
      });
    }
    if (evidence.liquidityAgeSlotsMin == null) {
      failures.push({
        code: "LiquidityAgeMissing",
        side: evidence.side,
        required: minLiquidityAgeSlots,
      });
    } else {
      const liquidityAgeSlotsMin = slotDeltaToBigint(
        evidence.liquidityAgeSlotsMin,
      );
      minLiquidityAgeSlotsObserved = minBigint(
        minLiquidityAgeSlotsObserved,
        liquidityAgeSlotsMin,
      );
      if (liquidityAgeSlotsMin < minLiquidityAgeSlots) {
        failures.push({
          code: "LiquidityAgeTooYoung",
          side: evidence.side,
          actual: liquidityAgeSlotsMin,
          required: minLiquidityAgeSlots,
        });
      }
    }
  }

  if (requireBothSides) {
    for (const side of ["up", "down"] as const) {
      if (!reportsBySide.has(side)) {
        failures.push({
          code: "MissingSide",
          side,
          required: side,
        });
      }
    }
  }

  return {
    eligible: failures.length === 0,
    failures,
    targetBps,
    capitalRequiredFloor: capitalRequiredFloor ?? 0n,
    economicLossFloor: economicLossFloor ?? 0n,
    requiredCapitalFloor,
    requiredEconomicLossFloor,
    minLiquidityAgeSlotsObserved,
  };
}
