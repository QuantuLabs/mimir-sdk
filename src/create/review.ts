import { prepareReview as prepareSdkReview } from '../beta/creation.js';
import { mimirV1RefreshComputeUnitLimit } from '../v1/cost.js';
import { CREATE_COMPUTE_UNIT_LIMIT, tightComputeUnitLimit } from './helpers.js';

/**
 * The SDK review re-run on a message that reserves 1.2× the measured compute instead of the TxV1 maximum: the exact simulation,
 * writes and review hash belong to the bytes that are signed. `refreshRows`: the merged first price's row count, added to the fallback reserve.
 */
export const prepareReview = async (args: Parameters<typeof prepareSdkReview>[0] & { readonly refreshRows?: number }) => {
  const { refreshRows, ...reviewArgs } = args;
  const measured = await prepareSdkReview(reviewArgs);
  const fallback = reviewArgs.firstPrice?.instructions.length ? Math.min(1_400_000, CREATE_COMPUTE_UNIT_LIMIT + mimirV1RefreshComputeUnitLimit(refreshRows ?? 1)) : CREATE_COMPUTE_UNIT_LIMIT;
  return prepareSdkReview({ ...reviewArgs, computeUnitLimit: tightComputeUnitLimit(measured.review.simulation.unitsConsumed, fallback) });
};
