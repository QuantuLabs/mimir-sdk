import type { Address } from "@solana/kit";
import type { MimirBetaAccount } from "./types.js";
import { mimirBetaEligiblePoolConditions, type MimirBetaEligiblePool } from "./discovery.js";
import { mimirBetaSourceQualityFloorBps } from "./creation.js";
import { mimirAutoClassicPolicy, MIMIR_PARAM_MARGINS } from "./params.js";
import { deriveMimirClassicRecipe } from "./classicExecution.js";
import { lifecycleDomain } from "./abi.js";
import { mimirAuthenticClockUnix, mimirClassicIntervalRow, mimirClassicNativeRowReadiness, mimirClassicNativeTail, isMimirClassicIntervalRecipe, type MimirClassicRowRecipe,
  type MimirClassicNativeReadiness } from "./live.js";
import { conservativeMintOracleSourceConfigFloor, meteoraDlmmPriceFromCumulativeBinX64, meteoraDlmmPriceFromIdX64 } from "../math.js";
import { mimirCurrentPointAdmitted } from "../internal/currentPointCore.js";
import { decodeFeedSnapshotHeader, extractMeteoraDlmmNativeTwapSample, mimirNativeLagEnvelope, MIMIR_NATIVE_CLOCK_ADDRESS, type MimirGenerationCluster } from "../internal/nativeMonoRefreshCore.js";
import { findMimirV1SolFeedPda } from "../v1/composite.js";
import { decodeV1ClassicFeed } from "../v1/decoders.js";
import { MIMIR_V1_FEED_IMAGE_LEN, MIMIR_V1_PLAN_IMAGE_LEN } from "../v1/build.js";
import { CFG_OFFSET_QUOTE_MINT, CLASSIC_OWNER, OFFSET_STATUS, SRC_OFFSET_BASE_MINT, SRC_OFFSET_BASE_VAULT, SRC_OFFSET_POOL_OR_MARKET, SRC_OFFSET_PROGRAM_ID, SRC_OFFSET_QUOTE_MINT,
  SRC_OFFSET_QUOTE_VAULT } from "../v1/layout/classic.js";
import { deriveMimirBetaCaptureReadPlan, mimirBetaCaptureScanDescriptors } from "./capture.js";
import { NOTICE_NONE, STATUS_ACTIVE } from "../v1/layout/common.js";
import { MIMIR_MAINNET_CLASSIC_POLICY } from "../create/policy.js";
import { addressBytes, bytesAddress, bytesEqual } from "./bytes.js";
import { marketFit, normalizeSolToUsdc6, type MarketFitCohort, type MarketFitDefinition, type MarketFitIntent, type MarketFitRow, type MarketFitVerdict } from "../easy/marketFit.js";
import { MARKET_RULES, type MarketRules } from "../easy/marketRules.js";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
/** Versions the SDK's V1 path reads and writes: snapshot prefix v0 (`decodeFeedSnapshotHeader`), config image v0 (`v1/definition.ts`). */
const SDK_LAYOUT_VERSIONS = { snapshot: 0, configImage: 0 };

/** What the V1 create path would seal: pools in row order, one recipe each (null = spot), quote and variant. */
export type PlanFitPlan = Readonly<{
  pools: readonly MimirBetaEligiblePool[];
  recipes?: readonly (MimirClassicRowRecipe | null)[];
  quote: "USDC" | "SOL" | string;
  programId: Address;
  /** `"new"` = the first free variant ≥ 1 (the V1 create default). */
  variant: number | "new";
  cluster?: MimirGenerationCluster;
}>;

export type PlanFitResult = Readonly<{
  definition: MarketFitDefinition; cohort: MarketFitCohort;
  intents: Readonly<{ default: MarketFitIntent; other: MarketFitIntent }>;
  asOfSlot: bigint;
  /** The rules the projection was built with; `marketFitForPlan` checks against them. */
  rules: MarketRules;
}>;

const solFeed = (programId: Address) => findMimirV1SolFeedPda(programId, USDC_MINT).then(([x]) => x);
const recipesOf = (plan: PlanFitPlan) => plan.pools.map((_, i) => plan.recipes?.[i] ?? "spot");

