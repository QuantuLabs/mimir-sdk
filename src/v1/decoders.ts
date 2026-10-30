import type { Address } from "@solana/kit";
import bs58 from "bs58";
import * as C from "./layout/common.js";
import * as K from "./layout/classic.js";
import * as X from "./layout/composite.js";
import { betaError } from "../beta/errors.js";

const malformed = (message: string): never => betaError("ACCOUNT_MALFORMED", message);
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
export const V1_CLASSIC_MAGIC = ascii(K.CLASSIC_MAGIC);
export const V1_SNAPSHOT_MAGIC = ascii(K.FEED_SNAPSHOT_MAGIC);
export const V1_COMPOSITE_MAGIC = ascii(X.CSP_MAGIC);

class Reader {
  private readonly view: DataView;
  constructor(readonly data: Uint8Array, readonly base = 0) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  at(offset: number) { return new Reader(this.data, this.base + offset); }
  need(length: number) { if (this.base + length > this.data.length) malformed(`region @${this.base}+${length} exceeds ${this.data.length} B`); return this; }
  u8(o: number) { return this.data[this.base + o]!; }
  u16(o: number) { return this.view.getUint16(this.base + o, true); }
  u32(o: number) { return this.view.getUint32(this.base + o, true); }
  i32(o: number) { return this.view.getInt32(this.base + o, true); }
  u64(o: number) { return this.view.getBigUint64(this.base + o, true); }
  i64(o: number) { return this.view.getBigInt64(this.base + o, true); }
  u128(o: number) { return this.u64(o) | (this.u64(o + 8) << 64n); }
  bytes(o: number, length: number) { return this.data.subarray(this.base + o, this.base + o + length); }
  address(o: number) { return bs58.encode(this.bytes(o, 32)) as Address; }
  magic(o: number, expected: Uint8Array) { return this.bytes(o, 8).every((b, i) => b === expected[i]); }
}

const isZero = (bytes: Uint8Array) => bytes.every((b) => b === 0);

export type V1NoticeKind = typeof C.NOTICE_NONE | typeof C.NOTICE_DISCRETIONARY | typeof C.NOTICE_ABANDONED;

export interface V1OwnerRecord {
  readonly generation: bigint;
  readonly createdSlot: bigint;
  readonly generationSeq: number;
  readonly closeAfterSlot: bigint;
  readonly noticeKind: V1NoticeKind;
  /** Classic only; the composite creator is `cfc.creator`. */
  readonly creator: Address | null;
  /** Null until the first TRANSFER_FEED. */
  readonly identityAsset: Address | null;
}

/** Decodes an owner record from its first byte (Classic 81 B, composite 49 B). */
export function decodeV1OwnerRecord(data: Uint8Array, kind: "classic" | "composite"): V1OwnerRecord {
  const r = new Reader(data).need(kind === "classic" ? C.OWNER_CLASSIC_LEN : C.OWNER_COMPOSITE_LEN);
  const generation = r.u64(C.OWNER_GENERATION);
  const noticeKind = r.u8(C.OWNER_NOTICE_KIND);
  if (noticeKind > C.NOTICE_ABANDONED) malformed(`notice_kind ${noticeKind}`);
  const identityAt = kind === "classic" ? C.OWNER_CLASSIC_IDENTITY_ASSET : C.OWNER_COMPOSITE_IDENTITY_ASSET;
  return {
    generation,
    createdSlot: generation >> BigInt(C.GENERATION_SEQ_BITS),
    generationSeq: Number(generation & BigInt(C.GENERATION_SEQ_LIMIT - 1)),
    closeAfterSlot: r.u64(C.OWNER_CLOSE_AFTER_SLOT),
    noticeKind: noticeKind as V1NoticeKind,
    creator: kind === "classic" ? r.address(C.OWNER_CLASSIC_CREATOR) : null,
    identityAsset: isZero(r.bytes(identityAt, 32)) ? null : r.address(identityAt),
  };
}

export interface V1Descriptor {
  readonly minSlotGap: number;
  readonly externalWidth: number;
  readonly temporalKind: number;
  readonly moduleOffset: number;
  readonly moduleLen: number;
  readonly mode: number;
  readonly requiresIxSysvar: number;
  readonly adapterType: number;
  readonly adapterVersion: number;
  readonly bindingWidth: number;
  readonly bindingVersion: number;
  readonly derived: boolean;
}

export function decodeV1Descriptor(data: Uint8Array): V1Descriptor {
  const r = new Reader(data).need(C.DESCRIPTOR_LEN);
  const bindingVersion = r.u8(C.D_BINDING_VERSION);
  if (bindingVersion > C.BINDING_VERSION_MAX) malformed(`binding_version ${bindingVersion}`);
  const bindingWidth = r.u8(C.D_BINDING_WIDTH);
  if (bindingWidth > C.MAX_BINDING_WIDTH) malformed(`binding_width ${bindingWidth}`);
  return {
    minSlotGap: r.u16(C.D_MIN_SLOT_GAP), externalWidth: r.u8(C.D_EXTERNAL_WIDTH), temporalKind: r.u8(C.D_TEMPORAL_KIND),
    moduleOffset: r.u32(C.D_MODULE_OFFSET), moduleLen: r.u16(C.D_MODULE_LEN), mode: r.u8(C.D_MODE),
    requiresIxSysvar: r.u8(C.D_REQUIRES_IX_SYSVAR), adapterType: r.u8(C.D_ADAPTER_TYPE), adapterVersion: r.u8(C.D_ADAPTER_VERSION),
    bindingWidth, bindingVersion, derived: (bindingVersion & C.BINDING_DERIVED) !== 0,
  };
}

