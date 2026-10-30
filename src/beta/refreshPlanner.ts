import type { Address } from "@solana/kit";
import { addressBytes, base64, fromBase64 } from "./bytes.js";
import { mimirBetaRpcAccountBytes } from "./rpc.js";
import { MimirBetaStalePreparationError, betaError } from "./errors.js";
import type { MimirBetaPlanningRpc } from "./client.js";
import {
  buildMimirBetaComputeUnitLimitInstruction,
  MIMIR_BETA_COMPUTE_BUDGET_PROGRAM_ID,
  decodeMimirBetaLiveFeed,
} from "./liveAbi.js";
import {
  compileMimirBetaTransactionV1,
  MIMIR_BETA_TRANSACTION_V1_MAX_ACCOUNTS,
  MIMIR_BETA_TRANSACTION_V1_MAX_BYTES,
} from "./transactionV1.js";
import type { MimirBetaInstruction } from "./types.js";
import type { MimirFusedRecipe } from "./compositeExecution.js";
import type { MimirBetaClassicPublicationOutcome } from "./live.js";
import { decodeFeedSnapshotHeader, decodeLifecycleFeedConfigHeader, decodeMimirBrowserCompositePublication, decodeMimirBrowserCompositeSnapshotHeader } from "../internal/nativeMonoRefreshCore.js";
import { admitFrontier, validateFrontier } from "../frontier.js";
import { verifyFeedConfigForSnapshot, verifySnapshotConfidenceBounds, verifySnapshotHeaderPolicy } from "../internal/snapshotPolicyCore.js";
import { decodeMimirCompositeConfig } from "./codecs.js";
import { sha256 } from "@noble/hashes/sha256";
import type { FeedSnapshotHeader, SnapshotPolicy } from "../types.js";

export {
  buildMimirBetaComputeUnitLimitInstruction as mimirComputeUnitLimitInstruction,
  MIMIR_BETA_COMPUTE_BUDGET_PROGRAM_ID as MIMIR_REFRESH_COMPUTE_BUDGET_PROGRAM_ID,
};

export type MimirRefreshTarget =
  | { readonly kind: "classic"; readonly feedConfig: Address }
  | { readonly kind: "composite"; readonly compositeConfig: Address };

/** The consumer's actual instructions (program ids included) and its conservative CU cost. */
export interface MimirConsumer {
  readonly instructions: readonly MimirBetaInstruction[];
  readonly computeUnits: number;
  /** K: the oldest publication (Clock − slot) the consumer accepts on chain. Default 0. */
  readonly maxPublicationAgeSlots?: number;
  /** The consumer's own source-activity bound, applied on chain with the feed's. */
  readonly maxSourceActivityAgeSlots?: number;
  /** The consumer's on-chain reader policy; stored readiness applies it before `ready`. */
  readonly readerPolicy?: MimirConsumerReaderPolicy;
}

/**
 * Inputs of Mimir's reader beyond identity, revision and age: routeability, risk tier, counts, quality, notional vs the
 * stored cap, quote and anchor flags. `reader: "generic"` (default) is VerifySnapshot, which rejects sources 5/6/7.
 */
export interface MimirConsumerReaderPolicy {
  readonly reader?: "generic" | "mixed";
  readonly expectedRouteabilityStatus: number;
  readonly maxConfidenceBps: number;
  readonly maxDispersionBps: number;
  readonly notional: bigint;
  readonly minSourceCount?: number;
  readonly minVenueCount?: number;
  readonly minCorrelationGroupCount?: number;
  readonly minCoverageRatioBps?: number;
  /** `VerifyFlags` bits (AllowDepegQuote, AllowNativeException, RequireTierA). */
  readonly flags?: number;
  readonly expectedNativeExceptionHash?: Uint8Array;
  /** Mixed reader, sources 5/6: the consumer's stored-record wire-age and source-slot age limits. */
  readonly frontierMaxAge?: number;
  readonly frontierMaxSourceAgeSlots?: bigint;
}

export interface MimirTxEstimate { readonly accounts: number; readonly bytes: number; readonly computeUnits: number }

export interface MimirPublishCheck {
  readonly account: Address;
  readonly kind: "classic-snapshot" | "composite-csp";
  readonly slotOffset: number;
  readonly revisionOffset: number;
  readonly statusOffset: number;
  readonly expectedStatus: number;
  readonly validUntilSlotOffset: number;
  /** The consumer requires Clock − slot ≤ maxAgeSlots and valid_until ≥ Clock. */
  readonly maxAgeSlots: number;
  readonly snapshotSourceOffset?: number;
  readonly expectedSnapshotSource?: number;
  readonly capModelVersionOffset?: number;
  readonly expectedCapModelVersion?: number;
  /** The feed config (classic) or composite config the publication is verified against. */
  readonly config: Address;
}

export interface MimirRefreshTransaction { readonly instructions: readonly MimirBetaInstruction[]; readonly estimate: MimirTxEstimate }

/**
 * Send `refreshTransactions` one at a time, in order, each confirmed before the next is sent; then send the consumer.
 * `split`: the consumer accepts a publication at most `maxPublicationAgeSlots` (K ≥ 1) old.
 * A miss invalidates the consumer bytes: replan and rebuild; never resend the old consumer.
 */
export interface MimirRefreshExecution {
  readonly ordering: "confirmed-prep";
  readonly prepCommitment: "confirmed";
  readonly prepSequence: "in-order-each-confirmed";
  readonly maxPublicationAgeSlots: number;
  readonly onMiss: "replan";
}

interface MimirSplitPlanFields {
  readonly refreshTransactions: readonly MimirRefreshTransaction[];
  readonly publish: MimirPublishCheck;
  readonly execution: MimirRefreshExecution;
}

export type MimirRefreshPlan =
  | { readonly mode: "inline"; readonly instructions: readonly MimirBetaInstruction[]; readonly estimate: MimirTxEstimate; readonly publish: MimirPublishCheck }
  | ({ readonly mode: "split"; readonly estimate: MimirTxEstimate } & MimirSplitPlanFields);

/** Instructions that must share one transaction, with a conservative CU bound when one is known. */
export interface MimirRefreshUnit {
  readonly instructions: readonly MimirBetaInstruction[];
  readonly computeUnitBound?: number;
  /** Exact fused recipes and converter width of this unit's tag-87/88/89/90 rows, for ABI-1 capability checks. */
  readonly abi1?: Readonly<{ recipes: readonly MimirFusedRecipe[]; converterSourceCount: number }>;
}

