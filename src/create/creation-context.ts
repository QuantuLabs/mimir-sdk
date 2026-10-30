import { ReviewIntentChangedError } from './errors.js';
import { authenticateMimirBetaReviewedStep, type MimirBetaStageReceipt, type MimirBetaConfirmedObservation } from '../beta/review.js';
import { decodeMimirBetaFinalizedTransactionResponse } from '../beta/rpc.js';
import type { MimirBetaFundingCosts as SdkFundingCosts } from '../beta/errors.js';
/** Last bank at which the selected F2 discount remains valid (inclusive). */
export type MimirBetaFundingCosts = SdkFundingCosts & { readonly creditValidThroughSlot?: bigint };
import type { Address } from '@solana/kit';

type AccountImage = Readonly<{ owner: Address; executable: boolean; lamports?: bigint; data: Uint8Array }>;
type AccountObserver = (key: string, args: unknown[], response: any) => Promise<void>;

type AdminTerms = Readonly<{ configRevision: bigint | string; collateralAmountRaw: bigint | string;
  collateralMint: string | null; collateralRequired: boolean; tickerTierTenths?: readonly number[];
  compositeActivationOwnerFeeLamports?: bigint | string; compositeActivationTreasuryComponentFeeLamports?: bigint | string;
  compositeActivationTreasuryCreationFeeLamports?: bigint | string }>;
const keyOf = (value: unknown): string => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
const adminKey = (a: AdminTerms) => keyOf([a.configRevision, a.collateralMint, a.collateralRequired, a.collateralAmountRaw,
  a.tickerTierTenths, a.compositeActivationOwnerFeeLamports, a.compositeActivationTreasuryComponentFeeLamports,
  a.compositeActivationTreasuryCreationFeeLamports]);

/** In-memory authorization for one SOL journey. Unsigned restores must prepare it again. */
export class SolCreationContext {
  slot = 0n;
  creditValidThroughSlot: bigint | undefined;
  #selected = new Map<string, string>();
  #accounts = new Map<string, { slot: bigint; value: AccountImage | null }>();
  #accountObservers = new Set<AccountObserver>();
  #transactions = new Map<string, unknown>();
  #paid = new Map<string, { signature: string; burn: bigint; rent: bigint; network: bigint; protocol: bigint; slot: bigint }>();
  #paidRent = new Map<string, bigint>();

