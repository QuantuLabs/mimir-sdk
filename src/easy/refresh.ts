import { Buffer } from "buffer";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { Address } from "@solana/kit";
import { buildMimirBetaComputeUnitLimitInstruction, MIMIR_BETA_COMPUTE_BUDGET_PROGRAM_ID } from "../beta/liveAbi.js";
import type { MimirBetaInstruction } from "../beta/types.js";
import { isMimirBetaCohortNotConverged } from "../chunkedAccounts.js";
import { compileMimirBetaTransactionV1 } from "../beta/transactionV1.js";
import { decodeV1ClassicFeed, decodeV1CompositeFeed, V1_COMPOSITE_MAGIC } from "../v1/decoders.js";
import type { prepareMimirV1ClassicRefresh } from "../v1/refresh.js";
import { decodePrice, DEFAULT_RPC, MimirError, MIMIR_PROGRAM_IDS, readFeeds, rpcCall, type MimirAccount, type MimirErrorCode, type Price, type PriceOptions } from "./price.js";

const MAX_COMPUTE_UNITS = 1_400_000;
const DEFAULT_IX_COMPUTE_UNITS = 200_000;

export type RefreshOptions = PriceOptions & { payer: string };

export type MimirRefresh = {
  /** Refresh instructions, in order, without any compute-budget instruction. */
  instructions: MimirBetaInstruction[];
  /** Compute units the refreshes need. */
  computeUnitLimit: number;
  /** Oldest slot the refreshes were planned at. */
  contextSlot: bigint;
};

const isComposite = (data: Uint8Array) => V1_COMPOSITE_MAGIC.every((b, i) => data[i] === b);

type Prepared = Awaited<ReturnType<typeof prepareMimirV1ClassicRefresh>>;

const prepareRefresh = async (connection: Connection, program: string, account: MimirAccount, payer: string): Promise<Prepared> => {
  const { prepareMimirV1ClassicRefresh, prepareMimirV1CompositeRefresh } = await import("../v1/refresh.js");
  const run = () => (isComposite(account.data)
    ? prepareMimirV1CompositeRefresh(connection, account.address as Address, payer as Address, { programId: program as Address })
    : prepareMimirV1ClassicRefresh(connection, account.address as Address, { programId: program as Address }));
  return run().catch((e) => (isMimirBetaCohortNotConverged(e) ? run() : Promise.reject(e)))
    .catch((e) => { throw MimirError.from(e, { program }); });
};

/** The in-tx refresh of one or several feeds (addresses or tickers), deduplicated, in the given order. Anyone can refresh. */
export async function refreshInstructions(feeds: string | readonly string[], opts: RefreshOptions): Promise<MimirRefresh> {
  const read = await readFeeds(typeof feeds === "string" ? [feeds] : feeds, opts);
  const connection = new Connection(read.rpc, "confirmed");
  const unique = [...new Map(read.accounts.map((a) => [a.address, a])).values()];
  const prepared = await Promise.all(unique.map((account) => prepareRefresh(connection, read.program, account, opts.payer)));
  const computeUnitLimit = prepared.reduce((sum, p) => sum + p.computeUnitLimit, 0);
  if (computeUnitLimit > MAX_COMPUTE_UNITS) {
    throw new MimirError("INVALID_INPUT", `these refreshes need ${computeUnitLimit} compute units, above the ${MAX_COMPUTE_UNITS} a transaction allows; split the feeds`, "never");
  }
  return {
    instructions: prepared.map((p) => p.instruction),
    computeUnitLimit,
    contextSlot: prepared.reduce((min, p) => (p.contextSlot < min ? p.contextSlot : min), prepared[0]!.contextSlot),
  };
}

type FreshPriceArgs<I> = RefreshOptions & { feeds: string | readonly string[]; instructions: readonly I[];
  /** Set the compute-unit limit from a simulation of the whole transaction (sigVerify off, never sent): the simulated units plus
   *  the planned refresh units, so a refresh that lands later and needs a full publish still fits. */
  simulate?: boolean };
type FreshPrice<I> = { instructions: I[]; computeUnitLimit: number; contextSlot: bigint };