async function observationOf(pool: MimirBetaEligiblePool): Promise<Address | undefined> {
  if (pool.creation.adapterType === 2) return pool.creation.observationState ?? undefined;
  return (await mimirClassicNativeTail(pool))[0];
}

/** DLMM converter rows read from the converter feed: pool, oracle, and the sealed mints/vaults; null when a row is not a DLMM row. */
async function converterSources(feed: MimirBetaAccount | null | undefined) {
  try {
    if (!feed) return undefined;
    return await Promise.all(decodeV1ClassicFeed(feed.data, feed.address).rows.map(async (r) => {
      if (r.descriptor.adapterType !== 3) return null;
      const key = (at: number) => bytesAddress(r.source.subarray(at, at + 32));
      const pool = key(SRC_OFFSET_POOL_OR_MARKET);
      return { pool, programId: key(SRC_OFFSET_PROGRAM_ID), oracle: (await mimirClassicNativeTail({ pool, creation: { adapterType: 3 } } as MimirBetaEligiblePool))[0]!,
        baseMint: key(SRC_OFFSET_BASE_MINT), quoteMint: key(SRC_OFFSET_QUOTE_MINT), baseVault: key(SRC_OFFSET_BASE_VAULT), quoteVault: key(SRC_OFFSET_QUOTE_VAULT) };
    }));
  } catch { return undefined; }
}

/**
 * Pool authentication with the SDK's capture reader: owner, allocation, discriminator, active status, oriented mints, then the expected
 * vaults. True = this pool; false = known absent or another account; undefined = not read, or no reader/clock to authenticate it.
 */
function poolBinding(acc: ReadonlyMap<string, MimirBetaAccount | null> | undefined, p: Readonly<{ family: string; programId: Address; pool: Address;
  descriptorId?: string; baseMint: Address; quoteMint: Address; baseVault?: Address; quoteVault?: Address }>, slot: bigint, nowUnix: bigint | undefined,
  cluster: MimirGenerationCluster): boolean | undefined {
  if (!acc?.has(p.pool)) return undefined;
  const a = acc.get(p.pool);
  if (!a) return false;
  const ds = mimirBetaCaptureScanDescriptors(cluster === "mainnet" ? "mainnet-beta" : cluster)
    .filter((d) => d.family === p.family && d.programId === p.programId && (p.descriptorId == null || d.descriptorId === p.descriptorId));
  if (!ds.length || nowUnix === undefined || !p.baseVault || !p.quoteVault) return undefined;
  try {
    const r = deriveMimirBetaCaptureReadPlan({ descriptor: ds.find((d) => d.allocationSize === a.data.length) ?? ds[0]!,
      primary: { address: p.pool, owner: a.owner, executable: a.executable, data: a.data }, pair: { baseMint: p.baseMint, quoteMint: p.quoteMint },
      context: { observedSlot: slot, observedUnixTimestamp: nowUnix } });
    return r.baseVault === p.baseVault && r.quoteVault === p.quoteVault;
  } catch { return false; }
}

/**
 * Accounts the verdict needs beyond the pool accounts: native observations, the SOL converter feed (SOL quote) and the Clock.
 * SOL quote: call again with the accounts read so far; once the converter feed is read, its DLMM source pools and oracles are added
 * (the converter's refresh projection reads them; its bin arrays and vaults are not read).
 */
export async function planFitReads(plan: PlanFitPlan, accounts?: ReadonlyMap<string, MimirBetaAccount | null>): Promise<Address[]> {
  const recipes = recipesOf(plan);
  const obs = await Promise.all(plan.pools.map((p, i) => recipes[i] === "native-bounded" ? observationOf(p) : undefined));
  const sol = plan.quote === "SOL" ? await solFeed(plan.programId) : undefined;
  const conv = sol ? (await converterSources(accounts?.get(sol))) ?? [] : [];
  return [...new Set([...obs.filter((x): x is Address => !!x), ...(sol ? [sol] : []),
    ...conv.flatMap((c) => (c ? [c.pool, c.oracle] : [])), MIMIR_NATIVE_CLOCK_ADDRESS])];
}