  paidSlot(signature?: string): bigint | undefined {
    const paid = [...this.#paid.values()].filter(p => signature === undefined || p.signature === signature);
    return paid.length ? paid.reduce((slot, p) => p.slot > slot ? p.slot : slot, 0n) : undefined;
  }
  rentCredit(address: string): bigint { return this.#paidRent.get(address) ?? 0n; }
  paidBurn(): bigint { return [...this.#paid.values()].reduce((sum, p) => sum + p.burn, 0n); }
  /** Called only after the SDK authenticates this receipt, transaction and matching post-state. No reads. */
  async settle(receipt: MimirBetaStageReceipt, observed: MimirBetaConfirmedObservation): Promise<boolean> {
    if ((observed.state !== 'finalized' && observed.state !== 'confirmed') || this.#selected.size === 0) return false;
    const { review } = await authenticateMimirBetaReviewedStep(receipt);
    const prior = this.#paid.get(review.feed);
    if (prior) {
      if (prior.signature !== receipt.signature) this.changed();
      return false;
    }
    // Only a packet selected by this journey can retire its outstanding authorization.
    if (!this.#selected.has('burn:' + review.feed)) return false;
    const burn = review.expectedWrites.find(w => w.proof.kind === 'spl-token-burn-checked')?.proof;
    if (burn?.kind !== 'spl-token-burn-checked') return false;
    const transaction = decodeMimirBetaFinalizedTransactionResponse(receipt.signature, this.#transactions.get(receipt.signature));
    if (!transaction || transaction.meta.err !== null || transaction.slot !== observed.observedSlot ||
        observed.signature !== receipt.signature || observed.messageHash !== receipt.messageHash ||
        observed.accountContextSlot < transaction.slot || observed.accountContextSlot < this.slot) this.changed();
    this.select('burn:' + review.feed, [burn.sourceTokenAccount, burn.mint, burn.authority, burn.decimals, BigInt(burn.amountRaw)]);
    const credits = new Map<string, bigint>();
    for (const write of review.expectedWrites) {
      const proof = write.proof;
      if (proof.kind !== 'account' || !proof.after.exists || proof.after.owner !== review.programId) continue;
      const image = this.#accounts.get(write.address);
      if (!image || image.slot < transaction.slot || !image.value || image.value.owner !== proof.after.owner ||
          image.value.executable !== proof.after.executable || image.value.lamports !== BigInt(proof.after.lamports) ||
          image.value.data.length !== proof.after.data.length) this.changed();
      const credit = BigInt(proof.after.lamports) - BigInt(proof.before.lamports);
      if (credit > 0n && !this.#paidRent.has(write.address)) credits.set(write.address, credit);
    }
    const rent = [...credits.values()].reduce((sum, n) => sum + n, 0n);
    const protocol = review.expectedWrites.reduce((sum, w) => sum + (w.proof.kind === 'lamports' && w.address !== review.authority &&
      BigInt(w.proof.programDeltaLamports) > 0n ? BigInt(w.proof.programDeltaLamports) : 0n), 0n);
    for (const [address, credit] of credits) this.#paidRent.set(address, credit);
    this.#paid.set(review.feed, { signature: receipt.signature, burn: BigInt(burn.amountRaw), rent, network: transaction.meta.fee, protocol, slot: transaction.slot });
    if (transaction.slot > this.slot) this.slot = transaction.slot;
    return true;
  }

  account(address: string): AccountImage | null | undefined { return this.#accounts.get(address)?.value; }
  #terms: { check: (slot: bigint) => boolean; diagnostic?: () => Record<string, unknown> }[] = [];
  #admin: string | undefined;
  #invalid = false;
  #firstRefusal: ReviewIntentChangedError | undefined;
  #checking: number | undefined;
  #current: (() => { head: bigint; admin: AdminTerms | null }) | undefined;
  #settle: (() => Promise<void>) | undefined;

  reprice() {
    this.#selected.clear(); this.#terms = []; this.#admin = undefined; this.#accountObservers.clear();
    this.creditValidThroughSlot = undefined; this.#invalid = false; this.#firstRefusal = undefined;
  }
  changed(reason: Record<string, unknown> = { origin: this.#checking === undefined ? 'context' : 'retained-check' }): never {
    this.#invalid = true;
    if (!this.#firstRefusal) {
      const error = new ReviewIntentChangedError('Creation terms changed or context regressed; prepare a new review');
      // Snapshot public authorization facts; later guards must not overwrite the first refusal.
      error.refusal = JSON.parse(keyOf({ ...reason, slot: this.slot, creditValidThroughSlot: this.creditValidThroughSlot,
        ...(this.#checking === undefined ? {} : { checkIndex: this.#checking }), selectedBindings: [...this.#selected], selectedAdmin: this.#admin }));
      this.#firstRefusal = error;
    }
    throw this.#firstRefusal;
  }
  select(key: string, value: unknown) {
    if (key.startsWith('burn:') && this.#paid.has(key.slice(5))) this.changed({ origin: 'settled-burn', key, observed: value });
    const next = keyOf(value), prior = this.#selected.get(key);
    if (prior !== undefined && prior !== next) this.changed({ origin: 'selection', key, selected: prior, observed: next });
    this.#selected.set(key, next);
  }
  admin(terms: AdminTerms) {
    const next = adminKey(terms);
    if (this.#admin !== undefined && next !== this.#admin) this.changed({ origin: 'admin', currentAdmin: next });
    this.#admin = next;
  }
  observe(slot: bigint) {
    if (slot < this.slot) this.changed({ origin: 'context-regression', observedSlot: slot });
    this.slot = slot;
    this.assertTerms();
  }
  retain(check: (slot: bigint) => boolean, endpoint?: bigint, diagnostic?: () => Record<string, unknown>) {
    this.#terms.push({ check, diagnostic });
    if (endpoint !== undefined && (this.creditValidThroughSlot === undefined || endpoint < this.creditValidThroughSlot)) this.creditValidThroughSlot = endpoint;
  }
  costs(costs: MimirBetaFundingCosts) {
    if (costs.observedSlot > this.slot) this.observe(costs.observedSlot);
    const paid = [...this.#paid.values()];
    const rent = paid.reduce((sum, p) => sum + p.rent, 0n), network = paid.reduce((sum, p) => sum + p.network, 0n),
      protocol = paid.reduce((sum, p) => sum + p.protocol, 0n);
    this.select('fees', [costs.identityLamports, costs.accountRentLamports + rent, costs.networkFeeLamports + network,
      costs.protocolFeeLamports + protocol, costs.totalLamports + rent + network + protocol]);
    this.retain(() => true, costs.creditValidThroughSlot);
    this.assertTerms();
  }
  authenticate(current: () => { head: bigint; admin: AdminTerms | null }, settle?: () => Promise<void>) { this.#current = current; this.#settle = settle; }
  /** One predicate at publication, every read, and both sides of each wallet await. */
  assertTerms(head?: bigint, admin?: AdminTerms | null) {
    const authenticated = this.#current?.();
    head = authenticated && (head === undefined || authenticated.head > head) ? authenticated.head : head ?? this.slot;
    if (authenticated) admin = authenticated.admin;
    const current = head > this.slot ? head : this.slot;
    this.slot = current;
    let failed: Record<string, unknown> | undefined;
    try {
      this.#terms.some(({ check, diagnostic }, index) => {
        this.#checking = index;
        failed = { origin: 'retained-check-threw', checkIndex: index };
        if (check(current)) { failed = undefined; return false; }
        failed = { origin: 'retained-check', checkIndex: index, ...diagnostic?.() };
        return true;
      });
    } catch {
      failed ??= { origin: 'retained-check-threw' };
    } finally { this.#checking = undefined; }
    if (this.#invalid || failed || this.creditValidThroughSlot !== undefined && current > this.creditValidThroughSlot ||
        admin !== undefined && this.#admin !== undefined &&
        (admin === null || adminKey(admin) !== this.#admin)) this.changed({
          origin: this.#invalid ? 'sticky' : this.creditValidThroughSlot !== undefined && current > this.creditValidThroughSlot ? 'F2-expired' : 'admin',
          currentAdmin: admin === undefined ? undefined : admin === null ? null : adminKey(admin), ...failed
        });
  }
  rpc<T extends object>(rpc: T, accounts?: AccountObserver, authorize = true): T {
    if (accounts && authorize) this.#accountObservers.add(accounts);
    return new Proxy(rpc, { get: (target, key) => {
      const method = Reflect.get(target, key);
      if (typeof method !== 'function') return method;
      if (!/^(get|is|simulate)/.test(String(key))) return method.bind(target);
      return (...args: unknown[]) => {
        const index = key === 'getSlot' || key === 'getLatestBlockhash' ? 0 : 1;
        const config = args[index] as { minContextSlot?: bigint } | undefined;
        const floor = config?.minContextSlot !== undefined && config.minContextSlot > this.slot ? config.minContextSlot : this.slot;
        // Status RPC accepts only searchTransactionHistory; never inject planning options.
        if (authorize && ['getMultipleAccounts', 'getAccountInfo', 'getSlot', 'getLatestBlockhash', 'getFeeForMessage', 'simulateTransaction', 'isBlockhashValid'].includes(String(key)))
          args[index] = { ...config, commitment: 'confirmed', minContextSlot: floor };
        const request = method.apply(target, args);
        return { ...request, send: async (...options: unknown[]) => {
          const response = await request.send(...options);
          if (authorize) await this.#settle?.();
          if (key === 'getTransaction' && response != null) this.#transactions.set(String(args[0]), response);
          // getSlot is a watermark, never account/simulation evidence.
          if (key === 'getSlot') {
            this.slot = BigInt(response) > this.slot ? BigInt(response) : this.slot;
            if (authorize) this.assertTerms();
            return this.slot;
          }
          // These RPCs have no response context. Transaction/block slots are historical, not bank watermarks.
          if (response?.context?.slot == null && ['getBlockHeight', 'getTransaction', 'getBlock', 'getFirstAvailableBlock',
              'getMinimumBalanceForRentExemption', 'getGenesisHash', 'getRecentPerformanceSamples'].includes(String(key))) return response;
          if (response?.context?.slot == null) this.changed({ origin: 'missing-context', method: key });
          const slot = BigInt(response.context.slot);
          if (authorize && (slot < floor || slot < this.slot)) this.changed({ origin: 'context-regression', method: key, observedSlot: slot, floor });
          // Only returned account pre-state is evidence. Simulation accounts are expected post-state.
          if (key === 'getMultipleAccounts' || key === 'getAccountInfo') {
            const keys = key === 'getMultipleAccounts' ? args[0] as string[] : [args[0] as string];
            const values = key === 'getMultipleAccounts' ? response.value : [response.value];
            keys.forEach((address, i) => {
              const prior = this.#accounts.get(address), value = values[i];
              if (prior && prior.slot > slot) return;
              const data = value?.data;
              this.#accounts.set(address, { slot, value: value == null ? null : { owner: value.owner, executable: value.executable,
                lamports: value.lamports === undefined ? undefined : BigInt(value.lamports), data: data instanceof Uint8Array ? data.slice()
                  : Array.isArray(data) && typeof data[0] === 'string' ? Uint8Array.from(atob(data[0]), c => c.charCodeAt(0)) : new Uint8Array() } });
            });
            if (authorize) for (const observer of this.#accountObservers) await observer(String(key), args, response);
          }
          if (authorize) this.observe(slot);
          else if (slot > this.slot) this.slot = slot;
          if (authorize) this.assertTerms();
          return response;
        } };
      };
    } });
  }
}
