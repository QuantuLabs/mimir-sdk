import type { Address } from "@solana/kit";
import { addressBytes, utf8 } from "../beta/bytes.js";
import { betaError } from "../beta/errors.js";
import { buildMimirBetaClassicSourceArtifacts, computeMimirBetaClassicPlanHash, deriveMimirBetaFeedPdas, deriveMimirBetaPda,
  encodeMimirBetaClassicInitArgs, encodeMimirBetaTicker, type MimirBetaCompactSourceArgs, type MimirBetaPhysicalAccountFact } from "../beta/abi.js";
import { encodeMimirFusedDescriptor, MIMIR_FUSED_TEMPORAL_MODULE_LENGTH, type MimirFusedRecipe } from "../beta/compositeExecution.js";
import type { MimirBetaEligiblePool } from "../beta/discovery.js";
import type { MimirBetaClassicPolicy } from "../beta/creation.js";
import { mimirCurrentPointAdmitted, mimirSourceFlagsFromTemporalMode, type MimirTemporalMode } from "../internal/currentPointCore.js";
import * as C from "./layout/common.js";
import * as K from "./layout/classic.js";
import { decodeV1ClassicFeed, v1MembershipLen } from "./decoders.js";
import { computeMimirV1TickerTariff, deriveMimirV1ClassicFeedId, findMimirV1AdminConfigPda, findMimirV1AssociatedTokenAddress, findMimirV1ClassicFeedPda, findMimirV1FreeClassicVariant,
  findMimirV1GenerationCounterPda, findMimirV1OneCharAllowancePda, findMimirV1RegistryPda, findMimirV1TickerClaimPda, mimirV1ClassicExactLen,
  MIMIR_V1_FEED_IMAGE_LEN, MIMIR_V1_PLAN_IMAGE_LEN, MIMIR_V1_SOURCE_IMAGE_LEN, type MimirV1ClassicDefinition } from "./build.js";
import { planMimirV1ClassicCreation, type MimirV1CreationPlan } from "./tx.js";
import type { MimirBetaAccount, MimirBetaInstruction } from "../beta/types.js";
import { FinalizedRpcReader, type MimirBetaFinalizedRpc } from "../beta/rpc.js";
import { decodeMimirBetaAdminContext, decodeMimirBetaRegistryContext } from "../beta/context.js";
import { assertMimirClassicDammRecipePolicy, assertMimirClassicIntervalGeneration, freshAdapterAccounts, isMimirClassicIntervalRecipe, mimirAuthenticClockUnix,
  mimirClassicDualAdmitted, mimirClassicIntervalPins, mimirClassicIntervalRow, mimirClassicNativeAdmitted, mimirClassicNativeRowReadiness, mimirClassicNativeTail,
  MimirClassicNativeNotReadyError, mimirDlmmPointAdmitted,
  mimirDlmmPointPreflight, mimirDlmmPointTemporal, type MimirClassicRowRecipe } from "../beta/live.js";
import { assertMimirClassicConverterAdmitted, assertMimirV1MixedMajorityPossible, mimirClassicRow } from "../beta/classicExecution.js";
import { MIMIR_NATIVE_CLOCK_ADDRESS, mimirExecutableGenerationPins } from "../internal/nativeMonoRefreshCore.js";
import { conservativeMintOracleSourceConfigFloor } from "../math.js";
import { mimirOrcaAdaptive, mimirOrcaAdmissionOracle } from "../beta/capture.js";
import { assertMimirPriceable, mimirAutoClassicPolicy, MIMIR_PARAM_MARGINS, type MimirClassicPolicyOverrides } from "../beta/params.js";

const SPL_NATIVE_MINT = "So11111111111111111111111111111111111111112" as Address;
const FEED_LIFECYCLE_ACTIVE = 3;
const PRIMARY_TICKER_PRESENT = 1;
const TIER_FLOORS: Readonly<Record<number, readonly [number, number, number]>> = { 3: [4, 3, 3], 2: [3, 2, 2], 1: [1, 1, 1] };

class Image {
  readonly bytes: Uint8Array; private readonly v: DataView;
  constructor(len: number, magic: string) { this.bytes = new Uint8Array(len); this.v = new DataView(this.bytes.buffer); this.bytes.set(utf8(magic), 0); }
  u8(at: number, x: number) { this.bytes[at] = x; return this; }
  u16(at: number, x: number) { this.v.setUint16(at, x, true); return this; }
  u32(at: number, x: number) { this.v.setUint32(at, x, true); return this; }
  i32(at: number, x: number) { this.v.setInt32(at, x, true); return this; }
  u64(at: number, x: bigint) { this.v.setBigUint64(at, x, true); return this; }
  u128(at: number, x: bigint) { this.v.setBigUint64(at, x & 0xffff_ffff_ffff_ffffn, true); this.v.setBigUint64(at + 8, x >> 64n, true); return this; }
  put(at: number, x: Uint8Array | Address) { this.bytes.set(typeof x === "string" ? addressBytes(x) : x, at); return this; }
}

