import { address } from "@solana/kit";
import { findProgramAddressCached } from "../pda.js";
import { PublicKey } from "@solana/web3.js";
import type { FeedConfigHeader, SourceConfigHeader, SourceObservationRingV1Header, SourcingPlanHeader,
  MimirMixedBoundedProofV1 } from "../types.js";
import { computeRaydiumClmmNativeTwapObservationFingerprint, computeRaydiumCpmmNativeBoundedFingerprint,
  verifyOrcaExecutableGeneration, mimirOrcaMarkerQuietInterval, mimirExecutableGenerationPins, mimirOrcaWhirlpoolsConfigAddress,
  mimirVenueDeploymentUnix, type MimirGenerationCluster,
  decodeMimirBrowserDammReserveTemporalModuleV3, dlmmMonoFingerprint, decodeMimirBrowserSourceTemporalModuleV1, decodeMimirBrowserCpmmQuietTemporalModuleV2,
  verifyDammExecutableGeneration, verifyCpmmExecutableGeneration, deriveMimirMixedClmmSample, mimirNativeLagEnvelope } from "./nativeMonoRefreshCore.js";
import { mimirSampledSourceAdapters, decodeMimirSampledTemporalModule, projectMimirSampledHistory, summarizeMimirSampledState,
  verifyMimirSampledExecutableGeneration, mimirSampledQualityLimits, type MimirSampledState } from "./sampledTemporalCore.js";
import { decodeMimirCurrentPointModule } from "./currentPointCore.js";

export type MimirMixedNativeOpeningV1 = Exclude<MimirMixedBoundedProofV1, { openingMode: "execution" }> &
  Readonly<{ finalLowerX64?: bigint; finalUpperX64?: bigint;
    /** Kind 1/3 envelope rings: live economic spot re-read with the writer's normalization, and the family base confidence. */
    lagEnvelope?: Readonly<{ spotX64: bigint; baseConfidenceBps: number }> }>;
const fail = (message = "InvalidMixedBoundedProof"): never => { throw new Error(message); };
const equal = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
type Endpoint = bigint | null; // null is +infinity; never an arithmetic operand.
type Shell = { address: PublicKey; owner: PublicKey; executable: boolean; data: Uint8Array };
export interface MimirMixedSupportV1 {
  readonly sourceIndex: number; readonly kind: MimirMixedBoundedProofV1["kind"];
  readonly startUnixTs: bigint; readonly endUnixTs: bigint;
  readonly endSlot: bigint;
}
export interface MimirMixedBoundedProjectionV1 {
  readonly kind: "mixedBounded";
  readonly selectedSourceIndices: readonly number[];
  readonly validUntilSlot: bigint;
  readonly effectiveSources: readonly Readonly<{ sourceIndex: number; weightBps: number }>[];
  readonly qualifiedMask: bigint; readonly qualifiedWeightBps: number;
  readonly supports: readonly MimirMixedSupportV1[];
  /** Every declared nonzero-kind proof window, including rows outside the qualified set. */
  readonly declaredSupports: readonly MimirMixedSupportV1[];
  readonly commonSupport: Readonly<{ startUnixTs: bigint; endUnixTs: bigint }>;
  readonly priceX64: bigint; readonly lowerX64: bigint; readonly upperX64: bigint;
  readonly confidenceBps: number; readonly dispersionBps: number;
  readonly capTable: readonly Readonly<{ sourceIndex: number; weightBps: number; selected: boolean;
    econLossFloorNative: bigint; capitalRequiredFloorNative: bigint }>[];
  readonly attackerWeightBps: number; readonly attackerMask: bigint;
  readonly econLossFloorNative: bigint; readonly capitalRequiredFloorNative: bigint;
  /** Source6 only: minimum depth floor across qualified effective representatives (kind 9 SourceConfig floor, native completed depth). */
  readonly sampledDepthFloorNative: bigint | null;
  /** Source7 only: F* = minimum committed SourceConfig depth floor over the full configured cohort. */
  readonly pointFloorBudgetNative: bigint | null;
}