/** Membership record length for a row (`common`: 4 if DERIVED, else 4 + 65 × width). */
export function v1MembershipLen(derived: boolean, bindingWidth: number): number {
  return derived ? C.MEMBERSHIP_HEADER_LEN : C.MEMBERSHIP_HEADER_LEN + C.MEMBERSHIP_TUPLE_LEN * bindingWidth;
}

/** Temporal module length by kind (0 = none or DUAL). */
export function v1TemporalModuleLen(kind: number): number {
  switch (kind) {
    case C.TEMPORAL_NONE: case C.TEMPORAL_DUAL_NATIVE_POINT_V1: return 0;
    case C.TEMPORAL_CPMM_QUIET_V2: return C.CPMM_QUIET_TEMPORAL_V2_LEN;
    case C.TEMPORAL_DAMM_ONLYB_V1: return C.SOURCE_TEMPORAL_MODULE_V1_LEN;
    case C.TEMPORAL_DAMM_RESERVE_V3: return C.DAMM_RESERVE_V3_LEN;
    case C.TEMPORAL_MTP4_SAMPLED: case C.TEMPORAL_MTP4_POINT: return C.MTP4_MODULE_LEN;
    default: return malformed(`temporal_kind ${kind}`);
  }
}

export interface V1MembershipTuple { readonly address: Address; readonly owner: Address; readonly executable: boolean }
export interface V1Membership {
  readonly bindingWidth: number;
  readonly planBinding: number;
  readonly bindingVariant: number;
  readonly derived: boolean;
  readonly tuples: readonly V1MembershipTuple[];
}

export interface V1Row {
  readonly descriptor: V1Descriptor;
  /** v1 `MIMIRSRC` image (384 B), decodable with `decodeSourceConfigHeader`. */
  readonly source: Uint8Array;
  /** v1 `MIMIRRNG` ring (544 B). */
  readonly ring: Uint8Array;
}

function decodeRow944(r: Reader): V1Row {
  r.need(C.SOURCE_ROW_LEN);
  return {
    descriptor: decodeV1Descriptor(r.bytes(C.ROW_DESCRIPTOR, C.DESCRIPTOR_LEN)),
    source: r.bytes(C.ROW_SOURCE, C.SOURCE_IMAGE_LEN),
    ring: r.bytes(C.ROW_RING, C.RING_LEN),
  };
}

export interface V1Definition {
  /** V0 feed image (325 B); ticker at +313. */
  readonly feedImage: Uint8Array;
  /** Plan image (320 B). */
  readonly planImage: Uint8Array;
  readonly ticker: Uint8Array;
}

function decodeDefinition(r: Reader): V1Definition {
  r.need(C.DEFINITION_LEN);
  return {
    feedImage: r.bytes(C.DEF_FEED_IMAGE, C.FEED_IMAGE_LEN),
    planImage: r.bytes(C.DEF_PLAN_IMAGE, C.PLAN_IMAGE_LEN),
    ticker: r.bytes(C.DEF_FEED_IMAGE + K.FEED_CONFIG_PRIMARY_TICKER_OFFSET, K.PRIMARY_TICKER_ENCODED_LEN),
  };
}

export interface V1ConverterBlock {
  readonly definition: V1Definition;
  /** Private TWAP (v1 `MIMIRTWP`, 640 B). */
  readonly twap: Uint8Array;
  /** Converter snapshot (v1 `MIMIRSNP`, 512 B; `@48` = the SOL feed account). */
  readonly snapshot: Uint8Array;
  readonly rows: readonly V1Row[];
}

function decodeConverter(r: Reader, s: number): V1ConverterBlock {
  r.need(C.CONVERTER_FIXED_LEN + C.SOURCE_ROW_LEN * s);
  const rows: V1Row[] = [];
  for (let i = 0; i < s; i++) rows.push(decodeRow944(r.at(C.CONVERTER_FIXED_LEN + C.SOURCE_ROW_LEN * i)));
  return {
    definition: decodeDefinition(r.at(C.CONV_DEFINITION)),
    twap: r.bytes(C.CONV_TWAP, C.CONV_SNAPSHOT - C.CONV_TWAP),
    snapshot: r.bytes(C.CONV_SNAPSHOT, C.CONVERTER_FIXED_LEN - C.CONV_SNAPSHOT),
    rows,
  };
}