/** One primary row: the admitted recipe (`mimirClassicRow(...).recipe`) and, optionally, the M0 DERIVED membership (binding_version bit1). */
export interface MimirV1ClassicRowRecipe { readonly recipe: MimirFusedRecipe; readonly derived?: boolean }

export interface BuildMimirV1ClassicDefinitionArgs {
  readonly programId: Address;
  readonly baseMint: Address; readonly quoteMint: Address;
  readonly baseDecimals: number; readonly quoteDecimals: number;
  readonly ticker: string;
  /** feed_id variant: 0 admin-only, users ≥ 1 (`findMimirV1FreeClassicVariant`). */
  readonly variant: number;
  /** Registry `registry_epoch` (CREATE_CLASSIC requires the live value). */
  readonly registryEpoch: bigint;
  /** `minSources` defaults to n (v1 lifecycle rule). */
  readonly policy: MimirBetaClassicPolicy & Readonly<{ minSources?: number }>;
  /** Selected pools with their configured `minLiquidityNative` / `minDepthTo50BpsNative` floors, row order. */
  readonly pools: readonly MimirBetaEligiblePool[];
  /** Owner / executable of every static binding account and of both mints. */
  readonly physicalAccounts: readonly MimirBetaPhysicalAccountFact[];
  readonly rows: readonly MimirV1ClassicRowRecipe[];
  readonly temporalMode?: MimirTemporalMode;
  readonly dlmmPointRows?: readonly boolean[];
  /** Exact compact sources (e.g. golden vectors); default: derived from `pools` as v1 tag79/80 did. */
  readonly authoritativeSources?: readonly MimirBetaCompactSourceArgs[];
  /** SOL feed account bytes, required iff the quote is wSOL: its rows become the converter block (copied on chain). */
  readonly solFeedData?: Uint8Array;
}

export interface MimirV1ClassicDefinitionResult {
  readonly feedId: Address; readonly feed: Address; readonly feedBump: number;
  readonly definition: MimirV1ClassicDefinition;
  readonly n: number; readonly s: number; readonly exactLen: number;
  readonly planHash: Uint8Array;
  /** Per row: the PumpSwap boost vault appended after its vector (v1 tag78 8th account), else null. */
  readonly boostVaults: readonly (Address | null)[];
}

/**
 * The CREATE_CLASSIC definition (V0 feed image 325 ‖ plan image 320 ‖ n × (descriptor 16 ‖ source image 384)) exactly as the v1
 * tag78/80 lifecycle built it on chain (9bea223 build_lifecycle_feed_config_bytes, build_lifecycle_sourcing_plan_bytes,
 * derive_compact_source_config_header), with the V1 rules: version V0 + primary ticker flag, would-be v0 PDAs and canonical bumps
 * under the V1 program id, V1 descriptors with module offsets after every membership (converter rows from the SOL feed).
 */
