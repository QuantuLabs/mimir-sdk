import { brand as brandKey } from '../brand.js';

function brand<T extends abstract new (...args: never[]) => object>(name: string, type: T): T {
  return brandKey(`@quantulabs/mimir-sdk/create:${name}`, type);
}

/** Refused before any approval: the feed could never price. The message names the row, metric, value and limit. */
export class UnpriceableFeedError extends Error {}
brand('UnpriceableFeedError', UnpriceableFeedError);
/** Refused before any approval: this creator's composite with the same quote, exponent, components and quantities exists. */
export class CompositeExistsError extends Error {
  constructor(readonly feed: string, readonly ticker: string | null) {
    super(`This index already exists${ticker ? ` as ${ticker}` : ''}. Change a quantity or a component to create a new one.`);
  }
}
brand('CompositeExistsError', CompositeExistsError);
export function exactSol(lamports: bigint): string {
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${lamports / 1_000_000_000n}${fraction ? `.${fraction}` : ''}`;
}
export class InsufficientSolError extends Error {
  constructor(readonly requiredLamports: bigint, readonly balanceLamports: bigint) {
    super(`You need ${exactSol(requiredLamports)} SOL for this step and the next (the COLA purchase, then the feed creation and its first price; you have ${exactSol(balanceLamports)} SOL). Add ${exactSol(requiredLamports - balanceLamports)} SOL, then try again. Nothing was sent.`);
  }
}
brand('InsufficientSolError', InsufficientSolError);
export class ReviewIntentChangedError extends Error {
  refusal?: Readonly<Record<string, unknown>>;
}
brand('ReviewIntentChangedError', ReviewIntentChangedError);
export { brand as brandMimirCreateError };
