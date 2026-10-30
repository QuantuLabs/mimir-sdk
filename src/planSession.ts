import { PublicKey, type AccountInfo, type BlockhashWithExpiryBlockHeight, type Commitment, type Connection, type RpcResponseAndContext } from "@solana/web3.js";
import { getMultipleAccountsInfoAndContextChunked } from "./chunkedAccounts.js";
import type { MimirPlanningReuse, MimirPrefetchedAccount } from "./beta/refreshPlanner.js";

export type { MimirPlanningReuse, MimirPrefetchedAccount };

type Served = { slot: number; info: AccountInfo<Buffer> | null };
type SessionConnection = Connection & { readonly [SESSION]: true };

const SESSION = Symbol("mimirPlanSession");
const learned = new Map<string, Set<string>>();
const SYSVAR_PREFIX = "Sysvar";
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const SYSVAR_OWNER = "Sysvar1111111111111111111111111111111111111";

function remember(key: string, address: string): void {
  let set = learned.get(key);
  if (!set) {
    if (learned.size >= 256) learned.clear();
    set = new Set();
    learned.set(key, set);
  }
  set.add(address);
}

function copy(info: AccountInfo<Buffer> | null): AccountInfo<Buffer> | null {
  return info && { ...info, data: Buffer.from(info.data) };
}

function prefetchedInfo(entry: MimirPrefetchedAccount): AccountInfo<Buffer> {
  return { data: Buffer.from(entry.data), owner: new PublicKey(entry.owner), executable: entry.executable ?? false,
    lamports: Number(entry.lamports ?? 0) };
}

function authenticClock(entry: MimirPrefetchedAccount): boolean {
  const data = Buffer.from(entry.data);
  return entry.owner === SYSVAR_OWNER && !entry.executable && data.length === 40 && data.readBigUInt64LE(0) === entry.slot && data.readBigInt64LE(32) >= 0n;
}

function plainCommitment(config: unknown, commitment: Commitment): boolean {
  if (config === undefined || config === commitment) return true;
  if (!config || typeof config !== "object") return false;
  const { commitment: value, minContextSlot, ...rest } = config as { commitment?: Commitment; minContextSlot?: number };
  return value === commitment && Object.keys(rest).length === 0 && (minContextSlot === undefined || typeof minContextSlot === "number");
}

/**
 * A per-plan view of `connection`: program-owned and executable accounts this target read last time are fetched in one
 * coherent read and served to single-account reads; a plain multi-account read is served only when every key is served at one
 * slot; one blockhash serves every simulation. Sysvars are served only to such multi-account reads, from the caller's prefetched
 * accounts at their slot (Clock only when authentic at it). Other accounts stay live.
 */