export async function buildMimirV1ClassicDefinition(a: BuildMimirV1ClassicDefinitionArgs): Promise<MimirV1ClassicDefinitionResult> {
  const n = a.pools.length; const p = a.policy;
  if (n < 1 || n > 5 || a.rows.length !== n) betaError("POOL_COUNT_OUT_OF_RANGE", "V1 Classic needs 1-5 pools, one recipe each");
  const feedId = await deriveMimirV1ClassicFeedId(a.baseMint, a.quoteMint, a.variant);
  const [[feed, feedBump], pdas] = await Promise.all([findMimirV1ClassicFeedPda(a.programId, feedId), deriveMimirBetaFeedPdas({ programId: a.programId, feedId })]);
  const art = await buildMimirBetaClassicSourceArtifacts({ programId: a.programId, feedId, baseMint: a.baseMint, quoteMint: a.quoteMint,
    pools: a.pools, physicalAccounts: a.physicalAccounts, ...(a.authoritativeSources ? { authoritativeSources: a.authoritativeSources } : {}),
    ...(a.temporalMode ? { temporalMode: a.temporalMode } : {}), ...(a.dlmmPointRows ? { dlmmPointRows: a.dlmmPointRows } : {}) });
  const minSources = p.minSources ?? n; const groups = art.lifecycleGroupCount;
  assertMimirV1MixedMajorityPossible(a.rows.map((r) => r.recipe), art.artifacts.map((x) => x.source.routeCorrelationGroup), minSources);
  const floors = TIER_FLOORS[p.riskTier] ?? betaError("INVALID_ARGUMENT", "V1 risk tier must be A, B or C");
  if (minSources < floors[0] || groups < floors[1] || minSources > n) betaError("INVALID_ARGUMENT", "V1 plan is below its risk-tier floors");
  if (a.registryEpoch <= 0n) betaError("INVALID_ARGUMENT", "V1 registry epoch must be nonzero");
  // Policy and init-args domain checks (validate_lifecycle_init_args) via the v1 encoder.
  encodeMimirBetaClassicInitArgs({ baseMint: a.baseMint, quoteMint: a.quoteMint, sourceSetRoot: art.sourceSetRoot, staticAccountsRoot: art.staticAccountsRoot,
    anchorPolicyHash: p.anchorPolicyHash, nativeExceptionHash: p.nativeExceptionHash, adapterMask: art.adapterMask, namespaceVersion: 1, planId: 0, planVersion: 0,
    hashSchemeVersion: 1, ringVersion: 1, profile: p.profile, riskTier: p.riskTier, sourceCount: n, minSources, minVenues: groups, minCorrelationGroups: groups,
    baseDecimals: a.baseDecimals, quoteDecimals: a.quoteDecimals, bindingVariants: [...a.pools.map((x) => x.creation.bindingVariant === "routeable" ? 1 : 0), ...Array(5 - n).fill(0)],
    priceExponent: p.priceExponent, maxDispersionBps: p.maxDispersionBps, maxSourceActivityAgeSlots: p.maxSourceActivityAgeSlots,
    minCoverageRatioBps: p.minCoverageRatioBps, maxConfidenceBps: p.maxConfidenceBps, maxSnapshotAgeSlots: p.maxSnapshotAgeSlots });
  const planHash = await computeMimirBetaClassicPlanHash({ feedId, profile: p.profile, riskTier: p.riskTier, minSources, minVenues: groups,
    minCorrelationGroups: groups, maxDispersionBps: p.maxDispersionBps, maxSourceActivityAgeSlots: p.maxSourceActivityAgeSlots, priceExponent: p.priceExponent,
    baseMint: a.baseMint, quoteMint: a.quoteMint, sourceSetRoot: art.sourceSetRoot, staticAccountsRoot: art.staticAccountsRoot, twap: pdas.twap[0],
    anchorPolicyHash: p.anchorPolicyHash, adapterMask: art.adapterMask });

  const feedImage = new Image(MIMIR_V1_FEED_IMAGE_LEN, K.FEED_CONFIG_MAGIC).u16(K.CFG_OFFSET_VERSION, 0).u16(K.CFG_OFFSET_HEADER_LEN, MIMIR_V1_FEED_IMAGE_LEN)
    .u32(K.CFG_OFFSET_FLAGS, PRIMARY_TICKER_PRESENT).put(K.CFG_OFFSET_FEED_ID, feedId).put(K.CFG_OFFSET_BASE_MINT, a.baseMint).put(K.CFG_OFFSET_QUOTE_MINT, a.quoteMint)
    .i32(K.CFG_OFFSET_PRICE_EXPONENT, p.priceExponent).u8(K.CFG_OFFSET_RISK_TIER, p.riskTier).u8(K.CFG_OFFSET_LIFECYCLE_STATE, FEED_LIFECYCLE_ACTIVE)
    .u8(K.CFG_OFFSET_BASE_DECIMALS, a.baseDecimals).u8(K.CFG_OFFSET_QUOTE_DECIMALS, a.quoteDecimals).u8(K.CFG_OFFSET_MIN_SOURCE_COUNT, minSources)
    .u8(K.CFG_OFFSET_MIN_VENUE_COUNT, groups).u8(K.CFG_OFFSET_MIN_CORRELATION_GROUP_COUNT, groups).u16(K.CFG_OFFSET_MIN_COVERAGE_RATIO_BPS, p.minCoverageRatioBps)
    .u16(K.CFG_OFFSET_MAX_CONFIDENCE_BPS, p.maxConfidenceBps).u16(K.CFG_OFFSET_MAX_DISPERSION_BPS, p.maxDispersionBps)
    .u16(K.CFG_OFFSET_MAX_SNAPSHOT_AGE_SLOTS, p.maxSnapshotAgeSlots).u16(K.CFG_OFFSET_MAX_SOURCE_ACTIVITY_AGE_SLOTS, p.maxSourceActivityAgeSlots)
    .put(K.CFG_OFFSET_SOURCE_SET_HASH, art.sourceSetRoot).put(K.CFG_OFFSET_DEFAULT_SOURCING_PLAN, pdas.sourcingPlan[0])
    .put(K.CFG_OFFSET_ANCHOR_POLICY_HASH, p.anchorPolicyHash).put(K.CFG_OFFSET_NATIVE_EXCEPTION_HASH, p.nativeExceptionHash)
    .u64(K.CFG_OFFSET_FEED_CONFIG_REVISION, 1n).u64(K.CFG_OFFSET_REGISTRY_EPOCH, a.registryEpoch).u8(K.CFG_OFFSET_BUMP, pdas.feed[1])
    .put(K.FEED_CONFIG_PRIMARY_TICKER_OFFSET, encodeMimirBetaTicker(a.ticker)).bytes;
  const planImage = new Image(MIMIR_V1_PLAN_IMAGE_LEN, K.SOURCING_PLAN_MAGIC).u16(K.PLAN_OFFSET_VERSION, 0).u16(K.PLAN_OFFSET_HEADER_LEN, MIMIR_V1_PLAN_IMAGE_LEN)
    .put(K.PLAN_OFFSET_FEED_ID, feedId).u8(K.PLAN_OFFSET_PROFILE, p.profile).u8(K.PLAN_OFFSET_STATUS, 0).u8(K.PLAN_OFFSET_RISK_TIER, p.riskTier)
    .u8(K.PLAN_OFFSET_MIN_SOURCES, minSources).u8(K.PLAN_OFFSET_MIN_VENUES, groups).u8(K.PLAN_OFFSET_MIN_CORRELATION_GROUPS, groups)
    .u16(K.PLAN_OFFSET_MAX_DISPERSION_BPS, p.maxDispersionBps).u16(K.PLAN_OFFSET_MAX_SOURCE_ACTIVITY_AGE_SLOTS, p.maxSourceActivityAgeSlots)
    .i32(K.PLAN_OFFSET_PRICE_EXPONENT, p.priceExponent).put(K.PLAN_OFFSET_BASE_MINT, a.baseMint).put(K.PLAN_OFFSET_QUOTE_MINT, a.quoteMint)
    .put(K.PLAN_OFFSET_SOURCE_SET_HASH, art.sourceSetRoot).put(K.PLAN_OFFSET_ACCOUNTS_HASH, art.staticAccountsRoot).put(K.PLAN_OFFSET_PLAN_HASH, planHash)
    .put(K.PLAN_OFFSET_TWAP_STATE, pdas.twap[0]).put(K.PLAN_OFFSET_ANCHOR_POLICY_HASH, p.anchorPolicyHash).u64(K.PLAN_OFFSET_ADAPTER_MASK, art.adapterMask)
    .u8(K.PLAN_OFFSET_BUMP, pdas.sourcingPlan[1]).u8(K.PLAN_OFFSET_HASH_SCHEME_VERSION, 1).u16(K.PLAN_OFFSET_RING_VERSION, 1)
    .u8(K.PLAN_OFFSET_ACCOUNTS_BINDING_VERSION, 1).bytes;

  const sourceImages = await Promise.all(art.artifacts.map(async ({ source: x }) => {
    const [, bump] = await deriveMimirBetaPda({ programId: a.programId, seed: "source_config", values: [addressBytes(feedId), Uint8Array.of(x.sourceIndex)] });
    return new Image(MIMIR_V1_SOURCE_IMAGE_LEN, K.SOURCE_CONFIG_MAGIC).u16(K.SRC_OFFSET_VERSION, 0).u16(K.SRC_OFFSET_HEADER_LEN, MIMIR_V1_SOURCE_IMAGE_LEN)
      .u32(K.SRC_OFFSET_FLAGS, mimirSourceFlagsFromTemporalMode(x.temporalMode, x.adapterType, x.adapterVersion)).put(K.SRC_OFFSET_FEED_ID, feedId)
      .u8(K.SRC_OFFSET_SOURCE_INDEX, x.sourceIndex).u8(K.SRC_OFFSET_ADAPTER_TYPE, x.adapterType).u8(K.SRC_OFFSET_STATUS, 0).u8(K.SRC_OFFSET_DIRECTION, x.direction)
      .u16(K.SRC_OFFSET_ADAPTER_VERSION, x.adapterVersion).u16(K.SRC_OFFSET_VENUE_GROUP, x.venueGroup).u16(K.SRC_OFFSET_OPERATOR_GROUP, x.operatorGroup)
      .u16(K.SRC_OFFSET_LIQUIDITY_OWNER_GROUP, x.liquidityOwnerGroup).u16(K.SRC_OFFSET_ROUTE_CORRELATION_GROUP, x.routeCorrelationGroup)
      .u16(K.SRC_OFFSET_QUOTE_ASSET_GROUP, x.quoteAssetGroup).u16(K.SRC_OFFSET_BRIDGE_OR_WRAPPER_GROUP, x.bridgeOrWrapperGroup)
      .u16(K.SRC_OFFSET_ORACLE_SOURCE_CLASS, x.oracleSourceClass).u16(K.SRC_OFFSET_UPGRADE_AUTHORITY_GROUP, x.upgradeAuthorityGroup)
      .u16(K.SRC_OFFSET_MAX_SOURCE_WEIGHT_BPS, x.maxSourceWeightBps).u128(K.SRC_OFFSET_MIN_LIQUIDITY_NATIVE, x.minLiquidityNative)
      .u128(K.SRC_OFFSET_MIN_DEPTH_TO_50BPS_NATIVE, x.minDepthTo50BpsNative).put(K.SRC_OFFSET_PROGRAM_ID, x.programId).put(K.SRC_OFFSET_POOL_OR_MARKET, x.poolOrMarket)
      .put(K.SRC_OFFSET_BASE_VAULT, x.baseVault).put(K.SRC_OFFSET_QUOTE_VAULT, x.quoteVault).put(K.SRC_OFFSET_BASE_MINT, a.baseMint).put(K.SRC_OFFSET_QUOTE_MINT, a.quoteMint)
      .put(K.SRC_OFFSET_TOKEN_PROGRAM, x.tokenProgram).put(K.SRC_OFFSET_VAULT_AUTHORITY, x.vaultAuthority).u64(K.SRC_OFFSET_SOURCE_CONFIG_REVISION, x.sourceConfigRevision)
      .u64(K.SRC_OFFSET_SOURCE_SET_REVISION, x.sourceSetRevision).u8(K.SRC_OFFSET_BUMP, bump).bytes;
  }));

  // Converter block: the SOL feed's primary rows, copied on chain; their memberships follow ours, their modules must be empty.
  if ((a.quoteMint === SPL_NATIVE_MINT) !== (a.solFeedData !== undefined)) betaError("INVALID_ARGUMENT", "V1 SOL feed data is required iff the quote is wSOL");
  const sol = a.solFeedData ? decodeV1ClassicFeed(a.solFeedData) : null;
  if (sol && (sol.header.s !== 0 || sol.rows.some((r) => r.descriptor.moduleLen !== 0))) betaError("INVALID_ARGUMENT", "V1 SOL feed rows are not copyable converter rows");
  if (sol) assertMimirClassicConverterAdmitted(sol.rows.map((r) => r.descriptor) as unknown as Parameters<typeof assertMimirClassicConverterAdmitted>[0]);
  const s = sol?.header.n ?? 0;
  const converterDescriptors = sol ? sol.rows.map((_, k) => a.solFeedData!.subarray(K.CLASSIC_ROWS + 944 * k, K.CLASSIC_ROWS + 944 * k + 16)) : [];
  let cursor = K.CLASSIC_ROWS + 944 * n + (s === 0 ? 0 : 1_797 + 944 * s)
    + a.rows.reduce((len, r) => len + v1MembershipLen(r.derived === true, r.recipe.bindingWidth), 0)
    + (sol?.memberships.reduce((len, m) => len + v1MembershipLen(m.derived, m.bindingWidth), 0) ?? 0);
  const descriptors = a.rows.map(({ recipe, derived }) => {
    const moduleLength = MIMIR_FUSED_TEMPORAL_MODULE_LENGTH[recipe.temporalKind];
    const d = encodeMimirFusedDescriptor({ ...recipe, moduleOffset: moduleLength ? cursor : 0, moduleLength });
    cursor += moduleLength;
    if (derived) d[15] |= 2;
    return d;
  });
  const exactLen = mimirV1ClassicExactLen(descriptors, converterDescriptors);
  if (exactLen !== cursor) betaError("PROGRAM_ABI_MISMATCH", "V1 Classic geometry mismatch");
  return { feedId, feed, feedBump, n, s, exactLen, planHash, boostVaults: art.artifacts.map((x) => x.boostVault),
    definition: { feedImage, planImage, rows: descriptors.map((descriptor, i) => ({ descriptor, sourceImage: sourceImages[i]! })), variant: a.variant } };
}

