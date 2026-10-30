import { getAddressDecoder, getAddressEncoder, type Address } from '@solana/kit';
import { quoteTxV1Fee } from './txv1-fee.js';
import { decodeV1ClassicFeed, decodeV1CompositeFeed, decodeV1Descriptor } from '../v1/decoders.js';
import { deriveMimirV1ClassicFeedId, deriveMimirV1CompositeFeedId, findMimirV1AdminConfigPda, findMimirV1AssociatedTokenAddress, findMimirV1ClassicFeedPda, findMimirV1CompositePda, findMimirV1FreeClassicVariant, findMimirV1GenerationCounterPda, findMimirV1OneCharAllowancePda, findMimirV1RegistryPda, findMimirV1SourceConfigAddress, findMimirV1TickerClaimPda, findMimirV1TreasuryPda, computeMimirV1CompositeActivationFeeLamports, computeMimirV1TickerTariff, buildMimirV1FusedClassicRefreshInstruction, buildMimirV1FusedCompositeRefreshInstruction } from '../v1/build.js';
import { findMimirV1SolFeedPda, planMimirV1CompositeCreationFromFeeds, mimirV1CompositeParamRows, mimirV1CompositeShape } from '../v1/composite.js';
import { prepareMimirV1ClassicCreation } from '../v1/definition.js';
import * as V1Layout from '../v1/layout/index.js';
import { mimirV1RefreshComputeUnitLimit } from '../v1/cost.js';
import { authenticateMimirBetaReviewedStep, createDraftHash, type MimirBetaProvenObservation, type MimirBetaPreparedCreation, type MimirBetaStageReceipt } from '../beta/review.js';
import { canonicalizeMimirBetaCompositeComponents } from '../beta/abi.js';
import { compileMimirBetaTransactionV1 } from '../beta/transactionV1.js';
import { decodeMimirBetaAdminContext, decodeMimirBetaSplTokenAccount } from '../beta/context.js';
import { FinalizedRpcReader, type MimirBetaReconciliationRpc } from '../beta/rpc.js';
import { MimirBetaCollateralRequiredError, MimirBetaError, MimirBetaSimulationError, mimirBetaSimulationFailure, MimirBetaExpiryFinalizingError } from '../beta/errors.js';
import { mimirAutoCompositePolicy, mimirMeasureSlotMs } from '../beta/params.js';
import { isMimirClassicIntervalRecipe } from '../beta/live.js';
import { buildMimirBetaComputeUnitLimitInstruction as mimirComputeUnitLimitInstruction } from '../beta/liveAbi.js';
import { observeMimirBetaReceipt, observeMimirBetaReceiptChain } from '../beta/reconciliation.js';
import { type MimirBetaCompositeJourneyNextV1, type MimirBetaCompositeJourneyOperationId, type MimirBetaPreparedCompositeJourney, type PrepareCompositeFeedArgs, type PrepareCompositeFeedJourneyArgs, type PrepareSimpleFeedArgs } from '../beta/creation.js';
import { MIMIR_ONE_CHAR_ALLOWANCE_LEN } from '../beta/oneChar.js';
import { type MimirBetaInstruction } from '../beta/types.js';
import { prepareReview } from './review.js';
import { CompositeExistsError, ReviewIntentChangedError, UnpriceableFeedError } from './errors.js';
import { SolCreationContext, type MimirBetaFundingCosts } from './creation-context.js';
import { decodeMimirBrowserSourceRingV1 as decodeSourceObservationRingV1Header } from '../internal/nativeMonoRefreshCore.js';
import { CREATE_COMPUTE_UNIT_LIMIT, classicLiveGap, liveGapRefusal, mediaMemoInstruction, medianX64, readPoolPrices, RENT_SYSVAR, rentExemptLamports,
  resolveV1Owner, toleranceLine, toleranceOf, venueLabel } from './helpers.js';
import { decodeMimirBetaTicker } from '../beta/abi.js';
import { MIMIR_PARAM_BOUNDS } from '../beta/params.js';
import type { mimirV1RowVectors } from '../v1/refresh.js';

type Review = Parameters<typeof prepareReview>[0];
type RowVectors = (rows: Parameters<typeof mimirV1RowVectors>[1], memberships: Parameters<typeof mimirV1RowVectors>[2],
  opts: NonNullable<Parameters<typeof mimirV1RowVectors>[3]>) => ReturnType<typeof mimirV1RowVectors>;
/** `rowVectors`: the refresh account vectors of rows (the caller's web3.js `mimirV1RowVectors`); `rpcUrl` keys the per-session caches. */
export type V1CreationDependencies = Review['dependencies'] & Readonly<{ rpcUrl?: string; rowVectors?: RowVectors; onSlotMs?: (ms: number) => void;
  isTransportError?: (error: unknown) => boolean }>;
const decodeV1Ticker = (bytes: Uint8Array) => { try { return bytes.some(Boolean) ? decodeMimirBetaTicker(bytes) : null; } catch { return null; } };
type Spec = Review['specs'][number];
/** Owned by one user preparation call, discarded on return; never persisted or shared between journeys. */
export type V1ClassicRefreshReads = Map<string, Awaited<ReturnType<typeof mimirV1RowVectors>>>;
type SlotRpc = { getSlot(c: object): { send(): Promise<bigint | number> } };

const NO_IDENTITY = '11111111111111111111111111111111' as Address;
const SOL_MINT = 'So11111111111111111111111111111111111111112' as Address;
const TICKER_CLAIM_LEN = V1Layout.TICKER_CLAIM_ACCOUNT_LEN, COUNTER_LEN = V1Layout.GENERATION_COUNTER_LEN, TOKEN_ACCOUNT_LEN = 165, MINT_LEN = 82;

const programOf = (deps: V1CreationDependencies) => deps.deployment.mimirProgramId;

