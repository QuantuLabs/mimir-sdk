import { createHash } from "./internal/sha256.js";
import {
  buildRouteableDepthEvidenceFromRanges,
  type BuiltRouteableDepthEvidence,
  type RouteableDepthRangeEvidence,
  type RouteableDepthSide,
  type RouteableDepthSideRangeEvidence,
} from "./routeableDepth.js";

export const ROUTEABLE_DEPTH_TRAVERSAL_HASH_DOMAIN =
  "MIMIR_ROUTEABLE_DEPTH_TRAVERSAL_V1";
export const ROUTEABLE_DEPTH_TRAVERSAL_SET_HASH_DOMAIN =
  "MIMIR_ROUTEABLE_DEPTH_TRAVERSAL_SET_V1";

export interface RouteableDepthDecodedLevel {
  side: RouteableDepthSide;
  lowerBps: number;
  upperBps: number;
  capitalRequired: bigint;
  economicLoss: bigint;
  observedSlot: bigint | number;
  covered?: boolean;
}

export interface RouteableDepthDecodedSideLevels {
  side: RouteableDepthSide;
  levels: readonly Omit<RouteableDepthDecodedLevel, "side">[];
}

export interface BuildRouteableDepthEvidenceFromDecodedLevelsArgs {
  targetBps?: number;
  currentSlot: bigint | number;
  sides: readonly RouteableDepthDecodedSideLevels[];
}

export interface RouteableDepthTraversalSideSummary {
  side: RouteableDepthSide;
  inputLevelCount: number;
  usedLevelCount: number;
  coverageEndBps: number;
  missingRangeCount: number;
  liquidityAgeSlotsMin: bigint | null;
}

export interface RouteableDepthTraversalResult {
  currentSlot: bigint;
  rangeEvidence: BuiltRouteableDepthEvidence;
  traversalSummaries: RouteableDepthTraversalSideSummary[];
}

function normalizeTraversalValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map((entry) => normalizeTraversalValue(entry));
  if (value != null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = normalizeTraversalValue(source[key]);
    }
    return out;
  }
  return value;
}

function slotToBigint(value: bigint | number): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error("InvalidRouteableDepthTraversal");
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("InvalidRouteableDepthTraversal");
  }
  return BigInt(value);
}

function assertSide(value: string): asserts value is RouteableDepthSide {
  if (value !== "up" && value !== "down") {
    throw new Error("InvalidRouteableDepthTraversal");
  }
}

function assertNonEmptyAscii(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[\x20-\x7e]+$/.test(value)
  ) {
    throw new Error("InvalidRouteableDepthTraversal");
  }
}

function buildSideRanges(
  side: RouteableDepthDecodedSideLevels,
  currentSlot: bigint,
): RouteableDepthSideRangeEvidence {
  assertSide(side.side);
  if (!Array.isArray(side.levels) || side.levels.length > 65_535) {
    throw new Error("InvalidRouteableDepthTraversal");
  }
  const ranges: RouteableDepthRangeEvidence[] = side.levels.map((level) => {
    const observedSlot = slotToBigint(level.observedSlot);
    if (observedSlot > currentSlot) {
      throw new Error("InvalidRouteableDepthTraversal");
    }
    return {
      lowerBps: level.lowerBps,
      upperBps: level.upperBps,
      capitalRequired: level.capitalRequired,
      economicLoss: level.economicLoss,
      covered: level.covered,
      liquidityAgeSlots: currentSlot - observedSlot,
    };
  });
  return { side: side.side, ranges };
}

export function buildRouteableDepthEvidenceFromDecodedLevels(
  args: BuildRouteableDepthEvidenceFromDecodedLevelsArgs,
): RouteableDepthTraversalResult {
  const currentSlot = slotToBigint(args.currentSlot);
  if (!Array.isArray(args.sides) || args.sides.length === 0) {
    throw new Error("InvalidRouteableDepthTraversal");
  }
  const sideRanges = args.sides.map((side) => buildSideRanges(side, currentSlot));
  const rangeEvidence = buildRouteableDepthEvidenceFromRanges({
    targetBps: args.targetBps,
    sides: sideRanges,
  });
  const traversalSummaries = rangeEvidence.rangeSummaries.map((summary) => {
    const input = args.sides.find((side) => side.side === summary.side);
    if (input == null) throw new Error("InvalidRouteableDepthTraversal");
    return {
      side: summary.side,
      inputLevelCount: input.levels.length,
      usedLevelCount: summary.rangeCount,
      coverageEndBps: summary.coverageEndBps,
      missingRangeCount: summary.missingRangeCount,
      liquidityAgeSlotsMin: summary.liquidityAgeSlotsMin,
    };
  });
  return { currentSlot, rangeEvidence, traversalSummaries };
}

export function computeRouteableDepthTraversalHash(value: unknown): string {
  const hasher = createHash("sha256");
  hasher.update(ROUTEABLE_DEPTH_TRAVERSAL_HASH_DOMAIN, "ascii");
  hasher.update(Buffer.from([0]));
  hasher.update(JSON.stringify(normalizeTraversalValue(value)), "utf8");
  return hasher.digest("hex");
}

export function computeRouteableDepthTraversalSetHash(
  entries: readonly { fixtureId: string; traversalHash: string }[],
): string {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("InvalidRouteableDepthTraversal");
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    assertNonEmptyAscii(entry.fixtureId);
    if (seen.has(entry.fixtureId)) {
      throw new Error("InvalidRouteableDepthTraversal");
    }
    seen.add(entry.fixtureId);
    if (!/^[0-9a-f]{64}$/.test(entry.traversalHash)) {
      throw new Error("InvalidRouteableDepthTraversal");
    }
  }
  const canonicalEntries = [...entries].sort((a, b) => {
    const fixtureDelta = a.fixtureId.localeCompare(b.fixtureId);
    if (fixtureDelta !== 0) return fixtureDelta;
    return a.traversalHash.localeCompare(b.traversalHash);
  });
  const hasher = createHash("sha256");
  hasher.update(ROUTEABLE_DEPTH_TRAVERSAL_SET_HASH_DOMAIN, "ascii");
  hasher.update(Buffer.from([0]));
  hasher.update(JSON.stringify(normalizeTraversalValue(canonicalEntries)), "utf8");
  return hasher.digest("hex");
}