export function mimirPlanSession(connection: Connection, args: Readonly<{ programId: PublicKey; commitment: Commitment; key: string }> & MimirPlanningReuse): Connection {
  if ((connection as Partial<SessionConnection>)[SESSION]) return connection;
  const program = args.programId.toBase58();
  const learnKey = `${program}|${args.commitment}|${args.key}`;
  const base = connection;
  const served = new Map<string, Served>();
  const sysvars = new Map<string, Served>();
  const provided = args.prefetchedAccounts ? [...args.prefetchedAccounts] : [];
  const floor = provided.reduce((max, [, entry]) => entry.slot > max ? entry.slot : max, -1n);
  for (const [address, entry] of provided) {
    if (entry.slot !== floor || (address === CLOCK && !authenticClock(entry))) continue;
    (address.startsWith(SYSVAR_PREFIX) ? sysvars : served).set(address, { slot: Number(entry.slot), info: prefetchedInfo(entry) });
  }
  let ready: Promise<void> | null = null;
  const prefetch = () => ready ??= (async () => {
    const keys = [...learned.get(learnKey) ?? []].filter((address) => !served.has(address));
    if (!keys.length) return;
    try {
      const response = await getMultipleAccountsInfoAndContextChunked(base, keys.map((address) => new PublicKey(address)),
        { commitment: args.commitment, ...(floor >= 0n ? { minContextSlot: Number(floor) } : {}) });
      if (floor >= 0n && response.context.slot < Number(floor)) return;
      keys.forEach((address, index) => served.set(address, { slot: response.context.slot, info: response.value[index] ?? null }));
    } catch { /* live reads below */ }
  })();
  void prefetch();
  const floored = <C extends Commitment | { minContextSlot?: number } | undefined>(address: string, config: C): C => {
    if (floor < 0n || address.startsWith(SYSVAR_PREFIX)) return config;
    const object = typeof config === "object" ? config : { commitment: config ?? args.commitment, minContextSlot: undefined };
    const min = Math.max(object.minContextSlot ?? 0, Number(floor));
    return { ...object, minContextSlot: min } as C;
  };
  const eligible = (address: string, info: AccountInfo<Buffer> | null) =>
    !!info && !address.startsWith(SYSVAR_PREFIX) && (info.executable || info.owner.toBase58() === program);
  const servedAll = (keys: PublicKey[], config: unknown): RpcResponseAndContext<(AccountInfo<Buffer> | null)[]> | null => {
    const object = typeof config === "object" && config !== null
      ? Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)) as { minContextSlot?: number } : undefined;
    if (keys.length === 0 || !plainCommitment(object ?? config, args.commitment)) return null;
    const hits = keys.map((key) => served.get(key.toBase58()) ?? sysvars.get(key.toBase58()));
    const slot = hits[0]?.slot;
    if (slot === undefined || hits.some((hit) => hit?.slot !== slot) || (object?.minContextSlot ?? 0) > slot) return null;
    return { context: { slot }, value: hits.map((hit) => copy(hit!.info)) };
  };
  let blockhash: Promise<BlockhashWithExpiryBlockHeight> | null = args.recentBlockhash ? Promise.resolve({
    blockhash: args.recentBlockhash.blockhash, lastValidBlockHeight: Number(args.recentBlockhash.lastValidBlockHeight) }) : null;

  const session = Object.create(connection) as Connection & Record<PropertyKey, unknown>;
  Object.defineProperty(session, SESSION, { value: true });
  session.getAccountInfo = async function (this: Connection, key: PublicKey, config?: Parameters<Connection["getAccountInfo"]>[1]) {
    const address = key?.toBase58() ?? "";
    if (address && plainCommitment(config, args.commitment) && !address.startsWith(SYSVAR_PREFIX)) {
      await prefetch();
      const hit = served.get(address);
      const min = typeof config === "object" ? config.minContextSlot : undefined;
      if (hit && (min === undefined || hit.slot >= min)) return copy(hit.info);
    }
    const info = await base.getAccountInfo.call(this, key, floored(address, config));
    if (eligible(address, info)) remember(learnKey, address);
    return info;
  } as Connection["getAccountInfo"];
  session.getAccountInfoAndContext = async function (this: Connection, key: PublicKey, config?: Parameters<Connection["getAccountInfoAndContext"]>[1]) {
    const address = key?.toBase58() ?? "";
    if (address && plainCommitment(config, args.commitment) && !address.startsWith(SYSVAR_PREFIX)) {
      await prefetch();
      const hit = served.get(address);
      const min = typeof config === "object" ? config.minContextSlot : undefined;
      if (hit && (min === undefined || hit.slot >= min)) return { context: { slot: hit.slot }, value: copy(hit.info) };
    }
    const live = floored(address, config);
    const response = await base.getAccountInfoAndContext.call(this, key, live);
    const min = typeof live === "object" ? live.minContextSlot : undefined;
    if (min !== undefined && response.context.slot < min) throw new Error("MimirPlanSessionContextBelowFloor");
    if (eligible(address, response.value)) remember(learnKey, address);
    return response;
  } as Connection["getAccountInfoAndContext"];
  if (floor >= 0n) {
    session.getMultipleAccountsInfoAndContext = async function (this: Connection, keys: PublicKey[], config?: Parameters<Connection["getMultipleAccountsInfoAndContext"]>[1]) {
      await prefetch();
      const hit = servedAll(keys, config);
      if (hit) return hit;
      const live = floored("", config);
      const response = await base.getMultipleAccountsInfoAndContext.call(this, keys, live);
      if (response.context.slot < (live as { minContextSlot: number }).minContextSlot) throw new Error("MimirPlanSessionContextBelowFloor");
      return response;
    } as Connection["getMultipleAccountsInfoAndContext"];
    session.getMultipleAccountsInfo = async function (this: Connection, keys: PublicKey[], config?: Parameters<Connection["getMultipleAccountsInfo"]>[1]) {
      return (await session.getMultipleAccountsInfoAndContext.call(this, keys, config)).value;
    } as Connection["getMultipleAccountsInfo"];
  }
  session.getLatestBlockhash = function (this: Connection, config?: Parameters<Connection["getLatestBlockhash"]>[0]) {
    if (config !== undefined && config !== args.commitment && !(typeof config === "object" && plainCommitment(config, args.commitment))) {
      return base.getLatestBlockhash.call(this, config);
    }
    const pending = blockhash ??= base.getLatestBlockhash.call(this, config);
    pending.catch(() => { if (blockhash === pending) blockhash = null; });
    return pending.then((value) => ({ ...value }));
  } as Connection["getLatestBlockhash"];
  return session;
}