/**
 * A feed's refresh group. `updates` may move to prep txs; `publish` is one atomic unit (classic: every
 * update + converter + publish; composite: the one tag-87 producer) that is never split.
 */
export interface MimirRefreshGroup {
  readonly updates: readonly MimirRefreshUnit[];
  readonly publish: MimirRefreshUnit;
  readonly check: Omit<MimirPublishCheck, "maxAgeSlots">;
  /** From the feed/composite config: max_snapshot_age_slots, and for composites max_component_snapshot_age_slots. */
  readonly ageLimits?: Readonly<{ maxSnapshotAgeSlots: number; maxComponentSnapshotAgeSlots?: number; maxSourceActivityAgeSlots?: number }>;
  /** Exact fused recipes of a tag-87/89 publish group and its converter width, for ABI-1 capability checks. */
  readonly abi1Recipes?: readonly MimirFusedRecipe[];
  readonly abi1ConverterSourceCount?: number;
  /** Publish with a row below its depth floor: the simulated tag-87/89 post-state (Fresh, or program-written Degraded), bound to the request. */
  readonly publication?: MimirCompositePublicationOutcome | MimirBetaClassicPublicationOutcome;
  /** Classify this refresh instruction's failure; authenticated account-vector drift rejects PREPARATION_STALE. A sent failure must first be terminally reconciled. */
  readonly preparationDrift?: (err: unknown, logs: unknown) => Promise<never>;
}

/** Simulated CSP post-state; `rowsMask` bit i = component i, bit 7 = converter; `belowFloorSources` uses the same bits. */
export type MimirCompositePublicationOutcome =
  | Readonly<{ status: "fresh" }>
  | Readonly<{ status: "degraded"; conditionFlags: number; rowsMask: number; powersMask: number; priceState: "with-price" | "no-price"; conditionedSources: number;
      belowFloorSources: readonly number[] }>;

/** The signed tag-87 request and simulation context a simulated CSP post-state must match. */
export interface MimirCompositePublicationBinding {
  readonly feedId: Uint8Array;
  readonly config: Address;
  readonly configRevision: bigint;
  /** The signed `previousSnapshotRevision`: the minimum landed revision (a same-slot re-observation returns Ok without writing; a reused Fresh publication may exceed it). */
  readonly minRevision: bigint;
  readonly contextSlot: bigint;
  readonly maxSnapshotAgeSlots: number;
  readonly maxComponentSnapshotAgeSlots: number;
}

/**
 * Fresh CSP, or the program's Degraded CSP (status 1, routeability 5, DEPTH_BELOW_FLOOR only, capacity 0, price kept), bound to
 * the request (feed id, config, config revision, revision ≥ signed minimum) and published at the simulation context; else throws.
 * A Degraded CSP carries its predecessor's (possibly expired) price clocks: only its publication clock is aged.
 */
export function mimirCompositePublicationOutcome(post: Uint8Array, belowFloorSources: readonly number[], b: MimirCompositePublicationBinding): MimirCompositePublicationOutcome {
  const need = (ok: boolean, why: string) => { if (!ok) throw new Error(`InvalidCompositePublication: ${why}`); };
  need(post.length === 720, "length");
  need(same(post, 16, b.feedId) && same(post, 48, addressBytes(b.config)) && u64(post, 88) === b.configRevision, "binding");
  need(u64(post, 96) >= b.minRevision, "revision");
  let degraded: ReturnType<typeof decodeMimirBrowserCompositePublication>["degraded"];
  try { ({ degraded } = decodeMimirBrowserCompositePublication(post)); } catch { return need(false, "shape") as never; }
  if (!degraded?.noPrice) {
    const c = b.contextSlot, p = u64(post, 112);
    need(p <= c && c - p <= BigInt(b.maxSnapshotAgeSlots) && (degraded !== null || c <= u64(post, 120)), "publication age/expiry");
    if (!degraded) for (const a of [u64(post, 136), u64(post, 144)]) need(a === 0n || (a <= c && c - a <= BigInt(b.maxComponentSnapshotAgeSlots)), "component age");
  }
  if (!degraded) return { status: "fresh" };
  const { conditionFlags, rowsMask, powersMask } = degraded;
  return { status: "degraded", conditionFlags, rowsMask, powersMask, priceState: degraded.noPrice ? "no-price" : "with-price", conditionedSources: rowsMask,
    belowFloorSources };
}

/** An account the caller already read at `slot`; entries older than the newest slot given are ignored. */
export interface MimirPrefetchedAccount {
  readonly data: Uint8Array;
  readonly slot: bigint;
  readonly owner: Address;
  readonly executable?: boolean;
  readonly lamports?: bigint | number;
}

/** Optional planning inputs a caller can share with Mimir so one read set and one blockhash serve plan and trade. */
export interface MimirPlanningReuse {
  readonly recentBlockhash?: Readonly<{ blockhash: string; lastValidBlockHeight: bigint | number }>;
  readonly prefetchedAccounts?: ReadonlyMap<string, MimirPrefetchedAccount>;
}

/** Builds a target's refresh group; `publication` resolves its check from PDAs alone so readiness can skip the build. */
export type MimirRefreshGroupBuilder = ((target: MimirRefreshTarget, reuse?: MimirPlanningReuse) => Promise<MimirRefreshGroup>) & {
  /** Maps the builder's own warming error to its recovery (beta instructions, per-source sampled projection). */
  readonly warmingRecovery?: (error: unknown) => Parameters<typeof mimirReadinessFromBuildError>[1];
  /** Complete standalone tag-88 BEGIN/GROW/SEAL closure for an existing CFC that has no execution state yet. */
  readonly compositeInitializer?: (compositeConfig: Address) => Promise<MimirCompositeInitializer>;
  /** Sample-only tag 89 (`new=previous`) for a classic feed whose private temporal rows are still maturing. */
  readonly classicSample?: (feedConfig: Address) => Promise<Pick<MimirRefreshGroup["publish"], "instructions">>;
  readonly publication?: (target: MimirRefreshTarget) => Promise<Pick<MimirRefreshGroup, "check" | "ageLimits"> & { expected: MimirPublicationBinding & { feedId: Uint8Array; configRevision: bigint } }>;
};

