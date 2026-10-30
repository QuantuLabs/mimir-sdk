import type { MimirBetaAccount } from '../beta/types.js';
import { MimirError, messageOf } from '../easy/error.js';
import type { MimirBetaUnsignedTransaction } from '../beta/review.js';
import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { SOL_QUOTE_MINT } from './helpers.js';
import { validateJupiterCollateralBuild } from './collateral-funding.js';
import { brandMimirCreateError } from './errors.js';

export type MimirCluster = 'mainnet-beta' | 'devnet' | 'localnet';
/** One Jupiter `GET /swap/v2/build` request: the five query params the build takes. */
export type SwapQuery = { taker: string; inputMint: string; outputMint: string; amount: bigint; slippageBps: number; signal?: AbortSignal; failFast?: boolean };
/** Returns Jupiter's GET /swap/v2/build JSON; the SDK validates and simulates it, it is never trusted. */
export type BuildSwap = (query: SwapQuery) => Promise<unknown>;

export const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
export const JUPITER_PROGRAM = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
export const U64_MAX = (1n << 64n) - 1n;
/** @internal */
export const PROBE_LAMPORTS = 1_000n;
export const SLIPPAGE_BPS = 100;
const BUILD_RATE_LIMIT_RETRIES = 12;
let rateLimitedUntil = 0;

/** @internal */
export class QuoteRateLimitedError extends Error {
  constructor(readonly retryAt: number) { super('Collateral quote provider is rate limited'); }
}
brandMimirCreateError('QuoteRateLimitedError', QuoteRateLimitedError);
let quoteSequence: Promise<void> = Promise.resolve();

export interface PreparedCollateralPurchase {
  readonly cluster: MimirCluster;
  readonly transaction: MimirBetaUnsignedTransaction;
  readonly authority: Address;
  readonly collateralMint: Address;
  readonly collateralTokenAccount: Address;
  readonly sourceTokenAccount: Address;
  readonly decimals: number;
  readonly shortfallRaw: bigint;
  readonly draftHash: string;
  readonly observedBalanceRaw: bigint;
  readonly accountMissing: boolean;
  readonly inputLamports: bigint;
  readonly minimumOutputRaw: bigint;
  readonly networkFeeLamports: bigint;
  readonly ataRentLamports: bigint;
  readonly remainingCreationLamports: bigint;
  readonly simulationSlot: bigint;
  /** Opaque renewal key: a renewal is admitted only under the same key. */
  readonly fingerprints: unknown;
}

/** @internal */
export function assertMessageInput(transaction: Pick<MimirBetaUnsignedTransaction, 'instructions'>, authority: Address, source: Address, inputLamports: bigint): void {
  const transfers = transaction.instructions.filter(({ programAddress, accounts, data }) =>
    programAddress === SYSTEM_PROGRAM && accounts[0]?.address === authority && accounts[1]?.address === source &&
    data.length === 12 && data[0] === 2 && data[1] === 0 && data[2] === 0 && data[3] === 0);
  if (transfers.length !== 1) throw new Error('Purchase message does not contain one exact SOL wrap transfer');
  let encoded = 0n;
  for (let i = 7; i >= 0; i -= 1) encoded = (encoded << 8n) | BigInt(transfers[0]!.data[4 + i]!);
  const routes = transaction.instructions.filter(({ programAddress, data }) =>
    programAddress === JUPITER_PROGRAM && data.length >= 16 && data[0] === 0xbb && data[1] === 0x64 &&
    data[2] === 0xfa && data[3] === 0xcc && data[4] === 0x31 && data[5] === 0xc4 &&
    data[6] === 0xaf && data[7] === 0x14);
  let routedInput = 0n;
  for (let i = 7; i >= 0; i -= 1) routedInput = (routedInput << 8n) | BigInt(routes[0]?.data[8 + i] ?? 0);
  if (encoded !== inputLamports || routes.length !== 1 || routedInput !== inputLamports) {
    throw new Error('Purchase receipt input differs from the exact signed message');
  }
}