/** The admin frame the shown creation cost was priced with; CREATE_COMPOSITE signs its revision and tariff. */
export type V1PricedAdmin = Readonly<{ configRevision: bigint; collateralAmountRaw: bigint; tickerTierTenths: readonly [number, number, number, number] }>;
/** One observation fence per unpaid journey, including reads made inside the SDK. No new reads. */
async function fundingFrame(deps: V1CreationDependencies, enabled: boolean, context = new SolCreationContext()) {
  if (!enabled) return undefined;
  const [admin] = await findMimirV1AdminConfigPda(programOf(deps));
  let adminTerms: Awaited<ReturnType<typeof decodeMimirBetaAdminContext>> | undefined;
  const rpc = context.rpc(deps.rpc, async (key, args, response) => {
    const index = key === 'getMultipleAccounts' ? (args[0] as Address[]).indexOf(admin) : key === 'getAccountInfo' && args[0] === admin ? 0 : -1;
    if (index < 0) return;
    const account = key === 'getMultipleAccounts' ? response.value[index] : response.value;
    const encoded = account?.data?.[0];
    context.select('admin-bytes', encoded);
    if (typeof encoded === 'string') {
      adminTerms = await decodeMimirBetaAdminContext(admin, Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
      context.admin(adminTerms);
    }
  });
  return { dependencies: { ...deps, rpc }, context, get slot() { return context.slot; }, get admin() { return adminTerms!; },
    get creditValidThroughSlot() { return context.creditValidThroughSlot; }, assert: () => context.assertTerms(),
    retain: (check: (slot: bigint) => boolean, endpoint?: bigint, diagnostic?: () => Record<string, unknown>) => context.retain(check, endpoint, diagnostic),
    assertFinalTerms: () => context.assertTerms() };
}
const contextOf = (args: object) => (args as { fundingContext?: SolCreationContext }).fundingContext;
type FundingFrame = Awaited<ReturnType<typeof fundingFrame>>;

const tokenOf = (deps: V1CreationDependencies) => (deps.deployment as { tokenProgramId?: Address }).tokenProgramId
  ?? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;

/** The one CREATE_* step: target + ticker claim + generation counter created/written, COLA burnt from the payer ATA by the last core ix, or the one-char allowance spent. */
function createSpecs(deps: V1CreationDependencies, a: Readonly<{ target: Address; targetLen: number | null; tickerClaim: Address; counter: Address;
  colaMint: Address; ata: Address; authority: Address; amountRaw: bigint; decimals: number; burnIndex: number; oneChar?: Address }>): Spec[] {
  const program = programOf(deps), token = tokenOf(deps);
  const head: Spec[] = [
    { kind: 'account', address: a.target, transition: 'create', ownerAfter: program, dataLengthAfter: a.targetLen, description: 'create the V1 feed account' },
    { kind: 'account', address: a.tickerClaim, transition: 'create', ownerAfter: program, dataLengthAfter: TICKER_CLAIM_LEN, description: 'claim the ticker' },
    { kind: 'account', address: a.counter, transition: 'write', ownerAfter: program, dataLengthAfter: COUNTER_LEN, description: 'advance the generation counter' }];
  if (a.oneChar) return [...head, { kind: 'account', address: a.oneChar, transition: 'write', ownerAfter: program, dataLengthAfter: MIMIR_ONE_CHAR_ALLOWANCE_LEN,
    description: 'consume one-character ticker allowance', codec: 'one-char-allowance-v1' }];
  return [...head,
    { kind: 'account', address: a.ata, transition: 'write', ownerAfter: token, dataLengthAfter: TOKEN_ACCOUNT_LEN, description: 'debit the exact collateral amount from the creator token account' },
    { kind: 'account', address: a.colaMint, transition: 'write', ownerAfter: token, dataLengthAfter: MINT_LEN, description: 'decrease the exact collateral mint supply' },
    { kind: 'spl-token-burn-checked', address: a.ata, tokenProgram: token, mint: a.colaMint, authority: a.authority, amountRaw: a.amountRaw,
      decimals: a.decimals, outerInstructionIndex: a.burnIndex, description: 'burn configured creation collateral with SPL Token BurnChecked' }
  ];
}

async function reviewed(deps: V1CreationDependencies, a: Readonly<{ kind: 'classic' | 'composite'; authority: Address; feedId: Address; feed: Address;
  ticker: string; displayName: string | null; variant?: number; coherence?: FundingFrame; contextSlot?: bigint; core: readonly MimirBetaInstruction[]; specs: Spec[]; draft: object;
  selectedPools: MimirBetaPreparedCreation['selectedPools']; landed?: string; landedSlot?: bigint;
  funding?: Pick<PrepareSimpleFeedArgs, 'authority' | 'creatorCollateralTokenAccount' | 'allowCollateralFunding' | 'estimateFundingCosts' | 'fullCollateralPurchase'>; protocolFeeLamports?: bigint; definition?: (data: Uint8Array) => boolean; memo?: string; gate?: () => Promise<FirstPrice | void>; tolerance?: string }>): Promise<MimirBetaPreparedCreation> {
  const { canonicalDraftJson, draftHash } = await createDraftHash(a.draft);
  const stepId = a.kind === 'classic' ? 'classic:activate' as const : 'composite:activate' as const;
  const step = { stepId, stage: 'mimir-create' as const, ordinal: 0, prerequisiteStepIds: [], requiredSigners: [a.authority], expectedWrites: [] };
  const target = { kind: a.kind, feedId: a.feedId, feed: a.feed, identityAsset: NO_IDENTITY, ticker: a.ticker, displayName: a.displayName, displayNameInstruction: null };
  const plan = { schema: 'mimir-beta-unsigned-plan' as const, version: 1 as const, kind: a.kind, draftHash, cluster: deps.deployment.cluster,
    programId: programOf(deps), authority: a.authority, feedId: a.feedId, feed: a.feed, identityAsset: NO_IDENTITY, ticker: a.ticker,
    displayName: a.displayName, steps: [step], ...(a.variant === undefined ? {} : { variant: a.variant }) };
  const observed = BigInt(await (deps.rpc as unknown as SlotRpc).getSlot({ commitment: 'confirmed' }).send());
  const contextSlot = a.contextSlot !== undefined && a.contextSlot > observed ? a.contextSlot : observed;
  const base = { schema: 'mimir-beta-prepared-creation' as const, version: 1 as const, canonicalDraftJson, draftHash, selectedPools: a.selectedPools,
    feedId: a.feedId, ...(a.variant === undefined ? {} : { resolvedVariant: a.variant }) };
  const landed = a.landed ? (await new FinalizedRpcReader(deps.rpc as never, 'confirmed').accounts([a.feed], a.landedSlot)).value[0] : undefined;
  if (a.landed && landed?.owner === programOf(deps)) {
    if (a.definition && !a.definition(landed.data)) throw new Error(DEFINITION_CHANGED);
    return { ...base, plan, next: null, reconciliation: { steps: [{ stepId, state: 'finalized', finalizedSignature: a.landed, observedSlot: contextSlot }],
      action: 'complete', nextStepId: null, observedSlot: contextSlot } };
  }
  if (a.landedSlot !== undefined) throw new Error(DEFINITION_CHANGED);
  if (a.funding) await requireFunding(deps, a.funding, { draftHash, feedId: a.feedId, resolvedVariant: a.variant,
    selectedPools: a.selectedPools ?? undefined }, [{ core: a.core, specs: a.specs, protocolFeeLamports: a.protocolFeeLamports ?? 0n }], contextSlot, a.coherence, a.tolerance);
  const first = await a.gate?.();
  const review = (memo?: string, merged?: FirstPrice) => prepareReview({ dependencies: deps, contextSlot, strictSimulation: true, draftHash, plan, step, instructions: a.core,
    specs: a.specs, target, ...(memo ? { callerPrefix: { instructions: [mediaMemoInstruction(memo)], maxAuthorityDebitLamports: 0n } } : {}),
    ...(merged ? { firstPrice: { instructions: [merged.instruction] }, refreshRows: merged.rows } : {}) });
  const today = () => review(a.memo).catch((error: unknown) => {
    if (!a.memo || !(error instanceof MimirBetaError && ['TRANSACTION_TOO_LARGE', 'CREATION_TOO_LARGE', 'CALLER_PREFIX_REFUSED'].includes(error.code))) throw error;
    return review();
  });
  // CREATE + first price in one transaction, all or nothing: too large or out of compute is today's 2-transaction path, memo rule included.
  const next = first ? await review(a.memo, first).catch((error: unknown) => {
    if (error instanceof MimirBetaError && ['TRANSACTION_TOO_LARGE', 'CREATION_TOO_LARGE', 'CALLER_PREFIX_REFUSED'].includes(error.code)) return today();
    if (error instanceof MimirBetaSimulationError && error.logs.some((log) => /exceeded CUs meter|Computational budget exceeded/.test(log))) return today();
    if (error instanceof MimirBetaSimulationError && error.instructionIndex === (a.memo ? 1 : 0) + a.core.length) {
      throw new UnpriceableFeedError(`${a.ticker}: its first price fails (${error.rejection ?? error.customCode ?? error.errorKind}). Choose other pools. Nothing was sent.`);
    }
    throw error;
  }) : await today();
  a.coherence?.context.observe(next.review.simulation.contextSlot);
  return { ...base, plan: { ...plan, steps: [next.step] }, next,
    reconciliation: { steps: [{ stepId, state: 'reviewable', finalizedSignature: null, observedSlot: null }], action: 'review-next-step',
      nextStepId: stepId, observedSlot: next.review.simulation.contextSlot }, ...(a.tolerance ? { tolerance: a.tolerance } : {}) };
}

/** The created feed's first tag 89 / 87, built from the definition, and the row count its compute reserve covers. */
type FirstPrice = Readonly<{ instruction: MimirBetaInstruction; rows: number }>;

type FundingStep = Readonly<{ core: readonly MimirBetaInstruction[]; specs: readonly Spec[]; protocolFeeLamports: bigint }>;

/** Price the remaining V1 packets without simulating an unfunded burn. The purchase owns missing-ATA rent. */
async function fundingCosts(deps: V1CreationDependencies, authority: Address, steps: readonly FundingStep[], minSlot: bigint, coherence?: FundingFrame): Promise<MimirBetaFundingCosts> {
  const reader = new FinalizedRpcReader(deps.rpc as never, 'confirmed');
  const sizes = new Map<Address, number>();
  for (const { specs } of steps) for (const spec of specs) if (spec.kind === 'account' && typeof spec.dataLengthAfter === 'number'
    && spec.ownerAfter === programOf(deps)) sizes.set(spec.address, Math.max(sizes.get(spec.address) ?? 0, spec.dataLengthAfter));
  const addresses = [...sizes.keys()];
  const read = await reader.accounts([RENT_SYSVAR, ...addresses], minSlot);
  const rent = read.value[0]?.data;
  if (!rent) throw new Error('Rent sysvar is unavailable');
  let accountRentLamports = 0n;
  addresses.forEach((address, i) => {
    const due = rentExemptLamports(rent, sizes.get(address)!) - (read.value[i + 1]?.lamports ?? 0n);
    if (due > 0n) accountRentLamports += due;
  });
  coherence?.context.select('rent-sysvar', [...rent]);
  const credited = new Map(addresses.map(address => [address, coherence?.context.rentCredit(address) ?? 0n]));
  let currentReserve: bigint | undefined;
  coherence?.retain(() => {
    currentReserve = undefined;
    const currentRent = coherence.context.account(RENT_SYSVAR)?.data;
    if (!currentRent) return false;
    currentReserve = addresses.reduce((sum, address) => {
      const due = rentExemptLamports(currentRent, sizes.get(address)!) - (coherence.context.account(address)?.lamports ?? 0n);
      return sum + (due > 0n ? due : 0n) + coherence.context.rentCredit(address) - credited.get(address)!;
    }, 0n);
    return currentReserve === accountRentLamports;
  }, undefined, () => ({ check: 'account-rent', expectedRent: accountRentLamports, currentRent: currentReserve,
    settledCredits: addresses.map(address => ({ address, selectedCredit: credited.get(address), currentCredit: coherence!.context.rentCredit(address) })) }));
  const rpc = deps.rpc;
  const block = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send() as { value: { blockhash: string; lastValidBlockHeight: bigint } };
  let networkFeeLamports = 0n, observedSlot = read.slot;
  for (const step of steps) {
    const tx = await compileMimirBetaTransactionV1({ feePayer: authority, recentBlockhash: block.value.blockhash,
      lastValidBlockHeight: BigInt(block.value.lastValidBlockHeight), instructions: [mimirComputeUnitLimitInstruction(CREATE_COMPUTE_UNIT_LIMIT), ...step.core] });
    if (!rpc.getFeeForMessage) throw new Error('Creation fee estimation is unavailable');
    const fee = await quoteTxV1Fee(rpc as never, tx, { commitment: 'confirmed' });
    if (fee.value === null || BigInt(fee.value) < 0n || BigInt(fee.context.slot) < read.slot) throw new Error('Creation fee estimate is unavailable or stale');
    networkFeeLamports += BigInt(fee.value);
    observedSlot = BigInt(fee.context.slot) > observedSlot ? BigInt(fee.context.slot) : observedSlot;
  }
  const protocolFeeLamports = steps.reduce((sum, step) => sum + step.protocolFeeLamports, 0n);
  return { observedSlot, identityLamports: 0n, accountRentLamports, networkFeeLamports, protocolFeeLamports,
    totalLamports: accountRentLamports + networkFeeLamports + protocolFeeLamports };
}

async function requireFunding(deps: V1CreationDependencies, args: Pick<PrepareSimpleFeedArgs, 'authority' | 'creatorCollateralTokenAccount' |
  'allowCollateralFunding' | 'estimateFundingCosts' | 'fullCollateralPurchase'>,
  facts: Pick<ConstructorParameters<typeof MimirBetaCollateralRequiredError>[0], 'draftHash' | 'feedId' | 'resolvedVariant' | 'selectedPools' | 'compositeJourney'>,
  steps: readonly FundingStep[], minSlot: bigint, coherence: FundingFrame, tolerance?: string): Promise<MimirBetaFundingCosts | null> {
  if (!args.allowCollateralFunding) return null;
  coherence?.assert();
  const burns = steps.flatMap((s) => s.specs.filter((s) => s.kind === 'spl-token-burn-checked'));
  const burn = burns[0]!;
  if (burns.some((b) => b.address !== burn.address || b.mint !== burn.mint || b.authority !== args.authority
    || b.tokenProgram !== tokenOf(deps) || b.decimals !== burn.decimals)) {
    throw new ReviewIntentChangedError('Collateral binding changed; prepare a new review before purchasing collateral');
  }
  const requiredAmountRaw = burns.reduce((sum, burn) => sum + burn.amountRaw, 0n);
  if (!requiredAmountRaw) {
    const costs = args.estimateFundingCosts && facts.compositeJourney ? await fundingCosts(deps, args.authority, steps, minSlot, coherence) : null;
    coherence?.assertFinalTerms();
    return costs;
  }
  if (args.creatorCollateralTokenAccount && args.creatorCollateralTokenAccount !== burn.address) throw new Error('V1 collateral account differs from the creator ATA');
  const read = await new FinalizedRpcReader(deps.rpc as never, 'confirmed').accounts([burn.address], minSlot);
  const account = read.value[0];
  const token = account ? decodeMimirBetaSplTokenAccount(account, tokenOf(deps)) : null;
  if (token && (token.mint !== burn.mint || token.owner !== args.authority)) throw new Error('V1 collateral account mint or authority differs');
  const balanceRaw = token?.amount ?? 0n;
  const needsPurchase = args.fullCollateralPurchase || balanceRaw < requiredAmountRaw;
  let costs = args.estimateFundingCosts && (needsPurchase || facts.compositeJourney) ? await fundingCosts(deps, args.authority, steps, read.slot, coherence) : null;
  // FINAL-BOUNDARY: recompute retained tariffs, burns and slot-dependent fees at the last observed bank.
  coherence?.assertFinalTerms();
  if (costs && coherence) {
    costs = { ...costs, observedSlot: coherence.slot, ...(coherence.creditValidThroughSlot === undefined ? {} : { creditValidThroughSlot: coherence.creditValidThroughSlot }) };
  }
  if (coherence) {
    coherence.context.select('burn:' + facts.draftHash, [burn.address, burn.mint, burn.authority, burn.tokenProgram, burn.decimals, requiredAmountRaw + (facts.compositeJourney ? coherence.context.paidBurn() : 0n)]);
    if (costs) coherence.context.costs(costs);
  }
  if (needsPurchase) {
    const error = new MimirBetaCollateralRequiredError({
    ...facts, authority: args.authority, mint: burn.mint, tokenAccount: burn.address, decimals: burn.decimals, requiredAmountRaw, balanceRaw,
    shortfallRaw: args.fullCollateralPurchase ? requiredAmountRaw : requiredAmountRaw - balanceRaw, accountMissing: !account,
    observedSlot: read.slot, ...(costs ? { fundingCosts: costs } : {}) });
    if (tolerance) (args as { onTolerance?: (line: string) => void }).onTolerance?.(tolerance);
    throw error;
  }
  return costs;
}

export const v1GenerationCounter = async (programId: Address) => (await findMimirV1GenerationCounterPda(programId))[0];
type ReadAccount = Readonly<{ owner: Address; lamports: bigint; data: Uint8Array }> | null | undefined;
/** Accounts a SOL creation estimate reads with the payer: WSOL ATA, generation counter, `feeds`, then the admin config unless it is already read. */
export const v1CreationAccounts = async (programId: Address, wsolAta: Address, feeds: readonly Address[], admin = true) =>
  [wsolAta, await v1GenerationCounter(programId), ...feeds, ...admin ? [(await findMimirV1AdminConfigPda(programId))[0]] : []];

/** Decodes `v1CreationAccounts` as preparation does: SOL feed converter rows, each existing component's shape, live owner and F2 credit at `slot`. */
export async function v1CreationFacts(read: (addresses: Address[]) => Promise<readonly ReadAccount[]>, args: Readonly<{ programId: Address;
  mplCore: Address; authority: Address; feeds: readonly Address[]; accounts: readonly ReadAccount[]; slot: bigint; admin?: Readonly<{ compositeRefreshFeeLamports: bigint }> }>) {
  const [wsol, counter, ...feedAccounts] = args.accounts;
  const adminAccount = args.admin ? undefined : feedAccounts[args.feeds.length];
  if (!args.admin && (!adminAccount || adminAccount.owner !== args.programId)) throw new Error('Mimir admin evidence is invalid');
  const admin = args.admin ?? await decodeMimirBetaAdminContext((await findMimirV1AdminConfigPda(args.programId))[0], adminAccount!.data);
  const feeds = args.feeds.flatMap((address, i) => feedAccounts[i]?.owner === args.programId ? [{ address, feed: decodeV1ClassicFeed(feedAccounts[i]!.data, address) }] : []);
  const assets = [...new Set(feeds.flatMap(({ feed }) => feed.owner.identityAsset ? [feed.owner.identityAsset] : []))];
  const assetAccounts = assets.length ? await read(assets) : [];
  const shape = (row: ReturnType<typeof decodeV1ClassicFeed>['rows'][number], i: number, feed: ReturnType<typeof decodeV1ClassicFeed>) =>
    ({ derived: feed.memberships[i]!.derived, width: feed.memberships[i]!.bindingWidth, moduleLen: row.descriptor.moduleLen });
  return { wsolMissing: !wsol, counterLamports: counter?.lamports ?? 0n, refreshFeeLamports: admin.compositeRefreshFeeLamports,
    feeds: Object.fromEntries(feeds.map(({ address, feed }) => {
      const asset = feed.owner.identityAsset ? assetAccounts[assets.indexOf(feed.owner.identityAsset)] ?? null : null;
      const live = resolveV1Owner({ creator: feed.owner.creator!, identityAsset: feed.owner.identityAsset } as Parameters<typeof resolveV1Owner>[0], asset, args.mplCore);
      const credit = feed.header.f2Credit === V1Layout.F2_CREDIT_AVAILABLE && feed.owner.creator === args.authority
        && args.slot >= feed.owner.createdSlot && args.slot - feed.owner.createdSlot <= BigInt(V1Layout.F2_WINDOW_SLOTS);
      return [address, { rows: feed.rows.map((row, i) => shape(row, i, feed)), component: feed.rows[0]?.descriptor,
        ownerPaid: live.state !== 'ownerless' && live.owner !== args.authority, redirected: live.state === 'ownerless', credit,
        owner: live.state === 'ownerless' ? null : live.owner }];
    })) };
}
const pricedOf = (args: object) => (args as { pricedAdmin?: V1PricedAdmin }).pricedAdmin;
const landedOf = (args: object) => (args as { receipts?: readonly { signature: string }[] }).receipts?.at(-1)?.signature;
const landedSlotOf = (args: object) => {
  const a = args as { landedSlot?: bigint; observations?: readonly MimirBetaProvenObservation[] };
  const observed = a.observations?.slice().reverse().find(o => o.signature === landedOf(args) && o.state === 'finalized');
  return a.landedSlot ?? (observed?.state === 'finalized' ? observed.observedSlot : undefined);
};
const DEFINITION_CHANGED = 'The landed V1 feed does not carry the signed definition';
const addressOf = (bytes: Uint8Array) => getAddressDecoder().decode(bytes);

/** The signed CREATE_COMPOSITE definition, decoded from the landed account: id, creator, exponent and every canonical component quantity. */
export const v1CompositeDefinition = (feed: Address, signed: Readonly<{ feedId: Address; creator: Address; priceExponent: number;
  components: readonly Readonly<{ feedId: Address; quantityX64: string }>[] }>) => (data: Uint8Array) => {
  const { config } = decodeV1CompositeFeed(data, feed);
  return addressOf(config.feedId) === signed.feedId && config.creator === signed.creator && config.priceExponent === signed.priceExponent &&
    config.components.length === signed.components.length && config.components.every((c, i) =>
      addressOf(c.feedId) === signed.components[i]!.feedId && c.quantityX64.toString() === signed.components[i]!.quantityX64);
};

const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
const ringOf = (ring: Uint8Array) => { try { return decodeSourceObservationRingV1Header(ring); } catch { return null; } };

let slotMeasure: Readonly<{ key: string; at: number; ms: Promise<number> }> | undefined;
let lastSlotMs: Readonly<{ key: string; ms: number }> | undefined;
/** Nodes write one performance sample a minute and a pruned ledger can hold none: reuse the last measurement, else poll until the next sample. */
async function measureSlotMs(deps: V1CreationDependencies, key: string): Promise<number> {
  for (const deadline = Date.now() + 65_000; ;) {
    try {
      const ms = await mimirMeasureSlotMs(deps.rpc as never);
      lastSlotMs = { key, ms };
      deps.onSlotMs?.(ms);
      return ms;
    } catch (error) {
      if (!(error instanceof MimirBetaError && error.code === 'CREATION_CONTEXT_REQUIRED')) throw error;
      if (lastSlotMs?.key === key) return lastSlotMs.ms;
      if (Date.now() + 3_000 > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}
/** One slot-time measurement per session and cluster, reused by every creation step for 10 minutes. */
function sessionSlotMs(deps: V1CreationDependencies) {
  const key = `${deps.deployment.cluster}|${deps.rpcUrl ?? ''}`;
  if (slotMeasure?.key !== key || Date.now() - slotMeasure.at > 600_000) {
    const ms = measureSlotMs(deps, key);
    slotMeasure = { key, at: Date.now(), ms };
    ms.catch(() => { if (slotMeasure?.ms === ms) slotMeasure = undefined; });
  }
  return slotMeasure.ms;
}

/** CREATE_CLASSIC draft: the s3 preparer with the SDK auto policy (measured slot, observed price, live gap), core instructions and transition specs. */
export { toleranceOf, toleranceLine, classicLiveGap, liveGapRefusal };

export async function draftV1Classic(deps: V1CreationDependencies, args: PrepareSimpleFeedArgs, coherence?: FundingFrame) {
  coherence ??= await fundingFrame(deps, !!args.allowCollateralFunding || !!contextOf(args), contextOf(args));
  deps = coherence?.dependencies ?? deps;
  const maxDispersion = MIMIR_PARAM_BOUNDS.classic.maxDispersionBps[1];
  const solFeed = args.quoteMint === SOL_MINT ? args.solConversionSourceConfig : undefined;
  // Prices come from the preparer's own coherent pool read: no extra RPC call.
  let priced = false;
  const observe = async (accounts: ReadonlyMap<Address, { data: Uint8Array } | null>) => {
    const prices = await readPoolPrices(args.pools, async (xs) => xs.map((x) => accounts.get(x) ?? null));
    const gap = args.pools.length > 1 ? classicLiveGap(args.pools, prices) : undefined;
    if (gap && gap.narrowest.dispersionBps > maxDispersion) throw new UnpriceableFeedError(liveGapRefusal(args.ticker, gap.narrowest, maxDispersion));
    const observed = medianX64([...prices.values()]);
    priced = !!observed;
    return { ...(observed ? { observedPrice: Number(observed) / 2 ** 64 } : {}), ...(gap ? { observedDispersionBps: [gap.dispersionBps] } : {}) };
  };
  const v1 = await prepareMimirV1ClassicCreation(deps.rpc as never, { programId: programOf(deps), payer: args.authority, ticker: args.ticker,
    baseMint: args.baseMint, quoteMint: args.quoteMint, pools: args.pools, policy: args.policy, variant: args.variant ?? 'new',
    auto: { slotMs: await sessionSlotMs(deps), observe },
    ...(args.recipes ? { recipes: args.recipes } : {}), ...(args.temporalMode ? { temporalMode: args.temporalMode } : {}),
    cluster: deps.deployment.cluster === 'mainnet-beta' ? 'mainnet' : deps.deployment.cluster, ...(solFeed ? { solFeed } : {}) });
  const gate = await assertV1ClassicRefreshFits(deps, args, v1, solFeed, coherence, (args as PrepareSimpleFeedArgs & { refreshFitReads?: V1ClassicRefreshReads }).refreshFitReads).catch((error: unknown) => {
    if (error instanceof MimirBetaError || deps.isTransportError?.(error) || error instanceof UnpriceableFeedError) throw error;
    throw new MimirBetaError('PLAN_STALE', error instanceof Error ? error.message : String(error));
  });
  const core = v1.plan.instructions;
  const [[tickerClaim], [counter], [ata], oneChar] = await Promise.all([findMimirV1TickerClaimPda(programOf(deps), args.ticker),
    findMimirV1GenerationCounterPda(programOf(deps)), findMimirV1AssociatedTokenAddress(args.authority, colaMintOf(core)),
    args.ticker.length === 1 ? findMimirV1OneCharAllowancePda(programOf(deps), args.authority) : undefined]);
  const decimals = await mintDecimals(deps, colaMintOf(core));
  const specs = createSpecs(deps, { target: v1.feed, targetLen: v1.exactLen, tickerClaim, counter, colaMint: colaMintOf(core), ata,
    authority: args.authority, amountRaw: v1.colaAmountRaw, decimals, burnIndex: core.length - 1, oneChar: oneChar?.[0] });
  coherence?.context.select('burn:' + v1.feed, [ata, colaMintOf(core), args.authority, decimals, v1.colaAmountRaw]);
  coherence?.retain(() => v1.colaAmountRaw === computeMimirV1TickerTariff(coherence.admin.collateralAmountRaw, args.ticker, coherence.admin.tickerTierTenths)
    && coherence.context.account(colaMintOf(core))?.data[44] === decimals);
  const draft = { schema: 'mimir-v1-classic-draft', programId: programOf(deps), authority: args.authority, ticker: args.ticker, feedId: v1.feedId,
    variant: v1.definition.variant, pools: args.pools.map((pool) => pool.pool), solFeed: solFeed ?? null };
  return { v1, core, specs, draft, coherence, contextSlot: coherence?.slot, gate, priced };
}

/** The minimal first tag89 (no optional DLMM neighbours) must compile, and CREATE + that first refresh, simulated in one unsigned transaction, must publish a Fresh price. */
async function assertV1ClassicRefreshFits(deps: V1CreationDependencies, args: PrepareSimpleFeedArgs,
  v1: Awaited<ReturnType<typeof prepareMimirV1ClassicCreation>>, solFeed: Address | undefined, coherence?: FundingFrame, reads?: V1ClassicRefreshReads) {
  if (!deps.rowVectors) throw new Error('Price refresh is not available');
  const decoded = projectedClassic({ v1 } as Awaited<ReturnType<typeof draftV1Classic>>, args.authority, 0n);
  // The creation builder already authenticated this account through the same planning frame.
  const retainedSol = solFeed ? coherence?.context.account(solFeed) : undefined;
  const solAccount = retainedSol === undefined && solFeed
    ? (await new FinalizedRpcReader(deps.rpc as never, 'confirmed').accounts([solFeed])).value[0] : retainedSol;
  if (solFeed && !solAccount) throw new Error('Price refresh is not available');
  const sol = solFeed && solAccount ? decodeV1ClassicFeed(solAccount.data, solFeed) : null;
  const rows = [...decoded.rows, ...(sol?.rows ?? [])];
  const memberships = [...decoded.memberships.map((m, i) => ({ ...m, bindingVariant: args.pools[i]?.creation.bindingVariant === 'routeable' ? 1 : 0 })),
    ...(sol?.memberships ?? [])];
  // A newer planning slot must authenticate new vectors, even within the same user action.
  reads = coherence ? reads : undefined;
  const key = JSON.stringify([coherence?.slot, deps.rpcUrl, deps.deployment.cluster,
    rows.map(({ descriptor, source }) => [descriptor, source]), memberships], (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  let sourceAccounts = reads?.get(key);
  if (!sourceAccounts) {
    sourceAccounts = await deps.rowVectors(rows as never, memberships as never, { dlmmOptionalNeighbours: false,
      cluster: deps.deployment.cluster === 'mainnet-beta' ? 'mainnet' : deps.deployment.cluster, commitment: 'confirmed' });
    reads?.set(key, sourceAccounts);
  }
  const [registry] = await findMimirV1RegistryPda(programOf(deps));
  const instruction = buildMimirV1FusedClassicRefreshInstruction({ programId: programOf(deps), feed: v1.feed, registry,
    decoded: { rows: decoded.rows, converter: sol ? { rows: sol.rows } : null } as never, sourceAccounts,
    request: { feedId: decoded.feedId, declaredMaxSnapshotAge: v1.policy.maxSnapshotAgeSlots, previousSnapshotRevision: 0n, nextSnapshotRevision: 1n, componentCount: v1.n,
      sourceSetRevision: 1n, planHash: v1.planHash, converterSourceCount: sol?.rows.length ?? 0, feedConfigRevision: 1n, ringNewestSlots: rows.map(() => 0n), maxReuseAgeSlots: 0 } });
  await compileMimirBetaTransactionV1({ feePayer: args.authority, recentBlockhash: NO_IDENTITY, lastValidBlockHeight: 0n,
    instructions: [mimirComputeUnitLimitInstruction(mimirV1RefreshComputeUnitLimit(rows.length)), instruction] });
  const interval = args.recipes?.some((recipe) => isMimirClassicIntervalRecipe(recipe)) ?? false;
  return async (): Promise<FirstPrice | void> => {
    await assertFirstPriceFresh(deps, args, v1, instruction, rows.length);
    if (!interval) return { instruction, rows: rows.length };
  };
}

type SimulationRpc = { simulateTransaction(wire: string, config: object): { send(): Promise<{ value: { err: unknown; logs?: unknown; accounts?: readonly ({ data: readonly string[] } | null)[] | null } }> } };

/**
 * CREATE + its first refresh in one unsigned simulation (one RPC call); returns the post-state of `target`. A CREATE failure (e.g.
 * collateral not bought yet) and a pair too large or out of compute for one transaction give no verdict here: the review simulation still runs.
 */
async function simulateFirstPrice(deps: V1CreationDependencies, ticker: string, authority: Address, core: readonly MimirBetaInstruction[],
  refresh: MimirBetaInstruction, rowCount: number, target: Address): Promise<Uint8Array | null> {
  const instructions = [mimirComputeUnitLimitInstruction(Math.min(1_400_000, CREATE_COMPUTE_UNIT_LIMIT + mimirV1RefreshComputeUnitLimit(rowCount))), ...core, refresh];
  const tx = await compileMimirBetaTransactionV1({ feePayer: authority, recentBlockhash: NO_IDENTITY, lastValidBlockHeight: 0n, instructions })
    .catch((error: unknown) => { if (error instanceof MimirBetaError && error.code === 'TRANSACTION_TOO_LARGE') return null; throw error; });
  if (!tx) return null;
  const { value } = await (deps.rpc as unknown as SimulationRpc).simulateTransaction(btoa(String.fromCharCode(...tx.serializedTransaction)), { commitment: 'confirmed',
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: 'base64', addresses: [target] } }).send();
  const failed = (value.err as { InstructionError?: readonly [number, unknown] } | null)?.InstructionError;
  if (value.err && (failed?.[0] !== tx.instructions.length - 1 || failed[1] === 'ComputationalBudgetExceeded'
    || (Array.isArray(value.logs) && value.logs.some((log) => /exceeded CUs meter|Computational budget exceeded/.test(String(log)))))) return null;
  if (value.err) {
    const why = mimirBetaSimulationFailure(value.err, value.logs, programOf(deps), tx.instructions);
    throw new UnpriceableFeedError(`${ticker}: its first price fails (${why.rejection ?? why.customCode ?? why.errorKind}). Choose other pools. Nothing was sent.`);
  }
  const data = value.accounts?.[0]?.data[0];
  if (!data) throw new MimirBetaError('SIMULATION_FAILED', 'first price simulation did not return the feed');
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

/** C5: the Classic's first price must be Fresh (status 0, a snapshot slot and a non-zero mantissa); otherwise each row and limit is named. */
async function assertFirstPriceFresh(deps: V1CreationDependencies, args: PrepareSimpleFeedArgs, v1: Awaited<ReturnType<typeof prepareMimirV1ClassicCreation>>,
  refresh: MimirBetaInstruction, rowCount: number) {
  const bytes = await simulateFirstPrice(deps, args.ticker, args.authority, v1.plan.instructions, refresh, rowCount, v1.feed);
  if (!bytes) return;
  const feed = decodeV1ClassicFeed(bytes, v1.feed);
  const p = feed.prefix, view = new DataView(p.buffer, p.byteOffset, p.byteLength), degraded = p[104] === 1;
  if (p[104] === 0 && view.getBigUint64(116, true) > 0n && view.getBigUint64(188, true) > 0n) return;
  const named = feed.rows.flatMap((row, i) => {
    const ring = ringOf(row.ring), pool = args.pools[i];
    const where = `${args.ticker} · ${pool ? venueLabel(pool.family) : `source ${i + 1}`} pool`;
    return ring && ring.lastConfidenceBps > v1.policy.maxConfidenceBps ? [`${where}: confidence ${pct(ring.lastConfidenceBps)} · limit ${pct(v1.policy.maxConfidenceBps)}`] : [];
  });
  const dispersion = view.getUint16(250, true);
  if (dispersion > v1.policy.maxDispersionBps) named.push(`${args.ticker}: pools ${pct(dispersion)} from their median · limit ${pct(v1.policy.maxDispersionBps)}`);
  throw new UnpriceableFeedError(`${named.length ? named.join('; ') : `${args.ticker}: its first price would not be fresh (conditions ${degraded ? view.getUint16(180, true) : 0}, rows ${degraded ? p[186] : 0})`}. Choose other pools. Nothing was sent.`);
}

/**
 * I6: CREATE_COMPOSITE + its first tag87, simulated in one unsigned transaction, must be Fresh (status, price state, conditions and
 * conditioned rows 0, a non-zero mantissa). Its rows are the children's rows: one vector read, then one simulation.
 */
async function compositeFirstPriceGate(deps: V1CreationDependencies, args: PrepareCompositeFeedArgs, a: Readonly<{ composite: Address; feedId: Address;
  core: readonly MimirBetaInstruction[]; feeds: readonly ReturnType<typeof decodeV1ClassicFeed>[]; converter: ReturnType<typeof decodeV1ClassicFeed> | null;
  admin: Awaited<ReturnType<typeof decodeMimirBetaAdminContext>>; adminConfig: Address; registry: Address;
  policy: Readonly<{ maxComponentConfidenceBps: number; maxComponentDispersionBps: number }> }>) {
  if (!deps.rowVectors) throw new Error('Price refresh is not available');
  const rows = a.feeds.map((f) => f.rows[0]!), converterRows = a.converter?.rows ?? [];
  const vectors = await deps.rowVectors([...rows, ...converterRows] as never, [...a.feeds.map((f) => f.memberships[0]!), ...(a.converter?.memberships ?? [])] as never,
    { dlmmOptionalNeighbours: false, cluster: deps.deployment.cluster === 'mainnet-beta' ? 'mainnet' : deps.deployment.cluster, commitment: 'confirmed' });
  const refresh = buildMimirV1FusedCompositeRefreshInstruction({ programId: programOf(deps), payer: args.authority, composite: a.composite, registry: a.registry,
    adminConfig: a.adminConfig, treasury: a.admin.feeTreasury, decoded: { rows, converter: a.converter ? { rows: converterRows } : null },
    componentAccounts: vectors.slice(0, rows.length), converterAccounts: vectors.slice(rows.length),
    request: { compositeFeedId: Uint8Array.from(getAddressEncoder().encode(a.feedId)), expectedConfigRevision: 1n, previousSnapshotRevision: 0n, nextSnapshotRevision: 1n,
      componentSourceConfigRevisions: rows.map(() => 1n), maxRefreshFeeLamports: a.admin.compositeRefreshFeeLamports,
      componentRingNewestSlots: rows.map(() => 0n), converterRingNewestSlots: converterRows.map(() => 0n), maxReuseAgeSlots: 0 } });
  return async (): Promise<FirstPrice | void> => {
    const bytes = await simulateFirstPrice(deps, args.ticker, args.authority, a.core, refresh, vectors.length, a.composite);
    if (!bytes) return;
    const after = decodeV1CompositeFeed(bytes, a.composite), s = after.snapshot;
    if (s.status === 0 && s.priceState === 0 && s.conditions === 0 && s.conditionedRows === 0 && s.priceMantissa > 0n) return { instruction: refresh, rows: vectors.length };
    const named = after.rows.flatMap((row, i) => {
      const ring = ringOf(row.ring), who = a.feeds[i] ? decodeV1Ticker(a.feeds[i]!.definition.ticker) ?? `Component ${i + 1}` : `Component ${i + 1}`;
      return !ring ? [] : [...(ring.lastConfidenceBps > a.policy.maxComponentConfidenceBps ? [`${who}: pool confidence ${pct(ring.lastConfidenceBps)} · limit ${pct(a.policy.maxComponentConfidenceBps)}`] : []),
        ...(ring.lastSpreadBps > a.policy.maxComponentDispersionBps ? [`${who}: pool spread ${pct(ring.lastSpreadBps)} · limit ${pct(a.policy.maxComponentDispersionBps)}`] : [])];
    });
    throw new UnpriceableFeedError(`${named.length ? named.join('; ') : `${args.ticker}: its first price would not be fresh (conditions ${s.conditions}, rows ${s.conditionedRows})`}. Choose other components. Nothing was sent.`);
  };
}

/** Cost-only child projection from the SDK's exact definition. Never used as landed state or receipt evidence. */
function projectedClassic(d: Awaited<ReturnType<typeof draftV1Classic>>, authority: Address, slot: bigint): ReturnType<typeof decodeV1ClassicFeed> {
  const v = d.v1;
  const rows = v.definition.rows.map((row) => ({ descriptor: decodeV1Descriptor(row.descriptor), source: row.sourceImage, ring: new Uint8Array(544) }));
  return { prefix: new Uint8Array(512), feedId: getAddressEncoder().encode(v.feedId) as Uint8Array, selfAddress: v.feed,
    owner: { creator: authority, identityAsset: null, createdSlot: slot, generation: 0n, generationSeq: 0, closeAfterSlot: 0n, noticeKind: 0 },
    header: { version: 1, hlen: 64, exactLen: v.exactLen, definitionDigest: new Uint8Array(32), sourceSetRevision: 1n, n: v.n, s: v.s, bump: v.feedBump,
      status: 0, regionMask: 0, f2Credit: V1Layout.F2_CREDIT_AVAILABLE }, proof: null,
    definition: { feedImage: v.definition.feedImage, planImage: v.definition.planImage, ticker: v.definition.feedImage.subarray(313) }, rows,
    converter: null, memberships: rows.map(({ descriptor: d }) => ({ bindingWidth: d.bindingWidth, derived: d.derived,
      planBinding: 0, bindingVariant: 0, tuples: [] })), modules: [] };
}

const colaMintOf = (core: readonly MimirBetaInstruction[]) => core.at(-1)!.accounts[6]!.address;

async function mintDecimals(deps: V1CreationDependencies, mint: Address) {
  const [account] = (await new FinalizedRpcReader(deps.rpc as never, 'confirmed').accounts([mint])).value;
  if (!account) throw new Error('COLA mint missing');
  return account.data[44]!;
}

export async function prepareV1SimpleFeed(deps: V1CreationDependencies, args: PrepareSimpleFeedArgs): Promise<MimirBetaPreparedCreation> {
  // A proven final CREATE is historical: validate its definition without selecting unpaid terms again.
  if (landedOf(args) && landedSlotOf(args) !== undefined) {
    if (args.variant === 'new') throw new Error(DEFINITION_CHANGED);
    const variant = args.variant ?? 0, program = programOf(deps);
    const feedId = await deriveMimirV1ClassicFeedId(args.baseMint, args.quoteMint, variant);
    const [feed] = await findMimirV1ClassicFeedPda(program, feedId);
    const solFeed = args.quoteMint === SOL_MINT ? args.solConversionSourceConfig : undefined;
    const draft = { schema: 'mimir-v1-classic-draft', programId: program, authority: args.authority, ticker: args.ticker, feedId,
      variant, pools: args.pools.map(pool => pool.pool), solFeed: solFeed ?? null };
    return reviewed({ ...deps, rpc: contextOf(args)?.rpc(deps.rpc, undefined, false) ?? deps.rpc }, {
      kind: 'classic', authority: args.authority, feedId, feed, ticker: args.ticker, displayName: null, variant,
      core: [], specs: [], draft, selectedPools: args.pools, landed: landedOf(args), landedSlot: landedSlotOf(args),
      definition: data => addressOf(decodeV1ClassicFeed(data, feed).feedId) === feedId });
  }
  const key = JSON.stringify([programOf(deps), args.authority, args.ticker, args.baseMint, args.quoteMint, args.pools.map((pool) => pool.pool), args.variant ?? 'new',
    args.policy, args.recipes ?? null, args.temporalMode ?? null, args.solConversionSourceConfig ?? null], (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  const kept = (args as { reusePurchaseDraft?: boolean }).reusePurchaseDraft ? purchaseDrafts.get(key) : undefined;
  purchaseDrafts.delete(key);
  if (kept && Date.now() - kept.at < PURCHASE_DRAFT_TTL_MS) {
    const coherence = await fundingFrame(deps, true, contextOf(args));
    return reviewedClassic(coherence?.dependencies ?? deps, args, { ...kept.d, coherence });
  }
  const d = await draftV1Classic(deps, args);
  return reviewedClassic(d.coherence?.dependencies ?? deps, args, d).catch((error: unknown) => {
    if (error instanceof MimirBetaCollateralRequiredError && args.allowCollateralFunding) purchaseDrafts.set(key, { d, at: Date.now() });
    throw error;
  });
}

/** Pre-swap classic drafts kept for the post-swap review: one use, within the purchase window. */
const purchaseDrafts = new Map<string, { d: Awaited<ReturnType<typeof draftV1Classic>>; at: number }>();
const PURCHASE_DRAFT_TTL_MS = 60_000;

function reviewedClassic(deps: V1CreationDependencies, args: PrepareSimpleFeedArgs, d: Awaited<ReturnType<typeof draftV1Classic>>) {
  return reviewed(deps, { coherence: d.coherence, contextSlot: d.contextSlot, kind: 'classic', authority: args.authority, feedId: d.v1.feedId, feed: d.v1.feed, ticker: args.ticker, displayName: null,
    variant: d.v1.definition.variant, core: d.core, specs: d.specs, draft: d.draft, selectedPools: args.pools, funding: args, landed: landedOf(args),
    landedSlot: landedSlotOf(args), definition: (data) => addressOf(decodeV1ClassicFeed(data, d.v1.feed).feedId) === d.v1.feedId,
    memo: (args as PrepareSimpleFeedArgs & { mediaMemoSha?: string }).mediaMemoSha, gate: d.gate,
    tolerance: toleranceLine('feed', d.v1.policy.maxDispersionBps, d.v1.policy.maxConfidenceBps, d.v1.widenedBy.map((w) => ({
      who: `The ${args.pools[w.position - 1] ? venueLabel(args.pools[w.position - 1]!.family) : `source ${w.position}`} pool`, requiredBps: w.requiredBps, capBps: w.capBps })), d.priced ? undefined : d.v1.policy.priceExponent) });
}

/** The SOL/quote variant-0 feed: converter of SOL-quoted children (none for a SOL-quoted composite). */
const solFeedOf = async (program: Address, quoteMint: Address) => quoteMint === SOL_MINT ? undefined : (await findMimirV1SolFeedPda(program, quoteMint))[0];

/** Canonical (ascending feed_id) children with their V1 feed and R-08 SourceConfig addresses. */
async function orderedChildren(program: Address, components: readonly Readonly<{ feedId: Address; quantityX64: bigint }>[]) {
  const children = await Promise.all(components.map(async (c) => ({ feedId: c.feedId, quantityX64: c.quantityX64,
    feed: (await findMimirV1ClassicFeedPda(program, c.feedId))[0], sourceConfig: (await findMimirV1SourceConfigAddress(program, c.feedId, 0))[0] })));
  return canonicalizeMimirBetaCompositeComponents(children.map(({ feedId, sourceConfig, quantityX64 }) => ({ feedId, sourceConfig, quantityX64 })))
    .map((c) => children.find((x) => x.feedId === c.feedId)!);
}

/** Composite id and account; with a SOL-quoted child the SOL feed's row-0 SourceConfig is part of the id, as on chain. */
async function compositeTarget(program: Address, args: Pick<PrepareCompositeFeedArgs, 'authority' | 'quoteMint' | 'policy'>,
  ordered: Awaited<ReturnType<typeof orderedChildren>>, solQuoted: boolean) {
  const converter = solQuoted ? (await findMimirV1SourceConfigAddress(program, await deriveMimirV1ClassicFeedId(SOL_MINT, args.quoteMint, 0), 0))[0] : undefined;
  const feedId = await deriveMimirV1CompositeFeedId({ creator: args.authority, quoteMint: args.quoteMint, priceExponent: args.policy.priceExponent,
    components: ordered.map(({ feedId, sourceConfig, quantityX64 }) => ({ feedId, sourceConfig, quantityX64 })),
    ...(converter ? { solConversionSourceConfig: converter } : {}) });
  const [composite, bump] = await findMimirV1CompositePda(program, feedId);
  return { feedId, composite, bump };
}

const rowQuote = (f: ReturnType<typeof decodeV1ClassicFeed>) =>
  getAddressDecoder().decode(f.rows[0]!.source.subarray(V1Layout.SRC_OFFSET_QUOTE_MINT, V1Layout.SRC_OFFSET_QUOTE_MINT + 32));
const rowPool = (f: ReturnType<typeof decodeV1ClassicFeed>) =>
  getAddressDecoder().decode(f.rows[0]!.source.subarray(V1Layout.SRC_OFFSET_POOL_OR_MARKET, V1Layout.SRC_OFFSET_POOL_OR_MARKET + 32));

/** The same creator, quote, exponent and components already have a composite: refused before any approval, naming it. */
function existingComposite(program: Address, composite: Address, account: ReadAccount) {
  if (account?.owner !== program) return;
  let ticker: string | null = null;
  try { ticker = decodeV1Ticker(decodeV1CompositeFeed(account.data).config.ticker); } catch { /* unnamed */ }
  throw new CompositeExistsError(composite, ticker);
}

/** CREATE_COMPOSITE over existing V1 Classics: canonical child order, per-child owner/asset metas, the SOL feed converter (s) and the exact
 * length (SINGLE or BEGIN/GROW/SEAL) from the SDK shape, tariff on the composite ticker. */
export async function draftV1Composite(deps: V1CreationDependencies, args: PrepareCompositeFeedArgs,
  projected = new Map<Address, ReturnType<typeof decodeV1ClassicFeed>>(), minContextSlot?: bigint, coherence?: FundingFrame) {
  coherence ??= await fundingFrame(deps, !!args.allowCollateralFunding || !!contextOf(args), contextOf(args));
  deps = coherence?.dependencies ?? deps;
  if (args.components.some((c) => c.createClassic)) throw new Error('V1 composites with new components are created child by child first');
  const program = programOf(deps);
  const ordered = await orderedChildren(program, args.components);
  const solFeed = await solFeedOf(program, args.quoteMint);
  const [[adminConfig], [registry], [treasury], [counter], [tickerClaim]] = await Promise.all([findMimirV1AdminConfigPda(program),
    findMimirV1RegistryPda(program), findMimirV1TreasuryPda(program), findMimirV1GenerationCounterPda(program), findMimirV1TickerClaimPda(program, args.ticker)]);
  const reader = new FinalizedRpcReader(deps.rpc as never, 'confirmed');
  const solChild = ordered.some((c) => c.feed === solFeed);
  const adminRead = await reader.accounts([adminConfig, ...ordered.map((c) => c.feed), ...(solFeed && !solChild ? [solFeed] : [])], minContextSlot ?? coherence?.context.paidSlot());
  const read = adminRead.value;
  const admin = await decodeMimirBetaAdminContext(adminConfig, read[0]?.data ?? new Uint8Array());
  const colaMint = admin.collateralMint ?? (() => { throw new Error('V1 admin has no COLA mint'); })();
  const feeds = ordered.map((c, i) => {
    const account = read[i + 1];
    if (projected.has(c.feed)) return projected.get(c.feed)!;
    if (!account || account.owner !== program) throw new Error('V1 composite component is not a V1 Classic feed');
    return decodeV1ClassicFeed(account.data, c.feed);
  });
  const solAccount = solFeed ? read[solChild ? 1 + ordered.findIndex((c) => c.feed === solFeed) : ordered.length + 1] : undefined;
  const sol = solFeed && solAccount?.owner === program ? { address: solFeed, feed: decodeV1ClassicFeed(solAccount.data, solFeed) } : undefined;
  mimirV1CompositeShape({ quoteMint: args.quoteMint, children: feeds, ...(sol ? { solFeed: sol } : {}) });
  const { feedId, composite, bump } = await compositeTarget(program, args, ordered, feeds.some((f) => rowQuote(f) !== args.quoteMint));
  const records = feeds.map((f) => ({ creator: f.owner.creator!, identityAsset: f.owner.identityAsset }));
  const assets = records.map((r) => r.identityAsset);
  const observedSlot = BigInt(await (deps.rpc as unknown as SlotRpc).getSlot({ commitment: 'confirmed' }).send());
  const slot = adminRead.slot > observedSlot ? adminRead.slot : observedSlot;
  const credit = feeds.map((f) => f.header.f2Credit === V1Layout.F2_CREDIT_AVAILABLE && f.owner.creator === args.authority
    && slot >= f.owner.createdSlot && slot - f.owner.createdSlot <= BigInt(V1Layout.F2_WINDOW_SLOTS));
  const unique = [...new Set(assets.filter((x): x is Address => x !== null))];
  const converterPools = sol && feeds.some((f) => rowQuote(f) !== args.quoteMint) ? sol.feed.rows.map((r) => getAddressDecoder()
    .decode(r.source.subarray(V1Layout.SRC_OFFSET_POOL_OR_MARKET, V1Layout.SRC_OFFSET_POOL_OR_MARKET + 32))) : [];
  const poolList = [...new Set([...feeds.map(rowPool), ...converterPools])];
  const assetsRead = await reader.accounts([...unique, colaMint, ...poolList, composite], slot);
  const assetRead = assetsRead.value;
  if (!landedOf(args)) existingComposite(program, composite, assetRead.at(-1));
  const quality = await mimirV1CompositeParamRows({ programId: program, quoteMint: args.quoteMint, children: feeds, ...(sol ? { solFeed: sol } : {}),
    pools: new Map(poolList.map((pool, i) => [pool, assetRead[unique.length + 1 + i]?.data])),
    positions: ordered.map((o) => args.components.findIndex((c) => c.feedId === o.feedId) + 1) });
  const { policy, widenedBy } = mimirAutoCompositePolicy({ rows: quality.rows, ...(quality.converter ? { converter: quality.converter } : {}),
    slotMs: await sessionSlotMs(deps), priceExponent: args.policy.priceExponent });
  const decimals = assetRead[unique.length]?.data[44] ?? (() => { throw new Error('COLA mint missing'); })();
  const owners = records.map((record, i) => {
    const asset = assets[i] ? assetRead[unique.indexOf(assets[i]!)] ?? null : null;
    const live = resolveV1Owner(record as Parameters<typeof resolveV1Owner>[0], asset, deps.deployment.mplCoreProgramId);
    return live.state === 'ownerless' ? undefined : live.owner;
  });
  const metas = records.map((_, i) => {
    const owner = owners[i];
    return { feed: ordered[i]!.feed, ...(credit[i] ? { f2CreditConsumed: true } : {}), ...(owner && owner !== args.authority ? { ownerDestination: owner } : {}), ...(assets[i] ? { coreAsset: assets[i]! } : {}) };
  });
  const [[ata], oneChar] = await Promise.all([findMimirV1AssociatedTokenAddress(args.authority, colaMint),
    args.ticker.length === 1 ? findMimirV1OneCharAllowancePda(program, args.authority) : undefined]);
  const [, tickerBump] = await findMimirV1TickerClaimPda(program, args.ticker);
  const [, counterBump] = await findMimirV1GenerationCounterPda(program);
  const priced = pricedOf(args) ?? admin;
  if (args.allowCollateralFunding && (priced.configRevision !== admin.configRevision || priced.collateralAmountRaw !== admin.collateralAmountRaw
    || priced.tickerTierTenths.some((tier, i) => tier !== admin.tickerTierTenths[i]))) {
    throw new ReviewIntentChangedError('Composite pricing changed; prepare a new review before purchasing collateral');
  }
  const colaAmountRaw = computeMimirV1TickerTariff(priced.collateralAmountRaw, args.ticker, priced.tickerTierTenths);
  const plan = planMimirV1CompositeCreationFromFeeds({ programId: program, payer: args.authority, composite, tickerClaim, generationCounter: counter, adminConfig, registry,
    treasury, colaMint, payerColaAta: ata, children: metas, ...(oneChar ? { oneCharAllowance: oneChar[0] } : {}), quality,
    head: { targetBump: bump, tickerBump, counterBump }, colaAmountRaw, admin: { configRevision: priced.configRevision }, feedId, childFeeds: feeds, ...(sol ? { solFeed: sol } : {}),
    params: { priceExponent: args.policy.priceExponent, riskTier: 0, routeabilityCap: 4,
      maxSnapshotAgeSlots: policy.maxSnapshotAgeSlots, maxComponentSnapshotAgeSlots: policy.maxComponentSnapshotAgeSlots,
      maxComponentConfidenceBps: policy.maxComponentConfidenceBps, maxComponentDispersionBps: policy.maxComponentDispersionBps,
      ticker: args.ticker, quoteMint: args.quoteMint,
      components: ordered.map((c, i) => ({ quantityX64: c.quantityX64, ownerDestination: 'ownerDestination' in metas[i]!, coreAsset: 'coreAsset' in metas[i]! })) } });
  const core = plan.instructions;
  const specs = createSpecs(deps, { target: composite, targetLen: plan.shape.finalLen, tickerClaim, counter, colaMint, ata, authority: args.authority,
    amountRaw: colaAmountRaw, decimals, burnIndex: core.length - 1, oneChar: oneChar?.[0] }).concat(ordered.flatMap((c, i) => credit[i] ? [{ kind: 'account' as const,
    address: c.feed, transition: 'write' as const, ownerAfter: program, dataLengthAfter: read[i + 1]?.data.length ?? feeds[i]!.header.exactLen, description: 'consume the child F2 credit' }] : []));
  const draft = { schema: 'mimir-v1-composite-draft', programId: program, authority: args.authority, ticker: args.ticker, feedId,
    components: ordered.map((c) => ({ feedId: c.feedId, quantityX64: c.quantityX64.toString() })) };
  const protocolFeeLamports = computeMimirV1CompositeActivationFeeLamports(admin, feeds.length,
    metas.filter((m) => 'ownerDestination' in m).length, credit.filter(Boolean).length,
    owners.filter((owner) => !owner).length).total;
  coherence?.context.select('burn:' + composite, [ata, colaMint, args.authority, decimals, colaAmountRaw]);
  const selectedEndpoints = feeds.flatMap((f, i) => credit[i] ? [f.owner.createdSlot + BigInt(V1Layout.F2_WINDOW_SLOTS)] : []);
  coherence?.retain(finalSlot => {
    const latestFeeds = ordered.map(c => {
      if (projected.has(c.feed)) return projected.get(c.feed)!;
      const account = coherence.context.account(c.feed);
      if (!account || account.owner !== program) return coherence.context.changed();
      return decodeV1ClassicFeed(account.data, c.feed);
    });
    const finalCredit = latestFeeds.map(f => f.header.f2Credit === V1Layout.F2_CREDIT_AVAILABLE && f.owner.creator === args.authority
      && finalSlot >= f.owner.createdSlot && finalSlot - f.owner.createdSlot <= BigInt(V1Layout.F2_WINDOW_SLOTS));
    const finalOwners = latestFeeds.map(f => {
      const record = { creator: f.owner.creator!, identityAsset: f.owner.identityAsset };
      const live = resolveV1Owner(record as Parameters<typeof resolveV1Owner>[0],
        record.identityAsset ? coherence.context.account(record.identityAsset) ?? null : null, deps.deployment.mplCoreProgramId);
      return live.state === 'ownerless' ? undefined : live.owner;
    });
    const currentAdmin = coherence.admin;
    return finalCredit.every((eligible, i) => eligible === credit[i])
      && latestFeeds.every((f, i) => f.owner.identityAsset === assets[i] && finalOwners[i] === owners[i])
      && coherence.context.account(colaMint)?.data[44] === decimals
      && colaAmountRaw === computeMimirV1TickerTariff(currentAdmin.collateralAmountRaw, args.ticker, currentAdmin.tickerTierTenths)
      && protocolFeeLamports === computeMimirV1CompositeActivationFeeLamports(currentAdmin, latestFeeds.length,
        finalOwners.filter(owner => owner && owner !== args.authority).length, finalCredit.filter(Boolean).length, finalOwners.filter(owner => !owner).length).total;
  }, selectedEndpoints.length ? selectedEndpoints.reduce((a, b) => a < b ? a : b) : undefined);
  const gate = () => compositeFirstPriceGate(deps, args, { composite, feedId, core, feeds, converter: converterPools.length ? sol!.feed : null, admin, adminConfig, registry, policy });
  const tickerAt = (position: number) => {
    const i = ordered.findIndex((o) => o.feedId === args.components[position - 1]?.feedId);
    return (i >= 0 ? decodeV1Ticker(feeds[i]!.definition.ticker) : null) ?? `Component ${position}`;
  };
  const tolerance = toleranceLine('index', policy.maxComponentDispersionBps, policy.maxComponentConfidenceBps,
    widenedBy.map((w) => ({ who: `${tickerAt(w.position)}'s pool`, requiredBps: w.requiredBps, capBps: w.capBps })));
  return { feedId, composite, core, specs, draft, metas, protocolFeeLamports, priced, coherence, contextSlot: assetsRead.slot > slot ? assetsRead.slot : slot, policy, tolerance, gate };
}

export async function prepareV1CompositeFeed(deps: V1CreationDependencies, args: PrepareCompositeFeedArgs): Promise<MimirBetaPreparedCreation> {
  if (landedOf(args) && landedSlotOf(args) !== undefined) {
    const observer = { ...deps, rpc: contextOf(args)?.rpc(deps.rpc, undefined, false) ?? deps.rpc };
    const program = programOf(deps), ordered = await orderedChildren(program, args.components);
    const children = (await new FinalizedRpcReader(observer.rpc as never, 'confirmed').accounts(ordered.map(c => c.feed), landedSlotOf(args))).value;
    const solQuoted = children.some((child, i) => child?.owner === program && rowQuote(decodeV1ClassicFeed(child.data, ordered[i]!.feed)) !== args.quoteMint);
    const { feedId, composite } = await compositeTarget(program, args, ordered, solQuoted);
    const draft = { schema: 'mimir-v1-composite-draft', programId: program, authority: args.authority, ticker: args.ticker, feedId,
      components: ordered.map(c => ({ feedId: c.feedId, quantityX64: c.quantityX64.toString() })) };
    return reviewed(observer, { kind: 'composite', authority: args.authority, feedId, feed: composite, ticker: args.ticker,
      displayName: args.displayName || null, core: [], specs: [], draft, selectedPools: null, landed: landedOf(args), landedSlot: landedSlotOf(args),
      definition: v1CompositeDefinition(composite, { feedId, creator: args.authority, priceExponent: args.policy.priceExponent, components: draft.components }) });
  }
  const d = await draftV1Composite(deps, args);
  const program = programOf(deps);
  return reviewed(d.coherence?.dependencies ?? deps, { coherence: d.coherence, contextSlot: d.contextSlot, kind: 'composite', authority: args.authority, feedId: d.feedId, feed: d.composite, ticker: args.ticker,
    displayName: args.displayName || null, core: d.core, specs: d.specs, draft: d.draft, selectedPools: null, funding: args, protocolFeeLamports: d.protocolFeeLamports, landed: landedOf(args), landedSlot: landedSlotOf(args),
    definition: v1CompositeDefinition(d.composite, { feedId: d.feedId, creator: args.authority, priceExponent: args.policy.priceExponent, components: d.draft.components }),
    memo: (args as PrepareCompositeFeedArgs & { mediaMemoSha?: string }).mediaMemoSha, gate: async () => (await d.gate())(), tolerance: d.tolerance }).catch(async (error: unknown) => {
    if (!(error instanceof MimirBetaSimulationError && error.customCode === 65 && error.programId === program)) throw error;
    const [account] = (await new FinalizedRpcReader((d.coherence?.dependencies ?? deps).rpc as never, 'confirmed').accounts([d.composite]).catch(() => undefined))?.value ?? [];
    existingComposite(program, d.composite, account?.owner === program ? account : { owner: program, lamports: 0n, data: new Uint8Array() });
    throw error;
  });
}

type OperationId = MimirBetaCompositeJourneyOperationId;
type JourneyComponent = PrepareCompositeFeedArgs['components'][number];

type StatusRpc = { getSignatureStatuses(s: readonly string[], c: { searchTransactionHistory: boolean }): { send(): Promise<{ value: readonly ({ err: unknown; confirmationStatus?: string } | null)[] }> } };

type ReviewedCreate = Awaited<ReturnType<typeof authenticateMimirBetaReviewedStep>>['review'];
const NOT_SAME_CREATE = 'The replacement is not the same reviewed V1 CREATE; a new intent needs a new review';

/** Subject and core CREATE instructions (caller prefix, first-price suffix and compute-budget config excluded); only runtime-dependent hashes may move. */
const createIntent = (r: ReviewedCreate) => JSON.stringify([r.cluster, r.programId, r.authority, r.draftHash, r.stepId, r.kind, r.feedId, r.feed,
  r.identityAsset, r.ticker, r.instructions.slice(r.callerPrefix?.instructionCount ?? 0, r.instructions.length - (r.firstPrice?.instructionCount ?? 0))]);

async function assertV1Replacement(prior: MimirBetaStageReceipt, next: ReviewedCreate) {
  if (createIntent((await authenticateMimirBetaReviewedStep(prior)).review) !== createIntent(next)) throw new Error(NOT_SAME_CREATE);
}

/**
 * One V1 operation's receipts, for preparation, reconciliation and restoration alike. A same-hash retry stays on the SDK chain guard. A fresh review
 * after attempt 1 whose runtime-dependent hashes changed is a replacement: linked to attempt 1, the same CREATE, attempt 1 re-proven expired or failed
 * through the finalized fence, each receipt observed on its own (both kept), and the landed feed decoded at a context >= its transaction slot.
 */
export async function observeV1Operation(rpc: MimirBetaReconciliationRpc, receipts: readonly MimirBetaStageReceipt[],
  bound: Readonly<{ finalityAttempts?: number }> = {}, context?: SolCreationContext): Promise<readonly MimirBetaProvenObservation[]> {
  if (context) {
    const observations = await observeV1Operation(context.rpc(rpc, undefined, false), receipts, bound);
    for (const observation of observations) {
      const receipt = receipts.find(r => r.signature === observation.signature)!;
      await context.settle(receipt, observation);
    }
    return observations;
  }
  const [prior, retry] = receipts;
  if (!prior || !retry || receipts.length > 2 || retry.stepIntentHash === prior.stepIntentHash && retry.expectedWritesHash === prior.expectedWritesHash) {
    return observeMimirBetaReceiptChain({ rpc, receipts, ...bound });
  }
  const successor = (await authenticateMimirBetaReviewedStep(retry)).review;
  if (prior.attempt !== 1 || retry.attempt !== 2 || retry.stepId !== prior.stepId || retry.retryOfSignature !== prior.signature) throw new Error(NOT_SAME_CREATE);
  await assertV1Replacement(prior, successor);
  const first = await observeMimirBetaReceipt({ rpc, receipt: prior, ...bound });
  if (first.state !== 'expired' && first.state !== 'failed') throw new Error('The replaced V1 attempt is not proven expired or failed; verification stays fenced');
  const second = await observeMimirBetaReceipt({ rpc, receipt: retry, ...bound });
  if (second.state === 'finalized') {
    const [feed] = (await new FinalizedRpcReader(rpc as never).accounts([successor.feed], second.observedSlot)).value;
    const decoded = feed?.owner === successor.programId ? (successor.kind === 'classic' ? decodeV1ClassicFeed(feed.data, successor.feed).feedId
      : decodeV1CompositeFeed(feed.data, successor.feed).config.feedId) : undefined;
    if (!decoded || addressOf(decoded) !== successor.feedId) throw new Error(DEFINITION_CHANGED);
  }
  return Object.freeze([first, second]);
}

/** Lands, waits or retries one operation from its receipts: `confirmed` once the last signature is confirmed without error. */
async function receiptState(rpc: MimirBetaReconciliationRpc, receipts: readonly MimirBetaStageReceipt[], context?: SolCreationContext, publish?: (observations: readonly MimirBetaProvenObservation[]) => void) {
  const last = receipts.at(-1);
  if (!last) return { state: 'none' as const };
  const observations = await observeV1Operation(rpc, receipts, {}, context).catch((error: unknown) => {
    if (error instanceof MimirBetaExpiryFinalizingError) return [];
    throw error;
  });
  publish?.(observations);
  const observed = observations.at(-1);
  if (observed?.state === 'finalized') return { state: 'finalized' as const, slot: observed.observedSlot };
  if (observed?.state === 'expired' || observed?.state === 'failed') return { state: receipts.length < 2 ? 'retry' as const : 'blocked' as const };
  const status = (await (rpc as unknown as StatusRpc).getSignatureStatuses([last.signature], { searchTransactionHistory: false }).send().catch(() => undefined))?.value[0];
  if (context && context.paidSlot(last.signature) === undefined) return { state: 'pending' as const };
  return { state: status && status.err === null && status.confirmationStatus !== 'processed' ? 'confirmed' as const : 'pending' as const };
}

/**
 * All-new-component V1 composite (SPEC I-7): each new child Classic is its own reviewed CREATE_CLASSIC transaction, then CREATE_COMPOSITE
 * over the created feeds. `state` carries the receipts per operation; a child's `"new"` variant is pinned from its draft once it has a receipt.
 */
export async function prepareV1CompositeFeedJourney(deps: V1CreationDependencies, args: PrepareCompositeFeedJourneyArgs,
  rpc: MimirBetaReconciliationRpc): Promise<MimirBetaPreparedCompositeJourney> {
  const coherence = await fundingFrame(deps, !!args.input.allowCollateralFunding || !!contextOf(args.input), contextOf(args.input));
  rpc = coherence ? coherence.context.rpc(rpc, undefined, false) : rpc;
  const input = args.input, program = programOf(deps);
  const publish = (args as PrepareCompositeFeedJourneyArgs & { onOperationObserved?: (id: OperationId, observations: readonly MimirBetaProvenObservation[]) => void }).onOperationObserved;
  const childIndexes = input.components.flatMap((c, i) => c.createClassic ? [i] : []);
  const childDef = (i: number) => {
    const c = input.components[i]!.createClassic!;
    return { baseMint: c.baseMint, quoteMint: c.pool.quoteMint, ticker: c.ticker, pool: c.pool.pool, variant: c.variant ?? null,
      quantityX64: input.components[i]!.quantityX64.toString(), recipe: input.componentRecipes?.[i] ?? null, temporalMode: c.temporalMode ?? null };
  };
  const intent = await createDraftHash({ schema: 'mimir-v1-composite-journey-intent', programId: program, authority: input.authority, ticker: input.ticker,
    displayName: input.displayName, quoteMint: input.quoteMint, policy: input.policy,
    components: input.components.map((c, i) => c.createClassic ? { create: childDef(i) } : { feedId: c.feedId, quantityX64: c.quantityX64.toString() }) });
  if (args.state && args.state.intentHash !== intent.draftHash) throw new Error('Composite journey intent changed; a new intent needs a new review');
  const saved = new Map(args.state?.operations.map((o) => [o.operationId, o]) ?? []);
  const receiptsOf = (id: OperationId) => saved.get(id)?.receipts ?? [];
  const drafts = new Map<OperationId, string>();
  const ids: OperationId[] = [...childIndexes.map((i) => `child:${i}` as OperationId), 'root'];
  const operationStates = () => Promise.all(ids.map(async (operationId) => ({ operationId,
    definitionHash: operationId === 'root' ? intent.draftHash : (await createDraftHash({ schema: 'mimir-v1-composite-journey-child', ...childDef(Number(operationId.slice(6))) })).draftHash,
    identity: operationId === 'root' ? input.identity : input.components[Number(operationId.slice(6))]!.createClassic!.identity,
    canonicalDraftJson: drafts.get(operationId) ?? saved.get(operationId)?.canonicalDraftJson ?? null, receipts: receiptsOf(operationId) })));
  const solFeed = await solFeedOf(program, input.quoteMint);
  const observerRpc = coherence?.context.rpc(deps.rpc, undefined, false) ?? deps.rpc;
  const reader = new FinalizedRpcReader(observerRpc as never, 'confirmed');
  const wrap = (operationId: OperationId, p: MimirBetaPreparedCreation): MimirBetaCompositeJourneyNextV1 => ({ operationId,
    canonicalDraftJson: p.canonicalDraftJson, draftHash: p.draftHash, plan: p.plan, selectedPools: p.selectedPools, preparedStep: p.next!,
    provisional: false, prerequisites: [], ...(toleranceOf(p) ? { tolerance: toleranceOf(p) } : {}) });
  const childArgs = (i: number, variant: number | 'new', receipts: readonly MimirBetaStageReceipt[]): PrepareSimpleFeedArgs => {
    const c = input.components[i]!.createClassic!, { mediaMemoSha } = c as { mediaMemoSha?: string };
    return { ...(coherence ? { fundingContext: coherence.context } : {}), authority: input.authority, ticker: c.ticker, baseMint: c.baseMint, quoteMint: c.pool.quoteMint, pools: [c.pool], identity: c.identity,
      creatorCollateralTokenAccount: input.creatorCollateralTokenAccount, policy: c.policy, variant,
      ...(input.componentRecipes?.[i] ? { recipes: [input.componentRecipes[i]!] } : {}), ...(c.temporalMode ? { temporalMode: c.temporalMode } : {}),
      ...(c.pool.quoteMint === SOL_MINT && solFeed ? { solConversionSourceConfig: solFeed } : {}), ...(receipts.length ? { receipts } : {}),
      ...(mediaMemoSha ? { mediaMemoSha } : {}) };
  };

  let action: MimirBetaPreparedCompositeJourney['action'] = 'review-next-step';
  let next: MimirBetaCompositeJourneyNextV1 | null = null;
  let allFinal = true;
  const feedIds = new Map<number, Address>();
  const pending: { i: number; variant: number; receipts: readonly MimirBetaStageReceipt[]; retry: boolean }[] = [];
  for (const i of childIndexes) {
    const id = `child:${i}` as OperationId, receipts = receiptsOf(id), c = input.components[i]!.createClassic!;
    const pinned = receipts.length ? Number((JSON.parse(saved.get(id)!.canonicalDraftJson!) as { variant: unknown }).variant) : undefined;
    const variant = pinned ?? (c.variant || (await findMimirV1FreeClassicVariant({ programId: program, baseMint: c.baseMint, quoteMint: c.pool.quoteMint,
      accountOwners: async (xs) => (await reader.accounts(xs, coherence?.context.paidSlot())).value.map((x) => x?.owner ?? null) })).variant);
    feedIds.set(i, await deriveMimirV1ClassicFeedId(c.baseMint, c.pool.quoteMint, variant));
    if (next || action !== 'review-next-step') continue;
    const { state } = await receiptState(rpc, receipts, coherence?.context, observations => publish?.(id, observations));
    if (state === 'finalized' || state === 'confirmed') {
      if (state === 'confirmed') allFinal = false;
      continue;
    }
    if (state === 'pending' || state === 'blocked') { action = state === 'pending' ? 'await-finality' : 'blocked'; continue; }
    if (input.allowCollateralFunding) pending.push({ i, variant, receipts: state === 'retry' ? receipts : [], retry: state === 'retry' });
    else {
      const prepared = await prepareV1SimpleFeed(deps, childArgs(i, variant, state === 'retry' ? receipts : []));
      if (state === 'retry' && prepared.next) await assertV1Replacement(receipts[0]!, prepared.next.review as ReviewedCreate);
      drafts.set(id, prepared.canonicalDraftJson);
      if (state === 'retry') action = 'retry-once';
      next = wrap(id, prepared);
    }
  }
  const components: JourneyComponent[] = await Promise.all(input.components.map(async (c, i) => c.createClassic
    ? { feedId: feedIds.get(i)!, sourceConfig: (await findMimirV1SourceConfigAddress(program, feedIds.get(i)!, 0))[0], quantityX64: c.quantityX64 } : c));
  const existing = await Promise.all(input.components.filter((c) => !c.createClassic).map(async (c) => ({ feedId: c.feedId,
    feed: (await findMimirV1ClassicFeedPda(program, c.feedId))[0] })));
  const existingRead = existing.length ? (await reader.accounts(existing.map((c) => c.feed), coherence?.context.paidSlot())).value : [];
  const solQuotedFeeds = new Set(existing.flatMap((c, i) => existingRead[i]?.owner === program
    && rowQuote(decodeV1ClassicFeed(existingRead[i]!.data, c.feed)) === SOL_MINT ? [c.feedId] : []));
  const target = await compositeTarget(program, input, await orderedChildren(program, components), input.quoteMint !== SOL_MINT && input.components.some((c) =>
    c.createClassic ? c.createClassic.pool.quoteMint === SOL_MINT : solQuotedFeeds.has(c.feedId)));
  const rootReceipts = receiptsOf('root');
  const rootState = await receiptState(rpc, rootReceipts, undefined, observations => publish?.('root', observations));
  const terminal = !next && !pending.length && action === 'review-next-step' && ['confirmed', 'finalized'].includes(rootState.state);
  let remainingCosts: MimirBetaFundingCosts | null = null;
  if (input.allowCollateralFunding && action === 'review-next-step' && !terminal) {
    const projected = new Map<Address, ReturnType<typeof decodeV1ClassicFeed>>();
    const steps: FundingStep[] = [];
    let rootTolerance: string | undefined;
    const slot = BigInt(await ((coherence?.dependencies ?? deps).rpc as unknown as SlotRpc).getSlot({ commitment: 'confirmed' }).send());
    let fundingSlot = slot;
    for (const item of pending) {
      const d = await draftV1Classic(deps, childArgs(item.i, item.variant, item.receipts), coherence);
      projected.set(d.v1.feed, projectedClassic(d, input.authority, slot));
      drafts.set(`child:${item.i}` as OperationId, (await createDraftHash(d.draft)).canonicalDraftJson);
      steps.push({ core: d.core, specs: d.specs, protocolFeeLamports: 0n });
    }
    if (rootState.state === 'none' || rootState.state === 'retry') {
      const d = await draftV1Composite(deps, { ...input, components }, projected, coherence?.slot ?? slot, coherence);
      rootTolerance = d.tolerance;
      if (d.contextSlot > fundingSlot) fundingSlot = d.contextSlot;
      drafts.set('root', (await createDraftHash(d.draft)).canonicalDraftJson);
      // Paid children are historical receipts; only pending packets must match the root pricing frame.
      const rootBurn = d.specs.find((spec) => spec.kind === 'spl-token-burn-checked')!;
      for (const [index, item] of pending.entries()) {
        const burn = steps[index]!.specs.find((spec) => spec.kind === 'spl-token-burn-checked')!;
        if (burn.amountRaw !== computeMimirV1TickerTariff(d.priced.collateralAmountRaw, input.components[item.i]!.createClassic!.ticker, d.priced.tickerTierTenths)
          || burn.mint !== rootBurn.mint || burn.address !== rootBurn.address || burn.authority !== rootBurn.authority
          || burn.tokenProgram !== rootBurn.tokenProgram || burn.decimals !== rootBurn.decimals) {
          throw new ReviewIntentChangedError('Composite pricing changed; prepare a new review before purchasing collateral');
        }
      }
      steps.push(d);
    } else if (pending.length) {
      throw new ReviewIntentChangedError('Composite pricing changed; prepare a new review before purchasing collateral');
    }
    const ids: OperationId[] = [...pending.map(({ i }) => `child:${i}` as OperationId),
      ...(rootState.state === 'none' || rootState.state === 'retry' ? ['root' as const] : [])];
    const preview = { intentHash: intent.draftHash,
      state: { schema: 'mimir-beta-composite-journey-state' as const, version: 1 as const, intentHash: intent.draftHash,
        inputRevision: args.state?.inputRevision ?? 0, operations: await operationStates() },
      root: { feedId: target.feedId, feed: target.composite, identityAsset: input.identity.asset, ticker: input.ticker,
        stepIds: ['composite:activate' as const], fusedComposite: undefined as never },
      packets: ids.map((operationId) => ({ operationId, stepId: operationId === 'root' ? 'composite:activate' as const : 'classic:activate' as const,
        bytes: 0, accounts: 0, instructions: 0, signatures: 0 })) };
    remainingCosts = await requireFunding(coherence?.dependencies ?? deps, input, { draftHash: intent.draftHash, compositeJourney: preview }, steps, fundingSlot, coherence, rootTolerance);
  }
  if (action === 'review-next-step' && pending.length) {
    const { i, variant, receipts, retry } = pending[0]!;
    const prepared = await prepareV1SimpleFeed(deps, childArgs(i, variant, receipts));
    if (retry && prepared.next) await assertV1Replacement(receipts[0]!, prepared.next.review as ReviewedCreate);
    drafts.set(`child:${i}` as OperationId, prepared.canonicalDraftJson);
    if (retry) action = 'retry-once';
    next = wrap(`child:${i}` as OperationId, prepared);
  }
  if (!next && action === 'review-next-step') {
    const { state, slot } = rootState;
    if (state === 'pending' || state === 'confirmed' || state === 'blocked') action = state === 'blocked' ? 'blocked' : 'await-finality';
    else {
      const prepared = await prepareV1CompositeFeed(deps, { ...input, ...(coherence ? { fundingContext: coherence.context } : {}), fullCollateralPurchase: false, components, ...(state === 'none' ? {} : { receipts: rootReceipts }),
        ...(slot === undefined ? {} : { landedSlot: slot }) } as PrepareCompositeFeedArgs);
      drafts.set('root', prepared.canonicalDraftJson);
      if (prepared.next) {
        if (state === 'retry') await assertV1Replacement(rootReceipts[0]!, prepared.next.review as ReviewedCreate);
        next = wrap('root', prepared);
        if (state === 'retry') action = 'retry-once';
      } else action = state === 'finalized' && allFinal ? 'complete' : 'await-finality';
    }
  }
  const operations = await operationStates();
  const remaining = ids.filter((id) => !receiptsOf(id).length);
  const packet = (id: OperationId) => next?.operationId === id ? { bytes: next.preparedStep.transaction.serializedTransaction.length,
    accounts: next.preparedStep.transaction.packet.accountCount, instructions: next.preparedStep.transaction.packet.instructionCount,
    signatures: next.preparedStep.transaction.packet.signatureCount } : { bytes: 0, accounts: 0, instructions: 0, signatures: 0 };
  const [adminConfig] = await findMimirV1AdminConfigPda(program);
  const adminReader = new FinalizedRpcReader((coherence?.dependencies ?? deps).rpc as never, 'confirmed');
  const admin = terminal ? undefined : await decodeMimirBetaAdminContext(adminConfig, (await adminReader.accounts([adminConfig])).value[0]?.data ?? new Uint8Array());
  const tickers = remaining.map((id) => id === 'root' ? input.ticker : input.components[Number(id.slice(6))]!.createClassic!.ticker);
  return { schema: 'mimir-beta-prepared-composite-journey', version: 1, canonicalIntentJson: intent.canonicalDraftJson, intentHash: intent.draftHash,
    state: { schema: 'mimir-beta-composite-journey-state', version: 1, intentHash: intent.draftHash, inputRevision: args.state?.inputRevision ?? 0, operations },
    root: { feedId: target.feedId, feed: target.composite, identityAsset: input.identity.asset, ticker: input.ticker, stepIds: ['composite:activate'],
      fusedComposite: undefined as never },
    packets: remaining.map((operationId) => ({ operationId, stepId: operationId === 'root' ? 'composite:activate' : 'classic:activate', ...packet(operationId) })),
    action, reusedComponentIndexes: [], remainingCollateralRaw: terminal ? 0n : tickers.reduce((sum, t) => sum + computeMimirV1TickerTariff(admin!.collateralAmountRaw, t, admin!.tickerTierTenths), 0n),
    remainingOneCharActivations: tickers.filter((t) => t.length === 1).length, fundingCosts: remainingCosts, peakTemporaryLamports: remainingCosts ? 0n : null,
    retainedAccountRentLamports: remainingCosts?.accountRentLamports ?? null, next, childBatch: null };
}