function median(entries: readonly { sourceIndex: number; weightBps: number; value: Endpoint }[], up = false): Endpoint {
  const sorted = [...entries].sort((a, b) => a.value === b.value ? a.sourceIndex - b.sourceIndex :
    a.value === null ? 1 : b.value === null ? -1 : a.value < b.value ? -1 : 1);
  let cumulative = 0;
  for (let index = 0; index < sorted.length; index++) {
    const row = sorted[index]!; cumulative += row.weightBps;
    if (cumulative >= 5000) {
      if (cumulative !== 5000) return row.value;
      const next = sorted[index + 1] ?? fail();
      return row.value === null || next.value === null ? null : row.value + (next.value - row.value + (up ? 1n : 0n)) / 2n;
    }
  }
  return fail();
}

/** Internal projection only: callers must authenticate the complete cohort; this never grants preparation authority. */
export function projectMimirMixedBoundedV1(input: {
  feed: FeedConfigHeader; plan: SourcingPlanHeader; programId: PublicKey; clock: { slot: bigint; unixTs: bigint };
  maxObservationAgeSlots: number;
  cluster?: MimirGenerationCluster;
  /** Retained openings use authenticated publication time; current Clock still checks every freshness bound. */
  publicationUnixTs?: bigint;
  sources: readonly Readonly<{ config: SourceConfigHeader; ring: SourceObservationRingV1Header;
    sourceConfig: PublicKey; proof: MimirMixedBoundedProofV1;
    /** Execution proofs only: opening rederived from the same authenticated simulation cohort; never serialized. */
    executionOpening?: MimirMixedNativeOpeningV1;
    quiet?: Readonly<{ module: Shell; sourceProgram: Shell; sourceProgramData: Shell }> }>[];
}): MimirMixedBoundedProjectionV1 {
  const { feed, plan, clock } = input;
  if (!input.sources.length || input.sources.length > 5 || clock.unixTs < 0n) fail();
  const age = BigInt(Math.min(input.maxObservationAgeSlots, feed.maxSourceActivityAgeSlots, plan.maxSourceActivityAgeSlots));
  const keys = (row: typeof input.sources[number]) => row.proof.kind === 9 || row.proof.kind === 10 || row.ring.pointOnly ? [0n, 0n] :
    [row.ring.completedMinEconLossFloorNative, row.ring.completedMinCapitalRequiredFloorNative];
  const cheaper = (a: typeof input.sources[number], b: typeof input.sources[number]) => {
    const [aLoss, aCapital] = keys(a), [bLoss, bCapital] = keys(b);
    return aLoss! < bLoss! || aLoss === bLoss && (aCapital! < bCapital! || aCapital === bCapital && a.config.sourceIndex < b.config.sourceIndex);
  };
  const point = input.sources.some(row => row.proof.kind === 10 || row.config.temporalMode === "current-point");
  const source6 = point || input.sources.some(row => row.proof.kind === 9);
  const normalize = (rows: typeof input.sources) => {
    const groups = new Map<number, typeof input.sources[number]>();
    for (const row of rows) {
      const previous = groups.get(row.ring.routeCorrelationGroup);
      if (!previous || cheaper(row, previous)) groups.set(row.ring.routeCorrelationGroup, row);
    }
    const effective = [...groups.values()], total = effective.reduce((sum, row) => sum + row.ring.sourceWeightBps, 0);
    if (total <= 0) fail();
    const weights = effective.map(row => ({ row, sourceIndex: row.config.sourceIndex,
      weightBps: Math.floor(row.ring.sourceWeightBps * 10000 / total), remainder: row.ring.sourceWeightBps * 10000 % total }));
    const order = [...weights].sort((a, b) => b.remainder - a.remainder || a.sourceIndex - b.sourceIndex);
    const residual = 10000 - weights.reduce((sum, row) => sum + row.weightBps, 0);
    if (residual < 0 || residual > order.length) fail();
    for (let index = 0; index < residual; index++) order[index]!.weightBps++;
    if (weights.some(row => row.weightBps <= 0)) fail();
    return weights.sort((a, b) => a.sourceIndex - b.sourceIndex);
  };
  const dispersion = (value: bigint, center: bigint, outward = false) => {
    if (center <= 0n) return fail();
    const product = (value > center ? value - center : center - value) * 10000n;
    if (product >= 1n << 128n) fail();
    return (product + (outward ? center - 1n : 0n)) / center;
  };
  input.sources.forEach(({ config, ring }, index) => {
    if (config.sourceIndex !== index || ring.sourceIndex !== index || ring.newestSlot > clock.slot ||
        ring.completedEndSlot > clock.slot || ring.completedActivitySlot > clock.slot || ring.completedPriceX64 <= 0n ||
        ring.sourceWeightBps !== config.maxSourceWeightBps || ring.routeCorrelationGroup !== config.routeCorrelationGroup ||
        ring.sourceConfigRevision !== config.sourceConfigRevision || ring.sourceSetRevision !== config.sourceSetRevision ||
        !equal(ring.selectedPlanHash, plan.planHash)) fail();
  });
  const supports = new Map<number, MimirMixedSupportV1>();
  const bounds = new Map<number, { lower: bigint; upper: bigint }>();
  const sampled = new Map<number, MimirSampledState>();
  const full = new Map<number, ReturnType<typeof summarizeMimirSampledState>>();
  // Every declared proof is checked, including configured rows filtered out of E.
  for (const row of input.sources) {
    const { config: source, ring } = row;
    const execution = "openingMode" in row.proof && row.proof.openingMode === "execution";
    const proof = (execution ? row.executionOpening ?? fail("MimirExecutionNativeEvidenceMissing") : row.proof) as
      MimirMixedNativeOpeningV1;
    if (execution && (proof.kind !== row.proof.kind ||
        ring.newestSlot !== clock.slot || ring.completedEndSlot !== clock.slot)) fail("InvalidMixedNativeOpening");
    if (ring.pointOnly && proof.kind !== 0 && proof.kind !== 9 && proof.kind !== 10) fail();
    if ((source.temporalMode === "current-point") !== (proof.kind === 10) && proof.kind !== 0 || source.temporalMode === "current-point" && proof.kind === 0) fail();
    if (proof.kind === 0) { if (row.quiet) fail(); continue; }
    if ((proof.kind as number) > 7 && proof.kind !== 9 && proof.kind !== 10) fail();
    let startUnixTs: bigint, endUnixTs: bigint, supportEndSlot = ring.completedEndSlot,
      lower = ring.completedPriceX64, upper = lower;
    if (proof.kind === 7) {
      const quiet = row.quiet ?? fail();
      const portable = (shell: Shell) => ({ ...shell, address: address(shell.address.toBase58()), owner: address(shell.owner.toBase58()) });
      if (source.adapterType !== 0 || source.adapterVersion !== 0 || ring.windowFlags !== 1 ||
          ring.newestSlot !== clock.slot || ring.completedEndSlot !== clock.slot || quiet.module.executable ||
          !quiet.module.owner.equals(quiet.sourceProgram.address) || !equal(source.programId, quiet.sourceProgram.address.toBytes()) ||
          !equal(quiet.module.address.toBytes(), source.poolOrMarket) ||
          !verifyOrcaExecutableGeneration(portable(quiet.sourceProgram), portable(quiet.sourceProgramData), input.cluster)) fail();
      const interval = mimirOrcaMarkerQuietInterval(quiet.module.data, new PublicKey(mimirOrcaWhirlpoolsConfigAddress(input.cluster)).toBytes(),
        clock.unixTs, mimirVenueDeploymentUnix(input.cluster).orca);
      if (!interval.ready) fail("MixedBoundedWarming");
      startUnixTs = interval.startUnixTs; endUnixTs = clock.unixTs; supportEndSlot = clock.slot;
    } else if (proof.kind === 10) {
      const quiet = row.quiet ?? fail();
      const adapter = source.adapterType === 4 || source.adapterType === 6 ? mimirSampledSourceAdapters(input.cluster)[source.adapterType] : fail();
      const modulePda = findProgramAddressCached([Buffer.from("source_temporal"), Buffer.from(source.feedId),
        Buffer.from([source.sourceIndex]), Buffer.from([4, 0])], input.programId)[0];
      if (ring.windowFlags !== 1 || !quiet.module.address.equals(modulePda) || !quiet.module.owner.equals(input.programId) ||
          quiet.module.executable || !equal(source.programId, quiet.sourceProgram.address.toBytes()) ||
          !verifyMimirSampledExecutableGeneration(adapter, { ...quiet.sourceProgram, address: quiet.sourceProgram.address.toBase58() },
            { ...quiet.sourceProgramData, address: quiet.sourceProgramData.address.toBase58() })) fail();
      const state = decodeMimirCurrentPointModule(quiet.module.data);
      if (!equal(state.sourceConfig, row.sourceConfig.toBytes()) || !equal(state.planHash, plan.planHash) || ring.minSlotGap !== 0 ||
          ring.lastDepthTo50BpsNative < source.minDepthTo50BpsNative || ring.lastLiquidityNative < source.minLiquidityNative ||
          state.record.slot !== clock.slot || state.record.unixTs !== clock.unixTs || ring.newestSlot !== clock.slot ||
          ring.completedEndSlot !== clock.slot || state.record.priceX64 !== ring.lastPriceX64 ||
          !equal(state.record.fingerprint, ring.lastObservationHash)) fail("MixedBoundedPointNotCurrent");
      startUnixTs = endUnixTs = clock.unixTs; supportEndSlot = clock.slot;
      lower = state.record.priceX64; upper = state.record.priceX64 + 1n;
    } else if (proof.kind === 9) {
      const quiet = row.quiet ?? fail();
      const adapter = source.adapterType === 4 || source.adapterType === 6 ? mimirSampledSourceAdapters(input.cluster)[source.adapterType] : fail();
      const modulePda = findProgramAddressCached([Buffer.from("source_temporal"), Buffer.from(source.feedId),
        Buffer.from([source.sourceIndex]), Buffer.from([4, 0])], input.programId)[0];
      const data = quiet.module.data, view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (ring.windowFlags !== 1 || !quiet.module.address.equals(modulePda) || !quiet.module.owner.equals(input.programId) ||
          quiet.module.executable || data.length !== 1280 || view.getBigUint64(8, true) !== ring.newestSlot ||
          !equal(source.programId, quiet.sourceProgram.address.toBytes()) ||
          !verifyMimirSampledExecutableGeneration(adapter, { ...quiet.sourceProgram, address: quiet.sourceProgram.address.toBase58() },
            { ...quiet.sourceProgramData, address: quiet.sourceProgramData.address.toBase58() })) fail();
      const state = decodeMimirSampledTemporalModule(data, { slot: view.getBigUint64(152, true), unixTs: view.getBigInt64(160, true),
        priceX64: ring.lastPriceX64, observationHash: ring.lastObservationHash }, { ...mimirSampledQualityLimits(feed, plan),
        depthFloor: source.minDepthTo50BpsNative });
      const summary = summarizeMimirSampledState(state);
      if (!summary.ready) fail("MixedBoundedWarming");
      if (state.close.slot > clock.slot || clock.slot - state.close.slot > age) fail();
      sampled.set(source.sourceIndex, state); full.set(source.sourceIndex, summary);
      startUnixTs = summary.startUnixTs; endUnixTs = summary.endUnixTs; supportEndSlot = state.close.slot;
      lower = summary.lowerX64; upper = summary.upperX64;
    } else if (proof.kind === 4 || proof.kind === 5 || proof.kind === 6) {
      const quiet = row.quiet ?? fail();
      const version = proof.kind === 6 ? 3 : proof.kind === 4 ? 1 : 2;
      const modulePda = findProgramAddressCached([Buffer.from("source_temporal"), Buffer.from(source.feedId),
        Buffer.from([source.sourceIndex]), Buffer.from([version, 0])], input.programId)[0];
      const portable = (shell: Shell) => ({ ...shell, address: address(shell.address.toBase58()), owner: address(shell.owner.toBase58()) });
      if (source.adapterVersion !== 0 || source.adapterType !== (proof.kind === 5 ? 2 : 7) || ring.windowFlags !== 1 ||
          !quiet.module.address.equals(modulePda) || !quiet.module.owner.equals(input.programId) || quiet.module.executable ||
          !(proof.kind === 5 ? verifyCpmmExecutableGeneration : verifyDammExecutableGeneration)(portable(quiet.sourceProgram), portable(quiet.sourceProgramData), input.cluster)) fail();
      let endSlot: bigint, refreshedUnix: bigint;
      if (proof.kind === 4 || proof.kind === 6) {
        const module = proof.kind === 6 ? decodeMimirBrowserDammReserveTemporalModuleV3(quiet.module.data, ring) :
          decodeMimirBrowserSourceTemporalModuleV1(quiet.module.data, ring);
        const tail = "dammReserveTail" in module ? module.dammReserveTail : module.dammOnlyBTail;
        const publication = tail.publication ?? fail("MixedBoundedWarming");
        if (module.lastModuleRefreshSlot !== ring.newestSlot || tail.invalidated || source.direction !== 1) fail();
        startUnixTs = tail.anchor.unixTs; endUnixTs = publication.endUnixTs; endSlot = publication.endSlot;
        refreshedUnix = tail.lastObservationUnixTs; lower = publication.lowerX64; upper = publication.upperX64;
      } else {
        const module = decodeMimirBrowserCpmmQuietTemporalModuleV2(quiet.module.data, ring), b = module.anchorB ?? fail("MixedBoundedWarming");
        if (module.ringNewestSlot !== ring.newestSlot || module.invalidated || module.qLowerX64 === 0n ||
            new DataView(quiet.module.data.buffer, quiet.module.data.byteOffset).getUint16(18, true) !== 7) fail();
        startUnixTs = module.anchorA.unixTs; endUnixTs = b.unixTs; endSlot = b.slot;
        refreshedUnix = module.lastRefreshUnixTs; lower = module.qLowerX64; upper = module.qUpperX64;
      }
      if (refreshedUnix > clock.unixTs || endSlot > clock.slot || clock.slot - endSlot > age ||
          lower > ring.completedPriceX64 || upper < ring.completedPriceX64) fail();
      const deviation = ring.completedPriceX64 - lower > upper - ring.completedPriceX64 ? ring.completedPriceX64 - lower : upper - ring.completedPriceX64;
      if ((deviation * 10000n + ring.completedPriceX64 - 1n) / ring.completedPriceX64 > BigInt(feed.maxConfidenceBps)) fail("ConfidenceTooWide");
      supportEndSlot = endSlot;
    } else {
      if (row.quiet || ring.windowFlags !== (proof.kind === 2 ? 7 : 3) || ring.lastPriceX64 !== ring.completedPriceX64 ||
          ring.completedEndSlot !== ring.newestSlot || source.adapterType !== proof.kind ||
          (source.adapterVersion !== 0 && source.adapterVersion !== 1) ||
          (proof.kind === 2 ? source.adapterVersion !== 0 : Boolean(proof.token2022) !== (source.adapterVersion === 1))) fail();
      const binding = "token2022" in proof ? proof.token2022 : undefined;
      if (binding && (!equal(binding.selectedMint, binding.selectedBase ? source.baseMint : source.quoteMint) ||
          binding.selectedMultiplierQ64 < 1n << 32n || binding.selectedMultiplierQ64 > 1n << 96n)) fail();
      let fingerprint: Uint8Array;
      const envelope = proof.kind !== 2 && proof.lagEnvelope ? mimirNativeLagEnvelope(ring.completedPriceX64,
        proof.lagEnvelope.spotX64, proof.lagEnvelope.baseConfidenceBps, feed.maxConfidenceBps) : null;
      if (envelope) { lower = envelope.lowerX64; upper = envelope.upperX64; }
      if (proof.kind === 1) {
        const publication = execution ? clock.unixTs : input.publicationUnixTs ?? clock.unixTs;
        if (publication < 0n || publication > clock.unixTs) fail();
        const sample = deriveMimirMixedClmmSample(proof, publication);
        fingerprint = computeRaydiumClmmNativeTwapObservationFingerprint({ observationState: proof.oraclePubkey,
          sourceConfig: row.sourceConfig.toBytes(), pool: source.poolOrMarket, selectedPlanHash: plan.planHash,
          sourceConfigRevision: source.sourceConfigRevision, sourceSetRevision: source.sourceSetRevision, adapterVersion: source.adapterVersion,
          sample, lagEnvelope: envelope,
          ...(binding ? { token2022Binding: { mintAddress: binding.selectedMint, selectedBase: binding.selectedBase,
            selectedMultiplierQ64: binding.selectedMultiplierQ64 } } : {}) });
        startUnixTs = proof.oldTimestamp; endUnixTs = sample.endTimestamp;
      } else if (proof.kind === 2) {
        fingerprint = computeRaydiumCpmmNativeBoundedFingerprint(proof.oraclePubkey, { startTimestamp: proof.oldTimestamp,
          endTimestamp: proof.newTimestamp, startCumulativeX32: proof.selectedOldCumulative, endCumulativeX32: proof.selectedNewCumulative,
          lowerX64: proof.lowerX64, upperX64: proof.upperX64, centerX64: 0n });
        const span = proof.newTimestamp - proof.oldTimestamp;
        if (span < 134n || span > 1_800n) fail("InvalidMixedFullSupport");
        if (proof.lowerX64 <= 0n || proof.upperX64 < proof.lowerX64 ||
            ring.completedPriceX64 !== proof.lowerX64 + (proof.upperX64 - proof.lowerX64) / 2n) fail();
        lower = proof.lowerX64; upper = proof.upperX64;
        if (execution) {
          lower = proof.finalLowerX64 ?? fail("MimirExecutionNativeEvidenceMissing");
          upper = proof.finalUpperX64 ?? fail("MimirExecutionNativeEvidenceMissing");
          if (lower > proof.lowerX64 || upper < proof.upperX64) fail("InvalidMixedNativeOpening");
        }
        startUnixTs = proof.oldTimestamp + 14n; endUnixTs = proof.newTimestamp;
      } else {
        fingerprint = dlmmMonoFingerprint(address(new PublicKey(proof.oraclePubkey).toBase58()), address(row.sourceConfig.toBase58()),
          address(new PublicKey(source.poolOrMarket).toBase58()), plan.planHash, proof.oldTimestamp, proof.newTimestamp,
          proof.oldCumulativeBin, proof.newCumulativeBin, binding ? { mintAddress: binding.selectedMint,
            selectedBase: binding.selectedBase, selectedMultiplierQ64: binding.selectedMultiplierQ64 } : undefined, envelope);
        startUnixTs = proof.oldTimestamp; endUnixTs = proof.newTimestamp;
      }
      if (!equal(fingerprint, ring.lastObservationHash)) fail("InvalidMixedNativeOpening");
    }
    if (startUnixTs < 0n || (proof.kind !== 10 && endUnixTs - startUnixTs < 120n) || endUnixTs > clock.unixTs || clock.unixTs - endUnixTs > 60n ||
        lower <= 0n || upper < lower || upper >= 1n << 128n) fail("InvalidMixedFullSupport");
    supports.set(source.sourceIndex, { sourceIndex: source.sourceIndex, kind: proof.kind, startUnixTs, endUnixTs, endSlot: supportEndSlot });
    bounds.set(source.sourceIndex, { lower, upper });
  }
  const eligible = input.sources.filter(({ ring }) => (ring.windowFlags & 1) !== 0 &&
    clock.slot - ring.completedEndSlot <= age &&
    (ring.completedActivitySlot === 0n || clock.slot - ring.completedActivitySlot <= age));
  if (eligible.length < plan.minSources) fail("StaleSourceActivity");
  const typed = (row: typeof input.sources[number]) => full.get(row.config.sourceIndex)?.meanX64 ?? row.ring.completedPriceX64;
  const preliminary = median(normalize(eligible).map(row => ({ ...row, value: typed(row.row) }))) ?? fail();
  const selected = eligible.filter(row => dispersion(typed(row), preliminary) <= BigInt(plan.maxDispersionBps));
  if (selected.length < plan.minSources || selected.length < feed.minSourceCount ||
      new Set(selected.map(row => row.config.venueGroup).filter(group => group !== 0xffff)).size < Math.max(plan.minVenues, feed.minVenueCount) ||
      new Set(selected.map(row => row.config.routeCorrelationGroup).filter(group => group !== 0xffff)).size < Math.max(plan.minCorrelationGroups, feed.minCorrelationGroupCount))
    fail("InsufficientSourceCount");
  const effective = normalize(selected);
  const qualified = effective.filter(row => supports.has(row.sourceIndex));
  const qualifiedWeightBps = qualified.reduce((sum, row) => sum + row.weightBps, 0);
  if (qualifiedWeightBps <= 5000) fail("MixedBoundedInsufficientFiniteWeight");
  const fullSupports = qualified.map(row => supports.get(row.sourceIndex)!);
  const startUnixTs = fullSupports.reduce((value, row) => row.startUnixTs > value ? row.startUnixTs : value, 0n);
  const endUnixTs = fullSupports.reduce((value, row) => row.endUnixTs < value ? row.endUnixTs : value, fullSupports[0]!.endUnixTs);
  if (!point && endUnixTs - startUnixTs < 120n) fail("MixedBoundedCommonSupportTooShort");
  const points = new Map<number, bigint>(), confidences = new Map<number, bigint>();
  for (const [sourceIndex, state] of sampled) {
    if (!qualified.some(row => row.sourceIndex === sourceIndex)) continue;
    if (point) { points.set(sourceIndex, full.get(sourceIndex)!.meanX64); continue; }
    const clipped = projectMimirSampledHistory(state.records, state.close, { startUnixTs, endUnixTs, depthFloor: state.depthFloor });
    if (clipped.actualRecords < 13) fail("MixedBoundedWarming");
    if (clipped.closeDeviationBps > BigInt(state.closeLimitBps) || clipped.observedBandBps > BigInt(state.bandLimitBps)) fail("ConfidenceTooWide");
    const fullConfidence = full.get(sourceIndex)!.confidenceBps;
    confidences.set(sourceIndex, clipped.confidenceBps > fullConfidence ? clipped.confidenceBps : fullConfidence);
    points.set(sourceIndex, clipped.meanX64); bounds.set(sourceIndex, { lower: clipped.lowerX64, upper: clipped.upperX64 });
  }
  const priceX64 = median(effective.map(row => ({ ...row, value: points.get(row.sourceIndex) ?? typed(row.row) }))) ?? fail();
  const lowerX64 = median(effective.map(row => ({ ...row, value: bounds.get(row.sourceIndex)?.lower ?? 0n }))) ?? fail();
  const upperX64 = median(effective.map(row => ({ ...row, value: bounds.get(row.sourceIndex)?.upper ?? null })), source6) ?? fail();
  if (lowerX64 <= 0n || lowerX64 > priceX64 || priceX64 > upperX64) fail();
  const deviation = priceX64 - lowerX64 > upperX64 - priceX64 ? priceX64 - lowerX64 : upperX64 - priceX64;
  const width = (deviation * 10000n + priceX64 - 1n) / priceX64;
  const confidenceBps = source6 ? Math.max(1, Number(width), ...selected.map(row =>
      Number(confidences.get(row.config.sourceIndex) ?? full.get(row.config.sourceIndex)?.confidenceBps ??
        BigInt(row.ring.completedMaxConfidenceBps)))) :
    Math.max(...selected.map(row => row.ring.completedMaxConfidenceBps), Number(width));
  const dispersionBps = source6 ? Number(selected.reduce((value, row) => {
    const current = dispersion(points.get(row.config.sourceIndex) ?? typed(row), priceX64, true); return current > value ? current : value;
  }, 0n)) : Number(effective.reduce((value, row) => {
    const current = dispersion(row.row.ring.completedPriceX64, priceX64); return current > value ? current : value;
  }, 0n));
  if (confidenceBps > feed.maxConfidenceBps || dispersionBps > Math.min(feed.maxDispersionBps, plan.maxDispersionBps)) fail("ConfidenceTooWide");
  if (source6) {
    const limit = BigInt(Math.min(100, feed.maxConfidenceBps, feed.maxDispersionBps, plan.maxDispersionBps));
    if ((upperX64 - lowerX64) * 10000n > limit * priceX64 || BigInt(confidenceBps) > limit || BigInt(dispersionBps) > limit) fail("ConfidenceTooWide");
  }
  const capOrder = [...effective].sort((a, b) => cheaper(a.row, b.row) ? -1 : cheaper(b.row, a.row) ? 1 : 0);
  let attackerWeightBps = 0, attackerMask = 0n, econLossFloorNative = 0n, capitalRequiredFloorNative = 0n;
  const capTable = capOrder.map(row => {
    const selected = attackerWeightBps < 5000;
    const loss = row.row.ring.completedMinEconLossFloorNative, capital = row.row.ring.completedMinCapitalRequiredFloorNative;
    if (selected) { attackerWeightBps += row.weightBps; attackerMask |= 1n << BigInt(row.sourceIndex); econLossFloorNative += loss; capitalRequiredFloorNative += capital; }
    return { sourceIndex: row.sourceIndex, weightBps: row.weightBps, selected, econLossFloorNative: loss, capitalRequiredFloorNative: capital };
  });
  const pointFloorBudgetNative = !point ? null : input.sources.reduce((floor, row) =>
    row.config.minDepthTo50BpsNative < floor ? row.config.minDepthTo50BpsNative : floor, input.sources[0]!.config.minDepthTo50BpsNative);
  const sampledDepthFloorNative = !source6 || point ? null : qualified.reduce<bigint | null>((floor, row) => {
    const depth = sampled.get(row.sourceIndex)?.depthFloor ?? row.row.ring.completedMinDepthTo50BpsNative;
    return floor === null || depth < floor ? depth : floor;
  }, null) ?? 0n;
  if (source6) { attackerWeightBps = 0; attackerMask = 0n; econLossFloorNative = 0n; capitalRequiredFloorNative = 0n; }
  else if (econLossFloorNative <= 0n || capitalRequiredFloorNative <= 0n || econLossFloorNative >= 1n << 128n || capitalRequiredFloorNative >= 1n << 128n) fail();
  const expiry = [clock.slot + BigInt(feed.maxSnapshotAgeSlots),
    ...selected.map(row => row.ring.completedEndSlot + age), ...fullSupports.map(row => row.endSlot + age)];
  const validUntilSlot = expiry.reduce((a, b) => a < b ? a : b);
  return { kind: "mixedBounded", selectedSourceIndices: selected.map(row => row.config.sourceIndex), validUntilSlot,
    effectiveSources: effective.map(({ sourceIndex, weightBps }) => ({ sourceIndex, weightBps })),
    qualifiedMask: qualified.reduce((mask, row) => mask | 1n << BigInt(row.sourceIndex), 0n), qualifiedWeightBps,
    supports: fullSupports, declaredSupports: [...supports.values()], commonSupport: { startUnixTs, endUnixTs }, priceX64, lowerX64, upperX64, confidenceBps, dispersionBps,
    capTable, attackerWeightBps, attackerMask, econLossFloorNative, capitalRequiredFloorNative, sampledDepthFloorNative,
    pointFloorBudgetNative };
}