export function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} is malformed`);
  return value as Record<string, unknown>;
}

export function uint(value: unknown, name: string): bigint {
  if (typeof value === 'bigint' && value >= 0n && value <= U64_MAX) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= U64_MAX) return BigInt(value);
  throw new Error(`${name} is malformed`);
}

export function rpcContext(value: unknown): { slot: bigint; value: unknown } {
  const result = object(value, 'RPC response');
  return { slot: uint(object(result.context, 'RPC context').slot, 'RPC context slot'), value: result.value };
}

export const confirmedFrom = (minContextSlot: bigint) => ({ commitment: 'confirmed' as const, minContextSlot });

export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function abortError(): Error {
  const error = new Error('Collateral quote request was aborted');
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function withQuoteSequence<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  const previous = quoteSequence;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  quoteSequence = previous.catch(() => undefined).then(() => gate);
  try {
    if (signal) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(abortError());
        if (signal.aborted) return reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        previous.then(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        });
      });
    } else await previous;
    throwIfAborted(signal);
    return await run();
  } finally {
    release();
  }
}

export function retryAfterMs(value: string | null, cap = 5_000): number {
  if (!value) return 2_000;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  return Math.min(cap, Math.max(0, Number.isFinite(delay) ? delay : 2_000));
}

/** @internal */
export function amountFor(required: bigint, input: bigint, guaranteedOutput: bigint): bigint {
  if (required <= 0n || input <= 0n || guaranteedOutput <= 0n) throw new Error('COLA quote cannot cover the required amount');
  const amount = (required * input + guaranteedOutput - 1n) / guaranteedOutput + 1n;
  // Route fees round discretely; leave one lamport of headroom for tiny inputs.
  if (amount <= 0n || amount > U64_MAX) throw new Error('SOL purchase amount exceeds u64');
  return amount;
}

export async function associatedTokenAddress(owner: Address, mint: Address): Promise<Address> {
  const encode = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({ programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [encode.encode(owner), encode.encode(TOKEN_PROGRAM), encode.encode(mint)] });
  return ata;
}

export function simulationAccount(accountAddress: Address, value: unknown): MimirBetaAccount | null {
  if (value === null) return null;
  const row = object(value, 'Simulated account');
  if (typeof row.owner !== 'string' || typeof row.executable !== 'boolean' || !Array.isArray(row.data) ||
      typeof row.data[0] !== 'string' || row.data[1] !== 'base64') throw new Error('Simulation returned malformed account data');
  const binary = atob(row.data[0]);
  if (btoa(binary) !== row.data[0]) throw new Error('Simulation returned noncanonical account data');
  const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return Object.freeze({ address: accountAddress, owner: address(row.owner), executable: row.executable,
    lamports: uint(row.lamports, 'simulated account lamports'), data });
}

/** @internal */
export async function buildQuote(args: {
  url: URL;
  /** The app backend wraps the build in `{ success, data }`; Jupiter returns it bare. */
  envelope: boolean;
  headers?: Record<string, string>;
  authority: Address;
  collateralMint: Address;
  amount: bigint;
  signal?: AbortSignal;
  failFast?: boolean;
}): Promise<unknown> {
  for (let retry = 0; retry <= BUILD_RATE_LIMIT_RETRIES; retry += 1) {
    if (args.failFast && Date.now() < rateLimitedUntil) throw new QuoteRateLimitedError(rateLimitedUntil);
    const url = new URL(args.url);
    for (const [key, value] of Object.entries({ taker: args.authority, inputMint: SOL_QUOTE_MINT,
      outputMint: args.collateralMint, amount: args.amount.toString(), slippageBps: String(SLIPPAGE_BPS), ...(args.envelope ? {} : { transactionVersion: '1' }) })) {
      url.searchParams.set(key, value);
    }
    const response = await globalThis.fetch(url, { method: 'GET', ...(args.headers ? { headers: args.headers } : {}), ...(args.signal ? { signal: args.signal } : {}) });
    throwIfAborted(args.signal);
    if (response.status === 429) rateLimitedUntil = Date.now() + retryAfterMs(response.headers.get('retry-after'), 60_000);
    if (response.status === 429 && args.failFast) throw new QuoteRateLimitedError(rateLimitedUntil);
    if (response.status === 429 && retry < BUILD_RATE_LIMIT_RETRIES) {
      await sleep(retryAfterMs(response.headers.get('retry-after')), args.signal);
      continue;
    }
    if (!response.ok) throw new Error('Collateral quote provider is unavailable');
    const body = object(await response.json(), 'Collateral quote response');
    throwIfAborted(args.signal);
    if (!args.envelope) return body;
    if (body.success !== true || !('data' in body)) throw new Error('Collateral quote provider returned no route');
    return body.data;
  }
  throw new Error('Collateral quote provider is rate limited');
}

export interface SizedCollateralRoute {
  readonly instructions: PreparedCollateralPurchase['transaction']['instructions'];
  readonly inputLamports: bigint;
  readonly minimumOutputRaw: bigint;
}

export type EstimateCollateralRoute = SizedCollateralRoute & Readonly<{ authority: Address; collateralMint: Address;
  collateralTokenAccount: Address; shortfallRaw: bigint; expiresAt: number }>;

/** @internal */
export async function sizeCollateralPurchaseQuote(args: {
  readonly buildSwap: BuildSwap;
  readonly authority: Address;
  readonly collateralMint: Address;
  readonly collateralTokenAccount: Address;
  readonly shortfallRaw: bigint;
  readonly maxInputLamports: bigint;
  readonly signal?: AbortSignal;
  readonly failFast?: boolean;
  readonly rate?: SizedCollateralRoute;
}): Promise<SizedCollateralRoute | null> {
  if (args.shortfallRaw === 0n) return null;
  if (args.shortfallRaw < 0n) throw new Error('COLA shortfall cannot be negative');
  return withQuoteSequence(args.signal, async () => {
    const quote = async (amount: bigint) => {
      throwIfAborted(args.signal);
      const raw = await args.buildSwap({ taker: args.authority, inputMint: SOL_QUOTE_MINT, outputMint: args.collateralMint,
        amount, slippageBps: SLIPPAGE_BPS, ...(args.signal ? { signal: args.signal } : {}), ...(args.failFast ? { failFast: true } : {}) })
        .catch((e: unknown) => { throwIfAborted(args.signal); throw e instanceof MimirError || e instanceof QuoteRateLimitedError ? e : new MimirError('SWAP_UNAVAILABLE', `the COLA swap route could not be built: ${messageOf(e)}`, 'later', { cause: e }); });
      throwIfAborted(args.signal);
      const validated = await validateJupiterCollateralBuild(raw, {
        authority: args.authority, collateralMint: args.collateralMint, collateralTokenAccount: args.collateralTokenAccount,
        requiredOutputRaw: 1n, maxInputLamports: args.maxInputLamports, slippageBps: SLIPPAGE_BPS
      });
      if (validated.inputLamports !== amount) throw new Error('Jupiter route input differs from the requested SOL amount');
      return validated;
    };
    const probe = args.rate ?? await quote(PROBE_LAMPORTS);
    let amount = amountFor(args.shortfallRaw, probe.inputLamports, probe.minimumOutputRaw);
    if (amount > args.maxInputLamports) throw new Error('Required COLA shortfall exceeds available SOL');
    let route = await quote(amount);
    for (let correction = 0; route.minimumOutputRaw < args.shortfallRaw && correction < 3; correction += 1) {
      const correctedAmount = amountFor(args.shortfallRaw, route.inputLamports, route.minimumOutputRaw);
      if (correctedAmount <= route.inputLamports || correctedAmount > args.maxInputLamports) {
        throw new Error('COLA quote cannot cover the required amount within the SOL balance');
      }
      const withHeadroom = correctedAmount + (correctedAmount * BigInt(SLIPPAGE_BPS) + 9_999n) / 10_000n;
      amount = withHeadroom <= args.maxInputLamports ? withHeadroom : correctedAmount;
      route = await quote(amount);
    }
    if (route.minimumOutputRaw < args.shortfallRaw) throw new Error('COLA quote minimum is below the required shortfall');
    return Object.freeze({ instructions: route.instructions, inputLamports: route.inputLamports,
      minimumOutputRaw: route.minimumOutputRaw });
  });
}