/**
 * Your instructions behind a fresh Mimir price: one compute budget first, the refreshes, then your instructions with nothing in
 * between, so the consumer that follows the last refresh sees it at a fixed position. Your SetComputeUnitLimit is merged
 * (default 200,000 per instruction); your other compute-budget instructions move to the front. Takes SDK or web3.js
 * `TransactionInstruction`s and returns the same type.
 */
export async function withFreshPrice(args: FreshPriceArgs<MimirBetaInstruction>): Promise<FreshPrice<MimirBetaInstruction>>;
export async function withFreshPrice(args: FreshPriceArgs<TransactionInstruction>): Promise<FreshPrice<TransactionInstruction>>;
export async function withFreshPrice(args: FreshPriceArgs<MimirBetaInstruction | TransactionInstruction>):
  Promise<FreshPrice<MimirBetaInstruction | TransactionInstruction>> {
  const web3 = args.instructions.some((ix) => "programId" in ix);
  const own = args.instructions.map((ix): MimirBetaInstruction => ("programId" in ix ? {
    programAddress: ix.programId.toBase58() as Address, data: Uint8Array.from(ix.data),
    accounts: ix.keys.map((k) => ({ address: k.pubkey.toBase58() as Address, isSigner: k.isSigner, isWritable: k.isWritable })),
  } : ix));
  const refresh = await refreshInstructions(args.feeds, args);
  let out = mergeFreshPrice(refresh, own);
  if (args.simulate) {
    const read = { rpc: args.rpc ?? DEFAULT_RPC, program: args.program ?? MIMIR_PROGRAM_IDS.mainnet };
    const sim = await simulateTransaction(read, args.payer, out.instructions, []);
    if (sim.value.unitsConsumed === undefined) throw new MimirError("RPC", "simulation returned no unitsConsumed", "later");
    const computeUnitLimit = Math.min(MAX_COMPUTE_UNITS, sim.value.unitsConsumed + refresh.computeUnitLimit);
    out = { ...out, computeUnitLimit, instructions: [buildMimirBetaComputeUnitLimitInstruction(computeUnitLimit), ...out.instructions.slice(1)] };
  }
  return web3 ? { ...out, instructions: out.instructions.map(toWeb3Instruction) } : out;
}

/** The pure part of `withFreshPrice`. */
export function mergeFreshPrice(refresh: MimirRefresh, instructions: readonly MimirBetaInstruction[]) {
  const isBudget = (ix: MimirBetaInstruction) => ix.programAddress === MIMIR_BETA_COMPUTE_BUDGET_PROGRAM_ID;
  const limit = instructions.find((ix) => isBudget(ix) && ix.data[0] === 2);
  const own = instructions.filter((ix) => !isBudget(ix));
  const userUnits = limit ? new DataView(limit.data.buffer, limit.data.byteOffset).getUint32(1, true) : DEFAULT_IX_COMPUTE_UNITS * own.length;
  const computeUnitLimit = Math.min(MAX_COMPUTE_UNITS, refresh.computeUnitLimit + userUnits);
  const budget = instructions.filter((ix) => isBudget(ix) && ix.data[0] !== 2);
  return { instructions: [buildMimirBetaComputeUnitLimitInstruction(computeUnitLimit), ...budget, ...refresh.instructions, ...own],
    computeUnitLimit, contextSlot: refresh.contextSlot };
}

/** A web3.js `TransactionInstruction` from an SDK instruction. */
export function toWeb3Instruction(ix: MimirBetaInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.address), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data),
  });
}

type Simulation = { context: { slot: number }; value: { err: unknown; logs: string[] | null; unitsConsumed?: number;
  accounts: ({ owner: string; executable: boolean; data: [string, string] } | null)[] | null } };
type Read = { rpc: string; program: string };

const creatorOf = (account: MimirAccount) =>
  (isComposite(account.data) ? decodeV1CompositeFeed(account.data).config.creator : decodeV1ClassicFeed(account.data).owner.creator!) as string;

