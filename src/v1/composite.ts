import type { Address } from "@solana/kit";
import bs58 from "bs58";
import { betaError } from "../beta/errors.js";
import { assertMimirClassicConverterAdmitted } from "../beta/classicExecution.js";
import type { MimirBetaAdminContext } from "../beta/context.js";
import type { MimirBetaInstruction } from "../beta/types.js";
import * as C from "./layout/common.js";
import * as K from "./layout/classic.js";
import * as X from "./layout/composite.js";
import { v1MembershipLen, v1TemporalModuleLen, type V1ClassicFeed } from "./decoders.js";
import { deriveMimirV1ClassicFeedId, deriveMimirV1CompositeFeedId, findMimirV1ClassicFeedPda, findMimirV1SourceConfigAddress, type MimirV1CompositeParams, type MimirV1CreateCompositeAccounts, type MimirV1CreateHead } from "./build.js";
import { planMimirV1CompositeCreation, type MimirV1CreationPlan } from "./tx.js";
import { assertMimirPriceable, type MimirCompositeParamConverter, type MimirCompositeParamRow, type MimirParamRow } from "../beta/params.js";
import type { MimirBetaSourceFamily } from "../beta/types.js";

export const MIMIR_V1_NATIVE_MINT = "So11111111111111111111111111111111111111112" as Address;
const ADAPTER = Object.freeze({ ORCA: 0, CLMM: 1, CPMM: 2, DLMM: 3, DAMM_V2: 7 } as const);

/** The SOL/quote feed (variant 0) whose rows become the converter of SOL-quoted composite children. */
export async function findMimirV1SolFeedPda(programId: Address, quoteMint: Address): Promise<readonly [Address, number]> {
  return findMimirV1ClassicFeedPda(programId, await deriveMimirV1ClassicFeedId(MIMIR_V1_NATIVE_MINT, quoteMint, 0));
}

const mint = (bytes: Uint8Array, at: number) => bs58.encode(bytes.subarray(at, at + 32)) as Address;
const rowQuote = (f: V1ClassicFeed) => mint(f.rows[0]!.source, K.SRC_OFFSET_QUOTE_MINT);
const FAMILY_BY_ADAPTER: readonly (MimirBetaSourceFamily | undefined)[] =
  ["orca-whirlpool", "raydium-clmm", "raydium-cpmm", "meteora-dlmm", "raydium-amm-v4", undefined, "pumpswap", "meteora-damm-v2"];
const u16 = (bytes: Uint8Array, at: number) => bytes[at]! | bytes[at + 1]! << 8;

/** Quality rows of a V1 composite: children rows 0 and, with a SOL-quoted child, the SOL feed rows; `pools` holds each row's pool account. */
export async function mimirV1CompositeParamRows(a: Readonly<{
  programId: Address; quoteMint: Address; children: readonly V1ClassicFeed[]; solFeed?: Readonly<{ address: Address; feed: V1ClassicFeed }>;
  pools: ReadonlyMap<Address, Uint8Array | null | undefined>;
  /** 1-based position of each child as entered (defaults to data order). */
  positions?: readonly number[];
}>): Promise<Readonly<{ rows: readonly MimirCompositeParamRow[]; converter?: MimirCompositeParamConverter }>> {
  const row = (f: V1ClassicFeed, index: number): MimirParamRow => {
    const { descriptor: d, source } = f.rows[index]!;
    const family = FAMILY_BY_ADAPTER[d.adapterType] ?? betaError("INVALID_ARGUMENT", "V1 row has an unknown pool family", f.selfAddress);
    const pool = mint(source, K.SRC_OFFSET_POOL_OR_MARKET);
    return { family, pool, poolData: a.pools.get(pool), recipe: d.mode === C.MODE_ROUTEABLE_SPOT && d.temporalKind === C.TEMPORAL_NONE ? "spot" : "native-bounded" };
  };
  const policy = (f: V1ClassicFeed, at: number) => u16(f.definition.feedImage, at);
  const sourceConfig = async (f: V1ClassicFeed) => (await findMimirV1SourceConfigAddress(a.programId, bs58.encode(f.feedId) as Address, 0))[0];
  const rows = await Promise.all(a.children.map(async (f, i) => ({ ...row(f, 0), position: a.positions?.[i] ?? i + 1, sourceConfig: await sourceConfig(f),
    child: { maxConfidenceBps: policy(f, K.CFG_OFFSET_MAX_CONFIDENCE_BPS), maxSourceActivityAgeSlots: policy(f, K.CFG_OFFSET_MAX_SOURCE_ACTIVITY_AGE_SLOTS) } })));
  const sol = a.children.some((f) => rowQuote(f) !== a.quoteMint) ? a.solFeed ?? betaError("INVALID_ARGUMENT", "a SOL-quoted V1 composite child needs the SOL feed") : undefined;
  return { rows, ...(sol ? { converter: { sourceConfig: await sourceConfig(sol.feed), rows: sol.feed.rows.map((_, i) => row(sol.feed, i)),
    maxConfidenceBps: policy(sol.feed, K.CFG_OFFSET_MAX_CONFIDENCE_BPS), maxDispersionBps: policy(sol.feed, K.CFG_OFFSET_MAX_DISPERSION_BPS) } } : {}) };
}

