import { Buffer } from "buffer";
import { PublicKey, type Connection } from "@solana/web3.js";
import { address, type Address } from "@solana/kit";
import { addressBytes } from "../beta/bytes.js";
import { betaError, MimirBetaSimulationError, mimirBetaSimulationFailure, type MimirBetaError } from "../beta/errors.js";
import { deriveMimirBetaPda } from "../beta/abi.js";
import { decodeMimirBetaAdminContext } from "../beta/context.js";
import { withMimirBetaPoolBindingVariant } from "../beta/discovery.js";
import { classicRowExternals, freshAdapterAccounts, mimirClassicNativeRowReadiness, mimirDlmmRouteableEdgeArrays, nativeTailed,
  proveMimirBetaPreparationDrift } from "../beta/live.js";
import { MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS, type MimirFusedClassicRequest } from "../beta/classicExecution.js";
import type { MimirFusedDescriptor, MimirFusedRefreshRequest } from "../beta/compositeExecution.js";
import type { MimirBetaAccount, MimirBetaInstruction } from "../beta/types.js";
import type { MimirBetaEligiblePool } from "../beta/discovery.js";
import { meteoraDlmmFeeRatePpm, meteoraDlmmPointDepth, type MeteoraDlmmToken2022Binding } from "../internal/dlmmPointCore.js";
import { meteoraDlmmPriceFromIdX64 } from "../math.js";
import { classifyToken2022Mint } from "../token2022Clmm.js";
import { getMultipleAccountsInfoAndContextChunked } from "../chunkedAccounts.js";
import { createConnectionPlanningRpc, discoverExactExistingPool } from "../existingFeedRows.js";
import { derivePdaSync, mimirBetaCaptureScanDescriptors, type MimirVenueSchemaRepair } from "../beta/capture.js";
import { MIMIR_COND } from "../liveness.js";
import { decodeSourceConfigHeader, mimirExecutableGenerationPins, type MimirGenerationCluster } from "../internal/nativeMonoRefreshCore.js";
import * as C from "./layout/common.js";
import * as K from "./layout/classic.js";
import { mimirV1RefreshComputeUnitLimit } from "./cost.js";
import { decodeV1ClassicFeed, decodeV1CompositeFeed, type V1Descriptor, type V1Membership } from "./decoders.js";
import { buildMimirV1FusedClassicRefreshInstruction, buildMimirV1FusedCompositeRefreshInstruction, findMimirV1AdminConfigPda, findMimirV1RegistryPda,
  MIMIR_V1_MAINNET_PROGRAM_ID, mimirV1DirectDlmmWindow } from "./build.js";

const RING_NEWEST_SLOT = 64;

export interface MimirV1RefreshOptions {
  /** Default: the V1 mainnet program id. */
  readonly programId?: Address;
  /** Pool-family cluster (generation pins, capture layouts). Default `"mainnet"`. */
  readonly cluster?: MimirGenerationCluster;
  /** Default `"confirmed"`. */
  readonly commitment?: "confirmed" | "finalized";
  /** `publish` (default, `new = previous + 1`) or sample-only (`new = previous`, for maturing sampled/interval rows). */
  readonly mode?: "publish" | "sample";
  /** Sample-only: sign the exact CAS instead of the default ensure floors. */
  readonly exactSample?: boolean;
  /** Publish reuse window in slots; default `MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS`, capped on chain at the max snapshot age. */
  readonly maxReuseAgeSlots?: number;
  /**
   * Default `true`: a direct DLMM row whose visible window is clipped by its array edge and fails its floor gets the minimal canonical
   * neighbour array(s) appended after its base vector when they repair it locally. `false`: base-only vectors (programs or consumers
   * without row-local neighbour support). Mandatory routeable accounts are never affected.
   */
  readonly dlmmOptionalNeighbours?: boolean;
}

/** Planner row: `maxConfidenceBps` is the row's sealed feed policy, needed to plan a DLMM DUAL row's window (absent: base-only). */
export type MimirV1PlannerRow = Readonly<{ descriptor: V1Descriptor; source: Uint8Array; ring?: Uint8Array; maxConfidenceBps?: number }>;

