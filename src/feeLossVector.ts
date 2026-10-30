import { createHash } from "./internal/sha256.js";

const U128_MAX = (1n << 128n) - 1n;

export const FEE_LOSS_VECTOR_HASH_DOMAIN =
  "MIMIR_MANIPULATION_COST_VECTOR_V1";

export interface FeeLossVectorSource {
  sourceId: string;
  adapterType: number;
  fixtureHash?: string | null;
  venueGroup: number;
  correlationGroup: number;
  weightBps: number;
  capitalRequiredFloor: bigint;
  economicLossFloor: bigint;
  executableOnchainAdapter?: boolean;
  productionPriorityEligible?: boolean;
  productionPriorityBlockingReasons?: readonly string[];
}

export interface EvaluateFeeLossVectorArgs {
  sources: readonly FeeLossVectorSource[];
  acceptedNotional: bigint;
  manipulationSafetyFactor?: number;
  minSourceCount?: number;
  minVenueGroupCount?: number;
  minCorrelationGroupCount?: number;
  maxSingleSourceWeightBps?: number;
  maxCorrelationGroupWeightBps?: number;
  requireExecutableOnchainAdapters?: boolean;
  requireProductionPrioritySources?: boolean;
}

export type FeeLossVectorFailureCode =
  | "SourceCountTooLow"
  | "WeightSumMismatch"
  | "SourceWeightTooHigh"
  | "VenueGroupCountTooLow"
  | "CorrelationGroupCountTooLow"
  | "CorrelationGroupWeightTooHigh"
  | "WeightedEconomicLossTooLow"
  | "AdapterNotExecutable"
  | "SourceNotProductionPriority"
  | "DuplicateFixtureHash";

export interface FeeLossVectorFailure {
  code: FeeLossVectorFailureCode;
  sourceId?: string;
  group?: number;
  actual?: bigint | number | string;
  required?: bigint | number | string;
}

export interface FeeLossGroupSummary {
  group: number;
  weightBps: number;
  sourceCount: number;
  weightedEconomicLossFloor: bigint;
}

export interface FeeLossVectorEvaluation {
  eligible: boolean;
  failures: FeeLossVectorFailure[];
  sourceCount: number;
  totalWeightBps: number;
  venueGroupCount: number;
  correlationGroupCount: number;
  capitalRequiredFloorMin: bigint;
  economicLossFloorMin: bigint;
  weightedEconomicLossFloor: bigint;
  requiredEconomicLossFloor: bigint;
  correlationGroups: FeeLossGroupSummary[];
}

function assertU128(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value > U128_MAX) {
    throw new Error("InvalidFeeLossVector");
  }
}

function assertBps(value: number): void {
  if (!Number.isInteger(value) || value <= 0 || value > 10_000) {
    throw new Error("InvalidFeeLossVector");
  }
}

function assertGroup(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error("InvalidFeeLossVector");
  }
}

function assertSourceId(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[\x20-\x7e]+$/.test(value)
  ) {
    throw new Error("InvalidFeeLossVector");
  }
}

function normalizeSha256Hex(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("InvalidFeeLossVector");
  }
  return value;
}

function normalizeFeeLossVectorValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeFeeLossVectorValue(entry));
  }
  if (value != null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = normalizeFeeLossVectorValue(source[key]);
    }
    return out;
  }
  return value;
}

export function stringifyFeeLossVectorReport(report: unknown): string {
  return `${JSON.stringify(normalizeFeeLossVectorValue(report), null, 2)}\n`;
}

export function computeFeeLossVectorHash(value: unknown): string {
  const hasher = createHash("sha256");
  hasher.update(FEE_LOSS_VECTOR_HASH_DOMAIN, "ascii");
  hasher.update(Buffer.from([0]));
  hasher.update(
    JSON.stringify(normalizeFeeLossVectorValue(value)),
    "utf8",
  );
  return hasher.digest("hex");
}

function weightedFloor(value: bigint, weightBps: number): bigint {
  assertU128(value);
  assertBps(weightBps);
  return (value * BigInt(weightBps)) / 10_000n;
}