export interface PlanMimirV1ClassicCreationArgs extends BuildMimirV1ClassicDefinitionArgs {
  readonly payer: Address;
  /** AdminConfig `feed_creation_collateral_mint` / `feed_creation_collateral_amount_raw` (the tariff base) / `ticker_tier_*_tenths`. */
  readonly colaMint: Address; readonly colaBaseAmountRaw: bigint; readonly tickerTierTenths: readonly number[];
  /** Per row its recipe and live `external_width` vector (`mimirClassicRow(...)`). */
  readonly rows: readonly (MimirV1ClassicRowRecipe & Readonly<{ externals: readonly Address[] }>)[];
  /** The variant-0 SOL feed account, required iff the quote is wSOL. */
  readonly solFeed?: Address;
  readonly prefix?: readonly MimirBetaInstruction[];
}

/** Pools → definition → the one CREATE_CLASSIC transaction (SINGLE, or BEGIN + GROW × k + SEAL). */
export async function planMimirV1ClassicCreationFromPools(a: PlanMimirV1ClassicCreationArgs):
  Promise<MimirV1ClassicDefinitionResult & Readonly<{ plan: MimirV1CreationPlan; colaAmountRaw: bigint }>> {
  const def = await buildMimirV1ClassicDefinition(a);
  const [[tickerClaim, tickerBump], [generationCounter, counterBump], [adminConfig], [registry], [payerColaAta], oneChar] = await Promise.all([
    findMimirV1TickerClaimPda(a.programId, a.ticker), findMimirV1GenerationCounterPda(a.programId), findMimirV1AdminConfigPda(a.programId),
    findMimirV1RegistryPda(a.programId), findMimirV1AssociatedTokenAddress(a.payer, a.colaMint),
    a.ticker.length === 1 ? findMimirV1OneCharAllowancePda(a.programId, a.payer) : undefined]);
  const colaAmountRaw = computeMimirV1TickerTariff(a.colaBaseAmountRaw, a.ticker, a.tickerTierTenths);
  const orcaAdmissionOracles = a.pools.flatMap((pool) => (pool.readPlan?.auxiliary ?? []).filter((node) => node.role === "orca-oracle").map((node) => node.address));
  const plan = planMimirV1ClassicCreation({ programId: a.programId, payer: a.payer, feed: def.feed, tickerClaim, generationCounter, adminConfig, registry,
    colaMint: a.colaMint, payerColaAta, ...(a.solFeed ? { solFeed: a.solFeed } : {}), ...(orcaAdmissionOracles.length ? { orcaAdmissionOracles } : {}), ...(oneChar ? { oneCharAllowance: oneChar[0] } : {}),
    sourceAccounts: a.rows.map((r, i) => [...r.externals, ...(def.boostVaults[i] ? [def.boostVaults[i]!] : [])]), head: { n: def.n, s: def.s, targetBump: def.feedBump, tickerBump, counterBump },
    colaAmountRaw, finalLen: def.exactLen, feedId: def.feedId, definition: def.definition, ...(a.prefix ? { prefix: a.prefix } : {}) });
  return { ...def, plan, colaAmountRaw };
}