/** Walks the memberships then the modules (row order) from `start`; returns the end offset. */
function decodeTail(data: Uint8Array, start: number, descriptors: readonly V1Descriptor[]) {
  const r = new Reader(data);
  const memberships: V1Membership[] = [];
  let at = start;
  for (const d of descriptors) {
    const len = v1MembershipLen(d.derived, d.bindingWidth);
    const m = r.at(at).need(len);
    const width = m.u8(C.M_BINDING_WIDTH);
    const derivedMarker = m.u8(C.M_DERIVED_MARKER);
    if (width !== d.bindingWidth || m.u8(C.M_PLAN_BINDING) !== (d.bindingVersion & C.BINDING_STATIC) || derivedMarker !== (d.derived ? 1 : 0)) {
      malformed(`membership @${at} disagrees with its descriptor`);
    }
    const tuples: V1MembershipTuple[] = [];
    if (!d.derived) {
      for (let i = 0; i < width; i++) {
        const t = m.at(C.MEMBERSHIP_HEADER_LEN + C.MEMBERSHIP_TUPLE_LEN * i);
        const executable = t.u8(64);
        if (executable > 1) malformed(`membership @${at} executable byte ${executable}`);
        tuples.push({ address: t.address(0), owner: t.address(32), executable: executable === 1 });
      }
    }
    memberships.push({ bindingWidth: width, planBinding: m.u8(C.M_PLAN_BINDING), bindingVariant: m.u8(C.M_BINDING_VARIANT), derived: d.derived, tuples });
    at += len;
  }
  const modules: Uint8Array[] = [];
  for (const d of descriptors) {
    const len = v1TemporalModuleLen(d.temporalKind);
    if (d.moduleLen !== len) malformed(`module_len ${d.moduleLen} != ${len} for temporal kind ${d.temporalKind}`);
    if (len !== 0 && d.moduleOffset !== at) malformed(`module_offset ${d.moduleOffset} != packed ${at}`);
    modules.push(r.at(at).need(len).bytes(0, len));
    at += len;
  }
  return { memberships, modules, end: at };
}

function checkSelfAddress(r: Reader, address: Address | undefined) {
  if (address !== undefined && r.address(C.PREFIX_SELF_ADDRESS) !== address) malformed("prefix @48 is not this account");
}

export interface V1Evidence {
  readonly wireAge: number; readonly configured: number; readonly k: number; readonly effectiveK: number;
  readonly venues: number; readonly correlations: number; readonly flags: number; readonly minRingSlot: bigint;
  readonly quietLastRefresh: bigint; readonly quietEnd: bigint; readonly quietEndSlot: bigint; readonly quietWidthBps: number;
  readonly sampledBandBps: number; readonly sampledCloseBps: number; readonly supportStart: bigint; readonly supportEnd: bigint;
  readonly floor: bigint;
}

function decodeEvidence(r: Reader): V1Evidence {
  return {
    wireAge: r.u16(K.E_WIRE_AGE), configured: r.u8(K.E_CONFIGURED), k: r.u8(K.E_K), effectiveK: r.u8(K.E_EFFECTIVE_K),
    venues: r.u8(K.E_VENUES), correlations: r.u8(K.E_CORRELATIONS), flags: r.u8(K.E_FLAGS), minRingSlot: r.u64(K.E_MIN_RING_SLOT),
    quietLastRefresh: r.i64(K.E_QUIET_LAST_REFRESH), quietEnd: r.i64(K.E_QUIET_END), quietEndSlot: r.u64(K.E_QUIET_END_SLOT),
    quietWidthBps: r.u16(K.E_QUIET_WIDTH_BPS), sampledBandBps: r.u16(K.E_SAMPLED_BAND_BPS), sampledCloseBps: r.u16(K.E_SAMPLED_CLOSE_BPS),
    supportStart: r.i64(K.E_SUPPORT_START), supportEnd: r.i64(K.E_SUPPORT_END), floor: r.u128(K.E_FLOOR),
  };
}

export interface V1ClassicHeader {
  readonly version: number; readonly hlen: number; readonly exactLen: number; readonly definitionDigest: Uint8Array;
  readonly sourceSetRevision: bigint; readonly n: number; readonly s: number; readonly bump: number; readonly status: number;
  readonly regionMask: number; readonly f2Credit: number;
}

export interface V1ClassicProof {
  readonly version: number; readonly len: number; readonly flags: number; readonly revision: bigint; readonly slot: bigint;
  readonly primary: V1Evidence; readonly converter: V1Evidence; readonly converterRevision: bigint; readonly converterSlot: bigint;
  readonly converterValidUntil: bigint; readonly converterFeedId: Uint8Array; readonly dual: Uint8Array;
}

function decodeClassicProof(p: Reader): V1ClassicProof {
  if (!p.magic(K.P_MAGIC, ascii(K.PROOF_MAGIC))) malformed("proof magic is not MIMIRCPR");
  const proof: V1ClassicProof = {
    version: p.u16(K.P_VERSION), len: p.u16(K.P_LEN), flags: p.u32(K.P_FLAGS), revision: p.u64(K.P_REVISION), slot: p.u64(K.P_SLOT),
    primary: decodeEvidence(p.at(K.P_PRIMARY)), converter: decodeEvidence(p.at(K.P_CONVERTER)),
    converterRevision: p.u64(K.P_CONV_REVISION), converterSlot: p.u64(K.P_CONV_SLOT), converterValidUntil: p.u64(K.P_CONV_VALID_UNTIL),
    converterFeedId: p.bytes(K.P_CONV_FEED_ID, 32), dual: p.bytes(K.P_DUAL, 4),
  };
  if (proof.version !== K.PROOF_VERSION && proof.version !== K.PROOF_VERSION_DUAL) malformed(`proof version ${proof.version}`);
  if (proof.len !== K.PROOF_LEN) malformed(`proof len ${proof.len}`);
  return proof;
}