/** (mode, temporal kind) from the SDK recipe table: the arms over every external width must agree on the class (spot / other). */
function tupleOf(pool: MimirBetaEligiblePool, recipe: MimirClassicRowRecipe, point: boolean, cluster: MimirGenerationCluster) {
  const t = pool.creation.adapterType, v = pool.creation.adapterVersion;
  const tm = isMimirClassicIntervalRecipe(recipe) ? mimirClassicIntervalRow({ adapterType: t, adapterVersion: v, adapterAccounts: [], recipe, cluster }).temporal?.version
    : point ? 4 : undefined;
  const found = new Map<string, { mode: number; temporalKind: number }>();
  for (let e = 1; e <= 12; e++) {
    try {
      const r = deriveMimirClassicRecipe({ role: "primary", adapterType: t, adapterVersion: v, externalWidth: e, ...(tm !== undefined ? { temporalModuleVersion: tm } : {}),
        currentPoint: point, minSlotGap: point ? 0 : 1, ...(recipe === "dual-native-point" ? { dual: true } : {}) });
      if (recipe === "native-bounded" && r.mode !== 2) continue;
      if (recipe === "spot" && !point && ![0, 1, 6].includes(r.mode)) continue;
      found.set(`${[0, 1, 6].includes(r.mode) ? "spot" : r.mode}/${r.temporalKind}`, { mode: r.mode, temporalKind: r.temporalKind });
    } catch { /* no arm at this width */ }
  }
  return found.size === 1 ? [...found.values()][0]! : undefined;
}

/** DLMM native quality from the same oracle read: bin step, widened by the lag envelope when spot is > 50 bps off the window mean. */
function dlmmNativeConfBps(pool: Uint8Array, oracle: Uint8Array, nowUnix: bigint, cluster: MimirGenerationCluster): number {
  const v = new DataView(pool.buffer, pool.byteOffset, pool.byteLength), step = v.getUint16(80, true);
  const s = extractMeteoraDlmmNativeTwapSample({ oracleData: oracle, currentTimestamp: nowUnix, activeId: v.getInt32(76, true), cluster });
  const mean = meteoraDlmmPriceFromCumulativeBinX64(s.newCumulativeBin - s.oldCumulativeBin, s.newTimestamp - s.oldTimestamp, step);
  return mimirNativeLagEnvelope(mean, meteoraDlmmPriceFromIdX64(v.getInt32(76, true), step), Math.min(step, 10_000), 0xffff)?.confidenceBps ?? Math.min(step, 10_000);
}

/**
 * Builds the market-fit definition, cohort and intents from a V1 create plan and one batched read (`planFitReads` + pool accounts).
 * Pure (no RPC). `accounts` undefined or an address absent from the map = not read (MISSING); an address read as null = known absent (FAIL).
 */
