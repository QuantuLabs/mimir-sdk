import { address } from '@solana/kit';
import { mimirClassicIntervalRow, mimirClassicNativeAdmitted, type MimirClassicIntervalRecipe, type MimirClassicRowRecipe } from '../beta/live.js';
import { mimirAdmittedRecipe } from '../beta/compositeExecution.js';
import { withMimirBetaPoolBindingVariant, type MimirBetaEligiblePool } from '../beta/discovery.js';
import { mimirCurrentPointAdmitted } from '../internal/currentPointCore.js';


export type RowRecipe = MimirClassicRowRecipe | null;
export type RowChoice = Readonly<{ recipe: RowRecipe; routeable: boolean }>;

export const INTERVAL_RECIPES: readonly MimirClassicIntervalRecipe[] = ['cpmm-quiet-interval-v2', 'orca-marker-quiet', 'damm-onlyb-interval-v1', 'damm-reserve-interval-v3'];
export const RECIPE_LABELS: Readonly<Record<string, string>> = {
  default: 'Default', 'native-bounded': 'Native bounded', 'dual-native-point': 'Automatic — native, instant price when calm', 'current-point': 'Current pool price', 'cpmm-quiet-interval-v2': 'CPMM quiet interval',
  'orca-marker-quiet': 'Orca marker quiet', 'damm-onlyb-interval-v1': 'DAMM OnlyB interval', 'damm-reserve-interval-v3': 'DAMM reserve interval'
};

export function admittedRecipes(adapterType: number, adapterVersion?: number, kind: 'classic' | 'composite' = 'classic'): readonly RowRecipe[] {
  const recipes: RowRecipe[] = [null, ...(mimirClassicNativeAdmitted(adapterType) ? ['native-bounded' as const] : []),
    ...(adapterVersion === undefined ? [] : INTERVAL_RECIPES.filter((recipe) => {
      try {
        mimirClassicIntervalRow({ adapterType, adapterVersion, adapterAccounts: [], recipe, cluster: 'localnet', pool: address('11111111111111111111111111111111') });
        return true;
      } catch { return false; }
    })), ...(adapterType === 3 && adapterVersion !== undefined && mimirCurrentPointAdmitted(3, adapterVersion) ? ['current-point' as const] : [])];
  if (kind === 'classic') return recipes;
  return [...recipes, ...(adapterType === 2 || adapterType === 3 ? ['dual-native-point' as const] : [])].filter((recipe) => Array.from({ length: 10 }, (_, i) => i + 1).some((externalWidth) => {
    const temporalKind = recipe === 'dual-native-point' ? 6 : recipe === 'current-point' ? 5 : recipe === 'cpmm-quiet-interval-v2' ? 1 : recipe === 'damm-onlyb-interval-v1' ? 2 : recipe === 'damm-reserve-interval-v3' ? 3 : 0;
    const modes = recipe === 'native-bounded' || recipe === 'dual-native-point' ? [2] : recipe === 'current-point' ? [5] : recipe === null || recipe === 'spot' ? [0, 1, 5, 6] : [3];
    return modes.some((mode) => {
      try {
        mimirAdmittedRecipe({ adapterType, adapterVersion: adapterVersion!, mode, temporalKind, externalWidth, accountsBindingVersion: 1, converterRow: false, pointOk: true });
        return true;
      } catch { return false; }
    });
  }));
}

function routeableAdmitted(pool: MimirBetaEligiblePool): boolean {
  try {
    withMimirBetaPoolBindingVariant(pool, 'direct');
    withMimirBetaPoolBindingVariant(pool, 'routeable');
    return true;
  } catch { return false; }
}

export function admittedRowChoices(pool: MimirBetaEligiblePool, kind: 'classic' | 'composite' = 'classic'): readonly RowChoice[] {
  const bindings = routeableAdmitted(pool) ? [false, true] : [false];
  return admittedRecipes(pool.creation.adapterType, pool.creation.adapterVersion, kind)
    .flatMap((recipe) => (recipe === 'current-point' ? [false] : bindings).map((routeable) => Object.freeze({ recipe, routeable })));
}

export function autoRowChoice(pool: MimirBetaEligiblePool, solUsdc: boolean): RowChoice | null {
  return solUsdc ? admittedRowChoices(pool).find((choice) => choice.recipe === 'native-bounded' && !choice.routeable) ?? null : null;
}


/**
 * Market eligibility for a lending/perp consumer (score v2 `eligible`): two or more pools, or a sealing mode in {2 native-bounded, 3 quiet interval, 4 sampled,
 * 5 point}. A 1-pool Default row seals current-point (mode 5) on adapters that admit it besides DLMM (PumpSwap, Raydium AMM v4), else spot.
 */
export function marketEligible(recipe: RowRecipe, pool: Readonly<{ adapterType: number; adapterVersion: number }>, poolCount: number): boolean {
  if (poolCount >= 2) return true;
  if (recipe === null || recipe === 'spot') return pool.adapterType !== 3 && mimirCurrentPointAdmitted(pool.adapterType, pool.adapterVersion);
  return true;
}