export interface MimirCompositeInitializer {
  readonly instructions: readonly MimirBetaInstruction[];
  readonly execution: Address;
  readonly exactLength: number;
  readonly growCount: number;
  /** True when a row's temporal window must mature before the first tag 87 can publish. */
  readonly temporalWarmupRequired: boolean;
}

export interface PlanMimirRefreshArgs extends MimirPlanningReuse {
  readonly programId: Address;
  readonly payer: Address;
  readonly target: MimirRefreshTarget;
  readonly consumer: MimirConsumer;
  readonly buildRefreshGroup: MimirRefreshGroupBuilder;
  /** When present, refresh CU is simulated; otherwise (or on failure) unit bounds are used, and missing bounds refuse. */
  readonly rpc?: MimirBetaPlanningRpc;
  readonly limits?: Readonly<{ maxAccounts?: number; maxTransactionBytes?: number; maxComputeUnits?: number }>;
  /** Size every tx with a TxV1 priority fee field. */
  readonly priorityFee?: boolean;
}

export const MIMIR_REFRESH_MAX_COMPUTE_UNITS = 1_400_000;

/** The caller's reuse handed to the builder. */
function planningReuse(args: PlanMimirRefreshArgs): MimirPlanningReuse | undefined {
  if (!args.recentBlockhash && !args.prefetchedAccounts) return undefined;
  return { ...(args.recentBlockhash ? { recentBlockhash: args.recentBlockhash } : {}), ...(args.prefetchedAccounts ? { prefetchedAccounts: args.prefetchedAccounts } : {}) };
}
const DUMMY_BLOCKHASH = "11111111111111111111111111111111";

function assertConsumer(consumer: MimirConsumer): void {
  if (!consumer || !Array.isArray(consumer.instructions) || !consumer.instructions.length ||
      !Number.isSafeInteger(consumer.computeUnits) || consumer.computeUnits < 0 ||
      [consumer.maxPublicationAgeSlots, consumer.maxSourceActivityAgeSlots].some((x) => x !== undefined && (!Number.isSafeInteger(x) || x < 0))) {
    betaError("INVALID_ARGUMENT", "consumer is malformed");
  }
}

type Simulation = { err?: unknown; unitsConsumed?: bigint | number; logs?: readonly string[] };
type Blockhash = Readonly<{ blockhash: string; lastValidBlockHeight: bigint | number }>;

/** One blockhash per plan: the caller's, else the first confirmed one fetched. */
function planBlockhash(args: PlanMimirRefreshArgs): () => Promise<Blockhash> {
  let pending: Promise<Blockhash> | null = args.recentBlockhash ? Promise.resolve(args.recentBlockhash) : null;
  return () => {
    const current = pending ??= Promise.resolve().then(() => args.rpc!.getLatestBlockhash({ commitment: "confirmed" }).send())
      .then((latest) => { const v = (latest as { value?: Partial<Blockhash> }).value; return { blockhash: String(v?.blockhash), lastValidBlockHeight: v?.lastValidBlockHeight ?? 0 }; });
    current.catch(() => { if (pending === current) pending = null; });
    return current;
  };
}

/** Simulates `instructions` under the TxV1 config; null when the instructions do not compile as one tx. */
async function simulateRaw(rpc: MimirBetaPlanningRpc, payer: Address, instructions: readonly MimirBetaInstruction[],
  blockhash: () => Promise<Blockhash>): Promise<Simulation | null> {
  const latest = await blockhash();
  let tx;
  try {
    tx = await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: latest.blockhash,
      lastValidBlockHeight: BigInt(latest.lastValidBlockHeight), instructions });
  } catch { return null; }
  const sim = await rpc.simulateTransaction(base64(tx.serializedTransaction), { commitment: "confirmed", encoding: "base64", sigVerify: false,
    replaceRecentBlockhash: false }).send() as { value?: Simulation };
  return sim.value ?? null;
}

interface Limits { readonly accounts: number; readonly bytes: number; readonly cu: number }

class Estimator {
  private readonly cache = new Map<string, number | null>();
  constructor(private readonly args: PlanMimirRefreshArgs, private readonly limits: Limits, readonly blockhash = planBlockhash(args)) {}

  private async simulate(instructions: readonly MimirBetaInstruction[]): Promise<number | null> {
    const rpc = this.args.rpc; if (!rpc) return null;
    const key = instructions.map((ix) => ix.programAddress + ix.accounts.map((a) => a.address).join() + Array.from(ix.data).join()).join("|");
    if (this.cache.has(key)) return this.cache.get(key)!;
    let units: number | null = null;
    try {
      const sim = await simulateRaw(rpc, this.args.payer, instructions, this.blockhash);
      if (sim && sim.err === null && sim.unitsConsumed !== undefined) units = Number(sim.unitsConsumed);
    } catch { /* bounds below */ }
    this.cache.set(key, units);
    return units;
  }

  async refreshUnits(units: readonly MimirRefreshUnit[]): Promise<number> {
    if (!units.length) return 0;
    const simulated = await this.simulate(units.flatMap((u) => u.instructions)); if (simulated !== null) return simulated;
    if (units.some((u) => u.computeUnitBound === undefined)) betaError("SIMULATION_FAILED", "refresh CU unknown: no successful simulation and no conservative bound");
    return units.reduce((sum, u) => sum + u.computeUnitBound!, 0);
  }

  /** Exact compiled estimate of `units` followed by the consumer's instructions; null when it does not fit. */
  async fit(units: readonly MimirRefreshUnit[], consumer?: MimirConsumer): Promise<MimirTxEstimate | null> {
    const instructions = [...units.flatMap((u) => u.instructions), ...(consumer?.instructions ?? [])];
    let packet;
    try {
      packet = (await compileMimirBetaTransactionV1({ feePayer: this.args.payer, recentBlockhash: DUMMY_BLOCKHASH, lastValidBlockHeight: 0n,
        instructions, ...(this.args.priorityFee ? { priorityFeeLamports: 0n } : {}) })).packet;
    } catch { return null; }
    if (packet.accountCount > this.limits.accounts || packet.serializedTransactionBytes > this.limits.bytes) return null;
    const computeUnits = await this.refreshUnits(units) + (consumer?.computeUnits ?? 0);
    if (computeUnits > this.limits.cu) return null;
    return { accounts: packet.accountCount, bytes: packet.serializedTransactionBytes, computeUnits };
  }
}