export async function planFit(plan: PlanFitPlan & Readonly<{ accounts: ReadonlyMap<string, MimirBetaAccount | null> | undefined; slot: bigint;
  slotMs?: number; rules?: MarketRules }>): Promise<PlanFitResult> {
  const rules = plan.rules ?? MARKET_RULES, cluster = plan.cluster ?? "mainnet", acc = plan.accounts;
  const recipes = recipesOf(plan), n = plan.pools.length, sol = plan.quote === "SOL";
  const nowUnix = (() => { try { return acc && mimirAuthenticClockUnix(acc.get(MIMIR_NATIVE_CLOCK_ADDRESS), plan.slot, "Clock"); } catch { return undefined; } })();
  const pointPlan = recipes.includes("current-point") || plan.pools.some((p) => p.creation.adapterType !== 3 && mimirCurrentPointAdmitted(p.creation.adapterType, p.creation.adapterVersion));
  const points = plan.pools.map((p, i) => recipes[i] === "current-point" || (pointPlan && recipes[i] === "spot" && p.creation.adapterType !== 3
    && mimirCurrentPointAdmitted(p.creation.adapterType, p.creation.adapterVersion)));
  const floorConf = (p: MimirBetaEligiblePool) => { try { return mimirBetaSourceQualityFloorBps(p.family, acc?.get(p.pool)?.data).confidenceBps; } catch { return undefined; } };
  // Binding: the pool account read in the same batch authenticates as the planned pool; null = known absent.
  const binding = (p: MimirBetaEligiblePool) => poolBinding(acc, p, plan.slot, nowUnix, cluster);

  const rows: MarketFitRow[] = plan.pools.map((p, i) => {
    const tuple = tupleOf(p, recipes[i]!, points[i]!, cluster), bound = binding(p);
    let floorNative: bigint | undefined;
    try { floorNative = conservativeMintOracleSourceConfigFloor(p.minDepthTo50BpsNative, MIMIR_PARAM_MARGINS.depthFloorBps); } catch { /* invalid depth: MISSING */ }
    return { ...(tuple ?? {}), adapterType: p.creation.adapterType, confBps: floorConf(p), depthNative: p.minDepthTo50BpsNative, floorNative,
      liquidity: acc?.has(p.pool) && acc.get(p.pool) === null ? null : p.minLiquidityNative, condition: mimirBetaEligiblePoolConditions(p),
      ...(bound !== undefined ? { binding: bound } : {}) };
  });
  const variant = plan.variant === "new" ? 1 : plan.variant;
  const definition: MarketFitDefinition = { kind: "classic", quote: plan.quote, rows, variant };

  // Native rows: readiness from the observation in the same read; not read → MISSING.
  const native: { ready: MimirClassicNativeReadiness | null; conf?: number }[] = [];
  let nativeMissing = false;
  for (const [i, p] of plan.pools.entries()) {
    if (rows[i]!.mode !== 2 || rows[i]!.temporalKind === 6) continue;
    const obs = await observationOf(p).catch(() => undefined);
    if (!acc || nowUnix === undefined || !obs || !acc.has(obs) || !acc.get(p.pool)) { nativeMissing = true; continue; }
    let ready: MimirClassicNativeReadiness | null = null;
    try { ready = mimirClassicNativeRowReadiness({ row: i, pool: p, poolAccount: acc.get(p.pool), observation: obs, observationAccount: acc.get(obs), nowUnix, cluster }); }
    catch { /* identity changed or unsound: the row cannot prove */ }
    let conf: number | undefined;
    if (ready?.ready && p.creation.adapterType === 3) { try { conf = dlmmNativeConfBps(acc.get(p.pool)!.data, acc.get(obs)!.data, nowUnix, cluster); } catch { /* no window */ } }
    // ponytail: CLMM/CPMM native confidence is not projected here (MISSING_BOUNDS); add their quality calls when needed.
    native.push({ ready, ...(conf !== undefined ? { conf } : {}) });
  }
  const support = (r: MimirClassicNativeReadiness | null) => r?.ready && r.maxEligibleSpanSecs != null ? Number(r.maxEligibleSpanSecs) : 0;
  const modes = rows.map((r) => r.mode);
  const history: MarketFitCohort["history"] = modes.some((m) => m === 3 || m === 4) ? { afterCreation: true }
    : native.length && !nativeMissing ? { supportSec: Math.min(...native.map((x) => support(x.ready))), rawSpanSec: Math.min(...native.map((x) => support(x.ready))) }
    : undefined;

  // Converter (SOL quote): identity, lifecycle, recipes and USDC quote, then a fresh price in the trade transaction. The matcher reads the
  // converter embedded in the new feed, refreshed in the same transaction (skew ≤ 2): every converter source authenticated and ready now.
  // A stored price alone proves nothing; it only gives the lower bound for a point D50 while fresh. The refresh's depth, liquidity and
  // vault conditions (bin arrays, vaults) are not read here: `condition` stays undefined (MISSING_CONVERTER) unless the caller proves it.
  let converter: MarketFitCohort["converter"], solLowerX64: bigint | undefined;
  if (sol && acc) {
    const address = await solFeed(plan.programId), a = acc.get(address);
    if (!acc.has(address)) converter = undefined;
    else if (!a) converter = null;
    else {
      try {
        const f = decodeV1ClassicFeed(a.data, address), h = decodeFeedSnapshotHeader(f.prefix);
        const usdc = bytesEqual(f.definition.feedImage.subarray(CFG_OFFSET_QUOTE_MINT, CFG_OFFSET_QUOTE_MINT + 32), addressBytes(USDC_MINT));
        const recipeOk = f.rows.every((r) => rules.converterRecipes.some((x) => x.adapterType === r.descriptor.adapterType
          && x.adapterVersion === r.descriptor.adapterVersion && x.mode === r.descriptor.mode));
        const valid = a.owner === plan.programId && !a.executable && f.header.status === STATUS_ACTIVE && f.owner.noticeKind === NOTICE_NONE && recipeOk && usdc;
        // Stored price usable as is: recorded, not degraded, quote OK, bounded, and the read slot inside [snapshot, valid until] (as `decodePrice`).
        const p = h.priceX64, lo = h.priceLowerX64, hi = h.priceUpperX64;
        const storedFresh = valid && f.prefix[OFFSET_STATUS] === 0 && h.snapshotRevision > 0n && h.quoteStatus === 0 && lo > 0n && lo <= p && p <= hi
          && h.snapshotSlot <= plan.slot && plan.slot <= h.validUntilSlot;
        let fresh: boolean | undefined, confBps: number | undefined, dispersionBps: number | undefined, sourcesValid = true;
        if (valid && nowUnix !== undefined) {
          // Refresh projection from the converter's own DLMM sources; any other family is not projected (MISSING). A source known
          // absent or not the sealed pool invalidates the converter.
          const sources = await converterSources(a);
          const ready: (number | false | undefined)[] = (sources ?? [undefined]).map((c) => {
            if (c && [c.pool, c.oracle].some((x) => acc.has(x) && !acc.get(x))) { sourcesValid = false; return undefined; }
            if (!c || !acc.has(c.pool) || !acc.has(c.oracle)) return undefined;
            const pa = acc.get(c.pool), oa = acc.get(c.oracle);
            const bound = poolBinding(acc, { ...c, family: "meteora-dlmm" }, plan.slot, nowUnix, cluster);
            if (!pa || !oa || bound === false || oa.owner !== pa.owner) { sourcesValid = false; return undefined; }
            if (bound !== true) return undefined;
            try {
              const r = mimirClassicNativeRowReadiness({ row: 0, pool: { pool: c.pool, programId: pa.owner, creation: { adapterType: 3 } } as MimirBetaEligiblePool,
                poolAccount: pa, observation: c.oracle, observationAccount: oa, nowUnix, cluster });
              if (!r.ready) return false;
              const step = mimirBetaSourceQualityFloorBps("meteora-dlmm", pa.data).confidenceBps;
              return Math.max(step, dlmmNativeConfBps(pa.data, oa.data, nowUnix, cluster));
            } catch { return undefined; }
          });
          fresh = ready.includes(false) ? false : ready.every((x) => typeof x === "number") ? true : undefined;
          if (fresh) {
            confBps = Math.max(...(ready as number[]));
            // One row: its publication has no dispersion; several rows are not projected.
            if (ready.length === 1) dispersionBps = 0;
            if (storedFresh) solLowerX64 = lo;
          }
        }
        converter = { valid: valid && sourcesValid, ...(fresh !== undefined ? { fresh } : {}), ...(confBps !== undefined ? { confBps } : {}),
          ...(dispersionBps !== undefined ? { dispersionBps } : {}) };
      } catch { converter = { valid: false }; }
    }
  }

  // Publication: one row is refreshed in the trade transaction (age 0); several rows have no projectable aggregate. Projected only
  // from authenticated inputs: every pool account read and bound.
  const single = n === 1, spot = single && [0, 1, 6].includes(modes[0] ?? -1);
  const bound = rows.every((r) => r.binding === true);
  const venues = new Set(plan.pools.map((p) => { try { return lifecycleDomain(p.creation.adapterType); } catch { return -1; } })).size;
  const proofValid = single ? (modes[0] === 2 && rows[0]!.temporalKind !== 6 ? (native[0] ? native[0].ready !== null && native[0].ready.ready : undefined) : true) : undefined;
  const pubConf = single ? (points[0] ? rows[0]!.confBps : native[0]?.conf) : undefined;
  const publication: MarketFitCohort["publication"] = bound ? { qualifiedSources: n, qualifiedVenues: venues, coverageBps: 10_000, ageSlots: 0, stored: false,
    ...(single ? { dispersionBps: 0 } : {}), ...(pubConf !== undefined ? { confBps: pubConf } : {}), ...(proofValid !== undefined && !spot ? { proofValid } : {}) } : undefined;

  // Point / DUAL capacity: the live D50 (smallest row) in USDC6; a SOL quote needs the converter's fresh lower bound.
  let capacity: MarketFitCohort["capacity"];
  if (points.some(Boolean) || rows.some((r) => r.temporalKind === 6)) {
    try {
      const d50 = plan.pools.map((p) => p.minDepthTo50BpsNative).reduce((a, b) => (b < a ? b : a));
      const d50Usdc6 = !sol ? d50 : solLowerX64 ? normalizeSolToUsdc6(d50, solLowerX64) : undefined;
      if (typeof d50 === "bigint" && d50 >= 0n && d50Usdc6 !== undefined) capacity = { d50Usdc6 };
    } catch { /* invalid depth: MISSING_CAPACITY */ }
  }

  const cohort: MarketFitCohort = {
    target: { program: plan.programId === rules.mimirProgram, lifecycle: true,
      layout: rules.layout?.snapshotVersion === SDK_LAYOUT_VERSIONS.snapshot && rules.layout.configImageVersion === SDK_LAYOUT_VERSIONS.configImage
        && rules.layout.configImageBytes === MIMIR_V1_FEED_IMAGE_LEN && rules.layout.planImageBytes === MIMIR_V1_PLAN_IMAGE_LEN && rules.layout.prefixBytes === CLASSIC_OWNER },
    existing: false, ...(variant !== 0 ? { feedOi: { admitted: false } } : {}),
    ...(converter !== undefined ? { converter } : {}), ...(history ? { history } : {}), publication, ...(capacity ? { capacity } : {}),
  };

  // Intent: the auto policy the create path seals, with the market's single-proof clamp.
  let policy: MarketFitIntent["policy"];
  try {
    const sealed = mimirAutoClassicPolicy({ rows: plan.pools.map((p, i) => ({ family: p.family, pool: p.pool, poolData: acc?.get(p.pool)?.data, recipe: recipes[i] })),
      slotMs: plan.slotMs ?? 400, base: MIMIR_MAINNET_CLASSIC_POLICY as never }).policy;
    const proof = rows.every((r) => r.mode === 3) || (single && modes[0] === 2 && rows[0]!.temporalKind !== 6);
    policy = { feedMaxConfBps: sealed.maxConfidenceBps,
      maxDispersionBps: proof ? Math.min(sealed.maxDispersionBps, rules.singleProof.maxDispersionBps) : sealed.maxDispersionBps,
      minCoverageBps: proof ? Math.max(sealed.minCoverageRatioBps, rules.singleProof.minCoverageBps) : sealed.minCoverageRatioBps,
      deviationBps: rules.deviationBps.market, minSources: n, minVenues: venues, ageSlots: sealed.maxSnapshotAgeSlots };
  } catch { policy = undefined; }
  const pointTerms = points.some(Boolean) || modes.includes(4) || rows.some((r) => r.temporalKind === 6), terms = (pointTerms ? rules.terms?.point : rules.terms?.band) ?? {};
  // Point markets: minimum position and activation at min(cap, smallest trade).
  const intent = (profile: "stable" | "volatile"): MarketFitIntent => ({ profile: { ...rules.profiles?.[profile],
    ...(pointTerms ? { minActivationUsdc: terms.tradeUsdc, minPositionUsdc: terms.tradeUsdc } : {}) },
    ...(policy ? { policy } : {}), ...terms, usedMarketUsdc: 0 });
  return { definition, cohort, intents: { default: intent(sol ? "volatile" : "stable"), other: intent(sol ? "stable" : "volatile") }, asOfSlot: plan.slot, rules };
}

/** One-call verdict on the reference profile (collateral = the feed's quote), plus the other collateral's, under the plan's own rules. */
export function marketFitForPlan(fit: PlanFitResult): Readonly<{ verdict: MarketFitVerdict; other: MarketFitVerdict }> {
  return { verdict: marketFit(fit.definition, fit.cohort, fit.intents.default, fit.rules), other: marketFit(fit.definition, fit.cohort, fit.intents.other, fit.rules) };
}
