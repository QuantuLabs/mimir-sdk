import type { AccountInfo, Commitment, Connection, GetMultipleAccountsConfig, PublicKey } from "@solana/web3.js";
import { betaError, MimirBetaError } from "./beta/errors.js";

export const MAX_MULTIPLE_ACCOUNTS = 100;
export const MAX_COHORT_ATTEMPTS = 4;
export const COHORT_NOT_CONVERGED = "chunked read contexts did not converge";
/** Waits before cohort attempts 2, 3 and 4 after a Clock that disagrees with its own response context. */
export const COHORT_CLOCK_RETRY_DELAYS_MS = [200, 400, 800] as const;
let cohortSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** @internal Test hook: replaces the cohort retry wait. */
export const setCohortSleepForTests = (sleep: (ms: number) => Promise<void>) => { cohortSleep = sleep; };
/** Wait before cohort attempt `attempt` (1-based retry index) after an incoherent Clock. */
export const cohortClockRetryWait = (attempt: number) => cohortSleep(COHORT_CLOCK_RETRY_DELAYS_MS[attempt - 1]!);

/** Exact convergence-exhaustion refusal: the only RPC_CONTEXT_MISMATCH that a fresh preparation may resolve. */
export function isMimirBetaCohortNotConverged(error: unknown): error is MimirBetaError {
  return error instanceof MimirBetaError && error.code === "RPC_CONTEXT_MISMATCH" && error.message === `RPC_CONTEXT_MISMATCH:${COHORT_NOT_CONVERGED}`;
}

export function chunkAddresses<T>(keys: readonly T[], size = MAX_MULTIPLE_ACCOUNTS): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < keys.length; index += size) out.push(keys.slice(index, index + size));
  return out.length ? out : [[]];
}

export function requireChunkLength<T>(value: unknown, chunk: readonly unknown[]): T[] {
  if (!Array.isArray(value) || value.length !== chunk.length) betaError("RPC_CONTEXT_MISMATCH", "incomplete coherent read");
  return value as T[];
}

/** Reads every chunk concurrently at a shared floor; accepts only a cohort where all chunks report one slot. */
export async function readCoherentChunks<K, V>(keys: readonly K[], minContextSlot: bigint | undefined,
  read: (chunk: K[], minContextSlot: bigint | undefined) => Promise<{ slot: bigint; value: unknown; coherent?: boolean }>): Promise<{ slot: bigint; value: V[] }> {
  const result = await readCoherentPartitions<K, V>([keys], minContextSlot, (chunk, floor) => read(chunk, floor));
  return { slot: result.slot, value: result.value[0]! };
}

export async function readCoherentPartitions<K, V>(partitions: readonly (readonly K[])[], minContextSlot: bigint | undefined,
  read: (chunk: K[], minContextSlot: bigint | undefined, partition: number) => Promise<{ slot: bigint; value: unknown; coherent?: boolean; clockSlot?: bigint }>,
  handOffOnSlotDisagreement?: () => boolean): Promise<{ slot: bigint; value: V[][] }> {
  const active = partitions.map((keys, index) => ({ keys, index })).filter(({ keys }) => keys.length > 0);
  const plan = (active.length ? active : partitions.slice(0, 1).map((keys) => ({ keys, index: 0 })))
    .flatMap(({ keys, index }) => chunkAddresses(keys).map((chunk) => ({ chunk, index })));
  let floor = minContextSlot;
  let responses: { slot: bigint; value: unknown; coherent?: boolean; clockSlot?: bigint }[] = [];
  for (let attempt = 0; attempt < MAX_COHORT_ATTEMPTS; attempt++) {
    if (attempt > 0 && !responses.length) await cohortClockRetryWait(attempt);
    await Promise.all(plan.map(async ({ chunk, index }, ordinal) => {
      const previous = responses[ordinal];
      if (previous && previous.slot === floor && previous.coherent !== false) return;
      const response = await read(chunk, floor, index);
      if (floor !== undefined && response.slot < floor) betaError("RPC_CONTEXT_MISMATCH", "context regressed");
      requireChunkLength(response.value, chunk);
      responses[ordinal] = response;
    }));
    let max = responses[0]!.slot;
    for (const response of responses) {
      if (response.slot > max) max = response.slot;
    }
    if (responses.every((response) => response.slot === max && response.coherent !== false)) {
      const value: V[][] = partitions.map(() => []);
      responses.forEach((response, index) => value[plan[index]!.index]!.push(...(response.value as V[])));
      return { slot: max, value };
    }
    if (handOffOnSlotDisagreement && responses.some((response) => response.slot !== max) && handOffOnSlotDisagreement()) break;
    if (floor === undefined || max > floor) floor = max;
    const clocks = responses.filter((response) => response.coherent === false);
    for (const { clockSlot } of clocks) if (clockSlot !== undefined && clockSlot > floor) floor = clockSlot;
    if (clocks.length) responses = [];
  }
  betaError("RPC_CONTEXT_MISMATCH", COHORT_NOT_CONVERGED);
}

export async function getMultipleAccountsInfoChunked<A = AccountInfo<Buffer>, C = Commitment | GetMultipleAccountsConfig>(
  connection: { getMultipleAccountsInfo(keys: PublicKey[], config?: C): Promise<(A | null)[]> },
  keys: readonly PublicKey[], config?: C): Promise<(A | null)[]> {
  if (keys.length <= MAX_MULTIPLE_ACCOUNTS) return connection.getMultipleAccountsInfo([...keys], config);
  const out: (A | null)[] = [];
  for (const chunk of chunkAddresses(keys)) out.push(...requireChunkLength<A | null>(await connection.getMultipleAccountsInfo(chunk, config), chunk));
  return out;
}

export async function getMultipleAccountsInfoAndContextChunked(connection: Pick<Connection, "getMultipleAccountsInfoAndContext">,
  keys: readonly PublicKey[], config: GetMultipleAccountsConfig): Promise<{ context: { slot: number }; value: (AccountInfo<Buffer> | null)[] }> {
  const clockAddress = "SysvarC1ock11111111111111111111111111111111";
  if (keys.length <= MAX_MULTIPLE_ACCOUNTS && !keys.some((key) => key.toBase58() === clockAddress)) {
    return connection.getMultipleAccountsInfoAndContext([...keys], config);
  }
  const result = await readCoherentChunks<PublicKey, AccountInfo<Buffer> | null>(keys,
    config.minContextSlot === undefined ? undefined : BigInt(config.minContextSlot), async (chunk, floor) => {
      const response = await connection.getMultipleAccountsInfoAndContext(chunk,
        { ...config, ...(floor === undefined ? {} : { minContextSlot: Number(floor) }) });
      requireChunkLength(response.value, chunk);
      const index = chunk.findIndex((key) => key.toBase58() === clockAddress);
      let coherent = true, clockSlot: bigint | undefined;
      if (index !== -1) {
        const clock = response.value[index];
        if (!clock || clock.executable || clock.owner.toBase58() !== "Sysvar1111111111111111111111111111111111111" || clock.data.length !== 40 ||
            clock.data.readBigInt64LE(32) < 0n) {
          betaError("RPC_CONTEXT_MISMATCH", "cohort Clock is not authentic", clockAddress);
        }
        // Retry the entire cohort, including Clock; never relabel bytes with another call's context.
        clockSlot = clock.data.readBigUInt64LE(0);
        coherent = clockSlot === BigInt(response.context.slot);
      }
      return { slot: BigInt(response.context.slot), value: response.value, coherent, clockSlot };
    });
  return { context: { slot: Number(result.slot) }, value: result.value };
}
