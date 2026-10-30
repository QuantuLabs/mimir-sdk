import { freshNumberRecord } from "./canonicalAuthority.js";
import type { FeedConfigHeader, FeedSnapshotHeader, SnapshotPolicy } from "../types.js";

const RiskTier = freshNumberRecord("RiskTier");
const RouteabilityStatus = freshNumberRecord("RouteabilityStatus");
const VerifyFlags = freshNumberRecord("VerifyFlags");
const SnapshotStatus = freshNumberRecord("SnapshotStatus");
const QuoteStatus = freshNumberRecord("QuoteStatus");
const AnchorProvider = freshNumberRecord("AnchorProvider");
const FeedLifecycleState = freshNumberRecord("FeedLifecycleState");
const CAP_MODEL_VERSION_V2 = 2;
const CAP_MODEL_ECON_LOSS_BAND_BPS = 50;
const CAP_MODEL_HASH_V2 = new TextEncoder().encode("MIMIR_CAP_MODEL_V2_FINAL_2026062");
const U128_MAX = (1n << 128n) - 1n;

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function assertPlainSnapshotSource(header: Pick<FeedSnapshotHeader, "snapshotSource">): void {
  if (header.snapshotSource === 5 || header.snapshotSource === 6 || header.snapshotSource === 7) throw new Error("InvalidSnapshotSource");
}

/** Mimir's snapshot reader requires a plain source's stored interval to equal price ∓ ceil(price·confidence/10_000). */
export function verifySnapshotConfidenceBounds(h: FeedSnapshotHeader): void {
  if ([5, 6, 7].includes(h.snapshotSource)) return;
  const delta = (h.priceX64 * BigInt(h.confidenceBps) + 9_999n) / 10_000n;
  if (h.priceX64 === 0n || h.confidenceBps > 10_000 || h.priceX64 <= delta || h.priceX64 + delta >= 1n << 128n ||
      h.priceLowerX64 !== h.priceX64 - delta || h.priceUpperX64 !== h.priceX64 + delta) throw new Error("InvalidAccountData");
}

function capV2SafetyFactorForRiskTier(riskTier: number): number {
  switch (riskTier) {
    case RiskTier.TierA:
      return 6;
    case RiskTier.TierB:
      return 8;
    case RiskTier.TierC:
      return 10;
    default:
      throw new Error("InvalidCapModel");
  }
}

function capV2VerifiedBandCapitalNotional(
  header: FeedSnapshotHeader,
): bigint {
  const expectedSafetyFactor = capV2SafetyFactorForRiskTier(header.riskTier);
  if (
    header.capModelVersion !== CAP_MODEL_VERSION_V2 ||
    header.attackerSetEconLossFloorNative === 0n ||
    header.attackerSetCapitalRequiredFloorNative === 0n ||
    header.attackerSetFeeLossFloorMirror !== header.attackerSetEconLossFloorNative ||
    header.econLossBandBps !== CAP_MODEL_ECON_LOSS_BAND_BPS ||
    header.capTierSafetyFactor !== expectedSafetyFactor ||
    !eqBytes(header.capModelHash, CAP_MODEL_HASH_V2)
  ) {
    throw new Error("InvalidCapModel");
  }
  if (header.attackerSetCapitalRequiredFloorNative > U128_MAX / 10_000n) {
    throw new Error("InvalidCapModel");
  }
  const derived =
    (header.attackerSetCapitalRequiredFloorNative * 10_000n) /
    BigInt(header.econLossBandBps) /
    BigInt(header.capTierSafetyFactor);
  if (header.bandCapitalNotional !== derived) {
    throw new Error("InvalidCapModel");
  }
  return header.bandCapitalNotional;
}