export interface V1ClassicFeed {
  /** Public v1 `MIMIRSNP` snapshot (512 B), decodable with `decodeFeedSnapshotHeader`; consumers hash exactly these bytes. */
  readonly prefix: Uint8Array;
  readonly feedId: Uint8Array;
  readonly selfAddress: Address;
  readonly owner: V1OwnerRecord;
  readonly header: V1ClassicHeader;
  /** Null while all zero: before the first Fresh tag89 and after every non-Fresh publication. */
  readonly proof: V1ClassicProof | null;
  readonly definition: V1Definition;
  readonly rows: readonly V1Row[];
  readonly converter: V1ConverterBlock | null;
  /** Primaries then converter rows. */
  readonly memberships: readonly V1Membership[];
  readonly modules: readonly Uint8Array[];
}

/** Decodes a whole V1 Classic feed account; `address`, when given, must equal prefix `@48`. */
export function decodeV1ClassicFeed(data: Uint8Array, address?: Address): V1ClassicFeed {
  const r = new Reader(data).need(K.CLASSIC_ROWS);
  if (!r.magic(0, V1_SNAPSHOT_MAGIC)) malformed("prefix magic is not MIMIRSNP");
  checkSelfAddress(r, address);
  const h = r.at(K.CLASSIC_HEADER);
  if (!h.magic(K.H_MAGIC, V1_CLASSIC_MAGIC)) malformed("header magic is not MIMIRCLX");
  const header: V1ClassicHeader = {
    version: h.u16(K.H_VERSION), hlen: h.u16(K.H_HLEN), exactLen: h.u32(K.H_EXACT_LEN), definitionDigest: h.bytes(K.H_DIGEST, 32),
    sourceSetRevision: h.u64(K.H_SOURCE_SET_REVISION), n: h.u8(K.H_N), s: h.u8(K.H_S), bump: h.u8(K.H_BUMP), status: h.u8(K.H_STATUS),
    regionMask: h.u8(K.H_REGION_MASK), f2Credit: h.u8(K.H_F2_CREDIT),
  };
  if (header.version !== K.CLASSIC_VERSION || header.hlen !== K.CLASSIC_HEADER_LEN) malformed("header version/hlen");
  if (header.exactLen !== data.length) malformed(`exact_len ${header.exactLen} != data length ${data.length}`);
  if (header.regionMask !== C.REGION_MASK_CORE) malformed(`region_mask ${header.regionMask}`);
  if (header.n < 1 || header.n > K.CLASSIC_MAX_PRIMARY_ROWS || header.s > K.CLASSIC_MAX_CONVERTER_ROWS) malformed("row counts");
  if (header.status > C.STATUS_ACTIVE || header.f2Credit > K.F2_CREDIT_AVAILABLE || h.u16(K.H_RESERVED) !== 0) malformed("header status/f2/reserved");
  const p = r.at(K.CLASSIC_PROOF);
  const proof = isZero(p.bytes(0, K.PROOF_LEN)) ? null : decodeClassicProof(p);
  const rows: V1Row[] = [];
  for (let i = 0; i < header.n; i++) rows.push(decodeRow944(r.at(K.CLASSIC_ROWS + C.SOURCE_ROW_LEN * i)));
  let rowsEnd = K.CLASSIC_ROWS + C.SOURCE_ROW_LEN * header.n;
  const converter = header.s === 0 ? null : decodeConverter(r.at(rowsEnd), header.s);
  if (converter) rowsEnd += C.CONVERTER_FIXED_LEN + C.SOURCE_ROW_LEN * header.s;
  const descriptors = [...rows, ...(converter?.rows ?? [])].map((row) => row.descriptor);
  const tail = decodeTail(data, rowsEnd, descriptors);
  if (tail.end !== data.length) malformed(`layout ends at ${tail.end}, data is ${data.length} B`);
  return {
    prefix: r.bytes(0, C.CLASSIC_PREFIX_LEN), feedId: r.bytes(K.OFFSET_FEED_ID, 32), selfAddress: r.address(C.PREFIX_SELF_ADDRESS),
    owner: decodeV1OwnerRecord(r.bytes(K.CLASSIC_OWNER, C.OWNER_CLASSIC_LEN), "classic"),
    header, proof, definition: decodeDefinition(r.at(K.CLASSIC_DEFINITION)), rows, converter,
    memberships: tail.memberships, modules: tail.modules,
  };
}

/** Composite prefix length `P = 320 + 80 × count`. */
export function v1CompositePrefixLen(count: number): number {
  return C.COMPOSITE_PREFIX_FIXED_LEN + C.COMPOSITE_PREFIX_COMPONENT_LEN * count;
}

export interface V1CompositeSnapshotComponent {
  readonly feedId: Uint8Array; readonly snapshotRevision: bigint; readonly snapshotSlot: bigint;
  readonly priceX64: bigint; readonly contributionX64: bigint;
}

export interface V1CompositeSnapshot {
  readonly version: number; readonly headerLen: number; readonly flags: number; readonly feedId: Uint8Array; readonly config: Address;
  readonly registryEpoch: bigint; readonly configRevision: bigint; readonly revision: bigint; readonly status: number;
  readonly routeability: number; readonly riskTier: number; readonly snapshotSource: number; readonly freshness: number;
  readonly count: number; readonly quoteStatus: number; readonly snapshotSlot: bigint; readonly validUntilSlot: bigint;
  readonly unixTs: bigint; readonly oldestComponentSnapshotSlot: bigint; readonly oldestComponentActivitySlot: bigint;
  readonly priceMantissa: bigint; readonly priceExponent: number; readonly confidenceBps: number; readonly dispersionBps: number;
  readonly priceX64: bigint; readonly priceLowerX64: bigint; readonly priceUpperX64: bigint; readonly maxRecommendedNotional: bigint;
  readonly manipulationCostFloor: bigint; readonly componentSetHash: Uint8Array; readonly componentSnapshotHash: Uint8Array;
  readonly anchorProvider: number; readonly anchorStatus: number; readonly conditions: number; readonly powers: number;
  readonly conditionedRows: number; readonly priceState: number; readonly components: readonly V1CompositeSnapshotComponent[];
}