export interface MimirV1PreparedRefresh {
  readonly instruction: MimirBetaInstruction;
  /** Compute-unit limit to request with `ComputeBudget.setComputeUnitLimit`. */
  readonly computeUnitLimit: number;
  /** Slot of the V1 account read. */
  readonly contextSlot: bigint;
  readonly mode: "publish" | "sample";
  /**
   * Rows (primary/component rows, then converter rows) the program refuses at this refresh as venue-unavailable (error 130, never
   * terminal): the venue's own disabled status, or an authenticated primary in an unsupported schema. The row keeps its ring and is
   * stamped `cond` (NOT_READY on a CLMM/CPMM/DLMM ring that is not point-only, else PAUSED); quorum, carry and NO_PRICE follow the feed
   * policy. Fold them into the publication prediction's `conditions`. Always set by the preparers; optional for other producers.
   */
  readonly unavailableRows?: readonly MimirV1UnavailableRow[];
  /** Diagnose this exact refresh after simulation or a terminally reconciled failed send; never sends or retries. */
  readonly preparationDrift?: (err: unknown, logs: unknown) => Promise<never>;
}

/** What the preparers return: `unavailableRows` is always set. */
export type MimirV1PreparedRefreshResult = MimirV1PreparedRefresh & { readonly unavailableRows: readonly MimirV1UnavailableRow[] };

export interface MimirV1UnavailableRow {
  readonly row: number;
  readonly reason: "venue-disabled" | "venue-schema";
  readonly cond: number;
}

export { mimirV1RefreshComputeUnitLimit };

const u64 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(at, true);
const u16 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(at, true);

async function readProgramAccount(connection: Connection, key: Address, programId: Address, commitment: "confirmed" | "finalized") {
  const { context, value } = await connection.getAccountInfoAndContext(new PublicKey(key), commitment);
  if (!value) return betaError("ACCOUNT_NOT_FOUND", "V1 account missing", key);
  if (value.owner.toBase58() !== programId) return betaError("ACCOUNT_OWNER_MISMATCH", "V1 account is not owned by the Mimir program", key);
  return { slot: BigInt(context.slot), data: Uint8Array.from(value.data) };
}

/**
 * The tag89/tag87 external vector of every row (primary/component rows, then converter rows), rebuilt from the row's sealed source
 * image: exact pool rediscovery, the family's live dynamic accounts (tick/bin arrays around the current price), the native tail and
 * the temporal/generation pins the descriptor needs. A full-membership row's bound prefix must equal its sealed tuples.
 * A direct DLMM row may carry up to two canonical neighbour bin arrays after its `externalWidth` base (see `dlmmOptionalNeighbours`).
 */
export async function mimirV1RowVectors(connection: Connection, rows: readonly MimirV1PlannerRow[],
  memberships: readonly V1Membership[], opts: Pick<MimirV1RefreshOptions, "cluster" | "commitment" | "dlmmOptionalNeighbours"> = {}): Promise<Address[][]> {
  return (await mimirV1RowPlan(connection, rows, memberships, opts)).vectors;
}

type VenueUnavailable = Readonly<{ reason: "venue-disabled"; enable: ReadonlyMap<string, Uint8Array> }> | Readonly<{ reason: "venue-schema" }>;

/** Program `VenueSourceUnavailable` for an authenticated venue primary (key and owner sealed in the source image): unsupported
 * allocation/discriminator, else its own disabled status (PumpSwap: GlobalConfig buy/sell or unknown disable flags). */
async function venueUnavailable(connection: Connection, cluster: MimirGenerationCluster, source: ReturnType<typeof decodeSourceConfigHeader>,
  commitment: "confirmed" | "finalized"): Promise<VenueUnavailable | null> {
  const program = address(new PublicKey(source.programId).toBase58()), pool = address(new PublicKey(source.poolOrMarket).toBase58());
  const pump = source.adapterType === 6 ? derivePdaSync(program, [new TextEncoder().encode("global_config")]) : null;
  const read = await getMultipleAccountsInfoAndContextChunked(connection, [pool, ...(pump ? [pump] : [])].map((k) => new PublicKey(k)), { commitment });
  const [primary, global] = read.value;
  if (!primary || primary.executable || primary.owner.toBase58() !== program) return null;
  const data = Uint8Array.from(primary.data);
  const descriptor = mimirBetaCaptureScanDescriptors(cluster === "mainnet" ? "mainnet-beta" : cluster).find((d) => d.programId === program &&
    d.allocationSize === data.length && (d.discriminator === null || d.discriminator.every((b, i) => data[d.discriminatorOffset + i] === b)));
  if (!descriptor) return { reason: "venue-schema" };
  const status = descriptor.status, enabled = Uint8Array.from(data), v = new DataView(enabled.buffer);
  if (status?.acceptedU64 && !status.acceptedU64.includes(v.getBigUint64(status.offset, true))) v.setBigUint64(status.offset, status.acceptedU64[0]!, true);
  else if (status?.disabledMask !== undefined) enabled[status.offset]! &= ~status.disabledMask;
  else if (status && !status.acceptedU64) enabled[status.offset] = status.enabled!;
  if (enabled.some((b, i) => b !== data[i])) return { reason: "venue-disabled", enable: new Map([[pool, enabled]]) };
  if (pump && global && !global.executable && global.owner.toBase58() === program && (global.data.length === 940 || global.data.length === 949) &&
      (global.data[56]! & ~0x07) !== 0) {
    const g = Uint8Array.from(global.data); g[56]! &= 0x07;
    return { reason: "venue-disabled", enable: new Map([[pump, g]]) };
  }
  return null;
}

