import { MIMIR_CLASSIC_ADMITTED_CONVERTER_RECIPES } from "../beta/classicExecution.js";
import type { MarketProfile } from "./marketFit.js";

/** Mobile standard create terms, stable collateral. */
export const MARKET_STANDARD_STABLE: MarketProfile = { name: "lending-standard-stable", imBps: 500, mmBps: 250, maxConfBps: 100,
  stalenessSec: 45, collateral: "stable", kappaBps: 1000, maxTraderOiBps: 2000, maxPositionUsdc: 10_000, minActivationUsdc: 250 };
/** Same, volatile collateral: max confidence 300. */
export const MARKET_STANDARD_VOLATILE: MarketProfile = { ...MARKET_STANDARD_STABLE, name: "lending-standard-volatile",
  maxConfBps: 300, collateral: "volatile" };

/** What the lending market accepts, read from one program revision. Data only: a market update ships a new object, never new evaluator code. */
export type MarketRules = Readonly<{
  revision: string;
  mimirProgram: string;
  layout: Readonly<{ snapshotVersion: number; prefixBytes: number; configImageVersion: number; configImageBytes: number; planImageBytes: number }>;
  quotes: Readonly<{ classic: readonly ("USDC" | "SOL")[]; composite: readonly "USDC"[] }>;
  /** Row tuples the market authenticates; `adapters` omitted = any family. A known row outside the list → RECIPE_UNSUPPORTED. */
  recipes: readonly Readonly<{ mode: number; kind: number; adapters?: readonly number[] }>[];
  converterRecipes: readonly Readonly<{ adapterType: number; adapterVersion: number; mode: number }>[];
  /** Which feed ids get a FeedOI without admin admission: only variant 0 today. */
  feedOi: Readonly<{ permissionless: "canonical" | "any" }>;
  deviationBps: Readonly<{ min: number; max: number; market: number }>;
  singleProof: Readonly<{ minCoverageBps: number; maxDispersionBps: number; deviationBps: number }>;
  history: Readonly<{ minSupportSec: number; minSampledRecords: number }>;
  age: Readonly<{ liveSlots: number; storedSlots: number; componentSkewSlots: number }>;
  /** Admissible (IM, MM) pairs: the standard pair, and the high-leverage pair only with max confidence / staleness within its bounds. */
  margins: Readonly<{ imBps: number; mmBps: number }>;
  highRisk: Readonly<{ imBps: number; mmBps: number; maxConfBps: number; maxStalenessSec: number }>;
  /** Market profiles; `stable` / `volatile` are the app's Standard terms by collateral. */
  profiles: Readonly<Record<"stable" | "volatile", MarketProfile>>;
  /** Smallest market the app opens, per cap regime (SPEC §3b: band 500/50, point 2/1). */
  terms: Readonly<{ band: Readonly<{ seedUsdc: number; tradeUsdc: number }>; point: Readonly<{ seedUsdc: number; tradeUsdc: number }> }>;
  /** BAND minimum position the mobile line seals: min(usable × usableBps / 10000, maxUsdc), usable = min(max position, FeedOI limit,
   * seed × min(kappa, max trader OI) / 10000); activation = minimum × 10000 / usableBps (5×), rounded up. The market requires
   * min > 0 and rejects a smaller Open. */
  minPosition: Readonly<{ usableBps: number; maxUsdc: number; feedOiLimitUsdc: number }>;
}>;

/** Revision of these market rules. */
export const MARKET_RULES: MarketRules = Object.freeze<MarketRules>({
  revision: "87607828",
  mimirProgram: "hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR",
  layout: { snapshotVersion: 0, prefixBytes: 512, configImageVersion: 0, configImageBytes: 325, planImageBytes: 320 },
  quotes: { classic: ["USDC", "SOL"], composite: ["USDC"] },
  recipes: [
    { mode: 0, kind: 0 }, { mode: 1, kind: 0 }, { mode: 6, kind: 0 },
    { mode: 2, kind: 0, adapters: [1, 2, 3] },
    { mode: 2, kind: 6, adapters: [2, 3] },
    { mode: 3, kind: 0, adapters: [0] }, { mode: 3, kind: 1, adapters: [2] },
    { mode: 3, kind: 2, adapters: [7] }, { mode: 3, kind: 3, adapters: [7] },
    { mode: 4, kind: 4 }, { mode: 5, kind: 5, adapters: [3, 4, 6] },
  ],
  converterRecipes: MIMIR_CLASSIC_ADMITTED_CONVERTER_RECIPES,
  feedOi: { permissionless: "canonical" },
  deviationBps: { min: 50, max: 500, market: 50 },
  singleProof: { minCoverageBps: 9000, maxDispersionBps: 50, deviationBps: 50 },
  history: { minSupportSec: 120, minSampledRecords: 13 },
  age: { liveSlots: 2, storedSlots: 8, componentSkewSlots: 2 },
  margins: { imBps: 500, mmBps: 250 },
  highRisk: { imBps: 200, mmBps: 100, maxConfBps: 100, maxStalenessSec: 2 },
  profiles: { stable: MARKET_STANDARD_STABLE, volatile: MARKET_STANDARD_VOLATILE },
  terms: { band: { seedUsdc: 500, tradeUsdc: 50 }, point: { seedUsdc: 2, tradeUsdc: 1 } },
  minPosition: { usableBps: 2000, maxUsdc: 50, feedOiLimitUsdc: 50_000 },
});