/**
 * Composite feed_id from the decoded children: components at their R-08 SourceConfig addresses; with a SOL-quoted child the
 * converter source (the SOL feed's row-0 SourceConfig address) is part of the identity, as on chain.
 */
export async function deriveMimirV1CompositeFeedIdFromFeeds(a: Readonly<{
  programId: Address; creator: Address; quoteMint: Address; priceExponent: number;
  children: readonly Readonly<{ feed: V1ClassicFeed; quantityX64: bigint }>[]; solFeed?: V1ClassicFeed;
}>): Promise<Address> {
  const id = (f: V1ClassicFeed) => bs58.encode(f.feedId) as Address;
  const components = await Promise.all(a.children.map(async (c) => ({ feedId: id(c.feed),
    sourceConfig: (await findMimirV1SourceConfigAddress(a.programId, id(c.feed), 0))[0], quantityX64: c.quantityX64 })));
  const converter = a.children.some((c) => rowQuote(c.feed) !== a.quoteMint)
    ? (await findMimirV1SourceConfigAddress(a.programId, id(a.solFeed ?? betaError("INVALID_ARGUMENT", "a SOL-quoted V1 composite child needs the SOL feed")), 0))[0]
    : undefined;
  return deriveMimirV1CompositeFeedId({ creator: a.creator, quoteMint: a.quoteMint, priceExponent: a.priceExponent, components,
    ...(converter ? { solConversionSourceConfig: converter } : {}) });
}

export interface MimirV1CompositeShape {
  /** Converter rows: the SOL feed's n iff a child quotes SOL, else 0. */
  readonly s: number;
  /** The SOL feed meta, iff s ≥ 1. */
  readonly solFeed?: Address;
  /** Exact composite account length (LAYOUT_V1_COMPOSITE §2, B7). */
  readonly finalLen: number;
}

/**
 * CREATE_COMPOSITE shape from the decoded children (data order) and the SOL feed: every child is an n = 1 Classic quoting the
 * composite quote or SOL; a SOL-quoted child brings the SOL feed's rows as the converter (s = its n). The SOL feed may also be a
 * child. Length as the program geometry: rows, converter block, child memberships (a CPMM non-DUAL row becomes the derived
 * component spot row; other rows are derived iff M0-eligible), the SOL feed's memberships, child modules, the DUAL proof.
 */
export function mimirV1CompositeShape(a: Readonly<{
  quoteMint: Address; children: readonly V1ClassicFeed[]; solFeed?: Readonly<{ address: Address; feed: V1ClassicFeed }>;
}>): MimirV1CompositeShape {
  const n = a.children.length;
  if (n < 2 || n > X.COMPOSITE_MAX_COMPONENTS) betaError("INVALID_ARGUMENT", "V1 composite needs 2-5 children");
  const rows = a.children.map((f) => {
    if (f.header.n !== 1) betaError("INVALID_ARGUMENT", "V1 composite child must be a one-row Classic", f.selfAddress);
    const quote = rowQuote(f);
    if (quote !== a.quoteMint && quote !== MIMIR_V1_NATIVE_MINT) betaError("INVALID_ARGUMENT", "V1 composite child quotes neither the composite quote nor SOL", f.selfAddress);
    return { d: f.rows[0]!.descriptor, m: f.memberships[0]!, solQuoted: quote !== a.quoteMint };
  });
  const sol = rows.some((r) => r.solQuoted) ? a.solFeed ?? betaError("INVALID_ARGUMENT", "a SOL-quoted V1 composite child needs the SOL feed") : undefined;
  if (sol) {
    const image = sol.feed.definition.feedImage;
    if (sol.feed.header.s !== 0 || mint(image, K.CFG_OFFSET_BASE_MINT) !== MIMIR_V1_NATIVE_MINT || mint(image, K.CFG_OFFSET_QUOTE_MINT) !== a.quoteMint) {
      betaError("INVALID_ARGUMENT", "V1 SOL feed must be the s = 0 SOL/composite-quote Classic", sol.address);
    }
    assertMimirClassicConverterAdmitted(sol.feed.rows.map((r) => r.descriptor) as unknown as Parameters<typeof assertMimirClassicConverterAdmitted>[0]);
  }
  const s = sol?.feed.header.n ?? 0;
  const recipes = rows.map(({ d, m }) => {
    const spot = d.adapterType === ADAPTER.CPMM && d.temporalKind !== C.TEMPORAL_DUAL_NATIVE_POINT_V1;
    const temporalKind = spot ? C.TEMPORAL_NONE : d.temporalKind;
    const mtp4 = temporalKind === C.TEMPORAL_MTP4_SAMPLED || temporalKind === C.TEMPORAL_MTP4_POINT;
    const derived = !mtp4 && temporalKind !== C.TEMPORAL_DUAL_NATIVE_POINT_V1 && (d.adapterType === ADAPTER.CPMM || d.adapterType === ADAPTER.DAMM_V2
      || ([ADAPTER.ORCA, ADAPTER.CLMM, ADAPTER.DLMM] as number[]).includes(d.adapterType) && (d.bindingVersion & C.BINDING_STATIC) !== 0);
    return { temporalKind, mtp4, membership: v1MembershipLen(derived, m.bindingWidth) };
  });
  const dual = recipes.some((r) => r.temporalKind === C.TEMPORAL_DUAL_NATIVE_POINT_V1);
  const finalLen = X.ROWS_AT_FIXED + X.ROWS_AT_PER_COMPONENT * n + (recipes.some((r) => r.mtp4) ? X.ROW_FULL_LEN : X.ROW_COMPACT_LEN) * n
    + (s === 0 ? 0 : C.CONVERTER_FIXED_LEN + C.SOURCE_ROW_LEN * s)
    + recipes.reduce((len, r) => len + r.membership + v1TemporalModuleLen(r.temporalKind), 0)
    + (sol?.feed.memberships ?? []).reduce((len, m) => len + v1MembershipLen(m.derived, m.bindingWidth), 0)
    + (dual ? X.DUAL_PROOF_HEADER_LEN + X.DUAL_PROOF_ROW_LEN * n + (s === 0 ? 0 : X.DUAL_PROOF_CONVERTER_LEN) : 0);
  return { s, ...(sol ? { solFeed: sol.address } : {}), finalLen };
}