export interface PrepareMimirV1ClassicCreationArgs {
  readonly programId: Address; readonly payer: Address; readonly ticker: string;
  readonly baseMint: Address; readonly quoteMint: Address;
  /** Discovery-selected pools, row order. Floors: `minLiquidityNative = 1`, depth = `conservativeMintOracleSourceConfigFloor(depth, policy.depthFloorBps ?? 900)`. */
  readonly pools: readonly MimirBetaEligiblePool[];
  readonly policy: BuildMimirV1ClassicDefinitionArgs["policy"];
  /** A fixed variant, or `"new"` = the first variant ≥ 1 whose feed is not a Mimir account. Variant 0 is admin-only. */
  readonly variant: number | "new";
  /**
   * Per-pool classic recipe, as v1 `prepareMimirBetaSimpleFeedConfirmed`: omitted or `null` = `"spot"` (CPMM mode0/E4);
   * `"native-bounded"` (CLMM, CPMM, DLMM), `"dual-native-point"` (one CPMM v0 or DLMM pool), `"current-point"` (direct DLMM) or a mode-3 arm.
   * A SOL converter feed must pass `"native-bounded"` explicitly: a default spot CLMM SOL feed is not an admitted converter.
   */
  readonly recipes?: readonly (MimirClassicRowRecipe | null)[];
  /** Defaults to `"current-point"` when a `current-point` DLMM row, or (without `rows`) an AMMv4/PumpSwap source, is selected. */
  readonly temporalMode?: MimirTemporalMode;
  /** Override the recipe rows (recipe + live vector); default: one `mimirClassicRow` per resolved recipe. */
  readonly rows?: PlanMimirV1ClassicCreationArgs["rows"];
  /** The variant-0 SOL feed, required iff the quote is wSOL. */
  readonly solFeed?: Address;
  readonly cluster?: "mainnet" | "devnet" | "localnet";
  readonly prefix?: readonly MimirBetaInstruction[];
  /**
   * Auto tolerances (`mimirAutoClassicPolicy`) from the selected pools read here: `policy` then supplies profile, risk tier, exponent,
   * hashes and `minSources`; `overrides` are the expert values, checked against the program bounds. The sealed policy is returned.
   */
  readonly auto?: Readonly<{ slotMs: number; overrides?: MimirClassicPolicyOverrides; observedConfidenceBps?: readonly number[]; observedDispersionBps?: readonly number[];
    observedPrice?: number;
    /** Observations from this preparer's own coherent read (no extra RPC call); they replace the fields above. A throw refuses the creation. */
    observe?: (accounts: ReadonlyMap<Address, MimirBetaAccount | null>) => Promise<Readonly<{ observedPrice?: number; observedDispersionBps?: readonly number[] }>>;
  }>;
}