/** The connection with the given accounts' venue status re-enabled: a disabled row's vector is the enabled one (no role reads the status). */
const withVenueEnabled = (connection: Connection, enable: ReadonlyMap<string, Uint8Array>): Connection => {
  const patch = <T extends { data: Buffer } | null>(key: PublicKey, info: T): T => {
    const data = info && enable.get(key.toBase58());
    return data ? { ...info, data: Buffer.from(data) } : info;
  };
  return new Proxy(connection, { get(target, name, receiver) {
    const value = Reflect.get(target, name, receiver);
    if (name === "getAccountInfo") return async (k: PublicKey, ...a: unknown[]) => patch(k, await (value as Function).call(target, k, ...a));
    if (name === "getAccountInfoAndContext") return async (k: PublicKey, ...a: unknown[]) => {
      const r = await (value as Function).call(target, k, ...a); return { ...r, value: patch(k, r.value) };
    };
    if (name === "getMultipleAccountsInfo") return async (ks: PublicKey[], ...a: unknown[]) =>
      ((await (value as Function).call(target, ks, ...a)) as never[]).map((x, i) => patch(ks[i]!, x));
    if (name === "getMultipleAccountsInfoAndContext") return async (ks: PublicKey[], ...a: unknown[]) => {
      const r = await (value as Function).call(target, ks, ...a); return { ...r, value: (r.value as never[]).map((x, i) => patch(ks[i]!, x)) };
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
};

/** The structural checks the program makes before an unsupported primary's error 130: the sealed membership tuples (address, owner,
 * executable), the source vaults owned by its token program and, beside a same-length DAMM v2 pool, of SPL token-account length. */
async function requireStoredRolesStructural(connection: Connection, source: ReturnType<typeof decodeSourceConfigHeader>, membership: V1Membership,
  stored: readonly Address[], commitment: "confirmed" | "finalized") {
  const key = (x: Uint8Array) => address(new PublicKey(x).toBase58());
  const pool = key(source.poolOrMarket), vaults = [key(source.baseVault), key(source.quoteVault)];
  const keys = [...new Set([pool, ...vaults, ...stored])];
  const read = await getMultipleAccountsInfoAndContextChunked(connection, keys.map((k) => new PublicKey(k)), { commitment });
  const at = (k: Address) => read.value[keys.indexOf(k)];
  for (const t of membership.tuples) {
    const a = at(t.address);
    if (!a || a.owner.toBase58() !== t.owner || a.executable !== t.executable) betaError("ACCOUNT_OWNER_MISMATCH", "V1 sealed membership account changed", t.address);
  }
  for (const v of vaults) {
    const a = at(v);
    if (!a || a.owner.toBase58() !== key(source.tokenProgram)) betaError("ACCOUNT_OWNER_MISMATCH", "capacity account owner mismatch", v);
    if (source.adapterType === 7 && at(pool)?.data.length === 1_112 && a.data.length !== 165) betaError("ACCOUNT_MALFORMED", "capacity account allocation mismatch", v);
  }
}

/** Exact rediscovery through `patch`, adding the supported-schema repair of every authenticated venue auxiliary discovery refuses
 * (program `VenueSourceUnavailable`: the row keeps its vector). Any other refusal throws. */
async function rediscover(connection: Connection, profile: Parameters<typeof discoverExactExistingPool>[1], source: ReturnType<typeof decodeSourceConfigHeader>,
  commitment: "confirmed" | "finalized", patch: Map<string, Uint8Array>) {
  for (;;) {
    try { return (await discoverExactExistingPool(patch.size ? withVenueEnabled(connection, patch) : connection, profile, source, commitment)).pool; }
    catch (error) {
      const repair = (error as { venueSchemaRepair?: MimirVenueSchemaRepair }).venueSchemaRepair, key = (error as MimirBetaError).address;
      const current = repair && key ? patch.get(key) ?? (await connection.getAccountInfo(new PublicKey(key), commitment))?.data : undefined;
      if (!current) throw error;
      const data = Uint8Array.from(current);
      for (const [at, bytes] of repair!) data.set(bytes, at);
      if (data.every((b, i) => b === current[i])) throw error;
      patch.set(key!, data);
    }
  }
}

const DLMM_BIN_ARRAY_DISCRIMINATOR = Uint8Array.of(92, 142, 92, 220, 5, 148, 70, 181);
/** Program `validate_meteora_dlmm_bin_array_data_v1` schema: allocation, discriminator, declared version 1..=3, zero padding. */
const dlmmBinArraySchemaRefused = (d: Uint8Array) => d.length !== 10_136 || DLMM_BIN_ARRAY_DISCRIMINATOR.some((b, i) => d[i] !== b) ||
  d[16]! < 1 || d[16]! > 3 || d.subarray(17, 24).some((b) => b !== 0);

const CLOCK = "SysvarC1ock11111111111111111111111111111111" as Address;
const i32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(at, true);
const i64 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getBigInt64(at, true);

/**
 * On-demand canonical neighbours of one direct DLMM row from one coherent cohort: `need` lists cohort keys still to read; otherwise
 * `suffix` is the minimal clipped deficient side(s) (lower before upper) when the visible window fails its floor and the authenticated
 * neighbours repair it locally without failing a known independent check, else empty.
 */
async function dlmmNeighbours(a: Readonly<{ kind: "legacy" | "point" | "dual"; pool: MimirBetaEligiblePool; vector: readonly Address[];
  source: ReturnType<typeof decodeSourceConfigHeader>; accounts: ReadonlyMap<Address, MimirBetaAccount | null>; observation: Address | null;
  maxConfidenceBps?: number; row: number; cluster: MimirGenerationCluster }>): Promise<Readonly<{ need: Address[] } | { suffix: Address[] }>> {
  const none = { suffix: [] }, { pool, accounts, source } = a;
  const pair = accounts.get(pool.pool), activeArray = accounts.get(a.vector[3 + pool.creation.adapterVersion]!);
  const [base, quote] = [accounts.get(a.vector[0]!), accounts.get(a.vector[1]!)];
  if (!pair || pair.data.length !== 904 || !activeArray || !base || !quote || base.data.length < 165 || quote.data.length < 165) return none;
  const active = i32(pair.data, 76), step = u16(pair.data, 80);
  const point = a.kind === "point" || a.kind === "dual" && (() => {
    const clock = accounts.get(CLOCK), observation = a.observation && accounts.get(a.observation);
    if (!clock) return undefined;
    try {
      return !(mimirClassicNativeRowReadiness({ row: a.row, pool, poolAccount: pair, observation: a.observation!, observationAccount: observation,
        nowUnix: i64(clock.data, 32), cluster: a.cluster, dual: true }).ready && Math.min(step, 10_000) <= a.maxConfidenceBps!);
    } catch { return undefined; }
  })();
  if (point === undefined) return none;
  const amount = (x: MimirBetaAccount) => new DataView(x.data.buffer, x.data.byteOffset).getBigUint64(64, true);
  if (base.data[108] === 2 || quote.data[108] === 2) return none;
  let fee: bigint;
  try { fee = meteoraDlmmFeeRatePpm(pair.data); } catch { return none; }
  const tokenXIsBase = addressBytes(pool.baseMint).every((b, i) => b === pair.data[88 + i]);
  const decimals = (mint: Address) => accounts.get(mint)?.data[44] ?? 0;
  const depth = (lowerArray: Uint8Array | null, upperArray: Uint8Array | null, token2022: MeteoraDlmmToken2022Binding | null = null) => meteoraDlmmPointDepth({
    activeArray: activeArray.data, active, binStep: step, tokenXIsBase, baseDecimals: decimals(pool.baseMint), quoteDecimals: decimals(pool.quoteMint),
    token2022, baseReserve: amount(base), quoteReserve: amount(quote), lowerArray, upperArray, legacy: !point });
  const floor = source.minDepthTo50BpsNative, minLiquidity = source.minLiquidityNative;
  const passes = (r: ReturnType<typeof depth>) => r.depth > 0n && r.depth >= floor && r.liquidity > 0n && r.liquidity >= minLiquidity &&
    r.depth * fee / 1_000_000n > 0n;
  let visible: ReturnType<typeof depth>, baseValue: bigint;
  try {
    visible = depth(null, null);
    const raw = meteoraDlmmPriceFromIdX64(active, step); baseValue = amount(base) * (tokenXIsBase ? raw : (1n << 128n) / raw) >> 64n;
  } catch { return none; }
  const local = active - Math.floor(active / 70) * 70, bin = (o: number) => new DataView(activeArray.data.buffer, activeArray.data.byteOffset).getBigUint64(56 + local * 144 + o, true);
  if (passes(visible) || (point ? !visible.twoSided : bin(0) === 0n && bin(8) === 0n) || amount(quote) < minLiquidity || baseValue < minLiquidity) return none;
  const target = [floor, minLiquidity, (1_000_000n + fee - 1n) / fee, 1n].reduce((m, v) => v > m ? v : m);
  const sides = [...(visible.clippedLower && visible.ySide < target ? [-1 as const] : []), ...(visible.clippedUpper && visible.xSide < target ? [1 as const] : [])];
  if (!sides.length) return none;
  const keys = await mimirDlmmRouteableEdgeArrays(pool, active, sides), t22 = pool.token2022Mint;
  // The Point guard of the enlarged window reads the mints' decimals (and the Token-2022 multiplier at chain time).
  const absent = [...keys, ...(point ? [pool.baseMint, pool.quoteMint, ...(t22 ? [CLOCK] : [])] : [])].filter((k) => !accounts.has(k));
  if (absent.length) return { need: absent };
  const arrays = keys.map((k, i) => {
    const x = accounts.get(k), index = Math.floor(active / 70) + sides[i]!;
    return x && x.owner === pool.programId && !x.executable && !dlmmBinArraySchemaRefused(x.data) && i64(x.data, 8) === BigInt(index) &&
      addressBytes(pool.pool).every((b, j) => b === x.data[24 + j]) ? x.data : null;
  });
  if (arrays.some((x) => !x)) return none;
  try {
    let token2022: MeteoraDlmmToken2022Binding | null = null;
    if (point && t22) {
      const c = classifyToken2022Mint({ account: accounts.get(t22)!, expectedMint: t22, expectedDecimals: decimals(t22), nowUnix: i64(accounts.get(CLOCK)!.data, 32) });
      if (c.conditions !== 0) return none;
      token2022 = { selectedBase: t22 === pool.baseMint, multiplierQ64: c.multiplierQ64 ?? 1n << 64n };
    }
    const r = depth(sides[0] === -1 ? arrays[0]! : null, sides.at(-1) === 1 ? arrays.at(-1)! : null, token2022);
    const [reserveX, reserveY] = tokenXIsBase ? [amount(base), amount(quote)] : [amount(quote), amount(base)];
    return passes(r) && reserveX >= r.sumX && reserveY >= r.sumY && (!point || r.guardOk) ? { suffix: keys as Address[] } : none;
  } catch { return none; }
}

/** The row vectors plus the rows the program will refuse as venue-unavailable (see `MimirV1PreparedRefresh.unavailableRows`). */
async function mimirV1RowPlan(connection: Connection, rows: readonly MimirV1PlannerRow[],
  memberships: readonly V1Membership[], opts: Pick<MimirV1RefreshOptions, "cluster" | "commitment" | "dlmmOptionalNeighbours"> = {},
  headerAccounts: readonly Address[] = []) {
  const cluster = opts.cluster ?? "mainnet"; const commitment = opts.commitment ?? "confirmed";
  const rpc = createConnectionPlanningRpc(connection);
  if (memberships.length !== rows.length) betaError("ACCOUNT_MALFORMED", "V1 memberships do not match the rows");
  const profile = { cluster } as Parameters<typeof discoverExactExistingPool>[1];
  const pins = mimirExecutableGenerationPins(cluster);
  const sources = rows.map((row) => decodeSourceConfigHeader(row.source));
  const discovered = await Promise.all(sources.map(async (source, i) => {
    const patch = new Map<string, Uint8Array>();
    try {
      const pool = await rediscover(connection, profile, source, commitment, patch);
      return { pool, patch, unavailable: patch.size ? { reason: "venue-schema" as const } : null };
    } catch (error) {
      const unavailable = await venueUnavailable(connection, cluster, source, commitment);
      if (!unavailable) throw error;
      if (unavailable.reason === "venue-disabled") {
        const enable = new Map(unavailable.enable);
        return { pool: await rediscover(connection, profile, source, commitment, enable), patch: enable, unavailable };
      }
      const m = memberships[i]!, width = rows[i]!.descriptor.externalWidth;
      const stored = !m.derived && m.tuples.length === width ? m.tuples.map((t) => t.address)
        : source.adapterType === 7 && width === 3 ? [source.baseVault, source.quoteVault, source.poolOrMarket].map((x) => address(new PublicKey(x).toBase58())) : null;
      if (!stored) throw error;
      await requireStoredRolesStructural(connection, source, m, stored, commitment);
      return { pool: null, patch: new Map<string, Uint8Array>(), unavailable, stored };
    }
  }));
  const patch = new Map(discovered.flatMap((d) => [...d.patch]));
  if (patch.size > 0) connection = withVenueEnabled(connection, patch);
  const reasons = discovered.map((d) => d.unavailable?.reason ?? null);
  const live = discovered.flatMap((d, i) => d.pool ? [{ i, pool: d.pool }] : []);
  const pools = live.map(({ i, pool }) =>
    pool.creation.adapterType === 3 && memberships[i]!.bindingVariant === 1 ? withMimirBetaPoolBindingVariant(pool, "routeable") : pool);
  const observations = await Promise.all(pools.map(async (pool, i) => {
    if (!nativeTailed(rows[live[i]!.i]!.descriptor as unknown as MimirFusedDescriptor)) return null;
    if (pool.creation.adapterType === 1) {
      return pool.readPlan.auxiliary.find((x) => x.role === "clmm-observation")?.address ?? betaError("PROGRAM_ABI_MISMATCH", "CLMM observation binding is missing", pool.pool);
    }
    return (await deriveMimirBetaPda({ programId: pool.programId, seed: "oracle", values: [addressBytes(pool.pool)] }))[0];
  }));
  const edges = await Promise.all(pools.map((pool) => pool.creation.bindingVariant === "routeable" ? mimirDlmmRouteableEdgeArrays(pool) : []));
  const kinds = live.map(({ i }) => {
    const kind = opts.dlmmOptionalNeighbours === false || memberships[i]!.bindingVariant === 1 ? null : mimirV1DirectDlmmWindow(rows[i]!.descriptor);
    return kind === "dual" && rows[i]!.maxConfidenceBps === undefined ? null : kind;
  });
  const descriptors = live.map(({ i }) => rows[i]!.descriptor as unknown as MimirFusedDescriptor);
  const nativeTails = observations.map((key, i) => key ? [key, ...(pools[i]!.creation.adapterType === 3 ? [pins.dlmm[0], pins.dlmm[1]] : [])] : []);
  const externals = (adapterAccounts: Address[][]) => classicRowExternals(descriptors,
    { adapterAccounts, cpmmPins: [pins.cpmm[0], pins.cpmm[1]], generationCluster: cluster });
  // Use the instruction vector builder itself for derived tail roles (including temporal/marker generation pins).
  const keys = [...new Set([...pools.flatMap((pool) => [pool.pool, ...pool.readPlan.allAddresses, ...(pool.creation.observationState ? [pool.creation.observationState] : [])]),
    ...edges.flat(), ...discovered.flatMap((d) => "stored" in d ? d.stored! : []), ...headerAccounts, ...externals(nativeTails).flat(),
    ...(kinds.includes("dual") ? [CLOCK] : [])])];
  const cohort = async (keys: readonly Address[]) => {
    const read = await getMultipleAccountsInfoAndContextChunked(connection, keys.map((k) => new PublicKey(k)), { commitment });
    const accounts = new Map<Address, MimirBetaAccount | null>(keys.map((k, i) => {
      const x = read.value[i];
      return [k, x ? { address: k, owner: address(x.owner.toBase58()), executable: x.executable, lamports: BigInt(x.lamports), data: Uint8Array.from(x.data) } : null];
    }));
    const built = externals(await Promise.all(pools.map(async (pool, i) => [...await freshAdapterAccounts(pool, accounts, true), ...nativeTails[i]!])));
    const neighbours = await Promise.all(kinds.map((kind, k) => kind ? dlmmNeighbours({ kind, pool: pools[k]!, vector: built[k]!, source: sources[live[k]!.i]!,
      accounts, observation: observations[k] ?? null, maxConfidenceBps: rows[live[k]!.i]!.maxConfidenceBps, row: live[k]!.i, cluster }) : { suffix: [] }));
    return { read, accounts, built, neighbours };
  };
  let { read, accounts, built, neighbours } = await cohort(keys);
  const need = [...new Set(neighbours.flatMap((x) => "need" in x ? x.need : []))];
  if (need.length) {
    // One expanded coherent read: the whole original cohort plus the requested neighbours, replanned from scratch.
    ({ read, accounts, built, neighbours } = await cohort([...keys, ...need]));
    if (neighbours.some((x) => "need" in x)) betaError("PLAN_STALE", "DLMM active bin array moved during neighbour acquisition; refresh the plan");
  }
  const vectors = discovered.map((d) => "stored" in d ? [...d.stored!] : []);
  built.forEach((v, k) => {
    const i = live[k]!.i, m = memberships[i]!;
    if (!m.derived && m.tuples.some((t, j) => v[j] !== t.address)) betaError("PLAN_STALE", `V1 row ${i} vector differs from its sealed membership`, pools[k]!.pool);
    const arrays = new Set([...pools[k]!.readPlan.auxiliary.flatMap((x) => x.role === "depth-bin-array" ? [x.address] : []), ...edges[k]!]);
    if (!reasons[i] && v.some((x) => { const a = arrays.has(x) ? accounts.get(x) : null; return a?.owner === pools[k]!.programId && dlmmBinArraySchemaRefused(a.data); })) {
      reasons[i] = "venue-schema";
    }
    const n = neighbours[k]!;
    vectors[i] = !reasons[i] && "suffix" in n && n.suffix.length ? [...v, ...n.suffix] : v;
  });
  const unavailableRows: MimirV1UnavailableRow[] = reasons.flatMap((reason, row) => {
    if (!reason) return [];
    // Program `ring_takes_not_ready` on the ring as the refusal leaves it: a blank private ring takes the source adapter type, a blank MTP4 ring stays blank.
    const ring = rows[row]!.ring ?? new Uint8Array(C.RING_LEN), mode = rows[row]!.descriptor.mode;
    const blank = ring.subarray(0, 8).every((b) => b === 0);
    const adapter = blank ? (mode === C.MODE_SAMPLED_INTERVAL || mode === C.MODE_CURRENT_POINT ? 0 : sources[row]!.adapterType) : ring[K.RING_OFFSET_ADAPTER_TYPE]!;
    const notReadyForm = [1, 2, 3].includes(adapter) && new DataView(ring.buffer, ring.byteOffset).getUint32(K.RING_OFFSET_FLAGS, true) === 0;
    return [{ row, reason, cond: notReadyForm ? MIMIR_COND.NOT_READY : MIMIR_COND.PAUSED }];
  });
  const preparationDrift = (instruction: MimirBetaInstruction) => {
    // Retry authority follows the final instruction, never a manually maintained subset of source roles.
    const cohort = new Map(instruction.accounts.filter((meta) => meta.address !== "11111111111111111111111111111111" &&
      meta.address !== "Sysvar1nstructions1111111111111111111111111").map(({ address }) => [address, accounts.get(address)]));
    return (err: unknown, logs: unknown) => proveMimirBetaPreparationDrift(rpc,
      new Map([...accounts].filter((entry): entry is [Address, MimirBetaAccount] => entry[1] !== null)),
      BigInt(read.context.slot), instruction.programAddress, commitment,
      new MimirBetaSimulationError(mimirBetaSimulationFailure(err, logs, instruction.programAddress, [instruction])), [instruction], pools, cohort);
  };
  return { vectors, unavailableRows, preparationDrift };
}

/** tag89 for a V1 Classic feed: one read of the feed account, then the per-row vectors (primary then converter). */
export async function prepareMimirV1ClassicRefresh(connection: Connection, feed: Address, opts: MimirV1RefreshOptions & Readonly<{
  /** Proof `EV_AGE`; default the feed's `max_snapshot_age_slots`. */
  declaredMaxSnapshotAge?: number;
}> = {}): Promise<MimirV1PreparedRefreshResult> {
  const programId = opts.programId ?? MIMIR_V1_MAINNET_PROGRAM_ID; const mode = opts.mode ?? "publish";
  const account = await readProgramAccount(connection, feed, programId, opts.commitment ?? "confirmed");
  const decoded = decodeV1ClassicFeed(account.data, feed);
  if (decoded.header.status !== C.STATUS_ACTIVE) betaError("PLAN_STALE", "V1 Classic feed is not active", feed);
  if (mode === "sample" && decoded.header.s === 0 && decoded.definition.planImage[K.PLAN_OFFSET_MIN_SOURCES]! >= decoded.header.n &&
      decoded.rows.every((r) => r.descriptor.moduleLen === 0)) betaError("INVALID_ARGUMENT", "V1 Classic feed has no sample-eligible row: this feed requires publish", feed);
  const confidence = (feedImage: Uint8Array) => u16(feedImage, K.CFG_OFFSET_MAX_CONFIDENCE_BPS);
  const rows = [...decoded.rows.map((r) => ({ ...r, maxConfidenceBps: confidence(decoded.definition.feedImage) })),
    ...(decoded.converter?.rows ?? []).map((r) => ({ ...r, maxConfidenceBps: confidence(decoded.converter!.definition.feedImage) }))];
  const [registry] = await findMimirV1RegistryPda(programId);
  const { vectors, unavailableRows, preparationDrift } = await mimirV1RowPlan(connection, rows, decoded.memberships, opts, [feed, registry]);
  const { feedImage, planImage } = decoded.definition;
  const previous = u64(decoded.prefix, K.OFFSET_SNAPSHOT_REVISION);
  const request: MimirFusedClassicRequest = {
    feedId: decoded.feedId, declaredMaxSnapshotAge: opts.declaredMaxSnapshotAge ?? u16(feedImage, K.CFG_OFFSET_MAX_SNAPSHOT_AGE_SLOTS),
    previousSnapshotRevision: previous, nextSnapshotRevision: mode === "publish" ? previous + 1n : previous,
    componentCount: decoded.header.n, sourceSetRevision: decoded.header.sourceSetRevision,
    planHash: Uint8Array.from(planImage.subarray(K.PLAN_OFFSET_PLAN_HASH, K.PLAN_OFFSET_PLAN_HASH + 32)),
    converterSourceCount: decoded.header.s, feedConfigRevision: u64(feedImage, K.CFG_OFFSET_FEED_CONFIG_REVISION),
    ringNewestSlots: rows.map((r) => u64(r.ring, RING_NEWEST_SLOT)),
    ...(mode === "sample" && opts.exactSample !== true ? { ensureSample: true } : {}),
    ...(mode === "publish" ? { maxReuseAgeSlots: opts.maxReuseAgeSlots ?? MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS } : {}),
  };
  const instruction = buildMimirV1FusedClassicRefreshInstruction({ programId, feed, registry, decoded, sourceAccounts: vectors, request });
  return { instruction, computeUnitLimit: mimirV1RefreshComputeUnitLimit(rows.length), contextSlot: account.slot, mode, unavailableRows, preparationDrift: preparationDrift(instruction) };
}

/** tag87 for a V1 composite: one read of the composite + AdminConfig (fee cap, treasury), then the per-row vectors. `payer` signs and pays the fee. */
export async function prepareMimirV1CompositeRefresh(connection: Connection, composite: Address, payer: Address,
  opts: MimirV1RefreshOptions = {}): Promise<MimirV1PreparedRefreshResult> {
  const programId = opts.programId ?? MIMIR_V1_MAINNET_PROGRAM_ID; const mode = opts.mode ?? "publish";
  const commitment = opts.commitment ?? "confirmed";
  const [[adminConfig], [registry]] = await Promise.all([findMimirV1AdminConfigPda(programId), findMimirV1RegistryPda(programId)]);
  const [account, adminAccount] = await Promise.all([readProgramAccount(connection, composite, programId, commitment),
    readProgramAccount(connection, adminConfig, programId, commitment)]);
  const decoded = decodeV1CompositeFeed(account.data, composite);
  if (decoded.header.status !== C.STATUS_ACTIVE) betaError("PLAN_STALE", "V1 composite is not active", composite);
  const admin = await decodeMimirBetaAdminContext(adminConfig, adminAccount.data);
  const converterRows = decoded.converter?.rows ?? [];
  const confidence = (feedImage: Uint8Array) => u16(feedImage, K.CFG_OFFSET_MAX_CONFIDENCE_BPS);
  const planned = [...decoded.rows.map((r) => ({ ...r, maxConfidenceBps: r.rowDef?.maxConfidenceBps ?? confidence(r.feedImage!) })),
    ...converterRows.map((r) => ({ ...r, maxConfidenceBps: confidence(decoded.converter!.definition.feedImage) }))];
  const { vectors, unavailableRows, preparationDrift } = await mimirV1RowPlan(connection, planned, decoded.memberships, opts,
    [payer, composite, registry, adminConfig, admin.feeTreasury]);
  const previous = decoded.snapshot.revision;
  const request: MimirFusedRefreshRequest = {
    compositeFeedId: decoded.config.feedId, expectedConfigRevision: decoded.config.configRevision,
    previousSnapshotRevision: previous, nextSnapshotRevision: mode === "publish" ? previous + 1n : previous,
    componentSourceConfigRevisions: decoded.rows.map((r) => decodeSourceConfigHeader(r.source).sourceConfigRevision),
    maxRefreshFeeLamports: mode === "publish" ? admin.compositeRefreshFeeLamports : 0n,
    componentRingNewestSlots: decoded.rows.map((r) => u64(r.ring, RING_NEWEST_SLOT)),
    converterRingNewestSlots: converterRows.map((r) => u64(r.ring, RING_NEWEST_SLOT)),
    ...(mode === "sample" && opts.exactSample !== true ? { ensureSample: true } : {}),
    ...(mode === "publish" ? { maxReuseAgeSlots: opts.maxReuseAgeSlots ?? MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS } : {}),
  };
  const n = decoded.rows.length;
  const instruction = buildMimirV1FusedCompositeRefreshInstruction({ programId, payer, composite, registry, adminConfig, treasury: admin.feeTreasury, decoded,
    componentAccounts: vectors.slice(0, n), converterAccounts: vectors.slice(n), request });
  return { instruction, computeUnitLimit: mimirV1RefreshComputeUnitLimit(vectors.length), contextSlot: account.slot, mode, unavailableRows, preparationDrift: preparationDrift(instruction) };
}
