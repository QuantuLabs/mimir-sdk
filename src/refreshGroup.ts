import { PublicKey, SYSVAR_CLOCK_PUBKEY, type Connection } from "@solana/web3.js";
import { address, type Address } from "@solana/kit";
import { decodeAdminConfigHeader, decodeCompositeFeedConfigHeader } from "./codec.js";
import type { MimirProgramProfile } from "./constants.js";
import { findProgramAddressCached } from "./pda.js";
import { mimirPlanSession, type MimirPlanningReuse } from "./planSession.js";
import { buildMimirExistingFeedFusedRows, createConnectionPlanningRpc } from "./existingFeedRows.js";
import { decodeMimirBetaLiveFeed, decodeMimirBetaLivePlan } from "./beta/liveAbi.js";
import { assertMimirClassicConverterAdmitted, buildMimirFusedClassicInstruction, decodeMimirClassicExecutionAccount, decodeMimirFusedClassicData, MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS, mimirFusedClassicRequest, type MimirClassicRefreshMode } from "./beta/classicExecution.js";
import { assertMimirAbi1Capable, type MimirAbi1Capability } from "./beta/abi1Release.js";
import { assertMimirInitPayerIsFeedCreator, buildMimirFusedCompositeRefreshInstruction, buildMimirInitFusedCompositeClosure, decodeMimirCompositeExecution, decodeMimirFusedRefreshData, mimirCompositeExecutionLayout,
  mimirCompositeSampledReadiness, mimirFusedRecipeNeedsWarmup, type MimirFusedDescriptor, type MimirFusedRow } from "./beta/compositeExecution.js";
import { mimirCompositePublicationOutcome, type MimirCompositeInitializer, type MimirRefreshGroup, type MimirRefreshGroupBuilder, type MimirRefreshTarget } from "./beta/refreshPlanner.js";
import { mimirClassicPublicationOutcome, proveMimirBetaPreparationDrift, simulateExactPostAccounts } from "./beta/live.js";
import { compileMimirBetaTransactionV1 } from "./beta/transactionV1.js";
import { betaError, MimirBetaSimulationError, mimirBetaSimulationFailure } from "./beta/errors.js";
import type { MimirBetaAccount, MimirBetaInstruction } from "./beta/types.js";
import type { MimirSampledReadiness } from "./internal/sampledTemporalCore.js";

/** A1 §5: a mode-4 composite row is still maturing; `refreshOnlyInstructions` is the permissionless sample-only tag 87. */
export class MimirCompositeSamplingRequiredError extends Error {
  constructor(readonly refreshOnlyInstructions: readonly MimirBetaInstruction[], readonly sources: readonly Readonly<{ sourceIndex: number; sampled: MimirSampledReadiness }>[]) {
    super("MimirCompositeSamplingRequired");
  }
}

/** The probed execution exists; `reuse` is its one-slot config+execution read, for the build of this same preparation only. */
export class MimirCompositeExecutionExistsError extends Error {
  constructor(readonly reuse: MimirPlanningReuse) {
    super("CompositeExecutionAlreadyExists");
  }
}

/** Warming recovery folded over every maturing row: any quality hold blocks, the slowest row bounds the span. */
export function mimirRefreshWarmingRecovery(error: unknown) {
  if (!(error instanceof MimirCompositeSamplingRequiredError)) return null;
  const sampled = error.sources.map((s) => s.sampled);
  const max = <T extends number | bigint>(xs: T[]) => xs.reduce((a, b) => b > a ? b : a);
  return { refreshOnlyInstructions: error.refreshOnlyInstructions, remainingWarmupSeconds: max(sampled.map((x) => x.spanSecondsRemaining)),
    sampled: { status: sampled.some((x) => x.status === "quality-hold") ? "quality-hold" :
      sampled.some((x) => x.status === "history-reset-required") ? "history-reset-required" : "warming",
      observationsRemaining: max(sampled.map((x) => x.observationsRemaining)), spanSecondsRemaining: max(sampled.map((x) => x.spanSecondsRemaining)),
      nextEligibleUnixTs: max(sampled.map((x) => x.nextEligibleUnixTs)) } };
}

/**
 * @internal A below-floor tag 87 is publishable only when its simulated CSP post-state is Fresh or the program's valid Degraded
 * (price kept with its clocks, even once the retained price aged out). A ring refusal (Custom 54) is refused: below floor with a retained
 * price older than `maxComponentSnapshotAgeSlots` (a program without Degraded NO_PRICE), or any other ring refusal.
 */