/** Program `derived_membership_eligible` under the static binding: CPMM/DAMM v2 always, Orca/CLMM/DLMM static, never MTP4 or DUAL. */
export const mimirV1DerivedMembershipEligible = (adapterType: number, temporalKind: number) =>
  temporalKind !== C.TEMPORAL_MTP4_SAMPLED && temporalKind !== C.TEMPORAL_MTP4_POINT && temporalKind !== C.TEMPORAL_DUAL_NATIVE_POINT_V1
  && [0, 1, 2, 3, 7].includes(adapterType);

/** RPC preparer: one coherent read (admin, registry, mints, pool closures, recipe tails, SOL feed) → `planMimirV1ClassicCreationFromPools`. */
export async function prepareMimirV1ClassicCreation(rpc: MimirBetaFinalizedRpc, a: PrepareMimirV1ClassicCreationArgs) {
  const reader = new FinalizedRpcReader(rpc, "confirmed");
  const cluster = a.cluster ?? "mainnet";
  if (a.recipes !== undefined && (!Array.isArray(a.recipes) || a.recipes.length !== a.pools.length ||
      a.recipes.some((r, i) => r !== null && r !== "spot" && !isMimirClassicIntervalRecipe(r) &&
        (r === "dual-native-point" ? !mimirClassicDualAdmitted(a.pools, i) : r === "current-point" ? !mimirDlmmPointAdmitted(a.pools[i]!)
          : r !== "native-bounded" || !mimirClassicNativeAdmitted(a.pools[i]!.creation.adapterType))))) {
    betaError("INVALID_ARGUMENT", "classic recipes must be spot, native-bounded (CLMM, CPMM, DLMM), dual-native-point (one CPMM v0 or DLMM pool), current-point (direct DLMM) or a mode-3 arm, one per pool");
  }
  const recipes = a.pools.map((_, i) => a.recipes?.[i] ?? "spot" as const);
  const duals = recipes.map((r) => r === "dual-native-point");
  const dlmmPoints = recipes.map((r) => r === "current-point");
  const intervals = recipes.map((r, i) => {
    if (!isMimirClassicIntervalRecipe(r)) return null;
    const pool = a.pools[i]!;
    mimirClassicIntervalRow({ adapterType: pool.creation.adapterType, adapterVersion: pool.creation.adapterVersion, adapterAccounts: [], recipe: r, cluster, pool: pool.pool });
    return r;
  });
  const tails = await Promise.all(a.pools.map((pool, i) => recipes[i] === "native-bounded" || duals[i] ? mimirClassicNativeTail(pool) : null));
  if (a.temporalMode !== undefined && a.temporalMode !== "current-point" && a.temporalMode !== "sampled-interval") betaError("INVALID_ARGUMENT", "temporalMode invalid");
  const temporalMode = a.temporalMode ?? (dlmmPoints.includes(true) || !a.rows && a.pools.some((pool) => pool.creation.adapterType !== 3
    && mimirCurrentPointAdmitted(pool.creation.adapterType, pool.creation.adapterVersion)) ? "current-point" as const : undefined);
  if (dlmmPoints.includes(true) && temporalMode !== "current-point") betaError("INVALID_ARGUMENT", "a current-point DLMM row needs temporalMode current-point");

  const variant = a.variant === "new" ? (await findMimirV1FreeClassicVariant({ programId: a.programId, baseMint: a.baseMint, quoteMint: a.quoteMint,
    accountOwners: async (xs) => (await reader.accounts(xs)).value.map((x) => x?.owner ?? null) })).variant : a.variant;
  const [[adminConfig], [registry]] = await Promise.all([findMimirV1AdminConfigPda(a.programId), findMimirV1RegistryPda(a.programId)]);
  const pointRows = duals.includes(true) || dlmmPoints.includes(true);
  const orcaOracles = a.pools.map((pool) => pool.readPlan.auxiliary.find((node) => node.role === "orca-oracle")?.address);
  const nativeObservations = a.pools.map((pool, i) => recipes[i] !== "native-bounded" ? null
    : pool.creation.adapterType === 2 ? pool.creation.observationState! : tails[i]![0]!);
  const clockRows = pointRows || orcaOracles.some(Boolean) || nativeObservations.some(Boolean);
  const addresses = [...new Set([adminConfig, registry, a.baseMint, a.quoteMint, ...(clockRows ? [MIMIR_NATIVE_CLOCK_ADDRESS] : []), ...(a.solFeed ? [a.solFeed] : []),
    ...nativeObservations.filter((x): x is Address => x !== null),
    ...intervals.flatMap((r) => r ? mimirClassicIntervalPins(r, cluster) : []),
    ...a.pools.flatMap((pool) => [...pool.creation.staticAccounts.map((x) => x.address), ...pool.readPlan.allAddresses,
      ...(pool.creation.observationState ? [pool.creation.observationState] : [])])])];
  const read = await reader.accounts(addresses);
  const accounts = new Map(addresses.map((x, i) => [x, read.value[i] ?? null]));
  const need = (x: Address) => accounts.get(x) ?? betaError("CREATION_CONTEXT_REQUIRED", "V1 creation account missing", x);
  const admin = await decodeMimirBetaAdminContext(adminConfig, need(adminConfig).data);
  const epoch = (await decodeMimirBetaRegistryContext(registry, need(registry).data)).registryEpoch;
  intervals.forEach((r, row) => {
    if (!r) return;
    if (r === "damm-onlyb-interval-v1" || r === "damm-reserve-interval-v3") assertMimirClassicDammRecipePolicy({ row,
      version: r === "damm-onlyb-interval-v1" ? 1 : 3, pool: a.pools[row]!.pool, poolAccount: accounts.get(a.pools[row]!.pool) });
    assertMimirClassicIntervalGeneration(r, accounts, cluster);
  });
  const qualityRows = a.pools.map((pool, i) => ({ family: pool.family, pool: pool.pool, poolData: accounts.get(pool.pool)?.data, recipe: recipes[i] }));
  const sealed = a.auto ? mimirAutoClassicPolicy({ ...a.auto, ...await a.auto.observe?.(accounts), rows: qualityRows, base: a.policy }) : undefined;
  const policy: PrepareMimirV1ClassicCreationArgs["policy"] = sealed?.policy ?? a.policy;
  assertMimirPriceable({ kind: "classic", policy, rows: qualityRows });
  const depthFloorBps = policy.depthFloorBps ?? MIMIR_PARAM_MARGINS.depthFloorBps;
  const nowUnix = clockRows ? mimirAuthenticClockUnix(accounts.get(MIMIR_NATIVE_CLOCK_ADDRESS), read.slot, "DLMM point Clock is not authentic") : 0n;
  const notReady = nativeObservations.flatMap((observation, row) => {
    if (!observation) return [];
    const readiness = mimirClassicNativeRowReadiness({ row, pool: a.pools[row]!, poolAccount: accounts.get(a.pools[row]!.pool), observation,
      observationAccount: accounts.get(observation), nowUnix, cluster });
    return readiness.ready ? [] : [readiness];
  });
  if (notReady.length && a.pools.length - notReady.length < (policy.minSources ?? a.pools.length)) throw new MimirClassicNativeNotReadyError(notReady[0]!);
  a.pools.forEach((pool, i) => {
    if (pool.creation.adapterType !== 0) return;
    if (mimirOrcaAdaptive(need(pool.pool).data) !== (orcaOracles[i] !== undefined)) betaError("PLAN_STALE", "Orca adaptive tier differs from its capture plan", pool.pool);
    if (orcaOracles[i]) mimirOrcaAdmissionOracle(accounts.get(orcaOracles[i]!), pool.pool, pool.programId, nowUnix);
  });
  const pools = await Promise.all(a.pools.map(async (pool, i) => {
    const floor = conservativeMintOracleSourceConfigFloor(pool.minDepthTo50BpsNative, depthFloorBps);
    const point = pool.creation.adapterType === 3 && (duals[i] || dlmmPoints[i])
      ? await mimirDlmmPointPreflight(pool, accounts, read.slot, nowUnix, undefined, depthFloorBps) : null;
    const depth = point === null ? floor : duals[i] && floor > point
      ? await mimirDlmmPointPreflight(pool, accounts, read.slot, nowUnix, floor, depthFloorBps) : point;
    return { ...pool, minLiquidityNative: 1n, minDepthTo50BpsNative: depth };
  }));
  const rows = a.rows ?? await Promise.all(pools.map(async (pool, i) => {
    const live = await freshAdapterAccounts(pool, accounts, true);
    const point = temporalMode === "current-point" && (pool.creation.adapterType !== 3 || dlmmPoints[i]!)
      && mimirCurrentPointAdmitted(pool.creation.adapterType, pool.creation.adapterVersion);
    const interval = intervals[i] ? mimirClassicIntervalRow({ adapterType: pool.creation.adapterType, adapterVersion: pool.creation.adapterVersion,
      adapterAccounts: live, recipe: intervals[i]!, cluster, pool: pool.pool }) : null;
    const tail = tails[i];
    const row = mimirClassicRow({ role: "primary", adapterType: pool.creation.adapterType, adapterVersion: pool.creation.adapterVersion, currentPoint: point,
      ...(duals[i] ? { dual: true } : {}), ...(interval?.temporal ? { temporal: interval.temporal } : {}),
      ...(point && pool.creation.adapterType === 3 ? { temporal: mimirDlmmPointTemporal(cluster) } : {}),
      sourceConfig: a.programId, feedConfig: a.programId, sourcingPlan: a.programId, cluster,
      adapterAccounts: interval ? interval.adapterAccounts : duals[i] && pool.creation.adapterType === 2
        ? [...live.slice(0, 5), ...mimirExecutableGenerationPins(cluster).cpmm.slice(0, 2) as Address[]]
        : tail ? [...live, ...tail] : pool.creation.adapterType === 2 ? live.slice(0, 4) : live,
      witness: { feedId: new Uint8Array(32), sourceIndex: 0, ringVersion: 1, minSlotGap: point ? 0 : 1, expectedSourceConfigRevision: 1n, expectedSourceSetRevision: 1n,
        expectedPlanHash: new Uint8Array(32), sourceSetSiblings: [], accountsSiblings: [] } });
    return { ...row, derived: mimirV1DerivedMembershipEligible(row.recipe.adapterType, row.recipe.temporalKind) };
  }));
  const facts = [...new Set([a.baseMint, a.quoteMint, ...pools.flatMap((pool) => pool.creation.staticAccounts.map((x) => x.address))])]
    .map((address) => { const x = need(address); return { address, owner: x.owner, executable: x.executable }; });
  return { policy, widenedBy: sealed?.widenedBy ?? [], ...await planMimirV1ClassicCreationFromPools({ programId: a.programId, payer: a.payer, ticker: a.ticker, baseMint: a.baseMint, quoteMint: a.quoteMint,
    baseDecimals: need(a.baseMint).data[44]!, quoteDecimals: need(a.quoteMint).data[44]!, variant, registryEpoch: epoch, policy, pools,
    physicalAccounts: facts, rows, colaMint: admin.collateralMint ?? betaError("CREATION_CONTEXT_REQUIRED", "V1 admin has no COLA mint"),
    colaBaseAmountRaw: admin.collateralAmountRaw, tickerTierTenths: admin.tickerTierTenths, ...(temporalMode ? { temporalMode, dlmmPointRows: dlmmPoints } : {}),
    ...(a.solFeed ? { solFeed: a.solFeed, solFeedData: need(a.solFeed).data } : {}), ...(a.prefix ? { prefix: a.prefix } : {}) }) };
}
