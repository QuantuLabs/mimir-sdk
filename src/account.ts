import { PublicKey } from "@solana/web3.js";
import { freshCanonicalAuthority } from "./internal/canonicalAuthority.js";
import { Q64 } from "./math.js";
import {
  decodeFeedConfigHeader,
  decodeFeedReservationHeader,
  decodeFeedTwapStateHeader,
  decodeOracleRegistryHeader,
  decodeSourceConfigHeader,
  decodeSourceObservationRingHeader,
  decodeSourcingPlanHeader,
  decodeFeedSnapshotHeader,
  verifyFeedConfigForSnapshot,
  verifyFeedTwapStateHeader,
  verifyRegistryForSnapshot,
  verifySourceConfigHeader,
  verifySourceObservationRingHeader,
  verifySourcingPlanForSnapshot,
  assertPlainSnapshotSource,
  verifySnapshotHeader,
  decodeCompositeFeedConfigHeader,
  decodeCompositeSnapshotHeader,
  computeCompositeComponentSnapshotHash,
} from "./codec.js";
import {
  findCompositeFeedConfigPda,
  findCompositeSnapshotPda,
  findFeedConfigPda,
  findFeedReservationPda,
  findFeedSnapshotPda,
  findFeedTwapPda,
  findOracleRegistryPda,
  findSourceConfigPda,
  findSourceRingPda,
  findSourcingPlanPda,
} from "./pda.js";
import type {
  FeedConfigHeader,
  CompositeFeedConfigHeader,
  CompositeSnapshotHeader,
  FeedReservationHeader,
  FeedSnapshotHeader,
  FeedTwapStateHeader,
  SnapshotPolicy,
  SourceConfigHeader,
  SourceObservationRingHeader,
  SourcingPlanHeader,
} from "./types.js";

const { MIMIR_PROGRAM_ID: CANONICAL_MIMIR_PROGRAM_ID, RiskTier, VerifyFlags, ZERO_PUBLIC_KEY } =
  freshCanonicalAuthority(PublicKey);