export interface V1CompositeConfigComponent { readonly feedId: Uint8Array; readonly sourceConfig: Address; readonly quantityX64: bigint }

export interface V1CompositeConfig {
  readonly version: number; readonly headerLen: number; readonly flags: number; readonly feedId: Uint8Array; readonly creator: Address;
  readonly quoteMint: Address; readonly priceExponent: number; readonly status: number; readonly routeabilityCap: number;
  readonly riskTier: number; readonly componentCount: number; readonly maxSnapshotAgeSlots: number;
  readonly maxComponentSnapshotAgeSlots: number; readonly maxComponentConfidenceBps: number; readonly maxComponentDispersionBps: number;
  readonly componentSetHash: Uint8Array; readonly registryEpoch: bigint; readonly configRevision: bigint;
  readonly adminRevisionAtCreation: bigint; readonly bump: number; readonly ticker: Uint8Array;
  /** Null iff s = 0. */
  readonly solConversionSourceConfig: Address | null;
  readonly components: readonly V1CompositeConfigComponent[];
}

export interface V1CompositeHeader {
  readonly version: number; readonly hlen: number; readonly exactLen: number; readonly cfcRevision: bigint; readonly count: number;
  readonly bump: number; readonly status: number; readonly converterCount: number; readonly regionMask: number; readonly rowFormat: number;
}

export interface V1CompositeFees {
  readonly ownerGenerated: bigint; readonly totalRefreshFees: bigint; readonly ownerClaimed: bigint; readonly treasuryPaid: bigint;
  readonly lastAccrualConfigRevision: bigint;
  /** R-01 unclaimed owner fees `L = owner_generated − owner_claimed`. */
  readonly ownerLiability: bigint;
}

/** RowDef (201 B): the child's sealed feed/plan runs and the DUAL bind tag. */
export interface V1RowDef {
  readonly priceExponent: number; readonly riskTier: number; readonly lifecycleState: number; readonly baseDecimals: number;
  readonly quoteDecimals: number; readonly minSourceCount: number; readonly minVenueCount: number;
  readonly minCorrelationGroupCount: number; readonly minCoverageRatioBps: number; readonly maxConfidenceBps: number;
  readonly maxDispersionBps: number; readonly maxSnapshotAgeSlots: number; readonly maxSourceActivityAgeSlots: number;
  readonly sourceSetHash: Uint8Array; readonly anchorPolicyHash: Uint8Array; readonly nativeExceptionHash: Uint8Array;
  readonly feedConfigRevision: bigint; readonly registryEpoch: bigint; readonly feedBump: number; readonly planHash: Uint8Array;
  readonly planId: number; readonly planVersion: number; readonly planProfile: number; readonly planStatus: number;
  readonly planRiskTier: number; readonly planMinSources: number; readonly planMinVenues: number;
  readonly planMinCorrelationGroups: number; readonly planMaxDispersionBps: number; readonly planMaxSourceActivityAgeSlots: number;
  readonly adapterMask: bigint; readonly planBump: number; readonly hashSchemeVersion: number; readonly ringVersion: number;
  readonly accountsBindingVersion: number; readonly bindTag: Uint8Array;
}

function decodeRowDef(r: Reader): V1RowDef {
  const f0 = X.ROWDEF_FEED_RUN0, f1 = X.ROWDEF_FEED_RUN1, f4 = X.ROWDEF_FEED_RUN4, p1 = X.ROWDEF_PLAN_RUN1, p2 = X.ROWDEF_PLAN_RUN2;
  return {
    priceExponent: r.i32(f0), riskTier: r.u8(f0 + 4), lifecycleState: r.u8(f0 + 5), baseDecimals: r.u8(f0 + 6),
    quoteDecimals: r.u8(f0 + 7), minSourceCount: r.u8(f0 + 8), minVenueCount: r.u8(f0 + 9), minCorrelationGroupCount: r.u8(f0 + 10),
    minCoverageRatioBps: r.u16(f1), maxConfidenceBps: r.u16(f1 + 2), maxDispersionBps: r.u16(f1 + 4),
    maxSnapshotAgeSlots: r.u16(f1 + 6), maxSourceActivityAgeSlots: r.u16(f1 + 8),
    sourceSetHash: r.bytes(X.ROWDEF_FEED_RUN2, 32), anchorPolicyHash: r.bytes(X.ROWDEF_FEED_RUN3, 32),
    nativeExceptionHash: r.bytes(X.ROWDEF_FEED_RUN3 + 32, 32),
    feedConfigRevision: r.u64(f4), registryEpoch: r.u64(f4 + 8), feedBump: r.u8(f4 + 16), planHash: r.bytes(X.ROWDEF_PLAN_RUN0, 32),
    planId: r.u16(p1), planVersion: r.u16(p1 + 2), planProfile: r.u8(p1 + 4), planStatus: r.u8(p1 + 5), planRiskTier: r.u8(p1 + 6),
    planMinSources: r.u8(p1 + 7), planMinVenues: r.u8(p1 + 8), planMinCorrelationGroups: r.u8(p1 + 9),
    planMaxDispersionBps: r.u16(p1 + 10), planMaxSourceActivityAgeSlots: r.u16(p1 + 12),
    adapterMask: r.u64(p2), planBump: r.u8(p2 + 8), hashSchemeVersion: r.u8(p2 + 9), ringVersion: r.u16(p2 + 10),
    accountsBindingVersion: r.u8(p2 + 12), bindTag: r.bytes(X.ROWDEF_BIND_TAG, X.ROWDEF_BIND_TAG_LEN),
  };
}

