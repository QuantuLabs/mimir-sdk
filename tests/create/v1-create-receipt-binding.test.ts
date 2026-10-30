import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { getAddressDecoder } from '@solana/kit';
import { expect, it, vi } from './vitest.js';
import { authenticateMimirBetaReviewedStep, observeMimirBetaReceiptChain } from '../../src/beta/index.js';
import { observeV1Operation, v1CompositeDefinition } from '../../src/create/v1-create.js';

/** A finalized localnet V1 CREATE_CLASSIC receipt, archived from the app's own journey storage. */
const original = JSON.parse(gunzipSync(readFileSync('tests/create/fixtures/v1-create-receipt.json.gz')).toString('utf8'));
const [FOREIGN, OTHER] = [5, 6].map((b) => getAddressDecoder().decode(new Uint8Array(32).fill(b)));

const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted((value as Record<string, unknown>)[k])])) : value;

/** The same signed message, with only the public review fields replaced and the review hash recomputed. */
async function foreign(fields: Record<string, string>) {
  const receipt = structuredClone(original);
  Object.assign(receipt.reviewedStep.review, fields);
  const canonical = JSON.stringify(sorted({ ...JSON.parse(receipt.reviewedStep.canonicalReviewJson), ...fields }));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`MIMIR_BETA_REVIEW_V1\0${canonical}`));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  receipt.reviewedStep.canonicalReviewJson = canonical;
  receipt.reviewedStep.reviewHash = hash;
  receipt.reviewHash = hash;
  return receipt;
}


it('the archived V1 CREATE receipt re-authenticates', async () => {
  await expect(authenticateMimirBetaReviewedStep(original)).resolves.toMatchObject({ review: { stepId: 'classic:activate' } });
});

it.each([
  ['feed', { feed: FOREIGN }],
  ['feedId', { feedId: FOREIGN }],
  ['ticker', { ticker: 'TRMPX' }],
  ['feed, feedId and ticker', { feed: FOREIGN, feedId: OTHER, ticker: 'TRMPX' }],
])('a replayed V1 CREATE receipt under a foreign %s does not re-authenticate', async (_, fields) => {
  await expect(authenticateMimirBetaReviewedStep(await foreign(fields))).rejects.toThrow();
});

/** MAG5 (final9g-K public ledger): AAPLX attempt 1 never landed, its fresh review landed at 1521 with new runtime write hashes; root landed at 1525. */
const mag5 = JSON.parse(gunzipSync(readFileSync('tests/create/fixtures/v1-mag5-replacement.json.gz')).toString('utf8'));
const [prior, retry] = mag5.receipts;
function ledger(over: { status?: object | null; accountSlot?: number } = {}) {
  const floors: unknown[] = [], calls: string[] = [];
  const at = (slot: number) => ({ context: { slot } });
  return { floors, calls, rpc: {
    getTransaction: (s: string) => ({ send: async () => { calls.push('tx'); return s === retry.signature ? mag5.successor : null; } }),
    getMultipleAccounts: (xs: string[], c?: { minContextSlot?: bigint }) => ({ send: async () => { floors.push(c?.minContextSlot);
      return { ...at(over.accountSlot ?? 1525), value: xs.map((x) => mag5.accounts1525[x] ?? null) }; } }),
    getSignatureStatuses: () => ({ send: async () => ({ ...at(1525), value: [over.status ?? null] }) }),
    isBlockhashValid: () => ({ send: async () => ({ ...at(1525), value: false }) }),
    getFirstAvailableBlock: () => ({ send: async () => 0n }) } as never };
}

it('MAG5 replay: the SDK same-hash guard still refuses the AAPLX replacement as a retry chain', async () => {
  expect(prior.stepIntentHash).not.toBe(retry.stepIntentHash);
  const { rpc, calls } = ledger();
  await expect(observeMimirBetaReceiptChain({ rpc, receipts: mag5.receipts })).rejects.toThrow('RECONCILIATION_CONFLICT:receipt chain retry differs from predecessor');
  expect(calls).toEqual([]);
});

it('MAG5 replay: the V1 operation policy keeps the proven-expired attempt 1 and finalizes the replacement at its transaction slot', async () => {
  const { rpc, floors } = ledger();
  const [first, second] = await observeV1Operation(rpc, mag5.receipts) as unknown as { state: string; signature: string; observedSlot: bigint }[];
  expect([first!.state, first!.signature]).toEqual(['expired', prior.signature]);
  expect([second!.state, second!.signature, second!.observedSlot]).toEqual(['finalized', retry.signature, 1521n]);
  expect(floors.at(-1)).toBe(1521n);
});

const relinked = (fields: object) => [prior, { ...retry, ...fields }];
it.each([
  ['predecessor linkage', () => relinked({ retryOfSignature: original.signature })],
  ['attempt number', () => relinked({ attempt: 3 })],
  ['signed message', () => relinked({ messageBase64: prior.messageBase64 })]
])('MAG5 replay: a replacement with a changed %s is refused before any chain read', async (_, receipts) => {
  const { rpc, calls } = ledger();
  await expect(observeV1Operation(rpc, receipts())).rejects.toThrow();
  expect(calls).toEqual([]);
});

it('MAG5 replay: an unproven (still confirmed) attempt 1 keeps the verification fence', async () => {
  const { rpc, calls } = ledger({ status: { slot: 1243, confirmations: 1, err: null, confirmationStatus: 'confirmed' } });
  await expect(observeV1Operation(rpc, mag5.receipts)).rejects.toThrow('verification stays fenced');
  expect(calls).toEqual(['tx']);
});

it('MAG5 replay: relabelling the landed attempt as attempt 1 is refused by the expiry fence', async () => {
  const relabelled = [{ ...retry, attempt: 1, retryOfSignature: null }, { ...prior, attempt: 2, retryOfSignature: retry.signature }];
  await expect(observeV1Operation(ledger().rpc, relabelled)).rejects.toThrow('verification stays fenced');
});

it('MAG5 replay: a regressed account context refuses the replacement', async () => {
  await expect(observeV1Operation(ledger({ accountSlot: 1500 }).rpc, mag5.receipts)).rejects.toThrow();
});

it('MAG5 root: the landed composite decodes to the signed five quantities and exponent', async () => {
  const account = mag5.accounts1525[mag5.root.feed], data = Buffer.from(account.data[0], 'base64');
  const signed = { feedId: mag5.root.feedId, creator: mag5.root.creator, priceExponent: mag5.root.priceExponent,
    components: mag5.root.components.map(({ feedId, quantityX64 }: { feedId: string; quantityX64: string }) => ({ feedId, quantityX64 })) };
  expect(signed.priceExponent).toBe(-8);
  expect(signed.components).toHaveLength(5);
  expect(v1CompositeDefinition(mag5.root.feed, signed)(data)).toBe(true);
  for (const i of [0, 1, 2, 3, 4]) {
    const components = signed.components.map((c: object, j: number) => j === i ? { ...c, quantityX64: (BigInt(signed.components[i].quantityX64) + 1n).toString() } : c);
    expect(v1CompositeDefinition(mag5.root.feed, { ...signed, components })(data)).toBe(false);
  }
  expect(v1CompositeDefinition(mag5.root.feed, { ...signed, priceExponent: -7 })(data)).toBe(false);
});