export async function mimirCompositeBelowFloorPublication(connection: Connection, a: Readonly<{ payer: Address; programId: Address;
  commitment: "confirmed" | "finalized"; instruction: MimirBetaInstruction; snapshot: Address; belowFloorSources: readonly number[];
  /** Planning read slot: the simulation must not observe an older bank. */
  minContextSlot: bigint; ageLimits: Readonly<{ maxSnapshotAgeSlots: number; maxComponentSnapshotAgeSlots: number }>;
  /** Retained observation slot (ring `completed_end_slot`) of each below-floor component row. */
  retainedSlots?: readonly (readonly [row: number, slot: bigint])[];
  /** Planning rows the tag-87 externals were built from: a moved CLMM window (Custom 46) is typed PREPARATION_STALE. */
  observed?: ReadonlyMap<Address, MimirBetaAccount> }>) {
  const request = decodeMimirFusedRefreshData(a.instruction.data);
  const config = a.instruction.accounts[2]?.address;
  if (a.instruction.programAddress !== a.programId || a.instruction.accounts[1]?.address !== a.snapshot || !config) {
    betaError("INVALID_ARGUMENT", "tag-87 instruction does not target the composite snapshot", a.snapshot);
  }
  const max = BigInt(a.ageLimits.maxComponentSnapshotAgeSlots);
  const expired = (a.retainedSlots ?? []).filter(([, slot]) => a.minContextSlot - slot > max).map(([row]) => row);
  const { post, contextSlot } = await simulatedPublication(connection, a, () => expired.length
    ? betaError("SOURCE_BELOW_FLOOR_UNPUBLISHABLE", `composite rows ${expired.join(",")} are below their configured floor and their retained price is older than ${max} slots (Custom 54)`, a.snapshot)
    : betaError("SOURCE_RING_REFUSED", `composite rows ${a.belowFloorSources.join(",")} are below their configured floor and the program refused a source ring for another reason (Custom 54: a condition other than DEPTH_BELOW_FLOOR, or a malformed, identity or generation failure)`, a.snapshot));
  try {
    return mimirCompositePublicationOutcome(post, a.belowFloorSources, { feedId: request.compositeFeedId, config, configRevision: request.expectedConfigRevision,
      minRevision: request.previousSnapshotRevision, contextSlot, ...a.ageLimits });
  } catch (error) {
    return betaError("COMPOSITE_PUBLICATION_NOT_FRESH", `composite refresh simulation would not publish a Fresh or valid Degraded snapshot: ${(error as Error).message}`, a.snapshot);
  }
}

/** @internal Classic twin of the composite path: a below-floor tag 89 publishes only a bound Fresh or valid Degraded snapshot. */
export async function mimirClassicBelowFloorPublication(connection: Connection, a: Readonly<{ payer: Address; programId: Address;
  commitment: "confirmed" | "finalized"; instruction: MimirBetaInstruction; snapshot: Address; feedConfig: Address; belowFloorSources: readonly number[];
  minContextSlot: bigint }>) {
  const request = decodeMimirFusedClassicData(a.instruction.data);
  if (a.instruction.programAddress !== a.programId || a.instruction.accounts[0]?.address !== a.snapshot) {
    betaError("INVALID_ARGUMENT", "tag-89 instruction does not target the feed snapshot", a.snapshot);
  }
  const { post, contextSlot } = await simulatedPublication(connection, a,
    () => betaError("SOURCE_BELOW_FLOOR_UNPUBLISHABLE", `classic rows ${a.belowFloorSources.join(",")} are below their configured floor`, a.snapshot));
  try {
    return mimirClassicPublicationOutcome(post, a.belowFloorSources, { feedId: request.feedId, feedConfig: a.feedConfig, configRevision: request.feedConfigRevision,
      planHash: request.planHash, minRevision: request.previousSnapshotRevision, floorSlot: a.minContextSlot, contextSlot });
  } catch (error) {
    return betaError("CLASSIC_PUBLICATION_NOT_FRESH", `classic refresh simulation would not publish a Fresh or valid Degraded snapshot: ${(error as Error).message}`, a.snapshot);
  }
}