/** Partition atomic units, in order, into the fewest consecutive txs that each fit the limits. */
export async function partitionMimirRefreshUnits(units: readonly MimirRefreshUnit[],
  fit: (units: readonly MimirRefreshUnit[]) => Promise<MimirTxEstimate | null>): Promise<MimirRefreshTransaction[]> {
  const out: MimirRefreshTransaction[] = [];
  const close = (group: readonly MimirRefreshUnit[], estimate: MimirTxEstimate) =>
    out.push({ instructions: group.flatMap((u) => u.instructions), estimate });
  let current: MimirRefreshUnit[] = []; let estimate: MimirTxEstimate | null = null;
  for (const unit of units) {
    const next = [...current, unit]; const nextEstimate = await fit(next);
    if (nextEstimate) { current = next; estimate = nextEstimate; continue; }
    if (current.length) close(current, estimate!);
    const alone = await fit([unit]);
    if (!alone) betaError("TRANSACTION_TOO_LARGE", "an atomic Mimir refresh unit does not fit one transaction");
    current = [unit]; estimate = alone;
  }
  if (current.length) close(current, estimate!);
  return out;
}

/**
 * Plan a Mimir refresh with a consumer action: `inline` when everything fits one tx; else `split` (whole publish unit in prep), which needs
 * K = `consumer.maxPublicationAgeSlots` ≥ 1 within the feed's max_snapshot_age_slots.
 */
export async function planMimirRefresh(args: PlanMimirRefreshArgs): Promise<MimirRefreshPlan> {
  assertConsumer(args.consumer);
  const limits: Limits = {
    accounts: Math.min(args.limits?.maxAccounts ?? MIMIR_BETA_TRANSACTION_V1_MAX_ACCOUNTS, MIMIR_BETA_TRANSACTION_V1_MAX_ACCOUNTS),
    bytes: Math.min(args.limits?.maxTransactionBytes ?? MIMIR_BETA_TRANSACTION_V1_MAX_BYTES, MIMIR_BETA_TRANSACTION_V1_MAX_BYTES),
    cu: Math.min(args.limits?.maxComputeUnits ?? MIMIR_REFRESH_MAX_COMPUTE_UNITS, MIMIR_REFRESH_MAX_COMPUTE_UNITS),
  };
  const est = new Estimator(args, limits);
  const consumerAlone = await est.fit([], args.consumer);
  if (!consumerAlone) betaError("TRANSACTION_TOO_LARGE", "the consumer alone does not fit one transaction");
  if (args.rpc) est.blockhash().catch(() => {});
  const group = await args.buildRefreshGroup(args.target, planningReuse(args));
  for (const ix of [...group.updates, group.publish].flatMap((u) => u.instructions)) {
    if (ix.programAddress !== args.programId) betaError("PROGRAM_ABI_MISMATCH", "refresh group instruction targets another program");
  }
  if (!group.publish.instructions.length) betaError("INVALID_ARGUMENT", "refresh group has no publish instruction");
  const all = [...group.updates, group.publish];
  const k = args.consumer.maxPublicationAgeSlots ?? 0;

  const inline = await est.fit(all, args.consumer);
  if (inline) return { mode: "inline", instructions: [...all.flatMap((u) => u.instructions), ...args.consumer.instructions], estimate: inline,
    publish: { ...group.check, maxAgeSlots: 0 } };
  const execution = (maxPublicationAgeSlots: number): MimirRefreshExecution => ({ ordering: "confirmed-prep",
    prepCommitment: "confirmed", prepSequence: "in-order-each-confirmed", maxPublicationAgeSlots,
    onMiss: "replan" });

  if (k === 0) betaError("PUBLICATION_AGE_UNSUPPORTED", "split refresh needs a consumer accepting K ≥ 1 slots of publication age");
  const m = group.ageLimits?.maxSnapshotAgeSlots;
  if (m === undefined) betaError("PUBLICATION_AGE_UNSUPPORTED", "snapshot age limit is unknown");
  if (k > m) betaError("PUBLICATION_AGE_UNSUPPORTED", `K=${k} exceeds max_snapshot_age_slots ${m}`);
  return { mode: "split", estimate: consumerAlone, refreshTransactions: await partitionMimirRefreshUnits(all, (u) => est.fit(u)),
    publish: { ...group.check, maxAgeSlots: k }, execution: execution(k) };
}

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const u64 = (data: Uint8Array, offset: number): bigint => view(data).getBigUint64(offset, true);
const minBig = (...values: bigint[]): bigint => values.reduce((a, b) => (b < a ? b : a));
const same = (a: Uint8Array, offset: number, b: Uint8Array, at = 0, len = 32) => a.length >= offset + len && b.length >= at + len &&
  a.subarray(offset, offset + len).every((x, i) => x === b[at + i]);
const durationSource = (data: Uint8Array, check: Omit<MimirPublishCheck, "maxAgeSlots">) =>
  check.kind === "classic-snapshot" && ![5, 6, 7].includes(data[107]!);

/** Age limits that bound a stored publication's residual headroom (§5): feed/CFC M, activity T, consumer Mc and Tc. */
export interface MimirPublicationAgeLimits {
  readonly maxSnapshotAgeSlots?: number;
  readonly maxSourceActivityAgeSlots?: number;
  readonly consumerMaxSnapshotAgeSlots?: number;
  readonly consumerMaxSourceActivityAgeSlots?: number;
}

/**
 * Largest K the actual stored publication still supports: duration sources `min(V−p, M, Mc, A+min(T,Tc)−p)` (A = oldest activity
 * @156); source 5/6/7 and composite CSP `min(V−p, Mc)` (their V already folds proof, component and converter lag). Negative = unusable.
 */
export function mimirPublicationHeadroomSlots(data: Uint8Array, check: Omit<MimirPublishCheck, "maxAgeSlots">, limits: MimirPublicationAgeLimits = {}): bigint {
  const p = u64(data, check.slotOffset), v = u64(data, check.validUntilSlotOffset);
  const terms = [v - p];
  if (limits.consumerMaxSnapshotAgeSlots !== undefined) terms.push(BigInt(limits.consumerMaxSnapshotAgeSlots));
  if (durationSource(data, check)) {
    if (limits.maxSnapshotAgeSlots !== undefined) terms.push(BigInt(limits.maxSnapshotAgeSlots));
    const t = [limits.maxSourceActivityAgeSlots, limits.consumerMaxSourceActivityAgeSlots].filter((x): x is number => x !== undefined);
    if (t.length) terms.push(u64(data, 156) + BigInt(Math.min(...t)) - p);
  }
  return minBig(...terms);
}