/** One Transaction v1 of these instructions, simulated with sigVerify off and never sent; the post-state of `addresses`. */
async function simulateTransaction(read: Read, payer: string, instructions: readonly MimirBetaInstruction[], addresses: readonly string[]): Promise<Simulation> {
  let bytes: Uint8Array;
  try {
    bytes = (await compileMimirBetaTransactionV1({ feePayer: payer as Address, recentBlockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 0n, instructions: [...instructions] })).serializedTransaction;
  } catch (e) {
    throw MimirError.from(e, { program: read.program });
  }
  const sim = await rpcCall<Simulation>(read.rpc, "simulateTransaction", [btoa(String.fromCharCode(...bytes)), { encoding: "base64", sigVerify: false,
    replaceRecentBlockhash: true, commitment: "confirmed", ...(addresses.length ? { accounts: { encoding: "base64", addresses } } : {}) }]);
  if (sim.value.err) throw MimirError.from({ message: JSON.stringify(sim.value.err), logs: sim.value.logs ?? [] }, { program: read.program, instructions });
  return sim;
}

/** One Transaction v1 holding these refreshes, simulated with sigVerify off; the post-state of each feed, `live: true`. */
async function simulateRefreshes(read: Read, payer: string, batch: readonly { account: MimirAccount; refresh: Prepared }[]): Promise<Price[]> {
  const units = batch.reduce((sum, b) => sum + b.refresh.computeUnitLimit, 0);
  const instructions = [buildMimirBetaComputeUnitLimitInstruction(Math.min(MAX_COMPUTE_UNITS, units)), ...batch.map((b) => b.refresh.instruction)];
  const addresses = batch.map((b) => b.account.address);
  const sim = await simulateTransaction(read, payer, instructions, addresses);
  return Promise.all(addresses.map(async (address, i) => {
    const price = await decodePrice(postAccount(sim, address, i), { slot: sim.context.slot, program: read.program });
    return { ...price, live: true };
  }));
}

const postAccount = (sim: Simulation, address: string, i: number): MimirAccount => {
  const post = sim.value.accounts?.[i];
  if (!post) throw new MimirError("RPC", "simulation returned no post-state", "later");
  return { address, owner: post.owner, executable: post.executable, data: Uint8Array.from(atob(post.data[0]), (c) => c.charCodeAt(0)) };
};

/** The feed account as its in-tx refresh would leave it now (simulated, never sent), with the simulation slot. Payer default: the creator. */
export async function simulateRefreshedAccount(read: Read, account: MimirAccount, payer = creatorOf(account)): Promise<{ account: MimirAccount; slot: bigint }> {
  const refresh = await prepareRefresh(new Connection(read.rpc, "confirmed"), read.program, account, payer);
  const instructions = [buildMimirBetaComputeUnitLimitInstruction(Math.min(MAX_COMPUTE_UNITS, refresh.computeUnitLimit)), refresh.instruction];
  const sim = await simulateTransaction(read, payer, instructions, [account.address]);
  return { account: postAccount(sim, account.address, 0), slot: BigInt(sim.context.slot) };
}

/**
 * What the in-tx refresh would record now, per feed: a Transaction v1 simulated with sigVerify off, never sent, no signature,
 * no fee. The payer defaults to the feed's creator, which always exists.
 */
export async function simulatePrice(feeds: string | readonly string[], opts: PriceOptions & { payer?: string } = {}): Promise<Price[]> {
  const read = await readFeeds(typeof feeds === "string" ? [feeds] : feeds, opts);
  const connection = new Connection(read.rpc, "confirmed");
  return Promise.all(read.accounts.map(async (account) => {
    const payer = opts.payer ?? creatorOf(account);
    const refresh = await prepareRefresh(connection, read.program, account, payer);
    return (await simulateRefreshes(read, payer, [{ account, refresh }]))[0]!;
  }));
}

const LIVE_CONCURRENCY = 4;

/**
 * Live prices of these feeds, keyed by address: their refreshes simulated in as few transactions as the compute and size limits
 * allow, at most 4 refreshes planned at once. A batch that fails is split; a feed whose refresh cannot be simulated is left out. Never throws.
 */