async function simulatedPublication(connection: Connection, a: Readonly<{ payer: Address; programId: Address; commitment: "confirmed" | "finalized";
  instruction: MimirBetaInstruction; snapshot: Address; minContextSlot: bigint; observed?: ReadonlyMap<Address, MimirBetaAccount> }>, ringRefused: () => never) {
  const latest = await connection.getLatestBlockhash(a.commitment);
  const tx = await compileMimirBetaTransactionV1({ feePayer: a.payer, recentBlockhash: latest.blockhash,
    lastValidBlockHeight: BigInt(latest.lastValidBlockHeight), instructions: [a.instruction] });
  try {
    const { accounts, simulation } = await simulateExactPostAccounts(createConnectionPlanningRpc(connection), tx.serializedTransaction, a.minContextSlot, a.programId, [a.snapshot], a.commitment);
    const owned = accounts[0]?.owner === a.programId && !accounts[0].executable;
    return { post: owned ? accounts[0]!.data : new Uint8Array(0), contextSlot: simulation.contextSlot };
  } catch (error) {
    if (error instanceof MimirBetaSimulationError && error.customCode === 54) ringRefused();
    if (a.observed && error instanceof MimirBetaSimulationError && error.customCode === 46) {
      await proveMimirBetaPreparationDrift(createConnectionPlanningRpc(connection), a.observed, a.minContextSlot, a.programId, a.commitment, error, [a.instruction]);
    }
    throw error;
  }
}

export interface CreateMimirRefreshGroupBuilderArgs {
  /** Verified ABI-1 capability; required off localnet for tag-87 producers and tag-88 initializers. */
  readonly abi1Capability?: MimirAbi1Capability;
  /** Opt-in pinned release recipe scope (`RELEASE_SCOPE_UNSUPPORTED`), enforced on every cluster including localnet. */
  readonly abi1ReleaseRecipeScope?: boolean;
  readonly connection: Connection;
  readonly profile: MimirProgramProfile;
  readonly payer: Address;
  readonly commitment?: "confirmed" | "finalized";
  /** Sample-only tag 89/87 signs the exact CAS instead of the default ensure floors. */
  readonly exactSample?: boolean;
}