/** Mimir's reader predicates for a decoded classic snapshot; identity, revision and age are checked by the caller. */
function readerCheck(header: FeedSnapshotHeader, r: MimirConsumerReaderPolicy, clockSlot: bigint): void {
  verifySnapshotHeaderPolicy(header, {
    expectedFeedId: header.feedId, expectedPlanHash: header.sourcingPlanHash, expectedAnchorPolicyHash: header.anchorPolicyHash,
    expectedNativeExceptionHash: r.expectedNativeExceptionHash ?? new Uint8Array(32), expectedPriceExponent: header.priceExponent,
    clockSlot, maxSnapshotAgeSlots: Number.MAX_SAFE_INTEGER, maxSourceActivityAgeSlots: Number.MAX_SAFE_INTEGER,
    minSourceCount: r.minSourceCount ?? 0, minVenueCount: r.minVenueCount ?? 0, minCorrelationGroupCount: r.minCorrelationGroupCount ?? 0,
    minCoverageRatioBps: r.minCoverageRatioBps ?? 0, maxConfidenceBps: r.maxConfidenceBps, maxDispersionBps: r.maxDispersionBps,
    notional: r.notional, expectedSnapshotRevision: header.snapshotRevision, expectedTwapRevision: 0n,
    expectedRouteabilityStatus: r.expectedRouteabilityStatus, flags: (r.flags ?? 0) & 0b111,
  }, undefined, r.reader === "mixed");
}

const u128 = (data: Uint8Array, offset: number): bigint => u64(data, offset) | (u64(data, offset + 8) << 64n);
const le = (value: bigint, bytes: number) => { const out = new Uint8Array(bytes); for (let i = 0; i < bytes; i++) out[i] = Number((value >> BigInt(8 * i)) & 0xffn); return out; };
const hashv = (items: readonly Uint8Array[]) => { const h = sha256.create(); for (const item of items) h.update(item); return h.digest(); };
const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

/** Composite config ↔ CSP predicates of Mimir's composite reader (component set incl. converter, components, quality caps). */
function compositeFeedCheck(header: ReturnType<typeof decodeMimirBrowserCompositeSnapshotHeader>, config: Uint8Array, clockSlot: bigint): void {
  const count = config[119]!, setItems: Uint8Array[] = [ascii("MIMIR_COMPOSITE_COMPONENTS_V1"), config.subarray(80, 112), Uint8Array.of(count), config.subarray(197, 229)];
  for (let i = 0; i < count; i++) setItems.push(config.subarray(229 + i * 80, 309 + i * 80));
  if (!same(hashv(setItems), 0, config, 128) || !same(header.componentSetHash, 0, config, 128)) throw new Error("FeedConfigPolicyMismatch");
  if (header.componentCount !== count) throw new Error("InvalidCompositeSnapshot");
  const snapItems: Uint8Array[] = [ascii("MIMIR_COMPOSITE_SNAPSHOT_COMPONENTS_V1")];
  let sum = 0n;
  header.components.forEach((k, i) => {
    if (!same(k.feedId, 0, config, 229 + i * 80) || k.contributionX64 !== (k.priceX64 * u128(config, 293 + i * 80)) >> 64n || k.snapshotSlot > clockSlot)
      throw new Error("InvalidCompositeSnapshot");
    sum += k.contributionX64;
    snapItems.push(k.feedId, le(k.snapshotRevision, 8), le(k.snapshotSlot, 8), le(k.priceX64, 16), le(k.contributionX64, 16));
  });
  if (sum !== header.priceX64 || !same(hashv(snapItems), 0, header.componentSnapshotHash)) throw new Error("InvalidCompositeSnapshot");
}

/** Typed bindings a stored publication must carry: feed id, config revision, exponent and (classic) one of the feed's plan hashes. */
export interface MimirPublicationBinding {
  readonly minRevision?: bigint; readonly revision?: bigint; readonly feedId?: Uint8Array; readonly configRevision?: bigint;
  readonly priceExponent?: number; readonly planHash?: Uint8Array | readonly Uint8Array[];
}

export type MimirPublicationVerdict =
  | { readonly ok: true; readonly publicationSlot: bigint; readonly validUntilSlot: bigint; readonly ageSlots: bigint; readonly lastUsableSlot: bigint }
  | { readonly ok: false; readonly reason: "MALFORMED" | "NOT_FRESH" | "WRONG_SOURCE" | "WRONG_CAP_MODEL" | "WRONG_REVISION" | "WRONG_BINDING" |
      "CONFIG_MISMATCH" | "QUOTE_NOT_OK" | "STALE_ACTIVITY" | "TOO_OLD" | "EXPIRED" | "FUTURE" }
  | { readonly ok: false; readonly reason: "FEED_POLICY" | "READER_POLICY"; readonly error: string };

/**
 * The checks a consumer's on-chain reader enforces on a stored publication against its config: FRESH status, snapshot
 * source, cap model, revision, feed id/exponent/plan hash, config lifecycle/revision/registry epoch, quote status,
 * `c−p ≤ min(K, M)`, source activity within `min(T, Tc)` (duration sources) and `c ≤ V`. Never throws: short or foreign
 * bytes are `MALFORMED`. Mimir's generic VerifySnapshot rejects source 5/6/7 at any K; those consumers need the mixed reader.
 */