export function verifySnapshotHeaderPolicy(
  header: FeedSnapshotHeader,
  policy: SnapshotPolicy,
  verifyAddress?: () => void,
  allowMixed = false,
): void {
  if (!allowMixed) assertPlainSnapshotSource(header);
  verifySnapshotConfidenceBounds(header);
  if (
    policy.expectedTwapRevision !== 0n &&
    (policy.flags & VerifyFlags.RequireLiveTwapState) === 0
  ) {
    throw new Error("InvalidSnapshotPolicy");
  }
  if (
    policy.expectedSnapshotRevision === 0n ||
    ((policy.flags & VerifyFlags.RequireLiveTwapState) !== 0 &&
      policy.expectedTwapRevision === 0n) ||
    policy.expectedRouteabilityStatus === RouteabilityStatus.Unrated ||
    policy.expectedRouteabilityStatus === RouteabilityStatus.Disabled
  ) {
    throw new Error("InvalidSnapshotPolicy");
  }
  if (!eqBytes(header.feedId, policy.expectedFeedId)) throw new Error("InvalidFeed");
  verifyAddress?.();
  if (!eqBytes(header.sourcingPlanHash, policy.expectedPlanHash)) throw new Error("InvalidPlan");
  if (header.priceExponent !== policy.expectedPriceExponent) throw new Error("InvalidExponent");
  if (
    policy.expectedSnapshotRevision !== 0n &&
    (policy.minimumRevision === true
      ? header.snapshotRevision < policy.expectedSnapshotRevision
      : header.snapshotRevision !== policy.expectedSnapshotRevision)
  ) {
    throw new Error("UnexpectedSnapshotRevision");
  }
  if (header.status !== SnapshotStatus.Fresh) throw new Error("InvalidStatus");
  if (header.routeabilityStatus !== policy.expectedRouteabilityStatus) {
    throw new Error("InvalidRouteability");
  }
  if ((policy.flags & VerifyFlags.RequireTierA) !== 0 && header.riskTier !== RiskTier.TierA) {
    throw new Error("InvalidRouteability");
  }
  if (header.validUntilSlot < policy.clockSlot) throw new Error("StaleSnapshot");
  if (header.snapshotSlot > policy.clockSlot) throw new Error("StaleSnapshot");
  if (policy.clockSlot - header.snapshotSlot > BigInt(policy.maxSnapshotAgeSlots)) {
    throw new Error("StaleSnapshot");
  }
  const activityClock = ![1, 5, 6, 7].includes(header.snapshotSource);
  if (activityClock && header.oldestSourceActivitySlot > policy.clockSlot) throw new Error("StaleSourceActivity");
  if (
    activityClock &&
    policy.clockSlot - header.oldestSourceActivitySlot >
    BigInt(policy.maxSourceActivityAgeSlots)
  ) {
    throw new Error("StaleSourceActivity");
  }
  if (header.quoteStatus !== QuoteStatus.Ok && (policy.flags & VerifyFlags.AllowDepegQuote) === 0) {
    throw new Error("QuoteNotOk");
  }
  if (header.sourceCount < policy.minSourceCount) throw new Error("InsufficientSourceCount");
  if (header.venueCount < policy.minVenueCount) throw new Error("InsufficientVenueCount");
  if (header.correlationGroupCount < policy.minCorrelationGroupCount) {
    throw new Error("InsufficientCorrelationGroupCount");
  }
  if (header.coverageRatioBps < policy.minCoverageRatioBps) {
    throw new Error("InsufficientCoverage");
  }
  if (header.confidenceBps > policy.maxConfidenceBps) throw new Error("ConfidenceTooWide");
  if (header.dispersionBps > policy.maxDispersionBps) throw new Error("DispersionTooWide");
  if (header.riskTier === RiskTier.TierA) {
    const nativeException =
      header.anchorProvider === AnchorProvider.NativeOnlyException &&
      (policy.flags & VerifyFlags.AllowNativeException) !== 0 &&
      eqBytes(header.nativeExceptionHash, policy.expectedNativeExceptionHash) &&
      !eqBytes(policy.expectedNativeExceptionHash, new Uint8Array(32));
    if (!nativeException) throw new Error("AnchorNotOk");
  }
  const verifiedBandCapitalNotional = allowMixed && [5, 6, 7].includes(header.snapshotSource)
    ? header.attackerSetCapitalRequiredFloorNative
    : capV2VerifiedBandCapitalNotional(header);
  if (policy.notional > verifiedBandCapitalNotional) {
    throw new Error("NotionalTooLarge");
  }
}

export function verifyFeedConfigForSnapshot(
  feedConfig: FeedConfigHeader,
  snapshot: FeedSnapshotHeader,
  policy: SnapshotPolicy,
): void {
  if (!eqBytes(feedConfig.feedId, snapshot.feedId) || !eqBytes(feedConfig.feedId, policy.expectedFeedId)) {
    throw new Error("InvalidFeed");
  }
  if (feedConfig.lifecycleState !== FeedLifecycleState.Active) {
    throw new Error("FeedConfigNotActive");
  }
  if (feedConfig.feedConfigRevision !== snapshot.feedConfigRevision) {
    throw new Error("FeedConfigRevisionMismatch");
  }
  if (feedConfig.registryEpoch !== snapshot.registryEpoch) {
    throw new Error("RegistryEpochMismatch");
  }
  if (feedConfig.priceExponent !== snapshot.priceExponent) throw new Error("InvalidExponent");
  if (snapshot.riskTier > feedConfig.riskTier) throw new Error("InvalidRouteability");
  if (snapshot.sourceCount < feedConfig.minSourceCount) throw new Error("InsufficientSourceCount");
  if (snapshot.venueCount < feedConfig.minVenueCount) throw new Error("InsufficientVenueCount");
  if (snapshot.correlationGroupCount < feedConfig.minCorrelationGroupCount) {
    throw new Error("InsufficientCorrelationGroupCount");
  }
  if (snapshot.coverageRatioBps < feedConfig.minCoverageRatioBps) {
    throw new Error("InsufficientCoverage");
  }
  if (snapshot.confidenceBps > feedConfig.maxConfidenceBps) {
    throw new Error("ConfidenceTooWide");
  }
  if (snapshot.dispersionBps > feedConfig.maxDispersionBps) {
    throw new Error("DispersionTooWide");
  }
  if (snapshot.snapshotSlot > policy.clockSlot) throw new Error("StaleSnapshot");
  if (policy.clockSlot - snapshot.snapshotSlot > BigInt(feedConfig.maxSnapshotAgeSlots)) {
    throw new Error("StaleSnapshot");
  }
  if (![1, 5, 6, 7].includes(snapshot.snapshotSource) && snapshot.oldestSourceActivitySlot > policy.clockSlot) {
    throw new Error("StaleSourceActivity");
  }
  if (
    ![1, 5, 6, 7].includes(snapshot.snapshotSource) &&
    policy.clockSlot - snapshot.oldestSourceActivitySlot >
    BigInt(feedConfig.maxSourceActivityAgeSlots)
  ) {
    throw new Error("StaleSourceActivity");
  }
  if (!eqBytes(snapshot.anchorPolicyHash, feedConfig.anchorPolicyHash)) {
    throw new Error("FeedConfigPolicyMismatch");
  }
  if (
    snapshot.anchorProvider === AnchorProvider.NativeOnlyException &&
    !eqBytes(snapshot.nativeExceptionHash, feedConfig.nativeExceptionHash)
  ) {
    throw new Error("FeedConfigPolicyMismatch");
  }
}