function countSetBits64(value: bigint): number {
  let count = 0;
  let remaining = value;
  while (remaining > 0n) {
    count += Number(remaining & 1n);
    remaining >>= 1n;
  }
  return count;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function q64MulDown(left: bigint, right: bigint): bigint {
  return (left * right) / Q64;
}

export function verifyFeedReservationAccount(args: {
  feedReservation: PublicKey;
  owner: PublicKey;
  data: Uint8Array;
  expectedFeedId: Uint8Array;
  expectedAuthority?: PublicKey;
  expectedStatus?: number;
  programId?: PublicKey;
}): FeedReservationHeader {
  const programId = args.programId ?? CANONICAL_MIMIR_PROGRAM_ID;
  if (!args.owner.equals(programId)) throw new Error("InvalidAccountOwner");
  const [expectedReservation, expectedBump] = findFeedReservationPda(args.expectedFeedId, programId);
  if (!args.feedReservation.equals(expectedReservation)) {
    throw new Error("InvalidFeedReservationAddress");
  }
  const header = decodeFeedReservationHeader(args.data);
  if (header.bump !== expectedBump || !bytesEqual(header.feedId, args.expectedFeedId)) {
    throw new Error("InvalidFeedReservationAddress");
  }
  if (header.maxRiskTier === RiskTier.Unrated) {
    throw new Error("InvalidFeedReservation");
  }
  if (args.expectedAuthority && !new PublicKey(header.authority).equals(args.expectedAuthority)) {
    throw new Error("InvalidGovernanceAuthority");
  }
  if (args.expectedStatus !== undefined && header.status !== args.expectedStatus) {
    throw new Error("InvalidFeedReservation");
  }
  return header;
}

export function verifyFeedSnapshotAccount(args: {
  snapshot: PublicKey;
  owner: PublicKey;
  data: Uint8Array;
  policy: SnapshotPolicy;
  feedConfig?: {
    pubkey: PublicKey;
    owner: PublicKey;
    data: Uint8Array;
  };
  registry?: {
    pubkey: PublicKey;
    owner: PublicKey;
    data: Uint8Array;
  };
  sourcingPlan?: {
    pubkey: PublicKey;
    owner: PublicKey;
    data: Uint8Array;
  };
  feedTwap?: {
    pubkey: PublicKey;
    owner: PublicKey;
    data: Uint8Array;
  };
  programId?: PublicKey;
}): FeedSnapshotHeader {
  const programId = args.programId ?? CANONICAL_MIMIR_PROGRAM_ID;
  if (!args.owner.equals(programId)) throw new Error("InvalidAccountOwner");

  const header = decodeFeedSnapshotHeader(args.data);
  assertPlainSnapshotSource(header);
  if ((args.policy.flags & VerifyFlags.RequireCanonicalSnapshot) !== 0) {
    const expectedSnapshot = findFeedSnapshotPda(args.policy.expectedFeedId, programId)[0];
    if (!args.snapshot.equals(expectedSnapshot)) throw new Error("InvalidSnapshotAddress");
  }

  const [expectedFeedConfig, expectedFeedConfigBump] = findFeedConfigPda(header.feedId, programId);
  if (!new PublicKey(header.feedConfig).equals(expectedFeedConfig)) {
    throw new Error("InvalidFeedConfigAddress");
  }

  let feedConfigHeader: FeedConfigHeader | undefined;
  if ((args.policy.flags & VerifyFlags.RequireLiveFeedConfig) !== 0) {
    if (!args.feedConfig) throw new Error("MissingFeedConfig");
    if (!args.feedConfig.owner.equals(programId)) throw new Error("InvalidAccountOwner");
    if (!args.feedConfig.pubkey.equals(expectedFeedConfig)) {
      throw new Error("InvalidFeedConfigAddress");
    }
    feedConfigHeader = decodeFeedConfigHeader(args.feedConfig.data);
    if (feedConfigHeader.bump !== expectedFeedConfigBump) {
      throw new Error("InvalidFeedConfigAddress");
    }
    verifyFeedConfigForSnapshot(feedConfigHeader, header, args.policy);
  }

  let registryHeader: ReturnType<typeof decodeOracleRegistryHeader> | undefined;
  if ((args.policy.flags & VerifyFlags.RequireLiveRegistry) !== 0) {
    if (!args.registry) throw new Error("MissingRegistry");
    if (!args.registry.owner.equals(programId)) throw new Error("InvalidAccountOwner");
    const [expectedRegistry, expectedRegistryBump] = findOracleRegistryPda(0, programId);
    if (!args.registry.pubkey.equals(expectedRegistry)) throw new Error("InvalidRegistryAddress");
    registryHeader = decodeOracleRegistryHeader(args.registry.data);
    if (registryHeader.bump !== expectedRegistryBump) throw new Error("InvalidRegistryAddress");
    verifyRegistryForSnapshot(registryHeader, header, feedConfigHeader);
  }

  let planHeader: SourcingPlanHeader | undefined;
  if ((args.policy.flags & VerifyFlags.RequireLiveSourcingPlan) !== 0) {
    if (!args.sourcingPlan) throw new Error("MissingSourcingPlan");
    if (!args.sourcingPlan.owner.equals(programId)) throw new Error("InvalidAccountOwner");
    const [expectedPlan, expectedPlanBump] = findSourcingPlanPda(
      header.feedId,
      header.sourcingPlanId,
      header.sourcingPlanVersion,
      programId,
    );
    if (!args.sourcingPlan.pubkey.equals(expectedPlan)) {
      throw new Error("InvalidSourcingPlanAddress");
    }
    planHeader = decodeSourcingPlanHeader(args.sourcingPlan.data);
    if (planHeader.bump !== expectedPlanBump) throw new Error("InvalidSourcingPlanAddress");
    verifySourcingPlanForSnapshot(
      planHeader,
      header,
      args.policy,
      feedConfigHeader,
      registryHeader,
    );
  }

  if ((args.policy.flags & VerifyFlags.RequireLiveTwapState) !== 0) {
    if (!planHeader) throw new Error("MissingSourcingPlan");
    if (!args.feedTwap) throw new Error("MissingFeedTwap");
    if (!args.feedTwap.owner.equals(programId)) throw new Error("InvalidAccountOwner");
    if (new PublicKey(planHeader.twapState).equals(ZERO_PUBLIC_KEY)) {
      throw new Error("InvalidTwapStateAddress");
    }
    if (!args.feedTwap.pubkey.equals(new PublicKey(planHeader.twapState))) {
      throw new Error("InvalidTwapStateAddress");
    }
    const twapHeader = decodeFeedTwapStateHeader(args.feedTwap.data);
    const [expectedTwap, expectedTwapBump] = findFeedTwapPda(
      header.feedId,
      twapHeader.twapVersion,
      programId,
    );
    if (!args.feedTwap.pubkey.equals(expectedTwap)) throw new Error("InvalidTwapStateAddress");
    if (twapHeader.bump !== expectedTwapBump) throw new Error("InvalidTwapStateAddress");
    verifyFeedTwapStateHeader(
      twapHeader,
      header.feedId,
      twapHeader.twapVersion,
      planHeader.planHash,
      args.policy.clockSlot,
      args.policy.maxSnapshotAgeSlots,
      args.policy.maxSourceActivityAgeSlots,
    );
    if (
      args.policy.expectedTwapRevision !== 0n &&
      (args.policy.minimumRevision === true
        ? twapHeader.revision < args.policy.expectedTwapRevision
        : twapHeader.revision !== args.policy.expectedTwapRevision)
    ) {
      throw new Error("UnexpectedTwapRevision");
    }
    const confidenceDelta =
      (twapHeader.twapShortX64 * BigInt(twapHeader.maxConfidenceBps) + 9_999n) / 10_000n;
    const expectedPriceLowerX64 = twapHeader.twapShortX64 - confidenceDelta;
    const expectedPriceUpperX64 = twapHeader.twapShortX64 + confidenceDelta;
    if (
      (![1, 5, 6, 7].includes(header.snapshotSource) && (header.twapShortEndSlot !== twapHeader.shortEndSlot ||
        header.twapMediumEndSlot !== twapHeader.mediumEndSlot ||
        header.twapLongEndSlot !== twapHeader.longEndSlot ||
        header.oldestSourceActivitySlot !== twapHeader.sourceActivitySlotMin)) ||
      header.priceX64 !== twapHeader.twapShortX64 ||
      expectedPriceLowerX64 <= 0n ||
      expectedPriceUpperX64 > (1n << 128n) - 1n ||
      header.priceLowerX64 !== expectedPriceLowerX64 ||
      header.priceUpperX64 !== expectedPriceUpperX64 ||
      header.freshnessProfile !== twapHeader.freshnessProfile ||
      header.sourceMask !== twapHeader.sourceMask ||
      header.sourceCount > countSetBits64(twapHeader.sourceMask) ||
      header.coverageRatioBps > twapHeader.coverageRatioBps ||
      header.confidenceBps !== twapHeader.maxConfidenceBps ||
      header.dispersionBps !== twapHeader.maxDispersionBps ||
      header.capModelFlags !== twapHeader.capModelFlags ||
      header.econLossBandBps !== twapHeader.econLossBandBps ||
      header.attackerSetWeightBps !== twapHeader.attackerSetWeightBps ||
      header.attackerSetSourceCount !== twapHeader.attackerSetSourceCount ||
      header.effectiveSourceCount !== twapHeader.effectiveSourceCount ||
      header.attackerSourceMask !== twapHeader.attackerSourceMask ||
      header.attackerSetEconLossFloorNative !==
        twapHeader.attackerSetEconLossFloorWindowNative ||
      header.attackerSetCapitalRequiredFloorNative !==
        twapHeader.attackerSetCapitalRequiredFloorWindowNative ||
      header.attackerSetSourceCount > twapHeader.sourceTableCount
    ) {
      throw new Error("InvalidTwapState");
    }
  }

  verifySnapshotHeader(header, args.policy, {
    snapshot: args.snapshot,
    programId,
  });
  return header;
}

export function verifyCompositeSnapshotAccount(args: {
  snapshot: PublicKey;
  owner: PublicKey;
  data: Uint8Array;
  clockSlot: bigint;
  expectedCompositeFeedId?: Uint8Array;
  maxSnapshotAgeSlots?: number;
  config?: {
    pubkey: PublicKey;
    owner: PublicKey;
    data: Uint8Array;
  };
  programId?: PublicKey;
}): CompositeSnapshotHeader {
  const programId = args.programId ?? CANONICAL_MIMIR_PROGRAM_ID;
  if (!args.owner.equals(programId)) throw new Error("InvalidAccountOwner");

  const header = decodeCompositeSnapshotHeader(args.data, programId);
  if (
    args.expectedCompositeFeedId != null &&
    !bytesEqual(header.compositeFeedId, args.expectedCompositeFeedId)
  ) {
    throw new Error("InvalidCompositeSnapshotAddress");
  }
  const [expectedSnapshot] = findCompositeSnapshotPda(
    header.compositeFeedId,
    programId,
  );
  if (!args.snapshot.equals(expectedSnapshot)) {
    throw new Error("InvalidCompositeSnapshotAddress");
  }
  if (args.clockSlot > header.validUntilSlot) {
    throw new Error("StaleCompositeSnapshot");
  }
  if (
    args.maxSnapshotAgeSlots !== undefined &&
    args.clockSlot > header.snapshotSlot + BigInt(args.maxSnapshotAgeSlots)
  ) {
    throw new Error("StaleCompositeSnapshot");
  }
  if (
    !bytesEqual(
      header.componentSnapshotHash,
      computeCompositeComponentSnapshotHash(header),
    )
  ) {
    throw new Error("InvalidCompositeSnapshot");
  }
  if (
    header.snapshotSlot > args.clockSlot ||
    header.oldestComponentSnapshotSlot > args.clockSlot ||
    header.oldestComponentActivitySlot > args.clockSlot
  ) {
    throw new Error("InvalidCompositeSnapshot");
  }
  let summedContributionX64 = 0n;
  for (let index = 0; index < header.componentCount; index += 1) {
    const component = header.components[index]!;
    if (component.snapshotSlot > args.clockSlot) {
      throw new Error("InvalidCompositeSnapshot");
    }
    summedContributionX64 += component.contributionX64;
  }
  if (summedContributionX64 !== header.priceX64) {
    throw new Error("InvalidCompositeSnapshot");
  }

  const [expectedCompositeConfig, expectedCompositeConfigBump] =
    findCompositeFeedConfigPda(header.compositeFeedId, programId);
  if (!new PublicKey(header.compositeConfig).equals(expectedCompositeConfig)) {
    throw new Error("InvalidCompositeFeedConfigAddress");
  }

  let configHeader: CompositeFeedConfigHeader | undefined;
  if (args.config != null) {
    if (!args.config.owner.equals(programId)) throw new Error("InvalidAccountOwner");
    if (!args.config.pubkey.equals(expectedCompositeConfig)) {
      throw new Error("InvalidCompositeFeedConfigAddress");
    }
    configHeader = decodeCompositeFeedConfigHeader(args.config.data, programId);
    if (
      configHeader.bump !== expectedCompositeConfigBump ||
      configHeader.componentCount !== header.componentCount ||
      configHeader.configRevision !== header.configRevision ||
      !bytesEqual(configHeader.compositeFeedId, header.compositeFeedId) ||
      !bytesEqual(configHeader.componentSetHash, header.componentSetHash)
    ) {
      throw new Error("InvalidCompositeFeedConfig");
    }
    if (
      args.clockSlot >
        header.oldestComponentSnapshotSlot +
          BigInt(configHeader.maxComponentSnapshotAgeSlots) ||
      (header.oldestComponentActivitySlot !== 0n &&
        args.clockSlot >
          header.oldestComponentActivitySlot +
            BigInt(configHeader.maxComponentSnapshotAgeSlots))
    ) {
      throw new Error("StaleCompositeSnapshot");
    }
    for (let index = 0; index < header.componentCount; index += 1) {
      const component = header.components[index]!;
      const configured = configHeader.components[index]!;
      if (!bytesEqual(component.feedId, configured.feedId)) {
        throw new Error("InvalidCompositeSnapshot");
      }
      if (
        component.contributionX64 !==
        q64MulDown(component.priceX64, configured.quantityX64)
      ) {
        throw new Error("InvalidCompositeSnapshot");
      }
    }
  }

  return header;
}

export function verifySourceConfigAccount(args: {
  sourceConfig: PublicKey;
  owner: PublicKey;
  data: Uint8Array;
  expectedFeedId: Uint8Array;
  expectedSourceIndex: number;
  programId?: PublicKey;
}): SourceConfigHeader {
  const programId = args.programId ?? CANONICAL_MIMIR_PROGRAM_ID;
  if (!args.owner.equals(programId)) throw new Error("InvalidAccountOwner");
  const [expectedSourceConfig, expectedBump] = findSourceConfigPda(
    args.expectedFeedId,
    args.expectedSourceIndex,
    programId,
  );
  if (!args.sourceConfig.equals(expectedSourceConfig)) {
    throw new Error("InvalidSourceConfigAddress");
  }
  const header = decodeSourceConfigHeader(args.data);
  if (header.bump !== expectedBump) throw new Error("InvalidSourceConfigAddress");
  verifySourceConfigHeader(header, args.expectedFeedId, args.expectedSourceIndex);
  return header;
}

export function verifyFeedTwapStateAccount(args: {
  feedTwap: PublicKey;
  owner: PublicKey;
  data: Uint8Array;
  expectedFeedId: Uint8Array;
  expectedTwapVersion: number;
  expectedPlanHash: Uint8Array;
  clockSlot: bigint;
  maxTwapAgeSlots: number;
  maxSourceActivityAgeSlots?: number;
  programId?: PublicKey;
}): FeedTwapStateHeader {
  const programId = args.programId ?? CANONICAL_MIMIR_PROGRAM_ID;
  if (!args.owner.equals(programId)) throw new Error("InvalidAccountOwner");
  const [expectedTwap, expectedBump] = findFeedTwapPda(
    args.expectedFeedId,
    args.expectedTwapVersion,
    programId,
  );
  if (!args.feedTwap.equals(expectedTwap)) throw new Error("InvalidTwapStateAddress");
  const header = decodeFeedTwapStateHeader(args.data);
  if (header.bump !== expectedBump) throw new Error("InvalidTwapStateAddress");
  verifyFeedTwapStateHeader(
    header,
    args.expectedFeedId,
    args.expectedTwapVersion,
    args.expectedPlanHash,
    args.clockSlot,
    args.maxTwapAgeSlots,
    args.maxSourceActivityAgeSlots,
  );
  return header;
}

export function verifySourceObservationRingAccount(args: {
  sourceRing: PublicKey;
  owner: PublicKey;
  data: Uint8Array;
  expectedFeedId: Uint8Array;
  expectedSourceIndex: number;
  expectedRingVersion: number;
  expectedPlanHash: Uint8Array;
  clockSlot: bigint;
  maxObservationAgeSlots: number;
  sourceConfig?: {
    pubkey: PublicKey;
    owner: PublicKey;
    data: Uint8Array;
  };
  programId?: PublicKey;
}): SourceObservationRingHeader {
  const programId = args.programId ?? CANONICAL_MIMIR_PROGRAM_ID;
  if (!args.owner.equals(programId)) throw new Error("InvalidAccountOwner");
  const [expectedRing, expectedRingBump] = findSourceRingPda(
    args.expectedFeedId,
    args.expectedSourceIndex,
    args.expectedRingVersion,
    programId,
  );
  if (!args.sourceRing.equals(expectedRing)) throw new Error("InvalidSourceRingAddress");
  const header = decodeSourceObservationRingHeader(args.data);
  if (header.bump !== expectedRingBump) throw new Error("InvalidSourceRingAddress");
  const [expectedSourceConfig, expectedSourceConfigBump] = findSourceConfigPda(
    args.expectedFeedId,
    args.expectedSourceIndex,
    programId,
  );
  if (!new PublicKey(header.sourceConfig).equals(expectedSourceConfig)) {
    throw new Error("InvalidSourceConfigAddress");
  }
  if (args.sourceConfig) {
    if (!args.sourceConfig.owner.equals(programId)) throw new Error("InvalidAccountOwner");
    if (!args.sourceConfig.pubkey.equals(expectedSourceConfig)) {
      throw new Error("InvalidSourceConfigAddress");
    }
    const sourceConfigHeader = decodeSourceConfigHeader(args.sourceConfig.data);
    if (sourceConfigHeader.bump !== expectedSourceConfigBump) {
      throw new Error("InvalidSourceConfigAddress");
    }
    verifySourceConfigHeader(sourceConfigHeader, args.expectedFeedId, args.expectedSourceIndex);
    if (
      sourceConfigHeader.adapterType !== header.adapterType ||
      !new PublicKey(sourceConfigHeader.poolOrMarket).equals(new PublicKey(header.poolOrMarket)) ||
      sourceConfigHeader.sourceConfigRevision !== header.sourceConfigRevision ||
      sourceConfigHeader.sourceSetRevision !== header.sourceSetRevision
    ) {
      throw new Error("InvalidSourceRing");
    }
  }
  verifySourceObservationRingHeader(
    header,
    args.expectedFeedId,
    args.expectedSourceIndex,
    args.expectedRingVersion,
    args.expectedPlanHash,
    args.clockSlot,
    args.maxObservationAgeSlots,
  );
  return header;
}