async function livePrices(read: Read, accounts: readonly MimirAccount[], payerOpt?: string): Promise<{ out: Map<string, Price>; failed: Map<string, MimirErrorCode> }> {
  const out = new Map<string, Price>(), failed = new Map<string, MimirErrorCode>();
  const fault = (feeds: readonly string[], e: unknown) => { const code = MimirError.from(e).code; feeds.forEach((f) => failed.set(f, typeof code === "string" ? code : "UNKNOWN")); };
  try {
    const payer = payerOpt ?? creatorOf(accounts[0]!);
    const connection = new Connection(read.rpc, { commitment: "confirmed", disableRetryOnRateLimit: true });
    const prepared: ({ account: MimirAccount; refresh: Prepared } | null)[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(LIVE_CONCURRENCY, accounts.length) }, async () => {
      for (let i = next++; i < accounts.length; i = next++) {
        prepared[i] = await prepareRefresh(connection, read.program, accounts[i]!, payer).then((refresh) => ({ account: accounts[i]!, refresh }),
          (e) => { fault([accounts[i]!.address], e); return null; });
      }
    }));
    const batches: { account: MimirAccount; refresh: Prepared }[][] = [];
    let units = MAX_COMPUTE_UNITS;
    for (const p of prepared) {
      if (!p) continue;
      if (units + p.refresh.computeUnitLimit > MAX_COMPUTE_UNITS) { batches.push([]); units = 0; }
      batches.at(-1)!.push(p); units += p.refresh.computeUnitLimit;
    }
    const run = async (batch: typeof batches[number]): Promise<void> => {
      try {
        for (const price of await simulateRefreshes(read, payer, batch)) out.set(price.feed, price);
      } catch (e) {
        if ((e as MimirError).code !== "RPC" && batch.length > 1) await Promise.all([run(batch.slice(0, batch.length >> 1)), run(batch.slice(batch.length >> 1))]);
        else fault(batch.map((b) => b.account.address), e);
      }
    };
    await Promise.all(batches.map(run));
  } catch (e) { fault(accounts.map((a) => a.address).filter((a) => !out.has(a)), e); }
  return { out, failed };
}

export type GetPriceOptions = PriceOptions & {
  /** Default true: a feed not "fresh" in storage is returned as its refresh would record it now (`live: true`). False reads storage only. */
  live?: boolean;
  /** Fee payer of the simulation; default the creator of the first feed that needs a live simulation (`simulatePrice`: each feed's own creator). */
  payer?: string;
};

/**
 * Current prices of several feeds or tickers, read in one slot. A feed not "fresh" in storage is simulated live; if that
 * simulation fails, its stored price and status are returned with `liveError`.
 */
export async function getPrices(list: readonly string[], opts: GetPriceOptions = {}): Promise<Price[]> {
  const read = await readFeeds(list, opts);
  const stored = await Promise.all(read.accounts.map(async (account, i) => {
    const price = await decodePrice(account, { slot: read.slot, program: read.program });
    if (read.tickers[i] !== null && price.ticker !== read.tickers[i]) {
      throw new MimirError("TICKER_MISMATCH", `ticker ${read.tickers[i]} points at ${account.address} (${price.ticker})`, "never");
    }
    return price;
  }));
  if (opts.live === false) return stored;
  const todo = [...new Map(read.accounts.filter((_, i) => stored[i]!.status !== "fresh").map((a) => [a.address, a])).values()];
  if (!todo.length) return stored;
  const { out, failed } = await livePrices(read, todo, opts.payer);
  return mergeLivePrices(stored, new Set(todo.map((a) => a.address)), out, failed);
}

/** @internal Live results over stored prices: only a feed that was read live can carry a `liveError`. */
export function mergeLivePrices(stored: readonly Price[], asked: ReadonlySet<string>, out: ReadonlyMap<string, Price>, failed: ReadonlyMap<string, MimirErrorCode>): Price[] {
  return stored.map((p) => out.get(p.feed) ?? (asked.has(p.feed) ? { ...p, liveError: failed.get(p.feed) ?? "UNKNOWN" } : p));
}

/** Current price of one feed address or ticker (`getPrice("SOL")`). Mainnet, no key; `{ rpc }` to use your own endpoint. */
export async function getPrice(feedOrTicker: string, opts: GetPriceOptions = {}): Promise<Price> {
  return (await getPrices([feedOrTicker], opts))[0]!;
}