export function verifyMimirPublicationForConsumer(args: Readonly<{
  data: Uint8Array; config: Uint8Array; check: Omit<MimirPublishCheck, "maxAgeSlots">; clockSlot: bigint; maxPublicationAgeSlots: number;
  consumerMaxSourceActivityAgeSlots?: number;
  /** Authenticated Clock unix timestamp; the mixed reader needs it for sources 5/6. */
  clockUnixTimestamp?: bigint;
  /** Mimir program id; composite publications authenticate their config PDA bump against it. */
  programId?: Address;
  expected?: MimirPublicationBinding;
  readerPolicy?: MimirConsumerReaderPolicy;
}>): MimirPublicationVerdict {
  const fail = (reason: Exclude<Extract<MimirPublicationVerdict, { ok: false }>["reason"], "FEED_POLICY" | "READER_POLICY">) => ({ ok: false, reason }) as const;
  const { data, config, check, clockSlot: c } = args;
  const composite = check.kind === "composite-csp";
  try { if (composite) decodeMimirBrowserCompositeSnapshotHeader(data); else decodeFeedSnapshotHeader(data); } catch { return fail("MALFORMED"); }
  let cfg: { lifecycleOk: boolean; revision: bigint; epoch: bigint; exponent: number; maxSnapshotAgeSlots: number; maxSourceActivityAgeSlots?: number };
  let feedCheck: () => void, readerPolicyCheck: () => void = () => {};
  try {
    if (composite) {
      decodeMimirCompositeConfig(config);
      const header = decodeMimirBrowserCompositeSnapshotHeader(data);
      cfg = { lifecycleOk: true, revision: u64(config, 168), epoch: u64(config, 160), exponent: view(config).getInt32(112, true),
        maxSnapshotAgeSlots: view(config).getUint16(120, true) };
      feedCheck = () => {
        const expectedConfig = addressBytes(check.config);
        if (!args.programId) throw new Error("MissingProgramId");
        if (!same(data, 48, expectedConfig)) throw new Error("InvalidCompositeSnapshot");
        if (!same(hashv([ascii("composite_feed_config"), config.subarray(16, 48), config.subarray(184, 185), addressBytes(args.programId),
          ascii("ProgramDerivedAddress")]), 0, expectedConfig)) throw new Error("InvalidCompositeFeed");
        compositeFeedCheck(header, config, c);
      };
      const r = args.readerPolicy;
      if (r) readerPolicyCheck = () => {
        if (header.routeabilityStatus !== r.expectedRouteabilityStatus) throw new Error("InvalidRouteability");
        if (r.notional > header.componentMinCapitalFloor) throw new Error("NotionalTooLarge");
        if (header.confidenceBps > r.maxConfidenceBps) throw new Error("ConfidenceTooWide");
        if (header.dispersionBps > r.maxDispersionBps) throw new Error("DispersionTooWide");
      };
    } else {
      const feed = decodeMimirBetaLiveFeed(config), lifecycle = decodeLifecycleFeedConfigHeader(config), header = decodeFeedSnapshotHeader(data);
      cfg = { lifecycleOk: feed.lifecycleState === 3, revision: feed.feedConfigRevision, epoch: feed.registryEpoch, exponent: feed.priceExponent,
        maxSnapshotAgeSlots: feed.maxSnapshotAgeSlots, maxSourceActivityAgeSlots: feed.maxSourceActivityAgeSlots };
      feedCheck = () => {
        verifySnapshotConfidenceBounds(header);
        verifyFeedConfigForSnapshot(lifecycle, header, { expectedFeedId: lifecycle.feedId, clockSlot: c } as SnapshotPolicy);
      };
      if (args.readerPolicy) readerPolicyCheck = () => {
        const r = args.readerPolicy!;
        if (r.reader === "mixed") {
          validateFrontier(data);
          if (header.snapshotSource === 5 || header.snapshotSource === 6) {
            if (args.clockUnixTimestamp === undefined || r.frontierMaxAge === undefined || r.frontierMaxSourceAgeSlots === undefined) throw new Error("MissingFrontierPolicy");
            if (!admitFrontier(data, { maxAge: r.frontierMaxAge, maxSourceAge: r.frontierMaxSourceAgeSlots, maxConfidenceBps: r.maxConfidenceBps }, c, args.clockUnixTimestamp))
              throw new Error("FrontierNotAdmitted");
          }
        }
        readerCheck(header, r, c);
      };
    }
  } catch { return fail("MALFORMED"); }
  if (!same(data, 16, config, 16)) return fail("CONFIG_MISMATCH");
  if (data[check.statusOffset] !== check.expectedStatus) return fail("NOT_FRESH");
  if (check.expectedSnapshotSource !== undefined && data[check.snapshotSourceOffset!] !== check.expectedSnapshotSource) return fail("WRONG_SOURCE");
  if (check.expectedCapModelVersion !== undefined && view(data).getUint16(check.capModelVersionOffset!, true) !== check.expectedCapModelVersion) return fail("WRONG_CAP_MODEL");
  const revision = u64(data, check.revisionOffset), e = args.expected ?? {};
  if ((e.revision !== undefined && revision !== e.revision) || (e.minRevision !== undefined && revision < e.minRevision)) return fail("WRONG_REVISION");
  const exponent = view(data).getInt32(composite ? 160 : 196, true);
  const plans = e.planHash === undefined ? undefined : e.planHash instanceof Uint8Array ? [e.planHash] : e.planHash;
  if ((e.feedId && !same(data, 16, e.feedId)) || (e.priceExponent !== undefined && exponent !== e.priceExponent) ||
      (e.configRevision !== undefined && u64(data, 88) !== e.configRevision) ||
      (plans && (composite || !plans.some((h) => same(data, 262, h))))) return fail("WRONG_BINDING");
  if (!cfg.lifecycleOk || u64(data, 88) !== cfg.revision || u64(data, 80) !== cfg.epoch || exponent !== cfg.exponent) return fail("CONFIG_MISMATCH");
  if (data[composite ? 110 : 257] !== 0) return fail("QUOTE_NOT_OK");
  const p = u64(data, check.slotOffset), v = u64(data, check.validUntilSlotOffset);
  if (c < p) return fail("FUTURE");
  const maxAge = Math.min(args.maxPublicationAgeSlots, durationSource(data, check) || composite ? cfg.maxSnapshotAgeSlots : Infinity);
  if (c - p > BigInt(maxAge)) return fail("TOO_OLD");
  if (c > v) return fail("EXPIRED");
  let lastUsable = minBig(v, p + BigInt(maxAge));
  if (durationSource(data, check)) {
    const t = Math.min(cfg.maxSourceActivityAgeSlots!, args.consumerMaxSourceActivityAgeSlots ?? Infinity), a = u64(data, 156);
    if (c < a || c - a > BigInt(t)) return fail("STALE_ACTIVITY");
    lastUsable = minBig(lastUsable, a + BigInt(t));
  } else if (composite) {
    const l = view(config).getUint16(122, true);
    for (const [a, t] of [[u64(data, 136), l], [u64(data, 144), Math.min(l, args.consumerMaxSourceActivityAgeSlots ?? Infinity)]] as const) {
      if (a === 0n) continue;
      if (c < a || c - a > BigInt(t)) return fail("STALE_ACTIVITY");
      lastUsable = minBig(lastUsable, a + BigInt(t));
    }
  }
  for (const [reason, run] of [["FEED_POLICY", feedCheck], ["READER_POLICY", readerPolicyCheck]] as const) {
    try { run(); } catch (error) { return { ok: false, reason, error: String((error as Error)?.message) }; }
  }
  return { ok: true, publicationSlot: p, validUntilSlot: v, ageSlots: c - p, lastUsableSlot: lastUsable };
}