export interface V1CompositeRow extends V1Row {
  /** COMPACT rows only. */
  readonly rowDef: V1RowDef | null;
  /** FULL rows only: the child's raw V0 feed image and plan image. */
  readonly feedImage: Uint8Array | null;
  readonly planImage: Uint8Array | null;
}

export interface V1CompositeDualProof {
  readonly version: number; readonly len: number; readonly flags: number; readonly revision: bigint; readonly slot: bigint;
  readonly commitment: Uint8Array; readonly rows: readonly Uint8Array[]; readonly converter: Uint8Array | null;
}

export interface V1CompositeFeed {
  readonly prefixLen: number;
  /** `data[0, P)`: the hashed region. */
  readonly prefix: Uint8Array;
  readonly snapshot: V1CompositeSnapshot;
  readonly owner: V1OwnerRecord;
  readonly config: V1CompositeConfig;
  readonly header: V1CompositeHeader;
  readonly fees: V1CompositeFees;
  readonly rows: readonly V1CompositeRow[];
  readonly converter: V1ConverterBlock | null;
  readonly memberships: readonly V1Membership[];
  readonly modules: readonly Uint8Array[];
  readonly dualProof: V1CompositeDualProof | null;
}

function decodeCompositeSnapshot(r: Reader, count: number): V1CompositeSnapshot {
  const components: V1CompositeSnapshotComponent[] = [];
  for (let i = 0; i < count; i++) {
    const c = r.at(X.CSP_COMPONENTS + X.CSP_COMPONENT_LEN * i);
    components.push({
      feedId: c.bytes(X.CSP_COMPONENT_FEED_ID, 32), snapshotRevision: c.u64(X.CSP_COMPONENT_SNAPSHOT_REVISION),
      snapshotSlot: c.u64(X.CSP_COMPONENT_SNAPSHOT_SLOT), priceX64: c.u128(X.CSP_COMPONENT_PRICE_X64),
      contributionX64: c.u128(X.CSP_COMPONENT_CONTRIBUTION_X64),
    });
  }
  return {
    version: r.u16(X.CSP_VERSION), headerLen: r.u16(X.CSP_HEADER_LEN), flags: r.u32(X.CSP_FLAGS), feedId: r.bytes(X.CSP_FEED_ID, 32),
    config: r.address(X.CSP_CONFIG), registryEpoch: r.u64(X.CSP_REGISTRY_EPOCH), configRevision: r.u64(X.CSP_CONFIG_REVISION),
    revision: r.u64(X.CSP_REVISION), status: r.u8(X.CSP_STATUS), routeability: r.u8(X.CSP_ROUTEABILITY), riskTier: r.u8(X.CSP_RISK_TIER),
    snapshotSource: r.u8(X.CSP_SNAPSHOT_SOURCE), freshness: r.u8(X.CSP_FRESHNESS), count: r.u8(X.CSP_COUNT),
    quoteStatus: r.u8(X.CSP_QUOTE_STATUS), snapshotSlot: r.u64(X.CSP_SNAPSHOT_SLOT), validUntilSlot: r.u64(X.CSP_VALID_UNTIL_SLOT),
    unixTs: r.i64(X.CSP_UNIX_TS), oldestComponentSnapshotSlot: r.u64(X.CSP_OLDEST_COMPONENT_SNAPSHOT_SLOT),
    oldestComponentActivitySlot: r.u64(X.CSP_OLDEST_COMPONENT_ACTIVITY_SLOT), priceMantissa: r.u64(X.CSP_PRICE_MANTISSA),
    priceExponent: r.i32(X.CSP_PRICE_EXPONENT), confidenceBps: r.u16(X.CSP_CONFIDENCE_BPS), dispersionBps: r.u16(X.CSP_DISPERSION_BPS),
    priceX64: r.u128(X.CSP_PRICE_X64), priceLowerX64: r.u128(X.CSP_PRICE_LOWER_X64), priceUpperX64: r.u128(X.CSP_PRICE_UPPER_X64),
    maxRecommendedNotional: r.u128(X.CSP_MAX_RECOMMENDED_NOTIONAL), manipulationCostFloor: r.u128(X.CSP_MANIPULATION_COST_FLOOR),
    componentSetHash: r.bytes(X.CSP_COMPONENT_SET_HASH, 32), componentSnapshotHash: r.bytes(X.CSP_COMPONENT_SNAPSHOT_HASH, 32),
    anchorProvider: r.u8(X.CSP_ANCHOR_PROVIDER), anchorStatus: r.u8(X.CSP_ANCHOR_STATUS), conditions: r.u16(X.CSP_CONDITIONS),
    powers: r.u16(X.CSP_POWERS), conditionedRows: r.u8(X.CSP_CONDITIONED_ROWS), priceState: r.u8(X.CSP_PRICE_STATE), components,
  };
}