/** Node refresh-group builder for `planMimirRefresh`: one tag-89 unit for classics, one tag-87 unit for composites. */
export function createMimirRefreshGroupBuilder(args: CreateMimirRefreshGroupBuilderArgs): MimirRefreshGroupBuilder {
  const { profile } = args;
  const commitment = args.commitment ?? "confirmed";
  const program = new PublicKey(profile.programId);
  const payer = new PublicKey(args.payer);
  const forConnection = (connection: Connection) => {
  const pda = (...seeds: (string | Uint8Array | number[])[]) =>
    findProgramAddressCached(seeds.map((s) => Buffer.from(s as Uint8Array)), program)[0];
  const read = async (key: PublicKey) => {
    const info = await connection.getAccountInfo(key, commitment);
    if (!info) throw new Error(`MimirAccountMissing ${key.toBase58()}`);
    if (!info.owner.equals(program)) throw new Error(`MimirAccountOwnerMismatch ${key.toBase58()}`);
    return Uint8Array.from(info.data);
  };
  const started = <T>(read: Promise<T>) => (read.catch(() => undefined), read);

  const rows = (feedId: Uint8Array, role: Parameters<typeof buildMimirExistingFeedFusedRows>[0]["role"], sourceIndex?: number,
    descriptors?: readonly MimirFusedDescriptor[]) => buildMimirExistingFeedFusedRows({ connection, profile, feedId, role, commitment,
    ...(sourceIndex !== undefined ? { sourceIndex } : {}), ...(descriptors ? { descriptors } : {}) });
  const width = (row: MimirFusedRow, expected: number) => {
    if (row.externals.length !== expected) throw new Error("ExecutionDefinitionMismatch: external vector width");
    return row.externals;
  };

  /** One tag-89 unit over the active `ClassicExecutionV1`: publish (`+1`) or sample-only (`r/r`). */
  async function classicUnit(feedId: Uint8Array, mode: MimirClassicRefreshMode) {
    const execution = pda("classic_execution", feedId);
    const state = await decodeMimirClassicExecutionAccount({ programId: address(program.toBase58()), address: address(execution.toBase58()),
      owner: address(program.toBase58()), data: await read(execution), requireActive: true });
    const snapshot = pda("feed_snapshot", feedId);
    if (!state.active || !Buffer.from(state.feedId).equals(Buffer.from(feedId)) || state.snapshot !== snapshot.toBase58()) throw new Error("ClassicExecutionNotReady");
    const [snapshotData, primaryRows, converterRows] = [started(read(snapshot)), started(rows(feedId, "primary", undefined, state.primary.map((r) => r.descriptor))),
      started(state.converter ? rows(state.converter.feedConfigImage.subarray(16, 48), "converter", undefined, state.converter.sources.map((r) => r.descriptor)) : Promise.resolve([]))];
    const revision = new DataView((await snapshotData).buffer).getBigUint64(96, true);
    const primary = await primaryRows; const converter = await converterRows;
    if (primary.length !== state.componentCount || converter.length !== state.converterSourceCount) throw new Error("ExecutionDefinitionMismatch: row count");
    assertMimirAbi1Capable({ cluster: profile.cluster, programId: address(program.toBase58()), capability: args.abi1Capability, releaseRecipeScope: args.abi1ReleaseRecipeScope, recipes: state.layout.descriptors,
      action: mode, executionKind: "classic", converterSourceCount: state.converterSourceCount });
    const ix = buildMimirFusedClassicInstruction({ programId: address(program.toBase58()), snapshot: address(snapshot.toBase58()),
      registry: address(pda("mimir_registry", [0, 0]).toBase58()), execution: address(execution.toBase58()), layout: state.layout,
      primaryExternals: primary.map((r, i) => width(r, state.primary[i]!.descriptor.externalWidth)),
      converterExternals: converter.map((r, j) => width(r, state.converter!.sources[j]!.descriptor.externalWidth)),
      request: mimirFusedClassicRequest({ state, snapshotRevision: revision, mode, declaredMaxSnapshotAge: decodeMimirBetaLiveFeed(state.feedConfigImage).maxSnapshotAgeSlots,
        ensure: args.exactSample !== true }) });
    return { unit: { instructions: [ix], abi1: { recipes: state.layout.descriptors, converterSourceCount: state.converterSourceCount } }, recipes: state.layout.descriptors, converterSourceCount: state.converterSourceCount,
      belowFloorSources: primary.flatMap((r, i) => r.belowFloor ? [i] : []), snapshot: address(snapshot.toBase58()) };
  }

  async function classicCheck(feedConfig: Address) {
    const cfg = await read(new PublicKey(feedConfig));
    const feedId = cfg.slice(16, 48);
    if (!pda("feed_config", feedId).equals(new PublicKey(feedConfig))) throw new Error("MimirFeedConfigMismatch");
    const feed = decodeMimirBetaLiveFeed(cfg);
    const planHash = (await Promise.all([feed.defaultSourcingPlan, feed.fallbackSourcingPlan].filter((k) => k.some((b) => b !== 0))
      .map(async (k) => { try { return (await decodeMimirBetaLivePlan(await read(new PublicKey(k)))).planHash; } catch { return null; } })))
      .filter((h): h is NonNullable<typeof h> => h !== null);
    const snapshot = pda("feed_snapshot", feedId);
    const source = await read(snapshot).then((d) => d[107], () => undefined);
    return { feedId, expected: { feedId, configRevision: feed.feedConfigRevision, priceExponent: feed.priceExponent, planHash }, check: { account: address(snapshot.toBase58()), kind: "classic-snapshot" as const, slotOffset: 116,
      revisionOffset: 96, statusOffset: 104, expectedStatus: 0, validUntilSlotOffset: 124, snapshotSourceOffset: 107,
      capModelVersionOffset: 420, expectedCapModelVersion: source === 6 ? 0 : 2, config: feedConfig },
      ageLimits: { maxSnapshotAgeSlots: feed.maxSnapshotAgeSlots, maxSourceActivityAgeSlots: feed.maxSourceActivityAgeSlots } };
  }

  async function compositeCheck(compositeConfig: Address) {
    const cfg = decodeCompositeFeedConfigHeader(await read(new PublicKey(compositeConfig)), program);
    const cid = Uint8Array.from(cfg.compositeFeedId);
    if (!pda("composite_feed_config", cid).equals(new PublicKey(compositeConfig))) throw new Error("MimirCompositeConfigMismatch");
    const csnap = pda("composite_snapshot", cid);
    return { cfg, cid, csnap, expected: { feedId: cid, configRevision: cfg.configRevision, priceExponent: cfg.priceExponent }, check: { account: address(csnap.toBase58()), kind: "composite-csp" as const, slotOffset: 112, revisionOffset: 96,
      statusOffset: 104, expectedStatus: 0, validUntilSlotOffset: 120, snapshotSourceOffset: 107, expectedSnapshotSource: 4, config: compositeConfig },
      ageLimits: { maxSnapshotAgeSlots: cfg.maxSnapshotAgeSlots, maxComponentSnapshotAgeSlots: cfg.maxComponentSnapshotAgeSlots } };
  }

  async function classic(feedConfig: Address): Promise<MimirRefreshGroup> {
    const { feedId, check, ageLimits } = await classicCheck(feedConfig);
    const { unit, recipes, converterSourceCount, belowFloorSources, snapshot } = await classicUnit(feedId, "publish");
    const publication = belowFloorSources.length ? await mimirClassicBelowFloorPublication(connection, { payer: args.payer, programId: address(program.toBase58()), commitment,
      instruction: unit.instructions[0]!, snapshot, feedConfig, belowFloorSources,
      minContextSlot: BigInt((await connection.getAccountInfoAndContext(new PublicKey(snapshot), commitment)).context.slot) }) : undefined;
    return { updates: [], publish: unit, check, ageLimits, abi1Recipes: recipes, abi1ConverterSourceCount: converterSourceCount, ...(publication ? { publication } : {}) };
  }

  /** One indivisible tag-87 producer over the active execution PDA; its CU comes from simulation, never inferred. */
  async function composite(compositeConfig: Address): Promise<MimirRefreshGroup> {
    const { cfg, cid, csnap, check, ageLimits } = await compositeCheck(compositeConfig);
    const execution = pda("composite_execution", cid);
    const adminKey = pda("admin_config", [1, 0]);
    const [executionData, cspRead, adminData] = [started(read(execution)), started(connection.getAccountInfoAndContext(csnap, commitment)), started(read(adminKey))];
    const sourceReads = cfg.components.map((c) => started(read(new PublicKey(c.sourceConfig))));
    const converterSourceRead = cfg.solConversionSourceConfig.some((b) => b !== 0) ? started(read(new PublicKey(cfg.solConversionSourceConfig))) : null;
    const state = decodeMimirCompositeExecution(await executionData);
    if (!state.active || !Buffer.from(state.compositeFeedId).equals(Buffer.from(cid)) || state.cfc !== compositeConfig ||
        state.cfcRevision !== cfg.configRevision || state.componentCount !== cfg.components.length ||
        !!state.converter !== cfg.solConversionSourceConfig.some((b) => b !== 0)) {
      throw new Error("CompositeExecutionNotReady");
    }
    const { context: cspContext, value: cspInfo } = await cspRead;
    const prev = cspInfo && cspInfo.owner.equals(program) ? Buffer.from(cspInfo.data).readBigUInt64LE(96) : 0n;
    const admin = decodeAdminConfigHeader(await adminData);
    const belowFloor = new Set<number>();
    const observed = new Map<Address, MimirBetaAccount>();
    const [componentRead, converterRead] = [started(Promise.all(cfg.components.map(async (c, i) => {
      const sourceIndex = (await sourceReads[i]!)[48]!;
      const { descriptor } = state.components[i]!;
      const row = (await rows(Uint8Array.from(c.feedId), "component", sourceIndex, [descriptor]))[0]!;
      if (row.belowFloor) belowFloor.add(i);
      row.observed?.forEach((account, key) => observed.set(key, account));
      return width(row, descriptor.externalWidth);
    }))), started(!state.converter ? Promise.resolve([]) : (async () => {
      const fid = (await converterSourceRead!).slice(16, 48);
      const conv = await rows(fid, "composite-converter", undefined, state.converter!.sources.map((r) => r.descriptor));
      if (conv.length !== state.converter!.sources.length) throw new Error("CompositeExecutionDefinitionMismatch");
      if (conv.some((r) => r.belowFloor)) belowFloor.add(7);
      conv.forEach((r) => r.observed?.forEach((account, key) => observed.set(key, account)));
      return conv.map((r, j) => width(r, state.converter!.sources[j]!.descriptor.externalWidth));
    })())];
    const componentExternals = await componentRead; const converterExternals = await converterRead;
    const tag87 = (next: bigint, fee: bigint) => buildMimirFusedCompositeRefreshInstruction({ programId: address(program.toBase58()), payer: args.payer,
      compositeSnapshot: address(csnap.toBase58()), compositeConfig, registry: address(pda("mimir_registry", [0, 0]).toBase58()),
      adminConfig: address(adminKey.toBase58()), feeVault: address(pda("feed_fee_vault", cid).toBase58()),
      treasury: address(new PublicKey(admin.feeTreasury).toBase58()), execution: address(execution.toBase58()), layout: state.layout,
      componentExternals, converterExternals, request: { compositeFeedId: cid, expectedConfigRevision: cfg.configRevision,
        previousSnapshotRevision: prev, nextSnapshotRevision: next, componentSourceConfigRevisions: state.components.map((c) => c.sourceConfigRevision),
        maxRefreshFeeLamports: fee, componentRingNewestSlots: state.components.map((c) => c.ringNewestSlot),
        converterRingNewestSlots: state.converter?.sources.map((c) => c.ringNewestSlot) ?? [],
        ...(next !== prev ? { maxReuseAgeSlots: MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS } : args.exactSample !== true ? { ensureSample: true } : {}) } });
    // A1 §5: mode-4 rows mature through permissionless sample-only tag 87 (r/r, fee 0); publish only once every one is ready.
    const clockUnixTs = state.layout.descriptors.some((d) => d.mode === 4) ? await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, commitment).then((clock) => {
      if (!clock || clock.owner.toBase58() !== "Sysvar1111111111111111111111111111111111111" || clock.data.length !== 40) throw new Error("MimirClockUnavailable");
      return Buffer.from(clock.data).readBigInt64LE(32);
    }) : 0n;
    const sampled = mimirCompositeSampledReadiness(await executionData, state, clockUnixTs);
    const warming = sampled.some((row) => row.sampled.status !== "ready");
    assertMimirAbi1Capable({ cluster: profile.cluster, programId: address(program.toBase58()), capability: args.abi1Capability, releaseRecipeScope: args.abi1ReleaseRecipeScope,
      recipes: [...state.components.map((c) => c.descriptor), ...(state.converter?.sources.map((c) => c.descriptor) ?? [])],
      action: warming ? "sample" : "publish", executionKind: "composite", converterSourceCount: state.converter?.sources.length ?? 0 });
    if (warming) {
      throw new MimirCompositeSamplingRequiredError([tag87(prev, 0n)], sampled);
    }
    const publish = tag87(prev + 1n, admin.compositeRefreshFeeLamports);
    const publication = belowFloor.size ? await mimirCompositeBelowFloorPublication(connection, { payer: args.payer, programId: address(program.toBase58()), commitment,
      instruction: publish, snapshot: address(csnap.toBase58()), belowFloorSources: [...belowFloor].sort((a, b) => a - b),
      minContextSlot: BigInt(cspContext.slot), ageLimits, observed,
      retainedSlots: [...belowFloor].filter((row) => row !== 7).map((row) => [row, state.components[row]!.ringCompletedEndSlot] as const) })  : undefined;
    const programId = address(program.toBase58());
    const preparationDrift = (err: unknown, logs: unknown) => {
      const failure = new MimirBetaSimulationError(mimirBetaSimulationFailure(err, logs, programId, [publish]));
      return failure.customCode === 46 ? proveMimirBetaPreparationDrift(createConnectionPlanningRpc(connection), observed, BigInt(cspContext.slot), programId, commitment, failure, [publish])
        : Promise.reject(failure);
    };
    return { updates: [], publish: { instructions: [publish] }, check, ageLimits, preparationDrift,
      abi1Recipes: state.layout.descriptors, abi1ConverterSourceCount: state.converterSourceCount, ...(publication ? { publication } : {}) };
  }

  /** Existing CFC cutover: the same complete tag-88 API as fresh creation; no migration mode, no lazy initialization. */
  async function compositeInitializer(compositeConfig: Address): Promise<MimirCompositeInitializer> {
    const { cfg, cid } = await compositeCheck(compositeConfig);
    const execution = pda("composite_execution", cid);
    const probe = await connection.getMultipleAccountsInfoAndContext([new PublicKey(compositeConfig), execution], commitment);
    if (probe.value[1]) {
      throw new MimirCompositeExecutionExistsError({ prefetchedAccounts: new Map(probe.value.flatMap((info, i) => info?.owner.equals(program)
        ? [[[compositeConfig, execution.toBase58()][i]!, { data: Uint8Array.from(info.data), slot: BigInt(probe.context.slot), owner: address(info.owner.toBase58()),
          executable: info.executable, lamports: info.lamports }] as const] : [])) });
    }
    const programId = address(program.toBase58());
    const collateralLock = address(pda("feed_collateral_lock", cid).toBase58());
    const lockInfo = await connection.getAccountInfo(new PublicKey(collateralLock), commitment);
    assertMimirInitPayerIsFeedCreator(lockInfo?.owner.equals(program) ? Uint8Array.from(lockInfo.data) : null, args.payer, collateralLock);
    const components = await Promise.all(cfg.components.map(async (c) =>
      (await rows(Uint8Array.from(c.feedId), "component", (await read(new PublicKey(c.sourceConfig)))[48]!))[0]!));
    const converter = !cfg.solConversionSourceConfig.some((b) => b !== 0) ? [] : await (async () => {
      const conv = await rows((await read(new PublicKey(cfg.solConversionSourceConfig))).slice(16, 48), "composite-converter");
      if (conv[0]?.sourceConfig !== new PublicKey(cfg.solConversionSourceConfig).toBase58()) throw new Error("CompositeExecutionDefinitionMismatch");
      return conv;
    })();
    assertMimirClassicConverterAdmitted(converter.map((r) => r.recipe));
    const layout = mimirCompositeExecutionLayout(components.map((r) => r.recipe), converter.map((r) => r.recipe));
    assertMimirAbi1Capable({ cluster: profile.cluster, programId, capability: args.abi1Capability, releaseRecipeScope: args.abi1ReleaseRecipeScope, recipes: [...components, ...converter].map((r) => r.recipe),
      action: "init", executionKind: "composite", converterSourceCount: converter.length });
    const instructions = buildMimirInitFusedCompositeClosure({ programId, payer: args.payer, execution: address(execution.toBase58()), collateralLock, compositeConfig,
      registry: address(pda("mimir_registry", [0, 0]).toBase58()), compositeFeedId: cid, layout,
      witnesses: [...components, ...converter].map((r) => r.witness),
      components: components.map(({ sourceConfig, feedConfig, sourcingPlan, externals }) => ({ sourceConfig, feedConfig, sourcingPlan, externals })),
      ...(converter.length ? { converter: { feedConfig: converter[0]!.feedConfig, sourcingPlan: converter[0]!.sourcingPlan,
        sources: converter.map(({ sourceConfig, externals }) => ({ sourceConfig, externals })) } } : {}) });
    return { instructions, execution: address(execution.toBase58()), exactLength: layout.exactLength, growCount: layout.growCount,
      temporalWarmupRequired: [...components, ...converter].some((r) => mimirFusedRecipeNeedsWarmup(r.recipe)) };
  }

  return { classic, composite, classicCheck, compositeCheck, classicUnit, compositeInitializer };
  };
  const session = (target: MimirRefreshTarget, reuse?: MimirPlanningReuse) => forConnection(mimirPlanSession(args.connection,
    { programId: program, commitment, key: target.kind === "classic" ? `classic:${target.feedConfig}` : `composite:${target.compositeConfig}`, ...reuse }));

  return Object.assign((target: MimirRefreshTarget, reuse?: MimirPlanningReuse) => {
    const s = session(target, reuse);
    return target.kind === "classic" ? s.classic(target.feedConfig) : s.composite(target.compositeConfig);
  }, {
    warmingRecovery: mimirRefreshWarmingRecovery,
    /** Sample-only tag 89 (`new=previous`, ensure unless `exactSample`): advances private temporal rows while a module is still maturing. */
    classicSample: async (feedConfig: Address) => {
      const s = session({ kind: "classic", feedConfig });
      return (await s.classicUnit((await s.classicCheck(feedConfig)).feedId, "sample")).unit;
    },
    compositeInitializer: (compositeConfig: Address) => forConnection(mimirPlanSession(args.connection, { programId: program, commitment,
      key: `composite-init:${compositeConfig}` })).compositeInitializer(compositeConfig),
    publication: async (target: MimirRefreshTarget) => {
      const s = session(target);
      const { check, ageLimits, expected } = target.kind === "classic" ? await s.classicCheck(target.feedConfig) : await s.compositeCheck(target.compositeConfig);
      return { check, ageLimits, expected };
    } });
}