/** After a confirmed prep: reread the actual publication and refuse K beyond its residual headroom. */
export function assertMimirPublicationSupportsK(data: Uint8Array, check: Omit<MimirPublishCheck, "maxAgeSlots">, k: number,
  limits: MimirPublicationAgeLimits = {}): bigint {
  const headroom = mimirPublicationHeadroomSlots(data, check, limits);
  if (BigInt(k) > headroom) betaError("PUBLICATION_AGE_UNSUPPORTED", `K=${k} exceeds the actual publication headroom ${headroom}`);
  return headroom;
}

export type MimirRefreshReadiness =
  | { readonly state: "ready"; readonly publication: MimirPublishCheck; readonly publicationSlot: bigint; readonly lastUsableSlot: bigint }
  | { readonly state: "needs-full-refresh"; readonly plan: MimirRefreshPlan }
  | { readonly state: "needs-spaced-refreshes"; readonly count: number; readonly countIsLowerBound: boolean;
      readonly minSpacingSlots: number; readonly minSpacingSeconds: number; readonly maxSpacingSeconds?: number; readonly bucketSeconds?: number;
      readonly minSupportSeconds: number; readonly nextEligibleUnixTs?: bigint;
      readonly refreshOnlyStage: readonly MimirBetaInstruction[] }
  | { readonly state: "not-ready"; readonly reason: string; readonly retryAfter: { readonly slot?: bigint; readonly unixTs?: bigint } | null;
      readonly dependency?: "dex-activity" | "external-state" | "replan"; readonly sourceIndex?: number;
      readonly evidence: Readonly<Record<string, unknown>> };

export type MimirRefreshNotReady = Extract<MimirRefreshReadiness, { state: "not-ready" | "needs-spaced-refreshes" }>;

/** Kind-9 sampled projection → spaced refreshes (chain seconds, accepted records); quality hold is not a timing problem.
 * Schedule each refresh at the re-read `nextEligibleUnixTs`: one per 10 s bucket; a fixed 8-9 s cadence never reaches 120 s support. */
export function mimirSampledRefreshReadiness(sampled: Readonly<{ status: string; observationsRemaining: number; spanSecondsRemaining: bigint;
  nextEligibleUnixTs: bigint }>, refreshOnlyStage: readonly MimirBetaInstruction[], minSlotGap = 1): MimirRefreshNotReady | null {
  if (sampled.status === "ready") return null;
  if (sampled.status === "quality-hold") return { state: "not-ready", reason: "sampled-quality-hold", retryAfter: null, dependency: "dex-activity", evidence: { ...sampled } };
  return { state: "needs-spaced-refreshes", count: sampled.observationsRemaining, countIsLowerBound: true, minSpacingSlots: minSlotGap,
    minSpacingSeconds: 10, maxSpacingSeconds: 15, bucketSeconds: 10, minSupportSeconds: Number(sampled.spanSecondsRemaining),
    ...(sampled.status === "history-reset-required" ? {} : { nextEligibleUnixTs: sampled.nextEligibleUnixTs }), refreshOnlyStage };
}

/** Program errors raised by a concurrent writer (revision/epoch/CAS races): the plan is stale, replan now. */
const MIMIR_REPLAN_CUSTOM_CODES = new Set([36, 37, 50, 54, 56, 58, 59]);

/**
 * Semantic simulation verdict of the whole refresh: exact instruction index and Custom code. No verdict when the
 * group does not fit one tx (bytes, accounts or CU): those groups are judged by the split plan alone.
 */
async function simulateVerdict(args: PlanMimirRefreshArgs, instructions: readonly MimirBetaInstruction[],
  blockhash: () => Promise<Blockhash>, group: MimirRefreshGroup): Promise<MimirRefreshNotReady | null> {
  const sim = await simulateRaw(args.rpc!, args.payer, instructions, blockhash);
  const err = sim?.err;
  if (err === null || err === undefined) return null;
  const ie = (err as { InstructionError?: [number | bigint, unknown] }).InstructionError;
  if (err === "ComputationalBudgetExceeded" || ie?.[1] === "ComputationalBudgetExceeded") return null;
  const code = ie && typeof ie[1] === "object" && ie[1] !== null ? (ie[1] as { Custom?: number | bigint }).Custom : undefined;
  const custom = code === undefined ? undefined : Number(code);
  const index = ie ? Number(ie[0]) : 0;
  const failed = instructions[index];
  if (ie && failed?.programAddress === args.programId && group.preparationDrift) {
    // The callback is bound to one refresh instruction, so normalize the whole-message index only after exact identity checks.
    const refresh = [...group.updates, group.publish].flatMap((unit) => unit.instructions);
    if (refresh.length === 1 && refresh[0] === failed) {
      try { await group.preparationDrift({ InstructionError: [0, ie[1]] }, sim?.logs); }
      catch (error) { if (error instanceof MimirBetaStalePreparationError) throw error; }
    }
  }
  const reason = custom === 15 ? "stale-source-activity" : custom !== undefined ? `custom-${custom}` : "simulation-failed";
  const dependency = custom === 15 ? "dex-activity" : custom !== undefined && MIMIR_REPLAN_CUSTOM_CODES.has(custom) ? "replan" : "external-state";
  return { state: "not-ready", reason, retryAfter: null, dependency,
    evidence: { err, ...(ie ? { instructionIndex: index, tag: instructions[index]?.data[0] } : {}), ...(custom !== undefined ? { customCode: custom } : {}),
      logs: sim?.logs?.slice(-8) ?? [] } };
}