export class MimirMixedBoundedNoProofSubsetError extends Error {
  readonly code = "MimirMixedBoundedNoProofSubset";
  constructor(readonly causes: readonly string[]) {
    super("No Mimir mixed bounded proof subset reaches more than 5000 bps with at least 120 s common support.");
  }
}

/** Demotes surplus proofs to kind 0; prefers most qualified weight, then longest common support, then most retained proofs. */
export function selectMimirMixedBoundedProofSubsetV1(input: Parameters<typeof projectMimirMixedBoundedV1>[0]):
    Readonly<{ proofs: MimirMixedBoundedProofV1[]; projection: MimirMixedBoundedProjectionV1 }> {
  const candidates = input.sources.flatMap((row, index) => row.proof.kind === 0 ? [] : [index]);
  let best: { proofs: MimirMixedBoundedProofV1[]; projection: MimirMixedBoundedProjectionV1; span: bigint } | null = null;
  const causes = new Set<string>();
  for (let mask = (1 << candidates.length) - 1; mask > 0; mask--) {
    const keep = new Set(candidates.filter((_, bit) => mask & 1 << bit));
    const sources = input.sources.map((row, index) => keep.has(index) || row.proof.kind === 0 ? row :
      { config: row.config, ring: row.ring, sourceConfig: row.sourceConfig, proof: { kind: 0 as const } });
    let projection: MimirMixedBoundedProjectionV1;
    try { projection = projectMimirMixedBoundedV1({ ...input, sources }); }
    catch (error) { causes.add(error instanceof Error ? error.message : String(error)); continue; }
    const span = projection.commonSupport.endUnixTs - projection.commonSupport.startUnixTs;
    if (!best || projection.qualifiedWeightBps > best.projection.qualifiedWeightBps ||
        projection.qualifiedWeightBps === best.projection.qualifiedWeightBps && span > best.span) {
      best = { proofs: sources.map(row => row.proof), projection, span };
    }
  }
  if (!best) throw new MimirMixedBoundedNoProofSubsetError([...causes]);
  return { proofs: best.proofs, projection: best.projection };
}