export function evaluateFeeLossVector(
  args: EvaluateFeeLossVectorArgs,
): FeeLossVectorEvaluation {
  if (!Array.isArray(args.sources) || args.sources.length === 0) {
    throw new Error("InvalidFeeLossVector");
  }
  assertU128(args.acceptedNotional);
  const manipulationSafetyFactor = args.manipulationSafetyFactor ?? 10;
  if (
    !Number.isInteger(manipulationSafetyFactor) ||
    manipulationSafetyFactor <= 0
  ) {
    throw new Error("InvalidFeeLossVector");
  }
  const minSourceCount = args.minSourceCount ?? 4;
  if (!Number.isInteger(minSourceCount) || minSourceCount <= 0) {
    throw new Error("InvalidFeeLossVector");
  }
  const minVenueGroupCount = args.minVenueGroupCount ?? 3;
  const minCorrelationGroupCount = args.minCorrelationGroupCount ?? 3;
  if (
    !Number.isInteger(minVenueGroupCount) ||
    minVenueGroupCount <= 0 ||
    !Number.isInteger(minCorrelationGroupCount) ||
    minCorrelationGroupCount <= 0
  ) {
    throw new Error("InvalidFeeLossVector");
  }
  const maxSingleSourceWeightBps = args.maxSingleSourceWeightBps ?? 3_500;
  const maxCorrelationGroupWeightBps =
    args.maxCorrelationGroupWeightBps ?? 3_500;
  assertBps(maxSingleSourceWeightBps);
  assertBps(maxCorrelationGroupWeightBps);
  const requiredEconomicLossFloor =
    args.acceptedNotional * BigInt(manipulationSafetyFactor);
  assertU128(requiredEconomicLossFloor);

  const failures: FeeLossVectorFailure[] = [];
  const seenSources = new Set<string>();
  const seenFixtureHashes = new Map<string, string>();
  const venueGroups = new Set<number>();
  const correlationGroupWeights = new Map<number, number>();
  const correlationGroupLosses = new Map<number, bigint>();
  const correlationGroupCounts = new Map<number, number>();
  let totalWeightBps = 0;
  let capitalRequiredFloorMin: bigint | null = null;
  let economicLossFloorMin: bigint | null = null;
  let weightedEconomicLossFloor = 0n;

  for (const source of args.sources) {
    assertSourceId(source.sourceId);
    if (seenSources.has(source.sourceId)) {
      throw new Error("InvalidFeeLossVector");
    }
    seenSources.add(source.sourceId);
    if (
      !Number.isInteger(source.adapterType) ||
      source.adapterType < 0 ||
      source.adapterType > 255
    ) {
      throw new Error("InvalidFeeLossVector");
    }
    const fixtureHash = normalizeSha256Hex(source.fixtureHash);
    if (fixtureHash != null) {
      const existingSourceId = seenFixtureHashes.get(fixtureHash);
      if (existingSourceId != null) {
        failures.push({
          code: "DuplicateFixtureHash",
          sourceId: source.sourceId,
          actual: fixtureHash,
          required: `unique fixture hash; first source ${existingSourceId}`,
        });
      } else {
        seenFixtureHashes.set(fixtureHash, source.sourceId);
      }
    }
    assertGroup(source.venueGroup);
    assertGroup(source.correlationGroup);
    assertBps(source.weightBps);
    assertU128(source.capitalRequiredFloor);
    assertU128(source.economicLossFloor);
    if (
      source.executableOnchainAdapter != null &&
      typeof source.executableOnchainAdapter !== "boolean"
    ) {
      throw new Error("InvalidFeeLossVector");
    }
    if (
      source.productionPriorityEligible != null &&
      typeof source.productionPriorityEligible !== "boolean"
    ) {
      throw new Error("InvalidFeeLossVector");
    }
    if (source.productionPriorityBlockingReasons != null) {
      if (!Array.isArray(source.productionPriorityBlockingReasons)) {
        throw new Error("InvalidFeeLossVector");
      }
      for (const reason of source.productionPriorityBlockingReasons) {
        assertSourceId(reason);
      }
    }
    totalWeightBps += source.weightBps;
    venueGroups.add(source.venueGroup);
    capitalRequiredFloorMin =
      capitalRequiredFloorMin == null ||
      source.capitalRequiredFloor < capitalRequiredFloorMin
        ? source.capitalRequiredFloor
        : capitalRequiredFloorMin;
    economicLossFloorMin =
      economicLossFloorMin == null ||
      source.economicLossFloor < economicLossFloorMin
        ? source.economicLossFloor
        : economicLossFloorMin;
    const sourceWeightedLoss = weightedFloor(
      source.economicLossFloor,
      source.weightBps,
    );
    weightedEconomicLossFloor += sourceWeightedLoss;
    correlationGroupWeights.set(
      source.correlationGroup,
      (correlationGroupWeights.get(source.correlationGroup) ?? 0) +
        source.weightBps,
    );
    correlationGroupLosses.set(
      source.correlationGroup,
      (correlationGroupLosses.get(source.correlationGroup) ?? 0n) +
        sourceWeightedLoss,
    );
    correlationGroupCounts.set(
      source.correlationGroup,
      (correlationGroupCounts.get(source.correlationGroup) ?? 0) + 1,
    );
    if (source.weightBps > maxSingleSourceWeightBps) {
      failures.push({
        code: "SourceWeightTooHigh",
        sourceId: source.sourceId,
        actual: source.weightBps,
        required: maxSingleSourceWeightBps,
      });
    }
    if (
      args.requireExecutableOnchainAdapters === true &&
      source.executableOnchainAdapter !== true
    ) {
      failures.push({
        code: "AdapterNotExecutable",
        sourceId: source.sourceId,
        required: "executable-onchain-adapter",
      });
    }
    if (
      args.requireProductionPrioritySources === true &&
      source.productionPriorityEligible !== true
    ) {
      failures.push({
        code: "SourceNotProductionPriority",
        sourceId: source.sourceId,
        required: "production-priority-source",
      });
    }
  }

  if (args.sources.length < minSourceCount) {
    failures.push({
      code: "SourceCountTooLow",
      actual: args.sources.length,
      required: minSourceCount,
    });
  }
  if (totalWeightBps !== 10_000) {
    failures.push({
      code: "WeightSumMismatch",
      actual: totalWeightBps,
      required: 10_000,
    });
  }
  if (venueGroups.size < minVenueGroupCount) {
    failures.push({
      code: "VenueGroupCountTooLow",
      actual: venueGroups.size,
      required: minVenueGroupCount,
    });
  }
  if (correlationGroupWeights.size < minCorrelationGroupCount) {
    failures.push({
      code: "CorrelationGroupCountTooLow",
      actual: correlationGroupWeights.size,
      required: minCorrelationGroupCount,
    });
  }
  const correlationGroups = [...correlationGroupWeights.entries()]
    .sort(([left], [right]) => left - right)
    .map(([group, weightBps]) => {
      if (weightBps > maxCorrelationGroupWeightBps) {
        failures.push({
          code: "CorrelationGroupWeightTooHigh",
          group,
          actual: weightBps,
          required: maxCorrelationGroupWeightBps,
        });
      }
      return {
        group,
        weightBps,
        sourceCount: correlationGroupCounts.get(group) ?? 0,
        weightedEconomicLossFloor: correlationGroupLosses.get(group) ?? 0n,
      };
    });
  assertU128(weightedEconomicLossFloor);
  if (weightedEconomicLossFloor < requiredEconomicLossFloor) {
    failures.push({
      code: "WeightedEconomicLossTooLow",
      actual: weightedEconomicLossFloor,
      required: requiredEconomicLossFloor,
    });
  }

  return {
    eligible: failures.length === 0,
    failures,
    sourceCount: args.sources.length,
    totalWeightBps,
    venueGroupCount: venueGroups.size,
    correlationGroupCount: correlationGroupWeights.size,
    capitalRequiredFloorMin: capitalRequiredFloorMin ?? 0n,
    economicLossFloorMin: economicLossFloorMin ?? 0n,
    weightedEconomicLossFloor,
    requiredEconomicLossFloor,
    correlationGroups,
  };
}