/** Builder failures that are readiness facts, not bugs: warming (spaced refreshes) or a typed interval/history refusal. */
export function mimirReadinessFromBuildError(error: unknown, warming: { refreshOnlyInstructions: readonly MimirBetaInstruction[];
  remainingWarmupSeconds: bigint | null; sampled?: Parameters<typeof mimirSampledRefreshReadiness>[0] } | null): MimirRefreshNotReady | null {
  if (warming) {
    if (warming.sampled) return mimirSampledRefreshReadiness(warming.sampled, warming.refreshOnlyInstructions);
    return { state: "needs-spaced-refreshes", count: 1, countIsLowerBound: warming.remainingWarmupSeconds === null, minSpacingSlots: 1,
      minSpacingSeconds: Number(warming.remainingWarmupSeconds ?? 120n), minSupportSeconds: 120, refreshOnlyStage: warming.refreshOnlyInstructions };
  }
  const e = error as { code?: string; reason?: string; sourceIndex?: number; semantics?: string } | null;
  if (e?.semantics === "mixedDegraded") return { state: "not-ready", reason: "mixed-degraded", retryAfter: null, dependency: "external-state",
    evidence: { semantics: e.semantics } };
  if (e?.code === "MimirNativeObservationUnavailable") return { state: "not-ready", reason: `native-${e.reason}`, retryAfter: null, dependency: "dex-activity",
    ...(e.sourceIndex !== undefined ? { sourceIndex: e.sourceIndex } : {}), evidence: { code: e.code } };
  if (e?.code === "MimirDammOnlyBIntervalUnavailable" || e?.code === "MimirCpmmQuietIntervalUnavailable") return { state: "not-ready",
    reason: `${e.code === "MimirDammOnlyBIntervalUnavailable" ? "damm" : "cpmm-quiet"}-${e.reason}`, retryAfter: null,
    dependency: e.reason === "stale" ? "dex-activity" : "external-state", evidence: { code: e.code } };
  return null;
}

export interface AssessMimirRefreshArgs extends PlanMimirRefreshArgs {
  /** Maps a builder error to its warming recovery (e.g. `getMimirWarmingRecovery`); defaults to none. */
  readonly warmingRecovery?: (error: unknown) => Parameters<typeof mimirReadinessFromBuildError>[1];
}

/** `ready` when the stored publication (resolved from PDAs) passes the consumer's reader with K slots of actual headroom. */
async function storedReadiness(args: AssessMimirRefreshArgs, k: number): Promise<MimirRefreshReadiness | null> {
  const publication = await args.buildRefreshGroup.publication!(args.target);
  const read = await args.rpc!.getMultipleAccounts([publication.check.account, publication.check.config, "SysvarC1ock11111111111111111111111111111111" as Address],
    { commitment: "confirmed", encoding: "base64" }).send() as { value: readonly ({ owner: string; data: unknown } | null)[] };
  if (read.value.slice(0, 2).some((x) => x?.owner !== args.programId)) return null;
  const [snap, config, clock] = read.value.map((x) => x ? mimirBetaRpcAccountBytes(x.data) ?? fromBase64(String((x.data as unknown[])[0])) : null);
  if (!snap || !config || !clock || clock.length < 40) return null;
  const verdict = verifyMimirPublicationForConsumer({ data: snap, config, check: publication.check, clockSlot: u64(clock, 0), maxPublicationAgeSlots: k,
    clockUnixTimestamp: view(clock).getBigInt64(32, true), programId: args.programId,
    expected: publication.expected, ...(args.consumer.readerPolicy ? { readerPolicy: args.consumer.readerPolicy } : {}),
    ...(args.consumer.maxSourceActivityAgeSlots !== undefined ? { consumerMaxSourceActivityAgeSlots: args.consumer.maxSourceActivityAgeSlots } : {}) });
  if (!verdict.ok || mimirPublicationHeadroomSlots(snap, publication.check, { ...publication.ageLimits,
    ...(args.consumer.maxSourceActivityAgeSlots !== undefined ? { consumerMaxSourceActivityAgeSlots: args.consumer.maxSourceActivityAgeSlots } : {}) }) < BigInt(k)) return null;
  return { state: "ready", publication: { ...publication.check, maxAgeSlots: k }, publicationSlot: verdict.publicationSlot, lastUsableSlot: verdict.lastUsableSlot };
}

/**
 * Outer readiness decision around the packet plan: `ready` from the stored publication before any build; else build the
 * group, keep a semantic simulation verdict as `not-ready`, and return the packet plan.
 */
export async function assessMimirRefresh(args: AssessMimirRefreshArgs): Promise<MimirRefreshReadiness> {
  assertConsumer(args.consumer);
  const k = args.consumer.maxPublicationAgeSlots ?? 0;
  if (args.rpc && args.buildRefreshGroup.publication) {
    const ready = await storedReadiness(args, k);
    if (ready) return ready;
  }
  let planningArgs = args;
  let blockhash = planBlockhash(planningArgs);
  let group: MimirRefreshGroup;
  if (args.rpc) blockhash().catch(() => {});
  try { group = await args.buildRefreshGroup(args.target, planningReuse(args)); } catch (error) {
    const classified = mimirReadinessFromBuildError(error, (args.warmingRecovery ?? args.buildRefreshGroup.warmingRecovery)?.(error) ?? null);
    if (classified) return classified;
    throw error;
  }
  if (args.rpc) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const verdict = await simulateVerdict(planningArgs, [...group.updates, group.publish].flatMap((u) => u.instructions), blockhash, group);
        if (verdict) return verdict;
        break;
      } catch (error) {
        if (!(error instanceof MimirBetaStalePreparationError) || attempt !== 0) throw error;
        // Drop every retained plan input and the old message's blockhash before the one permitted rebuild.
        planningArgs = { ...args, recentBlockhash: undefined, prefetchedAccounts: undefined };
        group = await planningArgs.buildRefreshGroup(planningArgs.target);
        blockhash = planBlockhash(planningArgs);
      }
    }
  }
  const recentBlockhash = planningArgs.recentBlockhash ?? (args.rpc ? await blockhash().catch(() => undefined) : undefined);
  return { state: "needs-full-refresh", plan: await planMimirRefresh({ ...planningArgs, ...(recentBlockhash ? { recentBlockhash } : {}), buildRefreshGroup: async () => group }) };
}