function decodeCompositeConfig(r: Reader, count: number): V1CompositeConfig {
  if (!r.magic(X.CFC_MAGIC_AT, ascii(X.CFC_MAGIC))) malformed("cfc magic is not MIMIRCFC");
  const components: V1CompositeConfigComponent[] = [];
  for (let i = 0; i < count; i++) {
    const c = r.at(X.CFC_COMPONENTS + X.CFC_COMPONENT_LEN * i);
    components.push({ feedId: c.bytes(X.CFC_COMPONENT_FEED_ID, 32), sourceConfig: c.address(X.CFC_COMPONENT_SOURCE_CONFIG),
      quantityX64: c.u128(X.CFC_COMPONENT_QUANTITY_X64) });
  }
  const sol = r.bytes(X.CFC_SOL_CONVERSION_SOURCE_CONFIG, 32);
  return {
    version: r.u16(X.CFC_VERSION), headerLen: r.u16(X.CFC_HEADER_LEN), flags: r.u32(X.CFC_FLAGS), feedId: r.bytes(X.CFC_FEED_ID, 32),
    creator: r.address(X.CFC_CREATOR), quoteMint: r.address(X.CFC_QUOTE_MINT), priceExponent: r.i32(X.CFC_PRICE_EXPONENT),
    status: r.u8(X.CFC_STATUS), routeabilityCap: r.u8(X.CFC_ROUTEABILITY_CAP), riskTier: r.u8(X.CFC_RISK_TIER),
    componentCount: r.u8(X.CFC_COMPONENT_COUNT), maxSnapshotAgeSlots: r.u16(X.CFC_MAX_SNAPSHOT_AGE_SLOTS),
    maxComponentSnapshotAgeSlots: r.u16(X.CFC_MAX_COMPONENT_SNAPSHOT_AGE_SLOTS),
    maxComponentConfidenceBps: r.u16(X.CFC_MAX_COMPONENT_CONFIDENCE_BPS), maxComponentDispersionBps: r.u16(X.CFC_MAX_COMPONENT_DISPERSION_BPS),
    componentSetHash: r.bytes(X.CFC_COMPONENT_SET_HASH, 32), registryEpoch: r.u64(X.CFC_REGISTRY_EPOCH),
    configRevision: r.u64(X.CFC_CONFIG_REVISION), adminRevisionAtCreation: r.u64(X.CFC_ADMIN_REVISION_AT_CREATION),
    bump: r.u8(X.CFC_BUMP), ticker: r.bytes(X.CFC_TICKER, X.CFC_TICKER_LEN),
    solConversionSourceConfig: isZero(sol) ? null : r.address(X.CFC_SOL_CONVERSION_SOURCE_CONFIG), components,
  };
}