/**
 * The composite creation tx from decoded children: `head.n`, `head.s`, the SOL feed meta and the exact length come from
 * `mimirV1CompositeShape`; children in strictly ascending feed_id, `childFeeds[i]` decoding `children[i].feed`. `quality`
 * (`mimirV1CompositeParamRows` over the same children) passes `assertMimirPriceable` against `params` before anything is built.
 */
export function planMimirV1CompositeCreationFromFeeds(a: Omit<MimirV1CreateCompositeAccounts, "solFeed"> & Readonly<{
  head: Omit<MimirV1CreateHead, "n" | "s">; colaAmountRaw: bigint; admin: Pick<MimirBetaAdminContext, "configRevision">; feedId: Address; params: MimirV1CompositeParams;
  prefix?: readonly MimirBetaInstruction[];
  childFeeds: readonly V1ClassicFeed[]; solFeed?: Readonly<{ address: Address; feed: V1ClassicFeed }>;
  quality: Awaited<ReturnType<typeof mimirV1CompositeParamRows>>;
}>): MimirV1CreationPlan & Readonly<{ shape: MimirV1CompositeShape }> {
  if (a.childFeeds.length !== a.children.length || a.childFeeds.some((f, i) => f.selfAddress !== a.children[i]!.feed)) {
    betaError("INVALID_ARGUMENT", "V1 composite child feeds must decode the child metas in order");
  }
  if (a.childFeeds.some((f, i) => i > 0 && compare(a.childFeeds[i - 1]!.feedId, f.feedId) >= 0)) {
    betaError("INVALID_ARGUMENT", "V1 composite children must be in strictly ascending feed_id");
  }
  const { childFeeds, solFeed, quality, ...rest } = a;
  const shape = mimirV1CompositeShape({ quoteMint: a.params.quoteMint, children: childFeeds, ...(solFeed ? { solFeed } : {}) });
  if (quality?.rows.length !== childFeeds.length || quality.rows.some((r, i) => r.pool !== mint(childFeeds[i]!.rows[0]!.source, K.SRC_OFFSET_POOL_OR_MARKET))
    || (quality.converter?.rows.length ?? 0) !== shape.s) {
    betaError("INVALID_ARGUMENT", "V1 composite quality rows must cover the same children and SOL conversion rows");
  }
  assertMimirPriceable({ kind: "composite", policy: a.params, rows: quality.rows, ...(quality.converter ? { converter: quality.converter } : {}) });
  const plan = planMimirV1CompositeCreation({ ...rest, head: { ...a.head, n: a.children.length, s: shape.s }, finalLen: shape.finalLen,
    ...(shape.solFeed ? { solFeed: shape.solFeed } : {}) });
  return { ...plan, shape };
}

function compare(x: Uint8Array, y: Uint8Array): number {
  for (let i = 0; i < 32; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}
