import { recommendPools, scoreFeed, type FeedScore, type ScorePool } from "../easy/feedInfo.js";
import type { MimirBetaEligiblePool } from "../beta/discovery.js";
import { mimirCurrentPointAdmitted } from "../internal/currentPointCore.js";
import { admittedRowChoices, type RowChoice, type RowRecipe } from "./recipes.js";
import { SOL_QUOTE_MINT } from "./helpers.js";

export type ScoredPool = ScorePool & { readonly pool: MimirBetaEligiblePool; readonly choice: RowChoice | null };
export type Recommendation = { pools: MimirBetaEligiblePool[]; choices: Record<string, RowChoice>; score: FeedScore };
export type RecommendRequire = "market-grade" | { minScore?: number; marketGrade?: boolean };

const Q64 = 2 ** 64;
const venueDomain = (family: string) => family.startsWith("raydium-") ? "raydium" : family.startsWith("meteora-") ? "meteora" : family;

/** A pool whose Default row seals current-point (PumpSwap, Raydium AMM v4). */
export const isCurrentPointPool = (pool: MimirBetaEligiblePool) =>
  pool.creation !== undefined && pool.creation.adapterType !== 3 && mimirCurrentPointAdmitted(pool.creation.adapterType, pool.creation.adapterVersion);

/** Row mode the recipe seals: Default spot 0 (current-point 5 on AMM v4/PumpSwap), native-bounded 2, interval 3, current-point 5. */
export function recipeMode(recipe: RowRecipe | "spot" | "dual-native-point" | undefined, pool?: MimirBetaEligiblePool): number {
  return !recipe || recipe === "spot" ? (pool && isCurrentPointPool(pool) ? 5 : 0) : recipe === "native-bounded" || recipe === "dual-native-point" ? 2 : recipe === "current-point" ? 5 : 3;
}

/** Search depth to 50 bps in USDC; SOL-quoted depth goes through Mimir's own SOL/USDC price. */
export function depthUsdc(pool: MimirBetaEligiblePool, usdcMint: string, solUsdcX64?: bigint): number | null {
  if (typeof pool.minDepthTo50BpsNative !== "bigint") return null;
  const native = Number(pool.minDepthTo50BpsNative);
  if (pool.quoteMint === usdcMint) return native / 1e6;
  return pool.quoteMint === SOL_QUOTE_MINT && solUsdcX64 ? native / 1e9 * Number(solUsdcX64) / Q64 : null;
}

/** Native-bounded (direct) only on Raydium CLMM, the one family whose native price stays priced when the pool is quiet; Default otherwise. */
export function autoChoice(pool: MimirBetaEligiblePool): RowChoice | null {
  if (pool.creation?.adapterType !== 1) return null;
  return admittedRowChoices(pool).find((choice) => choice.recipe === "native-bounded" && !choice.routeable) ?? null;
}

/** Program-fixed pool confidence: CPMM family 1, Orca/CLMM/DAMM 5; DLMM (bin step) is not on the search result. */
export const CONF_BPS: Readonly<Record<number, number>> = { 0: 5, 1: 5, 2: 1, 4: 1, 6: 1, 7: 5 };

export function scoreInput(pool: MimirBetaEligiblePool, choice: RowChoice | null, usdcMint: string, solUsdcX64?: bigint): ScoredPool {
  const confBps = pool.creation ? CONF_BPS[pool.creation.adapterType] : undefined;
  return { pool, choice, exchange: venueDomain(pool.family ?? ""), depth50Usdc: depthUsdc(pool, usdcMint, solUsdcX64), mode: recipeMode(choice?.recipe ?? undefined, pool),
    ...(pool.creation ? { adapterType: pool.creation.adapterType } : {}), ...(choice?.recipe === "dual-native-point" ? { temporalKind: 6 } : {}), ...(confBps === undefined ? {} : { confBps }) };
}

const passes = (score: FeedScore, require?: RecommendRequire) => {
  if (!require) return true;
  const r = require === "market-grade" ? { marketGrade: true } : require;
  const m = score.marketFit;
  const grade = m.fit !== false && m.eligible === true && m.confFloorBps !== null && m.confFloorBps <= score.fitVerdict.limits.parentMaxConfBps;
  return (!r.marketGrade || grade) && score.score >= (r.minScore ?? 0);
};

/**
 * The pools a new feed should use, the same pick as the Mimir App: per quote the best-scoring set, USDC unless SOL scores at least 5
 * higher. `require` keeps only sets that are market-grade or reach `minScore`. Null when no set qualifies.
 */
export function recommend(pools: readonly MimirBetaEligiblePool[], opts: { usdcMint: string; solUsdcX64?: bigint; single?: boolean; require?: RecommendRequire }): Recommendation | null {
  const { usdcMint, solUsdcX64, single = false } = opts;
  const final = (entries: readonly { pool: MimirBetaEligiblePool; choice: RowChoice | null }[]) =>
    scoreFeed({ pools: entries.map((e) => scoreInput(e.pool, single ? null : e.choice, usdcMint, solUsdcX64)) });
  const pick = (quote: string) => {
    const candidates = pools.filter((pool) => pool.quoteMint === quote && pool.family && typeof pool.minDepthTo50BpsNative === "bigint")
      .map((pool) => { const { mode: _, ...rest } = scoreInput(pool, autoChoice(pool), usdcMint, solUsdcX64); return rest as ScoredPool; });
    type Set = { pools: ScoredPool[]; score: FeedScore };
    const singles = candidates.map((candidate) => ({ pools: [candidate], score: scoreFeed({ pools: [candidate] }) }))
      .filter((e): e is Set => e.score !== null).sort((a, b) => b.score.score - a.score.score);
    const sets = single ? singles : [recommendPools(candidates), ...(opts.require ? singles : [])].filter((e): e is Set => !!e);
    return sets.find((e) => { const s = final(e.pools); return s !== null && passes(s, opts.require); }) ?? null;
  };
  const usdc = pick(usdcMint), sol = pick(SOL_QUOTE_MINT);
  const chosen = sol && (!usdc || sol.score.score >= usdc.score.score + 5) ? sol : usdc;
  if (!chosen) return null;
  const entries = chosen.pools.every((e) => e.choice) ? chosen.pools : chosen.pools.map((e) => ({ ...e, choice: null }));
  const score = final(entries);
  return score ? { pools: entries.map((e) => e.pool), choices: Object.fromEntries(entries.flatMap((e) => e.choice ? [[e.pool.pool, e.choice]] : [])), score } : null;
}