/** Decodes a whole V1 composite account; `address`, when given, must equal CSP `@48`. */
export function decodeV1CompositeFeed(data: Uint8Array, address?: Address): V1CompositeFeed {
  const r = new Reader(data).need(X.CSP_COMPONENTS);
  if (!r.magic(X.CSP_MAGIC_AT, V1_COMPOSITE_MAGIC)) malformed("prefix magic is not MIMIRCSP");
  const count = r.u8(X.CSP_COUNT);
  if (count < X.COMPOSITE_MIN_COMPONENTS || count > X.COMPOSITE_MAX_COMPONENTS) malformed(`count ${count}`);
  checkSelfAddress(r, address);
  const prefixLen = v1CompositePrefixLen(count);
  const rowsAt = X.ROWS_AT_FIXED + X.ROWS_AT_PER_COMPONENT * count;
  r.need(rowsAt);
  const h = r.at(X.HDR_AT_FIXED + X.HDR_AT_PER_COMPONENT * count);
  if (!h.magic(X.HDR_MAGIC_AT, ascii(X.HDR_MAGIC))) malformed("header magic is not MIMIRCEF");
  const header: V1CompositeHeader = {
    version: h.u16(X.HDR_VERSION), hlen: h.u16(X.HDR_HLEN), exactLen: h.u32(X.HDR_EXACT_LEN), cfcRevision: h.u64(X.HDR_CFC_REVISION),
    count: h.u8(X.HDR_COUNT), bump: h.u8(X.HDR_BUMP), status: h.u8(X.HDR_STATUS), converterCount: h.u8(X.HDR_CONVERTER_COUNT),
    regionMask: h.u8(X.HDR_REGION_MASK), rowFormat: h.u8(X.HDR_ROW_FORMAT),
  };
  if (header.version !== X.HDR_VERSION_VALUE || header.hlen !== X.HDR_LEN) malformed("header version/hlen");
  if (header.exactLen !== data.length) malformed(`exact_len ${header.exactLen} != data length ${data.length}`);
  if (header.count !== count || header.regionMask !== C.REGION_MASK_CORE || header.status > C.STATUS_ACTIVE) malformed("header count/region/status");
  if (header.converterCount > X.COMPOSITE_MAX_CONVERTER_ROWS || header.rowFormat > X.ROW_FORMAT_FULL || h.u16(X.HDR_RESERVED) !== 0) {
    malformed("header converter_count/row_format/reserved");
  }
  const config = decodeCompositeConfig(r.at(X.CFC_AT_FIXED + X.CFC_AT_PER_COMPONENT * count), count);
  if (config.version !== X.CFC_VERSION_VALUE || config.headerLen !== X.CFC_LEN_FIXED + X.CFC_LEN_PER_COMPONENT * count
    || config.componentCount !== count || config.bump !== header.bump || config.configRevision !== header.cfcRevision) {
    malformed("cfc image disagrees with the header");
  }
  const f = r.at(X.FEE_AT_FIXED + X.FEE_AT_PER_COMPONENT * count);
  const ownerGenerated = f.u64(X.FEE_OWNER_GENERATED), ownerClaimed = f.u64(X.FEE_OWNER_CLAIMED);
  if (ownerClaimed > ownerGenerated) malformed("owner_claimed exceeds owner_generated");
  const fees: V1CompositeFees = {
    ownerGenerated, totalRefreshFees: f.u64(X.FEE_TOTAL_REFRESH_FEES), ownerClaimed, treasuryPaid: f.u64(X.FEE_TREASURY_PAID),
    lastAccrualConfigRevision: f.u64(X.FEE_LAST_ACCRUAL_CONFIG_REVISION), ownerLiability: ownerGenerated - ownerClaimed,
  };
  const full = header.rowFormat === X.ROW_FORMAT_FULL;
  const stride = full ? X.ROW_FULL_LEN : X.ROW_COMPACT_LEN;
  const rows: V1CompositeRow[] = [];
  for (let i = 0; i < count; i++) {
    const row = r.at(rowsAt + stride * i).need(stride);
    rows.push({
      descriptor: decodeV1Descriptor(row.bytes(C.ROW_DESCRIPTOR, C.DESCRIPTOR_LEN)),
      source: row.bytes(C.ROW_SOURCE, C.SOURCE_IMAGE_LEN),
      ring: row.bytes(full ? X.ROW_FULL_RING : X.ROW_COMPACT_RING, C.RING_LEN),
      rowDef: full ? null : decodeRowDef(row.at(X.ROW_ROWDEF)),
      feedImage: full ? row.bytes(X.ROW_FEED, C.FEED_IMAGE_LEN) : null,
      planImage: full ? row.bytes(X.ROW_PLAN, C.PLAN_IMAGE_LEN) : null,
    });
  }
  const mtp4 = rows.some((row) => row.descriptor.temporalKind === C.TEMPORAL_MTP4_SAMPLED || row.descriptor.temporalKind === C.TEMPORAL_MTP4_POINT);
  if (mtp4 !== full) malformed("row_format disagrees with the MTP4 rows");
  let rowsEnd = rowsAt + stride * count;
  const s = header.converterCount;
  const converter = s === 0 ? null : decodeConverter(r.at(rowsEnd), s);
  if (converter) rowsEnd += C.CONVERTER_FIXED_LEN + C.SOURCE_ROW_LEN * s;
  if ((s === 0) !== (config.solConversionSourceConfig === null)) malformed("sol_conversion_source_config disagrees with converter_count");
  const tail = decodeTail(data, rowsEnd, [...rows, ...(converter?.rows ?? [])].map((row) => row.descriptor));
  let end = tail.end;
  let dualProof: V1CompositeDualProof | null = null;
  if (rows.some((row) => row.descriptor.temporalKind === C.TEMPORAL_DUAL_NATIVE_POINT_V1)) {
    const len = X.DUAL_PROOF_HEADER_LEN + X.DUAL_PROOF_ROW_LEN * count + (s === 0 ? 0 : X.DUAL_PROOF_CONVERTER_LEN);
    const d = r.at(end).need(len);
    // All zero until the first tag87 publish_dual.
    if (!isZero(d.bytes(0, len))) {
      if (!d.magic(X.DUAL_PROOF_MAGIC_AT, ascii(X.DUAL_PROOF_MAGIC))) malformed("DUAL proof magic is not MIMIRCDP");
      const proofRows: Uint8Array[] = [];
      for (let i = 0; i < count; i++) proofRows.push(d.bytes(X.DUAL_PROOF_HEADER_LEN + X.DUAL_PROOF_ROW_LEN * i, X.DUAL_PROOF_ROW_LEN));
      dualProof = {
        version: d.u16(X.DUAL_PROOF_VERSION), len: d.u16(X.DUAL_PROOF_LEN), flags: d.u32(X.DUAL_PROOF_FLAGS),
        revision: d.u64(X.DUAL_PROOF_REVISION), slot: d.u64(X.DUAL_PROOF_SLOT), commitment: d.bytes(X.DUAL_PROOF_COMMITMENT, 32),
        rows: proofRows, converter: s === 0 ? null : d.bytes(X.DUAL_PROOF_HEADER_LEN + X.DUAL_PROOF_ROW_LEN * count, X.DUAL_PROOF_CONVERTER_LEN),
      };
      if (dualProof.version !== X.DUAL_PROOF_VERSION_VALUE || dualProof.len !== len) malformed(`DUAL proof version ${dualProof.version} len ${dualProof.len}`);
    }
    end += len;
  }
  if (end !== data.length) malformed(`layout ends at ${end}, data is ${data.length} B`);
  return {
    prefixLen, prefix: r.bytes(0, prefixLen), snapshot: decodeCompositeSnapshot(r, count),
    owner: decodeV1OwnerRecord(r.bytes(prefixLen, C.OWNER_COMPOSITE_LEN), "composite"),
    config, header, fees, rows, converter, memberships: tail.memberships, modules: tail.modules, dualProof,
  };
}
