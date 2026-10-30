// Blocker 4: the CREATE review returned for signing is the one whose exact simulation ran on its bytes.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import * as Creation from '../../src/beta/creation.js';
import { compileMimirBetaTransactionV1 } from '../../src/beta/transactionV1.js';
import { buildMimirBetaComputeUnitLimitInstruction } from '../../src/beta/liveAbi.js';
import { CREATE_COMPUTE_UNIT_LIMIT, tightComputeUnitLimit } from '../../src/create/helpers.js';
const simulated: Uint8Array[] = [], payer = '6Ba7yenKXHuauCn451XN8UotWgKtZyvxPMFwcPZza2Kz' as never;
mock.module(new URL('../../src/beta/creation.ts', import.meta.url).href, { namedExports: { ...Creation, prepareReview: async (a: { computeUnitLimit?: number }) => {
  const transaction = await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: 9n,
    instructions: [...(a.computeUnitLimit ? [buildMimirBetaComputeUnitLimitInstruction(a.computeUnitLimit)] : []), { programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as never, accounts: [], data: Uint8Array.of(1) }] });
  simulated.push(transaction.serializedTransaction);
  return { transaction, review: { messageHash: transaction.messageHash, simulation: { unitsConsumed: 100_000n } } };
} } });
const { prepareReview } = await import('../../src/create/review.js');
const next = await prepareReview({} as never);
assert.deepEqual(next.transaction.serializedTransaction, simulated.at(-1));
assert.equal(next.transaction.config.computeUnitLimit, tightComputeUnitLimit(100_000n, CREATE_COMPUTE_UNIT_LIMIT));
console.log('create review exact: ok');
